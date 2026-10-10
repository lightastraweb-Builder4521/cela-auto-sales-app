/* Activity log service — records who did what to which vehicle, and when. */
import { getRepository } from '../data/repository.js';
import { authService } from './auth-service.js';
import { fullTitle, INTERNAL_FIELDS, FIELD_LABELS } from '../models/vehicle.js';
import { createId, nowIso } from '../utils/misc.js';

function scrubChanges(changes = []) {
  // Internal financial/notes fields: record THAT they changed, never the values.
  return changes.map((change) => (INTERNAL_FIELDS.includes(change.field)
    ? { field: change.field, label: FIELD_LABELS[change.field] || change.field, before: null, after: null, redacted: true }
    : { ...change, label: change.label || FIELD_LABELS[change.field] || change.field }));
}

export const activityService = {
  /** entry: { action, vehicle, summary, changes?, at? } */
  async record({ action, vehicle, summary, changes = [], at }) {
    const entry = {
      id: createId(),
      createdAt: at || nowIso(),
      action,
      vehicleId: vehicle ? vehicle.id : null,
      stockNumber: vehicle ? vehicle.stockNumber || '' : '',
      vehicleLabel: vehicle ? fullTitle(vehicle) : '',
      summary: summary || '',
      changes: scrubChanges(changes),
      isDemo: Boolean(vehicle && vehicle.isDemo),
      ...authService.actor()
    };
    await getRepository().activity.add(entry);
    return entry;
  },

  /** Newest first. Filters: vehicleId, action (prefix ok, e.g. "photo."), from/to ISO, search, limit. */
  async getActivity({ vehicleId, action, from, to, search, limit } = {}) {
    const repo = getRepository();
    let entries = vehicleId ? await repo.activity.listByVehicle(vehicleId) : await repo.activity.list();
    entries = entries.filter((e) => e && e.id && e.createdAt);
    if (action) entries = entries.filter((e) => (action.endsWith('.') ? e.action.startsWith(action) : e.action === action));
    if (from) entries = entries.filter((e) => e.createdAt >= from);
    if (to) entries = entries.filter((e) => e.createdAt <= to);
    if (search) {
      const q = search.trim().toLowerCase();
      entries = entries.filter((e) => [e.vehicleLabel, e.stockNumber, e.summary, e.actorName].join(' ').toLowerCase().includes(q));
    }
    entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return limit ? entries.slice(0, limit) : entries;
  },

  getRecent(limit = 10) {
    return this.getActivity({ limit });
  }
};
