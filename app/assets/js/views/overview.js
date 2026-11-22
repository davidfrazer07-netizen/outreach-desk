import { html, icon, $, fmt, pct, ago, fullName } from '../ui.js';
import { state } from '../store.js';
import { series, totals, previousTotals, sequenceStats, mailboxToday } from '../core/stats.js';
import { zoned } from '../core/schedule.js';
import { COUNTRIES, homeCountry, reachByCountry } from '../core/geo.js';
import { mountGlobe } from './globe.js';

function reachCard(reach, home) {
  const top = reach.rows.slice(0, 7);
  const max = Math.max(1, ...top.map((r) => r.contacts));
  const rest = reach.rows.length - top.length;
  return html`<section class="card" style="margin-bottom:16px">
    <div class="card-head"><h2>Where your emails go</h2><span class="right muted" style="font-size:12px">From phone codes and email domains</span></div>
    <div class="reach">
      <div class="globe-wrap"><canvas id="globe" role="img" aria-label="Globe with routes from ${COUNTRIES[home].name} to ${reach.rows.length} countries"></canvas></div>
      <div class="reach-list">
        ${top.length ? top.map((r) => html`<button class="reach-row" data-iso="${r.iso}">
          <span class="name">${r.name}${r.iso === home ? html`<span class="mono muted"> · home</span>` : ''}</span>
          <span class="mono">${fmt(r.contacts)}</span>
          <span class="bar"><i style="width:${(r.contacts / max) * 100}%"></i></span>
          <span class="mono muted" title="Reply rate of contacts emailed">${r.reached ? `${pct(r.replied, r.reached)} reply` : 'Not emailed yet'}</span></button>`)
          : html`<p class="sec" style="margin:0">Upload contacts to see where they are</p>`}
        ${rest > 0 || reach.unknown ? html`<p class="muted" style="font-size:12px;margin:8px 0 0">${[rest > 0 ? `${rest} more ${rest === 1 ? 'country' : 'countries'}` : '', reach.unknown ? `${fmt(reach.unknown)} contacts with no phone or country domain` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      </div>
    </div></section>`;
}

let range = 14;

function delta(cur, prev, unit = '', label = 'vs previous period') {
  if (!prev) return html`<span>No earlier data to compare</span>`;
  const d = cur - prev;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
  const v = unit === 'pt' ? `${d >= 0 ? '+' : ''}${d.toFixed(1)} pts` : `${d >= 0 ? '+' : ''}${fmt(d)}`;
  return html`<b class="${cls}">${v}</b> ${label}`;
}

function chartSVG(rows, width) {
  const h = 300; const padL = 32; const padB = 24; const padT = 12;
  const w = Math.max(320, width);
  const max = Math.max(4, ...rows.map((r) => r.sent));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (h - padT - padB) * (1 - v / top);
  const bw = (w - padL) / rows.length;
  const barW = Math.max(4, Math.min(28, bw * 0.56));
  const x = (i) => padL + bw * i + bw / 2;
  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line class="gridline" x1="${padL}" x2="${w}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  let bars = '';
  rows.forEach((r, i) => {
    const bx = x(i) - barW / 2;
    bars += `<rect x="${bx}" y="${y(r.sent)}" width="${barW}" height="${y(0) - y(r.sent)}" rx="3" fill="var(--c-sent)"/>`;
    if (r.replied) bars += `<rect x="${bx}" y="${y(r.replied)}" width="${barW}" height="${y(0) - y(r.replied)}" rx="3" fill="var(--c-reply)"/>`;
    bars += `<rect x="${padL + bw * i}" y="${padT}" width="${bw}" height="${h - padT - padB}" fill="transparent" data-i="${i}"/>`;
  });
  const pts = rows.map((r, i) => [x(i), y(r.opened)]);
  const line = smooth(pts);
  const every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((w - padL) / 64))));
  const labels = rows.map((r, i) => ((rows.length - 1 - i) % every === 0
    ? `<text class="axis" x="${x(i)}" y="${h - 4}" text-anchor="middle">${new Date(`${r.day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>` : '')).join('');
  const dots = pts.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="2.5" fill="var(--card)" stroke="var(--c-open)" stroke-width="1.5"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Emails sent, opened and replied per day">
    ${grid}${bars}<path d="${line}" fill="none" stroke="var(--c-open)" stroke-width="1.75"/>${dots}${labels}</svg>`;
}

function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
}

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] || pts[i]; const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; const [x3, y3] = pts[i + 2] || pts[i + 1];
    const t = 0.18;
    d += ` C${x1 + (x2 - x0) * t},${y1 + (y2 - y0) * t} ${x2 - (x3 - x1) * t},${y2 - (y3 - y1) * t} ${x2},${y2}`;
  }
  return d;
}

function feedItem(ev, cfg) {
  const e = cfg.enrollments.find((x) => x.id === ev.enrollmentId);
  const c = cfg.contacts.find((x) => x.id === e?.contactId);
  const verbs = { sent: ['send', 'Emailed'], opened: ['eye', 'Opened by'], replied: ['reply', 'Reply from'], bounced: ['alert', 'Bounced'], unsubscribed: ['ban', 'Unsubscribed'] };
  const [ic, verb] = verbs[ev.type] || ['mail', ev.type];
  return html`<li class="${ev.type}">${icon(ic)}<span>${verb} <span class="sec">${fullName(c)}</span>${c?.company ? html`<span class="muted"> · ${c.company}</span>` : ''}</span><span class="when">${ago(ev.t)}</span></li>`;
}

export default {
  rerenderOn: ['activity', 'config'],
  render(root) {
    const { config, activity } = state;
    const tz = config.settings.timezone || 'UTC';
    const rows = series(activity, range, tz);
    const t = totals(rows);
    const prev = previousTotals(activity, range, tz);
    const openRate = t.sent ? (t.opened / t.sent) * 100 : 0;
    const replyRate = t.sent ? (t.replied / t.sent) * 100 : 0;
    const prevOpen = prev.sent ? (prev.opened / prev.sent) * 100 : 0;
    const prevReply = prev.sent ? (prev.replied / prev.sent) * 100 : 0;
    const unread = activity.replies.filter((r) => !r.auto && !config.repliesRead[r.id]).length;
    const today = zoned(new Date(), tz).date;
    const monthTitle = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const empty = config.contacts.length === 0;
    const recent = activity.events.filter((e) => e.type !== 'sent').slice(-8).reverse();
    const home = homeCountry(tz);
    const reach = reachByCountry(config, activity, home);

    root.innerHTML = html`
      <div class="page-head">
        <div><h1>${monthTitle}</h1><div class="sub">Last ${range} days, ${tz.replace('_', ' ')} time</div></div>
        <div class="actions"><div class="seg" role="group" aria-label="Range">
          ${[7, 14, 30].map((d) => html`<button data-range="${d}" aria-pressed="${d === range}">${d} days</button>`)}
        </div></div>
      </div>
      ${empty ? html`<div class="card empty" style="margin-bottom:16px"><h3>Start with your contacts</h3>
        <p>Upload a CSV with first name, last name, company, email, industry and phone, then build a sequence and add a mailbox.</p>
        <a class="btn primary" href="#/contacts">${icon('upload')}Upload contacts</a></div>` : ''}
      <div class="stats">
        <div class="card stat"><div class="label">Emails sent</div><div class="figure num">${fmt(t.sent)}</div><div class="delta">${delta(t.sent, prev.sent)}</div></div>
        <div class="card stat"><div class="label">Open rate</div><div class="figure num">${pct(t.opened, t.sent)}</div><div class="delta">${prev.sent ? delta(openRate, prevOpen, 'pt') : delta(0, 0)}</div></div>
        <div class="card stat lead"><div class="label">Reply rate</div><div class="figure num">${pct(t.replied, t.sent)}</div><div class="delta">${prev.sent ? delta(replyRate, prevReply, 'pt') : delta(0, 0)}</div></div>
        <a class="card stat" href="#/replies" style="text-decoration:none"><div class="label">Replies to read</div><div class="figure num">${fmt(unread)}</div><div class="delta">${fmt(t.replied)} replies in ${range} days</div></a>
      </div>
      <div class="duo">
        <section class="card">
          <div class="card-head"><h2>Daily activity</h2>
            <div class="right legend"><span><i style="background:var(--c-sent)"></i>Sent</span><span><i style="background:var(--c-open);height:2px;vertical-align:3px"></i>Opened</span><span><i style="background:var(--c-reply)"></i>Replied</span></div></div>
          <div class="chart" id="chart"></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Mailboxes today</h2><a class="right btn ghost sm" href="#/mailboxes">Manage</a></div>
          <div class="box-list">
            ${config.mailboxes.length ? config.mailboxes.map((m) => {
              const used = mailboxToday(activity, m, today);
              const lim = m.dailyLimit || 0;
              const st = activity.mailboxStatus[m.id];
              return html`<div class="box-row">
                <div class="top"><span class="tag"><span class="dot ${st?.ok === false ? 'err' : st?.ok ? 'ok' : ''}"></span>${m.email}</span><span class="mono muted">${used} of ${lim}</span></div>
                ${lim <= 40 ? html`<div class="allow" aria-label="${used} of ${lim} sent today">${Array.from({ length: lim }, (_, i) => html`<i class="${i < used ? 'used' : ''}"></i>`)}</div>`
                  : html`<div class="allow-bar"><i style="width:${Math.min(100, (used / lim) * 100)}%"></i></div>`}
              </div>`;
            }) : html`<div class="empty"><p>No mailboxes yet</p><a class="btn sm" href="#/mailboxes">${icon('plus')}Add mailbox</a></div>`}
          </div>
        </section>
      </div>
      ${reachCard(reach, home)}
      <div class="duo">
        <section class="card">
          <div class="card-head"><h2>Sequences</h2><a class="right btn ghost sm" href="#/sequences">All sequences</a></div>
          ${config.sequences.length ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Name</th><th>Status</th><th class="num">Contacts</th><th class="num">Sent</th><th class="num">Opened</th><th class="num">Replied</th></tr></thead>
            <tbody>${config.sequences.map((s) => {
              const st = sequenceStats(s, config, activity);
              return html`<tr class="link" data-href="#/sequences/${s.id}"><td>${s.name}</td>
                <td><span class="tag"><span class="dot ${s.status === 'active' ? 'ok' : ''}"></span>${s.status === 'active' ? 'Active' : s.status === 'paused' ? 'Paused' : 'Draft'}</span></td>
                <td class="num">${fmt(st.contacts)}</td><td class="num">${fmt(st.sent)}</td>
                <td class="num">${pct(st.opened, st.reached)}</td><td class="num">${pct(st.replied, st.reached)}</td></tr>`;
            })}</tbody></table></div>` : html`<div class="empty"><p>No sequences yet</p><a class="btn sm" href="#/sequences">${icon('plus')}New sequence</a></div>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Recent activity</h2></div>
          ${recent.length ? html`<ul class="feed">${recent.map((e) => feedItem(e, config))}</ul>` : html`<div class="empty"><p>Opens and replies show up here</p></div>`}
        </section>
      </div>`.s;

    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = Number(b.dataset.range); this.render(root); }));
    root.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));

    const holder = $('#chart', root);
    const draw = () => {
      holder.innerHTML = chartSVG(rows, holder.clientWidth - 40);
      wireTip(holder, rows);
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(holder);

    // The globe loads its map from a CDN. If that fails, the country list still shows.
    let globe = null;
    let gone = false;
    const canvas = $('#globe', root);
    mountGlobe(canvas, { home: COUNTRIES[home], targets: reach.rows }).then((g) => {
      if (gone) g.destroy(); else globe = g;
    }).catch(() => { canvas.closest('.globe-wrap').classList.add('off'); });
    root.querySelectorAll('.reach-row').forEach((b) => {
      const c = COUNTRIES[b.dataset.iso];
      const go = () => globe?.focus(c.lon, c.lat);
      b.addEventListener('mouseenter', go);
      b.addEventListener('focus', go);
      b.addEventListener('click', go);
    });
    return () => { gone = true; globe?.destroy(); ro.disconnect(); document.querySelector('.tip')?.remove(); };
  },
};

function wireTip(holder, rows) {
  let tip = document.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.append(tip); }
  holder.querySelectorAll('rect[data-i]').forEach((r) => {
    r.addEventListener('mouseenter', () => {
      const d = rows[Number(r.dataset.i)];
      tip.innerHTML = html`<div class="sec">${new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div class="num">${d.sent} sent · ${d.opened} opened · <span style="color:var(--accent)">${d.replied} replied</span></div>`.s;
      tip.classList.add('on');
    });
    r.addEventListener('mousemove', (e) => { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 48}px`; });
    r.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}
