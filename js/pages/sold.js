/* Sold History — sold vehicles stay here for 7 days (off the public site), then the server
   permanently deletes them with their photos unless they are restored first. */
import { html, qs, setHtml, debounce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatCurrency, formatDateTime, formatNumber, formatTimeRemaining, shortVin, toDateInputValue } from '../utils/format.js';
import { RULES } from '../config.js';
import { STATUS, fullTitle } from '../models/vehicle.js';
import { matchesSearch, uniqueSorted } from '../utils/vehicle-filters.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { vehicleService } from '../services/vehicle-service.js';
import { authService } from '../services/auth-service.js';
import { loadCoverUrls, thumb, vehicleName, emptyState } from '../ui/vehicle-list.js';
import { runVehicleAction } from '../ui/vehicle-actions.js';

const DEFAULTS = { q: '', period: 'all', from: '', to: '', make: '', model: '', year: '' };
let USER_LABELS = {}; // employee id → display name
const PERIODS = [['all', 'All time'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Date range']];

let sold = [];
let covers = new Map();
let filters = { ...DEFAULTS };
let loadSeq = 0; // latest reload wins

function startOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - d.getDay()); // week starts Sunday
  return d;
}

function inPeriod(v) {
  const t = new Date(v.soldAt).getTime();
  const now = new Date();
  if (filters.period === 'week') return t >= startOfWeek(now).getTime();
  if (filters.period === 'month') return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (filters.period === 'custom') {
    if (filters.from && t < new Date(`${filters.from}T00:00:00`).getTime()) return false;
    if (filters.to && t > new Date(`${filters.to}T23:59:59`).getTime()) return false;
  }
  return true;
}

function applyFilters() {
  return sold.filter((v) => inPeriod(v)
    && matchesSearch(v, filters.q)
    && (!filters.make || v.make.toLowerCase() === filters.make.toLowerCase())
    && (!filters.model || v.model.toLowerCase() === filters.model.toLowerCase())
    && (!filters.year || String(v.year) === filters.year))
    .sort((a, b) => (a.soldAt < b.soldAt ? 1 : -1));
}

const options = (list, selected, placeholder) => html`<option value="">${placeholder}</option>${list.map((x) => html`<option value="${x}" ${String(x) === String(selected) ? html`selected` : ''}>${x}</option>`)}`;

function renderFilters() {
  const makes = uniqueSorted(sold.map((v) => v.make));
  const models = filters.make ? uniqueSorted(sold.filter((v) => v.make.toLowerCase() === filters.make.toLowerCase()).map((v) => v.model)) : [];
  const years = uniqueSorted(sold.map((v) => v.year).filter(Boolean)).reverse();
  setHtml(qs('[data-filters]'), html`
    <div class="segmented" role="group" aria-label="Sold period">
      ${PERIODS.map(([value, label]) => html`<button type="button" class="segmented__btn" data-period="${value}" aria-pressed="${filters.period === value}">${label}</button>`)}
    </div>
    ${filters.period === 'custom' ? html`
      <div class="field-pair field-pair--inline">
        <div class="field"><label class="field__sublabel" for="s-from">From</label><input class="input" type="date" id="s-from" name="from" value="${filters.from}" max="${toDateInputValue()}"></div>
        <div class="field"><label class="field__sublabel" for="s-to">To</label><input class="input" type="date" id="s-to" name="to" value="${filters.to}" max="${toDateInputValue()}"></div>
      </div>` : ''}
    <div class="filter-row">
      <div class="search-field">${icon('search')}<label class="visually-hidden" for="s-q">Search sold vehicles</label><input class="input" type="search" id="s-q" name="q" placeholder="Search year, make, model, VIN, stock #" value="${filters.q}" autocomplete="off"></div>
      <label class="visually-hidden" for="s-make">Make</label><select class="select" id="s-make" name="make">${options(makes, filters.make, 'All makes')}</select>
      <label class="visually-hidden" for="s-model">Model</label><select class="select" id="s-model" name="model" ${filters.make ? '' : html`disabled`}>${options(models, filters.model, filters.make ? 'All models' : 'Model')}</select>
      <label class="visually-hidden" for="s-year">Year</label><select class="select" id="s-year" name="year">${options(years, filters.year, 'All years')}</select>
    </div>`);
}

function rowActions(v) {
  return html`
    <div class="row-actions">
      <a class="btn btn--sm btn--ghost" href="vehicle.html?id=${encodeURIComponent(v.id)}" aria-label="View ${fullTitle(v)}">${icon('eye')}<span>View</span></a>
      ${v.deletionClaimedAt ? '' : html`<button type="button" class="btn btn--sm btn--ghost" data-action="restoreSold" data-id="${v.id}" aria-label="Restore ${fullTitle(v)}">${icon('restore')}<span>Restore Vehicle</span></button>`}
      <button type="button" class="btn btn--sm btn--ghost" data-action="archive" data-id="${v.id}" aria-label="Archive ${fullTitle(v)}">${icon('archive')}<span>Archive</span></button>
      ${authService.can('vehicle.delete') ? html`<button type="button" class="btn btn--sm btn--danger-ghost" data-action="deleteForever" data-id="${v.id}" aria-label="Delete ${fullTitle(v)} forever">${icon('trash')}<span>Delete Forever</span></button>` : ''}
    </div>`;
}

function renderList() {
  const list = applyFilters();
  const month = sold.filter((v) => new Date(v.soldAt).getMonth() === new Date().getMonth() && new Date(v.soldAt).getFullYear() === new Date().getFullYear()).length;
  qs('[data-subtitle]').textContent = `${sold.length} sold in total · ${month} this month`;
  qs('[data-count]').textContent = sold.length ? `Showing ${list.length} of ${sold.length}` : '';
  const results = qs('[data-results]');
  if (!sold.length) {
    setHtml(results, emptyState({ iconName: 'sold', title: 'No sold vehicles right now.', text: `When you mark a vehicle Sold, it leaves the public website and stays here for ${RULES.soldRetentionDays} days before it is permanently deleted.`, actions: html`<a class="btn btn--ghost" href="inventory.html">Go to Inventory</a>` }));
    return;
  }
  if (!list.length) {
    setHtml(results, emptyState({ iconName: 'search', title: 'No sold vehicles match.', text: 'Try a different period or remove a filter.', actions: html`<button type="button" class="btn btn--ghost" data-reset>Show all sold vehicles</button>` }));
    return;
  }
  setHtml(results, html`
    <div class="table-wrap table-wrap--cards">
      <table class="table table--stack">
        <caption class="visually-hidden">Sold vehicles (${list.length})</caption>
        <thead>
          <tr>
            <th scope="col" class="col-photo"><span class="visually-hidden">Photo</span></th>
            <th scope="col">Vehicle</th>
            <th scope="col">Stock #</th>
            <th scope="col" class="col-vin">VIN</th>
            <th scope="col" class="num">Last list price</th>
            <th scope="col" class="num">Sold price <span class="th-note">internal</span></th>
            <th scope="col" class="num">Mileage</th>
            <th scope="col">Sold</th>
            <th scope="col">Permanent deletion</th>
            <th scope="col">Time remaining</th>
            <th scope="col" class="col-soldby">Sold by</th>
            <th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${list.map((v) => html`
            <tr data-id="${v.id}">
              <td class="col-photo">${thumb(v, covers.get(v.id))}</td>
              <td data-label="Vehicle">${vehicleName(v)}</td>
              <td class="mono" data-label="Stock #">${v.stockNumber || '—'}</td>
              <td class="mono col-vin" data-label="VIN" title="${v.vin}">${shortVin(v.vin)}</td>
              <td class="num" data-label="Last list price">${formatCurrency(v.salePrice ?? v.price)}</td>
              <td class="num" data-label="Sold price">${formatCurrency(v.soldPrice)}</td>
              <td class="num" data-label="Mileage">${v.mileage !== null ? `${formatNumber(v.mileage)} mi` : '—'}</td>
              <td data-label="Sold"><time datetime="${v.soldAt}">${formatDateTime(v.soldAt)}</time></td>
              <td data-label="Permanent deletion" data-deletion-date><time datetime="${v.deleteAfter || ''}">${formatDateTime(v.deleteAfter)}</time></td>
              <td data-label="Time remaining" data-time-remaining>${v.deletionClaimedAt ? 'Being deleted now' : (formatTimeRemaining(v.deleteAfter) === 'Due now' ? 'Due now (next hourly cleanup)' : formatTimeRemaining(v.deleteAfter))}</td>
              <td class="col-soldby" data-label="Sold by">${USER_LABELS[v.soldBy] || '—'}</td>
              <td class="col-actions">${rowActions(v)}</td>
            </tr>`)}
        </tbody>
      </table>
    </div>`);
}

function syncUrl() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v && v !== DEFAULTS[k]) params.set(k, v); });
  const query = params.toString() ? `?${params}` : '';
  if (window.location.search !== query) window.history.replaceState(null, '', `${window.location.pathname}${query}`);
}

function update() {
  renderList();
  syncUrl();
}

async function reload() {
  const seq = ++loadSeq;
  const fresh = (await vehicleService.getVehicles()).filter((v) => v.status === STATUS.SOLD);
  const freshCovers = (await loadCoverUrls(fresh)).urls;
  if (seq !== loadSeq) return;
  sold = fresh;
  covers = freshCovers;
  renderFilters();
  update();
}

function bind() {
  const main = qs('#main');
  main.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.period) {
      filters.period = button.dataset.period;
      renderFilters();
      update();
      qs(`[data-period="${filters.period}"]`).focus();
    } else if (button.hasAttribute('data-reset')) {
      filters = { ...DEFAULTS };
      renderFilters();
      update();
    } else if (button.dataset.action) {
      const v = sold.find((x) => x.id === button.dataset.id);
      if (!v) return;
      // While a permanent deletion runs, that vehicle's buttons are off and say so; a second click does nothing.
      const row = button.closest('tr');
      const busy = (on) => {
        if (!row || !row.isConnected) return;
        row.toggleAttribute('data-deleting', on);
        row.setAttribute('aria-busy', on ? 'true' : 'false');
        row.querySelectorAll('.row-actions button').forEach((b) => { b.disabled = on; });
        const label = row.querySelector('[data-action="deleteForever"] span');
        if (label) label.textContent = on ? 'Deleting…' : 'Delete Forever';
      };
      const done = (updated) => {
        if (updated === null) {            // gone for good: take the card away at once, then confirm with the server's list
          sold = sold.filter((x) => x.id !== v.id);
          update();
        }
        return reload();
      };
      await runVehicleAction(button.dataset.action, v, done, { busy });
    }
  });
  const onField = (event) => {
    const el = event.target;
    if (!el.name || !(el.name in DEFAULTS)) return;
    filters[el.name] = el.value.trim();
    if (el.name === 'make') { filters.model = ''; renderFilters(); qs('#s-make').focus(); }
    update();
  };
  main.addEventListener('change', onField);
  main.addEventListener('input', debounce((event) => { if (event.target.id === 's-q') onField(event); }, 180));
}

async function start() {
  const params = new URLSearchParams(window.location.search);
  Object.keys(DEFAULTS).forEach((k) => { if (params.has(k)) filters[k] = params.get(k) || ''; });
  if (!PERIODS.some(([p]) => p === filters.period)) filters.period = 'all';
  setHtml(qs('#main'), html`
    <div class="page__inner">
      <header class="page-header">
        <div>
          <h1>Sold Vehicles</h1>
          <p class="page-header__sub" data-subtitle></p>
        </div>
      </header>
      <p class="notice notice--warn" data-retention-notice>${icon('clock')}<span>Sold vehicles and their associated photos are permanently deleted <strong>${RULES.soldRetentionDays} days after being marked Sold</strong>. Use <strong>Restore Vehicle</strong> before then to keep one.</span></p>
      <div class="filters-bar" data-filters></div>
      <p class="results-count" data-count aria-live="polite"></p>
      <div data-results></div>
      <p class="page-note">${icon('info')} A sold vehicle leaves the public website the moment it is marked Sold. It stays here for ${RULES.soldRetentionDays} days for your records, then it and its photos are deleted automatically. A restored vehicle returns to Inventory as a Draft.</p>
    </div>`);
  bind();
  USER_LABELS = Object.fromEntries(await authService.directory().catch(() => new Map()));
  await reload();
}

window.addEventListener('cela:data-changed', () => { reload().catch(() => {}); });

initLayout({ page: 'sold', title: 'Sold Vehicles' }).then(start).catch(handlePageError);
