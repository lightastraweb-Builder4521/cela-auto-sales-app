/* ==========================================================================
   Photo model — mirrors the future `vehicle_photos` table.
   Binary data (original, display copy, thumbnail) lives separately in the
   file store (future Supabase Storage bucket "vehicle-photos").
   ========================================================================== */

export const PHOTO_VARIANTS = Object.freeze(['original', 'display', 'thumb']);

/** Where each variant lives. Same layout the Storage bucket will use later. */
export function storagePath(vehicleId, photoId, variant) {
  const ext = variant === 'original' ? 'orig' : 'jpg';
  return `vehicles/${vehicleId}/${photoId}/${variant}.${ext}`;
}

export function createPhoto(overrides = {}) {
  return {
    id: '',
    vehicleId: '',
    fileName: '',
    mimeType: '',
    width: null,         // original pixel size
    height: null,
    size: null,          // original bytes
    rotation: 0,         // 0/90/180/270 — applied to display/thumb copies; original untouched
    sortOrder: 0,        // employee's chosen order = future Public gallery order
    isCover: false,
    createdAt: null,
    futureStoragePath: '', // e.g. vehicles/<vehicleId>/<photoId>/display.jpg
    futurePublicUrl: null, // unused: the bucket is private, photos are served through signed URLs
    isDemo: false,
    ...overrides
  };
}

export function normalizePhoto(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object' || !rawRecord.id || !rawRecord.vehicleId) return null;
  const p = createPhoto(rawRecord);
  p.sortOrder = Number.isFinite(p.sortOrder) ? p.sortOrder : 0;
  p.rotation = [0, 90, 180, 270].includes(p.rotation) ? p.rotation : 0;
  p.isCover = p.isCover === true;
  p.isDemo = p.isDemo === true;
  return p;
}

export function sortPhotos(photos) {
  return photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
