import { html, icon, $, $$, ago, fullName, toast } from '../ui.js';
import { state, update } from '../store.js';

let filter = 'unread';

function context(r) {
  const { config } = state;
  const e = config.enrollments.find((x) => x.id === r.enrollmentId);
  return {
    contact: config.contacts.find((x) => x.id === e?.contactId),
    sequence: config.sequences.find((x) => x.id === e?.sequenceId),
    mailbox: config.mailboxes.find((x) => x.id === r.mailboxId),
  };
}

export default {
  rerenderOn: ['activity', 'config'],
  render(root) {
    const { config, activity } = state;
    const read = config.repliesRead;
    const all = activity.replies;
    const list = all.filter((r) => (filter === 'auto' ? r.auto : !r.auto && (filter === 'all' || !read[r.id])));
    const unread = all.filter((r) => !r.auto && !read[r.id]).length;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';

    root.innerHTML = html`
      <div class="page-head"><div><h1>Replies</h1><div class="sub">${unread ? `${unread} unread` : 'All caught up'}. A reply stops that contact’s sequence</div></div>
        <div class="actions">
          ${perm === 'default' ? html`<button class="btn" id="perm">${icon('bell')}Alert me in this browser</button>` : ''}
          ${unread ? html`<button class="btn" id="all-read">${icon('check')}Mark all read</button>` : ''}
          <div class="seg" role="group" aria-label="Filter">
            ${[['unread', 'Unread'], ['all', 'All replies'], ['auto', 'Auto-replies']].map(([k, l]) => html`<button data-f="${k}" aria-pressed="${k === filter}">${l}</button>`)}
          </div></div></div>
      <section class="card">
        ${list.length ? list.slice(0, 200).map((r) => {
          const { contact, sequence, mailbox } = context(r);
          const isNew = !r.auto && !read[r.id];
          const reSubj = r.subject?.startsWith('Re:') ? r.subject : `Re: ${r.subject || ''}`;
          return html`<article class="reply" data-id="${r.id}">
            <div class="who">${isNew ? html`<span class="unread" aria-label="Unread"></span>` : ''}${contact ? fullName(contact) : (r.fromName || r.from)}
              ${contact?.company ? html`<span class="sec" style="font-weight:400">${contact.company}</span>` : ''}</div>
            <div class="mono muted" title="${new Date(r.date).toLocaleString()}">${ago(r.date)}</div>
            <div class="subj" style="grid-column:1/-1">${r.subject} <span class="muted">· ${sequence?.name || 'Sequence deleted'} · to ${mailbox?.email || 'removed mailbox'}</span></div>
            <div class="snip">${r.snippet || 'No text'}</div>
            <div class="row" style="grid-column:1/-1;gap:4px;margin-top:4px">
              <a class="btn sm" href="mailto:${encodeURIComponent(r.from)}?subject=${encodeURIComponent(reSubj)}">${icon('reply')}Reply</a>
              ${r.auto ? '' : html`<button class="btn ghost sm" data-toggle="${r.id}">${read[r.id] ? 'Mark unread' : 'Mark read'}</button>`}
              <button class="btn ghost sm" data-more="${r.id}">Show all</button>
            </div></article>`;
        }) : html`<div class="empty"><h3>${filter === 'unread' ? 'No unread replies' : 'No replies yet'}</h3>
          <p>The engine checks every mailbox’s inbox every 15 minutes. You’ll get an email${config.settings.ntfyTopic ? ', a phone push' : ''} and a browser alert for each new reply.</p></div>`}
      </section>`.s;

    $$('[data-f]', root).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; this.render(root); }));
    $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', () => update((cfg) => {
      if (cfg.repliesRead[b.dataset.toggle]) delete cfg.repliesRead[b.dataset.toggle]; else cfg.repliesRead[b.dataset.toggle] = true;
    })));
    $$('[data-more]', root).forEach((b) => b.addEventListener('click', () => {
      const card = b.closest('.reply'); card.classList.toggle('open');
      b.textContent = card.classList.contains('open') ? 'Show less' : 'Show all';
    }));
    $('#all-read', root)?.addEventListener('click', () => update((cfg) => { all.forEach((r) => { if (!r.auto) cfg.repliesRead[r.id] = true; }); }));
    $('#perm', root)?.addEventListener('click', async () => {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'You’ll get an alert here while this tab is open' : 'Alerts are blocked in this browser');
      this.render(root);
    });
  },
};
