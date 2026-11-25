// LAVRA — objetos: itens que não são blocos (pedido do Kadmus, 19/11/2026: no sobrevivência, caçar para comer, criar
// gado, domar, selar e montar). Carne, couro, penas, ovo, leite, corda, sela, faca, lança, arco e flecha.
//
// Na mochila um objeto é como qualquer item: [b, s, n], com b = 0 (ar: bloco nenhum) e s = o número do objeto
// (OBJ_BASE em diante; os estados do Minecraft param em ~12 mil). Não se põe no mundo como bloco: usa-se (come,
// golpeia, arremessa, sela, amarra). Puro: servidor, cliente e testes.
//
//   come      { fome: pontos de fome que repõe (a barra vai de 0 a 20), risco: chance de passar mal (carne crua),
//               cura: tira o enjoo }
//   arma      { dano: pontos de vida que tira de um bicho por golpe, alcance (m), corta (abre ferida: sangra),
//               arremesso: { dano, alcance } (lança) | tiro: { dano, alcance, gasta: objeto } (arco) }
//   lamina    serve para esfolar e cortar a carcaça de bicho grande
//   pilha     quantos iguais por espaço
export const OBJ_BASE = 40000;
const O = (n, nome, extra = {}) => ({ n: OBJ_BASE + n, nome, pilha: 64, ...extra });
export const OBJETOS = {
  // ---- comida ----
  carne_crua: O(1, 'Carne crua', { come: { fome: 3, risco: 0.3 }, assa: 'carne_assada', tipo: 'carne' }),
  carne_assada: O(2, 'Carne assada', { come: { fome: 8 }, tipo: 'carne' }),
  ave_crua: O(3, 'Ave crua', { come: { fome: 2, risco: 0.35 }, assa: 'ave_assada', tipo: 'carne' }),
  ave_assada: O(4, 'Ave assada', { come: { fome: 6 }, tipo: 'carne' }),
  peixe_cru: O(5, 'Peixe cru', { come: { fome: 2, risco: 0.12 }, assa: 'peixe_assado', tipo: 'peixe' }),
  peixe_assado: O(6, 'Peixe assado', { come: { fome: 6 }, tipo: 'peixe' }),
  ovo: O(7, 'Ovo', { come: { fome: 1, risco: 0.1 }, assa: 'ovo_cozido', pilha: 16, tipo: 'ovo' }),
  ovo_cozido: O(8, 'Ovo cozido', { come: { fome: 4 }, pilha: 16, tipo: 'ovo' }),
  leite: O(9, 'Leite', { come: { fome: 3, cura: true }, pilha: 8, tipo: 'leite' }),
  // ---- o que o bicho dá ----
  couro: O(20, 'Couro'),
  pena: O(21, 'Pena'),
  osso: O(22, 'Osso'),
  // ---- o que se faz ----
  corda: O(30, 'Corda'),
  cabresto: O(31, 'Cabresto', { pilha: 4 }),          // para conduzir e amarrar bicho manso
  sela: O(32, 'Sela', { pilha: 1 }),
  racao: O(33, 'Ração', { tipo: 'grao' }),           // capim, flor e semente socados: agrada quem come pasto e grão
  // ---- armas e ferramentas de caça ----
  faca: O(40, 'Faca de pedra', { pilha: 1, arma: { dano: 4, alcance: 2.6, corta: true }, lamina: true }),
  lanca: O(41, 'Lança', { pilha: 1, arma: { dano: 7, alcance: 3.6, corta: true, arremesso: { dano: 9, alcance: 22 } }, lamina: true }),
  arco: O(42, 'Arco', { pilha: 1, arma: { dano: 1, alcance: 2.2, tiro: { dano: 6, alcance: 46, gasta: 'flecha' } } }),
  flecha: O(43, 'Flecha', { arma: { dano: 2, alcance: 2.2, corta: true } }),
};
for (const k in OBJETOS) OBJETOS[k].id = k;
export const OBJ_POR_NUMERO = new Map(Object.values(OBJETOS).map((o) => [o.n, o]));
export const isObj = (b, s) => b === 0 && OBJ_POR_NUMERO.has(s);
export const objDe = (b, s) => (b === 0 ? OBJ_POR_NUMERO.get(s) || null : null);
export const obj = (id) => OBJETOS[id];
// o item de mochila de um objeto: { b: 0, s }
export const itemObj = (id, n = 1) => ({ b: 0, s: OBJETOS[id].n, n });
// A mão vazia também golpeia (pouco) e não corta.
export const MAO = { dano: 1, alcance: 2.4, corta: false };
export const armaDe = (b, s) => objDe(b, s)?.arma || MAO;
