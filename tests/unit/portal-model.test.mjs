import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysLate,
  leaderboardRows,
  monthLabel,
  normalizeContribution,
  normalizeTask,
  pointsByMember,
  taskPoints,
  fiscalYearOf,
  fiscalLabel,
  officerRole,
  MAX_SESSIONS,
  answerMatch,
  attendanceRanking,
  copiedAnswers,
  defaultSessions,
  duplicateClaims,
  eventDays,
  normalizeClaim,
  portalAccess,
  prepareSessions,
  rosterCheck,
  sessionState,
  sessionWindow,
  normalizeNewMember,
} from '../../js/lib/portal-model.js';
import { normalizeMembershipID } from '../../js/lib/content-model.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const hours = (n) => new Date(NOW.getTime() + n * 3600000);

test('normalizeClaim cleans values and explains what is missing', () => {
  assert.deepEqual(normalizeClaim({ name: '  Ayesha   Rahman ', memID: ' ab-123 ', rosterYear: '2026' }), {
    name: 'Ayesha Rahman',
    memID: 'AB-123',
    rosterYear: '2026',
  });
  assert.throws(() => normalizeClaim({ name: '', memID: 'X1', rosterYear: '2026' }), /name/);
  assert.throws(() => normalizeClaim({ name: 'A', memID: '', rosterYear: '2026' }), /membership ID/);
  assert.throws(() => normalizeClaim({ name: 'A', memID: 'X1', rosterYear: '1999' }), /year/);
});

test('rosterCheck compares a claim with the roster', () => {
  const roster = [{ key: 'a', name: 'Ayesha Rahman' }];
  const claim = { name: 'ayesha  rahman', memID: 'x1' };
  assert.equal(rosterCheck(claim, roster, { a: 'X1' }).state, 'match');
  assert.deepEqual(rosterCheck({ ...claim, name: 'Someone Else' }, roster, { a: 'X1' }), { state: 'name', name: 'Ayesha Rahman' });
  assert.equal(rosterCheck(claim, roster, { a: 'Z9' }).state, 'missing');
  assert.equal(rosterCheck(claim, roster, null).state, 'unknown');
});

test('duplicateClaims finds IDs claimed twice and ignores removed profiles', () => {
  const dupes = duplicateClaims([
    { memID: 'x1', status: 'active' },
    { memID: 'X1', status: 'pending' },
    { memID: 'y2', status: 'active' },
    { memID: 'y2', status: 'removed' },
  ]);
  assert.deepEqual([...dupes], ['X1']);
});

test('eventDays lists every day of a multi-day event', () => {
  assert.deepEqual(eventDays({ date: '2026-03-01', endsAt: '2026-03-03' }), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.deepEqual(eventDays({ date: '2026-03-01' }), ['2026-03-01']);
});

test('defaultSessions makes one session per day with stable IDs', () => {
  const rows = defaultSessions({ date: '2026-03-01', endsAt: '2026-03-02' });
  assert.deepEqual(
    rows.map((r) => [r.id, r.date, r.time, r.question]),
    [
      ['d1', '2026-03-01', '10:00', ''],
      ['d2', '2026-03-02', '10:00', ''],
    ],
  );
  assert.match(rows[0].label, /^Day 1/);
  assert.doesNotMatch(defaultSessions({ date: '2026-03-01' })[0].label, /Day/);
});

test('sessionWindow uses Bangladesh time and a two-hour window', () => {
  const { opensAt, closesAt } = sessionWindow('2026-03-01', '10:00');
  assert.equal(opensAt.toISOString(), '2026-03-01T04:00:00.000Z');
  assert.equal(closesAt.toISOString(), '2026-03-01T06:00:00.000Z');
  assert.throws(() => sessionWindow('2026-03-01', ''), /opening time/);
  assert.throws(() => sessionWindow('nope', '10:00'), /date/);
});

test('prepareSessions validates the rows', () => {
  const row = { id: 'd1', label: 'Day 1', date: '2026-03-01', time: '10:00', question: 'Who spoke first?', answer: ' Dr Rahman ' };
  const [s] = prepareSessions([row]);
  assert.equal(s.answer, 'Dr Rahman');
  assert.equal(s.closesAt - s.opensAt, 2 * 3600000);
  assert.throws(() => prepareSessions([]), /at least one/);
  assert.throws(() => prepareSessions([{ ...row, question: ' ' }]), /question/);
  assert.throws(() => prepareSessions([row, row]), /own ID/);
  assert.throws(() => prepareSessions(Array.from({ length: MAX_SESSIONS + 1 }, (_, i) => ({ ...row, id: `d${i}` }))), /at most/);
});

test('sessionState switches exactly at the window edges', () => {
  const session = { opensAt: hours(0), closesAt: hours(2) };
  assert.equal(sessionState(session, hours(-0.001)), 'upcoming');
  assert.equal(sessionState(session, hours(0)), 'open');
  assert.equal(sessionState(session, hours(1.999)), 'open');
  assert.equal(sessionState(session, hours(2)), 'closed');
});

test('answerMatch compares with the expected answer', () => {
  assert.equal(answerMatch('The Answer!', 'the answer'), 'match');
  assert.equal(answerMatch('I think it is photosynthesis really', 'Photosynthesis'), 'match');
  assert.equal(answerMatch('photosynthesys', 'photosynthesis'), 'close');
  assert.equal(answerMatch('no idea', 'photosynthesis'), 'differs');
  assert.equal(answerMatch('anything', ''), '');
});

test('copiedAnswers flags long answers repeated word for word', () => {
  const long = 'The speaker explained how catalysts lower activation energy.';
  const copied = copiedAnswers([
    { answer: long },
    { answer: long.toUpperCase() },
    { answer: 'Short' },
    { answer: 'Short' },
    { answer: 'Different long answer about enzymes here' },
  ]);
  assert.equal(copied.size, 1);
  assert.equal([...copied.values()][0], 2);
});

test('attendanceRanking counts accepted answers of active members for held sessions', () => {
  const session = (id, date, from) => ({ id, date, opensAt: hours(from), closesAt: hours(from + 2) });
  const records = [
    { eventId: 'e1', title: 'One', sessions: [session('d1', '2026-06-01', -48), session('d2', '2026-06-02', -24)] },
    { eventId: 'e2', title: 'Soon', sessions: [session('d1', '2026-06-20', 100)] },
    { eventId: 'e0', title: 'Last year', sessions: [session('d1', '2025-06-01', -9000)] },
  ];
  const member = (uid, name, status = 'active') => ({ uid, name, memID: uid.toUpperCase(), status, role: 'member', designation: '' });
  const members = [member('a', 'Amina'), member('b', 'Bilal'), member('c', 'Chitra'), member('p', 'Pending', 'pending')];
  const answer = (uid, eventId, sessionId, status) => ({ uid, eventId, sessionId, status });
  const answers = [
    answer('a', 'e1', 'd1', 'accepted'),
    answer('a', 'e1', 'd2', 'accepted'),
    answer('a', 'e2', 'd1', 'accepted'),
    answer('b', 'e1', 'd1', 'accepted'),
    answer('b', 'e1', 'd2', 'pending'),
    answer('c', 'e1', 'd1', 'accepted'),
    answer('c', 'e0', 'd1', 'accepted'),
    answer('p', 'e1', 'd1', 'accepted'),
  ];
  const { total, rows } = attendanceRanking(members, records, answers, { year: '2027', now: NOW });
  assert.equal(total, 2);
  assert.deepEqual(
    rows.map((r) => [r.name, r.attended, r.pending, r.rate, r.rank]),
    [
      ['Amina', 2, 0, 100, 1],
      ['Bilal', 1, 1, 50, 2],
      ['Chitra', 1, 0, 50, 2],
    ],
  );
  const all = attendanceRanking(members, records, answers, { year: '', now: NOW });
  assert.equal(all.total, 3);
});

test('rankings run per fiscal year (June to May) and officers come from designations', () => {
  assert.equal(fiscalYearOf('2026-05-31'), '2026');
  assert.equal(fiscalYearOf('2026-06-01'), '2027');
  assert.equal(fiscalLabel('2027'), '2026–2027');
  assert.equal(officerRole('President'), 'president');
  assert.equal(officerRole('Vice-President'), 'vice-president');
  assert.equal(officerRole('General Secretary'), 'secretary');
  assert.equal(officerRole('Treasurer'), 'treasurer');
  assert.equal(officerRole('Joint Secretary'), 'member');
  assert.equal(portalAccess({ status: 'active', role: 'member', designation: 'Executive Member' }).leaderboard, true);
  assert.equal(portalAccess({ status: 'active', role: 'member', designation: '' }).leaderboard, false);
});

test('normalizeNewMember reads form values or Excel columns', () => {
  const m = normalizeNewMember({ 'Full Name': ' Amina  Rahman ', 'E-mail': 'Amina@Gmail.com', 'Membership ID': ' 3-123 ' }, '2026');
  assert.deepEqual(m, {
    email: 'amina@gmail.com',
    name: 'Amina Rahman',
    memID: normalizeMembershipID('3-123'),
    year: '2026',
    designation: 'Executive Member',
  });
  assert.equal(
    normalizeNewMember({ name: 'A', email: 'a@b.co', memID: '1', year: '2027', designation: 'Joint Secretary' }).designation,
    'Joint Secretary',
  );
  assert.throws(() => normalizeNewMember({ name: 'A', email: 'nope', memID: '1' }), /email/);
  assert.throws(() => normalizeNewMember({ name: 'A', email: 'a@b.co' }), /membership ID/);
});

test('portalAccess follows roles', () => {
  const active = (role) => ({ status: 'active', role });
  assert.deepEqual(portalAccess(null), {
    member: false,
    board: false,
    president: false,
    approveMembers: false,
    addMembers: false,
    reviewAttendance: false,
    rankings: false,
    leaderboard: false,
    tasks: false,
    manageTasks: false,
    contributions: false,
    reviewContributions: false,
    approveContributions: false,
    announce: false,
    award: false,
    deleteAll: false,
  });
  assert.equal(portalAccess(active('member')).approveMembers, false);
  assert.ok(portalAccess(active('secretary')).approveContributions && !portalAccess(active('treasurer')).approveContributions);
  assert.ok(portalAccess(active('president')).award && !portalAccess(active('vice-president')).award);
  assert.equal(portalAccess(active('secretary')).approveMembers, true);
  assert.equal(portalAccess(active('secretary')).president, false);
  assert.equal(portalAccess(active('president')).president, true);
  assert.equal(portalAccess({ status: 'pending', role: 'president' }).board, false);
  assert.ok(portalAccess(active('president')).deleteAll && !portalAccess(active('secretary')).deleteAll);
  // Only the site owner's account counts as board without a portal role; Chapter Editor roles do not.
  const owner = portalAccess(null, true);
  assert.ok(owner.board && owner.president && owner.rankings);
  assert.equal(portalAccess(null, 'outreach').board, false);
});

test('tasks: due time in Bangladesh, late deduction per day, never below zero', () => {
  const task = normalizeTask({ title: ' Poster ', points: '50', penalty: '20', dueDate: '2026-10-10', dueTime: '18:00' });
  assert.equal(task.title, 'Poster');
  assert.equal(task.dueAt.toISOString(), '2026-10-10T12:00:00.000Z');
  assert.equal(normalizeTask({ title: 'x', dueDate: '2026-10-10' }).dueAt.toISOString(), '2026-10-10T17:59:00.000Z');
  assert.throws(() => normalizeTask({ title: 'x' }), /due date/);
  assert.equal(daysLate(task.dueAt, new Date('2026-10-10T11:00:00Z')), 0);
  assert.equal(daysLate(task.dueAt, new Date('2026-10-10T13:00:00Z')), 1);
  assert.equal(taskPoints(task, new Date('2026-10-10T11:00:00Z')), 50);
  assert.equal(taskPoints(task, new Date('2026-10-12T13:00:00Z')), 20);
  assert.equal(taskPoints(task, new Date('2026-10-20T13:00:00Z')), 0);
  assert.throws(() => normalizeContribution({ title: 'Design', date: '2026-01-01', link: 'ftp://x' }), /https/);
  assert.equal(normalizeContribution({ title: 'Design', date: '2026-01-01', tag: 'Nope' }).tag, 'Other');
  assert.equal(monthLabel('2026-10'), 'October 2026');
});

test('points count per fiscal year and lead the leaderboard', () => {
  const work = [
    { uid: 'a', status: 'approved', points: 30, reviewedAt: new Date('2026-07-01T06:00:00Z') },
    { uid: 'a', status: 'submitted', points: 99, reviewedAt: null },
    { uid: 'b', status: 'approved', points: 10, reviewedAt: new Date('2026-05-30T06:00:00Z') },
  ];
  const claims = [
    { uid: 'b', status: 'approved', points: 5, date: '2026-06-02' },
    { uid: 'b', status: 'pending', points: 0, date: '2026-06-02' },
  ];
  const points = pointsByMember(work, claims, '2027');
  assert.deepEqual(
    [...points],
    [
      ['a', 30],
      ['b', 5],
    ],
  );
  assert.equal(pointsByMember(work, claims).get('b'), 15);
  const rows = leaderboardRows(
    [
      { uid: 'b', name: 'B', rate: 100, attended: 4 },
      { uid: 'a', name: 'A', rate: 50, attended: 2 },
      { uid: 'c', name: 'C', rate: 100, attended: 4 },
    ],
    points,
  );
  assert.deepEqual(
    rows.map((r) => [r.uid, r.rank, r.points]),
    [
      ['a', 1, 30],
      ['b', 2, 5],
      ['c', 3, 0],
    ],
  );
});
