// LAVRA — chuva (19/11/2026; pedido direto do Kadmus ao Claude: "chuva primeiro", com a referência
// camper.rainyworlds.com — o que foi lido dela está em docs/referencia-camper.md).
//
// Três peças, todas só desenho (nada aqui muda o mundo; o tempo continua vindo de game.weather):
//   · riscos: quadradinhos instanciados numa caixa que se dobra em volta de quem olha. Cada gota cai na sua velocidade,
//     o vento a carrega e inclina o risco, e o comprimento é a velocidade × um tempo de exposição (como numa foto);
//   · respingos: anéis que abrem no chão e na água, onde a gota bate, a cada ciclo num ponto diferente;
//   · teto: um mapa de 64 × 64 colunas em volta de quem olha com a altura do que apara a chuva em cada coluna (chão,
//     telhado, copa, água). É por ele que não chove dentro de casa nem debaixo de árvore, e que o respingo nasce na
//     altura certa, inclusive em rampa.
// Tudo é calculado no shader de vértice a partir dos sorteios de cada instância: não há buffer por gota para atualizar.
//
// Liga em todos os perfis, com menos gotas no celular e no visor. `?chuva=0` volta aos pontos da matéria do ar
// (render/materia.js), que este módulo substitui quando está ligado (main.js zera a parcela de chuva de lá).
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import { TETO_N, TIPO, SEM_TOPO, topoDaColuna, indiceNaJanela, bacias as calcularBacias, nivelDasPocas, gotasPara } from '../../shared/chuva.js';

const N = TETO_N;                          // lado do mapa do teto (1 ponto = 1 coluna de 1 m)
const CAIXA = [28, 20, 28];                // caixa dos riscos em volta de quem olha (m)
const LADO = 22;                           // quadrado dos respingos (m)
const VOLTA = 1024;                        // o relógio da chuva dobra a cada tanto (s): mantém a conta exata no shader
// riscos · respingos por perfil
const QUANTOS = { alta: [20000, 2400], media: [8000, 1000], baixa: [4000, 600] };

// ---- teto: o que apara a chuva em cada coluna (as regras estão em shared/chuva.js) -----------------------------------
function criarTeto(world) {
  const dados = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) dados[i * 4] = SEM_TOPO;
  const tex = new THREE.DataTexture(dados, N, N, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  const donoX = new Int32Array(N * N).fill(0x7fffffff), donoZ = new Int32Array(N * N).fill(0x7fffffff);
  // bacias: onde a água da chuva fica (piso plano sem vizinho mais baixo por onde escorrer). Lido com filtro linear
  // pelo shader do terreno (materials.js, "Chão molhado"): a poça recua sozinha na direção de onde a água escoa.
  const bacia = new Uint8Array(N * N);
  const texBacia = new THREE.DataTexture(bacia, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  texBacia.minFilter = texBacia.magFilter = THREE.LinearFilter; texBacia.wrapS = texBacia.wrapT = THREE.RepeatWrapping;
  texBacia.generateMipmaps = false; texBacia.unpackAlignment = 1; texBacia.needsUpdate = true;
  const col = [0, 0, 0, 0];
  let cx0 = 0x7fffffff, cz0 = 0x7fffffff, cursor = 0, sujo = false;

  function gravar(x, z) {
    const i = indiceNaJanela(x, z, N), o = i * 4;
    topoDaColuna(world, x, z, col);
    if (donoX[i] !== x || donoZ[i] !== z || dados[o] !== col[0] || dados[o + 3] !== col[3] || dados[o + 1] !== col[1] || dados[o + 2] !== col[2]) {
      donoX[i] = x; donoZ[i] = z;
      dados[o] = col[0]; dados[o + 1] = col[1]; dados[o + 2] = col[2]; dados[o + 3] = col[3];
      sujo = true;
    }
  }
  // cx, cz = coluna de quem olha. As colunas que entram na janela são lidas na hora; o resto é revisto em rodízio
  // (blocos postos e quebrados, pedaços que chegam), ~1 s para a janela inteira.
  function atualizar(cx, cz, lote) {
    const x0 = cx - N / 2, z0 = cz - N / 2;
    if (cx0 === 0x7fffffff || Math.abs(cx - cx0) >= N / 2 || Math.abs(cz - cz0) >= N / 2) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) gravar(x0 + x, z0 + z);
    } else {
      const dx = cx - cx0, dz = cz - cz0;
      for (let s = 0; s < Math.abs(dx); s++) { const x = dx > 0 ? x0 + N - 1 - s : x0 + s; for (let z = 0; z < N; z++) gravar(x, z0 + z); }
      for (let s = 0; s < Math.abs(dz); s++) { const z = dz > 0 ? z0 + N - 1 - s : z0 + s; for (let x = 0; x < N; x++) gravar(x0 + x, z); }
      for (let i = 0; i < lote; i++) { const c = cursor++ % (N * N); gravar(x0 + (c % N), z0 + ((c / N) | 0)); }
    }
    const andou = cx !== cx0 || cz !== cz0;
    cx0 = cx; cz0 = cz;
    if (sujo || andou) { calcularBacias(dados, x0, z0, bacia, N); texBacia.needsUpdate = true; }   // a borda da janela mudou de lugar
    if (sujo) { tex.needsUpdate = true; sujo = false; }
  }
  // leitura para quem não é shader (sonda): [altura, tipo] da coluna
  function ler(x, z) { const o = indiceNaJanela(x, z, N) * 4; return [dados[o], dados[o + 3]]; }
  return { tex, texBacia, atualizar, ler, ehBacia: (x, z) => bacia[indiceNaJanela(x, z, N)] > 0, limpar() { cx0 = cz0 = 0x7fffffff; } };
}

// ---- shaders ---------------------------------------------------------------------------------------------------------
const TETO_GLSL = /* glsl */`
uniform sampler2D uTeto;
// x = altura do topo no ponto · y = tipo (0 nada · 1 chão duro · 2 copa · 3 água · 4 chão macio)
vec2 tetoEm(vec2 xz) {
  vec4 t = texture(uTeto, (floor(xz) + 0.5) / ${N}.0);
  vec2 f = fract(xz) - 0.5;
  return vec2(t.x + t.y * f.x + t.z * f.y, t.w);
}
`;

const RISCO_VS = /* glsl */`
precision highp float;
in vec2 aQ;            // x = lado (−0,5…0,5) · y = ao longo do risco (0 = ponta de baixo … 1 = a de cima)
in vec4 aS;            // sorteios da gota (0…1)
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uOlho;    // quem olha, no mundo
uniform vec4 uChuva;   // x = quantidade (0…1) · y = relógio (s) · z, w = deriva do vento (m)
uniform vec3 uVento;   // xz = velocidade horizontal das gotas (m/s)
${TETO_GLSL}
out vec2 vQ;
out float vA;
const vec3 CAIXA = vec3(${CAIXA[0]}.0, ${CAIXA[1]}.0, ${CAIXA[2]}.0);
void main() {
  float queda = mix(6.5, 10.5, aS.w);
  vec3 p = aS.xyz * CAIXA;
  p.y -= uChuva.y * queda;
  p.xz += uChuva.zw;
  p = mod(p - uOlho + CAIXA * 0.5, CAIXA) - CAIXA * 0.5 + uOlho;        // a caixa se dobra em volta de quem olha
  vec3 vel = vec3(uVento.x, -queda, uVento.z);
  vec3 eixo = normalize(vel);
  vec3 d = p - uOlho;
  float dist = length(d);
  float longe = smoothstep(2.0, 5.0, dist);
  float comp = length(vel) * mix(0.018, 0.04, fract(aS.x * 13.7 + aS.z * 5.1));   // velocidade × tempo de exposição
  float larg = (mix(0.004, 0.008, fract(aS.y * 9.3 + aS.w * 3.7)) + dist * 0.00025) * mix(1.0, 1.65, longe);
  vec3 lado = normalize(cross(eixo, d) + vec3(1e-5, 0.0, 0.0));
  vec3 w = p - eixo * (comp * (aQ.y - 0.5)) + lado * (larg * aQ.x);
  float sorte = fract(aS.x * 7.31 + aS.z * 3.17 + aS.w * 1.93);
  // muito perto do olho o risco vira um traço grosso atravessando a tela: some antes disso
  float a = step(sorte, uChuva.x) * smoothstep(0.7, 2.2, dist) * (1.0 - smoothstep(9.0, 13.5, dist));
  a *= smoothstep(0.0, 0.12, w.y - tetoEm(p.xz).x);                    // não atravessa chão, telhado nem copa
  a *= mix(0.26, 0.54, fract(aS.y * 5.3 + aS.x * 2.1)) * mix(1.0, 1.45, longe);
  vQ = aQ; vA = a;
  gl_Position = a > 0.003 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const RISCO_FS = /* glsl */`
precision highp float;
${COMMON}
uniform float uClarao;
in vec2 vQ;
in float vA;
out vec4 outColor;
void main() {
  float a = (1.0 - smoothstep(0.06, 0.5, abs(vQ.x))) * smoothstep(0.0, 0.22, vQ.y) * (1.0 - smoothstep(0.65, 1.0, vQ.y)) * vA;
  if (a < 0.004) discard;
  // a gota não tem cor: devolve a claridade do céu (e o clarão do raio)
  vec3 cor = uAmbSky * 1.7 + uSunColor * 0.03 + vec3(0.02 + uClarao * 1.6);
  outColor = vec4(finish(cor), a);
}
`;

const RESPINGO_VS = /* glsl */`
precision highp float;
in vec2 aQ;            // canto do quadradinho (−0,5…0,5), deitado no chão
in vec4 aS;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uOlho;
uniform vec4 uChuva;
${TETO_GLSL}
out vec2 vQ;
out vec4 vK;           // x = fase do anel (0 = bateu … 1 = sumiu) · y = quanto aparece · z = sorteio · w = quanto de anel (chão duro e água: 1)
const float LADO = ${LADO}.0;
float h11(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float t = uChuva.y * mix(0.9, 1.65, aS.z) + aS.w;
  float ciclo = floor(t), fase = min(fract(t) / 0.48, 1.0);
  // a cada ciclo a gota bate noutro lugar
  vec2 c = vec2(h11(aS.x * 91.7 + ciclo * 0.618), h11(aS.y * 57.3 + ciclo * 0.731)) * LADO;
  c = mod(c - uOlho.xz + LADO * 0.5, LADO) - LADO * 0.5 + uOlho.xz;
  vec4 teto = texture(uTeto, (floor(c) + 0.5) / ${N}.0);
  vec2 f = fract(c) - 0.5;
  float raio = mix(0.05, 0.15, fract(aS.x * 3.3 + aS.z * 7.7)) * (0.2 + 0.8 * fase);
  vec2 o = aQ * (2.0 * raio);
  vec3 w = vec3(c.x + o.x, teto.x + teto.y * (f.x + o.x) + teto.z * (f.y + o.y) + 0.015, c.y + o.y);
  float sorte = fract(aS.x * 7.31 + aS.y * 3.17 + aS.w * 1.93);
  float duro = (abs(teto.w - 1.0) < 0.5 || abs(teto.w - 3.0) < 0.5) ? 1.0 : 0.0;
  float chao = max(duro, abs(teto.w - 4.0) < 0.5 ? 1.0 : 0.0);                     // bate em chão e em água; na copa, não
  float a = step(sorte, uChuva.x) * chao * (1.0 - smoothstep(6.0, 11.0, length(c - uOlho.xz))) * (1.0 - smoothstep(8.0, 14.0, abs(w.y - uOlho.y)));
  vQ = aQ; vK = vec4(fase, a, aS.z, mix(0.22, 1.0, duro));
  gl_Position = a > 0.003 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const RESPINGO_FS = /* glsl */`
precision highp float;
${COMMON}
uniform float uClarao;
in vec2 vQ;
in vec4 vK;
out vec4 outColor;
void main() {
  vec2 m = vQ * 2.0;
  float h = length(m), fase = vK.x;
  float anel = smoothstep(0.62, 0.78, h) * (1.0 - smoothstep(0.84, 1.0, h));
  float coroa = smoothstep(-0.35, 0.5, sin(m.x * 21.0 + m.y * 17.0 + vK.z * 6.2832));   // o anel não fecha inteiro
  float miolo = (1.0 - smoothstep(0.0, 0.35, h)) * (1.0 - smoothstep(0.0, 0.25, fase));  // o pingo, no instante em que bate
  float some = (1.0 - fase) * (1.0 - fase);
  float a = (anel * (0.45 + 0.55 * coroa) * 0.55 * vK.w + miolo * 0.8) * some * 0.5 * vK.y;
  if (a < 0.004) discard;
  vec3 cor = uAmbSky * 1.6 + uSunColor * 0.03 + vec3(0.03 + uClarao * 1.4);
  outColor = vec4(finish(cor), a);
}
`;

function sorteios(n, semente) {
  const a = new Float32Array(n * 4);
  let s = semente >>> 0;
  for (let i = 0; i < a.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = ((s >>> 8) & 0xffffff) / 16777216; }
  return a;
}
function lote(n, vs, fs, uniforms, nome, ordem, deitado) {
  const geo = new THREE.InstancedBufferGeometry();
  const q = deitado ? [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5] : [-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1];
  geo.setAttribute('aQ', new THREE.BufferAttribute(new Float32Array(q), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aS', new THREE.InstancedBufferAttribute(sorteios(n, deitado ? 0x9e3779b1 : 0x51ed270b), 4));
  geo.instanceCount = n;
  const mat = new THREE.RawShaderMaterial({
    name: nome, glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = nome; mesh.frustumCulled = false; mesh.renderOrder = ordem; mesh.visible = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

export function initChuva({ scene, world, game, quality, params }) {
  if (params?.get('chuva') === '0') return null;
  const [nRiscos, nRespingos] = QUANTOS[quality.name] || QUANTOS.media;
  const teto = criarTeto(world);
  U.uPocaMapa.value = teto.texBacia;
  const uni = {
    ...U,
    uOlho: { value: new THREE.Vector3() },
    uChuva: { value: new THREE.Vector4(0, 0, 0, 0) },
    uVento: { value: new THREE.Vector3() },
    uTeto: { value: teto.tex },
    uClarao: { value: 0 },
  };
  const riscos = lote(nRiscos, RISCO_VS, RISCO_FS, uni, 'chuva-riscos', 7, false);
  const respingos = lote(nRespingos, RESPINGO_VS, RESPINGO_FS, uni, 'chuva-respingos', 5, true);
  scene.add(riscos, respingos);

  const anterior = world.listeners.reset;
  world.listeners.reset = (...a) => { anterior?.(...a); teto.limpar(); };

  const estado = { dona: true, quantidade: 0, pocas: 0, enxurrada: 0, riscos: nRiscos, respingos: nRespingos };
  let relogio = 0, dx = 0, dz = 0, primeira = true;
  // cam = posição de quem olha · lugar = retrato do lugar feito em main.js (debaixo d'água, Zona…)
  function update(dt, cam, lugar) {
    const w = game.weather;
    const chove = game.dim === 0 && !lugar?.underwater && w ? Math.max(0, Math.min(1, w.rain || 0)) : 0;
    const alvo = gotasPara(chove);
    estado.quantidade += (alvo - estado.quantidade) * Math.min(1, dt * 1.5);
    // poças (materials.js, trecho "Chão molhado"): enchem em ~40 s de chuva firme e levam uns 3 min para secar. Quem
    // entra no meio da chuva já as encontra cheias.
    if (primeira && w) { primeira = false; if (chove > 0.3) estado.pocas = 0.85; }
    estado.pocas = nivelDasPocas(estado.pocas, chove, dt);
    // enxurrada: no temporal a água corre pelas rampas e as poças transbordam (materials.js); some devagar depois dele
    estado.enxurrada += ((w && w.kind === 'temporal' && chove > 0.5 ? 1 : 0) - estado.enxurrada) * Math.min(1, dt * (w && w.kind === 'temporal' ? 0.12 : 0.03));
    U.uPoca.value.set(game.dim === 0 ? estado.pocas : 0, estado.quantidade, game.dim === 0 ? estado.enxurrada : 0, 0);
    const liga = estado.quantidade > 0.01;
    riscos.visible = respingos.visible = liga;
    if (!liga) return estado;
    // a gota anda de lado um pouco menos que o vento (ela vem de cima, onde ele é mais forte, mas tem peso)
    const vx = Math.max(-15, Math.min(15, (w.wind?.[0] || 0) * 0.55)), vz = Math.max(-15, Math.min(15, (w.wind?.[1] || 0) * 0.55));
    relogio = (relogio + dt) % VOLTA;
    dx = (dx + vx * dt) % CAIXA[0]; dz = (dz + vz * dt) % CAIXA[2];
    uni.uOlho.value.copy(cam);
    uni.uChuva.value.set(estado.quantidade, relogio, dx, dz);
    uni.uVento.value.set(vx, 0, vz);
    uni.uClarao.value = w.flash || 0;
    teto.atualizar(Math.floor(cam.x), Math.floor(cam.z), 96);
    return estado;
  }
  return { update, estado, teto, riscos, respingos, dispose() { scene.remove(riscos, respingos); teto.tex.dispose(); } };
}
