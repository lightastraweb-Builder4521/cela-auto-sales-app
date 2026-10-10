/* ==========================================================================
   Billing — Light Astra Managed App Service
   --------------------------------------------------------------------------
   Read-only status for the Private app, plus the two Stripe-hosted pages an
   Admin can open (Checkout to set up payment, Customer Portal to manage it).

   This file decides NOTHING. The database enforces the publishing rules
   (supabase/migrations/20261003000001_billing_gate.sql) and the billing state
   is written only by the verified Stripe webhook. Card details are typed on
   Stripe's own pages, never into this app.
   ========================================================================== */
import { APP, SUPPORT } from '../config.js';
import { getSupabase } from '../data/supabase-client.js';

/** Shown whenever the database refuses a public change because billing is inactive. */
export const PUBLISHING_BLOCKED_MESSAGE = 'Publishing is temporarily unavailable because the managed service subscription is inactive.';
/** Shown when new photo files can't be stored because billing is inactive (same wording as the database). */
export const UPLOADS_PAUSED_MESSAGE = 'New photo uploads are paused because the Light Astra Managed App Service is inactive.';

export class BillingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BillingError';
  }
}

export const BILLING_STATE_LABELS = Object.freeze({
  setup_required: 'Payment setup needed',
  setup_incomplete: 'Payment setup incomplete',
  active: 'Active',
  past_due: 'Past Due',
  suspended: 'Suspended',
  canceled: 'Canceled'
});

/** True when an error (from any Supabase call) is the database's billing refusal. */
export function isPublishingBlockedError(error) {
  const text = String((error && (error.message || error.error)) || '');
  return Boolean(error && (error.code === 'PT402' || /managed service subscription is inactive/i.test(text)));
}

function mapStatus(row) {
  return {
    serviceName: row.service_name,
    amountCents: row.plan_amount_cents,
    currency: row.plan_currency,
    interval: row.plan_interval,
    stripeStatus: row.subscription_status,
    state: row.display_state,
    stateLabel: BILLING_STATE_LABELS[row.display_state] || row.display_state,
    publishingAvailable: row.publishing_available === true,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    cancelAt: row.cancel_at,
    gracePeriodEnd: row.grace_period_end,
    hasBillingAccount: row.has_billing_account === true,
    testMode: row.livemode === false,
    updatedAt: row.updated_at
  };
}

let cache = null;
let pausedCache = null;

export const billingService = {
  /** Billing applies to the shared Supabase backend only (not local development mode). */
  get enabled() { return APP.backend === 'supabase'; },

  /** Current status, or null in local mode / when no billing record is visible. Cached briefly. */
  async getStatus({ fresh = false } = {}) {
    if (!this.enabled) return null;
    if (!fresh && cache && Date.now() - cache.at < 15000) return cache.promise;
    const promise = (async () => {
      const { data, error } = await getSupabase().from('billing_status').select('*').maybeSingle();
      if (error) throw new BillingError('Couldn’t load the billing status. Check your internet connection and try again.');
      return data ? mapStatus(data) : null;
    })();
    const entry = { at: Date.now(), promise };
    cache = entry;
    promise.catch(() => { if (cache === entry) cache = null; });
    return promise;
  },

  /**
   * UI hint only (the database decides): is publishing currently paused by billing?
   * Uses public.publishing_status, the one billing-related value every employee may read
   * (billing details themselves are Admin-only).
   */
  async publishingBlocked({ fresh = false } = {}) {
    if (!this.enabled) return false;
    if (!fresh && pausedCache && Date.now() - pausedCache.at < 15000) return pausedCache.value;
    try {
      const { data, error } = await getSupabase().from('publishing_status').select('publishing_available').maybeSingle();
      const value = !error && Boolean(data) && data.publishing_available === false;
      pausedCache = { at: Date.now(), value };
      return value;
    } catch (err) {
      return false;
    }
  },

  /**
   * Admin: go to Stripe Checkout for the contracted plan. The server refuses ("Agreement Required")
   * until the agreement is signed and the Service Policies are acknowledged.
   * returnTo: 'billing' (default) or 'onboarding' — the page Stripe sends the browser back to.
   */
  openCheckout({ returnTo = 'billing' } = {}) { return openStripePage('checkout', { returnTo }); },

  /** Admin: go to the Stripe Customer Portal. */
  openPortal() { return openStripePage('portal'); },

  /** Admin: Cancel Plan — the plan ends at the end of the paid period (Stripe confirms through the webhook). */
  cancelPlan() { return invokeBilling('cancel'); },

  /** Admin: Resume Plan — undo a scheduled cancellation before it takes effect. */
  resumePlan() { return invokeBilling('resume'); }
};

const UNAVAILABLE = `Billing is temporarily unavailable. Please try again in a moment, or contact ${SUPPORT.company} support at ${SUPPORT.email}.`;

async function invokeBilling(action, extra = {}) {
  const { data, error } = await getSupabase().functions.invoke('billing-session', { body: { ...extra, action } });
  if (error) {
    let message = UNAVAILABLE;
    try {
      const body = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
      if (body && typeof body.message === 'string' && body.message.length < 240) message = body.message;
    } catch (err) { /* keep the generic message */ }
    throw new BillingError(message);
  }
  return data || {};
}

async function openStripePage(action, extra) {
  const data = await invokeBilling(action, extra);
  const url = typeof data.url === 'string' ? data.url : '';
  // Only ever leave the app for Stripe's own hosted pages.
  if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)) throw new BillingError(UNAVAILABLE);
  window.location.assign(url);
}
