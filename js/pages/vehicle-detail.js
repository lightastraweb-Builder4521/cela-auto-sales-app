/* Employee vehicle details (vehicle.html?id=) — complete overview + quick actions.
   This is NOT the customer page; internal information is shown here, clearly marked. */
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import {
  formatCurrency, formatMileage, formatDate, formatDateTime, relativeTime, durationSince, formatTimeRemaining, formatZonedDateTime
} from '../utils/format.js';
import { getParam } from '../utils/misc.js';
import { RULES, DEALERSHIP, SUPPORT } from '../config.js';
import { STATUS, STATUS_LABELS, fullTitle, vehicleTitle } from '../models/vehicle.js';
import { publicVisibility } from '../models/public-dto.js';
import { vehicleService, NotFoundError } from '../services/vehicle-service.js';
import { photoService } from '../services/photo-service.js';
import { activityService } from '../services/activity-service.js';
import { publicListingService } from '../services/public-listing-service.js';
import { authService } from '../services/auth-service.js';
import { billingService } from '../services/billing-service.js';
import { initLayout, handlePageError, renderPageMessage } from '../ui/layout.js';
import { statusBadge, publishBadge, demoBadge } from '../ui/badges.js';
import { availableActions, runVehicleAction } from '../ui/vehicle-actions.js';
import { activityList } from '../ui/activity-list.js';
import { openMenu } from '../ui/menu.js';
import { openLightbox } from '../ui/lightbox.js';
import { openPublicPreview } from '../ui/public-preview.js';
import { flash, toast } from '../ui/toast.js';

const id = getParam('id');
const PRIMARY = ['edit', 'publish', 'schedule', 'changeSchedule', 'cancelSchedule', 'unpublish', 'available', 'pending', 'sold', 'restoreSold', 'restoreArchived'];
const BILLING_PAUSED = 'Scheduled publication is paused because the Light Astra Managed App Service is inactive.';
let USER_LABELS = {}; // employee id → display name (loaded from the employee directory)

let vehicle = null;
let photos = [];
let photoUrls = [];
let publishingPaused = false; // managed service inactive (UI hint; the server decides)
let renderSeq = 0; // "latest refresh wins": overlapping refreshes (e.g. action + quick Undo) can't paint stale data

const row = (label, value, { mono = false } = {}) => (value === null || value === undefined || value === ''
  ? ''
  : html`<div><dt>${label}</dt><dd class="${mono ? 'mono' : ''}">${value}</dd></div>`);

function visibilityPanel(v) {
  const vis = publicVisibility(v);
  return html`
    <section class="panel" aria-labelledby="public-title">
      <header class="panel__header"><h2 id="public-title">Public website</h2></header>
      <div class="visibility ${vis.visible ? 'visibility--on' : 'visibility--off'}">
        ${icon(vis.visible ? 'globe' : 'eyeOff')}
        <div>
          <strong>${vis.visible ? (v.status === STATUS.PENDING ? 'Visible · Sale Pending' : 'Visible to customers') : 'Hidden from customers'}</strong>
          <p>${vis.reason}</p>
          ${v.publishScheduled ? html`<p data-visibility-schedule>Scheduled to go public ${formatZonedDateTime(v.publishAt, DEALERSHIP.timeZone)}.</p>` : ''}
          ${v.isDemo ? html`<p class="muted">Demo data is never sent to the public site.</p>` : ''}
        </div>
      </div>
      <button type="button" class="btn btn--ghost btn--block" data-preview>${icon('eye')}Preview Public Listing</button>
    </section>`;
}

function saleCard(v) {
  if (v.status !== STATUS.SOLD) return '';
  return html`
    <section class="panel panel--sold" aria-labelledby="sale-title">
      <header class="panel__header"><h2 id="sale-title">Sale</h2></header>
      <p class="notice notice--warn" data-retention-notice>${icon('clock')}<span>This vehicle and its associated photos will be permanently deleted ${RULES.soldRetentionDays} days after being marked Sold.${v.deletionClaimedAt ? '' : ' Use Restore Vehicle to keep it.'}</span></p>
      <dl class="kv">
        ${row('Sold', formatDateTime(v.soldAt))}
        ${row('Permanent deletion', formatDateTime(v.deleteAfter))}
        ${row('Time remaining', v.deletionClaimedAt ? 'Being deleted now' : (formatTimeRemaining(v.deleteAfter) === 'Due now' ? 'Due now (next hourly cleanup)' : formatTimeRemaining(v.deleteAfter)))}
        ${row('Marked sold by', USER_LABELS[v.soldBy] || '—')}
        ${row('Last list price', formatCurrency(v.salePrice ?? v.price))}
      </dl>
    </section>`;
}

function internalCard(v) {
  const rows = [
    row('Purchase price', formatCurrency(v.purchasePrice, '')),
    row('Acquisition date', v.acquisitionDate ? formatDate(`${v.acquisitionDate}T12:00:00`) : ''),
    row('Acquired from', v.acquisitionSource),
    row('Reconditioning cost', formatCurrency(v.reconditioningCost, '')),
    row('Actual sold price', formatCurrency(v.soldPrice, '')),
    row('Sale note', v.soldNote)
  ].filter((r) => r !== '');
  return html`
    <section class="panel panel--internal" aria-labelledby="internal-title">
      <header class="panel__header">
        <h2 id="internal-title">Internal information</h2>
        <span class="internal__flag">${icon('lock')}Not shown publicly</span>
      </header>
      ${rows.length ? html`<dl class="kv">${rows}</dl>` : html`<p class="panel__empty">No internal information yet.</p>`}
      ${v.internalNotes ? html`<h3 class="panel__sub">Internal notes</h3><p class="prewrap">${v.internalNotes}</p>` : ''}
      ${v.employeeNotes ? html`<h3 class="panel__sub">Employee notes</h3><p class="prewrap">${v.employeeNotes}</p>` : ''}
    </section>`;
}

function statusBanner(v) {
  if (v.status === STATUS.ARCHIVED) {
    return html`<p class="notice notice--muted">${icon('archive')}<span>Archived ${formatDateTime(v.archivedAt)}. Hidden from the public site and active inventory. Restore it to work with it again.</span></p>`;
  }
  if (v.status === STATUS.SOLD) {
    return html`<p class="notice notice--sold">${icon('sold')}<span>Sold ${formatDateTime(v.soldAt)} (${durationSince(v.soldAt)} ago). This record stays in Sold history.</span></p>`;
  }
  if (v.status === STATUS.DRAFT) {
    return v.publishScheduled
      ? html`<p class="notice notice--info">${icon('info')}<span>Draft — not visible to customers until its scheduled publication.</span></p>`
      : html`<p class="notice notice--info">${icon('info')}<span>Draft — not visible to customers. Publish it now or schedule its publication when the details and photos are ready.</span></p>`;
  }
  return '';
}

/** Scheduled publication: when, and why it is waiting if the last attempt did not publish. */
function scheduleNotice(v) {
  if (!v.publishScheduled) return '';
  const reason = v.scheduleBlockedReason || (publishingPaused ? BILLING_PAUSED : '');
  const billing = reason === BILLING_PAUSED;
  const support = html`<a href="${SUPPORT.website}" target="_blank" rel="noopener">${SUPPORT.company} Support (${SUPPORT.websiteLabel})</a> · <a href="mailto:${SUPPORT.email}?subject=${encodeURIComponent(SUPPORT.subject)}">${SUPPORT.email}</a>`;
  return html`
    <p class="notice notice--info" data-schedule-notice>${icon('calendar')}<span><strong>Scheduled publication:</strong> <span data-scheduled-at>${formatZonedDateTime(v.publishAt, DEALERSHIP.timeZone)}</span>. It stays private until then and goes on the public website within about a minute of that time, after everything is checked again.</span></p>
    ${reason ? html`<div class="notice notice--warn" data-schedule-blocked>${icon('alert')}<span><strong>${reason}</strong>
      ${billing ? (authService.can('billing.manage')
        ? html` Nothing is deleted; it publishes automatically once the service is active again. <a href="billing.html">Manage Billing</a> · <a href="billing.html" data-reactivate>Reactivate Plan</a> · ${support}`
        : html` Nothing is deleted; it publishes automatically once an Admin reactivates the service. ${support}`) : ''}
      ${v.scheduleLastAttemptAt ? html` <span class="muted">(Last attempt ${formatDateTime(v.scheduleLastAttemptAt)}.)</span>` : ''}</span></div>` : ''}`;
}

function gallery() {
  if (!photos.length) {
    return html`
      <div class="gallery gallery--empty">
        <span class="gallery__noimg">${icon('camera')}<span>No photos yet</span></span>
        ${vehicle.status !== STATUS.ARCHIVED ? html`<a class="btn btn--primary" href="edit-vehicle.html?id=${encodeURIComponent(vehicle.id)}#sec-photos">${icon('upload')}Add Photos</a>` : ''}
      </div>`;
  }
  const coverIndex = Math.max(0, photos.findIndex((p) => p.isCover));
  const main = photoUrls[coverIndex];
  return html`
    <div class="gallery">
      <button type="button" class="gallery__main" data-open-photo="${coverIndex}" aria-label="View cover photo full size">
        ${main ? html`<img src="${main}" alt="${fullTitle(vehicle)} — cover photo">` : html`<span class="gallery__noimg">${icon('image')}<span>Photo unavailable</span></span>`}
        <span class="gallery__cover-tag">${icon('star')}Cover</span>
        <span class="gallery__count">${icon('camera')}${photos.length}</span>
      </button>
      <ul class="gallery__thumbs" aria-label="All photos">
        ${photos.map((p, i) => html`
          <li><button type="button" class="gallery__thumb${p.isCover ? ' is-cover' : ''}" data-open-photo="${i}" aria-label="View photo ${i + 1} of ${photos.length}${p.isCover ? ' (cover)' : ''}">
            ${photoUrls[i] ? html`<img src="${photoUrls[i]}" alt="" loading="lazy">` : icon('image')}
          </button></li>`)}
      </ul>
      ${vehicle.status !== STATUS.ARCHIVED ? html`<a class="link" href="edit-vehicle.html?id=${encodeURIComponent(vehicle.id)}#sec-photos">${icon('edit')} Manage photos</a>` : ''}
    </div>`;
}

async function render() {
  const seq = ++renderSeq;
  const freshVehicle = await vehicleService.getVehicle(id);
  const freshPhotos = await photoService.getPhotos(id);
  const freshUrls = await Promise.all(freshPhotos.map((p) => photoService.getUrl(p, 'display')));
  const history = await activityService.getActivity({ vehicleId: id });
  const paused = freshVehicle.publishScheduled ? await billingService.publishingBlocked() : false;
  if (seq !== renderSeq) return; // a newer refresh has started
  publishingPaused = paused;
  vehicle = freshVehicle;
  photos = freshPhotos;
  photoUrls = freshUrls;
  const v = vehicle;
  document.title = `${fullTitle(v)} | Cela Inventory Manager`;

  const actions = availableActions(v);
  const primary = actions.filter((a) => PRIMARY.includes(a.id));
  const more = actions.filter((a) => !PRIMARY.includes(a.id));
  const specs = [
    row('Year', v.year), row('Make', v.make), row('Model', v.model), row('Trim', v.trim),
    row('Body style', v.bodyStyle), row('Mileage', formatMileage(v.mileage, '')),
    row('Transmission', v.transmission), row('Drivetrain', v.drivetrain), row('Engine', v.engine),
    row('Fuel type', v.fuelType), row('Exterior color', v.exteriorColor), row('Interior color', v.interiorColor),
    row('Doors', v.doors), row('Seats', v.seats)
  ].filter((r) => r !== '');

  setHtml(qs('#main'), html`
    <div class="page__inner">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="${v.status === STATUS.SOLD ? 'sold.html' : v.status === STATUS.ARCHIVED ? 'archived.html' : 'inventory.html'}">${v.status === STATUS.SOLD ? 'Sold' : v.status === STATUS.ARCHIVED ? 'Archived' : 'Inventory'}</a></li>
          <li><span aria-current="page">${fullTitle(v)}</span></li>
        </ol>
      </nav>

      <header class="detail-header">
        <div class="detail-header__main">
          <p class="detail-header__badges">${statusBadge(v.status)} ${publishBadge(v)} ${demoBadge(v)}</p>
          <h1>${vehicleTitle(v)}${v.trim ? html` <span class="detail-header__trim">${v.trim}</span>` : ''}</h1>
          <p class="detail-header__ids">
            <span>Stock # <strong>${v.stockNumber || '—'}</strong></span>
            <span>VIN <strong class="mono">${v.vin || '—'}</strong></span>
          </p>
        </div>
        <div class="detail-actions" role="group" aria-label="Vehicle actions">
          ${primary.map((a) => html`<button type="button" class="btn ${a.id === 'edit' ? 'btn--primary' : a.id === 'sold' ? 'btn--dark' : 'btn--ghost'}" data-action="${a.id}">${icon(a.icon)}${a.label}</button>`)}
          ${more.length ? html`<button type="button" class="btn btn--ghost" data-more aria-haspopup="menu" aria-expanded="false">${icon('more')}More</button>` : ''}
        </div>
      </header>

      ${statusBanner(v)}
      ${scheduleNotice(v)}

      <div class="detail-grid">
        <div class="detail-main">
          ${gallery()}

          <section class="panel" aria-labelledby="desc-title">
            <header class="panel__header"><h2 id="desc-title">Description</h2></header>
            ${v.description ? html`<p class="prewrap">${v.description}</p>` : html`<p class="panel__empty">No description yet.</p>`}
          </section>

          <section class="panel" aria-labelledby="features-title">
            <header class="panel__header"><h2 id="features-title">Features</h2><span class="muted">${v.features.length || ''}</span></header>
            ${v.features.length ? html`<ul class="feature-list">${v.features.map((f) => html`<li>${icon('check')}${f}</li>`)}</ul>` : html`<p class="panel__empty">No features selected.</p>`}
          </section>

          <section class="panel" aria-labelledby="specs-title">
            <header class="panel__header"><h2 id="specs-title">Specifications</h2></header>
            ${specs.length ? html`<dl class="kv kv--2col">${specs}</dl>` : html`<p class="panel__empty">No specifications yet.</p>`}
          </section>

          <section class="panel" aria-labelledby="history-title">
            <header class="panel__header"><h2 id="history-title">Activity</h2><span class="muted">${history.length}</span></header>
            ${history.length ? activityList(history, { showVehicle: false, showDetails: true }) : html`<p class="panel__empty">No activity recorded yet.</p>`}
          </section>
        </div>

        <aside class="detail-side" aria-label="Price, publishing and internal details">
          <section class="panel price-card" aria-labelledby="price-title">
            <h2 class="visually-hidden" id="price-title">Price and mileage</h2>
            <p class="price-card__label">${v.salePrice !== null ? 'Sale price' : 'Price'}</p>
            <p class="price-card__price">${v.salePrice !== null ? formatCurrency(v.salePrice) : formatCurrency(v.price, 'No price yet')}</p>
            ${v.salePrice !== null ? html`<p class="price-card__was">Retail <s>${formatCurrency(v.price)}</s></p>` : ''}
            <p class="price-card__mileage">${icon('car')}${formatMileage(v.mileage, 'Mileage not entered')}</p>
          </section>

          ${saleCard(v)}
          ${visibilityPanel(v)}

          <section class="panel" aria-labelledby="dates-title">
            <header class="panel__header"><h2 id="dates-title">Record</h2></header>
            <dl class="kv">
              ${row('Date added', formatDateTime(v.createdAt))}
              ${row('Last updated', html`${relativeTime(v.updatedAt)} <span class="muted">(${formatDateTime(v.updatedAt)})</span>`)}
              ${row('Scheduled publication', v.publishScheduled ? formatZonedDateTime(v.publishAt, DEALERSHIP.timeZone) : '')}
              ${row('Scheduled by', v.publishScheduled ? html`${USER_LABELS[v.scheduleCreatedBy] || '—'}${v.scheduleCreatedAt ? html` <span class="muted">(${formatDateTime(v.scheduleCreatedAt)})</span>` : ''}` : '')}
              ${row('First published', v.publishedAt ? formatDateTime(v.publishedAt) : '')}
              ${row('Sold', v.soldAt ? formatDateTime(v.soldAt) : '')}
              ${row('Archived', v.archivedAt ? formatDateTime(v.archivedAt) : '')}
              ${row('Added by', USER_LABELS[v.createdBy] || '')}
              ${row('Photos', `${photos.length}`)}
            </dl>
          </section>

          ${internalCard(v)}
        </aside>
      </div>
    </div>`);
}

async function afterAction(updated) {
  if (!updated) {
    flash('Vehicle deleted permanently.');
    window.location.href = 'archived.html';
    return;
  }
  await render();
}

function bind() {
  const main = qs('#main');
  main.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.action) {
      await runVehicleAction(button.dataset.action, vehicle, afterAction);
    } else if (button.hasAttribute('data-more')) {
      const more = availableActions(vehicle).filter((a) => !PRIMARY.includes(a.id));
      openMenu(button, more.map((a) => ({ label: a.label, icon: a.icon, tone: a.tone, onSelect: () => runVehicleAction(a.id, vehicle, afterAction) })), { label: 'More actions' });
    } else if (button.hasAttribute('data-open-photo')) {
      openLightbox(photos.map((p, i) => ({ url: photoUrls[i], alt: `${fullTitle(vehicle)} — photo ${i + 1}`, caption: p.isCover ? 'Cover photo' : '' })), Number(button.dataset.openPhoto));
    } else if (button.hasAttribute('data-preview')) {
      const { dto, visibility } = await publicListingService.buildSavedPreview(vehicle);
      await openPublicPreview({ dto, visibility, isDemo: vehicle.isDemo });
    }
  });
}

async function start() {
  if (!id) {
    renderPageMessage({ title: 'No vehicle selected', message: 'Open a vehicle from Inventory to see its details.', actions: html`<a class="btn btn--primary" href="inventory.html">Go to Inventory</a>` });
    return;
  }
  try {
    USER_LABELS = Object.fromEntries(await authService.directory().catch(() => new Map()));
    await render();
    bind();
  } catch (err) {
    if (err instanceof NotFoundError) {
      renderPageMessage({ title: 'Vehicle not found', message: 'This vehicle doesn’t exist. It may have been deleted permanently.', actions: html`<a class="btn btn--primary" href="inventory.html">Back to Inventory</a><a class="btn btn--ghost" href="activity.html">View activity</a>` });
      return;
    }
    throw err;
  }
  if (!STATUS_LABELS[vehicle.status]) toast('This vehicle has an unknown status.', { tone: 'warning' });
}

window.addEventListener('cela:data-changed', () => { if (vehicle) render().catch(() => {}); });

initLayout({ page: 'vehicle', title: 'Vehicle' }).then(start).catch(handlePageError);
