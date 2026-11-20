// Cloudflare Worker: open pixel, unsubscribe page and a small authenticated API for the engine.
// Bindings: KV namespace EVENTS, secret TRACKER_TOKEN.
//   GET  /o/<token>.gif   → 1x1 gif, records first open
//   GET  /u/<token>       → unsubscribe confirmation page (POST for one-click)
//   GET  /api/events      → pending events (auth)
//   POST /api/ack         → delete delivered events (auth)

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
const TOKEN_RE = /^[a-f0-9]{24}$/;

async function record(env, type, token) {
  const key = `${type}:${token}`;
  if ((await env.EVENTS.get(key)) || (await env.EVENTS.get(`done:${key}`))) return;
  await env.EVENTS.put(key, '1', { metadata: { at: new Date().toISOString() }, expirationTtl: 60 * 60 * 24 * 30 });
}

function page(body) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222">${body}</body>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    const open = path.match(/^\/o\/([a-f0-9]+)\.gif$/);
    if (open) {
      if (TOKEN_RE.test(open[1])) await record(env, 'o', open[1]);
      return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' } });
    }

    const unsub = path.match(/^\/u\/([a-f0-9]+)$/);
    if (unsub && TOKEN_RE.test(unsub[1])) {
      await record(env, 'u', unsub[1]);
      if (req.method === 'POST') return new Response('ok');
      return page('<p>You’re unsubscribed. You won’t get any more emails from this sender.</p>');
    }

    if (path.startsWith('/api/')) {
      if (req.headers.get('Authorization') !== `Bearer ${env.TRACKER_TOKEN}` || !env.TRACKER_TOKEN) {
        return new Response('unauthorized', { status: 401 });
      }
      if (path === '/api/events' && req.method === 'GET') {
        const events = [];
        for (const type of ['o', 'u']) {
          let cursor;
          do {
            const res = await env.EVENTS.list({ prefix: `${type}:`, cursor, limit: 1000 });
            for (const k of res.keys) events.push({ key: k.name, type, token: k.name.slice(2), at: k.metadata?.at });
            cursor = res.list_complete ? null : res.cursor;
          } while (cursor && events.length < 5000);
        }
        return Response.json({ events });
      }
      if (path === '/api/ack' && req.method === 'POST') {
        const { keys = [] } = await req.json();
        // Keep the key (so repeat opens are not re-recorded) but mark it delivered by moving it.
        await Promise.all(keys.slice(0, 1000).map(async (k) => {
          await env.EVENTS.put(`done:${k}`, '1', { expirationTtl: 60 * 60 * 24 * 30 });
          await env.EVENTS.delete(k);
        }));
        return Response.json({ ok: true });
      }
    }
    return new Response('not found', { status: 404 });
  },
};
