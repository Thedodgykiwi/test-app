// The to-do screen, as Preact components (React-style, no build step; Issue #13).
// Data and saving live in store.js; this file only draws and handles taps.
// Layout "B": one list sorted by priority with a coloured flag on each row,
// Done (closed by default) with centred date dividers, add bar at the bottom.
import { html, render } from 'htm/preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { todos, loading, collapsed, toggleCollapsed, update, add, keyOf, LEVELS, LABELS } from './store.js';

// Phosphor icon from icons.js
const Icon = ({ name, cls = '' }) => html`<span class="icon-wrap" ref=${(el) => {
  if (el && el.dataset.n !== name + cls) { el.replaceChildren(icon(name, cls)); el.dataset.n = name + cls; }
}} />`;

// Short-lived UI state shared between components
const editing = signal(null);     // { key, text, p } while the edit sheet is open
const justEdited = signal(null);  // key of the row to highlight briefly after saving
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
// into a purple "Due today" panel at the top; after it, if still not done,
// into a red "Overdue" panel above that. Its priority flag shows instead.
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const today = signal(isoDay(new Date()));   // re-checked when the app comes back into view
const recheckDay = () => { const t = isoDay(new Date()); if (t !== today.value) today.value = t; };
document.addEventListener('visibilitychange', recheckDay);
setInterval(recheckDay, 60 * 1000);
const validDue = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysUntil = (v) => Math.round((parseDay(v) - parseDay(today.value)) / 864e5);
function dueState(t) {
  if (t.done || !validDue(t.due)) return null;
  const n = daysUntil(t.due);
  return n < 0 ? 'overdue' : n === 0 ? 'today' : 'upcoming';
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
const DUE_ICON = { overdue: 'warning', today: 'clock', upcoming: 'calendar-blank' };

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

// Swipe right on a row to star / un-star it. Vertical moves still scroll the
// page; a tap still opens the editor. Done to-dos don't swipe.
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
      if (dx < 10 || Math.abs(dx) < Math.abs(dy)) return;
      st.dragging = true; row.current.setPointerCapture(st.id); row.current.classList.add('swiping');
    }
    st.dx = Math.max(0, Math.min(dx, 140));
    row.current.style.transform = `translateX(${st.dx}px)`;
    row.current.parentElement.classList.toggle('swipe-ready', st.dx >= SWIPE_AT);
  };
  const up = () => {
    const st = s.current; s.current = null; if (!st?.dragging) return;
    const el = row.current;
    el.classList.remove('swiping'); el.classList.add('settle'); el.style.transform = '';
    setTimeout(() => el.classList.remove('settle'), 250);
    el.parentElement.classList.remove('swipe-ready');
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 60);   // not also a tap
    if (st.dx >= SWIPE_AT) setTimeout(() => setStar(t, k, !t.starred), 180);
  };
  return { row, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}
let swallowClick = false;

function Row({ t, k }) {
  const id = `todo-${k}`;
  const tick = (e) => {
    const done = e.target.checked;
    if (busy.has(k)) return;
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
  const hl = justEdited.value === k;
  const { row, handlers } = useSwipe(t, k);
  const ds = dueState(t);
  return html`
    <li class=${`todo${t.done ? ' done' : ''}${hl ? ' just-edited' : ''}`}>
      ${!t.done && html`<div class="swipe-under" aria-hidden="true"><${Icon} name=${t.starred ? 'star' : 'star-fill'} />${t.starred ? 'Unstar' : 'Star'}</div>`}
      <div class="todo-row" ref=${row} ...${handlers}>
        <input type="checkbox" id=${id} checked=${t.done} onChange=${tick} aria-label=${`Done: ${t.text}`} />
        <button type="button" class="text" data-edit=${k} aria-label=${`Edit “${t.text}”${t.starred ? ' (starred)' : ''}${ds ? `, ${dueLabel(t.due)}` : ''}`}
          onClick=${() => { if (swallowClick) return; editing.value = { key: k, text: t.text, p: t.p, starred: !!t.starred, due: validDue(t.due) ? t.due : '' }; }}>
          <span class="t-main">${t.text}</span>
          ${ds && html`<span class=${`due-label due-${ds}`}><${Icon} name=${DUE_ICON[ds]} />${dueLabel(t.due)}</span>`}</button>
        ${t.starred && !t.done && html`<span class="row-star" title="Starred"><${Icon} name="star-fill" /><span class="visually-hidden">Starred</span></span>`}
        ${t.p !== 'none' && html`
          <span class="row-flag" title=${`Priority: ${LABELS[t.p]}`}>
            <${Icon} name="flag" cls=${`flag-${t.p}`} /><span class="visually-hidden">Priority: ${LABELS[t.p]}</span>
          </span>`}
      </div>
    </li>`;
}

function DoneSection({ done }) {
  const closed = !collapsed.value.has('done-open');
  const now = new Date();
  return html`
    <div class="group group-done">
      <h2><button type="button" class="group-toggle" data-group="done" aria-expanded=${!closed} aria-controls="group-list-done"
        title=${closed ? 'Show this section' : 'Hide this section'}
        onClick=${() => { toggleCollapsed('done-open'); focusAfter = ['[data-group="done"]']; }}>
        <${Icon} name=${closed ? 'caret-right' : 'caret-down'} cls="chevron" /><${Icon} name="check-circle" cls="done-icon" />Done · ${done.length}
      </button></h2>
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

function TodoList() {
  const all = todos.value.map((t, i) => [t, i]);   // keep each to-do's saved position for stable keys
  const active = all.filter(([t]) => !t.done), done = all.filter(([t]) => t.done);
  // After a tick / toggle / edit: focus the first matching element that's visible.
  useEffect(() => {
    if (!focusAfter) return;
    const [sel, fallback] = focusAfter; focusAfter = null;
    const visible = (s) => s && [...document.querySelectorAll(`#todo-groups ${s}`)].find((n) => !n.closest('[hidden]'));
    (visible(sel) || visible(fallback))?.focus();
  });
  // Option D (Issue #19): a soft panel per priority, roomy rows inside.
  // Due today / Overdue (Issue #23) come first, then Starred, then each priority.
  const ds = new Map(active.map(([t]) => [t, dueState(t)]));
  const urgent = ([t]) => ds.get(t) === 'overdue' || ds.get(t) === 'today';
  const byDue = (a, b) => a[0].due.localeCompare(b[0].due);
  const overdue = active.filter(([t]) => ds.get(t) === 'overdue').sort(byDue);
  const dueToday = active.filter(([t]) => ds.get(t) === 'today');
  const rest = active.filter((x) => !urgent(x));
  const starred = rest.filter(([t]) => t.starred);
  const groups = [['overdue', overdue], ['today', dueToday], ['starred', starred],
    ...LEVELS.map((p) => [p, rest.filter(([t]) => t.p === p && !t.starred)])].filter(([, l]) => l.length);
  const HEAD = { overdue: ['warning', 'Overdue'], today: ['clock', 'Due today'], starred: ['star-fill', 'Starred'] };
  return html`
    ${!all.length && html`<p class="empty">${loading.value ? 'Loading your to-dos…' : 'No to-dos yet. Add one below.'}</p>`}
    ${all.length > 0 && !active.length && html`<p class="empty">All done. Nothing left to do!</p>`}
    ${active.length > 0 && html`<div id="todo-list" class="prio-groups">
      ${groups.map(([p, items]) => html`
        <section class=${`prio-group prio-${p}`} key=${p} aria-label=${`${HEAD[p] ? HEAD[p][1] : LABELS[p]}: ${items.length}`}>
          <h2 class="prio-head">${HEAD[p]
            ? html`<${Icon} name=${HEAD[p][0]} />${HEAD[p][1]} · ${items.length}`
            : html`<${Icon} name="flag" cls=${`flag-${p}`} />${LABELS[p]} · ${items.length}`}</h2>
          <ul class="todos prio-list">${items.map(([t, i]) => html`<${Row} key=${keyOf(t, i)} t=${t} k=${keyOf(t, i)} />`)}</ul>
        </section>`)}
    </div>`}
    ${done.length > 0 && html`<${DoneSection} done=${done} />`}
    ${movedHint.value && html`<p class="moved-hint">Moved to Done ↓</p>`}`;
}

// Add bar (fixed at the bottom). The flag picks the new to-do's priority:
// each tap moves none → Low → Medium → High → none; it resets after each add.
const CYCLE = ['none', 'low', 'med', 'high'];
function AddBar() {
  const [p, setP] = useState('none');
  const input = useRef(), flag = useRef(), tapped = useRef(false);
  // Replay the little "pop" when the flag is tapped (not on the reset after adding).
  useEffect(() => {
    if (!tapped.current) return;
    tapped.current = false;
    const ic = flag.current.querySelector('.ic');
    ic?.classList.remove('pop'); void ic?.offsetWidth; ic?.classList.add('pop');
  }, [p]);
  const submit = (e) => {
    e.preventDefault();
    if (add(input.current.value.trim(), p)) { input.current.value = ''; setP('none'); }
    input.current.focus();
  };
  return html`
    <form id="todo-form" class="add-bar" onSubmit=${submit}>
      <div class="add-inner">
        <div class="entry">
          <input id="todo-input" ref=${input} class="input" placeholder="Add a to-do…" autocomplete="off" aria-label="New to-do" maxlength="500" />
          <button type="button" id="new-priority" ref=${flag} class=${`flag-btn p-${p}`}
            aria-label=${`Priority for new to-do: ${LABELS[p]}. Tap to change`} title=${`Priority: ${LABELS[p]} (tap to change)`}
            onClick=${() => { tapped.current = true; setP(CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]); }}>
            <span class="word">${p === 'none' ? '' : LABELS[p]}</span><${Icon} name="flag" cls=${`flag-${p}`} />
          </button>
        </div>
        <button type="submit" class="btn primary"><${Icon} name="plus" />Add</button>
      </div>
    </form>`;
}

// Due date picker in the edit sheet (Issue #23): None / Today / Tomorrow chips
// and a small month calendar. Value is 'YYYY-MM-DD' or '' for none.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function DueField({ value, onChange, open }) {
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
  const choice = !value ? 'none' : value === today.value ? 'today' : value === tomorrow ? 'tomorrow' : '';
  const pick = (v) => { onChange(v); if (v) { const d = parseDay(v); setMonth([d.getFullYear(), d.getMonth()]); } };
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return html`
    <p class="field-label" id="edit-due-label">Due${value ? html` · <span class="due-chosen">${(l => l[0].toUpperCase() + l.slice(1))(dueLabel(value).replace(/^Due /, ''))}</span>` : ''}</p>
    <div class="seg chips" role="group" aria-labelledby="edit-due-label">
      ${[['none', 'None', ''], ['today', 'Today', today.value], ['tomorrow', 'Tomorrow', tomorrow]].map(([k, l, v]) => html`
        <button type="button" class="chip" data-due=${k} aria-pressed=${choice === k} onClick=${() => pick(v)}>${l}</button>`)}
    </div>
    <div class="mini-cal" role="group" aria-label=${`Pick a due date, ${monthName}`}>
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
    </div>`;
}

// Edit sheet: change the wording or priority. Opening it doesn't redraw or
// move the list behind; the list changes only on Save.
function EditSheet() {
  const dlg = useRef(), text = useRef();
  const e = editing.value;
  const [p, setP] = useState('none');
  const [star, setStarOn] = useState(false);
  const [due, setDue] = useState('');
  useEffect(() => {
    if (!e) { if (dlg.current.open) dlg.current.close(); return; }
    setP(e.p); setStarOn(!!e.starred); setDue(e.due || ''); text.current.value = e.text;
    dlg.current.showModal();
    text.current.focus({ preventScroll: true });
    text.current.setSelectionRange(e.text.length, e.text.length);
  }, [e]);
  // Close, then put the keyboard back on the row that was being edited.
  const close = () => {
    const k = editing.value?.key;
    editing.value = null;
    setTimeout(() => document.querySelector(`#todo-groups [data-edit="${k}"]`)?.focus({ preventScroll: true }));
  };
  const saveEdit = (ev) => {
    ev.preventDefault();
    // Use the to-do as it is now: the list may have been re-read while the sheet was open.
    const t = todos.value.find((x, i) => keyOf(x, i) === e.key);
    if (t) {
      const changes = {}, v = text.current.value.trim().slice(0, 500);
      if (v && v !== t.text) changes.text = v;
      if (p !== t.p) changes.p = p;
      if (star !== !!t.starred) changes.starred = star;   // Issue #22
      if (due !== (validDue(t.due) ? t.due : '')) changes.due = due || null;   // Issue #23
      if (Object.keys(changes).length) {
        update(t, changes);
        justEdited.value = e.key; setTimeout(() => { justEdited.value = null; }, 1300);
      }
    }
    close();
  };
  return html`
    <dialog id="edit-todo" ref=${dlg} class="sheet" aria-labelledby="edit-todo-title"
      onClose=${() => { if (editing.value) close(); }} onClick=${(ev) => { if (ev.target === dlg.current) close(); }}>
      <form id="edit-form" class="edit-form" onSubmit=${saveEdit}>
        <header><h2 id="edit-todo-title">Edit to-do</h2>
          <button type="button" class="close-btn" id="edit-close" aria-label="Close" onClick=${close}><${Icon} name="x" /></button></header>
        <label for="edit-text" class="visually-hidden">To-do</label>
        <textarea id="edit-text" ref=${text} class="textarea" rows="2" maxlength="500" required></textarea>
        <p class="field-label" id="edit-priority-label">Priority</p>
        <div class="seg chips" role="group" aria-labelledby="edit-priority-label">
          ${['high', 'med', 'low', 'none'].map((v) => html`
            <button type="button" class=${`chip ${v}`} data-p=${v} aria-pressed=${p === v} onClick=${() => setP(v)}>
              <${Icon} name="flag" cls=${`flag-${v}`} />${v === 'none' ? 'None' : LABELS[v]}</button>`)}
        </div>
        <button type="button" class="star-toggle" role="switch" aria-checked=${star} onClick=${() => setStarOn(!star)}>
          <${Icon} name=${star ? 'star-fill' : 'star'} />Star this to-do<span class="switch" aria-hidden="true"></span>
        </button>
        <${DueField} value=${due} onChange=${setDue} open=${!!e} />
        <div class="row edit-actions">
          <button type="button" id="edit-cancel" class="btn ghost" onClick=${close}>Cancel</button>
          <button type="submit" id="edit-save" class="btn primary">Save</button>
        </div>
      </form>
    </dialog>`;
}

// One-line summary under the title, e.g. "3 to do · 2 done today".
function Summary() {
  if (loading.value && !todos.value.length) return 'Loading your to-dos…';
  const all = todos.value;
  if (!all.length) return 'Nothing on your list yet';
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const left = all.filter((t) => !t.done).length;
  const doneToday = all.filter((t) => t.done && Number.isFinite(t.doneAt) && t.doneAt >= startOfToday).length;
  const today = doneToday ? ` · ${doneToday} done today` : '';
  return left ? `${left} to do${today}` : `All done!${today}`;
}

function App() {
  return html`<${TodoList} />`;
}

render(html`<${App} />`, document.getElementById('todo-groups'));
// One-time tip (per stage): how to star.
setTimeout(() => {
  const key = `swipe-tip:${window.STAGE || 'local'}`;
  try {
    if (localStorage.getItem(key) || !todos.value.some((t) => !t.done)) return;
    localStorage.setItem(key, '1');
  } catch { return; }
  window.AppToast?.show('Tip: swipe a to-do to the right to star it', { icon: 'star', duration: 6000 });
}, 2500);
render(html`<${Summary} />`, document.getElementById('summary'));
// The add bar and edit sheet sit outside the list (fixed bar, modal sheet).
const extras = document.createElement('div');
document.body.append(extras);
render(html`<${AddBar} /><${EditSheet} />`, extras);
