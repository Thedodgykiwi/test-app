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

function Row({ t, k }) {
  const id = `todo-${k}`;
  const tick = (e) => {
    const done = e.target.checked;
    update(t, { done, doneAt: done ? Date.now() : null });   // when it was ticked, for Done's date groups
    const doneClosed = !collapsed.value.has('done-open');
    if (done && doneClosed) { movedHint.value = true; setTimeout(() => { movedHint.value = false; }, 2500); }
    focusAfter = [`#${id}`, '[data-group="done"]'];   // keep the keyboard where it was
  };
  const hl = justEdited.value === k;
  return html`
    <li class=${`todo${t.done ? ' done' : ''}${hl ? ' just-edited' : ''}`}>
      <input type="checkbox" id=${id} checked=${t.done} onChange=${tick} aria-label=${`Done: ${t.text}`} />
      <button type="button" class="text" data-edit=${k} aria-label=${`Edit “${t.text}”`}
        onClick=${() => { editing.value = { key: k, text: t.text, p: t.p }; }}>${t.text}</button>
      ${t.p !== 'none' && html`
        <span class="row-flag" title=${`Priority: ${LABELS[t.p]}`}>
          <${Icon} name="flag" cls=${`flag-${t.p}`} /><span class="visually-hidden">Priority: ${LABELS[t.p]}</span>
        </span>`}
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
  const groups = LEVELS.map((p) => [p, active.filter(([t]) => t.p === p)]).filter(([, l]) => l.length);
  return html`
    ${!all.length && html`<p class="empty">${loading.value ? 'Loading your to-dos…' : 'No to-dos yet. Add one below.'}</p>`}
    ${all.length > 0 && !active.length && html`<p class="empty">All done. Nothing left to do!</p>`}
    ${active.length > 0 && html`<div id="todo-list" class="prio-groups">
      ${groups.map(([p, items]) => html`
        <section class=${`prio-group prio-${p}`} key=${p} aria-label=${`${LABELS[p]}: ${items.length}`}>
          <h2 class="prio-head"><${Icon} name="flag" cls=${`flag-${p}`} />${LABELS[p]} · ${items.length}</h2>
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

// Edit sheet: change the wording or priority. Opening it doesn't redraw or
// move the list behind; the list changes only on Save.
function EditSheet() {
  const dlg = useRef(), text = useRef();
  const e = editing.value;
  const [p, setP] = useState('none');
  useEffect(() => {
    if (!e) { if (dlg.current.open) dlg.current.close(); return; }
    setP(e.p); text.current.value = e.text;
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
render(html`<${Summary} />`, document.getElementById('summary'));
// The add bar and edit sheet sit outside the list (fixed bar, modal sheet).
const extras = document.createElement('div');
document.body.append(extras);
render(html`<${AddBar} /><${EditSheet} />`, extras);
