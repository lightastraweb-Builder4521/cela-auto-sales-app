/* Formatting + parsing helpers (US dealership conventions). */

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatCurrency(value, fallback = '—') {
  return isNumber(value) ? currency.format(value) : fallback;
}

export function formatNumber(value, fallback = '—') {
  return isNumber(value) ? integer.format(value) : fallback;
}

export function formatMileage(value, fallback = '—') {
  return isNumber(value) ? `${integer.format(value)} mi` : fallback;
}

export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** "$12,995.00" / "12995" / "12,995" -> 12995 ; "" -> null ; garbage -> NaN */
export function parseMoney(input) {
  const text = String(input === null || input === undefined ? '' : input).trim();
  if (!text) return null;
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned));
}

/** "45,000" / "45000 mi" -> 45000 ; "" -> null ; garbage -> NaN */
export function parseInteger(input) {
  const text = String(input === null || input === undefined ? '' : input).trim();
  if (!text) return null;
  const cleaned = text.replace(/[,\s]/g, '').replace(/(mi|miles)$/i, '');
  if (!/^-?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : fallback;
}

export function formatTime(value, fallback = '') {
  const d = toDate(value);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : fallback;
}

export function formatDateTime(value, fallback = '—') {
  const d = toDate(value);
  return d ? `${formatDate(d)}, ${formatTime(d)}` : fallback;
}

/** Time left until a future moment: "6 days, 23 hours", "5 hours", "Less than an hour", or "Due now". */
export function formatTimeRemaining(until, now = Date.now()) {
  const d = toDate(until);
  if (!d) return '—';
  const ms = d.getTime() - now;
  if (ms <= 0) return 'Due now';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}${hours ? `, ${hours} hour${hours === 1 ? '' : 's'}` : ''}`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return 'Less than an hour';
}

export function formatLongDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : fallback;
}

/** "just now", "5 min ago", "3 hr ago", "2 days ago", then a date. */
export function relativeTime(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '—';
  const seconds = Math.round((now - d.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(d);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 45) return `${Math.round(days / 7)} wk ago`;
  return formatDate(d);
}

/** Human "time since" for sold records: "2 hr 15 min", "3 days". */
export function durationSince(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '—';
  const minutes = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Local YYYY-MM-DD (for <input type="date"> and grouping). */
export function toDateInputValue(value = new Date()) {
  const d = toDate(value) || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputValue(value = new Date()) {
  const d = toDate(value) || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortVin(vin) {
  if (!vin) return '—';
  return vin.length > 8 ? `…${vin.slice(-8)}` : vin;
}

export function formatBytes(bytes) {
  if (!isNumber(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count, '0')} ${count === 1 ? singular : plural}`;
}

/* ---- Dealership-local time (scheduled publication) --------------------------------------
   The UI speaks dealership time (DEALERSHIP.timeZone); the database stores UTC instants.
   Conversions go through Intl, so daylight-saving changes are handled for any date. */

function zonedParts(ms, timeZone) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms)).forEach((p) => { if (p.type !== 'literal') parts[p.type] = Number(p.value); });
  return parts;
}

/** Offset (ms) of the zone at an instant: local wall time minus UTC. */
function zoneOffset(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * Wall-clock date ('YYYY-MM-DD') + time ('HH:MM') in timeZone → UTC ISO string.
 * Returns { iso } or { error: 'invalid' | 'nonexistent' }. When clocks fall back and a time
 * happens twice, the first (earlier) occurrence is used.
 */
export function zonedTimeToUtc(date, time, timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!dm || !tm) return { error: 'invalid' };
  const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return { error: 'invalid' };
  // The two offsets in force around this day (equal unless a DST change is near).
  const candidates = [...new Set([zoneOffset(wall - 86400000, timeZone), zoneOffset(wall + 86400000, timeZone)])]
    .map((offset) => wall - offset)
    .filter((ms) => { const p = zonedParts(ms, timeZone); return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi; })
    .sort((a, b) => a - b);
  return candidates.length ? { iso: new Date(candidates[0]).toISOString() } : { error: 'nonexistent' };
}

/** UTC instant → { date: 'YYYY-MM-DD', time: 'HH:MM' } on the wall clock of timeZone. */
export function utcToZonedInputs(value, timeZone) {
  const d = toDate(value);
  if (!d) return { date: '', time: '' };
  const p = zonedParts(d.getTime(), timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** "October 15, 2026 at 9:00 AM MDT" in timeZone. */
export function formatZonedDateTime(value, timeZone, fallback = '—') {
  const d = toDate(value);
  if (!d) return fallback;
  const date = d.toLocaleDateString('en-US', { timeZone, month: 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${date} at ${time}`;
}
