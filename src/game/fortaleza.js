import { ALTO_MAR, centroValido, foraDoPalacio, naGeleira, oceanoLivre } from '../../shared/fortaleza.js';
import { LEVEL } from '../../shared/blocks.js';

export function posicaoSolo(store, slug) {
  const c = store.get('fortaleza.' + slug, null);
  return centroValido(c) ? c : [...ALTO_MAR];
}
function separar(tabela, antes, destino) {
  const saida = new Map(),
    levar = [],
    fora = new Set();
  function bloco(x, y, z, id) {
    const k = (x >> 4) + ',' + (z >> 4);
    if (!saida.has(k)) saida.set(k, new Map());
    saida.get(k).set((x & 15) + ((z & 15) << 4) + (y << 8), id);
  }
  for (const [k, arr] of Object.entries(tabela)) {
    const [cx, cz] = k.split(',').map(Number);
    for (let j = 0; j < arr.length; j += 2) {
      const i = arr[j],
        v = arr[j + 1],
        x = cx * 16 + (i & 15),
        z = cz * 16 + ((i >> 4) & 15),
        y = i >> 8;
      if (y >= 40 && y <= 159 && naGeleira(antes, x, z)) levar.push([x, y, z, v]);
      else {
        bloco(x, y, z, v);
        if (v && !LEVEL[v] && y >= 40 && naGeleira(destino, x, z)) fora.add(x + ',' + z);
      }
    }
  }
  for (const [x, y, z, v] of levar) bloco(x + destino[0] - antes[0], y, z + destino[1] - antes[1], v);
  return { saida: Object.fromEntries([...saida].map(([k, m]) => [k, [...m].flat()])), fora };
}
export function comandoSolo(texto, { game, world, store, player, ui, startWorld, mapa }) {
  const [_, op, x, z, ...resto] = texto.trim().split(/\s+/);
  const centro = game.gen?.fortaleza;
  const dizer = (m) => ui.toast(m, 6500);
  if (!centro) return dizer('A fortaleza fica na superfície do arquipélago.');
  if (op === 'onde') return dizer('Fortaleza da Solidão: X ' + centro[0] + ', Z ' + centro[1] + '.');
  if (op === 'ir' || op === 'visitar') {
    player.teleport(...foraDoPalacio(centro));
    game.pendingSpawn = false;
    return;
  }
  if (op !== 'mover' || resto.length || ![x, z].every((v) => typeof v === 'string' && /^-?\d+$/.test(v)))
    return dizer('/fortaleza onde · /fortaleza visitar · /fortaleza mover X Z');
  const dest = [Number(x), Number(z)];
  if (!centroValido(dest)) return dizer('Coordenadas fora do mapa.');
  const ed = separar(world.exportEdits(), centro, dest);
  if (!oceanoLivre(game.gen, dest, (X, Z) => ed.fora.has(X + ',' + Z)))
    return dizer('A geleira precisa caber inteira sobre água livre.');
  const minis = separar(world.exportMinis(), centro, dest);
  const p = [...player.pos];
  if (naGeleira(centro, p[0], p[2]) && p[1] >= 40 && p[1] <= 130) {
    p[0] += dest[0] - centro[0];
    p[2] += dest[1] - centro[1];
  }
  store.set('fortaleza.' + game.slug, dest);
  store.set('off.' + game.slug, ed.saida);
  store.set('off.minis.' + game.slug, minis.saida);
  startWorld(game.seed, 0, { mapa, fortaleza: dest });
  world.loadEdits(ed.saida);
  world.loadMinis(minis.saida);
  player.teleport(...p);
  game.pendingSpawn = false;
  dizer('Fortaleza movida para X ' + x + ', Z ' + z + '.');
}
