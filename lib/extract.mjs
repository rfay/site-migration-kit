// Platform-independent extraction of what a visitor sees on a page.
//
// Two sides, deliberately asymmetric:
//
//   extractSource(html, ...)  runs ONCE, against the original site, to freeze a baseline.
//                             It needs per-site selectors (config.extract) to find the main
//                             content and the menus, because on the source we want to record
//                             the page's *content*, not its theme chrome.
//
//   extractTarget(html, ...)  runs against a migration target (static export, Drupal 11,
//                             anything). It needs NO selectors: it takes the whole <body>.
//                             The check is "everything in the baseline appears somewhere on
//                             the target page", so a new theme's extra chrome is harmless and
//                             a different markup structure cannot cause a false failure.
//
// Nothing here knows about any CMS. See docs/semantic-tier.md.

import * as cheerio from 'cheerio';

const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr,td,th,dt,dd,figcaption,div,section,article,header,footer,ul,ol,table,form,fieldset,nav,main,aside';

export function normalizeText(s) {
  return String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Collapse an href to a comparable key. Internal links become a site-relative path with no
// leading/trailing slash, no index.html and no .html suffix, so /blogs/jdoe, /blogs/jdoe/,
// /blogs/jdoe.html and /blogs/jdoe/index.html are the same page. External links keep their
// full URL (minus a trailing slash) so a hardcoded absolute URL baked into old content stays
// exactly what it was.
// Hosts that ARE this site (for example its production domain, when old content hardcodes absolute
// URLs to it). A link to one is an internal link, flagged `own`. Compared without a leading www.
export const hostKey = (h) => String(h ?? '').toLowerCase().replace(/^www\./, '');
export const ownHostSet = (domains = []) => new Set(domains.map(hostKey));

export function linkKey(href, pageUrl, baseOrigin, ownHosts = new Set()) {
  if (!href) return null;
  const raw = href.trim();
  if (raw === '' || raw.startsWith('#')) return null;
  let u;
  try {
    u = new URL(raw, pageUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { internal: false, key: raw };
  }
  const own = u.origin !== baseOrigin && ownHosts.has(hostKey(u.hostname));
  if (u.origin !== baseOrigin && !own) {
    return { internal: false, key: u.href.replace(/\/$/, '') };
  }
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    p = u.pathname;
  }
  p = p.replace(/^\/+/, '').replace(/(^|\/)index\.html?$/i, '').replace(/\.html?$/i, '').replace(/\/+$/, '');
  // `?page=0` is the first page, the same page as no query: Drupal 11 pagers link to it, Backdrop's do not.
  const q = new URLSearchParams(u.search);
  if (q.get('page') === '0') q.delete('page');
  const search = q.toString() ? `?${q.toString()}` : '';
  // An own-domain link keeps its original absolute URL, so a report can show what the content really said.
  return own ? { internal: true, own: true, url: u.href, key: p + search } : { internal: true, key: p + search };
}

export function imageName(src) {
  if (!src) return null;
  let p = src.split('#')[0].split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  const name = p.split('/').pop();
  return name ? name.toLowerCase() : null;
}

function stripNoise($, root, extraIgnore = []) {
  $(root).find('script,style,noscript,template').remove();
  for (const sel of extraIgnore) $(root).find(sel).remove();
}

// Text of an element with a newline at every block boundary and <br>, so that "lines" are
// stable across markup differences but a line never spans two blocks.
function linesOf($, root) {
  const clone = $(root).clone();
  clone.find('br').replaceWith('\n');
  clone.find(BLOCK).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return clone
    .text()
    .split('\n')
    .map(normalizeText)
    .filter((l) => l.length > 0);
}

function collectImages($, root) {
  const out = [];
  $(root).find('img').each((_, el) => {
    const src = $(el).attr('src');
    const name = imageName(src);
    if (name) out.push({ src, name, alt: normalizeText($(el).attr('alt') ?? '') });
  });
  return out;
}

function collectLinks($, root, pageUrl, baseOrigin, ownHosts = new Set()) {
  const out = [];
  $(root).find('a[href]').each((_, el) => {
    const k = linkKey($(el).attr('href'), pageUrl, baseOrigin, ownHosts);
    if (k) out.push({ ...k, text: normalizeText($(el).text()) });
  });
  return out;
}

// Frozen once, from the original site.
export function extractSource(html, { pageUrl, baseUrl, extract, ownDomains = [] }) {
  const ownHosts = ownHostSet(ownDomains);
  const baseOrigin = new URL(baseUrl).origin;
  const $ = cheerio.load(html);
  const documentTitle = normalizeText($('title').first().text());

  const titleEl = extract.title ? $(extract.title).first() : $('h1').first();
  const primaryHeading = normalizeText(titleEl.text());

  let contentRoot = null;
  for (const sel of [].concat(extract.content)) {
    const found = $(sel).first();
    if (found.length) {
      contentRoot = found;
      break;
    }
  }

  const ignore = ['form', ...(extract.ignore ?? [])];
  let lines = [];
  let images = [];
  let links = [];
  if (contentRoot) {
    const root = contentRoot.clone();
    stripNoise($, root, ignore);
    lines = linesOf($, root);
    images = collectImages($, root);
    links = collectLinks($, root, pageUrl, baseOrigin, ownHosts);
  }

  const menus = {};
  for (const [name, sel] of Object.entries(extract.menus ?? {})) {
    const m = $(sel).first();
    if (m.length) {
      menus[name] = collectLinks($, m, pageUrl, baseOrigin, ownHosts)
        .filter((l) => l.internal)
        .map((l) => ({ text: l.text, key: l.key }));
    }
  }

  return {
    title: documentTitle,
    primaryHeading,
    contentFound: !!contentRoot,
    lines,
    images,
    links,
    menus,
  };
}

// Run against any target. No site-specific knowledge.
export function extractTarget(html, { pageUrl, baseUrl, ownDomains = [] }) {
  const ownHosts = ownHostSet(ownDomains);
  const baseOrigin = new URL(baseUrl).origin;
  const $ = cheerio.load(html);
  const body = $('body').first().length ? $('body').first() : $.root();
  const wrapper = body.clone();
  stripNoise($, wrapper);

  const lines = linesOf($, wrapper);
  const headings = [];
  wrapper.find('h1,h2,h3,h4,h5,h6').each((_, el) => headings.push(normalizeText($(el).text())));

  return {
    title: normalizeText($('title').first().text()),
    headings,
    lines,
    text: normalizeText(lines.join(' ')),
    images: collectImages($, wrapper),
    links: collectLinks($, wrapper, pageUrl, baseOrigin, ownHosts),
  };
}
