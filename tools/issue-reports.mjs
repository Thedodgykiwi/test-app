// Turns "Report issue" submissions (Issue #28) into GitHub issues and emails
// the reporter a copy. Run by .github/workflows/issue-reports.yml every few
// minutes; not part of the app (the app never loads this file).
//
// 1. New reports (status 'new'; admin access, so the security rules don't
//    apply): create an issue in the playbook's layout, mark the report
//    'logged' with the issue number, email the reporter a receipt.
// 2. Logged reports whose issue has since closed (Issue #34): if the fix is
//    in a Production release (its release notes have a line ending "(#n)"),
//    email the reporter that line as a friendly "it's fixed" note and mark
//    the report 'fixed'. Closed without a release: mark it 'closed'. Either
//    way the reporter's email address is then deleted from the report.
//
// Needs (GitHub → Settings → Secrets and variables → Actions):
//   FIREBASE_SERVICE_ACCOUNT  the service account key (JSON) for the project
//   GMAIL_USER                the Gmail address the receipt is sent from
//   GMAIL_APP_PASSWORD        a Gmail "app password" for that address
// and from the workflow: GITHUB_TOKEN, GITHUB_REPOSITORY, APP_NAME, APP_URL
// (the Production address, for its releases.json and the email's link).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

const env = process.env;
if (env.FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: env.GCLOUD_PROJECT || 'demo-test-app' });   // local testing
} else if (!env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT secret not set yet: nothing to do.');
  process.exit(0);
} else {
  initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const repo = env.GITHUB_REPOSITORY;
const appName = env.APP_NAME || repo.split('/')[1];
const appUrl = (env.APP_URL || '').replace(/\/?$/, '/');
const api = env.GITHUB_API_URL || 'https://api.github.com';
const ghHeaders = { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' };
const STAGES = { local: 'Local copy', dev: 'Dev', alpha: 'Alpha', staging: 'Staging', main: 'Production' };
const TYPES = ['bug', 'feature', 'tweak', 'performance'];
const mailer = env.MAIL_TEST ? nodemailer.createTransport({ jsonTransport: true })   // local testing: builds emails, sends nothing
  : env.GMAIL_USER && env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } })
  : null;
if (!mailer) console.log('Gmail secrets not set: issues will be created but no emails sent.');

// Stop "@someone" in a report from notifying GitHub users (the repo is public).
const noMentions = (s) => s.replace(/@(?=[A-Za-z0-9])/g, '@​');

async function createIssue(r) {
  const body = [
    "**What's happening / what's wanted**", noMentions(r.body), '',
    '**Where**', `${STAGES[r.stage] || r.stage} (sent from the stage banner's "Report issue")`, '',
    '**Expected**', '_To fill in when triaged._', '',
    '**Reported by**', 'tester', '',
    '**Notes**', `Submitted ${r.createdAt?.toDate().toISOString().slice(0, 16).replace('T', ' ')} UTC from the app.`,
  ].join('\n');
  const res = await fetch(`${api}/repos/${repo}/issues`, {
    method: 'POST',
    headers: { ...ghHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ title: noMentions(r.title), body, labels: TYPES.includes(r.type) ? [r.type] : [] }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}: ${await res.text()}`);
  return res.json();
}

const typeName = (t) => (TYPES.includes(t) ? t[0].toUpperCase() + t.slice(1) : 'Not set');
const stageOf = (r) => STAGES[r.stage] || r.stage;

async function sendReceipt(r, issue) {
  const type = typeName(r.type), stageName = stageOf(r);
  const text = `Thanks for your report: it's been logged as #${issue.number}. We'll take a look, and we'll email you again when it's fixed.

WHAT YOU SENT
Title: ${r.title}
Type: ${type}
Stage: ${stageName}

Description:
${r.body}

Sent from ${appName} (${stageName}) using "Report issue".`;
  await mailer.sendMail({
    from: `"${appName}" <${env.GMAIL_USER}>`,
    to: r.email,
    subject: `Logged as #${issue.number}: ${r.title}`,
    text,
    html: emailCard({
      stage: r.stage,
      title: `${appName} · ${stageName}`,
      heading: `Thanks, it's logged as #${issue.number}`,
      intro: "We'll take a look, and we'll email you again when it's fixed.",
      rows: [['Title', `<b>${h(r.title)}</b>`],
        ['Type', type === 'Not set' ? '<span style="color:#5f6570;">Not set</span>' : pill(type, '#e7ecff', '#3b5bdb')],
        ['Stage', pill(stageName, STAGE_COLOURS[r.stage] || '#4263eb', '#ffffff')]],
      rowsHeading: 'What you sent',
      box: ['Description', h(r.body)],
      footer: `You're getting this because you used "Report issue" in ${h(appName)} (${h(stageName)}).`,
    }),
  });
}

// ---- "It's fixed" emails (Issue #34) ---------------------------------------
// The friendly line for issue #n from Production's release notes: the bullet
// ending "(#n)" (the release notes write one per issue), as plain text.
let notesCache;
async function productionNote(n) {
  if (notesCache === undefined) {
    notesCache = null;
    if (appUrl !== '/') {
      try {
        const res = await fetch(`${appUrl}releases.json?t=${Date.now()}`);
        if (res.ok) notesCache = (await res.json()).releases || [];
      } catch (e) { console.warn("Couldn't read Production's releases.json:", e.message); }
    }
  }
  for (const rel of notesCache || []) {
    for (const line of String(rel.notes || '').split('\n')) {
      if (new RegExp(`\\(#${n}\\)\\s*$`).test(line.trim())) {
        return line.trim().replace(/^[-*]\s*/, '').replace(/\s*\(#\d+\)\s*$/, '')
          .replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      }
    }
  }
  return null;
}

async function sendFixed(r, note) {
  const stageName = stageOf(r);
  const [headline, ...restParts] = note.split(/\s+[—–-]\s+/);
  const joined = restParts.join(' — ');
  const rest = joined && joined[0].toUpperCase() + joined.slice(1);
  const text = `Good news: the issue you reported has been fixed, and the fix is now live in ${appName}.

WHAT CHANGED
${note}

YOU REPORTED
${r.title}

Thanks for taking the time to report it: it really helps.${appUrl !== '/' ? `\n\nOpen ${appName}: ${appUrl}` : ''}`;
  await mailer.sendMail({
    from: `"${appName}" <${env.GMAIL_USER}>`,
    to: r.email,
    subject: `Fixed: ${r.title}`,
    text,
    html: emailCard({
      stage: 'main',
      title: appName,
      heading: "Good news: it's fixed",
      intro: `The issue you reported is fixed, and the fix is now live in ${h(appName)}. Thanks for taking the time to report it: it really helps.`,
      button: appUrl !== '/' ? [`Open ${appName}`, appUrl] : null,
      box: ['What changed', rest ? `<b>${h(headline)}</b><br>${h(rest)}` : h(note)],
      rowsHeading: 'You reported',
      rows: [['Title', `<b>${h(r.title)}</b>`], ['From', pill(stageName, STAGE_COLOURS[r.stage] || '#4263eb', '#ffffff')]],
      footer: `You're getting this because you used "Report issue" in ${h(appName)}.`,
    }),
  });
}

// ---- The emails' look -------------------------------------------------------
// A simple card in the app's style. Email programs ignore most modern CSS, so
// it uses tables and inline styles only.
const STAGE_COLOURS = { local: '#495057', dev: '#7048e8', alpha: '#c2255c', staging: '#c25e00', main: '#2b8a3e' };
const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const pill = (text, bg, fg) => `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:600;">${h(text)}</span>`;
export function emailCard({ stage, title, heading, intro, button, rowsHeading, rows = [], box, footer }) {
  const colour = STAGE_COLOURS[stage] || '#4263eb';
  const label = (t) => `<div style="${font}font-size:12px;font-weight:700;letter-spacing:.08em;color:#5f6570;text-transform:uppercase;">${t}</div>`;
  const boxHtml = box ? `<tr><td style="padding:16px 24px 4px;">${label(box[0])}
    <div style="${font}font-size:15px;color:#1d1f23;line-height:1.5;background:#f6f7f9;border-radius:10px;padding:12px 14px;margin-top:8px;white-space:pre-wrap;">${box[1]}</div></td></tr>` : '';
  const rowsHtml = rows.length ? `<tr><td style="padding:16px 24px 8px;">${label(rowsHeading)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;">${rows.map(([k, v]) => `<tr>
      <td style="${font}padding:6px 0;color:#5f6570;font-size:14px;width:70px;vertical-align:top;">${k}</td>
      <td style="${font}padding:6px 0;color:#1d1f23;font-size:15px;">${v}</td></tr>`).join('')}</table></td></tr>` : '';
  // The receipt shows what they sent (rows, then their description); the
  // "fixed" email leads with what changed (box first).
  const middle = stage === 'main' ? boxHtml + rowsHtml : rowsHtml + boxHtml;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f3f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e6eb;">
  <tr><td style="${font}background:${colour};color:#ffffff;padding:14px 24px;font-size:14px;font-weight:600;letter-spacing:.03em;">${h(title)}</td></tr>
  <tr><td style="padding:28px 24px 8px;">
    <div style="${font}font-size:22px;font-weight:700;color:#1d1f23;margin:0 0 6px;">${h(heading)}</div>
    <div style="${font}font-size:15px;color:#5f6570;line-height:1.5;">${intro}</div>
  </td></tr>
  ${button ? `<tr><td style="padding:12px 24px 4px;"><a href="${h(button[1])}" style="${font}display:inline-block;background:#4263eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;">${h(button[0])}</a></td></tr>` : ''}
  ${middle}
  <tr><td style="padding:12px 0 0;"></td></tr>
  <tr><td style="${font}padding:14px 24px;background:#f6f7f9;color:#8a9099;font-size:12px;border-top:1px solid #e3e6eb;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

// ---- 1. New reports → issues + receipts ------------------------------------
let failed = 0;
if (import.meta.url === `file://${process.argv[1]}`) await main();

async function main() {
const snap = await db.collection('issueReports').where('status', '==', 'new').limit(20).get();   // (no orderBy: that would need an index)
console.log(`${snap.size} new report(s).`);
for (const docSnap of snap.docs) {
  const ref = docSnap.ref;
  // Claim it first, so an overlapping run can't log it twice.
  const claimed = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.get('status') !== 'new') return false;
    tx.update(ref, { status: 'processing' });
    return true;
  });
  if (!claimed) continue;
  const r = docSnap.data();
  let issue;
  try {
    issue = await createIssue(r);
    await ref.update({ status: 'logged', issueNumber: issue.number, issueUrl: issue.html_url, loggedAt: FieldValue.serverTimestamp() });
    console.log(`Report ${ref.id} → issue #${issue.number}`);
  } catch (e) {
    failed++;
    console.error(`Report ${ref.id}: couldn't create the issue:`, e.message);
    await ref.update({ status: 'new', error: String(e.message).slice(0, 500) });
    continue;
  }
  if (!mailer || !r.email) continue;
  try {
    await sendReceipt(r, issue);
    // The address is kept (privately, here only) for the "it's fixed" email.
    await ref.update({ emailedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    failed++;
    console.error(`Report ${ref.id} (#${issue.number}): couldn't send the email:`, e.message);
    await ref.update({ emailError: String(e.message).slice(0, 500) });
  }
}

// ---- 2. Closed issues → "it's fixed" emails (Issue #34) --------------------
const open = await db.collection('issueReports').where('status', '==', 'logged').limit(100).get();
for (const docSnap of open.docs) {
  const r = docSnap.data(), ref = docSnap.ref;
  if (!r.issueNumber) continue;
  let issue;
  try {
    const res = await fetch(`${api}/repos/${repo}/issues/${r.issueNumber}`, { headers: ghHeaders });
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    issue = await res.json();
  } catch (e) { console.warn(`#${r.issueNumber}: couldn't check it:`, e.message); continue; }
  if (issue.state !== 'closed') continue;
  const note = issue.state_reason === 'not_planned' ? null : await productionNote(r.issueNumber);
  if (!note) {
    // Closed, but not in a Production release (yet). Release notes are
    // published just before the release closes its issues, so give a fresh
    // close an hour before deciding it wasn't a release.
    const hoursClosed = (Date.now() - Date.parse(issue.closed_at)) / 36e5;
    if (issue.state_reason !== 'not_planned' && hoursClosed < 1) continue;
    await ref.update({ status: 'closed', email: FieldValue.delete() });
    console.log(`#${r.issueNumber} closed without a Production release: no email, address removed.`);
    continue;
  }
  if (!mailer || !r.email) {
    await ref.update({ status: 'fixed', email: FieldValue.delete() });
    continue;
  }
  try {
    await sendFixed(r, note);
    await ref.update({ status: 'fixed', fixedNote: note, fixedEmailedAt: FieldValue.serverTimestamp(), email: FieldValue.delete() });
    console.log(`#${r.issueNumber} is live: "fixed" email sent, address removed.`);
  } catch (e) {
    failed++;
    console.error(`#${r.issueNumber}: couldn't send the "fixed" email:`, e.message);
    await ref.update({ emailError: String(e.message).slice(0, 500) });
  }
}
process.exit(failed ? 1 : 0);
}
