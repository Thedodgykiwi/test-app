// Reminders, part 2 (Issue #51): phone notifications.
//
// Each device that turns on phone notifications saves a small record in
//   users/{uid}/devices/{deviceId} = { token, stage, lead, tz, url, updatedAt }
// (token = where Firebase Cloud Messaging delivers; lead = that device's default
// "remind me" minutes; tz = its time zone, because to-do times are local times).
//
// sendReminders runs every minute: for each device it looks at that user's
// to-dos on the device's stage, works out when each reminder is due (the to-do's
// own `remind`, else the device's lead) and sends the ones that fell due since
// the last run. Each send is recorded once in system/reminders/sent, so a retry
// or an overlapping run can't send it twice. sendTestReminder sends a test to one
// of the caller's own devices (Settings → Reminders → Send a test notification).
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
setGlobalOptions({ region: 'europe-west2', maxInstances: 1 });   // London, near the Firestore data (eur3)
const db = getFirestore();

const LEADS = [0, 15, 60];
const DAY_RE = /^20\d\d-[01]\d-[0-3]\d$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// The moment (UTC milliseconds) a wall-clock date and time happens in a time zone.
function zonedMs(day, time, tz) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi);
  const offset = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  const first = want - offset(want);
  return want - offset(first);
}
// The calendar day (YYYY-MM-DD) a moment falls on in a time zone.
const dayIn = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const safeTz = (tz) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch { return 'Europe/London'; } };
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
const bodyFor = (lead, time) => (lead === 0 ? `Due now · ${fmtTime(time)}` : `Due in ${lead === 60 ? '1 hour' : `${lead} min`} · ${fmtTime(time)}`);

// ---- Daily summary (Issue #91, option B) ---------------------------------------
// Title "☀️ Today: n to do"; body one line each (overdue first, then today's by time):
// "⚠️ Pay the deposit (overdue)", "⏰ 9:30am Pick up the suit", "🌙 Put the bins out", "• Order flowers",
// at most 3 lines plus "+n more". Fits a Lock Screen notification (title ~40, body ~150 characters).
async function summaryFor(uid, stage, tz, now) {
  const today = dayIn(now, tz);
  const snap = await db.collection(`users/${uid}/stages/${stage}/todos`).where('due', '<=', today).get();
  const open = snap.docs.map((d) => d.data()).filter((t) => !t.done && !t.archived && DAY_RE.test(t.due || ''));
  const overdue = open.filter((t) => t.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const due = open.filter((t) => t.due === today).sort((a, b) => ((a.evening ? 1 : 0) - (b.evening ? 1 : 0)) || (TIME_RE.test(a.time || '') ? a.time : '99').localeCompare(TIME_RE.test(b.time || '') ? b.time : '99'));
  const cut = (s) => (s.length > 42 ? s.slice(0, 41) + '…' : s);
  const lines = [...overdue.map((t) => `⚠️ ${cut(t.text)} (overdue)`),
    ...due.map((t) => (TIME_RE.test(t.time || '') ? `⏰ ${fmtTime(t.time)} ${cut(t.text)}` : t.evening ? `🌙 ${cut(t.text)}` : `• ${cut(t.text)}`))];
  const n = lines.length;
  return { n, title: n ? `☀️ Today: ${n} to do` : '☀️ Nothing due today',
    body: n ? lines.slice(0, 3).join('\n') + (n > 3 ? `\n+${n - 3} more` : '') : 'Enjoy your day.' };
}

// Data-only message: the app's own service worker (sw.js) shows it, so it looks the
// same on every stage and tapping it opens the right to-do.
function message(token, data) {
  return { token, data, webpush: { headers: { Urgency: 'high', TTL: '3600' } } };
}
const GONE = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

exports.sendReminders = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Europe/London', retryCount: 0, memory: '256MiB' }, async () => {
  const now = Date.now();
  const stateRef = db.doc('system/reminders');
  const state = await stateRef.get();
  // Everything that fell due since the last run (at most 30 minutes back, so a long outage doesn't flood you).
  const from = Math.max(state.exists ? state.get('lastRun') || 0 : now - 2 * 60000, now - 30 * 60000);

  const devices = await db.collectionGroup('devices').get();
  const groups = new Map();   // "uid|stage" → [device…]
  for (const d of devices.docs) {
    const uid = d.ref.parent.parent?.id, v = d.data();
    if (!uid || !v.token || !v.stage) continue;
    const key = `${uid}|${v.stage}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ref: d.ref, ...v, tz: safeTz(v.tz), lead: LEADS.includes(v.lead) ? v.lead : 15 });
  }

  let sent = 0;
  for (const [key, devs] of groups) {
    const [uid, stage] = key.split('|');
    const tz = devs[0].tz;
    for (const dev of devs) {   // daily summary at the device's chosen time, in its time zone (Issue #91)
      if (dev.sumOn !== true || !TIME_RE.test(dev.sumTime || '')) continue;
      const localDay = dayIn(now, dev.tz), at = zonedMs(localDay, dev.sumTime, dev.tz);
      if (at <= from || at > now) continue;
      const wd = new Date(Date.UTC(...localDay.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))).getUTCDay();
      if (dev.sumDays === 'week' && (wd === 0 || wd === 6)) continue;
      const sref = db.doc(`system/reminders/sent/${dev.id}_sum_${localDay}`);
      try { await sref.create({ at: Timestamp.now() }); } catch { continue; }
      const s = await summaryFor(uid, stage, dev.tz, now);
      if (!s.n && dev.sumSkip !== false) continue;
      try {
        await getMessaging().send(message(dev.token, { title: s.title, body: s.body, tag: 'summary', todo: '', view: 'all', url: dev.url || '' }));
        sent++;
      } catch (err) { if (GONE.includes(err.code)) await dev.ref.delete().catch(() => {}); }
    }
    // A reminder can be up to an hour before its to-do: look at to-dos due from the day of `from` to the day an hour ahead.
    const snap = await db.collection(`users/${uid}/stages/${stage}/todos`)
      .where('due', '>=', dayIn(from - 864e5, tz)).where('due', '<=', dayIn(now + 61 * 60000, tz)).get();
    for (const doc of snap.docs) {
      const t = doc.data();
      if (t.done || t.archived || t.remind === 'off' || !DAY_RE.test(t.due || '') || !TIME_RE.test(t.time || '')) continue;
      const snz = typeof t.snooze === 'number' && t.snooze > from && t.snooze <= now ? t.snooze : 0;   // Snooze 10 min, from any device
      for (const dev of devs) {
        const lead = LEADS.includes(t.remind) ? t.remind : dev.lead;
        const at = zonedMs(t.due, t.time, dev.tz), fire = at - lead * 60000;
        if (snz) {
          const ref = db.doc(`system/reminders/sent/${dev.id}_${doc.id}_snz${snz}`);
          try { await ref.create({ at: Timestamp.now() }); } catch { continue; }
          const mins = Math.round((at - now) / 60000);
          try {
            await getMessaging().send(message(dev.token, { title: String(t.text || 'Reminder').slice(0, 120),
              body: mins > 0 ? `Due in ${mins >= 60 ? 'about ' + Math.round(mins / 60) + ' hour' + (mins >= 90 ? 's' : '') : mins + ' min'} · ${fmtTime(t.time)}` : `Was due at ${fmtTime(t.time)}`,
              tag: `todo-${doc.id}`, todo: doc.id, url: dev.url || '' }));
            sent++;
          } catch (err) { if (GONE.includes(err.code)) await dev.ref.delete().catch(() => {}); }
          continue;
        }
        if (fire <= from || fire > now) continue;
        const sentRef = db.doc(`system/reminders/sent/${dev.id}_${doc.id}_${t.due}_${t.time.replace(':', '')}_${lead}`);
        try { await sentRef.create({ at: Timestamp.now() }); } catch { continue; }   // already sent
        try {
          await getMessaging().send(message(dev.token, {
            title: String(t.text || 'Reminder').slice(0, 120), body: bodyFor(lead, t.time),
            tag: `todo-${doc.id}`, todo: doc.id, url: dev.url || '',
          }));
          sent++;
        } catch (err) {
          logger.warn('send failed', { code: err.code, device: dev.id });
          if (GONE.includes(err.code)) await dev.ref.delete().catch(() => {});   // the device turned notifications off or reinstalled
        }
      }
    }
  }
  await stateRef.set({ lastRun: now });

  // Tidy the "already sent" records after 3 days.
  const old = await db.collection('system/reminders/sent').where('at', '<', Timestamp.fromMillis(now - 3 * 864e5)).limit(300).get();
  if (!old.empty) { const b = db.batch(); old.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  if (sent) logger.info(`sent ${sent} reminder(s)`);
});

exports.sendTestReminder = onCall(async (req) => {
  const uid = req.auth?.uid, device = String(req.data?.device || '');
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(device)) throw new HttpsError('invalid-argument', 'Unknown device.');
  const ref = db.doc(`users/${uid}/devices/${device}`), snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Phone notifications are not on for this device.');
  const d = snap.data();
  try {
    await getMessaging().send(message(d.token, { title: 'Test reminder', body: "Reminders will arrive like this, even when the app is closed.", tag: 'test', todo: '', url: d.url || '' }));
  } catch (err) {
    if (GONE.includes(err.code)) await ref.delete().catch(() => {});
    throw new HttpsError('unavailable', `Couldn't send (${err.code || err.message}).`);
  }
  return { ok: true };
});

// Settings → Daily summary → "Send me today's summary now": the real summary, to one of the caller's devices.
exports.sendSummaryNow = onCall(async (req) => {
  const uid = req.auth?.uid, device = String(req.data?.device || '');
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(device)) throw new HttpsError('invalid-argument', 'Unknown device.');
  const ref = db.doc(`users/${uid}/devices/${device}`), snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Phone notifications are not on for this device.');
  const d = snap.data(), s = await summaryFor(uid, d.stage, safeTz(d.tz), Date.now());
  try {
    await getMessaging().send(message(d.token, { title: s.title, body: s.body, tag: 'summary', todo: '', view: 'all', url: d.url || '' }));
  } catch (err) {
    if (GONE.includes(err.code)) await ref.delete().catch(() => {});
    throw new HttpsError('unavailable', `Couldn't send (${err.code || err.message}).`);
  }
  return { ok: true, n: s.n };
});
