// LAVRA — coqueiros da praia do arquipélago (pedido do Kadmus, 19/11/2026: "PALMEIRAS E COQUEIROS TÍPICOS DE LITORAL").
// Feito pelo Claude a pedido direto dele. Geometria e deformação traduzidas de dgreenheck/tidewater (MIT, Copyright
// (c) 2026 DRG Software Solutions LLC): src/world/vegetation/PlantGeometry.js (coqueiro), VegNodes.js
// (vegPlantDeform) e VegMaterials.js (casca anelada, recorte dos folíolos).
//
// De onde vêm: o gerador marca as palmeiras da faixa de praia como tipo 5 (shared/worldgen.js → coqueiros(x, z, r));
// elas não viram blocos. Aqui cada uma vira um coqueiro de verdade: tronco anelado com raízes à mostra, curvado e
// inclinado para o mar, cacho de cocos, coroa de 18 folhas pinadas em espiral (as velhas pendem, algumas secas),
// tudo balançando com o vento do tempo do mundo. Projetam sombra (com o recorte das folhas) e recebem a do sol.
// Sem colisão (como as plantas 3D): é desenho. Sem mapa de arquipélago, nada aparece.
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';

const PART = { STEM: 0, FROND: 1, COCONUT: 5 };
const PALM_H = 10;
const PERTO = 42, LONGE = 175;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.veg = []; this.mat = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vertex(p, n, u, v, veg, mat) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.veg.push(veg[0], veg[1], veg[2], veg[3]); this.mat.push(mat[0], mat[1], mat[2], mat[3]);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.veg, 4));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setIndex(this.idx);
    return g;
  }
}
const _up = new THREE.Vector3(0, 1, 0), _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function addStem(b, { radial, rows, radius, Hgeo, mat, cap = true, lumps = null }) {
  const start = b.count;
  for (const u of rows) {
    const r = radius(u), du = 0.01, dr = (radius(u + du) - radius(u - du)) / (2 * du * Hgeo);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const rl = lumps ? r * (1 + lumps(u, a)) : r;
      _v0.set(c * rl, u * Hgeo, s * rl); _v1.set(c, -dr, s).normalize();
      b.vertex(_v0, _v1, i / radial, u, [u, 0, 0, 0], mat);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < radial; i++) {
    const a = start + j * (radial + 1) + i, c = a + radial + 1;
    b.quad(a, c, c + 1, a + 1);
  }
  if (cap) {
    const uTop = rows[rows.length - 1];
    const top = b.vertex(_v0.set(0, uTop * Hgeo, 0), _up, 0.5, uTop, [uTop + 0.015, 0, 0, 0], mat);
    const ring = start + (rows.length - 1) * (radial + 1);
    for (let i = 0; i < radial; i++) b.tri(ring + i, top, ring + i + 1);
  }
}
function addFrond(b, o) {
  const { origin, azimuth, elevation, bend, twist = 0, length, segs = 8, cross = 2, leafLen, leafAngle, droop, curl = 0.2,
    part = PART.FROND, age = 0, seed = 0, phase = 0, flutter = 1, minWidth = 0.035, bendPow = 1.4, roll = 0 } = o;
  const pts = [], p = origin.clone();
  for (let k = 0; k <= segs; k++) {
    pts.push(p.clone());
    const sm = (k + 0.5) / segs, el = elevation - bend * Math.pow(sm, bendPow), az = azimuth + twist * sm;
    _v0.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    p.addScaledVector(_v0, length / segs);
  }
  const azPerp = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
  const T = new THREE.Vector3(), S = new THREE.Vector3(), Nup = new THREE.Vector3(), side = new THREE.Vector3(), ld = new THREE.Vector3();
  for (const sigma of [-1, 1]) {
    const grid = [];
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      T.subVectors(pts[Math.min(segs, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      S.crossVectors(T, _up); if (S.lengthSq() < 0.04) S.copy(azPerp); S.normalize();
      Nup.crossVectors(S, T).normalize();
      const Ll = Math.max(leafLen(s), minWidth), al = leafAngle(s), be = droop(s) + sigma * roll * s * s;
      side.copy(S).multiplyScalar(sigma * Math.cos(be)).addScaledVector(Nup, -Math.sin(be));
      ld.copy(T).multiplyScalar(Math.cos(al)).addScaledVector(side, Math.sin(al)).normalize();
      const row = [];
      for (let j = 0; j <= cross; j++) {
        const t = j / cross;
        row.push({ q: pts[k].clone().addScaledVector(ld, Ll * t).addScaledVector(Nup, -Ll * curl * t * t), s, t, Ll, nup: Nup.clone() });
      }
      grid.push(row);
    }
    const idx = [];
    for (let k = 0; k <= segs; k++) {
      const r = [];
      for (let j = 0; j <= cross; j++) {
        const g = grid[k][j], ka = Math.max(0, k - 1), kb = Math.min(segs, k + 1), ja = Math.max(0, j - 1), jb = Math.min(cross, j + 1);
        _v1.subVectors(grid[kb][j].q, grid[ka][j].q); _v2.subVectors(grid[k][jb].q, grid[k][ja].q); _v3.crossVectors(_v1, _v2);
        if (_v3.lengthSq() < 1e-12) _v3.copy(g.nup);
        _v3.normalize(); if (_v3.dot(g.nup) < 0) _v3.negate();
        const fl = g.t * smooth(0.05, 0.3, g.s) * flutter;
        r.push(b.vertex(g.q, _v3, g.s, g.t, [1, g.s, fl, phase], [part, age, g.Ll, seed]));
      }
      idx.push(r);
    }
    for (let k = 0; k < segs; k++) for (let j = 0; j < cross; j++) {
      const a = idx[k][j], bb = idx[k + 1][j], c = idx[k + 1][j + 1], d = idx[k][j + 1];
      if (sigma > 0) b.quad(a, d, c, bb); else b.quad(a, bb, c, d);
    }
  }
}
function addIcosphere(b, center, radii, mat, veg) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      _v0.fromBufferAttribute(p, i + k);
      _v1.copy(_v0).multiply(radii).add(center); _v2.copy(_v0).divide(radii).normalize();
      ids.push(b.vertex(_v1, _v2, 0.5, 0.5, veg, mat));
    }
    b.tri(ids[0], ids[1], ids[2]);
  }
  g.dispose();
}
const palmRadius = (u) => {
  const y = u * PALM_H;
  let r = 0.155 + 0.045 * (1 - u) + 0.19 * Math.exp(-Math.max(y, 0) / 0.42);
  r *= 1 + 0.05 * Math.sin(y * 1.7) * (1 - u);
  r += 0.07 * smooth(0.955, 0.99, u) - 0.1 * smooth(0.995, 1.02, u);
  return r;
};
const palmRootLumps = (u, a) => { const y = Math.max(u * PALM_H, 0), k = Math.exp(-y / 0.3); return k * (0.16 * Math.max(0, Math.sin(a * 5 + 0.7)) + 0.08 * Math.sin(a * 11 + 2.1)); };
function palmFrondParams(rand, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = count > 1 ? i / (count - 1) : 0.5, hanging = count > 10 && i >= count - 2;
    const len = (3.8 + 1.5 * smooth(0, 0.45, a)) * (0.88 + 0.24 * rand());
    list.push({
      a, dead: hanging, azimuth: i * 2.39996 + (rand() - 0.5) * 0.4,
      elevation: hanging ? -1.05 - (i - (count - 2)) * 0.25 : 1.0 - 1.25 * Math.pow(a, 0.8) + (rand() - 0.5) * 0.3,
      bend: hanging ? 0.35 : 0.55 + 1.15 * a + rand() * 0.4, bendPow: hanging ? 1.2 : 1.9 + rand() * 0.5,
      twist: (rand() - 0.5) * 0.45, roll: (rand() - 0.5) * (hanging ? 0.4 : 0.9), length: hanging ? len * 0.9 : len,
      attachY: 0.32 - 0.5 * a, seed: rand(), phase: rand(),
    });
  }
  return list;
}
function addPalmCrown(b, fronds, { segs, cross, leafScale = 1 }) {
  for (const f of fronds) {
    const origin = new THREE.Vector3(Math.cos(f.azimuth) * 0.14, f.attachY, Math.sin(f.azimuth) * 0.14), Lf = f.length;
    addFrond(b, {
      origin, azimuth: f.azimuth, elevation: f.elevation, bend: f.bend, bendPow: f.bendPow, twist: f.twist, roll: f.roll, length: Lf, segs, cross,
      leafLen: (s) => leafScale * 0.23 * Lf * (smooth(0.14, 0.3, s) * (1 - 0.68 * smooth(0.35, 1.0, s))),
      leafAngle: (s) => 1.1 - 0.5 * s, droop: (s) => (f.dead ? 1.3 : 0.88 + 0.35 * f.a) + 0.45 * s,
      curl: f.dead ? 0.15 : 0.45, part: PART.FROND, age: f.dead ? 1 : f.a * 0.55, seed: f.seed, phase: f.phase, flutter: f.dead ? 0.3 : 1, minWidth: 0.045,
    });
  }
}
function buildPalmNear(seed) {
  const rand = mulberry32(seed), b = new GeoBuilder();
  const rows = [-0.03, 0, 0.015, 0.04, 0.08, 0.14, 0.22, 0.32, 0.43, 0.54, 0.65, 0.76, 0.86, 0.94, 0.975, 0.992, 1.005];
  addStem(b, { radial: 10, rows, radius: palmRadius, Hgeo: PALM_H, mat: [PART.STEM, 0, 0, 0], lumps: palmRootLumps });
  for (let i = 0; i < 6; i++) {
    const az = i * 2.39996 + rand() * 0.5, rr = 0.2 + rand() * 0.1;
    const c = new THREE.Vector3(Math.cos(az) * rr, -0.3 - rand() * 0.35, Math.sin(az) * rr), s = 0.12 + rand() * 0.035;
    addIcosphere(b, c, new THREE.Vector3(s, s * 1.12, s), [PART.COCONUT, rand(), 0, i / 6], [1, 0, 0, 0]);
  }
  addPalmCrown(b, palmFrondParams(rand, 18), { segs: 8, cross: 2 });
  return b.build();
}
function buildPalmFar(seed) {
  const rand = mulberry32(seed), b = new GeoBuilder();
  addStem(b, { radial: 5, rows: [-0.03, 0.03, 0.2, 0.6, 1.0], radius: palmRadius, Hgeo: PALM_H, mat: [PART.STEM, 0, 0, 0], cap: false });
  const fronds = palmFrondParams(rand, 18).filter((f, i) => i !== 1 && i !== 5 && i !== 9 && i !== 13);
  addPalmCrown(b, fronds, { segs: 3, cross: 1, leafScale: 1.15 });
  return b.build();
}

// ---- shaders ------------------------------------------------------------------------------------------------------
const NOISE = /* glsl */`
float vegHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vegNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vegHash12(i), vegHash12(i + vec2(1.0, 0.0)), u.x), mix(vegHash12(i + vec2(0.0, 1.0)), vegHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 vegRotUpTo(vec3 v, vec3 T) { vec3 k = vec3(T.z, 0.0, -T.x); vec3 c1 = cross(k, v); return v + c1 + cross(k, c1) / (T.y + 1.0); }
`;
const VS = /* glsl */`
precision highp float;
in vec3 position, normal;
in vec2 uv;
in vec4 aVeg, aMat, iPos, iDat;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
uniform vec3 uWind;
out vec3 vWorld, vN;
out vec2 vUv;
out vec4 vMat, vIDat;
out float vTrunkY;
${NOISE}
void main() {
  float part = aMat.x;
  vec3 base = iPos.xyz; float sc = iPos.w;
  vec3 leanDir = vec3(cos(iDat.x), 0.0, sin(iDat.x));
  float lean = iDat.y, H = iDat.z, seed = fract(iDat.w);
  float giro = seed * 19.47;                       // cada coqueiro virado para um lado
  float cg = cos(giro), sg = sin(giro);
  mat3 rotY = mat3(cg, 0.0, -sg, 0.0, 1.0, 0.0, sg, 0.0, cg);
  vec3 P = base + rotY * position * sc, N0 = rotY * normal;
  float u = aVeg.x, s = aVeg.y, flut = aVeg.z, ph = aVeg.w;
  float t = uTime;
  float w = max(uWind.z * 0.9, 0.05);
  vec2 wd = normalize(uWind.xy + 1e-4);
  vec3 windDir3 = vec3(wd.x, 0.0, wd.y), windPerp3 = vec3(-wd.y, 0.0, wd.x);
  float g = smoothstep(0.35, 0.75, vegNoise((base.xz - windDir3.xz * t * 6.0) / 38.0));
  float ph0 = seed * 6.2832;
  float sway = w * w * 0.014 * (g * 0.9 + 0.3) + sin(t * 0.83 + ph0) * w * 0.0065 * (g + 0.45);
  float swayP = sin(t * 0.61 + ph0 * 1.7) * w * 0.0028;
  vec3 windOff = windDir3 * sway + windPerp3 * swayP;
  float c = fract(seed * 7.31);
  float fc = mix(u, u * ((1.0 - u) + 1.0), c), df = mix(1.0, (1.0 - u) * 2.0, c);
  vec3 off = leanDir * (lean * fc) + windOff * (u * u);
  vec3 T = normalize(vec3(0.0, 1.0, 0.0) + leanDir * (lean * df) + windOff * (u * 2.0));
  vec3 radial = vec3(P.x - base.x, 0.0, P.z - base.z);
  vec3 stemPos = base + vec3(0.0, u * H, 0.0) + off * H + vegRotUpTo(radial, T);
  vec3 stemN = vegRotUpTo(N0, T);
  vec3 Ttop = normalize(vec3(0.0, 1.0, 0.0) + leanDir * (lean * (1.0 - c)) + windOff * 2.0);
  vec3 Ttilt = normalize(vec3(0.0, 1.0, 0.0) + Ttop);
  vec3 C = base + vec3(0.0, H, 0.0) + (leanDir * lean + windOff) * H;
  vec3 o1 = vegRotUpTo(P - base, Ttilt), N1 = vegRotUpTo(N0, Ttilt);
  float s2 = s * s;
  float bend = s2 * sc * 4.5 * (w * w * 0.16 * (g * 0.8 + 0.35) + sin(t * (ph * 0.5 + 1.3) + ph * 23.0 + ph0) * w * 0.075 * (g + 0.3));
  float bounce = sin(t * (ph + 2.1) + ph * 41.0) * s2 * w * sc * 0.1;
  float flutter = flut * sc * (sin(t * (ph * 5.0 + 11.0) + ph * 60.0 + s * 9.0) * (w * 0.045 + 0.008) + sin(t * 23.0 + ph * 13.0 + s * 17.0) * (max(w - 1.0, 0.0) * 0.05));
  vec3 disp = windDir3 * bend + vec3(0.0, 1.0, 0.0) * (bounce - bend * 0.3) + N1 * flutter;
  float L = length(o1);
  vec3 crownPos = C + normalize(o1 + disp + vec3(0.0, 1e-5, 0.0)) * L;
  bool hideDead = part > 0.5 && part < 1.5 && aMat.y > 0.95 && fract(seed * 13.7) > 0.4;
  if (hideDead) crownPos = C;
  bool isStem = part < 0.5;
  vec3 pos = isStem ? stemPos : crownPos;
  vN = isStem ? stemN : N1;
  vTrunkY = u * H;
  vWorld = pos; vUv = uv; vMat = aMat; vIDat = iDat;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;
const MASK = /* glsl */`
bool palmaMask() {
  float s = vUv.x, t = vUv.y, fwS = fwidth(s);
  float part = vMat.x, age = vMat.y, Ll = vMat.z, fseed = vMat.w, seed = vIDat.w;
  if (part > 0.5 && part < 1.5) {
    float N = 95.0;
    float x = s * N + (vegNoise(vec2(s * 7.0, fseed * 23.0 + seed * 3.0)) - 0.5) * 2.2;
    float k = floor(x);
    float r1 = vegHash12(vec2(k, fseed * 91.7)), r2 = vegHash12(vec2(k * 1.37 + 3.1, fseed * 17.3 + seed * 5.0));
    float fx = fract(x) - 0.5 - (r1 - 0.5) * 0.35;
    float tEnd = mix(0.72, 1.0, r2) * (r1 < 0.06 ? 0.45 : 1.0);
    float tt = t / tEnd;
    float hw = pow(max(1.0 - tt, 0.0), 0.6) * 0.22 * (smoothstep(0.0, 0.1, tt) * 0.4 + 0.6);
    bool split = r2 > 0.9 && tt > mix(0.35, 0.7, r1) && abs(fx) < hw * 0.3;
    bool torn = vegNoise(vec2(k * 0.21 + seed * 17.0, fseed * 37.0)) > 0.83 - age * 0.2 && s > 0.3;
    float hwE = max(hw, min(fwS * (N * 0.6), 0.5) * (tt < 1.0 ? 1.0 : 0.0));
    bool leaf = abs(fx) < hwE && tt < 1.0 && s > 0.06 && !split && !torn;
    bool rachis = t * Ll < 0.026;
    return leaf || rachis;
  }
  return true;
}
`;
const FS = /* glsl */`
precision highp float;
precision highp sampler2DShadow;
${COMMON}
uniform vec3 cameraPosition;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowInfo;
in vec3 vWorld, vN;
in vec2 vUv;
in vec4 vMat, vIDat;
in float vTrunkY;
out vec4 outColor;
${NOISE}
${MASK}
vec3 casca(float y, float a, float H, float seed, float iv) {
  y = max(y, 0.0);                                  // a base desce 3 cm abaixo do chão: pow de negativo dava NaN
  float A = a * 6.2832, ca = cos(A), sa = sin(A), yn = y / H;
  float wob = (vegNoise(vec2(ca * 1.3 + y * 0.35, sa * 1.3 + seed * 9.0)) - 0.5) * 0.7 + sin(A * 2.0 + y * 1.1 + seed * 5.0) * 0.1;
  float phase = y * mix(8.5, 11.0, iv) + pow(yn, 2.2) * H * 5.5 + vegNoise(vec2(y * 0.8, seed * 7.3)) * 3.2 + wob;
  float phaseR = phase + (vegNoise(vec2(a * 38.0, floor(phase) * 2.3 + seed * 5.0)) - 0.5) * 0.22;
  float k = floor(phaseR), fr = phaseR - k;
  float rk = vegHash12(vec2(k, seed * 13.7)), gw = mix(0.05, 0.14, rk);
  float groove = (smoothstep(gw, 0.0, fr) + smoothstep(1.0 - gw * 0.6, 1.0, fr)) * mix(0.45, 1.0, vegHash12(vec2(k * 1.3, seed * 3.1)));
  float amp = smoothstep(0.28, 0.6, vegNoise(vec2(ca * 1.8 + k * 3.17, sa * 1.8 + k * 1.71 + seed * 11.0))) * 0.75 + 0.25;
  float plate = vegNoise(vec2(a * 24.0, y * 3.5 + seed * 17.0)), blotch = vegNoise(vec2(a * 6.0, y * 0.4 + seed * 13.0));
  vec3 bark = mix(vec3(0.110, 0.091, 0.068), vec3(0.371, 0.323, 0.246), clamp(blotch * 0.55 + plate * 0.25 + (iv - 0.5) * 0.5 + yn * 0.15, 0.0, 1.0));
  float mott = vegNoise(vec2(a * 90.0, y * 80.0 + seed * 7.0)) * 0.6 + vegNoise(vec2(a * 35.0, y * 30.0 + seed * 3.0)) * 0.4;
  bark *= (mott * 0.45 + 0.78) * (plate * 0.25 + 0.88) * mix(1.0, 0.7, groove * amp);
  float baseK = smoothstep(1.4, 0.2, y + (blotch - 0.5) * 0.8);
  bark = mix(bark, bark * vec3(0.62, 0.56, 0.48), baseK);
  bark = mix(bark, mix(vec3(0.042, 0.027, 0.016), vec3(0.111, 0.069, 0.037), vegNoise(vec2(a * 26.0, y * 2.2 + seed * 19.0))), smoothstep(0.5, 0.0, y) * 0.85);
  float boot = smoothstep(H - 1.0, H - 0.35, y + (blotch - 0.5) * 0.3);
  float fib = sin(A * 34.0 + y * 30.0) * sin(A * 34.0 - y * 30.0) * 0.5 + 0.5;
  bark = mix(bark, mix(vec3(0.074, 0.038, 0.016), vec3(0.254, 0.177, 0.073), fib * 0.6 + plate * 0.4), boot);
  return bark;
}
void main() {
  if (!palmaMask()) discard;
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  float part = vMat.x, age = vMat.y, seed = vIDat.w, H = vIDat.z;
  float iv = vegHash12(vec2(seed * 37.1, 1.7));
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  if (!gl_FrontFacing) N = -N;
  vec3 alb; float trans = 0.0;
  if (part < 0.5) alb = casca(vTrunkY, vUv.x, H, seed, iv);
  else if (part > 4.5) {
    float r = age;
    alb = mix(vec3(0.16, 0.20, 0.03), vec3(0.25, 0.14, 0.04), smoothstep(0.55, 0.9, r)) * (0.8 + 0.3 * vegNoise(vWorld.xz * 9.0));
  } else {
    float s = vUv.x, t = vUv.y;
    vec3 jovem = vec3(0.13, 0.22, 0.035), maduro = vec3(0.075, 0.15, 0.03), seco = vec3(0.30, 0.20, 0.07);
    alb = mix(jovem, maduro, smoothstep(0.0, 0.5, age));
    alb = mix(alb, seco, smoothstep(0.6, 1.0, age) + smoothstep(0.82, 1.0, s) * 0.25 * vegNoise(vec2(s * 30.0, vMat.w * 9.0)));
    alb *= 0.85 + 0.3 * vegNoise(vec2(s * 40.0, t * 3.0 + vMat.w * 17.0));
    alb = mix(alb, vec3(0.32, 0.30, 0.12), smoothstep(0.03, 0.0, t * vMat.z));   // nervura central clara
    trans = 1.0;
  }
  // sombra do sol (o mesmo jeito da relva)
  float sol = 1.0;
  {
    vec4 sc = uShadowMatrix * vec4(vWorld + uLightDir * 0.15, 1.0);
    vec3 c = sc.xyz / sc.w;
    float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    if (e > 0.0 && c.z < 1.0 && c.z > 0.0) sol = mix(1.0, texture(uShadowMap, vec3(c.xy, c.z - 0.0002)), smoothstep(0.0, 0.06, e) * uShadowInfo.y);
  }
  float ndl = dot(N, uLightDir);
  float dif = trans > 0.5 ? (max(ndl, 0.0) * 0.8 + 0.2) : max(ndl * 0.85 + 0.15, 0.0);
  vec3 luz = uSunColor * dif * sol + mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y);
  vec3 cor = alb * luz;
  // folha contra o sol: a luz atravessa
  float contra = pow(max(dot(-V, uLightDir), 0.0), 3.0);
  cor += alb * vec3(1.25, 1.45, 0.55) * uSunColor * contra * 0.55 * trans * sol;
  float d = length(cameraPosition - vWorld);
  vec4 nv = fogAt(d, -V, vWorld.y);
  cor = mix(cor, nv.rgb, nv.a);
  outColor = vec4(finish(cor), 1.0);
#endif
}
`;

export function initCoqueiros({ scene, camera, game, player }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const variantes = [11, 23, 37].map((sd) => ({ perto: buildPalmNear(sd), longe: buildPalmFar(sd + 1) }));
  const uniforms = { ...U };
  const mat = new THREE.RawShaderMaterial({ name: 'coqueiro', glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
  const depth = new THREE.RawShaderMaterial({ name: 'coqueiro-sombra', glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS, defines: { DEPTH: 1 }, side: THREE.DoubleSide });
  const grupos = [];
  for (const v of variantes) for (const lod of ['perto', 'longe']) {
    const g = v[lod].clone();
    const max = 1200;
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.setAttribute('iDat', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false; m.castShadow = lod === 'perto' || pc; m.receiveShadow = false;
    m.customDepthMaterial = depth;
    m.visible = false;
    m.name = 'coqueiros-' + lod;
    scene.add(m);
    grupos.push({ m, g, lod, max });
  }
  let ultimo = null, genUsado = null;
  let troncos = [];   // [x, yBase, z, H, dirX, dirZ, lean] dos coqueiros perto (colisão do tronco)
  const tmp = new THREE.Vector3();
  function refazer(cx, cz) {
    const gen = game.gen;
    const lista = gen.coqueiros(cx, cz, LONGE);
    const cont = grupos.map(() => 0);
    troncos = [];
    for (const t of lista) {
      const d = Math.hypot(t.x + 0.5 - cx, t.z + 0.5 - cz);
      if (d > LONGE) continue;
      const h = t.h >>> 0;
      const r1 = (h & 0xff) / 255, r2 = ((h >>> 8) & 0xff) / 255, r3 = ((h >>> 16) & 0xff) / 255;
      // inclina para o mar (gradiente da distância à costa), como coqueiro de praia de verdade
      let gx = 1, gz = 0;
      if (gen.arq) { gx = gen.arq.s(t.x + 3, t.z) - gen.arq.s(t.x - 3, t.z); gz = gen.arq.s(t.x, t.z + 3) - gen.arq.s(t.x, t.z - 3); }
      const az = Math.atan2(gz, gx) + (r2 - 0.5) * 0.9;
      const lean = 0.08 + 0.24 * r1 * r1;
      const H = 7.5 + 6.5 * r3;
      const vi = (h >>> 24) % variantes.length, li = d < PERTO ? 0 : 1, gi = vi * 2 + li, k = cont[gi];
      const gr = grupos[gi];
      if (k >= gr.max) continue;
      const ip = gr.g.attributes.iPos.array, id = gr.g.attributes.iDat.array;
      ip.set([t.x + 0.5 + (r2 - 0.5) * 0.6, t.y + 1 - 0.1, t.z + 0.5 + (r1 - 0.5) * 0.6, 0.92 + 0.2 * r2], k * 4);
      id.set([az, lean, H, (r1 * 7.13 + r3 * 3.7) % 1], k * 4);
      if (d < 30) troncos.push([ip[k * 4], ip[k * 4 + 1], ip[k * 4 + 2], H, Math.cos(az), Math.sin(az), lean]);
      cont[gi] = k + 1;
    }
    grupos.forEach((gr, i) => {
      gr.g.instanceCount = cont[i];
      gr.g.attributes.iPos.needsUpdate = true; gr.g.attributes.iDat.needsUpdate = true;
    });
  }
  game.hooks.frame.push(() => {
    const on = !!(game.gen && game.gen.coqueiros && game.gen.arq && game.dim === 0);
    for (const gr of grupos) gr.m.visible = on && gr.g.instanceCount > 0;
    if (!on) return;
    camera.getWorldPosition(tmp);
    if (!ultimo || genUsado !== game.gen || Math.hypot(tmp.x - ultimo[0], tmp.z - ultimo[1]) > 6) {
      ultimo = [tmp.x, tmp.z]; genUsado = game.gen;
      refazer(tmp.x, tmp.z);
      for (const gr of grupos) gr.m.visible = gr.g.instanceCount > 0;
    }
    // tronco ultrarresistente (pedido dele, 19/11): ninguém atravessa nem derruba; o jogador encosta e para
    const p = player?.pos;
    if (p && !player.noclip) for (const [x, y0, z, H, dx, dz, lean] of troncos) {
      const h = p[1] - y0;
      if (h < -1.8 || h > H) continue;
      const u = Math.max(0, h) / H, off = lean * u * H;          // o tronco anda para o lado conforme sobe (inclinação)
      const cx = x + dx * off, cz = z + dz * off;
      const ex = p[0] - cx, ez = p[2] - cz, dist = Math.hypot(ex, ez), R = 0.3 + 0.32 * (1 - u) * (1 - u) + 0.3;
      if (dist < R && dist > 1e-4) { p[0] = cx + ex / dist * R; p[2] = cz + ez / dist * R; }
    }
  });
}
