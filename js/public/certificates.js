// Certificate Center: find a certificate by event + membership ID, or verify a credential ID.
// Shows only what is needed to verify: name, event, category, status and the certificate itself.
import {
  normalizeCertificate,
  validCredential,
  certificateURL,
  certificateTitle,
  linkedInAddURL,
  membershipLookupID,
  ISSUER,
} from '../lib/certificate-model.js';
import { certificateSVG, downloadCertificate } from '../lib/certificate-render.js';
import { escapeHTML as h } from '../lib/content-model.js';
import { dateLabel } from '../lib/content-render.js';
import { rest, buildInfo } from './site-data.js';

const $ = (id) => document.getElementById(id);
const result = $('result');
const display = $('certificate-display');
const input = $('certId');
let request = 0;

const typeLabel = (type) => type.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const failure = (error) =>
  error.status === 403
    ? 'This certificate is being moved to the new verification system. Please try again in a few minutes.'
    : error.name === 'AbortError' || error.status === 0
      ? 'The certificate service did not respond. Please try again.'
      : 'The certificate service is unavailable. Please try again later.';

async function loadCatalog() {
  const select = $('member-event');
  const status = $('catalog-status');
  try {
    const hidden = new Set((await buildInfo()).hiddenCertificateEvents || []);
    const events = (await (await rest()).list('certificateEvents', { pageSize: 300, max: 1000 }))
      .map((d) => d.data)
      .filter((e) => !e.archived && !hidden.has(e.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    select.innerHTML =
      '<option value="">Select an event or service term</option>' +
      events.map((e) => `<option value="${h(e.id)}">${h(e.title)} · ${h(dateLabel(e.date))}</option>`).join('');
    if (!events.length)
      status.textContent = 'Events appear here once their certificates are issued. You can still use a credential ID below.';
  } catch {
    // Same as an empty list: nothing is shown as broken while the database is being set up.
    select.innerHTML = '<option value="">Select an event or service term</option>';
    status.textContent = 'Events appear here once their certificates are issued. You can still use a credential ID below.';
  }
}

$('member-certificate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = ++request;
  const event = $('member-event').value;
  const member = $('member-id').value;
  const matches = $('member-matches');
  matches.innerHTML = '';
  display.innerHTML = '';
  result.textContent = 'Finding your issued certificates…';
  try {
    const client = await rest();
    const entry = await client.get('certificateLookup/' + (await membershipLookupID(event, member)));
    if (current !== request) return;
    if (!entry?.ids?.length) {
      result.textContent = 'No issued certificate matches this event and membership ID. Check the ID or contact the chapter.';
      return;
    }
    // The lookup key is derived from the membership ID, so a match proves the ID without storing it publicly.
    const records = await Promise.all(
      entry.ids.map(async (id) => {
        try {
          const doc = await client.get('certificates/' + id);
          return doc ? normalizeCertificate(doc, { id, legacy: true }) : null;
        } catch {
          return null;
        }
      }),
    );
    if (current !== request) return;
    const found = records.filter((c) => c && (!c.eventId || c.eventId === event));
    if (!found.length) {
      result.textContent = 'No matching certificate could be loaded. Please try again in a few minutes or contact the chapter.';
      return;
    }
    result.textContent = `${found.length} certificate${found.length === 1 ? '' : 's'} found. Select one to view its status and download it.`;
    matches.innerHTML = found
      .map(
        (c) =>
          `<button type="button" class="certificate-match" data-credential="${h(c.id)}">${h(c.name)} · ${h(typeLabel(c.type))} · ${h(c.status)}<br><small>${h(c.id)}</small></button>`,
      )
      .join('');
  } catch (error) {
    if (current === request) result.textContent = error.message?.startsWith('Select an event') ? error.message : failure(error);
  }
});

$('member-matches').addEventListener('click', (e) => {
  const button = e.target.closest('[data-credential]');
  if (!button) return;
  history.replaceState(null, '', certificateURL(button.dataset.credential, location.origin));
  verify(button.dataset.credential);
});

// Share options: round icons with labels, like a phone's share sheet.
const svgIcon = (d, fill = false) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const ICONS = {
  link: svgIcon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  mail: svgIcon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  whatsapp: svgIcon(
    '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/>',
    true,
  ),
  linkedin: svgIcon(
    '<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4V21H3V9.75Zm6.5 0h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.6 4.78 6V21h-4v-5.1c0-1.22-.02-2.8-1.7-2.8-1.72 0-1.98 1.33-1.98 2.7V21h-4V9.75Z"/>',
    true,
  ),
  badge: svgIcon('<circle cx="12" cy="9" r="6"/><path d="m8.5 14 -1.5 8 5-3 5 3-1.5-8"/><path d="m9.5 9 1.7 1.7L14.5 7.5"/>'),
  more: svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
};
function shareItem(kind, label, icon, { href, action }) {
  const inner = `<span class="share-icon share-${kind}">${icon}</span><span class="share-label">${label}</span>`;
  return href
    ? `<a class="share-item" href="${h(href)}"${href.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${inner}</a>`
    : `<button type="button" class="share-item" data-share="${action}">${inner}</button>`;
}

async function verify(id) {
  const current = ++request;
  display.innerHTML = '';
  result.textContent = 'Checking the official certificate record…';
  if (!validCredential(id)) {
    result.textContent = 'Enter a valid credential ID (letters, numbers, hyphens and underscores).';
    return;
  }
  input.value = id;
  try {
    const doc = await (await rest()).get('certificates/' + id);
    if (current !== request) return;
    if (!doc) {
      result.innerHTML = `<div class="credential-revoked"><h2>Certificate not found</h2><p>No certificate has been issued with this credential ID. Check the ID or contact the chapter.</p><p>${h(id)}</p></div>`;
      return;
    }
    const c = normalizeCertificate(doc, { id, legacy: true });
    if (c.status === 'revoked') {
      result.innerHTML = `<div class="credential-revoked"><h2>Certificate revoked</h2><p>This credential is no longer valid. Contact the chapter for assistance.</p><p>Credential ID: ${h(id)}</p></div>`;
      return;
    }
    const svg = await certificateSVG(c);
    if (current !== request) return;
    const link = certificateURL(id);
    const title = `${certificateTitle(c)} – ${c.event}`;
    const message = `${c.name} · ${title}, issued by the ${ISSUER}. Verify it here: ${link}`;
    result.innerHTML = `<div class="credential-valid">
      <p class="credential-badge"><span aria-hidden="true">✓</span> Official record found</p>
      <h2>Certificate verified</h2>
      <p class="credential-name">${h(c.name)}</p>
      <p class="credential-title">${h(certificateTitle(c))}</p>
      <dl class="credential-facts">
        <div><dt>Event or term</dt><dd>${h(c.event)}</dd></div>
        <div><dt>Issued</dt><dd>${h(c.dateIssued ? dateLabel(c.dateIssued) : 'Not recorded')}</dd></div>
        <div class="credential-id"><dt>Credential ID</dt><dd>${h(id)}</dd></div>
      </dl>
      <div class="credential-actions">
        <button type="button" class="button" id="share-certificate" aria-expanded="false" aria-controls="share-menu">Share certificate</button>
        <button type="button" class="button secondary" id="download-certificate">Download certificate PDF</button>
      </div>
      <div class="share-menu" id="share-menu" role="group" aria-label="Share this certificate" hidden>
        ${shareItem('copy', 'Copy link', ICONS.link, { action: 'copy' })}
        ${shareItem('email', 'Email', ICONS.mail, { href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}` })}
        ${shareItem('whatsapp', 'WhatsApp', ICONS.whatsapp, { href: `https://wa.me/?text=${encodeURIComponent(message)}` })}
        ${shareItem('linkedin', 'LinkedIn post', ICONS.linkedin, { href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` })}
        ${shareItem('linkedin-profile', 'Add to LinkedIn', ICONS.badge, { href: linkedInAddURL(c) })}
        ${navigator.share ? shareItem('more', 'More apps', ICONS.more, { action: 'native' }) : ''}
      </div>
      <p class="share-status" role="status" aria-live="polite"></p></div>`;
    display.innerHTML = `<div class="certificate-frame">${svg}</div><p class="editor-note">The online record is the source of validity. Recheck this link when confirming a certificate.</p>`;
    const status = result.querySelector('.share-status');
    const menu = $('share-menu');
    $('share-certificate').addEventListener('click', (e) => {
      menu.hidden = !menu.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button, a')?.focus();
    });
    menu.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-share]')?.dataset.share;
      if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(link);
          status.textContent = 'Verification link copied.';
        } catch {
          status.innerHTML = `Copy this link: <a href="${h(link)}">${h(link)}</a>`;
        }
      }
      if (action === 'native')
        try {
          await navigator.share({ title, text: `${c.name} · ${title}`, url: link });
        } catch {
          /* Closed without sharing. */
        }
    });
    $('download-certificate').addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        await downloadCertificate(c);
      } catch {
        status.textContent = 'The PDF could not be generated. Please try again.';
      } finally {
        event.target.disabled = false;
      }
    });
  } catch (error) {
    if (current === request) result.textContent = failure(error);
  }
}

$('verify-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = input.value.trim();
  history.replaceState(null, '', certificateURL(id, location.origin));
  verify(id);
});

loadCatalog();
const initial = new URLSearchParams(location.search).get('certId');
if (initial) {
  document.querySelector('.credential-id-option')?.setAttribute('open', '');
  verify(initial);
}

// certificates.html#verify (menu: Certificates → Verify a credential) opens the credential ID form.
if (location.hash === '#verify') document.getElementById('verify')?.setAttribute('open', '');
