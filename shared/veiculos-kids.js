// Pilotagem adaptada de CEIA · Trilho dos Exploradores, parts/vehicles.js (RIDE e summon).
// Eixos do Kraft: frente positiva, direita positiva. O rumo do modelo aponta para +Z.
export const VEICULOS = Object.freeze({
  balao: { nome: 'Balão', escala: 1, base: 2.1, banco: -1.04, camera: 12, acao: 'Passeio automático' },
  jipe: { nome: 'Jipe', escala: 1.55, base: 0, banco: 0.67, camera: 6, acao: 'Buzina' },
  barco: { nome: 'Barco', escala: 1.5, base: 0.1, banco: 0.62, camera: 7, acao: 'Buzina' },
  submarino: { nome: 'Submarino', escala: 1.6, base: 0.12, banco: -0.65, camera: 7, acao: 'Mergulhar' },
  aviao: { nome: 'Avião', escala: 1.5, base: 1.3, banco: 0.35, camera: 9, acao: 'Fumaça colorida' },
  helicoptero: { nome: 'Helicóptero', escala: 1.55, base: 1.4, banco: 0.15, camera: 9, acao: 'Buzina' },
});
export const TIPOS = Object.freeze(Object.keys(VEICULOS));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * Math.min(1, t);
const curva = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const aquatico = (k) => k === 'barco' || k === 'submarino';
export function novoVeiculo(tipo, x, y, z, h) {
  if (!Object.hasOwn(VEICULOS, tipo)) throw Error('Veículo desconhecido');
  return {
    tipo,
    x,
    y,
    z,
    h,
    v: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    pitch: 0,
    roll: 0,
    rpm: 0,
    wx: 0,
    wz: 0,
    rajada: 4,
    voo: false,
    mergulho: false,
    prof: 0,
    fumaca: false,
    passeio: null,
    origem: [x, y, z, h],
  };
}
export const formaRede = (v) =>
  v
    ? [
        TIPOS.indexOf(v.tipo),
        +v.h.toFixed(3),
        +v.pitch.toFixed(2),
        +v.roll.toFixed(2),
        +v.v.toFixed(1),
        +v.rpm.toFixed(2),
        v.fumaca ? 1 : 0,
      ]
    : null;
export function formaValida(a) {
  return (
    Array.isArray(a) &&
    a.length === 7 &&
    Number.isInteger(a[0]) &&
    a[0] >= 0 &&
    a[0] < TIPOS.length &&
    a.every(Number.isFinite) &&
    Math.abs(a[1]) <= Math.PI + 0.01 &&
    Math.abs(a[2]) <= 1.6 &&
    Math.abs(a[3]) <= 1.6 &&
    Math.abs(a[4]) <= 40 &&
    a[5] >= 0 &&
    a[5] <= 1 &&
    (a[6] === 0 || a[6] === 1)
  );
}
export function pontoBanco(v) {
  return [v.x, v.y + VEICULOS[v.tipo].banco * VEICULOS[v.tipo].escala, v.z];
}
function proa(v, dt) {
  return [v.x + Math.sin(v.h) * v.v * dt, v.z + Math.cos(v.h) * v.v * dt];
}
// terreno.sondar devolve a cota sólida do mundo, o nível instantâneo da água e a presença de água.
function balonismo(v, i, t, dt) {
  const chao = t.sondar(v.x, v.z);
  const piso = (chao.molhado ? chao.agua : chao.chao) + VEICULOS.balao.base;
  const livre = v.y > piso + 0.3;
  if ((v.rajada -= dt) <= 0) {
    const a = t.aleatorio() * 2 * Math.PI,
      velocidade = 1.2 + t.aleatorio() * 3.4;
    v.rajada = 6 + 6 * t.aleatorio();
    v.wx = Math.cos(a) * velocidade;
    v.wz = Math.sin(a) * velocidade;
  }
  v.wx *= 1 - dt * 0.1;
  v.wz *= 1 - dt * 0.1;
  // Direita de uma câmera que aponta para +Z fica em -X.
  let px = i.frente * Math.sin(i.camera) - i.lado * Math.cos(i.camera);
  let pz = i.frente * Math.cos(i.camera) + i.lado * Math.sin(i.camera);
  let alvoY = i.sobe ? 3.4 : i.desce ? -3.4 : livre ? -0.22 : 0;
  if (v.passeio) {
    const p = v.passeio,
      dx = p.x - v.x,
      dz = p.z - v.z,
      dist = Math.hypot(dx, dz);
    if (dist < 4) {
      v.passeio = null;
      return;
    }
    px = dx / dist;
    pz = dz / dist;
    const adiante = Math.min(15, dist);
    const terreno = t.sondar(v.x + px * adiante, v.z + pz * adiante);
    const alturaSegura = Math.max(p.altura, (terreno.molhado ? terreno.agua : terreno.chao) + 12);
    alvoY = clamp(alturaSegura - v.y, -3.4, 3.4);
  }
  v.vx = mix(v.vx, livre ? v.wx + px * 4.2 : 0, dt * 1.1);
  v.vz = mix(v.vz, livre ? v.wz + pz * 4.2 : 0, dt * 1.1);
  v.vy = mix(v.vy, alvoY, dt * 2);
  const nx = v.x + v.vx * dt,
    nz = v.z + v.vz * dt,
    prox = t.sondar(nx, nz);
  const novoPiso = (prox.molhado ? prox.agua : prox.chao) + 2.1;
  if (novoPiso <= Math.max(v.y + 0.5, piso + 0.35)) {
    v.x = nx;
    v.z = nz;
  }
  const limite = v.x === nx && v.z === nz ? novoPiso : piso;
  v.y = clamp(v.y + v.vy * dt, limite, 3600);
  if (v.y <= limite && v.vy < 0) v.vy = 0;
  v.roll = mix(v.roll, clamp(-v.vx * 0.03, -0.14, 0.14), dt * 2);
  v.pitch = mix(v.pitch, clamp(v.vz * 0.03, -0.14, 0.14), dt * 2);
  v.h = Math.sin(t.tempo * 0.3) * 0.25;
}

function terrestre(v, i, t, dt) {
  const acc = i.frente * 14 - v.v * 1.6;
  v.v += acc * dt;
  if (Math.abs(i.frente) < 0.05) v.v *= Math.max(0, 1 - dt * 1.5);
  v.h -= i.lado * dt * 2.4 * clamp(v.v / 4, -1, 1);
  const wx = Math.sin(v.h) * v.v,
    wz = Math.cos(v.h) * v.v;
  v.vx = mix(v.vx, wx, dt * 5);
  v.vz = mix(v.vz, wz, dt * 5);
  const nx = v.x + v.vx * dt,
    nz = v.z + v.vz * dt,
    p = t.sondar(nx, nz),
    atual = t.sondar(v.x, v.z);
  if (p.molhado || p.chao > v.y + 1.06) {
    v.v *= -0.35;
    v.vx *= -0.35;
    v.vz *= -0.35;
  } else {
    v.x = nx;
    v.z = nz;
  }
  const piso = v.x === nx && v.z === nz ? p.chao : atual.chao;
  v.vy = Math.max(-20, v.vy - 15 * dt);
  v.y = Math.max(piso, v.y + v.vy * dt);
  if (v.y === piso) v.vy = 0;
  const escorrega = Math.hypot(wx - v.vx, wz - v.vz);
  const frente = t.sondar(v.x + Math.sin(v.h), v.z + Math.cos(v.h)).chao;
  const inclina = clamp((piso - frente) * 0.42, -0.35, 0.35);
  v.pitch = mix(v.pitch, inclina - clamp(acc * 0.007, -0.09, 0.09), dt * 6);
  v.roll = mix(
    v.roll,
    clamp(i.lado * v.v * 0.014 + Math.sign(i.lado) * escorrega * 0.012, -0.17, 0.17),
    dt * 6,
  );
}
function navegar(v, i, t, dt) {
  v.v += (i.frente * 9 - v.v * 1.2) * dt;
  v.h -= i.lado * dt * 1.7 * clamp(v.v / 3, -1, 1);
  const [x, z] = proa(v, dt),
    p = t.sondar(x, z);
  const sub = v.tipo === 'submarino',
    calado = sub ? 1.2 : 0.65;
  if (!p.molhado || p.agua - p.chao < calado || (sub && v.prof < -0.6 && v.y - p.chao < calado)) v.v *= -0.35;
  else {
    v.x = x;
    v.z = z;
  }
  const a = t.sondar(v.x, v.z);
  const limite = Math.max(0, a.agua - a.chao - calado);
  const alvo = sub && v.mergulho ? -Math.min(8, limite) : 0;
  v.prof = mix(v.prof, alvo, dt * 1.2);
  const ondula = sub ? Math.exp(v.prof * 0.45) : 1;
  v.y = Math.max(a.chao + calado, a.agua + 0.1 + v.prof + Math.sin(t.tempo * 2.2) * 0.06 * ondula);
  v.roll = Math.sin(t.tempo * 1.7) * 0.05 * ondula + clamp(i.lado * v.v * 0.02, -0.16, 0.16);
  v.pitch = Math.sin(t.tempo * 1.3) * 0.03 * ondula - clamp(v.v * 0.012, -0.08, 0.1);
}
function aviao(v, i, t, dt) {
  if (!v.voo) {
    v.v += ((i.frente > 0.1 ? 12 : 0) - v.v * 0.85) * dt;
    v.h -= i.lado * dt * 1.3 * Math.min(1, v.v / 3);
    const [x, z] = proa(v, dt),
      a = t.sondar(x, z);
    if (a.molhado || a.chao + VEICULOS.aviao.base > v.y + 1.06) v.v *= -0.3;
    else {
      v.x = x;
      v.z = z;
      v.y = a.chao + VEICULOS.aviao.base;
    }
    v.pitch = mix(v.pitch, 0, dt * 4);
    v.roll = mix(v.roll, 0, dt * 4);
    if (v.v > 8.4 && i.frente > 0.1) {
      v.voo = true;
      v.vy = 2.6;
    }
    return;
  }
  v.v = mix(v.v, 11.5, dt);
  v.h -= i.lado * dt * 1.3;
  v.vy = mix(v.vy, i.frente * 6.5, dt * 2.2);
  const [x, z] = proa(v, dt),
    a = t.sondar(x, z),
    piso = (a.molhado ? a.agua : a.chao) + VEICULOS.aviao.base;
  v.x = x;
  v.z = z;
  v.y = Math.min(3600, v.y + v.vy * dt);
  v.roll = mix(v.roll, i.lado * 0.6, dt * 3);
  v.pitch = mix(v.pitch, -v.vy * 0.06, dt * 3);
  if (v.y <= piso) {
    if (a.molhado) {
      [v.x, v.y, v.z, v.h] = v.origem;
      v.v = 0;
    } else v.y = piso;
    v.voo = false;
    v.vy = 0;
  }
}
function helicoptero(v, i, t, dt) {
  v.rpm = mix(v.rpm, 1, dt * 1.4);
  const a = t.sondar(v.x, v.z),
    piso = (a.molhado ? a.agua : a.chao) + VEICULOS.helicoptero.base;
  v.vy = mix(v.vy, v.rpm > 0.7 ? (i.sobe ? 5 : i.desce ? -5 : 0) : 0, dt * 3);
  v.y = clamp(v.y + v.vy * dt, piso, 3600);
  const fly = v.y > piso + 0.25;
  const ux = i.frente * Math.sin(i.camera) - i.lado * Math.cos(i.camera);
  const uz = i.frente * Math.cos(i.camera) + i.lado * Math.sin(i.camera);
  v.vx = mix(v.vx, fly ? ux * 8.5 : 0, dt * 1.8);
  v.vz = mix(v.vz, fly ? uz * 8.5 : 0, dt * 1.8);
  const nx = v.x + v.vx * dt,
    nz = v.z + v.vz * dt,
    n = t.sondar(nx, nz);
  if ((n.molhado ? n.agua : n.chao) + VEICULOS.helicoptero.base <= v.y + 0.25) {
    v.x = nx;
    v.z = nz;
  }
  v.v = Math.hypot(v.vx, v.vz);
  if (v.v > 0.8) v.h += curva(v.h, Math.atan2(v.vx, v.vz)) * Math.min(1, dt * 3);
  v.pitch = mix(v.pitch, Math.min(0.28, v.v * 0.03), dt * 3);
  v.roll = mix(v.roll, 0, dt * 3);
}
const passos = { balao: balonismo, jipe: terrestre, barco: navegar, submarino: navegar, aviao, helicoptero };
export function pilotar(v, entrada, terreno, dt) {
  if (!(dt > 0)) return;
  passos[v.tipo](v, entrada, terreno, Math.min(dt, 0.1));
  v.h = Math.atan2(Math.sin(v.h), Math.cos(v.h));
}
export function chamarVeiculo(tipo, centro, rumo, sondar) {
  if (!Object.hasOwn(VEICULOS, tipo)) return null;
  const molhado = aquatico(tipo),
    cfg = VEICULOS[tipo];
  for (let raio = 0; raio <= (tipo === 'helicoptero' ? 8 : 112); raio += 4) {
    const n = raio ? 16 : 1;
    for (let j = 0; j < n; j++) {
      const ang = rumo + (j * Math.PI * 2) / n,
        x = centro[0] + raio * Math.sin(ang),
        z = centro[2] + raio * Math.cos(ang);
      const a = sondar(x, z);
      if (tipo !== 'balao' && (molhado !== a.molhado || (molhado && a.agua - a.chao < 2.8))) continue;
      if (tipo === 'helicoptero' && Math.abs(a.chao - centro[1]) > 3) continue;
      const y = (a.molhado ? a.agua : a.chao) + cfg.base;
      let h = rumo;
      if (tipo === 'aviao') {
        let maior = 0;
        for (let k = 0; k < 8; k++) {
          const direcao = rumo + (Math.PI * k) / 4;
          let l = 0,
            antes = a.chao;
          for (; l < 18; l += 2) {
            const b = sondar(x + Math.sin(direcao) * l, z + Math.cos(direcao) * l);
            if (b.molhado || Math.abs(b.chao - antes) > 1) break;
            antes = b.chao;
          }
          if (l > maior) {
            h = direcao;
            maior = l;
          }
        }
        if (maior < 12) continue;
      }
      return novoVeiculo(tipo, x, y, z, h);
    }
  }
  return null;
}
