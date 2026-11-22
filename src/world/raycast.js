// LAVRA — raio através dos voxels (Amanatides & Woo). Sem alocação por chamada.

import { CUBE, readerShape, shapeRay } from '../../shared/surfaces.js';
const DIRS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

// hit(id, x, y, z) decide se o bloco para o raio. Resultado em `out`:
// { hit, x, y, z, nx, ny, nz, t, id }  — (nx,ny,nz) é a face atingida.
export function raycastVoxels(getBlock, ox, oy, oz, dx, dy, dz, maxDist, hit, out) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
  let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  out.hit = false;
  for (let i = 0; i < 512; i++) {
    const id = getBlock(x, y, z);
    if (id === -1) return out;            // chunk não carregado: o raio morre aqui
    if (id !== 0 && hit(id, x, y, z)) {
      const shape=readerShape(getBlock,x,y,z);
      const surface=shape===CUBE?null:shapeRay(shape,ox-x,oy-y,oz-z,dx,dy,dz,Math.min(maxDist,tmx,tmy,tmz));
      if(shape===CUBE||surface){
      if(surface){t=surface.t;[nx,ny,nz]=DIRS[surface.face];}
      out.snx=surface?surface.n[0]:nx;out.sny=surface?surface.n[1]:ny;out.snz=surface?surface.n[2]:nz;
      out.fx=ox+dx*t-x;out.fy=oy+dy*t-y;out.fz=oz+dz*t-z;
      out.hit = true; out.x = x; out.y = y; out.z = z; out.nx = nx; out.ny = ny; out.nz = nz; out.t = t; out.id = id;
      return out;
      }
    }
    if (tmx < tmy && tmx < tmz) { t = tmx; if (t > maxDist) return out; x += sx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { t = tmy; if (t > maxDist) return out; y += sy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { t = tmz; if (t > maxDist) return out; z += sz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return out;
}
