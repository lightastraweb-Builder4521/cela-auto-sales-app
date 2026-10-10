/* Billing: the Light Astra Managed App Service (Admins only).
   Shows the plan (operation tier, not a build price), the subscription, the agreement,
   the service state and the Client ID / Project ID — each as its own status. An Admin can
   open Stripe-hosted Checkout (set up payment, only after the agreement is signed) or the
   Stripe Customer Portal (manage it). The database decides what works; nothing on this
   page changes billing or service status. */
import { SUPPORT } from '../config.js';
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatLongDate } from '../utils/format.js';
import { initLayout, handlePageError } from '../ui/layout.js';
import { authService } from '../services/auth-service.js';
import { billingService } from '../services/billing-service.js';
import { lightAstraService, SERVICE_STATE_LABELS, SUBSCRIPTION_LABELS, employeeBand, planPrice, supportMailto } from '../services/light-astra-service.js';
import { confirmDialog } from '../ui/dialogs.js';
import { toast, toastError } from '../ui/toast.js';
import { bindSignedCopy } from '../ui/signed-copy.js';

const TONES = { active: 'ok', past_due: 'warn', setup_incomplete: 'warn', suspended: 'danger', canceled: 'danger', setup_required: 'neutral' };

let status = null;
let service = null;      // Light Astra service record: plan, agreement, IDs, entitlement
let notice = null;       // { tone, text } shown after returning from Stripe
let confirming = false;  // just back from Checkout: no second "Set Up Payment" while Stripe confirms
let changing = false;    // Cancel/Resume sent: no second click while Stripe confirms

function priceLabel(s) {
  if (service && service.plan) return planPrice(service.plan);       // the contracted plan (catalogue price)
  const amount = (s.amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: String(s.currency || 'usd').toUpperCase(),
    minimumFractionDigits: s.amountCents % 100 ? 2 : 0
  });
  return `${amount}/${s.interval}`;
}

function needsSetup(s) {
  return s.state === 'setup_required' || s.state === 'canceled' || s.stripeStatus === 'incomplete_expired';
}

function statusDetail(s) {
  switch (s.state) {
    case 'active':
      return s.cancelAt
        ? `Set to end on ${formatLongDate(s.cancelAt)}. Publishing works until then.`
        : 'Payments are up to date.';
    case 'past_due': return `The last payment failed. Publishing stays available until ${formatLongDate(s.gracePeriodEnd)}.`;
    case 'suspended': return 'Publishing is paused until a payment succeeds.';
    case 'canceled': return s.publishingAvailable
      ? `The subscription ended after a failed payment. Publishing stays available until ${formatLongDate(s.gracePeriodEnd)}.`
      : 'The subscription has ended. Publishing is paused.';
    case 'setup_incomplete': return 'The first payment has not completed yet.';
    default: return s.publishingAvailable
      ? 'Payment has not been set up yet. Publishing works while setup is pending.'
      : 'Payment has not been set up yet.';
  }
}

function dateRow(s) {
  if (s.state === 'active' && s.cancelAt) return { label: 'Service ends', value: formatLongDate(s.cancelAt) };
  if (s.state === 'active' && s.currentPeriodEnd) return { label: 'Next billing date', value: formatLongDate(s.currentPeriodEnd) };
  if (s.gracePeriodEnd && s.publishingAvailable && (s.state === 'past_due' || s.state === 'canceled')) {
    return { label: 'Grace period ends', value: formatLongDate(s.gracePeriodEnd) };
  }
  return { label: 'Next billing date', value: '—' };
}

function alertBlock(s) {
  if (s.state === 'past_due') {
    return html`<div class="notice notice--warn" role="status">${icon('alert')}<p><strong>We couldn’t collect the last payment.</strong> Update the payment method in Manage Billing before ${formatLongDate(s.gracePeriodEnd)} to keep publishing without interruption.</p></div>`;
  }
  if (s.state === 'canceled' && s.publishingAvailable) {
    return html`<div class="notice notice--warn" role="status">${icon('alert')}<p><strong>The subscription ended after a failed payment.</strong> Set up payment before ${formatLongDate(s.gracePeriodEnd)} to keep publishing without interruption.</p></div>`;
  }
  if (!s.publishingAvailable && (s.state === 'setup_required' || s.state === 'setup_incomplete')) {
    return html`<div class="notice notice--danger" role="status">${icon('lock')}<p><strong>Publishing is paused</strong> until payment for the managed service is set up. Vehicles, photos, employees and history are safe and can still be viewed and edited.</p></div>`;
  }
  if (s.state === 'suspended' || s.state === 'canceled') {
    return html`<div class="notice notice--danger" role="status">${icon('lock')}<p><strong>Publishing is paused</strong> because the managed service subscription is ${s.state === 'canceled' ? 'canceled' : 'inactive'}. Vehicles, photos, employees and history are safe and can still be viewed and edited. ${s.state === 'canceled' ? 'Set up payment to resume publishing.' : 'Publishing resumes automatically once a payment succeeds.'}</p></div>`;
  }
  return '';
}

function actions(s) {
  if (!authService.can('billing.manage')) {
    return html`<p class="page-note">${icon('lock')} Only an Admin can set up or manage billing.</p>`;
  }
  if (confirming && s.state !== 'active') {
    return html`<p class="page-note">${icon('clock')} Waiting for Stripe to confirm the payment…</p>`;
  }
  if (changing) {
    return html`<p class="page-note">${icon('clock')} Confirming the plan change with Stripe…</p>`;
  }
  const buttons = [];
  if (service && service.onboardingRequired) {
    // Payment never comes before the agreement (the server refuses Checkout too). With a subscription
    // already in place, billing can still be managed; the service waits for the signature.
    return html`
      <div class="notice notice--warn" role="status" data-agreement-required>${icon('file')}<p><strong>Agreement Required.</strong> Review and sign the Managed App Service Agreement ${needsSetup(s) ? 'before setting up payment' : 'to activate the service'}.</p></div>
      <div class="btn-row billing-actions">
        <a class="btn btn--primary" href="onboarding.html" data-review-agreement>${icon('file')}Review Agreement</a>
        ${!needsSetup(s) && s.hasBillingAccount ? html`<button type="button" class="btn btn--ghost" data-billing="portal">${icon('card')}Manage Billing</button>` : ''}
      </div>`;
  }
  if (needsSetup(s)) {
    buttons.push(html`<button type="button" class="btn btn--primary" data-billing="checkout">${icon('card')}Set Up Payment</button>`);
    if (s.hasBillingAccount) buttons.push(html`<button type="button" class="btn btn--ghost" data-billing="portal">${icon('file')}Manage Billing</button>`);
  } else if (s.hasBillingAccount) {
    buttons.push(html`<button type="button" class="btn btn--primary" data-billing="portal">${icon('card')}Manage Billing</button>`);
  }
  // Cancel/Resume only where Stripe accepts them (not for an "unpaid" subscription shown as past due).
  if (s.hasBillingAccount && (s.state === 'active' || (s.state === 'past_due' && s.stripeStatus === 'past_due'))) {
    buttons.push(s.cancelAt
      ? html`<button type="button" class="btn btn--ghost" data-billing="resume">${icon('restore')}Resume Plan</button>`
      : html`<button type="button" class="btn btn--danger-ghost" data-billing="cancel">${icon('x')}Cancel Plan</button>`);
  }
  return buttons.length ? html`<div class="btn-row billing-actions">${buttons}</div>` : '';
}

function render() {
  const main = qs('#main');
  if (!billingService.enabled || !status) {
    setHtml(main, html`
      <div class="page__inner page__inner--narrow">
        <header class="page-header"><div><p class="page-header__eyebrow">Managed service</p><h1>Billing</h1></div></header>
        <section class="empty-state">
          <span class="empty-state__icon">${icon('card')}</span>
          <h2>Billing status isn’t available</h2>
          <p>${billingService.enabled ? 'The billing record couldn’t be found. Please contact Light Astra.' : 'Billing applies when the app is connected to the shared database.'}</p>
        </section>
      </div>`);
    return;
  }
  const s = status;
  const date = dateRow(s);
  setHtml(main, html`
    <div class="page__inner page__inner--narrow">
      <header class="page-header">
        <div>
          <p class="page-header__eyebrow">Managed service</p>
          <h1>Billing</h1>
          <p class="page-header__sub">The Light Astra Managed App Service keeps this inventory manager and the public website running.</p>
        </div>
      </header>

      ${notice ? html`<div class="notice notice--${notice.tone}" role="status" data-billing-notice>${icon(notice.tone === 'warn' ? 'clock' : notice.tone === 'danger' ? 'alert' : 'checkCircle')}<p>${notice.text}</p></div>` : ''}
      ${alertBlock(s)}

      <section class="panel settings-section" aria-labelledby="plan-title">
        <header class="panel__header">
          <h2 id="plan-title">${icon('card')} ${s.serviceName}</h2>
          ${s.testMode ? html`<span class="sys-pill sys-pill--warn" title="Stripe sandbox: no real money is charged">Test mode</span>` : ''}
        </header>
        ${actions(s)}
        <dl class="sys">
          ${service && service.plan ? html`
          <div class="sys-row"><dt>Plan</dt><dd><strong data-billing-plan>${service.plan.name}</strong><span class="sys-row__detail">Ongoing app operation and support. Not a build price.</span></dd></div>
          <div class="sys-row"><dt>Employees</dt><dd data-billing-employees>${employeeBand(service.plan)}</dd></div>` : ''}
          <div class="sys-row"><dt>Monthly</dt><dd><strong class="billing-price" data-billing-price>${priceLabel(s)}</strong></dd></div>
          <div class="sys-row"><dt>Subscription</dt><dd><span class="sys-pill sys-pill--${TONES[s.state] || 'neutral'}" data-billing-state="${s.state}" data-billing-subscription="${service ? service.subscription : ''}">${service && s.state === 'active' && SUBSCRIPTION_LABELS[service.subscription] ? SUBSCRIPTION_LABELS[service.subscription] : s.stateLabel}</span><span class="sys-row__detail">${statusDetail(s)}</span></dd></div>
          <div class="sys-row"><dt>${date.label}</dt><dd data-billing-date>${date.value}</dd></div>
        </dl>
        <p class="page-note">${icon('lock')} Payments are handled by Stripe. Card details are entered on Stripe’s secure pages and are never seen or stored by this app.${s.testMode ? ' This is a Stripe sandbox: use Stripe test cards only; no real money moves.' : ''}</p>
      </section>

      <section class="panel settings-section" aria-labelledby="service-title" data-service-panel>
        <header class="panel__header"><h2 id="service-title">${icon('info')} Service status</h2></header>
        <dl class="sys">
          <div class="sys-row"><dt>Publishing</dt><dd>${s.publishingAvailable
            ? html`<span class="sys-pill sys-pill--ok" data-billing-publishing="on">Available</span>`
            : html`<span class="sys-pill sys-pill--danger" data-billing-publishing="off">Paused</span><span class="sys-row__detail">New listings, scheduled publications, public changes and new photo uploads wait until the service is active again.</span>`}</dd></div>
          ${service ? html`
          <div class="sys-row"><dt>Agreement</dt><dd>${service.contract && service.contract.status === 'SIGNED' && !service.onboardingRequired
            ? html`<span class="sys-pill sys-pill--ok" data-billing-agreement="SIGNED">Signed</span><span class="sys-row__detail">Version ${service.contract.version} · ${formatLongDate(service.contract.signedAt)} · <a href="onboarding.html?view=agreement" data-view-agreement>View Agreement</a> · <button type="button" class="link-button" data-signed-copy="download">Download Signed Copy</button></span>`
            : html`<span class="sys-pill sys-pill--warn" data-billing-agreement="REQUIRED">Required</span><span class="sys-row__detail"><a href="onboarding.html" data-review-agreement-link>Review and sign</a></span>`}</dd></div>
          <div class="sys-row"><dt>Service</dt><dd><span class="sys-pill sys-pill--${service.service === 'ACTIVE' ? 'ok' : service.service === 'SUSPENDED' ? 'danger' : 'warn'}" data-billing-service="${service.service}">${SERVICE_STATE_LABELS[service.service] || service.service}</span>${service.service !== 'ACTIVE' && service.waitingFor.length ? html`<span class="sys-row__detail">Waiting for: ${service.waitingFor.map((w) => ({ AGREEMENT: 'signed agreement', POLICY: 'policy acknowledgment', PAYMENT: 'payment', PLAN: 'the contracted plan', RELEASE: 'Light Astra release' })[w] || w).join(', ')}.</span>` : ''}</dd></div>
          <div class="sys-row"><dt>Client ID</dt><dd><span class="id-value"><code data-client-id>${service.clientId}</code><button type="button" class="btn btn--sm btn--ghost" data-copy="${service.clientId}" data-copy-label="Client ID">${icon('copy')}Copy</button></span></dd></div>
          <div class="sys-row"><dt>Project ID</dt><dd><span class="id-value"><code data-project-id>${service.projectId}</code><button type="button" class="btn btn--sm btn--ghost" data-copy="${service.projectId}" data-copy-label="Project ID">${icon('copy')}Copy</button></span></dd></div>` : ''}
        </dl>
      </section>

      <section class="panel settings-section" aria-labelledby="rules-title">
        <header class="panel__header"><h2 id="rules-title">${icon('info')} If a payment fails</h2></header>
        <ul class="plain-list">
          <li>A warning appears and a <strong>7-day grace period</strong> starts. Publishing keeps working during the grace period.</li>
          <li>If the payment is still not fixed when the grace period ends, or the subscription is canceled on request, <strong>publishing pauses</strong>: no new vehicles or photos go to the public website, public listings can’t be changed, and vehicles can’t be put back to Available.</li>
          <li>While publishing is paused you can still <strong>mark vehicles Sold</strong>, move them from Available to Pending, <strong>unpublish</strong> them or <strong>archive</strong> them, so the public website never advertises a car that is gone.</li>
          <li>Nothing is deleted: vehicles, photos, employees, sign-in and activity history stay, and private details can still be edited.</li>
          <li>Publishing resumes automatically as soon as Stripe confirms a successful payment.</li>
          <li><strong>Cancel Plan</strong> ends the plan at the end of the paid period; until then everything keeps working, and <strong>Resume Plan</strong> undoes it.</li>
        </ul>
      </section>

      ${supportPanel()}
    </div>`);
}

function supportPanel() {
  const mail = service ? supportMailto(service, 'Billing Question') : `mailto:${SUPPORT.email}?subject=${encodeURIComponent(SUPPORT.subject)}`;
  return html`
    <section class="panel settings-section" aria-labelledby="support-title" data-support>
      <header class="panel__header"><h2 id="support-title">${icon('mail')} ${SUPPORT.company} support</h2></header>
      <p class="muted">This inventory manager and the public website are a managed service provided and supported by ${SUPPORT.company}.</p>
      <dl class="kv">
        <div><dt>Company</dt><dd>${SUPPORT.company}</dd></div>
        <div><dt>Website</dt><dd><a href="${SUPPORT.website}" target="_blank" rel="noopener noreferrer">${SUPPORT.websiteLabel}</a></dd></div>
        <div><dt>Support email</dt><dd><a href="${mail}" data-support-email>${SUPPORT.email}</a></dd></div>
        ${service ? html`<div><dt>Your references</dt><dd>Client ID <span class="mono">${service.clientId}</span> · Project ID <span class="mono">${service.projectId}</span></dd></div>` : ''}
      </dl>
      <div class="btn-row"><a class="btn btn--ghost" href="settings.html#support" data-contact-support>${icon('mail')}Contact Light Astra Support</a></div>
    </section>`;
}

/** After Cancel/Resume, Stripe's webhook updates the status a moment later: watch for it briefly. */
async function waitFor(done) {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => { window.setTimeout(resolve, 2000); });
    await load({ fresh: true });
    if (!status) return false;          // loading failed: stop instead of repeating errors
    if (done(status)) return true;
  }
  return false;
}

async function changePlan(action) {
  const s = status;
  const ok = action === 'cancel'
    ? await confirmDialog({
      title: 'Cancel the managed service plan?',
      message: s.state === 'past_due'
        ? `The plan will end on ${formatLongDate(s.currentPeriodEnd)}. Because the last payment failed, publishing still pauses on ${formatLongDate(s.gracePeriodEnd)} unless the payment is fixed first.`
        : `The plan stays active until ${formatLongDate(s.currentPeriodEnd)}. After that date, publishing pauses until a new plan is set up.`,
      detail: 'Nothing is deleted: vehicles, photos, employees and history stay. You can resume the plan any time before that date.',
      confirmLabel: 'Cancel Plan',
      cancelLabel: 'Keep Plan',
      tone: 'danger'
    })
    : await confirmDialog({
      title: 'Resume the plan?',
      message: `The scheduled cancellation is removed and billing continues as normal (${priceLabel(s)}).`,
      confirmLabel: 'Resume Plan',
      cancelLabel: 'Not now'
    });
  if (!ok) return;
  let result;
  try {
    result = action === 'cancel' ? await billingService.cancelPlan() : await billingService.resumePlan();
  } catch (err) {
    toastError(err.message);
    return;
  }
  changing = true;
  render();
  try {
    if (result.alreadyDone) toast('Stripe already has this change. The page updates as soon as Stripe’s confirmation arrives.', { tone: 'info' });
    else toast(action === 'cancel' ? 'Cancellation requested. Confirming with Stripe…' : 'Resume requested. Confirming with Stripe…', { tone: 'info' });
    const confirmed = await waitFor((now) => (action === 'cancel' ? Boolean(now.cancelAt) : !now.cancelAt));
    if (confirmed) toast(action === 'cancel' ? `Plan set to end on ${formatLongDate(status.cancelAt)}.` : 'Plan resumed.');
    else toast('Stripe is still confirming the change. Reload in a minute to see it.', { tone: 'warning' });
  } finally {
    changing = false;
  }
}

async function load({ fresh = false } = {}) {
  try {
    status = await billingService.getStatus({ fresh });
    service = await lightAstraService.getOverview({ fresh }).catch(() => null);
  } catch (err) {
    status = null;
    toastError(err.message);
  }
  render();
}

/** After Checkout, the webhook may land a few seconds later: watch for it briefly. */
async function waitForActivation() {
  confirming = true;
  for (let i = 0; i < 16; i++) {
    if (status && status.state === 'active') {
      confirming = false;
      notice = service && service.service !== 'ACTIVE'
        ? { tone: 'info', text: 'Payment confirmed by Stripe. The service starts automatically once the remaining setup items below are complete.' }
        : { tone: 'ok', text: 'Payment set up. The managed service is active.' };
      render();
      return;
    }
    await new Promise((resolve) => { window.setTimeout(resolve, 2500); });
    await load({ fresh: true });
  }
  // Still not confirmed: keep "Set Up Payment" hidden; a reload shows the real state.
  notice = { tone: 'warn', text: 'Stripe is still confirming the payment. This page will show Active within a few minutes — reload to check.' };
  render();
}

function bind() {
  bindSignedCopy(qs('#main'));
  qs('#main').addEventListener('click', async (event) => {
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
    const button = event.target.closest('[data-billing]');
    if (!button || button.disabled) return;
    if (button.dataset.billing === 'cancel' || button.dataset.billing === 'resume') {
      button.disabled = true;
      try { await changePlan(button.dataset.billing); } finally { button.disabled = false; render(); }
      return;
    }
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Opening Stripe…';
    try {
      if (button.dataset.billing === 'checkout') await billingService.openCheckout();
      else await billingService.openPortal();
    } catch (err) {
      toastError(err.message || 'Billing is temporarily unavailable. Please try again in a moment.');
      button.disabled = false;
      button.innerHTML = label;
    }
  });
}

function renderEmployeeRefusal() {
  setHtml(qs('#main'), html`
    <div class="page__inner page__inner--narrow">
      <header class="page-header"><div><p class="page-header__eyebrow">Managed service</p><h1>Billing</h1></div></header>
      <section class="empty-state" data-billing-refused>
        <span class="empty-state__icon">${icon('lock')}</span>
        <h2>Billing is managed by an Admin</h2>
        <p>Only a Cela Admin can view or change the managed service plan.</p>
        <div class="btn-row btn-row--center"><a class="btn btn--ghost" href="dashboard.html">${icon('dashboard')}Back to Dashboard</a></div>
      </section>
    </div>`);
}

initLayout({ page: 'billing', title: 'Billing' }).then(async () => {
  if (!authService.can('billing.manage')) {
    renderEmployeeRefusal();   // the database also returns billing details to Admins only
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  const fromPortal = params.has('portal');
  if (checkout || fromPortal) window.history.replaceState(null, '', 'billing.html');
  if (checkout === 'canceled') notice = { tone: 'info', text: 'Checkout was canceled. No payment was taken.' };
  if (checkout === 'success') {
    notice = { tone: 'warn', text: 'Back from Stripe. Waiting for Stripe to confirm the payment…' };
    confirming = true;
  }
  await load({ fresh: true });
  bind();
  if (checkout === 'success') await waitForActivation();
}).catch(handlePageError);
