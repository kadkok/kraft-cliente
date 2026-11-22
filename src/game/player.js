// LAVRA — corpo do jogador: movimento, gravidade, nado, voo e colisão com os voxels.
// Roda em passo fixo (60 Hz). Não desenha nada e não lê teclado: recebe intenções prontas.

import { PLAYER_W, PLAYER_H, EYE_H, Y_TOP } from '../../shared/constants.js';
import { B, SOLID } from '../../shared/blocks.js';
import { boxSolid, floorHeight } from '../../shared/surfaces.js';
import { wetAt } from '../../shared/water.js';

const HW = PLAYER_W / 2;
const EPS = 1e-4;
const TETO_VOO = 3990;   // a sincronização do jogador admite posições até 4000 metros
const GRAVITY = 27, JUMP = 8.7, WALK = 4.4, SPRINT = 6.4, SNEAK = 1.7, SWIM = 3.3, FLY = 11, FLY_FAST = 26;

export function createPlayer(world) {
  // fundo do plano em que se está (world.js: Y_MIN no plano de cima, 0 nos outros); testes passam leitores sem ele
  const fundoDoMundo = () => (Number.isFinite(world.fundo) ? world.fundo : 0);
  const p = {
    pos: [0, 80, 0],        // centro dos pés
    prev: [0, 80, 0],       // posição do passo anterior (para interpolar o desenho)
    vel: [0, 0, 0],
    yaw: 0, pitch: 0,
    onGround: false, inWater: false, headInWater: false, flying: false, sneaking: false,
    jumped: false, sprinting: false,
    noclip: false,          // espectador (game/modes.js): voa e atravessa os blocos
    autoJump: false,
    walked: 0,              // distância andada no chão (som de passos)
    landed: 0,              // velocidade do último pouso (som), consumida por quem lê
    extra: null,            // colisor extra: (pos, vel) => ajusta a posição contra objetos livres
  };

  function solidAt(x, y, z) {
    const b = world.getBlock(x, y, z);
    return b === -1 || SOLID[b] === 1;
  }
  const collisionGet=(x,y,z)=>(world.collisionBlock||world.getBlock)(x,y,z);
  collisionGet.shape=(x,y,z)=>world.getBlock.shape?.(x,y,z)??15;
  function collides(x,y,z){return boxSolid(collisionGet,x-HW,y,z-HW,x+HW,y+PLAYER_H,z+HW);}

  // Move num eixo e encosta na parede se bater. Devolve true se bateu.
  function moveAxis(axis, d) {
    if (d === 0) return false;
    let hit = false;
    const steps = Math.ceil(Math.abs(d) / 0.45);
    const step = d / steps;
    for (let i = 0; i < steps; i++) {
      const pos = p.pos;
      const old = pos[axis];
      pos[axis] = old + step;
      if (!collides(pos[0], pos[1], pos[2])) continue;
      if(axis!==1&&p.onGround&&p.vel[1]<=0&&!p.flying){
        const h=floorHeight(collisionGet,pos[0],pos[2],pos[1]+Math.abs(step)*2+EPS,Math.abs(step)*2+EPS,HW,true);
        if(Number.isFinite(h)&&h>=pos[1]-EPS&&!collides(pos[0],h+EPS,pos[2])){pos[1]=h+EPS;continue;}
        const stepH=floorHeight(collisionGet,pos[0],pos[2],pos[1]+0.52,0.52,HW,false);
        if(Number.isFinite(stepH)&&stepH>pos[1]-EPS&&stepH<=pos[1]+0.52&&!collides(pos[0],stepH+EPS,pos[2])){pos[1]=stepH+EPS;continue;}
      }
      let low=0,high=1;
      for(let n=0;n<14;n++){const t=(low+high)/2;pos[axis]=old+step*t;if(collides(pos[0],pos[1],pos[2]))high=t;else low=t;}
      pos[axis]=old+step*low;
      hit = true;
      break;
    }
    return hit;
  }

  // dentro d'água de verdade: abaixo da superfície daquela célula (a água corrente é mais baixa que o bloco)
  function waterAt(x, y, z) { return wetAt(world.getBlock, x, y, z); }

  // intent: { x, z } movimento no plano local (direita, frente), jump, sneak, sprint
  function step(dt, intent) {
    const pos = p.pos, vel = p.vel;
    p.prev[0] = pos[0]; p.prev[1] = pos[1]; p.prev[2] = pos[2];
    if (p.noclip) return ghost(dt, intent);
    if (!world.isLoaded(pos[0], pos[2])) return; // sem chão carregado: espera, não cai

    // preso dentro de um bloco (colocaram em cima de mim): sobe até livrar
    if (collides(pos[0], pos[1], pos[2])) {
      for (let i = 0; i < 4 && collides(pos[0], pos[1], pos[2]) && pos[1] < Y_TOP + 2; i++) pos[1] += 0.25;
      vel[1] = 0;
    }

    p.inWater = waterAt(pos[0], pos[1] + 0.4, pos[2]);
    p.headInWater = waterAt(pos[0], pos[1] + EYE_H, pos[2]);
    p.sneaking = intent.sneak && !p.flying;
    p.sprinting = !!(intent.sprint && !p.sneaking && !p.flying && !p.inWater && (intent.x || intent.z));

    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    // frente = -Z na convenção da câmera; yaw gira em torno de Y
    const wx = intent.x * cos - intent.z * sin;
    const wz = -intent.x * sin - intent.z * cos;
    let speed = p.flying ? (intent.sprint ? FLY_FAST : FLY) : p.inWater ? SWIM : p.sneaking ? SNEAK : intent.sprint ? SPRINT : WALK;
    const k = p.flying ? 9 : p.onGround ? 14 : p.inWater ? 5 : 3.2;
    const a = Math.min(1, k * dt);
    vel[0] += (wx * speed - vel[0]) * a;
    vel[2] += (wz * speed - vel[2]) * a;

    if (p.flying) {
      const vy = ((intent.jump ? 1 : 0) - (intent.sneak ? 1 : 0)) * (intent.sprint ? FLY_FAST * 0.6 : FLY * 0.8);
      vel[1] += (vy - vel[1]) * Math.min(1, 10 * dt);
    } else if (p.inWater) {
      vel[1] -= 7 * dt;
      vel[1] *= Math.max(0, 1 - 2.4 * dt);
      if (intent.jump) vel[1] += (3.6 - vel[1]) * Math.min(1, 8 * dt);
      if (vel[1] < -3) vel[1] = -3;
    } else {
      vel[1] -= GRAVITY * dt;
      if (vel[1] < -60) vel[1] = -60;
      if (intent.jump && p.onGround) { vel[1] = JUMP; p.onGround = false; p.jumped = true; }
    }

    // no agachar, não sai da beirada
    const edgeGuard = p.sneaking && p.onGround;
    const bx = pos[0], bz = pos[2];
    const hitX = moveAxis(0, vel[0] * dt);
    if (edgeGuard && !collides(pos[0], pos[1] - 0.6, pos[2])) pos[0] = bx;
    const hitZ = moveAxis(2, vel[2] * dt);
    if (edgeGuard && !collides(pos[0], pos[1] - 0.6, pos[2])) pos[2] = bz;
    if (hitX) vel[0] = 0;
    if (hitZ) vel[2] = 0;

    if(p.onGround&&vel[1]<=0&&!p.flying){
      const drop=Math.hypot(pos[0]-bx,pos[2]-bz)*2+.025;
      const h=floorHeight(collisionGet,pos[0],pos[2],pos[1]+EPS,drop,HW);
      if(Number.isFinite(h)&&!collides(pos[0],h+EPS,pos[2]))pos[1]=h+EPS;
    }
    const vy = vel[1];
    const hitY = moveAxis(1, vy * dt);
    if (p.flying && fundoDoMundo() < 0 && pos[1] > TETO_VOO) { pos[1] = TETO_VOO; vel[1] = 0; }
    const wasGround = p.onGround;
    p.onGround = hitY && vy <= 0;
    if (hitY) {
      if (p.onGround && !wasGround && vy < -6) p.landed = -vy;
      vel[1] = 0;
      if (p.onGround && p.flying) p.flying = false; // pousou
    }

    // sair da água para a margem: um impulso quando nada contra um degrau
    if (p.inWater && !p.headInWater && intent.jump && (hitX || hitZ)) vel[1] = Math.max(vel[1], 6.5);

    // pulo automático: bloqueado por um degrau de 1 bloco com espaço livre em cima
    if (p.autoJump && p.onGround && (hitX || hitZ) && (wx !== 0 || wz !== 0)) {
      const l = Math.hypot(wx, wz);
      const fx = pos[0] + (wx / l) * 0.45, fz = pos[2] + (wz / l) * 0.45;
      if (!collides(fx, pos[1] + 1.02, fz)) { vel[1] = JUMP; p.onGround = false; }
    }

    if (p.extra) p.extra(p);

    if (p.onGround) p.walked += Math.hypot(pos[0] - p.prev[0], pos[2] - p.prev[2]);
    if (pos[1] < fundoDoMundo() - 40) { pos[1] = Y_TOP; vel[1] = 0; } // caiu do mundo (abaixo do fundo do plano): volta por cima
  }

  // Espectador: voo livre, sem colisão, sem água e sem chão (é o voo de sempre, atravessando tudo).
  function ghost(dt, intent) {
    const pos = p.pos, vel = p.vel;
    p.onGround = p.inWater = p.headInWater = p.sneaking = false;
    p.flying = true;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const wx = intent.x * cos - intent.z * sin, wz = -intent.x * sin - intent.z * cos;
    const speed = intent.sprint ? FLY_FAST : FLY, a = Math.min(1, 9 * dt);
    vel[0] += (wx * speed - vel[0]) * a;
    vel[2] += (wz * speed - vel[2]) * a;
    const vy = ((intent.jump ? 1 : 0) - (intent.sneak ? 1 : 0)) * (intent.sprint ? FLY_FAST * 0.6 : FLY * 0.8);
    vel[1] += (vy - vel[1]) * Math.min(1, 10 * dt);
    for (let i = 0; i < 3; i++) pos[i] += vel[i] * dt;
    if (pos[1] < fundoDoMundo() - 30) pos[1] = fundoDoMundo() - 30;
    const teto = fundoDoMundo() < 0 ? TETO_VOO : Y_TOP + 80;
    if (pos[1] > teto) { pos[1] = teto; vel[1] = 0; }
  }

  function eye(alpha, out) {
    out[0] = p.prev[0] + (p.pos[0] - p.prev[0]) * alpha;
    out[1] = p.prev[1] + (p.pos[1] - p.prev[1]) * alpha + EYE_H - (p.sneaking ? 0.14 : 0);
    out[2] = p.prev[2] + (p.pos[2] - p.prev[2]) * alpha;
    return out;
  }

  function teleport(x, y, z) {
    p.pos[0] = p.prev[0] = x; p.pos[1] = p.prev[1] = y; p.pos[2] = p.prev[2] = z;
    p.vel[0] = p.vel[1] = p.vel[2] = 0;
  }

  // o AABB do jogador ocupa a célula (x, y, z)?
  function occupies(x, y, z) {
    const pos = p.pos;
    return x + 1 > pos[0] - HW && x < pos[0] + HW && y + 1 > pos[1] && y < pos[1] + PLAYER_H && z + 1 > pos[2] - HW && z < pos[2] + HW;
  }

  // deslocamento direto com colisão (passos reais do jogador em VR)
  function nudge(dx, dz) { moveAxis(0, dx); moveAxis(2, dz); }

  return Object.assign(p, { step, eye, teleport, occupies, collides, nudge });
}
