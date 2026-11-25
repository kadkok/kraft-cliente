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
    const tinted=[],mirrors=[],runs=[];
    let start=-1;
    const mirrorLayer=TEX_INDEX.glass_mirror,posArr=pos.array,datArr=dat.array;
    for(let q=first;q<end;q++) {
      const layer=posArr[q*16+3];
      if(GLASS_LAYERS.has(layer)) {
        if(layer===mirrorLayer)mirrors.push(q);else tinted.push(q);
        if(start>=0) {runs.push({start:start*6,count:(q-start)*6,materialIndex:0});start=-1;}
      } else if(start<0) start=q;
    }
    const totalGlass=tinted.length+mirrors.length;
    if(!totalGlass) return;
    if(start>=0) runs.push({start:start*6,count:(end-start)*6,materialIndex:0});
    const panes=[];
    // Espelho escreve profundidade: chuva/partículas atrás dele ficam ocultas.
    // Tingidos seguem juntos no passe transparente, com ordenação própria.
    const batches=[tinted,mirrors];
    for(let batch=0;batch<2;batch++){
      const glass=batches[batch];
      if(!glass.length)continue;
      const gp=new Float32Array(glass.length*16),gd=new Uint8Array(gp.length);
      const indices=glass.length*4>65535?new Uint32Array(glass.length*6):new Uint16Array(glass.length*6);
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
      for(let i=0;i<glass.length;i++) {
        const q=glass[i],q16=q*16,i16=i*16;
        gp.set(posArr.subarray(q16,q16+16),i16);gd.set(datArr.subarray(q16,q16+16),i16);
        const b=i*4,o=i*6;
        indices[o]=b;indices[o+1]=b+1;indices[o+2]=b+2;indices[o+3]=b;indices[o+4]=b+2;indices[o+5]=b+3;
        for(let v=0;v<4;v++) {
          const p=i16+v*4,px=gp[p],py=gp[p+1],pz=gp[p+2];
          if(px<minX)minX=px;if(px>maxX)maxX=px;
          if(py<minY)minY=py;if(py>maxY)maxY=py;
          if(pz<minZ)minZ=pz;if(pz>maxZ)maxZ=pz;
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('aPos',new THREE.BufferAttribute(gp,4));geometry.setAttribute('aDat',new THREE.BufferAttribute(gd,4));
      geometry.setIndex(new THREE.BufferAttribute(indices,1));
      geometry.boundingBox=new THREE.Box3(new THREE.Vector3(minX,minY,minZ),new THREE.Vector3(maxX,maxY,maxZ));
      geometry.boundingSphere=new THREE.Sphere();
      geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
      const pane=new THREE.Mesh(geometry,batch?materials.mirror:materials.glass);pane.name=batch?'espelho-blocos':'vidro-blocos';
      if(batch && materials.depthGlass) {
        pane.castShadow=true;pane.customDepthMaterial=materials.depthGlass;
      }
      pane.renderOrder=batch?0:2;pane.matrixAutoUpdate=false;pane.updateMatrix();
      // Three ordena malhas; aqui também ordenamos vidraças dentro do mesmo chunk.
      // A ordem de trás para a frente depende apenas da posição da câmera no espaço local do chunk
      // (invariante à rotação da câmera, custando 0 ms ao girar a visão!).
      const centers=new Float32Array(glass.length*3),depths=new Float32Array(glass.length);
      const order=Uint32Array.from(glass,(_,i)=>i),view=new THREE.Matrix4();
      const scx=geometry.boundingSphere.center.x,scy=geometry.boundingSphere.center.y,scz=geometry.boundingSphere.center.z;
      let lastX=NaN,lastY=NaN,lastZ=NaN;
      for(let q=0;q<glass.length;q++)for(let v=0;v<4;v++)for(let k=0;k<3;k++)centers[q*3+k]+=gp[q*16+v*4+k]*.25;
      pane.onBeforeRender=(_renderer,_scene,camera)=>{
        if(batch||glass.length<2)return;
        view.multiplyMatrices(camera.matrixWorldInverse,pane.matrixWorld);const e=view.elements;
        const cx=-(e[0]*e[12]+e[1]*e[13]+e[2]*e[14]);
        const cy=-(e[4]*e[12]+e[5]*e[13]+e[6]*e[14]);
        const cz=-(e[8]*e[12]+e[9]*e[13]+e[10]*e[14]);
        const dx=cx-lastX,dy=cy-lastY,dz=cz-lastZ;
        const cdx=cx-scx,cdy=cy-scy,cdz=cz-scz,cDistSq=cdx*cdx+cdy*cdy+cdz*cdz;
        const threshSq=cDistSq>6400?16:cDistSq>1024?2.25:.25;
        if(dx*dx+dy*dy+dz*dz<threshSq)return;
        lastX=cx;lastY=cy;lastZ=cz;
        for(let q=0;q<glass.length;q++){
          const qx=centers[q*3]-cx,qy=centers[q*3+1]-cy,qz=centers[q*3+2]-cz;
          depths[q]=-(qx*qx+qy*qy+qz*qz);
        }
        order.sort((a,b)=>depths[a]-depths[b]);let changed=false;
        for(let i=0;i<order.length;i++){
          const b=order[i]*4,o=i*6;
          if(indices[o]===b)continue;
          indices[o]=b;indices[o+1]=b+1;indices[o+2]=b+2;indices[o+3]=b;indices[o+4]=b+2;indices[o+5]=b+3;
          changed=true;
        }
        if(changed)geometry.index.needsUpdate=true;
      };
      panes.push(pane);
    }
    const oldMaterial=mesh.material,oldGroups=source.groups.map(g=>({...g}));
    source.groups=runs;mesh.material=[oldMaterial];mesh.add(...panes);
    stats.meshes+=panes.length;stats.quads+=totalGlass;
    function release() {
      if(!live.delete(mesh)) return;
      mesh.removeEventListener('removed',release);source.removeEventListener('dispose',release);
      for(const pane of panes){mesh.remove(pane);pane.geometry.dispose();}mesh.material=oldMaterial;source.groups=oldGroups;
      if(mesh.userData.lavraGlassRefresh===refresh)delete mesh.userData.lavraGlassRefresh;
      stats.meshes-=panes.length;stats.quads-=totalGlass;
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
