// Fragmentos e folhas compartilham um atlas e um draw call. Trajetórias analíticas
// no vertex shader; CPU só prepara atributos no nascimento e recolhe slots vencidos.
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import { TEX, KIND, K_CUTOUT, TINT_B0, TINT_C0, TINT_D0 } from '../../shared/blocks.js';

const VS = /* glsl */`
precision highp float;
in vec3 position, normal;
in vec4 aOrigin, aSize, aVelocity, aLayersA, aLayersB;
in vec3 aOffset, aSpin, aTint;
in vec2 aLight;
in float aFloor;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uEffectTime;
out vec2 vUv, vLeafUv;
out vec3 vNormal, vWorld, vTint;
out vec2 vLight;
flat out float vLayer, vCutout, vLeaf;
mat3 turn(vec3 r) {
  vec3 s=sin(r), c=cos(r);
  return mat3(c.y*c.z, c.y*s.z, -s.y,
    s.x*s.y*c.z-c.x*s.z, s.x*s.y*s.z+c.x*c.z, s.x*c.y,
    c.x*s.y*c.z+s.x*s.z, c.x*s.y*s.z-s.x*c.z, c.x*c.y);
}
void main() {
  float age = uEffectTime-aOrigin.w;
  float t = max(0.0,age-aVelocity.w);
  float leaf = aLayersB.w;
  vec3 center = aOrigin.xyz+aOffset;
  vec3 local = position*aSize.xyz;
  vec3 source = center+local;
  vUv = abs(normal.x)>.5 ? source.zy : abs(normal.y)>.5 ? source.xz : source.xy;
  vLayer = normal.x>.5?aLayersA.x:normal.x<-.5?aLayersA.y:normal.y>.5?aLayersA.z:normal.y<-.5?aLayersA.w:normal.z>.5?aLayersB.x:aLayersB.y;
  vCutout=aLayersB.z; vLeaf=leaf; vLeafUv=position.xz*2.0;
  vTint=aTint; vLight=aLight;
  vec3 rotation=aSpin*t;
  if (leaf>0.5) {
    float phase=aSpin.y;
    float flutter=(leaf>1.5?0.23:0.10);
    center+=vec3(aVelocity.x*t+sin(t*2.2+phase)*flutter-sin(phase)*flutter, -aVelocity.y*t, aVelocity.z*t+sin(t*1.4+phase)*flutter-sin(phase)*flutter);
    rotation=vec3(sin(t*2.4+phase)*.65, phase+t*(leaf>2.5?1.8:.4), cos(t*1.7+phase)*.45);
    center.y=max(center.y,aFloor);
    if(center.y<=aFloor+.001) rotation=vec3(0.0,phase,0.0);
  } else {
    float g=13.0;
    float drop=max(0.0,center.y-aFloor);
    float land=(aVelocity.y+sqrt(max(0.0,aVelocity.y*aVelocity.y+2.0*g*drop)))/g;
    float fallT=min(t,land);
    float impact=max(0.0,t-land);
    float airSpread=drop>0.6?0.25:1.0;
    vec2 outDir=aOffset.xz-vec2(0.5);
    float outLen=length(outDir);
    vec2 shatter=(outLen>0.01?outDir/outLen:vec2(0.7,0.7))*(1.1+min(3.0,drop*0.35));
    center.xz+=aVelocity.xz*(fallT*airSpread+impact*1.35)+shatter*min(impact,0.45);
    center.y+=aVelocity.y*fallT-0.5*g*fallT*fallT;
    center.y=max(center.y,aFloor)+max(0.0,impact*(1.8-5.2*impact))*min(1.0,drop*0.5);
    rotation=aSpin*(fallT+impact*2.2);
  }
  float scale=1.0-smoothstep(aSize.w*.70,aSize.w,age);
  mat3 rot=turn(rotation);
  vec3 p=center+rot*local*scale;
  vWorld=p; vNormal=rot*normal;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
  if(age<0.0 || age>=aSize.w) gl_Position=vec4(2.0,2.0,2.0,1.0);
}
`;
const FS = /* glsl */`
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform sampler2DArray uTex;
#ifdef SHADOWS
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowInfo;
#endif
uniform vec3 cameraPosition;
${COMMON}
in vec2 vUv, vLeafUv;
in vec3 vNormal, vWorld, vTint;
in vec2 vLight;
flat in float vLayer, vCutout, vLeaf;
out vec4 outColor;
void main() {
  if(vLeaf>.5) {
    // Lâmina de folha fina, não um cubo: contorno, nervura e dobra de luz.
    float width=(1.0-vLeafUv.y*vLeafUv.y)*.72;
    if(abs(vLeafUv.x)>width || abs(vLeafUv.y)>.99) discard;
  }
  vec4 tex=texture(uTex,vec3(vUv,vLayer));
  if(vCutout>.5 && vLeaf<.5 && tex.a<.5) discard;
  vec3 albedo=tex.rgb;
  if(vLayer>=${TINT_C0}.0) albedo*=vTint;
  else if(vLayer>=${TINT_B0}.0) albedo*=mix(vec3(1.0),vTint,1.0-tex.a);
  vec3 n=normalize(vNormal);
  if(!gl_FrontFacing) n=-n;
  float sky=vLight.x*vLight.x;
  float sun=sky;
#ifdef SHADOWS
  if(uShadowInfo.y>0.0) {
    vec4 sc=uShadowMatrix*vec4(vWorld+n*.09,1.0);
    vec3 p=sc.xyz/sc.w;
    if(all(greaterThan(p,vec3(0.0)))&&all(lessThan(p,vec3(1.0)))) sun*=texture(uShadowMap,vec3(p.xy,p.z-.0004));
  }
#endif
  vec3 amb=mix(uAmbGround,uAmbSky,n.y*.5+.5)*max(sky,uMinAmb);
  vec3 light=amb+uSunColor*max(dot(n,uLightDir),0.0)*sun*.65+uTorch*vLight.y*vLight.y;
  if(vLeaf>.5) {
    light+=uSunColor*max(dot(-n,uLightDir),0.0)*(.2*sky+.8*sun)*.23;
    albedo*=.9+.15*(1.0-smoothstep(0.0,.08,abs(vLeafUv.x)));
  }
  vec3 c=albedo*light;
  if(vCutout<.5 && vLayer<${TINT_B0}.0) c+=albedo*albedo*(1.0-tex.a)*3.8;
  vec3 toEye=cameraPosition-vWorld;
  vec4 fog=fogAt(length(toEye),-normalize(toEye),vWorld.y);
  outColor=vec4(finish(mix(c,fog.rgb,fog.a)),1.0);
}
`;

export function createDebris(scene, capacity = 256) {
  const base = new THREE.BoxGeometry(1,1,1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index=base.index;
  geometry.setAttribute('position',base.attributes.position);
  geometry.setAttribute('normal',base.attributes.normal);
  const dimensions={aOrigin:4,aSize:4,aVelocity:4,aLayersA:4,aLayersB:4,aOffset:3,aSpin:3,aTint:3,aLight:2,aFloor:1};
  const attributes={};
  for(const [name,size] of Object.entries(dimensions)) {
    const a=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size);
    a.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name,a); attributes[name]=a;
  }
  geometry.instanceCount=0;
  const uniforms={...U,uEffectTime:{value:0}};
  const shadows=scene.children.some(o=>o.isDirectionalLight&&o.castShadow);
  const material=new THREE.RawShaderMaterial({name:'fragmentos-e-folhas',glslVersion:THREE.GLSL3,uniforms,vertexShader:VS,fragmentShader:FS,defines:shadows?{SHADOWS:1}:{},side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material); mesh.name='fragmentos-e-folhas'; mesh.frustumCulled=false; mesh.visible=false;
  scene.add(mesh);
  const expires=new Float64Array(capacity);
  let cursor=0,dirty=false,active=0;
  function put(name,slot,values) { attributes[name].array.set(values,slot*dimensions[name]); }
  function emit(p) {
    const i=cursor; cursor=(cursor+1)%capacity;
    const layers=TEX.subarray(p.id*6,p.id*6+6);
    put('aOrigin',i,[...p.origin,p.birth]); put('aOffset',i,p.center||[0,0,0]);
    put('aSize',i,[...p.size,p.life]); put('aVelocity',i,[...p.velocity,p.delay||0]);
    put('aSpin',i,p.spin); put('aTint',i,p.tint||[.15,.3,.08]); put('aLight',i,p.light||[1,0]);
    put('aFloor',i,[p.floor]); put('aLayersA',i,layers.subarray(0,4));
    put('aLayersB',i,[layers[4],layers[5],KIND[p.id]===K_CUTOUT?1:0,p.leaf||0]);
    expires[i]=p.birth+p.life; dirty=true;
  }
  function update(time) {
    uniforms.uEffectTime.value=time;
    active=0; let end=0;
    for(let i=0;i<capacity;i++) if(expires[i]>time) { active++;end=i+1; }
    geometry.instanceCount=end; mesh.visible=active>0 && !!U.uTex.value;
    if(dirty) { for(const a of Object.values(attributes)) a.needsUpdate=true; dirty=false; }
  }
  function clear() { expires.fill(0); for(let i=0;i<capacity;i++) attributes.aSize.array[i*4+3]=0; dirty=true; update(uniforms.uEffectTime.value); }
  function dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); }
  return {emit,update,clear,dispose,mesh,capacity,get active(){return active;}};
}
