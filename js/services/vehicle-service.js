/* ==========================================================================
   Vehicle service — all vehicle business rules live here.
   Pages call these functions; storage is reached only via the repository.

   Status (lifecycle) and publishing (public visibility) are separate:
     status:      DRAFT → AVAILABLE ⇄ PENDING → SOLD ;  any → ARCHIVED
     isPublished: true/false — only AVAILABLE / PENDING vehicles that are
                  published can be seen by customers (SOLD never).
     Scheduling:  publishScheduled + publishAt — a private vehicle waits for its one
                  scheduled time; the server publishes it then (after re-checking).
   ========================================================================== */
import { getRepository } from '../data/repository.js';
import { APP, RULES, DEALERSHIP } from '../config.js';
import {
  STATUS, STATUS_LABELS, INTERNAL_FIELDS, FIELD_LABELS,
  createVehicle as newVehicleRecord, normalizeVehicle, validateVehicle, publishReadiness, fullTitle
} from '../models/vehicle.js';
import { activityService } from './activity-service.js';
import { photoService } from './photo-service.js';
import { authService } from './auth-service.js';
import { createId, nowIso } from '../utils/misc.js';
import { getSupabase } from '../data/supabase-client.js';
import { formatCurrency, formatMileage, formatDateTime, formatZonedDateTime } from '../utils/format.js';

export const DELETE_FAILED = 'Deletion could not be completed. The vehicle has not been confirmed as fully removed. Please try again or contact Light Astra Support.';

/* ---------------------------- errors ---------------------------- */

export class ValidationError extends Error {
  constructor(errors) {
    super('Please fix the highlighted fields.');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('This vehicle could not be found. It may have been deleted.');
    this.name = 'NotFoundError';
  }
}

export class ActionNotAllowedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActionNotAllowedError';
  }
}

export class NotReadyError extends Error {
  constructor(readiness) {
    super('Vehicle isn’t ready to publish.');
    this.name = 'NotReadyError';
    this.readiness = readiness;
  }
}

/* ---------------------------- rules ---------------------------- */

/** Fields the vehicle editor may change. Status/publishing/dates change only via actions below. */
const EDITABLE_FIELDS = [
  'stockNumber', 'vin', 'year', 'make', 'model', 'trim', 'price', 'salePrice', 'mileage',
  'bodyStyle', 'transmission', 'drivetrain', 'engine', 'fuelType', 'exteriorColor', 'interiorColor',
  'doors', 'seats', 'description', 'features', 'featured',
  ...INTERNAL_FIELDS
];

const { DRAFT, AVAILABLE, PENDING, SOLD, ARCHIVED } = STATUS;

/** Which actions are allowed from which state. Single source of truth for buttons and services. */
export const TRANSITIONS = Object.freeze({
  publish: (v) => !v.isPublished && [DRAFT, AVAILABLE, PENDING].includes(v.status),
  schedule: (v) => !v.isPublished && [DRAFT, AVAILABLE, PENDING].includes(v.status) && !v.publishScheduled,
  changeSchedule: (v) => !v.isPublished && [DRAFT, AVAILABLE, PENDING].includes(v.status) && v.publishScheduled,
  cancelSchedule: (v) => !v.isPublished && [DRAFT, AVAILABLE, PENDING].includes(v.status) && v.publishScheduled,
  unpublish: (v) => v.isPublished && v.status !== ARCHIVED,
  available: (v) => [DRAFT, PENDING].includes(v.status),
  pending: (v) => [DRAFT, AVAILABLE].includes(v.status),
  sold: (v) => [DRAFT, AVAILABLE, PENDING].includes(v.status),
  restoreSold: (v) => v.status === SOLD && !v.deletionClaimedAt,
  archive: (v) => v.status !== ARCHIVED,
  restoreArchived: (v) => v.status === ARCHIVED,
  delete: (v) => v.status === ARCHIVED,
  deleteForever: (v) => v.status === SOLD,
  duplicate: () => true
});

export function canPerform(action, vehicle) {
  return Boolean(vehicle && TRANSITIONS[action] && TRANSITIONS[action](vehicle));
}

/* ---------------------------- helpers ---------------------------- */

const repo = () => getRepository();
const scheduleText = (value) => formatZonedDateTime(value, DEALERSHIP.timeZone);
/** Ends a schedule in the record (the database does the same whenever a vehicle goes public, Sold or Archived). */
const clearSchedule = (v) => { v.publishScheduled = false; v.publishAt = null; };
const scheduleEnded = (before, how) => (before.publishScheduled ? `; the scheduled publication (${scheduleText(before.publishAt)}) was ${how}` : '');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function load(id) {
  if (!id) throw new NotFoundError();
  const vehicle = normalizeVehicle(await repo().vehicles.get(id));
  if (!vehicle) throw new NotFoundError();
  return vehicle;
}

async function persist(vehicle) {
  vehicle.updatedAt = nowIso();
  vehicle.updatedBy = authService.actor().actorId;
  await repo().vehicles.save(vehicle);
  return vehicle;
}

function assertAllowed(action, vehicle) {
  if (!canPerform(action, vehicle)) {
    throw new ActionNotAllowedError(`This action isn’t available for a ${STATUS_LABELS[vehicle.status].toLowerCase()} vehicle.`);
  }
}

function pickEditable(data) {
  const out = {};
  EDITABLE_FIELDS.forEach((key) => { if (data[key] !== undefined) out[key] = data[key]; });
  if (typeof out.vin === 'string') out.vin = out.vin.toUpperCase().replace(/[\s-]/g, '');
  ['stockNumber', 'make', 'model', 'trim'].forEach((key) => {
    if (typeof out[key] === 'string') out[key] = out[key].trim();
  });
  return out;
}

async function uniquenessErrors(candidate) {
  const errors = {};
  const others = (await repo().vehicles.list()).map(normalizeVehicle).filter((v) => v && v.id !== candidate.id);
  const stock = (candidate.stockNumber || '').toLowerCase();
  if (stock) {
    const clash = others.find((v) => v.stockNumber.toLowerCase() === stock);
    if (clash) errors.stockNumber = `Stock #${candidate.stockNumber} is already used by ${fullTitle(clash)}.`;
  }
  if (candidate.vin) {
    const clash = others.find((v) => v.vin === candidate.vin && v.status !== SOLD && v.status !== ARCHIVED);
    if (clash) errors.vin = `This VIN is already in active inventory (${fullTitle(clash)}).`;
  }
  return errors;
}

async function validateOrThrow(candidate) {
  const errors = { ...validateVehicle(candidate), ...(await uniquenessErrors(candidate)) };
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

/** Turn an edit into specific activity entries (price, mileage, description, features, internal, other). */
async function logEdits(before, after) {
  const changed = EDITABLE_FIELDS.filter((key) => !same(before[key], after[key]));
  if (!changed.length) return;

  const priceFields = changed.filter((k) => k === 'price' || k === 'salePrice');
  for (const key of priceFields) {
    const label = key === 'price' ? 'Price' : 'Sale price';
    await activityService.record({
      action: 'price.changed',
      vehicle: after,
      summary: `${label} changed from ${formatCurrency(before[key], 'none')} to ${formatCurrency(after[key], 'none')}`,
      changes: [{ field: key, before: before[key], after: after[key] }]
    });
  }
  if (changed.includes('mileage')) {
    await activityService.record({
      action: 'mileage.changed',
      vehicle: after,
      summary: `Mileage changed from ${formatMileage(before.mileage, 'none')} to ${formatMileage(after.mileage, 'none')}`,
      changes: [{ field: 'mileage', before: before.mileage, after: after.mileage }]
    });
  }
  if (changed.includes('description')) {
    await activityService.record({ action: 'description.changed', vehicle: after, summary: 'Description updated' });
  }
  if (changed.includes('features')) {
    const added = after.features.filter((f) => !before.features.includes(f));
    const removed = before.features.filter((f) => !after.features.includes(f));
    const parts = [];
    if (added.length) parts.push(`Added ${added.join(', ')}`);
    if (removed.length) parts.push(`Removed ${removed.join(', ')}`);
    await activityService.record({ action: 'features.changed', vehicle: after, summary: parts.join(' · ') || 'Features updated' });
  }
  const internal = changed.filter((k) => INTERNAL_FIELDS.includes(k));
  if (internal.length) {
    await activityService.record({
      action: 'internal.updated',
      vehicle: after,
      summary: `Internal info updated: ${internal.map((k) => FIELD_LABELS[k]).join(', ')}`,
      changes: internal.map((field) => ({ field }))
    });
  }
  const other = changed.filter((k) => !['price', 'salePrice', 'mileage', 'description', 'features'].includes(k) && !INTERNAL_FIELDS.includes(k));
  if (other.length) {
    await activityService.record({
      action: 'vehicle.updated',
      vehicle: after,
      summary: `Updated ${other.map((k) => FIELD_LABELS[k] || k).join(', ')}`,
      changes: other.map((field) => ({ field, before: before[field], after: after[field] }))
    });
  }
}

async function changeState(id, action, mutate, activity) {
  const vehicle = await load(id);
  assertAllowed(action, vehicle);
  const before = { ...vehicle };
  mutate(vehicle);
  await persist(vehicle);
  await activityService.record({ ...activity(before, vehicle), vehicle });
  return vehicle;
}

/* ---------------------------- service ---------------------------- */

export const vehicleService = {
  /** All vehicles (normalized; corrupt records skipped), most recently updated first. */
  async getVehicles() {
    const rows = await repo().vehicles.list();
    return rows.map(normalizeVehicle).filter(Boolean)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  },

  getVehicle: (id) => load(id),

  async isStockNumberTaken(stockNumber, exceptId = null) {
    const errors = await uniquenessErrors({ id: exceptId, stockNumber, vin: '' });
    return Boolean(errors.stockNumber);
  },

  /** New vehicles always start as unpublished drafts. */
  async createVehicle(data) {
    const now = nowIso();
    const actor = authService.actor().actorId;
    const vehicle = newVehicleRecord({
      ...pickEditable(data),
      id: createId(),
      status: DRAFT,
      isPublished: false,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor
    });
    await validateOrThrow(vehicle);
    await repo().vehicles.save(vehicle);
    await activityService.record({ action: 'vehicle.created', vehicle, summary: 'Added as a draft' });
    return vehicle;
  },

  async updateVehicle(id, data) {
    const before = await load(id);
    const after = { ...before, ...pickEditable(data) };
    await validateOrThrow(after);
    const changed = EDITABLE_FIELDS.some((key) => !same(before[key], after[key]));
    if (!changed) return { vehicle: before, changed: false };
    await persist(after);
    await logEdits(before, after);
    return { vehicle: after, changed: true };
  },

  /**
   * One call for the editor's Save / Publish buttons:
   * create-or-update the record, persist photo changes, optionally publish.
   * Validation happens before anything is written.
   */
  async saveVehicle({ id = null, data, photoItems = null, publish = false }) {
    if (publish) {
      const candidate = { ...(id ? await load(id) : newVehicleRecord()), ...pickEditable(data) };
      const readiness = publishReadiness(candidate, (photoItems || []).filter((p) => !p.error));
      if (!readiness.ready) throw new NotReadyError(readiness);
    }
    let vehicle = id ? (await this.updateVehicle(id, data)).vehicle : await this.createVehicle(data);
    let photoSummary = null;
    if (photoItems) {
      try {
        photoSummary = await photoService.savePhotos(vehicle, photoItems);
      } catch (err) {
        // The vehicle itself is saved; report the photo problem separately so a
        // retry edits this vehicle instead of creating a duplicate.
        return { vehicle: await load(vehicle.id), photoSummary: null, photoError: err };
      }
      vehicle = await load(vehicle.id);
    }
    if (publish && canPerform('publish', vehicle)) {
      vehicle = await this.publishVehicle(vehicle.id);
    }
    return { vehicle, photoSummary, photoError: null };
  },

  async checkPublishReadiness(id) {
    const vehicle = await load(id);
    const photos = await photoService.getPhotos(id);
    return publishReadiness(vehicle, photos);
  },

  async publishVehicle(id) {
    const vehicle = await load(id);
    assertAllowed('publish', vehicle);
    const readiness = publishReadiness(vehicle, await photoService.getPhotos(id));
    if (!readiness.ready) throw new NotReadyError(readiness);
    return changeState(id, 'publish', (v) => {
      if (v.status === DRAFT) v.status = AVAILABLE;
      v.isPublished = true;
      v.publishedAt = v.publishedAt || nowIso();
      clearSchedule(v);
    }, (before) => ({
      action: 'vehicle.published',
      summary: `${before.status === DRAFT ? 'Published now and marked available' : 'Published now to the public site'}${scheduleEnded(before, 'replaced')}`
    }));
  },

  /**
   * Schedule Publication / Change Schedule: the vehicle's ONE publication time (UTC ISO).
   * It stays private until then. The server publishes it within about a minute of that
   * time, after checking everything again (data, photos, role, managed-service billing).
   */
  async schedulePublication(id, publishAt) {
    const vehicle = await load(id);
    const action = vehicle.publishScheduled ? 'changeSchedule' : 'schedule';
    assertAllowed(action, vehicle);
    const when = new Date(publishAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now() + 2 * 60 * 1000) {
      throw new ValidationError({ publishDate: 'Choose a date and time in the future.' });
    }
    const readiness = publishReadiness(vehicle, await photoService.getPhotos(id));
    if (!readiness.ready) throw new NotReadyError(readiness);
    return changeState(id, action, (v) => {
      v.publishScheduled = true;
      v.publishAt = when.toISOString();
    }, (before) => (before.publishScheduled
      ? { action: 'vehicle.schedule_changed', summary: `Scheduled publication moved from ${scheduleText(before.publishAt)} to ${scheduleText(when)}` }
      : { action: 'vehicle.schedule_created', summary: `Publication scheduled for ${scheduleText(when)} — stays private until then` }));
  },

  /** Cancel Schedule: nothing is published or deleted; the vehicle stays private as it is. */
  cancelSchedule: (id) => changeState(id, 'cancelSchedule', clearSchedule,
    (before) => ({ action: 'vehicle.schedule_canceled', summary: `Scheduled publication for ${scheduleText(before.publishAt)} canceled — stays private` })),

  unpublishVehicle: (id) => changeState(id, 'unpublish', (v) => { v.isPublished = false; },
    () => ({ action: 'vehicle.unpublished', summary: 'Removed from the public site' })),

  markAvailable: (id) => changeState(id, 'available', (v) => { v.status = AVAILABLE; },
    (before) => ({ action: 'vehicle.available', summary: `Status changed from ${STATUS_LABELS[before.status]} to Available`, changes: [{ field: 'status', before: before.status, after: AVAILABLE }] })),

  markPending: (id) => changeState(id, 'pending', (v) => { v.status = PENDING; },
    (before) => ({ action: 'vehicle.pending', summary: `Status changed from ${STATUS_LABELS[before.status]} to Pending`, changes: [{ field: 'status', before: before.status, after: PENDING }] })),

  /**
   * sale: { soldPrice (number|null, internal), note (internal) }.
   * The database records the sold time with its own clock, removes the vehicle from the
   * public site and starts the 7-day retention period (deletion after it unless restored).
   */
  async markSold(id, sale = {}) {
    const soldAt = new Date();
    if (sale.soldPrice !== null && sale.soldPrice !== undefined && (!Number.isFinite(sale.soldPrice) || sale.soldPrice < 0)) {
      throw new ValidationError({ soldPrice: 'Sold price must be a positive dollar amount.' });
    }
    return changeState(id, 'sold', (v) => {
      v.status = SOLD;
      v.soldAt = soldAt.toISOString();           // replaced by the database's own clock
      v.deleteAfter = new Date(soldAt.getTime() + RULES.soldRetentionDays * 86400000).toISOString(); // likewise (never sent)
      v.soldBy = authService.actor().actorId;
      v.soldPrice = Number.isFinite(sale.soldPrice) ? sale.soldPrice : null;
      v.soldNote = (sale.note || '').trim();
      v.isPublished = false;                     // off the public site at once (the database enforces it too)
      clearSchedule(v);                          // a Sold vehicle is never published by a schedule
    }, (before) => ({
      action: 'vehicle.sold',
      summary: `Marked sold (${formatDateTime(soldAt)}) — removed from the public site; permanent deletion after ${RULES.soldRetentionDays} days unless restored${scheduleEnded(before, 'canceled')}`,
      changes: [{ field: 'status', before: before.status, after: SOLD }]
    }));
  },

  /**
   * Restore Vehicle: undo a sale any time before the cleanup deletes it. The deletion is
   * canceled and everything is kept; the vehicle comes back as a private Draft (publishing —
   * Publish Now or a schedule — is a separate, explicit step). History stays in the activity log.
   */
  restoreSold: (id) => changeState(id, 'restoreSold', (v) => {
    v.status = DRAFT;
    v.isPublished = false;
    v.soldAt = null;
    v.soldBy = null;
    v.soldPrice = null;
    v.soldNote = '';
    v.deleteAfter = null;
    clearSchedule(v);                            // an old schedule never comes back
  }, (before) => ({
    action: 'vehicle.restored',
    summary: `Restored from Sold (was sold ${formatDateTime(before.soldAt)}) — permanent deletion canceled; back to Draft, not published`,
    changes: [{ field: 'status', before: SOLD, after: DRAFT }, { field: 'soldAt', label: 'Sold at', before: before.soldAt, after: null }]
  })),

  archiveVehicle: (id) => changeState(id, 'archive', (v) => {
    v.statusBeforeArchive = v.status;
    v.status = ARCHIVED;
    v.isPublished = false;
    v.archivedAt = nowIso();
    clearSchedule(v);
  }, (before) => ({ action: 'vehicle.archived', summary: `Archived (was ${STATUS_LABELS[before.status]})${scheduleEnded(before, 'canceled')}` })),

  /** Archived vehicles come back unpublished, in the status they had before. */
  restoreVehicle: (id) => changeState(id, 'restoreArchived', (v) => {
    v.status = v.statusBeforeArchive || DRAFT;
    v.statusBeforeArchive = null;
    v.archivedAt = null;
    v.isPublished = false;
  }, (before, after) => ({ action: 'vehicle.restored', summary: `Restored from archive as ${STATUS_LABELS[after.status]} (unpublished)` })),

  /**
   * Undo support: put status/publishing back exactly as captured in `snapshot`.
   * Used by toast "Undo" for archive and unpublish.
   */
  async revertState(id, snapshot, { action, summary }) {
    const vehicle = await load(id);
    ['status', 'isPublished', 'publishedAt', 'archivedAt', 'statusBeforeArchive'].forEach((key) => { vehicle[key] = snapshot[key]; });
    await persist(vehicle);
    await activityService.record({ action, vehicle, summary });
    return vehicle;
  },

  /**
   * Delete Forever — Admins only, SOLD vehicles only. An early run of the same server cleanup that removes a
   * sold vehicle after its retention period: Storage files first, then the records. The server checks the
   * session, the Admin role and that the vehicle is STILL Sold; nothing here is trusted by it.
   */
  async deleteSoldForever(id, { confirmation } = {}) {
    if (!authService.can('vehicle.delete')) throw new ActionNotAllowedError('Only an Admin can permanently delete vehicles.');
    if (confirmation !== 'DELETE') throw new ActionNotAllowedError('Type DELETE to confirm.');
    const vehicle = await load(id);
    // Same wording as the server, which makes this check again under a lock: this one only saves a round trip.
    if (!canPerform('deleteForever', vehicle)) throw new ActionNotAllowedError('This vehicle is no longer Sold, so it was not deleted. Refresh the page to see its current status.');
    // There is exactly one deleter and it lives on the server; the offline development backend has none.
    if (APP.backend !== 'supabase') throw new ActionNotAllowedError('Delete Forever is only available with the server backend.');
    const { error } = await getSupabase().functions.invoke('retention-cleanup', { body: { action: 'delete_forever', vehicle_id: id, confirm: confirmation } });
    if (error) {
      let message = DELETE_FAILED;
      try {
        const body = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
        if (body && typeof body.message === 'string' && body.message.length < 240) message = body.message;
      } catch (err) { /* keep the generic message */ }
      throw new ActionNotAllowedError(message);
    }
    return vehicle;
  },

  /** Permanent delete — admins only, archived vehicles only. Activity history is kept. */
  async deleteVehicle(id, { confirmation } = {}) {
    if (!authService.can('vehicle.delete')) throw new ActionNotAllowedError('Only an Admin can permanently delete vehicles.');
    if (confirmation !== 'DELETE PERMANENTLY') throw new ActionNotAllowedError('Type DELETE PERMANENTLY to confirm.');
    const vehicle = await load(id);
    assertAllowed('delete', vehicle);
    const photoCount = await photoService.deletePhotosForVehicle(id);
    await repo().vehicles.remove(id);
    await activityService.record({
      action: 'vehicle.deleted',
      vehicle,
      summary: `Deleted permanently (with ${photoCount} photo${photoCount === 1 ? '' : 's'})`
    });
    return vehicle;
  },

  /** Copy specs/features into a new draft. Photos, VIN, stock #, price, mileage and internal data are NOT copied. */
  async duplicateVehicle(id) {
    const source = await load(id);
    const copy = await this.createVehicle({
      year: source.year,
      make: source.make,
      model: source.model,
      trim: source.trim,
      bodyStyle: source.bodyStyle,
      transmission: source.transmission,
      drivetrain: source.drivetrain,
      engine: source.engine,
      fuelType: source.fuelType,
      exteriorColor: source.exteriorColor,
      interiorColor: source.interiorColor,
      doors: source.doors,
      seats: source.seats,
      description: source.description,
      features: source.features.slice()
    });
    await activityService.record({ action: 'vehicle.duplicated', vehicle: copy, summary: `Created from ${fullTitle(source)}${source.stockNumber ? ` (Stock #${source.stockNumber})` : ''}` });
    return copy;
  }
};
