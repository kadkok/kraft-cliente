import * as THREE from '../three.js';
import {SKIN_UNIT,skinParts,skinRects,skinPivots} from './skin-layout.js';

const geometries=new Map(),textures=new Map();
function skinTexture(slim,character='explorador') {
  const key=character+'-'+(slim?'slim':'classic');if(textures.has(key))return textures.get(key);
  const texture=new THREE.TextureLoader().load(new URL(`../../assets/skin/${key}.png`,import.meta.url).href);
  texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=4;
  textures.set(key,texture);return texture;
}
export function minecraftGeometry(slim=false,handOnly=false) {
  const key=slim+':'+handOnly;if(geometries.has(key))return geometries.get(key);
  const p=[],n=[],uv=[],j=[],w=[],index=[];
  for(const part of skinParts(slim))for(const layer of [0,1]) {
    if(handOnly&&part.name!=='armR')continue;
    const inflate=layer?(part.name==='head'?.5:.25):0,base=p.length/3;
    const dims=part.size.map(v=>(v+inflate*2)*SKIN_UNIT),segments=part.name==='head'?[6,6,4]:[4,8,2];
    const g=new THREE.BoxGeometry(...dims,...segments);
    const gp=g.attributes.position,gn=g.attributes.normal,gu=g.attributes.uv,rects=skinRects(part.size,layer?part.outer:part.base);
    const radius=part.name==='head'?.042:.025,half=dims.map(v=>v*.5-radius),faceOf=[];
    for(let face=0;face<g.groups.length;face++)for(let k=g.groups[face].start;k<g.groups[face].start+g.groups[face].count;k++)faceOf[g.index.array[k]]=face;
    for(let i=0;i<gp.count;i++) {
      const v=[gp.getX(i),gp.getY(i),gp.getZ(i)],q=v.map((x,a)=>Math.max(-half[a],Math.min(half[a],x))),delta=v.map((x,a)=>x-q[a]),len=Math.hypot(...delta)||1;
      const rounded=v.map((_,a)=>q[a]+delta[a]/len*radius),localY=rounded[1],h=dims[1];
      if(part.name==='torso')rounded[0]*=.88+.12*(localY/h+.5);
      if(part.name==='head') {
        rounded[0]*=.86+.14*(localY/h+.5);
        if(rounded[2]<0)rounded[2]-=.042*Math.exp(-((rounded[0]/.06)**2+((localY+.015)/.075)**2));
        if(Math.abs(rounded[0])>.16)rounded[0]+=Math.sign(rounded[0])*.018*Math.exp(-((localY/.07)**2+(rounded[2]/.07)**2));
      }
      if(part.name.startsWith('leg')&&localY<-h*.28){rounded[0]*=1.12;rounded[2]-=.035;}
      if(part.name.startsWith('arm')&&localY<-h*.32)rounded[0]*=1.08;
      p.push(rounded[0]+part.at[0]*SKIN_UNIT,rounded[1]+part.at[1]*SKIN_UNIT,rounded[2]);n.push(delta[0]/len,delta[1]/len,delta[2]/len);
      const [x,y,rh,rv]=rects[faceOf[i]];uv.push((x+gu.getX(i)*rh)/64,1-(y+(1-gu.getY(i))*rv)/64);
      const lower=part.bone>=2?Math.max(0,Math.min(1,.5-localY/(SKIN_UNIT*1.8))):0;
      j.push(part.bone,part.bone>=2?part.bone+4:0,0,0);w.push(1-lower,lower,0,0);
    }
    for(const v of g.index.array)index.push(base+v);g.dispose();
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(j,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(w,4));g.setIndex(index);g.userData.shared=true;
  geometries.set(key,g);return g;
}

export function buildMinecraftBody(options={}) {
  const root=new THREE.Group();root.name='explorador-lavra';
  const bones=skinPivots().map((p,i)=>{const b=new THREE.Bone();b.position.fromArray(p);b.name=['root','head','armL','armR','legL','legR'][i];return b;});
  root.add(bones[0]);for(let i=1;i<6;i++)bones[0].add(bones[i]);root.updateMatrixWorld(true);
  for(let i=2;i<6;i++){const joint=new THREE.Bone();joint.name=i<4?'cotovelo':'joelho';joint.position.y=-6*SKIN_UNIT;bones[i].add(joint);bones.push(joint);}
  root.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  const material=new THREE.MeshStandardMaterial({map:skinTexture(false),roughness:.92,alphaTest:.5});
  const mesh=new THREE.SkinnedMesh(minecraftGeometry(false,options.handOnly),material);mesh.name='skin-compativel';mesh.castShadow=mesh.receiveShadow=true;
  mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.9,0),1.4);root.add(mesh);mesh.bind(skeleton,new THREE.Matrix4());
  let owned=null,dead=false;
  function setSkin(canvas,slim=false,character='explorador') {
    owned?.dispose();owned=null;
    if(canvas){owned=new THREE.CanvasTexture(canvas);owned.colorSpace=THREE.SRGBColorSpace;owned.magFilter=canvas.width>64?THREE.LinearFilter:THREE.NearestFilter;owned.minFilter=THREE.LinearMipmapLinearFilter;owned.anisotropy=4;}
    material.map=owned||skinTexture(slim,character);material.needsUpdate=true;mesh.geometry=minecraftGeometry(slim,options.handOnly);
    const pivots=skinPivots(slim);for(let i=0;i<6;i++){bones[i].position.fromArray(pivots[i]);skeleton.boneInverses[i].makeTranslation(-pivots[i][0],-pivots[i][1],-pivots[i][2]);}
    for(let i=6;i<10;i++){const p=pivots[i-4];skeleton.boneInverses[i].makeTranslation(-p[0],-p[1]+6*SKIN_UNIT,-p[2]);}
    root.userData.avatar.variant=slim?'slim':'classic';
  }
  function dispose(){if(dead)return;dead=true;owned?.dispose();skeleton.dispose();material.dispose();}
  const body={root,mats:{skin:material},colors:{skin:material.color.clone()},torso:mesh,head:bones[1],armL:bones[2],armR:bones[3],legL:bones[4],legR:bones[5],elbowL:bones[6],elbowR:bones[7],kneeL:bones[8],kneeR:bones[9],skeleton,setSkin,dispose};
  root.userData.avatar={style:'lavra-hd-skin-compatible',variant:'classic',height:1.8,texture:640,triangles:mesh.geometry.index.count/3,bones:10,draws:1,origin:'Skin original Lavra640; layout normalizado compatível'};
  Object.defineProperty(root.userData,'body',{value:body});root.userData.disposeAvatar=dispose;return body;
}
