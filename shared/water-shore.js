// Água no volume retirado das rampas. Derivado dos vizinhos: não cria fontes,
// não substitui terreno e não acrescenta estado ao arquivo do mundo.
import { LEVEL } from './blocks.js';
import { CUBE, SHAPES, readerShape, shapeHeight } from './surfaces.js';

const CORNERS = [[0,0],[1,0],[1,1],[0,1]];
const SIDES = [[0,-1],[1,0],[0,1],[-1,0]];
const EPS = 1e-7;

function columnByte(get,x,y,z) {
  const level = LEVEL[get(x,y,z)] || 0;
  return level ? (LEVEL[get(x,y+1,z)] ? 255 : level * 28) : 0;
}
// Mesmo contrato da água existente no mesher: altura compartilhada no vértice.
export function waterCornerByte(get,x,y,z) {
  let high=0;
  for(let dz=-1;dz<=0;dz++)for(let dx=-1;dx<=0;dx++)high=Math.max(high,columnByte(get,x+dx,y,z+dz));
  return high;
}

function shoreCornerByte(get,x,y,z) {
  const direct=waterCornerByte(get,x,y,z);
  if(direct)return direct;
  // Canto interior à margem: procurar a primeira faixa ao redor do VÉRTICE,
  // nunca ao redor da célula. Duas rampas precisam obter a mesma altura aqui.
  let high=0;
  for(let dz=-2;dz<=1;dz++)for(let dx=-2;dx<=1;dx++)high=Math.max(high,columnByte(get,x+dx,y,z+dz));
  return high;
}

export function shoreWater(get,x,y,z,shape=readerShape(get,x,y,z)) {
  if(shape===CUBE)return null;
  const ground=SHAPES[shape], above=!!LEVEL[get(x,y+1,z)];
  let high=above?255:0;
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)high=Math.max(high,columnByte(get,x+dx,y,z+dz));
  if(!high)return null;
  const heights=CORNERS.map(([u,v])=>(above?255:shoreCornerByte(get,x+u,y,z+v))/255);
  const center=heights.reduce((a,b)=>a+b,0)/4;
  const depth=heights.map((h,i)=>h-ground.heights[i]),middle=center-ground.center;
  let mask=above?15:0;
  // Uma borda de comprimento positivo alimenta seu triângulo. Um mero ponto
  // de contato na diagonal não atravessa os dois cubos que o cercam.
  for(let i=0;i<4;i++){
    const [dx,dz]=SIDES[i],j=(i+1)&3;
    if(LEVEL[get(x+dx,y,z+dz)] && Math.max(depth[i],depth[j])>EPS)mask|=1<<i;
    const [u,v]=CORNERS[i],sx=u?1:-1,sz=v?1:-1;
    if(depth[i]<=EPS || !LEVEL[get(x+sx,y,z+sz)])continue;
    const sX=readerShape(get,x+sx,y,z),sZ=readerShape(get,x,y,z+sz),h=heights[i];
    const viaX=sX!==CUBE && shapeHeight(sX,1-u,v)<h-EPS;
    const viaZ=sZ!==CUBE && shapeHeight(sZ,u,1-v)<h-EPS;
    if(viaX||viaZ)mask|=(1<<i)|(1<<((i+3)&3));
  }
  // Os quatro triângulos formam um anel. Só há passagem entre dois deles se
  // algum trecho da aresta radial estiver abaixo da água (sela/crista intacta).
  for(let pass=0;pass<4;pass++)for(let i=0;i<4;i++){
    const prev=(i+3)&3,pair=(1<<i)|(1<<prev);
    if((mask&pair) && Math.max(depth[i],middle)>EPS)mask|=pair;
  }
  if(!mask)return null;
  // A rampa de baixo pode estar cheia até o teto e continuar vazia na camada
  // de cima. Esse teto é interno ao volume de água, não uma segunda superfície.
  const covered=above || (heights.every(h=>h===1) && readerShape(get,x,y+1,z)!==CUBE);
  return {shape,heights,center,mask,covered};
}

// Triângulos na ordem do catálogo: canto, centro, canto seguinte.
export function shoreTriangles(water) {
  const ground=SHAPES[water.shape],out=[];
  for(let i=0;i<4;i++){
    if(!(water.mask&(1<<i)))continue;
    const j=(i+1)&3;
    const poly=[
      [CORNERS[i][0],water.heights[i],CORNERS[i][1],water.heights[i]-ground.heights[i]],
      [.5,water.center,.5,water.center-ground.center],
      [CORNERS[j][0],water.heights[j],CORNERS[j][1],water.heights[j]-ground.heights[j]],
    ],clipped=[];
    for(let k=0;k<3;k++){
      const a=poly[k],b=poly[(k+1)%3],inside=a[3]>=0,next=b[3]>=0;
      if(inside)clipped.push(a);
      if(inside!==next){const t=a[3]/(a[3]-b[3]);clipped.push(a.map((v,n)=>v+(b[n]-v)*t));}
    }
    for(let k=1;k+1<clipped.length;k++){
      const a=clipped[0],b=clipped[k],c=clipped[k+1];
      const area=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
      if(area>EPS && Math.max(a[3],b[3],c[3])>EPS)out.push([a,b,c]);
    }
  }
  return out;
}

export function shoreHeightAt(water,u,v) {
  // Coordenadas baricêntricas no leque original; o clip é o próprio chão.
  const i=v<=u?(v<=1-u?0:1):(v<=1-u?3:2);
  if(!(water.mask&(1<<i)))return 0;
  const j=(i+1)&3,[ax,az]=CORNERS[i],[cx,cz]=CORNERS[j];
  const d=(.5-cz)*(ax-cx)+(cx-.5)*(az-cz);
  const a=((.5-cz)*(u-cx)+(cx-.5)*(v-cz))/d;
  const b=((cz-az)*(u-cx)+(ax-cx)*(v-cz))/d;
  return water.heights[i]*a+water.center*b+water.heights[j]*(1-a-b);
}
