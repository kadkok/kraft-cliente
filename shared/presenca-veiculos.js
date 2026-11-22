import { TIPOS } from './veiculos-kids.js';

// O protocolo 1 já transporta oito bits de estado do avatar. Os quatro inferiores pertencem
// ao jogador. Em montaria, os três superiores identificam seu veículo e o bit 4 indica a fumaça.
export function estadoComVeiculo(estado, pose) {
  return pose ? (estado & 15) | ((pose[0] + 1) << 5) | (pose[6] ? 16 : 0) : estado;
}
export function indicePresente(estado = 0) {
  const i = (estado >>> 5) - 1;
  return i >= 0 && i < TIPOS.length ? i : -1;
}
const limitar = (n, a, b) => Math.max(a, Math.min(b, n));
const angulo = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Clientes em versões diferentes compartilham a mesma posição no mundo. Sem a pose detalhada,
// rodas, rotor e inclinação acompanham os deslocamentos já recebidos do outro jogador.
export function posePeloMovimento(estado, yaw, pitch, p, anterior, segundos, idade) {
  const i = indicePresente(estado);
  if (i < 0 || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  const h = angulo(yaw - Math.PI),
    tipo = TIPOS[i];
  let velocidade = 0,
    banco = 0;
  if (anterior && segundos > 0.015 && segundos < 1.5) {
    const dx = p[0] - anterior.x,
      dz = p[2] - anterior.z;
    velocidade = limitar((Math.sin(h) * dx + Math.cos(h) * dz) / segundos, -40, 40);
    const giro = angulo(h - anterior.h) / segundos;
    banco = limitar(
      -giro * (tipo === 'aviao' ? 0.46 : 0.085),
      tipo === 'aviao' ? -0.6 : -0.16,
      tipo === 'aviao' ? 0.6 : 0.16,
    );
  }
  return [
    i,
    h,
    limitar(pitch, -1.6, 1.6),
    banco,
    velocidade,
    tipo === 'helicoptero' ? 1 - Math.exp(-1.4 * Math.max(0, idade)) : 0,
    estado & 16 ? 1 : 0,
  ];
}
