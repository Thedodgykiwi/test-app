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

function todoRow(t, index) {
  const key = t.id || index; // cloud to-dos have a stable id
  const id = `todo-${key}`;
  const checkbox = el('input', { type: 'checkbox', id, checked: t.done });
  checkbox.addEventListener('change', () => { update(t, { done: checkbox.checked }); render(`#${id}`); });

  const level = LEVELS.indexOf(t.p);
  const move = (delta, dir) => {
    const btn = el('button', {
      type: 'button', className: 'icon-btn',
      disabled: level + delta < 0 || level + delta >= LEVELS.length,
      title: dir === 'up' ? 'Raise priority' : 'Lower priority',
    });
    btn.setAttribute('aria-label', `${dir === 'up' ? 'Raise' : 'Lower'} priority of “${t.text}”`);
    btn.append(icon(dir === 'up' ? 'arrow-up' : 'arrow-down'));
    btn.dataset.focus = `${dir}-${key}`;
    btn.addEventListener('click', () => {
      update(t, { p: LEVELS[level + delta] });
      // If it moved into a collapsed section, focus that section's heading instead.
      render(`[data-focus="${dir}-${key}"]:not(:disabled)`, `[data-group="${t.p}"]`);
    });
    return btn;
  };

  return el('li', { className: t.done ? 'todo done' : 'todo' },
    checkbox,
    el('label', { htmlFor: id, className: 'text', textContent: t.text }),
    el('span', { className: 'move' }, move(-1, 'up'), move(1, 'down')));
}

function render(focusSelector, fallbackFocus) {
  groupsEl.replaceChildren();
  if (!todos.length) {
    const msg = loading ? 'Loading your to-dos…' : 'No to-dos yet. Add one below.';
    groupsEl.append(el('p', { className: 'empty', textContent: msg }));
  }
  for (const p of LEVELS) {
    // Keep each to-do's position in the saved list so its controls stay stable.
    const items = todos.map((t, i) => [t, i]).filter(([t]) => t.p === p)
      .sort(([a], [b]) => a.done - b.done);
    if (!items.length) continue; // hide empty sections
    const isCollapsed = collapsed.has(p);
    const listId = `group-list-${p}`;
    const toggle = el('button', { type: 'button', className: 'group-toggle' },
      icon(isCollapsed ? 'caret-right' : 'caret-down', 'chevron'),
      icon('flag', `flag-${p}`),
      `${LABELS[p]} · ${items.length}`);
    toggle.dataset.group = p;
    toggle.setAttribute('aria-expanded', !isCollapsed);
    toggle.setAttribute('aria-controls', listId);
    toggle.title = isCollapsed ? 'Show this section' : 'Hide this section';
    toggle.addEventListener('click', () => {
      collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
      saveCollapsed(); render(`[data-group="${p}"]`);
    });
    const list = el('ul', { className: 'todos', id: listId, hidden: isCollapsed },
      ...items.map(([t, i]) => todoRow(t, i)));
    groupsEl.append(el('div', { className: `group group-${p}` }, el('h2', {}, toggle), list));
  }
  // Focus the first match that's actually visible (not inside a collapsed section).
  const visible = (sel) => sel && [...groupsEl.querySelectorAll(sel)].find((n) => !n.closest('[hidden]'));
  (visible(focusSelector) || visible(fallbackFocus))?.focus();
}

// Priority chips for new to-dos: tap to select, tap again to clear.
const chips = document.querySelectorAll('#todo-form .chip');
chips.forEach((chip) => chip.addEventListener('click', () => {
  newPriority = newPriority === chip.dataset.p ? 'none' : chip.dataset.p;
  chips.forEach((c) => c.setAttribute('aria-pressed', c.dataset.p === newPriority));
}));

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
      : a.dataset.focus ? `[data-focus="${a.dataset.focus}"]:not(:disabled)`
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
