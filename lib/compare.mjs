// Compare a frozen baseline record against what a target page shows. Returns a list of
// differences; an empty list means "nothing the baseline recorded is missing".
//
// Direction matters: we only report things the BASELINE had that the TARGET lacks. Extra
// content on the target (a new theme's chrome, a footer, added features) is never a failure.
// That is what makes the same suite usable against a static export and a Drupal 11 rebuild.
//
// Each difference is { kind, item } so an expected-differences allowlist can name it.
//
//   kind: 'status' | 'title' | 'lines' | 'images' | 'links' | 'menu' | 'assets'

import { normalizeText } from './extract.mjs';

export function compareSemantic(base, target, { knownPaths, checkLinks = true } = {}) {
  const diffs = [];

  // Title: the page's primary heading must show up in the document title or any heading.
  if (base.primaryHeading) {
    const needle = base.primaryHeading.toLowerCase();
    const haystack = [target.title, ...target.headings].join(' | ').toLowerCase();
    if (!haystack.includes(needle)) {
      diffs.push({ kind: 'title', item: base.primaryHeading });
    }
  }

  // Lines of main content: each must appear in the target's text.
  for (const line of base.lines) {
    if (!target.text.includes(line)) diffs.push({ kind: 'lines', item: line });
  }

  // Images: matched by file name, since derivative paths and hostnames legitimately change.
  const targetImages = new Set(target.images.map((i) => i.name));
  const seenImg = new Set();
  for (const img of base.images) {
    if (seenImg.has(img.name)) continue;
    seenImg.add(img.name);
    if (!targetImages.has(img.name)) diffs.push({ kind: 'images', item: img.name });
  }

  // Links: internal ones are only asserted when they point at something the baseline knows
  // about (a captured page or asset). Links to dynamic/unmapped paths are reported at export
  // time instead of failing here. External links must be preserved exactly.
  if (checkLinks) {
    const targetKeys = new Set(target.links.map((l) => l.key));
    const seen = new Set();
    for (const l of base.links) {
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      if (l.internal && knownPaths && !knownPaths.has(l.key)) continue;
      if (!targetKeys.has(l.key)) diffs.push({ kind: 'links', item: l.key });
    }
  }

  // Menus: each baseline item needs a link to the same path with the same text.
  const targetPairs = new Set(target.links.map((l) => `${l.key}\u0000${l.text}`));
  for (const [name, items] of Object.entries(base.menus ?? {})) {
    for (const m of items) {
      if (!targetPairs.has(`${m.key}\u0000${normalizeText(m.text)}`)) {
        diffs.push({ kind: 'menu', item: `${name}: ${m.text} -> /${m.key}` });
      }
    }
  }

  return diffs;
}

// Split diffs into those covered by the reviewed expected-differences list and the rest.
// Entries: { path: '<path>' | '*', kind: '<kind>' | '*', match?: '<substring>', reason: '...' }
// Returns { unexpected, allowed, unusedEntries } where unusedEntries lets a run flag a stale
// allowlist (an entry that no longer matches anything).
export function applyExpectedDifferences(pagePath, diffs, entries, usage = new Map()) {
  const unexpected = [];
  const allowed = [];
  for (const d of diffs) {
    const idx = entries.findIndex(
      (e) =>
        (e.path === '*' || e.path === pagePath) &&
        (e.kind === '*' || e.kind === d.kind) &&
        (!e.match || String(d.item).includes(e.match))
    );
    if (idx >= 0) {
      usage.set(idx, (usage.get(idx) ?? 0) + 1);
      allowed.push({ ...d, reason: entries[idx].reason });
    } else {
      unexpected.push(d);
    }
  }
  return { unexpected, allowed, usage };
}
