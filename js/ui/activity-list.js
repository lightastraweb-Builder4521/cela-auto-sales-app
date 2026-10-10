/* Activity timeline rendering (dashboard, activity page, vehicle details). */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatTime, formatDateTime, formatLongDate, formatCurrency, formatMileage } from '../utils/format.js';
import { actionMeta } from '../models/activity.js';

function describeValue(field, value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (field === 'price' || field === 'salePrice') return formatCurrency(value);
  if (field === 'mileage') return formatMileage(value);
  if (field === 'soldAt') return formatDateTime(value);
  if (Array.isArray(value)) return value.join(', ') || 'none';
  return String(value);
}

/**
 * entries: activity entries (newest first).
 * existingIds: Set of vehicle ids that still exist (deleted vehicles aren't linked).
 * showVehicle: false inside a single vehicle's timeline.
 * showDetails: show before/after values when present.
 */
export function activityList(entries, { existingIds = new Set(), showVehicle = true, showDetails = false, groupByDay = false } = {}) {
  let lastDay = '';
  return html`
    <ol class="activity">
      ${entries.map((entry) => {
        const meta = actionMeta(entry.action);
        const day = formatLongDate(entry.createdAt);
        const heading = groupByDay && day !== lastDay ? html`<li class="activity__day">${day}</li>` : '';
        lastDay = day;
        const detailRows = showDetails ? (entry.changes || []).filter((c) => !c.redacted && (c.before !== undefined || c.after !== undefined)) : [];
        const vehicleLink = entry.vehicleId && existingIds.has(entry.vehicleId)
          ? html`<a href="vehicle.html?id=${encodeURIComponent(entry.vehicleId)}">${entry.vehicleLabel || 'Vehicle'}</a>`
          : html`<span>${entry.vehicleLabel || 'Vehicle'}</span>`;
        return html`${heading}
          <li class="activity__item activity__item--${meta.tone}">
            <span class="activity__icon" aria-hidden="true">${icon(meta.icon)}</span>
            <div class="activity__body">
              <p class="activity__top">
                <time datetime="${entry.createdAt}" title="${formatDateTime(entry.createdAt)}">${groupByDay ? formatTime(entry.createdAt) : formatDateTime(entry.createdAt)}</time>
                ${showVehicle ? html`<span class="activity__vehicle">${vehicleLink}${entry.stockNumber ? html` <span class="muted">#${entry.stockNumber}</span>` : ''}</span>` : ''}
              </p>
              <p class="activity__summary"><span class="activity__label">${meta.label}</span>${entry.summary && entry.summary !== meta.label ? html` — ${entry.summary}` : ''}</p>
              ${detailRows.length ? html`<ul class="activity__changes">${detailRows.map((c) => html`<li><span>${c.label}</span> ${describeValue(c.field, c.before)} → ${describeValue(c.field, c.after)}</li>`)}</ul>` : ''}
              <p class="activity__actor">Changed by ${entry.actorName || 'Unknown user'}</p>
            </div>
          </li>`;
      })}
    </ol>`;
}
