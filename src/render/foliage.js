// Copas: substitui as faces cúbicas por ramos cruzados no mesmo lote do chunk.
// Só representação: os voxels, edições, colisões e decisões de natureza são preservados.
import * as THREE from '../three.js';
import { TINT_D0, TEX_INDEX, OPAQUE } from '../../shared/blocks.js';
import { hash3 } from '../../shared/noise.js';
import { leafCenter } from '../../shared/tree-canopy.js';
import { isTroncoQuadrado } from '../../shared/minis.js';
import { CUBE } from '../../shared/surfaces.js';
import { isTreeWood } from '../../shared/trees.js';

const NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const random = (x,y,z,k) => hash3(x + k * 31,y,z) / 4294967296;

export function foliageBuffers(pos, dat, count, cx = 0, cz = 0, planes = 3) {
  const cells = new Map(), keep = [];
  for (let q = 0; q < count; q += 4) {
    const layer = pos[q * 4 + 3];
    if (layer < TINT_D0) { keep.push(q); continue; }
    const dir = dat[q * 4] & 7;
    if (dir > 5) { keep.push(q); continue; }
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<4;i++)for(let a=0;a<3;a++){const v=pos[(q+i)*4+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
    // Faces greedy podem cobrir várias células: reconstituir toda a superfície.
    const axis=dir>>1,from=min.map(v=>Math.floor(v+1e-5)),to=max.map(v=>Math.ceil(v-1e-5)-1);
    from[axis]=to[axis]=Math.floor(min[axis]-NORMALS[dir][axis]*.5);
    for(let x=from[0];x<=to[0];x++)for(let y=from[1];y<=to[1];y++)for(let z=from[2];z<=to[2];z++) {
      const p=[x,y,z],key=p.join(','),light=dat[q*4+1];
      if(!cells.has(key))cells.set(key,{p,layer,light,cl:[dat[q*4+2],dat[q*4+3]]});
      else {const old=cells.get(key).light;cells.get(key).light=Math.max(old&15,light&15)|(Math.max(old>>4,light>>4)<<4);}
    }
  }
  if (!cells.size) return null;
  planes=planes===6?6:3;
  const quads=keep.length+cells.size*planes,n=quads*4;
  const p=new Float32Array(n*4),d=new Uint8Array(n*4),c=new Float32Array(n*3),idx=new Uint32Array(quads*6);
  let at=0;
  for(const q of keep) {p.set(pos.subarray(q*4,q*4+16),at*4);d.set(dat.subarray(q*4,q*4+16),at*4);at+=4;}
  for(const cell of cells.values()) {
    const [x,y,z]=cell.p,wx=x+cx,wz=z+cz;
    const center=leafCenter(wx,y,wz);center[0]-=cx;center[2]-=cz;
    const angle=random(wx,y,wz,4)*Math.PI;
    for(let plane=0;plane<planes;plane++) {
      const a=angle+plane*2.39996,tilt=(plane%3===2?1.15:.50)*(random(wx,y,wz,6+plane)*2-1);
      const span=(planes===6?1.12:1.42)+random(wx,y,wz,15+plane)*.20;
      const branch=center.map((v,axis)=>v+(random(wx,y,wz,30+plane*3+axis)-.5)*.58);
      const r=[Math.cos(a),0,Math.sin(a)],u0=[-Math.sin(a)*Math.sin(tilt),Math.cos(tilt),Math.cos(a)*Math.sin(tilt)];
      const roll=random(wx,y,wz,50+plane)*Math.PI*2,co=Math.cos(roll),si=Math.sin(roll);
      const right=r.map((v,i)=>v*co+u0[i]*si),up=u0.map((v,i)=>v*co-r[i]*si);
      for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]) {
        for(let axis=0;axis<3;axis++) {p[at*4+axis]=branch[axis]+((u-.5)*right[axis]+(v-.5)*up[axis])*span;c[at*3+axis]=center[axis];}
        p[at*4+3]=cell.layer;
        d.set([6|24|(u<<6)|(v<<7),cell.light,...cell.cl],at*4);at++;
      }
    }
  }
  for(let q=0;q<quads;q++){const b=q*4;idx.set([b,b+1,b+2,b,b+2,b+3],q*6);}
  return {pos:p,dat:d,crown:c,index:idx,cells:cells.size,removed:count/4-keep.length,quads};
}

export function crownShader(source) {
  if(!source.includes('in vec4 aDat;')||!source.includes('if (ni < 6) {'))return null;
  return source.replace('in vec4 aDat;','in vec4 aDat;\nin vec3 aCrown;').replace('if (ni < 6) {',`if (aPos.w >= ${TINT_D0}.0) {
    uv = vec2(float((f >> 6) & 1), float((f >> 7) & 1));
    n = normalize((p - aCrown) * vec3(0.75, 1.0, 0.75) + vec3(0.0, 0.32, 0.0));
    vTop = 2.0;
  } else if (ni < 6) {`).replace(`if (aPos.w >= ${TINT_D0}.0) vTint = leafColor(cl);`,
    `if (aPos.w >= ${TINT_D0}.0) { vec3 biome=leafColor(cl); vTint=mix(vec3(1.0),biome/max(dot(biome,vec3(.2126,.7152,.0722)),.001),.10); }`);
}

const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TRUNK_R = 0.49, TRUNK_G = 0.36, TRUNK_E = 0.5, TRUNK_C45 = Math.SQRT1_2 * TRUNK_R;
// Mandacaru: costela funda, crista alta. O corpo cabe na célula; o espinho passa um pouco da face.
export const CACTUS_RIBS = 8, CACTUS_GROOVE = 0.26, CACTUS_RIDGE = 0.42;

// Perfil 2D de um tronco tubular conectado nos 4 quadrantes (0..3, sentido +X -> +Z -> -X -> -Z).
// conn[q]: vizinho sólido na direção DIRS4[q]; roundNb[q]: vizinho é outro tronco tubular; diag[q]: diagonal sólida.
// fino (prova de realismo): o quarto de círculo livre sai em 4 trechos em vez de 2 (tronco de 16 lados, contorno redondo)
export function trunkProfile(conn, roundNb, diag, fino = false) {
  const segs = [];
  for (let q = 0; q < 4; q++) {
    const u0 = DIRS4[q], u1 = DIRS4[(q + 1) & 3];
    const c0 = !!conn[q], c1 = !!conn[(q + 1) & 3];
    const r0 = !!roundNb[q], r1 = !!roundNb[(q + 1) & 3], cd = !!diag[q];
    const pt = (a, b) => [u0[0] * a + u1[0] * b, u0[1] * a + u1[1] * b];
    const nrm = (a, b) => {
      const l = Math.hypot(a, b) || 1;
      return [(u0[0] * a + u1[0] * b) / l, 0, (u0[1] * a + u1[1] * b) / l];
    };
    const seg = (a, b, na, nb, ua, ub, wall) => segs.push({ a, b, na, nb, ua, ub, wall });
    const uBase = q * 0.75;
    if (!c0 && !c1 && fino) {
      for (let k = 0; k < 4; k++) {
        const a0 = k * Math.PI / 8, a1 = (k + 1) * Math.PI / 8;
        seg(pt(TRUNK_R * Math.cos(a0), TRUNK_R * Math.sin(a0)), pt(TRUNK_R * Math.cos(a1), TRUNK_R * Math.sin(a1)),
          nrm(Math.cos(a0), Math.sin(a0)), nrm(Math.cos(a1), Math.sin(a1)), uBase + k * 0.1875, uBase + (k + 1) * 0.1875, true);
      }
    } else if (!c0 && !c1) {
      const p0 = pt(TRUNK_R, 0), p1 = pt(TRUNK_C45, TRUNK_C45), p2 = pt(0, TRUNK_R);
      const n0 = nrm(1, 0), n1 = nrm(1, 1), n2 = nrm(0, 1);
      seg(p0, p1, n0, n1, uBase, uBase + 0.375, true);
      seg(p1, p2, n1, n2, uBase + 0.375, uBase + 0.75, true);
    } else if (c0 && !c1) {
      const pe = pt(TRUNK_E, 0), p0 = pt(TRUNK_E, TRUNK_G), p1 = pt(0.25, 0.46), p2 = pt(0, TRUNK_R);
      const n0 = nrm(0.35, 0.94), n1 = nrm(0.45, 0.89), n2 = nrm(0, 1);
      seg(pe, p0, n0, n0, 0, 0, false);
      seg(p0, p1, n0, n1, uBase + 0.12, uBase + 0.43, true);
      seg(p1, p2, n1, n2, uBase + 0.43, uBase + 0.75, true);
    } else if (!c0 && c1) {
      const p0 = pt(TRUNK_R, 0), p1 = pt(0.46, 0.25), p2 = pt(TRUNK_G, TRUNK_E), pe = pt(0, TRUNK_E);
      const n0 = nrm(1, 0), n1 = nrm(0.89, 0.45), n2 = nrm(0.94, 0.35);
      seg(p0, p1, n0, n1, uBase, uBase + 0.32, true);
      seg(p1, p2, n1, n2, uBase + 0.32, uBase + 0.63, true);
      seg(p2, pe, n2, n2, 0, 0, false);
    } else {
      const p0 = pt(TRUNK_E, 0), p1 = pt(TRUNK_E, TRUNK_G), p2 = pt(TRUNK_E, TRUNK_E), p3 = pt(TRUNK_G, TRUNK_E), p4 = pt(0, TRUNK_E);
      const nu0 = nrm(1, 0), nu1 = nrm(0, 1);
      seg(p0, p1, nu0, nu0, 0, 0, false);
      seg(p1, p2, nu0, nu0, uBase + 0.12, uBase + 0.26, r0 && !cd);
      seg(p2, p3, nu1, nu1, uBase + 0.49, uBase + 0.63, r1 && !cd);
      seg(p3, p4, nu1, nu1, 0, 0, false);
    }
  }
  return segs;
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Coluna de cacto (Cereus / mandacaru). A base entra no chão; o topo fecha num domo baixo, com as costelas.
function emitCactus(emit, cell, x, z, y0, yTop, sideLayer, topLayer) {
  const h = yTop + 1 - y0, cx = x + .5, cz = z + .5, ribs = CACTUS_RIBS, seg = 4, around = ribs * seg;
  const phase = (hash3(x, y0, z) / 4294967296) * Math.PI * 2;
  const fat = 0.94 + (hash3(x, y0 + 3, z) / 4294967296) * 0.06;
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const scaleAt = (yn) => {
    const t = clamp01(yn / h);
    let s;
    if (h < 1.5) {
      const u = clamp01((yn + .04) / (h + .04));
      const bell = Math.sin(Math.pow(u, .72) * Math.PI);
      s = .55 + .45 * Math.pow(Math.max(0, bell), .6);
      const k = clamp01((u - .78) / .22);
      s *= .55 + .45 * Math.cos(k * Math.PI * .5);
    } else {
      const k = clamp01((t - .9) / .1);
      s = (1 - .03 * t) * (.42 + .58 * Math.cos(Math.pow(k, .65) * Math.PI * .5));
    }
    const foot = yn < .16 ? .84 + .16 * clamp01(yn / .16) : 1;
    return s * foot;
  };
  const radius = (y, ang) => {
    const lobe = Math.pow(.5 + .5 * Math.cos(ribs * ang), 1.15);
    return (CACTUS_GROOVE + (CACTUS_RIDGE - CACTUS_GROOVE) * lobe) * scaleAt(y - y0) * fat;
  };
  const posAt = (y, ang) => {
    const rad = radius(y, ang);
    return [cx + Math.cos(ang) * rad, y, cz + Math.sin(ang) * rad];
  };
  const normalAt = (y, ang) => {
    const e = .016, p = posAt(y, ang);
    return norm3(cross3(sub3(posAt(y + e, ang), p), sub3(posAt(y, ang + e), p)));
  };
  const yEnd = y0 + h, ys = [];
  for (let y = y0 - .05; y < yEnd - .12; y += h < 1.5 ? .14 : .18) ys.push(y);
  const crown = y0 + h * (h < 1.5 ? .62 : .78);
  for (let y = Math.max(ys[ys.length - 1] + .05, crown); y < yEnd - .02; y += .09) ys.push(y);
  ys.push(yEnd - .012);
  const band = (yLo, yHi) => {
    for (let i = 0; i < around; i++) {
      const a0 = phase + i * Math.PI * 2 / around, a1 = phase + (i + 1) * Math.PI * 2 / around;
      const u0 = (i % seg) / seg, u1 = (i + 1) % seg === 0 ? 1 : ((i + 1) % seg) / seg;
      const quad = [[yLo, a0, u0], [yHi, a0, u0], [yHi, a1, u1], [yLo, a1, u1]];
      for (const [y, ang, u] of quad) {
        const n = normalAt(y, ang);
        const ny = Math.abs(n[1]) > .82 ? Math.sign(n[1] || 1) * .82 : n[1];
        const hl = Math.hypot(n[0], n[2]) || 1, sc = Math.sqrt(Math.max(0, 1 - ny * ny)) / hl;
        emit(posAt(y, ang), [n[0] * sc, ny, n[2] * sc], u, cell, sideLayer, 0);
      }
    }
  };
  for (let k = 0; k < ys.length - 1; k++) band(ys[k], ys[k + 1]);
  const tip = [cx, yEnd, cz], up = [0, 1, 0];
  for (let i = 0; i < around; i++) {
    const a0 = phase + i * Math.PI * 2 / around, a1 = phase + (i + 1) * Math.PI * 2 / around;
    const y = ys[ys.length - 1];
    for (const v of [tip, posAt(y, a1), posAt(y, a0), tip]) emit(v, up, 0, cell, topLayer, 2);
  }
  const spike = (y, ang, len) => {
    const base = posAt(y, ang), n = normalAt(y, ang);
    const dir = norm3([n[0], n[1] * .2 + .28, n[2]]);
    const tipS = [base[0] + dir[0] * len, base[1] + dir[1] * len, base[2] + dir[2] * len];
    let side = cross3(dir, [0, 1, 0]);
    if (side[0] * side[0] + side[2] * side[2] < 1e-6) side = cross3(dir, [1, 0, 0]);
    side = norm3(side);
    const bin = norm3(cross3(dir, side)), w = .0065, ring = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI * .5, c = Math.cos(a), s = Math.sin(a);
      ring.push([base[0] + (side[0] * c + bin[0] * s) * w, base[1] + (side[1] * c + bin[1] * s) * w, base[2] + (side[2] * c + bin[2] * s) * w]);
    }
    for (let k = 0; k < 4; k++) {
      const a = ring[k], b = ring[(k + 1) % 4];
      const cr = cross3(sub3(b, a), sub3(tipS, a));
      const out = cr[0] * dir[0] + cr[1] * dir[1] + cr[2] * dir[2] >= 0;
      const fn = norm3(out ? cr : [-cr[0], -cr[1], -cr[2]]);
      for (const v of (out ? [a, b, tipS, tipS] : [b, a, tipS, tipS])) emit(v, fn, .5, cell, sideLayer, 0);
    }
  };
  const period = 1 / 7;
  for (let rib = 0; rib < ribs; rib++) {
    const ang0 = phase + rib * Math.PI * 2 / ribs;
    for (let y = y0 + .036; y < yEnd - (h < 1.5 ? .28 : .36); y += period) {
      const wob = (hash3(x + rib, Math.round(y * 20), z) / 4294967296 - .5) * .12;
      const len = .09 + (hash3(x, Math.round(y * 20) + rib, z + 9) / 4294967296) * .07;
      spike(y, ang0 + wob, len);
      spike(y, ang0 + wob + .16, len * .55);
      spike(y, ang0 + wob - .16, len * .5);
    }
  }
}

export function trunkBuffers(pos,dat,count,skip=null,keepCell=null,neighbor=null,fino=false) {
  const ids=[TEX_INDEX.log_side,TEX_INDEX.log_top,TEX_INDEX.pine_side,TEX_INDEX.pine_top];
  const cactusSide=TEX_INDEX.cactus_side,cactusTop=TEX_INDEX.cactus_top;
  const cells=new Map(),cacti=new Map(),keep=[];
  for(let q=0;q<count;q+=4){
    const layer=pos[q*4+3],dir=dat[q*4]&7;
    const cactus=layer===cactusSide||layer===cactusTop;
    if((!cactus&&!ids.includes(layer))||dir>5){keep.push(q);continue;}
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<4;i++)for(let a=0;a<3;a++){const v=pos[(q+i)*4+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
    const axis=dir>>1,from=min.map(v=>Math.floor(v+1e-5)),to=max.map(v=>Math.ceil(v-1e-5)-1);from[axis]=to[axis]=Math.floor(min[axis]-NORMALS[dir][axis]*.5);
    if(!cactus&&keepCell?.(from[0],from[1],from[2])){keep.push(q);continue;}
    const bag=cactus?cacti:cells;
    for(let x=from[0];x<=to[0];x++)for(let y=from[1];y<=to[1];y++)for(let z=from[2];z<=to[2];z++){
      const key=[x,y,z].join(','),light=dat[q*4+1];
      if(!bag.has(key))bag.set(key,{p:[x,y,z],pine:!cactus&&(layer===ids[2]||layer===ids[3]),light,cl:[dat[q*4+2],dat[q*4+3]],caps:new Set()});
      else {const old=bag.get(key).light;bag.get(key).light=Math.max(old&15,light&15)|(Math.max(old>>4,light>>4)<<4);}
      if(!cactus&&(dir===2||dir===3))bag.get(key).caps.add(dir);
    }
  }
  if(!cells.size&&!cacti.size)return null;
  const p=[],d=[],round=[],index=[];
  for(const q of keep){p.push(...pos.subarray(q*4,q*4+16));d.push(...dat.subarray(q*4,q*4+16));round.push(...new Array(16).fill(0));}
  const emit=(v,normal,u,cell,layer,dir)=>{p.push(...v,layer);d.push(dir|24,cell.light,...cell.cl);round.push(...normal,u);};
  for(const c of cells.values()){
    if(skip?.(...c.p))continue;
    const [x,y,z]=c.p,cx=x+.5,cz=z+.5,side=c.pine?ids[2]:ids[0],top=c.pine?ids[3]:ids[1];
    const nb=neighbor?DIRS4.map(([dx,dz])=>neighbor(x+dx,y,z+dz)):[0,0,0,0];
    const conn=nb.map(v=>v>0),roundNb=nb.map(v=>v===2);
    const diag=neighbor?DIRS4.map((_,q)=>{const u0=DIRS4[q],u1=DIRS4[(q+1)&3];return neighbor(x+u0[0]+u1[0],y,z+u0[1]+u1[1])>0;}):[false,false,false,false];
    for(const s of trunkProfile(conn,roundNb,diag,fino)){
      if(s.wall){
        for(const [pt,n,dy,u] of [[s.a,s.na,0,s.ua],[s.a,s.na,1,s.ua],[s.b,s.nb,1,s.ub],[s.b,s.nb,0,s.ub]]){
          emit([cx+pt[0],y+dy,cz+pt[1]],n,u,c,side,0);
        }
      }
      for(const dir of c.caps){
        const yy=y+(dir===2?1:0),n=NORMALS[dir],rim=[[cx+s.a[0],yy,cz+s.a[1]],[cx+s.b[0],yy,cz+s.b[1]]];
        if(dir===2)rim.reverse();
        for(const v of [[cx,yy,cz],...rim,[cx,yy,cz]])emit(v,n,0,c,top,dir);
      }
    }
  }
  if(cacti.size){
    const ck=(x,y,z)=>x+','+y+','+z;
    const bright=(a,b)=>Math.max(a&15,b&15)|(Math.max(a>>4,b>>4)<<4);
    for(const base of cacti.values()){
      const [x,y0,z]=base.p;
      if(cacti.has(ck(x,y0-1,z)))continue;
      let yTop=y0,light=base.light;
      while(cacti.has(ck(x,yTop+1,z))){yTop++;light=bright(light,cacti.get(ck(x,yTop,z)).light);}
      emitCactus(emit,{light,cl:base.cl},x,z,y0,yTop,cactusSide,cactusTop);
    }
  }
  const quads=p.length/16;for(let q=0;q<quads;q++){const b=q*4;index.push(b,b+1,b+2,b,b+2,b+3);}
  return {pos:new Float32Array(p),dat:new Uint8Array(d),round:new Float32Array(round),index:new Uint32Array(index),quads,cells:cells.size+cacti.size};
}
function trunkShader(source){
  const marker='vec4 wp = modelMatrix * vec4(p, 1.0);';if(!source.includes(marker)||!source.includes('in vec4 aDat;'))return null;
  return source.replace('in vec4 aDat;','in vec4 aDat;\nin vec4 aRound;').replace(marker,`if (dot(aRound.xyz,aRound.xyz) > .5) { n=aRound.xyz; if(abs(n.y)<.86)uv=vec2(aRound.w,p.y); }\n  ${marker}`);
}

export function installFoliage(world,context={}) {
  const clones=new Map(),versions=new Map(),queue=[...world.chunks.values()],previous=world.listeners.models;
  const stats={chunks:0,cells:0,trunks:0,removedFaces:0,maxBuildMs:0,unsupported:0};
  function material(original,trunk=false) {
    if(!original)return null;
    if(clones.has(original))return clones.get(original);
    const shader=(trunk?trunkShader:crownShader)(original.vertexShader||'');if(!shader)return null;
    const copy=original.clone();copy.uniforms=original.uniforms;copy.vertexShader=shader;copy.name=original.name+'-ramos';
    copy.fragmentShader=copy.fragmentShader.replace('vec3 N = vN;','vec3 N = normalize(vN);');copy.defines=original.defines;
    clones.set(original,copy);versions.set(original,original.version);return copy;
  }
  function applyTrunks(chunk){
    const mesh=chunk.meshes?.[0],g=mesh?.geometry;if(!g||g.userData.roundTrunks)return;
    const m=material(mesh.material,true),depth=mesh.customDepthMaterial?material(mesh.customDepthMaterial,true):null;if(!m||(mesh.customDepthMaterial&&!depth))return;
    const p=g.attributes.aPos,d=g.attributes.aDat;if(!p||!d)return;
    const ox=chunk.cx*16,oz=chunk.cz*16;
    const neighbor=(x,y,z)=>{
      const wx=x+ox,wz=z+oz,b=world.getBlock(wx,y,wz);
      if(b<=0||!OPAQUE[b]||context.game?.trees?.ownsWood(wx,y,wz)||world.getShape(wx,y,wz)!==CUBE)return 0;
      return isTreeWood(b)&&!isTroncoQuadrado(world.getMini(wx,y,wz))?2:1;
    };
    const count=Math.min(p.count,Number.isFinite(g.drawRange.count)?g.drawRange.count/6*4:p.count),out=trunkBuffers(
      p.array,d.array,count,
      (x,y,z)=>context.game?.trees?.ownsWood(x+ox,y,z+oz),
      (x,y,z)=>isTroncoQuadrado(world.getMini(x+ox,y,z+oz)),
      neighbor,
      !!context.quality?.real&&!context.quality.real.leve,   // tronco de 16 lados só no realismo inteiro (PC)
    );if(!out)return;
    const next=new THREE.BufferGeometry();next.setAttribute('aPos',new THREE.BufferAttribute(out.pos,4));next.setAttribute('aDat',new THREE.BufferAttribute(out.dat,4));next.setAttribute('aRound',new THREE.BufferAttribute(out.round,4));next.setIndex(new THREE.BufferAttribute(out.index,1));next.boundingSphere=g.boundingSphere?.clone();next.userData.roundTrunks=true;
    mesh.geometry=next;mesh.material=m;if(depth)mesh.customDepthMaterial=depth;if(g.index?.count===16384*6)g.index=null;g.dispose();
    const delta=out.quads-count/4;chunk.quads+=delta;world.stats.quads+=delta;stats.trunks+=out.cells;
  }
  function applyCanopy(chunk) {
    applyTrunks(chunk);
    const mesh=chunk.meshes?.[1],g=mesh?.geometry;
    if(!g||g.userData.organicCanopy)return;
    const m=material(mesh.material),depth=mesh.customDepthMaterial?material(mesh.customDepthMaterial):null;
    if(!m||(mesh.customDepthMaterial&&!depth)){stats.unsupported++;return;}
    const p=g.attributes.aPos,d=g.attributes.aDat;if(!p||!d)return;
    const start=performance.now(),count=Math.min(p.count,Number.isFinite(g.drawRange.count)?g.drawRange.count/6*4:p.count);
    const out=foliageBuffers(p.array,d.array,count,mesh.position.x,mesh.position.z,context.quality?.name==='baixa'?3:6);if(!out)return;
    const next=new THREE.BufferGeometry();
    next.setAttribute('aPos',new THREE.BufferAttribute(out.pos,4));next.setAttribute('aDat',new THREE.BufferAttribute(out.dat,4));
    next.setAttribute('aCrown',new THREE.BufferAttribute(out.crown,3));next.setIndex(new THREE.BufferAttribute(out.index,1));
    next.boundingSphere=g.boundingSphere?.clone();if(next.boundingSphere)next.boundingSphere.radius+=.6;
    next.userData.organicCanopy=true;mesh.geometry=next;mesh.material=m;if(depth)mesh.customDepthMaterial=depth;
    // O índice original pode pertencer a todos os chunks; nunca descartá-lo aqui.
    if(g.index?.count===16384*6)g.index=null; // SHARED_QUADS do contrato de world.js
    g.dispose();
    const delta=out.quads-count/4;chunk.quads+=delta;world.stats.quads+=delta;
    stats.chunks++;stats.cells+=out.cells;stats.removedFaces+=out.removed;stats.maxBuildMs=Math.max(stats.maxBuildMs,performance.now()-start);
  }
  function apply(chunk) {
    const refresh=chunk.meshes?.[1]?.userData.lavraGlassRefresh;
    return refresh?refresh(()=>applyCanopy(chunk)):applyCanopy(chunk);
  }
  const onModels=(chunk,models)=>{previous?.(chunk,models);apply(chunk);};world.listeners.models=onModels;
  return {stats,update(){for(const [source,copy] of clones)if(versions.get(source)!==source.version){copy.defines=source.defines;copy.needsUpdate=true;versions.set(source,source.version);}for(let i=0;i<2&&queue.length;i++){const c=queue.shift();if(world.chunks.get(c.key)===c)apply(c);}},
    dispose(){if(world.listeners.models===onModels)world.listeners.models=previous;for(const m of clones.values())m.dispose();clones.clear();queue.length=0;}};
}
