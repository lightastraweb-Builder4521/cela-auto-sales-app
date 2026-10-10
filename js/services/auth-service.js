/* ==========================================================================
   Authentication service
   --------------------------------------------------------------------------
   Two providers behind one API (pages only ever call `authService`):

   • supabaseProvider    — real employee sign-in (email + password) through
                           Supabase Auth. The employee's role comes from the
                           `profiles` table. The role is used here ONLY to
                           show/hide buttons; the database (Row Level
                           Security) enforces every permission on its own.

   • developmentProvider — NOT SECURE. Local offline development only
                           (APP.backend === 'local'). Disabled whenever the
                           app is connected to Supabase.

   The provider is chosen by APP.authProvider in js/config.js.
   No passwords or secrets are stored in this file.
   ========================================================================== */
import { APP, STORAGE, PASSWORD_RULES } from '../config.js';
import { getSupabase, signInRemembering, signInKept, onSignInOver } from '../data/supabase-client.js';

export const ROLES = Object.freeze({ ADMIN: 'admin', EMPLOYEE: 'employee' });

export const ROLE_LABELS = Object.freeze({ admin: 'Admin', employee: 'Employee' });

/* Simple two-role model (mirrors the database policies):
   Admin    → full dealership management (incl. permanent delete, settings)
   Employee → day-to-day inventory operations */
const PERMISSIONS = {
  admin: ['*'],
  employee: ['vehicle.read', 'vehicle.write', 'vehicle.status', 'vehicle.archive', 'photo.write', 'activity.read']
};

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthNotConnectedError extends AuthError {
  constructor() {
    super('Email sign-in works when the app is connected to Supabase. In local development mode, use a development login below.');
    this.name = 'AuthNotConnectedError';
  }
}

/* ---------------------------- Supabase Auth ---------------------------- */

/** Supabase password errors → plain language. Never includes the password itself. */
function passwordErrorMessage(error) {
  const code = String((error && (error.code || error.error_code)) || '');
  const text = String((error && error.message) || '');
  if (code === 'same_password' || /different from the old password/i.test(text)) return 'Choose a password that is different from your current one.';
  if (code === 'weak_password' || /at least|too short|weak/i.test(text)) return `Use at least ${PASSWORD_RULES.minLength} characters.`;
  if (code === 'reauthentication_needed' || /reauthentication/i.test(text)) return 'For security, sign out, sign in again, and then change your password.';
  if (/session|jwt|not authenticated/i.test(text)) return 'Your sign-in has expired. Please sign in again.';
  if (/failed to fetch|network/i.test(text)) return 'Couldn’t reach the sign-in service. Check your internet connection.';
  return 'Couldn’t change the password. Please try again.';
}

/* "Remember me": the sign-in email, kept in this browser so the login form can be pre-filled.
   Only the email. The sign-in itself is Supabase's own session (js/data/supabase-client.js). */
const rememberedEmail = {
  get() {
    try { return window.localStorage.getItem(STORAGE.loginEmailKey) || ''; } catch (err) { return ''; }
  },
  set(email) {
    try { window.localStorage.setItem(STORAGE.loginEmailKey, email); } catch (err) { /* simply isn't remembered */ }
  },
  clear() {
    try { window.localStorage.removeItem(STORAGE.loginEmailKey); } catch (err) { /* nothing stored */ }
  }
};

const supabaseProvider = {
  mode: 'supabase',
  isSecure: true,
  session: null,

  /** Restore the saved session (if any) and load the employee profile. Call once per page before getSession(). */
  async init() {
    const { data, error } = await getSupabase().auth.getSession();
    if (error || !data || !data.session) {
      this.session = null;
      return null;
    }
    try {
      return await this.loadProfile(data.session.user);
    } catch (err) {
      if (err instanceof AuthError && err.notEmployee) return null; // signed out below
      throw err;
    }
  },

  async loadProfile(user) {
    const { data, error } = await getSupabase().from('profiles')
      .select('id, display_name, role, is_active').eq('id', user.id).maybeSingle();
    if (error) throw new AuthError('Couldn’t reach the database. Check your internet connection and try again.');
    if (!data || !data.is_active) {
      await getSupabase().auth.signOut();
      this.session = null;
      const denied = new AuthError('This account isn’t set up as an active Cela employee. Ask an Admin for access.');
      denied.notEmployee = true;
      throw denied;
    }
    this.session = {
      user: { id: data.id, displayName: data.display_name, role: data.role, email: user.email || '' },
      mode: 'supabase'
    };
    return this.session;
  },

  getSession() {
    return this.session;
  },

  /**
   * remember = the login form's "Remember me" box. Ticked: the sign-in stays on this device and the
   * email is remembered. Not ticked: the sign-in ends when the browser is closed and no email is kept.
   */
  async signInWithPassword(email, password, { remember = false } = {}) {
    if (!remember) rememberedEmail.clear();
    const { data, error } = await signInRemembering(remember, () => getSupabase().auth.signInWithPassword({ email, password }));
    if (error) {
      const text = String(error.message || '');
      if (/invalid login credentials|invalid_credentials/i.test(text)) throw new AuthError('That email or password isn’t right.');
      if (/failed to fetch|network/i.test(text)) throw new AuthError('Couldn’t reach the sign-in service. Check your internet connection.');
      throw new AuthError('Sign-in failed. Please try again.');
    }
    if (!signInKept()) {
      // The next page would not know about this sign-in: end it here instead of sending the user round in a circle.
      await getSupabase().auth.signOut({ scope: 'local' });
      throw new AuthError('This browser is blocking cookies or site data for this page, so it can’t keep you signed in. Allow them for this site, then sign in again.');
    }
    const session = await this.loadProfile(data.user);
    if (remember) rememberedEmail.set(email);
    return session;
  },

  rememberedEmail() {
    return rememberedEmail.get();
  },

  async signInDevelopment() {
    throw new AuthError('Development login is disabled while the app is connected to Supabase.');
  },

  async signOut() {
    this.session = null;
    await getSupabase().auth.signOut();
  },

  /** Notify when the session ends elsewhere (expired, signed out in another tab, or no longer usable in this browser). */
  onSignedOut(callback) {
    getSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') callback();
    });
    onSignInOver(callback);
  },

  /** Map of employee id → display name (for "sold by", "added by"). */
  async directory() {
    const { data } = await getSupabase().from('profiles').select('id, display_name');
    return new Map((data || []).map((p) => [p.id, p.display_name]));
  },

  /**
   * Forgot password: ask Supabase to email a one-time reset link. The answer never reveals
   * whether an address has an account (only rate limits and network problems are reported).
   */
  async requestPasswordReset(email) {
    // The emailed link comes back to this app's reset page (Supabase only allows listed pages).
    const redirectTo = new URL('reset-password.html', window.location.href).href;
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (!error) return;
    const text = String(error.message || '');
    if (error.status === 429 || /rate limit|too many/i.test(text)) throw new AuthError('Too many reset requests. Please wait a few minutes and try again.');
    if (/failed to fetch|network/i.test(text)) throw new AuthError('Couldn’t reach the sign-in service. Check your internet connection.');
  },

  /**
   * Emailed link → password, then that session is closed so the user signs in. The link is a password reset
   * (type 'recovery') or an invitation (type 'invite': the new employee's first password).
   * link = { type, tokenHash } (the email templates: checked only now, when the user submits) or
   *        { type, accessToken, refreshToken } (Supabase's standard link, already verified by Supabase).
   * If the password is refused, the verified session is kept so the user can try another one.
   */
  async completePasswordReset(link, newPassword, { alreadyVerified = false } = {}) {
    const client = getSupabase();
    const invited = link.type === 'invite';
    if (!alreadyVerified) {
      // An emailed link is never a remembered sign-in: what it opens ends with the browser session at the latest.
      const { error } = await signInRemembering(false, () => (link.tokenHash
        ? client.auth.verifyOtp({ type: invited ? 'invite' : 'recovery', token_hash: link.tokenHash })
        : client.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })));
      if (error) {
        const expired = new AuthError(invited
          ? 'This invitation link is invalid, already used, or expired. Ask Light Astra to send a new invitation.'
          : 'This reset link is invalid, already used, or expired. Request a new one from the sign-in page.');
        expired.linkInvalid = true;
        throw expired;
      }
    }
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      const refused = new AuthError(passwordErrorMessage(error));
      refused.verified = true;
      throw refused;
    }
    this.session = null;
    await client.auth.signOut();
  },

  /** Signed-in user changes THEIR OWN password (Supabase Auth acts on the current session only). */
  async changePassword(newPassword) {
    const { error } = await getSupabase().auth.updateUser({ password: newPassword });
    if (error) throw new AuthError(passwordErrorMessage(error));
  }
};

/* ---------------------------- Development (local only) ---------------------------- */

/* Generic development identities (no real names). */
const DEV_IDENTITIES = Object.freeze({
  'dev-admin': { id: 'dev-admin', displayName: 'Dev Admin', role: ROLES.ADMIN, email: '' },
  'dev-employee': { id: 'dev-employee', displayName: 'Dev Employee', role: ROLES.EMPLOYEE, email: '' }
});

const developmentProvider = {
  mode: 'development',
  isSecure: false,

  async init() {
    return this.getSession();
  },

  getSession() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE.sessionKey) || 'null');
      if (stored && DEV_IDENTITIES[stored.userId]) {
        return { user: DEV_IDENTITIES[stored.userId], startedAt: stored.startedAt, mode: 'development' };
      }
    } catch (err) { /* treat as signed out */ }
    return null;
  },

  async signInDevelopment(identityKey) {
    if (!DEV_IDENTITIES[identityKey]) throw new AuthError('Unknown development identity.');
    try {
      window.localStorage.setItem(STORAGE.sessionKey, JSON.stringify({ userId: identityKey, startedAt: new Date().toISOString() }));
    } catch (err) {
      throw new AuthError('This browser is blocking local storage, so the development login cannot be remembered.');
    }
    return this.getSession();
  },

  async signInWithPassword() {
    throw new AuthNotConnectedError();
  },

  rememberedEmail() {
    return '';
  },

  async signOut() {
    try { window.localStorage.removeItem(STORAGE.sessionKey); } catch (err) { /* nothing stored */ }
  },

  onSignedOut() { /* local sessions don't expire */ },

  async requestPasswordReset() { throw new AuthNotConnectedError(); },
  async completePasswordReset() { throw new AuthNotConnectedError(); },
  async changePassword() { throw new AuthNotConnectedError(); },

  async directory() {
    return new Map(Object.values(DEV_IDENTITIES).map((u) => [u.id, u.displayName]));
  }
};

const provider = APP.authProvider === 'supabase' ? supabaseProvider : developmentProvider;

export const authService = {
  get mode() { return provider.mode; },
  get isSecure() { return provider.isSecure; },
  get developmentLoginAllowed() { return APP.allowDevelopmentLogin && provider.mode === 'development'; },

  init: () => provider.init(),
  getSession: () => provider.getSession(),
  getCurrentUser() {
    const session = this.getSession();
    return session ? session.user : null;
  },
  signInDevelopment: (key) => provider.signInDevelopment(key),
  signInWithPassword: (email, password, options) => provider.signInWithPassword(email, password, options),
  rememberedEmail: () => provider.rememberedEmail(),
  signOut: () => provider.signOut(),
  onSignedOut: (callback) => provider.onSignedOut(callback),
  directory: () => provider.directory(),
  requestPasswordReset: (email) => provider.requestPasswordReset(email),
  completePasswordReset: (link, password, options) => provider.completePasswordReset(link, password, options),
  changePassword: (password) => provider.changePassword(password),

  /** UI hint only — the database enforces the real permission. */
  can(permission) {
    const user = this.getCurrentUser();
    if (!user) return false;
    const granted = PERMISSIONS[user.role] || [];
    return granted.includes('*') || granted.includes(permission);
  },

  /** Actor stamp for records and activity. */
  actor() {
    const user = this.getCurrentUser();
    return user ? { actorId: user.id, actorName: user.displayName } : { actorId: 'unknown', actorName: 'Unknown user' };
  }
};

export const DEVELOPMENT_IDENTITIES = DEV_IDENTITIES;
