import * as THREE from '../three.js';
import { TEX, OPAQUE } from '../../shared/blocks.js';
export { rootSegments } from '../../shared/tree-roots.js';
import { woodId } from '../../shared/trees.js';
import { foliageBuffers, crownShader } from './foliage.js';

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};

// Vários troncos/galhos entram no mesmo lote por chunk; sem mesh por galho.
// fino (prova de realismo): de perto o tronco sai com 14 lados e o galho-mestre com 8
export function woodGeometry(items,detail=2,fino=false){
  const p=[],d=[],norm=[],uv=[],index=[],lightBins=[];
  const vertex=(v,n,u,w,layer,light,cl,face)=>{p.push(...v,layer);d.push(face|24,light,...cl);norm.push(...n);uv.push(u,w);};
  for(const item of items){
    const {segments,offset=[0,0,0],tree,light=15,climate=[130,150]}=item;
    for(const s of segments){
      const start=p.length/4;
      const a=s.a.map((v,i)=>v+offset[i]),b=s.b.map((v,i)=>v+offset[i]),axis=unit(b.map((v,i)=>v-a[i]));
      const right=unit(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),up=cross(right,axis);
      const sides=s.trunk?(detail===0?6:fino&&detail===2?14:8):s.leader?(detail===2?(fino?8:6):4):s.support?(detail===2?4:3):s.root?(detail===2?5:3):(detail===2?6:4),length=Math.hypot(...b.map((v,i)=>v-a[i]));
      const id=woodId(tree),side=TEX[id*6],cap=TEX[id*6+2];
      if(s.support||s.root){
        // Ramos finos e raízes compartilham vértices; juntas internas não
        // precisam de tampas sobrepostas. A armação permanece em todos os LODs.
        const base=p.length/4;
        for(let end=0;end<=1;end++)for(let i=0;i<=sides;i++){
          const angle=i*2*Math.PI/sides,n=right.map((v,j)=>v*Math.cos(angle)+up[j]*Math.sin(angle));
          const center=end?b:a,radius=end?s.r1:s.r0;
          vertex(center.map((v,j)=>v+n[j]*radius),n,i/sides*3,end*length,side,light,climate,0);
        }
        for(let i=0;i<sides;i++){const j=base+i,k=j+sides+1;index.push(j,k,k+1,j,k+1,j+1);}
        lightBins.push({start,count:p.length/4-start,center:a.map((v,i)=>(v+b[i])*.5),sampleUp:s.root?Math.max(s.r0,s.r1)+.12:0});
        continue;
      }
      for(let i=0;i<sides;i++){
        const rad=k=>right.map((v,j)=>v*Math.cos(k*2*Math.PI/sides)+up[j]*Math.sin(k*2*Math.PI/sides));
        const na=rad(i),nb=rad(i+1),base=p.length/4;
        for(const [end,n,u] of [[0,na,i/sides],[1,na,i/sides],[1,nb,(i+1)/sides],[0,nb,(i+1)/sides]]){
          const center=end?b:a,radius=end?s.r1:s.r0,v=center.map((v,j)=>v+n[j]*radius);
          vertex(v,n,u*3,s.trunk?center[1]:end*length,side,light,climate,0);
        }
        index.push(base,base+1,base+2,base,base+2,base+3);
        for(const end of [0,1]){
          const center=end?b:a,radius=end?s.r1:s.r0,n=axis.map(v=>v*(end?1:-1)),base=p.length/4;
          const rim=[na,nb];if(end)rim.reverse();
          vertex(center,n,.5,.5,cap,light,climate,2);
          for(const normal of rim)vertex(center.map((v,j)=>v+normal[j]*radius),n,.5+normal[0]*.5,.5+normal[2]*.5,cap,light,climate,2);
          index.push(base,base+1,base+2);
        }
      }
      lightBins.push({start,count:p.length/4-start,center:a.map((v,i)=>(v+b[i])*.5)});
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('aPos',new THREE.Float32BufferAttribute(p,4));g.setAttribute('aDat',new THREE.Uint8BufferAttribute(d,4));
  g.userData.lightBins=lightBins;
  g.setAttribute('aTreeNormal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('aTreeUv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);
  // Three's automatic bounds require `position`; our packed layout uses aPos.
  const box=new THREE.Box3(),point=new THREE.Vector3();for(let i=0;i<p.length;i+=4)box.expandByPoint(point.set(p[i],p[i+1],p[i+2]));g.boundingBox=box;g.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
  return g;
}

export function treeMaterial(source,leaf=false){
  if(!source)return null;
  const m=source.clone();m.uniforms=source.uniforms;m.name='arvore-'+source.name;
  if(leaf){m.vertexShader=crownShader(source.vertexShader).replace('vN = n;','vN = normalize(mat3(modelMatrix) * n);');}
  else m.vertexShader=source.vertexShader.replace('in vec4 aDat;','in vec4 aDat;\nin vec3 aTreeNormal;\nin vec2 aTreeUv;').replace('vec4 wp = modelMatrix * vec4(p, 1.0);','n = normalize(mat3(modelMatrix) * aTreeNormal); uv = aTreeUv;\n  vec4 wp = modelMatrix * vec4(p, 1.0);');
  m.fragmentShader=m.fragmentShader.replace('vec3 N = vN;','vec3 N = normalize(vN);');return m;
}

export function fallenLeavesGeometry(rec,planes=6,climate=[130,150]){
  if(!rec.leaves.length)return null;
  const pos=[],dat=[];
  for(const [x,y,z,id] of rec.leaves){for(const v of [[x,y+1,z],[x,y+1,z+1],[x+1,y+1,z+1],[x+1,y+1,z]]){pos.push(...v,TEX[id*6+2]);dat.push(2|24,15,...climate);}}
  const out=foliageBuffers(new Float32Array(pos),new Uint8Array(dat),pos.length/4,0,0,planes);
  if(!out)return null;
  const offset=[rec.tree.x+.5+rec.body.com[0],rec.tree.y+1+rec.body.com[1],rec.tree.z+.5+rec.body.com[2]];
  for(let i=0;i<out.pos.length;i+=4)for(let j=0;j<3;j++)out.pos[i+j]-=offset[j];
  for(let i=0;i<out.crown.length;i+=3)for(let j=0;j<3;j++)out.crown[i+j]-=offset[j];
  const g=new THREE.BufferGeometry();g.setAttribute('aPos',new THREE.BufferAttribute(out.pos,4));g.setAttribute('aDat',new THREE.BufferAttribute(out.dat,4));g.setAttribute('aCrown',new THREE.BufferAttribute(out.crown,3));g.setIndex(new THREE.BufferAttribute(out.index,1));
  const bins=[];let last=null;
  for(let i=0;i<out.crown.length/3;i++){
    const center=Array.from(out.crown.subarray(i*3,i*3+3));
    if(last&&center.every((v,j)=>v===last.center[j]))last.count++;
    else{last={start:i,count:1,center};bins.push(last);}
  }
  g.userData.lightBins=bins;
  g.boundingSphere=new THREE.Sphere(new THREE.Vector3(),rec.body.radius+rec.tree.rad+2);return g;
}

export function treeLight(world,x,y,z){
  const bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z);
  let light=world.getLight(bx,by,bz);
  if(OPAQUE[world.getBlock(bx,by,bz)])for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
    const l=world.getLight(bx+dx,by+dy,bz+dz);light=Math.max(light&15,l&15)|(Math.max(light>>4,l>>4)<<4);
  }
  return light;
}
const lightPoint=new THREE.Vector3();
export function relightTreeGeometry(geometry,sample,matrix){
  const dat=geometry.getAttribute('aDat');if(!dat)return;
  let changed=false;
  for(const bin of geometry.userData.lightBins||[]){
    lightPoint.fromArray(bin.center).applyMatrix4(matrix);let light=sample(lightPoint.x,lightPoint.y,lightPoint.z);
    if(bin.sampleUp){
      const exposed=sample(lightPoint.x,lightPoint.y+bin.sampleUp,lightPoint.z);
      light=Math.max(light&15,exposed&15)|(Math.max(light>>4,exposed>>4)<<4);
    }
    if(bin.light===light)continue;bin.light=light;changed=true;
    for(let i=bin.start;i<bin.start+bin.count;i++)dat.array[i*4+1]=light;
  }
  if(changed)dat.needsUpdate=true;
}
