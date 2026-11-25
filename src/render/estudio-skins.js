import * as THREE from '../three.js';
import { CAMADAS_SKIN } from '../../shared/estudio-skins.js';
import { SKINS_JOGO, reduzirPara64 } from '../../shared/skin-atlas.js';
import { skinParts, skinRects } from './skin-layout.js';
import { vestirExplorador } from './traje-explorador.js';
import { pintarCriador } from './criador-atlas.js';
import { vestirCriador, proporcaoCriador } from './criador-pecas.js';
import { TIPO } from '../world/mc-movimentos.js';

// Compositor da skin (estúdio de skins). Ordem fixa, a mesma em todo aparelho:
//   1. base: a skin do jogo (Explorador, Botânica, Mineiro) ou o PNG enviado ao mundo (formato compatível com o do
//      Minecraft, 64 a 1024 px; braços finos ou clássicos);
//   2. criador: corpo, roupas e rosto pintados por cima (render/criador-atlas.js), quando ligados;
//   3. estampas do estúdio: cor da camisa/jaqueta e imagens no peito, costas e rosto;
//   4. peças 3D: look Explorador (traje-explorador.js) e cabelo/acessórios do criador (criador-pecas.js).
// O atlas final tem sempre 640×640 (o tamanho da skin Kraft): base menor é ampliada sem borrar, maior é reduzida.
export const ATLAS_LADO = 640;
const pending = new WeakMap();
const imagens = new Map();
const urlJogo = (id, slim) => new URL(`../../assets/skin/${id}-${slim ? 'slim' : 'classic'}.png`, import.meta.url).href;

function image(url) {
  if (imagens.has(url)) return imagens.get(url);
  const img = new Image();
  img.src = url;
  const p = img.decode().then(() => img);
  p.catch(() => imagens.delete(url));
  if (imagens.size > 48) imagens.delete(imagens.keys().next().value);
  imagens.set(url, p);
  return p;
}

function paint(ctx, img, layer, rect, S) {
  const [x, y, w, h] = rect.map((n) => n * S);
  const scale = Math.min(w / img.width, h / img.height) * layer.escala;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w * (1 + layer.x) / 2, y + h * (1 + layer.y) / 2);
  ctx.rotate(layer.giro * Math.PI / 180);
  ctx.globalAlpha = layer.opacidade;
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

export function slimDaSkin(skin) {
  return skin?.criador?.corpo ? !!skin.criador.corpo.fino : !!skin?.base?.slim;
}

// Monta o atlas 640×640 da receita. opts.base: um canvas no lugar da base (prévia do pintor);
// opts.semFora: apaga a camada de fora (o pintor pode esconder essa camada). Devolve { canvas, slim } ou null.
export async function comporAtlas(skin, url, opts = {}) {
  const slim = opts.base ? !!opts.slim : slimDaSkin(skin);
  const S = ATLAS_LADO / 64;
  const parts = Object.fromEntries(skinParts(slim).map((p) => [p.name, p]));
  const torso = parts.torso, head = parts.head, arms = [parts.armL, parts.armR];
  const rects = { frente: skinRects(torso.size, torso.base)[5], costas: skinRects(torso.size, torso.base)[4], rosto: skinRects(head.size, head.base)[5] };
  const px = (rect) => rect.map((n) => n * S);
  const fonteBase = opts.base ? Promise.resolve(opts.base)
    : !skin?.base ? image(urlJogo('explorador', slim && !skin?.criador?.corpo ? true : false))
      : SKINS_JOGO.includes(skin.base.id) ? image(urlJogo(skin.base.id, skin.base.slim)) : image(url(skin.base.id));
  const [base, ...imgs] = await Promise.all([
    fonteBase.catch(() => image(urlJogo('explorador', false))),
    ...CAMADAS_SKIN.map((key) => skin?.[key] ? image(url(skin[key].id)).catch(() => null) : null)
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_LADO;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = base.width > ATLAS_LADO;   // 64 px ampliado sem borrar (pixel nítido)
  ctx.drawImage(base, 0, 0, ATLAS_LADO, ATLAS_LADO);
  ctx.imageSmoothingEnabled = true;
  if (skin?.criador) pintarCriador(ctx, skin.criador, slim);
  if (skin?.camisa || skin?.traje?.jaqueta) {
    ctx.fillStyle = skin.camisa || '#465b43';
    for (const rect of skinRects(torso.size, torso.base)) ctx.fillRect(...px(rect));
    for (const rect of skinRects(torso.size, torso.outer)) ctx.clearRect(...px(rect));
  }
  for (const [index, face] of [5, 4].entries()) {
    if (!imgs[index]) continue;
    const outer = px(skinRects(torso.size, torso.outer)[face]);
    if (!skin.camisa && !skin.traje?.jaqueta) ctx.drawImage(canvas, ...outer, ...px(rects[CAMADAS_SKIN[index]]));
    ctx.clearRect(...outer);
  }
  if (skin?.traje?.cabelo) {
    for (const rect of skinRects(head.size, head.outer)) ctx.clearRect(...px(rect));
  } else if (imgs[2]) {
    ctx.clearRect(...px(skinRects(head.size, head.outer)[5]));
  }
  if (skin?.traje?.jaqueta) {
    ctx.fillStyle = skin.camisa || '#465b43';
    for (const arm of arms) {
      for (const rect of skinRects(arm.size, arm.outer)) ctx.clearRect(...px(rect));
      for (const [face, rect] of skinRects(arm.size, arm.base).entries()) {
        if (face === 3) continue;
        const [x, y, w, h] = px(rect);
        ctx.fillRect(x, y, w, face === 2 ? h : h * .7);
      }
    }
  }
  for (const [index, key] of CAMADAS_SKIN.entries()) {
    if (imgs[index]) paint(ctx, imgs[index], skin[key], rects[key], S);
  }
  if (opts.semFora) for (const p of Object.values(parts)) for (const rect of skinRects(p.size, p.outer)) ctx.clearRect(...px(rect));
  return { canvas, slim };
}

// O atlas no formato de 64×64 (para levar a skin a outros jogos compatíveis). Só a pintura: as peças 3D não vão.
export async function atlas64(skin, url, opts) {
  const { canvas, slim } = await comporAtlas(skin, url, opts);
  const dados = canvas.getContext('2d').getImageData(0, 0, ATLAS_LADO, ATLAS_LADO).data;
  const out = document.createElement('canvas');
  out.width = out.height = 64;
  out.getContext('2d').putImageData(new ImageData(reduzirPara64(ATLAS_LADO, dados), 64, 64), 0, 0);
  return { canvas: out, slim };
}

export async function aplicarSkin(body, skin, url, opts = {}) {
  const job = {};
  pending.set(body, job);
  vestirExplorador(body, skin?.traje, skin?.gm);
  vestirCriador(body, skin?.criador);
  proporcaoCriador(body, skin?.criador?.prop);
  if (!skin && !opts.base) {
    body.setSkin(null);
    body.setEfeitosSkin(null);
    return;
  }
  body.setEfeitosSkin(skin?.gm || null);
  const atlas = await comporAtlas(skin, url, opts);
  if (pending.get(body) !== job) return;
  body.setSkin(atlas.canvas, atlas.slim);
}

export function limparSkin(body) {
  pending.delete(body);
}

const pos = new THREE.Vector3();
export function fumacaSkin(body, particulas, dt) {
  const gm = body.efeitosSkin;
  if (!gm?.fumaca || !body.root.visible) return;
  body.proximaFumaca = (body.proximaFumaca || 0) - dt;
  if (body.proximaFumaca > 0) return;
  body.proximaFumaca = .1 + .6 * (1 - gm.fumaca);
  const origin = body.pecasExplorador?.get(gm.regiao)?.meshes[0];
  if (gm.regiao === 'mochila') body.root.localToWorld(pos.set(0, 1.25, .34));
  else if (gm.regiao === 'torso' || gm.regiao === 'jaqueta') body.root.localToWorld(pos.set(0, 1.15, .15));
  else (origin?.parent || body[gm.regiao]).getWorldPosition(pos);
  particulas.soltar(TIPO.fumaca, pos.x, pos.y, pos.z, 0, .42, 0, 1.4, .11, Math.random(), pos.y - 1, .65, .67, .72);
}
