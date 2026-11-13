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
await t('text cannot change', () => assertFails(updateDoc(p(alice), { text: 'changed' })));
await t('pos cannot change', () => assertFails(updateDoc(p(alice), { pos: 5 })));
await t('done must stay bool', () => assertFails(updateDoc(p(alice), { done: 'yes' })));
await t('delete denied', () => assertFails(deleteDoc(p(alice))));
await t('parent user doc not writable', () => assertFails(setDoc(doc(alice, 'users', 'alice'), { a: 1 })));
await t('other collections denied', () => assertFails(setDoc(doc(alice, 'other', 'x'), { a: 1 })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
