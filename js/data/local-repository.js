/* ==========================================================================
   LOCAL DEVELOPMENT ADAPTER (IndexedDB)
   --------------------------------------------------------------------------
   Implements the repository contract used by every service:

     vehicles  → future table  `vehicles`
     photos    → future table  `vehicle_photos`
     files     → future Storage bucket `vehicle-photos` (Blobs, not base64)
     activity  → future table  `activity_logs`
     meta      → small key/value settings (future `dealership_settings`)

   A Supabase adapter will expose the same methods (see supabase-repository.js).
   Services never touch IndexedDB directly.
   ========================================================================== */
import { openDatabase, requestToPromise, transaction } from './idb.js';

const STORES = ['vehicles', 'photos', 'files', 'activity', 'meta'];

function upgrade(db) {
  if (!db.objectStoreNames.contains('vehicles')) {
    const vehicles = db.createObjectStore('vehicles', { keyPath: 'id' });
    vehicles.createIndex('status', 'status');
    vehicles.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('photos')) {
    const photos = db.createObjectStore('photos', { keyPath: 'id' });
    photos.createIndex('vehicleId', 'vehicleId');
  }
  if (!db.objectStoreNames.contains('files')) {
    db.createObjectStore('files', { keyPath: 'path' });
  }
  if (!db.objectStoreNames.contains('activity')) {
    const activity = db.createObjectStore('activity', { keyPath: 'id' });
    activity.createIndex('createdAt', 'createdAt');
    activity.createIndex('vehicleId', 'vehicleId');
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}

export function createLocalRepository({ dbName, dbVersion }) {
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = openDatabase(dbName, dbVersion, upgrade).catch((err) => {
        dbPromise = null; // allow a retry after the problem is fixed
        throw err;
      });
    }
    return dbPromise;
  }

  async function all(store) {
    const conn = await db();
    return transaction(conn, store, 'readonly', (s) => requestToPromise(s[store].getAll()));
  }

  async function one(store, key) {
    const conn = await db();
    return transaction(conn, store, 'readonly', (s) => requestToPromise(s[store].get(key)));
  }

  async function byIndex(store, index, value) {
    const conn = await db();
    return transaction(conn, store, 'readonly', (s) => requestToPromise(s[store].index(index).getAll(value)));
  }

  async function putMany(store, records) {
    if (!records.length) return;
    const conn = await db();
    await transaction(conn, store, 'readwrite', (s) => {
      records.forEach((record) => s[store].put(record));
    });
  }

  async function removeMany(store, keys) {
    if (!keys.length) return;
    const conn = await db();
    await transaction(conn, store, 'readwrite', (s) => {
      keys.forEach((key) => s[store].delete(key));
    });
  }

  return {
    kind: 'local',
    label: 'Local development (IndexedDB in this browser)',

    ready: () => db().then(() => true),

    vehicles: {
      list: () => all('vehicles'),
      get: (id) => one('vehicles', id),
      save: (vehicle) => putMany('vehicles', [vehicle]).then(() => vehicle),
      saveMany: (vehicles) => putMany('vehicles', vehicles),
      remove: (id) => removeMany('vehicles', [id])
    },

    photos: {
      list: () => all('photos'),
      listByVehicle: (vehicleId) => byIndex('photos', 'vehicleId', vehicleId),
      saveMany: (photos) => putMany('photos', photos),
      removeMany: (ids) => removeMany('photos', ids)
    },

    files: {
      put: (path, blob) => putMany('files', [{ path, blob, type: blob.type, size: blob.size }]),
      get: (path) => one('files', path).then((record) => (record ? record.blob : null)),
      removeMany: (paths) => removeMany('files', paths)
    },

    activity: {
      add: (entry) => putMany('activity', [entry]).then(() => entry),
      addMany: (entries) => putMany('activity', entries),
      list: () => all('activity'),
      listByVehicle: (vehicleId) => byIndex('activity', 'vehicleId', vehicleId),
      removeMany: (ids) => removeMany('activity', ids)
    },

    meta: {
      get: (key) => one('meta', key).then((record) => (record ? record.value : undefined)),
      set: (key, value) => putMany('meta', [{ key, value }])
    },

    /** Removes every local record (development reset). */
    async clearAll() {
      const conn = await db();
      await transaction(conn, STORES, 'readwrite', (s) => {
        STORES.forEach((name) => s[name].clear());
      });
    },

    async storageEstimate() {
      if (navigator.storage && navigator.storage.estimate) {
        try { return await navigator.storage.estimate(); } catch (err) { return null; }
      }
      return null;
    }
  };
}
