import * as THREE from '../three.js';

// Reinterpretação contínua da ferramenta CC0 de iami55: não extrude pixels.
// Cabeça forjada curva, chanfros, encaixe e cabo de madeira; buffers compartilhados.
const cache=new Map();
export function pickaxeGeometry(kind='iron') {
  if(cache.has(kind))return cache.get(kind);
  const positions=[],normals=[],uv=[],colors=[],groups=[];
  const headColor={wood:'#88704a',stone:'#848982',iron:'#b1bac0',crystal:'#84b4bd'}[kind]||'#b1bac0';
  const add=(geometry,color,material)=>{
    const g=geometry.index?geometry.toNonIndexed():geometry,c=new THREE.Color(color),start=positions.length/3;
    positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);uv.push(...g.attributes.uv.array);
    for(let i=0;i<g.attributes.position.count;i++)colors.push(c.r,c.g,c.b);
    groups.push({start,count:g.attributes.position.count,materialIndex:material});g.dispose();if(g!==geometry)geometry.dispose();
  };
  const shape=new THREE.Shape();shape.moveTo(-.34,.23);
  shape.bezierCurveTo(-.28,.40,-.15,.47,0,.47);shape.bezierCurveTo(.15,.47,.27,.39,.34,.23);
  shape.lineTo(.30,.25);shape.bezierCurveTo(.19,.32,.08,.35,0,.35);shape.bezierCurveTo(-.10,.35,-.22,.32,-.30,.25);shape.closePath();
  const head=new THREE.ExtrudeGeometry(shape,{depth:.045,steps:1,bevelEnabled:true,bevelThickness:.007,bevelSize:.007,bevelSegments:2,curveSegments:5});head.translate(0,0,-.0225);add(head,headColor,0);
  const shaft=new THREE.CylinderGeometry(.021,.027,.64,10,3);shaft.translate(0,.075,0);add(shaft,'#b18a58',1);
  const collar=new THREE.CylinderGeometry(.034,.031,.09,10);collar.translate(0,.36,0);add(collar,headColor,0);
  const grip=new THREE.CylinderGeometry(.028,.030,.16,10,2);grip.translate(0,-.14,0);add(grip,'#65513c',1);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  // Índice sequencial mantém o contrato de contagem/QA das outras ferramentas.
  g.setIndex(Array.from({length:positions.length/3},(_,i)=>i));for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);
  // Gira no eixo do cabo: as pontas ficam para frente e para trás da mão.
  g.rotateY(Math.PI/2);
  g.computeBoundingSphere();g.userData.shared=true;g.userData.style='forged-beveled-pickaxe';cache.set(kind,g);return g;
}

export function toolGrainTexture() {
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),im=g.createImageData(128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const at=(y*128+x)*4,v=210+Math.sin(x*.8+Math.sin(y*.08)*.7)*15+Math.sin(x*2.9+y*.03)*5;
    im.data.set([v,v,v,255],at);
  }
  g.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;
}
