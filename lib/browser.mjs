// Shared set-up for the browser tiers (visible, layout) and the layout exporter.
//
// config.browser.blockHosts: hosts whose requests the test browser aborts. For third-party services
// whose terms forbid automated or bulk use, and that the checks do not depend on. hobobiker.com
// (2026-10-25) draws its maps with OpenStreetMap tiles: the browser tiers load hundreds of map pages per
// run, and tile.openstreetmap.org answered every tile with 429 after a day of runs, in line with its tile
// usage policy (https://operations.osmfoundation.org/policies/tiles/). The tiles sit inside a fixed-size
// map box, so what the tiers measure does not depend on them.

// Abort every request from `target` (a Page or a BrowserContext) to a host in `hosts` or a subdomain of
// one. Only those requests are intercepted. Returns the number of hosts blocked.
export async function blockHosts(target, hosts = []) {
  const list = [...new Set(hosts)].map((h) => h.toLowerCase());
  if (!list.length) return 0;
  const blocked = (url) => list.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  await target.route(blocked, (route) => route.abort('blockedbyclient'));
  return list.length;
}
