// LAVRA — peles de máquina por assinatura (22/11/2026; pedido do Kadmus: "barcos lindos em 3D polígonos").
// Uma máquina continua sendo uma lista de blocos [x, y, z, id] (casco, assentos, motores, giroscópio, hélices): é ela
// que boia, bate, leva gente e anda pela rede. Quando a lista bate com uma ASSINATURA registrada aqui, o aparelho
// desenha um modelo .glb no lugar dos cubos (src/machines/pele.js). O servidor não sabe de nada disto.
// Módulo puro (sem three): o aparelho, o boneco do Claude (tools/claude-joga.mjs) e os testes leem o mesmo registro.

// FNV-1a de 32 bits sobre os inteiros (4 bytes cada), com um embaralhamento final. `inverso` troca a ordem dos bytes:
// as duas metades da assinatura não erram juntas.
function fnv(semente, valores, inverso) {
  let h = semente >>> 0;
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> ((inverso ? 3 - k : k) * 8)) & 255;
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Canto mínimo, canto máximo e tamanho (em blocos) de uma lista [x, y, z, id].
export function caixaDosBlocos(blocks) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of blocks) for (let i = 0; i < 3; i++) { if (b[i] < min[i]) min[i] = b[i]; if (b[i] > max[i]) max[i] = b[i]; }
  if (!blocks.length) return { min: [0, 0, 0], max: [0, 0, 0], tamanho: [0, 0, 0] };
  return { min, max, tamanho: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1] };
}

// Assinatura de uma lista de blocos: 16 dígitos hexadecimais. Os blocos entram relativos ao canto mínimo e ordenados
// por (y, z, x, id), então NÃO depende da ordem da lista nem de onde a máquina foi montada. Depende do giro: o mesmo
// casco montado virado 90° é outra lista (posições e ids das peças direcionais mudam) e outra assinatura.
export function assinatura(blocks) {
  const { min } = caixaDosBlocos(blocks);
  const l = blocks.map((b) => [b[1] - min[1], b[2] - min[2], b[0] - min[0], b[3]]);
  l.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const v = new Int32Array(1 + l.length * 4);
  v[0] = l.length;
  for (let i = 0; i < l.length; i++) v.set(l[i], 1 + i * 4);
  return fnv(0x811c9dc5, v, false) + fnv(0x9747b28c, v, true);
}

// ---- o registro ------------------------------------------------------------------------------------------------------
// '<assinatura>': { nome, arquivo, comprimento, pos, yaw, canto? }
//   nome         como o barco se chama na dica de quem mira ("<nome> — F pilota")
//   arquivo      o .glb, a partir da raiz do site (public/assets/barcos/)
//   comprimento  metros do MAIOR eixo horizontal do modelo depois de escalado (a escala é uniforme, pela caixa dele)
//   pos [x,y,z]  onde fica o CENTRO DA CAIXA do modelo, nas coordenadas dos blocos do casco, as de
//                tools/barcos/barcos.mjs: x través, y 0 na quilha, z 0 na ponta da proa, proa para −Z.
//                O bloco [x, y, z] ocupa de x a x+1 (idem y e z): o meio de um casco de 28 blocos fica em z = 14.
//   yaw          giro em Y (rad) que deixa a proa do modelo apontando para −Z (0, ±π/2 ou π)
//   canto [x,y,z] (opcional; padrão [0, 0, 0]) o canto mínimo da lista de blocos nessas mesmas coordenadas. A máquina
//                guarda os blocos contados do canto mínimo; `pos − canto` é o ponto dentro dela. Casco que começa em
//                (0, 0, 0) dispensa. Os de barcos.mjs começam em x = −1 (o pesqueiro, com os braços das varas, em −4).
// Para tirar a linha pronta de um casco (assinatura, canto, tamanho):  node tools/barcos/lancar.mjs --ficha
// Subir ou descer o modelo na água = mexer em pos[1]; trocar o modelo = trocar `arquivo` (e conferir yaw e pos).
//
// PROVISÓRIO (22/11): cascos de tools/barcos/barcos.mjs com os modelos crus do Sketchfab (CC-BY; créditos em
// ~/ASSETS/lavra-barcos/sketchfab/glb/_creditos.json), só para provar o mecanismo. Os .glb NÃO estão no git.
// Como saiu cada número: `comprimento` = comprimento do casco de blocos; `yaw` = π porque os três modelos têm a proa
// em +Z (visto em captura de lado e de cima); `pos` = meio do casco em x e z, e em y a linha d'água do casco (medida
// na simulação: ~3,98 / 4,01 / 4,84 acima da quilha) mais a distância, já escalada, do centro da caixa do modelo até a
// linha d'água DELE (lida na pintura do fundo: a 18%, 15% e 14% da altura da caixa, contando de baixo).
export const PELES = {
  // iate.glb: caixa 8,207 × 15,654 × 40,330 → escala 0,694 (fica com 5,7 m de boca; o casco de blocos tem 11)
  f8f5bc8ed2812dff: { nome: 'Iate Aurora', arquivo: '/assets/barcos/iate.glb', comprimento: 28, pos: [4.5, 7.46, 14], yaw: Math.PI, canto: [-1, 0, 0] },
  // mergulho.glb: caixa 4,244 × 8,053 × 19,423 → escala 1,030 (4,4 m de boca; casco de blocos, 9)
  '5d39b4361f2e316e': { nome: 'Mergulhador', arquivo: '/assets/barcos/mergulho.glb', comprimento: 20, pos: [3.5, 6.91, 10], yaw: Math.PI, canto: [-1, 0, 0] },
  // pesqueiro.glb: caixa 422,16 × 618,70 × 847,82 → escala 0,0259 (10,9 m de boca com as boias; casco de blocos, 9)
  '97753120df29ec84': { nome: 'Pesqueiro Marlim', arquivo: '/assets/barcos/pesqueiro.glb', comprimento: 22, pos: [3.5, 10.62, 11], yaw: Math.PI, canto: [-4, 0, 0] },
};

export function peleDe(blocks) {
  if (!blocks || blocks.length < 2) return null;
  return PELES[assinatura(blocks)] || null;
}
