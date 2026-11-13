// The to-dos and where they're saved. Same rules and data format as before the
// Preact rebuild (Issue #13): this device (browser storage, per stage) unless
// sync.js signs the user in, then their Firebase account (window.TodoApp hooks).
// Screens read the signals below and re-draw when they change.
import { signal } from '@preact/signals';

const stage = window.STAGE || 'local';
const storageKey = `todos-${stage}`;   // stages share one origin, so keep each stage's data separate

// Priority levels, highest first. 'none' = no priority set.
export const LEVELS = ['high', 'med', 'low', 'none'];
export const LABELS = { high: 'High', med: 'Medium', low: 'Low', none: 'No priority' };

// Older saved to-dos have no priority: keep them and treat them as 'none'.
const loadLocal = () => JSON.parse(localStorage.getItem(storageKey) || '[]')
  .map((t) => ({ ...t, p: LEVELS.includes(t.p) ? t.p : 'none' }));

export const todos = signal(loadLocal());
// Signed in last time? Wait for the account's list instead of flashing this
// device's list first. If sign-in can't load (e.g. offline), fall back.
export const loading = signal(!!window.FIREBASE_CONFIG && localStorage.getItem('signed-in') === '1');
let cloud = null;   // set by sync.js while signed in: { add(t), update(t, changes) }
if (loading.value) {
  todos.value = [];
  setTimeout(() => { if (loading.value && !cloud) window.TodoApp.useLocal(); }, 5000);
}

const save = () => { if (!cloud && !loading.value) localStorage.setItem(storageKey, JSON.stringify(todos.value)); };

// A to-do's key: cloud to-dos have a stable id; device ones use their saved position.
export const keyOf = (t, i) => t.id || i;

// Change a to-do and save it wherever it lives.
export function update(t, changes) {
  todos.value = todos.value.map((x) => (x === t ? { ...x, ...changes } : x));
  if (cloud) cloud.update(t, changes); else save();
}
// Add a to-do. Returns false while we don't yet know which list to add to.
export function add(text, p) {
  if (!text || (loading.value && !cloud)) return false;
  const item = { text, done: false, p };
  if (cloud) cloud.add(item); else { todos.value = [...todos.value, item]; save(); }
  return true;
}

// Which sections are collapsed, remembered per stage (same key and values as before).
const collapsedKey = `collapsed-${stage}`;
let saved;
try { saved = new Set(JSON.parse(localStorage.getItem(collapsedKey) || '[]')); } catch { saved = new Set(); }
export const collapsed = signal(saved);
export function toggleCollapsed(key) {
  const next = new Set(collapsed.value);
  next.has(key) ? next.delete(key) : next.add(key);
  collapsed.value = next;
  localStorage.setItem(collapsedKey, JSON.stringify([...next]));
}

// Hooks for sync.js (Firebase sign-in and cloud saving). Unchanged interface.
window.TodoApp = {
  stage,
  localTodos: loadLocal,
  // Signed in: show the account's to-dos and save changes through `api`.
  useCloud(api) { cloud = api; todos.value = []; loading.value = true; },
  // To-dos from the account (first load and live updates).
  setTodos(list) { todos.value = list; loading.value = false; },
  // Signed out: back to the to-dos saved on this device.
  useLocal() { cloud = null; todos.value = loadLocal(); loading.value = false; },
};
