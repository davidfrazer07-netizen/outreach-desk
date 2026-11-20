import { html, icon, $, $$, fmt, pct, toast, confirmDialog } from '../ui.js';
import { state, update, newId } from '../store.js';
import { sequenceStats, variantStats } from '../core/stats.js';

const LETTERS = 'ABCDEF';

function blankSequence() {
  const t = state.config.templates;
  return {
    id: newId(), name: 'New sequence', status: 'paused', mailboxIds: state.config.mailboxes.slice(0, 1).map((m) => m.id), createdAt: new Date().toISOString(),
    first: { variants: [{ templateId: t[0]?.id || '', weight: 100 }] },
    opened: [{ delayDays: 2, variants: [{ templateId: t[1]?.id || t[0]?.id || '', weight: 100 }] }],
    notOpened: [{ delayDays: 4, variants: [{ templateId: t[2]?.id || t[0]?.id || '', weight: 100 }] }],
  };
}

function listView(root) {
  const { config, activity } = state;
  root.innerHTML = html`
    <div class="page-head"><div><h1>Sequences</h1><div class="sub">Each sequence sends a first email, then follows up differently for people who opened and people who didn’t</div></div>
      <div class="actions"><button class="btn primary" id="new">${icon('plus')}New sequence</button></div></div>
    ${config.sequences.length ? html`<section class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Status</th><th>Mailboxes</th><th class="num">Steps</th><th class="num">Contacts</th><th class="num">In progress</th><th class="num">Opened</th><th class="num">Replied</th></tr></thead>
      <tbody>${config.sequences.map((s) => {
        const st = sequenceStats(s, config, activity);
        const boxes = s.mailboxIds.map((id) => config.mailboxes.find((m) => m.id === id)?.email).filter(Boolean);
        return html`<tr class="link" data-id="${s.id}"><td>${s.name}</td>
          <td><span class="tag"><span class="dot ${s.status === 'active' ? 'ok' : ''}"></span>${s.status === 'active' ? 'Active' : 'Paused'}</span></td>
          <td class="sec">${boxes.length ? (boxes.length > 1 ? `${boxes[0]} +${boxes.length - 1}` : boxes[0]) : 'None'}</td>
          <td class="num">${1 + Math.max(s.opened.length, s.notOpened.length)}</td><td class="num">${fmt(st.contacts)}</td><td class="num">${fmt(st.active)}</td>
          <td class="num">${pct(st.opened, st.reached)}</td><td class="num">${pct(st.replied, st.reached)}</td></tr>`;
      })}</tbody></table></div></section>`
    : html`<div class="card empty"><h3>No sequences yet</h3><p>A sequence is the first email plus the follow-ups. You can A/B test every step and send from several mailboxes.</p>
      <button class="btn primary" id="new2">${icon('plus')}New sequence</button></div>`}`.s;
  const create = () => {
    const s = blankSequence();
    update((cfg) => cfg.sequences.push(s), { silent: true });
    location.hash = `#/sequences/${s.id}`;
  };
  $('#new', root)?.addEventListener('click', create);
  $('#new2', root)?.addEventListener('click', create);
  $$('tr[data-id]', root).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/sequences/${tr.dataset.id}`; }));
}

function variantsBlock(seq, stepKey, step) {
  const { activity, config } = state;
  const stats = step.variants.map((v) => variantStats(activity, seq.id, stepKey, v.templateId));
  // A variant "leads" once each has 20+ sends: best reply rate, then best open rate.
  let lead = -1;
  if (step.variants.length > 1 && stats.every((s) => s.sent >= 20)) {
    const score = (s) => (s.replied / s.sent) * 1000 + s.opened / s.sent;
    lead = stats.reduce((b, s, i) => (score(s) > score(stats[b]) ? i : b), 0);
  }
  const total = step.variants.reduce((a, v) => a + (Number(v.weight) || 0), 0);
  return html`${step.variants.map((v, i) => html`
    <div class="variant ${i === lead ? 'winner' : ''}">
      <span class="letter" title="${i === lead ? 'Leading variant' : ''}">${LETTERS[i]}</span>
      <select class="input sm" data-k="${stepKey}" data-v="${i}" data-f="templateId" aria-label="Template for variant ${LETTERS[i]}">
        <option value="">Choose a template</option>
        ${config.templates.map((t) => html`<option value="${t.id}" ${t.id === v.templateId ? 'selected' : ''}>${t.name}</option>`)}
        <option value="__new">New template</option>
      </select>
      ${step.variants.length > 1
        ? html`<label class="row" style="gap:4px"><input class="input sm num" type="number" min="0" max="100" value="${v.weight}" data-k="${stepKey}" data-v="${i}" data-f="weight" style="width:52px" aria-label="Share"><span class="muted">%</span></label>`
        : html`<span></span>`}
      <span class="vstats">${stats[i].sent ? html`<b>${fmt(stats[i].sent)}</b> sent · ${pct(stats[i].opened, stats[i].sent)} open · ${pct(stats[i].replied, stats[i].sent)} reply` : 'No sends yet'}</span>
      ${step.variants.length > 1 ? html`<button class="btn ghost sm icon" data-del-v="${stepKey}" data-v="${i}" aria-label="Remove variant">${icon('x')}</button>` : html`<span></span>`}
    </div>`)}
    ${step.variants.length > 1 && total !== 100 ? html`<div class="muted" style="font-size:12px">Shares add up to ${total}%. They’re used as relative weights</div>` : ''}
    ${step.variants.length < 4 ? html`<div><button class="btn ghost sm" data-add-v="${stepKey}">${icon('plus')}Add A/B variant</button></div>` : ''}`;
}

function stepCard(seq, stepKey, step, n, title) {
  return html`<div class="step">
    <div class="step-head"><span class="n">${String(n).padStart(2, '0')}</span><span>${title}</span>
      ${stepKey !== 'first' ? html`<span class="right"><button class="btn ghost sm icon" data-del-step="${stepKey}" aria-label="Remove step">${icon('trash')}</button></span>` : ''}</div>
    ${variantsBlock(seq, stepKey, step)}
  </div>`;
}

function track(seq, name, label, hint) {
  const steps = seq[name];
  return html`<div class="stack tight">
    <div class="track-head">${label}<span class="mono muted">${steps.length} ${steps.length === 1 ? 'step' : 'steps'}</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:4px">${hint}</div>
    ${steps.length === 0 ? html`<div class="track-empty">No follow-ups. The sequence ends here for these contacts</div>` : ''}
    ${steps.map((st, i) => html`
      <div class="wait">${icon('clock')}Wait <input class="input sm num" type="number" min="0" max="60" value="${st.delayDays}" data-delay="${name}.${i}" style="width:56px" aria-label="Days to wait"> days ${i === 0 ? (name === 'opened' ? 'after the first email' : 'without an open') : 'after the previous email'}</div>
      ${stepCard(seq, `${name}.${i}`, st, i + 2, `Follow-up ${i + 1}`)}`)}
    <div style="padding-top:8px"><button class="btn sm" data-add-step="${name}">${icon('plus')}Add follow-up</button></div>
  </div>`;
}

function editor(root, seq) {
  const { config, activity } = state;
  const st = sequenceStats(seq, config, activity);
  const getStep = (key) => (key === 'first' ? seq.first : seq[key.split('.')[0]][Number(key.split('.')[1])]);
  const save = (fn, rerender = true) => { update(() => fn(), { silent: true }); if (rerender) editor(root, seq); };

  root.innerHTML = html`
    <div class="page-head">
      <div style="flex:1;min-width:0"><a href="#/sequences" class="btn ghost sm" style="margin:0 0 8px -10px">${icon('left')}Sequences</a>
        <input class="input" id="name" value="${seq.name}" aria-label="Sequence name" style="font-size:24px;height:44px;font-weight:500;border-color:transparent;padding:0 8px;margin-left:-8px;width:100%;max-width:560px;background:transparent"></div>
      <div class="actions">
        <div class="seg" role="group" aria-label="Status">
          <button data-status="active" aria-pressed="${seq.status === 'active'}">${icon('play')} Active</button>
          <button data-status="paused" aria-pressed="${seq.status !== 'active'}">${icon('pause')} Paused</button></div>
        <a class="btn" href="#/contacts">${icon('users')}Add contacts</a>
        <button class="btn ghost icon danger" id="del" aria-label="Delete sequence">${icon('trash')}</button>
      </div>
    </div>
    <div class="split aside-right">
      <div class="flow">
        ${stepCard(seq, 'first', seq.first, 1, 'First email')}
        <div class="wait">${icon('split')}Then follow up based on whether they opened. A reply stops the sequence</div>
        <div class="fork">
          ${track(seq, 'opened', 'If opened', 'Warm: they’ve seen it. Leave the subject blank on a template to reply in the same thread')}
          ${track(seq, 'notOpened', 'If not opened', 'Cold: try a new subject line, or keep it short')}
        </div>
      </div>
      <aside class="stack">
        <section class="card"><div class="card-head"><h2>Send from</h2></div>
          <div class="card-pad stack tight">
            ${config.mailboxes.length ? config.mailboxes.map((m) => html`<label class="check"><input type="checkbox" data-mb="${m.id}" ${seq.mailboxIds.includes(m.id) ? 'checked' : ''}>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${m.email}</span><span class="mono muted" style="margin-left:auto">${m.dailyLimit}/day</span></label>`)
              : html`<p class="sec" style="margin:0">No mailboxes yet</p><a class="btn sm" href="#/mailboxes">${icon('plus')}Add mailbox</a>`}
            <p class="muted" style="margin:8px 0 0;font-size:12px">New contacts are shared across these in turn. Each mailbox’s daily limit applies across all sequences</p>
          </div></section>
        <section class="card"><div class="card-head"><h2>Results</h2></div>
          <div class="card-pad" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            ${[['Contacts', fmt(st.contacts)], ['In progress', fmt(st.active)], ['Opened', pct(st.opened, st.reached)], ['Replied', pct(st.replied, st.reached)], ['Emails sent', fmt(st.sent)], ['Bounced', fmt(st.bounced)]]
              .map(([l, v]) => html`<div><div class="sec" style="font-size:13px">${l}</div><div class="num" style="font-size:20px;line-height:28px;font-weight:500">${v}</div></div>`)}
          </div></section>
        <p class="muted" style="font-size:12px;margin:0">Sends go out ${dayText(config.settings)}, ${config.settings.startHour}:00 to ${config.settings.endHour}:00 ${config.settings.timezone}. Change this in <a href="#/settings">Settings</a></p>
      </aside>
    </div>`.s;

  $('#name', root).addEventListener('input', (e) => update(() => { seq.name = e.target.value.slice(0, 80) || 'Untitled sequence'; }, { silent: true }));
  $$('[data-status]', root).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.status === 'active') {
      const problem = validate(seq);
      if (problem) { toast(problem); return; }
    }
    save(() => { seq.status = b.dataset.status; });
  }));
  $('#del', root).addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${seq.name}`, `${fmt(st.contacts)} contacts are taken out of it. Stats for emails already sent stay on the overview.`))) return;
    update((cfg) => { cfg.sequences = cfg.sequences.filter((s) => s !== seq); cfg.enrollments.forEach((e) => { if (e.sequenceId === seq.id) e.status = 'removed'; }); }, { silent: true });
    location.hash = '#/sequences';
  });
  $$('[data-mb]', root).forEach((cb) => cb.addEventListener('change', () => save(() => {
    seq.mailboxIds = cb.checked ? [...seq.mailboxIds, cb.dataset.mb] : seq.mailboxIds.filter((x) => x !== cb.dataset.mb);
  }, false)));
  $$('select[data-k]', root).forEach((sel) => sel.addEventListener('change', () => {
    if (sel.value === '__new') {
      const t = { id: newId(), name: 'New template', subject: '', body: 'Hi {{first_name}},\n\n' };
      save(() => { state.config.templates.push(t); getStep(sel.dataset.k).variants[Number(sel.dataset.v)].templateId = t.id; }, false);
      location.hash = `#/templates/${t.id}`;
      return;
    }
    save(() => { getStep(sel.dataset.k).variants[Number(sel.dataset.v)].templateId = sel.value; }, false);
  }));
  $$('input[data-f="weight"]', root).forEach((inp) => inp.addEventListener('change', () => save(() => {
    getStep(inp.dataset.k).variants[Number(inp.dataset.v)].weight = Math.max(0, Math.min(100, Number(inp.value) || 0));
  })));
  $$('[data-add-v]', root).forEach((b) => b.addEventListener('click', () => save(() => {
    const step = getStep(b.dataset.addV);
    step.variants.push({ templateId: '', weight: 0 });
    const even = Math.floor(100 / step.variants.length);
    step.variants.forEach((v, i) => { v.weight = i === 0 ? 100 - even * (step.variants.length - 1) : even; });
  })));
  $$('[data-del-v]', root).forEach((b) => b.addEventListener('click', () => save(() => {
    const step = getStep(b.dataset.delV);
    step.variants.splice(Number(b.dataset.v), 1);
    if (step.variants.length === 1) step.variants[0].weight = 100;
  })));
  $$('[data-add-step]', root).forEach((b) => b.addEventListener('click', () => save(() => {
    seq[b.dataset.addStep].push({ delayDays: 3, variants: [{ templateId: '', weight: 100 }] });
  })));
  $$('[data-del-step]', root).forEach((b) => b.addEventListener('click', () => save(() => {
    const [t, i] = b.dataset.delStep.split('.');
    seq[t].splice(Number(i), 1);
  })));
  $$('[data-delay]', root).forEach((inp) => inp.addEventListener('change', () => save(() => {
    const [t, i] = inp.dataset.delay.split('.');
    seq[t][Number(i)].delayDays = Math.max(0, Math.min(60, Math.round(Number(inp.value) || 0)));
  }, false)));
}

function dayText(s) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = [...(s.days || [])].sort();
  if (d.join() === '1,2,3,4,5') return 'Monday to Friday';
  if (d.length === 7) return 'every day';
  return d.map((x) => names[x]).join(', ');
}

function validate(seq) {
  if (!seq.mailboxIds.length) return 'Pick at least one mailbox to send from';
  const all = [seq.first, ...seq.opened, ...seq.notOpened];
  if (all.some((st) => st.variants.some((v) => !v.templateId))) return 'Every variant needs a template';
  if (seq.first.variants.some((v) => !String(state.config.templates.find((t) => t.id === v.templateId)?.subject || '').trim())) return 'First-email templates need a subject line';
  return '';
}

export default {
  rerenderOn: ['activity'],
  render(root, { param }) {
    const seq = param && state.config.sequences.find((s) => s.id === param);
    if (param && !seq) { root.innerHTML = html`<div class="empty"><h3>Sequence not found</h3><a class="btn" href="#/sequences">Back to sequences</a></div>`.s; return; }
    if (seq) editor(root, seq); else listView(root);
  },
};
