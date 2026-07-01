import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone, verifyAndConsumeOtp } from '../_shared/otp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

  let body: { phone?: string; code?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const phone = normalizePhone(body.phone ?? '');
  const code = (body.code ?? '').trim();
  const newPassword = body.newPassword ?? '';

  if (!phone || !code || !newPassword) {
    return new Response(
      JSON.stringify({ error: 'phone, code and newPassword are required' }),
      { status: 400, headers: CORS }
    );
  }

  if (newPassword.length < 6) {
    return new Response(
      JSON.stringify({ error: 'Password must be at least 6 characters' }),
      { status: 400, headers: CORS }
    );
  }

  // C4: gate the reset on a genuinely consumed OTP. This is the SINGLE consume
  // point for the forgot-password flow — the client no longer calls verify-otp
  // separately (that would burn the code before we get here). Uses the same
  // hardened expiry + lockout logic as signup verification.
  const otpResult = await verifyAndConsumeOtp(adminClient, phone, code);
  if (!otpResult.ok) {
    return new Response(
      JSON.stringify({ error: otpResult.error ?? 'Invalid or expired code.' }),
      { status: 401, headers: CORS }
    );
  }

  // Look up the user by phone-as-email
  const phoneAsEmail = `${phone}@lpggo.app`;
  const { data: listData, error: listError } = await adminClient.auth.admin.listUsers();

  if (listError) {
    return new Response(JSON.stringify({ error: 'Failed to look up user' }), { status: 500, headers: CORS });
  }

  const user = listData.users.find((u) => u.email === phoneAsEmail);
  if (!user) {
    return new Response(JSON.stringify({ error: 'No account found for this phone number' }), { status: 200, headers: CORS });
  }

  // Update the password
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: CORS });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
});
