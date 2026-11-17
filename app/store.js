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
// Signed in last time? Show the account's list from last time straight away
// (a copy kept on this device, Issue #36), then swap in the live list once
// Firebase is ready. No copy yet (first sign-in on this device): show
// "Loading…" instead of flashing this device's own list.
export const loading = signal(!!window.FIREBASE_CONFIG && localStorage.getItem('signed-in') === '1');
// True while the list on screen is the saved copy, until the server answers ("Updating…").
export const updating = signal(false);
// Keys of to-dos that changed when the live list replaced the saved copy (briefly highlighted).
export const fresh = signal(new Set());
const cacheKey = `cloud-copy-${stage}`;
const readCache = () => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; } };
let cloud = null;   // set by sync.js while signed in: { add(t), update(t, changes), remove(t) }
let shownCopy = null;   // the saved copy shown at start, to spot what changed
if (loading.value) {
  const copy = readCache();
  if (Array.isArray(copy)) {
    todos.value = copy; shownCopy = copy; updating.value = true;
    // The account button's blue "working" dot until sync.js takes over.
    const dot = document.getElementById('sync-dot');
    if (dot) { dot.className = 'sync-dot saving'; dot.hidden = false; }
  }
  else {
    todos.value = [];
    // Sign-in can't load (e.g. offline on a first visit): fall back to this device's list.
    setTimeout(() => { if (loading.value && !cloud) window.TodoApp.useLocal(); }, 5000);
  }
}

// Not ready to save yet (showing the saved copy before Firebase starts)? Say so.
export function ready() {
  if (!loading.value || cloud) return true;
  window.AppToast?.show('One moment, connecting…', { duration: 1800 });
  return false;
}

const save = () => { if (!cloud && !loading.value) localStorage.setItem(storageKey, JSON.stringify(todos.value)); };

// A to-do's key: cloud to-dos have a stable id; device ones use their saved position.
export const keyOf = (t, i) => t.id || i;

// Change a to-do and save it wherever it lives.
export function update(t, changes) {
  if (!ready()) return;
  todos.value = todos.value.map((x) => (x === t ? { ...x, ...changes } : x));
  if (cloud) cloud.update(t, changes); else save();
}
// Delete a to-do wherever it lives (Issue #40).
export function remove(t) {
  if (!ready()) return false;
  todos.value = todos.value.filter((x) => x !== t);
  if (cloud) cloud.remove(t); else save();
  return true;
}
// Add a to-do (optionally with a due date, Issue #42). Returns false while
// we don't yet know which list to add to.
export function add(text, p, due, evening) {
  if (!text || !ready()) return false;
  const item = { text, done: false, p };
  if (due) item.due = due;
  if (evening) item.evening = true;   // "Tonight" (Issue #43)
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
  get updating() { return updating.value; },
  // Signed in: show the account's to-dos and save changes through `api`.
  // Keep the saved copy on screen (if any) until the account's list arrives.
  useCloud(api) { cloud = api; if (!shownCopy) todos.value = []; loading.value = true; },
  // To-dos from the account (first load and live updates). `fromServer`: the
  // server has answered (not just Firestore's copy on this device).
  setTodos(list, { fromServer = true } = {}) {
    if (shownCopy) {
      // Briefly highlight anything that differs from the saved copy we showed.
      const before = new Map(shownCopy.map((t) => [t.id, JSON.stringify(t)]));
      const changed = list.filter((t) => before.get(t.id) !== JSON.stringify(t)).map((t) => t.id);
      if (changed.length) {
        fresh.value = new Set([...fresh.value, ...changed]);
        setTimeout(() => { fresh.value = new Set(); }, 1300);
      }
      shownCopy = list;
    }
    todos.value = list; loading.value = false;
    if (fromServer || !navigator.onLine) { updating.value = false; shownCopy = null; }
    try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* storage full: no copy, fine */ }
  },
  // Signed out (or sign-in couldn't load): back to the to-dos saved on this device.
  // `forget`: really signed out, so also drop the copy of the account's list.
  useLocal({ forget = false } = {}) {
    cloud = null; shownCopy = null; updating.value = false;
    if (forget) localStorage.removeItem(cacheKey);
    todos.value = loadLocal(); loading.value = false;
  },
};
