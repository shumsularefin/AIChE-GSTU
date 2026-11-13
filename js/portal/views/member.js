// Member views: the home page (profile claim, open attendance, own record) and marking attendance.
import {
  $,
  $$,
  h,
  busy,
  toast,
  confirmDialog,
  field,
  formValues,
  fillForm,
  showFormError,
  clearFormError,
  errorMessage,
} from '../../admin/ui.js';
import { TIMEZONE } from '../../lib/content-model.js';
import {
  currentFiscalYear,
  monthKey,
  monthLabel,
  pointsByMember,
  fiscalLabel,
  fiscalYearOf,
  localParts,
  memberStatus,
  openSessions,
  portalRoles,
  sessionState,
  thisYear,
} from '../../lib/portal-model.js';

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
export const bdTime = (date) => (date ? timeFormat.format(date) : '');
const answerStatus = { pending: 'Waiting for review', accepted: 'Attendance counted', rejected: 'Not accepted' };
export const statusTag = (status) =>
  `<span class="ed-tag ${status === 'accepted' ? 'ed-tag-open' : status === 'rejected' ? 'ed-tag-revoked' : 'ed-tag-update'}">${h(answerStatus[status] || status)}</span>`;

export const homeView = {
  id: 'home',
  title: 'Home',
  icon: '⌂',
  allowed: () => true,
  async render(root, app) {
    if (app.access.board && app.me?.status !== 'active') return adminHome(root, app);
    if (!app.me) return claimForm(root, app);
    if (app.me.status === 'pending') return pendingCard(root, app);
    if (app.me.status !== 'active') {
      root.innerHTML = `<section class="ed-card"><h3>Your portal access is closed</h3><p>A board member removed this profile. If this is a mistake, contact the chapter president or secretary.</p></section>${staffNote(app)}`;
      return;
    }
    const m = app.me;
    const fiscal = currentFiscalYear();
    root.innerHTML = `
      <section class="ed-card ed-welcome">
        <div><p class="ed-eyebrow">${h(m.designation || portalRoles[m.role])}</p><h3>Welcome, ${h(m.name.split(' ')[0])}</h3>
        <p class="ed-muted">Membership ID <strong class="ed-mono">${h(m.memID)}</strong> · ${h(m.rosterYear)} roster · Fiscal year ${h(fiscalLabel(fiscal))}</p></div>
        <div class="ed-stats" data-stats><p class="ed-muted">Loading…</p></div>
      </section>
      <div data-award></div>
      <div data-notices></div>
      <section class="ed-card ed-card-attention" data-open><h3>Attendance open now</h3><p class="ed-muted">Checking…</p></section>
      <section class="ed-card" data-tasks><h3>My tasks</h3><p class="ed-muted">Loading…</p></section>
      <section class="ed-card" data-mine><h3>My attendance</h3><p class="ed-muted">Loading…</p></section>`;
    const safe = (p, fallback = []) => p.catch(() => fallback);
    const [records, answers, tasks, work, claims, notices, awards, boards] = await Promise.all([
      app.cloud.attendanceRecords(),
      app.cloud.myAnswers(),
      safe(app.cloud.tasks()),
      safe(app.cloud.myWork()),
      safe(app.cloud.myContributions()),
      safe(app.cloud.announcements()),
      safe(app.cloud.awards()),
      app.access.leaderboard ? safe(app.cloud.leaderboards()) : [],
    ]);

    // Points, attendance and rank this fiscal year.
    const points = pointsByMember(work, claims, fiscal).get(app.user.uid) || 0;
    const year = answers.filter((a) => a.submittedAt && fiscalYearOf(localParts(a.submittedAt).date) === fiscal);
    const counted = year.filter((a) => a.status === 'accepted').length;
    const doneTasks = work.filter((w) => w.status === 'approved').length;
    const row = boards.find((b) => b.year === fiscal)?.rows.find((r) => r.uid === app.user.uid);
    const stat = (value, label, href = '') =>
      `<${href ? `a href="${href}"` : 'div'} class="ed-stat"><strong>${value}</strong><span>${label}</span></${href ? 'a' : 'div'}>`;
    $('[data-stats]', root).innerHTML = [
      stat(points, 'Points', '#contributions'),
      stat(counted, 'Sessions attended'),
      stat(doneTasks, 'Tasks done', '#tasks'),
      app.access.leaderboard ? stat(row ? `#${row.rank}` : '–', 'Leaderboard', '#leaderboard') : '',
    ].join('');

    // The latest Executive Member of the Month (this month or last).
    const award = awards.find((a) => a.month >= monthKey(new Date(Date.now() - 40 * 86400000)));
    if (award)
      $('[data-award]', root).outerHTML =
        `<section class="ed-card ed-award"><span class="ed-award-medal" aria-hidden="true">🎖</span><div><p class="ed-eyebrow">Executive Member of the Month · ${h(monthLabel(award.month))}</p>
        <h3>${h(award.name)}${award.uid === app.user.uid ? ' — that’s you, congratulations!' : ''}</h3><p class="ed-muted">${h(award.designation)}${award.reason ? ` · ${h(award.reason)}` : ''}</p></div></section>`;
    if (notices.length)
      $('[data-notices]', root).outerHTML =
        `<section class="ed-card"><div class="ed-card-head"><h3>Notices</h3><a class="ed-link" href="#notices">All notices</a></div><ul class="ed-list">${notices
          .slice(0, 3)
          .map(
            (n) =>
              `<li><strong>${n.pinned ? '📌 ' : ''}${h(n.title)}</strong>${n.body ? `<small class="ed-clamp">${h(n.body)}</small>` : ''}<small class="ed-muted">${h(n.author || 'Board')} · ${h(bdTime(n.createdAt))}</small></li>`,
          )
          .join('')}</ul></section>`;

    const done = new Set(answers.map((a) => `${a.eventId}__${a.sessionId}`));
    const open = openSessions(records).filter((o) => !done.has(`${o.eventId}__${o.session.id}`));
    $('[data-open]', root).innerHTML = `<h3>Attendance open now</h3>${
      open.length
        ? `<ul class="ed-list">${open.map((o) => `<li><a href="#attend/${encodeURIComponent(o.eventId)}">${h(o.title)}</a><small>${h(o.session.label)} · closes ${h(bdTime(o.session.closesAt))}</small></li>`).join('')}</ul>`
        : '<p class="ed-muted">Nothing to mark right now. When an event’s attendance opens, it appears here and on the event page for 2 hours.</p>'
    }`;
    if (!open.length) $('[data-open]', root).classList.remove('ed-card-attention');

    const byTask = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const todo = work
      .filter((w) => ['assigned', 'returned'].includes(w.status) && byTask[w.taskId])
      .sort((a, b) => byTask[a.taskId].dueAt - byTask[b.taskId].dueAt);
    $('[data-tasks]', root).innerHTML = `<div class="ed-card-head"><h3>My tasks</h3><a class="ed-link" href="#tasks">All tasks</a></div>${
      todo.length
        ? `<ul class="ed-list">${todo
            .slice(0, 5)
            .map((w) => {
              const t = byTask[w.taskId];
              return `<li><a href="#tasks">${h(t.title)}</a><small>${t.points} points · ${t.dueAt < new Date() ? '<span class="ed-danger-text">overdue</span>' : `due ${h(bdTime(t.dueAt))}`}${w.status === 'returned' ? ' · needs changes' : ''}</small></li>`;
            })
            .join('')}</ul>`
        : '<p class="ed-muted">No tasks waiting for you.</p>'
    }`;
    if (todo.length) $('[data-tasks]', root).classList.add('ed-card-attention');

    const titles = Object.fromEntries(records.map((r) => [r.eventId, r]));
    $('[data-mine]', root).innerHTML = `<h3>My attendance</h3>
      <p>${counted} session${counted === 1 ? '' : 's'} counted in ${fiscalLabel(fiscal)}${year.length > counted ? `, ${year.length - counted} waiting or not accepted` : ''}.</p>
      ${
        answers.length
          ? `<ul class="ed-list">${answers
              .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
              .slice(0, 12)
              .map((a) => {
                const r = titles[a.eventId];
                const s = r?.sessions.find((x) => x.id === a.sessionId);
                return `<li><span>${h(r?.title || a.eventId)}</span><small>${h(s?.label || a.sessionId)} · ${statusTag(a.status)}${a.note ? ` · ${h(a.note)}` : ''}</small></li>`;
              })
              .join('')}</ul>`
          : '<p class="ed-muted">You have not marked attendance yet.</p>'
      }${staffNote(app)}`;
  },
};

/** The site owner (or board) without a member profile: straight to the admin tools. */
function adminHome(root, app) {
  root.innerHTML = `
    <section class="ed-card ed-welcome"><div><p class="ed-eyebrow">${app.owner ? 'Site owner' : 'Board'}</p>
      <h3>Welcome, ${h((app.user.displayName || '').split(' ')[0] || 'admin')}</h3>
      <p>You manage the portal without a member profile. Executive members get access automatically when you add them under <strong>Members</strong> (by hand or from Excel), or when they are listed with their Google email on the Team page; the President, Vice President, Secretary and Treasurer become portal admins.</p></div></section>
    <div class="ed-quick">
      <a class="ed-card ed-quick-card" href="#members"><strong>Members</strong><span>Add executive members, approve claims, set designations and roles.</span></a>
      <a class="ed-card ed-quick-card" href="#review"><strong>Attendance review</strong><span>Accept or reject attendance answers.</span></a>
      <a class="ed-card ed-quick-card" href="#rankings"><strong>Rankings</strong><span>Fiscal-year attendance, exported to Excel.</span></a>
      <a class="ed-card ed-quick-card" href="#manage-tasks"><strong>Tasks</strong><span>Assign work with points and due dates.</span></a>
      <a class="ed-card ed-quick-card" href="#claims"><strong>Contribution claims</strong><span>Approve past work with points.</span></a>
      <a class="ed-card ed-quick-card" href="#notices"><strong>Notices</strong><span>Post news every member sees.</span></a>
      ${app.access.award ? '<a class="ed-card ed-quick-card" href="#award"><strong>Member of the Month</strong><span>Name the winner and issue the certificate.</span></a>' : ''}
      <a class="ed-card ed-quick-card" href="#leaderboard"><strong>Leaderboard</strong><span>What executive members see.</span></a>
    </div>`;
}

export const leaderboardView = {
  id: 'leaderboard',
  title: 'Leaderboard',
  icon: '🏆',
  allowed: (a) => a.leaderboard,
  async render(root, app, [yearParam]) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading the leaderboard…</p></section>';
    const boards = await app.cloud.leaderboards();
    const board = boards.find((b) => b.year === yearParam) || boards.find((b) => b.year === currentFiscalYear()) || boards[0];
    if (!board) {
      root.innerHTML =
        '<section class="ed-card"><h3>No leaderboard yet</h3><p class="ed-muted">It appears once attendance has been reviewed this fiscal year.</p></section>';
      return;
    }
    const uid = app.user.uid;
    root.innerHTML = `
      <section class="ed-card">
        <div class="ed-card-head"><h3>Fiscal year ${h(board.label)}</h3>
          <label class="ed-field"><span class="ed-label">Year</span><select data-year>${boards.map((b) => `<option value="${h(b.year)}"${b === board ? ' selected' : ''}>${h(b.label)}</option>`).join('')}</select></label></div>
        <p class="ed-muted">Ranked by points from tasks and approved contributions, then attendance (${board.total} session${board.total === 1 ? '' : 's'} held). Updated ${h(bdTime(board.updatedAt))}.</p>
        ${
          board.rows.length
            ? `<div class="ed-table-wrap"><table class="ed-table"><thead><tr><th>Rank</th><th>Name</th><th>Designation</th><th>Points</th><th>Attended</th><th>Rate</th></tr></thead><tbody>${board.rows
                .map(
                  (r) =>
                    `<tr${r.uid === uid ? ' class="ed-row-me"' : ''}><td>${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td><td>${h(r.name)}${r.uid === uid ? ' <span class="ed-tag ed-tag-new">You</span>' : ''}</td><td>${h(r.designation)}</td><td><strong>${r.points || 0}</strong></td><td>${r.attended} / ${board.total}</td><td>${r.rate}%<span class="ed-bar" aria-hidden="true"><span style="width:${r.rate}%"></span></span></td></tr>`,
                )
                .join('')}</tbody></table></div>`
            : '<p class="ed-muted">No members on it yet.</p>'
        }
      </section>`;
    $('[data-year]', root).addEventListener('change', (e) => app.navigate('leaderboard', [e.target.value]));
  },
};

const staffNote = (app) =>
  app.access.reviewAttendance && !app.access.member
    ? '<p class="ed-note">You have Chapter Editor access, so you can review attendance and see rankings from the menu.</p>'
    : '';

async function claimForm(root, app, existing = null) {
  root.innerHTML = `
    <section class="ed-card">
      <h3>${existing ? 'Correct your details' : 'Link your membership'}</h3>
      <p>Enter your name and AIChE membership ID as they appear on the chapter roster. A board member checks them against the roster and approves your profile, usually within a day.</p>
      <form class="ed-form" novalidate>
        <div class="ed-grid">
          ${field({ label: 'Full name', name: 'name', attrs: 'required maxlength="160" autocomplete="name"', wide: true })}
          ${field({ label: 'AIChE membership ID', name: 'memID', attrs: 'required maxlength="40" autocomplete="off"' })}
          <label class="ed-field"><span class="ed-label">Membership year</span><select name="rosterYear" required><option value="">Loading…</option></select><small>The roster you were listed on most recently.</small></label>
        </div>
        <div class="ed-actions ed-form-actions">
          ${existing ? '<button type="button" class="ed-btn ed-btn-quiet" data-cancel>Cancel</button>' : ''}
          <button class="ed-btn ed-btn-primary">${existing ? 'Save changes' : 'Send for approval'}</button>
        </div>
      </form>
    </section>${staffNote(app)}`;
  const form = $('form', root);
  const years = await app.cloud.rosterYears().catch(() => []);
  const now = Number(thisYear());
  const options = years.length ? years : [now, now - 1, now - 2].map(String);
  form.elements.rosterYear.innerHTML = `<option value="">Choose a year</option>${options.map((y) => `<option>${h(y)}</option>`).join('')}`;
  fillForm(form, existing || { name: app.user.displayName || '', rosterYear: options[0] });
  $('[data-cancel]', form)?.addEventListener('click', () => pendingCard(root, app));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFormError(form);
    busy($('button.ed-btn-primary', form), 'Sending…', async () => {
      try {
        await app.cloud.claim(formValues(form), existing);
      } catch (error) {
        showFormError(form, errorMessage(error));
        return;
      }
      toast(existing ? 'Details updated.' : 'Sent. A board member will approve your profile soon.');
      await app.refresh();
    });
  });
}

function pendingCard(root, app) {
  const m = app.me;
  root.innerHTML = `
    <section class="ed-card ed-card-attention">
      <h3>Waiting for approval</h3>
      <p>A board member will check your details against the ${h(m.rosterYear)} roster. You can mark attendance once your profile is approved.</p>
      <dl class="ed-details"><dt>Name</dt><dd>${h(m.name)}</dd><dt>Membership ID</dt><dd class="ed-mono">${h(m.memID)}</dd><dt>Year</dt><dd>${h(m.rosterYear)}</dd><dt>Status</dt><dd>${h(memberStatus[m.status])}</dd></dl>
      <div class="ed-actions"><button type="button" class="ed-btn" data-edit>Correct details</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-withdraw>Withdraw</button><button type="button" class="ed-btn ed-btn-quiet" data-check>Check again</button></div>
    </section>${staffNote(app)}`;
  $('[data-edit]', root).addEventListener('click', () => claimForm(root, app, m));
  $('[data-check]', root).addEventListener('click', (e) => busy(e.currentTarget, 'Checking…', () => app.refresh()));
  $('[data-withdraw]', root).addEventListener('click', async (e) => {
    if (
      !(await confirmDialog({
        title: 'Withdraw your request?',
        body: '<p>You can send a new one any time.</p>',
        confirm: 'Withdraw',
        danger: true,
      }))
    )
      return;
    await busy(e.currentTarget, 'Withdrawing…', async () => {
      await app.cloud.withdrawClaim();
      await app.refresh();
    });
  });
}

export const attendView = {
  id: 'attend',
  title: 'Mark attendance',
  icon: '✓',
  hidden: true,
  allowed: () => true,
  async render(root, app, [eventId = '']) {
    root.innerHTML = '<section class="ed-card"><p class="ed-muted">Loading…</p></section>';
    const record = eventId ? await app.cloud.attendanceRecord(eventId) : null;
    if (!record) {
      root.innerHTML = `<section class="ed-card"><h3>No attendance for this event</h3><p>Attendance has not been set up for it. <a href="#home">Back to home</a></p></section>`;
      return;
    }
    if (!app.access.member) {
      root.innerHTML = `<section class="ed-card"><h3>${h(record.title)}</h3><p>Only approved members can mark attendance. ${app.me ? 'Your profile is still waiting for approval.' : '<a href="#home">Link your membership</a> first; a board member approves it.'}</p></section>`;
      return;
    }
    const answers = (await app.cloud.myAnswers()).filter((a) => a.eventId === eventId);
    const now = new Date();
    root.innerHTML = `
      <a class="ed-back" href="#home">← Home</a>
      <section class="ed-card"><div class="ed-card-head"><h3>${h(record.title)}</h3><a class="ed-link" href="event-${encodeURIComponent(eventId)}.html">Event page</a></div>
      <p class="ed-muted">Attendance is open for a limited time. You can mark it once per session; the board checks it.</p>
      <ul class="ed-attend">${record.sessions
        .map((s) => {
          const mine = answers.find((a) => a.sessionId === s.id);
          const state = sessionState(s, now);
          const status = mine
            ? statusTag(mine.status)
            : state === 'open'
              ? `<span class="ed-tag ed-tag-open">Open until ${h(bdTime(s.closesAt).split(', ').pop())}</span>`
              : state === 'upcoming'
                ? `<span class="ed-tag ed-tag-new">Opens ${h(bdTime(s.opensAt))}</span>`
                : '<span class="ed-tag">Closed</span>';
          return `<li data-session="${h(s.id)}"><div class="ed-card-head"><strong>${h(s.label)}</strong>${status}</div>${!mine && state === 'open' ? '<div data-question><p class="ed-muted">Loading the question…</p></div>' : ''}</li>`;
        })
        .join('')}</ul></section>`;
    for (const li of $$('li[data-session]', root)) {
      const box = $('[data-question]', li);
      if (!box) continue;
      const sessionId = li.dataset.session;
      const question = await app.cloud.question(eventId, sessionId).catch(() => '');
      box.innerHTML = `<form class="ed-form" novalidate><p class="ed-muted">Marking as <strong>${h(app.me.name)}</strong> · <span class="ed-mono">${h(app.me.memID)}</span></p>${
        question
          ? `<label class="ed-field"><span class="ed-label">${h(question)}</span><textarea name="answer" rows="2" maxlength="500" required></textarea></label>`
          : '<input type="hidden" name="answer" value="">'
      }<div class="ed-actions"><button class="ed-btn ed-btn-primary">${question ? 'Submit attendance' : 'I’m here: mark my attendance'}</button></div></form>`;
      const form = $('form', box);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearFormError(form);
        busy($('button', form), 'Submitting…', async () => {
          try {
            if (question && !form.elements.answer.value.trim()) throw Error('Answer the question first.');
            await app.cloud.submitAnswer(eventId, sessionId, form.elements.answer.value, { noQuestion: !question });
          } catch (error) {
            const closed =
              error?.code === 'permission-denied' ? 'This session is closed, or you already submitted for it.' : errorMessage(error);
            showFormError(form, closed);
            return;
          }
          toast(question ? 'Attendance submitted. The board will review it.' : 'Your attendance is counted.');
          attendView.render(root, app, [eventId]);
        });
      });
    }
  },
};
