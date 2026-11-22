import * as THREE from '../three.js';
import {TOOL_ART} from '../../assets/tools/data.js';
import {buildMinecraftBody} from './minecraft-avatar.js';
import {normalizeSkinPixels} from './skin-layout.js';
import {pickaxeGeometry,toolGrainTexture} from './pickaxe-model.js';
import {faseDoGolpe} from '../../shared/machado.js';   // tempos do golpe do machado (game/machado.js)
import {machadoReal,carregarMachado} from './machado-modelo.js';   // machado realista (GLB CC0); até chegar, o de pixel
import {U} from './materials.js';

const cache=new Map();
export function toolGeometry(key) {
  if(key.endsWith('-pickaxe'))return pickaxeGeometry(key.split('-')[0]);
  if(cache.has(key))return cache.get(key);
  const art=TOOL_ART[key];if(!art)return null;
  const positions=[],normals=[],colors=[],indices=[],scale=.62/art.h;
  const color=new THREE.Color(),at=(x,y)=>x>=0&&y>=0&&x<art.w&&y<art.h?art.pixels[y*art.w+x]:0;
  const faces=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]], [[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],[[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],[[0,0,1],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]],[[0,0,-1],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]]];
  for(let y=0;y<art.h;y++)for(let x=0;x<art.w;x++) {
    const pixel=at(x,y);if(!pixel)continue;color.setHex(pixel>>>8);
    for(let f=0;f<6;f++) {
      if(f===0&&at(x+1,y)||f===1&&at(x-1,y)||f===2&&at(x,y-1)||f===3&&at(x,y+1))continue;
      const [normal,vertices]=faces[f],base=positions.length/3;
      for(const v of vertices){positions.push((x+v[0]-art.w*.3)*scale,(art.h-y-1+v[1])*scale-.16,(v[2]-.5)*.055);normals.push(...normal);colors.push(color.r,color.g,color.b);}
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.userData.shared=true;g.computeBoundingSphere();cache.set(key,g);return g;
}

export function installEquipment(ctx) {
  const {scene,camera,game,input}=ctx,self=scene.getObjectByName('explorador-lavra')?.userData.body;
  if(!self)return null;
  const fp=buildMinecraftBody({handOnly:true});fp.root.name='mao-lavra';fp.root.scale.setScalar(.65);fp.root.position.set(.2,-1.4,-.4);camera.add(fp.root);
  fp.root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65,metalness:.12});
  const grain=toolGrainTexture(),wood=new THREE.MeshStandardMaterial({vertexColors:true,map:grain,roughness:.88});
  const heads=Object.fromEntries(['wood','stone','iron','crystal'].map(k=>[k,new THREE.MeshStandardMaterial({vertexColors:true,roughness:k==='iron'?.36:k==='crystal'?.23:.88,metalness:k==='iron'?.7:0})]));
  const materialFor=key=>key.endsWith('-pickaxe')?[heads[key.split('-')[0]],wood]:mat;
  const near=new THREE.Mesh(toolGeometry('iron-pickaxe'),materialFor('iron-pickaxe')),held=new THREE.Mesh(near.geometry,near.material);held.castShadow=held.receiveShadow=true;
  fp.elbowR.add(near);self.elbowR.add(held);near.position.set(0,-.29,-.08);held.position.copy(near.position);near.rotation.set(-2.15,0,-.4);held.rotation.set(-.25,0,-.55);
  // Como no Minecraft: nada na mão até o jogador escolher uma ferramenta (o antigo modo 'auto' trocava sozinho e mostrava picareta sem pedido).
  const settings={tool:'none',material:'iron',slim:false,character:'explorador'},stats={key:'iron-pickaxe',skin:640,localOnly:true};
  carregarMachado(globalThis.LAVRA?.renderer);
  let skinCanvas=null,phase=0,dead=false,girou=false;
  // primeira pessoa: giro do conjunto braço+ferramenta em volta do ombro, no espaço da câmera (ângulos em x, y, z; ordem YXZ)
  const BASE=new THREE.Vector3(.2,-1.4,-.4),OMBRO=new THREE.Vector3(.419,-.523,-.4),giroE=new THREE.Euler(0,0,0,'YXZ'),giroQ=new THREE.Quaternion(),giroV=new THREE.Vector3();
  const POSE_PARADO=[0,0,0],POSE_ALTO=[.5,-.05,-.1],POSE_IMPACTO=[-.6,.5,.25];
  function giraConjunto(rx,ry,rz){giroE.set(rx,ry,rz,'YXZ');giroQ.setFromEuler(giroE);fp.root.quaternion.copy(giroQ);fp.root.position.copy(giroV.copy(BASE).sub(OMBRO).applyQuaternion(giroQ).add(OMBRO));}
  const panels=[],listeners=[];
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  function apply(){self.setSkin(skinCanvas,settings.slim,settings.character);fp.setSkin(skinCanvas,settings.slim,settings.character);stats.skin=skinCanvas?.width||640;}
  function save(){try{localStorage.setItem('lavra.aparencia.v1',JSON.stringify({...settings,skin:skinCanvas?.toDataURL()||null}));}catch{ /* armazenamento indisponível: mantém nesta partida */ }}
  async function importSkin(source) {
    const image=new Image();image.src=typeof source==='string'?source:URL.createObjectURL(source);
    try {await image.decode();if(dead)return;const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const g=c.getContext('2d');g.drawImage(image,0,0);
      const pixels=normalizeSkinPixels(c.width,c.height,g.getImageData(0,0,c.width,c.height).data);c.height=c.width;g.putImageData(new ImageData(pixels,c.width,c.height),0,0);skinCanvas=c;apply();save();
    }finally{if(typeof source!=='string')URL.revokeObjectURL(image.src);}
  }
  try{const saved=JSON.parse(localStorage.getItem('lavra.aparencia.v1')||'null');if(saved){
    if(['pickaxe','axe','shovel','sword','none'].includes(saved.tool))settings.tool=saved.tool;
    if(['wood','stone','iron','crystal'].includes(saved.material))settings.material=saved.material;
    if(['explorador','botanica','mineiro'].includes(saved.character))settings.character=saved.character;settings.slim=!!saved.slim;
    if(typeof saved.skin==='string'&&saved.skin.startsWith('data:image/png')&&saved.skin.length<6000000)importSkin(saved.skin).catch(()=>{});
  }}catch{}apply();
  for(const parent of [document.querySelector('#menu .card'),document.querySelector('#pause .card')].filter(Boolean)) {
    const panel=document.createElement('details');panel.style.cssText='margin:12px 0;padding:10px;border:1px solid #ffffff30;border-radius:8px';
    const summary=document.createElement('summary');summary.textContent='Personagem e ferramentas';panel.append(summary);
    const content=document.createElement('div');content.style.cssText='display:flex;flex-wrap:wrap;gap:10px;padding-top:10px';panel.append(content);
    for(const [key,title,options] of [['character','Personagem',[['explorador','Explorador'],['botanica','Botânica'],['mineiro','Mineiro']]],['slim','Braços',[['false','Clássicos'],['true','Finos']]],['tool','Ferramenta',[['none','Sem ferramenta'],['pickaxe','Picareta'],['axe','Machado'],['shovel','Pá'],['sword','Espada']]],['material','Material',[['iron','Ferro'],['wood','Madeira'],['stone','Pedra'],['crystal','Cristal']]]]) {
      const label=document.createElement('label');label.textContent=title+' ';const select=document.createElement('select');select.setAttribute('aria-label',title);select.style.cssText='color:#f5eedb;background:#26352c;padding:5px;border-radius:5px';
      for(const [value,text] of options){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}select.value=String(settings[key]);label.append(select);content.append(label);
      listen(select,'change',()=>{settings[key]=key==='slim'?select.value==='true':select.value;if(key==='character')skinCanvas=null;apply();save();});
    }
    const label=document.createElement('label');label.textContent='Importar skin PNG ';const file=document.createElement('input');file.type='file';file.accept='image/png';file.style.maxWidth='100%';label.append(file);content.append(label);
    const status=document.createElement('small');status.textContent='Personagens Kraft em alta definição. Você também pode importar uma skin Minecraft PNG. A escolha fica salva neste navegador.';content.append(status);
    listen(file,'change',()=>{if(file.files?.[0])importSkin(file.files[0]).then(()=>{status.textContent='Skin aplicada e salva neste navegador.';}).catch(e=>{status.textContent=e.message;});});
    for(const e of ['keydown','keyup'])listen(panel,e,event=>event.stopPropagation());parent.append(panel);panels.push(panel);
  }
  function update(dt) {
    const mach=game.machado,kind=mach?.ativo?'axe':settings.tool;   // tecla Z: machado na mão, seja qual for a ferramenta de enfeite
    const real=kind==='axe'?machadoReal():null;
    const key=real?'machado-real':settings.material+'-'+kind;
    if(kind!=='none'&&key!==stats.key){
      if(real){near.geometry=held.geometry=real.geometry;near.material=held.material=real.material;}
      else {near.geometry=held.geometry=toolGeometry(key);near.material=held.material=materialFor(key);}
      // o machado realista é fino: na mão de quem joga fica um pouco maior e de face para a câmera (a lâmina aparece)
      near.rotation.set(-2.15,real?.5:0,-.4);near.scale.setScalar(real?1.25:1);
      stats.key=key;
    }
    if(real)real.material.envMapIntensity=.12+.8*(1-(U.uNight?.value||0));   // de noite o aço não reflete céu claro
    const active=game.state==='PLAYING'&&!game.overlay&&!game.xr?.presenting;
    fp.root.visible=active&&game.camDist<.6;held.visible=active&&kind!=='none';near.visible=kind!=='none';
    const swing=active&&input.isDown('break');phase=swing?phase+dt*11:phase*Math.exp(-dt*14);
    let hit=swing?Math.sin(phase)*.55:Math.sin(phase)*.12,conj=null,hit3=0;
    // Golpe do machado (game/machado.js). Em primeira pessoa o braço e o machado giram JUNTOS, como uma peça só, em volta
    // do ombro: erguem devagar por trás (POSE_ALTO), descem de uma vez em arco para o meio da tela, onde está a mira
    // (POSE_IMPACTO: a cabeça do machado cai sobre a madeira), estancam com um pequeno quique e voltam.
    if(mach?.golpe&&kind==='axe') {
      const f=faseDoGolpe(mach.golpe.t),ease=k=>k*k*(3-2*k),mix=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
      if(f.fase==='prepara'){const k=ease(f.k);conj=mix(POSE_PARADO,POSE_ALTO,k);hit3=-.7*k;}
      else if(f.fase==='desce'){const k=f.k*f.k;conj=mix(POSE_ALTO,POSE_IMPACTO,k);hit3=-.7+1.5*k;}
      else {const k=ease(Math.min(1,f.k*1.12));conj=mix(POSE_IMPACTO,POSE_PARADO,k);if(mach.golpe.acertou)conj[0]+=Math.sin(Math.min(1,f.k*3)*Math.PI)*.07;hit3=.8*(1-k);}
      hit=0;phase=0;
    }
    if(conj){giraConjunto(conj[0],conj[1],conj[2]);girou=true;}
    else if(girou){giraConjunto(0,0,0);girou=false;}
    fp.armR.rotation.set(2.15-hit,0,-.12);fp.elbowR.rotation.x=.08+Math.max(0,hit)*.2;
    if(conj)hit=hit3;   // o boneco visto de fora acompanha o golpe com o braço
    if(self.root.visible){self.armR.rotation.x+=.25+hit;self.elbowR.rotation.x=.13+Math.max(0,hit)*.5;}
    self.elbowL.rotation.x=.08;self.kneeL.rotation.x=-Math.max(0,-self.legL.rotation.x)*.5;self.kneeR.rotation.x=-Math.max(0,-self.legR.rotation.x)*.5;
  }
  return {stats,settings,importSkin,apply,update,firstPerson:fp,held,dispose(){if(dead)return;dead=true;listeners.forEach(f=>f());panels.forEach(p=>p.remove());camera.remove(fp.root);self.elbowR.remove(held);fp.dispose();mat.dispose();wood.dispose();grain.dispose();Object.values(heads).forEach(m=>m.dispose());}};
}
