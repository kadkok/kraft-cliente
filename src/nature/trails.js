// LAVRA — trilhas no chão macio. Quem passa (gente, rebanho, rato, sapo) afunda um pouco a areia, a argila e a terra
// molhada: não fica pegada desenhada, fica o caminho levemente mais fundo e mais escuro, como no mundo de verdade.
// Na areia o vento e a onda devolvem o grão ao lugar em menos de um minuto; no barro a marca fica, e quando a terra
// seca ela endurece e só some muito devagar.
//
// O campo é um mapa visto de cima, 256 × 256 texels cobrindo 64 m, que SE REPETE a cada 64 m (endereço toroidal):
// andar nunca obriga a refazer o mapa, e o que fica a mais de 28 m de quem olha é apagado para não reaparecer
// "dobrado" num lugar que só coincide no endereço. Canais: R = marca, G = solo (areia 128, barro 255), B = altura do
// chão marcado (o shader só desenha onde a altura confere: o barranco de baixo não herda a trilha de cima).
//
// Esta parte é só a lógica e os dados: quem marca, onde, e como a marca some. main.js cria o campo (perfis com
// `trails`), guarda-o em game.trails e põe a textura e os uniforms no registro U de render/materials.js:
// U.uTrail, U.uTrailInfo e U.uTrailCam. O DESENHO da trilha no terreno é de quem cuida dos shaders. Para desenhar:
//   - colar TRAIL_GLSL no fragment do terreno, depois do `precision` (declara uTrail com highp; não vai no vertex);
//   - só no topo dos blocos que cedem ao passo: SOFT_LAYERS traz as camadas de textura deles (vLayer);
//   - depois de montar albedo, N e rough, algo como:
//       vec3 t = trailAt(vWorld) * step(0.5, Ng.y);               // faces de lado não marcam
//       float clay = trailClay(vWorld);                             // 0 = areia, 1 = barro
//       albedo *= 1.0 - (0.3 + 0.12 * clay * (0.5 + 0.5 * uWetness)) * t.x;   // pisado escurece; barro molhado mais
//       rough = mix(rough, rough * 0.8, t.x);                       // grão compactado reflete um pouco mais
//       N = normalize(N + vec3(t.y, 0.0, t.z) * 1.6);               // a borda do sulco inclina a luz: parece mais fundo
//   - enquanto uTrailInfo.z (alcance, em metros) for 0 não há campo: não consultar o mapa.
// Uma passada de gente deixa a marca em ~23% do máximo; os números acima são ponto de partida, não receita.

import { B, TEX, LEVEL } from '../../shared/blocks.js';
import { SEA } from '../../shared/constants.js';

// ---- parte pura (Node e navegador, sem three) -----------------------------------------------------------------
// Solo que marca: 1 = areia (grão solto que o vento e a água alisam) · 2 = barro (guarda a forma).
// A terra só vale como barro quando molhada (softClass); relva tem raiz amarrando o chão e não marca.
export const SOFT = new Uint8Array(128);
SOFT[B.SAND] = SOFT[B.ASH] = SOFT[B.SNOW] = 1;
SOFT[B.CLAY] = SOFT[B.DIRT] = 2;

// Camadas de textura da face de cima dos blocos que marcam (TEX de blocks.js). O shader do terreno só desenha a
// trilha nelas: a mancha de quem pisou na beira da areia não vaza para a pedra nem para a relva ao lado.
export const SOFT_LAYERS = [...new Set(Array.from(SOFT.keys()).filter((id) => SOFT[id]).map((id) => TEX[id * 6 + 2]))].sort((a, b) => a - b);

export function softClass(blockId, wetness = 0) {
  if (blockId < 0 || blockId >= 128) return 0;
  const c = SOFT[blockId];
  if (blockId === B.DIRT) return wetness >= 0.3 ? 2 : 0;    // terra seca é dura demais para ceder ao passo
  return c;
}

const LN2 = Math.LN2;
const SAND_FILL = 0.3;     // quanto a areia enche por segundo, na escala 0..255 da marca
const GAIN = 0.6;          // uma passada de gente deixa ~40% da marca máxima; três passadas no mesmo lugar saturam

export function createTrailField({ size = 256, span = 64 } = {}) {
  const N = size * size;
  const data = new Uint8Array(N * 4);
  const level = new Float32Array(N);      // a marca em ponto flutuante: o byte sozinho arredondaria o sumiço para nunca
  const ts = span / size;                  // lado do texel (m)
  for (let i = 0; i < N; i++) data[i * 4 + 3] = 255;
  const wrap = (i) => ((i % size) + size) % size;

  const field = {
    size, span, data, level, dirty: false, wetness: 0,
    // índice do texel que contém (x, z) no mapa repetido
    index(x, z) { return wrap(Math.floor(z / ts)) * size + wrap(Math.floor(x / ts)); },
    texel(x, z) { return data[field.index(x, z) * 4]; },

    // Uma mancha macia: (1 - d²/r²)² cai até zero na borda sem degrau. Bicho pequeno ganha um raio mínimo de pouco
    // mais de um texel (senão a mancha cairia entre os centros e sumiria) e a força cai na raiz da razão.
    stamp(x, y, z, radius, strength, cls) {
      if (!(cls === 1 || cls === 2) || !(strength > 0) || !(radius > 0)) return;
      const re = Math.max(radius, ts * 1.25);
      const s = Math.min(1, strength) * Math.sqrt(Math.min(1, radius / re)) * 255 * GAIN;
      const g = cls === 2 ? 255 : 128;
      const h = Math.max(0, Math.min(159, Math.round(y)));
      const ring = re + ts * 1.5;          // uma volta a mais só recebe solo e altura (a borda filtrada não mente)
      const i0 = Math.floor((x - ring) / ts), i1 = Math.floor((x + ring) / ts);
      const j0 = Math.floor((z - ring) / ts), j1 = Math.floor((z + ring) / ts);
      const r2 = re * re;
      let changed = false;
      for (let j = j0; j <= j1; j++) {
        const dz = (j + 0.5) * ts - z, row = wrap(j) * size;
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * ts - x, d2 = dx * dx + dz * dz;
          const k = row + wrap(i), o = k * 4, old = level[k];
          if (d2 >= r2) {
            if (old < 1 && (data[o + 1] !== g || data[o + 2] !== h)) { data[o + 1] = g; data[o + 2] = h; changed = true; }
            continue;
          }
          const q = 1 - d2 / r2, add = s * q * q;
          const v = Math.min(255, old + add);
          if ((add >= old * 0.5 || old < 1) && (data[o + 1] !== g || data[o + 2] !== h)) {
            data[o + 1] = g; data[o + 2] = h; changed = true;   // a marca mais nova manda no solo e na altura
          }
          if (v !== old) {
            level[k] = v;
            const b = Math.round(v);
            if (b !== data[o]) { data[o] = b; changed = true; }
          }
        }
      }
      if (changed) field.dirty = true;
    },

    // Sumiço exponencial por texel. Areia: meia-vida de 40 s, encurtada pelo vento e de ~10 s na beira do mar
    // (a onda lava). Barro: molhado quase não muda (10 min); seco, endurece e leva meia hora.
    decay(dt, env = {}) {
      if (!(dt > 0)) return;
      const wind = Math.abs(env.wind || 0), wet = env.wetness || 0, seaY = env.seaY ?? SEA;
      const hlSand = 40 / (1 + wind / 5), hlSea = Math.min(10, hlSand);
      const kSand = Math.exp(-dt * LN2 / hlSand);
      const kSea = Math.exp(-dt * LN2 / hlSea);
      // na areia, além da meia-vida, um tanto fixo por segundo: o sulco raso, da altura de um grão, se enche de vez
      // (só a exponencial deixaria um resto invisível por minutos). Uma passada de gente some em ~2 min sem vento.
      const cSand = SAND_FILL * dt * (40 / hlSand), cSea = SAND_FILL * dt * (40 / hlSea);
      const kClay = Math.exp(-dt * LN2 / (wet >= 0.15 ? 600 : 1800));
      const shore = seaY + 2.5;             // altura gravada é o topo do chão: a areia molhada pela onda fica até 2 acima
      let changed = false;
      for (let k = 0; k < N; k++) {
        let v = level[k];
        if (v === 0) continue;
        const o = k * 4;
        if (data[o + 1] === 255) v *= kClay;
        else if (data[o + 2] <= shore) v = v * kSea - cSea;
        else v = v * kSand - cSand;
        if (v < 0.5) v = 0;
        level[k] = v;
        const b = Math.round(v);
        if (b !== data[o]) { data[o] = b; changed = true; }
      }
      if (changed) field.dirty = true;
    },

    // Apaga o que fica a mais de `keep` metros de (cx, cz), medindo pela cópia do texel mais próxima no mapa repetido.
    clearFar(cx, cz, keep) {
      const k2 = keep * keep;
      let changed = false;
      for (let j = 0; j < size; j++) {
        let dz = (j + 0.5) * ts - cz;
        dz -= span * Math.round(dz / span);
        const dz2 = dz * dz;
        for (let i = 0; i < size; i++) {
          let dx = (i + 0.5) * ts - cx;
          dx -= span * Math.round(dx / span);
          if (dx * dx + dz2 <= k2) continue;
          const k = j * size + i, o = k * 4;
          if (level[k] === 0 && data[o] === 0 && data[o + 1] === 0 && data[o + 2] === 0) continue;
          level[k] = 0; data[o] = data[o + 1] = data[o + 2] = 0;
          changed = true;
        }
      }
      if (changed) field.dirty = true;
    },

    reset() {
      level.fill(0);
      for (let k = 0; k < N; k++) { const o = k * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
      field.dirty = true;
    },
  };
  return field;
}

// ---- trecho de shader ------------------------------------------------------------------------------------------
// trailAt devolve x = marca 0..1 já atenuada (some perto do alcance; só onde a altura gravada confere) e y, z = quanto
// a marca cresce em x e em z (diferença central a ±1 texel), para entortar a normal na borda do sulco.
export const TRAIL_GLSL = /* glsl */ `
uniform highp sampler2D uTrail;   // R marca · G solo (0.5 areia, 1 barro) · B altura do chão / 255
uniform vec4 uTrailInfo;          // x = repetição (m) · y = 1 / lado do mapa · z = alcance (m) · w livre
uniform vec3 uTrailCam;
float trailTap(vec2 uv, float y) {
  vec4 s = texture(uTrail, uv);
  return s.r * (1.0 - smoothstep(1.2, 1.6, abs(y - s.b * 255.0)));
}
vec3 trailAt(vec3 worldPos) {
  vec2 dc = worldPos.xz - uTrailCam.xz;
  float fade = 1.0 - smoothstep(uTrailInfo.z * 0.75, uTrailInfo.z, length(dc));
  if (fade <= 0.0) return vec3(0.0);
  vec2 uv = worldPos.xz / uTrailInfo.x;
  vec2 ex = vec2(uTrailInfo.y, 0.0), ez = vec2(0.0, uTrailInfo.y);
  float y = worldPos.y;
  float c = trailTap(uv, y);
  float gx = trailTap(uv + ex, y) - trailTap(uv - ex, y);
  float gz = trailTap(uv + ez, y) - trailTap(uv - ez, y);
  return vec3(c, 0.5 * gx, 0.5 * gz) * fade;
}
float trailClay(vec3 worldPos) {
  return smoothstep(0.7, 0.95, texture(uTrail, worldPos.xz / uTrailInfo.x).g);
}
`;

// ---- parte do jogo ---------------------------------------------------------------------------------------------
const RANGE = 24;          // até onde a trilha é desenhada (m)
const KEEP = 28;           // até onde ela é guardada; além disso o endereço repetido já poderia confundir
const STEP2 = 0.25 * 0.25; // quem anda deixa uma mancha a cada 25 cm: elas se fundem num trilho contínuo
// peso de quem pisa: raio da mancha (m) e força (0..1)
const WALKERS = { manada: [0.5, 0.95], rebanho: [0.34, 0.55], ratos: [0.09, 0.12], sapos: [0.1, 0.15] };
const PLAYER = [0.32, 0.5];

const SIDE_X = [1, -1, 0, 0], SIDE_Z = [0, 0, 1, -1];

// Opcionais: `openSky(x, y, z)` diz se a chuva chega àquele ponto (sem ela, toda terra molha quando chove);
// `wetOf(x, y, z, id)` devolve 0..1 se aquela célula está marcada como molhada (estado do material guardado pelo servidor).
export function initTrails({ game, world, player, camera, avatars, THREE, openSky = null, wetOf = null }) {
  const field = createTrailField();
  const { size, span } = field;
  const texture = new THREE.DataTexture(field.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = 'trilhas';
  texture.needsUpdate = true;
  const uniforms = {
    uTrail: { value: texture },
    uTrailInfo: { value: new THREE.Vector4(span, 1 / size, RANGE, 0) },
    uTrailCam: { value: new THREE.Vector3() },
  };
  const cam = uniforms.uTrailCam.value;
  const env = { wind: 0, wetness: 0, seaY: SEA };
  const stats = { stamps: 0, uploads: 0 };
  const last = new Map();                  // corpo -> { x, z, seen }: onde deixou a última mancha
  const ME = 'eu';
  let tick = 0, tDecay = 0, tClear = 0, tUpload = 0, dim = game.dim;
  const near2 = (KEEP - 1) * (KEEP - 1);

  // bloco em que os pés pousam, ou 0 se não estão no topo de um bloco macio
  function groundAt(x, y, z, sure) {
    const by = Math.floor(y - 0.05);
    if (!sure) { const lift = y - (by + 1); if (lift < -0.06 || lift > 0.15) return 0; }
    const dx = x - cam.x, dz = z - cam.z;
    if (dx * dx + dz * dz > near2) return 0;            // fora do que o mapa guarda: marcar aqui cairia noutro lugar
    const bx = Math.floor(x), bz = Math.floor(z), id = world.getBlock(bx, by, bz);
    return softClass(id, id === B.DIRT ? dampAt(bx, by, bz) : field.wetness);
  }
  // Quão molhada está a terra daquele bloco: encharcada se encosta em água (margem de rio, de lago, do mar); senão,
  // molhada pela chuva só onde a chuva chega (debaixo de teto a terra continua seca e dura) ou pelo estado da célula.
  function dampAt(bx, by, bz) {
    for (let i = 0; i < 4; i++) {
      const nx = bx + SIDE_X[i], nz = bz + SIDE_Z[i];
      if (LEVEL[world.getBlock(nx, by, nz)] || LEVEL[world.getBlock(nx, by + 1, nz)]) return 1;
    }
    const rain = !openSky || openSky(bx, by + 1, bz) ? field.wetness : 0;
    const cell = wetOf ? Number(wetOf(bx, by, bz, B.DIRT)) || 0 : 0;
    return Math.max(rain, cell);
  }
  function walk(key, x, y, z, radius, strength, cls) {
    const r = last.get(key);
    if (!r) { last.set(key, { x, z, seen: tick }); return; }
    r.seen = tick;
    const dx = x - r.x, dz = z - r.z, d2 = dx * dx + dz * dz;
    if (d2 < STEP2) return;
    r.x = x; r.z = z;
    if (!cls || d2 > 9) return;                          // no ar, chão duro ou teletransporte: só acompanha
    field.stamp(x, y, z, radius, strength, cls);
    stats.stamps++;
  }

  // callbacks fixos: percorrer Map com forEach não cria iterador nem array a cada quadro
  const onAvatar = (a) => {
    const p = a.pos;
    walk(a, p[0], p[1], p[2], PLAYER[0], PLAYER[1], groundAt(p[0], p[1], p[2], false));
  };
  let tNat = 0;
  const onBody = (s, id) => {
    const g = game.nature.groups.get(id), w = g && WALKERS[g.k];
    if (!w) return;
    const sp = Math.max(0.02, s.tb - s.ta), k = Math.max(0, Math.min(1.3, (tNat - s.ta) / sp));
    for (let o = 1, i = 0; o + 4 < s.b.length; o += 5, i++) {
      const x = (s.a[o] + (s.b[o] - s.a[o]) * k) / 100;
      const y = (s.a[o + 1] + (s.b[o + 1] - s.a[o + 1]) * k) / 100;
      const z = (s.a[o + 2] + (s.b[o + 2] - s.a[o + 2]) * k) / 100;
      const cls = s.b[o + 4] & 1 ? groundAt(x, y, z, true) : 0;
      walk(id * 64 + i, x, y, z, w[0], w[1], cls);
    }
  };
  const sweep = (r, key) => { if (tick - r.seen > 2) last.delete(key); };

  function update(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    tick++;
    if (game.dim !== dim) { dim = game.dim; field.reset(); last.clear(); }   // outro plano, outro chão
    // a terra fica barro um tempo depois da chuva: molha em ~20 s, seca em ~3 min
    const rain = game.weather ? game.weather.rain || 0 : 0;
    const tau = rain > field.wetness ? 7 : 60;
    field.wetness += (rain - field.wetness) * (1 - Math.exp(-dt / tau));
    camera.getWorldPosition(cam);

    const p = player.pos;
    const ok = player.onGround && !player.flying && !player.inWater;
    walk(ME, p[0], p[1], p[2], PLAYER[0], PLAYER[1], ok ? groundAt(p[0], p[1], p[2], true) : 0);
    if (avatars && avatars.list) avatars.list.forEach(onAvatar);
    const nat = game.nature;
    if (nat && game.dim === 0 && nat.bodies.size) { tNat = nat.time() - 0.2; nat.bodies.forEach(onBody); }

    tDecay += dt; tClear += dt; tUpload += dt;
    if (tDecay >= 0.5) {
      const w = game.weather && game.weather.wind;
      env.wind = w ? Math.hypot(w[0], w[1]) : 0;
      env.wetness = field.wetness;
      field.decay(tDecay, env);
      tDecay = 0;
    }
    if (tClear >= 1) { field.clearFar(cam.x, cam.z, KEEP); last.forEach(sweep); tClear = 0; }
    if (field.dirty && tUpload >= 0.2) { texture.needsUpdate = true; field.dirty = false; tUpload = 0; stats.uploads++; }
  }

  // mundo novo (mesmo plano) também zera: as marcas eram de outro chão
  const onOther = (m) => { if (m && m.t === 'welcome') { field.reset(); last.clear(); } };
  game.hooks.frame.push(update);
  if (game.hooks.other) game.hooks.other.push(onOther);

  function dispose() {
    let i = game.hooks.frame.indexOf(update);
    if (i >= 0) game.hooks.frame.splice(i, 1);
    if (game.hooks.other) { i = game.hooks.other.indexOf(onOther); if (i >= 0) game.hooks.other.splice(i, 1); }
    texture.dispose();
  }

  return { field, texture, uniforms, update, dispose, stats };
}
