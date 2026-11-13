// Board and staff views: approving members, reviewing attendance answers and rankings.
import {
  $,
  $$,
  h,
  busy,
  toast,
  confirmDialog,
  openDialog,
  field,
  select,
  formValues,
  fillForm,
  showFormError,
  clearFormError,
  errorMessage,
} from '../../admin/ui.js';
import { downloadWorkbook, readWorkbook, ACCEPTED } from '../../admin/spreadsheet.js';
import { normalizeMembershipID } from '../../lib/content-model.js';
import {
  answerMatch,
  attendanceRanking,
  copiedAnswers,
  duplicateClaims,
  heldSessions,
  memberStatus,
  normalizeClaim,
  normalizeNewMember,
  portalRoles,
  rosterCheck,
  sessionState,
  simplify,
  currentFiscalYear,
  fiscalLabel,
  fiscalYearOf,
  leaderboardRows,
  pointsByMember,
} from '../../lib/portal-model.js';
import { bdTime, statusTag } from './member.js';

/** Rows of objects as the array-of-arrays the workbook helper expects (headings first). */
const sheetRows = (rows, headings) => [headings, ...rows.map((r) => headings.map((k) => r[k]))];

const latestOpen = (record) => Math.max(0, ...record.sessions.map((s) => s.opensAt?.getTime() || 0));
const sessionStateLabel = { upcoming: 'upcoming', open: 'open now', closed: 'closed' };

/** Everything the rankings need: members, attendance, answers, task work and contributions. */
const rankingData = (app) =>
  Promise.all([
    app.cloud.members(),
    app.cloud.attendanceRecords(),
    app.cloud.answers(),
    app.cloud.work().catch(() => null),
    app.cloud.contributions().catch(() => null),
  ]);

/** Recomputes a fiscal year's ranking and publishes it as the leaderboard executive members see. */
async function publishLeaderboard(app, year, data) {
  const [members, records, answers, work, contributions] = data || (await rankingData(app));
  if (!work || !contributions) return; // never publish without the points
  const { total, rows } = attendanceRanking(members, records, answers, { year });
  const ranked = leaderboardRows(rows, pointsByMember(work, contributions, year));
  await app.cloud
    .publishLeaderboard(year, fiscalLabel(year), total, ranked)
    .catch((error) => console.warn('Leaderboard not updated', error));
}

// ------------------------------------------------------------------ members

const rosterTag = (check, year) =>
  ({
    match: `<span class="ed-tag ed-tag-open">On the ${h(year)} roster</span>`,
    name: `<span class="ed-tag ed-tag-update">ID belongs to ${h(check.name || 'another name')}</span>`,
    missing: `<span class="ed-tag ed-tag-revoked">Not on the ${h(year)} roster</span>`,
    unknown: '<span class="ed-tag">Roster IDs not available</span>',
  })[check.state];

export const membersView = {
  id: 'members',
  title: 'Members',
  icon: '👥',
  allowed: (a) => a.approveMembers,
  badge: (app) => app.cloud.count('portalMembers', 'status', 'pending'),
  async render(root, app) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading members…</p></section>';
    const [all, records, answers, directory] = await Promise.all([
      app.cloud.members(),
      app.cloud.attendanceRecords(),
      app.cloud.answers().catch(() => []),
      app.cloud.directory().catch(() => []),
    ]);
    const members = all.sort((a, b) => a.name.localeCompare(b.name));
    const fiscal = currentFiscalYear();
    const attendance = new Map(attendanceRanking(members, records, answers, { year: fiscal }).rows.map((r) => [r.uid, r]));
    const dupes = duplicateClaims(members);
    const rosters = new Map();
    const rosterFor = (year) => {
      if (!rosters.has(year)) rosters.set(year, Promise.all([app.cloud.roster(year), app.cloud.rosterIds(year)]));
      return rosters.get(year);
    };
    const groups = [
      ['pending', 'Waiting for approval'],
      ['active', 'Active'],
      ['removed', 'Removed'],
    ].map(([status, title]) => ({ status, title, list: members.filter((m) => m.status === status) }));
    const superAdmin = app.owner;

    const rowHTML = async (m) => {
      const self = m.uid === app.user.uid;
      const officerTarget = m.role !== 'member';
      const locked = (self && !superAdmin) || (officerTarget && !app.access.president);
      let tags = '';
      if (m.status === 'pending') {
        const [roster, ids] = await rosterFor(m.rosterYear);
        tags += rosterTag(rosterCheck(m, roster, ids), m.rosterYear);
      }
      if (dupes.has(normalizeMembershipID(m.memID)))
        tags += '<span class="ed-tag ed-tag-revoked">This ID is claimed by another profile</span>';
      const buttons = locked
        ? `<small class="ed-muted">${self ? 'You cannot review your own profile.' : 'Only the President can change an officer.'}</small>`
        : [
            m.status === 'pending' ? '<button type="button" class="ed-btn ed-btn-primary" data-act="approve">Approve</button>' : '',
            m.status === 'removed' ? '<button type="button" class="ed-btn" data-act="restore">Restore</button>' : '',
            '<button type="button" class="ed-btn" data-act="edit">Edit</button>',
            m.status !== 'removed' ? '<button type="button" class="ed-btn ed-btn-danger-quiet" data-act="remove">Remove</button>' : '',
            app.access.deleteAll && !self
              ? '<button type="button" class="ed-btn ed-btn-danger-quiet" data-act="delete">Delete</button>'
              : '',
          ].join('');
      return `<li data-uid="${h(m.uid)}"><div class="ed-card-head"><div><strong>${h(m.name)}</strong>
        <small><span class="ed-mono">${h(m.memID)}</span> · ${h(m.rosterYear)} roster · ${h(m.email)}${
          m.status === 'active'
            ? ` · ${h(m.designation || portalRoles[m.role])}${m.designation && m.role !== 'member' ? ` (${h(portalRoles[m.role])})` : ''}`
            : ''
        }${
          attendance.has(m.uid)
            ? ` · Attendance ${h(fiscalLabel(fiscal))}: ${attendance.get(m.uid).attended} of ${attendance.get(m.uid).total} sessions (${attendance.get(m.uid).rate}%)`
            : ''
        }</small></div><div>${tags}</div></div><div class="ed-actions">${buttons}</div></li>`;
    };

    const rows = Object.fromEntries(
      await Promise.all(groups.map(async (g) => [g.status, (await Promise.all(g.list.map(rowHTML))).join('')])),
    );
    // People added by email who have not signed in yet.
    const emails = new Set(members.map((m) => m.email));
    const waiting = directory.filter((e) => !emails.has(e.email));
    const canDrop = (e) => app.access.president || e.role === 'member';
    root.innerHTML = `
      <section class="ed-card"><h3>Add executive members</h3>
        <p class="ed-muted">Add people by their Google email. The first time they sign in to the portal with that account, they get an active executive-member profile at once: no claim or approval needed.</p>
        <form class="ed-form" novalidate data-add><div class="ed-grid">
          ${field({ label: 'Full name', name: 'name', attrs: 'required maxlength="160"' })}
          ${field({ label: 'Google email', name: 'email', type: 'email', attrs: 'required maxlength="200" autocomplete="off"' })}
          ${field({ label: 'AIChE membership ID', name: 'memID', attrs: 'required maxlength="40"' })}
          ${field({ label: 'Membership year', name: 'year', value: String(new Date().getFullYear()), attrs: 'required maxlength="4" inputmode="numeric"' })}
          ${field({ label: 'Designation', name: 'designation', optional: true, attrs: 'maxlength="120"', hint: 'Executive Member if left empty.', wide: true })}
        </div><div class="ed-actions ed-form-actions"><button class="ed-btn ed-btn-primary">Add member</button></div></form>
        <div class="ed-actions"><label class="ed-btn">Upload Excel<input type="file" accept="${ACCEPTED}" data-upload hidden></label>
          <button type="button" class="ed-btn ed-btn-quiet" data-template>Download the Excel template</button></div>
        <p class="ed-muted">Excel columns: Name, Email, Membership ID, Year (optional, this year if empty), Designation (optional).</p>
        ${
          waiting.length
            ? `<h4>Added, not signed in yet (${waiting.length})</h4><ul class="ed-list ed-attend">${waiting
                .map(
                  (e) =>
                    `<li data-entry="${h(e.email)}"><div class="ed-card-head"><div><strong>${h(e.name)}</strong> <small><span class="ed-mono">${h(e.memID)}</span> · ${h(e.year)} · ${h(e.email)} · ${h(e.designation || portalRoles[e.role])}</small></div>
                    ${canDrop(e) ? '<button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-drop>Delete</button>' : ''}</div></li>`,
                )
                .join('')}</ul>`
            : ''
        }
      </section>
      <div class="ed-card-head"><p class="ed-muted">${members.length} profile${members.length === 1 ? '' : 's'}</p>
      <button type="button" class="ed-btn" data-export${members.length ? '' : ' disabled'}>Export</button></div>
      ${groups
        .map(
          (g) => `<section class="ed-card${g.status === 'pending' && g.list.length ? ' ed-card-attention' : ''}">
        <h3>${g.title} (${g.list.length})</h3>
        ${g.list.length ? `<ul class="ed-list ed-attend">${rows[g.status]}</ul>` : `<p class="ed-muted">${g.status === 'pending' ? 'Nobody is waiting for approval.' : g.status === 'active' ? 'No active members yet.' : 'Nobody has been removed.'}</p>`}
      </section>`,
        )
        .join('')}`;

    const reload = () => membersView.render(root, app);
    const change = (m, changes, done) => async (e) => {
      await busy(e?.currentTarget, 'Saving…', async () => {
        await app.cloud.reviewMember(m.uid, changes, m);
        if (changes.status === 'active' && m.status !== 'active')
          await app.cloud.notify([m.uid], { title: 'Your membership is approved', body: 'Welcome to the Member Portal.', link: 'home' });
        app.updateBadges();
        toast(done);
        await reload();
      });
    };

    const add = async (rows) => {
      const n = await app.cloud.addMembers(rows);
      toast(
        n === rows.length
          ? `${n} member${n === 1 ? '' : 's'} added. They get access when they sign in.`
          : `${n} of ${rows.length} added; officers are changed by the President.`,
      );
      await reload();
    };
    const addForm = $('[data-add]', root);
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearFormError(addForm);
      busy($('button.ed-btn-primary', addForm), 'Adding…', async () => {
        try {
          await add([normalizeNewMember(formValues(addForm))]);
        } catch (error) {
          showFormError(addForm, errorMessage(error));
        }
      });
    });
    $('[data-template]', root).addEventListener('click', () =>
      downloadWorkbook('add-members.xlsx', {
        Members: [
          ['Name', 'Email', 'Membership ID', 'Year', 'Designation'],
          ['Amina Rahman', 'amina@gmail.com', '31234567', String(new Date().getFullYear()), 'Executive Member'],
        ],
      }),
    );
    $('[data-upload]', root).addEventListener('change', async (e) => {
      const input = e.currentTarget;
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const sheets = await readWorkbook(file);
        const problems = [];
        const rows = [];
        Object.values(sheets)
          .flat()
          .forEach((r, i) => {
            if (!Object.values(r).some((v) => String(v ?? '').trim())) return;
            try {
              rows.push(normalizeNewMember(r));
            } catch (error) {
              problems.push(`Row ${i + 2}: ${error.message}`);
            }
          });
        if (!rows.length) throw Error(problems[0] || 'The sheet has no members. Use the template’s columns.');
        const ok = await confirmDialog({
          title: `Add ${rows.length} member${rows.length === 1 ? '' : 's'}?`,
          body: `<p>They get portal access as executive members when they sign in with these emails.</p>${
            problems.length
              ? `<p class="ed-error-text">${problems.length} row${problems.length === 1 ? ' is' : 's are'} skipped:</p><ul>${problems
                  .slice(0, 8)
                  .map((p) => `<li>${h(p)}</li>`)
                  .join('')}</ul>`
              : ''
          }`,
          confirm: 'Add members',
        });
        if (ok) await add(rows);
      } catch (error) {
        toast(errorMessage(error), { type: 'error' });
      }
    });
    for (const li of $$('li[data-entry]', root))
      $('[data-drop]', li)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: 'Delete this entry?',
          body: '<p>They will no longer get access automatically.</p>',
          confirm: 'Delete',
          danger: true,
        });
        if (ok)
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteDirectoryEntry(li.dataset.entry);
            await reload();
          });
      });

    $('[data-export]', root)?.addEventListener('click', () =>
      downloadWorkbook('portal-members.xlsx', {
        Members: sheetRows(
          members.map((m) => ({
            Name: m.name,
            'Membership ID': m.memID,
            Year: m.rosterYear,
            Designation: m.designation || '',
            Role: portalRoles[m.role] || m.role,
            Status: memberStatus[m.status],
            Email: m.email,
          })),
          ['Name', 'Membership ID', 'Year', 'Designation', 'Role', 'Status', 'Email'],
        ),
      }),
    );

    for (const li of $$('li[data-uid]', root)) {
      const m = members.find((x) => x.uid === li.dataset.uid);
      $('[data-act="approve"]', li)?.addEventListener('click', change(m, { status: 'active' }, `${m.name} is approved.`));
      $('[data-act="restore"]', li)?.addEventListener('click', change(m, { status: 'active' }, `${m.name} is restored.`));
      $('[data-act="remove"]', li)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: `Remove ${m.name}?`,
          body: '<p>They lose portal access, and no longer appear in the rankings. You can restore them later.</p>',
          confirm: 'Remove',
          danger: true,
        });
        if (ok) await change(m, { status: 'removed' }, `${m.name} is removed.`)({ currentTarget: button });
      });
      $('[data-act="edit"]', li)?.addEventListener('click', () => editMember(app, m, reload));
      $('[data-act="delete"]', li)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: `Delete ${m.name} for good?`,
          body: '<p>Their profile is deleted and they lose portal access. Their past attendance, tasks and claims stay in the records. This cannot be undone.</p>',
          confirm: 'Delete',
          danger: true,
        });
        if (ok)
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteMember(m);
            toast(`${m.name} is deleted.`);
            await reload();
          });
      });
    }
  },
};

async function editMember(app, m, reload) {
  const roles = Object.entries(portalRoles);
  await openDialog(
    `<form class="ed-form" novalidate><h2>Edit ${h(m.name)}</h2><div class="ed-dialog-body"><div class="ed-grid">
      ${field({ label: 'Full name', name: 'name', attrs: 'required maxlength="160"', wide: true })}
      ${field({ label: 'AIChE membership ID', name: 'memID', attrs: 'required maxlength="40"' })}
      ${field({ label: 'Membership year', name: 'rosterYear', attrs: 'required maxlength="4" inputmode="numeric"' })}
      ${field({ label: 'Designation', name: 'designation', optional: true, attrs: 'maxlength="120"', hint: 'For example Joint Secretary or Executive Member.', wide: true })}
      ${app.access.president ? select({ label: 'Portal role', name: 'role', options: roles, value: m.role, hint: 'Officers (President, Vice President, Secretary, Treasurer) can approve members.' }) : ''}
    </div></div><div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Cancel</button><button class="ed-btn ed-btn-primary">Save</button></div></form>`,
    (dialog, close) => {
      const form = $('form', dialog);
      fillForm(form, m);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearFormError(form);
        busy($('button.ed-btn-primary', form), 'Saving…', async () => {
          const values = formValues(form);
          let changes;
          try {
            changes = {
              ...normalizeClaim(values),
              designation: String(values.designation || '')
                .trim()
                .slice(0, 120),
            };
          } catch (error) {
            showFormError(form, error.message);
            return;
          }
          if (app.access.president && values.role) changes.role = values.role;
          try {
            await app.cloud.reviewMember(m.uid, changes, m);
          } catch (error) {
            showFormError(form, errorMessage(error));
            return;
          }
          toast('Saved.');
          close(true);
        });
      });
    },
  );
  await reload();
}

// ------------------------------------------------------------------ opening attendance

const durations = [
  [10, '10 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [120, '2 hours'],
  [180, '3 hours'],
  [360, '6 hours'],
];

export const attendanceSetupView = {
  id: 'attendance',
  title: 'Attendance',
  icon: '🕒',
  allowed: (a) => a.board,
  async render(root, app) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading…</p></section>';
    const [events, records] = await Promise.all([app.cloud.events(), app.cloud.attendanceRecords()]);
    const now = new Date();
    const all = records.flatMap((r) => r.sessions.map((s) => ({ record: r, s, state: sessionState(s, now) })));
    const open = all.filter((x) => x.state === 'open').sort((a, b) => a.s.closesAt - b.s.closesAt);
    const recent = all
      .filter((x) => x.state === 'closed')
      .sort((a, b) => b.s.opensAt - a.s.opensAt)
      .slice(0, 10);
    const row = ({ record, s }, live) =>
      `<li data-event="${h(record.eventId)}" data-session="${h(s.id)}"><div class="ed-card-head"><div><strong>${h(record.title)} · ${h(s.label)}</strong>
        <small>${live ? `Open until ${h(bdTime(s.closesAt))}` : `${h(bdTime(s.opensAt))} to ${h(bdTime(s.closesAt).split(', ').pop())}`}</small></div>
        <div class="ed-actions">${live ? '<button type="button" class="ed-btn" data-extend>+15 min</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-close>Close now</button>' : ''}<a class="ed-btn ed-btn-quiet" href="#review/${encodeURIComponent(record.eventId)}/${encodeURIComponent(s.id)}">Answers</a>${app.access.deleteAll ? '<button type="button" class="ed-btn ed-btn-danger-quiet" data-delete>Delete</button>' : ''}</div></div></li>`;

    root.innerHTML = `
      <section class="ed-card${open.length ? ' ed-card-attention' : ''}"><h3>Open now (${open.length})</h3>
        ${open.length ? `<ul class="ed-list ed-attend">${open.map((x) => row(x, true)).join('')}</ul><p class="ed-muted">While attendance is open, a button on the website’s home page takes members to it.</p>` : '<p class="ed-muted">No attendance is open.</p>'}
      </section>
      <section class="ed-card"><h3>Open attendance now</h3>
        <p class="ed-muted">Members sign in to the portal with their Google account, so their name and membership ID come from their approved profile and each person can mark a session only once. Without a question, attendance counts at once; with one, the board reviews the answers.</p>
        ${
          events.length
            ? `<form class="ed-form" novalidate><div class="ed-grid">
          ${select({ label: 'Event', name: 'event', options: events.map((e) => [e.id, `${e.title}${e.date ? ` (${e.date.slice(0, 10)})` : ''}`]) })}
          ${field({ label: 'Title', name: 'label', attrs: 'required maxlength="80"', hint: 'For example Day 1, Workshop or Closing ceremony.' })}
          ${select({ label: 'Open for', name: 'minutes', options: durations.map(([m, t]) => [String(m), t]), value: '30' })}
          ${field({ label: 'Verification question', name: 'question', optional: true, attrs: 'maxlength="500"', hint: 'Shown only while attendance is open, for example a word said in the session.', wide: true })}
          ${field({ label: 'Expected answer', name: 'answer', optional: true, attrs: 'maxlength="500"', hint: 'Only the board sees it; it marks matching answers.' })}
        </div><div class="ed-actions ed-form-actions"><button class="ed-btn ed-btn-primary">Open attendance</button></div></form>`
            : '<p class="ed-muted">There are no events yet. Add the event in the Chapter Editor first.</p>'
        }
      </section>
      <section class="ed-card"><h3>Recent sessions</h3>${recent.length ? `<ul class="ed-list ed-attend">${recent.map((x) => row(x, false)).join('')}</ul>` : '<p class="ed-muted">None yet.</p>'}</section>`;

    const reload = () => attendanceSetupView.render(root, app);
    const form = $('form', root);
    if (form) {
      const suggest = () => {
        const n = records.find((r) => r.eventId === form.elements.event.value)?.sessions.length || 0;
        form.elements.label.value = `Day ${n + 1}`;
      };
      form.elements.event.addEventListener('change', suggest);
      suggest();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearFormError(form);
        busy($('button.ed-btn-primary', form), 'Opening…', async () => {
          const values = formValues(form);
          try {
            await app.cloud.openSession(
              events.find((x) => x.id === values.event),
              values,
            );
          } catch (error) {
            showFormError(form, errorMessage(error));
            return;
          }
          toast('Attendance is open. Members see the button on the home page.');
          await reload();
        });
      });
    }
    for (const li of $$('li[data-session]', root)) {
      const { event, session } = li.dataset;
      const s = all.find((x) => x.record.eventId === event && x.s.id === session).s;
      $('[data-extend]', li)?.addEventListener('click', (e) =>
        busy(e.currentTarget, 'Saving…', async () => {
          await app.cloud.closeSession(event, session, new Date(s.closesAt.getTime() + 15 * 60000));
          await reload();
        }),
      );
      $('[data-close]', li)?.addEventListener('click', (e) =>
        busy(e.currentTarget, 'Closing…', async () => {
          await app.cloud.closeSession(event, session);
          toast('Attendance closed.');
          await reload();
        }),
      );
      $('[data-delete]', li)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: `Delete ${s.label}?`,
          body: '<p>The session and every answer given to it are deleted, and it no longer counts in the attendance. This cannot be undone.</p>',
          confirm: 'Delete',
          danger: true,
        });
        if (ok)
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteSession(event, session);
            await publishLeaderboard(app, fiscalYearOf(s.date));
            toast('Session deleted.');
            await reload();
          });
      });
    }
  },
};

// ------------------------------------------------------------------ attendance review

const matchTag = (state) =>
  ({
    match: '<span class="ed-tag ed-tag-open">Matches</span>',
    close: '<span class="ed-tag ed-tag-update">Close</span>',
    differs: '<span class="ed-tag ed-tag-revoked">Differs</span>',
  })[state] || '';

export const reviewView = {
  id: 'review',
  title: 'Attendance review',
  icon: '✔',
  allowed: (a) => a.reviewAttendance,
  async render(root, app, [eventId = '', sessionId = '', filter = 'all']) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading attendance…</p></section>';
    const records = (await app.cloud.attendanceRecords()).sort((a, b) => latestOpen(b) - latestOpen(a));
    if (!records.length) {
      root.innerHTML =
        '<section class="ed-card"><h3>No attendance yet</h3><p class="ed-muted">Open attendance for an event under <a href="#attendance">Attendance</a>.</p></section>';
      return;
    }
    const record = records.find((r) => r.eventId === eventId) || records[0];
    const session =
      record.sessions.find((s) => s.id === sessionId) || record.sessions.find((s) => sessionState(s) === 'open') || record.sessions[0];
    const go = (event, sess, f = filter) => app.navigate('review', [event, sess, f]);
    const now = new Date();

    const [answers, expectedMap, members, question] = await Promise.all([
      app.cloud.answers(record.eventId),
      app.cloud.expectedAnswers(record.eventId, [session.id]),
      app.cloud.members().catch(() => []),
      app.cloud.question(record.eventId, session.id).catch(() => ''),
    ]);
    const expected = expectedMap[session.id] || '';
    const byUid = Object.fromEntries(members.map((m) => [m.uid, m]));
    const mine = answers.filter((a) => a.sessionId === session.id).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    const copied = copiedAnswers(mine);
    const check = (a) => answerMatch(a.answer, expected);
    const isCopied = (a) => copied.has(simplify(a.answer));
    const count = (status) => mine.filter((a) => a.status === status).length;
    const shown = filter === 'all' ? mine : mine.filter((a) => a.status === filter);
    const matching = mine.filter((a) => a.status === 'pending' && check(a) === 'match' && !isCopied(a));
    const pending = mine.filter((a) => a.status === 'pending');

    root.innerHTML = `
      <section class="ed-card">
        <div class="ed-grid">
          <label class="ed-field"><span class="ed-label">Event</span><select data-event>${records.map((r) => `<option value="${h(r.eventId)}"${r === record ? ' selected' : ''}>${h(r.title)}</option>`).join('')}</select></label>
          <label class="ed-field"><span class="ed-label">Day</span><select data-session>${record.sessions.map((s) => `<option value="${h(s.id)}"${s === session ? ' selected' : ''}>${h(s.label)} (${sessionStateLabel[sessionState(s, now)]})</option>`).join('')}</select></label>
        </div>
        <dl class="ed-details"><dt>Question</dt><dd>${h(question || 'Not available')}</dd><dt>Expected answer</dt><dd>${expected ? h(expected) : '<span class="ed-muted">None set</span>'}</dd><dt>Opens</dt><dd>${h(bdTime(session.opensAt))} to ${h(bdTime(session.closesAt))}</dd></dl>
      </section>
      <section class="ed-card">
        <div class="ed-card-head"><p><strong>${mine.length} answer${mine.length === 1 ? '' : 's'}</strong> · ${count('accepted')} accepted · ${count('pending')} pending · ${count('rejected')} rejected</p>
        <div class="ed-actions"><button type="button" class="ed-btn" data-bulk="match"${matching.length ? '' : ' disabled'}>Accept all matching (${matching.length})</button>
        <button type="button" class="ed-btn" data-bulk="all"${pending.length ? '' : ' disabled'}>Accept all pending (${pending.length})</button></div></div>
        <div class="ed-actions" role="group" aria-label="Filter answers">${[
          ['all', 'All'],
          ['pending', 'Pending'],
          ['accepted', 'Accepted'],
          ['rejected', 'Rejected'],
        ]
          .map(
            ([f, text]) =>
              `<button type="button" class="ed-btn${f === filter ? ' ed-btn-primary' : ' ed-btn-quiet'}" data-filter="${f}" aria-pressed="${f === filter}">${text}</button>`,
          )
          .join('')}</div>
        ${
          shown.length
            ? `<div class="ed-table-wrap"><table class="ed-table"><thead><tr><th>Member</th><th>Answer</th><th>Check</th><th>Submitted</th><th>Status</th><th><span class="ed-sr">Actions</span></th></tr></thead><tbody>${shown
                .map((a) => {
                  const m = byUid[a.uid];
                  return `<tr data-id="${h(a.id)}"><td><strong>${h(m?.name || 'Unknown member')}</strong><br><small class="ed-mono">${h(m?.memID || a.uid)}</small></td>
                  <td>${h(a.answer)}${isCopied(a) ? '<br><span class="ed-tag ed-tag-update">Same wording as other members</span>' : ''}${a.note ? `<br><small>Note: ${h(a.note)}</small>` : ''}</td>
                  <td>${matchTag(check(a))}</td><td>${h(bdTime(a.submittedAt))}</td><td>${statusTag(a.status)}</td>
                  <td class="ed-actions">${a.status !== 'accepted' ? '<button type="button" class="ed-btn ed-btn-primary" data-act="accepted">Accept</button>' : ''}${a.status !== 'rejected' ? '<button type="button" class="ed-btn ed-btn-danger-quiet" data-act="rejected">Reject</button>' : ''}${app.access.deleteAll ? '<button type="button" class="ed-btn ed-btn-danger-quiet" data-act="delete">Delete</button>' : ''}</td></tr>`;
                })
                .join('')}</tbody></table></div>`
            : `<p class="ed-muted">${mine.length ? 'No answers match this filter.' : 'Nobody has answered this day yet.'}</p>`
        }
      </section>`;

    $('[data-event]', root).addEventListener('change', (e) => go(e.target.value, ''));
    $('[data-session]', root).addEventListener('change', (e) => go(record.eventId, e.target.value));
    for (const b of $$('[data-filter]', root)) b.addEventListener('click', () => go(record.eventId, session.id, b.dataset.filter));

    const review = async (button, ids, status, done) => {
      await busy(button, 'Saving…', async () => {
        await app.cloud.reviewAnswers(ids, status);
        await publishLeaderboard(app, fiscalYearOf(session.date));
        toast(done);
        await reviewView.render(root, app, [record.eventId, session.id, filter]);
      });
    };
    for (const b of $$('[data-bulk]', root)) {
      b.addEventListener('click', async () => {
        const list = b.dataset.bulk === 'match' ? matching : pending;
        const ok = await confirmDialog({
          title: `Accept ${list.length} answer${list.length === 1 ? '' : 's'}?`,
          body: `<p>${b.dataset.bulk === 'match' ? 'These answers match the expected answer and are not copied word for word.' : 'This accepts every pending answer for this day, including any that differ from the expected answer.'}</p>`,
          confirm: 'Accept',
        });
        if (ok)
          await review(
            b,
            list.map((a) => a.id),
            'accepted',
            `${list.length} accepted.`,
          );
      });
    }
    for (const tr of $$('tr[data-id]', root)) {
      const a = mine.find((x) => x.id === tr.dataset.id);
      $('[data-act="accepted"]', tr)?.addEventListener('click', (e) => review(e.currentTarget, [a.id], 'accepted', 'Accepted.'));
      $('[data-act="rejected"]', tr)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const note = await rejectNote(byUid[a.uid]?.name || 'this member');
        if (note === undefined) return;
        await busy(button, 'Saving…', async () => {
          await app.cloud.reviewAnswer(a.id, 'rejected', note);
          await publishLeaderboard(app, fiscalYearOf(session.date));
          toast('Rejected.');
          await reviewView.render(root, app, [record.eventId, session.id, filter]);
        });
      });
      $('[data-act="delete"]', tr)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        if (
          !(await confirmDialog({
            title: 'Delete this answer?',
            body: '<p>The member can then answer again while the session is open.</p>',
            confirm: 'Delete',
            danger: true,
          }))
        )
          return;
        await busy(button, 'Deleting…', async () => {
          await app.cloud.deleteAnswer(a.id);
          await publishLeaderboard(app, fiscalYearOf(session.date));
          toast('Answer deleted.');
          await reviewView.render(root, app, [record.eventId, session.id, filter]);
        });
      });
    }
  },
};

/** Asks for an optional reason. Resolves with the note, or undefined when cancelled. */
function rejectNote(name) {
  return openDialog(
    `<form class="ed-form"><h2>Reject ${h(name)}’s answer?</h2><div class="ed-dialog-body">${field({ label: 'Note for the member', name: 'note', optional: true, attrs: 'maxlength="300"' })}</div>
    <div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Cancel</button><button class="ed-btn ed-btn-danger">Reject</button></div></form>`,
    (dialog, close) => {
      $('form', dialog).addEventListener('submit', (e) => {
        e.preventDefault();
        close(e.target.elements.note.value.trim());
      });
    },
  );
}

// ------------------------------------------------------------------ rankings

export const rankingsView = {
  id: 'rankings',
  title: 'Rankings',
  icon: '★',
  allowed: (a) => a.rankings,
  async render(root, app, [yearParam]) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading rankings…</p></section>';
    const data = await rankingData(app);
    const [members, records, answers, work, contributions] = data;
    const years = [...new Set(records.flatMap((r) => r.sessions.map((s) => fiscalYearOf(s.date))))];
    const year = yearParam === undefined ? currentFiscalYear() : yearParam === 'all' ? '' : yearParam;
    const { total, rows: attendance } = attendanceRanking(members, records, answers, { year });
    const points = pointsByMember(work || [], contributions || [], year);
    const rows = attendance.map((r) => ({ ...r, points: points.get(r.uid) || 0 }));
    const held = heldSessions(records, { year });
    const options = [...new Set([currentFiscalYear(), ...years])].sort().reverse();
    if (year) publishLeaderboard(app, year, data);

    root.innerHTML = `
      <section class="ed-card">
        <div class="ed-card-head">
          <label class="ed-field"><span class="ed-label">Fiscal year (June–May)</span><select data-year>${options.map((y) => `<option value="${h(y)}"${y === year ? ' selected' : ''}>${h(fiscalLabel(y))}</option>`).join('')}<option value="all"${year ? '' : ' selected'}>All years</option></select></label>
          <button type="button" class="ed-btn" data-export${rows.length ? '' : ' disabled'}>Download attendance (Excel)</button>
        </div>
        <p><strong>Sessions held: ${total}</strong></p>
        <p class="ed-note">Ranked by attendance. Points come from approved tasks and contributions; the leaderboard ranks by points. There is no fixed renewal threshold; the board and advisors decide.</p>
        ${
          rows.length
            ? `<div class="ed-table-wrap"><table class="ed-table"><thead><tr><th>Rank</th><th>Name</th><th>Membership ID</th><th>Designation</th><th>Attended</th><th>Pending</th><th>Rate</th><th>Points</th></tr></thead><tbody>${rows
                .map(
                  (r) =>
                    `<tr><td>${r.rank}</td><td>${h(r.name)}</td><td class="ed-mono">${h(r.memID)}</td><td>${h(r.designation)}</td><td>${r.attended} / ${r.total}</td><td>${r.pending}</td><td>${r.rate}%<span class="ed-bar" aria-hidden="true"><span style="width:${r.rate}%"></span></span></td><td>${r.points}</td></tr>`,
                )
                .join('')}</tbody></table></div>`
            : '<p class="ed-muted">No active members yet.</p>'
        }
      </section>`;

    $('[data-year]', root).addEventListener('change', (e) => app.navigate('rankings', [e.target.value]));
    $('[data-export]', root)?.addEventListener('click', () => {
      const accepted = new Map();
      for (const a of answers)
        if (a.status === 'accepted') accepted.set(`${a.eventId}__${a.sessionId}`, (accepted.get(`${a.eventId}__${a.sessionId}`) || 0) + 1);
      // The register: one row per active member, one column per session held, with totals.
      const present = new Set(answers.filter((a) => a.status === 'accepted').map((a) => `${a.uid}__${a.eventId}__${a.sessionId}`));
      const columns = held.map((x) => `${x.title} · ${x.session.label} (${x.session.date})`);
      const register = [
        ['Name', 'Membership ID', 'Designation', ...columns, 'Total sessions', 'Attended', 'Missed', 'Attendance %'],
        ...attendance
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => {
            const marks = held.map((x) => (present.has(`${r.uid}__${x.eventId}__${x.session.id}`) ? 'Present' : 'Absent'));
            const attended = marks.filter((m) => m === 'Present').length;
            return [
              r.name,
              r.memID,
              r.designation,
              ...marks,
              total,
              attended,
              total - attended,
              total ? Math.round((attended / total) * 100) : 0,
            ];
          }),
      ];
      downloadWorkbook(`attendance-${year || 'all'}.xlsx`, {
        Register: register,
        Ranking: sheetRows(
          rows.map((r) => ({
            Rank: r.rank,
            Name: r.name,
            'Membership ID': r.memID,
            Designation: r.designation,
            Attended: r.attended,
            Pending: r.pending,
            'Sessions held': r.total,
            'Rate %': r.rate,
            Points: r.points,
          })),
          ['Rank', 'Name', 'Membership ID', 'Designation', 'Attended', 'Pending', 'Sessions held', 'Rate %', 'Points'],
        ),
        Sessions: sheetRows(
          held.map((s) => ({
            Event: s.title,
            Day: s.session.label,
            Date: s.session.date,
            'Accepted answers': accepted.get(`${s.eventId}__${s.session.id}`) || 0,
          })),
          ['Event', 'Day', 'Date', 'Accepted answers'],
        ),
      });
    });
  },
};
