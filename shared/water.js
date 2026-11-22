// LAVRA — lei da água. Código puro e determinístico (servidor, cliente offline e testes).
//
// Cada célula guarda só um byte, então a altura da água é o próprio id do bloco (LEVEL em blocks.js):
// fonte (B.WATER) = 8, água corrente FLOW0 + n = n (1..7), qualquer outra coisa = 0.
//   · FONTE nunca some sozinha. Só quem joga (ou outra lei) tira uma fonte do lugar.
//   · CAIR: debaixo de qualquer água a coluna enche (nível 7). Água sem chão desce em vez de se espalhar.
//   · ESCOAR: água com chão firme embaixo empurra para os 4 lados, perdendo um oitavo a cada bloco. Da fonte saem 7,
//     6, ... até 1 e para: um losango de 7 blocos de raio em chão plano.
//   · ENCHER: do nível do mar para baixo e a céu aberto, a água que chega fica: canal, porto, poço e buraco cavado
//     enchem até o nível do mar, de baixo para cima. Debaixo de teto (caverna, túnel) isso não vale: lá a água só
//     escoa, senão um furo no fundo do mar afogaria o subsolo inteiro. Acima do mar, uma célula com chão e duas fontes
//     vizinhas vira fonte (tanque cheio).
//   · SECAR: quem perde o que a alimentava baixa um nível a cada onda de avaliação até sumir. Não há regra especial para
//     isso: cada célula só olha as vizinhas, e sem fonte por perto ninguém sustenta ninguém.
// O mundo avisa com touch(x, y, z) quando uma célula muda; step() avalia a fila em ordem de chegada (FIFO), com um teto
// de células por passo, e devolve o que mudou. Mesma sequência de touch/step no mesmo mundo, mesmas mudanças.

import { B, KIND, K_CROSS, LEVEL, FLOW0 } from './blocks.js';
import { CUBE, readerShape, shapeHeight } from './surfaces.js';
import { shoreWater, shoreHeightAt } from './water-shore.js';
import { Y_TOP } from './constants.js';

// A rocha-mãe do fundo e o teto do mundo não são avaliados: de `fundo + 1` (createWater; 1 fora do plano de cima, e
// −63 nele desde a profundidade em dobro) até Y_TOP − 2.
const Y_MAX = Y_TOP - 2;
const SX = [1, -1, 0, 0], SZ = [0, 0, 1, -1];                       // os 4 vizinhos horizontais
const NX = [1, -1, 0, 0, 0, 0], NY = [0, 0, 1, -1, 0, 0], NZ = [0, 0, 0, 0, 1, -1];   // os 6 vizinhos

// Altura da superfície da água dentro de uma célula (0..1): com água em cima, a célula está cheia; a fonte fica um
// pouco abaixo da borda do bloco (0,88); a corrente tem um oitavo disso por nível.
export function surfaceOf(b, above) {
  const L = b > 0 ? LEVEL[b] : 0;
  if (!L) return 0;
  return above > 0 && LEVEL[above] > 0 ? 1 : L * 0.11;
}
// O ponto (x, y, z) está dentro d'água? get(x, y, z) lê o mundo (inteiros).
export function wetAt(get, x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z), b = get(fx, fy, fz);
  if(b > 0 && LEVEL[b] > 0)return y - fy < surfaceOf(b, get(fx, fy + 1, fz));
  const shape=readerShape(get,fx,fy,fz);
  if(shape===CUBE || y-fy<=shapeHeight(shape,x-fx,z-fz))return false;
  const water=shoreWater(get,fx,fy,fz,shape);
  return !!water && y-fy<shoreHeightAt(water,x-fx,z-fz);
}

const isFlow = (b) => b > FLOW0 && b <= FLOW0 + 7;
const level = (b) => (b > 0 ? LEVEL[b] : 0);
// recebe água: ar, planta rasteira (a água leva) e a própria água corrente
const open = (b) => b === B.AIR || (b > 0 && (KIND[b] === K_CROSS || isFlow(b)));
// chão firme: o que não recebe água. A fonte entra aqui; o pedaço desconhecido (-1) também, porque é parede.
const firm = (b) => !open(b);

// chave numérica única: x e z em [-1e6, 1e6], y em [-256, 255] (256 + y em 0..511); o maior valor (~2e15) cabe
// inteiro num double (< 2^53)
const key = (x, y, z) => ((x + 1e6) * 2000001 + (z + 1e6)) * 512 + (y + 256);

export function createWater({ get, set, sea = -1e9, budget = 300, fundo = 0 }) {
  const Y_MIN = fundo + 1;
  // fila circular em três vetores tipados (cresce dobrando) + conjunto de chaves para não agendar duas vezes
  let cap = 1024, head = 0, size = 0;
  let qx = new Int32Array(cap), qy = new Int32Array(cap), qz = new Int32Array(cap);
  const queued = new Set();

  function push(x, y, z) {
    if (y < Y_MIN || y > Y_MAX) return;
    const k = key(x, y, z);
    if (queued.has(k)) return;
    queued.add(k);
    if (size === cap) {
      const nx = new Int32Array(cap * 2), ny = new Int32Array(cap * 2), nz = new Int32Array(cap * 2);
      for (let i = 0; i < size; i++) {
        const j = (head + i) % cap;
        nx[i] = qx[j]; ny[i] = qy[j]; nz[i] = qz[j];
      }
      qx = nx; qy = ny; qz = nz; head = 0; cap *= 2;
    }
    const t = (head + size) % cap;
    qx[t] = x; qy[t] = y; qz[t] = z;
    size++;
  }
  const around = (x, y, z) => { for (let i = 0; i < 6; i++) push(x + NX[i], y + NY[i], z + NZ[i]); };

  // o bloco que a célula deve ter agora; devolve o próprio b quando nada muda
  function judge(x, y, z, b) {
    if (b === B.WATER || !open(b)) return b;                 // fonte fica; parede, sólido e desconhecido também
    let lv = 0;
    if (level(get(x, y + 1, z)) > 0) lv = 7;                 // água caindo enche a coluna
    else {
      for (let i = 0; i < 4; i++) {
        const L = level(get(x + SX[i], y, z + SZ[i]));
        if (L > 1 && L - 1 > lv && firm(get(x + SX[i], y - 1, z + SZ[i]))) lv = L - 1;   // sem chão, a água dele desce
      }
    }
    if (firm(get(x, y - 1, z))) {
      // vira fonte: duas fontes enchem o vão entre elas; e, do nível do mar para baixo, a céu aberto, a água que chegou
      // (de cima ou de lado) fica — é o lençol do mar enchendo o que foi cavado
      let src = 0;
      for (let i = 0; i < 4; i++) if (get(x + SX[i], y, z + SZ[i]) === B.WATER) src++;
      if (src >= 2 || (lv > 0 && y <= sea && openSky(x, y, z))) lv = 8;
    }
    if (lv === 8) return B.WATER;
    if (lv > 0) return FLOW0 + lv;
    return isFlow(b) ? B.AIR : b;                            // secou; ar e planta sem água continuam como estavam
  }

  // nada firme entre a célula e o nível do mar? (só ar, planta e água por cima)
  function openSky(x, y, z) {
    for (let yy = y + 1; yy <= sea + 1; yy++) { const b = get(x, yy, z); if (b !== B.AIR && !(b > 0 && (KIND[b] === K_CROSS || LEVEL[b] > 0))) return false; }
    return true;
  }

  function touch(x, y, z) {
    push(x, y, z);
    around(x, y, z);
  }

  function step() {
    const out = [];
    for (let n = 0; n < budget && size > 0; n++) {
      const x = qx[head], y = qy[head], z = qz[head];
      head = (head + 1) % cap; size--;
      queued.delete(key(x, y, z));                           // sai antes de avaliar: pode voltar à fila neste mesmo passo
      const b = get(x, y, z), nb = judge(x, y, z, b);
      if (nb === b) continue;
      set(x, y, z, nb);
      out.push([x, y, z, nb]);
      around(x, y, z);
    }
    return out;
  }

  return { touch, step, pending: () => size };
}
