import { html, icon, $, $$, fmt, toast, dialog, confirmDialog, download, fullName } from '../ui.js';
import { state, update, newId } from '../store.js';
import { contactsFromCSV, FIELDS } from '../core/csv.js';
import { contactIndex } from '../core/stats.js';

const PAGE = 50;
const ui = { q: '', industry: '', status: '', page: 0, selected: new Set() };
const FIELD_LABEL = { firstName: 'First name', lastName: 'Last name', company: 'Company', email: 'Email', industry: 'Industry', phone: 'Phone num' };

function filtered(index) {
  const q = ui.q.toLowerCase();
  return state.config.contacts.filter((c) => {
    if (ui.industry && c.industry !== ui.industry) return false;
    const st = index.get(c.id);
    const sup = state.activity.suppressed[c.email];
    if (ui.status === 'none' && st) return false;
    if (ui.status && ui.status !== 'none' && (st?.status.key || (sup ? 'unsubscribed' : '')) !== ui.status) return false;
    if (!q) return true;
    return `${c.firstName} ${c.lastName} ${c.company} ${c.email}`.toLowerCase().includes(q);
  });
}

/** Enroll contacts in a sequence, spreading them across its mailboxes. Returns counts. */
export function enroll(contactIds, seq) {
  const active = new Set(state.config.enrollments.filter((e) => e.status === 'active' || e.status === 'paused').map((e) => e.contactId));
  const byId = new Map(state.config.contacts.map((c) => [c.id, c]));
  let added = 0; let skipped = 0;
  const boxes = seq.mailboxIds.length ? seq.mailboxIds : [];
  update((cfg) => {
    let rr = cfg.enrollments.filter((e) => e.sequenceId === seq.id).length;
    for (const id of contactIds) {
      const c = byId.get(id);
      if (!c || active.has(id) || state.activity.suppressed[c.email] || !boxes.length) { skipped++; continue; }
      cfg.enrollments.push({ id: newId(), contactId: id, sequenceId: seq.id, mailboxId: boxes[rr++ % boxes.length], status: 'active', createdAt: new Date().toISOString() });
      added++;
    }
  });
  return { added, skipped };
}

async function chooseSequence(ids) {
  if (!state.config.sequences.length) { toast('Create a sequence first'); location.hash = '#/sequences'; return; }
  const res = await dialog({
    title: `Add ${fmt(ids.length)} ${ids.length === 1 ? 'contact' : 'contacts'} to a sequence`,
    submit: 'Add to sequence',
    body: html`<div class="stack">
      <label class="field"><span>Sequence</span><select class="input" name="seq">${state.config.sequences.map((s) => html`<option value="${s.id}">${s.name}${s.status !== 'active' ? ` (${s.status})` : ''}</option>`)}</select></label>
      <p class="sec" style="margin:0">Contacts already in a sequence, or who unsubscribed or bounced, are skipped. Each contact is assigned one of the sequence’s mailboxes in turn, and every step goes out from that mailbox.</p></div>`.s,
    onSubmit: (f) => f.seq.value,
  });
  if (!res) return;
  const seq = state.config.sequences.find((s) => s.id === res);
  if (!seq.mailboxIds.length) { toast('Pick at least one mailbox for this sequence first'); location.hash = `#/sequences/${seq.id}`; return; }
  const { added, skipped } = enroll(ids, seq);
  ui.selected.clear();
  toast(`${fmt(added)} added to ${seq.name}${skipped ? `, ${fmt(skipped)} skipped` : ''}`);
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('That file is over 10 MB. Split it into smaller files'); return; }
  const text = await file.text();
  const existing = new Set(state.config.contacts.map((c) => c.email));
  const { contacts, skipped, missing } = contactsFromCSV(text, existing);
  if (missing.includes('email')) {
    await dialog({ title: 'No email column found', cancel: null, submit: 'OK',
      body: html`<p class="sec" style="margin:0">The first row should be headers: ${FIELDS.map((f) => FIELD_LABEL[f]).join(', ')}.</p>`.s });
    return;
  }
  const seqs = state.config.sequences;
  const res = await dialog({
    title: `Import ${file.name}`,
    submit: contacts.length ? `Import ${fmt(contacts.length)} contacts` : 'Close',
    body: html`<div class="stack">
      <div class="grid-2"><div><div class="sec">Ready to import</div><div class="figure num" style="font-size:24px;margin-top:4px">${fmt(contacts.length)}</div></div>
        <div><div class="sec">Skipped</div><div class="figure num" style="font-size:24px;margin-top:4px">${fmt(skipped.length)}</div></div></div>
      ${missing.length ? html`<div class="note">Columns not found, left blank: ${missing.map((f) => FIELD_LABEL[f]).join(', ')}</div>` : ''}
      ${skipped.length ? html`<details><summary class="sec" style="cursor:pointer">Show skipped rows</summary><ul class="mono muted" style="max-height:160px;overflow:auto;padding-left:16px">${skipped.slice(0, 200).map((s) => html`<li>Line ${s.line}: ${s.reason}</li>`)}</ul></details>` : ''}
      ${contacts.length && seqs.length ? html`<label class="field"><span>Then add them to</span><select class="input" name="seq"><option value="">Don’t add to a sequence yet</option>${seqs.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>` : ''}
    </div>`.s,
    onSubmit: (f) => ({ seq: f.seq?.value || '' }),
  });
  if (!res || !contacts.length) return;
  const now = new Date().toISOString();
  const added = contacts.map((c) => ({ ...c, id: newId(), createdAt: now, source: file.name }));
  update((cfg) => { cfg.contacts.push(...added); });
  toast(`${fmt(added.length)} contacts imported`);
  if (res.seq) {
    const seq = seqs.find((s) => s.id === res.seq);
    if (seq.mailboxIds.length) { const r = enroll(added.map((c) => c.id), seq); toast(`${fmt(r.added)} added to ${seq.name}`); }
    else toast('That sequence has no mailbox yet, so contacts were not added');
  }
}

function exportCSV(list) {
  const index = contactIndex(state.config, state.activity);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['First name', 'Last name', 'Company', 'Email', 'Industry', 'Phone num', 'Sequence', 'Status'].map(q).join(',')];
  for (const c of list) {
    const st = index.get(c.id);
    rows.push([c.firstName, c.lastName, c.company, c.email, c.industry, c.phone, st?.sequence || '', st?.status.label || ''].map(q).join(','));
  }
  download('contacts.csv', rows.join('\n'));
}

export default {
  rerenderOn: ['activity', 'config'],
  render(root) {
    const { config } = state;
    const index = contactIndex(config, state.activity);
    const list = filtered(index);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    ui.page = Math.min(ui.page, pages - 1);
    const rows = list.slice(ui.page * PAGE, ui.page * PAGE + PAGE);
    const industries = [...new Set(config.contacts.map((c) => c.industry).filter(Boolean))].sort();
    const sel = ui.selected;
    for (const id of sel) if (!config.contacts.some((c) => c.id === id)) sel.delete(id);
    const allOnPage = rows.length > 0 && rows.every((c) => sel.has(c.id));

    root.innerHTML = html`
      <div class="page-head">
        <div><h1>Contacts</h1><div class="sub">${fmt(config.contacts.length)} people, ${fmt(index.size)} in a sequence</div></div>
        <div class="actions">
          <button class="btn" id="export">${icon('download')}Export</button>
          <label class="btn primary" style="cursor:pointer">${icon('upload')}Upload CSV<input type="file" accept=".csv,text/csv" id="file" hidden></label>
        </div>
      </div>
      ${config.contacts.length === 0 ? html`
        <label class="drop" id="drop" style="display:block">${icon('upload')}
          <div style="color:var(--text);font-weight:500">Drop a CSV here, or click to choose one</div>
          <div class="muted" style="margin-top:4px">Columns: First name, Last name, Company, Email, Industry, Phone num</div>
          <input type="file" accept=".csv,text/csv" id="file2" hidden></label>` : html`
      <section class="card" id="drop-zone">
        <div class="toolbar">
          <div class="search">${icon('search')}<input class="input sm" id="q" placeholder="Search" value="${ui.q}" style="height:32px"></div>
          <select class="input sm" id="ind" style="height:32px"><option value="">All industries</option>${industries.map((i) => html`<option ${i === ui.industry ? 'selected' : ''}>${i}</option>`)}</select>
          <select class="input sm" id="st" style="height:32px">
            ${[['', 'Any status'], ['none', 'Not in a sequence'], ['queued', 'Queued'], ['active', 'In progress'], ['replied', 'Replied'], ['finished', 'Finished'], ['bounced', 'Bounced'], ['unsubscribed', 'Unsubscribed'], ['paused', 'Paused']]
              .map(([v, l]) => html`<option value="${v}" ${v === ui.status ? 'selected' : ''}>${l}</option>`)}</select>
          <div style="margin-left:auto" class="row">
            ${sel.size ? html`<span class="sec">${fmt(sel.size)} selected</span>
              <button class="btn sm" id="add-seq">${icon('split')}Add to sequence</button>
              <button class="btn sm" id="pause-sel">${icon('pause')}Stop sequence</button>
              <button class="btn sm danger" id="del-sel">${icon('trash')}Delete</button>` : html`<button class="btn sm" id="sel-all">Select all ${fmt(list.length)}</button>`}
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th style="width:44px"><input type="checkbox" class="check" id="page-all" ${allOnPage ? 'checked' : ''} aria-label="Select page"></th>
            <th>Name</th><th>Company</th><th>Email</th><th>Industry</th><th>Phone</th><th>Sequence</th><th>Status</th></tr></thead>
          <tbody>${rows.map((c) => {
            const st = index.get(c.id);
            const sup = state.activity.suppressed[c.email];
            return html`<tr><td><input type="checkbox" data-id="${c.id}" ${sel.has(c.id) ? 'checked' : ''} aria-label="Select ${fullName(c)}"></td>
              <td>${fullName(c)}</td><td class="sec">${c.company}</td><td class="sec">${c.email}</td><td class="sec">${c.industry}</td>
              <td class="sec num">${c.phone}</td><td class="sec">${st?.sequence || '—'}</td>
              <td>${st ? html`<span class="tag"><span class="dot ${({ err: 'err', ok: 'ok', accent: 'acc' })[st.status.tone] || ''}"></span>${st.status.label}</span>`
                : sup ? html`<span class="tag"><span class="dot err"></span>${sup === 'bounced' ? 'Bounced' : 'Unsubscribed'}</span>` : html`<span class="muted">Not in a sequence</span>`}</td></tr>`;
          })}</tbody></table>
          ${rows.length === 0 ? html`<div class="empty"><p>No contacts match these filters</p></div>` : ''}</div>
        <div class="pager"><span>${fmt(list.length ? ui.page * PAGE + 1 : 0)} to ${fmt(Math.min(list.length, (ui.page + 1) * PAGE))} of ${fmt(list.length)}</span>
          <span class="row"><button class="btn sm" id="prev" ${ui.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn sm" id="next" ${ui.page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>
      </section>`}`.s;

    const rerender = () => this.render(root);
    const onFile = (ev) => { importFile(ev.target.files[0]); ev.target.value = ''; };
    $('#file', root)?.addEventListener('change', onFile);
    $('#file2', root)?.addEventListener('change', onFile);
    const zone = $('#drop', root) || $('#drop-zone', root);
    zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone?.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); importFile(e.dataTransfer.files[0]); });
    $('#export', root)?.addEventListener('click', () => exportCSV(list));

    let qTimer;
    $('#q', root)?.addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { ui.q = e.target.value; ui.page = 0; rerender(); const q = $('#q', root); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200);
    });
    $('#ind', root)?.addEventListener('change', (e) => { ui.industry = e.target.value; ui.page = 0; rerender(); });
    $('#st', root)?.addEventListener('change', (e) => { ui.status = e.target.value; ui.page = 0; rerender(); });
    $('#prev', root)?.addEventListener('click', () => { ui.page--; rerender(); });
    $('#next', root)?.addEventListener('click', () => { ui.page++; rerender(); });
    $('#sel-all', root)?.addEventListener('click', () => { list.forEach((c) => sel.add(c.id)); rerender(); });
    $('#page-all', root)?.addEventListener('change', (e) => { rows.forEach((c) => (e.target.checked ? sel.add(c.id) : sel.delete(c.id))); rerender(); });
    $$('input[data-id]', root).forEach((cb) => cb.addEventListener('change', () => { cb.checked ? sel.add(cb.dataset.id) : sel.delete(cb.dataset.id); rerender(); }));
    $('#add-seq', root)?.addEventListener('click', () => chooseSequence([...sel]));
    $('#pause-sel', root)?.addEventListener('click', () => {
      let n = 0;
      update((cfg) => { for (const e of cfg.enrollments) if (sel.has(e.contactId) && (e.status === 'active' || e.status === 'paused')) { e.status = 'removed'; n++; } });
      sel.clear(); toast(`${fmt(n)} taken out of their sequence`);
    });
    $('#del-sel', root)?.addEventListener('click', async () => {
      const n = sel.size;
      if (!(await confirmDialog(`Delete ${fmt(n)} contacts`, 'They are removed from every sequence. Sent history stays in the stats.'))) return;
      update((cfg) => {
        cfg.contacts = cfg.contacts.filter((c) => !sel.has(c.id));
        cfg.enrollments = cfg.enrollments.filter((e) => !sel.has(e.contactId));
      });
      sel.clear(); toast(`${fmt(n)} contacts deleted`);
    });
  },
};
