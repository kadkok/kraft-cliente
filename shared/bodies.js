// LAVRA — corpos dos bichos. Cada animal é um corpo com raio, altura, peso e força, e obedece ao mundo:
// não atravessa bloco, não atravessa outro corpo, cai, vence degrau pulando (se tiver força), nada ou voa conforme
// a espécie. O comportamento (shared/nature.js) só diz ONDE o bicho quer estar e com que pressa; aqui se decide até
// onde ele consegue ir. Código puro e de passo fixo: mesma entrada, mesma trajetória.

import { B, SOLID, LEVEL } from './blocks.js';
import { boxSolid, floorHeight, readerShape, CUBE } from './surfaces.js';
import { surfaceOf } from './water.js';

// r = raio (m) · h = altura (m) · m = massa (kg) · acc = aceleração máxima (m/s²: a "força" do bicho)
// salto = quantos blocos vence num pulo · meio = onde vive ('chao' | 'agua' | 'ar') · nada = entra na água por vontade própria
export const BODY = {
  cardume: { r: 0.15, h: 0.2, m: 0.4, acc: 9, salto: 0, meio: 'agua' },
  palhaco: { r: 0.11, h: 0.14, m: 0.12, acc: 11, salto: 0, meio: 'agua' },
  salmao: { r: 0.18, h: 0.22, m: 2.5, acc: 11, salto: 0, meio: 'agua' },
  atum: { r: 0.28, h: 0.34, m: 24, acc: 14, salto: 0, meio: 'agua' },
  agulhao: { r: 0.28, h: 0.34, m: 35, acc: 16, salto: 0, meio: 'agua' },
  tubarao: { r: 0.45, h: 0.55, m: 180, acc: 12, salto: 0, meio: 'agua' },
  arraia: { r: 0.42, h: 0.25, m: 45, acc: 9, salto: 0, meio: 'agua' },
  tartaruga: { r: 0.32, h: 0.28, m: 28, acc: 8, salto: 0, meio: 'agua' },
  golfinho: { r: 0.38, h: 0.44, m: 90, acc: 14, salto: 0, meio: 'agua' },
  orca: { r: 0.65, h: 0.72, m: 900, acc: 11, salto: 0, meio: 'agua' },
  baleia: { r: 0.85, h: 0.9, m: 4000, acc: 7, salto: 0, meio: 'agua' },
  polvo: { r: 0.22, h: 0.24, m: 4, acc: 9, salto: 0, meio: 'agua' },
  aguaviva: { r: 0.16, h: 0.22, m: 0.5, acc: 5, salto: 0, meio: 'agua' },
  rebanho: { r: 0.36, h: 0.85, m: 45, acc: 7, salto: 1, meio: 'chao', nada: false },
  manada: { r: 0.55, h: 1.7, m: 450, acc: 9, salto: 1, meio: 'chao', nada: false },
  bando: { r: 0.15, h: 0.16, m: 0.06, acc: 18, salto: 0, meio: 'ar' },
  enxame: { r: 0.05, h: 0.06, m: 0.001, acc: 14, salto: 0, meio: 'ar' },
  ratos: { r: 0.1, h: 0.12, m: 0.03, acc: 16, salto: 1, meio: 'chao', nada: false },
  sapos: { r: 0.12, h: 0.14, m: 0.06, acc: 12, salto: 1, meio: 'chao', nada: true },
};
export const GRAVITY = 24;
const EPS = 1e-3;
const JUMP = Math.sqrt(2 * GRAVITY * 1.35);      // impulso que vence um bloco de altura, com folga (o passo de física é de 1/24 s)

export function newBody(kind, id, x, y, z) {
  return { kind, id, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, on: false, wet: false, fly: false, stuck: 0 };
}

// A célula barra este corpo? Peixe só existe dentro d'água: para ele, tudo o que não é água é parede.
function wall(spec, b) { return spec.meio === 'agua' ? b !== B.WATER : b === -1 || SOLID[b] === 1; }

// O corpo (caixa de lado 2r e altura h, com os pés em y) encosta em alguma célula que o barra?
export function hits(get, spec, x, y, z) {
  if(spec.meio!=='agua'&&!spec.aquatic)return boxSolid(get,x-spec.r,y,z-spec.r,x+spec.r,y+spec.h,z+spec.r);
  const r = spec.r, x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y), y1 = Math.floor(y + spec.h), z0 = Math.floor(z - r), z1 = Math.floor(z + r);
  for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) if (wall(spec, get(cx, cy, cz))) return true;
  return false;
}

// Desloca o corpo num eixo ('x' | 'y' | 'z') e encosta na parede se bater. Devolve true se bateu.
export function move(get, b, spec, axis, d) {
  if (d === 0) return false;
  const steps = Math.ceil(Math.abs(d) / 0.4), step = d / steps;
  const lo = axis === 'y' ? 0 : spec.r, hi = axis === 'y' ? spec.h : spec.r;
  for (let i = 0; i < steps; i++) {
    const old = b[axis];
    b[axis] = old + step;
    if (!hits(get, spec, b.x, b.y, b.z)) continue;
    if(axis!=='y'&&b.on&&b.vy<=0&&spec.meio!=='agua'){
      const h=floorHeight(get,b.x,b.z,b.y+Math.abs(step)*2+EPS,Math.abs(step)*2+EPS,spec.r,true);
      if(Number.isFinite(h)&&h>=b.y-EPS&&!hits(get,spec,b.x,h+EPS,b.z)){b.y=h+EPS;continue;}
    }
    if(spec.meio==='agua'||spec.aquatic){
      b[axis]=step>0?Math.floor(b[axis]+hi)-hi-EPS:Math.floor(b[axis]-lo)+1+lo+EPS;
      if(hits(get,spec,b.x,b.y,b.z))b[axis]=old;
      return true;
    }
    let low=0,high=1;
    for(let j=0;j<14;j++){const t=(low+high)/2;b[axis]=old+step*t;if(hits(get,spec,b.x,b.y,b.z))high=t;else low=t;}
    b[axis]=old+step*low;
    return true;
  }
  return false;
}

const approach = (v, target, max) => (target > v ? Math.min(target, v + max) : Math.max(target, v - max));
// o mesmo corpo, colidindo só com o que é sólido (peixe que ainda não coube na água)
const DRY = new Map();
function dry(spec) { let d = DRY.get(spec); if (!d) { d = { ...spec, meio: 'chao', aquatic: true }; DRY.set(spec, d); } return d; }

// Um passo de física de um corpo.
// want = { x, y, z: onde ele quer estar · speed: velocidade de cruzeiro (m/s) · fly: quer estar no ar (aves, insetos)
//          · brave: aceita descer barranco alto e entrar na água (fuga) · seed: inteiro para desempatar desvios }
export function stepBody(get, b, spec, want, dt) {
  const mid = get(Math.floor(b.x), Math.floor(b.y + spec.h * 0.5), Math.floor(b.z));
  // molhado = o meio do corpo está abaixo da superfície daquela célula (água corrente rasa só molha os pés)
  const my = b.y + spec.h * 0.5;
  b.wet = mid > 0 && LEVEL[mid] > 0 && my - Math.floor(my) < surfaceOf(mid, get(Math.floor(b.x), Math.floor(my) + 1, Math.floor(b.z)));
  let dx = want.x - b.x, dy = want.y - b.y, dz = want.z - b.z;

  if (spec.meio === 'agua') {
    // nadador: três eixos, sem gravidade. Fora d'água (encalhado), ou atravessado na linha d'água, ele colide como um
    // corpo comum e desce até caber inteiro dentro dela.
    const inside = b.wet && !hits(get, spec, b.x, b.y, b.z), col = inside ? spec : dry(spec);
    if (!b.wet) { b.vy -= GRAVITY * dt; b.vx *= 0.9; b.vz *= 0.9; } else if (!inside) { b.vy = approach(b.vy, -1.5, 20 * dt); b.vx *= 0.8; b.vz *= 0.8; } else {
      const dist = Math.hypot(dx, dy, dz) || 1, sp = Math.min(want.speed, dist * 2.5), a = spec.acc * dt;
      b.vx = approach(b.vx, (dx / dist) * sp, a); b.vy = approach(b.vy, (dy / dist) * sp, a); b.vz = approach(b.vz, (dz / dist) * sp, a);
    }
    if (move(get, b, col, 'x', b.vx * dt)) b.vx = 0;
    if (move(get, b, col, 'z', b.vz * dt)) b.vz = 0;
    const hy = move(get, b, col, 'y', b.vy * dt);
    b.on = !inside && hy && b.vy <= 0;
    if (hy) b.vy = 0;
  } else if (spec.meio === 'ar' && want.fly) {
    // voador no ar: persegue o ponto em três eixos; se há bloco à frente, sobe para passar por cima
    b.fly = true; b.on = false;
    const dist = Math.hypot(dx, dy, dz) || 1, sp = Math.min(want.speed, dist * 2.2), a = spec.acc * dt;
    let tx = (dx / dist) * sp, ty = (dy / dist) * sp, tz = (dz / dist) * sp;
    const hd = Math.hypot(dx, dz);
    if (hd > 0.5) {
      // sente o caminho na direção em que quer ir, perto e um pouco adiante: havendo bloco, sobe até passar por cima
      const ux = dx / hd, uz = dz / hd, hv = Math.hypot(b.vx, b.vz), my = Math.floor(b.y + spec.h * 0.5);
      const near = get(Math.floor(b.x + ux * (spec.r + 0.45)), my, Math.floor(b.z + uz * (spec.r + 0.45)));
      const far = get(Math.floor(b.x + ux * (spec.r + 1 + hv * 0.4)), my, Math.floor(b.z + uz * (spec.r + 1 + hv * 0.4)));
      if (near === -1 || SOLID[near] === 1) { ty = Math.max(want.speed, 3) * 0.9; tx = ux * 0.6; tz = uz * 0.6; }
      else if (far === -1 || SOLID[far] === 1) { ty = Math.max(ty, Math.max(want.speed, 3) * 0.8); tx *= 0.5; tz *= 0.5; }
    }
    b.vx = approach(b.vx, tx, a); b.vy = approach(b.vy, ty, a); b.vz = approach(b.vz, tz, a);
    if (move(get, b, spec, 'x', b.vx * dt)) b.vx = 0;
    if (move(get, b, spec, 'z', b.vz * dt)) b.vz = 0;
    if (move(get, b, spec, 'y', b.vy * dt)) b.vy = 0;
  } else {
    // andador (e ave que desce para pousar): gravidade, chão, degrau vencido no pulo, parede contornada
    b.fly = false;
    const dist = Math.hypot(dx, dz), a = spec.acc * dt * (b.on || b.wet || spec.meio === 'ar' ? 1 : 0.25);
    let sp = dist > 0.25 ? Math.min(want.speed, dist * 2.2) : 0;
    if (b.wet) sp *= 0.55;
    let ux = dist > 1e-6 ? dx / dist : 0, uz = dist > 1e-6 ? dz / dist : 0;
    if (sp > 0 && b.on) {
      // olha um passo à frente, na altura dos pés: parede? degrau? barranco? água?
      const reach = spec.r + 0.3, fx = Math.floor(b.x + ux * reach), fz = Math.floor(b.z + uz * reach), fy = Math.floor(b.y + 0.05);
      const front = get(fx, fy, fz), solidFront = front === -1 || SOLID[front] === 1;
      if (solidFront && readerShape(get,fx,fy,fz)===CUBE && !Number.isFinite(floorHeight(get,b.x,b.z,b.y+.02,.12,spec.r,true))) {
        // pula se o degrau tem um bloco só: precisa de folga para subir aqui e de lugar para o corpo lá em cima
        const canJump = spec.salto >= 1 && !hits(get, spec, b.x, b.y + 1.02, b.z) && !hits(get, spec, fx + 0.5, fy + 1.02, fz + 0.5);
        if (canJump) b.vy = JUMP;
        else {
          // alto demais para o pulo: contorna a parede, sempre para o mesmo lado enquanto durar o obstáculo
          const side = ((want.seed + b.id) & 1) ? 1 : -1, c = 0.2, s = 0.98 * side, nx = ux * c - uz * s, nz = ux * s + uz * c;
          ux = nx; uz = nz; b.stuck += dt;
        }
      } else if (front > 0 && LEVEL[front] >= 3 && !(spec.nada || want.brave || want.water)) {
        sp = 0;                                                         // água à frente e ele não é de nadar: para na margem
      } else {
        b.stuck = 0;
        // chão à frente: desce no máximo dois blocos por vontade própria (quatro, se está fugindo)
        const maxDrop = want.brave ? 4 : 2;
        let drop = 0;
        while (drop <= maxDrop) { const g = get(fx, fy - 1 - drop, fz); if (g === -1 || SOLID[g] === 1) break; if (g > 0 && LEVEL[g] >= 3) { drop = spec.nada || want.brave || want.water ? 0 : 99; break; } drop++; }
        if (drop > maxDrop) sp = 0;                                     // barranco ou água que ele não quer: para na beira
      }
    }
    b.vx = approach(b.vx, ux * sp, a); b.vz = approach(b.vz, uz * sp, a);
    if (b.wet) { b.vy = approach(b.vy, 1.6, 30 * dt); } else b.vy -= GRAVITY * dt;      // na água, boia
    if (b.vy < -40) b.vy = -40;
    if (spec.meio === 'ar' && b.vy < -4.5) b.vy = -4.5;                 // ave descendo para pousar plana, não despenca
    if (move(get, b, spec, 'x', b.vx * dt)) b.vx = 0;
    if (move(get, b, spec, 'z', b.vz * dt)) b.vz = 0;
    if(b.on&&b.vy<=0){
      const drop=Math.hypot(b.vx,b.vz)*dt*2+.025,h=floorHeight(get,b.x,b.z,b.y+EPS,drop,spec.r);
      if(Number.isFinite(h)&&!hits(get,spec,b.x,h+EPS,b.z))b.y=h+EPS;
    }
    const hitY = move(get, b, spec, 'y', b.vy * dt);
    b.on = hitY && b.vy <= 0;
    if (hitY) b.vy = 0;
    if (b.wet) {
      // boiando: a cabeça fica na linha d'água, não sai voando dela
      const above = get(Math.floor(b.x), Math.floor(b.y + spec.h * 0.5 + 0.35), Math.floor(b.z));
      if (!(above > 0 && LEVEL[above]) && b.vy > 0) b.vy = 0;
    }
  }
  const hv = Math.hypot(b.vx, b.vz);
  if (hv > 0.2) b.yaw = Math.atan2(b.vx, b.vz); else if (want.yaw !== undefined && hv < 0.05) b.yaw += shortest(want.yaw - b.yaw) * Math.min(1, dt * 3);
  return b;
}
function shortest(d) { return ((d + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI; }

// Corpos não se atravessam: quando dois se sobrepõem, são afastados. O mais leve cede mais (o peso manda),
// e o afastamento respeita os blocos (ninguém é empurrado para dentro de parede).
// list = [{ b: corpo, spec }] ; fixed = [{ x, y, z, r, h }] corpos que não cedem (quem joga).
export function separate(get, list, fixed = []) {
  const cell = 1.2, grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < list.length; i++) {
    const k = key(Math.floor(list[i].b.x / cell), Math.floor(list[i].b.z / cell));
    const g = grid.get(k); if (g) g.push(i); else grid.set(k, [i]);
  }
  // empurra respeitando os blocos e devolve quanto o corpo de fato andou na direção pedida
  const push = (e, nx, nz, d) => {
    if (d <= 0) return 0;
    const x0 = e.b.x, z0 = e.b.z, col = e.spec.meio === 'agua' ? dry(e.spec) : e.spec;
    move(get, e.b, col, 'x', nx * d); move(get, e.b, col, 'z', nz * d);
    if (e.spec.meio === 'agua' && hits(get, e.spec, e.b.x, e.b.y, e.b.z) && !hits(get, e.spec, x0, e.b.y, z0)) { e.b.x = x0; e.b.z = z0; }   // peixe não é empurrado para fora d'água
    return (e.b.x - x0) * nx + (e.b.z - z0) * nz;
  };
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < list.length; i++) {
    const A = list[i], a = A.b, cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell);
    for (let gz = cz - 1; gz <= cz + 1; gz++) for (let gx = cx - 1; gx <= cx + 1; gx++) {
      const g = grid.get(key(gx, gz));
      if (!g) continue;
      for (const j of g) {
        if (j <= i) continue;
        const Bq = list[j], q = Bq.b;
        if (a.y + A.spec.h <= q.y || q.y + Bq.spec.h <= a.y) continue;          // um por cima do outro: não se tocam
        let nx = q.x - a.x, nz = q.z - a.z;
        const min = A.spec.r + Bq.spec.r, d = Math.hypot(nx, nz);
        if (d >= min) continue;
        // quem nada ou voa tem os três eixos para se desviar: se as alturas mal se cruzam, um sobe e o outro desce
        if (A.spec.meio !== 'chao' && Bq.spec.meio !== 'chao' && !a.on && !q.on) {
          const ca = a.y + A.spec.h / 2, cq = q.y + Bq.spec.h / 2, vy = (A.spec.h + Bq.spec.h) / 2 - Math.abs(ca - cq);
          if (vy < min - d) {
            const s = ca <= cq ? -1 : 1, colA = A.spec.meio === 'agua' ? dry(A.spec) : A.spec, colQ = Bq.spec.meio === 'agua' ? dry(Bq.spec) : Bq.spec;
            const ya = a.y, yq = q.y;
            move(get, a, colA, 'y', s * (vy / 2 + 5e-4)); move(get, q, colQ, 'y', -s * (vy / 2 + 5e-4));
            if (A.spec.meio === 'agua' && hits(get, A.spec, a.x, a.y, a.z)) a.y = ya;
            if (Bq.spec.meio === 'agua' && hits(get, Bq.spec, q.x, q.y, q.z)) q.y = yq;
            if (a.y + A.spec.h <= q.y || q.y + Bq.spec.h <= a.y) continue;
          }
        }
        if (d < 1e-5) { const ang = ((a.id * 37 + q.id * 17) % 628) / 100; nx = Math.cos(ang); nz = Math.sin(ang); } else { nx /= d; nz /= d; }
        const over = min - d + 1e-3, total = A.spec.m + Bq.spec.m;
        const wa = over * (Bq.spec.m / total), wq = over * (A.spec.m / total);
        const ga = push(A, -nx, -nz, wa), gq = push(Bq, nx, nz, wq);
        // um dos dois está encostado em parede e não pôde ceder a sua parte: o outro cede o resto
        if (ga < wa - 1e-4) push(Bq, nx, nz, wa - ga); else if (gq < wq - 1e-4) push(A, -nx, -nz, wq - gq);
        // quem vinha de encontro perde o embalo nessa direção
        const va = a.vx * nx + a.vz * nz, vq = q.vx * nx + q.vz * nz;
        if (va > 0) { a.vx -= nx * va; a.vz -= nz * va; }
        if (vq < 0) { q.vx -= nx * vq; q.vz -= nz * vq; }
      }
    }
    if (pass === 0) for (const f of fixed) {
      if (a.y + A.spec.h <= f.y || f.y + f.h <= a.y) continue;
      let nx = a.x - f.x, nz = a.z - f.z;
      const min = A.spec.r + f.r, d = Math.hypot(nx, nz);
      if (d >= min) continue;
      if (d < 1e-5) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
      push(A, nx, nz, min - d + 1e-3);
    }
  }
}
