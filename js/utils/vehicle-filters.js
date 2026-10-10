/* Pure search / filter / sort functions for vehicle lists. No DOM here. */
import { STATUS, askingPrice, STATUS_LABELS } from '../models/vehicle.js';
import { formatCurrency, formatNumber } from './format.js';

export const INVENTORY_DEFAULTS = Object.freeze({
  q: '', status: 'all', published: 'all', make: '', model: '', yearMin: '', yearMax: '',
  priceMin: '', priceMax: '', mileageMin: '', mileageMax: '', body: '', transmission: '',
  drivetrain: '', fuel: '', added: '', updated: '', sort: 'newest'
});

export const SORT_OPTIONS = [
  ['newest', 'Newest added'],
  ['oldest', 'Oldest added'],
  ['updated', 'Recently updated'],
  ['price-asc', 'Price: low → high'],
  ['price-desc', 'Price: high → low'],
  ['mileage-asc', 'Mileage: low → high'],
  ['mileage-desc', 'Mileage: high → low'],
  ['year-desc', 'Year: newest'],
  ['year-asc', 'Year: oldest']
];

export const ADDED_OPTIONS = [['', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
export const UPDATED_OPTIONS = [['', 'Any time'], ['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days']];

const DAY = 24 * 60 * 60 * 1000;
const num = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Year, make, model, trim, VIN, stock #, price and mileage are all searchable. */
export function matchesSearch(v, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    v.year, v.make, v.model, v.trim, v.vin, v.stockNumber,
    v.price, v.salePrice, v.mileage, v.bodyStyle, v.exteriorColor
  ].filter((x) => x !== null && x !== undefined).join(' ').toLowerCase();
  return tokens.every((token) => {
    const plain = token.replace(/[$,]/g, '');
    return plain ? haystack.includes(plain) : true;
  });
}

function withinDays(iso, days, now) {
  if (!days) return true;
  if (!iso) return false;
  return now - new Date(iso).getTime() <= Number(days) * DAY;
}

export function filterInventory(vehicles, f, now = Date.now()) {
  return vehicles.filter((v) => {
    if (f.status === 'all') { if (v.status === STATUS.ARCHIVED) return false; }
    else if (f.status && v.status !== f.status) return false;
    if (f.published === 'yes' && !v.isPublished) return false;
    if (f.published === 'no' && v.isPublished) return false;
    if (!matchesSearch(v, f.q)) return false;
    if (f.make && v.make.toLowerCase() !== f.make.toLowerCase()) return false;
    if (f.model && v.model.toLowerCase() !== f.model.toLowerCase()) return false;

    const yMin = num(f.yearMin); const yMax = num(f.yearMax);
    if (yMin !== null && !(v.year >= yMin)) return false;
    if (yMax !== null && !(v.year <= yMax)) return false;

    const pMin = num(f.priceMin); const pMax = num(f.priceMax);
    const price = askingPrice(v);
    if ((pMin !== null || pMax !== null) && price === null) return false;
    if (pMin !== null && price < pMin) return false;
    if (pMax !== null && price > pMax) return false;

    const mMin = num(f.mileageMin); const mMax = num(f.mileageMax);
    if ((mMin !== null || mMax !== null) && v.mileage === null) return false;
    if (mMin !== null && v.mileage < mMin) return false;
    if (mMax !== null && v.mileage > mMax) return false;

    if (f.body && v.bodyStyle !== f.body) return false;
    if (f.transmission && v.transmission !== f.transmission) return false;
    if (f.drivetrain && v.drivetrain !== f.drivetrain) return false;
    if (f.fuel && v.fuelType !== f.fuel) return false;
    if (!withinDays(v.createdAt, f.added, now)) return false;
    if (!withinDays(v.updatedAt, f.updated, now)) return false;
    return true;
  });
}

function byNumber(get, direction) {
  return (a, b) => {
    const x = get(a); const y = get(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1; // blanks always last
    if (y === null) return -1;
    return (x - y) * direction;
  };
}

const byDate = (key, direction) => (a, b) => {
  const x = a[key] || ''; const y = b[key] || '';
  return x === y ? 0 : (x < y ? -1 : 1) * direction;
};

const SORTS = {
  newest: byDate('createdAt', -1),
  oldest: byDate('createdAt', 1),
  updated: byDate('updatedAt', -1),
  'price-asc': byNumber(askingPrice, 1),
  'price-desc': byNumber(askingPrice, -1),
  'mileage-asc': byNumber((v) => v.mileage, 1),
  'mileage-desc': byNumber((v) => v.mileage, -1),
  'year-desc': byNumber((v) => v.year, -1),
  'year-asc': byNumber((v) => v.year, 1)
};

export function sortVehicles(vehicles, sort) {
  const compare = SORTS[sort] || SORTS.newest;
  return vehicles.slice().sort((a, b) => compare(a, b) || byDate('createdAt', -1)(a, b));
}

/** Human labels for active filters (chips). Excludes q/status/sort, which have their own controls. */
export function describeFilters(f) {
  const chips = [];
  const add = (key, label) => chips.push({ key, label });
  if (f.published === 'yes') add('published', 'Published');
  if (f.published === 'no') add('published', 'Not published');
  if (f.make) add('make', f.make);
  if (f.model) add('model', f.model);
  if (f.yearMin) add('yearMin', `From ${f.yearMin}`);
  if (f.yearMax) add('yearMax', `To ${f.yearMax}`);
  if (f.priceMin) add('priceMin', `Min ${formatCurrency(num(f.priceMin))}`);
  if (f.priceMax) add('priceMax', `Max ${formatCurrency(num(f.priceMax))}`);
  if (f.mileageMin) add('mileageMin', `≥ ${formatNumber(num(f.mileageMin))} mi`);
  if (f.mileageMax) add('mileageMax', `≤ ${formatNumber(num(f.mileageMax))} mi`);
  if (f.body) add('body', f.body);
  if (f.transmission) add('transmission', f.transmission);
  if (f.drivetrain) add('drivetrain', f.drivetrain);
  if (f.fuel) add('fuel', f.fuel);
  if (f.added) add('added', `Added: last ${f.added} days`);
  if (f.updated) add('updated', f.updated === '1' ? 'Updated: last 24 hours' : `Updated: last ${f.updated} days`);
  return chips;
}

export function filtersFromQuery(search, defaults = INVENTORY_DEFAULTS) {
  const params = new URLSearchParams(search);
  const f = { ...defaults };
  Object.keys(defaults).forEach((key) => { if (params.has(key)) f[key] = params.get(key) || ''; });
  if (f.status !== 'all' && !STATUS_LABELS[f.status]) f.status = 'all';
  if (!SORTS[f.sort]) f.sort = defaults.sort;
  return f;
}

export function filtersToQuery(f, defaults = INVENTORY_DEFAULTS) {
  const params = new URLSearchParams();
  Object.keys(defaults).forEach((key) => { if (f[key] && f[key] !== defaults[key]) params.set(key, f[key]); });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function uniqueSorted(values) {
  const seen = new Map();
  values.forEach((value) => {
    if (value && !seen.has(String(value).toLowerCase())) seen.set(String(value).toLowerCase(), value);
  });
  return Array.from(seen.values()).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}
