/* Shared pieces for vehicle lists (inventory, sold, archived, dashboard). */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { fullTitle, vehicleTitle } from '../models/vehicle.js';
import { photoService } from '../services/photo-service.js';
import { demoBadge } from './badges.js';

/** Map vehicleId → thumbnail object URL (null when a vehicle has no photos). */
export async function loadCoverUrls(vehicles) {
  const index = await photoService.getCoverIndex();
  const urls = new Map();
  await Promise.all(vehicles.map(async (v) => {
    const entry = index.get(v.id);
    urls.set(v.id, entry && entry.cover ? await photoService.getUrl(entry.cover, 'thumb') : null);
  }));
  return { urls, index };
}

export function thumb(vehicle, url, className = '') {
  return url
    ? html`<span class="thumb ${className}"><img src="${url}" alt="" loading="lazy" decoding="async"></span>`
    : html`<span class="thumb thumb--empty ${className}" title="No photos yet">${icon('camera')}</span>`;
}

export function vehicleName(vehicle, { link = true } = {}) {
  const title = vehicleTitle(vehicle);
  return html`
    <span class="vname">
      ${link ? html`<a class="vname__title" href="vehicle.html?id=${encodeURIComponent(vehicle.id)}">${title}</a>` : html`<span class="vname__title">${title}</span>`}
      <span class="vname__sub">${vehicle.trim || ''}${vehicle.stockNumber ? html`<span class="vname__stock">#${vehicle.stockNumber}</span>` : ''}${demoBadge(vehicle)}</span>
    </span>`;
}

export function emptyState({ iconName = 'car', title, text = '', actions = '' }) {
  return html`
    <section class="empty-state">
      <span class="empty-state__icon">${icon(iconName)}</span>
      <h2>${title}</h2>
      ${text ? html`<p>${text}</p>` : ''}
      ${actions ? html`<div class="btn-row btn-row--center">${actions}</div>` : ''}
    </section>`;
}

export const vehicleLabel = fullTitle;
