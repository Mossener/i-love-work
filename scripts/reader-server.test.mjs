import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, access, symlink } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverScript = fileURLToPath(new URL('./reader-server.mjs', import.meta.url));

function request(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 5189, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('HTTP request timed out')));
    req.end();
  });
}

test('production server serves the release and prevents access outside dist', async (t) => {
  assert.equal(await access(serverScript).then(() => true, () => false), true, 'production server is implemented');
  const project = await mkdtemp(path.join(os.tmpdir(), 'i-love-work-server-'));
  const dist = path.join(project, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(project, 'package.json'), '{"secret":"private project data"}');
  await mkdir(path.join(project, 'private'));
  await writeFile(path.join(project, 'private', 'private.txt'), 'private project data');
  await symlink(path.join(project, 'private'), path.join(dist, 'assets', 'outside-link'), 'junction');
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>I Love Work</title>');
  const assets = { 'worker.mjs': ['text/javascript', 'export default 1;'], 'app.js': ['text/javascript', 'console.log(1);'], 'module.wasm': ['application/wasm', 'wasm'], 'font.woff2': ['font/woff2', 'font'], 'paper.pdf': ['application/pdf', '%PDF-1.7'], 'map.bcmap': ['application/octet-stream', 'map'] };
  for (const [name, [, body]] of Object.entries(assets)) await writeFile(path.join(dist, 'assets', name), body);
  const child = spawn(process.execPath, [serverScript, '--port', '5189', '--root', dist], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(project, { recursive: true, force: true });
  });
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) assert.fail(`server exited: ${output}`);
    try { health = await request('/__reader_health'); break; } catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  assert.ok(health, `server started: ${output}`);
  assert.equal(health.status, 200);
  assert.equal(health.headers['x-i-love-work'], '1');
  assert.deepEqual(JSON.parse(health.body), { app: 'i-love-work', root: project });
  assert.match(output, /127\.0\.0\.1:5189/);
  await t.test('index, real assets, query strings and HEAD have expected responses', async () => {
    assert.match((await request('/')).body.toString(), /I Love Work/);
    for (const [name, [mime, body]] of Object.entries(assets)) {
      const result = await request(`/assets/${name}?v=1`);
      assert.equal(result.status, 200, name);
      assert.ok(result.headers['content-type'].startsWith(mime), name);
      assert.equal(result.body.toString(), body, name);
      const head = await request(`/assets/${name}`, 'HEAD');
      assert.equal(head.status, 200, name);
      assert.equal(Number(head.headers['content-length']), Buffer.byteLength(body), name);
      assert.equal(head.body.length, 0, name);
    }
  });
  await t.test('private files, traversal, malformed paths and unsupported methods cannot be served', async () => {
    for (const pathname of ['/package.json', '/../package.json', '/%2e%2e/package.json', '/assets/../../package.json', '/assets/%2e%2e/%2e%2e/package.json', '/..%5cpackage.json', '/%00', '/%ZZ', '/assets/outside-link/private.txt']) {
      const result = await request(pathname);
      assert.ok([400, 403, 404].includes(result.status), `${pathname}: ${result.status}`);
      assert.ok(!result.body.toString().includes('private project data'), pathname);
    }
    assert.equal((await request('/', 'POST')).status, 405);
    assert.equal((await request('/not-a-file.js')).status, 404);
  });
});
