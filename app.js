// Stages share one origin on GitHub Pages, so keep each stage's data separate.
const storageKey = `todos-${window.STAGE || 'local'}`;

// Priority levels, highest first. 'none' = no priority set.
const LEVELS = ['high', 'med', 'low', 'none'];
const LABELS = { high: 'High', med: 'Medium', low: 'Low', none: 'No priority' };

// Older saved to-dos have no priority: keep them and treat them as 'none'.
const loadLocal = () => JSON.parse(localStorage.getItem(storageKey) || '[]')
  .map((t) => ({ ...t, p: LEVELS.includes(t.p) ? t.p : 'none' }));
let todos = loadLocal();

// Signed in last time? Wait for the account's list instead of flashing this
// device's list first. If sign-in can't load (e.g. offline), fall back.
let loading = !!window.FIREBASE_CONFIG && localStorage.getItem('signed-in') === '1';
if (loading) {
  todos = [];
  setTimeout(() => { if (loading && !cloud) window.TodoApp.useLocal(); }, 5000);
}

// Where to-dos are saved: this device (localStorage) unless sync.js has
// signed the user in, in which case `cloud` saves to their Firebase account.
let cloud = null;
const save = () => { if (!cloud && !loading) localStorage.setItem(storageKey, JSON.stringify(todos)); };

// Change a to-do (done / priority) and save it wherever it lives.
function update(t, changes) {
  Object.assign(t, changes);
  if (cloud) cloud.update(t, changes); else save();
}

const groupsEl = document.getElementById('todo-groups');
let newPriority = 'none';

// Which sections are collapsed, remembered per stage.
const collapsedKey = `collapsed-${window.STAGE || 'local'}`;
let collapsed;
try { collapsed = new Set(JSON.parse(localStorage.getItem(collapsedKey) || '[]')); }
catch { collapsed = new Set(); }
const saveCollapsed = () => localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Edit to-do sheet. Opening it only adds the panel: the list behind is
// left alone (no redraw, no scroll jump). The list redraws on Save only.
const editDialog = document.getElementById('edit-todo');
const editText = document.getElementById('edit-text');
const editChips = editDialog.querySelectorAll('.chip');
let editing = null;      // { t, key, p } while the sheet is open
let justEdited = null;   // row to highlight briefly after saving
editChips.forEach((chip) => chip.addEventListener('click', () => {
  editing.p = chip.dataset.p;
  editChips.forEach((c) => c.setAttribute('aria-pressed', c === chip));
}));
function openEditor(t, key) {
  editing = { t, key, p: t.p };
  editText.value = t.text;
  editChips.forEach((c) => c.setAttribute('aria-pressed', c.dataset.p === t.p));
  editDialog.showModal();
  editText.focus({ preventScroll: true });
  editText.setSelectionRange(editText.value.length, editText.value.length);
}
function closeEditor() {
  if (editDialog.open) editDialog.close();
}
editDialog.addEventListener('close', () => {
  const key = editing?.key;
  editing = null;
  // Back to the row that was being edited (it may have moved group).
  const row = groupsEl.querySelector(`[data-edit="${key}"]`);
  if (row && !row.closest('[hidden]')) row.focus({ preventScroll: true });
});
document.getElementById('edit-cancel').addEventListener('click', closeEditor);
editDialog.addEventListener('click', (e) => { if (e.target === editDialog) closeEditor(); }); // tap outside
document.getElementById('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { key, p } = editing;
  // Use the to-do as it is now: the list may have been re-read while the
  // sheet was open (e.g. the sign-in check just after loading, or a live
  // update from another device), which replaces the to-do objects.
  const t = todos.find((x, i) => (x.id || i) === key) || editing.t;
  const text = editText.value.trim().slice(0, 500);
  const changes = {};
  if (text && text !== t.text) changes.text = text;
  if (p !== t.p) changes.p = p;
  if (Object.keys(changes).length) {
    update(t, changes);
    // Moved into a closed section? Open it so the edited to-do is visible.
    if (changes.p && collapsed.delete(changes.p)) saveCollapsed();
    justEdited = key;
    render();
  }
  closeEditor();
});

function todoRow(t, index) {
  const key = t.id || index; // cloud to-dos have a stable id
  const id = `todo-${key}`;
  const checkbox = el('input', { type: 'checkbox', id, checked: t.done });
  checkbox.addEventListener('change', () => {
    // Remember when it was ticked (for the Done group's date ranges).
    update(t, { done: checkbox.checked, doneAt: checkbox.checked ? Date.now() : null });
    // Ticked: it moves into Done; if Done is closed, focus its heading instead.
    render(`#${id}`, '[data-group="done"]', checkbox.checked);
  });

  // Done items show which priority they came from (unticking sends them back).
  // The text opens the editor (change wording or priority).
  const open = el('button', { type: 'button', className: 'text', textContent: t.text });
  open.dataset.edit = key;
  open.setAttribute('aria-label', `Edit “${t.text}”`);
  open.addEventListener('click', () => openEditor(t, key));
  checkbox.setAttribute('aria-label', `Done: ${t.text}`);
  const li = el('li', { className: t.done ? 'todo done' : 'todo' }, checkbox, open);
  if (t.done) li.append(el('span', { className: 'from-p', title: `Priority: ${LABELS[t.p]}` }, icon('flag', `flag-${t.p}`), LABELS[t.p]));
  if (justEdited === key) { li.classList.add('just-edited'); justEdited = null; }
  return li;
}

// Done to-dos are grouped by when they were ticked. Ones ticked before this
// was recorded (no doneAt) count as "Older".
const DONE_RANGES = [
  ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['older', 'Older'],
];
function doneRange(t, now = new Date()) {
  if (!Number.isFinite(t.doneAt)) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (t.doneAt >= startOfToday) return 'today';
  if (t.doneAt >= startOfToday - 6 * day) return 'week';
  if (t.doneAt >= startOfToday - 29 * day) return 'month';
  return 'older';
}

// A collapsible section heading (priority groups, Done, and Done's date ranges).
function sectionToggle(key, isCollapsed, listId, className, ...content) {
  const toggle = el('button', { type: 'button', className },
    icon(isCollapsed ? 'caret-right' : 'caret-down', 'chevron'), ...content);
  toggle.dataset.group = key;
  toggle.setAttribute('aria-expanded', !isCollapsed);
  toggle.setAttribute('aria-controls', listId);
  toggle.title = isCollapsed ? 'Show this section' : 'Hide this section';
  return toggle;
}

function render(focusSelector, fallbackFocus, justTicked = false) {
  groupsEl.replaceChildren();
  const indexed = todos.map((t, i) => [t, i]); // keep each to-do's saved position so its controls stay stable
  const active = indexed.filter(([t]) => !t.done);
  const done = indexed.filter(([t]) => t.done);
  if (!todos.length) {
    const msg = loading ? 'Loading your to-dos…' : 'No to-dos yet. Add one below.';
    groupsEl.append(el('p', { className: 'empty', textContent: msg }));
  } else if (!active.length) {
    groupsEl.append(el('p', { className: 'empty', textContent: 'All done. Nothing left to do!' }));
  }
  for (const p of LEVELS) {
    const items = active.filter(([t]) => t.p === p);
    if (!items.length) continue; // hide empty sections
    const isCollapsed = collapsed.has(p);
    const listId = `group-list-${p}`;
    const toggle = sectionToggle(p, isCollapsed, listId, 'group-toggle',
      icon('flag', `flag-${p}`), `${LABELS[p]} · ${items.length}`);
    toggle.addEventListener('click', () => {
      collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
      saveCollapsed(); render(`[data-group="${p}"]`);
    });
    const list = el('ul', { className: 'todos', id: listId, hidden: isCollapsed },
      ...items.map(([t, i]) => todoRow(t, i)));
    groupsEl.append(el('div', { className: `group group-${p}` }, el('h2', {}, toggle), list));
  }

  // Done: closed by default (open = 'done-open' remembered), split by date range.
  if (done.length) {
    const doneClosed = !collapsed.has('done-open');
    const toggle = sectionToggle('done', doneClosed, 'group-list-done', 'group-toggle',
      icon('check-circle', 'done-icon'), `Done · ${done.length}`);
    toggle.addEventListener('click', () => {
      collapsed.has('done-open') ? collapsed.delete('done-open') : collapsed.add('done-open');
      saveCollapsed(); render('[data-group="done"]');
    });
    const now = new Date();
    const ranges = el('div', { className: 'done-ranges', id: 'group-list-done', hidden: doneClosed });
    for (const [key, label] of DONE_RANGES) {
      const items = done.filter(([t]) => doneRange(t, now) === key)
        .sort(([a], [b]) => (b.doneAt || 0) - (a.doneAt || 0)); // newest first
      if (!items.length) continue;
      const rangeKey = `done-${key}`;
      const isCollapsed = collapsed.has(rangeKey);
      const listId = `group-list-${rangeKey}`;
      const rangeToggle = sectionToggle(rangeKey, isCollapsed, listId, 'range-toggle', `${label} · ${items.length}`);
      rangeToggle.addEventListener('click', () => {
        collapsed.has(rangeKey) ? collapsed.delete(rangeKey) : collapsed.add(rangeKey);
        saveCollapsed(); render(`[data-group="${rangeKey}"]`);
      });
      ranges.append(el('div', { className: 'done-range' }, el('h3', {}, rangeToggle),
        el('ul', { className: 'todos', id: listId, hidden: isCollapsed }, ...items.map(([t, i]) => todoRow(t, i)))));
    }
    groupsEl.append(el('div', { className: 'group group-done' }, el('h2', {}, toggle), ranges));
    if (justTicked && doneClosed) {
      groupsEl.append(el('p', { className: 'moved-hint', textContent: 'Moved to Done ↓' }));
    }
  }
  // Focus the first match that's actually visible (not inside a collapsed section).
  const visible = (sel) => sel && [...groupsEl.querySelectorAll(sel)].find((n) => !n.closest('[hidden]'));
  (visible(focusSelector) || visible(fallbackFocus))?.focus();
}

// Priority for a new to-do: the flag in the entry box. Each tap moves to the
// next one (none → Low → Medium → High → none); the flag takes the colour and
// a short word shows beside it, so it doesn't rely on colour alone.
const PRIORITY_CYCLE = ['none', 'low', 'med', 'high'];
const flagBtn = document.getElementById('new-priority');
function setNewPriority(p, bump = false) {
  newPriority = p;
  flagBtn.className = `flag-btn p-${p}`;
  flagBtn.querySelector('.word').textContent = p === 'none' ? '' : LABELS[p];
  flagBtn.querySelector('.ic').setAttribute('class', `ic flag-${p}`);
  flagBtn.setAttribute('aria-label', `Priority for new to-do: ${LABELS[p]}. Tap to change`);
  flagBtn.title = `Priority: ${LABELS[p]} (tap to change)`;
  if (bump) { void flagBtn.offsetWidth; flagBtn.classList.add('bump'); } // replay the little pop
}
flagBtn.addEventListener('click', () => {
  setNewPriority(PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(newPriority) + 1) % PRIORITY_CYCLE.length], true);
});

document.getElementById('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  const text = input.value.trim();
  if (!text || (loading && !cloud)) return; // wait until we know which list to add to
  const item = { text, done: false, p: newPriority };
  if (cloud) cloud.add(item); else { todos.push(item); save(); }
  // Open the section it went into, so the new to-do is visible.
  if (collapsed.delete(newPriority)) saveCollapsed();
  input.value = '';
  setNewPriority('none'); // each new to-do starts with no priority
  render();
  input.focus();
});
render();

// Hooks for sync.js (Firebase sign-in and cloud saving).
window.TodoApp = {
  stage: window.STAGE || 'local',
  localTodos: loadLocal,
  // Signed in: show the account's to-dos and save changes through `api`.
  useCloud(api) { cloud = api; todos = []; loading = true; render(); },
  // New to-dos from the account (live updates): redraw, keeping keyboard focus.
  setTodos(list) {
    const a = document.activeElement;
    const sel = !groupsEl.contains(a) ? null
      : a.id ? `#${a.id}`
      : a.dataset.edit ? `[data-edit="${a.dataset.edit}"]`
      : a.dataset.group ? `[data-group="${a.dataset.group}"]` : null;
    todos = list; loading = false; render(sel);
  },
  // Signed out: back to the to-dos saved on this device.
  useLocal() { cloud = null; todos = loadLocal(); loading = false; render(); },
};

const stage = window.STAGE || 'local';
document.getElementById('build').textContent = stage;
if (stage !== 'main') {
  const banner = document.getElementById('stage-banner');
  banner.textContent = `${stage.toUpperCase()} environment`;
  banner.className = `stage-${stage}`;
  banner.hidden = false;
}
