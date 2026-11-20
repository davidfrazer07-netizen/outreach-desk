// Pull opens and unsubscribes recorded by the Cloudflare Worker, then acknowledge them.

export async function pullTracker(baseUrl, token) {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${base}/api/events`, { headers });
  if (!res.ok) throw new Error(`tracker responded ${res.status}`);
  const { events = [] } = await res.json();
  const opens = events.filter((e) => e.type === 'o');
  const unsubs = events.filter((e) => e.type === 'u');
  if (events.length) {
    const ack = await fetch(`${base}/api/ack`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: events.map((e) => e.key) }),
    });
    if (!ack.ok) throw new Error(`tracker ack responded ${ack.status}`);
  }
  return { opens, unsubs };
}
