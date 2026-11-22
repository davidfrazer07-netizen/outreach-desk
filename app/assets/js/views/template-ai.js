// Write with AI / Edit with AI dialogs for the template editor. Nothing is saved until the user accepts.
import { html, raw, dialog, toast } from '../ui.js';
import { unknownTags } from '../core/merge.js';
import { aiReady, aiSettings, writeEmail, editEmail, EDIT_ACTIONS, PHASES } from '../ai.js';
import { state } from '../store.js';

// The writer voice from Settings (e.g. Alex's skill and playbook), saved in the encrypted config.
const profile = () => {
  const s = state.config.settings;
  return s.writerProfile?.trim() ? { name: s.writerName || 'Writer', text: s.writerProfile } : null;
};

const BRIEF_KEY = 'outreach-desk:ai-brief';
const lastBrief = () => { try { return JSON.parse(localStorage.getItem(BRIEF_KEY) || 'null') || {}; } catch { return {}; } };
const keepBrief = (b) => { try { localStorage.setItem(BRIEF_KEY, JSON.stringify(b)); } catch { /* blocked */ } };

function needKey() {
  if (aiReady()) return false;
  toast('Add your OpenRouter key in Settings → AI writing first');
  location.hash = '#/settings';
  return true;
}

// Runs the AI call inside the dialog: the button shows progress, errors stay in the dialog.
function busy(form, label, fn) {
  const btn = form.querySelector('[type=submit]');
  const err = form.querySelector('[data-err]');
  const idle = btn.textContent;
  btn.disabled = true; btn.textContent = label; err.innerHTML = '';
  return fn().catch((e) => { err.innerHTML = html`<div class="note err">${e.message}</div>`.s; return false; })
    .finally(() => { btn.disabled = false; btn.textContent = idle; });
}

const select = (name, opts, value) => html`<select class="input" name="${name}">${opts.map((o) => html`<option ${o === value ? 'selected' : ''}>${o}</option>`)}</select>`;
const modelNote = () => html`<span class="hint">${profile() ? `Voice: ${profile().name} · ` : 'Voice: default · '}Model: ${aiSettings().model || 'OpenRouter auto'}. Change either in Settings</span>`;

/** Opens the brief dialog. Resolves with { subject, body } once accepted, or null. */
export async function aiWrite(tpl, senderName) {
  if (needKey()) return null;
  const b = { tone: 'Friendly and direct', length: 'Short, about 70 words', kind: 'First email', phase: PHASES[0], ...lastBrief() };
  const voice = profile();
  const draft = await dialog({
    title: voice ? `Write with ${voice.name}` : 'Write with AI',
    submit: 'Write draft',
    body: html`<div class="stack">
      <label class="field"><span>Who it’s for</span><input class="input" name="audience" required maxlength="300" value="${b.audience || ''}" placeholder="Founders of D2C skincare brands in India"></label>
      <label class="field"><span>What you offer, and why it matters to them</span><textarea class="input" name="offer" required rows="4" maxlength="1500" placeholder="We shoot product photos and short reels in 48 hours, so new launches go live the same week">${b.offer || ''}</textarea></label>
      <div class="grid-3">
        ${voice ? '' : html`<label class="field"><span>Tone</span>${select('tone', ['Friendly and direct', 'Formal', 'Casual', 'Curious, question-led'], b.tone)}</label>
        <label class="field"><span>Length</span>${select('length', ['Very short, about 40 words', 'Short, about 70 words', 'Medium, about 110 words'], b.length)}</label>`}
        ${voice ? html`<label class="field"><span>Phase</span>${select('phase', PHASES, b.phase)}</label>` : ''}
        <label class="field"><span>Step</span>${select('kind', ['First email', 'Follow-up'], b.kind)}</label>
      </div>
      <label class="field"><span>Anything else (optional)</span><input class="input" name="notes" maxlength="500" value="${b.notes || ''}" placeholder="Mention we work with 40+ brands. Ask if they have a launch coming up"></label>
      ${modelNote()}<div data-err></div></div>`.s,
    onSubmit: (form) => busy(form, 'Writing…', async () => {
      const f = Object.fromEntries(new FormData(form));
      keepBrief({ ...b, ...f });
      return writeEmail({ ...f, kind: f.kind === 'Follow-up' ? 'followup' : 'first', sender: senderName }, voice);
    }),
  });
  return draft ? review(tpl, draft, { title: 'AI draft' }) : null;
}

/** Opens the rewrite dialog. Resolves with { subject, body, asNew } once accepted, or null. */
export async function aiEdit(tpl, usedIn = []) {
  if (needKey()) return null;
  if (!tpl.body.trim()) { toast('Write something first, or use Write with AI'); return null; }
  let action = '';
  const out = await dialog({
    title: profile() ? `Edit with ${profile().name}` : 'Edit with AI',
    submit: 'Rewrite',
    body: html`<div class="stack">
      <div class="field"><span>Change</span><div class="chips">${EDIT_ACTIONS.map(([k, l]) => html`<label class="chip pick"><input type="radio" name="action" value="${k}" ${k === 'shorter' ? 'checked' : ''}><span>${l}</span></label>`)}</div></div>
      <label class="field"><span>Your own instruction (optional)</span><textarea class="input" name="instruction" rows="3" maxlength="800" placeholder="Open with their industry. Drop the second paragraph"></textarea></label>
      ${modelNote()}<div data-err></div></div>`.s,
    onSubmit: (form) => busy(form, 'Rewriting…', async () => {
      const f = Object.fromEntries(new FormData(form));
      action = f.action;
      return editEmail(tpl, f, profile());
    }),
  });
  if (!out) return null;
  const asNew = action === 'variant';
  return review(tpl, out, {
    title: asNew ? 'B variant' : 'AI rewrite',
    asNew,
    note: asNew ? (usedIn.length ? `Saved as a new template and added next to “${tpl.name}” in ${usedIn.join(', ')}, with the same weight` : 'Saved as a new template. Add it to a sequence step to start the test') : '',
  });
}

// The draft is editable before it replaces anything.
async function review(tpl, draft, { title, asNew = false, note = '' }) {
  const subject = draft.subject ?? tpl.subject;
  const warn = (s, b) => { const bad = unknownTags(`${s} ${b}`); return bad.length ? html`<div class="note err">Unknown merge tag ${bad.map((x) => `{{${x}}}`).join(', ')}. Fix or remove it before sending</div>`.s : ''; };
  return dialog({
    title,
    submit: asNew ? 'Save as new template' : 'Replace template',
    cancel: 'Discard',
    body: html`<div class="stack">
      ${note ? html`<div class="note">${note}</div>` : ''}
      ${draft.note ? html`<div class="note"><strong style="font-weight:500;color:var(--text)">${profile()?.name || 'AI'}:</strong> ${draft.note}</div>` : ''}
      <label class="field"><span>Subject</span><input class="input" name="subject" maxlength="200" value="${subject}" placeholder="Blank sends it in the same thread"></label>
      <label class="field"><span>Body</span><textarea class="input" name="body" rows="12" maxlength="20000">${draft.body}</textarea></label>
      <div data-warn>${raw(warn(subject, draft.body))}</div>
      ${asNew ? '' : html`<details class="was"><summary>Current version</summary><div class="preview"><div class="body">${tpl.subject ? `Subject: ${tpl.subject}\n\n` : ''}${tpl.body}</div></div></details>`}
      <span class="hint">Read it before using it. AI can get facts wrong</span></div>`.s,
    onSubmit: (form) => {
      const f = Object.fromEntries(new FormData(form));
      if (!f.body.trim()) { toast('The body is empty'); return false; }
      return { subject: f.subject.trim(), body: f.body.replace(/\r/g, ''), asNew };
    },
  });
}

