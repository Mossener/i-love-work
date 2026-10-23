import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
};

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function createReaderServer(directory) {
  const root = await realpath(path.resolve(directory));
  if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('The distribution is missing index.html.');
  const projectRoot = path.dirname(root);

  return http.createServer(async (request, response) => {
    response.setHeader('X-I-Love-Work', '1');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'Method not allowed');
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent((request.url ?? '/').split(/[?#]/, 1)[0]); }
    catch { send(400, 'Invalid URL'); return; }
    if (!pathname.startsWith('/') || /[\\\0:]/.test(pathname)) { send(400, 'Invalid path'); return; }
    if (pathname.split('/').some((part) => part === '..')) { send(403, 'Forbidden'); return; }
    if (pathname === '/__reader_health') {
      send(200, JSON.stringify({ app: 'i-love-work', root: projectRoot }), 'application/json; charset=utf-8');
      return;
    }
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!isWithin(root, filename)) { send(403, 'Forbidden'); return; }
    try {
      // realpath also prevents symlinks inside dist from exposing project files.
      const resolved = await realpath(filename);
      if (!isWithin(root, resolved)) { send(403, 'Forbidden'); return; }
      const metadata = await stat(resolved);
      if (!metadata.isFile()) { send(404, 'Not found'); return; }
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': metadata.size,
        'Cache-Control': 'no-cache',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(resolved);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      send(error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 404 : 500, 'Not found');
    }
  });
}

async function main() {
  const argumentsList = process.argv.slice(2);
  let port = 5173;
  let root = fileURLToPath(new URL('../dist/', import.meta.url));
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    const value = argumentsList[++index];
    if (argument === '--port' && value && /^\d+$/.test(value)) port = Number(value);
    else if (argument === '--root' && value) root = path.resolve(value);
    else throw new Error('Usage: node scripts/reader-server.mjs [--port 5173] [--root dist]');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The port must be between 1024 and 65535.');
  const server = await createReaderServer(root);
  server.on('error', (error) => {
    console.error(`I Love Work: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`I Love Work is available at http://127.0.0.1:${port}/`));
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`I Love Work: ${error.message}`); process.exitCode = 1; });
}
