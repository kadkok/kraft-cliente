// Ramos de sustentação da folhagem. Complementam o desenho e a seleção, sem
// alterar os IDs, o centro de massa ou o casco físico de árvores já salvas.
import { hash3 } from './noise.js';
import { leafBranch, leafId } from './trees.js';

const random=(x,y,z,k)=>hash3(x+k*31,y,z)/4294967296;
export function leafCenter(x,y,z){
 return [x+.5+(random(x,y,z,1)-.5)*.24,y+.5+(random(x,y,z,2)-.5)*.22,z+.5+(random(x,y,z,3)-.5)*.24];
}

export function canopySegments(tree,graph,cells,active=null,{reattach=false}={}){
 const groups=new Map(),out=[],allowed=active?new Set(active):null;
 const origin=[tree.x+.5,tree.y+1,tree.z+.5];
 for(const cell of cells){
  const [x,y,z,b]=cell;if(b!==leafId(tree))continue;
  const point=leafCenter(x,y,z).map((v,i)=>v-origin[i]);
  let owner=leafBranch(tree,graph,x,y,z);
  if(allowed&&!allowed.has(owner)){
   if(!reattach||!allowed.size)continue;
   // Um recorte antigo pode ter mantido folhas do nó removido numa peça.
   // Reassentar apenas a aparência dessa peça; nunca reviver galho em pé.
   let best=Infinity;
   for(const id of allowed){
    const s=graph[id];if(!s)continue;
    const d=s.b.map((v,i)=>v-s.a[i]),f=Math.max(0,Math.min(1,d.reduce((sum,v,i)=>sum+v*(point[i]-s.a[i]),0)/(d.reduce((sum,v)=>sum+v*v,0)||1)));
    const distance=point.reduce((sum,v,i)=>sum+(v-s.a[i]-d[i]*f)**2,0);
    if(distance<best){best=distance;owner=id;}
   }
   if(!Number.isFinite(best))continue;
  }
  if(!groups.has(owner))groups.set(owner,[]);
  groups.get(owner).push({cell:[x,y,z],point});
 }
 const emit=(id,a,b,r0,r1,tip=false,cell=null)=>{
  if(Math.hypot(...b.map((v,i)=>v-a[i]))<1e-6)return;
  out.push({id,parent:id,a:a.slice(),b:b.slice(),r0,r1,support:true,tip,cell});
 };
 const trunk=graph[tree.th-1],points=[...groups.values()].flat().sort((a,b)=>a.cell[0]-b.cell[0]||a.cell[1]-b.cell[1]||a.cell[2]-b.cell[2]);
 if(trunk&&points.length&&(!allowed||allowed.has(trunk.id))){
  const top=Math.max(...points.map(p=>p.point[1]));
  if(top>trunk.b[1]+.2){
   const upper=points.filter(p=>p.point[1]>top-.8),center=[0,1,2].map(i=>upper.reduce((sum,p)=>sum+p.point[i],0)/upper.length);
   const end=[center[0]*.28,top-.15,center[2]*.28],mid=end.map((v,i)=>trunk.b[i]+(v-trunk.b[i])*.57);
   emit(trunk.id,trunk.b,mid,trunk.r1,trunk.r1*.43);out.at(-1).leader=true;
   emit(trunk.id,mid,end,trunk.r1*.43,.018);out.at(-1).leader=true;
  }
 }
 for(const [owner,leaves] of [...groups].sort((a,b)=>a[0]-b[0])){
  leaves.sort((a,b)=>a.cell[0]-b.cell[0]||a.cell[1]-b.cell[1]||a.cell[2]-b.cell[2]);
  const base=graph[owner];if(!base)continue;
  function grow(start,list,radius,depth){
   if(list.length===1){emit(owner,start,list[0].point,radius,.009,true,list[0].cell);return;}
   const mean=[0,1,2].map(i=>list.reduce((s,p)=>s+p.point[i],0)/list.length);
   const spread=[0,1,2].map(i=>Math.max(...list.map(p=>p.point[i]))-Math.min(...list.map(p=>p.point[i])));
   const axis=spread.indexOf(Math.max(...spread));
   // Bifurcações desiguais e determinísticas, ligadas à arquitetura do Jev.
   const jitter=hash3(tree.x+owner,depth+list.length,tree.z,0x19a572b1)/4294967296-.5;
   const fork=start.map((v,i)=>v+(mean[i]-v)*(.52+jitter*.16));
   fork[(axis+1)%3]+=jitter*Math.min(.16,spread[axis]*.08);
   const nextRadius=Math.min(radius*.84,.025+Math.sqrt(list.length)*.014);
   emit(owner,start,fork,radius,nextRadius);
   list.sort((a,b)=>a.point[axis]-b.point[axis]||a.cell[1]-b.cell[1]||a.cell[0]-b.cell[0]||a.cell[2]-b.cell[2]);
   const split=Math.ceil(list.length/2);
   for(const part of [list.slice(0,split),list.slice(split)])grow(fork,part,Math.min(nextRadius,.025+Math.sqrt(part.length)*.018),depth+1);
  }
  grow(base.b,leaves,Math.max(.025,Math.min(.13,base.r1)),0);
 }
 return out;
}
