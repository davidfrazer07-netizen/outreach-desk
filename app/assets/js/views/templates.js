import { html, icon, $, $$, fmt, pct, toast, confirmDialog, fullName } from '../ui.js';
import { state, update, newId } from '../store.js';
import { TAGS, render as merge, unknownTags } from '../core/merge.js';
import { templateStats } from '../core/stats.js';

let previewContact = 0;

function usedIn(id) {
  return state.config.sequences.filter((s) => [s.first, ...s.opened, ...s.notOpened].some((st) => st.variants.some((v) => v.templateId === id)));
}

function previewHTML(t) {
  const cs = state.config.contacts;
  const c = cs[previewContact % Math.max(1, cs.length)] || { firstName: 'Asha', lastName: 'Rao', company: 'Rao & Sons', industry: 'Retail', email: 'asha@raoandsons.in' };
  const mb = state.config.mailboxes[0];
  const extra = { senderName: mb?.fromName || '' };
  const subject = merge(t.subject, c, extra);
  const body = merge(t.body, c, extra) + (mb?.signature ? `\n\n${mb.signature}` : '');
  return html`<div class="meta"><span class="muted">From</span><span>${mb ? `${mb.fromName || ''} <${mb.email}>` : 'Your mailbox'}</span>
    <span class="muted">To</span><span>${fullName(c)} &lt;${c.email}&gt;</span>
    <span class="muted">Subject</span><span>${subject || html`<span class="muted">Re: the previous email’s subject (same thread)</span>`}</span></div>
    <div class="body">${body}</div>`;
}

export default {
  rerenderOn: ['activity'],
  render(root, { param }) {
    const { config, activity } = state;
    const tpl = config.templates.find((t) => t.id === param) || (!param && config.templates[0]) || null;

    root.innerHTML = html`
      <div class="page-head"><div><h1>Templates</h1><div class="sub">Write once, reuse across sequences. Put two templates on one step to A/B test them</div></div>
        <div class="actions"><button class="btn primary" id="new">${icon('plus')}New template</button></div></div>
      ${config.templates.length === 0 ? html`<div class="card empty"><h3>No templates yet</h3><p>Use merge tags like {{first_name}} and {{company}}. Add a fallback with a pipe: {{first_name|there}}</p>
        <button class="btn primary" id="new2">${icon('plus')}New template</button></div>` : html`
      <div class="split">
        <section class="card"><div class="list-pick">${config.templates.map((t) => {
          const s = templateStats(activity, t.id);
          return html`<button data-id="${t.id}" aria-current="${t.id === tpl?.id}"><span class="t">${t.name}</span>
            <span class="m">${s.sent ? `${fmt(s.sent)} sent · ${pct(s.opened, s.sent)} open · ${pct(s.replied, s.sent)} reply` : 'Not sent yet'}</span></button>`;
        })}</div></section>
        ${tpl ? html`<section class="card">
          <div class="card-head"><input class="input" id="tname" value="${tpl.name}" aria-label="Template name" style="font-weight:500;border-color:transparent;padding:0 8px;margin-left:-8px;flex:1;background:transparent">
            <div class="right"><button class="btn sm" id="dup">${icon('copy')}Duplicate</button><button class="btn ghost sm icon danger" id="del" aria-label="Delete template">${icon('trash')}</button></div></div>
          <div class="card-pad grid-2" style="align-items:start">
            <div class="stack">
              <label class="field"><span>Subject</span><input class="input" id="subj" value="${tpl.subject}" placeholder="Leave blank on follow-ups to reply in the same thread"></label>
              <label class="field"><span>Body</span><textarea class="input" id="body" rows="14">${tpl.body}</textarea></label>
              <div class="field"><span>Insert</span><div class="chips">${TAGS.map(([t]) => html`<button class="chip" data-tag="${t}">{{${t}}}</button>`)}</div>
                <span class="hint">Fallback after a pipe, like {{first_name|there}}. Your mailbox signature and the unsubscribe line are added when sending</span></div>
              <div id="warn"></div>
            </div>
            <div class="stack tight">
              <div class="row" style="justify-content:space-between"><span class="sec">Preview</span>
                ${config.contacts.length > 1 ? html`<button class="btn ghost sm" id="next-c">Another contact</button>` : ''}</div>
              <div class="preview" id="prev">${previewHTML(tpl)}</div>
              <div class="muted" style="font-size:12px">Used in ${usedIn(tpl.id).map((s) => s.name).join(', ') || 'no sequences yet'}</div>
            </div>
          </div></section>` : html`<div class="card empty"><p>Pick a template</p></div>`}
      </div>`}`.s;

    const create = (base) => {
      const t = { id: newId(), name: base ? `${base.name} (B)` : 'New template', subject: base?.subject || '', body: base?.body || 'Hi {{first_name}},\n\n' };
      update((cfg) => cfg.templates.push(t), { silent: true });
      location.hash = `#/templates/${t.id}`;
    };
    $('#new', root)?.addEventListener('click', () => create());
    $('#new2', root)?.addEventListener('click', () => create());
    $$('[data-id]', root).forEach((b) => b.addEventListener('click', () => { location.hash = `#/templates/${b.dataset.id}`; }));
    if (!tpl) return;

    const refresh = () => {
      $('#prev', root).innerHTML = previewHTML(tpl).s;
      const bad = unknownTags(`${tpl.subject} ${tpl.body}`);
      $('#warn', root).innerHTML = bad.length ? html`<div class="note err">Unknown merge tag ${bad.map((b) => `{{${b}}}`).join(', ')}. It would be sent as written</div>`.s : '';
    };
    const edit = (fn) => { update(() => fn(), { silent: true }); refresh(); };
    $('#tname', root).addEventListener('input', (e) => edit(() => { tpl.name = e.target.value.slice(0, 80) || 'Untitled'; }));
    $('#tname', root).addEventListener('change', () => this.render(root, { param: tpl.id }));
    $('#subj', root).addEventListener('input', (e) => edit(() => { tpl.subject = e.target.value.slice(0, 200); }));
    $('#body', root).addEventListener('input', (e) => edit(() => { tpl.body = e.target.value.slice(0, 20000); }));
    let lastField = $('#body', root);
    $('#subj', root).addEventListener('focus', (e) => { lastField = e.target; });
    $('#body', root).addEventListener('focus', (e) => { lastField = e.target; });
    $$('[data-tag]', root).forEach((b) => b.addEventListener('click', () => {
      const f = lastField; const tag = `{{${b.dataset.tag}}}`;
      const s = f.selectionStart ?? f.value.length;
      f.value = f.value.slice(0, s) + tag + f.value.slice(f.selectionEnd ?? s);
      f.focus(); f.setSelectionRange(s + tag.length, s + tag.length);
      f.dispatchEvent(new Event('input'));
    }));
    $('#next-c', root)?.addEventListener('click', () => { previewContact++; refresh(); });
    $('#dup', root).addEventListener('click', () => create(tpl));
    $('#del', root).addEventListener('click', async () => {
      const seqs = usedIn(tpl.id);
      if (seqs.length) { toast(`Used in ${seqs.map((s) => s.name).join(', ')}. Swap it out there first`); return; }
      if (!(await confirmDialog(`Delete ${tpl.name}`, 'This can’t be undone.'))) return;
      update((cfg) => { cfg.templates = cfg.templates.filter((t) => t !== tpl); }, { silent: true });
      location.hash = '#/templates';
      this.render(root, {});
    });
    refresh();
  },
};
