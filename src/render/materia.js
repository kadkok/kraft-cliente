// LAVRA — matéria do ar perto da câmera: poeira, areia, folhas, reflexo na grama,
// névoa, chuva e neve. A física mora no shader (gravidade, arrasto, vento em m/s).
// O GSAP só conduz a passagem de um tempo para o outro. Longe da faixa nítida, some.

import * as THREE from '../three.js';
import { gsap } from '../../vendor/gsap.js';
import { U } from './materials.js';
import { B, KIND, K_AIR } from '../../shared/blocks.js';
import { leisDaMateria } from './materia-leis.js';

const G = 48;

const VS = /* glsl */`
precision highp float;
in vec3 position;
in vec3 aKind;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam, uOrg, uWind;
uniform float uTime, uPx, uRange, uSpan, uAir;
uniform vec4 uAmt, uAmt2;
uniform sampler2D uGround;
out float vKind, vSpin, vFade;
out vec2 vAxis;
out vec3 vCol;

vec3 wrap(vec3 p, vec3 box) {
  return mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
}
void ground(vec2 xz, out float gy, out float mat, out float leaf) {
  vec2 uv = (xz - uOrg.xz) / uSpan;
  vec4 g = texture(uGround, uv);
  gy = g.r * 255.0;
  mat = floor(g.g * 255.0 + 0.5);
  leaf = g.b;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) mat = 0.0;
  if (abs(gy - uCam.y) > 18.0) gy = uCam.y - 1.62;
}
void kill() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; }

void main() {
  float kind = aKind.x, s = aKind.y, s2 = aKind.z;
  vKind = kind; vSpin = 0.0; vFade = 0.0; vCol = vec3(0.0);
  vAxis = vec2(0.0, 1.0);
  float range = max(uRange, 1.0);
  vec3 box = vec3(range * 2.0, 12.0, range * 2.0);
  vec2 wind = uWind.xy;
  float wsp = length(wind);
  vec3 p = uCam;
  float size = 0.03;
  float fade = uAir;
  float gy, mat, leaf;
  ground(uCam.xz, gy, mat, leaf);

  if (kind < 0.5) {
    vec3 q = position * box;
    q.xz += wind * uTime * (0.55 + s * 0.8);
    q.x += sin(uTime * 0.37 + s2 * 40.0) * (0.2 + wsp * 0.05);
    q.z += cos(uTime * 0.29 + s * 31.0) * 0.22;
    q.y += sin(uTime * (0.45 + s) + s2 * 17.0) * 0.4 + uTime * 0.05 * (s - 0.35);
    p = wrap(q, box);
    ground(p.xz, gy, mat, leaf);
    float lift = smoothstep(1.2, 0.05, abs(p.y - gy - 0.8)) * mat;
    p.y += lift * sin(uTime * 1.3 + s * 9.0) * 0.15;
    size = mix(0.014, 0.04, s);
    vCol = (uAmt.x > 0.0 ? vec3(1.0, 0.94, 0.82) : vec3(0.0));
    fade *= uAmt.x * (0.35 + 0.65 * s);
  } else if (kind < 1.5) {
    vec3 q = position * vec3(box.x, 1.0, box.z);
    p = wrap(q, vec3(box.x, 1.0, box.z));
    ground(p.xz, gy, mat, leaf);
    float trem = sin(uTime * 1.7 + s * 20.0 + p.x * 0.7);
    p.y = gy + 0.06 + trem * 0.015;
    size = 0.018;
    vSpin = trem;
    vCol = vec3(1.0, 0.97, 0.88);
    fade *= uAmt.y * step(0.5, mat) * (1.0 - step(1.5, mat)) * (0.35 + 0.65 * trem * trem) * (leaf > 0.5 ? 0.05 : 1.0);
  } else if (kind < 2.5) {
    float hopT = mix(0.7, 0.38, clamp(wsp / 8.0, 0.0, 1.0));
    float ph = fract(uTime / hopT + s);
    float hop = sin(ph * 3.14159) * (0.035 + min(wsp, 9.0) * 0.02);
    vec2 dir = wind / max(wsp, 0.001);
    vec3 q = position * vec3(box.x, 1.0, box.z);
    q.xz += dir * ph * (0.35 + wsp * 0.42);
    p = wrap(q, vec3(box.x, 1.0, box.z));
    ground(p.xz, gy, mat, leaf);
    p.y = gy + hop + 0.02;
    size = mix(0.02, 0.045, s2);
    vCol = vec3(0.72, 0.64, 0.48);
    fade *= uAmt.z * step(1.5, mat) * (1.0 - step(2.5, mat));
  } else if (kind < 3.5) {
    float fall = 0.32 + s * 0.5;
    vec3 q = position * box;
    q.xz += wind * uTime * (0.75 + s2);
    q.x += sin(uTime * (1.2 + s) + s2 * 12.0) * 0.45;
    q.y -= fall * uTime;
    p = wrap(q, box);
    ground(p.xz, gy, mat, leaf);
    float rest = step(p.y, gy + 0.05);
    p.y = mix(p.y, gy + 0.04, rest);
    vSpin = uTime * (1.4 + s * 5.0) + s2 * 6.0;
    size = mix(0.06, 0.13, s) * mix(0.32, 1.0, abs(cos(vSpin)));
    vCol = mix(vec3(0.15, 0.34, 0.1), vec3(0.40, 0.26, 0.08), s2);
    fade *= uAmt.w * leaf * (rest > 0.5 ? 0.65 : 1.0);
  } else if (kind < 4.5) {
    ground(position.xz * box.xz + uCam.xz - box.xz * 0.5, gy, mat, leaf);
    float cycle = 0.85 + s * 0.45;
    float ph = fract(uTime / cycle + s2);
    vec2 xz = position.xz * box.xz + wind * ph * 0.95;
    p = wrap(vec3(xz.x, 0.0, xz.y), vec3(box.x, 1.0, box.z));
    ground(p.xz, gy, mat, leaf);
    float top = gy + 11.0;
    p.y = top - ph * 11.0;
    vSpin = ph;
    vCol = vec3(0.82, 0.9, 0.98);
    vec3 queda = normalize(vec3(wind.x, -7.0, wind.y));
    vec3 vv = mat3(viewMatrix) * queda;
    vec2 ax = vec2(vv.x, -vv.y);
    float al = length(ax);
    if (al > 0.001) vAxis = ax / al;
    size = mix(0.55, 0.95, s);
    float splash = smoothstep(0.9, 0.98, ph);
    if (splash > 0.2) { p.y = gy + 0.03; size = mix(0.05, 0.16, splash); vKind = 7.0; }
    fade *= uAmt2.x * (mat > 0.5 ? 1.0 : 0.35);
  } else if (kind < 5.5) {
    float cycle = 3.4 + s * 2.6;
    float ph = fract(uTime / cycle + s2);
    vec2 flutter = vec2(sin(uTime * 0.8 + s * 30.0), cos(uTime * 0.7 + s2 * 24.0)) * 0.35;
    vec2 xz = position.xz * box.xz + wind * ph * 1.6 + flutter;
    p = wrap(vec3(xz.x, 0.0, xz.y), vec3(box.x, 1.0, box.z));
    ground(p.xz, gy, mat, leaf);
    p.y = gy + 8.0 - ph * 8.0;
    vSpin = uTime * 0.6 + s * 8.0;
    size = mix(0.05, 0.09, s);
    vCol = vec3(0.86, 0.9, 0.95);
    if (ph > 0.96) { p.y = gy + 0.03; size *= 0.7; }
    fade *= uAmt2.y * (mat > 0.5 ? 1.0 : 0.2);
  } else {
    vec3 fb = vec3(12.0, 3.2, 12.0);
    vec3 q = position * fb;
    q.xz += wind * uTime * 0.18;
    q.y += sin(uTime * 0.15 + s * 10.0) * 0.2;
    p = wrap(q, fb);
    size = mix(1.3, 2.2, s);
    vCol = vec3(0.7, 0.75, 0.8);
    fade *= uAmt2.z * 0.1;
  }

  float dist = length(p - uCam);
  fade *= 1.0 - smoothstep(range * 0.58, range, dist);
  vFade = fade;
  if (fade < 0.012 || uAir < 0.02) { kill(); return; }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * uPx / max(-mv.z, 0.15), 1.0, 160.0);
}
`;

const FS = /* glsl */`
precision highp float;
uniform float uDirect, uExposure;
uniform vec3 uSunColor, uAmbSky;
in float vKind, vSpin, vFade;
in vec2 vAxis;
in vec3 vCol;
out vec4 outColor;

vec3 finish(vec3 c) {
  if (uDirect < 0.5) return c;
  c *= uExposure / 0.6;
  c = c / (c + vec3(1.0));
  return pow(max(c, 0.0), vec3(0.4545));
}

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float ang = vSpin, ca = cos(ang), sa = sin(ang);
  vec2 r = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
  float a = 0.0;
  vec3 col = vCol;
  if (vKind < 0.5) {
    float d = length(uv);
    a = smoothstep(0.5, 0.05, d);
    col *= uSunColor * 0.45 + uAmbSky;
  } else if (vKind < 1.5) {
    float d = length(uv);
    a = smoothstep(0.5, 0.0, d);
    a *= a;
    col *= uSunColor;
  } else if (vKind < 2.5) {
    float d = length(uv);
    a = smoothstep(0.42, 0.05, d);
    col *= uAmbSky * 1.4 + uSunColor * 0.25;
  } else if (vKind < 3.5) {
    float body = length(vec2(r.x * 0.9, r.y * 1.65));
    a = smoothstep(0.48, 0.30, body);
    float vein = smoothstep(0.04, 0.0, abs(r.x) * 0.35 + abs(r.y));
    col = mix(col, col * 0.5, vein);
    col *= uAmbSky * 1.85 + uSunColor * 0.5;
  } else if (vKind < 4.5) {
    float along = dot(uv, vAxis);
    float across = abs(dot(uv, vec2(-vAxis.y, vAxis.x)));
    a = smoothstep(0.028, 0.0, across) * smoothstep(-0.5, -0.06, along) * smoothstep(0.5, 0.1, along);
    col = mix(col, vec3(0.9, 0.94, 0.98), smoothstep(0.012, 0.0, across));
    col *= uAmbSky * 1.15 + vec3(0.16);
  } else if (vKind < 5.5) {
    vec2 q = r * 1.2;
    float hex = max(abs(q.x) * 0.8660254 + abs(q.y) * 0.5, abs(q.y));
    a = smoothstep(0.52, 0.28, hex);
    a *= 0.62 + 0.38 * smoothstep(0.4, 0.02, length(q));
    col *= uAmbSky * 1.7 + vec3(0.5);
  } else if (vKind < 6.5) {
    float d = length(uv);
    a = smoothstep(0.5, 0.0, d);
    a = a * a * a;
    col *= uAmbSky * 1.1 + vec3(0.18);
  } else {
    float d = length(uv);
    a = smoothstep(0.06, 0.0, abs(d - 0.28)) * smoothstep(0.5, 0.2, d);
    col = vec3(0.75, 0.82, 0.86) * (uAmbSky + vec3(0.2));
  }
  a *= vFade;
  col = finish(col) * a;
  if (a < 0.01) discard;
  outColor = vec4(col, a);
}
`;

function escala(quality) {
  if (quality?.name === 'baixa') return { k: 0.28, range: 8 };
  if (quality?.name === 'media') return { k: 0.55, range: 11 };
  return { k: 1, range: 16 };
}

function planta(id) {
  return id === B.TALL_GRASS || id === B.FERN || id === B.FLOWER_YELLOW || id === B.FLOWER_RED || id === B.FLOWER_BLUE;
}
function materiaDo(id) {
  if (id === B.GRASS || planta(id)) return 1;
  if (id === B.SAND) return 2;
  if (id === B.SNOW) return 3;
  if (id === B.WATER || (id >= B.FLOW_1 && id <= B.FLOW_7)) return 4;
  if (id === B.DIRT || id === B.GRAVEL || id === B.CLAY) return 5;
  if (id === B.LEAVES || id === B.PINE_LEAVES) return 6;
  return id > 0 ? 7 : 0;
}

export function createMateria(scene, quality, world) {
  const { k, range } = escala(quality);
  const n = {
    poeira: Math.round(1100 * k),
    reflexo: Math.round(420 * k),
    areia: Math.round(640 * k),
    folhas: Math.round(380 * k),
    chuva: Math.round(1000 * k),
    neve: Math.round(520 * k),
    nevoa: Math.round(240 * k),
  };
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  const pos = new Float32Array(total * 3);
  const kind = new Float32Array(total * 3);
  const rand = (i) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const lotes = [[0, n.poeira], [1, n.reflexo], [2, n.areia], [3, n.folhas], [4, n.chuva], [5, n.neve], [6, n.nevoa]];
  let o = 0;
  for (const [id, count] of lotes) {
    for (let i = 0; i < count; i++, o++) {
      pos[o * 3] = rand(o + 1); pos[o * 3 + 1] = rand(o + 19); pos[o * 3 + 2] = rand(o + 47);
      kind[o * 3] = id; kind[o * 3 + 1] = rand(o + 3); kind[o * 3 + 2] = rand(o + 11);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 3));
  const data = new Uint8Array(G * G * 4);
  const tex = new THREE.DataTexture(data, G, G, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const uniforms = {
    uTime: U.uTime, uDirect: U.uDirect, uExposure: U.uExposure,
    uSunColor: U.uSunColor, uAmbSky: U.uAmbSky,
    uCam: { value: new THREE.Vector3() },
    uOrg: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector3() },
    uPx: { value: 800 }, uRange: { value: range }, uSpan: { value: range * 2 }, uAir: { value: 1 },
    uAmt: { value: new THREE.Vector4() },
    uAmt2: { value: new THREE.Vector4() },
    uGround: { value: tex },
  };
  const mat = new THREE.RawShaderMaterial({
    name: 'materia', glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.name = 'materia';
  scene.add(points);

  const aim = { poeira: 0, reflexo: 0, areia: 0, folhas: 0, chuva: 0, neve: 0, nevoa: 0 };
  const goal = { ...aim };
  let forced = null, cursor = 0, orgX = 0, orgZ = 0, span = range * 2, quadro = 0;
  const frac = { sand: 0, snow: 0, grass: 0, leaves: 0 };

  function seek(next) {
    for (const chave of Object.keys(aim)) {
      const v = next[chave] || 0;
      if (!Number.isFinite(v) || Math.abs(v - goal[chave]) < 0.02) continue;
      goal[chave] = v;
      gsap.to(aim, { [chave]: v, duration: 1.6, ease: 'power1.inOut', overwrite: 'auto' });
    }
  }

  function escrever(ix, iz, camY) {
    const x = orgX + Math.floor((ix + 0.5) * span / G);
    const z = orgZ + Math.floor((iz + 0.5) * span / G);
    // Desce a partir dos olhos e atravessa folha, tronco e planta: o chão é o bloco em que se pisa.
    let surface = 0, matId = 0, leaf = 0, id = 0, yTopo = -1;
    if (world?.getBlock) {
      for (let y = Math.floor(camY) + 2; y >= Math.floor(camY) - 24 && y >= 0; y--) {
        const b = world.getBlock(x, y, z);
        if (b < 0 || b === B.LEAVES || b === B.PINE_LEAVES) { if (b === B.LEAVES || b === B.PINE_LEAVES) leaf = 255; continue; }
        if (b === B.LOG || b === B.PINE_LOG || planta(b) || b === B.AIR || KIND[b] === K_AIR) continue;
        id = b; yTopo = y; surface = y + 1; break;
      }
      if (yTopo >= 0) {
        matId = materiaDo(id);
        for (let h = 1; h <= 8 && !leaf; h++) {
          const acima = world.getBlock(x, yTopo + h, z);
          if (acima === B.LEAVES || acima === B.PINE_LEAVES) leaf = 255;
        }
      }
    }
    const p = (iz * G + ix) * 4;
    data[p] = Math.max(0, Math.min(255, surface));
    data[p + 1] = matId;
    data[p + 2] = leaf;
    data[p + 3] = 255;
  }

  function update(dt, cam, env, h, fov, weather) {
    const ar = (env.underwater || env.zone) ? 0 : (1 - Math.min(1, env.enclosed || 0));
    if (forced?.range) uniforms.uRange.value = forced.range;
    span = uniforms.uRange.value * 2;
    uniforms.uSpan.value = span;
    const nx = Math.floor(cam.x) - uniforms.uRange.value;
    const nz = Math.floor(cam.z) - uniforms.uRange.value;
    const mudou = nx !== orgX || nz !== orgZ;
    if (mudou) { orgX = nx; orgZ = nz; cursor = 0; data.fill(0); }
    uniforms.uOrg.value.set(orgX, 0, orgZ);
    const lote = Math.max(16, Math.round(48 * k));
    let sandN = 0, snowN = 0, grassN = 0, leafN = 0, known = 0;
    for (let i = 0; i < lote; i++) {
      const c = cursor % (G * G);
      escrever(c % G, Math.floor(c / G), cam.y);
      const m = data[c * 4 + 1];
      if (m) {
        known++;
        if (m === 1) grassN++;
        else if (m === 2) sandN++;
        else if (m === 3) snowN++;
        if (data[c * 4 + 2] > 0) leafN++;
      }
      cursor++;
    }
    const cx = Math.max(0, Math.min(G - 1, Math.floor((cam.x - orgX) / span * G)));
    const cz = Math.max(0, Math.min(G - 1, Math.floor((cam.z - orgZ) / span * G)));
    escrever(cx, cz, cam.y);
    quadro++;
    if (mudou || (quadro & 3) === 0) tex.needsUpdate = true;
    if (known > 8) {
      const suave = Math.min(1, (dt || 0.016) * 1.4);
      frac.sand += (sandN / known - frac.sand) * suave;
      frac.snow += (snowN / known - frac.snow) * suave;
      frac.grass += (grassN / known - frac.grass) * suave;
      frac.leaves += (leafN / known - frac.leaves) * suave;
    }

    const wind = forced?.wind || weather?.wind || [0, 0];
    const leis = leisDaMateria({
      wind, rain: forced?.rain ?? weather?.rain ?? 0, fog: forced?.fog ?? weather?.fog ?? 0,
      cover: forced?.cover ?? weather?.cover ?? 0, night: env.night || 0,
      grass: Math.max(env.grass || 0, frac.grass), sand: forced?.sand ?? frac.sand,
      snow: forced?.snow ?? frac.snow, leaves: Math.max(env.trees || 0, frac.leaves), open: ar,
    });
    if (aim.poeira === 0 && leis.poeira > 0) {
      for (const chave of Object.keys(aim)) aim[chave] = leis[chave] || 0;
    } else seek(leis);

    uniforms.uCam.value.copy(cam);
    uniforms.uWind.value.set(wind[0] || 0, wind[1] || 0, leis.vento);
    uniforms.uPx.value = h / (2 * Math.tan((fov || 72) * Math.PI / 360));
    uniforms.uAir.value += (ar - uniforms.uAir.value) * Math.min(1, (dt || 0.016) * 4);
    uniforms.uAmt.value.set(aim.poeira, aim.reflexo, aim.areia, aim.folhas);
    uniforms.uAmt2.value.set(aim.chuva, aim.neve, aim.nevoa, 0);
    points.visible = uniforms.uAir.value > 0.02;
    return leis;
  }

  return {
    points, update, uniforms, aim, n,
    forcar(v) { forced = v; },
    dispose() { scene.remove(points); geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}
