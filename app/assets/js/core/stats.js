// Read-only derivations for the dashboard.
import { zoned } from './schedule.js';

const DAY = 86400000;

export function dayKeys(n, end = new Date(), tz = 'UTC') {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(zoned(new Date(end.getTime() - i * DAY), tz).date);
  return out;
}

export function series(activity, days, tz) {
  return dayKeys(days, new Date(), tz).map((d) => ({ day: d, ...{ sent: 0, opened: 0, replied: 0, bounced: 0 }, ...(activity.daily[d] || {}) }));
}

export function totals(rows) {
  return rows.reduce((t, r) => ({ sent: t.sent + r.sent, opened: t.opened + r.opened, replied: t.replied + r.replied, bounced: t.bounced + r.bounced }),
    { sent: 0, opened: 0, replied: 0, bounced: 0 });
}

/** Totals for the `days` before the current window, for "vs previous period" deltas. */
export function previousTotals(activity, days, tz) {
  const end = new Date(Date.now() - days * DAY);
  return totals(dayKeys(days, end, tz).map((d) => ({ sent: 0, opened: 0, replied: 0, bounced: 0, ...(activity.daily[d] || {}) })));
}

/** Status of one enrollment: label + tone for display. */
export function enrollmentStatus(e, p) {
  if (e.status === 'removed') return { key: 'removed', label: 'Removed', tone: '' };
  if (!p || p.sent === 0) return e.status === 'paused' ? { key: 'paused', label: 'Paused', tone: '' } : { key: 'queued', label: 'Queued', tone: '' };
  if (p.replied) return { key: 'replied', label: 'Replied', tone: 'accent' };
  if (p.bounced) return { key: 'bounced', label: 'Bounced', tone: 'err' };
  if (p.unsubscribed) return { key: 'unsubscribed', label: 'Unsubscribed', tone: 'err' };
  if (p.done) return { key: 'finished', label: 'Finished', tone: '' };
  if (e.status === 'paused') return { key: 'paused', label: 'Paused', tone: '' };
  return { key: 'active', label: p.opened ? `Opened · email ${p.sent}` : `Sent · email ${p.sent}`, tone: p.opened ? 'ok' : '' };
}

export function contactIndex(config, activity) {
  const byContact = new Map();
  const seqName = new Map(config.sequences.map((s) => [s.id, s.name]));
  for (const e of config.enrollments) {
    if (e.status === 'removed') continue;
    const st = enrollmentStatus(e, activity.progress[e.id]);
    byContact.set(e.contactId, { enrollment: e, status: st, sequence: seqName.get(e.sequenceId) || 'Deleted sequence' });
  }
  return byContact;
}

export function sequenceStats(seq, config, activity) {
  const es = config.enrollments.filter((e) => e.sequenceId === seq.id && e.status !== 'removed');
  const s = { contacts: es.length, active: 0, sent: 0, opened: 0, replied: 0, bounced: 0, finished: 0 };
  for (const e of es) {
    const p = activity.progress[e.id];
    if (!p) { if (e.status === 'active') s.active++; continue; }
    s.sent += p.sent;
    if (p.sent > 0 && p.opened) s.opened++;
    if (p.replied) s.replied++;
    if (p.bounced) s.bounced++;
    if (p.done) s.finished++;
    else if (e.status === 'active') s.active++;
  }
  s.reached = es.filter((e) => (activity.progress[e.id]?.sent || 0) > 0).length;
  return s;
}

export function variantStats(activity, seqId, stepKey, templateId) {
  return activity.variantStats[`${seqId}|${stepKey}|${templateId}`] || { sent: 0, opened: 0, replied: 0 };
}

export function templateStats(activity, templateId) {
  const t = { sent: 0, opened: 0, replied: 0 };
  for (const [k, v] of Object.entries(activity.variantStats)) {
    if (k.endsWith(`|${templateId}`)) { t.sent += v.sent; t.opened += v.opened; t.replied += v.replied; }
  }
  return t;
}

export function mailboxToday(activity, mailbox, today) {
  const d = activity.mailboxDaily[mailbox.id];
  return d && d.date === today ? d.sent : 0;
}
