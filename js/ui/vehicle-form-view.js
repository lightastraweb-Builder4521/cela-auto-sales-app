/* Markup for the Add / Edit Vehicle editor (one template for both pages).
   Section order follows the on-the-lot iPhone workflow:
   basics → photos → price & mileage → specs → description → features → internal → publishing. */
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { RULES } from '../config.js';
import {
  BODY_STYLES, TRANSMISSIONS, DRIVETRAINS, FUEL_TYPES, COMMON_MAKES, COMMON_COLORS,
  STANDARD_FEATURES, STATUS
} from '../models/vehicle.js';
import { formatNumber } from '../utils/format.js';

export const SECTIONS = [
  ['basic', 'Basic information'],
  ['photos', 'Photos'],
  ['price', 'Price & mileage'],
  ['specs', 'Vehicle specs'],
  ['description', 'Description'],
  ['features', 'Features'],
  ['internal', 'Internal information'],
  ['publishing', 'Publishing']
];

const money = (value) => (value === null || value === undefined ? '' : formatNumber(value));
const intText = (value) => (value === null || value === undefined ? '' : String(value));

function field({ key, label, hint = '', optional = false, required = false, control, wide = false }) {
  return html`
    <div class="field${wide ? ' field--wide' : ''}" data-field="${key}">
      <label class="field__label" for="v-${key}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ''}${optional ? html` <span class="field__optional">(optional)</span>` : ''}</label>
      ${control}
      ${hint ? html`<p class="field__hint" id="v-${key}-hint">${hint}</p>` : ''}
      <p class="field-error" id="v-${key}-error" hidden></p>
    </div>`;
}

const describedBy = (key, hint) => `v-${key}-error${hint ? ` v-${key}-hint` : ''}`;

function textInput(key, value, { placeholder = '', list = '', inputmode = '', maxlength = 80, autocapitalize = '', hint = false, extra = '' } = {}) {
  return html`<input class="input" id="v-${key}" name="${key}" value="${value || ''}" placeholder="${placeholder}" autocomplete="off"
    maxlength="${maxlength}" ${list ? html`list="${list}"` : ''} ${inputmode ? html`inputmode="${inputmode}"` : ''}
    ${autocapitalize ? html`autocapitalize="${autocapitalize}"` : ''} aria-describedby="${describedBy(key, hint)}" ${extra}>`;
}

function moneyInput(key, value, placeholder = '') {
  return html`<div class="input-affix"><span class="input-affix__text" aria-hidden="true">$</span>
    <input class="input" id="v-${key}" name="${key}" value="${money(value)}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" data-money aria-describedby="v-${key}-error"></div>`;
}

function select(key, value, list, placeholder = 'Select…') {
  return html`<select class="select" id="v-${key}" name="${key}" aria-describedby="v-${key}-error">
    <option value="">${placeholder}</option>
    ${list.map((item) => html`<option value="${item}" ${item === value ? html`selected` : ''}>${item}</option>`)}
    ${value && !list.includes(value) ? html`<option value="${value}" selected>${value}</option>` : ''}
  </select>`;
}

function sectionHeader(index, id, title, extra = '') {
  return html`
    <header class="form-section__header">
      <span class="form-section__num" aria-hidden="true">${index}</span>
      <h2 id="sec-${id}-title">${title}</h2>
      ${extra}
    </header>`;
}

export function renderVehicleForm({ vehicle, mode }) {
  const v = vehicle;
  const custom = v.features.filter((f) => !STANDARD_FEATURES.includes(f));
  const hasInternal = ['purchasePrice', 'acquisitionDate', 'acquisitionSource', 'reconditioningCost', 'internalNotes', 'employeeNotes', 'soldPrice', 'soldNote']
    .some((key) => v[key] !== null && v[key] !== '' && v[key] !== undefined);
  const maxYear = new Date().getFullYear() + RULES.maxYearsAhead;

  return html`
    <form class="vehicle-form" id="vehicle-form" novalidate>
      <div class="form-alert" data-form-alert role="alert" tabindex="-1" hidden></div>

      <section class="form-section" id="sec-basic" aria-labelledby="sec-basic-title">
        ${sectionHeader(1, 'basic', 'Basic information')}
        <div class="form-grid">
          ${field({ key: 'year', label: 'Year', required: true, control: textInput('year', intText(v.year), { placeholder: `e.g. ${maxYear - 5}`, inputmode: 'numeric', maxlength: 4 }) })}
          ${field({ key: 'make', label: 'Make', required: true, control: textInput('make', v.make, { placeholder: 'e.g. Toyota', list: 'make-options', autocapitalize: 'words' }) })}
          ${field({ key: 'model', label: 'Model', required: true, control: textInput('model', v.model, { placeholder: 'e.g. Camry', autocapitalize: 'words' }) })}
          ${field({ key: 'trim', label: 'Trim', optional: true, control: textInput('trim', v.trim, { placeholder: 'e.g. SE', autocapitalize: 'characters' }) })}
          ${field({ key: 'bodyStyle', label: 'Body style', control: select('bodyStyle', v.bodyStyle, BODY_STYLES) })}
          ${field({ key: 'stockNumber', label: 'Stock number', hint: 'Recommended — must be unique.', control: textInput('stockNumber', v.stockNumber, { placeholder: 'e.g. C1042', autocapitalize: 'characters', maxlength: 30, hint: true }) })}
          <div class="field field--wide" data-field="vin">
            <div class="field__label-row">
              <label class="field__label" for="v-vin">VIN</label>
              <span class="vin-count" data-vin-count aria-hidden="true">0 / 17</span>
            </div>
            <input class="input input--mono" id="v-vin" name="vin" value="${v.vin}" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="17 characters" aria-describedby="v-vin-error v-vin-status">
            <p class="field__hint vin-status" id="v-vin-status" data-vin-status aria-live="polite">Letters are capitalized automatically. VINs never use I, O or Q.</p>
            <p class="field-error" id="v-vin-error" hidden></p>
          </div>
        </div>
        <datalist id="make-options">${COMMON_MAKES.map((m) => html`<option value="${m}"></option>`)}</datalist>
        <datalist id="color-options">${COMMON_COLORS.map((c) => html`<option value="${c}"></option>`)}</datalist>
      </section>

      <section class="form-section" id="sec-photos" aria-labelledby="sec-photos-title">
        ${sectionHeader(2, 'photos', 'Photos', html`<span class="form-section__meta" data-photo-count></span>`)}
        <div data-photo-manager></div>
      </section>

      <section class="form-section" id="sec-price" aria-labelledby="sec-price-title">
        ${sectionHeader(3, 'price', 'Price & mileage')}
        <div class="form-grid">
          ${field({ key: 'price', label: 'Retail price', required: true, control: moneyInput('price', v.price, '0') })}
          ${field({ key: 'salePrice', label: 'Sale price', optional: true, hint: 'Shown as a discounted price. Must be lower than retail.', control: html`<div class="input-affix"><span class="input-affix__text" aria-hidden="true">$</span><input class="input" id="v-salePrice" name="salePrice" value="${money(v.salePrice)}" inputmode="decimal" autocomplete="off" data-money aria-describedby="v-salePrice-error v-salePrice-hint"></div>` })}
          ${field({ key: 'mileage', label: 'Mileage', required: true, control: html`<div class="input-affix input-affix--end"><input class="input" id="v-mileage" name="mileage" value="${money(v.mileage)}" inputmode="numeric" autocomplete="off" placeholder="0" data-integer aria-describedby="v-mileage-error"><span class="input-affix__text" aria-hidden="true">mi</span></div>` })}
        </div>
      </section>

      <section class="form-section" id="sec-specs" aria-labelledby="sec-specs-title">
        ${sectionHeader(4, 'specs', 'Vehicle specs')}
        <div class="form-grid">
          ${field({ key: 'transmission', label: 'Transmission', control: select('transmission', v.transmission, TRANSMISSIONS) })}
          ${field({ key: 'drivetrain', label: 'Drivetrain', control: select('drivetrain', v.drivetrain, DRIVETRAINS) })}
          ${field({ key: 'engine', label: 'Engine', optional: true, control: textInput('engine', v.engine, { placeholder: 'e.g. 2.5L 4-Cylinder' }) })}
          ${field({ key: 'fuelType', label: 'Fuel type', control: select('fuelType', v.fuelType, FUEL_TYPES) })}
          ${field({ key: 'exteriorColor', label: 'Exterior color', control: textInput('exteriorColor', v.exteriorColor, { placeholder: 'e.g. Silver', list: 'color-options', autocapitalize: 'words', maxlength: 40 }) })}
          ${field({ key: 'interiorColor', label: 'Interior color', control: textInput('interiorColor', v.interiorColor, { placeholder: 'e.g. Black', list: 'color-options', autocapitalize: 'words', maxlength: 40 }) })}
          ${field({ key: 'doors', label: 'Doors', optional: true, control: textInput('doors', intText(v.doors), { inputmode: 'numeric', maxlength: 1, extra: 'data-integer' }) })}
          ${field({ key: 'seats', label: 'Seats', optional: true, control: textInput('seats', intText(v.seats), { inputmode: 'numeric', maxlength: 2, extra: 'data-integer' }) })}
        </div>
      </section>

      <section class="form-section" id="sec-description" aria-labelledby="sec-description-title">
        ${sectionHeader(5, 'description', 'Description')}
        <div class="field" data-field="description">
          <label class="field__label" for="v-description">Vehicle description <span class="field__optional">(shown to customers)</span></label>
          <textarea class="textarea" id="v-description" name="description" rows="6" maxlength="${RULES.descriptionMax}" placeholder="Condition, recent service, highlights, anything a buyer should know." aria-describedby="v-description-count v-description-error">${v.description}</textarea>
          <p class="field__hint char-count" id="v-description-count" data-desc-count></p>
          <p class="field-error" id="v-description-error" hidden></p>
        </div>
      </section>

      <section class="form-section" id="sec-features" aria-labelledby="sec-features-title">
        ${sectionHeader(6, 'features', 'Features', html`<span class="form-section__meta" data-feature-count></span>`)}
        <fieldset class="fieldset">
          <legend class="visually-hidden">Standard features</legend>
          <div class="feature-grid">
            ${STANDARD_FEATURES.map((feature, i) => html`
              <label class="feature-chip">
                <input type="checkbox" name="features" value="${feature}" id="feat-${i}" ${v.features.includes(feature) ? html`checked` : ''}>
                <span>${icon('check')}${feature}</span>
              </label>`)}
          </div>
        </fieldset>
        <div class="custom-features">
          <label class="field__label" for="custom-feature">Other features</label>
          <div class="input-row">
            <input class="input" id="custom-feature" maxlength="60" placeholder="e.g. New tires" autocomplete="off" aria-describedby="custom-feature-hint">
            <button type="button" class="btn btn--ghost" data-add-feature>${icon('plus')}Add Custom Feature</button>
          </div>
          <p class="field__hint" id="custom-feature-hint">Press Enter or “Add Custom Feature”. Tap a custom feature to remove it.</p>
          <ul class="custom-list" data-custom-features aria-label="Custom features">
            ${custom.map((f) => html`<li><button type="button" class="chip chip--on" data-remove-feature="${f}" aria-label="Remove feature: ${f}">${f}${icon('x')}</button></li>`)}
          </ul>
        </div>
      </section>

      <section class="form-section form-section--internal" id="sec-internal" aria-labelledby="sec-internal-title">
        <details class="internal" ${hasInternal ? html`open` : ''}>
          <summary>
            <span class="form-section__num" aria-hidden="true">7</span>
            <span class="internal__titles">
              <span class="h2-like" id="sec-internal-title">Internal dealership information</span>
              <span class="internal__flag">${icon('lock')}INTERNAL — NOT SHOWN PUBLICLY</span>
            </span>
            ${icon('chevronDown', 'internal__chevron')}
          </summary>
          <p class="internal__note">For dealership operations only. These fields are excluded from the public listing by design.</p>
          <div class="form-grid">
            ${field({ key: 'purchasePrice', label: 'Purchase price / acquisition cost', optional: true, control: moneyInput('purchasePrice', v.purchasePrice) })}
            ${field({ key: 'acquisitionDate', label: 'Acquisition date', optional: true, control: html`<input class="input" type="date" id="v-acquisitionDate" name="acquisitionDate" value="${v.acquisitionDate}" aria-describedby="v-acquisitionDate-error">` })}
            ${field({ key: 'acquisitionSource', label: 'Acquired from / source', optional: true, control: textInput('acquisitionSource', v.acquisitionSource, { placeholder: 'e.g. Trade-in, auction', maxlength: 120 }) })}
            ${field({ key: 'reconditioningCost', label: 'Reconditioning cost', optional: true, control: moneyInput('reconditioningCost', v.reconditioningCost) })}
            ${field({ key: 'internalNotes', label: 'Internal notes', optional: true, wide: true, control: html`<textarea class="textarea textarea--short" id="v-internalNotes" name="internalNotes" rows="3" maxlength="${RULES.noteMax}" aria-describedby="v-internalNotes-error">${v.internalNotes}</textarea>` })}
            ${field({ key: 'employeeNotes', label: 'Employee notes', optional: true, wide: true, hint: 'Hand-off notes between employees.', control: html`<textarea class="textarea textarea--short" id="v-employeeNotes" name="employeeNotes" rows="3" maxlength="${RULES.noteMax}" aria-describedby="v-employeeNotes-error v-employeeNotes-hint">${v.employeeNotes}</textarea>` })}
            ${v.status === STATUS.SOLD ? html`
              ${field({ key: 'soldPrice', label: 'Actual sold price', optional: true, control: moneyInput('soldPrice', v.soldPrice) })}
              ${field({ key: 'soldNote', label: 'Sale note', optional: true, control: textInput('soldNote', v.soldNote, { maxlength: 200 }) })}` : ''}
          </div>
        </details>
      </section>

      <section class="form-section" id="sec-publishing" aria-labelledby="sec-publishing-title">
        ${sectionHeader(8, 'publishing', 'Publishing')}
        <div class="publishing" data-publishing></div>
        <label class="check">
          <input type="checkbox" name="featured" id="v-featured" ${v.featured ? html`checked` : ''}>
          <span>Feature this vehicle on the public home page</span>
        </label>
      </section>
    </form>

    <div class="save-bar" role="region" aria-label="Save vehicle">
      <p class="save-bar__status" data-save-status aria-live="polite"></p>
      <div class="save-bar__buttons">
        <button type="button" class="btn btn--ghost" data-cancel>Cancel</button>
        <button type="button" class="btn btn--ghost save-bar__preview" data-preview>${icon('eye')}<span>Preview</span></button>
        <button type="button" class="btn btn--dark" data-save>${icon('check')}${mode === 'add' ? 'Save Draft' : 'Save Changes'}</button>
        ${v.status !== STATUS.SOLD && !v.isPublished ? html`<button type="button" class="btn btn--primary" data-publish>${icon('globe')}Publish Vehicle</button>` : ''}
      </div>
    </div>`;
}

export function renderFormNav() {
  return html`
    <nav class="form-nav" aria-label="Form sections">
      <ol>
        ${SECTIONS.map(([id, label]) => html`<li><a href="#sec-${id}" data-nav-section="${id}"><span class="form-nav__dot" aria-hidden="true"></span>${label}</a></li>`)}
      </ol>
    </nav>`;
}
