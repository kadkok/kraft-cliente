// A cabine elipsoidal acompanha o rumo do GLB, cujo nariz aponta para +Z.
import { VEICULOS } from './veiculos-kids.js';

const escala = VEICULOS.helicoptero.escala;
export const ALCANCE_PORTA = 4.5;

export function distanciaCabine(v, origem, dir) {
  const c = Math.cos(v.h), s = Math.sin(v.h);
  const px = origem[0] - v.x, pz = origem[2] - v.z;
  const x = (c * px - s * pz) / (0.85 * escala);
  const y = (origem[1] - v.y - 0.08 * escala) / (0.76 * escala);
  const z = (s * px + c * pz - 0.25 * escala) / (1.32 * escala);
  const dx = (c * dir[0] - s * dir[2]) / (0.85 * escala);
  const dy = dir[1] / (0.76 * escala);
  const dz = (s * dir[0] + c * dir[2]) / (1.32 * escala);
  const a = dx*dx + dy*dy + dz*dz, b = x*dx + y*dy + z*dz, fora = x*x + y*y + z*z - 1;
  if (fora <= 0) return 0;
  const delta = b*b - a*fora;
  if (a === 0 || b >= 0 || delta < 0) return Infinity;
  return (-b - Math.sqrt(delta)) / a;
}

// Tente as duas portas e depois a frente. O jogador só sai se o corpo inteiro
// couber. No ar, a saída acontece na altura dos patins e a física normal assume.
export function saidaHelicoptero(v, sondar, livre) {
  const c = Math.cos(v.h), s = Math.sin(v.h), patins = v.y - VEICULOS.helicoptero.base;
  for (const [lado, frente] of [[2.0,0.3],[-2.0,0.3],[2.15,1.2],[-2.15,1.2],[0,3.0]]) {
    const x = v.x + lado*c + frente*s, z = v.z - lado*s + frente*c;
    const solo = sondar(x,z), piso = solo.molhado ? Math.max(solo.agua,solo.chao) : solo.chao;
    if (piso > patins + 1.05) continue;
    const p = [x, Math.max(patins,piso) + 0.05, z];
    if (livre(p)) return p;
  }
  return null;
}

// A aeronave sem piloto perde rotação, nivela e conclui uma descida vertical.
// Devolve true enquanto há algo a animar. No chão não há trabalho por quadro.
export function assentarHelicoptero(v, terreno, delta) {
  const dt = Math.min(0.1, Math.max(0, delta));
  const piso = (terreno.molhado ? terreno.agua : terreno.chao) + VEICULOS.helicoptero.base;
  v.rpm = Math.max(0, v.rpm - dt * 0.48);
  v.pitch *= 1 - dt*3;
  v.roll *= 1 - dt*3;
  if (Math.abs(v.pitch) + Math.abs(v.roll) < 0.003) v.pitch = v.roll = 0;
  if (v.y > piso) {
    v.vy = Math.max(-3.7, Math.min(0,v.vy) - dt * 2.2);
    v.y = Math.max(piso, v.y + v.vy * dt);
  } else v.y = piso;
  if (v.y === piso) v.vy = 0;
  return v.y > piso || v.rpm > 0 || v.pitch !== 0 || v.roll !== 0;
}
