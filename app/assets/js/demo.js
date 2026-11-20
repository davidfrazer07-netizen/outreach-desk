// Sample workspace so the dashboard can be explored before connecting GitHub.
import { emptyActivity, emptyConfig, newProgress, zoned } from './core/schedule.js';

function rng(seed) { let s = seed; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Meera', 'Karan', 'Isha', 'Arjun', 'Neha', 'Siddharth', 'Kavya', 'Rahul', 'Pooja', 'Aditya', 'Tanvi', 'Nikhil', 'Riya', 'Dev', 'Sneha', 'Farhan', 'Zoya', 'Kabir', 'Leela'];
const LAST = ['Sharma', 'Iyer', 'Mehta', 'Reddy', 'Kapoor', 'Nair', 'Gupta', 'Bose', 'Menon', 'Rao', 'Malhotra', 'Desai', 'Khan', 'Pillai', 'Joshi', 'Chawla'];
const CO = [['Bluepine Foods', 'Food & beverage'], ['Kitepath Logistics', 'Logistics'], ['Saffron Loom', 'Apparel'], ['Northwind Clinics', 'Healthcare'], ['Tiller Agritech', 'Agriculture'], ['Ledgerly', 'Fintech'], ['Monsoon Home', 'Home goods'], ['Brightdesk', 'SaaS'], ['Cartwheel', 'Retail'], ['Copperleaf Cafés', 'Food & beverage'], ['Haveli Stays', 'Hospitality'], ['Quillbox', 'SaaS'], ['Greenroot Organics', 'Agriculture'], ['Urban Kettle', 'Food & beverage'], ['Stackwise', 'SaaS'], ['Indigo Threads', 'Apparel']];

export function makeDemo() {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const config = emptyConfig();
  config.settings.notifyEmail = 'you@yourco.in';
  config.settings.trackerUrl = 'https://outreach-tracker.example.workers.dev';
  config.mailboxes = [
    { id: 'mb1rah', slot: 1, label: 'Rahul', fromName: 'Rahul Verma', email: 'rahul@yourco.in', user: 'rahul@yourco.in', smtpHost: 'smtp.gmail.com', smtpPort: 465, imapHost: 'imap.gmail.com', imapPort: 993, dailyLimit: 10, signature: 'Rahul Verma\nGrowth, YourCo' },
    { id: 'mb2ana', slot: 2, label: 'Ananya', fromName: 'Ananya Rao', email: 'ananya@yourco.in', user: 'ananya@yourco.in', smtpHost: 'smtp.gmail.com', smtpPort: 465, imapHost: 'imap.gmail.com', imapPort: 993, dailyLimit: 5, signature: 'Ananya Rao\nYourCo' },
    { id: 'mb3hel', slot: 3, label: 'Hello', fromName: 'YourCo team', email: 'hello@tryyourco.in', user: 'hello@tryyourco.in', smtpHost: 'smtp.zoho.in', smtpPort: 465, imapHost: 'imap.zoho.in', imapPort: 993, dailyLimit: 25, signature: 'The YourCo team' },
  ];
  config.templates = [
    { id: 't1', name: 'Reorders: question', subject: 'Quick question about {{company}}', body: 'Hi {{first_name}},\n\nHow are repeat orders tracked at {{company}} today? Most {{industry|D2C}} teams we speak with find out a customer has churned weeks after it happens.\n\nWe built a small tool that flags it the day a reorder is late. Worth a 15 minute look next week?' },
    { id: 't2', name: 'Reorders: direct', subject: '{{first_name}}, a thought on reorders', body: 'Hi {{first_name}},\n\nI’ll keep this short. We help {{industry|consumer}} brands like {{company}} win back customers who stop reordering, usually 8 to 12% of revenue a quarter.\n\nOpen to a quick call?' },
    { id: 't3', name: 'Follow-up: case study', subject: '', body: 'Hi {{first_name}},\n\nSaw you had a look. Here’s how Bluepine Foods recovered 11% of lapsed customers in six weeks: https://yourco.in/bluepine\n\nHappy to walk through what that would look like for {{company}}.' },
    { id: 't4', name: 'Follow-up: bump', subject: 'Re-sending in case it got buried', body: 'Hi {{first_name}},\n\nFloating this back up. If reorders aren’t a priority for {{company}} right now, just say so and I’ll stop.' },
    { id: 't5', name: 'Breakup', subject: '', body: 'Hi {{first_name}},\n\nI’ll close the loop here. If it becomes relevant later, this thread is the easiest way to reach me.' },
  ];
  config.sequences = [
    { id: 's1', name: 'Founders, Indian D2C', status: 'active', mailboxIds: ['mb1rah', 'mb2ana'], createdAt: '2026-10-12',
      first: { variants: [{ templateId: 't1', weight: 50 }, { templateId: 't2', weight: 50 }] },
      opened: [{ delayDays: 2, variants: [{ templateId: 't3', weight: 100 }] }, { delayDays: 4, variants: [{ templateId: 't5', weight: 100 }] }],
      notOpened: [{ delayDays: 4, variants: [{ templateId: 't4', weight: 100 }] }, { delayDays: 5, variants: [{ templateId: 't5', weight: 100 }] }] },
    { id: 's2', name: 'SaaS ops leads', status: 'active', mailboxIds: ['mb3hel'], createdAt: '2026-11-02',
      first: { variants: [{ templateId: 't2', weight: 100 }] },
      opened: [{ delayDays: 3, variants: [{ templateId: 't3', weight: 100 }] }],
      notOpened: [{ delayDays: 3, variants: [{ templateId: 't4', weight: 100 }] }] },
    { id: 's3', name: 'Hospitality pilot', status: 'paused', mailboxIds: ['mb2ana'], createdAt: '2026-11-15',
      first: { variants: [{ templateId: 't1', weight: 100 }] }, opened: [], notOpened: [] },
  ];

  const activity = emptyActivity();
  const now = Date.now();
  const tz = config.settings.timezone;
  for (let i = 0; i < 240; i++) {
    const [co, ind] = pick(CO);
    const fn = pick(FIRST); const ln = pick(LAST);
    const id = `c${i}`;
    config.contacts.push({ id, firstName: fn, lastName: ln, company: co, industry: ind,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${co.toLowerCase().replace(/[^a-z]/g, '')}.in`,
      phone: `+91 9${Math.floor(r() * 1e9).toString().padStart(9, '0')}`, createdAt: '2026-10-12', source: i < 160 ? 'd2c-founders.csv' : 'saas-ops.csv' });
    if (i >= 225) continue; // a few not enrolled yet
    const seq = i < 150 ? config.sequences[0] : i < 215 ? config.sequences[1] : config.sequences[2];
    const mb = seq.mailboxIds[i % seq.mailboxIds.length];
    const eid = `e${i}`;
    config.enrollments.push({ id: eid, contactId: id, sequenceId: seq.id, mailboxId: mb, status: 'active', createdAt: seq.createdAt });
    if (seq.status !== 'active' || r() < 0.12) continue; // queued
    const p = newProgress();
    activity.progress[eid] = p;
    const start = now - Math.floor(r() * 26 + 1) * 86400000;
    p.sent = 1 + Math.floor(r() * 2.4);
    p.opened = r() < 0.52;
    p.lastSentAt = new Date(Math.min(now - 3600000, start + (p.sent - 1) * 3 * 86400000)).toISOString();
    p.track = p.sent > 1 ? (p.opened ? 'opened' : 'notOpened') : null;
    p.trackIndex = p.sent - 1;
    const firstTpl = seq.id === 's1' ? (i % 2 ? 't1' : 't2') : 't2';
    p.threadSubject = 'Quick question';
    for (let k = 0; k < p.sent; k++) {
      const at = new Date(start + k * 3 * 86400000);
      if (at.getTime() > now) break;
      const stepKey = k === 0 ? 'first' : `${p.track}.${k - 1}`;
      const tpl = k === 0 ? firstTpl : stepAtDemo(seq, stepKey);
      const day = zoned(at, tz).date;
      const d = activity.daily[day] || (activity.daily[day] = { sent: 0, opened: 0, replied: 0, bounced: 0 });
      d.sent++;
      const vk = `${seq.id}|${stepKey}|${tpl}`;
      const v = activity.variantStats[vk] || (activity.variantStats[vk] = { sent: 0, opened: 0, replied: 0 });
      v.sent++;
      const opened = p.opened && (k === 0 || r() < 0.6);
      if (opened) { d.opened++; v.opened++; }
      p.messages.push({ id: `<demo${i}-${k}@x>`, token: `${i}${k}`, stepKey, templateId: tpl, at: at.toISOString(), openedAt: opened ? at.toISOString() : null });
      activity.events.push({ t: at.toISOString(), type: 'sent', enrollmentId: eid, stepKey });
    }
    if (p.opened && r() < (firstTpl === 't1' ? 0.26 : 0.15)) {
      p.replied = true; p.done = true;
      const lm = p.messages[p.messages.length - 1];
      const at = new Date(new Date(lm.at).getTime() + Math.floor(r() * 20 + 2) * 3600000);
      p.repliedAt = at.toISOString();
      const day = zoned(at, tz).date;
      (activity.daily[day] || (activity.daily[day] = { sent: 0, opened: 0, replied: 0, bounced: 0 })).replied++;
      activity.variantStats[`${seq.id}|${lm.stepKey}|${lm.templateId}`].replied++;
      const c = config.contacts[i];
      activity.replies.push({ id: `r${i}`, enrollmentId: eid, mailboxId: mb, from: c.email, fromName: `${c.firstName} ${c.lastName}`,
        subject: `Re: ${p.threadSubject}`, date: p.repliedAt, auto: false, snippet: pick(SNIPPETS).replace('{co}', c.company) });
      activity.events.push({ t: p.repliedAt, type: 'replied', enrollmentId: eid });
      if (at.getTime() < now - 2 * 86400000) config.repliesRead[`r${i}`] = true;
    } else if (r() < 0.03) {
      p.bounced = true; p.done = true;
      activity.suppressed[config.contacts[i].email] = 'bounced';
    }
  }
  activity.replies.sort((a, b) => b.date.localeCompare(a.date));
  activity.events.sort((a, b) => a.t.localeCompare(b.t));
  const today = zoned(new Date(now), tz).date;
  activity.mailboxDaily = { mb1rah: { date: today, sent: 7 }, mb2ana: { date: today, sent: 5 }, mb3hel: { date: today, sent: 11 } };
  const checked = new Date(now - 7 * 60000).toISOString();
  activity.mailboxStatus = { mb1rah: { ok: true, checkedAt: checked }, mb2ana: { ok: true, checkedAt: checked }, mb3hel: { ok: false, checkedAt: checked, error: 'IMAP: Authentication failed. Check the app password' } };
  activity.lastRunAt = new Date(now - 7 * 60000).toISOString();
  return { config, activity };
}

function stepAtDemo(seq, stepKey) {
  const [track, i] = stepKey.split('.');
  return seq[track]?.[Number(i)]?.variants[0].templateId || 't4';
}

const SNIPPETS = [
  'Hi, this is timely. We lost a few wholesale accounts last quarter without noticing. Can you do Thursday at 4?',
  'Thanks for reaching out. Forwarding to our ops head, she owns retention at {co}.',
  'Not right now, we just signed with another vendor. Check back in Q2.',
  'Interesting. What does pricing look like for around 3,000 orders a month?',
  'Sure, send over a calendar link for next week.',
  'Please remove me from your list.',
];
