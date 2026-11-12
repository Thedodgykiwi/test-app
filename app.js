let count = 0;
const counter = document.getElementById('counter');
counter.addEventListener('click', () => {
  count++;
  counter.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}`;
});

// Stages share one origin on GitHub Pages, so keep each stage's data separate.
const storageKey = `todos-${window.STAGE || 'local'}`;
const todos = JSON.parse(localStorage.getItem(storageKey) || '[]');
const list = document.getElementById('todos');
const save = () => localStorage.setItem(storageKey, JSON.stringify(todos));
function render() {
  list.innerHTML = '';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = t.text;
    li.className = t.done ? 'done' : '';
    li.title = 'Click to toggle';
    li.onclick = () => { todos[i].done = !todos[i].done; save(); render(); };
    list.appendChild(li);
  });
}
document.getElementById('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  if (!input.value.trim()) return;
  todos.push({ text: input.value.trim(), done: false });
  input.value = '';
  save(); render();
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
