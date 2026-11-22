// App state + GitHub sync. Config is written by the dashboard, activity by the engine.
import { encryptJSON, decryptJSON, randomId } from './core/crypto.js';
import { emptyActivity, emptyConfig } from './core/schedule.js';
import { dialog } from './ui.js';

const API = 'https://api.github.com';
const CONFIG_PATH = 'data/config.enc.json';
const ACTIVITY_PATH = 'data/activity.enc.json';
const LS_KEY = 'outreach-desk:conn';

const listeners = new Set();
export const state = {
  mode: null, // 'github' | 'demo'
  conn: null, // { owner, repo, token, passphrase }
  config: null,
  activity: null,
  sha: { config: null, activity: null },
  etag: null,
  sync: 'idle', // idle | saving | saved | error
  syncError: '',
  secrets: new Set(),
  lastRun: null,
};

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

// Local storage is a convenience only, so every access is guarded.
function lsGet(k, store = localStorage) { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v, store = localStorage) { try { store.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } }
function lsDel(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* blocked */ } }

export function savedConnection() { return lsGet(LS_KEY) || lsGet(LS_KEY, sessionStorage); }
export function forgetConnection() { lsDel(LS_KEY); }

export function guessRepo() {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m ? { owner: m[1], repo: repo || `${m[1]}.github.io` } : { owner: '', repo: '' };
}

async function gh(path, { method = 'GET', body, headers = {} } = {}) {
  const { token, owner, repo } = state.conn;
  const url = path.startsWith('http') ? path : `${API}/repos/${owner}/${repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 304) return { status: 304 };
  if (res.status === 404) return { status: 404 };
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* not json */ }
    if (res.status === 403 && /personal access token/i.test(msg)) {
      const accepted = res.headers.get('X-Accepted-GitHub-Permissions') || '';
      const need = path.includes('/secrets') ? 'Secrets' : path.includes('/actions') ? 'Actions' : 'Contents';
      msg = `the token isn’t allowed to ${method === 'GET' ? 'read' : 'write'} ${need} on ${state.conn.owner}/${state.conn.repo}`
        + `${accepted ? ` (GitHub wants: ${accepted})` : ''}. Check the token’s Repository access includes ${state.conn.repo} and ${need} is Read and write`;
    }
    const err = new Error(`GitHub: ${msg} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return { status: 204 };
  return { status: res.status, data: await res.json(), etag: res.headers.get('ETag') };
}

async function readEncrypted(path, etag) {
  const r = await gh(`/contents/${path}?ref=main&t=${Date.now()}`, { headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.status === 404 || r.status === 304) return r;
  let content = r.data.content;
  if (!content && r.data.sha) content = (await gh(`/git/blobs/${r.data.sha}`)).data.content; // files over 1 MB
  const box = JSON.parse(atob(content.replace(/\n/g, '')));
  return { status: 200, sha: r.data.sha, etag: r.etag, data: await decryptJSON(box, state.conn.passphrase) };
}

export async function connect({ owner, repo, token, passphrase, remember }) {
  state.conn = { owner: owner.trim(), repo: repo.trim(), token: token.trim(), passphrase };
  const info = await gh('');
  if (info.status === 404) throw new Error('Repository not found, or the token cannot see it');
  if (!info.data.permissions?.push) throw new Error('The token needs write access to this repository');
  const cfg = await readEncrypted(CONFIG_PATH);
  state.config = cfg.status === 404 ? emptyConfig() : migrate(cfg.data);
  state.sha.config = cfg.sha || null;
  state.etagConfig = cfg.etag || null;
  const act = await readEncrypted(ACTIVITY_PATH);
  state.activity = act.status === 404 ? emptyActivity() : act.data;
  state.sha.activity = act.sha || null;
  state.etag = act.etag || null;
  state.mode = 'github';
  lsSet(LS_KEY, state.conn, remember ? localStorage : sessionStorage);
  if (remember) { try { sessionStorage.removeItem(LS_KEY); } catch { /* blocked */ } }
  if (cfg.status === 404) await saveNow('Create outreach config');
  refreshSecrets().catch(() => {});
  refreshRun().catch(() => {});
  // The engine needs the passphrase too. Store it as a repo secret if it is not there yet.
  setTimeout(async () => {
    if (!state.secrets.has('OUTREACH_PASSPHRASE')) {
      try { await setSecret('OUTREACH_PASSPHRASE', passphrase); } catch { /* shown in Settings */ }
    }
  }, 1500);
  emit('all');
}

export function startDemo(demo) {
  state.mode = 'demo';
  state.conn = null;
  state.config = demo.config;
  state.activity = demo.activity;
  state.lastRun = { status: 'completed', conclusion: 'success', at: new Date(Date.now() - 7 * 60000).toISOString() };
  emit('all');
}

function migrate(cfg) {
  const base = emptyConfig();
  return { ...base, ...cfg, settings: { ...base.settings, ...(cfg.settings || {}) } };
}

// Saving: edits call update(); writes are debounced into one commit.
let saveTimer = null;
let saving = null;
export function update(mutator, { silent = false } = {}) {
  mutator(state.config);
  if (!silent) emit('config');
  if (state.mode !== 'github') return;
  state.sync = 'pending';
  emit('sync');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow().catch(() => {}), 1200);
}

async function putConfig(message) {
  const box = await encryptJSON(state.config, state.conn.passphrase);
  const body = { message, content: btoa(JSON.stringify(box) + '\n'), branch: 'main' };
  if (state.sha.config) body.sha = state.sha.config;
  const r = await gh(`/contents/${CONFIG_PATH}`, { method: 'PUT', body });
  state.sha.config = r.data.content.sha;
  state.sync = 'saved';
  state.syncError = '';
}

async function loadLatestConfig() {
  const cfg = await readEncrypted(CONFIG_PATH);
  if (cfg.status !== 200) return false;
  state.config = migrate(cfg.data);
  state.sha.config = cfg.sha;
  state.etagConfig = cfg.etag;
  state.sync = 'saved';
  state.syncError = '';
  emit('all');
  return true;
}

// Another tab or device saved after this page loaded. Let the user pick which version wins.
async function resolveConflict(message) {
  const keep = await dialog({
    title: 'Saved somewhere else too',
    body: '<p class="sec" style="margin:0">EVA was saved from another tab or device after this page loaded. Keep what’s on this screen, which replaces the other changes, or load the newer version, which drops changes made here since then.</p>',
    submit: 'Keep this version',
    cancel: 'Load newer version',
  });
  if (keep) {
    state.sha.config = (await gh(`/contents/${CONFIG_PATH}?ref=main&t=${Date.now()}`)).data?.sha || null;
    await putConfig(message);
  } else {
    await loadLatestConfig();
  }
}

export async function saveNow(message = 'Update outreach config') {
  if (state.mode !== 'github') return;
  clearTimeout(saveTimer);
  if (saving) await saving.catch(() => {});
  state.sync = 'saving';
  emit('sync');
  saving = (async () => {
    try {
      await putConfig(message);
    } catch (err) {
      if (err.status !== 409 && err.status !== 422) {
        state.sync = 'error';
        state.syncError = err.message;
        throw err;
      }
      try { await resolveConflict(message); } catch (e2) { state.sync = 'error'; state.syncError = e2.message; throw e2; }
    } finally {
      saving = null;
      emit('sync');
    }
  })();
  return saving;
}

/** Pull in config saved from another tab or device, unless this page has unsaved edits. */
export async function refreshConfig() {
  if (state.mode !== 'github' || state.sync === 'pending' || state.sync === 'saving' || saving) return;
  const r = await readEncrypted(CONFIG_PATH, state.etagConfig);
  if (r.status !== 200) return;
  state.etagConfig = r.etag;
  if (r.sha === state.sha.config || state.sync === 'pending') return;
  state.config = migrate(r.data);
  state.sha.config = r.sha;
  emit('all');
}

/** Poll the engine's activity file. Resolves with new non-auto replies. */
export async function refreshActivity() {
  if (state.mode !== 'github') return [];
  const r = await readEncrypted(ACTIVITY_PATH, state.etag);
  if (r.status !== 200) return [];
  const known = new Set((state.activity?.replies || []).map((x) => x.id));
  state.activity = r.data;
  state.sha.activity = r.sha;
  state.etag = r.etag;
  emit('activity');
  return r.data.replies.filter((x) => !known.has(x.id) && !x.auto);
}

export async function refreshSecrets() {
  if (state.mode !== 'github') return;
  const r = await gh('/actions/secrets?per_page=100');
  state.secrets = new Set((r.data?.secrets || []).map((s) => s.name));
  emit('secrets');
}

export async function refreshRun() {
  if (state.mode !== 'github') return;
  const r = await gh('/actions/workflows/engine.yml/runs?per_page=1');
  const run = r.data?.workflow_runs?.[0];
  state.lastRun = run ? { status: run.status, conclusion: run.conclusion, at: run.updated_at, url: run.html_url } : null;
  emit('run');
}

export async function runEngine(dryRun = false) {
  if (state.mode !== 'github') throw new Error('Connect a repository to run the engine');
  await saveNow();
  await gh('/actions/workflows/engine.yml/dispatches', { method: 'POST', body: { ref: 'main', inputs: { dry_run: dryRun } } });
  setTimeout(() => refreshRun().catch(() => {}), 4000);
}

/** Encrypt a value with the repo's public key (libsodium sealed box) and store it as an Actions secret. */
export async function setSecret(name, value) {
  if (state.mode !== 'github') throw new Error('Connect a repository first');
  const { default: sodium } = await import('https://esm.sh/libsodium-wrappers@0.7.15');
  await sodium.ready;
  const key = (await gh('/actions/secrets/public-key')).data;
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL));
  await gh(`/actions/secrets/${name}`, { method: 'PUT', body: { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: key.key_id } });
  state.secrets.add(name);
  emit('secrets');
}

export const newId = () => randomId(6);
export const MAX_MAILBOXES = 20;
export const secretName = (mailbox) => `MAILBOX_${mailbox.slot}`;
export function freeSlot() {
  const used = new Set(state.config.mailboxes.map((m) => m.slot));
  for (let i = 1; i <= MAX_MAILBOXES; i++) if (!used.has(i)) return i;
  return null;
}
