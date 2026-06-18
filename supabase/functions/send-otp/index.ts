import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEMAPHORE_API_KEY = Deno.env.get('SEMAPHORE_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) return digits;
  if (digits.startsWith('09') && digits.length === 11) return '63' + digits.slice(1);
  return null;
}

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

  console.log('[send-otp] purpose:', purpose, 'lookupPhone:', lookupPhone, 'existingProfile:', JSON.stringify(existingProfile), 'lookupErr:', JSON.stringify(lookupErr));

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

  // Generate 6-digit OTP
  const code = String(Math.floor(100000 + Math.random() * 900000));
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
  console.log('[send-otp] semaphore response:', smsRes.status, smsBody);

  if (!smsRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to send SMS.', details: smsBody }), { status: 502, headers: CORS });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
});
