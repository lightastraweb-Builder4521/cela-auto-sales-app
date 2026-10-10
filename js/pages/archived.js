/* Archived vehicles: hidden from active work and the public site, kept internally.
   Restore is easy; permanent delete is Admin-only and requires typing a phrase. */
import { html, qs, setHtml, debounce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatDateTime, shortVin } from '../utils/format.js';
import { STATUS, STATUS_LABELS, fullTitle } from '../models/vehicle.js';
import { matchesSearch } from '../utils/vehicle-filters.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { vehicleService } from '../services/vehicle-service.js';
import { authService } from '../services/auth-service.js';
import { loadCoverUrls, thumb, vehicleName, emptyState } from '../ui/vehicle-list.js';
import { runVehicleAction } from '../ui/vehicle-actions.js';

let archived = [];
let covers = new Map();
let query = '';
let loadSeq = 0; // latest reload wins

function renderList() {
  const list = archived.filter((v) => matchesSearch(v, query)).sort((a, b) => ((a.archivedAt || '') < (b.archivedAt || '') ? 1 : -1));
  const canDelete = authService.can('vehicle.delete');
  qs('[data-count]').textContent = archived.length ? `Showing ${list.length} of ${archived.length}` : '';
  const results = qs('[data-results]');
  if (!archived.length) {
    setHtml(results, emptyState({ iconName: 'archive', title: 'No archived vehicles.', text: 'Archiving hides a vehicle from active inventory and the public site without deleting it.' }));
    return;
  }
  if (!list.length) {
    setHtml(results, emptyState({ iconName: 'search', title: 'No archived vehicles match your search.' }));
    return;
  }
  setHtml(results, html`
    <div class="table-wrap table-wrap--cards">
      <table class="table table--stack">
        <caption class="visually-hidden">Archived vehicles (${list.length})</caption>
        <thead>
          <tr>
            <th scope="col" class="col-photo"><span class="visually-hidden">Photo</span></th>
            <th scope="col">Vehicle</th>
            <th scope="col">Stock #</th>
            <th scope="col" class="col-vin">VIN</th>
            <th scope="col">Before archiving</th>
            <th scope="col">Archived</th>
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
              <td data-label="Before archiving">${STATUS_LABELS[v.statusBeforeArchive] || 'Draft'}</td>
              <td data-label="Archived">${formatDateTime(v.archivedAt)}</td>
              <td class="col-actions">
                <div class="row-actions">
                  <a class="btn btn--sm btn--ghost" href="vehicle.html?id=${encodeURIComponent(v.id)}" aria-label="View ${fullTitle(v)}">${icon('eye')}<span>View</span></a>
                  <button type="button" class="btn btn--sm btn--ghost" data-action="restoreArchived" data-id="${v.id}" aria-label="Restore ${fullTitle(v)}">${icon('restore')}<span>Restore</span></button>
                  ${canDelete
                    ? html`<button type="button" class="btn btn--sm btn--danger-ghost" data-action="delete" data-id="${v.id}" aria-label="Delete ${fullTitle(v)} permanently">${icon('trash')}<span>Delete</span></button>`
                    : ''}
                </div>
              </td>
            </tr>`)}
        </tbody>
      </table>
    </div>
    ${canDelete ? '' : html`<p class="page-note">${icon('lock')} Only an Admin can delete vehicles permanently.</p>`}`);
}

async function reload() {
  const seq = ++loadSeq;
  const fresh = (await vehicleService.getVehicles()).filter((v) => v.status === STATUS.ARCHIVED);
  const freshCovers = (await loadCoverUrls(fresh)).urls;
  if (seq !== loadSeq) return;
  archived = fresh;
  covers = freshCovers;
  renderList();
}

async function start() {
  setHtml(qs('#main'), html`
    <div class="page__inner">
      <header class="page-header">
        <div>
          <h1>Archived Vehicles</h1>
          <p class="page-header__sub">Hidden from the public site and active inventory. Nothing here is deleted unless an Admin deletes it permanently.</p>
        </div>
      </header>
      <div class="filter-row">
        <div class="search-field">${icon('search')}<label class="visually-hidden" for="a-q">Search archived vehicles</label><input class="input" type="search" id="a-q" placeholder="Search year, make, model, VIN, stock #" autocomplete="off"></div>
      </div>
      <p class="results-count" data-count aria-live="polite"></p>
      <div data-results></div>
    </div>`);
  qs('#a-q').addEventListener('input', debounce((event) => { query = event.target.value.trim(); renderList(); }, 180));
  qs('#main').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const v = archived.find((x) => x.id === button.dataset.id);
    if (v) await runVehicleAction(button.dataset.action, v, reload);
  });
  await reload();
}

window.addEventListener('cela:data-changed', () => { reload().catch(() => {}); });

initLayout({ page: 'archived', title: 'Archived Vehicles' }).then(start).catch(handlePageError);
