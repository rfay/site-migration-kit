#!/usr/bin/env node
// Stored-content exporter for Drupal 10/11: nodes at their default revision, comments on nodes, taxonomy terms,
// in the comparable form of lib/stored.mjs. See docs/stored-tier.md.
//
// Run on the HOST, from the site's test directory (it uses `ddev mysql`), pointing at the TARGET project:
//   node kit/scripts/stored-exporters/drupal11.mjs --project-dir ~/workspace/<target> --out tmp/stored-target.json
//
// Source IDs: this assumes the migration kept the original ids (nid, cid), as a rerunnable import script does.
// A Migrate API migration that renumbers must map them back from its migrate_map_* tables instead.
// Bodies come from the `body` field only; content moved into other fields is not seen.
// Text columns are selected as HEX so tabs and newlines in bodies cannot break the tab-separated output.
// Drupal 8+ conventions: status 1 means published for nodes and comments alike; vocabularies are config
// entities, and the baseline names them by label, so the label is read from the `config` table.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildStored } from '../../lib/stored.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const projectDir = path.resolve(arg('--project-dir', process.cwd()));
const out = path.resolve(arg('--out', path.join(process.cwd(), 'tmp', 'stored-target.json')));

const HEX = new Set(['title', 'body', 'subject', 'name', 'comment', 'vid', 'type', 'data']);
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

// A site with no body field yet (a fresh 11.4 install has none until a content type adds it) has empty bodies.
const hasBody = query(`SHOW TABLES LIKE 'node\\_\\_body'`).length > 0;
const nodes = query(`
  SELECT n.nid, HEX(n.type) AS type, n.status, HEX(n.title) AS title, n.created, ${hasBody ? 'HEX(b.body_value)' : "''"} AS body
  FROM node_field_data n
  ${hasBody ? 'LEFT JOIN node__body b ON b.entity_id = n.nid AND b.langcode = n.langcode AND b.deleted = 0 AND b.delta = 0' : ''}
  WHERE n.default_langcode = 1 ORDER BY n.nid`);
// The comment's own name, or its author's for comments stored without one.
const comments = query(`
  SELECT c.cid, c.entity_id AS nid, c.status, HEX(c.subject) AS subject, HEX(COALESCE(NULLIF(c.name, ''), u.name)) AS name,
    c.created, HEX(cb.comment_body_value) AS comment
  FROM comment_field_data c
  LEFT JOIN comment__comment_body cb ON cb.entity_id = c.cid AND cb.langcode = c.langcode AND cb.deleted = 0
  LEFT JOIN users_field_data u ON u.uid = c.uid AND u.default_langcode = 1
  WHERE c.entity_type = 'node' AND c.default_langcode = 1 ORDER BY c.cid`);
const terms = query(`SELECT HEX(vid) AS vid, HEX(name) AS name FROM taxonomy_term_field_data WHERE default_langcode = 1`);
// Vocabulary labels (the `name` key) from the serialized config: ...s:4:"name";s:N:"<label>";...
const labels = new Map(
  query(`SELECT HEX(name) AS name, HEX(data) AS data FROM config WHERE collection = '' AND name LIKE 'taxonomy.vocabulary.%'`).map((r) => {
    const m = /s:4:"name";s:(\d+):"/.exec(r.data);
    const label = m ? Buffer.from(r.data, 'utf8').subarray(Buffer.byteLength(r.data.slice(0, m.index + m[0].length))).subarray(0, Number(m[1])).toString('utf8') : '';
    return [r.name.replace('taxonomy.vocabulary.', ''), label];
  }),
);

const stored = buildStored({
  platform: 'drupal11',
  nodes: nodes.map((n) => ({ sourceNid: n.nid, type: n.type, published: n.status === '1', title: n.title, created: n.created, bodyHtml: n.body })),
  comments: comments.map((c) => ({
    sourceCid: c.cid, sourceNid: c.nid, published: c.status === '1', subject: c.subject, name: c.name, created: c.created, commentHtml: c.comment,
  })),
  terms: terms.map((t) => ({ vocabulary: labels.get(t.vid) || t.vid, name: t.name })),
});

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), ...stored }, null, 1) + '\n');
console.log(`Stored content: ${JSON.stringify(stored.counts)}`);
console.log(`Body lines: ${stored.nodes.reduce((s, n) => s + n.lines.length, 0)}, comment lines: ${stored.comments.reduce((s, c) => s + c.lines.length, 0)}`);
console.log(`Wrote ${out}`);
