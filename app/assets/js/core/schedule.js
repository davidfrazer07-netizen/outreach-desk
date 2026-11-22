// Sequence scheduling. Pure functions: no network, no clock reads (now is passed in).
//
// A sequence is: first step → wait → branch on "opened any email yet?"
//   opened track:     [{ delayDays, variants }]
//   notOpened track:  [{ delayDays, variants }]
// The branch is chosen once: as soon as the contact opens (then the opened track waits
// opened[0].delayDays from the last send), or when notOpened[0].delayDays passes without an open.
// A reply, bounce or unsubscribe stops the sequence for that contact.

const DAY = 86400000;
const RUN_MINUTES = 15;

export function zoned(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday };
}

/** Minutes left in today's send window, or 0 when outside it. */
export function windowMinutesLeft(now, settings) {
  const z = zoned(now, settings.timezone || 'UTC');
  const days = settings.days || [1, 2, 3, 4, 5];
  if (!days.includes(z.weekday)) return 0;
  const mins = z.hour * 60 + z.minute;
  const start = (settings.startHour ?? 9) * 60;
  const end = (settings.endHour ?? 17) * 60;
  if (mins < start || mins >= end) return 0;
  return end - mins;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** Weighted, deterministic A/B pick so a contact always gets the same variant for a step. */
export function pickVariant(variants, seed) {
  const usable = (variants || []).filter((v) => v.templateId && (v.weight ?? 1) > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((s, v) => s + (v.weight ?? 1), 0);
  let r = hash(seed) * total;
  for (const v of usable) { r -= v.weight ?? 1; if (r < 0) return v; }
  return usable[usable.length - 1];
}

export function stepAt(seq, stepKey) {
  if (stepKey === 'first') return seq.first;
  const [track, i] = stepKey.split('.');
  return (seq[track] || [])[Number(i)];
}

export function newProgress() {
  return { track: null, sent: 0, trackIndex: 0, lastSentAt: null, opened: false, replied: false,
    bounced: false, unsubscribed: false, done: false, threadSubject: null, firstMessageId: null, messages: [] };
}

/**
 * What should happen next for one enrollment at time `now`.
 * Returns { stepKey, dueAt } | { done: true } | { wait: true, dueAt }.
 * May set p.track as a side effect (branch decision).
 */
export function nextStep(seq, p, now) {
  if (p.done || p.replied || p.bounced || p.unsubscribed) return { done: true };
  if (p.sent === 0) return { stepKey: 'first', dueAt: 0 };
  const last = new Date(p.lastSentAt).getTime();
  if (!p.track) {
    const op = seq.opened || [];
    const np = seq.notOpened || [];
    if (p.opened) p.track = 'opened';
    else if (np.length && now - last >= np[0].delayDays * DAY) p.track = 'notOpened';
    else if (!np.length && !op.length) return { done: true };
    else if (!np.length && op.length) return { wait: true, dueAt: Infinity }; // waits for an open
    else return { wait: true, dueAt: last + np[0].delayDays * DAY };
  }
  const track = seq[p.track] || [];
  const step = track[p.trackIndex];
  if (!step) return { done: true };
  const dueAt = last + (step.delayDays || 0) * DAY;
  if (now < dueAt) return { wait: true, dueAt };
  return { stepKey: `${p.track}.${p.trackIndex}`, dueAt };
}

/**
 * Plan the sends for one engine run.
 * Returns [{ enrollment, contact, mailbox, sequence, stepKey, templateId }].
 */
export function planRun(config, activity, now) {
  const settings = config.settings || {};
  const minsLeft = windowMinutesLeft(new Date(now), settings);
  if (minsLeft <= 0) return [];
  const today = zoned(new Date(now), settings.timezone || 'UTC').date;
  const runsLeft = Math.max(1, Math.ceil(minsLeft / RUN_MINUTES));

  const contacts = new Map(config.contacts.map((c) => [c.id, c]));
  const seqs = new Map(config.sequences.map((s) => [s.id, s]));
  const boxes = new Map(config.mailboxes.map((m) => [m.id, m]));
  const suppressed = activity.suppressed || {};

  // Per-mailbox budget for this run: spread the rest of today's limit over the remaining runs.
  const budget = new Map();
  for (const m of config.mailboxes) {
    if (m.paused) { budget.set(m.id, 0); continue; }
    const d = (activity.mailboxDaily || {})[m.id];
    const sentToday = d && d.date === today ? d.sent : 0;
    const remaining = Math.max(0, (m.dailyLimit || 0) - sentToday);
    budget.set(m.id, Math.min(remaining, Math.ceil(remaining / runsLeft)));
  }

  const candidates = [];
  for (const e of config.enrollments) {
    if (e.status !== 'active') continue;
    const seq = seqs.get(e.sequenceId);
    const contact = contacts.get(e.contactId);
    const mailbox = boxes.get(e.mailboxId);
    if (!seq || seq.status !== 'active' || !contact || !mailbox) continue;
    if (suppressed[contact.email]) continue;
    const p = activity.progress[e.id] || (activity.progress[e.id] = newProgress());
    const next = nextStep(seq, p, now);
    if (next.done) { p.done = true; continue; }
    if (next.wait) continue;
    const variant = pickVariant(stepAt(seq, next.stepKey)?.variants, `${e.id}:${next.stepKey}`);
    if (!variant) continue;
    candidates.push({ enrollment: e, contact, mailbox, sequence: seq, stepKey: next.stepKey,
      templateId: variant.templateId, followUp: next.stepKey !== 'first', dueAt: next.dueAt,
      createdAt: e.createdAt || '' });
  }

  // Follow-ups first (oldest due first), then new contacts in the order they were enrolled.
  candidates.sort((a, b) => (b.followUp - a.followUp) || (a.dueAt - b.dueAt) || a.createdAt.localeCompare(b.createdAt));

  const plan = [];
  for (const c of candidates) {
    const left = budget.get(c.mailbox.id) || 0;
    if (left <= 0) continue;
    budget.set(c.mailbox.id, left - 1);
    plan.push(c);
  }
  return plan;
}

/** Record a successful send into activity. */
export function recordSend(activity, item, { messageId, token, subject, at, today }) {
  const p = activity.progress[item.enrollment.id] || (activity.progress[item.enrollment.id] = newProgress());
  if (item.stepKey === 'first') { p.threadSubject = subject; p.firstMessageId = messageId; }
  else p.trackIndex += 1;
  p.sent += 1;
  p.lastSentAt = at;
  p.messages.push({ id: messageId, token, stepKey: item.stepKey, templateId: item.templateId, at });

  const md = activity.mailboxDaily[item.mailbox.id];
  activity.mailboxDaily[item.mailbox.id] = md && md.date === today ? { date: today, sent: md.sent + 1 } : { date: today, sent: 1 };
  bump(activity, today, 'sent');
  bumpVariant(activity, item.sequence.id, item.stepKey, item.templateId, 'sent');
  pushEvent(activity, { t: at, type: 'sent', enrollmentId: item.enrollment.id, stepKey: item.stepKey });
}

export function bump(activity, day, field) {
  const d = activity.daily[day] || (activity.daily[day] = { sent: 0, opened: 0, replied: 0, bounced: 0 });
  d[field] += 1;
}

export function bumpVariant(activity, seqId, stepKey, templateId, field) {
  const k = `${seqId}|${stepKey}|${templateId}`;
  const v = activity.variantStats[k] || (activity.variantStats[k] = { sent: 0, opened: 0, replied: 0 });
  v[field] += 1;
}

export function pushEvent(activity, ev) {
  activity.events.push(ev);
  if (activity.events.length > 1500) activity.events.splice(0, activity.events.length - 1500);
}

export function emptyActivity() {
  return { version: 1, progress: {}, daily: {}, mailboxDaily: {}, variantStats: {}, replies: [],
    events: [], suppressed: {}, mailboxStatus: {}, lastRunAt: null };
}

export function emptyConfig() {
  return {
    version: 1,
    settings: { timezone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18,
      notifyEmail: '', ntfyTopic: '', trackerUrl: '', unsubscribeLine: true, postalAddress: '',
      writerName: '', writerProfile: '' },
    contacts: [], templates: [], mailboxes: [], sequences: [], enrollments: [], repliesRead: {},
  };
}
