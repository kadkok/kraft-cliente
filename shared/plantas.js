// LAVRA — plantas com corpo 3D (pedido do Kadmus, 17/11/2026: "redesenhe toda a vida natural vegetal que ainda não
// está tridimensional, nada deve ser sem corpo 3d").
//
// Antes, capim, samambaia, flores, arbusto seco e junco eram dois planos cruzados com uma foto (planta em X). Agora o
// mesher NÃO gera esses planos para os ids abaixo: ele devolve, por pedaço, a lista `plants` (Float32Array, PASSO
// números por planta) e quem desenha (render/plantas3d.js) monta um corpo de verdade em cada lugar.
//
// Contrato da lista (coordenadas LOCAIS do pedaço, x e z de 0 a 16):
//   [x, yChao, z, id, luz, andares]   x/z = canto da célula; yChao = altura exata do chão sob a planta (acompanha
//   rampa); id = bloco; luz = céu | (lâmpada << 4), como no mesher; andares = quantas células da mesma planta estão
//   empilhadas a partir desta (1 = só ela). As células de cima de uma pilha não entram (a de baixo já as conta).
// A célula continua sendo o bloco de sempre: colisão (nenhuma), quebrar, soltar item e as leis do mundo não mudam.
import { B } from './blocks.js';

export const PASSO_PLANTA = 6;

// id → tipo de corpo (render/plantas3d.js tem um construtor por tipo)
export const PLANTA_3D = {
  [B.TALL_GRASS]: 'capim',
  [B.FERN]: 'samambaia',
  [B.FLOWER_YELLOW]: 'flor_amarela',
  [B.FLOWER_RED]: 'flor_vermelha',
  [B.FLOWER_BLUE]: 'flor_azul',
  [B.FLOWER_WHITE]: 'flor_branca',
  [B.DRY_SHRUB]: 'arbusto_seco',
  [B.REEDS]: 'taboa',
};

// tabela rápida para o mesher (1 = vira corpo 3D)
export const PLANTAS_3D_LIGADAS = true;    // liga depois de conferido pelos olhos (desligado = planos em X de antes)
export const E_PLANTA_3D = new Uint8Array(256);
if (PLANTAS_3D_LIGADAS) for (const k in PLANTA_3D) E_PLANTA_3D[k] = 1;
