/* ==========================================================================
   Photo manager (vehicle editor)
   --------------------------------------------------------------------------
   Holds the editor's photo list in memory until the vehicle is saved:
     • add: drag & drop / Choose Photos (multi-select, iPhone library/camera)
     • per-photo processing state + batch progress; bad files never crash
     • reorder: drag on desktop, ← → buttons everywhere (keyboard/touch)
     • cover (★), rotate, replace, view full size, remove (with Undo)
   The page saves via photoService.savePhotos(vehicle, manager.getItems()).
   ========================================================================== */
import { PHOTO_RULES } from '../config.js';
import { html, setHtml, qs, announce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatBytes } from '../utils/format.js';
import { photoService } from '../services/photo-service.js';
import { billingService, UPLOADS_PAUSED_MESSAGE } from '../services/billing-service.js';
import { openMenu } from './menu.js';
import { openLightbox } from './lightbox.js';
import { toast, toastError } from './toast.js';

let instanceCount = 0;

export function createPhotoManager(root, { onChange = () => {} } = {}) {
  const uid = `pm${++instanceCount}`;
  let items = [];
  let initialSignature = '';
  let batch = { total: 0, done: 0 };
  let dragKey = null;
  let replaceKey = null;
  const ownedUrls = new Set();
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  setHtml(root, html`
    <div class="photo-manager">
      <div class="dropzone" data-dropzone>
        <span class="dropzone__icon">${icon('upload')}</span>
        <p class="dropzone__title"><span class="dropzone__drag">Drag photos here, or choose them from your computer</span><span class="dropzone__tap">Add photos from your library or camera</span></p>
        <button type="button" class="btn btn--primary btn--lg dropzone__btn" data-choose>${icon('camera')}Choose Photos</button>
        <input class="visually-hidden" type="file" id="${uid}-input" data-photo-input multiple accept="image/*,.heic,.heif" tabindex="-1" aria-label="Choose vehicle photos">
        <p class="dropzone__hint">JPEG, PNG, WebP or HEIC · up to ${formatBytes(PHOTO_RULES.maxBytes)} each · ${PHOTO_RULES.recommendedMin}–${PHOTO_RULES.recommendedMax} photos recommended</p>
      </div>
      <input class="visually-hidden" type="file" data-replace-input accept="image/*,.heic,.heif" tabindex="-1" aria-hidden="true">
      <div class="photo-progress" data-progress hidden>
        <div class="photo-progress__row"><span data-progress-text>Preparing photos…</span><span data-progress-count></span></div>
        <div class="progress" role="progressbar" aria-label="Photo processing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="progress__bar" data-progress-bar></span></div>
      </div>
      <div class="photo-summary" data-summary hidden></div>
      <ol class="photo-grid" data-grid aria-label="Vehicle photos in display order"></ol>
    </div>`);

  const input = qs('[data-photo-input]', root);
  const replaceInput = qs('[data-replace-input]', root);
  const dropzone = qs('[data-dropzone]', root);
  const grid = qs('[data-grid]', root);
  const summaryEl = qs('[data-summary]', root);
  const progressEl = qs('[data-progress]', root);

  // Managed service inactive: no new photo files can be stored (the server refuses them too).
  let uploadsPaused = false;
  billingService.publishingBlocked({ fresh: true }).then((paused) => {
    if (!paused) return;
    uploadsPaused = true;
    qs('[data-choose]', root).disabled = true;
    dropzone.insertAdjacentHTML('beforeend', String(html`<p class="notice notice--warn" data-uploads-paused>${icon('lock')}<span>${UPLOADS_PAUSED_MESSAGE} Existing photos are safe.</span></p>`));
  }).catch(() => {});

  /* ---------------- state helpers ---------------- */
  const usable = () => items.filter((i) => i.status === 'ready');
  const find = (key) => items.find((i) => i.id === key);
  const positionOf = (item) => usable().indexOf(item) + 1;
  const signature = () => usable().map((i) => `${i.id}:${i.isCover ? 1 : 0}:${i.rotation}`).join('|');

  function ensureCover() {
    const ready = usable();
    if (ready.length && !ready.some((i) => i.isCover)) ready[0].isCover = true;
    if (!ready.length) items.forEach((i) => { i.isCover = false; });
  }

  function makeUrl(blob) {
    const url = URL.createObjectURL(blob);
    ownedUrls.add(url);
    return url;
  }

  function dropUrl(url) {
    if (url && ownedUrls.has(url)) {
      URL.revokeObjectURL(url);
      ownedUrls.delete(url);
    }
  }

  function changed() {
    ensureCover();
    render();
    onChange();
  }

  /* ---------------- rendering ---------------- */
  function tile(item) {
    const pos = positionOf(item);
    const total = usable().length;
    if (item.status === 'processing') {
      return html`
        <li class="photo-tile is-processing" data-key="${item.id}">
          <div class="photo-tile__media"><span class="spinner" aria-hidden="true"></span><span class="photo-tile__state">Processing…</span></div>
          <p class="photo-tile__name">${item.fileName}</p>
        </li>`;
    }
    if (item.status === 'error') {
      return html`
        <li class="photo-tile is-error" data-key="${item.id}">
          <div class="photo-tile__media">${icon('alert')}<p class="photo-tile__error">${item.error}</p></div>
          <div class="photo-tile__actions photo-tile__actions--single">
            <button type="button" class="tile-btn" data-act="dismiss" aria-label="Dismiss error for ${item.fileName}">${icon('x')}<span>Dismiss</span></button>
          </div>
        </li>`;
    }
    const label = `photo ${pos} of ${total}`;
    return html`
      <li class="photo-tile${item.isCover ? ' is-cover' : ''}${item.busy ? ' is-busy' : ''}" data-key="${item.id}" ${finePointer ? html`draggable="true"` : ''}>
        <div class="photo-tile__media">
          ${item.thumbUrl
            ? html`<img src="${item.thumbUrl}" alt="Vehicle ${label}${item.isCover ? ' (cover)' : ''}" loading="lazy" decoding="async">`
            : html`<span class="photo-tile__missing">${icon('image')}<span>Photo unavailable</span></span>`}
          <span class="photo-tile__pos" aria-hidden="true">${pos}</span>
          ${item.isCover ? html`<span class="photo-tile__cover">${icon('star')}Cover</span>` : ''}
          ${item.isNew ? html`<span class="photo-tile__new">New</span>` : ''}
          <button type="button" class="photo-tile__view" data-act="view" aria-label="View ${label} full size">${icon('expand')}</button>
          ${finePointer ? html`<span class="photo-tile__grip" aria-hidden="true">${icon('grip')}</span>` : ''}
          ${item.busy ? html`<span class="spinner spinner--overlay" aria-hidden="true"></span>` : ''}
        </div>
        <div class="photo-tile__actions">
          <button type="button" class="tile-btn" data-act="left" aria-label="Move ${label} earlier" ${pos === 1 ? html`disabled` : ''}>${icon('chevronLeft')}</button>
          <button type="button" class="tile-btn tile-btn--cover" data-act="cover" aria-pressed="${item.isCover ? 'true' : 'false'}" aria-label="${item.isCover ? `Photo ${pos} is the cover photo` : `Set ${label} as cover photo`}">${icon('star')}</button>
          <button type="button" class="tile-btn" data-act="right" aria-label="Move ${label} later" ${pos === total ? html`disabled` : ''}>${icon('chevronRight')}</button>
          <button type="button" class="tile-btn" data-act="more" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${label}">${icon('more')}</button>
        </div>
      </li>`;
  }

  function renderSummary() {
    const ready = usable();
    const errors = items.filter((i) => i.status === 'error').length;
    if (!items.length) {
      summaryEl.hidden = true;
      return;
    }
    const cover = ready.findIndex((i) => i.isCover) + 1;
    summaryEl.hidden = false;
    setHtml(summaryEl, html`
      <p><strong>${ready.length} photo${ready.length === 1 ? '' : 's'}</strong>${cover ? html` · Cover: photo ${cover}` : ''}${errors ? html` · <span class="text-danger">${errors} couldn’t be added</span>` : ''}</p>
      <p class="photo-summary__hint">${ready.length && ready.length < PHOTO_RULES.recommendedMin
        ? `Most listings use ${PHOTO_RULES.recommendedMin}–${PHOTO_RULES.recommendedMax} photos. `
        : ''}${finePointer ? 'Drag photos to reorder, or use the arrow buttons.' : 'Use the arrow buttons to reorder.'} The order here becomes the public gallery order.</p>`);
  }

  function render() {
    setHtml(grid, html`${items.map(tile)}`);
    grid.hidden = !items.length;
    dropzone.classList.toggle('dropzone--compact', items.length > 0);
    renderSummary();
  }

  function renderProgress() {
    const active = batch.total > 0 && batch.done < batch.total;
    progressEl.hidden = !active;
    if (!active) return;
    const pct = Math.round((batch.done / batch.total) * 100);
    qs('[data-progress-text]', progressEl).textContent = `Processing photo ${Math.min(batch.done + 1, batch.total)} of ${batch.total}…`;
    qs('[data-progress-count]', progressEl).textContent = `${pct}%`;
    qs('[data-progress-bar]', progressEl).style.width = `${pct}%`;
    qs('.progress', progressEl).setAttribute('aria-valuenow', String(pct));
  }

  /* ---------------- adding ---------------- */
  async function addFiles(fileList, { replacing = null } = {}) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (uploadsPaused) { toastError(UPLOADS_PAUSED_MESSAGE); return; }
    const pending = items.filter((i) => i.status === 'processing').length;
    const room = replacing ? 1 : PHOTO_RULES.maxPerVehicle - usable().length - pending;
    const accepted = files.slice(0, Math.max(0, room));
    if (files.length > accepted.length) {
      toast(`Up to ${PHOTO_RULES.maxPerVehicle} photos per vehicle — ${files.length - accepted.length} weren’t added.`, { tone: 'warning' });
    }
    if (!accepted.length) return;

    const created = accepted.map((file) => ({
      id: photoService.newPhotoId(), isNew: true, status: 'processing', fileName: file.name || 'photo',
      isCover: false, rotation: 0, file
    }));
    if (replacing) {
      const index = items.indexOf(replacing);
      created[0].replacesId = replacing.isNew ? replacing.replacesId || null : replacing.id;
      created[0].isCover = replacing.isCover;
      items.splice(index, 1, created[0]);
      dropUrl(replacing.thumbUrl);
      dropUrl(replacing.displayUrl);
    } else {
      items.push(...created);
    }
    batch = { total: batch.done < batch.total ? batch.total + created.length : created.length, done: batch.done < batch.total ? batch.done : 0 };
    render();
    renderProgress();
    onChange();

    let failures = 0;
    for (const item of created) {
      try {
        const draft = await photoService.processFile(item.file);
        item.draft = draft;
        item.thumbUrl = makeUrl(draft.blobs.thumb);
        item.displayUrl = makeUrl(draft.blobs.display);
        item.status = 'ready';
      } catch (err) {
        item.status = 'error';
        item.error = err && err.message ? err.message : `“${item.fileName}” couldn’t be added.`;
        failures += 1;
      }
      delete item.file;
      batch.done += 1;
      renderProgress();
      ensureCover();
      render();
    }
    onChange();
    const added = created.length - failures;
    if (replacing && added) announce('Photo replaced.');
    else if (added) announce(`${added} photo${added === 1 ? '' : 's'} added. ${usable().length} total.`);
    if (failures) {
      toastError(failures === 1 ? created.find((i) => i.status === 'error').error : `${failures} photos couldn’t be added. See the photo list for details.`);
    }
  }

  /* ---------------- actions ---------------- */
  function move(item, delta) {
    const ready = usable();
    const from = ready.indexOf(item);
    const to = Math.max(0, Math.min(ready.length - 1, from + delta));
    if (from === to) return;
    moveTo(item, ready[to], delta > 0 ? 'after' : 'before');
    announce(`Photo moved to position ${to + 1} of ${ready.length}.`);
    focusTile(item.id, delta < 0 && to === 0 ? 'right' : delta > 0 && to === ready.length - 1 ? 'left' : delta < 0 ? 'left' : 'right');
  }

  function moveTo(item, target, where) {
    if (item === target) return;
    items.splice(items.indexOf(item), 1);
    const targetIndex = items.indexOf(target);
    items.splice(where === 'after' ? targetIndex + 1 : targetIndex, 0, item);
    changed();
  }

  function setCover(item) {
    items.forEach((i) => { i.isCover = i === item; });
    changed();
    announce(`Photo ${positionOf(item)} is now the cover photo.`);
    focusTile(item.id, 'cover');
  }

  function remove(item) {
    const index = items.indexOf(item);
    const wasCover = item.isCover;
    items.splice(index, 1);
    item.isCover = false;
    changed();
    announce('Photo removed.');
    toast('Photo removed.', {
      tone: 'info',
      action: {
        label: 'Undo',
        onClick: () => {
          items.splice(Math.min(index, items.length), 0, item);
          if (wasCover) items.forEach((i) => { i.isCover = i === item; });
          changed();
          announce('Photo restored.');
        }
      }
    });
  }

  async function rotate(item) {
    const rotation = (item.rotation + 90) % 360;
    item.busy = true;
    render();
    try {
      const original = item.isNew ? item.draft.blobs.original : await photoService.getBlob(item.photo, 'original');
      if (!original) throw new Error('The original photo is missing, so it can’t be rotated.');
      const copies = await photoService.rotateCopies(original, rotation);
      dropUrl(item.thumbUrl);
      dropUrl(item.displayUrl);
      item.thumbUrl = makeUrl(copies.thumb);
      item.displayUrl = makeUrl(copies.display);
      item.rotation = rotation;
      if (item.isNew) {
        item.draft = { ...item.draft, rotation, blobs: { ...item.draft.blobs, display: copies.display, thumb: copies.thumb } };
      } else {
        item.draft = { blobs: { display: copies.display, thumb: copies.thumb } };
        item.rotationChanged = rotation !== item.photo.rotation;
      }
      announce('Photo rotated.');
    } catch (err) {
      toastError(err.message || 'That photo couldn’t be rotated.');
    } finally {
      item.busy = false;
      changed();
      focusTile(item.id, 'more');
    }
  }

  async function view(item) {
    const ready = usable();
    const entries = await Promise.all(ready.map(async (i, n) => {
      if (!i.displayUrl && i.photo) i.displayUrl = await photoService.getUrl(i.photo, 'display');
      return { url: i.displayUrl || i.thumbUrl, alt: `Vehicle photo ${n + 1}`, caption: `${i.isCover ? 'Cover · ' : ''}${i.fileName}` };
    }));
    openLightbox(entries, ready.indexOf(item));
  }

  function focusTile(key, act) {
    const el = grid.querySelector(`[data-key="${key}"] [data-act="${act}"]:not([disabled])`)
      || grid.querySelector(`[data-key="${key}"] [data-act="more"]`);
    if (el) el.focus();
  }

  function openTileMenu(item, trigger) {
    const ready = usable();
    const pos = ready.indexOf(item);
    openMenu(trigger, [
      { label: 'View full size', icon: 'expand', onSelect: () => view(item) },
      { label: item.isCover ? 'This is the cover photo' : 'Set as cover photo', icon: 'star', disabled: item.isCover, onSelect: () => setCover(item) },
      { label: 'Move to first', icon: 'chevronLeft', disabled: pos === 0, onSelect: () => { moveTo(item, ready[0], 'before'); announce('Photo moved to position 1.'); } },
      { label: 'Rotate right', icon: 'rotate', onSelect: () => rotate(item) },
      { label: 'Replace photo…', icon: 'replace', onSelect: () => { replaceKey = item.id; replaceInput.value = ''; replaceInput.click(); } },
      { separator: true },
      { label: 'Remove photo', icon: 'trash', tone: 'danger', onSelect: () => remove(item) }
    ], { label: `Photo ${pos + 1} actions` });
  }

  /* ---------------- events ---------------- */
  qs('[data-choose]', root).addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });

  replaceInput.addEventListener('change', () => {
    const target = find(replaceKey);
    if (target && replaceInput.files.length) addFiles([replaceInput.files[0]], { replacing: target });
    replaceKey = null;
    replaceInput.value = '';
  });

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button || button.disabled) return;
    const item = find(button.closest('[data-key]').dataset.key);
    if (!item) return;
    const act = button.dataset.act;
    if (act === 'left') move(item, -1);
    else if (act === 'right') move(item, 1);
    else if (act === 'cover') { if (!item.isCover) setCover(item); }
    else if (act === 'view') view(item);
    else if (act === 'more') openTileMenu(item, button);
    else if (act === 'dismiss') { items.splice(items.indexOf(item), 1); changed(); }
  });

  // File drops anywhere on the manager; tile drags reorder.
  const hasFiles = (event) => Array.from(event.dataTransfer ? event.dataTransfer.types : []).includes('Files');
  root.addEventListener('dragover', (event) => {
    if (hasFiles(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dropzone.classList.add('is-dragover');
    }
  });
  root.addEventListener('dragleave', (event) => {
    if (!root.contains(event.relatedTarget)) dropzone.classList.remove('is-dragover');
  });
  root.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    addFiles(event.dataTransfer.files);
  });

  grid.addEventListener('dragstart', (event) => {
    const li = event.target.closest('[data-key]');
    if (!li) return;
    dragKey = li.dataset.key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragKey);
    li.classList.add('is-dragging');
  });
  grid.addEventListener('dragover', (event) => {
    if (!dragKey) return;
    const li = event.target.closest('[data-key]');
    if (!li || li.dataset.key === dragKey) return;
    event.preventDefault();
    const rect = li.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    grid.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  grid.addEventListener('drop', (event) => {
    if (!dragKey) return;
    event.preventDefault();
    const li = event.target.closest('[data-key]');
    const item = find(dragKey);
    const target = li ? find(li.dataset.key) : null;
    if (item && target && target.status === 'ready') {
      moveTo(item, target, li.classList.contains('drop-after') ? 'after' : 'before');
      announce(`Photo moved to position ${positionOf(item)}.`);
    }
  });
  grid.addEventListener('dragend', () => {
    dragKey = null;
    grid.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach((el) => el.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });

  render();

  /* ---------------- public API ---------------- */
  return {
    async load(photos) {
      items = await Promise.all(photos.map(async (photo) => ({
        id: photo.id,
        isNew: false,
        status: 'ready',
        fileName: photo.fileName || 'photo',
        isCover: photo.isCover,
        rotation: photo.rotation || 0,
        photo,
        thumbUrl: await photoService.getUrl(photo, 'thumb'),
        displayUrl: null
      })));
      ensureCover();
      initialSignature = signature();
      render();
    },
    addFiles,
    isBusy: () => items.some((i) => i.status === 'processing' || i.busy),
    isDirty: () => signature() !== initialSignature || items.some((i) => i.rotationChanged),
    markClean() { initialSignature = signature(); items.forEach((i) => { i.rotationChanged = false; }); },
    count: () => usable().length,
    /** Items in display order, for photoService.savePhotos(). Errors are left out. */
    getItems: () => usable().map((i) => ({
      id: i.id, isNew: i.isNew, isCover: i.isCover, rotation: i.rotation,
      rotationChanged: Boolean(i.rotationChanged), replacesId: i.replacesId || null, draft: i.draft || null
    })),
    /** Minimal shape for publish-readiness checks. */
    readinessPhotos: () => usable().map((i) => ({ isCover: i.isCover })),
    /** Photos for the public preview (display-size URLs, in order). */
    async previewPhotos() {
      const ready = usable();
      return Promise.all(ready.map(async (i, index) => {
        if (!i.displayUrl && i.photo) i.displayUrl = await photoService.getUrl(i.photo, 'display');
        return { id: i.id, isCover: i.isCover, sortOrder: index, url: i.displayUrl || i.thumbUrl };
      }));
    },
    focus() { qs('.dropzone__btn', root).focus(); },
    destroy() {
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedUrls.clear();
    }
  };
}
