// LAVRA — colapso material, copas ao vento e queda esparsa de folhas.
import * as THREE from '../three.js';
import { B, TEX, KIND, SOLID, K_CROSS, TINT_B0, TINT_D0 } from '../../shared/blocks.js';
import { Y_TOP } from '../../shared/constants.js';
import { U } from './materials.js';
import { createDebris } from './debris.js';
import { fracturePlan, leafPlan, JEV_POLICY } from './phenomena.js';
import { NATURE, acceptNature, natureClock } from './nature-state.js';
import { installFaunaSkins } from './fauna.js';
import { createMaterialStateStore } from './material-states.js';
import { installFoliage } from './foliage.js';
import { installEquipment } from './equipment.js';

export function createEffects(scene, options = {}) {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006,1.006,1.006)),
    new THREE.LineBasicMaterial({color:0x0a0a0a,transparent:true,opacity:.62,depthWrite:false}));
  edges.visible=false; edges.renderOrder=3; scene.add(edges);
  const debris=createDebris(scene,256), cam=new THREE.Vector3();
  const materials=createMaterialStateStore();
  const stats={breaks:0,leaves:0,scans:0,voxelReads:0,lastVariant:null,policy:JEV_POLICY.model};
  let clock=0,poll=0,worldKey='',lastWorldTime=null;
  const seen=new Map();
  let boundHooks=null, fauna=null, foliage=null, foliageWorld=null, equipment=null;

  // Compatibilidade com o main.js atual do Claude, sem sobrescrever seu trabalho.
  // Contrato explícito: world/camera/quality/time; bridge removível após os hooks.
  function context() {
    const live=globalThis.LAVRA;
    const explicit=options.getContext ? options.getContext() : options.world ? options : null;
    if(explicit) {
      // Main anterior já fornece mundo/câmera, mas ainda não inclui input/scene.
      // Completar só a mesma cena e mundo, sem substituir os hooks explícitos.
      const same=live?.scene===scene&&live.world===explicit.world;
      return {...explicit,scene:explicit.scene??scene,input:explicit.input??(same?live.input:null)};
    }
    return live?.scene===scene ? live : null;
  }
  function read(world,x,y,z) { stats.voxelReads++; return world.getBlock(x,y,z); }
  function floorAt(world,x,y,z,leaf=false) {
    for(let yy=Math.floor(y);yy>=Math.max(world.fundo??0,y-(leaf?20:48));yy--) {
      const id=read(world,Math.floor(x),yy,Math.floor(z));
      if(id===-1) return y-1;
      if(id===B.WATER || (SOLID[id] && (!leaf || (id!==B.LEAVES && id!==B.PINE_LEAVES)))) return yy+1;
    }
    return y-(leaf?20:48);
  }
  function appearance(world,x,y,z,id) {
    const chunk=world.chunks?.get(`${Math.floor(x)>>4},${Math.floor(z)>>4}`);
    const mesh=chunk?.meshes?.[KIND[id]===2 || KIND[id]===K_CROSS ? 1:0];
    const pos=mesh?.geometry.attributes.aPos, dat=mesh?.geometry.attributes.aDat;
    let temp=.5,moist=.6,sky=1,torch=0,best=Infinity;
    if(pos && dat) {
      const lx=x-(Math.floor(x)>>4)*16,lz=z-(Math.floor(z)>>4)*16;
      for(let i=0;i<pos.count;i+=4) {
        const dx=pos.getX(i)-lx,dy=pos.getY(i)-y,dz=pos.getZ(i)-lz,d=dx*dx+dy*dy+dz*dz;
        if(d<best) { best=d;const light=dat.getY(i);sky=(light&15)/15;torch=(light>>4)/15;temp=dat.getZ(i)/255;moist=dat.getW(i)/255;if(d<.1) break; }
      }
    }
    const layer=TEX[id*6+2],leaf=layer>=TINT_D0;
    const smooth=(a,b,t)=>{t=Math.min(1,Math.max(0,(t-a)/(b-a)));return t*t*(3-2*t);};
    const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
    let tint=[1,1,1];
    if(layer>=TINT_B0) {
      const dry=leaf?mix([.39,.50,.34],[.56,.60,.32],temp):mix([.44,.60,.40],[.74,.72,.32],smooth(.35,.8,temp));
      const wet=leaf?mix([.29,.48,.34],[.30,.55,.22],temp):mix([.34,.56,.39],[.34,.63,.26],temp);
      tint=mix(dry,wet,smooth(leaf?.25:.2,leaf?.7:.62,moist)).map(v=>v*v*(v*.305+.695));
    }
    return {tint,light:[sky,torch]};
  }
  function emitLeaf(world,id,x,y,z,plan,birth=clock) {
    const a=appearance(world,x,y,z,id);
    const variant=plan.variant==='tumble'?3:plan.variant==='flutter'?2:1;
    debris.emit({id,origin:[x,y,z],birth,size:[plan.size,.006,plan.size*1.8],life:plan.life,
      velocity:[plan.drift*U.uWind.value.x,plan.speed,plan.drift*U.uWind.value.y],spin:[0,plan.phase,0],leaf:variant,
      floor:floorAt(world,x+plan.drift*3,y-1,z+plan.drift*1.8,true)+.025,...a});
    stats.leaves++;
  }
  function breakBlock(x,y,z,id,event) {
    const ctx=context(),world=ctx?.world;
    if(!world || !Number.isInteger(id) || id<=0 || id===B.WATER) return null;
    const time=typeof ctx.time==='function'?ctx.time():ctx.net?.time?.() ?? clock;
    const plan=fracturePlan({seed:world.seed,dimension:world.dim,x,y,z,id,event:event??Math.floor(time*20)});
    const foliage=id===B.LEAVES || id===B.PINE_LEAVES || KIND[id]===K_CROSS;
    if(foliage) {
      for(let i=0;i<7;i++) { const p=plan.pieces[i%plan.pieces.length];emitLeaf(world,id,x+p.center[0],y+p.center[1],z+p.center[2],{variant:['drift','flutter','tumble'][i%3],size:.16+p.size[0]*.15,life:2.3+i*.13,drift:p.velocity[0],speed:.7+i*.06,phase:p.spin[0]}); }
    } else {
      const a=appearance(world,x,y,z,id);
      for(const p of plan.pieces) {
        const cx=x+p.center[0],cy=y+p.center[1],cz=z+p.center[2];
        const fl=Math.min(cy,floorAt(world,cx+p.velocity[0]*.3,y-.01,cz+p.velocity[2]*.3)+Math.max(...p.size)*.5);
        const fallT=Math.sqrt(2*Math.max(0,cy-fl)/13);
        debris.emit({id,origin:[x,y,z],birth:clock,...p,life:Math.max(p.life+fallT+.45,(fallT+(p.delay||0)+.55)/.7),...a,floor:fl});
      }
    }
    stats.breaks++;stats.lastVariant=plan.variant;
    debris.update(clock);
    return plan;
  }
  // Lascas de um golpe de machado (game/machado.js). ponto/normal = onde a lâmina bateu; n = lascas miúdas que saltam;
  // com `bloco` e `caixa` (o quarto que o golpe tirou, em coordenadas do bloco), sai também a lasca grande, que tomba.
  // Desenho provisório, com os mesmos cacos da quebra: pode ser trocado inteiro.
  function lascas({id,ponto,normal=[0,1,0],n=5,bloco=null,caixa=null}) {
    const ctx=context(),world=ctx?.world;
    if(!world || !ponto || !Number.isInteger(id) || id<=0) return;
    const ox=Math.floor(ponto[0]),oy=Math.floor(ponto[1]),oz=Math.floor(ponto[2]);
    const a=appearance(world,ponto[0],ponto[1],ponto[2],id);
    const rnd=(i,k)=>{const h=Math.sin(ponto[0]*12.9898+ponto[1]*78.233+ponto[2]*37.719+i*4.137+k*9.1+clock*3.7)*43758.5453;return h-Math.floor(h);};
    for(let i=0;i<n;i++) {
      const s=.035+rnd(i,1)*.06;
      const v=[normal[0]*(1.2+rnd(i,2)*1.6)+(rnd(i,3)-.5)*2.2,1.4+rnd(i,4)*2.4+normal[1]*1.2,normal[2]*(1.2+rnd(i,5)*1.6)+(rnd(i,6)-.5)*2.2];
      const fl=floorAt(world,ponto[0]+v[0]*.3,ponto[1],ponto[2]+v[2]*.3)+s*.5;
      debris.emit({id,origin:[ox,oy,oz],birth:clock,center:[ponto[0]-ox+normal[0]*.03,ponto[1]-oy+normal[1]*.03,ponto[2]-oz+normal[2]*.03],
        size:[s*(.6+rnd(i,7)),s*.35,s*(1.2+rnd(i,8)*1.5)],velocity:v,spin:[rnd(i,9)*9-4.5,rnd(i,10)*9-4.5,rnd(i,11)*9-4.5],life:1.5+rnd(i,12)*.8,...a,floor:fl});
    }
    if(bloco && caixa) {
      const [x,y,z]=bloco,cx=(caixa[0]+caixa[3])/2,cy=(caixa[1]+caixa[4])/2,cz=(caixa[2]+caixa[5])/2;
      const fx=cx-.5,fz=cz-.5,l=Math.hypot(fx,fz)||1;
      const v=[fx/l*1.5+normal[0]*.4,1.2,fz/l*1.5+normal[2]*.4];
      const sz=[caixa[3]-caixa[0],caixa[4]-caixa[1],caixa[5]-caixa[2]].map(d=>d*.92);
      const fl=floorAt(world,x+cx+v[0]*.4,y-.01,z+cz+v[2]*.4)+Math.min(sz[0],sz[2])*.5;
      debris.emit({id,origin:[x,y,z],birth:clock,center:[cx,cy,cz],size:sz,velocity:v,spin:[fz/l*2.4,.3,-fx/l*2.4],life:1.5,...a,floor:fl});
    }
    stats.lascas=(stats.lascas||0)+1;
    debris.update(clock);
  }
  function burst(x,y,z,rgb,n,spread) {
    // Durante onBreak o hit ainda guarda o id original, anterior à remoção.
    const hit=context()?.interaction?.target;
    if(hit && hit.x===x && hit.y===y && hit.z===z) return breakBlock(x,y,z,hit.id);
    return null;
  }
  function scan(ctx,time) {
    const world=ctx.world;
    if(!ctx.camera || (ctx.game && !['PLAYING','PAUSED'].includes(ctx.game.state))) return;
    ctx.camera.getWorldPosition(cam);
    const low=ctx.quality?.name==='baixa' || ctx.quality?.distance<=5;
    const radius=low?2:3,cx=Math.floor(cam.x/4),cz=Math.floor(cam.z/4),slot=Math.floor(time/3);
    const maxActive=low?32:64;
    let added=0;
    stats.scans++;
    for(const [key,birth] of seen) if(time-birth>9) seen.delete(key);
    for(let dz=-radius;dz<=radius;dz++) for(let dx=-radius;dx<=radius;dx++) {
      if(added>=5 || debris.active+added>=maxActive) return;
      for(let s=slot-1;s<=slot;s++) {
        const liveWind=ctx.game?.weather?.wind;
        const p=leafPlan(world.seed,world.dim,cx+dx,cz+dz,s,liveWind?Math.hypot(...liveWind):NATURE.active?Math.hypot(...NATURE.wind):null);
        if(!p || p.birth>time || time-p.birth>.55) continue;
        const key=`${cx+dx},${cz+dz},${s}`;
        if(seen.has(key)) continue;
        seen.set(key,p.birth);
        for(let y=Math.min(Y_TOP-1,Math.floor(cam.y)+18);y>=Math.max((world.fundo??0)+1,Math.floor(cam.y)-7);y--) {
          const id=read(world,p.x,y,p.z);
          if(id===-1) break;
          if(id!==B.LEAVES && id!==B.PINE_LEAVES) continue;
          const sides=[[1,0],[-1,0],[0,1],[0,-1]];
          const side=sides.find(([sx,sz])=>read(world,p.x+sx,y,p.z+sz)===B.AIR);
          if(!side) continue;
          emitLeaf(world,id,p.x+.5+side[0]*.53,y+.2+p.offset*.6,p.z+.5+side[1]*.53,p,clock-(time-p.birth));
          added++;break;
        }
      }
    }
  }
  function update(dt) {
    clock+=Math.max(0,Math.min(.25,dt));
    const ctx=context();
    if(ctx?.world) {
      if(!equipment&&ctx.input&&ctx.game) {equipment=installEquipment(ctx);if(equipment)stats.equipment=equipment.stats;}
      equipment?.update(dt);
      if(foliageWorld!==ctx.world) {foliage?.dispose();foliageWorld=ctx.world;foliage=installFoliage(ctx.world,ctx);stats.foliage=foliage.stats;}
      foliage.update();
      const nature=ctx.game?.nature??ctx.nature;
      if(nature?.setSkin && fauna?.nature!==nature) {fauna?.dispose();fauna=installFaunaSkins(scene,nature,ctx);stats.fauna=fauna.stats;}
      if(!boundHooks&&ctx.game?.hooks?.other) {boundHooks=ctx.game.hooks.other;boundHooks.push(acceptNature,materials.accept);}
      const key=`${ctx.game?.slug||''}:${ctx.world.seed}:${ctx.world.dim}`;
      const fallback=typeof ctx.time==='function'?ctx.time():ctx.net?.time?.() ?? clock;
      const time=ctx.world.dim===0?natureClock(fallback):fallback;
      if(worldKey!==key || (lastWorldTime!==null && (time<lastWorldTime || time-lastWorldTime>3))) { debris.clear();seen.clear();poll=0;worldKey=key; }
      lastWorldTime=time;
      // Frequências do vento são múltiplas de .01: módulo sem salto de fase.
      U.uWindTime.value=((time%(Math.PI*200))+Math.PI*200)%(Math.PI*200);
      const wind=ctx.world.dim===0?(ctx.game?.weather?.wind??(NATURE.active?NATURE.wind:[.8,.5])):[.8,.5];
      const speed=Math.hypot(...wind),strength=Math.min(1.8,Math.max(.28,speed*.28));
      const k=1-Math.exp(-dt*1.5);
      U.uWind.value.x+=(wind[0]/Math.max(.001,speed)-U.uWind.value.x)*k;
      U.uWind.value.y+=(wind[1]/Math.max(.001,speed)-U.uWind.value.y)*k;
      U.uWind.value.z+=(strength-U.uWind.value.z)*k;
      poll-=dt;
      if(poll<=0) {poll=.4;scan(ctx,time);}
    }
    debris.update(clock);
  }
  function target(hit) { edges.visible=!!hit?.hit;if(edges.visible) edges.position.set(hit.x+.5,hit.y+.5,hit.z+.5); }
  function dispose() {equipment?.dispose();foliage?.dispose();fauna?.dispose();materials.dispose();scene.remove(edges);edges.geometry.dispose();edges.material.dispose();debris.dispose();seen.clear();if(boundHooks){for(const fn of [acceptNature,materials.accept]){const i=boundHooks.indexOf(fn);if(i>=0)boundHooks.splice(i,1);}}}
  return {burst,breakBlock,lascas,update,target,edges,debris,materials,get equipment(){return equipment;},stats,dispose};
}
