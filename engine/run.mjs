// Outreach engine. Runs every 15 minutes on GitHub Actions.
//   1. pull opens and unsubscribes from the tracker
//   2. scan each mailbox for replies and bounces
//   3. send what is due, within each mailbox's daily limit
//   4. notify about new replies, then save activity (encrypted)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { encryptJSON, decryptJSON, randomId } from '../app/assets/js/core/crypto.js';
import { planRun, recordSend, bump, bumpVariant, pushEvent, emptyActivity, zoned } from '../app/assets/js/core/schedule.js';
import { buildMessage, send, scanInbox, notifyMail, closeTransports, passwordFor, secretName } from './mail.mjs';
import { pullTracker } from './tracker.mjs';

const ROOT = process.env.DATA_DIR ? new URL(`file://${process.env.DATA_DIR.replace(/\/?$/, '/')}`) : new URL('../data/', import.meta.url);
const CONFIG = new URL('config.enc.json', ROOT);
const ACTIVITY = new URL('activity.enc.json', ROOT);
const DRY = process.env.DRY_RUN === '1';
const GAP_MS = Number(process.env.SEND_GAP_MS ?? 12000);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const passphrase = process.env.OUTREACH_PASSPHRASE;
  const secrets = process.env; // MAILBOX_1 … MAILBOX_20 are mapped in the workflow
  if (!existsSync(CONFIG)) { log('Not set up yet: open the dashboard and connect this repo.'); return; }
  if (!passphrase) throw new Error('OUTREACH_PASSPHRASE secret is not set. Save it again from the dashboard Settings page');

  const config = await decryptJSON(JSON.parse(await readFile(CONFIG, 'utf8')), passphrase);
  const activity = existsSync(ACTIVITY)
    ? await decryptJSON(JSON.parse(await readFile(ACTIVITY, 'utf8')), passphrase)
    : emptyActivity();
  const before = JSON.stringify(activity);
  const settings = config.settings || {};
  const now = new Date();
  const today = zoned(now, settings.timezone || 'UTC').date;
  const enrollments = new Map(config.enrollments.map((e) => [e.id, e]));
  const contacts = new Map(config.contacts.map((c) => [c.id, c]));
  const seqs = new Map(config.sequences.map((s) => [s.id, s]));

  // Lookups shared by tracker and inbox scanning
  const byToken = new Map();
  const byMsgId = new Map();
  for (const [eid, p] of Object.entries(activity.progress)) {
    for (const m of p.messages || []) { byToken.set(m.token, { eid, m }); byMsgId.set(m.id, eid); }
  }
  const lastMessage = (eid) => { const ms = activity.progress[eid]?.messages || []; return ms[ms.length - 1]; };

  function markOpened(eid, m, at) {
    const p = activity.progress[eid];
    if (!p || m.openedAt) return;
    m.openedAt = at;
    if (!p.opened) { p.opened = true; p.openedAt = at; }
    bump(activity, zoned(new Date(at), settings.timezone || 'UTC').date, 'opened');
    bumpVariant(activity, enrollments.get(eid)?.sequenceId, m.stepKey, m.templateId, 'opened');
    pushEvent(activity, { t: at, type: 'opened', enrollmentId: eid, stepKey: m.stepKey });
  }

  function suppress(eid, reason, at) {
    const p = activity.progress[eid];
    const c = contacts.get(enrollments.get(eid)?.contactId);
    if (p) { p.unsubscribed = reason === 'unsubscribed' || p.unsubscribed; p.done = true; }
    if (c) activity.suppressed[c.email] = reason;
    pushEvent(activity, { t: at, type: reason, enrollmentId: eid });
  }

  // 1. Tracker
  if (settings.trackerUrl && process.env.TRACKER_TOKEN) {
    try {
      const { opens, unsubs } = await pullTracker(settings.trackerUrl, process.env.TRACKER_TOKEN);
      for (const o of opens) { const hit = byToken.get(o.token); if (hit) markOpened(hit.eid, hit.m, o.at); }
      for (const u of unsubs) { const hit = byToken.get(u.token); if (hit) suppress(hit.eid, 'unsubscribed', u.at); }
      log(`tracker: ${opens.length} opens, ${unsubs.length} unsubscribes`);
    } catch (err) { log('tracker error:', err.message); }
  }

  // 2. Inboxes
  const newReplies = [];
  for (const mb of config.mailboxes) {
    if (!passwordFor(mb, secrets)) {
      activity.mailboxStatus[mb.id] = { ...activity.mailboxStatus[mb.id], ok: false, error: `Secret ${secretName(mb)} is missing`, checkedAt: now.toISOString() };
      continue;
    }
    const lookup = {
      byMessageId: (refs) => refs.map((r) => byMsgId.get(r)).find(Boolean),
      byFrom: (addr, mailboxId) => config.enrollments.find((e) => e.mailboxId === mailboxId
        && contacts.get(e.contactId)?.email === addr && (activity.progress[e.id]?.sent || 0) > 0)?.id,
      byEmailInText: (text) => {
        const low = text.toLowerCase();
        return config.enrollments.find((e) => e.mailboxId === mb.id && (activity.progress[e.id]?.sent || 0) > 0
          && low.includes(contacts.get(e.contactId)?.email || '\u0000'))?.id;
      },
    };
    try {
      const res = await scanInbox(mb, secrets, activity.mailboxStatus[mb.id], lookup);
      activity.mailboxStatus[mb.id] = { ok: true, error: null, checkedAt: now.toISOString(), lastUid: res.lastUid, uidValidity: res.uidValidity };
      for (const f of res.found) {
        const p = activity.progress[f.enrollmentId];
        if (!p) continue;
        const lm = lastMessage(f.enrollmentId);
        if (f.kind === 'bounce') {
          if (p.bounced) continue;
          p.bounced = true; p.done = true;
          bump(activity, today, 'bounced');
          suppress(f.enrollmentId, 'bounced', now.toISOString());
          continue;
        }
        if (activity.replies.some((r) => r.enrollmentId === f.enrollmentId && r.date === f.date)) continue;
        const reply = { id: randomId(6), enrollmentId: f.enrollmentId, mailboxId: mb.id, from: f.from, fromName: f.fromName,
          subject: f.subject, snippet: f.snippet, date: f.date, auto: f.kind === 'auto' };
        activity.replies.unshift(reply);
        if (reply.auto) continue; // out-of-office: keep the sequence going
        if (lm && !lm.openedAt) markOpened(f.enrollmentId, lm, f.date); // a reply implies an open
        if (!p.replied) {
          p.replied = true; p.repliedAt = f.date; p.done = true;
          bump(activity, today, 'replied');
          if (lm) bumpVariant(activity, enrollments.get(f.enrollmentId)?.sequenceId, lm.stepKey, lm.templateId, 'replied');
          pushEvent(activity, { t: f.date, type: 'replied', enrollmentId: f.enrollmentId });
        }
        if (f.unsubscribe) suppress(f.enrollmentId, 'unsubscribed', f.date);
        newReplies.push({ reply, mailbox: mb });
      }
      log(`${mb.email}: ${res.found.length} new matching messages`);
    } catch (err) {
      activity.mailboxStatus[mb.id] = { ...activity.mailboxStatus[mb.id], ok: false, error: `IMAP: ${err.message}`, checkedAt: now.toISOString() };
      log(`${mb.email} IMAP error:`, err.message);
    }
  }
  if (activity.replies.length > 2000) activity.replies.length = 2000;

  // 3. Send
  const templates = new Map(config.templates.map((t) => [t.id, t]));
  const plan = planRun(config, activity, now.getTime());
  log(`plan: ${plan.length} emails`);
  for (const [i, item] of plan.entries()) {
    const mb = item.mailbox;
    if (!passwordFor(mb, secrets) && !DRY) continue;
    const tpl = templates.get(item.templateId);
    if (!tpl) continue;
    const token = randomId(12);
    const msg = buildMessage(item, tpl, activity.progress[item.enrollment.id], settings, token);
    try {
      if (DRY) log(`[dry run] ${mb.email} → ${msg.to.address || msg.to}: ${msg.subject}`);
      else await send(mb, secrets, msg);
      recordSend(activity, item, { messageId: msg.messageId, token, subject: msg.subject, at: new Date().toISOString(), today });
      activity.mailboxStatus[mb.id] = { ...activity.mailboxStatus[mb.id], ok: true, sendError: null };
    } catch (err) {
      activity.mailboxStatus[mb.id] = { ...activity.mailboxStatus[mb.id], ok: false, sendError: `SMTP: ${err.message}`, checkedAt: now.toISOString() };
      log(`${mb.email} SMTP error:`, err.message);
    }
    if (i < plan.length - 1 && !DRY) await sleep(GAP_MS * (0.6 + Math.random() * 0.8));
  }

  // 4. Notify
  const repo = process.env.GITHUB_REPOSITORY || '';
  const [owner, name] = repo.split('/');
  const dashUrl = owner ? `https://${owner}.github.io/${name}/#/replies` : '';
  for (const { reply, mailbox } of newReplies) {
    const e = enrollments.get(reply.enrollmentId);
    const c = contacts.get(e?.contactId) || {};
    const who = [c.firstName, c.lastName].filter(Boolean).join(' ') || reply.from;
    const seqName = seqs.get(e?.sequenceId)?.name || 'a sequence';
    try {
      if (settings.notifyEmail && !DRY) {
        await notifyMail(mailbox, secrets, { to: settings.notifyEmail,
          subject: `Reply from ${who}${c.company ? ` (${c.company})` : ''}: ${reply.subject}`,
          text: `${who} <${reply.from}> replied to ${seqName} in ${mailbox.email}.\n\n${reply.snippet}\n\n${dashUrl}` });
      }
      if (settings.ntfyTopic && !DRY) {
        await fetch(`https://ntfy.sh/${encodeURIComponent(settings.ntfyTopic)}`, {
          method: 'POST', body: `${who.split(' ')[0]} replied in ${seqName}`,
          headers: { Title: 'New reply', Tags: 'email', ...(dashUrl ? { Click: dashUrl } : {}) },
        });
      }
    } catch (err) { log('notify error:', err.message); }
  }

  closeTransports();
  if (JSON.stringify(activity) !== before) {
    activity.lastRunAt = now.toISOString();
    await writeFile(ACTIVITY, JSON.stringify(await encryptJSON(activity, passphrase)) + '\n');
    log('activity saved');
  } else log('no changes');
}

main().catch((err) => { console.error(err); closeTransports(); process.exit(1); });
