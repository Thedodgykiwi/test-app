// App menu (top-right): theme (Light / Auto / Dark), Settings panel,
// and the version number at the bottom, which opens "What's new".
// Works with or without Google sign-in; account.js adds the photo, name and
// Sign in / Sign out when sign-in is switched on.
//
// Preferences are kept on this device. Every app on <user>.github.io shares
// one browser storage, so the key includes the app's folder name.
// (index.html applies them before the page draws, so there's no flash.)
(() => {
  const PREFS_KEY = `prefs:${location.pathname.split('/')[1] || 'app'}`;
  // The app's default accent is the data-accent on <html> in index.html.
  const DEFAULTS = { theme: 'auto', textSize: 'standard', accent: document.documentElement.dataset.accent || 'blue' };
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
  const prefs = load();
  const root = document.documentElement;
  const STAGE = window.STAGE || 'local';
  const STAGE_NAMES = { main: 'Production', staging: 'Staging', alpha: 'Alpha', dev: 'Dev', local: 'Local' };
  const $ = (id) => document.getElementById(id);

  // ---- Preferences (theme, text size): radio-style button groups ----------
  function applyPrefs() {
    root.dataset.theme = prefs.theme;
    root.dataset.textSize = prefs.textSize;
    root.dataset.accent = prefs.accent;
    document.querySelectorAll('[data-pref]').forEach((group) => {
      group.querySelectorAll('[data-value]').forEach((b) => {
        const on = b.dataset.value === prefs[group.dataset.pref];
        b.setAttribute('aria-checked', on);
        b.tabIndex = on ? 0 : -1;
      });
    });
  }
  document.querySelectorAll('[data-pref]').forEach((group) => {
    const pick = (b) => {
      prefs[group.dataset.pref] = b.dataset.value;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ }
      applyPrefs();
    };
    group.addEventListener('click', (e) => { const b = e.target.closest('[data-value]'); if (b) pick(b); });
    group.addEventListener('keydown', (e) => {  // arrow keys move between options
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const opts = [...group.querySelectorAll('[data-value]')];
      const next = opts[(opts.indexOf(document.activeElement) + step + opts.length) % opts.length];
      pick(next); next.focus();
    });
  });
  applyPrefs();

  // ---- Menu open / close ----------------------------------------------------
  const box = $('account'), btn = $('account-btn'), menu = $('account-menu');
  const setMenu = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); };
  btn.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) setMenu(false); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); btn.focus(); }
  });
  window.AppMenu = { close: () => setMenu(false) };

  // ---- Panels (Settings, What's new) -----------------------------------------
  // <dialog> handles focus and Escape; a tap on the dimmed backdrop closes it.
  document.querySelectorAll('dialog.sheet').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });
  $('styleguide-link').hidden = STAGE === 'main';
  $('open-settings').addEventListener('click', () => { setMenu(false); $('settings').showModal(); });

  // ---- Version + What's new (releases.json, written per stage by the deploy) --
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // "(#12)" at the end of a note = the GitHub issue it relates to: a small pill
  // in that issue's label colour (from releases.json "issues"), not a link.
  function pill(n) {
    const info = data?.issues?.[n] || {};
    const color = /^[0-9a-f]{6}$/i.test(info.color || '') ? info.color : null;
    if (!color) return `<span class="issue-pill" title="Issue #${n}">#${n}</span>`;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;   // dark or white text, whichever reads better
    const text = (lum + 0.05) / 0.0637 >= 1.05 / (lum + 0.05) ? '#1d1f23' : '#fff';
    const label = info.label ? `${esc(info.label)} ` : '';
    return `<span class="issue-pill" style="background:#${color};color:${text};border-color:transparent" title="Issue #${n}">${label}#${n}</span>`;
  }
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\s*\(#(\d+)\)/g, (m, n) => `&nbsp;${pill(n)}`);
  function markdown(src) {  // ## / ### headings, "- " bullets, paragraphs, **bold**
    const out = []; let list = null, para = null;
    const flush = () => {
      if (para) { out.push(`<p>${inline(para.join(' '))}</p>`); para = null; }
      if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; }
    };
    for (const raw of src.split('\n')) {
      const line = raw.trimEnd(), h = line.match(/^(#{2,3})\s+(.*)/);
      if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
      else if (/^\s*[-*]\s+/.test(line)) { if (para) flush(); (list ||= []).push(line.replace(/^\s*[-*]\s+/, '')); }
      else if (!line.trim()) flush();
      else if (list && /^\s+/.test(raw)) list[list.length - 1] += ' ' + line.trim();
      else { if (list) flush(); (para ||= []).push(line.trim()); }
    }
    flush();
    return out.join('');
  }
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  let data = null;
  const loaded = fetch('releases.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => { data = d; showVersion(); });

  function showVersion() {
    const latest = data?.releases?.[0], recent = data?.recent?.[0];
    let label = 'Local copy';
    if (latest?.version) label = `Version ${latest.version.replace(/^v/, '')}`;
    else if (latest) label = `${STAGE_NAMES[STAGE] || STAGE} · ${latest.sha}`;
    else if (recent) label = `${STAGE_NAMES[STAGE] || STAGE} build ${recent.sha}`;
    else if (data) label = STAGE_NAMES[STAGE] || STAGE;
    $('version-btn').textContent = `${label} · What's new`;
  }
  showVersion();

  function render() {
    if (!data) return "<p class=\"muted\">Release notes appear here once this version is published to one of the stages. (You're looking at a local copy.)</p>";
    if (data.releases?.length) {
      return data.releases.map((r) => `<article class="release${r.rolled_back ? ' rolled-back' : ''}">
        <p class="release-meta">${day(r.date)}${r.version ? ` · ${esc(r.version)}` : ''}${r.rolled_back ? ' · rolled back' : ''}</p>
        ${markdown(r.notes || '')}</article>`).join('');
    }
    if (data.recent?.length) {
      return `<p class="muted">${esc(STAGE_NAMES[STAGE] || STAGE)} holds work in progress, so this is a list of the latest changes; they get proper release notes when they move on to Alpha.</p>
        <ul class="recent">${data.recent.map((c) => `<li>${esc(c.title)} <small>${day(c.date)}</small></li>`).join('')}</ul>`;
    }
    return `<p class="muted">No releases in ${esc(STAGE_NAMES[STAGE] || STAGE)} yet.</p>`;
  }
  $('version-btn').addEventListener('click', async () => {
    setMenu(false);
    await loaded;
    $('whats-new-body').innerHTML = render();
    $('whats-new').showModal();
  });
})();
