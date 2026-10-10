/* Login page. Employees sign in with email + password (Supabase Auth).
   The development buttons appear only in local offline mode and are NOT secure. */
import { authService, AuthError } from '../services/auth-service.js';
import { qs } from '../utils/dom.js';

function safeNext() {
  const next = new URLSearchParams(window.location.search).get('next') || '';
  // Only allow local page names (prevents open redirects)
  return /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next) ? next : 'dashboard.html';
}

let existingSession = null;
try {
  existingSession = await authService.init();
} catch (err) { /* offline or backend unreachable: show the form; signing in will report it */ }

if (existingSession) {
  window.location.replace(safeNext());
} else {
  // Development login exists only in local mode (APP.backend === 'local').
  const devBox = qs('[data-dev-login-box]');
  if (devBox) devBox.hidden = !authService.developmentLoginAllowed;

  const form = qs('[data-login-form]');
  const errorBox = qs('[data-login-error]');
  const email = qs('#login-email');
  const password = qs('#login-password');
  const remember = qs('#login-remember');
  const submit = qs('[type="submit"]', form);

  // "Remember me" was used on this device before: the email comes back, never the password.
  const knownEmail = authService.rememberedEmail();
  if (knownEmail && remember) {
    if (!email.value) email.value = knownEmail;
    remember.checked = email.value.trim() === knownEmail;
    // Someone else signing in on this device starts unticked; after that the box is theirs to set.
    const otherPerson = () => {
      if (email.value.trim() === knownEmail) return;
      remember.checked = false;
      email.removeEventListener('input', otherPerson);
    };
    email.addEventListener('input', otherPerson);
  }

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    email.removeAttribute('aria-invalid');
    password.removeAttribute('aria-invalid');
    if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      email.setAttribute('aria-invalid', 'true');
      showError('Enter your work email address.');
      email.focus();
      return;
    }
    if (!password.value) {
      password.setAttribute('aria-invalid', 'true');
      showError('Enter your password.');
      password.focus();
      return;
    }
    submit.disabled = true;   // one sign-in at a time
    try {
      await authService.signInWithPassword(email.value.trim(), password.value, { remember: Boolean(remember && remember.checked) });
      window.location.replace(safeNext());
    } catch (err) {
      showError(err instanceof AuthError ? err.message : 'Sign-in failed. Please try again.');
      submit.disabled = false;
    } finally {
      password.value = '';
    }
  });

  /* ---------- notices + forgot password ---------- */
  const params = new URLSearchParams(window.location.search);
  const notice = qs('[data-login-notice]');
  if (params.get('reset') === 'done') {
    notice.textContent = 'Your password was changed. Sign in with your new password.';
    notice.hidden = false;
  } else if (params.get('invited') === 'done') {
    notice.textContent = 'Your account is ready. Sign in with your email address and the password you chose.';
    notice.hidden = false;
  }

  const forgotForm = qs('[data-forgot-form]');
  const forgotEmail = qs('#forgot-email');
  const forgotError = qs('[data-forgot-error]');
  const forgotDone = qs('[data-forgot-done]');
  const forgotSubmit = qs('[data-forgot-submit]');
  const showForgot = (open) => {
    form.hidden = open;
    forgotForm.hidden = !open;
    notice.hidden = true;
    errorBox.hidden = true;
    forgotError.hidden = true;
    forgotDone.hidden = true;
    forgotSubmit.disabled = false;
    if (open) {
      forgotEmail.value = email.value.trim();
      forgotEmail.focus();
    } else {
      email.focus();
    }
  };
  qs('[data-forgot-open]').addEventListener('click', () => showForgot(true));
  qs('[data-forgot-cancel]').addEventListener('click', () => showForgot(false));
  if (params.get('forgot') === '1') showForgot(true);

  forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    forgotError.hidden = true;
    forgotDone.hidden = true;
    const address = forgotEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      forgotEmail.setAttribute('aria-invalid', 'true');
      forgotError.textContent = 'Enter your work email address.';
      forgotError.hidden = false;
      forgotEmail.focus();
      return;
    }
    forgotEmail.removeAttribute('aria-invalid');
    forgotSubmit.disabled = true;
    try {
      await authService.requestPasswordReset(address);
      forgotDone.hidden = false;
    } catch (err) {
      forgotError.textContent = err instanceof AuthError ? err.message : 'Something went wrong. Please try again.';
      forgotError.hidden = false;
      forgotSubmit.disabled = false;
    }
  });

  qs('[data-toggle-password]').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const showing = password.type === 'text';
    password.type = showing ? 'password' : 'text';
    button.setAttribute('aria-pressed', String(!showing));
    button.querySelector('span').textContent = showing ? 'Show' : 'Hide';
  });

  document.querySelectorAll('[data-dev-login]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!authService.developmentLoginAllowed) return;
      try {
        await authService.signInDevelopment(button.dataset.devLogin);
        window.location.replace(safeNext());
      } catch (err) {
        showError(err.message);
      }
    });
  });
}
