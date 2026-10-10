/* One shared Supabase client for the Private app.
   The library is the vendored UMD build (js/vendor/supabase.js), loaded by a
   <script> tag in every page, which defines window.supabase. */
import { SUPABASE } from '../supabase-config.js';

const STORAGE_KEY = 'cela.auth';

/* "Remember me". Supabase Auth keeps the sign-in it issues (its session and refresh token, never a
   password) in localStorage under STORAGE_KEY: one copy, shared by every tab. The box on the login
   form decides how long that copy can be used, and the copy starts with a word that says which:
     ticked     → 'device:'  + the session as Supabase writes it: kept until sign-out, expiry or
                  revocation
     not ticked → 'browser:' + the session encrypted (AES-GCM) with a random key that exists only in
                  a cookie without an expiry date. The browser deletes that cookie when it closes;
                  the copy can then no longer be read, and is removed when the app next opens.
   A copy that starts with neither word (a sign-in from before "Remember me") is not used. */
const ON_DEVICE = 'device:';
const UNTIL_CLOSED = 'browser:';
// Cookies belong to a host name, not to a port: the port in the name keeps two apps on one host apart.
const KEY_COOKIE = `cela_private_browser_${window.location.port || 'default'}`;

const local = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch (err) { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (err) { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (err) { /* storage blocked: nothing was kept */ }
  }
};

const base64 = {
  encode(bytes) {
    let text = '';
    bytes.forEach((byte) => { text += String.fromCharCode(byte); });
    return window.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    return Uint8Array.from(window.atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  }
};

/* The key of the current browser session (the cookie's value), and what it locks. */
const browserSession = {
  imported: null,   // { secret, key }: the last secret, ready for use

  secret() {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|; )${KEY_COOKIE}=([^;]+)`));
      return match ? match[1] : null;
    } catch (err) {
      return null;   // cookies blocked
    }
  },
  write(value, life) {
    try {
      document.cookie = `${KEY_COOKIE}=${value}; path=/; SameSite=Lax${life}${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch (err) { /* cookies blocked: there is no key */ }
  },
  newSecret() {
    return base64.encode(window.crypto.getRandomValues(new Uint8Array(32)));
  },
  /** Make this the browser session's key. False when the browser refuses the cookie. */
  begin(secret) {
    this.write(secret, '');
    return this.secret() === secret;
  },
  end() {
    this.write('', '; max-age=0');
  },
  async key(secret) {
    if (!this.imported || this.imported.secret !== secret) {
      this.imported = { secret, key: await window.crypto.subtle.importKey('raw', base64.decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']) };
    }
    return this.imported.key;
  },
  /** text → what is stored. Null when there is no key, or the browser cannot encrypt on this page. */
  async seal(text, secret) {
    try {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const data = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(secret), new TextEncoder().encode(text));
      return `${base64.encode(iv)}.${base64.encode(new Uint8Array(data))}`;
    } catch (err) {
      return null;
    }
  },
  /** What is stored → text. Null when the key is gone, or is not the one it was sealed with. */
  async open(sealed, secret) {
    try {
      const [iv, data] = sealed.split('.');
      const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64.decode(iv) }, await this.key(secret), base64.decode(data));
      return new TextDecoder().decode(plain);
    } catch (err) {
      return null;
    }
  }
};

let choice = null;             // { remember } while a sign-in is under way, otherwise null
const memory = new Map();      // stands in when the browser will not keep a sign-in: this page only
const overListeners = new Set();

/** The session inside a stored copy, or null when the copy cannot be used. */
async function read(copy) {
  if (copy.startsWith(ON_DEVICE)) return copy.slice(ON_DEVICE.length);
  if (copy.startsWith(UNTIL_CLOSED)) return browserSession.open(copy.slice(UNTIL_CLOSED.length), browserSession.secret());
  return null;
}

/** Store the session the way its sign-in asked for. False when the browser will not keep it. */
async function keep(session) {
  if (!choice && memory.has(STORAGE_KEY)) return false;   // a sign-in the browser would not keep stays on this page
  const fresh = Boolean(choice);                           // a new sign-in decides; a refreshed token follows the copy it replaces
  const before = fresh ? '' : local.get(STORAGE_KEY) || '';
  if (fresh ? choice.remember : before.startsWith(ON_DEVICE)) {
    if (fresh) browserSession.end();
    return local.set(STORAGE_KEY, ON_DEVICE + session);
  }
  if (!fresh && !before.startsWith(UNTIL_CLOSED)) return false;
  const secret = fresh ? browserSession.newSecret() : browserSession.secret();
  const sealed = secret ? await browserSession.seal(session, secret) : null;
  if (sealed === null) return false;
  // Nothing waits from here on, so the key and the copy change together. A refreshed token is stored only if
  // the key is still the one it was sealed with (another tab may have signed in meanwhile).
  if (fresh ? !browserSession.begin(secret) : browserSession.secret() !== secret) return false;
  return local.set(STORAGE_KEY, UNTIL_CLOSED + sealed);
}

/** A stored copy that cannot be used (its key is gone, or it does not say how long it is kept): it is removed
    and open pages are told, unless a new sign-in has replaced it meanwhile. */
function signInOver(copy) {
  if (local.get(STORAGE_KEY) !== copy) return;
  local.remove(STORAGE_KEY);
  window.setTimeout(() => overListeners.forEach((listener) => listener()), 0);
}

/* Supabase reads and writes its session through this object. */
const sessionStore = {
  async getItem(key) {
    if (memory.has(key)) return memory.get(key);
    const stored = local.get(key);
    if (key !== STORAGE_KEY || stored === null) return stored;
    const session = await read(stored);
    if (session === null) signInOver(stored);
    return session;
  },
  async setItem(key, value) {
    const fresh = Boolean(choice);
    if (key === STORAGE_KEY ? await keep(value) : local.set(key, value)) {
      memory.delete(key);
      return;
    }
    if (key === STORAGE_KEY && fresh) sessionStore.removeItem(key);   // nothing older or half-stored is left behind
    memory.set(key, value);
  },
  removeItem(key) {
    memory.delete(key);
    local.remove(key);
    if (key === STORAGE_KEY) browserSession.end();
  }
};

/**
 * Run one sign-in with the login form's "Remember me" choice: true keeps the sign-in it produces on
 * this device, false until the browser is closed. The choice applies to that sign-in and nothing else.
 */
export async function signInRemembering(remember, signIn) {
  const mine = { remember: Boolean(remember) };
  choice = mine;
  try {
    return await signIn();
  } finally {
    if (choice === mine) choice = null;
  }
}

/** False when the browser refused to keep the current sign-in (cookies or site data are blocked). */
export function signInKept() {
  return !memory.has(STORAGE_KEY);
}

/** Tell an open page that its stored sign-in can no longer be used (the key cookie has gone). */
export function onSignInOver(listener) {
  overListeners.add(listener);
}

let client = null;

export function getSupabase() {
  if (client) return client;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('The Supabase library did not load. Reload the page.');
  }
  client = window.supabase.createClient(SUPABASE.url, SUPABASE.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: STORAGE_KEY,
      storage: sessionStore
    }
  });
  return client;
}
