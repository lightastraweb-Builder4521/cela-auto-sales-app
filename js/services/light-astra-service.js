/* ==========================================================================
   Light Astra service record — Client ID, Project ID, plan, agreement, policy
   acknowledgment and support requests.
   --------------------------------------------------------------------------
   This file decides NOTHING. The database holds every state separately
   (contract, policy, payment, subscription, project, public website, app
   entitlement) and works out the entitlement itself
   (supabase/migrations/20261004000001_light_astra_service.sql). The agreement is
   signed through a database function that records the signed-in Admin; payment
   happens on Stripe's pages and counts only when Stripe's verified webhook says so.

   Client ID and Project ID are record identifiers for support and records.
   They are not passwords and never grant access.
   ========================================================================== */
import { APP, SUPPORT } from '../config.js';
import { getSupabase } from '../data/supabase-client.js';

export class ServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const SERVICE_STATE_LABELS = Object.freeze({
  ACTIVE: 'Active',
  PENDING_ACTIVATION: 'Pending Activation',
  SUSPENDED: 'Suspended'
});

export const SUBSCRIPTION_LABELS = Object.freeze({
  ACTIVE: 'Active',
  PAST_DUE: 'Past Due',
  CANCELS_AT_PERIOD_END: 'Cancels at Period End',
  CANCELLED: 'Cancelled',
  NOT_STARTED: 'Not started',
  INCOMPLETE: 'Payment incomplete',
  INCOMPLETE_EXPIRED: 'Payment not completed',
  PAUSED: 'Paused'
});

export const PAYMENT_LABELS = Object.freeze({ PAID: 'Paid', REQUIRED: 'Required', PAST_DUE: 'Past Due', INCOMPLETE: 'Incomplete' });

/* Support request categories (codes are what the database stores). */
export const SUPPORT_CATEGORIES = Object.freeze([
  ['BUG', 'Bug / Something Broken'],
  ['CONTENT_UPDATE', 'Content Update'],
  ['DESIGN_CHANGE', 'Design Change'],
  ['NEW_FEATURE', 'Add New Feature'],
  ['SECURITY_ISSUE', 'Security Issue'],
  ['BILLING_QUESTION', 'Billing Question'],
  ['UPGRADE_PLAN', 'Upgrade Plan'],
  ['DOWNGRADE_PLAN', 'Downgrade Plan'],
  ['CANCEL_PLAN', 'Cancel Plan'],
  ['HOSTING_DOMAIN', 'Hosting / Domain'],
  ['MAINTENANCE', 'Maintenance'],
  ['OTHER', 'Other']
]);

export const SUPPORT_SECURITY_NOTE = 'Never include passwords, recovery codes, API keys, private keys or card numbers. Light Astra never needs them.';

/** "1–5", "21+" */
export function employeeBand(plan) {
  if (!plan) return '';
  return plan.maxEmployees ? `${plan.minEmployees}–${plan.maxEmployees}` : `${plan.minEmployees}+`;
}

/** "$35/month" (or "from $100/month" for a custom-priced tier) */
export function planPrice(plan) {
  if (!plan) return '';
  const amount = (plan.monthlyAmountCents / 100).toLocaleString('en-US', {
    style: 'currency', currency: String(plan.currency || 'usd').toUpperCase(), minimumFractionDigits: plan.monthlyAmountCents % 100 ? 2 : 0
  });
  return `${plan.priceIsMinimum ? 'from ' : ''}${amount}/month`;
}

/** Subject line Light Astra support uses to find the project: IDs first. */
export function supportMailto(overview, topic = '') {
  const ids = overview ? `${overview.clientId} / ${overview.projectId}` : '';
  const subject = `[LIGHT ASTRA SUPPORT] ${ids}${ids && topic ? ' — ' : ''}${topic || (ids ? '' : SUPPORT.subject)}`.trim();
  return `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}`;
}

function describe(error, fallback) {
  // Plain-language refusals written by the database itself.
  if (error && /^PT4(03|09|22|29)$/.test(String(error.code || '')) && error.message) return error.message;
  return fallback;
}

function mapOverview(row) {
  const plan = row.plan ? {
    code: row.plan.code,
    name: row.plan.name,
    minEmployees: row.plan.min_employees,
    maxEmployees: row.plan.max_employees,
    monthlyAmountCents: row.plan.monthly_amount_cents,
    currency: row.plan.currency,
    priceIsMinimum: row.plan.price_is_minimum === true
  } : null;
  return {
    clientName: row.client_name,
    clientId: row.client_id,
    projectId: row.project_id,
    service: row.service,                                   // ACTIVE | PENDING_ACTIVATION | SUSPENDED
    serviceLabel: SERVICE_STATE_LABELS[row.service] || row.service,
    onboardingRequired: row.onboarding_required === true,   // agreement or policy still to be accepted
    isAdmin: row.is_admin === true,
    // Admin only (absent for employees):
    plan,
    contract: row.contract ? {
      status: row.contract.status, agreementId: row.contract.agreement_id, version: row.contract.version,
      signedAt: row.contract.signed_at, signedName: row.contract.signed_name
    } : null,
    policy: row.policy ? { version: row.policy.version, status: row.policy.status, acceptedAt: row.policy.accepted_at } : null,
    payment: row.payment || null,
    subscription: row.subscription || null,
    planMatches: row.subscription_plan_matches !== false,
    project: row.project || null,
    publicWebsite: row.public_website || null,
    release: row.release || null,
    waitingFor: Array.isArray(row.waiting_for) ? row.waiting_for : []
  };
}

let cache = null;

export const lightAstraService = {
  /** Applies to the shared Supabase backend only (not local development mode). */
  get enabled() { return APP.backend === 'supabase'; },

  /** Who this client is for Light Astra and whether the service is on. null in local mode. Cached briefly. */
  async getOverview({ fresh = false } = {}) {
    if (!this.enabled) return null;
    if (!fresh && cache && Date.now() - cache.at < 15000) return cache.promise;
    const promise = (async () => {
      const { data, error } = await getSupabase().rpc('service_overview');
      if (error) throw new ServiceError(describe(error, 'Couldn’t load the Light Astra service details. Check your internet connection and try again.'));
      return data ? mapOverview(data) : null;
    })();
    const entry = { at: Date.now(), promise };
    cache = entry;
    promise.catch(() => { if (cache === entry) cache = null; });
    return promise;
  },

  /** Admin: the agreement to sign (or the signed one) and the Service Policies. */
  async getAgreement() {
    const { data, error } = await getSupabase().rpc('service_agreement_current');
    if (error) throw new ServiceError(describe(error, 'Couldn’t load the agreement. Please try again.'));
    if (!data || !data.agreement) return null;
    const a = data.agreement;
    const p = data.policy || {};
    return {
      agreementId: a.agreement_id, title: a.title, version: a.version, body: a.body, sha256: a.sha256, status: a.status,
      sentAt: a.sent_at, viewedAt: a.viewed_at, signedAt: a.signed_at, signedName: a.signed_name, signedEmail: a.signed_email,
      signedRole: a.signed_role || null,
      clientId: a.client_id, projectId: a.project_id,
      termsCurrent: a.terms_current !== false,          // false: the plan changed; Light Astra issues an updated agreement
      legalReviewStatus: a.legal_review_status || 'REQUIRES_LEGAL_REVIEW',
      // What the agreement was issued with (older agreements have no such record): names, plan, price as shown.
      terms: a.terms ? {
        clientName: a.terms.client_legal_name || a.terms.client_name, projectName: a.terms.project_name,
        planName: a.terms.plan_name, employeeBand: a.terms.employee_band, monthlyPrice: a.terms.monthly_price, currency: a.terms.currency
      } : null,
      // Client/application-specific policy modules attached to this agreement.
      modules: (Array.isArray(a.modules) ? a.modules : []).map((m) => ({ version: m.version, title: m.title, body: m.body, sha256: m.sha256 })),
      provider: data.provider ? {
        name: data.provider.name, website: data.provider.website, email: data.provider.email, tagline: data.provider.tagline || '', logoUrl: data.provider.logo_url || ''
      } : null,
      policy: { version: p.version, title: p.title, body: p.body, sha256: p.sha256, acceptedAt: p.accepted_at, acceptedName: p.accepted_name }
    };
  },

  /**
   * Admin: the signed copy (PDF) of the current agreement, or of an earlier one by id. Built by the server from the
   * signed record. The first request also records the copy and emails it to the signer's registered address;
   * emailStatus says what became of that email (SENT only once the mail server accepted it).
   */
  async getSignedCopy(agreementId) {
    const { data, error } = await getSupabase().functions.invoke('agreement-document', { body: agreementId ? { action: 'copy', agreement_id: agreementId } : { action: 'copy' } });
    if (error || !data || typeof data.pdf_base64 !== 'string') {
      let message = 'The signed copy is temporarily unavailable. Please try again in a moment.';
      try {
        const body = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
        if (body && typeof body.message === 'string' && body.message.length < 240) message = body.message;
      } catch (err) { /* keep the generic message */ }
      throw new ServiceError(message);
    }
    const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
    return { fileName: data.file_name, blob: new Blob([bytes], { type: 'application/pdf' }), sha256: data.sha256, emailStatus: data.email_status, first: data.first === true };
  },

  /** Admin opened the agreement (SENT → VIEWED). Never blocks the page. */
  async markViewed(agreementId) {
    try { await getSupabase().rpc('service_agreement_mark_viewed', { p_agreement_id: agreementId }); } catch (err) { /* informational only */ }
  },

  /** Electronic acceptance by the signed-in Admin. The database checks everything again. */
  async sign({ agreementId, sha256, policyVersion, signedName, agree, acknowledgePolicy }) {
    const { data, error } = await getSupabase().rpc('service_agreement_sign', {
      p_agreement_id: agreementId, p_agreement_sha256: sha256, p_policy_version: policyVersion,
      p_signed_name: signedName, p_agree: agree === true, p_acknowledge_policy: acknowledgePolicy === true
    });
    if (error) throw new ServiceError(describe(error, 'Couldn’t record the signature. Please try again.'));
    cache = null;
    return data ? mapOverview(data) : null;
  },

  /** A newer Service Policies version on an already signed agreement. */
  async acceptPolicy({ policyVersion, acknowledge }) {
    const { data, error } = await getSupabase().rpc('service_policy_accept', { p_policy_version: policyVersion, p_acknowledge: acknowledge === true });
    if (error) throw new ServiceError(describe(error, 'Couldn’t record the acknowledgment. Please try again.'));
    cache = null;
    return data ? mapOverview(data) : null;
  },

  /** Support request. The database adds the Client ID, Project ID, the signed-in account and the time. */
  async createSupportRequest({ category, message }) {
    const { data, error } = await getSupabase().from('support_requests')
      .insert({ category, message }).select('reference, category, created_at').single();
    if (error) throw new ServiceError(describe(error, 'Couldn’t send the request. Please try again, or email Light Astra.'));
    return { reference: data.reference, category: data.category, createdAt: data.created_at };
  },

  /** Own requests (Admins see everyone's). Newest first. */
  async listSupportRequests() {
    const { data, error } = await getSupabase().from('support_requests')
      .select('reference, category, created_at, created_by_name, status').order('created_at', { ascending: false }).limit(10);
    if (error) return [];
    return (data || []).map((r) => ({ reference: r.reference, category: r.category, createdAt: r.created_at, createdByName: r.created_by_name, status: r.status }));
  }
};
