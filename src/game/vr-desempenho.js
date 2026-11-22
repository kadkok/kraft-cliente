// LAVRA — regulador de desempenho no VR (pedido do Kadmus, 17/11/2026: "melhorias para que o vr possa obter o melhor
// desempenho e qualidade nesse jogo").
//
// No visor, quadro perdido vira enjoo: a regra é nunca passar do tempo do quadro (13,9 ms a 72 Hz; 11,1 ms a 90 Hz).
// Este módulo mede o tempo real de cada quadro só enquanto há sessão VR e anda por uma escada de níveis:
//   nível 0 = mais bonito (raio de visão maior, foveação leve, plantas e bichos até longe)
//   nível 4 = mais leve (raio curto, foveação máxima, plantas e bichos só de perto)
// Passou do tempo por 1,5 s → desce um degrau (fica mais leve). Sobrou folga por 6 s → sobe um degrau. No degrau 0
// com folga, pede 90 Hz ao visor (se ele tiver); se a 90 Hz não couber, volta para 72 Hz. Ao sair do VR, tudo volta.
// Mexe só em coisas que mudam sem recarregar: world.setDistance, renderer.xr.setFoveation, session.updateTargetFrameRate,
// game.plantas3d.setEscala, game.vrEscalaFauna (lido por render/fauna-bichos.js) e atmosphere.setSombra (ritmo ou
// desligada; só existe sombra no visor desde 17/11, com o mapa pequeno do perfil do Quest em config.js).
const NIVEIS = [   // sombra: a cada N quadros (0 = desligada); a sombra é o que mais dá profundidade à cena, sai por último
  { dist: +1, fov: 0.35, plantas: 1.0, fauna: 1.0, sombra: 3 },
  { dist: 0, fov: 0.6, plantas: 0.85, fauna: 0.85, sombra: 4 },
  { dist: 0, fov: 1.0, plantas: 0.65, fauna: 0.7, sombra: 5 },
  { dist: -1, fov: 1.0, plantas: 0.5, fauna: 0.55, sombra: 8 },
  { dist: -2, fov: 1.0, plantas: 0.35, fauna: 0.45, sombra: 0 },
];
const INICIO = 2;

export function initVrDesempenho({ game, renderer, world, quality, atmosphere }) {
  const st = { ativo: false, nivel: INICIO, hz: 72, ms: 0, acima: 0, abaixo: 0, espera: 0, tentou90: false, base: quality.distance };
  let ant = 0;

  function aplicar() {
    const n = NIVEIS[st.nivel];
    world.setDistance(Math.max(2, st.base + n.dist));
    renderer.xr.setFoveation?.(n.fov);
    game.plantas3d?.setEscala?.(n.plantas);
    game.vrEscalaFauna = n.fauna;
    atmosphere?.setSombra?.(n.sombra > 0, n.sombra);
  }
  async function taxa(hz) {
    const s = renderer.xr.getSession?.();
    if (!s || typeof s.updateTargetFrameRate !== 'function') return false;
    const ok = !s.supportedFrameRates || [...s.supportedFrameRates].includes(hz);
    if (!ok) return false;
    try { await s.updateTargetFrameRate(hz); st.hz = hz; return true; } catch { return false; }
  }

  function entrar() {
    st.ativo = true; st.nivel = INICIO; st.base = quality.distance; st.acima = st.abaixo = 0; st.espera = 2; st.ms = 0; st.tentou90 = false; st.hz = 72;
    aplicar(); taxa(72);
  }
  function sair() {
    st.ativo = false;
    world.setDistance(st.base);
    game.plantas3d?.setEscala?.(1);
    game.vrEscalaFauna = 1;
    atmosphere?.setSombra?.(true);
  }

  game.hooks.frame.push(() => {
    const vr = !!game.xr?.presenting;
    if (vr && !st.ativo) entrar();
    else if (!vr && st.ativo) sair();
    if (!vr) return;
    const agora = performance.now(), dt = ant ? agora - ant : 0; ant = agora;
    if (!dt || dt > 250) return;                       // pausa, troca de aba, carregamento
    st.ms = st.ms ? st.ms + (dt - st.ms) * 0.08 : dt;  // média que reage em ~0,2 s
    const s = dt / 1000, orcamento = 1000 / st.hz;
    if (st.espera > 0) { st.espera -= s; return; }
    if (st.ms > orcamento * 1.12) { st.acima += s; st.abaixo = 0; } else if (st.ms < orcamento * 0.82) { st.abaixo += s; st.acima = 0; } else { st.acima = st.abaixo = 0; }
    if (st.acima > 1.5) {
      st.acima = 0; st.espera = 3;
      if (st.hz === 90) { taxa(72); return; }                     // 90 Hz não coube: volta para 72 antes de piorar a imagem
      if (st.nivel < NIVEIS.length - 1) { st.nivel++; aplicar(); }
    } else if (st.abaixo > 6) {
      st.abaixo = 0; st.espera = 6;
      if (st.nivel > 0) { st.nivel--; aplicar(); }
      else if (st.hz === 72 && !st.tentou90) { st.tentou90 = true; taxa(90); }
    }
  });

  const api = { get nivel() { return st.nivel; }, get hz() { return st.hz; }, get ms() { return Math.round(st.ms * 10) / 10; }, get ativo() { return st.ativo; } };
  game.vrDesempenho = api;
  return api;
}
