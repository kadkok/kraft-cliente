// LAVRA — no visor, material padrão do three (bicho, planta, ferramenta) também fica jateado.
// O uniforme é o mesmo uHeadset dos shaders do terreno: 0 fora do VR, e a imagem do PC não muda.

import { U } from './materials.js';

const FEITOS = new WeakSet();

function injetar(shader) {
  shader.uniforms.uHeadset = U.uHeadset;
  // declarar o uniforme (sem isto o shader não compila e o objeto some: bola, jogadores e plateia sumiram no VR, 18/11)
  if (!/uniform\s+float\s+uHeadset\b/.test(shader.fragmentShader)) shader.fragmentShader = 'uniform float uHeadset;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       {
         vec3 wpos = (inverse(viewMatrix) * vec4(vViewPosition, 1.0)).xyz;
         vec3 q = wpos * 380.0;
         float n = fract(sin(dot(floor(q), vec3(127.1, 311.7, 74.7))) * 43758.5453);
         float fw = max(fwidth(q.x), 1e-4);
         float k = uHeadset * (1.0 - smoothstep(0.5, 1.6, fw));
         diffuseColor.rgb *= mix(1.0, 0.86 + 0.14 * n, k);
       }`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       roughnessFactor = mix(roughnessFactor, 0.94, 0.92 * uHeadset);`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
       metalnessFactor *= mix(1.0, 0.2, uHeadset);`,
    );
}

export function aplicarFosco(raiz) {
  if (!raiz) return;
  raiz.traverse((o) => {
    const lista = o.material == null ? [] : (Array.isArray(o.material) ? o.material : [o.material]);
    for (const mat of lista) {
      if (!mat || FEITOS.has(mat) || !mat.isMeshStandardMaterial) continue;
      FEITOS.add(mat);
      const antes = mat.onBeforeCompile;
      const chave = mat.customProgramCacheKey;
      mat.onBeforeCompile = function (shader, renderer) {
        if (antes) antes.call(this, shader, renderer);
        injetar(shader);
      };
      mat.customProgramCacheKey = function () {
        const base = chave ? chave.call(this) : '';
        return base + '|jateado';
      };
      mat.needsUpdate = true;
    }
  });
}
