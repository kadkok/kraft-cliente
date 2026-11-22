// LAVRA — gotas refrativas na lente da câmera ao emergir da água (LensDroplets).
// Adaptado de dgreenheck/tidewater (src/post/LensDroplets.js, MIT License — Copyright (c) Dan Greenheck).
//
// Água deixada na lente da câmera após emergir: gotas de vários tamanhos (sem distorcer a tela inteira).
// As pequenas aderem e evaporam no lugar; as grandes escorrem após um atraso aleatório e deixam um rastro
// úmido fino acima delas. Cada gota funciona como uma micro-lente olho-de-peixe: mostra uma visão
// invertida e desfocada da cena, com brilho especular do céu e borda escura de refração.

export const LENS_DROPLETS_GLSL = /* glsl */`
uniform float uLensWet;
uniform float uLensAge;
uniform float uLensSeed;

// Hash inteiro PCG2D dos bits float: sem funções transcendentais no laço das células (18 células × 2 hashes/pixel)
vec2 lensHash2(vec2 p) {
  uvec2 v = floatBitsToUint(p) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= (v >> uvec2(16u));
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= (v >> uvec2(16u));
  return vec2(v >> uvec2(8u)) / 16777216.0;
}

struct LensAcc {
  vec2 n2;
  float cover;
  float trail;
};

// Uma camada de gotas (aderentes ou pesadas que escorrem após um pequeno atraso)
void lensLayer(vec2 p, float cell, float rMin, float rMax, float density, bool slide, inout LensAcc acc) {
  float wet = uLensWet;
  float age = uLensAge;
  float seed = uLensSeed;
  vec2 c0 = floor(p / cell);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = c0 + vec2(float(i), float(j));
      vec2 h = lensHash2(c + seed);
      if (h.x >= density) continue;
      vec2 h2 = lensHash2(c + seed + 17.3);
      vec2 center = (c + (vec2(0.2) + h2 * 0.6)) * cell;
      // A evaporação encolhe as gotas; as maiores duram mais tempo
      float life = clamp(wet * 1.6 - h2.y * 0.6, 0.0, 1.0);
      float r = mix(rMin, rMax, h.y * h.y) * sqrt(life);
      if (slide) {
        // Gotas pesadas começam a escorrer após um atraso e aceleram para baixo na tela
        float t0 = h2.x * 3.0 + 0.4;
        float s = max(age - t0, 0.0);
        float dy = s * s * (r * 3.5);
        center.y += dy;
        // Rastro molhado vertical acima da gota que escorreu
        float dxT = abs(p.x - center.x);
        float above = center.y - p.y;
        float tr = smoothstep(r * 0.45, 0.0, dxT) * smoothstep(0.0, 0.01, above) * smoothstep(dy + 0.01, 0.0, above);
        acc.trail = max(acc.trail, tr * life);
      }
      // Contorno orgânico irregular com lóbulos; gotas escorrendo esticam verticalmente
      vec2 d = (p - center) * vec2(1.0, slide ? 0.8 : 1.0);
      float rB = max(r * 1.18, 1e-4);
      if (dot(d, d) >= rB * rB) continue;
      float ang = atan(d.y, d.x);
      float wobble = 1.0 + sin(ang * 3.0 + h.x * 40.0) * 0.12 + sin(ang * 5.0 + h2.y * 30.0) * 0.06;
      vec2 q = d / max(r * wobble, 1e-4);
      float rq = dot(q, q);
      float a = smoothstep(1.0, 0.7, rq);
      if (a > acc.cover) {
        acc.n2 = q;
        acc.cover = a;
      }
    }
  }
}

vec3 applyLensDroplets(vec2 uv, vec3 sharpCol) {
  if (uLensWet <= 0.001) return sharpCol;
  float aspect = max(uAspect, 0.1);
  // Em WebGL vUv.y cresce para cima; invertemos y em p para que center.y += dy escorra para baixo na tela
  vec2 p = vec2(uv.x * aspect, 1.0 - uv.y);

  LensAcc acc;
  acc.n2 = vec2(0.0);
  acc.cover = 0.0;
  acc.trail = 0.0;
  lensLayer(p, 0.075, 0.0035, 0.011, uLensWet * 0.26, false, acc);
  lensLayer(p, 0.145, 0.010, 0.025, uLensWet * 0.18, true, acc);

  vec3 col = sharpCol;
  if (acc.cover > 0.001) {
    vec2 n2 = acc.n2;
    float r2 = min(dot(n2, n2), 1.0);
    float nz = sqrt(max(1.0 - r2, 0.0));
    // Lente olho-de-peixe refrativa: imagem interna invertida e desfocada a partir da cena real
    vec2 off = n2 * -0.042 * (1.0 - nz * 0.5);
    vec2 dropUv = clamp(uv + vec2(off.x / aspect, -off.y), vec2(0.001), vec2(0.999));
    vec3 inside = lensBlurredAt(dropUv);
    float edge = smoothstep(0.55, 1.0, r2);
    float highlight = smoothstep(0.32, 0.0, length(n2 - vec2(-0.3, -0.4))) * 0.42;
    float rimGlow = smoothstep(0.62, 0.94, r2) * smoothstep(1.0, 0.80, r2) * 0.18;
    vec3 specCol = uAmbSky * 1.8 + uSunColor * 0.25 + vec3(0.35);
    vec3 dropCol = inside * mix(1.06, 0.88, edge) + specCol * (highlight + rimGlow);
    col = mix(col, dropCol, acc.cover * 0.92);
  }
  if (acc.trail > 0.001) {
    vec3 trailCol = lensBlurredAt(uv) * 0.96 + (uAmbSky * 0.2 + vec3(0.04)) * acc.trail;
    col = mix(col, trailCol, acc.trail * 0.45);
  }
  return col;
}
`;

export function createLensDroplets({ duration = 9.0 } = {}) {
  const uniforms = {
    uLensWet: { value: 0 },
    uLensAge: { value: 100 },
    uLensSeed: { value: 13.7 },
  };
  let wasUnder = false;
  let submergedTime = 0;
  let lastY = null;
  let seedStep = 0;

  function trigger(intensity = 1.0, seed = null) {
    const w = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1));
    uniforms.uLensWet.value = Math.max(uniforms.uLensWet.value, w);
    uniforms.uLensAge.value = 0;
    seedStep = (seedStep + 1) % 97;
    uniforms.uLensSeed.value = seed !== null ? seed : ((seedStep * 29.71 + Math.random() * 67) % 97);
  }

  function update(dt, underwater, camY = null, emergeSpeed = null) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const vy = Number.isFinite(emergeSpeed)
      ? Math.max(0, emergeSpeed)
      : (camY !== null && lastY !== null && step > 1e-4 && step <= 0.5 ? Math.max(0, (camY - lastY) / step) : 0);
    if (camY !== null && Number.isFinite(camY)) lastY = camY;

    if (underwater) {
      submergedTime += step;
      // Debaixo d'água a lente está imersa (sem gotas isoladas na tela)
      uniforms.uLensWet.value = 0;
    } else {
      if (wasUnder) {
        // Intensidade proporcional ao tempo submerso e à velocidade de emersão
        const timeK = Math.min(0.82, 0.45 + submergedTime * 0.35);
        const speedK = Math.min(0.35, vy * 0.08);
        const strength = Math.max(0.45, Math.min(1.0, timeK + speedK));
        trigger(strength);
        submergedTime = 0;
      }
      uniforms.uLensAge.value += step;
      uniforms.uLensWet.value = Math.max(0, uniforms.uLensWet.value - step / Math.max(0.5, duration));
    }
    wasUnder = !!underwater;
    return uniforms.uLensWet.value;
  }

  function reset() {
    wasUnder = false;
    submergedTime = 0;
    lastY = null;
    uniforms.uLensWet.value = 0;
    uniforms.uLensAge.value = 100;
  }

  return {
    uniforms,
    duration,
    update,
    trigger,
    reset,
    get wet() { return uniforms.uLensWet.value; },
    get age() { return uniforms.uLensAge.value; },
    get wasUnder() { return wasUnder; },
  };
}
