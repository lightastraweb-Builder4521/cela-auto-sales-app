/* Status + publishing badges used across every list and detail view. */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { STATUS_LABELS, STATUS } from '../models/vehicle.js';
import { DEALERSHIP } from '../config.js';
import { formatZonedDateTime } from '../utils/format.js';

export function statusBadge(status) {
  return html`<span class="badge badge--${String(status).toLowerCase()}">${STATUS_LABELS[status] || status}</span>`;
}

export function publishBadge(vehicle) {
  if (vehicle.status === STATUS.ARCHIVED) return '';
  if (vehicle.isPublished) return html`<span class="pub pub--on">${icon('globe')}Published</span>`;
  if (vehicle.publishScheduled && vehicle.publishAt) {
    const when = new Date(vehicle.publishAt).toLocaleString('en-US', { timeZone: DEALERSHIP.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return html`<span class="pub pub--sched" data-scheduled-badge title="Scheduled publication: ${formatZonedDateTime(vehicle.publishAt, DEALERSHIP.timeZone)}">${icon('calendar')}Scheduled · ${when}</span>`;
  }
  return html`<span class="pub pub--off">${icon('eyeOff')}Not published</span>`;
}

export function demoBadge(vehicle) {
  return vehicle.isDemo ? html`<span class="badge badge--demo" title="Development demo data">Demo</span>` : '';
}
