// Forma independe do material. O mesmo catálogo atende malha, mira e colisões.
import { B, KIND, K_CUBE, NATURAL, SOLID, IS_STAIR } from './blocks.js';
import { MINI_OK, DEFAULT_STAIR_STATE, isMiniState, miniBoxes } from './minis.js';
import { MC_BASE } from './mc-estados.js';
import { MC_FORMAS, MC_FORMA_DO } from './mc-colisao.js';

export const CUBE = 15;
export const TERRAIN = new Uint8Array(128);
for (let id=1;id<TERRAIN.length;id++) TERRAIN[id]=NATURAL[id] && KIND[id]===K_CUBE ? 1:0;
for(const id of [B.BEDROCK,B.LOG,B.PINE_LOG,B.CACTUS,B.ROOT,B.PINE_ROOT]) if(id!==undefined)TERRAIN[id]=0;
const CORNERS=[[0,0],[1,0],[1,1],[0,1]];
const SIDES=[5,0,4,1];
const full = id => id===-1 || (id>0 && SOLID[id]===1);
const noEdit=()=>false;
const colH = new Int16Array(9), colA = new Uint8Array(9), colS = new Uint8Array(9);
const cornerH = new Int16Array(4);

// A altura é compartilhada entre colunas e também entre camadas. Uma encosta
// diagonal pode atravessar dois blocos: recortá-la só no bloco de cima deixava
// pequenos degraus triangulares nas quinas.
export function surfaceShape(get, edited=noEdit, x,y,z) {
  const b=get(x,y,z);
  const mini=get.mini?.(x,y,z)||0;
  if(mini>=MC_BASE&&b>=B.MC_SOLIDO&&b<=B.MC_FORMA){const f=MC_FORMA_DO[mini-MC_BASE];return f===undefined||f===0xffff?CUBE:MC_SHAPE_BASE+f;}   // bloco do Minecraft
  if(isMiniState(mini)&&(MINI_OK[b]||IS_STAIR[b]))return miniShape(mini);
  if(IS_STAIR[b])return miniShape(DEFAULT_STAIR_STATE);
  if(!TERRAIN[b] || edited(x,y,z))return CUBE;
  const above=get(x,y+1,z);
  let top=y+1;
  if(full(above)){
    if(!TERRAIN[above]||edited(x,y+1,z)||full(get(x,y+2,z)))return CUBE;
    top++;
  }
  colS.fill(0);
  let allGe1 = true, allLe0 = true, maxH = -999, code = 0;
  for(let i=0;i<4;i++){
    const cx=CORNERS[i][0],cz=CORNERS[i][1];
    let low=9999,high=-9999,anchor=0;
    for(let dz=0;dz<=1;dz++)for(let dx=0;dx<=1;dx++){
      const idx=(cx+dx)+(cz+dz)*3;
      let h, a;
      if(colS[idx]){
        h=colH[idx];a=colA[idx];
      }else{
        const xx=x+cx+dx-1,zz=z+cz+dz-1;
        h=top-3;a=0;
        for(let yy=top+1;yy>=top-3;yy--){
          const bb=get(xx,yy,zz);
          if(bb===-1){h=top+3;a=1;break;}
          if(full(bb)){
            if(edited(xx,yy,zz)||!TERRAIN[bb])a=1;
            h=yy+1;break;
          }
        }
        colH[idx]=h;colA[idx]=a;colS[idx]=1;
      }
      if(h<low)low=h;
      if(h>high)high=h;
      anchor|=a;
    }
    const edge=high-low>2||low<top-2?Math.max(top-1,Math.min(top,low)):low;
    const hv=(anchor?top:edge)-y;
    cornerH[i]=hv;
    if(hv<1)allGe1=false;
    if(hv>0)allLe0=false;
    if(hv>maxH)maxH=hv;
    const cl=hv<-1?-1:hv>2?2:hv;
    code+=(cl+1)<<(i*2);
  }
  if(allGe1)return CUBE;
  // Pico isolado volta a cubo; sem pontas piramidais nem degraus no meio da encosta.
  if(maxH<top-y)return CUBE;
  if(allLe0)return 16;
  return 16+code;
}

// Centro da rampa pela diagonal de menor desnível (sem levantar telhados/pirâmides).
export function cornerCenter(h) {
  const d0 = Math.abs(h[0] - h[2]), d1 = Math.abs(h[1] - h[3]);
  const m0 = (h[0] + h[2]) / 2, m1 = (h[1] + h[3]) / 2;
  return d0 < d1 ? m0 : d1 < d0 ? m1 : Math.min(m0, m1);
}

function triangle(a,b,c,face) {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);
  return l<1e-8?null:{v:[a,b,c],n:[nx/l,ny/l,nz/l],face};
}
export const SHAPES=Array.from({length:16},(_,mask)=>{
  const heights=CORNERS.map((_,i)=>(mask>>i)&1), count=heights.reduce((a,b)=>a+b,0);
  const center=count===0||count>=3||mask===5||mask===10?1:count===1?0:.5;
  const vertices=CORNERS.map(([x,z],i)=>[x,heights[i],z]),middle=[.5,center,.5];
  const top=[],faces=[];
  for(let i=0;i<4;i++){
    const j=(i+1)&3,a=vertices[i],b=vertices[j];
    const t=triangle(a,middle,b,2);top.push(t);faces.push(t);
    const lowA=[a[0],0,a[2]],lowB=[b[0],0,b[2]];
    faces.push(triangle(lowA,a,b,SIDES[i]),triangle(lowA,b,lowB,SIDES[i]));
  }
  faces.push(triangle([0,0,0],[1,0,0],[1,0,1],3),triangle([0,0,0],[1,0,1],[0,0,1],3));
  return {heights,center,top,faces:faces.filter(Boolean)};
});

function clip(poly,height,above){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],inside=above?a[1]>=height:a[1]<=height,next=above?b[1]>=height:b[1]<=height;
    if(inside)out.push(a);
    if(inside!==next){const t=(height-a[1])/(b[1]-a[1]);out.push(a.map((v,j)=>v+(b[j]-v)*t));}
  }
  return out;
}
function triangulate(poly,face,out,cap=false,allowZero=false){
  if(face===2&&!allowZero&&poly.every(v=>v[1]<=0))return;
  if(face===2&&allowZero&&poly.every(v=>v[1]<0))return;
  for(let i=1;i+1<poly.length;i++){const t=triangle(poly[0],poly[i],poly[i+1],face);if(t){t.cap=cap;out.push(t);}}
}
for(let peak=0;peak<=2;peak++)for(let code=0;code<256;code++){
  // O miolo segue a diagonal de menor desnível (cornerCenter), evitando
  // pirâmides e buracos escuros. render/voxelfield.js repete em voxelHeights.
  const heights=CORNERS.map((_,i)=>((code>>(i*2))&3)-1);
  const center=peak||cornerCenter(heights);
  const vertices=CORNERS.map(([x,z],i)=>[x,heights[i],z]),middle=[.5,center,.5],top=[],faces=[];
  const keepZero=heights.every(h=>h>=0)&&heights.some(h=>h>0);
  for(let i=0;i<4;i++){
    const j=(i+1)&3,a=vertices[i],b=vertices[j],raw=[a,middle,b];
    triangulate(clip(clip(raw,0,true),1,false),2,top,false,keepZero);
    triangulate(clip(raw,1,true).map(v=>[v[0],1,v[2]]),2,top,true);
    triangulate(clip(clip([[a[0],0,a[2]],a,b,[b[0],0,b[2]]],0,true),1,false),SIDES[i],faces);
    if(raw.some(v=>v[1]>0))triangulate(clip(raw,0,true).map(v=>[v[0],0,v[2]]).reverse(),3,faces);
  }
  faces.push(...top);SHAPES.push({heights,center,top,faces});
}

export const MINI_BASE=SHAPES.length;
export const miniShape=(s)=>isMiniState(s)?MINI_BASE+s:CUBE;
export const isMiniShape=(shape)=>shape>=MINI_BASE&&shape<MINI_BASE+64;
const MINI_DIRS=[
  (b)=>[[b[3],b[1],b[2]],[b[3],b[4],b[2]],[b[3],b[4],b[5]],[b[3],b[1],b[5]]],
  (b)=>[[b[0],b[1],b[2]],[b[0],b[1],b[5]],[b[0],b[4],b[5]],[b[0],b[4],b[2]]],
  (b)=>[[b[0],b[4],b[2]],[b[0],b[4],b[5]],[b[3],b[4],b[5]],[b[3],b[4],b[2]]],
  (b)=>[[b[0],b[1],b[2]],[b[3],b[1],b[2]],[b[3],b[1],b[5]],[b[0],b[1],b[5]]],
  (b)=>[[b[0],b[1],b[5]],[b[3],b[1],b[5]],[b[3],b[4],b[5]],[b[0],b[4],b[5]]],
  (b)=>[[b[0],b[1],b[2]],[b[0],b[4],b[2]],[b[3],b[4],b[2]],[b[3],b[1],b[2]]],
];
for(let s=0;s<64;s++){
  if(!isMiniState(s)){SHAPES.push({heights:[0,0,0,0],center:0,top:[],faces:[],quads:null,boxes:null});continue;}
  const boxes=miniBoxes(s),top=[],faces=[],quads=[];
  for(const b of boxes){
    for(let d=0;d<6;d++){
      const ax=d>>1,pos=d&1,outer=pos===0?b[ax+3]===1:b[ax]===0;
      if(!outer){
        const u=(ax+1)%3,v=(ax+2)%3;
        let hidden=false;
        for(const o of boxes){
          if(o===b)continue;
          if((pos===0?o[ax]===b[ax+3]:o[ax+3]===b[ax])&&o[u]===b[u]&&o[u+3]===b[u+3]&&o[v]===b[v]&&o[v+3]===b[v+3]){hidden=true;break;}
        }
        if(hidden)continue;
      }
      const qv=MINI_DIRS[d](b),t1=triangle(qv[0],qv[1],qv[2],d),t2=triangle(qv[0],qv[2],qv[3],d);
      if(t1){t1.outer=outer;faces.push(t1);if(d===2)top.push(t1);}
      if(t2){t2.outer=outer;faces.push(t2);if(d===2)top.push(t2);}
      quads.push({v:qv,n:(t1||t2).n,face:d,outer});
    }
  }
  SHAPES.push({heights:[1,1,1,1],center:1,top,faces,quads,boxes});
}

// Blocos do Minecraft (tools/mc/colisao.py): o contorno do modelo vale para mirar; colide = 0 deixa atravessar
// (flor, capim, tocha…), como no Minecraft. Caixas que se tocam não escondem faces entre si: a mira só precisa do raio.
export const MC_SHAPE_BASE=SHAPES.length;
export const isMcShape=(shape)=>shape>=MC_SHAPE_BASE&&shape<MC_SHAPE_BASE+MC_FORMAS.length;
for(const [caixas,colide] of MC_FORMAS){
  const top=[],faces=[];
  for(const b of caixas)for(let d=0;d<6;d++){
    const qv=MINI_DIRS[d](b),t1=triangle(qv[0],qv[1],qv[2],d),t2=triangle(qv[0],qv[2],qv[3],d);
    if(t1){t1.outer=true;faces.push(t1);if(d===2&&colide)top.push(t1);}
    if(t2){t2.outer=true;faces.push(t2);if(d===2&&colide)top.push(t2);}
  }
  SHAPES.push({heights:[1,1,1,1],center:1,top,faces,quads:null,boxes:colide?caixas:[],mc:true});
}

function inside(t,x,z) {
  const [a,b,c]=t.v;
  const det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det;
  const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det;
  return u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8;
}
function heightOn(t,x,z){const a=t.v[0],n=t.n;return a[1]-(n[0]*(x-a[0])+n[2]*(z-a[2]))/n[1];}
export function shapeHeight(shape,x,z) {
  if(shape===CUBE)return 1;
  x=Math.max(0,Math.min(1,x));z=Math.max(0,Math.min(1,z));
  const s=SHAPES[shape];
  if(s.boxes){
    let h=0;
    for(const t of s.top)if(inside(t,x,z))h=Math.max(h,heightOn(t,x,z));
    return h;
  }
  for(const t of s.top)if(inside(t,x,z))return heightOn(t,x,z);
  return 0;
}
export function shapeNormal(shape,x,z,out=[0,1,0]) {
  for(const t of SHAPES[shape].top)if(inside(t,x,z)){out[0]=t.n[0];out[1]=t.n[1];out[2]=t.n[2];break;}
  return out;
}

// Máximo exato da superfície linear por trechos sobre um retângulo (pé/AABB).
export function shapeMax(shape,x0,z0,x1,z1) {
  if(shape===CUBE)return 1;
  x0=Math.max(0,x0);z0=Math.max(0,z0);x1=Math.min(1,x1);z1=Math.min(1,z1);
  const boxes=SHAPES[shape]?.boxes;
  if(boxes){
    let h=0;
    for(const b of boxes)if(x1>b[0]+1e-7&&x0<b[3]-1e-7&&z1>b[2]+1e-7&&z0<b[5]-1e-7)h=Math.max(h,b[4]);
    return h;
  }
  let h=Math.max(shapeHeight(shape,x0,z0),shapeHeight(shape,x1,z0),shapeHeight(shape,x1,z1),shapeHeight(shape,x0,z1));
  for(const t of SHAPES[shape].top)for(let i=0;i<3;i++){
    const a=t.v[i],b=t.v[(i+1)%3];
    if(a[0]>=x0&&a[0]<=x1&&a[2]>=z0&&a[2]<=z1)h=Math.max(h,a[1]);
    if(a[0]!==b[0])for(const x of [x0,x1]){const q=(x-a[0])/(b[0]-a[0]),z=a[2]+q*(b[2]-a[2]);if(q>=0&&q<=1&&z>=z0&&z<=z1)h=Math.max(h,a[1]+q*(b[1]-a[1]));}
    if(a[2]!==b[2])for(const z of [z0,z1]){const q=(z-a[2])/(b[2]-a[2]),x=a[0]+q*(b[0]-a[0]);if(q>=0&&q<=1&&x>=x0&&x<=x1)h=Math.max(h,a[1]+q*(b[1]-a[1]));}
  }
  return h;
}

// Raio local, distância no mesmo parâmetro do DDA. Normal de face para colocar;
// normal geométrica separada para rodas, luz e contato físico.
export function shapeRay(shape,ox,oy,oz,dx,dy,dz,maxT) {
  const s=SHAPES[shape];
  const insideOrigin=s?.boxes
    ?s.boxes.some(b=>ox>=b[0]&&ox<=b[3]&&oz>=b[2]&&oz<=b[5]&&oy>=b[1]&&oy<b[4]-1e-7)
    :(ox>=0&&ox<=1&&oz>=0&&oz<=1&&oy>=0&&oy<shapeHeight(shape,ox,oz)-1e-7);
  if(insideOrigin)return {t:0,n:[0,1,0],face:2};
  let result=null,best=maxT+1e-7;
  for(const f of s.faces){
    const [a,b,c]=f.v,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const px=dy*vz-dz*vy,py=dz*vx-dx*vz,pz=dx*vy-dy*vx,det=ux*px+uy*py+uz*pz;
    if(Math.abs(det)<1e-9)continue;
    const sx=ox-a[0],sy=oy-a[1],sz=oz-a[2],u=(sx*px+sy*py+sz*pz)/det;
    if(u< -1e-7||u>1+1e-7)continue;
    const qx=sy*uz-sz*uy,qy=sz*ux-sx*uz,qz=sx*uy-sy*ux,v=(dx*qx+dy*qy+dz*qz)/det;
    if(v< -1e-7||u+v>1+1e-7)continue;
    const t=(vx*qx+vy*qy+vz*qz)/det;
    if(t>=-1e-7&&t<best){best=Math.max(0,t);result={t:best,n:f.n,face:f.face};}
  }
  return result;
}

export function readerShape(get,x,y,z){return get.shape?get.shape(x,y,z):CUBE;}
export function pointSolid(get,x,y,z){
  const bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z);
  if(!full(get(bx,by,bz)))return false;
  const s=readerShape(get,bx,by,bz),boxes=SHAPES[s]?.boxes;
  if(boxes){
    const lx=x-bx,ly=y-by,lz=z-bz;
    return boxes.some(b=>lx>=b[0]&&lx<=b[3]&&lz>=b[2]&&lz<=b[5]&&ly>=b[1]&&ly<b[4]);
  }
  return y-by<shapeHeight(s,x-bx,z-bz);
}
export function boxSolid(get,x0,y0,z0,x1,y1,z1){
  for(let y=Math.floor(y0);y<=Math.floor(y1-1e-7);y++)for(let z=Math.floor(z0);z<=Math.floor(z1-1e-7);z++)for(let x=Math.floor(x0);x<=Math.floor(x1-1e-7);x++){
    if(!full(get(x,y,z)))continue;
    const s=readerShape(get,x,y,z),boxes=SHAPES[s]?.boxes;
    if(boxes){
      const lx0=x0-x,ly0=y0-y,lz0=z0-z,lx1=x1-x,ly1=y1-y,lz1=z1-z;
      for(const b of boxes)if(lx1>b[0]+1e-7&&lx0<b[3]-1e-7&&ly1>b[1]+1e-6&&ly0<b[4]-1e-6&&lz1>b[2]+1e-7&&lz0<b[5]-1e-7)return true;
      continue;
    }
    const height=shapeMax(s,x0-x,z0-z,x1-x,z1-z);
    if(height>1e-7&&y0<y+height-1e-6)return true;
  }
  return false;
}

export function floorHeight(get,x,z,ceiling,drop,radius,slopesOnly=false){
  let best=-Infinity;
  for(let y=Math.floor(ceiling);y>=Math.floor(ceiling-drop)-1;y--)for(let bz=Math.floor(z-radius);bz<=Math.floor(z+radius);bz++)for(let bx=Math.floor(x-radius);bx<=Math.floor(x+radius);bx++){
    if(!full(get(bx,y,bz)))continue;
    const s=readerShape(get,bx,y,bz);if(slopesOnly&&s===CUBE)continue;
    const boxes=SHAPES[s]?.boxes;
    if(boxes){
      if(slopesOnly)continue;
      const rx0=x-radius-bx,rz0=z-radius-bz,rx1=x+radius-bx,rz1=z+radius-bz;
      for(const b of boxes){
        if(rx1<=b[0]+1e-7||rx0>=b[3]-1e-7||rz1<=b[2]+1e-7||rz0>=b[5]-1e-7)continue;
        const h=y+b[4];
        if(h<=ceiling+1e-6&&h>=ceiling-drop-1e-6)best=Math.max(best,h);
      }
      continue;
    }
    const height=shapeMax(s,x-radius-bx,z-radius-bz,x+radius-bx,z+radius-bz);if(height<=1e-7)continue;
    const h=y+height;
    if(h<=ceiling+1e-6&&h>=ceiling-drop-1e-6)best=Math.max(best,h);
  }
  return best;
}

// Ponto mais próximo de um triângulo, usado só nos poucos contatos de rampas.
function closest(p,a,b,c){
  const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]),ap=p.map((v,i)=>v-a[i]);
  const dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2],d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=p.map((v,i)=>v-b[i]),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return a.map((q,i)=>q+v*ab[i]);}
  const cp=p.map((v,i)=>v-c[i]),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return a.map((q,i)=>q+w*ac[i]);}
  const va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return b.map((q,i)=>q+w*(c[i]-b[i]));}
  const den=1/(va+vb+vc),v=vb*den,w=vc*den;return a.map((q,i)=>q+ab[i]*v+ac[i]*w);
}
export function shapeSphere(shape,x,y,z,r=.5){
  const s=SHAPES[shape];
  if(!s.faces.length)return null;
  const p=[x,y,z];let distance=Infinity,point=null,face=null;
  const inside=s.boxes
    ?s.boxes.some(b=>x>=b[0]&&x<=b[3]&&y>=b[1]&&y<=b[4]&&z>=b[2]&&z<=b[5])
    :(x>=0&&x<=1&&z>=0&&z<=1&&y>=0&&y<=shapeHeight(shape,x,z));
  for(const f of s.faces){
    const q=closest(p,...f.v),d=Math.hypot(x-q[0],y-q[1],z-q[2]);
    if(d<distance){distance=d;point=q;face=f;}
  }
  if(!inside&&distance>=r)return null;
  const n=inside||distance<1e-7?face.n:[(x-point[0])/distance,(y-point[1])/distance,(z-point[2])/distance];
  return {n,depth:inside?r+distance:r-distance};
}
