// LAVRA — campo de voxels em volta da câmera, na GPU: a fundação da "luz de perto".
//
// Uma caixa de blocos (padrão 128 × 64 × 128) centrada na câmera vira uma textura 3D de um byte por voxel (o id do
// bloco). Um shader que cole VOXEL_GLSL consegue então perguntar "o que há na célula p?" e percorrer a grade com um
// raio (DDA de Amanatides & Woo, o mesmo de world/raycast.js), para reflexo, sombra de contato e luz que bate e volta.
//
// Estratégia de foco: só se traça raio perto de quem olha. voxelFocus(d) dá o peso (1 perto, 0 a partir de uVoxRange);
// quem escrever um efeito multiplica por ele e não traça nada quando o peso é zero. Longe fica o que já existe hoje.
//
// Custo na CPU: refazer = copiar a caixa inteira do mundo (world.readRegion). Só acontece ao recentrar (a câmera saiu
// da região central), quando o mundo é trocado, ou quando chegam pedaços novos (no máximo uma vez a cada 0,5 s).
// Mudança de um bloco só troca um byte da cópia e reenvia a textura (no máximo um envio por update).
// Desenho e roteiro dos efeitos: docs/luz-de-perto.md.

import * as THREE from '../three.js';
import { OPAQUE, EMIT, KIND, TEX } from '../../shared/blocks.js';
import { Y_TOP } from '../../shared/constants.js';

export const PROPS_WIDTH = 128;   // colunas da textura de propriedades (uma por id de bloco; blocks.js reserva 128)
const REBUILD_GAP_MS = 500;       // intervalo mínimo entre refazer por causa de pedaços que chegam
const SLACK_XZ = 16, SLACK_Y = 8; // a câmera pode se afastar isto do centro antes de recentrar

// Origem (canto mínimo) da caixa para uma câmera em (cx, cy, cz): múltiplo de 16 em x/z e de 8 em y, com a câmera perto
// do centro. Em y a caixa fica dentro da altura do mundo [fundo, Y_TOP) quando cabe: abaixo do fundo do plano só haveria
// rocha-mãe e acima do topo só ar, bytes desperdiçados. `fundo` = world.fundo (−64 no plano de cima desde a profundidade
// em dobro, 19/11; 0 nos outros planos). Escreve em `out` (array de 3) e o devolve.
export function voxelFieldOrigin(cx, cy, cz, size, out = [0, 0, 0], fundo = 0) {
  // (+ 0 troca o -0 de Math.round por 0)
  out[0] = Math.round((cx - size[0] / 2) / 16) * 16 + 0;
  out[2] = Math.round((cz - size[2] / 2) / 16) * 16 + 0;
  let oy = Math.round((cy - size[1] / 2) / 8) * 8;
  if (size[1] <= Y_TOP - fundo) oy = Math.min(Math.max(oy, fundo), fundo + Math.floor((Y_TOP - fundo - size[1]) / 8) * 8);
  out[1] = oy + 0;
  return out;
}

// A câmera saiu da região central da caixa que começa em `origin`? (mais de 16 blocos do centro em x/z ou 8 em y)
export function voxelFieldOutside(cx, cy, cz, origin, size) {
  return Math.abs(cx - (origin[0] + size[0] / 2)) > SLACK_XZ
    || Math.abs(cy - (origin[1] + size[1] / 2)) > SLACK_Y
    || Math.abs(cz - (origin[2] + size[2] / 2)) > SLACK_XZ;
}

// RGBA8: opacidade, emissão, tipo, 255. Mantém a textura original 128×1.
export function buildVoxelProps(out = new Uint8Array(PROPS_WIDTH * 4)) {
  for (let id = 0; id < PROPS_WIDTH; id++) {
    const o = id * 4;
    out[o] = OPAQUE[id] ? 255 : 0;
    out[o + 1] = Math.round((EMIT[id] / 15) * 255);
    out[o + 2] = KIND[id];
    out[o + 3] = 255;
  }
  return out;
}

// Tabela visual separada: seis camadas de textura, um byte por face. A segunda
// linha contém +Z/-Z. Não altera a ABI da tabela que os outros consumidores usam.
export function buildVoxelFaces(out = new Uint8Array(PROPS_WIDTH * 4 * 2)) {
  for (let id=0; id<PROPS_WIDTH; id++) for (let face=0; face<6; face++)
    out[PROPS_WIDTH*4*(face>>2)+id*4+(face&3)] = TEX[id*6+face];
  return out;
}

export function createVoxelField({ world, size = [128, 64, 128], range = 40, now = () => performance.now() }) {
  const sx = size[0] | 0, sy = size[1] | 0, sz = size[2] | 0;
  if (sx % 16 || sz % 16 || sy % 8 || sx <= 0 || sy <= 0 || sz <= 0) throw new Error('voxelfield: size precisa ser múltiplo de 16 em x/z e de 8 em y');
  const dims = [sx, sy, sz];
  const sxy = sx * sy;
  const data = new Uint8Array(sx * sy * sz);
  const shapeData = new Uint8Array(data.length*2);
  for(let i=0;i<shapeData.length;i+=2)shapeData[i]=15;
  const shapes = new THREE.Data3DTexture(shapeData,sx,sy,sz);
  shapes.name='campo-voxel-formas';shapes.format=THREE.RGFormat;shapes.type=THREE.UnsignedByteType;
  shapes.minFilter=shapes.magFilter=THREE.NearestFilter;shapes.generateMipmaps=false;shapes.unpackAlignment=1;

  const texture = new THREE.Data3DTexture(data, sx, sy, sz);
  texture.name = 'campo-voxel';
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;

  const propData = buildVoxelProps();
  const props = new THREE.DataTexture(propData, PROPS_WIDTH, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  props.name = 'campo-voxel-props';
  props.minFilter = props.magFilter = THREE.NearestFilter;
  props.generateMipmaps = false;
  props.unpackAlignment = 1;
  props.needsUpdate = true;
  const faces = new THREE.DataTexture(buildVoxelFaces(), PROPS_WIDTH, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  faces.name = 'campo-voxel-faces';
  faces.minFilter = faces.magFilter = THREE.NearestFilter;
  faces.generateMipmaps = false;
  faces.unpackAlignment = 1;
  faces.needsUpdate = true;

  const origin = [0, 0, 0];
  const target = [0, 0, 0];
  const uniforms = {
    uVox: { value: texture },
    uVoxShapes: { value: shapes },
    uVoxProps: { value: props },
    uVoxFaces: { value: faces },
    uVoxOrigin: { value: new THREE.Vector3() },
    uVoxSize: { value: new THREE.Vector3(sx, sy, sz) },
    uVoxRange: { value: range },
  };
  const stats = { rebuilds: 0, uploads: 0, shapeUploads:0, lastMs: 0, missing: 0, edits: 0 };

  let placed = false;          // já existe uma caixa (a primeira update a cria)
  let mustRebuild = true;      // refazer na próxima update, sem esperar
  let chunkPending = false;    // chegou pedaço novo dentro da caixa: refazer quando o intervalo permitir
  let lastRebuildAt = -Infinity;
  let dirty = false;           // a cópia da CPU mudou e ainda não subiu
  let alive = true;
  let shapePending = false, lastShapesAt = -Infinity;

  function inBox(x, y, z) {
    return x >= origin[0] && x < origin[0] + sx && y >= origin[1] && y < origin[1] + sy && z >= origin[2] && z < origin[2] + sz;
  }

  // ---- ouvintes do mundo (slots únicos: encadeia com quem já estava lá) --------------------------------------------
  const L = world.listeners;
  const prev = { block: L.block, chunk: L.chunk, surface:L.surface, reset: L.reset };
  const onBlock = (x, y, z, id) => {
    if (prev.block) prev.block(x, y, z, id);
    if (!alive || !placed || !inBox(x, y, z)) return;
    const i = (x - origin[0]) + (y - origin[1]) * sx + (z - origin[2]) * sxy;
    if (data[i] === id) return;
    data[i] = id;
    dirty = true;
    stats.edits++;
  };
  const onChunk = (cx, cz) => {
    if (prev.chunk) prev.chunk(cx, cz);
    if (!alive || !placed) return;
    const x0 = cx * 16, z0 = cz * 16;
    if (x0 < origin[0] + sx && x0 + 16 > origin[0] && z0 < origin[2] + sz && z0 + 16 > origin[2]) chunkPending = true;
  };
  const onReset = () => {
    if (prev.reset) prev.reset();
    if (!alive) return;
    mustRebuild = true;
    chunkPending = false;
  };
  const onSurface=(cx,cz)=>{
    if(prev.surface)prev.surface(cx,cz);
    if(!alive||!placed)return;
    if(cx*16<origin[0]+sx&&cx*16+16>origin[0]&&cz*16<origin[2]+sz&&cz*16+16>origin[2])shapePending=true;
  };
  L.block = onBlock;
  L.chunk = onChunk;
  L.reset = onReset;
  L.surface = onSurface;

  function rebuildShapes(t){
    if(world.readSurfaceRegion)world.readSurfaceRegion(...origin,sx,sy,sz,shapeData);
    shapes.needsUpdate=true;stats.shapeUploads++;shapePending=false;lastShapesAt=t;
  }

  function rebuild(t) {
    const t0 = performance.now();
    stats.missing = world.readRegion(origin[0], origin[1], origin[2], sx, sy, sz, data);
    rebuildShapes(t);
    uniforms.uVoxOrigin.value.set(origin[0], origin[1], origin[2]);
    stats.rebuilds++;
    stats.lastMs = performance.now() - t0;
    lastRebuildAt = t;
    mustRebuild = false;
    chunkPending = false;
    dirty = true;
  }

  // cam: THREE.Vector3 (ou qualquer {x, y, z}) da câmera. Devolve true se marcou a textura para envio.
  function update(cam) {
    if (!alive) return false;
    const t = now();
    if (!placed || voxelFieldOutside(cam.x, cam.y, cam.z, origin, dims)) {
      voxelFieldOrigin(cam.x, cam.y, cam.z, dims, target, Number.isFinite(world.fundo) ? world.fundo : 0);
      if (!placed || target[0] !== origin[0] || target[1] !== origin[1] || target[2] !== origin[2]) {
        origin[0] = target[0]; origin[1] = target[1]; origin[2] = target[2];
        placed = true;
        mustRebuild = true;
      }
    }
    if (mustRebuild || (chunkPending && t - lastRebuildAt >= REBUILD_GAP_MS)) rebuild(t);
    const shapeUpload=shapePending&&t-lastShapesAt>=REBUILD_GAP_MS;
    if(shapeUpload)rebuildShapes(t);
    if (!dirty) return !!shapeUpload;
    dirty = false;
    texture.needsUpdate = true;   // um envio só, por maior que tenha sido a mudança
    stats.uploads++;
    return true;
  }

  function sample(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (!placed || !inBox(x, y, z)) return 0;
    return data[(x - origin[0]) + (y - origin[1]) * sx + (z - origin[2]) * sxy];
  }

  function invalidate() { mustRebuild = true; }
  function sampleShape(x,y,z){
    x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
    if(!placed||!inBox(x,y,z))return 15;
    const i=2*((x-origin[0])+(y-origin[1])*sx+(z-origin[2])*sxy);
    return shapeData[i]+shapeData[i+1]*256;
  }

  function dispose() {
    if (!alive) return;
    alive = false;
    // Se ninguém se encadeou depois de nós, devolve o slot a quem estava antes; senão o nosso vira só repasse.
    if (L.block === onBlock) L.block = prev.block;
    if (L.chunk === onChunk) L.chunk = prev.chunk;
    if (L.reset === onReset) L.reset = prev.reset;
    if (L.surface === onSurface) L.surface = prev.surface;
    texture.dispose();
    props.dispose();
    faces.dispose();
    shapes.dispose();
  }

  return { texture, props, uniforms, update, sample, sampleShape, invalidate, dispose, stats, origin, size: dims, data };
}

// GLSL ES 3.00 para colar em qualquer fragment shader do projeto (quem cola já tem #version e precision).
export const VOXEL_GLSL = /* glsl */`
// ---- campo de voxels (render/voxelfield.js) ----
uniform highp sampler3D uVox;        // id do bloco, um texel por bloco (R8: id/255)
uniform highp sampler3D uVoxShapes;  // forma calculada pelo worker (RG8, low/high)
uniform highp sampler2D uVoxProps;   // 128×1: opacidade/emissão/tipo
uniform vec3 uVoxOrigin;             // canto mínimo da caixa, em blocos do mundo (inteiros)
uniform vec3 uVoxSize;               // tamanho da caixa em blocos
uniform float uVoxRange;             // alcance útil em metros (estratégia de foco)

// id do bloco na célula do MUNDO p; 0 (ar) fora da caixa. Coordenadas em highp: em GPU móvel o int padrão
// do fragment shader é mediump (16 bits na prática), curto para coordenada de mundo.
int voxelAt(highp ivec3 p) {
  highp ivec3 q = p - ivec3(floor(uVoxOrigin + 0.5));
  if (any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, ivec3(uVoxSize)))) return 0;
  return int(texelFetch(uVox, q, 0).r * 255.0 + 0.5);
}
vec4 voxelProps(int id) { return texelFetch(uVoxProps, ivec2(id, 0), 0); }
bool voxelSolid(int id) { return id != 0 && voxelProps(id).r > 0.5; }       // barra a luz?
float voxelEmit(int id) { return voxelProps(id).g; }                         // 0..1 (= EMIT/15)
int voxelKind(int id) { return int(voxelProps(id).b * 255.0 + 0.5); }       // K_* de blocks.js

int voxelShape(highp ivec3 cell) {
  highp ivec3 q=cell-ivec3(floor(uVoxOrigin+.5));
  if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(q,ivec3(uVoxSize))))return 15;
  vec2 s=floor(texelFetch(uVoxShapes,q,0).rg*255.0+.5);
  return int(s.x)+int(s.y)*256;
}
int voxelSurfaceId(int id,vec3 p,vec3 n){
  highp ivec3 cell=ivec3(floor(p-n*.002));
  if(n.y>.001&&voxelShape(cell)!=15&&voxelShape(cell+ivec3(0,1,0))!=15)return voxelAt(cell+ivec3(0,1,0));
  return id;
}
void voxelHeights(int shape,out vec4 h,out float center){
  if(shape>=16){
    int code=shape-16,peak=code>>8;
    h=vec4(float(code&3),float((code>>2)&3),float((code>>4)&3),float((code>>6)&3))-1.0;
    float d0=abs(h.x-h.z),d1=abs(h.y-h.w),m0=(h.x+h.z)*.5,m1=(h.y+h.w)*.5;
    center=peak>0?float(peak):(d0<d1?m0:d1<d0?m1:min(m0,m1));
  }else{
    h=vec4(float(shape&1),float((shape>>1)&1),float((shape>>2)&1),float((shape>>3)&1));
    float count=dot(h,vec4(1));
    center=count==0.0||count>=3.0||shape==5||shape==10?1.0:count==1.0?0.0:.5;
  }
}
vec3 voxelCorner(int i,vec4 h){
  return vec3(i==1||i==2?1.0:0.0,h[i],i>=2?1.0:0.0);
}
// Entrada sólida ou interseção real com o leque de quatro planos da rampa.
// O DDA continua percorrendo as células; só um candidato parcial usa este teste.
bool voxelRampHit(int shape,highp ivec3 cell,vec3 ro,vec3 rd,float enter,float leave,inout float t,inout vec3 n){
  vec4 h;float center;voxelHeights(shape,h,center);
  vec3 origin=ro-vec3(cell),p=origin+rd*(enter+.00001),mid=vec3(.5,center,.5);
  int fan=p.z<=p.x?(p.z<=1.0-p.x?0:1):(p.z<=1.0-p.x?3:2);
  vec3 a=voxelCorner(fan,h),c=voxelCorner((fan+1)&3,h),normal=cross(mid-a,c-a);
  float height=a.y-(normal.x*(p.x-a.x)+normal.z*(p.z-a.z))/normal.y;
  if(p.y<clamp(height,0.0,1.0)-.000001){t=enter;return true;}
  float best=leave+.000001;bool hit=false;
  for(int i=0;i<4;i++){
    vec3 va=voxelCorner(i,h),e1=mid-va,e2=voxelCorner((i+1)&3,h)-va;
    if(max(center,max(h[i],h[(i+1)&3]))<=0.0)continue; // fan sem volume, omitido pela malha
    vec3 crossD=cross(rd,e2);float det=dot(e1,crossD);
    if(abs(det)<1e-7)continue;
    vec3 s=origin-va;float u=dot(s,crossD)/det;vec3 q=cross(s,e1);float v=dot(rd,q)/det;
    float tt=dot(e2,q)/det,yy=origin.y+rd.y*tt;
    if(u>=-.000001&&v>=-.000001&&u+v<=1.000001&&tt>=enter-.000001&&tt<=best&&yy>=0.0&&yy<=1.0){
      best=max(enter,tt);n=normalize(cross(e1,e2));hit=true;
    }
  }
  if(hit)t=best;
  return hit;
}

// Peso da estratégia de foco: 1 perto, cai suavemente entre 60% e 100% do alcance, 0 além dele.
// Alcance zero = não há campo neste quadro (VR, mundo ainda abrindo): peso 0, e quem chama não traça nada.
float voxelFocus(float distToCamera) {
  if (uVoxRange <= 0.0) return 0.0;
  return 1.0 - smoothstep(0.6 * uVoxRange, uVoxRange, distToCamera);
}

// Percorre a grade a partir de ro (mundo) na direção rd (normalizada) até maxDist ou até sair da caixa.
// Para no primeiro bloco que barra a luz: t = distância ao longo do raio, n = normal da face atingida, id = bloco.
// Mesma regra de passo e de desempate de world/raycast.js. Se ro começa dentro de um bloco sólido, essa primeira
// célula é pulada (o raio que sai de uma superfície não bate nela mesma). No máximo 96 células.
bool traceVoxels(vec3 ro, vec3 rd, float maxDist, out float t, out vec3 n, out int id) {
  t = 0.0; n = vec3(0.0); id = 0;
  // componente nula vira um número minúsculo com sinal: a travessia nesse eixo fica "infinitamente" longe
  vec3 d = vec3(abs(rd.x) < 1e-7 ? 1e-7 : rd.x, abs(rd.y) < 1e-7 ? 1e-7 : rd.y, abs(rd.z) < 1e-7 ? 1e-7 : rd.z);
  vec3 inv = 1.0 / d;
  // recorte do raio pela caixa (método das placas): [tIn, tOut]
  vec3 ta = (uVoxOrigin - ro) * inv, tb = (uVoxOrigin + uVoxSize - ro) * inv;
  vec3 tmn = min(ta, tb), tmx = max(ta, tb);
  float tIn = max(max(tmn.x, tmn.y), tmn.z);
  float tOut = min(min(tmx.x, tmx.y), tmx.z);
  float tEnd = min(maxDist, tOut);
  float t0 = max(tIn, 0.0);
  if (t0 > tEnd) return false;

  highp ivec3 stp = ivec3(d.x > 0.0 ? 1 : -1, d.y > 0.0 ? 1 : -1, d.z > 0.0 ? 1 : -1);
  vec3 fs = vec3(stp);
  // célula de partida: a que contém o ponto de entrada (empurrado um fio para dentro), presa à caixa
  vec3 p0 = ro + d * (t0 + (tIn > 0.0 ? 1e-4 : 0.0));
  highp ivec3 lo = ivec3(floor(uVoxOrigin + 0.5));
  highp ivec3 cell = clamp(ivec3(floor(p0)), lo, lo + ivec3(uVoxSize) - 1);
  vec3 tDelta = abs(inv);
  // distância (desde ro) até a próxima fronteira de célula em cada eixo
  vec3 tMax = (vec3(cell) + max(fs, 0.0) - ro) * inv;
  float tc = t0;
  vec3 nrm = vec3(0.0);
  if (tIn > 0.0) nrm = tIn == tmn.x ? vec3(-fs.x, 0.0, 0.0) : tIn == tmn.y ? vec3(0.0, -fs.y, 0.0) : vec3(0.0, 0.0, -fs.z);
  bool skipFirst = tIn <= 0.0 && voxelSolid(voxelAt(cell)) && voxelShape(cell)==15;

  for (int i = 0; i < 96; i++) {
    if (i > 0 || !skipFirst) {
      int v = voxelAt(cell);
      // A maior parte do caminho é ar. Não buscar propriedades (nem recorte) para
      // uma célula vazia; nos outros casos compartilhar uma única leitura.
      if (v != 0) {
        vec4 properties = voxelProps(v);
        bool hit = properties.r > .5;
#ifdef VOXEL_CUTOUT
        // Somente o consumidor visual pede recorte. Entrada e saída podem ser
        // visíveis (DoubleSide); a callback exclui faces internas como o mesher.
        if (!hit && int(properties.b*255.0+.5) == 2) {
          hit = dot(nrm,nrm) > .5 && voxelCutoutHit(v, ro + rd * tc, nrm);
          if (!hit) {
            float exitT; vec3 exitN;
            if (tMax.x < tMax.y && tMax.x < tMax.z) { exitT=tMax.x; exitN=vec3(fs.x,0,0); }
            else if (tMax.y < tMax.z) { exitT=tMax.y; exitN=vec3(0,fs.y,0); }
            else { exitT=tMax.z; exitN=vec3(0,0,fs.z); }
            if (exitT <= tEnd && voxelCutoutHit(v, ro + rd*exitT, exitN)) {
              t=exitT; n=exitN; id=v; return true;
            }
          }
        }
#endif
        if (hit) {
          int shape=voxelShape(cell);t=tc;n=nrm;
          if(shape!=15)hit=voxelRampHit(shape,cell,ro,rd,tc,min(tEnd,min(tMax.x,min(tMax.y,tMax.z))),t,n);
          if(hit&&i==0&&tc==0.0&&dot(n,n)<.5)hit=false; // origem dentro do próprio terreno
          if(hit){id=v;return true;}
        }
      }
    }
    if (tMax.x < tMax.y && tMax.x < tMax.z) { tc = tMax.x; cell.x += stp.x; tMax.x += tDelta.x; nrm = vec3(-fs.x, 0.0, 0.0); }
    else if (tMax.y < tMax.z)               { tc = tMax.y; cell.y += stp.y; tMax.y += tDelta.y; nrm = vec3(0.0, -fs.y, 0.0); }
    else                                    { tc = tMax.z; cell.z += stp.z; tMax.z += tDelta.z; nrm = vec3(0.0, 0.0, -fs.z); }
    if (tc > tEnd) return false;
  }
  return false;
}
// ---- fim do campo de voxels ----
`;
