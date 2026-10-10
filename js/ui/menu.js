/* Floating action menu (menu-button pattern).
   openMenu(triggerButton, [{ label, icon, onSelect, tone, disabled, hint } | { separator: true }])
   Keyboard: ↑/↓, Home/End, Enter/Space, Escape (returns focus), Tab closes. */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

let active = null;

function close(returnFocus = false) {
  if (!active) return;
  const { menu, trigger, cleanup } = active;
  active = null;
  cleanup();
  menu.remove();
  trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger.focus();
}

function position(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const margin = 8;
  let left = rect.right - width;
  if (left < margin) left = Math.min(rect.left, window.innerWidth - width - margin);
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - margin && rect.top - height - 6 > margin) top = rect.top - height - 6;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(Math.max(margin, top))}px`;
}

export function openMenu(trigger, items, { label = 'Actions' } = {}) {
  const reopening = active && active.trigger === trigger;
  close();
  if (reopening) return;

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.innerHTML = String(html`${items.map((item, index) => (item.separator
    ? html`<div class="menu__separator" role="separator"></div>`
    : html`<button type="button" role="menuitem" class="menu__item${item.tone ? ` menu__item--${item.tone}` : ''}" data-index="${index}" ${item.disabled ? html`aria-disabled="true"` : ''}>
        ${item.icon ? icon(item.icon) : ''}<span class="menu__label">${item.label}${item.hint ? html`<small>${item.hint}</small>` : ''}</span>
      </button>`))}`);
  document.body.appendChild(menu);
  position(menu, trigger);
  trigger.setAttribute('aria-expanded', 'true');

  const buttons = Array.from(menu.querySelectorAll('.menu__item'));
  const focusAt = (i) => buttons[(i + buttons.length) % buttons.length].focus();

  menu.addEventListener('click', (event) => {
    const btn = event.target.closest('.menu__item');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    const item = items[Number(btn.dataset.index)];
    close(true);
    item.onSelect();
  });

  menu.addEventListener('keydown', (event) => {
    const i = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(i + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(i - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
    else if (event.key === 'End') { event.preventDefault(); focusAt(buttons.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') { close(false); }
  });

  const onDocPointer = (event) => {
    if (!menu.contains(event.target) && !trigger.contains(event.target)) close(false);
  };
  // Scroll events arrive a frame late (and iOS momentum scrolling keeps
  // firing them), so don't close on scroll: follow the button, and close
  // only once it has left the screen.
  const onViewportChange = () => {
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || !document.contains(trigger)) close(false);
    else position(menu, trigger);
  };
  document.addEventListener('pointerdown', onDocPointer, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);

  active = {
    menu,
    trigger,
    cleanup: () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    }
  };
  const firstEnabled = buttons.findIndex((b) => b.getAttribute('aria-disabled') !== 'true');
  focusAt(firstEnabled < 0 ? 0 : firstEnabled);
}

export const closeMenu = () => close(false);
