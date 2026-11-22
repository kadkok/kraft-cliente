// LAVRA — plantas com corpo 3D (pedido direto do Kadmus ao Claude, 17/11/2026: "redesenhe toda a vida natural vegetal
// que ainda não está tridimensional, nada deve ser sem corpo 3d").
//
// Cada planta é geometria de verdade, montada aqui por código (nada de foto em plano cruzado):
//   capim       touceira de lâminas afiladas com vinco no meio (seção em V), curvas para fora, base escura e ponta seca
//   samambaia   frondes em arco a partir de uma coroa; ráquis em tubo e folíolos em pares, que diminuem até a ponta
//   flores      caule em tubo, folhas lanceoladas em V e flor com pétalas em concha e miolo em volume:
//               amarela = ranúnculo (5 pétalas lustrosas), vermelha = papoula (4 pétalas largas, miolo escuro com
//               estames), azul = centáurea (florzinhas em funil com borda recortada), branca = margarida
//   arbusto     galhos secos ramificados em tubos afilados
//   taboa       (o antigo "junco") folhas em fita, hastes e espiga marrom de taboa; pilha de 2 células = mais alta
// Duas versões de cada: perto (detalhe cheio) e longe (poucas faces). Três variações por tipo, giro, tamanho e
// deslocamento sorteados pela posição (o mesmo lugar dá sempre a mesma planta em qualquer aparelho).
//
// Física e lógica não mudam: a célula continua sendo o bloco de sempre (sem colisão, quebra, item, leis). O corpo
// verga com o vento do tempo (`game.weather.wind`) e abre caminho quando alguém passa por dentro (o jogador e os
// bichos por perto empurram a planta para longe de si; ela volta quando saem).
//
// Entrada: `chunk.plants` do mesher (contrato em shared/plantas.js), pelo ouvinte `world.listeners.models` (encadeado).
import * as THREE from '../three.js';
import { PLANTA_3D, PASSO_PLANTA } from '../../shared/plantas.js';
import { CW } from '../../shared/constants.js';

// ---------------------------------------------------------------------------------------------------------------
// sorteio fixo
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashCel(x, y, z) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0;
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const cor = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const misturaCor = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---------------------------------------------------------------------------------------------------------------
// montador de malha: posição, cor por vértice e "flex" (0 = preso ao chão … 1 = ponta livre, para o vento)
class Malha {
  constructor() { this.p = []; this.c = []; this.f = []; this.i = []; this.n = 0; }
  v(p, c, f) { this.p.push(p.x, p.y, p.z); this.c.push(c[0], c[1], c[2]); this.f.push(f); return this.n++; }
  t(a, b, c) { this.i.push(a, b, c); }
  q(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.f, 1));
    g.setIndex(this.i); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

// curva de Bézier quadrática/cúbica amostrada
function bezier(pts, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    if (pts.length === 3) out.push(V().addScaledVector(pts[0], u * u).addScaledVector(pts[1], 2 * u * t).addScaledVector(pts[2], t * t));
    else out.push(V().addScaledVector(pts[0], u * u * u).addScaledVector(pts[1], 3 * u * u * t).addScaledVector(pts[2], 3 * u * t * t).addScaledVector(pts[3], t * t * t));
  }
  return out;
}

// fita com vinco (seção em V): folha, lâmina de capim, folíolo. `larg(t)` largura, `cor(t)`, `flex(t)`; `lado` = vetor
// lateral de referência; `vinco` = profundidade do V em proporção da largura.
function fita(m, cam, larg, corDe, flexDe, lado, vinco = 0.22, torcao = 0) {
  const n = cam.length - 1;
  let ant = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = cam[k];
    const tan = (k < n ? cam[k + 1].clone().sub(p) : p.clone().sub(cam[k - 1])).normalize();
    let s = lado.clone().addScaledVector(tan, -lado.dot(tan));
    if (s.lengthSq() < 1e-8) s = V(1, 0, 0); s.normalize();
    if (torcao) s.applyAxisAngle(tan, torcao * t);
    const nrm = V().crossVectors(tan, s).normalize();
    const w = larg(t) * 0.5, c = corDe(t), f = flexDe(t), cl = misturaCor(c, [c[0] * 0.78, c[1] * 0.82, c[2] * 0.78], 0.6);
    const e = m.v(p.clone().addScaledVector(s, -w).addScaledVector(nrm, w * vinco * 2), cl, f);
    const meio = m.v(p, c, f);
    const d = m.v(p.clone().addScaledVector(s, w).addScaledVector(nrm, w * vinco * 2), cl, f);
    if (ant) { m.q(ant[0], ant[1], meio, e); m.q(ant[1], ant[2], d, meio); }
    ant = [e, meio, d];
  }
}

// tubo afilado ao longo de um caminho: caule, ráquis, galho
function tubo(m, cam, raio, corDe, flexDe, lados = 5) {
  const n = cam.length - 1;
  let ant = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = cam[k];
    const tan = (k < n ? cam[k + 1].clone().sub(p) : p.clone().sub(cam[k - 1])).normalize();
    const a = Math.abs(tan.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
    const u = V().crossVectors(tan, a).normalize(), w = V().crossVectors(tan, u).normalize();
    const r = raio(t), c = corDe(t), f = flexDe(t), anel = [];
    for (let j = 0; j < lados; j++) {
      const ang = (j / lados) * Math.PI * 2;
      anel.push(m.v(p.clone().addScaledVector(u, Math.cos(ang) * r).addScaledVector(w, Math.sin(ang) * r), c, f));
    }
    if (ant) for (let j = 0; j < lados; j++) { const j2 = (j + 1) % lados; m.q(ant[j], ant[j2], anel[j2], anel[j]); }
    ant = anel;
  }
  return ant;
}

// pétala: superfície em grade. Origem `o`, direção `dir` (comprimento), `up` (normal da face), contorno `larg(t)`,
// concha (curva para cima nas bordas), arco (a pétala sobe/desce ao longo do comprimento) e ondulação da borda.
function petala(m, o, dir, up, L, larg, corDe, flex, { concha = 0.3, arco = 0, onda = 0, fase = 0, lin = 5, col = 4 } = {}) {
  const lado = V().crossVectors(up, dir).normalize();
  const grade = [];
  for (let a = 0; a <= lin; a++) {
    const t = a / lin, linha = [];
    const w = larg(t) * L;
    for (let b = 0; b <= col; b++) {
      const s = (b / col) * 2 - 1;
      const p = o.clone().addScaledVector(dir, t * L).addScaledVector(lado, s * w * 0.5)
        .addScaledVector(up, (concha * s * s * w) + arco * t * t * L + onda * Math.sin(s * 3.1 + fase + t * 2) * w * 0.25 * t);
      linha.push(m.v(p, corDe(t, s), flex));
    }
    grade.push(linha);
  }
  for (let a = 0; a < lin; a++) for (let b = 0; b < col; b++) m.q(grade[a][b], grade[a][b + 1], grade[a + 1][b + 1], grade[a + 1][b]);
}

// domo/esfera achatada: miolo de flor, espiga
function domo(m, c, r, alt, corDe, flex, seg = 7, aneis = 3, base = 0) {
  const topo = m.v(c.clone().add(V(0, alt, 0)), corDe(1), flex);
  let ant = null;
  for (let a = aneis; a >= base; a--) {
    const fi = (a / (aneis + 1)) * Math.PI * 0.5, anel = [];
    for (let j = 0; j < seg; j++) { const ang = (j / seg) * Math.PI * 2; anel.push(m.v(c.clone().add(V(Math.cos(ang) * r * Math.cos(fi), Math.sin(fi) * alt, Math.sin(ang) * r * Math.cos(fi))), corDe(a / aneis), flex)); }
    if (!ant) for (let j = 0; j < seg; j++) m.t(topo, anel[(j + 1) % seg], anel[j]);
    else for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.q(ant[j], ant[j2], anel[j2], anel[j]); }
    ant = anel;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// paletas (sempre em degradê: nunca cor chapada)
const ESC_FLOR = 3.0;
// contorno de pétala de ponta redonda (ranúnculo, papoula): larga perto da ponta, fecha num arco
const redonda = (k) => (t) => k * Math.sqrt(Math.max(0, Math.min(1, t * 1.6)) * Math.max(0, 1.04 - t * t * t));
const VERDE = { base: cor('#203a1a'), meio: cor('#3f6a2a'), ponta: cor('#86a14a'), seca: cor('#b5aa63') };

function capim(r, perto) {
  const m = new Malha(), n = perto ? 18 + Math.floor(r() * 8) : 7, seg = perto ? 5 : 2;
  for (let k = 0; k < n; k++) {
    const ang = r() * Math.PI * 2, raioBase = r() * 0.13, h = 0.38 + r() * 0.5, curva = 0.12 + r() * 0.3;
    const d = V(Math.cos(ang), 0, Math.sin(ang)), b = d.clone().multiplyScalar(raioBase);
    const cam = bezier([b, b.clone().add(V(0, h * 0.55, 0)).addScaledVector(d, curva * 0.25), b.clone().add(V(0, h, 0)).addScaledVector(d, curva)], seg);
    const seco = r() < 0.25;
    fita(m, cam, (t) => (0.028 + r() * 0.004) * (1 - t * 0.92), (t) => t < 0.5 ? misturaCor(VERDE.base, VERDE.meio, t * 2) : misturaCor(VERDE.meio, seco ? VERDE.seca : VERDE.ponta, (t - 0.5) * 2),
      (t) => t * t, V(-d.z, 0, d.x), 0.28, (r() - 0.5) * 1.2);
  }
  return m.geo();
}

function samambaia(r, perto) {
  const m = new Malha(), n = 6 + Math.floor(r() * 4), seg = perto ? 8 : 4, pares = perto ? 13 : 0;
  const raq = cor('#3b4a20'), f0 = cor('#24481c'), f1 = cor('#4f8a34'), f2 = cor('#7ea64a');
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2 + r() * 0.5, L = 0.5 + r() * 0.35, ab = 0.35 + r() * 0.3;
    const d = V(Math.cos(ang), 0, Math.sin(ang));
    const cam = bezier([V(0, 0.02, 0), V(0, L * 0.85, 0).addScaledVector(d, L * ab * 0.4), V(0, L * 0.55, 0).addScaledVector(d, L * (ab + 0.35))], seg);
    if (perto) tubo(m, cam, (t) => 0.007 * (1 - t * 0.7), (t) => misturaCor(raq, f1, t * 0.5), (t) => t * t, 4);
    const lado = V(-d.z, 0, d.x);
    if (!perto) { fita(m, cam, (t) => 0.16 * Math.sin(Math.PI * (0.12 + 0.88 * t)) * (1 - t * 0.5), (t) => misturaCor(f0, f2, t), (t) => t * t, lado, 0.35); continue; }
    for (let j = 1; j <= pares; j++) {
      const t = j / (pares + 1), i0 = Math.min(seg - 1, Math.floor(t * seg)), fr = t * seg - i0;
      const p = cam[i0].clone().lerp(cam[i0 + 1], fr), tan = cam[i0 + 1].clone().sub(cam[i0]).normalize();
      const comp = 0.11 * Math.sin(Math.PI * (0.18 + 0.8 * t)) * (1 - t * 0.35);
      for (const lsg of [-1, 1]) {
        const dir = lado.clone().multiplyScalar(lsg).addScaledVector(tan, 0.45).addScaledVector(V(0, -1, 0), 0.15).normalize();
        const cf = bezier([p, p.clone().addScaledVector(dir, comp * 0.5), p.clone().addScaledVector(dir, comp).add(V(0, -comp * 0.25, 0))], 2);
        fita(m, cf, (u) => 0.03 * (1 - u * 0.8) * (0.6 + 0.4 * (1 - t)), (u) => misturaCor(misturaCor(f0, f1, t), f2, u * 0.6), () => t * t, tan, 0.3);
      }
    }
  }
  // brotos enrolados (báculos) no meio da coroa
  if (perto) for (let k = 0; k < 2; k++) {
    const a = r() * 6.28, cam = []; for (let s = 0; s <= 10; s++) { const t = s / 10, h = 0.18 + 0.05 * k; cam.push(t < 0.6 ? V(0, h * (t / 0.6), 0) : V(Math.cos(a) * 0.035 * Math.sin((t - 0.6) * 9), h + 0.035 * (1 - Math.cos((t - 0.6) * 9)), Math.sin(a) * 0.035 * Math.sin((t - 0.6) * 9))); }
    tubo(m, cam, (t) => 0.006 * (1 - t * 0.4), (t) => misturaCor(f1, f2, t), (t) => t * 0.5, 4);
  }
  return m.geo();
}

// flor genérica: caule + folhas + cabeça montada por `cabeca(m, topo, eixo, r)`
function flor(r, perto, cabeca, { hastes = [2, 3], altura = [0.28, 0.5], folhas = 2 } = {}) {
  const m = new Malha(), n = hastes[0] + Math.floor(r() * (hastes[1] - hastes[0] + 1));
  const caule0 = cor('#2c4a1f'), caule1 = cor('#5b8a3a');
  for (let k = 0; k < n; k++) {
    const ang = r() * 6.28, rb = k === 0 ? 0 : 0.06 + r() * 0.12, h = mix(altura[0], altura[1], r()), inc = 0.05 + r() * 0.12;
    const d = V(Math.cos(ang), 0, Math.sin(ang)), b = d.clone().multiplyScalar(rb);
    const cam = bezier([b, b.clone().add(V(0, h * 0.6, 0)), b.clone().add(V(0, h, 0)).addScaledVector(d, inc)], perto ? 6 : 2);
    tubo(m, cam, (t) => (perto ? 0.0045 : 0.006) * (1 - t * 0.3), (t) => misturaCor(caule0, caule1, t), (t) => t * t, perto ? 5 : 3);
    const topo = cam[cam.length - 1], eixo = topo.clone().sub(cam[cam.length - 2]).normalize().multiplyScalar(0.35).add(V(0, 0.65, 0)).normalize();   // flor se volta para o céu
    // a cabeça é montada na origem e posta no topo do caule ampliada: no tamanho natural (3–5 cm) a flor some num
    // mundo de blocos de 1 m; ESC_FLOR a deixa legível como a flor de antes, sem mudar o desenho
    const mh = new Malha(); cabeca(mh, V(), eixo, r, perto);
    const base0 = m.n;
    for (let k = 0; k < mh.n; k++) m.v(V(mh.p[k * 3], mh.p[k * 3 + 1], mh.p[k * 3 + 2]).multiplyScalar(ESC_FLOR).add(topo), [mh.c[k * 3], mh.c[k * 3 + 1], mh.c[k * 3 + 2]], mh.f[k]);
    for (const i of mh.i) m.i.push(base0 + i);
    for (let j = 0; j < folhas; j++) {
      const fa = ang + 1.4 + j * 2.6 + r() * 0.6, fd = V(Math.cos(fa), 0, Math.sin(fa)), base = b.clone().add(V(0, 0.02 + j * h * 0.18, 0));
      const L = 0.12 + r() * 0.1, cf = bezier([base, base.clone().addScaledVector(fd, L * 0.5).add(V(0, L * 0.45, 0)), base.clone().addScaledVector(fd, L).add(V(0, L * 0.1, 0))], perto ? 4 : 2);
      fita(m, cf, (t) => 0.045 * Math.sin(Math.PI * Math.min(1, 0.1 + t)) * (1 - t * 0.3), (t) => misturaCor(caule0, VERDE.ponta, t * 0.8), (t) => t * t * 0.6, V(-fd.z, 0, fd.x), 0.3);
    }
  }
  return m.geo();
}
// base ortonormal para uma cabeça de flor voltada para `eixo`
function baseDe(eixo) {
  const a = Math.abs(eixo.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = V().crossVectors(eixo, a).normalize(), w = V().crossVectors(eixo, u).normalize();
  return [u, w];
}
function coroa(m, topo, eixo, n, { L, larg, concha, arco, onda = 0, corDe, inclina = 0.15, lin = 5, col = 4, giro = 0 }) {
  const [u, w] = baseDe(eixo);
  for (let k = 0; k < n; k++) {
    const a = giro + (k / n) * Math.PI * 2;
    const radial = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
    const dir = radial.clone().addScaledVector(eixo, inclina).normalize();
    const up = V().crossVectors(dir, V().crossVectors(eixo, dir)).normalize();
    petala(m, topo.clone().addScaledVector(radial, 0.004), dir, up.dot(eixo) < 0 ? up.negate() : up, L, larg, corDe, 1, { concha, arco, onda, fase: k * 1.7, lin, col });
  }
}

const cabecas = {
  flor_amarela: (m, topo, eixo, r, perto) => {   // ranúnculo: 5 pétalas redondas em taça, lustrosas
    const p0 = cor('#c99a12'), p1 = cor('#ffd93a');
    coroa(m, topo, eixo, 5, { L: 0.026, larg: redonda(1.05), concha: 0.35, arco: 0.3, inclina: 0.35, corDe: (t) => misturaCor(p0, p1, Math.min(1, t * 1.6)), lin: perto ? 4 : 1, col: perto ? 4 : 1, giro: r() * 6 });
    if (perto) domo(m, topo.clone().addScaledVector(eixo, 0.004), 0.008, 0.007, (t) => misturaCor(cor('#6b8a1a'), cor('#e0c030'), t), 1, 6, 2);
  },
  flor_vermelha: (m, topo, eixo, r, perto) => {   // papoula: 4 pétalas largas e onduladas, miolo escuro com estames
    const p0 = cor('#3a0a0a'), p1 = cor('#b3141a'), p2 = cor('#e8322b');
    coroa(m, topo, eixo, 4, { L: 0.042, larg: redonda(1.3), concha: 0.3, arco: 0.4, onda: 0.5, inclina: 0.4, corDe: (t) => t < 0.15 ? misturaCor(p0, p1, t / 0.15) : misturaCor(p1, p2, (t - 0.15) / 0.85), lin: perto ? 5 : 1, col: perto ? 5 : 1, giro: r() * 6 });
    if (perto) {
      domo(m, topo.clone().addScaledVector(eixo, 0.006), 0.008, 0.009, (t) => misturaCor(cor('#2b3a1a'), cor('#5a6a3a'), t), 1, 6, 2);
      const [u, w] = baseDe(eixo);
      for (let k = 0; k < 10; k++) { const a = k * 0.63, p = topo.clone().addScaledVector(eixo, 0.006); const fim = p.clone().addScaledVector(u, Math.cos(a) * 0.012).addScaledVector(w, Math.sin(a) * 0.012).addScaledVector(eixo, 0.01); tubo(m, [p, fim], () => 0.0012, () => cor('#141018'), () => 1, 3); }
    }
  },
  flor_azul: (m, topo, eixo, r, perto) => {   // centáurea: florzinhas em funil com borda recortada, em roda
    const p0 = cor('#1b2f8a'), p1 = cor('#3f6fe0'), p2 = cor('#8fb2ff');
    const n = perto ? 9 : 6, [u, w] = baseDe(eixo);
    if (!perto) { coroa(m, topo, eixo, 6, { L: 0.024, larg: () => 0.7, concha: 0.3, arco: 0.2, corDe: (t) => misturaCor(p0, p1, t), lin: 1, col: 1 }); return; }
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + r() * 0.2, rad = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      const dir = rad.clone().addScaledVector(eixo, 0.35).normalize(), base = topo.clone().addScaledVector(rad, 0.004);
      // funil: anel que abre, com 4 dentes na boca
      const cam = [base, base.clone().addScaledVector(dir, 0.012), base.clone().addScaledVector(dir, 0.022)];
      tubo(m, cam, (t) => 0.0025 + t * t * 0.0075, (t) => misturaCor(p0, p1, t), () => 1, 5);
      const boca = cam[2], [bu, bw] = baseDe(dir);
      for (let d = 0; d < 4; d++) { const da = d * 1.5708 + 0.4, rd = bu.clone().multiplyScalar(Math.cos(da)).addScaledVector(bw, Math.sin(da)); petala(m, boca.clone().addScaledVector(rd, 0.008), rd.clone().addScaledVector(dir, 0.6).normalize(), dir, 0.007, (t) => 0.9 * (1 - t), (t) => misturaCor(p1, p2, t), 1, { concha: 0.1, lin: 1, col: 1 }); }
    }
    domo(m, topo.clone().addScaledVector(eixo, 0.004), 0.008, 0.008, (t) => misturaCor(cor('#1a1450'), cor('#4a3a9a'), t), 1, 6, 2);
  },
  flor_branca: (m, topo, eixo, r, perto) => {   // margarida: muitas pétalas finas brancas e miolo amarelo em cúpula
    const p0 = cor('#cfd6c8'), p1 = cor('#fbfbf4');
    coroa(m, topo, eixo, perto ? 18 : 10, { L: 0.04, larg: (t) => 0.36 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)))), concha: 0.25, arco: -0.08, inclina: 0.08, corDe: (t) => misturaCor(p0, p1, Math.min(1, t * 2)), lin: perto ? 3 : 1, col: perto ? 2 : 1, giro: r() * 6 });
    domo(m, topo.clone().addScaledVector(eixo, 0.002), 0.013, 0.009, (t) => misturaCor(cor('#c88a0a'), cor('#f2c230'), t), 1, perto ? 8 : 5, perto ? 3 : 1);
  },
};

function arbusto(r, perto) {
  const m = new Malha(), c0 = cor('#4a3c2c'), c1 = cor('#8a7658'), c2 = cor('#a8987a');
  const galho = (p, d, L, raio, nivel, flexBase) => {
    const curva = V((r() - 0.5) * 0.3, 0.1, (r() - 0.5) * 0.3);
    const fim = p.clone().addScaledVector(d, L), cam = bezier([p, p.clone().addScaledVector(d, L * 0.5).addScaledVector(curva, L), fim], perto ? 3 : 1);
    const f1 = Math.min(1, flexBase + 0.35);
    tubo(m, cam, (t) => raio * (1 - t * 0.55), (t) => misturaCor(nivel === 0 ? c0 : c1, nivel >= 2 ? c2 : c1, t), (t) => mix(flexBase, f1, t), perto ? 4 : 3);
    if (nivel >= (perto ? 3 : 1)) return;
    const filhos = 2 + Math.floor(r() * 2);
    for (let k = 0; k < filhos; k++) {
      const nd = d.clone().add(V((r() - 0.5) * 1.3, 0.2 + r() * 0.3, (r() - 0.5) * 1.3)).normalize();
      galho(fim, nd, L * (0.55 + r() * 0.2), raio * 0.6, nivel + 1, f1);
    }
  };
  const troncos = 3 + Math.floor(r() * 3);
  for (let k = 0; k < troncos; k++) { const a = r() * 6.28; galho(V(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), V(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize(), 0.18 + r() * 0.12, 0.012, 0, 0); }
  return m.geo();
}

function taboa(r, perto) {
  const m = new Malha(), f0 = cor('#2a4220'), f1 = cor('#55783a'), f2 = cor('#9aa25a');
  const folhas = perto ? 8 + Math.floor(r() * 4) : 5;
  for (let k = 0; k < folhas; k++) {
    const ang = r() * 6.28, h = 0.75 + r() * 0.55, d = V(Math.cos(ang), 0, Math.sin(ang)), b = d.clone().multiplyScalar(r() * 0.1);
    const cam = bezier([b, b.clone().add(V(0, h * 0.6, 0)), b.clone().add(V(0, h, 0)).addScaledVector(d, 0.08 + r() * 0.25)], perto ? 6 : 2);
    fita(m, cam, (t) => 0.034 * (1 - t * t * 0.9), (t) => t < 0.4 ? misturaCor(f0, f1, t / 0.4) : misturaCor(f1, f2, (t - 0.4) / 0.6), (t) => t * t, V(-d.z, 0, d.x), 0.3, (r() - 0.5) * 2);
  }
  const hastes = 1 + Math.floor(r() * 2);
  for (let k = 0; k < hastes; k++) {
    const a = r() * 6.28, b = V(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), h = 0.95 + r() * 0.35;
    const cam = bezier([b, b.clone().add(V(0, h * 0.5, 0)), b.clone().add(V((r() - 0.5) * 0.06, h, (r() - 0.5) * 0.06))], perto ? 6 : 2);
    tubo(m, cam, () => 0.0065, (t) => misturaCor(f1, f2, t), (t) => t * t, perto ? 5 : 3);
    // espiga marrom (taboa) e o espinho fino acima
    const topo = cam[cam.length - 1], dir = topo.clone().sub(cam[cam.length - 2]).normalize();
    const ini = topo.clone().addScaledVector(dir, -0.2), fim = topo.clone().addScaledVector(dir, -0.03);
    const esp = [], ne = perto ? 6 : 2; for (let s = 0; s <= ne; s++) esp.push(ini.clone().lerp(fim, s / ne));
    tubo(m, esp, (t) => 0.021 * Math.sqrt(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.9))), (t) => misturaCor(cor('#3a2414'), cor('#6b4426'), 0.5 + 0.5 * Math.sin(t * 9)), () => 1, perto ? 7 : 4);
    tubo(m, [fim, topo, topo.clone().addScaledVector(dir, 0.1)], (t) => 0.003 * (1 - t), () => cor('#7a6a4a'), () => 1, 3);
  }
  return m.geo();
}

const CONSTRUTOR = {
  capim, samambaia, arbusto_seco: arbusto, taboa,
  flor_amarela: (r, p) => flor(r, p, cabecas.flor_amarela, { hastes: [2, 4], altura: [0.22, 0.42] }),
  flor_vermelha: (r, p) => flor(r, p, cabecas.flor_vermelha, { hastes: [1, 3], altura: [0.35, 0.6] }),
  flor_azul: (r, p) => flor(r, p, cabecas.flor_azul, { hastes: [2, 3], altura: [0.3, 0.5] }),
  flor_branca: (r, p) => flor(r, p, cabecas.flor_branca, { hastes: [2, 4], altura: [0.2, 0.4] }),
};
const VARIACOES = 3;
// para o laboratório (public/lab/plantas.html) e testes: a geometria de um tipo/variação, perto ou longe
export function geometriaPlanta(tipo, v = 0, perto = true) {
  const s = hashCel(v * 977, tipo.length * 131, tipo.charCodeAt(0) * 7 + tipo.charCodeAt(tipo.length - 1));
  return CONSTRUTOR[tipo](rng(s), perto);
}
export const TIPOS_PLANTA = Object.keys(CONSTRUTOR);

// ---------------------------------------------------------------------------------------------------------------
export function initPlantas3d({ scene, world, camera, game, quality, player }) {
  const perfil = quality?.name || 'media';
  const RAIO_PERTO0 = { alta: 34, media: 24, baixa: 14 }[perfil] ?? 18;
  const RAIO_LONGE0 = Math.min(game?.plataforma === 'visor' ? 48 : game?.plataforma === 'celular' ? 80 : 150, Math.max(40, (quality?.distance || 6) * CW * 0.9));   // plataforma
  let RAIO_PERTO = RAIO_PERTO0, RAIO_LONGE = RAIO_LONGE0;   // setEscala (regulador do VR, game/vr-desempenho.js) encolhe os dois
  const sombra = !!quality?.shadow && perfil === 'alta';

  const U = { uPTempo: { value: 0 }, uPVento: { value: new THREE.Vector2() }, uPEmpurra: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aFlex;
uniform float uPTempo; uniform vec2 uPVento; uniform vec4 uPEmpurra[8];`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 raiz = instanceMatrix[3].xyz;
  float fase = dot(raiz.xz, vec2(0.71, 0.37));
  float rajada = 0.55 + 0.45 * sin(uPTempo * 0.9 + fase * 0.13) * sin(uPTempo * 0.37 + fase * 0.05);
  vec2 vento = uPVento * (0.012 + 0.02 * rajada) + vec2(sin(uPTempo * 1.6 + fase), cos(uPTempo * 1.3 + fase * 1.7)) * (0.018 + 0.006 * length(uPVento));
  vec2 empurra = vec2(0.0);
  for (int k = 0; k < 8; k++) {
    vec4 e = uPEmpurra[k];
    vec2 d = raiz.xz - e.xz; float dl = length(d);
    float alcance = e.w;
    float h = step(abs(raiz.y - e.y), 2.2);
    empurra += (dl > 1e-3 ? d / dl : vec2(0.7)) * (1.0 - smoothstep(alcance * 0.25, alcance, dl)) * h * 0.55;
  }
  float curva = aFlex * aFlex;
  vec2 desl = (vento + empurra) * curva;
  mat3 m3 = mat3(instanceMatrix);
  vec3 local = inverse(m3) * vec3(desl.x, 0.0, desl.y);
  transformed += local;
  transformed.y -= dot(desl, desl) * 0.6 * aFlex / max(0.2, length(m3[1]));
}
#endif`);
  };

  // geometrias: tipo → [variação] → { perto, longe }
  const geos = {};
  for (const tipo in CONSTRUTOR) {
    geos[tipo] = [];
    for (let v = 0; v < VARIACOES; v++) {
      const s = hashCel(v * 977, tipo.length * 131, tipo.charCodeAt(0) * 7 + tipo.charCodeAt(tipo.length - 1));
      geos[tipo].push({ perto: CONSTRUTOR[tipo](rng(s), true), longe: CONSTRUTOR[tipo](rng(s), false) });
    }
  }

  // malhas instanciadas: uma por (tipo, variação, distância); capacidade cresce sob demanda
  const grupo = new THREE.Group(); grupo.name = 'plantas3d'; scene.add(grupo);
  const malhas = new Map();
  function malhaDe(tipo, v, lod, preciso) {
    const k = tipo + v + lod;
    let mh = malhas.get(k);
    if (mh && mh.userData.cap >= preciso) return mh;
    const cap = Math.max(64, Math.ceil(preciso * 1.5));
    if (mh) { grupo.remove(mh); mh.dispose(); }
    mh = new THREE.InstancedMesh(geos[tipo][v][lod], material, cap);
    mh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mh.frustumCulled = false; mh.receiveShadow = true; mh.castShadow = false;   // planta pequena: recebe sombra, não projeta (leveza)
    mh.userData.cap = cap; mh.count = 0;
    grupo.add(mh); malhas.set(k, mh);
    return mh;
  }

  // plantas por pedaço, em coordenadas do mundo: [x, y, z, tipoIdx, luz, andares, sorteio]
  const TIPOS = Object.keys(CONSTRUTOR), IDX = Object.fromEntries(TIPOS.map((t, i) => [t, i]));
  const porPedaco = new Map();
  let sujo = true;
  function receber(chunk) {
    const lst = chunk && chunk.plants;
    if (!lst || !lst.length || !chunk.hasMesh) { if (porPedaco.delete(chunk.key)) sujo = true; return; }
    const n = lst.length / PASSO_PLANTA, out = new Float32Array(n * 7), ox = chunk.cx * CW, oz = chunk.cz * CW;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const o = i * PASSO_PLANTA, tipo = PLANTA_3D[lst[o + 3]]; if (!tipo) continue;
      const x = lst[o] + ox, y = lst[o + 1], z = lst[o + 2] + oz;
      out[j++] = x; out[j++] = y; out[j++] = z; out[j++] = IDX[tipo]; out[j++] = lst[o + 4]; out[j++] = lst[o + 5]; out[j++] = hashCel(x, Math.floor(y), z);
    }
    porPedaco.set(chunk.key, out.subarray(0, j)); sujo = true;
  }
  const anterior = world.listeners.models;
  const ouvinte = (chunk, models) => { anterior?.(chunk, models); if (!models) { if (porPedaco.delete(chunk.key)) sujo = true; } else receber(chunk); };
  world.listeners.models = ouvinte;
  for (const c of world.chunks.values()) if (c.hasMesh) receber(c);

  // remontar as instâncias em volta da câmera
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), esc = new THREE.Vector3(), pos = new THREE.Vector3(), eixoY = new THREE.Vector3(0, 1, 0);
  const centro = new THREE.Vector3(1e9, 0, 1e9), olho = new THREE.Vector3();
  // A câmera é filha do rig: camera.position fica perto de 0. As plantas estão no mundo.
  function olhoMundo() { return camera.getWorldPosition(olho); }
  let espera = 0;
  const contas = new Map();
  function remontar() {
    sujo = false; centro.copy(olhoMundo());
    contas.clear();
    const pend = [];
    for (const lst of porPedaco.values()) for (let o = 0; o < lst.length; o += 7) {
      const dx = lst[o] - centro.x + 0.5, dz = lst[o + 2] - centro.z + 0.5, d2 = dx * dx + dz * dz;
      if (d2 > RAIO_LONGE * RAIO_LONGE) continue;
      const tipo = TIPOS[lst[o + 3]], h = lst[o + 6], v = h % VARIACOES, lod = d2 < RAIO_PERTO * RAIO_PERTO ? 'perto' : 'longe';
      const k = tipo + v + lod; contas.set(k, (contas.get(k) || 0) + 1); pend.push(o, lst, k, tipo, v, lod);
    }
    for (const mh of malhas.values()) mh.count = 0;
    for (const [k, n] of contas) { const p = pend.indexOf(k); malhaDe(pend[p + 1], pend[p + 2], pend[p + 3], n); }
    for (let i = 0; i < pend.length; i += 6) {
      const o = pend[i], lst = pend[i + 1], mh = malhas.get(pend[i + 2]), tipo = pend[i + 3];
      const h = lst[o + 6], andares = lst[o + 5];
      const r1 = ((h >>> 3) & 1023) / 1023, r2 = ((h >>> 13) & 1023) / 1023, r3 = ((h >>> 23) & 511) / 511;
      const s = (tipo.startsWith('flor') ? 1.15 : 1) * (0.82 + r1 * 0.36), alto = tipo === 'taboa' ? 1 + (andares - 1) * 0.75 : 1 + (andares - 1) * 0.5;
      pos.set(lst[o] + 0.5 + (r2 - 0.5) * 0.3, lst[o + 1], lst[o + 2] + 0.5 + (r3 - 0.5) * 0.3);
      q.setFromAxisAngle(eixoY, r1 * 37.7 + r2 * 6.28);
      esc.set(s, s * alto * (0.9 + r3 * 0.2), s);
      mtx.compose(pos, q, esc);
      const n = mh.count++;
      mh.setMatrixAt(n, mtx);
      // luz da célula: céu (sombra de caverna/copa) e lâmpada (quente)
      const luz = lst[o + 4], ceu = (luz & 15) / 15, lamp = (luz >> 4) / 15;
      const b = 0.18 + 0.82 * ceu * ceu, l = lamp * lamp * 0.9;
      mh.instanceColor.setXYZ(n, Math.min(1.2, b + l), Math.min(1.2, b + l * 0.78), Math.min(1.2, b + l * 0.5));
    }
    for (const mh of malhas.values()) { mh.instanceMatrix.needsUpdate = true; mh.instanceColor.needsUpdate = true; mh.visible = mh.count > 0; }
  }

  // quem empurra as plantas: o jogador e os bichos mais perto (posições desenhadas de game.nature)
  const empurradores = [];
  function atualizarEmpurra() {
    empurradores.length = 0;
    const p = player?.pos || player?.position;
    if (p) empurradores.push([p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z, 0.9]);
    const N = game?.nature;
    if (N?.bodies && N?.groups) {
      const cx = olho.x, cz = olho.z, cand = [];
      for (const [gid, s] of N.bodies) {
        const g = N.groups.get(gid); if (!g || !s?.b) continue;
        for (let o = 1; o + 2 < s.b.length; o += 5) {
          const x = s.b[o] / 100, y = s.b[o + 1] / 100, z = s.b[o + 2] / 100, d = (x - cx) ** 2 + (z - cz) ** 2;
          if (d < 900) cand.push([x, y, z, 0.7, d]);
        }
      }
      cand.sort((a, b) => a[4] - b[4]);
      for (const c of cand) { if (empurradores.length >= 8) break; empurradores.push(c); }
    }
    for (let k = 0; k < 8; k++) { const e = empurradores[k]; U.uPEmpurra.value[k].set(e ? e[0] : 0, e ? e[1] : -999, e ? e[2] : 0, e ? e[3] : 0.0001); }
  }

  let t = 0;
  game.hooks.frame.push((dt) => {
    t += dt; U.uPTempo.value = t;
    const w = game.weather?.wind; if (w) U.uPVento.value.set(w[0] || 0, w[1] || 0);
    olhoMundo();
    atualizarEmpurra();
    grupo.visible = game.dim === 0 || game.dim === undefined || game.dim === 2 || game.dim >= 16;
    espera -= dt;
    const longe = Math.hypot(olho.x - centro.x, olho.z - centro.z) > 4;
    if ((sujo && espera <= 0) || longe) { remontar(); espera = 0.25; }
  });

  const api = {
    setEscala(f) { f = Math.max(0.2, Math.min(1, f || 1)); RAIO_PERTO = RAIO_PERTO0 * f; RAIO_LONGE = Math.max(24, RAIO_LONGE0 * f); sujo = true; },
    get total() { let n = 0; for (const mh of malhas.values()) n += mh.count; return n; },
    get malhas() { return malhas.size; },
    triangulos() { let n = 0; for (const mh of malhas.values()) n += mh.count * (mh.geometry.index.count / 3); return n; },
    dispose() { if (world.listeners.models === ouvinte) world.listeners.models = anterior; for (const mh of malhas.values()) { grupo.remove(mh); mh.dispose(); } scene.remove(grupo); for (const t in geos) for (const g of geos[t]) { g.perto.dispose(); g.longe.dispose(); } material.dispose(); },
  };
  if (game) game.plantas3d = api;
  return api;
}
