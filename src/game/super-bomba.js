import { B } from '../../shared/blocks.js';
import { PAVIO_MS, RAIO, centroValido, alcancaFortaleza } from '../../shared/super-bomba.js';
import { esferaNoEspaco, zonaCampo } from '../../shared/espacos.js';

export function initSuperBomba({ game, player, world, net, ui, salvarSolo, blast }) {
  const pavios = new Map();
  let servidorCompativel = false;
  const perto = p => Math.hypot(player.pos[0] - p[0], player.pos[1] - p[1], player.pos[2] - p[2]) <= RAIO + 48;

  function impedimento(p) {
    if (!game.modeRules?.quebra) return 'Seu modo de jogo não permite escavar.';
    if (!game.dim && !game.gmAtivo) {
      if (game.espacoAtivo || esferaNoEspaco(zonaCampo(game.futebol?.campo), p, RAIO + 1))
        return 'A Super Bomba alcançaria um espaço de atividade protegido.';
      if (alcancaFortaleza(p, game.gen?.fortaleza)) return 'A Fortaleza fica dentro do alcance da Super Bomba.';
    }
    return '';
  }
  function armar(p, ms) {
    if (!centroValido(p)) return;
    const prazo = performance.now() + Math.min(PAVIO_MS, Math.max(0, ms));
    pavios.set(p.join(','), { p, prazo, segundo: -1 });
  }
  function acender(p) {
    if (pavios.has(p.join(','))) return;
    const erro = impedimento(p);
    if (erro) return ui.toast(erro, 3500);
    if (net.offline) {
      if (pavios.size >= 8) return ui.toast('Já há oito Super Bombas acesas. Aguarde a contagem.');
      armar(p, PAVIO_MS);
    } else if (net.online && servidorCompativel) net.send({ t: 'super-acender', p });
    else ui.toast('Este servidor ainda não oferece a Super Bomba. Ela está disponível no modo solo desta versão.');
  }
  function detonar(p) {
    pavios.delete(p.join(','));
    if (!world.registrarCratera(p, true)) return ui.toast('Este plano chegou ao limite de crateras.');
    if (net.offline) salvarSolo();
    if (game.state === 'PLAYING' && perto(p)) blast(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, RAIO);
  }
  game.hooks.other.push(m => {
    if (m.t === 'welcome' || m.t === 'offline') {
      pavios.clear();
      servidorCompativel = Array.isArray(m.superCrateras);
      for (const f of m.superPavios || []) armar(f.p, f.ms);
    } else if (m.t === 'super-pavio') armar(m.p, m.ms);
    else if (m.t === 'super-apagou') pavios.delete(m.p.join(','));
    else if (m.t === 'super-cratera' && centroValido(m.p)) detonar(m.p);
  });
  game.hooks.edit.push((x, y, z, id, colocando) => {
    if (net.offline && pavios.size && !colocando && id === B.SUPER_BOMBA) pavios.delete([x,y,z].join(','));
  });
  game.hooks.frame.push(() => {
    if (!pavios.size) return;
    if (!net.playing || game.state === 'MENU') {
      if (net.offline) pavios.clear();
      return;
    }
    const agora = performance.now();
    for (const [k, f] of pavios) {
      const s = Math.max(0, Math.ceil((f.prazo - agora) / 1000));
      if (net.offline && world.blocoComEdicao(...f.p) !== B.SUPER_BOMBA) { pavios.delete(k); continue; }
      if (!s && net.offline) {
        const erro = impedimento(f.p);
        if (erro) { pavios.delete(k); ui.toast(erro); }
        else detonar(f.p);
      } else if (s && s !== f.segundo && perto(f.p)) {
        f.segundo = s;
        if (s <= 5 || s === PAVIO_MS / 1000) {
          ui.toast('Super Bomba · ' + s + ' s' + (s === 10 ? ' · afaste-se!' : ''), 1100);
          game.audio?.play('tick', 0.65, s <= 3 ? 1.3 : 1, 'metal', f.p);
        }
      }
    }
  });
  function dica(p) {
    const f = pavios.get(p.join(','));
    return f ? 'Super Bomba · ' + Math.max(0, Math.ceil((f.prazo - performance.now()) / 1000)) + ' s'
      : 'Super Bomba · 256 blocos de largura · ' + (game.toque ? 'Usar' : 'F') + ' acende o pavio';
  }
  return { acender, dica };
}
