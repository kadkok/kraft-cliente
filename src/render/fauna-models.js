// Anatomia visual original, itch-first PASS: docs/grafico-som-codex/ITCH-FAUNA.md.
// Uma geometria por família, partes articuladas identificadas em atributos de vértice.
import * as THREE from '../three.js';

class Model {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.j = []; this.coat = []; this.idx = []; }
  add(g, { at = [0, 0, 0], scale = [1, 1, 1], rotate = [0, 0, 0], color = '#ffffff', tile = 6, coat = 0, joint = [0, 0, 0, 0] } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotate)), new THREE.Vector3(...scale));
    g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, pc = g.attributes.color, cm = g.attributes.aCoatMask, base = this.p.length / 3, c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.p.push(p.getX(i), p.getY(i), p.getZ(i)); this.n.push(n.getX(i), n.getY(i), n.getZ(i));
      // Margem de 2 pixels para reduzir contaminação entre células nos mipmaps.
      this.uv.push((tile % 4 + .035 + (uv?.getX(i) || 0) * .93) / 4, (Math.floor(tile / 4) + .035 + (uv?.getY(i) || 0) * .93) / 4);
      this.c.push(pc ? pc.getX(i) : c.r, pc ? pc.getY(i) : c.g, pc ? pc.getZ(i) : c.b); this.coat.push(cm ? cm.getX(i) : coat); this.j.push(...joint);
    }
    if (g.index) for (const i of g.index.array) this.idx.push(base + i);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }
  oval(at, scale, options = {}) { const { segments = 8, rings = 5, ...rest } = options; this.add(new THREE.SphereGeometry(1, segments, rings), { at, scale, ...rest }); }
  // Superfície contínua por seções: peito/ventre são pintura da mesma malha.
  body(profiles, { segments = 12, belly = '#d6cbb0', fuzz = 0, ...options } = {}) {
    const p = [], uv = [], c = [], mask = [], idx = [], cream = new THREE.Color(belly), white = new THREE.Color('#ffffff');
    for (let r = 0; r < profiles.length; r++) {
      const [z, cy, rx, ry] = profiles[r];
      for (let s = 0; s <= segments; s++) {
        const a = s / segments * Math.PI * 2, sn = Math.sin(a), cs = Math.cos(a);
        const tuft = 1 + fuzz * Math.sin(a * 5 + r * 3.7);
        p.push(cs * rx * tuft, cy + sn * ry * tuft, z); uv.push(s / segments, r / (profiles.length - 1));
        const amount = Math.min(1, Math.max(0, (-sn + .05) / .85));
        const smooth = amount * amount * (3 - 2 * amount), col = white.clone().lerp(cream, smooth);
        c.push(col.r, col.g, col.b); mask.push(1 - smooth);
        if (r && s) { const q = r * (segments + 1) + s; idx.push(q, q - 1, q - segments - 2, q, q - segments - 2, q - segments - 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    for (const [name, array, size] of [['position', p, 3], ['uv', uv, 2], ['color', c, 3], ['aCoatMask', mask, 1]]) g.setAttribute(name, new THREE.Float32BufferAttribute(array, size));
    g.setIndex(idx); g.computeVertexNormals();
    // A costura UV duplica vértices; a normal deve continuar suave ao atravessá-la.
    const normal = g.attributes.normal, seam = new THREE.Vector3();
    for (let r = 0; r < profiles.length; r++) {
      const a = r * (segments + 1), b = a + segments;
      seam.set(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b), normal.getZ(a) + normal.getZ(b)).normalize();
      normal.setXYZ(a, seam.x, seam.y, seam.z); normal.setXYZ(b, seam.x, seam.y, seam.z);
    }
    this.add(g, options);
  }
  link(a, b, ra, rb, options = {}) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), d = bv.clone().sub(av);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    this.add(new THREE.CylinderGeometry(rb, ra, d.length(), 5, 1), { at: av.add(bv).multiplyScalar(.5).toArray(), rotate: [e.x, e.y, e.z], ...options });
  }
  fan(points, options = {}) {
    if (options.rounded) points = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), true, 'centripetal').getPoints(points.length * 3).slice(0, -1).map(p => p.toArray());
    const p = [], uv = [], idx = [], minX = Math.min(...points.map(v => v[0])), maxX = Math.max(...points.map(v => v[0]));
    const minZ = Math.min(...points.map(v => v[2])), maxZ = Math.max(...points.map(v => v[2]));
    for (const v of points) { p.push(...v); uv.push((v[0] - minX) / (maxX - minX || 1), (v[2] - minZ) / (maxZ - minZ || 1)); }
    if (options.rounded) for (const tri of THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(p[0], p[2])), [])) idx.push(...tri);
    else for (let i = 1; i < points.length - 1; i++) idx.push(0, i, i + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); this.add(g, options);
  }
  eyes(x, y, z, r, options = {}) {
    for (const side of [-1, 1]) {
      this.oval([side * x, y, z], [r * .62, r, r * .95], { color: '#171919', segments: 6, rings: 4, ...options });
      this.oval([side * (x + r * .4), y + r * .32, z + r * .3], [r * .23, r * .25, r * .25], { color: '#eee8d5', segments: 4, rings: 3, ...options });
    }
  }
  finish() {
    const g = new THREE.BufferGeometry();
    for (const [name, array, size] of [['position', this.p, 3], ['normal', this.n, 3], ['uv', this.uv, 2], ['color', this.c, 3], ['aJoint', this.j, 4], ['aCoatMask', this.coat, 1]]) g.setAttribute(name, new THREE.Float32BufferAttribute(array, size));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}

function bird(m) {
  m.body([[-.12, .074, .002, .002], [-.09, .078, .025, .029], [-.035, .077, .052, .055], [.025, .077, .056, .062], [.067, .092, .047, .053], [.098, .108, .033, .039], [.12, .11, .002, .002]], { tile: 1, belly: '#dfcba5' });
  m.oval([0, .126, .084], [.041, .039, .047], { tile: 1, coat: 1, segments: 12, rings: 7 });
  m.link([0, .117, .125], [0, .111, .161], .013, .001, { color: '#625146' });
  m.eyes(.036, .134, .109, .0055);
  for (const s of [-1, 1]) {
    const joint = [s * .039, .09, .025, s < 0 ? 1 : 2];
    const points = [[.039, .09, .045], [.10, .098, .067], [.18, .094, .017], [.28, .075, -.105], [.235, .074, -.092], [.208, .072, -.118], [.181, .072, -.100], [.16, .071, -.117], [.13, .075, -.09], [.07, .08, -.065]].map(v => [v[0] * s, v[1], v[2]]);
    m.fan(points, { tile: 1, color: '#c1b49f', coat: .9, joint });
    m.oval([s * .076, .09, .007], [.067, .012, .053], { tile: 1, coat: 1, joint, segments: 6, rings: 4, rotate: [0, s * .25, 0] });
    for (let f = 0; f < 4; f++) {
      const x = .11 + f * .028;
      m.fan([[s * x, .078, -.01 - f * .015], [s * (x + .017), .078, -.023 - f * .015], [s * (x + .04), .076, -.088 - f * .008]], { color: '#534e48', tile: 1, joint });
    }
    m.link([s * .021, .045, .015], [s * .024, .012, .032], .004, .003, { color: '#776654' });
    m.link([s * .024, .008, .026], [s * .03, .008, .056], .003, .0015, { color: '#776654' });
  }
  m.fan([[-.027, .07, -.08], [.027, .07, -.08], [.04, .06, -.195], [.004, .06, -.18], [-.036, .06, -.198]], { tile: 1, color: '#756a5b', joint: [0, .07, -.08, 3] });
}

function butterfly(m) {
  m.oval([0, .031, 0], [.006, .007, .029], { color: '#40392e', segments: 6, rings: 4 });
  m.oval([0, .034, .028], [.007, .008, .009], { color: '#39352d', segments: 6, rings: 4 });
  for (const s of [-1, 1]) {
    const joint = [s * .004, .032, .006, s < 0 ? 1 : 2];
    m.fan([[s * .004, .032, .008], [s * .026, .033, .044], [s * .057, .034, .061], [s * .075, .034, .052], [s * .083, .033, .031], [s * .072, .032, .013], [s * .041, .032, -.004]], { tile: 2, coat: 1, joint, rounded: true });
    m.fan([[s * .004, .032, .005], [s * .041, .032, -.001], [s * .062, .033, -.024], [s * .052, .033, -.048], [s * .034, .033, -.057], [s * .017, .032, -.05], [s * .005, .032, -.024]], { tile: 2, coat: 1, joint, rounded: true });
    m.link([s * .003, .04, .031], [s * .014, .05, .052], .0012, .0007, { color: '#494032' });
  }
}

function fish(m) {
  m.body([[-.177, .086, .008, .014], [-.125, .087, .021, .035], [-.07, .087, .04, .061], [0, .085, .05, .072], [.073, .089, .044, .06], [.126, .093, .03, .037], [.166, .09, .011, .015], [.176, .089, .001, .004]], { tile: 3, belly: '#d5d6c7' });
  m.eyes(.028, .109, .126, .0067);
  for (const s of [-1, 1]) {
    m.fan([[s * .036, .08, .049], [s * .092, .048, -.015], [s * .061, .045, -.047]], { color: '#aba78d', tile: 1, joint: [s * .035, .08, .05, s < 0 ? 1 : 2] });
    m.link([s * .041, .063, .108], [s * .041, .12, .104], .0016, .0016, { color: '#5e6f65' });
  }
  m.fan([[0, .095, -.13], [0, .165, -.244], [0, .094, -.221], [0, .026, -.244]], { color: '#bcb598', tile: 1 });
  m.fan([[0, .143, .05], [0, .211, -.031], [0, .142, -.095]], { color: '#a3ac91', tile: 1 });
  m.fan([[0, .041, .015], [0, .013, -.09], [0, .06, -.12]], { color: '#c5c0a1', tile: 1 });
}

function mouse(m) {
  m.body([[-.109, .047, .002, .002], [-.081, .054, .036, .04], [-.027, .059, .05, .049], [.024, .057, .046, .043], [.06, .063, .033, .03], [.091, .065, .032, .027], [.124, .057, .018, .016], [.146, .056, .004, .005]], { tile: 0, belly: '#d4c5b0' });
  m.oval([0, .059, .146], [.008, .006, .006], { color: '#b4867d', tile: 7, segments: 6, rings: 4 });
  m.eyes(.026, .078, .09, .0056);
  for (const s of [-1, 1]) {
    m.oval([s * .028, .108, .055], [.022, .027, .008], { tile: 0, coat: 1, segments: 7, rings: 4 });
    m.oval([s * .028, .11, .062], [.015, .02, .002], { tile: 7, color: '#c9a29a', segments: 7, rings: 4 });
    for (const z of [-.053, .065]) {
      const joint = [s * .032, .04, z, (z > 0 ? 4 : 6) + (s > 0 ? 1 : 0)];
      m.link([s * .032, .04, z - .005], [s * .038, .015, z], .012, .006, { tile: 0, coat: 1, joint });
      m.oval([s * .038, .012, z], [.012, .009, .026], { color: '#ba9c8b', tile: 7, joint, segments: 6, rings: 3 });
    }
    for (let j = 0; j < 3; j++) m.link([s * .018, .058, .126], [s * (.067 + j * .004), .056 + j * .003, .111 + j * .014], .00065, .0002, { color: '#dbd0b9' });
  }
  const tail = [[0, .032, -.094], [.018, .022, -.142], [.047, .012, -.189], [.064, .01, -.221], [.054, .012, -.24]];
  for (let i = 0; i < tail.length - 1; i++) m.link(tail[i], tail[i + 1], .006 - i * .0013, .0045 - i * .0013, { tile: 7, color: '#af9487', joint: [0, .03, -.09, 3] });
}

function frog(m) {
  m.body([[-.103, .048, .002, .002], [-.07, .059, .047, .039], [-.021, .066, .068, .048], [.031, .074, .067, .037], [.071, .08, .057, .026], [.098, .077, .031, .012], [.104, .077, .002, .003]], { tile: 4, belly: '#c5c3a0' });
  m.oval([0, .06, .078], [.038, .011, .023], { color: '#d0c8ab', tile: 7, joint: [0, .065, .065, 9] });
  for (const s of [-1, 1]) {
    const joint = [s * .055, .043, -.03, s < 0 ? 6 : 7];
    m.oval([s * .077, .039, -.051], [.036, .035, .066], { tile: 4, coat: 1, joint, segments: 7, rings: 4, rotate: [0, s * .4, 0] });
    m.link([s * .088, .024, -.08], [s * .067, .013, -.005], .012, .008, { tile: 4, coat: 1, joint });
    m.link([s * .051, .069, .038], [s * .083, .012, .065], .012, .006, { tile: 4, coat: 1 });
    for (let t = 0; t < 3; t++) m.link([s * .083, .012, .065], [s * (.066 + t * .013), .006, .099 + (t === 1 ? .01 : 0)], .0035, .0015, { color: '#9d9e76' });
    m.oval([s * .042, .108, .064], [.017, .015, .019], { tile: 4, coat: 1, segments: 8, rings: 5 });
    m.oval([s * .046, .112, .078], [.011, .009, .007], { color: '#beaa63', segments: 8, rings: 5 });
    m.oval([s * .047, .113, .084], [.008, .003, .002], { color: '#232b23', segments: 6, rings: 3 });
    m.oval([s * .044, .116, .086], [.0015, .0015, .001], { color: '#f2e7c7', segments: 4, rings: 3 });
    m.link([s * .012, .077, .104], [s * .057, .073, .085], .0012, .001, { color: '#67704f' });
  }
}

function sheep(m) {
  m.body([[-.396, .47, .02, .035], [-.33, .49, .17, .20], [-.22, .49, .245, .25], [-.07, .49, .262, .26], [.09, .5, .248, .245], [.22, .52, .19, .21], [.29, .54, .10, .13], [.32, .55, .015, .025]], { tile: 5, belly: '#ccc1a8', segments: 16, fuzz: .032 });
  const head = [0, .57, .22, 8];
  m.oval([0, .59, .27], [.12, .16, .13], { tile: 5, coat: 1, joint: head });
  m.oval([0, .63, .38], [.089, .102, .125], { color: '#7b7062', tile: 0, joint: head });
  m.oval([0, .58, .476], [.073, .068, .055], { color: '#62594e', tile: 7, joint: head });
  m.eyes(.079, .651, .415, .0105, { joint: head });
  for (const s of [-1, 1]) {
    m.oval([s * .125, .665, .335], [.079, .025, .04], { color: '#9b8a76', tile: 0, rotate: [0, 0, s * -.3], joint: head, segments: 6, rings: 4 });
    m.oval([s * .143, .667, .36], [.049, .012, .009], { color: '#c0a792', tile: 7, joint: head, segments: 6, rings: 3 });
    for (const z of [-.23, .20]) {
      const joint = [s * .15, .4, z, (z > 0 ? 4 : 6) + (s > 0 ? 1 : 0)];
      m.link([s * .15, .42, z], [s * .15, .07, z + .015], .052, .029, { color: '#8d8270', tile: 0, joint });
      m.oval([s * .15, .041, z + .026], [.038, .036, .053], { color: '#48483e', joint, segments: 6, rings: 3 });
    }
  }
  m.oval([0, .43, -.397], [.047, .095, .047], { tile: 5, coat: 1, joint: [0, .49, -.35, 3], segments: 6, rings: 4 });
}

function clownfish(m) {
  m.body([[-.14, .06, .006, .012], [-.10, .06, .022, .034], [-.05, .06, .036, .054], [0, .06, .042, .062], [.06, .062, .038, .052], [.11, .064, .024, .03], [.14, .062, .006, .01]], { tile: 3, color: '#f46b27', belly: '#f6ede4' });
  m.eyes(.024, .076, .10, .006);
  for (const s of [-1, 1]) m.fan([[s * .03, .055, .035], [s * .078, .035, -.01], [s * .05, .035, -.035]], { color: '#f6f2ea', tile: 6, joint: [s * .03, .055, .035, s < 0 ? 1 : 2] });
  m.fan([[0, .065, -.11], [0, .125, -.19], [0, .065, -.175], [0, .015, -.19]], { color: '#f46b27', tile: 6 });
  m.fan([[0, .11, .04], [0, .155, -.02], [0, .11, -.07]], { color: '#f6f2ea', tile: 6 });
}

function marineFish(m, scale, col, belly, dorsal = true) {
  const s = scale;
  m.body([[-.22 * s, 0, .01 * s, .018 * s], [-.14 * s, 0, .03 * s, .05 * s], [-.05 * s, 0, .055 * s, .08 * s], [.06 * s, 0, .06 * s, .085 * s], [.16 * s, 0, .042 * s, .055 * s], [.24 * s, 0, .012 * s, .016 * s]], { tile: 3, color: col, belly });
  m.eyes(.035 * s, .02 * s, .17 * s, .008 * s);
  for (const side of [-1, 1]) m.fan([[side * .04 * s, -.01 * s, .06 * s], [side * .12 * s, -.05 * s, -.02 * s], [side * .07 * s, -.05 * s, -.06 * s]], { color: col, tile: 6 });
  m.fan([[0, .01 * s, -.18 * s], [0, .11 * s, -.30 * s], [0, 0, -.25 * s], [0, -.11 * s, -.30 * s]], { color: col, tile: 6 });
  if (dorsal) m.fan([[0, .06 * s, .04 * s], [0, .18 * s, -.04 * s], [0, .06 * s, -.10 * s]], { color: col, tile: 6 });
}

function rayModel(m) {
  m.body([[-1.1, 0, .02, .02], [-.55, 0, .26, .08], [0, 0, .52, .12], [.55, 0, .26, .08], [1.1, 0, .02, .02]], { tile: 6, color: '#39434c', belly: '#cfd5d8', rotate: [0, Math.PI / 2, 0] });
  m.fan([[0, 0, -.32], [.03, 0, -.32], [0, 0, -1.35], [-.03, 0, -.32]], { color: '#2b323a', tile: 6 });
}

function turtleModel(m) {
  m.oval([0, 0, 0], [.34, .14, .44], { color: '#4c5e3a', tile: 4, segments: 12, rings: 8 });
  m.oval([0, .02, .45], [.10, .09, .14], { color: '#5b6c45', tile: 4, segments: 8, rings: 6 });
  m.eyes(.07, .05, .52, .015);
  for (const s of [-1, 1]) {
    m.fan([[s * .28, 0, .22], [s * .68, -.03, .08], [s * .52, -.02, -.12], [s * .26, 0, .02]], { color: '#455736', tile: 4 });
    m.fan([[s * .22, -.02, -.28], [s * .42, -.04, -.46], [s * .26, -.03, -.48]], { color: '#455736', tile: 4 });
  }
}

function cetaceanModel(m, s, col, belly, dorsalH) {
  m.body([[-.48 * s, 0, .02 * s, .02 * s], [-.32 * s, 0, .06 * s, .06 * s], [-.12 * s, 0, .11 * s, .11 * s], [.10 * s, 0, .13 * s, .13 * s], [.30 * s, 0, .09 * s, .09 * s], [.46 * s, 0, .03 * s, .03 * s]], { tile: 6, color: col, belly });
  m.fan([[-.14 * s, 0, -.42 * s], [.14 * s, 0, -.42 * s], [0, 0, -.54 * s]], { color: col, tile: 6 });
  m.fan([[0, .08 * s, .06 * s], [0, (.08 + dorsalH) * s, -.06 * s], [0, .08 * s, -.14 * s]], { color: col, tile: 6 });
  for (const side of [-1, 1]) m.fan([[side * .10 * s, -.03 * s, .14 * s], [side * .28 * s, -.09 * s, .02 * s], [side * .18 * s, -.08 * s, -.04 * s]], { color: col, tile: 6 });
}

function octopusModel(m) {
  m.oval([0, .12, 0], [.18, .22, .20], { color: '#9c4a38', tile: 7, segments: 10, rings: 8 });
  m.eyes(.11, .06, .13, .022);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    m.link([Math.cos(a) * .12, -.02, Math.sin(a) * .12], [Math.cos(a) * .48, -.08, Math.sin(a) * .48], .045, .01, { color: '#b05d49', tile: 7 });
  }
}

function jellyfishModel(m) {
  m.oval([0, .10, 0], [.20, .13, .20], { color: '#8ab8de', tile: 6, segments: 12, rings: 6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    m.link([Math.cos(a) * .09, .02, Math.sin(a) * .09], [Math.cos(a) * .06, -.28, Math.sin(a) * .06], .014, .005, { color: '#c49ad6', tile: 6 });
  }
}

export function faunaGeometry(kind) {
  const m = new Model();
  const fn = {
    cardume: fish,
    rebanho: sheep,
    bando: bird,
    enxame: butterfly,
    ratos: mouse,
    sapos: frog,
    palhaco: clownfish,
    salmao: (mm) => marineFish(mm, 1.5, '#7e939e', '#d6dde0'),
    atum: (mm) => marineFish(mm, 2.8, '#3f6282', '#d2d8de'),
    agulhao: (mm) => marineFish(mm, 4.0, '#446d94', '#dce2e8'),
    tubarao: (mm) => marineFish(mm, 6.5, '#5d6b74', '#dde0e2'),
    arraia: rayModel,
    tartaruga: turtleModel,
    golfinho: (mm) => cetaceanModel(mm, 2.5, '#546b7e', '#dce2e6', .11),
    orca: (mm) => cetaceanModel(mm, 5.5, '#191d22', '#f2f4f6', .24),
    baleia: (mm) => cetaceanModel(mm, 13.0, '#304c66', '#98aab8', .05),
    polvo: octopusModel,
    aguaviva: jellyfishModel,
  }[kind];
  if (!fn) throw new Error(`Unknown fauna kind: ${kind}`);
  fn(m);
  return m.finish();
}

export function reefGeometry(kind) {
  const m = new Model();
  if (kind === 'anemona') {
    m.oval([0, .07, 0], [.24, .09, .24], { color: '#7e3340', segments: 10, rings: 5 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (i % 2) * .25;
      const r0 = .08 + (i % 3) * .045, r1 = r0 + .16 + (i % 2) * .07;
      const h = .34 + (i % 3) * .11;
      m.link([Math.cos(a) * r0, .08, Math.sin(a) * r0], [Math.cos(a) * r1, h, Math.sin(a) * r1], .032, .012, {
        color: i % 2 ? '#ea6c48' : '#f29064',
        joint: [Math.cos(a) * .2, h, Math.sin(a) * .2, 1],
      });
      m.oval([Math.cos(a) * r1, h, Math.sin(a) * r1], [.018, .018, .018], {
        color: '#ffe2ba', segments: 5, rings: 4, joint: [Math.cos(a) * .2, h, Math.sin(a) * .2, 1],
      });
    }
  } else if (kind === 'alga_marinha') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, d = .08 + (i % 2) * .10;
      const x0 = Math.cos(a) * d, z0 = Math.sin(a) * d;
      const h = 1.2 + (i % 3) * .35;
      for (let seg = 0; seg < 4; seg++) {
        const y0 = seg * (h / 4), y1 = (seg + 1) * (h / 4);
        const w = Math.sin(seg * 1.3 + i) * .08;
        const w2 = Math.sin((seg + 1) * 1.3 + i) * .08;
        m.link([x0 + w, y0, z0], [x0 + w2, y1, z0 + w * .5], .042 - seg * .006, .036 - seg * .007, {
          color: seg > 2 ? '#59a667' : '#2f7245',
          joint: [0, (seg + 1) / 4, 0, 1],
        });
      }
    }
  } else if (kind === 'ourico') {
    m.oval([0, .10, 0], [.14, .10, .14], { color: '#24182e', segments: 10, rings: 6 });
    for (let i = 0; i < 26; i++) {
      const phi = Math.acos(1 - (i + .5) / 26) * .72;
      const th = i * 2.39996;
      const dx = Math.sin(phi) * Math.cos(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.sin(th);
      m.link([dx * .10, .10 + dy * .08, dz * .10], [dx * .32, .10 + dy * .28, dz * .32], .014, .002, { color: i % 3 === 0 ? '#5c4674' : '#1b1124' });
    }
  } else if (kind === 'estrela_do_mar') {
    m.oval([0, .04, 0], [.10, .04, .10], { color: '#d85b37', segments: 10, rings: 4 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      m.link([Math.cos(a) * .06, .035, Math.sin(a) * .06], [Math.cos(a) * .30, .02, Math.sin(a) * .30], .045, .012, { color: i % 2 ? '#e37345' : '#cc4d2c' });
    }
  } else {
    // Fallback síncrono de coral antes do coral.glb carregar
    m.oval([0, .08, 0], [.36, .10, .36], { color: '#3b3634', segments: 10, rings: 5 });
    m.oval([-.12, .22, .08], [.18, .16, .18], { color: '#cf953e', segments: 10, rings: 6 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      m.link([Math.cos(a) * .08, .16, Math.sin(a) * .08], [Math.cos(a) * .34, .65 + (i % 2) * .18, Math.sin(a) * .34], .055, .022, { color: i % 2 ? '#d95d74' : '#e67856' });
    }
  }
  return m.finish();
}
