// Local stand-in for Vercel: serves public/ and answers /api/rpc with the same handler.
//   DATABASE_URL=postgres://... node tools/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { handle } = require('../server/handler.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // for the browser tests only (this server never runs in production): decide where the next rounds of Rugpull / Rocket end
  if (url.pathname === '/__test/crash' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const v = Number(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').roll);
    require('../server/crash.js').hooks.roll = v >= 1 ? () => v : null;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    return;
  }
  if (url.pathname === '/api/rpc') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await handle({ method: req.method, body: Buffer.concat(chunks).toString('utf8'), query: Object.fromEntries(url.searchParams), headers: req.headers, ip: req.socket.remoteAddress });
    res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(out.body));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.)+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  try {
    if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`GundiChest dev server: http://127.0.0.1:${PORT}/`));
