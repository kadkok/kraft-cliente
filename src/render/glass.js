// Separa vidro na chegada da malha, sem mudar o mesher nem seu índice compartilhado.
// Só os quads de vidro ganham buffers próprios; folhas mantêm cobertura/recorte.
import * as THREE from '../three.js';
import {TEX_INDEX,GLASS_TEXTURES} from '../../shared/blocks.js';
const GLASS_LAYERS=new Set(GLASS_TEXTURES.map(name=>TEX_INDEX[name]));

export function createGlassLayer(group, materials) {
  const live=new Map();
  const stats={meshes:0,quads:0};
  function add(mesh) {
    if(!mesh?.isMesh || (mesh.material!==materials.cutout && !mesh.material?.defines?.CUTOUT) || live.has(mesh)) return;
    const source=mesh.geometry,pos=source.getAttribute('aPos'),dat=source.getAttribute('aDat');
    if(!pos || !dat || !source.index) return;
    const first=Math.floor(source.drawRange.start/6);
    const end=Math.min(pos.count/4,first+Math.floor(source.drawRange.count/6));
    const glass=[],runs=[];
    let start=-1;
    for(let q=first;q<end;q++) {
      if(GLASS_LAYERS.has(pos.array[q*16+3])) {
        glass.push(q);
        if(start>=0) {runs.push({start:start*6,count:(q-start)*6,materialIndex:0});start=-1;}
      } else if(start<0) start=q;
    }
    if(!glass.length) return;
    if(start>=0) runs.push({start:start*6,count:(end-start)*6,materialIndex:0});
    const panes=[];
    // Espelho escreve profundidade: chuva/partículas atrás dele ficam ocultas.
    // Tingidos seguem juntos no passe transparente, com ordenação própria.
    const batches=[glass.filter(q=>pos.array[q*16+3]!==TEX_INDEX.glass_mirror),glass.filter(q=>pos.array[q*16+3]===TEX_INDEX.glass_mirror)];
    for(const [batch,quads]of batches.entries()){
      if(!quads.length)continue;
      const glass=quads;
      const gp=new Float32Array(glass.length*16),gd=new Uint8Array(gp.length);
      const indices=glass.length*4>65535?new Uint32Array(glass.length*6):new Uint16Array(glass.length*6);
      const min=new THREE.Vector3(Infinity,Infinity,Infinity),max=new THREE.Vector3(-Infinity,-Infinity,-Infinity),point=new THREE.Vector3();
      for(let i=0;i<glass.length;i++) {
        const q=glass[i];gp.set(pos.array.subarray(q*16,q*16+16),i*16);gd.set(dat.array.subarray(q*16,q*16+16),i*16);
        const b=i*4;indices.set([b,b+1,b+2,b,b+2,b+3],i*6);
        for(let v=0;v<4;v++) {const p=i*16+v*4;point.set(gp[p],gp[p+1],gp[p+2]);min.min(point);max.max(point);}
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('aPos',new THREE.BufferAttribute(gp,4));geometry.setAttribute('aDat',new THREE.BufferAttribute(gd,4));
      geometry.setIndex(new THREE.BufferAttribute(indices,1));
      geometry.boundingBox=new THREE.Box3(min,max);geometry.boundingSphere=new THREE.Sphere();
      geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
      const pane=new THREE.Mesh(geometry,batch?materials.mirror:materials.glass);pane.name=batch?'espelho-blocos':'vidro-blocos';
      if(batch && materials.depthGlass) {
        pane.castShadow=true;pane.customDepthMaterial=materials.depthGlass;
      }
      pane.renderOrder=batch?0:2;pane.matrixAutoUpdate=false;pane.updateMatrix();
      // Three ordena malhas; aqui também ordenamos vidraças dentro do mesmo chunk.
      // Só a mudança de vista exige trabalho, e só a mudança de ordem reenvia índices.
      const centers=new Float32Array(glass.length*3),depths=new Float32Array(glass.length);
      const order=Uint32Array.from(glass,(_,i)=>i),view=new THREE.Matrix4(),last=new Float64Array(16).fill(NaN);
      for(let q=0;q<glass.length;q++)for(let v=0;v<4;v++)for(let k=0;k<3;k++)centers[q*3+k]+=gp[q*16+v*4+k]*.25;
      pane.onBeforeRender=(_renderer,_scene,camera)=>{
        if(batch||glass.length<2)return;
        view.multiplyMatrices(camera.matrixWorldInverse,pane.matrixWorld);const e=view.elements;
        if(e.every((v,i)=>v===last[i]))return;last.set(e);
        for(let q=0;q<glass.length;q++)depths[q]=e[2]*centers[q*3]+e[6]*centers[q*3+1]+e[10]*centers[q*3+2]+e[14];
        order.sort((a,b)=>depths[a]-depths[b]);let changed=false;
        for(let i=0;i<order.length;i++){const b=order[i]*4;if(indices[i*6]===b)continue;indices.set([b,b+1,b+2,b,b+2,b+3],i*6);changed=true;}
        if(changed)geometry.index.needsUpdate=true;
      };
      panes.push(pane);
    }
    const oldMaterial=mesh.material,oldGroups=source.groups.map(g=>({...g}));
    source.groups=runs;mesh.material=[oldMaterial];mesh.add(...panes);
    stats.meshes+=panes.length;stats.quads+=glass.length;
    function release() {
      if(!live.delete(mesh)) return;
      mesh.removeEventListener('removed',release);source.removeEventListener('dispose',release);
      for(const pane of panes){mesh.remove(pane);pane.geometry.dispose();}mesh.material=oldMaterial;source.groups=oldGroups;
      if(mesh.userData.lavraGlassRefresh===refresh)delete mesh.userData.lavraGlassRefresh;
      stats.meshes-=panes.length;stats.quads-=glass.length;
    }
    // Folhagem troca geometria e shader. Retirar o vidro antes da transformação
    // evita restaurar um material antigo por cima do novo; extrair de novo depois.
    function refresh(change) {release();try{return change();}finally{add(mesh);}}
    mesh.userData.lavraGlassRefresh=refresh;
    live.set(mesh,release);mesh.addEventListener('removed',release);source.addEventListener('dispose',release);
  }
  const added=e=>add(e.child);
  group.addEventListener('childadded',added);
  for(const mesh of group.children) add(mesh);
  return {stats,dispose(){group.removeEventListener('childadded',added);for(const release of [...live.values()]) release();}};
}
