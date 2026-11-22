// LAVRA — Mesa de trabalho (3x3), Bancada rápida (2x2 na mochila), Fornalha e blocos interativos (portas, alçapões, portões, barril).
import {
  RECIPES, SMELT_RECIPES, BLOCK_NAME_OF, matchGrid, matchSmelt, fuelYield,
  canCraftRecipe, fillRecipeGrid, maxCraftTimes, recipeIngredientsSummary,
} from '../../shared/crafting.js';
import { MC_BASE, mcEstado, mcNumero } from '../../shared/mc-estados.js';
import { mcNomePt } from '../../shared/mc-nomes.js';
import { IS_MC, mcIdDoEstado } from '../../shared/minis.js';
import { itemName, itemKey } from '../../shared/items.js';
import { h } from '../ui/ui.js';

const CSS = `
.craft-wrap { display: grid; gap: 10px; margin-top: 8px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.12); }
.craft-mini-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.craft-grid { display: grid; gap: 5px; }
.craft-grid.g2 { grid-template-columns: repeat(2, 44px); }
.craft-grid.g3 { grid-template-columns: repeat(3, 48px); }
.craft-slot { position: relative; width: 48px; height: 48px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
  background: linear-gradient(160deg, rgba(22,34,48,.85), rgba(11,18,27,.9)); color: #fff; cursor: pointer;
  display: grid; place-items: center; padding: 3px; }
.craft-grid.g2 .craft-slot { width: 44px; height: 44px; }
.craft-slot:hover { border-color: rgba(244,166,78,.7); }
.craft-slot.sel { border-color: #f4a64e; box-shadow: 0 0 0 2px rgba(244,166,78,.35); }
.craft-slot.out { border-color: rgba(72,201,176,.65); background: linear-gradient(160deg, rgba(18,52,58,.85), rgba(10,28,34,.92)); width: 54px; height: 54px; }
.craft-slot canvas { width: 100%; height: 100%; display: block; pointer-events: none; }
.craft-slot b.qtd { position: absolute; right: 4px; bottom: 2px; font: 700 11px/1 system-ui; color: #fff; text-shadow: 0 1px 2px #000, 0 0 3px #000; pointer-events: none; }
.craft-arrow { font-size: 20px; font-weight: 700; color: rgba(246,242,233,.7); user-select: none; }
.craft-quick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.craft-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 5px; border-radius: 10px;
  border: 1px solid rgba(72,201,176,.45); background: linear-gradient(135deg, rgba(20,56,64,.88), rgba(11,30,38,.92));
  color: #f6f2e9; font-size: 12px; cursor: pointer; }
.craft-chip:hover { border-color: #48c9b0; filter: brightness(1.1); }
.craft-chip canvas { width: 22px; height: 22px; }

#craft-modal { z-index: 40; }
.craft-card { width: min(960px, 95vw); max-height: 90vh; display: grid; gap: 12px; overflow: hidden; }
.craft-head { display: flex; align-items: center; gap: 10px; }
.craft-head h2 { margin: 0; font-size: 20px; flex: 1 1 auto; }
.craft-body { display: grid; grid-template-columns: minmax(280px, 1.05fr) minmax(260px, 1fr); gap: 14px; overflow: hidden; min-height: 0; }
@media (max-width: 760px) { .craft-body { grid-template-columns: 1fr; overflow-y: auto; } }
.craft-col { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.craft-station { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px; border-radius: 14px;
  background: linear-gradient(160deg, rgba(36,52,70,.6), rgba(15,24,35,.72)); border: 1px solid rgba(255,255,255,.12); }
.craft-acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.craft-bag { display: grid; grid-template-columns: repeat(9, minmax(32px, 1fr)); gap: 4px; overflow-y: auto; max-height: 220px; padding: 8px;
  border-radius: 12px; background: rgba(8,14,22,.55); border: 1px solid rgba(255,255,255,.1); }
.craft-bag .craft-slot { width: 100%; height: auto; aspect-ratio: 1; }
.craft-bag .craft-slot.empty { opacity: .35; cursor: default; }
.craft-book { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1 1 auto;
  padding: 10px; border-radius: 14px; background: rgba(8,14,22,.55); border: 1px solid rgba(255,255,255,.1); }
.craft-book-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.craft-book-bar input { flex: 1 1 140px; min-width: 100px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16);
  background: rgba(16,26,38,.85); color: #f6f2e9; font-size: 13px; }
.craft-list { display: grid; gap: 6px; overflow-y: auto; max-height: 360px; padding-right: 4px; }
.craft-rec { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 10px; text-align: left; cursor: pointer;
  border: 1px solid rgba(255,255,255,.12); background: linear-gradient(160deg, rgba(28,42,58,.75), rgba(14,22,32,.85)); color: #f6f2e9; }
.craft-rec.ok { border-color: rgba(72,201,176,.55); }
.craft-rec.miss { opacity: .62; }
.craft-rec:hover { border-color: #f4a64e; }
.craft-rec canvas { width: 32px; height: 32px; flex: 0 0 auto; }
.craft-rec-info { flex: 1 1 auto; min-width: 0; }
.craft-rec-info b { display: block; font-size: 13px; }
.craft-rec-info span { display: block; font-size: 11.5px; color: var(--muted, #c3ccd6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

const GROUPS = [
  ['todos', 'Todas'],
  ['essencial', 'Essencial'],
  ['construcao', 'Construção'],
  ['acabamento', 'Acabamento'],
  ['maquinas', 'Máquinas'],
];

export function initCrafting({ game, world, net, ui, input, interaction, openOverlay, closeOverlay }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  let mode = null;         // 'table' | 'furnace' | null
  let stationPos = null;   // [x, y, z]
  let stationTitle = 'Mesa de trabalho';
  let grid2 = [0, 0, 0, 0];
  let grid3 = new Array(9).fill(0);
  let smeltIn = 0, smeltFuel = 0;
  let picked = null;       // [b, s] selecionado da mochila na tela atual
  let onlyAvail = false;
  let filterGroup = 'todos';
  let searchText = '';

  const drawIcon = (cv, b, s) => {
    if (game.items?.icon) game.items.icon(cv, b, s || 0, cv.width);
  };

  function bagCountOf(b, s) {
    let n = 0;
    for (const e of game.items?.bag?.l || []) if (e && e[0] === b && e[1] === (s || 0)) n += e[2];
    return n;
  }

  function hasGridItems(cells) {
    if (game.modeRules?.criativo) return true;
    const need = new Map();
    for (const c of cells) {
      if (!c) continue;
      const k = itemKey(c[0], c[1] || 0);
      need.set(k, { b: c[0], s: c[1] || 0, n: (need.get(k)?.n || 0) + 1 });
    }
    for (const req of need.values()) if (bagCountOf(req.b, req.s) < req.n) return false;
    return true;
  }

  function sendCraft(cells, size, all = false) {
    if (net.offline) return ui.toast('Fabricação precisa do servidor conectado.');
    if (size === 3 && !stationPos) return;
    net.send({ t: 'craft', size, cells, table: size === 3 ? stationPos : null, all });
    game.audio.play('tick', 0.9, 1.15);
  }

  function sendSmelt(all = false) {
    if (net.offline) return ui.toast('Fornalha precisa do servidor conectado.');
    if (!stationPos || !smeltIn || !smeltFuel) return;
    net.send({ t: 'smelt', input: smeltIn, fuel: smeltFuel, table: stationPos, all });
    game.audio.play('place', 0.8, 0.95);
  }

  // ---- Bancada 2x2 embutida na Mochila (E) --------------------------------------------------------------------------
  const quickRoot = h('div', { class: 'craft-wrap' });
  function renderQuick() {
    const bag = game.items?.bag?.l || [];
    const hit = matchGrid(grid2, 2);
    const can = !!(hit && hasGridItems(grid2));
    const maxN = hit && !game.modeRules?.criativo ? maxCraftTimes(hit.consume, bag) : hit ? 1 : 0;

    const gEl = h('div', { class: 'craft-grid g2' }, grid2.map((c, idx) => {
      const btn = h('button', {
        class: 'craft-slot', type: 'button',
        title: c ? `${BLOCK_NAME_OF(c[0], c[1])} (clique para tirar)` : 'Clique para pôr ou use uma receita abaixo',
        onclick: () => {
          if (c) { grid2[idx] = 0; renderQuick(); return; }
          if (picked) { grid2[idx] = picked.slice(); renderQuick(); }
        },
      });
      if (c) { const cv = h('canvas', { width: 48, height: 48 }); drawIcon(cv, c[0], c[1]); btn.append(cv); }
      return btn;
    }));

    const outBtn = h('button', {
      class: 'craft-slot out', type: 'button', disabled: !can,
      title: hit ? `${hit.recipe.nome} (×${hit.out.n})` : 'Resultado',
      onclick: (e) => { if (can) sendCraft(grid2, 2, e.shiftKey); },
    });
    if (hit) {
      const cv = h('canvas', { width: 52, height: 52 });
      drawIcon(cv, hit.out.b, hit.out.s);
      outBtn.append(cv);
      if (hit.out.n > 1) outBtn.append(h('b', { class: 'qtd', text: String(hit.out.n) }));
    }

    const chips = [];
    for (const r of RECIPES) {
      if (r.size > 2) continue;
      if (!game.modeRules?.criativo && !canCraftRecipe(r, bag)) continue;
      const cv = h('canvas', { width: 32, height: 32 });
      drawIcon(cv, r.out.b, r.out.s);
      chips.push(h('button', {
        class: 'craft-chip', type: 'button', title: `${r.nome} (×${r.out.n}) — clique para fabricar`,
        onclick: (e) => {
          const filled = game.modeRules?.criativo ? fillRecipeGrid(r, [[r.out.b, r.out.s, 1]], 2) : fillRecipeGrid(r, bag, 2);
          if (filled) {
            grid2 = filled;
            sendCraft(grid2, 2, e.shiftKey);
            renderQuick();
          } else {
            // fallback criativo: preencher com ingredientes diretos da receita
            const fake = [];
            for (const s of recipeIngredientsSummary(r)) fake.push([s.b, s.s, 64]);
            const f2 = fillRecipeGrid(r, fake, 2);
            if (f2) { grid2 = f2; sendCraft(grid2, 2, false); renderQuick(); }
          }
        },
      }, cv, `${r.nome}${r.out.n > 1 ? ' ×' + r.out.n : ''}`));
      if (chips.length >= 10) break;
    }

    // Seletor rápido do que está na mochila para preencher o 2x2 manualmente
    const bagPicks = [];
    const seen = new Set();
    for (const e of bag) {
      if (!e) continue;
      const k = itemKey(e[0], e[1]);
      if (seen.has(k)) continue;
      seen.add(k);
      const isSel = picked && picked[0] === e[0] && picked[1] === e[1];
      const cv = h('canvas', { width: 28, height: 28 });
      drawIcon(cv, e[0], e[1]);
      bagPicks.push(h('button', {
        class: 'craft-chip' + (isSel ? ' sel' : ''), type: 'button',
        style: isSel ? 'border-color:#f4a64e;' : '',
        title: `Selecionar ${itemName(e[0], e[1])} para a bancada 2×2`,
        onclick: () => { picked = isSel ? null : [e[0], e[1]]; renderQuick(); },
      }, cv, String(e[2])));
    }

    const els = [
      h('div', { class: 'mochila-topo' },
        h('b', { text: 'Bancada rápida (2×2)' }),
        h('span', { text: hit ? `${hit.recipe.nome} (×${hit.out.n})` : 'Escolha uma receita pronta ou monte no 2×2' })),
      h('div', { class: 'craft-mini-row' },
        gEl,
        h('span', { class: 'craft-arrow', text: '→' }),
        outBtn,
        h('div', { class: 'craft-acts' },
          h('button', { class: 'btn small primary', type: 'button', text: 'Fabricar', disabled: !can, onclick: () => sendCraft(grid2, 2, false) }),
          h('button', { class: 'btn small', type: 'button', text: 'Tudo' + (maxN > 1 ? ` (${maxN})` : ''), disabled: !can || maxN < 1, onclick: () => sendCraft(grid2, 2, true) }),
          h('button', { class: 'btn small', type: 'button', text: 'Limpar', onclick: () => { grid2 = [0, 0, 0, 0]; renderQuick(); } }))),
    ];
    if (chips.length) els.push(h('div', { class: 'craft-quick' }, h('span', { class: 'note', text: 'Prontas:' }), ...chips));
    if (bagPicks.length) els.push(h('div', { class: 'craft-quick' }, h('span', { class: 'note', text: 'Usar na grade:' }), ...bagPicks.slice(0, 12)));
    quickRoot.replaceChildren(...els);
  }

  // ---- Modal da Mesa de Trabalho (3x3) e Fornalha --------------------------------------------------------------------
  const modalCard = h('div', { class: 'card panel craft-card' });
  const modal = h('div', { id: 'craft-modal', class: 'screen veil hide' }, modalCard);
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeOverlay(); });
  document.body.append(modal);

  function renderModal() {
    if (!mode) { modal.classList.add('hide'); return; }
    modal.classList.remove('hide');
    const bag = game.items?.bag?.l || [];
    const creative = !!game.modeRules?.criativo;

    const head = h('div', { class: 'craft-head' },
      h('h2', { text: stationTitle }),
      h('button', { class: 'btn small', type: 'button', text: 'Fechar (Esc)', onclick: () => closeOverlay() }));

    // Grade da mochila para selecionar itens
    const bagEl = h('div', { class: 'craft-bag' }, bag.map((e) => {
      if (!e) return h('button', { class: 'craft-slot empty', type: 'button', disabled: true });
      const isSel = picked && picked[0] === e[0] && picked[1] === e[1];
      const btn = h('button', {
        class: 'craft-slot' + (isSel ? ' sel' : ''), type: 'button',
        title: `${itemName(e[0], e[1])} (${e[2]}) — clique para usar`,
        onclick: () => { picked = isSel ? null : [e[0], e[1]]; renderModal(); },
      });
      const cv = h('canvas', { width: 48, height: 48 });
      drawIcon(cv, e[0], e[1]);
      btn.append(cv, h('b', { class: 'qtd', text: String(e[2]) }));
      return btn;
    }));

    if (mode === 'furnace') {
      const hit = smeltIn ? matchSmelt(smeltIn) : null;
      const fy = smeltFuel ? fuelYield(smeltFuel[0], smeltFuel[1]) : 0;
      const can = !!(hit && fy > 0 && (creative || (bagCountOf(smeltIn[0], smeltIn[1]) >= 1 && bagCountOf(smeltFuel[0], smeltFuel[1]) >= 1)));

      const inBtn = h('button', {
        class: 'craft-slot', type: 'button', title: 'Entrada (clique para pôr/tirar)',
        onclick: () => {
          if (smeltIn && !picked) { smeltIn = 0; renderModal(); return; }
          if (picked && matchSmelt(picked)) { smeltIn = picked.slice(); renderModal(); }
          else if (picked) ui.toast('Esse item não funde na fornalha.', 1800);
        },
      });
      if (smeltIn) { const cv = h('canvas', { width: 48, height: 48 }); drawIcon(cv, smeltIn[0], smeltIn[1]); inBtn.append(cv); }

      const fuelBtn = h('button', {
        class: 'craft-slot', type: 'button', title: 'Combustível: carvão, tronco ou tábuas',
        onclick: () => {
          if (smeltFuel && !picked) { smeltFuel = 0; renderModal(); return; }
          if (picked && fuelYield(picked[0], picked[1]) > 0) { smeltFuel = picked.slice(); renderModal(); }
          else if (picked) ui.toast('Use carvão, tronco ou tábuas como combustível.', 1800);
        },
      });
      if (smeltFuel) { const cv = h('canvas', { width: 48, height: 48 }); drawIcon(cv, smeltFuel[0], smeltFuel[1]); fuelBtn.append(cv); }

      const outBtn = h('button', {
        class: 'craft-slot out', type: 'button', disabled: !can,
        onclick: (e) => { if (can) sendSmelt(e.shiftKey); },
      });
      if (hit) { const cv = h('canvas', { width: 52, height: 52 }); drawIcon(cv, hit.out.b, hit.out.s); outBtn.append(cv); }

      const smeltList = h('div', { class: 'craft-list' }, SMELT_RECIPES.map((r) => {
        const cv = h('canvas', { width: 32, height: 32 });
        drawIcon(cv, r.out.b, r.out.s);
        const haveIn = creative || bag.some((e) => e && (typeof r.input === 'string' ? matchSmelt([e[0], e[1]])?.id === r.id : e[0] === r.input.b && e[1] === (r.input.s || 0)));
        return h('button', {
          class: 'craft-rec ' + (haveIn ? 'ok' : 'miss'), type: 'button',
          onclick: () => {
            const foundIn = bag.find((e) => e && matchSmelt([e[0], e[1]])?.id === r.id);
            smeltIn = foundIn ? [foundIn[0], foundIn[1]] : (typeof r.input === 'object' ? [r.input.b, r.input.s || 0] : [11, 0]);
            if (!smeltFuel) {
              const foundFuel = bag.find((e) => e && fuelYield(e[0], e[1]) > 0);
              if (foundFuel) smeltFuel = [foundFuel[0], foundFuel[1]];
            }
            renderModal();
          },
        }, cv, h('div', { class: 'craft-rec-info' }, h('b', { text: r.nome }), h('span', { text: `Resultado: ${BLOCK_NAME_OF(r.out.b, r.out.s)}` })));
      }));

      modalCard.replaceChildren(
        head,
        h('div', { class: 'craft-body' },
          h('div', { class: 'craft-col' },
            h('div', { class: 'craft-station' },
              h('div', { style: 'display:grid;gap:6px;justify-items:center;' }, inBtn, h('span', { class: 'note', text: 'Entrada' })),
              h('div', { style: 'display:grid;gap:6px;justify-items:center;' }, fuelBtn, h('span', { class: 'note', text: fy ? `Combustível (${fy}×)` : 'Combustível' })),
              h('span', { class: 'craft-arrow', text: '→' }),
              outBtn,
              h('div', { class: 'craft-acts' },
                h('button', { class: 'btn small primary', type: 'button', text: 'Fundir 1', disabled: !can, onclick: () => sendSmelt(false) }),
                h('button', { class: 'btn small', type: 'button', text: 'Fundir tudo', disabled: !can, onclick: () => sendSmelt(true) }))),
            h('span', { class: 'note', text: 'Toque num item da mochila e depois em Entrada ou Combustível (ou escolha uma receita ao lado).' }),
            bagEl),
          h('div', { class: 'craft-col' },
            h('div', { class: 'craft-book' }, h('b', { text: 'Receitas da fornalha' }), smeltList))),
      );
      return;
    }

    // ---- Mesa de trabalho 3x3 ----
    const hit = matchGrid(grid3, 3);
    const can = !!(hit && hasGridItems(grid3));
    const maxN = hit && !creative ? maxCraftTimes(hit.consume, bag) : hit ? 1 : 0;

    const gEl = h('div', { class: 'craft-grid g3' }, grid3.map((c, idx) => {
      const btn = h('button', {
        class: 'craft-slot', type: 'button',
        title: c ? `${BLOCK_NAME_OF(c[0], c[1])} (clique para tirar)` : 'Clique para colocar item selecionado',
        onclick: () => {
          if (c && (!picked || (picked[0] === c[0] && picked[1] === c[1]))) { grid3[idx] = 0; renderModal(); return; }
          if (picked) { grid3[idx] = picked.slice(); renderModal(); }
          else if (c) { grid3[idx] = 0; renderModal(); }
        },
      });
      if (c) { const cv = h('canvas', { width: 48, height: 48 }); drawIcon(cv, c[0], c[1]); btn.append(cv); }
      return btn;
    }));

    const outBtn = h('button', {
      class: 'craft-slot out', type: 'button', disabled: !can,
      title: hit ? `${hit.recipe.nome} (×${hit.out.n})` : 'Resultado',
      onclick: (e) => { if (can) sendCraft(grid3, 3, e.shiftKey); },
    });
    if (hit) {
      const cv = h('canvas', { width: 52, height: 52 });
      drawIcon(cv, hit.out.b, hit.out.s);
      outBtn.append(cv);
      if (hit.out.n > 1) outBtn.append(h('b', { class: 'qtd', text: String(hit.out.n) }));
    }

    const searchInput = h('input', {
      type: 'search', placeholder: 'Buscar receita: porta, vidro, roda, tocha…', value: searchText,
      oninput: (e) => { searchText = e.target.value; renderList(); },
    });
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());

    const listEl = h('div', { class: 'craft-list' });
    const renderList = () => {
      const q = searchText.trim().toLowerCase();
      const rows = [];
      for (const r of RECIPES) {
        if (filterGroup !== 'todos' && r.grupo !== filterGroup) continue;
        if (q && !r.nome.toLowerCase().includes(q)) continue;
        const ok = creative || canCraftRecipe(r, bag);
        if (onlyAvail && !ok) continue;
        const sum = recipeIngredientsSummary(r).map((s) => `${s.n}× ${s.label}`).join(' · ');
        const cv = h('canvas', { width: 32, height: 32 });
        drawIcon(cv, r.out.b, r.out.s);
        rows.push(h('button', {
          class: 'craft-rec ' + (ok ? 'ok' : 'miss'), type: 'button',
          onclick: () => {
            const filled = fillRecipeGrid(r, bag, 3);
            if (filled) { grid3 = filled; renderModal(); return; }
            // prévia mesmo sem todos os materiais
            const previewFake = recipeIngredientsSummary(r).map((s) => [s.b, s.s, 64]);
            grid3 = fillRecipeGrid(r, previewFake, 3) || new Array(9).fill(0);
            renderModal();
            if (!creative) ui.toast(`Faltam materiais: ${sum}`, 2400);
          },
        }, cv, h('div', { class: 'craft-rec-info' },
          h('b', { text: `${r.nome}${r.out.n > 1 ? ' ×' + r.out.n : ''}` }),
          h('span', { text: sum }))));
      }
      if (!rows.length) rows.push(h('span', { class: 'note', text: onlyAvail ? 'Nenhuma receita completa com os itens atuais da mochila.' : 'Nenhuma receita encontrada.' }));
      listEl.replaceChildren(...rows);
    };
    renderList();

    modalCard.replaceChildren(
      head,
      h('div', { class: 'craft-body' },
        h('div', { class: 'craft-col' },
          h('div', { class: 'craft-station' },
            gEl,
            h('span', { class: 'craft-arrow', text: '→' }),
            outBtn,
            h('div', { class: 'craft-acts' },
              h('button', { class: 'btn small primary', type: 'button', text: 'Fabricar', disabled: !can, onclick: () => sendCraft(grid3, 3, false) }),
              h('button', { class: 'btn small', type: 'button', text: 'Tudo' + (maxN > 1 ? ` (${maxN})` : ''), disabled: !can || maxN < 1, onclick: () => sendCraft(grid3, 3, true) }),
              h('button', { class: 'btn small', type: 'button', text: 'Limpar', onclick: () => { grid3 = new Array(9).fill(0); renderModal(); } }))),
          h('span', { class: 'note', text: picked ? `Selecionado: ${itemName(picked[0], picked[1])} — clique nos quadrados da grade.` : 'Clique numa receita à direita ou escolha um item da mochila abaixo.' }),
          bagEl),
        h('div', { class: 'craft-col' },
          h('div', { class: 'craft-book' },
            h('div', { class: 'craft-book-bar' },
              searchInput,
              h('button', { class: 'btn small' + (onlyAvail ? ' on' : ''), type: 'button', text: 'Só possíveis', onclick: () => { onlyAvail = !onlyAvail; renderModal(); } })),
            h('div', { class: 'craft-book-bar' }, ...GROUPS.map(([g, label]) => h('button', {
              class: 'btn small' + (filterGroup === g ? ' on' : ''), type: 'button', text: label,
              onclick: () => { filterGroup = g; renderModal(); },
            }))),
            listEl))),
    );
  }

  function openStation(kind, pos, title) {
    mode = kind;
    stationPos = pos.slice();
    stationTitle = title;
    picked = null;
    openOverlay('crafting');
    renderModal();
    game.audio.play('open', 0.9, 1);
  }

  function inspectTarget(hit) {
    if (!hit?.hit || !IS_MC(hit.id)) return null;
    const st = world.getMini(hit.x, hit.y, hit.z);
    if (st < MC_BASE) return null;
    const est = mcEstado(st - MC_BASE);
    if (!est) return null;
    const nome = est.nome;
    const isTable = nome === 'crafting_table';
    const isFurnace = nome === 'furnace' || nome === 'blast_furnace' || nome === 'smoker';
    const isDoorLike = 'open' in est.props && /(door|trapdoor|fence_gate|barrel)$/.test(nome);
    if (!isTable && !isFurnace && !isDoorLike) return null;
    const label = isTable ? 'Mesa de trabalho'
      : nome === 'smoker' ? 'Defumador'
      : nome === 'blast_furnace' ? 'Alto-forno'
      : isFurnace ? 'Fornalha'
      : mcNomePt(nome);
    const actionLabel = isDoorLike ? (est.props.open === 'true' ? 'fecha' : 'abre') : 'abre';
    return { est, nome, isTable, isFurnace, isDoorLike, label, hint: `${label} — F ou clique dir. ${actionLabel} (Shift+clique constrói)` };
  }

  // ---- Interação no mundo (Mesa de trabalho, Fornalha, Portas, Alçapões, Portões, Barris) ---------------------------
  function interact(dt, playing) {
    const hit = interaction.target;
    const info = inspectTarget(hit);
    if (!info) return false;
    if (!playing || game.modeRules?.invisivel) return false;
    const trigger = input.wasPressed('interact') || (input.wasPressed('place') && !input.isDown('sneak'));
    if (!trigger) return false;

    const { est, nome, isTable, isFurnace, label } = info;
    if (isTable) {
      openStation('table', [hit.x, hit.y, hit.z], 'Mesa de trabalho');
      return true;
    }
    if (isFurnace) {
      openStation('furnace', [hit.x, hit.y, hit.z], label);
      return true;
    }
    // porta, alçapão, portão ou barril
    if (net.offline) {
      const nextOpen = est.props.open === 'true' ? 'false' : 'true';
      const n = mcNumero(nome, { ...est.props, open: nextOpen });
      if (n >= 0) { const s = MC_BASE + n; world.setBlock(hit.x, hit.y, hit.z, mcIdDoEstado(s), s); }
      if (/_door$/.test(nome) && (est.props.half === 'lower' || est.props.half === 'upper')) {
        const dy = est.props.half === 'lower' ? 1 : -1;
        const bm = world.getMini(hit.x, hit.y + dy, hit.z);
        if (bm >= MC_BASE) {
          const oe = mcEstado(bm - MC_BASE);
          if (oe && oe.nome === nome) {
            const on = mcNumero(nome, { ...oe.props, open: nextOpen });
            if (on >= 0) { const s = MC_BASE + on; world.setBlock(hit.x, hit.y + dy, hit.z, mcIdDoEstado(s), s); }
          }
        }
      }
    } else {
      net.send({ t: 'usarBloco', x: hit.x, y: hit.y, z: hit.z });
    }
    game.audio.play(est.props.open === 'true' ? 'close' : 'open', 0.85, 1.05);
    return true;
  }

  game.hooks.interact.push(interact);
  game.hooks.other.push((m) => {
    if (m.t === 'overlay-closed' && m.was === 'crafting') {
      mode = null;
      stationPos = null;
      modal.classList.add('hide');
    }
  });
  game.items?.setCraftMount(quickRoot);
  game.items?.on((ev) => {
    if (ev !== 'bag') return;
    if (game.overlay === 'palette') renderQuick();
    if (mode) renderModal();
  });
  game.hooks.other.push((m) => {
    if (m.t === 'boot') {
      game.items?.setCraftMount(quickRoot);
      renderQuick();
    }
  });
  renderQuick();

  return { openStation, renderQuick, renderModal, hintFor: (hit) => inspectTarget(hit)?.hint || null };
}
