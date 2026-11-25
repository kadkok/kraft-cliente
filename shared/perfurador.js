// Perfurador de terreno. A fatia é pura: o miolo vira ar, o casco e a tampa da frente
// viram o bloco escolhido. A tampa fecha a água que está adiante; o que fica fora do
// casco não entra na lista. Quem aplica grava em silêncio, sem acordar a lei da água.
import { B, KIND, K_CROSS, K_LIQUID, LEVEL, SOLID } from './blocks.js';
import { Y_TOP } from './constants.js';

const VIZ = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const chave = (p) => p[0] + ',' + p[1] + ',' + p[2];

export function revestimentoValido(id) {
  id = id | 0;
  if (id <= 0 || id === B.AIR || id === B.BEDROCK) return false;
  if (LEVEL[id] > 0 || KIND[id] === K_CROSS || KIND[id] === K_LIQUID) return false;
  return SOLID[id] === 1;
}

function celulas(cx, cy, cz, eixo, forma, raio) {
  const ua = (eixo + 1) % 3, va = (eixo + 2) % 3, r2 = raio * raio, out = [];
  for (let u = -raio; u <= raio; u++) for (let v = -raio; v <= raio; v++) {
    const dentro = forma === 'redondo' ? u * u + v * v <= r2 : Math.max(Math.abs(u), Math.abs(v)) <= raio;
    if (!dentro) continue;
    const p = [cx, cy, cz];
    p[ua] += u; p[va] += v;
    out.push(p);
  }
  return out;
}

// Uma fatia. `anterior` são as chaves do miolo já aberto (a curva não tapa o que ficou para trás).
export function planejarFatia(o) {
  const forma = o?.forma === 'redondo' || o?.forma === 'quadrado' ? o.forma : null;
  const raio = o?.raio | 0;
  if (!forma) return { ok: false, erro: 'Forma: quadrado ou redondo.' };
  if (raio < 1 || raio > 10) return { ok: false, erro: 'Raio de 1 a 10.' };
  if (!revestimentoValido(o.bloco)) return { ok: false, erro: 'Esse bloco não veda o túnel. Escolha um bloco sólido ou vidro.' };
  const eixo = o.eixo | 0;
  if (eixo < 0 || eixo > 2) return { ok: false, erro: 'Eixo inválido.' };
  const sinal = o.sinal >= 0 ? 1 : -1;
  const c = [o.cx | 0, o.cy | 0, o.cz | 0];
  const passo = [0, 0, 0]; passo[eixo] = sinal;
  const miolo = celulas(c[0], c[1], c[2], eixo, forma, raio);
  const tampa = celulas(c[0] + passo[0], c[1] + passo[1], c[2] + passo[2], eixo, forma, raio);
  const tras = celulas(c[0] - passo[0], c[1] - passo[1], c[2] - passo[2], eixo, forma, raio);
  const dentro = new Set(miolo.map(chave));
  const frente = new Set(tampa.map(chave));
  const atras = new Set();
  for (const s of o.anterior || []) atras.add(s);
  // A boca em ar continua aberta. Água encostada na boca entra no casco: vira revestimento
  // e o mar um bloco além dela não é acordado.
  const molhada = (p) => {
    if (typeof o.get !== 'function') return false;
    const id = o.get(p[0], p[1], p[2]);
    return id > 0 && LEVEL[id] > 0;
  };
  for (const p of tras) {
    const s = chave(p);
    if (atras.has(s) || molhada(p)) continue;
    atras.add(s);
  }
  const ceu = o.ceu === true && eixo !== 1;
  const casco = [], visto = new Set();
  for (const p of miolo) for (const d of VIZ) {
    if (ceu && d[1] === 1) continue;
    const q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]], s = chave(q);
    if (dentro.has(s) || frente.has(s) || atras.has(s) || visto.has(s)) continue;
    visto.add(s); casco.push(q);
  }
  const mudancas = [];
  for (const p of casco) mudancas.push([p[0], p[1], p[2], o.bloco]);
  for (const p of tampa) mudancas.push([p[0], p[1], p[2], o.bloco]);
  for (const p of miolo) mudancas.push([p[0], p[1], p[2], B.AIR]);
  if (ceu && typeof o.get === 'function') {
    const cols = new Map();
    for (const p of miolo) {
      const s = p[0] + ',' + p[2];
      const y = cols.get(s);
      if (y === undefined || p[1] > y) cols.set(s, p[1]);
    }
    const proteger = typeof o.proteger === 'function' ? o.proteger : () => false;
    for (const [s, y0] of cols) {
      const [x, z] = s.split(',').map(Number);
      let ar = 0;
      for (let y = y0 + 1; y < Y_TOP - 1 && ar < 3; y++) {
        const id = o.get(x, y, z);
        if (id === B.BEDROCK) break;
        if (!(id > 0) || id === B.AIR) { ar++; continue; }
        if (proteger(x, y, z, id)) break;
        ar = 0;
        mudancas.push([x, y, z, B.AIR]);
      }
    }
  }
  return { ok: true, mudancas, miolo: miolo.map(chave), ceu };
}

// Ar debaixo de um teto, abaixo do mar: a vista fica seca e o vidro mostra a água do lado de fora.
export function bolsaoSeco(get, x, y, z, sea) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  if (iy > sea) return false;
  const b = get(ix, iy, iz);
  if (!(b >= 0) || (b > 0 && LEVEL[b] > 0)) return false;
  for (let yy = iy + 1; yy <= sea + 1; yy++) {
    const t = get(ix, yy, iz);
    if (t !== B.AIR && !(t > 0 && (KIND[t] === K_CROSS || LEVEL[t] > 0))) return true;
  }
  return false;
}
