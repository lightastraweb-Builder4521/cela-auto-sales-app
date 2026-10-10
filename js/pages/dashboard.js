/* Dashboard: summary cards, quick actions, recent activity, needs attention. */
import { APP } from '../config.js';
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatCurrency, formatLongDate, formatNumber } from '../utils/format.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { vehicleService } from '../services/vehicle-service.js';
import { activityService } from '../services/activity-service.js';
import { photoService } from '../services/photo-service.js';
import { authService } from '../services/auth-service.js';
import { computeDashboardStats, findNeedsAttention } from '../services/stats-service.js';
import { activityList } from '../ui/activity-list.js';
import { emptyState } from '../ui/vehicle-list.js';
import { toast, toastError } from '../ui/toast.js';

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function statCard({ label, value, href, sub = '', tone = '', iconName }) {
  return html`
    <a class="stat${tone ? ` stat--${tone}` : ''}" href="${href}">
      <span class="stat__top"><span class="stat__label">${label}</span>${icon(iconName)}</span>
      <span class="stat__value">${formatNumber(value, '0')}</span>
      <span class="stat__sub">${sub}</span>
    </a>`;
}

async function loadDemo(button) {
  const { loadDemoData } = await import('../dev/seed-demo-data.js');
  button.disabled = true;
  const original = button.innerHTML;
  try {
    await loadDemoData({ onProgress: (done, total) => { button.textContent = `Loading demo data… ${done}/${total}`; } });
    toast('Demo data loaded. It’s marked “Demo” and never goes to the public site.');
    render();
  } catch (err) {
    toastError(`Demo data couldn’t be loaded: ${err.message}`);
    button.disabled = false;
    button.innerHTML = original;
  }
}

async function render() {
  const main = qs('#main');
  const [vehicles, recent, coverIndex] = await Promise.all([
    vehicleService.getVehicles(),
    activityService.getRecent(10),
    photoService.getCoverIndex()
  ]);
  const user = authService.getCurrentUser();
  const stats = computeDashboardStats(vehicles);
  const attention = findNeedsAttention(vehicles, coverIndex);
  const existingIds = new Set(vehicles.map((v) => v.id));
  const devTools = APP.environment === 'development' && authService.can('data.manage');

  setHtml(main, html`
    <div class="page__inner">
      <header class="page-header">
        <div>
          <p class="page-header__eyebrow">${formatLongDate(new Date())}</p>
          <h1>${greeting()}, ${user.displayName}</h1>
          <p class="page-header__sub">Here’s what’s happening with Cela Auto Sales inventory.</p>
        </div>
      </header>

      <nav class="quick-actions" aria-label="Quick actions">
        <a class="quick-action quick-action--primary" href="add-vehicle.html">${icon('plus')}<span>Add Vehicle</span></a>
        <a class="quick-action" href="inventory.html">${icon('car')}<span>View Inventory</span></a>
        <a class="quick-action" href="sold.html">${icon('sold')}<span>Sold Vehicles</span></a>
        <a class="quick-action" href="inventory.html?status=DRAFT">${icon('edit')}<span>Draft Vehicles</span></a>
      </nav>

      ${!vehicles.length ? html`
        ${emptyState({
          title: 'No vehicles yet.',
          text: 'Add your first vehicle to start building your inventory. Nothing appears on the public site until you publish it.',
          actions: html`
            <a class="btn btn--primary btn--lg" href="add-vehicle.html">${icon('plus')}Add Your First Vehicle</a>
            ${devTools ? html`<button type="button" class="btn btn--ghost btn--lg" data-load-demo>${icon('flask')}Load Demo Data</button>` : ''}`
        })}` : html`
        <section aria-labelledby="stats-title">
          <h2 class="visually-hidden" id="stats-title">Inventory summary</h2>
          <div class="stats">
            ${statCard({ label: 'Total inventory', value: stats.totalInventory, href: 'inventory.html', iconName: 'car', sub: `${stats.addedThisMonth} added this month` })}
            ${statCard({ label: 'Available', value: stats.available, href: 'inventory.html?status=AVAILABLE', iconName: 'checkCircle', tone: 'available', sub: 'For sale now' })}
            ${statCard({ label: 'Pending', value: stats.pending, href: 'inventory.html?status=PENDING', iconName: 'pending', tone: 'pending', sub: 'Sale in progress' })}
            ${statCard({ label: 'Sold this month', value: stats.soldThisMonth, href: 'sold.html?period=month', iconName: 'sold', tone: 'sold', sub: `${stats.soldTotal} sold in total` })}
            ${statCard({ label: 'Drafts', value: stats.drafts, href: 'inventory.html?status=DRAFT', iconName: 'edit', tone: 'draft', sub: 'Not ready yet' })}
            ${statCard({ label: 'Archived', value: stats.archived, href: 'archived.html', iconName: 'archive', sub: 'Hidden, kept for records' })}
            ${statCard({ label: 'Published', value: stats.published, href: 'inventory.html?published=yes', iconName: 'globe', sub: 'Active & on the public site' })}
            ${statCard({ label: 'Not published', value: stats.unpublished, href: 'inventory.html?published=no', iconName: 'eyeOff', sub: 'Active, hidden from customers' })}
          </div>
        </section>

        <div class="dash-grid">
          <section class="panel" aria-labelledby="recent-title">
            <header class="panel__header">
              <h2 id="recent-title">Recent activity</h2>
              <a class="link" href="activity.html">View all</a>
            </header>
            ${recent.length ? activityList(recent, { existingIds }) : html`<p class="panel__empty">No activity recorded yet.</p>`}
          </section>

          <div class="dash-side">
            <section class="panel" aria-labelledby="attention-title">
              <header class="panel__header"><h2 id="attention-title">Needs attention</h2></header>
              ${attention.length ? html`
                <ul class="attention">
                  ${attention.map((item) => html`
                    <li>
                      <a href="${item.reason.startsWith('Missing') ? `edit-vehicle.html?id=${encodeURIComponent(item.vehicle.id)}` : `vehicle.html?id=${encodeURIComponent(item.vehicle.id)}`}">
                        <strong>${item.title}</strong>
                        <span>${item.reason}</span>
                      </a>
                    </li>`)}
                </ul>` : html`<p class="panel__empty">${icon('checkCircle')} Everything active is ready and published.</p>`}
            </section>

            <section class="panel" aria-labelledby="glance-title">
              <header class="panel__header"><h2 id="glance-title">At a glance</h2></header>
              <dl class="glance">
                <div><dt>Asking value (available + pending)</dt><dd>${formatCurrency(stats.askingValue, '$0')}</dd></div>
                <div><dt>Visible on the public site now</dt><dd>${formatNumber(stats.publicVisible, '0')}</dd></div>
                <div><dt>Updated in the last 7 days</dt><dd>${formatNumber(stats.updatedThisWeek, '0')}</dd></div>
              </dl>
            </section>
          </div>
        </div>`}
    </div>`);

  const demoButton = qs('[data-load-demo]', main);
  if (demoButton) demoButton.addEventListener('click', () => loadDemo(demoButton));
}

window.addEventListener('cela:data-changed', () => { render().catch(() => {}); });

initLayout({ page: 'dashboard', title: 'Dashboard' }).then(render).catch(handlePageError);
