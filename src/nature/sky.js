// LAVRA — o céu real no cliente. Quando o mundo tem um lugar na Terra (net.local), calcula onde estão o sol, a lua,
// os planetas e as estrelas para aquele lugar no instante do relógio do mundo (shared/sky.js + Astronomy Engine,
// carregada só nesse caso) e entrega a quem desenha:
//   · game.sky = { on, local, sun, moon: direções no jogo (+X leste, +Y cima, +Z sul), moonLit 0..1, planets[], rot }
//   · atmosphere.state.sky = { sun, moon, moonLight }: a atmosfera usa no lugar do sol inventado e do luar oposto ao sol
//   · U.uSkyReal = 1: o shader do céu deixa de desenhar a lua e as estrelas inventadas
// Estrelas, planetas e lua daqui são desenho provisório (pontos e uma esfera iluminada pelo sol, que dá a fase certa
// sozinha): quem fizer o definitivo lê game.sky e chama game.sky.setLook(false).
// Sem lugar definido (ou offline sem lugar guardado), nada disto liga e o céu segue como antes.

import * as THREE from '../three.js';
import { U } from '../render/materials.js';
import { computeSky, eqjVector, starColor } from '../../shared/sky.js';

const R = 780;                     // distância em que os astros são desenhados (dentro do alcance da câmera)
const MOON_DEG = 1.35;             // raio aparente da lua em graus (a de verdade tem 0,26: aqui é ampliada, como o sol)

const POINT_VS = /* glsl */`
precision highp float;
in vec3 position;
in vec3 aCol;
in float aMag;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform float uPx, uVis, uTime;
out vec3 vCol;
void main() {
  vec3 wd = normalize(mat3(modelMatrix) * position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float flux = pow(10.0, -0.4 * aMag);                       // brilho relativo: magnitude menor = mais luz
  float ext = smoothstep(-0.02, 0.2, wd.y);                  // rente ao horizonte o ar apaga
  float tw = 1.0 + 0.3 * (1.0 - clamp(wd.y, 0.0, 1.0)) * sin(uTime * (2.5 + fract(aMag * 7.31) * 4.0) + aMag * 37.0 + position.x * 91.0);
  gl_PointSize = max(1.0, uPx * (1.0 + 2.3 * pow(flux, 0.35)));
  vCol = aCol * (min(1.9, 0.34 + 1.5 * pow(flux, 0.4)) * ext * tw * uVis);
  if (uVis * ext < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const POINT_FS = /* glsl */`
precision highp float;
uniform float uDirect;
in vec3 vCol;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, d);
  vec3 c = vCol * a;
  if (uDirect > 0.5) c = min(c * 0.85, vec3(1.0));
  outColor = vec4(c, 1.0);
}
`;
const MOON_VS = /* glsl */`
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vN;
out vec3 vL;
void main() { vN = normalize(mat3(modelMatrix) * normal); vL = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const MOON_FS = /* glsl */`
precision highp float;
uniform sampler2D uNoise;
uniform vec3 uSun;
uniform float uVis, uDirect;
in vec3 vN;
in vec3 vL;
out vec4 outColor;
void main() {
  // a face da lua voltada para o sol acende: a fase sai da própria geometria
  float l = max(dot(normalize(vN), uSun), 0.0);
  float lit = smoothstep(0.0, 0.22, l) * (0.6 + 0.4 * l);
  float mare = texture(uNoise, vL.xy * 0.55 + 0.5).r * 0.65 + texture(uNoise, vL.xy * 1.7 + 0.2).g * 0.35;
  vec3 c = vec3(0.93, 0.94, 0.97) * (0.5 + 0.62 * mare) * (lit * 2.5 + 0.014) * uVis;
  if (uDirect > 0.5) c = min(c * 0.6, vec3(1.0));
  outColor = vec4(c, 1.0);
}
`;

export function initSky({ game, net, scene, camera, atmosphere, store, renderer }) {
  const sky = {
    on: false, local: null, sun: [0, 1, 0], moon: [0, -1, 0], moonLit: 0, planets: [], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    look: true, setLook(v) { sky.look = !!v; }, status: 'sem lugar definido',
  };
  game.sky = sky;
  let A = null, loading = false, s0 = null, s1 = null, g0 = 0, span = 30;
  let stars = null, planets = null, moon = null;
  const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, fog: false };
  const pointU = () => ({ uPx: { value: 1 }, uVis: { value: 0 }, uTime: U.uTime, uDirect: U.uDirect });

  async function load() {
    if (A || loading) return;
    loading = true; sky.status = 'carregando';
    try {
      A = await import('../../vendor/astronomy.js');
      const cat = await (await fetch('data/estrelas.json')).json();
      const list = cat.estrelas, n = Math.floor(list.length / 4);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n), v = [0, 0, 0], c = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        eqjVector(list[i * 4], list[i * 4 + 1], v); starColor(list[i * 4 + 3], c);
        pos.set(v, i * 3); col.set(c, i * 3); mag[i] = list[i * 4 + 2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
      stars = new THREE.Points(geo, new THREE.RawShaderMaterial({ name: 'estrelas', glslVersion: THREE.GLSL3, vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: pointU(), ...additive }));
      // planetas: os mesmos pontos, cinco deles, com a posição refeita a cada quadro
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3).setUsage(THREE.DynamicDrawUsage));
      pg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(15), 3));
      pg.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array(5), 1).setUsage(THREE.DynamicDrawUsage));
      planets = new THREE.Points(pg, new THREE.RawShaderMaterial({ name: 'planetas', glslVersion: THREE.GLSL3, vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: pointU(), ...additive }));
      moon = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.RawShaderMaterial({
        name: 'lua', glslVersion: THREE.GLSL3, vertexShader: MOON_VS, fragmentShader: MOON_FS, ...additive,
        uniforms: { uNoise: U.uNoise, uSun: { value: new THREE.Vector3(0, 1, 0) }, uVis: { value: 0 }, uDirect: U.uDirect },
      }));
      for (const o of [stars, planets, moon]) { o.frustumCulled = false; o.renderOrder = 1001; o.visible = false; scene.add(o); }
      stars.scale.setScalar(R); planets.scale.setScalar(R);
      sky.status = 'ligado';
    } catch (e) {
      console.error('[céu real]', e);
      sky.status = 'falhou ao carregar'; A = null;
    }
    loading = false;
  }

  function setLocal(local) {
    sky.local = local && Number.isFinite(local.lat) && Number.isFinite(local.lon) ? local : null;
    s0 = s1 = null;
    if (sky.local) { if (store) store.set('local', sky.local); load(); } else sky.status = 'sem lugar definido';
  }
  game.hooks.other.push((m) => {
    if (m.t === 'welcome') { if ('local' in m) setLocal(m.local); }     // troca de dimensão chega sem lugar: mantém o que havia
    else if (m.t === 'local') setLocal(m.local);
    else if (m.t === 'offline') setLocal(store ? store.get('local', null) : null);     // sem servidor: o último lugar conhecido
  });

  const cam = new THREE.Vector3(), mat = new THREE.Matrix4(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), dir = new THREE.Vector3();
  const quat = (r, q) => q.setFromRotationMatrix(mat.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1));
  const mix = (a, b, k, out) => { out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k; const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; return out; };
  const off = () => {
    sky.on = false;
    if (atmosphere) atmosphere.state.sky = null;
    U.uSkyReal.value = 0;
    if (stars) stars.visible = planets.visible = moon.visible = false;
  };

  game.hooks.frame.push(() => {
    const L = sky.local;
    if (!A || !L || game.dim === 1) return off();           // na Zona Fantasma o céu é outro
    // Dois retratos do céu, um no começo e outro no fim de um trecho do tempo do mundo; no meio, desliza de um ao outro.
    // O trecho cresce com o ritmo do relógio: no ritmo real são 30 s; com o dia correndo num minuto, 0,3 s de verdade.
    const g = net.time(), want = Math.max(30, (net.rate || 0) * 0.3);
    if (!s0 || g < g0 - 1 || g > g0 + span * 2 + 1 || Math.abs(want - span) > span * 0.5) {
      span = want; g0 = g;
      const utc = net.utcMs();
      s0 = computeSky(A, utc, L.lat, L.lon, L.alt || 0); s1 = computeSky(A, utc + span * 1000, L.lat, L.lon, L.alt || 0);
    } else if (g > g0 + span) {
      g0 += span; s0 = s1;
      s1 = computeSky(A, net.utcMs() + (g0 + span - g) * 1000, L.lat, L.lon, L.alt || 0);
    }
    const k = Math.max(0, Math.min(1, (g - g0) / span));
    mix(s0.sun, s1.sun, k, sky.sun); mix(s0.moon, s1.moon, k, sky.moon);
    sky.moonLit = s0.moonLit + (s1.moonLit - s0.moonLit) * k;
    sky.planets = s0.planets.map((p, i) => ({ id: p.id, nome: p.nome, cor: p.cor, mag: p.mag, dir: mix(p.dir, s1.planets[i].dir, k, [0, 0, 0]) }));
    quat(s0.rot, q0).slerp(quat(s1.rot, q1), k);
    sky.rot = s0.rot; sky.on = true;

    // a atmosfera passa a usar o sol e a lua de verdade (ela lê isto no começo do quadro seguinte)
    const moonLight = sky.moonLit * Math.max(0, Math.min(1, sky.moon[1] / 0.25));
    if (atmosphere) atmosphere.state.sky = { sun: sky.sun, moon: sky.moon, moonLight };
    U.uSkyReal.value = sky.look ? 1 : 0;
    if (!stars) return;
    stars.visible = planets.visible = moon.visible = sky.look;
    if (!sky.look) return;

    camera.getWorldPosition(cam);
    const night = U.uNight.value, w = game.weather;
    const clear = w ? 1 - Math.max(0, Math.min(1, (w.cover - 0.35) / 0.6)) * 0.97 : 1;       // nuvem esconde estrela
    const px = Math.max(1, (renderer ? renderer.domElement.height : 1080) / 900);       // tela maior, ponto maior
    stars.position.copy(cam); stars.quaternion.copy(q0);
    stars.material.uniforms.uVis.value = night * night * clear; stars.material.uniforms.uPx.value = px;
    planets.position.copy(cam);
    const pa = planets.geometry.attributes;
    sky.planets.forEach((p, i) => { pa.position.setXYZ(i, p.dir[0], p.dir[1], p.dir[2]); pa.aCol.setXYZ(i, p.cor[0], p.cor[1], p.cor[2]); pa.aMag.setX(i, Math.max(-3.2, p.mag)); });
    pa.position.needsUpdate = pa.aCol.needsUpdate = pa.aMag.needsUpdate = true;
    planets.material.uniforms.uVis.value = Math.min(1, night * 1.7) * clear; planets.material.uniforms.uPx.value = px * 1.25;
    // lua: uma esfera longe, virada para quem olha, iluminada pela direção do sol
    dir.set(sky.moon[0], sky.moon[1], sky.moon[2]);
    moon.position.copy(cam).addScaledVector(dir, R);
    moon.scale.setScalar(R * Math.tan(MOON_DEG * Math.PI / 180));
    moon.lookAt(cam);
    moon.material.uniforms.uSun.value.set(sky.sun[0], sky.sun[1], sky.sun[2]);
    const thin = w ? 1 - Math.max(0, Math.min(1, (w.cover - 0.5) / 0.5)) * 0.85 : 1;
    moon.material.uniforms.uVis.value = (0.25 + 0.75 * night) * thin * Math.max(0, Math.min(1, (sky.moon[1] + 0.03) / 0.08));
  });

  return sky;
}
