/* ==========================================================================
   PUBLIC DATA BOUNDARY
   --------------------------------------------------------------------------
   This file is the ONLY place that decides what customers may see.

   Private Vehicle  ──toPublicVehicle()──▶  Public Vehicle DTO

   • Built field-by-field from PUBLIC_VEHICLE_FIELDS (an allowlist). The
     private record is never spread/copied, so a new internal field can't
     leak by accident.
   • assertPublicSafe() throws if anything outside the allowlist appears.
   • Field names match the live Public site's model (Public/js/vehicles.js).

   Later, the same rules become a Supabase view / RLS policy (see
   SUPABASE-INTEGRATION.md) so the database enforces them too.
   ========================================================================== */
import { STATUS, fullTitle, INTERNAL_FIELDS } from './vehicle.js';

export const PUBLIC_VEHICLE_FIELDS = Object.freeze([
  'id', 'stockNumber', 'vin', 'year', 'make', 'model', 'trim',
  'price', 'salePrice', 'mileage',
  'bodyStyle', 'transmission', 'drivetrain', 'engine', 'fuelType',
  'exteriorColor', 'interiorColor', 'doors', 'seats',
  'description', 'features', 'photos', 'status', 'featured',
  'createdAt', 'updatedAt', 'soldAt'
]);

export const PUBLIC_PHOTO_FIELDS = Object.freeze(['url', 'alt']);

/* Explicitly never public (documentation + tests). Anything not in the
   allowlist is excluded anyway; this list names the sensitive ones. */
export const NEVER_PUBLIC_FIELDS = Object.freeze([
  ...INTERNAL_FIELDS,
  'createdBy', 'updatedBy', 'soldBy', 'statusBeforeArchive', 'archivedAt',
  'isPublished', 'publishedAt', 'coverPhotoId', 'photoCount', 'isDemo'
]);

/**
 * Do customers see this vehicle right now? (Same rule as the database view public_inventory.)
 * Approved rules:
 *   DRAFT / ARCHIVED / unpublished → hidden
 *   AVAILABLE, PENDING (published) → visible
 *   SOLD → hidden at once (kept privately in Sold History for 7 days)
 */
export function publicVisibility(vehicle, now = Date.now()) {
  if (vehicle.status === STATUS.ARCHIVED) return { visible: false, reason: 'Archived vehicles are hidden.' };
  if (vehicle.status === STATUS.DRAFT) return { visible: false, reason: 'Drafts are hidden.' };
  if (vehicle.status === STATUS.SOLD) return { visible: false, reason: 'Sold vehicles leave the public site immediately.' };
  if (!vehicle.isPublished) return { visible: false, reason: 'Not published.' };
  return { visible: true, reason: vehicle.status === STATUS.PENDING ? 'Shows as Sale Pending.' : 'Listed for sale.' };
}

/**
 * Build the customer-facing DTO.
 * photos: the vehicle's photo records (any order).
 * resolveUrl(photo): returns a URL for the photo (object URL locally,
 *   Supabase Storage public URL later).
 */
export function toPublicVehicle(vehicle, photos = [], { resolveUrl = (p) => p.futurePublicUrl || '' } = {}) {
  const title = fullTitle(vehicle);
  const ordered = photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  // Public uses photos[0] for its card/main image, so the cover goes first;
  // the rest keep the employee's chosen order.
  const cover = ordered.find((p) => p.isCover);
  const gallery = cover ? [cover, ...ordered.filter((p) => p !== cover)] : ordered;

  const dto = {
    id: vehicle.id,
    stockNumber: vehicle.stockNumber || '',
    vin: vehicle.vin || '',
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim || '',
    price: vehicle.price,
    salePrice: vehicle.salePrice,
    mileage: vehicle.mileage,
    bodyStyle: vehicle.bodyStyle || '',
    transmission: vehicle.transmission || '',
    drivetrain: vehicle.drivetrain || '',
    engine: vehicle.engine || '',
    fuelType: vehicle.fuelType || '',
    exteriorColor: vehicle.exteriorColor || '',
    interiorColor: vehicle.interiorColor || '',
    doors: vehicle.doors,
    seats: vehicle.seats,
    description: vehicle.description || '',
    features: Array.isArray(vehicle.features) ? vehicle.features.slice() : [],
    photos: gallery
      .map((p, i) => ({ url: resolveUrl(p) || '', alt: `${title} — photo ${i + 1}` }))
      .filter((p) => p.url),
    status: vehicle.status === STATUS.DRAFT ? STATUS.AVAILABLE : vehicle.status,
    featured: vehicle.featured === true,
    createdAt: vehicle.publishedAt || vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
    soldAt: vehicle.status === STATUS.SOLD ? vehicle.soldAt : null
  };
  return assertPublicSafe(dto);
}

/** Throws if the DTO carries anything outside the allowlist. */
export function assertPublicSafe(dto) {
  Object.keys(dto).forEach((key) => {
    if (!PUBLIC_VEHICLE_FIELDS.includes(key)) {
      throw new Error(`Public DTO contains a non-public field: ${key}`);
    }
  });
  (dto.photos || []).forEach((photo) => {
    Object.keys(photo).forEach((key) => {
      if (!PUBLIC_PHOTO_FIELDS.includes(key)) throw new Error(`Public photo contains a non-public field: ${key}`);
    });
  });
  return dto;
}
