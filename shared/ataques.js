// LAVRA — os ataques dos bichos perigosos (pedido do Kadmus, 19/11/2026: "os mais selvagens e perigosos, como os
// grandes felinos, lobos, tubarões… devem ter planos-sequência desenvolvidos em motion para atacar sempre que se
// sentirem acuados ou com seu espaço invadido. Calcule e estabeleça o dano de cada ataque e os fatais também").
// Puro: o servidor executa (server/fauna.js), o aparelho anima (render/fauna-bichos.js) e aplica o golpe em quem joga
// (game/sobrevivencia.js). O laboratório /lab/ataques.html toca cada sequência e mostra a tabela.
//
// ZONAS (as distâncias de Hediger, em metros até a pessoa):
//   alerta   o bicho percebe e encara
//   aviso    a pessoa está no espaço dele: ele AVISA (ruge, rosna, se ergue, bate no peito, cava o chão). É a hora de
//            recuar devagar, de frente, sem correr. Passada a paciência com a pessoa ainda ali, ataca.
//   critica  invadiu de vez: ataca sem mais aviso
// GATILHOS  invasao · acuado (quer fugir e não tem por onde) · cria (fêmea com filhote) · comida (comendo a caça)
//           · ferido (apanhou) · corrida (correr perto de predador chama a perseguição) · fome (predador faminto
//           que come gente: raro) · sangue (tubarão sente quem sangra na água)
// SEQUÊNCIA (o "plano-sequência"): fases em ordem. Cada fase diz o clipe do modelo, quanto dura ou até onde vai, como
//           o corpo se move e, se tiver, o golpe e o instante dele dentro da fase.
//   mov: parado (encara) · aproxima (vai até `ate` metros, no passo/trote/corrida) · ronda (gira em volta, a `raio`)
//        · salto (bote: voa até o alvo) · segura (cola no alvo) · recua (afasta até `ate`)
//   golpe: nome em `golpes`; em: fração da fase em que acerta; alcance: até onde pega (m, da frente do bicho)
//
// DANO (a pessoa tem 20 de vida). Sai da física do bicho, calibrado para essa escala:
//   mordida   5 × (força da mordida em kN)^0,4 × corte     corte: 1 dente de carnívoro · 1,15 serrilhado/presa · 0,7–0,9 dente chato
//   impacto   4 × (energia em kJ)^0,45                     energia = ½ × massa que bate × velocidade² (bote, patada,
//                                                          coice, chifrada, investida)
//   peso      6 × log10(massa / 20)                        pisoteio
//   veneno    pontos ao longo do tempo
// As forças de mordida são ordens de grandeza de medições e estimativas publicadas (lobo ~0,6 kN e leão ~1,8 kN nos
// caninos; crocodilo ~16 kN; tubarão-branco ~9 kN na frente da boca; hipopótamo ~8 kN). Massas e velocidades: da ficha.
// EFEITOS   derruba (s no chão, sem andar) · prende (s preso na boca/garras: bater no bicho solta) · sangra [n, cada s]
//           (1 ponto por vez) · veneno [n, cada s] · empurra (m/s para longe)
// FATAL     golpe que mata na hora quando a condição vale: 'derrubado' | 'preso' | 'sangrando' (+ vida ≤ limite, se houver)
export const danoMordida = (kN, corte = 1) => Math.max(1, Math.round(5 * Math.pow(kN, 0.4) * corte));
export const danoImpacto = (massaKg, velMs) => Math.max(1, Math.round(4 * Math.pow((0.5 * massaKg * velMs * velMs) / 1000, 0.45)));
export const danoPeso = (massaKg) => Math.max(1, Math.round(6 * Math.log10(massaKg / 20)));
export const VIDA_PESSOA = 20;

const mord = (nome, kN, corte, extra = {}) => ({ nome, tipo: 'mordida', kN, corte, dano: danoMordida(kN, corte), ...extra });
const imp = (nome, massa, vel, extra = {}) => ({ nome, tipo: 'impacto', massa, vel, dano: danoImpacto(massa, vel), ...extra });
const peso = (nome, massa, extra = {}) => ({ nome, tipo: 'peso', massa, dano: danoPeso(massa), ...extra });
const ven = (nome, dano, veneno, extra = {}) => ({ nome, tipo: 'veneno', dano, veneno, ...extra });
const F = (fase, clipe, o = {}) => ({ fase, clipe, mov: 'parado', ...o });

// grandes felinos: aviso curto, espreita, investida, bote que derruba, mordidas e a da garganta
const felino = (ombro, macho) => ({
  zonas: { alerta: 35, aviso: 16, critica: 7 }, paciencia: 5, gatilhos: ['invasao', 'cria', 'comida', 'ferido', 'corrida', 'fome'], grupo: 2,
  aviso: [F('encarar', 'Idle', { dur: 1.4 }), F('rugir', 'Roar', { dur: 2.6, voz: 'rugido' })],
  ataque: [
    F('espreitar', 'WalkForward', { mov: 'aproxima', vel: 'passo', ate: 9, max: 3.5 }),
    F('investida', 'GallopForward', { mov: 'aproxima', vel: 'corrida', ate: 4.4, max: 6 }),
    F('bote', 'JumpStart', { mov: 'salto', dur: 0.6, altura: 1.1, golpe: 'bote', em: 0.88, alcance: 2.3 }),
    F('cair em cima', 'Landing', { mov: 'segura', dur: 0.45 }),
    F('morder', 'Attack1', { mov: 'segura', dur: 1.1, golpe: 'mordida', em: 0.5, alcance: 2.5, repete: 2 }),
    F('garganta', 'Attack1', { mov: 'segura', dur: 1.3, golpe: 'garganta', em: 0.55, alcance: 2.5 }),
    F('recuar', 'WalkForward', { mov: 'recua', vel: 'passo', ate: 9, max: 4 }),
  ],
  golpes: {
    bote: imp('bote', macho ? 95 : 65, 9, { derruba: 2.2, empurra: 3 }),
    mordida: mord('mordida', macho ? 1.8 : 1.5, 1, { prende: 0.9, sangra: [4, 2] }),
    garganta: mord('mordida na garganta', macho ? 1.8 : 1.5, 1, { prende: 1.2, sangra: [5, 2], fatal: { se: 'derrubado', vida: 9 } }),
  },
});
// ursos: erguem-se para avisar, investida, duas patadas em pé, mordida, e esmagam quem ficou no chão
const urso = (massa, kN, predador) => ({
  zonas: { alerta: 40, aviso: 18, critica: 8 }, paciencia: 6, gatilhos: predador ? ['invasao', 'cria', 'comida', 'ferido', 'corrida', 'fome'] : ['invasao', 'cria', 'comida', 'ferido'], blefe: 0.5,
  aviso: [F('erguer-se', 'BearStandUp', { dur: 1.4 }), F('bufar em pé', 'BearStandIdle', { dur: 2.4, voz: 'bufo' }), F('descer', 'BearStandEnd', { dur: 1 })],
  falsa: [F('investida falsa', 'BearRunForward', { mov: 'aproxima', vel: 'corrida', ate: 5.5, max: 5 }), F('parar e encarar', 'BearIdle', { dur: 1.8 })],
  ataque: [
    F('investida', 'BearRunForward', { mov: 'aproxima', vel: 'corrida', ate: 3.1, max: 6 }),
    F('erguer-se', 'BearStandUp', { dur: 0.7 }),
    F('patada', 'BearStandAttack', { mov: 'segura', dur: 1, golpe: 'patada', em: 0.5, alcance: 2.7 }),
    F('patada de esquerda', 'BearStandAttackLeft', { mov: 'segura', dur: 1, golpe: 'patada', em: 0.5, alcance: 2.7 }),
    F('descer', 'BearStandEnd', { dur: 0.7 }),
    F('morder', 'BearAttack', { mov: 'segura', dur: 1.1, golpe: 'mordida', em: 0.5, alcance: 2.5 }),
    F('esmagar', 'BearAttackLeft', { mov: 'segura', dur: 1.2, golpe: 'esmagar', em: 0.55, alcance: 2.5 }),
    F('recuar', 'BearWalkForward', { mov: 'recua', vel: 'passo', ate: 11, max: 5 }),
  ],
  golpes: {
    patada: imp('patada', Math.round(massa * 0.12), 12, { derruba: 2, empurra: 4, sangra: [3, 2] }),
    mordida: mord('mordida', kN, 1, { prende: 1, sangra: [4, 2] }),
    esmagar: mord('mordida na cabeça', kN, 1, { prende: 1.2, fatal: { se: 'derrubado', vida: 8 } }),
  },
});
// cervídeos e antílopes: cavam o chão, investem e dão a galhada (ou a chifrada)
const galhada = (massaBate, vel, extra = {}) => ({
  zonas: { alerta: 30, aviso: 9, critica: 4 }, paciencia: 4, gatilhos: ['acuado', 'ferido'], soMacho: true,
  aviso: [F('cavar o chão', 'DeerLegDig', { dur: 1.8 })],
  ataque: [F('investida', 'DeerGallopForward', { mov: 'aproxima', vel: 'corrida', ate: 2.8, max: 4 }), F('galhada', 'DeerIdleAttack', { mov: 'segura', dur: 0.9, golpe: 'galhada', em: 0.45, alcance: 2.6 }), F('recuar', 'DeerTrotForward', { mov: 'recua', vel: 'trote', ate: 12, max: 4 })],
  golpes: { galhada: imp('galhada', massaBate, vel, { derruba: 1.5, empurra: 4, sangra: [2, 2] }) },
  ...extra,
});
const coice = (clipe, massaPerna, vel, extra = {}) => ({
  zonas: { alerta: 25, aviso: 6, critica: 2.6 }, paciencia: 3, gatilhos: ['acuado', 'ferido'],
  aviso: [F('orelhas para trás', clipe === 'IdleAttack' ? 'Idle' : clipe, { dur: 1.2 })],
  ataque: [F('coice', clipe, { mov: 'parado', dur: 0.9, golpe: 'coice', em: 0.45, alcance: 2.6, costas: true }), F('afastar-se', 'TrotForward', { mov: 'recua', vel: 'trote', ate: 12, max: 4 })],
  golpes: { coice: imp('coice', massaPerna, vel, { derruba: 1.5, empurra: 5 }) },
  ...extra,
});

export const ATAQUES = {
  leao: felino(1.2, true),
  leoa: felino(1.05, false),
  // lobo: a alcateia cerca; cada um entra, morde e sai, em rodízio. Com três ou mais mordendo, quem caiu não levanta.
  lobo: {
    zonas: { alerta: 40, aviso: 14, critica: 5 }, paciencia: 6, gatilhos: ['invasao', 'cria', 'comida', 'ferido', 'corrida', 'fome'], grupo: 7, ciclos: 4,
    aviso: [F('encarar agachado', 'SneakIdle', { dur: 1.8 }), F('rosnar', 'Roah', { dur: 2.2, voz: 'rosnado' })],
    ataque: [
      F('cercar', 'SneakForward', { mov: 'ronda', vel: 'trote', raio: 5, dur: 2.4 }),
      F('investida', 'GallopForward', { mov: 'aproxima', vel: 'corrida', ate: 2.1, max: 3 }),
      F('morder', 'Attack', { mov: 'segura', dur: 0.9, golpe: 'mordida', em: 0.45, alcance: 1.9 }),
      F('sair', 'TrotForward', { mov: 'recua', vel: 'trote', ate: 5.5, max: 2 }),
    ],
    golpes: { mordida: mord('mordida', 0.6, 1, { sangra: [3, 2], derrubaChance: 0.3, derruba: 1.2, fatalMatilha: { se: 'derrubado', vida: 6, lobos: 3 } }) },
  },
  urso: urso(300, 0.9, false),
  urso_polar: urso(450, 1.6, true),
  // crocodilo: emboscada na beira d'água; morde, segura e gira
  crocodilo: {
    zonas: { alerta: 20, aviso: 8, critica: 4.5 }, paciencia: 3, gatilhos: ['invasao', 'ferido', 'fome', 'emboscada'],
    aviso: [F('encarar de boca aberta', 'Idle', { dur: 2 })],
    ataque: [
      F('bote', 'Attack', { mov: 'salto', dur: 0.65, altura: 0.25, golpe: 'mordida', em: 0.7, alcance: 2.8 }),
      F('segurar', 'Attack', { mov: 'segura', dur: 1.5, golpe: 'aperto', em: 0.5, alcance: 2.8 }),
      F('giro da morte', 'SwimForward', { mov: 'segura', dur: 2, giro: 3, golpe: 'giro', em: 0.6, alcance: 3 }),
      F('golpe de cauda', 'TailAttack', { mov: 'parado', dur: 1, golpe: 'cauda', em: 0.5, alcance: 3.2 }),
      F('voltar para a água', 'WalkForward', { mov: 'recua', vel: 'trote', ate: 8, max: 4 }),
    ],
    golpes: {
      mordida: mord('mordida', 16, 1, { prende: 2.2, sangra: [5, 2] }),
      aperto: mord('aperto', 0.9, 1, { prende: 2.4 }),
      giro: mord('giro da morte', 2.5, 1, { prende: 1, fatal: { se: 'preso' } }),
      cauda: imp('golpe de cauda', 75, 8, { derruba: 1.5, empurra: 5 }),
    },
  },
  // dragão-de-komodo: morde e espera o veneno
  komodo: {
    zonas: { alerta: 25, aviso: 9, critica: 4 }, paciencia: 4, gatilhos: ['invasao', 'comida', 'ferido', 'fome'], ciclos: 2,
    aviso: [F('olhar em volta', 'LookAround', { dur: 1.4 }), F('agachar e sibilar', 'CrouchIdle', { dur: 2, voz: 'sibilo' })],
    ataque: [
      F('investida', 'WalkForward', { mov: 'aproxima', vel: 'corrida', ate: 2.5, max: 4 }),
      F('morder', 'StandAttackForward', { mov: 'segura', dur: 0.9, golpe: 'mordida', em: 0.5, alcance: 2.5 }),
      F('golpe de cauda', 'TailAttack', { dur: 0.9, golpe: 'cauda', em: 0.5, alcance: 2.6 }),
      F('esperar o veneno', 'Idle', { dur: 2.2 }),
    ],
    golpes: { mordida: mord('mordida', 0.3, 1.15, { veneno: [8, 4], sangra: [4, 3] }), cauda: imp('golpe de cauda', 16, 8, { derruba: 1, empurra: 3 }) },
  },
  // tubarão-branco: ronda, esbarra para investigar, some para o fundo e volta de baixo; morde, sacode e solta. Se a
  // pessoa continua na água sangrando, a segunda mordida a leva para o fundo.
  peixe_greatwhiteshark: {
    zonas: { alerta: 45, aviso: 20, critica: 8 }, paciencia: 7, gatilhos: ['invasao', 'ferido', 'sangue', 'fome'], soNaAgua: true, sangueDe: 70,
    aviso: [F('rondar', 'SharkSwimForward', { mov: 'ronda', vel: 'trote', raio: 10, dur: 5 }), F('fechar o círculo', 'SharkSwimForward', { mov: 'ronda', vel: 'trote', raio: 6, dur: 3.5 })],
    ataque: [
      F('esbarrão', 'SharkSwimForward', { mov: 'aproxima', vel: 'trote', ate: 2.4, max: 5, golpe: 'esbarrao', aoChegar: true, alcance: 3.2 }),
      F('sumir para o fundo', 'SharkSwimForward', { mov: 'recua', vel: 'corrida', ate: 11, max: 2.2, fundo: 5 }),
      F('investida de baixo', 'SharkSwimForward', { mov: 'aproxima', vel: 'corrida', ate: 2.8, max: 4 }),
      F('morder', 'SharkBiteUp', { mov: 'segura', dur: 0.8, golpe: 'mordida', em: 0.5, alcance: 3.2 }),
      F('sacudir', 'SharkBiteShake', { mov: 'segura', dur: 1.4, golpe: 'sacudida', em: 0.5, alcance: 3.2 }),
      F('soltar e rondar', 'SharkSwimForward', { mov: 'ronda', vel: 'trote', raio: 9, dur: 5 }),
      F('segunda mordida', 'SharkBite', { mov: 'aproxima', vel: 'corrida', ate: 2.6, max: 4, golpe: 'arrastar', aoChegar: true, alcance: 3.2 }),
      F('ir embora', 'SharkSwimForward', { mov: 'recua', vel: 'trote', ate: 25, max: 6 }),
    ],
    golpes: {
      esbarrao: imp('esbarrão', 40, 4, { empurra: 3 }),
      mordida: mord('mordida', 9, 1.15, { prende: 1.4, sangra: [8, 1.5] }),
      sacudida: mord('sacudida', 0.6, 1.15, { prende: 1.2, sangra: [4, 1.5] }),
      arrastar: mord('mordida que arrasta para o fundo', 9, 1.15, { prende: 2, sangra: [8, 1.5], fatal: { se: 'sangrando' } }),
    },
  },
  // hipopótamo: abre a boca para avisar; investe, morde e pisoteia
  hipopotamo: {
    zonas: { alerta: 40, aviso: 20, critica: 10 }, paciencia: 4, gatilhos: ['invasao', 'cria', 'ferido'],
    aviso: [F('abrir a boca', 'Attack', { dur: 2.6, ritmo: 0.4, voz: 'ronco' })],
    ataque: [
      F('investida', 'TrotForward', { mov: 'aproxima', vel: 'corrida', ate: 3.3, max: 7 }),
      F('morder', 'Attack', { mov: 'segura', dur: 1, golpe: 'mordida', em: 0.5, alcance: 3.2 }),
      F('pisotear', 'TrotForward', { mov: 'segura', dur: 1, golpe: 'pisoteio', em: 0.5, alcance: 2.6 }),
      F('recuar', 'WalkForward', { mov: 'recua', vel: 'passo', ate: 12, max: 5 }),
    ],
    golpes: { mordida: mord('mordida', 8, 1.2, { derruba: 2.5, sangra: [5, 2] }), pisoteio: peso('pisoteio', 1600, { fatal: { se: 'derrubado' } }) },
  },
  // elefante: abre as orelhas e levanta a tromba; investida falsa; depois presas, tromba e patas
  elefante: {
    zonas: { alerta: 50, aviso: 25, critica: 12 }, paciencia: 5, gatilhos: ['invasao', 'cria', 'ferido'], blefe: 0.6,
    aviso: [F('abrir as orelhas', 'Idle', { dur: 1.6 }), F('levantar a tromba', 'Attack', { dur: 2.2, ritmo: 0.5, voz: 'trombeta' })],
    falsa: [F('investida falsa', 'TrotForward', { mov: 'aproxima', vel: 'corrida', ate: 9, max: 5 }), F('parar e balançar a cabeça', 'Idle', { dur: 1.8 })],
    ataque: [
      F('investida', 'TrotForward', { mov: 'aproxima', vel: 'corrida', ate: 4.2, max: 8 }),
      F('presas', 'Attack', { mov: 'segura', dur: 1.1, golpe: 'presas', em: 0.5, alcance: 4.2 }),
      F('arremessar com a tromba', 'AttackL', { mov: 'segura', dur: 1, golpe: 'tromba', em: 0.5, alcance: 4.2 }),
      F('pisotear', 'AttackR', { mov: 'segura', dur: 1.2, golpe: 'pisoteio', em: 0.55, alcance: 3.4 }),
      F('recuar', 'WalkForward', { mov: 'recua', vel: 'passo', ate: 15, max: 5 }),
    ],
    golpes: { presas: imp('presas', 1350, 7, { derruba: 3, empurra: 5, sangra: [4, 2] }), tromba: imp('golpe de tromba', 150, 9, { derruba: 3, empurra: 9 }), pisoteio: peso('pisoteio', 4500, { fatal: { se: 'derrubado' } }) },
  },
  // rinoceronte: enxerga mal; cava o chão, bufa e investe de chifre
  rinoceronte: {
    zonas: { alerta: 30, aviso: 22, critica: 10 }, paciencia: 4, gatilhos: ['invasao', 'cria', 'ferido'],
    aviso: [F('cavar o chão', 'RhinocerosDig', { dur: 2.2 }), F('bufar', 'RhinocerosIdle', { dur: 1, voz: 'bufo' })],
    ataque: [
      F('investida', 'RhinocerosGallopForward', { mov: 'aproxima', vel: 'corrida', ate: 3.6, max: 8 }),
      F('chifrada', 'RhinocerosAttack', { mov: 'segura', dur: 0.9, golpe: 'chifrada', em: 0.45, alcance: 3.6 }),
      F('seguir em frente', 'RhinocerosTrotForward', { mov: 'recua', vel: 'trote', ate: 14, max: 4 }),
    ],
    golpes: { chifrada: imp('chifrada', 600, 12, { derruba: 3, empurra: 9, sangra: [6, 2] }) },
  },
  // gorila: bate no peito e faz investida falsa; se a pessoa não recua, golpe e mordida
  gorila: {
    zonas: { alerta: 30, aviso: 14, critica: 5 }, paciencia: 6, gatilhos: ['invasao', 'cria', 'ferido'], blefe: 0.7, soMacho: true,
    aviso: [F('bater no peito', 'Drum', { dur: 2.6, voz: 'tambor' })],
    falsa: [F('investida falsa', 'RunForward', { mov: 'aproxima', vel: 'corrida', ate: 4, max: 4 }), F('encarar', 'Idle', { dur: 1.6 })],
    ataque: [
      F('investida', 'RunForward', { mov: 'aproxima', vel: 'corrida', ate: 2.3, max: 5 }),
      F('golpe', 'Attack', { mov: 'segura', dur: 1, golpe: 'soco', em: 0.5, alcance: 2.4 }),
      F('morder', 'Attack', { mov: 'segura', dur: 1, golpe: 'mordida', em: 0.5, alcance: 2.2 }),
      F('recuar', 'WalkForward', { mov: 'recua', vel: 'passo', ate: 9, max: 4 }),
    ],
    golpes: { soco: imp('golpe de braço', 18, 12, { derruba: 2, empurra: 6 }), mordida: mord('mordida', 2, 0.9, { sangra: [3, 2] }) },
  },
  // casuar: a ave mais perigosa; corre e chuta com a garra
  casuar: {
    zonas: { alerta: 25, aviso: 10, critica: 4 }, paciencia: 4, gatilhos: ['invasao', 'cria', 'ferido'],
    aviso: [F('olhar em volta', 'IdleLookAround', { dur: 1.5 })],
    ataque: [
      F('corrida', 'Dash', { mov: 'aproxima', vel: 'corrida', ate: 2.3, max: 4 }),
      F('chute', 'DashKickRightFoot', { mov: 'segura', dur: 0.7, golpe: 'chute', em: 0.5, alcance: 2.2 }),
      F('chute com os dois pés', 'KickBothLeg', { mov: 'segura', dur: 0.9, golpe: 'chuteDuplo', em: 0.5, alcance: 2.2 }),
      F('recuar', 'RunForward', { mov: 'recua', vel: 'trote', ate: 9, max: 3 }),
    ],
    golpes: { chute: imp('chute de garra', 10, 14, { sangra: [4, 2] }), chuteDuplo: imp('chute com os dois pés', 20, 12, { derruba: 1.5, empurra: 4, sangra: [3, 2] }) },
  },
  alce: { ...galhada(240, 9), zonas: { alerta: 35, aviso: 15, critica: 6 }, gatilhos: ['invasao', 'cria', 'acuado', 'ferido'], soMacho: false,
    aviso: [F('cavar o chão', 'DeerLegDig', { dur: 2 }), F('berrar', 'DeerRoah', { dur: 1.8, voz: 'berro' })],
    ataque: [F('investida', 'DeerGallopForward', { mov: 'aproxima', vel: 'corrida', ate: 3, max: 5 }), F('galhada', 'DeerIdleAttack', { mov: 'segura', dur: 0.9, golpe: 'galhada', em: 0.45, alcance: 3 }), F('pisotear', 'DeerLegDig', { mov: 'segura', dur: 1.2, golpe: 'cascos', em: 0.5, alcance: 2.6 }), F('recuar', 'DeerTrotForward', { mov: 'recua', vel: 'trote', ate: 12, max: 4 })],
    golpes: { galhada: imp('galhada', 240, 9, { derruba: 2, empurra: 6, sangra: [3, 2] }), cascos: peso('pisoteio de cascos', 500, {}) } },
  cervo: galhada(76, 8),
  caribu: galhada(72, 8),
  gnu: { ...galhada(100, 8), aviso: [F('sacudir a cabeça', 'HeadShake', { dur: 1.5 })], ataque: [F('investida', 'GallopForward', { mov: 'aproxima', vel: 'corrida', ate: 2.6, max: 4 }), F('chifrada', 'IdleAttack', { mov: 'segura', dur: 0.9, golpe: 'galhada', em: 0.45, alcance: 2.5 }), F('recuar', 'TrotForward', { mov: 'recua', vel: 'trote', ate: 12, max: 4 })], golpes: { galhada: imp('chifrada', 100, 8, { derruba: 1.5, empurra: 4, sangra: [2, 2] }) } },
  // touro e vaca com bezerro: abaixa a cabeça, investe e chifra
  gado: {
    zonas: { alerta: 25, aviso: 9, critica: 4.5 }, paciencia: 4, gatilhos: ['invasao', 'cria', 'ferido'], soMachoOuCria: true,
    aviso: [F('abaixar a cabeça', 'IdleAttack', { dur: 2, ritmo: 0.45 })],
    ataque: [F('investida', 'CanterForward', { mov: 'aproxima', vel: 'corrida', ate: 2.9, max: 5 }), F('chifrada', 'IdleAttack', { mov: 'segura', dur: 0.9, golpe: 'chifrada', em: 0.45, alcance: 2.8 }), F('recuar', 'TrotForward', { mov: 'recua', vel: 'trote', ate: 10, max: 4 })],
    golpes: { chifrada: imp('chifrada', 315, 8, { derruba: 2, empurra: 7, sangra: [3, 2] }) },
  },
  // javali / porco: investe de presas quando acuado ou com leitões
  porco: {
    zonas: { alerta: 20, aviso: 7, critica: 3.5 }, paciencia: 3, gatilhos: ['acuado', 'cria', 'ferido'],
    aviso: [F('encarar', 'Idle', { dur: 1.2 })],
    ataque: [F('investida', 'RunForward', { mov: 'aproxima', vel: 'corrida', ate: 2, max: 4 }), F('presas', 'Attack', { mov: 'segura', dur: 0.8, golpe: 'presas', em: 0.5, alcance: 2 }), F('fugir', 'RunForward', { mov: 'recua', vel: 'corrida', ate: 14, max: 4 })],
    golpes: { presas: imp('golpe de presas', 75, 9, { derruba: 1.2, empurra: 3, sangra: [3, 2] }) },
  },
  cabra: { zonas: { alerta: 12, aviso: 4, critica: 2.2 }, paciencia: 3, gatilhos: ['ferido'], soMacho: true, aviso: [F('encarar', 'Idle', { dur: 1 })],
    ataque: [F('cabeçada', 'IdleAttack', { mov: 'segura', dur: 0.9, golpe: 'cabecada', em: 0.45, alcance: 2 }), F('recuar', 'TrotForward', { mov: 'recua', vel: 'trote', ate: 8, max: 3 })], golpes: { cabecada: imp('cabeçada', 35, 6, { empurra: 4 }) } },
  zebra: coice('IdleAttack', 22, 14),
  girafa: coice('IdleAttack', 60, 15, { zonas: { alerta: 30, aviso: 7, critica: 3.2 } }),
  dromedario: coice('IdleAttack', 30, 12, { golpes: { coice: imp('coice', 30, 12, { derruba: 1.5, empurra: 5 }), mordida: mord('mordida', 0.7, 0.7, {}) } }),
  camelo: coice('IdleAttack', 30, 12, { golpes: { coice: imp('coice', 30, 12, { derruba: 1.5, empurra: 5 }), mordida: mord('mordida', 0.7, 0.7, {}) } }),
  // tamanduá-bandeira: acuado, senta e abraça com as garras
  tamandua: { zonas: { alerta: 12, aviso: 5, critica: 2.5 }, paciencia: 3, gatilhos: ['acuado', 'ferido'], aviso: [F('erguer as garras', 'Idle', { dur: 1.5 })],
    ataque: [F('abraço de garras', 'Attack', { mov: 'segura', dur: 1, golpe: 'garras', em: 0.5, alcance: 2 }), F('afastar-se', 'RunForward', { mov: 'recua', vel: 'trote', ate: 9, max: 4 })], golpes: { garras: imp('abraço de garras', 8, 10, { sangra: [4, 2] }) } },
  foca: { zonas: { alerta: 15, aviso: 5, critica: 2.5 }, paciencia: 3, gatilhos: ['acuado', 'ferido'], aviso: [F('encarar', 'Idle', { dur: 1.2 })],
    ataque: [F('mordida', 'Idle', { mov: 'segura', dur: 0.8, golpe: 'mordida', em: 0.5, alcance: 1.8 }), F('fugir', 'WalkForward', { mov: 'recua', vel: 'trote', ate: 8, max: 3 })], golpes: { mordida: mord('mordida', 0.4, 1, { sangra: [2, 2] }) } },
  cisne: { zonas: { alerta: 12, aviso: 5, critica: 2.5 }, paciencia: 3, gatilhos: ['cria', 'ferido'], aviso: [F('abrir as asas', 'StandFlapOnLand', { dur: 1.6 })],
    ataque: [F('asada', 'Attack', { mov: 'segura', dur: 0.8, golpe: 'asa', em: 0.5, alcance: 1.8 }), F('recuar', 'WalkForward', { mov: 'recua', vel: 'passo', ate: 5, max: 3 })], golpes: { asa: imp('golpe de asa', 2, 10, { empurra: 2 }) } },
  gato: { zonas: { alerta: 8, aviso: 2, critica: 1 }, paciencia: 2, gatilhos: ['ferido'], aviso: [F('arquear', 'Idle', { dur: 0.8 })],
    ataque: [F('arranhão', 'Attack', { mov: 'segura', dur: 0.6, golpe: 'arranhao', em: 0.5, alcance: 1.2 }), F('fugir', 'GallopForward', { mov: 'recua', vel: 'corrida', ate: 10, max: 3 })], golpes: { arranhao: mord('arranhão', 0.07, 1, {}) } },
  tart_snappingturtle: { zonas: { alerta: 4, aviso: 1.6, critica: 1 }, paciencia: 2, gatilhos: ['ferido', 'toque'], aviso: [F('abrir a boca', 'SnappingTurtleIdle', { dur: 1 })],
    ataque: [F('bote', 'SnappingTurtleIdleBite', { mov: 'parado', dur: 0.7, golpe: 'mordida', em: 0.5, alcance: 1.3 })], golpes: { mordida: mord('mordida', 0.2, 1.15, { sangra: [2, 2] }) } },
  // peçonhentos: só quando se pisa perto demais ou se põe a mão
  escorpiao: { zonas: { alerta: 3, aviso: 1.4, critica: 0.9 }, paciencia: 2, gatilhos: ['invasao', 'ferido', 'toque'], aviso: [F('erguer a cauda', 'ScorpionIdle', { dur: 1 })],
    ataque: [F('ferroada', 'ScorpionAttack', { mov: 'segura', dur: 0.6, golpe: 'ferroada', em: 0.5, alcance: 1 })], golpes: { ferroada: ven('ferroada', 1, [6, 4], {}) } },
  tarantula: { zonas: { alerta: 3, aviso: 1.4, critica: 0.8 }, paciencia: 3, gatilhos: ['ferido', 'toque'], aviso: [F('erguer as patas', 'ThreatStart', { dur: 0.8 }), F('ameaçar', 'Threat', { dur: 1.6 })],
    ataque: [F('picada', 'Attack', { mov: 'segura', dur: 0.6, golpe: 'picada', em: 0.5, alcance: 0.9 })], golpes: { picada: ven('picada', 1, [3, 4], {}) } },
  vespa: { zonas: { alerta: 5, aviso: 2.5, critica: 1.2 }, paciencia: 4, gatilhos: ['invasao', 'ferido'], grupo: 6, aviso: [F('zumbir em volta', 'Soar', { mov: 'ronda', vel: 'trote', raio: 1.6, dur: 2.5 })],
    ataque: [F('ferroada', 'StingAttack', { mov: 'segura', dur: 0.6, golpe: 'ferroada', em: 0.5, alcance: 1 }), F('rodear', 'Soar', { mov: 'ronda', vel: 'trote', raio: 1.5, dur: 1.5 })], golpes: { ferroada: ven('ferroada', 1, [1, 3], {}) }, ciclos: 2 },
  // rã-flecha: não ataca; quem põe a mão nela se intoxica
  sapo: { zonas: { alerta: 2, aviso: 0, critica: 0 }, paciencia: 99, gatilhos: ['toque'], aviso: [], ataque: [], golpes: { pele: ven('veneno da pele', 0, [5, 3], {}) }, soToque: 'pele' },
};
// leoa e galo usam o modelo próprio, mas a ficha é a do leão e da galinha: o ataque sai pelo sexo
export function ataqueDe(especie, sexo) { return especie === 'leao' && sexo === 'F' ? ATAQUES.leoa : ATAQUES[especie] || null; }
export const perigoso = (especie) => !!ATAQUES[especie] && ATAQUES[especie].ataque.length > 0;

// O golpe como chega a quem joga: { nome, dano, derruba, prende, sangra, veneno, empurra, fatal }.
export function golpeDe(especie, sexo, nome, ctx = {}) {
  const A = ataqueDe(especie, sexo), g = A && A.golpes[nome];
  if (!g) return null;
  const out = { nome: g.nome, dano: g.dano };
  for (const k of ['derruba', 'prende', 'sangra', 'veneno', 'empurra', 'fatal']) if (g[k] !== undefined) out[k] = g[k];
  if (g.derrubaChance !== undefined && !(ctx.u < g.derrubaChance)) delete out.derruba;
  if (g.fatalMatilha && (ctx.lobos || 0) >= g.fatalMatilha.lobos) out.fatal = { se: g.fatalMatilha.se, vida: g.fatalMatilha.vida };
  return out;
}
// Quanto de vida uma sequência inteira tira de quem não reage (para a tabela e os testes) e se tem golpe fatal.
export function resumoAtaque(especie, sexo) {
  const A = ataqueDe(especie, sexo);
  if (!A) return null;
  let total = 0, fatal = null;
  const golpes = [];
  for (const f of A.ataque) {
    if (!f.golpe) continue;
    const g = A.golpes[f.golpe], vezes = f.repete || 1;
    const extra = (g.sangra ? g.sangra[0] : 0) + (g.veneno ? g.veneno[0] : 0);
    total += (g.dano + extra) * vezes;
    golpes.push({ fase: f.fase, clipe: f.clipe, golpe: g.nome, dano: g.dano, vezes, sangra: g.sangra || null, veneno: g.veneno || null, derruba: g.derruba || 0, prende: g.prende || 0, fatal: g.fatal || g.fatalMatilha || null });
    if (g.fatal || g.fatalMatilha) fatal = { golpe: g.nome, ...(g.fatal || g.fatalMatilha) };
    else if (g.dano >= VIDA_PESSOA) fatal = { golpe: g.nome, se: 'sempre' };
  }
  return { total, fatal, golpes, zonas: A.zonas, paciencia: A.paciencia, gatilhos: A.gatilhos };
}
// A fase em que o bicho está, dado o tempo desde o começo da sequência (para o laboratório e para o aparelho que
// chegou no meio): devolve { k, t (segundos dentro da fase) }. Fases sem `dur` valem `max` (ou 2 s).
export const duracaoFase = (f) => f.dur ?? f.max ?? 2;
export function nomesDeClipes(especie, sexo) { const A = ataqueDe(especie, sexo); return A ? [...new Set([...A.aviso, ...(A.falsa || []), ...A.ataque].map((f) => f.clipe))] : []; }
