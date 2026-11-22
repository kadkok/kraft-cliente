// Receitas de árvore, sem dependência de renderização. Semente e perfis limitados.
import { B } from './blocks.js';
import { hash3, rand3 } from './noise.js';
export const TREE_CELL=5, TREE_REACH=4;
export const treeKey=t=>t.x+','+t.z;
export const woodId=t=>t.kind===1?B.PINE_LOG:B.LOG;
export const rootId=t=>t.kind===1?B.PINE_ROOT:B.ROOT;
export const leafId=t=>t.kind===1?B.PINE_LEAVES:B.LEAVES;
export const isTreeWood=id=>id===B.LOG||id===B.PINE_LOG||id===B.ROOT||id===B.PINE_ROOT;
export const TREE_STYLES=['aberta','ascendente','irregular'];
export const DEFAULT_TREE_STYLES={0:'irregular',1:'ascendente',2:'aberta',4:'aberta'};
export function cleanTreeStyles(input){const out={...DEFAULT_TREE_STYLES};for(const k in out)if(TREE_STYLES.includes(input?.[k]))out[k]=input[k];return out;}
const rounded=v=>Math.round(v*10000)/10000;
const VECTORS=[[1,0],[.70710678,.70710678],[0,1],[-.70710678,.70710678],[-1,0],[-.70710678,-.70710678],[0,-1],[.70710678,-.70710678]];

// IDs e parentes não dependem do perfil: uma decisão Jev nunca muda o significado
// de um corte salvo. Coordenadas locais, origem no centro da base da raiz.
export function treeGraph(t,seed,style=DEFAULT_TREE_STYLES[t.kind]){
  const out=[],r=(i)=>hash3(t.x,i,t.z,seed^0x715ab913)/4294967296;
  const add=(parent,a,b,r0,r1,trunk=false)=>{const s={id:out.length,parent,a:a.map(rounded),b:b.map(rounded),r0:rounded(r0),r1:rounded(r1),trunk};out.push(s);return s;};
  for(let i=0;i<t.th;i++)add(i-1,[0,i,0],[0,i+1,0],.48*(1-.35*i/t.th),.48*(1-.35*(i+1)/t.th),true);
  const count=t.kind===1?10:t.kind===4?8:6;
  for(let j=0;j<count;j++){
    const level=t.kind===4?t.th-1:Math.min(t.th-1,Math.max(2,Math.floor(t.th*((t.kind===1?.38:.58)+(t.kind===1?.49:.30)*j/count))));
    const dir=(j*3+Math.floor(r(0)*8))&7,base=VECTORS[dir],length=t.rad*(.45+r(j+1)*.23)*(t.kind===1?1-.55*j/count:1);
    let ux=base[0]+(r(j+40)-.5)*.4,uz=base[1]+(r(j+80)-.5)*.4;const n=Math.sqrt(ux*ux+uz*uz);ux/=n;uz/=n;
    const lift=t.kind===4?-.15:style==='ascendente'?.65:style==='aberta'?.20:.2+r(j+120)*.65;
    const a=[0,level+.7,0],b=[ux*length,Math.min(t.th+.7,a[1]+length*lift),uz*length],radius=(t.kind===4?.13:.19)*(1-.30*j/count);
    const branch=add(level,a,b,radius,radius*.43);
    branch.leafAnchor=[b[0],Math.min(t.th+.7,a[1]+length*.45),b[2]];
    if(t.kind!==4)for(const side of [-1,1]){
      const span=length*.42,ex=b[0]+ux*span-uz*side*span*.65,ez=b[2]+uz*span+ux*side*span*.65;
      const twig=add(branch.id,b,[ex,Math.min(t.th+1.3,b[1]+span*(.3+r(j+160+side))),ez],radius*.44,.025);
      twig.leafAnchor=[ex,Math.min(t.th+1.3,branch.leafAnchor[1]+span*(.3+r(j+160+side))),ez];
    }
  }
  return out;
}

export function treeAtBlock(gen,x,y,z){
  if(!gen?.treeAt)return null;
  const t=gen.treeAt(Math.floor(x/TREE_CELL),Math.floor(z/TREE_CELL));
  return t&&t.kind!==3&&t.x===x&&t.z===z&&y>=t.y+1&&y<t.y+1+t.th?t:null;
}

export function treeVoxelMap(t,seed){
  const map=new Map();plantTree(t,seed,(x,y,z,id,force)=>{const key=x+','+y+','+z;if(force||!map.has(key))map.set(key,[x,y,z,id]);});return map;
}

// A primeira copa ocupa o ar; troncos posteriores substituem folhas. Mesma ordem
// do gerador. Só voxels realmente existentes e nunca editados podem se desprender.
export function ownedTreeCells(gen,t,get,edited=()=>false){
  const owner=new Map(),key=treeKey(t),near=gen.treesNear(t.x,t.z,TREE_REACH*2);
  near.sort((a,b)=>Math.floor(a.z/TREE_CELL)-Math.floor(b.z/TREE_CELL)||Math.floor(a.x/TREE_CELL)-Math.floor(b.x/TREE_CELL));
  for(const tree of near)plantTree(tree,gen.seed,(x,y,z,id,force)=>{
    const k=x+','+y+','+z,old=owner.get(k);
    if(!old||force&&!isTreeWood(old.cell[3]))owner.set(k,{key:treeKey(tree),cell:[x,y,z,id]});
  });
  const out=[];
  for(const v of owner.values())if(v.key===key){const [x,y,z,id]=v.cell;if(get(x,y,z)===id&&!edited(x,y,z))out.push(v.cell);}
  return out;
}

export function leafBranch(t,graph,x,y,z){
  const p=[x-t.x,y-t.y-.5,z-t.z];let best=Infinity,id=t.th-1;
  for(const s of graph){if(s.trunk)continue;const anchor=s.leafAnchor||s.b,d=(p[0]-anchor[0])**2+(p[1]-anchor[1])**2+(p[2]-anchor[2])**2;if(d<best){best=d;id=s.id;}}
  return id;
}

export function treeComponents(graph,ids){
  const pending=new Set(ids),adj=new Map();
  for(const id of pending){adj.set(id,[]);}
  for(const id of pending){const p=graph[id].parent;if(pending.has(p)){adj.get(id).push(p);adj.get(p).push(id);}}
  const result=[];
  while(pending.size){const todo=[pending.values().next().value],part=[];pending.delete(todo[0]);
    for(let i=0;i<todo.length;i++){const id=todo[i];part.push(id);for(const n of adj.get(id))if(pending.delete(n))todo.push(n);}result.push(part);
  }
  return result;
}

export function plantTree(t,seed,put){
 const S_TREE=seed^0x51ed270b;
      const bx = t.x, by = t.y + 1, bz = t.z, th = t.th;
      // a base precisa ser solo de verdade (o tronco pode estar em outro chunk; lá vale a mesma conta)
      if (t.kind === 5) return;   // coqueiro do arquipélago: desenhado por modelo (render/coqueiros.js)
      if (t.kind === 3) {
        for (let i = 0; i < th; i++) put(bx, by + i, bz, B.CACTUS, true);
        return;
      }
      if (t.kind === 0) {
        const cy = by + th - 1, rad = t.rad, rv = rad * 0.82;
        const ri = Math.ceil(rad);
        for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
          const d = (dx * dx + dz * dz) / (rad * rad) + (dy * dy) / (rv * rv);
          if (d > 1) continue;
          if (d > 0.62 && rand3(bx + dx, cy + dy, bz + dz, S_TREE) < 0.4) continue;
          if (dy < -1 && dx * dx + dz * dz < 2) continue;
          put(bx + dx, cy + dy + 1, bz + dz, B.LEAVES, false);
        }
        for (let i = 0; i < th; i++) put(bx, by + i, bz, i===0?B.ROOT:B.LOG, true);
      } else if (t.kind === 1) {
        const start = by + Math.max(2, Math.floor(th * 0.3));
        const topY = by + th;
        for (let y = start; y <= topY + 1; y++) {
          const f = (topY + 1 - y) / (topY + 1 - start);
          let rr = t.rad * f + 0.4;
          if (((y - start) & 1) === 1) rr *= 0.62;
          const ri = Math.ceil(rr);
          for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
            if (dx * dx + dz * dz > rr * rr) continue;
            put(bx + dx, y, bz + dz, B.PINE_LEAVES, false);
          }
        }
        for (let i = 0; i < th; i++) put(bx, by + i, bz, i===0?B.PINE_ROOT:B.PINE_LOG, true);
      } else if (t.kind === 2) {
        const cy = by + th, rad = t.rad, ri = Math.ceil(rad);
        for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > rad * rad) continue;
          if (d2 > rad * rad * 0.6 && rand3(bx + dx, cy, bz + dz, S_TREE) < 0.35) continue;
          put(bx + dx, cy, bz + dz, B.LEAVES, false);
          if (d2 < rad * rad * 0.4) put(bx + dx, cy + 1, bz + dz, B.LEAVES, false);
        }
        for (let i = 0; i < th; i++) put(bx, by + i, bz, i===0?B.ROOT:B.LOG, true);
      } else {
        const cy = by + th;
        for (let i = 0; i < th; i++) put(bx, by + i, bz, i===0?B.ROOT:B.LOG, true);
        put(bx, cy, bz, B.LEAVES, false);
        for (let k = 1; k <= 3; k++) {
          const dy = k === 3 ? -1 : 0;
          put(bx + k, cy + dy, bz, B.LEAVES, false); put(bx - k, cy + dy, bz, B.LEAVES, false);
          put(bx, cy + dy, bz + k, B.LEAVES, false); put(bx, cy + dy, bz - k, B.LEAVES, false);
          if (k <= 2) {
            const d2y = k === 2 ? -1 : 0;
            put(bx + k, cy + d2y, bz + k, B.LEAVES, false); put(bx - k, cy + d2y, bz - k, B.LEAVES, false);
            put(bx + k, cy + d2y, bz - k, B.LEAVES, false); put(bx - k, cy + d2y, bz + k, B.LEAVES, false);
          }
        }
      }
}
