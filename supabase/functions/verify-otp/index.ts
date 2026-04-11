import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const phone = normalizePhone(body.phone ?? '');
  const code = (body.code ?? '').trim();

  if (!phone || !code) {
    return new Response(JSON.stringify({ error: 'phone and code are required' }), { status: 400, headers: CORS });
  }

  // Fetch the latest matching unused OTP for this phone + code
  const { data, error } = await supabase
    .from('otp_verifications')
    .select('id, expires_at, used')
    .eq('phone', phone)
    .eq('code', code)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid or expired OTP' }), { status: 200, headers: CORS });
  }

  if (new Date(data.expires_at) < new Date()) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid or expired OTP' }), { status: 200, headers: CORS });
  }

  // Mark as used
  await supabase
    .from('otp_verifications')
    .update({ used: true })
    .eq('id', data.id);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
});
