// AI writing through OpenRouter, called from the browser.
// The key lives only in this browser's localStorage. It is never written to the repo or the encrypted config.
import { TAGS } from './core/merge.js';

const API = 'https://openrouter.ai/api/v1';
const LS_KEY = 'outreach-desk:ai';
const MODELS_KEY = 'outreach-desk:ai-models';
const PREFERRED = ['nvidia/nemotron', 'google/gemma', 'meta-llama/llama', 'mistralai/'];

function read() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; } catch { return {}; } }
export const aiSettings = () => ({ key: '', model: '', ...read() });
export const aiReady = () => Boolean(aiSettings().key);
export function saveAi(patch) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...read(), ...patch })); } catch { throw new Error('This browser blocks local storage, so the key can’t be saved'); }
}
export function forgetAi() { try { localStorage.removeItem(LS_KEY); } catch { /* blocked */ } }

const isFree = (m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;

/** Text models from OpenRouter, free ones first. Cached for this tab. */
export async function listModels() {
  try { const c = JSON.parse(sessionStorage.getItem(MODELS_KEY) || 'null'); if (c) return c; } catch { /* blocked */ }
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error(`OpenRouter: couldn’t load models (${res.status})`);
  const all = (await res.json()).data || [];
  const models = all
    .filter((m) => (m.architecture?.output_modalities || ['text']).includes('text'))
    .map((m) => ({ id: m.id, name: m.name || m.id, free: isFree(m),
      in: Number(m.pricing?.prompt) * 1e6, out: Number(m.pricing?.completion) * 1e6 }))
    .sort((a, b) => (b.free - a.free) || a.name.localeCompare(b.name));
  try { sessionStorage.setItem(MODELS_KEY, JSON.stringify(models)); } catch { /* blocked */ }
  return models;
}

export function defaultModel(models) {
  const free = models.filter((m) => m.free);
  for (const p of PREFERRED) { const hit = free.find((m) => m.id.startsWith(p)); if (hit) return hit.id; }
  return free[0]?.id || models[0]?.id || '';
}

/** Checks the key and returns its credit usage. */
export async function checkKey(key) {
  const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) throw new Error('OpenRouter didn’t accept this key');
  if (!res.ok) throw new Error(`OpenRouter: ${res.status}`);
  return (await res.json()).data || {};
}

const RULES = `You write cold B2B emails that sound like one busy person writing to another.
Rules:
- Plain text only. No markdown, no bullet symbols, no emoji, no exclamation marks.
- Keep the body under 120 words unless told otherwise. Short paragraphs.
- One clear, low-friction ask at the end (a question, not a meeting link).
- No hype words (revolutionary, game-changing, synergy, unlock, supercharge) and no spam triggers (free, guarantee, act now, 100%).
- Use only these merge tags, exactly as written: ${TAGS.map(([t]) => `{{${t}}}`).join(', ')}. A fallback goes after a pipe, like {{first_name|there}}. Never invent other tags or placeholders like [Name].
- Do not add a signature, sign-off name, unsubscribe line or postal address. They are added automatically.
- Do not invent facts, numbers, customer names or results that the brief doesn't give you.
Reply with only a JSON object: {"subject": "...", "body": "..."}. Use \\n for line breaks in the body.`;

const ACTIONS = {
  shorter: 'Make it noticeably shorter. Keep the core point and the ask.',
  warmer: 'Make the tone warmer and more human, without being familiar or salesy.',
  cta: 'Make the ask at the end clearer and easier to say yes to.',
  grammar: 'Fix grammar, spelling and awkward phrasing only. Change nothing else.',
  followup: 'Rewrite it as a short follow-up to an earlier email that got no reply. Set the subject to an empty string so it is sent in the same thread.',
  variant: 'Write a B variant for an A/B test. Keep the same offer and audience, but use a clearly different opening line and angle so the test teaches something.',
};
export const EDIT_ACTIONS = [['shorter', 'Shorter'], ['warmer', 'Warmer'], ['cta', 'Stronger ask'], ['grammar', 'Fix grammar'], ['followup', 'Make it a follow-up'], ['variant', 'Write a B variant']];

function parse(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.body === 'string') return { subject: String(o.subject ?? '').trim(), body: o.body.replace(/\r/g, '').trim() };
    } catch { /* fall through */ }
  }
  if (!t) throw new Error('The model returned nothing. Try again or pick another model');
  return { subject: null, body: t };
}

async function chat(messages) {
  const { key, model } = aiSettings();
  if (!key) throw new Error('Add your OpenRouter key in Settings first');
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': location.origin, 'X-Title': 'Outreach Desk' },
    body: JSON.stringify({ model: model || 'openrouter/auto', messages, temperature: 0.7, max_tokens: 900 }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('OpenRouter didn’t accept the key. Check it in Settings');
    if (res.status === 402) throw new Error('Out of OpenRouter credit. Top up, or pick a free model in Settings');
    if (res.status === 429) throw new Error('This model is busy (rate limited). Wait a minute or pick another model in Settings');
    throw new Error(`OpenRouter: ${msg} (${res.status})`);
  }
  return parse(data?.choices?.[0]?.message?.content);
}

/** A new email from a short brief. */
export function writeEmail({ audience, offer, tone, length, kind, notes, sender }) {
  const brief = [
    `Audience: ${audience}`, `What we offer: ${offer}`, `Tone: ${tone}`, `Length: ${length}`,
    `Email type: ${kind === 'followup' ? 'a follow-up to an earlier email with no reply. Use an empty subject so it threads' : 'the first email in a cold sequence'}`,
    sender ? `Sender: ${sender}` : '', notes ? `Extra notes: ${notes}` : '',
  ].filter(Boolean).join('\n');
  return chat([{ role: 'system', content: RULES }, { role: 'user', content: brief }]);
}

/** A rewrite of an existing template. */
export function editEmail({ subject, body }, { action, instruction }) {
  const ask = [ACTIONS[action], instruction].filter(Boolean).join('\n');
  return chat([
    { role: 'system', content: RULES },
    { role: 'user', content: `Here is the current email.\nSubject: ${subject || '(empty, sent in the same thread)'}\nBody:\n${body}\n\nChange it like this:\n${ask}\nKeep every merge tag that still makes sense.` },
  ]);
}
