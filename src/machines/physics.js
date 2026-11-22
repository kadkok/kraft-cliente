// LAVRA — física das máquinas: um corpo rígido feito de blocos, empurrado pelas suas peças.
// Rodas (suspensão por raio + atrito), propulsores, hélices, asas (placa plana), balões,
// giroscópio, empuxo na água e colisão do casco com o terreno. Código puro: roda no
// navegador e nos testes do Node.

import {
  MASS, FUNC, FACING, DIRS, SOLID, B,
  F_MOTOR, F_GYRO, F_BALLOON, F_THRUSTER, F_PROPELLER, F_CANNON, F_WHEEL, F_WING, F_SEAT, LEVEL,
} from '../../shared/blocks.js';
import { raycastVoxels } from '../world/raycast.js';
import { readerShape, CUBE, shapeSphere } from '../../shared/surfaces.js';
import { surfaceOf } from '../../shared/water.js';

export const GRAV = 20;
const THRUST = 60, PROP = 42, BALLOON = 30, DRIVE = 10, WHEEL_R = 0.5, SUSP = 0.45;
const MAX_HULL = 420;

const cross = (a, b, o) => { const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; o[0] = x; o[1] = y; o[2] = z; return o; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Monta o corpo a partir da lista de blocos [x, y, z, id] (coordenadas inteiras locais).
export function buildBody(blocks) {
  let m = 0, cx = 0, cy = 0, cz = 0;
  for (const [x, y, z, id] of blocks) { const k = MASS[id] || 1; m += k; cx += k * (x + 0.5); cy += k * (y + 0.5); cz += k * (z + 0.5); }
  const com = [cx / m, cy / m, cz / m];
  let ixx = 0, iyy = 0, izz = 0, radius = 0;
  const occ = new Set(blocks.map((b) => b[0] + ',' + b[1] + ',' + b[2]));
  const cells = [], hullAll = [];
  const parts = { wheels: [], thrust: [], wings: [], balloons: [], cannons: [], seats: [], motors: 0, gyros: 0 };
  let fwd = null;
  blocks.forEach(([x, y, z, id], i) => {
    const k = MASS[id] || 1;
    const r = [x + 0.5 - com[0], y + 0.5 - com[1], z + 0.5 - com[2]];
    ixx += k * (r[1] * r[1] + r[2] * r[2] + 1 / 6); iyy += k * (r[0] * r[0] + r[2] * r[2] + 1 / 6); izz += k * (r[0] * r[0] + r[1] * r[1] + 1 / 6);
    radius = Math.max(radius, Math.hypot(r[0], r[1], r[2]) + 0.87);
    cells.push({ r, mass: k });
    const fn = FUNC[id], d = FACING[id] !== 255 ? DIRS[FACING[id]] : null;
    const exposed = !occ.has((x + 1) + ',' + y + ',' + z) || !occ.has((x - 1) + ',' + y + ',' + z) || !occ.has(x + ',' + (y + 1) + ',' + z) ||
      !occ.has(x + ',' + (y - 1) + ',' + z) || !occ.has(x + ',' + y + ',' + (z + 1)) || !occ.has(x + ',' + y + ',' + (z - 1));
    if (fn === F_WHEEL) parts.wheels.push({ r, axle: d, i, comp: 0, spin: 0, ground: false });
    else if (fn === F_THRUSTER) parts.thrust.push({ r, dir: d, i, prop: false, on: 0 });
    else if (fn === F_PROPELLER) parts.thrust.push({ r, dir: d, i, prop: true, on: 0, spin: 0 });
    else if (fn === F_WING) parts.wings.push({ r, n: d, i });
    else if (fn === F_BALLOON) parts.balloons.push({ r, i });
    else if (fn === F_CANNON) parts.cannons.push({ r, dir: d, i, cool: 0 });
    else if (fn === F_SEAT) { parts.seats.push({ r, dir: d, i, pid: 0 }); if (!fwd) fwd = d; }
    else if (fn === F_MOTOR) parts.motors++;
    else if (fn === F_GYRO) parts.gyros++;
    if (exposed && fn !== F_WHEEL) hullAll.push(r); // a roda toca o chão pela suspensão, não pelo casco
  });
  // casco: no máximo MAX_HULL pontos, espalhados
  const stepH = Math.max(1, Math.ceil(hullAll.length / MAX_HULL));
  const hull = hullAll.filter((_, i) => i % stepH === 0);
  fwd = fwd || [0, 0, -1];
  const right = cross(fwd, [0, 1, 0], [0, 0, 0]);
  return { blocks, mass: m, com, inv: [1 / ixx, 1 / iyy, 1 / izz], iavg: (ixx + iyy + izz) / 3, radius, cells, hull, parts, fwd, right, count: blocks.length };
}

export function newState(p, q) {
  const st = { p: [p[0], p[1], p[2]], q: q ? [q[0], q[1], q[2], q[3]] : [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], asleep: false, still: 0, grounded: 0, R: new Float64Array(9) };
  rotMatrix(st.q, st.R);
  return st;
}

function rotMatrix(q, R) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
  R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
  R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
}
// refaz a matriz de rotação a partir do quaternion (para corpos que não passam pelo stepBody)
export function syncRotation(st) { rotMatrix(st.q, st.R); }
// corpo -> mundo
export function toWorld(R, v, o) { const x = v[0], y = v[1], z = v[2]; o[0] = R[0] * x + R[1] * y + R[2] * z; o[1] = R[3] * x + R[4] * y + R[5] * z; o[2] = R[6] * x + R[7] * y + R[8] * z; return o; }
function toBody(R, v, o) { const x = v[0], y = v[1], z = v[2]; o[0] = R[0] * x + R[3] * y + R[6] * z; o[1] = R[1] * x + R[4] * y + R[7] * z; o[2] = R[2] * x + R[5] * y + R[8] * z; return o; }

const F = [0, 0, 0], T = [0, 0, 0], rw = [0, 0, 0], dw = [0, 0, 0], vp = [0, 0, 0], t1 = [0, 0, 0], t2 = [0, 0, 0], t3 = [0, 0, 0];
const upW = [0, 0, 0], fwdW = [0, 0, 0], rightW = [0, 0, 0], hit = {};
const solid = (id) => SOLID[id] === 1;

function addForce(fx, fy, fz, r) {
  F[0] += fx; F[1] += fy; F[2] += fz;
  T[0] += r[1] * fz - r[2] * fy; T[1] += r[2] * fx - r[0] * fz; T[2] += r[0] * fy - r[1] * fx;
}
function pointVel(st, r, o) { const w = st.w; o[0] = st.v[0] + w[1] * r[2] - w[2] * r[1]; o[1] = st.v[1] + w[2] * r[0] - w[0] * r[2]; o[2] = st.v[2] + w[0] * r[1] - w[1] * r[0]; return o; }
// aplica um impulso J no ponto r (relativo ao centro de massa)
export function applyImpulse(body, st, J, r, wake=true) {
  const im = 1 / body.mass;
  st.v[0] += J[0] * im; st.v[1] += J[1] * im; st.v[2] += J[2] * im;
  cross(r, J, t1); toBody(st.R, t1, t2);
  t2[0] *= body.inv[0]; t2[1] *= body.inv[1]; t2[2] *= body.inv[2];
  toWorld(st.R, t2, t1);
  st.w[0] += t1[0]; st.w[1] += t1[1]; st.w[2] += t1[2];
  if(wake){st.asleep = false; st.still = 0; st.restPose = null;}
}
// massa efetiva ao longo de n no ponto r
function effMass(body, st, n, r) {
  cross(r, n, t1); toBody(st.R, t1, t2);
  t2[0] *= body.inv[0]; t2[1] *= body.inv[1]; t2[2] *= body.inv[2];
  toWorld(st.R, t2, t1); cross(t1, r, t2);
  return 1 / (1 / body.mass + dot(n, t2));
}

// ctl: { drive, steer, lift } em -1..1.  env: { getBlock(x, y, z) }
export function stepBody(body, st, ctl, dt, env) {
  const active = ctl.drive !== 0 || ctl.steer !== 0 || ctl.lift !== 0;
  if (st.asleep && !active) return;
  if (env.getBlock(Math.floor(st.p[0]), Math.floor(st.p[1]), Math.floor(st.p[2])) === -1) return; // terreno ainda não carregado
  st.asleep = false;
  const sub = 2, h = dt / sub;
  for (let s = 0; s < sub; s++) substep(body, st, ctl, h, env);
  const sp = Math.hypot(st.v[0], st.v[1], st.v[2]), sw = Math.hypot(st.w[0], st.w[1], st.w[2]);
  if(body.passiveTree){
    if(st.supported>0&&sp<.45&&sw<.25){
      if(!st.restPose)st.restPose={p:st.p.slice(),q:st.q.slice(),time:0};
      const rest=st.restPose;rest.time+=dt;
      if(rest.time>=1){
        const moved=Math.hypot(...st.p.map((v,i)=>v-rest.p[i]));
        const turned=1-Math.abs(st.q.reduce((n,v,i)=>n+v*rest.q[i],0));
        if(moved<.025&&turned<.0002){st.asleep=true;st.v.fill(0);st.w.fill(0);}else st.restPose=null;
      }
    }else st.restPose=null;
    return;
  }
  if (!active && st.grounded > 0 && sp < 0.12 && sw < 0.12) { st.still += dt; if (st.still > 1) { st.asleep = true; st.v.fill(0); st.w.fill(0); } } else st.still = 0;
}

function substep(body, st, ctl, h, env) {
  const { parts, mass } = body, R = st.R, p = st.p, v = st.v, w = st.w;
  const gb = env.getBlock;
  rotMatrix(st.q, R);
  toWorld(R, [0, 1, 0], upW); toWorld(R, body.fwd, fwdW); toWorld(R, body.right, rightW);
  F[0] = 0; F[1] = -mass * GRAV; F[2] = 0; T[0] = T[1] = T[2] = 0;
  const speed = Math.hypot(v[0], v[1], v[2]);
  const vFwd = dot(v, fwdW);
  let grounded = 0;

  // água: empuxo e arrasto por bloco
  if (env.water !== false) {
    for (let i = 0; i < body.cells.length; i++) {
      const c = body.cells[i];
      toWorld(R, c.r, rw);
      const x = Math.floor(p[0] + rw[0]), yc = p[1] + rw[1], y = Math.floor(yc), z = Math.floor(p[2] + rw[2]);
      const wb = gb(x, y, z);
      if (!(wb > 0) || !LEVEL[wb]) continue;
      // quanto do bloco da peça está debaixo d'água: a superfície depende do nível (fonte 0,88; corrente menos)
      const frac = Math.min(1, Math.max(0, y + surfaceOf(wb, gb(x, y + 1, z)) - (yc - 0.5)));
      pointVel(st, rw, vp);
      addForce(-vp[0] * 1.1 * frac, frac * GRAV * 1.12 - vp[1] * 1.6 * frac, -vp[2] * 1.1 * frac, rw);
      grounded++;
    }
  }

  // propulsores e hélices
  const power = parts.motors > 0 ? Math.min(1, parts.motors * 4 / Math.max(1, parts.thrust.filter((t) => t.prop).length + parts.wheels.length * 0.5)) : 0;
  let upThrust = 0;
  if (parts.gyros) for (const t of parts.thrust) if (t.dir[1] > 0.5) upThrust += t.prop ? PROP * power : THRUST;
  // com giroscópio, quem aponta para cima segura a altitude sozinho: o comando vira velocidade vertical desejada
  const hover = parts.gyros && upThrust > 0 ? Math.min(1, Math.max(0, (mass * GRAV + mass * 5 * (ctl.lift * 7 - v[1])) / (upThrust * Math.max(0.3, upW[1])))) : -1;
  for (const t of parts.thrust) {
    const df = dot(t.dir, body.fwd), du = t.dir[1], dr = dot(t.dir, body.right);
    let th = Math.max(0, df * ctl.drive) + Math.max(0, dr * ctl.steer);
    if (du > 0.5) th += hover >= 0 ? hover : Math.max(0, ctl.lift);
    else if (du < -0.5) th += Math.max(0, -ctl.lift);
    th = Math.min(1, th);
    t.on += (th - t.on) * Math.min(1, h * 8);
    if (t.prop) t.spin += h * (6 + 60 * t.on * power);
    if (th <= 0) continue;
    toWorld(R, t.dir, dw); toWorld(R, t.r, rw);
    let f = t.prop ? PROP * power * Math.max(0.15, 1 - Math.max(0, dot(v, dw)) / 70) : THRUST;
    f *= th;
    addForce(dw[0] * f, dw[1] * f, dw[2] * f, rw);
  }

  // asas: placa plana. A parte que depende do ângulo de ataque age na própria asa (dá estabilidade:
  // a cauda segura o nariz); a sustentação "de fábrica" das asas horizontais age na linha do centro
  // de massa, para o avião montado de qualquer jeito não empinar nem mergulhar sozinho.
  for (const wg of parts.wings) {
    t3[0] = wg.n[0]; t3[1] = Math.abs(wg.n[1]); t3[2] = wg.n[2];
    toWorld(R, t3, dw); toWorld(R, wg.r, rw);
    pointVel(st, rw, vp);
    const sp2 = Math.hypot(vp[0], vp[1], vp[2]);
    let f = -1.05 * dot(vp, dw) * sp2;
    f = Math.max(-70, Math.min(70, f));
    addForce(dw[0] * f, dw[1] * f, dw[2] * f, rw);
    if (Math.abs(wg.n[1]) > 0.5) {
      const vf = dot(vp, fwdW);
      const fi = Math.min(40, 1.05 * 0.075 * Math.max(0, vf) * sp2);
      const along = dot(rw, fwdW);
      t1[0] = rw[0] - fwdW[0] * along; t1[1] = rw[1] - fwdW[1] * along; t1[2] = rw[2] - fwdW[2] * along;
      addForce(dw[0] * fi, dw[1] * fi, dw[2] * fi, t1);
    }
  }
  // comandos de voo: profundor, aileron e leme, proporcionais à pressão do ar
  if (parts.wings.length && Math.abs(vFwd) > 3) {
    const qd = Math.min(vFwd * vFwd, 900) * 0.0045 * Math.min(parts.wings.length, 14) * body.iavg / 12;
    const pitch = ctl.lift * qd * 0.9, roll = ctl.steer * qd * 0.8, yaw = -ctl.steer * qd * 0.45;
    T[0] += rightW[0] * pitch + fwdW[0] * roll + upW[0] * yaw;
    T[1] += rightW[1] * pitch + fwdW[1] * roll + upW[1] * yaw;
    T[2] += rightW[2] * pitch + fwdW[2] * roll + upW[2] * yaw;
  }

  // balões
  for (const b of parts.balloons) { toWorld(R, b.r, rw); addForce(0, BALLOON * (1 + 0.55 * ctl.lift), 0, rw); }

  // rodas
  if (parts.wheels.length) {
    const nW = parts.wheels.length;
    const nRest = mass * GRAV / nW, k = nRest / 0.22, damp = 2 * Math.sqrt(k * mass / nW) * 0.5;
    const drivePer = parts.motors > 0 ? DRIVE * Math.min(1, parts.motors * 4 / nW) * (mass / nW) * 0.55 : 0;
    const maxSteer = 0.55 / (1 + speed / 12);
    for (const wh of parts.wheels) {
      toWorld(R, wh.r, rw);
      const L = WHEEL_R + SUSP;
      raycastVoxels(gb, p[0] + rw[0] + upW[0] * 0.2, p[1] + rw[1] + upW[1] * 0.2, p[2] + rw[2] + upW[2] * 0.2, -upW[0], -upW[1], -upW[2], L + 0.2, solid, hit);
      wh.ground = hit.hit && hit.t > 0.0001;
      if (!wh.ground) { wh.comp += (0 - wh.comp) * Math.min(1, h * 10); continue; }
      const tt = hit.t - 0.2;
      const comp = Math.max(0, L - tt);
      wh.comp = comp;
      t3[0] = hit.snx; t3[1] = hit.sny; t3[2] = hit.snz;
      if (t3[0] === 0 && t3[1] === 0 && t3[2] === 0) t3[1] = 1;
      const ng = [t3[0], t3[1], t3[2]];
      const rc = [rw[0] - upW[0] * tt, rw[1] - upW[1] * tt, rw[2] - upW[2] * tt];
      pointVel(st, rc, vp);
      let N = k * comp - damp * dot(vp, ng);
      N = Math.max(0, Math.min(nRest * 7, N));
      // direções do pneu
      toWorld(R, wh.axle, dw);
      cross(dw, ng, t1);
      let l = Math.hypot(t1[0], t1[1], t1[2]);
      if (l < 1e-4) continue;
      t1[0] /= l; t1[1] /= l; t1[2] /= l;
      if (dot(t1, fwdW) < 0) { t1[0] = -t1[0]; t1[1] = -t1[1]; t1[2] = -t1[2]; }
      if (dot(wh.r, body.fwd) > 0.1 && ctl.steer !== 0) { // rodas da frente esterçam
        const a = -ctl.steer * maxSteer, c = Math.cos(a), s = Math.sin(a);
        cross(ng, t1, t2);
        t1[0] = t1[0] * c + t2[0] * s; t1[1] = t1[1] * c + t2[1] * s; t1[2] = t1[2] * c + t2[2] * s;
      }
      cross(ng, t1, t2); // lateral
      const vl = dot(vp, t1), vs = dot(vp, t2);
      const mShare = mass / nW, mu = 1.15 * N;
      let fl;
      if (ctl.drive !== 0 && drivePer > 0 && ctl.drive * vl > -1.5) fl = ctl.drive * drivePer * Math.max(0, 1 - Math.abs(vl) / 26);
      else if (ctl.drive !== 0 && drivePer > 0) fl = ctl.drive * mShare * 16;      // freando: comando contrário ao movimento
      else fl = -vl * mShare * 0.9;                                               // solto: resistência de rolagem
      fl = Math.max(-mu, Math.min(mu, fl));
      let fs = -vs * mShare * 11;
      fs = Math.max(-mu, Math.min(mu, fs));
      wh.spin += h * vl / WHEEL_R;
      // a força lateral entra quase na altura do centro de massa: carro de brinquedo não capota à toa
      const lift = -dot(rc, upW) * 0.8;
      const ra = [rc[0] + upW[0] * lift, rc[1] + upW[1] * lift, rc[2] + upW[2] * lift];
      addForce(ng[0] * N + t1[0] * fl, ng[1] * N + t1[1] * fl, ng[2] * N + t1[2] * fl, rc);
      addForce(t2[0] * fs, t2[1] * fs, t2[2] * fs, ra);
      grounded++;
    }
  }

  // giroscópio: endireita, amortece e (fora do chão) gira pelo comando
  if (parts.gyros) {
    const g = Math.min(parts.gyros, 4) * body.iavg;
    cross(upW, [0, 1, 0], t1);
    T[0] += t1[0] * 16 * g - w[0] * 5 * g; T[2] += t1[2] * 16 * g - w[2] * 5 * g; T[1] += t1[1] * 16 * g;
    const wheelsDown = parts.wheels.some((x) => x.ground);
    if (!wheelsDown) T[1] += (-ctl.steer * 1.7 - w[1]) * 6 * g;
  }

  // arrasto do ar
  const cd = 0.0025 * Math.pow(body.hull.length, 0.67), lin = 0.012 * mass;
  F[0] -= v[0] * (lin + cd * speed); F[1] -= v[1] * (lin + cd * speed); F[2] -= v[2] * (lin + cd * speed);

  // integra
  const im = 1 / mass;
  v[0] += F[0] * im * h; v[1] += F[1] * im * h; v[2] += F[2] * im * h;
  toBody(R, T, t1);
  t1[0] *= body.inv[0] * h; t1[1] *= body.inv[1] * h; t1[2] *= body.inv[2] * h;
  toWorld(R, t1, t2);
  w[0] += t2[0]; w[1] += t2[1]; w[2] += t2[2];
  const ad = Math.max(0, 1 - 1.1 * h);
  w[0] *= ad; w[1] *= ad; w[2] *= ad;
  const sv = Math.hypot(v[0], v[1], v[2]);
  if (sv > 95) { const k = 95 / sv; v[0] *= k; v[1] *= k; v[2] *= k; }
  const swm = Math.hypot(w[0], w[1], w[2]);
  if (swm > 10) { const k = 10 / swm; w[0] *= k; w[1] *= k; w[2] *= k; }
  p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
  const q = st.q, qx = q[0], qy = q[1], qz = q[2], qw = q[3], hh = h * 0.5;
  q[0] += hh * (w[0] * qw + w[1] * qz - w[2] * qy);
  q[1] += hh * (w[1] * qw + w[2] * qx - w[0] * qz);
  q[2] += hh * (w[2] * qw + w[0] * qy - w[1] * qx);
  q[3] += hh * (-w[0] * qx - w[1] * qy - w[2] * qz);
  const ql = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= ql; q[1] /= ql; q[2] /= ql; q[3] /= ql;
  rotMatrix(q, R);

  // casco contra o terreno: cada bloco exposto é uma esfera de raio 0,5
  let fixX = 0, fixY = 0, fixZ = 0, nFix = 0, supported = 0;
  const treeContacts=body.passiveTree?[]:null;
  for (let i = 0; i < body.hull.length; i++) {
    const radius=body.hull[i][3]??.5;
    toWorld(R, body.hull[i], rw);
    const cx = p[0] + rw[0], cy = p[1] + rw[1], cz = p[2] + rw[2];
    const x0 = Math.floor(cx - radius), y0 = Math.floor(cy - radius), z0 = Math.floor(cz - radius);
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const bx = x0 + dx, by = y0 + dy, bz = z0 + dz;
      const id = gb(bx, by, bz);
      if (id <= 0 || SOLID[id] !== 1) continue;
      const px = Math.max(bx, Math.min(bx + 1, cx)), py = Math.max(by, Math.min(by + 1, cy)), pz = Math.max(bz, Math.min(bz + 1, cz));
      let nx = cx - px, ny = cy - py, nz = cz - pz;
      let d = Math.hypot(nx, ny, nz), depth;
      if (d > radius) continue;
      if (d < 1e-5) { nx = 0; ny = 1; nz = 0; depth = radius; } else { nx /= d; ny /= d; nz /= d; depth = radius - d; }
      const shape=readerShape(gb,bx,by,bz);
      if(shape!==CUBE){const contact=shapeSphere(shape,cx-bx,cy-by,cz-bz,radius);if(!contact)continue;[nx,ny,nz]=contact.n;depth=contact.depth;}
      const n = [nx, ny, nz];
      const rcn = [rw[0] - nx * radius, rw[1] - ny * radius, rw[2] - nz * radius];
      pointVel(st, rcn, vp);
      const vn = dot(vp, n);
      if(treeContacts)treeContacts.push({n,r:rcn,normal:0,tangent:[0,0,0]});
      else if (vn < 0) {
        const em = effMass(body, st, n, rcn);
        const j = -(body.passiveTree ? 1 : 1.12) * vn * em;
        const J = [nx * j, ny * j, nz * j];
        // atrito
        const tx = vp[0] - nx * vn, ty = vp[1] - ny * vn, tz = vp[2] - nz * vn, tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-4) {
          const tg = [tx / tl, ty / tl, tz / tl];
          const jt = Math.min((body.passiveTree ? .85 : .6) * j, tl * effMass(body, st, tg, rcn));
          J[0] -= tg[0] * jt; J[1] -= tg[1] * jt; J[2] -= tg[2] * jt;
        }
        applyImpulse(body, st, J, rcn, false);
      }
      if (depth > 0.02) { fixX += nx * (depth - 0.02); fixY += ny * (depth - 0.02); fixZ += nz * (depth - 0.02); nFix++; }
      grounded++;
      if(ny>.25)supported++;
    }
  }
  // Os vários apoios de uma árvore longa precisam equilibrar-se entre si.
  // Uma passada só deixa o último contato empurrar os anteriores, fazendo a
  // madeira rastejar mesmo num piso plano. Impulsos acumulados respeitam o
  // cone de atrito e convergem sem inventar uma trava por tempo de queda.
  if(treeContacts)for(let iteration=0;iteration<8;iteration++)for(const c of treeContacts){
    pointVel(st,c.r,vp);
    const old=c.normal;
    c.normal=Math.max(0,old-dot(vp,c.n)*effMass(body,st,c.n,c.r));
    const change=c.normal-old;
    applyImpulse(body,st,c.n.map(v=>v*change),c.r,false);
    pointVel(st,c.r,vp);
    const vn=dot(vp,c.n),tangent=vp.map((v,i)=>v-c.n[i]*vn),speed=Math.hypot(...tangent);
    if(speed<1e-6)continue;
    const direction=tangent.map(v=>v/speed),impulse=speed*effMass(body,st,direction,c.r);
    const next=c.tangent.map((v,i)=>v-direction[i]*impulse),length=Math.hypot(...next),limit=.85*c.normal;
    if(length>limit)for(let i=0;i<3;i++)next[i]*=limit/length;
    applyImpulse(body,st,next.map((v,i)=>v-c.tangent[i]),c.r,false);c.tangent=next;
  }
  if (nFix) { const k = 0.5 / nFix; p[0] += fixX * k; p[1] += fixY * k; p[2] += fixZ * k; }
  st.supported = supported;
  st.grounded = grounded;
}

// Onde cada bloco cai na grade se a máquina for estacionada agora. Devolve null se não estiver em pé e parada.
export function parkCells(body, st, rotateYaw) {
  rotMatrix(st.q, st.R);
  toWorld(st.R, [0, 1, 0], upW);
  if (upW[1] < 0.92) return null;
  toWorld(st.R, [0, 0, -1], t1);
  // -Z do corpo aponta para (−sin, −cos) do giro: descobre o giro e arredonda para 90°
  const yaw = Math.atan2(-t1[0], -t1[2]);
  const steps = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const c = [1, 0, -1, 0][steps], s = [0, 1, 0, -1][steps];
  const rot = (r) => [r[0] * c + r[2] * s, r[1], -r[0] * s + r[2] * c];
  const first = rot(body.cells[0].r);
  const ox = Math.round(st.p[0] + first[0] - 0.5) - (first[0] - 0.5), oy = Math.round(st.p[1] + first[1] - 0.5) - (first[1] - 0.5), oz = Math.round(st.p[2] + first[2] - 0.5) - (first[2] - 0.5);
  return body.blocks.map((b, i) => {
    const r = rot(body.cells[i].r);
    return [Math.round(ox + r[0] - 0.5), Math.round(oy + r[1] - 0.5), Math.round(oz + r[2] - 0.5), rotateYaw(b[3], steps)];
  });
}
