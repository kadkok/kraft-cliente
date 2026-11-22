import * as THREE from '../three.js';
import { B } from '../../shared/blocks.js';
import { FallingTrees, DRY_SECONDS, leafWorld } from '../../shared/falling-trees.js';
import { isTreeWood,woodId,rootId,ownedTreeCells } from '../../shared/trees.js';
import { canopySegments } from '../../shared/tree-canopy.js';
import { sampleRootGround } from '../../shared/tree-roots.js';
import { newState,toWorld,syncRotation } from '../machines/physics.js';
import { woodGeometry,treeMaterial,fallenLeavesGeometry,rootSegments,treeLight,relightTreeGeometry } from '../render/tree-geometry.js';
import { pivo } from '../../shared/rebrota.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>a.map((v,i)=>v-b[i]);
function closestSegments(a,b,c,d){
 const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),Bv=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-Bv*Bv;
 let s=den>1e-9?Math.max(0,Math.min(1,(Bv*E-C*D)/den)):0;
 let t=C?Math.max(0,Math.min(1,(Bv*s+E)/C)):0;
 s=A?Math.max(0,Math.min(1,(Bv*t-D)/A)):0;t=C?Math.max(0,Math.min(1,(Bv*s+E)/C)):0;
 return [a.map((q,i)=>q+u[i]*s),c.map((q,i)=>q+v[i]*t),t];
}
function raySegment(o,d,a,b,r0,r1,reach){
 const end=o.map((v,i)=>v+d[i]*reach),[p,q,t]=closestSegments(o,end,a,b),r=r0+(r1-r0)*t;
 const dist=Math.hypot(...sub(p,q));if(dist>r)return Infinity;
 return Math.max(0,Math.hypot(...sub(p,o))-Math.sqrt(Math.max(0,r*r-dist*dist)));
}
const chunkKey=c=>c.cx+','+c.cz;
function nearSegment(point,s,radius){
 const limit=radius+Math.max(s.r0,s.r1);let distance=0;
 for(let i=0;i<3;i++){
   const d=Math.max(0,Math.min(s.a[i],s.b[i])-point[i],point[i]-Math.max(s.a[i],s.b[i]));
   distance+=d*d;if(distance>limit*limit)return false;
 }
 return true;
}

export function initTrees(ctx){
 const {game,world,player,net,scene,materials,quality,input,ui,interaction,store}=ctx;
 const staticRoot=new THREE.Group(),fallRoot=new THREE.Group(),plantRoot=new THREE.Group();staticRoot.name='arvores-enraizadas';fallRoot.name='arvores-caidas';plantRoot.name='arvores-plantadas';scene.add(staticRoot,fallRoot,plantRoot);
 const mats={wood:treeMaterial(materials.opaque),woodDepth:treeMaterial(materials.depthOpaque),leaf:treeMaterial(materials.cutout,true),leafDepth:treeMaterial(materials.depthCutout,true)};
 const chunks=new Map(),fallen=new Map(),dirty=new Map(),treesCache=new Map(),pendingFallen=new Set(),plantViews=new Map(),pendingPlant=new Set();
 const stats={trees:0,branches:0,fallen:0,buildMs:0,maxBuildMs:0,builds:0,totalBuildMs:0,pending:0,source:'tabelas'};
 let forest=null,worldGen=null,lastCell='',cooldown=0,placeCooldown=0,saveT=0,offlineDirty=false,lightCursor=0,lightT=0,streamT=0,forestEpoch=0;
 const sampleLight=(x,y,z)=>treeLight(world,x,y,z);
 function relight(root){root.updateMatrixWorld(true);root.traverse(o=>{if(o.geometry)relightTreeGeometry(o.geometry,sampleLight,o.matrixWorld);});}
 const highlight=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color:0xffe3a6,transparent:true,opacity:.7,depthWrite:false}));highlight.visible=false;scene.add(highlight);
 const temp=new THREE.Vector3(),fromQ=new THREE.Quaternion(),toQ=new THREE.Quaternion();
 function removeMesh(m){m?.parent?.remove(m);m?.geometry?.dispose();}
 function clear(){for(const item of chunks.values())removeMesh(item.mesh);chunks.clear();for(const view of fallen.values())view.root.traverse(o=>o.geometry?.dispose());fallRoot.clear();fallen.clear();pendingFallen.clear();for(const v of plantViews.values())v.root.traverse(o=>o.geometry?.dispose());plantRoot.clear();plantViews.clear();pendingPlant.clear();dirty.clear();treesCache.clear();stats.trees=stats.branches=stats.fallen=stats.plantas=0;}
 function getTree(x,y,z){
   if(!game.gen?.treeAt||game.dim!==0)return null;const k=x+','+z;
   let t=treesCache.get(k);if(t===undefined){t=game.gen.treeAt(Math.floor(x/5),Math.floor(z/5));if(!t||t.kind===3||t.kind===5||t.x!==x||t.z!==z)t=null;if(treesCache.size>=8192)treesCache.delete(treesCache.keys().next().value);treesCache.set(k,t);}
   return t&&y>=t.y+1&&y<t.y+1+t.th?t:null;
 }
 function ownsWood(x,y,z){const t=getTree(x,y,z);return !!t&&isTreeWood(world.getBlock(x,y,z))&&!world.isEdited(x,y,z);}
 const groundCache=new Map();
 function ground(x,z,from){return sampleRootGround(world.getBlock,world.getShape,x,z,from,groundCache);}
 function climate(t){const a=new Float32Array(1),b=new Float32Array(1);game.gen.climateGrid(t.x,t.z,1,a,b);return [Math.max(0,Math.min(255,Math.round((a[0]-game.gen.lapse(t.y))*255))),Math.round(b[0]*255)];}
 function lod(c){const dist=Math.hypot(c.cx*16+8-player.pos[0],c.cz*16+8-player.pos[2]);return dist<(quality.name==='baixa'?24:44)?2:dist<80?1:0;}
 function buildChunk(c){
   const key=chunkKey(c),old=chunks.get(key);if(old){removeMesh(old.mesh);stats.trees-=old.list.length;stats.branches-=old.branches;chunks.delete(key);}
   if(!forest||game.dim!==0||!c.vox||!game.gen?.treesNear||!c.hasMesh)return;
   const start=performance.now(),detail=lod(c),reuse=old?.revision===c.rev&&old.epoch===forestEpoch;
   const items=reuse?old.items:[],list=reuse?old.list:[];let branches=reuse?old.branches:0;groundCache.clear();
   for(const t of reuse?[]:game.gen.treesNear(c.cx*16+7.5,c.cz*16+7.5,12)){
     if((t.x>>4)!==c.cx||(t.z>>4)!==c.cz)continue;
     const graph=forest.graph(t),active=forest.active(t,graph),ids=new Set(active);
     const structural=graph.filter(s=>ids.has(s.id)&&(!s.trunk||!world.isEdited(t.x,t.y+1+s.id,t.z)));
     if(!structural.length)continue;
     const roots=ids.has(0)&&!world.isEdited(t.x,t.y+1,t.z)?rootSegments(t,game.seed,(x,z)=>ground(x,z,t.y+1)):[];
     const leaves=ownedTreeCells(game.gen,t,world.getBlock,world.isEdited).filter(c=>!isTreeWood(c[3]));
     const canopy=canopySegments(t,graph,leaves,active);
     const draw=[...structural,...roots,...canopy];
     if(!draw.length)continue;
     items.push({tree:t,segments:draw,offset:[t.x+.5-c.cx*16,t.y+1,t.z+.5-c.cz*16],climate:climate(t)});
     branches+=draw.filter(s=>!s.trunk&&!s.root).length;
     list.push({tree:t,segments:draw,origin:[t.x+.5,t.y+1,t.z+.5],graph});
   }
   if(!items.length)return;
   const g=woodGeometry(items,detail,!!quality?.real),mesh=new THREE.Mesh(g,mats.wood);mesh.position.set(c.cx*16,0,c.cz*16);mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.name='raizes-troncos-galhos';mesh.castShadow=!!mats.woodDepth;mesh.customDepthMaterial=mats.woodDepth;
   staticRoot.add(mesh);chunks.set(key,{mesh,list,items,detail,branches,chunk:c,revision:c.rev,epoch:forestEpoch});stats.trees+=list.length;stats.branches+=branches;
   relight(mesh);
   stats.buildMs=performance.now()-start;stats.maxBuildMs=Math.max(stats.maxBuildMs,stats.buildMs);stats.builds++;stats.totalBuildMs+=stats.buildMs;
 }
 function queueAll(){for(const c of world.chunks.values())if(c.hasMesh)dirty.set(chunkKey(c),c);}
 function driedClimate(rec){
   const base=climate(rec.tree),k=rec.ids.length?0:Math.min(1,(rec.dry||0)/DRY_SECONDS);
   return [base[0],Math.max(0,Math.round(base[1]*(1-k*.92)))];
 }
 function paintLeaves(rec,root){
   const old=root.getObjectByName('folhas-caidas');if(old){old.geometry.dispose();root.remove(old);}
   const g=fallenLeavesGeometry(rec,quality.name==='baixa'?3:6,driedClimate(rec));if(!g)return;
   const m=new THREE.Mesh(g,mats.leaf);m.name='folhas-caidas';m.castShadow=!!mats.leafDepth;m.customDepthMaterial=mats.leafDepth;root.add(m);relight(m);
 }
 function makeFallen(rec){
   if(Math.hypot(rec.st.p[0]-player.pos[0],rec.st.p[2]-player.pos[2])>(quality.distance+2)*16)return;
   const old=fallen.get(rec.id);if(old){old.root.traverse(o=>o.geometry?.dispose());fallRoot.remove(old.root);}
   const root=new THREE.Group();root.name='arvore-caida-'+rec.id;
   const segments=[...rec.ids.map(id=>rec.graph[id]),...canopySegments(rec.tree,rec.graph,rec.leaves,rec.ids,{reattach:true})],g=woodGeometry([{tree:rec.tree,segments,offset:rec.body.com.map(v=>-v),climate:climate(rec.tree)}]);
   if(segments.length){const m=new THREE.Mesh(g,mats.wood);m.castShadow=!!mats.woodDepth;m.customDepthMaterial=mats.woodDepth;root.add(m);}else g.dispose();
   paintLeaves(rec,root);
   root.position.fromArray(rec.st.p);root.quaternion.fromArray(rec.st.q);fallRoot.add(root);
   relight(root);
   const radius=Math.max(rec.body.radius,...segments.flatMap(s=>[s.a,s.b].map(p=>Math.hypot(...p.map((v,i)=>v-rec.body.com[i]))+Math.max(s.r0,s.r1))));
   fallen.set(rec.id,{root,rec,segments,radius,draw:newState(rec.st.p,rec.st.q),fromP:rec.st.p.slice(),fromQ:rec.st.q.slice(),at:performance.now()});stats.fallen=fallen.size;
 }
 // ---- Árvores nascidas de raiz cortada ou de galho no chão (shared/rebrota.js) ----------------------------------
 // Provisório até o Astra desenhar um broto de verdade (contrato no topo de shared/rebrota.js): monta a árvore ADULTA
 // com as mesmas peças das outras (madeira, raízes, ramos e folhas) e escala o grupo por g em volta do pivô.
 const assinatura=p=>p.estado+'|'+p.k+'|'+[...p.cortados].join(',');
 function tirarPlanta(id){const v=plantViews.get(id);if(!v)return;v.root.traverse(o=>o.geometry?.dispose());plantRoot.remove(v.root);plantViews.delete(id);stats.plantas=plantViews.size;}
 const alvoPlanta=p=>p.estado==='toco'?(p.base==='galho'?p.g:0):p.g;
 function montarPlanta(p){
   const old=plantViews.get(p.id);tirarPlanta(p.id);
   if(!forest||game.dim!==0||p.estado==='toco'&&p.base==='raiz')return;   // toco de raiz: só o toco natural, já desenhado
   if(Math.hypot(p.t.x+.5-player.pos[0],p.t.z+.5-player.pos[2])>(quality.distance+2)*16)return;
   const t=p.t,graph=forest.graph(t),ids=forest.idsPlantada(p,graph),P=pivo(p),O=[t.x+.5,t.y+1,t.z+.5],pl=P.map((v,i)=>v-O[i]);
   const leaves=forest.folhasPlantada(p,graph,ids),wood=ids.map(i=>graph[i]);groundCache.clear();
   const draw=[...wood,...(p.k===0&&ids.includes(0)?rootSegments(t,game.seed,(x,z)=>ground(x,z,t.y+1)):[]),...(leaves.length?canopySegments(t,graph,leaves,ids,{reattach:true}):[])];
   const root=new THREE.Group();root.name='arvore-plantada-'+p.id;root.position.fromArray(P);
   if(draw.length){const g=woodGeometry([{tree:t,segments:draw,offset:pl.map(v=>-v),climate:climate(t)}],2,!!quality?.real),m=new THREE.Mesh(g,mats.wood);m.castShadow=!!mats.woodDepth;m.customDepthMaterial=mats.woodDepth;root.add(m);}
   if(leaves.length){const g=fallenLeavesGeometry({leaves,tree:t,body:{com:pl,radius:t.rad+t.th}},quality.name==='baixa'?3:6,climate(t));if(g){const m=new THREE.Mesh(g,mats.leaf);m.name='folhas-plantada';m.castShadow=!!mats.leafDepth;m.customDepthMaterial=mats.leafDepth;root.add(m);}}
   const v={root,p,P,pl,wood,sig:assinatura(p),shown:Math.max(.02,old?old.shown:alvoPlanta(p)),mundo:null,mundoG:-1,radius:t.th+t.rad+2};
   root.scale.setScalar(v.shown);plantRoot.add(root);relight(root);plantViews.set(p.id,v);stats.plantas=plantViews.size;
 }
 // madeira da planta no mundo, no tamanho mostrado agora (mira e colisão)
 function mundoPlanta(v){
   if(v.mundo&&Math.abs(v.mundoG-v.shown)<.002)return v.mundo;
   const k=v.shown,w=q=>q.map((x,i)=>v.P[i]+k*(x-v.pl[i]));
   v.mundo=v.wood.map(s=>({id:s.id,a:w(s.a),b:w(s.b),r0:s.r0*k,r1:s.r1*k,trunk:s.trunk}));v.mundoG=k;return v.mundo;
 }
 function config(){return {gen:game.gen,get:world.getBlock,edited:world.isEdited,set:(x,y,z,b)=>{world.setBlock(x,y,z,b);if(net.offline)net.sendBlock(x,y,z,b);},changed:()=>{offlineDirty=true;},emit:m=>accept(m,true)};}
 function snapshot(data){clear();worldGen=game.gen;if(!game.gen?.treeAt||game.dim!==0){forest=null;return;}forest=new FallingTrees(config());forest.load(data);stats.source=forest.source;streamT=1;queueAll();for(const id of forest.plantadas.keys())pendingPlant.add(id);}
 function saveOffline(){if(!net.offline||!forest)return;store.set('arvores.off.'+game.slug,forest.save());store.set('off.'+game.slug,world.exportEdits());offlineDirty=false;}
 function accept(m,local=false){
   if(m.t==='welcome'){snapshot(m.trees);return;}
   if(m.t==='offline'){snapshot(store.get('arvores.off.'+game.slug,null));return;}
   if(!forest)return;
   if(m.t==='treeStyles'){forestEpoch++;forest.styles=m.styles;forest.source=m.source;stats.source=m.source;queueAll();}
   else if(m.t==='treeCut'){
     forestEpoch++;
     forest.cuts.set(m.key,new Set(m.removed));if(!local)for(const [x,y,z,b] of m.cells)world.setBlock(x,y,z,b);
     const [x,z]=m.key.split(',').map(Number),key=(x>>4)+','+(z>>4),c=chunks.get(key)?.chunk;if(c)dirty.set(key,c);
   }else if(m.t==='tree+'){
     let rec=forest.bodies.get(m.tree.id);if(!local){const part=new FallingTrees(config());part.load({bodies:[m.tree]});rec=part.bodies.get(m.tree.id);if(rec)forest.bodies.set(rec.id,rec);}
     if(rec)pendingFallen.add(rec.id);
     if(game.audio&&m.tree.ids.length)game.audio.play('break',.8,.55,'wood',m.tree.state.p);
   }else if(m.t==='treeLeaf'){
     const rec=forest.bodies.get(m.id);if(!rec)return;
     if(!local){const i=rec.leaves.findIndex(c=>c[0]===m.x&&c[1]===m.y&&c[2]===m.z);if(i>=0)rec.leaves.splice(i,1);rec.dry=m.dry||0;}
     const view=fallen.get(m.id);if(view)paintLeaves(rec,view.root);
     if(game.audio){const p=leafWorld(rec, [m.x,m.y,m.z,0], [0,0,0]);game.audio.play('break',.55,1.15,'leaves',p);}
   }else if(m.t==='treeDry'){
     const rec=forest.bodies.get(m.id);if(!rec)return;
     if(!local){rec.dry=m.dry||0;if(rec.leaves.length>m.n)rec.leaves.length=m.n;}
     const view=fallen.get(m.id);if(view)paintLeaves(rec,view.root);
   }else if(m.t==='planta'){
     const p=local?forest.plantadas.get(m.p.id):forest.recebePlanta(m.p);if(!p)return;
     const v=plantViews.get(p.id);if(v&&v.sig===assinatura(p))v.p=p;else pendingPlant.add(p.id);   // só cresceu: o laço anda a escala
   }else if(m.t==='planta-'){if(!local)forest.esquecePlanta(m.id);pendingPlant.delete(m.id);tirarPlanta(m.id);
   }else if(m.t==='tree-'){const view=fallen.get(m.id);if(view){view.root.traverse(o=>o.geometry?.dispose());fallRoot.remove(view.root);fallen.delete(m.id);}forest.bodies.delete(m.id);stats.fallen=fallen.size;
   }else if(m.t==='treeMove')for(const a of m.l){const rec=forest.bodies.get(a[0]);if(!rec)continue;const view=fallen.get(a[0]);if(view){view.fromP=view.root.position.toArray();view.fromQ=view.root.quaternion.toArray();view.at=performance.now();}rec.st.p=a.slice(1,4);rec.st.q=a.slice(4,8);rec.st.asleep=!!a[8];syncRotation(rec.st);}
 }
 const previousModels=world.listeners.models;
 world.listeners.models=(c,models)=>{previousModels?.(c,models);if(models===null){const old=chunks.get(chunkKey(c));if(old){removeMesh(old.mesh);chunks.delete(chunkKey(c));stats.trees-=old.list.length;stats.branches-=old.branches;}}else buildChunk(c);};
 function forNear(point,radius,fn){
   for(const item of chunks.values())for(const r of item.list)if(Math.hypot(point[0]-r.origin[0],point[2]-r.origin[2])<radius+r.tree.rad+1){
     const local=point.map((v,i)=>v-r.origin[i]);
     for(const s of r.segments)if(nearSegment(local,s,radius))fn(s,s.a.map((v,i)=>v+r.origin[i]),s.b.map((v,i)=>v+r.origin[i]),r,null);
   }
   for(const view of fallen.values())if(Math.hypot(...point.map((v,i)=>v-view.draw.p[i]))<radius+view.radius){
     const rec=view.rec,worldPoint=p=>toWorld(view.draw.R,p.map((v,i)=>v-rec.body.com[i]),[0,0,0]).map((v,i)=>v+view.draw.p[i]);
     const delta=point.map((v,i)=>v-view.draw.p[i]),R=view.draw.R;
     const local=[0,1,2].map(i=>R[i]*delta[0]+R[i+3]*delta[1]+R[i+6]*delta[2]+rec.body.com[i]);
     for(const s of view.segments)if(nearSegment(local,s,radius))fn(s,worldPoint(s.a),worldPoint(s.b),null,view);
   }
   for(const v of plantViews.values()){
     if(Math.hypot(point[0]-v.P[0],point[2]-v.P[2])>radius+v.radius*v.shown+1)continue;
     for(const s of mundoPlanta(v))if(nearSegment(point,s,radius))fn(s,s.a,s.b,null,null,v);
   }
 }
 function rayBox(o,d,c,half,reach){
   let tmin=0,tmax=reach;
   for(let i=0;i<3;i++){
     if(Math.abs(d[i])<1e-8){if(o[i]<c[i]-half||o[i]>c[i]+half)return Infinity;continue;}
     let t1=(c[i]-half-o[i])/d[i],t2=(c[i]+half-o[i])/d[i];if(t1>t2){const s=t1;t1=t2;t2=s;}
     tmin=Math.max(tmin,t1);tmax=Math.min(tmax,t2);if(tmin>tmax)return Infinity;
   }
   return tmin;
 }
 const leafBox=[0,0,0];
 function aim(o,d,reach=interaction.reach){
   let hit=null,best=reach;
   forNear(o,reach,(s,a,b,standing,view,planted)=>{const t=raySegment(o,d,a,b,s.r0,s.r1,best);if(t<best){best=t;hit={t,node:s.id,a,b,r:Math.max(s.r0,s.r1),standing,view,planted};}});
   for(const view of fallen.values()){
     if(Math.hypot(o[0]-view.draw.p[0],o[1]-view.draw.p[1],o[2]-view.draw.p[2])>reach+view.radius+1)continue;
     for(const cell of view.rec.leaves){
       leafWorld(view.rec,cell,leafBox,view.draw);
       const t=rayBox(o,d,leafBox,.5,best);if(t<best){best=t;hit={t,node:-2,leaf:cell,a:leafBox.slice(),b:leafBox.slice(),r:.5,view};}
     }
   }
   if(hit){
     hit.point=o.map((v,i)=>v+d[i]*hit.t);
     const axis=sub(hit.b,hit.a),f=Math.max(0,Math.min(1,dot(sub(hit.point,hit.a),axis)/(dot(axis,axis)||1)));
     const normal=hit.point.map((v,i)=>v-hit.a[i]-axis[i]*f),length=Math.hypot(...normal);
     hit.normal=length>1e-5?normal.map(v=>v/length):d.map(v=>-v);
   }
   return hit;
 }
 function cut(hit){if(!forest)return false;
   if(hit.planted){const id=hit.planted.p.id;if(net.offline){const ok=forest.cortarPlantada(id,hit.node,player.pos);saveOffline();return ok;}net.send({t:'treeCut',plantada:id,node:hit.node});return true;}
   if(hit.leaf){
     const cell=hit.leaf;
     if(net.offline){forest.takeLeaf(hit.view.rec.id,cell[0],cell[1],cell[2]);saveOffline();return true;}
     net.send({t:'treeLeaf',id:hit.view.rec.id,x:cell[0],y:cell[1],z:cell[2]});return true;
   }
   if(net.offline){const ok=hit.view?forest.cutFallen(hit.view.rec.id,hit.node):forest.cut(hit.standing.tree,hit.node,player.pos);saveOffline();return ok;}
   net.send(hit.view?{t:'treeCut',id:hit.view.rec.id,node:hit.node}:{t:'treeCut',x:hit.standing.tree.x,z:hit.standing.tree.z,node:hit.node});return true;
 }
 let treeDig=null;   // corte demorado em andamento (sobrevivência): { key, t }
 function interact(dt,playing,o,d){
   highlight.visible=false;cooldown=Math.max(0,cooldown-dt);placeCooldown=Math.max(0,placeCooldown-dt);if(!forest||game.dim!==0)return false;
   const hit=game.treeAim?.t<=interaction.reach?game.treeAim:null;if(!hit)return false;
   const voxel=interaction.target;
   if(voxel.hit&&voxel.t<hit.t-.06&&voxel.id!==B.LEAVES&&voxel.id!==B.PINE_LEAVES&&!ownsWood(voxel.x,voxel.y,voxel.z))return false;
   highlight.visible=true;
   const tree=hit.standing?.tree??hit.view?.rec.tree??hit.planted?.p.t;
   let needId;
   if(hit.leaf){
     highlight.position.set(hit.a[0],hit.a[1],hit.a[2]);highlight.scale.set(1,1,1);highlight.quaternion.identity();
     ui.setHint('Folha · coletar');needId=hit.leaf[3];
   }else{
     highlight.position.fromArray(hit.a).add(temp.fromArray(hit.b)).multiplyScalar(.5);highlight.scale.set(hit.r*2+.03,Math.max(.05,Math.hypot(...sub(hit.b,hit.a))),hit.r*2+.03);
     highlight.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),temp.fromArray(hit.b).sub(new THREE.Vector3().fromArray(hit.a)).normalize());
     const nova=hit.planted&&hit.planted.p.g<1?(hit.planted.p.g<.3?'Broto':'Árvore nova'):null;
     ui.setHint(nova?nova+' · cortar (o toco fica e brota de novo)':hit.node===0&&!hit.view?'Raiz · cortar separadamente':hit.node<tree.th?'Tronco · cortar':'Galho · cortar');
     needId=hit.node===0&&!hit.view?rootId(tree):woodId(tree);
   }
   // modos de jogo (game/modes.js): aventura e espectador não cortam; no sobrevivência segura pelo tempo do bloco
   const need=interaction.locked?Infinity:interaction.breakTime?interaction.breakTime(needId):0;
   const key=(hit.view?'c'+hit.view.rec.id:hit.planted?'q'+hit.planted.p.id:'p'+tree.x+','+tree.z)+':'+(hit.leaf?hit.leaf.slice(0,3).join(','):hit.node);
   if(need>0&&Number.isFinite(need)){
     if(playing&&input.isDown('break')&&cooldown===0){if(!treeDig||treeDig.key!==key)treeDig={key,t:0};treeDig.t+=dt;if(treeDig.t>=need){treeDig=null;cut(hit);cooldown=.25;}}
     else treeDig=null;
     interaction.digging=treeDig?{x:Math.floor(hit.point[0]),y:Math.floor(hit.point[1]),z:Math.floor(hit.point[2]),k:Math.min(1,treeDig.t/need)}:null;
   }else if(need===0&&playing&&(input.wasPressed('break')||input.isDown('break')&&cooldown===0)){cut(hit);cooldown=.24;}
   if(playing&&input.wasPressed('pick')){game.hotbar[game.sel]=hit.leaf?hit.leaf[3]:hit.node===0?rootId(tree):woodId(tree);store.set('hotbar',game.hotbar);}
   if(playing&&(input.wasPressed('place')||input.isDown('place')&&placeCooldown===0)){interaction.placeSurface(hit.point,hit.normal,game.hotbar[game.sel],d);placeCooldown=.19;}
   return true;
 }
 const previousExtra=player.extra;
 player.extra=p=>{
   previousExtra?.(p);if(!forest||game.dim!==0)return;
   forNear(p.pos,2,(s,a,b,standing,view,planted)=>{
     if(planted&&planted.shown<.3)return;   // broto e muda finos não seguram ninguém
     const radius=.29,[pa,pb,u]=closestSegments([p.pos[0],p.pos[1]+radius,p.pos[2]],[p.pos[0],p.pos[1]+1.75-radius,p.pos[2]],a,b),r=s.r0+(s.r1-s.r0)*u;
     const delta=sub(pa,pb),dist=Math.hypot(...delta),depth=radius+r-dist;if(depth<=0||depth>.9)return;
     const n=dist>.0001?delta.map(v=>v/dist):[1,0,0];for(let i=0;i<3;i++)p.pos[i]+=n[i]*depth;
     const vn=dot(p.vel,n);if(vn<0)for(let i=0;i<3;i++)p.vel[i]-=n[i]*vn;if(n[1]>.5&&p.vel[1]<=.1){p.onGround=true;p.vel[1]=0;}
   });
 };
 world.collisionBlock=(x,y,z)=>ownsWood(x,y,z)?B.AIR:world.getBlock(x,y,z);
 world.selectionBlock=world.collisionBlock;
 const oldBlock=world.listeners.block;world.listeners.block=(x,y,z,b)=>{oldBlock?.(x,y,z,b);if(net.offline)forest?.wakeNear(x,y,z);};
 const update=dt=>{
   if(worldGen!==game.gen&&forest){clear();forest=null;}
   if(forest&&(streamT+=dt)>.4){
     streamT=0;const range=(quality.distance+2)*16;
     for(const [id,view] of fallen)if(Math.hypot(view.rec.st.p[0]-player.pos[0],view.rec.st.p[2]-player.pos[2])>range+16){view.root.traverse(o=>o.geometry?.dispose());fallRoot.remove(view.root);fallen.delete(id);}
     for(const rec of forest.bodies.values())if(!fallen.has(rec.id)&&Math.hypot(rec.st.p[0]-player.pos[0],rec.st.p[2]-player.pos[2])<=range)pendingFallen.add(rec.id);
     stats.fallen=fallen.size;
     for(const [id,v] of plantViews)if(Math.hypot(v.P[0]-player.pos[0],v.P[2]-player.pos[2])>range+16)tirarPlanta(id);
     for(const p of forest.plantadas.values())if(!plantViews.has(p.id)&&!(p.estado==='toco'&&p.base==='raiz')&&Math.hypot(p.t.x-player.pos[0],p.t.z-player.pos[2])<=range)pendingPlant.add(p.id);
   }
   let feitas=0;for(const id of pendingPlant){pendingPlant.delete(id);const p=forest?.plantadas.get(id);if(p)montarPlanta(p);else tirarPlanta(id);if(++feitas>=2)break;}
   for(const v of plantViews.values()){const alvo=Math.max(.02,alvoPlanta(v.p));if(Math.abs(alvo-v.shown)>1e-4){v.shown+=(alvo-v.shown)*Math.min(1,dt*1.2);if(Math.abs(alvo-v.shown)<.002)v.shown=alvo;v.root.scale.setScalar(v.shown);}}
   let built=0;for(const id of pendingFallen){pendingFallen.delete(id);const rec=forest?.bodies.get(id);if(rec)makeFallen(rec);if(++built>=2)break;}
   const cell=(player.pos[0]>>4)+','+(player.pos[2]>>4);if(cell!==lastCell){lastCell=cell;for(const c of chunks.values())if(lod(c.chunk)!==c.detail)dirty.set(chunkKey(c.chunk),c.chunk);}
   let n=0;const buildStart=performance.now();
   for(const [k,c] of dirty){dirty.delete(k);if(world.chunks.get(c.key)===c)buildChunk(c);if(++n>=2||performance.now()-buildStart>=5)break;}
   stats.pending=dirty.size;
   const now=performance.now();for(const view of fallen.values()){
     const {rec,root}=view;root.visible=Math.hypot(root.position.x-player.pos[0],root.position.z-player.pos[2])<(quality.distance+2)*16;
     if(net.offline){root.position.fromArray(rec.st.p);root.quaternion.fromArray(rec.st.q);}else{const t=Math.min(1,(now-view.at)/150);root.position.fromArray(view.fromP).lerp(temp.fromArray(rec.st.p),t);root.quaternion.copy(fromQ.fromArray(view.fromQ)).slerp(toQ.fromArray(rec.st.q),t);}
     view.draw.p[0]=root.position.x;view.draw.p[1]=root.position.y;view.draw.p[2]=root.position.z;root.quaternion.toArray(view.draw.q);syncRotation(view.draw);
   }
   if(net.offline&&(saveT+=dt)>2){saveT=0;if(offlineDirty)saveOffline();}
   if((lightT+=dt)>.25){lightT=0;const views=[...fallen.values(),...plantViews.values()];for(let n=0;n<Math.min(4,views.length);n++){const view=views[lightCursor++%views.length];if(view.root.visible)relight(view.root);}}
 };
 game.hooks.other.push(accept);game.hooks.interact.push(interact);game.hooks.frame.push(update);game.hooks.fixed.push(dt=>{if(net.offline&&forest){forest.advance(dt);forest.crescer(dt);}return false;});
 window.addEventListener('beforeunload',saveOffline);
 const api={stats,ownsWood,aim,cut,accept,saveOffline,get forest(){return forest;},get chunks(){return chunks;},get fallen(){return fallen;},get plantas(){return plantViews;},cutBlock(x,y,z){if(!net.offline||!forest)return false;const ok=forest.cutBlock(x,y,z,player.pos);if(ok)saveOffline();return ok;}};
 game.trees=api;return api;
}
