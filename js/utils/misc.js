/* Small shared helpers: ids, URL params, local preferences. */
import { STORAGE } from '../config.js';

export function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  // Fallback for older browsers / non-secure contexts
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function nowIso() {
  return new Date().toISOString();
}

/* Preferences live in localStorage (tiny values only — never vehicle data or photos).
   Every access is wrapped: storage can be unavailable in private modes. */
function readPrefs() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE.prefsKey) || '{}') || {};
  } catch (err) {
    return {};
  }
}

export function getPref(key, fallback) {
  const prefs = readPrefs();
  return Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback;
}

export function setPref(key, value) {
  try {
    const prefs = readPrefs();
    prefs[key] = value;
    window.localStorage.setItem(STORAGE.prefsKey, JSON.stringify(prefs));
  } catch (err) { /* preference simply isn't remembered */ }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
