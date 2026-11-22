// LAVRA — Espaços Funcionais para Atividades (começando pelo Campo de Futebol).
// Puro (sem DOM, sem Three): usado pelo servidor (autoridade de regras/XP/skills/GM) e pelo cliente (HUD/previsão/estádio).
//
// Regra central: dentro de um espaço funcional ativo, jogadores comuns (e GMs com Modo GM desligado) têm construção,
// quebra de blocos, ferramentas, combate e barra de blocos anulados, recebendo a barra de skills própria da atividade.
// GMs com Modo GM LIGADO ficam livres para construir, quebrar e personalizar o espaço.
import { BOLA } from './bola.js';

// ---- Espaços funcionais (genérico para futuras atividades) ---------------------------------------------------------
export function zonaCampo(campo) {
  if (!campo) return null;
  const ex = campo.eixo === 'x';
  const minX = ex ? campo.linhaA - 2.5 : campo.ladoMin - 1.5;
  const maxX = ex ? campo.linhaB + 2.5 : campo.ladoMax + 1.5;
  const minZ = ex ? campo.ladoMin - 1.5 : campo.linhaA - 2.5;
  const maxZ = ex ? campo.ladoMax + 1.5 : campo.linhaB + 2.5;
  const minY = (campo.alto?.[0] ?? 0) - 1.2;
  const maxY = (campo.alto?.[1] ?? 4) + 14;
  return {
    id: 'futebol',
    tipo: 'futebol',
    nome: 'Campo de Futebol',
    dim: 0,
    minX, maxX, minY, maxY, minZ, maxZ,
  };
}

export function noEspaco(zona, p) {
  if (!zona || !p) return false;
  return p[0] >= zona.minX && p[0] <= zona.maxX
    && p[1] >= zona.minY && p[1] <= zona.maxY
    && p[2] >= zona.minZ && p[2] <= zona.maxZ;
}

export function esferaNoEspaco(zona, p, raio = 0) {
  if (!zona || !p) return false;
  const r = Math.max(0, Number(raio) || 0);
  if (r === 0) return noEspaco(zona, p);
  const dx = p[0] < zona.minX ? zona.minX - p[0] : p[0] > zona.maxX ? p[0] - zona.maxX : 0;
  const dy = p[1] < zona.minY ? zona.minY - p[1] : p[1] > zona.maxY ? p[1] - zona.maxY : 0;
  const dz = p[2] < zona.minZ ? zona.minZ - p[2] : p[2] > zona.maxZ ? p[2] - zona.maxZ : 0;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

export function caixaNoEspaco(zona, min, max) {
  if (!zona || !min || !max) return false;
  return max[0] >= zona.minX && min[0] <= zona.maxX
    && max[1] >= zona.minY && min[1] <= zona.maxY
    && max[2] >= zona.minZ && min[2] <= zona.maxZ;
}

export function raioNoEspaco(zona, origem, dir, maxDist = 48) {
  if (!zona || !origem || !dir) return false;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!Number.isFinite(len) || len < 1e-6) return noEspaco(zona, origem);
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const mins = [zona.minX, zona.minY, zona.minZ];
  const maxs = [zona.maxX, zona.maxY, zona.maxZ];
  let tmin = 0, tmax = Math.max(0, Number(maxDist) || 0);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (origem[i] < mins[i] || origem[i] > maxs[i]) return false;
    } else {
      let t1 = (mins[i] - origem[i]) / d[i];
      let t2 = (maxs[i] - origem[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return tmax >= 0;
}

export function espacoAtivoEm(zonas, pos, dim = 0, gmAtivo = false) {
  if (gmAtivo || !pos) return null;
  for (const z of zonas || []) {
    if (z && (z.dim ?? 0) === (dim || 0) && noEspaco(z, pos)) return z;
  }
  return null;
}

// Autoridade de edição: bloqueia se GM não estiver ligado E o jogador OU o alvo (ponto, esfera ou caixa) tocar um espaço funcional.
export function permiteEdicaoNoEspaco({ zonas, pos, alvo, alvoRaio = 0, alvoMin = null, alvoMax = null, dim = 0, gmAtivo = false } = {}) {
  if (gmAtivo) return true;
  for (const z of zonas || []) {
    if (!z || (z.dim ?? 0) !== (dim || 0)) continue;
    if (pos && noEspaco(z, pos)) return false;
    if (alvo && esferaNoEspaco(z, alvo, alvoRaio)) return false;
    if (alvoMin && alvoMax && caixaNoEspaco(z, alvoMin, alvoMax)) return false;
  }
  return true;
}

// ---- Barra de 9 Skills de Futebol ----------------------------------------------------------------------------------
export const SKILLS_FUTEBOL = Object.freeze([
  { id: 'passe',    tecla: 1, nome: 'Passe curto',       curto: 'Passe',    cor: '#4ade80', alcance: 2.9, cd: 0.30, carga: true,  desc: 'Passe rasteiro rápido e preciso' },
  { id: 'toque',    tecla: 2, nome: 'Toque de bola',     curto: 'Toque',    cor: '#38bdf8', alcance: 2.7, cd: 0.22, carga: false, desc: 'Domínio suave colado no pé' },
  { id: 'drible',   tecla: 3, nome: 'Drible',            curto: 'Drible',   cor: '#a78bfa', alcance: 2.9, cd: 0.55, carga: false, desc: 'Corte rápido com adiantada na bola' },
  { id: 'alto',     tecla: 4, nome: 'Chute alto',        curto: 'Alto',     cor: '#60a5fa', alcance: 2.9, cd: 0.45, carga: true,  desc: 'Cruzamento / lançamento alto com backspin' },
  { id: 'falta',    tecla: 5, nome: 'Cobrança de falta', curto: 'Falta',    cor: '#c084fc', alcance: 3.2, cd: 0.70, carga: true,  especial: 'falta',    desc: 'Curva fechada por cima da barreira (topspin + efeito)' },
  { id: 'cabeca',   tecla: 6, nome: 'Cabecear',          curto: 'Cabeça',   cor: '#fbbf24', alcance: 3.4, cd: 0.45, carga: false, aerea: true,        desc: 'Cabeceio potente em bolas aéreas' },
  { id: 'forte',    tecla: 7, nome: 'Chute forte',       curto: 'Forte',    cor: '#f97316', alcance: 3.0, cd: 0.65, carga: true,  especial: 'forte',    desc: 'Bomba de potência máxima com impacto' },
  { id: 'colocado', tecla: 8, nome: 'Chute colocado',    curto: 'Colocado', cor: '#22d3ee', alcance: 3.0, cd: 0.55, carga: true,  especial: 'colocado', desc: 'Chute curvado com efeito Magnus no ângulo' },
  { id: 'especial', tecla: 9, nome: 'Chute especial',    curto: 'Especial', cor: '#facc15', alcance: 3.5, cd: 1.05, carga: true,  especial: 'auto',     desc: 'Bicicleta/Voleio (bola alta) ou Carrinho (bola baixa)' },
]);

export const SKILL_POR_ID = Object.freeze(Object.fromEntries(SKILLS_FUTEBOL.map((s) => [s.id, s])));

// Calcula vetor de velocidade, rotação (spin para efeito Magnus), subtipo especial e impulso do jogador.
// dir: vetor unitário do olhar [dx, dy, dz]; carga: 0..1; curva: +1 (direita) | -1 (esquerda); bolaRelY: yBola - yPesJogador.
export function calcularSkillChute(skillId, { dir = [0, 0, -1], carga = 0.5, curva = 1, bolaRelY = 0.3 } = {}) {
  const sk = SKILL_POR_ID[skillId] || SKILLS_FUTEBOL[0];
  const c = Math.max(0, Math.min(1, Number.isFinite(Number(carga)) ? Number(carga) : 0));
  const lado = Number(curva) < 0 ? -1 : 1;
  const dx0 = Number.isFinite(Number(dir?.[0])) ? Number(dir[0]) : 0;
  const dy0 = Number.isFinite(Number(dir?.[1])) ? Number(dir[1]) : 0;
  const dz0 = Number.isFinite(Number(dir?.[2])) ? Number(dir[2]) : -1;
  const dh = Math.hypot(dx0, dz0);
  const fx = dh > 1e-5 ? dx0 / dh : 0;
  const fz = dh > 1e-5 ? dz0 / dh : -1;            // direção horizontal à frente
  const rx = -fz, rz = fx;                         // direita do jogador (eixo para topspin/backspin)
  const pitch = Math.max(-0.15, Math.min(0.65, dy0));
  const relY = Number.isFinite(Number(bolaRelY)) ? Number(bolaRelY) : 0.3;

  let speed = 10, vy = 1.2, sideSpin = 0, topSpin = 0;
  let especial = sk.especial || null, subtipo = sk.id, impulsoJogador = null, fxCor = sk.cor;

  switch (sk.id) {
    case 'passe':
      speed = 9.5 + 6.5 * c;
      vy = 0.55 + 0.65 * c;
      break;
    case 'toque':
      speed = 5.4 + 2.2 * c;
      vy = 0.45;
      break;
    case 'drible': {
      // corte lateral + adiantada
      const cx = fx * 0.82 + rx * lado * 0.57, cz = fz * 0.82 + rz * lado * 0.57;
      speed = 9.2 + 2.5 * c;
      vy = 0.55;
      sideSpin = 10 * lado;
      impulsoJogador = [cx * 6.4, 0.25, cz * 6.4];
      const dMag = Math.hypot(cx * speed, vy, cz * speed);
      const dClamp = dMag > BOLA.max ? BOLA.max / dMag : 1;
      return {
        v: [cx * speed * dClamp, vy * dClamp, cz * speed * dClamp],
        w: [
          Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, rx * 2)),
          Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, sideSpin)),
          Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, rz * 2)),
        ],
        especial: 'drible', subtipo: 'drible', cor: fxCor, impulsoJogador,
      };
    }
    case 'alto':
      speed = 11.5 + 8.5 * c;
      vy = 5.8 + 4.4 * c + Math.max(0, pitch * 4);
      topSpin = -13 - 6 * c;      // backspin faz a bola planar e cair macio
      break;
    case 'falta':
      speed = 15 + 10.5 * c;
      vy = 4.6 + 3.4 * c + Math.max(0, pitch * 3);
      sideSpin = (18 + 11 * c) * lado;
      topSpin = 10 + 7 * c;       // sobe sobre a barreira e mergulha no gol
      especial = 'falta'; subtipo = 'falta';
      break;
    case 'cabeca':
      speed = 12.5 + 7.5 * c;
      vy = relY > 1.1 ? (0.4 + pitch * 3.5) : (2.6 + pitch * 4);
      topSpin = 7;
      especial = 'cabeca'; subtipo = 'cabeca';
      break;
    case 'forte':
      speed = 19 + 11.5 * c;
      vy = 1.8 + 2.6 * c + Math.max(-0.8, pitch * 7.5);
      topSpin = 5 + 4 * c;
      especial = 'forte'; subtipo = 'forte';
      break;
    case 'colocado':
      speed = 14.5 + 8.5 * c;
      vy = 2.0 + 2.5 * c + Math.max(0, pitch * 5);
      sideSpin = (20 + 12 * c) * lado;  // efeito Magnus pronunciado
      topSpin = 5 + 3 * c;
      especial = 'colocado'; subtipo = 'colocado';
      break;
    case 'especial':
      if (relY >= 1.15) {
        // Bicicleta acrobática!
        speed = 19 + 10 * c;
        vy = 3.2 + 2.8 * c;
        sideSpin = 16 * lado;
        topSpin = 16;
        especial = 'bicicleta'; subtipo = 'bicicleta'; fxCor = '#facc15';
        impulsoJogador = [-fx * 2.2, 3.8, -fz * 2.2];
      } else if (relY >= 0.48) {
        // Voleio no ar!
        speed = 20 + 10 * c;
        vy = 1.6 + 2.0 * c + pitch * 4;
        sideSpin = 12 * lado;
        topSpin = 12;
        especial = 'voleio'; subtipo = 'voleio'; fxCor = '#fb923c';
        impulsoJogador = [fx * 2.8, 2.2, fz * 2.8];
      } else {
        // Carrinho rasante com desarme!
        speed = 13 + 7 * c;
        vy = 0.8 + 0.8 * c;
        sideSpin = 6 * lado;
        especial = 'carrinho'; subtipo = 'carrinho'; fxCor = '#38bdf8';
        impulsoJogador = [fx * 9.2, 0.3, fz * 9.2];
      }
      break;
  }

  // topSpin > 0 em volta do eixo direito (-fz, 0, fx) faz a bola girar para frente e mergulhar (w × v tem componente -Y)
  // Nota: (rx, 0, rz) × (fx, 0, fz) = (0, rz*fx - rx*fz, 0) = (0, fx² + fz², 0) = +Y.
  // Logo para mergulhar (-Y) com topspin positivo, w_topo = -topSpin * (rx, 0, rz)!
  const wx = -topSpin * rx, wz = -topSpin * rz;
  const mag = Math.hypot(fx * speed, vy, fz * speed);
  const clamp = mag > BOLA.max ? BOLA.max / mag : 1;
  return {
    v: [fx * speed * clamp, vy * clamp, fz * speed * clamp],
    w: [
      Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, wx)),
      Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, sideSpin)),
      Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, wz)),
    ],
    especial, subtipo, cor: fxCor, impulsoJogador,
  };
}

// ---- Personalização do GM (camisas, times, bandeiras, torcida, bola, juiz, goleiros, NPCs) -------------------------
export const PADROES_CAMISA = Object.freeze(['liso', 'listras', 'faixa', 'bicolor']);
export const PADROES_BANDEIRA = Object.freeze(['faixas', 'cruz', 'chevron', 'estrela']);
export const ESTILOS_BOLA = Object.freeze(['classica', 'ouro', 'neon', 'retro']);

export function customFutebolPadrao() {
  return {
    times: [
      { nome: 'Azul', cor: '#2f6fd6', cor2: '#ffffff', padrao: 'liso', bandeira: 'faixas', torcida: 1 },
      { nome: 'Vermelho', cor: '#d63a2f', cor2: '#ffd23a', padrao: 'listras', bandeira: 'cruz', torcida: 1 },
    ],
    bola: { estilo: 'classica', quique: 0.55, escala: 1 },
    juiz: { cor: '#18181b', rigor: 5 },
    goleiro: { corA: '#ffd23a', corB: '#3ad66b', reflexo: 6, velocidade: 6 },
    npcs: { velocidade: 6, chute: 6, passe: 6, marcacao: 6 },
    estadio: { refletores: true, linhasHd: true, traves3d: true, arquibancadas3d: true },
  };
}

const corValida = (s, fb) => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim()) ? s.trim().toLowerCase() : fb);
const faixa = (n, min, max, fb) => (Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Number(n))) : fb);

export function limparCustomFutebol(entrada, base = customFutebolPadrao()) {
  const out = structuredClone(base || customFutebolPadrao());
  if (!entrada || typeof entrada !== 'object') return out;
  if (Array.isArray(entrada.times)) {
    for (let i = 0; i < 2; i++) {
      const t = entrada.times[i];
      if (!t || typeof t !== 'object') continue;
      if (typeof t.nome === 'string' && t.nome.trim()) out.times[i].nome = t.nome.trim().slice(0, 20);
      out.times[i].cor = corValida(t.cor, out.times[i].cor);
      out.times[i].cor2 = corValida(t.cor2, out.times[i].cor2);
      if (PADROES_CAMISA.includes(t.padrao)) out.times[i].padrao = t.padrao;
      if (PADROES_BANDEIRA.includes(t.bandeira)) out.times[i].bandeira = t.bandeira;
      out.times[i].torcida = faixa(t.torcida, 0, 1.5, out.times[i].torcida);
    }
  }
  if (entrada.bola && typeof entrada.bola === 'object') {
    if (ESTILOS_BOLA.includes(entrada.bola.estilo)) out.bola.estilo = entrada.bola.estilo;
    out.bola.quique = faixa(entrada.bola.quique, 0.3, 0.85, out.bola.quique);
    out.bola.escala = faixa(entrada.bola.escala, 0.75, 1.5, out.bola.escala);
  }
  if (entrada.juiz && typeof entrada.juiz === 'object') {
    out.juiz.cor = corValida(entrada.juiz.cor, out.juiz.cor);
    out.juiz.rigor = Math.round(faixa(entrada.juiz.rigor, 1, 10, out.juiz.rigor));
  }
  if (entrada.goleiro && typeof entrada.goleiro === 'object') {
    out.goleiro.corA = corValida(entrada.goleiro.corA, out.goleiro.corA);
    out.goleiro.corB = corValida(entrada.goleiro.corB, out.goleiro.corB);
    out.goleiro.reflexo = Math.round(faixa(entrada.goleiro.reflexo, 1, 10, out.goleiro.reflexo));
    out.goleiro.velocidade = Math.round(faixa(entrada.goleiro.velocidade, 1, 10, out.goleiro.velocidade));
  }
  if (entrada.npcs && typeof entrada.npcs === 'object') {
    out.npcs.velocidade = Math.round(faixa(entrada.npcs.velocidade, 1, 10, out.npcs.velocidade));
    out.npcs.chute = Math.round(faixa(entrada.npcs.chute, 1, 10, out.npcs.chute));
    out.npcs.passe = Math.round(faixa(entrada.npcs.passe, 1, 10, out.npcs.passe));
    out.npcs.marcacao = Math.round(faixa(entrada.npcs.marcacao, 1, 10, out.npcs.marcacao));
  }
  if (entrada.estadio && typeof entrada.estadio === 'object') {
    for (const k of ['refletores', 'linhasHd', 'traves3d', 'arquibancadas3d']) {
      if (typeof entrada.estadio[k] === 'boolean') out.estadio[k] = entrada.estadio[k];
    }
  }
  return out;
}

// ---- XP de Futebol, Skins Especiais e Chuteiras 3D -----------------------------------------------------------------
export const FUT_XP = Object.freeze({
  GOL: 25,
  GOL_ESPECIAL_BONUS: 10,
  VITORIA: 100,
  EMPATE: 30,
});

export const FUT_CHUTEIRAS = Object.freeze([
  { id: 'classica',  nome: 'Chuteira Clássica',   xp: 0,   cor: '#18181b', detalhe: '#ffffff', travas: '#d4d4d8' },
  { id: 'ouro',      nome: 'Chuteira Dourada',    xp: 100, cor: '#eab308', detalhe: '#fef08a', travas: '#fffbeb' },
  { id: 'relampago', nome: 'Relâmpago Azul',      xp: 250, cor: '#0284c7', detalhe: '#38bdf8', travas: '#e0f2fe' },
  { id: 'fogo',      nome: 'Fogo Lendário',       xp: 500, cor: '#dc2626', detalhe: '#fb923c', travas: '#fef08a' },
]);

export const FUT_SKINS = Object.freeze([
  { id: 'uniforme',    nome: 'Uniforme do Time',   xp: 0,   desc: 'Camisa oficial personalizada do seu time' },
  { id: 'camisa10',    nome: 'Camisa 10 Clássica', xp: 150, desc: 'Faixa de capitão, gola especial e número 10 dourado' },
  { id: 'craque_ouro', nome: 'Craque de Ouro',     xp: 400, desc: 'Uniforme edição campeonato com detalhes dourados' },
  { id: 'lenda',       nome: 'Lenda do Estádio',   xp: 800, desc: 'Armadura esportiva preta e ouro exclusiva de campeão' },
]);

export function nivelFutebol(xp = 0) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 50)) + 1);
}

// Partida oficial válida para XP: em andamento, jogador num time, sem troca de time/exploit,
// e há adversário real ativo (humano ativo no outro time ou robôs ativos).
export function partidaOficialValida({
  estado, timeJogador, humanosPorTime = [0, 0], robos = {},
  trocouTime = false, ativo = true, gmAtivo = false, golsSemRival = false, rivalInativo = false,
} = {}) {
  if (estado !== 'jogo') return false;
  if (timeJogador !== 0 && timeJogador !== 1) return false;
  if (trocouTime || !ativo || gmAtivo || golsSemRival || rivalInativo) return false;
  const rival = 1 - timeJogador;
  const temHumanoRival = (humanosPorTime[rival] || 0) > 0;
  const temRoboRival = (robos?.linha || 0) > 0 || !!robos?.goleiro;
  return temHumanoRival || temRoboRival;
}

export function perfilFutebolPadrao() {
  return { xp: 0, gols: 0, vitorias: 0, partidas: 0, skin: 'uniforme', chuteira: 'classica' };
}
