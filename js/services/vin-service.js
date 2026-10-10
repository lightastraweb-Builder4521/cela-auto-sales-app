/* VIN service.
   Validation is local (models/vin.js). Decoding (year/make/model from a VIN)
   is intentionally NOT connected in this phase — no paid APIs, no keys, no
   network. A future decoder plugs in here without touching the form. */
export { normalizeVin, validateVin, VIN_LENGTH } from '../models/vin.js';

export const vinService = {
  decoderAvailable: false,

  /** Future: return { year, make, model, trim, bodyStyle, engine, ... }. */
  async decode(/* vin */) {
    return { available: false, reason: 'VIN decoding is not connected yet.' };
  }
};
