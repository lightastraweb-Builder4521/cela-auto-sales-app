/* Inventory manager: search, status tabs, filter drawer, sort, table/grid views,
   quick status + publish actions. Filter state lives in the URL. */
import { html, qs, qsa, setHtml, debounce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatCurrency, formatNumber, relativeTime, shortVin, formatDateTime } from '../utils/format.js';
import { getPref, setPref } from '../utils/misc.js';
import {
  INVENTORY_DEFAULTS, SORT_OPTIONS, ADDED_OPTIONS, UPDATED_OPTIONS,
  filterInventory, sortVehicles, describeFilters, filtersFromQuery, filtersToQuery, uniqueSorted
} from '../utils/vehicle-filters.js';
import { STATUS, STATUS_LABELS, BODY_STYLES, TRANSMISSIONS, DRIVETRAINS, FUEL_TYPES, fullTitle } from '../models/vehicle.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { vehicleService } from '../services/vehicle-service.js';
import { statusBadge, publishBadge } from '../ui/badges.js';
import { loadCoverUrls, thumb, vehicleName, emptyState } from '../ui/vehicle-list.js';
import { availableActions, runVehicleAction } from '../ui/vehicle-actions.js';
import { openMenu } from '../ui/menu.js';

const PAGE_SIZE = 60;
const STATUS_TABS = [['all', 'All'], [STATUS.DRAFT, 'Draft'], [STATUS.AVAILABLE, 'Available'], [STATUS.PENDING, 'Pending'], [STATUS.SOLD, 'Sold'], [STATUS.ARCHIVED, 'Archived']];
const STATUS_MENU_ACTIONS = ['available', 'pending', 'sold', 'restoreSold', 'restoreArchived'];
const MORE_MENU_ACTIONS = ['schedule', 'changeSchedule', 'cancelSchedule', 'duplicate', 'archive', 'delete'];
// Phones and tablets get the touch-friendly card grid; the table needs a wide screen.
const narrow = window.matchMedia('(max-width: 1099px)');

let vehicles = [];
let covers = new Map();
let filters = { ...INVENTORY_DEFAULTS };
let view = getPref('inventoryView', 'table') === 'grid' ? 'grid' : 'table';
let visible = PAGE_SIZE;
let loadSeq = 0; // latest reload wins

const byId = (id) => vehicles.find((v) => v.id === id);
const effectiveView = () => (narrow.matches ? 'grid' : view);
const options = (list, selected, placeholder) => html`
  ${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}
  ${list.map((item) => {
    const [value, label] = Array.isArray(item) ? item : [item, item];
    return html`<option value="${value}" ${String(value) === String(selected) ? html`selected` : ''}>${label}</option>`;
  })}`;

/* ------------------------------------------------------------------ shell */

function renderShell() {
  setHtml(qs('#main'), html`
    <div class="page__inner">
      <header class="page-header">
        <div>
          <h1>Inventory</h1>
          <p class="page-header__sub" data-subtitle></p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--primary" href="add-vehicle.html">${icon('plus')}Add Vehicle</a>
        </div>
      </header>

      <div class="status-filter" role="group" aria-label="Filter by status" data-status-tabs></div>

      <div class="toolbar">
        <div class="search-field">
          ${icon('search')}
          <label class="visually-hidden" for="inv-search">Search inventory</label>
          <input class="input" type="search" id="inv-search" placeholder="Search year, make, model, VIN, stock #, price…" autocomplete="off" enterkeyhint="search" value="${filters.q}">
        </div>
        <div class="toolbar__controls">
          <label class="visually-hidden" for="inv-sort">Sort by</label>
          <select class="select toolbar__sort" id="inv-sort">${options(SORT_OPTIONS, filters.sort)}</select>
          <button type="button" class="btn btn--ghost" data-open-filters aria-haspopup="dialog">${icon('sliders')}Filters<span class="count-badge" data-filter-count hidden></span></button>
          <div class="view-toggle" role="group" aria-label="Layout">
            <button type="button" class="view-toggle__btn" data-view="table" aria-pressed="${view === 'table'}">${icon('list')}<span>Table</span></button>
            <button type="button" class="view-toggle__btn" data-view="grid" aria-pressed="${view === 'grid'}">${icon('grid')}<span>Grid</span></button>
          </div>
        </div>
      </div>

      <div class="active-filters" data-chips hidden></div>
      <p class="results-count" data-count aria-live="polite"></p>
      <div data-results></div>
    </div>

    <dialog class="drawer" data-filter-drawer aria-labelledby="filters-title">
      <form class="drawer__form" method="dialog" data-filter-form novalidate>
        <header class="drawer__header">
          <h2 id="filters-title">Filters</h2>
          <button type="submit" value="close" class="icon-btn" aria-label="Close filters">${icon('x')}</button>
        </header>
        <div class="drawer__body" data-filter-fields></div>
        <footer class="drawer__footer">
          <button type="button" class="btn btn--ghost" data-clear-filters>Clear all</button>
          <button type="submit" value="close" class="btn btn--primary" data-apply-filters>Show results</button>
        </footer>
      </form>
    </dialog>`);
}

function renderFilterFields() {
  const makes = uniqueSorted(vehicles.map((v) => v.make));
  const models = filters.make ? uniqueSorted(vehicles.filter((v) => v.make.toLowerCase() === filters.make.toLowerCase()).map((v) => v.model)) : [];
  const years = uniqueSorted(vehicles.map((v) => v.year).filter(Boolean)).reverse();
  setHtml(qs('[data-filter-fields]'), html`
    <div class="field">
      <label class="field__label" for="f-status">Status</label>
      <select class="select" id="f-status" name="status">${options(STATUS_TABS.map(([v, l]) => [v, v === 'all' ? 'All (except archived)' : l]), filters.status)}</select>
    </div>
    <div class="field">
      <label class="field__label" for="f-published">Published</label>
      <select class="select" id="f-published" name="published">${options([['all', 'All'], ['yes', 'Published'], ['no', 'Not published']], filters.published)}</select>
    </div>
    <div class="field-pair">
      <div class="field">
        <label class="field__label" for="f-make">Make</label>
        <select class="select" id="f-make" name="make">${options(makes, filters.make, 'All makes')}</select>
      </div>
      <div class="field">
        <label class="field__label" for="f-model">Model</label>
        <select class="select" id="f-model" name="model" ${filters.make ? '' : html`disabled`}>${options(models, filters.model, filters.make ? 'All models' : 'Choose a make')}</select>
      </div>
    </div>
    <fieldset class="fieldset">
      <legend class="field__label">Year</legend>
      <div class="field-pair">
        <div class="field"><label class="field__sublabel" for="f-year-min">From</label><select class="select" id="f-year-min" name="yearMin">${options(years, filters.yearMin, 'Any')}</select></div>
        <div class="field"><label class="field__sublabel" for="f-year-max">To</label><select class="select" id="f-year-max" name="yearMax">${options(years, filters.yearMax, 'Any')}</select></div>
      </div>
    </fieldset>
    <fieldset class="fieldset">
      <legend class="field__label">Price</legend>
      <div class="field-pair">
        <div class="field"><label class="field__sublabel" for="f-price-min">Min</label><div class="input-affix"><span class="input-affix__text" aria-hidden="true">$</span><input class="input" id="f-price-min" name="priceMin" inputmode="numeric" autocomplete="off" placeholder="No min" value="${filters.priceMin}"></div></div>
        <div class="field"><label class="field__sublabel" for="f-price-max">Max</label><div class="input-affix"><span class="input-affix__text" aria-hidden="true">$</span><input class="input" id="f-price-max" name="priceMax" inputmode="numeric" autocomplete="off" placeholder="No max" value="${filters.priceMax}"></div></div>
      </div>
    </fieldset>
    <fieldset class="fieldset">
      <legend class="field__label">Mileage</legend>
      <div class="field-pair">
        <div class="field"><label class="field__sublabel" for="f-mi-min">Min</label><input class="input" id="f-mi-min" name="mileageMin" inputmode="numeric" autocomplete="off" placeholder="No min" value="${filters.mileageMin}"></div>
        <div class="field"><label class="field__sublabel" for="f-mi-max">Max</label><input class="input" id="f-mi-max" name="mileageMax" inputmode="numeric" autocomplete="off" placeholder="No max" value="${filters.mileageMax}"></div>
      </div>
    </fieldset>
    <div class="field-pair">
      <div class="field"><label class="field__label" for="f-body">Body style</label><select class="select" id="f-body" name="body">${options(BODY_STYLES, filters.body, 'Any')}</select></div>
      <div class="field"><label class="field__label" for="f-trans">Transmission</label><select class="select" id="f-trans" name="transmission">${options(TRANSMISSIONS, filters.transmission, 'Any')}</select></div>
    </div>
    <div class="field-pair">
      <div class="field"><label class="field__label" for="f-drive">Drivetrain</label><select class="select" id="f-drive" name="drivetrain">${options(DRIVETRAINS, filters.drivetrain, 'Any')}</select></div>
      <div class="field"><label class="field__label" for="f-fuel">Fuel type</label><select class="select" id="f-fuel" name="fuel">${options(FUEL_TYPES, filters.fuel, 'Any')}</select></div>
    </div>
    <div class="field-pair">
      <div class="field"><label class="field__label" for="f-added">Date added</label><select class="select" id="f-added" name="added">${options(ADDED_OPTIONS, filters.added)}</select></div>
      <div class="field"><label class="field__label" for="f-updated">Recently updated</label><select class="select" id="f-updated" name="updated">${options(UPDATED_OPTIONS, filters.updated)}</select></div>
    </div>`);
}

/* ------------------------------------------------------------------ results */

function priceCell(v) {
  if (v.salePrice !== null) {
    return html`<span class="price">${formatCurrency(v.salePrice)}</span><s class="price-was">${formatCurrency(v.price)}</s>`;
  }
  return v.price !== null ? html`<span class="price">${formatCurrency(v.price)}</span>` : html`<span class="muted">No price</span>`;
}

function statusButton(v) {
  const hasActions = availableActions(v).some((a) => STATUS_MENU_ACTIONS.includes(a.id));
  if (!hasActions) return statusBadge(v.status);
  return html`<button type="button" class="status-btn badge badge--${v.status.toLowerCase()}" data-menu="status" data-id="${v.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Status: ${STATUS_LABELS[v.status]}. Change status for ${fullTitle(v)}">${STATUS_LABELS[v.status]}${icon('chevronDown')}</button>`;
}

function publishSwitch(v) {
  const actions = availableActions(v).map((a) => a.id);
  const canToggle = actions.includes('publish') || actions.includes('unpublish');
  if (!canToggle) return publishBadge(v) || html`<span class="muted">—</span>`;
  return html`
    <button type="button" class="switch" role="switch" aria-checked="${v.isPublished ? 'true' : 'false'}" data-toggle-publish data-id="${v.id}" aria-label="Published on the public site: ${fullTitle(v)}">
      <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
      <span class="switch__text">${v.isPublished ? 'Published' : 'Not published'}</span>
    </button>${v.publishScheduled && !v.isPublished ? html`<br>${publishBadge(v)}` : ''}`;
}

function tableView(list) {
  return html`
    <div class="table-wrap">
      <table class="table table--inventory">
        <caption class="visually-hidden">Vehicles (${list.length})</caption>
        <thead>
          <tr>
            <th scope="col" class="col-photo"><span class="visually-hidden">Photo</span></th>
            <th scope="col">Vehicle</th>
            <th scope="col" class="col-stock">Stock #</th>
            <th scope="col" class="col-vin">VIN</th>
            <th scope="col" class="num">Mileage</th>
            <th scope="col" class="num">Price</th>
            <th scope="col">Status</th>
            <th scope="col">Public site</th>
            <th scope="col" class="col-updated">Updated</th>
            <th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${list.map((v) => html`
            <tr data-id="${v.id}">
              <td class="col-photo">${thumb(v, covers.get(v.id))}</td>
              <td>${vehicleName(v)}</td>
              <td class="mono col-stock">${v.stockNumber || html`<span class="muted">—</span>`}</td>
              <td class="mono col-vin" title="${v.vin}">${shortVin(v.vin)}</td>
              <td class="num">${v.mileage !== null ? `${formatNumber(v.mileage)} mi` : html`<span class="muted">—</span>`}</td>
              <td class="num">${priceCell(v)}</td>
              <td>${statusButton(v)}</td>
              <td>${publishSwitch(v)}</td>
              <td class="col-updated"><time datetime="${v.updatedAt}" title="${formatDateTime(v.updatedAt)}">${relativeTime(v.updatedAt)}</time></td>
              <td class="col-actions">
                <div class="row-actions">
                  ${v.status !== STATUS.ARCHIVED ? html`<a class="btn btn--sm btn--ghost" href="edit-vehicle.html?id=${encodeURIComponent(v.id)}" aria-label="Edit ${fullTitle(v)}">${icon('edit')}<span>Edit</span></a>` : ''}
                  <button type="button" class="icon-btn icon-btn--sm" data-menu="more" data-id="${v.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${fullTitle(v)}">${icon('more')}</button>
                </div>
              </td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

function gridView(list) {
  return html`
    <ul class="vgrid">
      ${list.map((v) => html`
        <li class="vcard" data-id="${v.id}">
          <a class="vcard__media" href="vehicle.html?id=${encodeURIComponent(v.id)}" tabindex="-1" aria-hidden="true">
            ${covers.get(v.id) ? html`<img src="${covers.get(v.id)}" alt="" loading="lazy" decoding="async">` : html`<span class="vcard__noimg">${icon('camera')}<span>No photos yet</span></span>`}
          </a>
          <div class="vcard__badges">${statusBadge(v.status)}${publishBadge(v)}</div>
          <div class="vcard__body">
            <h2 class="vcard__title"><a href="vehicle.html?id=${encodeURIComponent(v.id)}">${[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Untitled vehicle'}</a></h2>
            <p class="vcard__trim">${v.trim || html`&nbsp;`}${v.isDemo ? html` <span class="badge badge--demo">Demo</span>` : ''}</p>
            <p class="vcard__price">${priceCell(v)}</p>
            <p class="vcard__meta">${v.mileage !== null ? `${formatNumber(v.mileage)} mi` : 'No mileage'} · ${v.stockNumber ? `Stock #${v.stockNumber}` : 'No stock #'}</p>
            <p class="vcard__updated">Updated ${relativeTime(v.updatedAt)}</p>
          </div>
          <div class="vcard__actions">
            ${v.status !== STATUS.ARCHIVED ? html`<a class="btn btn--sm btn--ghost" href="edit-vehicle.html?id=${encodeURIComponent(v.id)}" aria-label="Edit ${fullTitle(v)}">${icon('edit')}Edit</a>` : ''}
            <a class="btn btn--sm btn--ghost" href="vehicle.html?id=${encodeURIComponent(v.id)}" aria-label="View ${fullTitle(v)}">${icon('eye')}View</a>
            <button type="button" class="btn btn--sm btn--ghost" data-menu="status" data-id="${v.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Change status for ${fullTitle(v)}">Status${icon('chevronDown')}</button>
            <button type="button" class="icon-btn icon-btn--sm" data-menu="more" data-id="${v.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${fullTitle(v)}">${icon('more')}</button>
          </div>
        </li>`)}
    </ul>`;
}

function renderStatusTabs() {
  const counts = { all: 0 };
  vehicles.forEach((v) => {
    counts[v.status] = (counts[v.status] || 0) + 1;
    if (v.status !== STATUS.ARCHIVED) counts.all += 1;
  });
  setHtml(qs('[data-status-tabs]'), html`${STATUS_TABS.map(([value, label]) => html`
    <button type="button" class="status-filter__btn" data-status="${value}" aria-pressed="${filters.status === value ? 'true' : 'false'}">
      ${label}<span class="status-filter__count">${counts[value] || 0}</span>
    </button>`)}`);
}

function renderChips() {
  const chips = describeFilters(filters);
  const el = qs('[data-chips]');
  el.hidden = !chips.length;
  setHtml(el, html`
    ${chips.map((chip) => html`<button type="button" class="chip" data-remove="${chip.key}" aria-label="Remove filter: ${chip.label}">${chip.label}${icon('x')}</button>`)}
    <button type="button" class="link" data-clear-filters>Clear all</button>`);
  const badge = qs('[data-filter-count]');
  badge.textContent = String(chips.length);
  badge.hidden = !chips.length;
}

function renderResults() {
  const matched = sortVehicles(filterInventory(vehicles, filters), filters.sort);
  const shown = matched.slice(0, visible);
  const results = qs('[data-results]');
  const active = vehicles.filter((v) => v.status !== STATUS.ARCHIVED);

  qs('[data-subtitle]').textContent = vehicles.length
    ? `${active.length} vehicle${active.length === 1 ? '' : 's'} in active inventory · ${active.filter((v) => v.isPublished).length} published`
    : 'Add vehicles, manage photos, and control what customers see.';
  qs('[data-count]').textContent = vehicles.length ? `Showing ${matched.length} of ${filters.status === STATUS.ARCHIVED ? vehicles.filter((v) => v.status === STATUS.ARCHIVED).length : active.length} vehicles` : '';
  const apply = qs('[data-apply-filters]');
  if (apply) apply.textContent = `Show ${matched.length} vehicle${matched.length === 1 ? '' : 's'}`;

  if (!vehicles.length) {
    setHtml(results, emptyState({
      title: 'No vehicles yet.',
      text: 'Add your first vehicle — it stays a private draft until you publish it.',
      actions: html`<a class="btn btn--primary btn--lg" href="add-vehicle.html">${icon('plus')}Add Your First Vehicle</a>`
    }));
  } else if (!matched.length) {
    const noneInStatus = filters.status !== 'all' && !vehicles.some((v) => v.status === filters.status);
    setHtml(results, emptyState({
      iconName: 'search',
      title: noneInStatus ? `No ${STATUS_LABELS[filters.status].toLowerCase()} vehicles.` : 'No vehicles match your search.',
      text: noneInStatus ? '' : 'Try a different search or remove a filter.',
      actions: html`<button type="button" class="btn btn--ghost" data-clear-filters>Clear search & filters</button>`
    }));
  } else {
    setHtml(results, html`
      ${effectiveView() === 'table' ? tableView(shown) : gridView(shown)}
      ${matched.length > shown.length ? html`<div class="load-more"><button type="button" class="btn btn--ghost" data-load-more>Show more (${matched.length - shown.length} more)</button></div>` : ''}`);
  }
  qsa('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}

function syncUrl() {
  const query = filtersToQuery(filters);
  if (window.location.search !== query) window.history.replaceState(null, '', `${window.location.pathname}${query}`);
}

function update({ resetPage = true } = {}) {
  if (resetPage) visible = PAGE_SIZE;
  renderStatusTabs();
  renderChips();
  renderResults();
  syncUrl();
}

/* ------------------------------------------------------------------ data */

async function reload() {
  const focusKey = document.activeElement && document.activeElement.closest('[data-id]')
    ? { id: document.activeElement.closest('[data-id]').dataset.id, selector: document.activeElement.matches('[data-menu]') ? `[data-menu="${document.activeElement.dataset.menu}"]` : document.activeElement.matches('[data-toggle-publish]') ? '[data-toggle-publish]' : null }
    : null;
  const seq = ++loadSeq;
  const freshVehicles = await vehicleService.getVehicles();
  const freshCovers = (await loadCoverUrls(freshVehicles)).urls;
  if (seq !== loadSeq) return;
  vehicles = freshVehicles;
  covers = freshCovers;
  renderFilterFields();
  update({ resetPage: false });
  if (focusKey && focusKey.selector) {
    const el = qs(`[data-id="${focusKey.id}"] ${focusKey.selector}, [data-id="${focusKey.id}"]${focusKey.selector}`);
    if (el) el.focus();
  }
}

/* ------------------------------------------------------------------ events */

function bindEvents() {
  const main = qs('#main');
  const drawer = qs('[data-filter-drawer]');
  const form = qs('[data-filter-form]');

  qs('#inv-search').addEventListener('input', debounce((event) => { filters.q = event.target.value.trim(); update(); }, 180));
  qs('#inv-sort').addEventListener('change', (event) => { filters.sort = event.target.value; update(); });

  main.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.status) {
      filters.status = target.dataset.status;
      renderFilterFields();
      update();
    } else if (target.dataset.view) {
      view = target.dataset.view;
      setPref('inventoryView', view);
      renderResults();
    } else if (target.hasAttribute('data-open-filters')) {
      drawer.showModal();
    } else if (target.hasAttribute('data-clear-filters')) {
      filters = { ...INVENTORY_DEFAULTS, sort: filters.sort, status: filters.status };
      qs('#inv-search').value = '';
      renderFilterFields();
      update();
    } else if (target.dataset.remove) {
      const key = target.dataset.remove;
      filters[key] = INVENTORY_DEFAULTS[key];
      if (key === 'make') filters.model = '';
      renderFilterFields();
      update();
      qs('#inv-search').focus();
    } else if (target.hasAttribute('data-load-more')) {
      visible += PAGE_SIZE;
      update({ resetPage: false });
    } else if (target.hasAttribute('data-toggle-publish')) {
      const v = byId(target.dataset.id);
      if (v) await runVehicleAction(v.isPublished ? 'unpublish' : 'publish', v, reload);
    } else if (target.dataset.menu) {
      const v = byId(target.dataset.id);
      if (!v) return;
      const wanted = target.dataset.menu === 'status' ? STATUS_MENU_ACTIONS : MORE_MENU_ACTIONS;
      const actions = availableActions(v).filter((a) => wanted.includes(a.id));
      const items = actions.map((a) => ({ label: a.label, icon: a.icon, tone: a.tone, onSelect: () => runVehicleAction(a.id, v, reload) }));
      if (target.dataset.menu === 'more') {
        items.unshift({ label: 'View details', icon: 'eye', onSelect: () => runVehicleAction('view', v) });
        if (v.status !== STATUS.ARCHIVED && availableActions(v).some((a) => a.id === 'publish' || a.id === 'unpublish')) {
          const pub = v.isPublished ? { id: 'unpublish', label: 'Unpublish', icon: 'eyeOff' } : { id: 'publish', label: 'Publish Now', icon: 'globe' };
          items.splice(1, 0, { label: pub.label, icon: pub.icon, onSelect: () => runVehicleAction(pub.id, v, reload) });
        }
      }
      if (!items.length) items.push({ label: 'No status changes available', disabled: true, onSelect: () => {} });
      openMenu(target, items, { label: `${target.dataset.menu === 'status' ? 'Status' : 'More'} actions for ${fullTitle(v)}` });
    }
  });

  // Read every drawer field on each update (not just the event target), so a
  // quick edit to one box can never be lost behind a debounced edit to another.
  const onFilterInput = (event) => {
    const field = event.target;
    if (!field.name) return;
    const makeChanged = field.name === 'make' && field.value.trim() !== filters.make;
    qsa('[name]', form).forEach((el) => {
      if (Object.prototype.hasOwnProperty.call(INVENTORY_DEFAULTS, el.name)) filters[el.name] = el.value.trim();
    });
    if (makeChanged) {
      filters.model = '';
      renderFilterFields();
      qs('#f-make').focus();
    }
    update();
  };
  form.addEventListener('change', onFilterInput);
  form.addEventListener('input', debounce((event) => { if (event.target.matches('input')) onFilterInput(event); }, 250));
  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-filters]')) {
      filters = { ...INVENTORY_DEFAULTS, sort: filters.sort, q: filters.q };
      renderFilterFields();
      update();
    }
  });
  drawer.addEventListener('click', (event) => { if (event.target === drawer) drawer.close(); });

  const onNarrow = () => renderResults();
  if (narrow.addEventListener) narrow.addEventListener('change', onNarrow);
}

/* ------------------------------------------------------------------ boot */

async function start() {
  filters = filtersFromQuery(window.location.search);
  renderShell();
  bindEvents();
  await reload();
  if (new URLSearchParams(window.location.search).get('focus') === 'search') qs('#inv-search').focus();
}

window.addEventListener('cela:data-changed', () => { reload().catch(() => {}); });

initLayout({ page: 'inventory', title: 'Inventory' }).then(start).catch(handlePageError);
