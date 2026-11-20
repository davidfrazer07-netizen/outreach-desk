// SMTP sending and IMAP reply/bounce detection.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { render, textToHtml } from '../app/assets/js/core/merge.js';

const transports = new Map();

export function passwordFor(mailbox, secrets) {
  return secrets[`MAILBOX_${mailbox.id.toUpperCase()}`] || '';
}

function transportFor(mailbox, secrets) {
  if (!transports.has(mailbox.id)) {
    const port = Number(mailbox.smtpPort) || 465;
    transports.set(mailbox.id, nodemailer.createTransport({
      host: mailbox.smtpHost, port, secure: port === 465,
      auth: { user: mailbox.user || mailbox.email, pass: passwordFor(mailbox, secrets) },
      pool: true, maxConnections: 1,
    }));
  }
  return transports.get(mailbox.id);
}

export function closeTransports() {
  for (const t of transports.values()) t.close();
  transports.clear();
}

/** Build the message for one planned send. Pure apart from the token passed in. */
export function buildMessage(item, template, progress, settings, token) {
  const { contact, mailbox } = item;
  const extra = { senderName: mailbox.fromName || '' };
  const domain = mailbox.email.split('@')[1];
  const messageId = `<${token}@${domain}>`;
  const threaded = item.followUp && !String(template.subject || '').trim() && progress.firstMessageId;
  const subject = threaded
    ? `Re: ${progress.threadSubject}`
    : render(template.subject, contact, extra) || progress.threadSubject || '(no subject)';

  let text = render(template.body, contact, extra).trim();
  if (mailbox.signature) text += `\n\n${mailbox.signature.trim()}`;
  let html = textToHtml(text);

  const base = String(settings.trackerUrl || '').replace(/\/+$/, '');
  const unsubUrl = base ? `${base}/u/${token}` : '';
  if (settings.unsubscribeLine) {
    const addr = settings.postalAddress ? `${settings.postalAddress} · ` : '';
    if (unsubUrl) {
      text += `\n\n${addr}Not relevant? Unsubscribe: ${unsubUrl}`;
      html += `<p style="margin:16px 0 0;color:#888;font-size:12px">${addr}Not relevant? <a href="${unsubUrl}" style="color:#888">Unsubscribe</a></p>`;
    } else {
      text += `\n\n${addr}Not relevant? Reply “unsubscribe” and I won’t email again.`;
    }
  }
  if (base) html += `<img src="${base}/o/${token}.gif" width="1" height="1" alt="" style="display:block;border:0">`;

  const headers = {
    'List-Unsubscribe': [unsubUrl && `<${unsubUrl}>`, `<mailto:${mailbox.email}?subject=unsubscribe>`].filter(Boolean).join(', '),
  };
  if (unsubUrl) headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';

  const msg = {
    from: mailbox.fromName ? { name: mailbox.fromName, address: mailbox.email } : mailbox.email,
    to: contact.firstName ? { name: `${contact.firstName} ${contact.lastName || ''}`.trim(), address: contact.email } : contact.email,
    subject, text, html, messageId, headers,
  };
  if (threaded) {
    const refs = progress.messages.map((m) => m.id);
    msg.inReplyTo = refs[refs.length - 1];
    msg.references = refs.join(' ');
  }
  return msg;
}

export async function send(mailbox, secrets, msg) {
  await transportFor(mailbox, secrets).sendMail(msg);
}

export async function notifyMail(mailbox, secrets, { to, subject, text }) {
  await transportFor(mailbox, secrets).sendMail({ from: mailbox.email, to, subject, text });
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJ = /undeliver|delivery status|returned mail|failure notice|delivery failed|could not be delivered/i;
const AUTO_SUBJ = /automatic reply|auto(-|\s)?reply|out of (the )?office|away from|on leave|vacation/i;

/**
 * Scan a mailbox's INBOX for new messages since the last check.
 * Returns { lastUid, uidValidity, found: [{ kind: 'reply'|'auto'|'bounce', ... }] }.
 */
export async function scanInbox(mailbox, secrets, state, lookup) {
  const client = new ImapFlow({
    host: mailbox.imapHost, port: Number(mailbox.imapPort) || 993, secure: true,
    auth: { user: mailbox.user || mailbox.email, pass: passwordFor(mailbox, secrets) },
    logger: false, socketTimeout: 60000,
  });
  const found = [];
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  let lastUid = state?.lastUid || 0;
  let uidValidity;
  try {
    uidValidity = String(client.mailbox.uidValidity);
    const fresh = !state || state.uidValidity !== uidValidity;
    const query = fresh ? { since: new Date(Date.now() - 7 * 86400000) } : { uid: `${lastUid + 1}:*` };
    const uids = (await client.search(query, { uid: true })) || [];
    for (const uid of uids.slice(-300)) {
      if (!fresh && uid <= lastUid) continue;
      lastUid = Math.max(lastUid, uid);
      const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!m?.source) continue;
      const mail = await simpleParser(m.source);
      const fromAddr = (mail.from?.value?.[0]?.address || '').toLowerCase();
      const subject = mail.subject || '';
      const text = String(mail.text || '');
      if (BOUNCE_FROM.test(fromAddr) || BOUNCE_SUBJ.test(subject)) {
        const hit = lookup.byEmailInText(text);
        if (hit) found.push({ kind: 'bounce', enrollmentId: hit, subject });
        continue;
      }
      const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : [mail.references])].filter(Boolean);
      const enrollmentId = lookup.byMessageId(refs) || lookup.byFrom(fromAddr, mailbox.id);
      if (!enrollmentId) continue;
      const auto = /auto-replied|auto-generated/i.test(String(mail.headers.get('auto-submitted') || '')) || AUTO_SUBJ.test(subject);
      const snippet = stripQuoted(text).slice(0, 600);
      const unsubscribe = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending))\b/i.test(snippet.slice(0, 300)) || /^unsubscribe$/i.test(subject.trim());
      found.push({
        kind: auto ? 'auto' : 'reply', enrollmentId, unsubscribe,
        from: fromAddr, fromName: mail.from?.value?.[0]?.name || '', subject, snippet,
        date: (mail.date || new Date()).toISOString(),
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { lastUid, uidValidity, found };
}

/** Drop the quoted history under "On … wrote:" so the snippet is just the new reply. */
export function stripQuoted(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^On .+wrote:$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line)) break;
    if (line.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}
