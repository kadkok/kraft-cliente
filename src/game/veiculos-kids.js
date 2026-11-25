import { raycastVoxels } from '../world/raycast.js';
import { ALCANCE_PORTA, distanciaCabine, saidaHelicoptero, assentarHelicoptero } from '../../shared/embarque-helicoptero.js';
import { EYE_H, SEA, Y_MIN } from '../../shared/constants.js';
import { MAR_NIVEL } from '../../shared/mar.js';
import { LEVEL, SOLID } from '../../shared/blocks.js';
import { dentroDoPalacio } from '../../shared/fortaleza.js';
import {
  VEICULOS,
  TIPOS,
  novoVeiculo,
  pilotar,
  chamarVeiculo,
  pontoBanco,
  formaRede,
  formaValida,
} from '../../shared/veiculos-kids.js';
import { indicePresente, posePeloMovimento } from '../../shared/presenca-veiculos.js';
import { criarVisual, criarRastro, emissaoRastro } from '../render/veiculos-kids.js';
import { painelGaragem } from './garagem.js';

const somMotor = {
  balao: 'ambiente.fogo', jipe: 'ambiente.carro', barco: 'ambiente.boat_engine',
  submarino: 'ambiente.motor', aviao: 'ambiente.helice', helicoptero: 'ambiente.helice',
};

export function initGaragem({
  game,
  player,
  world,
  net,
  ui,
  scene,
  avatars,
  store,
  input,
  openOverlay,
  closeOverlay,
}) {
  let veiculo = null,
    modelo = null,
    piloto = false,
    camAnt,
    proximo = false,
    rel = 0,
    relogioHUD = 0,
    chaveSalva = '',
    assentando = false,
    aguardaSoltar = false,
    tempoSolo = 0;
  const remotos = new Map(),
    colunas = new Map();
  const agua = (x, z) => (game.mar?.ligado ? game.mar.altura(x, z) : SEA + 0.9);
  function sondar(px, pz) {
    const x = Math.floor(px),
      z = Math.floor(pz),
      k = x + ',' + z;
    let dados = colunas.get(k);
    if (!dados) {
      let alto, molhado;
      const topo = world.isLoaded(x, z) ? world.topSolid(x, z) : -1;
      if (topo >= 0) {
        alto = topo;
        let id = world.getBlock(x, alto, z);
        molhado = !!LEVEL[id]; // O teto de uma galeria ou uma geleira conta como piso.
        while (alto > Y_MIN && !SOLID[id]) id = world.getBlock(x, --alto, z);
      } else {
        alto = game.gen.height(x, z);
        molhado = alto < SEA;
      }
      dados = { chao: alto + 1, molhado, agua: SEA + 0.9 };
      colunas.set(k, dados);
    }
    return dados.molhado ? { chao: dados.chao, molhado: true, agua: agua(px, pz) } : dados;
  }
  const ambiente = {
    sondar, alturaAgua: agua, aleatorio: Math.random, tempo: 0,
    get nivelMar() { return game.mar?.ligado ? MAR_NIVEL : SEA + 0.9; },
    get vento() { return game.weather?.wind; },
  };
  let rastro;
  function posLivre(v) {
    return !net.online || game.gmFortaleza || !dentroDoPalacio(game.gen.fortaleza, pontoBanco(v));
  }
  function ocupado() {
    return (
      game.espacoAtivo ||
      game.machines?.seat ||
      game.costa?.abordo ||
      game.ferrovia?.bordo ||
      game.cavalos?.montado
    );
  }
  function instalarVisual(v) {
    modelo?.liberar();
    modelo = criarVisual(v.tipo);
    scene.add(modelo.raiz);
    modelo.atualizar(v, 0);
    const este = modelo;
    modelo.pronto.catch(() => {
      if (modelo === este) {
        sair(false);
        modelo.liberar();
        modelo = null;
        veiculo = null;
        painel.erro('O modelo não carregou. Abra a garagem para chamar novamente.');
      }
    });
  }
  function guardar() {
    if (!chaveSalva || !veiculo) return;
    const v = veiculo;
    store.set(chaveSalva, chaveSalva.startsWith('garagem.heli.rede.') && v.tipo !== 'helicoptero' ? null :
      { tipo: v.tipo, p: [v.x, v.y, v.z], h: v.h });
  }
  function restaurar(chave) {
    chaveSalva = chave;
    const a = store.get(chave, null);
    if (!a || !Object.hasOwn(VEICULOS, a.tipo) || !Array.isArray(a.p) || a.p.length !== 3 ||
        !a.p.every(Number.isFinite) || !Number.isFinite(a.h) || (chave.startsWith('garagem.heli.rede.') && a.tipo !== 'helicoptero')) return;
    veiculo = novoVeiculo(a.tipo, ...a.p, a.h);
    instalarVisual(veiculo);
    assentando = a.tipo === 'helicoptero';
  }
  const bloqueio = {};
  const solido = (id) => !!SOLID[id];
  function miraCabine(origem, direcao) {
    const d = distanciaCabine(veiculo, origem, direcao);
    if (!Number.isFinite(d)) return false;
    const p = player.pos;
    if (Math.hypot(origem[0]+d*direcao[0]-p[0], origem[1]+d*direcao[1]-(p[1]+EYE_H),
        origem[2]+d*direcao[2]-p[2]) > ALCANCE_PORTA) return false;
    raycastVoxels(world.getBlock, ...origem, ...direcao, Math.max(0,d-0.02), solido, bloqueio);
    return !bloqueio.hit;
  }
  function portaAcessivel() {
    if (Math.hypot(veiculo.x-player.pos[0], veiculo.z-player.pos[2]) > ALCANCE_PORTA+2 ||
        !world.isLoaded(Math.floor(veiculo.x), Math.floor(veiculo.z))) return false;
    const olho = [player.pos[0], player.pos[1]+EYE_H, player.pos[2]];
    const dx = veiculo.x-olho[0], dy = veiculo.y+.25-olho[1], dz = veiculo.z-olho[2];
    const d = Math.hypot(dx,dy,dz) || 1;
    return miraCabine(olho, [dx/d,dy/d,dz/d]);
  }
  function entrar() {
    if (piloto || !veiculo || game.state !== 'PLAYING' || game.dim || ocupado() || !posLivre(veiculo)) return false;
    if (veiculo.tipo === 'helicoptero' && !portaAcessivel()) return false;
    piloto = true;
    assentando = false;
    input.comandoHelicoptero = veiculo.tipo === 'helicoptero';
    ui.el.hud.classList.toggle('pilotando-helicoptero', input.comandoHelicoptero);
    camAnt = game.camWant;
    game.camWant = VEICULOS[veiculo.tipo].camera;
    player.yaw = veiculo.h + Math.PI;
    player.pitch = -0.17;
    player.flying = false;
    player.inWater = player.headInWater = false;
    player.sneaking = false;
    game.pendingSpawn = false;
    player.teleport(...pontoBanco(veiculo));
    return true;
  }
  function sair(desembarcar = true) {
    if (!piloto) return;
    let porta;
    if (desembarcar && veiculo?.tipo === 'helicoptero') {
      colunas.clear();
      porta = saidaHelicoptero(veiculo, sondar, p => world.isLoaded(Math.floor(p[0]), Math.floor(p[2])) &&
        !player.collides(...p) && (!net.online || game.gmFortaleza || !dentroDoPalacio(game.gen.fortaleza, p)));
      if (!porta) {
        ui.toast('As saídas estão obstruídas. Mova o helicóptero para abrir espaço.');
        return;
      }
    }
    piloto = false;
    input.comandoHelicoptero = false;
    ui.el.hud.classList.remove('pilotando-helicoptero');
    aguardaSoltar = input.isDown('place');
    game.camWant = camAnt;
    game.audio?.removeEmitter?.('garagem-piloto');
    rastro?.limpar();
    if (veiculo) {
      const v = veiculo,
        k = v.tipo;
      v.passeio = null;
      v.fumaca = false;
      v.v = v.vx = v.vz = 0;
      if (k === 'helicoptero') {
        assentando = true;
        if (porta) player.teleport(...porta);
      } else v.vy = v.rpm = 0;
      if (desembarcar && k !== 'helicoptero') {
        const lado = 2.4,
          x = v.x + Math.cos(v.h) * lado,
          z = v.z - Math.sin(v.h) * lado,
          p = sondar(x, z);
        player.teleport(x, Math.max(p.chao + 0.05, p.molhado ? p.agua + 0.1 : 0, v.y), z);
        if (k === 'aviao') {
          [v.x, v.y, v.z, v.h] = v.origem;
          v.voo = false;
          v.pitch = v.roll = 0;
        }
        if (k === 'submarino') {
          v.mergulho = false;
          v.prof = 0;
          v.y = agua(v.x, v.z) + 0.1;
        }
        modelo?.atualizar(v, 0);
      }
    }
    guardar();
  }
  function chamar(tipo) {
    if (!Object.hasOwn(VEICULOS, tipo) || game.state !== 'PLAYING' || game.dim || ocupado()) {
      painel.erro('Desembarque da montaria atual e abra a garagem na superfície.');
      return false;
    }
    const rumo = player.yaw + Math.PI;
    const origem = [player.pos[0] + Math.sin(rumo) * 4, player.pos[1], player.pos[2] + Math.cos(rumo) * 4];
    colunas.clear();
    const candidato = chamarVeiculo(tipo, origem, rumo, sondar);
    if (!candidato || !posLivre(candidato)) {
      painel.erro(
        tipo === 'aviao'
          ? 'Procure terreno firme com espaço para a corrida de decolagem.'
          : tipo === 'barco' || tipo === 'submarino'
            ? 'Aproxime-se de água com profundidade para embarcar.'
            : 'Procure uma área livre para embarcar.',
      );
      return false;
    }
    if (piloto) sair(false);
    veiculo = candidato;
    instalarVisual(veiculo);
    assentando = false;
    if (tipo === 'helicoptero') {
      ui.toast(game.toque ? 'Helicóptero estacionado. Toque na cabine para entrar.' :
        'Helicóptero estacionado. Aproxime-se e clique com o botão direito na cabine.');
    } else entrar();
    guardar();
    return true;
  }
  let roteiro = [];
  function prepararPasseio(v) {
    const { x, z } = v;
    const portos = (game.gen.arq?.portos || [])
      .map(({ caixa, nome }) => {
        const px = (caixa[0] + caixa[2]) / 2,
          pz = (caixa[1] + caixa[3]) / 2;
        return { x: px, z: pz, nome, distancia: Math.hypot(px - x, pz - z) };
      })
      .filter((p) => p.distancia > 24 && p.distancia <= 1600)
      .sort((a, b) => a.distancia - b.distancia);
    roteiro = portos.length
      ? portos.slice(0, 2)
      : [
          { x: x + 48, z },
          { x: x + 48, z: z + 48 },
          { x, z: z + 48 },
        ];
    roteiro.push({ x, z, nome: 'Ponto de partida' });
  }
  function trechoPasseio(v) {
    const destino = roteiro.shift();
    if (!destino) {
      v.passeio = null;
      return;
    }
    const p = sondar(destino.x, destino.z);
    v.passeio = { ...destino, altura: (p.molhado ? p.agua : p.chao) + 16 };
    if (destino.nome) ui.toast('Próxima parada do balão · ' + destino.nome);
  }
  function acao() {
    const v = veiculo;
    if (!piloto || !v) return;
    if (v.tipo === 'submarino') v.mergulho = !v.mergulho;
    else if (v.tipo === 'aviao') v.fumaca = !v.fumaca;
    else if (v.tipo === 'balao') {
      if (v.passeio) v.passeio = null;
      else {
        prepararPasseio(v);
        trechoPasseio(v);
      }
    } else game.audio?.play(v.tipo === 'barco' ? 'garagem_barco' : 'garagem_buzina', 0.65, 1);
  }
  const painel = painelGaragem({
    ui,
    game,
    openOverlay,
    closeOverlay,
    chamar,
    acao,
    sair: () => sair(),
    entrar,
  });
  function apagar() {
    if (piloto) sair(false);
    modelo?.liberar();
    modelo = null;
    veiculo = null;
    proximo = assentando = aguardaSoltar = false;
    chaveSalva = '';
    for (const r of remotos.values()) r.visual?.liberar();
    remotos.clear();
    colunas.clear();
    rastro?.limpar();
  }
  function remover(id) {
    const r = remotos.get(id);
    if (!r) return;
    r.visual?.liberar();
    remotos.delete(id);
  }
  function posar(corpo, v) {
    if (v.tipo === 'balao') return;
    if (v.tipo === 'submarino') {
      corpo.root.visible = false;
      return;
    }
    corpo.root.position.y -= v.tipo === 'helicoptero' ? 1.01 : 0.48;
    corpo.root.rotation.y = v.h + Math.PI;
    corpo.legL.rotation.x = corpo.legR.rotation.x = 1.12;
    corpo.armL.rotation.x = corpo.armR.rotation.x = 0.67;
  }
  function receber(id, p, pose, flags = 0, yaw = 0, pitch = 0) {
    const agora = performance.now() / 1000;
    const anterior = remotos.get(id);
    if (!pose && p && indicePresente(flags) >= 0) {
      const ultima = anterior?.v.tipo === TIPOS[indicePresente(flags)] ? anterior : null;
      pose = posePeloMovimento(
        flags,
        yaw,
        pitch,
        p,
        ultima?.amostra,
        ultima ? agora - ultima.tempo : 0,
        ultima ? agora - ultima.inicio : 0,
      );
    }
    if (!p || !formaValida(pose)) {
      remover(id);
      return;
    }
    const tipo = TIPOS[pose[0]];
    let r = anterior;
    if (!r || r.v.tipo !== tipo) {
      r?.visual?.liberar();
      r = { v: novoVeiculo(tipo, p[0], p[1], p[2], pose[1]), visual: null, inicio: agora };
      remotos.set(id, r);
    }
    const v = r.v;
    r.alvo = [p[0], p[1] - VEICULOS[tipo].banco * VEICULOS[tipo].escala, p[2]];
    if (!r.iniciado) {
      [v.x, v.y, v.z] = r.alvo;
      r.iniciado = true;
    }
    [v.h, v.pitch, v.roll, v.v, v.rpm] = pose.slice(1, 6);
    v.fumaca = !!pose[6];
    r.amostra = { x: p[0], z: p[2], h: v.h };
    r.tempo = agora;
  }
  game.hooks.other.push((m) => {
    if (m.t === 'leave') {
      remover(m.id);
      return;
    }
    if (m.t === 'fortaleza-voltar') {
      sair(false);
      return;
    }
    if (m.t !== 'welcome' && m.t !== 'offline') return;
    apagar();
    if (!game.dim && net.offline) restaurar('garagem.kids.' + game.slug);
    for (const p of m.players || []) receber(p.id, p.p, p.veiculo, p.f, p.r?.[0], p.r?.[1]);
  });
  game.hooks.interact.unshift((_dt, jogando, origem, direcao) => {
    if (!jogando || game.overlay || game.dim) return false;
    if (aguardaSoltar) {
      aguardaSoltar = input.isDown('place');
      if (aguardaSoltar) return true;
    }
    if (piloto) {
      if (veiculo.tipo === 'helicoptero' && input.wasPressed('sneak')) {
        sair();
        return true;
      }
      if (input.wasPressed('interact')) acao();
      return true;
    }
    if (veiculo?.tipo === 'helicoptero' && input.wasPressed('place') && miraCabine(origem, direcao)) {
      entrar();
      return true;
    }
    if (proximo && input.wasPressed('interact')) return entrar();
    return false;
  });
  game.hooks.fixed.push((dt, intencao) => {
    if (!piloto || !veiculo) return false;
    if (game.state !== 'PLAYING' || game.overlay) return true;
    const v = veiculo;
    ambiente.tempo += dt;
    tempoSolo += dt;
    if (tempoSolo > 0.24) {
      colunas.clear();
      tempoSolo = 0;
    }
    const antigoH = v.h,
      origem = [v.x, v.y, v.z],
      passeando = !!v.passeio;
    pilotar(
      v,
      {
        frente: intencao.z,
        lado: intencao.x,
        camera: player.yaw + Math.PI,
        sobe: intencao.jump || painel.teclas.sobe,
        desce: (v.tipo === 'helicoptero' ? input.isDown('baixarColetivo') : intencao.sneak) || painel.teclas.desce,
      },
      ambiente,
      dt,
    );
    if (!posLivre(v)) {
      [v.x, v.y, v.z] = origem;
      v.v = v.vx = v.vz = 0;
    }
    if (v.tipo === 'balao' && passeando && !v.passeio) trechoPasseio(v);
    if (v.tipo !== 'balao' && v.tipo !== 'helicoptero')
      player.yaw += Math.atan2(Math.sin(v.h - antigoH), Math.cos(v.h - antigoH));
    player.flying = false;
    player.onGround = false;
    player.inWater = player.headInWater = false;
    const p = pontoBanco(v);
    player.prev.splice(0, 3, ...player.pos);
    player.pos.splice(0, 3, ...p);
    player.vel.fill(0);
    return true;
  });
  game.hooks.frame.push((dt) => {
    if (game.state === 'MENU' && piloto) sair(false);
    if ((!veiculo && !remotos.size) || game.dim) {
      if ((relogioHUD -= dt) <= 0) {
        painel.atualizar(null, null);
        relogioHUD = 0.12;
      }
      return;
    }
    if (piloto && veiculo) {
      modelo?.atualizar(veiculo, dt);
      const emissao = emissaoRastro(veiculo);
      if (emissao && !rastro) rastro = criarRastro(scene);
      rastro?.atualizar(veiculo, dt, emissao);
      rel -= dt;
      if (rel <= 0) {
        rel = 0.2;
        const v = veiculo;
        if (game.state === 'PLAYING' && (v.tipo !== 'balao' || v.vy > 0.4)) {
          const carga = v.tipo === 'jipe' ? Math.min(1, Math.abs(v.v) / 9) : v.rpm;
          const abafado = v.tipo === 'submarino' ? Math.min(1, -v.prof / 8) : 0;
          game.audio?.setEmitter?.('garagem-piloto', {
            key: somMotor[v.tipo],
            pos: pontoBanco(v),
            volume: v.tipo === 'balao' ? 0.18 : (0.11 + 0.12 * carga) * (1 - 0.3 * abafado),
            pitch: v.tipo === 'balao' ? 1 : 0.72 + 0.55 * carga - 0.09 * abafado,
            refDist: 3,
            maxDist: 50,
          });
        } else game.audio?.removeEmitter?.('garagem-piloto');
      }
    } else {
      rastro?.atualizar(null, dt);
      if (assentando && veiculo && game.state === 'PLAYING' && !game.overlay) {
        assentando = assentarHelicoptero(veiculo, sondar(veiculo.x, veiculo.z), dt);
        modelo?.atualizar(veiculo, dt);
        if (!assentando) guardar();
      }
    }
    if (modelo)
      modelo.raiz.visible = piloto
        ? veiculo.tipo === 'helicoptero' || game.camDist > 0.45
        : Math.hypot(veiculo.x - player.pos[0], veiculo.z - player.pos[2]) < 200;
    for (const [id, r] of remotos) {
      const v = r.v,
        perto = Math.hypot(r.alvo[0] - player.pos[0], r.alvo[2] - player.pos[2]) < 200;
      if (!perto) {
        if (r.visual) r.visual.raiz.visible = false;
        continue;
      }
      if (!r.visual) {
        r.visual = criarVisual(v.tipo);
        scene.add(r.visual.raiz);
        r.visual.pronto.catch(() => {});
      }
      const f = Math.min(1, dt * 13);
      v.x += (r.alvo[0] - v.x) * f;
      v.y += (r.alvo[1] - v.y) * f;
      v.z += (r.alvo[2] - v.z) * f;
      r.visual.raiz.visible = true;
      r.visual.atualizar(v, dt);
      const corpo = avatars.list.get(id)?.body;
      if (corpo?.root.visible) posar(corpo, v);
    }
    if ((relogioHUD -= dt) <= 0) {
      proximo = !!veiculo && !piloto && (veiculo.tipo === 'helicoptero' ? portaAcessivel() :
        Math.hypot(veiculo.x-player.pos[0], veiculo.y-player.pos[1], veiculo.z-player.pos[2]) < 6);
      painel.atualizar(piloto ? veiculo : null, proximo ? veiculo : null);
      relogioHUD = 0.12;
    }
  });
  addEventListener('pagehide', guardar);
  return {
    abrir: painel.abrir,
    restaurarNaRede(nome) {
      if (net.online && !game.dim && !chaveSalva) restaurar('garagem.heli.rede.' + game.slug + '.' + nome.toLowerCase());
    },
    chamar,
    sair,
    acao,
    receber,
    remover,
    posar,
    get atual() {
      return piloto ? veiculo : null;
    },
    get distanciaCamera() {
      return piloto ? VEICULOS[veiculo.tipo].camera : 0;
    },
    get pose() {
      return piloto ? formaRede(veiculo) : null;
    },
  };
}
