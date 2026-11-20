// CSV parsing and contact normalisation. Pure functions, shared with tests.

export function parseCSV(text, delim = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}
function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

// Header aliases → canonical field
const ALIASES = {
  firstName: ['first name', 'firstname', 'first', 'first_name', 'given name'],
  lastName: ['last name', 'lastname', 'last', 'last_name', 'surname', 'family name'],
  company: ['company', 'company name', 'organisation', 'organization', 'account'],
  email: ['email', 'email address', 'e-mail', 'work email', 'mail'],
  industry: ['industry', 'sector', 'vertical'],
  phone: ['phone num', 'phone', 'phone number', 'mobile', 'phone no', 'telephone', 'phone_num'],
};

export const FIELDS = Object.keys(ALIASES);

export function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.includes(key)) map[field] = idx;
    }
  });
  return map;
}

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i;
export const isEmail = (e) => EMAIL_RE.test(String(e || '').trim());

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);

/**
 * Parse a CSV file into contacts.
 * Returns { contacts, skipped: [{ line, reason }], missing: [fields] }.
 */
export function contactsFromCSV(text, existingEmails = new Set()) {
  const rows = parseCSV(text, detectDelimiter(text));
  if (rows.length === 0) return { contacts: [], skipped: [], missing: FIELDS };
  const map = mapHeaders(rows[0]);
  const missing = FIELDS.filter((f) => map[f] === undefined);
  if (map.email === undefined) return { contacts: [], skipped: [], missing };
  const seen = new Set(existingEmails);
  const contacts = [];
  const skipped = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (f) => (map[f] === undefined ? '' : clean(r[map[f]]));
    const email = get('email').toLowerCase();
    if (!isEmail(email)) return skipped.push({ line, reason: email ? `Invalid email “${email}”` : 'No email' });
    if (seen.has(email)) return skipped.push({ line, reason: `Duplicate ${email}` });
    seen.add(email);
    contacts.push({
      firstName: get('firstName'),
      lastName: get('lastName'),
      company: get('company'),
      email,
      industry: get('industry'),
      phone: get('phone'),
    });
  });
  return { contacts, skipped, missing };
}
