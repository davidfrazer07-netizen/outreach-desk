// Shell, router, polling and reply notifications.
import { state, onChange, savedConnection, connect, refreshActivity, refreshConfig, refreshRun, runEngine } from './store.js';
import { html, icon, brand, $, ago, toast, fullName } from './ui.js';
import connectView from './views/connect.js';
import overview from './views/overview.js';
import contacts from './views/contacts.js';
import sequences from './views/sequences.js';
import templates from './views/templates.js';
import mailboxes from './views/mailboxes.js';
import replies from './views/replies.js';
import settings from './views/settings.js';

const ROUTES = [
  { path: '', view: overview, label: 'Overview', icon: 'overview' },
  { path: 'contacts', view: contacts, label: 'Contacts', icon: 'users' },
  { path: 'sequences', view: sequences, label: 'Sequences', icon: 'split' },
  { path: 'templates', view: templates, label: 'Templates', icon: 'file' },
  { path: 'mailboxes', view: mailboxes, label: 'Mailboxes', icon: 'mail' },
  { path: 'replies', view: replies, label: 'Replies', icon: 'reply' },
  { path: 'settings', view: settings, label: 'Settings', icon: 'sliders', group: 'end' },
];

const app = document.getElementById('app');
let current = null;
let cleanup = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { path: parts[0] || '', param: parts[1] ? decodeURIComponent(parts[1]) : null };
}

const unreadCount = () => (state.activity?.replies || []).filter((r) => !r.auto && !state.config.repliesRead[r.id]).length;

function shell() {
  const { path } = parseHash();
  const unread = unreadCount();
  const link = (r) => html`<a href="#/${r.path}" aria-current="${r.path === path ? 'page' : 'false'}">${icon(r.icon)}<span>${r.label}</span>${r.path === 'replies' && unread ? html`<span class="count">${unread}</span>` : ''}</a>`;
  app.innerHTML = html`
    <div class="shell">
      <aside class="side" id="side">
        ${brand()}
        <nav class="nav" aria-label="Main">${ROUTES.filter((r) => !r.group).map(link)}</nav>
        <div class="nav-label">Workspace</div>
        <nav class="nav" aria-label="Workspace" style="margin-top:0">${ROUTES.filter((r) => r.group).map(link)}</nav>
        <div class="side-foot" id="side-foot"></div>
      </aside>
      <div class="main">
        <div class="mob-bar"><button class="btn ghost icon" id="menu" aria-label="Menu">${icon('menu')}</button>${brand('padding:0')}</div>
        <main class="page" id="view"></main>
      </div>
    </div>`.s;
  $('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
  footer();
}

function footer() {
  const el = $('#side-foot');
  if (!el) return;
  const demo = state.mode === 'demo';
  const sync = { idle: ['ok', 'Synced'], pending: ['busy', 'Unsaved changes'], saving: ['busy', 'Saving'], saved: ['ok', 'Saved to GitHub'], error: ['err', 'Save failed'] }[state.sync] || ['ok', 'Synced'];
  const run = state.lastRun;
  const runTone = !run ? '' : run.status !== 'completed' ? 'busy' : run.conclusion === 'success' ? 'ok' : 'err';
  const runText = !run ? 'Engine has not run yet' : run.status !== 'completed' ? 'Engine running' : `Engine ran ${ago(run.at)}`;
  el.innerHTML = html`
    ${demo ? html`<div class="status-line"><span class="dot busy"></span>Sample data, not saved</div>`
    : html`<div class="status-line" title="${state.syncError}"><span class="dot ${sync[0]}"></span>${sync[1]}</div>`}
    <div class="status-line"><span class="dot ${runTone}"></span>${runText}</div>
    ${demo ? html`<a class="btn sm" href="#/settings" data-exit-demo>Connect GitHub</a>`
    : html`<button class="btn sm" id="run-now">${icon('play')}Run engine now</button>`}`.s;
  $('#run-now')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try { await runEngine(false); toast('Engine started. Results show up in a minute or two'); } catch (err) { toast(err.message); }
  });
  $('[data-exit-demo]')?.addEventListener('click', () => { state.mode = null; boot(); });
}

function navCounts() {
  const a = $('a[href="#/replies"]');
  if (!a) return;
  const n = unreadCount();
  let c = a.querySelector('.count');
  if (n && !c) { c = document.createElement('span'); c.className = 'count'; a.append(c); }
  if (c) { if (n) c.textContent = n; else c.remove(); }
}

function route() {
  if (!state.mode) return;
  const { path, param } = parseHash();
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  if (!$('#view')) shell();
  document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === `#/${r.path}` ? 'page' : 'false'));
  if (cleanup) cleanup();
  current = r;
  const root = $('#view');
  root.classList.remove('enter');
  void root.offsetWidth;
  root.classList.add('enter');
  document.title = `${r.label} · EVA`;
  cleanup = r.view.render(root, { param }) || null;
  window.scrollTo(0, 0);
}

function rerender(what) {
  if (!current || !state.mode) return;
  const on = current.view.rerenderOn || ['activity', 'config'];
  const typing = document.activeElement?.closest?.('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (what !== 'all' && typing) return;
  if (what === 'all' || on.includes(what)) {
    if (cleanup) cleanup();
    cleanup = current.view.render($('#view'), parseHash()) || null;
  }
}

onChange((what) => {
  if (what === 'all') { shell(); route(); return; }
  if (['sync', 'run', 'secrets'].includes(what)) { footer(); if (current?.view.rerenderOn?.includes(what)) rerender(what); return; }
  navCounts();
  rerender(what);
});

// Reply notifications: poll the activity file while the dashboard is open.
function notify(newOnes) {
  for (const r of newOnes) {
    const e = state.config.enrollments.find((x) => x.id === r.enrollmentId);
    const c = state.config.contacts.find((x) => x.id === e?.contactId);
    const title = `Reply from ${fullName(c) || r.from}`;
    toast(title);
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body: r.snippet.slice(0, 140), tag: r.id });
        n.onclick = () => { window.focus(); location.hash = '#/replies'; };
      }
    } catch { /* not supported */ }
  }
}

setInterval(async () => {
  if (state.mode !== 'github' || document.hidden) return;
  try { notify(await refreshActivity()); } catch { /* offline */ }
  try { await refreshConfig(); } catch { /* offline */ }
}, 60000);
setInterval(() => { if (state.mode === 'github' && !document.hidden) refreshRun().catch(() => {}); footer(); }, 120000);

// Tell the user when a newer dashboard has been deployed.
const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
let updateShown = false;
async function checkVersion() {
  if (VERSION === 'dev' || updateShown || document.hidden) return;
  try {
    const page = await (await fetch(`./?check=${Date.now()}`, { cache: 'no-store' })).text();
    const live = page.match(/name="app-version" content="([^"]+)"/)?.[1];
    if (live && live !== VERSION) { updateShown = true; toast('A newer version of the dashboard is out. Reload the page to get it'); }
  } catch { /* offline */ }
}
setInterval(checkVersion, 300000);
document.addEventListener('visibilitychange', checkVersion);
// Coming back to this tab (say, after editing on the phone): pick up newer settings first.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshConfig().catch(() => {}); });

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (state.sync === 'pending' || state.sync === 'saving') e.preventDefault(); });

async function boot() {
  const saved = savedConnection();
  if (saved?.token && saved?.passphrase) {
    app.innerHTML = '<div class="empty" style="padding-top:30vh">Opening EVA</div>';
    let remember = false;
    try { remember = !!localStorage.getItem('outreach-desk:conn'); } catch { /* storage blocked */ }
    try { await connect({ ...saved, remember }); return; } catch (err) {
      connectView.render(app, { error: err.message, prefill: saved });
      return;
    }
  }
  connectView.render(app, {});
}

boot();
