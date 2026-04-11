import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushRequest {
  tokens: string[];
  title: string;
  body: string;
  data?: object;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: object;
  sound: 'default';
  priority: 'high';
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: PushRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { tokens, title, body, data } = payload;

  if (!Array.isArray(tokens) || tokens.length === 0) {
    return new Response(JSON.stringify({ error: 'tokens must be a non-empty array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'title and body are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages: ExpoMessage[] = tokens.map((token) => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
  }));

  const expoRes = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const expoData = await expoRes.json();

  if (!expoRes.ok) {
    return new Response(JSON.stringify({ error: 'Expo API error', details: expoData }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, data: expoData }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
