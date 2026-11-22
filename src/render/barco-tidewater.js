// LAVRA — Barco 3D Tidewater (Downeast Lobster Boat ~8.2 m) para Three.js r187 WebGL2.
//
// MIT License — Adaptado de dgreenheck/tidewater (Copyright (c) 2026 DRG Software Solutions LLC):
//   - src/world/BoatModel.js
//   - src/world/boat/HullLines.js
//   - src/world/boat/HullBuilder.js
//   - src/world/boat/Wheelhouse.js
//   - src/world/boat/DeckGear.js
//   - src/world/boat/Running.js
//   - src/world/boat/BoatMaterials.js
//   - src/world/boat/GeoKit.js
//   - src/player/BoatSpray.js
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
//
// Convenção do frame local do barco:
//   +Z = proa (bow), +Y = cima (up), +X = bombordo (port).
//   y = 0 é a linha d'água de projeto; z = 0 é o meio da linha d'água; x = 0 é a linha de centro.

import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import { alturaOnda } from '../../shared/ondas.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

export const RHO_SEAWATER = 1025;
const GRAVITY = 9.81;

const _matV = new THREE.Vector3();
const _matQ = new THREE.Quaternion();
const _matE = new THREE.Euler();
const _matS = new THREE.Vector3();
const _tmpCol = new THREE.Color();

// ============================================================================
// 1. GeoKit — helpers geométricos e mesclagem de BufferGeometry para r187
// ============================================================================

const KEEP_ATTRS = new Set(['position', 'normal', 'uv', 'color', 'aux']);

function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  _matE.set(rx, ry, rz, order);
  _matQ.setFromEuler(_matE);
  return new THREE.Matrix4().compose(_matV.set(x, y, z), _matQ, _matS.set(sx, sy, sz));
}

function alignY(pos, dir, roll = 0) {
  const d = dir.clone();
  if (d.lengthSq() < 1e-12) return new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  d.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), roll));
  return new THREE.Matrix4().compose(pos, q, V(1, 1, 1));
}

function linearColor(c) {
  return c instanceof THREE.Color ? c : _tmpCol.set(c).clone();
}

function sanitizeGeometry(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name];
    const arr = attr.array;
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) arr[i] = 0;
    }
  }
  return geo;
}

function mergeBufferGeometries(list, disposeSources = true) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return sanitizeGeometry(list[0]);

  const attrNames = Object.keys(list[0].attributes);
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of list) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const itemSize = list[0].attributes[name].itemSize;
    const out = new Float32Array(totalVerts * itemSize);
    let offset = 0;
    for (const g of list) {
      const a = g.attributes[name];
      if (!a) throw new Error(`mergeBufferGeometries: atributo ausente "${name}"`);
      const arr = a.array;
      for (let i = 0; i < arr.length; i++) {
        out[offset + i] = Number.isFinite(arr[i]) ? arr[i] : 0;
      }
      offset += a.count * itemSize;
    }
    merged.setAttribute(name, new THREE.Float32BufferAttribute(out, itemSize));
  }

  const IndexArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
  const idx = new IndexArray(totalIndices);
  let idxOffset = 0;
  let vertOffset = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) idx[idxOffset + i] = src[i] + vertOffset;
      idxOffset += src.length;
    } else {
      for (let i = 0; i < count; i++) idx[idxOffset + i] = vertOffset + i;
      idxOffset += count;
    }
    vertOffset += count;
  }
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  if (disposeSources) {
    for (const g of list) g.dispose();
  }
  return merged;
}

function prepare(geo, { color = 0xffffff, rough = 0.5, metal = 0, pattern = 0, anim = 0, matrix = null } = {}) {
  for (const name of Object.keys(geo.attributes)) {
    if (!KEEP_ATTRS.has(name)) geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  geo.clearGroups();

  const n = geo.attributes.position.count;
  if (!geo.index) {
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(idx);
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));

  if (!geo.attributes.color) {
    const c = linearColor(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }

  if (!geo.attributes.aux) {
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      arr[i * 4] = rough;
      arr[i * 4 + 1] = metal;
      arr[i * 4 + 2] = pattern;
      arr[i * 4 + 3] = anim;
    }
    geo.setAttribute('aux', new THREE.Float32BufferAttribute(arr, 4));
  }

  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (!(a.array instanceof Float32Array) || a.isInterleavedBufferAttribute) {
      const len = a.count * a.itemSize;
      const arr = new Float32Array(len);
      for (let i = 0; i < a.count; i++) {
        arr[i * a.itemSize] = a.getX(i);
        if (a.itemSize > 1) arr[i * a.itemSize + 1] = a.getY(i);
        if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(i);
        if (a.itemSize > 3) arr[i * a.itemSize + 3] = a.getW(i);
      }
      geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, a.itemSize));
    }
  }

  if (matrix) geo.applyMatrix4(matrix);
  return sanitizeGeometry(geo);
}

class GeoKit {
  constructor() {
    this.buckets = new Map();
  }
  add(bucket, geometry, opts) {
    const g = prepare(geometry, opts);
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, []);
    this.buckets.get(bucket).push(g);
    return g;
  }
  merged(bucket) {
    const list = this.buckets.get(bucket);
    if (!list || list.length === 0) return null;
    const g = mergeBufferGeometries(list, true);
    if (!g) throw new Error('BarcoTidewater: falha ao mesclar bucket ' + bucket);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function mergePrepared(list) {
  const g = mergeBufferGeometries(list, true);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

const _rbTempN = new THREE.Vector3();
function _rbGetUv(faceDirVector, normal, uvAxis, projectionAxis, radius, sideLength) {
  const totArcLength = 2 * Math.PI * radius / 4;
  const centerLength = Math.max(sideLength - 2 * radius, 0);
  const halfArc = Math.PI / 4;
  _rbTempN.copy(normal);
  _rbTempN[projectionAxis] = 0;
  if (_rbTempN.lengthSq() > 1e-12) _rbTempN.normalize();
  const arcUvRatio = 0.5 * totArcLength / Math.max(1e-6, totArcLength + centerLength);
  const arcAngleRatio = 1.0 - (_rbTempN.angleTo(faceDirVector) / halfArc);
  if (Math.sign(_rbTempN[uvAxis]) === 1) return arcAngleRatio * arcUvRatio;
  const lenUv = centerLength / Math.max(1e-6, totArcLength + centerLength);
  return lenUv + arcUvRatio + arcUvRatio * (1.0 - arcAngleRatio);
}

function roundedBox(w, h, d, radius = 0.02, segments = 2) {
  const r = Math.max(1e-4, Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const totalSegments = Math.max(1, segments * 2 + 1);
  const base = new THREE.BoxGeometry(1, 1, 1, totalSegments, totalSegments, totalSegments);
  const g = base.toNonIndexed();
  base.dispose();

  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const halfBox = new THREE.Vector3(w, h, d).divideScalar(2).subScalar(r);
  const positions = g.attributes.position.array;
  const normals = g.attributes.normal.array;
  const uvs = g.attributes.uv.array;
  const faceTris = positions.length / 6;
  const faceDirVector = new THREE.Vector3();
  const halfSegmentSize = 0.5 / totalSegments;

  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    position.fromArray(positions, i);
    normal.copy(position);
    normal.x -= Math.sign(normal.x) * halfSegmentSize;
    normal.y -= Math.sign(normal.y) * halfSegmentSize;
    normal.z -= Math.sign(normal.z) * halfSegmentSize;
    if (normal.lengthSq() > 1e-12) normal.normalize();
    else normal.set(Math.sign(position.x) || 1, 0, 0).normalize();

    positions[i] = halfBox.x * Math.sign(position.x) + normal.x * r;
    positions[i + 1] = halfBox.y * Math.sign(position.y) + normal.y * r;
    positions[i + 2] = halfBox.z * Math.sign(position.z) + normal.z * r;
    normals[i] = normal.x;
    normals[i + 1] = normal.y;
    normals[i + 2] = normal.z;

    const side = Math.floor(i / faceTris);
    let u = 0;
    let v = 0;
    if (side === 0) {
      faceDirVector.set(1, 0, 0);
      u = _rbGetUv(faceDirVector, normal, 'z', 'y', r, d);
      v = 1.0 - _rbGetUv(faceDirVector, normal, 'y', 'z', r, h);
    } else if (side === 1) {
      faceDirVector.set(-1, 0, 0);
      u = 1.0 - _rbGetUv(faceDirVector, normal, 'z', 'y', r, d);
      v = 1.0 - _rbGetUv(faceDirVector, normal, 'y', 'z', r, h);
    } else if (side === 2) {
      faceDirVector.set(0, 1, 0);
      u = 1.0 - _rbGetUv(faceDirVector, normal, 'x', 'z', r, w);
      v = _rbGetUv(faceDirVector, normal, 'z', 'x', r, d);
    } else if (side === 3) {
      faceDirVector.set(0, -1, 0);
      u = 1.0 - _rbGetUv(faceDirVector, normal, 'x', 'z', r, w);
      v = 1.0 - _rbGetUv(faceDirVector, normal, 'z', 'x', r, d);
    } else if (side === 4) {
      faceDirVector.set(0, 0, 1);
      u = 1.0 - _rbGetUv(faceDirVector, normal, 'x', 'y', r, w);
      v = 1.0 - _rbGetUv(faceDirVector, normal, 'y', 'x', r, h);
    } else {
      faceDirVector.set(0, 0, -1);
      u = _rbGetUv(faceDirVector, normal, 'x', 'y', r, w);
      v = 1.0 - _rbGetUv(faceDirVector, normal, 'y', 'x', r, h);
    }
    uvs[j] = u * Math.max(w, d);
    uvs[j + 1] = v * h;
  }
  return g;
}

function cylinder(rTop, rBottom, h, radial = 12, heightSegs = 1, open = false, thetaStart = 0, thetaLength = Math.PI * 2) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, heightSegs, open, thetaStart, thetaLength);
  const uv = g.attributes.uv;
  const circ = Math.max(rTop, rBottom) * thetaLength;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

function rod(a, b, radius, radial = 8, rEnd = radius) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(1e-5, dir.length());
  const g = cylinder(rEnd, radius, len, radial, 1, false);
  g.applyMatrix4(alignY(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), dir));
  return g;
}

function sphere(r, w = 12, h = 8, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
  return new THREE.SphereGeometry(r, w, h, phiStart, phiLength, thetaStart, thetaLength);
}

function torus(R, r, radial = 8, tubular = 24, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular, arc);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * R * arc, uv.getY(i) * 2 * Math.PI * r);
  return g;
}

function lathe(profile, segments = 16) {
  const pts = profile.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1]));
  return new THREE.LatheGeometry(pts, segments);
}

function tube(points, radius, tubular = 32, radial = 6, closed = false, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', tension);
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
  const len = curve.getLength();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i));
  return g;
}

function orientTowards(g, dir) {
  const p = g.attributes.position;
  const idx = g.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const acc = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    acc.add(n);
  }
  if (acc.dot(dir) < 0) {
    const arr = Array.from(idx);
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    g.setIndex(arr);
  }
  return g;
}

function planarUV(g, normal) {
  const n = normal.clone();
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
  else n.normalize();
  const t = Math.abs(n.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0).cross(n).normalize();
  const b = V().crossVectors(n, t);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    uv[i * 2] = v.dot(t);
    uv[i * 2 + 1] = v.dot(b);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function gridSurface(rows, { flip = false, uvFn = null, closeJ = false } = {}) {
  const ni = rows.length;
  const nj = rows[0].length;
  const pos = new Float32Array(ni * nj * 3);
  const uvs = new Float32Array(ni * nj * 2);
  let u = 0;
  for (let i = 0; i < ni; i++) {
    if (i > 0) u += rows[i][0].distanceTo(rows[i - 1][0]);
    let v = 0;
    for (let j = 0; j < nj; j++) {
      const p = rows[i][j];
      if (j > 0) v += p.distanceTo(rows[i][j - 1]);
      const k = i * nj + j;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      if (uvFn) {
        const t = uvFn(p, i, j, u, v);
        uvs[k * 2] = t[0];
        uvs[k * 2 + 1] = t[1];
      } else {
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    }
  }

  const idx = [];
  const jmax = closeJ ? nj : nj - 1;
  for (let i = 0; i < ni - 1; i++) {
    for (let j = 0; j < jmax; j++) {
      const j1 = (j + 1) % nj;
      const a = i * nj + j;
      const b = (i + 1) * nj + j;
      const c = (i + 1) * nj + j1;
      const d = i * nj + j1;
      if (flip) idx.push(a, b, d, b, c, d);
      else idx.push(a, d, b, d, c, b);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fanCap(loop, normalHint) {
  const c = V();
  for (const p of loop) c.add(p);
  c.divideScalar(loop.length || 1);
  const pos = [c.x, c.y, c.z];
  for (const p of loop) pos.push(p.x, p.y, p.z);
  const idx = [];
  for (let i = 0; i < loop.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % loop.length));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientTowards(g, normalHint);
  g.computeVertexNormals();
  planarUV(g, normalHint);
  return g;
}

function slab(outline, holes, map, { edges = true, back = true, front = true } = {}) {
  const contour = outline.map((p) => new THREE.Vector2(p[0], p[1]));
  const holeVs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const h of holeVs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, holeVs);
  const all = contour.concat(...holeVs);

  const parts = [];
  const faceGeo = (side) => {
    const pos = [];
    const uvs = [];
    for (const p of all) {
      const q = map(p.x, p.y, side);
      pos.push(q.x, q.y, q.z);
      uvs.push(p.x, p.y);
    }
    const idx = [];
    for (const t of tris) {
      const a = all[t[0]];
      const b = all[t[1]];
      const c = all[t[2]];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) > 1e-10) {
        idx.push(t[0], t[1], t[2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const c = contour[0];
    const dir = map(c.x, c.y, side).sub(map(c.x, c.y, 1 - side));
    orientTowards(g, dir);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    if (dir.lengthSq() > 1e-12) dir.normalize();
    else dir.set(0, 1, 0);
    for (let i = 0; i < nrm.count; i++) {
      if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 0.5) {
        nrm.setXYZ(i, dir.x, dir.y, dir.z);
      }
    }
    return g;
  };

  if (front) parts.push(faceGeo(0));
  if (back) parts.push(faceGeo(1));

  if (edges) {
    const pos = [];
    const uvs = [];
    const idx = [];
    const loops = [contour, ...holeVs];
    const a0 = V();
    const a1 = V();
    const b0 = V();
    const b1 = V();
    const n = V();
    const out = V();
    const tmp = V();
    for (const loop of loops) {
      let len = 0;
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        const el = p.distanceTo(q);
        if (el < 1e-6) continue;
        a0.copy(map(p.x, p.y, 0));
        a1.copy(map(p.x, p.y, 1));
        b0.copy(map(q.x, q.y, 0));
        b1.copy(map(q.x, q.y, 1));
        const th = a0.distanceTo(a1);
        const base = pos.length / 3;
        pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
        uvs.push(len, 0, len + el, 0, len + el, th, len, th);
        len += el;
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const ox = ((q.y - p.y) / el) * 0.01;
        const oy = -((q.x - p.x) / el) * 0.01;
        out.copy(map(mx + ox, my + oy, 0)).sub(map(mx, my, 0));
        n.subVectors(b0, a0).cross(tmp.subVectors(a1, a0));
        if (n.dot(out) >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      parts.push(g);
    }
  }

  for (const part of parts) prepare(part);
  return mergeBufferGeometries(parts, true);
}

function loft(profiles, { closed = false, flip = false } = {}) {
  const rows = closed ? profiles.map((r) => [...r, r[0].clone()]) : profiles;
  const g = gridSurface(rows, { flip });
  if (closed) {
    const nj = rows[0].length;
    const nrm = g.attributes.normal;
    const a = V();
    const b = V();
    for (let i = 0; i < rows.length; i++) {
      const i0 = i * nj;
      const i1 = i * nj + nj - 1;
      a.fromBufferAttribute(nrm, i0);
      b.fromBufferAttribute(nrm, i1);
      a.add(b);
      if (a.lengthSq() > 1e-12) a.normalize();
      else a.set(0, 1, 0);
      nrm.setXYZ(i0, a.x, a.y, a.z);
      nrm.setXYZ(i1, a.x, a.y, a.z);
    }
  }
  return g;
}

function paintVertices(g, fn) {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = linearColor(fn(v, i));
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

function auxVertices(g, fn) {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 4);
  const v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = fn(v, i);
    arr[i * 4] = a[0];
    arr[i * 4 + 1] = a[1];
    arr[i * 4 + 2] = a[2];
    arr[i * 4 + 3] = a[3];
  }
  g.setAttribute('aux', new THREE.Float32BufferAttribute(arr, 4));
  return g;
}

// ============================================================================
// 2. HullLines — linhas paramétricas do casco Downeast ~8.2m e hidrostática
// ============================================================================

const SPANS = [4, 4, 3, 3, 8, 10];

function catmullRom(p0, p1, p2, p3, u, out) {
  const d01 = Math.max(1e-5, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
  const d12 = Math.max(1e-5, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
  const d23 = Math.max(1e-5, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
  const t0 = 0;
  const t1 = d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const t = t1 + (t2 - t1) * u;

  for (let c = 0; c < 2; c++) {
    const a1 = ((t1 - t) * p0[c] + (t - t0) * p1[c]) / (t1 - t0);
    const a2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1);
    const a3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
    const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
    out[c] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
  }
  return out;
}

export class HullLines {
  constructor() {
    this.zAft = -3.9;
    this.zBow = 4.3;
    this.length = this.zBow - this.zAft;
    this.deckY = 0.35;
    this.shell = 0.07;
    this.houseBack = -0.35;
    this.houseFront = 1.45;

    const k = 0.2;
    const R = 0.45;
    const yF = this.keelY(1);
    const yTip = this.sheerY(1);
    const zW = this.zBow - k * yTip;
    const q = Math.sqrt(1 + k * k);
    const yc = yF + R;
    this.stem = { k, R, yF, zW, yc, zc: zW + k * yc - R * q, yT: yc - (R * k) / q };

    this._setback = new Map();
    this._sectionCache = new Map();
    this.analyze();
  }

  sheerZ(t) {
    return this.zAft + this.length * t;
  }
  tAtSheerZ(z) {
    return clamp01((z - this.zAft) / this.length);
  }
  sheerY(t) {
    const a = Math.max(0, 1 - t / 0.2);
    return 0.98 + 0.62 * Math.pow(t, 2.2) + 0.04 * a * a;
  }
  sheerX(t) {
    if (t <= 0.42) {
      const a = 1 - t / 0.42;
      return 1.45 - 0.17 * a * a;
    }
    const s = (t - 0.42) / 0.58;
    return 1.45 * (1 - Math.pow(s, 2.6));
  }
  keelY(t) {
    if (t <= 0.45) return -0.23 - 0.22 * Math.sin((Math.PI * 0.5 * t) / 0.45);
    return -0.45 + 0.33 * Math.pow(sstep(0.45, 1, t), 1.6);
  }
  chineX(t) {
    if (t <= 0.42) {
      const a = 1 - t / 0.42;
      return 1.26 - 0.1 * a * a;
    }
    const s = (t - 0.42) / 0.58;
    return 1.26 * Math.pow(Math.max(0, 1 - Math.pow(s, 1.7)), 1.15);
  }
  chineY(t) {
    return lerp(0.01, -0.045, sstep(0, 0.45, t)) + 0.33 * Math.pow(sstep(0.5, 1, t), 1.3);
  }
  bilgeTangent(t) {
    return lerp(0.2, 0.24, sstep(0, 0.4, t)) * (1 - 0.55 * sstep(0.6, 1, t));
  }
  bottomConvexity(t) {
    return lerp(0.025, 0.012, sstep(0.55, 0.95, t));
  }
  flare(t) {
    return lerp(-0.012, 0.075, sstep(0.3, 0.85, t)) * (1 - 0.3 * sstep(0.9, 1, t));
  }
  bowBlend(t) {
    return t > 0.55 ? ((t - 0.55) / 0.45) ** 2 : 0;
  }
  stemZ(y) {
    const s = this.stem;
    if (y >= s.yT) return s.zW + s.k * y;
    const dy = y - s.yc;
    return s.zc + Math.sqrt(Math.max(0, s.R * s.R - dy * dy));
  }

  controlPoints(t) {
    const K = [0, this.keelY(t)];
    const C0 = [this.chineX(t), this.chineY(t)];
    const S = [this.sheerX(t), this.sheerY(t)];

    const bx = C0[0] - K[0];
    const by = C0[1] - K[1];
    const lb = Math.max(1e-6, Math.hypot(bx, by));
    const dbx = bx / lb;
    const dby = by / lb;
    const tx = S[0] - C0[0];
    const ty = S[1] - C0[1];
    const lt = Math.max(1e-6, Math.hypot(tx, ty));
    const dtx = tx / lt;
    const dty = ty / lt;

    const w = sstep(0, 0.3, C0[0]);
    const r = Math.min(this.bilgeTangent(t), 0.3 * lb, 0.3 * lt);
    const convex = this.bottomConvexity(t) * lb * w;
    const G = [K[0] + dbx * lb * 0.5 + dby * convex, K[1] + dby * lb * 0.5 - dbx * convex];
    const B1 = [C0[0] - dbx * r, C0[1] - dby * r];
    const B2 = [C0[0] + dtx * r, C0[1] + dty * r];

    const psi = Math.acos(Math.min(1, Math.max(-1, dbx * dtx + dby * dty)));
    const mx = dtx - dbx;
    const my = dty - dby;
    const ml = Math.hypot(mx, my);
    const e = ml > 1e-6 ? (r * Math.tan(psi / 4)) / ml : 0;
    const Cm = [C0[0] + mx * e, C0[1] + my * e];

    const fl = this.flare(t) * lt * w;
    const M = [C0[0] + dtx * lt * 0.5 - dty * fl, C0[1] + dty * lt * 0.5 + dtx * fl];
    return [K, G, B1, Cm, B2, M, S];
  }

  sectionPoints(t, density = 1) {
    const key = t + ':' + density;
    const cached = this._sectionCache.get(key);
    if (cached) return cached;

    const cp = this.controlPoints(t);
    const n = cp.length;
    const ext = [
      [2 * cp[0][0] - cp[1][0], 2 * cp[0][1] - cp[1][1]],
      ...cp,
      [2 * cp[n - 1][0] - cp[n - 2][0], 2 * cp[n - 1][1] - cp[n - 2][1]],
    ];

    const count = SPANS.reduce((a, b) => a + b, 0) * density + 1;
    const out = new Float64Array(count * 2);
    let k = 0;
    const p = [0, 0];
    for (let s = 0; s < SPANS.length; s++) {
      const steps = SPANS[s] * density;
      for (let i = 0; i < steps; i++) {
        catmullRom(ext[s], ext[s + 1], ext[s + 2], ext[s + 3], i / steps, p);
        out[k++] = Math.max(0, p[0]);
        out[k++] = p[1];
      }
    }
    out[k++] = cp[n - 1][0];
    out[k++] = cp[n - 1][1];

    if (this._sectionCache.size > 4096) this._sectionCache.clear();
    this._sectionCache.set(key, out);
    return out;
  }

  setback(density = 1) {
    let H = this._setback.get(density);
    if (H) return H;
    const sec = this.sectionPoints(1, density);
    const n = sec.length / 2;
    H = new Float64Array(n);
    for (let j = 0; j < n; j++) H[j] = this.zBow - this.stemZ(sec[2 * j + 1]);
    H[n - 1] = 0;
    this._setback.set(density, H);
    return H;
  }

  station(t, density = 1) {
    const sec = this.sectionPoints(t, density);
    const H = this.setback(density);
    const zs = this.sheerZ(t);
    const D = this.bowBlend(t);
    const pts = [];
    for (let j = 0; j < H.length; j++) pts.push(V(sec[2 * j], sec[2 * j + 1], zs - D * H[j]));
    return pts;
  }

  stationParams(count) {
    const density = (t) => 1 + 2.2 * sstep(0.62, 1, t) + 0.5 * (1 - sstep(0, 0.08, t));
    const N = 2000;
    const cum = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + density((i - 0.5) / N) / N;
    const total = cum[N];
    const ts = [];
    let k = 0;
    for (let i = 0; i < count; i++) {
      const target = (total * i) / (count - 1);
      while (k < N && cum[k + 1] < target) k++;
      const f = (target - cum[k]) / Math.max(1e-12, cum[k + 1] - cum[k]);
      ts.push(i === count - 1 ? 1 : (k + clamp01(f)) / N);
    }
    return ts;
  }

  halfBreadth(t, y) {
    const sec = this.sectionPoints(t, 2);
    const n = sec.length / 2;
    if (y >= sec[2 * n - 1]) return sec[2 * n - 2];
    for (let j = n - 2; j >= 0; j--) {
      const y0 = sec[2 * j + 1];
      const y1 = sec[2 * j + 3];
      if (y >= y0 && y <= y1) {
        const f = (y - y0) / Math.max(1e-9, y1 - y0);
        return lerp(sec[2 * j], sec[2 * j + 2], f);
      }
    }
    return 0;
  }

  tAt(z, y) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) * 0.5;
      if (this.zOnStation(mid, y) < z) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  zOnStation(t, y) {
    const D = this.bowBlend(t);
    if (D === 0) return this.sheerZ(t);
    const sec = this.sectionPoints(t, 2);
    const H = this.setback(2);
    const n = sec.length / 2;
    let h = 0;
    if (y <= sec[1]) h = H[0];
    else if (y >= sec[2 * n - 1]) h = 0;
    else {
      for (let j = 0; j < n - 1; j++) {
        const y0 = sec[2 * j + 1];
        const y1 = sec[2 * j + 3];
        if (y >= y0 && y <= y1) {
          h = lerp(H[j], H[j + 1], (y - y0) / Math.max(1e-9, y1 - y0));
          break;
        }
      }
    }
    return this.sheerZ(t) - D * h;
  }

  hullXAt(z, y) {
    return this.halfBreadth(this.tAt(z, y), y);
  }

  analyze() {
    const density = 3;
    const NT = 480;
    const H = this.setback(density);
    const nj = H.length;

    const wl = [];
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      const sec = this.sectionPoints(t, density);
      const zs = this.sheerZ(t);
      const D = this.bowBlend(t);
      for (let j = 0; j < nj - 1; j++) {
        const y0 = sec[2 * j + 1];
        const y1 = sec[2 * j + 3];
        if (y0 <= 0 && y1 > 0) {
          const f = -y0 / (y1 - y0);
          wl.push([zs - D * lerp(H[j], H[j + 1], f), lerp(sec[2 * j], sec[2 * j + 2], f)]);
          break;
        }
      }
    }
    wl.sort((a, b) => a[0] - b[0]);
    this.wlStart = wl[0][0];
    this.wlEnd = wl[wl.length - 1][0];

    const TN = 512;
    this._beamTable = new Float64Array(TN + 1);
    this._tableZ0 = this.wlStart;
    this._tableDz = (this.wlEnd - this.wlStart) / TN;
    let k = 0;
    for (let i = 0; i <= TN; i++) {
      const z = this.wlStart + i * this._tableDz;
      while (k < wl.length - 2 && wl[k + 1][0] < z) k++;
      const a = wl[k];
      const b = wl[k + 1];
      const f = clamp01((z - a[0]) / Math.max(1e-9, b[0] - a[0]));
      this._beamTable[i] = lerp(a[1], b[1], f);
    }

    const cell = 0.02;
    const x0 = 0;
    const z0 = this.zAft - 0.02;
    const nx = Math.ceil(1.5 / cell);
    const nz = Math.ceil((this.wlEnd + 0.05 - z0) / cell);
    const bottom = new Float32Array(nx * nz).fill(Infinity);
    const grid = [];
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      const sec = this.sectionPoints(t, density);
      const zs = this.sheerZ(t);
      const D = this.bowBlend(t);
      const row = new Float64Array(nj * 3);
      for (let j = 0; j < nj; j++) {
        row[3 * j] = sec[2 * j];
        row[3 * j + 1] = sec[2 * j + 1];
        row[3 * j + 2] = zs - D * H[j];
      }
      grid.push(row);
    }

    const tri = (a, b, c) => {
      if (Math.min(a[1], b[1], c[1]) > 0.01) return;
      const minX = Math.min(a[0], b[0], c[0]);
      const maxX = Math.max(a[0], b[0], c[0]);
      const minZ = Math.min(a[2], b[2], c[2]);
      const maxZ = Math.max(a[2], b[2], c[2]);
      const i0 = Math.max(0, Math.ceil((minX - x0) / cell - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((maxX - x0) / cell - 0.5));
      const k0 = Math.max(0, Math.ceil((minZ - z0) / cell - 0.5));
      const k1 = Math.min(nz - 1, Math.floor((maxZ - z0) / cell - 0.5));
      if (i0 > i1 || k0 > k1) return;
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) return;
      for (let kk = k0; kk <= k1; kk++) {
        const pz = z0 + (kk + 0.5) * cell;
        for (let ii = i0; ii <= i1; ii++) {
          const px = x0 + (ii + 0.5) * cell;
          const l1 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / det;
          const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
          const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
          const idx = kk * nx + ii;
          if (y < bottom[idx]) bottom[idx] = y;
        }
      }
    };

    const A = [0, 0, 0];
    const B = [0, 0, 0];
    const C = [0, 0, 0];
    const Dp = [0, 0, 0];
    const get = (row, j, out) => {
      out[0] = row[3 * j];
      out[1] = row[3 * j + 1];
      out[2] = row[3 * j + 2];
      return out;
    };
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j < nj - 1; j++) {
        get(grid[i], j, A);
        get(grid[i + 1], j, B);
        get(grid[i + 1], j + 1, C);
        get(grid[i], j + 1, Dp);
        tri(A, B, C);
        tri(A, C, Dp);
      }
    }

    this._field = { bottom, nx, nz, cell, x0, z0 };

    let area = 0;
    let volume = 0;
    let mz = 0;
    let vz = 0;
    let vy = 0;
    for (let kk = 0; kk < nz; kk++) {
      const pz = z0 + (kk + 0.5) * cell;
      for (let ii = 0; ii < nx; ii++) {
        const y = bottom[kk * nx + ii];
        if (!(y < 0)) continue;
        const dA = cell * cell * 2;
        area += dA;
        mz += dA * pz;
        volume += dA * -y;
        vz += dA * -y * pz;
        vy += dA * -y * (y * 0.5);
      }
    }

    this.waterplaneArea = area;
    this.canoeVolume = volume;
    this.centerOfFlotationZ = mz / area;
    this.centerOfBuoyancy = V(0, vy / volume, vz / volume);
  }

  halfBeamAt(z) {
    if (z < this.wlStart || z > this.wlEnd) return 0;
    const f = (z - this._tableZ0) / this._tableDz;
    const i = Math.min(this._beamTable.length - 2, Math.max(0, Math.floor(f)));
    return lerp(this._beamTable[i], this._beamTable[i + 1], clamp01(f - i));
  }

  draftAt(z) {
    const { bottom, nx, nz, cell, z0 } = this._field;
    const f = (z - z0) / cell - 0.5;
    if (f < -0.5 || f > nz - 0.5) return 0;
    const k = Math.min(nz - 2, Math.max(0, Math.floor(f)));
    const a = bottom[k * nx];
    const b = bottom[(k + 1) * nx];
    const da = a < 0 ? -a : 0;
    const db = b < 0 ? -b : 0;
    return lerp(da, db, clamp01(f - k));
  }

  bottomAt(x, z) {
    const { bottom, nx, nz, cell, x0, z0 } = this._field;
    const i = Math.floor((Math.abs(x) - x0) / cell);
    const k = Math.floor((z - z0) / cell);
    if (i < 0 || i >= nx || k < 0 || k >= nz) return Infinity;
    return bottom[k * nx + i];
  }

  buildHullSamples(slices = 8) {
    const { bottom, nx, nz, cell, x0, z0 } = this._field;
    const L = this.wlEnd - this.wlStart;
    const acc = [];
    for (let s = 0; s < slices; s++) {
      acc.push([
        { a: 0, x2: 0, z: 0, v: 0 },
        { a: 0, x2: 0, z: 0, v: 0 },
      ]);
    }
    for (let kk = 0; kk < nz; kk++) {
      const pz = z0 + (kk + 0.5) * cell;
      const s = Math.min(slices - 1, Math.max(0, Math.floor(((pz - this.wlStart) / L) * slices)));
      const hb = this.halfBeamAt(pz);
      for (let ii = 0; ii < nx; ii++) {
        const y = bottom[kk * nx + ii];
        if (!(y < 0)) continue;
        const px = x0 + (ii + 0.5) * cell;
        const strip = hb > 0 && px > hb * 0.5 ? 1 : 0;
        const dA = cell * cell;
        const c = acc[s][strip];
        c.a += dA;
        c.x2 += dA * px * px;
        c.z += dA * pz;
        c.v += dA * -y;
      }
    }

    const samples = [];
    for (let s = 0; s < slices; s++) {
      for (let strip = 0; strip < 2; strip++) {
        const c = acc[s][strip];
        if (c.a <= 0) continue;
        const x = Math.sqrt(c.x2 / c.a);
        const z = c.z / c.a;
        const y = -c.v / c.a;
        const bottomY = Math.min(0, this.bottomAt(x, z));
        samples.push({ position: V(x, y, z), x, y, z, area: c.a, depth: -y, bottomY });
        samples.push({ position: V(-x, y, z), x: -x, y, z, area: c.a, depth: -y, bottomY });
      }
    }
    return samples;
  }
}

// ============================================================================
// 3. HullBuilder — casco, quilha, forro interno, conveses, borda e listel
// ============================================================================

const PALETTE = {
  gelcoat: 0xf1eee6,
  lining: 0xe9e6dc,
  deck: 0xe2ddcf,
  antifouling: 0x7a1d15,
  stainless: 0xd0d3d6,
};

const KEEL_PROFILE = [
  [3.74, -0.093],
  [3.3, -0.2],
  [3.0, -0.265],
  [1.5, -0.5],
  [0, -0.62],
  [-1.5, -0.7],
  [-3.05, -0.77],
];

const KEEL = { zFront: 3.74, zAft: -3.05, shoeAft: -3.68, bottom: -0.77, shoeTop: -0.74 };

function keelBottomAt(z) {
  const P = KEEL_PROFILE;
  if (z >= P[0][0]) return P[0][1];
  if (z <= P[P.length - 1][0]) return P[P.length - 1][1];
  let i = 0;
  while (i < P.length - 2 && z < P[i + 1][0]) i++;
  const p0 = P[Math.max(0, i - 1)];
  const p1 = P[i];
  const p2 = P[i + 1];
  const p3 = P[Math.min(P.length - 1, i + 2)];
  const f = (p1[0] - z) / (p1[0] - p2[0]);
  const f2 = f * f;
  const f3 = f2 * f;
  return 0.5 * (
    2 * p1[1] +
    (-p0[1] + p2[1]) * f +
    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 +
    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3
  );
}

function keelVolume(L) {
  const N = 240;
  const dz = (KEEL.zFront - KEEL.zAft) / N;
  let v = 0;
  for (let i = 0; i < N; i++) {
    const z = KEEL.zAft + (i + 0.5) * dz;
    const h = Math.max(0, -L.draftAt(z) - keelBottomAt(z));
    const fwd = sstep(2.6, KEEL.zFront, z);
    v += (lerp(0.065, 0.012, fwd) + lerp(0.042, 0.008, fwd)) * h * dz;
  }
  return v + 0.075 * (KEEL.shoeTop - KEEL.bottom) * (KEEL.zAft - KEEL.shoeAft);
}

function fixUnusedNormals(g, n) {
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 0.5) nrm.setXYZ(i, n.x, n.y, n.z);
  }
}

function orientOutward(g, outwardFn, fallback) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  let dot = 0;
  const a = V();
  const b = V();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(n, i);
    const o = outwardFn(a);
    dot += o.lengthSq() > 1e-10 ? b.dot(o) : b.dot(fallback);
  }
  if (dot < 0) {
    const idx = Array.from(g.index.array);
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function foredeckY(L, t, x) {
  const xe = Math.max(1e-3, L.sheerX(t) - L.shell);
  const f = Math.min(1, Math.abs(x) / xe);
  return L.sheerY(t) + 0.06 * (1 - f * f);
}

function houseHalfWidth(L, z) {
  return L.sheerX(L.tAtSheerZ(z)) - 0.2;
}

function innerX(L, t, y) {
  return L.halfBreadth(t, y) - L.shell;
}

function buildHullVolume(L) {
  const ts = L.stationParams(28);
  const rows = ts.map((t) => L.station(t, 1).filter((_, j, a) => j % 2 === 0 || j === a.length - 1));
  const nj = rows[0].length;
  const pos = [];
  const idx = [];
  const vert = (p) => {
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const port = rows.map((r) => r.map(vert));
  const star = rows.map((r) => r.map((p) => vert(V(-p.x, p.y, p.z))));
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < nj - 1; j++) {
      const a = port[i][j];
      const b = port[i + 1][j];
      const c = port[i + 1][j + 1];
      const d = port[i][j + 1];
      idx.push(a, d, b, d, c, b);
      const a2 = star[i][j];
      const b2 = star[i + 1][j];
      const c2 = star[i + 1][j + 1];
      const d2 = star[i][j + 1];
      idx.push(a2, b2, d2, b2, c2, d2);
    }
  }
  for (let j = 0; j < nj - 1; j++) {
    idx.push(port[0][j], star[0][j], port[0][j + 1], star[0][j], star[0][j + 1], port[0][j + 1]);
  }
  const top = nj - 1;
  for (let i = 0; i < rows.length - 1; i++) {
    idx.push(port[i][top], star[i][top], port[i + 1][top], star[i][top], star[i + 1][top], port[i + 1][top]);
  }
  const same = (i, k) =>
    Math.abs(pos[3 * i] - pos[3 * k]) + Math.abs(pos[3 * i + 1] - pos[3 * k + 1]) + Math.abs(pos[3 * i + 2] - pos[3 * k + 2]) < 1e-7;
  const clean = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    if (!same(a, b) && !same(b, c) && !same(a, c)) clean.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(clean);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return sanitizeGeometry(g);
}

function woodUV(g, profiles) {
  const nj = profiles[0].length;
  const uv = g.attributes.uv;
  let u = 0;
  for (let i = 0; i < profiles.length; i++) {
    if (i > 0) u += profiles[i][3].distanceTo(profiles[i - 1][3]);
    let v = 0;
    for (let j = 0; j < nj; j++) {
      if (j > 0) v += profiles[i][j].distanceTo(profiles[i][j - 1]);
      uv.setXY(i * nj + j, u, v);
    }
  }
}

function buildShell(kit, L) {
  const ts = L.stationParams(60);
  const rows = ts.map((t) => L.station(t, 1));
  const uvFn = (p) => [p.z, p.y];
  kit.add('hull', gridSurface(rows, { uvFn }));
  const mirrored = rows.map((r) => r.map((p) => V(-p.x, p.y, p.z)));
  kit.add('hull', gridSurface(mirrored, { flip: true, uvFn }));

  const sec = rows[0];
  const pos = [];
  const idx = [];
  const uvs = [];
  for (const p of sec) {
    pos.push(p.x, p.y, p.z, -p.x, p.y, p.z);
    uvs.push(p.x, p.y, -p.x, p.y);
  }
  for (let j = 0; j < sec.length - 1; j++) {
    const a = 2 * j;
    const b = 2 * j + 1;
    const c = 2 * j + 2;
    const d = 2 * j + 3;
    if (sec[j].x > 1e-5) idx.push(a, b, c);
    idx.push(b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  orientTowards(g, V(0, 0, -1));
  g.computeVertexNormals();
  fixUnusedNormals(g, V(0, 0, -1));
  kit.add('hull', g);
}

function buildKeel(kit, L) {
  const N = 32;
  const profiles = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const z = lerp(KEEL.zAft, KEEL.zFront, Math.pow(f, 0.9));
    const yB = keelBottomAt(z);
    const canoe = -L.draftAt(z);
    const yTop = Math.max(canoe + 0.06, yB + 0.02);
    const fwd = sstep(2.6, KEEL.zFront, z);
    const wt = lerp(0.065, 0.012, fwd);
    const wb = lerp(0.042, 0.008, fwd);
    const mid = lerp(yTop, yB, 0.55);
    const half = [
      [wt, yTop],
      [lerp(wt, wb, 0.6), mid],
      [wb, yB + 0.035],
      [wb * 0.75, yB + 0.012],
      [wb * 0.35, yB + 0.002],
    ];
    const prof = [];
    for (const h of half) prof.push(V(h[0], h[1], z));
    prof.push(V(0, yB, z));
    for (let k = half.length - 1; k >= 0; k--) prof.push(V(-half[k][0], half[k][1], z));
    profiles.push(prof);
  }
  const g = loft(profiles);
  orientOutward(g, (p) => V(p.x, 0, 0), V(0, -1, 0));
  kit.add('hull', g);
  kit.add('hull', fanCap(profiles[0], V(0, 0, -1)));
  kit.add('hull', fanCap(profiles[N], V(0, 0, 1)));

  const shoeLen = KEEL.zAft - KEEL.shoeAft;
  const shoe = box(0.075, KEEL.shoeTop - KEEL.bottom, shoeLen);
  shoe.translate(0, (KEEL.shoeTop + KEEL.bottom) / 2, (KEEL.zAft + KEEL.shoeAft) / 2);
  kit.add('hull', shoe);

  kit.add('fittings', rod(V(0, KEEL.shoeTop, -3.58), V(0, KEEL.shoeTop + 0.03, -3.58), 0.03, 10), { color: 0xb0764a, rough: 0.4, metal: 1 });
  kit.add('fittings', rod(V(0, -0.53, KEEL.zAft + 0.02), V(0, -0.53, -3.27), 0.024, 10), { color: 0xc9ccd0, rough: 0.25, metal: 1 });
  kit.add('hull', rod(V(0, -0.53, KEEL.zAft + 0.06), V(0, -0.53, KEEL.zAft - 0.03), 0.05, 12, 0.04));
}

function buildLining(kit, L) {
  const tA = L.shell / L.length;
  const tF = L.tAtSheerZ(L.houseFront);
  const NS = 40;
  const NY = 7;
  const rows = [];
  for (let i = 0; i <= NS; i++) {
    const t = lerp(tA, tF, i / NS);
    const z = L.sheerZ(t);
    const yTop = L.sheerY(t);
    const row = [];
    for (let k = 0; k <= NY; k++) {
      const y = lerp(L.deckY, yTop, k / NY);
      row.push(V(innerX(L, t, y), y, z));
    }
    rows.push(row);
  }
  const uvFn = (p) => [p.z, p.y];
  const port = gridSurface(rows, { uvFn, flip: true });
  const star = gridSurface(rows.map((r) => r.map((p) => V(-p.x, p.y, p.z))), { uvFn });
  kit.add('gelcoat', port, { color: PALETTE.lining, rough: 0.4 });
  kit.add('gelcoat', star, { color: PALETTE.lining, rough: 0.4 });

  const zT = L.zAft + L.shell;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let k = 0; k <= NY; k++) {
    const y = lerp(L.deckY, L.sheerY(tA), k / NY);
    const x = innerX(L, tA, y);
    pos.push(x, y, zT, -x, y, zT);
    uvs.push(x, y, -x, y);
  }
  for (let k = 0; k < NY; k++) {
    const a = 2 * k;
    const b = 2 * k + 1;
    const c = 2 * k + 2;
    const d = 2 * k + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  orientTowards(g, V(0, 0, 1));
  g.computeVertexNormals();
  kit.add('gelcoat', g, { color: PALETTE.lining, rough: 0.4 });
}

function buildDecks(kit, L) {
  const tA = L.shell / L.length;
  const tF = L.tAtSheerZ(L.houseFront);
  const grip = { color: PALETTE.deck, rough: 0.5, pattern: 1 };
  const uvFn = (p) => [p.x, p.z];

  const NS = 40;
  const NX = 8;
  const sole = [];
  for (let i = 0; i <= NS; i++) {
    const t = lerp(tA, tF, i / NS);
    const z = L.sheerZ(t);
    const xe = innerX(L, t, L.deckY);
    const row = [];
    for (let k = 0; k <= NX; k++) row.push(V(lerp(xe, -xe, k / NX), L.deckY, z));
    sole.push(row);
  }
  const gs = gridSurface(sole, { uvFn });
  orientTowards(gs, V(0, 1, 0));
  gs.computeVertexNormals();
  kit.add('gelcoat', gs, grip);

  const NF = 30;
  const NFX = 12;
  let tDeckEnd = 1;
  while (L.sheerX(tDeckEnd) - L.shell < 0.012) tDeckEnd -= 0.0005;
  const fore = [];
  for (let i = 0; i <= NF; i++) {
    const t = lerp(tF, tDeckEnd, 1 - Math.pow(1 - i / NF, 1.3));
    const z = L.sheerZ(t);
    const xe = Math.max(0.012, L.sheerX(t) - L.shell);
    const row = [];
    for (let k = 0; k <= NFX; k++) {
      const x = lerp(xe, -xe, k / NFX);
      row.push(V(x, foredeckY(L, t, x), z));
    }
    fore.push(row);
  }
  const gf = gridSurface(fore, { uvFn });
  orientTowards(gf, V(0, 1, 0));
  gf.computeVertexNormals();
  kit.add('gelcoat', gf, grip);

  for (const s of [1, -1]) {
    const outline = [];
    const NZ = 12;
    const z0 = L.houseBack;
    const z1 = L.houseFront;
    for (let i = 0; i <= NZ; i++) {
      const z = lerp(z0, z1, i / NZ);
      outline.push([z, houseHalfWidth(L, z) - 0.045]);
    }
    for (let i = NZ; i >= 0; i--) {
      const z = lerp(z0, z1, i / NZ);
      outline.push([z, L.sheerX(L.tAtSheerZ(z)) - L.shell + 0.01]);
    }
    const g = slab(outline, [], (u, v, side) => {
      const t = L.tAtSheerZ(u);
      return V(s * v, L.sheerY(t) - (side ? 0.04 : 0), u);
    });
    auxVertices(g, (p) => [0.5, 0, p.y > L.sheerY(L.tAtSheerZ(p.z)) - 0.02 ? 1 : 0, 0]);
    kit.add('gelcoat', g, { color: PALETTE.deck });
  }

  const hy = L.deckY + 0.008;
  for (const [w, d, x, z] of [[0.74, 0.03, 0, -1.25], [0.74, 0.03, 0, -1.95], [0.03, 0.73, 0.355, -1.6], [0.03, 0.73, -0.355, -1.6]]) {
    const b = box(w, 0.016, d);
    b.translate(x, hy, z);
    kit.add('gelcoat', b, { color: 0xd6d1c4, rough: 0.45 });
  }
  kit.add('fittings', rod(V(-0.05, L.deckY + 0.004, -1.45), V(0.05, L.deckY + 0.004, -1.45), 0.006, 6), { color: PALETTE.stainless, rough: 0.3, metal: 1 });
}

const CAP_H = 0.045;
function capProfile(xi, xo, y0, z, sign) {
  const xm = (xi + xo) / 2;
  const pts = [
    [xi, y0 - 0.012],
    [xi, y0 + CAP_H - 0.012],
    [xi + 0.01, y0 + CAP_H - 0.002],
    [xm, y0 + CAP_H + 0.004],
    [xo - 0.01, y0 + CAP_H - 0.002],
    [xo, y0 + CAP_H - 0.012],
    [xo, y0 - 0.026],
    [xo - 0.018, y0 - 0.03],
  ];
  return pts.map((p) => V(sign * Math.max(0, p[0]), p[1], z));
}

function buildGunwale(kit, L) {
  const tStart = (L.shell + 0.03) / L.length;
  const N = 60;
  for (const s of [1, -1]) {
    const profiles = [];
    for (let i = 0; i <= N; i++) {
      const t = lerp(tStart, 1, 1 - Math.pow(1 - i / N, 1.25));
      const xs = L.sheerX(t);
      let z = L.sheerZ(t);
      let xo = xs + 0.022;
      if (i === N) {
        xo = 0;
        z += 0.03;
      }
      profiles.push(capProfile(Math.max(0, xs - L.shell - 0.03), xo, L.sheerY(t), z, s));
    }
    const g = loft(profiles);
    orientOutward(g, (p) => V(p.x - s * (L.sheerX(L.tAtSheerZ(p.z)) - 0.03), p.y - L.sheerY(L.tAtSheerZ(p.z)) - 0.01, 0), V(0, 1, 0));
    woodUV(g, profiles);
    kit.add('wood', g, { rough: 0.32 });
    kit.add('wood', fanCap(profiles[0], V(0, 0, -1)), { rough: 0.32 });
  }

  const y0 = L.sheerY(0);
  const xo = L.sheerX(0) + 0.022;
  const zi = L.zAft + L.shell + 0.03;
  const zo = L.zAft - 0.022;
  const prof = (x) => capProfile(0, zi - zo, 0, 0, 1).map((p) => V(x, y0 + p.y, zi - p.x));
  const tprofiles = [];
  for (let i = 0; i <= 8; i++) tprofiles.push(prof(lerp(-xo, xo, i / 8)));
  const tg = loft(tprofiles);
  orientOutward(tg, (p) => V(0, p.y - y0 - 0.01, p.z - (zi + zo) / 2), V(0, 1, 0));
  woodUV(tg, tprofiles);
  kit.add('wood', tg, { rough: 0.32 });
  kit.add('wood', fanCap(tprofiles[0], V(-1, 0, 0)), { rough: 0.32 });
  kit.add('wood', fanCap(tprofiles[8], V(1, 0, 0)), { rough: 0.32 });
}

function buildRubrail(kit, L) {
  const N = 50;
  const ANG = [-90, -60, -30, 0, 30, 60, 90].map((a) => (a * Math.PI) / 180);
  for (const s of [1, -1]) {
    const centers = [];
    for (let i = 0; i <= N; i++) {
      const t = lerp(0.0, 0.992, 1 - Math.pow(1 - i / N, 1.25));
      const y = L.sheerY(t) - 0.07;
      const x = L.halfBreadth(t, y);
      centers.push(V(x, y, L.zOnStation(t, y)));
    }
    const profiles = [];
    const strip = [];
    for (let i = 0; i <= N; i++) {
      const c = centers[i];
      const a = centers[Math.max(0, i - 1)];
      const b = centers[Math.min(N, i + 1)];
      const dz = b.z - a.z;
      const dx = b.x - a.x;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len;
      const nz = -dx / len;
      const prof = ANG.map((ang) => {
        const o = 0.036 * Math.cos(ang) - 0.006;
        return V(s * (c.x + nx * o), c.y + 0.03 * Math.sin(ang), c.z + nz * o);
      });
      profiles.push(prof);
      strip.push(V(s * (c.x + nx * 0.034), c.y, c.z + nz * 0.034));
    }
    const g = loft(profiles);
    orientOutward(g, () => V(s, 0, 0), V(s, 0, 0));
    woodUV(g, profiles);
    kit.add('wood', g, { rough: 0.35 });
    kit.add('wood', fanCap(profiles[0], V(0, 0, -1)), { rough: 0.35 });
    kit.add('wood', fanCap(profiles[N], V(0, 0, 1)), { rough: 0.35 });
    kit.add('fittings', tube(strip, 0.0065, 64, 4), { color: PALETTE.stainless, rough: 0.22, metal: 1 });
  }

  const y = L.sheerY(0) - 0.07;
  const xo = L.sheerX(0) + 0.015;
  const tprof = [];
  for (let i = 0; i <= 6; i++) {
    const x = lerp(-xo, xo, i / 6);
    tprof.push(ANG.map((ang) => V(x, y + 0.03 * Math.sin(ang), L.zAft - (0.036 * Math.cos(ang) - 0.006))));
  }
  const tg = loft(tprof);
  orientOutward(tg, (p) => V(0, 0, p.z - L.zAft + 0.001), V(0, 0, -1));
  woodUV(tg, tprof);
  kit.add('wood', tg, { rough: 0.35 });
  kit.add('wood', fanCap(tprof[0], V(-1, 0, 0)), { rough: 0.35 });
  kit.add('wood', fanCap(tprof[6], V(1, 0, 0)), { rough: 0.35 });
}

function buildHull(kit, L) {
  buildShell(kit, L);
  buildKeel(kit, L);
  buildLining(kit, L);
  buildDecks(kit, L);
  buildGunwale(kit, L);
  buildRubrail(kit, L);
}

// ============================================================================
// 4. DeckGear — armadilhas, alador (hauler), boias, defensas, cabeços, âncora
// ============================================================================

const STAINLESS = { color: PALETTE.stainless, rough: 0.22, metal: 1 };
const GALV = { color: 0xa3a7ab, rough: 0.35, metal: 1 };
const BLACK_PLASTIC = { color: 0x1a1b1d, rough: 0.55, metal: 0 };
const WHITE_PAINT = { color: 0xf1f0eb, rough: 0.35, metal: 0 };
const FRAME = { color: 0xa4a8ab, rough: 0.55, metal: 1 };
const VINYL = { color: 0x1f2a3a, rough: 0.6, metal: 0 };

const TRAP = { L: 0.95, W: 0.55, H: 0.37 };
const TRAPS = [
  [0.66, 0, -3.25, 0.02, 0xd8b21c],
  [0.66, 1, -3.23, -0.03, 0x2f7a3c],
  [0.64, 0, -2.2, -0.04, 0xd8b21c],
  [-0.68, 0, -3.25, 0.03, 0x1f2326],
];
const HAULER = { x: -1.0, z: -0.62, y: 1.34 };
const FENDERS = [[-1, -2.4], [-1, -1.05], [-1, 0.65], [1, -1.7]];
const FLAG = { w: 0.5, h: 0.33 };

function buoyGeometry(colors = [0xff6a13, 0xf4f1ea, 0x1d4f9c], stick = 0.35) {
  const bands = [
    [[0, 0], [0.03, 0.004], [0.055, 0.025], [0.07, 0.07], [0.075, 0.12], [0.075, 0.17]],
    [[0.075, 0.17], [0.075, 0.22], [0.075, 0.27]],
    [[0.075, 0.27], [0.074, 0.33], [0.068, 0.39], [0.052, 0.435], [0.03, 0.455], [0, 0.46]],
  ];
  const out = bands.map((b, i) => [lathe(b, 12), { color: colors[i], rough: 0.55 }]);
  out.push([cylinder(0.011, 0.013, 0.46 + stick + 0.06, 6).translate(0, (0.46 + stick - 0.06) / 2, 0), { color: 0x9c7a4c, rough: 0.75 }]);
  return out;
}

function trapFace(a, b, c, d, w, h, pattern = 0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, w, 0, w, h, 0, h], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return { g, opts: { rough: w, metal: h, pattern } };
}

function buildTraps(kit, L) {
  const { L: TL, W, H } = TRAP;
  for (const [x, level, z, yaw, col] of TRAPS) {
    const y0 = L.deckY + 0.03 + level * (H + 0.035);
    const m = mat4(x, y0, z, 0, yaw, 0);
    const add = (f, color = col) => {
      f.g.applyMatrix4(m);
      kit.add('trap', f.g, { ...f.opts, color });
    };
    const hw = W / 2;
    const hl = TL / 2;
    add(trapFace(V(-hw, 0, hl), V(hw, 0, hl), V(hw, H, hl), V(-hw, H, hl), W, H));
    add(trapFace(V(hw, 0, -hl), V(-hw, 0, -hl), V(-hw, H, -hl), V(hw, H, -hl), W, H));
    add(trapFace(V(hw, 0, hl), V(hw, 0, -hl), V(hw, H, -hl), V(hw, H, hl), TL, H));
    add(trapFace(V(-hw, 0, -hl), V(-hw, 0, hl), V(-hw, H, hl), V(-hw, H, -hl), TL, H));
    add(trapFace(V(-hw, H, hl), V(hw, H, hl), V(hw, H, -hl), V(-hw, H, -hl), W, TL));
    add(trapFace(V(-hw, 0, -hl), V(hw, 0, -hl), V(hw, 0, hl), V(-hw, 0, hl), W, TL));
    add(trapFace(V(-hw, 0, 0.08), V(hw, 0, 0.08), V(hw, H, 0.08), V(-hw, H, 0.08), W, H));

    const net = 0x264f6e;
    for (const s of [1, -1]) {
      const zc = -0.2;
      const yc = H * 0.5;
      const o = [V(s * hw, yc - 0.12, zc - 0.15), V(s * hw, yc - 0.12, zc + 0.15), V(s * hw, yc + 0.12, zc + 0.15), V(s * hw, yc + 0.12, zc - 0.15)];
      const i = [V(s * 0.07, yc - 0.045, zc - 0.06), V(s * 0.07, yc - 0.045, zc + 0.06), V(s * 0.07, yc + 0.045, zc + 0.06), V(s * 0.07, yc + 0.045, zc - 0.06)];
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        add(trapFace(o[k], o[k1], i[k1], i[k], o[k].distanceTo(o[k1]), o[k].distanceTo(i[k]), 1), net);
      }
    }

    for (const rx of [-0.2, 0, 0.2]) {
      const r = box(0.05, 0.032, TL + 0.02);
      r.translate(rx, -0.012, 0);
      r.applyMatrix4(m);
      kit.add('wood', r, { color: 0x9a9a92, rough: 0.8 });
    }
    for (const bz of [-0.3, 0.3]) {
      const b = box(0.2, 0.06, 0.09);
      b.translate(0.05, 0.035, bz);
      b.applyMatrix4(m);
      kit.add('fittings', b, { color: 0x8e3a26, rough: 0.9 });
    }
    const bag = sphere(0.06, 8, 6);
    bag.scale(1, 1.3, 1);
    bag.translate(0, H - 0.1, -0.2);
    bag.applyMatrix4(m);
    kit.add('fittings', bag, { color: 0xb3261e, rough: 0.8 });
  }
}

function buildHauler(kit, L) {
  const t = L.tAtSheerZ(-0.78);
  const xg = -(L.sheerX(t) - 0.035);
  const yg = L.sheerY(t) + 0.045;

  const pts = [
    V(xg, yg, -0.8),
    V(xg - 0.02, yg + 0.45, -0.78),
    V(xg - 0.05, 1.86, -0.76),
    V(xg - 0.13, 2.06, -0.74),
    V(xg - 0.3, 2.11, -0.73),
    V(xg - 0.43, 2.07, -0.72),
  ];
  kit.add('fittings', tube(pts, 0.03, 32, 8), STAINLESS);
  const foot = roundedBox(0.12, 0.02, 0.16, 0.008, 1);
  foot.translate(xg, yg + 0.01, -0.8);
  kit.add('fittings', foot, STAINLESS);
  const tip = pts[pts.length - 1];
  const tipCap = sphere(0.03, 10, 6);
  tipCap.translate(tip.x, tip.y, tip.z);
  kit.add('fittings', tipCap, STAINLESS);
  kit.add('fittings', rod(tip, tip.clone().add(V(0, -0.12, 0)), 0.01, 6), STAINLESS);
  const bc = tip.clone().add(V(0, -0.22, 0));
  for (const dz of [-0.022, 0.022]) {
    const cheek = cylinder(0.085, 0.085, 0.01, 16);
    cheek.applyMatrix4(mat4(bc.x, bc.y, bc.z + dz, Math.PI / 2, 0, 0));
    kit.add('fittings', cheek, GALV);
  }
  const sheave = cylinder(0.07, 0.07, 0.034, 16);
  sheave.applyMatrix4(mat4(bc.x, bc.y, bc.z, Math.PI / 2, 0, 0));
  kit.add('fittings', sheave, { color: 0x2b2d30, rough: 0.6 });

  const { x, y, z } = HAULER;
  kit.add('fittings', rod(V(x, L.deckY, z + 0.1), V(x, y - 0.1, z + 0.1), 0.038, 12), GALV);
  const plate = box(0.2, 0.012, 0.2);
  plate.translate(x, L.deckY + 0.006, z + 0.1);
  kit.add('fittings', plate, GALV);
  const motor = cylinder(0.075, 0.075, 0.17, 18);
  motor.applyMatrix4(mat4(x, y, z + 0.13, Math.PI / 2, 0, 0));
  kit.add('fittings', motor, { color: 0x3a4048, rough: 0.45, metal: 0.3 });
  const head = lathe([[0, -0.05], [0.2, -0.05], [0.205, -0.04], [0.1, -0.006], [0.1, 0.006], [0.205, 0.04], [0.2, 0.05], [0, 0.05]], 28);
  head.applyMatrix4(mat4(x, y, z, Math.PI / 2, 0, 0));
  kit.add('fittings', head, GALV);
  const hubCap = cylinder(0.04, 0.05, 0.03, 12);
  hubCap.applyMatrix4(mat4(x, y, z - 0.06, Math.PI / 2, 0, 0));
  kit.add('fittings', hubCap, GALV);

  kit.add('fittings', tube([V(x + 0.05, y, z + 0.2), V(x + 0.12, y - 0.2, z + 0.3), V(x + 0.1, 0.6, z + 0.28), V(x + 0.06, L.deckY + 0.02, z + 0.25)], 0.012, 20, 5), BLACK_PLASTIC);
  kit.add('fittings', tube([V(x - 0.05, y, z + 0.2), V(x - 0.02, y - 0.25, z + 0.32), V(x + 0.02, 0.62, z + 0.3), V(x + 0.02, L.deckY + 0.02, z + 0.28)], 0.012, 20, 5), BLACK_PLASTIC);

  const rope = [
    bc.clone().add(V(0.07, 0, 0)),
    V(x - 0.3, y + 0.35, z + 0.02),
    V(x - 0.12, y + 0.2, z),
    V(x + 0.2, y - 0.02, z - 0.01),
    V(x + 0.16, y - 0.25, z - 0.01),
    V(x + 0.05, 0.72, z - 0.1),
    V(x + 0.2, L.deckY + 0.02, z - 0.35),
  ];
  kit.add('fittings', tube(rope, 0.009, 48, 4), { color: 0xe4c235, rough: 0.8, pattern: 1 });
}

function coil(cx, cy, cz, turns, radius, ropeR, seed) {
  const pts = [];
  const perTurn = 12;
  const n = turns * perTurn;
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const a = (k / perTurn) * Math.PI * 2 + seed;
    const r = radius * (1 - 0.12 * f) + 0.012 * Math.sin(k * 0.9 + seed * 3);
    const y = cy + ropeR + f * turns * ropeR * 1.35 + 0.004 * Math.sin(k * 1.7 + seed);
    pts.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  const last = pts[pts.length - 1];
  pts.push(V(last.x * 0.7 + cx * 0.3 + 0.12, last.y - 0.01, last.z + 0.2), V(last.x + 0.35, cy + ropeR, last.z + 0.4));
  return tube(pts, ropeR, turns * 21 + 10, 4);
}

function buildCoils(kit, L) {
  kit.add('fittings', coil(-0.5, L.deckY, -2.15, 5, 0.22, 0.011, 0.3), { color: 0xe4c235, rough: 0.8, pattern: 1 });
  const topTrap = L.deckY + 0.03 + TRAP.H + 0.012;
  kit.add('fittings', coil(-0.68, topTrap, -3.2, 4, 0.19, 0.01, 1.7), { color: 0x2f6f4f, rough: 0.8, pattern: 1 });
}

function buildBuoys(kit, L) {
  const place = [
    [-0.2, L.deckY + 0.075, -2.75, Math.PI / 2, 0.4],
    [0.12, L.deckY + 0.075, -3.0, Math.PI / 2, -0.9],
  ];
  for (const [x, y, z, rx, ry] of place) {
    const m = mat4(x, y, z, rx, ry, 0, 1, 1, 1, 'YXZ');
    for (const [g, opts] of buoyGeometry(undefined, 0.3)) {
      g.translate(0, -0.23, 0);
      g.applyMatrix4(m);
      kit.add('fittings', g, opts);
    }
  }
}

function buildFenders(kit, L) {
  const prof = [[0, 0], [0.03, 0.004], [0.055, 0.016], [0.07, 0.04], [0.075, 0.07], [0.075, 0.43], [0.07, 0.46], [0.055, 0.484], [0.03, 0.496], [0, 0.5]];
  for (const [s, z] of FENDERS) {
    const yTop = 0.86;
    const hullX = L.hullXAt(z, yTop - 0.05);
    const fx = s * (hullX + 0.08);
    const f = lathe(prof, 12);
    f.translate(fx, yTop - 0.5, z);
    kit.add('fittings', f, { color: 0x1d3a66, rough: 0.45 });
    const eye = torus(0.018, 0.006, 5, 10);
    eye.translate(fx, yTop + 0.018, z);
    kit.add('fittings', eye, { color: 0x1d3a66, rough: 0.45 });
    const t = L.tAtSheerZ(z);
    const ys = L.sheerY(t) + 0.05;
    const xo = s * (L.sheerX(t) + 0.01);
    const xi = s * (L.sheerX(t) - L.shell - 0.05);
    const line = [V(fx, yTop + 0.03, z), V(fx - s * 0.01, (yTop + ys) / 2, z), V(xo, ys, z), V((xo + xi) / 2, ys + 0.012, z), V(xi, ys - 0.03, z)];
    kit.add('fittings', tube(line, 0.006, 16, 4), { color: 0xf0efe8, rough: 0.8, pattern: 1 });
  }
}

function cleat(pos, yaw, len = 0.2) {
  const parts = [];
  const horn = cylinder(0.011, 0.011, len * 0.7, 8);
  horn.applyMatrix4(mat4(0, 0.045, 0, Math.PI / 2, 0, 0));
  parts.push(horn);
  for (const s of [1, -1]) {
    const tipC = cylinder(0.006, 0.011, len * 0.15, 8);
    tipC.applyMatrix4(mat4(0, 0.045, s * len * 0.425, s * Math.PI / 2, 0, 0));
    parts.push(tipC);
    const foot = cylinder(0.013, 0.018, 0.045, 8);
    foot.translate(0, 0.0225, s * len * 0.22);
    parts.push(foot);
  }
  const m = mat4(pos.x, pos.y, pos.z, 0, yaw, 0);
  return parts.map((p) => p.applyMatrix4(m));
}

function buildCleats(kit, L) {
  const list = [];
  for (const s of [1, -1]) {
    for (const z of [-3.6, -1.35]) {
      const t = L.tAtSheerZ(z);
      list.push(...cleat(V(s * (L.sheerX(t) - 0.04), L.sheerY(t) + 0.048, z), 0));
    }
  }
  const tb = L.tAtSheerZ(3.35);
  list.push(...cleat(V(0, foredeckY(L, tb, 0), 3.35), Math.PI / 2, 0.24));
  for (const g of list) kit.add('fittings', g, STAINLESS);
}

function buildBow(kit, L) {
  const yTip = L.sheerY(1);
  const head = roundedBox(0.09, 0.05, 0.3, 0.015, 2);
  head.translate(0, yTip + 0.03, L.zBow - 0.08);
  kit.add('fittings', head, STAINLESS);
  for (const s of [1, -1]) {
    const cheek = box(0.008, 0.07, 0.16);
    cheek.translate(s * 0.04, yTip + 0.08, L.zBow + 0.02);
    kit.add('fittings', cheek, STAINLESS);
  }
  const roller = cylinder(0.03, 0.03, 0.07, 12);
  roller.applyMatrix4(mat4(0, yTip + 0.085, L.zBow + 0.07, 0, 0, Math.PI / 2));
  kit.add('fittings', roller, BLACK_PLASTIC);

  const sa = V(0, yTip + 0.1, L.zBow - 0.45);
  const sb = V(0, yTip + 0.12, L.zBow + 0.13);
  kit.add('fittings', rod(sa, sb, 0.017, 8), GALV);
  const knuckle = cylinder(0.025, 0.025, 0.07, 10);
  knuckle.applyMatrix4(mat4(sb.x, sb.y, sb.z, 0, 0, Math.PI / 2));
  kit.add('fittings', knuckle, GALV);
  const plowDir = V(0, -0.85, -0.4).normalize();
  const plow = new THREE.ConeGeometry(0.12, 0.34, 4);
  plow.rotateY(Math.PI / 4);
  plow.scale(1, 1, 0.38);
  plow.applyMatrix4(alignY(sb.clone().add(V(0, -0.02, 0.02)).addScaledVector(plowDir, 0.17), plowDir));
  kit.add('fittings', plow, GALV);

  const t = L.tAtSheerZ(L.zBow - 0.75);
  const pipeY = foredeckY(L, t, 0);
  const dp = cylinder(0.035, 0.045, 0.04, 14);
  dp.translate(0, pipeY + 0.02, L.zBow - 0.75);
  kit.add('fittings', dp, STAINLESS);
  kit.add('fittings', tube([sa, V(0, lerp(sa.y, pipeY, 0.6) + 0.03, L.zBow - 0.6), V(0, pipeY + 0.04, L.zBow - 0.75)], 0.012, 10, 5), GALV);
}

function buildContainers(kit, L) {
  const tote = new THREE.CylinderGeometry(0.43, 0.37, 0.36, 4, 1);
  tote.rotateY(Math.PI / 4);
  tote.scale(1, 1, 0.62);
  tote.translate(-0.72, L.deckY + 0.18, -1.45);
  kit.add('fittings', tote, { color: 0x2a64b0, rough: 0.55 });
  const bait = box(0.52, 0.02, 0.33);
  bait.translate(-0.72, L.deckY + 0.352, -1.45);
  kit.add('fittings', bait, { color: 0x5a2c22, rough: 0.35 });

  const bx = 0.86;
  const bz = -0.8;
  const barrel = cylinder(0.26, 0.26, 0.78, 20);
  barrel.translate(bx, L.deckY + 0.39, bz);
  kit.add('fittings', barrel, { color: 0x1f5ea6, rough: 0.5 });
  for (const y of [0.26, 0.52]) {
    const rib = torus(0.262, 0.012, 5, 24);
    rib.applyMatrix4(mat4(bx, L.deckY + y, bz, Math.PI / 2, 0, 0));
    kit.add('fittings', rib, { color: 0x1f5ea6, rough: 0.5 });
  }
  const lid = cylinder(0.27, 0.27, 0.03, 20);
  lid.translate(bx, L.deckY + 0.795, bz);
  kit.add('fittings', lid, { color: 0x1b4f8c, rough: 0.5 });
}

function buildStern(kit, L, parts) {
  const y0 = L.sheerY(0) + 0.045;
  const base = cylinder(0.03, 0.035, 0.03, 12);
  base.translate(0, y0 + 0.015, L.zAft + 0.03);
  kit.add('fittings', base, BLACK_PLASTIC);
  const lens = cylinder(0.025, 0.025, 0.05, 12);
  lens.translate(0, y0 + 0.055, L.zAft + 0.03);
  kit.add('glow', lens, { color: 0xfff3dc, rough: 0.2, pattern: 0 });
  const cap = cylinder(0.03, 0.028, 0.012, 12);
  cap.translate(0, y0 + 0.086, L.zAft + 0.03);
  kit.add('fittings', cap, BLACK_PLASTIC);

  const sx = -(L.sheerX(0.02) - 0.08);
  const sz = L.zAft + 0.14;
  const top = y0 + 1.0;
  kit.add('fittings', rod(V(sx, y0 - 0.02, sz), V(sx, top, sz), 0.014, 8, 0.01), { color: 0xf1efe8, rough: 0.3 });
  const finial = sphere(0.02, 8, 6);
  finial.translate(sx, top + 0.015, sz);
  kit.add('fittings', finial, { color: 0xc8a050, rough: 0.25, metal: 1 });
  const socket = cylinder(0.022, 0.026, 0.06, 10);
  socket.translate(sx, y0 + 0.01, sz);
  kit.add('fittings', socket, STAINLESS);

  const { w, h } = FLAG;
  const nu = 12;
  const nv = 6;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      pos.push(sx, top - 0.03 - h + v * h, sz - u * w);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 2;
      const d = a + nu + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  for (const flip of [false, true]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const ix = flip ? idx.map((_, k) => idx[k - (k % 3) + (2 - (k % 3))]) : idx.slice();
    g.setIndex(ix);
    g.computeVertexNormals();
    auxVertices(g, (_p, k) => [0.7, 0, 2, uvs[k * 2]]);
    kit.add('fittings', g, { color: 0xffffff });
  }
  parts.flagPivot = V(sx, 0, sz);
}

function buildDeckGear(kit, L, parts) {
  buildTraps(kit, L);
  buildHauler(kit, L);
  buildCoils(kit, L);
  buildBuoys(kit, L);
  buildFenders(kit, L);
  buildCleats(kit, L);
  buildBow(kit, L);
  buildContainers(kit, L);
  buildStern(kit, L, parts);
}

// ============================================================================
// 5. Wheelhouse — cabine, janelas translúcidas, teto, radar, console, leme
// ============================================================================

const HOUSE = {
  wallT: 0.045,
  wsBottomY: 1.48,
  wsTopY: 2.24,
  roofUnderY: 2.31,
  roofZ0: -0.95,
  roofZ1: 1.34,
  winBottom: 1.56,
  winTop: 2.12,
  dash: { zFace: 0.98, yKnee: 1.08, zTop: 1.16, yTop: 1.4, zBack: 1.41, halfW: 1.1 },
  helmX: -0.55,
  seatZ: 0.22,
};

function wsZ(L, y) {
  return L.houseFront - (y - HOUSE.wsBottomY) * (0.25 / 0.76);
}
function wallX(L, z, y) {
  return houseHalfWidth(L, z) - Math.max(0, y - 1.15) * 0.04;
}
function roofTopY(x) {
  return 2.375 + 0.035 * (1 - (x / 1.35) ** 2);
}

function area2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function offsetPoly(poly, d) {
  const n = poly.length;
  const ccw = area2(poly) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.max(1e-9, Math.hypot(ex, ey));
    let nx = ey / l;
    let ny = -ex / l;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    lines.push([a[0] + nx * d, a[1] + ny * d, ex, ey]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const den = l1[2] * l2[3] - l1[3] * l2[2];
    const s = Math.abs(den) > 1e-10 ? ((l2[0] - l1[0]) * l2[3] - (l2[1] - l1[1]) * l2[2]) / den : 0;
    out.push([l1[0] + l1[2] * s, l1[1] + l1[3] * s]);
  }
  return out;
}

function sideWindowHoles(L) {
  const { winBottom: y0, winTop: y1 } = HOUSE;
  const front = (y) => wsZ(L, y) - 0.1;
  return [
    [[0.3, y0], [0.78, y0], [0.78, y1], [0.3, y1]],
    [[0.84, y0], [front(y0), y0], [front(y1), y1], [0.84, y1]],
  ];
}

function buildWalls(kit, L) {
  const { wallT, roofUnderY } = HOUSE;
  const z0 = L.houseBack;
  const z1 = L.houseFront;
  const outline = [];
  const NB = 8;
  for (let i = 0; i <= NB; i++) {
    const z = lerp(z0, z1, i / NB);
    outline.push([z, L.sheerY(L.tAtSheerZ(z))]);
  }
  outline.push([z1, HOUSE.wsBottomY]);
  outline.push([wsZ(L, roofUnderY), roofUnderY]);
  outline.push([z0, roofUnderY]);
  const holes = sideWindowHoles(L);

  for (const s of [1, -1]) {
    const map = (u, v, side) => V(s * (wallX(L, u, v) - side * wallT), v, u);
    const wall = slab(outline, holes, map);
    auxVertices(wall, (p) => (Math.abs(p.x) < wallX(L, p.z, p.y) - wallT * 0.5 ? [0.5, 0, 2, 0] : [0.3, 0, 0, 0]));
    kit.add('gelcoat', wall, { color: PALETTE.gelcoat });

    for (const h of holes) {
      const outer = offsetPoly(h, 0.024);
      const fmap = (u, v, side) => V(s * (wallX(L, u, v) + 0.008 - side * (wallT + 0.016)), v, u);
      kit.add('fittings', slab(outer, [offsetPoly(h, -0.006)], fmap), FRAME);

      // Vidro translúcido nas janelas laterais (compatível com UVs normalizadas do vidro)
      const gPaneMap = (u, v, side) => V(s * (wallX(L, u, v) - wallT * 0.45 - side * 0.004), v, u);
      const pane = slab(offsetPoly(h, -0.012), [], gPaneMap, { edges: false, back: false });
      kit.add('glass', pane);

      const gmap = (u, v, side) => V(s * (wallX(L, u, v) + 0.004 - side * (wallT + 0.008)), v, u);
      kit.add('fittings', slab(offsetPoly(h, -0.005), [offsetPoly(h, -0.014)], gmap), { color: 0x0e0f10, rough: 0.8 });

      const ring = offsetPoly(h, 0.011);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(2, Math.round(len / 0.075));
        for (let k = 0; k < n; k++) {
          const u = lerp(a[0], b[0], (k + 0.5) / n);
          const v = lerp(a[1], b[1], (k + 0.5) / n);
          const xr = s * (wallX(L, u, v) + 0.008 - (wallT + 0.016) - 0.001);
          const rv = cylinder(0.0045, 0.0045, 0.003, 6);
          rv.applyMatrix4(mat4(xr, v, u, 0, 0, Math.PI / 2));
          kit.add('fittings', rv, { color: 0xc9ccd0, rough: 0.35, metal: 1 });
        }
      }
    }

    const lz = 0.81;
    const ly = 1.84;
    const lb = box(0.02, 0.06, 0.025);
    lb.translate(s * (wallX(L, lz, ly) - wallT - 0.012), ly, lz);
    kit.add('fittings', lb, BLACK_PLASTIC);
  }

  const tF = L.tAtSheerZ(L.houseFront);
  const hw = houseHalfWidth(L, L.houseFront);
  const cOutline = [];
  for (let i = 0; i <= 10; i++) {
    const x = lerp(-hw, hw, i / 10);
    cOutline.push([x, foredeckY(L, tF, x) - 0.012]);
  }
  cOutline.push([hw, HOUSE.wsBottomY], [-hw, HOUSE.wsBottomY]);
  const coaming = slab(cOutline, [], (u, v, side) => V(u, v, L.houseFront - side * 0.04));
  auxVertices(coaming, (p) => (p.z < L.houseFront - 0.02 ? [0.5, 0, 2, 0] : [0.3, 0, 0, 0]));
  kit.add('gelcoat', coaming, { color: PALETTE.gelcoat });
}

function buildWindshield(kit, L) {
  const { wsBottomY, roofUnderY } = HOUSE;
  const rake = V(0, 0.76, -0.25).normalize();
  const normal = V(0, 0.25, 0.76).normalize();
  const base = V(0, wsBottomY, L.houseFront);
  const vTop = (roofUnderY - wsBottomY) / rake.y;
  const at = (u, v) => base.clone().addScaledVector(rake, v).setX(u);
  const halfAt = (v) => {
    const p = at(0, v);
    return wallX(L, p.z, p.y);
  };

  const xb = halfAt(0);
  const xt = halfAt(vTop);
  const outline = [[-xb, 0], [xb, 0], [xt, vTop], [-xt, vTop]];
  const v0 = 0.07;
  const v1 = 0.75;
  const holes = [
    [[-0.36, v0], [0.36, v0], [0.36, v1], [-0.36, v1]],
    [[0.42, v0], [halfAt(v0) - 0.09, v0], [halfAt(v1) - 0.09, v1], [0.42, v1]],
    [[-0.42, v0], [-0.42, v1], [-halfAt(v1) + 0.09, v1], [-halfAt(v0) + 0.09, v0]],
  ];
  const T = 0.05;
  const map = (u, v, side) => at(u, v).addScaledVector(normal, -side * T);
  kit.add('gelcoat', slab(outline, holes, map), { color: PALETTE.gelcoat, rough: 0.3 });

  for (const h of holes) {
    const outer = offsetPoly(h, 0.022);
    kit.add('fittings', slab(outer, [offsetPoly(h, -0.006)], (u, v, side) => at(u, v).addScaledVector(normal, 0.008 - side * (T + 0.016))), FRAME);
    // Para-brisa com vidro translúcido
    const pane = slab(offsetPoly(h, -0.006), [], (u, v, side) => at(u, v).addScaledVector(normal, -T * 0.45 - side * 0.004), { edges: false, back: false });
    kit.add('glass', pane);
  }

  for (const [u, ang] of [[0.0, 0.25], [-0.72, 0.2]]) {
    const pivot = at(u, v0 + 0.03).addScaledVector(normal, 0.012);
    const dir = rake.clone().applyAxisAngle(normal, ang);
    const blade = rod(pivot, pivot.clone().addScaledVector(dir, 0.52), 0.006, 5);
    kit.add('fittings', blade, BLACK_PLASTIC);
    kit.add('fittings', rod(pivot.clone().addScaledVector(normal, -0.01), pivot.clone().addScaledVector(normal, 0.012), 0.014, 8), BLACK_PLASTIC);
  }
}

function roofHalf(L, z) {
  const zc = Math.min(Math.max(z, L.houseBack), 1.18);
  let hw = wallX(L, zc, HOUSE.roofUnderY) + 0.09;
  const rc = 0.22;
  const d = Math.min(z - HOUSE.roofZ0, HOUSE.roofZ1 - z);
  if (d < rc) hw -= rc - Math.sqrt(Math.max(0, rc * rc - (rc - d) ** 2));
  return hw;
}

function orientOutwardFn(g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  let dot = 0;
  const a = V();
  const b = V();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(n, i);
    dot += b.dot(fn(a));
  }
  if (dot < 0) {
    const idx = Array.from(g.index.array);
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
}

function metricUV(g, fn) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = fn(v);
    uv[i * 2] = t[0];
    uv[i * 2 + 1] = t[1];
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function buildRoof(kit, L) {
  const yb = HOUSE.roofUnderY;
  const N = 22;
  const profiles = [];
  const zs = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const g = 0.5 - 0.5 * Math.cos(Math.PI * f);
    zs.push(lerp(HOUSE.roofZ0, HOUSE.roofZ1, lerp(f, g, 0.6)));
  }
  for (const zw of [L.houseBack, L.houseFront]) {
    for (const dz of [-0.012, 0.012]) {
      const z = zw + dz;
      if (z > HOUSE.roofZ0 + 0.02 && z < HOUSE.roofZ1 - 0.02) zs.push(z);
    }
  }
  zs.sort((a, b) => a - b);
  for (const z of zs) {
    const hw = roofHalf(L, z);
    const wIn = wallX(L, Math.min(Math.max(z, L.houseBack), L.houseFront), yb) - HOUSE.wallT;
    const half = [
      [0, yb],
      [wIn * 0.5, yb],
      [wIn - 0.01, yb],
      [wIn + 0.01, yb],
      [hw - 0.03, yb],
      [hw - 0.008, yb + 0.008],
      [hw, yb + 0.025],
      [hw - 0.004, roofTopY(hw) - 0.012],
      [hw - 0.02, roofTopY(hw)],
      [hw * 0.75, roofTopY(hw * 0.75)],
      [hw * 0.5, roofTopY(hw * 0.5)],
      [hw * 0.25, roofTopY(hw * 0.25)],
      [0, roofTopY(0)],
    ];
    const loop = half.map((p) => V(p[0], p[1], z));
    for (let k = half.length - 2; k >= 1; k--) loop.push(V(-half[k][0], half[k][1], z));
    profiles.push(loop);
  }
  const N2 = profiles.length - 1;
  const g = loft(profiles, { closed: true });
  orientOutwardFn(g, (p) => V(p.x, p.y - 2.345, 0));
  metricUV(g, (p) => [p.x, p.z]);
  auxVertices(g, (p) => {
    if (p.y > yb + 0.03) return [0.35, 0, 1, 0];
    const inside =
      p.z > L.houseBack &&
      p.z < L.houseFront &&
      Math.abs(p.x) < wallX(L, Math.min(Math.max(p.z, L.houseBack), L.houseFront), yb) - HOUSE.wallT;
    return [0.35, 0, inside ? 3 : 0, 0];
  });
  kit.add('gelcoat', g, { color: PALETTE.gelcoat });
  kit.add('gelcoat', fanCap(profiles[0], V(0, 0, -1)), { color: PALETTE.gelcoat, rough: 0.3 });
  kit.add('gelcoat', fanCap(profiles[N2], V(0, 0, 1)), { color: PALETTE.gelcoat, rough: 0.3 });

  for (const s of [1, -1]) {
    const x = s * 1.1;
    const y = roofTopY(1.1) + 0.07;
    kit.add('fittings', rod(V(x, y, -0.7), V(x, y, 0.95), 0.013, 8), STAINLESS);
    for (const z of [-0.7, -0.12, 0.45, 0.95]) {
      kit.add('fittings', rod(V(x, roofTopY(1.1) - 0.01, z), V(x, y, z), 0.011, 6), STAINLESS);
    }
  }
}

function panelFrame() {
  const d = HOUSE.dash;
  const B = new THREE.Vector2(d.zFace, d.yKnee);
  const C = new THREE.Vector2(d.zTop, d.yTop);
  const dir = C.clone().sub(B).normalize();
  const along = V(0, dir.y, dir.x);
  const normal = V(0, dir.x, -dir.y);
  const at = (x, f) => V(x, lerp(B.y, C.y, f), lerp(B.x, C.x, f));
  return { along, normal, at, length: B.distanceTo(C), angle: Math.atan2(dir.x, dir.y) };
}

function buildConsole(kit, L, parts) {
  const d = HOUSE.dash;
  const corners = [[d.zFace, L.deckY], [d.zFace, d.yKnee], [d.zTop, d.yTop], [d.zBack, d.yTop], [d.zBack, L.deckY]];
  const outline = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let k = 0; k < 6; k++) outline.push([lerp(a[0], b[0], k / 6), lerp(a[1], b[1], k / 6)]);
  }
  const endX = (z, y) => Math.min(d.halfW, L.halfBreadth(L.tAtSheerZ(z), Math.min(y, L.sheerY(L.tAtSheerZ(z)))) - L.shell - 0.004);
  const body = slab(outline, [], (u, v, side) => V((side ? -1 : 1) * endX(u, v), v, u));
  auxVertices(body, () => [0.5, 0, 2, 0]);
  kit.add('gelcoat', body, { color: PALETTE.gelcoat });

  const top = box(d.halfW * 2 - 0.01, 0.01, d.zBack - d.zTop);
  top.translate(0, d.yTop + 0.005, (d.zBack + d.zTop) / 2);
  kit.add('gelcoat', top, { color: 0x2a2c2f, rough: 0.85 });

  const pf = panelFrame();
  const panel = box(d.halfW * 2 - 0.04, pf.length - 0.02, 0.012);
  panel.applyMatrix4(mat4(0, 0, 0, pf.angle, 0, 0));
  const panelPos = pf.at(0, 0.5).addScaledVector(pf.normal, 0.004);
  panel.translate(panelPos.x, panelPos.y, panelPos.z);
  kit.add('fittings', panel, { color: 0x1d1f22, rough: 0.7, pattern: 4 });

  const fr = box(d.halfW * 2 - 0.02, 0.03, 0.022);
  fr.translate(0, d.yTop + 0.02, d.zTop + 0.011);
  kit.add('wood', fr, { rough: 0.3 });

  for (const [x, f] of [[-0.76, 0.72], [-0.34, 0.72], [-0.55, 0.9], [-0.12, 0.5], [0.02, 0.5]]) {
    const c = pf.at(x, f).addScaledVector(pf.normal, 0.012);
    const m = new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(c);
    const bezel = torus(0.043, 0.006, 4, 16);
    bezel.applyMatrix4(m);
    kit.add('fittings', bezel, STAINLESS);
    const dial = new THREE.CircleGeometry(0.042, 20);
    dial.applyMatrix4(new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(c.clone().addScaledVector(pf.normal, 0.001)));
    kit.add('glow', dial, { color: 0xffffff, rough: 0.2, pattern: 3 });
  }

  const sw = pf.at(0.55, 0.45).addScaledVector(pf.normal, 0.012);
  const swm = new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(sw);
  const swPlate = box(0.34, 0.1, 0.008);
  swPlate.applyMatrix4(swm);
  kit.add('fittings', swPlate, { color: 0x2d3036, rough: 0.5, pattern: 4 });
  const tape = box(0.3, 0.014, 0.002);
  tape.applyMatrix4(new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(sw.clone().addScaledVector(pf.along, -0.038).addScaledVector(pf.normal, 0.005)));
  kit.add('fittings', tape, { color: 0xffffff, rough: 0.5, pattern: 8 });
  for (let i = 0; i < 6; i++) {
    const r = box(0.03, 0.045, 0.015);
    r.applyMatrix4(new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(sw.clone().add(V(-0.13 + i * 0.052, 0, 0)).addScaledVector(pf.normal, 0.008)));
    kit.add('fittings', r, { color: 0x111214, rough: 0.4 });
    const led = box(0.008, 0.008, 0.004);
    led.applyMatrix4(new THREE.Matrix4().makeBasis(V(-1, 0, 0), pf.along, pf.normal).setPosition(sw.clone().add(V(-0.13 + i * 0.052, 0, 0)).addScaledVector(pf.along, 0.035).addScaledVector(pf.normal, 0.006)));
    kit.add('glow', led, { color: i % 3 === 0 ? 0x33ff66 : 0xff5522, rough: 0.3, pattern: 6 });
  }

  const hub = pf.at(HOUSE.helmX, 0.45);
  const center = hub.clone().addScaledVector(pf.normal, 0.14);
  kit.add('fittings', rod(hub.clone().addScaledVector(pf.normal, -0.01), center.clone().addScaledVector(pf.normal, -0.03), 0.02, 10), STAINLESS);
  const helmBoss = cylinder(0.05, 0.055, 0.025, 16);
  helmBoss.applyMatrix4(alignY(hub.clone().addScaledVector(pf.normal, 0.008), pf.normal));
  kit.add('fittings', helmBoss, { color: 0x2b2d30, rough: 0.5 });
  parts.wheelCenter = center;
  parts.wheelAxis = pf.normal.clone().negate();

  const tx = -0.93;
  const tz = 1.24;
  const tb = roundedBox(0.1, 0.075, 0.15, 0.015, 1);
  tb.translate(tx, d.yTop + 0.01 + 0.0375, tz);
  kit.add('fittings', tb, BLACK_PLASTIC);
  const tp = box(0.085, 0.004, 0.13);
  tp.translate(tx, d.yTop + 0.01 + 0.077, tz);
  kit.add('fittings', tp, STAINLESS);
  parts.throttlePivot = V(tx, d.yTop + 0.09, tz);

  const cx = HOUSE.helmX;
  const cz = 1.3;
  const cb = lathe([[0, 0], [0.07, 0], [0.072, 0.02], [0.062, 0.045], [0, 0.045]], 20);
  cb.translate(cx, d.yTop + 0.01, cz);
  kit.add('fittings', cb, BLACK_PLASTIC);
  const card = cylinder(0.05, 0.05, 0.01, 20);
  card.translate(cx, d.yTop + 0.06, cz);
  kit.add('fittings', card, { color: 0x2c2c2a, rough: 0.5 });
  const lubber = box(0.004, 0.02, 0.008);
  lubber.translate(cx, d.yTop + 0.07, cz + 0.045);
  kit.add('fittings', lubber, { color: 0xd0402a, rough: 0.5 });
  const dome = sphere(0.058, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(cx, d.yTop + 0.053, cz);
  kit.add('glass', dome);

  for (const [x, mode] of [[-0.06, 1], [0.38, 2]]) {
    const tilt = 0.3;
    const w = 0.36;
    const h = 0.27;
    const bodyM = mat4(x, d.yTop + 0.01 + h / 2 + 0.03, 1.29, tilt, 0, 0);
    const bGeo = roundedBox(w, h, 0.07, 0.018, 1);
    bGeo.applyMatrix4(bodyM);
    kit.add('fittings', bGeo, BLACK_PLASTIC);
    const mount = box(0.1, 0.05, 0.08);
    mount.translate(x, d.yTop + 0.035, 1.3);
    kit.add('fittings', mount, BLACK_PLASTIC);
    const screen = new THREE.PlaneGeometry(w - 0.05, h - 0.06);
    screen.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    screen.applyMatrix4(mat4(0, 0.012, -0.037));
    screen.applyMatrix4(bodyM);
    const uv = screen.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    kit.add('glow', screen, { color: 0xffffff, rough: 0.15, pattern: mode });
  }

  const oz = 1.02;
  const oy = HOUSE.roofUnderY - 0.07;
  const oc = roundedBox(0.9, 0.13, 0.3, 0.02, 1);
  oc.applyMatrix4(mat4(-0.15, oy, oz, -0.25, 0, 0));
  kit.add('fittings', oc, { color: 0x24262a, rough: 0.6 });
  const face = mat4(-0.15, oy, oz, -0.25, 0, 0);
  const vhf = box(0.2, 0.06, 0.02);
  vhf.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.18, 0, -0.155));
  vhf.applyMatrix4(face);
  kit.add('fittings', vhf, { color: 0x111214, rough: 0.4 });
  const lcd = new THREE.PlaneGeometry(0.09, 0.03);
  lcd.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
  lcd.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.2, 0.005, -0.168));
  lcd.applyMatrix4(face);
  kit.add('glow', lcd, { color: 0x7dff9a, rough: 0.2, pattern: 6 });
  for (const k of [-0.06, 0.1, 0.26]) {
    const knob = cylinder(0.012, 0.012, 0.02, 10);
    knob.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    knob.applyMatrix4(new THREE.Matrix4().makeTranslation(k, 0, -0.16));
    knob.applyMatrix4(face);
    kit.add('fittings', knob, STAINLESS);
  }

  const mic = roundedBox(0.05, 0.08, 0.03, 0.01, 1);
  mic.translate(-0.02, oy - 0.2, oz - 0.12);
  kit.add('fittings', mic, BLACK_PLASTIC);
  kit.add('fittings', tube([V(-0.05, oy - 0.04, oz - 0.15), V(-0.08, oy - 0.1, oz - 0.14), V(-0.04, oy - 0.14, oz - 0.13), V(-0.02, oy - 0.16, oz - 0.12)], 0.004, 16, 4), BLACK_PLASTIC);

  const dl = cylinder(0.08, 0.085, 0.012, 20);
  dl.translate(0, HOUSE.roofUnderY - 0.006, 0.42);
  kit.add('glow', dl, { color: 0xffe6b8, rough: 0.4, pattern: 5 });

  const door = box(0.5, 0.62, 0.01);
  door.translate(0.55, 0.72, d.zFace - 0.004);
  kit.add('fittings', door, { color: 0x121315, rough: 0.9 });
  for (const [w, h, x, y] of [[0.56, 0.03, 0.55, 1.045], [0.56, 0.03, 0.55, 0.395], [0.03, 0.68, 0.285, 0.72], [0.03, 0.68, 0.815, 0.72]]) {
    const b = box(w, h, 0.022);
    b.translate(x, y, d.zFace - 0.011);
    kit.add('wood', b, { rough: 0.3 });
  }
}

function buildSeating(kit, L) {
  const x = HOUSE.helmX;
  const z = HOUSE.seatZ;
  const y0 = L.deckY;
  const baseP = cylinder(0.18, 0.19, 0.012, 20);
  baseP.translate(x, y0 + 0.006, z);
  kit.add('fittings', baseP, STAINLESS);
  kit.add('fittings', rod(V(x, y0, z), V(x, 0.92, z), 0.042, 14), STAINLESS);
  const ring = torus(0.17, 0.011, 6, 28);
  ring.applyMatrix4(mat4(x, 0.62, z, Math.PI / 2, 0, 0));
  kit.add('fittings', ring, STAINLESS);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.5;
    kit.add('fittings', rod(V(x + Math.cos(a) * 0.04, 0.62, z + Math.sin(a) * 0.04), V(x + Math.cos(a) * 0.165, 0.62, z + Math.sin(a) * 0.165), 0.008, 6), STAINLESS);
  }
  const pan = roundedBox(0.44, 0.045, 0.4, 0.015, 1);
  pan.translate(x, 0.94, z);
  kit.add('fittings', pan, { color: 0x2b2e33, rough: 0.5 });
  const cushion = roundedBox(0.46, 0.085, 0.42, 0.035, 1);
  cushion.translate(x, 1.0, z);
  kit.add('fittings', cushion, VINYL);
  const back = roundedBox(0.44, 0.3, 0.075, 0.03, 1);
  back.applyMatrix4(mat4(x, 1.22, z - 0.2, -0.17, 0, 0));
  kit.add('fittings', back, VINYL);
  kit.add('fittings', rod(V(x, 0.96, z - 0.17), V(x, 1.12, z - 0.2), 0.018, 8), STAINLESS);

  const bench = roundedBox(0.42, 0.4, 0.75, 0.02, 1);
  bench.translate(0.86, y0 + 0.2, 0.45);
  kit.add('gelcoat', bench, { color: PALETTE.gelcoat, rough: 0.35 });
  const bc = roundedBox(0.42, 0.07, 0.73, 0.03, 1);
  bc.translate(0.86, y0 + 0.435, 0.45);
  kit.add('fittings', bc, VINYL);
}

function wallIn(L, s, z, y) {
  return s * (wallX(L, z, y) - HOUSE.wallT);
}

function orientTowardsAxis(g) {
  const idx = Array.from(g.index.array);
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.setIndex(idx);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

function buildCabinDetail(kit, L) {
  const d = HOUSE.dash;
  const y0 = L.deckY;
  const yb = HOUSE.roofUnderY;
  const hullIn = (z) => Math.min(houseHalfWidth(L, z) - HOUSE.wallT, L.halfBreadth(L.tAtSheerZ(z), y0) - L.shell) - 0.015;

  const soleOut = [];
  const zA = L.houseBack - 0.02;
  const zB = d.zFace - 0.005;
  for (let i = 0; i <= 6; i++) {
    const z = lerp(zA, zB, i / 6);
    soleOut.push([z, -hullIn(z)]);
  }
  for (let i = 6; i >= 0; i--) {
    const z = lerp(zA, zB, i / 6);
    soleOut.push([z, hullIn(z)]);
  }
  const sole = slab(soleOut, [], (u, v, side) => V(v, y0 + 0.009 - side * 0.009, u), { back: false });
  kit.add('wood', sole, { rough: 0.5, pattern: 2 });

  for (const z of [-0.22, 0.26, 0.74]) {
    const w = 2 * (wallX(L, z, yb) - HOUSE.wallT) - 0.02;
    const b = box(0.045, 0.016, w);
    b.applyMatrix4(mat4(0, yb - 0.008, z, 0, Math.PI / 2, 0));
    kit.add('wood', b, { rough: 0.35 });
  }
  const gy = yb - 0.06;
  kit.add('wood', rod(V(-0.32, gy, -0.2), V(-0.32, gy, 0.9), 0.016, 10), { rough: 0.35 });
  for (const z of [-0.12, 0.35, 0.82]) {
    kit.add('fittings', rod(V(-0.32, gy, z), V(-0.32, yb - 0.004, z), 0.011, 8), STAINLESS);
  }

  for (const z of [-0.3, 0.35, 0.95]) {
    const br = box(0.36, 0.012, 0.03);
    br.translate(0.64, yb - 0.08, z);
    kit.add('fittings', br, BLACK_PLASTIC);
    for (const x of [0.48, 0.8]) kit.add('fittings', rod(V(x, yb - 0.08, z), V(x, yb - 0.002, z), 0.005, 6), STAINLESS);
  }
  for (const [i, x] of [0.54, 0.64, 0.74].entries()) {
    const y = yb - 0.066;
    const z0 = -0.42 + i * 0.05;
    const z1 = 1.12;
    kit.add('fittings', rod(V(x, y, z0), V(x, y, z1), 0.007, 6, 0.0025), { color: [0x1b1c1e, 0x2a3a52, 0x4a1f1a][i], rough: 0.3 });
    kit.add('fittings', rod(V(x, y, z0), V(x, y, z0 + 0.24), 0.013, 8), { color: 0xb48a5c, rough: 0.85 });
    const reel = cylinder(0.034, 0.034, 0.03, 12);
    reel.applyMatrix4(mat4(x, y - 0.045, z0 + 0.3, 0, 0, Math.PI / 2));
    kit.add('fittings', reel, { color: [0x8a8d91, 0xb89040, 0x2b2d30][i], rough: 0.3, metal: 1 });
    kit.add('fittings', rod(V(x, y - 0.012, z0 + 0.3), V(x, y - 0.03, z0 + 0.3), 0.004, 5), { color: 0x2b2d30, rough: 0.4 });
  }

  {
    const z = 0.56;
    const y = 1.33;
    const x = wallIn(L, 1, z, y);
    const pnl = box(0.014, 0.22, 0.34);
    pnl.translate(x - 0.007, y, z);
    kit.add('fittings', pnl, { color: 0x3a3d42, rough: 0.5, pattern: 4 });
    for (let r = 0; r < 2; r++) {
      const ry = y + 0.045 - r * 0.1;
      const lt = box(0.002, 0.014, 0.3);
      lt.translate(x - 0.015, ry + 0.035, z);
      kit.add('fittings', lt, { color: 0xffffff, rough: 0.5, pattern: 8 });
      for (let k = 0; k < 8; k++) {
        const bk = box(0.016, 0.034, 0.02);
        bk.translate(x - 0.021, ry, z - 0.135 + k * 0.0386);
        kit.add('fittings', bk, { color: 0x121314, rough: 0.4 });
        const tog = box(0.012, 0.012, 0.008);
        tog.translate(x - 0.034, ry + ((k * 7 + r * 3) % 5 === 0 ? -0.007 : 0.007), z - 0.135 + k * 0.0386);
        kit.add('fittings', tog, { color: (k * 7 + r * 3) % 5 === 0 ? 0xb02a22 : 0x1e1f21, rough: 0.4 });
      }
    }
  }

  const hang = (z, yTop, color, scale) => {
    const x = wallIn(L, 1, z, yTop);
    kit.add('fittings', rod(V(x, yTop + 0.02, z), V(x - 0.05, yTop + 0.04, z), 0.006, 6), STAINLESS);
    const prof = [[0.17, 0.0], [0.2, 0.03], [0.2, 0.3], [0.21, 0.5], [0.2, 0.56], [0.12, 0.62], [0.05, 0.66], [0.001, 0.665]];
    const g = lathe(prof.map(([r, h]) => [r * scale, h * scale]), 20);
    g.applyMatrix4(mat4(x - 0.06, yTop - 0.66 * scale, z, 0, 0, 0, 0.3, 1, 1));
    kit.add('fittings', g, { color, rough: 0.6, pattern: 9 });
    for (const sd of [-1, 1]) {
      const sh = V(x - 0.07, yTop - 0.12 * scale, z + sd * 0.17 * scale);
      const sleeve = tube([sh, V(x - 0.1, yTop - 0.3 * scale, z + sd * 0.2 * scale), V(x - 0.11, yTop - 0.52 * scale, z + sd * 0.16 * scale)], 0.045 * scale, 10, 8);
      kit.add('fittings', sleeve, { color, rough: 0.6, pattern: 9 });
    }
    const hood = sphere(0.1 * scale, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
    hood.applyMatrix4(mat4(x - 0.04, yTop - 0.03, z, 0.5, 0, 0, 0.5, 0.8, 1));
    kit.add('fittings', hood, { color: new THREE.Color(color).multiplyScalar(0.85).getHex(), rough: 0.6, pattern: 9 });
  };
  hang(-0.12, 1.92, 0xe0a81c, 1.0);
  hang(0.14, 1.9, 0xe2531a, 0.8);

  {
    const z = -0.18;
    const yb0 = y0 + 0.2;
    const x = wallIn(L, -1, z, 0.8);
    const ex = x + 0.075;
    const body = lathe([[0, 0], [0.058, 0.0], [0.062, 0.02], [0.062, 0.3], [0.05, 0.35], [0.018, 0.37], [0, 0.37]], 18);
    body.translate(ex, yb0, z);
    kit.add('fittings', body, { color: 0xb3150f, rough: 0.35 });
    const valve = box(0.03, 0.05, 0.05);
    valve.translate(ex, yb0 + 0.39, z);
    kit.add('fittings', valve, { color: 0x1a1a1a, rough: 0.4 });
    kit.add('fittings', rod(V(ex, yb0 + 0.41, z), V(ex + 0.02, yb0 + 0.42, z + 0.09), 0.007, 6), { color: 0x8c8f93, rough: 0.3, metal: 1 });
    kit.add('fittings', tube([V(ex, yb0 + 0.38, z + 0.02), V(ex + 0.03, yb0 + 0.3, z + 0.07), V(ex + 0.05, yb0 + 0.15, z + 0.06), V(ex + 0.06, yb0 + 0.08, z + 0.03)], 0.008, 12, 5), { color: 0x141414, rough: 0.6 });
    for (const h of [0.12, 0.26]) {
      const strap = torus(0.064, 0.004, 4, 20);
      strap.applyMatrix4(mat4(ex, yb0 + h, z, Math.PI / 2, 0, 0));
      kit.add('fittings', strap, STAINLESS);
    }
    const plate = box(0.006, 0.3, 0.07);
    plate.translate(x + 0.003, yb0 + 0.19, z);
    kit.add('fittings', plate, STAINLESS);
    const lab = cylinder(0.0625, 0.0625, 0.1, 18, 1, true, -0.9, 1.8);
    lab.translate(ex, yb0 + 0.19, z);
    kit.add('fittings', lab, { color: 0xffffff, rough: 0.5, pattern: 8 });
  }

  const onWall = (s, z, y, w, h, roll, opts) => {
    const q = new THREE.PlaneGeometry(w, h);
    q.applyMatrix4(mat4(0, 0, 0, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
    q.applyMatrix4(new THREE.Matrix4().makeRotationX(roll));
    q.translate(0, y, z);
    const pos = q.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, wallIn(L, s, pos.getZ(i), pos.getY(i)) - s * 0.012);
    pos.needsUpdate = true;
    q.computeVertexNormals();
    kit.add('fittings', q, opts);
  };
  onWall(-1, 0.02, 1.47, 0.1, 0.13, 0.06, { color: 0xffffff, rough: 0.3, pattern: 7, anim: 0.15 });
  onWall(-1, 0.15, 1.42, 0.12, 0.09, -0.1, { color: 0xffffff, rough: 0.3, pattern: 7, anim: 0.7 });
  onWall(-1, 0.36, 1.36, 0.19, 0.25, 0.02, { color: 0xffffff, rough: 0.9, pattern: 5 });
  for (const [dz, dy] of [[-0.09, 0.12], [0.09, 0.12]]) {
    onWall(-1, 0.36 + dz, 1.36 + dy, 0.05, 0.018, 0.5, { color: 0xd8cfa8, rough: 0.8 });
  }

  {
    const z = 0.85;
    const y = 1.3;
    const x = wallIn(L, -1, z, y) + 0.035;
    kit.add('fittings', rod(V(x, y, z - 0.1), V(x, y, z + 0.1), 0.02, 12), { color: 0xf2c21b, rough: 0.45 });
    kit.add('fittings', rod(V(x, y, z + 0.1), V(x, y, z + 0.13), 0.026, 12), { color: 0x1a1a1a, rough: 0.4 });
    for (const dz of [-0.06, 0.05]) {
      const clip = torus(0.023, 0.003, 4, 12, Math.PI * 1.3);
      clip.applyMatrix4(mat4(x, y, z + dz, 0, Math.PI / 2, -0.65));
      kit.add('fittings', clip, BLACK_PLASTIC);
    }
  }

  {
    const ytop = d.yTop + 0.01;
    const m = mat4(0.74, ytop + 0.004, 1.26, 0, 0.18, 0);
    const board = box(0.23, 0.005, 0.31);
    board.applyMatrix4(m);
    kit.add('fittings', board, { color: 0x6b4a2b, rough: 0.7 });
    const paper = new THREE.PlaneGeometry(0.21, 0.28);
    paper.applyMatrix4(mat4(0, 0.0035, 0.012, -Math.PI / 2, 0, 0));
    paper.applyMatrix4(m);
    kit.add('fittings', paper, { color: 0xffffff, rough: 0.9, pattern: 5 });
    const clip = box(0.08, 0.014, 0.03);
    clip.applyMatrix4(mat4(0, 0.008, 0.14));
    clip.applyMatrix4(m);
    kit.add('fittings', clip, STAINLESS);

    const mx = -0.76;
    const mz = 1.34;
    const holder = torus(0.05, 0.006, 6, 18);
    holder.applyMatrix4(mat4(mx, ytop + 0.035, mz, Math.PI / 2, 0, 0));
    kit.add('fittings', holder, BLACK_PLASTIC);
    const mug = cylinder(0.042, 0.038, 0.095, 18, 1, true);
    mug.translate(mx, ytop + 0.048, mz);
    kit.add('fittings', mug, { color: 0x1f4a3a, rough: 0.25 });
    const inner = cylinder(0.039, 0.036, 0.09, 18, 1, true);
    inner.translate(mx, ytop + 0.05, mz);
    orientTowardsAxis(inner);
    kit.add('fittings', inner, { color: 0xe9e4d8, rough: 0.25 });
    const coffee = new THREE.CircleGeometry(0.039, 18);
    coffee.applyMatrix4(mat4(mx, ytop + 0.082, mz, -Math.PI / 2, 0, 0));
    kit.add('fittings', coffee, { color: 0x2a160b, rough: 0.1 });
    const base = new THREE.CircleGeometry(0.038, 18);
    base.applyMatrix4(mat4(mx, ytop + 0.0005, mz, Math.PI / 2, 0, 0));
    kit.add('fittings', base, { color: 0x1f4a3a, rough: 0.4 });
    const handle = torus(0.026, 0.006, 6, 12, Math.PI);
    handle.applyMatrix4(mat4(mx - 0.042, ytop + 0.048, mz, 0, 0, Math.PI / 2));
    kit.add('fittings', handle, { color: 0x1f4a3a, rough: 0.25 });
  }

  {
    const top = y0 + 0.47;
    for (const [i, dy] of [0, 0.05].entries()) {
      const v = roundedBox(0.34, 0.05, 0.4, 0.02, 1);
      v.applyMatrix4(mat4(0.86, top + 0.025 + dy, 0.28 + i * 0.02, 0, 0.12 * i - 0.05, 0));
      kit.add('fittings', v, { color: 0xe2531a, rough: 0.6, pattern: 9 });
      for (const dz of [-0.08, 0.08]) {
        const st = box(0.345, 0.052, 0.025);
        st.applyMatrix4(mat4(0.86, top + 0.025 + dy, 0.28 + i * 0.02 + dz, 0, 0.12 * i - 0.05, 0));
        kit.add('fittings', st, { color: 0x151515, rough: 0.7 });
      }
    }
    const chart = new THREE.PlaneGeometry(0.3, 0.22);
    chart.applyMatrix4(mat4(0.85, top + 0.002, 0.64, -Math.PI / 2, 0, 0.3));
    kit.add('fittings', chart, { color: 0xffffff, rough: 0.85, pattern: 6 });

    for (let k = 0; k < 5; k++) {
      const loop = torus(0.15 - k * 0.004, 0.011, 6, 28);
      loop.applyMatrix4(mat4(0.62 + k * 0.004, y0 + 0.02 + k * 0.02, -0.14 + k * 0.006, Math.PI / 2 + (k % 2) * 0.06, 0, 0));
      const uv = loop.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 0.94, uv.getY(j));
      kit.add('fittings', loop, { color: 0x2c5a8c, rough: 0.8, pattern: 1 });
    }
  }
}

function buildRoofGear(kit, L, parts) {
  const yr = roofTopY(0);
  const mz = -0.5;

  const mb = box(0.18, 0.025, 0.18);
  mb.translate(0, yr + 0.005, mz);
  kit.add('fittings', mb, WHITE_PAINT);
  kit.add('fittings', rod(V(0, yr, mz), V(0, 3.9, mz), 0.042, 14, 0.03), WHITE_PAINT);

  const ry = 3.02;
  const arm = box(0.1, 0.035, 0.34);
  arm.translate(0, ry - 0.02, mz + 0.19);
  kit.add('fittings', arm, WHITE_PAINT);
  const plate = box(0.34, 0.015, 0.34);
  plate.translate(0, ry, mz + 0.3);
  kit.add('fittings', plate, WHITE_PAINT);
  kit.add('fittings', rod(V(0, ry - 0.02, mz + 0.04), V(0, ry - 0.2, mz + 0.01), 0.012, 6), WHITE_PAINT);
  const radome = lathe([[0, 0], [0.285, 0], [0.3, 0.018], [0.3, 0.095], [0.29, 0.14], [0.245, 0.188], [0.16, 0.222], [0.07, 0.234], [0, 0.236]], 24);
  radome.translate(0, ry + 0.008, mz + 0.3);
  kit.add('fittings', radome, { color: 0xf3f2ee, rough: 0.4 });
  const band = cylinder(0.302, 0.302, 0.02, 24, 1, true);
  band.translate(0, ry + 0.03, mz + 0.3);
  kit.add('fittings', band, { color: 0x3a3d42, rough: 0.5 });

  const sy = 3.45;
  const spreader = box(0.78, 0.03, 0.045);
  spreader.translate(0, sy - 0.05, mz);
  kit.add('fittings', spreader, WHITE_PAINT);
  for (const s of [1, -1]) {
    const hx = s * 0.4;
    const housing = box(0.055, 0.07, 0.11);
    housing.translate(hx, sy, mz + 0.02);
    kit.add('fittings', housing, BLACK_PLASTIC);
    const lens = box(0.014, 0.05, 0.085);
    lens.translate(hx + s * 0.033, sy, mz + 0.03);
    kit.add('glow', lens, { color: s > 0 ? 0xff1a0e : 0x14ff5a, rough: 0.2, pattern: 0 });
    const scr = box(0.004, 0.07, 0.12);
    scr.translate(hx - s * 0.03, sy, mz + 0.02);
    kit.add('fittings', scr, BLACK_PLASTIC);
  }

  const mhBase = cylinder(0.036, 0.036, 0.03, 12);
  mhBase.translate(0, 3.915, mz);
  kit.add('fittings', mhBase, BLACK_PLASTIC);
  const mhLens = cylinder(0.03, 0.03, 0.065, 12);
  mhLens.translate(0, 3.962, mz);
  kit.add('glow', mhLens, { color: 0xfff3dc, rough: 0.2, pattern: 0 });
  const mhCap = cylinder(0.034, 0.038, 0.016, 12);
  mhCap.translate(0, 4.003, mz);
  kit.add('fittings', mhCap, BLACK_PLASTIC);

  for (const s of [1, -1]) {
    const x = s * 1.02;
    const z = -0.78;
    const y = roofTopY(1.02);
    const mount = roundedBox(0.06, 0.07, 0.06, 0.01, 1);
    mount.translate(x, y + 0.035, z);
    kit.add('fittings', mount, STAINLESS);
    const len = s > 0 ? 2.4 : 1.2;
    const whip = cylinder(0.005, 0.013, len, 8, 10);
    whip.translate(x, y + 0.07 + len / 2, z);
    auxVertices(whip, (p) => [0.3, 0, 3, Math.max(0, (p.y - y - 0.07) / len)]);
    kit.add('fittings', whip, { color: 0xf4f4f1 });
  }

  const pz = 0.8;
  const ped = roundedBox(0.26, 0.28, 0.3, 0.03, 1);
  ped.translate(0, yr + 0.14, pz);
  kit.add('fittings', ped, { color: 0xf3f2ee, rough: 0.4 });
  parts.radarPivot = V(0, yr + 0.3, pz);

  const sx = 0.42;
  const szz = 1.05;
  const syy = roofTopY(0.42);
  kit.add('fittings', rod(V(sx, syy, szz), V(sx, syy + 0.1, szz), 0.03, 10), BLACK_PLASTIC);
  const head = cylinder(0.065, 0.06, 0.15, 16);
  head.applyMatrix4(mat4(sx, syy + 0.17, szz, Math.PI / 2, 0, 0));
  kit.add('fittings', head, STAINLESS);
  const sl = new THREE.CircleGeometry(0.058, 16);
  sl.translate(sx, syy + 0.17, szz + 0.0755);
  kit.add('glow', sl, { color: 0xfff1d6, rough: 0.2, pattern: 4 });
  const horn = lathe([[0.0, 0], [0.018, 0.0], [0.016, 0.1], [0.024, 0.17], [0.05, 0.22], [0.046, 0.222], [0.0, 0.2]], 16);
  horn.applyMatrix4(mat4(-sx, roofTopY(0.42) + 0.07, szz - 0.12, Math.PI / 2, 0, 0));
  kit.add('fittings', horn, STAINLESS);
  kit.add('fittings', rod(V(-sx, roofTopY(0.42), szz), V(-sx, roofTopY(0.42) + 0.07, szz), 0.012, 6), STAINLESS);

  const bx = 0.62;
  const bz = -0.72;
  const bracket = box(0.12, 0.03, 0.12);
  bracket.translate(bx, roofTopY(bx) + 0.015, bz);
  kit.add('fittings', bracket, STAINLESS);
  for (const [g, opts] of buoyGeometry()) {
    g.translate(bx, roofTopY(bx) + 0.03, bz);
    kit.add('fittings', g, opts);
  }

  for (const s of [1, -1]) {
    const fl = roundedBox(0.13, 0.07, 0.08, 0.01, 1);
    fl.translate(s * 0.55, HOUSE.roofUnderY - 0.035, HOUSE.roofZ0 + 0.14);
    kit.add('fittings', fl, BLACK_PLASTIC);
    const lens = new THREE.PlaneGeometry(0.11, 0.06);
    lens.applyMatrix4(mat4(s * 0.55, HOUSE.roofUnderY - 0.071, HOUSE.roofZ0 + 0.14, Math.PI / 2 + 0.35, 0, 0));
    kit.add('glow', lens, { color: 0xfff1d6, rough: 0.2, pattern: 4 });
  }

  const lx = wallX(L, -0.02, 1.72) + 0.05;
  const ringG = torus(0.235, 0.05, 8, 24);
  ringG.applyMatrix4(mat4(lx, 1.72, -0.02, 0, Math.PI / 2, 0));
  paintVertices(ringG, (p) => {
    const a = Math.atan2(p.y - 1.72, p.z + 0.02);
    return Math.abs((((a / (Math.PI / 2)) % 1) + 1) % 1 - 0.5) > 0.4 ? 0xf2f0ea : 0xf25a12;
  });
  kit.add('fittings', ringG, { rough: 0.6 });
  const hook = box(0.03, 0.05, 0.08);
  hook.translate(lx - 0.03, 1.72 + 0.26, -0.02);
  kit.add('fittings', hook, STAINLESS);
}

function buildWheelhouse(kit, L, parts) {
  buildWalls(kit, L);
  buildWindshield(kit, L);
  buildRoof(kit, L);
  buildConsole(kit, L, parts);
  buildSeating(kit, L);
  buildCabinDetail(kit, L);
  buildRoofGear(kit, L, parts);
}

function wheelGeometry() {
  const list = [];
  const wood = { rough: 0.3, metal: 0 };
  const R = 0.2;
  list.push(prepare(torus(R, 0.017, 8, 40), { ...wood, color: 0xe8b898 }));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const dir = V(Math.cos(a), Math.sin(a), 0);
    const spoke = cylinder(0.009, 0.013, R - 0.05, 8);
    spoke.applyMatrix4(alignY(dir.clone().multiplyScalar(0.05 + (R - 0.05) / 2), dir));
    list.push(prepare(spoke, { ...wood, color: 0xe8b898 }));
    const handle = lathe([[0.0, 0], [0.011, 0.0], [0.013, 0.02], [0.017, 0.045], [0.012, 0.06], [0.01, 0.07], [0.015, 0.078], [0.0, 0.086]], 8);
    handle.applyMatrix4(alignY(dir.clone().multiplyScalar(R - 0.005), dir));
    list.push(prepare(handle, { ...wood, color: 0xe8b898 }));
  }
  const hub = lathe([[0, -0.03], [0.05, -0.03], [0.058, -0.012], [0.058, 0.012], [0.05, 0.028], [0.0, 0.03]], 20);
  hub.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  list.push(prepare(hub, { ...wood, color: 0xe8b898 }));
  const cap = sphere(0.032, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  cap.translate(0, 0, -0.028);
  list.push(prepare(cap, { color: 0xc8a050, rough: 0.25, metal: 1, pattern: 1 }));
  return mergePrepared(list);
}

function throttleGeometry() {
  const list = [];
  list.push(prepare(rod(V(0, -0.01, 0), V(0, 0.15, 0.015), 0.008, 8), STAINLESS));
  const knob = sphere(0.022, 14, 10);
  knob.scale(1, 1.15, 1);
  knob.translate(0, 0.165, 0.016);
  list.push(prepare(knob, BLACK_PLASTIC));
  const boss = cylinder(0.02, 0.02, 0.05, 12);
  boss.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  list.push(prepare(boss, STAINLESS));
  return mergePrepared(list);
}

function radarArrayGeometry() {
  const list = [];
  list.push(prepare(cylinder(0.05, 0.06, 0.06, 14), { color: 0xf3f2ee, rough: 0.4 }));
  const bar = roundedBox(1.05, 0.12, 0.1, 0.035, 2);
  bar.translate(0, 0.09, 0);
  list.push(prepare(bar, { color: 0xf3f2ee, rough: 0.4 }));
  const stripe = box(0.95, 0.028, 0.004);
  stripe.translate(0, 0.09, 0.051);
  list.push(prepare(stripe, { color: 0x2c2f35, rough: 0.5 }));
  return mergePrepared(list);
}

// ============================================================================
// 6. Running — hélice de bronze de 4 pás e leme NACA 0014
// ============================================================================

const PROP = { position: V(0, -0.53, -3.3), radius: 0.21, blades: 4, pitch: 0.42 };
const RUDDER = { pivot: V(0, -0.52, -3.58), top: -0.33, bottom: -0.72, lead: 0.08, trail: -0.27, maxAngle: 0.61 };
const BRONZE = { color: 0xc8905a, rough: 0.3, metal: 1 };

function propellerGeometry() {
  const { radius: R, blades, pitch: P } = PROP;
  const list = [];

  const hub = lathe([[0, -0.09], [0.015, -0.085], [0.03, -0.068], [0.043, -0.04], [0.048, 0.0], [0.047, 0.04], [0.042, 0.06], [0, 0.06]], 18);
  hub.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  list.push(prepare(hub, BRONZE));

  const rh = 0.042;
  const NR = 9;
  const NC = 9;
  for (let b = 0; b < blades; b++) {
    const theta0 = (b * Math.PI * 2) / blades;
    const mid = [];
    for (let i = 0; i < NR; i++) {
      const rho = i / (NR - 1);
      const r = rh + (R - rh) * rho;
      const chord = 0.15 * Math.sqrt(Math.max(0, 1 - Math.pow(rho, 2.4))) * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, rho * 1.4))) + 0.002;
      const phi = Math.atan2(P, 2 * Math.PI * r);
      const skew = 0.32 * rho * rho;
      const row = [];
      for (let k = 0; k < NC; k++) {
        const c = -1 + (2 * k) / (NC - 1);
        const s = c * chord * 0.5;
        const th = theta0 - skew + (s * Math.cos(phi)) / r;
        row.push(V(Math.cos(th) * r, Math.sin(th) * r, s * Math.sin(phi)));
      }
      mid.push(row);
    }

    const face = [];
    const back = [];
    for (let i = 0; i < NR; i++) {
      const rho = i / (NR - 1);
      const fr = [];
      const br = [];
      for (let k = 0; k < NC; k++) {
        const c = -1 + (2 * k) / (NC - 1);
        const du = mid[Math.min(NR - 1, i + 1)][k].clone().sub(mid[Math.max(0, i - 1)][k]);
        const dv = mid[i][Math.min(NC - 1, k + 1)].clone().sub(mid[i][Math.max(0, k - 1)]);
        const n = du.cross(dv);
        if (n.lengthSq() > 1e-12) n.normalize();
        else n.set(0, 0, 1);
        const t = 0.013 * (1 - 0.8 * rho) * Math.sqrt(Math.max(0, 1 - c * c)) * (1 - Math.pow(rho, 8));
        fr.push(mid[i][k].clone().addScaledVector(n, t * 0.5));
        br.push(mid[i][k].clone().addScaledVector(n, -t * 0.5));
      }
      face.push(fr);
      back.push(br);
    }

    const gf = gridSurface(face);
    const gb = gridSurface(back, { flip: true });
    const probe = face[4][4].clone().sub(back[4][4]);
    orientTowards(gf, probe);
    orientTowards(gb, probe.clone().negate());
    gf.computeVertexNormals();
    gb.computeVertexNormals();
    list.push(prepare(gf, BRONZE), prepare(gb, BRONZE));
  }
  return mergePrepared(list);
}

function rudderGeometry() {
  const { pivot, top, bottom, lead, trail } = RUDDER;
  const yTop = top - pivot.y;
  const yBot = bottom - pivot.y;
  const foil = (chordScale, y) => {
    const c = (lead - trail) * chordScale;
    const z0 = lead * chordScale;
    const pts = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const x = 1 - Math.cos((Math.PI * i) / N) * 0.5 - 0.5;
      const yt = 5 * 0.14 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      pts.push([z0 - x * c, yt * c]);
    }
    const loop = [];
    for (let i = 0; i <= N; i++) loop.push(V(pts[i][1], y, pts[i][0]));
    for (let i = N - 1; i >= 1; i--) loop.push(V(-pts[i][1], y, pts[i][0]));
    return loop;
  };

  const bottomLoop = foil(0.92, yBot);
  const topLoop = foil(1.0, yTop);
  const rows = [bottomLoop.concat([bottomLoop[0].clone()]), topLoop.concat([topLoop[0].clone()])];
  const side = gridSurface(rows);
  const p = side.attributes.position;
  const n = side.attributes.normal;
  let dot = 0;
  const a = V();
  const b = V();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(n, i);
    dot += b.x * a.x;
  }
  if (dot < 0) {
    const idx = Array.from(side.index.array);
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    side.setIndex(idx);
    side.computeVertexNormals();
  }

  const opts = { color: PALETTE.antifouling, rough: 0.75 };
  const list = [prepare(side, opts), prepare(fanCap(bottomLoop, V(0, -1, 0)), opts), prepare(fanCap(topLoop, V(0, 1, 0)), opts)];
  const stock = cylinder(0.022, 0.022, 0.3, 10);
  stock.translate(0, yTop + 0.15, 0);
  list.push(prepare(stock, BRONZE));
  const heel = cylinder(0.012, 0.012, 0.05, 8);
  heel.translate(0, yBot - 0.015, 0);
  list.push(prepare(heel, BRONZE));
  return mergePrepared(list);
}

// ============================================================================
// 7. BoatMaterials — texturas CanvasTexture procedurais + GLSL WebGL2 (r187)
// ============================================================================

function glslCol(hex) {
  const c = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return `vec3(${c((hex >> 16) & 255).toFixed(5)}, ${c((hex >> 8) & 255).toFixed(5)}, ${c(hex & 255).toFixed(5)})`;
}

function hash2u(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function createProceduralTexture(size, drawCanvas, fillPixels, opts = {}) {
  const {
    srgb = false,
    repeat = true,
    anisotropy = 4,
    mipmaps = true,
  } = opts;
  let tex = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawCanvas(ctx, size);
      tex = new THREE.CanvasTexture(canvas);
    }
  }
  if (!tex) {
    const data = new Uint8Array(size * size * 4);
    fillPixels(data, size);
    tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeMicroGrainTexture() {
  return createProceduralTexture(
    128,
    (ctx, N) => {
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const n = hash2u(x, y, 42) * 0.6 + hash2u(x >> 1, y >> 1, 91) * 0.4;
          const v = Math.round(234 + n * 21);
          const i = (y * N + x) * 4;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    (data, N) => {
      for (let i = 0; i < N * N; i++) {
        const v = 242 + (i % 13);
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
    },
    { srgb: true, repeat: true }
  );
}

function makeWoodGrainTexture() {
  return createProceduralTexture(
    256,
    (ctx, N) => {
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const u = x / N;
          const v = y / N;
          const warp = Math.sin(u * Math.PI * 2) * 0.08 + Math.sin(u * Math.PI * 4 + 1.3) * 0.04;
          const ring = 0.5 + 0.5 * Math.sin((v * 14 + warp * 8) * Math.PI * 2);
          const pore = hash2u(x, y >> 1, 777) * 0.14;
          const tone = 0.78 + ring * 0.16 - pore * 0.4;
          const i = (y * N + x) * 4;
          img.data[i] = Math.round(clamp01(tone) * 255);
          img.data[i + 1] = Math.round(clamp01(tone * 0.96) * 255);
          img.data[i + 2] = Math.round(clamp01(tone * 0.9) * 255);
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    (data, N) => {
      for (let i = 0; i < N * N; i++) {
        data[i * 4] = 220;
        data[i * 4 + 1] = 210;
        data[i * 4 + 2] = 195;
        data[i * 4 + 3] = 255;
      }
    },
    { srgb: true, repeat: true }
  );
}

function makeWireTrapTexture() {
  return createProceduralTexture(
    128,
    (ctx, N) => {
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const n = hash2u(x, y, 513) * 0.5 + hash2u(x >> 1, y >> 1, 709) * 0.5;
          const v = Math.round(238 + n * 17);
          const i = (y * N + x) * 4;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    (data, N) => {
      for (let i = 0; i < N * N; i++) {
        const v = 244 + (i % 11);
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
    },
    { srgb: true, repeat: true }
  );
}

function makeFoamTexture() {
  return createProceduralTexture(
    256,
    (ctx, N) => {
      const cells = [7, 17, 37];
      const grids = cells.map((cel, ci) => {
        const pts = [];
        for (let j = 0; j < cel; j++) {
          for (let i = 0; i < cel; i++) {
            pts.push([(i + 0.12 + 0.76 * hash2u(i, j, 17 + ci * 31)) / cel, (j + 0.12 + 0.76 * hash2u(i, j, 73 + ci * 31)) / cel]);
          }
        }
        return { cel, pts };
      });
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        const v = y / N;
        for (let x = 0; x < N; x++) {
          const u = x / N;
          const ch = [0, 0, 0];
          for (let g = 0; g < 3; g++) {
            const { cel, pts } = grids[g];
            const ci = Math.floor(u * cel);
            const cj = Math.floor(v * cel);
            let d1 = 9;
            let d2 = 9;
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                const ii = ((ci + di) % cel + cel) % cel;
                const jj = ((cj + dj) % cel + cel) % cel;
                const p = pts[ii + jj * cel];
                let dx = p[0] - u;
                let dy = p[1] - v;
                dx -= Math.round(dx);
                dy -= Math.round(dy);
                const d = Math.hypot(dx, dy) * cel;
                if (d < d1) {
                  d2 = d1;
                  d1 = d;
                } else if (d < d2) d2 = d;
              }
            }
            // Renda espumosa: bordas das células Worley (d2 - d1 pequeno = crista de bolha)
            const ridge = 1.0 - sstep(0.02, 0.34, d2 - d1);
            const micro = hash2u(x, y, 307 + g * 19) * 0.22;
            ch[g] = Math.round(clamp01(ridge * 0.85 + micro) * 255);
          }
          const idx = (y * N + x) * 4;
          img.data[idx] = ch[0];
          img.data[idx + 1] = ch[1];
          img.data[idx + 2] = ch[2];
          img.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    (data, N) => {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = Math.round(clamp01(0.45 + 0.45 * Math.sin(x * 0.25) * Math.cos(y * 0.25)) * 255);
          const idx = (y * N + x) * 4;
          data[idx] = v;
          data[idx + 1] = v;
          data[idx + 2] = v;
          data[idx + 3] = 255;
        }
      }
    },
    { srgb: false, repeat: true }
  );
}

function makeSprayTexture() {
  return createProceduralTexture(
    128,
    (ctx, N) => {
      const img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const dx = (x + 0.5) / N - 0.5;
          const dy = (y + 0.5) / N - 0.5;
          const ang = Math.atan2(dy, dx);
          const n = 0.82 + 0.18 * Math.sin(ang * 5.0 + 1.1) * Math.cos(ang * 3.0 - 0.4);
          const r = (Math.hypot(dx * 1.15, dy * 0.9) * 2) / n;
          const core = Math.pow(clamp01(1 - r), 2.1);
          const i = (y * N + x) * 4;
          const v = Math.round(core * 255);
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = v;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    (data, N) => {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const dx = (x + 0.5) / N - 0.5;
          const dy = (y + 0.5) / N - 0.5;
          const r = Math.hypot(dx, dy) * 2;
          const i = (y * N + x) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = Math.round(clamp01(1 - r) * 255);
        }
      }
    },
    { srgb: false, repeat: false, mipmaps: true }
  );
}

const GLSL_BOAT_HELPERS = /* glsl */`
float boatIsPattern(float auxZ, float id) { return step(abs(auxZ - id), 0.5); }
float boatHash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float boatHash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float boatNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = boatHash31(i);
  float n100 = boatHash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = boatHash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = boatHash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = boatHash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = boatHash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = boatHash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = boatHash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z) * 2.0 - 1.0;
}
float boatFbm3(vec3 p) {
  return boatNoise3(p) * 0.57 + boatNoise3(p * 2.03 + 1.7) * 0.28 + boatNoise3(p * 4.07 + 3.1) * 0.15;
}
float boatLstep(float a, float b, float x) { return smoothstep(a, b, x); }
float boatInvstep(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
vec3 boatBumpNormal(vec3 P, vec3 N, float h) {
  vec3 dPdx = dFdx(P);
  vec3 dPdy = dFdy(P);
  vec3 r1 = cross(dPdy, N);
  vec3 r2 = cross(N, dPdx);
  float det = dot(dPdx, r1);
  if (abs(det) < 1e-9) return N;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 bumped = abs(det) * N - grad;
  float len2 = dot(bumped, bumped);
  return len2 > 1e-12 ? bumped * inversesqrt(len2) : N;
}
float boatNonSkidHeight(vec2 uv) {
  vec2 q = uv * 55.0;
  vec2 c = floor(q);
  vec2 f = fract(q) - 0.5;
  vec2 j = (vec2(boatHash21(c), boatHash21(c + 17.31)) - 0.5) * 0.3;
  float d = length(f - j);
  float pebble = boatInvstep(0.16, 0.36, d);
  float fade = boatInvstep(0.3, 0.8, max(fwidth(q.x), fwidth(q.y)));
  return pebble * fade;
}
`;

function injectBoatVaryings(shader, extraVertexPars = '', extraVertexBody = '') {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aux;
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${extraVertexPars}`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vBoatAux = aux;
vBoatLocal = position;
vBoatUv = uv;
${extraVertexBody}`
    );
}

class BoatMaterials {
  constructor(shape) {
    this.textures = [];
    this.texGrain = makeMicroGrainTexture();
    this.texWood = makeWoodGrainTexture();
    this.texTrap = makeWireTrapTexture();
    this.textures.push(this.texGrain, this.texWood, this.texTrap);

    this.uTime = { value: 0 };
    this.uNight = { value: 0 };
    this.uWindSpeed = { value: 4.5 };
    this.uNavOn = { value: 1 };
    this.uDeckLights = { value: 1 };
    this.uFlagPivot = { value: V() };
    this.uFlagDir = { value: V(0, 0, -1) };
    this.uFlagWind = { value: 0.5 };

    // Compatibilidade com BoatModel.js (handles { value })
    this.navOn = this.uNavOn;
    this.flagPivot = this.uFlagPivot;
    this.flagDir = this.uFlagDir;
    this.flagWind = this.uFlagWind;

    this.hull = this._createHull(shape);
    this.gelcoat = this._createGelcoat();
    this.wood = this._createWood();
    this.fittings = this._createFittings();
    this.glass = this._createGlass();
    this.glow = this._createGlow();
    this.trap = this._createTrap();
  }

  _createHull(shape) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.texGrain,
      roughness: 0.25,
      metalness: 0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      vertexColors: true,
    });
    m.name = 'boatHull';
    m.customProgramCacheKey = () => 'lavra-boat-hull-v1';
    m.onBeforeCompile = (shader) => {
      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float boatHullAboveBottom = 0.0;
float boatHullAboveStripe = 0.0;
float boatHullScum = 0.0;
float boatHullScuff = 0.0;
{
  vec3 p = vBoatLocal;
  float tS = clamp((p.z - (${shape.zAft.toFixed(4)})) / ${shape.length.toFixed(4)}, 0.0, 1.0);
  float sheer = pow(max(tS, 0.0), 2.2) * 0.62 + 0.98 + pow(max(1.0 - tS / 0.2, 0.0), 2.0) * 0.04;
  float boot = p.y - boatLstep(0.8, 4.3, p.z) * 0.06;
  float aaB = fwidth(boot) + 1e-4;
  boatHullAboveBottom = boatLstep(-aaB, aaB, boot - 0.05);
  boatHullAboveStripe = boatLstep(-aaB, aaB, boot - 0.15);
  float below = sheer - p.y;
  float aaS = fwidth(below) + 1e-4;
  float cove = boatLstep(-aaS, aaS, below - 0.1) * boatInvstep(-aaS, aaS, below - 0.122);
  float n1 = boatFbm3(p * vec3(0.9, 2.4, 0.9));
  float streakN = boatNoise3(vec3(p.z * 7.0, p.y * 0.45, p.x * 7.0));
  float scuffN = boatNoise3(vec3(p.z * 2.2, p.y * 34.0, p.x * 2.2));
  vec3 c = mix(${glslCol(0x7a1d15)}, ${glslCol(0x0f1a30)}, boatHullAboveBottom);
  c = mix(c, ${glslCol(0xf2efe6)}, boatHullAboveStripe);
  c = mix(c, ${glslCol(0x0f1a30)}, cove);
  boatHullScum = boatInvstep(0.16, n1 * 0.09 + 0.42, boot) * boatHullAboveStripe * clamp(n1 * 0.6 + 0.7, 0.0, 1.0);
  c = mix(c, ${glslCol(0x8b7b57)}, boatHullScum * 0.32);
  float algae = boatLstep(-0.35, 0.03, boot) * (1.0 - boatHullAboveBottom) * clamp(n1 + 0.45, 0.0, 1.0);
  c = mix(c, ${glslCol(0x2c3a1f)}, algae * 0.45);
  float streak = boatLstep(0.3, 0.75, streakN) * boatLstep(0.05, 0.2, below) * boatInvstep(0.4, 0.95, below) * boatHullAboveStripe;
  c = mix(c, ${glslCol(0xa29579)}, streak * 0.2);
  float side = boatLstep(-0.2, 0.2, -p.x) * boatInvstep(-0.6, 0.2, p.z) * boatLstep(-3.7, -2.8, p.z);
  boatHullScuff = boatLstep(0.45, 0.8, scuffN) * boatLstep(0.13, 0.18, below) * boatInvstep(0.45, 0.7, below) * (side * 0.8 + 0.2);
  c = mix(c, ${glslCol(0x5f5e59)}, boatHullScuff * 0.55);
  diffuseColor.rgb = c * mix(0.95, 1.02, diffuseColor.r);
}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(mix(0.75, 0.35, boatHullAboveBottom), 0.2, boatHullAboveStripe) + boatHullScum * 0.25 + boatHullScuff * 0.3, 0.05, 1.0);`
        )
        .replace(
          '#include <lights_physical_fragment>',
          `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat = clamp(boatHullAboveBottom * (1.0 - boatHullScum * 0.5) * (1.0 - boatHullScuff * 0.6), 0.0, 1.0);
  material.clearcoatRoughness = clamp(0.08 + boatHullScum * 0.3, 0.045, 1.0);
#endif`
        );
    };
    return m;
  }

  _createGelcoat() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texGrain,
      roughness: 0.35,
      metalness: 0,
      vertexColors: true,
    });
    m.name = 'boatGelcoat';
    m.customProgramCacheKey = () => 'lavra-boat-gelcoat-v1';
    m.onBeforeCompile = (shader) => {
      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float boatGelRough = vBoatAux.x;
float boatGelMetal = vBoatAux.y;
float boatGelGroove = 0.0;
float boatGelAO = 1.0;
vec3 boatGelFill = vec3(0.0);
{
  vec4 aux = vBoatAux;
  vec3 p = vBoatLocal;
  float grip = boatIsPattern(aux.z, 1.0);
  float h = boatNonSkidHeight(vBoatUv) * grip;
  float dirtN = boatNoise3(p * 1.7);
  float blot = boatLstep(0.2, 0.55, boatFbm3(p * 2.2 + vec3(7.7, 0.0, 3.1)));
  float dirt = (clamp(dirtN * 0.5 + 0.35, 0.0, 1.0) * 0.22 + blot * 0.2) * grip;
  float corner = boatInvstep(0.35, 0.5, p.y) * 0.08 * (1.0 - grip);
  float plainK = 1.0 - grip;
  float wear = boatFbm3(p * vec3(1.1, 1.6, 1.1) + vec3(5.3, 1.1, 2.9));
  float streakN = boatNoise3(vec3(p.x * 14.0, p.y * 1.2, p.z * 14.0));
  float streaks = boatLstep(0.3, 0.7, streakN) * 0.7 * plainK;
  float lowDirt = boatInvstep(0.38, 1.15, p.y) * clamp(wear + 0.7, 0.0, 1.0) * 0.34 * plainK;
  vec3 base = diffuseColor.rgb * (1.0 - h * 0.07) * clamp(1.0 - dirt - corner * 1.8 - lowDirt, 0.2, 1.0);
  base = mix(base, base * vec3(0.94, 0.89, 0.78), boatLstep(-0.15, 0.35, wear) * 0.45 * plainK);
  base = mix(base, base * vec3(0.78, 0.7, 0.6), streaks * 0.25);
  boatGelRough = mix(aux.x, 0.72, grip) + h * 0.1 + (clamp(wear + 0.3, 0.0, 1.0) * 0.18 + lowDirt * 0.5) * plainK;
  if (aux.z > 1.5) {
    float mottle = boatFbm3(p * vec3(2.3, 3.1, 2.3));
    float panel = boatIsPattern(aux.z, 2.0);
    float sz = (p.z + 0.13) / 0.61;
    float seamDz = 0.305 - abs(fract(sz) - 0.5) * 0.61;
    float dyA = abs(p.y - 1.17);
    float dyB = abs(p.y - 1.52);
    float seamD = min(seamDz, min(dyA, dyB));
    float aa = fwidth(seamD) + 1e-4;
    float seam = boatInvstep(0.0015, 0.0015 + aa * 1.5, seamD) * panel;
    float screwV = length(vec2((fract(p.y / 0.15) - 0.5) * 0.15, seamDz - 0.012));
    float screwH = length(vec2((fract(p.z / 0.15) - 0.5) * 0.15, min(dyA, dyB) - 0.012));
    float screwD = min(screwV, screwH);
    float screw = boatInvstep(0.0035, 0.0035 + fwidth(screwD) + 1e-4, screwD) * panel;
    float low = boatInvstep(1.15, 1.6, p.y);
    float grime = clamp(low * (0.35 + mottle * 0.3) + boatInvstep(0.0, 0.035, seamD) * 0.18 + mottle * 0.08, 0.0, 1.0) * panel;
    float age = boatFbm3(p * vec3(0.9, 1.4, 0.9) + vec3(3.1, 0.0, 1.7));
    float smudge = boatLstep(0.25, 0.6, boatNoise3(p * vec3(7.0, 5.0, 7.0) + 9.0)) * boatLstep(1.05, 1.25, p.y) * boatInvstep(1.5, 1.75, p.y);
    float scuffN = boatNoise3(vec3(p.z * 3.0, p.y * 60.0, p.x * 3.0));
    float scuff = boatLstep(0.45, 0.7, scuffN) * boatInvstep(0.9, 1.15, p.y) * boatLstep(0.2, 0.35, mottle + 0.5);
    float run = boatNoise3(vec3(p.z * 9.0, p.y * 0.8, p.x * 9.0));
    float stain = boatLstep(0.25, 0.7, run) * boatLstep(0.9, 1.35, p.y) * boatInvstep(1.3, 1.56, p.y) * panel;
    vec3 pc = diffuseColor.rgb * vec3(0.97, 0.94, 0.87);
    pc = mix(pc, pc * vec3(0.9, 0.82, 0.64), boatLstep(-0.1, 0.35, age) * 0.7);
    pc = pc * (1.0 - grime * 0.6) * (1.0 - smudge * 0.12 * panel) * (1.0 - scuff * 0.25 * panel);
    pc = mix(pc, pc * vec3(0.66, 0.54, 0.4), stain * 0.6);
    pc = mix(pc, pc * 0.3, seam);
    float rustK = step(0.55, boatHash21(floor(vec2(p.y / 0.15, p.z / 0.15) + 0.5)));
    vec3 screwCol = mix(vec3(0.55, 0.55, 0.53), vec3(0.32, 0.17, 0.08), rustK);
    pc = mix(pc, screwCol, screw);

    float head = boatIsPattern(aux.z, 3.0);
    vec2 hq = p.xz / 0.006;
    float perf = boatInvstep(0.12, 0.3, length(fract(hq) - 0.5)) * boatInvstep(0.3, 0.7, fwidth(hq.x));
    float quilt = sin((p.z + 0.1) / 0.5 * 3.14159) * 0.5 + 0.5;
    vec3 hc = vec3(0.72, 0.69, 0.63) * (1.0 - perf * 0.18) * (quilt * 0.12 + 0.88) * (mottle * 0.08 + 0.96);

    base = mix(mix(base, pc, panel), hc, head);
    boatGelRough = mix(mix(boatGelRough, 0.5 + grime * 0.3 + age * 0.08 - smudge * 0.12 - screw * 0.2, panel), 0.8, head);
    boatGelMetal += screw * 0.8 * (1.0 - rustK);
    boatGelAO = mix(mix(1.0, 0.55 - low * 0.12 - boatLstep(1.9, 2.3, p.y) * 0.1, panel), 0.24, head);
    boatGelFill = hc * vec3(0.12, 0.11, 0.10) * head;
    boatGelGroove = seam * -0.0006 + screw * 0.0004 + (perf * -0.0002 + quilt * 0.002) * head;
  }
  diffuseColor.rgb = base;
  boatGelGroove += h * 0.0008;
}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(boatGelRough, 0.08, 1.0);`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = clamp(boatGelMetal, 0.0, 1.0);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = boatBumpNormal(-vViewPosition, normal, boatGelGroove);`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += boatGelFill;`
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= boatGelAO;`
        );
    };
    return m;
  }

  _createWood() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texWood,
      roughness: 0.35,
      metalness: 0,
      vertexColors: true,
    });
    m.name = 'boatWood';
    m.customProgramCacheKey = () => 'lavra-boat-wood-v1';
    m.onBeforeCompile = (shader) => {
      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float boatWoodRough = vBoatAux.x;
float boatWoodMetal = vBoatAux.y;
float boatWoodBump = 0.0;
float boatWoodAO = 1.0;
{
  vec4 aux = vBoatAux;
  vec2 w = vBoatUv;
  float g1 = boatNoise3(vec3(w.x * 0.8, w.y * 30.0, 0.37));
  float g2 = boatNoise3(vec3(w.x * 10.0, w.y * 170.0, 5.1));
  float rings = sin(w.y * 150.0 + g1 * 5.0 + w.x * 0.6) * 0.5 + 0.5;
  float grain = clamp(rings * 0.45 + g2 * 0.22 + g1 * 0.22 + 0.28, 0.0, 1.0);
  float plain = boatIsPattern(aux.z, 1.0);
  vec3 wood = mix(${glslCol(0x4a230f)}, ${glslCol(0x9c5b2b)}, grain);
  boatWoodRough = aux.x + g2 * 0.04 * (1.0 - plain);

  float sole = boatIsPattern(aux.z, 2.0);
  float pv = w.y / 0.1;
  float plankI = floor(pv);
  float pf = abs(fract(pv) - 0.5);
  float aaP = fwidth(pv) + 1e-4;
  float holly = boatLstep(0.5 - 0.06 - aaP, 0.5 - 0.06, pf);
  float caulk = boatLstep(0.5 - 0.012 - aaP, 0.5 - 0.012, pf);
  float butt = boatInvstep(0.0, 0.004 + fwidth(w.x), abs(fract(w.x / 1.8 + boatHash21(vec2(plankI, 3.0))) - 0.5) * 1.8);
  float tone = boatHash21(vec2(plankI, 7.0)) * 0.25 + 0.85;
  float lane = boatNoise3(vec3(w.x * 1.3, w.y * 1.3, 2.0)) * 0.5 + 0.5;
  vec3 teak = mix(${glslCol(0x6b3f1d)}, ${glslCol(0xa87445)}, grain) * tone;
  teak = mix(teak, teak * vec3(1.12, 1.08, 1.02), lane * 0.5);
  teak = mix(teak, ${glslCol(0xd9c9a6)}, holly * (1.0 - caulk));
  teak = mix(teak, ${glslCol(0x1c140e)}, max(caulk, butt));
  wood = mix(wood, teak, sole);
  boatWoodRough = mix(boatWoodRough, 0.45 + lane * 0.25, sole);
  diffuseColor.rgb = mix(wood, vec3(1.0), plain) * diffuseColor.rgb;
  boatWoodBump = (g2 * 0.0002 - max(caulk, butt) * 0.0012) * sole;
  boatWoodAO = mix(1.0, 0.6, sole);
}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(boatWoodRough, 0.08, 1.0);`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = clamp(boatWoodMetal, 0.0, 1.0);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = boatBumpNormal(-vViewPosition, normal, boatWoodBump);`
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= boatWoodAO;`
        );
    };
    return m;
  }

  _createFittings() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texGrain,
      roughness: 0.5,
      metalness: 0,
      vertexColors: true,
    });
    m.name = 'boatFittings';
    m.customProgramCacheKey = () => 'lavra-boat-fittings-v1';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBoatTime = this.uTime;
      shader.uniforms.uBoatWindSpeed = this.uWindSpeed;
      shader.uniforms.uFlagPivot = this.uFlagPivot;
      shader.uniforms.uFlagDir = this.uFlagDir;
      shader.uniforms.uFlagWind = this.uFlagWind;

      injectBoatVaryings(
        shader,
        `uniform float uBoatTime, uBoatWindSpeed, uFlagWind;
uniform vec3 uFlagPivot, uFlagDir;`,
        `{
  float wA = aux.w * aux.w;
  float phase = position.x * 3.1 + position.z * 1.7;
  float gust = uBoatWindSpeed * 0.06 + 0.5;
  vec3 sway = vec3(sin(uBoatTime * 1.9 + phase), 0.0, sin(uBoatTime * 1.37 + phase * 1.3) * 0.6) * (wA * 0.12 * gust);

  vec3 rel = position - uFlagPivot;
  float along = max(-rel.z, 0.0);
  float fu = aux.w;
  float droop = (1.0 - uFlagWind) * 1.15 * (fu * 0.5 + 0.5);
  vec3 lat = vec3(uFlagDir.z, 0.0, -uFlagDir.x);
  float flutter = sin(fu * 9.0 - uBoatTime * (uFlagWind * 9.0 + 4.0) + rel.y * 4.0) * fu * (uFlagWind * 0.05 + 0.015);
  vec3 flagPos = vec3(uFlagPivot.x, 0.0, uFlagPivot.z)
    + uFlagDir * (along * cos(droop))
    + vec3(0.0, rel.y - along * sin(droop), 0.0)
    + lat * flutter;

  float isWhip = step(abs(aux.z - 3.0), 0.5);
  float isFlag = step(abs(aux.z - 2.0), 0.5);
  transformed = mix(transformed + sway * isWhip, flagPos, isFlag);
}`
      );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float boatFitRough = vBoatAux.x;
float boatFitMetal = vBoatAux.y;
float boatFitBump = 0.0;
float boatFitAO = 1.0;
{
  vec4 aux = vBoatAux;
  vec2 u = vBoatUv;
  float strand = sin((u.x / 0.07 + u.y) * (6.2831853 * 3.0));
  float ropeShade = boatLstep(-0.7, 0.7, strand) * 0.4 + 0.6;

  float stripeIdx = floor(clamp(u.y, 0.0, 1.0) * 12.999);
  float red = 1.0 - (stripeIdx - 2.0 * floor(stripeIdx / 2.0));
  float canton = step(u.x, 0.4) * step(${(6 / 13).toFixed(5)}, u.y);
  float sx = fract((u.x / 0.4) * 6.0) - 0.5;
  float sy = fract(((u.y - ${(6 / 13).toFixed(5)}) / ${(7 / 13).toFixed(5)}) * 5.0) - 0.5;
  float star = boatInvstep(0.16, 0.24, length(vec2(sx, sy)));
  vec3 stripes = mix(${glslCol(0xf4f1ea)}, ${glslCol(0xb3172a)}, red);
  vec3 flag = mix(stripes, mix(${glslCol(0x1c2a5c)}, ${glslCol(0xf4f1ea)}, star), canton);

  vec3 c = mix(diffuseColor.rgb, diffuseColor.rgb * ropeShade, boatIsPattern(aux.z, 1.0));
  c = mix(c, flag, boatIsPattern(aux.z, 2.0));

  if (aux.z > 3.5) {
    vec3 p = vBoatLocal;
    float wrinkle = boatIsPattern(aux.z, 4.0);
    float wn = boatNoise3(p * 380.0);
    float scuffN = boatFbm3(p * vec3(6.0, 14.0, 6.0));
    float scuff = boatLstep(0.35, 0.6, scuffN) * wrinkle;
    c = mix(c, mix(c * (1.0 + wn * 0.08), c + vec3(0.05), scuff * 0.6), wrinkle);
    boatFitRough = mix(boatFitRough, boatFitRough + wn * 0.08 - scuff * 0.15, wrinkle);
    boatFitBump += wn * 0.00015 * wrinkle;

    float page = boatIsPattern(aux.z, 5.0);
    float row = fract(u.y * 34.0);
    float word = boatHash21(floor(vec2(u.x * 16.0, u.y * 34.0)));
    float inText = step(0.08, u.x) * step(u.x, 0.92) * step(0.06, u.y) * step(u.y, 0.82);
    float typeK = boatLstep(0.35, 0.45, row) * boatInvstep(0.7, 0.8, row) * step(0.18, word) * inText;
    float header = step(0.86, u.y) * step(u.y, 0.93) * step(0.08, u.x) * step(u.x, 0.6);
    float grid = boatLstep(0.478, 0.49, abs(fract(u.x * 4.0) - 0.5)) * inText;
    float ring = boatInvstep(0.0, 0.02, abs(length(u - vec2(0.7, 0.3)) - 0.16)) * 0.5;
    vec3 paper = mix(vec3(0.86, 0.84, 0.78), vec3(0.1, 0.1, 0.12), max(max(typeK * 0.7, header * 0.85), grid * 0.5));
    c = mix(c, mix(paper, vec3(0.45, 0.3, 0.18), ring), page);
    boatFitRough = mix(boatFitRough, 0.9, page);

    float chartK = boatIsPattern(aux.z, 6.0);
    float cn = boatFbm3(vec3(u * 3.0 + vec2(1.3, 4.2), 0.7));
    float shore = cn + (u.x - 0.55) * 1.4;
    float landK = boatLstep(0.0, 0.02, shore);
    float contour = boatInvstep(0.03, 0.06, abs(fract(shore * 7.0) - 0.5)) * (1.0 - landK);
    float crease = boatInvstep(0.0, 0.006, abs(u.x - 0.5)) + boatInvstep(0.0, 0.006, abs(u.y - 0.5));
    float course = boatInvstep(0.001, 0.004, abs(u.y - 0.2 - u.x * 0.45)) * step(0.1, u.x) * step(u.x, 0.7);
    vec3 chart = mix(vec3(0.72, 0.8, 0.84), vec3(0.86, 0.78, 0.58), landK);
    chart = chart * (1.0 - contour * 0.25) * (1.0 - crease * 0.2);
    chart = mix(chart, vec3(0.2, 0.2, 0.22), course * 0.8);
    c = mix(c, chart, chartK);
    boatFitRough = mix(boatFitRough, 0.85, chartK);

    float photo = boatIsPattern(aux.z, 7.0);
    float inPic = step(0.07, u.x) * step(u.x, 0.93) * step(0.07, u.y) * step(u.y, 0.8);
    float horizon = 0.45 + sin(u.x * 3.0 + aux.w * 6.0) * 0.03;
    vec3 pic = mix(vec3(0.08, 0.22, 0.35), vec3(0.45, 0.65, 0.85), step(horizon, u.y));
    pic = mix(pic, vec3(0.85, 0.25, 0.12), boatInvstep(0.06, 0.08, length((u - vec2(0.4 + aux.w * 0.2, horizon)) * vec2(1.0, 3.0))));
    pic = mix(vec3(0.92, 0.9, 0.86), pic * (boatNoise3(vec3(u * 20.0, aux.w * 9.0)) * 0.15 + 0.9), inPic);
    c = mix(c, pic, photo);
    boatFitRough = mix(boatFitRough, 0.3, photo);

    float label = boatIsPattern(aux.z, 8.0);
    float lt = step(0.3, fract(u.x * 7.0)) * step(0.3, boatHash21(floor(vec2(u.x * 28.0, 3.0)))) * step(0.25, u.y) * step(u.y, 0.75);
    c = mix(c, mix(vec3(0.85, 0.85, 0.82), vec3(0.05), lt), label);

    float fabric = boatIsPattern(aux.z, 9.0);
    float fold = boatFbm3(p * vec3(9.0, 4.0, 9.0));
    float stitch = boatLstep(0.486, 0.494, abs(fract(p.y / 0.31) - 0.5)) * step(0.5, fract(p.x * 160.0 + p.z * 160.0));
    c = mix(c, c * (fold * 0.35 + 0.8) * (1.0 - stitch * 0.3), fabric);
    boatFitRough = mix(boatFitRough, 0.65 + fold * 0.1, fabric);
    boatFitBump += fold * 0.004 * fabric;
    boatFitAO = 0.6;
  }
  diffuseColor.rgb = c;
}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(boatFitRough, 0.08, 1.0);`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = clamp(boatFitMetal, 0.0, 1.0);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = boatBumpNormal(-vViewPosition, normal, boatFitBump);`
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= boatFitAO;`
        );
    };
    return m;
  }

  _createGlass() {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xa9bec4,
      roughness: 0.06,
      metalness: 0.05,
      ior: 1.5,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexColors: false,
    });
    m.name = 'boatGlass';
    m.customProgramCacheKey = () => 'lavra-boat-glass-v1';
    m.onBeforeCompile = (shader) => {
      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float boatGlassRough = 0.05;
{
  vec2 u = vBoatUv;
  float spots = boatLstep(0.45, 0.85, boatNoise3(vec3(u * 38.0, 3.3)));
  float haze = clamp(boatNoise3(vec3(u * 4.0, 9.1)) * 0.5 + 0.5, 0.0, 1.0);
  float edge = boatInvstep(0.0, 0.18, abs(u.y));
  float salt = clamp((spots * 0.5 + haze * 0.22) * (edge * 0.7 + 0.35), 0.0, 1.0);
  diffuseColor.a = 0.18 + salt * 0.18;
  boatGlassRough = 0.03 + salt * 0.32;
}`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(boatGlassRough, 0.03, 0.85);`
        );
    };
    return m;
  }

  _createGlow() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0,
      vertexColors: true,
    });
    m.name = 'boatGlow';
    m.customProgramCacheKey = () => 'lavra-boat-glow-v1';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBoatTime = this.uTime;
      shader.uniforms.uBoatNight = this.uNight;
      shader.uniforms.uNavOn = this.uNavOn;
      shader.uniforms.uDeckLights = this.uDeckLights;

      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uBoatTime, uBoatNight, uNavOn, uDeckLights;
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
vec3 boatGlowBase = diffuseColor.rgb;
diffuseColor.rgb = boatGlowBase * 0.06;`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(vBoatAux.x, 0.05, 1.0);`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  vec4 aux = vBoatAux;
  float mode = aux.z;
  float t = uBoatTime;
  float night = uBoatNight;
  vec2 u = vBoatUv;

  vec2 q = (u - 0.5) * 2.0;
  float r = length(q);
  float ang = atan(q.x, q.y);
  float da = fract((t * 2.513 - ang) / 6.2831853);
  float trail = exp(da * -5.0);
  float beam = boatInvstep(0.0, 0.015, da);
  float ringD = abs(fract(r * 3.0 + 0.5) - 0.5);
  float ring = boatInvstep(0.012, 0.03, ringD);
  float landN = boatFbm3(vec3(q * 2.3 + vec2(1.7, 0.4), 0.5));
  float land = boatLstep(0.18, 0.4, landN + q.x * 0.35) * boatLstep(0.3, 0.45, r);
  vec2 cell = floor(q * 7.0);
  float blip = step(0.93, boatHash21(cell)) * boatInvstep(0.1, 0.3, length(fract(q * 7.0) - 0.5)) * boatLstep(0.2, 0.3, r);
  float heading = boatInvstep(0.004, 0.012, abs(q.x)) * step(0.0, q.y);
  float inside = boatInvstep(0.96, 0.99, r);
  float echoes = clamp(land + blip, 0.0, 1.0) * (trail * 0.75 + 0.25);
  vec3 radar = ((vec3(0.0, 0.012, 0.04)
    + vec3(0.05, 0.22, 0.28) * (ring * 0.5 + heading * 0.6)
    + vec3(1.0, 0.72, 0.12) * echoes
    + vec3(0.15, 0.9, 0.35) * (beam * 0.8 + trail * 0.08))
    * inside + vec3(0.01, 0.015, 0.02)) * 1.3;

  vec2 cp = u * vec2(1.35, 1.0);
  float cn = boatFbm3(vec3(cp * 2.6 + vec2(3.1, 1.2), 2.2));
  float shore = cn + (u.x - 0.62) * 1.1;
  float isLand = boatLstep(0.0, 0.015, shore);
  float shallow = boatLstep(-0.25, 0.0, shore);
  float contour = boatInvstep(0.02, 0.05, abs(fract(shore * 9.0) - 0.5)) * (1.0 - isLand);
  vec3 water = mix(vec3(0.2, 0.42, 0.78), vec3(0.62, 0.82, 0.97), shallow);
  float track = boatInvstep(0.003, 0.007, abs(u.x - 0.5 - (u.y - 0.5) * 0.25)) * step(0.5, u.y);
  float boatIcon = boatInvstep(0.012, 0.022, length(u - vec2(0.5, 0.5)));
  vec3 chart = (mix(water, vec3(0.88, 0.8, 0.55), isLand) * (1.0 - contour * 0.35)
    + vec3(0.9, 0.1, 0.8) * track
    + vec3(1.0, 0.35, 0.05) * boatIcon) * 0.85;

  vec2 gq = (u - 0.5) * 2.0;
  float gr = length(gq);
  float ga = atan(gq.x, gq.y);
  float tickF = abs(fract((ga / 6.2831853) * 24.0) - 0.5);
  float ticks = boatInvstep(0.08, 0.15, tickF) * boatLstep(0.72, 0.76, gr) * boatInvstep(0.86, 0.9, gr) * boatInvstep(2.3, 2.4, abs(ga));
  float lx = vBoatLocal.x;
  float needleA = sin(t * 0.7 + lx * 13.0) * 0.06 + lx * 3.7 + 0.3;
  vec2 nd = vec2(sin(needleA), cos(needleA));
  float along = dot(gq, nd);
  float perp = length(gq - nd * along);
  float needle = boatInvstep(0.025, 0.045, perp) * step(-0.1, along) * boatInvstep(0.68, 0.72, along);
  float backlight = night * 1.4 + 0.25;
  vec3 gauge = (vec3(0.9, 0.95, 1.0) * ticks + vec3(1.0, 0.45, 0.08) * needle) * backlight + vec3(0.004);

  vec3 nav = boatGlowBase * uNavOn * (night * 4.5 + 1.2);
  vec3 flood = boatGlowBase * uDeckLights * (night * 5.0 + 0.04);
  vec3 dome = boatGlowBase * uDeckLights * (night * 2.0 + 0.04);
  vec3 lcd = boatGlowBase * (night * 0.5 + 0.45);

  totalEmissiveRadiance += nav * boatIsPattern(mode, 0.0)
    + radar * boatIsPattern(mode, 1.0)
    + chart * boatIsPattern(mode, 2.0)
    + gauge * boatIsPattern(mode, 3.0)
    + flood * boatIsPattern(mode, 4.0)
    + dome * boatIsPattern(mode, 5.0)
    + lcd * boatIsPattern(mode, 6.0);
}`
        );
    };
    return m;
  }

  _createTrap() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texTrap,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      vertexColors: true,
    });
    m.name = 'boatTrap';
    m.customProgramCacheKey = () => 'lavra-boat-trap-v1';
    m.onBeforeCompile = (shader) => {
      injectBoatVaryings(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec4 vBoatAux;
varying vec3 vBoatLocal;
varying vec2 vBoatUv;
${GLSL_BOAT_HELPERS}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec4 aux = vBoatAux;
  vec2 u = vBoatUv;
  float net = boatIsPattern(aux.z, 1.0);
  vec2 diag = vec2(u.x + u.y, u.x - u.y) * 0.7071;
  vec2 q = mix(u / 0.038, diag / 0.05, net);
  vec2 fr = abs(fract(q) - 0.5);
  vec2 fw = clamp(fwidth(q), vec2(0.008), vec2(0.11));
  float halfW = mix(${(0.5 - 0.0045 / 0.038).toFixed(5)}, ${(0.5 - 0.002 / 0.05).toFixed(5)}, net);
  float lineX = boatLstep(halfW - fw.x, halfW, fr.x);
  float lineY = boatLstep(halfW - fw.y, halfW, fr.y);
  float b = 0.014;
  float inner = step(b, u.x) * step(b, u.y) * step(u.x, aux.x - b) * step(u.y, aux.y - b);
  float border = (1.0 - inner) * (1.0 - net);
  diffuseColor.a = max(max(lineX, lineY), border);
  diffuseColor.rgb *= mix(1.0, 0.8, border);
}`
        );
    };
    return m;
  }

  setNavLights(on) {
    this.uNavOn.value = on ? 1 : 0;
  }

  setLuzes(val) {
    if (typeof val === 'boolean' || typeof val === 'number') {
      const k = val ? 1 : 0;
      this.uNavOn.value = k;
      this.uDeckLights.value = k;
      return;
    }
    if (val && typeof val === 'object') {
      if (val.nav !== undefined || val.navLights !== undefined) {
        this.uNavOn.value = val.nav ?? val.navLights ? 1 : 0;
      }
      if (val.deck !== undefined || val.flood !== undefined || val.cabin !== undefined || val.farol !== undefined) {
        this.uDeckLights.value = (val.deck ?? val.flood ?? val.cabin ?? val.farol) ? 1 : 0;
      }
    }
  }

  dispose() {
    for (const k of ['hull', 'gelcoat', 'wood', 'fittings', 'glass', 'glow', 'trap']) {
      this[k]?.dispose();
    }
    for (const tex of this.textures) tex?.dispose();
    this.textures.length = 0;
  }
}

// ============================================================================
// 8. Wake (Esteira em V de Kelvin + Turbulência de Popa)
// ============================================================================

function createWakeEffect() {
  const texFoam = makeFoamTexture();
  const pivot = new THREE.Group();
  pivot.name = 'boat-wake-pivot';

  // Malha em leque atrás do barco: z de +3.5 (ombros da proa) até -22.0 (popa/esteira)
  const NZ = 36;
  const NX = 24;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let iz = 0; iz <= NZ; iz++) {
    const v = iz / NZ; // 0 = proa (+3.6), 1 = fim da esteira (-22.0)
    const z = lerp(3.6, -22.0, v);
    const distAft = Math.max(0, 3.6 - z);
    // Metade da largura segue o ângulo clássico de Kelvin (tan 19.47° ≈ 0.3535) + folga
    const halfW = 1.45 + distAft * 0.42;
    for (let ix = 0; ix <= NX; ix++) {
      const u = (ix / NX) * 2 - 1; // -1 .. +1
      pos.push(u * halfW, 0.035, z);
      uvs.push(u, v);
    }
  }
  const stride = NX + 1;
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = iz * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uWakeState = { value: new THREE.Vector4(0, 0, 0, 0) }; // x: speedFrac, y: phase, z: wash, w: steer
  const mat = new THREE.RawShaderMaterial({
    name: 'boatWake',
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...U,
      uWakeState,
      tWakeFoam: { value: texFoam },
    },
    vertexShader: /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec4 uWakeState;
out vec2 vUv;
out vec3 vLocal;
out vec3 vWorld;
void main() {
  vUv = uv;
  vec3 p = position;
  float distAft = max(0.0, -3.5 - p.z);
  p.x += uWakeState.w * distAft * distAft * 0.012;
  vLocal = p;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform vec4 uWakeState;
uniform sampler2D tWakeFoam;
in vec2 vUv;
in vec3 vLocal;
in vec3 vWorld;
out vec4 outColor;

void main() {
  float spd = uWakeState.x;
  float phase = uWakeState.y;
  float wash = uWakeState.z;
  if (spd < 0.01 && wash < 0.01) discard;

  float z = vLocal.z;
  float x = vLocal.x;
  float ax = abs(x);

  // Esconde espuma por dentro do casco (atrás de z = -3.85 fica a popa aberta)
  float insideHull = step(-3.75, z) * (1.0 - smoothstep(0.85, 1.5, ax));

  // Dois braços divergentes de Kelvin (~19.5 graus a partir dos ombros da proa)
  float zBow = max(0.0, 3.85 - z);
  float armX = 0.25 + zBow * 0.3535;
  float dArm = abs(ax - armX);
  float armW = mix(0.24, 1.45, vUv.y);
  float armBand = exp(-(dArm * dArm) / max(armW * armW * 0.42, 0.01));
  float armMask = smoothstep(0.0, 2.2, zBow) * (1.0 - smoothstep(0.48, 1.0, vUv.y));

  // Colar de onda na proa e ombros
  float collarDist = abs(z - (4.05 - ax * 1.45));
  float collar = exp(-collarDist * collarDist * 4.0) * smoothstep(-0.5, 4.0, z) * smoothstep(1.65, 0.15, ax);

  // Esteira central turbulenta do hélice atrás do espelho de popa
  float aftDist = max(0.0, -3.75 - z);
  float washW = 0.46 + aftDist * 0.095;
  float propWash = exp(-(ax * ax) / max(washW * washW, 0.04)) * smoothstep(0.0, 0.5, aftDist) * (1.0 - smoothstep(4.5, 18.0, aftDist));

  vec2 fUv1 = vec2(x * 0.23, z * 0.16 - phase * 0.55);
  vec2 fUv2 = vec2(x * 0.51 + 0.37, z * 0.34 - phase * 0.92);
  float f1 = texture(tWakeFoam, fUv1).r;
  float f2 = texture(tWakeFoam, fUv2).g;
  float f3 = texture(tWakeFoam, fUv2 * 1.85 - vec2(0.13, phase * 0.3)).b;
  float lace = smoothstep(0.22, 0.88, f1 * 0.45 + f2 * 0.35 + f3 * 0.25);

  float vWake = armBand * armMask * spd * (0.28 + 0.85 * lace);
  float centerFoam = propWash * max(spd * 0.9, wash) * (0.35 + 0.8 * lace);
  float bowFoam = collar * spd * (0.45 + 0.65 * f2);

  float foam = clamp((vWake + centerFoam + bowFoam) * (1.0 - insideHull), 0.0, 1.0);
  if (foam < 0.015) discard;

  vec3 sunL = uSunColor * (0.35 + 0.65 * max(uLightDir.y, 0.0));
  vec3 ambL = mix(uAmbGround, uAmbSky, 0.75);
  vec3 foamCol = mix(vec3(0.68, 0.86, 0.88), vec3(0.95, 0.98, 1.0), smoothstep(0.2, 0.85, foam));
  vec3 col = foamCol * (sunL * 0.85 + ambL * 1.15);

  vec3 toCam = cameraPosition - vWorld;
  float dist = max(length(toCam), 1e-4);
  vec4 nv = fogAt(dist, -toCam / dist, vWorld.y);
  col = mix(col, nv.rgb, nv.a);

  float alpha = foam * 0.78 * (1.0 - nv.a * 0.85);
  outColor = vec4(finish(col), alpha);
}
`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'boat-wake';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.visible = false;
  pivot.add(mesh);

  const _invQ = new THREE.Quaternion();
  const _localUp = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);
  let phase = 0;

  return {
    pivot,
    mesh,
    update(dt, boatQuat, speed, rpm, throttle, steer) {
      _invQ.copy(boatQuat).invert();
      _localUp.copy(_worldUp).applyQuaternion(_invQ).normalize();
      pivot.quaternion.setFromUnitVectors(_worldUp, _localUp);

      const spdAbs = Math.abs(speed);
      const speedFrac = clamp(spdAbs / 7.5, 0, 1.25);
      const wash = clamp(Math.max(Math.abs(rpm) / 1800, Math.abs(throttle) * 0.85), 0, 1);
      phase += Math.max(spdAbs, wash * 2.5) * dt * 0.35;

      uWakeState.value.set(speedFrac, phase, wash, clamp(steer, -1, 1));
      mesh.visible = speedFrac > 0.015 || wash > 0.04;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      texFoam.dispose();
    },
  };
}

// ============================================================================
// 9. BoatSpray — spray de proa nas ondas + esteira de popa (Tidewater)
// ============================================================================

const SPRAY_KIND = { DROPLET: 0, MIST: 1, LIGAMENT: 2, SPRAY: 3, SHEET: 4 };
const MAX_SPRAY = 384;
const SPRAY_TAU = [3.0, 0.35, 5.0, 1.8, 2.5];
const SPRAY_GRAV = [GRAVITY, 0.3, GRAVITY, 8.5, GRAVITY];
const SPRAY_GROW = [0, 0.22, 0, 0.3, 0.7];
const SPRAY_ALPHA = [0.65, 0.14, 0.85, 0.72, 0.36];

function createBoatSprayEffect(lines) {
  const texSpray = makeSprayTexture();

  // Segmentos de contato na linha d'água de vante (3 por bordo)
  const zStem = lines.wlEnd - 0.02;
  let maxHB = 0;
  for (let z = lines.wlStart; z <= lines.wlEnd; z += 0.05) maxHB = Math.max(maxHB, lines.halfBeamAt(z));
  let zSh = zStem;
  while (zSh > lines.wlStart && lines.halfBeamAt(zSh) < 0.92 * maxHB) zSh -= 0.05;

  const contacts = [];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 3; i++) {
      const f = (i / 3) ** 1.3;
      const z = zStem + (zSh - zStem) * f;
      pts.push(V(s * (lines.halfBeamAt(z) + 0.03), 0.05, z));
    }
    for (let i = 0; i < 3; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const t = V().subVectors(b, a).setY(0).normalize();
      contacts.push({
        side: s,
        a,
        b,
        mid: a.clone().add(b).multiplyScalar(0.5),
        length: a.distanceTo(b),
        normal: V(-s * t.z, 0, s * t.x),
        depth: 0,
        rate: 0,
        primed: false,
        carry: [0, 0, 0, 0, 0],
      });
    }
  }

  let hbTop = 0;
  for (let i = 0; i <= 200; i++) hbTop = Math.max(hbTop, lines.sheerX(i / 200));
  let zShTop = lines.zBow;
  while (zShTop > lines.zAft && lines.sheerX(lines.tAtSheerZ(zShTop)) < 0.95 * hbTop) zShTop -= 0.05;
  let zShWL = zStem;
  while (zShWL > lines.wlStart && lines.halfBeamAt(zShWL) < 0.95 * maxHB) zShWL -= 0.05;

  const shape = {
    zAft: lines.zAft,
    zShoulder: zShTop,
    zStem: lines.zBow,
    halfBeam: hbTop + 0.02,
    wlShoulder: zShWL,
    wlStem: lines.wlEnd,
    wlHalfBeam: maxHB + 0.01,
    ySheerAft: lines.sheerY(0) + 0.04,
    ySheerStem: lines.sheerY(1) + 0.04,
  };

  const halfBeamBody = (z, y) => {
    const sheer = lerp(shape.ySheerAft, shape.ySheerStem, clamp01((z - shape.zAft) / (shape.zStem - shape.zAft)));
    const f = clamp01(y / Math.max(sheer, 0.1));
    const zShB = lerp(shape.wlShoulder, shape.zShoulder, f);
    const zStB = lerp(shape.wlStem, shape.zStem, f);
    const HB = lerp(shape.wlHalfBeam, shape.halfBeam, f);
    if (z >= zStB) return 0;
    const e = clamp01((z - zShB) / Math.max(zStB - zShB, 0.01));
    return HB * Math.sqrt(Math.max(1 - e * e, 0.02));
  };

  // Pool de partículas em frame local do barco (zero alocação por frame)
  const pPos = new Float32Array(MAX_SPRAY * 3);
  const pVel = new Float32Array(MAX_SPRAY * 3);
  const pAge = new Float32Array(MAX_SPRAY);
  const pLife = new Float32Array(MAX_SPRAY);
  const pSize = new Float32Array(MAX_SPRAY);
  const pKind = new Float32Array(MAX_SPRAY);
  const pSeed = new Float32Array(MAX_SPRAY);

  const iPos = new Float32Array(MAX_SPRAY * 4);
  const iVel = new Float32Array(MAX_SPRAY * 4);
  const iMeta = new Float32Array(MAX_SPRAY * 4);

  const baseGeo = new THREE.PlaneGeometry(1, 1);
  const instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = baseGeo.index;
  instGeo.attributes.position = baseGeo.attributes.position;
  instGeo.attributes.uv = baseGeo.attributes.uv;

  const attrPos = new THREE.InstancedBufferAttribute(iPos, 4);
  const attrVel = new THREE.InstancedBufferAttribute(iVel, 4);
  const attrMeta = new THREE.InstancedBufferAttribute(iMeta, 4);
  attrPos.setUsage(THREE.DynamicDrawUsage);
  attrVel.setUsage(THREE.DynamicDrawUsage);
  attrMeta.setUsage(THREE.DynamicDrawUsage);
  instGeo.setAttribute('iPos', attrPos);
  instGeo.setAttribute('iVel', attrVel);
  instGeo.setAttribute('iMeta', attrMeta);
  instGeo.instanceCount = 0;

  const mat = new THREE.RawShaderMaterial({
    name: 'boatSpray',
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...U,
      tSpray: { value: texSpray },
    },
    vertexShader: /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
in vec4 iPos;   // xyz = pos local, w = tamanho
in vec4 iVel;   // xyz = vel local, w = kind
in vec4 iMeta;  // x = ageFrac, y = alphaBase, z = seed, w = stretch
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
out vec2 vUv;
out float vAlpha;
out float vKind;
out vec3 vWorld;
void main() {
  vUv = uv;
  vKind = iVel.w;
  float ageF = iMeta.x;
  float fadeIn = smoothstep(0.0, 0.08, ageF);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, ageF);
  vAlpha = iMeta.y * fadeIn * fadeOut;

  vec3 localCenter = iPos.xyz;
  vec3 worldCenter = (modelMatrix * vec4(localCenter, 1.0)).xyz;
  vec3 worldVel = mat3(modelMatrix) * iVel.xyz;

  // Billboard voltado à câmera com estiramento ao longo da velocidade
  vec3 dCam = cameraPosition - worldCenter;
  vec3 toCam = dot(dCam, dCam) > 1e-8 ? normalize(dCam) : vec3(0.0, 0.0, 1.0);
  vec3 rightRaw = cross(vec3(0.0, 1.0, 0.0), toCam);
  vec3 right = dot(rightRaw, rightRaw) > 1e-6 ? normalize(rightRaw) : vec3(1.0, 0.0, 0.0);
  vec3 up = normalize(cross(toCam, right));

  float sz = iPos.w;
  vec2 quad = position.xy;
  vec3 offset = right * (quad.x * sz) + up * (quad.y * sz);
  vec3 stretch = worldVel * (iMeta.w * quad.y);
  vec3 wp = worldCenter + offset + stretch * 0.5;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`,
    fragmentShader: /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform sampler2D tSpray;
in vec2 vUv;
in float vAlpha;
in float vKind;
in vec3 vWorld;
out vec4 outColor;

void main() {
  float mask = texture(tSpray, vUv).a;
  float a = mask * vAlpha;
  if (a < 0.01) discard;

  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  float cosT = dot(-V, uLightDir);
  float backLit = pow(max(cosT, 0.0), 4.0) * 0.55;

  vec3 skyCol = skyBase(vec3(0.0, 0.35, 0.0));
  vec3 sunL = uSunColor * (0.35 + 0.65 * max(uLightDir.y, 0.0));
  vec3 whiteCol = vec3(0.95, 0.98, 1.0) * (sunL * 0.85 + uAmbSky * 1.15 + backLit * uSunColor * 0.5);
  vec3 clearCol = mix(skyCol, whiteCol, 0.72);
  vec3 col = mix(clearCol, whiteCol, step(2.5, vKind));

  vec4 nv = fogAt(dist, -V, vWorld.y);
  col = mix(col, nv.rgb, nv.a);
  a *= (1.0 - nv.a * 0.9);
  outColor = vec4(finish(col), a);
}
`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(instGeo, mat);
  mesh.name = 'boat-spray';
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.visible = false;

  let head = 0;
  let rngState = 1337;
  const rnd = () => {
    rngState = (Math.imul(1664525, rngState) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  const spawn = (ax, ay, az, bx, by, bz, vx, vy, vz, size, kind, life, spread) => {
    const t = rnd();
    const px = lerp(ax, bx, t) + (rnd() - 0.5) * 0.06;
    const py = lerp(ay, by, t) + (rnd() - 0.5) * 0.04;
    const pz = lerp(az, bz, t) + (rnd() - 0.5) * 0.06;
    const idx = head;
    head = (head + 1) % MAX_SPRAY;
    pPos[idx * 3] = px;
    pPos[idx * 3 + 1] = py;
    pPos[idx * 3 + 2] = pz;
    pVel[idx * 3] = vx + (rnd() - 0.5) * spread;
    pVel[idx * 3 + 1] = vy + (rnd() - 0.5) * spread * 0.8;
    pVel[idx * 3 + 2] = vz + (rnd() - 0.5) * spread;
    pAge[idx] = 0.0001;
    pLife[idx] = life * (0.75 + 0.5 * rnd());
    pSize[idx] = size * (0.7 + 0.6 * rnd());
    pKind[idx] = kind;
    pSeed[idx] = rnd();
  };

  let slamCooldown = 0;
  let burst = 0;
  let washCarry = 0;
  const _invQ = new THREE.Quaternion();
  const _gLocal = new THREE.Vector3();
  const _windLocal = new THREE.Vector3();
  const _velLocal = new THREE.Vector3();
  const _angLocal = new THREE.Vector3();
  const _pw = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _wVel = new THREE.Vector3();
  const _launch = new THREE.Vector3();

  return {
    mesh,
    contacts,
    update(dt, boatPos, boatQuat, boatVelWorld, boatAngWorld, time, windVec, rpm, throttle, sampleWaterAt, onSlam) {
      if (!(dt > 0)) return;
      const stepDt = Math.min(dt, 1 / 20);
      _invQ.copy(boatQuat).invert();
      _velLocal.copy(boatVelWorld).applyQuaternion(_invQ);
      _angLocal.copy(boatAngWorld).applyQuaternion(_invQ);
      _gLocal.set(0, -GRAVITY, 0).applyQuaternion(_invQ);

      const wx = windVec?.x ?? 0.83;
      const wy = windVec?.y ?? 0.55;
      const wz = windVec?.z ?? 0.85;
      _windLocal.set(wx * wz * 4.0, 0, wy * wz * 4.0).sub(boatVelWorld).applyQuaternion(_invQ);

      const fwdSpeed = Math.max(_velLocal.z, 0);
      slamCooldown = Math.max(0, slamCooldown - stepDt);

      // 1. Avalia segmentos de contato na proa
      let totalDemand = 0;
      let slam = 0;
      for (const c of contacts) {
        _pw.copy(c.mid).applyQuaternion(boatQuat).add(boatPos);
        let hw = boatPos.y;
        if (typeof sampleWaterAt === 'function') {
          const val = sampleWaterAt(_pw.x, _pw.z);
          if (Number.isFinite(val)) hw = val;
        } else {
          hw = boatPos.y + alturaOnda(_pw.x, _pw.z, time, windVec, 7) * 0.5;
        }
        const depth = hw - _pw.y;
        const rate = c.primed ? (depth - c.depth) / stepDt : 0;
        c.rate += (rate - c.rate) * Math.min(1, stepDt / 0.03);
        c.depth = depth;
        c.primed = true;
        const wet = sstep(-0.35, -0.08, depth) * (1 - sstep(0.7, 1.1, depth));
        _r.copy(c.mid);
        _wVel.copy(_angLocal).cross(_r).add(_velLocal);
        const vn = Math.max(0, _wVel.x * c.normal.x + _wVel.z * c.normal.z);
        const rV = Math.min(30, Math.max(0, vn - 0.4) * 1.6);
        const rI = Math.min(30, Math.max(0, c.rate - 0.6) * 1.2);
        const dV = c.length * rV * 1.0 * wet;
        const dI = c.length * rI * 3.0 * wet * (0.15 + 0.85 * sstep(2, 6, fwdSpeed));
        c._dV = dV;
        c._dI = dI;
        c._rV = rV;
        c._rI = rI;
        c._vn = vn;
        c._hwLocal = hw - boatPos.y;
        totalDemand += dV + dI;
        if (c.a.z === contacts[0].a.z && wet > 0.3 && fwdSpeed > 2.5) {
          slam = Math.max(slam, Math.min((c.rate - 1.8) * 0.4 + fwdSpeed * 0.02, 1));
        }
      }

      if (slam > 0 && slamCooldown === 0) {
        slamCooldown = 0.4;
        if (typeof onSlam === 'function') onSlam(slam);
      }

      burst = Math.max(burst * Math.exp(-stepDt / 0.15), slam);
      const boost = 1 + 2.5 * burst;
      const emitRate = 65;
      const budget = Math.min(1, 24 / Math.max(1e-6, totalDemand * emitRate * stepDt * boost));
      const making = sstep(2.5, 6.0, fwdSpeed);

      for (const c of contacts) {
        const d = c._dV + c._dI;
        if (d <= 1e-4) continue;
        const nEmit = d * emitRate * stepDt * budget * boost;
        const imp = c._dI / d;
        const r = c._rV * (1 - imp) + c._rI * imp;
        _launch.copy(_velLocal).addScaledVector(c.normal, -c._vn).multiplyScalar(-0.45);
        _launch.y = Math.max(0.2, _velLocal.y * 0.3);
        const up = c._rV * 0.55 * (1 - imp) + c._rI * 1.15 * imp + burst * 2.5;
        _launch.addScaledVector(c.normal, 0.85 * r + 0.45 + burst * 1.0);
        _launch.y += up;

        const rise = Math.min(0.5, (c._vn * c._vn) / (2 * GRAVITY) * 0.5);
        const ya = clamp(c._hwLocal + rise, -0.3, 0.9);
        const yb = clamp(c._hwLocal + rise * 0.6, -0.3, 0.9);
        const ax = c.side * (halfBeamBody(c.a.z, ya) + 0.06);
        const bx = c.side * (halfBeamBody(c.b.z, yb) + 0.06);
        const spread = (0.3 * Math.hypot(0.65 * r, up) + 0.25) * (1 + burst);
        const life = 0.8 * (1 - imp) + 1.4 * imp;

        c.carry[0] += nEmit;
        const cntDrop = Math.floor(c.carry[0]);
        c.carry[0] -= cntDrop;
        for (let i = 0; i < cntDrop; i++) {
          spawn(ax, ya, c.a.z, bx, yb, c.b.z, _launch.x, _launch.y, _launch.z, 0.016 + 0.002 * r, SPRAY_KIND.DROPLET, life, spread);
        }

        c.carry[3] += nEmit * (0.12 * making + 0.16 * imp + 0.25 * burst);
        const cntSpray = Math.floor(c.carry[3]);
        c.carry[3] -= cntSpray;
        for (let i = 0; i < cntSpray; i++) {
          spawn(ax, ya, c.a.z, bx, yb, c.b.z, _launch.x, _launch.y, _launch.z, 0.07 + 0.012 * r + 0.04 * burst, SPRAY_KIND.SPRAY, 0.65 + 0.4 * imp, spread * 1.2);
        }

        if (imp > 0.25 || burst > 0.1) {
          c.carry[1] += nEmit * 0.06 * making;
          const cntMist = Math.floor(c.carry[1]);
          c.carry[1] -= cntMist;
          for (let i = 0; i < cntMist; i++) {
            spawn(ax, ya, c.a.z, bx, yb, c.b.z, _launch.x * 0.6, _launch.y * 0.7, _launch.z * 0.6, 0.22 + 0.12 * burst, SPRAY_KIND.MIST, 1.4, spread * 0.7);
          }
        }
      }

      // 2. Spray do hélice na popa em aceleração
      const activity = Math.abs(rpm) > 300 || Math.abs(throttle) > 0.2 ? clamp(Math.max(Math.abs(rpm) / 2200, Math.abs(throttle)), 0, 1) : 0;
      if (activity > 0.15) {
        washCarry += activity * 24 * stepDt;
        const m = Math.floor(washCarry);
        washCarry -= m;
        const dir = Math.sign(throttle || rpm || 1);
        for (let i = 0; i < m; i++) {
          spawn(
            -0.35, 0.08, -3.95,
            0.35, 0.08, -4.05,
            (rnd() - 0.5) * 0.6, 0.6 + activity * 0.6, -1.6 * dir,
            0.05 + activity * 0.04, SPRAY_KIND.DROPLET, 0.7, 0.9
          );
        }
      }

      // 3. Integração balística e colisão com casco/cabine
      let activeCount = 0;
      for (let i = 0; i < MAX_SPRAY; i++) {
        if (pLife[i] <= 0) continue;
        pAge[i] += stepDt;
        if (pAge[i] >= pLife[i]) {
          pLife[i] = 0;
          continue;
        }
        const k = pKind[i] | 0;
        const tau = SPRAY_TAU[k] || 3.0;
        const drag = 1 - Math.exp(-stepDt / tau);
        const grav = SPRAY_GRAV[k] / GRAVITY;

        const ix = i * 3;
        pVel[ix] += (_windLocal.x - pVel[ix]) * drag + _gLocal.x * grav * stepDt;
        pVel[ix + 1] += (_windLocal.y - pVel[ix + 1]) * drag + _gLocal.y * grav * stepDt;
        pVel[ix + 2] += (_windLocal.z - pVel[ix + 2]) * drag + _gLocal.z * grav * stepDt;

        pPos[ix] += pVel[ix] * stepDt;
        pPos[ix + 1] += pVel[ix + 1] * stepDt;
        pPos[ix + 2] += pVel[ix + 2] * stepDt;

        // Colisão simples com casco e cabine para spray nunca atravessar o barco
        if (pPos[ix + 2] > lines.zAft && pPos[ix + 2] < lines.zBow && pPos[ix + 1] > -0.2) {
          const hb = halfBeamBody(pPos[ix + 2], pPos[ix + 1]);
          if (Math.abs(pPos[ix]) < hb && pPos[ix + 1] < 1.35) {
            const sgn = pPos[ix] >= 0 ? 1 : -1;
            pPos[ix] = sgn * (hb + 0.02);
            pVel[ix] = sgn * Math.abs(pVel[ix]) * 0.3;
          }
          if (pPos[ix + 2] > lines.houseBack && pPos[ix + 2] < lines.houseFront && Math.abs(pPos[ix]) < 1.25 && pPos[ix + 1] < 2.4) {
            const sgn = pPos[ix] >= 0 ? 1 : -1;
            pPos[ix] = sgn * 1.28;
            pVel[ix] = sgn * Math.abs(pVel[ix]) * 0.2;
          }
        }

        if (pPos[ix + 1] < -0.15 && pVel[ix + 1] < 0) {
          pLife[i] = 0;
          continue;
        }

        const ageF = pAge[i] / pLife[i];
        const sz = pSize[i] * (1 + SPRAY_GROW[k] * pAge[i]);
        const j4 = activeCount * 4;
        iPos[j4] = pPos[ix];
        iPos[j4 + 1] = pPos[ix + 1];
        iPos[j4 + 2] = pPos[ix + 2];
        iPos[j4 + 3] = sz;

        iVel[j4] = pVel[ix];
        iVel[j4 + 1] = pVel[ix + 1];
        iVel[j4 + 2] = pVel[ix + 2];
        iVel[j4 + 3] = k;

        iMeta[j4] = ageF;
        iMeta[j4 + 1] = SPRAY_ALPHA[k];
        iMeta[j4 + 2] = pSeed[i];
        iMeta[j4 + 3] = k === SPRAY_KIND.MIST ? 0.0 : 0.025;
        activeCount++;
      }

      instGeo.instanceCount = activeCount;
      mesh.visible = activeCount > 0;
      if (activeCount > 0) {
        attrPos.needsUpdate = true;
        attrVel.needsUpdate = true;
        attrMeta.needsUpdate = true;
      }
    },
    dispose() {
      baseGeo.dispose();
      instGeo.dispose();
      mat.dispose();
      texSpray.dispose();
    },
  };
}

// ============================================================================
// 10. Constantes compartilhadas e funções puras (sem WebGL)
// ============================================================================

const SHARED_LINES = new HullLines();

function computeDimensions(L) {
  let maxBeam = 0;
  for (let i = 0; i <= 200; i++) maxBeam = Math.max(maxBeam, L.sheerX(i / 200));
  let minSheer = Infinity;
  for (let i = 0; i <= 200; i++) minSheer = Math.min(minSheer, L.sheerY(i / 200));
  let maxWL = 0;
  for (let z = L.wlStart; z <= L.wlEnd; z += 0.02) maxWL = Math.max(maxWL, L.halfBeamAt(z));

  return Object.freeze({
    length: L.length,
    beam: maxBeam * 2,
    halfBeam: maxBeam,
    draft: -KEEL.bottom,
    freeboard: minSheer,
    freeboardBow: L.sheerY(1),
    deckHeight: L.deckY,
    hullDepth: L.draftAt(L.centerOfFlotationZ),
    waterlineLength: L.wlEnd - L.wlStart,
    waterlineBeam: 2 * maxWL,
    houseRoofHeight: roofTopY(0),
    zAft: L.zAft,
    zBow: L.zBow,
  });
}

function buildColliders(L) {
  const boxes = [];
  const add = (tag, min, max, walkable = false, solid = true) => {
    const center = V().addVectors(min, max).multiplyScalar(0.5);
    const half = V().subVectors(max, min).multiplyScalar(0.5);
    boxes.push({ tag, center, half, walkable, solid });
  };

  const inner = (z) => L.halfBreadth(L.tAtSheerZ(z), L.deckY) - L.shell;
  add('deck', V(-inner(-1.5), L.deckY - 0.1, L.zAft + L.shell), V(inner(-1.5), L.deckY, HOUSE.dash.zFace), true, false);

  for (const [z0, z1] of [[L.zAft, -2.3], [-2.3, -0.7], [-0.7, L.houseFront]]) {
    const t0 = L.tAtSheerZ(z0);
    const t1 = L.tAtSheerZ(z1);
    const top = Math.max(L.sheerY(t0), L.sheerY(t1)) + 0.045;
    const xo = Math.max(L.sheerX(t0), L.sheerX(t1));
    const xi = Math.min(inner(z0), inner(z1));
    for (const s of [1, -1]) {
      add('bulwark', V(Math.min(s * xi, s * xo), L.deckY, z0), V(Math.max(s * xi, s * xo), top, z1));
    }
  }

  add('transom', V(-L.sheerX(0), L.deckY, L.zAft), V(L.sheerX(0), L.sheerY(0) + 0.045, L.zAft + L.shell));
  for (const s of [1, -1]) {
    const x0 = houseHalfWidth(L, L.houseBack) - HOUSE.wallT;
    const x1 = houseHalfWidth(L, L.houseBack);
    add('houseWall', V(Math.min(s * x0, s * x1), L.sheerY(L.tAtSheerZ(L.houseBack)), L.houseBack), V(Math.max(s * x0, s * x1), HOUSE.roofUnderY, L.houseFront));
  }

  const d = HOUSE.dash;
  add('console', V(-d.halfW, L.deckY, d.zFace), V(d.halfW, d.yTop, L.houseFront));
  add('windshield', V(-d.halfW + 0.04, d.yTop, 1.2), V(d.halfW - 0.04, HOUSE.roofUnderY, L.houseFront));
  add('helmSeat', V(HOUSE.helmX - 0.23, L.deckY, HOUSE.seatZ - 0.22), V(HOUSE.helmX + 0.23, 1.05, HOUSE.seatZ + 0.18));
  add('bench', V(0.65, L.deckY, 0.075), V(1.07, L.deckY + 0.47, 0.825), true);
  add('roof', V(-1.25, HOUSE.roofUnderY, HOUSE.roofZ0), V(1.25, roofTopY(0), HOUSE.roofZ1), true);
  for (const [x, level, z] of TRAPS) {
    const y0 = L.deckY + 0.03 + level * (TRAP.H + 0.035);
    add('trap', V(x - TRAP.W / 2, y0, z - TRAP.L / 2), V(x + TRAP.W / 2, y0 + TRAP.H, z + TRAP.L / 2), true);
  }
  add('hauler', V(HAULER.x - 0.2, L.deckY, HAULER.z - 0.08), V(HAULER.x + 0.2, HAULER.y + 0.2, HAULER.z + 0.25));
  add('baitBarrel', V(0.6, L.deckY, -1.06), V(1.12, L.deckY + 0.8, -0.54));

  for (const [z0, z1] of [[L.houseFront, 2.4], [2.4, 3.3], [3.3, 4.15]]) {
    const t0 = L.tAtSheerZ(z0);
    const t1 = L.tAtSheerZ(z1);
    const w = L.sheerX(t0) - L.shell;
    add('foredeck', V(-w, L.deckY, z0), V(w, (L.sheerY(t0) + L.sheerY(t1)) / 2 + 0.06, z1), true);
  }
  return boxes;
}

const SHARED_COLLIDERS = buildColliders(SHARED_LINES);

export const DIMENSOES_BARCO_TIDEWATER = computeDimensions(SHARED_LINES);

// Posição local dos pés ao leme (livre de colisão entre console e banco do timoneiro)
export const POSICAO_LEME_LOCAL = Object.freeze({
  x: HOUSE.helmX,
  y: SHARED_LINES.deckY,
  z: 0.69,
});

// Posição local de embarque no convés de trabalho (entre o cais e a escotilha)
export const POSICAO_EMBARQUE_LOCAL = Object.freeze({
  x: 0,
  y: SHARED_LINES.deckY,
  z: -1.75,
});

// Patches hidrostáticos do casco (8 fatias longitudinais x 4 faixas laterais)
export const AMOSTRAS_CASCO_LOCAL = Object.freeze(
  SHARED_LINES.buildHullSamples(8).map((s) =>
    Object.freeze({
      x: s.x,
      y: s.y,
      z: s.z,
      position: Object.freeze({ x: s.x, y: s.y, z: s.z }),
      area: s.area,
      depth: s.depth,
      bottomY: s.bottomY,
    })
  )
);

export function pontoNoConvesLocal(lx, lz) {
  if (!Number.isFinite(lx) || !Number.isFinite(lz)) return false;
  const L = SHARED_LINES;
  if (lz < L.zAft + L.shell || lz > 4.18) return false;
  const t = L.tAtSheerZ(lz);
  const halfW =
    lz < L.houseBack
      ? Math.max(0.15, L.halfBreadth(t, L.deckY) - L.shell)
      : Math.max(0.08, L.sheerX(t) - L.shell);
  return Math.abs(lx) <= halfW;
}

export function alturaConvesLocal(lx, lz, lyAtual = null) {
  if (!pontoNoConvesLocal(lx, lz)) return null;
  const L = SHARED_LINES;
  const t = L.tAtSheerZ(lz);
  let g = L.deckY;

  if (lz >= L.houseFront) {
    g = foredeckY(L, t, lx);
  } else if (lz >= L.houseBack) {
    const washIn = houseHalfWidth(L, lz) - 0.045;
    const deckIn = L.halfBreadth(t, L.deckY) - L.shell;
    if (Math.abs(lx) >= washIn && (Math.abs(lx) > deckIn || (lyAtual !== null && Number.isFinite(lyAtual) && lyAtual >= L.sheerY(t) - 0.45))) {
      g = Math.max(g, L.sheerY(t));
    }
  }

  const hasLy = lyAtual !== null && lyAtual !== undefined && Number.isFinite(lyAtual);
  const maxY = hasLy ? lyAtual + 0.45 : 1.85;

  for (const c of SHARED_COLLIDERS) {
    if (!c.walkable || c.tag === 'deck' || c.tag === 'foredeck') continue;
    if (!hasLy && c.tag === 'roof') continue;
    if (Math.abs(lx - c.center.x) > c.half.x || Math.abs(lz - c.center.z) > c.half.z) continue;
    const top = c.tag === 'roof' ? roofTopY(lx) : c.center.y + c.half.y;
    if (top <= maxY && top > g) g = top;
  }
  return g;
}

export function colideObstaculoBarcoLocal(lx, ly, lz, raio = 0.28) {
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) return false;
  const r = Number.isFinite(raio) && raio >= 0 ? raio : 0.28;
  const DECK_STEP = 0.38;
  const PLAYER_H = 1.78;

  for (const c of SHARED_COLLIDERS) {
    if (!c.solid) continue;
    const top = c.center.y + c.half.y;
    const bot = c.center.y - c.half.y;
    if (top <= ly + DECK_STEP || bot >= ly + PLAYER_H) continue;
    if (Math.abs(lx - c.center.x) < c.half.x + r && Math.abs(lz - c.center.z) < c.half.z + r) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// 11. createBarcoTidewater — constrói o modelo completo + animação + VFX + dispose
// ============================================================================

const STATIC_BUCKETS = ['hull', 'gelcoat', 'wood', 'fittings', 'trap', 'glow', 'glass'];
const WHEEL_TURNS = 0.75;
const THROTTLE_ANGLE = 0.6;
const RADAR_RPM = 24;
const PROP_DISPLAY_RPS = 5;

function transverseInertia(lines) {
  let I = 0;
  const n = 800;
  const z0 = lines.wlStart;
  const dz = (lines.wlEnd - lines.wlStart) / n;
  for (let i = 0; i < n; i++) {
    I += (2 / 3) * Math.pow(lines.halfBeamAt(z0 + (i + 0.5) * dz), 3) * dz;
  }
  return I;
}

export function createBarcoTidewater(opts = {}) {
  const lines = SHARED_LINES;
  const materials = new BoatMaterials(lines);
  const kit = new GeoKit();
  const parts = {};

  buildHull(kit, lines);
  buildWheelhouse(kit, lines, parts);
  buildDeckGear(kit, lines, parts);

  const group = new THREE.Group();
  group.name = opts.name || 'BarcoTidewater';
  const meshes = {};

  for (const name of STATIC_BUCKETS) {
    const geo = kit.merged(name);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, materials[name]);
    mesh.name = 'boat-' + name;
    mesh.castShadow = name !== 'glass';
    mesh.receiveShadow = true;
    if (name === 'glass') mesh.renderOrder = 1;
    group.add(mesh);
    meshes[name] = mesh;
  }

  const addPart = (name, geo, mat, position, parent = group) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'boat-' + name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);
    parent.add(mesh);
    meshes[name] = mesh;
    return mesh;
  };

  const wheelPivot = new THREE.Object3D();
  wheelPivot.name = 'boat-wheel-pivot';
  wheelPivot.position.copy(parts.wheelCenter);
  wheelPivot.quaternion.setFromUnitVectors(V(0, 0, 1), parts.wheelAxis);
  group.add(wheelPivot);
  const wheelMesh = addPart('wheel', wheelGeometry(), materials.wood, V(), wheelPivot);
  const throttleMesh = addPart('throttle', throttleGeometry(), materials.fittings, parts.throttlePivot);
  const radarMesh = addPart('radar', radarArrayGeometry(), materials.fittings, parts.radarPivot);
  const propMesh = addPart('propeller', propellerGeometry(), materials.fittings, PROP.position);
  const rudderMesh = addPart('rudder', rudderGeometry(), materials.fittings, RUDDER.pivot);

  materials.flagPivot.value.copy(parts.flagPivot);

  // Esteira em V e Spray de Proa
  const wake = createWakeEffect();
  group.add(wake.pivot);
  meshes.wake = wake.mesh;

  const spray = createBoatSprayEffect(lines);
  group.add(spray.mesh);
  meshes.spray = spray.mesh;

  // Dimensões & hidrostática
  const kv = keelVolume(lines);
  const displaced = lines.canoeVolume + kv;
  const dimensions = DIMENSOES_BARCO_TIDEWATER;
  const mass = Math.round(RHO_SEAWATER * lines.canoeVolume);
  const kRoll = 0.36 * dimensions.beam;
  const kPitch = 0.26 * lines.length;
  const kYaw = 0.27 * lines.length;

  const hydro = {
    waterplaneArea: lines.waterplaneArea,
    canoeVolume: lines.canoeVolume,
    keelVolume: kv,
    displacedVolume: displaced,
    suggestedMass: mass,
    massWithKeel: Math.round(RHO_SEAWATER * displaced),
    centerOfBuoyancy: lines.centerOfBuoyancy.clone(),
    centerOfFlotationZ: lines.centerOfFlotationZ,
    waterlineStart: lines.wlStart,
    waterlineEnd: lines.wlEnd,
    seawaterDensity: RHO_SEAWATER,
    centerOfMass: V(0, 0.3, lines.centerOfBuoyancy.z),
    inertia: V(mass * kPitch * kPitch, mass * kYaw * kYaw, mass * kRoll * kRoll),
    metacentricRadius: transverseInertia(lines) / lines.canoeVolume,
  };

  const helmEye = V(HOUSE.helmX, 1.85, 0.3);
  const boardPoint = V(POSICAO_EMBARQUE_LOCAL.x, POSICAO_EMBARQUE_LOCAL.y, POSICAO_EMBARQUE_LOCAL.z);
  const exitPoints = [];
  for (const z of [-3.0, -2.0, -1.2]) {
    const t = lines.tAtSheerZ(z);
    for (const s of [1, -1]) exitPoints.push(V(s * (lines.sheerX(t) - 0.035), lines.sheerY(t) + 0.05, z));
  }
  const bowSprayPoints = [];
  for (const z of [2.0, 2.6, 3.2, 3.8]) {
    const hb = lines.halfBeamAt(z);
    for (const s of [1, -1]) bowSprayPoints.push(V(s * (hb + 0.01), 0.05, z));
  }
  const hullSamples = lines.buildHullSamples(8);
  const colliders = buildColliders(lines);

  let _steer = 0;
  let _throttle = 0;
  let _rpm = 0;
  let _propAngle = 0;
  let _radarAngle = 0;
  let _time = 0;
  const _lastPos = V();
  let _hasLastPos = false;
  const _vel = V();
  const _flagDir = V(0, 0, -1);
  let _flagWind = 0.5;

  const _v = V();
  const _pos = V();
  const _scale = V();
  const _q = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();
  const _ang = V();
  const _fwd = V();

  function setSteering(angle) {
    const a = clamp(Number.isFinite(angle) ? angle : 0, -1, 1);
    _steer = a;
    wheelMesh.rotation.z = -a * WHEEL_TURNS * Math.PI * 2;
    rudderMesh.rotation.y = -a * RUDDER.maxAngle;
  }

  function setWheel(angle) {
    setSteering(angle);
  }

  function setThrottle(t) {
    _throttle = clamp(Number.isFinite(t) ? t : 0, -1, 1);
    throttleMesh.rotation.x = _throttle * THROTTLE_ANGLE;
  }

  function setPropellerRPM(rpm) {
    _rpm = Number.isFinite(rpm) ? rpm : 0;
  }

  function setNavLights(on) {
    materials.setNavLights(on);
  }

  function setLuzes(val) {
    materials.setLuzes(val);
  }

  if (opts.navLights !== undefined) setNavLights(opts.navLights);
  if (opts.luzes !== undefined) setLuzes(opts.luzes);
  setSteering(opts.steering ?? 0);
  setThrottle(opts.throttle ?? 0);

  function update(dt, state = {}) {
    if (!(dt > 0)) return;
    _time += dt;

    if (state) {
      if (state.steering !== undefined || state.steer !== undefined || state.wheel !== undefined) {
        setSteering(state.steering ?? state.steer ?? state.wheel);
      }
      if (state.throttle !== undefined) setThrottle(state.throttle);
      if (state.rpm !== undefined || state.propellerRPM !== undefined) {
        setPropellerRPM(state.rpm ?? state.propellerRPM);
      }
      if (state.navLights !== undefined) setNavLights(state.navLights);
      if (state.luzes !== undefined || state.lights !== undefined) {
        setLuzes(state.luzes ?? state.lights);
      }
    }

    const rps = _rpm / 60;
    const shown = PROP_DISPLAY_RPS * Math.tanh(rps / PROP_DISPLAY_RPS);
    _propAngle = (_propAngle + shown * Math.PI * 2 * dt) % (Math.PI * 2);
    propMesh.rotation.z = _propAngle;

    _radarAngle = (_radarAngle + (RADAR_RPM / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    radarMesh.rotation.y = _radarAngle;

    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(_pos, _q, _scale);

    const extVel = state?.velocity;
    if (extVel && Number.isFinite(extVel.x ?? extVel[0])) {
      _vel.set(extVel.x ?? extVel[0] ?? 0, extVel.y ?? extVel[1] ?? 0, extVel.z ?? extVel[2] ?? 0);
    } else if (_hasLastPos) {
      _v.subVectors(_pos, _lastPos).divideScalar(dt);
      if (_v.lengthSq() < 900) _vel.lerp(_v, 1 - Math.exp(-dt * 4));
    }
    _lastPos.copy(_pos);
    _hasLastPos = true;

    const wind = state?.wind || U.uWind.value;
    const wx = wind.x ?? wind[0] ?? 0.83;
    const wy = wind.y ?? wind[1] ?? 0.55;
    const wz = wind.z ?? wind[2] ?? 0.85;
    const windSpeed = Math.max(0, wz) * 5.5;
    const tShader = Number.isFinite(state?.time) ? state.time : U.uTime.value || _time;
    const night = Number.isFinite(state?.nightFactor)
      ? state.nightFactor
      : Number.isFinite(state?.night)
        ? state.night
        : U.uNight.value;

    materials.uTime.value = tShader;
    materials.uNight.value = clamp01(night);
    materials.uWindSpeed.value = windSpeed;

    _qInv.copy(_q).invert();
    _v.set(wx * windSpeed, 0, wy * windSpeed).sub(_vel).applyQuaternion(_qInv);
    _v.y = 0;
    const appSpeed = _v.length();
    if (appSpeed > 1e-3) {
      _v.divideScalar(appSpeed);
      _flagDir.lerp(_v, 1 - Math.exp(-dt * 3));
      if (_flagDir.lengthSq() < 1e-4) _flagDir.copy(_v);
      _flagDir.normalize();
    }
    _flagWind += (clamp01(appSpeed / 9) - _flagWind) * (1 - Math.exp(-dt * 2));
    materials.flagDir.value.copy(_flagDir);
    materials.flagWind.value = _flagWind;

    _fwd.set(0, 0, 1).applyQuaternion(_q);
    const fwdSpeed = Number.isFinite(state?.forwardSpeed)
      ? state.forwardSpeed
      : Number.isFinite(state?.speed)
        ? state.speed
        : _vel.dot(_fwd);

    wake.update(dt, _q, fwdSpeed, _rpm, _throttle, _steer);

    const extAng = state?.angular;
    if (extAng && Number.isFinite(extAng.x ?? extAng[0])) {
      _ang.set(extAng.x ?? extAng[0] ?? 0, extAng.y ?? extAng[1] ?? 0, extAng.z ?? extAng[2] ?? 0);
    } else {
      _ang.set(0, 0, 0);
    }

    spray.update(
      dt,
      _pos,
      _q,
      _vel,
      _ang,
      tShader,
      wind,
      _rpm,
      _throttle,
      state?.sampleWaterAt || opts.sampleWaterAt || null,
      state?.onSlam || opts.onSlam || null
    );
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    wake.dispose();
    spray.dispose();
    const disposedGeos = new Set();
    for (const m of Object.values(meshes)) {
      if (m?.geometry && !disposedGeos.has(m.geometry)) {
        disposedGeos.add(m.geometry);
        m.geometry.dispose();
      }
    }
    group.traverse((child) => {
      if (child.geometry && !disposedGeos.has(child.geometry)) {
        disposedGeos.add(child.geometry);
        child.geometry.dispose();
      }
    });
    materials.dispose();
    group.clear();
  }

  return {
    group,
    meshes,
    lines,
    dimensions,
    hydro,
    hullSamples,
    colliders,
    helmEye,
    boardPoint,
    exitPoints,
    bowSprayPoints,
    propeller: PROP.position.clone(),
    rudder: RUDDER.pivot.clone(),
    setWheel,
    setSteering,
    setThrottle,
    setPropellerRPM,
    setLuzes,
    setNavLights,
    update,
    pontoNoConvesLocal,
    alturaConvesLocal,
    colideObstaculoBarcoLocal,
    createHullVolumeGeometry: () => buildHullVolume(lines),
    dispose,
  };
}
