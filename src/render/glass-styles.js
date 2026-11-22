// Acabamentos por camada: um shader e uma malha, sem materiais por bloco.
import {GLASS_TEXTURES,TEX_INDEX} from '../../shared/blocks.js';

export const GLASS_STYLES = [
  {f0:.04,absorb:.012,body:[.85,.92,.91],coat:[1,1,1],rough:.11,icon:[.82,.92,.97]},
  {f0:.055,absorb:.58,body:[.015,.018,.02],coat:[.95,.97,1],rough:.11,icon:[.22,.25,.27]},
  {f0:.20,absorb:.40,body:[1,.55,.08],coat:[1,.70,.15],rough:.12,icon:[.76,.56,.21]},
  {f0:.32,absorb:.12,body:[.57,.63,.68],coat:[.88,.93,1],rough:.095,icon:[.72,.76,.8]},
  {f0:.94,absorb:0,body:[0,0,0],coat:[.98,.99,1],rough:.045,opaque:true,icon:[.84,.9,.95]},
  {f0:.05,absorb:.30,body:[.035,.18,.65],coat:[.76,.88,1],rough:.11,icon:[.18,.4,.74]},
  {f0:.04,absorb:.46,body:[1,.035,.045],coat:[1,.65,.65],rough:.11,icon:[.74,.18,.21]},
];
const f=n=>n.toFixed(6),v=a=>`vec3(${a.map(f).join(',')})`;
export const GLASS_STYLE_GLSL = /* glsl */`
void glassStyle(float layer,out float f0,out float absorb,out vec3 body,out vec3 coat,out float rough,out float opaque) {
  f0=.04;absorb=.012;body=vec3(.85,.92,.91);coat=vec3(1.0);rough=.11;opaque=0.0;
  ${GLASS_STYLES.slice(1).map((s,i)=>`${i?'else ':''}if(abs(layer-${f(TEX_INDEX[GLASS_TEXTURES[i+1]])})<.5){f0=${f(s.f0)};absorb=${f(s.absorb)};body=${v(s.body)};coat=${v(s.coat)};rough=${f(s.rough)};opaque=${s.opaque?'1.0':'0.0'};}`).join('\n  ')}
}
`;
