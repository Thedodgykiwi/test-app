// The to-do screen, as Preact components (React-style, no build step; Issue #13).
// Data and saving live in store.js; this file only draws and handles taps.
// Layout "B": one list sorted by priority with coloured signal bars on each row,
// Done (closed by default) with centred date dividers, add bar at the bottom.
import { html, render } from 'htm/preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { todos, loading, updating, fresh, ready, collapsed, toggleCollapsed, update, add, remove, keyOf, LEVELS, LABELS } from './store.js';

// Phosphor icon from icons.js
const Icon = ({ name, cls = '' }) => html`<span class="icon-wrap" ref=${(el) => {
  if (el && el.dataset.n !== name + cls) { el.replaceChildren(icon(name, cls)); el.dataset.n = name + cls; }
}} />`;

// Short-lived UI state shared between components
const editing = signal(null);     // { key, text, p } while the edit sheet is open
const justEdited = signal(null);  // key of the row to highlight briefly after saving
const dueMenu = signal(null);     // { key, left, top, bottom } while a row's due-date menu is open (Issue #38)
const movedHint = signal(false);  // "Moved to Done ↓" after ticking while Done is closed
let focusAfter = null;            // [selector, fallback] to focus after the next draw

// Done to-dos are grouped by when they were ticked; no date counts as "Older".
const DONE_RANGES = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['older', 'Older']];
function doneRange(t, now = new Date()) {
  if (!Number.isFinite(t.doneAt)) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (t.doneAt >= startOfToday) return 'today';
  if (t.doneAt >= startOfToday - 6 * day) return 'week';
  if (t.doneAt >= startOfToday - 29 * day) return 'month';
  return 'older';
}


// ---- Due dates (Issue #23) -------------------------------------------------
// A to-do can have a due date ('YYYY-MM-DD', local day). On the day it moves
// into a purple "Due today" panel near the top; after it, if still not done,
// into a red "Overdue" panel above that (its priority flag shows instead).
// Then a blue "Due tomorrow" panel (Issue #24). Starred to-dos stay in Starred, always
// first, with the date label.
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const today = signal(isoDay(new Date()));   // re-checked when the app comes back into view
const recheckDay = () => { const t = isoDay(new Date()); if (t !== today.value) today.value = t; };
document.addEventListener('visibilitychange', recheckDay);
setInterval(recheckDay, 60 * 1000);
const tomorrowDay = () => { const d = parseDay(today.value); return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); };
// "Next week" = the coming Monday (a week on, if today is Monday).
const nextWeekDay = () => { const d = parseDay(today.value); return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (((8 - d.getDay()) % 7) || 7))); };
const validDue = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysUntil = (v) => Math.round((parseDay(v) - parseDay(today.value)) / 864e5);
function dueState(t) {
  if (t.done || !validDue(t.due)) return null;
  const n = daysUntil(t.due);
  return n < 0 ? 'overdue' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'upcoming';
}
function dueLabel(v) {
  const n = daysUntil(v);
  if (n < 0) return `Overdue · ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  const d = parseDay(v), wd = d.toLocaleDateString(undefined, { weekday: 'short' });
  if (n < 7) return `Due ${wd} ${d.getDate()}`;   // "Due Tue 17"
  const mon = d.toLocaleDateString(undefined, { month: 'short' });
  return `Due ${wd} ${d.getDate()} ${mon}${d.getFullYear() !== parseDay(today.value).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
// Scheduled time (Issue #50): optional 'HH:MM' (24-hour) on a to-do with a date.
const validTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function fmtTime(v) {   // "13:00" → "1pm", "09:30" → "9:30am"
  if (!validTime(v)) return '';
  const [h, m] = v.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 ? 'pm' : 'am'}`;
}
// "Tonight" means 5pm onwards (Issue #50 follow-up): a to-do due today at 5pm
// or later is a Tonight one, and a Tonight one can't have an earlier time.
const EVENING = '17:00';
const isEveningTime = (v) => validTime(v) && v >= EVENING;
// The edit sheet's time list: every 15 minutes (plus the to-do's own time if it's in between).
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
// A time that has already gone by today can't be chosen (Issue #50 follow-up).
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const isPast = (due, v) => due === today.value && validTime(v) && v < nowTime();
const withTime = (label, t) => validTime(t.time) ? `${label} · ${fmtTime(t.time)}` : label;
const DUE_ICON = { overdue: 'warning', today: 'clock', tomorrow: 'calendar-blank', upcoming: 'calendar-blank' };

// ---- Ticking off (Issue #20, option 5 from the mock-up) --------------------
// The row turns into a green "✓ Done" chip that drops down to the Done section
// (whose count bumps), and an Undo note appears for a few seconds in case of a
// mis-tap. With Reduce Motion switched on: no movement, just the Undo note.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const busy = new Set();   // rows mid-animation (ignore extra taps)

function markDone(t, k) {
  // Use the to-do as it is now: the list may have been re-read during the
  // animation (e.g. sign-in finishing just after the page opens).
  const cur = todos.value.find((x, i) => keyOf(x, i) === k) || t;
  update(cur, { done: true, doneAt: Date.now() });   // when it was ticked, for Done's date groups
  // Day done? If Tonight is folded away, unfold it so what's left shows (Issue #56).
  if (cur.due === today.value && !cur.evening && !cur.starred && collapsed.value.has('tonight')) {
    const left = todos.value.filter((x) => !x.done && !x.archived && !x.starred && x.due === today.value);
    if (!left.some((x) => !x.evening) && left.some((x) => x.evening)) toggleCollapsed('tonight');
  }
  if (!reduceMotion()) {
    // Bump Done's count once it has re-drawn.
    requestAnimationFrame(() => document.querySelector('#todo-groups [data-group="done"]')
      ?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' }));
  }
  showUndo(t.text, k);
}

async function animateDone(li, t, k) {
  busy.add(k);
  const r = li.getBoundingClientRect();
  const chip = document.createElement('div');
  chip.className = 'done-chip';
  chip.setAttribute('aria-hidden', 'true');
  chip.append(icon('check'), 'Done');
  Object.assign(chip.style, { left: `${r.left + 12}px`, top: `${r.top + (r.height - 34) / 2}px` });
  document.body.append(chip);
  // 1. The row fades and closes up while the chip pops in where it was.
  li.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 180, fill: 'forwards' });
  li.animate([{ height: `${r.height}px` }, { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '-0.4rem' }],
    { duration: 280, delay: 60, easing: 'ease-in', fill: 'forwards' });
  await chip.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: .7 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 300, easing: 'ease-out', fill: 'forwards' }).finished;
  await new Promise((res) => setTimeout(res, 120));
  // 2. Move it to Done; the chip drops down to the Done heading (or the bottom of the screen) and fades.
  markDone(t, k);
  await new Promise((res) => requestAnimationFrame(res));
  const target = document.querySelector('#todo-groups [data-group="done"]')?.getBoundingClientRect();
  const floor = (document.getElementById('todo-form')?.getBoundingClientRect().top || innerHeight) - 40;
  const dy = Math.min(target ? target.top : floor, floor) - parseFloat(chip.style.top);
  await chip.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${Math.max(dy, 24)}px)`, opacity: 0 }],
    { duration: 420, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished;
  chip.remove();
  busy.delete(k);
}

// "Moved to Done · Undo" toast (the playbook's shared toast.js).
function showUndo(text, k) {
  window.AppToast?.show(`“${text}” moved to Done`, {
    icon: 'check-circle',
    duration: 4500,
    action: {
      label: 'Undo', icon: 'arrow-counter-clockwise',
      onClick() {
        // Use the to-do as it is now (the list may have been re-read since).
        const cur = todos.value.find((x, i) => keyOf(x, i) === k);
        if (cur) update(cur, { done: false, doneAt: null });
        focusAfter = [`#todo-${k}`];
      },
    },
  });
}

// ---- Starring (Issue #22) -------------------------------------------------
// Starred to-dos sit in a gold "Starred" section at the very top, whatever
// their priority (they keep it, so un-starring puts them back). Star by
// swiping a to-do to the right, or with the switch in the edit sheet.
function setStar(t, k, starred) {
  if (!ready()) return;
  const cur = todos.value.find((x, i) => keyOf(x, i) === k) || t;
  update(cur, { starred });
  window.AppToast?.show(`“${cur.text}” ${starred ? 'starred' : 'unstarred'}`, {
    icon: starred ? 'star-fill' : 'star',
    action: { label: 'Undo', icon: 'arrow-counter-clockwise', onClick() {
      const now = todos.value.find((x, i) => keyOf(x, i) === k);
      if (now) update(now, { starred: !starred });
    } },
  });
}

// Swipe right on a row to star / un-star it; swipe left to send it to tomorrow,
// or, when it's already due tomorrow, to bring it forward to today; a to-do
// with no date asks "When?" and opens the due-date menu (Issue #39; the same
// choices as the due label's menu). Vertical moves still scroll
// the page; a tap still opens the editor. Done to-dos don't swipe.
const SWIPE_AT = 72;   // px to drag before letting go stars it
function useSwipe(t, k) {
  const row = useRef(), s = useRef(null);
  const down = (e) => {
    if (t.done || e.button > 0 || e.target.closest('input')) return;
    s.current = { x: e.clientX, y: e.clientY, dx: 0, id: e.pointerId, dragging: false };
  };
  const move = (e) => {
    const st = s.current; if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s.current = null; return; }   // scrolling
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      st.dragging = true; row.current.setPointerCapture(st.id); row.current.classList.add('swiping');
    }
    st.dx = Math.max(-140, Math.min(dx, 140));
    row.current.style.transform = `translateX(${st.dx}px)`;
    row.current.parentElement.classList.toggle('swipe-ready', Math.abs(st.dx) >= SWIPE_AT);
    row.current.parentElement.classList.toggle('swipe-left', st.dx < 0);
  };
  const up = () => {
    const st = s.current; s.current = null; if (!st?.dragging) return;
    const el = row.current;
    el.classList.remove('swiping'); el.classList.add('settle'); el.style.transform = '';
    setTimeout(() => el.classList.remove('settle'), 250);
    el.parentElement.classList.remove('swipe-ready');
    setTimeout(() => el.parentElement?.classList.remove('swipe-left'), 230);   // after it slides back
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 60);   // not also a tap
    if (st.dx >= SWIPE_AT) setTimeout(() => setStar(t, k, !t.starred), 180);
    else if (st.dx <= -SWIPE_AT) setTimeout(() => {
      if (!ready()) return;
      if (!validDue(t.due)) {   // no date yet: ask when, in a menu by the row's right-hand end
        const r = el.getBoundingClientRect();
        dueMenu.value = { key: k, right: r.right - 12, top: r.top + 6, bottom: r.bottom - 6 };
      } else if (t.due === tomorrowDay()) setDue(k, today.value, 'moved to today');
      else setDue(k, tomorrowDay(), 'moved to tomorrow');
    }, 180);
  };
  return { row, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}
let swallowClick = false;

const openEditor = (t, k) => { editing.value = { key: k, text: t.text, p: t.p, starred: !!t.starred, due: validDue(t.due) ? t.due : '', time: validTime(t.time) ? t.time : '', evening: !!t.evening, note: noteOf(t) }; };

// ---- Due-date quick menu (Issue #38) ---------------------------------------
// Tap a row's due label ("Due today", "Overdue…") for a small menu: Today /
// Tomorrow / Next week (whichever it isn't already), Pick a date… (the edit
// sheet) and No date. A change shows an Undo note, like starring. Swiping a
// to-do with no date left opens the same menu (Issue #39).
function setDue(k, due, said, evening = false) {
  const cur = todos.value.find((x, i) => keyOf(x, i) === k);
  if (!cur || !ready()) return;
  const before = validDue(cur.due) ? cur.due : null, beforeEv = !!cur.evening, beforeTime = validTime(cur.time) ? cur.time : null;
  const ch = cur.evening || evening ? { due, evening } : { due };   // any other date clears "Tonight" (Issue #43)
  // A time that no longer fits goes: a daytime one when moved to Tonight, an
  // evening one when moved to (daytime) Today, any time when the date is removed.
  if (beforeTime && (!due || (evening && !isEveningTime(beforeTime)) || (!evening && due === today.value && isEveningTime(beforeTime)))) ch.time = null;
  update(cur, ch);
  justEdited.value = k; setTimeout(() => { if (justEdited.value === k) justEdited.value = null; }, 1300);
  focusAfter = [`[data-due-btn="${k}"]`, `[data-edit="${k}"]`];
  window.AppToast?.show(`“${cur.text}” ${said}`, {
    icon: evening ? 'moon' : due ? 'calendar-blank' : 'x',
    action: { label: 'Undo', icon: 'arrow-counter-clockwise', onClick() {
      const now = todos.value.find((x, i) => keyOf(x, i) === k);
      if (now) update(now, { ...(beforeEv || evening ? { due: before, evening: beforeEv } : { due: before }), ...('time' in ch ? { time: beforeTime } : {}) });
      focusAfter = [`[data-due-btn="${k}"]`, `[data-edit="${k}"]`];
    } },
  });
}
function DueMenu() {
  const m = dueMenu.value, box = useRef();
  const t = m && todos.value.find((x, i) => keyOf(x, i) === m.key);
  const close = (refocus) => {
    const k = dueMenu.value?.key; dueMenu.value = null;
    if (refocus) (document.querySelector(`[data-due-btn="${k}"]`) || document.querySelector(`[data-edit="${k}"]`))?.focus({ preventScroll: true });
  };
  useEffect(() => { if (m && !t) dueMenu.value = null; }, [m, t]);   // the to-do went away (ticked elsewhere)
  // Place it under the label, or above when the add bar is in the way; keep it on screen.
  useEffect(() => {
    if (!m || !box.current) return;
    const el = box.current, h = el.offsetHeight, w = el.offsetWidth;
    const floor = (document.getElementById('todo-form')?.getBoundingClientRect().top || innerHeight) - 8;
    const below = m.bottom + 6;
    el.style.top = `${below + h <= floor ? below : Math.max(8, m.top - h - 6)}px`;
    el.style.left = `${Math.max(8, Math.min(m.right != null ? m.right - w : m.left, innerWidth - w - 8))}px`;
    el.style.visibility = 'visible';
    el.querySelector('button')?.focus({ preventScroll: true });
    // Close on a tap elsewhere, Escape, scrolling or resizing.
    const away = (e) => { if (!el.contains(e.target) && !e.target.closest?.('[data-due-btn]')) close(false); };
    const gone = () => close(false);
    document.addEventListener('pointerdown', away, true);
    addEventListener('scroll', gone, true); addEventListener('resize', gone);
    return () => { document.removeEventListener('pointerdown', away, true); removeEventListener('scroll', gone, true); removeEventListener('resize', gone); };
  }, [m]);
  if (!m || !t) return null;
  const tomorrow = tomorrowDay(), nextWeek = nextWeekDay();
  const has = validDue(t.due);
  const items = [
    (t.due !== today.value || t.evening) && ['clock', 'Today', () => setDue(m.key, today.value, 'moved to today')],
    !(t.due === today.value && t.evening) && ['moon', 'Tonight', () => setDue(m.key, today.value, 'moved to tonight', true)],   // Issue #43
    t.due !== tomorrow && ['arrow-right', 'Tomorrow', () => setDue(m.key, tomorrow, 'moved to tomorrow')],
    nextWeek !== tomorrow && t.due !== nextWeek && ['calendar-blank', `Next week · ${dueLabel(nextWeek).replace(/^Due /, '')}`,
      () => setDue(m.key, nextWeek, `is due ${dueLabel(nextWeek).replace(/^Due /, '')}`)],
    ['pencil-simple', 'Pick a date…', () => openEditor(t, m.key)],
    has && ['x', 'No date', () => setDue(m.key, null, 'has no due date now')],
  ].filter(Boolean);
  const keys = (e) => {
    const btns = [...box.current.querySelectorAll('button')], i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Tab') close(false);
  };
  return html`
    <div class="due-menu" ref=${box} role="menu" aria-label=${`Due date for “${t.text}”`} onKeyDown=${keys}>
      ${items.map(([ic, label, run], i) => html`
        <button type="button" role="menuitem" class=${i === 0 ? 'main' : ''} onClick=${() => { dueMenu.value = null; run(); }}><${Icon} name=${ic} />${label}</button>`)}
    </div>`;
}

function Row({ t, k }) {
  const id = `todo-${k}`;
  const tick = (e) => {
    const done = e.target.checked;
    if (busy.has(k)) return;
    if (!ready()) { e.target.checked = !done; return; }   // still connecting (Issue #36)
    if (!done) {   // unticking: straight back, no fuss
      update(t, { done: false, doneAt: null });
      focusAfter = [`#${id}`];
      return;
    }
    focusAfter = [`#${id}`, '[data-group="done"]'];   // keep the keyboard where it was
    const doneClosed = !collapsed.value.has('done-open');
    if (doneClosed && reduceMotion()) { movedHint.value = true; setTimeout(() => { movedHint.value = false; }, 2500); }
    if (reduceMotion()) markDone(t, k);
    else animateDone(e.target.closest('li'), t, k);
  };
  const hl = justEdited.value === k || fresh.value.has(k);   // edited here, or changed elsewhere (Issue #36)
  const { row, handlers } = useSwipe(t, k);
  const ds = dueState(t);
  return html`
    <li class=${`todo${t.done ? ' done' : ''}${t.starred && !t.done ? ' starred' : ''}${hl ? ' just-edited' : ''}`}>
      ${!t.done && html`<div class="swipe-under" aria-hidden="true"><${Icon} name=${t.starred ? 'star' : 'star-fill'} />${t.starred ? 'Unstar' : 'Star'}</div>
        ${!validDue(t.due) ? html`<div class="swipe-under left when" aria-hidden="true">When?<${Icon} name="calendar-blank" /></div>`
          : t.due === tomorrowDay()
          ? html`<div class="swipe-under left to-today" aria-hidden="true">Today<${Icon} name="clock" /></div>`
          : html`<div class="swipe-under left" aria-hidden="true">Tomorrow<${Icon} name="arrow-right" /></div>`}`}
      <div class="todo-row" ref=${row} ...${handlers}>
        <input type="checkbox" id=${id} checked=${t.done} onChange=${tick} aria-label=${`Done: ${t.text}`} />
        <div class="text-col">
          <button type="button" class="text" data-edit=${k} aria-label=${`Edit “${t.text}”${t.starred ? ' (starred)' : ''}${ds ? `, ${withTime(dueLabel(t.due), t)}` : ''}`}
            onClick=${() => { if (swallowClick || !ready()) return; openEditor(t, k); }}>
            <span class="t-main">${t.text}</span></button>
          ${ds && html`<button type="button" class=${`due-label due-${ds}${ds === 'today' && t.evening ? ' tn' : ''}`} data-due-btn=${k} aria-haspopup="menu" aria-expanded=${dueMenu.value?.key === k}
            aria-label=${`${withTime(dueLabel(t.due), t)}. Change the due date`}
            onClick=${(e) => {   // tap the label for a quick menu: Tomorrow, Pick a date, No date (Issue #38)
              if (swallowClick || !ready()) return;
              if (dueMenu.value?.key === k) { dueMenu.value = null; return; }
              const r = e.currentTarget.getBoundingClientRect();
              dueMenu.value = { key: k, left: r.left, top: r.top, bottom: r.bottom };
            }}><${Icon} name=${ds === 'today' && t.evening ? 'moon' : DUE_ICON[ds]} />${withTime(ds === 'today' && t.evening ? 'Tonight' : dueLabel(t.due), t)}<${Icon} name="caret-down" cls="caret" /></button>`}
          ${itemsOf(t).length > 0 && html`<button type="button" class=${`sub-pill${expanded.value.has(k) ? ' open' : ''}`}
            aria-expanded=${expanded.value.has(k)} aria-label=${`Checklist, ${progress(t)} done. ${expanded.value.has(k) ? 'Hide' : 'Show'} it`}
            onClick=${() => { if (swallowClick) return; const s = new Set(expanded.value); s.has(k) ? s.delete(k) : s.add(k); expanded.value = s; }}>
            <${Icon} name="list-checks" />${progress(t)}<${Icon} name="caret-down" cls="caret" /></button>`}
          ${noteOf(t) && html`<button type="button" class=${`sub-pill note-pill${noteOpen.value.has(k) ? ' open' : ''}`}
            aria-expanded=${noteOpen.value.has(k)} aria-label=${`Note. ${noteOpen.value.has(k) ? 'Hide' : 'Show'} it`}
            onClick=${() => { if (swallowClick) return; const s = new Set(noteOpen.value); s.has(k) ? s.delete(k) : s.add(k); noteOpen.value = s; }}>
            <${Icon} name="note" />Note<${Icon} name="caret-down" cls="caret" /></button>`}
          ${!t.done && inMyDay(t) && view.value !== 'myday' && html`<span class="meta-tag"><${Icon} name="sun" />My Day</span>`}
        </div>
        ${t.starred && !t.done && !['all', 'important'].includes(view.value) && html`<span class="row-star" title="Starred"><${Icon} name="star-fill" /><span class="visually-hidden">Starred</span></span>`}
        ${t.p !== 'none' && html`
          <span class="row-flag" title=${`Priority: ${LABELS[t.p]}`}>
            <${Icon} name=${`prio-${t.p}`} cls=${`flag-${t.p}`} /><span class="visually-hidden">Priority: ${LABELS[t.p]}</span>
          </span>`}
      </div>
      ${!t.done && expanded.value.has(k) && itemsOf(t).length > 0 && html`<div class="row-sub"><${Checklist} t=${t} compact=${true} /></div>`}
      ${noteOpen.value.has(k) && noteOf(t) && html`<div class="row-sub"><${NoteText} t=${t} k=${k} /></div>`}
    </li>`;
}

function DoneSection({ done, always }) {
  const closed = !always && !collapsed.value.has('done-open');   // Completed view: always open (Issue #71)
  const now = new Date();
  const [tidy, setTidy] = useState(false);   // "Tidy up" menu (Issue #49, option B)
  // Tidy up only while Done is open and there's something older than today (Issue #59);
  // if that stops being true (folded, archived, synced away), the menu closes too.
  const canTidy = !closed && done.some(([t]) => doneRange(t, now) !== 'today');
  useEffect(() => { if (tidy && !canTidy) setTidy(false); }, [tidy, canTidy]);
  return html`
    <div class="group group-done">
      <h2><button type="button" class="group-toggle" data-group="done" aria-expanded=${!closed} aria-controls="group-list-done"
        title=${closed ? 'Show this section' : 'Hide this section'}
        onClick=${() => { if (always) return; setTidy(false); toggleCollapsed('done-open'); focusAfter = ['[data-group="done"]']; }}>
        <${Icon} name=${closed ? 'caret-right' : 'caret-down'} cls="chevron" /><${Icon} name="check-circle" cls="done-icon" />Done · ${done.length}
      </button>
      ${canTidy && html`<button type="button" class="tidy-btn" id="tidy-up" aria-haspopup="menu" aria-expanded=${tidy}
        onClick=${() => setTidy(!tidy)}><${Icon} name="archive" />Tidy up</button>`}</h2>
      ${tidy && canTidy && html`<${TidyMenu} done=${done} now=${now} close=${() => {
        setTidy(false);   // back to the button, or the Done heading if the button has gone (nothing older left)
        setTimeout(() => (document.getElementById('tidy-up') || document.querySelector('#todo-groups [data-group="done"]'))?.focus());
      }} />`}
      <div class="done-ranges" id="group-list-done" hidden=${closed}>
        ${DONE_RANGES.map(([key, label]) => {
          const items = done.filter(([t]) => doneRange(t, now) === key).sort(([a], [b]) => (b.doneAt || 0) - (a.doneAt || 0));
          if (!items.length) return null;
          const rk = `done-${key}`, hidden = collapsed.value.has(rk), listId = `group-list-${rk}`;
          return html`
            <div class="done-range" key=${rk}>
              <h3><button type="button" class="done-divider" data-group=${rk} aria-expanded=${!hidden} aria-controls=${listId}
                title=${hidden ? `Show: ${label}` : `Hide: ${label}`}
                onClick=${() => { toggleCollapsed(rk); focusAfter = [`[data-group="${rk}"]`]; }}>
                <span>${label} · ${items.length}</span><${Icon} name=${hidden ? 'caret-down' : 'caret-up'} cls="chevron" />
              </button></h3>
              <ul class="todos list" id=${listId} hidden=${hidden}>${items.map(([t, i]) => html`<${Row} key=${keyOf(t, i)} t=${t} k=${keyOf(t, i)} />`)}</ul>
            </div>`;
        })}
      </div>
    </div>`;
}

// One soft panel (Starred, Overdue, Due today/tomorrow or a priority). Tap the
// heading to fold it down to just its coloured bar (Issue #25, option B: smooth
// fold, chevron turns). Which panels are folded is remembered per stage.
function Panel({ p, items, head }) {
  const key = `panel-${p}`, closed = collapsed.value.has(key), listId = `panel-list-${p}`;
  const title = head ? head[1] : LABELS[p];
  return html`
    <section class=${`prio-group prio-${p}${closed ? ' closed' : ''}`} aria-label=${`${title}: ${items.length}`}>
      <h2 class="prio-head"><button type="button" class="prio-toggle" data-group=${key} aria-expanded=${!closed} aria-controls=${listId}
        title=${closed ? 'Show this section' : 'Hide this section'}
        onClick=${() => { toggleCollapsed(key); focusAfter = [`[data-group="${key}"]`]; }}>
        ${head ? html`<${Icon} name=${head[0]} />` : html`<${Icon} name=${`prio-${p}`} cls=${`flag-${p} lvl`} />`}${title} · ${items.length}
        <span class="chev"><${Icon} name="caret-down" /></span>
      </button></h2>
      <div class="fold" id=${listId} inert=${closed}>
        <ul class="todos prio-list">${items.map(([t, i], n) => {
          // Tonight's to-dos can be folded away while focusing on the day (Issue #52).
          const tnClosed = collapsed.value.has('tonight'), ev = p === 'today' && t.evening;
          return html`
          ${ev && !items[n - 1]?.[0].evening && html`<li class="tonight-divider"><button type="button" class="tonight-toggle" data-group="tonight"
            aria-expanded=${!tnClosed} title=${tnClosed ? 'Show tonight' : 'Hide tonight'}
            onClick=${() => { toggleCollapsed('tonight'); focusAfter = ['[data-group="tonight"]']; }}>
            <${Icon} name="moon" />Tonight · ${items.filter(([x]) => x.evening).length}<${Icon} name=${tnClosed ? 'caret-down' : 'caret-up'} cls="chevron" /></button></li>`}
          ${!(ev && tnClosed) && html`<${Row} key=${keyOf(t, i)} t=${t} k=${keyOf(t, i)} />`}`;
        })}</ul>
      </div>
    </section>`;
}

// ---- Archive done to-dos (Issue #49, option B) ------------------------------
// "Tidy up" on the Done heading: archive done to-dos older than 30 days,
// older than 7 days, or everything but today. Archived ones are kept (an
// `archived` flag), just hidden everywhere; an Undo note brings them back.
const TIDY = [['Older than 30 days', ['older']], ['Older than 7 days', ['month', 'older']], ['Everything except today', ['week', 'month', 'older']]];
function archiveDone(list, label) {
  if (!ready() || !list.length) return;
  const ids = list.map(([t, i]) => keyOf(t, i));
  const find = (k) => todos.value.find((x, i) => keyOf(x, i) === k);
  ids.forEach((k) => { const t = find(k); if (t) update(t, { archived: true }); });
  window.AppToast?.show(`Archived ${list.length} done to-do${list.length === 1 ? '' : 's'}`, {
    icon: 'archive',
    action: { label: 'Undo', icon: 'arrow-counter-clockwise', onClick() { ids.forEach((k) => { const t = find(k); if (t) update(t, { archived: false }); }); } },
  });
}
function TidyMenu({ done, now, close }) {
  const box = useRef();
  useEffect(() => {
    box.current?.querySelector('button:not([disabled])')?.focus();
    const off = (e) => { if (!box.current?.contains(e.target) && e.target.id !== 'tidy-up') close(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, []);
  // The title is for sighted users; screen readers get the full meaning from the menu's label.
  return html`<div class="tidy-menu" ref=${box} role="menu" aria-label="Archive done to-dos. They're kept, just out of the way.">
    <p class="tidy-help" aria-hidden="true"><${Icon} name="archive" />Archive done to-dos</p>
    ${TIDY.map(([label, ranges]) => {
      const list = done.filter(([t]) => ranges.includes(doneRange(t, now)));
      return html`<button type="button" role="menuitem" class="tidy-item" disabled=${!list.length}
        onClick=${() => { archiveDone(list, label); close(); }}><span>${label}</span><span class="tidy-n">${list.length}</span></button>`;
    })}
  </div>`;
}

// ---- Lists panel and views (Issue #71, option A + the tappable title from C) ---
// "‹ Lists" (or tapping the title) opens a side panel of views: All to-dos,
// My Day, Important (starred), Planned (has a date) and Completed. On wide
// screens the panel stays open as a sidebar. The chosen view is remembered
// per stage. My Day is a `myDay: 'YYYY-MM-DD'` date on a to-do: it only
// counts on that day, so My Day starts empty each morning.
const VIEWS = [['all', 'list-checks', 'All to-dos'], ['myday', 'sun', 'My Day'], ['important', 'star', 'Important'],
  ['planned', 'calendar-blank', 'Planned'], ['completed', 'check-circle', 'Completed']];
const viewKey = `view-${window.STAGE || 'local'}`;
const savedView = (() => { try { return localStorage.getItem(viewKey); } catch { return null; } })();
const view = signal(VIEWS.some(([k]) => k === savedView) ? savedView : 'all');
const listsOpen = signal(false);
// Settings → List style: how My Day, Important and Planned group their to-dos.
// pills (default): small headings over plain cards; lines: Done-style centred
// dividers; boxes: the coloured panels the main view uses.
const listStyle = signal(document.documentElement.dataset.listStyle || 'pills');
new MutationObserver(() => { listStyle.value = document.documentElement.dataset.listStyle || 'pills'; })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-list-style'] });
const wideQ = matchMedia('(min-width: 1100px)');
const wide = signal(wideQ.matches);
wideQ.addEventListener('change', () => { wide.value = wideQ.matches; if (wide.value) listsOpen.value = false; });
const inMyDay = (t) => t.myDay === today.value;
const viewInfo = (v) => VIEWS.find(([k]) => k === v) || VIEWS[0];
function inView(v, t) {
  if (v === 'myday') return inMyDay(t);
  if (v === 'important') return !!t.starred;
  if (v === 'planned') return validDue(t.due) && !t.done;
  if (v === 'completed') return !!t.done;
  return true;
}
const countOf = (v) => todos.value.filter((t) => !t.archived && (v === 'completed' ? t.done : !t.done) && inView(v, t)).length;
function setView(v) {
  view.value = v; listsOpen.value = false;
  try { localStorage.setItem(viewKey, v); } catch { /* storage blocked: not remembered */ }
  document.body.dataset.view = v; scrollTo(0, 0);
  setTimeout(() => document.getElementById('view-title-btn')?.focus({ preventScroll: true }));
}
document.body.dataset.view = view.value;
function ListsPanel() {
  const panel = useRef();
  const open = listsOpen.value, pinned = wide.value;
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector('[aria-current]')?.focus();
    const esc = (e) => { if (e.key === 'Escape') { listsOpen.value = false; document.getElementById('view-title-btn')?.focus(); } };
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc);
  }, [open]);
  document.body.classList.toggle('lists-pinned', pinned);
  return html`
    ${!pinned && html`<div class=${`lists-scrim${open ? ' open' : ''}`} onClick=${() => { listsOpen.value = false; }}></div>`}
    <aside class=${`lists-panel${open || pinned ? ' open' : ''}`} ref=${panel} aria-label="Lists" inert=${!open && !pinned}
      role=${pinned ? null : 'dialog'} aria-modal=${pinned ? null : 'true'}>
      <div class="lists-top"><h2>Lists</h2>${!pinned && html`<button type="button" class="close-btn" aria-label="Close" onClick=${() => { listsOpen.value = false; document.getElementById('view-title-btn')?.focus(); }}><${Icon} name="x" /></button>`}</div>
      <nav class="lv" aria-label="Views">${VIEWS.map(([v, ic, name]) => { const n = countOf(v);
        return html`<button type="button" class="lv-item" aria-current=${view.value === v ? 'page' : null} onClick=${() => setView(v)}>
          <${Icon} name=${ic} cls="lv-ic" /><span class="lv-name">${name}</span>${n > 0 && html`<span class="lv-n" aria-label=${`, ${n}`}>${n}</span>`}</button>`; })}</nav>
    </aside>`;
}
// Above the title: "‹ Lists". The title itself (app name, or the view's name) also opens the panel.
function ViewHead() {
  const v = view.value, [, ic, name] = viewInfo(v), pinned = wide.value;
  const toggle = () => { if (!pinned) listsOpen.value = !listsOpen.value; };
  return html`
    ${!pinned && html`<button type="button" class="lists-btn" aria-expanded=${listsOpen.value} onClick=${toggle}><${Icon} name="caret-left" />Lists</button>`}
    <h1 class="view-title">${pinned ? html`<span class="vt">${v === 'all' ? html`<${Icon} name="list-checks-duotone" cls="title-icon" />The Shortlist` : html`<${Icon} name=${ic} cls="vt-ic" />${name}`}</span>`
      : html`<button type="button" id="view-title-btn" class="vt" aria-haspopup="dialog" aria-expanded=${listsOpen.value} title="Lists" onClick=${toggle}>
        ${v === 'all' ? html`<${Icon} name="list-checks-duotone" cls="title-icon" />The Shortlist` : html`<${Icon} name=${ic} cls="vt-ic" />${name}`}<${Icon} name="caret-down" cls="vt-caret" /></button>`}</h1>`;
}
const dayName = (d) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function TodoList() {
  // Archived to-dos (Issue #49) are kept but never shown.
  const v = view.value;
  const all = todos.value.map((t, i) => [t, i]).filter(([t]) => !t.archived && inView(v, t));   // keep each to-do's saved position for stable keys
  const active = all.filter(([t]) => !t.done), done = all.filter(([t]) => t.done);
  // After a tick / toggle / edit: focus the first matching element that's visible.
  useEffect(() => {
    if (!focusAfter) return;
    const [sel, fallback] = focusAfter; focusAfter = null;
    const visible = (s) => s && [...document.querySelectorAll(`#todo-groups ${s}`)].find((n) => !n.closest('[hidden]'));
    (visible(sel) || visible(fallback))?.focus();
  });
  // Option D (Issue #19): a soft panel per priority, roomy rows inside.
  // Starred first (whatever their date; they show a Due today / Overdue label),
  // then Overdue and Due today (Issue #23), then each priority.
  const ds = new Map(active.map(([t]) => [t, dueState(t)]));
  const byDue = (a, b) => a[0].due.localeCompare(b[0].due);
  const RANK = { overdue: 0, today: 1, tomorrow: 2 };   // inside Starred: overdue, today, tomorrow, then the rest
  const PRANK = { high: 0, med: 1, low: 2 };   // then High, Medium, Low, no priority (Issue #48)
  const starred = active.filter(([t]) => t.starred).sort(([a], [b]) =>
    ((RANK[ds.get(a)] ?? 3) - (RANK[ds.get(b)] ?? 3)) || ((PRANK[a.p] ?? 3) - (PRANK[b.p] ?? 3)));
  const unstarred = active.filter(([t]) => !t.starred);
  const overdue = unstarred.filter(([t]) => ds.get(t) === 'overdue').sort(byDue);
  // Evening ("Tonight") to-dos sort after the day's others, under a small divider (Issue #43).
  // Within a day, to-dos with a time come first, earliest first (Issue #50).
  const byTime = ([a], [b]) => (validTime(a.time) ? a.time : '99') .localeCompare(validTime(b.time) ? b.time : '99');
  const dueToday = unstarred.filter(([t]) => ds.get(t) === 'today').sort((x, y) => ((x[0].evening ? 1 : 0) - (y[0].evening ? 1 : 0)) || byTime(x, y));
  const dueTomorrow = unstarred.filter(([t]) => ds.get(t) === 'tomorrow').sort(byTime);
  const rest = unstarred.filter(([t]) => !['overdue', 'today', 'tomorrow'].includes(ds.get(t)));
  const groups = [['starred', starred], ['overdue', overdue], ['today', dueToday], ['tomorrow', dueTomorrow],
    ...LEVELS.map((p) => [p, rest.filter(([t]) => t.p === p)])].filter(([, l]) => l.length);
  const HEAD = { overdue: ['warning', 'Overdue'], today: ['clock', 'Due today'], tomorrow: ['calendar-blank', 'Due tomorrow'], starred: ['star-fill', 'Starred'] };
  let shown = groups;
  if (v === 'important') shown = [['starred', starred]];
  if (v === 'planned') {   // Planned: Overdue, then one panel per day, like a diary
    const days = [...new Set(active.filter(([t]) => ds.get(t) !== 'overdue').map(([t]) => t.due))].sort();
    shown = [['overdue', active.filter(([t]) => ds.get(t) === 'overdue').sort(byDue)],
      ...days.map((d) => [d === today.value ? 'today' : d === tomorrowDay() ? 'tomorrow' : `day-${d}`,
        active.filter(([t]) => t.due === d && ds.get(t) !== 'overdue').sort((x, y) => ((x[0].evening ? 1 : 0) - (y[0].evening ? 1 : 0)) || byTime(x, y))])];
    days.forEach((d) => { HEAD[`day-${d}`] = ['calendar-blank', dayName(d)]; });
    HEAD.today = ['clock', 'Today']; HEAD.tomorrow = ['calendar-blank', 'Tomorrow'];
  }
  shown = shown.filter(([, l]) => l.length);
  const EMPTY = { myday: 'My Day is empty. Add a to-do below, or open one and tap “My Day”.',
    important: 'No starred to-dos. Star one to see it here.', planned: 'Nothing with a date.', completed: 'Nothing done yet.' };
  if (v !== 'all' && !all.length && !loading.value) return html`<p class="empty">${EMPTY[v]}</p>`;
  const ls = listStyle.value;
  if (['myday', 'important', 'planned'].includes(v) && ls !== 'boxes' && active.length) {
    // Slim headings by when: Planned per day; My Day and Important by Overdue / Today / Tonight / …
    let vg;
    if (v === 'planned') vg = shown.map(([p, items]) => [`${p.startsWith('day-') ? 'day' : p}-${items[0][0].due}`, HEAD[p][1], items, p === 'overdue']);
    else {
      const when = (t) => { const d = ds.get(t); if (d === 'overdue') return 'Overdue'; if (d === 'today') return t.evening ? 'Tonight' : 'Today';
        if (d === 'tomorrow') return v === 'myday' ? 'Later' : 'Tomorrow'; return validDue(t.due) ? 'Later' : (v === 'myday' ? 'Any time' : 'No date'); };
      const ORDER = ['Overdue', 'Today', 'Tonight', 'Tomorrow', 'Later', 'Any time', 'No date'];
      const byPrio = (x, y) => byTime(x, y) || ((PRANK[x[0].p] ?? 3) - (PRANK[y[0].p] ?? 3));
      vg = ORDER.map((label) => [label, active.filter(([t]) => when(t) === label)]).filter(([, l]) => l.length)
        .map(([label, items]) => [`${v}-${label}`, label, [...items].sort(label === 'Later' || label === 'Overdue' ? (x, y) => byDue(x, y) || byPrio(x, y) : byPrio), label === 'Overdue']);
    }
    const one = vg.length === 1 && v !== 'planned';   // one group only: no heading, just the cards
    return html`<div class=${`vg-groups vg-${ls}`}>
      ${vg.map(([key, label, items, od]) => { const ck = `vg-${key}`, hidden = !one && collapsed.value.has(ck), listId = `vg-list-${key}`;
        return html`<section class=${`vg${od ? ' overdue' : ''}`} key=${key} aria-label=${`${label}: ${items.length}`}>
          ${!one && html`<h2 class="vg-h"><button type="button" class=${ls === 'pills' ? 'vg-pill' : 'done-divider'} data-group=${ck}
            aria-expanded=${!hidden} aria-controls=${listId} title=${hidden ? 'Show this section' : 'Hide this section'}
            onClick=${() => { toggleCollapsed(ck); focusAfter = [`[data-group="${ck}"]`]; }}>
            ${ls === 'pills' && html`<${Icon} name=${hidden ? 'caret-right' : 'caret-down'} cls="chevron" />`}<span>${label} · ${items.length}</span>
            ${ls !== 'pills' && html`<${Icon} name=${hidden ? 'caret-down' : 'caret-up'} cls="chevron" />`}</button></h2>`}
          <ul class="todos vg-list" id=${listId} hidden=${hidden}>${items.map(([t, i]) => html`<${Row} key=${keyOf(t, i)} t=${t} k=${keyOf(t, i)} />`)}</ul>
        </section>`; })}
      ${done.length > 0 && html`<${DoneSection} done=${done} always=${false} />`}
      ${movedHint.value && html`<p class="moved-hint">Moved to Done ↓</p>`}</div>`;
  }
  return html`
    ${!all.length && html`<p class="empty">${loading.value ? 'Loading your to-dos…' : 'No to-dos yet. Add one below.'}</p>`}
    ${all.length > 0 && !active.length && v !== 'completed' && html`<p class="empty">All done. Nothing left to do!</p>`}
    ${active.length > 0 && html`<div id="todo-list" class="prio-groups">
      ${shown.map(([p, items]) => html`
        <${Panel} key=${p} p=${p} items=${items} head=${HEAD[p]} />`)}
    </div>`}
    ${done.length > 0 && html`<${DoneSection} done=${done} always=${v === 'completed'} />`}
    ${movedHint.value && html`<p class="moved-hint">Moved to Done ↓</p>`}`;
}

// Add bar (fixed at the bottom). The priority button (signal bars) picks the new to-do's priority:
// each tap moves none → Low → Medium → High → none; it resets after each add.
const CYCLE = ['none', 'low', 'med', 'high'];
// The add box's hint: a different award-night line each time the app opens and
// after each add, never the same twice in a row (Issue #37). Keep lines to about
// 22 characters so they fit the box on a phone.
const HINTS = [
  'Which gets the nod?', 'And the nominee is…', "Who's in the running?", 'Any late entries?', 'Who makes the cut?',
  'Nominate a to-do…', 'One for the shortlist?', 'Up for Best To-Do?', 'Shortlist material?', 'Add a nominee…',
];
const hintKey = `add-hint:${window.STAGE || 'local'}`;
function nextHint() {
  let last = null;
  try { last = localStorage.getItem(hintKey); } catch { /* storage blocked */ }
  const pool = HINTS.filter((h) => h !== last);
  const h = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(hintKey, h); } catch { /* storage blocked */ }
  return h;
}
// ---- Words understood in a new to-do (Issue #42) ---------------------------
// A date word and/or a priority letter at the START or END of what's typed
// (never the middle, so "Tom's leaving do" stays as written) sets the due
// date / priority and comes out of the title: "put out trash tomorrow" →
// "Put out trash", due tomorrow; "H call the venue" → "Call the venue", High.
// Live chips under the box show what was understood before you add.
const DATE_WORDS = [
  [/^(today|tod)$/i, () => today.value, 'today'],
  [/^(tonight|ton)$/i, () => today.value, 'tonight'],   // "Tonight": due today, evening (Issue #43)
  [/^(tomorrow|tmrw|tmr|tom)$/i, tomorrowDay, 'tomorrow'],
  [/^(next week|nxt week|nw)$/i, nextWeekDay, 'next week'],
];
const DATE_RE = 'today|tod|tonight|ton|tomorrow|tmrw|tmr|tom|next week|nxt week|nw';
const PRIO_WORDS = { l: 'low', m: 'med', h: 'high' };
// A time next to the date word (Issue #50): 4pm, 4:30pm, 13:00 or 1300. A bare
// number ("buy 4 eggs") is never a time.
const TIME_RE = '\\d{1,2}(?::[0-5]\\d)?\\s?(?:am|pm)|(?:[01]?\\d|2[0-3]):[0-5]\\d|(?:[01]\\d|2[0-3])[0-5]\\d';
function toTime(w) {
  const s = w.toLowerCase().replace(/\s/g, '');
  let m = s.match(/^(\d{1,2})(?::(\d\d))?(am|pm)$/);
  if (m) { let h = +m[1]; if (h < 1 || h > 12) return ''; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${m[2] || '00'}`; }
  m = s.match(/^(\d{1,2}):?(\d\d)$/);
  return m && +m[1] < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}
export function parseEntry(raw) {
  let text = raw.trim(), due = '', dueWord = '', p = '', time = '', starred = false;
  const takeEnd = (re, atStart) => {
    const m = atStart ? text.match(new RegExp(`^(${re})(?=[\\s,.:;!-]|$)`, 'i')) : text.match(new RegExp(`(?:^|[\\s,.:;!-])(${re})[.!]?$`, 'i'));
    if (!m) return null;
    text = atStart ? text.slice(m[0].length) : text.slice(0, text.length - m[0].length);
    text = text.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
    return m[1];
  };
  // A few passes so "tod pick up suit l" and "l pick up suit tod" both work.
  for (let pass = 0; pass < 4; pass++) for (const atStart of [false, true]) {
    if (!due) { const w = takeEnd(DATE_RE, atStart); if (w) { const [, fn, label] = DATE_WORDS.find(([re]) => re.test(w)); due = fn(); dueWord = label; continue; } }
    if (!time) { const w = takeEnd(TIME_RE, atStart); if (w && toTime(w)) { time = toTime(w); continue; } }
    if (!p) { const w = takeEnd('[lmh]', atStart); if (w) { p = PRIO_WORDS[w.toLowerCase()]; continue; } }
    if (!starred && takeEnd('s', atStart)) starred = true;   // a single S stars it (Issue #53)
  }
  let pastTime = '';
  if (time && !due) {   // a time alone means today, or tomorrow once it has gone by
    if (time < nowTime()) { due = tomorrowDay(); dueWord = 'tomorrow'; } else { due = today.value; dueWord = 'today'; }
  }
  if (time && due === today.value && time < nowTime()) { pastTime = time; time = ''; }   // "tod 6am" at 1pm: the time has gone, so it's left off
  if (dueWord === 'today' && isEveningTime(time)) dueWord = 'tonight';   // "tod 6pm" is a Tonight one
  if (dueWord === 'tonight' && time && !isEveningTime(time)) time = '';   // "ton 9am": tonight wins, time dropped
  if (!text) { text = raw.trim(); due = ''; dueWord = ''; p = ''; time = ''; starred = false; }   // only keywords typed: keep them as the title
  if (text) text = text[0].toUpperCase() + text.slice(1);
  return { text: text.slice(0, 500), due, dueWord, p, time, pastTime, starred, evening: dueWord === 'tonight' };
}
// Adds what was typed, with whatever was understood. The priority button's
// own choice is the fallback. Returns the parsed entry, or null if nothing added.
function addParsed(raw, pFallback) {
  const r = parseEntry(raw);
  // Added while a view is open: it goes into that view (Issue #71).
  const v = view.value, due = r.due || (v === 'planned' ? today.value : undefined);
  if (!r.text || !add(r.text, r.p || pFallback, due, r.evening, r.time, r.starred || v === 'important', v === 'myday' ? today.value : undefined)) return null;
  return r;
}
function Understood({ r }) {
  if (!r || (!r.due && !r.p && !r.starred)) return null;
  return html`<div class="understood" aria-live="polite">
    ${r.due && html`<span class="u-chip due"><${Icon} name=${r.evening ? 'moon' : 'calendar-blank'} />${r.evening ? 'Tonight' : `Due ${r.dueWord}`}</span>`}
    ${r.time && html`<span class="u-chip due"><${Icon} name="clock" />at ${fmtTime(r.time)}</span>`}
    ${r.pastTime && html`<span class="u-chip past"><${Icon} name="clock" />${fmtTime(r.pastTime)} has passed</span>`}
    ${r.starred && html`<span class="u-chip star"><${Icon} name="star-fill" />Starred</span>`}
    ${r.p && html`<span class=${`u-chip p-${r.p}`}><${Icon} name=${`prio-${r.p}`} cls=${`flag-${r.p}`} />${LABELS[r.p]}</span>`}
    <span class="u-title">→ “${r.text}”</span></div>`;
}

// ---- Checklist on a to-do (Issue #44) ---------------------------------------
// A simple list of things needed for the to-do: tick, rename in place, drag
// the handle to reorder, "Add item…" at the end (Enter moves to the next).
// Changes save at once. A row with items shows a "2/4" pill; tapping it
// unfolds the checklist under the row. The edit sheet has the same list.
const expanded = signal(new Set());   // rows showing their checklist
// ---- Note on a to-do (Issue #57, option A) ----------------------------------
// Optional plain-text note (up to 2000 characters). Rows with one show a
// "Note" pill beside Due / the checklist pill; tapping it unfolds the note
// under the row, with web links made tappable.
const noteOpen = signal(new Set());
const noteOf = (t) => typeof t.note === 'string' ? t.note.trim() : '';
// The open note can be edited in place, like the checklist: tap the text (not
// a link) to edit; it saves when you leave the box, and an emptied note is
// removed. Links (http…, www.…) stay tappable while reading.
function NoteText({ t, k }) {
  const text = noteOf(t);
  const [editing, setEditing] = useState(false);
  const box = useRef();
  useEffect(() => { if (editing && box.current) { const b = box.current; b.focus(); b.setSelectionRange(b.value.length, b.value.length); grow(b); } }, [editing]);
  const grow = (b) => { b.style.height = 'auto'; b.style.height = `${b.scrollHeight}px`; };
  const save = (v) => {
    setEditing(false);
    const nt = v.trim().slice(0, 2000);
    if (nt === text || !ready()) return;
    update(t, { note: nt || null });
    if (!nt) { const s = new Set(noteOpen.value); s.delete(k); noteOpen.value = s; }
  };
  if (editing) return html`<textarea ref=${box} class="row-note row-note-edit" aria-label="Note" maxlength="2000" value=${text}
    onInput=${(e) => grow(e.target)} onBlur=${(e) => save(e.target.value)}
    onKeyDown=${(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}></textarea>`;
  const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/g);
  return html`<div class="row-note row-note-read" role="button" tabindex="0" aria-label="Note: tap to edit"
    onClick=${(e) => { if (e.target.closest('a')) return; setEditing(true); }}
    onKeyDown=${(e) => { if (e.key === 'Enter' && !e.target.closest('a')) { e.preventDefault(); setEditing(true); } }}>
    ${parts.map((s, i) => i % 2 ? html`<a href=${s.startsWith('www.') ? `https://${s}` : s} target="_blank" rel="noopener noreferrer">${s}</a>` : s)}</div>`;
}
const itemsOf = (t) => Array.isArray(t.items) ? t.items : [];
const progress = (t) => { const it = itemsOf(t); return it.length ? `${it.filter((i) => i.done).length}/${it.length}` : ''; };
function Checklist({ t, autoFocus, compact }) {
  const items = itemsOf(t);
  const save = (next) => { if (ready()) update(t, { items: next }); };
  const box = useRef(), addRef = useRef();
  useEffect(() => { if (autoFocus) addRef.current?.focus(); }, [autoFocus]);
  const [drag, setDrag] = useState(null);
  const onHandle = (i) => (e) => {
    e.preventDefault(); const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let from = i, list = items.slice();
    setDrag(i);
    const move = (ev) => {
      const rows = [...box.current.querySelectorAll('.cl-item')];
      // Where it would land: how many other rows have their middle above the pointer.
      const idx = rows.filter((r, j) => j !== from && ev.clientY > r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2).length;
      if (idx !== from) { const [it] = list.splice(from, 1); list.splice(idx, 0, it); from = idx; setDrag(idx); save(list); }
    };
    const up = () => { setDrag(null); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const addItem = (e) => {
    e.preventDefault(); const v = addRef.current.value.trim().slice(0, 200); if (!v) return;
    if (items.length >= 50) { window.AppToast?.show('A checklist can hold 50 items', { icon: 'list-checks' }); return; }
    save([...items, { text: v, done: false }]); addRef.current.value = '';
  };
  // Keyboard reorder on the handle: Alt + arrow up / down.
  const handleKeys = (i) => (e) => {
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= items.length) return;
    const list = items.slice(); [list[i], list[j]] = [list[j], list[i]]; save(list);
    setTimeout(() => box.current?.querySelectorAll('.cl-handle')[j]?.focus());
  };
  return html`
    <div class=${`checklist${compact ? ' compact' : ''}`} ref=${box}>
      ${items.map((it, i) => html`
        <div class=${`cl-item${it.done ? ' done' : ''}${drag === i ? ' dragging' : ''}`} key=${i}>
          <button type="button" class="cl-tick" role="checkbox" aria-checked=${it.done} aria-label=${`Done: ${it.text}`}
            onClick=${() => save(items.map((x, j) => j === i ? { ...x, done: !x.done } : x))}><${Icon} name=${it.done ? 'check-circle' : 'circle'} /></button>
          <input class="cl-text" value=${it.text} aria-label="Checklist item" maxlength="200"
            onBlur=${(e) => { const v = e.target.value.trim(); if (v === it.text) return; save(v ? items.map((x, j) => j === i ? { ...x, text: v } : x) : items.filter((_, j) => j !== i)); }}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); addRef.current.focus(); } }} />
          <button type="button" class="cl-handle" aria-label=${`Reorder “${it.text}” (drag, or Alt + arrow keys)`} onPointerDown=${onHandle(i)} onKeyDown=${handleKeys(i)}><${Icon} name="dots-six-vertical" /></button>
        </div>`)}
      <form class="cl-add" onSubmit=${addItem}>
        <span class="cl-plus" aria-hidden="true"><${Icon} name="plus" /></span>
        <input ref=${addRef} class="cl-text" placeholder=${items.length ? 'Add item…' : 'First item…'} aria-label="Add a checklist item" maxlength="200" autocomplete="off" />
      </form>
    </div>`;
}

function AddBar() {
  const [p, setP] = useState('none');
  const [hint, setHint] = useState(nextHint);
  const [r, setR] = useState(null);   // what the typed words mean (Issue #42)
  const input = useRef(), flag = useRef(), tapped = useRef(false);
  const onInput = () => setR(parseEntry(input.current.value));
  const shownP = r?.p || p;   // a typed letter shows on the priority button too
  // Replay the little "pop" when the flag is tapped (not on the reset after adding).
  useEffect(() => {
    if (!tapped.current) return;
    tapped.current = false;
    const ic = flag.current.querySelector('.ic');
    ic?.classList.remove('pop'); void ic?.offsetWidth; ic?.classList.add('pop');
  }, [p]);
  const submit = (e) => {
    e.preventDefault();
    if (addParsed(input.current.value, p)) { input.current.value = ''; setP('none'); setR(null); setHint(nextHint()); }
    input.current.focus();
  };
  return html`
    <form id="todo-form" class="add-bar" onSubmit=${submit}>
      <div class="add-inner">
        <div class="entry">
          <input id="todo-input" ref=${input} onInput=${onInput} class=${`input${shownP === 'none' ? ' no-word' : ''}`} placeholder=${loading.value && updating.value ? 'Connecting…' : hint} autocomplete="off" aria-label="New to-do" maxlength="500" />
          <button type="button" id="new-priority" ref=${flag} class=${`flag-btn p-${shownP}`}
            aria-label=${`Priority for new to-do: ${LABELS[shownP]}. Tap to change`} title=${`Priority: ${LABELS[shownP]} (tap to change)`}
            onClick=${() => { tapped.current = true; setP(CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]); }}>
            <span class="word">${shownP === 'none' ? '' : LABELS[shownP]}</span><${Icon} name=${`prio-${shownP}`} cls=${`flag-${shownP}`} />
          </button>
        </div>
        <button type="submit" class="btn primary" aria-label="Add to-do" title="Add"><${Icon} name="plus" />Add</button>
        <${Understood} r=${r} />
      </div>
    </form>`;
}

// Due date picker in the edit sheet (Issue #23): None / Today / Tomorrow chips
// and a small month calendar. Value is 'YYYY-MM-DD' or '' for none.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function DueField({ value, onChange, open, tonight }) {
  const t0 = parseDay(today.value);
  const tomorrow = isoDay(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 1));
  const start = value ? parseDay(value) : t0;
  const [month, setMonth] = useState([start.getFullYear(), start.getMonth()]);
  // Each time the sheet opens, show the month of the current due date (or this month).
  useEffect(() => { if (open) setMonth([start.getFullYear(), start.getMonth()]); }, [open]);
  const [y, m] = month;
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
  const thisMonth = y === t0.getFullYear() && m === t0.getMonth();
  const go = (n) => setMonth(([yy, mm]) => { const d = new Date(yy, mm + n, 1); return [d.getFullYear(), d.getMonth()]; });
  const choice = !value ? 'none' : value === today.value ? 'today' : value === tomorrow ? 'tomorrow' : 'pick';
  // The calendar only shows behind the "Pick" chip (Issue #45), or when the
  // date is already one the chips can't say.
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (open) setPicking(false); }, [open]);
  const showCal = picking || choice === 'pick';
  const pick = (v) => { onChange(v); setPicking(false); if (v) { const d = parseDay(v); setMonth([d.getFullYear(), d.getMonth()]); } };
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return html`
    <p class="field-label" id="edit-due-label">Due${value ? html` · <span class="due-chosen">${tonight ? 'Tonight' : (l => l[0].toUpperCase() + l.slice(1))(dueLabel(value).replace(/^Due /, ''))}</span>` : ''}</p>
    <div class="seg chips" role="group" aria-labelledby="edit-due-label">
      ${[['none', 'None', ''], ['today', 'Today', today.value], ['tomorrow', 'Tomorrow', tomorrow]].map(([k, l, v]) => html`
        <button type="button" class="chip" data-due=${k} aria-pressed=${choice === k} onClick=${() => pick(v)}>${l}</button>`)}
      <button type="button" class="chip" data-due="pick" aria-pressed=${choice === 'pick'} aria-expanded=${showCal} onClick=${() => setPicking(!showCal)}><${Icon} name="calendar-blank" />Pick</button>
    </div>
    ${showCal && html`<div class="mini-cal" role="group" aria-label=${`Pick a due date, ${monthName}`}>
      <div class="cal-head">
        <button type="button" class="cal-nav" aria-label="Previous month" disabled=${thisMonth} onClick=${() => go(-1)}><${Icon} name="caret-left" /></button>
        <span>${monthName}</span>
        <button type="button" class="cal-nav" aria-label="Next month" onClick=${() => go(1)}><${Icon} name="caret-right" /></button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS.map((d) => html`<span class="cal-wd" aria-hidden="true">${d}</span>`)}
        ${Array.from({ length: lead }, () => html`<span />`)}
        ${Array.from({ length: days }, (_, i) => {
          const v = `${y}-${pad(m + 1)}-${pad(i + 1)}`;
          const past = v < today.value && v !== value;
          return html`<button type="button" class=${`cal-day${v === today.value ? ' is-today' : ''}`} disabled=${past}
            aria-pressed=${v === value} aria-label=${new Date(y, m, i + 1).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            onClick=${() => pick(v)}>${i + 1}</button>`;
        })}
      </div>
    </div>`}`;
}

// Edit sheet: change the wording or priority. Opening it doesn't redraw or
// move the list behind; the list changes only on Save.
// ---- Quick add (Issue #41) ------------------------------------------------
// On a keyboard, press N (when not typing somewhere) for a small "New to-do"
// pop-up in the middle of the screen: type, pick a priority if you like,
// Enter adds and clears the box for the next one (it stays open, so you
// can add several in a row); Esc, or Enter on an empty box, closes it.
// It fades in with a small slide up (style.css).
const quickOpen = signal(false);
addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() !== 'n' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
  if (ev.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  quickOpen.value = true;
});
function QuickAdd() {
  const dlg = useRef(), input = useRef();
  const [p, setP] = useState('none');
  const [added, setAdded] = useState([]);   // texts added since it opened
  const [r, setR] = useState(null);   // Issue #42
  const onInput = () => setR(parseEntry(input.current.value));
  const shownP = r?.p || p;
  useEffect(() => {
    if (quickOpen.value) { setP('none'); setAdded([]); input.current.value = ''; dlg.current.showModal(); input.current.focus(); }
    else if (dlg.current.open) dlg.current.close();
  }, [quickOpen.value]);
  const submit = (e) => {
    e.preventDefault();
    const v = input.current.value.trim().slice(0, 500);
    if (!parseEntry(v).text) { quickOpen.value = false; return; }   // empty Enter = done
    const res = addParsed(v, p);
    if (res) { setAdded([...added, res.text]); input.current.value = ''; setP('none'); setR(null); }
    input.current.focus();
  };
  const last = added[added.length - 1];
  return html`
    <dialog id="quick-add" class="quick-add" ref=${dlg} aria-label="New to-do"
      onClose=${() => { quickOpen.value = false; }} onClick=${(ev) => { if (ev.target === dlg.current) quickOpen.value = false; }}>
      <form onSubmit=${submit}>
        <div class="entry">
          <input ref=${input} id="quick-input" onInput=${onInput} class=${`input${shownP === 'none' ? ' no-word' : ''}`} placeholder="New to-do…"
            aria-label="New to-do" maxlength="500" autocomplete="off" />
          <button type="button" class=${`flag-btn p-${shownP}`} aria-label=${`Priority for new to-do: ${LABELS[shownP]}. Click to change`}
            title=${`Priority: ${LABELS[shownP]} (click to change)`} onClick=${() => { setP(CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]); input.current.focus(); }}>
            <span class="word">${shownP === 'none' ? '' : LABELS[shownP]}</span><${Icon} name=${`prio-${shownP}`} cls=${`flag-${shownP}`} /></button>
        </div>
        <${Understood} r=${r} />
        <p class="quick-keys" aria-live="polite">
          ${added.length ? html`<span class="quick-added" key=${added.length}><${Icon} name="check-circle" />${added.length} added · “${last}”</span>` : ''}
          <span class="quick-help"><kbd>Enter</kbd> add · <kbd>Esc</kbd> ${added.length ? 'done' : 'cancel'}</span></p>
      </form>
    </dialog>`;
}

// ---- Edit panel (Issue #60, option A) -------------------------------------
// Compact, and every change applies straight away: an Undo note shows inside
// the panel (a page toast would sit behind the open dialog). One Done button
// (Enter in the title also closes); the title saves when you leave it.
function EditSheet() {
  const dlg = useRef(), text = useRef(), noteRef = useRef();
  const e = editing.value;
  const t = e && todos.value.find((x, i) => keyOf(x, i) === e.key);
  const [startList, setStartList] = useState(false);
  const [noteOn, setNoteOn] = useState(false);
  const [timeOn, setTimeOn] = useState(false);
  const [armed, setArmed] = useState(false);
  const [undo, setUndo] = useState(null), undoT = useRef();
  useEffect(() => {
    if (!e) { if (dlg.current.open) dlg.current.close(); return; }
    setUndo(null); setStartList(false); setNoteOn(!!e.note); setTimeOn(false); setArmed(false);
    text.current.value = e.text; grow(text.current);
    dlg.current.showModal();
  }, [e]);
  const grow = (b) => { if (!b) return; b.style.height = 'auto'; b.style.height = `${b.scrollHeight}px`; };
  const cur = () => todos.value.find((x, i) => keyOf(x, i) === e?.key);
  // Apply a change now, with an Undo note.
  const apply = (changes, said, icon = 'check') => {
    const x = cur(); if (!x || !ready()) return;
    const before = {}; Object.keys(changes).forEach((k) => { before[k] = x[k] ?? null; });
    update(x, changes);
    // The app's toast sits behind an open dialog, so the Undo note lives inside the panel.
    clearTimeout(undoT.current);
    setUndo({ said, icon, run() { const y = cur(); if (y) update(y, before); setUndo(null); } });
    undoT.current = setTimeout(() => setUndo(null), 4000);
  };
  const saveText = () => { const x = cur(); if (!x || !text.current) return; const v = text.current.value.trim().slice(0, 500); if (v && v !== x.text) update(x, { text: v }); };
  const close = () => { saveText(); const k = editing.value?.key; editing.value = null;
    setTimeout(() => document.querySelector(`#todo-groups [data-edit="${k}"]`)?.focus({ preventScroll: true })); };
  const del = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
    const x = cur(); if (x && remove(x)) window.AppToast?.show(`“${x.text}” deleted`, { icon: 'trash' });
    editing.value = null;
  };
  if (!t) return html`<dialog id="edit-todo" ref=${dlg} class="sheet compact"></dialog>`;
  const due = validDue(t.due) ? t.due : '', time = validTime(t.time) ? t.time : '', tonight = !!t.evening && due === today.value;
  const setPrio = (v) => apply({ p: v }, `Priority: ${v === 'none' ? 'none' : LABELS[v]}`, `prio-${v}`);
  const setDate = (v) => { const ch = { due: v || null }; if (t.evening) ch.evening = false; if (!v || (v === today.value && (isEveningTime(time) || isPast(v, time)))) ch.time = null;
    apply(ch, v ? withTime(dueLabel(v), { time: ch.time === null ? null : time }) : 'Date removed', v ? 'calendar-blank' : 'x'); };
  const setT = (v) => { const ch = { time: v || null }; if (due === today.value) ch.evening = isEveningTime(v); apply(ch, v ? `At ${fmtTime(v)}` : 'Time removed', 'clock'); };
  const star = () => apply({ starred: !t.starred }, t.starred ? 'Unstarred' : 'Starred', t.starred ? 'star' : 'star-fill');
  const prioChips = html`<div class="seg chips" role="group" aria-label="Priority">
    ${['high', 'med', 'low', 'none'].map((v) => html`<button type="button" class=${`chip ${v}`} aria-pressed=${t.p === v} onClick=${() => setPrio(v)}>
      <${Icon} name=${`prio-${v}`} cls=${`flag-${v}`} />${v === 'none' ? 'None' : LABELS[v]}</button>`)}</div>`;
  const dueField = html`<${DueField} value=${due} tonight=${tonight} open=${!!e} onChange=${setDate} />`;
  const timeSel = due && (time || timeOn) && html`<div class="time-row"><label for="edit-time">At</label>
    <select id="edit-time" class="input time-input" value=${time} onChange=${(ev) => setT(ev.target.value)}>
      ${!time && html`<option value="">Pick a time…</option>`}
      ${[...new Set([...TIME_OPTIONS, ...(time ? [time] : [])])].sort().map((v) => html`<option value=${v} disabled=${v !== time && ((tonight && !isEveningTime(v)) || isPast(due, v))}>${fmtTime(v)}</option>`)}
    </select>${time && html`<button type="button" class="btn ghost" onClick=${() => { setT(''); setTimeOn(false); }}>Remove</button>`}</div>`;
  const listBlock = (itemsOf(t).length || startList) && html`<p class="mini-label"><${Icon} name="list-checks" />Checklist${progress(t) ? ` · ${progress(t)}` : ''}</p><${Checklist} t=${t} autoFocus=${startList} />`;
  const noteBlock = noteOn && html`<p class="mini-label"><${Icon} name="note" />Note</p>
    <textarea ref=${noteRef} class="textarea note-input" rows="2" maxlength="2000" aria-label="Note" placeholder="Details, links, who to ask…" value=${noteOf(t)}
      onBlur=${(ev) => { const v = ev.target.value.trim().slice(0, 2000); if (v !== noteOf(t)) update(t, { note: v || null }); }}></textarea>`;
  const titleRow = html`<div class="title-row"><label for="edit-text" class="visually-hidden">To-do</label>
    <textarea id="edit-text" ref=${text} class="textarea" rows="1" maxlength="500" onInput=${(ev) => grow(ev.target)} onBlur=${saveText}
      onKeyDown=${(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); close(); } }}></textarea>
    <button type="button" class=${`icon-star${t.starred ? ' on' : ''}`} id="edit-star" aria-pressed=${!!t.starred} aria-label="Starred" onClick=${star}><${Icon} name=${t.starred ? 'star-fill' : 'star'} /></button></div>`;
  const body = html`
      ${titleRow}
      <p class="mini-label"><${Icon} name="prio-high" />Priority</p>${prioChips}
      <p class="mini-label"><${Icon} name=${tonight ? 'moon' : 'calendar-blank'} />When${tonight ? ' · Tonight' : ''}</p>${dueField}${timeSel}
      ${listBlock}${noteBlock}
      <div class="add-chips">
        <button type="button" class=${`add-chip myday-chip${inMyDay(t) ? ' on' : ''}`} id="edit-myday" aria-pressed=${inMyDay(t)}
          onClick=${() => apply({ myDay: inMyDay(t) ? null : today.value }, inMyDay(t) ? 'Taken out of My Day' : 'Added to My Day', 'sun')}>
          <${Icon} name="sun" />${inMyDay(t) ? 'In My Day' : 'My Day'}</button>
        ${due && !time && !timeOn && html`<button type="button" class="add-chip" id="edit-time-add" onClick=${() => setTimeOn(true)}><${Icon} name="clock" />Time</button>`}
        ${!itemsOf(t).length && !startList && html`<button type="button" class="add-chip" onClick=${() => setStartList(true)}><${Icon} name="list-checks" />Checklist</button>`}
        ${!noteOn && html`<button type="button" class="add-chip" id="edit-note-add" onClick=${() => { setNoteOn(true); setTimeout(() => noteRef.current?.focus()); }}><${Icon} name="note" />Note</button>`}
      </div>
      <div class="row edit-actions">
        <button type="button" class="quiet-delete" id="edit-delete" aria-live="polite" onClick=${del}>${armed ? 'Tap again to delete' : 'Delete'}</button>
        <button type="button" class="btn primary done-btn" id="edit-done" onClick=${close}>Done</button></div>`;
  return html`<dialog id="edit-todo" ref=${dlg} class="sheet compact" aria-label="Edit to-do"
      onClose=${() => { if (editing.value) close(); }} onClick=${(ev) => { if (ev.target === dlg.current) close(); }}>
    <div class="edit-form"><span class="sheet-grab" aria-hidden="true"></span>
      <div class="sheet-undo" role="status" aria-live="polite">${undo && html`<${Icon} name=${undo.icon} /><span>${undo.said}</span>
        <button type="button" class="sheet-undo-btn" onClick=${undo.run}><${Icon} name="arrow-counter-clockwise" />Undo</button>`}</div>
      ${body}</div></dialog>`;
}

// One-line summary under the title, e.g. "3 to do · 2 done today".
function Summary() {
  if (loading.value && !todos.value.length) return 'Loading your to-dos…';
  const all = todos.value.filter((t) => !t.archived);   // archived ones don't count (Issue #49)
  if (!all.length) return 'Nothing on your list yet';
  if (view.value !== 'all') {   // a view is open (Issue #71): its own count, and the total
    const n = countOf(view.value), left = all.filter((t) => !t.done).length;
    if (view.value === 'completed') return `${n} done`;
    return n ? `${n} to do here · ${left} in all` : `${left} to do in all`;
  }
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const left = all.filter((t) => !t.done).length;
  const doneToday = all.filter((t) => t.done && Number.isFinite(t.doneAt) && t.doneAt >= startOfToday).length;
  const doneTxt = doneToday ? ` · ${doneToday} done today` : '';
  // Due today / overdue totals, starred ones included (Issue #23); only when there are any.
  const dueToday = all.filter((t) => dueState(t) === 'today').length;
  const overdue = all.filter((t) => dueState(t) === 'overdue').length;
  const dueTxt = (dueToday ? ` · ${dueToday} due today` : '') + (overdue ? ` · ${overdue} overdue` : '');
  // Non-breaking spaces inside each part, so a narrow screen wraps between parts, not mid-part.
  const keep = (x) => x.replace(/(\d) /g, '$1\u00a0').replace(/ (today|do)\b/g, '\u00a0$1');
  const updTxt = updating.value ? ' · Updating…' : '';   // showing the saved copy until the server answers (Issue #36)
  return keep(left ? `${left} to do${dueTxt}${doneTxt}${updTxt}` : `All done!${doneTxt}${updTxt}`);
}

function App() {
  return html`<${TodoList} />`;
}

render(html`<${App} />`, document.getElementById('todo-groups'));
// The Lists button and tappable title replace the page's own heading (Issue #71).
const head = document.querySelector('#app > h1'), vh = document.createElement('div');
vh.className = 'view-head'; head.before(vh); head.remove();
render(html`<${ViewHead} />`, vh);
const lp = document.createElement('div'); document.body.append(lp); render(html`<${ListsPanel} />`, lp);
// One-time tip (per stage): how to star.
setTimeout(() => {
  const key = `swipe-tip:${window.STAGE || 'local'}`;
  try {
    if (window.COMPARE) return;   // not while comparing stages (Issue #69)
    if (localStorage.getItem(key) || !todos.value.some((t) => !t.done)) return;
    localStorage.setItem(key, '1');
  } catch { return; }
  window.AppToast?.show('Tip: swipe a to-do right to star it, left for tomorrow', { icon: 'star', duration: 6000 });
}, 2500);
render(html`<${Summary} />`, document.getElementById('summary'));
// The add bar and edit sheet sit outside the list (fixed bar, modal sheet).
const extras = document.createElement('div');
document.body.append(extras);
render(html`<${AddBar} /><${EditSheet} /><${QuickAdd} /><${DueMenu} />`, extras);
