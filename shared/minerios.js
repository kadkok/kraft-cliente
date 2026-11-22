// Kraft — minérios e pedras preciosas: onde nascem, quão raros são e quanto valem (19/11/2026, pedido do Kadmus: "a
// terra deve ser mais sólida, rios subterrâneos, o dobro de profundidade atual… minérios e pedras preciosas raros e
// caros"). Dado puro: o gerador (worldgen.js) lê as faixas; a troca com os comerciantes, quando existir, lê o VALOR.
//
// Acima de y 0 o gerador continua EXATAMENTE como antes (os veios de sempre, onde já pode haver túnel de jogador). Abaixo
// de 0 — o subsolo novo da profundidade em dobro, onde ninguém cavou (ninguém editava abaixo de y 1) — valem as
// FAIXAS_FUNDO: quanto mais fundo, mais raro e mais valioso. As pedras preciosas só nascem lá embaixo.
//
// Valor em moedas de COBRE, a mesma unidade de shared/tesouros.js (1 prata = 10, 1 ouro = 100). A pedra BRUTA (o bloco
// minerado) vale metade da gema lapidada que ela vira (`ligarPedraBruta`: safira 160, esmeralda 220, rubi 320, diamante
// 480 em tesouros.js). A ordem de raridade segue a de valor: safira < esmeralda < rubi < diamante.
//
// Contrato para quem desenha (Astra): rocha profunda e pedras brutas usam hoje camadas EMPRESTADAS (ver blocks.js:
// `shadow_stone`, `phantom_crystal`, `crystal_ore`, com brilho próprio por `emit`). Camadas próprias pedidas, todas na
// classe 0 (sem tinta, antes de `grass_side`; a ordem das classes não pode mudar): deep_stone, sapphire_ore,
// emerald_ore, ruby_ore, diamond_ore. Trocar a camada é só trocar o `tex` do bloco: o id não muda.
import { B } from './blocks.js';
import { ligarPedraBruta } from './tesouros.js';

export const VALOR = Object.freeze({
  [B.COAL_ORE]: 1, [B.COPPER_ORE]: 2, [B.IRON_ORE]: 4, [B.GOLD_ORE]: 25, [B.CRYSTAL_ORE]: 30,
  [B.SAPPHIRE_ORE]: 80, [B.EMERALD_ORE]: 110, [B.RUBY_ORE]: 160, [B.DIAMOND_ORE]: 240,
  [B.DEEP_STONE]: 0,
});
export const valorDe = (id) => VALOR[id] || 0;

// Pedras preciosas brutas (blocos) e a gema lapidada que cada uma vira (shared/tesouros.js).
export const PRECIOSAS = Object.freeze([B.SAPPHIRE_ORE, B.EMERALD_ORE, B.RUBY_ORE, B.DIAMOND_ORE]);
export const GEMA_DA_PEDRA = Object.freeze({ [B.SAPPHIRE_ORE]: 'safira', [B.EMERALD_ORE]: 'esmeralda', [B.RUBY_ORE]: 'rubi', [B.DIAMOND_ORE]: 'diamante' });
for (const id of PRECIOSAS) ligarPedraBruta(id, GEMA_DA_PEDRA[id]);

// Veios do subsolo novo (y < 0): no máximo um por célula de 8×8×8, como os de cima, mas com um sorteio PRÓPRIO (outra
// semente) e com a tabela da faixa em que cai o centro do veio. Cada linha: [bloco, chance por célula, raio base] — o
// raio cresce até +0,63 pelo sorteio; d² < raio² com y valendo 1,4. A soma das chances de cada faixa cai com a fundura
// (menos minério) enquanto o valor sobe. Medido em tests/profundidade.test.js (blocos por milhão de rocha, por faixa).
export const FAIXAS_FUNDO = Object.freeze([
  { y0: -20, y1: -1, veios: Object.freeze([
    [B.GOLD_ORE, 0.020, 1.2], [B.IRON_ORE, 0.100, 1.6], [B.COPPER_ORE, 0.070, 1.6], [B.COAL_ORE, 0.050, 1.8]]) },
  { y0: -40, y1: -21, veios: Object.freeze([
    [B.SAPPHIRE_ORE, 0.004, 0.70], [B.CRYSTAL_ORE, 0.022, 1.30], [B.GOLD_ORE, 0.045, 1.30], [B.IRON_ORE, 0.035, 1.40]]) },
  { y0: -61, y1: -41, veios: Object.freeze([
    [B.DIAMOND_ORE, 0.0015, 0.60], [B.RUBY_ORE, 0.0028, 0.65], [B.EMERALD_ORE, 0.0045, 0.65], [B.SAPPHIRE_ORE, 0.0070, 0.70],
    [B.CRYSTAL_ORE, 0.0250, 1.20], [B.GOLD_ORE, 0.0180, 1.10]]) },
]);
export function faixaDe(y) { for (const f of FAIXAS_FUNDO) if (y >= f.y0 && y <= f.y1) return f; return null; }
