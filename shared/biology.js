// LAVRA — motor biológico e instintivo individual (código puro, sem dependências externas).
// Todas as taxas são em segundos reais (dt), nunca assumindo dia de 20 minutos.

import { SEA } from './constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const BASE_GILL = {
  diurno: true,
  respiraAr: false,
  fogeLonge: false,
  raioLar: 4.5,
  distSegura: 1.5,
  fomeTaxa: 0.0045,
  energiaGasto: 0.0055,
  energiaRec: 0.028,
  oxigenioPerdaAr: 0.14,
  oxigenioRecAgua: 0.35,
  oxigenioPerdaSub: 0,
  oxigenioRecSup: 0.45,
  asfixiaDano: 0.12,
  curaTaxa: 0.008,
  medoDecaiBase: 0.055,
  medoDecaiLar: 0.11,
  curiosidadeDecai: 0.06,
  velocidadePatrulha: 0.9,
  oscilaVertical: 0.35,
};

export const BIO_SPECIES = {
  palhaco: { ...BASE_GILL, raioLar: 4.5, distSegura: 1.5 },
  salmao: { ...BASE_GILL, fogeLonge: true, raioLar: 14, distSegura: 2.5, velocidadePatrulha: 1.05, fomeTaxa: 0.004 },
  atum: { ...BASE_GILL, fogeLonge: true, raioLar: 20, distSegura: 3.2, velocidadePatrulha: 1.25, fomeTaxa: 0.0038 },
  agulhao: { ...BASE_GILL, fogeLonge: true, raioLar: 24, distSegura: 3.8, velocidadePatrulha: 1.35, fomeTaxa: 0.0035 },
  tubarao: {
    ...BASE_GILL, diurno: false, fogeLonge: true, raioLar: 32, distSegura: 4.5,
    fomeTaxa: 0.0018, energiaGasto: 0.0025, velocidadePatrulha: 0.85, medoDecaiBase: 0.12, oscilaVertical: 1.2,
  },
  arraia: {
    ...BASE_GILL, fogeLonge: true, raioLar: 16, distSegura: 2.6,
    fomeTaxa: 0.003, energiaGasto: 0.003, velocidadePatrulha: 0.8, oscilaVertical: 0.25,
  },
  tartaruga: {
    ...BASE_GILL, respiraAr: true, fogeLonge: true, raioLar: 18, distSegura: 2.2,
    oxigenioPerdaSub: 0.006, oxigenioRecSup: 0.35, oxigenioPerdaAr: 0,
    fomeTaxa: 0.0025, energiaGasto: 0.003, velocidadePatrulha: 0.78, oscilaVertical: 0.6,
  },
  golfinho: {
    ...BASE_GILL, respiraAr: true, fogeLonge: true, raioLar: 28, distSegura: 2.4,
    oxigenioPerdaSub: 0.009, oxigenioRecSup: 0.45, oxigenioPerdaAr: 0,
    fomeTaxa: 0.0032, energiaGasto: 0.004, velocidadePatrulha: 1.15, oscilaVertical: 1.4,
  },
  orca: {
    ...BASE_GILL, respiraAr: true, fogeLonge: true, raioLar: 36, distSegura: 5.0,
    oxigenioPerdaSub: 0.005, oxigenioRecSup: 0.35, oxigenioPerdaAr: 0,
    fomeTaxa: 0.0016, energiaGasto: 0.0022, velocidadePatrulha: 0.9, medoDecaiBase: 0.15, oscilaVertical: 1.8,
  },
  baleia: {
    ...BASE_GILL, respiraAr: true, fogeLonge: true, raioLar: 48, distSegura: 7.5,
    oxigenioPerdaSub: 0.0032, oxigenioRecSup: 0.28, oxigenioPerdaAr: 0,
    fomeTaxa: 0.001, energiaGasto: 0.0014, velocidadePatrulha: 0.72, medoDecaiBase: 0.18, oscilaVertical: 2.4,
  },
  polvo: {
    ...BASE_GILL, diurno: false, raioLar: 6.5, distSegura: 2.0,
    fomeTaxa: 0.0035, energiaGasto: 0.004, velocidadePatrulha: 0.75, oscilaVertical: 0.3,
  },
  aguaviva: {
    ...BASE_GILL, fogeLonge: false, raioLar: 9, distSegura: 1.2,
    fomeTaxa: 0.0015, energiaGasto: 0.0015, velocidadePatrulha: 0.45, oscilaVertical: 1.1,
  },
};

export function createBio(species, lar = [0, 0, 0], seed = 0) {
  const s = ((seed >>> 0) % 1000) / 1000;
  return {
    species,
    seed: seed | 0,
    fome: clamp01(0.18 + s * 0.22),
    energia: clamp01(0.75 + s * 0.2),
    oxigenio: clamp01(0.8 + s * 0.2),
    medo: 0,
    curiosidade: 0,
    saude: 1,
    ferido: false,
    morto: false,
    lar: [lar[0], lar[1], lar[2]],
    ameaca: null,   // { pos: [x,y,z], t }
    curiosoAlvo: null, // { pos: [x,y,z], t }
    modo: 'nadar',
    alvo: [lar[0], lar[1], lar[2]],
  };
}

export function stimulateBio(bio, event) {
  if (!bio || bio.morto || !event) return;
  const intensity = clamp01(event.intensity ?? 0.5);
  const now = Number.isFinite(event.now) ? event.now : 0;
  if (event.kind === 'ameaca') {
    bio.medo = clamp01(Math.max(bio.medo, intensity * 0.65) + intensity * 0.35);
    bio.curiosidade = 0;
    bio.curiosoAlvo = null;
    if (event.pos) bio.ameaca = { pos: [event.pos[0], event.pos[1], event.pos[2]], t: now };
  } else if (event.kind === 'curioso') {
    if (bio.medo < 0.25 && !bio.ferido) {
      bio.curiosidade = clamp01(bio.curiosidade + intensity * 0.7);
      if (event.pos) bio.curiosoAlvo = { pos: [event.pos[0], event.pos[1], event.pos[2]], t: now };
    }
  } else if (event.kind === 'alimento') {
    bio.fome = clamp01(bio.fome - intensity);
  } else if (event.kind === 'descanso') {
    bio.energia = clamp01(bio.energia + intensity);
  } else if (event.kind === 'dano') {
    bio.saude = clamp01(bio.saude - intensity);
    bio.medo = clamp01(bio.medo + 0.5);
    if (bio.saude <= 0) bio.morto = true;
  }
}

export function stepBio(bio, ctx = {}, dt = 0.5) {
  if (!bio || bio.morto || !(dt > 0)) return bio;
  const spec = BIO_SPECIES[bio.species] || BIO_SPECIES.palhaco;
  const wet = ctx.wet !== false;
  const pertoLar = !!ctx.pertoLar;
  const seaLevel = Number.isFinite(ctx.seaLevel) ? ctx.seaLevel : SEA;
  const nearSurface = Number.isFinite(ctx.y) ? ctx.y >= seaLevel - 1.1 : false;
  const descansando = bio.modo === 'descansar' || bio.modo === 'abrigar';

  // Oxigênio e asfixia
  if (spec.respiraAr) {
    if (!wet || nearSurface) {
      bio.oxigenio = clamp01(bio.oxigenio + spec.oxigenioRecSup * dt);
    } else {
      bio.oxigenio = clamp01(bio.oxigenio - spec.oxigenioPerdaSub * dt);
    }
  } else if (wet) {
    bio.oxigenio = clamp01(bio.oxigenio + spec.oxigenioRecAgua * dt);
  } else {
    bio.oxigenio = clamp01(bio.oxigenio - spec.oxigenioPerdaAr * dt);
    if (bio.oxigenio <= 0) {
      bio.saude = clamp01(bio.saude - spec.asfixiaDano * dt);
    }
  }

  // Fome e energia
  const gastoMult = bio.modo === 'abrigar' || bio.modo === 'fugir' ? 1.8 : descansando ? 0.3 : 1;
  bio.fome = clamp01(bio.fome + spec.fomeTaxa * gastoMult * dt);
  if (descansando && (wet || spec.respiraAr)) {
    bio.energia = clamp01(bio.energia + spec.energiaRec * dt);
  } else {
    bio.energia = clamp01(bio.energia - spec.energiaGasto * gastoMult * dt);
  }

  // Cura natural quando alimentado, com oxigênio e em segurança
  if ((wet || spec.respiraAr) && bio.oxigenio > 0.5 && bio.fome < 0.7 && bio.medo < 0.25 && bio.saude < 1) {
    bio.saude = clamp01(bio.saude + spec.curaTaxa * dt);
  }

  // Decaimento de medo e curiosidade
  const medoDecai = pertoLar ? spec.medoDecaiLar : spec.medoDecaiBase;
  bio.medo = clamp01(bio.medo - medoDecai * dt);
  if (bio.medo <= 0.1) bio.ameaca = null;
  bio.curiosidade = clamp01(bio.curiosidade - spec.curiosidadeDecai * dt);
  if (bio.curiosidade <= 0.08) bio.curiosoAlvo = null;

  bio.ferido = bio.saude < 0.4;
  if (bio.saude <= 0) {
    bio.saude = 0;
    bio.morto = true;
  }
  return bio;
}

export function decideBioGoal(bio, pos = [0, 0, 0], ctx = {}) {
  const spec = BIO_SPECIES[bio.species] || BIO_SPECIES.palhaco;
  const dia = ctx.dia !== false;
  const now = Number.isFinite(ctx.now) ? ctx.now : 0;
  const seaLevel = Number.isFinite(ctx.seaLevel) ? ctx.seaLevel : SEA;
  const lar = bio.lar;
  const injuryScale = bio.ferido ? 0.55 : 1;

  // 1. Sobrevivência imediata: respiração para mamíferos/tartaruga ou medo/ferimento
  if (spec.respiraAr && (bio.oxigenio < 0.35 || (bio.modo === 'respirar' && bio.oxigenio < 0.9))) {
    const ang = ((bio.seed * 0.9 + now * 0.25) % (Math.PI * 2));
    bio.modo = 'respirar';
    bio.alvo = [pos[0] + Math.cos(ang) * 4, seaLevel - 0.35, pos[2] + Math.sin(ang) * 4];
    return { modo: 'respirar', target: bio.alvo, speedFactor: 1.25 * injuryScale, radius: 1.0 };
  }

  if (bio.medo >= 0.45 || bio.ferido) {
    if (spec.fogeLonge && bio.ameaca && !bio.ferido) {
      const dx = pos[0] - bio.ameaca.pos[0], dz = pos[2] - bio.ameaca.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      bio.modo = 'fugir';
      bio.alvo = [pos[0] + (dx / len) * 14, lar[1], pos[2] + (dz / len) * 14];
      return { modo: 'fugir', target: bio.alvo, speedFactor: 1.75, radius: 1.0 };
    }
    bio.modo = 'abrigar';
    bio.alvo = [lar[0], lar[1], lar[2]];
    const speedFactor = bio.ferido ? 0.55 : 1.7;
    return { modo: 'abrigar', target: bio.alvo, speedFactor, radius: 0.6 };
  }

  // 2. Descanso no ritmo circadiano ou energia baixa
  if ((!dia && spec.diurno) || bio.energia < 0.28) {
    bio.modo = 'descansar';
    bio.alvo = [lar[0], lar[1], lar[2]];
    return { modo: 'descansar', target: bio.alvo, speedFactor: 0.65 * injuryScale, radius: 0.7 };
  }

  // 3. Fome -> forragear/caçar ao redor do território
  if (bio.fome >= 0.55) {
    const ang = ((bio.seed * 1.37 + now * (0.28 / Math.max(0.8, spec.raioLar * 0.22))) % (Math.PI * 2));
    const r = Math.min(spec.raioLar * 0.75, 16);
    const tx = lar[0] + Math.cos(ang) * r;
    const ty = Math.min(seaLevel - 0.8, lar[1] + 0.4 + Math.sin(now * 0.5 + bio.seed) * spec.oscilaVertical);
    const tz = lar[2] + Math.sin(ang) * r;
    bio.modo = 'forragear';
    bio.alvo = [tx, ty, tz];
    return { modo: 'forragear', target: bio.alvo, speedFactor: 1.15 * injuryScale, radius: 0.9 };
  }

  // 4. Curiosidade -> aproximar-se mantendo distância segura
  if (bio.curiosidade >= 0.35 && bio.curiosoAlvo && bio.medo < 0.25) {
    const c = bio.curiosoAlvo.pos;
    const dx = pos[0] - c[0], dz = pos[2] - c[2];
    const dist = Math.hypot(dx, dz) || 1;
    const safe = spec.distSegura;
    const tx = c[0] + (dx / dist) * safe;
    const tz = c[2] + (dz / dist) * safe;
    const ty = Math.min(seaLevel - 0.6, c[1] + 0.2);
    bio.modo = 'curioso';
    bio.alvo = [tx, ty, tz];
    return { modo: 'curioso', target: bio.alvo, speedFactor: 0.85 * injuryScale, radius: 0.5 };
  }

  // 5. Patrulha / nado tranquilo no território
  const ang = ((bio.seed * 2.13 + now * (0.18 / Math.max(1, spec.raioLar * 0.16))) % (Math.PI * 2));
  const r = Math.min(spec.raioLar * 0.65, 1.4 + (bio.seed % 7) * (spec.raioLar * 0.1));
  bio.modo = 'nadar';
  bio.alvo = [
    lar[0] + Math.cos(ang) * r,
    Math.min(seaLevel - 0.7, lar[1] + 0.3 + Math.sin(now * 0.35 + bio.seed) * spec.oscilaVertical * 0.6),
    lar[2] + Math.sin(ang) * r,
  ];
  return { modo: 'nadar', target: bio.alvo, speedFactor: spec.velocidadePatrulha * injuryScale, radius: 0.8 };
}
