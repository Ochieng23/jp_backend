import { EmailClient } from '@azure/communication-email';
import logger from '../utils/logger.js';

const ACS_CONN = String(process.env.ACS_CONNECTION_STRING || '').trim();
const ACS_SENDER = process.env.ACS_SENDER || 'jobs@cazini.co.ke';

let _client = null;
function client() {
  if (!_client) _client = new EmailClient(ACS_CONN);
  return _client;
}

/**
 * Send a transactional email via Azure Communication Services.
 * Falls back to logging the content instead of sending when
 * ACS_CONNECTION_STRING isn't configured (e.g. local dev without the
 * secret), so email-dependent flows never hard-fail outside production.
 *
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 */
export async function sendEmail(to, subject, html) {
  if (!ACS_CONN) {
    logger.warn(`[email] ACS_CONNECTION_STRING not set — logging instead of sending to ${to}`);
    logger.info(`[email] Subject: ${subject}\n${html}`);
    return { messageId: 'local-dev-noop' };
  }

  const message = {
    senderAddress: ACS_SENDER,
    content: { subject, html },
    recipients: { to: [{ address: to }] },
  };

  const poller = await client().beginSend(message);
  const result = await poller.pollUntilDone();

  if (result.status !== 'Succeeded') {
    throw new Error(`ACS send failed — status: ${result.status}, error: ${result.error?.message || 'unknown'}`);
  }

  return { messageId: result.id };
}

// full_name is holder-controlled (set at registration) and gets interpolated
// into email HTML below — escape it so a name like `<img src=x onerror=...>`
// can't inject markup into an email a real client might render.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailShell(bodyHtml) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <div style="font-size: 18px; font-weight: 700; color: #148438; margin-bottom: 24px;">Cazini</div>
      ${bodyHtml}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
        This is an automated message from Cazini's Job Passport platform. If you didn't request this, you can safely ignore it.
      </p>
    </div>
  `;
}

function ctaButton(url, label) {
  return `
    <a href="${url}" style="display: inline-block; background: #148438; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin: 16px 0;">
      ${label}
    </a>
  `;
}

export function verificationEmail(fullName, verifyUrl) {
  return emailShell(`
    <p style="font-size: 15px; color: #111928;">Hi ${escapeHtml(fullName)},</p>
    <p style="font-size: 15px; color: #111928; line-height: 1.5;">
      Thanks for creating your Job Passport. Please confirm your email address to finish setting up your account.
    </p>
    ${ctaButton(escapeHtml(verifyUrl), 'Verify email address')}
    <p style="font-size: 13px; color: #6b7280;">This link expires in 24 hours.</p>
  `);
}

export function passwordResetEmail(fullName, resetUrl) {
  return emailShell(`
    <p style="font-size: 15px; color: #111928;">Hi ${escapeHtml(fullName)},</p>
    <p style="font-size: 15px; color: #111928; line-height: 1.5;">
      We received a request to reset your Job Passport password. Click below to choose a new one.
    </p>
    ${ctaButton(escapeHtml(resetUrl), 'Reset password')}
    <p style="font-size: 13px; color: #6b7280;">
      This link expires in 1 hour. If you didn't request a password reset, you can ignore this email — your password won't change.
    </p>
  `);
}
