#!/usr/bin/env node
// Stored-content exporter for Drupal 6: nodes at their current revision, comments, taxonomy terms,
// in the comparable form of lib/stored.mjs. See docs/stored-tier.md.
//
// Run on the HOST, from the site's test directory (it uses `ddev mysql`):
//   node kit/scripts/stored-exporters/drupal6.mjs                      # writes baseline/stored.json (freeze)
//   node kit/scripts/stored-exporters/drupal6.mjs --out tmp/x.json     # anywhere else (a self-check, a control)
//   node kit/scripts/stored-exporters/drupal6.mjs --project-dir <dir>  # another DDEV project's database
//
// --project-dir defaults to the current directory (any directory inside the DDEV project works).
// Text columns are selected as HEX so tabs and newlines in bodies cannot break the tab-separated output.
// Drupal 6 schema: node.vid = node_revisions.vid; comments.status 0 means published.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildStored } from '../../lib/stored.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const projectDir = path.resolve(arg('--project-dir', process.cwd()));
const out = path.resolve(arg('--out', path.join(process.cwd(), 'baseline', 'stored.json')));

const HEX = new Set(['title', 'body', 'subject', 'name', 'comment', 'vocabulary', 'type']);
function query(sql) {
  const raw = execFileSync('ddev', ['mysql', '-e', sql], { cwd: projectDir, encoding: 'utf8', maxBuffer: 1 << 30 }).trimEnd();
  if (!raw) return [];
  const [head, ...rows] = raw.split('\n');
  const headers = head.split('\t');
  return rows.map((line) =>
    Object.fromEntries(
      line.split('\t').map((c, i) => [headers[i], HEX.has(headers[i]) ? Buffer.from(c === 'NULL' ? '' : c, 'hex').toString('utf8') : c]),
    ),
  );
}

const nodes = query(`
  SELECT n.nid, HEX(n.type) AS type, n.status, HEX(r.title) AS title, n.created, HEX(r.body) AS body
  FROM node n JOIN node_revisions r ON n.vid = r.vid ORDER BY n.nid`);
// Drupal 6 comments.status: 0 = published, 1 = not published (the reverse of node.status).
const comments = query(`
  SELECT cid, nid, status, HEX(subject) AS subject, HEX(name) AS name, timestamp, HEX(comment) AS comment
  FROM comments ORDER BY cid`);
const terms = query(`
  SELECT HEX(v.name) AS vocabulary, HEX(t.name) AS name FROM term_data t JOIN vocabulary v ON v.vid = t.vid`);

const stored = buildStored({
  platform: 'drupal6',
  nodes: nodes.map((n) => ({ sourceNid: n.nid, type: n.type, published: n.status === '1', title: n.title, created: n.created, bodyHtml: n.body })),
  comments: comments.map((c) => ({
    sourceCid: c.cid, sourceNid: c.nid, published: c.status === '0', subject: c.subject, name: c.name, created: c.timestamp, commentHtml: c.comment,
  })),
  terms: terms.map((t) => ({ vocabulary: t.vocabulary, name: t.name })),
});

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), ...stored }, null, 1) + '\n');
console.log(`Stored content: ${JSON.stringify(stored.counts)}`);
console.log(`Body lines: ${stored.nodes.reduce((s, n) => s + n.lines.length, 0)}, comment lines: ${stored.comments.reduce((s, c) => s + c.lines.length, 0)}`);
console.log(`Wrote ${out}`);
