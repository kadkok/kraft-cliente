// LAVRA — física acústica pura: propagação à velocidade do som, atenuação esférica (1/r),
// absorção atmosférica de agudos, efeito Doppler clássico, panorâmica estéreo e oclusão por blocos.
// Puro e sem dependências do DOM/Web Audio para ser testado no Node e executado no cliente.

export const SPEED_OF_SOUND_AIR = 343.0;      // m/s a ~20 °C
export const SPEED_OF_SOUND_WATER = 1480.0;   // m/s na água
export const MAX_DELAY_S = 4.5;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function soundSpeed(underwater = false) {
  return underwater ? SPEED_OF_SOUND_WATER : SPEED_OF_SOUND_AIR;
}

/**
 * Tempo que a frente de onda leva para percorrer `distance` metros até o ouvido.
 * Eventos colados no jogador (<= 1.0 m) não sofrem atraso perceptível.
 */
export function propagationDelay(distance, underwater = false) {
  if (!(distance > 1.0)) return 0;
  return Math.min(MAX_DELAY_S, distance / soundSpeed(underwater));
}

/**
 * Atenuação de pressão sonora pela distância (lei física 1/r com raio de referência
 * e fechamento suave até zero exatamente em `maxDist`, sem vazamento fora do espaço da fonte).
 */
export function waveAttenuation(distance, { refDist = 3.0, maxDist = 64.0, rolloff = 1.0 } = {}) {
  if (!(maxDist > 0) || distance >= maxDist) return 0;
  if (distance <= 0.25) return 1;
  const eff = Math.max(0, distance - 0.5);
  const pressure = refDist / (refDist + rolloff * eff);
  const fadeStart = maxDist * 0.76;
  if (distance <= fadeStart) return pressure;
  const u = clamp((distance - fadeStart) / Math.max(0.001, maxDist - fadeStart), 0, 1);
  const smooth = 1 - u * u * (3 - 2 * u);
  return pressure * smooth;
}

/**
 * Efeito Doppler acústico clássico:
 *   f' = f * (c + v_listener_toward_source) / (c + v_source_away_from_listener)
 * Aproxima-se -> razão > 1 (mais agudo); afasta-se -> razão < 1 (mais grave).
 */
export function dopplerShift(earPos, earVel, srcPos, srcVel, underwater = false) {
  if (!earPos || !srcPos) return 1;
  const dx = srcPos[0] - earPos[0], dy = srcPos[1] - earPos[1], dz = srcPos[2] - earPos[2];
  const d = Math.hypot(dx, dy, dz);
  if (!(d > 0.05)) return 1;
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const vl = earVel ? (earVel[0] * ux + earVel[1] * uy + earVel[2] * uz) : 0;
  const us = srcVel ? (srcVel[0] * ux + srcVel[1] * uy + srcVel[2] * uz) : 0;
  const c = soundSpeed(underwater);
  const num = Math.max(c * 0.25, c + vl);
  const den = Math.max(c * 0.25, c + us);
  return clamp(num / den, 0.55, 1.85);
}

/**
 * Frequência de corte (Hz) para filtro passa-baixa simulando absorção pelo meio e oclusão por paredes.
 */
export function airAbsorptionCutoff(distance, underwater = false, occlusion = 0) {
  const base = underwater
    ? Math.max(240, 950 * Math.exp(-Math.max(0, distance) * 0.014))
    : Math.max(480, 19500 * Math.exp(-Math.max(0, distance) * 0.024));
  const occ = clamp(occlusion, 0, 1);
  return occ <= 0 ? base : base * Math.pow(360 / base, occ);
}

/**
 * Posição no panorama estéreo [-0.92, +0.92] dado o vetor direito do ouvido (`rx`, `rz`).
 */
export function stereoPan(earPos, earRight, srcPos) {
  if (!earPos || !srcPos || !earRight) return 0;
  const dx = srcPos[0] - earPos[0], dz = srcPos[2] - earPos[2];
  const d = Math.hypot(dx, srcPos[1] - earPos[1], dz);
  if (!(d > 0.35)) return 0;
  return clamp((dx * earRight[0] + dz * earRight[1]) / d, -1, 1) * 0.92;
}

/**
 * Traça amostras ao longo da linha de visada entre ouvido e fonte para estimar oclusão acústica (0..1).
 * `getBlock(x, y, z)` retorna id do bloco; `isOpaque(id)` e `isWater(id)` classificam o meio.
 */
export function measureOcclusion(getBlock, earPos, srcPos, { isOpaque, isWater, isSolid } = {}) {
  if (!getBlock || !earPos || !srcPos) return 0;
  const dx = srcPos[0] - earPos[0], dy = srcPos[1] - earPos[1], dz = srcPos[2] - earPos[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1.6) return 0;
  const steps = Math.min(10, Math.max(2, Math.floor(dist / 1.4)));
  const earW = isWater ? isWater(getBlock(Math.floor(earPos[0]), Math.floor(earPos[1]), Math.floor(earPos[2]))) : false;
  let occ = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(earPos[0] + dx * t);
    const y = Math.floor(earPos[1] + dy * t);
    const z = Math.floor(earPos[2] + dz * t);
    const id = getBlock(x, y, z);
    if (id <= 0) continue;
    if (isWater && isWater(id) !== earW) { occ += 0.35; continue; }
    if (isOpaque && isOpaque(id)) occ += 0.28;
    else if (isSolid && isSolid(id)) occ += 0.1;
    if (occ >= 1) return 1;
  }
  return clamp(occ, 0, 1);
}

/**
 * Energia de onda na superfície (0..1) espelhando exatamente o shader de água em materials.js.
 * Sem vento acima do limiar (uWind.z <= 0.35), a superfície é lisa/parada -> energia = 0.
 */
export function waveEnergyOfWind(windZ) {
  return clamp(((windZ || 0) - 0.35) / 1.45, 0, 1);
}

/**
 * Nível sonoro de ondas do mar (0..1): água parada ou poça pequena retorna 0;
 * só soa quando há corpo aberto de mar/lago amplo E energia de onda > 0.08.
 */
export function seaWaveLevel(seaWater = 0, waveEnergy = 0) {
  if (!(seaWater > 0.05) || !(waveEnergy > 0.08)) return 0;
  return clamp(seaWater, 0, 1) * Math.pow(clamp((waveEnergy - 0.08) / 0.92, 0, 1), 1.15);
}

/**
 * Tabela oficial de loops e sprites (fatias [início_s, duração_s] + LUFS por fatia)
 * portada de dgreenheck/tidewater (MIT, áudios CC0 1.0 do Freesound).
 */
export const TIDEWATER_BANK = Object.freeze({
  surf_far: { file: 'mar.surf_far.ogg', loop: true, lufs: -23 },
  wind: { file: 'mar.wind.ogg', loop: true, lufs: -23.6 },
  palms: { file: 'mar.palms.ogg', loop: true, lufs: -23.3 },
  pier_lap: { file: 'mar.pier_lap.ogg', loop: true, lufs: -30.7 },
  under_reef: { file: 'mar.under_reef.ogg', loop: true, lufs: -23 },
  boat_engine: { file: 'mar.boat_engine.ogg', loop: true, lufs: -23 },
  boat_lap: { file: 'mar.boat_lap.ogg', loop: true, lufs: -32.2 },
  boat_rush: { file: 'mar.boat_rush.ogg', loop: true, lufs: -23.4 },
  whale_song: { file: 'mar.whale_song.ogg', loop: true, lufs: -25.5 },
  step_sand: { file: 'mar.step_sand.ogg', slices: [[0.08, 0.191], [0.351, 0.3153], [0.7463, 0.2237], [1.05, 0.516], [1.646, 0.436]], lufs: [-25, -25.4, -27, -22.5, -19.8] },
  step_wetsand: { file: 'mar.step_wetsand.ogg', slices: [[0.08, 0.171], [0.331, 0.376], [0.787, 0.226], [1.093, 0.246], [1.419, 0.221]], lufs: [-27.4, -19.6, -21.7, -20.9, -20.1] },
  surf_crash: { file: 'mar.surf_crash.ogg', slices: [[0.08, 3.254], [3.414, 2.504], [5.998, 2.554], [8.632, 1.304], [10.016, 2.804], [12.9, 2.204], [15.184, 2.7493]], lufs: [-13, -13.4, -14.1, -17, -13, -14, -12.7] },
  surf_wash: { file: 'mar.surf_wash.ogg', slices: [[0.08, 1.404], [1.564, 2.054], [3.698, 1.504], [5.282, 1.354], [6.716, 1.904], [8.7, 1.154]], lufs: [-12.4, -11.3, -16.5, -13.7, -14.5, -22.3] },
  surf_backwash: { file: 'mar.surf_backwash.ogg', slices: [[0.08, 1.804], [1.964, 1.904], [3.948, 3.804], [7.832, 2.254], [10.166, 2.394], [12.64, 2.404]], lufs: [-13.1, -17.7, -22.1, -16.6, -14.4, -15.9] },
  step_wood: { file: 'mar.step_wood.ogg', slices: [[0.08, 0.4267], [0.5867, 0.424], [1.0907, 0.424], [1.5947, 0.417], [2.0917, 0.4326]], lufs: [-22.5, -20.9, -20.8, -20.2, -20.8] },
  step_water: { file: 'mar.step_water.ogg', slices: [[0.08, 0.854], [1.014, 0.704], [1.798, 0.624], [2.502, 0.624], [3.206, 0.854]], lufs: [-17.5, -16, -19.5, -23, -14.9] },
  swim: { file: 'mar.swim.ogg', slices: [[0.08, 0.754], [0.914, 0.5547], [1.5487, 0.604], [2.2327, 0.804]], lufs: [-18.5, -21.2, -15.6, -23.2] },
  uw_swim: { file: 'mar.uw_swim.ogg', slices: [[0.08, 0.626], [0.786, 0.836], [1.702, 0.786], [2.568, 1.1053]], lufs: [-16, -23.9, -25.6, -18.6] },
  submerge: { file: 'mar.submerge.ogg', slices: [[0.08, 0.804], [0.964, 0.754]], lufs: [-24.7, -26.6] },
  emerge: { file: 'mar.emerge.ogg', slices: [[0.08, 0.904]], lufs: [-18.8] },
  splash: { file: 'mar.splash.ogg', slices: [[0.08, 1.604], [1.764, 2.2067], [4.0507, 2.2133], [6.344, 1.906]], lufs: [-19, -18, -14.1, -15.5] },
  hull_slap: { file: 'mar.hull_slap.ogg', slices: [[0.08, 0.554], [0.714, 0.754], [1.548, 0.404], [2.032, 0.5087], [2.6207, 0.406]], lufs: [-20.7, -18.4, -20.2, -17.7, -16.4] },
  gull: { file: 'mar.gull.ogg', slices: [[0.08, 1.001], [1.161, 1.404], [2.645, 0.904], [3.629, 1.114], [4.823, 1.044], [5.947, 0.5267]], lufs: [-15.9, -16.2, -18.1, -11.8, -12.8, -12.8] },
  tern: { file: 'mar.tern.ogg', slices: [[0.08, 2.1097], [2.2697, 1.85], [4.1997, 2.4098], [6.6894, 1.3657], [8.1351, 1.02], [9.2351, 1.99]], lufs: [-9.8, -10.7, -12.4, -12, -9, -12.9] },
  whale_blow: { file: 'mar.whale_blow.ogg', slices: [[0.08, 2.0057], [2.1657, 1.3331], [3.5789, 1.5137]], lufs: [-13.3, -14.2, -14.4] },
  big_splash: { file: 'mar.big_splash.ogg', slices: [[0.08, 2.1477], [2.3077, 1.7777]], lufs: [-15.6, -18.7] },
});

export const TIDEWATER_BY_FILE = new Map(
  Object.entries(TIDEWATER_BANK).map(([id, info]) => [info.file, { id, ...info }]),
);

/**
 * Ganho linear de normalização por fatia de um sprite a partir do vetor `lufs` medido no Tidewater,
 * nivelando as fatias pela mediana/média do sprite (limitado a [0.42, 2.1]).
 */
export function tidewaterSliceGain(lufsList, index) {
  if (!Array.isArray(lufsList) || !lufsList.length) return 1;
  const cur = Number.isFinite(lufsList[index]) ? lufsList[index] : lufsList[0];
  let sum = 0;
  for (let i = 0; i < lufsList.length; i++) sum += lufsList[i];
  const mean = sum / lufsList.length;
  return clamp(Math.pow(10, (mean - cur) / 20), 0.42, 2.1);
}

/**
 * Classifica a superfície de passo costeiro estilo SoundScape.js:
 * - em água rasa (`inWater`): `'water'` (`step_water`)
 * - areia molhada perto da linha d'água (`mat === 'sand'` com água adjacente ou na cota do mar): `'wetsand'` (`step_wetsand`)
 * - areia seca: `'sand'` (`step_sand`)
 * - madeira / deck / píer: `'wood'` (`step_wood`)
 */
export function classifyCoastalStepMaterial(mat, { inWater = false, nearWater = false, nearSeaLevel = false, rain = 0 } = {}) {
  if (inWater) return 'water';
  if (mat === 'sand' && (nearWater || (nearSeaLevel && rain > 0.25))) return 'wetsand';
  return mat || 'stone';
}

