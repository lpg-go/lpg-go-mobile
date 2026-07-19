import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RETURN_BASE = `${SUPABASE_URL}/functions/v1/topup-return`;
const METHODS = ['gcash', 'paymaya', 'card'] as const;
type Method = (typeof METHODS)[number];

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  if (req.method !== 'POST') return bad('Method not allowed', 405);

  // --- auth: approved provider only ---
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return bad('Missing token', 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return bad('Invalid token', 401);

  const { data: profile } = await supabase
    .from('profiles').select('role, is_approved').eq('id', user.id).single();
  if (!profile || profile.role !== 'provider' || !profile.is_approved) {
    return bad('Not an approved provider', 403);
  }

  // --- input ---
  let body: { base_amount?: unknown; method?: unknown };
  try { body = await req.json(); } catch { return bad('Invalid JSON'); }
  const method = body.method as Method;
  if (!METHODS.includes(method)) return bad('Invalid method');

  const base = Number(body.base_amount);
  if (!Number.isFinite(base) || base <= 0) return bad('Invalid amount');
  const baseCentavos = Math.round(base * 100);
  if (baseCentavos / 100 !== base) return bad('Amount has sub-centavo precision');

  // --- settings + per-method gating ---
  const { data: s } = await supabase
    .from('platform_settings')
    .select('fee_rate_gcash, fee_rate_maya, fee_rate_card, fee_fixed_card, allow_gcash_topup, allow_maya_topup, allow_card_topup, topup_min_amount, topup_max_amount')
    .eq('id', 1).single();
  if (!s) return bad('Settings unavailable', 500);

  const allow = { gcash: s.allow_gcash_topup, paymaya: s.allow_maya_topup, card: s.allow_card_topup }[method];
  if (!allow) return bad('This top-up method is currently unavailable', 403);

  const minCentavos = Math.round(Number(s.topup_min_amount) * 100);
  const maxCentavos = Math.round(Number(s.topup_max_amount) * 100);
  if (baseCentavos < minCentavos) return bad(`Minimum top-up is ₱${s.topup_min_amount}`);
  if (baseCentavos > maxCentavos) return bad(`Maximum top-up is ₱${s.topup_max_amount}`);

  const rate = { gcash: Number(s.fee_rate_gcash), paymaya: Number(s.fee_rate_maya), card: Number(s.fee_rate_card) }[method];
  const fixedCentavos = method === 'card' ? Math.round(Number(s.fee_fixed_card) * 100) : 0;
  if (!(rate >= 0 && rate < 1) || fixedCentavos < 0) return bad('Fee settings misconfigured', 500);

  // --- charge math, integer centavos ---
  // Round the charge UP to a whole peso for cleaner totals. The provider still
  // gets exactly `base` credited; the sub-peso rounding is a tiny platform
  // surplus, never a loss (ceil only ever increases the charge).
  const rawChargeCentavos = (baseCentavos + fixedCentavos) / (1 - rate);
  const chargeCentavos = Math.ceil(rawChargeCentavos / 100) * 100;
  const feeCentavos = chargeCentavos - baseCentavos;

  // --- create PayMongo checkout session (v1) ---
  const topupId = crypto.randomUUID();
  const auth = 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':');
  const pmRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { attributes: {
        // Single line item; breakdown AND description hidden so the checkout page
        // shows only the Total due. Item name carries no peso/amount.
        line_items: [{ name: 'Balance top-up', amount: chargeCentavos, currency: 'PHP', quantity: 1 }],
        show_line_items: false,
        show_description: false,
        payment_method_types: [method],
        success_url: `${RETURN_BASE}?status=success`,
        cancel_url: `${RETURN_BASE}?status=cancelled`,
        description: 'Balance top-up',
        reference_number: topupId,
        send_email_receipt: false,
        metadata: { topup_id: topupId, provider_id: user.id },
      } },
    }),
  });
  const pmJson = await pmRes.json();
  if (!pmRes.ok) {
    console.error('[create-topup-checkout] paymongo error:', pmRes.status, pmJson?.errors?.[0]?.code ?? 'unknown');
    return bad('Payment provider error', 502);
  }
  const sessionId: string | undefined = pmJson?.data?.id;
  const checkoutUrl: string | undefined = pmJson?.data?.attributes?.checkout_url;
  if (!sessionId || !checkoutUrl) return bad('Payment provider returned no session', 502);

  // --- persist the pending row (explicit id; keyed on checkout_session_id) ---
  const { error: insErr } = await supabase.from('topups').insert({
    id: topupId,
    provider_id: user.id,
    method,
    base_amount: baseCentavos / 100,
    fee_amount: feeCentavos / 100,
    charge_amount: chargeCentavos / 100,
    checkout_session_id: sessionId,
  });
  if (insErr) {
    console.error('[create-topup-checkout] insert error:', insErr.message);
    return bad('Could not record top-up', 500);
  }

  return new Response(JSON.stringify({ checkout_url: checkoutUrl, topup_id: topupId }), { status: 200, headers: CORS });
});
