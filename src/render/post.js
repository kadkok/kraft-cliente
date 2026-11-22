// LAVRA — pós-processamento. A cena é desenhada em luz linear (HDR) num alvo próprio e aqui ganha:
// linha d'água dividida (split waterline) com menisco refrativo, meio óptico submarino (absorção Beer-Lambert,
// espalhamento simples/múltiplo, god rays de cáusticas na coluna d'água), gotas refrativas na lente ao emergir
// (LensDroplets), brilho difuso (bloom), raios de sol entre as árvores, curva de tons ACES, vinheta e dither.
// Fica desligado no VR (dois olhos, outro framebuffer) e no perfil baixo: lá os shaders fecham a imagem sozinhos.
// Adaptado de dgreenheck/tidewater (src/post/Underwater.js, src/post/LensDroplets.js, src/post/PostFX.js,
// MIT License — Copyright (c) Dan Greenheck).

import * as THREE from '../three.js';
import { U } from './materials.js';
import { LENS_DROPLETS_GLSL, createLensDroplets } from './lens-droplets.js';
import {
  UW_BAND,
  UW_LENS_DIST,
  UW_SHAFTS_FS,
  UW_COMPOSITE_GLSL,
  avaliarSuperficieCamera,
} from './submarino.js';

const VS = /* glsl */`
precision highp float;
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Só o que passa do limiar entra no bloom; a média ponderada evita que um pixel estourado vire um borrão piscando.
const PREFILTER_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// pixel inválido (NaN/infinito, de algum modelo importado) não entra no brilho: sem isso ele vira um bloco preto
// do tamanho de cada nível do bloom (19/11, torre de salva-vidas e bote do litoral)
vec3 limpo(vec3 c) { return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : max(c, 0.0); }
void main() {
  vec3 a = limpo(texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb), b = limpo(texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  vec3 c = limpo(texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb), d = limpo(texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float l = luma(col);
  float k = max(l - uThreshold, 0.0);
  col *= k / (k + 0.6) / max(l, 1e-4) * min(l, 12.0);     // joelho suave e teto: o disco do sol não queima a tela toda
  outColor = vec4(col, 1.0);
}
`;
const DOWN_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}
`;
// Sobe um nível: borra o nível de baixo (tenda 3x3) e soma o nível atual.
const UP_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc, tAdd;
uniform vec2 uTexel;
uniform float uSpread;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture(tSrc, vUv - vec2(t.x, 0.0)).rgb
      + texture(tSrc, vUv + vec2(0.0, t.y)).rgb + texture(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + t).rgb + texture(tSrc, vUv - t).rgb
     + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  outColor = vec4(c / 16.0 * uSpread + texture(tAdd, vUv).rgb, 1.0);
}
`;
// Raios de sol: de cada pixel caminha em direção ao sol somando quanto de céu aberto há no caminho.
const RAYS_FS = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  const int N = 24;
  vec2 d = uSunUv - vUv;
  float len = length(d * vec2(uAspect, 1.0));
  d *= min(1.0, 0.75 / max(len, 1e-4)) / float(N);
  float j = ign(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++) {
    vec2 uv = vUv + d * (float(i) + j);
    float open = step(0.999999, texture(tDepth, uv).r);
    // só o céu perto do sol é fonte de luz
    float near = max(1.0 - length((uv - uSunUv) * vec2(uAspect, 1.0)) * 1.5, 0.0);
    acc += open * near * near * w;
    wsum += w; w *= 0.965;
  }
  float fall = max(1.0 - len * 0.85, 0.0);
  outColor = vec4(vec3(acc / wsum * fall * fall), 1.0);
}
`;
// Foco de câmera (prova de realismo). Uma lente de verdade só deixa nítido o que está na distância de foco: o resto abre
// em discos tanto maiores quanto mais longe dela (em dioptrias: |1/foco − 1/distância|). É isso que faz a foto de perto
// parecer foto. Um passo só: de cada ponto, uma espiral de amostras; cada uma entra se o disco DELA alcança o ponto.
const DOF_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc, tDepth;
uniform vec2 uTexel, uPlanos;     // 1 / tamanho · planos perto e longe da câmera
uniform vec4 uLente;              // x = distância de foco (m) · y = abertura (px·m numa tela de 900 de altura) · z = altura / 900 · w = passo da espiral
in vec2 vUv;
out vec4 outColor;
float metros(vec2 uv) {
  float z = texture(tDepth, uv).r * 2.0 - 1.0;
  return 2.0 * uPlanos.x * uPlanos.y / (uPlanos.y + uPlanos.x - z * (uPlanos.y - uPlanos.x));
}
// raio do disco, em pontos da tela: o fundo abre até 11, o que está à frente do foco só até 3 (a relva junto do pé não vira névoa)
float disco(float d) {
  float c = uLente.y * (1.0 / uLente.x - 1.0 / d);
  return (c >= 0.0 ? min(c, 11.0) : min(-c * 0.6, 3.0)) * uLente.z;
}
void main() {
  float cd = metros(vUv), cs = disco(cd);
  vec3 col = texture(tSrc, vUv).rgb;
  float tot = 1.0, raio = uLente.w, teto = 11.0 * uLente.z;
  for (float ang = 0.0; raio < teto; ang += 2.39996323) {
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * raio;
    vec3 sc = texture(tSrc, tc).rgb;
    float sd = metros(tc), ss = disco(sd);
    if (sd > cd) ss = clamp(ss, 0.0, cs * 2.0);       // o fundo borrado não invade o que está nítido na frente
    float m = smoothstep(raio - 0.5, raio + 0.5, ss);
    col += mix(col / tot, sc, m);
    tot += 1.0;
    raio += uLente.w / raio;
  }
  outColor = vec4(col / tot, 1.0);
}
`;
const FINAL_FS = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D tScene, tBloom, tRays, tHalf;
uniform float uBloom, uExposure, uAspect, uUnder, uTime, uVignette, uGrade, uLookUp, uTom;
uniform vec3 uRayColor, uWind, uLightDir, uSunColor, uAmbSky;
in vec2 vUv;
out vec4 outColor;

${UW_COMPOSITE_GLSL}

vec3 lensBlurredAt(vec2 uv) {
  vec2 tx = 2.6 / max(uResolution, vec2(1.0));
  vec3 s = texture(tScene, uv).rgb * 0.24
    + (texture(tScene, clamp(uv + vec2(tx.x, 0.0), vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv - vec2(tx.x, 0.0), vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv + vec2(0.0, tx.y), vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv - vec2(0.0, tx.y), vec2(0.001), vec2(0.999))).rgb) * 0.12
    + (texture(tScene, clamp(uv + tx * 0.85, vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv - tx * 0.85, vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv + vec2(tx.x, -tx.y) * 0.85, vec2(0.001), vec2(0.999))).rgb
     + texture(tScene, clamp(uv + vec2(-tx.x, tx.y) * 0.85, vec2(0.001), vec2(0.999))).rgb) * 0.07;
  return s + texture(tBloom, uv).rgb * uBloom;
}

${LENS_DROPLETS_GLSL}

vec3 tonemap(vec3 c) {
  c *= uExposure / 0.6;
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  c = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c;
  return clamp(c, 0.0, 1.0);
}
// Curva neutra (Khronos PBR Neutral; prova de realismo): reta até quase o branco, então a cor do material chega à tela
// como ele é, sem o contraste e o desvio de matiz da curva de cinema. Só os estouros são comprimidos.
vec3 neutro(vec3 c) {
  c *= uExposure / 0.6 * uTom;
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float pico = max(c.r, max(c.g, c.b));
  if (pico < 0.76) return max(c, 0.0);
  const float d = 0.24;
  float novo = 1.0 - d * d / (pico + d - 0.76);
  c *= novo / pico;
  float g = 1.0 - 1.0 / (0.15 * (pico - novo) + 1.0);
  return clamp(mix(c, vec3(novo), g), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 uv = vUv;
  float underMask = 0.0;
  vec3 c = underwaterComposite(uv, underMask);
  c += texture(tBloom, uv).rgb * uBloom;
  c += uRayColor * texture(tRays, uv).r * (1.0 - underMask);
  c = applyLensDroplets(uv, c);
  c = uTom > 0.0 ? neutro(c) : tonemap(c);
  // Saída neutra: preservar a curva HDR, sem uma segunda curva S nem split toning.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.0 - 0.10 * clamp(uGrade, 0.0, 1.0)), 0.0);
  vec2 q = (vUv - 0.5) * vec2(mix(1.0, uAspect, 0.5), 1.0);
  float uwVig = max(uUnder, underMask);
  c *= 1.0 - (uVignette + 0.16 * uwVig) * smoothstep(0.45, 1.18, length(q) * 1.25);
  c = toSRGB(c);
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
`;

// lente = quality.real?.camera (prova de realismo): { tom: 'neutro', foco: abertura } — sem ela, tudo como antes
export function createPost(renderer, cfg, lente = null) {
  const gl = renderer.getContext();
  const ok = renderer.capabilities.isWebGL2 !== false && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  if (!cfg || !ok) return null;

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri, null);
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.Camera();
  const mk = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
  const v2 = () => ({ value: new THREE.Vector2() });

  const lens = createLensDroplets({ duration: 9.0 });
  const uwShared = {
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uProj: { value: new THREE.Vector4(1, 1, 0.1, 1000) },
    uLensDist: { value: UW_LENS_DIST },
    uBaseSea: { value: -1e4 },
    uWaterY: { value: -1e4 },
    uWaveDepth: { value: 7 },
    uUwMode: { value: 0 },
    uUwBand: { value: Math.min(UW_BAND, 10) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uLightDir: U.uLightDir,
    uSunColor: U.uSunColor,
    uAmbSky: U.uAmbSky,
    uWind: U.uWind,
    uTime: U.uTime,
  };

  const mPre = mk(PREFILTER_FS, { tSrc: { value: null }, uTexel: v2(), uThreshold: { value: cfg.threshold ?? 2.8 } });
  const mDown = mk(DOWN_FS, { tSrc: { value: null }, uTexel: v2() });
  const mUp = mk(UP_FS, { tSrc: { value: null }, tAdd: { value: null }, uTexel: v2(), uSpread: { value: 1 } });
  const mRays = mk(RAYS_FS, { tDepth: { value: null }, uSunUv: v2(), uAspect: { value: 1 } });
  const foco = { abertura: lente?.foco || 0, dist: 8, alvo: 8 };      // dist anda devagar até o alvo, como o foco de uma lente
  const mDof = mk(DOF_FS, { tSrc: { value: null }, tDepth: { value: null }, uTexel: v2(), uPlanos: v2(), uLente: { value: new THREE.Vector4(8, 0, 1, 1.2) } });
  const mUwShafts = mk(UW_SHAFTS_FS, {
    tDepth: { value: null },
    ...uwShared,
  });
  const mFinal = mk(FINAL_FS, {
    tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, tHalf: { value: null },
    tDepth: { value: null }, tUwShafts: { value: null }, uHasUwShafts: { value: 0 },
    uBloom: { value: (cfg.bloom ?? 0.5) * .55 }, uExposure: U.uExposure, uAspect: { value: 1 }, uUnder: { value: 0 },
    uLookUp: { value: 0 },
    uVignette: { value: cfg.vignette ?? 0.2 }, uGrade: { value: cfg.grade ?? 1 }, uRayColor: { value: new THREE.Vector3() },
    uTom: { value: lente?.tom === 'neutro' ? (lente.ganho ?? 0.92) : 0 },     // 0 = curva de cinema de sempre · > 0 = curva neutra, com este ganho
    ...uwShared,
    ...lens.uniforms,
  });

  const LEVELS = 5;
  let scene = null, down = [], up = [], rays = null, uwShafts = null, black = null, dof = null, W = 0, H = 0;
  let lastTime = null;
  let lastSurf = null;
  const half = (o) => ({ type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...o });

  function build(w, h) {
    dispose();
    W = w; H = h;
    const depthTexture = new THREE.DepthTexture(w, h);
    // em telas muito grandes (4K) duas amostras bastam e poupam centenas de MB de memória de vídeo
    const samples = Math.min(cfg.msaa || 0, w * h > 5e6 ? 2 : 4);
    scene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthTexture, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    let lw = w, lh = h;
    for (let i = 0; i < LEVELS; i++) {
      lw = Math.max(2, lw >> 1); lh = Math.max(2, lh >> 1);
      down.push(new THREE.WebGLRenderTarget(lw, lh, half()));
      if (i < LEVELS - 1) up.push(new THREE.WebGLRenderTarget(lw, lh, half()));
    }
    if (cfg.rays) rays = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    if (foco.abertura > 0) dof = new THREE.WebGLRenderTarget(w, h, half());
    uwShafts = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), half());
  }
  function dispose() {
    if (scene) { scene.depthTexture?.dispose(); scene.dispose(); }
    for (const t of down) t.dispose();
    for (const t of up) t.dispose();
    if (rays) rays.dispose();
    if (dof) dof.dispose();
    if (uwShafts) uwShafts.dispose();
    scene = null; down = []; up = []; rays = null; uwShafts = null; dof = null;
  }
  black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  const size = new THREE.Vector2(), sunClip = new THREE.Vector4(), camPos = new THREE.Vector3();
  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }

  // Desenha um quadro inteiro. `state`: { underwater, rays } vindo da atmosfera.
  function render(worldScene, camera, state = {}) {
    renderer.getDrawingBufferSize(size);
    if (!scene || size.x !== W || size.y !== H) build(size.x, size.y);
    renderer.setRenderTarget(scene);
    renderer.render(worldScene, camera);
    // foco de câmera: a cena passa pela lente antes do brilho e da curva de tons
    let cena = scene.texture;
    if (dof && foco.abertura > 0 && !state.underwater) {
      foco.dist += (foco.alvo - foco.dist) * 0.12;
      const u = mDof.uniforms;
      u.tSrc.value = scene.texture; u.tDepth.value = scene.depthTexture; u.uTexel.value.set(1 / W, 1 / H);
      u.uPlanos.value.set(camera.near, camera.far);
      u.uLente.value.set(foco.dist, foco.abertura * 27, H / 900, 1.2 * Math.max(1, (W * H) / 2.2e6));
      pass(mDof, dof);
      cena = dof.texture;
    }

    camera.updateMatrixWorld();
    camera.getWorldPosition(camPos);
    const pe = camera.projectionMatrix.elements;
    uwShared.uCamWorld.value.copy(camera.matrixWorld);
    uwShared.uCamPos.value.copy(camPos);
    uwShared.uProj.value.set(pe[0] || 1, pe[5] || 1, camera.near || 0.1, camera.far || 1000);
    uwShared.uLensDist.value = Math.max(camera.near || 0.1, UW_LENS_DIST);
    uwShared.uResolution.value.set(W, H);

    const nowT = U.uTime.value;
    const dt = lastTime === null ? 1 / 60 : (nowT > lastTime ? nowT - lastTime : 1 / 60);
    lastTime = nowT;

    const getBlock = globalThis.LAVRA?.world?.getBlock || null;
    const surf = avaliarSuperficieCamera(camPos, nowT, U.uWind.value, state.tunelSeco ? -1e4 : U.uSea.value, !!state.underwater, getBlock);
    lastSurf = surf;

    uwShared.uBaseSea.value = surf.baseSea;
    uwShared.uWaterY.value = surf.waterY;
    uwShared.uWaveDepth.value = surf.waveDepth;
    uwShared.uUwMode.value = surf.mode;

    // Transição submerso -> fora dispara gotas na lente (LensDroplets)
    const isSubmerged = !!state.underwater || (surf.hasWater && surf.camH < -0.02);
    lens.update(dt, isSubmerged, camPos.y);

    // bloom: reduz em cascata, depois sobe somando cada nível
    mPre.uniforms.tSrc.value = cena; mPre.uniforms.uTexel.value.set(0.5 / W, 0.5 / H);
    pass(mPre, down[0]);
    for (let i = 1; i < LEVELS; i++) {
      mDown.uniforms.tSrc.value = down[i - 1].texture; mDown.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
      pass(mDown, down[i]);
    }
    let src = down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      mUp.uniforms.tSrc.value = src.texture; mUp.uniforms.tAdd.value = down[i].texture;
      mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      pass(mUp, up[i]);
      src = up[i];
    }

    // Feixes volumétricos submersos (god rays de cáusticas na coluna d'água, meia resolução)
    let hasUwShafts = 0;
    if (uwShafts && surf.active && (cfg.rays !== false)) {
      mUwShafts.uniforms.tDepth.value = scene.depthTexture;
      pass(mUwShafts, uwShafts);
      hasUwShafts = 1;
    }

    // raios aéreos: só quando o sol (ou a lua) está à frente e perto do quadro
    let rayK = 0;
    if (rays && state.rays > 0.001 && surf.mode < 2) {
      sunClip.set(camPos.x + U.uLightDir.value.x * 500, camPos.y + U.uLightDir.value.y * 500, camPos.z + U.uLightDir.value.z * 500, 1)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (sunClip.w > 0) {
        const sx = sunClip.x / sunClip.w * 0.5 + 0.5, sy = sunClip.y / sunClip.w * 0.5 + 0.5;
        const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
        rayK = state.rays * Math.max(0, Math.min(1, (1.15 - off) / 0.5));
        if (rayK > 0.001) {
          mRays.uniforms.tDepth.value = scene.depthTexture; mRays.uniforms.uSunUv.value.set(sx, sy); mRays.uniforms.uAspect.value = W / H;
          pass(mRays, rays);
        }
      }
    }

    const u = mFinal.uniforms;
    u.tScene.value = cena;
    u.tBloom.value = up[0].texture;
    u.tHalf.value = down[0].texture;
    u.tDepth.value = scene.depthTexture;
    u.tUwShafts.value = hasUwShafts ? uwShafts.texture : black;
    u.uHasUwShafts.value = hasUwShafts;
    u.tRays.value = rayK > 0.001 ? rays.texture : black;
    u.uRayColor.value.copy(U.uSunGlow.value).multiplyScalar(rayK * (cfg.rayStrength ?? 0.55));
    u.uAspect.value = W / H;
    u.uUnder.value += ((surf.submerged ? 1 : 0) - u.uUnder.value) * 0.2;
    // A câmera do three olha para o -Z local. O componente Y disso é o quanto se olha para cima.
    const e = camera.matrixWorld.elements;
    u.uLookUp.value = -e[9];
    pass(mFinal, null);
  }

  // distância (m) do que está no centro da tela: o foco anda até lá. abertura = 0 desliga a lente.
  function setFoco(metros, abertura) {
    if (metros > 0) foco.alvo = Math.max(0.6, Math.min(400, metros));
    if (abertura !== undefined && abertura !== foco.abertura) { foco.abertura = Math.max(0, abertura); if (foco.abertura > 0 && !dof && W) dof = new THREE.WebGLRenderTarget(W, H, half()); }
  }
  return {
    render,
    dispose,
    setFoco,
    foco,
    get size() { return [W, H]; },
    cfg,
    lens,
    get underwaterState() { return lastSurf; },
    materials: { mFinal, mPre, mUwShafts, mDof },
  };
}
