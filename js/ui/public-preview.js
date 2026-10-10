/* "Preview Public Listing" — shows what customers will see, built ONLY from
   the Public DTO (models/public-dto.js). It never touches the real Public site. */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatCurrency, formatNumber, formatDateTime } from '../utils/format.js';
import { openDialog } from './dialogs.js';

const STATUS_TEXT = { AVAILABLE: 'Available', PENDING: 'Sale Pending', SOLD: 'Sold' };

function priceBlock(dto) {
  if (dto.price === null || dto.price === undefined) return html`<span class="pp-price">Call for Price</span>`;
  if (dto.salePrice !== null && dto.salePrice !== undefined) {
    return html`<span class="pp-price">${formatCurrency(dto.salePrice)}</span> <s class="pp-was">${formatCurrency(dto.price)}</s>`;
  }
  return html`<span class="pp-price">${formatCurrency(dto.price)}</span>`;
}

function statusPill(dto) {
  const tone = (dto.status || 'AVAILABLE').toLowerCase();
  return html`<span class="pp-status pp-status--${tone}">${STATUS_TEXT[dto.status] || 'Available'}</span>`;
}

function card(dto) {
  const specs = [dto.mileage !== null && dto.mileage !== undefined ? `${formatNumber(dto.mileage)} miles` : '', dto.transmission, dto.drivetrain].filter(Boolean);
  const photo = dto.photos[0];
  return html`
    <article class="pp-card">
      <div class="pp-card__media">
        ${photo ? html`<img src="${photo.url}" alt="${photo.alt}">` : html`<div class="pp-empty">${icon('camera')}<span>Photos coming soon</span></div>`}
        ${statusPill(dto)}
      </div>
      <div class="pp-card__body">
        <h4 class="pp-card__title">${[dto.year, dto.make, dto.model].filter(Boolean).join(' ')}</h4>
        ${dto.trim ? html`<p class="pp-card__trim">${dto.trim}</p>` : ''}
        <p class="pp-card__price">${priceBlock(dto)}</p>
        ${specs.length ? html`<p class="pp-card__specs">${specs.join(' • ')}</p>` : ''}
        <div class="pp-card__foot">
          <span>${dto.stockNumber ? `Stock #${dto.stockNumber}` : ''}</span>
          <span class="pp-btn">View Details</span>
        </div>
      </div>
    </article>`;
}

function detail(dto) {
  const rows = [
    ['Year', dto.year], ['Make', dto.make], ['Model', dto.model], ['Trim', dto.trim], ['Body Style', dto.bodyStyle],
    ['Mileage', dto.mileage !== null && dto.mileage !== undefined ? `${formatNumber(dto.mileage)} miles` : ''],
    ['Exterior Color', dto.exteriorColor], ['Interior Color', dto.interiorColor], ['Engine', dto.engine],
    ['Transmission', dto.transmission], ['Drivetrain', dto.drivetrain], ['Fuel Type', dto.fuelType],
    ['Doors', dto.doors], ['Seats', dto.seats], ['VIN', dto.vin], ['Stock Number', dto.stockNumber]
  ].filter(([, value]) => value !== '' && value !== null && value !== undefined);
  return html`
    <div class="pp-detail">
      <div class="pp-gallery">
        ${dto.photos[0] ? html`<img class="pp-gallery__main" src="${dto.photos[0].url}" alt="${dto.photos[0].alt}">` : html`<div class="pp-empty pp-empty--tall">${icon('camera')}<span>Photos coming soon</span></div>`}
        ${dto.photos.length > 1 ? html`<div class="pp-gallery__thumbs">${dto.photos.slice(0, 8).map((p) => html`<img src="${p.url}" alt="">`)}${dto.photos.length > 8 ? html`<span>+${dto.photos.length - 8}</span>` : ''}</div>` : ''}
      </div>
      <div class="pp-summary">
        ${statusPill(dto)}
        <h4 class="pp-summary__title">${[dto.year, dto.make, dto.model].filter(Boolean).join(' ')}</h4>
        ${dto.trim ? html`<p class="pp-card__trim">${dto.trim}</p>` : ''}
        <p class="pp-summary__price">${priceBlock(dto)}</p>
        <span class="pp-btn pp-btn--block">Call (208) 713-1487</span>
      </div>
      ${dto.description ? html`<div class="pp-block"><h5>Vehicle Description</h5><p class="pp-desc">${dto.description}</p></div>` : ''}
      ${rows.length ? html`<div class="pp-block"><h5>Specifications</h5><dl class="pp-specs">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>` : ''}
      ${dto.features.length ? html`<div class="pp-block"><h5>Features</h5><ul class="pp-features">${dto.features.map((f) => html`<li>${icon('check')}${f}</li>`)}</ul></div>` : ''}
    </div>`;
}

export function openPublicPreview({ dto, visibility, isDemo = false }) {
  const json = JSON.stringify({ ...dto, photos: dto.photos.map((p) => ({ url: p.url.startsWith('blob:') ? '(local preview image)' : p.url, alt: p.alt })) }, null, 2);
  return openDialog({
    title: 'Public listing preview',
    size: 'xl',
    body: html`
      <div class="pp-banner ${visibility.visible ? 'pp-banner--on' : 'pp-banner--off'}">
        ${icon(visibility.visible ? 'globe' : 'eyeOff')}
        <div>
          <strong>${visibility.visible ? 'Visible to customers' : 'Hidden from customers right now'}</strong>
          <span>${visibility.reason}
            ${isDemo ? ' Demo data is never sent to the public site.' : ''}</span>
        </div>
      </div>
      <p class="modal__detail">${icon('info')} This is a preview. Customers see a listing only after it is saved and published.</p>
      <div class="pp">
        <section aria-label="Inventory card preview">
          <h3 class="pp-heading">Inventory card</h3>
          ${card(dto)}
        </section>
        <section aria-label="Listing page preview">
          <h3 class="pp-heading">Listing page</h3>
          ${detail(dto)}
        </section>
      </div>
      <details class="pp-json">
        <summary>Fields sent to the public site (${Object.keys(dto).length})</summary>
        <p class="modal__detail">Only customer-safe fields. Cost, acquisition source, reconditioning, sold price and notes are never included.</p>
        <pre><code>${json}</code></pre>
      </details>`,
    actions: html`<button type="submit" value="" formnovalidate class="btn btn--primary">Close preview</button>`
  });
}
