// Works offline + install (option B from the mock-up):
// - registers the service worker (sw.js) so the app opens without a connection;
// - an orange strip while offline;
// - "A new version is ready. Reload" when a newer build has been deployed;
// - "Install app" in the menu (Android / desktop Chrome: the browser's own
//   install box; iPhone/iPad: a short "Add to Home Screen" how-to, because
//   Safari can't install from a button);
// - a one-time tip at the bottom from the 2nd visit on, until installed or
//   dismissed (✕ hides it for good on this device).
(() => {
  const $ = (id) => document.getElementById(id);
  const APP = location.pathname.split('/')[1] || 'app';
  const STAGE = window.STAGE || 'local';
  const KEY = `pwa:${APP}:${STAGE}`;   // all apps and stages share browser storage
  const state = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ } };
  state.visits = (state.visits || 0) + 1;
  save();

  // ---- Service worker -------------------------------------------------------
  // Every visit (online) asks the worker to (re)save the offline copy; the menu
  // then shows "Ready to use offline" so people know it's safe to go offline.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'offline-ready') $('offline-ready').hidden = !e.data.ok;
    });
    addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('sw.js');
        const reg = await navigator.serviceWorker.ready;
        const urls = performance.getEntriesByType('resource').map((r) => r.name.split('#')[0]);
        if (!offline) reg.active?.postMessage({ type: 'save-for-offline', urls });
        else $('offline-ready').hidden = false;   // offline and still running: it's saved
      } catch (err) { console.warn('Offline mode unavailable:', err); }
    });
  }

  // ---- Offline strip ----------------------------------------------------------
  // navigator.onLine alone isn't trustworthy (iPhone Home Screen apps can say
  // "online" in Airplane mode), so also ask the server with a tiny request the
  // service worker always lets through.
  const strip = $('offline-strip');
  let offline = !navigator.onLine, timer;
  function setOffline(off) {
    offline = off;
    strip.hidden = !off;
    document.body.classList.toggle('is-offline', off);
    clearTimeout(timer);
    if (off) timer = setTimeout(checkConnection, 30000);   // keep checking while offline
  }
  async function checkConnection() {
    if (!navigator.onLine) return setOffline(true);
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
      await fetch(`./?connection-check=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      setOffline(false);
    } catch { setOffline(true); }
  }
  addEventListener('online', checkConnection);
  addEventListener('offline', () => setOffline(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkConnection(); });
  setOffline(offline);
  checkConnection();

  // ---- New version check --------------------------------------------------------
  // The deploy stamps this build's files with ?v=<build>. Look at the live page
  // now and then (on load, and when the app comes back into view); if its files
  // carry a different build, offer a reload.
  const myBuild = new URL(document.currentScript.src).searchParams.get('v');
  async function checkForUpdate() {
    if (!myBuild || offline) return;   // local copies have no build number
    try {
      const html = await (await fetch('./', { cache: 'no-store' })).text();
      const live = html.match(/pwa\.js\?v=([\w-]+)/)?.[1];
      if (live && live !== myBuild) { $('update-bar').hidden = false; tip.hidden = true; }
    } catch { /* offline or blocked: try again later */ }
  }
  $('update-reload').addEventListener('click', () => location.reload());
  addEventListener('load', () => setTimeout(checkForUpdate, 3000));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

  // ---- Install ------------------------------------------------------------------
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad asking for the desktop site
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installEvent = null;   // Chrome/Edge/Android hand us this when the app can be installed
  const btn = $('install-btn'), tip = $('install-tip');

  function canInstall() { return !installed() && (isIOS || !!installEvent); }
  function refresh() {
    btn.hidden = !canInstall();
    $('install-label').textContent = isIOS ? 'Add to Home Screen' : 'Install app';
    $('install-tip-go').textContent = isIOS ? 'How?' : 'Install';
    $('install-tip-text').textContent = isIOS
      ? 'Add it to your Home Screen to open it full-screen, even offline.'
      : 'Install it to open it from your home screen, even offline.';
    // The tip: never on the first visit, never once dismissed or installed.
    tip.hidden = !(canInstall() && state.visits >= 2 && !state.tipDismissed);
  }

  async function install() {
    window.AppMenu?.close();
    if (isIOS) { $('ios-install').showModal(); return; }
    if (!installEvent) return;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    if (outcome === 'accepted') { state.tipDismissed = true; save(); }
    refresh();
  }

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; refresh(); });
  addEventListener('appinstalled', () => { installEvent = null; state.tipDismissed = true; save(); refresh(); toast('Installed. Find it on your home screen.'); });
  btn.addEventListener('click', install);
  $('install-tip-go').addEventListener('click', () => { tip.hidden = true; install(); });
  $('install-tip-x').addEventListener('click', () => {
    state.tipDismissed = true; save(); tip.hidden = true;
    toast('Got it. You can still install it from the menu.');
  });
  // Show the tip a moment after the page settles, not while it's loading.
  tip.hidden = true;
  setTimeout(refresh, 2500);
  btn.hidden = !canInstall();

  function toast(message, ms = 4000) {
    const el = $('toast');
    el.textContent = message; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
  }
})();
