import type { Queryable } from '../db';
import { env } from '../env';
import { formatIstDateTime } from '../lib/dates';
import type { CertificateSnapshot } from '../pdf/certificate';
import { effectiveNotifications, getPlatformSettings } from './settings';

type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP';
type Outcome = { status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string };

async function deliver(channel: Channel, to: string, subject: string, body: string): Promise<Outcome> {
  try {
    if (channel === 'EMAIL') {
      if (!env.resendApiKey || !env.emailFrom) return { status: 'SKIPPED', error: 'Email provider not configured (RESEND_API_KEY / EMAIL_FROM)' };
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text: body }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? { status: 'SENT' } : { status: 'FAILED', error: `Email provider responded ${res.status}` };
    }
    const url = channel === 'SMS' ? env.smsWebhookUrl : env.whatsappWebhookUrl;
    if (!url) return { status: 'SKIPPED', error: `${channel} gateway not configured` };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, to, message: body }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { status: 'SENT' } : { status: 'FAILED', error: `Gateway responded ${res.status}` };
  } catch (e) {
    return { status: 'FAILED', error: (e as Error).message.slice(0, 200) };
  }
}

export function issuanceMessage(s: CertificateSnapshot) {
  const vehicle = `${[s.vehicle.make, s.vehicle.model].filter(Boolean).join(' ')} (${s.vehicle.registrationNo || 'New'})`;
  return [
    'RSA Policy Successfully Issued',
    '',
    `Policy No: ${s.policyNumber}`,
    `Vehicle: ${vehicle}`,
    `Valid From: ${formatIstDateTime(s.startDate)}`,
    `Valid Till: ${formatIstDateTime(s.endDate)}`,
    '',
    `For Road Side Assistance call ${s.dealer.rsaPhone}.`,
    s.verifyUrl ? `Verify: ${s.verifyUrl}` : '',
    `- ${s.dealer.name}`,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

/** Sends the configured issuance notifications and records each attempt in the notifications outbox. */
export async function notifyPolicyIssued(q: Queryable, policyId: string) {
  const { rows } = await q.query(
    `SELECT p.id, p.dealer_id, p.snapshot, d.settings FROM policies p JOIN dealers d ON d.id = p.dealer_id WHERE p.id = $1`,
    [policyId],
  );
  const p = rows[0];
  if (!p) return;
  const prefs = effectiveNotifications(await getPlatformSettings(q), p.settings);
  const s = p.snapshot as CertificateSnapshot;
  const body = issuanceMessage(s);
  const subject = `RSA Policy ${s.policyNumber} issued`;
  const jobs: [Channel, string][] = [];
  if (prefs.email && s.customer.email) jobs.push(['EMAIL', s.customer.email]);
  if (prefs.sms && s.customer.mobile) jobs.push(['SMS', s.customer.mobile]);
  if (prefs.whatsapp && s.customer.mobile) jobs.push(['WHATSAPP', s.customer.mobile]);
  for (const [channel, to] of jobs) {
    const outcome = await deliver(channel, to, subject, body);
    await q.query(
      `INSERT INTO notifications (dealer_id, policy_id, channel, recipient, subject, body, status, error, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.dealer_id, p.id, channel, to, channel === 'EMAIL' ? subject : null, body, outcome.status, outcome.error ?? null, outcome.status === 'SENT' ? new Date() : null],
    );
  }
}
