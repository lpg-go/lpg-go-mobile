import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone, verifyAndConsumeOtp } from '../_shared/otp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

  let body: {
    phone?: string;
    code?: string;
    password?: string;
    full_name?: string;
    role?: string;
    provider_type?: string;
    business_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const phone = normalizePhone(body.phone ?? '');
  const code = (body.code ?? '').trim();
  const password = body.password ?? '';
  const fullName = (body.full_name ?? '').trim();

  // Whitelist role/provider_type SERVER-SIDE. This function is public
  // (--no-verify-jwt), so a caller could otherwise pass role:'admin' and the
  // handle_new_user trigger would happily write it into profiles.role. Only
  // 'customer'/'provider' and 'dealer'/'rider' are ever accepted here.
  const role = body.role === 'provider' ? 'provider' : 'customer';
  const providerType =
    body.provider_type === 'dealer' ? 'dealer'
    : body.provider_type === 'rider' ? 'rider'
    : '';
  const businessName = (body.business_name ?? '').trim();

  if (!phone || !code) {
    return new Response(JSON.stringify({ error: 'phone and code are required' }), { status: 400, headers: CORS });
  }

  // Validate the password BEFORE consuming the OTP, so bad input doesn't burn a
  // valid code.
  if (password.length < 6) {
    return new Response(
      JSON.stringify({ success: false, error: 'Password must be at least 6 characters.' }),
      { status: 400, headers: CORS }
    );
  }

  const result = await verifyAndConsumeOtp(supabase, phone, code);
  if (!result.ok) {
    return new Response(JSON.stringify({ success: false, error: result.error }), { status: 200, headers: CORS });
  }

  // OTP verified + consumed — create the auth account server-side with the
  // service-role admin client. The client no longer calls supabase.auth.signUp.
  const phoneAsEmail = `${phone}@lpggo.app`;
  const metadata: Record<string, string> = {
    full_name: fullName,
    // profiles.phone is canonical +639XXXXXXXXX; normalizePhone returns digits only.
    phone: `+${phone}`,
    role,
  };
  if (role === 'provider' && providerType) {
    metadata.provider_type = providerType;
    if (providerType === 'dealer' && businessName) metadata.business_name = businessName;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: phoneAsEmail,
    password,
    email_confirm: true, // no email confirmation flow — account is usable immediately
    user_metadata: metadata,
  });

  if (createErr || !created?.user) {
    return new Response(
      JSON.stringify({ success: false, error: createErr?.message ?? 'Failed to create account.' }),
      { status: 200, headers: CORS }
    );
  }

  // The handle_new_user trigger auto-populates profiles (id, full_name, phone,
  // role) from user_metadata. It does NOT copy provider_type/business_name, so
  // set those here for providers. Non-fatal if it fails: the account + core
  // profile already exist and the user can sign in; surfacing an error here would
  // trap them (the number now reads as already-registered on retry).
  if (role === 'provider' && providerType) {
    const providerFields: Record<string, string> = { provider_type: providerType };
    if (providerType === 'dealer' && businessName) providerFields.business_name = businessName;

    const { error: profileErr } = await supabase
      .from('profiles')
      .update(providerFields)
      .eq('id', created.user.id);
    if (profileErr) {
      console.error('[verify-otp] provider profile update failed:', profileErr);
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
});
