/* Full-size photo viewer. items: [{ url, alt, caption }] (url already resolved). */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

export function openLightbox(items, startIndex = 0) {
  const usable = items.filter((item) => item && item.url);
  if (!usable.length) return;
  let index = Math.min(Math.max(0, startIndex), usable.length - 1);
  const previousFocus = document.activeElement;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Photo viewer');
  dialog.innerHTML = String(html`
    <div class="lightbox__top">
      <p class="lightbox__counter" aria-live="polite"></p>
      <button type="button" class="icon-btn lightbox__close" aria-label="Close photo viewer">${icon('x')}</button>
    </div>
    <figure class="lightbox__stage">
      <img class="lightbox__img" alt="">
      <figcaption class="lightbox__caption"></figcaption>
    </figure>
    ${usable.length > 1 ? html`
      <button type="button" class="lightbox__nav lightbox__nav--prev" aria-label="Previous photo">${icon('chevronLeft')}</button>
      <button type="button" class="lightbox__nav lightbox__nav--next" aria-label="Next photo">${icon('chevronRight')}</button>` : ''}`);
  document.body.appendChild(dialog);

  const img = dialog.querySelector('.lightbox__img');
  const counter = dialog.querySelector('.lightbox__counter');
  const caption = dialog.querySelector('.lightbox__caption');

  const show = (i) => {
    index = (i + usable.length) % usable.length;
    img.src = usable[index].url;
    img.alt = usable[index].alt || `Photo ${index + 1}`;
    counter.textContent = `Photo ${index + 1} of ${usable.length}`;
    caption.textContent = usable[index].caption || '';
  };

  dialog.querySelector('.lightbox__close').addEventListener('click', () => dialog.close());
  const prev = dialog.querySelector('.lightbox__nav--prev');
  const next = dialog.querySelector('.lightbox__nav--next');
  if (prev) prev.addEventListener('click', () => show(index - 1));
  if (next) next.addEventListener('click', () => show(index + 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(index - 1);
    if (event.key === 'ArrowRight') show(index + 1);
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  let startX = null;
  dialog.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  }, { passive: true });

  dialog.addEventListener('close', () => {
    dialog.remove();
    document.body.classList.remove('is-locked');
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  });

  show(index);
  document.body.classList.add('is-locked');
  dialog.showModal();
  dialog.querySelector('.lightbox__close').focus();
}
