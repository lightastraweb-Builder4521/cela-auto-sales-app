/* VIN rules (pure functions, no network).
   Modern VINs are 17 characters and never use I, O or Q. North American VINs
   carry a check digit in position 9; we only *warn* on a mismatch because
   some imported/older vehicles don't follow it. */

export const VIN_LENGTH = 17;

/** Uppercase and drop spaces/dashes. Letters are never silently swapped. */
export function normalizeVin(input) {
  return String(input === null || input === undefined ? '' : input).toUpperCase().replace(/[\s-]/g, '');
}

const TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < VIN_LENGTH; i++) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (value === undefined) return null;
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/**
 * valid: false blocks saving (wrong length / illegal characters).
 * checkDigitOk: false is only a warning.
 */
export function validateVin(input) {
  const vin = normalizeVin(input);
  if (!vin) return { vin, valid: true, checkDigitOk: null, message: '' };
  if (/[IOQ]/.test(vin)) {
    return { vin, valid: false, checkDigitOk: null, message: 'VINs never contain the letters I, O, or Q — check for 1 or 0.' };
  }
  if (!/^[A-HJ-NPR-Z0-9]+$/.test(vin)) {
    return { vin, valid: false, checkDigitOk: null, message: 'A VIN uses only letters and numbers.' };
  }
  if (vin.length !== VIN_LENGTH) {
    return { vin, valid: false, checkDigitOk: null, message: `A VIN has ${VIN_LENGTH} characters (this one has ${vin.length}).` };
  }
  const expected = vinCheckDigit(vin);
  const checkDigitOk = expected !== null && vin[8] === expected;
  return {
    vin,
    valid: true,
    checkDigitOk,
    message: checkDigitOk ? '' : 'Check digit doesn’t match — double-check the VIN (older or imported vehicles can differ).'
  };
}
