// LAVRA — tamanho, orientação (vertical/horizontal) e giro da forma que se vai colocar. Puro: sem three, sem DOM.

// Degraus de tamanho em metros: finos perto de 1 m (construção), largos acima (obras grandes).
export const SIZE_STEPS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
export const TURN_STEP = 15;           // graus por toque em T/G
export const ORIENT_MODES = ['v', 'h'];
export const ORIENT_LABEL = { v: 'Vertical', h: 'Horizontal' };

const r3 = (v) => Math.round(v * 1000) / 1000;
const SQ2 = Math.SQRT1_2;

export function nextOrient(cur) {
  return cur === 'h' ? 'v' : 'h';
}

function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qAxis(ax, ay, az, rad) {
  const h = rad * 0.5, s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}

function qZToNormal(nx, ny, nz) {
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return [0, 0, 0, 1];
  const x = nx / len, y = ny / len, z = nz / len;
  if (z < -0.9999) return [0, 1, 0, 0];
  const w = 1 + z;
  const cx = -y, cy = x, cz = 0;
  const n = Math.hypot(cx, cy, cz, w);
  return [cx / n, cy / n, cz / n, w / n];
}

// Quaternion de colocação para qualquer forma: orient='v' mantém em pé (e painel rente à parede); orient='h' deita 90° em torno de X.
// tiltDeg (Y/H, 20/11): inclinação a mais, em graus, somada ao deitar — o topo da forma vai para longe de quem olha
// (30° numa tora = caibro de telhado). Com inclinação, o painel deixa de colar na parede e segue a regra geral.
export function shapePlaceQuat(shape, yaw, normal, turnDeg = 0, orient = 'v', tiltDeg = 0) {
  const facing = Math.round((yaw || 0) / (Math.PI / 2)) * (Math.PI / 2);
  const turn = (turnDeg || 0) * Math.PI / 180;
  if (shape === 'painel' && orient !== 'h' && !tiltDeg && normal && Math.abs(normal[1]) < 0.7) {
    return qMul(qZToNormal(normal[0], normal[1], normal[2]), qAxis(0, 0, 1, turn));
  }
  const baseYaw = (shape === 'rampa' || shape === 'escada' ? facing + Math.PI : facing) + turn;
  const qy = qAxis(0, 1, 0, baseYaw);
  if (!tiltDeg) return orient !== 'h' ? qy : qMul(qy, [-SQ2, 0, 0, SQ2]);
  return qMul(qy, qAxis(1, 0, 0, -((orient === 'h' ? 90 : 0) + tiltDeg) * Math.PI / 180));
}

// Meia-altura mundial do objeto considerando a rotação q, para sondar luz acima da forma real.
export function shapeWorldHalfY(k, q, flat = false) {
  const [x, y, z, w] = q || [0, 0, 0, 1];
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  return (Math.abs(r10) * k[0] + Math.abs(r11) * k[1] + Math.abs(r12) * (flat ? Math.max(0.08, k[2]) : k[2])) * 0.5;
}

// Maior medida que conta para o degrau (no painel a espessura não conta).
export function mainSize(k, flat = false) {
  return flat ? Math.max(k[0], k[1]) : Math.max(k[0], k[1], k[2]);
}

// Próximo tamanho (dir = +1 aumenta, -1 diminui), mantendo a proporção da forma.
// A maior medida pula para o degrau seguinte da lista; as outras acompanham na mesma razão.
export function stepSize(k, dir, flat = false) {
  const cur = mainSize(k, flat);
  let target = cur;
  if (dir > 0) target = SIZE_STEPS.find((s) => s > cur + 1e-6) ?? cur;
  else for (let i = SIZE_STEPS.length - 1; i >= 0; i--) if (SIZE_STEPS[i] < cur - 1e-6) { target = SIZE_STEPS[i]; break; }
  if (target === cur) return [...k];
  const f = target / cur;
  return k.map((v, i) => (flat && i === 2 ? v : Math.max(0.02, r3(v * f))));
}

// Giro somado, em graus, sempre entre -180 e 180, em degraus de TURN_STEP.
export function stepTurn(deg, dir) {
  let d = Math.round(((deg || 0) + dir * TURN_STEP) / TURN_STEP) * TURN_STEP;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

// ---- comprimento e grossura em separado (setas; pedido do Kadmus, 20/11: "engrossar ou afinar o tronco") -------------
// Degraus mais finos que os de R/F: uma tora de telhado pede 1,75 m, um cabo pede 5 cm. Todos exatos em milímetros
// (o mundo guarda medidas com três casas: um degrau de 1/16 viraria 0,063 e nunca mais casaria com a lista).
export const FINE_STEPS = [0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 32, 48, 64];
function stepIn(list, cur, dir) {
  if (dir > 0) return list.find((s) => s > cur + 1e-6) ?? cur;
  for (let i = list.length - 1; i >= 0; i--) if (list[i] < cur - 1e-6) return list[i];
  return cur;
}
// Comprimento: a medida ao longo do eixo da forma (a "altura", k[1]). As outras ficam.
export function stepLength(k, dir) {
  return [k[0], stepIn(FINE_STEPS, k[1], dir), k[2]];
}
// Grossura: as duas medidas que atravessam o eixo (k[0] e k[2]) juntas, na mesma razão; o comprimento fica.
// No painel (flat), a grossura é só a espessura (k[2]).
export function stepThick(k, dir, flat = false) {
  if (flat) return [k[0], k[1], stepIn(FINE_STEPS, k[2], dir)];
  const cur = Math.max(k[0], k[2]), alvo = stepIn(FINE_STEPS, cur, dir);
  if (alvo === cur) return [...k];
  const f = alvo / cur;   // a maior medida cai exata no degrau; a outra acompanha
  return [k[0] >= k[2] ? alvo : Math.max(0.02, r3(k[0] * f)), k[1], k[2] >= k[0] ? alvo : Math.max(0.02, r3(k[2] * f))];
}
// Inclinação somada (Y/H), em graus, entre -180 e 180, nos mesmos degraus do giro.
export const stepTilt = stepTurn;
