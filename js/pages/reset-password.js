/* Password page, opened from an email: a password reset (type=recovery) or an invitation (type=invite),
   where the new employee chooses their first password. Two kinds of link are understood:
     • ?token_hash=…&type=recovery|invite   (the email templates in supabase/templates):
       the one-time token is checked only when the user submits, so mail scanners that open
       links cannot use it up, and it works on any device;
     • #access_token=…&refresh_token=…&type=recovery|invite   (Supabase's standard email link, which
       Supabase has already verified before sending the browser here).
   Whatever the link carries is read once and removed from the address bar immediately. */
import { PASSWORD_RULES } from '../config.js';
import { authService, AuthError } from '../services/auth-service.js';
import { qs } from '../utils/dom.js';

const query = new URLSearchParams(window.location.search);
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const KINDS = ['recovery', 'invite'];
let link = null;
let linkProblem = '';
if (KINDS.includes(query.get('type')) && /^[A-Za-z0-9_-]{8,}$/.test(query.get('token_hash') || '')) {
  link = { type: query.get('type'), tokenHash: query.get('token_hash') };
} else if (KINDS.includes(hash.get('type')) && hash.get('access_token') && hash.get('refresh_token')) {
  link = { type: hash.get('type'), accessToken: hash.get('access_token'), refreshToken: hash.get('refresh_token') };
} else if (hash.get('error') || hash.get('error_code') || query.get('error')) {
  linkProblem = 'This reset link is invalid, already used, or expired. Request a new one.';
}
if (window.location.search || window.location.hash) window.history.replaceState(null, '', window.location.pathname);
const invited = Boolean(link && link.type === 'invite');
if (invited) {
  qs('#reset-title').textContent = 'Create your password';
  document.title = document.title.replace(/^[^|]*/, 'Create Your Password ');
}

const form = qs('[data-reset-form]');
const invalid = qs('[data-reset-invalid]');
const invalidText = qs('[data-reset-invalid-text]');
const errorBox = qs('[data-reset-error]');
const password = qs('#reset-password');
const confirm = qs('#reset-confirm');
const submit = qs('[data-reset-submit]');
qs('[data-min-length]').textContent = String(PASSWORD_RULES.minLength);

let verified = false;   // the link was accepted but the first password was refused: keep the session for a retry

function showInvalid(message) {
  form.hidden = true;
  invalidText.textContent = message;
  invalid.hidden = false;
}

if (!link) {
  showInvalid(linkProblem || 'This page needs the link from your password-reset email. Request a new link if it has expired.');
} else {
  form.hidden = false;
  password.focus();
}

const showError = (message, field) => {
  errorBox.textContent = message;
  errorBox.hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  password.removeAttribute('aria-invalid');
  confirm.removeAttribute('aria-invalid');
  if (password.value.length < PASSWORD_RULES.minLength) {
    showError(`Use at least ${PASSWORD_RULES.minLength} characters.`, password);
    return;
  }
  if (password.value !== confirm.value) {
    showError('The two passwords don’t match.', confirm);
    return;
  }
  submit.disabled = true;
  try {
    await authService.completePasswordReset(link, password.value, { alreadyVerified: verified });
    password.value = '';
    confirm.value = '';
    link = null;
    window.location.replace(invited ? 'login.html?invited=done' : 'login.html?reset=done');
  } catch (err) {
    submit.disabled = false;
    password.value = '';
    confirm.value = '';
    if (err && err.linkInvalid) {
      showInvalid(err.message);
      return;
    }
    if (err && err.verified) verified = true;
    showError(err instanceof AuthError ? err.message : 'Couldn’t change the password. Please try again.', password);
  }
});
