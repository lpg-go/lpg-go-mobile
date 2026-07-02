import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from '../_shared/otp.ts';

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

  let body: { phone?: string; reset_token?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const phone = normalizePhone(body.phone ?? '');
  const resetToken = (body.reset_token ?? '').trim();
  const newPassword = body.newPassword ?? '';

  if (!phone || !resetToken || !newPassword) {
    return new Response(
      JSON.stringify({ error: 'phone, reset_token and newPassword are required' }),
      { status: 400, headers: CORS }
    );
  }

  if (newPassword.length < 6) {
    return new Response(
      JSON.stringify({ error: 'Password must be at least 6 characters' }),
      { status: 400, headers: CORS }
    );
  }

  // Gate the reset on the opaque token verify-otp issued after it consumed the
  // OTP. A single guarded UPDATE verifies (exists + not used + not expired + phone
  // matches) AND marks used in one atomic statement — so the token is strictly
  // single-use even under concurrent requests. An invalid/expired/already-used
  // token, a phone mismatch, or a malformed (non-uuid) token all yield no row.
  const { data: consumedToken, error: tokenErr } = await adminClient
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('id', resetToken)
    .eq('phone', phone)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();

  if (tokenErr || !consumedToken) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired reset token.' }),
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
