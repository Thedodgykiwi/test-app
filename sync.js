// Google sign-in and cloud saving (Firebase Authentication + Cloud Firestore).
//
// Signed out, the app saves to-dos on this device only (app.js), as before.
// Signed in, to-dos live in the user's own Firestore folder, separate per stage:
//   users/{uid}/stages/{stage}/todos/{todoId}
// Firestore keeps a copy on the device, so the list still works offline and
// syncs when the connection comes back. firestore.rules protects the data.
//
// The Firebase library loads from Google's CDN as ES modules (no build step).
// Pinned version: update it deliberately, not automatically.
const SDK = 'https://www.gstatic.com/firebasejs/13.1.0';

const config = window.FIREBASE_CONFIG;
const app = window.TodoApp;
if (config && app) start().catch((err) => {
  // Couldn't load Firebase (e.g. offline on first visit): keep working locally.
  console.warn('Sign-in unavailable:', err);
  app.useLocal();
});

async function start() {
  const [{ initializeApp }, authLib, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const fbApp = initializeApp(config);
  const auth = authLib.getAuth(fbApp);
  const db = fs.initializeFirestore(fbApp, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  // Local testing against the Firebase emulators: http://localhost:8080/?emulators
  if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulators')) {
    authLib.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(db, '127.0.0.1', 8081);
  }

  const $ = (id) => document.getElementById(id);
  const ui = {
    box: $('account'), signIn: $('sign-in'), button: $('account-btn'), avatar: $('avatar'),
    dot: $('sync-dot'), menu: $('account-menu'), name: $('account-name'), email: $('account-email'),
    status: $('sync-status'), signOut: $('sign-out'),
  };

  // ---- Account menu -------------------------------------------------------
  const setMenu = (open) => {
    ui.menu.hidden = !open;
    ui.button.setAttribute('aria-expanded', open);
  };
  ui.button.addEventListener('click', () => setMenu(ui.menu.hidden));
  document.addEventListener('click', (e) => { if (!ui.box.contains(e.target)) setMenu(false); });
  ui.box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.menu.hidden) { setMenu(false); ui.button.focus(); }
  });

  ui.signIn.addEventListener('click', async () => {
    try {
      await authLib.signInWithPopup(auth, new authLib.GoogleAuthProvider());
    } catch (err) {
      const msg = {
        'auth/popup-closed-by-user': null,
        'auth/cancelled-popup-request': null,
        'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
        'auth/network-request-failed': "Couldn't reach Google. Check your connection and try again.",
        'auth/unauthorized-domain': "Sign-in isn't set up for this web address yet.",
      }[err.code];
      if (msg !== null) toast(msg || `Sign-in didn't work (${err.code || err.message}).`, 6000);
    }
  });
  ui.signOut.addEventListener('click', () => { setMenu(false); authLib.signOut(auth); });

  // ---- Sync status --------------------------------------------------------
  let pending = false;
  let error = '';
  const STATUS = {
    synced: 'All changes saved to your account',
    saving: 'Saving…',
    offline: "Offline: changes will sync when you're back online",
    error: () => `Couldn't sync: ${error}`,
  };
  function showStatus() {
    const state = error ? 'error' : !navigator.onLine ? 'offline' : pending ? 'saving' : 'synced';
    const text = typeof STATUS[state] === 'function' ? STATUS[state]() : STATUS[state];
    ui.status.className = `sync-status ${state}`;
    ui.status.replaceChildren(icon({ synced: 'cloud-check', saving: 'cloud-arrow-up', offline: 'cloud-slash', error: 'warning-circle' }[state]), text);
    ui.dot.className = `sync-dot ${state}`;
    ui.button.setAttribute('aria-label', `Account: ${ui.name.textContent}. ${text}`);
    ui.button.title = text;
  }
  addEventListener('online', showStatus);
  addEventListener('offline', showStatus);
  const failed = (err) => { error = err.code === 'permission-denied' ? 'not allowed' : (err.code || err.message); showStatus(); };

  // ---- Signed in / out ----------------------------------------------------
  let unsubscribe = null;
  authLib.onAuthStateChanged(auth, (user) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    setMenu(false);
    ui.box.hidden = false;
    ui.box.classList.toggle('signed-in', !!user);
    ui.signIn.hidden = !!user;
    ui.button.hidden = !user;
    if (!user) {
      if (localStorage.getItem('signed-in')) toast('Signed out. Showing the to-dos saved on this device.');
      localStorage.removeItem('signed-in');
      app.useLocal();
      return;
    }
    localStorage.setItem('signed-in', '1');
    const name = user.displayName || user.email || 'Signed in';
    ui.name.textContent = name;
    ui.email.textContent = user.email || '';
    ui.avatar.textContent = name.trim().charAt(0).toUpperCase();
    error = '';

    const todosRef = fs.collection(db, 'users', user.uid, 'stages', app.stage, 'todos');
    let migrated = false;
    app.useCloud({
      add(t) {
        fs.addDoc(todosRef, newDoc(t, Date.now())).catch(failed);
      },
      update(t, changes) {
        fs.updateDoc(fs.doc(todosRef, t.id), changes).catch(failed);
      },
    });
    showStatus();

    unsubscribe = fs.onSnapshot(fs.query(todosRef, fs.orderBy('pos')), { includeMetadataChanges: true }, (snap) => {
      const list = snap.docs.map((d) => {
        const { text, done, p } = d.data();
        return { id: d.id, text, done, p };
      });
      app.setTodos(list);
      pending = snap.metadata.hasPendingWrites;
      if (!pending) error = '';
      showStatus();
      // Once we've heard from the server, copy this device's to-dos in (first time only).
      if (!migrated && !snap.metadata.fromCache) { migrated = true; copyLocalTodos(user, list, todosRef); }
    }, failed);
  });

  function newDoc(t, pos) {
    return { text: String(t.text).slice(0, 500), done: !!t.done, p: t.p, pos, createdAt: fs.serverTimestamp() };
  }

  // The first time someone signs in on a device, add the to-dos saved on that
  // device to their account (skipping any already there). The device's own
  // copy is left untouched, so it's still there after signing out.
  async function copyLocalTodos(user, existing, todosRef) {
    const flag = `copied-${app.stage}-${user.uid}`;
    if (localStorage.getItem(flag)) return;
    const have = new Set(existing.map((t) => t.text));
    const toAdd = app.localTodos().filter((t) => t.text && !have.has(String(t.text).slice(0, 500)));
    if (toAdd.length) {
      const base = Date.now();
      for (let i = 0; i < toAdd.length; i += 400) { // Firestore batches hold up to 500 writes
        const batch = fs.writeBatch(db);
        toAdd.slice(i, i + 400).forEach((t, j) => batch.set(fs.doc(todosRef), newDoc(t, base + i + j)));
        try { await batch.commit(); } catch (err) { failed(err); return; }
      }
      const n = toAdd.length;
      toast(`${n} to-do${n === 1 ? '' : 's'} from this device ${n === 1 ? 'was' : 'were'} added to your account.`);
    }
    localStorage.setItem(flag, '1');
  }
}

// Short message at the bottom of the screen.
let toastTimer;
function toast(message, ms = 4000) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
