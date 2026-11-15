// Turns "Report issue" submissions (Issue #28) into GitHub issues and emails
// the reporter a copy. Run by .github/workflows/issue-reports.yml every few
// minutes; not part of the app (the app never loads this file).
//
// Reads Firestore issueReports where status == 'new' (admin access, so the
// security rules don't apply), creates an issue in the playbook's layout,
// marks the report 'logged' with the issue number, sends the email, then
// removes the reporter's email address from the report.
//
// Needs (GitHub → Settings → Secrets and variables → Actions):
//   FIREBASE_SERVICE_ACCOUNT  the service account key (JSON) for the project
//   GMAIL_USER                the Gmail address the receipt is sent from
//   GMAIL_APP_PASSWORD        a Gmail "app password" for that address
// and from the workflow: GITHUB_TOKEN, GITHUB_REPOSITORY, APP_NAME.
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
const STAGES = { local: 'Local copy', dev: 'Dev', alpha: 'Alpha', staging: 'Staging', main: 'Production' };
const TYPES = ['bug', 'feature', 'tweak', 'performance'];
const mailer = env.GMAIL_USER && env.GMAIL_APP_PASSWORD
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
  const res = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({ title: noMentions(r.title), body, labels: TYPES.includes(r.type) ? [r.type] : [] }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendReceipt(r, issue) {
  const type = TYPES.includes(r.type) ? r.type[0].toUpperCase() + r.type.slice(1) : 'Not set';
  const stageName = STAGES[r.stage] || r.stage;
  const text = `Thanks for your report: it's been logged as #${issue.number}.

Follow it here: ${issue.html_url}

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
    html: receiptHtml({ r, issue, type, stageName }),
  });
}

// The email's look: a simple card in the app's style. Email programs ignore
// most modern CSS, so it uses tables and inline styles only.
const STAGE_COLOURS = { local: '#495057', dev: '#7048e8', alpha: '#c2255c', staging: '#c25e00', main: '#2f6f4f' };
const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function receiptHtml({ r, issue, type, stageName }) {
  const colour = STAGE_COLOURS[r.stage] || '#4263eb';
  const font = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;';
  const row = (label, value) => `<tr>
    <td style="${font}padding:6px 0;color:#5f6570;font-size:14px;width:70px;vertical-align:top;">${label}</td>
    <td style="${font}padding:6px 0;color:#1d1f23;font-size:15px;">${value}</td></tr>`;
  const pill = (text, bg, fg) => `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:600;">${h(text)}</span>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f3f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e6eb;">
  <tr><td style="${font}background:${colour};color:#ffffff;padding:14px 24px;font-size:14px;font-weight:600;letter-spacing:.03em;">${h(appName)} &middot; ${h(stageName)}</td></tr>
  <tr><td style="padding:28px 24px 8px;">
    <div style="${font}font-size:22px;font-weight:700;color:#1d1f23;margin:0 0 6px;">Thanks, it's logged as #${issue.number}</div>
    <div style="${font}font-size:15px;color:#5f6570;line-height:1.5;">We'll take a look. You can follow progress on GitHub.</div>
  </td></tr>
  <tr><td style="padding:16px 24px 8px;">
    <a href="${h(issue.html_url)}" style="${font}display:inline-block;background:#4263eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;">View #${issue.number} on GitHub</a>
  </td></tr>
  <tr><td style="padding:20px 24px 0;">
    <div style="${font}font-size:12px;font-weight:700;letter-spacing:.08em;color:#5f6570;text-transform:uppercase;border-top:1px solid #e3e6eb;padding-top:18px;">What you sent</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      ${row('Title', `<b>${h(r.title)}</b>`)}
      ${row('Type', type === 'Not set' ? '<span style="color:#5f6570;">Not set</span>' : pill(type, '#e7ecff', '#3b5bdb'))}
      ${row('Stage', pill(stageName, colour, '#ffffff'))}
    </table>
  </td></tr>
  <tr><td style="padding:12px 24px 24px;">
    <div style="${font}font-size:14px;color:#5f6570;margin-bottom:6px;">Description</div>
    <div style="${font}font-size:15px;color:#1d1f23;line-height:1.5;background:#f6f7f9;border-radius:10px;padding:12px 14px;white-space:pre-wrap;">${h(r.body)}</div>
  </td></tr>
  <tr><td style="${font}padding:14px 24px;background:#f6f7f9;color:#8a9099;font-size:12px;border-top:1px solid #e3e6eb;">
    You're getting this because you used "Report issue" in ${h(appName)} (${h(stageName)}).</td></tr>
</table></td></tr></table></body></html>`;
}

const snap = await db.collection('issueReports').where('status', '==', 'new').limit(20).get();   // (no orderBy: that would need an index)
console.log(`${snap.size} new report(s).`);
let failed = 0;
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
    // Email sent: the address is no longer needed, so don't keep it.
    await ref.update({ email: FieldValue.delete(), emailedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    failed++;
    console.error(`Report ${ref.id} (#${issue.number}): couldn't send the email:`, e.message);
    await ref.update({ emailError: String(e.message).slice(0, 500) });
  }
}
process.exit(failed ? 1 : 0);
