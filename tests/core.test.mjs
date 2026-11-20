import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON } from '../app/assets/js/core/crypto.js';
import { contactsFromCSV } from '../app/assets/js/core/csv.js';
import { render, textToHtml, unknownTags } from '../app/assets/js/core/merge.js';
import { planRun, nextStep, newProgress, recordSend, emptyActivity, emptyConfig, pickVariant, windowMinutesLeft } from '../app/assets/js/core/schedule.js';

const DAY = 86400000;

test('encrypt/decrypt round trip and wrong passphrase', async () => {
  const box = await encryptJSON({ a: 1, name: 'Zoë' }, 'correct horse battery');
  assert.deepEqual(await decryptJSON(box, 'correct horse battery'), { a: 1, name: 'Zoë' });
  await assert.rejects(decryptJSON(box, 'nope'), /Wrong passphrase/);
});

test('CSV with the expected headers, quotes, duplicates and bad emails', () => {
  const csv = '﻿First name,Last name,company,email,Industry,Phone num\r\n'
    + 'Asha,Rao,"Rao, Sons & Co",ASHA@rao.in,Retail,+91 98200 11111\r\n'
    + 'Ben,Ng,Acme,ben@acme.com,SaaS,\r\n'
    + 'Dup,Ng,Acme,ben@acme.com,SaaS,\r\n'
    + 'Bad,Row,X,not-an-email,,\r\n';
  const r = contactsFromCSV(csv);
  assert.equal(r.contacts.length, 2);
  assert.equal(r.contacts[0].company, 'Rao, Sons & Co');
  assert.equal(r.contacts[0].email, 'asha@rao.in');
  assert.equal(r.contacts[0].phone, '+91 98200 11111');
  assert.equal(r.skipped.length, 2);
  assert.deepEqual(r.missing, []);
});

test('CSV with semicolons and existing emails', () => {
  const r = contactsFromCSV('Email;First name\nold@x.com;A\nnew@x.com;B\n', new Set(['old@x.com']));
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].firstName, 'B');
});

test('merge tags with fallbacks', () => {
  const c = { firstName: 'Asha', company: '' };
  assert.equal(render('Hi {{first_name}}, how is {{company|your team}}?', c), 'Hi Asha, how is your team?');
  assert.deepEqual(unknownTags('{{first_name}} {{title}}'), ['title']);
  assert.match(textToHtml('a <b>\n\nsee https://x.com.'), /&lt;b&gt;.*href="https:\/\/x.com"/s);
});

test('A/B pick is deterministic and roughly follows weights', () => {
  const v = [{ templateId: 'A', weight: 50 }, { templateId: 'B', weight: 50 }];
  assert.equal(pickVariant(v, 'e1:first').templateId, pickVariant(v, 'e1:first').templateId);
  let a = 0;
  for (let i = 0; i < 2000; i++) if (pickVariant(v, `e${i}:first`).templateId === 'A') a++;
  assert.ok(a > 850 && a < 1150, `A got ${a}`);
});

const seq = {
  id: 's1', status: 'active', mailboxIds: ['m1'],
  first: { variants: [{ templateId: 't1', weight: 1 }] },
  opened: [{ delayDays: 2, variants: [{ templateId: 't2', weight: 1 }] }],
  notOpened: [{ delayDays: 4, variants: [{ templateId: 't3', weight: 1 }] }, { delayDays: 3, variants: [{ templateId: 't4', weight: 1 }] }],
};

test('branching: opened goes to opened track after its delay', () => {
  const t0 = Date.UTC(2026, 10, 16, 5);
  const p = { ...newProgress(), sent: 1, lastSentAt: new Date(t0).toISOString(), opened: true };
  assert.equal(nextStep(seq, p, t0 + 1 * DAY).wait, true);
  assert.equal(p.track, 'opened');
  assert.equal(nextStep(seq, p, t0 + 2 * DAY).stepKey, 'opened.0');
});

test('branching: no open → notOpened track after its delay, then done', () => {
  const t0 = Date.UTC(2026, 10, 16, 5);
  const p = { ...newProgress(), sent: 1, lastSentAt: new Date(t0).toISOString() };
  assert.equal(nextStep(seq, p, t0 + 3 * DAY).wait, true);
  assert.equal(p.track, null);
  assert.equal(nextStep(seq, p, t0 + 4 * DAY).stepKey, 'notOpened.0');
  p.trackIndex = 2;
  assert.equal(nextStep(seq, p, t0 + 30 * DAY).done, true);
  const replied = { ...newProgress(), sent: 1, replied: true };
  assert.equal(nextStep(seq, replied, t0).done, true);
});

function fixture(n, limit) {
  const config = emptyConfig();
  config.settings.timezone = 'UTC';
  config.mailboxes = [{ id: 'm1', email: 'a@x.com', dailyLimit: limit }, { id: 'm2', email: 'b@x.com', dailyLimit: 2 }];
  config.sequences = [seq];
  for (let i = 0; i < n; i++) {
    config.contacts.push({ id: `c${i}`, email: `c${i}@y.com` });
    config.enrollments.push({ id: `e${i}`, contactId: `c${i}`, sequenceId: 's1', mailboxId: i % 2 ? 'm2' : 'm1', status: 'active', createdAt: `2026-11-0${(i % 9) + 1}` });
  }
  return config;
}

test('daily limits per mailbox and the send window are respected', () => {
  const config = fixture(20, 5);
  const act = emptyActivity();
  const mon1730 = Date.UTC(2026, 10, 16, 17, 30); // window ends 18:00 → 30 min → 2 runs
  const plan = planRun(config, act, mon1730);
  const per = (id) => plan.filter((p) => p.mailbox.id === id).length;
  assert.equal(per('m1'), 3); // ceil(5/2)
  assert.equal(per('m2'), 1); // ceil(2/2)
  assert.equal(planRun(config, act, Date.UTC(2026, 10, 15, 12)).length, 0); // Sunday
  assert.equal(planRun(config, act, Date.UTC(2026, 10, 16, 20)).length, 0); // after hours
  assert.equal(windowMinutesLeft(new Date(mon1730), config.settings), 30);
});

test('recordSend counts toward the limit; suppressed contacts are skipped', () => {
  const config = fixture(10, 3);
  const act = emptyActivity();
  const now = Date.UTC(2026, 10, 16, 17, 50); // last run of the day → full budget
  const plan = planRun(config, act, now);
  assert.equal(plan.length, 5); // 3 + 2
  for (const item of plan) recordSend(act, item, { messageId: `<${item.enrollment.id}@x>`, token: 't', subject: 'Hi', at: new Date(now).toISOString(), today: '2026-11-16' });
  assert.equal(planRun(config, act, now + 60000).length, 0);
  assert.equal(act.daily['2026-11-16'].sent, 5);
  act.suppressed['c9@y.com'] = 'unsubscribed';
  assert.ok(!planRun(config, act, now + DAY).some((p) => p.contact.email === 'c9@y.com'));
});
