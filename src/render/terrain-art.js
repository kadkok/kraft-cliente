// LAVRA — amostragem dos ladrilhos do terreno e acabamento de areia costeira.
// Toque de areia de coral adaptado de dgreenheck/tidewater (MIT License).
import {TERRAIN_ART} from '../../assets/terrain/data.js';
// Pacote realista (pedido do Kadmus, 15/11/2026): as texturas do Minecraft dele (rotrBLOCKS, Optimum Realism), geradas
// por tools/pacote-realista.py. Vence as fotos de data.js onde existir; para voltar às fotos, REALISTA_LIGADO = false.
import {REALISTA} from '../../assets/terrain/realista.js';
const REALISTA_LIGADO = true;
// Fica com a textura própria do LAVRA mesmo com o pacote ligado. Mármore: o branco com veios que o Kadmus gostava
// ("bloco branco com marcas lindas", 16/11) tinha virado o quartzo do rotrBLOCKS, liso e escuro no jogo.
const SEM_PACOTE = new Set(['marble']);
const doPacote = (name) => REALISTA_LIGADO && !SEM_PACOTE.has(name) && REALISTA[name];
const tileOf = (name) => doPacote(name) || TERRAIN_ART[name];

const cache=new Map();
function bytes(key, b64){
  let raw=cache.get(key);
  if(!raw){const text=atob(b64);raw=new Uint8Array(text.length);for(let i=0;i<text.length;i++)raw[i]=text.charCodeAt(i);cache.set(key,raw);}
  return raw;
}
// reamostra um ladrilho (média quando encolhe, vizinho mais próximo quando cresce) para size×size RGBA
function sample(raw, tileSize, channels, size, out, offset) {
  const step=tileSize/size,n=Math.max(1,Math.floor(step)),samples=n*n;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const p=offset+(y*size+x)*4,sx=Math.floor(x*step),sy=Math.floor(y*step),sum=[0,0,0,0];
    for(let dy=0;dy<n;dy++)for(let dx=0;dx<n;dx++){
      const at=((Math.min(tileSize-1,sy+dy))*tileSize+Math.min(tileSize-1,sx+dx))*channels;
      for(let c=0;c<3;c++)sum[c]+=raw[at+c];sum[3]+=channels===4?raw[at+3]:255;
    }
    for(let c=0;c<4;c++)out[p+c]=Math.round(sum[c]/samples);
  }
}
export function preparedTexture(name,size,out,offset) {
  const tile=tileOf(name);if(!tile)return false;
  sample(bytes('c:'+name,tile.data),tile.size,tile.channels,size,out,offset);
  if (name === 'sand') {
    // Harmoniza o ladrilho base da areia com a paleta quente de areia de coral e micro-ondulações do Tidewater
    const n = size * size;
    for (let i = 0; i < n; i++) {
      const p = offset + i * 4;
      const x = (i % size) / size, y = ((i / size) | 0) / size;
      const rip = Math.sin((y * 6 + Math.sin(x * 6.2832) * 0.22) * 6.2832) * 4.5;
      out[p]     = Math.min(255, Math.max(0, Math.round(out[p] * 0.86 + 34 + rip)));
      out[p + 1] = Math.min(255, Math.max(0, Math.round(out[p + 1] * 0.86 + 29 + rip * 0.85)));
      out[p + 2] = Math.min(255, Math.max(0, Math.round(out[p + 2] * 0.84 + 22 + rip * 0.65)));
    }
  }
  return true;
}
// Mapa de superfície pronto (normal x, normal y, rugosidade, metal), tirado do LabPBR do pacote. false = derivar da cor.
export function preparedSurface(name,size,out,offset) {
  const tile=doPacote(name);if(!tile||!tile.surf)return false;
  sample(bytes('s:'+name,tile.surf),tile.size,4,size,out,offset);
  return true;
}
