// Moradores, lavoura e carpas do xogunato. A simulação decorre do relógio dos aparelhos;
// nenhuma entidade precisa acordar no servidor quando a ilha está vazia.
import * as THREE from '../three.js';
import { B } from '../../shared/blocks.js';
import { CAMPOS_EDO, LAGOS_EDO, ROTAS_SAMURAIS } from '../../shared/xogunato.js';
import { carregarBicho } from '../render/carregador-glb.js';
import { clonarComOssos } from '../render/cavalo-animacao.js';
import { escalaDe } from '../../shared/escala-fauna.js';

const TAU = Math.PI*2;
const tecer = ['#384766','#8b4c44','#506851','#b38542','#5a666c','#713e48'];
const tons = ['#c39777','#dbb397','#bd8769','#e3bea2'];
const folhas = ['#758f45','#7e9c50','#87a456','#b1ae57'];
const tmp = new THREE.Object3D(), tinta = new THREE.Color();

function arrozEmTufo(){
  const pos=[],faces=[];
  for(let i=0;i<8;i++){
    const a=i*2.40,dx=Math.cos(a),dz=Math.sin(a),h=.76+.09*(i%3),r=.18+(i%2)*.07;
    const ix=pos.length/3, tx=-dz*.055,tz=dx*.055;
    pos.push(tx,0,tz,-tx,0,-tz,dx*r+tx*.72,h*.75,dz*r+tz*.72,dx*r-tx*.72,h*.75,dz*r-tz*.72,dx*r*2,h,dz*r*2);
    faces.push(ix,ix+1,ix+2,ix+1,ix+3,ix+2,ix+2,ix+3,ix+4);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(faces);g.computeVertexNormals();
  return g;
}
function lote(root,nome,geo,mat,limite){
  const mesh=new THREE.InstancedMesh(geo,mat,limite);
  mesh.name=nome;mesh.count=0;mesh.frustumCulled=false;mesh.receiveShadow=true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(mesh);
  function gravar(matrix,cor){
    const i=mesh.count++;
    mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,tinta.set(cor));
  }
  return {mesh, gravar, inicio(){mesh.count=0;}, fim(){
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  },por(x,y,z,sx,sy,sz,cor,ry=0,rz=0){
    tmp.position.set(x,y,z);tmp.rotation.set(0,ry,rz,'YXZ');tmp.scale.set(sx,sy,sz);tmp.updateMatrix();
    gravar(tmp.matrix,cor);
  }};
}
function morador(i,samurai){
  const raiz=new THREE.Group(),partes=[];
  const pivo=(pai,x,y,z)=>{const q=new THREE.Object3D();q.position.set(x,y,z);pai.add(q);return q;};
  function parte(pai,forma,cor,x,y,z,sx,sy,sz,rz=0){
    const q=pivo(pai,x,y,z);q.scale.set(sx,sy,sz);q.rotation.z=rz;partes.push([q,forma,cor]);
  }
  const casaco=samurai?['#343d49','#41474d','#472f32','#354241'][i%4]:tecer[i%tecer.length];
  const pele=tons[i%tons.length],palha='#bd9b62',cordao=samurai?'#b79360':'#a69776';
  const peito=pivo(raiz,0,.86,0),cabeca=pivo(peito,0,.66,0);
  parte(peito,'cubos',casaco,0,.22,0,.49,.55,.32);
  parte(peito,'cubos',cordao,0,.02,0,.51,.095,.34);
  parte(peito,'cubos','#dbc8a7',-.06,.37,-.17,.045,.31,.035,-.48);
  parte(peito,'cubos',casaco,.08,.40,-.18,.045,.25,.035,.48);
  parte(cabeca,'ovais',pele,0,.04,0,.32,.37,.30);
  parte(cabeca,'ovais','#342a29',0,.14,.014,.34,.22,.30);
  for(const lado of [-1,1])parte(cabeca,'cubos','#3b302b',lado*.070,.066,-.141,.04,.024,.022);
  if(samurai){
    parte(cabeca,'ovais',casaco,0,.19,0,.42,.28,.39);
    parte(cabeca,'cones',casaco,0,.12,.025,.47,.16,.42);
    for(const s of [-1,1]){
      parte(cabeca,'cubos','#cba357',s*.075,.30,-.11,.040,.22,.045,-s*.52);
      parte(peito,'cubos',casaco,s*.27,.35,0,.18,.31,.32,s*.13);
    }
    for(let j=0;j<3;j++)parte(peito,'cubos',j===1?'#966350':'#505961',0,.16+j*.087,-.17,.44,.033,.035);
    parte(peito,'cubos','#413731',-.28,-.04,.08,.064,.61,.07,-.34);
    parte(peito,'cubos','#b59967',-.32,.22,.08,.12,.044,.11,-.34);
  }else{
    parte(cabeca,'cones',palha,0,.24,0,.70,.24,.70);
    parte(cabeca,'cones','#8b734e',0,.142,0,.66,.055,.66);
  }
  const pernas=[],bracos=[];
  for(const s of [-1,1]){
    const perna=pivo(raiz,s*.135,.83,0),braco=pivo(peito,s*.286,.42,0);
    pernas.push(perna);bracos.push(braco);
    parte(perna,'cubos',samurai?'#383a42':'#4c5358',0,-.24,0,.20,.46,.23);
    parte(perna,'cubos','#48423a',0,-.56,0,.13,.24,.15);
    parte(perna,'cubos','#715942',0,-.75,-.04,.17,.105,.28);
    parte(braco,'cubos',casaco,0,-.16,0,.18,.34,.22);
    parte(braco,'cubos',pele,0,-.38,-.02,.13,.21,.15);
  }
  return {raiz,partes,peito,cabeca,bracos,pernas};
}
function faseCampo(t,i){
  const periodo=145;
  return ((t+i*31)%periodo+periodo)%periodo/periodo;
}
// A mesma varredura em serpentina governa as mudas e as mãos de quem planta e colhe.
function percursoArroz(progresso){
  const passo=Math.min(.99999,Math.max(0,progresso))*6, fileira=Math.floor(passo);
  const f=passo-fileira;
  return {x:(fileira%2?1-f:f)*18-9,z:fileira*2.4-6,rumo:fileira%2?Math.PI/2:-Math.PI/2};
}
function patrulha(rota,t){
  const canto=Math.floor(t)%rota.length,a=rota[canto],b=rota[(canto+1)%rota.length];
  const pct=Math.min(1,(t%1)*1.20),dx=b[0]-a[0],dz=b[1]-a[1];
  return [a[0]+dx*pct,a[1]+dz*pct,Math.atan2(-dx,-dz),pct<1];
}
function montar(ilha,scene,world,player){
  const root=new THREE.Group();root.name='Vida da Ilha do Xogunato';root.position.set(ilha.x,0,ilha.z);scene.add(root);
  const mat=new THREE.MeshLambertMaterial({color:0xffffff});
  const veg=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
  const cubo=new THREE.BoxGeometry(1,1,1),cone=new THREE.ConeGeometry(.5,1,12),oval=new THREE.SphereGeometry(.5,10,7),tufo=arrozEmTufo();
  const cubos=lote(root,'Vestuário e madeira',cubo,mat,700);
  const cones=lote(root,'Chapéus e ornamentos',cone,mat,90);
  const ovais=lote(root,'Rostos e carpas',oval,mat,220);
  const arroz=lote(root,'Arroz nos terraços',tufo,veg,CAMPOS_EDO.length*12*16);
  const lanternas=lote(root,'Lanternas de papel',oval,mat,80);
  const trelicas=lote(root,'Madeiramento das fachadas',cubo,mat,750);
  const varios={cubos,cones,ovais};
  const trabalhadores=CAMPOS_EDO.map((_,i)=>morador(i,false));
  const guardas=ROTAS_SAMURAIS.map((_,i)=>morador(i,true));
  const peixeReal=new Map();
  let modelo=null,buscado=false,vivo=true,ultimoArroz=-10,ultimaVida=-10,ultimaDecor=-10;
  function ler(x,y,z){return world.getBlock(Math.floor(x+ilha.x),y,Math.floor(z+ilha.z));}
  function proximo(x,z,lim){return Math.hypot(player.pos[0]-ilha.x-x,player.pos[2]-ilha.z-z)<lim;}
  function desenharPessoa(p,x,y,z,rumo,fase,curva,anda){
    p.raiz.position.set(x,y,z);p.raiz.rotation.y=rumo;
    p.peito.rotation.x=-curva*.94;p.cabeca.rotation.x=curva*.35;
    for(let i=0;i<2;i++){
      const s=i===0?1:-1;
      p.pernas[i].rotation.x=s*Math.sin(fase)*.44*anda;
      p.bracos[i].rotation.x=-s*Math.sin(fase)*.38*anda+curva*(.92+s*.28);
      p.bracos[i].rotation.z=s*curva*.12;
    }
    p.raiz.updateMatrixWorld(true);
    for(const [o,forma,cor] of p.partes)varios[forma].gravar(o.matrixWorld,cor);
  }
  function talhoes(t){
    arroz.inicio();
    for(const [i,c] of CAMPOS_EDO.entries()){
      if(!proximo(c.x,c.z,115))continue;
      const f=faseCampo(t,i);
      for(let j=0;j<12;j++)for(let k=0;k<16;k++){
        const fileira=Math.floor(j/2);
        const x=c.x-9.3+k*1.24,z=c.z-6.37+j*1.16;
        if(ler(x,50,z)!==B.WATER)continue;
        const quando=(fileira+(fileira%2?(15-k)/16:k/16))/6;
        const plantou=f>=quando*.34, colheu=f>=.65+quando*.34;
        if(!plantou||colheu)continue;
        const tamanho=.55+1.03*Math.min(1,(f-quando*.34)*2.6);
        const maduro=f>.48+quando*.12;
        arroz.por(x,50.72,z, .94,tamanho,.94,maduro?(k%3?'#b8ab57':'#c7b25c'):folhas[(i+j+k)%4],(k*17+j)*.40);
      }
    }
    arroz.fim();
  }
  function decoracao(){
    lanternas.inicio();trelicas.inicio();
    for(const x of [-39,-12,12,39])for(const [i,z] of [-28,-11,15,42].entries()){
      if(!proximo(x,z,85)||ler(x+5,53,z+4)!==B.PINE_PLANKS)continue;
      // Lâminas de madeira sobre o papel das fachadas, e lanternas nos beirais da rua.
      for(const lado of [-1,1]){
        for(let k=0;k<4;k++)trelicas.por(x+lado*(2.1+k*.48),53.9,z+4.52,.055,1.7,.055,'#634e3e');
        trelicas.por(x+lado*2.92,54.0,z+4.53,1.75,.055,.06,'#705744');
        const u=x+lado*4;
        trelicas.por(u,54.15,z+5.16,.05,.7,.05,'#48403a');
        lanternas.por(u,53.63,z+5.16,.47,.66,.47,i%2?'#e1c391':'#ba5e47');
        trelicas.por(u,53.33,z+5.16,.30,.055,.30,'#493f36');
      }
    }
    lanternas.fim();trelicas.fim();
  }
  function carregarKoi(){
    if(buscado)return;
    buscado=true;
    carregarBicho('peixe_koi',scene).then(g=>{
      if(!vivo){liberarModelo(g);return;}
      modelo=g;
    }).catch(()=>{ /* A carpa instanciada continua nadando no mesmo percurso. */ });
  }
  function liberarModelo(g){
    if(!g)return;
    const recursos=new Set();
    g.scene.traverse(o=>{if(o.geometry)recursos.add(o.geometry);for(const m of [o.material].flat().filter(Boolean)){recursos.add(m);for(const v of Object.values(m))if(v?.isTexture)recursos.add(v);}});
    for(const a of recursos)a.dispose?.();
  }
  function tirarPeixe(id){
    const peixe=peixeReal.get(id);if(!peixe)return;
    peixe.mixer.stopAllAction();peixe.mixer.uncacheRoot(peixe.copia);peixe.copia.removeFromParent();
    peixe.copia.traverse(o=>o.skeleton?.dispose());peixeReal.delete(id);
  }
  function carpas(t,dt){
    const vistos=new Set();
    for(const [j,l] of LAGOS_EDO.entries()){
      if(!proximo(l.x,l.z,66))continue;
      for(let i=0;i<8;i++){
        const id=j*8+i, a=t*(.090+.008*(i%3))+i*2.399+j,raio=.35+.056*i;
        const rx=l.rx*raio,rz=l.rz*(.44+.045*(i%5));
        const x=l.x+Math.cos(a)*rx,z=l.z+Math.sin(a)*rz,y=50.73+.24*Math.sin(a*2+i);
        if(ler(x,50,z)!==B.WATER)continue;
        const giro=Math.atan2(-Math.sin(a)*rx,Math.cos(a)*rz);
        if(i<3 && proximo(x,z,18)){
          carregarKoi();
          if(modelo){
            let p=peixeReal.get(id);
            if(!p){
              const {copia}=clonarComOssos(modelo.scene),mixer=new THREE.AnimationMixer(copia);
              copia.name='Carpa-koi';
              const clip=modelo.animations.find(c=>/swimforward/i.test(c.name));
              if(clip){const acao=mixer.clipAction(clip);acao.time=i*.3;acao.play();}
              copia.scale.setScalar(escalaDe('peixe_koi')*1.25);root.add(copia);p={copia,mixer};peixeReal.set(id,p);
            }
            p.copia.position.set(x,y,z);p.copia.rotation.y=giro;p.mixer.update(dt);vistos.add(id);continue;
          }
        }
        const cor=i%4===0?'#e4b152':'#e8d8bd';
        ovais.por(x,y,z,.40,.29,1.15,cor,giro);
        const dx=Math.sin(giro),dz=Math.cos(giro);
        ovais.por(x+.20*dx,y+.115,z+.20*dz,.29,.095,.38,i%3?'#bc5136':'#554a41',giro);
        ovais.por(x-.20*dx,y+.10,z-.20*dz,.21,.09,.23,'#ae553b',giro);
        const cauda=giro+Math.sin(t*4+i)*.36;
        ovais.por(x-.60*dx,y,z-.60*dz,.34,.095,.40,cor,cauda);
      }
    }
    for(const id of peixeReal.keys())if(!vistos.has(id))tirarPeixe(id);
  }
  function atualizar(t){
    if(t-ultimaDecor>1){decoracao();ultimaDecor=t;}
    if(t-ultimoArroz>.8){talhoes(t);ultimoArroz=t;}
    if(t-ultimaVida<1/24)return;
    const dt=Math.min(.2,t-ultimaVida);ultimaVida=t;
    cubos.inicio();cones.inicio();ovais.inicio();
    for(const [i,c] of CAMPOS_EDO.entries()){
      if(!proximo(c.x,c.z,100))continue;
      const f=faseCampo(t,i), trabalho=f<.34||f>.65;
      const p=percursoArroz(f<.34?f/.34:f<.65?1:(f-.65)/.35);
      const x=c.x+p.x,z=c.z+p.z;
      if(ler(x,50,z)!==B.WATER)continue;
      const inclina=trabalho ? .48+.42*Math.sin(t*2.4+i) : .10;
      desenharPessoa(trabalhadores[i],x,50.08,z,p.rumo,t*3+i,inclina,trabalho?.32:0);
    }
    for(const [i,rota] of ROTAS_SAMURAIS.entries()){
      const [x,z,rumo,andando]=patrulha(rota,(t*.085+i*.83)%(rota.length));
      if(!proximo(x,z,110)||ler(x,51,z)<=0)continue;
      desenharPessoa(guardas[i],x,52,z,rumo,t*4.1+i,andando?0:.12,andando?1:0);
    }
    carpas(t,dt);cubos.fim();cones.fim();ovais.fim();
  }
  function descartar(){
    vivo=false;for(const id of peixeReal.keys())tirarPeixe(id);
    root.removeFromParent();for(const m of [cubos,cones,ovais,arroz,lanternas,trelicas])m.mesh.dispose();
    for(const a of [cubo,cone,oval,tufo,mat,veg])a.dispose();
    liberarModelo(modelo);
  }
  return {atualizar,descartar};
}
export function initXogunato({game,scene,player,world}){
  let gen=null, ilha=null, vila=null;
  function fechar(){vila?.descartar();vila=null;}
  game.hooks.frame.push(()=>{
    if(gen!==game.gen){
      fechar();gen=game.gen;ilha=gen?.arq?.ilhas.find(i=>i.ficha.tema==='xogunato');
    }
    if(!ilha||game.dim!==0||!['PLAYING','PAUSED'].includes(game.state)){if(vila)fechar();return;}
    const perto=Math.abs(player.pos[0]-ilha.x)<(vila?295:245)&&Math.abs(player.pos[2]-ilha.z)<(vila?295:245);
    if(!perto){if(vila)fechar();return;}
    vila??=montar(ilha,scene,world,player);
    vila.atualizar(Date.now()/1000);
  });
}
