// Service worker: lets the app open without a connection.
// Registered by pwa.js. Each stage has its own (its scope is the stage's
// folder), and Production's ignores the test stages' folders inside it.
//
// How it fetches:
// - The page itself: network first (always the newest when online), the
//   saved copy when offline.
// - Files with ?v=<build> (the deploy adds this to CSS/JS/icons): saved copy
//   first; a new build has new addresses, so they're never stale.
// - Other files from this app (e.g. releases.json, local copies without
//   ?v=): network first, saved copy when offline.
// - The Firebase library from gstatic (its address includes its version):
//   saved copy first, so sign-in code loads offline too.
// - Everything else (Google sign-in, the database): left to the browser.
const CACHE = 'app-' + new URL(self.registration.scope).pathname;
const SCOPE = self.registration.scope;
const OTHER_STAGES = /\/(dev|alpha|staging|pipeline)\//;

// Save the page and every versioned file it links to, ready for offline use.
// Runs when the worker installs AND on every visit (pwa.js asks), so an
// interrupted first save is repaired. (iPhone: a Home Screen app has its own
// storage, separate from Safari, so it saves its own copy on first open.)
async function saveForOffline() {
  const cache = await caches.open(CACHE);
  const res = await fetch(SCOPE, { cache: 'no-store' });
  if (!res.ok) return false;
  const html = await res.clone().text();
  const files = [...html.matchAll(/(?:href|src)="([^":]+\?v=[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href);
  await Promise.all(files.map(async (u) => { if (!(await cache.match(u))) await cache.add(u).catch(() => {}); }));
  await cache.put(SCOPE, res);   // page last: it only counts as saved once its files are
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(saveForOffline().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg !== 'save-for-offline' && msg.type !== 'save-for-offline') return;
  // Also save the files the page actually loaded (e.g. vendor/ and app/ modules,
  // which are imported by name rather than linked from the HTML).
  const extra = (msg.urls || []).filter((u) => u.startsWith(SCOPE) && !OTHER_STAGES.test(u.slice(SCOPE.length - 1)));
  event.waitUntil(saveForOffline().catch(() => false).then(async (ok) => {
    const cache = await caches.open(CACHE);
    await Promise.all(extra.map(async (u) => { if (!(await cache.match(u))) await cache.add(u).catch(() => {}); }));
    return ok;
  }).then(async (ok) => {
    event.source?.postMessage({ type: 'offline-ready', ok: ok && !!(await (await caches.open(CACHE)).match(SCOPE)) });
  }));
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Connection checks (pwa.js) must really reach the server: never answer them from the saved copy.
  if (url.searchParams.has('connection-check')) return;
  if (req.method !== 'GET') return;
  const own = url.href.startsWith(SCOPE);
  // Production's scope contains the test stages: leave their requests alone.
  if (own && OTHER_STAGES.test(url.pathname.slice(new URL(SCOPE).pathname.length - 1))) return;

  if (req.mode === 'navigate' && own) return event.respondWith(networkFirst(req, SCOPE));
  if (own && url.searchParams.has('v')) return event.respondWith(cacheFirst(req, true));
  if (own) return event.respondWith(networkFirst(req));
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return event.respondWith(cacheFirst(req));
});

async function networkFirst(req, key = req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const saved = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (saved) return saved;
    // Never a blank screen: explain instead (iPhone Home Screen apps show nothing on errors).
    if (req.mode === 'navigate') return new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    throw err;
  }
}

const OFFLINE_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;background:#f4f5f7;color:#1d1f23}
main{max-width:360px;text-align:center}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#3b5bdb;color:#fff}</style></head>
<body><main><h1>You're offline</h1><p>This app hasn't been saved for offline use on this device yet.
Open it once with a connection and wait for <b>"Ready to use offline"</b> in its menu.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`;

async function cacheFirst(req, dropOldBuilds = false) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) {
    if (dropOldBuilds) {  // forget older builds of the same file
      const path = new URL(req.url).pathname;
      for (const k of await cache.keys()) {
        if (new URL(k.url).pathname === path && k.url !== req.url) cache.delete(k);
      }
    }
    cache.put(req, res.clone());
  }
  return res;
}
