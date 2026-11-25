// LAVRA — iluminação e malha de um chunk. Roda no worker (e no Node, nos testes).
//
// Entrada: os voxels do chunk e dos 8 vizinhos. A luz alcança 15 blocos, então a
// região 3x3 basta para a luz do chunk central sair exata sem guardar estado.
// Saída: opaca compacta; recorte, água e rampas com posição fracionária.
//
// Vértice = aPos (x, y, z, camada) + aDat (normal|ao|flags, céu|bloco, temp, umid).
// Na água, a "camada" do topo carrega a profundidade naquele canto (0 = margem, 7 = fundo): espuma e cor saem daí.
// E o terceiro byte de aDat, que no terreno é a temperatura, na água é a ALTURA da superfície naquele canto (224 =
// fonte, 0,88 do bloco; menos na água corrente; 255 = coluna cheia): o shader desce o vértice até ela. Cantos vizinhos
// dividem a mesma altura, então a superfície sai contínua e inclinada, sem degrau nem face entre duas células de água.
//
// Profundidade em dobro (19/11/2026): o pedaço guarda as camadas de Y_MIN (−64) a Y_TOP − 1 (constants.js) e tudo aqui
// trabalha em y do MUNDO: a região tem uma camada de rocha-mãe de enchimento em Y_MIN − 1, e o que sai (vértices,
// plantas, peças, relva, luz) sai em y do mundo, como sempre. Só o que é preciso olhar é olhado: `minYs` dá o menor y
// aberto (ar, água, edição) de cada um dos 9 pedaços; abaixo do menor deles tudo é opaco e fechado, então a região é
// copiada e iluminada só de `bot − 1` para cima (bot = esse menor y − 1, nunca abaixo do fundo do plano, gen.fundo).
// O subsolo maciço não custa nada. A malha opaca de bytes (parte 0) continua só com y ≥ 0 (8 bytes por vértice,
// relida por render/foliage.js); a face opaca que desce abaixo de 0 vai na parte 5, com a posição em 16 bits COM sinal
// (mesmo material da parte 0). Abaixo de 0: sem relva viva (a lista guarda y em 16 bits sem sinal) e sem tronco redondo
// (foliage.js só refaz a parte 0) — limites conhecidos, contrato para quem desenha.

import { CW, CAMADAS, SEA, Y_MIN, Y_TOP } from '../../shared/constants.js';
import {
  B, KIND, OPAQUE, SOLID, EMIT, SKY_DROP, AO_OCC, TEX, LEVEL, IS_GLASS, IS_STAIR,
  K_AIR, K_CUBE, K_CUTOUT, K_CROSS, K_LIQUID, K_MODEL,
} from '../../shared/blocks.js';

import { CUBE, TERRAIN, surfaceShape, shapeHeight, SHAPES, miniShape, isMiniShape, isMcShape } from '../../shared/surfaces.js';
import { isMiniState, miniMask, MINI_OK, DEFAULT_STAIR_STATE, isTroncoQuadrado, TRONCO_OK, isVisaoState, visaoBloco, visaoFace } from '../../shared/minis.js';
import { MC_BASE, MC_LUZ } from '../../shared/mc-estados.js';
import { mcMalha } from './mc-malha.js';
import { E_PLANTA_3D, PASSO_PLANTA } from '../../shared/plantas.js';   // plantas com corpo 3D: lista em vez de planos em X
import { PASSO_RELVA, RELVA_TRONCO } from '../../shared/relva.js';   // relva viva: lista das células de gramado à mostra
import { shoreWater, shoreTriangles, waterCornerByte } from '../../shared/water-shore.js';
import { isTreeWood } from '../../shared/trees.js';

const RW = CW * 3;          // largura da região
const RA = RW * RW;         // área de uma camada
const YB = Y_MIN - 1;       // y do mundo da camada 0 da região (rocha-mãe de enchimento, abaixo do fundo)
const RL = CAMADAS + 3;     // camadas: y = Y_MIN − 1, Y_MIN … Y_TOP − 1, e duas de ar acima
const RSIZE = RA * RL;
const QS = 1 << 19, QM = QS - 1;

// passo no índice da região por direção: +X -X +Y -Y +Z -Z
const STEP = [1, -1, RA, -RA, RW, -RW];
// eixos U e V do plano de cada face
const SU = [RW, RW, 1, 1, 1, 1];
const SV = [RA, RA, RW, RW, RA, RA];
const FLIP = [1, 0, 1, 0, 0, 1];

function makeBucket(float = false) {
  return { pos: float === 'i16' ? new Int16Array(8192) : float ? new Float32Array(8192) : new Uint8Array(8192), dat: new Uint8Array(8192), n: 0 };
}

export function createMesher(gen) {
  // Mundo com mapa de arquipélago (shared/arquipelago.js): a superfície do mar é desenhada inteira por
  // render/oceano.js (contínua até o horizonte, com ondas). Aqui some só o TOPO da água no nível do mar.
  const OCEANO = !!(gen && gen.arq);
  const FUNDO = gen && Number.isInteger(gen.fundo) ? gen.fundo : Y_MIN;   // fundo do plano: Y_MIN em cima, 0 nos outros
  const rv = new Uint8Array(RSIZE);
  const shapes = new Uint16Array(RSIZE).fill(CUBE), protectedVox = new Uint8Array(RSIZE);
  const roundWood = new Uint8Array(RSIZE);
  const squareWood = new Uint8Array(RSIZE);
  const miniVox = new Uint8Array(RSIZE);
  const visVox = new Uint16Array(RSIZE); let visLista = [];   // visão unilateral: estado por célula (limpo a cada malha)
  const regionIndex=(x,y,z)=>(CW+x)+(CW+z)*RW+(y-YB)*RA;
  const get=(x,y,z)=> y<Y_MIN?B.BEDROCK:y>=Y_TOP?B.AIR:rv[regionIndex(x,y,z)];
  get.shape=(x,y,z)=>y<Y_MIN||y>=Y_TOP?CUBE:shapes[regionIndex(x,y,z)];
  get.mini=(x,y,z)=>{if(y<Y_MIN||y>=Y_TOP)return 0;const i=regionIndex(x,y,z);return miniVox[i]||mcVox[i];};   // mcVox: blocos do Minecraft
  const edited=(x,y,z)=>!!protectedVox[regionIndex(x,y,z)];
  const opaqueCell=(i)=>OPAQUE[rv[i]]&&(!miniVox[i]||miniMask(miniVox[i])===15);
  const sky = new Uint8Array(RSIZE);
  const blk = new Uint8Array(RSIZE);
  rv.fill(B.BEDROCK);              // abaixo do que se copia a cada malha: sólido e escuro (baixoSujo cuida do resto)
  sky.fill(15, RA * (CAMADAS + 1)); // acima do mundo: céu aberto
  let baixoSujo = RL;              // menor camada da região que alguma malha já escreveu (abaixo dela: enchimento)
  let altoSujo = 0;                // maior camada da região que alguma malha já sujou em shapes/protectedVox/miniVox/wood
  let minExtraY = Y_TOP, maxExtraY = Y_MIN - 1;
  let minLeafY = Y_TOP, maxLeafY = Y_MIN - 1;
  let minGrassY = Y_TOP, maxGrassY = Y_MIN - 1;
  let minShapeY = Y_TOP, maxShapeY = Y_MIN - 1;
  const q = new Int32Array(QS);
  const skyTop = new Int16Array(RA);
  const CLEAR = new Uint8Array(256);
  for (let i = 0; i < 128; i++) {
    CLEAR[i] = (KIND[i] === K_AIR || KIND[i] === K_CROSS || KIND[i] === K_MODEL || (IS_GLASS[i] && i !== B.GLASS_MIRROR) || i === B.MC_RECORTE || i === B.VISAO) ? 1 : 0;
  }
  // blocos do Minecraft na região: estado e luz própria por célula (limpos pela lista a cada malha)
  const mcVox = new Uint16Array(RSIZE), mcLuz = new Uint8Array(RSIZE);
  let mcLista = [];
  const maskA = new Int32Array(CW * CAMADAS);
  const maskB = new Int32Array(CW * CAMADAS);
  const maskC = new Int32Array(CW * CAMADAS);
  const maskD = new Int32Array(CW * CAMADAS);
  const WDEEP = 31;                // profundidade máxima medida (blocos, 5 bits por canto)
  const tGrid = new Float32Array(17 * 17);
  const mGrid = new Float32Array(17 * 17);
  const buckets = [makeBucket(), makeBucket(true), makeBucket(true), makeBucket(true)];
  const fundoBk = makeBucket('i16');   // parte 5: face opaca com vértice abaixo de y 0 (16 bits com sinal)
  let slopeNormals=[];
  let models = new Int16Array(256), modelN = 0;   // [x, y do mundo, z, bloco, luz]
  let plants = new Float32Array(256), plantN = 0;   // shared/plantas.js: [x, yChao, z, id, luz, andares]
  let lawn = new Uint16Array(256 * PASSO_RELVA), lawnN = 0;   // shared/relva.js: células de gramado à mostra
  const canopy = new Uint8Array(CW * CW);                       // shared/relva.js: quantas células de folhagem há em cada coluna
  const cAO = new Uint8Array(4), cSK = new Uint8Array(4), cBL = new Uint8Array(4);
  let hasBlk = false;
  let minY = 1e9, maxYv = -1e9;

  function ensure(bk, add) {
    const need = (bk.n + add) * 4;
    if (need <= bk.pos.length) return;
    let cap = bk.pos.length;
    while (cap < need) cap *= 2;
    const p = new bk.pos.constructor(cap); p.set(bk.pos.subarray(0, bk.n * 4)); bk.pos = p;
    const d = new Uint8Array(cap); d.set(bk.dat.subarray(0, bk.n * 4)); bk.dat = d;
  }

  function vert(bk, x, y, z, layer, d0, light, hb = -1) {
    const o = bk.n * 4;
    const pos = bk.pos, dat = bk.dat;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = layer;
    const gi = Math.max(0,Math.min(16,Math.round(x))) + Math.max(0,Math.min(16,Math.round(z))) * 17;
    let t = tGrid[gi] - gen.lapse(y);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    dat[o] = d0; dat[o + 1] = light; dat[o + 2] = hb >= 0 ? hb : (t * 255) | 0; dat[o + 3] = (mGrid[gi] * 255) | 0;
    bk.n++;
    if (y < minY) minY = y;
    if (y > maxYv) maxYv = y;
  }

  // ---- luz ------------------------------------------------------------------
  function flood(L) {
    // propaga a luz já semeada na fila q[0..tail)
    // topLayer e botLayer: camadas da região (a luz não sobe acima de top nem desce abaixo do que foi copiado)
    return function run(tail, topLayer, botLayer) {
      let head = 0;
      while (head !== tail) {
        const i = q[head]; head = (head + 1) & QM;
        const v = L[i];
        if (v <= 1) continue;
        const yl = (i / RA) | 0;
        const r = i - yl * RA;
        const rz = (r / RW) | 0;
        const rx = r - rz * RW;
        for (let d = 0; d < 6; d++) {
          if (d === 0) { if (rx === RW - 1) continue; }
          else if (d === 1) { if (rx === 0) continue; }
          else if (d === 2) { if (yl >= topLayer) continue; }
          else if (d === 3) { if (yl <= botLayer) continue; }
          else if (d === 4) { if (rz === RW - 1) continue; }
          else if (rz === 0) continue;
          const n = i + STEP[d];
          const b = rv[n];
          if (opaqueCell(n)) continue;
          const nl = v - 1 - SKY_DROP[b];
          if (nl > L[n]) {
            L[n] = nl;
            q[tail] = n; tail = (tail + 1) & QM;
          }
        }
      }
    };
  }
  const floodSky = flood(sky);
  const floodBlk = flood(blk);

  // c0 = menor y copiado na região (abaixo dele tudo é opaco e fechado: nem sol nem lanterna chegam)
  function light(top, emitters, c0) {
    // 1) sol descendo coluna a coluna
    let tail = 0;
    for (let col = 0; col < RA; col++) {
      let L = 15, y = top, st = top + 1;
      for (; y >= c0; y--) {
        const i = col + (y - YB) * RA;
        const b = rv[i];
        if (opaqueCell(i)) {
          if (shapes[i] !== CUBE) {
            sky[i] = L;
            if (y > c0 && shapes[i - RA] !== CUBE) sky[i - RA] = L;
          }
          break;
        }
        if (L === 15) {
          if (CLEAR[b] && !miniVox[i]) st = y; else L = 14 - SKY_DROP[b];
        } else {
          L -= 1 + SKY_DROP[b];
          if (L < 0) L = 0;
        }
        sky[i] = L;
        if (L < 15 && L > 1) { q[tail] = i; tail = (tail + 1) & QM; }
      }
      for (; y >= c0; y--) sky[col + (y - YB) * RA] = 0;
      skyTop[col] = st;
    }
    // 2) sementes: células ensolaradas ao lado de colunas mais altas
    for (let rz = 0; rz < RW; rz++) {
      for (let rx = 0; rx < RW; rx++) {
        const col = rx + rz * RW;
        const st = skyTop[col];
        let m = st;
        if (rx > 0 && skyTop[col - 1] > m) m = skyTop[col - 1];
        if (rx < RW - 1 && skyTop[col + 1] > m) m = skyTop[col + 1];
        if (rz > 0 && skyTop[col - RW] > m) m = skyTop[col - RW];
        if (rz < RW - 1 && skyTop[col + RW] > m) m = skyTop[col + RW];
        if (m > top + 1) m = top + 1;
        for (let y = st; y < m; y++) { q[tail] = col + (y - YB) * RA; tail = (tail + 1) & QM; }
      }
    }
    floodSky(tail, top - YB, c0 - YB);

    // 3) luz de bloco (lanternas, cristais)
    hasBlk = emitters.length > 0;
    if (hasBlk) {
      blk.fill(0, RA * (c0 - YB), RA * (top - YB + 1));
      tail = 0;
      for (let k = 0; k < emitters.length; k++) {
        const i = emitters[k];
        blk[i] = EMIT[rv[i]] || mcLuz[i];
        q[tail] = i; tail = (tail + 1) & QM;
      }
      floodBlk(tail, top - YB, c0 - YB);
    }
  }

  // AO e luz suave dos 4 cantos da face da célula c virada para d.
  function corners(c, d) {
    const o = c + STEP[d];
    const U = SU[d], V = SV[d];
    const so = sky[o], bo = hasBlk ? blk[o] : 0;
    for (let k = 0; k < 4; k++) {
      const du = (k === 1 || k === 2) ? U : -U;
      const dv = (k >= 2) ? V : -V;
      const iu = o + du, iv = o + dv, id = o + du + dv;
      const bu = rv[iu], bv = rv[iv], bd = rv[id];
      const mo = (shapes[iu] === CUBE || (isMiniShape(shapes[iu]) && miniMask(miniVox[iu]) === 15)) ? 1 : 0;
      const mv = (shapes[iv] === CUBE || (isMiniShape(shapes[iv]) && miniMask(miniVox[iv]) === 15)) ? 1 : 0;
      const md = (shapes[id] === CUBE || (isMiniShape(shapes[id]) && miniMask(miniVox[id]) === 15)) ? 1 : 0;
      const ou = AO_OCC[bu] & mo, ov = AO_OCC[bv] & mv;
      cAO[k] = (ou && ov) ? 0 : 3 - ou - ov - (AO_OCC[bd] & md);
      let s = so, l = bo, n = 1;
      const pu = OPAQUE[bu] & mo, pv = OPAQUE[bv] & mv;
      if (!pu) { s += sky[iu]; if (hasBlk) l += blk[iu]; n++; }
      if (!pv) { s += sky[iv]; if (hasBlk) l += blk[iv]; n++; }
      if (!(pu && pv) && !(OPAQUE[bd] & md)) { s += sky[id]; if (hasBlk) l += blk[id]; n++; }
      cSK[k] = ((s + (n >> 1)) / n) | 0;
      cBL[k] = ((l + (n >> 1)) / n) | 0;
    }
  }

  // Quantos blocos de água há nesta coluna, do nível de c para baixo (0 se c não é água).
  function waterColumn(c) {
    const b = rv[c], L = LEVEL[b];
    // margem (espuma) é onde a água encosta em terra; o vazio ao lado (a beira de uma queda) não conta
    if (!L) return b === B.AIR || KIND[b] === K_CROSS ? WDEEP : 0;
    if (L < 8) return 2;                              // água corrente: rasa
    if (LEVEL[rv[c + RA]]) return WDEEP;              // não é a superfície: conta como fundo
    let n = 1;
    while (n < WDEEP && rv[c - n * RA] === B.WATER) n++;
    return n;
  }
  // Profundidade nos 4 cantos do topo da célula de água c (5 bits por canto, 0..31): o menor valor das 4 colunas.
  function waterCorners(c) {
    let packed = 0;
    for (let k = 0; k < 4; k++) {
      const du = (k === 1 || k === 2) ? 1 : -1, dv = (k >= 2) ? RW : -RW;
      let m = waterColumn(c);
      let t = waterColumn(c + du); if (t < m) m = t;
      t = waterColumn(c + dv); if (t < m) m = t;
      t = waterColumn(c + du + dv); if (t < m) m = t;
      packed |= m << (k * 5);
    }
    return packed;
  }

  // Altura da superfície da água no canto (x, y, z) do chunk, em 0..255: a maior entre as 4 células que tocam o canto
  // na camada logo abaixo de y. Célula com água em cima conta como cheia.
  function cornerH(x, y, z) {
    return waterCornerByte(get,x,y-1,z) || 224;
  }
  // Profundidade fracionária na borda inclinada: evita uma costura branca de
  // espuma na antiga borda do cubo, agora submersa.
  function cornerDepth(x,y,z) {
    let depth=WDEEP;const h=cornerH(x,y,z)/255;
    for(let dz=-1;dz<=0;dz++)for(let dx=-1;dx<=0;dx++){
      const c=regionIndex(x+dx,y-1,z+dz),shape=shapes[c];
      const corner=dz===0?(dx===0?0:1):(dx===0?3:2);
      const d=shape===CUBE?waterColumn(c):Math.max(0,h-SHAPES[shape].heights[corner]);
      depth=Math.min(depth,d);
    }
    return depth;
  }
  // A superfície desta célula de água é desigual? (água corrente, ou fonte vizinha de água em outra altura.) Face
  // desigual não se funde com as outras: cada canto precisa do seu vértice.
  function uneven(c) {
    if (rv[c] !== B.WATER) return true;
    for (let dz = -RW; dz <= RW; dz += RW) for (let dx = -1; dx <= 1; dx++) {
      const n = c + dx + dz, L = LEVEL[rv[n]];
      if (shapes[n] !== CUBE) return true;
      if (L && (L !== 8 || LEVEL[rv[n + RA]])) return true;
    }
    return false;
  }

  function quad(bk, d, s, u, v, w, h, layer, a0, a1, a2, a3, s0, s1, s2, s3, l0, l1, l2, l3, surf, wd = -1) {
    ensure(bk, 4);
    const axis = d >> 1;
    const pos = (d & 1) ? s : s + 1;
    // brilho por canto, para escolher a diagonal mais clara
    const b0 = a0 * 4 + s0 + l0, b1 = a1 * 4 + s1 + l1, b2 = a2 * 4 + s2 + l2, b3 = a3 * 4 + s3 + l3;
    const rot = (b0 + b2 < b1 + b3) ? 1 : 0;
    const flip = FLIP[d];
    for (let n = 0; n < 4; n++) {
      let k = (n + rot) & 3;
      if (flip) k = (4 - k) & 3;
      const cu = (k === 1 || k === 2) ? 1 : 0, cv = k >= 2 ? 1 : 0;
      const ao = k === 0 ? a0 : k === 1 ? a1 : k === 2 ? a2 : a3;
      const sk = k === 0 ? s0 : k === 1 ? s1 : k === 2 ? s2 : s3;
      const bl = k === 0 ? l0 : k === 1 ? l1 : k === 2 ? l2 : l3;
      let x, y, z;
      if (axis === 0) { x = pos; z = u + cu * w; y = v + cv * h; }
      else if (axis === 1) { y = pos; x = u + cu * w; z = v + cv * h; }
      else { z = pos; x = u + cu * w; y = v + cv * h; }
      let special = 0;
      if (surf) special = (d === 2 || (axis !== 1 && cv === 1)) ? 1 : 0;
      const depth=bk===buckets[2]&&d===2?cornerDepth(x,y,z):(wd<0?layer:(wd>>(k*5))&31);
      vert(bk, x, y, z, depth, d | (ao << 3) | (special << 5), sk | (bl << 4), bk === buckets[2] ? (special ? cornerH(x, y, z) : 255) : -1);
    }
  }

  // Faces de bot a topC (y do mundo). Nos planos de y, s é o y; nos de x e z, v é o y (e a máscara usa v − bot).
  function faces(topC, bot) {
    for (let d = 0; d < 6; d++) {
      const axis = d >> 1;
      const step = STEP[d];
      const s0 = axis === 1 ? bot : 0, nS = axis === 1 ? topC + 1 : CW;
      const v0 = axis === 1 ? 0 : bot, H = axis === 1 ? CW : topC - bot + 1;
      for (let s = s0; s < nS; s++) {
        if (d === 3 && s === FUNDO) continue; // o fundo do mundo nunca aparece
        let count = 0;
        for (let vv = 0; vv < H; vv++) {
          const v = vv + v0;
          for (let u = 0; u < CW; u++) {
            const mi = u + vv * CW;
            let c;
            if (axis === 0) c = (CW + s) + (CW + u) * RW + (v - YB) * RA;
            else if (axis === 1) c = (CW + u) + (CW + v) * RW + (s - YB) * RA;
            else c = (CW + u) + (CW + s) * RW + (v - YB) * RA;
            const b = rv[c];
            maskA[mi] = 0;
            if (b === 0) continue;
            const kind = KIND[b];
            if (kind === K_CROSS || kind === K_MODEL || shapes[c] !== CUBE || (b >= B.MC_SOLIDO && b <= B.MC_FORMA)) continue;   // MC: world/mc-malha.js
            const nb = rv[c + step];
            const nbShape = shapes[c + step];
            const aboveFullSlope = d === 2 && nbShape > 16 && !isMiniShape(nbShape) && !isMcShape(nbShape) && SHAPES[nbShape].heights.every(h => h >= 0) && SHAPES[nbShape].heights.some(h => h > 0);
            const fullNb = OPAQUE[nb] && !roundWood[c + step] && (isMiniShape(nbShape) ? miniMask(miniVox[c + step]) === 15 : (nbShape === CUBE || aboveFullSlope));
            const solidNb = OPAQUE[nb] && !roundWood[c + step] && (!isMiniShape(nbShape) || miniMask(miniVox[c + step]) === 15);
            let bucket = 0, layer = 0, surf = 0;
            if (b === B.VISAO) {   // visão unilateral: só a face de fora, com a textura do bloco escolhido (de dentro: nada)
              const st = visVox[c];
              if (fullNb || d !== (st ? visaoFace(st) : 4)) continue;
              layer = TEX[(st ? visaoBloco(st) : B.GLASS) * 6 + d];
            } else if (kind === K_CUBE) {
              if (fullNb) continue;
              layer = TEX[b * 6 + d];
            } else if (kind === K_CUTOUT) {
              if (solidNb || (nb === b && (!miniVox[c + step] || miniMask(miniVox[c + step]) === 15))) continue;
              bucket = 1; layer = TEX[b * 6 + d];
            } else {
              // nenhuma face entre duas células de água, seja qual for a altura de cada uma
              if (solidNb || LEVEL[nb]) continue;
              if (OCEANO && d === 2 && s === SEA) continue;   // topo do mar: é do render/oceano.js
              bucket = 2;
              if (d !== 3 && !LEVEL[rv[c + RA]]) surf = 1;
            }
            // topo da água: profundidade por canto; só as faces de fundo uniforme e superfície plana se fundem
            let wd = -1;
            if (bucket === 2) {
              if (d === 2) {
                wd = waterCorners(c); layer = wd & 31; maskD[mi] = wd;
                if (wd !== layer * 0x8421) wd = -2;   // cantos diferentes: face solta (0x8421 = mesmo valor 5-bit nos 4 cantos)
              }
              if (surf && uneven(c)) wd = -2;
            }
            corners(c, d);
            const a0 = cAO[0], s0 = cSK[0], l0 = cBL[0];
            const uni = (wd !== -2 && a0 === cAO[1] && a0 === cAO[2] && a0 === cAO[3] &&
              s0 === cSK[1] && s0 === cSK[2] && s0 === cSK[3] &&
              l0 === cBL[1] && l0 === cBL[2] && l0 === cBL[3]) ? 1 : 0;
            maskA[mi] = (1 << 30) | (roundWood[c] << 26) | (bucket << 24) | (surf << 23) | (uni << 22) | (l0 << 14) | (s0 << 10) | (a0 << 8) | layer;
            if (!uni) {
              maskB[mi] = a0 | (cAO[1] << 2) | (cAO[2] << 4) | (cAO[3] << 6) |
                (s0 << 8) | (cSK[1] << 12) | (cSK[2] << 16) | (cSK[3] << 20);
              maskC[mi] = l0 | (cBL[1] << 4) | (cBL[2] << 8) | (cBL[3] << 12);
            }
            count++;
          }
        }
        if (count === 0) continue;
        // fusão gulosa: só as faces uniformes (4 cantos iguais) se juntam
        for (let vv = 0; vv < H; vv++) {
          const v = vv + v0;
          for (let u = 0; u < CW; u++) {
            const mi = u + vv * CW;
            const a = maskA[mi];
            if (a === 0) continue;
            // opaco de bytes só de y 0 para cima: face que começa abaixo de 0 vai para a parte 5 (16 bits com sinal)
            const bi = (a >> 24) & 3;
            const bk = bi === 0 && (axis === 1 ? (d === 2 ? s + 1 : s) : v) < 0 ? fundoBk : buckets[bi];
            const layer = a & 255;
            const surf = (a >> 23) & 1;
            if (!((a >> 22) & 1)) {
              const mb = maskB[mi], mc = maskC[mi];
              quad(bk, d, s, u, v, 1, 1, layer,
                mb & 3, (mb >> 2) & 3, (mb >> 4) & 3, (mb >> 6) & 3,
                (mb >> 8) & 15, (mb >> 12) & 15, (mb >> 16) & 15, (mb >> 20) & 15,
                mc & 15, (mc >> 4) & 15, (mc >> 8) & 15, (mc >> 12) & 15, surf,
                (d === 2 && ((a >> 24) & 3) === 2) ? maskD[mi] : -1);
              maskA[mi] = 0;
              continue;
            }
            let w = 1;
            while (u + w < CW && maskA[mi + w] === a) w++;
            let h = 1;
            outer: while (vv + h < H) {
              const row = mi + h * CW;
              for (let k = 0; k < w; k++) if (maskA[row + k] !== a) break outer;
              h++;
            }
            for (let j = 0; j < h; j++) {
              const row = mi + j * CW;
              for (let k = 0; k < w; k++) maskA[row + k] = 0;
            }
            const ao = (a >> 8) & 3, sk = (a >> 10) & 15, bl = (a >> 14) & 15;
            quad(bk, d, s, u, v, w, h, layer, ao, ao, ao, ao, sk, sk, sk, sk, bl, bl, bl, bl, surf);
            u += w - 1;
          }
        }
      }
    }
  }

  // plantas em X e lista de peças com modelo próprio
  function extras(topC, bot) {
    const y0 = Math.max(bot, minExtraY), y1 = Math.min(topC, maxExtraY);
    if (y0 > y1) return;
    const bk = buckets[1];
    for (let y = y0; y <= y1; y++) {
      for (let z = 0; z < CW; z++) {
        const base = CW + (CW + z) * RW + (y - YB) * RA;
        for (let x = 0; x < CW; x++) {
          const c = base + x;
          const b = rv[c];
          if (b === 0) continue;
          const kind = KIND[b];
          if (kind === K_CROSS) {
            const b1 = rv[c - RA], b2 = y > FUNDO + 1 ? rv[c - 2 * RA] : 0;
            const s1 = shapes[c - RA], s2 = y > FUNDO + 1 ? shapes[c - 2 * RA] : CUBE;
            const stacked = b1 > 0 && KIND[b1] === K_CROSS;
            const hasGround = stacked || (b1 > 0 && SOLID[b1] === 1 && s1 !== 16) || (b2 > 0 && SOLID[b2] === 1 && s2 !== 16);
            if (!hasGround) continue;
            const groundAt = (u, v) => {
              if (stacked) return y;
              if (b1 > 0 && SOLID[b1] === 1 && s1 !== 16) {
                const h1 = shapeHeight(s1, u, v);
                if (h1 > 1e-4 || !(b2 > 0 && SOLID[b2] === 1 && s2 !== 16)) return y - 1 + h1;
              }
              return y - 2 + shapeHeight(s2, u, v);
            };
            const yc = groundAt(0.5, 0.5);
            if (E_PLANTA_3D[b]) {   // corpo 3D (render/plantas3d.js): só a posição exata; a de cima de uma pilha fica com a de baixo
              if (stacked && b1 === b) continue;
              let and = 1; while (and < 4 && y + and < Y_TOP && rv[c + and * RA] === b) and++;
              if ((plantN + 1) * PASSO_PLANTA > plants.length) { const p2 = new Float32Array(plants.length * 2); p2.set(plants); plants = p2; }
              const o = plantN * PASSO_PLANTA;
              plants[o] = x; plants[o + 1] = yc - (stacked ? 0.02 : 0.04); plants[o + 2] = z; plants[o + 3] = b;
              plants[o + 4] = sky[c] | ((hasBlk ? blk[c] : 0) << 4); plants[o + 5] = and;
              plantN++;
              continue;
            }
            const y00 = groundAt(0.1, 0.1), y11 = groundAt(0.9, 0.9);
            const y10 = groundAt(0.9, 0.1), y01 = groundAt(0.1, 0.9);
            const sink = stacked ? 0.02 : 0.05;
            const shift1 = Math.max(0, (y00 + y11) * 0.5 - yc) + sink;
            const shift2 = Math.max(0, (y10 + y01) * 0.5 - yc) + sink;
            const b00 = y00 - shift1, b11 = y11 - shift1;
            const b10 = y10 - shift2, b01 = y01 - shift2;
            ensure(bk, 8);
            const layer = TEX[b * 6];
            const lt = sky[c] | ((hasBlk ? blk[c] : 0) << 4);
            const f = (3 << 3) | (1 << 5);
            const n = (x * 17 + z * 53 + y * 3) | 0;
            const tall = 0.62 + ((n % 7) / 6) * 0.46;
            const lx = ((n % 5) - 2) * 0.09, lz = (((n >> 3) % 5) - 2) * 0.09;
            const tx = (px) => Math.min(CW, px), tz = (pz) => Math.min(CW, pz);
            vert(bk, x, b00, z, layer, 6 | f, lt);
            vert(bk, x + 1, b11, z + 1, layer, 6 | f | 64, lt);
            vert(bk, tx(x + 1 + lx), b11 + tall, tz(z + 1 + lz), layer, 6 | f | 64 | 128, lt);
            vert(bk, tx(x + lx), b00 + tall, tz(z + lz), layer, 6 | f | 128, lt);
            vert(bk, x + 1, b10, z, layer, 7 | f, lt);
            vert(bk, x, b01, z + 1, layer, 7 | f | 64, lt);
            vert(bk, tx(x + lx), b01 + tall, tz(z + 1 + lz), layer, 7 | f | 64 | 128, lt);
            vert(bk, tx(x + 1 + lx), b10 + tall, tz(z + lz), layer, 7 | f | 128, lt);
          } else if (kind === K_MODEL && b !== B.MC_FORMA) {
            if ((modelN + 1) * 5 > models.length) {
              const m2 = new Int16Array(models.length * 2); m2.set(models); models = m2;
            }
            const o = modelN * 5;
            models[o] = x; models[o + 1] = y; models[o + 2] = z; models[o + 3] = b;
            models[o + 4] = sky[c] | ((hasBlk ? blk[c] : 0) << 4);
            modelN++;
          }
        }
      }
    }
  }

  // Relva viva (shared/relva.js): as células do pedaço central cujo topo é gramado à mostra. Segue a mesma conta de
  // faces() e das rampas para dizer se o topo aparece e de que material ele é; não cria nem tira nenhuma face.
  function relva(topC, bot) {
    lawnN = 0;
    // copa: folhagem empilhada em cada coluna do pedaço (0 = céu aberto). Serve ao chão de folha seca e à relva rala.
    const yFim = Math.max(bot, FUNDO);
    const lTop = Math.min(topC, maxLeafY), lBot = Math.max(yFim + 1, minLeafY);
    if (lTop < lBot) {
      canopy.fill(0);
    } else {
      for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
        let n = 0;
        for (let y = lTop, c = CW + x + (CW + z) * RW + (lTop - YB) * RA; y >= lBot; y--, c -= RA) { const b = rv[c]; if (b === B.LEAVES || b === B.PINE_LEAVES) n++; }
        canopy[x + z * CW] = n > 255 ? 255 : n;
      }
    }
    // relva só de y 0 para cima: a lista guarda o y em 16 bits sem sinal (shared/relva.js)
    const g0 = Math.max(0, bot, FUNDO + 1, minGrassY - 1), g1 = Math.min(topC, maxGrassY);
    if (g0 > g1) return;
    for (let y = g0; y <= g1; y++) {
      for (let z = 0; z < CW; z++) {
        const base = CW + (CW + z) * RW + (y - YB) * RA;
        for (let x = 0; x < CW; x++) {
          const c = base + x, b = rv[c];
          if (b === 0) continue;
          const shape = shapes[c];
          if (shape === 16 || isMiniShape(shape) || isMcShape(shape)) continue;
          const up = c + RA, nb = rv[up], ns = shapes[up];
          let marca = 0;
          if (shape === CUBE) {
            if (b !== B.GRASS) continue;
            const cheiaEmCima = ns > 16 && !isMiniShape(ns) && !isMcShape(ns) && SHAPES[ns].heights.every((h) => h >= 0) && SHAPES[ns].heights.some((h) => h > 0);
            const coberto = OPAQUE[nb] && !roundWood[up] && (isMiniShape(ns) ? miniMask(miniVox[up]) === 15 : (ns === CUBE || cheiaEmCima));
            if (coberto) continue;
            if (roundWood[up]) marca = RELVA_TRONCO;
            else if (nb !== 0 && KIND[nb] !== K_CROSS && ns !== 16) continue;   // água, vidro, folha, peça ou rampa em cima: sem relva
          } else {
            const material = ns !== CUBE && !isMcShape(ns) ? nb : b;
            if (material !== B.GRASS) continue;
            if (roundWood[up]) marca = RELVA_TRONCO;
            else if (nb !== 0 && KIND[nb] !== K_CROSS && ns === CUBE) continue;
          }
          if ((lawnN + 1) * PASSO_RELVA > lawn.length) { const l2 = new Uint16Array(lawn.length * 2); l2.set(lawn); lawn = l2; }
          const o = lawnN * PASSO_RELVA, gi = x + z * 17;
          let t = tGrid[gi] - gen.lapse(y + 1);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const sk = sky[up] > sky[c] ? sky[up] : sky[c], bl = hasBlk ? (blk[up] > blk[c] ? blk[up] : blk[c]) : 0;
          const folhas = canopy[x + z * CW];
          lawn[o] = x | (z << 4) | (marca << 8) | ((folhas > 7 ? 7 : folhas) << 9); lawn[o + 1] = y; lawn[o + 2] = shape;
          lawn[o + 3] = sk | (bl << 4); lawn[o + 4] = ((t * 255) | 0) | (((mGrid[gi] * 255) | 0) << 8);
          lawnN++;
        }
      }
    }
  }

  // chunks: 9 Uint8Array (camadas de Y_MIN a Y_TOP − 1), índice (dx+1) + (dz+1)*3. maxYs: maior y ocupado de cada
  // um (y do mundo). minYs (opcional): menor y aberto de cada um — ar, água ou qualquer célula editada (world.js); sem
  // ele a malha olha desde o fundo do plano. protectedCells e miniCells: índices de ARMAZENAMENTO (edição + YOFF).
  function mesh(cx, cz, chunks, maxYs, protectedCells = null, miniCells = null, minYs = null) {
    let regionMax = FUNDO;
    for (let i = 0; i < 9; i++) if (maxYs[i] > regionMax) regionMax = maxYs[i];
    const top = Math.min(Y_TOP - 1, regionMax + 2);
    const topC = Math.max(FUNDO, Math.min(Y_TOP - 1, maxYs[4]));
    // bot: a camada logo abaixo da menor célula aberta dos 9 pedaços (pode ter face de cima); c0 = bot − 1 ainda é lida
    // pelas rampas (surfaces.js olha até 2 abaixo). Abaixo de c0 a região fica com rocha-mãe de enchimento.
    let menor = FUNDO;
    if (minYs) { menor = Y_TOP; for (let i = 0; i < 9; i++) { const v = minYs[i]; menor = Number.isFinite(v) ? Math.min(menor, v) : FUNDO; } }
    const bot = Math.max(FUNDO, Math.min(menor - 1, topC));
    const c0 = Math.max(Y_MIN, bot - 1), L0 = c0 - YB, LTop = Math.min(RL, top - YB + 3);
    const emitters = [];

    if (L0 > baixoSujo) {            // a malha anterior desceu mais: o que ela deixou abaixo de c0 volta a ser enchimento
      rv.fill(B.BEDROCK, baixoSujo * RA, L0 * RA);
      for (const a of [protectedVox, miniVox, squareWood, roundWood]) a.fill(0, baixoSujo * RA, L0 * RA);
      shapes.fill(CUBE, baixoSujo * RA, L0 * RA);
    }
    const fillEnd = Math.max(LTop, altoSujo) * RA;
    baixoSujo = L0; altoSujo = LTop;
    shapes.fill(CUBE, L0 * RA, fillEnd); protectedVox.fill(0, L0 * RA, fillEnd); miniVox.fill(0, L0 * RA, fillEnd); squareWood.fill(0, L0 * RA, fillEnd); roundWood.fill(0, L0 * RA, fillEnd);
    minExtraY = Y_TOP; maxExtraY = Y_MIN - 1;
    minLeafY = Y_TOP; maxLeafY = Y_MIN - 1;
    minGrassY = Y_TOP; maxGrassY = Y_MIN - 1;
    minShapeY = Y_TOP; maxShapeY = Y_MIN - 1;

    for (let ci = 0; ci < 9; ci++) {
      const src = chunks[ci];
      const ox = (ci % 3) * CW, oz = ((ci / 3) | 0) * CW;
      const isCenter = ci === 4;
      for (let y = c0; y <= top; y++) {
        const sy = (y - Y_MIN) << 8, dy = (y - YB) * RA + ox;
        for (let z = 0; z < CW; z++) {
          let si = sy + (z << 4), di = dy + (oz + z) * RW;
          for (let x = 0; x < CW; x++, si++, di++) {
            const b = src[si];
            rv[di] = b;
            if (b === 0) continue;
            if (EMIT[b]) emitters.push(di);
            if (IS_STAIR[b]) {
              miniVox[di] = DEFAULT_STAIR_STATE;
              protectedVox[di] = 1;
            }
            if (isCenter) {
              const k = KIND[b];
              if (k === K_CROSS || k === K_MODEL) { if (y < minExtraY) minExtraY = y; if (y > maxExtraY) maxExtraY = y; }
              if (b === B.LEAVES || b === B.PINE_LEAVES) { if (y < minLeafY) minLeafY = y; if (y > maxLeafY) maxLeafY = y; }
              else if (b === B.GRASS) { if (y < minGrassY) minGrassY = y; if (y > maxGrassY) maxGrassY = y; }
            }
          }
        }
      }
    }

    // índices de armazenamento: y do mundo = (índice >> 8) + Y_MIN. Fora do que foi copiado não há o que marcar.
    if(protectedCells){
      for(let ci=0;ci<9;ci++)for(const index of protectedCells[ci]||[]){
        const x=(ci%3)*CW+(index&15),z=Math.floor(ci/3)*CW+((index>>4)&15),y=(index>>8)+Y_MIN;
        if(y>=c0)protectedVox[x+z*RW+(y-YB)*RA]=1;
      }
    }
    if(miniCells){
      for(let ci=0;ci<9;ci++)for(const entry of miniCells[ci]||[]){
        const index=entry&0xffff,state=entry>>>16;   // 16 bits: estado de mini, terra moldada (64) ou bloco MC (≥ 256)
        const yMundo=(index>>8)+Y_MIN;if(yMundo<c0)continue;
        if(isVisaoState(state)){const ri=(ci%3)*CW+(index&15)+(Math.floor(ci/3)*CW+((index>>4)&15))*RW+(yMundo-YB)*RA;if(rv[ri]===B.VISAO){visVox[ri]=state;visLista.push(ri);}continue;}
        if(state>=MC_BASE){                       // bloco do Minecraft: estado guardado para a malha própria e a luz
          const x=(ci%3)*CW+(index&15),z=Math.floor(ci/3)*CW+((index>>4)&15),y=yMundo,ri=x+z*RW+(y-YB)*RA;
          if(rv[ri]<B.MC_SOLIDO||rv[ri]>B.MC_FORMA)continue;
          mcVox[ri]=state;mcLista.push(ri);
          const L=MC_LUZ[state-MC_BASE];if(L){mcLuz[ri]=L;emitters.push(ri);}
          continue;
        }
        if(isTroncoQuadrado(state)){
          const x=(ci%3)*CW+(index&15),z=Math.floor(ci/3)*CW+((index>>4)&15),y=yMundo;
          const ri=x+z*RW+(y-YB)*RA;
          if(TRONCO_OK[rv[ri]])squareWood[ri]=1;
          continue;
        }
        if(!isMiniState(state))continue;
        const x=(ci%3)*CW+(index&15),z=Math.floor(ci/3)*CW+((index>>4)&15),y=yMundo;
        const ri=x+z*RW+(y-YB)*RA;
        if(MINI_OK[rv[ri]]){miniVox[ri]=state;protectedVox[ri]=1;}
      }
    }
    // Toda madeira de tronco/raiz em bloco inteiro é desenhada como cilindro ou
    // raiz arredondada (trees.js para árvores naturais; foliage.js para troncos
    // colocados/editados), não cobrindo a face inteira dos blocos vizinhos.
    // O cacto vira cápsula no mesmo passo, sem entrar em isTreeWood (não cai nem corta como madeira).
    const yForma = Math.max(FUNDO + 1, bot);   // a rocha-mãe do fundo é sempre cubo
    for(let y=yForma;y<=top;y++)for(let z=-1;z<=CW;z++)for(let x=-1;x<=CW;x++){
      const c=regionIndex(x,y,z), b=rv[c];
      if(b===0)continue;
      if(!miniVox[c]&&!mcVox[c]){
        if((isTreeWood(b)&&!squareWood[c])||b===B.CACTUS){roundWood[c]=1;continue;}
        if(!TERRAIN[b]&&!IS_STAIR[b])continue;
        if(protectedVox[c])continue;
        const up=rv[c+RA];
        if(up>0&&SOLID[up]===1&&(!TERRAIN[up]||protectedVox[c+RA]||(y+2<Y_TOP&&SOLID[rv[c+RA+RA]]===1)))continue;
      }
      const shape=surfaceShape(get,edited,x,y,z);
      if(shape!==CUBE){
        shapes[c]=shape;
        if(y<minShapeY)minShapeY=y;
        if(y>maxShapeY)maxShapeY=y;
      }else if((isTreeWood(b)&&!squareWood[c])||b===B.CACTUS){
        roundWood[c]=1;
      }
    }
    light(top, emitters, c0);
    gen.climateGrid(cx * CW, cz * CW, 17, tGrid, mGrid);

    buckets[0].n = buckets[1].n = buckets[2].n = buckets[3].n = fundoBk.n = 0; slopeNormals=[];
    modelN = 0; plantN = 0; minY = 1e9; maxYv = -1e9;
    faces(topC, bot);
    extras(topC, bot);
    relva(topC, bot);
    const slope=buckets[3],cutout=buckets[1],surfaceShapes=[];
    if(minShapeY<=maxShapeY){
      // Suavização das normais nos vértices compartilhados da encosta, inclusive na borda do chunk.
      const slopeAcc=new Map();
      const slopeKey=(vx,vy,vz)=>Math.round(vx*64)+','+Math.round(vy*64)+','+Math.round(vz*64);
      for(let y=minShapeY;y<=maxShapeY;y++)for(let z=-1;z<=CW;z++)for(let x=-1;x<=CW;x++){
        const shape=shapes[regionIndex(x,y,z)];
        if(shape===CUBE||isMiniShape(shape)||isMcShape(shape))continue;
        for(const face of SHAPES[shape].faces){
          if(face.face!==2||face.cap)continue;
          for(let i=0;i<3;i++){
            const k=slopeKey(x+face.v[i][0],y+face.v[i][1],z+face.v[i][2]);
            let a=slopeAcc.get(k);if(!a)slopeAcc.set(k,a=[0,0,0]);
            a[0]+=face.n[0];a[1]+=face.n[1];a[2]+=face.n[2];
          }
        }
      }
      for(const a of slopeAcc.values()){const l=Math.hypot(a[0],a[1],a[2])||1;a[0]/=l;a[1]/=l;a[2]/=l;}
      const yS1 = Math.min(topC, maxShapeY);
      for(let y=minShapeY;y<=yS1;y++)for(let z=0;z<CW;z++)for(let x=0;x<CW;x++){
        const c=regionIndex(x,y,z),shape=shapes[c];if(shape===CUBE||isMcShape(shape))continue;   // MC: world/mc-malha.js
        if(isMiniShape(shape)){
          const b=rv[c],isCut=KIND[b]===K_CUTOUT,bk=isCut?cutout:slope;
          for(const q of SHAPES[shape].quads){
            const d=q.face,nbIdx=c+STEP[d],nb=rv[nbIdx];
            if(q.outer){
              const solidNb=OPAQUE[nb]&&!roundWood[nbIdx]&&(!isMiniShape(shapes[nbIdx])||miniMask(miniVox[nbIdx])===15);
              if(isCut?(solidNb||(nb===b&&(!miniVox[nbIdx]||miniMask(miniVox[nbIdx])===15))):solidNb)continue;
            }
            let lt,ao;
            if(q.outer){
              corners(c,d);
              lt=Math.max(...cSK)|(Math.max(...cBL)<<4);
              ao=Math.round((cAO[0]+cAO[1]+cAO[2]+cAO[3])/4);
            }else{
              lt=sky[c]|((hasBlk?blk[c]:0)<<4);
              ao=3;
            }
            const layer=TEX[b*6+d];
            ensure(bk,4);
            for(const v of q.v){
              vert(bk,x+v[0],y+v[1],z+v[2],layer,d|(ao<<3),lt);
              if(!isCut)slopeNormals.push(...q.n);
            }
          }
          continue;
        }
        surfaceShapes.push(x+(z<<4)+((y-Y_MIN)<<8),shape);   // índice de ARMAZENAMENTO (cabe em 16 bits): world.js desfaz
        const water=shoreWater(get,x,y,z,shape);
        if(water&&!water.covered&&!(OCEANO&&y<=SEA+1)){   // margem no nível do mar: é do render/oceano.js
          corners(c,2);const lt=Math.max(...cSK)|(Math.max(...cBL)<<4),bk=buckets[2];
          for(const tri of shoreTriangles(water)){
            ensure(bk,4);
            for(const v of [tri[0],tri[1],tri[2],tri[2]])vert(bk,x+v[0],y+v[1],z+v[2],Math.min(WDEEP,Math.max(0,v[3])),2|24,lt,255);
          }
        }
        for(const face of SHAPES[shape].faces){
          if(face.cap)continue;
          const d=face.face,nb=rv[c+STEP[d]];
          if(d!==2 && OPAQUE[nb] && !roundWood[c+STEP[d]])continue;
          const topCell = d === 2 && shapes[c + RA] !== CUBE && !isMiniShape(shapes[c + RA]) && !isMcShape(shapes[c + RA]) ? c + RA : c;
          corners(topCell, d);
          // Uma rampa diagonal cruza duas camadas, mas a cobertura continua
          // sendo a da superfície da coluna (grama/neve/areia etc.).
          const material=d===2&&shapes[c+RA]!==CUBE&&!isMcShape(shapes[c+RA])?rv[c+RA]:rv[c];
          const sk=Math.max(...cSK),bl=Math.max(...cBL),lt=sk|(bl<<4),layer=TEX[material*6+d];
          ensure(slope,4);
          for(const v of [face.v[0],face.v[1],face.v[2],face.v[2]]){
            vert(slope,x+v[0],y+v[1],z+v[2],layer,d|24,lt);
            const smooth=d===2?slopeAcc.get(slopeKey(x+v[0],y+v[1],z+v[2])):null;
            slopeNormals.push(...(smooth||face.n));
          }
        }
      }
    }

    // Luz já resolvida no worker, reutilizada por raízes/galhos e corpos móveis.
    // Um byte por célula, de lightBase (= bot, y do mundo) até a altura ocupada do chunk central; abaixo é rocha, escuro.
    const lightField=new Uint8Array((topC-bot+1)*256);
    for(let y=bot;y<=topC;y++)for(let z=0;z<CW;z++)for(let x=0;x<CW;x++){
      const r=regionIndex(x,y,z);lightField[((y-bot)<<8)+(z<<4)+x]=sky[r]|((hasBlk?blk[r]:0)<<4);
    }
    const out = { minY: minY > maxYv ? 0 : minY, maxY: minY > maxYv ? 0 : maxYv, models: models.slice(0, modelN * 5), plants: plants.slice(0, plantN * PASSO_PLANTA), lawn: lawn.slice(0, lawnN * PASSO_RELVA), canopy: canopy.slice(), lightField, lightBase: bot, surfaceShapes:new Uint16Array(surfaceShapes), parts: [] };
    for (let i = 0; i < 4; i++) {
      const bk = buckets[i];
      out.parts.push(bk.n ? { pos: bk.pos.slice(0, bk.n * 4), dat: bk.dat.slice(0, bk.n * 4), n: bk.n } : null);
    }
    // parte 4: blocos do Minecraft (malha própria; só o pedaço central)
    const mcCel = [];
    for (const ri of mcLista) {
      const y = Math.floor(ri / RA) + YB, rz = Math.floor((ri % RA) / RW) - CW, rx = (ri % RW) - CW;   // y do mundo
      if (rx >= 0 && rx < CW && rz >= 0 && rz < CW) mcCel.push([ri, mcVox[ri], rx, y, rz]);
    }
    out.parts.push(mcMalha({ ox: cx * CW, oz: cz * CW, celulas: mcCel, rv, sky, blk, hasBlk, OPAQUE, shapes, CUBE, STEP, mcVox, MC_FORMA: B.MC_FORMA, MC_RECORTE: B.MC_RECORTE,
      clima: (x, z, y) => { const gi = x + z * 17; let t = tGrid[gi] - gen.lapse(y); t = t < 0 ? 0 : t > 1 ? 1 : t; return [(t * 255) | 0, (mGrid[gi] * 255) | 0]; } }));
    for (const ri of mcLista) { mcVox[ri] = 0; mcLuz[ri] = 0; }
    mcLista = [];
    for (const ri of visLista) visVox[ri] = 0;
    visLista = [];
    if(out.parts[3])out.parts[3].normal=new Float32Array(slopeNormals);
    // parte 5: opaco com vértice abaixo de y 0 (mesmo material da parte 0; posição Int16, y do mundo)
    out.parts.push(fundoBk.n ? { pos: fundoBk.pos.slice(0, fundoBk.n * 4), dat: fundoBk.dat.slice(0, fundoBk.n * 4), n: fundoBk.n } : null);
    return out;
  }

  // luz num ponto da última região processada (usado só em testes)
  function debugLight(x, y, z) {
    const i = regionIndex(x, y, z);
    return { sky: sky[i], blk: hasBlk ? blk[i] : 0, block: rv[i] };
  }

  return { mesh, debugLight };
}

export function transferList(result) {
  const list = [result.models.buffer];
  if (result.plants) list.push(result.plants.buffer);
  if (result.lawn) list.push(result.lawn.buffer);
  if (result.canopy) list.push(result.canopy.buffer);
  if(result.lightField)list.push(result.lightField.buffer);
  if(result.surfaceShapes)list.push(result.surfaceShapes.buffer);
  for (const p of result.parts) if (p) { list.push(p.pos.buffer, p.dat.buffer); if(p.normal)list.push(p.normal.buffer); if(p.uv)list.push(p.uv.buffer); }
  return list;
}
