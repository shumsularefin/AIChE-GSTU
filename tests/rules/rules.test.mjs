// Firestore security rules, exercised through the real dashboard data layer (js/admin/cloud.js).
// Run with the emulator: npm run test:rules
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { createCloud, ConflictError } from '../../js/admin/cloud.js';
import { createPortalStore } from '../../js/portal/store.js';
import { localParts } from '../../js/lib/portal-model.js';
import { normalizeContent, normalizeEvent } from '../../js/lib/content-model.js';
import { importCertificates, membershipLookupID } from '../../js/lib/certificate-model.js';
import { firestoreREST } from '../../js/lib/firestore-rest.js';
import { normalizeForm, newForm, checkAnswers, responseId, departments } from '../../js/lib/form-model.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run these tests with the Firestore emulator (npm run test:rules).');

const OWNER = 'muhammadshamsularefin01@gmail.com';
let env;
const accounts = {};

const [emulatorHost, emulatorPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
/** A Firestore client signed in with a mock token (or 'owner', which bypasses rules for test setup). */
const apps = [];
function client(name, token) {
  const app = initializeApp({ projectId: 'demo-aiche-rules' }, name);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, emulatorHost, Number(emulatorPort), token ? { mockUserToken: token } : {});
  return db;
}

function account(name, email, { verified = true, provider = 'google.com' } = {}) {
  const uid = `${name}-uid`;
  const db = client(name, { sub: uid, email, email_verified: verified, firebase: { sign_in_provider: provider, identities: {} } });
  const auth = { currentUser: { uid, email, emailVerified: verified }, authStateReady: async () => {} };
  return { uid, email, db, cloud: createCloud({ db, auth }) };
}

const seed = () =>
  normalizeContent(
    {
      events: JSON.parse(readFileSync('data/seed/events.json', 'utf8')),
      team: JSON.parse(readFileSync('data/seed/team.json', 'utf8')),
      membership: JSON.parse(readFileSync('data/seed/membership.json', 'utf8')),
      homepage: { images: ['images/optimized/slide01-1600.webp'] },
    },
    { keepPrivate: true },
  );

const event = (id, extra = {}) =>
  normalizeEvent({ id, title: `Event ${id}`, date: '2026-11-02', category: 'service', description: 'A test event.', ...extra });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-aiche-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  accounts.owner = account('owner', OWNER);
  accounts.delegate = account('delegate', 'delegate@example.com');
  accounts.admin = account('admin', 'admin@example.com');
  accounts.outreach = account('outreach', 'outreach@example.com');
  accounts.other = account('other', 'other-outreach@example.com');
  accounts.stranger = account('stranger', 'stranger@example.com');
  accounts.unverified = account('unverified', OWNER, { verified: false });
  accounts.password = account('password', OWNER, { provider: 'password' });
  accounts.anon = { db: client('anonymous') };

  // The retired single-document layout, as it exists in production before the upgrade.
  const content = seed();
  content.team.committees['2026'].roster = [
    { key: 'ralpha001', name: 'Private Member', tier: 'general', memID: '00123' },
    { key: 'rbeta0002', name: 'Premium Member', tier: 'premium', memID: 'P-77' },
  ];
  {
    const db = client('setup', 'owner');
    const { events, homepage, membership, ...rest } = structuredClone(content);
    for (const c of Object.values(rest.team.committees)) for (const m of c.roster) delete m.memID;
    await setDoc(doc(db, 'siteContent', 'published'), {
      schemaVersion: 2,
      revision: 7,
      payload: JSON.stringify({ ...rest, certificateArchive: ['event-hello'] }),
      events: Object.fromEntries(events.map((e) => [e.id, e])),
      homepage,
      membership,
    });
    await setDoc(doc(db, 'privateRosters', 'members'), {
      years: {
        2026: [
          { name: 'Private Member', tier: 'general', memID: '00123' },
          { name: 'Premium Member', tier: 'premium', memID: 'P-77' },
        ],
      },
    });
    await setDoc(doc(db, 'certificateEvents', 'event-hello'), { id: 'event-hello', title: 'Hello', date: '2026-09-24' });
    // A certificate issued before the split still holds a membership ID in public.
    const legacy = {
      id: 'AICHE-LEGACY0001',
      name: 'Legacy Recipient',
      memID: 'M-500',
      designation: '',
      event: 'Old Workshop',
      eventId: 'old-workshop',
      eventDate: '2025-05-01',
      dateIssued: '2025-05-02',
      type: 'participant',
      status: 'issued',
      achievement: '',
      templateVersion: 1,
    };
    await setDoc(doc(db, 'certificates', legacy.id), { ...legacy, certificate: legacy });
    await setDoc(doc(db, 'certificates', '01025ACSSC001'), { name: 'Older Format', event: 'First Event', dateIssued: '2024-01-01' });
  }
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await env?.cleanup();
});

test('only the permanent owner and granted Google accounts get editor roles', async () => {
  const { owner, outreach, unverified, password, stranger } = accounts;
  assert.equal(await owner.cloud.role(owner.cloud && { emailVerified: true, email: OWNER }), 'super-admin');
  await assertSucceeds(owner.cloud.setEditor('outreach@example.com', 'outreach', true));
  await assertSucceeds(owner.cloud.setEditor('other-outreach@example.com', 'outreach', true));
  await assertSucceeds(owner.cloud.setEditor('admin@example.com', 'administrator', true));
  await assertSucceeds(owner.cloud.setEditor('delegate@example.com', 'super-admin', true));
  await assertFails(outreach.cloud.setEditor('stranger@example.com', 'administrator', true));
  await assertFails(unverified.cloud.setEditor('stranger@example.com', 'outreach', true));
  await assertFails(password.cloud.setEditor('stranger@example.com', 'outreach', true));
  await assertFails(
    accounts.delegate.cloud
      .setEditor(OWNER, 'outreach', false)
      .catch(() => setDoc(doc(accounts.delegate.db, 'chapterEditors', OWNER), { email: OWNER })),
  );
  await assertFails(getDocs(collection(outreach.db, 'chapterEditors')));
  await assertSucceeds(getDoc(doc(outreach.db, 'chapterEditors', 'outreach@example.com')));
  await assertFails(getDoc(doc(stranger.db, 'chapterEditors', 'outreach@example.com')));
  assert.equal((await accounts.delegate.cloud.editors()).length, 4);
});

test('the super-admin upgrades the retired layout without losing private roster IDs', async () => {
  const loaded = await accounts.owner.cloud.load('super-admin');
  assert.equal(loaded.layout, 'legacy');
  assert.deepEqual(
    loaded.legacy.content.team.committees['2026'].roster.map((m) => m.memID),
    ['00123', 'P-77'],
  );
  await assertFails(accounts.admin.cloud.migrate(loaded.legacy));
  await assertSucceeds(accounts.owner.cloud.migrate(loaded.legacy));

  const after = await accounts.owner.cloud.load('super-admin');
  assert.equal(after.layout, 'split');
  assert.equal(after.events.length, loaded.legacy.content.events.length);
  assert.deepEqual(
    after.team['2026'].value.roster.map((m) => m.memID),
    ['00123', 'P-77'],
  );

  // Public visitors see names and tiers only.
  const publicTeam = (await assertSucceeds(getDoc(doc(accounts.anon.db, 'team', '2026')))).data();
  assert.ok(!JSON.stringify(publicTeam).includes('00123'));
  await assertFails(getDoc(doc(accounts.anon.db, 'rosterPrivate', '2026')));
  await assertFails(getDoc(doc(accounts.outreach.db, 'rosterPrivate', '2026')));
  // The temporary "Hello" entry stays hidden from the Certificate Center.
  assert.equal((await getDoc(doc(accounts.anon.db, 'certificateEvents', 'event-hello'))).data().archived, true);
  await assertSucceeds(getDoc(doc(accounts.anon.db, 'site', 'meta')));
});

test('events: editors add events, outreach edits only their own, the super-admin deletes', async () => {
  const { owner, outreach, other, admin, anon } = accounts;
  await assertSucceeds(outreach.cloud.saveEvent(event('outreach-talk'), 0));
  await assertSucceeds(outreach.cloud.saveEvent(event('outreach-talk', { title: 'Updated talk' }), 1));
  await assertFails(other.cloud.saveEvent(event('outreach-talk', { title: 'Hijacked' }), 2));
  await assertSucceeds(admin.cloud.saveEvent(event('outreach-talk', { title: 'Edited by administrator' }), 2));
  await assert.rejects(outreach.cloud.saveEvent(event('outreach-talk'), 1), ConflictError);
  await assertFails(outreach.cloud.deleteEvent(event('outreach-talk')));
  await assertFails(setDoc(doc(anon.db, 'events', 'spam'), { ...event('spam'), createdBy: 'x', revision: 1 }));
  await assertSucceeds(owner.cloud.deleteEvent(event('outreach-talk')));
  assert.equal((await getDoc(doc(anon.db, 'events', 'outreach-talk'))).exists(), false);
  // A multi-day event without a registration link is valid.
  await assertSucceeds(owner.cloud.saveEvent(event('science-fair', { endDate: '2026-11-04' }), 0));
  const saved = (await getDoc(doc(anon.db, 'events', 'science-fair'))).data();
  assert.equal(saved.endsAt, '2026-11-04');
  assert.equal(saved.registrationUrl, '');
});

test('homepage and membership are open to every editor role; team records only to super-admins', async () => {
  const { owner, outreach, anon, stranger } = accounts;
  const loaded = await outreach.cloud.load('outreach');
  assert.equal(loaded.team['2026'].value.roster[0].memID, undefined, 'outreach never receives membership IDs');
  await assertSucceeds(
    outreach.cloud.savePage(
      'homepage',
      { images: ['images/optimized/slide01-1600.webp', 'images/featured01.jpg'] },
      loaded.homepage.revision,
    ),
  );
  await assertSucceeds(
    outreach.cloud.savePage('membership', { ...loaded.membership.value, intro: 'Updated by outreach.' }, loaded.membership.revision),
  );
  await assertFails(stranger.cloud.savePage('homepage', { images: [] }, loaded.homepage.revision + 1));
  await assertFails(setDoc(doc(anon.db, 'pages', 'homepage'), { images: [] }));
  await assertFails(outreach.cloud.saveTeam('2026', loaded.team['2026'].value, loaded.team['2026'].revision));
  const team = (await owner.cloud.load('super-admin')).team['2026'];
  team.value.roster.push({ key: 'rgamma0003', name: 'New Member', tier: 'general', memID: '00999' });
  await assertSucceeds(owner.cloud.saveTeam('2026', team.value, team.revision));
  assert.equal((await owner.cloud.load('super-admin')).team['2026'].value.roster.at(-1).memID, '00999');
});

test('certificates: issue by role, public verification without membership IDs, revocation', async () => {
  const { owner, outreach, admin, anon } = accounts;
  const base = { event: 'Sustainability Workshop', eventId: 'green-workshop', eventDate: '2026-10-01', dateIssued: '2026-10-02' };
  const participants = importCertificates([{ Name: 'Ayesha Rahman', 'Membership ID': '00777' }, { Name: 'Guest Learner' }], {
    ...base,
    type: 'participant',
  });
  await assertSucceeds(outreach.cloud.issueCertificates(participants));
  // Retrying the same batch is harmless.
  await assertSucceeds(outreach.cloud.issueCertificates(participants));

  const champion = importCertificates([{ Name: 'Winner' }], { ...base, type: 'champion' });
  await assertFails(outreach.cloud.issueCertificates(champion));
  await assertSucceeds(admin.cloud.issueCertificates(champion));
  const executive = importCertificates([{ Name: 'Officer' }], {
    event: 'Executive service · 2025–2026',
    dateIssued: '2026-10-02',
    type: 'executive',
    achievement: 'In recognition of dedicated service',
  });
  await assertFails(admin.cloud.issueCertificates(executive));
  await assertSucceeds(owner.cloud.issueCertificates(executive));

  const record = (await assertSucceeds(getDoc(doc(anon.db, 'certificates', participants[0].id)))).data();
  assert.equal(record.name, 'Ayesha Rahman');
  assert.ok(!('memID' in record), 'public certificate has no membership ID');
  await assertFails(getDoc(doc(anon.db, 'certificatePrivate', participants[0].id)));
  assert.equal((await outreach.cloud.certificate(participants[0].id)).memID, '00777');
  const lookup = await getDoc(doc(anon.db, 'certificateLookup', await membershipLookupID('green-workshop', '00777')));
  assert.deepEqual(lookup.data().ids, [participants[0].id]);
  await assertFails(getDocs(collection(anon.db, 'certificates')));
  await assertFails(getDocs(collection(anon.db, 'certificateLookup')));

  await assertFails(outreach.cloud.revokeCertificate(participants[0].id));
  await assertSucceeds(owner.cloud.revokeCertificate(participants[0].id));
  assert.equal((await getDoc(doc(anon.db, 'certificates', participants[0].id))).data().status, 'revoked');
  await assert.rejects(owner.cloud.issueCertificates(participants.slice(0, 1)), /already exists/);
  await assertFails(deleteDoc(doc(owner.db, 'certificates', participants[1].id)));
  await assertFails(
    owner.cloud.deleteCertificate(participants[1].id).catch(() => deleteDoc(doc(owner.db, 'certificates', participants[1].id))),
  );
  await assertFails(deleteDoc(doc(owner.db, 'certificates', participants[0].id)));
  await assert.rejects(outreach.cloud.deleteCertificate(participants[0].id));
  await assertSucceeds(owner.cloud.deleteCertificate(participants[0].id));
  assert.equal((await getDoc(doc(anon.db, 'certificates', participants[0].id))).exists(), false);

  await assertFails(outreach.cloud.setCertificateEventArchived('green-workshop', true));
  await assertSucceeds(owner.cloud.setCertificateEventArchived('green-workshop', true));
  // Issuing more certificates keeps the archive choice.
  await assertSucceeds(outreach.cloud.issueCertificates(importCertificates([{ Name: 'Late Learner' }], { ...base, type: 'participant' })));
  assert.equal((await getDoc(doc(anon.db, 'certificateEvents', 'green-workshop'))).data().archived, true);
});

test('certificates issued before the split stay private until migrated, then keep working', async () => {
  const { owner, outreach, anon } = accounts;
  await assertFails(getDoc(doc(anon.db, 'certificates', 'AICHE-LEGACY0001')));
  await assertSucceeds(getDoc(doc(outreach.db, 'certificates', 'AICHE-LEGACY0001')));
  await assertSucceeds(getDoc(doc(anon.db, 'certificates', '01025ACSSC001')));
  assert.equal(await owner.cloud.certificatesNeedingMigration(), 1);
  await assertFails(outreach.cloud.migrateCertificates());
  assert.equal(await owner.cloud.migrateCertificates(), 1);
  const record = (await assertSucceeds(getDoc(doc(anon.db, 'certificates', 'AICHE-LEGACY0001')))).data();
  assert.ok(!('memID' in record) && !('certificate' in record));
  assert.equal((await owner.cloud.certificate('AICHE-LEGACY0001')).memID, 'M-500');
  const lookup = await getDoc(doc(anon.db, 'certificateLookup', await membershipLookupID('old-workshop', 'M-500')));
  assert.deepEqual(lookup.data().ids, ['AICHE-LEGACY0001']);
  assert.equal(await owner.cloud.certificatesNeedingMigration(), 0);
});

test('forms: editors publish forms, anyone answers while open, answers stay private', async () => {
  const { owner, admin, outreach, other, anon } = accounts;
  const rest = firestoreREST('demo-aiche-rules', { origin: `http://${process.env.FIRESTORE_EMULATOR_HOST}` });
  const template = newForm('event');
  const form = normalizeForm({
    ...template,
    id: 'workshop-registration',
    title: 'Workshop registration',
    status: 'open',
    payment: { ...template.payment, amount: '100 BDT', accounts: [{ method: 'bkash', number: '01700000000', note: 'Personal' }] },
  });
  await assertSucceeds(outreach.cloud.saveForm(form, 0));
  assert.equal((await rest.get('forms/workshop-registration')).title, 'Workshop registration');

  const person = {
    name: 'Ayesha Rahman',
    email: 'ayesha@example.com',
    phone: '01711111111',
    institution: 'GSTU',
    department: departments[0],
    student_id: '20ACCE001',
    membership: 'General member',
    payment_method: 'bkash',
    payment_sender: '01722222222',
    payment_txn: '8n7a-6b5c4d',
  };
  const paid = checkAnswers(form, person);
  assert.deepEqual(paid.errors, {});
  const paidId = responseId(form, paid.answers);
  assert.equal(paidId, 'txn_8N7A6B5C4D');
  const path = (id) => `forms/workshop-registration/responses/${id}`;
  assert.equal(await rest.create(path(paidId), { answers: paid.answers }, { timeField: 'submittedAt' }), 'created');
  // The same transaction cannot be used twice.
  assert.equal(await rest.create(path(paidId), { answers: paid.answers }, { timeField: 'submittedAt' }), 'exists');
  // A paid answer must use its transaction ID as the document ID.
  await assert.rejects(rest.create(path('r_' + 'a'.repeat(24)), { answers: paid.answers }, { timeField: 'submittedAt' }));
  await assert.rejects(rest.create(path('txn_OTHER12345'), { answers: paid.answers }, { timeField: 'submittedAt' }));
  // Premium members skip the payment.
  const premium = checkAnswers(form, { ...person, membership: 'Premium member', acs_id: 'P-77' });
  assert.deepEqual(premium.errors, {});
  assert.equal(premium.answers.payment_txn, undefined);
  const premiumId = responseId(form, premium.answers);
  assert.match(premiumId, /^r_[a-f0-9]{24}$/);
  assert.equal(await rest.create(path(premiumId), { answers: premium.answers }, { timeField: 'submittedAt' }), 'created');
  // Extra fields and a made-up time are refused.
  await assert.rejects(rest.create(path('r_' + 'b'.repeat(24)), { answers: premium.answers, spam: true }, { timeField: 'submittedAt' }));
  await assert.rejects(rest.create(path('r_' + 'c'.repeat(24)), { answers: premium.answers, submittedAt: 'yesterday' }));

  // Answers are private: the creator, administrators and super-admins read them; nobody else.
  await assertFails(getDocs(collection(anon.db, 'forms', 'workshop-registration', 'responses')));
  await assertFails(other.cloud.formResponses('workshop-registration'));
  assert.equal((await outreach.cloud.formResponses('workshop-registration')).length, 2);
  assert.equal((await admin.cloud.formResponses('workshop-registration')).length, 2);
  await assertSucceeds(outreach.cloud.setResponseVerified('workshop-registration', paidId, true));
  assert.equal((await owner.cloud.formResponses('workshop-registration')).find((r) => r.id === paidId).verified, true);
  await assertFails(updateDoc(doc(admin.db, 'forms', 'workshop-registration', 'responses', paidId), { answers: {} }));
  await assertFails(updateDoc(doc(anon.db, 'forms', 'workshop-registration', 'responses', paidId), { verified: true }));

  // Only the creator and administrators change a form; the time limit and status stop new answers.
  await assertFails(other.cloud.saveForm({ ...form, title: 'Taken over' }, 1));
  await assertSucceeds(admin.cloud.saveForm({ ...form, closesAt: new Date(Date.now() - 60000) }, 1));
  await assert.rejects(
    rest.create(path('r_' + 'd'.repeat(24)), { answers: premium.answers }, { timeField: 'submittedAt' }),
    (e) => e.status === 403,
  );
  await assertSucceeds(admin.cloud.saveForm({ ...form, opensAt: new Date(Date.now() + 3600000) }, 2));
  await assert.rejects(rest.create(path('r_' + 'e'.repeat(24)), { answers: premium.answers }, { timeField: 'submittedAt' }));
  await assertSucceeds(outreach.cloud.saveForm({ ...form, status: 'closed' }, 3));
  await assert.rejects(rest.create(path('r_' + 'f'.repeat(24)), { answers: premium.answers }, { timeField: 'submittedAt' }));
  await assertSucceeds(outreach.cloud.saveForm(form, 4));
  assert.equal(await rest.create(path('r_' + '1'.repeat(24)), { answers: premium.answers }, { timeField: 'submittedAt' }), 'created');

  // Only super-admins delete responses and forms, with a log entry.
  const ids = (await owner.cloud.formResponses('workshop-registration')).map((r) => r.id);
  await assertFails(admin.cloud.deleteFormResponses('workshop-registration', ids));
  await assertFails(deleteDoc(doc(owner.db, 'forms', 'workshop-registration', 'responses', ids[0])));
  await assertSucceeds(owner.cloud.deleteFormResponses('workshop-registration', ids, 'Workshop registration'));
  assert.equal((await owner.cloud.formResponses('workshop-registration')).length, 0);
  await assertFails(outreach.cloud.deleteForm(form));
  await assertSucceeds(owner.cloud.deleteForm(form));
  assert.equal(await rest.get('forms/workshop-registration'), null);
});

test('news: editors hide Facebook posts; everyone reads the list; nothing else is stored', async () => {
  const { outreach, stranger, anon } = accounts;
  await assertSucceeds(outreach.cloud.savePage('news', { hidden: ['1001_2002'] }, 0));
  assert.deepEqual((await getDoc(doc(anon.db, 'pages', 'news'))).data().hidden, ['1001_2002']);
  await assertFails(stranger.cloud.savePage('news', { hidden: [] }, 1));
  await assertFails(outreach.cloud.savePage('news', { hidden: [], text: 'not allowed' }, 1));
  await assertFails(outreach.cloud.savePage('news', { hidden: 'all' }, 1));
  await assertSucceeds(outreach.cloud.savePage('news', { hidden: [] }, 1));
});

test('image cleanup: editors keep the unused-since record; nobody else reads or writes it', async () => {
  const { owner, outreach, stranger, anon } = accounts;
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.deepEqual(await owner.cloud.imageCleanup(), { unusedSince: {}, checkedOn: '' });
  await assertSucceeds(owner.cloud.updateImageCleanup(() => ({ unusedSince: { [id]: '2026-09-01' }, checkedOn: '2026-10-23' })));
  assert.equal(await owner.cloud.updateImageCleanup((s) => s), null, 'unchanged state is not written');
  await assertSucceeds(outreach.cloud.updateImageCleanup((s) => ({ ...s, unusedSince: {} })));
  assert.deepEqual((await outreach.cloud.imageCleanup()).unusedSince, {});
  assert.equal(await stranger.cloud.imageCleanup(), null);
  await assertFails(stranger.cloud.updateImageCleanup(() => ({ unusedSince: {}, checkedOn: 'x' })));
  await assertFails(getDoc(doc(anon.db, 'imageCleanup', 'state')));
  await assertFails(
    setDoc(doc(outreach.db, 'imageCleanup', 'state'), {
      unusedSince: {},
      checkedOn: '',
      updatedAt: serverTimestamp(),
      updatedBy: outreach.uid,
      note: 'x',
    }),
  );
  await assertFails(
    setDoc(doc(outreach.db, 'imageCleanup', 'other'), {
      unusedSince: {},
      checkedOn: '',
      updatedAt: serverTimestamp(),
      updatedBy: outreach.uid,
    }),
  );
  await assertFails(deleteDoc(doc(owner.db, 'imageCleanup', 'state')));
});

test('images, activity log and removals', async () => {
  const { owner, outreach, other, anon, delegate } = accounts;
  const image = 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64');
  const reference = await outreach.cloud.uploadImage(image, 'photo.jpg');
  const id = reference.slice(6);
  await assertSucceeds(getDoc(doc(anon.db, 'siteImages', id)));
  await assertFails(other.cloud.deleteImage(id));
  await assertSucceeds(outreach.cloud.deleteImage(id));

  const page = await owner.cloud.activity();
  assert.ok(page.entries.length > 10);
  assert.ok(page.entries.every((e) => e.createdAt instanceof Date));
  assert.ok(page.entries.some((e) => e.action === 'certificate.issue' && e.actorEmail === 'outreach@example.com'));
  await assertFails(outreach.cloud.activity());
  await assertFails(getDocs(collection(anon.db, 'auditLogs')));
  const logId = page.entries.length && (await getDocs(collection(owner.db, 'auditLogs'))).docs[0].id;
  await assertFails(updateDoc(doc(owner.db, 'auditLogs', logId), { detail: 'rewritten' }));
  await assertFails(deleteDoc(doc(owner.db, 'auditLogs', logId)));
  // Nobody can write a log entry in someone else's name.
  await assertFails(
    setDoc(doc(outreach.db, 'auditLogs', 'forged'), {
      actorUid: owner.uid,
      actorEmail: OWNER,
      action: 'page.update',
      target: 'homepage',
      detail: '',
      createdAt: serverTimestamp(),
    }),
  );

  await assertSucceeds(delegate.cloud.deleteEditor('other-outreach@example.com'));
  await assertFails(delegate.cloud.deleteEditor(OWNER).catch(() => deleteDoc(doc(delegate.db, 'chapterEditors', OWNER))));
  // A deletion must come with its log entry.
  const batch = writeBatch(owner.db);
  batch.delete(doc(owner.db, 'events', 'science-fair'));
  await assertFails(batch.commit());
});

// ------------------------------------------------------------------ Member Portal

const portalAccount = (name, email) => {
  const a = account(name, email);
  return { ...a, portal: createPortalStore({ db: a.db, auth: { currentUser: { uid: a.uid, email }, authStateReady: async () => {} } }) };
};
const claim = (name, memID) => ({ name, memID, rosterYear: '2026' });
const profile = (a, extra = {}) => ({
  uid: a.uid,
  email: a.email,
  name: a.uid,
  memID: a.uid.toUpperCase(),
  rosterYear: '2026',
  designation: '',
  role: 'member',
  status: 'active',
  ...extra,
});

test('portal profiles: members claim, the board approves, only the President names officers', async () => {
  const pres = portalAccount('pres', 'pres@example.com');
  const sec = portalAccount('sec', 'sec@example.com');
  const m1 = portalAccount('m1', 'm1@example.com');
  const m2 = portalAccount('m2', 'm2@example.com');
  Object.assign(accounts, { pres, sec, m1, m2 });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'portalMembers', pres.uid), profile(pres, { role: 'president' }));
    await setDoc(doc(db, 'portalMembers', sec.uid), profile(sec, { role: 'secretary' }));
    await setDoc(doc(db, 'rosterPrivate', '2026'), { ids: { ralpha001: 'M-1' } });
  });

  await assertSucceeds(m1.portal.claim(claim('Member One', 'm-1'), null));
  const mine = await m1.portal.me();
  assert.equal(mine.status, 'pending');
  assert.equal(mine.memID, 'M-1');
  // Not as someone else, not already active, not as President.
  await assertFails(setDoc(doc(m2.db, 'portalMembers', m1.uid), profile(m2)));
  await assertFails(
    setDoc(
      doc(m2.db, 'portalMembers', m2.uid),
      profile(m2, { status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: m2.uid }),
    ),
  );
  await assertFails(
    setDoc(
      doc(m2.db, 'portalMembers', m2.uid),
      profile(m2, { role: 'president', status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: m2.uid }),
    ),
  );
  // A member cannot approve themselves.
  await assertFails(updateDoc(doc(m1.db, 'portalMembers', m1.uid), { status: 'active', updatedAt: serverTimestamp(), updatedBy: m1.uid }));
  await assertFails(m1.portal.reviewMember(m1.uid, { status: 'active' }));
  // A plain member cannot read the roster IDs or the member list; the board can.
  await assertFails(getDoc(doc(m1.db, 'rosterPrivate', '2026')));
  await assertFails(m1.portal.members());
  assert.deepEqual(await sec.portal.rosterIds('2026'), { ralpha001: 'M-1' });
  assert.equal(await m1.portal.rosterIds('2026'), null);
  // One officer approves; officers cannot be made by an officer, but can by the President.
  await assertSucceeds(sec.portal.reviewMember(m1.uid, { status: 'active', designation: 'Executive Member' }));
  await assertFails(sec.portal.reviewMember(m1.uid, { role: 'president' }));
  await assertFails(sec.portal.reviewMember(m1.uid, { role: 'treasurer' }));
  await assertSucceeds(pres.portal.reviewMember(m1.uid, { role: 'treasurer' }));
  await assertFails(sec.portal.reviewMember(m1.uid, { designation: 'Changed by another officer' }));
  // An officer cannot edit their own profile.
  await assertFails(sec.portal.reviewMember(sec.uid, { designation: 'Self-made' }));
  await assertSucceeds(accounts.owner.cloud.portal.reviewMember(pres.uid, { designation: 'President' }));
  await assertSucceeds(pres.portal.reviewMember(m1.uid, { role: 'member' }));
  // A pending claim can be withdrawn.
  await assertSucceeds(m2.portal.claim(claim('Member Two', 'M-2'), null));
  await assertSucceeds(m2.portal.withdrawClaim());
  assert.equal(await m2.portal.me(), null);
});

const open = (extra = {}) => ({
  id: 'd1',
  label: 'Day 1',
  ...localParts(new Date(Date.now() - 60000)),
  question: 'Which topic was covered?',
  answer: 'Catalysis',
  ...extra,
});

test('portal attendance: the board sets up sessions, members answer once inside the window', async () => {
  const { admin, outreach, m1, m2, anon, stranger } = accounts;
  const sec = portalAccount('a-sec', 'a-sec@example.com');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'events', 'portal-talk'), { id: 'portal-talk', title: 'Portal Talk' });
    await setDoc(doc(db, 'portalMembers', m2.uid), profile(m2));
    await setDoc(doc(db, 'portalMembers', sec.uid), profile(sec, { role: 'secretary', designation: 'Secretary' }));
  });
  const talk = { id: 'portal-talk', title: 'Portal Talk' };
  // Chapter Editor roles give no portal powers.
  for (const editor of [admin, outreach])
    await assertFails(createPortalStore({ db: editor.db, auth: { currentUser: { uid: editor.uid } } }).saveAttendance(talk, [open()], []));
  const future = { id: 'd2', label: 'Day 2', date: '2999-01-01', time: '10:00', question: 'Later question?', answer: 'Later' };
  const closed = { id: 'd3', label: 'Day 3', date: '2020-01-01', time: '10:00', question: 'Old question?', answer: 'Old' };

  // Only for events that exist, and only by staff.
  const staff = sec.portal;
  await assertFails(staff.saveAttendance({ id: 'missing-event', title: 'x' }, [open()], []));
  await assertFails(m1.portal.saveAttendance(talk, [open()], []));
  await assertSucceeds(staff.saveAttendance(talk, [open(), future, closed], []));

  // Everyone reads the sessions; the question appears only once its day has opened.
  await assertSucceeds(getDoc(doc(anon.db, 'attendance', 'portal-talk')));
  await assertSucceeds(getDoc(doc(m1.db, 'attendanceQuestions', 'portal-talk__d1')));
  await assertFails(getDoc(doc(m1.db, 'attendanceQuestions', 'portal-talk__d2')));
  await assertFails(getDoc(doc(stranger.db, 'attendanceQuestions', 'portal-talk__d1')));
  await assertSucceeds(getDoc(doc(sec.db, 'attendanceQuestions', 'portal-talk__d2')));
  await assertFails(getDoc(doc(admin.db, 'attendanceQuestions', 'portal-talk__d2')));
  await assertFails(getDoc(doc(m1.db, 'attendanceKeys', 'portal-talk__d1')));
  await assertFails(getDocs(collection(m1.db, 'attendanceQuestions')));
  assert.deepEqual(await staff.expectedAnswers('portal-talk', ['d1']), { d1: 'Catalysis' });

  // One answer per session, only inside the window, and only as yourself while active.
  await assertSucceeds(m1.portal.submitAnswer('portal-talk', 'd1', 'Catalysis'));
  await assertFails(m1.portal.submitAnswer('portal-talk', 'd1', 'Changed my mind'));
  await assertFails(m1.portal.submitAnswer('portal-talk', 'd2', 'Too early'));
  await assertFails(m1.portal.submitAnswer('portal-talk', 'd3', 'Too late'));
  await assertFails(
    createPortalStore({ db: stranger.db, auth: { currentUser: { uid: stranger.uid } } }).submitAnswer('portal-talk', 'd1', 'Not a member'),
  );
  await assertFails(
    setDoc(doc(m2.db, 'attendanceAnswers', 'portal-talk__d1__m2-uid'), {
      uid: 'm2-uid',
      eventId: 'portal-talk',
      sessionId: 'd1',
      answer: 'Pre-accepted',
      submittedAt: serverTimestamp(),
      status: 'accepted',
    }),
  );
  await assertSucceeds(m2.portal.submitAnswer('portal-talk', 'd1', 'Something else'));

  // Members cannot review; staff can. Members list only their own answers.
  const id = 'portal-talk__d1__m1-uid';
  await assertFails(updateDoc(doc(m1.db, 'attendanceAnswers', id), { status: 'accepted' }));
  await assertFails(m1.portal.reviewAnswer(id, 'accepted'));
  await assertSucceeds(staff.reviewAnswer(id, 'accepted'));
  await assertFails(createPortalStore({ db: outreach.db, auth: { currentUser: { uid: outreach.uid } } }).reviewAnswers([id], 'pending'));
  assert.equal((await m1.portal.myAnswers()).length, 1);
  await assertFails(m1.portal.answers());
  await assertFails(getDocs(collection(m1.db, 'attendanceAnswers')));
  assert.equal((await staff.answers('portal-talk')).length, 2);
  await assertFails(deleteDoc(doc(m1.db, 'attendanceAnswers', id)));
  // Only the President (or the site owner) deletes: a session takes its answers with it.
  await assertFails(staff.deleteAnswer(id));
  await assertSucceeds(accounts.owner.cloud.portal.deleteSession('portal-talk', 'd1'));
  assert.equal((await staff.answers('portal-talk')).length, 0);
  assert.deepEqual(
    (await staff.attendanceRecord('portal-talk')).sessions.map((x) => x.id),
    ['d2', 'd3'],
  );
});

test('portal directory: committee emails make executive profiles; officers become admins; the leaderboard is for members', async () => {
  const owner = { ...accounts.owner, portal: portalAccount('owner-portal', OWNER).portal };
  const vp = portalAccount('vp', 'vp@example.com');
  const exec = portalAccount('exec', 'exec@example.com');
  const outsider = portalAccount('outsider', 'outsider@example.com');
  const committee = [
    { name: 'Vice One', role: 'Vice President', memID: 'v-1', email: 'vp@example.com' },
    { name: 'Exec One', role: 'Executive Member', memID: 'e-1', email: 'exec@example.com' },
  ];
  await assertSucceeds(owner.portal.syncDirectory('2027', committee, []));
  await assertFails(setDoc(doc(vp.db, 'portalDirectory', 'vp@example.com'), { email: 'vp@example.com', role: 'president' }));
  await assertFails(getDoc(doc(exec.db, 'portalDirectory', 'vp@example.com')));

  const mine = await vp.portal.me();
  assert.deepEqual([mine.status, mine.role, mine.designation, mine.memID], ['active', 'vice-president', 'Vice President', 'V-1']);
  assert.equal((await exec.portal.me()).role, 'member');
  // A profile cannot claim more than the directory says.
  await assertFails(setDoc(doc(outsider.db, 'portalMembers', outsider.uid), profile(outsider, { status: 'active' })));
  // The Vice President is board: approves claims and reads the directory.
  await assertSucceeds(getDoc(doc(vp.db, 'portalDirectory', 'exec@example.com')));

  await assertSucceeds(vp.portal.publishLeaderboard('2027', '2026–2027', 0, []));
  await assertSucceeds(exec.portal.leaderboards());
  await assertFails(getDocs(collection(outsider.db, 'leaderboard')));

  // Dropped from the committee: the officer role is taken away the next time they sign in.
  await assertSucceeds(owner.portal.syncDirectory('2027', committee.slice(1), committee));
  assert.equal((await vp.portal.me()).role, 'member');

  // The board adds executive members by email; they are active as soon as they sign in.
  const added = portalAccount('added', 'added@example.com');
  const row = { email: 'added@example.com', name: 'Added One', memID: 'A-1', year: '2027', designation: 'Executive Member' };
  await assertFails(exec.portal.addMembers([row]));
  await assertFails(createPortalStore({ db: accounts.admin.db, auth: { currentUser: { uid: accounts.admin.uid } } }).addMembers([row]));
  const sec = portalAccount('d-sec', 'd-sec@example.com');
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'portalMembers', sec.uid), profile(sec, { role: 'secretary', designation: 'Secretary' })),
  );
  assert.equal(await sec.portal.addMembers([row]), 1);
  const fresh = await added.portal.me();
  assert.deepEqual([fresh.status, fresh.role, fresh.designation], ['active', 'member', 'Executive Member']);
  // Only the President makes officers.
  await assertFails(
    setDoc(doc(sec.db, 'portalDirectory', 'boss@example.com'), {
      ...row,
      email: 'boss@example.com',
      role: 'president',
      updatedAt: serverTimestamp(),
      updatedBy: sec.uid,
    }),
  );
  // Correcting a member updates their directory entry too, so it sticks at their next sign-in.
  await assertSucceeds(sec.portal.reviewMember(added.uid, { designation: 'Joint Secretary' }, fresh));
  assert.equal((await added.portal.me()).designation, 'Joint Secretary');
  // The Secretary cannot delete a profile; the site owner (like the President) can.
  await assertFails(sec.portal.deleteMember(fresh));
  await assertSucceeds(owner.portal.deleteMember(fresh));
});

test('portal work: tasks with points, contribution claims, notifications, notices and the monthly award', async () => {
  const pres = portalAccount('w-pres', 'w-pres@example.com');
  const treas = portalAccount('w-treas', 'w-treas@example.com');
  const m1 = portalAccount('w-m1', 'w-m1@example.com');
  const m2 = portalAccount('w-m2', 'w-m2@example.com');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'portalMembers', pres.uid), profile(pres, { role: 'president', designation: 'President' }));
    await setDoc(doc(db, 'portalMembers', treas.uid), profile(treas, { role: 'treasurer', designation: 'Treasurer' }));
    await setDoc(doc(db, 'portalMembers', m1.uid), profile(m1, { designation: 'Executive Member' }));
    await setDoc(doc(db, 'portalMembers', m2.uid), profile(m2));
  });
  const values = { title: 'Design the poster', points: 40, penalty: 10, dueDate: '2030-01-10', open: true };

  // Tasks: the board creates and assigns; members cannot.
  await assertFails(m1.portal.saveTask(values));
  const taskId = await treas.portal.saveTask(values, '', [m1.uid]);
  const task = (await m1.portal.tasks()).find((t) => t.id === taskId);
  assert.equal(task.points, 40);
  assert.equal((await m1.portal.notifications())[0].title, 'New task: Design the poster');
  await assertFails(getDocs(collection(m2.db, 'taskWork')));
  // A volunteer requests it; the board accepts.
  await assertSucceeds(m2.portal.requestTask(taskId));
  const work = await treas.portal.work(taskId);
  await assertSucceeds(
    treas.portal.reviewWork(
      work.find((w) => w.uid === m2.uid),
      task,
      'assigned',
    ),
  );
  // Members hand in their own work only, and cannot give themselves points.
  await assertFails(updateDoc(doc(m2.db, 'taskWork', `${taskId}__${m1.uid}`), { status: 'submitted' }));
  await assertSucceeds(m1.portal.submitWork(taskId, { note: 'Done', link: 'https://example.com/poster' }));
  await assertFails(
    updateDoc(doc(m1.db, 'taskWork', `${taskId}__${m1.uid}`), {
      status: 'approved',
      points: 40,
      updatedAt: serverTimestamp(),
      updatedBy: m1.uid,
    }),
  );
  const mine = (await treas.portal.work(taskId)).find((w) => w.uid === m1.uid);
  await assertSucceeds(treas.portal.reviewWork(mine, task, 'approved', { points: 36 }));
  assert.equal((await m1.portal.myWork())[0].points, 36);

  // The board can remove someone from a task; members cannot.
  await assertFails(m1.portal.deleteWork(`${taskId}__${m2.uid}`));
  await assertSucceeds(pres.portal.deleteWork(`${taskId}__${m2.uid}`));

  // Contributions: closed until the board opens them; only the President or Secretary approves.
  const contribution = { title: 'Ran the photo booth', eventId: 'portal-talk', tag: 'Event organising', date: '2026-03-01' };
  await assertFails(m1.portal.claimContribution(contribution));
  await assertFails(m1.portal.saveSettings({ claims: true }));
  await assertSucceeds(treas.portal.saveSettings({ claims: true }));
  await assertSucceeds(m1.portal.claimContribution(contribution));
  const [claimed] = await treas.portal.contributions();
  await assertFails(treas.portal.reviewContribution(claimed, 'approved', { points: 10 }));
  await assertSucceeds(pres.portal.reviewContribution(claimed, 'approved', { points: 10 }));

  // Notifications are private to their member; only staff send them.
  await assertFails(m2.portal.notify([m1.uid], { title: 'Spoof' }));
  const [first] = await m1.portal.notifications();
  await assertFails(updateDoc(doc(m2.db, 'notifications', first.id), { read: true }));
  await assertSucceeds(m1.portal.markRead([first.id]));

  // Notices: the board posts, members read.
  await assertFails(m1.portal.saveAnnouncement({ title: 'Hi' }));
  await assertSucceeds(treas.portal.saveAnnouncement({ title: 'Meeting on Friday', body: 'Room 204' }, '', 'Treasurer'));
  assert.equal((await m2.portal.announcements())[0].title, 'Meeting on Friday');

  // Executive Member of the Month: President only, one certificate per month.
  await assertFails(treas.portal.giveAward('2026-10', { uid: m1.uid, name: 'w-m1', designation: 'Executive Member' }));
  await assertSucceeds(pres.portal.giveAward('2026-10', { uid: m1.uid, name: 'w-m1', designation: 'Executive Member' }, 'Poster campaign'));
  assert.equal((await getDoc(doc(m2.db, 'certificates', 'EMOTM-2026-10'))).data().type, 'achievement');
  await assert.rejects(pres.portal.giveAward('2026-10', { uid: m2.uid, name: 'w-m2' }), /already has/);
  assert.equal((await m2.portal.awards())[0].name, 'w-m1');
  // The President can withdraw an award with its certificate, and claims too.
  const [award] = await pres.portal.awards();
  await assertFails(treas.portal.deleteAward(award));
  await assertSucceeds(pres.portal.deleteAward(award));
  assert.equal((await getDoc(doc(m2.db, 'certificates', 'EMOTM-2026-10'))).exists(), false);
  await assertFails(treas.portal.deleteContribution(claimed.id));
  await assertSucceeds(pres.portal.deleteContribution(claimed.id));
});

test('instant attendance: officers open a session now; without a question it counts at once', async () => {
  const pres = portalAccount('i-pres', 'i-pres@example.com');
  const m = portalAccount('i-m', 'i-m@example.com');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'events', 'quick-talk'), { id: 'quick-talk', title: 'Quick Talk' });
    await setDoc(doc(db, 'portalMembers', pres.uid), profile(pres, { role: 'president' }));
    await setDoc(doc(db, 'portalMembers', m.uid), profile(m));
  });
  const talk = { id: 'quick-talk', title: 'Quick Talk' };
  await assertFails(m.portal.openSession(talk, { label: 'Day 1', minutes: 30 }));
  await assertSucceeds(pres.portal.openSession(talk, { label: 'Day 1', minutes: 30 }));
  await assertSucceeds(pres.portal.openSession(talk, { label: 'Day 2', minutes: 30, question: 'Colour?', answer: 'Blue' }));
  const [plain, asked] = (await m.portal.attendanceRecord('quick-talk')).sessions;
  await assertSucceeds(m.portal.submitAnswer('quick-talk', plain.id, '', { noQuestion: true }));
  // A session with a question cannot be counted without review, and nobody marks twice.
  await assertFails(m.portal.submitAnswer('quick-talk', asked.id, 'Blue', { noQuestion: true }));
  await assertSucceeds(m.portal.submitAnswer('quick-talk', asked.id, 'Blue'));
  await assertFails(m.portal.submitAnswer('quick-talk', plain.id, '', { noQuestion: true }));
  // Closed sessions refuse answers.
  await assertSucceeds(pres.portal.closeSession('quick-talk', plain.id));
  assert.equal((await m.portal.myAnswers()).find((a) => a.sessionId === plain.id).status, 'accepted');
});
