// LAVRA — motor acústico completo (Web Audio API):
//   · física de onda sonora real: atenuação 1/r suave até o horizonte da fonte (zero ruído fora do espaço),
//     atraso pela velocidade do som (343 m/s no ar, 1480 m/s na água), absorção atmosférica de agudos,
//     oclusão por blocos sólidos entre ouvido e fonte e efeito Doppler clássico em tempo real;
//   · deduplicação espacial/temporal (sem sobreposições ou clipping em colapsos/explosões);
//   · emissores espaciais 3D contínuos (máquinas próprias e remotas, projéteis, cachoeiras, fogueiras, portais);
//   · efeitos por material (nativos + todos os blocos do Minecraft via mc-sound.js), vozes, foley e música harmônica.
import { createWaterTransition } from './water-transition.js';
import {
  propagationDelay, waveAttenuation, dopplerShift, airAbsorptionCutoff, stereoPan, measureOcclusion, seaWaveLevel,
  TIDEWATER_BY_FILE, tidewaterSliceGain,
} from './physics.js';

const MATS = {
  stone: { f: 1900, q: 0.9, d: 0.055, v: 0.5, thump: 150, tv: 0.5, kind: 'hard' },
  dirt: { f: 520, q: 0.8, d: 0.1, v: 0.55, thump: 95, tv: 0.6, kind: 'soft' },
  grass: { f: 2400, q: 0.7, d: 0.13, v: 0.3, thump: 90, tv: 0.45, kind: 'swish' },
  sand: { f: 3200, q: 0.5, d: 0.16, v: 0.3, thump: 80, tv: 0.3, kind: 'swish' },
  wetsand: { f: 2400, q: 0.7, d: 0.14, v: 0.38, thump: 95, tv: 0.4, kind: 'swish' },
  gravel: { f: 1500, q: 1.0, d: 0.1, v: 0.45, thump: 120, tv: 0.4, kind: 'crunch' },
  wood: { f: 380, q: 6, d: 0.08, v: 0.8, thump: 190, tv: 0.5, kind: 'knock' },
  leaves: { f: 4200, q: 0.5, d: 0.14, v: 0.3, thump: 0, tv: 0, kind: 'swish' },
  glass: { f: 5200, q: 3, d: 0.05, v: 0.5, thump: 0, tv: 0, kind: 'ring' },
  snow: { f: 1100, q: 0.9, d: 0.12, v: 0.45, thump: 85, tv: 0.35, kind: 'crunch' },
  metal: { f: 2600, q: 2, d: 0.05, v: 0.4, thump: 170, tv: 0.35, kind: 'clang' },
  plant: { f: 3600, q: 0.6, d: 0.07, v: 0.25, thump: 0, tv: 0, kind: 'swish' },
  water: { f: 900, q: 0.8, d: 0.2, v: 0.4, thump: 0, tv: 0, kind: 'splash' },
};
const LOOP_KEYS = new Set([
  'ambiente.vento', 'ambiente.ventoforte', 'ambiente.arqueda', 'ambiente.mata', 'ambiente.agua', 'ambiente.cachoeira',
  'ambiente.submerso', 'ambiente.bolha', 'ambiente.chuva', 'ambiente.passaros', 'ambiente.grilos', 'ambiente.cigarras',
  'ambiente.fogo', 'ambiente.portal', 'ambiente.motor', 'ambiente.carro', 'ambiente.helice',
  'ambiente.jato', 'ambiente.queimador', 'ambiente.barco', 'ambiente.fundo', 'ambiente.zumbido',
  'ambiente.surf_far', 'ambiente.wind', 'ambiente.palms', 'ambiente.pier_lap', 'ambiente.under_reef',
  'ambiente.whale_song', 'ambiente.boat_engine', 'ambiente.boat_lap', 'ambiente.boat_rush',
]);
const AMB_MUDO = new Set(['whale_blow', 'gull', 'tern', 'surf_crash', 'surf_wash', 'surf_backwash', 'gust', 'whisper']);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const MAX_VOICES = { sfx: 28, amb: 32, mus: 72 };
const DEDUP_MS = { step: 80, dig: 65, break: 42, place: 42, hit: 60, boom: 55, submerge: 160, emerge: 160 };

function seamlessLoop(ctx, buffer) {
  const fade = Math.min(Math.floor(ctx.sampleRate * 0.25), Math.floor(buffer.length / 4));
  if (fade < 2) return buffer;
  const size = buffer.length - fade;
  const out = ctx.createBuffer(buffer.numberOfChannels, size, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel), data = out.getChannelData(channel);
    data.set(input.subarray(fade));
    for (let i = 0; i < fade; i++) {
      const blend = i / (fade - 1), at = size - fade + i;
      data[at] = data[at] * (1 - blend) + input[i] * blend;
    }
  }
  return out;
}

export function createAudio(getVolume, getMusic = () => 0) {
  let ctx = null, master = null, filter = null, send = null, busSfx = null, busAmb = null, busMus = null;
  let white = null, pink = null;
  const samples = new Map();
  const streams = new Map();
  const ear = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 1, rz: 0, underwater: false };
  const beds = {};
  const emitters = new Map();
  const recent = new Map();
  const pickHist = new Map();
  let stepSide = 1;
  const voices = { sfx: 0, amb: 0, mus: 0 }, routes = new WeakMap();
  let t0 = 0, bedsReady = false, worldProbe = null;
  const ev = { bird: 4, cricket: 2, drip: 3, whisper: 6, frog: 8, owl: 11, gull: 7, tern: 5, surf: 1.8, whale: 12, gust: 6, bubble: 2.5, music: 24 };
  const surfQueue = [];
  let surfWaveIdx = 0;
  const gustState = { v: 0.45, target: 0.6, t: 0 };
  const decodedFiles = new Map();
  let engineNodes = null, musicEl = null, musicGain = null;
  let waterTransition = createWaterTransition();

  // ---- montagem ----------------------------------------------------------------------------------------------
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch { return false; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(comp).connect(ctx.destination);
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000; filter.Q.value = 0.4;
    filter.connect(master);
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.42)) * (i < 400 ? i / 400 : 1);
    }
    conv.buffer = ir;
    send = ctx.createGain(); send.gain.value = 0.06;
    filter.connect(send).connect(conv).connect(master);
    busSfx = ctx.createGain(); busAmb = ctx.createGain(); busMus = ctx.createGain();
    for (const [node, bus] of [[busSfx, 'sfx'], [busAmb, 'amb'], [busMus, 'mus']]) routes.set(node, { bus });
    busAmb.gain.value = 0; // MUDO de emergência (Kadmus, 19/11): ambiente silenciado até identificar o som
    busSfx.connect(filter); busAmb.connect(filter);
    busMus.connect(master);
    const musSend = ctx.createGain(); musSend.gain.value = 0.35;
    busMus.connect(musSend).connect(conv);

    white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    pink = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    let d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    d = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    t0 = ctx.currentTime;
    loadManifest();
    return true;
  }
  const unlock = () => { if (ensure() && ctx.state === 'suspended' && !document.hidden) ctx.resume(); };
  for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, unlock, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });

  // ---- sons gravados -------------------------------------------------------------------------------------------
  const AUDIO_REV = '20261119-tw';
  function fetchAndDecode(file) {
    let p = decodedFiles.get(file);
    if (!p) {
      p = fetch('audio/' + encodeURIComponent(file) + '?v=' + AUDIO_REV)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => ctx.decodeAudioData(ab));
      decodedFiles.set(file, p);
    }
    return p;
  }

  async function loadManifest() {
    let list;
    try { const r = await fetch('audio/sons.json', { cache: 'no-cache' }); if (!r.ok) return; list = await r.json(); } catch { return; }
    for (const [key, files] of Object.entries(list || {})) {
      const arr = (Array.isArray(files) ? files : [files]).filter(f => typeof f === 'string' && /^[\w .()\-+]+\.(mp3|ogg|oga|wav|flac|m4a|opus|webm)$/i.test(f));
      if (!arr.length) continue;
      if (key === 'musica' || key.startsWith('musica.')) streams.set(key, arr.map(f => 'audio/' + encodeURIComponent(f) + '?v=' + AUDIO_REV));
      else catalogo.set(key, { files: arr, i: 0, proxima: 0, pendente: false });
    }
    for (const k of pedidosIniciais) pedirSom(k);
    pedidosIniciais.clear();
  }
  // Decodificar as centenas de gravações na entrada atrasava os quadros e ocupava a memória.
  // Cada fonte pede a primeira amostra quando audível; os usos seguintes trazem as variantes.
  const catalogo = new Map(), pedidosIniciais = new Set(), fila = [];
  let decodificando = 0;
  function pedirSom(key, variantes = false) {
    const item = catalogo.get(key);
    if (!item) { if (!catalogo.size) pedidosIniciais.add(key); return samples.get(key); }
    const agora = performance.now();
    if (!item.pendente && item.i < item.files.length && (!item.i || variantes && agora >= item.proxima)) {
      item.pendente = true;
      fila.push({ key, item });
      drenarSons();
    }
    return samples.get(key);
  }
  async function drenarSons() {
    if (decodificando >= 2 || !fila.length) return;
    decodificando++;
    try {
      while (fila.length) {
        const { key, item } = fila.shift();
        const file = item.files[item.i++];
        try {
          const rawBuf = await fetchAndDecode(file);
          const tw = TIDEWATER_BY_FILE.get(file);
          if (!samples.has(key)) samples.set(key, []);
          const dst = samples.get(key);
          if (tw && Array.isArray(tw.slices) && tw.slices.length && !LOOP_KEYS.has(key)) {
            for (let i = 0; i < tw.slices.length; i++) {
              const [offset, duration] = tw.slices[i];
              dst.push({ buffer: rawBuf, offset, duration, gain: tidewaterSliceGain(tw.lufs, i), sliceIndex: i, file });
            }
          } else {
            const buffer = (LOOP_KEYS.has(key) && !(tw && tw.loop)) ? seamlessLoop(ctx, rawBuf) : rawBuf;
            dst.push(buffer);
          }
          if ((key === 'ambiente.' + (engineNodes?.kind || 'motor') || (key === 'ambiente.boat_engine' && engineNodes?.kind === 'barco')) && engineNodes) swapEngine(engineNodes.kind);
          else if (key.startsWith('ambiente.') && bedsReady) swapBed(key.slice(9));
        } catch { console.warn('[som] não deu para abrir', file); }
        finally { item.pendente = false; item.proxima = performance.now() + 1500; }
      }
    } finally { decodificando--; }
  }

  function pickVariant(key, list) {
    const n = list.length;
    if (n <= 1) return 0;
    let hist = pickHist.get(key);
    if (!hist) { hist = []; pickHist.set(key, hist); }
    const keep = Math.min(12, n - 1);
    let idx = (Math.random() * n) | 0;
    for (let tries = 0; tries < 8 && hist.includes(idx); tries++) idx = (Math.random() * n) | 0;
    if (hist.includes(idx)) {
      const cand = [];
      for (let i = 0; i < n; i++) if (!hist.includes(i)) cand.push(i);
      if (cand.length) idx = cand[(Math.random() * cand.length) | 0];
    }
    hist.push(idx);
    if (hist.length > keep) hist.shift();
    return idx;
  }

  function sample(keys, dest, vol, pitch, delay = 0, maxDur = 0, fx = null) {
    for (const k of keys) {
      const list = pedirSom(k, true);
      if (!list || !list.length) continue;
      if (typeof dest === 'function') dest = dest();
      if (!dest) return false;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      const item = list[pickVariant(k, list)];
      const buf = item?.buffer || item;
      if (!buf) continue;
      const sliceOffset = item?.offset || 0;
      const sliceDur = item?.duration || 0;
      const effVol = vol * (item?.gain ?? 1);
      src.buffer = buf;
      src.playbackRate.value = clamp(pitch, 0.35, 2.5);
      g.gain.value = effVol;
      const extra = [];
      let head = src;
      if (fx?.eqFreq && fx?.eqGain) {
        const eq = ctx.createBiquadFilter();
        eq.type = 'peaking'; eq.frequency.value = fx.eqFreq; eq.Q.value = 1.0; eq.gain.value = fx.eqGain;
        head.connect(eq); head = eq; extra.push(eq);
      }
      if (fx?.lpFreq && fx.lpFreq < 18000) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = fx.lpFreq; lp.Q.value = 0.5;
        head.connect(lp); head = lp; extra.push(lp);
      }
      if (fx?.panVal && ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = clamp(fx.panVal, -0.92, 0.92);
        head.connect(sp); head = sp; extra.push(sp);
      }
      head.connect(g).connect(dest);
      if (voice(src, dest, g, ...extra)) {
        const t = ctx.currentTime + Math.max(0, delay);
        if (sliceDur > 0) {
          const dur = maxDur > 0 ? Math.min(sliceDur, maxDur) : sliceDur;
          src.start(t, sliceOffset, dur);
        } else if (maxDur > 0 && buf.duration > maxDur) {
          g.gain.setValueAtTime(effVol, t);
          g.gain.setValueAtTime(effVol, t + Math.max(0.02, maxDur - 0.06));
          g.gain.exponentialRampToValueAtTime(0.0008, t + maxDur);
          src.start(t, 0, maxDur);
        } else if (maxDur > 0) {
          src.start(t, 0, buf.duration);
        } else {
          src.start(t);
        }
      }
      return true;
    }
    return false;
  }

  // ---- peças do sintetizador & controle de vozes ------------------------------------------------------------
  function voice(node, dest, ...owned) {
    const route = routes.get(dest) || { bus: 'sfx' }, bus = route.bus;
    if (voices[bus] >= MAX_VOICES[bus]) { node.disconnect(); for (const n of owned) n.disconnect(); return false; }
    voices[bus]++;
    if (route.nodes) route.active++;
    node.onended = () => {
      voices[bus]--;
      node.disconnect();
      for (const n of owned) n.disconnect();
      if (route.nodes && --route.active === 0) for (const n of route.nodes) n.disconnect();
    };
    return true;
  }
  function burst(dest, at, freq, dur, vol, type = 'bandpass', q = 1.2, attack = 0.003, buf = white) {
    const t = ctx.currentTime + at, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + attack + dur);
    src.connect(f).connect(g).connect(dest);
    if (voice(src, dest, f, g)) { src.start(t, Math.random() * 1.5); src.stop(t + attack + dur + 0.03); }
    return f;
  }
  function tone(dest, at, freq, dur, vol, type = 'sine', slide = 0, attack = 0.003) {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + attack + dur);
    o.connect(g).connect(dest);
    if (voice(o, dest, g)) { o.start(t); o.stop(t + attack + dur + 0.03); }
    return o;
  }

  // Cadeia espacial 3D: atenuação 1/r, corte suave no horizonte, absorção atmosférica, oclusão por blocos e Doppler.
  function at(pos, opts = 1) {
    if (!pos) return { dest: busSfx, delay: 0, doppler: 1 };
    const o = typeof opts === 'number' ? { reach: opts } : opts;
    const reach = o.reach ?? 1;
    const maxDist = o.maxDist ?? 64 * reach;
    const refDist = o.refDist ?? 3.5 * reach;
    const earPos = [ear.x, ear.y, ear.z];
    const d = Math.hypot(pos[0] - ear.x, pos[1] - ear.y, pos[2] - ear.z);
    let gain = waveAttenuation(d, { refDist, maxDist });
    if (gain <= 0.002) return null;
    const occ = worldProbe ? measureOcclusion(worldProbe.getBlock, earPos, pos, worldProbe) : 0;
    gain *= 1 - 0.68 * occ;
    if (gain <= 0.002) return null;

    const g = ctx.createGain();
    const route = { bus: 'sfx', nodes: [g], active: 0 };
    routes.set(g, route);
    g.gain.value = gain;

    const cut = airAbsorptionCutoff(d, ear.underwater, occ);
    let tail = g;
    if (cut < 17500) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      lp.Q.value = 0.4;
      route.nodes.push(lp);
      tail.connect(lp);
      tail = lp;
    }
    if (ctx.createStereoPanner && d > 0.35) {
      const p = ctx.createStereoPanner();
      route.nodes.push(p);
      p.pan.value = stereoPan(earPos, [ear.rx, ear.rz], pos);
      tail.connect(p).connect(busSfx);
    } else {
      tail.connect(busSfx);
    }
    const delay = o.noDelay ? 0 : (o.delay ?? propagationDelay(d, ear.underwater));
    const doppler = dopplerShift(earPos, [ear.vx, ear.vy, ear.vz], pos, o.vel || null, ear.underwater);
    return { dest: g, delay, doppler };
  }

  // ---- efeitos sintetizados (fallback quando sem gravação ou carregando) ------------------------------------
  function step(dest, m, vol, pitch, at0 = 0) {
    if (m.thump) tone(dest, at0, m.thump * 1.5 * pitch, 0.07, m.tv * 0.45 * vol, 'sine', 0.45);
    const soft = m.kind === 'swish';
    burst(dest, at0, m.f * pitch, m.d, m.v * 0.5 * vol, 'bandpass', m.q, soft ? 0.018 : 0.003);
    if (m.kind === 'crunch') for (let i = 0; i < 3; i++) burst(dest, at0 + rnd(0.01, 0.07), m.f * rnd(0.7, 1.6), 0.03, m.v * 0.3 * vol, 'bandpass', 2);
    else if (m.kind === 'knock') tone(dest, at0, m.f * pitch, 0.06, 0.18 * vol, 'triangle', 0.8);
    else if (m.kind === 'clang') for (const r of [1, 2.76, 5.4]) tone(dest, at0, 420 * r * pitch, 0.22 / r + 0.05, 0.05 * vol, 'sine');
    else if (m.kind === 'ring') tone(dest, at0, m.f * 0.5 * pitch, 0.05, 0.08 * vol, 'sine');
    else if (m.kind === 'splash') splash(dest, 0.35 * vol, false, at0);
  }
  function breakBlock(dest, m, vol, pitch, at0 = 0) {
    burst(dest, at0, m.f * 0.9 * pitch, m.d * 1.8, m.v * 1.0 * vol, 'bandpass', m.q);
    tone(dest, at0, (m.thump || 110) * 1.4 * pitch, 0.11, 0.42 * vol, 'triangle', 0.4);
    const bits = m.kind === 'swish' ? 2 : 5;
    for (let i = 0; i < bits; i++) burst(dest, at0 + rnd(0.03, 0.26), m.f * rnd(0.6, 1.5), rnd(0.02, 0.06), m.v * rnd(0.12, 0.3) * vol, 'bandpass', 1.8);
    if (m.kind === 'ring') for (let i = 0; i < 9; i++) tone(dest, at0 + rnd(0, 0.18), rnd(2200, 7600), rnd(0.12, 0.4), rnd(0.03, 0.09) * vol, 'sine');
    else if (m.kind === 'knock') { tone(dest, at0, m.f * pitch, 0.12, 0.3 * vol, 'triangle', 0.6); burst(dest, at0, 2600, 0.03, 0.4 * vol, 'highpass', 0.7); }
    else if (m.kind === 'clang') for (const r of [1, 2.76, 5.4, 8.9]) tone(dest, at0, 380 * r * pitch, 0.7 / r + 0.1, 0.1 * vol, 'sine');
    else if (m.kind === 'swish') burst(dest, at0, m.f, 0.24, m.v * 0.5 * vol, 'highpass', 0.6, 0.03);
    else if (m.kind === 'splash') splash(dest, 0.6 * vol, false, at0);
  }
  function place(dest, m, vol, pitch, at0 = 0) {
    tone(dest, at0, (m.thump || 130) * 1.7 * pitch, 0.06, 0.34 * vol, 'triangle', 0.55);
    burst(dest, at0, m.f * 1.1 * pitch, m.d * 0.9, m.v * 0.6 * vol, 'bandpass', m.q);
    if (m.kind === 'knock') tone(dest, at0 + 0.005, m.f * 1.2 * pitch, 0.05, 0.2 * vol, 'triangle', 0.8);
    else if (m.kind === 'clang') for (const r of [1, 2.76]) tone(dest, at0, 460 * r * pitch, 0.25 / r, 0.07 * vol, 'sine');
    else if (m.kind === 'ring') tone(dest, at0, 3100 * pitch, 0.07, 0.07 * vol, 'sine');
  }
  function splash(dest, vol, leaving = false, at0 = 0) {
    const list = pedirSom('ambiente.agua');
    if (list?.length) {
      const src = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime + at0;
      const raw = list[(Math.random() * list.length) | 0];
      src.buffer = raw?.buffer || raw;
      const duration = Math.min(src.buffer.duration, leaving ? 0.42 : 0.72), attack = leaving ? 0.045 : 0.018;
      const peak = Math.min(attack, duration * 0.2);
      const offset = rnd(0, Math.max(0, src.buffer.duration - duration));
      let energy = 0, count = 0;
      for (let c = 0; c < src.buffer.numberOfChannels; c++) {
        const data = src.buffer.getChannelData(c);
        for (let i = Math.floor(offset * src.buffer.sampleRate); i < (offset + duration) * src.buffer.sampleRate && i < data.length; i += 32) { energy += data[i] * data[i]; count++; }
      }
      const gain = Math.min(6, 0.1 / Math.max(0.01, Math.sqrt(energy / Math.max(1, count))));
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * gain, t + peak);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(g).connect(dest);
      if (voice(src, dest, g)) src.start(t, offset, duration);
      return;
    }
    const duration = leaving ? 0.25 : 0.42;
    const f = burst(dest, at0, leaving ? 1100 : 1800, duration, 0.18 * vol, 'lowpass', 0.45, 0.025, pink);
    f.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + at0 + duration);
    burst(dest, at0 + 0.025, 3400, duration * 0.6, 0.045 * vol, 'highpass', 0.5, 0.025);
  }
  function boom(dest, vol, pitch, at0 = 0) {
    tone(dest, at0, 95 * pitch, 0.9, 1.0 * vol, 'sine', 0.3);
    burst(dest, at0, 160 * pitch, 1.1, 1.2 * vol, 'lowpass', 0.7, 0.004, pink);
    burst(dest, at0, 2600, 0.22, 0.4 * vol, 'bandpass', 0.6);
    for (let i = 0; i < 6; i++) burst(dest, at0 + rnd(0.15, 0.9), rnd(500, 2600), rnd(0.03, 0.08), rnd(0.08, 0.2) * vol, 'bandpass', 1.5);
  }
  function growl(dest, vol, pitch, at0 = 0) {
    const t = ctx.currentTime + at0, dur = rnd(0.7, 1.3), o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(74 * pitch, t); o.frequency.linearRampToValueAtTime(58 * pitch, t + dur);
    lfo.frequency.value = rnd(22, 31); lg.gain.value = 14 * pitch; lfo.connect(lg).connect(o.frequency);
    f.type = 'lowpass'; f.Q.value = 5; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(820, t + dur * 0.4); f.frequency.linearRampToValueAtTime(260, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * vol, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(dest);
    if (voice(o, dest, lfo, lg, f, g)) { o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05); }
    burst(dest, at0, 900 * pitch, dur * 0.8, 0.12 * vol, 'bandpass', 1.2, 0.1);
  }
  function omen(dest, vol, pitch, at0 = 0) {
    [220, 277.2, 329.6, 440, 554.4, 659.3].forEach((f, i) => {
      tone(dest, at0 + i * 0.14, f * pitch, 3.4, 0.17 * vol, 'sine', 0, 0.7);
      tone(dest, at0 + i * 0.14, f * pitch * 1.004, 3.4, 0.11 * vol, 'triangle', 0, 0.9);
    });
    burst(dest, at0 + 0.2, 5200, 2.6, 0.03 * vol, 'bandpass', 3, 1.0);
  }
  function swimStroke(dest, vol, pitch, at0 = 0) {
    const list = pedirSom('ambiente.submerso') || pedirSom('ambiente.agua');
    if (list?.length) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + at0;
      const raw = list[(Math.random() * list.length) | 0];
      src.buffer = raw?.buffer || raw;
      src.playbackRate.value = clamp(pitch, 0.75, 1.3);
      f.type = 'lowpass'; f.frequency.value = 980 * pitch; f.Q.value = 0.5;
      const duration = Math.min(src.buffer.duration, 0.36);
      const offset = rnd(0, Math.max(0, src.buffer.duration - duration));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.32 * vol, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(f).connect(g).connect(dest);
      if (voice(src, dest, f, g)) src.start(t, offset, duration);
      return;
    }
    const f = burst(dest, at0, 700 * pitch, 0.32, 0.22 * vol, 'bandpass', 0.8, 0.06, pink);
    f.frequency.exponentialRampToValueAtTime(1500 * pitch, ctx.currentTime + at0 + 0.3);
  }

  const SYNTH = {
    step: (d, v, p, m, a) => step(d, m, v, p, a),
    step_sand: (d, v, p, m, a) => step(d, MATS.sand, v, p, a),
    step_wetsand: (d, v, p, m, a) => step(d, MATS.wetsand, v, p, a),
    step_water: (d, v, p, m, a) => step(d, MATS.water, v, p, a),
    step_wood: (d, v, p, m, a) => step(d, MATS.wood, v, p, a),
    dig: (d, v, p, m, a) => step(d, m, v * 0.75, p * 1.1, a),
    break: (d, v, p, m, a) => breakBlock(d, m, v, p, a),
    place: (d, v, p, m, a) => place(d, m, v, p, a),
    land: (d, v, p, m, a) => { burst(d, a, 240, 0.08, 0.32 * v, 'lowpass', 0.6, 0.002, pink); step(d, m, 0.85 * v, 0.86, a); step(d, m, 0.55 * v, 0.94, a + 0.042); },
    splash: (d, v, p, m, a) => splash(d, v, false, a),
    big_splash: (d, v, p, m, a) => splash(d, Math.min(1.2, v * 1.25), false, a),
    submerge: (d, v, p, m, a) => splash(d, v, false, a),
    emerge: (d, v, p, m, a) => splash(d, v, true, a),
    'water-enter': (d, v, p, m, a) => splash(d, v, false, a),
    'water-exit': (d, v, p, m, a) => splash(d, v, true, a),
    swim: (d, v, p, m, a) => swimStroke(d, v, p, a),
    uw_swim: (d, v, p, m, a) => swimStroke(d, v * 0.9, p * 0.85, a),
    surf_crash: (d, v, p, m, a) => { burst(d, a, 280 * p, 1.4, 0.35 * v, 'lowpass', 0.6, 0.18, pink); burst(d, a + 0.12, 1100 * p, 1.1, 0.2 * v, 'bandpass', 0.5, 0.22); },
    surf_wash: (d, v, p, m, a) => { burst(d, a, 950 * p, 1.2, 0.22 * v, 'bandpass', 0.5, 0.25, pink); },
    surf_backwash: (d, v, p, m, a) => { burst(d, a, 1600 * p, 1.4, 0.16 * v, 'highpass', 0.5, 0.35, pink); },
    hull_slap: (d, v, p, m, a) => { tone(d, a, 140 * p, 0.09, 0.38 * v, 'triangle', 0.5); burst(d, a, 800 * p, 0.12, 0.25 * v, 'bandpass', 0.8); },
    jump: (d, v, p, m, a) => { burst(d, a, 520 * p, 0.08, 0.18 * v, 'bandpass', 0.8); step(d, m, 0.35 * v, 1.08, a); },
    fall: (d, v, p, m, a) => { burst(d, a, 190, 0.18, 0.55 * v, 'lowpass', 0.7, 0.002, pink); step(d, m, 0.9 * v, 0.78, a); },
    gust: (d, v, p, m, a) => { burst(d, a, 380 * p, 1.1, 0.25 * v, 'bandpass', 0.6, 0.3, pink); },
    bubble: (d, v, p, m, a) => { tone(d, a, rnd(320, 620) * p, 0.07, 0.2 * v, 'sine', 1.6, 0.004); tone(d, a + 0.08, rnd(480, 880) * p, 0.06, 0.16 * v, 'sine', 1.5, 0.004); },
    breath: (d, v, p, m, a) => { burst(d, a, 620 * p, 0.28, 0.12 * v, 'bandpass', 0.9, 0.08, pink); },
    gasp: (d, v, p, m, a) => { burst(d, a, 920 * p, 0.26, 0.24 * v, 'bandpass', 0.8, 0.03, pink); },
    exhale: (d, v, p, m, a) => { burst(d, a, 480 * p, 0.22, 0.18 * v, 'bandpass', 0.8, 0.04, pink); },
    boom: (d, v, p, m, a) => boom(d, v, p, a),
    thunder: (d, v, p, m, a) => boom(d, v, p, a),
    shot: (d, v, p, m, a) => { tone(d, a, 210 * p, 0.2, 0.7 * v, 'triangle', 0.3); burst(d, a, 1400, 0.16, 0.7 * v, 'bandpass', 0.7); burst(d, a, 200, 0.4, 0.6 * v, 'lowpass', 0.7, 0.003, pink); },
    hit: (d, v, p, m, a) => { burst(d, a, 1100 * p, 0.07, 0.5 * v, 'bandpass', 1.2); tone(d, a, 180 * p, 0.1, 0.4 * v, 'triangle', 0.5); },
    hurt: (d, v, p, m, a) => { tone(d, a, 240 * p, 0.22, 0.4 * v, 'sawtooth', 0.55); burst(d, a, 600, 0.12, 0.4 * v, 'lowpass', 0.8); },
    growl: (d, v, p, m, a) => growl(d, v, p, a),
    omen: (d, v, p, m, a) => omen(d, v, p, a),
    whisper: (d, v, p, m, a) => { const f = burst(d, a, rnd(700, 1500), rnd(1.2, 2.4), 0.12 * v, 'bandpass', 7, 0.4, pink); f.frequency.linearRampToValueAtTime(rnd(900, 2400), ctx.currentTime + a + 1.6); },
    portal: (d, v, p, m, a) => { const f = burst(d, a, 200 * p, 2.2, 0.5 * v, 'bandpass', 4, 0.5, pink); f.frequency.exponentialRampToValueAtTime(2400 * p, ctx.currentTime + a + 2.2); tone(d, a, 55 * p, 2.4, 0.4 * v, 'sine', 2, 0.6); },
    tick: (d, v, p, m, a) => { tone(d, a, 1500 * p, 0.035, 0.1 * v, 'sine', 0.8, 0.001); },
    pegar: (d, v, p, m, a) => { tone(d, a, 1500 * p, 0.035, 0.1 * v, 'sine', 0.8, 0.001); },
    open: (d, v, p, m, a) => { tone(d, a, 660 * p, 0.09, 0.09 * v, 'sine'); tone(d, a + 0.06, 990 * p, 0.12, 0.08 * v, 'sine'); },
    close: (d, v, p, m, a) => { tone(d, a, 880 * p, 0.08, 0.08 * v, 'sine'); tone(d, a + 0.05, 590 * p, 0.12, 0.08 * v, 'sine'); },
  };

  function allowEvent(name, material, pos) {
    const canon = name === 'water-enter' ? 'submerge' : name === 'water-exit' ? 'emerge' : name.startsWith('step_') ? 'step' : name;
    const minMs = DEDUP_MS[canon];
    if (!minMs) return true;
    const now = performance.now();
    const cell = pos ? `${Math.round(pos[0])},${Math.round(pos[1])},${Math.round(pos[2])}` : 'self';
    const k = `${canon}:${material}:${cell}`;
    const last = recent.get(k);
    if (last !== undefined && now - last < minMs) return false;
    recent.set(k, now);
    if (recent.size > 256) {
      for (const [rk, rt] of recent) if (now - rt > 500) recent.delete(rk);
    }
    return true;
  }

  // Toca um som no mundo (pos != null) ou na cabeça (pos == null).
  function play(name, vol = 1, pitch = 1, material = 'stone', pos = null, opts = null) {
    if (name.startsWith('ambiente.') || AMB_MUDO.has(name)) return; // MUDO de emergência (19/11)
    const v = getVolume();
    if (v <= 0 || !ensure() || ctx.state !== 'running' || voices.sfx >= MAX_VOICES.sfx) return;
    if (!allowEvent(name, material, pos)) return;
    const reach = opts?.reach ?? (name === 'thunder' ? 5.0 : name === 'boom' ? 2.6 : name === 'surf_crash' ? 2.2 : ['shot', 'growl', 'portal', 'gull', 'tern', 'whale_blow'].includes(name) ? 1.6 : 1);
    const refDist = opts?.refDist ?? (name === 'thunder' ? 36 : name === 'boom' ? 14 : name === 'surf_crash' ? 10 : ['gull', 'tern', 'whale_blow'].includes(name) ? 9 : 3.5);
    const spatial = at(pos, { reach, refDist, vel: opts?.vel, delay: opts?.delay, noDelay: opts?.noDelay });
    if (!spatial) return;

    const keys = [name + '_' + material, name + '.' + material, name];
    if (name === 'water-enter' || name === 'submerge') keys.unshift('submerge', 'water-enter', 'mar.splash', 'splash');
    else if (name === 'water-exit' || name === 'emerge') keys.unshift('emerge', 'water-exit');
    else if (name === 'splash') keys.unshift('mar.splash', 'splash');
    else if (name === 'big_splash') keys.unshift('big_splash', 'mar.splash', 'splash');
    else if (name === 'swim') keys.unshift(...(ear.underwater ? ['uw_swim', 'mar.swim', 'swim'] : ['mar.swim', 'swim']));
    else if (name === 'uw_swim') keys.unshift('uw_swim', 'mar.swim', 'swim');
    else if (name === 'gull') keys.push('ambiente.gaivota');
    else if (name === 'whale_blow') keys.push('ambiente.baleia');
    else if (name === 'dig') keys.push('step_' + material, 'step.' + material, 'hit');
    else if (name === 'thunder') keys.push('boom');
    const maxDur = 0;
    const effPitch = pitch * spatial.doppler;
    if (name === 'step' || name.startsWith('step_')) {
      stepSide = -stepSide;
      const sidePitch = stepSide < 0 ? 0.97 : 1.015;
      const fx = {
        eqFreq: rnd(900, 2600),
        eqGain: rnd(-2.4, 2.4),
        lpFreq: rnd(4800, 9600),
        panVal: pos ? 0 : stepSide * 0.14,
      };
      if (sample(keys, spatial.dest, vol * rnd(0.84, 1.02), effPitch * sidePitch * rnd(0.94, 1.06), spatial.delay, 0, fx)) return;
    } else if (name === 'land') {
      const landKeys = ['land.' + material, 'step_' + material, 'step.' + material, 'land'];
      const stepKeys = ['step_' + material, 'step.' + material, 'land'];
      const hit1 = sample(landKeys, spatial.dest, vol * 0.94, effPitch * rnd(0.84, 0.90), spatial.delay, 0, { eqFreq: 880, eqGain: -1.8, lpFreq: 4200, panVal: pos ? 0 : -0.10 });
      const hit2 = sample(stepKeys, spatial.dest, vol * 0.60, effPitch * rnd(0.92, 0.99), spatial.delay + rnd(0.036, 0.052), 0, { eqFreq: 1650, eqGain: 1.0, lpFreq: 5400, panVal: pos ? 0 : 0.10 });
      if (vol > 0.48 && material !== 'sand' && material !== 'wetsand' && material !== 'snow' && material !== 'leaves') {
        sample(['land'], spatial.dest, vol * 0.34, effPitch * rnd(0.82, 0.90), spatial.delay + 0.004, 0, { lpFreq: 1600 });
      }
      if (hit1 || hit2) return;
    } else if (sample(keys, spatial.dest, vol, effPitch, spatial.delay, maxDur)) {
      return;
    }

    const fn = SYNTH[name];
    if (fn) fn(spatial.dest, vol, effPitch, MATS[material] || MATS.stone, spatial.delay);
    else if (!name.startsWith('ambiente.')) burst(spatial.dest, spatial.delay, 1000, 0.05, 0.2 * vol);
  }

  // ---- emissores espaciais 3D contínuos (máquinas, projéteis, cachoeiras, fogo, portais, píer, barco) ----------
  function setEmitter(id, spec) {
    if (!ctx || ctx.state !== 'running') return;
    let em = emitters.get(id);
    if (!em) {
      const g = ctx.createGain(), lp = ctx.createBiquadFilter(), panNode = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      g.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 18000; lp.Q.value = 0.4;
      if (panNode) { lp.connect(g).connect(panNode).connect(busAmb); }
      else { lp.connect(g).connect(busAmb); }
      em = { id, ...spec, g, lp, pan: panNode, src: null, occ: 0, nextOcc: 0 };
      emitters.set(id, em);
    } else {
      em.key = spec.key; em.pos = spec.pos; em.vel = spec.vel || null;
      em.volume = spec.volume ?? 1; em.pitch = spec.pitch ?? 1;
      em.refDist = spec.refDist ?? 4; em.maxDist = spec.maxDist ?? 48;
    }
  }
  function removeEmitter(id) {
    const em = emitters.get(id);
    if (!em) return;
    if (em.src) { try { em.src.stop(ctx.currentTime + 0.08); } catch {} em.src = null; }
    setTimeout(() => { try { em.lp.disconnect(); em.g.disconnect(); em.pan?.disconnect(); } catch {} }, 120);
    emitters.delete(id);
  }
  function stepEmitters(now) {
    const earPos = [ear.x, ear.y, ear.z], earVel = [ear.vx, ear.vy, ear.vz];
    for (const em of emitters.values()) {
      const d = Math.hypot(em.pos[0] - ear.x, em.pos[1] - ear.y, em.pos[2] - ear.z);
      let gain = (em.volume ?? 1) * waveAttenuation(d, { refDist: em.refDist ?? 4, maxDist: em.maxDist ?? 48 });
      if (gain > 0.004 && worldProbe && now >= em.nextOcc) {
        em.occ = measureOcclusion(worldProbe.getBlock, earPos, em.pos, worldProbe);
        em.nextOcc = now + 0.12;
      }
      gain *= 1 - 0.68 * em.occ;
      const list = gain > 0.004 ? pedirSom(em.key) : null;
      if (gain <= 0.004 || !list?.length) {
        em.g.gain.setTargetAtTime(0, now, 0.06);
        if (em.src && gain <= 0.001) { try { em.src.stop(now + 0.1); } catch {} em.src = null; }
        continue;
      }
      if (!em.src && voices.amb < MAX_VOICES.amb) {
        const src = ctx.createBufferSource();
        const raw = list[(Math.random() * list.length) | 0];
        src.buffer = raw?.buffer || raw;
        src.loop = true;
        src.connect(em.lp);
        voices.amb++;
        src.onended = () => { voices.amb = Math.max(0, voices.amb - 1); try { src.disconnect(); } catch {} if (em.src === src) em.src = null; };
        src.start(now, Math.random() * src.buffer.duration);
        em.src = src;
      }
      if (em.src) {
        const dop = dopplerShift(earPos, earVel, em.pos, em.vel, ear.underwater);
        em.src.playbackRate.setTargetAtTime(clamp((em.pitch ?? 1) * dop, 0.4, 2.2), now, 0.05);
      }
      em.g.gain.setTargetAtTime(gain, now, 0.06);
      em.lp.frequency.setTargetAtTime(airAbsorptionCutoff(d, ear.underwater, em.occ), now, 0.08);
      if (em.pan) em.pan.pan.setTargetAtTime(stereoPan(earPos, [ear.rx, ear.rz], em.pos), now, 0.05);
    }
  }

  // ---- leitos contínuos de ambiente -----------------------------------------------------------------------------
  function noiseBed(buf, type, freq, q) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), mix = ctx.createGain(), g = ctx.createGain();
    src.buffer = buf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = 0;
    src.connect(f).connect(mix).connect(g).connect(busAmb);
    src.start(0, Math.random() * 2);
    return { g, f, src, mix };
  }
  function silentBed() {
    const mix = ctx.createGain(), g = ctx.createGain();
    g.gain.value = 0;
    mix.connect(g).connect(busAmb);
    return { g, f: null, src: null, mix, osc: null };
  }
  function makeBeds() {
    beds.vento = noiseBed(pink, 'bandpass', 420, 0.5);
    beds.mata = noiseBed(white, 'highpass', 3400, 0.4);
    beds.agua = noiseBed(pink, 'lowpass', 760, 0.6);
    beds.fundo = noiseBed(pink, 'lowpass', 170, 0.7);
    const g = ctx.createGain(), mix = ctx.createGain(), f = ctx.createBiquadFilter(), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    g.gain.value = 0; f.type = 'lowpass'; f.frequency.value = 240;
    o1.frequency.value = 55; o2.frequency.value = 55.6; o3.type = 'triangle'; o3.frequency.value = 82.7;
    o1.connect(f); o2.connect(f); o3.connect(f); f.connect(mix).connect(g).connect(busAmb);
    o1.start(); o2.start(); o3.start();
    beds.zumbido = { g, mix, f, osc: [o1, o2, o3] };
    beds.submerso = noiseBed(pink, 'lowpass', 155, 0.7);
    beds.chuva = noiseBed(pink, 'bandpass', 1150, 0.45);
    beds.passaros = silentBed();
    beds.grilos = silentBed();
    beds.bolha = silentBed();
    beds.arqueda = silentBed();
    // Leitos costeiros e submarinos do Tidewater (CC0 1.0)
    beds.surf_far = silentBed();
    beds.wind = silentBed();
    beds.palms = silentBed();
    beds.pier_lap = silentBed();
    beds.under_reef = silentBed();
    beds.whale_song = silentBed();
    bedsReady = true;
    for (const [k, bed] of Object.entries(beds)) bed.chave = k;
  }
  function swapBed(k) {
    const list = samples.get('ambiente.' + k), bed = beds[k];
    if (!list || !list.length || !bed || bed.sampled) return;
    const src = ctx.createBufferSource(), mix = ctx.createGain(), t = ctx.currentTime;
    const raw = list[(Math.random() * list.length) | 0];
    src.buffer = raw?.buffer || raw; src.loop = true;
    mix.gain.setValueAtTime(0, t); mix.gain.linearRampToValueAtTime(1, t + 0.3);
    bed.mix.gain.setValueAtTime(1, t); bed.mix.gain.linearRampToValueAtTime(0, t + 0.3);
    const old = bed.src ? [bed.src] : (bed.osc || []), oldFilter = bed.f, oldMix = bed.mix;
    let remaining = old.length;
    if (remaining === 0) {
      setTimeout(() => { oldFilter?.disconnect(); oldMix?.disconnect(); }, 350);
    } else {
      for (const node of old) {
        node.onended = () => { node.disconnect(); if (--remaining === 0) { oldFilter?.disconnect(); oldMix?.disconnect(); } };
        node.stop(t + 0.31);
      }
    }
    src.connect(mix).connect(bed.g);
    src.start(t, Math.random() * src.buffer.duration);
    bed.sampled = true; bed.f = null; bed.src = src; bed.mix = mix; bed.osc = null;
  }
  function setG(bed, v, tc = 0.7) {
    if (!bed) return;
    if (v > 0.004 && !bed.sampled) { pedirSom('ambiente.' + bed.chave); swapBed(bed.chave); }
    bed.g.gain.setTargetAtTime(v, ctx.currentTime, tc);
  }

  function bird(vol) {
    if (sample(['ambiente.passaro'], () => pan(rnd(-0.9, 0.9), vol * 0.8), 1, rnd(0.9, 1.15))) return;
    if (beds.passaros?.sampled) return;
    const dest = pan(rnd(-0.9, 0.9), vol);
    const kind = (Math.random() * 4) | 0, base = rnd(2300, 4300);
    let t = 0;
    const n = kind === 0 ? 2 + ((Math.random() * 3) | 0) : kind === 1 ? 5 + ((Math.random() * 5) | 0) : kind === 2 ? 1 : 3;
    for (let i = 0; i < n; i++) {
      if (kind === 0) { tone(dest, t, base, 0.09, 0.07, 'sine', rnd(1.25, 1.6), 0.01); t += rnd(0.13, 0.2); }
      else if (kind === 1) { tone(dest, t, base * (1 + 0.06 * (i % 2)), 0.035, 0.05, 'sine', 0.9, 0.004); t += 0.055; }
      else if (kind === 2) { tone(dest, t, base * 0.7, 0.3, 0.06, 'sine', 0.72, 0.03); tone(dest, t + 0.34, base * 0.56, 0.4, 0.05, 'sine', 0.9, 0.04); }
      else { tone(dest, t, base * (1.2 - i * 0.14), 0.07, 0.06, 'sine', 0.85, 0.008); t += rnd(0.09, 0.12); }
    }
  }
  function cricket(vol) {
    if (sample(['ambiente.grilo'], () => pan(rnd(-0.9, 0.9), vol), 1, rnd(0.95, 1.05))) return;
    if (beds.grilos?.sampled) return;
    const dest = pan(rnd(-0.9, 0.9), vol), f = rnd(4100, 4900), n = 3 + ((Math.random() * 4) | 0);
    for (let k = 0; k < n; k++) for (let i = 0; i < 3; i++) tone(dest, k * 0.21 + i * 0.034, f, 0.022, 0.03, 'sine', 0, 0.004);
  }
  function frog(vol) {
    if (sample(['ambiente.sapo'], () => pan(rnd(-0.8, 0.8), vol * 0.85), 1, rnd(0.92, 1.08))) return;
    const dest = pan(rnd(-0.8, 0.8), vol), f = rnd(150, 230), n = 2 + ((Math.random() * 3) | 0);
    for (let k = 0; k < n; k++) { const o = tone(dest, k * 0.3, f, 0.16, 0.09, 'sawtooth', 1.25, 0.02); o.detune.value = rnd(-30, 30); }
  }
  function drip(vol, pos = null) {
    const sp = pos ? at(pos, { refDist: 2.5, maxDist: 16 }) : null;
    if (pos && !sp) return;
    if (sample(['ambiente.gota'], sp ? sp.dest : () => pan(rnd(-0.8, 0.8), vol * 0.85), vol * 0.85, rnd(0.9, 1.12), sp ? sp.delay : 0)) return;
    const dest = sp ? sp.dest : pan(rnd(-0.8, 0.8), vol), a0 = sp ? sp.delay : 0;
    tone(dest, a0, rnd(900, 1900), 0.07, 0.12, 'sine', 1.7, 0.002);
    if (Math.random() < 0.4) tone(dest, a0 + rnd(0.12, 0.3), rnd(1200, 2300), 0.05, 0.06, 'sine', 1.6, 0.002);
  }
  function owl(vol) { sample(['ambiente.coruja'], () => pan(rnd(-0.85, 0.85), vol * 0.72), 1, rnd(0.94, 1.06)); }
  function gull(vol, env = null) {
    const sx = env?.shoreX ?? 0.83, sz = env?.shoreZ ?? 0.55;
    const a = Math.atan2(sz, sx) + rnd(-1.2, 1.2), d = rnd(20, 62);
    const pos = [ear.x + Math.cos(a) * d, ear.y + rnd(6, 20), ear.z + Math.sin(a) * d];
    play('gull', vol * 0.88, rnd(0.93, 1.07), 'water', pos, { reach: 1.8, refDist: 10 });
  }
  function tern(vol, env = null) {
    const sx = env?.shoreX ?? 0.83, sz = env?.shoreZ ?? 0.55;
    const a = Math.atan2(sz, sx) + rnd(-1.3, 1.3), d = rnd(18, 56);
    const pos = [ear.x + Math.cos(a) * d, ear.y + rnd(5, 17), ear.z + Math.sin(a) * d];
    play('tern', vol * 0.76, rnd(0.95, 1.05), 'water', pos, { reach: 1.7, refDist: 9 });
  }
  function whale(vol, env = null) {
    if (!ear.underwater) {
      const sx = env?.shoreX ?? 0.83, sz = env?.shoreZ ?? 0.55;
      const a = Math.atan2(sz, sx) + rnd(-0.8, 0.8), d = rnd(24, 64);
      const pos = [ear.x + Math.cos(a) * d, (env?.seaY ?? 48) + 1.0, ear.z + Math.sin(a) * d];
      play('whale_blow', vol * 0.85, rnd(0.76, 0.92), 'water', pos, { reach: 2.0, refDist: 11 });
      return;
    }
    sample(['whale_blow', 'ambiente.baleia'], () => pan(rnd(-0.75, 0.75), vol * 0.55), 1, rnd(0.88, 1.04));
  }
  function whisper(vol) {
    if (sample(['whisper'], () => pan(rnd(-0.9, 0.9), vol * 0.78), 1, rnd(0.92, 1.08))) return;
    const dest = pan(rnd(-0.9, 0.9), vol), f = burst(dest, 0, rnd(700, 1500), rnd(1.2, 2.4), 0.07, 'bandpass', 7, 0.5, pink);
    f.frequency.linearRampToValueAtTime(rnd(900, 2600), ctx.currentTime + 1.6);
  }
  function pan(p, vol) {
    const g = ctx.createGain(); g.gain.value = vol;
    const route = { bus: 'amb', nodes: [g], active: 0 }; routes.set(g, route);
    if (ctx.createStereoPanner) { const s = ctx.createStereoPanner(); route.nodes.push(s); s.pan.value = p; g.connect(s).connect(busAmb); } else g.connect(busAmb);
    return g;
  }

  // ---- música harmônica ----------------------------------------------------------------------------------------
  function phrase(night, zone) {
    const scale = zone ? [0, 1, 5, 6, 10] : night ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9, 11];
    const root = 146.83 * Math.pow(2, [0, 2, 5, 7][(Math.random() * 4) | 0] / 12);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = night ? 1300 : 2100; f.connect(busMus);
    routes.set(f, { bus: 'mus', nodes: [f], active: 0 });
    let t = 0, deg = (Math.random() * scale.length) | 0;
    const n = 5 + ((Math.random() * 5) | 0);
    const note = (at0, hz, dur, vol) => {
      for (const [type, det, k] of [['triangle', -5, 1], ['triangle', 6, 1], ['sine', 0, 0.5]]) {
        const o = tone(f, at0, hz * k, dur, vol * (k === 1 ? 0.5 : 0.7), type, 0, Math.min(1.2, dur * 0.35));
        o.detune.value = det;
      }
    };
    note(0, root * 0.5, n * 2.6 + 4, 0.05); note(0.4, root * 0.75, n * 2.6 + 3, 0.035);
    for (let i = 0; i < n; i++) {
      deg = clamp(deg + ((Math.random() * 5) | 0) - 2, 0, scale.length * 2 - 1);
      const hz = root * Math.pow(2, (scale[deg % scale.length] + 12 * ((deg / scale.length) | 0)) / 12);
      note(t, hz, rnd(3.2, 5.5), rnd(0.06, 0.1));
      if (Math.random() < 0.3) note(t + 0.06, hz * 1.5, rnd(2.5, 4), 0.04);
      t += rnd(1.5, 3.4);
    }
    return t + 6;
  }
  function music(dt, env) {
    const mv = getMusic();
    busMus.gain.setTargetAtTime(mv, ctx.currentTime, 0.5);
    if (mv <= 0.001 || !env.playing) {
      if (musicGain) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      return;
    }
    ev.music -= dt;
    if (ev.music > 0 || voices.mus > 0) return;
    const list = streams.get(env.zone ? 'musica.zona' : env.night > 0.5 ? 'musica.noite' : 'musica.dia') || streams.get('musica');
    if (list && list.length) {
      if (musicEl && !musicEl.ended && !musicEl.paused) {
        if (musicGain) musicGain.gain.setTargetAtTime(0.65, ctx.currentTime, 1.2);
        ev.music = 5;
        return;
      }
      musicEl = new Audio(list[(Math.random() * list.length) | 0]);
      try {
        musicGain = ctx.createGain();
        musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.65, ctx.currentTime + 2.6);
        ctx.createMediaElementSource(musicEl).connect(musicGain).connect(busMus);
      } catch {
        musicEl.volume = clamp(mv * getVolume() * 0.65, 0, 1);
      }
      musicEl.play().catch(() => {});
      ev.music = rnd(110, 220);
    } else ev.music = phrase(env.night > 0.5, env.zone) + rnd(70, 170);
  }

  // ---- motor da máquina pilotada (suporta perfis: carro, helice, queimador, barco, motor) --------------------
  function swapEngine(kind = 'motor') {
    const n = engineNodes;
    if (!n) return;
    const list = (kind === 'barco' ? pedirSom('ambiente.boat_engine') : null) || pedirSom('ambiente.' + kind) || pedirSom('ambiente.motor');
    if (!list || !list.length) return;
    if (n.sampled && n.loadedKind === kind) return;
    const src = ctx.createBufferSource(), t = ctx.currentTime;
    const raw = list[0];
    src.buffer = raw?.buffer || raw; src.loop = true;
    src.connect(n.f);
    src.start(t);
    if (n.src) { try { n.src.stop(t + 0.06); } catch {} }
    for (const o of [n.o1, n.o2]) {
      if (!o) continue;
      o.onended = () => o.disconnect();
      o.stop(t + 0.05);
    }
    n.src = src; n.o1 = null; n.o2 = null; n.sampled = true; n.loadedKind = kind;
  }
  function engine(level, pitch = 0, kind = 'motor') {
    if (!ctx || ctx.state !== 'running') return;
    if (!engineNodes) {
      if (level <= 0) return;
      const g = ctx.createGain(), f = ctx.createBiquadFilter();
      g.gain.value = 0; f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 1.2;
      f.connect(g).connect(busSfx);
      const wash = noiseBed(pink, 'bandpass', 600, 0.6);
      wash.g.disconnect(); wash.g.connect(busSfx);
      let o1 = null, o2 = null;
      if (!(samples.get('ambiente.' + kind)?.length || samples.get('ambiente.motor')?.length)) {
        const sub = ctx.createGain(); sub.gain.value = 0.6;
        o1 = ctx.createOscillator(); o2 = ctx.createOscillator();
        o1.type = 'triangle'; o2.type = 'sine';
        o1.connect(f); o2.connect(sub).connect(f);
        o1.start(); o2.start();
      }
      engineNodes = { g, f, o1, o2, wash, src: null, sampled: false, kind, loadedKind: '' };
      swapEngine(kind);
    } else if (engineNodes.kind !== kind) {
      engineNodes.kind = kind;
      swapEngine(kind);
    }
    const n = engineNodes, t = ctx.currentTime, p = clamp(pitch, 0, 1.6), lv = clamp(level, 0, 1);
    if (n.sampled && n.src) {
      n.src.playbackRate.setTargetAtTime(0.72 + 0.55 * p, t, 0.12);
    } else if (n.o1 && n.o2) {
      const hz = 42 + 95 * p;
      n.o1.frequency.setTargetAtTime(hz, t, 0.12); n.o2.frequency.setTargetAtTime(hz * 0.5, t, 0.12);
    }
    n.f.frequency.setTargetAtTime(320 + 1400 * Math.min(1.4, p), t, 0.15);
    n.g.gain.setTargetAtTime((n.sampled ? 0.20 : 0.12) * lv, t, 0.2);
    n.wash.g.gain.setTargetAtTime(0.07 * lv * Math.min(1.4, p), t, 0.3);
    n.wash.f.frequency.setTargetAtTime(400 + 900 * Math.min(1.4, p), t, 0.3);
  }

  function listen(x, y, z, yaw, vx = 0, vy = 0, vz = 0) {
    ear.x = x; ear.y = y; ear.z = z;
    ear.vx = vx; ear.vy = vy; ear.vz = vz;
    ear.rx = Math.cos(yaw); ear.rz = -Math.sin(yaw);
  }
  function setWorld(probe) { worldProbe = probe; }

  function water(wet, speed, vertical, dt) {
    const event = waterTransition(wet, speed, vertical, dt);
    if (event) {
      if (event.name === 'water-enter') {
        play('submerge', event.volume, rnd(0.95, 1.05), 'water');
        if (speed > 4.2 || vertical < -3.2) {
          const big = vertical < -9.5 || speed > 11;
          play(big ? 'big_splash' : 'splash', Math.min(1, event.volume * (big ? 0.95 : 0.82)), rnd(0.92, 1.08), 'water');
        }
        if (vertical < -5.5) {
          play('bubble', Math.min(0.75, 0.28 + Math.abs(vertical) * 0.03), rnd(0.92, 1.08), 'water', null, { delay: 0.14 });
        }
      } else {
        play('emerge', Math.max(0.32, event.volume * 1.15), rnd(0.95, 1.05), 'water');
      }
    }
  }

  function stepCoastalSurf(dt, s, env, open, quiet, seaLevel, waveE) {
    // Dispara wash e backwash agendados na posição atual do ouvido
    for (let i = surfQueue.length - 1; i >= 0; i--) {
      if (s >= surfQueue[i].at) {
        const q = surfQueue.splice(i, 1)[0];
        if (!ear.underwater) play(q.name, q.vol * quiet * open, q.pitch, 'water', q.pos, q.opts);
      }
    }
    if (ear.underwater || open <= 0.32 || env.zone || env.nano || seaLevel <= 0.01) return;
    ev.surf -= dt;
    if (ev.surf > 0) return;
    ev.surf = rnd(2.1, 4.3) / (0.65 + 0.75 * waveE);
    const m = ++surfWaveIdx;
    const setMod = (0.58 + 0.56 * Math.abs(Math.sin(m * Math.PI / 7))) * rnd(0.86, 1.16);
    const sx = env.shoreX ?? 0.83, sz = env.shoreZ ?? 0.55;
    const seaY = env.seaY ?? 48;
    const dShore = clamp(env.shoreDist ?? 16, 4, 88);
    const side = rnd(-32, 32);
    const dBreak = dShore + rnd(7, 15);
    const crashPos = [ear.x + sx * dBreak - sz * side, seaY + 0.4, ear.z + sz * dBreak + sx * side];
    const crashVol = clamp((0.30 + 0.56 * waveE) * setMod * Math.min(1, seaLevel * 1.65 + 0.25), 0.16, 0.96);
    const crashPitch = clamp(1.06 - 0.22 * setMod, 0.82, 1.08) * rnd(0.96, 1.04);
    play('surf_crash', crashVol * quiet * open, crashPitch, 'water', crashPos, { reach: 2.2, refDist: 10 });
    if (dShore < 64 && surfQueue.length < 12) {
      const washPos = [ear.x + sx * dShore - sz * side, seaY + 0.1, ear.z + sz * dShore + sx * side];
      const backPos = [ear.x + sx * (dShore + 1.5) - sz * side, seaY, ear.z + sz * (dShore + 1.5) + sx * side];
      surfQueue.push(
        { at: s + rnd(2.2, 3.2), name: 'surf_wash', vol: crashVol * 0.76, pitch: rnd(0.95, 1.05), pos: washPos, opts: { reach: 1.4, refDist: 5.5 } },
        { at: s + rnd(4.7, 6.1), name: 'surf_backwash', vol: crashVol * 0.64, pitch: rnd(0.95, 1.05), pos: backPos, opts: { reach: 1.3, refDist: 5.0 } },
      );
    }
  }

  function update(dt, env) {
    if (!env.playing) waterTransition = createWaterTransition();
    if (!ctx || ctx.state !== 'running') return;
    const v = getVolume(), t = ctx.currentTime;
    master.gain.setTargetAtTime(v, t, 0.05);
    if (v <= 0) return;
    if (!bedsReady) makeBeds();
    ear.underwater = !!env.underwater;

    const open = 1 - clamp(env.enclosed || 0, 0, 1), under = ear.underwater, quiet = env.playing ? 1 : 0.55;
    const rain = clamp(env.rain || 0, 0, 1), wnd = clamp(env.wind || 0, 0, 1);
    const s = t - t0, gust = 0.55 + 0.45 * Math.sin(s * 0.23) * Math.sin(s * 0.071 + 1.3);
    const depth = clamp((env.depthBelowSurface || 0) / 12, 0, 1);
    filter.frequency.setTargetAtTime(under ? (520 - 240 * depth) : 20000, t, 0.09);
    send.gain.setTargetAtTime(under ? 0.025 : 0.05 + 0.48 * (1 - open), t, 0.18);

    // Modulação de rajadas costeiras estilo SoundScape.js
    gustState.t -= dt;
    if (gustState.t <= 0) {
      gustState.target = Math.random() < 0.35 ? rnd(0.05, 0.16) : rnd(0.32, 1.0);
      gustState.t = rnd(2.0, 7.5);
    }
    gustState.v += (gustState.target - gustState.v) * (1 - Math.exp(-dt / 1.4));

    const fly = Math.min(1, (env.speed || 0) / 26);
    const fallRush = !under && !env.zone ? clamp(((env.fallSpeed || 0) - 7.5) / 20, 0, 1) : 0;
    // Fora do espaço da fonte -> ganho vai a zero (vento não vaza para dentro de caverna fechada).
    setG(beds.vento, under ? 0 : quiet * (open * (0.03 + 0.1 * (env.alt || 0) + 0.09 * wnd) * (0.5 + gust) + (open > 0.2 ? 0.28 * fly * fly : 0)) * (env.zone ? 1.5 : 1));
    if (beds.vento.f) beds.vento.f.frequency.setTargetAtTime(280 + 420 * gust + 900 * fly + (env.zone ? -120 : 0), t, 0.8);
    setG(beds.arqueda, fallRush * 0.28, 0.12);
    setG(beds.mata, under ? 0 : quiet * (env.trees || 0) * open * (0.015 + 0.045 * (gust * gust + 0.5 * wnd)));
    const waveE = clamp(env.waveEnergy ?? 0, 0, 1);
    const seaLevel = seaWaveLevel(env.seaWater ?? 0, waveE);
    const swell = 0.6 + 0.4 * Math.sin(s * 0.85) * Math.sin(s * 0.31 + 0.7);
    setG(beds.agua, under ? 0 : quiet * seaLevel * open * 0.14 * swell, 0.4);
    // Rugido distante do mar (mar.surf_far.ogg), vento costeiro (mar.wind.ogg), palmeiras (mar.palms.ogg) e píer (mar.pier_lap.ogg)
    setG(beds.surf_far, under ? 0 : quiet * open * seaLevel * (0.14 + 0.12 * waveE), 0.45);
    const coastalPresence = clamp(Math.max(env.seaWater ?? 0, (env.beach ?? 0) * 0.8), 0, 1);
    setG(beds.wind, under ? 0 : quiet * open * Math.max(coastalPresence * 0.9, wnd * 0.7) * (0.04 + 0.13 * Math.max(wnd, waveE)) * gustState.v, 0.35);
    const day = 1 - (env.night || 0);
    setG(beds.palms, under ? 0 : quiet * open * coastalPresence * Math.min(1, (env.trees || 0) * 1.6 + (env.beach || 0) * 0.45) * (0.03 + 0.10 * gustState.v) * (0.35 + 0.65 * day), 0.5);
    setG(beds.pier_lap, under ? 0 : quiet * open * (env.nearPier ? 0.18 : 0), 0.5);
    // Ambiência submersa under_reef + canto de baleia
    const hasReef = beds.under_reef?.sampled;
    const hasSub = hasReef || beds.submerso?.sampled;
    setG(beds.under_reef, under ? 0.25 * (0.85 + 0.3 * depth) : 0, 0.22);
    setG(beds.submerso, under ? (hasReef ? 0.08 : 0.24) : 0, 0.22);
    const whaleSwell = 0.4 + 0.6 * Math.max(0, Math.sin(s * 0.11));
    setG(beds.whale_song, under && !env.zone && !env.nano && (env.seaWater ?? env.water ?? 0) > 0.12 ? 0.13 * whaleSwell : 0, 0.8);
    setG(beds.bolha, under && !env.zone ? 0.11 : 0, 0.28);
    setG(beds.fundo, under ? (hasSub ? 0.04 : 0.22) : quiet * (1 - open) * 0.11, 0.25);
    setG(beds.zumbido, quiet * (env.zone ? 0.11 : under ? 0 : (1 - open) > 0.72 ? (1 - open) * (1 - open) * 0.06 : 0));
    setG(beds.chuva, under || env.zone || env.nano ? 0 : quiet * rain * open * 0.25, 0.45);
    const flora = Math.min(1, (env.trees || 0) * 1.4 + (env.grass || 0) * 0.5);
    setG(beds.passaros, under || env.zone || env.nano || open < 0.25 ? 0 : quiet * open * Math.max(0, day - 0.25) * (1 - 0.75 * rain) * flora * 0.16, 0.8);
    setG(beds.grilos, under || env.zone || env.nano || open < 0.25 ? 0 : quiet * open * Math.max(0, (env.night || 0) - 0.35) * (1 - 0.7 * rain) * Math.min(1, (env.grass || 0) * 1.2 + (env.trees || 0) * 0.8) * 0.15, 0.8);

    stepCoastalSurf(dt, s, env, open, quiet, seaLevel, waveE);

    const amb = quiet * 0.5;
    if (!under && open > 0.55 && !env.zone && !env.nano) {
      if (day > 0.5 && (env.trees || 0) + (env.grass || 0) > 0.05 && (ev.bird -= dt) <= 0) { bird(amb * (0.5 + 0.5 * day)); ev.bird = rnd(1.2, 7) / (0.4 + (env.trees || 0) * 2 + (env.grass || 0)); }
      if ((env.night || 0) > 0.5 && (env.grass || 0) + (env.trees || 0) > 0.05 && (ev.cricket -= dt) <= 0) { cricket(amb); ev.cricket = rnd(0.5, 2.6); }
      if ((env.night || 0) > 0.4 && (env.water || 0) > 0.25 && (ev.frog -= dt) <= 0) { frog(amb * 0.8); ev.frog = rnd(4, 13); }
      if ((env.night || 0) > 0.5 && (env.trees || 0) > 0.12 && (ev.owl -= dt) <= 0) { owl(amb * 0.75); ev.owl = rnd(12, 28); }
      if (day > 0.38 && (env.seaWater ?? env.water ?? 0) > 0.16 && (ev.gull -= dt) <= 0) { gull(amb * 0.76, env); ev.gull = rnd(7, 19); }
      if (day > 0.38 && (env.seaWater ?? env.water ?? 0) > 0.16 && (ev.tern -= dt) <= 0) { tern(amb * 0.68, env); ev.tern = rnd(8, 21); }
      if ((env.seaWater ?? 0) > 0.35 && (ev.whale -= dt) <= 0) { whale(amb * 0.7, env); ev.whale = rnd(18, 38); }
    }
    if (under && !env.zone && !env.nano && (ev.whale -= dt) <= 0) { whale(amb * 0.65, env); ev.whale = rnd(14, 32); }
    if (under && !env.zone && (ev.bubble -= dt) <= 0) { play('bubble', 0.28, rnd(0.9, 1.15), 'water'); ev.bubble = rnd(2.2, 5.5); }
    if (!under && open > 0.62 && !env.zone && (wnd > 0.30 || (env.alt || 0) > 0.35) && (ev.gust -= dt) <= 0) {
      play('gust', open * (0.14 + 0.26 * Math.max(wnd, env.alt || 0)), rnd(0.86, 1.14));
      ev.gust = rnd(5.5, 13.5);
    }
    if (!under && !env.zone && env.dripPos && (ev.drip -= dt) <= 0) { drip(amb, env.dripPos); ev.drip = rnd(2.2, 8.5); }
    if (env.zone && (ev.whisper -= dt) <= 0) { whisper(amb); ev.whisper = rnd(4, 13); }
    stepEmitters(t);
    music(dt, env);
  }

  return {
    play, update, listen, engine, water, setWorld, setEmitter, removeEmitter,
    get ctx() { return ctx; }, get out() { return master; },
    get ready() { return !!ctx && ctx.state === 'running'; },
    get recorded() { return [...samples.keys(), ...streams.keys()]; },
  };
}
