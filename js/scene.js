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
  const START = ROUTE[0];
  const STAND = pose(P(318, 16), P(350, 14), P(324, 108), P(344, 107), P(334, 45), P(334, 71));
  // pé no chão, parado (face: 1 = olhando para a direita, -1 = esquerda)
  const standPose = (x, face = 1) => pose(P(x - 5, 247), P(x + 6, 247), P(x - 6, 284), P(x + 7, 284), P(x + face * 1.5, 220), P(x, 246), { face });
  // caminhando: passada alternada e braços balançando
  const walkPose = (x, ph, face) => {
    const sw = Math.sin(ph);
    return pose(
      P(x - 4 - sw * 7, 248), P(x + 4 + sw * 7, 248),
      P(x + sw * 8, 284 - Math.max(0, Math.cos(ph)) * 3), P(x - sw * 8, 284 - Math.max(0, -Math.cos(ph)) * 3),
      P(x + face * 2, 220 + Math.abs(sw)), P(x, 246 + Math.abs(sw)), { face });
  };
  // descida pela rampa de trás (de frente para a pedra, que fica à esquerda)
  const DOWN = [
    pose(P(424, 92), P(440, 92), P(424, 118), P(440, 119), P(431, 54), P(432, 80)),
    pose(P(455, 128), P(462, 124), P(462, 136), P(474, 143), P(468, 98), P(476, 120), { face: -1 }),
    pose(P(470, 141), P(478, 146), P(500, 176), P(510, 190), P(500, 141), P(510, 163), { face: -1 }),
    pose(P(500, 166), P(506, 173), P(528, 206), P(535, 220), P(526, 171), P(536, 193), { face: -1 }),
    pose(P(525, 196), P(530, 206), P(548, 246), P(556, 262), P(546, 207), P(556, 229), { face: -1 }),
    standPose(575, -1),
  ];
  const MEET_CLIMBER = 230; // o escalador caminha até a spotter para o soquinho
  const SIT = pose(P(143, 266), P(177, 266), P(138, 283), P(182, 283), P(160, 248), P(160, 274));

  let svg, climber, ticks, puffs, parts = {};
  const lamps = {};
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
    const legL = ik(L2, p.LF, LEG, 1);
    const legR = ik(R2, p.RF, LEG, -1);
    parts.ll.setAttribute('points', pts(legL));
    parts.rl.setAttribute('points', pts(legR));
    shoe(parts.shoeL, legL, p.face || 1);
    shoe(parts.shoeR, legR, p.face || 1);
    parts.torso.setAttribute('x1', H.x); parts.torso.setAttribute('y1', H.y);
    parts.torso.setAttribute('x2', S.x); parts.torso.setAttribute('y2', S.y);
    parts.shorts.setAttribute('x1', H.x); parts.shorts.setAttribute('y1', H.y);
    parts.shorts.setAttribute('x2', H.x + u.x * 4); parts.shorts.setAttribute('y2', H.y + u.y * 4);
    parts.head.setAttribute('cx', S.x + u.x * 11); parts.head.setAttribute('cy', S.y + u.y * 11);
    parts.beanie.setAttribute('cx', S.x + u.x * 14.5); parts.beanie.setAttribute('cy', S.y + u.y * 14.5);
    const head = P(S.x + u.x * 11, S.y + u.y * 11);
    const hands = mid(p.LH, p.RH);
    const toHands = P(hands.x - head.x, hands.y - head.y);
    const look = Math.hypot(toHands.x, toHands.y) > 10 && toHands.y < 4 ? toHands : P(p.face || 1, 0.3);
    setLamp('climber', head, look);
    parts.bag.setAttribute('cx', H.x + n.x * 1); parts.bag.setAttribute('cy', H.y + 4);
    const cp = (q, k, w) => `${(q.x + n.x * w + u.x * k).toFixed(1)},${(q.y + n.y * w + u.y * k).toFixed(1)}`;
    parts.coat.setAttribute('points', [cp(S, 2, 8), cp(S, 2, -8), cp(H, -9, -12), cp(H, -9, 12)].join(' '));
    parts.hood.setAttribute('cx', S.x + u.x * 11.5); parts.hood.setAttribute('cy', S.y + u.y * 11.5);
    parts.fist.setAttribute('cx', p.RH.x); parts.fist.setAttribute('cy', p.RH.y);
    parts.fist.style.display = p.fist ? 'inline' : 'none';
    parts.cookie.setAttribute('transform', `translate(${p.RH.x.toFixed(1)} ${(p.RH.y - 3).toFixed(1)})`);
  }

  // sapatilha laranja com biqueira, calcanhar e sola pretos, apontando para a frente
  function shoe(sh, leg, face) {
    const knee = leg[1];
    const foot = leg[2];
    const shin = norm(P(foot.x - knee.x, foot.y - knee.y));
    let f = P(-shin.y, shin.x);
    if (Math.sign(f.x || 1) !== face) f = P(-f.x, -f.y);
    const at = (k, o = 0) => `${(foot.x + f.x * k + shin.x * o).toFixed(1)},${(foot.y + f.y * k + shin.y * o).toFixed(1)}`;
    sh.upper.setAttribute('points', `${at(-2)} ${at(7)}`);
    sh.toe.setAttribute('points', `${at(7.2)} ${at(7.8)}`);
    sh.heel.setAttribute('points', `${at(-2.8)} ${at(-2.5)}`);
    sh.sole.setAttribute('points', `${at(-4.2, 2.8)} ${at(9.4, 2.8)}`);
  }
  function buildShoe(g) {
    const line = { fill: 'none', 'stroke-linecap': 'round' };
    return {
      upper: el('polyline', { ...line, stroke: '#f26b1d', 'stroke-width': 5.6 }, g),
      toe: el('polyline', { ...line, stroke: '#17140f', 'stroke-width': 5.6 }, g),
      heel: el('polyline', { ...line, stroke: '#17140f', 'stroke-width': 5.4 }, g),
      sole: el('polyline', { ...line, stroke: '#17140f', 'stroke-width': 1.6 }, g),
    };
  }

  function buildClimber(g) {
    const limb = { fill: 'none', stroke: '#17140f', 'stroke-width': 4.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    parts.ll = el('polyline', { ...limb, stroke: '#155e75', 'stroke-width': 5.8 }, g);
    parts.rl = el('polyline', { ...limb, stroke: '#155e75', 'stroke-width': 5.8 }, g);
    parts.shoeL = buildShoe(g);
    parts.shoeR = buildShoe(g);
    parts.bag = el('circle', { r: 4.2, fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.shorts = el('line', { stroke: '#155e75', 'stroke-width': 13.5, 'stroke-linecap': 'round' }, g);
    parts.torso = el('line', { stroke: '#e2457a', 'stroke-width': 13, 'stroke-linecap': 'round' }, g);
    parts.coat = el('polygon', { class: 'coat', fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, g);
    parts.la = el('polyline', { ...limb, stroke: '#c98d55', class: 'arm' }, g);
    parts.hood = el('circle', { class: 'hood', r: 10.5, fill: '#f5c400', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.head = el('circle', { r: 7.4, fill: '#c98d55', stroke: '#17140f', 'stroke-width': 1.2 }, g);
    parts.beanie = el('circle', { r: 5.2, fill: '#17140f' }, g);
    parts.ra = el('polyline', { ...limb, stroke: '#c98d55', class: 'arm' }, g);
    parts.fist = el('circle', { r: 3.6, fill: '#c98d55', stroke: '#17140f', 'stroke-width': 1.1, style: 'display:none' }, g);
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

  // ---- quem faz a segurança (spotters) ----
  // Contorno do teto (parte de baixo do bloco), para os spotters não baterem a cabeça
  const ROOF = [P(195, 190), P(204, 198), P(222, 206), P(245, 214), P(270, 228), P(300, 250), P(318, 268), P(330, 285)];
  function roofY(x) {
    if (x <= ROOF[0].x) return -Infinity;
    for (let i = 1; i < ROOF.length; i++) {
      const a = ROOF[i - 1];
      const b = ROOF[i];
      if (x <= b.x) return lerp(a.y, b.y, (x - a.x) / (b.x - a.x));
    }
    return -Infinity; // à direita do teto: em pé na frente do bloco
  }
  // uma spotter (de rabo de cavalo), um pouco afastada, braços esticados
  const SPOTTERS = [
    { offset: -82, min: 118, max: 186, shirt: '#8b7cf0', pants: '#155e75', skin: '#c98d55', hair: '#3b2412' },
  ];

  function buildSpotters(g) {
    SPOTTERS.forEach((sp) => {
      const f = el('g', {}, g);
      const limb = { fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      sp.ll = el('polyline', { ...limb, stroke: sp.pants, 'stroke-width': 5.8 }, f);
      sp.rl = el('polyline', { ...limb, stroke: sp.pants, 'stroke-width': 5.8 }, f);
      sp.torso = el('line', { stroke: sp.shirt, 'stroke-width': 13, 'stroke-linecap': 'round' }, f);
      sp.la = el('polyline', { ...limb, stroke: sp.skin }, f);
      sp.ra = el('polyline', { ...limb, stroke: sp.skin }, f);
      sp.head = el('circle', { r: 7.4, fill: sp.skin, stroke: '#17140f', 'stroke-width': 1.2 }, f);
      sp.tail = el('path', { fill: sp.hair, stroke: '#17140f', 'stroke-width': 1 }, f);
      sp.hairEl = el('path', { fill: sp.hair, stroke: '#17140f', 'stroke-width': 1 }, f);
      sp.band = el('circle', { r: 1.8, fill: '#e2457a' }, f);
      sp.fistEl = el('circle', { r: 3.6, fill: sp.skin, stroke: '#17140f', 'stroke-width': 1.1, style: 'display:none' }, f);
      sp.x = sp.min + (sp.max - sp.min) / 2;
      sp.face = 1;
    });
  }

  // Comportamento da spotter. opts.mode: 'spot' (dando segurança), 'cheer' (comemorando),
  // 'relax' (esperando) ou 'bump' (soquinho; opts.fist = ponto, opts.reach = 0..1).
  // Tudo é suavizado (posição, postura e mãos) para os movimentos ficarem naturais.
  const STANCE = {
    spot: { crouch: 6, spread: 11, lean: 5 },
    cheer: { crouch: 0, spread: 8, lean: 1 },
    relax: { crouch: 0, spread: 7, lean: 1 },
    bump: { crouch: 1, spread: 8, lean: 3 },
  };
  const approach = (cur, want, k) => cur + (want - cur) * k;
  function updateSpotters(target, now, opts = {}) {
    const pts = (arr) => arr.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    const mode = opts.mode || 'spot';
    SPOTTERS.forEach((sp, i) => {
      // deslocamento com aceleração e freio
      const want = mode === 'spot' ? Math.max(sp.min, Math.min(sp.max, target.x + sp.offset)) : sp.x;
      sp.v = (sp.v || 0) * 0.86 + (want - sp.x) * 0.012;
      sp.v = Math.max(-1.3, Math.min(1.3, sp.v));
      sp.x += sp.v;
      const walking = Math.abs(sp.v) > 0.12;
      if (walking) sp.phase = (sp.phase || 0) + Math.abs(sp.v) * 0.34;
      const sw = walking ? Math.sin(sp.phase) : 0;

      // postura (suavizada)
      const st = STANCE[mode];
      for (const k of ['crouch', 'spread', 'lean']) sp[k] = approach(sp[k] ?? st[k], st[k], 0.07);
      const sway = mode === 'relax' ? Math.sin(now / 900 + i) * 1.6 : Math.sin(now / 1400 + i) * 0.6;
      const hop = mode === 'cheer' ? Math.abs(Math.sin(now / 170)) * 5 : 0;
      const roof = Math.max(245, Math.min(272, roofY(sp.x + 6) + 54));
      const H = P(sp.x + sway, roof + sp.crouch + Math.abs(sw) - hop);
      const S = P(H.x + sp.lean, H.y - 26 + sp.crouch * 0.3);
      const LF = P(sp.x - sp.spread * 0.6 + sw * 8, 283 - hop - (walking ? Math.max(0, Math.cos(sp.phase)) * 3 : 0));
      const RF = P(sp.x + sp.spread + 2 - sw * 8, 283 - hop - (walking ? Math.max(0, -Math.cos(sp.phase)) * 3 : 0));

      // mãos-alvo conforme o modo
      let LH;
      let RH;
      if (mode === 'cheer') {
        const w = Math.sin(now / 120 + i) * 5;
        LH = P(S.x - 8 + w, S.y - 30);
        RH = P(S.x + 10 - w, S.y - 31);
      } else if (mode === 'bump') {
        LH = P(H.x - 6, H.y - 1); // mão na cintura
        RH = lerpP(P(S.x + 4, S.y + 26), opts.fist, opts.reach);
      } else if (mode === 'relax') {
        LH = P(S.x - 3, S.y + 27);
        RH = P(H.x + 7, H.y - 2); // mão na cintura
      } else {
        // braços acompanhando o quadril do escalador, levemente dobrados, mãos abertas
        const raw = norm(P(target.x - S.x, target.y - S.y));
        const d = norm(P(raw.x, Math.min(raw.y, -0.2)));
        sp.dir = sp.dir ? norm(lerpP(sp.dir, d, 0.08)) : d;
        const reach = 29 + Math.sin(now / 700 + i) * 1.2;
        const nx = P(-sp.dir.y, sp.dir.x);
        LH = P(S.x + sp.dir.x * reach - nx.x * 3.5, S.y + sp.dir.y * reach - nx.y * 3.5);
        RH = P(S.x + sp.dir.x * (reach - 2) + nx.x * 3.5, S.y + sp.dir.y * (reach - 2) + nx.y * 3.5);
      }
      const hk = mode === 'bump' ? 0.5 : 0.15;
      sp.LHs = sp.LHs ? lerpP(sp.LHs, LH, hk) : LH;
      sp.RHs = sp.RHs ? lerpP(sp.RHs, RH, hk) : RH;

      sp.ll.setAttribute('points', pts(ik(P(H.x - 2, H.y), LF, LEG, 1)));
      sp.rl.setAttribute('points', pts(ik(P(H.x + 2, H.y), RF, LEG, -1)));
      sp.torso.setAttribute('x1', H.x); sp.torso.setAttribute('y1', H.y);
      sp.torso.setAttribute('x2', S.x); sp.torso.setAttribute('y2', S.y);
      sp.la.setAttribute('points', pts(ik(P(S.x - 2, S.y), sp.LHs, ARM, 1)));
      sp.ra.setAttribute('points', pts(ik(P(S.x + 2, S.y), sp.RHs, ARM, 1)));
      // cabeça olha para o escalador
      const look = mode === 'spot' && sp.dir ? sp.dir : P(1, -0.1);
      const hx = S.x + 1 + look.x * 1.5;
      const hyy = S.y - 11 + look.y * 1.2;
      sp.head.setAttribute('cx', hx); sp.head.setAttribute('cy', hyy);
      setLamp(`spotter${i}`, P(hx, hyy), mode === 'spot' ? look : mode === 'cheer' ? P(0.6, -1) : P(1, 0.15), 110);
      sp.hairEl.setAttribute('d', `M${hx - 7.8} ${hyy + 1} A 7.8 7.8 0 0 1 ${hx + 7.8} ${hyy - 1} L ${hx + 3} ${hyy - 2} Z`);
      const tw = Math.sin(now / (walking || hop ? 140 : 300) + i) * 3;
      const bx = hx - 7;
      const by = hyy - 3;
      sp.tail.setAttribute('d', `M${bx} ${by} C ${bx - 8} ${by + 1}, ${bx - 10 + tw} ${by + 9}, ${bx - 6 + tw} ${by + 16} C ${bx - 3} ${by + 9}, ${bx - 1} ${by + 4}, ${bx + 1} ${by + 2} Z`);
      sp.band.setAttribute('cx', bx - 0.5); sp.band.setAttribute('cy', by + 0.5);
      sp.fistEl.style.display = mode === 'bump' && opts.reach > 0.05 ? 'inline' : 'none';
      sp.fistEl.setAttribute('cx', sp.RHs.x); sp.fistEl.setAttribute('cy', sp.RHs.y);
      sp.shoulder = S;
    });
  }

  // cachorro comemora com uma cambalhota
  function dogFlip() {
    const d = svg.querySelector('.dog-flip');
    if (!d || reduceMotion) return;
    d.classList.remove('flip');
    void d.getBoundingClientRect();
    d.classList.add('flip');
    setTimeout(() => chalkPuff(P(84, 282), 5), 950);
  }

  // ---- headlamp (só aparece à noite) ----
  function buildLamp(name) {
    const defs = svg.querySelector('defs');
    const grad = el('radialGradient', { id: `beam-${name}`, gradientUnits: 'userSpaceOnUse' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff6c8', 'stop-opacity': '0.8' }, grad);
    el('stop', { offset: '0.55', 'stop-color': '#ffe9a8', 'stop-opacity': '0.28' }, grad);
    el('stop', { offset: '1', 'stop-color': '#ffe9a8', 'stop-opacity': '0' }, grad);
    const g = el('g', { class: `lampset ${name.startsWith('spotter') ? 'lampset-spotter' : 'lampset-climber'}` }, svg.querySelector('#beams'));
    lamps[name] = {
      grad,
      beam: el('polygon', { class: 'beam', fill: `url(#beam-${name})` }, g),
      strap: el('path', { class: 'lamp-strap' }, g),
      dot: el('circle', { class: 'lamp', r: 2.4 }, g),
    };
  }
  // head = centro da cabeça; dir = para onde a pessoa olha
  function setLamp(name, head, dir, len = 120, half = 0.26) {
    const L = lamps[name];
    if (!L) return;
    const d = norm(dir);
    const o = P(head.x + d.x * 6.5, head.y + d.y * 6.5 - 1.5);
    const rot = (a) => P(d.x * Math.cos(a) - d.y * Math.sin(a), d.x * Math.sin(a) + d.y * Math.cos(a));
    const a = rot(half);
    const b = rot(-half);
    L.beam.setAttribute('points', `${o.x.toFixed(1)},${o.y.toFixed(1)} ${(o.x + a.x * len).toFixed(1)},${(o.y + a.y * len).toFixed(1)} ${(o.x + b.x * len).toFixed(1)},${(o.y + b.y * len).toFixed(1)}`);
    L.grad.setAttribute('cx', o.x); L.grad.setAttribute('cy', o.y); L.grad.setAttribute('r', len);
    L.dot.setAttribute('cx', o.x.toFixed(1)); L.dot.setAttribute('cy', o.y.toFixed(1));
    // elástico da lanterna em volta da cabeça
    const n = P(-d.y, d.x);
    L.strap.setAttribute('d', `M${(head.x + n.x * 7.2 - d.x).toFixed(1)} ${(head.y + n.y * 7.2 - d.y - 1.5).toFixed(1)} Q ${(head.x + d.x * 8).toFixed(1)} ${(head.y + d.y * 8 - 1.5).toFixed(1)} ${(head.x - n.x * 7.2 - d.x).toFixed(1)} ${(head.y - n.y * 7.2 - d.y - 1.5).toFixed(1)}`);
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
    t.push({ to: STAND, dur: 1300, spot: 'cheerSoon' });
    t.push({ to: STAND, dur: 1600, cheer: true });
    // desce pela rampa de trás (a spotter já vai caminhando encontrar)
    DOWN.forEach((d, i) => t.push({ to: d, dur: i === 0 ? 1000 : 760, spot: 'relax', moved: i > 0 && i < DOWN.length - 1 ? ['LH', 'RH', 'LF', 'RF'] : null, noTick: true }));
    const walkDur = 3800;
    t.push({ to: standPose(MEET_CLIMBER, -1), dur: walkDur, spot: 'relax', walk: [575, MEET_CLIMBER] });
    t.push({ to: standPose(MEET_CLIMBER, -1), dur: 1500, spot: 'bump', bump: true });
    t.push({ to: standPose(MEET_CLIMBER, -1), dur: 500, spot: 'relax' });
    t.push({ to: standPose(MEET_CLIMBER, -1), dur: 500, spot: 'relax', fade: 'out' });
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
    p.face = s.to.face || 1;
    let fist = null;
    let reach = 0;
    if (s.walk) {
      const x = lerp(s.walk[0], s.walk[1], k);
      Object.assign(p, walkPose(x, (s.walk[0] - x) / 18 * Math.PI, -1));
      if (k > 0.92) Object.assign(p, standPose(x, -1));
    }
    if (s.bump) {
      // estende o braço, encosta (com nuvem de magnésio) e recolhe
      reach = k < 0.35 ? ease(k / 0.35) : k < 0.62 ? 1 : 1 - ease((k - 0.62) / 0.38);
      const sp = SPOTTERS[0].shoulder || P(MEET_CLIMBER - 40, 220);
      fist = P((sp.x + p.S.x) / 2, 233);
      p.RH = lerpP(P(MEET_CLIMBER - 6, 247), fist, reach);
      p.fist = reach > 0.05;
      if (!s.bumped && k >= 0.35) { s.bumped = true; chalkPuff(fist, 7); }
    }
    if (s.cheer) {
      const w = Math.sin(k * Math.PI * 6) * 4;
      p.LH = P(p.LH.x - w, p.LH.y); p.RH = P(p.RH.x + w, p.RH.y);
    }
    if (s.fade === 'in') climber.style.opacity = k;
    if (s.fade === 'out') climber.style.opacity = 1 - k;
    draw(p);
    let spotMode = s.spot || 'spot';
    if (s.cheer || (spotMode === 'cheerSoon' && k > 0.7)) spotMode = 'cheer';
    else if (spotMode === 'cheerSoon') spotMode = 'spot';
    updateSpotters(p.H, now, { mode: spotMode, fist, reach });

    if (k >= 1) {
      s.bumped = false;
      if (s.moved && !s.noTick) for (const key of s.moved) if (key === 'LH' || key === 'RH') { chalkTick(s.to[key]); chalkPuff(s.to[key], 3); }
      seg = (seg + 1) % timeline.length;
      segStart = now;
      const nx = timeline[seg];
      nx.from = { ...s.to };
      if (nx.cheer) dogFlip();
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
    ticks = svg.querySelector('#chalk-ticks');
    puffs = svg.querySelector('#scene-puffs');
    climber = svg.querySelector('#climber');
    buildSpotters(svg.querySelector('#spotters'));
    buildClimber(climber);
    buildLamp('climber');
    SPOTTERS.forEach((_, i) => buildLamp(`spotter${i}`));

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

  function setNight(on) { if (svg) svg.classList.toggle('night', !!on); }

  return { init, setWeather, setNight };
})();
