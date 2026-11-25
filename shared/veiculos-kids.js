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
    ateAmostra: 0,
    pitchApoio: 0,
    rollApoio: 0,
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
  const vento = t.vento;
  if (vento && Number.isFinite(vento[0]) && Number.isFinite(vento[1])) {
    const escala = 1 / Math.max(1, Math.hypot(vento[0], vento[1]) / 7);
    v.wx = mix(v.wx, vento[0] * escala, dt * 0.7);
    v.wz = mix(v.wz, vento[1] * escala, dt * 0.7);
  } else {
    if ((v.rajada -= dt) <= 0) {
      const a = t.aleatorio() * 2 * Math.PI, velocidade = 1.2 + t.aleatorio() * 3.4;
      v.rajada = 6 + 6 * t.aleatorio();
      v.wx = Math.cos(a) * velocidade;
      v.wz = Math.sin(a) * velocidade;
    }
    v.wx *= 1 - dt * 0.1;
    v.wz *= 1 - dt * 0.1;
  }
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
  v.vx = mix(v.vx, livre ? (v.passeio ? 0 : v.wx) + px * 4.2 : 0, dt * 1.1);
  v.vz = mix(v.vz, livre ? (v.passeio ? 0 : v.wz) + pz * 4.2 : 0, dt * 1.1);
  v.vy = mix(v.vy, alvoY, dt * 2);
  const nx = v.x + v.vx * dt,
    nz = v.z + v.vz * dt,
    prox = nx === v.x && nz === v.z ? chao : t.sondar(nx, nz);
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
  v.v = Math.hypot(v.vx, v.vz);
  if (v.v > 0.4) v.h += curva(v.h, Math.atan2(v.vx, v.vz)) * dt * 0.24;
}

function terrestre(v, i, t, dt) {
  const acc = i.frente * 14 - v.v * 1.6;
  v.v += acc * dt;
  if (Math.abs(i.frente) < 0.05) v.v *= Math.max(0, 1 - dt * 1.5);
  v.h -= i.lado * dt * 2.4 * clamp(v.v / 4, -1, 1);
  const sen = Math.sin(v.h), cos = Math.cos(v.h);
  const wx = sen * v.v, wz = cos * v.v;
  v.vx = mix(v.vx, wx, dt * 5);
  v.vz = mix(v.vz, wz, dt * 5);
  const nx = v.x + v.vx * dt,
    nz = v.z + v.vz * dt,
    p = t.sondar(nx, nz);
  let piso = p.chao;
  if (p.molhado || p.chao > v.y + 1.06) {
    piso = t.sondar(v.x, v.z).chao;
    v.v *= -0.35;
    v.vx *= -0.35;
    v.vz *= -0.35;
  } else {
    v.x = nx;
    v.z = nz;
  }
  v.vy = Math.max(-20, v.vy - 15 * dt);
  v.y = Math.max(piso, v.y + v.vy * dt);
  if (v.y === piso) v.vy = 0;
  const escorrega = Math.hypot(wx - v.vx, wz - v.vz);
  if ((v.ateAmostra -= dt) <= 0) {
    v.ateAmostra = 0.12;
    const frente = t.sondar(v.x + sen, v.z + cos).chao;
    const lado = t.sondar(v.x + cos, v.z - sen).chao;
    v.pitchApoio = clamp(Math.atan(piso - frente), -0.35, 0.35);
    v.rollApoio = clamp(Math.atan(lado - piso), -0.32, 0.32);
  }
  v.pitch = mix(v.pitch, v.pitchApoio - clamp(acc * 0.007, -0.09, 0.09), dt * 6);
  v.roll = mix(
    v.roll,
    v.rollApoio + clamp(i.lado * v.v * 0.014 + Math.sign(i.lado) * escorrega * 0.012, -0.17, 0.17),
    dt * 6,
  );
}
function navegar(v, i, t, dt) {
  const sub = v.tipo === 'submarino', calado = sub ? 1.2 : 0.65;
  // A hélice dá menos empuxo à ré. O leme perde autoridade quando a água deixa de passar por ele.
  const empuxo = i.frente * (i.frente < 0 ? 3.1 : sub ? 5.6 : 8.2);
  v.v += (empuxo - (0.42 + 0.075 * Math.abs(v.v)) * v.v) * dt;
  const giro = -i.lado * (sub ? 0.62 : 1.05) * clamp(v.v / 4, -1, 1);
  v.h += giro * dt;
  const sen = Math.sin(v.h), cos = Math.cos(v.h);
  v.vx = mix(v.vx, sen * v.v, dt * (sub ? 1.8 : 2.8));
  v.vz = mix(v.vz, cos * v.v, dt * (sub ? 1.8 : 2.8));
  const x = v.x + v.vx * dt, z = v.z + v.vz * dt;
  let a = t.sondar(x, z);
  if (!a.molhado || a.agua - a.chao < calado || (sub && v.prof < -0.6 && v.y - a.chao < calado)) {
    if (x !== v.x || z !== v.z) a = t.sondar(v.x, v.z);
    v.v *= -0.25;
    v.vx = v.vz = 0;
  } else {
    v.x = x;
    v.z = z;
  }
  const repouso = t.nivelMar ?? a.agua;
  if (sub) {
    const limite = Math.max(0, repouso - a.chao - calado);
    const alvo = v.mergulho ? -Math.min(8, limite) : 0;
    v.vy = mix(v.vy, clamp((alvo - v.prof) * 2, -3.2, 3.6), dt * 3);
    v.prof = clamp(v.prof + v.vy * dt, -limite, 0);
    if ((v.prof === -limite && v.vy < 0) || (v.prof === 0 && v.vy > 0)) v.vy = 0;
  }
  const onda = sub ? Math.exp(v.prof * 0.45) : 1;
  v.y = Math.max(a.chao + calado, repouso + (a.agua - repouso) * onda + 0.1 + v.prof);
  // Amostra na proa e a bombordo, em metros. A inércia suaviza as leituras entre amostras.
  if ((v.ateAmostra -= dt) <= 0 && t.alturaAgua) {
    v.ateAmostra = 0.15;
    const proa = t.alturaAgua(v.x + 2 * sen, v.z + 2 * cos);
    const bordo = t.alturaAgua(v.x + cos, v.z - sen);
    v.pitchApoio = clamp(-Math.atan((proa - a.agua) / 2), -0.38, 0.38);
    v.rollApoio = clamp(Math.atan(bordo - a.agua), -0.42, 0.42);
  }
  const trim = sub ? -v.vy * 0.055 * clamp(v.v / 3, -1, 1) : -0.009 * v.v;
  v.pitch = mix(v.pitch, v.pitchApoio * onda + trim, dt * 3.5);
  v.roll = mix(v.roll, v.rollApoio * onda + clamp(-giro * v.v * 0.018, -0.18, 0.18), dt * 3.5);
  v.rpm = mix(v.rpm, 0.16 + 0.84 * Math.abs(i.frente), dt * 2);
}
function aviao(v, i, t, dt) {
  if (!v.voo) {
    v.rpm = mix(v.rpm, i.frente > 0.1 ? 1 : 0.18, dt * 2.2);
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
  // No ar, a inclinação das asas curva a trajetória. Subir custa velocidade e descer a recupera.
  v.roll = mix(v.roll, i.lado * 0.66, dt * 2.6);
  v.vy = mix(v.vy, i.frente * 6 - 1.8 * (1 - Math.cos(v.roll)), dt * 1.7);
  v.v = mix(v.v, 14 - 0.72 * v.vy - 1.1 * Math.abs(v.roll), dt * 0.85);
  v.h -= dt * 9.81 * Math.tan(v.roll) / Math.max(8, v.v);
  v.rpm = mix(v.rpm, 0.76 + 0.18 * i.frente, dt * 1.6);
  const [x, z] = proa(v, dt),
    a = t.sondar(x, z),
    piso = (a.molhado ? a.agua : a.chao) + VEICULOS.aviao.base;
  v.x = x;
  v.z = z;
  v.y = Math.min(3600, v.y + v.vy * dt);
  v.pitch = mix(v.pitch, -Math.atan2(v.vy, v.v), dt * 3);
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
  if ((v.y === piso && v.vy < 0) || (v.y === 3600 && v.vy > 0)) v.vy = 0;
  const fly = v.y > piso + 0.25;
  const escala = fly ? 8.5 / Math.max(1, Math.hypot(i.frente, i.lado)) : 0;
  const sc = Math.sin(i.camera), cc = Math.cos(i.camera);
  const ax = ((i.frente * sc - i.lado * cc) * escala - v.vx) * 1.8;
  const az = ((i.frente * cc + i.lado * sc) * escala - v.vz) * 1.8;
  v.vx += ax * dt;
  v.vz += az * dt;
  const nx = v.x + v.vx * dt, nz = v.z + v.vz * dt;
  const n = nx === v.x && nz === v.z ? a : t.sondar(nx, nz);
  if ((n.molhado ? n.agua : n.chao) + VEICULOS.helicoptero.base <= v.y + 0.25) {
    v.x = nx;
    v.z = nz;
  } else v.vx = v.vz = 0;
  v.v = Math.hypot(v.vx, v.vz);
  if (v.v > 0.8) v.h += curva(v.h, Math.atan2(v.vx, v.vz)) * Math.min(1, dt * 3);
  const sen = Math.sin(v.h), cos = Math.cos(v.h);
  // O disco inclina para acelerar e para frear. Em cruzeiro compensa o arrasto horizontal.
  const fx = ax + v.vx * 0.33, fz = az + v.vz * 0.33;
  v.pitch = mix(v.pitch, fly ? clamp((sen * fx + cos * fz) / 9.81, -0.38, 0.38) : 0, dt * 4);
  v.roll = mix(v.roll, fly ? clamp((sen * fz - cos * fx) / 9.81, -0.38, 0.38) : 0, dt * 4);
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
