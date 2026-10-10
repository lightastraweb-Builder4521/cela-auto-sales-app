/* Minimal promise wrapper around IndexedDB. Used only by local-repository.js. */

export class StorageUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

export function openDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window) || !window.indexedDB) {
      reject(new StorageUnavailableError('This browser does not provide IndexedDB storage.'));
      return;
    }
    let request;
    try {
      request = window.indexedDB.open(name, version);
    } catch (err) {
      reject(new StorageUnavailableError('Local storage is blocked in this browser mode.', err));
      return;
    }
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion, request.transaction);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(new StorageUnavailableError('Could not open local storage.', request.error));
    request.onblocked = () => reject(new StorageUnavailableError('Local storage is busy in another tab. Close other Inventory Manager tabs and reload.'));
  });
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run `work(stores)` inside one transaction; resolves when it commits.
 * All writes inside succeed or fail together.
 */
export function transaction(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const stores = {};
    [].concat(storeNames).forEach((name) => { stores[name] = tx.objectStore(name); });
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction was aborted.'));
    try {
      Promise.resolve(work(stores)).then((value) => { result = value; }, (err) => {
        try { tx.abort(); } catch (e) { /* already finished */ }
        reject(err);
      });
    } catch (err) {
      try { tx.abort(); } catch (e) { /* already finished */ }
      reject(err);
    }
  });
}
