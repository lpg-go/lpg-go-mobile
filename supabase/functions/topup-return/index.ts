import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve((req) => {
  const url = new URL(req.url);
  // Whitelist only — never reflect an arbitrary param into the Location header.
  const status = url.searchParams.get('status') === 'success' ? 'success' : 'cancelled';
  const target = `lpg-go://topup?status=${status}`;

  const html = `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${target}">
<title>Returning to LPG Go…</title>
<body style="font-family:sans-serif;text-align:center;padding:2rem">
<p>Returning to the app…</p>
<p><a href="${target}">Tap here if it doesn't open automatically.</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>`;

  return new Response(html, {
    status: 302,
    headers: { Location: target, 'Content-Type': 'text/html; charset=utf-8' },
  });
});
