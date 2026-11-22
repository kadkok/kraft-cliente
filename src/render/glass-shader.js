// Vidros: mistura contínua, Fresnel e reflexão local já disponível.
// Sem captura de tela, blur ou refração volumétrica; o fundo vem do alpha blending.
import {GLASS_STYLE_GLSL} from './glass-styles.js';
export const GLASS_SURFACE = /* glsl */`
${GLASS_STYLE_GLSL}
void main() {
  vec3 toCam=cameraPosition-vWorld;
  float dist=length(toCam);
  vec3 V=toCam/max(dist,.0001),N=normalize(vN);
  float nv=max(dot(N,V),.025);
  vec3 R=reflect(-V,N);
  float f0,absorbBase,rough,opaque;vec3 bodyTint,coat;
  glassStyle(vLayer,f0,absorbBase,bodyTint,coat,rough,opaque);
  rough=mix(rough,max(rough,0.9),uHeadset);
  float fresnel=f0+(1.0-f0)*pow(1.0-clamp(nv,0.0,1.0),5.0);
  fresnel*=mix(1.0,0.42,uHeadset);
  vec3 env=mix(uAmbGround*.5,skyBase(R),smoothstep(-.2,.12,R.y));
#ifdef GLASS_CLOUDS
  if(R.y>.015) {vec4 cl=cloudLayer(R,0.0);env=mix(env,cl.rgb,cl.a);}
#endif
  // Um interior sem céu não recebe um painel azul inventado como reflexo.
  env=mix(uAmbGround*.35+uMinAmb,env,smoothstep(.2,.95,vLight.x));
#ifdef WATER_VOXELS
  env=localSurfaceReflection(env,vWorld+N*.035,R,dist);
#endif
  vec2 f=fract(vUv);
  float edgeDistance=min(min(f.x,1.0-f.x),min(f.y,1.0-f.y));
  float aa=max(max(fwidth(vUv.x),fwidth(vUv.y)),.0005);
  float edge=(1.0-smoothstep(.006-aa,.018+aa,edgeDistance))*(1.0-smoothstep(16.0,40.0,dist));
  float absorb=absorbBase+edge*.065;
  float alpha=mix(min(.97,fresnel+(1.0-fresnel)*absorb),1.0,opaque);
  vec3 ambient=mix(uAmbGround,uAmbSky,N.y*.5+.5)*vLight.x+uMinAmb;
  // O pigmento continua legível sob céu azul; mantém a intensidade ambiente.
  if(absorbBase>.05)ambient=vec3(max(ambient.r,max(ambient.g,ambient.b)));
  vec3 body=bodyTint*ambient;
  vec3 premul=env*coat*fresnel+body*absorb*(1.0-fresnel);

  // Microfacet GGX: o brilho segue o sol/lua e o mapa de sombra já existente.
  float nl=max(dot(N,uLightDir),0.0);
  if(nl>0.0) {
    vec3 H=normalize(V+uLightDir);
    float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
    float a2=rough*rough;a2*=a2;
    float den=nh*nh*(a2-1.0)+1.0;
    float D=a2/(3.14159265*den*den);
    float k=(rough+1.0)*(rough+1.0)/8.0;
    float G=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
    float F=f0+(1.0-f0)*pow(1.0-vh,5.0);
    float spec=min(mix(2.5,0.35,uHeadset),D*G*F/max(4.0*nv,.02));
    float visible=waterSunVisibility(vWorld,N)*smoothstep(.1,.8,vLight.x);
    premul+=uSunColor*coat*spec*visible;
  }
  premul*=vrGrain(vWorld);
  vec4 fog=fogAt(dist,-V,vWorld.y);
  vec3 color=mix(premul/max(alpha,.001),fog.rgb,fog.a);
  outColor=vec4(finish(color),alpha);
}
`;
