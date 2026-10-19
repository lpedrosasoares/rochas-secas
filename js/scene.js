'use strict';

// ---------------------------------------------------------------------------
// Cena do topo: boulder com escalador animado (cinemática inversa simples)
// ---------------------------------------------------------------------------
const Scene = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Medidas do boneco
  const ARM = [17, 16];
  const LEG = [20, 20];
  const TORSO = 26;

  // Via "Búfalo" (interpretação): saída sentada sob o teto, travessia no negativo,
  // calcanhar perto do lábio, virada do lábio e saída pela corcova.
  // Coordenadas do viewBox 600x300; todas as poses têm corpo explícito (S = ombros, H = quadril).
  const P = (x, y) => ({ x, y });
  const pose = (LH, RH, LF, RF, S, H, extra = {}) => ({ LH, RH, LF, RF, S, H, ...extra });
  const ROUTE = [
    pose(P(300, 253), P(316, 266), P(326, 278), P(331, 284), P(291, 259), P(301, 283)), // sentado
    pose(P(300, 253), P(274, 233), P(326, 278), P(331, 284), P(278, 261), P(296, 285)),
    pose(P(300, 253), P(274, 233), P(300, 256), P(314, 268), P(264, 265), P(288, 271)), // pés no teto
    pose(P(248, 219), P(274, 233), P(300, 256), P(314, 268), P(252, 257), P(277, 263)),
    pose(P(248, 219), P(274, 233), P(292, 252), P(232, 210), P(238, 251), P(260, 241), { heel: true }), // calcanhar!
    pose(P(248, 219), P(207, 199), P(292, 252), P(232, 210), P(224, 239), P(248, 235), { heel: true }),
    pose(P(204, 181), P(207, 199), P(250, 246), P(226, 206), P(220, 214), P(240, 226)), // vira o lábio
    pose(P(230, 153), P(206, 172), P(208, 197), P(222, 204), P(220, 184), P(226, 209)),
    pose(P(266, 125), P(252, 133), P(218, 172), P(230, 160), P(246, 141), P(236, 164)), // mantle
  ];
  // agarras desenhadas na pedra (mãos e pés que tocam a rocha)
  const HOLDS = [P(300, 253), P(316, 266), P(326, 278), P(274, 233), P(300, 256), P(314, 268), P(248, 219),
    P(232, 210), P(207, 199), P(204, 181), P(230, 153), P(206, 172), P(208, 197), P(266, 125)];
  const START = ROUTE[0];
  const STAND = pose(P(318, 16), P(350, 14), P(324, 108), P(344, 107), P(334, 45), P(334, 71));
  const LAND = pose(P(142, 258), P(178, 258), P(146, 281), P(174, 281), P(160, 240), P(160, 264));
  const SIT = pose(P(143, 266), P(177, 266), P(138, 283), P(182, 283), P(160, 248), P(160, 274));
  const HOLD_COLORS = ['#f5c400', '#1fb5a8', '#e2457a', '#8b7cf0'];

  let svg, climber, ticks, puffs, parts = {};
  let timeline = [];
  let seg = 0;
  let segStart = 0;
  let raf = 0;
  let mode = 'dry';

  // ---- matemática ----
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpP = (a, b, t) => P(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
  const mid = (a, b) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function norm(v) { const d = Math.hypot(v.x, v.y) || 1; return P(v.x / d, v.y / d); }

  // Corpo calculado a partir das mãos e pés (ou explícito na pose)
  function bodyOf(p) {
    if (p.S && p.H) return { S: p.S, H: p.H };
    const sd = P(mid(p.LH, p.RH).x, mid(p.LH, p.RH).y + 24);
    const hd = P(mid(p.LF, p.RF).x, mid(p.LF, p.RF).y - 30);
    const c = mid(sd, hd);
    // tronco tende à vertical (corpo colado na parede), só inclina um pouco
    const raw = norm(P(sd.x - hd.x, sd.y - hd.y));
    const u = norm(P(raw.x * 0.35, raw.y * 0.35 - 0.65));
    return { S: P(c.x + u.x * TORSO / 2, c.y + u.y * TORSO / 2), H: P(c.x - u.x * TORSO / 2, c.y - u.y * TORSO / 2) };
  }

  // IK de dois segmentos; s = lado para onde dobra
  function ik(root, target, [a, b], s) {
    const dx = target.x - root.x;
    const dy = target.y - root.y;
    const d = Math.min(Math.hypot(dx, dy), a + b - 0.01);
    const th = Math.atan2(dy, dx);
    const al = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d || 1))));
    const j = P(root.x + a * Math.cos(th + s * al), root.y + a * Math.sin(th + s * al));
    const end = P(root.x + d * Math.cos(th), root.y + d * Math.sin(th));
    return [root, j, end];
  }

  // ---- desenho ----
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function draw(p) {
    const { S, H } = bodyOf(p);
    const u = norm(P(S.x - H.x, S.y - H.y));
    const n = P(-u.y, u.x);
    const ls = P(S.x + n.x * 3.5, S.y + n.y * 3.5);
    const rs = P(S.x - n.x * 3.5, S.y - n.y * 3.5);
    const lh = P(H.x + n.x * 2.5, H.y + n.y * 2.5);
    const rh = P(H.x - n.x * 2.5, H.y - n.y * 2.5);
    // quando de pé, o "lado esquerdo" é o de menor x
    const [L1, R1] = ls.x <= rs.x ? [ls, rs] : [rs, ls];
    const [L2, R2] = lh.x <= rh.x ? [lh, rh] : [rh, lh];
    const pts = (arr) => arr.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    parts.la.setAttribute('points', pts(ik(L1, p.LH, ARM, -1)));
    parts.ra.setAttribute('points', pts(ik(R1, p.RH, ARM, 1)));
    parts.ll.setAttribute('points', pts(ik(L2, p.LF, LEG, 1)));
    parts.rl.setAttribute('points', pts(ik(R2, p.RF, LEG, -1)));
    parts.torso.setAttribute('x1', H.x); parts.torso.setAttribute('y1', H.y);
    parts.torso.setAttribute('x2', S.x); parts.torso.setAttribute('y2', S.y);
    parts.shorts.setAttribute('x1', H.x); parts.shorts.setAttribute('y1', H.y);
    parts.shorts.setAttribute('x2', H.x + u.x * 4); parts.shorts.setAttribute('y2', H.y + u.y * 4);
    parts.head.setAttribute('cx', S.x + u.x * 11); parts.head.setAttribute('cy', S.y + u.y * 11);
    parts.beanie.setAttribute('cx', S.x + u.x * 14.5); parts.beanie.setAttribute('cy', S.y + u.y * 14.5);
    parts.bag.setAttribute('cx', H.x + n.x * 1); parts.bag.setAttribute('cy', H.y + 4);
    const cp = (q, k, w) => `${(q.x + n.x * w + u.x * k).toFixed(1)},${(q.y + n.y * w + u.y * k).toFixed(1)}`;
    parts.coat.setAttribute('points', [cp(S, 2, 8), cp(S, 2, -8), cp(H, -9, -12), cp(H, -9, 12)].join(' '));
    parts.hood.setAttribute('cx', S.x + u.x * 11.5); parts.hood.setAttribute('cy', S.y + u.y * 11.5);
    parts.cookie.setAttribute('transform', `translate(${p.RH.x.toFixed(1)} ${(p.RH.y - 3).toFixed(1)})`);
  }

  function buildClimber(g) {
    const limb = { fill: 'none', stroke: '#17140f', 'stroke-width': 4.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    parts.ll = el('polyline', { ...limb, stroke: '#155e75', 'stroke-width': 5.8 }, g);
    parts.rl = el('polyline', { ...limb, stroke: '#155e75', 'stroke-width': 5.8 }, g);
    parts.bag = el('circle', { r: 4.2, fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.shorts = el('line', { stroke: '#155e75', 'stroke-width': 13.5, 'stroke-linecap': 'round' }, g);
    parts.torso = el('line', { stroke: '#e2457a', 'stroke-width': 13, 'stroke-linecap': 'round' }, g);
    parts.coat = el('polygon', { class: 'coat', fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, g);
    parts.la = el('polyline', { ...limb, stroke: '#c98d55', class: 'arm' }, g);
    parts.hood = el('circle', { class: 'hood', r: 10.5, fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.head = el('circle', { r: 7.4, fill: '#c98d55', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.beanie = el('circle', { r: 5.2, fill: '#17140f' }, g);
    parts.ra = el('polyline', { ...limb, stroke: '#c98d55', class: 'arm' }, g);
    // biscoito com gotas de chocolate; as mordidas são recortes de uma máscara
    const defs = svg.querySelector('defs');
    const mask = el('mask', { id: 'cookie-bites' }, defs);
    el('rect', { x: -10, y: -10, width: 20, height: 20, fill: '#fff' }, mask);
    parts.bites = [P(-4.5, -4), P(-6, 1), P(-2, -6.5)].map((b) => el('circle', { cx: b.x, cy: b.y, r: 3.2, fill: '#000', opacity: 0 }, mask));
    parts.cookie = el('g', { class: 'cookie' }, g);
    const ck = el('g', { mask: 'url(#cookie-bites)' }, parts.cookie);
    el('circle', { r: 6, fill: '#d39b5f', stroke: '#6e4220', 'stroke-width': 1 }, ck);
    [[-2, -1.5], [2, 1.5], [1.5, -2.5], [-1.5, 2.5]].forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 1, fill: '#3b2412' }, ck));
  }

  // ---- magnésio ----
  function chalkTick(q) {
    el('ellipse', { cx: q.x + (Math.random() * 4 - 2), cy: q.y + 1, rx: 6, ry: 3.4, class: 'tick' }, ticks);
  }
  function chalkPuff(q, n = 4) {
    for (let i = 0; i < n; i++) {
      const c = el('circle', {
        cx: q.x, cy: q.y, r: 2.5 + Math.random() * 3, class: 'scene-puff',
        style: `--dx:${(Math.random() * 24 - 12).toFixed(1)}px;--dy:${(-6 - Math.random() * 16).toFixed(1)}px;animation-delay:${(i * 40)}ms`,
      }, puffs);
      c.addEventListener('animationend', () => c.remove());
    }
  }

  // ---- linha do tempo ----
  function buildTimeline() {
    const limbs = ['LH', 'RH', 'LF', 'RF'];
    const t = [];
    t.push({ to: START, dur: 600, fade: 'in', reset: true });
    t.push({ to: START, dur: 600 });
    for (let i = 1; i < ROUTE.length; i++) {
      const prev = ROUTE[i - 1];
      const next = ROUTE[i];
      const moved = limbs.filter((k) => prev[k].x !== next[k].x || prev[k].y !== next[k].y);
      t.push({ to: next, dur: next.heel ? 820 : 680, moved });
      t.push({ to: next, dur: next.heel ? 520 : 260 });
    }
    t.push({ to: STAND, dur: 1300 });
    t.push({ to: STAND, dur: 1200, cheer: true });
    t.push({ to: LAND, dur: 900, arc: 60 });
    t.push({ to: LAND, dur: 900 });
    t.push({ to: LAND, dur: 400, fade: 'out' });
    return t;
  }

  function resetWall() {
    ticks.textContent = '';
  }

  function frame(now) {
    const s = timeline[seg];
    if (!segStart) segStart = now;
    const k = Math.min(1, (now - segStart) / s.dur);
    const from = s.from;
    const e = ease(k);
    const p = {};
    for (const key of ['LH', 'RH', 'LF', 'RF']) {
      let q = lerpP(from[key], s.to[key], e);
      if (s.moved && s.moved.includes(key)) q = P(q.x, q.y - 7 * Math.sin(Math.PI * k));
      p[key] = q;
    }
    const b0 = bodyOf(from);
    const b1 = bodyOf(s.to);
    p.S = lerpP(b0.S, b1.S, e);
    p.H = lerpP(b0.H, b1.H, e);
    if (s.arc) {
      const dy = -s.arc * Math.sin(Math.PI * k);
      for (const key of ['LH', 'RH', 'LF', 'RF', 'S', 'H']) p[key] = P(p[key].x, p[key].y + dy);
    }
    if (s.cheer) {
      const w = Math.sin(k * Math.PI * 6) * 4;
      p.LH = P(p.LH.x - w, p.LH.y); p.RH = P(p.RH.x + w, p.RH.y);
    }
    if (s.fade === 'in') climber.style.opacity = k;
    if (s.fade === 'out') climber.style.opacity = 1 - k;
    draw(p);

    if (k >= 1) {
      if (s.arc) chalkPuff(P(160, 278), 9); // poeira ao cair no crash pad
      if (s.moved) for (const key of s.moved) if (key === 'LH' || key === 'RH') { chalkTick(s.to[key]); chalkPuff(s.to[key], 3); }
      seg = (seg + 1) % timeline.length;
      segStart = now;
      const nx = timeline[seg];
      nx.from = { ...s.to };
      if (nx.reset) { resetWall(); nx.from = { ...START }; }
    }
    raf = requestAnimationFrame(frame);
  }

  function startClimb() {
    cancelAnimationFrame(raf);
    timeline = buildTimeline();
    seg = 0;
    segStart = 0;
    timeline[0].from = { ...START };
    resetWall();
    raf = requestAnimationFrame(frame);
  }

  // Sentado no crash pad, de capa, comendo biscoito enquanto a chuva passa
  const MOUTH = P(166, 238);
  let bites = 0;
  let lastPhase = 0;
  function crumbs(q, n = 4) {
    for (let i = 0; i < n; i++) {
      const c = el('circle', {
        cx: q.x + (Math.random() * 6 - 3), cy: q.y, r: 0.9 + Math.random() * 0.8, class: 'crumb',
        style: `--dx:${(Math.random() * 10 - 5).toFixed(1)}px;animation-delay:${i * 60}ms`,
      }, puffs);
      c.addEventListener('animationend', () => c.remove());
    }
  }
  function setBites(n) { parts.bites.forEach((b, i) => b.setAttribute('opacity', i < n ? 1 : 0)); }
  function sitLoop(now) {
    const b = Math.sin(now / 600) * 1.2;
    const phase = (now % 2800) / 2800;
    let k = 0;
    if (phase < 0.25) k = 0;
    else if (phase < 0.42) k = ease((phase - 0.25) / 0.17);
    else if (phase < 0.6) k = 1;
    else if (phase < 0.78) k = 1 - ease((phase - 0.6) / 0.18);
    // mordida quando o biscoito chega na boca
    if (lastPhase < 0.45 && phase >= 0.45) {
      bites = (bites + 1) % 4;
      setBites(bites);
      crumbs(P(MOUTH.x, MOUTH.y + 6));
    }
    lastPhase = phase;
    const chew = phase > 0.42 && phase < 0.6 ? Math.sin(now / 60) * 0.8 : 0;
    const knee = P(SIT.RH.x, SIT.RH.y + b * 0.5);
    const p = { ...SIT, S: P(SIT.S.x, SIT.S.y + b + chew * 0.3), H: SIT.H };
    p.LH = P(SIT.LH.x, SIT.LH.y + b * 0.5);
    p.RH = lerpP(knee, MOUTH, k);
    draw(p);
    raf = requestAnimationFrame(sitLoop);
  }

  function setWeather(next) {
    const m = next === 'critical' || next === 'serious' ? 'rain' : 'dry';
    if (!svg || m === mode) return;
    mode = m;
    svg.classList.toggle('rainy', m === 'rain');
    climber.classList.toggle('rainwear', m === 'rain');
    bites = 0;
    setBites(0);
    cancelAnimationFrame(raf);
    climber.style.opacity = 1;
    if (reduceMotion) { draw(m === 'rain' ? SIT : STAND); return; }
    if (m === 'rain') { resetWall(); raf = requestAnimationFrame(sitLoop); }
    else startClimb();
  }

  function init() {
    svg = document.getElementById('scene');
    if (!svg) return;
    const holds = svg.querySelector('#route-holds');
    HOLDS.forEach((q, i) => {
      el('path', {
        d: 'M4 13c-1-4 2-8 7-9 5-1 9 2 9 6 0 3-2 5-4 7-3 3-8 4-10 2-1-1-1-4-2-6z',
        transform: `translate(${q.x - 8} ${q.y - 7}) scale(0.68) rotate(${(i * 47) % 360} 12 12)`,
        fill: HOLD_COLORS[i % HOLD_COLORS.length], stroke: 'rgba(0,0,0,.45)', 'stroke-width': 1.2,
      }, holds);
    });
    ticks = svg.querySelector('#chalk-ticks');
    puffs = svg.querySelector('#scene-puffs');
    climber = svg.querySelector('#climber');
    buildClimber(climber);

    // chuva
    const rain = svg.querySelector('#rain');
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 640;
      const y = Math.random() * 300;
      el('line', {
        x1: x, y1: y, x2: x - 4, y2: y + 12,
        style: `animation-delay:${(-Math.random()).toFixed(2)}s;animation-duration:${(0.55 + Math.random() * 0.3).toFixed(2)}s`,
      }, rain);
    }

    mode = 'dry';
    if (reduceMotion) { draw(STAND); return; }
    startClimb();
  }

  return { init, setWeather };
})();
