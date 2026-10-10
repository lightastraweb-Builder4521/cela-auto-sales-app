/* What the Public website will receive — built only through models/public-dto.js.
   Used today for "Preview Public Listing"; later by the Supabase sync / view. */
import { toPublicVehicle, publicVisibility } from '../models/public-dto.js';
import { photoService } from './photo-service.js';
import { vehicleService } from './vehicle-service.js';

export const publicListingService = {
  /**
   * Preview for a vehicle as it is being edited.
   * photos: [{ isCover, sortOrder, url }] (editor items already carry a URL).
   */
  buildPreview(vehicle, photos) {
    const dto = toPublicVehicle(vehicle, photos, { resolveUrl: (p) => p.url || p.displayUrl || '' });
    return { dto, visibility: publicVisibility(vehicle) };
  },

  /** DTO for a saved vehicle, using locally stored display photos. */
  async buildSavedPreview(vehicle) {
    const photos = await photoService.getPhotos(vehicle.id);
    const withUrls = await Promise.all(photos.map(async (p) => ({ ...p, url: await photoService.getUrl(p, 'display') })));
    return this.buildPreview(vehicle, withUrls);
  },

  /**
   * Everything customers would currently see (future Public feed).
   * Photo URLs are omitted locally — Storage URLs arrive with Supabase.
   */
  async getPublicInventory(now = Date.now()) {
    const vehicles = await vehicleService.getVehicles();
    // Demo records are development-only: they never enter the public feed.
    const visible = vehicles.filter((v) => !v.isDemo && publicVisibility(v, now).visible);
    const photos = await photoService.getAllPhotos();
    return visible.map((v) => toPublicVehicle(v, photos.filter((p) => p.vehicleId === v.id)));
  }
};
