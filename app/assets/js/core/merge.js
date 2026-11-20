// Merge tags: {{first_name}}, {{company|your team}} (fallback after the pipe).

export const TAGS = [
  ['first_name', 'firstName'],
  ['last_name', 'lastName'],
  ['company', 'company'],
  ['industry', 'industry'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['sender_name', 'senderName'],
];

const TAG_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

export function render(text, contact = {}, extra = {}) {
  const values = { ...contact, ...extra };
  return String(text || '').replace(TAG_RE, (m, tag, fallback) => {
    const pair = TAGS.find(([t]) => t === tag.toLowerCase());
    if (!pair) return m;
    const v = values[pair[1]];
    return v ? String(v) : fallback ?? '';
  });
}

export function unknownTags(text) {
  const known = new Set(TAGS.map(([t]) => t));
  const out = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) {
    if (!known.has(m[1].toLowerCase())) out.add(m[1]);
  }
  return [...out];
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plain text body → minimal HTML that looks hand-written in a mail client.
export function textToHtml(text) {
  const paras = String(text || '').trim().split(/\n{2,}/);
  return paras
    .map((p) => {
      const html = escapeHtml(p)
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 12px">${html}</p>`;
    })
    .join('');
}
