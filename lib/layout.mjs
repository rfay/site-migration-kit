// Layout measurements: where things are on the page, not what they say.
//
// The semantic and visible tiers compare words, so a rebuild can lose a whole sidebar, push its content
// into a wide empty gutter or change every color, and still pass. This tier measures a few numbers in a
// real browser from the original, and checks that the target is "in the same ballpark".
//
// It does not use selectors on the target. Elements are FOUND BY THEIR TEXT: the baseline already knows
// the page's content lines, its sidebar lines and its header lines (config.extract.regions), so the same
// lines locate the same things on any theme. Positions are fractions of the viewport width, so the
// comparison does not depend on screen size. Tolerances are wide on purpose: this is meant to catch
// significant differences (a missing sidebar, one on the wrong side, a column pushed aside, a different
// palette), not to chase pixels.

export const VIEWPORT = { width: 1280, height: 900 };

export const DEFAULT_TOLERANCES = {
  contentLeft: 0.08, // content column's left edge, as a fraction of the viewport width
  contentWidthRatio: 0.5, // content width may differ by this much (0.5 = from half to one and a half times)
  sidebarWidthRatio: 0.5,
  sidebarCenter: 0.15, // sidebar centre position, as a fraction of the viewport width
  headerHeightRatio: 0.6,
  textColor: 80, // RGB distance (0 to 441)
  linkColor: 90,
  headerColor: 60,
  fontSizeRatio: 0.25,
};

// Runs inside the browser. Takes the lines to look for; returns plain numbers and strings.
export function measureInBrowser({ content, sidebar, header, heading }) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const BLOCK = 'p,li,div,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,dd,dt,article,section,aside,header,footer,main,nav,span,a';
  const W = window.innerWidth;
  const visible = (r) => r.width > 4 && r.height > 4;
  // The block-level element that holds the first text node containing the needle.
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = norm(n.nodeValue);
    if (t.length >= 4) textNodes.push({ n, t });
  }
  const blockOf = (el) => {
    let e = el;
    while (e && e !== document.body) {
      const d = getComputedStyle(e).display;
      if (d !== 'inline' && d !== 'contents') return e;
      e = e.parentElement;
    }
    return el;
  };
  const findAll = (line) => {
    const needle = norm(line).slice(0, 40);
    const out = [];
    for (const { n, t } of textNodes) {
      if (!t.includes(needle)) continue;
      const el = blockOf(n.parentElement);
      const r = el.getBoundingClientRect();
      if (visible(r)) out.push({ el, r, node: n });
      if (out.length >= 6) break;
    }
    return out;
  };
  const rgb = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
    return { r, g, b, a };
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return { color: c, height: e.getBoundingClientRect().height, tag: e.tagName };
    }
    return null;
  };
  const fontClass = (ff) => {
    const first = String(ff).split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (/(georgia|times|garamond|palatino|serif$|cambria|book)/.test(first) && !/sans/.test(first)) return 'serif';
    if (/(mono|courier|consolas|menlo)/.test(first)) return 'mono';
    if (/(helvetica|arial|sans|verdana|tahoma|segoe|roboto|open sans|lucida)/.test(first)) return 'sans';
    return 'other:' + first;
  };
  const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

  // Content column: the median left edge and width of the blocks holding the longest content lines.
  const prose = content.filter((l) => l.length >= 40).slice(0, 14);
  const contentBoxes = [];
  const contentEls = [];
  for (const line of prose) {
    const f = findAll(line)[0];
    if (f) {
      contentBoxes.push(f.r);
      contentEls.push(f);
    }
  }
  const contentLeft = median(contentBoxes.map((r) => r.left));
  const contentWidth = median(contentBoxes.map((r) => r.width));
  const out = {
    viewport: W,
    overflow: document.documentElement.scrollWidth > W + 2,
    content: contentBoxes.length ? { left: contentLeft / W, width: contentWidth / W, found: contentBoxes.length } : null,
  };

  // Sidebar: lines found OUTSIDE the content column (horizontally apart from it).
  if (out.content && sidebar.length) {
    const cl = contentLeft, cr = contentLeft + contentWidth;
    const boxes = [];
    for (const line of sidebar.filter((l) => l.length >= 8).slice(0, 14)) {
      const hit = findAll(line).find((h) => h.r.left >= cr - 2 || h.r.right <= cl + 2);
      if (hit) boxes.push(hit.r);
    }
    if (boxes.length >= Math.min(3, sidebar.length)) {
      const left = Math.min(...boxes.map((r) => r.left));
      const right = Math.max(...boxes.map((r) => r.right));
      out.sidebar = { left: left / W, width: (right - left) / W, side: left >= cr - 2 ? 'right' : 'left', found: boxes.length };
    } else {
      out.sidebar = null;
    }
  } else {
    out.sidebar = null;
  }

  // Header: the band behind the site name.
  const hl = header.find((l) => l.length >= 4);
  const hit = hl ? findAll(hl)[0] : null;
  if (hit) {
    const bg = bgOf(hit.el);
    out.header = bg ? { color: bg.color, height: bg.height } : null;
  } else {
    out.header = null;
  }

  // Colours and fonts of the first prose line, and the first link inside a prose block.
  const first = contentEls[0];
  if (first) {
    const cs = getComputedStyle(first.el);
    out.text = { color: rgb(cs.color), size: parseFloat(cs.fontSize), font: fontClass(cs.fontFamily) };
    const a = contentEls.map((c) => c.el.querySelector('a[href]')).find(Boolean);
    out.link = a ? { color: rgb(getComputedStyle(a).color) } : null;
  }
  if (heading) {
    const h = findAll(heading)[0];
    if (h) out.title = { font: fontClass(getComputedStyle(h.el).fontFamily), size: parseFloat(getComputedStyle(h.el).fontSize) };
  }
  return out;
}

// What to look for on a page, from its semantic baseline record.
export function layoutInputs(base) {
  return {
    content: base.lines ?? [],
    sidebar: base.regions?.sidebar?.lines ?? [],
    header: base.regions?.header?.lines ?? [],
    heading: base.primaryHeading ?? '',
  };
}

export async function measurePage(page, base) {
  return page.evaluate(measureInBrowser, layoutInputs(base));
}

const dist = (a, b) => (a && b ? Math.round(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)) : null);
const hex = (c) => (c ? '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') : 'none');
const pct = (x) => `${Math.round(x * 100)}%`;

// Differences the baseline measurement has that the target lacks or contradicts.
// Each is { kind: 'layout', item: '<what>' } so the expected-differences allowlist can name it.
export function compareLayout(base, target, tol = {}) {
  const t = { ...DEFAULT_TOLERANCES, ...tol };
  const d = [];
  const add = (item) => d.push({ kind: 'layout', item });
  if (target.overflow && !base.overflow) add('horizontal scrolling appears');

  if (base.content) {
    if (!target.content) add('content column could not be located');
    else {
      const dl = Math.abs(target.content.left - base.content.left);
      if (dl > t.contentLeft) add(`content column starts at ${pct(target.content.left)} of the width, original ${pct(base.content.left)}`);
      const r = target.content.width / base.content.width;
      if (r < 1 - t.contentWidthRatio || r > 1 + t.contentWidthRatio) {
        add(`content column is ${pct(target.content.width)} wide, original ${pct(base.content.width)}`);
      }
    }
  }

  if (base.sidebar) {
    if (!target.sidebar) add(`sidebar is missing (original: ${base.sidebar.side}, ${pct(base.sidebar.width)} wide)`);
    else {
      if (target.sidebar.side !== base.sidebar.side) add(`sidebar is on the ${target.sidebar.side}, original on the ${base.sidebar.side}`);
      const r = target.sidebar.width / base.sidebar.width;
      if (r < 1 - t.sidebarWidthRatio || r > 1 + t.sidebarWidthRatio) add(`sidebar is ${pct(target.sidebar.width)} wide, original ${pct(base.sidebar.width)}`);
      const c0 = base.sidebar.left + base.sidebar.width / 2;
      const c1 = target.sidebar.left + target.sidebar.width / 2;
      if (Math.abs(c0 - c1) > t.sidebarCenter) add(`sidebar centre at ${pct(c1)}, original ${pct(c0)}`);
    }
  }

  if (base.header && target.header) {
    const dc = dist(base.header.color, target.header.color);
    if (dc > t.headerColor) add(`header colour ${hex(target.header.color)}, original ${hex(base.header.color)}`);
    const r = target.header.height / base.header.height;
    if (r < 1 - t.headerHeightRatio || r > 1 + t.headerHeightRatio) add(`header is ${Math.round(target.header.height)}px tall, original ${Math.round(base.header.height)}px`);
  } else if (base.header && !target.header) {
    add('header band could not be located');
  }

  if (base.text && target.text) {
    if (dist(base.text.color, target.text.color) > t.textColor) add(`text colour ${hex(target.text.color)}, original ${hex(base.text.color)}`);
    if (base.text.font !== target.text.font) add(`body font is ${target.text.font}, original ${base.text.font}`);
    const r = target.text.size / base.text.size;
    if (r < 1 - t.fontSizeRatio || r > 1 + t.fontSizeRatio) add(`body text is ${target.text.size}px, original ${base.text.size}px`);
  }
  if (base.link?.color && target.link?.color && dist(base.link.color, target.link.color) > t.linkColor) {
    add(`link colour ${hex(target.link.color)}, original ${hex(base.link.color)}`);
  }
  if (base.title && target.title && base.title.font !== target.title.font) add(`title font is ${target.title.font}, original ${base.title.font}`);
  return d;
}
