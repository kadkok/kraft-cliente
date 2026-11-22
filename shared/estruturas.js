// Kraft — estruturas raras desenhadas por gerador (pedido do Kadmus, 19/11/2026: "quero mais mistérios enterrados,
// baús, pictogramas em ruínas… cavernas reais devem ser raras e lindas com estruturas atrás de cachoeiras ou
// escondidas nas matas"). Puro e determinístico: servidor (server/estruturas.js), testes e, depois, o gerador do mundo.
//
// ── CONTRATO ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Cada tipo mora no seu arquivo (shared/estruturas/*.js) e entrega um objeto TIPO:
//   { chave, nome, descricao, celula, chance, busca, passo, podeNascer(ctx, x, z), gerar(ctx, sitio) }
//   · podeNascer(ctx, x, z) → sítio | null. Só lê o TERRENO NATURAL (altura, bioma, blocos do gerador): diz se o ponto
//     (x, z) serve (paredão para a cachoeira, encosta de mata para a escondida…) e devolve
//     { tipo, x, y, z, rot, semente, ... } — âncora (x, y, z), giro (rot 0..3 = frente para +X, +Z, −X, −Z) e o que o
//     gerador precisar. Mesma semente do mundo e mesmo ponto: mesmo sítio, em qualquer aparelho.
//   · gerar(ctx, sitio) → Planta (abaixo). Também só lê o terreno natural: a estrutura é função da semente.
//   · celula/chance: raridade natural. O mundo é dividido em células de `celula` m; em cada uma, com chance `chance`,
//     sorteia-se um ponto e procura-se em volta (até `busca` m, de `passo` em `passo`) um lugar onde podeNascer aceite.
//
// Planta (criarPlanta): o que a estrutura muda no mundo, relativo a uma âncora.
//   · lista() → [[x, y, z, bloco, estado, marca], ...] em coordenadas do mundo; relativa() → [[dx, dy, dz, …]] da âncora.
//     estado = mini-bloco/escada/terra moldada (shared/minis.js; 0 = bloco inteiro); marca ESSENCIAL = a célula não
//     pode ser pulada (se cair em lugar proibido, o sítio inteiro é recusado); sem marca = enfeite (pula-se).
//   · baus: [{ x, y, z, nivel, i }] → server/baus.js criarBau(x, y, z, nivel, semente) com semente = hash da planta e i.
//   · pictos: pictogramas (shared/estruturas/pictogramas.js: dado + mosaico provisório; contrato para o Astra lá).
//   · entrada: [x, y, z] onde se chega a pé; nome: texto para quem joga.
//   Água: só FONTES (B.WATER). A cachoeira é fonte + a lei da água (shared/water.js) espalhando a corrente.
//
// Regras de lugar (validar): nunca a menos de DIST_OBRA m (no plano) de célula editada por alguém; nunca na zona do campo
// de futebol (ZONA_CAMPO e as zonas funcionais do mundo); nunca tocando árvore natural (tronco, raiz, copa ou o chão em
// volta do tronco: a árvore ficaria no ar ou sem copa) — célula de enfeite em lugar de árvore é pulada, célula essencial
// recusa o sítio; nunca apagando obra de ninguém (consequência da distância).
//
// Ligação ao gerador do mundo (para a sessão principal, depois da profundidade em dobro): sitiosNaRegiao(ctx, x0, z0,
// x1, z1) diz quais sítios naturais existem numa região. Ver o fim deste arquivo.
//
// Determinismo: só + − × ÷, floor, sqrt, abs, min/max e Math.imul (hash3 de noise.js). Nada de Math.random, sin, cos, pow.

import { Y_TOP, Y_MIN, SEA, yEdMin, vidx } from './constants.js';
import { B, SOLID, KIND, K_CROSS, K_LIQUID, LEVEL } from './blocks.js';
import { hash3, mulberry32 } from './noise.js';
import { TREE_CELL, TREE_REACH, treeVoxelMap } from './trees.js';
import { MOLDE, MOLDE_OK, MINI_OK, miniState, AXIS_X, AXIS_Y, AXIS_Z } from './minis.js';
import { LOOSE } from './laws.js';

// Limites do plano de cima (profundidade em dobro, item 71): de yEdMin(0) = −63 (logo acima da rocha-mãe) a Y_TOP − 1.
export const Y_ED_MIN = yEdMin(0);
export { Y_TOP, SEA };

export const DIST_OBRA = 24;   // m, no plano, até a célula editada mais perto
// Campo de futebol do mundo oficial (item 49 do CLAUDE.md), com folga. Vale mesmo em mundo que não tem o campo criado.
export const ZONA_CAMPO = Object.freeze({ minX: 124.5, maxX: 176.5, minZ: -147.5, maxZ: -119.5 });
export const FOLGA_ZONA = 8;

export const ESSENCIAL = 1;

// frente (para fora) de cada giro: 0 = +X, 1 = +Z, 2 = −X, 3 = −Z. "u" corre ao longo da frente, "v" para fora.
export const FRENTE = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// 32 direções no plano (k × 11,25°), escritas como números: curvas sem seno nem cosseno na hora (determinismo).
export const DIR32 = Object.freeze([[1, 0], [0.980785, 0.19509], [0.92388, 0.382683], [0.83147, 0.55557], [0.707107, 0.707107], [0.55557, 0.83147], [0.382683, 0.92388], [0.19509, 0.980785], [0, 1], [-0.19509, 0.980785], [-0.382683, 0.92388], [-0.55557, 0.83147], [-0.707107, 0.707107], [-0.83147, 0.55557], [-0.92388, 0.382683], [-0.980785, 0.19509], [-1, 0], [-0.980785, -0.19509], [-0.92388, -0.382683], [-0.83147, -0.55557], [-0.707107, -0.707107], [-0.55557, -0.83147], [-0.382683, -0.92388], [-0.19509, -0.980785], [0, -1], [0.19509, -0.980785], [0.382683, -0.92388], [0.55557, -0.83147], [0.707107, -0.707107], [0.83147, -0.55557], [0.92388, -0.382683], [0.980785, -0.19509]]);
export const dir32 = (k) => DIR32[((k % 32) + 32) % 32];
export const NOME_RUMO = { '1,0': 'leste', '0,1': 'sul', '-1,0': 'oeste', '0,-1': 'norte' };

// ── ruído de valor (determinístico) ─────────────────────────────────────────────────────────────────────────────────
const U32 = 4294967296;
const fade = (t) => t * t * (3 - 2 * t);
// [0, 1) suave em 3D; s = semente inteira
export function ruido3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const h = (i, j, k) => hash3(xi + i, yi + j, zi + k, s) / U32;
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * fx, x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * fx;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * fx, x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
export const ruido2 = (x, z, s) => ruido3(x, 0.5, z, s);
export const sorte = (s, ...ns) => { let h = s >>> 0; for (const n of ns) h = hash3(h, n | 0, 0x2f1, 0x51f15e); return h / U32; };
export const semear = (s, ...ns) => { let h = s >>> 0; for (const n of ns) h = hash3(h, n | 0, 0x7a3, 0x1b873593); return h >>> 0; };
export const rng = (semente) => mulberry32(semente | 0);

// ── estados de mini-bloco usados nas formas (shared/minis.js) ───────────────────────────────────────────────────────
export const POSTE = (q) => miniState(AXIS_Y, 1 << (q & 3));          // 0,5 × 0,5 m em pé, num canto do espaço
export const TRES_QUARTOS = (q) => miniState(AXIS_Y, 15 & ~(1 << (q & 3)));
export const MEIO_Y = (par) => miniState(AXIS_Y, par ? 0b0101 : 0b0011);
export const VIGA = (eixo, q) => miniState(eixo, 1 << (q & 3));        // deitado ao longo do eixo (X ou Z)
export { AXIS_X, AXIS_Y, AXIS_Z, MOLDE };

// ── contexto do terreno natural ─────────────────────────────────────────────────────────────────────────────────────
// gen = createWorldGen(semente, 0, opt) (shared/worldgen.js); natural(x, y, z) = bloco do gerador, sem edições.
const chave2 = (x, z) => (x + 1048576) * 2097152 + (z + 1048576);
export function criarContexto({ gen, natural, seed = gen?.seed }) {
  const alturas = new Map(), biomas = new Map();
  const height = (x, z) => {
    const k = chave2(x, z);
    let h = alturas.get(k);
    if (h === undefined) { h = gen.height(x, z); if (alturas.size > 400000) alturas.clear(); alturas.set(k, h); }
    return h;
  };
  const bioma = (x, z) => {
    const k = chave2(x, z);
    let b = biomas.get(k);
    if (b === undefined) { b = gen.biomeAt(x, z); if (biomas.size > 200000) biomas.clear(); biomas.set(k, b); }
    return b;
  };
  // árvores naturais cujas células podem cair na caixa [x0, x1] × [z0, z1] (inclui cacto e coqueiro)
  const arvores = (x0, z0, x1, z1) => {
    const out = [], R = TREE_REACH + 2;
    for (let gz = Math.floor((z0 - R) / TREE_CELL); gz <= Math.floor((z1 + R) / TREE_CELL); gz++) {
      for (let gx = Math.floor((x0 - R) / TREE_CELL); gx <= Math.floor((x1 + R) / TREE_CELL); gx++) {
        const t = gen.treeAt?.(gx, gz);
        if (t) out.push(t);
      }
    }
    return out;
  };
  return { seed: seed >>> 0, gen, natural, height, bioma, arvores, yMin: Y_ED_MIN, yTop: Y_TOP, sea: SEA };
}

// Leitor do terreno natural a partir do gerador, sem servidor (testes, ferramentas): pedaços em cache.
export function naturalDoGerador(gen, maxPedacos = 256) {
  const cache = new Map();
  return (x, y, z) => {
    if (y >= Y_TOP) return B.AIR;
    if (y < Y_MIN) return B.BEDROCK;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), k = chave2(cx, cz);
    let v = cache.get(k);
    if (!v) { v = gen.generate(cx, cz).vox; if (cache.size >= maxPedacos) cache.delete(cache.keys().next().value); cache.set(k, v); }
    return v[vidx(x - cx * 16, y, z - cz * 16)];
  };
}

// ── planta ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const chave3 = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 512 + (y + 256);
export const solido = (b) => b > 0 && SOLID[b] === 1;
export const aberto = (b) => b === B.AIR || (b > 0 && (KIND[b] === K_CROSS || KIND[b] === K_LIQUID));
export const planta_ = (b) => b > 0 && KIND[b] === K_CROSS;

export function criarPlanta(ctx, { tipo, ancora, rot = 0, semente = 0, nome = '' }) {
  const cel = new Map();   // chave → [x, y, z, bloco, estado, marca]
  const [ox, oz] = FRENTE[rot & 3], ax = -oz, az = ox;
  const P = {
    tipo, ancora: ancora.slice(), rot: rot & 3, semente: semente >>> 0, nome,
    baus: [], pictos: [], entrada: null, fontes: [], notas: [],
    // local (u ao longo da frente, y, v para fora) → mundo
    L(u, y, v) { return [ancora[0] + u * ax + v * ox, y, ancora[2] + u * az + v * oz]; },
    eixoU: [ax, az], eixoV: [ox, oz],
    natural: (x, y, z) => ctx.natural(x, y, z),
    ler(x, y, z) { const c = cel.get(chave3(x, y, z)); return c ? c[3] : ctx.natural(x, y, z); },
    estado(x, y, z) { const c = cel.get(chave3(x, y, z)); return c ? c[4] : 0; },
    tem(x, y, z) { return cel.has(chave3(x, y, z)); },
    marca(x, y, z) { return cel.get(chave3(x, y, z))?.[5] || 0; },
    // põe um bloco (estado opcional). Igual ao natural e sem estado = volta ao natural (sai da lista).
    por(x, y, z, b, m = 0, f = 0) {
      if (y < ctx.yMin || y >= ctx.yTop) return;
      const k = chave3(x, y, z), nat = ctx.natural(x, y, z);
      if (nat === B.BEDROCK) return;                     // rocha-mãe nunca muda
      const old = cel.get(k);
      if (b === nat && !m) { cel.delete(k); return; }   // igual ao terreno: não é mudança
      if (old) { old[3] = b; old[4] = m; old[5] |= f; } else cel.set(k, [x, y, z, b, m, f]);
    },
    ar(x, y, z, f = 0) { P.por(x, y, z, B.AIR, 0, f); },
    // cava só o que é sólido (deixa água e ar como estão)
    cavar(x, y, z, f = 0) { const b = P.ler(x, y, z); if (b !== B.AIR && !(LEVEL[b] > 0)) P.ar(x, y, z, f); },
    tirar(x, y, z) { cel.delete(chave3(x, y, z)); },
    cheio: (x, y, z) => solido(P.ler(x, y, z)),
    vazio: (x, y, z) => aberto(P.ler(x, y, z)),
    // topo sólido da coluna (na planta), procurando de cima de `de` para baixo
    topo(x, z, de, ate = ctx.yMin) { for (let y = de; y >= ate; y--) if (solido(P.ler(x, y, z))) return y; return ate - 1; },
    celulas: () => cel.values(),
    tamanho: () => cel.size,
    lista() { return [...cel.values()].map((c) => c.slice()); },
    relativa() { return [...cel.values()].map((c) => [c[0] - ancora[0], c[1] - ancora[1], c[2] - ancora[2], c[3], c[4], c[5]]); },
    caixa() {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const c of cel.values()) for (let i = 0; i < 3; i++) { if (c[i] < min[i]) min[i] = c[i]; if (c[i] > max[i]) max[i] = c[i]; }
      return { min, max };
    },
  };
  return P;
}

// ── formas orgânicas ────────────────────────────────────────────────────────────────────────────────────────────────
// Cava um elipsoide deformado pelo ruído. c = centro [x, y, z]; r = raios [rx, ry, rz]; chao = y abaixo do qual nada
// se cava (piso achatado); amp = quanto o ruído empurra a parede (0..0,6); s = semente. Devolve quantas células cavou.
export function cavarBolha(P, c, r, { chao = -Infinity, teto = Infinity, amp = 0.35, s = 1, escala = 0.22, marca = ESSENCIAL } = {}) {
  let n = 0;
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  const X0 = Math.floor(cx - rx * 1.4), X1 = Math.ceil(cx + rx * 1.4);
  const Y0 = Math.max(Math.floor(cy - ry * 1.4), Math.floor(chao) + 1), Y1 = Math.min(Math.ceil(cy + ry * 1.4), Math.floor(teto));
  const Z0 = Math.floor(cz - rz * 1.4), Z1 = Math.ceil(cz + rz * 1.4);
  for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) for (let y = Y0; y <= Y1; y++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > 2) continue;
    const w = (ruido3(x * escala, y * escala * 1.3, z * escala, s) - 0.5) * 2 * amp;
    if (d < 1 + w) { P.cavar(x, y, z, marca); n++; }
  }
  return n;
}

// Galeria: cava ao longo de uma linha de pontos [x, y(piso), z], com meia-largura `r` e altura `alt` acima do piso.
// O piso de cada passo é o y interpolado (degraus naturais viram rampa: o chão que fica é terreno de verdade).
export function cavarGaleria(P, pontos, { r = 1.2, alt = 3, amp = 0.35, s = 7, marca = ESSENCIAL } = {}) {
  for (let i = 0; i + 1 < pontos.length; i++) {
    const [ax, ay, az] = pontos[i], [bx, by, bz] = pontos[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz) || 1;
    const passos = Math.ceil(L * 2);
    for (let k = 0; k <= passos; k++) {
      const t = k / passos, px = ax + dx * t, pz = az + dz * t, py = ay + (by - ay) * t;
      const piso = Math.floor(py + 0.5);
      const rr = r + (ruido3(px * 0.3, py * 0.3, pz * 0.3, s) - 0.5) * 2 * amp;
      const ri = Math.ceil(rr + 1);
      for (let ex = -ri; ex <= ri; ex++) for (let ez = -ri; ez <= ri; ez++) {
        const x = Math.floor(px) + ex, z = Math.floor(pz) + ez;
        const qx = x + 0.5 - px, qz = z + 0.5 - pz;
        // distância ao eixo, só na direção perpendicular ao caminho
        const ao = (qx * dx + qz * dz) / L, px2 = qx * qx + qz * qz - ao * ao;
        if (px2 > rr * rr) continue;
        const borda = Math.sqrt(px2) / Math.max(rr, 0.5);
        const h = alt - (borda > 0.7 ? 1 : 0) + (ruido3(x * 0.4, piso * 0.4, z * 0.4, s + 3) > 0.72 ? 1 : 0);
        for (let y = piso + 1; y <= piso + h; y++) P.cavar(x, y, z, marca);
      }
    }
  }
}

// Ponta afinada de uma formação pendurada (desce) ou em pé (sobe): bloco inteiro → três quartos → poste.
// comprimento em blocos; corpo de 1 × 1; base mais larga (cruz) quando comprida.
export function formacao(P, x, y0, z, comp, { desce = true, mat = B.SANDSTONE, s = 3, base = true } = {}) {
  const d = desce ? -1 : 1, q = semear(s, x, z) & 3;
  for (let i = 0; i < comp; i++) {
    const y = y0 + d * i;
    if (!P.vazio(x, y, z)) return;
    const resta = comp - i;
    const m = resta === 1 ? POSTE(q) : resta === 2 && comp >= 3 ? TRES_QUARTOS((q + 2) & 3) : 0;
    P.por(x, y, z, mat, m);
  }
  if (base && comp >= 4) {
    for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (sorte(s, x + ex, z + ez) < 0.35) continue;
      const alt = 1 + (comp >= 6 && sorte(s + 1, x + ex, z + ez) < 0.5 ? 1 : 0);
      for (let i = 0; i < alt; i++) {
        const y = y0 + d * i;
        if (P.vazio(x + ex, y, z + ez)) P.por(x + ex, y, z + ez, mat, i === alt - 1 ? TRES_QUARTOS((q + ex + 2 * ez) & 3) : 0);
      }
    }
  }
}

// Coluna em ampulheta (estalactite que encontrou a estalagmite): grossa embaixo e em cima, fina no meio.
export function pilar(P, x, z, y0, y1, { rMax = 2.2, rMin = 1, mat = B.SANDSTONE, mat2 = B.STONE, s = 5 } = {}) {
  const H = Math.max(1, y1 - y0);
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / H, e = 2 * t - 1;
    const r = rMin + (rMax - rMin) * e * e;
    const ri = Math.ceil(r + 1);
    for (let ex = -ri; ex <= ri; ex++) for (let ez = -ri; ez <= ri; ez++) {
      const rr = r + (ruido3((x + ex) * 0.5, y * 0.35, (z + ez) * 0.5, s) - 0.5) * 0.9;
      if (ex * ex + ez * ez > rr * rr) continue;
      if (!P.vazio(x + ex, y, z + ez)) continue;
      const faixa = ruido3((x + ex) * 0.2, y * 0.8, (z + ez) * 0.2, s + 9) > 0.66;
      P.por(x + ex, y, z + ez, faixa ? mat2 : mat, 0, ESSENCIAL);
    }
  }
}

// Cacho de cristais na parede: o bloco da parede vira cristal e brotam lascas (mini-blocos) para o lado de fora.
// (x, y, z) = célula de parede (sólida) encostada no vazio; n = [nx, ny, nz] aponta para o vazio. As lascas são
// quartos de mini-bloco de cristal fantasma (brilham roxo, como ametista, e quarto de mini-bloco não solta item: o
// brilho não vira saque); a base é Cristal (brilha e solta o próprio bloco, valor modesto).
export function cristais(P, x, y, z, n, { mat = B.CRYSTAL_ORE, lasca = B.PHANTOM_CRYSTAL, s = 11, tam = 3 } = {}) {
  const r = rng(semear(s, x, y, z));
  const parede = [[x, y, z]];
  for (let i = 0; i < tam; i++) {
    const [px, py, pz] = parede[Math.floor(r() * parede.length)];
    const ex = n[0] ? 0 : Math.floor(r() * 3) - 1, ey = n[1] ? 0 : Math.floor(r() * 3) - 1, ez = n[2] ? 0 : Math.floor(r() * 3) - 1;
    const q = [px + ex, py + ey, pz + ez];
    if (P.cheio(...q) && P.vazio(q[0] + n[0], q[1] + n[1], q[2] + n[2])) parede.push(q);
  }
  for (const [px, py, pz] of parede) P.por(px, py, pz, mat);
  // lascas: na célula vazia em frente; deitadas na direção da normal quando a parede é de lado
  const eixo = n[0] ? AXIS_X : n[2] ? AXIS_Z : AXIS_Y;
  let lascas = 0;
  for (const [px, py, pz] of parede) {
    const fx = px + n[0], fy = py + n[1], fz = pz + n[2];
    if (!P.vazio(fx, fy, fz) || P.tem(fx, fy, fz) && P.ler(fx, fy, fz) !== B.AIR) continue;
    if (r() < 0.25 && lascas > 0) continue;
    const q1 = Math.floor(r() * 4), q2 = (q1 + 1 + Math.floor(r() * 3)) & 3;
    const m = miniState(eixo, (1 << q1) | (r() < 0.5 ? 1 << q2 : 0));
    P.por(fx, fy, fz, lasca, m);
    lascas++;
  }
  return parede.length;
}

// Acha a célula de parede mais perto de (x, y, z) andando na direção d (de dentro do vazio para fora). Anda um eixo de
// cada vez (em escada, na diagonal), para a parede achada ter uma face de verdade virada para o vazio (n).
export function paredeNaDirecao(P, x, y, z, d, max = 24) {
  const sx = Math.sign(d[0]), sy = Math.sign(d[1]), sz = Math.sign(d[2]);
  let px = x, py = y, pz = z, ax = 0, az = 0;
  for (let i = 0; i < max * 2; i++) {
    const st = sy ? [0, sy, 0] : sx && sz ? (Math.abs(ax) <= Math.abs(az) ? [sx, 0, 0] : [0, 0, sz]) : [sx, 0, sz];
    const nx = px + st[0], ny = py + st[1], nz = pz + st[2];
    if (P.cheio(nx, ny, nz)) return { celula: [nx, ny, nz], n: [-st[0], -st[1], -st[2]] };
    px = nx; py = ny; pz = nz; ax += st[0]; az += st[2];
  }
  return null;
}

// Ponto de vista ao ar livre: sobe o olho para 1,7 m acima do chão daquela coluna (na planta), se estiver mais baixo.
export function olhoLivre(P, de) {
  const x = Math.floor(de[0]), z = Math.floor(de[2]);
  const chao = P.topo(x, z, Math.floor(de[1]) + 40, Math.floor(de[1]) - 40);
  return [de[0], Math.max(de[1], chao + 2.7), de[2]];
}

// Estalactite grande em cone: do teto (y0 = primeira célula vazia debaixo dele) para baixo, raio r0 no alto afinando
// até a ponta, que termina em mini-blocos (formacao). Faixas de outro material dão o aspecto de calcita em camadas.
export function cone(P, x, y0, z, comp, { r0 = 1.6, mat = B.MARBLE, mat2 = B.SANDSTONE, s = 13 } = {}) {
  for (let k = 0; k < comp; k++) {
    const rk = r0 * (1 - k / comp);
    if (rk < 0.75) { formacao(P, x, y0 - k, z, comp - k, { mat, s, base: false }); return; }
    const ri = Math.ceil(rk);
    for (let ex = -ri; ex <= ri; ex++) for (let ez = -ri; ez <= ri; ez++) {
      const rr = rk + (ruido3((x + ex) * 0.6, (y0 - k) * 0.5, (z + ez) * 0.6, s) - 0.5) * 0.7;
      if (ex * ex + ez * ez > rr * rr || !P.vazio(x + ex, y0 - k, z + ez)) continue;
      P.por(x + ex, y0 - k, z + ez, ((y0 - k) % 3 === 0) ? mat2 : mat, 0);
    }
  }
}

// ── estabilidade: a planta não pode deixar nada que as leis derrubariam (shared/laws.js) ─────────────────────────────
// 1) matéria solta (areia, cascalho, neve, cinza) com vazio embaixo vira rocha firme; 2) planta rasteira sem chão sai;
// 3) pedaço sólido solto dentro da caixa (sem ligação com o terreno de fora) sai. Roda no fim de gerar().
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FIRME = { [B.SAND]: B.SANDSTONE, [B.GRAVEL]: B.STONE, [B.SNOW]: B.ICE, [B.ASH]: B.STONE };
export function estabilizar(P) {
  const mudas = [...P.celulas()].filter((c) => aberto(c[3])).map((c) => [c[0], c[1], c[2]]);
  // matéria solta acima de vão novo (a coluna inteira de solta, até achar o firme)
  for (const [x, y, z] of mudas) {
    for (let k = 1; k < 24; k++) {
      const b = P.ler(x, y + k, z);
      if (!LOOSE[b]) break;
      P.por(x, y + k, z, FIRME[b], 0);
    }
  }
  // matéria solta posta pela planta sem chão
  for (const c of [...P.celulas()]) if (LOOSE[c[3]] && aberto(P.ler(c[0], c[1] - 1, c[2]))) P.por(c[0], c[1], c[2], FIRME[c[3]], 0, c[5]);
  // parede de vão (dos lados) que é areia ou cascalho natural vira arenito ou pedra: parede de gruta firme e limpa
  for (const [x, y, z] of mudas) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (P.tem(x + dx, y, z + dz)) continue;
      const b = P.ler(x + dx, y, z + dz);
      if (LOOSE[b]) P.por(x + dx, y, z + dz, FIRME[b], 0);
    }
  }
  // planta rasteira sem chão firme (natural ou da planta)
  for (const [x, y, z] of mudas) {
    const b = P.ler(x, y + 1, z);
    if (planta_(b) && !solido(P.ler(x, y, z))) P.ar(x, y + 1, z);
  }
  for (const c of [...P.celulas()]) if (planta_(c[3]) && !solido(P.ler(c[0], c[1] - 1, c[2]))) P.tirar(c[0], c[1], c[2]);
  // pedaços soltos: busca a partir de cada célula sólida que encosta num vão da planta
  const cx = P.caixa(), M = 2;
  const fora = (x, y, z) => x < cx.min[0] - M || x > cx.max[0] + M || y < cx.min[1] - M || y > cx.max[1] + M || z < cx.min[2] - M || z > cx.max[2] + M;
  const firme = new Set(), solto = [];
  const k3 = (x, y, z) => chave3(x, y, z);
  for (const [x, y, z] of mudas) {
    for (const [dx, dy, dz] of NB6) {
      const sx = x + dx, sy = y + dy, sz = z + dz, sk = k3(sx, sy, sz);
      if (firme.has(sk) || !solido(P.ler(sx, sy, sz)) || P.ler(sx, sy, sz) === B.BEDROCK) continue;
      const visto = new Set([sk]), fila = [[sx, sy, sz]];
      let preso = false;
      for (let i = 0; i < fila.length && !preso; i++) {
        const [qx, qy, qz] = fila[i];
        if (fora(qx, qy, qz) || fila.length > 4096) { preso = true; break; }
        for (const [ex, ey, ez] of NB6) {
          const nx = qx + ex, ny = qy + ey, nz = qz + ez, nk = k3(nx, ny, nz);
          if (visto.has(nk)) continue;
          const b = P.ler(nx, ny, nz);
          if (b === B.BEDROCK || firme.has(nk)) { preso = true; break; }
          if (!solido(b)) continue;
          visto.add(nk); fila.push([nx, ny, nz]);
        }
      }
      if (preso) for (const k of visto) firme.add(k);
      else for (const q of fila) solto.push(q);
    }
  }
  for (const [x, y, z] of solto) { P.ar(x, y, z); if (planta_(P.ler(x, y + 1, z))) P.ar(x, y + 1, z); }
  return solto.length;
}

// ── lugar proibido: árvores naturais ────────────────────────────────────────────────────────────────────────────────
// Devolve has(x, y, z): célula de árvore (tronco, raiz, folha) ou o entorno do tronco (2 m em volta, de 5 abaixo do
// pé até acima da copa: tirar o chão ali deixaria a árvore no ar). Coqueiro e cacto contam.
export function celulasDeArvore(ctx, min, max) {
  const set = new Set(), troncos = [];
  for (const t of ctx.arvores(min[0], min[2], max[0], max[2])) {
    troncos.push(t);
    if (t.kind !== 5) for (const [x, y, z] of treeVoxelMap(t, ctx.seed).values()) set.add(chave3(x, y, z));
  }
  return {
    troncos,
    has(x, y, z) {
      if (set.has(chave3(x, y, z))) return true;
      for (const t of troncos) {
        if (Math.abs(x - t.x) <= 2 && Math.abs(z - t.z) <= 2 && y >= t.y - 5 && y <= t.y + (t.th || 6) + 3) return true;
      }
      return false;
    },
  };
}

// Tira da planta o enfeite que cai em lugar de árvore; diz se sobrou célula essencial em lugar proibido.
export function respeitarArvores(ctx, P) {
  if (!P.tamanho()) return { ok: true, pulados: 0 };
  const { min, max } = P.caixa();
  const arv = celulasDeArvore(ctx, min, max);
  let pulados = 0, bate = null;
  for (const c of [...P.celulas()]) {
    if (!arv.has(c[0], c[1], c[2])) continue;
    if (c[5] & ESSENCIAL) { bate = c; break; }
    P.tirar(c[0], c[1], c[2]); pulados++;
  }
  return bate ? { ok: false, pulados, motivo: `encosta numa árvore em ${bate[0]} ${bate[1]} ${bate[2]}` } : { ok: true, pulados };
}

// ── validação do lugar (obras e zona) ───────────────────────────────────────────────────────────────────────────────
// editadoPerto(x0, z0, x1, z1) → [x, z] de uma célula editada dentro da caixa (no plano) ou null.
// zonas: [{ minX, maxX, minZ, maxZ }] (as zonas funcionais do mundo); ZONA_CAMPO vale sempre.
export function validarLugar(P, { editadoPerto = null, zonas = [], margem = 0 } = {}) {
  if (!P.tamanho()) return { ok: false, motivo: 'planta vazia' };
  const { min, max } = P.caixa();
  const m = margem;
  for (const z of [ZONA_CAMPO, ...zonas]) {
    if (max[0] + m >= z.minX - FOLGA_ZONA && min[0] - m <= z.maxX + FOLGA_ZONA && max[2] + m >= z.minZ - FOLGA_ZONA && min[2] - m <= z.maxZ + FOLGA_ZONA) {
      return { ok: false, motivo: 'cai na zona do campo de futebol' };
    }
  }
  if (min[1] < Y_ED_MIN || max[1] >= Y_TOP) return { ok: false, motivo: 'passa do fundo ou do teto do mundo' };
  if (editadoPerto) {
    const e = editadoPerto(min[0] - DIST_OBRA - m, min[2] - DIST_OBRA - m, max[0] + DIST_OBRA + m, max[2] + DIST_OBRA + m);
    if (e) return { ok: false, motivo: `obra de alguém a menos de ${DIST_OBRA} m (em ${e[0]} ${e[1]})` };
  }
  return { ok: true };
}

// ── busca ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pontos de uma espiral quadrada em volta de (x, z), de `passo` em `passo`, até o raio. Ordem fixa (determinística).
export function* espiral(x, z, raio, passo) {
  yield [x, z];
  for (let r = passo; r <= raio; r += passo) {
    for (let i = -r; i < r; i += passo) yield [x + i, z - r];
    for (let i = -r; i < r; i += passo) yield [x + r, z + i];
    for (let i = r; i > -r; i -= passo) yield [x + i, z + r];
    for (let i = r; i > -r; i -= passo) yield [x - r, z + i];
  }
}

// O primeiro sítio válido mais perto de (x, z): podeNascer + gerar + regras de lugar. aceitar(P) pode recusar mais.
// Devolve { sitio, planta, tentativas } ou { motivo, tentativas }.
// Com T.melhorDe = n, junta até n sítios vizinhos (na ordem da espiral) e tenta primeiro o de melhor `nota`.
// filtro(s) → false descarta o sítio antes de gerar (barato: não conta nas maxPlantas tentativas); parar() → true
// encerra a busca (quem chama decide o teto de tempo: este módulo não lê relógio).
export function procurarPerto(ctx, T, x, z, { raio = T.busca, passo = T.passo || 4, aceitar = null, filtro = null, parar = null, maxPlantas = 40, variante = null } = {}) {
  let tentativas = 0, plantas = 0, ultimo = 'nenhum lugar com o terreno certo por perto';
  const lote = [], N = Math.max(1, T.melhorDe || 1);
  const tentar = () => {
    lote.sort((a, b) => (b.nota || 0) - (a.nota || 0));
    for (const s of lote.splice(0)) {
      if (++plantas > maxPlantas || (parar && parar())) return null;
      const P = T.gerar(ctx, s);
      if (!P) { ultimo = 'o gerador desistiu'; continue; }
      const a = respeitarArvores(ctx, P);
      if (!a.ok) { ultimo = a.motivo; continue; }
      const v = aceitar ? aceitar(P) : { ok: true };
      if (!v.ok) { ultimo = v.motivo; continue; }
      return { sitio: s, planta: P, tentativas };
    }
    return null;
  };
  for (const [px, pz] of espiral(Math.floor(x), Math.floor(z), raio, passo)) {
    tentativas++;
    if ((tentativas & 255) === 0 && parar && parar()) break;
    const s = T.podeNascer(ctx, px, pz, variante);
    if (!s || (filtro && !filtro(s))) continue;
    lote.push(s);
    if (lote.length < N) continue;
    const r = tentar();
    if (r) return r;
    if (plantas > maxPlantas) break;
  }
  if (lote.length && plantas <= maxPlantas) { const r = tentar(); if (r) return r; }
  return { motivo: ultimo, tentativas };
}

// Semente de um sítio: do mundo, do tipo e do lugar (mesmo lugar, mesma estrutura).
export const sementeDoSitio = (ctx, chave, x, z) => semear(ctx.seed ^ 0x5e57a7, x, z, [...chave].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261));

// ── sítios naturais numa região (para o gerador do mundo chamar depois) ─────────────────────────────────────────────
// Em cada célula de T.celula m (alinhada em 0), com chance T.chance pela semente, sorteia-se um ponto e procura-se em
// volta (T.busca) um lugar onde T.podeNascer aceite. Devolve [{ tipo, x, y, z, rot, semente, ... }] cujas células
// sorteadas tocam a região [x0, x1] × [z0, z1]. Só depende da semente do mundo e do terreno natural.
// A planta de cada sítio (T.gerar) e as regras de árvore valem igual; a distância de obras e a zona do campo, quem liga
// decide (o gerador não conhece edições: ver o item 74 do CLAUDE.md).
export function sitiosNaRegiao(ctx, tipos, x0, z0, x1, z1) {
  const out = [];
  for (const T of tipos) {
    const C = T.celula;
    for (let gz = Math.floor((z0 - T.busca) / C); gz <= Math.floor((z1 + T.busca) / C); gz++) {
      for (let gx = Math.floor((x0 - T.busca) / C); gx <= Math.floor((x1 + T.busca) / C); gx++) {
        const h = semear(ctx.seed ^ 0x51710, gx, gz, T.sal);
        if (h / U32 >= T.chance) continue;
        const h2 = semear(h, 1), h3 = semear(h, 2);
        const m = Math.min(T.busca, Math.floor(C / 4));
        const px = gx * C + m + (h2 % Math.max(1, C - 2 * m)), pz = gz * C + m + (h3 % Math.max(1, C - 2 * m));
        if (px < x0 - T.busca || px > x1 + T.busca || pz < z0 - T.busca || pz > z1 + T.busca) continue;
        let melhor = null, n = 0;
        for (const [qx, qz] of espiral(px, pz, T.busca, T.passo || 4)) {
          const s = T.podeNascer(ctx, qx, qz, null);
          if (!s) continue;
          if (!melhor || (s.nota || 0) > (melhor.nota || 0)) melhor = s;
          if (++n >= (T.melhorDe || 1)) break;
        }
        if (melhor) out.push({ ...melhor, celula: [gx, gz] });
      }
    }
  }
  return out;
}

// Texto curto de onde fica, para o chat: "a 140 m a nordeste".
export function rumoTexto(de, para) {
  const dx = para[0] - de[0], dz = para[2] - de[2], d = Math.round(Math.sqrt(dx * dx + dz * dz));
  if (d < 3) return 'aqui';
  const ns = dz < -Math.abs(dx) * 0.41 ? 'norte' : dz > Math.abs(dx) * 0.41 ? 'sul' : '';
  const lo = dx > Math.abs(dz) * 0.41 ? 'leste' : dx < -Math.abs(dz) * 0.41 ? 'oeste' : '';
  const DUPLO = { 'norte leste': 'nordeste', 'norte oeste': 'noroeste', 'sul leste': 'sudeste', 'sul oeste': 'sudoeste' };
  const rumo = ns && lo ? DUPLO[ns + ' ' + lo] : ns || lo;
  return `a ${d} m a ${rumo}`;
}

export { B, MOLDE_OK, MINI_OK, miniState };
