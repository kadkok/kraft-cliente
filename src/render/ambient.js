// LAVRA — partículas de ambiente: poeira e pólen flutuando ao sol, vaga-lumes à noite, marine snow / plâncton
// debaixo d'água (com movimento orbital das ondas e extinção Beer-Lambert) e cinza subindo na Zona Fantasma.
// Uma única nuvem de pontos que acompanha a câmera (conta toda no vertex shader, custo zero na CPU).
// Adaptado de dgreenheck/tidewater (src/fx/MarineSnow.js, MIT License — Copyright (c) Dan Greenheck).

import * as THREE from '../three.js';
import { U } from './materials.js';
import { mulberry32 } from '../../shared/noise.js';
import { alturaOnda } from '../../shared/ondas.js';

const MOTES = 520, FLIES = 340, SNOW = 1600;

const VS = /* glsl */`
precision highp float;
in vec3 position;      // semente em [0,1)
in vec2 aKind;         // x: 0 = poeira, 1 = vaga-lume, 2 = marine snow (Tidewater) · y: número sorteado
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam;
uniform float uTime, uPx, uUnder, uZone, uFlies, uMotes, uSnow, uNight, uWaterY;
uniform vec3 uSunColor, uAmbSky, uWind;
out vec3 vCol;
out float vDisc;

vec3 snowHash3(float n) {
  return fract(sin(vec3(n, n + 17.13, n + 43.71)) * vec3(43758.5453, 22578.1459, 19642.3490));
}

void main() {
  float r = aKind.y;
  vec3 box, p;
  float size;
  vDisc = 0.0;

  if (aKind.x > 1.5) {
    // ---- MarineSnow (Tidewater src/fx/MarineSnow.js): flocos orgânicos, plâncton e grãos em suspensão
    vDisc = 1.0;
    vec3 B = vec3(11.0, 8.5, 11.0);
    box = B;
    vec3 h = position;
    vec3 h2 = snowHash3(r * 97.31 + position.x * 13.7);
    // Corrente lenta + decantação suave, embrulhadas na caixa da câmera
    vec3 drift = vec3(0.05, -0.014, 0.03) * uTime + (h2 - 0.5) * (uTime * 0.022);
    vec3 local = (fract(h + drift / B - uCam / B) - 0.5) * B;
    p = uCam + local;

    float depth = max(uWaterY - p.y, 0.0);
    // Balanço orbital da ondulação longa passando por cima (decai exponencialmente com a profundidade: exp(-k*z))
    vec2 w = uWind.xy;
    float wl = dot(w, w);
    w = wl > 1e-6 ? w * inversesqrt(wl) : vec2(0.833666, 0.552269);
    float energy = clamp((uWind.z - 0.35) / 1.45, 0.0, 1.0);
    float ampScale = 0.42 + 0.88 * energy;
    float k0 = 6.2831853 / 28.0, k1 = 6.2831853 / 17.5;
    float th0 = k0 * dot(w, p.xz) - sqrt(9.81 * k0) * uTime;
    float th1 = k1 * dot(vec2(w.x * 0.95 + w.y * 0.3, -w.x * 0.3 + w.y * 0.95), p.xz) - sqrt(9.81 * k1) * uTime + 1.37;
    float att0 = exp(-depth * k0) * 0.135 * ampScale;
    float att1 = exp(-depth * k1) * 0.088 * ampScale;
    vec3 sway = vec3(
      w.x * (cos(th0) * att0 + cos(th1) * att1),
      (sin(th0) * att0 + sin(th1) * att1) * 0.5,
      w.y * (cos(th0) * att0 + cos(th1) * att1)
    );
    p += sway * 0.85;

    // Tamanho 1.8 cm a 4.5 cm (alguns flocos maiores ocasionais)
    size = mix(0.018, 0.042, h2.x * h2.x) + (h2.y > 0.96 ? 0.025 : 0.0);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    // Recorte suave nas bordas da caixa, diante da lente e exatamente na superfície da onda (nenhum floco voa na metade de ar)
    float surfLocal = uWaterY + sway.y;
    float underSurf = smoothstep(0.0, 0.06, surfLocal - p.y);
    float fade = smoothstep(B.x * 0.5, B.x * 0.28, length(local)) * smoothstep(0.12, 0.42, d) * underSurf;

    // Luz solar + celeste atenuada até esta profundidade (Beer-Lambert), tom branco-esverdeado orgânico
    vec3 sigT = vec3(0.394, 0.097, 0.066);
    vec3 light = (uSunColor * 0.14 + uAmbSky * 1.35 + vec3(0.01, 0.035, 0.055)) * exp(-sigT * min(depth, 24.0));
    vCol = light * vec3(0.90, 1.0, 0.95) * (0.45 + 0.55 * h2.z) * fade * uSnow;

    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * fade * uPx / max(d, 0.12), 1.0, 18.0);
    if (fade < 0.02 || dot(vCol, vec3(1.0)) < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  if (aKind.x < 0.5) {
    box = vec3(26.0, 13.0, 26.0);
    // poeira deriva devagar; na água sobe, na Zona sobe e rodopia
    float rise = uUnder * 0.25 + uZone * 0.5 - 0.02;
    p = position * box + vec3(sin(uTime * 0.13 + r * 40.0) * 0.9 + uTime * 0.22, uTime * rise + sin(uTime * 0.31 + r * 17.0) * 0.4, cos(uTime * 0.11 + r * 23.0) * 0.9);
    size = mix(0.035, 0.07, r) * (1.0 + uUnder * 1.1 + uZone * 0.8);
    vec3 day = (uSunColor * 0.5 + uAmbSky * 0.9) * vec3(1.0, 0.96, 0.85);
    vCol = mix(day, vec3(0.45, 0.85, 0.96) * (uAmbSky * 1.8 + 0.04), uUnder);
    vCol = mix(vCol * 0.7, vec3(1.6, 0.5, 2.2), uZone) * uMotes * (0.35 + 0.65 * fract(r * 7.3));
  } else {
    box = vec3(30.0, 6.0, 30.0);
    p = position * box + vec3(sin(uTime * 0.4 + r * 31.0), sin(uTime * 0.53 + r * 11.0) * 0.6, cos(uTime * 0.37 + r * 19.0)) * 1.6;
    p.y -= 3.0;
    size = 0.13;
    // cada vaga-lume acende e apaga no seu ritmo
    float blink = smoothstep(0.3, 0.95, sin(uTime * (1.1 + r * 1.6) + r * 60.0));
    vCol = vec3(1.9, 2.6, 0.5) * blink * uFlies;
  }
  p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;       // a caixa anda com a câmera
  if (uUnder > 0.5 && aKind.x < 0.5 && p.y > uWaterY - 0.04) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vCol *= (1.0 - smoothstep(box.x * 0.3, box.x * 0.5, length(p - uCam))) * smoothstep(0.3, 1.2, d);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, size * uPx / max(d, 0.1));
  if (dot(vCol, vec3(1.0)) < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // apagado: fora da tela
}
`;
const FS = /* glsl */`
precision highp float;
uniform float uDirect;
in vec3 vCol;
in float vDisc;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  float profile = vDisc > 0.5 ? mix(1.3, 0.75, r) * smoothstep(1.0, 0.35, r) : a * a;
  vec3 c = vCol * profile;
  if (uDirect > 0.5) c = min(c * 0.4, vec3(1.0));     // sem pós-processamento a soma já acontece na cor final: entra bem mais fraca
  outColor = vec4(c, 1.0);
}
`;

export function createAmbient(scene) {
  const n = MOTES + FLIES + SNOW;
  const pos = new Float32Array(n * 3), kind = new Float32Array(n * 2);
  const random = mulberry32(0x4c415652);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = random(); pos[i * 3 + 1] = random(); pos[i * 3 + 2] = random();
    kind[i * 2] = i < MOTES ? 0 : (i < MOTES + FLIES ? 1 : 2);
    kind[i * 2 + 1] = random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 2));
  const uniforms = {
    uTime: U.uTime, uDirect: U.uDirect, uSunColor: U.uSunColor, uAmbSky: U.uAmbSky, uNight: U.uNight, uWind: U.uWind,
    uCam: { value: new THREE.Vector3() }, uPx: { value: 800 }, uUnder: { value: 0 }, uZone: { value: 0 },
    uFlies: { value: 0 }, uMotes: { value: 0 }, uSnow: { value: 0 }, uWaterY: { value: -1e4 },
  };
  const mat = new THREE.RawShaderMaterial({
    name: 'ambiente', glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  scene.add(points);

  // env: o mesmo retrato do lugar que vai para o som (+ underwater, zone); h = altura da tela em pixels; fov em graus
  function update(dt, cam, env, h, fov) {
    const u = uniforms, k = Math.min(1, dt * 1.5);
    u.uCam.value.copy(cam);
    u.uPx.value = h / (2 * Math.tan(fov * Math.PI / 360));
    const under = env.underwater ? 1 : 0, zone = env.zone ? 1 : 0, open = 1 - (env.enclosed || 0);
    const sea = U.uSea.value;
    if (sea > -1e3) {
      const waveDy = alturaOnda(cam.x, cam.z, U.uTime.value, U.uWind.value, 7);
      u.uWaterY.value = under && cam.y > sea + 1.4 ? Math.floor(cam.y) + 0.88 : sea + waveDy;
    } else if (under) {
      u.uWaterY.value = Math.floor(cam.y) + 0.88;
    } else {
      u.uWaterY.value = -1e4;
    }

    const straddling = sea > -1e3 && Math.abs(cam.y - u.uWaterY.value) < 0.55;
    u.uUnder.value += (under - u.uUnder.value) * Math.min(1, dt * 4);
    u.uZone.value = zone;
    // Marine snow: ativo tanto totalmente submerso quanto quando a lente cruza a linha d'água
    const snowTarget = (under || straddling) && !zone ? 1 : 0;
    u.uSnow.value += (snowTarget - u.uSnow.value) * Math.min(1, dt * 5);
    // poeira: de dia ao ar livre, sempre debaixo d'água e na Zona
    const motes = Math.max(under * 0.65, zone * 0.8, (1 - env.night) * open * (0.25 + 0.5 * env.trees));
    u.uMotes.value += (motes - u.uMotes.value) * k;
    // vaga-lumes: à noite, onde há relva ou mata, com o chão por perto
    const flies = under || zone ? 0 : env.night * open * Math.min(1, (env.grass + env.trees) * 3) * (env.nearGround ? 1 : 0);
    u.uFlies.value += (flies - u.uFlies.value) * k;
    points.visible = u.uMotes.value > 0.004 || u.uFlies.value > 0.004 || u.uSnow.value > 0.004;
  }
  return { points, update, uniforms };
}
