// Mesmo deslocamento no terreno visível e no passo de profundidade.
// Coordenadas contínuas mantêm juntas as faces vizinhas da copa.
export const CANOPY_WIND = /* glsl */`
uniform float uWindTime;
uniform vec3 uWind;
vec3 canopyWind(vec3 p) {
  float wave = sin(uWindTime * 0.83 + p.x * 0.19 + p.z * 0.13);
  float gust = 0.6 + 0.4 * sin(uWindTime * 0.29 + p.x * 0.045 + p.z * 0.036);
  float fine = sin(uWindTime * 2.1 + p.x * 1.15 + p.y * 0.8 + p.z * 0.9);
  float sway=(wave*0.063+fine*0.014)*gust*uWind.z;
  return vec3(sway*uWind.x,fine*0.009*gust*uWind.z,sway*uWind.y);
}
`;
