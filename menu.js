// App menu (top-right): Settings panel (theme Light / Auto / Dark, accent colour,
// text size) and the version number at the bottom, which opens "What's new".
// Works with or without Google sign-in; account.js adds the photo, name and
// Sign in / Sign out when sign-in is switched on.
//
// Preferences are kept on this device. Every app on <user>.github.io shares
// one browser storage, so the key includes the app's folder name.
// (index.html applies them before the page draws, so there's no flash.)
(() => {
  const PREFS_KEY = `prefs:${location.pathname.split('/')[1] || 'app'}`;
  // The app's default accent is the data-accent on <html> in index.html.
  const DEFAULTS = { theme: 'auto', textSize: 'standard', accent: document.documentElement.dataset.accent || 'blue', listStyle: 'pills', swipeRight: 'star', swipeLeft: 'tomorrow', remindLead: '15', tickStyle: 'winner',
    summaryOn: '0', summaryTime: '08:00', summaryDays: 'all', summarySkip: '1' };   // daily summary (Issue #91)
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
    root.dataset.listStyle = prefs.listStyle;   // My Day / Important / Planned headings (Issue #71)
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
      applyPrefs(); dispatchEvent(new Event('prefschange'));   // app/main.js follows (reminder default, Issue #51)
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

  // ---- Swipe actions (Issue #81): what swiping a to-do right / left does ----------
  // The list of actions is shared with app/main.js (which does them) via window.SWIPE_ACTIONS.
  const SWIPE_ACTIONS = window.SWIPE_ACTIONS = {
    star:     { label: 'Star / unstar',    icon: 'star-fill',     help: 'Gold star on top of your list' },
    tomorrow: { label: 'Tomorrow / today', icon: 'arrow-right',   help: 'Sends it to tomorrow, or forward to today' },
    done:     { label: 'Done',             icon: 'check-circle',  help: 'Ticks it off' },
    delete:   { label: 'Delete',           icon: 'trash',         help: 'Removes it (Undo for a few seconds)' },
    priority: { label: 'Set priority',     icon: 'flag',          help: 'Opens High / Medium / Low / None' },
    myday:    { label: 'My Day',           icon: 'sun',           help: 'Adds to or takes out of My Day' },
    list:     { label: 'Move to a list',   icon: 'folder-simple', help: 'Opens a picker of your lists' },
    edit:     { label: 'Edit',             icon: 'pencil-simple', help: 'Opens the edit panel' },
    none:     { label: 'Nothing',          icon: 'x',             help: 'This direction does nothing' },
  };
  const swipeCur = () => ({ r: SWIPE_ACTIONS[prefs.swipeRight] ? prefs.swipeRight : 'star', l: SWIPE_ACTIONS[prefs.swipeLeft] ? prefs.swipeLeft : 'tomorrow' });
  const setSwipe = (side, v) => {
    prefs[side === 'r' ? 'swipeRight' : 'swipeLeft'] = v;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ }
    dispatchEvent(new Event('prefschange'));   // app/main.js re-draws the swipe layers
    drawSwipe();
  };
  let swipeMenu = null;
  function closeSwipeMenu(refocus) {
    if (!swipeMenu) return;
    const { el, btn, away } = swipeMenu; swipeMenu = null;
    el.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', away, true);
    if (refocus) btn.focus();
  }
  function openSwipeMenu(side) {
    const btn = $('pick-' + side);
    if (swipeMenu?.btn === btn) return closeSwipeMenu(true);
    closeSwipeMenu(false);
    const el = document.createElement('div'); el.className = 'due-menu'; el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', side === 'r' ? 'Swipe right does' : 'Swipe left does'); el.style.zIndex = 5;
    for (const [id, a] of Object.entries(SWIPE_ACTIONS)) {
      const on = swipeCur()[side] === id, b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', on); b.append(icon(a.icon), a.label);
      if (on) { const t = document.createElement('span'); t.className = 'tick'; t.append(icon('check')); b.append(t); }
      b.addEventListener('click', () => { setSwipe(side, id); closeSwipeMenu(true); });
      el.append(b);
    }
    $('settings').append(el); btn.setAttribute('aria-expanded', 'true');   // inside the dialog, so it sits above it
    const r = btn.getBoundingClientRect(), h = el.offsetHeight;
    el.style.width = r.width + 'px'; el.style.left = r.left + 'px';
    el.style.top = (r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px'; el.style.visibility = 'visible';
    el.querySelector('[aria-checked=true]')?.focus();
    const away = (e) => { if (!el.contains(e.target) && !btn.contains(e.target)) closeSwipeMenu(false); };
    document.addEventListener('pointerdown', away, true);
    swipeMenu = { el, btn, away };
    el.addEventListener('keydown', (e) => {
      const bs = [...el.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSwipeMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === 'Tab') closeSwipeMenu(false);
    });
  }
  function drawSwipe() {
    const c = swipeCur();
    for (const s of ['r', 'l']) {
      const a = SWIPE_ACTIONS[c[s]], btn = $('pick-' + s), caret = document.createElement('span');
      caret.className = 'caret-end'; caret.append(icon('caret-down'));
      btn.replaceChildren(icon(a.icon), a.label, caret);
      $('help-' + s).textContent = a.help;
      const pv = $('prev-' + s); pv.className = s + ' act-' + c[s]; pv.replaceChildren();
      pv.append(...(s === 'r' ? [icon(a.icon), a.label] : [a.label, icon(a.icon)]));
    }
  }
  ['r', 'l'].forEach((s) => $('pick-' + s).addEventListener('click', () => openSwipeMenu(s)));
  $('settings').addEventListener('close', () => closeSwipeMenu(false));
  drawSwipe();



  // ---- Settings sections (Issue #86): fold-away, one open at a time, opening from the top ----
  const stBtns = [...document.querySelectorAll('.st-acc')];
  const stOpen = (btn) => {
    stBtns.forEach((b) => {
      const on = b === btn && b.getAttribute('aria-expanded') !== 'true';   // tapping the open one folds it
      b.setAttribute('aria-expanded', on);
      $(b.getAttribute('aria-controls')).hidden = !on;
    });
  };
  stBtns.forEach((b) => b.addEventListener('click', () => stOpen(b)));

  // ---- Menu open / close ----------------------------------------------------
  const box = $('account'), btn = $('account-btn'), menu = $('account-menu');
  const setMenu = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); };
  btn.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) setMenu(false); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); btn.focus(); }
  });
  window.AppMenu = { close: () => setMenu(false) };
  // Other scripts read and change preferences through here, so this one copy stays in step (Issue #91).
  window.AppPrefs = {
    get: (k) => prefs[k],
    set(k, v) { prefs[k] = v; try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } applyPrefs(); dispatchEvent(new Event('prefschange')); },
  };

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

  // Older notes fold away: the newest release (or Dev's newest day) stays open;
  // the rest sit under centred dividers (Last 7 days / Last 30 days / Older),
  // closed until tapped. Open ones are remembered per app and stage.
  const RANGES = [['week', 'Last 7 days', 7], ['month', 'Last 30 days', 30], ['older', 'Older', Infinity]];
  const OPEN_KEY = `whats-new-open:${location.pathname.split('/')[1] || 'app'}:${STAGE}`;
  const openRanges = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); } };
  function folded(groups, dateOf, draw, countWord) {
    if (!groups.length) return '';
    const [latest, ...rest] = groups;
    const now = Date.now(), open = openRanges();
    const age = (g) => (now - new Date(dateOf(g)).getTime()) / 864e5;
    const sections = RANGES.map(([key, label, max], i) => {
      const min = i ? RANGES[i - 1][2] : -Infinity;
      const items = rest.filter((g) => age(g) >= min && age(g) < max);
      if (!items.length) return '';
      const isOpen = open.has(key), id = `wn-${key}`;
      return `<h3 class="wn-range"><button type="button" class="done-divider" data-range="${key}" aria-expanded="${isOpen}" aria-controls="${id}">
          <span>${label} · ${items.length} ${countWord(items.length)}</span>${icon(isOpen ? 'caret-up' : 'caret-down', 'chevron').outerHTML}</button></h3>
        <div id="${id}" ${isOpen ? '' : 'hidden'}>${items.map(draw).join('')}</div>`;
    }).join('');
    return draw(latest) + sections;
  }
  // Tap a divider: open/close it and remember.
  $('whats-new-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]'); if (!b) return;
    const open = openRanges(), key = b.dataset.range, isOpen = !open.has(key);
    isOpen ? open.add(key) : open.delete(key);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* storage blocked */ }
    $(b.getAttribute('aria-controls')).hidden = !isOpen;
    b.setAttribute('aria-expanded', isOpen);
    b.querySelector('.chevron').replaceWith(icon(isOpen ? 'caret-up' : 'caret-down', 'chevron'));
  });

  function render() {
    if (!data) return "<p class=\"muted\">Release notes appear here once this version is published to one of the stages. (You're looking at a local copy.)</p>";
    if (data.releases?.length) {
      const draw = (r) => `<article class="release${r.rolled_back ? ' rolled-back' : ''}">
        <p class="release-meta">${day(r.date)}${r.version ? ` · ${esc(r.version)}` : ''}${r.rolled_back ? ' · rolled back' : ''}</p>
        ${markdown(r.notes || '')}</article>`;
      return folded(data.releases, (r) => r.date, draw, (n) => (n === 1 ? 'release' : 'releases'));
    }
    if (data.recent?.length) return recentByDay(data.recent);
    return `<p class="muted">No releases in ${esc(STAGE_NAMES[STAGE] || STAGE)} yet.</p>`;
  }
  // Dev: the latest changes grouped by day, in cards (option C from the mock-up).
  // Each change: an emoji for its type (from its issue's label, else its wording),
  // the issue pill(s) and the time. Proper release notes start at Alpha.
  const TYPE_EMOJI = { feature: '✨', tweak: '🎨', bug: '🐛', performance: '⚡' };
  function changeType(c) {
    const label = (c.issues || []).map((n) => data.issues?.[n]?.label).find((l) => TYPE_EMOJI[l]);
    return label || (/^fix\b/i.test(c.title) ? 'bug' : 'scenes');
  }
  function recentByDay(list) {
    const dayKey = (d) => new Date(d).toDateString();
    const today = new Date(), yesterday = new Date(Date.now() - 864e5);
    const dayName = (d) => (dayKey(d) === today.toDateString() ? 'Today'
      : dayKey(d) === yesterday.toDateString() ? 'Yesterday'
      : new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }));
    const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const days = [];
    for (const c of list) {
      const k = dayKey(c.date);
      if (!days.length || days[days.length - 1].k !== k) days.push({ k, name: dayName(c.date), items: [] });
      days[days.length - 1].items.push(c);
    }
    const row = (c) => {
      const type = changeType(c);
      const title = esc(c.title.replace(/^fix:\s*(.)/i, (m, a) => a.toUpperCase()));
      const pills = (c.issues || []).map((n) => `&nbsp;${pill(n)}`).join('');
      return `<li><span class="change-emoji" aria-hidden="true">${TYPE_EMOJI[type] || '🧰'}</span>
        <span class="grow">${title}${pills}</span><span class="change-time">${time(c.date)}</span></li>`;
    };
    const drawDay = (d) => `
        <div class="day-head"><strong>${esc(d.name)}</strong><span class="muted">${d.items.length} change${d.items.length === 1 ? '' : 's'}</span></div>
        <ul class="list changes">${d.items.map(row).join('')}</ul>`;
    return `<p class="muted">🧪 Work in progress on ${esc(STAGE_NAMES[STAGE] || STAGE)}. These get proper release notes when they move on to Alpha.</p>
      ${folded(days, (d) => d.items[0].date, drawDay, (n) => (n === 1 ? 'day' : 'days'))}`;
  }

  $('version-btn').addEventListener('click', async () => {
    setMenu(false);
    await loaded;
    $('whats-new-body').innerHTML = render();
    $('whats-new').showModal();
  });
})();
