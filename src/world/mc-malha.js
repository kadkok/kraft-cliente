// LAVRA — malha dos blocos do Minecraft (fase 3 de docs/plano-blocos-minecraft.md). Roda no worker, chamada pelo mesher.
//
// Lê public/assets/mc/malha.json (tools/mc/malha.py): caixas de cada modelo em 1/16 de bloco, faces com camada da folha
// de texturas, uv, giro do uv, face que esconde (cull) e tinta; e os modelos de cada estado com giro x/y e uvlock.
// Para cada célula com bloco MC no pedaço central, monta as faces das caixas:
//   - giro da caixa (eixo, ângulo, origem, reescala) → giro do modelo em X → giro em Y (em torno de 8, 8, 8), como no Minecraft;
//   - face com cull some quando o vizinho daquele lado é cubo cheio opaco (ou o mesmo bloco de recorte, exceto folhas);
//   - luz: a da célula para onde a face olha, quando a face está na borda do bloco; senão a da própria célula;
//   - uv do arquivo (ou o padrão do Minecraft pela caixa); com uvlock e giro, o uv sai da posição já girada.
// Saída no formato das outras partes do mesher (aPos = x, y, z, camada · aDat = face/ao/tinta, luz, clima) + aUv (u, v
// em 0..1, v = 0 no topo da textura). O shader é o do terreno com a variante MC (render/materials.js).
import { MC_BASE, MC_N } from '../../shared/mc-estados.js';

let dados = null;
let carregando = null;
let balanco = null;     // classe de balanço por estado (tools/mc/movimentos.py → assets/mc/movimentos.json): tipo × 4 + metade
// uma pilha de pacotes por página (a troca recarrega): formas, estados e texturas da pilha (tools/mc/pilha.py)
export function mcCarregar(pilha = 'realista') {
  const url = new URL(`../../assets/mc/malha-${pilha}.json`, import.meta.url);
  const mov = new URL('../../assets/mc/movimentos.json', import.meta.url);
  carregando ||= Promise.all([
    fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(mov).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]).then(([d, m]) => { dados = d; if (m) mcUsarMovimentos(m); return d; });
  return carregando;
}
export const mcPronto = () => !!dados;
export function mcUsarDados(d) { dados = d; }      // testes (Node, sem fetch)
export function mcUsarMovimentos(m) { const b = new Uint8Array(MC_N); for (const [s, n, c] of m.balanco || []) b.fill(c, s, s + n); balanco = b; }
// código de balanço de um vértice, que vai em aUv.w × 65536: tipo × 16 + peso (0..15). Planta presa ao chão e capim do
// mar: o pé fica e a ponta vai (peso pela altura no bloco; planta alta: metade de baixo 0..½, de cima ½..1); o resto, cheio.
export function balancoDoVertice(tipo, metade, y) {
  let w = 1;
  if ((tipo === 2 || tipo === 4) && metade !== 3) { const yy = Math.min(1, Math.max(0, y)); w = metade === 1 ? yy * 0.5 : metade === 2 ? 0.5 + yy * 0.5 : yy; }
  return tipo * 16 + Math.round(w * 15);
}

// vetores das direções do LAVRA: 0 +X · 1 −X · 2 +Y · 3 −Y · 4 +Z · 5 −Z
const DV = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const dirDe = (v) => { const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]); return ax >= ay && ax >= az ? (v[0] > 0 ? 0 : 1) : ay >= az ? (v[1] > 0 ? 2 : 3) : (v[2] > 0 ? 4 : 5); };
// giro de 90° do modelo: X leva cima → norte; Y leva norte → leste (pontos em 1/16, em torno de 8, 8, 8)
const rotX = (p) => [p[0], p[2], 16 - p[1]];
const rotY = (p) => [16 - p[2], p[1], p[0]];
const rotXv = (v) => [v[0], v[2], -v[1]];
const rotYv = (v) => [-v[2], v[1], v[0]];
// cantos de cada face pelo parâmetro (s, t) do uv: s ao longo do u, t ao longo do v (v = 0 no topo)
function canto(d, s, t, a, b) {
  const [x1, y1, z1] = a, [x2, y2, z2] = b, dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  switch (d) {
    case 2: return [x1 + s * dx, y2, z1 + t * dz];          // cima
    case 3: return [x1 + s * dx, y1, z2 - t * dz];          // baixo
    case 5: return [x2 - s * dx, y2 - t * dy, z1];          // norte
    case 4: return [x1 + s * dx, y2 - t * dy, z2];          // sul
    case 1: return [x1, y2 - t * dy, z1 + s * dz];          // oeste
    default: return [x2, y2 - t * dy, z2 - s * dz];         // leste
  }
}
function uvPadrao(d, a, b) {
  const [x1, y1, z1] = a, [x2, y2, z2] = b;
  switch (d) {
    case 3: return [x1, 16 - z2, x2, 16 - z1];
    case 2: return [x1, z1, x2, z2];
    case 5: return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 4: return [x1, 16 - y2, x2, 16 - y1];
    case 1: return [z1, 16 - y2, z2, 16 - y1];
    default: return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}
const ST = [[0, 0], [1, 0], [1, 1], [0, 1]];
function giraST(s, t, r) { return r === 90 ? [t, 1 - s] : r === 180 ? [1 - s, 1 - t] : r === 270 ? [1 - t, s] : [s, t]; }
function giraCaixa(p, g) {
  if (!g) return p;
  const [eixo, ang, ox, oy, oz, rees] = g, a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  let x = p[0] - ox, y = p[1] - oy, z = p[2] - oz;
  if (eixo === 0) { const ny = y * c - z * s, nz = y * s + z * c; y = ny; z = nz; }
  else if (eixo === 1) { const nx = x * c + z * s, nz = -x * s + z * c; x = nx; z = nz; }
  else { const nx = x * c - y * s, ny = x * s + y * c; x = nx; y = ny; }
  if (rees) { const k = 1 / Math.cos(a); if (eixo !== 0) x *= k; if (eixo !== 1) y *= k; if (eixo !== 2) z *= k; }
  return [x + ox, y + oy, z + oz];
}

function novoBalde() { return { pos: new Float32Array(16384), dat: new Uint8Array(16384), uv: new Float32Array(16384), n: 0 }; }
function cresce(bk, mais) {
  if ((bk.n + mais) * 4 <= bk.pos.length) return;
  const n = Math.max(bk.pos.length * 2, (bk.n + mais) * 4);
  const p = new Float32Array(n); p.set(bk.pos); bk.pos = p;
  const d = new Uint8Array(n); d.set(bk.dat); bk.dat = d;
  const u = new Float32Array(n); u.set(bk.uv); bk.uv = u;
}

// ctx: { celulas: [[indiceRegiao, estado(≥ MC_BASE), x, y, z], ...], rv, sky, blk, hasBlk, OPAQUE, shapes, CUBE, STEP,
//        MC_SOLIDO, MC_RECORTE, clima(x, z, y) → [t, m] em 0..255 }
export function mcMalha(ctx) {
  if (!dados || !ctx.celulas.length) return null;
  const bk = novoBalde();
  const folhas = dados._folhas || (dados._folhas = new Set(dados.folhas));
  const anim = dados.anim || {}, chamas = dados.chamas || {};
  const { rv, sky, blk, hasBlk, OPAQUE, shapes, CUBE, STEP, mcVox } = ctx;
  for (const [c, st, cx, cy, cz] of ctx.celulas) {
    const n = st - MC_BASE;
    const modelos = dados.estados[n];
    if (!modelos) continue;
    const bal = balanco ? balanco[n] : 0, balT = bal >> 2, balM = bal & 3;
    const tinta = dados.tinta[n] || 0;
    const tm = tinta === 0 ? 0 : tinta === 2 ? 2 : tinta === 3 ? 3 : 1;
    const ltProprio = sky[c] | ((hasBlk ? blk[c] : 0) << 4);
    const cl = ctx.clima(cx, cz, cy);
    // cada parte sorteia uma das alternativas pela posição (o "random variant" do Minecraft, com peso)
    const wx = (ctx.ox || 0) + cx, wz = (ctx.oz || 0) + cz;
    let h = (Math.imul(wx, 3129871) ^ Math.imul(wz, 116129781) ^ cy) >>> 0;
    const escolhidos = [];
    for (const parte of modelos) {
      if (parte.length === 1) { escolhidos.push(parte[0]); continue; }
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
      let tot = 0; for (const m of parte) tot += m[4] || 1;
      let r = (h % 1000) / 1000 * tot;
      let alt = parte[parte.length - 1];
      for (const m of parte) { r -= m[4] || 1; if (r < 0) { alt = m; break; } }
      escolhidos.push(alt);
    }
    const ch = chamas[n];
    if (ch) {                                          // chama da tocha: duas folhinhas cruzadas, acesas e tremendo (shader, bit "especial")
      const [px, py, pz, camada] = ch, L = 0.11, A = 0.28, lt = (sky[c] | 0) | (15 << 4), f = 2 | (3 << 3) | (1 << 5);
      const quads = [[[px - L, py, pz], [px + L, py, pz], [px + L, py + A, pz], [px - L, py + A, pz]], [[px, py, pz - L], [px, py, pz + L], [px, py + A, pz + L], [px, py + A, pz - L]]];
      const UVQ = [[0, 1], [1, 1], [1, 0], [0, 0]];
      for (const q of quads) {
        cresce(bk, 4);
        for (let k = 0; k < 4; k++) {
          const o = bk.n * 4;
          bk.pos[o] = cx + q[k][0]; bk.pos[o + 1] = cy + q[k][1]; bk.pos[o + 2] = cz + q[k][2]; bk.pos[o + 3] = camada;
          bk.dat[o] = f; bk.dat[o + 1] = lt; bk.dat[o + 2] = cl[0]; bk.dat[o + 3] = cl[1];
          bk.uv[bk.n * 4] = UVQ[k][0]; bk.uv[bk.n * 4 + 1] = UVQ[k][1]; bk.uv[bk.n * 4 + 2] = 0; bk.uv[bk.n * 4 + 3] = 0;
          bk.n++;
        }
      }
    }
    for (const [mi, rx, ry, uvlock] of escolhidos) {
      const caixas = dados.modelos[mi];
      const gx = ((rx || 0) / 90) & 3, gy = ((ry || 0) / 90) & 3;
      const giraP = (p) => { for (let k = 0; k < gx; k++) p = rotX(p); for (let k = 0; k < gy; k++) p = rotY(p); return p; };
      const giraV = (v) => { for (let k = 0; k < gx; k++) v = rotXv(v); for (let k = 0; k < gy; k++) v = rotYv(v); return v; };
      for (const [x1, y1, z1, x2, y2, z2, giro, faces] of caixas) {
        const a = [x1, y1, z1], b = [x2, y2, z2];
        for (const [d, camada, u1, v1, u2, v2, rotUv, cull, temTinta] of faces) {
          const dw = (gx || gy) ? dirDe(giraV(DV[d])) : d;
          if (cull >= 0) {
            const cw = (gx || gy) ? dirDe(giraV(DV[cull])) : cull;
            const ni = c + STEP[cw], nb = rv[ni];
            if (OPAQUE[nb] && shapes[ni] === CUBE && nb !== ctx.MC_FORMA) continue;
            if (nb === ctx.MC_RECORTE && mcVox[ni] === st && !folhas.has(n)) continue;
          }
          // posições: caixa → giro da caixa → giro do modelo
          const P = ST.map(([s, t]) => giraP(giraCaixa(canto(d, s, t, a, b), giro)));
          // uv: com uvlock e giro do modelo, o padrão do Minecraft calculado na posição já girada
          let U1 = u1, V1 = v1, U2 = u2, V2 = v2, R = rotUv, lock = false, mn = null, mx = null;
          if (uvlock && (gx || gy) && !giro) {
            mn = [0, 1, 2].map((i) => Math.min(...P.map((p) => p[i]))); mx = [0, 1, 2].map((i) => Math.max(...P.map((p) => p[i])));
            [U1, V1, U2, V2] = uvPadrao(dw, mn, mx); R = 0; lock = true;
          }
          // luz: borda do bloco → a célula vizinha daquele lado; dentro do bloco → a própria
          const ax = dw >> 1, sinal = dw & 1 ? -1 : 1;
          const borda = P.every((p) => (sinal > 0 ? p[ax] >= 15.999 : p[ax] <= 0.001));
          let lt = ltProprio;
          if (borda) { const ni = c + STEP[dw]; lt = sky[ni] | ((hasBlk ? blk[ni] : 0) << 4); if (!lt && OPAQUE[rv[ni]]) lt = ltProprio; }
          const f = (dw & 7) | (3 << 3) | ((temTinta ? tm : 0) << 6);
          cresce(bk, 4);
          for (let k = 0; k < 4; k++) {
            const p = P[k], o = bk.n * 4;
            let s = ST[k][0], t = ST[k][1];
            if (lock) {                                      // uv pela posição girada: mesma regra do padrão, ponto a ponto
              const fr = (i, inv) => { const den = mx[i] - mn[i] || 1; const r = (p[i] - mn[i]) / den; return inv ? 1 - r : r; };
              if (dw === 2) { s = fr(0); t = fr(2); } else if (dw === 3) { s = fr(0); t = fr(2, true); }
              else if (dw === 5) { s = fr(0, true); t = fr(1, true); } else if (dw === 4) { s = fr(0); t = fr(1, true); }
              else if (dw === 1) { s = fr(2); t = fr(1, true); } else { s = fr(2, true); t = fr(1, true); }
            }
            const [ss, tt] = giraST(s, t, R || 0);
            bk.pos[o] = cx + p[0] / 16; bk.pos[o + 1] = cy + p[1] / 16; bk.pos[o + 2] = cz + p[2] / 16; bk.pos[o + 3] = camada;
            bk.dat[o] = f; bk.dat[o + 1] = lt; bk.dat[o + 2] = cl[0]; bk.dat[o + 3] = cl[1];
            const an = anim[camada];                 // textura animada: primeira camada extra e quadros×256 + ticks por quadro
            bk.uv[bk.n * 4] = (U1 + ss * (U2 - U1)) / 16; bk.uv[bk.n * 4 + 1] = (V1 + tt * (V2 - V1)) / 16;
            bk.uv[bk.n * 4 + 2] = an ? an[0] : 0;
            bk.uv[bk.n * 4 + 3] = (an ? an[1] * 256 + an[2] : 0) + (balT ? balancoDoVertice(balT, balM, p[1] / 16) * 65536 : 0);
            bk.n++;
          }
        }
      }
    }
  }
  if (!bk.n) return null;
  return { pos: bk.pos.slice(0, bk.n * 4), dat: bk.dat.slice(0, bk.n * 4), uv: bk.uv.slice(0, bk.n * 4), n: bk.n, mc: true };
}
