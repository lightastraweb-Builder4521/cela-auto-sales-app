/* Light Astra Managed App Service — agreement, policy acknowledgment and activation.
   Step 1: review and sign the agreement (and acknowledge the Service Policies).
   Step 2: payment on Stripe's secure page.
   The service turns on by itself once the database sees all of: signed agreement, acknowledged
   policies, an active Stripe subscription (reported by Stripe's verified webhook, never by this
   page) and Light Astra's release. Nothing on this page can activate the service. */
import { DEALERSHIP, SUPPORT } from '../config.js';
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatDateTime } from '../utils/format.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { authService, ROLE_LABELS } from '../services/auth-service.js';
import { billingService } from '../services/billing-service.js';
import {
  lightAstraService, SERVICE_STATE_LABELS, SUBSCRIPTION_LABELS, PAYMENT_LABELS, employeeBand, planPrice, supportMailto
} from '../services/light-astra-service.js';
import { toast, toastError } from '../ui/toast.js';
import { bindSignedCopy } from '../ui/signed-copy.js';

let overview = null;
let agreement = null;
let notice = null;        // { tone, text } after returning from Stripe
let confirming = false;   // back from Checkout: waiting for Stripe's confirmation to reach the database
const viewOnly = new URLSearchParams(window.location.search).get('view') === 'agreement';

/* ---------------------------------------------------------------- pieces */

function documentBody(body) {
  const sections = body && Array.isArray(body.sections) ? body.sections : [];
  return sections.map((s) => html`
    <h3>${s.heading}</h3>
    ${(s.paragraphs || []).map((p) => html`<p>${p}</p>`)}
    ${Array.isArray(s.items) && s.items.length ? html`<ul>${s.items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}`);
}

function header(sub) {
  return html`
    <header class="page-header">
      <div>
        <p class="page-header__eyebrow">${DEALERSHIP.name.replace(/ LLC$/, '')}</p>
        <h1>Light Astra Managed App Service</h1>
        ${sub ? html`<p class="page-header__sub">${sub}</p>` : ''}
      </div>
    </header>`;
}

/** Light Astra's name on the agreement. Text branding: no approved logo file has been supplied yet. */
function brandBlock(a) {
  const p = a.provider || { name: SUPPORT.company, website: SUPPORT.website, email: SUPPORT.email, tagline: '' };
  const https = (url) => (/^https:\/\/[^\s"'<>]+$/.test(url || '') ? url : '');      // only a plain https address is ever linked or loaded
  const website = https(p.website) || SUPPORT.website;
  const logo = https(p.logoUrl);
  return html`
    <div class="la-brand" data-brand>
      ${logo ? html`<img class="la-brand__logo" src="${logo}" alt="${p.name}">` : ''}
      <p class="la-brand__name" data-brand-name>${p.name.toUpperCase()}</p>
      <p class="la-brand__title">Managed App Service Agreement</p>
      ${p.tagline ? html`<p class="la-brand__tagline" data-brand-tagline>${p.tagline}</p>` : ''}
      <p class="la-brand__contact"><a href="${website}" target="_blank" rel="noopener noreferrer" data-brand-website>${website}</a> · <a href="mailto:${p.email}" data-brand-email>${p.email}</a></p>
    </div>`;
}

/** Who and what the agreement is for, from the values it was issued with. */
function termsRows(o, a) {
  const t = a.terms || { clientName: o.clientName, planName: o.plan.name, employeeBand: employeeBand(o.plan), monthlyPrice: planPrice(o.plan).replace(/\/month$/, '') };
  return html`
    <dl class="sys la-terms" data-agreement-terms>
      <div class="sys-row"><dt>Client</dt><dd data-terms-client>${t.clientName}</dd></div>
      <div class="sys-row"><dt>Client ID</dt><dd><code data-terms-client-id>${a.clientId}</code></dd></div>
      <div class="sys-row"><dt>Project ID</dt><dd><code data-terms-project-id>${a.projectId}</code></dd></div>
      <div class="sys-row"><dt>Plan</dt><dd data-terms-plan>${t.planName}</dd></div>
      <div class="sys-row"><dt>Employees</dt><dd data-terms-employees>${t.employeeBand}</dd></div>
      <div class="sys-row"><dt>Monthly Service</dt><dd data-terms-price>${t.monthlyPrice}/month</dd></div>
    </dl>`;
}

/** The client/application-specific policy modules attached to this agreement. */
function moduleSections(a, full) {
  return (a.modules || []).map((m, i) => html`
      <section class="panel settings-section" aria-labelledby="module-title-${i}" data-policy-module="${m.version}">
        <header class="panel__header"><h2 id="module-title-${i}">${icon('info')} ${m.title}</h2><span class="muted">Version ${m.version}</span></header>
        <p class="doc__meta">A policy for this app, attached to the agreement.</p>
        <div class="doc${full ? ' doc--full' : ''}" tabindex="0" role="document" aria-label="${m.title}" data-module-text>${documentBody(m.body)}</div>
      </section>`);
}

function idRows(o) {
  return html`
    <div class="sys-row"><dt>Client ID</dt><dd><span class="id-value"><code data-client-id>${o.clientId}</code><button type="button" class="btn btn--sm btn--ghost" data-copy="${o.clientId}" data-copy-label="Client ID">${icon('copy')}Copy</button></span></dd></div>
    <div class="sys-row"><dt>Project ID</dt><dd><span class="id-value"><code data-project-id>${o.projectId}</code><button type="button" class="btn btn--sm btn--ghost" data-copy="${o.projectId}" data-copy-label="Project ID">${icon('copy')}Copy</button></span></dd></div>`;
}

const pill = (tone, text, name, value) => html`<span class="sys-pill sys-pill--${tone}" data-state-name="${name}" data-state-value="${value}">${text}</span>`;

/** Every state on its own line: contract, policy, payment, subscription, release, service. */
function statusList(o) {
  const signed = o.contract && o.contract.status === 'SIGNED';
  const policyOk = o.policy && o.policy.status === 'ACCEPTED';
  const paid = o.payment === 'PAID';
  return html`
    <dl class="sys" data-setup-status>
      <div class="sys-row"><dt>Agreement</dt><dd>${signed ? pill('ok', 'Signed', 'agreement', 'SIGNED') : pill('warn', 'Required', 'agreement', o.contract ? o.contract.status : 'NOT_SENT')}
        ${signed ? html`<span class="sys-row__detail">${o.contract.signedName} · ${formatDateTime(o.contract.signedAt)} · version ${o.contract.version}</span>` : ''}</dd></div>
      <div class="sys-row"><dt>Policy</dt><dd>${policyOk ? pill('ok', 'Accepted', 'policy', 'ACCEPTED') : pill('warn', 'Required', 'policy', 'REQUIRED')}
        <span class="sys-row__detail">Service Policies ${o.policy ? o.policy.version : ''}</span></dd></div>
      <div class="sys-row"><dt>Payment</dt><dd>${pill(paid ? 'ok' : o.payment === 'PAST_DUE' ? 'warn' : 'neutral', PAYMENT_LABELS[o.payment] || o.payment, 'payment', o.payment)}
        <span class="sys-row__detail">Subscription: ${SUBSCRIPTION_LABELS[o.subscription] || o.subscription}</span></dd></div>
      ${o.release === 'PENDING' ? html`<div class="sys-row"><dt>Light Astra release</dt><dd>${pill('neutral', 'Pending', 'release', 'PENDING')}<span class="sys-row__detail">Light Astra is completing the final release checks.</span></dd></div>` : ''}
      <div class="sys-row"><dt>Service</dt><dd>${pill(o.service === 'ACTIVE' ? 'ok' : o.service === 'SUSPENDED' ? 'danger' : 'warn', SERVICE_STATE_LABELS[o.service] || o.service, 'service', o.service)}</dd></div>
    </dl>`;
}

function planCard(o) {
  return html`
    <div class="plan-card" data-plan-card>
      <span class="plan-card__name" data-plan-name>${o.plan.name}</span>
      <span class="plan-card__price" data-plan-price>${planPrice(o.plan)}</span>
      <span class="muted" data-plan-band>For ${employeeBand(o.plan)} employees</span>
    </div>`;
}

function supportLine(o) {
  return html`<p class="page-note">${icon('mail')}<span>Questions? Contact ${SUPPORT.company} Support: <a href="${SUPPORT.website}" target="_blank" rel="noopener noreferrer">${SUPPORT.websiteLabel}</a> · <a href="${supportMailto(o, 'Billing Question')}">${SUPPORT.email}</a>. Quote Client ID ${o.clientId} and Project ID ${o.projectId}.</span></p>`;
}

function noticeBlock() {
  return notice ? html`<div class="notice notice--${notice.tone}" role="status" data-onboarding-notice>${icon(notice.tone === 'ok' ? 'checkCircle' : notice.tone === 'warn' ? 'clock' : 'info')}<p>${notice.text}</p></div>` : '';
}

/** The policy module attached to this agreement, by its own title (for Cela: the Vehicle Inventory Retention Policy). */
function retentionPolicyName(a) {
  const first = (a.modules || [])[0];
  return first && first.title ? first.title : '';
}

/** Agreement versions whose renewal and cancellation sections (4 and 5) the summary below was read from. A later
    version shows no summary until someone has read it and added it here. MASA-1.2 is MASA-1.1 with the status
    wording of section 20 taken out: sections 4 and 5 are the same text. */
const SUMMARISED_VERSIONS = ['MASA-1.1', 'MASA-1.2'];

/** The billing terms in plain words, next to the signature. A reading of the agreement's renewal and cancellation
    sections (4 and 5), not an addition to them: the agreement text above is what is signed. */
function billingSummary(o, a) {
  if (!SUMMARISED_VERSIONS.includes(a.version)) return '';
  const price = (a.terms && a.terms.monthlyPrice) ? `${a.terms.monthlyPrice}/month` : planPrice(o.plan);
  return html`
        <div class="notice" role="note" data-billing-summary>
          ${icon('card')}
          <div>
            <p><strong>Month-to-month service at ${price}.</strong></p>
            <ul class="plain-list">
              <li>Renews automatically each month.</li>
              <li>Cancel anytime. Cancellation takes effect at the end of the current paid billing period.</li>
              <li>Service remains active through the period already paid for.</li>
            </ul>
            <p class="field__hint" data-billing-summary-note>A summary of sections 4 and 5 of the agreement above. The agreement text is what applies.</p>
          </div>
        </div>`;
}

/* ---------------------------------------------------------------- screens */

/** Step 1 of 2 — review and sign. Nothing is pre-ticked. */
function agreementStep(o, a) {
  const policyOnly = a.status === 'SIGNED';     // a newer Service Policies version on a signed agreement
  return html`
    <div class="page__inner page__inner--narrow" data-onboarding="agreement">
      ${header(policyOnly ? 'The Service Policies were updated. Review and acknowledge the new version to continue.' : 'Review the agreement and the service policies, then sign to continue.')}
      <p class="page-header__eyebrow" data-step>${policyOnly ? 'Policy update' : 'Step 1 of 2'}</p>
      <p class="muted" data-sign-pointer>${policyOnly
        ? html`The Service Policies have a new version. Read it below, then tick the box in the <a href="#sign-title">Acknowledge section at the end of this page</a>.`
        : html`Read both documents below, then tick the two boxes and sign in the <a href="#sign-title">Sign section at the end of this page</a>.`}</p>

      ${policyOnly ? '' : html`
      <section class="panel settings-section" aria-labelledby="agreement-title">
        <header class="panel__header"><h2 id="agreement-title">${icon('file')} Review Agreement</h2><span class="muted" data-agreement-version>Version ${a.version}</span></header>
        ${brandBlock(a)}
        ${termsRows(o, a)}
        <div class="doc" tabindex="0" role="document" aria-label="${a.title}" data-agreement-text>${documentBody(a.body)}</div>
      </section>`}

      <section class="panel settings-section" aria-labelledby="policy-title">
        <header class="panel__header"><h2 id="policy-title">${icon('info')} Service Policies</h2><span class="muted" data-policy-version>Version ${a.policy.version}</span></header>
        <p class="doc__meta">${a.policy.title}: privacy and data protection, acceptable use, account security and support.</p>
        <div class="doc" tabindex="0" role="document" aria-label="${a.policy.title}" data-policy-text>${documentBody(a.policy.body)}</div>
      </section>
      ${policyOnly ? '' : moduleSections(a, false)}

      <section class="panel settings-section" aria-labelledby="sign-title">
        <header class="panel__header"><h2 id="sign-title">${icon('edit')} ${policyOnly ? 'Acknowledge' : 'Sign'}</h2></header>
        ${policyOnly ? '' : billingSummary(o, a)}
        <form class="sign-form" data-sign-form novalidate>
          ${policyOnly ? '' : html`
          <div class="form-grid" data-signer-fields>
            <div class="field">
              <label class="field__label" for="signer-first-name">First Name</label>
              <input class="input" id="signer-first-name" name="firstName" autocomplete="given-name" maxlength="60" required aria-required="true" data-signer-first-name>
            </div>
            <div class="field">
              <label class="field__label" for="signer-last-name">Last Name</label>
              <input class="input" id="signer-last-name" name="lastName" autocomplete="family-name" maxlength="60" required aria-required="true" data-signer-last-name>
            </div>
            <div class="field">
              <label class="field__label" for="signer-email">Registered Email</label>
              <input class="input" id="signer-email" value="${authService.getCurrentUser().email || ''}" readonly aria-readonly="true" aria-describedby="signer-facts-hint" data-signer-email>
            </div>
            <div class="field">
              <label class="field__label" for="signer-role">Role</label>
              <input class="input" id="signer-role" value="${ROLE_LABELS[authService.getCurrentUser().role] || ''}" readonly aria-readonly="true" aria-describedby="signer-facts-hint" data-signer-role>
            </div>
            <div class="field field--wide">
              <label class="field__label" for="signing-date">Date Signed</label>
              <input class="input" id="signing-date" value="Set by the server when you sign" readonly aria-readonly="true" aria-describedby="signer-facts-hint" data-signing-date>
              <p class="field__hint" id="signer-facts-hint">Enter your legal first and last name: together they are your electronic signature for ${o.clientName}. Email and role come from the account you are signed in with, and the date is set by Light Astra’s server at the moment you sign. They cannot be typed or changed here.</p>
            </div>
          </div>
          <label class="check check--top"><input type="checkbox" name="agree" data-agree>
            <span>I have read and agree to the Light Astra Managed App Service Agreement.</span></label>`}
          <label class="check check--top"><input type="checkbox" name="policy" data-ack-policy>
            <span>${policyOnly ? 'I acknowledge the updated Light Astra Service Policies.' : `I have read and agree to the applicable Service Policies, including privacy and data protection, acceptable use, account and security requirements${retentionPolicyName(a) ? `, and the ${retentionPolicyName(a)} for ${o.clientName}` : ''}.`}</span></label>
          <p class="form-alert" data-sign-error role="alert" hidden></p>
          <div class="btn-row"><button type="submit" class="btn btn--primary" data-sign-submit>${icon('check')}${policyOnly ? 'Acknowledge & Continue' : 'Sign Agreement & Continue to Payment'}</button></div>
        </form>
      </section>
      ${supportLine(o)}
    </div>`;
}

/** Step 2 of 2 — payment on Stripe, or waiting for what is still missing. */
function paymentStep(o) {
  const needsPayment = o.waitingFor.includes('PAYMENT');
  const wrongPlan = o.waitingFor.includes('PLAN');
  // A service that was active before and has no paid plan now: the same screen, said as what it is.
  const suspended = o.service === 'SUSPENDED';
  return html`
    <div class="page__inner page__inner--narrow" data-onboarding="payment" data-service="${o.service}">
      ${header(suspended
        ? 'The service is suspended. Your data is kept. Reactivate the plan to continue; the agreement you signed still applies.'
        : 'The agreement is signed. Set up payment to activate the service.')}
      <p class="page-header__eyebrow" data-step>${suspended ? 'Service suspended' : 'Step 2 of 2'}</p>
      ${noticeBlock()}
      <section class="panel settings-section" aria-labelledby="plan-title">
        <header class="panel__header"><h2 id="plan-title">${icon('card')} ${o.plan.name}</h2></header>
        ${planCard(o)}
        ${confirming
          ? html`<p class="page-note" data-confirming>${icon('clock')} Waiting for Stripe to confirm the payment…</p>`
          : needsPayment && (o.subscription === 'PAST_DUE' || o.subscription === 'INCOMPLETE')
            ? html`<div class="btn-row billing-actions"><a class="btn btn--primary" href="billing.html">${icon('card')}Open Billing</a></div>`
            : needsPayment
              ? html`<div class="btn-row billing-actions"><button type="button" class="btn btn--primary" data-checkout>${icon('card')}${suspended ? 'Reactivate Plan' : 'Continue to Secure Payment'}</button>${suspended ? html`<a class="btn btn--ghost" href="billing.html" data-manage-billing>${icon('card')}Manage Billing</a>` : ''}</div>`
              : wrongPlan
                ? html`<p class="page-note">${icon('alert')} The current subscription is not for this plan. Please contact Light Astra Support.</p>`
                : html`<p class="page-note">${icon('clock')} Payment is in place. Light Astra is completing the final release checks; the service starts automatically.</p>`}
        <p class="muted">This is the ongoing Light Astra app operation and support plan. It is not the price to build an app; development is quoted separately.</p>
        <p class="page-note">${icon('lock')}<span>Payments are handled by Stripe. Card details are entered on Stripe’s secure page and are never seen or stored by this app. The plan renews monthly until canceled; canceling takes effect at the end of the paid period.</span></p>
      </section>
      <section class="panel settings-section" aria-labelledby="setup-title">
        <header class="panel__header"><h2 id="setup-title">${icon('info')} Setup status</h2></header>
        ${statusList(o)}
        ${suspended ? html`<dl class="sys">${idRows(o)}</dl>` : ''}
        <div class="btn-row"><a class="btn btn--ghost" href="onboarding.html?view=agreement" data-view-agreement>${icon('file')}View Signed Agreement</a>${suspended ? html`<a class="btn btn--ghost" href="${supportMailto(o, 'Billing Question')}" data-contact-support>${icon('mail')}Contact Light Astra Support</a>` : ''}</div>
      </section>
      ${supportLine(o)}
    </div>`;
}

/** Everything is in place. */
function activeScreen(o) {
  return html`
    <div class="page__inner page__inner--narrow" data-onboarding="active">
      ${header('The service is active. The inventory manager and the public website are ready to use.')}
      ${noticeBlock()}
      <section class="panel settings-section" aria-labelledby="active-title">
        <header class="panel__header"><h2 id="active-title">${icon('checkCircle')} Light Astra Service</h2></header>
        <div class="btn-row billing-actions">
          <a class="btn btn--primary" href="dashboard.html" data-open-dashboard>${icon('dashboard')}Open Dashboard</a>
          <a class="btn btn--ghost" href="billing.html">${icon('card')}Billing</a>
          <a class="btn btn--ghost" href="onboarding.html?view=agreement" data-view-agreement>${icon('file')}View Signed Agreement</a>
        </div>
        <dl class="sys">
          <div class="sys-row"><dt>Service</dt><dd>${pill('ok', 'ACTIVE', 'service', 'ACTIVE')}</dd></div>
          <div class="sys-row"><dt>Plan</dt><dd><strong data-plan-name>${o.plan.name}</strong><span class="sys-row__detail"><span data-plan-price>${planPrice(o.plan)}</span> · ${employeeBand(o.plan)} employees</span></dd></div>
          ${idRows(o)}
        </dl>
      </section>
      <section class="panel settings-section" aria-labelledby="setup-title">
        <header class="panel__header"><h2 id="setup-title">${icon('info')} Status</h2></header>
        ${statusList(o)}
      </section>
      ${supportLine(o)}
    </div>`;
}

/** The signed record, read-only. */
function signedView(o, a) {
  return html`
    <div class="page__inner page__inner--narrow" data-onboarding="signed-agreement">
      ${header('The agreement as it was signed. This record cannot be changed.')}
      <section class="panel settings-section" aria-labelledby="signed-title">
        <header class="panel__header"><h2 id="signed-title">${icon('file')} ${a.title}</h2><span class="muted">Version ${a.version}</span></header>
        <dl class="sys" data-signature>
          <div class="sys-row"><dt>Status</dt><dd>${a.status === 'SIGNED' ? pill('ok', 'Signed', 'agreement', 'SIGNED') : pill('warn', 'Not signed yet', 'agreement', a.status)}</dd></div>
          ${a.status === 'SIGNED' ? html`
          <div class="sys-row"><dt>Signed by</dt><dd><strong data-signed-name>${a.signedName}</strong><span class="sys-row__detail" data-signed-email>${a.signedEmail}</span></dd></div>
          <div class="sys-row"><dt>Signed on</dt><dd data-signed-at>${formatDateTime(a.signedAt)}</dd></div>` : ''}
          ${idRows(o)}
          <div class="sys-row"><dt>Record check</dt><dd><span class="mono break" title="SHA-256 of the agreement text" data-agreement-hash>${a.sha256}</span></dd></div>
        </dl>
        ${a.status === 'SIGNED' ? html`
        <div class="btn-row" data-signed-copy-actions>
          <button type="button" class="btn btn--primary" data-signed-copy="download">${icon('file')}Download Signed Copy</button>
          <button type="button" class="btn btn--ghost" data-signed-copy="view">${icon('eye')}Open as PDF</button>
        </div>
        <p class="muted" data-copy-email-note>A signed copy is also emailed to the registered address.</p>` : ''}
        ${brandBlock(a)}
        ${termsRows(o, a)}
        <div class="doc doc--full" data-agreement-text>${documentBody(a.body)}</div>
      </section>
      <section class="panel settings-section" aria-labelledby="policy-title">
        <header class="panel__header"><h2 id="policy-title">${icon('info')} ${a.policy.title}</h2><span class="muted">Version ${a.policy.version}</span></header>
        ${a.policy.acceptedAt ? html`<p class="doc__meta">Acknowledged ${formatDateTime(a.policy.acceptedAt)}${a.policy.acceptedName ? ` by ${a.policy.acceptedName}` : ''}</p>` : ''}
        <div class="doc doc--full" data-policy-text>${documentBody(a.policy.body)}</div>
      </section>
      ${moduleSections(a, true)}
      <div class="btn-row"><a class="btn btn--ghost" href="onboarding.html">${icon('arrowLeft')}Back</a><a class="btn btn--ghost" href="billing.html">${icon('card')}Billing</a></div>
    </div>`;
}

function refusal(title, text) {
  return html`
    <div class="page__inner page__inner--narrow">
      ${header('')}
      <section class="empty-state" data-onboarding-refused>
        <span class="empty-state__icon">${icon('lock')}</span>
        <h2>${title}</h2>
        <p>${text}</p>
        <div class="btn-row btn-row--center"><a class="btn btn--ghost" href="dashboard.html">${icon('dashboard')}Back to Dashboard</a></div>
      </section>
    </div>`;
}

/* ---------------------------------------------------------------- flow */

function render() {
  const main = qs('#main');
  if (!lightAstraService.enabled) {
    setHtml(main, refusal('Not available in local mode', 'The Light Astra service record applies when the app is connected to the shared database.'));
    return;
  }
  if (!authService.can('billing.manage')) {
    setHtml(main, refusal('Handled by an Admin', 'Only a Cela Admin can review and sign the service agreement and set up payment.'));
    return;
  }
  if (!overview || !agreement) {
    setHtml(main, refusal('The agreement isn’t available yet', `Light Astra has not issued the service agreement yet. Contact ${SUPPORT.company} Support at ${SUPPORT.email}.`));
    return;
  }
  const policyAccepted = overview.policy && overview.policy.status === 'ACCEPTED';
  if (viewOnly) setHtml(main, signedView(overview, agreement));
  else if (overview.onboardingRequired && agreement.status === 'SIGNED' && policyAccepted) {
    // Signed and acknowledged, yet not valid any more: the plan or price changed after signing.
    setHtml(main, html`
      <div class="page__inner page__inner--narrow" data-onboarding="agreement-update">
        ${header('An updated agreement is being prepared.')}
        <div class="notice notice--warn" role="status">${icon('clock')}<p><strong>Your plan changed after the agreement was signed.</strong> ${SUPPORT.company} will issue an updated agreement for you to sign here. Nothing is needed from you until then.</p></div>
        ${supportLine(overview)}
      </div>`);
  } else if (overview.onboardingRequired) setHtml(main, agreementStep(overview, agreement));
  else if (overview.service === 'ACTIVE') setHtml(main, activeScreen(overview));
  else setHtml(main, paymentStep(overview));
}

async function load({ fresh = true } = {}) {
  overview = await lightAstraService.getOverview({ fresh });
  if (overview && overview.isAdmin) agreement = await lightAstraService.getAgreement();
}

async function sign(form) {
  const errorBox = form.querySelector('[data-sign-error]');
  const submit = form.querySelector('[data-sign-submit]');
  const fail = (message, field) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (field) field.focus();
  };
  errorBox.hidden = true;
  const policyOnly = agreement.status === 'SIGNED';
  const agree = form.querySelector('[data-agree]');
  const ack = form.querySelector('[data-ack-policy]');
  const first = form.querySelector('[data-signer-first-name]');
  const last = form.querySelector('[data-signer-last-name]');
  // The same order as the page: names, then the two consents. The server checks all of it again.
  if (!policyOnly && !first.value.trim()) return fail('Enter your first name to sign.', first);
  if (!policyOnly && !last.value.trim()) return fail('Enter your last name to sign.', last);
  if (!policyOnly && !agree.checked) return fail('Tick the box to confirm that you have read and agree to the Managed App Service Agreement.', agree);
  if (!ack.checked) return fail(policyOnly ? 'Tick the box to acknowledge the updated Service Policies.' : 'Tick the box to confirm that you have read and agree to the Service Policies.', ack);
  if (submit.disabled) return undefined;                 // a second press while the first is on its way
  submit.disabled = true;
  try {
    overview = policyOnly
      ? await lightAstraService.acceptPolicy({ policyVersion: agreement.policy.version, acknowledge: ack.checked })
      : await lightAstraService.sign({
        agreementId: agreement.agreementId, sha256: agreement.sha256, policyVersion: agreement.policy.version,
        firstName: first.value, lastName: last.value, agree: agree.checked, acknowledgePolicy: ack.checked
      });
    agreement = await lightAstraService.getAgreement();
    // The signed copy is generated and recorded now, so it exists whether or not anyone opens it, and the server
    // emails it to the registered address. A failure here never undoes the signature.
    if (!policyOnly) lightAstraService.getSignedCopy().catch(() => {});
    toast(policyOnly ? 'Service Policies acknowledged.' : 'Agreement signed.');
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    submit.disabled = false;
    fail(err.message || 'Couldn’t record the signature. Please try again.');
  }
  return undefined;
}

/** After Checkout, Stripe's webhook reaches the database a few seconds later: watch for it. */
async function waitForActivation() {
  confirming = true;
  render();
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => { window.setTimeout(resolve, 3000); });
    try { await load(); } catch (err) { break; }
    if (overview && overview.service === 'ACTIVE') {
      confirming = false;
      notice = { tone: 'ok', text: 'Payment confirmed by Stripe. The service is active.' };
      render();
      return;
    }
    if (overview && overview.payment === 'PAID') break;          // paid, waiting for something else (shown in the status list)
  }
  confirming = false;
  notice = overview && overview.payment === 'PAID'
    ? { tone: 'info', text: 'Payment confirmed by Stripe. The service starts automatically as soon as the remaining item below is complete.' }
    : { tone: 'warn', text: 'Stripe has not confirmed a payment yet. If you completed the payment, this page updates within a few minutes — reload to check.' };
  render();
}

function bind() {
  const main = qs('#main');
  bindSignedCopy(main);
  main.addEventListener('submit', (event) => {
    if (!event.target.matches('[data-sign-form]')) return;
    event.preventDefault();
    sign(event.target);
  });
  main.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast(`${copy.dataset.copyLabel} copied.`);
      } catch (err) {
        toast(`${copy.dataset.copyLabel}: ${copy.dataset.copy}`, { tone: 'info' });
      }
      return;
    }
    const checkout = event.target.closest('[data-checkout]');
    if (!checkout || checkout.disabled) return;
    const label = checkout.innerHTML;
    checkout.disabled = true;
    checkout.textContent = 'Opening Stripe…';
    try {
      await billingService.openCheckout({ returnTo: 'onboarding' });
    } catch (err) {
      toastError(err.message || 'Billing is temporarily unavailable. Please try again in a moment.');
      checkout.disabled = false;
      checkout.innerHTML = label;
    }
  });
}

initLayout({ page: 'onboarding', title: 'Light Astra Service' }).then(async () => {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (checkout) window.history.replaceState(null, '', 'onboarding.html');
  if (checkout === 'canceled') notice = { tone: 'info', text: 'Checkout was canceled. No payment was taken.' };
  if (lightAstraService.enabled && authService.can('billing.manage')) {
    await load();
    // Opening the agreement is recorded (Sent → Viewed); it changes nothing else.
    if (agreement && agreement.status === 'SENT' && !viewOnly) lightAstraService.markViewed(agreement.agreementId);
  }
  render();
  bind();
  // A return from Stripe proves nothing by itself: only the database state (written by Stripe's webhook) counts.
  if (checkout === 'success' && overview && overview.service !== 'ACTIVE' && !overview.onboardingRequired) await waitForActivation();
}).catch(handlePageError);
