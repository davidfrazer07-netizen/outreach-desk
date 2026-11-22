import { html, icon, $, $$, toast, download, ago, confirmDialog } from '../ui.js';
import { state, update, setSecret, runEngine, refreshSecrets, refreshRun, forgetConnection, secretName } from '../store.js';
import { randomId } from '../core/crypto.js';
import { aiSettings, saveAi, forgetAi, listModels, defaultModel, checkKey } from '../ai.js';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York']; } })();

function secretRow(name, have, hint) {
  return html`<div class="row" style="justify-content:space-between;min-height:36px;border-top:1px solid var(--line);padding:8px 0">
    <div><code>${name}</code><div class="muted" style="font-size:12px;line-height:16px;margin-top:4px">${hint}</div></div>
    <span class="tag"><span class="dot ${have ? 'ok' : 'err'}"></span>${have ? 'Set' : 'Missing'}</span></div>`;
}

function voiceCount(text = '') {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return words ? `${words.toLocaleString('en-IN')} words, about ${Math.round(words * 1.4).toLocaleString('en-IN')} tokens per request. Your merge tags, signature and unsubscribe line still come from this app`
    : 'Empty, so the AI uses a plain, short default voice';
}

// Reads .md files, drops YAML front matter, and joins them under their file names.
async function readVoiceFiles(files) {
  let name = '';
  const parts = [];
  for (const f of files) {
    let text = (await f.text()).replace(/\r/g, '');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      const n = fm[1].match(/^name:\s*["']?([\w-]+)/m);
      if (n && !name) name = n[1].split('-')[0].replace(/^\w/, (c) => c.toUpperCase());
      text = text.slice(fm[0].length);
    }
    parts.push(`# File: ${f.name}\n\n${text.trim()}`);
  }
  return { name, text: parts.join('\n\n---\n\n') };
}

export default {
  rerenderOn: ['secrets', 'run'],
  render(root) {
    const s = state.config.settings;
    const demo = state.mode === 'demo';
    const sec = state.secrets;
    const run = state.lastRun;
    const hour = (n) => `${String(n).padStart(2, '0')}:00`;
    const ai = aiSettings();
    const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];

    root.innerHTML = html`
      <div class="page-head"><div><h1>Settings</h1><div class="sub">${demo ? 'Sample data. Nothing here is saved' : `Saved to ${state.conn.owner}/${state.conn.repo}`}</div></div></div>
      <div class="stack" style="max-width:880px">
        <section class="card"><div class="card-head"><h2>Send window</h2></div><div class="card-pad stack">
          <div class="grid-3">
            <label class="field"><span>Time zone</span><select class="input" data-s="timezone">${zones.map((z) => html`<option ${z === s.timezone ? 'selected' : ''}>${z}</option>`)}</select></label>
            <label class="field"><span>From</span><select class="input" data-s="startHour" data-n>${Array.from({ length: 24 }, (_, i) => html`<option value="${i}" ${i === s.startHour ? 'selected' : ''}>${hour(i)}</option>`)}</select></label>
            <label class="field"><span>Until</span><select class="input" data-s="endHour" data-n>${Array.from({ length: 24 }, (_, i) => i + 1).map((i) => html`<option value="${i}" ${i === s.endHour ? 'selected' : ''}>${hour(i % 24)}</option>`)}</select></label>
          </div>
          <div class="field"><span>Days</span><div class="days">${DAYS.map(([d, l]) => html`<label><input type="checkbox" data-day="${d}" ${s.days.includes(d) ? 'checked' : ''}><span>${l}</span></label>`)}</div></div>
        </div></section>

        <section class="card"><div class="card-head"><h2>Reply alerts</h2></div><div class="card-pad stack">
          <label class="field"><span>Email me at</span><input class="input" type="email" data-s="notifyEmail" value="${s.notifyEmail}" placeholder="you@yourco.in">
            <span class="hint">Every reply is forwarded here from the mailbox that received it</span></label>
          <label class="field"><span>Phone push via ntfy (optional)</span><input class="input" data-s="ntfyTopic" value="${s.ntfyTopic}" placeholder="outreach-${randomId(4)}">
            <span class="hint">Install the free ntfy app and subscribe to this topic. Pick something hard to guess. Only first names are sent</span></label>
        </div></section>

        <section class="card"><div class="card-head"><h2>Open tracking and unsubscribes</h2></div><div class="card-pad stack">
          <label class="field"><span>Tracker URL</span><input class="input" data-s="trackerUrl" value="${s.trackerUrl}" placeholder="https://eva-tracker.your-name.workers.dev">
            <span class="hint">Your Cloudflare Worker from the worker folder. Without it, everyone goes down the “not opened” track and unsubscribes work by reply only</span></label>
          <div class="row" style="justify-content:space-between;flex-wrap:wrap">
            <div><div>Tracker token</div><div class="muted" style="font-size:12px">Shared secret between the engine and the Worker</div></div>
            <button class="btn" id="gen-token" ${demo ? 'disabled' : ''}>${icon('refresh')}${sec.has('TRACKER_TOKEN') ? 'Replace token' : 'Create token'}</button></div>
          <div id="token-out"></div>
          <label class="check"><input type="checkbox" data-s="unsubscribeLine" data-b ${s.unsubscribeLine ? 'checked' : ''}> Add an unsubscribe line to every email</label>
          <label class="field"><span>Postal address in the footer</span><input class="input" data-s="postalAddress" value="${s.postalAddress}" placeholder="YourCo, 2nd floor, Indiranagar, Bengaluru 560038">
            <span class="hint">Required for cold email in the US (CAN-SPAM) and good practice everywhere</span></label>
        </div></section>

        ${demo ? '' : html`<section class="card"><div class="card-head"><h2>Engine</h2>
            <div class="right"><button class="btn sm" id="dry">${icon('eye')}Dry run</button><button class="btn sm primary" id="run">${icon('play')}Run now</button></div></div>
          <div class="card-pad">
            <p class="sec" style="margin:0 0 12px">Runs on GitHub Actions every 15 minutes. ${run ? html`Last run ${ago(run.at)}, ${run.status === 'completed' ? run.conclusion : run.status}. ${run.url ? html`<a href="${run.url}" target="_blank" rel="noopener">See log</a>` : ''}` : 'It hasn’t run yet.'} A dry run plans the sends and writes the log without emailing anyone</p>
            ${secretRow('OUTREACH_PASSPHRASE', sec.has('OUTREACH_PASSPHRASE'), 'Lets the engine decrypt your data. Set automatically when you connected')}
            ${secretRow('TRACKER_TOKEN', sec.has('TRACKER_TOKEN'), 'Only needed with open tracking')}
            ${state.config.mailboxes.map((m) => secretRow(secretName(m), sec.has(secretName(m)), `App password for ${m.email}`))}
            <div class="row" style="margin-top:12px"><button class="btn sm" id="fix-pass">${icon('lock')}Save passphrase secret again</button><button class="btn ghost sm" id="re-sec">${icon('refresh')}Recheck</button></div>
          </div></section>`}

        <section class="card"><div class="card-head"><h2>AI writing</h2></div><div class="card-pad stack">
          <p class="sec" style="margin:0">Powers Write with AI and Edit with AI in Templates, through OpenRouter. The key stays in this browser only and is never saved to GitHub</p>
          ${ai.key ? html`<div class="row" style="justify-content:space-between;flex-wrap:wrap">
              <div><div>Key saved on this device</div><div class="muted" style="font-size:12px"><code>sk-or-…${ai.key.slice(-4)}</code> <span id="ai-usage"></span></div></div>
              <div class="row"><button class="btn sm" id="ai-check">${icon('refresh')}Check credit</button><button class="btn ghost sm danger" id="ai-forget">Remove key</button></div></div>`
            : html`<div class="row" style="align-items:end;flex-wrap:wrap">
              <label class="field" style="flex:1;min-width:240px"><span>OpenRouter key</span><input class="input" type="password" id="ai-key" autocomplete="off" spellcheck="false" placeholder="sk-or-v1-…"></label>
              <button class="btn primary" id="ai-save">Save key</button></div>
              <span class="hint">Create one at openrouter.ai/keys and give it a credit limit. Free models cost nothing</span>`}
          <label class="field"><span>Model</span><select class="input" id="ai-model"><option>${ai.model || 'Loading models…'}</option></select>
            <span class="hint">Free models are listed first. They can be slow or busy at peak times. Paid ones like Claude Sonnet write better and cost well under ₹1 per draft</span></label>
        </div></section>

        <section class="card"><div class="card-head"><h2>Writer voice</h2>
            <div class="right"><button class="btn sm" id="voice-import">${icon('upload')}Import .md files</button><input type="file" id="voice-file" accept=".md,.markdown,.txt" multiple hidden></div></div>
          <div class="card-pad stack">
          <p class="sec" style="margin:0">Teach the AI how you write. Import a skill file and its playbook, like Alex’s SKILL.md and playbook.md, or paste your own rules and example emails. It is sent with every AI request and saved in your encrypted config</p>
          <label class="field" style="max-width:280px"><span>Name</span><input class="input" data-s="writerName" maxlength="40" value="${s.writerName || ''}" placeholder="Alex"></label>
          <label class="field"><span>Voice, rules and playbook</span><textarea class="input" id="voice-text" data-s="writerProfile" maxlength="60000" rows="12" placeholder="Every email: subject 3 to 7 words, body under 120 words, opens with Hi {FirstName}, problem first, one idea, soft question to close…">${s.writerProfile || ''}</textarea>
            <span class="hint" id="voice-count">${voiceCount(s.writerProfile)}</span></label>
        </div></section>

        <section class="card"><div class="card-head"><h2>Data</h2></div><div class="card-pad row" style="flex-wrap:wrap">
          <button class="btn" id="backup">${icon('download')}Download backup</button>
          <span class="muted" style="font-size:12px;flex:1;min-width:200px">A readable JSON copy of contacts, templates, sequences and settings. Store it somewhere private</span>
          <button class="btn danger" id="forget">${demo ? 'Leave sample data' : 'Sign out on this device'}</button>
        </div></section>
      </div>`.s;

    $$('[data-s]', root).forEach((el) => el.addEventListener('change', () => {
      let v = el.dataset.b !== undefined ? el.checked : el.value.trim();
      if (el.dataset.n !== undefined) v = Number(v);
      if (el.dataset.s === 'trackerUrl' && v && !/^https:\/\/[^\s/]+/.test(v)) { toast('Tracker URL must start with https://'); return; }
      if (el.dataset.s === 'ntfyTopic') v = v.replace(/[^\w-]/g, '').slice(0, 64);
      update((cfg) => { cfg.settings[el.dataset.s] = v; }, { silent: true });
      if (el.dataset.s === 'endHour' || el.dataset.s === 'startHour') {
        if (state.config.settings.endHour <= state.config.settings.startHour) toast('The window ends before it starts, so nothing will send');
      }
    }));
    $$('[data-day]', root).forEach((cb) => cb.addEventListener('change', () => update((cfg) => {
      const d = Number(cb.dataset.day);
      cfg.settings.days = cb.checked ? [...new Set([...cfg.settings.days, d])] : cfg.settings.days.filter((x) => x !== d);
    }, { silent: true })));

    $('#gen-token', root)?.addEventListener('click', async () => {
      const token = randomId(24);
      try {
        await setSecret('TRACKER_TOKEN', token);
        $('#token-out', root).innerHTML = html`<div class="note"><div>Saved for the engine. Now give the same token to your Worker, once:</div>
          <div class="row" style="margin-top:8px"><code style="flex:1;overflow:auto">cd worker && npx wrangler secret put TRACKER_TOKEN</code></div>
          <div class="row" style="margin-top:8px"><code style="flex:1;overflow:auto" id="tok">${token}</code><button class="btn sm" id="copy-tok">${icon('copy')}Copy</button></div>
          <div class="muted" style="margin-top:8px;font-size:12px">This is the only time it’s shown</div></div>`.s;
        $('#copy-tok', root).addEventListener('click', () => navigator.clipboard.writeText(token).then(() => toast('Copied')));
      } catch (e) { toast(e.message); }
    });
    $('#run', root)?.addEventListener('click', () => runEngine(false).then(() => toast('Engine started')).catch((e) => toast(e.message)));
    $('#dry', root)?.addEventListener('click', () => runEngine(true).then(() => toast('Dry run started. Open the log in a minute')).catch((e) => toast(e.message)));
    $('#re-sec', root)?.addEventListener('click', () => { refreshSecrets().catch((e) => toast(e.message)); refreshRun().catch(() => {}); });
    $('#fix-pass', root)?.addEventListener('click', () => setSecret('OUTREACH_PASSPHRASE', state.conn.passphrase).then(() => toast('Passphrase secret saved')).catch((e) => toast(e.message)));
    $('#voice-text', root).addEventListener('input', (e) => { $('#voice-count', root).textContent = voiceCount(e.target.value); });
    $('#voice-import', root).addEventListener('click', () => $('#voice-file', root).click());
    $('#voice-file', root).addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      if (files.some((f) => f.size > 200000)) { toast('One of those files is over 200 KB. Trim it first'); return; }
      const { name, text } = await readVoiceFiles(files);
      if (text.length > 60000) { toast('That’s more than 60,000 characters. Import fewer files or trim the playbook'); return; }
      if (s.writerProfile?.trim() && !(await confirmDialog('Replace the writer voice', 'The current voice text is replaced by the imported files.', 'Replace'))) return;
      update((cfg) => { cfg.settings.writerProfile = text; if (!cfg.settings.writerName && name) cfg.settings.writerName = name; }, { silent: true });
      toast(`Imported ${files.length} file${files.length > 1 ? 's' : ''}`);
      this.render(root);
    });
    const sel = $('#ai-model', root);
    listModels().then((models) => {
      const cur = ai.model || defaultModel(models);
      if (!ai.model && cur) saveAi({ model: cur });
      const opt = (m) => html`<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.name}${m.free ? '' : ` · $${m.in.toFixed(2)} in, $${m.out.toFixed(2)} out per M tokens`}</option>`;
      sel.innerHTML = html`<optgroup label="Free">${models.filter((m) => m.free).map(opt)}</optgroup><optgroup label="Paid">${models.filter((m) => !m.free).map(opt)}</optgroup>`.s;
    }).catch((e) => { sel.innerHTML = html`<option>${ai.model || 'openrouter/auto'}</option>`.s; toast(e.message); });
    sel.addEventListener('change', () => { saveAi({ model: sel.value }); toast('Model saved on this device'); });
    $('#ai-save', root)?.addEventListener('click', async () => {
      const key = $('#ai-key', root).value.trim();
      if (!/^sk-or-[\w-]{20,}$/.test(key)) { toast('That doesn’t look like an OpenRouter key (sk-or-…)'); return; }
      try { await checkKey(key); saveAi({ key }); toast('Key saved on this device'); this.render(root); } catch (e) { toast(e.message); }
    });
    $('#ai-check', root)?.addEventListener('click', () => checkKey(ai.key).then((d) => {
      const used = `$${Number(d.usage || 0).toFixed(2)} used`;
      $('#ai-usage', root).textContent = d.limit == null ? `· ${used}, no limit set` : `· ${used} of $${Number(d.limit).toFixed(2)}`;
    }).catch((e) => toast(e.message)));
    $('#ai-forget', root)?.addEventListener('click', () => { forgetAi(); toast('Key removed from this browser'); this.render(root); });
    $('#backup', root).addEventListener('click', () => download(`outreach-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state.config, null, 2), 'application/json'));
    $('#forget', root).addEventListener('click', async () => {
      if (!demo && !(await confirmDialog('Sign out on this device', 'Your token and passphrase are removed from this browser. Your data stays in GitHub.', 'Sign out'))) return;
      forgetConnection();
      location.hash = '';
      location.reload();
    });
  },
};
