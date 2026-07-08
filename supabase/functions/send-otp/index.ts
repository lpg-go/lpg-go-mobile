import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from '../_shared/otp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEMAPHORE_API_KEY = Deno.env.get('SEMAPHORE_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  let body: { phone?: string; purpose?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const phone = normalizePhone(body.phone ?? '');
  if (!phone) {
    return new Response(JSON.stringify({ error: 'Invalid phone number. Use 09XXXXXXXXX or 639XXXXXXXXX.' }), { status: 400, headers: CORS });
  }

  // 'register' (default) blocks numbers that already have an account;
  // 'forgot_password' blocks numbers that don't. Defaulting to 'register'
  // keeps older clients (which send only { phone }) backward-safe.
  const purpose = body.purpose === 'forgot_password' ? 'forgot_password' : 'register';

  // profiles.phone stores the E.164 form WITH '+', while normalizePhone returns
  // digits only — prepend '+' to match. Uses the service-role client, so this
  // SELECT bypasses RLS and sees every account (anon RLS would hide most rows).
  const lookupPhone = '+' + phone;
  const { data: existingProfile, error: lookupErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone', lookupPhone)
    .maybeSingle();

  // Never log the full phone number (PII). Redact to the last 4 digits.
  const redactedPhone = '***' + phone.slice(-4);
  console.log('[send-otp] purpose:', purpose, 'phone:', redactedPhone, 'existingProfile:', existingProfile ? 'yes' : 'no');

  if (lookupErr) {
    console.error('[send-otp] profile lookup error:', lookupErr);
    return new Response(JSON.stringify({ error: 'Lookup failed.' }), { status: 500, headers: CORS });
  }

  if (purpose === 'register' && existingProfile) {
    return new Response(
      JSON.stringify({ error: 'already_registered', message: 'This number is already registered.' }),
      { status: 409, headers: CORS }
    );
  }

  if (purpose === 'forgot_password' && !existingProfile) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'No account found for this number.' }),
      { status: 404, headers: CORS }
    );
  }

  // Per-phone throttle — runs BEFORE generation, insert, or Semaphore call, so a
  // throttled request costs zero SMS and zero inserts. Uses created_at windows.
  const now = Date.now();
  const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  const { count: lastMinuteCount, error: minuteErr } = await supabase
    .from('otp_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', oneMinuteAgo);

  if (minuteErr) {
    console.error('[send-otp] throttle (minute) error:', minuteErr);
    return new Response(JSON.stringify({ error: 'Lookup failed.' }), { status: 500, headers: CORS });
  }

  if ((lastMinuteCount ?? 0) >= 1) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: 'Please wait before requesting another code.' }),
      { status: 429, headers: CORS }
    );
  }

  const { count: lastHourCount, error: hourErr } = await supabase
    .from('otp_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', oneHourAgo);

  if (hourErr) {
    console.error('[send-otp] throttle (hour) error:', hourErr);
    return new Response(JSON.stringify({ error: 'Lookup failed.' }), { status: 500, headers: CORS });
  }

  if ((lastHourCount ?? 0) >= 5) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Please try again later.' }),
      { status: 429, headers: CORS }
    );
  }

  // Generate 6-digit OTP
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Invalidate any existing unused OTPs for this phone
  await supabase
    .from('otp_verifications')
    .update({ used: true })
    .eq('phone', phone)
    .eq('used', false);

  // Store new OTP
  const { error: insertErr } = await supabase
    .from('otp_verifications')
    .insert({ phone, code, expires_at: expiresAt });

  if (insertErr) {
    console.error('[send-otp] insert error:', insertErr);
    return new Response(JSON.stringify({ error: 'Failed to store OTP.' }), { status: 500, headers: CORS });
  }

  // Send via Semaphore
  const form = new FormData();
  form.append('apikey', SEMAPHORE_API_KEY);
  form.append('number', phone);
  form.append('message', `Your LPG Go verification code is: ${code}. Valid for 15 minutes.`);
  form.append('sendername', 'LPGGo');

  const smsRes = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    body: form,
  });

  const smsBody = await smsRes.text();
  // Do NOT log smsBody: Semaphore echoes the submitted message, which contains
  // the live OTP code. Log only the HTTP status.
  console.log('[send-otp] semaphore status:', smsRes.status);

  if (!smsRes.ok) {
    // Don't echo smsBody: Semaphore responses can contain the message text (and
    // thus the OTP code). Surface only the HTTP status for debugging.
    console.error('[send-otp] semaphore send failed, status:', smsRes.status);
    return new Response(JSON.stringify({ error: 'Failed to send SMS.' }), { status: 502, headers: CORS });
  }

  // Semaphore returns HTTP 200 even on logical failures (insufficient credit,
  // rejected number), so smsRes.ok alone is not enough. A successful send is a
  // NON-EMPTY ARRAY of message objects, each with a per-message "status" (e.g.
  // "Pending"/"Queued"/"Sent"). Errors come back as an object with a message/
  // error field, or an array whose status is "Failed"/"Rejected". Anything that
  // isn't an array of accepted messages is treated as a send failure.
  const SEMAPHORE_FAILURE_STATUSES = ['failed', 'rejected', 'refunded'];
  let smsOk = false;
  try {
    const parsed = JSON.parse(smsBody);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Accepted unless any message explicitly carries a failure status.
      smsOk = !parsed.some((m) =>
        SEMAPHORE_FAILURE_STATUSES.includes(String(m?.status ?? '').toLowerCase())
      );
    }
  } catch {
    smsOk = false;
  }

  if (!smsOk) {
    // Same as above: a Failed/Rejected Semaphore payload still echoes the code,
    // so never return it to the caller.
    console.error('[send-otp] semaphore rejected the message, status:', smsRes.status);
    return new Response(JSON.stringify({ error: 'Failed to send SMS.' }), { status: 502, headers: CORS });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
});
