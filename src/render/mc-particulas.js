// LAVRA — partículas dos blocos do Minecraft (fumaça da fogueira, chama da vela, folha caindo, gota, esporo, portal…).
// Pedido direto do Kadmus ao Claude em 16/11/2026 ("importe todos os motions do minecraft"); docs/movimentos-minecraft.md.
//
// CONTRATO (para quem desenha — o Astra pode trocar o desenho sem mexer na lógica):
//   quem decide ONDE e QUANDO nasce cada partícula é world/mc-movimentos.js; aqui só se desenha e se move.
//   soltar(tipo, x, y, z, vx, vy, vz, vida, tam, semente, chao, r, g, b, extra, ceu, bloco)
//     tipo   um de TIPO (abaixo) · x, y, z onde nasce (metros) · vx, vy, vz velocidade (m/s; no portal e no glifo é o
//            deslocamento até o alvo) · vida em segundos · tam em metros · semente 0..1 (variação de cada uma)
//     chao   altura onde ela pousa (gota, folha, brasa, esporo caindo) · r, g, b cor · extra: na gota, os segundos
//            pendurada antes de cair; nas que brilham, a força do brilho · ceu, bloco: luz do lugar em 0..1
//   O movimento de cada tipo é uma conta fechada do tempo no vertex shader (a CPU só escreve no nascimento).
//   As formas são provisórias e feitas por conta (nenhuma imagem de terceiros): disco macio, gota de chama, lâmina de folha…
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
export { TIPO } from '../world/mc-movimentos.js';     // os números dos tipos (o shader abaixo usa os mesmos)

const VS = /* glsl */`
precision highp float;
in vec3 position;
in vec4 aOrigem, aVel, aDado, aCor;
in vec2 aLuz;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uMcT;
uniform vec2 uMcVento;
out vec2 vQ;
out vec4 vCor;
out vec2 vLuz;
out vec3 vMundo;
out float vIdade, vSem, vPousou;
flat out int vTipo;
void main() {
  float idade = uMcT - aOrigem.w, vida = max(aVel.w, 0.001);
  int tipo = int(aDado.x + 0.5);
  float tam = aDado.y, sem = aDado.z, chao = aDado.w;
  float u = clamp(idade / vida, 0.0, 1.0), t = max(idade, 0.0);
  vec3 p = aOrigem.xyz, v = aVel.xyz, vento = vec3(uMcVento.x, 0.0, uMcVento.y);
  float esc = 1.0, giro = 0.0, pousou = 0.0;
  vec2 forma = vec2(1.0);
  if (tipo <= 2) {                                    // fumaças: sobem, abrem, ondulam e o vento leva
    float leva = tipo == 2 ? 0.30 : 0.18;
    p += v * t + vento * leva * t * t / (t + 2.5);
    p.x += sin(t * 0.9 + sem * 6.28) * 0.14 * t / (1.0 + t);
    p.z += cos(t * 0.7 + sem * 4.1) * 0.14 * t / (1.0 + t);
    esc = tipo == 2 ? 0.55 + 1.2 * u : 0.5 + 1.0 * sqrt(u);
    giro = sem * 6.28 + t * (sem - 0.5) * 0.7;
  } else if (tipo == 3) {                             // chama: sobe um fio e encolhe
    p += v * t + vec3(0.0, 0.05 * t, 0.0);
    esc = 1.0 - 0.55 * u * u;
    forma = vec2(0.75, 1.2);
  } else if (tipo == 4) {                             // brasa: arco com gravidade até o chão
    vec3 q = p + v * t + vec3(0.0, -5.0 * t * t, 0.0);
    if (q.y <= chao) { q.y = chao; pousou = 1.0; }
    p = q; esc = 1.0 - 0.6 * u;
  } else if (tipo == 5) {                             // gota: incha pendurada, cai, e some no chão
    float pend = aCor.w;
    float tq = max(0.0, t - pend);
    p.y -= 6.0 * tq * tq;
    if (p.y <= chao) { p.y = chao; pousou = 1.0; }
    esc = t < pend ? 0.55 + 0.45 * (t / max(pend, 0.01)) : 1.0;
    forma = t < pend ? vec2(1.0, 1.0) : vec2(0.75, 1.35);
  } else if (tipo == 6) {                             // folha: desce rodando e balançando; o vento leva
    float y = p.y - v.y * t;
    p.x += sin(t * 2.1 + sem * 6.0) * 0.35 + vento.x * 0.12 * t;
    p.z += cos(t * 1.6 + sem * 4.0) * 0.35 + vento.z * 0.12 * t;
    if (y <= chao) { y = chao; pousou = 1.0; }
    p.y = y;
    giro = pousou > 0.5 ? sem * 6.28 : sem * 6.28 + t * (1.5 + sem * 2.0);
    forma = vec2(0.45 + 0.55 * abs(cos(t * 3.1 + sem * 5.0)), 1.0);
  } else if (tipo == 7) {                             // esporo no ar: vagueia devagar
    p += v * t + vec3(sin(t * 0.7 + sem * 9.0), sin(t * 0.5 + sem * 5.0) * 0.6, cos(t * 0.6 + sem * 7.0)) * 0.35;
  } else if (tipo == 8) {                             // esporo caindo
    p.y = max(p.y - 0.28 * t, chao);
    p.x += sin(t * 1.3 + sem * 6.0) * 0.08;
  } else if (tipo == 9) {                             // portal: fica longe e é puxado para o bloco, subindo
    float k = 1.0 - u * u;
    p += v * k + vec3(0.0, 0.8 * u, 0.0);
    esc = 0.6 + 0.4 * k;
  } else if (tipo == 10) {                            // portal ao contrário: sobe da âncora
    p += v * t + vec3(sin(t * 3.0 + sem * 6.0) * 0.05, 0.25 * t, cos(t * 2.0 + sem * 3.0) * 0.05);
    esc = 1.0 - 0.5 * u;
  } else if (tipo == 11) {                            // faísca da barra do End: solta, freia e desce um pouco
    p += v * (1.0 - exp(-t * 1.5)) / 1.5 + vec3(0.0, -0.05 * t * t, 0.0);
    esc = 1.0 - 0.4 * u;
  } else if (tipo == 12) {                            // glifo: voa da estante até o livro, num arco
    float k = u * u * (3.0 - 2.0 * u);
    p += v * k + vec3(0.0, 0.7 * sin(u * 3.14159), 0.0);
    esc = 1.0 - 0.5 * u;
  } else if (tipo == 13) {                            // poeira de redstone: sobe um tico e encolhe
    p += v * t + vec3(0.0, 0.12 * t, 0.0);
    esc = 1.0 - 0.6 * u;
  } else if (tipo == 14) {                            // vagalume: passeia em volta de onde nasceu
    p += vec3(sin(t * 0.37 + sem * 7.0) * 1.3, sin(t * 0.53 + sem * 3.0) * 0.55, cos(t * 0.31 + sem * 5.0) * 1.3);
  } else if (tipo == 15) {                            // bolha: sobe (ou desce rodando, no redemoinho)
    p.y += v.y * t;
    float rodo = v.y < 0.0 ? 0.28 : 0.04;
    p.xz += vec2(cos(t * 5.0 + sem * 6.28), sin(t * 5.0 + sem * 6.28)) * rodo;
  } else {                                            // nota: sobe balançando
    p += vec3(sin(t * 2.0 + sem * 6.0) * 0.1, 0.7 * t, 0.0);
  }
  vec3 dir = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 cima = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(giro), s = sin(giro);
  vec2 q = position.xy * forma;
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec3 w = p + (dir * q.x + cima * q.y) * tam * esc;
  vQ = position.xy * 2.0;
  vCor = aCor; vLuz = aLuz; vMundo = w; vIdade = u; vSem = sem; vTipo = tipo; vPousou = pousou;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (idade < 0.0 || idade >= vida) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FS = /* glsl */`
precision highp float;
uniform sampler2D uNoise;
uniform vec3 cameraPosition;
${COMMON}
in vec2 vQ;
in vec4 vCor;
in vec2 vLuz;
in vec3 vMundo;
in float vIdade, vSem, vPousou;
flat in int vTipo;
out vec4 outColor;
float aparece(float a, float b) { return smoothstep(0.0, a, vIdade) * (1.0 - smoothstep(b, 1.0, vIdade)); }
void main() {
  float r = length(vQ), a = 0.0, brilho = 0.0;
  vec3 c = vCor.rgb;
  int k = vTipo;
  if (k <= 2) {                                       // fumaça: nuvem macia (cai como gaussiana), recortada pelo ruído
    float n = texture(uNoise, vQ * 0.16 + vec2(vSem * 7.3, vSem * 3.1)).r;
    float rr = r + (n - 0.5) * 0.45;
    a = exp(-3.2 * rr * rr) * smoothstep(1.0, 0.75, r);
    a *= k == 2 ? aparece(0.08, 0.45) * 0.42 : k == 1 ? aparece(0.08, 0.35) * 0.6 : aparece(0.1, 0.35) * 0.5;
    c *= 0.8 + 0.3 * n;
  } else if (k == 3) {                                // chama: gota acesa, miolo claro
    float y = vQ.y, lg = 0.62 * (1.0 - smoothstep(-0.7, 1.0, y)) + 0.06;
    a = smoothstep(lg, lg * 0.45, abs(vQ.x)) * smoothstep(1.0, 0.75, y) * smoothstep(-1.0, -0.72, y);
    float miolo = clamp(1.0 - abs(vQ.x) / lg, 0.0, 1.0) * (1.0 - smoothstep(-0.2, 0.9, y));
    c = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.93, 0.62), miolo * miolo) * c;
    brilho = 2.4;
  } else if (k == 4 || k == 11 || k == 9 || k == 10 || k == 12 || k == 14) {   // pontos que brilham
    float f = k == 14 ? 0.55 + 0.45 * sin(vIdade * 40.0 + vSem * 20.0) : k == 11 ? 0.7 + 0.3 * step(0.5, fract(vIdade * 13.0 + vSem)) : 1.0;
    a = smoothstep(1.0, 0.0, r);
    a = a * a * f * aparece(0.08, 0.6);
    if (k == 4) a *= vPousou > 0.5 ? 0.5 : 1.0;
    brilho = vCor.w > 0.0 ? vCor.w : 1.8;
  } else if (k == 5) {                                // gota
    a = smoothstep(1.0, 0.7, r) * (vPousou > 0.5 ? 0.0 : 0.92);
    c *= 0.85 + 0.35 * smoothstep(0.6, -0.4, vQ.x + vQ.y);
  } else if (k == 6) {                                // folha: lâmina com ponta e nervura
    float lg = (1.0 - vQ.y * vQ.y) * 0.62;
    a = step(abs(vQ.x), lg) * step(abs(vQ.y), 0.98);
    c *= 0.88 + 0.18 * (1.0 - smoothstep(0.0, 0.1, abs(vQ.x)));
    a *= aparece(0.03, 0.85);
  } else if (k == 7 || k == 8 || k == 13) {           // esporos e poeira
    a = smoothstep(1.0, 0.3, r) * aparece(0.15, 0.6);
    if (k == 13) brilho = 1.2;
  } else if (k == 15) {                               // bolha: anel
    a = smoothstep(0.55, 0.8, r) * smoothstep(1.0, 0.85, r) * 0.85 + smoothstep(0.35, 0.0, length(vQ - vec2(-0.3, 0.35))) * 0.6;
    a *= aparece(0.05, 0.8);
  } else {                                            // nota
    a = smoothstep(1.0, 0.6, r) * aparece(0.1, 0.6);
    brilho = 1.3;
  }
  if (a < 0.01) discard;
  if (brilho > 0.0) c *= brilho;
  else {
    float ceu = vLuz.x * vLuz.x, blq = vLuz.y * vLuz.y;
    if (k <= 2) blq *= 1.0 - smoothstep(0.0, 0.45, vIdade);    // a fumaça sobe e sai da luz do fogo onde nasceu
    vec3 luz = mix(uAmbGround, uAmbSky, 0.7) * max(ceu, uMinAmb) + uSunColor * ceu * 0.35 + uTorch * blq;
    c *= luz;
  }
  vec3 olho = cameraPosition - vMundo;
  vec4 nevoa = fogAt(length(olho), -normalize(olho), vMundo.y);
  outColor = vec4(finish(mix(c, nevoa.rgb, nevoa.a)), a);
}
`;

const DIM = { aOrigem: 4, aVel: 4, aDado: 4, aCor: 4, aLuz: 2 };

export function criarParticulasMc(scene, quality = {}) {
  const capacidade = quality.name === 'baixa' ? 768 : quality.name === 'media' ? 2048 : 4096;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const at = {};
  for (const [nome, n] of Object.entries(DIM)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacidade * n), n);
    a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(nome, a); at[nome] = a;
  }
  geo.instanceCount = 0;
  const uniforms = { ...U, uMcT: { value: 0 }, uMcVento: { value: new THREE.Vector2() } };
  const material = new THREE.RawShaderMaterial({
    name: 'particulas-minecraft', glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const malha = new THREE.Mesh(geo, material);
  malha.name = 'particulas-minecraft'; malha.frustumCulled = false; malha.visible = false; malha.renderOrder = 2;
  scene.add(malha);
  const fim = new Float64Array(capacidade);
  let cursor = 0, t = 0, sujoDe = -1, sujoAte = -1, ativas = 0, soltas = 0;

  function soltar(tipo, x, y, z, vx, vy, vz, vida, tam, semente, chao, r, g, b, extra = 0, ceu = 1, bloco = 0) {
    const i = cursor; cursor = (cursor + 1) % capacidade;
    at.aOrigem.array.set([x, y, z, t], i * 4);
    at.aVel.array.set([vx, vy, vz, vida], i * 4);
    at.aDado.array.set([tipo, tam, semente, chao], i * 4);
    at.aCor.array.set([r, g, b, extra], i * 4);
    at.aLuz.array.set([ceu, bloco], i * 2);
    fim[i] = t + vida; soltas++;
    if (sujoDe < 0) { sujoDe = sujoAte = i; } else if (i < sujoDe) { sujoDe = 0; sujoAte = capacidade - 1; } else sujoAte = Math.max(sujoAte, i);
  }
  function update(dt, vento) {
    t += dt;
    uniforms.uMcT.value = t;
    if (vento) uniforms.uMcVento.value.set(vento[0] || 0, vento[1] || 0);
    let fimAtivo = 0; ativas = 0;
    for (let i = 0; i < capacidade; i++) if (fim[i] > t) { ativas++; fimAtivo = i + 1; }
    geo.instanceCount = fimAtivo;
    malha.visible = ativas > 0;
    if (sujoDe >= 0) {
      for (const [nome, n] of Object.entries(DIM)) {
        const a = at[nome];
        a.clearUpdateRanges(); a.addUpdateRange(sujoDe * n, (sujoAte - sujoDe + 1) * n); a.needsUpdate = true;
      }
      sujoDe = sujoAte = -1;
    }
  }
  function limpar() { fim.fill(0); geo.instanceCount = 0; malha.visible = false; }
  return { soltar, update, limpar, malha, capacidade, get tempo() { return t; }, get ativas() { return ativas; }, get soltas() { return soltas; } };
}
