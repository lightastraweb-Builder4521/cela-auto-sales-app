/* ==========================================================================
   Vehicle action flows — shared by Inventory, Vehicle Details, Sold, Archived.
   Each flow: (confirm if needed) → service call → toast (+ Undo when safe)
   → onDone(updatedVehicle | null) so the page can refresh.
   ========================================================================== */
import { html } from '../utils/dom.js';
import { RULES, DEALERSHIP } from '../config.js';
import { icon } from '../utils/icons.js';
import { parseMoney, formatCurrency, zonedTimeToUtc, utcToZonedInputs, formatZonedDateTime } from '../utils/format.js';
import { fullTitle, STATUS } from '../models/vehicle.js';
import { vehicleService, canPerform, NotReadyError, ValidationError, DELETE_FAILED } from '../services/vehicle-service.js';
import { authService } from '../services/auth-service.js';
import { confirmDialog, formDialog, typedConfirmDialog, readinessDialog } from './dialogs.js';
import { toast, toastError, flash } from './toast.js';
import { refreshNavCounts } from './layout.js';

const editHref = (v) => `edit-vehicle.html?id=${encodeURIComponent(v.id)}`;

/** Actions available for a vehicle, in display order. `primary` ones get buttons; others go in "More". */
export function availableActions(vehicle) {
  const can = (action) => canPerform(action, vehicle);
  return [
    { id: 'edit', label: 'Edit', icon: 'edit', show: vehicle.status !== STATUS.ARCHIVED },
    { id: 'publish', label: 'Publish Now', icon: 'globe', show: can('publish') },
    { id: 'schedule', label: 'Schedule Publication', icon: 'calendar', show: can('schedule') },
    { id: 'changeSchedule', label: 'Change Schedule', icon: 'calendar', show: can('changeSchedule') },
    { id: 'cancelSchedule', label: 'Cancel Schedule', icon: 'x', show: can('cancelSchedule') },
    { id: 'unpublish', label: 'Unpublish', icon: 'eyeOff', show: can('unpublish') },
    { id: 'available', label: 'Mark Available', icon: 'checkCircle', show: can('available') },
    { id: 'pending', label: 'Mark Pending', icon: 'pending', show: can('pending') },
    { id: 'sold', label: 'Mark Sold', icon: 'sold', show: can('sold') },
    { id: 'restoreSold', label: 'Restore Vehicle', icon: 'restore', show: can('restoreSold') },
    { id: 'restoreArchived', label: 'Restore', icon: 'restore', show: can('restoreArchived') },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', show: vehicle.status !== STATUS.ARCHIVED },
    { id: 'archive', label: 'Archive', icon: 'archive', show: can('archive') },
    { id: 'delete', label: 'Delete permanently', icon: 'trash', tone: 'danger', show: can('delete') && authService.can('vehicle.delete') }
  ].filter((a) => a.show);
}

function handleError(err) {
  if (err instanceof ValidationError) {
    toastError(Object.values(err.errors)[0] || err.message);
  } else {
    toastError(err && err.message ? err.message : 'Something went wrong. Please try again.');
  }
}

async function publish(vehicle, onDone) {
  try {
    const updated = await vehicleService.publishVehicle(vehicle.id);
    toast('Vehicle published.');
    onDone(updated);
  } catch (err) {
    if (err instanceof NotReadyError) {
      const choice = await readinessDialog({ readiness: err.readiness });
      if (choice === 'fix') window.location.href = `${editHref(vehicle)}&publish=1`;
      return;
    }
    handleError(err);
  }
}

/** Schedule Publication / Change Schedule — date + time in dealership time, stored as UTC. */
async function schedule(vehicle, onDone) {
  const tz = DEALERSHIP.timeZone;
  const changing = vehicle.publishScheduled;
  const today = utcToZonedInputs(Date.now(), tz).date;
  const initial = changing ? utcToZonedInputs(vehicle.publishAt, tz) : { date: utcToZonedInputs(Date.now() + 86400000, tz).date, time: '09:00' };
  const instant = (form) => zonedTimeToUtc(form.get('publishDate'), form.get('publishTime'), tz);
  const data = await formDialog({
    title: changing ? 'Change the scheduled publication' : 'Schedule publication',
    intro: html`<strong>${fullTitle(vehicle)}</strong>${vehicle.stockNumber ? ` · Stock #${vehicle.stockNumber}` : ''}`,
    confirmLabel: changing ? 'Save New Time' : 'Schedule Publication',
    confirmIcon: 'calendar',
    initialFocus: '#publish-date',
    fields: html`
      <div class="field-pair">
        <div class="field">
          <label class="field__label" for="publish-date">Publication date</label>
          <input class="input" type="date" id="publish-date" name="publishDate" value="${initial.date}" min="${today}" required aria-describedby="publish-when-error">
        </div>
        <div class="field">
          <label class="field__label" for="publish-time">Publication time</label>
          <input class="input" type="time" id="publish-time" name="publishTime" value="${initial.time}" step="60" required>
        </div>
      </div>
      <p class="field-error" id="publish-when-error" data-for="publishDate" hidden></p>
      ${changing ? html`<p class="modal__detail" data-current-schedule>Currently scheduled for ${formatZonedDateTime(vehicle.publishAt, tz)}. Saving replaces it — a vehicle has one schedule.</p>` : ''}
      <p class="modal__detail">${icon('clock')} Dealership time (${DEALERSHIP.timeZoneLabel}, ${DEALERSHIP.city}). The vehicle stays private until then. It goes on the public website within about a minute of that time, after its details, photos and the managed service are checked again.</p>`,
    validate: (form) => {
      const r = instant(form);
      if (r.error === 'invalid') return { publishDate: 'Enter a valid date and time.' };
      if (r.error === 'nonexistent') return { publishDate: 'That time doesn’t exist on that date (clocks move forward an hour). Choose another time.' };
      const at = new Date(r.iso).getTime();
      if (at <= Date.now() + 2 * 60 * 1000) return { publishDate: 'Choose a date and time in the future.' };
      if (at > Date.now() + 365 * 86400000) return { publishDate: 'Choose a date within the next year.' };
      return {};
    }
  });
  if (!data) return;
  try {
    const updated = await vehicleService.schedulePublication(vehicle.id, instant(data).iso);
    toast(`${changing ? 'Schedule changed' : 'Publication scheduled'}: ${formatZonedDateTime(updated.publishAt, tz)}.`);
    onDone(updated);
  } catch (err) {
    if (err instanceof NotReadyError) {
      const choice = await readinessDialog({ readiness: err.readiness });
      if (choice === 'fix') window.location.href = editHref(vehicle);
      return;
    }
    handleError(err);
  }
}

async function cancelSchedule(vehicle, onDone) {
  const ok = await confirmDialog({
    title: 'Cancel the scheduled publication?',
    message: `${fullTitle(vehicle)} will not be published on ${formatZonedDateTime(vehicle.publishAt, DEALERSHIP.timeZone)}.`,
    detail: 'It stays private with all its details and photos. You can Publish Now or schedule it again anytime.',
    confirmLabel: 'Cancel Schedule',
    cancelLabel: 'Keep Schedule'
  });
  if (!ok) return;
  const updated = await vehicleService.cancelSchedule(vehicle.id);
  toast('Scheduled publication canceled. The vehicle stays private.');
  onDone(updated);
}

async function unpublish(vehicle, onDone) {
  const snapshot = { ...vehicle };
  const updated = await vehicleService.unpublishVehicle(vehicle.id);
  toast('Vehicle unpublished.', {
    tone: 'info',
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          onDone(await vehicleService.revertState(vehicle.id, snapshot, { action: 'vehicle.published', summary: 'Unpublish undone' }));
          toast('Vehicle published again.');
        } catch (err) { handleError(err); }
      }
    }
  });
  onDone(updated);
}

async function simpleStatus(vehicle, onDone, { method, title, message, confirmLabel, done }) {
  const ok = await confirmDialog({ title, message, confirmLabel });
  if (!ok) return;
  const updated = await vehicleService[method](vehicle.id);
  toast(done);
  onDone(updated);
}

async function markSold(vehicle, onDone) {
  const listPrice = vehicle.salePrice || vehicle.price;
  const data = await formDialog({
    title: 'Mark this vehicle as Sold?',
    intro: html`<strong>${fullTitle(vehicle)}</strong>${vehicle.stockNumber ? ` · Stock #${vehicle.stockNumber}` : ''}`,
    confirmLabel: 'Confirm Sold',
    confirmIcon: 'sold',
    initialFocus: '#sold-price',
    fields: html`
      <div class="field">
        <label class="field__label" for="sold-price">Actual sold price <span class="field__optional">(optional · internal)</span></label>
        <div class="input-affix"><span class="input-affix__text" aria-hidden="true">$</span>
          <input class="input" id="sold-price" name="soldPrice" inputmode="decimal" autocomplete="off" placeholder="${listPrice ? formatCurrency(listPrice).replace('$', '') : ''}" aria-describedby="sold-price-hint">
        </div>
        <p class="field__hint" id="sold-price-hint">Never shown to customers.</p>
        <p class="field-error" data-for="soldPrice" hidden></p>
      </div>
      <div class="field">
        <label class="field__label" for="sold-note">Internal note <span class="field__optional">(optional)</span></label>
        <textarea class="textarea textarea--short" id="sold-note" name="note" rows="2" maxlength="2000"></textarea>
      </div>
      <p class="modal__detail">${icon('info')} It leaves the public website immediately and stays in Sold History for ${RULES.soldRetentionDays} days. After that, the vehicle and its photos are permanently deleted, unless you restore it first. The sold time is recorded automatically.</p>`,
    validate: (form) => {
      const errors = {};
      const price = parseMoney(form.get('soldPrice'));
      if (Number.isNaN(price) || (price !== null && price < 0)) errors.soldPrice = 'Enter a dollar amount, like 15,500.';
      return errors;
    }
  });
  if (!data) return;
  const updated = await vehicleService.markSold(vehicle.id, {
    soldPrice: parseMoney(data.get('soldPrice')),
    note: data.get('note') || ''
  });
  toast('Vehicle marked Sold.');
  onDone(updated);
}

async function archive(vehicle, onDone) {
  const ok = await confirmDialog({
    title: 'Archive this vehicle?',
    message: `${fullTitle(vehicle)} will be hidden from the public site and your active inventory.`,
    detail: 'Nothing is deleted. You can restore it anytime from Archived.',
    confirmLabel: 'Archive',
    confirmIcon: 'archive'
  });
  if (!ok) return;
  const snapshot = { ...vehicle };
  const updated = await vehicleService.archiveVehicle(vehicle.id);
  toast('Vehicle archived.', {
    tone: 'info',
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          onDone(await vehicleService.revertState(vehicle.id, snapshot, { action: 'vehicle.restored', summary: 'Archive undone' }));
          toast('Archive undone.');
        } catch (err) { handleError(err); }
      }
    }
  });
  onDone(updated);
}

async function removePermanently(vehicle, onDone) {
  const ok = await typedConfirmDialog({
    title: 'Delete this vehicle permanently?',
    message: `${fullTitle(vehicle)}${vehicle.stockNumber ? ` (Stock #${vehicle.stockNumber})` : ''} and all of its photos will be erased from this system.`,
    detail: 'This cannot be undone. The activity history entry is kept.'
  });
  if (!ok) return;
  await vehicleService.deleteVehicle(vehicle.id, { confirmation: 'DELETE PERMANENTLY' });
  toast('Vehicle deleted permanently.');
  onDone(null);
}

/**
 * Delete Forever (Sold History, Admins): permanently remove a SOLD vehicle and its photos now, instead of at the
 * end of its retention period. hooks.busy(true|false) lets the page disable that vehicle's buttons meanwhile.
 */
async function deleteForever(vehicle, onDone, hooks = {}) {
  const ok = await typedConfirmDialog({
    title: 'Permanently Delete Vehicle?',
    message: html`<strong>${fullTitle(vehicle)}</strong>${vehicle.stockNumber ? html`<br>Stock #${vehicle.stockNumber}` : ''}`,
    detail: 'This will permanently delete this vehicle and its associated photos from the Cela system. This action cannot be undone.',
    phrase: 'DELETE',
    confirmLabel: 'Delete Forever'
  });
  if (!ok) return;
  if (hooks.busy) hooks.busy(true);
  try {
    await vehicleService.deleteSoldForever(vehicle.id, { confirmation: 'DELETE' });
  } catch (err) {
    if (hooks.busy) hooks.busy(false);
    toastError(err && err.message ? err.message : DELETE_FAILED);
    onDone(vehicle);      // show what the server holds now (for example a vehicle that was restored meanwhile)
    return;
  }
  toast('Vehicle permanently deleted. Its vehicle data and associated photos were removed.');
  onDone(null);
}

async function duplicate(vehicle) {
  const copy = await vehicleService.duplicateVehicle(vehicle.id);
  flash('Duplicate created. Add its VIN, stock number, price, mileage and photos.');
  window.location.href = editHref(copy);
}

/** Run an action by id. onDone(vehicle|null) is called after a successful change. */
export async function runVehicleAction(actionId, vehicle, onDone = () => {}, hooks = {}) {
  const done = (updated) => { refreshNavCounts(); onDone(updated); };
  try {
    switch (actionId) {
      case 'edit': window.location.href = editHref(vehicle); return;
      case 'view': window.location.href = `vehicle.html?id=${encodeURIComponent(vehicle.id)}`; return;
      case 'publish': await publish(vehicle, done); return;
      case 'schedule':
      case 'changeSchedule': await schedule(vehicle, done); return;
      case 'cancelSchedule': await cancelSchedule(vehicle, done); return;
      case 'unpublish': await unpublish(vehicle, done); return;
      case 'available': await simpleStatus(vehicle, done, {
        method: 'markAvailable', title: 'Mark this vehicle as Available?',
        message: 'It will show as available for sale.', confirmLabel: 'Mark Available', done: 'Vehicle marked Available.'
      }); return;
      case 'pending': await simpleStatus(vehicle, done, {
        method: 'markPending', title: 'Mark this vehicle as Pending?',
        message: 'Use Pending when a sale is in progress. Published vehicles show a “Sale Pending” label to customers.',
        confirmLabel: 'Mark Pending', done: 'Vehicle marked Pending.'
      }); return;
      case 'sold': await markSold(vehicle, done); return;
      case 'restoreSold': await simpleStatus(vehicle, done, {
        method: 'restoreSold', title: 'Restore this vehicle?',
        message: 'The planned permanent deletion is canceled. The vehicle returns to Inventory as a Draft with all its photos and details. It stays off the public website until you choose Publish Now or schedule publication.',
        confirmLabel: 'Restore Vehicle', done: 'Vehicle restored as a Draft. Its deletion is canceled.'
      }); return;
      case 'restoreArchived': await simpleStatus(vehicle, done, {
        method: 'restoreVehicle', title: 'Restore this vehicle?',
        message: 'It returns to the status it had before archiving, unpublished. Publish it again when it’s ready.',
        confirmLabel: 'Restore', done: 'Vehicle restored (unpublished).'
      }); return;
      case 'archive': await archive(vehicle, done); return;
      case 'delete': await removePermanently(vehicle, done); return;
      case 'deleteForever': await deleteForever(vehicle, done, hooks); return;
      case 'duplicate': await duplicate(vehicle); return;
      default: throw new Error(`Unknown action: ${actionId}`);
    }
  } catch (err) {
    handleError(err);
  }
}
