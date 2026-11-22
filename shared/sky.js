// LAVRA — o céu de verdade: onde estão o sol, a lua, os planetas e as estrelas para quem olha de um lugar da Terra
// num instante. Código puro. A conta fina é da biblioteca Astronomy Engine (MIT), recebida por parâmetro: assim o
// mesmo código roda no navegador (vendor/astronomy.js, carregado só quando há um lugar definido) e nos testes
// (o pacote do npm). Nenhuma rede: tudo sai da data, da hora e do lugar.
//
// Eixos do jogo: +X = leste, +Y = para cima, +Z = sul (logo, norte = -Z).

export const PLANETS = [
  { id: 'Mercury', nome: 'Mercúrio', cor: [0.8, 0.78, 0.74] },
  { id: 'Venus', nome: 'Vênus', cor: [1.0, 0.98, 0.9] },
  { id: 'Mars', nome: 'Marte', cor: [1.0, 0.62, 0.42] },
  { id: 'Jupiter', nome: 'Júpiter', cor: [1.0, 0.93, 0.8] },
  { id: 'Saturn', nome: 'Saturno', cor: [0.98, 0.9, 0.68] },
];
const RAD = Math.PI / 180;

// azimute (graus a partir do norte, crescendo para o leste) e altura (graus acima do horizonte) -> direção no jogo
export function dirFromHorizon(az, alt, out = [0, 0, 0]) {
  const a = az * RAD, h = alt * RAD, c = Math.cos(h);
  out[0] = Math.sin(a) * c; out[1] = Math.sin(h); out[2] = -Math.cos(a) * c;
  return out;
}
// vetor no sistema horizontal da biblioteca (x = norte, y = oeste, z = zênite) -> eixos do jogo
export function horToGame(x, y, z, out = [0, 0, 0]) { out[0] = -y; out[1] = z; out[2] = -x; return out; }
// ascensão reta e declinação (graus, J2000) -> vetor unitário equatorial (o referencial do catálogo de estrelas)
export function eqjVector(ra, dec, out = [0, 0, 0]) {
  const a = ra * RAD, d = dec * RAD, c = Math.cos(d);
  out[0] = Math.cos(a) * c; out[1] = Math.sin(a) * c; out[2] = Math.sin(d);
  return out;
}
// aplica a matriz 3x3 (guardada por linhas) a um vetor
export function rotate(m, v, out = [0, 0, 0]) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z; out[1] = m[3] * x + m[4] * y + m[5] * z; out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
// Cor de uma estrela pelo índice B-V (azulada, branca, amarelada, alaranjada), em RGB linear aproximado.
export function starColor(bv, out = [0, 0, 0]) {
  const t = Math.max(-0.3, Math.min(1.8, bv));
  if (t < 0.3) { const k = (t + 0.3) / 0.6; out[0] = 0.62 + 0.3 * k; out[1] = 0.74 + 0.2 * k; out[2] = 1; }
  else if (t < 0.8) { const k = (t - 0.3) / 0.5; out[0] = 0.92 + 0.08 * k; out[1] = 0.94 + 0.01 * k; out[2] = 1 - 0.16 * k; }
  else { const k = (t - 0.8) / 1.0; out[0] = 1; out[1] = 0.95 - 0.24 * k; out[2] = 0.84 - 0.36 * k; }
  return out;
}

// Retrato do céu num instante (utcMs = milissegundos UTC) para quem está em (lat, lon em graus; alt em metros):
//   sun, moon : direção no jogo (vetor unitário; y < 0 = abaixo do horizonte)
//   moonLit   : fração iluminada do disco da lua (0 = nova, 1 = cheia)
//   planets   : [{ id, nome, cor, dir, mag }] (mag = magnitude visual: quanto menor, mais brilhante)
//   rot       : matriz 3x3 por linhas que leva um vetor equatorial J2000 (as estrelas do catálogo) aos eixos do jogo
export function computeSky(A, utcMs, lat, lon, alt = 0) {
  const time = A.MakeTime(new Date(utcMs)), obs = new A.Observer(lat, lon, alt);
  const where = (body) => {
    const eq = A.Equator(body, time, obs, true, true);        // equatorial da data, com aberração: o lugar aparente
    const h = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');   // com a refração do ar (ergue o que está rente ao horizonte)
    return dirFromHorizon(h.azimuth, h.altitude);
  };
  const planets = PLANETS.map((p) => ({ ...p, dir: where(p.id), mag: A.Illumination(p.id, time).mag }));
  // a matriz sai aplicando a rotação da biblioteca aos três eixos: não depende da ordem interna dos índices dela
  const R = A.Rotation_EQJ_HOR(time, obs);
  const axis = (x, y, z) => { const v = A.RotateVector(R, new A.Vector(x, y, z, time)); return horToGame(v.x, v.y, v.z); };
  const cx = axis(1, 0, 0), cy = axis(0, 1, 0), cz = axis(0, 0, 1);
  return {
    sun: where('Sun'), moon: where('Moon'), moonLit: A.Illumination('Moon', time).phase_fraction, planets,
    rot: [cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]],
  };
}
