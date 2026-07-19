import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Constant-time hex compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();               // raw body — sign/parse from THIS, not a re-serialization
  const header = req.headers.get('Paymongo-Signature') ?? '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')) as [string, string][]);
  const t = parts['t'];
  const te = parts['te'];                      // test-mode signature component
  const li = parts['li'];                      // live-mode signature component
  if (!t || (!te && !li)) return new Response('Bad signature header', { status: 401 });

  // PayMongo signs test events into `te` and live events into `li`, each with the
  // mode's own signing secret. We hold exactly one secret per environment, so accept
  // a match on whichever component is present — this verifies correctly in BOTH test
  // and live with no code change at go-live (a wrong secret still fails both).
  const computed = await hmacHex(WEBHOOK_SECRET, `${t}.${raw}`);
  const ok = (!!te && timingSafeEqual(computed, te)) || (!!li && timingSafeEqual(computed, li));
  if (!ok) return new Response('Bad signature', { status: 401 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }

  const type = event?.data?.attributes?.type;
  if (type !== 'checkout_session.payment.paid') {
    return new Response('ignored', { status: 200 });
  }

  const cs = event?.data?.attributes?.data;                 // the checkout_session resource
  const sessionId: string | undefined = cs?.id;             // cs_...  (top-level id)
  // payments[] can hold earlier FAILED attempts too — pick the paid one, not [0].
  const payments: any[] = cs?.attributes?.payments ?? [];
  const payment = payments.find((p) => p?.attributes?.status === 'paid') ?? payments[0];
  const paymentId: string | undefined = payment?.id;        // pay_...  (top-level id)
  const attr = payment?.attributes ?? {};
  const paidPesos = typeof attr.amount === 'number' ? attr.amount / 100 : null;
  const netPesos = typeof attr.net_amount === 'number' ? attr.net_amount / 100 : null;
  const status = attr.status;

  if (!sessionId || !paymentId || paidPesos === null) {
    // Log IDS ONLY — the full payload can carry billing name/email/phone (PII).
    // Return 500 (retryable) so a genuine paid event isn't silently dropped.
    console.error('[paymongo-webhook] paid event missing fields', { sessionId, paymentId, hasAmount: paidPesos !== null });
    return new Response('unprocessable', { status: 500 });
  }

  const { data: result, error } = await supabase.rpc('confirm_topup', {
    p_session_id: sessionId,
    p_payment_id: paymentId,
    p_paid_amount: paidPesos,
    p_net_amount: netPesos,
    p_status: status,
  });
  if (error) {
    console.error('[paymongo-webhook] confirm_topup error:', error.message);
    return new Response('rpc error', { status: 500 });   // let PayMongo retry a transient DB error
  }

  if (result === 'unknown' || result === 'amount_mismatch' || result === 'not_paid') {
    console.error(`[paymongo-webhook] session ${sessionId} → ${result}`);   // loud, alertable
  }
  return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
