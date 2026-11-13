// Member Portal data layer: member profiles, attendance sessions, answers and reviews (see firestore.rules).
// Used by the portal page and, to keep the executive committee in step, by the Chapter Editor's Team page.
import { GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import {
  doc,
  collection,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  serverTimestamp,
  Timestamp,
  getCountFromServer,
  runTransaction,
} from 'firebase/firestore';
import {
  normalizeClaim,
  prepareSessions,
  answerId,
  sessionKey,
  officerRole,
  normalizeTask,
  normalizeContribution,
  monthLabel,
} from '../lib/portal-model.js';
import { normalizeMembershipID, todayInBangladesh } from '../lib/content-model.js';

const toDate = (v) => v?.toDate?.() ?? v ?? null;
const dated = (data, keys) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, keys.includes(k) ? toDate(v) : v]));
const sessionFromDoc = (s) => ({ ...s, opensAt: toDate(s.opensAt), closesAt: toDate(s.closesAt) });
const recordFromDoc = (d) => ({ ...d, sessions: (d.sessions || []).map(sessionFromDoc) });
const memberFromDoc = (d) => dated(d, ['createdAt', 'updatedAt', 'reviewedAt']);
const answerFromDoc = (snap) => ({ id: snap.id, ...dated(snap.data(), ['submittedAt', 'reviewedAt']) });
const withId = (snap, keys = []) => ({ id: snap.id, ...dated(snap.data(), ['createdAt', 'updatedAt', ...keys]) });
const byNewest = (key) => (a, b) => (b[key] || 0) - (a[key] || 0);

export function createPortalStore({ db, auth }) {
  const uid = () => auth.currentUser.uid;
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: uid() });
  const memberRef = (id) => doc(db, 'portalMembers', id);
  const directoryRef = (email) => doc(db, 'portalDirectory', String(email).toLowerCase());
  const deleteAll = async (refs) => {
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(db);
      for (const ref of refs.slice(i, i + 450)) batch.delete(ref);
      await batch.commit();
    }
  };

  return {
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return (await signInWithPopup(auth, provider)).user;
    },
    async currentUser() {
      await auth.authStateReady();
      return auth.currentUser;
    },
    signOut: () => firebaseSignOut(auth),

    // ---------------------------------------------------------------- members

    /**
     * The signed-in member's profile, or null before they claim one. Executive committee members listed in
     * the portal directory get (and keep in step) an active profile automatically.
     */
    async me() {
      const email = auth.currentUser.email.toLowerCase();
      const [snap, entry] = await Promise.all([
        getDocFromServer(memberRef(uid())),
        getDocFromServer(doc(db, 'portalDirectory', email)).catch(() => null),
      ]);
      const profile = snap.exists() ? snap.data() : null;
      if (entry?.exists() && profile?.status !== 'removed') {
        const d = entry.data();
        const fromDirectory = {
          name: d.name,
          memID: d.memID,
          rosterYear: d.year,
          designation: d.designation,
          role: d.role,
          status: 'active',
        };
        const changed = !profile || Object.keys(fromDirectory).some((k) => profile[k] !== fromDirectory[k]);
        if (changed) {
          if (profile) await updateDoc(memberRef(uid()), { ...fromDirectory, ...stamp() });
          else await setDoc(memberRef(uid()), { uid: uid(), email, ...fromDirectory, createdAt: serverTimestamp(), ...stamp() });
          const fresh = await getDocFromServer(memberRef(uid()));
          return memberFromDoc(fresh.data());
        }
      }
      return profile ? memberFromDoc(profile) : null;
    },
    /**
     * Super-admin: keeps the portal directory (email -> executive member) in step with a committee year.
     * A newer year's entry is never overwritten by an older year; people dropped from this year are removed.
     */
    async syncDirectory(year, members, previous = []) {
      const batch = writeBatch(db);
      const emails = new Set();
      for (const m of members) {
        const email = String(m.email || '').toLowerCase();
        if (!email || emails.has(email)) continue;
        emails.add(email);
        const ref = doc(db, 'portalDirectory', email);
        const old = await getDocFromServer(ref);
        if (old.exists() && Number(old.data().year) > Number(year)) continue;
        const entry = {
          name: m.name.slice(0, 160),
          memID: normalizeMembershipID(m.memID).slice(0, 40),
          designation: m.role.slice(0, 120),
          role: officerRole(m.role),
        };
        // Profiles follow the directory the next time the member signs in.
        batch.set(ref, { email, ...entry, year, ...stamp() });
      }
      for (const p of previous) {
        if (!p.email || emails.has(p.email)) continue;
        const ref = doc(db, 'portalDirectory', p.email);
        const old = await getDocFromServer(ref);
        if (!old.exists() || old.data().year !== year) continue;
        // Dropped from the committee: still a member, but no longer an officer or executive.
        batch.set(ref, { ...old.data(), designation: '', role: 'member', ...stamp() });
      }
      await batch.commit();
    },
    /** Creates the member's claim, or corrects it while it waits for approval. */
    async claim(values, existing) {
      const claim = normalizeClaim(values);
      if (existing) return updateDoc(memberRef(uid()), { ...claim, ...stamp() });
      return setDoc(memberRef(uid()), {
        uid: uid(),
        email: auth.currentUser.email.toLowerCase(),
        ...claim,
        designation: '',
        role: 'member',
        status: 'pending',
        createdAt: serverTimestamp(),
        ...stamp(),
      });
    },
    withdrawClaim: () => deleteDoc(memberRef(uid())),
    async members() {
      const snap = await getDocsFromServer(collection(db, 'portalMembers'));
      return snap.docs.map((d) => memberFromDoc(d.data()));
    },
    /**
     * Board review: approve, remove, correct details, set designation (and role, for the President). A member
     * added through the directory has their directory entry corrected too, so the change sticks.
     */
    async reviewMember(memberUid, changes, member = null) {
      const allowed = ['name', 'memID', 'rosterYear', 'designation', 'role', 'status'];
      const data = Object.fromEntries(Object.entries(changes).filter(([k]) => allowed.includes(k)));
      await updateDoc(memberRef(memberUid), { ...data, ...stamp(), reviewedBy: uid(), reviewedAt: serverTimestamp() });
      if (!member?.email || !['name', 'memID', 'rosterYear', 'designation', 'role'].some((k) => k in data)) return;
      const entry = await getDocFromServer(directoryRef(member.email)).catch(() => null);
      if (!entry?.exists()) return;
      const e = entry.data();
      await setDoc(directoryRef(member.email), {
        email: e.email,
        name: data.name ?? e.name,
        memID: data.memID ?? e.memID,
        year: data.rosterYear ?? e.year,
        designation: data.designation ?? e.designation,
        role: data.role ?? e.role,
        ...stamp(),
      });
    },
    /** President: deletes a member's profile and directory entry for good. Their past records stay. */
    async deleteMember(member) {
      await deleteDoc(memberRef(member.uid));
      if (member.email) await deleteDoc(directoryRef(member.email)).catch(() => {});
    },
    /** Members added by email (from the Team page or by the board): [{ email, name, memID, year, designation, role }]. */
    async directory() {
      const snap = await getDocsFromServer(collection(db, 'portalDirectory'));
      return snap.docs.map((d) => dated(d.data(), ['updatedAt'])).sort((a, b) => a.name.localeCompare(b.name));
    },
    /**
     * Board: adds members by Google email. Each gets an active executive-member profile the first time they
     * sign in. Existing entries are updated; officers' entries are left to the President.
     */
    async addMembers(rows) {
      const existing = new Map((await this.directory()).map((e) => [e.email, e]));
      let added = 0;
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        for (const r of rows.slice(i, i + 400)) {
          if ((existing.get(r.email)?.role || 'member') !== 'member') continue;
          batch.set(directoryRef(r.email), { ...r, role: 'member', ...stamp() });
          added++;
        }
        await batch.commit();
      }
      return added;
    },
    deleteDirectoryEntry: (email) => deleteDoc(directoryRef(email)),
    /** Public roster of a year: [{ key, name, tier }]. */
    async roster(year) {
      const snap = await getDocFromServer(doc(db, 'team', year));
      return snap.exists() ? snap.data().roster || [] : [];
    },
    /** Membership IDs of a year's roster (board only), or null when they cannot be read. */
    async rosterIds(year) {
      try {
        const snap = await getDocFromServer(doc(db, 'rosterPrivate', year));
        return snap.exists() ? snap.data().ids || {} : {};
      } catch (error) {
        if (error?.code === 'permission-denied') return null;
        throw error;
      }
    },
    async rosterYears() {
      const snap = await getDocsFromServer(collection(db, 'team'));
      return snap.docs
        .filter((d) => /^20\d{2}$/.test(d.id) && (d.data().roster || []).length)
        .map((d) => d.id)
        .sort()
        .reverse();
    },

    // ---------------------------------------------------------------- attendance

    /** Every event's attendance, the most recently opened first. */
    async attendanceRecords() {
      const snap = await getDocsFromServer(collection(db, 'attendance'));
      const latest = (r) => Math.max(0, ...r.sessions.map((s) => s.opensAt?.getTime?.() || 0));
      return snap.docs.map((d) => recordFromDoc(d.data())).sort((a, b) => latest(b) - latest(a));
    },
    async attendanceRecord(eventId) {
      const snap = await getDocFromServer(doc(db, 'attendance', eventId));
      return snap.exists() ? recordFromDoc(snap.data()) : null;
    },
    /** A session's question, once it has opened (members) or any time (staff). */
    async question(eventId, sessionId) {
      const snap = await getDocFromServer(doc(db, 'attendanceQuestions', sessionKey(eventId, sessionId)));
      return snap.exists() ? snap.data().question : '';
    },
    /** The attendance of an event with each session's question and expected answer, for editing. */
    async attendanceSetup(eventId) {
      const record = await this.attendanceRecord(eventId);
      if (!record) return null;
      const sessions = await Promise.all(
        record.sessions.map(async (s) => {
          const [q, k] = await Promise.all([
            getDocFromServer(doc(db, 'attendanceQuestions', sessionKey(eventId, s.id))),
            getDocFromServer(doc(db, 'attendanceKeys', sessionKey(eventId, s.id))),
          ]);
          return { ...s, question: q.exists() ? q.data().question : '', answer: k.exists() ? k.data().answer : '' };
        }),
      );
      return { ...record, sessions };
    },
    /** Saves an event's sessions, questions and expected answers in one batch; removed days are deleted. */
    async saveAttendance(event, rows, previous = []) {
      const sessions = prepareSessions(rows);
      const batch = writeBatch(db);
      const ts = (d) => Timestamp.fromDate(d);
      batch.set(doc(db, 'attendance', event.id), {
        eventId: event.id,
        title: event.title,
        sessions: sessions.map((s) => ({ id: s.id, label: s.label, date: s.date, opensAt: ts(s.opensAt), closesAt: ts(s.closesAt) })),
        ...stamp(),
      });
      for (const s of sessions) {
        const key = sessionKey(event.id, s.id);
        batch.set(doc(db, 'attendanceQuestions', key), {
          eventId: event.id,
          sessionId: s.id,
          question: s.question,
          opensAt: ts(s.opensAt),
          closesAt: ts(s.closesAt),
          ...stamp(),
        });
        batch.set(doc(db, 'attendanceKeys', key), { answer: s.answer, ...stamp() });
      }
      for (const id of previous.filter((id) => !sessions.some((s) => s.id === id))) {
        batch.delete(doc(db, 'attendanceQuestions', sessionKey(event.id, id)));
        batch.delete(doc(db, 'attendanceKeys', sessionKey(event.id, id)));
      }
      await batch.commit();
      return sessions;
    },
    /** Published events, newest first: [{ id, title, date }]. */
    async events() {
      const snap = await getDocsFromServer(collection(db, 'events'));
      return snap.docs
        .map((d) => ({ id: d.id, title: d.data().title || d.id, date: d.data().date || '' }))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    /** Opens an attendance session now, for `minutes`, with an optional question and expected answer. */
    async openSession(event, { label, minutes, question = '', answer = '' }) {
      const name = String(label || '')
        .trim()
        .slice(0, 80);
      const length = Math.round(Number(minutes));
      if (!name) throw Error('Give the attendance a title, for example Day 1.');
      if (!(length >= 1 && length <= 720)) throw Error('Choose how long attendance stays open.');
      const record = (await this.attendanceRecord(event.id)) || { sessions: [] };
      if (record.sessions.length >= 31) throw Error('This event already has 31 attendance sessions.');
      // A minute's grace, so a phone whose clock runs slightly behind can still answer at once.
      const opensAt = new Date(Date.now() - 60000);
      const closesAt = new Date(Date.now() + length * 60000);
      const id = `s${Date.now().toString(36)}`;
      const ts = (d) => Timestamp.fromDate(d);
      const session = { id, label: name, date: todayInBangladesh(), opensAt: ts(opensAt), closesAt: ts(closesAt) };
      const key = sessionKey(event.id, id);
      const batch = writeBatch(db);
      batch.set(doc(db, 'attendance', event.id), {
        eventId: event.id,
        title: String(event.title).slice(0, 200),
        sessions: [...record.sessions.map((s) => ({ ...s, opensAt: ts(s.opensAt), closesAt: ts(s.closesAt) })), session],
        ...stamp(),
      });
      batch.set(doc(db, 'attendanceQuestions', key), {
        eventId: event.id,
        sessionId: id,
        question: String(question).trim().slice(0, 500),
        opensAt: ts(opensAt),
        closesAt: ts(closesAt),
        ...stamp(),
      });
      batch.set(doc(db, 'attendanceKeys', key), { answer: String(answer).trim().slice(0, 500), ...stamp() });
      await batch.commit();
    },
    /** Closes an open session now (or changes when it closes). */
    async closeSession(eventId, sessionId, closesAt = new Date()) {
      const record = await this.attendanceRecord(eventId);
      const ts = (d) => Timestamp.fromDate(d);
      const batch = writeBatch(db);
      batch.update(doc(db, 'attendance', eventId), {
        sessions: record.sessions.map((s) => ({ ...s, opensAt: ts(s.opensAt), closesAt: ts(s.id === sessionId ? closesAt : s.closesAt) })),
        ...stamp(),
      });
      batch.update(doc(db, 'attendanceQuestions', sessionKey(eventId, sessionId)), { closesAt: ts(closesAt), ...stamp() });
      await batch.commit();
    },
    /** Turns attendance off for an event. Answers already given stay for the rankings. */
    async removeAttendance(eventId, sessionIds) {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'attendance', eventId));
      for (const id of sessionIds) {
        batch.delete(doc(db, 'attendanceQuestions', sessionKey(eventId, id)));
        batch.delete(doc(db, 'attendanceKeys', sessionKey(eventId, id)));
      }
      await batch.commit();
    },
    /** President: deletes one session with its question, expected answer and every answer given. */
    async deleteSession(eventId, sessionId) {
      const record = await this.attendanceRecord(eventId);
      const rest = (record?.sessions || []).filter((s) => s.id !== sessionId);
      const ts = (d) => Timestamp.fromDate(d);
      const answers = (await this.answers(eventId)).filter((a) => a.sessionId === sessionId);
      await deleteAll(answers.map((a) => doc(db, 'attendanceAnswers', a.id)));
      const batch = writeBatch(db);
      if (rest.length)
        batch.update(doc(db, 'attendance', eventId), {
          sessions: rest.map((s) => ({ ...s, opensAt: ts(s.opensAt), closesAt: ts(s.closesAt) })),
          ...stamp(),
        });
      else batch.delete(doc(db, 'attendance', eventId));
      batch.delete(doc(db, 'attendanceQuestions', sessionKey(eventId, sessionId)));
      batch.delete(doc(db, 'attendanceKeys', sessionKey(eventId, sessionId)));
      await batch.commit();
    },
    deleteAnswer: (id) => deleteDoc(doc(db, 'attendanceAnswers', id)),
    async expectedAnswers(eventId, sessionIds) {
      const entries = await Promise.all(
        sessionIds.map(async (id) => {
          const snap = await getDocFromServer(doc(db, 'attendanceKeys', sessionKey(eventId, id)));
          return [id, snap.exists() ? snap.data().answer : ''];
        }),
      );
      return Object.fromEntries(entries);
    },
    /** Without a question, attendance counts at once; an answer to a question waits for review. */
    submitAnswer(eventId, sessionId, answer, { noQuestion = false } = {}) {
      const text = String(answer || '')
        .trim()
        .slice(0, 500);
      return setDoc(doc(db, 'attendanceAnswers', answerId(eventId, sessionId, uid())), {
        uid: uid(),
        eventId,
        sessionId,
        answer: text,
        submittedAt: serverTimestamp(),
        status: noQuestion ? 'accepted' : 'pending',
      });
    },
    async myAnswers() {
      const snap = await getDocsFromServer(query(collection(db, 'attendanceAnswers'), where('uid', '==', uid())));
      return snap.docs.map(answerFromDoc);
    },
    /** Every answer for one event, or all answers (rankings). Staff only. */
    async answers(eventId = '') {
      const ref = collection(db, 'attendanceAnswers');
      const snap = await getDocsFromServer(eventId ? query(ref, where('eventId', '==', eventId)) : ref);
      return snap.docs.map(answerFromDoc);
    },
    reviewAnswer(id, status, note = '') {
      return updateDoc(doc(db, 'attendanceAnswers', id), {
        status,
        note: String(note).slice(0, 300),
        reviewedBy: uid(),
        reviewedAt: serverTimestamp(),
      });
    },
    /** Leaderboards, one per fiscal year: { year, label, total, rows: [{ uid, rank, name, designation, attended, total, rate }] }. */
    async leaderboards() {
      const snap = await getDocsFromServer(collection(db, 'leaderboard'));
      return snap.docs.map((d) => dated(d.data(), ['updatedAt'])).sort((a, b) => b.year.localeCompare(a.year));
    },
    publishLeaderboard(year, label, total, rows) {
      return setDoc(doc(db, 'leaderboard', year), {
        year,
        label,
        total,
        rows: rows
          .slice(0, 1000)
          .map(({ uid, rank, name, designation, attended, rate }) => ({ uid, rank, name, designation, attended, rate })),
        ...stamp(),
      });
    },
    /** Reviews many answers at once (at most 500 per batch). */
    async reviewAnswers(ids, status) {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 450))
          batch.update(doc(db, 'attendanceAnswers', id), { status, note: '', reviewedBy: uid(), reviewedAt: serverTimestamp() });
        await batch.commit();
      }
    },
    // ---------------------------------------------------------------- counts, settings, notifications

    /** Number of documents in a collection matching field == value (or all). */
    async count(name, field = '', value = '') {
      const ref = collection(db, name);
      return (await getCountFromServer(field ? query(ref, where(field, '==', value)) : ref)).data().count;
    },
    async settings() {
      const snap = await getDocFromServer(doc(db, 'portalSettings', 'main')).catch(() => null);
      return { claims: false, ...(snap?.exists() ? snap.data() : {}) };
    },
    saveSettings: (values) => setDoc(doc(db, 'portalSettings', 'main'), { claims: !!values.claims, ...stamp() }),
    async notifications() {
      const snap = await getDocsFromServer(query(collection(db, 'notifications'), where('uid', '==', uid())));
      return snap.docs.map((d) => withId(d)).sort(byNewest('createdAt'));
    },
    unreadCount: async () =>
      (await getCountFromServer(query(collection(db, 'notifications'), where('uid', '==', uid()), where('read', '==', false)))).data()
        .count,
    /** Sends an in-portal notification to each member (uids). Adds to a batch when given one. */
    async notify(uids, { title, body = '', link = '' }, batch = null) {
      const writer = batch || writeBatch(db);
      for (const to of [...new Set(uids)].filter(Boolean))
        writer.set(doc(collection(db, 'notifications')), {
          uid: to,
          title: String(title).slice(0, 160),
          body: String(body).slice(0, 500),
          link: String(link).slice(0, 200),
          read: false,
          createdAt: serverTimestamp(),
          createdBy: uid(),
        });
      if (!batch) await writer.commit();
    },
    async markRead(ids) {
      const batch = writeBatch(db);
      for (const id of ids) batch.update(doc(db, 'notifications', id), { read: true });
      await batch.commit();
    },
    deleteNotification: (id) => deleteDoc(doc(db, 'notifications', id)),

    // ---------------------------------------------------------------- announcements

    async announcements() {
      const snap = await getDocsFromServer(collection(db, 'announcements'));
      return snap.docs.map((d) => withId(d)).sort((a, b) => b.pinned - a.pinned || (b.createdAt || 0) - (a.createdAt || 0));
    },
    saveAnnouncement(values, id = '', author = '') {
      const data = {
        title: String(values.title || '')
          .trim()
          .slice(0, 160),
        body: String(values.body || '')
          .trim()
          .slice(0, 3000),
        pinned: values.pinned === true || values.pinned === 'on',
        ...stamp(),
      };
      if (!data.title) throw Error('Give the notice a title.');
      if (id) return updateDoc(doc(db, 'announcements', id), data);
      return setDoc(doc(collection(db, 'announcements')), {
        ...data,
        author: author.slice(0, 160),
        createdAt: serverTimestamp(),
        createdBy: uid(),
      });
    },
    deleteAnnouncement: (id) => deleteDoc(doc(db, 'announcements', id)),

    // ---------------------------------------------------------------- tasks

    async tasks() {
      const snap = await getDocsFromServer(collection(db, 'portalTasks'));
      return snap.docs.map((d) => withId(d, ['dueAt'])).sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
    },
    /** Creates or edits a task; on creation, assigns it to the given members (and notifies them). Returns the ID. */
    async saveTask(values, id = '', assignees = []) {
      const task = normalizeTask(values);
      const data = { ...task, dueAt: Timestamp.fromDate(task.dueAt), ...stamp() };
      if (id) {
        await updateDoc(doc(db, 'portalTasks', id), data);
        return id;
      }
      const ref = doc(collection(db, 'portalTasks'));
      const batch = writeBatch(db);
      batch.set(ref, { ...data, status: 'open', createdAt: serverTimestamp(), createdBy: uid() });
      await batch.commit();
      if (assignees.length) await this.assign(ref.id, task.title, assignees);
      return ref.id;
    },
    setTaskStatus: (id, status) => updateDoc(doc(db, 'portalTasks', id), { status, ...stamp() }),
    async deleteTask(id) {
      const work = await this.work(id);
      const batch = writeBatch(db);
      for (const w of work) batch.delete(doc(db, 'taskWork', w.id));
      batch.delete(doc(db, 'portalTasks', id));
      await batch.commit();
    },
    /** Assigns a task to members (new ones only; a requested one becomes assigned). */
    async assign(taskId, title, uids) {
      const batch = writeBatch(db);
      const existing = new Map((await this.work(taskId)).map((w) => [w.uid, w]));
      const fresh = [];
      for (const to of uids) {
        const w = existing.get(to);
        const ref = doc(db, 'taskWork', `${taskId}__${to}`);
        if (!w) batch.set(ref, { taskId, uid: to, status: 'assigned', createdAt: serverTimestamp(), ...stamp() });
        else if (w.status === 'requested') batch.update(ref, { status: 'assigned', ...stamp() });
        else continue;
        fresh.push(to);
      }
      await this.notify(
        fresh,
        { title: `New task: ${title}`, body: 'Open My tasks to see the details and the due date.', link: 'tasks' },
        batch,
      );
      await batch.commit();
    },
    /** Work on one task (board), or all work. */
    async work(taskId = '') {
      const ref = collection(db, 'taskWork');
      const snap = await getDocsFromServer(taskId ? query(ref, where('taskId', '==', taskId)) : ref);
      return snap.docs.map((d) => withId(d, ['submittedAt', 'reviewedAt']));
    },
    async myWork() {
      const snap = await getDocsFromServer(query(collection(db, 'taskWork'), where('uid', '==', uid())));
      return snap.docs.map((d) => withId(d, ['submittedAt', 'reviewedAt']));
    },
    requestTask: (taskId) =>
      setDoc(doc(db, 'taskWork', `${taskId}__${uid()}`), {
        taskId,
        uid: uid(),
        status: 'requested',
        createdAt: serverTimestamp(),
        ...stamp(),
      }),
    deleteWork: (id) => deleteDoc(doc(db, 'taskWork', id)),
    withdrawRequest: (taskId) => deleteDoc(doc(db, 'taskWork', `${taskId}__${uid()}`)),
    submitWork(taskId, values) {
      const note = String(values.note || '')
        .trim()
        .slice(0, 2000);
      const link = String(values.link || '')
        .trim()
        .slice(0, 500);
      if (!note && !link) throw Error('Describe what you did, or add a link to it.');
      if (link && !/^https?:\/\//i.test(link)) throw Error('Links start with https://');
      return updateDoc(doc(db, 'taskWork', `${taskId}__${uid()}`), {
        status: 'submitted',
        note,
        link,
        submittedAt: serverTimestamp(),
        ...stamp(),
      });
    },
    /** Board: approve with points, return for changes, or decline a request (deletes it). Notifies the member. */
    async reviewWork(w, task, status, { points = 0, feedback = '' } = {}) {
      const batch = writeBatch(db);
      const ref = doc(db, 'taskWork', w.id);
      if (status === 'declined') batch.delete(ref);
      else
        batch.update(ref, {
          status,
          points: status === 'approved' ? Math.max(0, Math.min(1000, Math.round(Number(points) || 0))) : 0,
          feedback: String(feedback).slice(0, 500),
          reviewedBy: uid(),
          reviewedAt: serverTimestamp(),
          ...stamp(),
        });
      const message = {
        approved: [
          `Task done: ${task.title}`,
          `You earned ${points} point${Number(points) === 1 ? '' : 's'}.${feedback ? ' ' + feedback : ''}`,
        ],
        returned: [`Task needs changes: ${task.title}`, feedback || 'Open My tasks to see what to change.'],
        assigned: [`Task assigned: ${task.title}`, 'Your request was accepted.'],
        declined: [`Request not accepted: ${task.title}`, feedback],
      }[status];
      await this.notify([w.uid], { title: message[0], body: message[1], link: 'tasks' }, batch);
      await batch.commit();
    },

    // ---------------------------------------------------------------- contributions

    async myContributions() {
      const snap = await getDocsFromServer(query(collection(db, 'contributions'), where('uid', '==', uid())));
      return snap.docs.map((d) => withId(d, ['submittedAt', 'reviewedAt'])).sort(byNewest('submittedAt'));
    },
    async contributions() {
      const snap = await getDocsFromServer(collection(db, 'contributions'));
      return snap.docs.map((d) => withId(d, ['submittedAt', 'reviewedAt'])).sort(byNewest('submittedAt'));
    },
    claimContribution(values) {
      const c = normalizeContribution(values);
      if (c.date > todayInBangladesh()) throw Error('The date cannot be in the future.');
      return setDoc(doc(collection(db, 'contributions')), { ...c, uid: uid(), status: 'pending', submittedAt: serverTimestamp() });
    },
    deleteContribution: (id) => deleteDoc(doc(db, 'contributions', id)),
    async reviewContribution(c, status, { points = 0, note = '' } = {}) {
      const batch = writeBatch(db);
      const n = status === 'approved' ? Math.max(0, Math.min(1000, Math.round(Number(points) || 0))) : 0;
      batch.update(doc(db, 'contributions', c.id), {
        status,
        points: n,
        note: String(note).slice(0, 300),
        reviewedBy: uid(),
        reviewedAt: serverTimestamp(),
      });
      await this.notify(
        [c.uid],
        status === 'approved'
          ? {
              title: `Contribution approved: ${c.title}`,
              body: `${n} point${n === 1 ? '' : 's'} added.${note ? ' ' + note : ''}`,
              link: 'contributions',
            }
          : { title: `Contribution not approved: ${c.title}`, body: note, link: 'contributions' },
        batch,
      );
      await batch.commit();
    },

    // ---------------------------------------------------------------- Executive Member of the Month

    async awards() {
      const snap = await getDocsFromServer(collection(db, 'monthAwards'));
      return snap.docs.map((d) => withId(d)).sort((a, b) => b.month.localeCompare(a.month));
    },
    /** President: withdraws an award and deletes its certificate. */
    async deleteAward(award) {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'monthAwards', award.month));
      batch.delete(doc(db, 'certificates', award.certId));
      await batch.commit();
    },
    /**
     * President: names the Executive Member of the Month and issues their certificate (a verifiable credential
     * in the certificate system), in one transaction with its activity-log entry.
     */
    async giveAward(month, member, reason = '') {
      const certId = `EMOTM-${month}`;
      const label = monthLabel(month);
      const today = todayInBangladesh();
      await runTransaction(db, async (tx) => {
        const [award, cert] = await Promise.all([tx.get(doc(db, 'monthAwards', month)), tx.get(doc(db, 'certificates', certId))]);
        if (award.exists() || cert.exists()) throw Error(`${label} already has an Executive Member of the Month.`);
        const log = doc(collection(db, 'auditLogs'));
        tx.set(log, {
          actorUid: uid(),
          actorEmail: auth.currentUser.email.toLowerCase(),
          action: 'certificate.issue',
          target: certId,
          detail: `Executive Member of the Month, ${label}: ${member.name}`.slice(0, 1000),
          createdAt: serverTimestamp(),
          ids: [certId],
        });
        tx.set(doc(db, 'certificates', certId), {
          id: certId,
          name: member.name,
          designation: member.designation || '',
          event: `Executive Member of the Month, ${label}`,
          eventId: 'member-of-the-month',
          eventDate: today,
          dateIssued: today,
          type: 'achievement',
          status: 'issued',
          achievement: String(reason).trim().slice(0, 220),
          templateVersion: 1,
          createdAt: serverTimestamp(),
          issuedBy: uid(),
          auditId: log.id,
        });
        tx.set(doc(db, 'monthAwards', month), {
          month,
          uid: member.uid,
          name: member.name,
          designation: member.designation || '',
          reason: String(reason).trim().slice(0, 220),
          certId,
          createdAt: serverTimestamp(),
          createdBy: uid(),
        });
        tx.set(doc(collection(db, 'notifications')), {
          uid: member.uid,
          title: `You are the Executive Member of the Month, ${label}!`,
          body: 'Your certificate is ready to download and share.',
          link: `cert:${certId}`,
          read: false,
          createdAt: serverTimestamp(),
          createdBy: uid(),
        });
      });
      return certId;
    },
  };
}
