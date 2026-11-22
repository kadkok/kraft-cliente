// LAVRA — o machado no aparelho de quem joga (regras em shared/machado.js).
//
// Tecla Z (ou /machado, ou escolher "Machado" em Personagem e ferramentas) põe o machado na mão. Com ele na mão e
// madeira na mira, o botão de quebrar vira GOLPE: o braço ergue, desce e só no instante do impacto a madeira reage.
//   árvore (tronco ou galho, em pé ou caída) → conta os golpes naquele ponto; completou, corta (game.trees.cut)
//   bloco de madeira posto                   → sai o quarto mirado (mini-bloco de sempre; vai ao servidor pelo `b`)
// Fora da madeira nada muda. Enquanto o machado manda no golpe, os outros sistemas não enxergam o botão de quebrar
// (input.suppress): assim a árvore não cai no primeiro clique e o bloco não some inteiro.
//
// Para quem desenha (render/equipment.js já lê): game.machado = {
//   ativo            machado na mão
//   golpe            null ou { t (s desde o começo), bateu, acertou }  — fases em shared/machado.js → faseDoGolpe
//   impactoEm        relógio (s, performance.now()/1000) do último impacto que acertou madeira
//   progresso        null ou { n, de } golpes dados e necessários no corte em andamento
// }
import { eToraDeMadeira, secaoTora } from '../../shared/corte-tora.js';
import { B, KIND, K_CROSS } from '../../shared/blocks.js';
import { woodId } from '../../shared/trees.js';
import { MADEIRA, GOLPE_IMPACTO, GOLPE_TOTAL, golpesParaCortar, lascar } from '../../shared/machado.js';

export function initMachado({ game, world, player, input, interaction, effects, ui, camera, store }) {
  const m = { ativo: !!store.get('machado', false), golpe: null, impactoEm: -9, progresso: null };
  game.machado = m;
  const cortes = new Map();          // corte em andamento por ponto da árvore: chave → { n, de, quando }
  let raioDoGolpe = null;
  let alvo = null, mandando = false, tremor = 0, pusDig = false;
  const agora = () => performance.now() / 1000;

  // o machado está na mão? (a tecla, ou a ferramenta escolhida no painel de aparência)
  const naMao = () => m.ativo || effects?.equipment?.settings?.tool === 'axe';

  function alternar(forcar) {
    m.ativo = forcar === undefined ? !naMao() : !!forcar;
    if (!m.ativo && effects?.equipment?.settings?.tool === 'axe') effects.equipment.settings.tool = 'none';
    store.set('machado', m.ativo);
    m.golpe = null; raioDoGolpe = null;
    game.audio?.play('tick', 1, m.ativo ? 0.9 : 1.15);
    ui.toast(m.ativo
      ? 'Machado na mão. Golpeie uma tora solta para abri-la em duas. Árvores caem com vários golpes.'
      : 'Machado guardado.', m.ativo ? 5200 : 1600);
  }

  // o que o machado tem na mira: uma árvore (como em nature/trees.js: bloco comum mais perto tapa a árvore) ou um bloco de madeira
  function mira(origem, direcao) {
    const vox = interaction.target, arv = game.treeAim && game.treeAim.t <= interaction.reach && !game.treeAim.leaf ? game.treeAim : null;
    const dono = (x, y, z) => !!game.trees?.ownsWood?.(x, y, z);
    if (origem && direcao && game.objects) {
      const t = Math.min(interaction.reach + 3, vox.hit ? vox.t : Infinity, game.treeAim?.t ?? Infinity);
      const hit = game.objects.raycast(origem, direcao, t);
      if (hit) {
        const o = hit.entry.o;
        if (o.s !== 'tora' && !secaoTora(o.s)) return null;
        if (!eToraDeMadeira(o) || hit.t > interaction.reach || o.g || o.bau || o.fixo || o.dec === 'litoral' || game.modeRules?.criativo === false) {
          return { tipo: 'protegida', id: o.id };
        }
        return { tipo: 'tora', id: o.id, ponto: hit.point, dir: [...direcao] };
      }
    }
    if (arv && game.dim === 0 && !(vox.hit && vox.t < arv.t - 0.06 && vox.id !== B.LEAVES && vox.id !== B.PINE_LEAVES && !dono(vox.x, vox.y, vox.z))) {
      const t = arv.standing?.tree ?? arv.view?.rec?.tree;
      const chave = (arv.view ? 'c' + arv.view.rec.id : 'p' + (t ? t.x + ',' + t.z : '?')) + ':' + arv.node;
      return { tipo: 'arvore', hit: arv, chave, raio: arv.r, ponto: arv.point, normal: arv.normal, madeira: t ? woodId(t) : B.LOG };
    }
    if (vox.hit && MADEIRA[vox.id] && !dono(vox.x, vox.y, vox.z)) {
      return { tipo: 'bloco', x: vox.x, y: vox.y, z: vox.z, id: vox.id, ponto: [vox.x + (vox.fx ?? 0.5), vox.y + (vox.fy ?? 0.5), vox.z + (vox.fz ?? 0.5)], normal: [vox.nx, vox.ny, vox.nz], fx: vox.fx, fy: vox.fy, fz: vox.fz };
    }
    return null;
  }

  function impacto() {
    // Para a peça livre, o golpe pertence ao alvo escolhido no clique. Uma troca
    // de mira ou uma disputa com outro jogador não transfere o golpe para o vizinho.
    let a = alvo;
    if (raioDoGolpe) {
      const r = raioDoGolpe, hit = game.objects.raycast(r.origem, r.dir, interaction.reach);
      if (!hit || hit.entry.o.id !== r.id || !eToraDeMadeira(hit.entry.o)) return false;
      a = { tipo: 'tora', id: r.id, ponto: hit.point, dir: r.dir };
    } else if (a?.tipo === 'tora') return false;
    if (!a || a.tipo === 'protegida') return false;
    const t = agora();
    m.impactoEm = t; tremor = 1;
    const tom = 0.86 + Math.random() * 0.22;
    if (a.tipo === 'tora') {
      game.objects.rachar(a.id, a.ponto, a.dir);
      return true;
    }
    if (a.tipo === 'arvore') {
      let c = cortes.get(a.chave);
      if (!c) cortes.set(a.chave, c = { n: 0, de: golpesParaCortar(a.raio), quando: t });
      c.n++; c.quando = t;
      effects?.lascas?.({ id: a.madeira, ponto: a.ponto, normal: a.normal, n: c.n >= c.de ? 9 : 5 });
      game.audio?.play('dig', 1, tom, 'wood', a.ponto);
      if (c.n >= c.de) {
        cortes.delete(a.chave);
        game.audio?.play('break', 1, 0.8 + Math.random() * 0.15, 'wood', a.ponto);
        game.trees?.cut?.(a.hit);
      }
      return true;
    }
    const r = lascar(a.id, world.getMini?.(a.x, a.y, a.z) || 0, a.normal[0], a.normal[1], a.normal[2], a.fx, a.fy, a.fz);
    if (!r) return false;
    interaction.set(a.x, a.y, a.z, r.id, r.mini);
    if (r.id === B.AIR) {             // foi o último quarto: a planta de cima perde o apoio, como numa quebra comum
      const cima = world.getBlock(a.x, a.y + 1, a.z);
      if (cima > 0 && KIND[cima] === K_CROSS) interaction.set(a.x, a.y + 1, a.z, B.AIR, 0);
    }
    effects?.lascas?.({ id: a.id, ponto: a.ponto, normal: a.normal, n: 5, bloco: [a.x, a.y, a.z], caixa: r.caixa });
    game.audio?.play('dig', 1, tom, 'wood', a.ponto);
    game.audio?.play('break', 0.7, 1.05 + Math.random() * 0.2, 'wood', a.ponto);
    for (const f of game.hooks.edit) f(a.x, a.y, a.z, a.id, false);
    return true;
  }

  // a vez do machado vem ANTES das árvores e dos blocos (unshift): ele só decide quem enxerga o botão de quebrar
  m.equipado = naMao;
  m.alternar = alternar;
  m.efeitoCorte = (madeira, ponto, dir) => {
    effects?.lascas?.({ id: madeira, ponto, normal: dir.map(n => -n), n: 8 });
    game.audio?.play('break', 0.9, 0.92, 'wood', ponto);
  };
  game.hooks.interact.unshift((dt, playing, origem, direcao) => {
    const usa = playing && naMao() && !interaction.locked && !game.overlay && !game.pecas?.mao;
    alvo = usa ? mira(origem, direcao) : null;
    mandando = usa && (!!alvo || !!m.golpe);
    input.suppress('break', mandando);
    if (!usa) { m.golpe = null; return false; }
    if (!m.golpe && alvo && alvo.tipo !== 'protegida' && (input.rawPressed('break') || input.rawDown('break'))) {
      raioDoGolpe = alvo.tipo === 'tora' ? { origem: [...origem], dir: [...direcao], id: alvo.id } : null;
      m.golpe = { t: 0, bateu: false, acertou: false };
    }
    return false;                     // realce, dica, pegar e pôr seguem com quem sempre cuidou
  });

  game.hooks.frame.push((dt) => {
    if (input.wasPressed('axe') && game.state === 'PLAYING' && !game.overlay) alternar();
    const g = m.golpe;
    if (g) {
      g.t += dt;
      if (!g.bateu && g.t >= GOLPE_IMPACTO) { g.bateu = true; g.acertou = impacto(); }
      if (g.t >= GOLPE_TOTAL) m.golpe = null;
    }
    // corte em andamento na mira: a barrinha de sempre sob a mira mostra quanto falta
    const t = agora();
    for (const [k, c] of cortes) if (t - c.quando > 25) cortes.delete(k);
    const c = alvo && alvo.tipo === 'arvore' ? cortes.get(alvo.chave) : null;
    m.progresso = c ? { n: c.n, de: c.de } : null;
    if (c && !interaction.breakTime) { interaction.digging = { x: Math.floor(alvo.ponto[0]), y: Math.floor(alvo.ponto[1]), z: Math.floor(alvo.ponto[2]), k: c.n / c.de }; pusDig = true; }
    else if (pusDig) { if (!interaction.breakTime) interaction.digging = null; pusDig = false; }
    // tranco da pancada na câmera (não muda a mira: é a câmera, não o olhar de quem joga)
    if (tremor > 0 || camera.rotation.x !== 0) {
      tremor = Math.max(0, tremor - dt * 5.5);
      const fora = game.xr?.presenting;
      camera.rotation.x = fora ? 0 : -0.022 * tremor * tremor * Math.cos((1 - tremor) * 9);
    }
  });

  return { alternar, get ativo() { return naMao(); }, comando(texto) { if (texto !== '/machado') return false; alternar(); return true; } };
}
