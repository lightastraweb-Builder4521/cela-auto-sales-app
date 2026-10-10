/* ==========================================================================
   Cela Auto Sales — Private inventory manager: configuration
   --------------------------------------------------------------------------
   NO SECRETS BELONG IN THIS FILE — it is served to the browser.
   The only Supabase values allowed in browser code are the project URL and
   the publishable key (js/supabase-config.js). The service-role key must
   NEVER be placed in any frontend file.
   ========================================================================== */

/* --------------------------------------------------------------------------
   BACKEND SWITCH — the one setting that decides where data lives.

     'supabase'  Staging / production. Shared, secured database + Storage,
                 real employee sign-in (Supabase Auth). Row Level Security
                 enforces every permission. Development login is disabled.

     'local'     Offline development only. Data stays in this browser
                 (IndexedDB) and the insecure development login is enabled.
                 Never use for real dealership data.
   -------------------------------------------------------------------------- */
const BACKEND = 'supabase';

export const APP = Object.freeze({
  name: 'Cela Inventory Manager',
  backend: BACKEND,
  authProvider: BACKEND === 'supabase' ? 'supabase' : 'development',
  environment: BACKEND === 'supabase' ? 'production' : 'development',
  allowDevelopmentLogin: BACKEND === 'local'
});

export const DEALERSHIP = Object.freeze({
  name: 'Cela Auto Sales LLC',
  street: '423 N Franklin Blvd',
  city: 'Nampa',
  region: 'Idaho',
  phoneDisplay: '(208) 713-1487',
  phoneHref: 'tel:+12087131487',
  email: 'bcela@netzero.net',
  facebook: 'https://www.facebook.com/people/Cela-Auto-Sales-LLC/61590670534084/',
  // Dealership-local time for scheduling (Nampa, Idaho). Stored times are UTC; DST handled by Intl.
  timeZone: 'America/Boise',
  timeZoneLabel: 'Mountain Time'
});

/* Passwords: the same minimum is enforced by Supabase Auth (project setting). */
export const PASSWORD_RULES = Object.freeze({ minLength: 10 });

/* Managed-service provider: public contact details shown in Billing and Settings. */
export const SUPPORT = Object.freeze({
  company: 'Light Astra',
  website: 'https://lightastra.com',
  websiteLabel: 'lightastra.com',
  email: 'lightastra.web@gmail.com',
  subject: 'Cela Auto Sales — managed app support'
});

/* Business rules shared by validation, publishing and the Public mapping. */
export const RULES = Object.freeze({
  // SOLD vehicles leave the public site immediately. They stay in Sold History for
  // soldRetentionDays, then the server permanently deletes them with their photos
  // (unless restored first). The database enforces both rules.
  soldRetentionDays: 7,
  minYear: 1900,
  maxYearsAhead: 1,          // model years run up to one year ahead
  maxPrice: 5000000,
  maxMileage: 2000000,
  descriptionRecommended: 1200,
  descriptionMax: 5000,
  noteMax: 2000
});

export const PHOTO_RULES = Object.freeze({
  maxPerVehicle: 40,
  recommendedMin: 10,
  recommendedMax: 15,
  maxBytes: 40 * 1024 * 1024, // per original file
  displayMaxEdge: 2048,        // browser-made working copy (original is kept)
  thumbMaxEdge: 480,
  jpegQuality: 0.86,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  acceptedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
});

export const STORAGE = Object.freeze({
  dbName: 'cela-private-dev',
  dbVersion: 1,
  sessionKey: 'cela.dev.session',   // development login only — not a credential
  prefsKey: 'cela.prefs',           // small UI preferences (view, theme)
  loginEmailKey: 'cela.login.email' // "Remember me": the sign-in email only — never a password
});
