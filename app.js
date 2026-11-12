let count = 0;
const counterText = document.getElementById('counter-text');
document.getElementById('counter').addEventListener('click', () => {
  count++;
  counterText.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}`;
});

// Stages share one origin on GitHub Pages, so keep each stage's data separate.
const storageKey = `todos-${window.STAGE || 'local'}`;

// Priority levels, highest first. 'none' = no priority set.
const LEVELS = ['high', 'med', 'low', 'none'];
const LABELS = { high: 'High', med: 'Medium', low: 'Low', none: 'No priority' };

// Older saved to-dos have no priority: keep them and treat them as 'none'.
const todos = JSON.parse(localStorage.getItem(storageKey) || '[]')
  .map((t) => ({ ...t, p: LEVELS.includes(t.p) ? t.p : 'none' }));
const save = () => localStorage.setItem(storageKey, JSON.stringify(todos));

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
  const id = `todo-${index}`;
  const checkbox = el('input', { type: 'checkbox', id, checked: t.done });
  checkbox.addEventListener('change', () => { t.done = checkbox.checked; save(); render(`#${id}`); });

  const level = LEVELS.indexOf(t.p);
  const move = (delta, dir) => {
    const btn = el('button', {
      type: 'button', className: 'icon-btn',
      disabled: level + delta < 0 || level + delta >= LEVELS.length,
      title: dir === 'up' ? 'Raise priority' : 'Lower priority',
    });
    btn.setAttribute('aria-label', `${dir === 'up' ? 'Raise' : 'Lower'} priority of “${t.text}”`);
    btn.append(icon(dir === 'up' ? 'arrow-up' : 'arrow-down'));
    btn.dataset.focus = `${dir}-${index}`;
    btn.addEventListener('click', () => {
      t.p = LEVELS[level + delta]; save();
      // If it moved into a collapsed section, focus that section's heading instead.
      render(`[data-focus="${dir}-${index}"]:not(:disabled)`, `[data-group="${t.p}"]`);
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
    groupsEl.append(el('p', { className: 'empty', textContent: 'No to-dos yet. Add one below.' }));
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
  if (!text) return;
  todos.push({ text, done: false, p: newPriority });
  // Open the section it went into, so the new to-do is visible.
  if (collapsed.delete(newPriority)) saveCollapsed();
  input.value = '';
  save(); render();
  input.focus();
});
render();

const stage = window.STAGE || 'local';
document.getElementById('build').textContent = stage;
if (stage !== 'main') {
  const banner = document.getElementById('stage-banner');
  banner.textContent = `${stage.toUpperCase()} environment`;
  banner.className = `stage-${stage}`;
  banner.hidden = false;
}
