// Member Portal: sign-in, the member's profile claim and navigation. Separate from the Chapter Editor,
// but signed in with the same Google account.
import { connect, SUPER_ADMIN_EMAIL } from '../admin/connect.js';
import { createPortalStore } from './store.js';
import { $, h, busy, errorMessage } from '../admin/ui.js';
import { portalAccess, portalRoles } from '../lib/portal-model.js';
import { homeView, attendView, leaderboardView } from './views/member.js';
import { membersView, reviewView, rankingsView, attendanceSetupView } from './views/board.js';
import { autoSort, autoSortSelects } from '../lib/sort-list.js';
import {
  tasksView,
  contributionsView,
  announcementsView,
  notificationsView,
  manageTasksView,
  contributionReviewView,
  awardView,
} from './views/work.js';

// Member pages first, then the board's tools (shown under a heading).
const views = [homeView, notificationsView, tasksView, contributionsView, announcementsView, leaderboardView, attendView];
const boardViews = [membersView, attendanceSetupView, reviewView, manageTasksView, contributionReviewView, rankingsView, awardView];
const allViews = [...views, ...boardViews];

const app = {
  config: null,
  cloud: null,
  user: null,
  me: null,
  // The site owner's account counts as board, so the portal can be recovered; Chapter Editor roles do not.
  owner: false,
  access: portalAccess(null),
  route: { view: 'home', params: [] },
};
window.memberPortal = app;

app.navigate = (view, params = []) => {
  const target = '#' + [view, ...params].map(encodeURIComponent).join('/');
  if (location.hash !== target) history.pushState(null, '', target);
  route();
};

/** Reloads the member's own profile (after a claim or an approval) and redraws. */
app.refresh = async () => {
  app.me = await app.cloud.me();
  app.access = portalAccess(app.me, app.owner);
  render();
};

function route() {
  const [view = 'home', ...params] = location.hash.slice(1).split('/').map(decodeURIComponent);
  app.route = { view, params };
  render();
  $('#ed-main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

const navItem = (v, current) =>
  `<a href="#${v.id}" class="ed-nav-item"${v === current ? ' aria-current="page"' : ''}><span class="ed-nav-icon" aria-hidden="true">${v.icon}</span><span>${h(v.title)}</span>${
    app.badges[v.id] ? `<span class="ed-badge">${app.badges[v.id]}</span>` : ''
  }</a>`;

function renderNav(current) {
  const shown = (list) => list.filter((v) => !v.hidden && v.allowed(app.access, app));
  const board = shown(boardViews);
  $('#ed-nav').innerHTML =
    shown(views)
      .map((v) => navItem(v, current))
      .join('') + (board.length ? `<div class="ed-nav-heading">Manage</div>${board.map((v) => navItem(v, current)).join('')}` : '');
}

/** Refreshes the counters in the menu (unread notifications, things waiting for review). */
app.badges = {};
app.updateBadges = async () => {
  const list = allViews.filter((v) => v.badge && v.allowed(app.access, app));
  const counts = await Promise.all(list.map((v) => Promise.resolve(v.badge(app)).catch(() => 0)));
  app.badges = Object.fromEntries(list.map((v, i) => [v.id, counts[i]]));
  renderNav(app.currentView);
};

function render() {
  if (!app.user) return;
  const allowed = allViews.filter((v) => v.allowed(app.access, app));
  const view = allowed.find((v) => v.id === app.route.view) || homeView;
  app.currentView = view;
  renderNav(view);
  $('#ed-view-title').textContent = view.title;
  const label =
    app.me?.status === 'active' ? app.me.designation || portalRoles[app.me.role] : app.me ? 'Waiting for approval' : 'Not linked yet';
  $('#ed-user').innerHTML =
    `<strong>${h(app.me?.name || app.user.displayName || app.user.email)}</strong><span>${h(app.user.email)}</span><span class="ed-role">${h(label)}</span>`;
  const main = document.createElement('div');
  main.className = 'ed-stack';
  $('#ed-view').replaceChildren(main);
  Promise.resolve(view.render(main, app, app.route.params)).catch((error) => {
    console.error(error);
    main.innerHTML = `<div class="ed-card"><p class="ed-error-text">${h(errorMessage(error))}</p></div>`;
  });
}

function showSignedOut(message = '') {
  app.user = null;
  $('#ed-signin').hidden = false;
  $('#ed-shell').hidden = true;
  $('#ed-signin-status').textContent = message;
}

async function activate(user) {
  app.user = user;
  $('#ed-signin-status').textContent = 'Loading your profile…';
  try {
    app.me = await app.cloud.me();
    app.owner = user.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  } catch (error) {
    if (error?.code !== 'permission-denied') throw error;
    $('#ed-signin-status').textContent =
      'The portal is not switched on yet: the website’s security rules need an update. Ask the site owner to publish them.';
    return;
  }
  app.access = portalAccess(app.me, app.owner);
  $('#ed-signin').hidden = true;
  $('#ed-shell').hidden = false;
  route();
  app.updateBadges();
}

async function start() {
  try {
    app.config = await fetch('data/site-config.json', { cache: 'no-cache' }).then((r) => r.json());
    app.cloud = connect(app.config, createPortalStore);
    if (app.cloud.testSignIn) app.testSignIn = async (email) => activate(await app.cloud.testSignIn(email));
    const user = await app.cloud.currentUser();
    if (user) await activate(user);
    else showSignedOut();
  } catch (error) {
    showSignedOut(errorMessage(error));
  }
}

$('#ed-sign-in').addEventListener('click', (e) =>
  busy(e.currentTarget, 'Opening Google sign-in…', async () => activate(await app.cloud.signIn())),
);
$('#ed-sign-out').addEventListener('click', async () => {
  await app.cloud.signOut();
  showSignedOut('You are signed out.');
});
$('#ed-nav-toggle').addEventListener('click', () => {
  const open = $('#ed-shell').classList.toggle('ed-nav-open');
  $('#ed-nav-toggle').setAttribute('aria-expanded', String(open));
});
$('#ed-nav').addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    $('#ed-shell').classList.remove('ed-nav-open');
    $('#ed-nav-toggle').setAttribute('aria-expanded', 'false');
  }
});
window.addEventListener('popstate', route);
// Counters stay fresh while the portal is open.
setInterval(() => app.user && !document.hidden && app.updateBadges(), 120000);
window.addEventListener('hashchange', route);

start();

// Every growing list gets a Sort dropdown.
autoSort(document.body, '#ed-view ul.ed-list, #ed-view ul.ed-items, #ed-view tbody', { barClass: 'ed-sort', labelClass: 'ed-label' });
autoSortSelects(document.body, 'ed-sort-inline');
