'use strict';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const TZ = 'America/Sao_Paulo';
const FORECAST_DAYS = 4;

const SITES = [
  {
    id: 'iperocks',
    name: 'Iperocks',
    rock: 'Boulder',
    lat: -23.41943,
    lon: -47.6631,
    color: '--series-1',
    link: null,
  },
  {
    id: 'flona',
    name: 'Flona de Ipanema',
    rock: 'Vias',
    lat: -23.4508,
    lon: -47.6174,
    color: '--series-2',
    link: null,
  },
];

const STATUS = {
  good: { label: 'Bora', icon: '', cls: 's-good', color: '--good', head: 'Rocha seca.' },
  warning: { label: 'Talvez', icon: '', cls: 's-warning', color: '--warning', head: 'Pode estar úmida.' },
  serious: { label: 'Melhor não', icon: '', cls: 's-serious', color: '--serious', head: 'Ainda úmida.' },
  critical: { label: 'Não dá', icon: '', cls: 's-critical', color: '--critical', head: 'Rocha molhada.' },
};

const RAIN_HOUR = 0.2; // mm/h considerado "choveu"

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const state = {
  pastDays: 14,
  times: [],      // horas locais 'YYYY-MM-DDTHH:00'
  days: [],       // dias locais 'YYYY-MM-DD'
  hourly: {},     // id -> { precip, rh, prob }
  daily: {},      // id -> { sum, hours, prob, tmax }
  grid: {},       // id -> {lat, lon} da célula do modelo
  nowIdx: 0,
  target: null,   // índice em times
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function spNowKey() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}
function weekday(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); }
function fmtDay(day, withWd = true) {
  const [, m, d] = day.split('-');
  return (withWd ? WD[weekday(day)] + ' ' : '') + `${d}/${m}`;
}
function fmtTime(t) { return `${fmtDay(t.slice(0, 10))} ${t.slice(11, 13)}h`; }
function fmtMm(v) {
  if (v == null || isNaN(v)) return '–';
  if (v === 0) return '0';
  return v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v).toString();
}
function titleCase(t) {
  return t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/ (Da|De|Do|Das|Dos|E) /g, (w) => w.toLowerCase());
}
function fmtAgo(h) {
  if (h == null) return '–';
  if (h < 1) return 'agora';
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} dias`;
}
function sumRange(arr, a, b) {
  let s = 0;
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) s += arr[i] || 0;
  return s;
}
function niceMax(v) {
  const steps = [1, 2, 4, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];
  return steps.find((s) => s >= v) || Math.ceil(v / 50) * 50;
}
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
// Barra com topo arredondado ancorada na base
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (r <= 0.5) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
async function loadData() {
  const lat = SITES.map((s) => s.lat).join(',');
  const lon = SITES.map((s) => s.lon).join(',');
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&hourly=precipitation,relative_humidity_2m,precipitation_probability,is_day'
    + '&daily=precipitation_sum,precipitation_hours,precipitation_probability_max,temperature_2m_max'
    + `&past_days=${state.pastDays}&forecast_days=${FORECAST_DAYS}`
    + `&timezone=${encodeURIComponent(TZ)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  let json = await res.json();
  if (!Array.isArray(json)) json = [json];

  state.times = json[0].hourly.time;
  state.days = json[0].daily.time;
  SITES.forEach((s, i) => {
    const d = json[i];
    state.hourly[s.id] = {
      precip: d.hourly.precipitation,
      rh: d.hourly.relative_humidity_2m,
      prob: d.hourly.precipitation_probability,
      isDay: d.hourly.is_day,
    };
    state.daily[s.id] = {
      sum: d.daily.precipitation_sum,
      hours: d.daily.precipitation_hours,
      prob: d.daily.precipitation_probability_max,
      tmax: d.daily.temperature_2m_max,
    };
    state.grid[s.id] = { lat: d.latitude, lon: d.longitude };
  });

  const key = spNowKey();
  let idx = state.times.indexOf(key);
  if (idx < 0) idx = state.times.filter((t) => t <= key).length - 1;
  state.nowIdx = Math.max(0, idx);
  if (state.target == null || state.target >= state.times.length) state.target = state.nowIdx;
}

// ---------------------------------------------------------------------------
// Pluviômetros do CEMADEN: chuva medida hora a hora (o serviço libera CORS)
// ---------------------------------------------------------------------------
const CEMADEN = 'https://mapservices.cemaden.gov.br/MapaInterativoWS/resources/horario';
// estações da região (Iperó, Capela do Alto, Boituva, Araçoiaba, Sorocaba, Votorantim)
const STATION_IDS = [8140, 8128, 8124, 8122, 7085, 7086, 4407, 3017];
const GAUGE_MAX_KM = 15;   // mais longe que isso não representa o setor
const GAUGE_FRESH_H = 6;   // estação sem dado há mais tempo é considerada parada
state.stations = [];
state.gauge = {};

function distKm(a, b) {
  const R = 6371;
  const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// horários do CEMADEN vêm em UTC; o Brasil está em UTC-3 (sem horário de verão)
function cemadenKey(date, hourLabel) {
  const [d, m, y] = date.split('/').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, parseInt(hourLabel, 10)) - 3 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:00`;
}

async function loadGauges() {
  const hours = Math.min(720, state.nowIdx + 2);
  const results = await Promise.allSettled(STATION_IDS.map(async (id) => {
    const r = await fetch(`${CEMADEN}/${id}/${hours}`);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const byKey = {};
    (j.datas || []).forEach((date, i) => {
      (j.acumulados[i] || []).forEach((v, k) => { if (v != null) byKey[cemadenKey(date, j.horarios[k])] = v; });
    });
    const keys = Object.keys(byKey).sort();
    const e = j.estacao;
    return {
      id, name: e.nome, city: e.idMunicipio.cidade, lat: e.latitude, lon: e.longitude,
      enabled: e.status === 'ENABLED', last: keys[keys.length - 1] || null, byKey,
    };
  }));
  state.stations = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// Estação "travada": mede quase nada enquanto o modelo estima muita chuva no mesmo período
function gaugeSuspect(st, model) {
  let meas = 0;
  let mod = 0;
  let n = 0;
  for (let i = 0; i <= state.nowIdx; i++) {
    const v = st.byKey[state.times[i]];
    if (v == null) continue;
    meas += v; mod += model[i] || 0; n++;
  }
  st.suspect = n < state.nowIdx * 0.5 || (mod > 20 && meas < mod * 0.1);
  return st.suspect;
}

// Usa a chuva medida no passado (estação ativa mais próxima) e o modelo no futuro
function mergeGauges() {
  const now = state.times[state.nowIdx];
  const hoursSince = (k) => (Date.parse(now + ':00Z') - Date.parse(k + ':00Z')) / 3600e3;
  for (const s of SITES) {
    const h = state.hourly[s.id];
    h.model = h.model || h.precip.slice();
    h.precip = h.model.slice();
    const near = state.stations
      .filter((st) => st.enabled && st.last && hoursSince(st.last) <= GAUGE_FRESH_H && !gaugeSuspect(st, h.model))
      .map((st) => ({ st, km: distKm(s, st) }))
      .filter((x) => x.km <= GAUGE_MAX_KM)
      .sort((a, b) => a.km - b.km)[0];
    state.gauge[s.id] = near || null;
    if (!near) continue;
    const measured = state.times.map((t, i) => (i <= state.nowIdx ? near.st.byKey[t] ?? null : null));
    h.measured = measured;
    measured.forEach((v, i) => { if (v != null) h.precip[i] = v; });
    // refaz os totais diários com a série combinada
    const d = state.daily[s.id];
    state.days.forEach((day, k) => {
      let sum = 0;
      let n = 0;
      state.times.forEach((t, i) => { if (t.startsWith(day)) { sum += h.precip[i] || 0; if ((h.precip[i] || 0) >= 0.1) n++; } });
      d.sum[k] = Math.round(sum * 10) / 10;
      d.hours[k] = n;
    });
  }
}

// ---------------------------------------------------------------------------
// Veredito
// ---------------------------------------------------------------------------
// opts.precip: série de chuva alternativa; opts.noForecast: ignora a previsão (só o medido)
function evaluate(siteId, idx, opts = {}) {
  const h = state.hourly[siteId];
  const p = opts.precip || h.precip;
  const r24 = sumRange(p, idx - 23, idx);
  const r48 = sumRange(p, idx - 47, idx - 24);
  const r72 = sumRange(p, idx - 71, idx - 48);
  const total72 = r24 + r48 + r72;
  const next6 = opts.noForecast ? 0 : sumRange(p, idx + 1, idx + 6);
  const prob6 = opts.noForecast ? 0 : Math.max(0, ...(h.prob || []).slice(idx + 1, idx + 7).filter((v) => v != null));
  const rhs = h.rh.slice(Math.max(0, idx - 11), idx + 1).filter((v) => v != null);
  const rh12 = rhs.length ? rhs.reduce((a, b) => a + b, 0) / rhs.length : null;

  let last = null;
  for (let i = idx; i >= 0; i--) if ((p[i] || 0) >= RAIN_HOUR) { last = idx - i; break; }

  const reasons = [];
  let status = 'good';
  const bump = (s) => {
    const order = ['good', 'warning', 'serious', 'critical'];
    if (order.indexOf(s) > order.indexOf(status)) status = s;
  };

  if (r24 > 2) { bump('critical'); reasons.push(`Choveu ${fmtMm(r24)} mm hoje.`); }
  else if (r24 >= 0.5) { bump('serious'); reasons.push('Garoou hoje.'); }
  if (next6 >= 1) { bump('critical'); reasons.push('Vai chover.'); }
  else if (prob6 >= 60 && idx >= state.nowIdx) { bump('warning'); reasons.push(`${prob6}% de chance de chuva.`); }
  if (r48 > 5) { bump('serious'); reasons.push(`Choveu ${fmtMm(r48)} mm ontem.`); }
  if (total72 > 20) { bump('serious'); reasons.push(`Choveu ${fmtMm(total72)} mm em 3 dias.`); }
  else if (total72 > 5) { bump('warning'); reasons.push(`Choveu ${fmtMm(total72)} mm em 3 dias.`); }
  if (rh12 != null && rh12 > 90) { bump('warning'); reasons.push('Ar úmido.'); }
  if (!reasons.length) reasons.push(last == null ? 'Sem chuva.' : `Sem chuva há ${fmtAgo(last)}.`);

  return { status, r24, r48, r72, total72, next6, rh12, last, reasons };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
const tip = $('#tooltip');
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { tip.hidden = true; }
function tipRow(site, value) {
  return `<div class="r"><span><i class="swatch" style="background:var(${site.color})"></i>${site.name}</span><b>${value}</b></div>`;
}

// ---------------------------------------------------------------------------
// Cartões de veredito
// ---------------------------------------------------------------------------
function renderHero() {
  const order = ['good', 'warning', 'serious', 'critical'];
  let worst = 'good';
  $('#hero-status').innerHTML = SITES.map((s) => {
    const e = readings(s);
    if (order.indexOf(e.status) > order.indexOf(worst)) worst = e.status;
    const st = STATUS[e.status];
    return `<span class="hero-chip"><span class="pill ${st.cls}">${st.label}</span>${s.name}</span>`;
  }).join('');
  if (typeof Scene !== 'undefined') {
    Scene.setWeather(worst);
    const isDay = state.hourly[SITES[0].id].isDay;
    if (Scene.setNight && isDay) Scene.setNight(isDay[state.target] === 0);
  }
}

// Leituras separadas e veredito final combinado:
// os dois "Bora" → Bora; só um "Bora" → Talvez; nenhum → o mais brando dos dois.
const ORDER = ['good', 'warning', 'serious', 'critical'];
function readings(s, idx = state.target) {
  const h = state.hourly[s.id];
  const g = state.gauge[s.id];
  const base = evaluate(s.id, idx); // série combinada: números e motivos do cartão
  const model = evaluate(s.id, idx, { precip: h.model || h.precip });
  const gauge = g ? evaluate(s.id, Math.min(idx, state.nowIdx), { precip: h.measured.map((v) => v || 0), noForecast: true }) : null;
  let status;
  let disagree = false;
  if (!gauge) status = model.status;
  else if (gauge.status === 'good' && model.status === 'good') status = 'good';
  else if (gauge.status === 'good' || model.status === 'good') { status = 'warning'; disagree = true; }
  else status = ORDER[Math.min(ORDER.indexOf(gauge.status), ORDER.indexOf(model.status))];
  const reasons = disagree ? ['Pluviômetro e modelo discordam.', ...base.reasons] : base.reasons;
  return { status, base, model, gauge, reasons };
}

function viewsHtml(s, R) {
  const g = state.gauge[s.id];
  const idx = state.target;
  const view = (label, e, detail) => {
    const st = STATUS[e.status];
    return `<div class="view"><span class="vlabel">${label}</span><span class="pill ${st.cls}">${st.label}</span><span class="vdetail">${detail}</span></div>`;
  };
  let gaugeView;
  if (!g) {
    gaugeView = '<div class="view off"><span class="vlabel">Pluviômetro</span><span class="vdetail">sem estação ativa perto</span></div>';
  } else {
    // horário no futuro: o pluviômetro só conhece até agora
    const until = idx > state.nowIdx ? ' até agora' : '';
    gaugeView = view('Pluviômetro', R.gauge, `${fmtMm(R.gauge.total72)} mm em 72 h${until} · ${titleCase(g.st.city)} (${Math.round(g.km)} km)`);
  }
  const em = R.model;
  const modelView = view('Modelo', em, `${fmtMm(em.total72)} mm em 72 h${em.next6 >= 1 ? ' · chuva prevista' : ''}`);
  return `<div class="views">${gaugeView}${modelView}</div>`;
}

function renderCards() {
  renderHero();
  const wrap = $('#cards');
  wrap.innerHTML = '';
  for (const s of SITES) {
    const R = readings(s);
    const e = R.base;
    const st = STATUS[R.status];
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--status', `var(${st.color})`);
    card.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-title"><i class="swatch" style="background:var(${s.color})"></i><h3>${s.name}</h3></div>
          <div class="rock">${s.rock}</div>
        </div>
        <span class="pill ${st.cls}">${st.label}</span>
      </div>
      <div class="verdict">${st.head}</div>
      <p class="source">${state.gauge[s.id] ? 'Final: Bora só quando pluviômetro e modelo concordam' : 'Final: só o modelo (sem pluviômetro ativo perto)'}</p>
      ${viewsHtml(s, R)}
      <ul class="reasons">${R.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
      <div class="stats">
        <div class="stat"><div class="v">${fmtMm(e.r24)}</div><div class="k">mm hoje</div></div>
        <div class="stat"><div class="v">${fmtMm(e.r48)}</div><div class="k">mm ontem</div></div>
        <div class="stat"><div class="v">${fmtMm(e.r72)}</div><div class="k">mm anteontem</div></div>
        <div class="stat"><div class="v">${fmtAgo(e.last)}</div><div class="k">sem chuva</div></div>
      </div>`;
    wrap.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------
let map, markers = {}, gridDots = {}, radarLayer = null;
// Agarra (com o furo do parafuso) como marcador do setor
function holdIcon(color) {
  return L.divIcon({
    className: 'hold-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg width="34" height="34" viewBox="0 0 24 24"><path fill-rule="evenodd" fill="${color}" stroke="#17140f" stroke-width="1.1" d="M4 13c-1-4 2-8 7-9 5-1 9 2 9 6 0 3-2 5-4 7-3 3-8 4-10 2-1-1-1-4-2-6zM12 9.2a1.8 1.8 0 1 0 .01 0z"/></svg>`,
  });
}
function initMap() {
  if (!document.getElementById('map')) return;
  map = L.map('map', { scrollWheelZoom: false }).setView([-23.435, -47.64], 12);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap',
  }).addTo(map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Imagens © Esri',
  });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)',
  });
  L.control.layers({ 'Mapa': osm, 'Satélite': sat, 'Relevo': topo }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  map.createPane('radar').style.zIndex = 250;

  for (const s of SITES) {
    markers[s.id] = L.marker([s.lat, s.lon], { icon: holdIcon('#999') })
      .addTo(map).bindTooltip(s.name, { permanent: true, direction: 'right', offset: [16, 0], className: 'site-label' });
    markers[s.id].on('click', () => {
      document.querySelectorAll('.card')[SITES.indexOf(s)]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  $('#radar-toggle').addEventListener('change', toggleRadar);
}

function renderMap() {
  if (!map) return;
  renderGaugesOnMap();
  for (const s of SITES) {
    const e = evaluate(s.id, state.target);
    const st = STATUS[e.status];
    markers[s.id].setIcon(holdIcon(cssVar(st.color)));
    markers[s.id].bindPopup(`
      <b>${s.name}</b><br>
      <span class="pill ${st.cls}">${st.label}</span><br>
      ${fmtTime(state.times[state.target])}<br>
      Chuva 72 h: <b>${fmtMm(e.total72)} mm</b><br>
      Última chuva: ${fmtAgo(e.last)}`);
    const g = state.grid[s.id];
    if (g) {
      if (!gridDots[s.id]) {
        gridDots[s.id] = L.circleMarker([g.lat, g.lon], {
          radius: 4, weight: 1, color: '#fff', fillColor: cssVar(s.color), fillOpacity: 1,
        }).addTo(map).bindTooltip(`Ponto do modelo · ${s.name}`);
      } else {
        gridDots[s.id].setLatLng([g.lat, g.lon]);
      }
    }
  }
}

let gaugeMarkers = [];
function renderGaugesOnMap() {
  gaugeMarkers.forEach((m) => map.removeLayer(m));
  gaugeMarkers = [];
  const now = state.times[state.nowIdx];
  state.stations.forEach((st) => {
    const sum = (h) => { let t = 0; for (let i = Math.max(0, state.nowIdx - h + 1); i <= state.nowIdx; i++) t += st.byKey[state.times[i]] || 0; return t; };
    const fresh = st.enabled && st.last && !st.suspect && (Date.parse(now + ':00Z') - Date.parse(st.last + ':00Z')) / 3600e3 <= GAUGE_FRESH_H;
    const used = SITES.some((s) => state.gauge[s.id] && state.gauge[s.id].st.id === st.id);
    const mk = L.circleMarker([st.lat, st.lon], {
      radius: used ? 6 : 4.5, weight: used ? 2.5 : 1.5, color: '#1a0d08', fillColor: fresh ? '#ffffff' : '#9a9a9a', fillOpacity: 1,
    }).addTo(map);
    mk.bindTooltip(`Pluviômetro · ${titleCase(st.city)}`);
    mk.bindPopup(`<b>Pluviômetro CEMADEN</b><br>${titleCase(st.city)} · ${st.name}<br>`
      + (fresh ? `24 h: <b>${fmtMm(sum(24))} mm</b> · 72 h: <b>${fmtMm(sum(72))} mm</b><br>último dado: ${fmtTime(st.last)}`
        : `<span class="muted">${st.suspect && st.last ? 'dados suspeitos (quase sempre zero), não usado' : `sem dados recentes${st.last ? ` (último: ${fmtTime(st.last)})` : ''}`}</span>`));
    gaugeMarkers.push(mk);
  });
}

async function toggleRadar(ev) {
  if (!ev.target.checked) {
    if (radarLayer) map.removeLayer(radarLayer);
    return;
  }
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const j = await res.json();
    const frames = j.radar.past;
    const f = frames[frames.length - 1];
    if (radarLayer) map.removeLayer(radarLayer);
    radarLayer = L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      pane: 'radar', opacity: 0.75, maxNativeZoom: 7, maxZoom: 18, attribution: 'Radar © RainViewer',
    }).addTo(map);
    map.setZoom(Math.min(map.getZoom(), 9));
  } catch (err) {
    ev.target.checked = false;
    alert('Não foi possível carregar o radar.');
  }
}

// ---------------------------------------------------------------------------
// Gráfico diário (barras agrupadas)
// ---------------------------------------------------------------------------
function renderDaily() {
  const box = $('#daily-chart');
  box.innerHTML = '';
  const W = box.clientWidth || 600;
  const H = W < 500 ? 220 : 300;
  const m = { l: 34, r: 8, t: 16, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const days = state.days;
  const n = days.length;
  const todayKey = state.times[state.nowIdx].slice(0, 10);
  const todayIdx = days.indexOf(todayKey);

  let max = 0;
  SITES.forEach((s) => state.daily[s.id].sum.forEach((v) => { if (v > max) max = v; }));
  const ymax = niceMax(Math.max(max, 2));
  const y = (v) => m.t + ph - (v / ymax) * ph;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });

  // Faixa de previsão
  const gw = pw / n;
  if (todayIdx >= 0) {
    const fx = m.l + (todayIdx + 1) * gw;
    svgEl('rect', { x: fx, y: m.t, width: m.l + pw - fx, height: ph, fill: 'var(--forecast)' }, svg);
    svgEl('text', { x: fx + 4, y: m.t - 4 }, svg).textContent = 'previsão';
  }

  // Grade + eixo y
  [0, ymax / 2, ymax].forEach((v) => {
    svgEl('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v), class: v === 0 ? 'base-line' : 'grid-line' }, svg);
    svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmtMm(v);
  });

  // Dia avaliado
  const targetDay = days.indexOf(state.times[state.target].slice(0, 10));
  if (targetDay >= 0) {
    svgEl('rect', { x: m.l + targetDay * gw + 1, y: m.t, width: gw - 2, height: ph, fill: 'var(--window)', rx: 4 }, svg);
  }

  const inner = Math.min(gw * 0.78, 44);
  const bw = Math.max(1, (inner - 2) / SITES.length);
  let maxBar = null;
  days.forEach((d, i) => {
    const gx = m.l + i * gw + (gw - inner) / 2;
    SITES.forEach((s, k) => {
      const v = state.daily[s.id].sum[i] || 0;
      const x = gx + k * (bw + 2);
      if (v > 0) {
        const top = y(v);
        svgEl('path', {
          d: barPath(x, top, bw, m.t + ph - top, 4),
          fill: `var(${s.color})`,
          opacity: i > todayIdx && todayIdx >= 0 ? 0.5 : 1,
        }, svg);
      }
      if (!maxBar || v > maxBar.v) maxBar = { v, x: x + bw / 2 };
    });

    // Rótulos de dia (afinados conforme o espaço)
    const every = gw < 22 ? Math.ceil(22 / gw) * 2 : gw < 36 ? 2 : 1;
    if ((((i - Math.max(0, todayIdx)) % every) + every) % every === 0) {
      const cx = m.l + i * gw + gw / 2;
      const t1 = svgEl('text', { x: cx, y: H - m.b + 14, 'text-anchor': 'middle' }, svg);
      t1.textContent = i === todayIdx ? 'hoje' : WD[weekday(d)];
      if (i === todayIdx) t1.setAttribute('class', 'val-label');
      svgEl('text', { x: cx, y: H - m.b + 27, 'text-anchor': 'middle' }, svg).textContent = fmtDay(d, false);
    }

    // Área de clique/hover maior que a barra
    const hit = svgEl('rect', { x: m.l + i * gw, y: m.t, width: gw, height: ph, class: 'bar-hit', rx: 4 }, svg);
    hit.addEventListener('pointermove', (ev) => {
      const fc = i > todayIdx ? ' <span class="muted">(previsão)</span>' : '';
      showTip(`<div class="t">${fmtDay(d)}${fc}</div>`
        + SITES.map((s) => {
          const dd = state.daily[s.id];
          const extra = dd.hours[i] ? ` <span class="muted">· ${dd.hours[i]} h</span>` : '';
          return tipRow(s, `${fmtMm(dd.sum[i])} mm${extra}`);
        }).join(''), ev);
    });
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('click', () => {
      let idx = state.times.indexOf(`${d}T08:00`);
      if (idx < 0) idx = state.times.findIndex((t) => t.startsWith(d));
      setTarget(idx);
    });
  });

  // Rótulo só no maior valor
  if (maxBar && maxBar.v > 0) {
    svgEl('text', { x: maxBar.x, y: y(maxBar.v) - 5, 'text-anchor': 'middle', class: 'val-label' }, svg).textContent = fmtMm(maxBar.v);
  }

  box.appendChild(svg);
}

// ---------------------------------------------------------------------------
// Gráfico horário (pequenos múltiplos, um por local, mesma escala)
// ---------------------------------------------------------------------------
function renderHourly() {
  const box = $('#hourly-chart');
  box.innerHTML = '';
  const W = box.clientWidth || 800;
  const rowH = 96;
  const gap = 22;
  const m = { l: 34, r: 8, t: 18, b: 34 };
  const H = m.t + SITES.length * rowH + (SITES.length - 1) * gap + m.b;
  const pw = W - m.l - m.r;
  const T = state.times;
  const n = T.length;
  const bw = pw / n;
  const xOf = (i) => m.l + i * bw;

  let max = 0;
  SITES.forEach((s) => state.hourly[s.id].precip.forEach((v) => { if (v > max) max = v; }));
  const ymax = niceMax(Math.max(max, 1));

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });

  // Rótulos de dia
  const dayStarts = [];
  T.forEach((t, i) => { if (t.endsWith('T00:00')) dayStarts.push(i); });
  const pxPerDay = bw * 24;
  const every = pxPerDay < 28 ? Math.ceil(28 / pxPerDay) * 2 : pxPerDay < 48 ? 2 : 1;

  SITES.forEach((s, k) => {
    const top = m.t + k * (rowH + gap);
    const y = (v) => top + rowH - (v / ymax) * rowH;

    // Previsão e janela de 72 h
    svgEl('rect', { x: xOf(state.nowIdx + 1), y: top, width: Math.max(0, m.l + pw - xOf(state.nowIdx + 1)), height: rowH, fill: 'var(--forecast)' }, svg);
    const w0 = Math.max(0, state.target - 71);
    svgEl('rect', { x: xOf(w0), y: top, width: xOf(state.target + 1) - xOf(w0), height: rowH, fill: 'var(--window)' }, svg);

    // Divisões de dia
    dayStarts.forEach((i) => {
      svgEl('line', { x1: xOf(i), x2: xOf(i), y1: top, y2: top + rowH, class: 'grid-line' }, svg);
    });
    // Escala
    [ymax].forEach((v) => {
      svgEl('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v), class: 'grid-line' }, svg);
      svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmtMm(v);
    });
    svgEl('text', { x: m.l - 6, y: y(0) + 4, 'text-anchor': 'end' }, svg).textContent = '0';

    // Barras
    const p = state.hourly[s.id].precip;
    const barW = bw > 4 ? bw - 1 : Math.max(bw, 1);
    let d = '';
    p.forEach((v, i) => {
      if (!v) return;
      const yy = Math.min(y(v), top + rowH - 1);
      d += barPath(xOf(i), yy, barW, top + rowH - yy, bw > 6 ? 2 : 0);
    });
    svgEl('path', { d, fill: `var(${s.color})` }, svg);
    svgEl('line', { x1: m.l, x2: m.l + pw, y1: top + rowH, y2: top + rowH, class: 'base-line' }, svg);

    // Título da linha
    const tt = svgEl('text', { x: m.l + 4, y: top - 5, class: 'row-title' }, svg);
    tt.textContent = s.name;
    if (k === 0) {
      svgEl('text', { x: xOf(state.nowIdx + 1) + 4, y: top - 5 }, svg).textContent = 'previsão →';
    }

    // Linhas de agora e do alvo
    svgEl('line', { x1: xOf(state.nowIdx + 1), x2: xOf(state.nowIdx + 1), y1: top, y2: top + rowH, class: 'now-line' }, svg);
    const tx = xOf(state.target) + bw / 2;
    svgEl('line', { x1: tx, x2: tx, y1: top - 2, y2: top + rowH, class: 'target-line' }, svg);
  });

  // Eixo x
  const bottom = H - m.b;
  dayStarts.forEach((i, j) => {
    if ((dayStarts.length - 1 - j) % every !== 0) return;
    const d = T[i].slice(0, 10);
    const cx = xOf(i) + Math.min(pxPerDay / 2, 200);
    svgEl('text', { x: cx, y: bottom + 14, 'text-anchor': 'middle' }, svg).textContent = WD[weekday(d)];
    svgEl('text', { x: cx, y: bottom + 27, 'text-anchor': 'middle' }, svg).textContent = fmtDay(d, false);
  });

  // Cursor de hover + interação
  const hoverLine = svgEl('line', { y1: m.t, y2: bottom, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0 }, svg);
  const overlay = svgEl('rect', { x: m.l, y: m.t - 10, width: pw, height: bottom - m.t + 10, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const idxAt = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / bw)));
  };
  let dragging = false;
  overlay.addEventListener('pointerdown', (ev) => { dragging = true; overlay.setPointerCapture(ev.pointerId); setTarget(idxAt(ev), true); });
  overlay.addEventListener('pointerup', () => { dragging = false; renderAll(); });
  overlay.addEventListener('pointermove', (ev) => {
    const i = idxAt(ev);
    hoverLine.setAttribute('x1', xOf(i) + bw / 2);
    hoverLine.setAttribute('x2', xOf(i) + bw / 2);
    hoverLine.setAttribute('opacity', 1);
    const fc = i > state.nowIdx ? ' <span class="muted">(previsão)</span>' : '';
    showTip(`<div class="t">${fmtTime(T[i])}${fc}</div>`
      + SITES.map((s) => {
        const h = state.hourly[s.id];
        const pr = i > state.nowIdx && h.prob && h.prob[i] != null ? ` · ${h.prob[i]}%` : '';
        return tipRow(s, `${fmtMm(h.precip[i])} mm${pr}`);
      }).join('')
      + `<div class="muted" style="margin-top:4px">Umidade: ${SITES.map((s) => (state.hourly[s.id].rh[i] ?? '–') + '%').join(' / ')}</div>`, ev);
    if (dragging) setTarget(i, true);
  });
  overlay.addEventListener('pointerleave', () => { hoverLine.setAttribute('opacity', 0); hideTip(); });

  box.appendChild(svg);
}

// ---------------------------------------------------------------------------
// Gráfico de chuva acumulada: por dias (período carregado, hora a hora)
// ou por mês (desde o dia 1, dia a dia)
// ---------------------------------------------------------------------------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
state.cumMode = 'dias';
state.month = null; // { key, days, sum: { id: [] } }

async function loadMonth() {
  const today = state.times[state.nowIdx].slice(0, 10);
  const key = today.slice(0, 7);
  if (state.month && state.month.key === key) return;
  const pastDays = Math.max(0, Number(today.slice(8, 10)) - 1);
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${SITES.map((x) => x.lat).join(',')}&longitude=${SITES.map((x) => x.lon).join(',')}`
    + '&daily=precipitation_sum'
    + `&past_days=${pastDays}&forecast_days=${FORECAST_DAYS}`
    + `&timezone=${encodeURIComponent(TZ)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  let json = await res.json();
  if (!Array.isArray(json)) json = [json];
  // só os dias do mês atual
  const days = json[0].daily.time.filter((d) => d.startsWith(key));
  const sum = {};
  SITES.forEach((x, i) => {
    sum[x.id] = json[i].daily.time.map((d, k) => [d, json[i].daily.precipitation_sum[k]]).filter(([d]) => d.startsWith(key)).map(([, v]) => v);
  });
  state.month = { key, days, sum };
}

function cumulativeData() {
  if (state.cumMode === 'mes' && state.month) {
    const { days, sum, key } = state.month;
    const today = state.times[state.nowIdx].slice(0, 10);
    const targetDay = state.times[state.target].slice(0, 10);
    const cum = {};
    SITES.forEach((x) => { let acc = 0; cum[x.id] = sum[x.id].map((v) => (acc += v || 0)); });
    return {
      n: days.length,
      cum,
      nowIdx: Math.max(0, days.indexOf(today)),
      targetIdx: days.indexOf(targetDay),
      window: null,
      unit: `mm em ${MESES[Number(key.slice(5, 7)) - 1]} · modelo`,
      ticks: days.map((d, i) => ({ i, top: String(Number(d.slice(8, 10))), bottom: WD[weekday(d)] })),
      tipTitle: (i) => fmtDay(days[i]) + (days[i] > today ? ' <span class="muted">(previsão)</span>' : ''),
      toTarget: (i) => {
        let t = state.times.indexOf(`${days[i]}T08:00`);
        if (t < 0) t = state.times.findIndex((x) => x.startsWith(days[i]));
        return t;
      },
    };
  }
  const T = state.times;
  const cum = {};
  const model = {};
  SITES.forEach((x) => {
    let acc = 0;
    cum[x.id] = state.hourly[x.id].precip.map((v) => (acc += v || 0));
    if (state.gauge[x.id]) { let a2 = 0; model[x.id] = state.hourly[x.id].model.map((v) => (a2 += v || 0)); }
  });
  const ticks = [];
  T.forEach((t, i) => { if (t.endsWith('T00:00')) ticks.push({ i: i + 12, top: WD[weekday(t.slice(0, 10))], bottom: fmtDay(t.slice(0, 10), false) }); });
  return {
    n: T.length,
    cum,
    model,
    nowIdx: state.nowIdx,
    targetIdx: state.target,
    window: [Math.max(0, state.target - 71), state.target],
    unit: `mm desde ${fmtDay(T[0].slice(0, 10), false)}`,
    ticks,
    tipTitle: (i) => fmtTime(T[i]) + (i > state.nowIdx ? ' <span class="muted">(previsão)</span>' : ''),
    toTarget: (i) => i,
  };
}

function renderCumulative() {
  const box = $('#cum-chart');
  box.innerHTML = '';
  document.querySelectorAll('#cum-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.cumMode));
  if (state.cumMode === 'mes' && !state.month) {
    box.innerHTML = '<p class="note">carregando o mês…</p>';
    loadMonth().then(renderCumulative).catch((err) => { box.innerHTML = `<p class="note">Não consegui carregar o mês (${err.message}).</p>`; });
    return;
  }
  const D = cumulativeData();
  const W = box.clientWidth || 800;
  const H = W < 500 ? 200 : 240;
  const m = { l: 34, r: 104, t: 14, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = D.n;
  const xOf = (i) => m.l + (i / Math.max(1, n - 1)) * pw;

  let max = 0;
  SITES.forEach((x) => { max = Math.max(max, D.cum[x.id][n - 1] || 0); });
  const ymax = niceMax(Math.max(max, 2));
  const y = (v) => m.t + ph - (v / ymax) * ph;
  $('#cum-unit').textContent = D.unit;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });

  // previsão e janela de 72 h
  const fx = xOf(D.nowIdx);
  svgEl('rect', { x: fx, y: m.t, width: Math.max(0, m.l + pw - fx), height: ph, fill: 'var(--forecast)' }, svg);
  if (fx < m.l + pw - 40) svgEl('text', { x: fx + 4, y: m.t + 10 }, svg).textContent = 'previsão';
  if (D.window) svgEl('rect', { x: xOf(D.window[0]), y: m.t, width: xOf(D.window[1]) - xOf(D.window[0]), height: ph, fill: 'var(--window)' }, svg);

  // grade + eixo y
  [0, ymax / 2, ymax].forEach((v) => {
    svgEl('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v), class: v === 0 ? 'base-line' : 'grid-line' }, svg);
    svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmtMm(v);
  });

  // eixo x (rótulos afinados conforme o espaço)
  const step = Math.max(1, Math.ceil(D.ticks.length / Math.max(1, Math.floor(pw / 38))));
  D.ticks.forEach((tk, j) => {
    if ((D.ticks.length - 1 - j) % step !== 0) return;
    const cx = xOf(Math.min(n - 1, tk.i));
    svgEl('text', { x: cx, y: H - m.b + 14, 'text-anchor': 'middle' }, svg).textContent = tk.top;
    svgEl('text', { x: cx, y: H - m.b + 27, 'text-anchor': 'middle' }, svg).textContent = tk.bottom;
  });

  // curvas: sólida no passado, tracejada na previsão; rótulo direto no fim
  const linePath = (arr, a, b) => arr.slice(a, b + 1).map((v, k) => `${k ? 'L' : 'M'}${xOf(a + k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ends = [];
  // modelo (linha fina) para comparar com o medido
  SITES.forEach((x) => {
    const mc = D.model && D.model[x.id];
    if (mc) svgEl('path', { d: linePath(mc, 0, n - 1), fill: 'none', stroke: `var(${x.color})`, 'stroke-width': 1, opacity: 0.45 }, svg);
  });
  SITES.forEach((x) => {
    const c = D.cum[x.id];
    svgEl('path', { d: linePath(c, 0, D.nowIdx), fill: 'none', stroke: `var(${x.color})`, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    if (D.nowIdx < n - 1) svgEl('path', { d: linePath(c, D.nowIdx, n - 1), fill: 'none', stroke: `var(${x.color})`, 'stroke-width': 2, 'stroke-dasharray': '4 4', 'stroke-linejoin': 'round' }, svg);
    ends.push({ x, v: c[n - 1], y: y(c[n - 1]) });
  });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  ends.forEach((e) => {
    svgEl('circle', { cx: xOf(n - 1), cy: y(e.v), r: 3, fill: `var(${e.x.color})` }, svg);
    svgEl('text', { x: xOf(n - 1) + 8, y: e.y + 4, class: 'val-label' }, svg).textContent = `${e.x.name.split(' ')[0]} ${fmtMm(e.v)} mm`;
  });

  // horário avaliado
  if (D.targetIdx >= 0) {
    const tx = xOf(D.targetIdx);
    svgEl('line', { x1: tx, x2: tx, y1: m.t, y2: m.t + ph, class: 'target-line' }, svg);
  }

  // hover + clique/arraste
  const hoverLine = svgEl('line', { y1: m.t, y2: m.t + ph, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0 }, svg);
  const dots = SITES.map((x) => svgEl('circle', { r: 4, fill: `var(${x.color})`, stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }, svg));
  const overlay = svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const idxAt = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / pw) * (n - 1))));
  };
  let dragging = false;
  const pick = (i, light) => { const t = D.toTarget(i); if (t >= 0) setTarget(t, light); };
  overlay.addEventListener('pointerdown', (ev) => { dragging = true; overlay.setPointerCapture(ev.pointerId); pick(idxAt(ev), true); });
  overlay.addEventListener('pointerup', () => { dragging = false; renderAll(); });
  overlay.addEventListener('pointermove', (ev) => {
    const i = idxAt(ev);
    hoverLine.setAttribute('x1', xOf(i)); hoverLine.setAttribute('x2', xOf(i)); hoverLine.setAttribute('opacity', 1);
    SITES.forEach((x, k) => { dots[k].setAttribute('cx', xOf(i)); dots[k].setAttribute('cy', y(D.cum[x.id][i])); dots[k].setAttribute('opacity', 1); });
    showTip(`<div class="t">${D.tipTitle(i)}</div>` + SITES.map((x) => tipRow(x, `${fmtMm(D.cum[x.id][i])} mm`)).join(''), ev);
    if (dragging) pick(i, true);
  });
  overlay.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('opacity', 0); dots.forEach((d) => d.setAttribute('opacity', 0)); hideTip();
  });

  box.appendChild(svg);
  // legenda: cor = local; estilo da linha = de onde vem a chuva
  const sample = (style) => `<svg class="lsample" width="28" height="10" aria-hidden="true"><line x1="1" y1="5" x2="27" y2="5" stroke="currentColor" ${style}/></svg>`;
  const hasModel = D.model && Object.keys(D.model).length > 0;
  const ids = SITES.map((x) => state.gauge[x.id] && state.gauge[x.id].st.id);
  const sameGauge = state.cumMode === 'dias' && ids[0] && ids.every((v) => v === ids[0]);
  $('#legend-cum').innerHTML = `
    <span class="lg-group">${SITES.map((x) => `<span style="color:var(${x.color})">${sample('stroke-width="3"')}<b style="color:var(--ink)">${x.name}</b></span>`).join('')}</span>
    <span class="lg-group">
      ${hasModel ? `<span>${sample('stroke-width="2.5"')}medido (pluviômetro)</span>` : `<span>${sample('stroke-width="2.5"')}modelo</span>`}
      <span>${sample('stroke-width="2.5" stroke-dasharray="4 3"')}previsão</span>
      ${hasModel ? `<span class="faint">${sample('stroke-width="1.2" opacity="0.5"')}só modelo</span>` : ''}
    </span>
    ${sameGauge ? '<span class="lg-note">Os dois setores usam o mesmo pluviômetro: as linhas medidas se sobrepõem.</span>' : ''}`;
}

// ---------------------------------------------------------------------------
// Pluviômetros: tabela das estações + medido x modelo por dia
// ---------------------------------------------------------------------------
state.gaugeSel = null;

function gaugeStatus(st) {
  const now = state.times[state.nowIdx];
  if (!st.last) return { key: 'off', label: 'parado' };
  const h = (Date.parse(now + ':00Z') - Date.parse(st.last + ':00Z')) / 3600e3;
  if (!st.enabled || h > GAUGE_FRESH_H) return { key: 'off', label: 'parado' };
  if (st.suspect) return { key: 'bad', label: 'com defeito' };
  return { key: 'ok', label: 'ativo' };
}
function gaugeSum(st, hours) {
  let t = 0;
  let n = 0;
  for (let i = Math.max(0, state.nowIdx - hours + 1); i <= state.nowIdx; i++) {
    const v = st.byKey[state.times[i]];
    if (v != null) { t += v; n++; }
  }
  return n ? t : null;
}

// Mapa das estações (ao lado da tabela)
let gaugeMap = null;
let gaugeLayer = null;
const gaugeMk = {};
function selectGauge(id, fly) {
  state.gaugeSel = id;
  renderGauges();
  const st = state.stations.find((x) => x.id === id);
  if (fly && st && gaugeMap) {
    gaugeMap.flyTo([st.lat, st.lon], Math.max(gaugeMap.getZoom(), 12), { duration: 0.8 });
    setTimeout(() => gaugeMk[id] && gaugeMk[id].openPopup(), 850);
  }
}
function renderGaugeMap(byDist) {
  const el = $('#gauge-map');
  if (!el || typeof L === 'undefined') return;
  if (!gaugeMap) {
    gaugeMap = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(gaugeMap);
    L.control.scale({ imperial: false }).addTo(gaugeMap);
    gaugeLayer = L.layerGroup().addTo(gaugeMap);
    const pts = state.stations.map((st) => [st.lat, st.lon]).concat(SITES.map((x) => [x.lat, x.lon]));
    gaugeMap.fitBounds(pts, { padding: [24, 24] });
  }
  gaugeLayer.clearLayers();
  // setores
  SITES.forEach((x) => {
    L.marker([x.lat, x.lon], { icon: holdIcon(cssVar(x.color)), keyboard: false }).addTo(gaugeLayer)
      .bindTooltip(x.name, { permanent: true, direction: 'right', offset: [14, 0], className: 'site-label' });
  });
  // linha até o setor mais próximo da estação selecionada
  const sel = state.stations.find((x) => x.id === state.gaugeSel);
  if (sel) {
    const near = SITES.slice().sort((a, b) => distKm(a, sel) - distKm(b, sel))[0];
    L.polyline([[sel.lat, sel.lon], [near.lat, near.lon]], { color: '#1a0d08', weight: 1.5, dashArray: '4 4' }).addTo(gaugeLayer)
      .bindTooltip(`${Math.round(distKm(near, sel))} km até ${near.name}`, { permanent: true, direction: 'center', className: 'dist-label' });
  }
  // estações
  byDist.forEach(({ st, km }) => {
    const stt = gaugeStatus(st);
    const isSel = st.id === state.gaugeSel;
    const mk = L.circleMarker([st.lat, st.lon], {
      radius: isSel ? 8 : 5.5, weight: isSel ? 3 : 1.5, color: '#1a0d08',
      fillColor: stt.key === 'ok' ? '#ffffff' : stt.key === 'bad' ? cssVar('--critical') : '#9a9a9a', fillOpacity: 1,
    }).addTo(gaugeLayer);
    const v = (h) => { const x = gaugeSum(st, h); return x == null ? '–' : `${fmtMm(x)} mm`; };
    mk.bindPopup(`<b>${titleCase(st.city)} · ${st.name}</b><br><span class="gstat g-${stt.key}">${stt.label}</span><br>`
      + (stt.key === 'ok' ? `24 h: <b>${v(24)}</b> · 72 h: <b>${v(72)}</b> · 7 dias: <b>${v(168)}</b><br>` : '')
      + `${SITES.map((x, i) => `${Math.round(km[i])} km até ${x.name}`).join('<br>')}<br>`
      + `<span class="muted">${st.lat.toFixed(4)}, ${st.lon.toFixed(4)}</span>`);
    mk.bindTooltip(`${titleCase(st.city)} · ${st.name}`);
    mk.on('click', () => { if (state.gaugeSel !== st.id) selectGauge(st.id, false); setTimeout(() => gaugeMk[st.id] && gaugeMk[st.id].openPopup(), 0); });
    if (isSel) mk.bringToFront();
    gaugeMk[st.id] = mk;
  });
}

function renderGauges() {
  const tableBox = $('#gauge-table');
  const chartBox = $('#gauge-chart');
  if (!state.stations.length) {
    chartBox.innerHTML = '';
    tableBox.innerHTML = '<p class="note">Não consegui carregar os pluviômetros do CEMADEN agora.</p>';
    return;
  }
  // estação padrão: a usada pelo Iperocks (ou a mais próxima)
  const byDist = state.stations.map((st) => ({ st, km: SITES.map((x) => distKm(x, st)) })).sort((a, b) => a.km[0] - b.km[0]);
  if (!state.gaugeSel || !state.stations.some((x) => x.id === state.gaugeSel)) {
    state.gaugeSel = (state.gauge[SITES[0].id] && state.gauge[SITES[0].id].st.id) || byDist[0].st.id;
  }
  const sel = state.stations.find((x) => x.id === state.gaugeSel);

  // tabela
  const used = new Set(SITES.map((x) => state.gauge[x.id] && state.gauge[x.id].st.id).filter(Boolean));
  const mm = (v) => (v == null ? '–' : fmtMm(v));
  tableBox.innerHTML = `<table class="gauges">
    <thead><tr><th>Estação</th>${SITES.map((x) => `<th>${x.name.split(' ')[0]}</th>`).join('')}<th>Leitura</th><th>24 h</th><th>72 h</th><th>7 dias</th><th>Situação</th></tr></thead>
    <tbody>${byDist.map(({ st, km }) => {
      const stt = gaugeStatus(st);
      const ok = stt.key === 'ok';
      return `<tr data-id="${st.id}" class="${st.id === state.gaugeSel ? 'sel' : ''} ${ok ? '' : 'off'}">
        <td>${titleCase(st.city)} · ${st.name}${used.has(st.id) ? ' <span class="used">em uso</span>' : ''}</td>
        ${km.map((k) => `<td>${Math.round(k)} km</td>`).join('')}
        <td>${st.last ? `${fmtDay(st.last.slice(0, 10), false)} ${st.last.slice(11, 13)}h` : '–'}</td>
        <td>${ok ? mm(gaugeSum(st, 24)) : '–'}</td>
        <td>${ok ? mm(gaugeSum(st, 72)) : '–'}</td><td>${ok ? mm(gaugeSum(st, 168)) : '–'}</td>
        <td><span class="gstat g-${stt.key}">${stt.label}</span></td></tr>`;
    }).join('')}</tbody></table>`;
  tableBox.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => selectGauge(Number(tr.dataset.id), true)));
  renderGaugeMap(byDist);

  // gráfico: chuva por dia, medido (estação) x modelo (setor mais próximo da estação)
  chartBox.innerHTML = '';
  const site = SITES.slice().sort((a, b) => distKm(a, sel) - distKm(b, sel))[0];
  const today = state.times[state.nowIdx].slice(0, 10);
  const days = state.days.filter((d) => d <= today);
  const sumDay = (get, day) => {
    let t = 0;
    let n = 0;
    state.times.forEach((tm, i) => { if (tm.startsWith(day) && i <= state.nowIdx) { const v = get(i, tm); if (v != null) { t += v; n++; } } });
    return n ? t : null;
  };
  const meas = days.map((d) => sumDay((i, tm) => sel.byKey[tm], d));
  const model = days.map((d) => sumDay((i) => state.hourly[site.id].model[i], d));
  const W = chartBox.clientWidth || 800;
  const H = W < 500 ? 200 : 230;
  const m = { l: 34, r: 8, t: 16, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = days.length;
  let max = 0;
  meas.concat(model).forEach((v) => { if (v > max) max = v; });
  const ymax = niceMax(Math.max(max, 2));
  const y = (v) => m.t + ph - (v / ymax) * ph;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
  [0, ymax / 2, ymax].forEach((v) => {
    svgEl('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v), class: v === 0 ? 'base-line' : 'grid-line' }, svg);
    svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmtMm(v);
  });
  const gw = pw / n;
  const inner = Math.min(gw * 0.78, 40);
  const bw = Math.max(1, (inner - 2) / 2);
  const every = gw < 22 ? Math.ceil(22 / gw) * 2 : gw < 36 ? 2 : 1;
  let maxBar = null;
  days.forEach((d, i) => {
    const gx = m.l + i * gw + (gw - inner) / 2;
    [[meas[i], 'var(--gauge-meas)'], [model[i], 'var(--gauge-model)']].forEach(([v, c], k) => {
      if (!v) return;
      const top = y(v);
      svgEl('path', { d: barPath(gx + k * (bw + 2), top, bw, m.t + ph - top, 4), fill: c }, svg);
      if (k === 0 && (!maxBar || v > maxBar.v)) maxBar = { v, x: gx + bw / 2 };
    });
    if ((n - 1 - i) % every === 0) {
      const cx = m.l + i * gw + gw / 2;
      svgEl('text', { x: cx, y: H - m.b + 14, 'text-anchor': 'middle' }, svg).textContent = d === today ? 'hoje' : WD[weekday(d)];
      svgEl('text', { x: cx, y: H - m.b + 27, 'text-anchor': 'middle' }, svg).textContent = fmtDay(d, false);
    }
    const hit = svgEl('rect', { x: m.l + i * gw, y: m.t, width: gw, height: ph, class: 'bar-hit' }, svg);
    hit.addEventListener('pointermove', (ev) => showTip(`<div class="t">${fmtDay(d)}</div>`
      + `<div class="r"><span><i class="swatch" style="background:var(--gauge-meas)"></i>Medido</span><b>${mm(meas[i])} mm</b></div>`
      + `<div class="r"><span><i class="swatch" style="background:var(--gauge-model)"></i>Modelo</span><b>${mm(model[i])} mm</b></div>`, ev));
    hit.addEventListener('pointerleave', hideTip);
  });
  if (maxBar && maxBar.v > 0) svgEl('text', { x: maxBar.x, y: y(maxBar.v) - 5, 'text-anchor': 'middle', class: 'val-label' }, svg).textContent = fmtMm(maxBar.v);
  chartBox.appendChild(svg);
  const tot = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
  $('#legend-gauge').innerHTML = `<span><i class="swatch" style="background:var(--gauge-meas)"></i>Medido · ${titleCase(sel.city)} ${sel.name} (${fmtMm(tot(meas))} mm)</span>`
    + `<span><i class="swatch" style="background:var(--gauge-model)"></i>Modelo · ${site.name} (${fmtMm(tot(model))} mm)</span>`;
}

// ---------------------------------------------------------------------------
// Modelos: previsão diária de chuva de cada modelo (tabela com escala de azul)
// ---------------------------------------------------------------------------
const MODELS = [
  // resolução da grade do modelo na região (fora da Europa/EUA/Japão valem as versões globais)
  { id: 'ecmwf_ifs', name: 'ECMWF', from: 'Europa', res: '9 km' }, // o mesmo dos gráficos
  { id: 'ecmwf_ifs025', name: 'ECMWF', from: 'Europa', res: '25 km' },
  { id: 'gfs_seamless', name: 'GFS', from: 'EUA', res: '25 km' },
  { id: 'icon_seamless', name: 'ICON', from: 'Alemanha', res: '13 km' },
  { id: 'jma_seamless', name: 'JMA', from: 'Japão', res: '55 km' },
];
state.models = null;
state.modelSite = SITES[0].id;

async function loadModels() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${SITES.map((x) => x.lat).join(',')}&longitude=${SITES.map((x) => x.lon).join(',')}`
    + `&daily=precipitation_sum&models=${MODELS.map((x) => x.id).join(',')}`
    + `&forecast_days=${FORECAST_DAYS}&timezone=${encodeURIComponent(TZ)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  let json = await res.json();
  if (!Array.isArray(json)) json = [json];
  const out = { days: json[0].daily.time, site: {} };
  SITES.forEach((x, i) => {
    out.site[x.id] = {};
    MODELS.forEach((mo) => { out.site[x.id][mo.id] = json[i].daily[`precipitation_sum_${mo.id}`] || []; });
  });
  // previsão oficial brasileira (CPTEC/INPE) para Iperó, via BrasilAPI
  try {
    const r = await fetch('https://brasilapi.com.br/api/cptec/v1/clima/previsao/2437/6');
    if (r.ok) {
      const j = await r.json();
      out.cptec = Object.fromEntries((j.clima || []).map((c) => [c.data, c]));
    }
  } catch { /* sem CPTEC: a tabela segue só com os modelos */ }
  state.models = out;
}

// azul sequencial do zero (claro) ao muito (escuro)
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
function seqColor(v) {
  if (v == null || v < 0.1) return null;
  const k = Math.min(SEQ.length - 1, Math.floor(Math.log2(v + 1) * 1.5));
  return SEQ[k];
}

function renderModels() {
  const seg = $('#models-site');
  seg.innerHTML = SITES.map((x) => `<button data-site="${x.id}" class="${x.id === state.modelSite ? 'on' : ''}">${x.name.split(' ')[0]}</button>`).join('');
  const wrap = $('#models-wrap');
  if (!state.models) {
    wrap.innerHTML = '<p class="note">carregando modelos…</p>';
    loadModels().then(renderModels).catch((err) => { wrap.innerHTML = `<p class="note">Não consegui carregar os modelos (${err.message}).</p>`; });
    return;
  }
  const { days, site } = state.models;
  const data = site[state.modelSite];
  const today = state.times[state.nowIdx].slice(0, 10);
  const cell = (v) => {
    const c = seqColor(v);
    const dark = c && SEQ.indexOf(c) >= 3;
    return `<td style="${c ? `background:${c};` : ''}${dark ? 'color:#fff;' : ''}">${fmtMm(v)}</td>`;
  };
  const mean = days.map((_, i) => {
    const v = MODELS.map((mo) => data[mo.id][i]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  const spread = days.map((_, i) => {
    const v = MODELS.map((mo) => data[mo.id][i]).filter((x) => x != null);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  });
  wrap.innerHTML = `<table class="models">
    <thead><tr><th>Modelo</th>${days.map((d) => `<th>${d === today ? 'hoje' : fmtDay(d)}</th>`).join('')}</tr></thead>
    <tbody>
      ${MODELS.map((mo) => `<tr><td>${mo.name} <span class="muted">${mo.from}</span> <small class="res">(res ${mo.res})</small></td>${days.map((_, i) => cell(data[mo.id][i])).join('')}</tr>`).join('')}
      <tr class="mean"><td><b>Média</b></td>${mean.map((v) => cell(v)).join('')}</tr>
      <tr class="spread"><td>Diferença entre modelos</td>${spread.map((v) => `<td>${fmtMm(v)} mm</td>`).join('')}</tr>
      ${state.models.cptec ? `<tr class="cptec"><td>CPTEC/INPE <span class="muted">Brasil</span> <small class="res">cidade</small></td>${days.map((d) => {
        const c = state.models.cptec[d];
        if (!c) return '<td class="muted">–</td>';
        const rain = /chuv|pancada|trovoada|garoa/i.test(c.condicao_desc);
        return `<td class="${rain ? 'cptec-rain' : ''}">${c.condicao_desc}</td>`;
      }).join('')}</tr>` : ''}
    </tbody></table>`;
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------
function renderTable() {
  const todayKey = state.times[state.nowIdx].slice(0, 10);
  const head = `<tr><th>Dia</th>${SITES.map((s) => `<th>${s.name} (mm)</th><th>horas c/ chuva</th>`).join('')}<th>Máx °C</th></tr>`;
  const rows = state.days.slice().reverse().map((d) => {
    const i = state.days.indexOf(d);
    const fc = d > todayKey;
    return `<tr class="${fc ? 'fc' : ''}"><td>${fmtDay(d)}${d === todayKey ? ' (hoje)' : fc ? ' (prev.)' : ''}</td>`
      + SITES.map((s) => `<td>${fmtMm(state.daily[s.id].sum[i])}</td><td>${state.daily[s.id].hours[i] ?? '–'}</td>`).join('')
      + `<td>${state.daily[SITES[0].id].tmax[i] != null ? Math.round(state.daily[SITES[0].id].tmax[i]) : '–'}</td></tr>`;
  }).join('');
  $('#table-wrap').innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
function presetList() {
  const list = [{ label: 'Agora', idx: state.nowIdx }];
  const today = state.times[state.nowIdx].slice(0, 10);
  const futureDays = state.days.filter((d) => d > today);
  futureDays.forEach((d, k) => {
    const idx = state.times.indexOf(`${d}T08:00`);
    if (idx < 0) return;
    const label = k === 0 ? 'Amanhã 8h' : `${WD[weekday(d)]} 8h`;
    list.push({ label, idx });
  });
  return list;
}

function renderControls() {
  const presets = presetList();
  const wrap = $('#presets');
  wrap.innerHTML = '';
  presets.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.label;
    if (p.idx === state.target) b.classList.add('on');
    b.addEventListener('click', () => setTarget(p.idx));
    wrap.appendChild(b);
  });
  const sl = $('#target-slider');
  sl.min = 71;
  sl.max = state.times.length - 1;
  sl.value = state.target;
  brushTo((state.target - sl.min) / Math.max(1, sl.max - sl.min), brush.dragging);
  const t = state.times[state.target];
  const rel = state.target === state.nowIdx ? 'agora' : state.target > state.nowIdx ? 'previsão' : 'passado';
  $('#target-label').textContent = `${fmtTime(t)} · ${rel}`;
}

function renderLegend() {
  $('#legend-daily').innerHTML = SITES.map((s) => `<span><i class="swatch" style="background:var(${s.color})"></i>${s.name}</span>`).join('')
    + '<span class="muted">claro: previsão</span>';
}

function setTarget(idx, light = false) {
  if (idx == null || idx < 0) return;
  state.target = Math.max(0, Math.min(state.times.length - 1, idx));
  if (light) {
    // durante arraste: atualiza só o essencial
    renderCards();
    renderControls();
    return;
  }
  renderAll();
}

function renderAll() {
  renderControls();
  renderCards();
  renderMap();
  renderDaily();
  renderHourly();
  renderCumulative();
  renderGauges();
  renderModels();
  renderTable();
}

async function refresh() {
  $('#updated').textContent = 'carregando…';
  try {
    await loadData();
    try { await loadGauges(); } catch (err) { console.warn('CEMADEN', err); state.stations = []; }
    mergeGauges();
    state.month = null;
    state.models = null;
    const now = new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    $('#updated').textContent = `atualizado ${now}`;
    renderAll();
  } catch (err) {
    console.error(err);
    $('#updated').textContent = '';
    $('#cards').innerHTML = `<div class="error">Não consegui baixar os dados de chuva (${err.message}). Tente atualizar daqui a pouco.</div>`;
  }
}

function initTheme() {
  const saved = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignora */ }
    if (state.times.length) renderAll();
  });
}

// ---------------------------------------------------------------------------
// Régua de tempo: escovinha deixando magnésio
// ---------------------------------------------------------------------------
const BRUSH_W = 84;
const BRUSH_TIP = 76; // posição das cerdas dentro da escovinha (px)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const brush = { p: null, raf: 0, lastPuff: 0, dragging: false, intro: true };

function setBrushP(p) {
  const el = $('#scrubber');
  const prev = brush.p;
  brush.p = p;
  el.style.setProperty('--p', p);
  if (prev != null && Math.abs(p - prev) > 0.0004) {
    chalkPuff(Math.sign(p - prev));
    if (Math.random() < 0.5) chalkPuff(Math.sign(p - prev), true);
  }
}

// Move a escovinha até p (0–1). Sem `instant`, ela escova até lá com easing.
function brushTo(p, instant) {
  cancelAnimationFrame(brush.raf);
  const el = $('#scrubber');
  if (brush.p == null) brush.p = 0; // primeira vez: escova desde o começo
  if (instant || reduceMotion) { setBrushP(p); return; }
  const from = brush.p;
  if (Math.abs(p - from) < 0.0004) return;
  const t0 = performance.now();
  const dur = (brush.intro ? 1400 : 350) + 1100 * Math.abs(p - from);
  brush.intro = false;
  el.classList.add('scrubbing');
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    setBrushP(from + (p - from) * e);
    if (k < 1) brush.raf = requestAnimationFrame(step);
    else { el.classList.remove('scrubbing'); chalkBurst(5); }
  };
  brush.raf = requestAnimationFrame(step);
}

// Nuvenzinha de magnésio saindo das cerdas
function chalkPuff(dir = 0, force = false) {
  if (reduceMotion) return;
  const now = performance.now();
  if (!force && now - brush.lastPuff < 40) return;
  brush.lastPuff = now;
  const el = $('#scrubber');
  if (el.querySelectorAll('.puff').length > 60) return;
  const x = brush.p * (el.clientWidth - BRUSH_W) + BRUSH_TIP;
  const d = document.createElement('span');
  d.className = 'puff';
  const size = 14 + Math.random() * 18;
  d.style.left = `${x + (Math.random() * 8 - 4)}px`;
  d.style.setProperty('--s', `${size}px`);
  d.style.setProperty('--dx', `${(-dir * (6 + Math.random() * 18)) + (Math.random() * 10 - 5)}px`);
  d.style.setProperty('--dy', `${-(8 + Math.random() * 22)}px`);
  d.style.setProperty('--d', `${0.6 + Math.random() * 0.6}s`);
  d.addEventListener('animationend', () => d.remove());
  el.appendChild(d);
}
function chalkBurst(n) {
  for (let i = 0; i < n; i++) chalkPuff((Math.random() - 0.5) * 2, true);
}

function initBrush() {
  const el = $('#scrubber');
  const sl = $('#target-slider');
  const start = () => { brush.dragging = true; el.classList.add('scrubbing'); };
  const end = () => { brush.dragging = false; el.classList.remove('scrubbing'); };
  sl.addEventListener('pointerdown', start);
  sl.addEventListener('keydown', start);
  sl.addEventListener('pointerup', end);
  sl.addEventListener('keyup', end);
  sl.addEventListener('blur', end);
  // de vez em quando: batidinha que solta magnésio
  if (!reduceMotion) {
    setInterval(() => {
      if (document.hidden || brush.dragging || brush.p == null || el.classList.contains('scrubbing')) return;
      el.classList.add('tap');
      setTimeout(() => chalkBurst(6), 250);
      setTimeout(() => el.classList.remove('tap'), 720);
    }, 7000);
  }
}

function init() {
  initTheme();
  if (typeof Scene !== 'undefined') Scene.init();
  initMap();
  initBrush();
  renderLegend();

  $('#range').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    document.querySelectorAll('#range button').forEach((x) => x.classList.toggle('on', x === b));
    state.pastDays = Number(b.dataset.days);
    state.target = null;
    await refresh();
  });
  $('#target-slider').addEventListener('input', (ev) => setTarget(Number(ev.target.value), true));
  $('#target-slider').addEventListener('change', (ev) => setTarget(Number(ev.target.value)));
  $('#refresh').addEventListener('click', refresh);
  $('#models-site').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    state.modelSite = b.dataset.site;
    renderModels();
  });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (state.times.length) { renderDaily(); renderHourly(); renderCumulative(); renderGauges(); } }, 150);
  });

  refresh();
}

init();
