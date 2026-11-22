// LAVRA — modos de jogo, como no Minecraft (pedido do Kadmus, 16/11/2026: "quero que tenha modos de jogo, similar ao
// minecraft"). Puro: o servidor faz valer as regras (server/world.js, server/items.js) e o aparelho de quem joga se
// ajusta a elas (game/modes.js). O modo é de cada pessoa (pelo nome) e cada mundo tem um modo padrão para quem chega.
//
//                 voa   atravessa  quebra             põe                solta item  pega item  leva dano
//   criativo      sim   não        rápido             sem gastar         não         sim        não
//   sobrevivência não   não        no tempo do bloco  gasta da mochila   sim         sim        sim
//   aventura      não   não        não                não                —           sim        sim
//   espectador    sim   sim        não                não                —           não        não
//   gm            sim   sim        rápido             sem gastar         não         sim        não
// Criativo também é o único com paleta infinita, formas livres, obras e obra por área — o GM junta isso ao voo que
// atravessa e some para os outros. A senha do GM não mora aqui: quem entra é o servidor.
// No criativo, como no Minecraft, quebrar não solta item: a coleta é do sobrevivência (e do aventura, ao pegar o que
// outros soltam).
export const MODES = {
  criativo: { nome: 'Criativo', voa: true, atravessa: false, quebra: 'rapido', poe: 'infinito', solta: false, pega: true, dano: false, criativo: true, invisivel: false },
  sobrevivencia: { nome: 'Sobrevivência', voa: false, atravessa: false, quebra: 'tempo', poe: 'mochila', solta: true, pega: true, dano: true, criativo: false, invisivel: false },
  aventura: { nome: 'Aventura', voa: false, atravessa: false, quebra: null, poe: null, solta: true, pega: true, dano: true, criativo: false, invisivel: false },
  espectador: { nome: 'Espectador', voa: true, atravessa: true, quebra: null, poe: null, solta: false, pega: false, dano: false, criativo: false, invisivel: true },
  gm: { nome: 'GM', voa: true, atravessa: true, quebra: 'rapido', poe: 'infinito', solta: false, pega: true, dano: false, criativo: true, invisivel: true, gm: true },
};
export const MODE_IDS = Object.keys(MODES);
// Mundo sem padrão escolhido: criativo (é como o LAVRA sempre foi; /modo-padrao muda o de um mundo).
export const DEFAULT_MODE = 'criativo';
export const rulesOf = (m) => MODES[m] || MODES[DEFAULT_MODE];

// GM com o Modo GM ligado (pedido do Kadmus, 19/11/2026: "eu sou GM, deveria ter todos os blocos disponíveis para
// mim"): constrói como no criativo em qualquer modo — lista inteira de blocos, pôr sem gastar da mochila, formas,
// obras e obra por área. O resto do modo continua valendo: no sobrevivência não voa, leva dano, quebra no tempo do
// bloco e solta item. O espectador não muda (ele não mexe em nada).
const COM_GM = {};
export function rulesFor(mode, gmAtivo) {
  const r = rulesOf(mode);
  if (!gmAtivo || r.criativo || r.invisivel) return r;
  const id = MODES[mode] ? mode : DEFAULT_MODE;
  return COM_GM[id] || (COM_GM[id] = Object.freeze({ ...r, poe: 'infinito', quebra: r.quebra || 'tempo', criativo: true, gm: true }));
}

// Nome escrito por quem joga → id do modo (ou null). Aceita com e sem acento, abreviado, em inglês e os números do
// /gamemode do Minecraft (0 sobrevivência, 1 criativo, 2 aventura, 3 espectador).
const ALIAS = {
  criativo: 'criativo', c: 'criativo', creative: 'criativo', '1': 'criativo', cr: 'criativo',
  sobrevivencia: 'sobrevivencia', s: 'sobrevivencia', survival: 'sobrevivencia', '0': 'sobrevivencia', sobreviver: 'sobrevivencia', so: 'sobrevivencia',
  aventura: 'aventura', a: 'aventura', adventure: 'aventura', '2': 'aventura', av: 'aventura',
  espectador: 'espectador', e: 'espectador', esp: 'espectador', spectator: 'espectador', sp: 'espectador', '3': 'espectador',
  gm: 'gm', g: 'gm', '4': 'gm',
};
export function parseMode(text) {
  const k = String(text || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ALIAS[k] || null;
}
