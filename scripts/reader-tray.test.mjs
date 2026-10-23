import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = path.dirname(fileURLToPath(import.meta.url));

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Tray harness timed out: ${output}`)); }, 80_000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

test('Windows tray opens the reader after quiet and ordinary startup', { skip: process.platform !== 'win32', timeout: 90_000 }, async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'i-love-work-tray-'));
  // Verify the recursive cleanup target before creating any fixture files.
  assert.equal(path.dirname(path.resolve(tempRoot)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(tempRoot).startsWith('i-love-work-tray-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  for (const quiet of [true, false]) {
    await t.test(quiet ? 'quiet startup still permits explicit opens' : 'ordinary startup opens once, then permits explicit opens', async () => {
      const project = path.join(tempRoot, quiet ? 'quiet project' : 'ordinary project');
      await mkdir(path.join(project, 'scripts'), { recursive: true });
      await mkdir(path.join(project, 'dist'));
      await writeFile(path.join(project, 'dist', 'index.html'), '<!doctype html><title>Tray regression fixture</title>');
      for (const name of ['reader-tray.ps1', 'reader-server.mjs']) await copyFile(path.join(scripts, name), path.join(project, 'scripts', name));
      const port = await unusedPort();
      const resultPath = path.join(project, 'result.json');
      const result = await run(['-File', path.join(scripts, 'test-fixtures', 'tray-interactions.ps1'), '-ProjectDirectory', project, '-ResultPath', resultPath, '-TestPort', String(port), ...(quiet ? ['-QuietStartup'] : [])]);
      const report = await readFile(resultPath, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, '')), () => null);
      assert.ok(report, `Interaction report was not saved: ${result.output}`);
      assert.equal(result.code, 0, result.output);
      assert.equal(report.passed, true, report.message);
      assert.equal(report.urls.length, quiet ? 3 : 4);
      assert.ok(report.urls.every(url => url === `http://127.0.0.1:${port}/`));
      const closed = await new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(true));
      });
      assert.equal(closed, true, 'Exiting the tray stops its owned server');
    });
  }
});
