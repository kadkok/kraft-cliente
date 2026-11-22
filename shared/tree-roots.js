// Geometria de raízes compartilhada pela renderização e validação de alcance.
import { hash3 } from './noise.js';
import { B, SOLID } from './blocks.js';
import { isTreeWood } from './trees.js';
import { shapeHeight } from './surfaces.js';

export function rootSegments(t,seed,ground){
  const result=[],r=i=>hash3(t.x,i,t.z,seed^0x25461b21)/4294967296;
  for(let i=0;i<6;i++){
    const a=(i+r(i)*.35)*Math.PI/3,dx=Math.cos(a),dz=Math.sin(a),reach=.85+r(i+9)*.45;
    const height=d=>ground(t.x+.5+dx*d,t.z+.5+dz*d)-(t.y+1);
    const first=height(.36);if(!Number.isFinite(first))continue;
    const samples=[[.36,first]],steps=Math.ceil((reach-.36)/.12);
    // Refinar quinas/dobras; o centro do braço fica ligeiramente enterrado.
    // Uma borda sem apoio encerra a raiz, em vez de inventar solo no ar.
    function between(a,b,depth=0){
      const d=(a[0]+b[0])*.5,h=height(d);
      if(!Number.isFinite(h))return false;
      if(depth<10&&Math.abs(h-(a[1]+b[1])*.5)>.025)return between(a,[d,h],depth+1)&&between([d,h],b,depth+1);
      samples.push(b);return true;
    }
    for(let k=1;k<=steps;k++){
      const d=.36+(reach-.36)*k/steps,h=height(d),prev=samples.at(-1);
      if(!Number.isFinite(h))break;
      if(!between(prev,[d,h]))break;
    }
    const end=samples.at(-1)[0];let prev=[dx*.10,.68,dz*.10],radius=.29;
    for(let k=0;k<samples.length;k++){
      const [d,h]=samples[k],f=(d-.36)/Math.max(.01,end-.36),tip=k===samples.length-1;
      const next=[dx*d,h-(tip?.12:.04),dz*d],nextRadius=.025+.205*(1-f);
      result.push({id:0,a:prev,b:next,r0:radius,r1:nextRadius,root:true,tip});prev=next;radius=nextRadius;
    }
  }
  return result;
}

// O cache pertence a uma reconstrução, nunca a um quadro ou a um mundo salvo.
export function sampleRootGround(get,shape,x,z,from,cache){
 const bx=Math.floor(x),bz=Math.floor(z),key=bx+','+from+','+bz;
 let layers=cache?.get(key);
 if(!layers){
  layers=[];
  for(let y=Math.floor(from)+2;y>=from-8;y--){
   const b=get(bx,y,bz);if(b===-1)break;
   if(b>0&&SOLID[b]&&!isTreeWood(b)&&b!==B.LEAVES&&b!==B.PINE_LEAVES)layers.push([y,shape?.(bx,y,bz)??15]);
  }
  cache?.set(key,layers);
 }
 for(const [y,s] of layers){const h=shapeHeight(s,x-bx,z-bz);if(h>1e-7)return y+h;}
 return NaN;
}
