// LAVRA — o relógio do mundo. Código puro: o servidor usa para o mundo de todos; o cliente, para acompanhar o
// servidor e para jogar offline.
//
// A hora é contada em segundos de jogo e um dia tem DAY_LENGTH deles (86 400: a fração do dia vezes 24 dá a hora).
// O ritmo diz quantos segundos de jogo passam por segundo de verdade: 1 = o dia dura 24 h, como no mundo real;
// 72 = o dia dura 20 min; 0 = tempo parado. Quem joga escolhe. No ritmo real o relógio ainda pode seguir o relógio
// de verdade (real = true): aí a hora do jogo é a hora da parede de quem hospeda o mundo.

import { DAY_LENGTH } from './constants.js';

export const TIME_RATES = [0, 1, 2, 4, 8, 24, 72, 144, 288, 720, 1440];   // degraus oferecidos na interface
export const RATE_MAX = 3600;     // um dia em 24 s; além disso o céu vira estroboscópio

// Segundos "no relógio da parede": dias inteiros desde 1970 mais a hora local. A fração do dia sai certa.
export function wallSeconds(ms = Date.now(), tz = new Date(ms).getTimezoneOffset()) {
  return ms / 1000 - tz * 60;
}
// Fuso do relógio de um mundo, em minutos a oeste de Greenwich. Sem lugar na Terra, o do sistema. Com lugar perto do
// fuso do sistema (até 1h30 de diferença), também o do sistema: é a hora legal de quem hospeda, igual à do relógio da
// parede. Com lugar longe, a hora solar média de lá, arredondada à meia hora: meio-dia no relógio é meio-dia no céu.
export function tzFor(place, systemTz = new Date().getTimezoneOffset()) {
  if (!place || !Number.isFinite(place.lon)) return systemTz;
  const solar = -place.lon * 4;
  return Math.abs(solar - systemTz) <= 90 ? systemTz : Math.round(solar / 30) * 30;
}

// hora do dia (0..24) de um instante do mundo
export function hourOf(time) {
  return ((time / DAY_LENGTH) % 1 + 1) % 1 * 24;
}
// é dia? (o sol nasce e se põe perto de 5h30 e 18h30)
export function isDay(time) {
  const h = hourOf(time);
  return h > 5.5 && h < 18.5;
}

// Quanto dura um dia naquele ritmo, por extenso: "24 h", "20 min", "parado".
export function dayLasts(rate) {
  if (!(rate > 0)) return 'parado';
  const min = 1440 / rate;
  const n = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  if (min >= 60) return n(min / 60) + ' h';
  if (min >= 1) return n(min) + ' min';
  return Math.round(min * 60) + ' s';
}

export function cleanRate(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(RATE_MAX, v)) : 1;
}

export function createClock(now = () => Date.now()) {
  const c = {
    rate: 1, real: true, base: 0, t0: now(),
    tz: undefined,               // fuso do mundo (minutos a oeste de Greenwich); indefinido = o do sistema

    time() { return c.real ? wallSeconds(now(), c.tz) : c.base + (now() - c.t0) / 1000 * c.rate; },
    hour() { return hourOf(c.time()); },

    // Estado guardado (arquivo do mundo ou do aparelho). Sem ritmo gravado, ou em ritmo real sem desvio: relógio de verdade.
    load(time, rate, real) {
      if (real !== false && (rate === undefined || rate === null || rate === 1)) return c.syncReal();
      c.follow(Number(time) || 0, cleanRate(rate));
    },
    // Acompanha um relógio de fora (o do servidor): parte dessa hora, nesse ritmo.
    follow(time, rate) { c.base = time; c.t0 = now(); c.rate = rate; c.real = false; },
    // Volta a seguir o relógio de verdade.
    syncReal() { c.rate = 1; c.real = true; c.base = 0; c.t0 = now(); },
    // Muda o ritmo sem dar salto na hora. Escolher o ritmo real é voltar ao relógio de verdade.
    setRate(rate) {
      rate = cleanRate(rate);
      if (rate === 1) return c.syncReal();
      c.follow(c.time(), rate);
    },
    // Adianta até a próxima vez em que for aquela hora (0..24); o ritmo fica como está.
    setHour(h) {
      const t = c.time(), cur = ((t % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
      c.follow(t + ((h / 24 * DAY_LENGTH - cur) % DAY_LENGTH + DAY_LENGTH) % DAY_LENGTH, c.rate);
    },
    state() { return { time: c.time(), rate: c.rate, real: c.real }; },
  };
  return c;
}
