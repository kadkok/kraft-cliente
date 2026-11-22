// LAVRA — mira, quebrar e colocar blocos (modo criativo).

import { Y_TOP, REACH, PLAYER_W, PLAYER_H } from '../../shared/constants.js';
import {
  B, KIND, SOLID, REPLACEABLE, BASE, FUNC, BLOCKS, IS_STAIR, withFacing,
  K_CROSS, K_LIQUID, F_THRUSTER, F_PROPELLER, F_CANNON, F_SEAT, F_WHEEL, F_WING,
} from '../../shared/blocks.js';
import { MINI_OK, TRONCO_OK, TRONCO_QUADRADO, axisFromNormal, quarterAt, quarterBox, withQuarter, miniAxis, miniMask, isMiniState, stairState, mcIdDoEstado, isMcState, IS_MC } from '../../shared/minis.js';
import { MC_BASE, mcEstado } from '../../shared/mc-estados.js';
import { mcNomePt } from '../../shared/mc-nomes.js';
import { mcColocar, mcPadrao } from '../../shared/mc-colocar.js';
import { raycastVoxels } from './../world/raycast.js';

const BREAK_EVERY = 0.2, PLACE_EVERY = 0.19;
const selectable = (id) => KIND[id] !== K_LIQUID;

// Escolhe a variante de uma peça direcional pelo olhar e pela face clicada.
export function orientBlock(base, look, nx, ny, nz) {
  const ax = Math.abs(look[0]), ay = Math.abs(look[1]), az = Math.abs(look[2]);
  const lookDir = ax > ay && ax > az ? (look[0] > 0 ? 0 : 1) : ay > az ? (look[1] > 0 ? 2 : 3) : (look[2] > 0 ? 4 : 5);
  const horiz = ax > az ? (look[0] > 0 ? 0 : 1) : (look[2] > 0 ? 4 : 5);
  switch (FUNC[base]) {
    case F_THRUSTER: case F_PROPELLER: case F_CANNON: return withFacing(base, lookDir);
    case F_SEAT: return withFacing(base, horiz);
    // roda: o eixo sai da face lateral em que foi presa
    case F_WHEEL: return withFacing(base, nx !== 0 ? 0 : nz !== 0 ? 4 : (ax > az ? 4 : 0));
    // asa: presa na lateral fica deitada; presa em cima vira leme, alinhado com o olhar
    case F_WING: return withFacing(base, ny !== 0 ? (ax > az ? 4 : 0) : 2);
    default: return base;
  }
}

export function createInteraction({ world, player, send, onBreak, onPlace, onDig, canEdit, beforeBreak, tentativaProtegida }) {
  const hit = { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, fx: 0, fy: 0, fz: 0, t: 0, id: 0 };
  // menor y que se edita: logo acima da rocha-mãe do fundo do plano (world.js; 1 fora do plano de cima, −63 nele)
  const piso = () => (Number.isFinite(world.fundo) ? world.fundo : 0) + 1;
  const selectableBlock=(x,y,z)=>(world.selectionBlock||world.getBlock)(x,y,z);
  selectableBlock.shape=(x,y,z)=>world.getBlock.shape?.(x,y,z)??15;
  selectableBlock.mini=(x,y,z)=>world.getMini?.(x,y,z)??0;
  let breakT = 0, placeT = 0, digSoundT = 0;
  let dig = null;     // quebra demorada em andamento (sobrevivência): { x, y, z, id, mini, t, need }
  const api = {
    target: hit,
    reach: REACH,
    miniMode: false,
    squareTrunk: false,
    // Modos de jogo (game/modes.js): `locked` = não quebra nem põe (aventura, espectador); `breakTime(id, x, y, z)` = segundos
    // segurando o botão para quebrar o bloco (sobrevivência; Infinity = não quebra; null = rápido, como no criativo).
    // `digging` = { x, y, z, k } enquanto se quebra devagar (k de 0 a 1): é por ele que se desenham as rachaduras.
    locked: false,
    breakTime: null,
    digging: null,
    blocked: null,   // (x, y, z) => true se outro corpo ocupa a célula (outros jogadores)

    aim(ox, oy, oz, dx, dy, dz) {
      raycastVoxels(selectableBlock, ox, oy, oz, dx, dy, dz, api.reach, selectable, hit);
      return hit;
    },

    set(x, y, z, id, mini = 0) {
      if (mini) { world.setBlock(x, y, z, id, mini); send(x, y, z, id, mini); }
      else { world.setBlock(x, y, z, id); send(x, y, z, id); }
    },

    breakTarget() {
      if (hit.hit && tentativaProtegida?.(hit)) return false;
      if (api.locked || !hit.hit || hit.id === B.BEDROCK) return false;
      if (canEdit && !canEdit(hit.x, hit.y, hit.z)) return false;
      const { x, y, z } = hit;
      // o buraco fica vazio: se houver água encostada, é a lei da água (shared/water.js) que decide se e como ela entra
      const old = hit.id;
      const curMini = world.getMini?.(x, y, z) || 0;
      if(beforeBreak?.(x,y,z,old)){onBreak?.(x,y,z,old,curMini);return true;}
      if (isMiniState(curMini) && !IS_STAIR[old]) {
        const axis = miniAxis(curMini);
        const fx = Math.max(0, Math.min(0.999, (hit.fx ?? 0.5) - hit.nx * 0.01));
        const fy = Math.max(0, Math.min(0.999, (hit.fy ?? 0.5) - hit.ny * 0.01));
        const fz = Math.max(0, Math.min(0.999, (hit.fz ?? 0.5) - hit.nz * 0.01));
        const q = quarterAt(axis, fx, fy, fz);
        if (miniMask(curMini) & (1 << q)) {
          const nextMini = withQuarter(curMini, axis, q, false);
          if (nextMini) {
            api.set(x, y, z, old, nextMini);
            if (onBreak) onBreak(x, y, z, old, curMini);
            return true;
          }
        }
      }
      api.set(x, y, z, B.AIR, 0);
      // planta em cima perde o apoio
      const above = world.getBlock(x, y + 1, z);
      if (above > 0 && KIND[above] === K_CROSS) api.set(x, y + 1, z, B.AIR, 0);
      if (onBreak) onBreak(x, y, z, old, curMini);
      return true;
    },

    placeAt(item, look) {
      if (!hit.hit || !item) return false;
      let x = hit.x, y = hit.y, z = hit.z;
      if (item >= MC_BASE) {                            // bloco do Minecraft: estado pelas regras de shared/mc-colocar.js
        if (KIND[hit.id] !== K_CROSS) { x += hit.nx; y += hit.ny; z += hit.nz; }
        return api.placeMc(x, y, z, item, look, [hit.nx, hit.ny, hit.nz], Math.max(0, Math.min(1, hit.fy ?? 0.5)));
      }
      if (api.miniMode && MINI_OK[item] && !IS_STAIR[item]) {
        const cross = KIND[hit.id] === K_CROSS;
        const wx = x + (hit.fx ?? 0.5) + (cross ? 0 : hit.nx * 0.01);
        const wy = y + (hit.fy ?? 0.5) + (cross ? 0 : hit.ny * 0.01);
        const wz = z + (hit.fz ?? 0.5) + (cross ? 0 : hit.nz * 0.01);
        const tx = cross ? x : Math.floor(wx), ty = cross ? y : Math.floor(wy), tz = cross ? z : Math.floor(wz);
        const lfx = Math.max(0, Math.min(0.999, wx - tx));
        const lfy = Math.max(0, Math.min(0.999, wy - ty));
        const lfz = Math.max(0, Math.min(0.999, wz - tz));
        return api.placeQuarter(tx, ty, tz, lfx, lfy, lfz, item, look, [hit.nx, hit.ny, hit.nz]);
      }
      // clicar numa planta substitui a própria planta
      if (KIND[hit.id] !== K_CROSS) { x += hit.nx; y += hit.ny; z += hit.nz; }
      return api.placeCell(x,y,z,item,look,[hit.nx,hit.ny,hit.nz]);
    },

    placeQuarter(x, y, z, fx, fy, fz, item, look, normal) {
      if (!item || y < piso() || y >= Y_TOP) return false;
      const id = orientBlock(item, look, ...normal.map(Math.round));
      if (!MINI_OK[id]) return api.placeCell(x, y, z, item, look, normal);
      const cur = world.getBlock(x, y, z);
      if (cur === -1) return false;
      const curMini = world.getMini?.(x, y, z) || 0;
      let axis, nextMini, q;
      if (REPLACEABLE[cur]) {
        axis = axisFromNormal(Math.round(normal[0]), Math.round(normal[1]), Math.round(normal[2]));
        q = quarterAt(axis, fx, fy, fz);
        nextMini = withQuarter(0, axis, q, true);
      } else if (cur === id && isMiniState(curMini)) {
        axis = miniAxis(curMini);
        q = quarterAt(axis, fx, fy, fz);
        if (miniMask(curMini) & (1 << q)) return false;
        nextMini = withQuarter(curMini, axis, q, true);
      } else {
        return false;
      }
      const b = quarterBox(axis, q);
      const pos = player.pos;
      const selfOcc = pos
        ? (x + b[3] > pos[0] - PLAYER_W / 2 && x + b[0] < pos[0] + PLAYER_W / 2 && y + b[4] > pos[1] && y + b[1] < pos[1] + PLAYER_H && z + b[5] > pos[2] - PLAYER_W / 2 && z + b[2] < pos[2] + PLAYER_W / 2)
        : player.occupies(x, y, z);
      if (selfOcc || (api.blocked && api.blocked(x, y, z))) return false;
      if (canEdit && !canEdit(x, y, z)) return false;
      api.set(x, y, z, id, nextMini);
      if (onPlace) onPlace(x, y, z, id);
      return true;
    },

    placeMc(x, y, z, item, look, normal, fy) {
      const lst = mcColocar(item, look, normal, fy);
      if (!lst.length) return false;
      for (const [dx, dy, dz] of lst) {
        const yy = y + dy, cur = world.getBlock(x + dx, yy, z + dz);
        if (yy < piso() || yy >= Y_TOP || cur === -1 || !REPLACEABLE[cur]) return false;
        if (canEdit && !canEdit(x + dx, yy, z + dz)) return false;
      }
      const id0 = mcIdDoEstado(lst[0][3]);
      if (id0 < 0) return false;
      if (id0 === B.MC_SOLIDO && (player.occupies(x, y, z) || (api.blocked && api.blocked(x, y, z)))) return false;
      for (const [dx, dy, dz, v] of lst) api.set(x + dx, y + dy, z + dz, mcIdDoEstado(v), v);
      if (onPlace) onPlace(x, y, z, id0, lst[0][3]);
      return true;
    },

    placeSurface(point,normal,item,look) {
      const cell=point.map((v,i)=>Math.floor(v+normal[i]*.51));
      return api.placeCell(...cell,item,look,normal);
    },

    placeCell(x,y,z,item,look,normal) {
      if(!item||api.locked)return false;
      if (y < piso() || y >= Y_TOP) return false;
      const cur = world.getBlock(x, y, z);
      if (cur === -1 || !REPLACEABLE[cur]) return false;
      const id = orientBlock(item, look, ...normal.map(Math.round));
      if (SOLID[id] && (player.occupies(x, y, z) || (api.blocked && api.blocked(x, y, z)))) return false;
      if (KIND[id] === K_CROSS) {
        const below = world.getBlock(x, y - 1, z);
        if (below <= 0 || !SOLID[below]) return false;
      }
      if (canEdit && !canEdit(x, y, z)) return false;
      const mini = IS_STAIR[id] ? stairState(look, normal?.[1] ?? 1) : (api.squareTrunk && TRONCO_OK[id] ? TRONCO_QUADRADO : 0);
      api.set(x, y, z, id, mini);
      if (onPlace) onPlace(x, y, z, id, mini);
      return true;
    },

    // input: breakHeld, breakPressed, placeHeld, placePressed
    update(dt, inp, item, look) {
      breakT -= dt; placeT -= dt;
      if (hit.hit && (inp.breakPressed || (inp.breakHeld && breakT <= 0)) && tentativaProtegida?.(hit)) {
        dig = null; api.digging = null; breakT = 0.35; return;
      }
      if (api.locked) { dig = null; api.digging = null; return; }
      if (api.breakTime) {
        // sobrevivência: segura o botão no mesmo bloco pelo tempo dele; trocar de bloco ou soltar recomeça
        if (inp.breakHeld && hit.hit && breakT <= 0) {
          const need = api.breakTime(hit.id, hit.x, hit.y, hit.z);   // a fundura deixa a rocha mais dura (game/modes.js)
          if (!Number.isFinite(need)) dig = null;
          else {
            const curMini = world.getMini?.(hit.x, hit.y, hit.z) || 0;
            if (!dig || dig.x !== hit.x || dig.y !== hit.y || dig.z !== hit.z || dig.id !== hit.id) {
              dig = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, mini: curMini, t: 0, need };
              digSoundT = 0;
            }
            dig.t += dt;
            digSoundT -= dt;
            if (digSoundT <= 0) { digSoundT = 0.24; onDig?.(dig.x, dig.y, dig.z, dig.id, dig.mini); }
            if (dig.t >= dig.need) { dig = null; if (api.breakTarget()) breakT = 0.25; }   // um respiro antes do próximo, como no Minecraft
          }
        } else if (!inp.breakHeld || !hit.hit) dig = null;
        api.digging = dig && dig.need > 0 ? { x: dig.x, y: dig.y, z: dig.z, k: Math.min(1, dig.t / dig.need) } : null;
      } else if (inp.breakPressed || (inp.breakHeld && breakT <= 0)) {
        if (api.breakTarget()) breakT = BREAK_EVERY;
      }
      if (inp.placePressed || (inp.placeHeld && placeT <= 0)) {
        if (api.placeAt(item, look)) placeT = PLACE_EVERY;
      }
    },

    pick() {
      if (!hit.hit) return 0;
      if (IS_MC(hit.id)) { const st = world.getMini?.(hit.x, hit.y, hit.z) || 0; return isMcState(st) ? mcPadrao(mcEstado(st - MC_BASE).nome) : 0; }
      return BASE[hit.id];
    },
    targetName() {
      if (!hit.hit) return '';
      if (IS_MC(hit.id)) { const st = world.getMini?.(hit.x, hit.y, hit.z) || 0; return isMcState(st) ? mcNomePt(st) : ''; }
      return BLOCKS[hit.id] ? BLOCKS[hit.id].name : '';
    },
  };
  return api;
}
