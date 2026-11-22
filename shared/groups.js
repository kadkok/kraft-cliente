// LAVRA — obras: conjuntos de blocos que passam a se comportar como um só.
//
// Quem constrói abre uma obra, põe os blocos e fecha: dali em diante trocar um troca todos. Uma obra pode conter outras
// (o chão e as paredes são obras; as duas juntas formam a casa) e desagrupar desfaz UMA camada: os blocos e as obras de
// dentro sobem para a obra de fora, ou ficam soltos se não havia nenhuma.
//
// Regras deste módulo (puro: o servidor é o dono, o cliente espelha aplicando as mesmas operações na mesma ordem):
//  - cada bloco pertence diretamente a no máximo uma obra (a mais de dentro); as camadas de fora vêm por `up`;
//  - só obra solta (sem obra de fora) pode entrar noutra: a árvore nunca tem dois pais;
//  - bloco que deixa de existir sai da obra; obra que fica sem bloco e sem obra dentro some, e a de fora confere a si mesma.

export const GROUP_MAX_CELLS = 4096;   // blocos diretos numa obra
export const GROUP_MAX = 2000;         // obras por plano
export const GROUP_MAX_DEPTH = 8;      // camadas, contando a de fora
export const GROUP_MAX_KIDS = 64;      // obras diretamente dentro de outra
export const GROUP_SET_MAX = 8192;     // blocos trocados de uma vez (a obra e tudo o que há dentro dela)

export const cellKey = (x, y, z) => x + ',' + y + ',' + z;

export function createGroups() {
  const byId = new Map();     // id -> { id, up, name, by, cells: Map(chave -> [x, y, z]), kids: Set(id) }
  const byCell = new Map();   // chave -> id da obra mais de dentro que contém o bloco

  const get = (id) => byId.get(id) || null;
  // a obra mais de dentro que contém o bloco (0 = nenhuma)
  const at = (x, y, z) => byCell.get(cellKey(x, y, z)) || 0;
  // da obra para fora: [ela, a que a contém, ...]
  function chain(id) {
    const out = [];
    for (let g = byId.get(id), n = 0; g && n < 64; g = byId.get(g.up), n++) out.push(g.id);
    return out;
  }
  const root = (id) => { const c = chain(id); return c.length ? c[c.length - 1] : 0; };
  // quantas camadas há da obra para dentro (1 = só ela)
  function depth(id, guard = 0) {
    const g = byId.get(id);
    if (!g || guard > 64) return 0;
    let d = 0;
    for (const k of g.kids) d = Math.max(d, depth(k, guard + 1));
    return d + 1;
  }
  // todos os blocos da obra; deep = inclui os das obras de dentro. fn(x, y, z) devolve false para parar.
  function each(id, fn, deep = true, guard = 0) {
    const g = byId.get(id);
    if (!g || guard > 64) return true;
    for (const c of g.cells.values()) if (fn(c[0], c[1], c[2]) === false) return false;
    if (deep) for (const k of g.kids) if (each(k, fn, true, guard + 1) === false) return false;
    return true;
  }
  function count(id, deep = true) { let n = 0; each(id, () => { n++; }, deep); return n; }
  function cells(id, deep = true) { const out = []; each(id, (x, y, z) => { out.push([x, y, z]); }, deep); return out; }

  // Cria a obra `id` com os blocos soltos de `list` ([[x, y, z], ...]; quem já é de outra obra fica de fora) e as obras
  // soltas de `kids`. Devolve a obra, ou null se não sobrou o que agrupar ou passaria de algum limite.
  function add({ id, cells: list = [], kids = [], name = '', by = '' }) {
    if (!Number.isInteger(id) || id <= 0 || byId.has(id) || byId.size >= GROUP_MAX) return null;
    const mine = new Map();
    for (const c of list) {
      if (mine.size >= GROUP_MAX_CELLS) break;
      const k = cellKey(c[0], c[1], c[2]);
      if (!byCell.has(k) && !mine.has(k)) mine.set(k, [c[0], c[1], c[2]]);
    }
    const inner = new Set();
    let deepest = 0;
    for (const kid of kids) {
      const g = byId.get(kid);
      if (!g || g.up || inner.has(kid) || inner.size >= GROUP_MAX_KIDS) continue;
      inner.add(kid);
      deepest = Math.max(deepest, depth(kid));
    }
    // um bloco já é uma obra; só obras exigem pelo menos duas (uma sozinha seria uma camada sem serventia)
    if (mine.size === 0 && inner.size < 2) return null;
    if (deepest + 1 > GROUP_MAX_DEPTH) return null;
    const g = { id, up: 0, name: String(name || ''), by: String(by || ''), cells: mine, kids: inner };
    byId.set(id, g);
    for (const k of mine.keys()) byCell.set(k, id);
    for (const kid of inner) byId.get(kid).up = id;
    return g;
  }

  // Desfaz uma camada: os blocos e as obras de dentro passam para a obra de fora (ou ficam soltos).
  function ungroup(id) {
    const g = byId.get(id);
    if (!g) return null;
    const up = byId.get(g.up) || null;
    for (const [k, c] of g.cells) {
      if (up) { up.cells.set(k, c); byCell.set(k, up.id); } else byCell.delete(k);
    }
    for (const kid of g.kids) {
      const kg = byId.get(kid);
      if (!kg) continue;
      kg.up = up ? up.id : 0;
      if (up) up.kids.add(kid);
    }
    if (up) up.kids.delete(id);
    byId.delete(id);
    return { id, up: up ? up.id : 0 };
  }

  // O bloco deixou de existir: sai da obra. Devolve as obras que sumiram por terem ficado vazias (de dentro para fora).
  function cellGone(x, y, z) {
    const k = cellKey(x, y, z), id = byCell.get(k);
    if (!id) return null;
    byCell.delete(k);
    const dead = [];
    let g = byId.get(id);
    if (g) g.cells.delete(k);
    while (g && g.cells.size === 0 && g.kids.size === 0) {
      const up = byId.get(g.up) || null;
      byId.delete(g.id);
      dead.push(g.id);
      if (up) up.kids.delete(g.id);
      g = up;
    }
    return dead;
  }

  // ---- guardar e carregar: cada obra vira { id, up, name, by, c: [x, y, z, x, y, z, ...] } ----------------------
  const pack = (g) => {
    const c = new Array(g.cells.size * 3);
    let i = 0;
    for (const v of g.cells.values()) { c[i++] = v[0]; c[i++] = v[1]; c[i++] = v[2]; }
    return { id: g.id, up: g.up, name: g.name, by: g.by, c };
  };
  function toJSON() { return [...byId.values()].map(pack); }
  function clear() { byId.clear(); byCell.clear(); }
  // Aceita o que toJSON produziu; o que vier torto (id repetido, pai inexistente, bloco de duas obras) é consertado
  // ou descartado, nunca levado adiante.
  function load(list) {
    clear();
    if (!Array.isArray(list)) return 0;
    for (const o of list) {
      if (!o || !Number.isInteger(o.id) || o.id <= 0 || byId.has(o.id) || byId.size >= GROUP_MAX) continue;
      const g = { id: o.id, up: Number.isInteger(o.up) && o.up > 0 ? o.up : 0, name: String(o.name || ''), by: String(o.by || ''), cells: new Map(), kids: new Set() };
      const c = Array.isArray(o.c) ? o.c : [];
      for (let i = 0; i + 2 < c.length && g.cells.size < GROUP_MAX_CELLS; i += 3) {
        if (!Number.isInteger(c[i]) || !Number.isInteger(c[i + 1]) || !Number.isInteger(c[i + 2])) continue;
        const k = cellKey(c[i], c[i + 1], c[i + 2]);
        if (byCell.has(k)) continue;
        g.cells.set(k, [c[i], c[i + 1], c[i + 2]]);
        byCell.set(k, g.id);
      }
      byId.set(g.id, g);
    }
    for (const g of byId.values()) {
      const up = byId.get(g.up);
      if (!up || up === g || chainLoops(g)) g.up = 0; else up.kids.add(g.id);
    }
    // obra vazia não sobrevive (de dentro para fora)
    for (let again = true; again;) {
      again = false;
      for (const g of [...byId.values()]) {
        if (g.cells.size || g.kids.size) continue;
        const up = byId.get(g.up);
        if (up) up.kids.delete(g.id);
        byId.delete(g.id);
        again = true;
      }
    }
    return byId.size;
  }
  function chainLoops(g) {
    const seen = new Set([g.id]);
    for (let p = byId.get(g.up); p; p = byId.get(p.up)) { if (seen.has(p.id)) return true; seen.add(p.id); }
    return false;
  }

  return {
    get, at, chain, root, depth, each, count, cells, add, ungroup, cellGone, toJSON, load, clear, pack,
    get size() { return byId.size; },
    ids() { return [...byId.keys()]; },
  };
}

// lista plana [x, y, z, ...] -> [[x, y, z], ...], só com números inteiros dentro dos limites dados
export function unflat(flat, ok) {
  const out = [];
  if (!Array.isArray(flat) || flat.length % 3 !== 0) return out;
  for (let i = 0; i < flat.length; i += 3) if (ok(flat[i], flat[i + 1], flat[i + 2])) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}
