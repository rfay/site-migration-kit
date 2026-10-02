#!/usr/bin/env node
// Minimal static file server for a mirrored/exported site, so the suite can be pointed at it:
//
//   node kit/scripts/serve-static.mjs --dir /tmp/site-static --port 4173
//   TEST_BASE_URL=http://localhost:4173 ddev playwright test --grep "semantic:"
//
// Resolves /a/b to a/b, a/b.html, then a/b/index.html, like a typical static host. Anything
// else is a 404. Deliberately dumb: no rewrites, no CMS behavior.

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (flag, dflt) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : dflt);
const dir = path.resolve(get('--dir', '.'));
const port = Number(get('--port', '4173'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.ico': 'image/x-icon',
};

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

http
  .createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { rel = '/'; }
    const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    const candidates = [clean, `${clean}.html`, path.join(clean, 'index.html')];
    const file = candidates.map((c) => path.join(dir, c)).find((c) => c.startsWith(dir) && isFile(c));
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Serving ${dir} on http://localhost:${port}`));
