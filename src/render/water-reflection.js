// Reflexo local: um raio por fragmento de água dentro do foco. Reusa a grade e o
// mapa solar existentes; só acrescenta a tabela estática de faces (1 KiB).
// Integrado ao sombreamento de superfície oceânica adaptado de dgreenheck/tidewater (MIT License).
import {B, GLASS_IDS, TINT_B0, TINT_C0, TINT_D0} from '../../shared/blocks.js';
import {VOXEL_GLSL} from './voxelfield.js';

export const WATER_REFLECTION = /* glsl */`
#ifdef SHADOWS
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowInfo;
#endif
float waterSunVisibility(vec3 p, vec3 n) {
#ifdef SHADOWS
  vec4 sc = uShadowMatrix * vec4(p + n * .035, 1.0);
  vec3 c = sc.xyz / sc.w;
  float edge = min(min(c.x, 1.0-c.x), min(c.y, 1.0-c.y));
  if (edge > 0.0 && c.z > 0.0 && c.z < 1.0)
    return mix(1.0, texture(uShadowMap, vec3(c.xy, c.z-.00012)), uShadowInfo.y * smoothstep(0.0,.04,edge));
#endif
  return 1.0;
}

#ifdef WATER_VOXELS
uniform highp sampler2DArray uTex;
uniform highp sampler2D uVoxFaces;
bool voxelCutoutHit(int id, vec3 p, vec3 n);
#define VOXEL_CUTOUT
${VOXEL_GLSL}

float reflectedLayer(int id, vec3 n) {
  int f = n.y > .001 ? 2 : abs(n.x) > .5 ? (n.x > 0.0 ? 0 : 1) : abs(n.y) > .5 ? 3 : (n.z > 0.0 ? 4 : 5);
  vec4 row = texelFetch(uVoxFaces, ivec2(id, f/4), 0);
  return floor(row[f%4] * 255.0 + .5);
}
vec2 reflectedUV(vec3 p, vec3 n) {
  return n.y > .001 ? p.xz : abs(n.x) > .5 ? p.zy : abs(n.y) > .5 ? p.xz : p.xy;
}
bool voxelCutoutHit(int id, vec3 p, vec3 n) {
  // Vidro claro transmite: não vira moldura opaca dentro de outro reflexo.
  // A superfície óptica exigiria um segundo salto, fora do orçamento atual.
  if (${GLASS_IDS.filter(id=>id!==B.GLASS_MIRROR).map(id=>`id == ${id}`).join(' || ')}) return false;
  // Folhas e vidro respeitam o alpha real; os buracos deixam o raio continuar.
  // O mesher omite uma face contra um opaco ou o mesmo recorte. Consultar o lado
  // externo serve tanto para a face de entrada como para a de saída do cubo.
  int neighbor = voxelAt(ivec3(floor(p+n*.002)));
  if (neighbor == id || voxelSolid(neighbor)) return false;
  float layer = reflectedLayer(id,n);
  return textureLod(uTex, vec3(reflectedUV(p,n),layer), 1.0).a > .44;
}
vec3 reflectedBlock(int id, vec3 p, vec3 n, float rayDistance, vec3 rayDirection) {
  id=voxelSurfaceId(id,p,n); // mesma cobertura da malha nas rampas de duas camadas
  float layer = reflectedLayer(id,n);
  float lod = clamp(log2(max(1.0, rayDistance * .09)), 0.0, 3.0);
  vec4 tex = textureLod(uTex,vec3(reflectedUV(p,n),layer),lod);
  vec3 albedo = tex.rgb;
  // A grade guarda id e faces, não temperatura/umidade por célula. A tinta usa
  // um verde médio; textura, recorte, orientação e posição são do bloco atingido.
  if (layer >= ${TINT_D0}.0) albedo *= vec3(.12,.25,.08);
  else if (layer >= ${TINT_C0}.0) albedo *= vec3(.19,.32,.10);
  else if (layer >= ${TINT_B0}.0) albedo *= mix(vec3(1.0),vec3(.19,.32,.10),1.0-tex.a);
  // O verso do recorte é iluminado como no material DoubleSide, depois de usar
  // a face original para escolher a textura correta.
  if (dot(n,rayDirection)>0.0) n=-n;
  float occ = voxelSolid(voxelAt(ivec3(floor(p + n*.08 + vec3(0,1.2,0))))) ? .3 : 1.0;
  vec3 ambient = mix(uAmbGround,uAmbSky,n.y*.5+.5) * occ;
  vec3 light = uSunColor * max(dot(n,uLightDir),0.0) * waterSunVisibility(p,n);
  float emission = voxelSolid(id) && layer < ${TINT_B0}.0 ? 1.0-tex.a : 0.0;
  return albedo * (ambient + light + uMinAmb) + albedo*albedo*emission*3.8;
}
vec3 localSurfaceReflection(vec3 sky, vec3 ro, vec3 r, float cameraDistance) {
  // Saída direta inclui VR. Peso zero implica nenhuma travessia da grade.
  float focus = uDirect < .5 ? voxelFocus(cameraDistance) : 0.0;
  if (focus <= 0.0) return sky;
  float t; vec3 n; int id;
  if (!traceVoxels(ro,r,uVoxRange,t,n,id)) return sky;
  float weight = focus * (1.0-smoothstep(uVoxRange*.82,uVoxRange,t));
  vec3 hit = ro+r*t;
  vec3 color = reflectedBlock(id,hit,n,t,r);
  vec4 air = fogAt(t,r,hit.y);
  return mix(sky,mix(color,air.rgb,air.a),weight);
}
vec3 localWaterReflection(vec3 sky, vec3 p, vec3 r, float cameraDistance) {
  return localSurfaceReflection(sky,p+vec3(0,.035,0),r,cameraDistance);
}
#endif
`;
