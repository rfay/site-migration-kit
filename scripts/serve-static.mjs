#!/usr/bin/env node
// Minimal static file server for a mirrored/exported site, so the suite can be pointed at it:
//
//   node kit/scripts/serve-static.mjs --dir /tmp/site-static --port 4173 --run 'npx playwright test --grep "semantic:"'
//
// With --run, the server starts, the command runs with TEST_BASE_URL set to it, the server stops,
// and this script exits with the command's exit code. Nothing is left running. Without --run it
// serves until you stop it.
//
// Resolves /a/b to a/b, a/b.html, then a/b/index.html, like a typical static host. Anything
// else is a 404. Deliberately dumb: no rewrites, no CMS behavior.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (flag, dflt) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : dflt);
const dir = path.resolve(get('--dir', '.'));
const port = Number(get('--port', '4173'));
const run = get('--run', null);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.ico': 'image/x-icon',
};

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

const server = http
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
  .listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Serving ${dir} on ${url}`);
    if (!run) return;
    const child = spawn(run, { shell: true, stdio: 'inherit', env: { ...process.env, TEST_BASE_URL: url } });
    child.on('exit', (code, signal) => {
      server.close();
      process.exit(code ?? (signal ? 1 : 0));
    });
  });
