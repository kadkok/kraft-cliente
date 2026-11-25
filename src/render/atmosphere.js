// LAVRA — céu, sol/lua e névoa. Converte a hora do mundo nos uniforms dos shaders
// e mantém as luzes do three (usadas por objetos, avatares e máquinas) em sincronia.
// Inclui a óptica de coluna d'água e névoa submarina Beer-Lambert (turquesa raso -> azul profundo)
// com degradação elegante sem pós-processamento (VR e perfil baixo).
// Adaptado de dgreenheck/tidewater (src/ocean/UnderwaterLighting.js, src/post/Underwater.js,
// MIT License — Copyright (c) Dan Greenheck).

import * as THREE from '../three.js';
import { U, createSkyMaterial } from './materials.js';
import { createOptics } from './optics.js';
import { NATURE } from './nature-state.js';
import { DAY_LENGTH, DAY_PORTION, SEA } from '../../shared/constants.js';
import { alturaOnda } from '../../shared/ondas.js';
import { corNevoaSubmarina } from './submarino.js';
import { AGUA, luzDoDia } from './agua-clara.js';

const TILT = 0.6; // inclinação da órbita: ao meio-dia o sol fica a ~56° de altura
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp3 = (out, a, b, t) => out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

// mesma curva ACES dos shaders, para a névoa dos materiais padrão casar com a do terreno
function acesChannel(r, g, b, out) {
  const k = U.uExposure.value / 0.6;
  r *= k; g *= k; b *= k;
  let x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  let y = 0.076 * r + 0.90834 * g + 0.01566 * b;
  let z = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const f = (c) => (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.432951) + 0.238081);
  x = f(x); y = f(y); z = f(z);
  out.setRGB(
    Math.min(1, Math.max(0, 1.60475 * x - 0.53108 * y - 0.07367 * z)),
    Math.min(1, Math.max(0, -0.10208 * x + 1.10813 * y - 0.00605 * z)),
    Math.min(1, Math.max(0, -0.00327 * x - 0.07276 * y + 1.07602 * z)));
}

export function createAtmosphere(scene, quality) {
  const optics=createOptics(scene,quality);
  let weatherAt=performance.now()/1000,cloud=.52,rain=0,mist=0;
  const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), createSkyMaterial(quality));
  sky.frustumCulled = false;
  sky.renderOrder = 1000; // depois dos opacos: só pinta onde o terreno não cobriu
  sky.matrixAutoUpdate = false;
  scene.add(sky);

  // balanço sol × céu: ao ar livre, de verdade, o sol direto vale 6 a 10 vezes a luz do céu; com 1,85 × 0,42 (~4×) a sombra
  // ficava um cinza claro e tudo parecia igualmente iluminado. LUZ.sol e LUZ.ceu ajustam isso (17/11).
  const LUZ = { sol: 2.15, ceu: 0.78, ...(quality.real?.luz || {}) };   // prova de realismo (config.js → REAL.luz)
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, Math.PI);
  scene.add(sun, sun.target, hemi);
  scene.fog = new THREE.Fog(0x88aacc, 70, 160);

  const state = { dayFrac: 0.4, elevation: 1, underwater: false, envInside: false, sea: -1e4, waterY: -1e4, camDepth: 0 };
  const tmp = new THREE.Vector3();
  const lastCam = new THREE.Vector3(0, SEA + 2, 0);

  // ---- sombra do sol: um mapa só, centrado em quem olha -----------------------------------
  // O que mais importa não é a resolução, é o enquadramento justo: o mapa cobre só `radius` metros em volta.
  const sh = quality.shadow;
  const shN = sh && quality.real?.shadowNear ? quality.real.shadowNear : null;   // sombra de perto (prova de realismo)
  const sunN = new THREE.DirectionalLight(0xffffff, 0);
  if (shN) scene.add(sunN, sunN.target);
  const right = new THREE.Vector3(), up = new THREE.Vector3(), target = new THREE.Vector3();
  let shFrame = 0, shPending = false;
  let renderer0 = null;
  function setupShadows(renderer) {
    if (!sh) return;
    renderer0 = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;      // refeito por aqui, no ritmo do perfil
    sun.castShadow = true;
    sun.shadow.mapSize.set(sh.size, sh.size);
    const c = sun.shadow.camera;
    c.left = -sh.radius; c.right = sh.radius; c.top = sh.radius; c.bottom = -sh.radius; c.near = 1; c.far = 520;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;   // para os materiais padrão (objetos, máquinas, seres)
    // O three atualiza esta matriz antes de desenhar o terreno. Compartilhar a
    // referência mantém mapa e projeção no mesmo quadro, inclusive quando a sombra
    // só é refeita a cada 2/3 quadros. Uma cópia em afterRender chega um quadro tarde.
    U.uShadowMatrix.value = sun.shadow.matrix;
    U.uShadowInfo.value.x = 1 / sh.size;
    U.uShadowInfo.value.z = sh.soft || 2;
    if (shN) {
      // Sombra de perto (prova de realismo). O mapa de sempre cobre 200 m com 2048 pontos: ~10 cm por ponto, e a sombra de
      // uma copa vira uma mancha. Este cobre só `radius` metros em volta de quem olha (28 m em 4096 = 0,7 cm por ponto):
      // aparece a folha, a lâmina de grama, o pé do tronco. É uma segunda luz do three SEM força (intensidade 0): ela só
      // existe para o three desenhar o mapa com as mesmas malhas e materiais de sombra; quem lê é o shader do terreno.
      sunN.castShadow = true;
      sunN.shadow.mapSize.set(shN.size, shN.size);
      const cn = sunN.shadow.camera;
      cn.left = -shN.radius; cn.right = shN.radius; cn.top = shN.radius; cn.bottom = -shN.radius; cn.near = 1; cn.far = 520;
      cn.updateProjectionMatrix();
      sunN.shadow.bias = -0.0002; sunN.shadow.normalBias = 0.02;
      // cada luz no seu ritmo: a de longe a cada `every` quadros (como antes), a de perto em todo quadro
      sun.shadow.autoUpdate = false; sunN.shadow.autoUpdate = false;
      U.uShadowMatrixN.value = sunN.shadow.matrix;
      U.uShadowInfoN.value.set(1 / shN.size, 0, 1 / (cn.far - cn.near), shN.penumbra || 0.0105);
    }
  }
  // Reposiciona a luz em torno da câmera, em passos de um texel (sem isso a sombra "ferve" ao andar).
  function aimShadow(renderer, cam) {
    if (cam && Number.isFinite(cam.x)) lastCam.copy(cam);
    if (!sh) return;
    const far = shFrame++ % sh.every === 0;
    if (!far && !shN) return;
    const dir = U.uLightDir.value;
    right.set(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize(); up.crossVectors(dir, right).normalize();
    const aim = (light, radius, size) => {
      const texel = (2 * radius) / size;
      const x = Math.round(cam.dot(right) / texel) * texel, y = Math.round(cam.dot(up) / texel) * texel;
      target.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(dir, cam.dot(dir));
      light.target.position.copy(target);
      light.position.copy(target).addScaledVector(dir, 260);
      light.target.updateMatrixWorld(); light.updateMatrixWorld();
    };
    if (far) { aim(sun, sh.radius, sh.size); if (shN) sun.shadow.needsUpdate = true; }
    if (shN) { aim(sunN, shN.radius, shN.size); sunN.shadow.needsUpdate = true; }
    renderer.shadowMap.needsUpdate = true;
    shPending = true;
  }
  // Disponibiliza a textura após a primeira renderização. A matriz já é compartilhada
  // com o three e fica atualizada antes de cada desenho do terreno.
  function afterRender() {
    if (!shPending || !sun.shadow.map) return;
    shPending = false;
    U.uShadowMap.value = sun.shadow.map.depthTexture;
    U.uShadowInfo.value.y = 1;
    if (shN && sunN.shadow.map) { U.uShadowMapN.value = sunN.shadow.map.depthTexture; U.uShadowInfoN.value.y = 1; }
  }

  // hora do mundo (s) -> fração do dia com o sol nascendo em d0 e se pondo em 1 - d0
  function sunAngle(f) {
    const d0 = (1 - DAY_PORTION) / 2;
    if (f >= d0 && f <= 1 - d0) return ((f - d0) / DAY_PORTION) * Math.PI;
    const g = (f < d0 ? f + d0 : f - (1 - d0)) / (1 - DAY_PORTION);
    return Math.PI + g * Math.PI;
  }

  // sea = altura da superfície da água nesta dimensão (ou um valor muito baixo, se não há mar)
  function update(worldTime, fogDistance, zone, sea = -1e4) {
    const f = ((worldTime / DAY_LENGTH) % 1 + 1) % 1;
    state.dayFrac = f;
    state.sea = sea;
    const a = sunAngle(f);
    const sd = U.uSunDir.value.set(Math.cos(a), Math.sin(a) * Math.cos(TILT), Math.sin(a) * Math.sin(TILT));
    // céu real (nature/sky.js): com um lugar da Terra definido, o sol e a lua vêm de onde estão de verdade
    const real = !zone && state.sky ? state.sky : null;
    if (real) sd.set(real.sun[0], real.sun[1], real.sun[2]);
    const e = sd.y;
    state.elevation = e;
    const azl = Math.hypot(sd.x, sd.z) || 1;
    U.uSunAz.value.set(sd.x / azl, sd.z / azl);
    U.uSea.value = sea;

    const day = ss(-0.08, 0.22, e);
    const dusk = Math.min(1, Math.max(0, 1 - Math.abs(e) / 0.28));
    const night = 1 - ss(-0.18, 0.02, e);
    const shared = globalThis.LAVRA?.scene === scene ? globalThis.LAVRA.game?.weather : null;
    const overcast = zone ? 0 : Math.max(0, Math.min(1, ((shared?.cover ?? (NATURE.active ? NATURE.cover : .3)) - .3) / .7));
    // A fase sozinha não cria uma luz sob o horizonte. A astronomia já atenua o luar,
    // mas o contrato também é seguro para quem fornece a fase sem essa atenuação.
    const moonK = real ? Math.max(0, Math.min(1, real.moonLight)) * ss(0, .12, real.moon[1]) : 1;
    lerp3(U.uZenith.value, [0.005, 0.0068, 0.009], [0.07, 0.205, 0.6], day);
    U.uZenith.value.lerp(tmp.set(0.09, 0.1, 0.3), dusk * 0.5);
    lerp3(U.uHorizon.value, [0.014, 0.018, 0.023], [0.54, 0.71, 0.92], day);
    U.uZenith.value.multiplyScalar(1 - night * overcast * .48);
    U.uHorizon.value.multiplyScalar(1 - night * overcast * .48);
    // crepúsculo: o horizonte inteiro vai para um malva frio; o lado do sol ganha o laranja por cima (uDusk)
    const glow = dusk * ss(-0.22, -0.02, e);
    U.uHorizon.value.lerp(tmp.set(0.6, 0.4, 0.5), glow * 0.62);
    U.uDusk.value.set(1.0, 0.44, 0.1, glow * 0.95);
    lerp3(U.uSunGlow.value, [1.0, 0.35, 0.1], [1.0, 0.9, 0.75], ss(0, 0.4, e)).multiplyScalar(ss(-0.12, 0.02, e));

    const sunK = ss(-0.04, 0.12, e);
    // (17/11, pedido do Kadmus: "iluminação e sombras… muito surreal") sol mais forte e dourado por mais tempo no sol baixo
    lerp3(U.uSunColor.value, [1.0, 0.45, 0.17], [1.0, 0.93, 0.82], ss(0.02, 0.55, e)).multiplyScalar(LUZ.sol * sunK);
    if (e > -0.04) U.uLightDir.value.copy(sd);
    else if (real) {
      // luar de verdade: vem de onde a lua está e tem a força da fase; lua abaixo do horizonte é noite sem luar
      if (real.moon[1] > 0.02) U.uLightDir.value.set(real.moon[0], real.moon[1], real.moon[2]); else U.uLightDir.value.set(0.3, 0.9, 0.3).normalize();
      U.uSunColor.value.add(tmp.set(0.68, 0.75, 0.86).multiplyScalar(0.12 * moonK * ss(-0.04, -0.2, e)));
    } else {
      U.uLightDir.value.copy(sd).negate();
      U.uSunColor.value.add(tmp.set(0.68, 0.75, 0.86).multiplyScalar(0.12 * ss(-0.04, -0.2, e)));
    }
    // Preenchimento cai antes de apagar o sol: margem em contraluz e planos separados
    // pela bruma, sem escurecer a imagem inteira nem alterar a luz das tochas.
    const fill = ss(-.04, .42, e);
    lerp3(U.uAmbSky.value, [0.04, 0.046, 0.058], [0.31 * LUZ.ceu, 0.42 * LUZ.ceu, 0.62 * LUZ.ceu], fill);
    U.uAmbSky.value.addScaledVector(tmp.set(.014, .011, .006), dusk);
    U.uAmbSky.value.multiplyScalar(1 - night * overcast * .25);
    // luz que vem de baixo: o chão ensolarado devolve um pouco do sol, mais quente que o céu
    lerp3(U.uAmbGround.value, [0.0135, 0.0165, 0.021], [0.09, 0.09, 0.085], fill);
    U.uAmbGround.value.multiplyScalar(1 - night * overcast * .25);
    const bounce = 0.075 * Math.max(0, e) * sunK;
    U.uAmbGround.value.x += U.uSunColor.value.x * bounce; U.uAmbGround.value.y += U.uSunColor.value.y * bounce * 0.9; U.uAmbGround.value.z += U.uSunColor.value.z * bounce * 0.68;
    // bruma do ar: fina de dia, mais densa ao amanhecer e ao entardecer
    U.uHaze.value.set(0.1 + 0.3 * dusk * (1 - 0.5 * day) + 0.12 * (1 - day), 0.0058, Math.max(sea, 0), 0.017);
    U.uNight.value = night;
    U.uCloudLit.value.copy(U.uSunColor.value).multiplyScalar(.5 - night * .3).addScaledVector(U.uAmbSky.value, 1.9 - night * .65);
    U.uCloudDark.value.copy(U.uAmbSky.value).multiplyScalar(1.1).addScaledVector(U.uSunColor.value, 0.05);
    U.uCloudLit.value.multiplyScalar(1 - night * overcast * .15);
    U.uCloudDark.value.multiplyScalar(1 - night * overcast * .15);
    U.uCloudCover.value = 0.52;
    let day2 = day;
    if (zone) {
      // Zona Fantasma: crepúsculo parado, um sol preso e roxo, estrelas sempre
      sd.set(0.25, 0.42, -0.87).normalize();
      U.uLightDir.value.copy(sd);
      U.uZenith.value.set(0.012, 0.006, 0.03);
      U.uHorizon.value.set(0.12, 0.04, 0.17);
      U.uSunGlow.value.set(0.56, 0.26, 0.86);
      U.uSunColor.value.set(0.46, 0.34, 0.74);
      U.uAmbSky.value.set(0.09, 0.07, 0.16);
      U.uAmbGround.value.set(0.04, 0.025, 0.06);
      U.uNight.value = 0.9;
      U.uCloudLit.value.set(0.26, 0.16, 0.38);
      U.uCloudDark.value.set(0.04, 0.025, 0.07);
      U.uCloudCover.value = 0.58;
      U.uDusk.value.set(0.5, 0.16, 0.7, 0.6);
      U.uHaze.value.set(0.5, 0.012, 0, 0.004);
      day2 = 0.25;
      fogDistance *= 0.8;
    }

    const activeCam = globalThis.LAVRA?.scene === scene ? globalThis.LAVRA.camera : null;
    if (activeCam?.getWorldPosition) activeCam.getWorldPosition(lastCam);
    const waveY = sea > -1e3
      ? sea + alturaOnda(lastCam.x, lastCam.z, U.uTime.value, U.uWind.value, 7)
      : (state.underwater ? Math.floor(lastCam.y) + 0.88 : -1e4);
    state.waterY = waveY;

    // Água clara do mar (render/agua-clara.js): a luz difusa logo abaixo da superfície e o véu que a água devolve por
    // metro saem da luz do dia deste instante (céu + parte do sol). Valem para o terreno, o recife e o pós-processamento.
    {
      const dia = luzDoDia(U.uSunColor.value, U.uAmbSky.value, U.uLightDir.value.y);
      U.uAguaCeu.value.set(AGUA.cor[0] * dia, AGUA.cor[1] * dia, AGUA.cor[2] * dia);
      U.uAguaVeu.value.set(AGUA.veu[0] * dia * AGUA.veuGanho, AGUA.veu[1] * dia * AGUA.veuGanho, AGUA.veu[2] * dia * AGUA.veuGanho);
      const sl = U.uSunColor.value, alto = Math.max(0, Math.min(1, U.uLightDir.value.y * 4));      // sol rasante quase não entra na água
      U.uAguaVeuSol.value.set(AGUA.veuSol[0] * sl.x * alto * AGUA.veuGanho, AGUA.veuSol[1] * sl.y * alto * AGUA.veuGanho, AGUA.veuSol[2] * sl.z * alto * AGUA.veuGanho);
    }
    let uwFog = null;
    if (state.underwater) {
      // Óptica submarina Tidewater: absorção Beer-Lambert por distância e profundidade (turquesa raso -> azul oceânico escuro).
      // Degrada com elegância quando não há pós-processamento (VR / perfil baixo, U.uDirect > 0.5).
      const camDepth = Number.isFinite(state.depthOverride)
        ? Math.max(0, state.depthOverride)
        : Math.max(0.25, waveY > -1e3 ? waveY - lastCam.y : 1.5);
      state.camDepth = camDepth;
      const dayK = 0.26 + day2 * 0.74;
      uwFog = corNevoaSubmarina(camDepth, U.uLightDir.value, U.uSunColor.value, U.uAmbSky.value, dayK);
      U.uFogTint.value.set(uwFog.r, uwFog.g, uwFog.b, 1);
      const claro = U.uMarNovo.value > 0.5;      // o mar do arquipélago: água clara (24/11/2026); lago e rio seguem como eram
      if (U.uDirect.value > 0.5) {
        // Sem pós-processamento (VR / perfil baixo): a névoa e a bruma dos shaders diretos fecham a absorção submarina
        if (claro) {
          U.uFog.value.set(AGUA.vista * 0.3, AGUA.vista * (0.95 - 0.12 * Math.min(1, rain)));
          U.uHaze.value.set(0.86, 0.034, Math.max(sea, 0), 0.0);
        } else {
          const farUw = (16 + 6 * (1 - Math.min(1, rain))) * (1 - uwFog.deepK * 0.25);
          U.uFog.value.set(1.1, Math.max(6, farUw));
          U.uHaze.value.set(0.42, 0.068, Math.max(sea, 0), 0.008);
        }
      } else {
        // Com pós-processamento: o post.js integra a absorção por pixel e a névoa do terreno fecha o horizonte distante
        if (claro) U.uFog.value.set(AGUA.vista * 0.62, AGUA.vista * 1.04);
        else U.uFog.value.set(16, 44 + 8 * (1 - Math.min(1, rain)));
        U.uHaze.value.x = 0;
      }
    } else {
      state.camDepth = 0;
      U.uFogTint.value.w = 0;
      // névoa só no terço final da distância de visão: esconde a borda sem lavar o que está perto
      if (state.envInside) { U.uFog.value.set(1e5, 2e5); U.uHaze.value.x = 0; } else U.uFog.value.set(fogDistance * 0.5, fogDistance * 0.98);
    }

    // O servidor decide o clima. Aqui só interpolamos sua resposta visual.
    const now=performance.now()/1000,dt=Math.max(0,Math.min(.25,now-weatherAt));weatherAt=now;
    const weather=(NATURE.active||!!shared)&&!zone;
    const k=1-Math.exp(-dt*.7);
    cloud+=((weather?(shared?.cover??NATURE.cover):.52)-cloud)*k;
    rain+=((weather?(shared?.rain??NATURE.rain):0)-rain)*k;
    mist+=((weather?(shared?.fog??NATURE.fog):0)-mist)*k;
    if(weather&&(shared?.rain??NATURE.rain)>0.02) NATURE.lastRain=now;
    // O cliente nature.js já ajusta o céu e desenha chuva quando está presente.
    // Não multiplicar seu escurecimento: só complementar molhado/óptica aqui.
    if(weather&&!shared) {
      U.uCloudCover.value=.67-cloud*.28;
      U.uSunColor.value.multiplyScalar(1-cloud*rain*.72);
      U.uAmbSky.value.multiplyScalar(1-rain*.2);
      U.uHaze.value.x+=mist*.35;
      U.uHaze.value.y*=1+mist*1.8;
    }
    const wetK=1-Math.exp(-dt*(rain>U.uWetness.value?.6:.018));
    U.uWetness.value+=(rain-U.uWetness.value)*wetK;
    const droplets=weather?Math.max(rain*.5,Math.max(0,1-(now-NATURE.lastRain)/100)*.48):0;
    const rainbow=state.underwater||state.envInside||zone?0:droplets*(1-cloud*.65)*ss(.02,.12,e)*(1-ss(.55,.67,e));
    U.uRainbow.value+=(rainbow-U.uRainbow.value)*(1-Math.exp(-dt*.9));
    optics.update(now);

    // luzes e névoa dos materiais padrão (com atenuação submarina Beer-Lambert de UnderwaterLighting.js)
    if (!sh) sun.position.copy(U.uLightDir.value).multiplyScalar(100);   // com sombra, quem posiciona a luz é o aimShadow
    if (uwFog) {
      sun.color.setRGB(
        U.uSunColor.value.x * uwFog.attSun[0],
        U.uSunColor.value.y * uwFog.attSun[1],
        U.uSunColor.value.z * uwFog.attSun[2],
      );
      hemi.color.setRGB(
        U.uAmbSky.value.x * uwFog.attAmb[0],
        U.uAmbSky.value.y * uwFog.attAmb[1],
        U.uAmbSky.value.z * uwFog.attAmb[2],
      );
    } else {
      sun.color.setRGB(U.uSunColor.value.x, U.uSunColor.value.y, U.uSunColor.value.z);
      hemi.color.setRGB(U.uAmbSky.value.x, U.uAmbSky.value.y, U.uAmbSky.value.z);
    }
    hemi.groundColor.setRGB(U.uAmbGround.value.x, U.uAmbGround.value.y, U.uAmbGround.value.z);
    const ft = U.uFogTint.value, hz = U.uHorizon.value;
    const fr = hz.x + (ft.x - hz.x) * ft.w, fg = hz.y + (ft.y - hz.y) * ft.w, fb = hz.z + (ft.z - hz.z) * ft.w;
    // com pós-processamento a cena sai linear e a curva de tons vem depois: a névoa dos materiais padrão vai crua
    if (U.uDirect.value > 0.5) acesChannel(fr, fg, fb, scene.fog.color); else scene.fog.color.setRGB(fr, fg, fb);
    // raios de sol: mais fortes com o sol baixo; a lua quase não faz
    state.rays = (state.underwater || state.envInside ? 0 : zone ? 0.5 : (0.35 + 0.65 * dusk) * ss(-0.1, 0.05, e) + 0.12 * U.uNight.value)*(1-rain*.8);
    scene.fog.near = U.uFog.value.x; scene.fog.far = U.uFog.value.y;
  }

  // regulador do VR (game/vr-desempenho.js): ritmo da sombra ou sombra desligada (força 0 = o terreno usa a estimativa pela luz do céu)
  const shEvery0 = sh ? sh.every : 0;
  function setSombra(ligada, every) { if (!sh) return; sh.every = ligada ? (every || shEvery0) : 1e9; if (!ligada) U.uShadowInfo.value.y = 0; else if (sun.shadow.map) { U.uShadowInfo.value.y = 1; renderer0?.shadowMap && (renderer0.shadowMap.needsUpdate = true); } }
  return { sky, sun, hemi, state, update, setupShadows, aimShadow, afterRender, optics, setSombra };
}
