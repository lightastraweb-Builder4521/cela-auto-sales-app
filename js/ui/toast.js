/* Toast notifications. One polite live region; errors are announced assertively.
   toast('Vehicle saved.') / toast('Photo removed.', { action: { label: 'Undo', onClick } }) */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

const ICON_BY_TONE = { success: 'checkCircle', info: 'info', warning: 'alert', error: 'alert' };
const MAX_VISIBLE = 4;

function region() {
  let el = document.getElementById('toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toasts';
    el.className = 'toasts';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

export function toast(message, { tone = 'success', action = null, duration } = {}) {
  const container = region();
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  if (tone === 'error') el.setAttribute('role', 'alert');
  el.innerHTML = String(html`
    ${icon(ICON_BY_TONE[tone] || 'info', 'toast__icon')}
    <p class="toast__message">${message}</p>
    ${action ? html`<button type="button" class="toast__action">${action.label}</button>` : ''}
    <button type="button" class="toast__close" aria-label="Dismiss notification">${icon('x')}</button>`);

  let timer = null;
  let remaining = duration || (action ? 8000 : tone === 'error' ? 8000 : 4500);
  let started = Date.now();

  const dismiss = () => {
    window.clearTimeout(timer);
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 180);
  };
  const start = () => { started = Date.now(); timer = window.setTimeout(dismiss, remaining); };
  const pause = () => { window.clearTimeout(timer); remaining -= Date.now() - started; };

  el.querySelector('.toast__close').addEventListener('click', dismiss);
  if (action) {
    el.querySelector('.toast__action').addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
  }
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', start);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', start);

  container.appendChild(el);
  while (container.children.length > MAX_VISIBLE) container.firstElementChild.remove();
  start();
  return { dismiss };
}

export const toastError = (message) => toast(message, { tone: 'error' });

/* Flash: a toast that survives a page navigation (e.g. "Vehicle saved." after redirect). */
const FLASH_KEY = 'cela.flash';

export function flash(message, tone = 'success') {
  try { window.sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, tone })); } catch (err) { /* ignore */ }
}

export function showFlash() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(FLASH_KEY) || 'null');
    window.sessionStorage.removeItem(FLASH_KEY);
    if (stored && stored.message) toast(stored.message, { tone: stored.tone || 'success' });
  } catch (err) { /* ignore */ }
}
