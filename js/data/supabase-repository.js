/* ==========================================================================
   SUPABASE ADAPTER
   --------------------------------------------------------------------------
   Implements the same repository contract as local-repository.js, so services
   and pages are unchanged:

     vehicles  → tables `vehicles` + `vehicle_internal` (internal data is a
                 separate, employee-only table; merged into one record here)
     photos    → table `vehicle_photos`
     files     → private Storage bucket `vehicle-photos`
     activity  → table `activity_logs`
     meta      → table `dealership_settings`

   All camelCase ↔ snake_case conversion lives in this file.
   The browser uses only the publishable key + the signed-in employee's
   session; Row Level Security decides what each request may do.
   ========================================================================== */
import { SUPABASE } from '../supabase-config.js';
import { getSupabase } from './supabase-client.js';
import { billingService, isPublishingBlockedError, PUBLISHING_BLOCKED_MESSAGE } from '../services/billing-service.js';

export class BackendError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'BackendError';
    this.cause = cause;
  }
}

/* ---------------------------- field mapping ---------------------------- */

const VEHICLE_FIELDS = {
  id: 'id', stockNumber: 'stock_number', vin: 'vin', year: 'year', make: 'make', model: 'model', trim: 'trim',
  price: 'price', salePrice: 'sale_price', mileage: 'mileage', bodyStyle: 'body_style',
  transmission: 'transmission', drivetrain: 'drivetrain', engine: 'engine', fuelType: 'fuel_type',
  exteriorColor: 'exterior_color', interiorColor: 'interior_color', doors: 'doors', seats: 'seats',
  description: 'description', features: 'features', featured: 'featured',
  coverPhotoId: 'cover_photo_id', photoCount: 'photo_count', status: 'status',
  statusBeforeArchive: 'status_before_archive', isPublished: 'is_published',
  createdAt: 'created_at', updatedAt: 'updated_at', publishedAt: 'published_at',
  soldAt: 'sold_at', archivedAt: 'archived_at', deleteAfter: 'delete_after', deletionClaimedAt: 'deletion_claimed_at',
  publishScheduled: 'publish_scheduled', publishAt: 'publish_at', scheduleCreatedAt: 'schedule_created_at',
  scheduleCreatedBy: 'schedule_created_by', scheduleBlockedReason: 'schedule_blocked_reason', scheduleLastAttemptAt: 'schedule_last_attempt_at',
  createdBy: 'created_by', updatedBy: 'updated_by', soldBy: 'sold_by'
};

/* Internal dealership fields → table vehicle_internal (never public). */
const INTERNAL_FIELDS = {
  purchasePrice: 'purchase_price', acquisitionDate: 'acquisition_date', acquisitionSource: 'acquisition_source',
  reconditioningCost: 'reconditioning_cost', internalNotes: 'internal_notes', employeeNotes: 'employee_notes',
  soldPrice: 'sold_price', soldNote: 'sold_note'
};

const PHOTO_FIELDS = {
  id: 'id', vehicleId: 'vehicle_id', futureStoragePath: 'storage_path', fileName: 'file_name',
  mimeType: 'mime_type', width: 'width', height: 'height', size: 'size_bytes', rotation: 'rotation',
  sortOrder: 'sort_order', isCover: 'is_cover', createdAt: 'created_at'
};

const ACTIVITY_FIELDS = {
  id: 'id', createdAt: 'created_at', action: 'action', vehicleId: 'vehicle_id', stockNumber: 'stock_number',
  vehicleLabel: 'vehicle_label', summary: 'summary', changes: 'changes', actorId: 'actor_id', actorName: 'actor_name'
};

/* Columns the database sets on its own (retention clock, schedule stamps); never sent from the browser. */
const SERVER_ONLY = ['delete_after', 'deletion_claimed_at', 'schedule_created_at', 'schedule_created_by', 'schedule_blocked_reason', 'schedule_last_attempt_at'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COLUMNS = new Set(['id', 'vehicle_id', 'cover_photo_id', 'created_by', 'updated_by', 'sold_by', 'actor_id', 'schedule_created_by']);
const REQUIRED_TEXT = new Set(['make', 'model', 'action', 'storage_path']);

/** '' → null (so unique/format constraints treat blanks as "not set"); bad ids → null. */
function toColumnValue(column, value) {
  if (value === undefined) return undefined;
  if (UUID_COLUMNS.has(column)) return typeof value === 'string' && UUID.test(value) ? value : null;
  if (typeof value === 'string' && value.trim() === '' && !REQUIRED_TEXT.has(column)) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function toRow(record, fields) {
  const row = {};
  Object.entries(fields).forEach(([camel, snake]) => {
    const value = toColumnValue(snake, record[camel]);
    if (value !== undefined) row[snake] = value;
  });
  return row;
}

function fromRow(row, fields) {
  const record = {};
  Object.entries(fields).forEach(([camel, snake]) => {
    if (row[snake] !== undefined) record[camel] = row[snake];
  });
  return record;
}

function vehicleFromRow(row) {
  const internal = Array.isArray(row.vehicle_internal) ? row.vehicle_internal[0] : row.vehicle_internal;
  return { ...fromRow(row, VEHICLE_FIELDS), ...(internal ? fromRow(internal, INTERNAL_FIELDS) : {}) };
}

/* ---------------------------- errors ---------------------------- */

function describe(error) {
  const text = String((error && (error.message || error.error_description || error.error)) || error || '');
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'Check your internet connection and try again.';
  if (/jwt|token|not authenticated|session/i.test(text)) return 'Your sign-in has expired. Please sign in again.';
  if (/duplicate key.*stock_number/i.test(text)) return 'That stock number is already in use.';
  return text;
}

function isDenied(error) {
  const text = String((error && error.message) || '');
  return (error && (error.code === '42501' || error.status === 403 || error.statusCode === '403'))
    || /row-level security|permission denied|not authorized|unauthorized/i.test(text);
}

function fail(action, error) {
  // The database refuses public changes while the managed service is inactive (HTTP 402 / PT402).
  if (isPublishingBlockedError(error)) {
    // The upload refusal has its own wording; every other billing refusal uses the standard message.
    throw new BackendError(/photo uploads are paused/i.test(String(error.message || '')) ? error.message : PUBLISHING_BLOCKED_MESSAGE, error);
  }
  // Plain-language refusals written by the database itself (retention, readiness, scheduling).
  if (error && (error.code === 'PT409' || error.code === 'PT422') && error.message) throw new BackendError(error.message, error);
  if (isDenied(error)) throw new BackendError(`You don’t have permission to ${action}.`, error);
  throw new BackendError(`Couldn’t ${action}. ${describe(error)}`.trim(), error);
}

/* Storage refuses photo-file changes on visible vehicles with a plain policy error;
   explain it as a billing pause when that is the reason. */
async function failStorage(action, error) {
  if (isDenied(error) && await billingService.publishingBlocked({ fresh: true })) {
    throw new BackendError(PUBLISHING_BLOCKED_MESSAGE, error);
  }
  fail(action, error);
}

/* ---------------------------- adapter ---------------------------- */

export function createSupabaseRepository() {
  const db = () => getSupabase();
  const bucket = () => db().storage.from(SUPABASE.photoBucket);
  const PAGE = 1000; // API row cap per request

  /** Read every row of a query, paging past the 1,000-row API limit. */
  async function fetchAll(build, action, max = 20000) {
    const rows = [];
    for (let from = 0; rows.length < max; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) fail(action, error);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  /* Short-lived read cache: one page load asks for the vehicle list several
     times (sidebar counts + page content). Cleared on every write. */
  const lists = { vehicles: null, photos: null };
  const invalidate = () => { lists.vehicles = null; lists.photos = null; };
  function cached(key, loader) {
    const hit = lists[key];
    if (hit && Date.now() - hit.at < 1500) return hit.promise;
    const entry = { at: Date.now(), promise: loader() };
    lists[key] = entry;
    entry.promise.catch(() => { if (lists[key] === entry) lists[key] = null; });
    return entry.promise;
  }

  /* Signed photo URLs, batched: every getUrl() call made in the same moment
     becomes one request. */
  const signedUrls = new Map(); // path → { url, expires }
  const versions = new Map();   // path → bump after overwrite (rotate) to defeat browser cache
  let queue = [];
  let flushTimer = null;

  async function flushSignedUrls() {
    const batch = queue;
    queue = [];
    flushTimer = null;
    const paths = [...new Set(batch.map((item) => item.path))];
    const found = new Map();
    for (let i = 0; i < paths.length; i += 200) {
      try {
        const { data, error } = await bucket().createSignedUrls(paths.slice(i, i + 200), SUPABASE.signedUrlSeconds);
        if (!error && Array.isArray(data)) {
          data.forEach((entry) => { if (entry && entry.signedUrl && !entry.error) found.set(entry.path, entry.signedUrl); });
        }
      } catch (err) { /* those photos simply show as unavailable */ }
    }
    const expires = Date.now() + SUPABASE.signedUrlSeconds * 1000;
    batch.forEach(({ path, resolve }) => {
      const url = found.get(path);
      if (!url) { resolve(null); return; }
      const versioned = versions.has(path) ? `${url}&v=${versions.get(path)}` : url;
      signedUrls.set(path, { url: versioned, expires });
      resolve(versioned);
    });
  }

  return {
    kind: 'supabase',
    label: 'Supabase (shared, secured database)',

    async ready() {
      const { error } = await db().from('vehicles').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) fail('reach the database', error);
      return true;
    },

    vehicles: {
      list: () => cached('vehicles', async () => {
        const rows = await fetchAll(() => db().from('vehicles').select('*, vehicle_internal(*)').order('id'), 'load vehicles');
        return rows.map(vehicleFromRow);
      }),

      async get(id) {
        if (!UUID.test(String(id || ''))) return null;
        const { data, error } = await db().from('vehicles').select('*, vehicle_internal(*)').eq('id', id).maybeSingle();
        if (error) fail('load this vehicle', error);
        return data ? vehicleFromRow(data) : null;
      },

      async save(vehicle) {
        invalidate();
        const row = toRow(vehicle, VEHICLE_FIELDS);
        ['created_at', 'updated_at'].forEach((column) => { if (row[column] === null) delete row[column]; }); // use DB default
        SERVER_ONLY.forEach((column) => { delete row[column]; });   // set by the database only
        const { data, error } = await db().from('vehicles').upsert(row, { onConflict: 'id' }).select('id');
        if (error) fail('save this vehicle', error);
        if (!data || !data.length) throw new BackendError('You don’t have permission to save this vehicle.');
        const internal = { vehicle_id: vehicle.id, ...toRow(vehicle, INTERNAL_FIELDS) };
        const second = await db().from('vehicle_internal').upsert(internal, { onConflict: 'vehicle_id' }).select('vehicle_id');
        if (second.error) fail('save the internal information', second.error);
        return vehicle;
      },

      async saveMany(vehicles) {
        for (const vehicle of vehicles) await this.save(vehicle);
      },

      async remove(id) {
        invalidate();
        const { data, error } = await db().from('vehicles').delete().eq('id', id).select('id');
        if (error) fail('delete this vehicle', error);
        // RLS filters silently: zero rows means the database refused.
        if (!data || !data.length) throw new BackendError('The database refused the delete. Only an Admin can permanently delete an archived vehicle.');
      }
    },

    photos: {
      list: () => cached('photos', async () => {
        const rows = await fetchAll(() => db().from('vehicle_photos').select('*').order('id'), 'load photos');
        return rows.map((row) => ({ ...fromRow(row, PHOTO_FIELDS), futurePublicUrl: null }));
      }),

      async listByVehicle(vehicleId) {
        if (!UUID.test(String(vehicleId || ''))) return [];
        const { data, error } = await db().from('vehicle_photos').select('*').eq('vehicle_id', vehicleId).order('sort_order');
        if (error) fail('load photos', error);
        return data.map((row) => ({ ...fromRow(row, PHOTO_FIELDS), futurePublicUrl: null }));
      },

      async saveMany(photos) {
        if (!photos.length) return;
        invalidate();
        const { error } = await db().from('vehicle_photos').upsert(photos.map((p) => toRow(p, PHOTO_FIELDS)), { onConflict: 'id' });
        if (error) fail('save photos', error);
      },

      async removeMany(ids) {
        if (!ids.length) return;
        invalidate();
        const { error } = await db().from('vehicle_photos').delete().in('id', ids);
        if (error) fail('remove photos', error);
      }
    },

    files: {
      async put(path, blob) {
        const { error } = await bucket().upload(path, blob, {
          upsert: true,
          contentType: blob.type || 'image/jpeg',
          cacheControl: '3600'
        });
        if (error) await failStorage('upload a photo', error);
        signedUrls.delete(path);
        versions.set(path, Date.now());
      },

      async get(path) {
        const { data, error } = await bucket().download(path);
        if (error) return null; // missing file → caller shows "Photo unavailable"
        return data;
      },

      /** Signed URL for display (no download needed). null when the file is missing. */
      getUrl(path) {
        const hit = signedUrls.get(path);
        if (hit && hit.expires > Date.now() + 60000) return Promise.resolve(hit.url);
        return new Promise((resolve) => {
          queue.push({ path, resolve });
          if (!flushTimer) flushTimer = window.setTimeout(flushSignedUrls, 15);
        });
      },

      async removeMany(paths) {
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          const { error } = await bucket().remove(chunk);
          if (error) await failStorage('remove photo files', error);
          chunk.forEach((path) => signedUrls.delete(path));
        }
      }
    },

    activity: {
      async add(entry) {
        const { error } = await db().from('activity_logs').insert(toRow(entry, ACTIVITY_FIELDS));
        if (error) fail('record activity', error);
        return entry;
      },

      async addMany(entries) {
        if (!entries.length) return;
        const { error } = await db().from('activity_logs').insert(entries.map((e) => toRow(e, ACTIVITY_FIELDS)));
        if (error) fail('record activity', error);
      },

      async list() {
        const rows = await fetchAll(() => db().from('activity_logs').select('*').order('created_at', { ascending: false }), 'load activity', 5000);
        return rows.map((row) => fromRow(row, ACTIVITY_FIELDS));
      },

      async listByVehicle(vehicleId) {
        if (!UUID.test(String(vehicleId || ''))) return [];
        const { data, error } = await db().from('activity_logs').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false });
        if (error) fail('load activity', error);
        return data.map((row) => fromRow(row, ACTIVITY_FIELDS));
      },

      async removeMany() {
        throw new BackendError('Activity history is permanent and cannot be removed.');
      }
    },

    meta: {
      async get(key) {
        const { data, error } = await db().from('dealership_settings').select('value').eq('key', key).maybeSingle();
        if (error) fail('load settings', error);
        return data ? data.value : undefined;
      },

      async set(key, value) {
        const { data, error } = await db().from('dealership_settings').upsert({ key, value }, { onConflict: 'key' }).select('key');
        if (error) fail('save settings', error);
        if (!data || !data.length) throw new BackendError('Only an Admin can change settings.');
      }
    },

    /**
     * Live updates: calls onChange() when another session changes inventory. Returns an unsubscribe function.
     * The channel is private: Realtime admits signed-in, active employees only.
     */
    subscribe(onChange) {
      const channel = db().channel('cela-inventory', { config: { private: true } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { invalidate(); onChange('vehicles'); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_photos' }, () => { invalidate(); onChange('photos'); })
        .subscribe();
      return () => { db().removeChannel(channel); };
    },

    async clearAll() {
      throw new BackendError('“Clear all data” is only available in local development mode.');
    },

    async storageEstimate() {
      return null;
    }
  };
}
