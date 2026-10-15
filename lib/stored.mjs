// Stored-content tier: what the DATABASE holds, independent of what renders.
//
// The kit's other tiers compare what a visitor sees. An old site often stores a lot it never shows
// (on hobobiker.com: 447 comments behind a disabled module, 85 nodes whose module is gone, 18
// unpublished book pages). A static archive may legitimately leave all of that behind. A CMS rebuild
// must not lose it silently, so this tier compares stored records and fails only for the targets
// named in config.stored.enforceFor (default ['drupal11']); for any other target it reports.
//
// Contract: an exporter for any platform produces RAW records (below); buildStored() turns them into
// the comparable form. The Drupal 6 exporter is scripts/stored-exporters/drupal6.mjs. Another exporter
// must produce the same raw shape, mapping each record back to its source ID (sourceNid,
// sourceCid), for example from the Migrate API's map tables.
//
//   raw = {
//     platform: 'drupal6',
//     nodes:    [{ sourceNid, type, published, title, created, bodyHtml }],
//     comments: [{ sourceCid, sourceNid, published, subject, name, created, commentHtml }],
//     terms:    [{ vocabulary, name }],
//   }
//
// Nothing here knows about any CMS. Exporters live in scripts/stored-exporters/ (one per platform).
// See docs/stored-tier.md.

import * as cheerio from 'cheerio';

const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr,td,th,dt,dd,figcaption,div,section,article,table,ul,ol';

export const normalizeText = (s) =>
  String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Stored HTML (or plain text with line breaks) to text lines: one per block or <br> or newline.
// Markup is irrelevant here; only the words a migration must carry over count. Script and style
// bodies are dropped; PHP source is kept as text (it IS what is stored).
export function textLines(html) {
  // An HTML parser treats <?php ... ?> as a processing instruction and drops it. It is stored
  // content (the tripinfo pages are nothing else), so escape it into text first.
  const escaped = String(html ?? '').replace(/<\?php[\s\S]*?(\?>|$)/g, (m) => m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const $ = cheerio.load(`<div id="__root">${escaped}</div>`, null, false);
  const root = $('#__root');
  root.find('script,style').remove();
  root.find('br').replaceWith('\n');
  root.find(BLOCK).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return root
    .text()
    .split('\n')
    .map(normalizeText)
    .filter((l) => l.length > 0);
}

export function buildStored(raw) {
  const nodes = raw.nodes
    .map((n) => ({
      sourceNid: String(n.sourceNid),
      type: n.type,
      published: !!n.published,
      title: normalizeText(n.title),
      created: Number(n.created),
      lines: textLines(n.bodyHtml),
    }))
    .sort((a, b) => Number(a.sourceNid) - Number(b.sourceNid));
  const comments = raw.comments
    .map((c) => ({
      sourceCid: String(c.sourceCid),
      sourceNid: String(c.sourceNid),
      published: !!c.published,
      subject: normalizeText(c.subject),
      name: normalizeText(c.name),
      created: Number(c.created),
      lines: textLines(c.commentHtml),
    }))
    .sort((a, b) => Number(a.sourceCid) - Number(b.sourceCid));
  const terms = raw.terms
    .map((t) => ({ vocabulary: normalizeText(t.vocabulary), name: normalizeText(t.name) }))
    .sort((a, b) => `${a.vocabulary}\u0000${a.name}`.localeCompare(`${b.vocabulary}\u0000${b.name}`));
  return {
    platform: raw.platform,
    counts: {
      nodes: nodes.length,
      publishedNodes: nodes.filter((n) => n.published).length,
      comments: comments.length,
      publishedComments: comments.filter((c) => c.published).length,
      terms: terms.length,
    },
    nodes,
    comments,
    terms,
  };
}

// What the baseline record had and the target record lacks. Same one-directional rule as the
// semantic tier: extra lines on the target are fine.
export function compareNode(base, target) {
  if (!target) return [{ kind: 'stored-node', item: `node ${base.sourceNid} (${base.type}) "${base.title}" is missing` }];
  const diffs = [];
  if (normalizeText(target.title) !== base.title) diffs.push({ kind: 'stored-title', item: `title "${base.title}" became "${target.title}"` });
  if (!!target.published !== base.published) diffs.push({ kind: 'stored-status', item: `published ${base.published} became ${!!target.published}` });
  const have = new Set(target.lines);
  for (const l of base.lines) if (!have.has(l)) diffs.push({ kind: 'stored-body', item: l });
  return diffs;
}

export function compareComment(base, target) {
  if (!target) return [{ kind: 'stored-comment', item: `comment ${base.sourceCid} on node ${base.sourceNid} by ${base.name} is missing` }];
  const diffs = [];
  if (String(target.sourceNid) !== base.sourceNid) diffs.push({ kind: 'stored-comment', item: `comment ${base.sourceCid} moved from node ${base.sourceNid} to ${target.sourceNid}` });
  if (!!target.published !== base.published) diffs.push({ kind: 'stored-status', item: `comment ${base.sourceCid} published ${base.published} became ${!!target.published}` });
  if (normalizeText(target.subject) !== base.subject) diffs.push({ kind: 'stored-comment', item: `comment ${base.sourceCid} subject "${base.subject}" became "${target.subject}"` });
  const have = new Set(target.lines);
  for (const l of base.lines) if (!have.has(l)) diffs.push({ kind: 'stored-comment', item: `comment ${base.sourceCid}: ${l}` });
  return diffs;
}
