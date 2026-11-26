import { html, icon, $$, fmt, toast, dialog, confirmDialog, ago } from '../ui.js';
import { state, update, newId, setSecret, secretName, freeSlot, MAX_MAILBOXES } from '../store.js';
import { mailboxToday } from '../core/stats.js';
import { zoned, mailboxGap } from '../core/schedule.js';
import { isEmail } from '../core/csv.js';

const GAPS = [0, 15, 20, 30, 45, 60, 90, 120];
const windowLen = () => Math.max(1, ((state.config.settings.endHour ?? 17) - (state.config.settings.startHour ?? 9)) * 60);
const mins = (n) => {
  const r = Math.round(n);
  if (r < 60) return `${r} minutes`;
  if (r % 60 === 0) return r === 60 ? '1 hour' : `${r / 60} hours`;
  return `${Math.floor(r / 60)}h ${r % 60}m`;
};
/** One line telling the user what the pace means for their day. */
function paceHint(limit, gapMinutes) {
  const w = windowLen();
  const gap = mailboxGap({ dailyLimit: limit, gapMinutes }, w);
  const fits = Math.floor(w / gap) + 1;
  if (gapMinutes > 0 && fits < limit) return `At this pace only ${fits} of ${limit} fit in your send window. Shorten the gap or lower the daily limit`;
  return `About one email every ${mins(gap)}, spread across your send window`;
}

const PRESETS = {
  gmail: { label: 'Gmail or Google Workspace', smtpHost: 'smtp.gmail.com', smtpPort: 465, imapHost: 'imap.gmail.com', imapPort: 993, hint: 'Turn on 2-step verification, then create an app password at myaccount.google.com/apppasswords' },
  m365: { label: 'Outlook or Microsoft 365', smtpHost: 'smtp.office365.com', smtpPort: 587, imapHost: 'outlook.office365.com', imapPort: 993, hint: 'Your admin must allow SMTP AUTH for this mailbox. Use an app password if MFA is on' },
  zohoin: { label: 'Zoho Mail (India)', smtpHost: 'smtp.zoho.in', smtpPort: 465, imapHost: 'imap.zoho.in', imapPort: 993, hint: 'Enable IMAP in Zoho settings and use an app-specific password' },
  zoho: { label: 'Zoho Mail (global)', smtpHost: 'smtp.zoho.com', smtpPort: 465, imapHost: 'imap.zoho.com', imapPort: 993, hint: 'Enable IMAP in Zoho settings and use an app-specific password' },
  custom: { label: 'Other (SMTP + IMAP)', smtpHost: '', smtpPort: 465, imapHost: '', imapPort: 993, hint: 'Use the SMTP and IMAP details from your email provider' },
};

function presetFor(m) {
  return Object.entries(PRESETS).find(([k, p]) => k !== 'custom' && p.smtpHost === m?.smtpHost)?.[0] || (m ? 'custom' : 'gmail');
}

async function editMailbox(existing) {
  if (!existing && !freeSlot()) { toast(`Up to ${MAX_MAILBOXES} mailboxes are supported`); return; }
  const m = existing || { id: newId(), slot: freeSlot(), dailyLimit: 20, smtpPort: 465, imapPort: 993, ...PRESETS.gmail };
  const pk = presetFor(existing);
  const hasPass = state.secrets.has(secretName(m));
  const res = await dialog({
    title: existing ? `Edit ${existing.email}` : 'Add a mailbox',
    submit: existing ? 'Save' : 'Add mailbox',
    body: html`<div class="stack">
      <label class="field"><span>Provider</span><select class="input" name="preset">${Object.entries(PRESETS).map(([k, p]) => html`<option value="${k}" ${k === pk ? 'selected' : ''}>${p.label}</option>`)}</select>
        <span class="hint" data-hint>${PRESETS[pk].hint}</span></label>
      <div class="grid-2">
        <label class="field"><span>Email address</span><input class="input" name="email" type="email" required value="${m.email || ''}" placeholder="rahul@yourco.in"></label>
        <label class="field"><span>Sender name</span><input class="input" name="fromName" value="${m.fromName || ''}" placeholder="Rahul Verma"></label>
      </div>
      <label class="field"><span>App password</span><input class="input" name="pass" type="password" ${existing ? '' : 'required'} placeholder="${hasPass ? 'Saved. Leave blank to keep it' : 'From your email provider'}" autocomplete="new-password">
        <span class="hint">Saved as the GitHub secret ${secretName(m)}. It never goes into your data files</span></label>
      <div class="grid-2">
        <label class="field"><span>Emails per day</span><input class="input num" name="dailyLimit" type="number" min="1" max="500" required value="${m.dailyLimit}">
          <span class="hint">Start new mailboxes at 10 to 20 and raise slowly</span></label>
        <label class="field"><span>Send one email every</span><select class="input" name="gapMinutes">${GAPS.map((g) => html`<option value="${g}" ${g === (m.gapMinutes || 0) ? 'selected' : ''}>${g ? mins(g) : 'Spread evenly'}</option>`)}</select>
          <span class="hint" data-pace>${paceHint(m.dailyLimit, m.gapMinutes || 0)}</span></label>
      </div>
      <label class="field"><span>Login username</span><input class="input" name="user" value="${m.user || ''}" placeholder="Same as the email address"></label>
      <details ${pk === 'custom' ? 'open' : ''}><summary class="sec" style="cursor:pointer">Server settings</summary>
        <div class="grid-2" style="margin-top:12px">
          <label class="field"><span>SMTP host</span><input class="input" name="smtpHost" value="${m.smtpHost}"></label>
          <label class="field"><span>SMTP port</span><input class="input num" name="smtpPort" type="number" value="${m.smtpPort}"></label>
          <label class="field"><span>IMAP host</span><input class="input" name="imapHost" value="${m.imapHost}"></label>
          <label class="field"><span>IMAP port</span><input class="input num" name="imapPort" type="number" value="${m.imapPort}"></label>
        </div></details>
      <label class="field"><span>Signature</span><textarea class="input" name="signature" style="min-height:88px" placeholder="Rahul Verma&#10;Growth, YourCo">${m.signature || ''}</textarea></label>
      <div data-err></div>
    </div>`.s,
    onSubmit: async (f) => {
      const err = (msg) => { f.querySelector('[data-err]').innerHTML = html`<div class="note err">${msg}</div>`.s; return false; };
      const email = f.email.value.trim().toLowerCase();
      if (!isEmail(email)) return err('Enter a valid email address');
      if (state.config.mailboxes.some((x) => x.email === email && x.id !== m.id)) return err('That mailbox is already added');
      if (!f.smtpHost.value.trim() || !f.imapHost.value.trim()) return err('SMTP and IMAP hosts are needed');
      const pass = f.pass.value;
      if (pass && state.mode === 'github') {
        try { await setSecret(secretName(m), pass); } catch (e) { return err(`Couldn’t save the password: ${e.message}. Check the token has Secrets read and write`); }
      }
      return {
        ...m, email, fromName: f.fromName.value.trim(), user: f.user.value.trim() || email,
        dailyLimit: Math.max(1, Math.min(500, Math.round(Number(f.dailyLimit.value) || 1))),
        gapMinutes: GAPS.includes(Number(f.gapMinutes.value)) ? Number(f.gapMinutes.value) : 0,
        smtpHost: f.smtpHost.value.trim(), smtpPort: Number(f.smtpPort.value) || 465,
        imapHost: f.imapHost.value.trim(), imapPort: Number(f.imapPort.value) || 993,
        signature: f.signature.value.slice(0, 1000), label: f.fromName.value.trim() || email,
      };
    },
  });
  if (!res) return;
  update((cfg) => {
    const i = cfg.mailboxes.findIndex((x) => x.id === res.id);
    if (i >= 0) cfg.mailboxes[i] = res; else cfg.mailboxes.push(res);
  });
  toast(existing ? 'Mailbox saved' : `${res.email} added`);
}

// Keep the pace line in step with the limit and the gap while the dialog is open
document.addEventListener('input', (e) => {
  const f = e.target.form;
  if (!f || !['dailyLimit', 'gapMinutes'].includes(e.target.name) || !f.querySelector('[data-pace]')) return;
  f.querySelector('[data-pace]').textContent = paceHint(Math.max(1, Number(f.dailyLimit.value) || 1), Number(f.gapMinutes.value) || 0);
});

// Provider preset → fill server fields while the dialog is open
document.addEventListener('change', (e) => {
  if (e.target.name !== 'preset') return;
  const f = e.target.form; const p = PRESETS[e.target.value];
  if (!f || !p) return;
  ['smtpHost', 'smtpPort', 'imapHost', 'imapPort'].forEach((k) => { f[k].value = p[k]; });
  f.querySelector('[data-hint]').textContent = p.hint;
  if (e.target.value === 'custom') f.querySelector('details').open = true;
});

export default {
  rerenderOn: ['activity', 'config', 'secrets'],
  render(root) {
    const { config, activity } = state;
    const today = zoned(new Date(), config.settings.timezone || 'UTC').date;
    const capacity = config.mailboxes.filter((m) => !m.paused).reduce((s, m) => s + (m.dailyLimit || 0), 0);
    const usedAll = config.mailboxes.reduce((s, m) => s + mailboxToday(activity, m, today), 0);

    root.innerHTML = html`
      <div class="page-head"><div><h1>Mailboxes</h1><div class="sub">${fmt(usedAll)} of ${fmt(capacity)} sends used today across ${config.mailboxes.length} ${config.mailboxes.length === 1 ? 'mailbox' : 'mailboxes'}</div></div>
        <div class="actions"><button class="btn primary" id="add">${icon('plus')}Add mailbox</button></div></div>
      ${config.mailboxes.length === 0 ? html`<div class="card empty"><h3>Add the mailboxes you send from</h3>
        <p>Each one gets its own daily limit, for example 5 a day from a new address and 30 from a warmed-up one. Replies are picked up from each inbox.</p>
        <button class="btn primary" id="add2">${icon('plus')}Add mailbox</button></div>` : html`
      <section class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Mailbox</th><th>Today</th><th class="num">Per day</th><th>Password</th><th>Last check</th><th>Sequences</th><th></th></tr></thead>
        <tbody>${config.mailboxes.map((m) => {
          const used = mailboxToday(activity, m, today);
          const st = activity.mailboxStatus[m.id] || {};
          const err = st.sendError || st.error;
          const pass = state.mode === 'demo' || state.secrets.has(secretName(m));
          const seqs = config.sequences.filter((s) => s.mailboxIds.includes(m.id)).length;
          return html`<tr>
            <td style="max-width:320px"><div>${m.email}</div><div class="muted" style="font-size:12px;line-height:16px">${m.fromName || ''}${m.paused ? ' · paused' : ''}</div></td>
            <td style="min-width:180px">${(m.dailyLimit || 0) <= 40
              ? html`<div class="allow" title="${used} of ${m.dailyLimit} sent today">${Array.from({ length: m.dailyLimit }, (_, i) => html`<i class="${i < used ? 'used' : ''}"></i>`)}</div>`
              : html`<div class="row" style="gap:8px"><div class="allow-bar" style="width:120px"><i style="width:${Math.min(100, (used / m.dailyLimit) * 100)}%"></i></div><span class="mono muted">${used}</span></div>`}</td>
            <td class="num"><input class="input sm num" type="number" min="1" max="500" value="${m.dailyLimit}" data-limit="${m.id}" style="width:68px;text-align:right" aria-label="Daily limit for ${m.email}"></td>
            <td>${pass ? html`<span class="tag"><span class="dot ok"></span>Saved</span>` : html`<button class="btn sm" data-edit="${m.id}">${icon('lock')}Set password</button>`}</td>
            <td style="max-width:260px" title="${err || ''}">${err ? html`<span class="tag" style="color:var(--neg)"><span class="dot err"></span>${err.slice(0, 48)}</span>`
              : st.checkedAt ? html`<span class="tag"><span class="dot ok"></span>${ago(st.checkedAt)}</span>` : html`<span class="muted">Not yet</span>`}</td>
            <td class="sec num">${seqs}</td>
            <td style="text-align:right"><span class="row" style="gap:4px;justify-content:flex-end">
              <button class="btn ghost sm" data-pause="${m.id}">${m.paused ? 'Resume' : 'Pause'}</button>
              <button class="btn ghost sm" data-edit="${m.id}">Edit</button>
              <button class="btn ghost sm icon danger" data-del="${m.id}" aria-label="Remove ${m.email}">${icon('trash')}</button></span></td></tr>`;
        })}</tbody></table></div></section>
      <p class="muted" style="font-size:12px;margin:12px 0 0">Each run spreads the rest of a mailbox’s daily limit over the hours left in the send window, so emails go out steadily, not in one burst</p>`}`.s;

    root.querySelector('#add')?.addEventListener('click', () => editMailbox());
    root.querySelector('#add2')?.addEventListener('click', () => editMailbox());
    $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => editMailbox(config.mailboxes.find((m) => m.id === b.dataset.edit))));
    $$('[data-limit]', root).forEach((inp) => inp.addEventListener('change', () => {
      const v = Math.max(1, Math.min(500, Math.round(Number(inp.value) || 1)));
      update((cfg) => { cfg.mailboxes.find((m) => m.id === inp.dataset.limit).dailyLimit = v; });
      toast(`Limit set to ${v} a day`);
    }));
    $$('[data-pause]', root).forEach((b) => b.addEventListener('click', () => update((cfg) => {
      const m = cfg.mailboxes.find((x) => x.id === b.dataset.pause); m.paused = !m.paused;
    })));
    $$('[data-del]', root).forEach((b) => b.addEventListener('click', async () => {
      const m = config.mailboxes.find((x) => x.id === b.dataset.del);
      const n = config.enrollments.filter((e) => e.mailboxId === m.id && e.status === 'active').length;
      if (!(await confirmDialog(`Remove ${m.email}`, n ? `${fmt(n)} contacts are mid-sequence on this mailbox and will stop getting follow-ups. Delete the ${secretName(m)} secret in GitHub too.` : `Delete the ${secretName(m)} secret in GitHub too.`, 'Remove'))) return;
      update((cfg) => {
        cfg.mailboxes = cfg.mailboxes.filter((x) => x.id !== m.id);
        cfg.sequences.forEach((s) => { s.mailboxIds = s.mailboxIds.filter((x) => x !== m.id); });
        cfg.enrollments.forEach((e) => { if (e.mailboxId === m.id && e.status === 'active') e.status = 'paused'; });
      });
    }));
  },
};
