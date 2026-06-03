import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SECRET = Deno.env.get('APP_SECRET');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

type OrderEvent =
  | 'new_order'
  | 'dealer_accepted'
  | 'multiple_dealers_accepted'
  | 'dealer_selected'
  | 'order_cancelled'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'delivery_confirmed'
  | 'low_balance'
  | 'low_stock'
  | 'provider_unavailable';

interface RequestBody {
  orderId?: string;
  providerId?: string;
  event: OrderEvent;
}

interface HandlerResult {
  tokensFound: number;
  pushResult: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendPush(tokens: string[], title: string, body: string, data?: object): Promise<unknown> {
  if (tokens.length === 0) return null;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ tokens, title, body, data }),
  });
  return res.json();
}

async function insertNotifications(
  userIds: string[],
  title: string,
  body: string,
  type: OrderEvent,
  orderId?: string,
): Promise<void> {
  if (userIds.length === 0) return;
  const rows = userIds.map((user_id) => ({
    user_id,
    title,
    body,
    type,
    order_id: orderId ?? null,
  }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('[notifications] insert error:', error);
}

async function getToken(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', userId)
    .single();
  return data?.expo_push_token ?? null;
}

async function getTokens(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .in('id', userIds)
    .not('expo_push_token', 'is', null);
  return (data ?? []).map((r) => r.expo_push_token).filter(Boolean);
}

async function getOrder(orderId: string) {
  const { data } = await supabase
    .from('orders')
    .select('id, customer_id, selected_provider_id, status, total_amount, admin_fee')
    .eq('id', orderId)
    .single();
  return data;
}

async function getAcceptingProviderIds(orderId: string): Promise<string[]> {
  const { data } = await supabase
    .from('order_acceptances')
    .select('provider_id')
    .eq('order_id', orderId)
    .is('withdrawn_at', null);
  return (data ?? []).map((r) => r.provider_id);
}

async function getPlatformSettings() {
  const { data } = await supabase
    .from('platform_settings')
    .select('min_balance, min_stock_level')
    .single();
  return data;
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleNewOrder(orderId: string): Promise<HandlerResult> {
  const { data: items } = await supabase
    .from('order_items')
    .select('product_id')
    .eq('order_id', orderId);

  const productIds = (items ?? []).map((i) => i.product_id);
  if (productIds.length === 0) return { tokensFound: 0, pushResult: null };

  const { data: providerProducts } = await supabase
    .from('provider_products')
    .select('provider_id, provider:profiles!provider_products_provider_id_fkey(is_approved, is_online, expo_push_token)')
    .in('product_id', productIds)
    .gt('stock', 0);

  const tokenSet = new Set<string>();
  const providerIds = new Set<string>();
  for (const pp of providerProducts ?? []) {
    const profile = pp.provider as { is_approved: boolean; is_online: boolean; expo_push_token: string | null } | null;
    if (profile?.is_approved && profile?.is_online) {
      providerIds.add(pp.provider_id);
      if (profile.expo_push_token) tokenSet.add(profile.expo_push_token);
    }
  }

  const title = 'New Order Request';
  const body = 'A customer placed a new order. Tap to accept.';
  await insertNotifications([...providerIds], title, body, 'new_order', orderId);

  const tokens = [...tokenSet];
  const pushResult = await sendPush(tokens, title, body, { orderId });
  return { tokensFound: tokens.length, pushResult };
}

async function handleDealerAccepted(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order) return { tokensFound: 0, pushResult: null };
  const title = 'Provider Accepted';
  const body = 'A provider accepted your order. Check your order for details.';
  await insertNotifications([order.customer_id], title, body, 'dealer_accepted', orderId);
  const token = await getToken(order.customer_id);
  if (!token) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush([token], title, body, { orderId });
  return { tokensFound: 1, pushResult };
}

async function handleMultipleDealersAccepted(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order) return { tokensFound: 0, pushResult: null };
  const title = 'Multiple Providers Ready';
  const body = 'More than one provider is ready. Select your preferred one!';
  await insertNotifications([order.customer_id], title, body, 'multiple_dealers_accepted', orderId);
  const token = await getToken(order.customer_id);
  if (!token) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush([token], title, body, { orderId });
  return { tokensFound: 1, pushResult };
}

async function handleDealerSelected(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order?.selected_provider_id) return { tokensFound: 0, pushResult: null };

  const allProviderIds = await getAcceptingProviderIds(orderId);
  const otherProviderIds = allProviderIds.filter((id) => id !== order.selected_provider_id);

  const selectedTitle = 'You Were Selected!';
  const selectedBody = 'The customer chose you. Head out for delivery!';
  const otherTitle = 'Order Taken';
  const otherBody = 'The customer selected another provider for this order.';

  await insertNotifications([order.selected_provider_id], selectedTitle, selectedBody, 'dealer_selected', orderId);
  await insertNotifications(otherProviderIds, otherTitle, otherBody, 'dealer_selected', orderId);

  const results: unknown[] = [];
  let tokensFound = 0;

  const selectedToken = await getToken(order.selected_provider_id);
  if (selectedToken) {
    tokensFound++;
    results.push(await sendPush([selectedToken], selectedTitle, selectedBody, { orderId }));
  }

  const otherTokens = await getTokens(otherProviderIds);
  if (otherTokens.length > 0) {
    tokensFound += otherTokens.length;
    results.push(await sendPush(otherTokens, otherTitle, otherBody, { orderId }));
  }

  return { tokensFound, pushResult: results };
}

async function handleOrderCancelled(orderId: string): Promise<HandlerResult> {
  const providerIds = await getAcceptingProviderIds(orderId);
  const title = 'Order Cancelled';
  const body = 'The customer cancelled this order.';
  await insertNotifications(providerIds, title, body, 'order_cancelled', orderId);
  const tokens = await getTokens(providerIds);
  if (tokens.length === 0) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush(tokens, title, body, { orderId });
  return { tokensFound: tokens.length, pushResult };
}

async function handleInTransit(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order) return { tokensFound: 0, pushResult: null };
  const title = 'On the Way!';
  const body = 'Your LPG is on its way. Track your delivery in the app.';
  await insertNotifications([order.customer_id], title, body, 'in_transit', orderId);
  const token = await getToken(order.customer_id);
  if (!token) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush([token], title, body, { orderId });
  return { tokensFound: 1, pushResult };
}

async function handleAwaitingConfirmation(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order) return { tokensFound: 0, pushResult: null };
  const title = 'Confirm Your Delivery';
  const body = 'Your provider marked the order as delivered. Please confirm receipt.';
  await insertNotifications([order.customer_id], title, body, 'awaiting_confirmation', orderId);
  const token = await getToken(order.customer_id);
  if (!token) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush([token], title, body, { orderId });
  return { tokensFound: 1, pushResult };
}

async function handleDeliveryConfirmed(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order?.selected_provider_id) {
    console.log('[delivery_confirmed] no selected_provider_id for order', orderId);
    return { tokensFound: 0, pushResult: null };
  }

  const providerId = order.selected_provider_id;
  console.log('[delivery_confirmed] orderId=%s providerId=%s', orderId, providerId);

  // ── 1. Fetch order items ────────────────────────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', orderId);

  console.log('[delivery_confirmed] items=%o err=%o', items, itemsErr);

  // ── 2. Deduct stock via SECURITY DEFINER RPC (bypasses RLS) ────────────────
  for (const item of items ?? []) {
    const { error: stockErr } = await supabase.rpc('deduct_provider_stock', {
      p_provider_id: providerId,
      p_product_id: item.product_id,
      p_quantity: item.quantity,
    });
    console.log('[delivery_confirmed] deduct_provider_stock product=%s qty=%d err=%o',
      item.product_id, item.quantity, stockErr);
  }

  // ── 3. Fetch updated balance ────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('expo_push_token, balance')
    .eq('id', providerId)
    .single();

  const adminFee = Number(order.admin_fee ?? 0);
  const balance = Number(profile?.balance ?? 0);

  console.log('[delivery_confirmed] balance=%d adminFee=%d token=%s', balance, adminFee, profile?.expo_push_token);

  const title = 'Delivery Confirmed!';
  const body = `Order complete. Admin fee ₱${adminFee.toLocaleString()} deducted. New balance: ₱${balance.toLocaleString()}.`;
  await insertNotifications([providerId], title, body, 'delivery_confirmed', orderId);

  const pushResult = profile?.expo_push_token
    ? await sendPush([profile.expo_push_token], title, body, { orderId })
    : null;

  // ── 4. Low balance / low stock checks ──────────────────────────────────────
  const settings = await getPlatformSettings();
  if (settings && balance <= Number(settings.min_balance)) {
    await handleLowBalance(providerId);
  }
  await handleLowStock(providerId);

  return { tokensFound: profile?.expo_push_token ? 1 : 0, pushResult };
}

async function handleLowBalance(providerId: string): Promise<HandlerResult> {
  const settings = await getPlatformSettings();
  const { data: profile } = await supabase
    .from('profiles')
    .select('expo_push_token, balance')
    .eq('id', providerId)
    .single();

  const minBalance = Number(settings?.min_balance ?? 0);
  const balance = Number(profile?.balance ?? 0);

  const title = 'Low Balance Warning';
  const body = `Your balance (₱${balance.toLocaleString()}) is at or below the minimum (₱${minBalance.toLocaleString()}). Top up to keep receiving orders.`;
  await insertNotifications([providerId], title, body, 'low_balance');

  if (!profile?.expo_push_token) return { tokensFound: 0, pushResult: null };

  const pushResult = await sendPush([profile.expo_push_token], title, body, { providerId });
  return { tokensFound: 1, pushResult };
}

async function handleLowStock(providerId: string): Promise<HandlerResult> {
  const settings = await getPlatformSettings();
  const minStock = settings?.min_stock_level ?? 0;

  const { data: lowStockProducts } = await supabase
    .from('provider_products')
    .select('stock, product:products(name)')
    .eq('provider_id', providerId)
    .lte('stock', minStock);

  if (!lowStockProducts || lowStockProducts.length === 0) return { tokensFound: 0, pushResult: null };

  const productNames = lowStockProducts
    .map((p) => (p.product as { name: string } | null)?.name)
    .filter(Boolean)
    .join(', ');

  const title = 'Low Stock Alert';
  const body = `Stock is running low for: ${productNames}. Update your inventory to keep receiving orders.`;
  await insertNotifications([providerId], title, body, 'low_stock');

  const { data: profile } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', providerId)
    .single();

  if (!profile?.expo_push_token) return { tokensFound: 0, pushResult: null };

  const pushResult = await sendPush([profile.expo_push_token], title, body, { providerId });
  return { tokensFound: 1, pushResult };
}

async function handleProviderUnavailable(orderId: string): Promise<HandlerResult> {
  const order = await getOrder(orderId);
  if (!order) return { tokensFound: 0, pushResult: null };
  const title = 'Provider Unavailable';
  const body = 'Your provider cancelled. Please select another provider.';
  await insertNotifications([order.customer_id], title, body, 'provider_unavailable', orderId);
  const token = await getToken(order.customer_id);
  if (!token) return { tokensFound: 0, pushResult: null };
  const pushResult = await sendPush([token], title, body, { orderId });
  return { tokensFound: 1, pushResult };
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-app-secret' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  const secret = req.headers.get('x-app-secret');
  if (!APP_SECRET || secret !== APP_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const { orderId, providerId, event } = body;

  try {
    let result: HandlerResult;

    switch (event) {
      case 'new_order':              result = await handleNewOrder(orderId!); break;
      case 'dealer_accepted':        result = await handleDealerAccepted(orderId!); break;
      case 'multiple_dealers_accepted': result = await handleMultipleDealersAccepted(orderId!); break;
      case 'dealer_selected':        result = await handleDealerSelected(orderId!); break;
      case 'order_cancelled':        result = await handleOrderCancelled(orderId!); break;
      case 'in_transit':             result = await handleInTransit(orderId!); break;
      case 'awaiting_confirmation':  result = await handleAwaitingConfirmation(orderId!); break;
      case 'delivery_confirmed':     result = await handleDeliveryConfirmed(orderId!); break;
      case 'low_balance':            result = await handleLowBalance(providerId!); break;
      case 'low_stock':              result = await handleLowStock(providerId!); break;
      case 'provider_unavailable':   result = await handleProviderUnavailable(orderId!); break;
      default:
        return new Response(JSON.stringify({ error: `Unknown event: ${event}` }), { status: 400, headers: CORS });
    }

    return new Response(
      JSON.stringify({ ok: true, event, orderId, providerTokensFound: result.tokensFound, pushResult: result.pushResult }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    console.error(`[order-notifications] event=${event} error:`, err);
    return new Response(JSON.stringify({ error: 'Internal error', details: String(err) }), { status: 500, headers: CORS });
  }
});
