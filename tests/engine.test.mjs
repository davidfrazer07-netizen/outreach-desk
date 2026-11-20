import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildMessage, stripQuoted } from '../engine/mail.mjs';
import { newProgress, emptyConfig } from '../app/assets/js/core/schedule.js';
import { encryptJSON, decryptJSON } from '../app/assets/js/core/crypto.js';

const mailbox = { id: 'm1', email: 'rahul@yourco.in', fromName: 'Rahul', signature: 'Rahul\nYourCo' };
const contact = { firstName: 'Asha', lastName: 'Rao', company: 'Rao & Sons', email: 'asha@rao.in' };
const settings = { trackerUrl: 'https://t.example.dev/', unsubscribeLine: true, postalAddress: 'Bengaluru' };

test('first email: merge tags, pixel, unsubscribe link and header', () => {
  const msg = buildMessage({ contact, mailbox, followUp: false }, { subject: 'Hi {{first_name}}', body: 'About {{company}} <3' }, newProgress(), settings, 'a'.repeat(24));
  assert.equal(msg.subject, 'Hi Asha');
  assert.equal(msg.messageId, `<${'a'.repeat(24)}@yourco.in>`);
  assert.match(msg.html, /About Rao &amp; Sons &lt;3/);
  assert.match(msg.html, /https:\/\/t\.example\.dev\/o\/a{24}\.gif/);
  assert.match(msg.text, /Unsubscribe: https:\/\/t\.example\.dev\/u\/a{24}/);
  assert.match(msg.headers['List-Unsubscribe'], /mailto:rahul@yourco\.in/);
  assert.equal(msg.inReplyTo, undefined);
});

test('follow-up with blank subject replies in the same thread', () => {
  const p = { ...newProgress(), sent: 1, threadSubject: 'Hi Asha', firstMessageId: '<x@yourco.in>', messages: [{ id: '<x@yourco.in>' }] };
  const msg = buildMessage({ contact, mailbox, followUp: true }, { subject: '', body: 'Bump' }, p, { unsubscribeLine: false }, 'b'.repeat(24));
  assert.equal(msg.subject, 'Re: Hi Asha');
  assert.equal(msg.inReplyTo, '<x@yourco.in>');
  assert.doesNotMatch(msg.html, /<img/);
});

test('quoted history is dropped from reply snippets', () => {
  assert.equal(stripQuoted('Sounds good, Thursday?\n\nOn Mon, 16 Nov 2026 at 10:02, Rahul wrote:\n> Hi Asha'), 'Sounds good, Thursday?');
});

test('engine dry run plans sends and saves encrypted activity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outreach-'));
  const cfg = emptyConfig();
  cfg.settings = { ...cfg.settings, timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 };
  cfg.mailboxes = [{ id: 'm1', email: 'rahul@yourco.in', dailyLimit: 1, smtpHost: 'x', imapHost: 'x' }];
  cfg.templates = [{ id: 't1', name: 'T', subject: 'Hi {{first_name}}', body: 'Hello' }];
  cfg.sequences = [{ id: 's1', name: 'S', status: 'active', mailboxIds: ['m1'], first: { variants: [{ templateId: 't1', weight: 1 }] }, opened: [], notOpened: [] }];
  for (let i = 0; i < 5; i++) {
    cfg.contacts.push({ id: `c${i}`, firstName: `N${i}`, email: `n${i}@x.com` });
    cfg.enrollments.push({ id: `e${i}`, contactId: `c${i}`, sequenceId: 's1', mailboxId: 'm1', status: 'active', createdAt: `2026-11-0${i + 1}` });
  }
  writeFileSync(join(dir, 'config.enc.json'), JSON.stringify(await encryptJSON(cfg, 'test passphrase 123')));
  const out = execFileSync(process.execPath, ['engine/run.mjs'], {
    env: { ...process.env, DATA_DIR: dir, DRY_RUN: '1', OUTREACH_PASSPHRASE: 'test passphrase 123', SECRETS_JSON: '{}', SEND_GAP_MS: '0' },
  }).toString();
  assert.match(out, /plan: 1 emails/);
  assert.match(out, /\[dry run\] rahul@yourco\.in → n0@x\.com: Hi N0/);
  const act = await decryptJSON(JSON.parse(readFileSync(join(dir, 'activity.enc.json'), 'utf8')), 'test passphrase 123');
  assert.equal(Object.values(act.progress).filter((p) => p.sent === 1).length, 1);
  assert.equal(act.mailboxDaily.m1.sent, 1);
  assert.match(act.mailboxStatus.m1.error, /MAILBOX_M1/);
});
