// Tests for firestore.rules. Run from the repo root with:  npm run test:rules
// (installs nothing globally; starts a throwaway Firestore emulator, runs this
// file against it, then shuts it down. Never touches the real project.)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, orderBy, serverTimestamp, Timestamp, setLogLevel } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

setLogLevel('silent'); // denied writes are expected; keep the output readable

const env = await initializeTestEnvironment({
  projectId: 'demo-test-app',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
await env.clearFirestore();

const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const anon = env.unauthenticatedContext().firestore();
const good = () => ({ text: 'Buy milk', done: false, p: 'none', pos: Date.now(), createdAt: serverTimestamp() });
const p = (db, stage = 'dev', id = 't1') => doc(db, 'users', 'alice', 'stages', stage, 'todos', id);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, e.message); }
}

await t('owner can create valid to-do', () => assertSucceeds(setDoc(p(alice), good())));
await t('owner can read own list ordered by pos', () => assertSucceeds(getDocs(query(collection(alice, 'users/alice/stages/dev/todos'), orderBy('pos')))));
await t('owner can tick done', () => assertSucceeds(updateDoc(p(alice), { done: true })));
await t('owner can change priority', () => assertSucceeds(updateDoc(p(alice), { p: 'high' })));
await t('each valid stage works', async () => { for (const s of ['local', 'alpha', 'staging', 'main']) await assertSucceeds(setDoc(p(alice, s), good())); });
await t('signed-out cannot read', () => assertFails(getDoc(p(anon))));
await t('signed-out cannot write', () => assertFails(setDoc(p(anon, 'dev', 't2'), good())));
await t('other user cannot read', () => assertFails(getDoc(p(bob))));
await t('other user cannot write', () => assertFails(setDoc(p(bob, 'dev', 't3'), good())));
await t('other user cannot update', () => assertFails(updateDoc(p(bob), { done: false })));
await t('unknown stage rejected', () => assertFails(setDoc(p(alice, 'prod'), good())));
await t('empty text rejected', () => assertFails(setDoc(p(alice, 'dev', 'x1'), { ...good(), text: '' })));
await t('text > 500 rejected', () => assertFails(setDoc(p(alice, 'dev', 'x2'), { ...good(), text: 'a'.repeat(501) })));
await t('bad priority rejected', () => assertFails(setDoc(p(alice, 'dev', 'x3'), { ...good(), p: 'urgent' })));
await t('extra field rejected', () => assertFails(setDoc(p(alice, 'dev', 'x4'), { ...good(), evil: 1 })));
await t('missing field rejected', () => { const d = good(); delete d.done; return assertFails(setDoc(p(alice, 'dev', 'x5'), d)); });
await t('client-chosen createdAt rejected', () => assertFails(setDoc(p(alice, 'dev', 'x6'), { ...good(), createdAt: Timestamp.fromMillis(0) })));
await t('negative pos rejected', () => assertFails(setDoc(p(alice, 'dev', 'x7'), { ...good(), pos: -1 })));
await t('owner can edit text', () => assertSucceeds(updateDoc(p(alice), { text: 'Buy oat milk' })));
await t('owner can edit text and priority together', () => assertSucceeds(updateDoc(p(alice), { text: 'Buy milk', p: 'low' })));
await t('edited text cannot be empty', () => assertFails(updateDoc(p(alice), { text: '' })));
await t('edited text cannot exceed 500', () => assertFails(updateDoc(p(alice), { text: 'a'.repeat(501) })));
await t('edited text must be text', () => assertFails(updateDoc(p(alice), { text: 42 })));
await t('other user cannot edit text', () => assertFails(updateDoc(p(bob), { text: 'hacked' })));
await t('pos cannot change', () => assertFails(updateDoc(p(alice), { pos: 5 })));
await t('done must stay bool', () => assertFails(updateDoc(p(alice), { done: 'yes' })));
await t('create with doneAt time', () => assertSucceeds(setDoc(p(alice, 'dev', 'd1'), { ...good(), done: true, doneAt: Date.now() })));
await t('create with doneAt null', () => assertSucceeds(setDoc(p(alice, 'dev', 'd2'), { ...good(), doneAt: null })));
await t('tick with doneAt time', () => assertSucceeds(updateDoc(p(alice), { done: true, doneAt: Date.now() })));
await t('untick clears doneAt', () => assertSucceeds(updateDoc(p(alice), { done: false, doneAt: null })));
await t('doneAt as text rejected', () => assertFails(updateDoc(p(alice), { done: true, doneAt: 'today' })));
await t('negative doneAt rejected', () => assertFails(updateDoc(p(alice), { doneAt: -5 })));
await t('doneAt far future rejected', () => assertFails(setDoc(p(alice, 'dev', 'd3'), { ...good(), doneAt: 1e14 })));
await t('create starred', () => assertSucceeds(setDoc(p(alice, 'dev', 's1'), { ...good(), starred: true })));
await t('star a to-do', () => assertSucceeds(updateDoc(p(alice), { starred: true })));
await t('unstar a to-do', () => assertSucceeds(updateDoc(p(alice), { starred: false })));
await t('starred as text rejected', () => assertFails(updateDoc(p(alice), { starred: 'yes' })));
await t('other user cannot star', () => assertFails(updateDoc(p(bob), { starred: true })));
await t('set a due date', () => assertSucceeds(updateDoc(p(alice), { due: '2026-11-20' })));
await t('clear a due date', () => assertSucceeds(updateDoc(p(alice), { due: null })));
await t('create with due date', () => assertSucceeds(setDoc(p(alice, 'dev', 'due1'), { ...good(), due: '2026-12-01' })));
await t('due date in wrong format rejected', () => assertFails(updateDoc(p(alice), { due: 'next tuesday' })));
await t('due date as number rejected', () => assertFails(updateDoc(p(alice), { due: 20261120 })));
await t('other user cannot set due date', () => assertFails(updateDoc(p(bob), { due: '2026-11-20' })));
await t('other user cannot set doneAt', () => assertFails(updateDoc(p(bob), { done: true, doneAt: Date.now() })));
await t('other user cannot delete', () => assertFails(deleteDoc(p(bob))));
await t('owner can delete', () => assertSucceeds(deleteDoc(p(alice))));
await t('parent user doc not writable', () => assertFails(setDoc(doc(alice, 'users', 'alice'), { a: 1 })));
await t('other collections denied', () => assertFails(setDoc(doc(alice, 'other', 'x'), { a: 1 })));

// ---- Issue reports from the stage banner (Issue #28) ----
// Made-up addresses only (this repo is public).
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'access', 'testers'), { emails: ['tester@example.com'] }));
const tester = env.authenticatedContext('tess', { email: 'tester@example.com', email_verified: true }).firestore();
const testerCaps = env.authenticatedContext('tess2', { email: 'Tester@Example.com', email_verified: true }).firestore();
const unverified = env.authenticatedContext('tess3', { email: 'tester@example.com', email_verified: false }).firestore();
const stranger = env.authenticatedContext('sam', { email: 'stranger@example.com', email_verified: true }).firestore();
const report = (uid = 'tess', email = 'tester@example.com') => ({
  title: 'Done list does not scroll', body: 'On iPhone the Done list stops at 5 items.', type: 'bug',
  stage: 'dev', uid, email, status: 'new', createdAt: serverTimestamp(),
});
const r = (db, id) => doc(db, 'issueReports', id);
await t('tester can send a report', () => assertSucceeds(setDoc(r(tester, 'r1'), report())));
await t('tester can send a report with no type', () => assertSucceeds(setDoc(r(tester, 'r2'), { ...report(), type: null })));
await t('tester email matched ignoring capitals', () => assertSucceeds(setDoc(r(testerCaps, 'r3'), report('tess2', 'Tester@Example.com'))));
await t('signed-out cannot report', () => assertFails(setDoc(r(anon, 'r4'), report())));
await t('non-tester cannot report', () => assertFails(setDoc(r(stranger, 'r5'), report('sam', 'stranger@example.com'))));
await t('unverified email cannot report', () => assertFails(setDoc(r(unverified, 'r6'), report('tess3'))));
await t('report as someone else rejected', () => assertFails(setDoc(r(tester, 'r7'), report('other'))));
await t('report with another email rejected', () => assertFails(setDoc(r(tester, 'r8'), report('tess', 'boss@example.com'))));
await t('report without title rejected', () => assertFails(setDoc(r(tester, 'r9'), { ...report(), title: '' })));
await t('report without description rejected', () => assertFails(setDoc(r(tester, 'r10'), { ...report(), body: '' })));
await t('report title > 120 rejected', () => assertFails(setDoc(r(tester, 'r11'), { ...report(), title: 'a'.repeat(121) })));
await t('report body > 5000 rejected', () => assertFails(setDoc(r(tester, 'r12'), { ...report(), body: 'a'.repeat(5001) })));
await t('unknown report type rejected', () => assertFails(setDoc(r(tester, 'r13'), { ...report(), type: 'urgent' })));
await t('report from unknown stage rejected', () => assertFails(setDoc(r(tester, 'r14'), { ...report(), stage: 'prod' })));
await t('report already marked done rejected', () => assertFails(setDoc(r(tester, 'r15'), { ...report(), status: 'logged' })));
await t('report with extra field rejected', () => assertFails(setDoc(r(tester, 'r16'), { ...report(), issue: 99 })));
await t('report with own createdAt rejected', () => assertFails(setDoc(r(tester, 'r17'), { ...report(), createdAt: Timestamp.fromMillis(0) })));
await t('report with a screenshot', () => assertSucceeds(setDoc(r(tester, 'r20'), { ...report(), screenshot: 'data:image/jpeg;base64,' + 'A'.repeat(600000) })));
await t('screenshot too big rejected', () => assertFails(setDoc(r(tester, 'r21'), { ...report(), screenshot: 'data:image/jpeg;base64,' + 'A'.repeat(760000) })));
await t('screenshot not a JPEG rejected', () => assertFails(setDoc(r(tester, 'r22'), { ...report(), screenshot: 'data:image/svg+xml;base64,AAAA' })));
await t('screenshot with junk rejected', () => assertFails(setDoc(r(tester, 'r23'), { ...report(), screenshot: 'data:image/jpeg;base64,<script>' })));
await t('screenshot must be text', () => assertFails(setDoc(r(tester, 'r24'), { ...report(), screenshot: 42 })));
await t('tester cannot read reports back', () => assertFails(getDoc(r(tester, 'r1'))));
await t('tester cannot edit a report', () => assertFails(updateDoc(r(tester, 'r1'), { title: 'changed' })));
await t('tester cannot delete a report', () => assertFails(deleteDoc(r(tester, 'r1'))));
await t('testers list not readable', () => assertFails(getDoc(doc(tester, 'access', 'testers'))));
await t('testers list not writable', () => assertFails(setDoc(doc(stranger, 'access', 'testers'), { emails: ['stranger@example.com'] })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
