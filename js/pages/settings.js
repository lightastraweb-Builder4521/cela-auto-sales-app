/* Settings: dealership profile, system status, the Light Astra service record (Client ID,
   Project ID, plan, service state), Privacy & Security (own account, change password, sign out,
   Light Astra support + support requests), preferences, and development data tools (Admin only). */
import { APP, DEALERSHIP, RULES, SUPPORT, PASSWORD_RULES } from '../config.js';
import { html, qs, setHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { formatBytes, formatNumber, formatDateTime } from '../utils/format.js';
import { getPref, setPref } from '../utils/misc.js';
import { initLayout, handlePageError, applyTheme, refreshNavCounts } from '../ui/layout.js';
import { getRepository } from '../data/repository.js';
import { authService, ROLE_LABELS } from '../services/auth-service.js';
import { vehicleService } from '../services/vehicle-service.js';
import { publicListingService } from '../services/public-listing-service.js';
import {
  lightAstraService, SERVICE_STATE_LABELS, SUPPORT_CATEGORIES, SUPPORT_SECURITY_NOTE, employeeBand, planPrice, supportMailto
} from '../services/light-astra-service.js';
import { typedConfirmDialog, confirmDialog } from '../ui/dialogs.js';
import { toast, toastError } from '../ui/toast.js';
import { bindSignedCopy } from '../ui/signed-copy.js';

function statusRow(label, value, tone, detail) {
  return html`
    <div class="sys-row">
      <dt>${label}</dt>
      <dd><span class="sys-pill sys-pill--${tone}">${value}</span>${detail ? html`<span class="sys-row__detail">${detail}</span>` : ''}</dd>
    </div>`;
}

async function render() {
  const user = authService.getCurrentUser();
  const isAdmin = authService.can('data.manage');
  const connected = APP.backend === 'supabase';
  const repo = getRepository();
  const [estimate, vehicles, publicFeed] = await Promise.all([repo.storageEstimate(), vehicleService.getVehicles(), publicListingService.getPublicInventory()]);
  // Light Astra service record (shared backend only). Never blocks Settings.
  const service = await lightAstraService.getOverview().catch(() => null);
  const requests = service ? await lightAstraService.listSupportRequests() : [];
  const categoryLabel = Object.fromEntries(SUPPORT_CATEGORIES);
  const idRow = (label, value, attr) => html`
    <div class="sys-row"><dt>${label}</dt><dd><span class="id-value"><code ${attr}>${value}</code><button type="button" class="btn btn--sm btn--ghost" data-copy="${value}" data-copy-label="${label}">${icon('copy')}Copy</button></span></dd></div>`;
  const demoCount = vehicles.filter((v) => v.isDemo).length;
  const theme = getPref('theme', 'dark');
  const view = getPref('inventoryView', 'table');

  setHtml(qs('#main'), html`
    <div class="page__inner page__inner--narrow">
      <header class="page-header">
        <div>
          <h1>Settings</h1>
          <p class="page-header__sub">Dealership profile, system status and preferences.</p>
        </div>
      </header>

      <section class="panel settings-section" id="system" aria-labelledby="system-title">
        <header class="panel__header"><h2 id="system-title">${icon('database')} System status</h2></header>
        ${connected ? html`
          <p class="muted">Connected to the shared Cela database. Every employee sees the same inventory, and the public website reads from it.</p>
          <dl class="sys">
            ${statusRow('Backend', 'Connected', 'ok', 'Supabase database — shared by all employees.')}
            ${statusRow('Authentication', 'Supabase Auth', 'ok', 'Employee email + password. Permissions are enforced by the database.')}
            ${statusRow('Public sync', 'Live', 'ok', `${formatNumber(publicFeed.length, '0')} vehicle${publicFeed.length === 1 ? '' : 's'} currently visible to customers.`)}
            ${statusRow('Storage', 'Supabase Storage', 'ok', 'Photos are stored in the private “vehicle-photos” bucket. Originals are never public.')}
          </dl>` : html`
          <p class="muted">Local development mode. Everything runs in this browser — nothing is shared or published.</p>
          <dl class="sys">
            ${statusRow('Backend', 'Not connected', 'neutral', 'Local development mode (js/config.js → BACKEND).')}
            ${statusRow('Supabase status', 'Not connected', 'neutral', 'Not used in local mode.')}
            ${statusRow('Authentication', 'Development mode', 'warn', 'Local development login — not secure.')}
            ${statusRow('Public sync', 'Not connected', 'neutral', `${formatNumber(publicFeed.length, '0')} vehicle${publicFeed.length === 1 ? '' : 's'} would be visible if it were connected.`)}
            ${statusRow('Storage', 'Local development', 'neutral', `IndexedDB in this browser${estimate && estimate.usage ? ` · about ${formatBytes(estimate.usage)} used` : ''}. Data here isn’t shared with other devices.`)}
          </dl>`}
      </section>

      <section class="panel settings-section" aria-labelledby="profile-title">
        <header class="panel__header"><h2 id="profile-title">${icon('car')} Dealership profile</h2><span class="muted">Read-only</span></header>
        <dl class="kv">
          <div><dt>Business name</dt><dd>${DEALERSHIP.name}</dd></div>
          <div><dt>Address</dt><dd>${DEALERSHIP.street}<br>${DEALERSHIP.city}, ${DEALERSHIP.region}</dd></div>
          <div><dt>Phone</dt><dd><a href="${DEALERSHIP.phoneHref}">${DEALERSHIP.phoneDisplay}</a></dd></div>
          <div><dt>Email</dt><dd><a href="mailto:${DEALERSHIP.email}">${DEALERSHIP.email}</a></dd></div>
          <div><dt>Facebook</dt><dd><a href="${DEALERSHIP.facebook}" target="_blank" rel="noopener noreferrer" class="break">${DEALERSHIP.facebook}</a></dd></div>
        </dl>
        <p class="muted">The dealership profile is read-only here. It is part of the website’s content and is changed by the site developer.</p>
      </section>

      ${service ? html`
      <section class="panel settings-section" id="service" aria-labelledby="service-title" data-light-astra-service>
        <header class="panel__header"><h2 id="service-title">${icon('info')} Light Astra Service</h2></header>
        <dl class="sys">
          <div class="sys-row"><dt>Client</dt><dd data-service-client>${service.clientName}</dd></div>
          ${idRow('Client ID', service.clientId, html`data-client-id`)}
          ${idRow('Project ID', service.projectId, html`data-project-id`)}
          ${service.plan ? html`<div class="sys-row"><dt>Plan</dt><dd><strong data-service-plan>${service.plan.name}</strong><span class="sys-row__detail">${planPrice(service.plan)} · ${employeeBand(service.plan)} employees</span></dd></div>` : ''}
          <div class="sys-row"><dt>Service</dt><dd><span class="sys-pill sys-pill--${service.service === 'ACTIVE' ? 'ok' : service.service === 'SUSPENDED' ? 'danger' : 'warn'}" data-service-state="${service.service}">${SERVICE_STATE_LABELS[service.service] || service.service}</span></dd></div>
        </dl>
        <p class="muted">Quote your Client ID and Project ID when you contact ${SUPPORT.company} Support. They identify your account and project in ${SUPPORT.company}’s records; they are not passwords and give no access.</p>
        ${authService.can('billing.manage') ? html`<div class="btn-row"><a class="btn btn--ghost" href="billing.html">${icon('card')}Billing</a><a class="btn btn--ghost" href="onboarding.html?view=agreement" data-view-agreement>${icon('file')}View Agreement</a>${service.contract && service.contract.status === 'SIGNED' ? html`<button type="button" class="btn btn--ghost" data-signed-copy="download">${icon('file')}Download Signed Copy</button>` : ''}</div>` : ''}
      </section>` : ''}

      <section class="panel settings-section" id="account" aria-labelledby="account-title" data-privacy-security>
        <header class="panel__header"><h2 id="account-title">${icon('lock')} Privacy &amp; Security</h2></header>
        <dl class="kv">
          <div><dt>Account email</dt><dd data-account-email>${user.email || (connected ? '—' : 'Development login (no email)')}</dd></div>
          <div><dt>Account role</dt><dd data-account-role>${ROLE_LABELS[user.role]}</dd></div>
          <div><dt>Name</dt><dd>${user.displayName}</dd></div>
        </dl>

        ${connected ? html`
          <form class="form security-form" data-password-form novalidate aria-labelledby="password-title">
            <h3 id="password-title">Change password</h3>
            <input type="text" name="username" autocomplete="username" value="${user.email || ''}" class="visually-hidden" tabindex="-1" aria-hidden="true" readonly>
            <div class="form-grid">
              <div class="field">
                <label class="field__label" for="new-password">New password</label>
                <input class="input" type="password" id="new-password" name="new-password" autocomplete="new-password">
              </div>
              <div class="field">
                <label class="field__label" for="confirm-password">Confirm new password</label>
                <input class="input" type="password" id="confirm-password" name="confirm-password" autocomplete="new-password">
              </div>
            </div>
            <p class="field__hint">At least ${PASSWORD_RULES.minLength} characters. This changes the password of your own account only; you stay signed in on this device.</p>
            <p class="form-alert" data-password-error role="alert" hidden></p>
            <div class="btn-row"><button type="submit" class="btn btn--primary" data-password-submit>${icon('lock')}Change Password</button></div>
          </form>` : html`<p class="page-note">${icon('info')} Password changes work when the app is connected to the shared database.</p>`}

        <div class="settings-subsection">
          <h3 class="settings-subhead">Sign out</h3>
          <p class="muted">Signs you out of this device. You’ll need your email and password to sign in again.</p>
          <div class="btn-row"><button type="button" class="btn btn--ghost" data-logout data-settings-signout>${icon('logout')}Sign Out</button></div>
        </div>

        <div class="settings-subsection" id="support" aria-labelledby="support-title">
          <h3 class="settings-subhead" id="support-title">${SUPPORT.company} support</h3>
          <p class="muted">This system is a managed service provided by ${SUPPORT.company}. For help, changes or account questions, contact ${SUPPORT.company}.</p>
          <dl class="kv">
            <div><dt>Company</dt><dd>${SUPPORT.company}</dd></div>
            <div><dt>Website</dt><dd><a href="${SUPPORT.website}" target="_blank" rel="noopener noreferrer">${SUPPORT.websiteLabel}</a></dd></div>
            <div><dt>Support email</dt><dd><a href="${service ? supportMailto(service) : `mailto:${SUPPORT.email}?subject=${encodeURIComponent(SUPPORT.subject)}`}" data-support-email>${SUPPORT.email}</a></dd></div>
            ${service ? html`<div><dt>Client ID</dt><dd class="mono" data-support-client-id>${service.clientId}</dd></div>
            <div><dt>Project ID</dt><dd class="mono" data-support-project-id>${service.projectId}</dd></div>` : ''}
          </dl>
          ${service ? html`
          <form class="support-form" data-support-form novalidate aria-labelledby="support-request-title">
            <h3 class="settings-subhead" id="support-request-title">Send a support request</h3>
            <div class="field">
              <label class="field__label" for="support-category">What do you need?</label>
              <select class="select" id="support-category" name="category">
                ${SUPPORT_CATEGORIES.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="support-message">Message</label>
              <textarea class="textarea" id="support-message" name="message" rows="4" maxlength="4000" aria-describedby="support-warning"></textarea>
              <p class="field__hint" id="support-warning" data-support-warning>${icon('lock')} ${SUPPORT_SECURITY_NOTE}</p>
            </div>
            <p class="muted small">Your Client ID, Project ID, account and the time are added automatically. Plan upgrades, downgrades and cancellations are requests: ${SUPPORT.company} confirms any change with you before it happens.</p>
            <p class="form-alert" data-support-error role="alert" hidden></p>
            <div class="btn-row"><button type="submit" class="btn btn--primary" data-support-submit>${icon('mail')}Send Request</button></div>
          </form>
          ${requests.length ? html`
          <div class="settings-subsection" data-support-recent>
            <h3 class="settings-subhead">Recent requests</h3>
            <ul class="plain-list">
              ${requests.map((r) => html`<li><span class="mono">${r.reference}</span> · ${categoryLabel[r.category] || r.category} · ${formatDateTime(r.createdAt)}${r.createdByName ? ` · ${r.createdByName}` : ''}</li>`)}
            </ul>
          </div>` : ''}` : ''}
        </div>

        <div class="roles">
          <div><strong>Admin</strong><span>Full dealership management, including permanent delete, billing and data tools.</span></div>
          <div><strong>Employee</strong><span>Day-to-day inventory: add, edit, photos, publish, pending, sold, archive. Own password only.</span></div>
        </div>
      </section>

      <section class="panel settings-section" aria-labelledby="prefs-title">
        <header class="panel__header"><h2 id="prefs-title">${icon('settings')} Preferences</h2><span class="muted">Saved in this browser</span></header>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="pref-theme">Theme</label>
            <select class="select" id="pref-theme">
              <option value="dark" ${theme === 'dark' ? html`selected` : ''}>Dark (Cela brand)</option>
              <option value="light" ${theme === 'light' ? html`selected` : ''}>Light (easier outdoors)</option>
              <option value="system" ${theme === 'system' ? html`selected` : ''}>Match device</option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="pref-view">Inventory layout</label>
            <select class="select" id="pref-view">
              <option value="table" ${view === 'table' ? html`selected` : ''}>Table</option>
              <option value="grid" ${view === 'grid' ? html`selected` : ''}>Grid</option>
            </select>
          </div>
        </div>
      </section>

      <section class="panel settings-section" aria-labelledby="public-title">
        <header class="panel__header"><h2 id="public-title">${icon('globe')} Public site rules</h2></header>
        <ul class="plain-list">
          <li>Sold vehicles leave the public website <strong>immediately</strong>. They stay in Sold History for <strong>${RULES.soldRetentionDays} days</strong>, then are permanently deleted with their photos unless restored.</li>
          <li>Only published Available / Pending vehicles are ever sent to customers. Drafts stay private as long as you like — they are never deleted automatically.</li>
          <li>Publish Now, or schedule publication for a date and time (${DEALERSHIP.timeZoneLabel}). A scheduled vehicle stays private until then and is checked again before it goes public; while the managed service is inactive it waits.</li>
          <li>Internal cost, source, reconditioning, sold price and notes are never sent.</li>
        </ul>
      </section>

      <section class="panel settings-section" aria-labelledby="employees-title">
        <header class="panel__header"><h2 id="employees-title">${icon('user')} Employee accounts</h2></header>
        <p class="muted">${connected
          ? `Employee logins are created by ${SUPPORT.company} on request, each with an Admin or Employee role. Customers cannot sign up, and every employee manages their own password under Privacy & Security.`
          : 'Local development mode uses the two generic development identities.'}</p>
      </section>

      ${APP.environment === 'development' ? html`
        <section class="panel settings-section panel--dev" aria-labelledby="dev-title">
          <header class="panel__header"><h2 id="dev-title">${icon('flask')} Development data</h2><span class="badge badge--demo">Development only</span></header>
          <p class="muted">Demo vehicles are clearly marked “Demo”, use DEMO-### stock numbers, and are never sent to the public site.</p>
          <p><strong>${formatNumber(vehicles.length, '0')}</strong> vehicles stored locally · <strong>${formatNumber(demoCount, '0')}</strong> demo</p>
          ${isAdmin ? html`
            <div class="btn-row">
              <button type="button" class="btn btn--ghost" data-load-demo ${demoCount ? html`disabled` : ''}>${icon('flask')}Load Demo Data</button>
              <button type="button" class="btn btn--ghost" data-clear-demo ${demoCount ? '' : html`disabled`}>${icon('trash')}Clear Demo Data</button>
              <button type="button" class="btn btn--ghost" data-export>${icon('file')}Export records (JSON)</button>
              <button type="button" class="btn btn--danger-ghost" data-clear-all>${icon('alert')}Clear All Local Data</button>
            </div>
            <p class="muted small">Export includes internal fields — keep the file private. Photos aren’t included.</p>`
          : html`<p class="page-note">${icon('lock')} Only an Admin can load or clear development data.</p>`}
        </section>` : ''}
    </div>`);
}

async function exportRecords() {
  const repo = getRepository();
  const [vehicles, photos, activity] = await Promise.all([repo.vehicles.list(), repo.photos.list(), repo.activity.list()]);
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), note: 'PRIVATE — contains internal dealership data. Photos not included.', vehicles, photos, activity }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cela-private-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export downloaded.');
}

async function sendSupportRequest(form) {
  const message = form.querySelector('#support-message');
  const category = form.querySelector('#support-category');
  const errorBox = form.querySelector('[data-support-error]');
  const submit = form.querySelector('[data-support-submit]');
  errorBox.hidden = true;
  if (message.value.trim().length < 10) {
    errorBox.textContent = 'Describe what you need in a sentence or two.';
    errorBox.hidden = false;
    message.focus();
    return;
  }
  submit.disabled = true;
  try {
    const sent = await lightAstraService.createSupportRequest({ category: category.value, message: message.value.trim() });
    toast(`Request sent to ${SUPPORT.company}. Reference ${sent.reference}.`);
    await render();
    const target = document.querySelector('#support');
    if (target) target.scrollIntoView();
  } catch (err) {
    errorBox.textContent = err.message || 'Couldn’t send the request. Please try again.';
    errorBox.hidden = false;
    submit.disabled = false;
  }
}

async function changeOwnPassword(form) {
  const next = form.querySelector('#new-password');
  const again = form.querySelector('#confirm-password');
  const errorBox = form.querySelector('[data-password-error]');
  const submit = form.querySelector('[data-password-submit]');
  const fail = (message, field) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  };
  errorBox.hidden = true;
  next.removeAttribute('aria-invalid');
  again.removeAttribute('aria-invalid');
  if (next.value.length < PASSWORD_RULES.minLength) return fail(`Use at least ${PASSWORD_RULES.minLength} characters.`, next);
  if (next.value !== again.value) return fail('The two passwords don’t match.', again);
  submit.disabled = true;
  try {
    await authService.changePassword(next.value);
    toast('Password changed. Use the new password the next time you sign in.');
  } catch (err) {
    fail(err.message || 'Couldn’t change the password. Please try again.', next);
  } finally {
    next.value = '';       // never kept anywhere: not in storage, not in the page
    again.value = '';
    submit.disabled = false;
  }
  return undefined;
}

function bind() {
  const main = qs('#main');
  main.addEventListener('submit', (event) => {
    if (event.target.matches('[data-support-form]')) {
      event.preventDefault();
      sendSupportRequest(event.target);
      return;
    }
    if (!event.target.matches('[data-password-form]')) return;
    event.preventDefault();
    changeOwnPassword(event.target);
  });
  main.addEventListener('change', (event) => {
    if (event.target.id === 'pref-theme') {
      setPref('theme', event.target.value);
      applyTheme(event.target.value);
      toast('Theme updated.');
    }
    if (event.target.id === 'pref-view') {
      setPref('inventoryView', event.target.value);
      toast('Inventory layout saved.');
    }
  });
  bindSignedCopy(main);
  main.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-copy')) {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        toast(`${button.dataset.copyLabel} copied.`);
      } catch (err) {
        toast(`${button.dataset.copyLabel}: ${button.dataset.copy}`, { tone: 'info' });
      }
      return;
    }
    try {
      if (button.hasAttribute('data-load-demo')) {
        const { loadDemoData } = await import('../dev/seed-demo-data.js');
        button.disabled = true;
        await loadDemoData({ onProgress: (done, total) => { button.textContent = `Loading… ${done}/${total}`; } });
        toast('Demo data loaded.');
        refreshNavCounts();
        await render();
      } else if (button.hasAttribute('data-clear-demo')) {
        if (!(await confirmDialog({ title: 'Clear demo data?', message: 'Removes all vehicles marked Demo, their photos, and their activity. Your real records are not touched.', confirmLabel: 'Clear Demo Data', tone: 'danger' }))) return;
        const { clearDemoData } = await import('../dev/seed-demo-data.js');
        const { removed } = await clearDemoData();
        toast(`Removed ${removed} demo vehicle${removed === 1 ? '' : 's'}.`);
        refreshNavCounts();
        await render();
      } else if (button.hasAttribute('data-export')) {
        await exportRecords();
      } else if (button.hasAttribute('data-clear-all')) {
        const ok = await typedConfirmDialog({
          title: 'Clear ALL local data?',
          message: 'Erases every vehicle, photo and activity entry stored in this browser — including real records you entered during testing.',
          detail: 'This cannot be undone. Consider exporting first.',
          phrase: 'CLEAR ALL DATA',
          confirmLabel: 'Clear everything'
        });
        if (!ok) return;
        await getRepository().clearAll();
        toast('All local data cleared.');
        refreshNavCounts();
        await render();
      }
    } catch (err) {
      toastError(err.message || 'That didn’t work. Please try again.');
      await render();
    }
  });
}

initLayout({ page: 'settings', title: 'Settings' }).then(async () => {
  await render();
  bind();
  if (window.location.hash) {
    const target = document.querySelector(window.location.hash);
    if (target) target.scrollIntoView();
  }
}).catch(handlePageError);
