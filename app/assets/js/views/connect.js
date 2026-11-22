import { html, icon, brand, $, esc } from '../ui.js';
import { connect, startDemo, guessRepo } from '../store.js';
import { makeDemo } from '../demo.js';

function preview() {
  // A quiet product view: one sequence with its fork, and real-looking numbers.
  return html`
  <div class="card" style="width:440px;max-width:100%;box-shadow:var(--shadow-float)">
    <div class="card-head"><h2>Founders, Indian D2C</h2><span class="right mono muted">212 contacts</span></div>
    <div class="card-pad stack" style="gap:0">
      <div class="step"><div class="step-head"><span class="n">01</span><span>First touch</span><span class="right mono muted">A/B</span></div>
        <div class="variant winner"><span class="letter">A</span><span>Quick question about {{company}}</span><span class="vstats"><b>61%</b> open</span></div>
        <div class="variant"><span class="letter">B</span><span>{{first_name}}, a thought on reorders</span><span class="vstats"><b>48%</b> open</span></div>
      </div>
      <div class="wait">${icon('clock')}Branch on open</div>
      <div class="grid-2" style="gap:12px">
        <div class="step" style="padding:12px"><div class="step-head"><span class="n">Opened</span><span class="right mono muted">+2d</span></div><span class="sec">Case study follow-up</span></div>
        <div class="step" style="padding:12px"><div class="step-head"><span class="n">Not opened</span><span class="right mono muted">+4d</span></div><span class="sec">New subject, shorter</span></div>
      </div>
    </div>
    <div class="box-row" style="border-top:1px solid var(--line)">
      <div class="top"><span>rahul@yourco.in</span><span class="mono muted">7 of 10 today</span></div>
      <div class="allow">${Array.from({ length: 10 }, (_, i) => html`<i class="${i < 7 ? 'used' : ''}"></i>`)}</div>
    </div>
  </div>`;
}

export default {
  render(root, { error, prefill } = {}) {
    const g = { ...guessRepo(), ...(prefill || {}) };
    root.innerHTML = html`
    <div class="connect">
      <div class="pane">
        ${brand('padding:0')}
        <h1>Cold email sequences from your own mailboxes</h1>
        <p class="lede">Upload contacts, write A/B templates, branch follow-ups on opens, and get told about every reply. Data lives encrypted in your GitHub repo.</p>
        <form class="stack" id="cf" autocomplete="off">
          <div class="grid-2">
            <label class="field"><span>GitHub owner</span><input class="input" name="owner" required value="${g.owner}" placeholder="your-username"></label>
            <label class="field"><span>Repository</span><input class="input" name="repo" required value="${g.repo}" placeholder="outreach-desk"></label>
          </div>
          <label class="field"><span>Access token</span><input class="input" name="token" type="password" required value="${g.token || ''}" placeholder="github_pat_…">
            <span class="hint">Fine-grained token for this repo only, with Contents, Actions and Secrets set to read and write</span></label>
          <label class="field"><span>Passphrase</span><input class="input" name="passphrase" type="password" required minlength="12" value="${g.passphrase || ''}">
            <span class="hint">Encrypts your contacts and templates before they reach GitHub. At least 12 characters. It can’t be recovered, so keep it in your password manager</span></label>
          <label class="check"><input type="checkbox" name="remember" checked> Remember on this device</label>
          ${error ? html`<div class="note err">${error}</div>` : ''}
          <div class="row" style="margin-top:8px">
            <button class="btn primary" type="submit" style="height:40px;padding:0 20px">${icon('lock')}Open EVA</button>
            <button class="btn ghost" type="button" id="demo" style="height:40px">Try with sample data</button>
          </div>
        </form>
      </div>
      <div class="aside">${preview()}</div>
    </div>`.s;

    $('#cf').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const btn = ev.target.querySelector('[type=submit]');
      btn.disabled = true;
      btn.lastChild.textContent = 'Opening';
      try {
        await connect({ owner: f.get('owner'), repo: f.get('repo'), token: f.get('token'), passphrase: f.get('passphrase'), remember: !!f.get('remember') });
      } catch (err) {
        btn.disabled = false;
        btn.lastChild.textContent = 'Open EVA';
        let note = ev.target.querySelector('.note.err');
        if (!note) { note = document.createElement('div'); note.className = 'note err'; btn.parentElement.before(note); }
        note.textContent = err.message === 'Wrong passphrase' ? 'That passphrase doesn’t match the one your data was encrypted with' : esc(err.message);
      }
    });
    $('#demo').addEventListener('click', () => { location.hash = '#/'; startDemo(makeDemo()); });
  },
};
