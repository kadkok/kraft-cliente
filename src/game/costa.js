// LAVRA — integração no cliente da Costa Tidewater (Vila Costeira 3D + Píer + Barco 8,2 m).
// Conecta os renderizadores `createBarcoTidewater` e `createVilaCosteira3D` à física compartilhada (`shared/costa.js`),
// caminhada no píer/convés em movimento, pilotagem no leme (PC E/F, toque e VR), áudio espacial e marcadores.
import * as THREE from '../three.js';
import { EYE_H, PLAYER_H, PLAYER_W, SEA, NET_TICK_HZ } from '../../shared/constants.js';
import { MAR_NIVEL } from '../../shared/mar.js';
import { clamp, smoothstep } from '../../shared/noise.js';
import {
  POSICAO_LEME_LOCAL,
  POSICAO_EMBARQUE_LOCAL,
  PONTOS_SAIDA_LOCAL,
  nivelAguaEmCosta,
  criarEstadoBarco,
  passoBarco,
  localBarcoParaMundo,
  mundoParaLocalBarco,
  anguloNormalizado,
  eulerDoBarco,
  quatNormalizar,
  meiaBocaConvesLocal,
  alturaConvesLocalFallback,
  pontoNoConvesLocalFallback,
  resolverObstaculoBarcoLocalFallback,
  encontrarSitioVilaCosteira,
  pontoAtracacaoPadraoVila,
} from '../../shared/costa.js';
import * as barcoMod from '../render/barco-tidewater.js';
import * as vilaMod from '../render/vila-costeira3d.js';
import { U } from '../render/materials.js';
import { tecla } from './teclas.js';

const _tmpV = [0, 0, 0];
const _tmpCol = new THREE.Vector3();

function obterPontoVila(vila, vila3d) {
  if (vila3d && typeof vila3d.pontoAtracacaoBarco === 'function') {
    const p = vila3d.pontoAtracacaoBarco(vila);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
  }
  if (typeof vilaMod.pontoAtracacaoVila === 'function') {
    const p = vilaMod.pontoAtracacaoVila(vila);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
  }
  return null;
}

export function initCosta(ctx = {}) {
  const game = ctx.game || ctx;
  const world = ctx.world || game?.world || null;
  const player = ctx.player || game?.player || null;
  const net = ctx.net || game?.net || null;
  const ui = ctx.ui || game?.ui || null;
  const input = ctx.input || game?.input || null;
  const scene = ctx.scene || game?.scene || null;

  const root = new THREE.Group();
  root.name = 'CostaTidewater';
  if (scene) scene.add(root);

  const vila3d = typeof vilaMod.createVilaCosteira3D === 'function'
    ? vilaMod.createVilaCosteira3D({ scene: root })
    : null;

  const vilas = [];
  const barcos = new Map(); // id -> { st, view, slapT, engineAtivo, ultimoSrvMs }

  let abordo = null; // { barcoId, modo: 'conves' | 'leme', lx, ly, lz, velL: [0,0,0], naChao, ultimoBoatYaw, camAnt, pasDist }
  let promptAtual = null;
  let envioTimer = 0;
  let emissorAtivoSet = new Set();
  let passoMadeiraDist = 0;
  let posVilaAnt = null;
  let keyEAcionado = false;
  let ultimoFrameTeclaE = -1;
  let hookAudioAtivo = !!game?.audio;

  // Helpers de geometria local do barco: usa módulo @barco-3d quando disponível e cai para o fallback puro caso falte algo.
  const alturaConvesBarco = (view, lx, lz, lyAtual) => {
    if (view && typeof view.alturaConvesLocal === 'function') {
      const h = view.alturaConvesLocal(lx, lz, lyAtual);
      if (Number.isFinite(h)) return h;
    }
    if (typeof barcoMod.alturaConvesLocal === 'function') {
      const h = barcoMod.alturaConvesLocal(lx, lz, lyAtual);
      if (Number.isFinite(h)) return h;
    }
    return alturaConvesLocalFallback(lx, lz, lyAtual);
  };

  const pontoNoConves = (view, lx, lz) => {
    if (view && typeof view.pontoNoConvesLocal === 'function') return !!view.pontoNoConvesLocal(lx, lz);
    if (typeof barcoMod.pontoNoConvesLocal === 'function') return !!barcoMod.pontoNoConvesLocal(lx, lz);
    return pontoNoConvesLocalFallback(lx, lz);
  };

  const helmLocalPos = (view) => {
    const leme = barcoMod.POSICAO_LEME_LOCAL || POSICAO_LEME_LOCAL;
    const eye = view?.helmEye;
    return {
      x: leme.x ?? POSICAO_LEME_LOCAL.x,
      y: leme.y ?? POSICAO_LEME_LOCAL.y,
      z: leme.z ?? 0.69,
      eyeX: eye?.x ?? leme.x ?? POSICAO_LEME_LOCAL.x,
      eyeY: eye?.y ?? POSICAO_LEME_LOCAL.eyeY ?? 1.85,
      eyeZ: eye?.z ?? POSICAO_LEME_LOCAL.olhoZ ?? 0.3,
      raio: leme.raio ?? POSICAO_LEME_LOCAL.raio ?? 1.45,
    };
  };

  const boardLocalPos = (view) => {
    const src = view?.boardPoint || barcoMod.POSICAO_EMBARQUE_LOCAL || POSICAO_EMBARQUE_LOCAL;
    return [src.x ?? 0, src.y ?? 0.35, src.z ?? -1.75];
  };

  const exitLocalPoints = (view) => {
    const pts = view?.exitPoints;
    if (Array.isArray(pts) && pts.length) {
      return pts.map((p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]));
    }
    return PONTOS_SAIDA_LOCAL;
  };

  const resolverObstaculoLocal = (view, posL, velL, beforeX, beforeZ) => {
    const colFn = (view && typeof view.colideObstaculoBarcoLocal === 'function')
      ? view.colideObstaculoBarcoLocal
      : (typeof barcoMod.colideObstaculoBarcoLocal === 'function' ? barcoMod.colideObstaculoBarcoLocal : null);
    if (!colFn) {
      resolverObstaculoBarcoLocalFallback(posL, velL, 0.25, PLAYER_H, 0.45);
      return;
    }
    if (colFn(posL[0], posL[1], posL[2], 0.24)) {
      if (!colFn(posL[0], posL[1], beforeZ, 0.24)) {
        posL[2] = beforeZ;
        if (velL) velL[2] = 0;
      } else if (!colFn(beforeX, posL[1], posL[2], 0.24)) {
        posL[0] = beforeX;
        if (velL) velL[0] = 0;
      } else {
        posL[0] = beforeX;
        posL[2] = beforeZ;
        if (velL) { velL[0] = 0; velL[2] = 0; }
      }
    }
    posL[2] = clamp(posL[2], -3.6, 3.95);
    const halfIn = Math.max(0.15, meiaBocaConvesLocal(posL[2], Math.max(posL[1], 0.35)) - 0.31);
    posL[0] = clamp(posL[0], -halfIn, halfIn);
  };

  const sincronizarEmissorAudio = (id, spec) => {
    if (!hookAudioAtivo || !game?.audio?.setEmitter) return;
    emissorAtivoSet.add(id);
    game.audio.setEmitter(id, spec);
  };

  const removerEmissorAudio = (id) => {
    if (!emissorAtivoSet.has(id)) return;
    emissorAtivoSet.delete(id);
    game?.audio?.removeEmitter?.(id);
  };

  const criarOuAtualizarBarco = (raw) => {
    if (!raw || !raw.id) return null;
    let rec = barcos.get(raw.id);
    if (!rec) {
      const st = criarEstadoBarco(raw);
      const view = typeof barcoMod.createBarcoTidewater === 'function'
        ? barcoMod.createBarcoTidewater({ id: st.id, nome: st.nome })
        : null;
      if (view?.group) root.add(view.group);
      rec = { st, view, slapT: 0.4, engineAtivo: false, ultimoSrvMs: performance.now() };
      barcos.set(st.id, rec);
    } else {
      const st = rec.st;
      const souPiloto = !!(abordo && abordo.barcoId === st.id && abordo.modo === 'leme' && raw.piloto === net?.id);
      st.vilaId = raw.vilaId ?? st.vilaId;
      st.nome = raw.nome ?? st.nome;
      st.piloto = raw.piloto ?? null;
      st.pilotoNome = raw.pilotoNome ?? '';
      st.ocupantes = Array.isArray(raw.ocupantes) ? raw.ocupantes : [];
      st.atracado = raw.atracado !== undefined ? !!raw.atracado : st.atracado;
      if (raw.ancoragem) st.ancoragem = { ...raw.ancoragem };
      rec.ultimoSrvMs = performance.now();

      if (!souPiloto) {
        if (Array.isArray(raw.pos) && raw.pos.length === 3) {
          const dist = Math.hypot(raw.pos[0] - st.pos[0], raw.pos[1] - st.pos[1], raw.pos[2] - st.pos[2]);
          if (dist > 6) {
            st.pos[0] = raw.pos[0]; st.pos[1] = raw.pos[1]; st.pos[2] = raw.pos[2];
          } else {
            const blend = dist > 0.6 ? 0.5 : 0.25;
            st.pos[0] += (raw.pos[0] - st.pos[0]) * blend;
            st.pos[1] += (raw.pos[1] - st.pos[1]) * blend;
            st.pos[2] += (raw.pos[2] - st.pos[2]) * blend;
          }
        }
        if (Array.isArray(raw.q) && raw.q.length === 4) {
          for (let i = 0; i < 4; i++) st.q[i] += (raw.q[i] - st.q[i]) * 0.35;
          quatNormalizar(st.q);
        }
        if (Array.isArray(raw.vel) && raw.vel.length === 3) {
          st.vel[0] = raw.vel[0]; st.vel[1] = raw.vel[1]; st.vel[2] = raw.vel[2];
        }
        if (Array.isArray(raw.ang) && raw.ang.length === 3) {
          st.ang[0] = raw.ang[0]; st.ang[1] = raw.ang[1]; st.ang[2] = raw.ang[2];
        }
        if (Number.isFinite(raw.acelerador)) st.acelerador = raw.acelerador;
        if (Number.isFinite(raw.leme)) st.leme = raw.leme;
        if (Number.isFinite(raw.rpm)) st.rpm = raw.rpm;
        const e = eulerDoBarco(st);
        st.yaw = e.yaw; st.pitch = e.pitch; st.roll = e.roll;
        st.velEscalar = Number.isFinite(raw.velEscalar) ? raw.velEscalar : Math.hypot(st.vel[0], st.vel[1], st.vel[2]);
        st.velAvante = Number.isFinite(raw.velAvante) ? raw.velAvante : st.velAvante;
      }
    }
    return rec;
  };

  function aplicarEstado(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.vilas)) {
      vilas.length = 0;
      for (const v of data.vilas) if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) vilas.push({ ...v });
      if (vila3d && typeof vila3d.sincronizar === 'function') vila3d.sincronizar(vilas);
    }
    if (Array.isArray(data.barcos)) {
      const vistos = new Set();
      for (const raw of data.barcos) {
        const rec = criarOuAtualizarBarco(raw);
        if (rec) vistos.add(rec.st.id);
      }
      for (const [id, rec] of barcos) {
        if (vistos.has(id)) continue;
        if (abordo && abordo.barcoId === id) sairDoBarcoEstado();
        if (rec.view?.group && root) root.remove(rec.view.group);
        rec.view?.dispose?.();
        removerEmissorAudio('costa-boat-engine-' + id);
        removerEmissorAudio('costa-boat-lap-' + id);
        removerEmissorAudio('costa-boat-rush-' + id);
        barcos.delete(id);
      }
    }
  }

  function ambienteParaBarco() {
    const gen = game?.gen;
    return {
      mar: game?.mar || null,
      gen,
      t: U.uTime?.value || performance.now() / 1000,
      tempo: game?.weather || null,
      terrenoEm: gen && typeof gen.height === 'function'
        ? (x, z) => gen.height(Math.round(x), Math.round(z)) + 1
        : null,
      resolverObstaculo: vila3d && typeof vila3d.colideObstaculoEm === 'function'
        ? (posArr, raio, altura) => {
          if (!vila3d.colideObstaculoEm(posArr[0], posArr[1] + altura * 0.5, posArr[2], raio)) return false;
          if (typeof vila3d.resolverColisaoEm === 'function') {
            _tmpCol.set(posArr[0], posArr[1], posArr[2]);
            vila3d.resolverColisaoEm(_tmpCol, raio, altura);
            posArr[0] = _tmpCol.x; posArr[2] = _tmpCol.z;
          }
          return true;
        }
        : null,
    };
  }

  function chaoEm(x, z, yRef) {
    let best = -Infinity;
    if (vila3d && typeof vila3d.alturaPisoEm === 'function') {
      const hp = vila3d.alturaPisoEm(x, z, yRef);
      if (Number.isFinite(hp) && hp > best) best = hp;
    }
    const gen = game?.gen;
    if (gen && typeof gen.height === 'function') {
      const ht = gen.height(Math.round(x), Math.round(z)) + 1;
      if (ht <= yRef && ht > best) best = ht;
    }
    if (world && typeof world.getBlock === 'function') {
      const iy = Math.floor(Math.min(yRef, 155));
      const ix = Math.floor(x), iz = Math.floor(z);
      for (let yy = iy; yy >= Math.max(SEA - 2, iy - 4); yy--) {
        const b = world.getBlock(ix, yy, iz);
        if (b > 0 && b !== 10 && b !== 84 && b !== 85 && b !== 86 && b !== 87 && b !== 88 && b !== 89 && b !== 90) {
          if (yy + 1 > best) best = yy + 1;
          break;
        }
      }
    }
    return best;
  }

  function alvoDesembarqueEmTerra(rec) {
    const st = rec.st;
    const aguaY = game?.mar?.ligado ? game.mar.altura(st.pos[0], st.pos[2]) : MAR_NIVEL;
    const pts = exitLocalPoints(rec.view);
    const cosY = Math.cos(st.yaw), sinY = Math.sin(st.yaw);
    // Lateral (+X = bombordo em convenção do barco): rotacionada pelo yaw atual do casco
    const rx = cosY, rz = -sinY;
    let melhor = null, melhorScore = Infinity;

    for (let i = 0; i < pts.length; i++) {
      const ep = pts[i];
      const w = localBarcoParaMundo(st, ep[0], ep[1], ep[2], [0, 0, 0]);
      const sgn = ep[0] >= 0 ? 1 : -1;
      for (const reach of [0.9, 1.45, 2.1]) {
        const tx = w[0] + rx * sgn * reach;
        const tz = w[2] + rz * sgn * reach;
        const g = chaoEm(tx, tz, w[1] + 2.6);
        if (!Number.isFinite(g)) continue;
        const up = g - w[1];
        if (up > 1.75 || up < -1.2 || g < aguaY - 0.25) continue;
        const score = Math.abs(up) + reach * 0.2;
        if (score < melhorScore) {
          melhorScore = score;
          melhor = { x: tx, y: g, z: tz, ep };
        }
      }
    }
    return melhor;
  }

  function barcoMaisProximoParaEmbarque() {
    if (!player || (game?.dim || 0) !== 0) return null;
    const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
    let melhor = null, bestD = Infinity;
    for (const rec of barcos.values()) {
      const st = rec.st;
      const dx = px - st.pos[0], dz = pz - st.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 6.5 || Math.abs(py - st.pos[1]) > 4.2) continue;
      if (dist < bestD) { bestD = dist; melhor = rec; }
    }
    return melhor;
  }

  function entrarNoBarco(rec, paraLeme = false) {
    if (!rec || !player) return false;
    const st = rec.st;
    const bp = boardLocalPos(rec.view);
    const helm = helmLocalPos(rec.view);
    const loc = mundoParaLocalBarco(st, player.pos[0], player.pos[1], player.pos[2], [0, 0, 0]);
    const noConves = pontoNoConves(rec.view, loc[0], loc[2]);
    const lx = noConves ? loc[0] : bp[0];
    const lz = noConves ? loc[2] : bp[2];
    const ly = noConves ? alturaConvesBarco(rec.view, lx, lz, loc[1] + 0.5) : bp[1];

    abordo = {
      barcoId: st.id,
      modo: 'conves',
      lx,
      ly,
      lz,
      velL: [0, 0, 0],
      noChao: true,
      ultimoBoatYaw: st.yaw,
      pasDist: 0,
      camAnt: game.camWant,
    };
    player.vel[0] = player.vel[1] = player.vel[2] = 0;
    player.flying = false;
    player.inWater = false;
    player.headInWater = false;
    player.onGround = true;
    localBarcoParaMundo(st, lx, ly, lz, _tmpV);
    player.pos[0] = player.prev[0] = _tmpV[0];
    player.pos[1] = player.prev[1] = _tmpV[1];
    player.pos[2] = player.prev[2] = _tmpV[2];
    net?.send?.({ t: 'costa_embarcar', barcoId: st.id });

    if (paraLeme) assumirLeme();
    return true;
  }

  function assumirLeme() {
    if (!abordo) return false;
    const rec = barcos.get(abordo.barcoId);
    if (!rec) return false;
    const st = rec.st;
    if (st.piloto && st.piloto !== net?.id) {
      ui?.toast?.(`${st.pilotoNome || 'Outro navegador'} já está no leme.`, 2400);
      return false;
    }
    abordo.modo = 'leme';
    st.piloto = net?.id ?? -1;
    st.atracado = false;
    game.pilotando = true;
    const helm = helmLocalPos(rec.view);
    abordo.lx = helm.x;
    abordo.ly = helm.y;
    abordo.lz = helm.z;
    // Alinha o olhar para a proa quando assume o leme
    player.yaw = st.yaw + Math.PI;
    abordo.ultimoBoatYaw = st.yaw;
    net?.send?.({ t: 'costa_leme', barcoId: st.id, entrar: true });
    return true;
  }

  function deixarLeme() {
    if (!abordo || abordo.modo !== 'leme') return false;
    const rec = barcos.get(abordo.barcoId);
    abordo.modo = 'conves';
    game.pilotando = false;
    game.camWant = abordo.camAnt;
    if (rec) {
      const st = rec.st;
      if (st.piloto === (net?.id ?? -1) || st.piloto === net?.id) st.piloto = null;
      st.acelerador = 0;
      const helm = helmLocalPos(rec.view);
      abordo.lx = helm.x;
      abordo.ly = helm.y;
      abordo.lz = helm.z;
      abordo.velL = [0, 0, 0];
      abordo.noChao = true;
      net?.send?.({ t: 'costa_leme', barcoId: st.id, entrar: false });
    }
    return true;
  }

  function sairDoBarcoEstado() {
    abordo = null;
    game.pilotando = false;
    if (game) game.camWant = undefined;
    promptAtual = null;
  }

  function desembarcarBarco(forcarMar = false) {
    if (!abordo || !player) return false;
    const rec = barcos.get(abordo.barcoId);
    const st = rec?.st;
    if (abordo.modo === 'leme') deixarLeme();
    const destino = !forcarMar && rec && st.velEscalar < 2.6 ? alvoDesembarqueEmTerra(rec) : null;
    if (destino) {
      player.pos[0] = player.prev[0] = destino.x;
      player.pos[1] = player.prev[1] = destino.y;
      player.pos[2] = player.prev[2] = destino.z;
      player.vel[0] = player.vel[1] = player.vel[2] = 0;
      player.onGround = true;
      player.inWater = false;
    } else if (st) {
      const lado = abordo.lx >= 0 ? 1 : -1;
      const fora = localBarcoParaMundo(st, 2.25 * lado, 0, 0, [0, 0, 0]);
      const aguaY = game?.mar?.ligado ? game.mar.altura(fora[0], fora[2]) : MAR_NIVEL;
      player.pos[0] = player.prev[0] = fora[0];
      player.pos[1] = player.prev[1] = aguaY - 0.6;
      player.pos[2] = player.prev[2] = fora[2];
      player.vel[0] = player.vel[1] = player.vel[2] = 0;
      player.onGround = false;
      player.inWater = true;
      game?.audio?.play?.('splash', 0.75, 1, 'water', fora);
    }
    if (st) net?.send?.({ t: 'costa_desembarcar', barcoId: st.id });
    sairDoBarcoEstado();
    return true;
  }

  function tentarInteragir() {
    if ((game?.dim || 0) !== 0 || game?.state !== 'PLAYING' || game?.overlay) return false;
    if (abordo) {
      const rec = barcos.get(abordo.barcoId);
      if (!rec) { sairDoBarcoEstado(); return true; }
      if (abordo.modo === 'leme') return deixarLeme();
      const helm = helmLocalPos(rec.view);
      const distLeme = Math.hypot(abordo.lx - helm.x, abordo.lz - helm.z);
      if (distLeme < helm.raio) return assumirLeme();
      return desembarcarBarco(false);
    }
    const rec = barcoMaisProximoParaEmbarque();
    if (rec) return entrarNoBarco(rec, false);

    // Na água ao lado da escadinha do píer: ajuda a subir para o deck
    if (player && player.inWater && vila3d) {
      for (const v of vilas) {
        const pt = obterPontoVila(v, vila3d);
        const esc = pt?.escada;
        if (!esc) continue;
        if (Math.hypot(player.pos[0] - esc.x, player.pos[2] - esc.z) < 2.2) {
          const deckY = pt.deckY ?? (MAR_NIVEL + 2.3);
          const fx = Math.cos(v.dir), fz = Math.sin(v.dir);
          const rx = Math.sin(v.dir), rz = -Math.cos(v.dir);
          player.pos[0] = player.prev[0] = v.x + fx * 29.9 + rx * 5.6;
          player.pos[1] = player.prev[1] = deckY + 0.05;
          player.pos[2] = player.prev[2] = v.z + fz * 29.9 + rz * 5.6;
          player.vel[0] = player.vel[1] = player.vel[2] = 0;
          player.onGround = true;
          player.inWater = false;
          return true;
        }
      }
    }
    return false;
  }

  // Suporte extra à tecla E (além de interact = F / Toque Usar / VR B) sem roubar E da mochila em terra
  const onKeyDown = (ev) => {
    if (ev.code !== 'KeyE' || ev.repeat) return;
    if (game?.state !== 'PLAYING' || game?.overlay || (game?.dim || 0) !== 0) return;
    if (typeof game?.frames === 'number' && game.frames === ultimoFrameTeclaE) return;
    if (abordo || promptAtual || barcoMaisProximoParaEmbarque()) {
      keyEAcionado = true;
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown, true);

  function usaTeclaE() {
    keyEAcionado = false;
    if (typeof game?.frames === 'number') ultimoFrameTeclaE = game.frames;
    if ((game?.dim || 0) !== 0 || game?.state !== 'PLAYING' || game?.overlay) return false;
    if (abordo || promptAtual || barcoMaisProximoParaEmbarque()) return tentarInteragir();
    return false;
  }

  // ---- Hook 1: chão e colisões da vila costeira + embarque automático por cima do convés ----------
  function aplicarVilaNoJogador(p) {
    if (!p || (game?.dim || 0) !== 0 || abordo) return;
    // Verifica primeiro se caiu ou saltou diretamente dentro do convés de algum barco
    for (const rec of barcos.values()) {
      const st = rec.st;
      if (Math.hypot(p.pos[0] - st.pos[0], p.pos[2] - st.pos[2]) > 5.2) continue;
      const loc = mundoParaLocalBarco(st, p.pos[0], p.pos[1], p.pos[2], [0, 0, 0]);
      if (pontoNoConves(rec.view, loc[0], loc[2])) {
        const yDeck = alturaConvesBarco(rec.view, loc[0], loc[2], loc[1] + 0.55);
        if (loc[1] >= yDeck - 0.35 && loc[1] <= yDeck + 1.4 && p.vel[1] <= 1.2) {
          entrarNoBarco(rec, false);
          return;
        }
      }
    }

    if (!vila3d) return;
    if (typeof vila3d.resolverColisaoEm === 'function') {
      _tmpCol.set(p.pos[0], p.pos[1], p.pos[2]);
      const hit = vila3d.resolverColisaoEm(_tmpCol, PLAYER_W * 0.5, PLAYER_H);
      if (hit && hit.hit) {
        p.pos[0] = _tmpCol.x;
        p.pos[2] = _tmpCol.z;
      }
    }

    if (typeof vila3d.alturaPisoEm === 'function') {
      const yPiso = vila3d.alturaPisoEm(p.pos[0], p.pos[2], p.pos[1] + 0.55);
      if (Number.isFinite(yPiso) && yPiso >= p.pos[1] - 0.08 && p.vel[1] <= 0.5) {
        const dyAnt = p.pos[1];
        p.pos[1] = yPiso;
        p.vel[1] = 0;
        p.onGround = true;
        p.inWater = false;
        p.headInWater = false;
        p.flying = false;
        if (dyAnt >= SEA - 0.2 && posVilaAnt) {
          const moved = Math.hypot(p.pos[0] - posVilaAnt[0], p.pos[2] - posVilaAnt[1]);
          passoMadeiraDist += moved;
          if (passoMadeiraDist > 0.62) {
            passoMadeiraDist = 0;
            if (game) game.stepAt = player.walked;
            game?.audio?.play?.('step', 0.44, 1, 'wood');
          }
        }
        posVilaAnt = [p.pos[0], p.pos[2]];
        return;
      }
    }
    posVilaAnt = null;

    // Escada do píer dentro d'água (ponto `escada` do T-head)
    if (p.inWater && vilas.length) {
      for (const v of vilas) {
        const pt = obterPontoVila(v, vila3d);
        const esc = pt?.escada;
        if (!esc) continue;
        if (Math.hypot(p.pos[0] - esc.x, p.pos[2] - esc.z) < 1.25 && (input?.isDown('jump') || p.vel[1] > 0.2)) {
          const deckY = pt.deckY ?? (MAR_NIVEL + 2.3);
          p.pos[1] = Math.min(deckY + 0.02, p.pos[1] + 0.14);
          p.vel[1] = 0;
          if (p.pos[1] >= deckY - 0.85) {
            const fx = Math.cos(v.dir), fz = Math.sin(v.dir);
            const rx = Math.sin(v.dir), rz = -Math.cos(v.dir);
            p.pos[0] = v.x + fx * 29.9 + rx * 5.6;
            p.pos[2] = v.z + fz * 29.9 + rz * 5.6;
            p.pos[1] = deckY + 0.02;
            p.onGround = true;
            p.inWater = false;
          }
          break;
        }
      }
    }
  }

  if (player) {
    const extraAnt = player.extra;
    player.extra = (p) => {
      if (extraAnt) extraAnt(p);
      aplicarVilaNoJogador(p);
    };
  }

  // ---- Hook 2: física fixa (hidrostática dos barcos + convés/leme + rede) -----------------------
  function fixedStep(dt, intent) {
    if ((game?.dim || 0) !== 0) return false;
    const amb = ambienteParaBarco();
    const meuId = net?.id ?? -1;

    for (const rec of barcos.values()) {
      const st = rec.st;
      const estouPilotando = !!(abordo && abordo.barcoId === st.id && abordo.modo === 'leme');
      if (estouPilotando) {
        const avante = intent?.z || 0;
        const lado = intent?.x || 0;
        const acelAlvo = avante > 0.05 ? (intent?.sprint ? 1 : 0.7) * clamp(avante, 0, 1)
          : avante < -0.05 ? 0.6 * clamp(avante, -1, 0) : 0;
        // Em LAVRA intent.x < 0 é esquerda (A) e > 0 é direita (D); no barco +1 vira para bombordo (esquerda)
        const lemeAlvo = clamp(-lado, -1, 1);
        passoBarco(st, dt, { dirigindo: true, acelerador: acelAlvo, leme: lemeAlvo }, amb);
      } else if (!st.piloto || (performance.now() - rec.ultimoSrvMs > 750)) {
        passoBarco(st, dt, { dirigindo: false }, amb);
      }
    }

    if (!abordo || !player) {
      if (game) {
        game.pilotando = false;
        if (game.camWant !== undefined) game.camWant = undefined;
      }
      return false;
    }

    const rec = barcos.get(abordo.barcoId);
    if (!rec) { sairDoBarcoEstado(); return false; }
    const st = rec.st;

    // Acompanha suavemente o giro do casco com a cabeça do jogador
    const dBoatYaw = anguloNormalizado(st.yaw - abordo.ultimoBoatYaw);
    player.yaw += dBoatYaw;
    abordo.ultimoBoatYaw = st.yaw;

    if (abordo.modo === 'leme') {
      game.pilotando = true;
      game.camWant = game.view === 1 ? 10.5 : 0;
      const helm = helmLocalPos(rec.view);
      localBarcoParaMundo(st, helm.eyeX ?? helm.x, helm.eyeY - EYE_H, helm.eyeZ, _tmpV);
      player.pos[0] = player.prev[0] = _tmpV[0];
      player.pos[1] = player.prev[1] = _tmpV[1];
      player.pos[2] = player.prev[2] = _tmpV[2];
      player.vel[0] = st.vel[0];
      player.vel[1] = st.vel[1];
      player.vel[2] = st.vel[2];
      player.onGround = true;
      player.inWater = false;
      player.headInWater = false;
      player.flying = false;

      if ((envioTimer += dt) >= 1 / NET_TICK_HZ) {
        envioTimer = 0;
        if (st.piloto === meuId || net?.id !== undefined) {
          net?.send?.({
            t: 'costa_entrada',
            barcoId: st.id,
            acelerador: st.acelerador,
            leme: st.leme,
            pos: st.pos,
            q: st.q,
            vel: st.vel,
            ang: st.ang,
            rpm: st.rpm,
            yaw: st.yaw,
            pitch: st.pitch,
            roll: st.roll,
            velEscalar: st.velEscalar,
            velAvante: st.velAvante,
          });
        }
      }
      return true;
    }

    // Modo 'conves': caminhada precisa no referencial local do barco
    game.pilotando = false;
    game.camWant = undefined;
    const yawLocalCam = player.yaw - (st.yaw + Math.PI);
    const sin = Math.sin(yawLocalCam), cos = Math.cos(yawLocalCam);
    const wx = -(intent?.x || 0) * cos + (intent?.z || 0) * sin;
    const wz = (intent?.x || 0) * sin + (intent?.z || 0) * cos;
    const wishLen = Math.hypot(wx, wz);
    const nx = wishLen > 1e-4 ? wx / wishLen : 0;
    const nz = wishLen > 1e-4 ? wz / wishLen : 0;
    const speed = intent?.sprint ? 2.6 : 1.7;
    const k = 1 - Math.exp(-12 * dt);

    const oldX = abordo.lx, oldZ = abordo.lz;
    abordo.velL[0] += (nx * speed - abordo.velL[0]) * k;
    abordo.velL[2] += (nz * speed - abordo.velL[2]) * k;
    if (abordo.noChao && intent?.jump) {
      abordo.velL[1] = 3.4;
      abordo.noChao = false;
    }
    abordo.velL[1] -= 9.81 * dt;

    abordo.lx += abordo.velL[0] * dt;
    abordo.ly += abordo.velL[1] * dt;
    abordo.lz += abordo.velL[2] * dt;

    const posL = [abordo.lx, abordo.ly, abordo.lz];
    resolverObstaculoLocal(rec.view, posL, abordo.velL, oldX, oldZ);
    abordo.lx = posL[0];
    abordo.lz = posL[2];

    const yPisoDeck = alturaConvesBarco(rec.view, abordo.lx, abordo.lz, abordo.ly + 0.45);
    if (abordo.ly <= yPisoDeck) {
      abordo.ly = yPisoDeck;
      if (abordo.velL[1] < 0) abordo.velL[1] = 0;
      abordo.noChao = true;
    } else {
      abordo.noChao = abordo.ly - yPisoDeck < 0.04;
    }

    const moved = Math.hypot(abordo.lx - oldX, abordo.lz - oldZ);
    if (abordo.noChao && moved > 1e-4) {
      abordo.pasDist += moved;
      player.walked += moved;
      if (abordo.pasDist > 0.6) {
        abordo.pasDist = 0;
        if (game) game.stepAt = player.walked;
        game?.audio?.play?.('step', 0.46, 1, 'wood');
      }
    }

    localBarcoParaMundo(st, abordo.lx, abordo.ly, abordo.lz, _tmpV);
    player.pos[0] = player.prev[0] = _tmpV[0];
    player.pos[1] = player.prev[1] = _tmpV[1];
    player.pos[2] = player.prev[2] = _tmpV[2];
    player.vel[0] = st.vel[0];
    player.vel[1] = st.vel[1];
    player.vel[2] = st.vel[2];
    player.onGround = abordo.noChao;
    player.inWater = false;
    player.headInWater = false;
    player.flying = false;
    return true;
  }

  // ---- Hook 3: prompts + interação PC (F/E), Toque (Usar) e VR (B) ------------------------------
  function interactStep(dt, playing) {
    if ((game?.dim || 0) !== 0 || !playing) {
      promptAtual = null;
      return false;
    }

    if (keyEAcionado) {
      keyEAcionado = false;
      if ((typeof game?.frames !== 'number' || game.frames !== ultimoFrameTeclaE)
        && (abordo || promptAtual || barcoMaisProximoParaEmbarque())) {
        tentarInteragir();
        return true;
      }
    }

    const chave = `${tecla(game, 'interact')}${game?.xr?.presenting || game?.toque ? '' : ' ou E'}`;
    if (abordo) {
      const rec = barcos.get(abordo.barcoId);
      if (!rec) { sairDoBarcoEstado(); return false; }
      if (abordo.modo === 'leme') {
        promptAtual = { tipo: 'sair-leme', texto: `Leme: W/S acelera · A/D vira · ${chave} solta · V câmera` };
      } else {
        const helm = helmLocalPos(rec.view);
        const distLeme = Math.hypot(abordo.lx - helm.x, abordo.lz - helm.z);
        if (distLeme < helm.raio) {
          promptAtual = { tipo: 'leme', texto: `Assumir o leme (${chave})` };
        } else {
          const terra = rec.st.velEscalar < 2.6 ? alvoDesembarqueEmTerra(rec) : null;
          promptAtual = { tipo: terra ? 'desembarcar' : 'pular', texto: terra ? `Desembarcar no píer (${chave})` : `Pular na água (${chave})` };
        }
      }
      ui?.setHint?.(promptAtual.texto);
      if (input?.wasPressed?.('interact')) {
        tentarInteragir();
        return true;
      }
      return true;
    }

    const perto = barcoMaisProximoParaEmbarque();
    if (perto) {
      promptAtual = { tipo: 'embarcar', texto: `Embarcar em ${perto.st.nome} (${chave})`, barcoId: perto.st.id };
      if (input?.wasPressed?.('interact')) {
        tentarInteragir();
        return true;
      }
      ui?.setHint?.(promptAtual.texto);
      return true;
    }

    promptAtual = null;
    return false;
  }

  // ---- Hook 4: atualização visual 3D + áudio espacial por quadro -------------------------------
  function frameStep(dt) {
    const dim0 = (game?.dim || 0) === 0;
    root.visible = dim0;
    if (!dim0) {
      for (const id of [...emissorAtivoSet]) removerEmissorAudio(id);
      return;
    }

    const nightFactor = clamp(U.uNight?.value ?? 0, 0, 1);
    const t = U.uTime?.value ?? performance.now() / 1000;
    const windV = U.uWind?.value;
    const vento = windV ? { x: windV.x, y: windV.y, z: windV.z } : undefined;
    if (vila3d && typeof vila3d.atualizar === 'function') {
      vila3d.atualizar(dt, t, nightFactor, vento);
    }

    const px = player ? player.pos[0] : 0;
    const py = player ? player.pos[1] : MAR_NIVEL;
    const pz = player ? player.pos[2] : 0;

    // Ondinha calma batendo nas estacas dos píeres costeiros
    for (const v of vilas) {
      const emId = 'costa-pier-' + v.id;
      const hx = v.x + Math.cos(v.dir) * 28, hz = v.z + Math.sin(v.dir) * 28;
      const dist = Math.hypot(hx - px, hz - pz);
      if (dist < 85) {
        sincronizarEmissorAudio(emId, {
          key: 'ambiente.pier_lap',
          pos: [hx, MAR_NIVEL + 0.3, hz],
          volume: 0.26,
          pitch: 1,
          refDist: 6,
          maxDist: 64,
        });
      } else {
        removerEmissorAudio(emId);
      }
    }

    const ambFrame = ambienteParaBarco();
    for (const rec of barcos.values()) {
      const st = rec.st;
      const v = rec.view;
      if (v) {
        v.group.position.set(st.pos[0], st.pos[1], st.pos[2]);
        v.group.quaternion.set(st.q[0], st.q[1], st.q[2], st.q[3]);
        v.setThrottle?.(st.acelerador);
        v.setSteering?.(st.leme);
        v.setPropellerRPM?.(st.rpm * 2400 * Math.sign(st.acelerador || 1));
        v.setNavLights?.(nightFactor > 0.35 || !!st.piloto);
        v.setLuzes?.(nightFactor);
        v.update?.(dt, {
          throttle: st.acelerador,
          steer: st.leme,
          rpm: st.rpm,
          speed: st.velEscalar,
          forwardSpeed: st.velAvante,
          vel: st.vel,
          wind: vento,
          time: t,
          nightFactor,
          sampleWaterAt: (x, z) => nivelAguaEmCosta(x, z, t, ambFrame),
          onSlam: (forca = 0.5) => {
            if (hookAudioAtivo) {
              game.audio.play?.('hull_slap', clamp(forca * 0.5, 0.12, 0.65), 0.92 + Math.random() * 0.16, 'water', [st.pos[0], st.pos[1], st.pos[2]], { refDist: 6 });
            }
          },
        });
      }

      const dist = Math.hypot(st.pos[0] - px, st.pos[2] - pz);
      const idEng = 'costa-boat-engine-' + st.id;
      const idLap = 'costa-boat-lap-' + st.id;
      const idRush = 'costa-boat-rush-' + st.id;

      if (dist < 95 && Math.abs(st.pos[1] - py) < 55) {
        const sp = st.velEscalar || 0;
        const ligado = !!(st.piloto || st.rpm > 0.03);
        const insideCabin = abordo && abordo.barcoId === st.id && abordo.lz > -0.35 && abordo.lz < 1.45;
        const volEng = ligado ? clamp((0.18 + 0.38 * st.rpm) * (insideCabin ? 0.72 : 1), 0, 0.7) : 0;

        sincronizarEmissorAudio(idEng, {
          key: 'ambiente.boat_engine',
          pos: [st.pos[0], st.pos[1] + 0.3, st.pos[2]],
          vel: st.vel,
          volume: volEng,
          pitch: 0.68 + 0.72 * st.rpm,
          refDist: 5,
          maxDist: 75,
        });
        sincronizarEmissorAudio(idLap, {
          key: 'ambiente.boat_lap',
          pos: [st.pos[0], st.pos[1], st.pos[2]],
          vel: st.vel,
          volume: (1 - smoothstep(1.5, 5.0, sp)) * 0.24,
          pitch: 1,
          refDist: 4,
          maxDist: 48,
        });
        sincronizarEmissorAudio(idRush, {
          key: 'ambiente.boat_rush',
          pos: [st.pos[0], st.pos[1], st.pos[2]],
          vel: st.vel,
          volume: smoothstep(0.4, 9.0, sp) * 0.36,
          pitch: 0.88 + 0.28 * clamp(sp / 12, 0, 1),
          refDist: 5,
          maxDist: 64,
        });

        // Batida de onda no casco em velocidade ou impacto contra o fundo/cais
        rec.slapT -= dt;
        if ((sp > 1.2 && rec.slapT <= 0) || st.batida > 1.4) {
          const ritmo = Math.max(0.24, 0.85 - clamp(sp / 14, 0, 0.55));
          rec.slapT = ritmo + Math.random() * 0.35;
          const volSlap = clamp(Math.max(smoothstep(1.2, 8.5, sp) * 0.42, (st.batida || 0) * 0.16), 0.1, 0.65);
          if (hookAudioAtivo) {
            game.audio.play?.('hull_slap', volSlap, 0.92 + Math.random() * 0.16, 'water', [st.pos[0], st.pos[1], st.pos[2]], { refDist: 6 });
          }
        }
      } else {
        removerEmissorAudio(idEng);
        removerEmissorAudio(idLap);
        removerEmissorAudio(idRush);
      }
    }
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.t === 'costa_sync') { aplicarEstado(msg); return true; }
    if (msg.t === 'costa_estado') {
      if (msg.barco) criarOuAtualizarBarco(msg.barco);
      return true;
    }
    if ((msg.t === 'welcome' || msg.t === 'dim')) {
      if ((msg.dim || 0) !== 0) sairDoBarcoEstado();
      if (msg.costa) aplicarEstado(msg.costa);
      return true;
    }
    if (msg.t === 'offline' && game?.gen && !vilas.length) {
      const v = encontrarSitioVilaCosteira(game.gen, {
        pertoDe: game.spawn || { x: 0, z: 0 },
        portos: game.gen?.arq?.portos,
        proteger: game.gen?.arq?.mapa?.proteger,
        seed: game.seed || 1337,
      });
      if (v) {
        const b = pontoAtracacaoPadraoVila(v);
        aplicarEstado({
          vilas: [v],
          barcos: [{
            id: 'barco-costeiro-1',
            vilaId: v.id,
            nome: `Barco de ${v.nome}`,
            x: b.x,
            y: b.y,
            z: b.z,
            yaw: b.yaw,
            atracado: true,
            ancoragem: b,
          }],
        });
      }
      return true;
    }
    if (msg.t === 'leave' && msg.id != null) {
      for (const rec of barcos.values()) {
        if (rec.st.piloto === msg.id) { rec.st.piloto = null; rec.st.pilotoNome = ''; rec.st.acelerador = 0; }
        if (Array.isArray(rec.st.ocupantes)) rec.st.ocupantes = rec.st.ocupantes.filter((id) => id !== msg.id);
      }
      return true;
    }
    return false;
  }

  // Registro nos hooks do jogo quando fornecidos em `game.hooks`
  if (game?.hooks) {
    game.hooks.fixed?.push(fixedStep);
    game.hooks.interact?.push(interactStep);
    game.hooks.frame?.push(frameStep);
    game.hooks.other?.push(onMessage);
  }

  // ---- Marcadores para Mapa, Minimapa e Bússola -------------------------------------------------
  function marcadores() {
    const out = [];
    for (const v of vilas) {
      out.push({
        id: v.id,
        kind: 'vila',
        subkind: 'tidewater',
        nome: v.nome || 'Vila Costeira',
        x: v.x,
        z: v.z,
        dir: v.dir,
        icone: '⚓',
        cor: '#f3d286',
      });
    }
    for (const rec of barcos.values()) {
      const st = rec.st;
      out.push({
        id: st.id,
        kind: 'boat',
        subkind: 'tidewater',
        nome: st.nome || 'Barco Tidewater',
        x: st.pos[0],
        z: st.pos[2],
        yaw: st.yaw,
        icone: '🚤',
        cor: abordo?.barcoId === st.id ? '#6ee7b7' : '#7dd3fc',
        hot: abordo?.barcoId === st.id,
      });
    }
    return out;
  }

  function dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown, true);
    for (const id of [...emissorAtivoSet]) removerEmissorAudio(id);
    for (const rec of barcos.values()) rec.view?.dispose?.();
    barcos.clear();
    vila3d?.dispose?.();
    if (scene && root) scene.remove(root);
    sairDoBarcoEstado();
    if (game && game.costa === api) game.costa = null;
  }

  const api = {
    root,
    vila3d,
    vilas,
    barcos,
    aplicarEstado,
    onMessage,
    fixedStep,
    interactStep,
    frameStep,
    tentarInteragir,
    usaTeclaE,
    entrarNoBarco,
    desembarcarBarco,
    assumirLeme,
    deixarLeme,
    marcadores,
    dispose,
    get abordo() { return abordo; },
    get pilotando() { return abordo?.modo === 'leme'; },
  };
  if (game) game.costa = api;
  return api;
}

export const createCosta = initCosta;
