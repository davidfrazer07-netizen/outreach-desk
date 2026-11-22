// Visual flow chart for a sequence: first email → opened? → two follow-up branches.
// Steps can be dragged to reorder or switch branch; templates can be dragged onto the chart.
import { html, icon, $, $$, fmt, pct, toast, confirmDialog } from '../ui.js';
import { state } from '../store.js';
import { variantStats } from '../core/stats.js';

const LETTERS = 'ABCDEF';
const TRACKS = { opened: 'Yes, opened', notOpened: 'No, not opened' };
const other = (t) => (t === 'opened' ? 'notOpened' : 'opened');

function node(seq, key, step, n, title) {
  const tpls = state.config.templates;
  const movable = key !== 'first';
  const [t, i] = movable ? [key.split('.')[0], Number(key.split('.')[1])] : [];
  const total = step.variants.reduce((a, v) => a + (Number(v.weight) || 0), 0) || 1;
  const stats = step.variants.map((v) => variantStats(state.activity, seq.id, key, v.templateId))
    .reduce((a, s) => ({ sent: a.sent + s.sent, opened: a.opened + s.opened, replied: a.replied + s.replied }), { sent: 0, opened: 0, replied: 0 });
  return html`<div class="fc-node" data-node="${key}" ${movable ? 'draggable="true"' : ''} tabindex="0" aria-label="${title}. Open to edit">
    <div class="fc-node-head">
      ${movable ? html`<span class="grip" title="Drag to move">${icon('grip')}</span>` : html`<span class="grip">${icon('send')}</span>`}
      <span class="n">${String(n).padStart(2, '0')}</span><span class="title">${title}</span>
      ${movable ? html`<span class="tools">
        <button class="btn ghost sm icon" data-mv="${key}" data-to="${t}.${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
        <button class="btn ghost sm icon" data-mv="${key}" data-to="${t}.${i + 2}" ${i === seq[t].length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
        <button class="btn ghost sm icon" data-mv="${key}" data-to="${other(t)}.${seq[other(t)].length}" aria-label="Move to the other branch" title="Move to “${TRACKS[other(t)]}”">${icon('swap')}</button>
        <button class="btn ghost sm icon danger" data-rm="${key}" aria-label="Remove step">${icon('trash')}</button></span>` : ''}
    </div>
    <div class="fc-vars">${step.variants.map((v, vi) => {
      const tp = tpls.find((x) => x.id === v.templateId);
      return html`<div class="fc-var"><span class="letter">${LETTERS[vi]}</span>
        <span class="t ${tp ? '' : 'missing'}">${tp ? tp.name : 'No template yet'}</span>
        <span class="w">${step.variants.length > 1 ? `${Math.round(((Number(v.weight) || 0) / total) * 100)}%` : ''}</span></div>`;
    })}</div>
    <div class="fc-meta">${stats.sent ? `${fmt(stats.sent)} sent · ${pct(stats.opened, stats.sent)} open · ${pct(stats.replied, stats.sent)} reply` : 'No sends yet'}</div>
    ${step.variants.length < 4 ? html`<div class="fc-ab" data-ab="${key}">Drop here to A/B test</div>` : ''}
  </div>`;
}

// Safety net: clear drag highlights however a drag ends (drop outside, Escape, lost focus).
const clearDrag = () => {
  document.body.classList.remove('fc-drag-step', 'fc-drag-tpl');
  document.querySelectorAll('.fc .dragging, .fc .over, .fc-tpl.dragging').forEach((x) => x.classList.remove('dragging', 'over'));
};
['dragend', 'drop', 'pointerdown', 'blur'].forEach((ev) => window.addEventListener(ev, clearDrag, true));

const slot = (t, i) => html`<div class="fc-slot" data-slot="${t}.${i}"></div>`;

function wait(t, i, step) {
  const after = i > 0 ? 'after the last email' : t === 'opened' ? 'after the first email' : 'with no open';
  return html`<div class="fc-wait"><span class="fc-pill">${icon('clock')}Wait
    <input class="input sm num" type="number" min="0" max="60" value="${step.delayDays}" data-fdelay="${t}.${i}" aria-label="Days to wait">
    days <span class="sub">${after}</span></span></div>`;
}

function branch(seq, t, offset) {
  const steps = seq[t];
  return html`<div class="fc-branch ${t === 'opened' ? 'yes' : 'no'}">
    <span class="fc-label"><span class="dot ${t === 'opened' ? 'acc' : ''}"></span>${TRACKS[t]}</span>
    ${steps.map((st, i) => html`${slot(t, i)}${wait(t, i, st)}${node(seq, `${t}.${i}`, st, offset + i, `Follow-up ${i + 1}`)}`)}
    ${slot(t, steps.length)}
    ${steps.length ? '' : html`<div class="fc-empty">No follow-ups on this path</div>`}
    <div class="fc-line"></div>
    <button class="btn sm" data-fadd="${t}">${icon('plus')}Add follow-up</button>
    <div class="fc-line"></div>
    <span class="fc-end">${icon('flag')}End</span>
  </div>`;
}

export function flowChart(seq, contacts) {
  return html`<div class="fc">
    <span class="fc-end">${icon('users')}${fmt(contacts)} ${contacts === 1 ? 'contact enters' : 'contacts enter'}</span>
    <div class="fc-line"></div>
    ${node(seq, 'first', seq.first, 1, 'First email')}
    <div class="fc-line"></div>
    <span class="fc-decision">${icon('split')}Did they open it?</span>
    <div class="fc-fork">${branch(seq, 'opened', 2)}${branch(seq, 'notOpened', 2)}</div>
    <p class="fc-foot">A reply, bounce or unsubscribe ends the path at any step. Drag steps to reorder them or move them between paths</p>
  </div>`;
}

export function templatePalette() {
  const tpls = state.config.templates;
  return html`<section class="card"><div class="card-head"><h2>Templates</h2></div><div class="card-pad stack tight">
    <p class="muted" style="margin:0 0 4px;font-size:12px">Drag one onto a step to swap it, onto “Drop here to A/B test” to add a variant, or into a gap to add a step</p>
    ${tpls.length ? tpls.map((t) => html`<div class="fc-tpl" draggable="true" data-tpl="${t.id}">${icon('grip')}<span>${t.name}</span></div>`)
      : html`<a class="btn sm" href="#/templates">${icon('plus')}Write a template</a>`}
  </div></section>`;
}

/** Wires drag and drop and buttons. `save(fn)` applies a change and re-renders; `open(key)` edits a step. */
export function bindFlow(root, seq, { save, open, inProgress }) {
  const tr = (key) => [key.split('.')[0], Number(key.split('.')[1])];
  let warned = false;
  // Contacts mid-sequence follow step numbers, so warn once before reshaping a live sequence.
  const guard = async () => {
    if (warned || seq.status !== 'active' || !inProgress) return true;
    warned = await confirmDialog('Change a live sequence', `${fmt(inProgress)} contacts are partway through. They carry on by step number, so whoever is due step 3 gets whatever is in step 3 after this change.`, 'Change it');
    return warned;
  };
  const move = async (from, to) => {
    const [ft, fi] = tr(from);
    let [tt, ti] = tr(to);
    if (ft === tt && (ti === fi || ti === fi + 1)) return;
    if (!(await guard())) return;
    save(() => {
      const [step] = seq[ft].splice(fi, 1);
      if (ft === tt && fi < ti) ti--;
      seq[tt].splice(Math.max(0, ti), 0, step);
    });
  };
  const getStep = (key) => (key === 'first' ? seq.first : seq[tr(key)[0]][tr(key)[1]]);
  const setTemplate = (key, id) => save(() => {
    const st = getStep(key);
    (st.variants.find((v) => !v.templateId) || st.variants[0]).templateId = id;
  });
  const addVariant = (key, id) => save(() => {
    const st = getStep(key);
    if (st.variants.length >= 4) return;
    st.variants.push({ templateId: id, weight: 0 });
    const even = Math.floor(100 / st.variants.length);
    st.variants.forEach((v, i) => { v.weight = i === 0 ? 100 - even * (st.variants.length - 1) : even; });
  });
  const insertStep = async (to, id) => {
    const [t, i] = tr(to);
    if (!(await guard())) return;
    save(() => seq[t].splice(i, 0, { delayDays: 3, variants: [{ templateId: id, weight: 100 }] }));
  };

  // Drag sources. The body class is added a tick later: changing layout inside dragstart cancels the drag in Chrome.
  const start = (e, type, value, el) => {
    e.dataTransfer.setData(type, value);
    e.dataTransfer.effectAllowed = type === 'text/x-step' ? 'move' : 'copy';
    el.classList.add('dragging');
    setTimeout(() => document.body.classList.add(type === 'text/x-step' ? 'fc-drag-step' : 'fc-drag-tpl'), 0);
  };
  const end = () => {
    document.body.classList.remove('fc-drag-step', 'fc-drag-tpl');
    $$('.dragging, .over').forEach((x) => x.classList.remove('dragging', 'over'));
  };
  $$('.fc-node[draggable]', root).forEach((n) => {
    n.addEventListener('dragstart', (e) => { if (e.target.closest('input, button')) { e.preventDefault(); return; } start(e, 'text/x-step', n.dataset.node, n); });
    n.addEventListener('dragend', end);
  });
  $$('[data-tpl]', root).forEach((t) => {
    t.addEventListener('dragstart', (e) => start(e, 'text/x-tpl', t.dataset.tpl, t));
    t.addEventListener('dragend', end);
  });

  // Drop targets: gaps take steps or templates; a step body or its A/B area takes templates.
  const accepts = (el, types) => (el.dataset.slot !== undefined ? types.includes('text/x-step') || types.includes('text/x-tpl') : types.includes('text/x-tpl'));
  $$('[data-slot], [data-ab], .fc-node', root).forEach((el) => {
    el.addEventListener('dragover', (e) => {
      if (!accepts(el, [...e.dataTransfer.types])) return;
      if (el.classList.contains('fc-node') && e.target.closest('[data-ab]')) return;
      e.preventDefault(); e.stopPropagation();
      el.classList.add('over');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const step = e.dataTransfer.getData('text/x-step');
      const tpl = e.dataTransfer.getData('text/x-tpl');
      end();
      if (el.dataset.slot !== undefined) { if (step) move(step, el.dataset.slot); else if (tpl) insertStep(el.dataset.slot, tpl); return; }
      if (!tpl) return;
      if (el.dataset.ab !== undefined) addVariant(el.dataset.ab, tpl);
      else setTemplate(el.dataset.node, tpl);
    });
  });

  // Buttons and inline edits, for keyboard and touch too.
  $$('[data-mv]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); move(b.dataset.mv, b.dataset.to); }));
  $$('[data-rm]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await guard())) return;
    const [t, i] = tr(b.dataset.rm);
    save(() => seq[t].splice(i, 1));
    toast('Step removed');
  }));
  $$('[data-fadd]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!(await guard())) return;
    save(() => seq[b.dataset.fadd].push({ delayDays: 3, variants: [{ templateId: '', weight: 100 }] }));
  }));
  $$('[data-fdelay]', root).forEach((inp) => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('change', () => {
      const [t, i] = tr(inp.dataset.fdelay);
      save(() => { seq[t][i].delayDays = Math.max(0, Math.min(60, Math.round(Number(inp.value) || 0))); }, false);
    });
  });
  $$('.fc-node', root).forEach((n) => {
    n.addEventListener('click', (e) => { if (!e.target.closest('button, input')) open(n.dataset.node); });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === n) open(n.dataset.node); });
  });
}
