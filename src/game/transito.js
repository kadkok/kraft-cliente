// LAVRA — trânsito da Ilha Metrópole (pedido do Kadmus, 24/11/2026: "onde estão os carros na grande metrópole,
// aeroporto, policiamento, bombeiros e médicos…").
//
// Enfeite só do aparelho, como game/cidade-longe.js: não muda bloco, colisão nem lei.
//   · carros circulando pelas ruas, sempre na mão direita, em voltas fechadas de quarteirão (shared/cidade.js → ruas)
//     e na Avenida do Cais; viaturas da polícia em ronda, ambulância e caminhão dos bombeiros com a sirene piscando
//   · estacionados: viaturas no pátio da Delegacia, ambulâncias no pronto-socorro, caminhões nos portões do Quartel,
//     carros nos estacionamentos do Hospital e do Aeroporto (shared/cidade-servicos.js → vagas)
//   · aeroporto: três aviões nas pontes de embarque e um fazendo o circuito de toque e arremetida sobre o mar;
//     helicóptero no heliponto do Hospital
// A posição de cada veículo é função do relógio (Date.now): todos os aparelhos veem o trânsito quase igual, sem
// mensagem nenhuma do servidor. Tudo em malhas instanciadas (poucas chamadas de desenho); só se mexe o que está a
// menos de VE metros de quem olha e em pedaço de mundo já desenhado.
import * as THREE from '../three.js';
import { ckey } from '../../shared/constants.js';

const Y = 52, VE = 230, LONGE = 900;
const CORES = ['#f2f2ee', '#c9ccd1', '#1d1f24', '#a8231e', '#1f4b8f', '#4a4f57', '#d8c9a3', '#2f6b45', '#e0b31f', '#7a2b55'];

// ---- geometria: caixas juntadas numa malha só, com cor por vértice --------------------------------------------------
function caixa(w, h, d, x, y, z, cor) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
  const c = new THREE.Color(cor), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function junta(lista) {
  let n = 0; for (const g of lista) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cor = new Float32Array(n * 3);
  let o = 0;
  for (const g of lista) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); cor.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); r.setAttribute('color', new THREE.BufferAttribute(cor, 3));
  return r;
}
const rodas = (xs, zs, r, w) => { const l = []; for (const x of xs) for (const z of zs) l.push(caixa(w, r * 2, r * 2, x, r, z, '#141414')); return l; };

// modelos (frente em +z): corpo (pintado por instância), escuro (vidros, rodas, faixas), luzes, sirene A/B
const MODELOS = {
  carro: () => ({
    corpo: junta([caixa(1.8, 0.62, 4.1, 0, 0.6, 0, '#fff'), caixa(1.62, 0.5, 2.0, 0, 1.15, -0.25, '#fff')]),
    escuro: junta([caixa(1.66, 0.42, 1.7, 0, 1.17, -0.2, '#1c2430'), caixa(1.5, 0.38, 0.06, 0, 1.12, 0.76, '#2a3646'), ...rodas([-0.82, 0.82], [-1.3, 1.3], 0.32, 0.26)]),
    luzes: junta([caixa(0.34, 0.16, 0.05, -0.6, 0.72, 2.06, '#fff4c8'), caixa(0.34, 0.16, 0.05, 0.6, 0.72, 2.06, '#fff4c8'), caixa(0.34, 0.14, 0.05, -0.62, 0.74, -2.06, '#ff1e1e'), caixa(0.34, 0.14, 0.05, 0.62, 0.74, -2.06, '#ff1e1e')]),
  }),
  viatura: () => ({
    corpo: junta([caixa(1.84, 0.64, 4.4, 0, 0.6, 0, '#fff'), caixa(1.64, 0.5, 2.1, 0, 1.17, -0.25, '#fff')]),
    escuro: junta([caixa(1.68, 0.42, 1.8, 0, 1.19, -0.2, '#1c2430'), caixa(1.86, 0.22, 4.42, 0, 0.52, 0, '#14275e'), caixa(1.86, 0.1, 1.2, 0, 0.93, 1.5, '#14275e'), ...rodas([-0.84, 0.84], [-1.4, 1.4], 0.33, 0.26)]),
    luzes: junta([caixa(0.34, 0.16, 0.05, -0.6, 0.72, 2.21, '#fff4c8'), caixa(0.34, 0.16, 0.05, 0.6, 0.72, 2.21, '#fff4c8'), caixa(0.34, 0.14, 0.05, -0.62, 0.74, -2.21, '#ff1e1e'), caixa(0.34, 0.14, 0.05, 0.62, 0.74, -2.21, '#ff1e1e')]),
    a: caixa(0.62, 0.18, 0.34, -0.36, 1.52, -0.1, '#fff'), b: caixa(0.62, 0.18, 0.34, 0.36, 1.52, -0.1, '#fff'),
  }),
  ambulancia: () => ({
    corpo: junta([caixa(2.0, 2.0, 5.2, 0, 1.3, -0.2, '#fff'), caixa(1.96, 1.2, 1.2, 0, 0.9, 2.9, '#fff')]),
    escuro: junta([caixa(1.9, 0.6, 0.06, 0, 1.75, 2.42, '#1c2430'), caixa(1.98, 0.5, 0.9, 0, 1.15, 2.95, '#1c2430'), caixa(2.04, 0.32, 5.24, 0, 1.0, -0.2, '#c81e1e'), caixa(0.24, 0.9, 0.06, 0, 1.9, -2.83, '#c81e1e'), caixa(0.9, 0.24, 0.06, 0, 1.9, -2.83, '#c81e1e'), ...rodas([-0.92, 0.92], [-1.9, 2.4], 0.36, 0.28)]),
    luzes: junta([caixa(0.34, 0.16, 0.05, -0.62, 0.8, 3.52, '#fff4c8'), caixa(0.34, 0.16, 0.05, 0.62, 0.8, 3.52, '#fff4c8'), caixa(0.3, 0.3, 0.05, -0.85, 0.9, -2.82, '#ff1e1e'), caixa(0.3, 0.3, 0.05, 0.85, 0.9, -2.82, '#ff1e1e')]),
    a: caixa(0.7, 0.2, 0.34, -0.42, 2.4, 2.0, '#fff'), b: caixa(0.7, 0.2, 0.34, 0.42, 2.4, 2.0, '#fff'),
  }),
  caminhao: () => ({
    corpo: junta([caixa(2.4, 2.0, 6.2, 0, 1.5, -0.9, '#fff'), caixa(2.4, 2.3, 2.0, 0, 1.6, 3.2, '#fff')]),
    escuro: junta([caixa(2.3, 0.8, 0.06, 0, 2.1, 4.22, '#1c2430'), caixa(2.42, 0.7, 1.4, 0, 2.1, 3.3, '#1c2430'), caixa(2.44, 0.22, 8.2, 0, 1.05, 0.1, '#f2f2ee'),
      caixa(0.9, 0.24, 6.6, 0, 2.7, -0.8, '#c0c4ca'), caixa(0.1, 0.5, 6.6, -0.42, 2.95, -0.8, '#c0c4ca'), caixa(0.1, 0.5, 6.6, 0.42, 2.95, -0.8, '#c0c4ca'), caixa(2.42, 0.4, 0.5, 0, 0.6, 4.25, '#c0c4ca'),
      ...rodas([-1.08, 1.08], [-3.0, -1.6, 3.0], 0.48, 0.34)]),
    luzes: junta([caixa(0.36, 0.2, 0.05, -0.8, 1.0, 4.26, '#fff4c8'), caixa(0.36, 0.2, 0.05, 0.8, 1.0, 4.26, '#fff4c8'), caixa(0.3, 0.3, 0.05, -1.0, 0.9, -4.02, '#ff1e1e'), caixa(0.3, 0.3, 0.05, 1.0, 0.9, -4.02, '#ff1e1e')]),
    a: caixa(0.8, 0.22, 0.4, -0.5, 2.88, 3.4, '#fff'), b: caixa(0.8, 0.22, 0.4, 0.5, 2.88, 3.4, '#fff'),
  }),
};
const SIRENE = { viatura: ['#ff2a2a', '#2a5cff'], ambulancia: ['#ff2a2a', '#ff2a2a'], caminhao: ['#ff2a2a', '#ffffff'] };

function aviao(cor) {
  const g = new THREE.Group();
  const m = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, emissive: e || '#000' });
  const branco = m('#f4f5f7'), faixa = m(cor), escuro = m('#2a3240'), cinza = m('#aab0b8');
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 22, 12), branco); fus.rotation.x = Math.PI / 2; g.add(fus);
  const nariz = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), branco); nariz.rotation.x = Math.PI / 2; nariz.position.z = 11; g.add(nariz);
  const cauda = new THREE.Mesh(new THREE.ConeGeometry(1.7, 5, 12), branco); cauda.rotation.x = -Math.PI / 2; cauda.position.z = -13.5; g.add(cauda);
  const fx = new THREE.Mesh(new THREE.BoxGeometry(3.46, 0.5, 26), faixa); fx.position.y = -0.2; g.add(fx);
  const jan = new THREE.Mesh(new THREE.BoxGeometry(3.44, 0.32, 18), escuro); jan.position.set(0, 0.55, 0.5); g.add(jan);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.9), escuro); cab.position.set(0, 0.9, 11.3); cab.rotation.x = -0.5; g.add(cab);
  const asa = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 4.2), branco); asa.position.set(0, -0.7, 0.5); g.add(asa);
  const pontas = new THREE.Mesh(new THREE.BoxGeometry(30.2, 0.42, 0.8), faixa); pontas.position.set(0, -0.7, -1.2); g.add(pontas);
  const est = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 2.4), branco); est.position.set(0, 0.6, -13.6); g.add(est);
  const der = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 3.2), faixa); der.position.set(0, 3.0, -13.8); der.rotation.x = -0.35; g.add(der);
  for (const x of [-6, 6]) { const mo = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.4, 10), cinza); mo.rotation.x = Math.PI / 2; mo.position.set(x, -1.6, 1.8); g.add(mo); }
  for (const [x, z] of [[0, 8.5], [-2.4, 0], [2.4, 0]]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.9), escuro); r.position.set(x, -2.0, z); g.add(r); }
  const luzV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#ff2020' })); luzV.position.set(-15, -0.7, 0.5); g.add(luzV);
  const luzD = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#20ff40' })); luzD.position.set(15, -0.7, 0.5); g.add(luzD);
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
  g.userData.alturaRodas = 2.7;      // do eixo do avião ao chão
  return g;
}
function helicoptero() {
  const g = new THREE.Group(), m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const corpo = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), m('#d42a2a')); corpo.scale.set(1, 0.9, 1.6); corpo.position.y = 1.5; g.add(corpo);
  const vid = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), m('#1c2430')); vid.scale.set(1, 0.7, 0.9); vid.position.set(0, 1.8, 1.3); g.add(vid);
  const cauda = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 5), m('#f2f2ee')); cauda.position.set(0, 1.9, -4.2); g.add(cauda);
  const der = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.3, 0.8), m('#d42a2a')); der.position.set(0, 2.5, -6.5); g.add(der);
  for (const x of [-0.9, 0.9]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.2), m('#333')); e.position.set(x, 0.1, 0); g.add(e); }
  const cruz = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), m('#fff')); cruz.position.set(1.42, 1.5, 0); g.add(cruz);
  const rotor = new THREE.Group(); rotor.position.y = 2.95;
  for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.3), m('#222')); p.rotation.y = r; rotor.add(p); }
  g.add(rotor); g.userData.rotor = rotor;
  g.traverse((o) => { o.castShadow = false; o.frustumCulled = false; });
  return g;
}

// ---- percursos ---------------------------------------------------------------------------------------------------
function percurso(pts) {        // polilinha fechada [[x, z], …] → { L, em(s) → [x, z] }
  const seg = []; let L = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 0.01) continue; seg.push({ a, b, d, s: L }); L += d; }
  const em = (s) => {
    s = ((s % L) + L) % L;
    let lo = 0, hi = seg.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (seg[m].s <= s) lo = m; else hi = m - 1; }
    const g = seg[lo], t = (s - g.s) / g.d;
    return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t];
  };
  return { L, em };
}
// posição suavizada e rumo (olha 2,5 m à frente e atrás: dobra as esquinas em curva)
function noPercurso(p, s, out) {
  const a = p.em(s - 2.5), b = p.em(s + 2.5), c = p.em(s);
  out.x = (a[0] + b[0] + 2 * c[0]) / 4; out.z = (a[1] + b[1] + 2 * c[1]) / 4;
  out.h = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return out;
}
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function initTransito({ game, scene, camera, world }) {
  let genRef = null, M = null;
  const cam = new THREE.Vector3(), O = new THREE.Object3D(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), cor = new THREE.Color(), pt = { x: 0, z: 0, h: 0 };

  function desmonta() {
    if (!M) return;
    for (const t of Object.values(M.tipos)) for (const m of t.malhas) { scene.remove(m); m.geometry.dispose(); }
    for (const g of M.grupos) scene.remove(g);
    M = null;
  }
  function monta(gen) {
    desmonta();
    const il = (game.dim || 0) === 0 ? gen?.arq?.ilhas?.find((i) => i.tema === 5) : null;
    if (!il) return;
    M = { il, pronto: false, tipos: {}, veic: [], grupos: [], avioes: [], heli: null };
  }
  // o plano da cidade custa alguns milissegundos: só é montado quando alguém chega perto da ilha
  function prepara() {
    const il = M.il;
    let cid = null; try { cid = il.cidade; } catch { cid = null; }
    M.pronto = true;
    if (!cid?.ruas?.length) return;
    const serv = cid.servicos || [], achar = (t) => serv.find((s) => s.tipo === t);
    // grade das ruas: trechos de cruzamento a cruzamento
    const aresta = new Set(), xs = new Set(), zs = new Set();
    let av = [];
    for (const r of cid.ruas) {
      if (r.largura > 10) { av.push(r); continue; }
      const k = (p, q) => (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? p.join(',') + '|' + q.join(',') : q.join(',') + '|' + p.join(','));
      aresta.add(k(r.a, r.b));
      if (r.a[0] === r.b[0]) xs.add(r.a[0]); else zs.add(r.a[1]);
    }
    const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b);
    const tem = (p, q) => aresta.has(p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? p.join(',') + '|' + q.join(',') : q.join(',') + '|' + p.join(','));
    const lado = (i0, i1, j0, j1) => {
      for (let i = i0; i < i1; i++) { if (!tem([X[i], Z[j0]], [X[i + 1], Z[j0]]) || !tem([X[i], Z[j1]], [X[i + 1], Z[j1]])) return false; }
      for (let j = j0; j < j1; j++) { if (!tem([X[i0], Z[j]], [X[i0], Z[j + 1]]) || !tem([X[i1], Z[j]], [X[i1], Z[j + 1]])) return false; }
      return true;
    };
    const voltas = [];
    for (let i0 = 0; i0 < X.length; i0++) for (let j0 = 0; j0 < Z.length; j0++) for (const [di, dj] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [4, 3]]) {
      const i1 = i0 + di, j1 = j0 + dj; if (i1 >= X.length || j1 >= Z.length) continue;
      if (!lado(i0, i1, j0, j1)) continue;
      voltas.push({ x0: X[i0] + 0.5, z0: Z[j0] + 0.5, x1: X[i1] + 0.5, z1: Z[j1] + 0.5, n: di * dj });
    }
    // na mão direita: horário = faixa de dentro, anti-horário = faixa de fora (1,75 m do eixo)
    const volta = (v, horario, o = 1.75) => percurso(horario
      ? [[v.x0 + o, v.z0 + o], [v.x1 - o, v.z0 + o], [v.x1 - o, v.z1 - o], [v.x0 + o, v.z1 - o]]
      : [[v.x0 - o, v.z0 - o], [v.x0 - o, v.z1 + o], [v.x1 + o, v.z1 + o], [v.x1 + o, v.z0 - o]]);
    const veic = M.veic, conta = {};
    const poe = (tipo, o) => { conta[tipo] = (conta[tipo] || 0) + 1; veic.push({ tipo, ...o }); };
    let k = 0;
    const escolhidas = voltas.map((v) => ({ v, h: hash(v.x0 * 7 + v.z0, 11 + v.n) })).sort((a, b) => a.h - b.h).slice(0, 70).map((o) => o.v);
    for (const v of escolhidas) {
      const horario = hash(v.x0, v.z0) < 0.5, p = volta(v, horario), n = 1 + (v.n > 2 ? 1 : 0);
      for (let q = 0; q < n; q++, k++) poe('carro', { p, fase: hash(k, 3) * p.L, vel: 7 + hash(k, 5) * 5, cor: CORES[Math.floor(hash(k, 9) * CORES.length)] });
    }
    // Avenida do Cais: vai pela pista sul (rumo leste), volta pela norte; retorno nas pontas
    for (const r of av) {
      const xa = Math.min(r.a[0], r.b[0]) + 6, xb = Math.max(r.a[0], r.b[0]) - 4, z = r.a[1] + 0.5;
      if (xb - xa < 30) continue;
      for (const o of [3.5, 6.5]) {
        const p = percurso([[xa, z + o], [xb, z + o], [xb, z - o], [xa, z - o]]);
        const n = Math.max(1, Math.round(p.L / 140));
        for (let q = 0; q < n; q++, k++) poe('carro', { p, fase: (q / n) * p.L + hash(k, 3) * 20, vel: 9 + hash(k, 5) * 4, cor: CORES[Math.floor(hash(k, 9) * CORES.length)] });
      }
    }
    // serviços em movimento: rondas, ambulância e caminhão dos bombeiros com sirene
    const grandes = voltas.filter((v) => v.n >= 4);
    const perto = (s, lista) => { let m = null, d = 1e9; for (const v of lista) { const e = Math.hypot((v.x0 + v.x1) / 2 - s.x, (v.z0 + v.z1) / 2 - s.z); if (e < d) { d = e; m = v; } } return m; };
    const ronda = (tipo, v, horario, n, vel) => { if (!v) return; const p = volta(v, horario); for (let q = 0; q < n; q++, k++) poe(tipo, { p, fase: (q / n) * p.L, vel, sirene: true }); };
    const del = achar('delegacia'), hos = achar('hospital'), bom = achar('bombeiros');
    if (del) { ronda('viatura', perto(del, grandes), false, 2, 9); ronda('viatura', grandes[Math.floor(grandes.length * 0.7)], true, 1, 8.5); }
    if (hos) ronda('ambulancia', perto(hos, voltas.filter((v) => v.n === 2)), false, 1, 10);
    if (bom) ronda('caminhao', perto(bom, voltas.filter((v) => v.n === 4)), true, 1, 8);
    // estacionados
    const RUMO = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
    const parado = (tipo, vg, c) => poe(tipo, { x: vg[0] + 0.5, z: vg[1] + 0.5, h: RUMO[vg[2] & 3], cor: c });
    if (del) del.vagas.forEach((vg, i) => { if (i % 3 !== 2) parado('viatura', vg); });
    if (bom) bom.vagas.forEach((vg) => parado('caminhao', vg));
    if (hos) hos.vagas.forEach((vg, i) => { if (i < 3) { if (i !== 1) parado('ambulancia', vg); } else if (hash(i, 77) < 0.6) parado('carro', vg, CORES[Math.floor(hash(i, 78) * CORES.length)]); });
    const aer = achar('aeroporto');
    if (aer) aer.vagas.forEach((vg, i) => { if (hash(i, 91) < 0.7) parado('carro', vg, CORES[Math.floor(hash(i, 92) * CORES.length)]); });
    // malhas instanciadas por tipo
    for (const [tipo, n] of Object.entries(conta)) {
      const G = MODELOS[tipo](), malhas = [];
      const mk = (geo, mat, nome) => { const m = new THREE.InstancedMesh(geo, mat, n); m.name = 'transito-' + tipo + '-' + nome; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.count = n; scene.add(m); malhas.push(m); return m; };
      const t = {
        corpo: mk(G.corpo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 }), 'corpo'),
        escuro: mk(G.escuro, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), 'escuro'),
        luzes: mk(G.luzes, new THREE.MeshBasicMaterial({ vertexColors: true }), 'luzes'),
        malhas, i: 0,
      };
      if (G.a) { t.a = mk(G.a, new THREE.MeshBasicMaterial({ color: '#fff' }), 'sireneA'); t.b = mk(G.b, new THREE.MeshBasicMaterial({ color: '#fff' }), 'sireneB'); }
      M.tipos[tipo] = t;
    }
    const corPadrao = { viatura: '#f4f5f7', ambulancia: '#f7f7f5', caminhao: '#c61f1f' };
    for (const v of veic) {
      const t = M.tipos[v.tipo]; v.i = t.i++;
      cor.set(v.cor || corPadrao[v.tipo] || '#ffffff'); t.corpo.setColorAt(v.i, cor);
      if (t.a) { cor.set('#333'); t.a.setColorAt(v.i, cor); t.b.setColorAt(v.i, cor); }
      for (const m of t.malhas) m.setMatrixAt(v.i, ZERO);
    }
    for (const t of Object.values(M.tipos)) for (const m of t.malhas) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // aeroporto: aviões nas pontes de embarque e o do circuito
    if (aer?.posicoes) {
      ['#1f4b8f', '#c81e1e', '#2f8f4a'].forEach((c, i) => {
        const p = aer.posicoes[i]; if (!p) return;
        const g = aviao(c); g.position.set(p[0] + 0.5, Y + g.userData.alturaRodas, p[1] + 3.5); g.rotation.y = Math.PI; scene.add(g); M.grupos.push(g);
      });
      if (aer.pista) {
        const g = aviao('#e0a21f'); scene.add(g); M.grupos.push(g);
        M.circuito = circuito(aer.pista, g.userData.alturaRodas); M.avioes.push(g);
      }
    }
    if (hos) {
      const h = helicoptero(); h.position.set(hos.x + 0.5, 78, hos.z + 0.5 - 4); h.rotation.y = Math.PI / 2; scene.add(h); M.grupos.push(h); M.heli = h;
    }
  }
  // circuito de toque e arremetida: pouso de oeste, corrida, decolagem para leste, curva pela direita sobre o mar
  // (lado sul), perna do vento a 440 m da pista, curva e reta final descendo; tudo em 3D e fechado
  function circuito(P, hr) {
    const z = P.z + 0.5, xT = P.x0 + 35, xL = P.x0 + 230, yc = P.y + hr, R = 220, alto = 75;
    const pts = [];
    const reta = (x0, y0, z0, x1, y1, z1, n) => { for (let i = 0; i < n; i++) { const t = i / n; pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t]); } };
    const arco = (cx, cz, a0, a1, y, n) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cx + Math.cos(a) * R, y, cz + Math.sin(a) * R]); } };
    reta(xT, yc, z, xL, yc, z, 20);                                   // no chão
    reta(xL, yc, z, xL + 520, yc + alto, z, 20);                      // subida
    arco(xL + 520, z + R, -Math.PI / 2, Math.PI / 2, yc + alto, 30);  // curva à direita (para o sul e para oeste)
    reta(xL + 520, yc + alto, z + 2 * R, xT - 560, yc + alto, z + 2 * R, 30);   // perna do vento
    arco(xT - 560, z + R, Math.PI / 2, Math.PI * 1.5, yc + alto, 30); // curva para leste
    reta(xT - 560, yc + alto, z, xT, yc, z, 24);                      // final, descendo
    const seg = []; let L = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); seg.push({ a, b, d, s: L }); L += d; }
    const em = (s) => {
      s = ((s % L) + L) % L; let lo = 0, hi = seg.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (seg[m].s <= s) lo = m; else hi = m - 1; }
      const g = seg[lo], t = (s - g.s) / g.d; return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t, g.a[2] + (g.b[2] - g.a[2]) * t];
    };
    return { L, em, vel: 42 };
  }

  let pisca = 0;
  game.hooks.frame.push((dt) => {
    if (game.gen !== genRef) { genRef = game.gen; monta(game.gen); }
    if (!M) return;
    camera.getWorldPosition(cam);
    const longe = Math.hypot(cam.x - M.il.x, cam.z - M.il.z);
    if (longe > M.il.r + LONGE) { if (M.pronto) for (const g of M.grupos) g.visible = false; for (const t of Object.values(M.tipos)) for (const m of t.malhas) m.visible = false; return; }
    if (!M.pronto) prepara();
    for (const t of Object.values(M.tipos)) for (const m of t.malhas) m.visible = true;
    for (const g of M.grupos) g.visible = true;
    const agora = Date.now() / 1000;
    pisca += dt;
    const fase = Math.floor(pisca * 3) & 1;
    const mexidos = new Set();
    for (const v of M.veic) {
      const t = M.tipos[v.tipo];
      let x, z, h;
      if (v.p) { noPercurso(v.p, v.fase + agora * v.vel, pt); x = pt.x; z = pt.z; h = pt.h; } else { x = v.x; z = v.z; h = v.h; }
      const visivel = Math.hypot(x - cam.x, z - cam.z) < VE && world.chunks.get(ckey(Math.floor(x / 16), Math.floor(z / 16)))?.hasMesh;
      if (!visivel) { if (v.vis) { for (const m of t.malhas) m.setMatrixAt(v.i, ZERO); v.vis = false; mexidos.add(t); } continue; }
      if (!v.p && v.vis) continue;                 // parado e já posto
      O.position.set(x, Y, z); O.rotation.set(0, h, 0); O.scale.set(1, 1, 1); O.updateMatrix();
      for (const m of t.malhas) m.setMatrixAt(v.i, O.matrix);
      v.vis = true; mexidos.add(t);
    }
    // sirenes: piscam alternando (as das viaturas paradas ficam apagadas)
    for (const [tipo, t] of Object.entries(M.tipos)) {
      if (!t.a) continue;
      const [c1, c2] = SIRENE[tipo];
      for (const v of M.veic) {
        if (v.tipo !== tipo || !v.vis) continue;
        if (!v.sirene) continue;
        cor.set(fase ? c1 : '#331010'); t.a.setColorAt(v.i, cor);
        cor.set(fase ? '#101833' : c2); t.b.setColorAt(v.i, cor);
      }
      t.a.instanceColor.needsUpdate = true; t.b.instanceColor.needsUpdate = true;
    }
    for (const t of mexidos) for (const m of t.malhas) m.instanceMatrix.needsUpdate = true;
    // avião do circuito: rumo pela tangente, nariz pela subida, asa inclinada nas curvas
    if (M.circuito) {
      const C = M.circuito, g = M.avioes[0], s = agora * C.vel;
      const a = C.em(s - 6), b = C.em(s + 6), c = C.em(s), d = C.em(s + 30);
      g.position.set(c[0], c[1], c[2]);
      const h = Math.atan2(b[0] - a[0], b[2] - a[2]), h2 = Math.atan2(d[0] - c[0], d[2] - c[2]);
      let dh = h2 - h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      const subida = Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2]));
      g.rotation.set(0, 0, 0); g.rotation.order = 'YXZ'; g.rotation.y = h; g.rotation.x = -subida; g.rotation.z = Math.max(-0.5, Math.min(0.5, -dh * 2.2));
      g.visible = Math.hypot(c[0] - cam.x, c[2] - cam.z) < 2500;
    }
    if (M.heli) M.heli.userData.rotor.rotation.y += dt * 0.8;
  });
}
