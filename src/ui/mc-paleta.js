// LAVRA — aba "Minecraft" da paleta (tecla E) e ícones dos blocos do Minecraft (fase 5 de docs/plano-blocos-minecraft.md).
// Ícone: a figura de inventário do Minecraft quando o item é plano (malha-<pilha>.json → icones); senão o próprio modelo
// desenhado em perspectiva (as caixas do estado padrão, faces de cima, leste e sul, com a textura e o uv de cada face).
// Na barra e na paleta o bloco é guardado como MC_BASE + estado (shared/mc-colocar.js decide o estado ao colocar).
import { MC_BLOCOS, MC_BASE, MC_CLASSE, mcEstado } from '../../shared/mc-estados.js';
import { mcPadrao } from '../../shared/mc-colocar.js';
import { mcNomePt, mcCombina } from '../../shared/mc-nomes.js';

const ESCONDE = /(^|_)wall_(torch|sign|hanging_sign|banner|head|skull|fan)$|_plant$|^(moving_piston|piston_head|attached_.*_stem|tall_seagrass|frosted_ice|bubble_column|end_gateway|end_portal|nether_portal|fire|soul_fire)$|^(potted_|infested_)/;
export function criarPaletaMc({ malhaUrl, pacote }) {
  let malha = null, res = 0, camadas = null;
  const telas = new Map(), icones = new Map();
  const pronto = fetch(malhaUrl).then((r) => (r.ok ? r.json() : null)).then((m) => { malha = m; return m; }).catch(() => null);
  function definirPacote(p) { if (!p) return; res = p.info.res; camadas = p.dados; telas.clear(); icones.clear(); }
  definirPacote(pacote);
  // uma camada da folha como canvas (RGBA, linha 0 = topo)
  function tela(l) {
    let c = telas.get(l); if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = res;
    const img = c.getContext('2d').createImageData(res, res);
    img.data.set(camadas.subarray(l * res * res * 4, (l + 1) * res * res * 4));
    c.getContext('2d').putImageData(img, 0, 0); telas.set(l, c); return c;
  }
  const nomeDe = (v) => mcEstado(v - MC_BASE).nome;
  const legivel = (nome) => mcNomePt(nome);
  // projeção da vista do inventário: leste à direita, sul à esquerda, de cima
  function icone(v, S = 64) {
    const k = v + ':' + S;
    if (icones.has(k)) return icones.get(k);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = res > 32;
    icones.set(k, c);
    if (!malha || !camadas) return c;
    const n = v - MC_BASE, nome = nomeDe(v);
    if (malha.icones && malha.icones[nome] !== undefined) { g.drawImage(tela(malha.icones[nome]), 0, 0, res, res, S * 0.1, S * 0.1, S * 0.8, S * 0.8); return c; }
    const faces = [];
    for (const parte of malha.estados[n] || []) {
      const alt = parte[0]; if (!alt) continue;
      for (const [x1, y1, z1, x2, y2, z2, giro, fs] of malha.modelos[alt[0]]) {
        if (giro) continue;
        for (const [d, l, u1, v1, u2, v2] of fs) {
          if (d !== 2 && d !== 0 && d !== 4) continue;          // cima, leste, sul
          const cto = (s, t) => d === 2 ? [x1 + s * (x2 - x1), y2, z1 + t * (z2 - z1)] : d === 4 ? [x1 + s * (x2 - x1), y2 - t * (y2 - y1), z2] : [x2, y2 - t * (y2 - y1), z2 - s * (z2 - z1)];
          faces.push({ d, l, uv: [u1, v1, u2, v2], P: [cto(0, 0), cto(1, 0), cto(0, 1)], prof: (d === 2 ? y2 : d === 0 ? x2 : z2) + (x1 + x2 + z1 + z2) / 4 + (y1 + y2) / 2 });
        }
      }
    }
    if (!faces.length) { const p = malha.estados[n]?.[0]?.[0]; if (p) { const f = malha.modelos[p[0]]?.[0]?.[7]?.[0]; if (f) g.drawImage(tela(f[1]), 0, 0, res, res, S * 0.1, S * 0.1, S * 0.8, S * 0.8); } return c; }
    const k16 = S / 16 / 1.75, cxs = S / 2, cys = S * 0.28;
    const tela2 = (p) => [cxs + (p[0] - p[2]) * 0.866 * k16, cys + (p[0] + p[2]) * 0.5 * k16 - (p[1] - 8) * k16 + 8 * k16 * 0.0];
    faces.sort((a, b) => a.prof - b.prof);
    for (const f of faces) {
      const [u1, v1, u2, v2] = f.uv, [A, B, C] = f.P.map(tela2);
      const P = (s, t) => [A[0] + s * (B[0] - A[0]) + t * (C[0] - A[0]), A[1] + s * (B[1] - A[1]) + t * (C[1] - A[1])];
      const s0 = u2 < u1 ? 1 : 0, t0 = v2 < v1 ? 1 : 0;              // uv invertido: começa do outro canto
      const O = P(s0, t0), ex = P(1 - s0, t0), ey = P(s0, 1 - t0);
      const sw = Math.max(1e-3, Math.abs(u2 - u1) / 16 * res), sh = Math.max(1e-3, Math.abs(v2 - v1) / 16 * res);
      g.save();
      g.setTransform((ex[0] - O[0]) / sw, (ex[1] - O[1]) / sw, (ey[0] - O[0]) / sh, (ey[1] - O[1]) / sh, O[0], O[1]);
      g.drawImage(tela(f.l), Math.min(u1, u2) / 16 * res, Math.min(v1, v2) / 16 * res, sw, sh, 0, 0, sw, sh);
      g.restore();
      if (f.d !== 2) {                                         // sombra das laterais, como no inventário
        g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(0,0,0,${f.d === 4 ? 0.28 : 0.14})`;
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(B[0] + C[0] - A[0], B[1] + C[1] - A[1]); g.lineTo(C[0], C[1]); g.closePath(); g.fill(); g.restore();
      }
    }
    return c;
  }
  const todos = () => MC_BLOCOS.filter((b) => !ESCONDE.test(b.n) && MC_CLASSE[b.s] <= 2);
  let busca = '';
  // desenha a aba dentro da grade da paleta
  function render(grade, atual, escolher, h) {
    const campo = h('input', { type: 'search', class: 'busca-mc', placeholder: 'Buscar bloco: carvalho, mesa, pedra, oak, door…', value: busca, 'aria-label': 'Buscar bloco do Minecraft' });
    const encher = () => {
      const achados = todos().filter((b) => mcCombina(b.n, busca)).slice(0, 180);
      while (grade.lastChild && grade.lastChild !== campo) grade.lastChild.remove();
      grade.append(...achados.map((b) => {
        const v = mcPadrao(b.n), nome = mcNomePt(b.n);
        const cel = h('button', { class: 'cell' + (atual && atual >= MC_BASE && nomeDe(atual) === b.n ? ' on' : ''), type: 'button', title: nome, 'aria-label': nome, onclick: () => escolher(v) });
        const cv = icone(v, 96), copia = h('canvas', { width: 96, height: 96 }); copia.getContext('2d').drawImage(cv, 0, 0); cel.append(copia);
        return cel;
      }));
    };
    campo.addEventListener('input', () => { busca = campo.value; encher(); });
    campo.addEventListener('keydown', (e) => e.stopPropagation());   // digitar não move o jogador
    grade.replaceChildren(campo);
    pronto.then(encher);
    setTimeout(() => campo.focus(), 30);
  }
  return { pronto, icone, nome: (v) => mcNomePt(v), render, definirPacote };
}
