// Where contacts are: country from the phone's calling code, else the email's country domain,
// else (a local number) the sender's home country, taken from the Settings time zone.

// [iso, name, calling code, lat, lon, time zones]
const C = [
  ['IN', 'India', '91', 21, 78.5, ['Asia/Kolkata', 'Asia/Calcutta']],
  ['US', 'United States', '1', 39, -98, ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix']],
  ['CA', 'Canada', '1', 56, -106, ['America/Toronto', 'America/Vancouver', 'America/Edmonton']],
  ['GB', 'United Kingdom', '44', 54, -2, ['Europe/London']],
  ['AE', 'UAE', '971', 24, 54, ['Asia/Dubai']],
  ['SG', 'Singapore', '65', 1.35, 103.8, ['Asia/Singapore']],
  ['AU', 'Australia', '61', -25, 134, ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Brisbane']],
  ['DE', 'Germany', '49', 51, 10, ['Europe/Berlin']],
  ['FR', 'France', '33', 46, 2, ['Europe/Paris']],
  ['NL', 'Netherlands', '31', 52.2, 5.3, ['Europe/Amsterdam']],
  ['IE', 'Ireland', '353', 53, -8, ['Europe/Dublin']],
  ['ES', 'Spain', '34', 40, -4, ['Europe/Madrid']],
  ['IT', 'Italy', '39', 42.8, 12.8, ['Europe/Rome']],
  ['CH', 'Switzerland', '41', 46.8, 8.2, ['Europe/Zurich']],
  ['SE', 'Sweden', '46', 62, 15, ['Europe/Stockholm']],
  ['SA', 'Saudi Arabia', '966', 24, 45, ['Asia/Riyadh']],
  ['QA', 'Qatar', '974', 25.3, 51.2, ['Asia/Qatar']],
  ['IL', 'Israel', '972', 31, 35, ['Asia/Jerusalem']],
  ['JP', 'Japan', '81', 36, 138, ['Asia/Tokyo']],
  ['KR', 'South Korea', '82', 36, 128, ['Asia/Seoul']],
  ['CN', 'China', '86', 35, 104, ['Asia/Shanghai']],
  ['HK', 'Hong Kong', '852', 22.3, 114.2, ['Asia/Hong_Kong']],
  ['MY', 'Malaysia', '60', 4, 102, ['Asia/Kuala_Lumpur']],
  ['ID', 'Indonesia', '62', -2, 118, ['Asia/Jakarta']],
  ['PH', 'Philippines', '63', 13, 122, ['Asia/Manila']],
  ['TH', 'Thailand', '66', 15, 101, ['Asia/Bangkok']],
  ['LK', 'Sri Lanka', '94', 7.8, 80.7, ['Asia/Colombo']],
  ['BD', 'Bangladesh', '880', 23.7, 90.4, ['Asia/Dhaka']],
  ['NP', 'Nepal', '977', 28, 84, ['Asia/Kathmandu']],
  ['PK', 'Pakistan', '92', 30, 70, ['Asia/Karachi']],
  ['ZA', 'South Africa', '27', -29, 24, ['Africa/Johannesburg']],
  ['NG', 'Nigeria', '234', 9, 8, ['Africa/Lagos']],
  ['KE', 'Kenya', '254', 0, 38, ['Africa/Nairobi']],
  ['BR', 'Brazil', '55', -10, -52, ['America/Sao_Paulo']],
  ['MX', 'Mexico', '52', 23, -102, ['America/Mexico_City']],
  ['NZ', 'New Zealand', '64', -41, 174, ['Pacific/Auckland']],
];

export const COUNTRIES = Object.fromEntries(C.map(([iso, name, code, lat, lon, tz]) => [iso, { iso, name, code, lat, lon, tz }]));
const TLD = { uk: 'GB', ...Object.fromEntries(C.map(([iso]) => [iso.toLowerCase(), iso])) };
delete TLD.gb;

export function homeCountry(timezone) {
  return C.find((c) => c[5].includes(timezone))?.[0]
    || C.find((c) => c[5].some((z) => z.split('/')[0] === String(timezone).split('/')[0]))?.[0] || 'IN';
}

/** Country of one contact, or '' when there's nothing to go on. */
export function countryOf(contact, home = 'IN') {
  const phone = String(contact.phone || '').replace(/[^\d+]/g, '');
  const tld = String(contact.email || '').toLowerCase().split('.').pop();
  const intl = phone.startsWith('+') ? phone.slice(1) : phone.startsWith('00') ? phone.slice(2) : '';
  if (intl) {
    for (const len of [3, 2, 1]) {
      const hits = C.filter((c) => c[2] === intl.slice(0, len));
      if (hits.length) return (hits.find((c) => c[0] === TLD[tld]) || hits[0])[0];
    }
  }
  if (TLD[tld]) return TLD[tld];
  return phone.length >= 6 ? home : '';
}

/** Contacts, reached and replied per country, biggest first. */
export function reachByCountry(config, activity, home) {
  const rows = new Map();
  const byContact = new Map();
  for (const e of config.enrollments) {
    const p = activity.progress[e.id];
    if (!p) continue;
    const cur = byContact.get(e.contactId) || { sent: false, replied: false };
    byContact.set(e.contactId, { sent: cur.sent || p.sent > 0, replied: cur.replied || p.replied });
  }
  let unknown = 0;
  for (const c of config.contacts) {
    const iso = countryOf(c, home);
    if (!iso) { unknown++; continue; }
    const r = rows.get(iso) || { ...COUNTRIES[iso], contacts: 0, reached: 0, replied: 0 };
    const s = byContact.get(c.id);
    r.contacts++;
    if (s?.sent) r.reached++;
    if (s?.replied) r.replied++;
    rows.set(iso, r);
  }
  return { rows: [...rows.values()].sort((a, b) => b.contacts - a.contacts), unknown };
}
