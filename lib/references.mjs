// Every URL a page refers to, anywhere in it (head and body): links, images, scripts,
// stylesheets, frames, forms, media. Used both when freezing the baseline (what did the original
// explicitly refer to?) and when checking a static target (does it refer to anything that is not
// static?). See docs/static-self-containment.md.

import * as cheerio from 'cheerio';
import { hostKey } from './extract.mjs';

// [selector, attribute] pairs that make the browser (or the visitor) follow a URL.
const REFERENCE_ATTRIBUTES = [
  ['a', 'href'], ['area', 'href'], ['link', 'href'], ['img', 'src'], ['script', 'src'],
  ['iframe', 'src'], ['frame', 'src'], ['embed', 'src'], ['object', 'data'], ['source', 'src'],
  ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'], ['input', 'src'],
  ['form', 'action'],
];
const SRCSET = [['img', 'srcset'], ['source', 'srcset']];

const SKIP = /^(#|mailto:|tel:|javascript:|data:|about:|blob:)/i;

// Returns [{ tag, attr, raw, url (URL object), internal (bool), own (bool) }]. `internal` means same
// origin as `baseOrigin`, or a host in `ownHosts` (hosts that are this site, flagged `own`). Fragments are dropped; everything else is kept exactly as resolved.
export function extractReferences(html, pageUrl, baseOrigin, ownHosts = new Set()) {
  const $ = cheerio.load(html);
  const out = [];
  const add = (tag, attr, raw) => {
    if (!raw) return;
    raw = raw.trim();
    if (!raw || SKIP.test(raw)) return;
    let url;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    const own = url.origin !== baseOrigin && ownHosts.has(hostKey(url.hostname));
    out.push({ tag, attr, raw, url, internal: url.origin === baseOrigin || own, own });
  };
  for (const [tag, attr] of REFERENCE_ATTRIBUTES) {
    $(`${tag}[${attr}]`).each((_, el) => add(tag, attr, $(el).attr(attr)));
  }
  for (const [tag, attr] of SRCSET) {
    $(`${tag}[${attr}]`).each((_, el) => {
      for (const part of ($(el).attr(attr) ?? '').split(',')) add(tag, attr, part.trim().split(/\s+/)[0]);
    });
  }
  return out;
}

// URLs on the given hosts named where extractReferences() does not look: inline <script> and <style>
// text, and every attribute that is not a reference attribute (data-*, style, onclick...). A Drupal
// page carries its settings as inline JSON (Drupal.settings), so a crawl can leave the source host
// there, escaped as https:\/\/host or https://host, where no link check sees it (hobobiker.com,
// 2026-10-24: 434 pages). Only URL-shaped mentions count (// before the host, a boundary after it),
// so prose such as "visit example.com" does not. `hosts` are compared without a leading www.
// Returns [{ where, url }].
export function findHostMentions(html, hosts) {
  const keys = [...new Set([...hosts].map(hostKey))].filter(Boolean);
  if (!keys.length) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:https?:)?//(?:www\\.)?(?:${keys.map(esc).join('|')})(?![\\w.-])[^\\s"'<>)\\\\]*`, 'gi');
  const unescape = (s) => s.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  const $ = cheerio.load(html);
  const out = [];
  const scan = (where, text) => {
    for (const m of unescape(text ?? '').matchAll(re)) out.push({ where, url: m[0] });
  };
  $('script:not([src]), style').each((_, el) => scan(`<${el.tagName}>`, $(el).text()));
  const handled = new Set([...REFERENCE_ATTRIBUTES, ...SRCSET].map(([t, a]) => `${t} ${a}`));
  $('*').each((_, el) => {
    for (const [attr, value] of Object.entries(el.attribs ?? {})) {
      if (!handled.has(`${el.tagName} ${attr}`)) scan(`<${el.tagName} ${attr}>`, value);
    }
  });
  return out;
}

// The comparable form of an EXTERNAL reference: the full URL without a fragment or a trailing slash.
export function externalKey(url) {
  return url.href.replace(/\/$/, '');
}

// The comparable form of an INTERNAL reference: a site-relative path plus query, with no leading
// slash, no index.html, no .html suffix (so /a/b, /a/b/ and /a/b.html are the same page).
export function internalKey(url) {
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    p = url.pathname;
  }
  p = p.replace(/^\/+/, '').replace(/(^|\/)index\.html?$/i, '').replace(/\.html?$/i, '').replace(/\/+$/, '');
  return p + url.search;
}
