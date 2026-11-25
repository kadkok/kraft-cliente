// LAVRA — cáusticas de verdade: a luz do sol concentrada pelas ondas, calculada por refração (24/11/2026).
// Pedido direto do Kadmus ao Claude, com a referência "Abyssal Garden" (~/Downloads/index (1).html): "a transparência
// e os reflexos solares na água não ficaram realistas como deveriam". É a técnica daquele arquivo, passada para WebGL2:
//
//   uma grade de pontos da superfície é levada, pela refração de 12 ondas, até um plano abaixo dela; onde a grade
//   aperta, a luz se concentra (1 / |J|, J = quanto a área de cada pedacinho encolheu). Tudo é somado numa textura
//   pequena, borrada um pouco, com as versões reduzidas (para longe não chiar). As ondas têm número de onda inteiro:
//   a textura repete sem emenda e pode ser ladrilhada pelo mundo.
//
// Custo: ~74 mil triângulos minúsculos numa textura de 512 px + um borrão, por quadro (no visor e no celular, grade
// e textura menores e uma atualização a cada dois quadros). Nada de CPU.
//
// Para quem desenha: U.uCaust (sampler2D, canal r; média ~1, picos até ~6) e o trecho GLSL CAUSTICA_GLSL abaixo
// (causticaDoMar(ponto do mundo, distância até quem olha) → fator ≥ 0 para multiplicar a luz DIRETA do sol).
import * as THREE from '../three.js';

// número de onda (x, z) em ciclos por ladrilho e o sentido em que cada onda anda (as mesmas 12 da referência)
const ONDAS = [[1, 2, 1], [2, -1, -1], [-2, 3, 1], [3, 1, -1], [1, -4, 1], [4, 2, 1], [-3, -3, -1], [5, -1, 1], [2, 5, -1], [-5, 3, 1], [6, 1, -1], [1, -6, 1]];
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)));

const GRADE_VS = /* glsl */`
precision highp float;
in vec2 position;                 // 0..1 na grade
uniform float uT, uFundo;        // instante (s) e a distância, em ladrilhos, entre a superfície e o plano iluminado
out float vLuz;
const vec3 CK[${ONDAS.length}] = vec3[](${ONDAS.map((o) => `vec3(${f(o[0])}, ${f(o[1])}, ${f(o[2])})`).join(', ')});
void main() {
  // a grade cobre um pouco além do ladrilho: a luz que os vizinhos mandam para dentro também é somada
  vec2 p = position * 1.3 - 0.15;
  vec2 g = vec2(0.0); float hxx = 0.0, hzz = 0.0, hxz = 0.0;
  for (int i = 0; i < ${ONDAS.length}; i++) {
    vec2 k = CK[i].xy * 6.28318;
    float kl = length(CK[i].xy), a = 0.0125 * pow(kl, -1.55);
    float ph = dot(k, p) + CK[i].z * (0.55 + 0.42 * sqrt(kl)) * uT + float(i) * 2.4;
    float s = sin(ph), c = cos(ph);
    g -= a * k * s;
    hxx -= a * k.x * k.x * c; hzz -= a * k.y * k.y * c; hxz -= a * k.x * k.y * c;
  }
  vec2 d = p - uFundo * g;                       // onde o raio refratado toca o plano
  float J = (1.0 - uFundo * hxx) * (1.0 - uFundo * hzz) - (uFundo * hxz) * (uFundo * hxz);
  vLuz = 1.0 / max(abs(J), 0.07);
  gl_Position = vec4(d * 2.0 - 1.0, 0.0, 1.0);
}
`;
const GRADE_FS = /* glsl */`
precision highp float;
in float vLuz;
uniform float uGanho;
out vec4 outColor;
void main() { outColor = vec4(vLuz * uGanho, 0.0, 0.0, 1.0); }
`;
const QUADRO_VS = /* glsl */`
precision highp float;
in vec2 position;
out vec2 vUv;
void main() { vUv = position; gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0); }
`;
// borrão pequeno (3 × 3 com pesos 4-2-1), com a textura repetindo: tira a marca dos triângulos sem apagar os fios
const BORRAO_FS = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D uOrigem;
uniform float uPasso;
out vec4 outColor;
void main() {
  float s = texture(uOrigem, vUv).r * 0.25;
  vec2 t = vec2(uPasso, 0.0);
  s += (texture(uOrigem, vUv + t.xy).r + texture(uOrigem, vUv - t.xy).r + texture(uOrigem, vUv + t.yx).r + texture(uOrigem, vUv - t.yx).r) * 0.125;
  s += (texture(uOrigem, vUv + t.xx).r + texture(uOrigem, vUv - t.xx).r + texture(uOrigem, vUv + vec2(uPasso, -uPasso)).r + texture(uOrigem, vUv + vec2(-uPasso, uPasso)).r) * 0.0625;
  outColor = vec4(s, 0.0, 0.0, 1.0);
}
`;

// Trecho GLSL para quem recebe a luz. Precisa de: uniform sampler2D uCaust; uniform vec3 uLightDir, cameraPosition.
// nivel = altura da superfície da água sobre o ponto. Devolve ~1 em média (1 = luz do sol sem ondas).
export const CAUSTICA_GLSL = /* glsl */`
float causticaDoMar(vec3 wp, float nivel, float dist) {
  float fundura = max(nivel - wp.y, 0.0);
  // de que ponto da superfície veio o raio de sol que chega aqui (o desenho anda com o sol, como a sombra)
  vec2 q = wp.xz + uLightDir.xz * (fundura / max(uLightDir.y, 0.25));
  float a = texture(uCaust, q / 11.0).r;
  vec2 r = vec2(q.x * -0.504846 - q.y * 0.863209, q.x * 0.863209 + q.y * -0.504846);      // a mesma malha, girada 2,1 rad
  float b = texture(uCaust, r / 19.03 + vec2(0.37, 0.61)).r;
  float c = min(a, b) * 1.55 + 0.12 * (a + b);
  // rente à superfície a água ainda não juntou a luz; fundo demais os fios se desfazem; longe some (vira a média)
  float k = smoothstep(0.0, 1.2, fundura) * mix(1.0, 0.45, clamp(fundura / 55.0, 0.0, 1.0)) * (1.0 - smoothstep(55.0, 110.0, dist));
  return mix(1.0, c, k);
}
`;

export function createCausticas(renderer, { lado = 512, grade = 192, cadaQuadros = 1 } = {}) {
  const meio = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  // sem alvo de meio-real (aparelho antigo): 8 bits com o ganho baixo; os picos saturam em ~6 vezes a média
  const tipo = meio ? THREE.HalfFloatType : THREE.UnsignedByteType, ganho = meio ? 1 : 1 / 6;
  const opcoes = { format: THREE.RGBAFormat, type: tipo, depthBuffer: false, stencilBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false };
  const bruto = new THREE.WebGLRenderTarget(lado, lado, opcoes);
  const pronto = new THREE.WebGLRenderTarget(lado, lado, { ...opcoes, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
  pronto.texture.name = 'causticas'; pronto.texture.anisotropy = 4;

  // grade de (grade + 1)² pontos, dois triângulos por quadrado
  const n = grade + 1, pos = new Float32Array(n * n * 2), idx = new Uint32Array(grade * grade * 6);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { pos[k++] = i / grade; pos[k++] = j / grade; }
  for (let j = 0, k = 0; j < grade; j++) for (let i = 0; i < grade; i++) {
    const a = i + j * n, b = a + 1, c = a + n, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const geoGrade = new THREE.BufferGeometry();
  geoGrade.setAttribute('position', new THREE.BufferAttribute(pos, 2));
  geoGrade.setIndex(new THREE.BufferAttribute(idx, 1));
  geoGrade.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);      // posição de 2 números: o three não sabe medir
  const matGrade = new THREE.RawShaderMaterial({ name: 'causticas-grade', glslVersion: THREE.GLSL3, vertexShader: GRADE_VS, fragmentShader: GRADE_FS,
    uniforms: { uT: { value: 0 }, uFundo: { value: 0.36 }, uGanho: { value: ganho } },
    depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const malhaGrade = new THREE.Mesh(geoGrade, matGrade); malhaGrade.frustumCulled = false;
  const cenaGrade = new THREE.Scene(); cenaGrade.add(malhaGrade);

  const geoQuadro = new THREE.BufferGeometry();
  geoQuadro.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));   // um triângulo que cobre a tela
  geoQuadro.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const matBorrao = new THREE.RawShaderMaterial({ name: 'causticas-borrao', glslVersion: THREE.GLSL3, vertexShader: QUADRO_VS, fragmentShader: BORRAO_FS,
    uniforms: { uOrigem: { value: bruto.texture }, uPasso: { value: 1 / lado } }, depthTest: false, depthWrite: false });
  const malhaQuadro = new THREE.Mesh(geoQuadro, matBorrao); malhaQuadro.frustumCulled = false;
  const cenaBorrao = new THREE.Scene(); cenaBorrao.add(malhaQuadro);
  const camera = new THREE.Camera();
  const cor = new THREE.Color();
  let quadro = 0;

  return {
    texture: pronto.texture,
    alvo: pronto,            // para conferência (sonda): renderer.readRenderTargetPixels(alvo, …)
    meio,
    // t = instante do mar (s). Só redesenha quando alguém vai usar (quem chama decide) e, no aparelho fraco, a cada N quadros.
    update(t) {
      if (quadro++ % cadaQuadros) return;
      const alvo = renderer.getRenderTarget(), xr = renderer.xr.enabled, autoClear = renderer.autoClear;
      const alfa = renderer.getClearAlpha(); renderer.getClearColor(cor);
      renderer.xr.enabled = false; renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      matGrade.uniforms.uT.value = t;
      renderer.setRenderTarget(bruto); renderer.render(cenaGrade, camera);
      renderer.setRenderTarget(pronto); renderer.render(cenaBorrao, camera);
      renderer.setRenderTarget(alvo);
      renderer.setClearColor(cor, alfa); renderer.autoClear = autoClear; renderer.xr.enabled = xr;
    },
    dispose() { bruto.dispose(); pronto.dispose(); geoGrade.dispose(); geoQuadro.dispose(); matGrade.dispose(); matBorrao.dispose(); },
  };
}
