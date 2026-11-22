// LAVRA — folha de texturas dos blocos do Minecraft (fases 3 e 4 de docs/plano-blocos-minecraft.md).
// tools/mc/pacote.py grava uma folha PNG por pacote (grade de 32 colunas, RES×RES por textura) e um JSON com a ordem; a
// ordem das camadas é a mesma em todos os pacotes, então trocar de pacote é só trocar a textura U.uMcTex.
// Linha 0 de cada camada = topo da imagem = v 0 do Minecraft (é o que a malha grava em aUv).
import * as THREE from '../three.js';

export const PACOTES_MC = [
  { id: 'realista', nome: 'Realista (o do seu Minecraft)' },
  { id: 'minecraft', nome: 'Minecraft original' },
];

function arranjo(data, res, n) {
  const t = new THREE.DataArrayTexture(data, res, res, n);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;   // uv do Minecraft fica sempre em 0..1: repetir puxava a base da chama para o topo (tracinhos sobre a fogueira)
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
// enquanto a folha não chega: uma camada cinza (o shader sempre tem o que ler)
export function texturaVaziaMc() { return arranjo(new Uint8Array([128, 128, 128, 255]), 1, 1, 1); }

export async function carregarPacoteMc(id = 'realista', res = 64, anisotropia = 1) {
  const base = new URL(`../../assets/mc/pacotes/${id}-${res}`, import.meta.url).href;
  const [info, img] = await Promise.all([
    fetch(base + '.json').then((r) => (r.ok ? r.json() : null)),
    fetch(base + '.png').then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null)),
  ]);
  if (!info || !img) return null;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data;
  const R = info.res, n = info.n, cols = info.cols, out = new Uint8Array(R * R * 4 * n);
  for (let i = 0; i < n; i++) {
    const ox = (i % cols) * R, oy = Math.floor(i / cols) * R;
    for (let y = 0; y < R; y++) {
      const src = ((oy + y) * img.width + ox) * 4;
      out.set(px.subarray(src, src + R * 4), (i * R * R + y * R) * 4);
    }
  }
  const t = arranjo(out, R, n);
  // pixel art pequena (Minecraft original) fica nítida de perto; a realista suaviza
  const nitida = id === 'minecraft';
  t.magFilter = nitida ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = anisotropia;
  return { textura: t, info, dados: out };       // dados: as camadas em RGBA (a paleta desenha os ícones com elas)
}
