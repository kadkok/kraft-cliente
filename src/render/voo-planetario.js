import * as THREE from '../three.js';
import { B } from '../../shared/blocks.js';
import { SEA } from '../../shared/constants.js';
import { U } from './materials.js';

const nivel = SEA + 1;
const limitar = (x, a, b) => Math.max(a, Math.min(b, x));
function suave(a, b, x) {
  const t = limitar((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function faseOrbital(y, escalaMapa = 2600) {
  const h = y - nivel;
  const curvatura = suave(125, 580, h);
  return {
    mistura: suave(125, 375, h),
    espaco: suave(230, 940, h),
    raio: 1 / ((1 - curvatura) / 120000 + curvatura / 760),
    escala: escalaMapa,
    mapa: suave(240, 800, h),
  };
}
export function caixaOrbital(gen, x, z) {
  if (!gen.arq) {
    const cx = Math.round(x / 1024) * 1024,
      cz = Math.round(z / 1024) * 1024;
    return [cx - 3200, cz - 3200, cx + 3200, cz + 3200];
  }
  const caixas = [gen.arq.caixa, ...gen.arq.ilhas.map((i) => i.caixa)];
  const x0 = Math.min(...caixas.map((b) => b[0])) - 180,
    z0 = Math.min(...caixas.map((b) => b[1])) - 180;
  const x1 = Math.max(...caixas.map((b) => b[2])) + 180,
    z1 = Math.max(...caixas.map((b) => b[3])) + 180;
  return [x0, z0, x1, z1];
}

const biomas = [
  [43, 88, 117],
  [194, 182, 133],
  [105, 135, 85],
  [61, 103, 77],
  [70, 104, 91],
  [205, 216, 214],
  [174, 148, 96],
  [131, 139, 80],
  [134, 139, 132],
];
const cobertura = {
  [B.SNOW]: [204, 215, 218],
  [B.SAND]: [203, 189, 145],
  [B.STONE]: [117, 123, 121],
  [B.BASALT]: [69, 70, 76],
  [B.MAGMA]: [226, 108, 39],
  [B.ASH]: [101, 98, 94],
  [B.CONCRETE]: [151, 147, 139],
  [B.WATER]: [58, 129, 131],
};
function atlas(gen, box, n) {
  const pixels = new Uint8Array(n * n * 4);
  const tex = new THREE.DataTexture(pixels, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  let row = 0;
  function linha() {
    const z = Math.floor(box[1] + ((row + 0.5) * (box[3] - box[1])) / n);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(box[0] + ((i + 0.5) * (box[2] - box[0])) / n);
      const h = gen.height(x, z),
        k = (row * n + i) * 4;
      let cor,
        luz = 1;
      if (h < SEA) {
        const rasa = 1 - suave(0, 22, SEA - h);
        cor = [25 + 41 * rasa, 68 + 75 * rasa, 99 + 48 * rasa];
      } else {
        const topo = gen.topoEm(x, z);
        cor = cobertura[topo.top] || (topo.copa ? biomas[3] : biomas[gen.biomeAt(x, z)] || biomas[2]);
        const incl = (gen.height(x - 4, z - 4) - h) / 8;
        luz = limitar(0.98 + incl * 0.23 + Math.sin(x * 0.037 + z * 0.059) * 0.025, 0.7, 1.21);
      }
      pixels[k] = Math.min(255, cor[0] * luz);
      pixels[k + 1] = Math.min(255, cor[1] * luz);
      pixels[k + 2] = Math.min(255, cor[2] * luz);
      pixels[k + 3] = limitar(h + 64, 0, 255);
    }
    row++;
  }
  return {
    tex,
    avancar(ms) {
      const ini = performance.now();
      do {
        if (row >= n) break;
        linha();
      } while (performance.now() - ini < ms);
      if (row < n) return false;
      tex.needsUpdate = true;
      return true;
    },
  };
}

const VS = `
precision highp float;
in vec3 position; out vec2 tela;
uniform float zCamada;
void main(){ tela=position.xy; gl_Position=vec4(position.xy,zCamada,1.0); }`;
const FS = `
precision highp float;
uniform sampler2D relevo;
uniform mat4 projInv, cameraMundo;
uniform vec4 caixa;
uniform vec3 olho,sol,zenite,horizonte;
uniform float altura,raio,escalaMapa,mistura,espaco,direto,nivelMar;
in vec2 tela;out vec4 saida;
vec4 mapa(vec3 n){
  float a=atan(length(n.xz),n.y);
  vec2 terreno=olho.xz+n.xz*(escalaMapa*a/max(length(n.xz),.000001));
  vec2 uv=(terreno-caixa.xy)/(caixa.zw-caixa.xy);
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(.094,.254,.374,.29);
  return texture(relevo,uv);
}
vec3 tons(vec3 c){
  c=max(c,vec3(0)); c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.0,1.0);
  return mix(12.92*c,1.055*pow(c,vec3(1.0/2.4))-.055,step(vec3(.0031308),c));
}
void main(){
  vec4 r=projInv*vec4(tela,1.,1.);
  vec3 d=normalize(mat3(cameraMundo)*(r.xyz/r.w));
  vec3 origem=vec3(0.,raio+altura,0.);
  float b=dot(origem,d),perp=length(cross(origem,d));
  float aa=max(.035,fwidth(perp)*.7);
  float terra=(b<0.)?1.-smoothstep(raio-aa,raio+aa,perp):0.;
  float dia=smoothstep(-.21,.24,sol.y);
  vec3 ar=mix(horizonte,zenite,smoothstep(-.1,.8,d.y));
  vec3 vazio=mix(vec3(.0018,.0032,.009),vec3(.006,.014,.033),dia);
  vec3 ceu=mix(ar,vazio,espaco);
  // atmosfera espacial (Kadmus, 23/11/2026): fora do planeta o céu fica preto de verdade, com estrelas fixas e a faixa
  // da Via Láctea, que acendem com espaco (sem ar não há céu azul nem cintilação; o Sol continua um disco).
  if(espaco>.001){
    vec3 cel=floor(d*360.);
    float hs=fract(sin(dot(cel,vec3(12.9898,78.233,37.719)))*43758.5453);
    vec3 fr=fract(d*360.)-.5;
    float est=step(.9965,hs)*smoothstep(.5,.08,length(fr))*(.45+.55*fract(hs*91.7));
    vec3 tom=mix(vec3(.75,.85,1.),vec3(1.,.86,.7),fract(hs*13.1));
    vec3 eixoVia=normalize(vec3(.32,.55,-.77));
    float via=exp(-pow(dot(d,eixoVia)*5.5,2.));
    ceu=mix(ceu,vazio*.6,espaco*.5);
    ceu+=(tom*est*2.2+vec3(.035,.04,.06)*via)*espaco;
  }
  float disco=smoothstep(.99989,.99997,dot(d,sol));
  ceu+=vec3(1.7,1.42,1.1)*disco;
  float distBorda=abs(perp-raio)/raio;
  if(b<0.)ceu+=vec3(.08,.24,.47)*exp(-distBorda*85.)*(.25+.75*dia);
  vec3 cor=ceu;
  if(terra>0.){
    float t=altura*(2.*raio+altura)/max(.0001,-b+sqrt(max(0.,(raio-perp)*(raio+perp))));
    vec3 normal=normalize(origem+d*t);
    vec4 amostra=mapa(normal);
    // Uma segunda interseção corrige a paralaxe das montanhas da própria semente.
    float elevado=max(0.,amostra.a*255.-64.-nivelMar);
    float rr=raio+elevado;
    float tTerra=(altura-elevado)*(2.*raio+altura+elevado)/max(.0001,-b+sqrt(max(0.,(rr-perp)*(rr+perp))));
    normal=normalize(origem+d*tTerra);
    amostra=mapa(normal);
    vec3 pigmento=pow(amostra.rgb,vec3(2.2));
    float luz=max(0.,dot(normal,sol)), borda=pow(1.-max(0.,dot(normal,-d)),3.);
    vec3 superficie=pigmento*(.21+.24*dia+1.8*luz);
    superficie=mix(superficie,horizonte*.73,borda*(.48-.16*espaco));
    cor=mix(ceu,superficie,terra);
  }
  // O céu já cobriu o antigo horizonte plano antes de o terreno terminar a fusão.
  float alfa=mix(smoothstep(125.,205.,altura),mistura,terra);
  saida=vec4(direto>.5?tons(cor):cor,alfa);
}`;

export function initVooPlanetario({ scene, game, player }) {
  const uniformes = {
    relevo: { value: null },
    caixa: { value: new THREE.Vector4() },
    olho: { value: new THREE.Vector3() },
    projInv: { value: new THREE.Matrix4() },
    cameraMundo: { value: new THREE.Matrix4() },
    altura: { value: 0 },
    raio: { value: 1 },
    escalaMapa: { value: 1 },
    mistura: { value: 0 },
    espaco: { value: 0 },
    nivelMar: { value: nivel },
    zCamada: { value: 0.99 },
    direto: U.uDirect,
    sol: U.uSunDir,
    zenite: U.uZenith,
    horizonte: U.uHorizon,
  };
  const mat = new THREE.RawShaderMaterial({
    name: 'voo-planetario',
    glslVersion: THREE.GLSL3,
    uniforms: uniformes,
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  quad.renderOrder = 2500;
  quad.visible = false;
  quad.name = 'horizonte-planetario';
  scene.add(quad);
  let anterior = null,
    box = null,
    grosseiro = null,
    refino = null,
    pronto = false;
  function limpar() {
    grosseiro?.tex.dispose();
    refino?.tex.dispose();
    grosseiro = refino = null;
    uniformes.relevo.value = null;
    pronto = false;
    box = null;
  }
  game.hooks.frame.push(() => {
    const gen = game.gen,
      p = player.pos;
    if (gen !== anterior) {
      limpar();
      anterior = gen;
    }
    quad.visible =
      !!gen && game.dim === 0 && (game.state === 'PLAYING' || game.state === 'PAUSED') && p[1] - nivel > 123;
    if (!quad.visible) return;
    const afastou =
      !gen.arq &&
      box &&
      (Math.abs(p[0] - (box[0] + box[2]) / 2) > 1300 || Math.abs(p[2] - (box[1] + box[3]) / 2) > 1300);
    if (!box || afastou) {
      limpar();
      box = caixaOrbital(gen, p[0], p[2]);
      uniformes.caixa.value.fromArray(box);
      grosseiro = atlas(gen, box, 40);
      grosseiro.avancar(Infinity);
      uniformes.relevo.value = grosseiro.tex;
      refino = atlas(gen, box, 256);
    }
    if (!pronto && refino.avancar(2)) {
      pronto = true;
      uniformes.relevo.value = refino.tex;
      grosseiro.tex.dispose();
      grosseiro = null;
    }
  });
  quad.onBeforeRender = (_renderer, _scene, cam) => {
    const u = uniformes;
    u.olho.value.setFromMatrixPosition(cam.matrixWorld);
    const h = u.olho.value.y - nivel,
      escala = Math.max(box[2] - box[0], box[3] - box[1]) * 0.49;
    const fase = faseOrbital(u.olho.value.y, escala);
    u.altura.value = Math.max(1, h);
    u.raio.value = fase.raio;
    u.mistura.value = fase.mistura;
    u.espaco.value = fase.espaco;
    u.escalaMapa.value = THREE.MathUtils.lerp(fase.raio, escala, fase.mapa);
    u.projInv.value.copy(cam.projectionMatrixInverse);
    u.cameraMundo.value.copy(cam.matrixWorld);
    // Próximo da câmera, o teste de profundidade ainda preserva o cockpit e outros jogadores.
    const distancia = Math.min(cam.far * 0.9, limitar(h * 0.07, 9, 24));
    u.zCamada.value = -cam.projectionMatrix.elements[10] + cam.projectionMatrix.elements[14] / distancia;
    mat.uniformsNeedUpdate = true;
  };
  return {
    get ativo() {
      return quad.visible;
    },
    get mistura() {
      return quad.visible ? uniformes.mistura.value : 0;
    },
    get pronto() {
      return pronto;
    },
    get caixa() {
      return box?.slice();
    },
  };
}
