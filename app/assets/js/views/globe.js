// Rotating globe: arcs from home to every country with contacts, with emails "in flight".
// Drag to spin; hovering a country in the list turns the globe to it. Pauses when hidden.
// With reduced motion it still turns, slower, without the moving dots and the pulse.
const LIBS = {
  geo: 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm',
  topo: 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm',
  land: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json',
};
let loading = null;
let saved = null; // keeps the rotation when the overview re-renders
function load() {
  loading ||= Promise.all([import(LIBS.geo), import(LIBS.topo), fetch(LIBS.land).then((r) => r.json())])
    .then(([geo, topo, world]) => ({ geo, land: topo.feature(world, world.objects.land) }))
    .catch((e) => { loading = null; throw e; });
  return loading;
}

function palette(el) {
  const s = getComputedStyle(el);
  const v = (n) => s.getPropertyValue(n).trim();
  return { ocean: v('--card'), text: v('--text'), line: v('--line-2'), accent: v('--accent'), muted: v('--muted') };
}

/** Mounts on a canvas. Resolves to { focus(lon, lat), destroy() }. */
export async function mountGlobe(canvas, { home, targets }) {
  const { geo, land } = await load();
  const ctx = canvas.getContext('2d');
  const proj = geo.geoOrthographic().clipAngle(90).precision(0.4);
  const path = geo.geoPath(proj, ctx);
  const sphere = { type: 'Sphere' };
  const grat = geo.geoGraticule10();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const routes = targets.filter((t) => t.iso !== home.iso).map((t, i) => ({
    ...t, line: { type: 'LineString', coordinates: [[home.lon, home.lat], [t.lon, t.lat]] },
    at: geo.geoInterpolate([home.lon, home.lat], [t.lon, t.lat]), offset: (i * 0.37) % 1,
  }));
  const maxC = Math.max(1, ...targets.map((t) => t.contacts));
  let colors = palette(canvas);
  let rot = saved ? [...saved] : [-home.lon + 25, -18];
  let goal = null;
  let size = 0;
  let raf = 0;
  let last = performance.now();
  let dragging = null;
  let idleUntil = 0;
  let visible = true;

  const resize = () => {
    const w = canvas.parentElement.clientWidth;
    size = Math.min(w, 380);
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    proj.translate([size / 2, size / 2]).scale(size / 2 - 6);
  };

  const dot = (lon, lat, r, fill, alpha = 1) => {
    const c = proj.rotate();
    if (geo.geoDistance([lon, lat], [-c[0], -c[1]]) > Math.PI / 2 - 0.02) return;
    const [x, y] = proj([lon, lat]);
    ctx.globalAlpha = alpha; ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  };

  const frame = (now) => {
    const dt = Math.min(64, now - last); last = now;
    if (goal) {
      rot = [rot[0] + (goal[0] - rot[0]) * 0.08, rot[1] + (goal[1] - rot[1]) * 0.08];
      if (Math.abs(goal[0] - rot[0]) < 0.1 && Math.abs(goal[1] - rot[1]) < 0.1) goal = null;
    } else if (!dragging && now > idleUntil) rot[0] += dt * (reduce ? 0.0025 : 0.006); // slower, not stopped, with reduced motion
    proj.rotate(rot);
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath(); path(sphere); ctx.fillStyle = colors.ocean; ctx.fill();
    ctx.beginPath(); path(grat); ctx.strokeStyle = colors.line; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); path(land); ctx.globalAlpha = 0.13; ctx.fillStyle = colors.text; ctx.fill();
    ctx.globalAlpha = 0.28; ctx.strokeStyle = colors.text; ctx.lineWidth = 0.5; ctx.stroke(); ctx.globalAlpha = 1;

    for (const r of routes) {
      ctx.beginPath(); path(r.line);
      ctx.globalAlpha = 0.45; ctx.strokeStyle = colors.accent; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      if (!reduce) {
        const t = ((now / 2600) + r.offset) % 1;
        const [lon, lat] = r.at(t);
        dot(lon, lat, 2.25, colors.accent, Math.sin(t * Math.PI));
      }
    }
    for (const t of targets) {
      if (t.iso === home.iso) continue;
      dot(t.lon, t.lat, 2 + 4 * Math.sqrt(t.contacts / maxC), colors.text, 0.75);
    }
    const pulse = reduce ? 0 : (now % 2000) / 2000;
    dot(home.lon, home.lat, 4 + pulse * 10, colors.accent, 0.35 * (1 - pulse));
    dot(home.lon, home.lat, 4, colors.accent);

    ctx.beginPath(); path(sphere); ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.stroke();
    raf = visible ? requestAnimationFrame(frame) : 0;
  };

  // Drag to rotate
  const down = (e) => { dragging = { x: e.clientX, y: e.clientY, rot: [...rot] }; goal = null; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing'); };
  const move = (e) => {
    if (!dragging) return;
    const k = 180 / size;
    rot = [dragging.rot[0] + (e.clientX - dragging.x) * k, Math.max(-60, Math.min(60, dragging.rot[1] - (e.clientY - dragging.y) * k))];
  };
  const up = () => { dragging = null; idleUntil = performance.now() + 2500; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const start = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; start(); });
  io.observe(canvas);
  const onVis = () => { visible = !document.hidden; start(); };
  document.addEventListener('visibilitychange', onVis);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { colors = palette(canvas); };
  scheme.addEventListener('change', onScheme);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();
  start();

  return {
    focus(lon, lat) {
      // Take the short way round
      let target = -lon;
      while (target - rot[0] > 180) target -= 360;
      while (target - rot[0] < -180) target += 360;
      goal = [target, Math.max(-50, Math.min(50, -lat))];
      idleUntil = performance.now() + 4000;
    },
    destroy() {
      saved = [...rot];
      cancelAnimationFrame(raf); raf = 0; visible = false;
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      scheme.removeEventListener('change', onScheme);
    },
  };
}
