// Estado autoritativo de árvores: servidor e offline usam exatamente este módulo.
import { B, SOLID, KIND, K_CROSS } from './blocks.js';
import { treeKey, treeGraph, treeAtBlock, ownedTreeCells, leafBranch, treeComponents, woodId, rootId, leafId, cleanTreeStyles, isTreeWood, treeVoxelMap } from './trees.js';
import { buildBody, newState, stepBody, toWorld, syncRotation } from '../src/machines/physics.js';
import { REBROTA, terraFirme, gDoEstagio, estagioDaIdade, pivo, espacoLivre, tocaZona, arvoreDoGalho, sorteio } from './rebrota.js';

const CONTROL={drive:0,steer:0,lift:0};
const point=[0,0,0];
const origin=t=>[t.x+.5,t.y+1,t.z+.5];
// Sem madeira e já no chão, a pilha seca e some neste prazo. Minerar uma folha tira ela antes.
export const DRY_SECONDS=150;

export function leafWorld(rec,cell,out,st=rec.st){
  const x=cell[0]+.5-(rec.tree.x+.5+rec.body.com[0]),y=cell[1]+.5-(rec.tree.y+1+rec.body.com[1]),z=cell[2]+.5-(rec.tree.z+.5+rec.body.com[2]);
  toWorld(st.R,[x,y,z],out);
  out[0]+=st.p[0];out[1]+=st.p[1];out[2]+=st.p[2];
  return out;
}

export function buildTreeBody(graph,ids,leaves,t){
  const samples=[];
  for(const id of ids){
    const s=graph[id],length=Math.hypot(...s.b.map((v,i)=>v-s.a[i])),n=Math.max(1,Math.ceil(length/.55));
    for(let i=0;i<=n;i++){const f=i/n;samples.push([...s.a.map((v,j)=>v+(s.b[j]-v)*f),s.r0+(s.r1-s.r0)*f]);}
  }
  if(!samples.length){const o=origin(t);for(let i=0;i<leaves.length;i+=Math.max(1,Math.ceil(leaves.length/24))){const c=leaves[i];samples.push([c[0]+.5-o[0],c[1]+.5-o[1],c[2]+.5-o[2],.12]);}}
  if(!samples.length)return null;
  // O casco acompanha a espessura da madeira; a copa é permeável, não sustenta
  // um tronco vários metros acima do chão como uma caixa invisível.
  const body=buildBody(samples.map(p=>[p[0]-.5,p[1]-.5,p[2]-.5,woodId(t)]));
  body.passiveTree=true;
  body.hull=samples.map(p=>[p[0]-body.com[0],p[1]-body.com[1],p[2]-body.com[2],p[3]]);
  return body;
}

function packState(st){return {p:st.p.slice(),q:st.q.slice(),v:st.v.slice(),w:st.w.slice(),asleep:st.asleep};}
function restoreState(raw,fallback){
  const finite=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
  const st=newState(finite(raw?.p,3)?raw.p:fallback,finite(raw?.q,4)?raw.q:null);
  if(finite(raw?.v,3))st.v=raw.v.slice();if(finite(raw?.w,3))st.w=raw.w.slice();st.asleep=!!raw?.asleep;
  return st;
}

const ESTADOS=new Set(['toco','crescendo','adulta']);
const num=(v,d=0)=>Number.isFinite(v)?v:d;

export class FallingTrees {
  // zona(x, y, z) → true onde nada pode nascer (campo de futebol); rebrota troca os números (testes)
  constructor({gen,get,edited=()=>false,set,emit=()=>{},changed=()=>{},zona=null,rebrota=REBROTA}){
    Object.assign(this,{gen,get,edited,set,emit,changed,zona});this.seed=gen.seed;this.cuts=new Map();this.bodies=new Map();this.nextId=1;
    // Rebrota (shared/rebrota.js): árvores que nascem de raiz cortada ou de galho no chão. tempo = relógio do crescimento
    // em segundos de verdade (× ritmo), gravado; rbAtraso = tempo que passou com o servidor desligado, aplicado no 1º passo.
    this.R=rebrota;this.plantadas=new Map();this.porRaiz=new Map();this.plantaId=1;this.tempo=0;this.rbAcc=0;this.rbAtraso=0;this.cutsMudou=true;
    // semRebrota: tocos cortados antes de a rebrota existir (decisão do Kadmus, 19/11: "só cortes novos"); ver load()
    this.semRebrota=new Set();
    this.styles=cleanTreeStyles();this.source='tabelas';this.clock=0;this.acc=0;this.cursor=0;this.lastWork=0;this.lagged=0;this.moved=false;
    this.collisionGet=(x,y,z)=>{const b=this.get(x,y,z);return b===B.LEAVES||b===B.PINE_LEAVES?B.AIR:b;};this.collisionGet.shape=get.shape;
  }
  tree(x,z){const t=this.gen.treeAt?.(Math.floor(x/5),Math.floor(z/5));return t&&t.kind!==3&&t.x===x&&t.z===z?t:null;}
  graph(t,style=this.styles[t.kind]){return treeGraph(t,this.seed,style);}
  removed(t){return this.cuts.get(treeKey(t))||new Set();}
  active(t,graph=this.graph(t)){
    const cut=this.removed(t),ids=[];
    for(const s of graph){
      if(cut.has(s.id))continue;
      if(s.trunk){const y=t.y+1+s.id,b=this.get(t.x,y,t.z);if(b!==(s.id===0?rootId(t):woodId(t))&&!(this.edited(t.x,y,t.z)&&SOLID[b]))continue;}
      ids.push(s.id);
    }
    return ids;
  }
  create(t,style,ids,leaves,inherit=null,from=null){
    const graph=this.graph(t,style),body=buildTreeBody(graph,ids,leaves,t);if(!body)return null;
    const o=origin(t),st=newState(o.map((v,i)=>v+body.com[i]));
    if(inherit){
      st.q=inherit.st.q.slice();syncRotation(st);
      toWorld(st.R,body.com.map((v,i)=>v-inherit.body.com[i]),point);
      st.p=inherit.st.p.map((v,i)=>v+point[i]);st.v=inherit.st.v.slice();st.w=inherit.st.w.slice();
      st.v[0]+=st.w[1]*point[2]-st.w[2]*point[1];st.v[1]+=st.w[2]*point[0]-st.w[0]*point[2];st.v[2]+=st.w[0]*point[1]-st.w[1]*point[0];
    }else{
      let dx=from?t.x+.5-from[0]:1,dz=from?t.z+.5-from[2]:.4,n=Math.hypot(dx,dz);if(n<.01){dx=1;dz=.4;n=Math.hypot(dx,dz);}dx/=n;dz/=n;
      st.v=[dx*.7,-.1,dz*.7];st.w=[dz*.55,0,-dx*.55];
    }
    const rec={id:this.nextId++,tree:{...t},style,ids:ids.slice(),leaves:leaves.map(c=>c.slice()),graph,body,st,dry:0,leafLife:0,raizDesde:0,brotou:0};
    this.bodies.set(rec.id,rec);this.changed();this.emit({t:'tree+',tree:this.pack(rec)});return rec;
  }
  pack(rec){return {id:rec.id,tree:rec.tree,style:rec.style,ids:rec.ids,leaves:rec.leaves,state:packState(rec.st),dry:rec.dry||0,leafLife:rec.leafLife||0,raizDesde:rec.raizDesde||0,brotou:rec.brotou||0};}
  save(){return {v:1,nextId:this.nextId,styles:this.styles,source:this.source,cuts:[...this.cuts].map(([k,s])=>[k,[...s]]),bodies:[...this.bodies.values()].map(r=>this.pack(r)),
    tempo:this.tempo,plantaId:this.plantaId,plantadas:[...this.plantadas.values()].map(p=>this.packPlanta(p)),rebrota:1,semRebrota:[...this.semRebrota]};}
  load(data){
    this.cuts.clear();this.bodies.clear();this.styles=cleanTreeStyles(data?.styles);this.source=typeof data?.source==='string'?data.source:'tabelas';this.nextId=1;
    this.plantadas.clear();this.porRaiz.clear();this.plantaId=Math.max(1,num(data?.plantaId,1));this.tempo=Math.max(0,num(data?.tempo,0));this.cutsMudou=true;
    for(const raw of data?.plantadas||[])this.recebePlanta(raw,false);
    for(const [key,list] of data?.cuts||[])if(typeof key==='string'&&Array.isArray(list))this.cuts.set(key,new Set(list.filter(Number.isInteger)));
    for(const raw of data?.bodies||[]){
      const t=raw.tree;if(!t||![t.x,t.y,t.z,t.th,t.kind].every(Number.isFinite)||!Array.isArray(raw.ids)||!Array.isArray(raw.leaves))continue;
      const graph=this.graph(t,raw.style),ids=raw.ids.filter(id=>Number.isInteger(id)&&graph[id]);
      const leaves=raw.leaves.filter(c=>Array.isArray(c)&&c.length===4&&c.every(Number.isFinite));
      const body=buildTreeBody(graph,ids,leaves,t);if(!body)continue;
      const st=restoreState(raw.state,origin(t).map((v,i)=>v+body.com[i]));
      this.bodies.set(raw.id,{id:raw.id,tree:t,style:raw.style,ids,leaves,graph,body,st,dry:Number.isFinite(raw.dry)?raw.dry:0,leafLife:Number.isFinite(raw.leafLife)?raw.leafLife:0,raizDesde:Math.max(0,num(raw.raizDesde)),brotou:raw.brotou===1||raw.brotou===-1?raw.brotou:0});this.nextId=Math.max(this.nextId,raw.id+1);
    }
    this.nextId=Math.max(this.nextId,data?.nextId||1);
    this.semRebrota=new Set((Array.isArray(data?.semRebrota)?data.semRebrota:[]).filter(k=>typeof k==='string'));
    // Mundo inteiro gravado antes da rebrota (tem a lista de cortes, não tem a marca `rebrota`): os tocos e os galhos
    // caídos que já existiam ficam como estão; só o que for cortado daqui em diante brota (decisão do Kadmus, 19/11).
    // Estado parcial (só um corpo, como o que o aparelho recebe quando uma árvore cai) não conta como mundo antigo.
    if(data&&Array.isArray(data.cuts)&&!data.rebrota){
      for(const k of this.cuts.keys())this.semRebrota.add(k);
      for(const r of this.bodies.values())if(!r.brotou)r.brotou=-1;
    }
  }
  cutBlock(x,y,z,from){const t=treeAtBlock(this.gen,x,y,z);return t&&isTreeWood(this.get(x,y,z))?this.cut(t,y-t.y-1,from):false;}
  cut(t,id,from){
    const graph=this.graph(t),active=this.active(t,graph);if(!Number.isInteger(id)||!active.includes(id))return false;
    const cells=ownedTreeCells(this.gen,t,this.get,this.edited),root=treeKey(t),removed=new Set(this.removed(t));
    this.cutsMudou=true;
    this.semRebrota.delete(root);   // corte novo num toco antigo: daqui em diante segue a regra da rebrota
    // Rebrota sobre este toco: cortar o toco abaixo da copa nova derruba a copa (adulta) ou a quebra (nova).
    const sobre=this.plantadas.get(this.porRaiz.get(root));
    if(sobre&&graph[id].trunk&&id<sobre.k){
      if(sobre.estado!=='toco'&&sobre.g>=1)this.cortarPlantada(sobre.id,sobre.k,from);
      if(id===0)this.removePlanta(sobre.id);else{sobre.k=id;this.voltarAoToco(sobre);}
    }
    // A madeira colocada pelo jogador funciona como uma ligação preservada.
    const anchors=new Set(active.filter(i=>i===0||graph[i].trunk&&this.edited(t.x,t.y+1+i,t.z)));
    anchors.delete(id);removed.add(id);
    const pieces=treeComponents(graph,active.filter(i=>i!==id)),fall=pieces.filter(p=>!p.some(i=>anchors.has(i)));
    const falling=new Set(fall.flat());for(const i of falling)removed.add(i);
    this.cuts.set(root,removed);
    const leavesByPart=fall.map(()=>[]),erase=[];
    for(const c of cells){
      const [x,y,z,b]=c;
      if(isTreeWood(b)){if(falling.has(y-t.y-1)||y-t.y-1===id)erase.push(c);continue;}
      const owner=leafBranch(t,graph,x,y,z);let p=fall.findIndex(part=>part.includes(owner));
      if(owner===id&&p<0){if(!fall.length){fall.push([]);leavesByPart.push([]);}p=0;}
      if(p>=0){leavesByPart[p].push(c);erase.push(c);}
    }
    // O alvo explícito pode ser uma madeira alterada pelo próprio jogador.
    if(graph[id].trunk){const y=t.y+1+id;if(isTreeWood(this.get(t.x,y,t.z)))erase.push([t.x,y,t.z,this.get(t.x,y,t.z)]);}
    const unique=new Map(erase.map(c=>[c.slice(0,3).join(','),c]));
    const changed=[];for(const [x,y,z] of unique.values()){this.set(x,y,z,B.AIR);changed.push([x,y,z,B.AIR]);}
    this.changed();this.emit({t:'treeCut',key:root,removed:[...removed],cells:changed});
    for(let i=0;i<fall.length;i++)this.create(t,this.styles[t.kind],fall[i],leavesByPart[i],null,from);
    return true;
  }
  cutFallen(id,node){
    const rec=this.bodies.get(id);if(!rec||!Number.isInteger(node)||node<0||!rec.ids.includes(node))return false;
    this.bodies.delete(id);this.emit({t:'tree-',id});this.changed();
    const parts=treeComponents(rec.graph,rec.ids.filter(i=>i!==node)),leaves=parts.map(()=>[]);
    for(const c of rec.leaves){const branch=leafBranch(rec.tree,rec.graph,...c);let i=parts.findIndex(p=>p.includes(branch));if(i<0&&parts.length)i=0;if(i>=0)leaves[i].push(c);}
    for(let i=0;i<parts.length;i++)this.create(rec.tree,rec.style,parts[i],leaves[i],rec);
    // A última madeira sai, e as folhas ficam no chão até serem mineradas ou secarem.
    if(!parts.length&&rec.leaves.length)this.create(rec.tree,rec.style,[],rec.leaves,rec);
    return true;
  }
  takeLeaf(id,x,y,z){
    const rec=this.bodies.get(id);if(!rec)return null;
    const i=rec.leaves.findIndex(c=>c[0]===x&&c[1]===y&&c[2]===z);if(i<0)return null;
    const cell=rec.leaves[i];
    rec.leaves.splice(i,1);
    this.emit({t:'treeLeaf',id,x,y,z,dry:rec.dry||0});
    if(!rec.leaves.length&&!rec.ids.length){this.bodies.delete(id);this.emit({t:'tree-',id});}
    this.changed();
    return cell;
  }
  // ---- Rebrota: árvores que nascem de raiz cortada (base 'raiz', sobre o toco natural) ou de galho no chão ('galho') ----
  packPlanta(p){const t=p.t;return {id:p.id,t:{x:t.x,y:t.y,z:t.z,kind:t.kind,th:t.th,rad:t.rad,h:t.h|0},base:p.base,key:p.key,mae:p.mae,k:p.k,estado:p.estado,desde:p.desde,nasc:p.nasc,s:p.s,g:p.g,obstr:p.obstr,tentar:p.tentar,cortados:[...p.cortados]};}
  // Lê uma planta gravada ou recebida pela rede; devolve a planta (ou null se veio torta).
  recebePlanta(raw,avisa=false){
    const t=raw?.t;if(!t||![t.x,t.y,t.z,t.th,t.rad,t.kind].every(Number.isFinite)||!Number.isInteger(raw.id))return null;
    if(raw.base!=='raiz'&&raw.base!=='galho'||!ESTADOS.has(raw.estado))return null;
    const p={id:raw.id,t:{x:t.x|0,y:t.y|0,z:t.z|0,kind:t.kind|0,th:Math.max(1,t.th|0),rad:+t.rad,h:t.h|0},base:raw.base,key:typeof raw.key==='string'?raw.key:null,
      mae:typeof raw.mae==='string'?raw.mae:null,k:Math.max(0,raw.k|0),estado:raw.estado,desde:num(raw.desde),nasc:num(raw.nasc),s:Number.isInteger(raw.s)?raw.s:-1,
      g:Math.max(0,Math.min(1,num(raw.g))),obstr:Math.max(0,num(raw.obstr)),tentar:num(raw.tentar),cortados:new Set((raw.cortados||[]).filter(Number.isInteger))};
    if(p.base==='raiz'){p.key=treeKey(p.t);if(p.k<1)return null;}else p.k=0;
    const old=this.plantadas.get(p.id);if(old?.key)this.porRaiz.delete(old.key);
    this.plantadas.set(p.id,p);if(p.key)this.porRaiz.set(p.key,p.id);this.plantaId=Math.max(this.plantaId,p.id+1);
    if(avisa)this.changed();
    return p;
  }
  avisaPlanta(p){this.changed();this.emit({t:'planta',p:this.packPlanta(p)});}
  esquecePlanta(id){const p=this.plantadas.get(id);if(!p)return false;this.plantadas.delete(id);if(p.key&&this.porRaiz.get(p.key)===id)this.porRaiz.delete(p.key);return true;}
  removePlanta(id){if(!this.esquecePlanta(id))return;this.changed();this.emit({t:'planta-',id});}
  // nós da árvore adulta que pertencem à planta: sem o toco natural (tronco abaixo de k) e sem o que já foi cortado
  idsPlantada(p,graph=this.graph(p.t)){const out=[];for(const s of graph){if(s.trunk&&s.id<p.k)continue;if(p.cortados.has(s.id))continue;out.push(s.id);}return out;}
  // folhas da copa adulta cujos galhos seguem na planta (desenho e queda)
  folhasPlantada(p,graph=this.graph(p.t),ids=this.idsPlantada(p,graph)){
    if(p.estado==='toco')return [];
    const keep=new Set(ids),lid=leafId(p.t),out=[];
    for(const c of treeVoxelMap(p.t,this.seed).values())if(c[3]===lid&&keep.has(leafBranch(p.t,graph,c[0],c[1],c[2])))out.push(c);
    return out;
  }
  voltarAoToco(p){
    p.estado='toco';p.desde=this.tempo;p.s=-1;p.nasc=0;p.obstr=0;p.tentar=0;
    // a planta de galho guarda a própria raiz (nó 0) no tamanho em que estava; a de raiz fica só com o toco natural
    if(p.base==='galho'){p.cortados=new Set(this.graph(p.t).filter(s=>s.id!==0).map(s=>s.id));}else{p.cortados=new Set();p.g=0;}
    this.avisaPlanta(p);
  }
  // Corta a planta no nó `node`. Árvore nova (g < 1) quebra inteira e sobra o toco; adulta cai como a natural.
  cortarPlantada(id,node,from){
    const p=this.plantadas.get(id);if(!p||!Number.isInteger(node))return false;
    if(p.estado==='toco'){if(p.base==='galho'&&node===0){this.removePlanta(id);return true;}return false;}
    const graph=this.graph(p.t),ids=this.idsPlantada(p,graph);if(!ids.includes(node))return false;
    if(p.g<1){if(node===0)this.removePlanta(id);else this.voltarAoToco(p);return true;}
    const stump=[];for(let i=0;i<p.k;i++)stump.push(i);
    const pieces=treeComponents(graph,[...stump,...ids].filter(i=>i!==node)),fall=pieces.filter(part=>!part.includes(0));
    const falling=new Set(fall.flat()),leavesByPart=fall.map(()=>[]);
    for(const c of this.folhasPlantada(p,graph,ids)){
      const owner=leafBranch(p.t,graph,c[0],c[1],c[2]);let i=fall.findIndex(part=>part.includes(owner));
      if(owner===node&&i<0){if(!fall.length){fall.push([]);leavesByPart.push([]);}i=0;}
      if(i>=0)leavesByPart[i].push(c);
    }
    p.cortados.add(node);for(const i of falling)p.cortados.add(i);
    for(let i=0;i<fall.length;i++)this.create(p.t,this.styles[p.t.kind],fall[i],leavesByPart[i],null,from);
    if(node===0)this.removePlanta(id);
    else if(!this.idsPlantada(p,graph).some(i=>graph[i].trunk))this.voltarAoToco(p);   // o tronco da planta foi embora
    else this.avisaPlanta(p);
    return true;
  }
  // relógio do crescimento: dt em segundos de verdade (servidor e offline chamam no laço)
  crescer(dt){
    if(!(dt>0))return;
    const step=Math.min(dt,5);this.tempo+=step*this.R.ritmo;this.rbAcc+=step;
    if(this.rbAcc<this.R.passo)return;
    const d=this.rbAcc*this.R.ritmo+this.rbAtraso;this.rbAcc=0;this.rbAtraso=0;this.passoRebrota(d);
  }
  // o servidor ficou desligado `seg` segundos de crescimento: o mundo anda esse tempo no próximo passo
  atrasar(seg){if(seg>0){this.tempo+=seg;this.rbAtraso+=seg;this.changed();}}
  // /rebrota adiantar: anda o relógio de uma vez (ensaio e GM)
  adiantar(seg){if(!(seg>0))return;this.tempo+=seg;this.passoRebrota(seg+this.rbAtraso);this.rbAtraso=0;this.changed();}
  passoRebrota(d){
    if(this.cutsMudou){this.cutsMudou=false;this.acharTocos();}
    if((this.rbGalho=(this.rbGalho||0)+d)>=10){this.rbGalho=0;this.enraizarGalhos();}   // galhos: conferidos a cada 10 s de crescimento
    for(const p of [...this.plantadas.values()])this.cuidarPlanta(p);
  }
  // Toco = árvore natural cortada rente, sem galho em pé, com a raiz natural fixa em terra ou gramado.
  alturaDoToco(t,graph=this.graph(t)){
    const active=this.active(t,graph);let k=0;
    for(const id of active){if(!graph[id].trunk)return 0;}
    while(active.includes(k))k++;
    return k===active.length?k:0;
  }
  raizViva(t){const y=t.y+1;return this.get(t.x,y,t.z)===rootId(t)&&!this.edited(t.x,y,t.z)&&terraFirme(this.get(t.x,t.y,t.z));}
  acharTocos(){
    for(const [key,removed] of this.cuts){
      if(this.porRaiz.has(key)||this.semRebrota.has(key)||removed.has(0)||![...removed].some(i=>i>=1))continue;   // a altura do toco sai de alturaDoToco
      if(this.plantadas.size>=this.R.totalPlantas)return;
      const [x,z]=key.split(',').map(Number),t=this.tree(x,z);if(!t)continue;
      const k=this.alturaDoToco(t);if(k<1||!this.raizViva(t))continue;
      const p={id:this.plantaId++,t:{x:t.x,y:t.y,z:t.z,kind:t.kind,th:t.th,rad:t.rad,h:t.h|0},base:'raiz',key,mae:key,k,estado:'toco',desde:this.tempo,nasc:0,s:-1,g:0,obstr:0,tentar:0,cortados:new Set()};
      if(tocaZona(p,this.seed,this.zona))continue;
      this.plantadas.set(p.id,p);this.porRaiz.set(key,p.id);this.avisaPlanta(p);
    }
  }
  baseViva(p){
    if(p.base==='raiz'){
      const t=this.tree(p.t.x,p.t.z);if(!t||!this.raizViva(t))return false;
      const k=this.alturaDoToco(t);if(k<1)return false;
      if(k!==p.k){p.k=k;this.voltarAoToco(p);}       // alguém mexeu no toco: a copa nova recomeça sobre a altura nova
      return true;
    }
    const {x,y,z}=p.t;return terraFirme(this.get(x,y,z))&&!this.edited(x,y,z);
  }
  // Espaço para o tamanho g? Não: marca desde quando está obstruída e tenta de novo daqui a 60 s de crescimento.
  espacoPara(p,g){
    if(p.tentar&&this.tempo<p.tentar)return false;
    if(espacoLivre(p,this.seed,g,this.get,this.edited)&&!(g>=1&&tocaZona(p,this.seed,this.zona))){p.obstr=0;p.tentar=0;return true;}
    if(!p.obstr)p.obstr=this.tempo;p.tentar=this.tempo+60;return false;
  }
  cuidarPlanta(p){
    const R=this.R;
    if(!this.baseViva(p))return this.removePlanta(p.id);
    if(p.estado==='adulta')return;
    if(p.estado==='toco'&&this.tempo-p.desde<R.broto)return;
    let mudou=false;
    if(p.estado==='toco'){
      const preso=p.obstr;
      if(!this.espacoPara(p,gDoEstagio(0,R))){if(p.obstr&&this.tempo-p.obstr>R.desiste)this.removePlanta(p.id);return;}
      // brotou quando a dormência acabou (salto grande de relógio: servidor desligado ou /rebrota adiantar), ou agora se estava presa
      p.estado='crescendo';p.nasc=preso?this.tempo:p.desde+R.broto;p.s=0;p.g=gDoEstagio(0,R);p.cortados=new Set();mudou=true;
    }
    // idade = tempo − nasc; obstruída num degrau, a idade fica presa nele (nasc anda junto), sem "recuperar" depois
    const n=R.estagios-1;
    while(p.s<estagioDaIdade(this.tempo-p.nasc,R)){
      const g=gDoEstagio(p.s+1,R);
      if(!this.espacoPara(p,g)){
        p.nasc=Math.max(p.nasc,this.tempo-(p.s+1)*R.adulta/n);
        if(p.obstr&&this.tempo-p.obstr>R.desiste){this.removePlanta(p.id);return;}
        break;
      }
      p.s++;p.g=g;mudou=true;
    }
    if(p.s>=n){p.s=n;p.g=1;p.estado='adulta';mudou=true;}
    if(mudou)this.avisaPlanta(p);
  }
  // Galho de madeira parado sobre terra/gramado natural: conta o tempo; passado `galho`, cria raiz e vira árvore nova.
  chaoDoGalho(rec){
    const w=[0,0,0];let best=null;
    for(const h of rec.body.hull){toWorld(rec.st.R,h,w);const y=rec.st.p[1]+w[1]-h[3];if(!best||y<best[1])best=[rec.st.p[0]+w[0],y,rec.st.p[2]+w[2]];}
    if(!best)return null;
    return this.chaoEm(Math.floor(best[0]),best[1],Math.floor(best[2]));
  }
  // chão firme logo abaixo de (x, yPonto, z): terra/gramado natural com o pé livre em cima, a até 0,8 m do ponto
  chaoEm(x,yPonto,z){
    for(let y=Math.floor(yPonto+.2);y>=Math.floor(yPonto)-2;y--){
      const b=this.collisionGet(x,y,z);if(b===-1||b===undefined)return null;
      if(!b||!SOLID[b])continue;
      if(!terraFirme(b)||this.edited(x,y,z)||yPonto-(y+1)>.8)return null;
      const pe=this.get(x,y+1,z);if(pe!==B.AIR&&!(KIND[pe]===K_CROSS&&!this.edited(x,y+1,z)))return null;
      return {x,y,z};
    }
    return null;
  }
  podeNascerEm(x,z,mae){
    const R=this.R,d2=R.distMin*R.distMin;
    for(const t of this.gen.treesNear?.(x,z,R.distMin+1)||[]){
      if((t.x-x)**2+(t.z-z)**2>=d2)continue;
      const a=this.active(t);if(a.includes(0))return false;          // árvore (ou toco vivo) do gerador perto demais
    }
    let area=0,filhas=0,galho=0;const ax=Math.floor(x/R.areaLado),az=Math.floor(z/R.areaLado);
    for(const p of this.plantadas.values()){
      if((p.t.x-x)**2+(p.t.z-z)**2<d2)return false;
      if(p.base!=='galho')continue;galho++;
      if(Math.floor(p.t.x/R.areaLado)===ax&&Math.floor(p.t.z/R.areaLado)===az)area++;
      if(p.mae===mae)filhas++;
    }
    return area<R.areaMax&&filhas<R.porMae&&galho<R.totalGalho&&this.plantadas.size<R.totalPlantas;
  }
  plantaDoGalho(rec){
    // cada coluna onde o galho encosta no chão é candidata; primeiro as mais longe da mãe (a mata se espalha)
    const R=this.R,mae=treeKey(rec.tree),w=[0,0,0],cols=new Map(),mx=rec.tree.x+.5,mz=rec.tree.z+.5;
    for(const h of rec.body.hull){toWorld(rec.st.R,h,w);const p=[rec.st.p[0]+w[0],rec.st.p[1]+w[1]-h[3],rec.st.p[2]+w[2]],k=Math.floor(p[0])+','+Math.floor(p[2]),o=cols.get(k);if(!o||p[1]<o[1])cols.set(k,p);}
    const lista=[...cols.values()].sort((a,b)=>Math.hypot(b[0]-mx,b[2]-mz)-Math.hypot(a[0]-mx,a[2]-mz)||a[1]-b[1]||a[0]-b[0]||a[2]-b[2]);
    for(const c of lista){
      const x=Math.floor(c[0]),z=Math.floor(c[2]),chao=this.chaoEm(x,c[1],z);if(!chao||!this.podeNascerEm(x,z,mae))continue;
      const t=arvoreDoGalho(this.seed,rec.tree.kind===1||rec.tree.kind===2||rec.tree.kind===4?rec.tree.kind:0,x,chao.y,z);
      const quando=Math.min(this.tempo,(rec.raizDesde||this.tempo)+R.galho);   // brotou quando a raiz pegou
      const p={id:0,t,base:'galho',key:null,mae,k:0,estado:'crescendo',desde:quando,nasc:quando,s:0,g:gDoEstagio(0,R),obstr:0,tentar:0,cortados:new Set()};
      if(tocaZona(p,this.seed,this.zona)||!espacoLivre(p,this.seed,p.g,this.get,this.edited))continue;
      p.id=this.plantaId++;this.plantadas.set(p.id,p);this.avisaPlanta(p);return p;
    }
    return null;
  }
  enraizarGalhos(){
    const R=this.R;
    for(const rec of this.bodies.values()){
      if(rec.brotou||!rec.ids.length)continue;
      if(!rec.st.asleep||!this.chaoDoGalho(rec)){if(rec.raizDesde){rec.raizDesde=0;this.changed();}continue;}
      if(!rec.raizDesde){rec.raizDesde=this.tempo||1e-6;this.changed();continue;}
      if(this.tempo-rec.raizDesde<R.galho)continue;
      if(sorteio(this.seed,rec.id,rec.tree.x,rec.tree.z)>=R.chanceGalho){rec.brotou=-1;this.changed();continue;}   // este galho não pegou
      if(this.plantaDoGalho(rec)){rec.brotou=1;this.changed();}
      else{rec.raizDesde=this.tempo;this.changed();}   // sem lugar agora (perto de outra árvore, teto da área…): tenta de novo daqui a `galho`
    }
  }
  advance(dt){
    this.clock+=dt;this.moved=false;
    const env={getBlock:this.collisionGet,water:false};
    this.acc+=Math.max(0,Math.min(.25,dt));
    const steps=Math.floor((this.acc+1e-9)*60);this.acc=Math.max(0,this.acc-steps/60);
    const active=[...this.bodies.values()].filter(r=>!r.st.asleep);
    for(const rec of active)rec.pending=Math.min(12,(rec.pending||0)+steps);
    let budget=steps*800,skips=0;this.lastWork=0;
    // Rodízio por trabalho de colisão, sem corpos descartados. Sob rajadas muito
    // grandes a queda desacelera; a fila é justa e o atraso não cresce sem limite.
    while(active.length&&budget>0&&skips<active.length){
      const rec=active[this.cursor%active.length];
      if(rec.st.asleep||!rec.pending){this.cursor=(this.cursor+1)%active.length;skips++;continue;}
      const cost=rec.body.hull.length;if(cost>budget)break;
      this.cursor=(this.cursor+1)%active.length;
      stepBody(rec.body,rec.st,CONTROL,1/60,env);rec.pending--;budget-=cost;this.lastWork+=cost;this.moved=true;skips=0;
    }
    this.lagged=active.filter(r=>r.pending&&!r.st.asleep).length;
    if(this.moved)this.changed();
    this.dryLeaves(Math.max(0,Math.min(.25,dt)));
  }
  dryLeaves(step){
    if(!step)return;
    const gone=[];
    for(const rec of this.bodies.values()){
      if(rec.ids.length||!rec.st.asleep||!rec.leaves.length)continue;
      rec.dry=(rec.dry||0)+step;
      if(!rec.leafLife)rec.leafLife=rec.leaves.length;
      const keep=Math.max(0,Math.ceil(rec.leafLife*(1-Math.min(1,rec.dry/DRY_SECONDS))));
      if(rec.leaves.length>keep){
        rec.leaves.length=keep;
        if(keep>0)this.emit({t:'treeDry',id:rec.id,n:keep,dry:rec.dry});
        this.changed();
      }
      if(!rec.leaves.length)gone.push(rec.id);
    }
    for(const id of gone){this.bodies.delete(id);this.emit({t:'tree-',id});this.changed();}
  }
  wakeNear(x,y,z){for(const r of this.bodies.values())if(Math.hypot(x-r.st.p[0],y-r.st.p[1],z-r.st.p[2])<r.body.radius+2){r.st.asleep=false;r.st.still=0;r.st.restPose=null;}}
  setStyles(styles,source){this.styles=cleanTreeStyles(styles);this.source=source;this.changed();this.emit({t:'treeStyles',styles:this.styles,source});}
}
