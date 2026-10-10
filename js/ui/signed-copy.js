/* Signed agreement copy (PDF) — one helper for every page that offers it (Service, Billing, Settings).
   The PDF is produced by the server for a signed-in Admin; nothing here builds or stores a document. */
import { lightAstraService } from '../services/light-astra-service.js';
import { toast, toastError } from './toast.js';

/* What became of the emailed copy, as the server reports it. It says SENT only after the mail server took the message. */
const EMAIL_NOTES = {
  SENT: 'A copy of this signed agreement was emailed to the registered address.',
  PENDING_SMTP: 'The copy has not been emailed yet. If it does not arrive, contact Light Astra Support; the signed copy is always available here.',
  FAILED: 'The copy could not be emailed yet. If it does not arrive, contact Light Astra Support; the signed copy is always available here.',
  SUPPRESSED_TEST: 'This is a TEST record: no copy is emailed.'
};

/**
 * Wire [data-signed-copy="download"] and [data-signed-copy="view"] buttons inside root.
 * Optional data-agreement-id on the button picks an earlier agreement; default is the current one.
 */
export function bindSignedCopy(root) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-signed-copy]');
    if (!button || button.disabled) return;
    event.preventDefault();
    const mode = button.dataset.signedCopy;
    // A new tab has to be opened during the click itself, before the document arrives.
    const tab = mode === 'view' ? window.open('', '_blank') : null;
    const label = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const copy = await lightAstraService.getSignedCopy(button.dataset.agreementId || undefined);
      const note = root.querySelector('[data-copy-email-note]');
      if (note && EMAIL_NOTES[copy.emailStatus]) {
        note.textContent = EMAIL_NOTES[copy.emailStatus];
        note.dataset.copyEmailNote = copy.emailStatus;
      }
      const url = URL.createObjectURL(copy.blob);
      if (tab) {
        tab.location.href = url;          // kept for as long as this page is open, so the PDF tab can be reloaded
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = copy.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast(mode === 'view' ? 'Your browser blocked the new tab, so the signed copy was downloaded instead.' : 'Signed copy downloaded.');
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (err) {
      if (tab) tab.close();
      toastError(err && err.message ? err.message : 'The signed copy is temporarily unavailable. Please try again in a moment.');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = label;
    }
  });
}
