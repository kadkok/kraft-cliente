import { SKINS_JOGO } from './skin-atlas.js';
import { normalizarCriador } from './criador.js';

const cor = (value, fallback = '') => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : fallback;
const limite = (value, min, max, fallback = 0) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export const PECAS_EXPLORADOR = {
  cabelo: 'Cabelo', jaqueta: 'Jaqueta', luvas: 'Luvas', botas: 'Botas', mochila: 'Mochila'
};
export const CAMADAS_SKIN = ['frente', 'costas', 'rosto'];

// Receita da skin na rede e no world.json (o servidor passa tudo por aqui antes de guardar ou publicar):
//   base:    { id, slim }  id = uma skin do jogo (SKINS_JOGO) ou um PNG enviado ao mundo (<20 hex>.png), conferido
//                          por `conferirBase` (no servidor: arquivo existe em files/, é PNG, quadrado, 64–1024)
//   criador: receita do "monte o seu" (shared/criador.js)
//   camisa, traje, frente, costas, rosto, gm: o que o estúdio já tinha (estampas, look Explorador, efeitos de GM)
// Ordem de aplicação no boneco: base → criador (corpo, roupas, rosto) → estampas → peças 3D.
export function normalizarBase(raw, conferirBase = () => true) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const jogo = SKINS_JOGO.includes(raw.id);
  if (!jogo && !(/^[a-f0-9]{20}\.png$/.test(raw.id) && conferirBase(raw.id))) return null;
  return { id: raw.id, slim: raw.slim === true };
}

export function normalizarSkin(raw, gmAtivo, existe = () => true, conferirBase = existe) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  function camada(key) {
    const layer = raw[key];
    if (!layer || typeof layer.id !== 'string' || !/^[a-f0-9]{20}\.(webp|jpg|png)$/.test(layer.id) || !existe(layer.id)) return null;
    return {
      id: layer.id,
      x: limite(layer.x, -1, 1), y: limite(layer.y, -1, 1),
      escala: limite(layer.escala, .1, 3, 1),
      giro: limite(layer.giro, -180, 180),
      opacidade: limite(layer.opacidade, 0, 1, 1)
    };
  }
  const gm = raw.gm;
  const traje = Object.fromEntries(Object.keys(PECAS_EXPLORADOR).map((slot) => [slot, raw.traje?.[slot] === true]));
  const regions = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];
  const region = regions.includes(gm?.regiao) || (Object.hasOwn(traje, gm?.regiao) && traje[gm.regiao])
    ? gm.regiao : 'torso';
  return {
    base: normalizarBase(raw.base, conferirBase),
    criador: normalizarCriador(raw.criador),
    camisa: cor(raw.camisa),
    traje: Object.values(traje).some(Boolean) ? traje : null,
    frente: camada('frente'), costas: camada('costas'), rosto: camada('rosto'),
    gm: gmAtivo && gm && typeof gm === 'object' ? {
      brilho: limite(gm.brilho, 0, 1),
      reflexo: limite(gm.reflexo, 0, 1),
      fumaca: limite(gm.fumaca, 0, 1),
      cor: cor(gm.cor, '#81eaff'),
      regiao: region
    } : null
  };
}
