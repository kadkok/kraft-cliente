// LAVRA — pele da fauna do pacote do Kadmus (grupos k = 'fauna', e = espécie). Pedido direto dele em 17/11/2026.
// Cada espécie tem o seu modelo convertido (assets/fauna/bichos/<id>.glb, tools/fauna/converter.mjs) e o seu .json com a
// lista de clipes. Aqui a animação é escolhida pelo PAPEL (parado, andar, trote, corrida, nadar, voar, comer, dormir,
// morrer, atacar, chamar…), achado pelo nome dos clipes do pacote; o compasso das marchas segue a velocidade real do
// corpo. A ação vem do servidor (bits altos de `nb`, nomes em shared/animais.js → ACOES_ANIMAL); os atributos
// (sexo, crescimento, fase, olhar) em g.fa. Macho e fêmea com modelos diferentes onde o pacote tem (leão/leoa, galo/galinha).
import * as THREE from '../three.js';
import { ACOES_ANIMAL } from '../../shared/animais.js';
import { ESPECIES, MODELO_SEXO } from '../../shared/especies.js';
import { clonarComOssos } from './cavalo-animacao.js';
import { escalaDe, chaoDe } from '../../shared/escala-fauna.js';
import { carregarBicho, compilarGlb, emVR } from './carregador-glb.js';   // GLB leve (KTX2 + Meshopt) com volta para o original (20/11, HANDOFF-HERMES-desempenho)

// papéis → padrões de nome de clipe (o primeiro que existir vale)
const PAPEIS = {
  idle: [/^idle$/i, /^idle\d+$/i, /^idle(loop|_?1)?$/i, /^idle(?!.*(attack|hit|sleep|to))/i, /^float$/i, /^stand(idle)?$/i, /^swimstraight$/i, /^swim$/i],
  walk: [/^walkforward$/i, /^walk$/i, /^walk(?!.*(back|left|right|attack|hit))/i, /crawl(forward)?$/i, /^move/i],
  walkL: [/^walkleft$/i, /walk.*left/i], walkR: [/^walkright$/i, /walk.*right/i],
  trot: [/^trotforward$/i, /^trot$/i, /^trot(?!.*(left|right|attack|hit))/i, /^canterforward$/i],
  run: [/^gallopforward$/i, /^runforward$/i, /^run$/i, /^sprint/i, /^gallop(?!.*(left|right|attack|hit))/i, /^run(?!.*(left|right|stop|attack))/i, /^canterforward$/i, /^trotforward$/i, /^walkforward$/i],
  runL: [/^gallopleft$/i, /^runleft$/i], runR: [/^gallopright$/i, /^runright$/i],
  swim: [/^swim(forward)?\d?$/i, /^swimstraight$/i, /^swim(?!.*(left|right|fast|idle|down|up|back|death|attack|hit))/i, /^swimslow/i, /^float$/i, /^idle$/i],
  swimFast: [/swimfast|fastswim|^swimfaster|dash/i],
  fly: [/^flapforward$/i, /^flap1forward$/i, /^flap2forward$/i, /^fly(forward)?$/i, /^flyloop/i, /^flap1$/i, /^flapping/i, /^fly(?!.*(left|right|down|up|land|take|to))/i, /^hoverforward$/i, /^glideforward$/i, /^glide1forward$/i],
  flyL: [/^flapleft$/i, /^flap1left$/i, /^glideleft$/i], flyR: [/^flapright$/i, /^flap1right$/i, /^glideright$/i],
  flyUp: [/^flapup$/i, /^flap1up$/i, /^flap2up$/i], flyDown: [/^glidedown$/i, /^flapdown$/i, /^glide1down$/i],
  glide: [/^glideforward$/i, /^glide1forward$/i, /^soar/i, /^glide(?!.*(attack|hit))/i],
  hover: [/^hover$/i, /^hoverforward$/i],
  eat: [/^eatloop$/i, /^grazing/i, /^graze/i, /^eating/i, /^eat$/i, /^chewing$/i, /^eat(?!.*(start|end))/i, /^peck/i, /^bite$/i],
  drink: [/^drink/i],
  lie: [/^idletosleep$/i, /^liedown/i, /^sitdown/i, /^down$/i, /^sleepstart/i, /^lie/i],
  sleep: [/^sleep(loop)?$/i, /^sleeping/i, /^rest$/i, /^sleep(?!.*(start|end|to))/i],
  getup: [/^wakeup$/i, /^rebirth$/i, /^getup/i, /^standup/i, /^arise/i, /^sleepend/i],
  death: [/^death$/i, /^die$/i, /^death/i],
  attack: [/^idleattack$/i, /^attack$/i, /^attack\d?$/i, /^bite/i, /^attack(?!.*(walk|trot|canter|gallop|run))/i, /attack/i],
  hit: [/^idlehit$/i, /^hit$/i, /^damage/i, /hit/i],
  jump: [/^jump$/i, /^jumpforward$/i, /^jump(?!.*(start|end|land))/i, /^hop/i],
  call: [/^roar/i, /^roah/i, /^call/i, /^howl/i, /^sound/i, /^chirp/i, /^croak/i, /^bark/i, /^moo/i, /^bleat/i, /^scream/i, /^sing/i, /^shout/i],
  groom: [/^groom/i, /^scratch/i, /^clean/i, /^preen/i, /^shake/i, /^lick/i],
  sniff: [/^sniff/i, /^smell/i, /^look/i, /^idle2/i],
  land: [/^landing$/i, /^land$/i], takeoff: [/^takeoff/i, /^take_?off/i],
};
// ação do servidor → [papel, modo] (modo: laco | uma = toca uma vez e fica no fim | fim = já no último quadro)
const ACAO_PAPEL = {
  parado: ['idle', 'laco'], alerta: ['sniff', 'laco'], pastar: ['eat', 'laco'], comer: ['eat', 'laco'], beber: ['drink', 'laco'],
  deitar: ['lie', 'uma'], dormir: ['sleep', 'laco'], ruminar: ['lie', 'fim'], levantar: ['getup', 'uma'], urinar: ['idle', 'laco'],
  defecar: ['idle', 'laco'], atacar: ['attack', 'uma'], chamar: ['call', 'uma'], cheirar: ['sniff', 'laco'], mamar: ['eat', 'laco'],
  cortejar: ['call', 'uma'], acasalar: ['idle', 'laco'], parir: ['lie', 'fim'], limpar: ['groom', 'laco'], pular: ['jump', 'uma'],
  morto: ['death', 'uma'], pousar: ['land', 'uma'],
};
const MOVE = new Set(['andar', 'trotar', 'correr', 'fugir', 'cacar', 'nadar', 'voar', 'parado', 'alerta', 'pastar', 'comer', 'cheirar', 'subir']);
const LONGE = 60;

// nome "limpo" para casar com os papéis: sem o prefixo da espécie que muitos clipes trazem (EagleRunForward,
// BearRunAttack, DeerIdleToWalk…) e sem o InPlace; o clipe tocado continua o original
const ACAO_PALAVRA = /^(Walk|Run|Idle|Idles|Flap|Glide|Swim|Trot|Gallop|Canter|Hop|Eat|Eating|Jump|Sleep|Death|Die|Attack|Hit|Fly|Turn|Side|Sit|Stand|Lie|Down|Get|Wake|Land|Landing|Take|Dive|Hover|Chewing|Rebirth|Defense|Float|Crawl|Roar|Roah|Call|Calling|Grooming|Drink|Soar|Graze|Peck|Sniff|Bite|Howl|Bark|Dash|Catch|Bathing)$/i;
const palavras = (n) => n.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().split(/\s+/);
// núcleo de cada nome: a partir da primeira palavra de ação (BearIdle → Idle, BoxTurtleCrouchIdle → Idle,
// Sulcata_Anim_Idle_ → Idle, EagleFlapForward → FlapForward); quem não tem palavra de ação fica como está.
// Nomes que dão o mesmo núcleo: vale o que tinha menos palavras antes (o "normal" antes do "agachado").
function limpos(nomes) {
  const out = nomes.map((n) => {
    const w = palavras(n).filter((x) => x && !/^anim$/i.test(x)), k = w.findIndex((x) => ACAO_PALAVRA.test(x.replace(/\d+$/, '')));
    return { nucleo: (k >= 0 ? w.slice(k) : w).join('').replace(/InPlace$/i, ''), antes: Math.max(0, k), n };
  });
  out.sort((a, b) => a.antes - b.antes);
  return out.map((o) => [o.nucleo, o.n]);
}
function papeis(nomesOrig) {
  // núcleo repetido: vale o PRIMEIRO da lista ordenada (o nome com menos palavras antes: Idle antes de SneakIdle,
  // CrouchIdle, ToboganToIdle, OverTurnedIdle…). Antes valia o último, e o lobo ficava parado em pose de emboscada,
  // o pinguim de barriga no chão e o jabuti de casco para baixo (19/11).
  const pares = limpos(nomesOrig), nomes = [], orig = {};
  for (const [nucleo, nome] of pares) if (!(nucleo in orig)) { orig[nucleo] = nome; nomes.push(nucleo); }
  const out = {};
  for (const [p, pads] of Object.entries(PAPEIS)) { for (const re of pads) { const n = nomes.find((x) => re.test(x)); if (n) { out[p] = orig[n]; break; } } }
  out.drink ||= out.eat; out.sleep ||= out.lie; out.lie ||= out.sleep; out.sniff ||= out.idle; out.groom ||= out.idle; out.call ||= out.idle;
  out.getup ||= out.idle; out.attack ||= out.idle; out.death ||= out.lie || out.idle; out.trot ||= out.walk; out.run ||= out.trot || out.walk; out.walk ||= out.run || out.idle;
  out.swim ||= out.walk || out.idle; out.fly ||= out.glide || out.hover || out.walk || out.idle; out.glide ||= out.fly; out.eat ||= out.idle; out.jump ||= out.run; out.land ||= out.idle;
  return out;
}

export function createFaunaSkin(scene, { nature, game, shadow = true } = {}) {
  const modelos = new Map();                    // id do modelo → { prep } | { carregando } | { falhou }
  const corpos = new Map();
  let agora = performance.now() / 1000, dt = 0, quadro = 0, dead = false;
  function modelo(id) {
    let m = modelos.get(id);
    if (m) return m.prep || null;
    m = { carregando: true }; modelos.set(id, m);
    Promise.all([
      fetch(`/kraft-cliente/assets/fauna/bichos/${id}.json`).then((r) => (r.ok ? r.json() : null)),
      carregarBicho(id, scene),   // assets/fauna/bichos-leve/<id>.glb; se falhar, o original de assets/fauna/bichos/
    ]).then(async ([info, gltf]) => {
      if (dead) return;
      const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
      const grande = (info?.altura || 1) > (game?.plataforma === 'pc' || !game?.plataforma ? 0.12 : 0.35);   // fora do PC só bicho grande faz sombra   // 17/11: bicho médio também projeta sombra (sem ela parecia colado no chão)
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = shadow && grande; o.receiveShadow = true; o.frustumCulled = false; } });
      if (emVR()) (await import('./vr-fosco.js')).aplicarFosco(gltf.scene);   // no visor o material já nasce jateado (senão o main.js o recompilava 2 s depois, com o bicho na tela)
      await compilarGlb(gltf.scene, scene); if (dead) return;                     // shader pronto antes de o bicho entrar na cena: não trava o quadro
      m.prep = { id, base: gltf.scene, clips, papel: papeis(Object.keys(clips)), info, escala: escalaDe(id), chao: chaoDe(id) };   // escala real da espécie e pés no chão (shared/escala-fauna.js)
    }).catch((e) => { m.falhou = true; console.warn('[fauna]', id, e?.message || e); });
    return null;
  }
  class Corpo {
    constructor(prep, seed) {
      const { copia, ossos } = clonarComOssos(prep.base);
      this.prep = prep; this.raiz = new THREE.Group(); this.raiz.add(copia); this.ossos = ossos;
      this.mixer = new THREE.AnimationMixer(copia); this.acoes = {}; this.atual = null; this.chave = '';
      this.seed = seed; this.vel = 0; this.giro = 0; this.ultimo = null; this.olhar = 0;
      this.cabeca = [...ossos.values()].find((b) => /^head$/i.test(b.name)) || [...ossos.values()].find((b) => /head/i.test(b.name));
      scene.add(this.raiz);
    }
    tocar(nome, compasso, modo) {
      const clip = this.prep.clips[nome]; if (!clip) return;
      let a = this.acoes[nome] || (this.acoes[nome] = this.mixer.clipAction(clip));
      a.timeScale = compasso;
      const chave = nome + ':' + modo; if (chave === this.chave) return;
      const velha = this.atual;
      a.reset(); a.setLoop(modo === 'laco' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = modo !== 'laco';
      if (modo === 'fim') { a.time = clip.duration - 0.01; a.paused = true; }
      if (modo === 'laco') a.time = ((this.seed % 997) / 997) * clip.duration;
      a.enabled = true; a.setEffectiveWeight(1); a.play();
      if (velha && velha !== a) velha.crossFadeTo(a, modo === 'fim' ? 1.2 : 0.3, false);
      this.atual = a; this.chave = chave;
    }
    atualizar(dt, especie, acao, pos, rumo, attrs, voando, molhado, olharPara) {
      const e = ESPECIES[especie], P = this.prep.papel;
      if (this.ultimo && dt > 0) {
        const v = Math.hypot(pos[0] - this.ultimo[0], pos[2] - this.ultimo[2], voando ? pos[1] - this.ultimo[1] : 0) / dt;
        this.vel += (Math.min(v, 40) - this.vel) * (1 - Math.exp(-dt * 6));
        const dg = ((rumo - this.ultimo[3] + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
        this.giro += (dg / dt - this.giro) * (1 - Math.exp(-dt * 4));
      }
      this.ultimo2 = this.ultimo ? this.ultimo[1] : pos[1];
      this.ultimo = [pos[0], pos[1], pos[2], rumo];
      const cres = (attrs?.[1] ?? 100) / 100, femea = attrs?.[0] === 0;
      const tam = cres * this.prep.escala * (femea && e.classe === 'mamifero' && !MODELO_SEXO[especie] ? 0.94 : 1);
      this.raiz.scale.setScalar(tam);
      // nadando, o bicho de terra afunda até sobrar a cabeça; em terra, o modelo sobe ou desce o que falta para os pés
      // tocarem o chão (a origem de alguns vem no meio do corpo, outros flutuavam)
      this.afunda = molhado && e.meio !== 'agua' ? (this.vel > 0.2 ? e.alt * 0.6 : 0) : voando ? 0 : -this.prep.chao * cres;
      this.raiz.position.set(pos[0], pos[1] - this.afunda, pos[2]);
      this.raiz.rotation.set(0, rumo, 0);
      const v = this.vel, [passo, trote, corrida] = e.vel, vira = Math.abs(this.giro) > 0.5 ? (this.giro > 0 ? 'L' : 'R') : '';
      let papel, compasso = 1, modo = 'laco';
      if (e.meio === 'agua' || (molhado && e.nada && v > 0.15)) { papel = v > trote ? 'swimFast' : 'swim'; compasso = Math.max(0.5, Math.min(2, v / Math.max(0.1, passo * 1.5))); if (!P[papel]) papel = 'swim'; }
      else if (voando) {
        const vy = this.ultimo2 ? (pos[1] - this.ultimo2) / Math.max(0.001, dt) : 0;
        papel = vy > 0.8 && P.flyUp ? 'flyUp' : vy < -0.8 && P.flyDown ? 'flyDown' : vira && P['fly' + vira] ? 'fly' + vira : v < 0.6 && P.hover ? 'hover' : v > corrida * 0.7 && P.glide ? 'glide' : 'fly';
        compasso = 1;
      }
      else if (MOVE.has(acao) && v > passo * 0.25) {
        if (v < (passo + trote) / 2) { papel = vira && P['walk' + vira] ? 'walk' + vira : 'walk'; compasso = Math.max(0.5, Math.min(1.8, v / passo)); }
        else if (v < (trote + corrida) / 2) { papel = 'trot'; compasso = Math.max(0.6, Math.min(1.8, v / trote)); }
        else { papel = vira && P['run' + vira] ? 'run' + vira : 'run'; compasso = Math.max(0.7, Math.min(2.2, v / (corrida * 0.8))); }
      } else { const m = ACAO_PAPEL[acao] || ['idle', 'laco']; papel = m[0]; modo = m[1]; }
      this.tocar(P[papel] || P.idle, compasso, modo);
      this.mixer.update(dt);
      // olhar: a cabeça vira para o que o bicho observa (parado)
      const k = 1 - Math.exp(-dt * 3);
      let alvo = 0;
      if (olharPara && v < passo && this.cabeca && ['parado', 'alerta', 'cheirar', 'chamar', 'cortejar'].includes(acao)) {
        const dif = ((Math.atan2(olharPara[0] - pos[0], olharPara[2] - pos[2]) - rumo + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
        alvo = Math.max(-1, Math.min(1, dif));
      }
      this.olhar += (alvo - this.olhar) * k;
      if (Math.abs(this.olhar) > 0.01 && this.cabeca?.parent) {
        this.raiz.updateMatrixWorld(true);
        const qp = this.cabeca.parent.getWorldQuaternion(new THREE.Quaternion()), qi = qp.clone().invert(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.olhar * 0.6);
        this.cabeca.quaternion.premultiply(qp).premultiply(q).premultiply(qi);
      }
    }
    descartar() { this.mixer.stopAllAction(); this.raiz.removeFromParent(); }
  }
  return {
    stats: { kind: 'fauna' },
    begin() { const t = performance.now() / 1000; dt = Math.min(0.1, Math.max(0, t - agora)); agora = t; quadro++; },
    put(x, y, z, rumo, batida, presenca, g, i) {
      const especie = g.e, E = ESPECIES[especie]; if (!E) return;
      // leveza (17/11): cada esqueleto animado custa CPU a cada quadro. Bicho pequeno só aparece de perto, inseto em
      // bando mostra no máximo 8 por grupo, e longe da câmera a animação anda em ritmo menor (números logo abaixo)
      const eu = game?.cavalos?.eu, d2 = eu ? (x - eu[0]) ** 2 + (z - eu[2]) ** 2 : 0;
      const fx = (game?.vrEscalaFauna || 1) * (game?.plataforma === 'visor' ? 0.6 : game?.plataforma === 'celular' ? 0.8 : 1);   // plataforma + regulador do VR
      const alc = (E.alt < 0.12 ? 22 : E.alt < 0.45 ? 55 : 120) * fx;
      if (d2 > alc * alc || (E.alt < 0.12 && i >= 8)) { const c0 = corpos.get(g.id * 64 + i); if (c0) { c0.corpo.raiz.visible = false; c0.visto = agora; } return; }
      const attrs = Array.isArray(g.fa?.[i]) ? g.fa[i] : null;
      const id = MODELO_SEXO[especie] ? MODELO_SEXO[especie][attrs?.[0] === 1 ? 'M' : 'F'] : especie;
      const prep = modelo(id); if (!prep) return;
      const key = g.id * 64 + i;
      let c = corpos.get(key);
      if (!c || c.prep !== prep) { if (c) c.corpo.descartar(); c = { corpo: new Corpo(prep, (g.s ^ (i * 2654435761)) >>> 0), prep, acc: 0, visto: agora }; corpos.set(key, c); }   // prep guardado: sem ele o corpo era refeito a cada quadro (17/11: piscava e não andava)
      const s = nature.bodies.get(g.id), flags = s ? s.b[1 + i * 5 + 4] | 0 : 0, acao = ACOES_ANIMAL[flags >> 3] || 'parado';
      c.acc += dt;
      const passo = d2 < 400 * fx * fx ? 1 : d2 < LONGE * LONGE * fx * fx ? 2 : 4;   // perto: todo quadro; médio: 1 em 2; longe: 1 em 4
      if (passo === 1 || quadro % passo === key % passo || c.acc > 0.3) { c.corpo.atualizar(c.acc, especie, acao, [x, y, z], rumo, attrs, !!(flags & 4), !!(flags & 2), Array.isArray(attrs?.[4]) ? attrs[4] : null); c.acc = 0; }
      else { c.corpo.raiz.position.set(x, y - (c.corpo.afunda || 0), z); c.corpo.raiz.rotation.y = rumo; }   // a posição anda em todo quadro; só o esqueleto fica espaçado
      if (presenca < 1) c.corpo.raiz.scale.multiplyScalar(Math.max(0.01, presenca));
      c.corpo.raiz.visible = true; c.visto = agora;
    },
    end() { for (const [k, c] of corpos) { if (agora - c.visto > 0.3) c.corpo.raiz.visible = false; if (agora - c.visto > 15) { c.corpo.descartar(); corpos.delete(k); } } },
    dispose() { dead = true; for (const c of corpos.values()) c.corpo.descartar(); corpos.clear(); },
  };
}
export { papeis };
