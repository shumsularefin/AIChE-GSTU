// Tasks, past contributions, notices, notifications and the Executive Member of the Month.
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
import { certificateURL } from '../../lib/certificate-model.js';
import { todayInBangladesh } from '../../lib/content-model.js';
import {
  contributionTags,
  daysLate,
  localParts,
  monthKey,
  monthLabel,
  portalRoles,
  taskPoints,
  workStatus,
} from '../../lib/portal-model.js';
import { bdTime } from './member.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const workTag = (status) =>
  `<span class="ed-tag ${{ approved: 'ed-tag-open', returned: 'ed-tag-revoked', submitted: 'ed-tag-update', requested: 'ed-tag-update' }[status] || 'ed-tag-new'}">${h(workStatus[status] || status)}</span>`;
const claimTag = (status) =>
  `<span class="ed-tag ${{ approved: 'ed-tag-open', rejected: 'ed-tag-revoked' }[status] || 'ed-tag-update'}">${h({ pending: 'Waiting for review', approved: 'Approved', rejected: 'Not approved' }[status])}</span>`;
const dueTag = (task, now = new Date()) =>
  task.dueAt < now
    ? `<span class="ed-tag ed-tag-revoked">Overdue since ${h(bdTime(task.dueAt))}</span>`
    : `<span class="ed-tag ed-tag-new">Due ${h(bdTime(task.dueAt))}</span>`;
const linkHTML = (url) =>
  url ? `<a href="${h(url)}" target="_blank" rel="noopener">${h(url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : '';
const paragraphs = (text) => (text ? `<p class="ed-pre">${h(text)}</p>` : '');
const loading = (root, text = 'Loading…') => (root.innerHTML = `<section class="ed-card"><p class="ed-muted">${text}</p></section>`);
/** Event dropdown (newest first) with a first "not linked" choice. */
const eventSelect = (events, label, none) =>
  select({
    label,
    name: 'eventId',
    options: [['', none], ...events.map((e) => [e.id, `${e.title}${e.date ? ` (${e.date.slice(0, 10)})` : ''}`])],
  });
const eventName = (events, id) => (id ? events.find((e) => e.id === id)?.title || '' : '');
const taskMeta = (t) => `${plural(t.points, 'point')}${t.penalty ? ` · −${t.penalty}% per day late` : ''}`;

/** Submits a form inside `busy`, showing errors on the form. */
function onSubmit(form, label, action) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFormError(form);
    busy($('button.ed-btn-primary', form), label, async () => {
      try {
        await action(formValues(form));
      } catch (error) {
        showFormError(form, errorMessage(error));
      }
    });
  });
}

// ------------------------------------------------------------------ member: my tasks

export const tasksView = {
  id: 'tasks',
  title: 'My tasks',
  icon: '📋',
  allowed: (a) => a.tasks,
  async render(root, app) {
    loading(root, 'Loading your tasks…');
    const [tasks, work] = await Promise.all([app.cloud.tasks(), app.cloud.myWork()]);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const mine = work.filter((w) => byId[w.taskId]).map((w) => ({ ...w, task: byId[w.taskId] }));
    const group = (...statuses) => mine.filter((w) => statuses.includes(w.status)).sort((a, b) => a.task.dueAt - b.task.dueAt);
    const todo = group('assigned', 'returned');
    const waiting = group('submitted', 'requested');
    const done = group('approved').sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0));
    const taken = new Set(mine.map((w) => w.taskId));
    const available = tasks.filter((t) => t.open && t.status === 'open' && !taken.has(t.id) && t.dueAt > new Date());
    const earned = done.reduce((n, w) => n + (w.points || 0), 0);

    const item = (w, body = '') =>
      `<li data-task="${h(w.taskId)}"><div class="ed-card-head"><div><strong>${h(w.task.title)}</strong><small>${taskMeta(w.task)}</small></div><div>${workTag(w.status)} ${w.status === 'approved' ? '' : dueTag(w.task)}</div></div>${body}</li>`;
    root.innerHTML = `
      <section class="ed-card${todo.length ? ' ed-card-attention' : ''}"><h3>To do (${todo.length})</h3>
        ${
          todo.length
            ? `<ul class="ed-list ed-attend">${todo
                .map((w) =>
                  item(
                    w,
                    `${paragraphs(w.task.details)}${w.status === 'returned' && w.feedback ? `<p class="ed-note">Board feedback: ${h(w.feedback)}</p>` : ''}
                    <details class="ed-details-box"${w.status === 'returned' ? ' open' : ''}><summary>Hand in this task</summary>
                    <form class="ed-form" novalidate data-submit="${h(w.taskId)}">
                      ${field({ label: 'What did you do?', name: 'note', type: 'textarea', attrs: 'rows="3" maxlength="2000"', value: w.note || '' })}
                      ${field({ label: 'Link to the work', name: 'link', type: 'url', optional: true, attrs: 'maxlength="500" placeholder="https://"', value: w.link || '' })}
                      <div class="ed-actions"><button class="ed-btn ed-btn-primary">Hand in</button></div></form></details>`,
                  ),
                )
                .join('')}</ul>`
            : '<p class="ed-muted">Nothing to do right now.</p>'
        }</section>
      ${
        available.length
          ? `<section class="ed-card"><h3>Open for volunteers (${available.length})</h3><p class="ed-muted">Ask to take one on; a board member confirms it.</p><ul class="ed-list ed-attend">${available
              .map(
                (t) =>
                  `<li><div class="ed-card-head"><div><strong>${h(t.title)}</strong><small>${taskMeta(t)}</small></div>${dueTag(t)}</div>${paragraphs(t.details)}<div class="ed-actions"><button type="button" class="ed-btn" data-request="${h(t.id)}">Request this task</button></div></li>`,
              )
              .join('')}</ul></section>`
          : ''
      }
      <section class="ed-card"><h3>Waiting (${waiting.length})</h3>
        ${
          waiting.length
            ? `<ul class="ed-list ed-attend">${waiting
                .map((w) =>
                  item(
                    w,
                    w.status === 'requested'
                      ? '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-danger-quiet" data-withdraw="' +
                          h(w.taskId) +
                          '">Withdraw request</button></div>'
                      : `<small class="ed-muted">Handed in ${h(bdTime(w.submittedAt))}${daysLate(w.task.dueAt, w.submittedAt) ? ` · ${plural(daysLate(w.task.dueAt, w.submittedAt), 'day')} late` : ''}</small>`,
                  ),
                )
                .join('')}</ul>`
            : '<p class="ed-muted">Nothing waiting for the board.</p>'
        }</section>
      <section class="ed-card"><h3>Done (${done.length}) · ${plural(earned, 'point')}</h3>
        ${
          done.length
            ? `<ul class="ed-list">${done.map((w) => `<li><span>${h(w.task.title)}</span><small>${plural(w.points || 0, 'point')}${w.feedback ? ` · ${h(w.feedback)}` : ''}</small></li>`).join('')}</ul>`
            : '<p class="ed-muted">Finished tasks and their points appear here.</p>'
        }</section>`;

    const reload = () => tasksView.render(root, app);
    for (const form of $$('[data-submit]', root))
      onSubmit(form, 'Handing in…', async (values) => {
        await app.cloud.submitWork(form.dataset.submit, values);
        toast('Handed in. The board will review it.');
        await reload();
      });
    for (const b of $$('[data-request]', root))
      b.addEventListener('click', () =>
        busy(b, 'Sending…', async () => {
          await app.cloud.requestTask(b.dataset.request);
          toast('Requested. A board member will confirm it.');
          await reload();
        }),
      );
    for (const b of $$('[data-withdraw]', root))
      b.addEventListener('click', () =>
        busy(b, 'Withdrawing…', async () => {
          await app.cloud.withdrawRequest(b.dataset.withdraw);
          await reload();
        }),
      );
  },
};

// ------------------------------------------------------------------ board: tasks

const activeMembers = async (app) =>
  (await app.cloud.members()).filter((m) => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
const memberLabel = (m) => `${m.name}${m.designation || m.role !== 'member' ? ` · ${m.designation || portalRoles[m.role]}` : ''}`;
const memberChecks = (members, skip = new Set()) =>
  `<fieldset class="ed-field ed-wide ed-checks"><legend class="ed-label">Assign to</legend>
    <div class="ed-actions"><button type="button" class="ed-btn ed-btn-small ed-btn-quiet" data-all="exec">All executives</button><button type="button" class="ed-btn ed-btn-small ed-btn-quiet" data-all="none">Clear</button></div>
    <div class="ed-check-grid">${
      members
        .filter((m) => !skip.has(m.uid))
        .map(
          (m) =>
            `<label class="ed-check"><input type="checkbox" data-uid="${h(m.uid)}"${m.designation || m.role !== 'member' ? ' data-exec' : ''}> ${h(memberLabel(m))}</label>`,
        )
        .join('') || '<p class="ed-muted">Everyone already has this task.</p>'
    }</div></fieldset>`;
function wireChecks(dialog) {
  for (const b of $$('[data-all]', dialog))
    b.addEventListener('click', () =>
      $$('[data-uid]', dialog).forEach((c) => (c.checked = b.dataset.all === 'exec' && c.hasAttribute('data-exec'))),
    );
  return () => $$('[data-uid]:checked', dialog).map((c) => c.dataset.uid);
}

function taskDialog(app, task = null, members = [], events = []) {
  const due = task ? localParts(task.dueAt) : { date: todayInBangladesh(new Date(Date.now() + 7 * 86400000)), time: '23:59' };
  return openDialog(
    `<form class="ed-form" novalidate><h2>${task ? 'Edit task' : 'New task'}</h2><div class="ed-dialog-body"><div class="ed-grid">
      ${eventSelect(events, 'Event', 'Not for a specific event')}
      ${field({ label: 'Task title', name: 'title', attrs: 'required maxlength="160"', hint: 'For example: Design the poster.' })}
      ${field({ label: 'Details', name: 'details', type: 'textarea', optional: true, attrs: 'rows="4" maxlength="2000"', wide: true, hint: 'What to do, and what counts as done.' })}
      ${field({ label: 'Points', name: 'points', type: 'number', attrs: 'min="0" max="1000" required' })}
      ${field({ label: 'Late deduction (% of points per day)', name: 'penalty', type: 'number', attrs: 'min="0" max="100"', hint: '0 means no deduction.' })}
      ${field({ label: 'Due date', name: 'dueDate', type: 'date', attrs: 'required' })}
      ${field({ label: 'Due time (Bangladesh)', name: 'dueTime', type: 'time' })}
      <label class="ed-check ed-wide"><input type="checkbox" name="open"> Open for volunteers: any active member can request it</label>
      ${task ? '' : memberChecks(members)}
    </div></div><div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Cancel</button><button class="ed-btn ed-btn-primary">${task ? 'Save' : 'Create task'}</button></div></form>`,
    (dialog, close) => {
      const form = $('form', dialog);
      fillForm(
        form,
        task ? { ...task, dueDate: due.date, dueTime: due.time } : { points: 10, penalty: 10, dueDate: due.date, dueTime: due.time },
      );
      const picked = wireChecks(dialog);
      onSubmit(form, 'Saving…', async (values) => {
        const uids = task ? [] : picked();
        if (!task && !uids.length && !values.open) throw Error('Assign it to someone, or open it for volunteers.');
        await app.cloud.saveTask(values, task?.id, uids);
        toast(task ? 'Task saved.' : 'Task created and members notified.');
        close(true);
      });
    },
    { wide: true },
  );
}

/** Asks for points (prefilled with the late deduction applied) or feedback. Resolves with values or undefined. */
function reviewDialog({ title, body, points = null, feedbackLabel, confirm, danger = false }) {
  return openDialog(
    `<form class="ed-form" novalidate><h2>${h(title)}</h2><div class="ed-dialog-body">${body}
      ${points === null ? '' : field({ label: 'Points', name: 'points', type: 'number', attrs: 'min="0" max="1000" required' })}
      ${field({ label: feedbackLabel, name: 'feedback', type: 'textarea', optional: points !== null, attrs: 'rows="2" maxlength="300"' })}
    </div><div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Cancel</button><button class="ed-btn ${danger ? 'ed-btn-danger' : 'ed-btn-primary'}">${h(confirm)}</button></div></form>`,
    (dialog, close) => {
      const form = $('form', dialog);
      if (points !== null) form.elements.points.value = points;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        close(formValues(form));
      });
    },
  );
}

export const manageTasksView = {
  id: 'manage-tasks',
  title: 'Tasks',
  icon: '🗂',
  allowed: (a) => a.manageTasks,
  badge: async (app) =>
    (await app.cloud.count('taskWork', 'status', 'submitted')) + (await app.cloud.count('taskWork', 'status', 'requested')),
  async render(root, app, [show = 'open']) {
    loading(root, 'Loading tasks…');
    const [tasks, work, members, events] = await Promise.all([
      app.cloud.tasks(),
      app.cloud.work(),
      activeMembers(app),
      app.cloud.events().catch(() => []),
    ]);
    const byUid = Object.fromEntries(members.map((m) => [m.uid, m]));
    const shown = tasks.filter((t) => (show === 'closed' ? t.status === 'closed' : t.status === 'open'));
    const needsReview = work.filter((w) => ['submitted', 'requested'].includes(w.status)).length;

    const workRow = (w, t) => {
      const m = byUid[w.uid];
      const late = w.submittedAt ? daysLate(t.dueAt, w.submittedAt) : 0;
      const actions =
        {
          requested:
            '<button type="button" class="ed-btn ed-btn-primary" data-act="assigned">Accept</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-act="declined">Decline</button>',
          submitted:
            '<button type="button" class="ed-btn ed-btn-primary" data-act="approved">Approve</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-act="returned">Return</button>',
          approved: `<strong>${plural(w.points || 0, 'point')}</strong>`,
        }[w.status] || '';
      const self = w.uid === app.user.uid && !app.owner;
      return `<tr data-work="${h(w.id)}"><td><strong>${h(m?.name || 'Former member')}</strong>${m?.designation ? `<br><small>${h(m.designation)}</small>` : ''}</td>
        <td>${workTag(w.status)}${w.submittedAt ? `<br><small>${h(bdTime(w.submittedAt))}${late ? ` · <span class="ed-danger-text">${plural(late, 'day')} late</span>` : ''}</small>` : ''}</td>
        <td>${w.note ? `<span class="ed-pre">${h(w.note)}</span>` : ''}${w.link ? `<br>${linkHTML(w.link)}` : ''}${w.feedback ? `<br><small>Feedback: ${h(w.feedback)}</small>` : ''}</td>
        <td class="ed-actions">${self && actions && w.status !== 'approved' ? '<small class="ed-muted">Another officer reviews your work.</small>' : actions}${app.access.deleteAll ? '<button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-act="remove">Remove</button>' : ''}</td></tr>`;
    };

    root.innerHTML = `
      <div class="ed-card-head"><div class="ed-tabs" role="group" aria-label="Show tasks">${[
        ['open', 'Open'],
        ['closed', 'Closed'],
      ]
        .map(
          ([v, text]) =>
            `<button type="button" class="ed-btn${v === show ? ' ed-btn-primary' : ' ed-btn-quiet'}" data-show="${v}" aria-pressed="${v === show}">${text} (${tasks.filter((t) => t.status === v).length})</button>`,
        )
        .join('')}</div>
        <button type="button" class="ed-btn ed-btn-primary" data-new>New task</button></div>
      ${needsReview ? `<p class="ed-note">${plural(needsReview, 'item')} need${needsReview === 1 ? 's' : ''} your review: handed-in work or volunteer requests.</p>` : ''}
      ${
        shown.length
          ? shown
              .map((t) => {
                const list = work.filter((w) => w.taskId === t.id);
                const done = list.filter((w) => w.status === 'approved').length;
                const pending = list.some((w) => ['submitted', 'requested'].includes(w.status));
                return `<section class="ed-card${pending ? ' ed-card-attention' : ''}" data-task="${h(t.id)}">
                  <div class="ed-card-head"><div><h3>${h(t.title)}</h3><small class="ed-muted">${t.eventId && eventName(events, t.eventId) ? `${h(eventName(events, t.eventId))} · ` : ''}${taskMeta(t)} · ${done} of ${list.filter((w) => w.status !== 'requested').length} done${t.open ? ' · open for volunteers' : ''}</small></div>${t.status === 'open' ? dueTag(t) : '<span class="ed-tag">Closed</span>'}</div>
                  ${paragraphs(t.details)}
                  ${
                    list.length
                      ? `<div class="ed-table-wrap"><table class="ed-table"><thead><tr><th>Member</th><th>Status</th><th>Work</th><th><span class="ed-sr">Actions</span></th></tr></thead><tbody>${list
                          .sort((a, b) => (byUid[a.uid]?.name || '').localeCompare(byUid[b.uid]?.name || ''))
                          .map((w) => workRow(w, t))
                          .join('')}</tbody></table></div>`
                      : '<p class="ed-muted">Nobody has this task yet.</p>'
                  }
                  <div class="ed-actions"><button type="button" class="ed-btn" data-assign>Assign members</button><button type="button" class="ed-btn" data-edit>Edit</button>
                  <button type="button" class="ed-btn" data-status>${t.status === 'open' ? 'Close task' : 'Reopen'}</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-delete>Delete</button></div>
                </section>`;
              })
              .join('')
          : `<section class="ed-card"><p class="ed-muted">${show === 'open' ? 'No open tasks. Create one to assign work to executives with points and a due date.' : 'No closed tasks.'}</p></section>`
      }`;

    const reload = () => manageTasksView.render(root, app, [show]);
    for (const b of $$('[data-show]', root)) b.addEventListener('click', () => app.navigate('manage-tasks', [b.dataset.show]));
    $('[data-new]', root).addEventListener('click', async () => (await taskDialog(app, null, members, events)) && reload());
    for (const card of $$('[data-task]', root)) {
      const t = tasks.find((x) => x.id === card.dataset.task);
      $('[data-edit]', card).addEventListener('click', async () => (await taskDialog(app, t, [], events)) && reload());
      $('[data-status]', card).addEventListener('click', (e) =>
        busy(e.currentTarget, 'Saving…', async () => {
          await app.cloud.setTaskStatus(t.id, t.status === 'open' ? 'closed' : 'open');
          await reload();
        }),
      );
      $('[data-delete]', card).addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: `Delete “${t.title}”?`,
          body: '<p>The task and everyone’s work on it are deleted, and points already given for it no longer count. To keep the points, close the task instead.</p>',
          confirm: 'Delete',
          danger: true,
        });
        if (ok)
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteTask(t.id);
            toast('Task deleted.');
            await reload();
          });
      });
      $('[data-assign]', card).addEventListener('click', async () => {
        const taken = new Set(work.filter((w) => w.taskId === t.id && w.status !== 'requested').map((w) => w.uid));
        const done = await openDialog(
          `<form class="ed-form"><h2>Assign “${h(t.title)}”</h2><div class="ed-dialog-body">${memberChecks(members, taken)}</div><div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Cancel</button><button class="ed-btn ed-btn-primary">Assign and notify</button></div></form>`,
          (dialog, close) => {
            const picked = wireChecks(dialog);
            onSubmit($('form', dialog), 'Assigning…', async () => {
              if (!picked().length) throw Error('Choose at least one member.');
              await app.cloud.assign(t.id, t.title, picked());
              toast('Assigned and notified.');
              close(true);
            });
          },
          { wide: true },
        );
        if (done) reload();
      });
      for (const tr of $$('tr[data-work]', card)) {
        const w = work.find((x) => x.id === tr.dataset.work);
        const name = byUid[w.uid]?.name || 'this member';
        for (const b of $$('[data-act]', tr))
          b.addEventListener('click', async () => {
            const status = b.dataset.act;
            if (status === 'remove') {
              if (
                await confirmDialog({
                  title: `Remove ${name} from this task?`,
                  body: '<p>Their work and any points for it are deleted.</p>',
                  confirm: 'Remove',
                  danger: true,
                })
              )
                await busy(b, 'Removing…', async () => {
                  await app.cloud.deleteWork(w.id);
                  await reload();
                  app.updateBadges();
                });
              return;
            }
            let values = {};
            if (status === 'approved') {
              const late = daysLate(t.dueAt, w.submittedAt);
              values = await reviewDialog({
                title: `Approve ${name}’s work?`,
                body: `<p>${late ? `Handed in ${plural(late, 'day')} late: ${t.points} points less ${Math.min(100, late * t.penalty)}%.` : `Handed in on time: full ${plural(t.points, 'point')}.`} You can change the points.</p>`,
                points: taskPoints(t, w.submittedAt),
                feedbackLabel: 'Note for the member',
                confirm: 'Approve',
              });
            } else if (status === 'returned' || status === 'declined')
              values = await reviewDialog({
                title: status === 'returned' ? `Return ${name}’s work?` : `Decline ${name}’s request?`,
                body: status === 'returned' ? '<p>They can change it and hand it in again.</p>' : '',
                feedbackLabel: status === 'returned' ? 'What should they change?' : 'Reason',
                confirm: status === 'returned' ? 'Return' : 'Decline',
                danger: true,
              });
            if (!values) return;
            await busy(b, 'Saving…', async () => {
              await app.cloud.reviewWork(w, t, status, values);
              toast('Saved. The member is notified.');
              await reload();
              app.updateBadges();
            });
          });
      }
    }
  },
};

// ------------------------------------------------------------------ contributions

export const contributionsView = {
  id: 'contributions',
  title: 'Contributions',
  icon: '🏷',
  allowed: (a) => a.contributions,
  async render(root, app) {
    loading(root);
    const [settings, mine, events] = await Promise.all([
      app.cloud.settings(),
      app.cloud.myContributions(),
      app.cloud.events().catch(() => []),
    ]);
    const points = mine.filter((c) => c.status === 'approved').reduce((n, c) => n + (c.points || 0), 0);
    root.innerHTML = `
      <section class="ed-card"><h3>Claim a past contribution</h3>
      ${
        settings.claims
          ? `<p class="ed-muted">Tell the board about work you did for the chapter that is not a portal task: an event you organised, a design, a post, a workshop. The President or Secretary checks it and adds points.</p>
          <form class="ed-form" novalidate><div class="ed-grid">
            ${eventSelect(events, 'Event', 'Not an event (describe it below)')}
            ${field({ label: 'What did you do?', name: 'title', attrs: 'required maxlength="160"', hint: 'For example: Designed the event poster.' })}
            ${select({ label: 'Tag', name: 'tag', options: contributionTags.map((t) => [t, t]) })}
            ${field({ label: 'When', name: 'date', type: 'date', attrs: `required max="${todayInBangladesh()}"` })}
            ${field({ label: 'Details', name: 'details', type: 'textarea', optional: true, attrs: 'rows="3" maxlength="2000"', wide: true })}
            ${field({ label: 'Proof or link', name: 'link', type: 'url', optional: true, attrs: 'maxlength="500" placeholder="https://"', wide: true })}
          </div><div class="ed-actions ed-form-actions"><button class="ed-btn ed-btn-primary">Send for review</button></div></form>`
          : '<p class="ed-muted">Claims are closed right now. The board opens them from time to time.</p>'
      }</section>
      <section class="ed-card"><h3>My contributions · ${plural(points, 'point')}</h3>
      ${
        mine.length
          ? `<ul class="ed-list ed-attend">${mine
              .map(
                (c) =>
                  `<li><div class="ed-card-head"><div><strong>${h(c.title)}</strong><small>${eventName(events, c.eventId) ? `${h(eventName(events, c.eventId))} · ` : ''}${h(c.tag)} · ${h(c.date)}${c.status === 'approved' ? ` · ${plural(c.points || 0, 'point')}` : ''}${c.note ? ` · ${h(c.note)}` : ''}</small></div><div>${claimTag(c.status)}${c.status === 'pending' ? ` <button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-delete="${h(c.id)}">Withdraw</button>` : ''}</div></div></li>`,
              )
              .join('')}</ul>`
          : '<p class="ed-muted">No claims yet.</p>'
      }</section>`;
    const reload = () => contributionsView.render(root, app);
    const form = $('form', root);
    if (form)
      onSubmit(form, 'Sending…', async (values) => {
        await app.cloud.claimContribution(values);
        toast('Sent. The President or Secretary will review it.');
        await reload();
      });
    for (const b of $$('[data-delete]', root))
      b.addEventListener('click', () =>
        busy(b, 'Withdrawing…', async () => {
          await app.cloud.deleteContribution(b.dataset.delete);
          await reload();
        }),
      );
  },
};

export const contributionReviewView = {
  id: 'claims',
  title: 'Contribution claims',
  icon: '🏅',
  allowed: (a) => a.reviewContributions && a.board,
  badge: (app) => app.cloud.count('contributions', 'status', 'pending'),
  async render(root, app, [show = 'pending']) {
    loading(root);
    const [settings, claims, members, events] = await Promise.all([
      app.cloud.settings(),
      app.cloud.contributions(),
      app.cloud.members(),
      app.cloud.events().catch(() => []),
    ]);
    const byUid = Object.fromEntries(members.map((m) => [m.uid, m]));
    const shown = claims.filter((c) => c.status === show);
    const canApprove = app.access.approveContributions;
    root.innerHTML = `
      <section class="ed-card"><div class="ed-card-head"><div><h3>Claims are ${settings.claims ? 'open' : 'closed'}</h3><small class="ed-muted">${settings.claims ? 'Active members can send past contributions for points.' : 'Members cannot send new claims.'}</small></div>
        <button type="button" class="ed-btn${settings.claims ? '' : ' ed-btn-primary'}" data-toggle>${settings.claims ? 'Close claims' : 'Open claims'}</button></div>
        ${canApprove ? '' : '<p class="ed-note">Only the President or the Secretary approves claims and gives points.</p>'}</section>
      <div class="ed-tabs" role="group" aria-label="Filter claims">${[
        ['pending', 'Waiting'],
        ['approved', 'Approved'],
        ['rejected', 'Not approved'],
      ]
        .map(
          ([v, text]) =>
            `<button type="button" class="ed-btn${v === show ? ' ed-btn-primary' : ' ed-btn-quiet'}" data-show="${v}" aria-pressed="${v === show}">${text} (${claims.filter((c) => c.status === v).length})</button>`,
        )
        .join('')}</div>
      <section class="ed-card">${
        shown.length
          ? `<ul class="ed-list ed-attend">${shown
              .map((c) => {
                const m = byUid[c.uid];
                const own = c.uid === app.user.uid && !app.owner;
                return `<li data-claim="${h(c.id)}"><div class="ed-card-head"><div><strong>${h(c.title)}</strong><small>${h(m?.name || 'Former member')} · ${eventName(events, c.eventId) ? `${h(eventName(events, c.eventId))} · ` : ''}${h(c.tag)} · ${h(c.date)}${c.status === 'approved' ? ` · ${plural(c.points || 0, 'point')}` : ''}</small></div>${claimTag(c.status)}</div>
                  ${paragraphs(c.details)}${c.link ? `<p>${linkHTML(c.link)}</p>` : ''}${c.note ? `<small>Note: ${h(c.note)}</small>` : ''}
                  ${c.status === 'pending' && canApprove ? (own ? '<small class="ed-muted">Another reviewer decides your own claim.</small>' : '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-primary" data-act="approved">Approve with points</button><button type="button" class="ed-btn ed-btn-danger-quiet" data-act="rejected">Reject</button></div>') : ''}
                  ${app.access.deleteAll ? '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-remove>Delete</button></div>' : ''}</li>`;
              })
              .join('')}</ul>`
          : '<p class="ed-muted">Nothing here.</p>'
      }</section>`;
    const reload = () => contributionReviewView.render(root, app, [show]);
    for (const b of $$('[data-show]', root)) b.addEventListener('click', () => app.navigate('claims', [b.dataset.show]));
    $('[data-toggle]', root).addEventListener('click', (e) =>
      busy(e.currentTarget, 'Saving…', async () => {
        await app.cloud.saveSettings({ ...settings, claims: !settings.claims });
        toast(settings.claims ? 'Claims closed.' : 'Claims opened.');
        await reload();
      }),
    );
    for (const li of $$('[data-claim]', root)) {
      const c = claims.find((x) => x.id === li.dataset.claim);
      $('[data-remove]', li)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        if (
          await confirmDialog({
            title: `Delete “${c.title}”?`,
            body: '<p>Any points it gave are removed too.</p>',
            confirm: 'Delete',
            danger: true,
          })
        )
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteContribution(c.id);
            await reload();
            app.updateBadges();
          });
      });
      for (const b of $$('[data-act]', li))
        b.addEventListener('click', async () => {
          const approve = b.dataset.act === 'approved';
          const values = await reviewDialog({
            title: approve ? `Approve “${c.title}”?` : `Reject “${c.title}”?`,
            body: '',
            points: approve ? 10 : null,
            feedbackLabel: 'Note for the member',
            confirm: approve ? 'Approve' : 'Reject',
            danger: !approve,
          });
          if (!values) return;
          await busy(b, 'Saving…', async () => {
            await app.cloud.reviewContribution(c, b.dataset.act, { points: values.points, note: values.feedback });
            toast('Saved. The member is notified.');
            await reload();
            app.updateBadges();
          });
        });
    }
  },
};

// ------------------------------------------------------------------ notices

export const announcementsView = {
  id: 'notices',
  title: 'Notices',
  icon: '📣',
  allowed: (a) => a.member || a.announce,
  async render(root, app) {
    loading(root);
    const notices = await app.cloud.announcements();
    const can = app.access.announce;
    root.innerHTML = `
      ${
        can
          ? `<section class="ed-card"><h3>Post a notice</h3><p class="ed-muted">Every active member sees notices on their home page.</p><form class="ed-form" novalidate data-new><div class="ed-grid">
        ${field({ label: 'Title', name: 'title', attrs: 'required maxlength="160"', wide: true })}
        ${field({ label: 'Message', name: 'body', type: 'textarea', optional: true, attrs: 'rows="4" maxlength="3000"', wide: true })}
        <label class="ed-check ed-wide"><input type="checkbox" name="pinned"> Pin to the top</label></div>
        <div class="ed-actions ed-form-actions"><button class="ed-btn ed-btn-primary">Post</button></div></form></section>`
          : ''
      }
      ${
        notices.length
          ? notices
              .map(
                (
                  n,
                ) => `<article class="ed-card ed-notice" data-id="${h(n.id)}"><div class="ed-card-head"><div><h3>${n.pinned ? '📌 ' : ''}${h(n.title)}</h3><small class="ed-muted">${h(n.author || 'Board')} · ${h(bdTime(n.createdAt))}</small></div>
                ${can ? `<div class="ed-actions"><button type="button" class="ed-btn ed-btn-small" data-pin>${n.pinned ? 'Unpin' : 'Pin'}</button><button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-delete>Delete</button></div>` : ''}</div>${paragraphs(n.body)}</article>`,
              )
              .join('')
          : '<section class="ed-card"><p class="ed-muted">No notices yet.</p></section>'
      }`;
    const reload = () => announcementsView.render(root, app);
    const form = $('[data-new]', root);
    if (form)
      onSubmit(form, 'Posting…', async (values) => {
        await app.cloud.saveAnnouncement(values, '', app.me?.name || app.user.displayName || 'Board');
        toast('Posted.');
        await reload();
      });
    for (const card of $$('.ed-notice', root)) {
      const n = notices.find((x) => x.id === card.dataset.id);
      $('[data-pin]', card)?.addEventListener('click', (e) =>
        busy(e.currentTarget, 'Saving…', async () => {
          await app.cloud.saveAnnouncement({ ...n, pinned: !n.pinned }, n.id);
          await reload();
        }),
      );
      $('[data-delete]', card)?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        if (await confirmDialog({ title: 'Delete this notice?', confirm: 'Delete', danger: true }))
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteAnnouncement(n.id);
            await reload();
          });
      });
    }
  },
};

// ------------------------------------------------------------------ notifications

/** Where a notification leads: a portal page, or a certificate. */
const notificationHref = (link) => (link.startsWith('cert:') ? certificateURL(link.slice(5), location.origin) : link ? `#${link}` : '');

export const notificationsView = {
  id: 'notifications',
  title: 'Notifications',
  icon: '🔔',
  allowed: (a, app) => !!app.me || a.board,
  badge: (app) => app.cloud.unreadCount(),
  async render(root, app) {
    loading(root);
    const list = await app.cloud.notifications();
    const unread = list.filter((n) => !n.read);
    root.innerHTML = `<section class="ed-card"><div class="ed-card-head"><h3>${unread.length ? `${unread.length} new` : 'All caught up'}</h3>
      ${unread.length ? '<button type="button" class="ed-btn" data-all>Mark all as read</button>' : ''}</div>
      ${
        list.length
          ? `<ul class="ed-list ed-notifications">${list
              .slice(0, 100)
              .map((n) => {
                const href = notificationHref(n.link);
                return `<li data-id="${h(n.id)}" class="${n.read ? '' : 'ed-unread'}"><div class="ed-card-head"><div>${href ? `<a href="${h(href)}" data-open>${h(n.title)}</a>` : `<strong>${h(n.title)}</strong>`}<small>${h(n.body)}</small><small class="ed-muted">${h(bdTime(n.createdAt))}</small></div>
                <button type="button" class="ed-icon-btn" data-delete aria-label="Delete notification">×</button></div></li>`;
              })
              .join('')}</ul>`
          : '<p class="ed-muted">Task assignments, reviews and awards appear here.</p>'
      }</section>`;
    const reload = async () => {
      await notificationsView.render(root, app);
      app.updateBadges();
    };
    $('[data-all]', root)?.addEventListener('click', (e) =>
      busy(e.currentTarget, 'Saving…', async () => {
        await app.cloud.markRead(unread.map((n) => n.id));
        await reload();
      }),
    );
    for (const li of $$('li[data-id]', root)) {
      const n = list.find((x) => x.id === li.dataset.id);
      $('[data-open]', li)?.addEventListener('click', () => {
        if (!n.read) app.cloud.markRead([n.id]).then(() => app.updateBadges());
      });
      $('[data-delete]', li).addEventListener('click', (e) =>
        busy(e.currentTarget, '…', async () => {
          await app.cloud.deleteNotification(n.id);
          await reload();
        }),
      );
    }
  },
};

// ------------------------------------------------------------------ Executive Member of the Month

export const awardView = {
  id: 'award',
  title: 'Member of the Month',
  icon: '🎖',
  allowed: (a) => a.award,
  async render(root, app) {
    loading(root);
    const [awards, members] = await Promise.all([app.cloud.awards(), activeMembers(app)]);
    const execs = members.filter((m) => m.designation || m.role !== 'member');
    const given = new Set(awards.map((a) => a.month));
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = monthKey(d);
      if (!given.has(key)) months.push([key, monthLabel(key)]);
    }
    root.innerHTML = `
      <section class="ed-card"><h3>Name the Executive Member of the Month</h3>
        <p class="ed-muted">Only the President can do this. The member gets a verifiable Executive Member of the Month certificate, and every member sees the award on their home page. Deleting an award also deletes its certificate.</p>
        ${
          months.length && execs.length
            ? `<form class="ed-form" novalidate><div class="ed-grid">
            ${select({ label: 'Month', name: 'month', options: months })}
            ${select({ label: 'Executive member', name: 'uid', options: [['', 'Choose…'], ...execs.map((m) => [m.uid, memberLabel(m)])] })}
            ${field({ label: 'Reason (printed on the certificate)', name: 'reason', optional: true, attrs: 'maxlength="220"', wide: true, hint: 'For example: for leading the outreach campaign at local schools.' })}
          </div><div class="ed-actions ed-form-actions"><button class="ed-btn ed-btn-primary">Give the award</button></div></form>`
            : `<p class="ed-muted">${execs.length ? 'Every recent month already has an award.' : 'No active executive members yet.'}</p>`
        }</section>
      <section class="ed-card"><h3>Past awards</h3>${
        awards.length
          ? `<ul class="ed-list">${awards
              .map(
                (
                  a,
                ) => `<li data-month="${h(a.month)}"><div class="ed-card-head"><div><span>🎖 <strong>${h(monthLabel(a.month))}</strong> · ${h(a.name)}${a.designation ? `, ${h(a.designation)}` : ''}</span><small>${a.reason ? `${h(a.reason)} · ` : ''}<a href="${h(certificateURL(a.certId, location.origin))}" target="_blank" rel="noopener">Certificate ${h(a.certId)}</a></small></div>
              <button type="button" class="ed-btn ed-btn-small ed-btn-danger-quiet" data-delete>Delete</button></div></li>`,
              )
              .join('')}</ul>`
          : '<p class="ed-muted">None yet.</p>'
      }</section>`;
    const form = $('form', root);
    if (form)
      onSubmit(form, 'Issuing…', async (values) => {
        const m = execs.find((x) => x.uid === values.uid);
        if (!m) throw Error('Choose the executive member.');
        const ok = await confirmDialog({
          title: `Name ${m.name} for ${monthLabel(values.month)}?`,
          body: '<p>This issues their certificate and tells every member.</p>',
          confirm: 'Give the award',
        });
        if (!ok) return;
        await app.cloud.giveAward(values.month, m, values.reason);
        toast(`${m.name} is the Executive Member of the Month.`);
        await awardView.render(root, app);
      });
    for (const li of $$('li[data-month]', root)) {
      const a = awards.find((x) => x.month === li.dataset.month);
      $('[data-delete]', li).addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const ok = await confirmDialog({
          title: `Delete the award for ${monthLabel(a.month)}?`,
          body: `<p>${h(a.name)}’s certificate ${h(a.certId)} is deleted too and no longer verifies. You can then name someone for that month again.</p>`,
          confirm: 'Delete',
          danger: true,
        });
        if (ok)
          await busy(button, 'Deleting…', async () => {
            await app.cloud.deleteAward(a);
            toast('Award deleted.');
            await awardView.render(root, app);
          });
      });
    }
  },
};
