// Member Portal: member roles and profile claims, attendance sessions, answer checks and rankings.
// Pure functions shared by the portal, the website and the tests.
import {
  TIMEZONE,
  TIMEZONE_OFFSET,
  eventFormValues,
  eventEndDate,
  normalizeMembershipID,
  todayInBangladesh,
  validDate,
} from './content-model.js';

// ------------------------------------------------------------------ members

export const portalRoles = {
  member: 'Member',
  president: 'President',
  'vice-president': 'Vice President',
  secretary: 'Secretary',
  treasurer: 'Treasurer',
};
export const BOARD_ROLES = ['president', 'vice-president', 'secretary', 'treasurer'];
export const memberStatus = { pending: 'Waiting for approval', active: 'Active', removed: 'Removed' };

/**
 * What a member can do in the portal. Portal roles are separate from Chapter Editor roles: only `owner`
 * (the site owner's account, so the portal can always be recovered) adds powers beyond the member's own role.
 */
export function portalAccess(member, isOwner = false) {
  const owner = isOwner === true;
  const active = member?.status === 'active';
  const board = owner || (active && BOARD_ROLES.includes(member.role));
  const president = owner || (active && member.role === 'president');
  return {
    member: active,
    board,
    president,
    approveMembers: board,
    addMembers: board,
    reviewAttendance: board,
    rankings: board,
    // Executive members (with a designation) and the board see the leaderboard.
    leaderboard: board || (active && !!member.designation),
    tasks: active,
    manageTasks: board,
    contributions: active,
    reviewContributions: board,
    // Contribution points are given by the President or the Secretary.
    approveContributions: owner || (active && ['president', 'secretary'].includes(member.role)),
    announce: board,
    award: president,
    // The President can delete anything in the portal.
    deleteAll: president,
  };
}

/** Column names accepted when the board adds members from Excel (lower case, without spaces or punctuation). */
const memberColumns = {
  name: ['name', 'fullname', 'membername'],
  email: ['email', 'gmail', 'googleemail', 'emailaddress'],
  memID: ['membershipid', 'memid', 'acsid', 'acsmembershipid', 'id'],
  year: ['year', 'membershipyear', 'rosteryear'],
  designation: ['designation', 'position', 'post', 'role'],
};

/**
 * A member the board adds by Google email: { email, name, memID, year, designation }. Rows may come from a
 * form or an Excel sheet (any of the column names above). Throws a readable message.
 */
export function normalizeNewMember(raw, defaultYear = String(new Date().getFullYear())) {
  const pick = (key) => {
    const names = memberColumns[key];
    const found = Object.entries(raw).find(
      ([k]) =>
        k === key ||
        names.includes(
          String(k)
            .toLowerCase()
            .replace(/[^a-z]/g, ''),
        ),
    );
    return found ? found[1] : '';
  };
  const year = clean(pick('year'), 4) || defaultYear;
  const m = {
    email: clean(pick('email'), 200).toLowerCase(),
    name: clean(pick('name'), 160),
    memID: normalizeMembershipID(pick('memID')).slice(0, 40),
    year,
    designation: clean(pick('designation'), 120) || 'Executive Member',
  };
  if (!m.name) throw Error('Enter the member’s name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) throw Error(`Enter ${m.name}’s Google email address.`);
  if (!m.memID) throw Error(`Enter ${m.name}’s AIChE membership ID.`);
  if (!/^20\d{2}$/.test(m.year)) throw Error(`The membership year for ${m.name} must look like 2026.`);
  return m;
}

/** Portal role from a committee designation: the four main officers are portal admins, everyone else a member. */
export function officerRole(designation) {
  const roles = {
    president: 'president',
    'vice president': 'vice-president',
    secretary: 'secretary',
    'general secretary': 'secretary',
    treasurer: 'treasurer',
  };
  return roles[simplify(designation)] || 'member';
}

const clean = (value, max) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** A member's profile claim from the form. Throws a readable message. */
export function normalizeClaim(raw) {
  const claim = {
    name: clean(raw.name, 160),
    memID: normalizeMembershipID(raw.memID).slice(0, 40),
    rosterYear: clean(raw.rosterYear, 4),
  };
  if (!claim.name) throw Error('Enter your name as it appears on the member roster.');
  if (!claim.memID) throw Error('Enter your AIChE membership ID.');
  if (!/^20\d{2}$/.test(claim.rosterYear)) throw Error('Choose your membership year.');
  return claim;
}

/**
 * How a claim compares with the roster: 'match' (ID found under the same name), 'name' (ID found under
 * another name), 'missing' (ID not on that year's roster) or 'unknown' (no roster IDs to compare).
 * `ids` maps roster key -> membership ID; `roster` is the public [{ key, name }] list.
 */
export function rosterCheck(claim, roster = [], ids = null) {
  if (!ids) return { state: 'unknown', name: '' };
  const key = Object.keys(ids).find((k) => normalizeMembershipID(ids[k]) === normalizeMembershipID(claim.memID));
  if (!key) return { state: 'missing', name: '' };
  const name = roster.find((m) => m.key === key)?.name || '';
  const simple = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return { state: simple(name) === simple(claim.name) ? 'match' : 'name', name };
}

/** Membership IDs claimed by more than one profile. */
export function duplicateClaims(members) {
  const seen = new Map();
  for (const m of members)
    if (m.status !== 'removed') seen.set(normalizeMembershipID(m.memID), (seen.get(normalizeMembershipID(m.memID)) || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
}

// ------------------------------------------------------------------ attendance sessions

export const WINDOW_HOURS = 2;
export const MAX_SESSIONS = 31;
const HOUR = 3600000;

const dayLabel = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Every day of an event, first to last (at most 31). */
export function eventDays(event) {
  const days = [];
  for (let d = event.date, end = eventEndDate(event); d <= end && days.length < MAX_SESSIONS;) {
    days.push(d);
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return days;
}

/** When a session opens and closes, from its Bangladesh date and time. */
export function sessionWindow(date, time) {
  if (!validDate(date) || !/^\d{2}:\d{2}$/.test(time)) throw Error('Choose a date and an opening time for each day.');
  const opensAt = new Date(`${date}T${time}:00${TIMEZONE_OFFSET}`);
  return { opensAt, closesAt: new Date(opensAt.getTime() + WINDOW_HOURS * HOUR) };
}

/** Setup rows for an event without attendance yet: one per day, opening at the event's start time. */
export function defaultSessions(event) {
  const days = eventDays(event);
  const time = eventFormValues(event).startTime || '10:00';
  return days.map((date, i) => ({
    id: `d${i + 1}`,
    label: days.length > 1 ? `Day ${i + 1} · ${dayLabel(date)}` : dayLabel(date),
    date,
    time,
    question: '',
    answer: '',
  }));
}

/** Bangladesh date and time of a moment, for the setup form. */
export function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce((all, p) => ({ ...all, [p.type]: p.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Validated sessions for saving: [{ id, label, date, opensAt, closesAt, question, answer }]. */
export function prepareSessions(rows) {
  if (!rows.length) throw Error('Add at least one attendance day.');
  if (rows.length > MAX_SESSIONS) throw Error(`Attendance can have at most ${MAX_SESSIONS} days.`);
  const ids = new Set();
  return rows.map((row, i) => {
    const id = clean(row.id, 20) || `d${i + 1}`;
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw Error('Each attendance day needs its own ID.');
    ids.add(id);
    const question = clean(row.question, 500);
    if (!question) throw Error(`Add a verification question for ${row.label || `day ${i + 1}`}.`);
    return {
      id,
      label: clean(row.label, 80) || dayLabel(row.date),
      date: row.date,
      ...sessionWindow(row.date, row.time),
      question,
      answer: clean(row.answer, 500),
    };
  });
}

const toDate = (v) => (v instanceof Date ? v : typeof v?.toDate === 'function' ? v.toDate() : v ? new Date(v) : null);

/** 'upcoming', 'open' or 'closed'. */
export function sessionState(session, now = new Date()) {
  const opens = toDate(session.opensAt);
  const closes = toDate(session.closesAt);
  if (!opens || now < opens) return 'upcoming';
  return now < closes ? 'open' : 'closed';
}

/** Sessions open right now across attendance records: [{ eventId, title, session }]. */
export function openSessions(records, now = new Date()) {
  return records.flatMap((r) =>
    (r.sessions || []).filter((s) => sessionState(s, now) === 'open').map((session) => ({ eventId: r.eventId, title: r.title, session })),
  );
}

export const answerId = (eventId, sessionId, uid) => `${eventId}__${sessionId}__${uid}`;
export const sessionKey = (eventId, sessionId) => `${eventId}__${sessionId}`;

// ------------------------------------------------------------------ reviewing answers

/** Lowercase letters and numbers only (any script), single spaces. */
export const simplify = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** 'match', 'close' or 'differs' against the expected answer; '' when there is none. */
export function answerMatch(answer, expected) {
  const a = simplify(answer);
  const e = simplify(expected);
  if (!e) return '';
  if (a === e || ` ${a} `.includes(` ${e} `)) return 'match';
  const longest = Math.max(a.length, e.length);
  return longest && 1 - distance(a, e) / longest >= 0.8 ? 'close' : 'differs';
}

/** Long answers given word for word by several members (likely copied): simplified text -> count. */
export function copiedAnswers(answers, minLength = 25) {
  const counts = new Map();
  for (const a of answers) {
    const s = simplify(a.answer);
    if (s.length >= minLength) counts.set(s, (counts.get(s) || 0) + 1);
  }
  return new Map([...counts].filter(([, n]) => n > 1));
}

// ------------------------------------------------------------------ rankings

/**
 * Rankings run per fiscal year, 1 June to 31 May, named by the year it ends (2027 = June 2026 to May 2027),
 * in step with the annual report year.
 */
export const fiscalYearOf = (date) => {
  const [y, m] = String(date).split('-').map(Number);
  return String(m >= 6 ? y + 1 : y);
};
export const fiscalLabel = (year) => (year ? `${Number(year) - 1}–${year}` : 'All years');
export const currentFiscalYear = (now = new Date()) => fiscalYearOf(todayInBangladesh(now));

/** Sessions that have opened in a fiscal year ('' = all years), oldest first: [{ eventId, title, session }]. */
export function heldSessions(records, { year = '', now = new Date() } = {}) {
  return records
    .flatMap((r) => (r.sessions || []).map((session) => ({ eventId: r.eventId, title: r.title, session })))
    .filter(({ session }) => sessionState(session, now) !== 'upcoming' && (!year || fiscalYearOf(session.date) === String(year)))
    .sort((a, b) => toDate(a.session.opensAt) - toDate(b.session.opensAt));
}

/**
 * Attendance ranking of active members over the sessions held in a year: accepted answers count as
 * attended. Sorted by attendance rate, then attended sessions, then name.
 */
export function attendanceRanking(members, records, answers, options = {}) {
  const held = heldSessions(records, options);
  const keys = new Set(held.map((h) => sessionKey(h.eventId, h.session.id)));
  const total = held.length;
  const rows = members
    .filter((m) => m.status === 'active')
    .map((m) => {
      const mine = answers.filter((a) => a.uid === m.uid && keys.has(sessionKey(a.eventId, a.sessionId)));
      const attended = mine.filter((a) => a.status === 'accepted').length;
      return {
        uid: m.uid,
        name: m.name,
        memID: m.memID,
        designation: m.designation || portalRoles[m.role] || '',
        attended,
        pending: mine.filter((a) => a.status === 'pending').length,
        total,
        rate: total ? Math.round((attended / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.attended - a.attended || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i && r.rate === rows[i - 1].rate && r.attended === rows[i - 1].attended ? rows[i - 1].rank : i + 1));
  return { total, rows };
}

export const thisYear = (now = new Date()) => todayInBangladesh(now).slice(0, 4);

// ------------------------------------------------------------------ tasks, contributions and points

export const DAY = 86400000;
export const workStatus = {
  requested: 'Requested',
  assigned: 'To do',
  submitted: 'Waiting for review',
  returned: 'Needs changes',
  approved: 'Done',
};
export const contributionTags = [
  'Event organising',
  'Design',
  'Content writing',
  'Photography & video',
  'Outreach',
  'Research',
  'Logistics',
  'Teaching',
  'Other',
];

const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/** A task from the board's form: { title, details, points, penalty, dueAt, open }. Throws a readable message. */
export function normalizeTask(raw) {
  const task = {
    title: clean(raw.title, 160),
    details: String(raw.details ?? '')
      .trim()
      .slice(0, 2000),
    points: int(raw.points, 0, 1000),
    penalty: int(raw.penalty, 0, 100),
    eventId: clean(raw.eventId, 100),
    open: raw.open === true || raw.open === 'on',
  };
  if (!task.title) throw Error('Give the task a title.');
  if (!validDate(raw.dueDate)) throw Error('Choose a due date.');
  task.dueAt = new Date(`${raw.dueDate}T${/^\d{2}:\d{2}$/.test(raw.dueTime || '') ? raw.dueTime : '23:59'}:00${TIMEZONE_OFFSET}`);
  return task;
}

/** Whole days a submission came after the due time (0 when on time). */
export function daysLate(dueAt, submittedAt) {
  const late = toDate(submittedAt) - toDate(dueAt);
  return late > 0 ? Math.ceil(late / DAY) : 0;
}

/** Points for finished work: the task's points less `penalty` percent for each day late, never below 0. */
export function taskPoints(task, submittedAt) {
  const late = daysLate(task.dueAt, submittedAt);
  return Math.max(0, Math.round(task.points * (1 - (late * (task.penalty || 0)) / 100)));
}

/** A member's past-contribution claim. Throws a readable message. */
export function normalizeContribution(raw) {
  const c = {
    title: clean(raw.title, 160),
    details: String(raw.details ?? '')
      .trim()
      .slice(0, 2000),
    eventId: clean(raw.eventId, 100),
    tag: contributionTags.includes(raw.tag) ? raw.tag : 'Other',
    date: String(raw.date || ''),
    link: clean(raw.link, 500),
  };
  if (!c.title) throw Error('Say what you did.');
  if (!validDate(c.date)) throw Error('Choose when you did it.');
  if (c.link && !/^https?:\/\//i.test(c.link)) throw Error('Links start with https://');
  return c;
}

/**
 * Points earned per member in a fiscal year ('' = all years): approved task work counts in the year it was
 * approved, approved contributions in the year they were done. Returns uid -> points.
 */
export function pointsByMember(work = [], contributions = [], year = '') {
  const points = new Map();
  const add = (uid, n, date) => {
    if (!year || fiscalYearOf(date) === String(year)) points.set(uid, (points.get(uid) || 0) + (Number(n) || 0));
  };
  for (const w of work) if (w.status === 'approved' && w.reviewedAt) add(w.uid, w.points, localParts(toDate(w.reviewedAt)).date);
  for (const c of contributions) if (c.status === 'approved') add(c.uid, c.points, c.date);
  return points;
}

/** Leaderboard order: points, then attendance rate, then attended sessions, then name. */
export function leaderboardRows(rows, points) {
  const out = rows
    .map((r) => ({ ...r, points: points.get(r.uid) || 0 }))
    .sort((a, b) => b.points - a.points || b.rate - a.rate || b.attended - a.attended || a.name.localeCompare(b.name));
  const same = (a, b) => a.points === b.points && a.rate === b.rate && a.attended === b.attended;
  out.forEach((r, i) => (r.rank = i && same(r, out[i - 1]) ? out[i - 1].rank : i + 1));
  return out;
}

/** 'YYYY-MM' of a moment in Bangladesh, and its label ("October 2026"). */
export const monthKey = (now = new Date()) => todayInBangladesh(now).slice(0, 7);
export const monthLabel = (key) =>
  new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
