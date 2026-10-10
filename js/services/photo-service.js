/* ==========================================================================
   Photo service
   --------------------------------------------------------------------------
   Processing (browser-side, development):
     original  → stored untouched (never silently destroyed)
     display   → ≤2048px JPEG working copy (orientation corrected, rotation applied)
     thumb     → ≤480px JPEG for lists and grids
   Later, a server/Storage pipeline can replace processFile() without
   changing the editor — it only consumes the returned "draft" shape.

   Persistence goes through the repository (photos table + files bucket).
   ========================================================================== */
import { PHOTO_RULES } from '../config.js';
import { getRepository } from '../data/repository.js';
import { createPhoto, normalizePhoto, sortPhotos, storagePath, PHOTO_VARIANTS } from '../models/photo.js';
import { publicVisibility } from '../models/public-dto.js';
import { activityService } from './activity-service.js';
import { authService } from './auth-service.js';
import { billingService, PUBLISHING_BLOCKED_MESSAGE, UPLOADS_PAUSED_MESSAGE } from './billing-service.js';
import { createId, nowIso } from '../utils/misc.js';
import { formatBytes } from '../utils/format.js';

export class PhotoError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PhotoError';
    this.code = code;
  }
}

/* Photos of a vehicle customers can see are frozen while publishing is paused by
   billing. The database enforces this; checking first avoids half-finished uploads
   and gives the clear message before any file is sent. */
async function assertPublicPhotoChangeAllowed(vehicleId, { writesFiles = false } = {}) {
  if (!(await billingService.publishingBlocked({ fresh: true }))) return;
  // While the managed service is inactive no new photo files are stored (any vehicle).
  if (writesFiles) throw new PhotoError(UPLOADS_PAUSED_MESSAGE, 'billing');
  const stored = await getRepository().vehicles.get(vehicleId);
  if (stored && publicVisibility(stored).visible) throw new PhotoError(PUBLISHING_BLOCKED_MESSAGE, 'billing');
}

function extensionOf(name = '') {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function isHeic(file) {
  return /hei[cf]/i.test(file.type || '') || ['heic', 'heif'].includes(extensionOf(file.name));
}

/* ---------------------------- decoding / rendering ---------------------------- */

function decodeImage(blob) {
  // <img> decoding honors EXIF orientation in all current browsers and
  // decodes HEIC where the platform supports it (Safari).
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        reject(new Error('empty image'));
        return;
      }
      resolve({ img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

async function renderVariant(decoded, maxEdge, rotation) {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));
  const quarterTurn = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = quarterTurn ? h : w;
  canvas.height = quarterTurn ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // flatten any PNG transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(decoded.img, -w / 2, -h / 2, w, h);
  const blob = await canvasToBlob(canvas, PHOTO_RULES.jpegQuality);
  canvas.width = 0; // release canvas memory promptly (important on iPhone)
  canvas.height = 0;
  return blob;
}

async function renderCopies(source, rotation) {
  const decoded = await decodeImage(source);
  try {
    const display = await renderVariant(decoded, PHOTO_RULES.displayMaxEdge, rotation);
    const thumb = await renderVariant(decoded, PHOTO_RULES.thumbMaxEdge, rotation);
    return { display, thumb, width: decoded.width, height: decoded.height };
  } finally {
    decoded.release();
  }
}

/* ---------------------------- object URL cache ---------------------------- */

const urlCache = new Map();

function cacheUrl(key, blob) {
  if (urlCache.has(key)) URL.revokeObjectURL(urlCache.get(key));
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

function invalidate(key) {
  if (urlCache.has(key)) {
    URL.revokeObjectURL(urlCache.get(key));
    urlCache.delete(key);
  }
}

window.addEventListener('pagehide', () => {
  urlCache.forEach((url) => URL.revokeObjectURL(url));
  urlCache.clear();
});

/* ---------------------------- service ---------------------------- */

export const photoService = {
  /** Quick checks before decoding. Returns an error message or ''. */
  checkFile(file) {
    const name = file.name || 'This file';
    const typeOk = PHOTO_RULES.acceptedMimeTypes.includes((file.type || '').toLowerCase())
      || PHOTO_RULES.acceptedExtensions.includes(extensionOf(file.name));
    if (!typeOk) return `“${name}” isn’t a supported photo type. Use JPEG, PNG, WebP, or HEIC.`;
    if (!file.size) return `“${name}” is empty.`;
    if (file.size > PHOTO_RULES.maxBytes) {
      return `“${name}” is ${formatBytes(file.size)} — photos must be under ${formatBytes(PHOTO_RULES.maxBytes)}.`;
    }
    return '';
  },

  /**
   * Turn a picked File into an editor draft (nothing is saved yet).
   * Throws PhotoError with an employee-friendly message.
   */
  async processFile(file, rotation = 0) {
    const problem = this.checkFile(file);
    if (problem) throw new PhotoError(problem, 'invalid');
    let copies;
    try {
      copies = await renderCopies(file, rotation);
    } catch (err) {
      if (isHeic(file)) {
        throw new PhotoError(`“${file.name}” is a HEIC photo this browser can’t open. On iPhone, pick photos in Safari (they’re converted automatically), or export them as JPEG.`, 'heic');
      }
      throw new PhotoError(`“${file.name}” couldn’t be read. It may be damaged or not a real image.`, 'decode');
    }
    return {
      fileName: file.name || 'photo.jpg',
      mimeType: file.type || `image/${extensionOf(file.name) || 'jpeg'}`,
      size: file.size,
      width: copies.width,
      height: copies.height,
      rotation,
      blobs: { original: file, display: copies.display, thumb: copies.thumb }
    };
  },

  /** Re-make the display + thumbnail copies from an original at a new rotation. */
  async rotateCopies(originalBlob, rotation) {
    const copies = await renderCopies(originalBlob, rotation);
    return { display: copies.display, thumb: copies.thumb };
  },

  async getPhotos(vehicleId) {
    const records = await getRepository().photos.listByVehicle(vehicleId);
    return sortPhotos(records.map(normalizePhoto).filter(Boolean));
  },

  async getAllPhotos() {
    const records = await getRepository().photos.list();
    return records.map(normalizePhoto).filter(Boolean);
  },

  /** Map vehicleId → { cover, count } for list views. */
  async getCoverIndex() {
    const index = new Map();
    (await this.getAllPhotos()).forEach((photo) => {
      const entry = index.get(photo.vehicleId) || { cover: null, first: null, count: 0 };
      entry.count += 1;
      if (photo.isCover) entry.cover = photo;
      if (!entry.first || photo.sortOrder < entry.first.sortOrder) entry.first = photo;
      index.set(photo.vehicleId, entry);
    });
    index.forEach((entry) => { entry.cover = entry.cover || entry.first; });
    return index;
  },

  /** Object URL for a stored variant, falling back to larger variants; null if missing. */
  async getUrl(photo, variant = 'thumb') {
    // thumb → [thumb, display, original]; display → [display, original]
    const chain = variant === 'thumb' ? ['thumb', 'display', 'original'] : variant === 'display' ? ['display', 'original'] : ['original'];
    const files = getRepository().files;
    for (const v of chain) {
      const path = storagePath(photo.vehicleId, photo.id, v);
      try {
        if (typeof files.getUrl === 'function') {
          // Remote storage: a signed URL (no download). The adapter caches and batches these.
          const url = await files.getUrl(path);
          if (url) return url;
        } else {
          if (urlCache.has(path)) return urlCache.get(path);
          const blob = await files.get(path);
          if (blob) return cacheUrl(path, blob);
        }
      } catch (err) { /* try next variant */ }
    }
    return null;
  },

  async getBlob(photo, variant = 'original') {
    return getRepository().files.get(storagePath(photo.vehicleId, photo.id, variant));
  },

  /**
   * Persist the editor's photo list for a vehicle (the "Save" moment).
   * items: ordered editor items:
   *   { id, isNew, isCover, rotation, rotationChanged, replacesId?, draft?: {…blobs}, error? }
   * Writes files + records, removes deleted photos, applies order + cover,
   * updates the vehicle's cover/photoCount, and logs one activity entry per kind of change.
   */
  async savePhotos(vehicle, items) {
    const repo = getRepository();
    const existing = await this.getPhotos(vehicle.id);
    const existingById = new Map(existing.map((p) => [p.id, p]));
    const keep = items.filter((item) => !item.error && (item.isNew ? item.draft : existingById.has(item.id)));
    const keepIds = new Set(keep.map((item) => item.id));
    const replacedIds = new Set(keep.filter((i) => i.replacesId).map((i) => i.replacesId));
    const removed = existing.filter((p) => !keepIds.has(p.id));
    const now = nowIso();

    let coverId = (keep.find((i) => i.isCover) || keep[0] || {}).id || null;
    const summary = { added: 0, removed: 0, replaced: 0, rotated: 0, reordered: false, coverChanged: false };
    const records = [];

    const changesPhotos = removed.length > 0 || keep.some((item, index) => {
      if (item.isNew || (item.rotationChanged && item.draft)) return true;
      const before = existingById.get(item.id);
      return before.sortOrder !== index || before.isCover !== (item.id === coverId);
    });
    const writesFiles = keep.some((item) => item.isNew || (item.rotationChanged && item.draft));
    if (changesPhotos) await assertPublicPhotoChangeAllowed(vehicle.id, { writesFiles });

    for (let index = 0; index < keep.length; index++) {
      const item = keep[index];
      if (item.isNew) {
        const photo = createPhoto({
          id: item.id,
          vehicleId: vehicle.id,
          fileName: item.draft.fileName,
          mimeType: item.draft.mimeType,
          width: item.draft.width,
          height: item.draft.height,
          size: item.draft.size,
          rotation: item.rotation || 0,
          sortOrder: index,
          isCover: item.id === coverId,
          createdAt: now,
          futureStoragePath: storagePath(vehicle.id, item.id, 'display'),
          isDemo: vehicle.isDemo
        });
        for (const variant of PHOTO_VARIANTS) {
          await repo.files.put(storagePath(vehicle.id, item.id, variant), item.draft.blobs[variant]);
        }
        records.push(photo);
        if (item.replacesId) summary.replaced += 1; else summary.added += 1;
      } else {
        const photo = { ...existingById.get(item.id) };
        if (photo.sortOrder !== index) summary.reordered = true;
        photo.sortOrder = index;
        photo.isCover = item.id === coverId;
        if (item.rotationChanged && item.draft && item.draft.blobs) {
          for (const variant of ['display', 'thumb']) {
            const path = storagePath(vehicle.id, item.id, variant);
            await repo.files.put(path, item.draft.blobs[variant]);
            invalidate(path);
          }
          photo.rotation = item.rotation;
          summary.rotated += 1;
        }
        records.push(photo);
      }
    }

    // Order changes caused only by additions/removals aren't a "reorder".
    if (summary.reordered) {
      const before = existing.filter((p) => keepIds.has(p.id)).map((p) => p.id);
      const after = keep.filter((i) => !i.isNew).map((i) => i.id);
      summary.reordered = before.join() !== after.join();
    }

    await repo.photos.saveMany(records);
    if (removed.length) {
      await repo.photos.removeMany(removed.map((p) => p.id));
      const paths = [];
      removed.forEach((p) => PHOTO_VARIANTS.forEach((v) => {
        const path = storagePath(p.vehicleId, p.id, v);
        paths.push(path);
        invalidate(path);
      }));
      await repo.files.removeMany(paths);
      summary.removed = removed.filter((p) => !replacedIds.has(p.id)).length;
    }

    const previousCover = vehicle.coverPhotoId;
    // Replacing the cover photo itself gives it a new id; that is a replacement, not a cover change.
    const coverReplaced = keep.some((i) => i.id === coverId && i.replacesId === previousCover);
    summary.coverChanged = Boolean(previousCover) && previousCover !== coverId && !coverReplaced;
    await this.updateVehiclePhotoInfo(vehicle.id, coverId, records.length);
    await this.logPhotoChanges(vehicle, summary);
    return { ...summary, coverPhotoId: coverId, count: records.length };
  },

  async updateVehiclePhotoInfo(vehicleId, coverPhotoId, count) {
    const repo = getRepository();
    const stored = await repo.vehicles.get(vehicleId);
    if (!stored) return;
    if (stored.coverPhotoId === coverPhotoId && stored.photoCount === count) return;
    await repo.vehicles.save({ ...stored, coverPhotoId, photoCount: count, updatedAt: nowIso(), updatedBy: authService.actor().actorId });
  },

  async logPhotoChanges(vehicle, s) {
    const plural = (n) => `${n} photo${n === 1 ? '' : 's'}`;
    if (s.added) await activityService.record({ action: 'photo.added', vehicle, summary: `Added ${plural(s.added)}` });
    if (s.replaced) await activityService.record({ action: 'photo.replaced', vehicle, summary: `Replaced ${plural(s.replaced)}` });
    if (s.removed) await activityService.record({ action: 'photo.removed', vehicle, summary: `Removed ${plural(s.removed)}` });
    if (s.rotated) await activityService.record({ action: 'photo.rotated', vehicle, summary: `Rotated ${plural(s.rotated)}` });
    if (s.reordered) await activityService.record({ action: 'photo.reordered', vehicle, summary: 'Photo order changed' });
    if (s.coverChanged) await activityService.record({ action: 'photo.cover_changed', vehicle, summary: 'Cover photo changed' });
  },

  /** Direct reorder (outside the editor). orderedIds = every photo id in the new order. */
  async reorderPhotos(vehicle, orderedIds) {
    await assertPublicPhotoChangeAllowed(vehicle.id);
    const photos = await this.getPhotos(vehicle.id);
    const byId = new Map(photos.map((p) => [p.id, p]));
    const updated = orderedIds.filter((id) => byId.has(id)).map((id, index) => ({ ...byId.get(id), sortOrder: index }));
    await getRepository().photos.saveMany(updated);
    await activityService.record({ action: 'photo.reordered', vehicle, summary: 'Photo order changed' });
    return updated;
  },

  /** Direct cover change (outside the editor). */
  async setCoverPhoto(vehicle, photoId) {
    const photos = await this.getPhotos(vehicle.id);
    if (!photos.some((p) => p.id === photoId)) throw new Error('That photo no longer exists.');
    await assertPublicPhotoChangeAllowed(vehicle.id);
    await getRepository().photos.saveMany(photos.map((p) => ({ ...p, isCover: p.id === photoId })));
    await this.updateVehiclePhotoInfo(vehicle.id, photoId, photos.length);
    await activityService.record({ action: 'photo.cover_changed', vehicle, summary: 'Cover photo changed' });
  },

  /** Remove every photo + file for a vehicle (permanent delete only). */
  async deletePhotosForVehicle(vehicleId) {
    const repo = getRepository();
    const photos = await repo.photos.listByVehicle(vehicleId);
    const paths = [];
    photos.forEach((p) => PHOTO_VARIANTS.forEach((v) => {
      const path = storagePath(vehicleId, p.id, v);
      paths.push(path);
      invalidate(path);
    }));
    await repo.photos.removeMany(photos.map((p) => p.id));
    await repo.files.removeMany(paths);
    return photos.length;
  },

  newPhotoId: () => createId()
};
