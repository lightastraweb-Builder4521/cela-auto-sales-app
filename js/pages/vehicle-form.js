/* Add Vehicle + Edit Vehicle controller (add-vehicle.html / edit-vehicle.html?id=). */
import { html, qs, qsa, setHtml, announce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { parseMoney, parseInteger, formatNumber } from '../utils/format.js';
import { getParam } from '../utils/misc.js';
import { RULES } from '../config.js';
import {
  createVehicle, validateVehicle, publishReadiness, fullTitle, STATUS, STATUS_LABELS, STANDARD_FEATURES
} from '../models/vehicle.js';
import { validateVin, normalizeVin, VIN_LENGTH } from '../services/vin-service.js';
import { vehicleService, ValidationError, NotReadyError, NotFoundError } from '../services/vehicle-service.js';
import { photoService } from '../services/photo-service.js';
import { publicListingService } from '../services/public-listing-service.js';
import { initLayout, handlePageError, setLeaveGuard, renderPageMessage } from '../ui/layout.js';
import { renderVehicleForm, renderFormNav } from '../ui/vehicle-form-view.js';
import { createPhotoManager } from '../ui/photo-manager.js';
import { statusBadge, publishBadge, demoBadge } from '../ui/badges.js';
import { readinessDialog, confirmDialog } from '../ui/dialogs.js';
import { openPublicPreview } from '../ui/public-preview.js';
import { runVehicleAction } from '../ui/vehicle-actions.js';
import { toast, toastError, flash } from '../ui/toast.js';

const vehicleId = getParam('id');
const mode = document.body.dataset.mode === 'edit' ? 'edit' : 'add';

let vehicle = null;       // saved record (edit) or blank template (add)
let photos = null;        // photo manager instance
let baseline = '';        // serialized form at last save
let saving = false;

const FIELD_FOCUS = { photos: '.dropzone__btn', status: '#sec-publishing' };

/* ------------------------------------------------------------------ read form */

function readForm() {
  const form = qs('#vehicle-form');
  const value = (name) => {
    const el = form.elements.namedItem(name);
    return el ? String(el.value || '').trim() : '';
  };
  const standard = qsa('input[name="features"]:checked', form).map((el) => el.value);
  const custom = qsa('[data-remove-feature]', form).map((el) => el.dataset.removeFeature);
  const data = {
    year: parseInteger(value('year')),
    make: value('make'),
    model: value('model'),
    trim: value('trim'),
    bodyStyle: value('bodyStyle'),
    stockNumber: value('stockNumber'),
    vin: normalizeVin(value('vin')),
    price: parseMoney(value('price')),
    salePrice: parseMoney(value('salePrice')),
    mileage: parseInteger(value('mileage')),
    transmission: value('transmission'),
    drivetrain: value('drivetrain'),
    engine: value('engine'),
    fuelType: value('fuelType'),
    exteriorColor: value('exteriorColor'),
    interiorColor: value('interiorColor'),
    doors: parseInteger(value('doors')),
    seats: parseInteger(value('seats')),
    description: value('description'),
    features: [...standard, ...custom],
    featured: qs('#v-featured').checked,
    purchasePrice: parseMoney(value('purchasePrice')),
    acquisitionDate: value('acquisitionDate'),
    acquisitionSource: value('acquisitionSource'),
    reconditioningCost: parseMoney(value('reconditioningCost')),
    internalNotes: value('internalNotes'),
    employeeNotes: value('employeeNotes')
  };
  if (vehicle.status === STATUS.SOLD) {
    data.soldPrice = parseMoney(value('soldPrice'));
    data.soldNote = value('soldNote');
  }
  return data;
}

const serialize = () => JSON.stringify(readForm());
const isDirty = () => !saving && (serialize() !== baseline || (photos && photos.isDirty()));

/* ------------------------------------------------------------------ errors */

function clearErrors() {
  qsa('.field-error', qs('#vehicle-form')).forEach((el) => { el.textContent = ''; el.hidden = true; });
  qsa('[aria-invalid="true"]', qs('#vehicle-form')).forEach((el) => el.removeAttribute('aria-invalid'));
  const alert = qs('[data-form-alert]');
  alert.hidden = true;
  alert.textContent = '';
}

function showErrors(errors) {
  clearErrors();
  const keys = Object.keys(errors);
  keys.forEach((key) => {
    const input = qs(`#v-${key}`);
    const slot = qs(`#v-${key}-error`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (slot) { slot.textContent = errors[key]; slot.hidden = false; }
    if (key === 'purchasePrice' || key === 'reconditioningCost' || key === 'acquisitionDate') qs('details.internal').open = true;
  });
  const alert = qs('[data-form-alert]');
  setHtml(alert, html`${icon('alert')}<span>${keys.length === 1 ? 'Please fix the highlighted field.' : `Please fix the ${keys.length} highlighted fields.`}</span>`);
  alert.hidden = false;
  const first = qs(`#v-${keys[0]}`) || alert;
  first.focus();
  first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------------ live UI */

function updateVinStatus() {
  const input = qs('#v-vin');
  const normalized = normalizeVin(input.value).slice(0, VIN_LENGTH + 3);
  if (input.value !== normalized) {
    const pos = input.selectionStart;
    input.value = normalized;
    try { input.setSelectionRange(pos, pos); } catch (err) { /* not a text input */ }
  }
  const status = qs('[data-vin-status]');
  const count = qs('[data-vin-count]');
  count.textContent = `${normalized.length} / ${VIN_LENGTH}`;
  count.classList.toggle('is-complete', normalized.length === VIN_LENGTH);
  const result = validateVin(normalized);
  status.classList.remove('is-ok', 'is-warn', 'is-bad');
  if (!normalized) {
    status.textContent = 'Letters are capitalized automatically. VINs never use I, O or Q.';
  } else if (!result.valid) {
    status.textContent = normalized.length < VIN_LENGTH && !/[IOQ]/.test(normalized) && /^[A-Z0-9]*$/.test(normalized)
      ? `${VIN_LENGTH - normalized.length} more character${VIN_LENGTH - normalized.length === 1 ? '' : 's'} to go.`
      : result.message;
    status.classList.add(normalized.length < VIN_LENGTH ? 'is-warn' : 'is-bad');
  } else if (result.checkDigitOk === false) {
    status.textContent = result.message;
    status.classList.add('is-warn');
  } else {
    status.textContent = 'Valid VIN format.';
    status.classList.add('is-ok');
  }
}

function updateDescriptionCount() {
  const length = qs('#v-description').value.length;
  const el = qs('[data-desc-count]');
  el.textContent = `${formatNumber(length)} / ${formatNumber(RULES.descriptionMax)} characters${length > RULES.descriptionRecommended ? ' · shorter descriptions are easier to read on phones' : length ? '' : ' · 2–5 short sentences is plenty'}`;
}

function updateFeatureCount() {
  const n = readForm().features.length;
  qs('[data-feature-count]').textContent = n ? `${n} selected` : '';
}

function updatePhotoCount() {
  const n = photos ? photos.count() : 0;
  qs('[data-photo-count]').textContent = n ? `${n} photo${n === 1 ? '' : 's'}` : '';
}

function currentCandidate() {
  return { ...vehicle, ...readForm() };
}

function renderPublishing() {
  const candidate = currentCandidate();
  const readiness = publishReadiness(candidate, photos ? photos.readinessPhotos() : []);
  const checks = [
    ['Year', candidate.year > 0], ['Make', Boolean(candidate.make)], ['Model', Boolean(candidate.model)],
    ['Price', candidate.price > 0], ['Mileage', Number.isFinite(candidate.mileage)],
    ['At least one photo', photos && photos.count() > 0], ['Cover photo', photos && photos.readinessPhotos().some((p) => p.isCover)]
  ];
  const statusLine = mode === 'add'
    ? 'New vehicles are saved as unpublished drafts. Publishing makes the vehicle Available and shows it on the public site.'
    : vehicle.isPublished
      ? 'This vehicle is published. Saving changes updates the public listing.'
      : vehicle.status === STATUS.SOLD
        ? 'Sold vehicles can’t be published. They stay in Sold history.'
        : 'This vehicle is not published — customers can’t see it.';
  setHtml(qs('[data-publishing]'), html`
    <div class="publishing__state">
      <p><span class="muted">Status</span> ${statusBadge(vehicle.status)} ${mode === 'edit' ? publishBadge(vehicle) : html`<span class="pub pub--off">${icon('eyeOff')}Not published</span>`} ${demoBadge(vehicle)}</p>
      <p class="muted">${statusLine}</p>
      ${mode === 'edit' && vehicle.isPublished ? html`<button type="button" class="btn btn--ghost btn--sm" data-unpublish>${icon('eyeOff')}Unpublish</button>` : ''}
    </div>
    <div class="readiness ${readiness.ready ? 'readiness--ready' : ''}">
      <p class="readiness__title">${readiness.ready ? html`${icon('checkCircle')} Ready to publish` : 'Needed before publishing'}</p>
      <ul class="readiness__checks">
        ${checks.map(([label, ok]) => html`<li class="${ok ? 'is-ok' : 'is-missing'}">${icon(ok ? 'check' : 'x')}<span>${label}</span><span class="visually-hidden">${ok ? ' — done' : ' — missing'}</span></li>`)}
      </ul>
      ${readiness.warnings.length ? html`<p class="readiness__warn">${icon('info')} ${readiness.warnings.join(' ')}</p>` : ''}
    </div>`);
  const unpublish = qs('[data-unpublish]');
  if (unpublish) {
    unpublish.addEventListener('click', async () => {
      if (isDirty() && !(await confirmDialog({ title: 'Unpublish without saving?', message: 'Your unsaved edits will be discarded when the page reloads.', confirmLabel: 'Unpublish', tone: 'danger' }))) return;
      setLeaveGuard(null);
      await runVehicleAction('unpublish', vehicle, () => window.location.reload());
    });
  }
}

function updateSaveStatus() {
  const status = qs('[data-save-status]');
  if (saving) { status.textContent = 'Saving…'; return; }
  if (photos && photos.isBusy()) { status.textContent = 'Processing photos…'; return; }
  status.textContent = isDirty() ? 'Unsaved changes' : mode === 'add' ? 'New vehicle — not saved yet' : 'All changes saved';
  status.classList.toggle('is-dirty', isDirty());
}

function refreshLive() {
  updateSaveStatus();
  renderPublishing();
  updateFeatureCount();
  updatePhotoCount();
}

/* ------------------------------------------------------------------ features */

function addCustomFeature() {
  const input = qs('#custom-feature');
  const value = input.value.trim().replace(/\s+/g, ' ');
  if (!value) return;
  const all = readForm().features.map((f) => f.toLowerCase());
  const standardMatch = STANDARD_FEATURES.find((f) => f.toLowerCase() === value.toLowerCase());
  if (standardMatch) {
    const box = qsa('input[name="features"]').find((el) => el.value === standardMatch);
    if (box) box.checked = true;
    announce(`${standardMatch} selected.`);
  } else if (all.includes(value.toLowerCase())) {
    toast(`“${value}” is already added.`, { tone: 'info' });
  } else {
    qs('[data-custom-features]').insertAdjacentHTML('beforeend', String(html`<li><button type="button" class="chip chip--on" data-remove-feature="${value}" aria-label="Remove feature: ${value}">${value}${icon('x')}</button></li>`));
    announce(`${value} added.`);
  }
  input.value = '';
  input.focus();
  refreshLive();
}

/* ------------------------------------------------------------------ save */

function setSaving(on) {
  saving = on;
  qsa('.save-bar button').forEach((b) => { b.disabled = on; });
  updateSaveStatus();
}

function focusMissing(field) {
  const target = qs(FIELD_FOCUS[field] || `#v-${field}`);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (target.focus) target.focus({ preventScroll: true });
}

/**
 * Two employees can have the same vehicle open. Saving writes every field on this
 * screen, so warn before replacing changes someone else saved in the meantime.
 */
async function confirmNotStale() {
  if (mode !== 'edit' || !vehicle.id) return true;
  let current = null;
  try {
    current = await vehicleService.getVehicle(vehicle.id);
  } catch (err) {
    return true; // the save itself reports the real problem
  }
  if (!current || current.updatedAt === vehicle.updatedAt) return true;
  return confirmDialog({
    title: 'This vehicle was changed',
    message: 'Someone else saved changes to this vehicle after you opened it.',
    detail: 'Saving now replaces their listing details with what is on this screen. To see their changes first, cancel and reload the page.',
    confirmLabel: 'Save anyway',
    cancelLabel: 'Cancel'
  });
}

async function save({ publish = false } = {}) {
  if (photos.isBusy()) {
    toast('Please wait — photos are still processing.', { tone: 'warning' });
    return;
  }
  const data = readForm();
  const errors = validateVehicle({ ...vehicle, ...data });
  if (Object.keys(errors).length) {
    showErrors(errors);
    return;
  }
  clearErrors();
  if (!(await confirmNotStale())) return;
  if (publish) {
    const readiness = publishReadiness({ ...vehicle, ...data }, photos.readinessPhotos());
    if (!readiness.ready) {
      const choice = await readinessDialog({ readiness, fixLabel: 'Fix now' });
      if (choice === 'fix') focusMissing(readiness.missing[0].field);
      return;
    }
  }

  setSaving(true);
  try {
    const result = await vehicleService.saveVehicle({ id: vehicle.id || null, data, photoItems: photos.getItems(), publish });
    setLeaveGuard(null);
    const id = encodeURIComponent(result.vehicle.id);
    if (result.photoError) {
      flash(`Vehicle saved, but photos couldn’t be stored: ${result.photoError.message}`, 'error');
      window.location.href = `edit-vehicle.html?id=${id}`;
    } else if (publish) {
      flash('Vehicle published.');
      window.location.href = `vehicle.html?id=${id}`;
    } else if (mode === 'add') {
      flash('Draft saved. It isn’t visible to customers until you publish it.');
      window.location.href = `edit-vehicle.html?id=${id}`;
    } else {
      toast('Changes saved.');
      await loadVehicle(result.vehicle.id);
    }
  } catch (err) {
    if (err instanceof ValidationError) showErrors(err.errors);
    else if (err instanceof NotReadyError) {
      const choice = await readinessDialog({ readiness: err.readiness, fixLabel: 'Fix now' });
      if (choice === 'fix') focusMissing(err.readiness.missing[0].field);
    } else toastError(err && err.message ? err.message : 'The vehicle couldn’t be saved.');
  } finally {
    setSaving(false);
    refreshLive();
  }
}

async function preview() {
  const candidate = currentCandidate();
  const { dto, visibility } = publicListingService.buildPreview(
    { ...candidate, status: candidate.status === STATUS.DRAFT ? STATUS.AVAILABLE : candidate.status, isPublished: true },
    await photos.previewPhotos()
  );
  const current = publicListingService.buildPreview(candidate, []).visibility;
  await openPublicPreview({ dto, visibility: current.visible ? visibility : { ...current, reason: `${current.reason} This is how it will look once published.` }, isDemo: candidate.isDemo });
}

/* ------------------------------------------------------------------ page */

function renderHeader() {
  const title = mode === 'add' ? 'Add Vehicle' : `Edit ${fullTitle(vehicle)}`;
  document.title = `${mode === 'add' ? 'Add Vehicle' : `Edit ${fullTitle(vehicle)}`} | Cela Inventory Manager`;
  return html`
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="inventory.html">Inventory</a></li>
        ${mode === 'edit' ? html`<li><a href="vehicle.html?id=${encodeURIComponent(vehicle.id)}">${fullTitle(vehicle)}</a></li>` : ''}
        <li><span aria-current="page">${mode === 'add' ? 'Add Vehicle' : 'Edit'}</span></li>
      </ol>
    </nav>
    <header class="page-header">
      <div>
        <h1>${title}</h1>
        <p class="page-header__sub">${mode === 'add'
          ? 'Fill in what you know — you can save a draft anytime and finish later.'
          : html`${vehicle.stockNumber ? `Stock #${vehicle.stockNumber} · ` : ''}${STATUS_LABELS[vehicle.status]}${vehicle.isPublished ? ' · Published' : ' · Not published'}`}</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--ghost" data-preview>${icon('eye')}Preview Public Listing</button>
      </div>
    </header>`;
}

async function loadVehicle(id) {
  vehicle = id ? await vehicleService.getVehicle(id) : createVehicle();
  if (photos) photos.destroy();

  setHtml(qs('#main'), html`
    <div class="page__inner page__inner--form">
      ${renderHeader()}
      ${getParam('publish') ? html`<p class="notice notice--info" role="status">${icon('info')}<span>Complete the items listed under <a href="#sec-publishing">Publishing</a>, then press <strong>Publish Vehicle</strong>.</span></p>` : ''}
      <div class="form-layout">
        ${renderFormNav()}
        <div class="form-main">${renderVehicleForm({ vehicle, mode })}</div>
      </div>
    </div>`);

  photos = createPhotoManager(qs('[data-photo-manager]'), { onChange: refreshLive });
  if (vehicle.id) await photos.load(await photoService.getPhotos(vehicle.id));

  baseline = serialize();
  bindForm();
  updateVinStatus();
  updateDescriptionCount();
  refreshLive();
  setLeaveGuard(isDirty);
}

function bindForm() {
  const form = qs('#vehicle-form');

  form.addEventListener('input', (event) => {
    if (event.target.id === 'v-vin') updateVinStatus();
    if (event.target.id === 'v-description') updateDescriptionCount();
    if (event.target.getAttribute('aria-invalid') === 'true') {
      event.target.removeAttribute('aria-invalid');
      const slot = qs(`#${event.target.id}-error`);
      if (slot) { slot.hidden = true; slot.textContent = ''; }
    }
    refreshLive();
  });
  form.addEventListener('change', refreshLive);

  // Tidy numbers on blur: "16995" → "16,995"
  form.addEventListener('focusout', (event) => {
    const el = event.target;
    if (el.matches('[data-money]')) {
      const n = parseMoney(el.value);
      if (Number.isFinite(n)) el.value = formatNumber(n);
    } else if (el.matches('[data-integer]') && el.id === 'v-mileage') {
      const n = parseInteger(el.value);
      if (Number.isFinite(n)) el.value = formatNumber(n);
    }
  });

  form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.id === 'custom-feature') {
      event.preventDefault();
      addCustomFeature();
    }
  });
}

/* <main> outlives re-renders (it's the page container), so bind its clicks once. */
function bindPageOnce() {
  const main = qs('#main');
  main.addEventListener('click', async (event) => {
    const button = event.target.closest('button, a');
    if (!button) return;
    if (button.matches('[data-add-feature]')) addCustomFeature();
    else if (button.matches('[data-remove-feature]')) {
      const label = button.dataset.removeFeature;
      button.closest('li').remove();
      announce(`${label} removed.`);
      qs('#custom-feature').focus();
      refreshLive();
    } else if (button.matches('[data-save]')) save();
    else if (button.matches('[data-publish]')) save({ publish: true });
    else if (button.matches('[data-preview]')) preview();
    else if (button.matches('[data-cancel]')) {
      window.location.href = mode === 'edit' ? `vehicle.html?id=${encodeURIComponent(vehicle.id)}` : 'inventory.html';
    }
  });
}

async function start() {
  if (mode === 'edit') {
    if (!vehicleId) {
      renderPageMessage({ title: 'No vehicle selected', message: 'Open a vehicle from Inventory to edit it.', actions: html`<a class="btn btn--primary" href="inventory.html">Go to Inventory</a>` });
      return;
    }
    try {
      const existing = await vehicleService.getVehicle(vehicleId);
      if (existing.status === STATUS.ARCHIVED) {
        renderPageMessage({
          iconName: 'archive',
          title: 'This vehicle is archived',
          message: `${fullTitle(existing)} is archived. Restore it before editing.`,
          actions: html`<a class="btn btn--primary" href="vehicle.html?id=${encodeURIComponent(existing.id)}">View vehicle</a><a class="btn btn--ghost" href="archived.html">Archived vehicles</a>`
        });
        return;
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        renderPageMessage({ title: 'Vehicle not found', message: 'This vehicle doesn’t exist. It may have been deleted permanently.', actions: html`<a class="btn btn--primary" href="inventory.html">Back to Inventory</a>` });
        return;
      }
      throw err;
    }
  }
  bindPageOnce();
  await loadVehicle(mode === 'edit' ? vehicleId : null);
}

initLayout({ page: mode === 'edit' ? 'edit' : 'add', title: mode === 'edit' ? 'Edit Vehicle' : 'Add Vehicle' })
  .then(start)
  .catch(handlePageError);
