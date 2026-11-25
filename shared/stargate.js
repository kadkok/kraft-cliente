// LAVRA — portal secreto (stargate) do Karlion (pedido do Kadmus, 23/11/2026): um anel do modo GM na ilhota dele
// vira uma escolha de destino, para qualquer ilha real do mapa (a principal e as temáticas do world.json →
// mapa). Nada é posto no mundo: o anel é o mesmo do modo GM (shared/gm.js → anel), só muda o que acontece ao cruzar
// o lado que está na ilhota. Quem decide a viagem é o servidor (server/stargate.js); o aparelho só mostra a lista.
//
// Contrato: STARGATES[slug do mundo] = [{ id, zona: [x, z, r] }] — a zona é a ilhota (círculo no plano, em metros).
// O portal ADOTA o primeiro lado de anel do modo GM (gmPortais, Painel GM → Anéis) que estiver dentro da zona: o GM
// escolhe o ponto exato e o portal segue o anel. Sem anel na zona, não há portal; se o GM apagar o anel, ele some junto.
// Assim nada é posto no mundo por este código e nenhuma construção é tocada.
import { SOLID, LEVEL, B } from './blocks.js';
import { SEA } from './constants.js';

// Ilhota do Karlion (23/11): círculos protegidos (504, 24) e (520, 24) de world.json → mapa.proteger, o construto de
// vidro azul (x 498–514, z 16–34) e o anel que ele tinha em (532, 51, 27).
export const STARGATES = Object.freeze({
  principal: Object.freeze([Object.freeze({
    id: 'karlion-ilhota', zona: Object.freeze([516, 27, 40]),
    // entrada física (pedido do Kadmus, 23/11 ~01h40 de Brasília): o servidor planta UMA vez o par de anéis do modo GM
    // com a entrada ao lado do construto de vidro azul (532, 51, 27: a pegada do anel antigo) e a volta na praia da
    // Ilha Principal (297, -105, perto do cais, sem nenhuma construção em volta). Ver server/stargate.js → garantir().
    entrada: Object.freeze([532, 27]), volta: Object.freeze([297, -105]), nome: 'Stargate',
  })]),
});

export const SG = Object.freeze({
  oferta: 45000,     // ms em que a lista recebida vale (depois disso o servidor recusa a escolha)
  perto: 2,          // m do centro do vão: quem escolhe precisa continuar dentro do anel
  sair: 4.5,         // m: depois de recusar, a lista só volta quem sair do anel e entrar de novo
  intervalo: 3000,   // ms entre duas viagens da mesma pessoa
  raioBusca: 6,      // m em volta do cais para achar chão seguro, se o ponto de espera estiver ocupado
});

export function stargateDe(slug) { return STARGATES[slug] || []; }

const RUIM = new Set([B.MAGMA, B.CACTUS].filter((v) => Number.isInteger(v)));

// chão seguro: sólido embaixo (sem magma nem cacto), pés e cabeça livres e sem líquido, acima do mar.
// get(x, y, z) = bloco já com as edições de quem joga.
export function pisoSeguro(get, x, y, z) {
  if (y <= SEA) return false;
  const chao = get(x, y - 1, z), pe = get(x, y, z), cab = get(x, y + 1, z);
  return SOLID[chao] === 1 && !RUIM.has(chao) && !LEVEL[chao]
    && SOLID[pe] !== 1 && !LEVEL[pe] && SOLID[cab] !== 1 && !LEVEL[cab];
}

// Procura em volta de [px, py, pz] (ponto de pé, y = bloco dos pés): primeiro a mesma coluna (±4), depois anéis de
// raio crescente. Devolve [x + .5, y, z + .5] ou null. Só lê; não muda nada no mundo.
export function chegadaSegura(get, p, raio = SG.raioBusca) {
  const x0 = Math.floor(p[0]), y0 = Math.floor(p[1]), z0 = Math.floor(p[2]);
  for (let r = 0; r <= raio; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const x = x0 + dx, y = y0 + dy, z = z0 + dz;
        if (pisoSeguro(get, x, y, z)) return [x + 0.5, y, z + 0.5];
      }
    }
  }
  return null;
}
