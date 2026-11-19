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

  // For the banner's "Report issue" drop-down (report.js, Issue #28). Reports go
  // to issueReports/{id}; firestore.rules only lets people on the testers list
  // add one, and nobody can read them back (a GitHub Action collects them).
  window.AppCloud = {
    user: () => auth.currentUser,
    signIn: () => document.getElementById('sign-in').click(),
    submitReport({ title, body, type, screenshot }) {
      const u = auth.currentUser;
      const write = fs.addDoc(fs.collection(db, 'issueReports'), {
        title, body, type, stage: app.stage, uid: u.uid, email: u.email,
        status: 'new', createdAt: fs.serverTimestamp(),
        ...(screenshot ? { screenshot } : {}),   // JPEG data URL, shrunk on the device (Issue #35)
      });
      // addDoc waits for the server; don't leave the button spinning forever.
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
      return Promise.race([write, timeout]);
    },
  };

  const $ = (id) => document.getElementById(id);
  const ui = {
    box: $('account'), signIn: $('sign-in'), button: $('account-btn'), avatar: $('avatar'),
    avatarImg: $('avatar-img'), who: $('who'), whoImg: $('who-img'), whoLetter: $('who-letter'),
    dot: $('sync-dot'), name: $('account-name'), email: $('account-email'),
    status: $('sync-status'), signOut: $('sign-out'), label: $('avatar-label'),
  };
  // The menu itself (open/close, theme, Settings, version) is menu.js.
  const setMenu = () => window.AppMenu?.close();
  const signedOutAvatar = ui.avatar.innerHTML;   // the generic person icon
  // Google photo, falling back to the first letter if there's none or it fails to load.
  function showPhoto(img, letterEl, url, letter) {
    letterEl.textContent = letter;
    img.hidden = !url; letterEl.hidden = !!url;
    if (url) { img.onerror = () => { img.hidden = true; letterEl.hidden = false; }; img.src = url; }
  }

  ui.signIn.addEventListener('click', async () => {
    try {
      const provider = new authLib.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });   // always show Google's account chooser (Issue #85)
      await authLib.signInWithPopup(auth, provider);
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
  ui.signOut.addEventListener('click', async () => {
    setMenu(false);
    if (localStorage.getItem(pushKey) === '1') await pushOff(auth.currentUser);   // this device stops getting this account's reminders (Issue #51)
    authLib.signOut(auth);
  });

  // ---- Download my data (Settings → Your account, Issue #80) ------------------
  // A JSON copy of the to-dos and lists in the account, every stage (the right to a
  // copy of your data). Dates come out as ISO text.
  $('download-data').addEventListener('click', async (e) => {
    const user = auth.currentUser, btn = e.currentTarget; if (!user) return;
    btn.disabled = true;
    // Firestore dates → readable text (before JSON, which would turn them into {seconds, …}).
    const plain = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString()
      : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
    try {
      const out = { app: 'The Shortlist', exportedAt: new Date().toISOString(),
        account: { name: user.displayName, email: user.email }, stages: {} };
      for (const stage of ['local', 'dev', 'alpha', 'staging', 'main']) {
        for (const name of ['todos', 'lists']) {
          const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, 'stages', stage, name));
          if (!snap.size) continue;
          (out.stages[stage] ||= {})[name] = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
        }
      }
      const devs = await fs.getDocs(fs.collection(db, 'users', user.uid, 'devices'));   // phone notifications (Issue #51)
      if (devs.size) out.devices = devs.docs.map((d) => { const v = plain(d.data()); return { id: d.id, ...v, token: `…${String(v.token).slice(-8)}` }; });
      const json = JSON.stringify(out, null, 2);
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
        download: `the-shortlist-my-data-${new Date().toISOString().slice(0, 10)}.json`,
      });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast('Your data has been downloaded.');
    } catch (err) {
      toast(`Couldn't download your data (${err.code || err.message}).`, 6000);
    } finally { btn.disabled = false; }
  });

  // ---- Delete my account (Settings → Your account, Issue #79) -----------------
  // Removes the to-dos and lists saved in the account on every stage, then the
  // sign-in itself (Google may ask to sign in again first). The device's own
  // signed-out to-dos are left alone.
  let deleting = false;
  const delDlg = $('delete-account'), delGo = $('delete-account-go'), delErr = $('delete-account-error');
  $('delete-account-open').addEventListener('click', () => { $('settings')?.close(); delErr.hidden = true; delDlg.showModal(); });
  delGo.addEventListener('click', async () => {
    const user = auth.currentUser; if (!user) return;
    delGo.disabled = true; delGo.textContent = 'Deleting…'; delErr.hidden = true;
    try {
      for (const stage of ['local', 'dev', 'alpha', 'staging', 'main']) {
        for (const name of ['todos', 'lists']) {
          const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, 'stages', stage, name));
          for (let i = 0; i < snap.docs.length; i += 400) {
            const batch = fs.writeBatch(db);
            snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        }
      }
      for (const d of (await fs.getDocs(fs.collection(db, 'users', user.uid, 'devices'))).docs) await fs.deleteDoc(d.ref);   // Issue #51
      localStorage.removeItem(pushKey);
      deleting = true;
      try { await authLib.deleteUser(user); } catch (err) {
        if (err.code !== 'auth/requires-recent-login') throw err;
        await authLib.reauthenticateWithPopup(user, new authLib.GoogleAuthProvider());
        await authLib.deleteUser(user);
      }
      delDlg.close();
      toast('Your account has been deleted.', 6000);
    } catch (err) {
      deleting = false;
      delErr.textContent = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)
        ? "Not deleted: the sign-in check was closed. Try again when you're ready."
        : `Couldn't finish deleting (${err.code || err.message}). Check your connection and try again.`;
      delErr.hidden = false;
    } finally { delGo.disabled = false; delGo.textContent = 'Delete my account'; }
  });

  // ---- Phone notifications (Settings → Reminders, Issue #51 part 2) -----------
  // One reminder channel per device: with them on, this device gets reminders from
  // the server (Firebase Cloud Messaging, sent by the sendReminders Cloud Function,
  // see functions/) and the app stops showing its own reminder card. Needs a Web
  // Push key (window.FIREBASE_VAPID_KEY in firebase-config.js) and, on iPhone, the
  // app opened from the Home Screen.
  const VAPID = window.FIREBASE_VAPID_KEY;
  const pushKey = `push-on-${app.stage}`, devKey = `push-device-${app.stage}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const canPush = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  let msgLib = null, messaging = null;
  async function useMessaging() {
    if (!messaging) {
      msgLib = await import(`${SDK}/firebase-messaging.js`);
      if (!(await msgLib.isSupported())) throw new Error('not supported in this browser');
      messaging = msgLib.getMessaging(fbApp);
    }
    return msgLib;
  }
  const deviceId = () => {
    let id = localStorage.getItem(devKey);
    if (!id) { id = crypto.randomUUID().replace(/-/g, '').slice(0, 24); localStorage.setItem(devKey, id); }
    return id;
  };
  const leadPref = () => { try { const v = +JSON.parse(localStorage.getItem(`prefs:${location.pathname.split('/')[1] || 'app'}`) || '{}').remindLead; return [0, 15, 60].includes(v) ? v : 15; } catch { return 15; } };
  const devRef = (uid) => fs.doc(db, 'users', uid, 'devices', deviceId());
  // The daily summary's settings travel with the device record, so the server knows when to send it (Issue #91).
  const P = (k) => window.AppPrefs?.get(k);
  const summaryFields = () => ({ sumOn: P('summaryOn') === '1', sumTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(P('summaryTime') || '') ? P('summaryTime') : '08:00',
    sumDays: P('summaryDays') === 'week' ? 'week' : 'all', sumSkip: P('summarySkip') !== '0' });
  const saveDevice = (user, token) => fs.setDoc(devRef(user.uid), {
    token, stage: app.stage, lead: leadPref(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
    url: location.origin + location.pathname, updatedAt: fs.serverTimestamp(), ...summaryFields(),
  });
  const pushToken = async () => { const lib = await useMessaging(); return lib.getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: await navigator.serviceWorker.ready }); };
  function pushState() {
    if (!VAPID || !canPush()) return isIOS && !installed() ? 'needs-install' : 'unsupported';
    if (isIOS && !installed()) return 'needs-install';
    if (!auth.currentUser) return 'signed-out';
    if (Notification.permission === 'denied') return 'denied';
    return localStorage.getItem(pushKey) === '1' && Notification.permission === 'granted' ? 'on' : 'off';
  }
  const PUSH_TEXT = {
    unsupported: "This browser can't show notifications. You're reminded in the app while it's open.",
    'needs-install': "On iPhone, notifications only work in the app on your Home Screen: add it from Account and app, then open it from there. Until then you're reminded in the app while it's open.",
    'signed-out': "Sign in to get notifications (they're sent from your account). Until then you're reminded in the app while it's open.",
    denied: 'Notifications are blocked for this app. To allow them on iPhone: Settings → Notifications → The Shortlist.',
    off: "Get a notification when a to-do is due, even when the app is closed. While it's off, you're reminded in the app while it's open.",
    on: "On for this device: reminders arrive as notifications, even when the app is closed.",
  };
  function showPush() {
    const s = pushState();
    window.REMIND_CHANNEL = s === 'on' ? 'push' : 'app';
    window.PUSH_STATE = VAPID ? s : null; dispatchEvent(new Event('pushchange'));   // the gold strip's reminders nudge (Issue #96)
    $('push-setting').hidden = !VAPID;
    $('push-help').textContent = PUSH_TEXT[s];
    $('push-on').hidden = s !== 'off';
    $('push-test').hidden = $('push-off').hidden = s !== 'on';
    showSummary(s);
  }
  // ---- Daily summary (Settings → Reminders, Issue #91) ----
  const fmtT = (v) => { const [h, m] = v.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  for (let m = 5 * 60; m <= 22 * 60; m += 30) { const v = `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; $('sum-time').append(new Option(fmtT(v), v)); }
  function showSummary(s = pushState()) {
    const on = P('summaryOn') === '1', ready = s === 'on';
    $('summary-setting').hidden = !VAPID;
    $('sum-on').checked = on && ready; $('sum-on').disabled = !ready;
    $('sum-help').textContent = ready ? "A notification each day with what's due and anything overdue."
      : "A notification each day with what's due and anything overdue. Turn on phone notifications above first.";
    $('sum-opts').hidden = !(on && ready);
    $('sum-time').value = summaryFields().sumTime; $('sum-skip').checked = P('summarySkip') !== '0';
  }
  $('sum-on').addEventListener('change', (e) => window.AppPrefs?.set('summaryOn', e.target.checked ? '1' : '0'));
  $('sum-time').addEventListener('change', (e) => window.AppPrefs?.set('summaryTime', e.target.value));
  $('sum-skip').addEventListener('change', (e) => window.AppPrefs?.set('summarySkip', e.target.checked ? '1' : '0'));
  $('sum-now').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const fns = await import(`${SDK}/firebase-functions.js`);
      await fns.httpsCallable(fns.getFunctions(fbApp, 'europe-west2'), 'sendSummaryNow')({ device: deviceId() });
      toast("Today's summary is on its way.");
    } catch (err) { toast(`Couldn't send it (${err.message || err.code}).`, 6000); } finally { btn.disabled = false; }
  });
  async function pushOff(user) {
    localStorage.removeItem(pushKey);
    try { if (user) await fs.deleteDoc(devRef(user.uid)); } catch { /* offline: the server drops it once the token stops working */ }
    try { await useMessaging(); await msgLib.deleteToken(messaging); } catch { /* nothing to remove */ }
    showPush();
  }
  $('push-on').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const asked = Notification.requestPermission();   // ask straight away, while the tap still counts (iPhone)
    btn.disabled = true;
    try {
      if ((await asked) !== 'granted') return;
      await saveDevice(auth.currentUser, await pushToken());
      localStorage.setItem(pushKey, '1');
      toast('Notifications are on for this device.');
    } catch (err) {
      toast(`Couldn't turn on notifications (${err.code || err.message}).`, 6000);
    } finally { btn.disabled = false; showPush(); }
  });
  $('push-off').addEventListener('click', () => pushOff(auth.currentUser).then(() => toast('Notifications are off for this device.')));
  $('push-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const fns = await import(`${SDK}/firebase-functions.js`);
      await fns.httpsCallable(fns.getFunctions(fbApp, 'europe-west2'), 'sendTestReminder')({ device: deviceId() });
      toast('Test sent: it should arrive in a few seconds.');
    } catch (err) {
      toast(`Couldn't send a test (${err.message || err.code}).`, 6000);
    } finally { btn.disabled = false; }
  });
  addEventListener('prefschange', () => {   // "remind me" default or the daily summary changed: tell the server
    const u = auth.currentUser;
    if (u && pushState() === 'on') fs.updateDoc(devRef(u.uid), { lead: leadPref(), ...summaryFields(), updatedAt: fs.serverTimestamp() }).catch(() => {});
    showSummary();
  });
  showPush();

  // ---- Sync status --------------------------------------------------------
  let pending = false;
  let error = '';
  const STATUS = {
    synced: 'All changes saved to your account',
    saving: 'Saving…',
    updating: 'Updating your list…',
    offline: "Offline: changes will sync when you're back online",
    error: () => `Couldn't sync: ${error}`,
  };
  function showStatus() {
    const state = error ? 'error' : !navigator.onLine ? 'offline' : pending ? 'saving' : app.updating ? 'updating' : 'synced';
    const text = typeof STATUS[state] === 'function' ? STATUS[state]() : STATUS[state];
    ui.dot.hidden = false;
    ui.status.hidden = state === 'synced';   // all saved: the dot says it; the line shows only when something needs attention (Issue #87)
    const look = state === 'updating' ? 'saving' : state;   // same blue as Saving…
    ui.status.className = `sync-status ${look}`;
    ui.status.replaceChildren(icon({ synced: 'cloud-check', saving: 'cloud-arrow-up', updating: 'cloud-arrow-down', offline: 'cloud-slash', error: 'warning-circle' }[state]), text);
    ui.dot.className = `sync-dot ${look}`;
    ui.button.setAttribute('aria-label', `Menu: ${ui.name.textContent}. ${text}`);
    ui.button.title = text;
  }
  addEventListener('online', showStatus);
  addEventListener('offline', showStatus);
  const failed = (err) => { error = err.code === 'permission-denied' ? 'not allowed' : (err.code || err.message); showStatus(); };

  // ---- Signed in / out ----------------------------------------------------
  let unsubscribe = null, unsubscribeLists = null;
  authLib.onAuthStateChanged(auth, (user) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (unsubscribeLists) { unsubscribeLists(); unsubscribeLists = null; }
    setMenu(false);
    ui.box.classList.toggle('signed-in', !!user);
    document.getElementById('signin-box').hidden = !!user;   // sign-in lives at the top of the menu
    ui.signOut.hidden = !user;
    ui.who.hidden = !user;
    $('account-setting').hidden = !user;
    showPush();
    if (user && pushState() === 'on') pushToken().then((tk) => saveDevice(user, tk)).catch(() => {});   // keep this device's token fresh (Issue #51)
    if (!user) {
      ui.avatarImg.hidden = true; ui.avatar.hidden = false;
      ui.avatar.innerHTML = signedOutAvatar; ui.avatar.classList.remove('letter');
      ui.label.textContent = 'Menu';
      ui.status.hidden = ui.dot.hidden = true;
      ui.button.setAttribute('aria-label', 'Menu'); ui.button.title = 'Menu';
      if (localStorage.getItem('signed-in') && !deleting) toast('Signed out. Showing the to-dos saved on this device.');
      localStorage.removeItem('signed-in');
      app.useLocal({ forget: true });
      return;
    }
    localStorage.setItem('signed-in', '1');
    const name = user.displayName || user.email || 'Signed in';
    ui.name.textContent = name;
    ui.email.textContent = user.email || '';
    const letter = name.trim().charAt(0).toUpperCase();
    showPhoto(ui.avatarImg, ui.avatar, user.photoURL, letter);
    showPhoto(ui.whoImg, ui.whoLetter, user.photoURL, letter);
    ui.avatar.classList.add('letter');
    ui.label.textContent = 'My account';
    error = '';

    const todosRef = fs.collection(db, 'users', user.uid, 'stages', app.stage, 'todos');
    const listsRef = fs.collection(db, 'users', user.uid, 'stages', app.stage, 'lists');   // your own lists (Issue #72)
    let migrated = false;
    app.useCloud({
      add(t) {
        fs.addDoc(todosRef, newDoc(t, Date.now())).catch(failed);
      },
      update(t, changes) {
        fs.updateDoc(fs.doc(todosRef, t.id), changes).catch(failed);
      },
      remove(t) {
        fs.deleteDoc(fs.doc(todosRef, t.id)).catch(failed);
      },
      addList(l) {
        fs.setDoc(fs.doc(listsRef, l.id), newList(l)).catch(failed);
      },
      updateList(l, changes) {
        fs.updateDoc(fs.doc(listsRef, l.id), changes).catch(failed);
      },
      removeList(l) {
        fs.deleteDoc(fs.doc(listsRef, l.id)).catch(failed);
      },
    });
    unsubscribeLists = fs.onSnapshot(fs.query(listsRef, fs.orderBy('pos')), (snap) => {
      app.setLists(snap.docs.map((d) => { const { name, color, icon, pos } = d.data(); return { id: d.id, name, color, icon, pos }; }));
    }, failed);
    showStatus();

    unsubscribe = fs.onSnapshot(fs.query(todosRef, fs.orderBy('pos')), { includeMetadataChanges: true }, (snap) => {
      const list = snap.docs.map((d) => {
        const { text, done, p, doneAt = null, starred = false, due = null, evening = false, time = null, items = [], archived = false, note = null, myDay = null, list = null, remind = null, snooze = null } = d.data();
        return { id: d.id, text, done, p, doneAt, starred, due, evening, time, items, archived, note, myDay, list, remind, snooze };
      });
      app.setTodos(list, { fromServer: !snap.metadata.fromCache });
      pending = snap.metadata.hasPendingWrites;
      if (!pending) error = '';
      showStatus();
      // Once we've heard from the server, copy this device's to-dos in (first time only).
      if (!migrated && !snap.metadata.fromCache) { migrated = true; copyLocalTodos(user, list, todosRef, listsRef); }
    }, failed);
  });

  // Checklist items as the rules expect: up to 50 of { text (1-200 chars), done }.
  function cleanItems(items) {
    return items.filter((i) => i && typeof i.text === 'string' && i.text.trim())
      .slice(0, 50).map((i) => ({ text: i.text.trim().slice(0, 200), done: i.done === true }));
  }
  function newDoc(t, pos) {
    const doc = { text: String(t.text).slice(0, 500), done: !!t.done, p: t.p, pos, createdAt: fs.serverTimestamp() };
    // When it was ticked (for the Done group's date ranges); only if known.
    if (t.done && Number.isFinite(t.doneAt)) doc.doneAt = t.doneAt;
    if (t.starred === true) doc.starred = true;   // starred on this device (Issue #22)
    if (typeof t.due === 'string' && /^20\d\d-[01]\d-[0-3]\d$/.test(t.due)) doc.due = t.due;   // Issue #23
    if (t.evening === true) doc.evening = true;   // "Tonight" (Issue #43)
    if (typeof t.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) doc.time = t.time;   // Issue #50
    if (t.archived === true) doc.archived = true;   // Issue #49
    if (typeof t.note === 'string' && t.note.trim()) doc.note = t.note.trim().slice(0, 2000);   // Issue #57
    if (typeof t.myDay === 'string' && /^20\d\d-[01]\d-[0-3]\d$/.test(t.myDay)) doc.myDay = t.myDay;   // My Day (Issue #71)
    if (t.remind === 'off' || [0, 15, 60].includes(t.remind)) doc.remind = t.remind;   // reminder (Issue #51)
    if (Number.isFinite(t.snooze)) doc.snooze = t.snooze;   // snoozed reminder: when to remind again (Issue #51)
    if (typeof t.list === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.list)) doc.list = t.list;   // own list (Issue #72)
    if (Array.isArray(t.items) && t.items.length) doc.items = cleanItems(t.items);   // checklist (Issue #44)
    return doc;
  }
  const LIST_COLORS = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'purple', 'grape', 'pink', 'graphite'];
  function newList(l) {
    return { name: String(l.name).trim().slice(0, 40) || 'List', color: LIST_COLORS.includes(l.color) ? l.color : 'blue',
      icon: typeof l.icon === 'string' ? l.icon : 'list', pos: Number.isFinite(l.pos) ? l.pos : Date.now(), createdAt: fs.serverTimestamp() };
  }

  // The first time someone signs in on a device, add the to-dos saved on that
  // device to their account (skipping any already there). The device's own
  // copy is left untouched, so it's still there after signing out.
  async function copyLocalTodos(user, existing, todosRef, listsRef) {
    const flag = `copied-${app.stage}-${user.uid}`;
    if (localStorage.getItem(flag)) return;
    // This device's own lists first (Issue #72): a list with the same name in the
    // account is reused; the others are added with the same id, so to-dos still match.
    const moved = new Map();
    try {
      const have = new Map((await fs.getDocs(listsRef)).docs.map((d) => [String(d.data().name).toLowerCase(), d.id]));
      for (const l of app.localLists()) {
        const same = have.get(String(l.name).toLowerCase());
        if (same) moved.set(l.id, same); else if (/^[A-Za-z0-9_-]{1,40}$/.test(l.id)) await fs.setDoc(fs.doc(listsRef, l.id), newList(l));
      }
    } catch (err) { failed(err); return; }
    const have = new Set(existing.map((t) => t.text));
    // Starter examples (Issue #93) stay on the device unless renamed or rewritten (no `sample` then).
    const toAdd = app.localTodos().filter((t) => t.text && !t.sample && !have.has(String(t.text).slice(0, 500)));
    if (toAdd.length) {
      const base = Date.now();
      for (let i = 0; i < toAdd.length; i += 400) { // Firestore batches hold up to 500 writes
        const batch = fs.writeBatch(db);
        toAdd.slice(i, i + 400).forEach((t, j) => batch.set(fs.doc(todosRef), newDoc(moved.has(t.list) ? { ...t, list: moved.get(t.list) } : t, base + i + j)));
        try { await batch.commit(); } catch (err) { failed(err); return; }
      }
      const n = toAdd.length;
      toast(`${n} to-do${n === 1 ? '' : 's'} from this device ${n === 1 ? 'was' : 'were'} added to your account.`);
    }
    localStorage.setItem(flag, '1');
  }
}

// Short message at the bottom of the screen.
// Short message at the bottom of the screen (toast.js).
function toast(message, ms) { window.AppToast?.show(message, { duration: ms }); }
