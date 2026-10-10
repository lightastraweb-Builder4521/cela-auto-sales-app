/* Activity history — full, filterable log. */
import { html, qs, setHtml, debounce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { toDateInputValue } from '../utils/format.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { activityService } from '../services/activity-service.js';
import { vehicleService } from '../services/vehicle-service.js';
import { activityList } from '../ui/activity-list.js';
import { emptyState } from '../ui/vehicle-list.js';

const PAGE = 50;
const GROUPS = [
  ['', 'All activity'],
  ['vehicle.', 'Vehicle changes (all)'],
  ['status', 'Status changes'],
  ['price.changed', 'Price changes'],
  ['mileage.changed', 'Mileage changes'],
  ['photo.', 'Photos'],
  ['vehicle.published', 'Published'],
  ['vehicle.unpublished', 'Unpublished'],
  ['vehicle.sold', 'Sold'],
  ['vehicle.archived', 'Archived'],
  ['vehicle.deleted', 'Deleted']
];
const STATUS_ACTIONS = ['vehicle.available', 'vehicle.pending', 'vehicle.sold', 'vehicle.restored', 'vehicle.archived', 'vehicle.published', 'vehicle.unpublished'];

let filters = { type: '', q: '', from: '', to: '' };
let shown = PAGE;
let existingIds = new Set();

async function renderList() {
  let entries = await activityService.getActivity({
    action: filters.type && filters.type !== 'status' ? filters.type : undefined,
    search: filters.q || undefined,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined
  });
  if (filters.type === 'status') entries = entries.filter((e) => STATUS_ACTIONS.includes(e.action));
  const total = entries.length;
  const list = entries.slice(0, shown);
  qs('[data-count]').textContent = total ? `${total} entr${total === 1 ? 'y' : 'ies'}` : '';
  const anyFilter = filters.type || filters.q || filters.from || filters.to;
  setHtml(qs('[data-results]'), total
    ? html`
      <div class="panel">${activityList(list, { existingIds, groupByDay: true, showDetails: true })}</div>
      ${total > list.length ? html`<div class="load-more"><button type="button" class="btn btn--ghost" data-more>Show older activity (${total - list.length} more)</button></div>` : ''}`
    : emptyState({
      iconName: 'activity',
      title: anyFilter ? 'No activity matches these filters.' : 'No activity recorded yet.',
      text: anyFilter ? '' : 'Adding, editing, publishing and status changes will appear here.',
      actions: anyFilter ? html`<button type="button" class="btn btn--ghost" data-reset>Clear filters</button>` : ''
    }));
}

async function start() {
  existingIds = new Set((await vehicleService.getVehicles()).map((v) => v.id));
  setHtml(qs('#main'), html`
    <div class="page__inner">
      <header class="page-header">
        <div>
          <h1>Activity History</h1>
          <p class="page-header__sub">Every change to every vehicle, newest first.</p>
        </div>
      </header>
      <div class="filter-row" data-filters>
        <div class="search-field">${icon('search')}<label class="visually-hidden" for="act-q">Search activity</label><input class="input" type="search" id="act-q" name="q" placeholder="Search vehicle, stock #, change, or person" autocomplete="off"></div>
        <label class="visually-hidden" for="act-type">Type of activity</label>
        <select class="select" id="act-type" name="type">${GROUPS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
        <div class="field field--inline"><label class="field__sublabel" for="act-from">From</label><input class="input" type="date" id="act-from" name="from" max="${toDateInputValue()}"></div>
        <div class="field field--inline"><label class="field__sublabel" for="act-to">To</label><input class="input" type="date" id="act-to" name="to" max="${toDateInputValue()}"></div>
      </div>
      <p class="results-count" data-count aria-live="polite"></p>
      <div data-results></div>
      <p class="page-note">${icon('lock')} Internal financial fields are logged by name only — their values are never recorded here.</p>
    </div>`);
  const bar = qs('[data-filters]');
  const onChange = (event) => {
    if (!event.target.name) return;
    filters[event.target.name] = event.target.value.trim();
    shown = PAGE;
    renderList();
  };
  bar.addEventListener('change', onChange);
  bar.addEventListener('input', debounce((event) => { if (event.target.name === 'q') onChange(event); }, 200));
  qs('#main').addEventListener('click', (event) => {
    if (event.target.closest('[data-more]')) { shown += PAGE; renderList(); }
    if (event.target.closest('[data-reset]')) {
      filters = { type: '', q: '', from: '', to: '' };
      bar.querySelectorAll('input, select').forEach((el) => { el.value = ''; });
      renderList();
    }
  });
  await renderList();
}

initLayout({ page: 'activity', title: 'Activity History' }).then(start).catch(handlePageError);
