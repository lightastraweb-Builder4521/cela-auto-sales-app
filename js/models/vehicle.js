/* ==========================================================================
   Vehicle model — the single definition of a vehicle record in Private.
   Field names match the Public site's model (js/vehicles.js in Public) so the
   Public DTO mapping (models/public-dto.js) is a straight, explicit copy.
   ========================================================================== */
import { RULES } from '../config.js';
import { validateVin } from './vin.js';

export const STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  AVAILABLE: 'AVAILABLE',
  PENDING: 'PENDING',
  SOLD: 'SOLD',
  ARCHIVED: 'ARCHIVED'
});

export const STATUS_LABELS = Object.freeze({
  DRAFT: 'Draft',
  AVAILABLE: 'Available',
  PENDING: 'Pending',
  SOLD: 'Sold',
  ARCHIVED: 'Archived'
});

/* Option lists. They align with the Public filter categories; Public maps
   anything unrecognized to "Other", so extra values here stay compatible. */
export const BODY_STYLES = ['Sedan', 'SUV', 'Truck', 'Coupe', 'Hatchback', 'Van', 'Minivan', 'Wagon', 'Convertible', 'Other'];
export const TRANSMISSIONS = ['Automatic', 'Manual', 'CVT', 'Other'];
export const DRIVETRAINS = ['FWD', 'RWD', 'AWD', '4WD'];
export const FUEL_TYPES = ['Gasoline', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'Flex Fuel', 'Other'];
export const COMMON_MAKES = ['Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan', 'Ram', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];
export const COMMON_COLORS = ['Black', 'White', 'Silver', 'Gray', 'Blue', 'Red', 'Green', 'Brown', 'Beige', 'Gold', 'Orange', 'Yellow', 'Tan'];

export const STANDARD_FEATURES = [
  'Bluetooth', 'Backup Camera', 'Navigation', 'Apple CarPlay', 'Android Auto', 'Leather Seats',
  'Heated Seats', 'Sunroof', 'Third Row', 'Remote Start', 'Keyless Entry', 'Push Button Start',
  'Blind Spot Monitoring', 'Lane Assist', 'Adaptive Cruise Control', 'Parking Sensors',
  'Premium Audio', '4WD', 'AWD', 'Tow Package', 'Bed Liner'
];

/* Fields that exist for dealership operations only. They must never reach
   the Public DTO — see models/public-dto.js (which uses an allowlist). */
export const INTERNAL_FIELDS = Object.freeze([
  'purchasePrice', 'acquisitionDate', 'acquisitionSource', 'reconditioningCost',
  'internalNotes', 'employeeNotes', 'soldPrice', 'soldNote'
]);

export const FIELD_LABELS = Object.freeze({
  year: 'Year', make: 'Make', model: 'Model', trim: 'Trim', bodyStyle: 'Body style',
  stockNumber: 'Stock number', vin: 'VIN', price: 'Price', salePrice: 'Sale price', mileage: 'Mileage',
  transmission: 'Transmission', drivetrain: 'Drivetrain', engine: 'Engine', fuelType: 'Fuel type',
  exteriorColor: 'Exterior color', interiorColor: 'Interior color', doors: 'Doors', seats: 'Seats',
  description: 'Description', features: 'Features', featured: 'Featured on home page',
  purchasePrice: 'Purchase price', acquisitionDate: 'Acquisition date', acquisitionSource: 'Acquired from',
  reconditioningCost: 'Reconditioning cost', internalNotes: 'Internal notes', employeeNotes: 'Employee notes',
  photos: 'Photos', coverPhoto: 'Cover photo', status: 'Status'
});

/** Every field a vehicle record can hold, with its default value. */
export function createVehicle(overrides = {}) {
  return {
    id: '',
    stockNumber: '',
    vin: '',
    year: null,
    make: '',
    model: '',
    trim: '',
    price: null,
    salePrice: null,
    mileage: null,
    bodyStyle: '',
    transmission: '',
    drivetrain: '',
    engine: '',
    fuelType: '',
    exteriorColor: '',
    interiorColor: '',
    doors: null,
    seats: null,
    description: '',
    features: [],
    coverPhotoId: null,
    photoCount: 0,
    status: STATUS.DRAFT,
    statusBeforeArchive: null,
    isPublished: false,
    featured: false,
    createdAt: null,
    updatedAt: null,
    publishedAt: null,
    soldAt: null,
    deleteAfter: null,          // SOLD only: server-set end of the 7-day retention period
    deletionClaimedAt: null,    // set by the server cleanup when it starts deleting
    publishScheduled: false,    // waiting for scheduled publication (stays private until then)
    publishAt: null,            // scheduled publication time (UTC)
    scheduleCreatedAt: null,    // server-set: when / by whom the current schedule was made
    scheduleCreatedBy: null,
    scheduleBlockedReason: null, // server-set: why the last scheduled attempt did not publish
    scheduleLastAttemptAt: null,
    archivedAt: null,
    createdBy: null,
    updatedBy: null,
    soldBy: null,
    isDemo: false,
    // Internal — never public
    purchasePrice: null,
    acquisitionDate: '',
    acquisitionSource: '',
    reconditioningCost: null,
    internalNotes: '',
    employeeNotes: '',
    soldPrice: null,
    soldNote: '',
    ...overrides
  };
}

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const iso = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Coerce any stored/received record into a well-formed vehicle.
 * Protects every page from partially corrupt local data.
 * Returns null when the record is unusable (no id).
 */
export function normalizeVehicle(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object' || !text(rawRecord.id)) return null;
  const base = createVehicle();
  const v = { ...base };
  Object.keys(base).forEach((key) => {
    if (rawRecord[key] !== undefined) v[key] = rawRecord[key];
  });
  ['stockNumber', 'make', 'model', 'trim', 'bodyStyle', 'transmission', 'drivetrain', 'engine', 'fuelType',
    'exteriorColor', 'interiorColor', 'description', 'acquisitionDate', 'acquisitionSource',
    'internalNotes', 'employeeNotes', 'soldNote'].forEach((key) => { v[key] = text(v[key]); });
  v.id = text(v.id);
  v.vin = text(v.vin).toUpperCase();
  ['year', 'price', 'salePrice', 'mileage', 'doors', 'seats', 'purchasePrice', 'reconditioningCost', 'soldPrice', 'photoCount']
    .forEach((key) => { v[key] = num(v[key]); });
  v.photoCount = v.photoCount || 0;
  ['createdAt', 'updatedAt', 'publishedAt', 'soldAt', 'deleteAfter', 'deletionClaimedAt', 'archivedAt', 'publishAt', 'scheduleCreatedAt', 'scheduleLastAttemptAt']
    .forEach((key) => { v[key] = iso(v[key]); });
  v.publishScheduled = v.publishScheduled === true && Boolean(v.publishAt);
  v.scheduleBlockedReason = text(v.scheduleBlockedReason) || null;
  v.features = Array.isArray(v.features) ? v.features.map(text).filter(Boolean) : [];
  v.status = STATUS[text(v.status).toUpperCase()] || STATUS.DRAFT;
  v.statusBeforeArchive = STATUS[text(v.statusBeforeArchive).toUpperCase()] || null;
  v.isPublished = v.isPublished === true;
  v.featured = v.featured === true;
  v.isDemo = v.isDemo === true;
  return v;
}

export function vehicleTitle(v) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Untitled vehicle';
}

export function fullTitle(v) {
  return [vehicleTitle(v), v.trim].filter(Boolean).join(' ');
}

/** Price a customer would pay: sale price when set, otherwise retail. */
export function askingPrice(v) {
  return num(v.salePrice) !== null ? v.salePrice : num(v.price);
}

export function isActive(v) {
  return v.status === STATUS.DRAFT || v.status === STATUS.AVAILABLE || v.status === STATUS.PENDING;
}

/* ------------------------------------------------------------------------
   Validation
   - "draft": only what makes a record identifiable + values that are
     structurally valid (so drafts stay easy to save).
   - Publishing adds the readiness check below.
   ------------------------------------------------------------------------ */
export function validateVehicle(v) {
  const errors = {};
  const maxYear = new Date().getFullYear() + RULES.maxYearsAhead;

  if (!text(v.make)) errors.make = 'Enter the make (for example, Toyota).';
  if (!text(v.model)) errors.model = 'Enter the model (for example, Camry).';

  if (v.year !== null && v.year !== undefined) {
    if (!Number.isInteger(v.year) || v.year < RULES.minYear || v.year > maxYear) {
      errors.year = `Year must be between ${RULES.minYear} and ${maxYear}.`;
    }
  }
  moneyCheck(errors, 'price', v.price, 'Price');
  moneyCheck(errors, 'salePrice', v.salePrice, 'Sale price');
  moneyCheck(errors, 'purchasePrice', v.purchasePrice, 'Purchase price');
  moneyCheck(errors, 'reconditioningCost', v.reconditioningCost, 'Reconditioning cost');
  if (!errors.salePrice && num(v.salePrice) !== null && num(v.price) !== null && v.salePrice >= v.price) {
    errors.salePrice = 'Sale price should be lower than the retail price.';
  }
  if (Number.isNaN(v.mileage)) errors.mileage = 'Mileage must be a whole number.';
  else if (num(v.mileage) !== null && (v.mileage < 0 || v.mileage > RULES.maxMileage)) {
    errors.mileage = v.mileage < 0 ? 'Mileage cannot be negative.' : 'That mileage looks too high.';
  }
  intRange(errors, 'doors', v.doors, 1, 6, 'Doors');
  intRange(errors, 'seats', v.seats, 1, 15, 'Seats');

  if (text(v.vin)) {
    const vin = validateVin(v.vin);
    if (!vin.valid) errors.vin = vin.message;
  }
  if (text(v.description).length > RULES.descriptionMax) {
    errors.description = `Description is limited to ${RULES.descriptionMax.toLocaleString()} characters.`;
  }
  if (v.acquisitionDate && Number.isNaN(new Date(v.acquisitionDate).getTime())) {
    errors.acquisitionDate = 'Enter a valid date.';
  }
  return errors;
}

function moneyCheck(errors, key, value, label) {
  if (Number.isNaN(value)) errors[key] = `${label} must be a dollar amount.`;
  else if (num(value) !== null && value < 0) errors[key] = `${label} cannot be negative.`;
  else if (num(value) !== null && value > RULES.maxPrice) errors[key] = `${label} looks too high.`;
}

function intRange(errors, key, value, min, max, label) {
  if (Number.isNaN(value)) errors[key] = `${label} must be a number.`;
  else if (num(value) !== null && (!Number.isInteger(value) || value < min || value > max)) {
    errors[key] = `${label} must be between ${min} and ${max}.`;
  }
}

/**
 * Can this vehicle go on the public website?
 * photos: the vehicle's photo list (saved or in the editor).
 * Returns required problems (block publishing) and recommendations (warnings).
 */
export function publishReadiness(v, photos = []) {
  const missing = [];
  const warnings = [];
  const usable = photos.filter((p) => !p.error);

  if (!num(v.year)) missing.push({ field: 'year', label: 'Year' });
  if (!text(v.make)) missing.push({ field: 'make', label: 'Make' });
  if (!text(v.model)) missing.push({ field: 'model', label: 'Model' });
  if (!(num(v.price) > 0)) missing.push({ field: 'price', label: 'Price' });
  if (num(v.mileage) === null) missing.push({ field: 'mileage', label: 'Mileage' });
  if (!usable.length) missing.push({ field: 'photos', label: 'At least one photo' });
  else if (!usable.some((p) => p.isCover)) missing.push({ field: 'photos', label: 'Cover photo' });
  if (v.status === STATUS.SOLD || v.status === STATUS.ARCHIVED) {
    missing.push({ field: 'status', label: `Status (${STATUS_LABELS[v.status]} vehicles can't be published)` });
  }

  if (!text(v.stockNumber)) warnings.push('Stock number is empty.');
  if (!text(v.vin)) warnings.push('VIN is empty.');
  if (!text(v.description)) warnings.push('No description yet.');
  if (usable.length && usable.length < 5) warnings.push(`Only ${usable.length} photo${usable.length === 1 ? '' : 's'} — most listings use 10–15.`);

  return { ready: missing.length === 0, missing, warnings };
}
