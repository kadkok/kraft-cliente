// Arquitetura do xogunato em coordenadas locais da ficha do arquipélago.
// O servidor e os aparelhos usam os mesmos blocos para colisão, iluminação e desenho.
import { B } from './blocks.js';
import { hash3 } from './noise.js';

// A ficha é instalada explicitamente no mapa do mundo escolhido.
export const ILHA_XOGUNATO = Object.freeze({
  id: 'xogunato', nome: 'Ilha do Xogunato', tema: 'xogunato', x: 4224, z: -3648, r: 335, semente: 1603,
  cais: [4224, -3349, 2, 25],
});
export const ENTRADA_EDO = Object.freeze([0.5, 52.1, 62.5]);
export const LAGOS_EDO = [
  { x: -64, z: -24, rx: 27, rz: 19 }, { x: 64, z: -22, rx: 26, rz: 16 },
];
export const CAMPOS_EDO = [
  { x: -106, z: 85 }, { x: -80, z: 85 }, { x: -106, z: 107 }, { x: -80, z: 107 },
  { x: 78, z: 90 }, { x: 104, z: 90 }, { x: 78, z: 112 }, { x: 104, z: 112 },
];
export const MARCOS_EDO = [
  { nome: 'Castelo das Duas Luas', x: 0, z: -78 }, { nome: 'Castelo do Pinheiro Negro', x: 108, z: -77 },
  { nome: 'Pagode das Cinco Estações', x: -111, z: -64 }, { nome: 'Templo do Sino', x: -132, z: 13 },
  { nome: 'Templo do Lótus', x: 110, z: 27 }, { nome: 'Santuário das Cerejeiras', x: -71, z: 31 },
  { nome: 'Aldeia das Garças', x: -91, z: 140 }, { nome: 'Aldeia dos Juncos', x: 91, z: 140 },
  { nome: 'Jardim das Carpas', x: -64, z: -24 },
];
export const ROTAS_SAMURAIS = [
  [[-3, -42], [3, -42], [3, -10], [-3, -10]],
  [[-20, 4], [20, 4], [20, 30], [-20, 30]],
  [[80, -51], [109, -51], [109, -42], [80, -42]],
  [[-136, -42], [-104, -42], [-104, -48], [-136, -48]],
];
const CHAO = 51;
const madeira = B.PINE_PLANKS, pedra = B.STONE_BRICKS, telha = B.BASALT;
const sorte = (x, z, n) => hash3(x, z, n, 1603) / 4294967296;
const limitar = x => Math.max(0, Math.min(1, x));

export function relevoEdo(u, v, ruido) {
  // As ruas e os arrozais ocupam a planície. Dois espigões de pedra emolduram a cidade ao norte.
  const morro = (cx, cz, rx, rz, h) => {
    const a = (u - cx) / rx, b = (v - cz) / rz, t = limitar(1 - a * a - b * b);
    return h * t * t;
  };
  const longe = limitar((Math.max(Math.abs(u) - 155, -v - 108, v - 170)) / 60);
  return 3 + longe * (morro(-95, -207, 139, 99, 64) + morro(103, -220, 112, 92, 48) +
    morro(-215, 35, 62, 154, 24) + 2 * (1 + ruido(u * .032, v * .032)));
}

export function criarVilaEdo(cx, cz) {
  // Cada operação fica nos pedaços que toca. Um telhado ou um lago distante não é percorrido.
  const indice = new Map();
  function reg(x0, z0, x1, z1, coluna) {
    const op = { x0, z0, x1, z1, coluna };
    for (let j = (cz + z0) >> 4; j <= (cz + z1) >> 4; j++) {
      for (let i = (cx + x0) >> 4; i <= (cx + x1) >> 4; i++) {
        const k = i + ',' + j;
        if (!indice.has(k)) indice.set(k, []);
        indice.get(k).push(op);
      }
    }
  }
  function caixa(x0, y0, z0, x1, y1, z1, b) {
    reg(x0, z0, x1, z1, (x, z, escrever) => {
      for (let y = y0; y <= y1; y++) escrever(x, y, z, b);
    });
  }
  function poste(x, z, y, h, b = B.PINE_LOG) { caixa(x, y, z, x, y + h - 1, z, b); }
  function piso(x, z, w, d, y, b) { caixa(x-w, y, z-d, x+w, y, z+d, b); }
  function rua(x0, z0, x1, z1) {
    reg(x0, z0, x1, z1, (x, z, put) => {
      const borda = x === x0 || x === x1 || z === z0 || z === z1;
      put(x, CHAO, z, borda ? pedra : sorte(x,z,11) < .2 ? B.SANDSTONE : B.GRAVEL);
    });
  }
  function lanterna(x, z, y = CHAO+1) {
    poste(x,z,y,2,pedra); poste(x,z,y+2,1,B.LAMP); poste(x,z,y+3,1,B.BASALT);
  }
  function torii(x,z,y,w=6) {
    for (const s of [-1,1]) { poste(x+s*w,z,y,1,pedra); poste(x+s*w,z,y+1,8,B.PLASTER_RED); }
    caixa(x-w-1,y+5,z,x+w+1,y+5,z,B.PLASTER_RED);
    caixa(x-w-2,y+8,z-1,x+w+2,y+8,z+1,B.PLASTER_RED);
    caixa(x-w-2,y+9,z-1,x+w+2,y+9,z+1,telha);
    for (const s of [-1,1]) poste(x+s*(w+3),z,y+10,1,telha);
    poste(x,z,y+6,2,madeira);
  }
  function cobertura(x,z,y,w,d,cor=telha,abertura=null) {
    reg(x-w,z-d,x+w,z+d,(u,v,put) => {
      const a=w-Math.abs(u-x), b=d-Math.abs(v-z), beiral=Math.min(a,b);
      if (abertura && a > w-abertura[0] && b > d-abertura[1]) return;
      const curva=Math.floor(beiral*.38 + beiral*beiral*.027);
      const canto = Math.max(a,b) < 2 ? 1 : 0;
      const altura = y + curva + canto;
      if (beiral === 0 || Math.min(a,b) === Math.max(a,b)) put(u,altura-1,v,madeira);
      put(u,altura,v,cor);
      if (b === d && a >= d) put(u,altura+1,v,pedra);
    });
  }
  function salao(x,z,y,w,d,h,parede,estrutura,portal=1) {
    piso(x,z,w,d,y,madeira);
    const coluna = (u,v,put) => {
      const lateral = Math.abs(u-x) === w, frente = Math.abs(v-z) === d;
      if (!lateral && !frente) return;
      if (frente && Math.abs(u-x) <= portal) { put(u,y+h,v,estrutura); return; }
      const passo=lateral ? v-z+d : u-x+w;
      const pilastra=lateral && frente || passo % 4 === 0;
      for (let t=1;t<=h;t++) {
        const b=pilastra || t===h || t===1 ? estrutura : t===2 && passo%4===2 ? B.GLASS : parede;
        put(u,y+t,v,b);
      }
    };
    reg(x-w,z-d,x+w,z+d,coluna);
  }
  function escada(x,z,y,h,largura) {
    // Do caminho ao sul para o patamar ao norte, um degrau de altura por passada.
    for(let n=0;n<h;n++) caixa(x-largura,y,z-n,x+largura,y+n,z-n,pedra);
  }
  function muralha(x,z,w,d,y) {
    for(const lado of [-1,1]){
      caixa(x-w,y,z+lado*d,x+w,y+2,z+lado*d,B.PLASTER_WHITE);
      caixa(x-w-1,y+3,z+lado*d,x+w+1,y+3,z+lado*d,telha);
      caixa(x+lado*w,y,z-d,x+lado*w,y+2,z+d,B.PLASTER_WHITE);
      caixa(x+lado*w,y+3,z-d,x+lado*w,y+3,z+d,telha);
      for(const ix of [-1,1]){
        const a=x+ix*w,b=z+lado*d;
        salao(a,b,y-1,3,3,4,B.PLASTER_WHITE,madeira);
        cobertura(a,b,y+4,5,5);
      }
    }
    caixa(x-3,y,z+d,x+3,y+3,z+d,B.AIR);
    cobertura(x,z+d,y+5,7,3);
  }
  function castelo(x,z,andares,escuro) {
    const largo=escuro?15:19, fundo=escuro?11:14, base=escuro?5:7;
    muralha(x,z,largo+8,fundo+7,CHAO+1);
    for(let h=0;h<base;h++){
      const recuo=Math.floor(h/2);
      piso(x,z,largo+3-recuo,fundo+3-recuo,CHAO+h+1,h%3===0?pedra:B.STONE);
    }
    escada(x,z+fundo+base+1,CHAO+1,base,2);
    let y=CHAO+base;
    for(let n=0;n<andares;n++){
      const w=largo-3*n,d=fundo-2*n, ultimo=n===andares-1;
      salao(x,z,y,w,d,5,escuro?B.PLASTER_DARK:B.PLASTER_WHITE,escuro?B.PINE_LOG:madeira,2);
      cobertura(x,z,y+6,w+3,d+3,telha,ultimo?null:[w-3,d-2]);
      y+=8;
    }
    // Dois lances paralelos com patamar de retorno, abertos depois dos pisos superiores.
    for(let n=0;n<andares-1;n++){
      const y0=CHAO+base+n*8,dir=n%2===0?1:-1;
      const lateral=dir===1?x-4:x+2;
      for(let k=0;k<8;k++){
        const v=z+(k-3)*dir;
        caixa(lateral,y0+k+2,v,lateral+2,y0+k+4,v,B.AIR);
        caixa(lateral,y0+k+1,v,lateral+2,y0+k+1,v,madeira);
      }
      const retorno=z+4*dir;
      caixa(x-4,y0+8,retorno,x+4,y0+8,retorno,madeira);
      caixa(x-4,y0+9,retorno,x+4,y0+10,retorno,B.AIR);
    }
    const cumeeira=CHAO+base+(andares-1)*8+6;
    const d=fundo-2*(andares-1)+3, h=cumeeira+Math.floor(d*.38+d*d*.027)+2;
    for(const lado of [-1,1]) poste(x+lado*(largo-fundo-(andares-1)),z,h,2,B.GOLD_BLOCK);
  }
  function pagode(x,z){
    piso(x,z,14,14,CHAO,pedra);
    for(let n=0;n<5;n++){
      const w=9-n,y=CHAO+n*6;
      salao(x,z,y,w-2,w-2,4,B.PLASTER_WHITE,B.PLASTER_RED);
      cobertura(x,z,y+5,w+2,w+2,telha,n<4?[w-3,w-3]:null);
    }
    poste(x,z,CHAO+32,10,B.PINE_LOG);
    for(const h of [34,36,38])piso(x,z,1,1,CHAO+h,B.GOLD_BLOCK);
    poste(x,z,CHAO+42,1,B.GOLD_BLOCK);
  }
  function templo(x,z,w,d){
    piso(x,z,w+3,d+3,CHAO,pedra);
    salao(x,z,CHAO+1,w,d,6,B.PLASTER_WHITE,B.PLASTER_RED,2);
    for(let a=-w;a<=w;a+=4)poste(x+a,z+d+2,CHAO+2,5,B.PLASTER_RED);
    cobertura(x,z,CHAO+8,w+3,d+3);
    // O pórtico tem um telhado próprio sobre a varanda e uma mesa para as oferendas ao fundo.
    cobertura(x,z+d+2,CHAO+6,5,3);
    caixa(x-2,CHAO+2,z-d+2,x+2,CHAO+2,z-d+3,B.PLANKS);
    for(const s of [-1,1])lanterna(x+s*(w+3),z+d+5);
  }
  function ponte(x,z,meia,larg=2){
    for(let k=-meia;k<=meia;k++){
      const y=CHAO+Math.round(2*(1-(k/meia)**2));
      caixa(x-larg,y,z+k,x+larg,y,z+k,B.PLANKS);
      for(const s of [-1,1]){
        if((k+meia)%4===0)poste(x+s*(larg+1),z+k,y,3,B.PLASTER_RED);
        caixa(x+s*(larg+1),y+2,z+k,x+s*(larg+1),y+2,z+k,B.PLASTER_RED);
      }
    }
  }
  function lago(l){
    reg(l.x-l.rx-2,l.z-l.rz-2,l.x+l.rx+2,l.z+l.rz+2,(x,z,put)=>{
      const dx=(x-l.x)/l.rx,dz=(z-l.z)/l.rz;
      const q=dx*dx+dz*dz+.06*dx*dz+.075*dx*dz*dz;
      if(q>1.06)return;
      if(q>=.96){
        put(x,CHAO,z,sorte(x,z,17)<.65?B.GRAVEL:B.STONE);
        if(Math.abs(dx)>.38 && sorte(x,z,35)<.17)put(x,CHAO+1,z,B.REEDS);
        return;
      }
      const fundo=CHAO-2-Math.floor((1-q)*2.6);
      put(x,fundo,z,q>.7?B.SAND:B.CLAY);
      for(let y=fundo+1;y<CHAO;y++)put(x,y,z,B.WATER);
      put(x,CHAO,z,B.AIR);
    });
    // Grupos assimétricos de pedras e flores margeiam o lago. O eixo da ponte fica livre.
    for(const [dx,dz] of [[-.72,-.67],[.81,.52],[-.89,.31]]){
      const x=l.x+Math.round(l.rx*dx), z=l.z+Math.round(l.rz*dz);
      caixa(x-1,CHAO-1,z,x+1,CHAO,z+1,B.STONE);
      poste(x-1,z,CHAO+1,1,B.BASALT);
      poste(x+2,z+1,CHAO,1,B.STONE);
      const margemX=x+Math.sign(dx)*3,margemZ=z+Math.sign(dz)*3;
      for(const [u,v,b] of [[0,0,B.FERN],[1,0,B.FLOWER_BLUE],[0,1,B.FERN],[-1,1,B.FLOWER_WHITE]]){
        poste(margemX+u,margemZ+v,CHAO,1,B.GRASS);
        poste(margemX+u,margemZ+v,CHAO+1,1,b);
      }
    }
  }
  function arrozal(c){
    const w=11,d=8;
    reg(c.x-w,c.z-d,c.x+w,c.z+d,(x,z,put)=>{
      const borda=Math.abs(x-c.x)===w||Math.abs(z-c.z)===d;
      if(borda){put(x,CHAO,z,B.DIRT);return;}
      put(x,CHAO-2,z,B.CLAY);put(x,CHAO-1,z,B.WATER);put(x,CHAO,z,B.AIR);
    });
  }
  function casa(x,z,w,d,tipo,cor){
    const rural=tipo==='rural', y=CHAO;
    salao(x,z,y,w,d,3,rural?B.SANDSTONE:B.PLASTER_WHITE,madeira);
    cobertura(x,z,y+4,w+2,d+1,rural?B.PLANKS:telha);
    if(!rural){
      caixa(x-w,y+3,z+d+1,x+w,y+3,z+d+1,B.PINE_PLANKS);
      for(let u=-2;u<=2;u++)if(u!==0)poste(x+u,z+d+1,y+2,1,cor);
      poste(x+w+1,z+d,y+2,1,B.LAMP);
    }
    // Esteira e balcão deixam o centro da passagem livre.
    caixa(x-w+1,y,z-d+1,x-2,y,z+d-1,B.PLANKS);
    caixa(x+w-2,y+1,z-d+1,x+w-1,y+1,z-d+2,madeira);
  }
  function cerejeira(x,z,n){
    const h=5+Math.floor(sorte(x,z,n)*3);
    poste(x,z,CHAO+1,h,B.LOG);
    for(let i=0;i<5;i++){
      const rumos=[[3,0],[2,2],[0,3],[-2,2],[-3,0],[-2,-2],[0,-3],[2,-2]];
      const [a,b]=rumos[(Math.floor(sorte(x,z,n+2)*8)+Math.floor(i*8/5))%8],y=CHAO+h+(i%2);
      for(let k=1;k<=3;k++)poste(x+Math.round(a*k/3),z+Math.round(b*k/3),y-2+Math.floor(k/2),2,B.LOG);
      const X=x+a,Z=z+b,R=3+(i+n)%2;
      reg(X-R,Z-R,X+R,Z+R,(u,v,put)=>{
        const q=((u-X)**2+(v-Z)**2)/(R*R);
        if(q>1.13)return;
        const esp=Math.floor(2.5*Math.sqrt(Math.max(0,1-Math.min(1,q))));
        for(let dy=-esp;dy<=esp;dy++)if(q<.52||sorte(u,v,dy+i)>.18)put(u,y+2+dy,v,B.SAKURA);
      });
    }
  }
  // Jōkamachi: rua de mercadores entre portões, ponte e castelo; travessas levam às duas aldeias.
  rua(-4,-54,4,153);
  for(const v of [-45,3,29,56,73,131])rua(-150,v-2,139,v+2);
  for(const u of [-135,-110,-49,-22,22,49,112])rua(u-1,-50,u+1,74);
  for(const l of LAGOS_EDO)lago(l);
  // Fosso em frente ao castelo principal e a ponte de madeira sobre ele.
  caixa(-27,CHAO-2,-53,27,CHAO-2,-48,B.CLAY);
  caixa(-27,CHAO-1,-53,27,CHAO-1,-48,B.WATER);
  caixa(-27,CHAO,-53,27,CHAO,-48,B.AIR);
  ponte(0,-50,5,3); ponte(-64,-24,21,2);
  castelo(0,-78,4,false);castelo(108,-77,3,true);
  pagode(-111,-64);templo(-132,13,9,6);templo(110,27,10,7);
  // Pavilhão do sino, independente dos salões.
  for(const a of [-3,3])for(const b of [-3,3])poste(-132+a,32+b,CHAO+1,5,B.PLASTER_RED);
  cobertura(-132,32,CHAO+6,5,5);poste(-132,32,CHAO+3,3,B.GOLD_BLOCK);
  templo(-71,31,6,4);torii(-71,44,CHAO+1,4);torii(0,83,CHAO+1,7);
  const tecidos=[B.PLASTER_BLUE,B.PLASTER_RED,B.PLASTER_GREEN,B.PLASTER_YELLOW];
  for(const u of [-39,-12,12,39]){
    for(const [i,v] of [-28,-11,15,42].entries())casa(u,v,5,4,'loja',tecidos[(i+(u>0?1:0))%4]);
  }
  for(const c of CAMPOS_EDO)arrozal(c);
  for(const s of [-1,1]){
    rua(s*91-2,120,s*91+2,161);
    for(const u of [66,83,103,123])for(const v of [140,157])casa(s*u,v,5,4,'rural');
    for(const v of [-40,-12,15,42,68,95,126])lanterna(s*5,v);
    for(const v of [72,93,115,133])cerejeira(s*21,v,Math.abs(v));
  }
  const bosques=[[-98,25],[-91,41],[-87,57],[-114,-29],[-96,-42],[-85,-50],[-60,-47],[-43,-54],
    [45,-44],[52,-51],[75,-47],[89,-35],[86,-7],[80,4],[96,9],[125,49],[141,39],[-149,46],
    [-124,62],[-53,89],[51,91],[-56,114],[54,134],[-99,174],[91,176]];
  bosques.forEach(([u,v],i)=>cerejeira(u,v,i));
  return function obras(x0,z0,set){
    const ops=indice.get((x0>>4)+','+(z0>>4));
    if(!ops)return;
    const u0=x0-cx,v0=z0-cz;
    const put=(x,y,z,b)=>set(cx+x,y,cz+z,b);
    for(const op of ops){
      const xmax=Math.min(u0+15,op.x1),zmax=Math.min(v0+15,op.z1);
      for(let v=Math.max(v0,op.z0);v<=zmax;v++)
        for(let u=Math.max(u0,op.x0);u<=xmax;u++)op.coluna(u,v,put);
    }
  };
}
