// Iluminação dos objetos existentes: recebe sombra e reflexo angular em vidro simples.
// Os materiais físicos importados mantêm seus parâmetros autorais. Nada de ray tracing.
import {U} from './materials.js';
export function createOptics(scene,quality) {
  const seen=new WeakSet();
  let next=0;
  const stats={receivers:0,glass:0};
  function update(time) {
    if(time<next&&time>next-2) return;
    next=time+.75;
    scene.traverse(o=>{
      if(!o.isMesh) return;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      if((o.castShadow||o.name.startsWith('natureza-'))&&mats.some(m=>m?.isMeshLambertMaterial||m?.isMeshStandardMaterial||m?.isMeshPhongMaterial)) {
        if(!o.receiveShadow) {o.receiveShadow=true;stats.receivers++;}
      }
      for(const mat of mats) {
        if(!mat||seen.has(mat)) continue;
        seen.add(mat);
        if(!mat.isMeshLambertMaterial||!mat.transparent||mat.opacity>=1||mat.opacity<=.05) continue;
        const old=mat.onBeforeCompile;
        mat.onBeforeCompile=function(shader,renderer) {
          old.call(this,shader,renderer);
          shader.uniforms.lavraSun=U.uSunColor;shader.uniforms.lavraLight=U.uLightDir;shader.uniforms.uHeadset=U.uHeadset;
          shader.fragmentShader='uniform vec3 lavraSun, lavraLight;\nuniform float uHeadset;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
            vec3 lv=normalize(vViewPosition);
            vec3 ll=normalize(mat3(viewMatrix)*lavraLight);
            float lf=pow(1.0-clamp(dot(normal,lv),0.0,1.0),5.0);
            float ls=pow(max(dot(reflect(-lv,normal),ll),0.0),80.0)*(1.0-uHeadset);
            outgoingLight+=lavraSun*(ls*.26+lf*.018);
            diffuseColor.a=clamp(diffuseColor.a*.82+lf*.16,0.0,1.0);
            #include <opaque_fragment>`);
        };
        mat.customProgramCacheKey=()=> 'lavra-glass-fresnel-v2';
        mat.needsUpdate=true;stats.glass++;
      }
    });
  }
  return {update,stats};
}
