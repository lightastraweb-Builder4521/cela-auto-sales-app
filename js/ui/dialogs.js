/* Accessible modal dialogs built on native <dialog> (focus trap + Escape built in).
   All return Promises so flows read top-to-bottom:
     if (await confirmDialog({...})) { ... } */
import { html, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

let counter = 0;

/**
 * Low-level: opens a dialog whose <form method="dialog"> resolves with the
 * clicked button's value (or null on cancel/Escape).
 * validate(form) may return an error map { fieldName: message } to keep it open.
 */
export function openDialog({ title, body, actions, size = 'md', tone = '', validate = null, initialFocus = null }) {
  const id = `dialog-${++counter}`;
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = `modal modal--${size}${tone ? ` modal--${tone}` : ''}`;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.innerHTML = String(html`
    <form method="dialog" class="modal__form" novalidate>
      <header class="modal__header">
        <h2 class="modal__title" id="${id}-title">${title}</h2>
        <button type="submit" value="" formnovalidate class="icon-btn modal__close" aria-label="Close dialog">${icon('x')}</button>
      </header>
      <div class="modal__body">${body}</div>
      <footer class="modal__footer">${actions}</footer>
    </form>`);
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    const form = dialog.querySelector('form');

    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      const value = submitter ? submitter.value : '';
      if (value && validate) {
        const errors = validate(form, value);
        if (errors && Object.keys(errors).length) {
          event.preventDefault();
          showErrors(form, errors);
          return;
        }
      }
      dialog.dataset.result = value;
    });

    dialog.addEventListener('close', () => {
      const value = dialog.dataset.result || null;
      const data = new FormData(form);
      dialog.remove();
      if (previousFocus && document.contains(previousFocus) && previousFocus.focus) previousFocus.focus();
      resolve(value ? { value, data } : null);
    });

    dialog.showModal();
    const focusTarget = initialFocus ? dialog.querySelector(initialFocus) : null;
    if (focusTarget) focusTarget.focus();
  });
}

function showErrors(form, errors) {
  form.querySelectorAll('.field-error[data-for]').forEach((el) => { el.textContent = ''; el.hidden = true; });
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  let first = null;
  Object.entries(errors).forEach(([name, message]) => {
    const input = form.elements.namedItem(name);
    const slot = form.querySelector(`.field-error[data-for="${name}"]`);
    if (slot) { slot.textContent = message; slot.hidden = false; }
    if (input && input.setAttribute) {
      input.setAttribute('aria-invalid', 'true');
      first = first || input;
    }
  });
  if (first && first.focus) first.focus();
}

function buttons({ confirmLabel, cancelLabel = 'Cancel', tone = 'primary', confirmIcon = null }) {
  return html`
    <button type="submit" value="" formnovalidate class="btn btn--ghost">${cancelLabel}</button>
    <button type="submit" value="confirm" class="btn btn--${tone === 'danger' ? 'danger' : 'primary'}">${confirmIcon ? icon(confirmIcon) : ''}${confirmLabel}</button>`;
}

/** Yes/no confirmation → Promise<boolean>. */
export async function confirmDialog({ title, message, detail = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', confirmIcon = null }) {
  const result = await openDialog({
    title,
    size: 'sm',
    tone: tone === 'danger' ? 'danger' : '',
    body: html`<p class="modal__text">${message}</p>${detail ? html`<p class="modal__detail">${detail}</p>` : ''}`,
    actions: buttons({ confirmLabel, cancelLabel, tone, confirmIcon }),
    initialFocus: tone === 'danger' ? '.btn--ghost' : '.btn--primary'
  });
  return Boolean(result);
}

/** Dialog with custom fields → Promise<FormData|null>. fields: html`` markup. */
export async function formDialog({ title, intro = '', fields, confirmLabel, tone = 'primary', confirmIcon = null, validate, initialFocus }) {
  const result = await openDialog({
    title,
    size: 'md',
    body: html`${intro ? html`<p class="modal__text">${intro}</p>` : ''}<div class="modal__fields">${fields}</div>`,
    actions: buttons({ confirmLabel, tone, confirmIcon }),
    validate: validate ? (form) => validate(new FormData(form), form) : null,
    initialFocus
  });
  return result ? result.data : null;
}

/** Type-to-confirm for irreversible actions → Promise<boolean>. */
export async function typedConfirmDialog({ title, message, detail = '', phrase = 'DELETE PERMANENTLY', confirmLabel = 'Delete permanently' }) {
  const result = await openDialog({
    title,
    size: 'sm',
    tone: 'danger',
    body: html`
      <p class="modal__text">${message}</p>
      ${detail ? html`<p class="modal__detail">${detail}</p>` : ''}
      <div class="field">
        <label class="field__label" for="typed-confirm">Type <strong>${phrase}</strong> to confirm</label>
        <input class="input" id="typed-confirm" name="typed" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="typed-confirm-error">
        <p class="field-error" id="typed-confirm-error" data-for="typed" hidden></p>
      </div>`,
    actions: buttons({ confirmLabel, tone: 'danger', confirmIcon: 'trash' }),
    validate: (form) => (form.elements.namedItem('typed').value.trim() === phrase ? null : { typed: `Type ${phrase} exactly (capital letters).` }),
    initialFocus: '#typed-confirm'
  });
  return Boolean(result);
}

/** "Vehicle isn't ready to publish." with the missing list → Promise<'fix'|null>. */
export async function readinessDialog({ readiness, fixLabel = 'Fix these now' }) {
  const result = await openDialog({
    title: 'Vehicle isn’t ready to publish.',
    size: 'sm',
    body: html`
      <p class="modal__text">Add the following before publishing:</p>
      <ul class="readiness-list">
        ${readiness.missing.map((m) => html`<li>${icon('alert')}<span>${m.label}</span></li>`)}
      </ul>
      ${readiness.warnings.length ? html`
        <p class="modal__detail">Recommended (not required):</p>
        <ul class="readiness-list readiness-list--soft">
          ${readiness.warnings.map((w) => html`<li>${icon('info')}<span>${w}</span></li>`)}
        </ul>` : ''}`,
    actions: html`
      <button type="submit" value="" formnovalidate class="btn btn--ghost">Close</button>
      <button type="submit" value="fix" class="btn btn--primary">${icon('edit')}${fixLabel}</button>`,
    initialFocus: '.btn--primary'
  });
  return result ? result.value : null;
}

export { raw };
