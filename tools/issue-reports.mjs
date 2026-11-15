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
  const text = `Thanks for your report: it's been logged as #${issue.number}.

We'll look at it and you can follow it here:
${issue.html_url}

A copy of what you sent:

Title: ${r.title}
Type: ${type}
Stage: ${STAGES[r.stage] || r.stage}

${r.body}

— ${appName}`;
  await mailer.sendMail({
    from: `"${appName}" <${env.GMAIL_USER}>`,
    to: r.email,
    subject: `Logged as #${issue.number}: ${r.title}`,
    text,
  });
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
