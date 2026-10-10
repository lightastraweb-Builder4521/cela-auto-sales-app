/* ==========================================================================
   Authenticated app shell: sidebar, top bar, auth gate, storage check,
   navigation guard for unsaved changes. Every signed-in page starts with:

     const { user } = await initLayout({ page: 'inventory' });
   ========================================================================== */
import { APP, DEALERSHIP } from '../config.js';
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { getPref, setPref } from '../utils/misc.js';
import { authService, ROLE_LABELS } from '../services/auth-service.js';
import { getRepository } from '../data/repository.js';
import { vehicleService } from '../services/vehicle-service.js';
import { computeDashboardStats } from '../services/stats-service.js';
import { billingService } from '../services/billing-service.js';
import { lightAstraService } from '../services/light-astra-service.js';
import { formatLongDate } from '../utils/format.js';
import { openMenu } from './menu.js';
import { confirmDialog } from './dialogs.js';
import { showFlash } from './toast.js';

const NAV = [
  { page: 'dashboard', href: 'dashboard.html', label: 'Dashboard', icon: 'dashboard' },
  { page: 'inventory', href: 'inventory.html', label: 'Inventory', icon: 'car', count: 'totalInventory' },
  { page: 'add', href: 'add-vehicle.html', label: 'Add Vehicle', icon: 'plus' },
  { page: 'sold', href: 'sold.html', label: 'Sold', icon: 'sold', count: 'soldTotal' },
  { page: 'archived', href: 'archived.html', label: 'Archived', icon: 'archive', count: 'archived' },
  { page: 'activity', href: 'activity.html', label: 'Activity', icon: 'activity' },
  { page: 'billing', href: 'billing.html', label: 'Billing', icon: 'card' },
  { page: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings' }
];

// Pages that belong under a nav item
const NAV_PARENT = { vehicle: 'inventory', edit: 'inventory', onboarding: 'billing' };

// Pages an Admin can always open while the Light Astra service is being set up
// (agreement, payment, support, own account, sign out).
const SETUP_PAGES = new Set(['onboarding', 'billing', 'settings']);

let leaveGuard = null;

/** fn() → true when there are unsaved changes. Pass null to clear. */
export function setLeaveGuard(fn) {
  leaveGuard = fn;
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4f4f5' : '#0b0b0b');
}

function renderSidebar(sidebar, page, user) {
  const current = NAV_PARENT[page] || page;
  // Billing is for Admins only (the database also returns billing details to Admins only).
  const items = NAV.filter((item) => item.page !== 'billing' || authService.can('billing.manage'));
  setHtml(sidebar, html`
    <div class="sidebar__brand">
      <a href="dashboard.html" class="sidebar__logo">
        <img src="images/cela-logo.png" width="632" height="313" alt="Cela Auto Sales">
      </a>
      <span class="sidebar__app">Inventory Manager</span>
      <button type="button" class="icon-btn sidebar__close" data-sidebar-close aria-label="Close navigation">${icon('x')}</button>
    </div>
    <nav class="sidebar__nav" aria-label="Main">
      <ul>
        ${items.map((item) => html`
          <li>
            <a href="${item.href}" class="nav-link" ${item.page === current ? html`aria-current="page"` : ''}>
              ${icon(item.icon)}<span>${item.label}</span>
              ${item.count ? html`<span class="nav-link__count" data-nav-count="${item.count}"></span>` : ''}
            </a>
          </li>`)}
      </ul>
    </nav>
    <div class="sidebar__footer">
      <p class="sidebar__company">${DEALERSHIP.name}</p>
      <div class="sidebar__user">
        <span class="avatar" aria-hidden="true">${initials(user.displayName)}</span>
        <span class="sidebar__user-text">
          <strong>${user.displayName}</strong>
          <small>${ROLE_LABELS[user.role]}${authService.mode === 'development' ? ' · Development login' : ''}</small>
        </span>
      </div>
      <button type="button" class="btn btn--ghost btn--block sidebar__logout" data-logout>${icon('logout')}Log Out</button>
    </div>`);
}

function renderTopbar(topbar, page, user) {
  setHtml(topbar, html`
    <div class="topbar__inner">
      <button type="button" class="icon-btn topbar__menu" data-sidebar-toggle aria-controls="sidebar" aria-expanded="false" aria-label="Open navigation">${icon('menu')}</button>
      <a class="topbar__brand" href="dashboard.html"><img src="images/cela-logo.png" width="632" height="313" alt="Cela Inventory Manager — Dashboard"></a>
      ${page === 'inventory' ? html`<div class="topbar__spacer"></div>` : html`
        <form class="topbar__search" role="search" action="inventory.html" method="get">
          <label class="visually-hidden" for="global-search">Search inventory</label>
          ${icon('search')}
          <input class="input" type="search" id="global-search" name="q" placeholder="Search year, make, model, VIN, stock #" autocomplete="off" enterkeyhint="search">
        </form>
        <a class="icon-btn topbar__search-btn" href="inventory.html?focus=search" aria-label="Search inventory">${icon('search')}</a>`}
      <div class="topbar__actions">
        ${APP.environment === 'development' ? html`
          <a class="dev-pill" href="settings.html#system" title="Backend not connected — data is stored in this browser only">
            ${icon('flask')}<span>Development</span>
          </a>` : ''}
        ${page !== 'add' ? html`<a class="btn btn--primary topbar__add" href="add-vehicle.html" aria-label="Add Vehicle">${icon('plus')}<span aria-hidden="true">Add Vehicle</span></a>` : ''}
        <button type="button" class="user-btn" data-user-menu aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for ${user.displayName}">
          <span class="avatar" aria-hidden="true">${initials(user.displayName)}</span>
          <span class="user-btn__name">${user.displayName}</span>
          ${icon('chevronDown')}
        </button>
      </div>
    </div>`);
}

function initSidebarDrawer() {
  const sidebar = qs('[data-sidebar]');
  const backdrop = qs('[data-sidebar-backdrop]');
  const toggle = qs('[data-sidebar-toggle]');
  const main = qs('.app__main');
  const mobile = window.matchMedia('(max-width: 1023px)');
  if (!sidebar || !toggle) return;

  const isOpen = () => sidebar.classList.contains('is-open');
  const open = () => {
    sidebar.classList.add('is-open');
    if (backdrop) backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (main) main.inert = true;
    document.body.classList.add('is-locked');
    // Focus after the drawer has become visible (hidden elements can't take focus).
    window.requestAnimationFrame(() => {
      const current = sidebar.querySelector('[aria-current="page"]') || sidebar.querySelector('a');
      if (current) current.focus();
    });
  };
  const close = (returnFocus = true) => {
    if (!isOpen()) return;
    sidebar.classList.remove('is-open');
    if (backdrop) backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (main) main.inert = false;
    document.body.classList.remove('is-locked');
    if (returnFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  if (backdrop) backdrop.addEventListener('click', () => close());
  sidebar.addEventListener('click', (event) => { if (event.target.closest('[data-sidebar-close]')) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && isOpen()) close(); });
  const onChange = () => { if (!mobile.matches) close(false); };
  if (mobile.addEventListener) mobile.addEventListener('change', onChange);
}

async function signOut() {
  await authService.signOut();
  window.location.href = 'login.html';
}

function initUserMenu(user) {
  const button = qs('[data-user-menu]');
  if (!button) return;
  button.addEventListener('click', () => {
    const theme = getPref('theme', 'dark');
    openMenu(button, [
      { label: user.displayName, hint: authService.mode === 'development' ? `${ROLE_LABELS[user.role]} · development login (not secure)` : `${ROLE_LABELS[user.role]} · ${user.email}`, icon: 'user', onSelect: () => { window.location.href = 'settings.html#account'; } },
      { separator: true },
      {
        label: theme === 'light' ? 'Use dark theme' : 'Use light theme',
        hint: 'Light is easier to read outdoors',
        icon: theme === 'light' ? 'moon' : 'sun',
        onSelect: () => {
          const next = theme === 'light' ? 'dark' : 'light';
          setPref('theme', next);
          applyTheme(next);
        }
      },
      { label: 'Settings', icon: 'settings', onSelect: () => navigate('settings.html') },
      { separator: true },
      { label: 'Log out', icon: 'logout', onSelect: () => guardedSignOut() }
    ], { label: 'Account' });
  });
}

async function confirmLeave() {
  if (!leaveGuard || !leaveGuard()) return true;
  return confirmDialog({
    title: 'Leave without saving?',
    message: 'You have unsaved changes to this vehicle. If you leave now, they will be lost.',
    confirmLabel: 'Leave without saving',
    cancelLabel: 'Keep editing',
    tone: 'danger'
  });
}

async function navigate(href) {
  if (await confirmLeave()) {
    leaveGuard = null;
    window.location.href = href;
  }
}

async function guardedSignOut() {
  if (await confirmLeave()) {
    leaveGuard = null;
    await signOut();
  }
}

function initNavigationGuard() {
  document.addEventListener('click', (event) => {
    if (!leaveGuard || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
    if (!leaveGuard()) return;
    event.preventDefault();
    navigate(link.href);
  }, true);

  window.addEventListener('beforeunload', (event) => {
    if (leaveGuard && leaveGuard()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-logout]')) guardedSignOut();
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!form.matches('.topbar__search') || !leaveGuard || !leaveGuard()) return;
    event.preventDefault();
    const q = new FormData(form).get('q') || '';
    navigate(`inventory.html?q=${encodeURIComponent(q)}`);
  });
}

/* Live updates (Supabase only): when another employee changes inventory, pages
   that listen for "cela:data-changed" refresh themselves. The editor does not
   listen, so typing is never interrupted. */
function startLiveUpdates() {
  const repo = getRepository();
  if (typeof repo.subscribe !== 'function') return;
  let timer = null;
  repo.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      refreshNavCounts();
      window.dispatchEvent(new CustomEvent('cela:data-changed'));
    }, 400);
  });
}

/** Refresh the sidebar count badges (call after actions that change status). */
export async function refreshNavCounts(vehicles) {
  try {
    const list = vehicles || await vehicleService.getVehicles();
    const stats = computeDashboardStats(list);
    document.querySelectorAll('[data-nav-count]').forEach((el) => {
      const value = stats[el.dataset.navCount];
      el.textContent = value ? String(value) : '';
    });
  } catch (err) { /* counts are decorative */ }
}

/* Billing banner on every signed-in page (not on the Billing page, which explains in full).
   Information only: the database decides what can be published. */
async function renderBillingBanner(page, service) {
  if (page === 'billing' || page === 'onboarding' || !billingService.enabled) return;
  const settingUp = Boolean(service) && (service.onboardingRequired || service.service === 'PENDING_ACTIVATION');
  if (!authService.can('billing.manage')) {
    // Employees see no billing details, only whether publishing is paused.
    if (!(await billingService.publishingBlocked())) return;
    const topbar = qs('[data-topbar]');
    if (!topbar || qs('[data-billing-banner]')) return;
    const banner = document.createElement('div');
    banner.className = 'billing-banner billing-banner--danger';
    banner.setAttribute('data-billing-banner', '');
    banner.setAttribute('role', 'status');
    setHtml(banner, settingUp
      ? html`${icon('lock')}<p><strong>Service setup is not complete.</strong> An Admin needs to finish the Light Astra agreement and payment. Publishing, scheduled publications and new photo uploads start once the service is active. Inventory, photos and history are safe.</p>`
      : html`${icon('lock')}<p><strong>Publishing is paused.</strong> New listings, scheduled publications, public changes and new photo uploads are on hold until an Admin resolves the managed service. Inventory, photos and history are safe; private details stay editable, and vehicles can still be marked sold, unpublished or archived.</p>`);
    topbar.insertAdjacentElement('afterend', banner);
    return;
  }
  // Admin: the agreement or Light Astra's release can hold the service even when billing is fine.
  if (service && service.service !== 'ACTIVE' && (service.onboardingRequired || (service.payment === 'PAID' && service.waitingFor.length))) {
    const topbar = qs('[data-topbar]');
    if (!topbar || qs('[data-billing-banner]')) return;
    const banner = document.createElement('div');
    banner.className = 'billing-banner billing-banner--danger';
    banner.setAttribute('data-billing-banner', '');
    banner.setAttribute('data-service-banner', service.onboardingRequired ? 'agreement' : 'waiting');
    banner.setAttribute('role', 'status');
    setHtml(banner, service.onboardingRequired
      ? html`${icon('lock')}<p><strong>Agreement Required.</strong> Review and sign the Light Astra Managed App Service Agreement to activate the service. Publishing, scheduled publications and new photo uploads wait until then. <a href="onboarding.html">Review Agreement</a></p>`
      : html`${icon('clock')}<p><strong>The service is not active yet.</strong> ${service.waitingFor.includes('PLAN') ? 'The current subscription is not for the contracted plan; please contact Light Astra Support.' : 'Light Astra is completing the final release checks; it starts automatically.'} <a href="onboarding.html">Service status</a></p>`);
    topbar.insertAdjacentElement('afterend', banner);
    return;
  }
  let status = null;
  try { status = await billingService.getStatus(); } catch (err) { return; } // decorative; never blocks the page
  if (!status) return;
  const warn = status.publishingAvailable && (status.state === 'past_due' || status.state === 'canceled');
  if (status.publishingAvailable && !warn) return;
  const topbar = qs('[data-topbar]');
  if (!topbar || qs('[data-billing-banner]')) return;
  const banner = document.createElement('div');
  banner.className = `billing-banner billing-banner--${warn ? 'warn' : 'danger'}`;
  banner.setAttribute('data-billing-banner', '');
  banner.setAttribute('role', 'status');
  const reason = { canceled: 'is canceled', setup_required: 'has not been set up', setup_incomplete: 'payment is not complete' }[status.state] || 'is inactive';
  setHtml(banner, warn
    ? html`${icon('alert')}<p><strong>Payment problem.</strong> ${status.state === 'canceled' ? 'The managed-service subscription ended after a failed payment.' : 'The last managed-service payment didn’t go through.'} Publishing stays available until ${formatLongDate(status.gracePeriodEnd)}. <a href="billing.html">Open Billing</a></p>`
    : html`${icon('lock')}<p><strong>Publishing is paused.</strong> The managed service subscription ${reason}. Scheduled publications and new photo uploads wait until it is active again. Inventory, photos and history are safe; private details stay editable, and vehicles can still be marked sold, unpublished or archived. <a href="billing.html">Open Billing</a></p>`);
  topbar.insertAdjacentElement('afterend', banner);
}

function renderStorageError(err) {
  const main = qs('#main');
  const local = APP.backend === 'local';
  setHtml(main, html`
    <div class="page__inner">
      <section class="empty-state empty-state--error" role="alert">
        <span class="empty-state__icon">${icon('database')}</span>
        <h1>${local ? 'Local storage isn’t available' : 'Can’t reach the inventory database'}</h1>
        <p>${err && err.message ? err.message : local ? 'This browser blocked local storage.' : 'The connection failed.'}</p>
        <p class="muted">${local
          ? 'In local development mode, vehicles are stored in this browser. Private-browsing windows and strict storage settings can block this. Try a normal Safari or Chrome window, then reload.'
          : 'Check your internet connection, then reload. Nothing has been lost — your data is stored safely online.'}</p>
        <div class="btn-row btn-row--center">
          <button type="button" class="btn btn--primary" onclick="window.location.reload()">${icon('restore')}Reload</button>
        </div>
      </section>
    </div>`);
}

/**
 * Gate + shell for every signed-in page.
 * Resolves with { user } once the session and local storage are confirmed.
 */
export async function initLayout({ page, title }) {
  applyTheme(getPref('theme', 'dark'));
  let session = null;
  try {
    session = await authService.init(); // restores the saved sign-in and loads the employee's role
  } catch (err) {
    document.documentElement.classList.remove('is-booting');
    qs('[data-sidebar]').hidden = true;
    renderStorageError(err);
    throw Object.assign(err, { name: 'StorageUnavailableError' });
  }
  if (!session) {
    const next = window.location.pathname.split('/').pop() + window.location.search;
    window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
    return new Promise(() => {}); // page never continues
  }
  const user = session.user;
  if (title) document.title = `${title} | ${APP.name}`;

  // Light Astra onboarding gate (shared backend only). First-time setup only: while the service has
  // never been active and something is still the Admin's to do (sign, acknowledge, pay), an Admin is
  // taken to the service page; Billing and Settings stay reachable. Once the service has been active,
  // nothing redirects (a banner explains what is needed), so an Admin can always mark vehicles Sold,
  // unpublish or archive. Information only: the database decides what works. A failed or slow lookup
  // never blocks the app.
  const service = await Promise.race([
    lightAstraService.getOverview().catch(() => null),
    new Promise((resolve) => { window.setTimeout(() => resolve(null), 4000); })
  ]);
  const adminToDo = service ? service.waitingFor.some((item) => item === 'AGREEMENT' || item === 'POLICY' || item === 'PAYMENT') : false;
  if (service && authService.can('billing.manage') && service.service === 'PENDING_ACTIVATION' && adminToDo && !SETUP_PAGES.has(page)) {
    window.location.replace('onboarding.html');
    return new Promise(() => {}); // page never continues
  }

  renderSidebar(qs('[data-sidebar]'), page, user);
  renderTopbar(qs('[data-topbar]'), page, user);
  initSidebarDrawer();
  initUserMenu(user);
  initNavigationGuard();
  document.documentElement.classList.remove('is-booting');

  try {
    await getRepository().ready();
  } catch (err) {
    renderStorageError(err);
    throw Object.assign(err, { name: 'StorageUnavailableError' });
  }
  refreshNavCounts();
  renderBillingBanner(page, service);
  showFlash();
  startLiveUpdates();
  // Session ended elsewhere (expired, or signed out in another tab) → back to login.
  authService.onSignedOut(() => { leaveGuard = null; window.location.replace('login.html'); });
  return { user };
}

/** Render a page-level "not found" / error message in <main>. */
export function renderPageMessage({ title, message, actions = '' , iconName = 'alert' }) {
  setHtml(qs('#main'), html`
    <div class="page__inner">
      <section class="empty-state">
        <span class="empty-state__icon">${icon(iconName)}</span>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="btn-row btn-row--center">${actions}</div>
      </section>
    </div>`);
}

/** Last-resort handler for page initialization/render failures. */
export function handlePageError(err) {
  if (err && err.name === 'StorageUnavailableError') return; // already shown by initLayout
  console.error(err);
  renderPageMessage({
    title: 'Something went wrong',
    message: 'This page couldn’t load. Reload to try again. If it keeps happening, the local development data may be damaged — Settings has tools to reset it.',
    actions: html`<a class="btn btn--primary" href="${window.location.href}">${icon('restore')}Reload</a><a class="btn btn--ghost" href="settings.html">Open Settings</a>`
  });
}
