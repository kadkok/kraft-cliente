// LAVRA — cais da balsa (pedido do Kadmus, 19/11/2026: "podemos criar um cais em cada ilha e uma balsa com npc
// fazendo o trajeto todos os dias"). O cais é feito de blocos pelo próprio gerador de terreno, a partir da ficha
// gravada no mapa do mundo — não é edição de ninguém: nasce igual no servidor e em todo aparelho, e quem joga pode
// reformar ou enfeitar por cima como faz com qualquer chão.
//
// Ficha (dado puro; quem escolhe o lugar é tools/ilhas/criar.mjs): [x, z, dir, L]
//   x, z   primeira célula do passadiço sobre a água (o chão de areia encosta nela no mesmo nível)
//   dir    para onde ele aponta, mar adentro: 0 = +X · 1 = −X · 2 = +Z · 3 = −Z
//   L      comprimento do passadiço (células) até a cabeça do cais
// Forma, no eixo t (mar adentro) e a (de lado): passadiço de 5 de largura; cabeça de 10 × 13 com abrigo coberto de um
// lado; estacas de madeira até o fundo; postes de tronco com lanterna. A balsa encosta de ponta na face do mar da cabeça.
import { SEA } from './constants.js';
import { B } from './blocks.js';

export const CAIS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const CAIS = { deck: SEA + 1, meia: 2, cabeca: 10, meiaCabeca: 6, recuo: 4 };
export const CAIS_ESTILOS = Object.freeze({
  padrao: Object.freeze({ nome: 'cais padrão' }),
  selvagem: Object.freeze({ nome: 'cais selvagem tropical', arco: true, copaAbrigo: true, jardineiras: true }),
});
const { deck: DY, meia: WA, cabeca: HC, meiaCabeca: WH, recuo: RE } = CAIS;

export function caisValido(c) {
  return Array.isArray(c) && c.length >= 4 && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[2] >= 0 && c[2] <= 3 && c[3] >= 8 && c[3] <= 160;
}
// ponto do mundo de uma posição (t, a) do cais
export function caisPonto(c, t, a) { const d = CAIS_DIRS[c[2]]; return [c[0] + d[0] * t - d[1] * a, c[1] + d[1] * t + d[0] * a]; }
// caixa (em células do mundo) que o cais ocupa: [x0, z0, x1, z1]
export function caisCaixa(c) {
  const p = [caisPonto(c, -RE, -WH - 1), caisPonto(c, -RE, WH + 1), caisPonto(c, c[3] + HC, -WH - 1), caisPonto(c, c[3] + HC, WH + 1)];
  return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
}
// onde a balsa para: centro do casco quando encostada (meio comprimento `meio`), e o rumo do cais (unitário, mar adentro)
export function caisAtracacao(c, meio) {
  const d = CAIS_DIRS[c[2]], t = c[3] + HC - 0.5 + 0.15 + meio;      // 15 cm entre a face do cais e a ponta do casco
  return { x: c[0] + 0.5 + d[0] * t, z: c[1] + 0.5 + d[1] * t, dx: d[0], dz: d[1], y: DY + 1 };
}
// ponto de espera na cabeça do cais (para o letreiro, o mapa e o /ilha): [x, y, z]
export function caisEspera(c) { const [x, z] = caisPonto(c, c[3] + 3, 0); return [x + 0.5, DY + 1, z + 0.5]; }

// Carimba o pedaço do cais que cai nas colunas [x0, x0+15] × [z0, z0+15]. set(x, y, z, bloco) escreve no pedaço;
// alt(x, z) = altura do terreno naquela coluna (para as estacas descerem até o fundo).
// tema (opcional): 'selvagem' ganha arco tropical na entrada, cobertura de folhas no abrigo e jardineiras.
export function carimbaCais(c, x0, z0, set, alt, tema = null) {
  const cx = caisCaixa(c);
  if (cx[2] < x0 || cx[0] > x0 + 15 || cx[3] < z0 || cx[1] > z0 + 15) return;
  const selv = (tema || c[4]) === 'selvagem';
  const L = c[3], fim = L + HC - 1;
  const poe = (t, a, y, b) => {
    const [x, z] = caisPonto(c, t, a);
    if (x >= x0 && x <= x0 + 15 && z >= z0 && z <= z0 + 15) set(x, y, z, b);
  };
  for (let t = -RE; t <= fim; t++) {
    const naCabeca = t >= L, w = naCabeca ? WH : WA;
    for (let a = -w; a <= w; a++) {
      const [x, z] = caisPonto(c, t, a);
      if (x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
      const h = alt(x, z);
      if (h >= DY) {                                       // areia mais alta que o passadiço: fica como está (só abre o caminho)
        if (h > DY && h <= DY + 2 && Math.abs(a) <= WA) for (let y = DY + 1; y <= h; y++) set(x, y, z, B.AIR);
        if (h > DY && Math.abs(a) <= WA) set(x, DY, z, B.SAND);
        continue;
      }
      const borda = Math.abs(a) === w || (naCabeca && (t === L && Math.abs(a) > WA || t === fim));
      set(x, DY, z, borda ? B.PINE_PLANKS : B.PLANKS);
      for (let y = DY + 1; y <= DY + 5; y++) set(x, y, z, B.AIR);
      // estacas: nas bordas, de 4 em 4 (e nos cantos da cabeça)
      const canto = naCabeca && Math.abs(a) === WH && (t === L || t === fim);
      const estaca = canto || (Math.abs(a) === w && ((t % 4) + 4) % 4 === 0) || (naCabeca && (t === L || t === fim) && a % 4 === 0 && Math.abs(a) > WA);
      if (estaca) {
        // debaixo d'água a estaca é cubo cheio (tábua escura): o tronco redondo deixaria a água desenhar uma caixa em volta
        for (let y = Math.max(1, h + 1); y < DY; y++) set(x, y, z, B.PINE_PLANKS);
        // poste com lanterna: nos cantos da cabeça e, no passadiço, de 8 em 8 alternando o lado
        const lanterna = canto || (!naCabeca && ((t % 8) + 8) % 8 === (a > 0 ? 0 : 4));
        if (lanterna && t >= 0) { set(x, DY + 1, z, B.LOG); set(x, DY + 2, z, B.LOG); set(x, DY + 3, z, B.LAMP); }
        else if (naCabeca && t === fim && Math.abs(a) === 4) set(x, DY + 1, z, B.LOG);        // cabeço de amarração
      }
    }
  }
  // portal tropical de entrada na Ilha Selvagem (arco em t = 0, vão livre até DY + 3 no meio)
  if (selv) {
    for (const a of [-WA, WA]) {
      for (let y = DY + 1; y <= DY + 4; y++) poe(0, a, y, B.LOG);
      poe(0, a, DY + 3, B.LAMP);
      poe(1, a, DY + 4, B.LEAVES);
    }
    for (let a = -WA; a <= WA; a++) {
      if (Math.abs(a) < WA) poe(0, a, DY + 4, B.LOG);
      poe(0, a, DY + 5, B.LEAVES);
    }
    // jardineiras tropicais na lateral livre da cabeça do cais
    poe(L + 2, WH - 1, DY + 1, B.GRASS); poe(L + 2, WH - 1, DY + 2, B.FERN);
    poe(L + 4, WH - 1, DY + 1, B.GRASS); poe(L + 4, WH - 1, DY + 2, B.FLOWER_RED);
  }
  // abrigo de espera, de um lado da cabeça: quatro esteios e um telhado baixo com beiral
  const ta = L + 1, tb = L + 6, aa = -WH, ab = -WH + 4;
  for (let t = ta - 1; t <= tb + 1; t++) for (let a = aa - 1; a <= ab + 1; a++) {
    const [x, z] = caisPonto(c, t, a);
    if (x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
    const esteio = (t === ta || t === tb) && (a === aa || a === ab);
    if (esteio) for (let y = DY + 1; y <= DY + 3; y++) set(x, y, z, B.LOG);
    const beiral = t < ta || t > tb || a < aa || a > ab;
    set(x, beiral ? DY + 4 : DY + 5, z, B.ROOF);
    if (selv) set(x, beiral ? DY + 5 : DY + 6, z, B.LEAVES);                                 // cobertura de folhas sobre o abrigo selvagem
    if (!beiral && (t === ta || t === tb || a === aa || a === ab)) set(x, DY + 4, z, B.ROOF);
    if (!beiral && t === ((ta + tb) >> 1) && a === ((aa + ab) >> 1)) set(x, DY + 4, z, B.LAMP);
    if (!beiral && a === aa && t > ta && t < tb) set(x, DY + 1, z, B.PINE_PLANKS);            // banco encostado no fundo
  }
}
