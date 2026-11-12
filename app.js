let count = 0;
const counter = document.getElementById('counter');
counter.addEventListener('click', () => {
  count++;
  counter.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}`;
});

const todos = JSON.parse(localStorage.getItem('todos') || '[]');
const list = document.getElementById('todos');
const save = () => localStorage.setItem('todos', JSON.stringify(todos));
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

if (location.hostname.endsWith('github.io')) {
  document.getElementById('build').textContent = 'GitHub Pages';
}
