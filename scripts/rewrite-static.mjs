#!/usr/bin/env node
// Make a crawled static copy self-contained: rewrite every reference to the SOURCE site so the
// archive no longer depends on it.
//
//   node kit/scripts/rewrite-static.mjs --dir <public> --root <test dir> --rules <rules.json> [--strict]
//
// A crawler only rewrites links to pages it downloaded. Everything else stays an absolute URL on
// the site that was crawled (comment permalinks, login links, dynamic routes). This script handles
// those, deterministically, and prints a count per decision so a change in the numbers is visible.
//
// Precedence, per reference to a source host:
//   1. The original already had this reference dead or restricted (recorded in the baseline): keep
//      it exactly that way, but as a root-relative URL. We reproduce the site; we do not repair it.
//   2. A rule from the rules file (first match wins).
//   3. The target exists in the static copy: make the URL root-relative.
//   4. Otherwise a link is "unwrapped" (the element goes, its text stays). Any other kind of
//      reference is reported as unresolved, and with --strict the script exits 1.
//
// Rules file: { "hosts": ["prep-host.ddev.site"], "rules": [   (the baseline's host and the site's own
//   domains from config.ownDomains are always included; list the crawled copy's host here)
//   { "name": "...", "match": "<regex on the site-relative path+query>", "action": "anchor"|"unwrap"|"relative"|"remove",
//     "anchor": "comment-$1" } ] }
//   remove  deletes the element (for example a feed-discovery <link> in the head).
//   anchor  points at #<anchor> on this page if it has that id, else on the mirrored page that does,
//           else the link is unwrapped. $1.. are the regex's capture groups.
//
// Only .html files under --dir are changed. The kit never touches anything outside it. An .html file
// that is an uploaded file (in the baseline's assets) gets exact URL replacements only, so every other
// byte stays as the original served it.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { internalKey } from '../lib/references.mjs';

const argv = process.argv.slice(2);
const get = (f, d) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);
const dir = path.resolve(get('--dir', ''));
const root = path.resolve(get('--root', process.cwd()));
const rulesFile = get('--rules', null);
const strict = argv.includes('--strict');
if (!get('--dir', null) || !rulesFile) {
  console.error('Usage: rewrite-static.mjs --dir <public> --root <test dir> --rules <rules.json> [--strict]');
  process.exit(2);
}
const config = JSON.parse(readFileSync(rulesFile, 'utf8'));
const rules = (config.rules ?? []).map((r) => ({ ...r, re: new RegExp(r.match) }));

// What the original explicitly had dead or restricted, anywhere on any page.
const index = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));

// Hosts whose references are rewritten: the rules file's hosts (the copy that was crawled), plus,
// always, the host the baseline was captured from and the site's own public domains (with and
// without www). Without these defaults an empty rules file rewrote nothing and said so only as "0".
const hosts = new Set(config.hosts ?? []);
hosts.add(new URL(index.baseUrl).host);
for (const d of index.ownDomainReferences?.domains ?? []) {
  hosts.add(d);
  hosts.add(`www.${d}`);
}
console.log(`rewrite-static: rewriting references to ${[...hosts].sort().join(', ')}`);
const originalDead = new Set();
for (const p of index.pages) {
  const rec = JSON.parse(readFileSync(path.join(root, 'baseline/semantic', p.file), 'utf8'));
  for (const x of rec.references?.internalNonOk ?? []) originalDead.add(x.key);
}

const htmlFiles = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const full = path.join(d, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.html')) htmlFiles.push(full);
  }
})(dir);

// The URL key a saved file answers to: content/x.html -> content/x, blog?page=1.html -> blog?page=1,
// index.html -> ''.
const fileKey = (full) => {
  const rel = path.relative(dir, full).split(path.sep).join('/');
  return rel.replace(/\.html$/, '').replace(/(^|\/)index$/, '');
};
const mirrored = new Set(htmlFiles.map(fileKey));

// Which pages carry each comment id, so a permalink can be pointed at the page that has it.
const commentPages = new Map();
for (const f of htmlFiles) {
  const key = fileKey(f);
  for (const m of readFileSync(f, 'utf8').matchAll(/\bid="(comment-\d+)"/g)) {
    (commentPages.get(m[1]) ?? commentPages.set(m[1], []).get(m[1])).push(key);
  }
}

const REFS = [['a', 'href'], ['area', 'href'], ['link', 'href'], ['img', 'src'], ['script', 'src'], ['iframe', 'src'], ['form', 'action']];
const counts = {};
const unresolved = [];
const bump = (k) => (counts[k] = (counts[k] ?? 0) + 1);
const existsInCopy = (key) => {
  if (mirrored.has(key)) return true;
  const p = decodeURIComponent(key.split('?')[0]);
  return p !== '' && existsSync(path.join(dir, p)) && statSync(path.join(dir, p)).isFile();
};

// Uploaded files (baseline assets) that are also HTML, by their path under --dir.
const uploads = new Set((index.assets ?? []).map((a) => decodeURIComponent(a.split('?')[0]).replace(/^\/+/, '')));

let changedFiles = 0;
let uploadsChanged = 0;
for (const file of htmlFiles) {
  const pageKey = fileKey(file);
  const fileRel = path.relative(dir, file).split(path.sep).join('/');
  const $ = cheerio.load(readFileSync(file, 'utf8'));
  let changed = false;
  let structural = false;
  const edits = [];

  for (const [tag, attr] of REFS) {
    $(`${tag}[${attr}]`).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!/^https?:/i.test(raw ?? '')) return;
      let url;
      try { url = new URL(raw); } catch { return; }
      if (!hosts.has(url.host)) return;

      const key = internalKey(url);
      const rel = url.pathname + url.search + (url.hash ?? '');
      // In an uploaded file only an attribute value can change (see below); record each one.
      const setAttr = (v) => { $(el).attr(attr, v); edits.push([raw, v]); };
      const unwrap = () => { $(el).replaceWith($(el).contents()); structural = true; };
      const remove = () => { $(el).remove(); structural = true; };
      const canUnwrap = tag === 'a' || tag === 'area';

      if (originalDead.has(key)) { setAttr(rel); bump('kept as the original had it (dead or restricted), made relative'); changed = true; return; }

      const changedBefore = changed;
      for (const rule of rules) {
        const m = key.match(rule.re);
        if (!m) continue;
        changed = true;
        if (rule.action === 'remove') { remove(); bump(rule.name ?? 'remove'); return; }
        if (rule.action === 'unwrap' && canUnwrap) { unwrap(); bump(rule.name ?? 'unwrap'); return; }
        if (rule.action === 'relative') { setAttr(rel); bump(rule.name ?? 'relative'); return; }
        if (rule.action === 'anchor' && canUnwrap) {
          const id = (rule.anchor ?? '').replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
          if ($(`[id="${id}"]`).length) { setAttr(`#${id}`); bump(`${rule.name ?? 'anchor'} (same page)`); return; }
          const other = (commentPages.get(id) ?? []).sort()[0];
          if (other !== undefined) { setAttr(`/${other}#${id}`); bump(`${rule.name ?? 'anchor'} (another page)`); return; }
          unwrap(); bump(`${rule.name ?? 'anchor'} (target not in the copy; unwrapped)`); return;
        }
        changed = changedBefore; // rule matched but could not apply to this kind of reference: fall through
        break;
      }

      if (existsInCopy(key)) { setAttr(rel); bump('target is in the copy, made relative'); changed = true; return; }
      if (canUnwrap) { unwrap(); bump('not in the copy: link removed, text kept'); changed = true; return; }
      unresolved.push(`${path.relative(dir, file)}: <${tag} ${attr}> ${raw}`);
    });
  }
  if (!changed) continue;
  if (!uploads.has(fileRel)) { writeFileSync(file, $.html()); changedFiles++; continue; }
  // An uploaded file (a legacy page under files/) is served byte for byte, so it is not re-serialized:
  // each changed URL is replaced as exact text, reading and writing bytes unchanged (latin1), and nothing
  // else in the file moves. Removing or unwrapping an element cannot be done that way: report it.
  if (structural) { unresolved.push(`${fileRel}: an uploaded file would need an element removed; left unchanged`); continue; }
  let text = readFileSync(file, 'latin1');
  let applied = 0;
  // One replacement per distinct URL: split/join already changes every occurrence of it.
  for (const [from, to] of new Map(edits.reverse())) {
    const f =[from, from.replace(/&/g, '&amp;')].find((s) => text.includes(s));
    if (!f) { unresolved.push(`${fileRel}: ${from} (in an uploaded file; not found as written)`); continue; }
    text = text.split(f).join(to);
    applied++;
  }
  if (applied) { writeFileSync(file, text, 'latin1'); changedFiles++; uploadsChanged++; }
}

console.log(`rewrite-static: ${changedFiles} of ${htmlFiles.length} page(s) changed` +
  (uploadsChanged ? `, ${uploadsChanged} of them uploaded files (exact URL replacements only)` : ''));
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
if (unresolved.length) {
  console.log(`  UNRESOLVED ${unresolved.length}:`);
  unresolved.slice(0, 10).forEach((u) => console.log('    ' + u.slice(0, 160)));
  if (strict) process.exit(1);
}
