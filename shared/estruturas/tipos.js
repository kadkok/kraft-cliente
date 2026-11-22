// Kraft — catálogo das estruturas raras (shared/estruturas.js). Ordem = ordem da lista do comando /estrutura.
import { CACHOEIRA } from './cachoeira.js';
import { MATA } from './mata.js';
import { CATEDRAL } from './catedral.js';
import { RUINAS } from './ruinas.js';
import { CAMARA } from './camara.js';

export const TIPOS = Object.freeze([CACHOEIRA, MATA, CATEDRAL, RUINAS, CAMARA]);
export const TIPO = Object.freeze(Object.fromEntries(TIPOS.map((t) => [t.chave, t])));
