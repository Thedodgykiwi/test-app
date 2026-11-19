// The to-do screen, as Preact components (React-style, no build step; Issue #13).
// Data and saving live in store.js; this file only draws and handles taps.
// Layout "B": one list sorted by priority with coloured signal bars on each row,
// Done (closed by default) with centred date dividers, add bar at the bottom.
import { html, render } from 'htm/preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { todos, loading, updating, fresh, ready, collapsed, toggleCollapsed, update, add, remove, restore, keyOf, LEVELS, LABELS, lists, addList, updateList, removeList } from './store.js';

// Phosphor icon from icons.js
const Icon = ({ name, cls = '' }) => html`<span class="icon-wrap" ref=${(el) => {
  if (el && el.dataset.n !== name + cls) { el.replaceChildren(icon(name, cls)); el.dataset.n = name + cls; }
}} />`;

// ---- Reminders (Issue #51, option C) ----------------------------------------
// A to-do with a date and a time reminds you at the Settings default (Settings → Reminders:
// at the time, 15 min or 1 hour before), unless its own choice in the edit panel says
// otherwise: `remind` = 'off' | 0 | 15 | 60 (missing / null = follow the default).
// One reminder channel per device: while this device has no phone notifications, the app
// shows its own reminder card when it's open (RemindCard). Phone notifications: part 2.
const PREFS_KEY = `prefs:${location.pathname.split('/')[1] || 'app'}`;
const REM_LEADS = [0, 15, 60];
const readLead = () => { try { const v = +JSON.parse(localStorage.getItem(PREFS_KEY) || '{}').remindLead; return REM_LEADS.includes(v) ? v : 15; } catch { return 15; } };
const remLead = signal(readLead());
// This device's reminder channel: 'push' once phone notifications are on (sync.js keeps it up to date).
window.REMIND_CHANNEL ??= localStorage.getItem(`push-on-${window.STAGE || 'local'}`) === '1' && window.Notification?.permission === 'granted' ? 'push' : 'app';
addEventListener('prefschange', () => { remLead.value = readLead(); });
function remOf(t) {   // minutes before its time, or null for no reminder
  if (!t || t.done || t.archived || !validDue(t.due) || !validTime(t.time) || t.remind === 'off') return null;
  return REM_LEADS.includes(t.remind) ? t.remind : remLead.value;
}
const leadWords = (n) => (n === 0 ? 'at the time' : n === 60 ? '1 hour before' : `${n} min before`);
const remSeenKey = `reminded-${window.STAGE || 'local'}`;
const remSeen = (() => { try { return JSON.parse(localStorage.getItem(remSeenKey)) || {}; } catch { return {}; } })();
const saveSeen = () => { try { localStorage.setItem(remSeenKey, JSON.stringify(remSeen)); } catch { /* full */ } };
const remKey = (t) => `${t.id || t.text}|${t.due}|${t.time}`;
// Snoozed until (ms), while it's still ahead: saved on the to-do (signed in) or on this device.
// Reading minuteTick re-draws rows each minute, so the snooze time drops off once it has passed.
const minuteTick = signal(0);
setInterval(() => { minuteTick.value++; }, 60000);
function snoozedUntil(t) {
  minuteTick.value;
  const v = typeof t.snooze === 'number' ? t.snooze : remSeen[`${t.id || t.text}|${t.due}|${t.time}`]?.snooze;
  return !t.done && v > Date.now() ? v : 0;
}
const clockOf = (ms) => { const d = new Date(ms); return fmtTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); };
function cancelSnooze(t) {
  const s = remSeen[remKey(t)]; if (s?.snooze) { delete s.snooze; saveSeen(); }
  if (typeof t.snooze === 'number' && ready()) update(t, { snooze: null });
}
const remAt = (t) => { const [y, m, d] = t.due.split('-').map(Number), [h, mi] = t.time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };

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
  if (cur.id) navigator.serviceWorker?.ready.then((r) => r.getNotifications({ tag: `todo-${cur.id}` })).then((ns) => ns.forEach((n) => n.close())).catch(() => {});   // Issue #51
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

// Swipe a row right or left to do what Settings says (Issue #81; default: right
// stars / un-stars, left sends it to tomorrow, or forward to today when it's
// already due tomorrow, or asks "When?" for a to-do with no date, Issue #39). Vertical moves still scroll
// the page; a tap still opens the editor. Done to-dos don't swipe.
// ---- Choose what each swipe does (Issue #81) -------------------------------
const SWIPE_ACTIONS = window.SWIPE_ACTIONS;   // the list of actions lives in menu.js (Settings)
const swipePrefs = signal(readSwipePrefs());
function readSwipePrefs() {
  try { const p = JSON.parse(localStorage.getItem(`prefs:${location.pathname.split('/')[1] || 'app'}`) || '{}');
    return { right: SWIPE_ACTIONS[p.swipeRight] ? p.swipeRight : 'star', left: SWIPE_ACTIONS[p.swipeLeft] ? p.swipeLeft : 'tomorrow' }; } catch { return { right: 'star', left: 'tomorrow' }; }
}
addEventListener('prefschange', () => { swipePrefs.value = readSwipePrefs(); });
const swipeMenu = signal(null);   // { key, kind: 'priority' | 'list', right, top, bottom }
// What the swipe layer says for this to-do (some actions flip: Star/Unstar, Tomorrow/Today/When?).
function swipeFace(id, t) {
  const a = SWIPE_ACTIONS[id];
  if (id === 'star') return t.starred ? { label: 'Unstar', icon: 'star' } : { label: 'Star', icon: 'star-fill' };
  if (id === 'tomorrow') return !validDue(t.due) ? { label: 'When?', icon: 'calendar-blank' } : t.due === tomorrowDay() ? { label: 'Today', icon: 'clock' } : { label: 'Tomorrow', icon: 'arrow-right' };
  if (id === 'myday') return inMyDay(t) ? { label: 'Remove', icon: 'sun' } : { label: 'My Day', icon: 'sun' };
  if (id === 'list') return { label: 'List', icon: 'folder-simple' };
  if (id === 'priority') return { label: 'Priority', icon: 'flag' };
  if (id === 'none') return { label: 'None', icon: 'x' };
  return { label: a.label, icon: a.icon };
}
function runSwipe(id, t, k, el) { 
  if (!ready() || id === 'none') return;
  const r = el.getBoundingClientRect(), at = { key: k, right: r.right - 12, top: r.top + 6, bottom: r.bottom - 6 };
  if (id === 'star') setStar(t, k, !t.starred);
  else if (id === 'tomorrow') {
    if (!validDue(t.due)) dueMenu.value = at;
    else if (t.due === tomorrowDay()) setDue(k, today.value, 'moved to today');
    else setDue(k, tomorrowDay(), 'moved to tomorrow');
  } else if (id === 'done') markDone(t, k);
  else if (id === 'delete') {
    const copy = { ...t };
    if (remove(t)) window.AppToast?.show(`“${t.text}” deleted`, { icon: 'trash',
      action: { label: 'Undo', icon: 'arrow-counter-clockwise', onClick() { restore(copy); } } });
  } else if (id === 'myday') {
    const on = inMyDay(t);
    update(t, { myDay: on ? null : today.value });
    window.AppToast?.show(`“${t.text}” ${on ? 'taken out of My Day' : 'added to My Day'}`, { icon: 'sun' });
  } else if (id === 'priority' || id === 'list') swipeMenu.value = { ...at, kind: id };
  else if (id === 'edit') openEditor(t, k);
}
function SwipeMenu() {
  const m = swipeMenu.value, box = useRef();
  const t = m && todos.value.find((x, i) => keyOf(x, i) === m.key);
  useEffect(() => {
    if (!m || !box.current) return;
    const el = box.current, h = el.offsetHeight, w = el.offsetWidth;
    const below = m.bottom + 6;
    el.style.top = `${below + h <= innerHeight - 8 ? below : Math.max(8, m.top - h - 6)}px`;
    el.style.left = `${Math.max(8, Math.min(m.right - w, innerWidth - w - 8))}px`;
    el.style.visibility = 'visible';
    el.querySelector('button')?.focus({ preventScroll: true });
    const away = (e) => { if (!el.contains(e.target)) swipeMenu.value = null; };
    const gone = () => { swipeMenu.value = null; };
    document.addEventListener('pointerdown', away, true);
    const esc = (e) => { if (e.key === 'Escape') swipeMenu.value = null; };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  }, [m]);
  if (!m || !t) return null;
  const items = m.kind === 'priority'
    ? LEVELS.map((p) => [`prio-${p}`, LABELS[p], () => { update(t, { p }); window.AppToast?.show(`“${t.text}”: ${LABELS[p]}`, { icon: 'flag' }); }, t.p === p])
    : [...lists.value.map((l) => ['folder-simple', l.name, () => { update(t, { list: l.id }); window.AppToast?.show(`“${t.text}” moved to ${l.name}`, { icon: 'folder-simple' }); }, t.list === l.id]),
       ...(t.list ? [['x', 'No list', () => update(t, { list: null }), false]] : [])];
  return html`<div class="due-menu" ref=${box} role="menu" style="visibility:hidden" aria-label=${m.kind === 'priority' ? 'Set priority' : 'Move to a list'}>
    ${items.map(([ic, label, run, on]) => html`<button type="button" role="menuitem" aria-current=${on ? 'true' : undefined} onClick=${() => { swipeMenu.value = null; run(); }}><${Icon} name=${ic} />${label}${on ? ' ✓' : ''}</button>`)}
    ${items.length === 0 && html`<button type="button" disabled>No lists yet</button>`}
  </div>`;
}
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
    if (st.dx >= SWIPE_AT) setTimeout(() => runSwipe(swipePrefs.value.right, t, k, el), 180);
    else if (st.dx <= -SWIPE_AT) setTimeout(() => runSwipe(swipePrefs.value.left, t, k, el), 180);
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
  if (typeof cur.snooze === 'number') ch.snooze = null;   // a snooze was for the old date (Issue #51)
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
      ${!t.done && (() => { const R = swipePrefs.value.right, L = swipePrefs.value.left, fr = swipeFace(R, t), fl = swipeFace(L, t);
        return html`<div class=${`swipe-under act-${R}`} aria-hidden="true"><${Icon} name=${fr.icon} />${fr.label}</div>
          <div class=${`swipe-under left act-${L}`} aria-hidden="true">${fl.label}<${Icon} name=${fl.icon} /></div>`; })()}
      <div class="todo-row" ref=${row} ...${handlers}>
        <input type="checkbox" id=${id} checked=${t.done} onChange=${tick} aria-label=${`Done: ${t.text}`} />
        <div class="text-col">
          <button type="button" class="text" data-edit=${k} aria-label=${`Edit “${t.text}”${t.starred ? ' (starred)' : ''}${ds ? `, ${withTime(dueLabel(t.due), t)}` : ''}`}
            onClick=${() => { if (swallowClick || !ready()) return; openEditor(t, k); }}>
            <span class="t-main">${t.text}</span></button>
          ${ds && html`<button type="button" class=${`due-label due-${ds}${ds === 'today' && t.evening ? ' tn' : ''}`} data-due-btn=${k} aria-haspopup="menu" aria-expanded=${dueMenu.value?.key === k}
            aria-label=${`${withTime(dueLabel(t.due), t)}${remOf(t) !== null ? (snoozedUntil(t) ? `, reminder snoozed until ${clockOf(snoozedUntil(t))}` : ', reminder on') : ''}. Change the due date`}
            onClick=${(e) => {   // tap the label for a quick menu: Tomorrow, Pick a date, No date (Issue #38)
              if (swallowClick || !ready()) return;
              if (dueMenu.value?.key === k) { dueMenu.value = null; return; }
              const r = e.currentTarget.getBoundingClientRect();
              dueMenu.value = { key: k, left: r.left, top: r.top, bottom: r.bottom };
            }}><${Icon} name=${ds === 'today' && t.evening ? 'moon' : DUE_ICON[ds]} />${withTime(ds === 'today' && t.evening ? 'Tonight' : dueLabel(t.due), t)}${remOf(t) !== null && html`<${Icon} name="bell" cls="rem-bell" />${snoozedUntil(t) ? html`<span class="snz">${clockOf(snoozedUntil(t))}</span>` : ''}`}<${Icon} name="caret-down" cls="caret" /></button>`}
          ${itemsOf(t).length > 0 && html`<button type="button" class=${`sub-pill${expanded.value.has(k) ? ' open' : ''}`}
            aria-expanded=${expanded.value.has(k)} aria-label=${`Checklist, ${progress(t)} done. ${expanded.value.has(k) ? 'Hide' : 'Show'} it`}
            onClick=${() => { if (swallowClick) return; const s = new Set(expanded.value); s.has(k) ? s.delete(k) : s.add(k); expanded.value = s; }}>
            <${Icon} name="list-checks" />${progress(t)}<${Icon} name="caret-down" cls="caret" /></button>`}
          ${noteOf(t) && html`<button type="button" class=${`sub-pill note-pill${noteOpen.value.has(k) ? ' open' : ''}`}
            aria-expanded=${noteOpen.value.has(k)} aria-label=${`Note. ${noteOpen.value.has(k) ? 'Hide' : 'Show'} it`}
            onClick=${() => { if (swallowClick) return; const s = new Set(noteOpen.value); s.has(k) ? s.delete(k) : s.add(k); noteOpen.value = s; }}>
            <${Icon} name="note" />Note<${Icon} name="caret-down" cls="caret" /></button>`}
          ${!t.done && inMyDay(t) && curView() !== 'myday' && html`<span class="meta-tag"><${Icon} name="sun" />My Day</span>`}
          ${listOf(t.list) && curView() !== `list:${t.list}` && html`<span class="meta-tag list-tag"><i style=${`background:${lc(listOf(t.list))}`}></i>${listOf(t.list).name}</span>`}
        </div>
        ${t.starred && !t.done && !['all', 'important'].includes(curView()) && html`<span class="row-star" title="Starred"><${Icon} name="star-fill" /><span class="visually-hidden">Starred</span></span>`}
        ${t.p !== 'none' && html`
          <span class="row-flag" title=${`Priority: ${LABELS[t.p]}`}>
            <${Icon} name=${`prio-${t.p}`} cls=${`flag-${t.p}`} /><span class="visually-hidden">Priority: ${LABELS[t.p]}</span>
          </span>`}
      </div>
      ${!t.done && expanded.value.has(k) && itemsOf(t).length > 0 && html`<div class="row-sub"><${Checklist} t=${t} compact=${true} /></div>`}
      ${noteOpen.value.has(k) && noteOf(t) && html`<div class="row-sub"><${NoteText} t=${t} k=${k} /></div>`}
    </li>`;
}

function DoneSection({ done: allDone, always }) {
  const closed = !always && !collapsed.value.has('done-open');   // Completed view: always open (Issue #71)
  const now = new Date();
  const [tidy, setTidy] = useState(false);   // "Tidy up" menu (Issue #49, option B)
  // Under the other views: only what was ticked off today, plus a link to Completed,
  // which keeps the history, its date groups and Tidy up (Issue #74).
  if (!always) {
    const done = allDone.filter(([t]) => doneRange(t, now) === 'today');
    const total = todos.value.filter((t) => t.done && !t.archived).length;
    const seeAll = html`<button type="button" class="see-all" onClick=${() => setView('completed')}>See all completed${total > done.length ? ` (${total})` : ''}<${Icon} name="arrow-right" /></button>`;
    return html`<div class="group group-done today-only">
      ${done.length > 0 && html`<h2><button type="button" class="group-toggle" data-group="done" aria-expanded=${!closed} aria-controls="group-list-done"
        title=${closed ? 'Show this section' : 'Hide this section'}
        onClick=${() => { toggleCollapsed('done-open'); focusAfter = ['[data-group="done"]']; }}>
        <${Icon} name=${closed ? 'caret-right' : 'caret-down'} cls="chevron" /><${Icon} name="check-circle" cls="done-icon" />Done today · ${done.length}</button></h2>
      <ul class="todos vg-list" id="group-list-done" hidden=${closed}>${done.map(([t, i]) => html`<${Row} key=${keyOf(t, i)} t=${t} k=${keyOf(t, i)} />`)}</ul>`}
      ${seeAll}</div>`;
  }
  const done = allDone;
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
const view = signal(VIEWS.some(([k]) => k === savedView) || /^list:/.test(savedView || '') ? savedView : 'all');
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
const viewInfo = (v) => { if (v.startsWith('list:')) { const l = listOf(v.slice(5)); if (l) return [v, l.icon, l.name, l]; } return VIEWS.find(([k]) => k === v) || VIEWS[0]; };
function inView(v, t) {
  if (v === 'myday') return inMyDay(t);
  if (v === 'important') return !!t.starred;
  if (v === 'planned') return validDue(t.due) && !t.done;
  if (v === 'completed') return !!t.done;
  if (v.startsWith('list:')) return t.list === v.slice(5);
  return true;
}
const countOf = (v) => todos.value.filter((t) => !t.archived && (v === 'completed' ? t.done : !t.done) && inView(v, t)).length;
function setView(v) {
  view.value = v; listsOpen.value = false;
  try { localStorage.setItem(viewKey, v); } catch { /* storage blocked: not remembered */ }
  document.body.dataset.view = v; scrollTo(0, 0);
  setTimeout(() => document.getElementById('view-title-btn')?.focus({ preventScroll: true }));
}
document.body.dataset.view = curView();

// ---- Your own lists (Issue #72) -------------------------------------------------
// "+ New list" in the Lists panel; each list has a name, one of 12 colours (shown as a
// filled tile behind its icon) and one of 16 icons. Data and syncing: store.js / sync.js.
const LIST_COLORS = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'purple', 'grape', 'pink', 'graphite'];
const LIST_ICONS = ['list', 'house', 'briefcase', 'shopping-cart', 'heart', 'airplane', 'book-open', 'barbell', 'gift', 'folder-simple', 'car', 'paw-print', 'fork-knife', 'wallet', 'wrench', 'graduation-cap'];
function listOf(id) { return id ? lists.value.find((l) => l.id === id) : undefined; }
// The view on screen: a list that no longer exists (deleted here or on another
// device, or with the account) shows All to-dos instead. The saved choice is kept.
function curView() { const v = view.value; return v.startsWith('list:') && !listOf(v.slice(5)) ? 'all' : v; }
const lc = (l) => `var(--lc-${l.color})`;
const listDialog = signal(null);   // { mode: 'new' | 'edit' | 'delete', id }
const listMenu = signal(false);
function ListDialog() {
  const dlg = useRef(), name = useRef();
  const d = listDialog.value, l = d && d.id ? listOf(d.id) : null;
  const [color, setColor] = useState('green'), [ic, setIc] = useState('list');
  useEffect(() => {
    if (!d) { if (dlg.current?.open) dlg.current.close(); return; }
    setColor(l?.color || LIST_COLORS[lists.value.length % LIST_COLORS.length]); setIc(l?.icon || 'list');
    dlg.current.showModal(); setTimeout(() => { if (name.current) { name.current.value = l?.name || ''; name.current.focus(); } });
  }, [d]);
  const close = () => { listDialog.value = null; };
  // Like the to-do edit panel: changes apply at once and there's just Done (also Esc or
  // tapping outside). Editing: colour and icon save on tap, the name when you leave the box.
  // New list: Done makes it if it has a name; with no name, nothing is made.
  const saveName = () => { const n = name.current?.value.trim().slice(0, 40); if (l && n && n !== l.name) updateList(l, { name: n }); };
  const done = (e) => {
    e?.preventDefault(); const cur = listDialog.value; if (!cur || cur.mode === 'delete') { close(); return; }
    const n = name.current?.value.trim().slice(0, 40);
    if (cur.mode === 'edit') { saveName(); close(); return; }
    close(); if (!n) return;
    const made = addList({ name: n, color, icon: ic }); if (!made) return;
    if (cur.forKey != null) {   // made from the edit panel's list picker: put that to-do in it
      const t = todos.value.find((x, i) => keyOf(x, i) === cur.forKey); if (t) update(t, { list: made.id });
    } else setView(`list:${made.id}`);
  };
  const pickColor = (c) => { setColor(c); if (l) updateList(l, { color: c }); };
  const pickIcon = (i) => { setIc(i); if (l) updateList(l, { icon: i }); };
  const n = l ? todos.value.filter((t) => t.list === l.id && !t.archived).length : 0;
  const del = (keep) => { todos.value.filter((t) => t.list === l.id).forEach((t) => (keep ? update(t, { list: null }) : remove(t)));
    removeList(l); close(); setView('all');
    window.AppToast?.show(keep ? `“${l.name}” deleted. Its to-dos are kept, with no list` : `“${l.name}” and its to-dos deleted`, { icon: 'trash' }); };
  return html`<dialog ref=${dlg} class="sheet compact list-dialog" aria-label=${d?.mode === 'delete' ? 'Delete list' : d?.mode === 'edit' ? 'Edit list' : 'New list'}
      onClose=${() => { if (listDialog.value) done(); }} onClick=${(ev) => { if (ev.target === dlg.current) done(); }}>
    ${d && d.mode === 'delete' && l ? html`<div class="edit-form">
        <h2 class="ld-title">Delete “${l.name}”?</h2>
        <p class="muted">${n ? `It has ${n} to-do${n === 1 ? '' : 's'}. What should happen to ${n === 1 ? 'it' : 'them'}?` : 'It has no to-dos.'}</p>
        ${n > 0 && html`<button type="button" class="btn primary ld-btn" onClick=${() => del(true)}>Delete the list, keep its to-dos</button>
        <button type="button" class="btn ld-btn danger-btn" onClick=${() => del(false)}>Delete the list and its ${n} to-do${n === 1 ? '' : 's'}</button>`}
        ${!n && html`<button type="button" class="btn primary ld-btn" onClick=${() => del(true)}>Delete list</button>`}
        <button type="button" class="btn ghost ld-btn" onClick=${close}>Cancel</button></div>`
    : d && html`<form class="edit-form" onSubmit=${done}>
        <h2 class="ld-title">${d.mode === 'new' ? 'New list' : 'Edit list'}</h2>
        <div class="ld-name"><span class=${`tile big c-${color}`}><${Icon} name=${ic} /></span>
          <input ref=${name} class="input" maxlength="40" placeholder="e.g. Home, Work, Errands" aria-label="List name" onBlur=${saveName} /></div>
        <p class="mini-label">Colour</p>
        <div class="ld-colors" role="radiogroup" aria-label="Colour">${LIST_COLORS.map((c) => html`<button type="button" role="radio" aria-checked=${c === color} aria-label=${c[0].toUpperCase() + c.slice(1)}
          class=${`ld-color c-${c}`} onClick=${() => pickColor(c)}>${c === color && html`<${Icon} name="check" />`}</button>`)}</div>
        <p class="mini-label">Icon</p>
        <div class="ld-icons" role="radiogroup" aria-label="Icon">${LIST_ICONS.map((i) => html`<button type="button" role="radio" aria-checked=${i === ic} aria-label=${i.replace(/-/g, ' ')}
          class=${`ld-icon${i === ic ? ` on c-${color}` : ''}`} onClick=${() => pickIcon(i)}><${Icon} name=${i} /></button>`)}</div>
        <div class="row edit-actions"><button type="submit" class="btn primary done-btn">Done</button></div></form>`}
  </dialog>`;
}
function ListMenu() {
  const box = useRef();
  useEffect(() => { if (!listMenu.value) return;
    const off = (e) => { if (!box.current?.contains(e.target) && !e.target.closest('.list-more')) listMenu.value = false; };
    const esc = (e) => { if (e.key === 'Escape') listMenu.value = false; };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); }; }, [listMenu.value]);
  const v = curView(); if (!v.startsWith('list:') || !listMenu.value) return null;
  const id = v.slice(5);
  return html`<div class="tidy-menu list-menu" role="menu" ref=${box}>
    <button type="button" role="menuitem" class="tidy-item" onClick=${() => { listMenu.value = false; listDialog.value = { mode: 'edit', id }; }}><span>Rename, colour or icon</span></button>
    <button type="button" role="menuitem" class="tidy-item danger" onClick=${() => { listMenu.value = false; listDialog.value = { mode: 'delete', id }; }}><span>Delete list…</span></button></div>`;
}
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
        return html`<button type="button" class="lv-item" data-v=${v} aria-current=${curView() === v ? 'page' : null} onClick=${() => setView(v)}>
          <${Icon} name=${ic} cls="lv-ic" /><span class="lv-name">${name}</span>${n > 0 && html`<span class="lv-n" aria-label=${`, ${n}`}>${n}</span>`}</button>`; })}
        <p class="lv-head">Your lists</p>
        ${lists.value.map((l) => { const v = `list:${l.id}`, n = countOf(v);
          return html`<button type="button" class="lv-item" aria-current=${curView() === v ? 'page' : null} onClick=${() => setView(v)}>
            <span class=${`tile c-${l.color}`}><${Icon} name=${l.icon} /></span><span class="lv-name">${l.name}</span>${n > 0 && html`<span class="lv-n">${n}</span>`}</button>`; })}
        <button type="button" class="lv-item lv-new" onClick=${() => { listDialog.value = { mode: 'new' }; }}><${Icon} name="plus" cls="lv-ic" /><span class="lv-name">New list</span></button></nav>
    </aside>`;
}
// Above the title: "‹ Lists". The title itself (app name, or the view's name) also opens the panel.
function ViewHead() {
  const v = curView(), [, ic, name, l] = viewInfo(v), pinned = wide.value;
  const more = l && html`<button type="button" class="list-more" aria-label="List options" aria-expanded=${listMenu.value} onClick=${() => { listMenu.value = !listMenu.value; }}><${Icon} name="dots-three" /></button>`;
  const toggle = () => { if (!pinned) listsOpen.value = !listsOpen.value; };
  return html`
    ${!pinned && html`<button type="button" class="lists-btn" aria-expanded=${listsOpen.value} onClick=${toggle}><${Icon} name="caret-left" />Lists</button>`}
    <h1 class="view-title" data-v=${v}>${pinned ? html`<span class="vt">${v === 'all' ? html`<${Icon} name="list-checks-duotone" cls="title-icon" />The Shortlist` : html`<${Icon} name=${ic} cls="vt-ic" />${name}`}</span>`
      : html`<button type="button" id="view-title-btn" class="vt" aria-haspopup="dialog" aria-expanded=${listsOpen.value} title="Lists" onClick=${toggle}>
        ${v === 'all' ? html`<${Icon} name="list-checks-duotone" cls="title-icon" />The Shortlist` : html`${l ? html`<span class=${`tile big c-${l.color}`}><${Icon} name=${ic} /></span>` : html`<${Icon} name=${ic} cls="vt-ic" />`}${name}`}<${Icon} name="caret-down" cls="vt-caret" /></button>`}${more}</h1><${ListMenu} />`;
}
const dayName = (d) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function TodoList() {
  // Archived to-dos (Issue #49) are kept but never shown.
  const v = curView();
  document.body.dataset.view = v;   // keep the page's view styles in step (e.g. a deleted list falls back to All)
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
  if (v !== 'all' && !all.length && !loading.value) return html`<p class="empty">${EMPTY[v] || 'Nothing in this list yet. Add one below.'}</p>`;
  const ls = listStyle.value;
  if ((['myday', 'important', 'planned'].includes(v) || v.startsWith('list:')) && ls !== 'boxes' && active.length) {
    // Slim headings by when: Planned per day; My Day, Important and your own lists by Overdue / Today / Tonight / … (Issue #82)
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
    ${done.length > 0 && html`<${DoneSection} key=${v === 'completed' ? 'all' : 'today'} done=${done} always=${v === 'completed'} />`}
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
  let text = raw.trim(), due = '', dueWord = '', p = '', time = '', starred = false, list = '';
  // "#home" at the start or end puts it in one of your own lists (Issue #72).
  const lm = text.match(/(?:^|\s)#([\p{L}\d-]+)$/u) || text.match(/^#([\p{L}\d-]+)(?=\s|$)/u);
  if (lm) { const l = lists.value.find((x) => listKey(x) === lm[1].toLowerCase()); if (l) { list = l.id; text = text.replace(lm[0], '').trim(); } }
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
  return { text: text.slice(0, 500), due, dueWord, p, time, pastTime, starred, list, evening: dueWord === 'tonight' };
}
// Adds what was typed, with whatever was understood. The priority button's
// own choice is the fallback. Returns the parsed entry, or null if nothing added.
function addParsed(raw, pFallback) {
  const r = parseEntry(raw);
  // Added while a view is open: it goes into that view (Issue #71).
  const v = curView(), due = r.due || (v === 'planned' ? today.value : undefined);
  const list = r.list || (v.startsWith('list:') ? v.slice(5) : undefined);
  if (!r.text || !add(r.text, r.p || pFallback, due, r.evening, r.time, r.starred || v === 'important', v === 'myday' ? today.value : undefined, list)) return null;
  return r;
}
// Typing "#" + a few letters offers your lists to finish the word (Issue #72).
// "Mum's Car" is typed as #mumscar: lower case, spaces and punctuation dropped.
const listKey = (l) => l.name.toLowerCase().replace(/[^\p{L}\d-]/gu, '');
function listHits(v) {
  const m = v.match(/(?:^|\s)#([\p{L}\d-]*)$/u);
  if (!m || !lists.value.length) return null;
  const q = m[1].toLowerCase(), hits = lists.value.filter((l) => listKey(l).startsWith(q)).slice(0, 6);
  if (hits.length === 1 && listKey(hits[0]) === q) return null;   // already typed in full
  return { q: m[1], hits };
}
function pickList(input, l, after) {
  const v = input.value, h = listHits(v); if (!h) return;
  input.value = `${v.slice(0, v.length - h.q.length)}${listKey(l)} `;
  input.focus(); after();
}
function ListSuggest({ input, after }) {
  const h = input.current && listHits(input.current.value);
  if (!h) return null;
  return html`<div class="list-sugg" aria-live="polite">
    ${h.hits.length ? h.hits.map((l, i) => html`<button type="button" class="u-chip list-chip ls-btn" title=${i === 0 ? 'Tab to pick' : ''}
        aria-label=${`Put it in ${l.name}`} onPointerDown=${(e) => e.preventDefault()} onClick=${() => pickList(input.current, l, after)}>
        <i style=${`background:${lc(l)}`}></i>${l.name}</button>`)
      : html`<span class="ls-none">No list starting with “${h.q}”</span>`}</div>`;
}
// Tab finishes the "#…" word with the first suggested list.
const tabPick = (input, after) => (e) => {
  if (e.key !== 'Tab' || e.shiftKey) return;
  const h = listHits(input.current.value); if (!h?.hits.length) return;
  e.preventDefault(); pickList(input.current, h.hits[0], after);
};
function Understood({ r }) {
  if (!r || (!r.due && !r.p && !r.starred && !r.list)) return null;
  return html`<div class="understood" aria-live="polite">
    ${r.due && html`<span class="u-chip due"><${Icon} name=${r.evening ? 'moon' : 'calendar-blank'} />${r.evening ? 'Tonight' : `Due ${r.dueWord}`}</span>`}
    ${r.time && html`<span class="u-chip due"><${Icon} name="clock" />at ${fmtTime(r.time)}</span>`}
    ${r.pastTime && html`<span class="u-chip past"><${Icon} name="clock" />${fmtTime(r.pastTime)} has passed</span>`}
    ${r.list && listOf(r.list) && html`<span class="u-chip list-chip"><i style=${`background:${lc(listOf(r.list))}`}></i>${listOf(r.list).name}</span>`}
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
          <input id="todo-input" ref=${input} onInput=${onInput} onKeyDown=${tabPick(input, onInput)} class=${`input${shownP === 'none' ? ' no-word' : ''}`} placeholder=${loading.value && updating.value ? 'Connecting…' : hint} autocomplete="off" aria-label="New to-do" maxlength="500" />
          <button type="button" id="new-priority" ref=${flag} class=${`flag-btn p-${shownP}`}
            aria-label=${`Priority for new to-do: ${LABELS[shownP]}. Tap to change`} title=${`Priority: ${LABELS[shownP]} (tap to change)`}
            onClick=${() => { tapped.current = true; setP(CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]); }}>
            <span class="word">${shownP === 'none' ? '' : LABELS[shownP]}</span><${Icon} name=${`prio-${shownP}`} cls=${`flag-${shownP}`} />
          </button>
        </div>
        <button type="submit" class="btn primary" aria-label="Add to-do" title="Add"><${Icon} name="plus" />Add</button>
        <${ListSuggest} input=${input} after=${onInput} />
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
          <input ref=${input} id="quick-input" onInput=${onInput} onKeyDown=${tabPick(input, onInput)} class=${`input${shownP === 'none' ? ' no-word' : ''}`} placeholder="New to-do…"
            aria-label="New to-do" maxlength="500" autocomplete="off" />
          <button type="button" class=${`flag-btn p-${shownP}`} aria-label=${`Priority for new to-do: ${LABELS[shownP]}. Click to change`}
            title=${`Priority: ${LABELS[shownP]} (click to change)`} onClick=${() => { setP(CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]); input.current.focus(); }}>
            <span class="word">${shownP === 'none' ? '' : LABELS[shownP]}</span><${Icon} name=${`prio-${shownP}`} cls=${`flag-${shownP}`} /></button>
        </div>
        <${ListSuggest} input=${input} after=${onInput} />
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
  const setDate = (v) => { const ch = { due: v || null }; if (typeof t.snooze === 'number') ch.snooze = null; if (t.evening) ch.evening = false; if (!v || (v === today.value && (isEveningTime(time) || isPast(v, time)))) ch.time = null;
    apply(ch, v ? withTime(dueLabel(v), { time: ch.time === null ? null : time }) : 'Date removed', v ? 'calendar-blank' : 'x'); };
  const setT = (v) => { const ch = { time: v || null }; if (typeof t.snooze === 'number') ch.snooze = null; if (due === today.value) ch.evening = isEveningTime(v); apply(ch, v ? `At ${fmtTime(v)}` : 'Time removed', 'clock'); };
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
  const curRem = remOf(t);   // Issue #51: per-to-do reminder; choosing the default stores nothing (follows Settings)
  const setRem = (v) => apply({ remind: v === remLead.value ? null : v }, v === 'off' ? 'Reminder off' : `Reminder ${leadWords(v)}`, 'bell');
  const remBlock = time && !t.done && html`<p class="mini-label"><${Icon} name="bell" />Remind me</p>
    <div class="seg chips rem-chips" role="group" aria-label="Remind me">
      ${[['off', 'Off'], [0, 'At the time'], [15, '15 min'], [60, '1 hour']].map(([v, l]) => html`<button type="button" class="chip"
        aria-pressed=${v === 'off' ? curRem === null : curRem === v} onClick=${() => setRem(v)}>${l}</button>`)}</div>`;
  const snz = snoozedUntil(t);
  const snoozeLine = snz && html`<p class="rem-snoozed"><${Icon} name="clock" />Snoozed until ${clockOf(snz)} · <button type="button" class="link-btn" onClick=${() => cancelSnooze(t)}>Cancel</button></p>`;
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
      <p class="mini-label"><${Icon} name=${tonight ? 'moon' : 'calendar-blank'} />When${tonight ? ' · Tonight' : ''}</p>${dueField}${timeSel}${remBlock}${snoozeLine}
      ${listBlock}${noteBlock}
      <div class="add-chips">
        <label class=${`list-pick${listOf(t.list) ? ' set' : ''}`} style=${listOf(t.list) ? `--lcol:${lc(listOf(t.list))}` : ''}><${Icon} name=${listOf(t.list)?.icon || 'list'} /><span class="visually-hidden">List</span>
          <select value=${listOf(t.list) ? t.list : ''} onChange=${(ev) => { const v2 = ev.target.value;
            if (v2 === '__new') { ev.target.value = t.list || ''; listDialog.value = { mode: 'new', forKey: e.key }; return; }
            const x = listOf(v2); apply({ list: x ? x.id : null }, x ? `Moved to ${x.name}` : 'No list', 'list'); }}>
            <option value="">No list</option>${lists.value.map((x) => html`<option value=${x.id}>${x.name}</option>`)}<option value="__new">+ New list…</option></select><${Icon} name="caret-down" cls="lp-caret" /></label>
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
  if (curView() !== 'all') {   // a view is open (Issue #71): its own count, and the total
    const n = countOf(curView()), left = all.filter((t) => !t.done).length;
    if (curView() === 'completed') return `${n} done`;
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
const lp = document.createElement('div'); document.body.append(lp); render(html`<${ListsPanel} /><${ListDialog} />`, lp);
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
// ---- In-app reminder card (Issue #51) ---------------------------------------
// Checks every 20 s (and when the app comes back to the front). A reminder shows from its
// time until an hour after the to-do's time, once; Snooze brings it back in 10 minutes.
// What's been shown or snoozed is kept on this device (`reminded-<stage>`), pruned after 3 days.
const remCard = signal(null);   // { key, k }
function remCheck() {
  if (window.REMIND_CHANNEL === 'push' || remCard.value || loading.value) return;   // phone notifications on this device instead (part 2)
  const now = Date.now();
  for (const k of Object.keys(remSeen)) if (now - (remSeen[k].at || 0) > 3 * 864e5) delete remSeen[k];
  const due = todos.value.map((t, i) => [t, i]).filter(([t]) => remOf(t) !== null).map(([t, i]) => {
    const at = remAt(t), s = remSeen[remKey(t)], snz = typeof t.snooze === 'number' ? t.snooze : 0;
    let show = s ? (s.snooze || Infinity) : at - remOf(t) * 6e4;
    if (snz > (s?.at || 0)) show = Math.min(show, snz);   // snoozed (maybe on another device): show again then
    return { t, k: keyOf(t, i), at, show, until: Math.max(at, snz) + 36e5 };
  }).filter((x) => now >= x.show && now <= x.until).sort((a, b) => a.at - b.at)[0];
  if (due) { remCard.value = { key: remKey(due.t), k: due.k }; remSeen[remKey(due.t)] = { at: now }; saveSeen(); }
}
setInterval(remCheck, 20000);
setTimeout(remCheck, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) remCheck(); });
function RemindCard() {
  const c = remCard.value, box = useRef();
  const found = c && todos.value.map((t, i) => [t, i]).find(([t, i]) => remKey(t) === c.key || keyOf(t, i) === c.k);
  const t = found?.[0], k = found && keyOf(found[0], found[1]);
  useEffect(() => {   // a popover sits above open panels too (top layer); plain fixed card where popovers aren't supported
    const el = box.current; if (!el || !el.showPopover) return;
    try { if (t && !el.matches(':popover-open')) el.showPopover(); if (!t && el.matches(':popover-open')) el.hidePopover(); } catch { /* not supported */ }
  });
  useEffect(() => { if (c && !t) remCard.value = null; }, [c, t]);
  if (!t) return html`<div ref=${box} popover="manual" class="inapp-rem" hidden></div>`;
  const timed = validDue(t.due) && validTime(t.time), mins = timed ? Math.round((remAt(t) - Date.now()) / 6e4) : 0;
  const sub = !timed ? 'Reminder' : mins >= 60 ? `Due in ${mins >= 90 ? Math.round(mins / 60) + ' hours' : '1 hour'} · ${fmtTime(t.time)}` : mins > 0 ? `Due in ${mins} min · ${fmtTime(t.time)}` : mins > -2 ? `Due now · ${fmtTime(t.time)}` : `Was due at ${fmtTime(t.time)}`;
  const close = () => { remCard.value = null; };
  const snooze = () => {   // again in 10 minutes: here, and as a notification on devices that have them (saved on the to-do)
    const when = Date.now() + 6e5;
    remSeen[c.key] = { at: Date.now(), snooze: when }; saveSeen(); close();
    if (t.id && ready()) update(t, { snooze: when });
    window.AppToast?.show(`“${t.text}”: reminding you again in 10 minutes`, { icon: 'bell' });
  };
  const changeDate = (e) => {   // the usual quick date menu, where the card was
    const r = e.currentTarget.getBoundingClientRect(); close();
    setTimeout(() => { dueMenu.value = { key: k, left: r.left, top: r.top, bottom: r.bottom }; }, 50);
  };
  return html`<div ref=${box} popover="manual" class="inapp-rem" role="alert">
    <div class="ir-top">
      <span class="ir-ic"><${Icon} name="bell" /></span>
      <div class="ir-text">
        <button type="button" class="ir-title" onClick=${() => { close(); openEditor(t, k); }}>${t.text}</button>
        <p class="ir-sub">${sub}</p>
      </div>
      <button type="button" class="ir-x" aria-label="Dismiss reminder" onClick=${close}><${Icon} name="x" /></button>
    </div>
    <div class="ir-btns">
      <button type="button" class="btn sm ir-done" onClick=${() => { close(); if (ready()) markDone(t, k); }}><${Icon} name="check" />Done</button>
      <button type="button" class="btn sm" aria-label="Snooze 10 minutes" onClick=${snooze}><${Icon} name="clock" />10 min</button>
      <button type="button" class="btn sm" aria-haspopup="menu" aria-label="Change date" onClick=${changeDate}><${Icon} name="calendar-blank" />Date</button>
    </div>
  </div>`;
}

// Tapping a phone notification opens the app with that to-do's reminder card (?todo=<id>, or a message
// from sw.js when the app is already open). Waits until the list has loaded.
let openWanted = new URLSearchParams(location.search).get('todo');
function openWantedTodo() {
  if (!openWanted || loading.value) return;
  const i = todos.value.findIndex((t) => t.id === openWanted); openWanted = null;
  if (location.search.includes('todo=')) { const u = new URL(location.href); u.searchParams.delete('todo'); history.replaceState(null, '', u); }
  if (i < 0) return;
  const t = todos.value[i], k = keyOf(t, i);
  editing.value = null; dueMenu.value = null;
  if (validDue(t.due) && validTime(t.time)) { remSeen[remKey(t)] = { at: Date.now() }; saveSeen(); }   // shown now: the in-app check won't repeat it
  remCard.value = { key: remKey(t), k };   // its actions: Done / Snooze / Change date; tap the name for the full edit panel
}
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open-todo' && e.data.id) { openWanted = e.data.id; openWantedTodo(); } });
// The service worker also notes each tap (sw.js, '__tapped' in its cache): pick it up when the app
// opens or comes to the front, in case iOS didn't pass the message on.
async function checkTapped() {
  try {
    const reg = await navigator.serviceWorker?.ready; if (!reg) return;
    const scope = reg.scope, cache = await caches.open('app-' + new URL(scope).pathname);
    const res = await cache.match(scope + '__tapped'); if (!res) return;
    await cache.delete(scope + '__tapped');
    const { id, at } = await res.json();
    if (id && Date.now() - at < 5 * 60000) { openWanted = id; openWantedTodo(); }
  } catch { /* no service worker or storage: the ?todo= link still works */ }
}
checkTapped();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkTapped(); });
setInterval(openWantedTodo, 500);

const extras = document.createElement('div');
document.body.append(extras);
render(html`<${AddBar} /><${EditSheet} /><${QuickAdd} /><${DueMenu} /><${SwipeMenu} /><${RemindCard} />`, extras);
