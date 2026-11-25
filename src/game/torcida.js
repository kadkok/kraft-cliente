// LAVRA — torcida de estádio grande (pedido do Kadmus, 19/11/2026: o estádio da Ilha Metrópole, "cheio de
// arquibancadas onde o grande público vem para assistir um grande jogo de futebol"). Na arquibancada pequena do campo
// de casa cada torcedor é um boneco inteiro (game/bola.js); num estádio são centenas: aqui a torcida inteira sai em
// seis desenhos (pernas, camisa, cabeça, cabelo e os dois braços, instanciados), cada pessoa com o seu tom de pele, de
// cabelo e de camisa (a cor do time, com a segunda cor salpicada).
//
// Fileiras: as de sempre, ao longo de x ({ x0, x1, z, y, lado, olhar }), e as de trás dos gols, ao longo de z
// ({ z0, z1, x, y, lado, olharX }); y = onde o torcedor pisa. Comportamento: fica de pé balançando de leve; no gol do
// seu time pula com os braços para cima; no gol do outro, baixa a cabeça.
import * as THREE from '../three.js';

const PELE = ['#f3dcc6', '#e2bf9c', '#c99a72', '#a87650', '#8a5d3c', '#ffe6d2'];
const CABELO = ['#2a1a10', '#4a2e18', '#1a1a1a', '#6a4422', '#8a5a2a', '#c8c8c0', '#b8862a'];
const CALCA = ['#2c3a55', '#3a3a40', '#4a4034', '#26303c', '#55504a'];
const h01 = (a, b, k) => { const x = Math.sin(a * 12.9898 + b * 78.233 + k * 37.719) * 43758.5453; return x - Math.floor(x); };

export function criarTorcida({ scene, fileiras = [], fundos = [], times, pc = true }) {
  // quem senta onde
  const gente = [];
  const dens = (lado) => Number(times?.[lado]?.torcida ?? 1), limiar = (lado) => Math.max(0.05, 1 - (pc ? 0.65 : 0.4) * dens(lado));
  for (const a of fileiras) {
    const lado = a.lado ? 1 : 0; if (dens(lado) <= 0.01) continue;
    for (let x = a.x0; x <= a.x1; x++) { const h = h01(x, a.z, 0); if (h >= limiar(lado)) gente.push({ x: x + 0.5, y: a.y, z: a.z + 0.5, rot: a.olhar > a.z ? Math.PI : 0, lado, h }); }
  }
  for (const a of fundos) {
    const lado = a.lado ? 1 : 0; if (dens(lado) <= 0.01) continue;
    for (let z = a.z0; z <= a.z1; z++) { const h = h01(a.x, z, 0); if (h >= limiar(lado)) gente.push({ x: a.x + 0.5, y: a.y, z: z + 0.5, rot: a.olharX > a.x ? -Math.PI / 2 : Math.PI / 2, lado, h }); }
  }
  const n = gente.length, grupo = new THREE.Group(); grupo.name = 'torcida-estadio';
  if (!n) return { n: 0, anima() {}, dispose() {} };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = gente[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const bsCenter = new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5 + 1, (minZ + maxZ) * 0.5);
  const bsRadius = Math.hypot(maxX - minX, maxY - minY + 3, maxZ - minZ) * 0.5 + 2.5;
  const bs = new THREE.Sphere(bsCenter, bsRadius);
  const mat = () => new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const parte = (geo) => { const m = new THREE.InstancedMesh(geo, mat(), n); m.castShadow = false; m.receiveShadow = false; m.boundingSphere = bs; m.frustumCulled = true; grupo.add(m); return m; };
  const gBraco = new THREE.BoxGeometry(0.15, 0.6, 0.15); gBraco.translate(0, -0.26, 0);     // pivô no ombro
  const pernas = parte(new THREE.BoxGeometry(0.4, 0.72, 0.22)), camisa = parte(new THREE.BoxGeometry(0.5, 0.62, 0.27));
  const cabeca = parte(new THREE.BoxGeometry(0.4, 0.4, 0.4)), cabelo = parte(new THREE.BoxGeometry(0.43, 0.13, 0.43));
  const bracoE = parte(gBraco), bracoD = parte(gBraco);
  const cor = new THREE.Color(), c2 = new THREE.Color();
  gente.forEach((p, i) => {
    const t = times?.[p.lado] || {}, k = h01(p.x, p.z, 3);
    cor.set(k < 0.72 ? (t.cor || (p.lado ? '#c62828' : '#1565c0')) : k < 0.9 ? (t.cor2 || '#ffffff') : '#f2f2ee');
    c2.setHSL(0, 0, 0.92 + h01(p.x, p.z, 4) * 0.16); cor.multiply(c2); camisa.setColorAt(i, cor);
    cor.set(PELE[Math.floor(h01(p.x, p.z, 5) * PELE.length)]); cabeca.setColorAt(i, cor); bracoE.setColorAt(i, cor); bracoD.setColorAt(i, cor);
    cor.set(CABELO[Math.floor(h01(p.x, p.z, 6) * CABELO.length)]); cabelo.setColorAt(i, cor);
    cor.set(CALCA[Math.floor(h01(p.x, p.z, 7) * CALCA.length)]); pernas.setColorAt(i, cor);
    p.esc = 0.9 + p.h * 0.14; p.fase = p.h * 6.2832;
  });
  for (const m of [pernas, camisa, cabeca, cabelo, bracoE, bracoD]) m.instanceColor.needsUpdate = true;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), QB = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), V = new THREE.Vector3();
  const EIXO_Y = new THREE.Vector3(0, 1, 0);
  // põe uma pessoa: sobe `pulo`, braços a `braco` rad (0 = caídos, −2,9 = para cima), cabeça baixa `cab` rad
  function poe(i, pulo, braco, abre, cab) {
    const p = gente[i], e = p.esc;
    Q.setFromAxisAngle(EIXO_Y, p.rot); S.set(e, e, e);
    const peca = (mesh, lx, ly, lz, q = Q) => { V.set(lx * e, ly * e, lz * e).applyQuaternion(Q); P.set(p.x + V.x, p.y + pulo + V.y, p.z + V.z); M.compose(P, q, S); mesh.setMatrixAt(i, M); };
    peca(pernas, 0, 0.36, 0); peca(camisa, 0, 1.03, 0);
    if (cab) { E.set(cab, 0, 0); QB.setFromEuler(E).premultiply(Q); peca(cabeca, 0, 1.54, -0.04, QB); peca(cabelo, 0, 1.79, -0.1, QB); }
    else { peca(cabeca, 0, 1.54, 0); peca(cabelo, 0, 1.79, 0); }
    E.set(braco, 0, -abre); QB.setFromEuler(E).premultiply(Q); peca(bracoE, -0.33, 1.32, 0, QB);
    E.set(braco, 0, abre); QB.setFromEuler(E).premultiply(Q); peca(bracoD, 0.33, 1.32, 0, QB);
  }
  for (let i = 0; i < n; i++) poe(i, 0, 0, 0, 0);
  const suja = () => { for (const m of [pernas, camisa, cabeca, cabelo, bracoE, bracoD]) m.instanceMatrix.needsUpdate = true; };
  suja(); scene.add(grupo);

  let festAnt = -1, cursor = 0;
  return {
    n, grupo,
    // t = segundos; fest = lado que comemora agora (−1 = ninguém)
    anima(t, fest) {
      if (fest >= 0 || festAnt >= 0) {
        // comemoração (e o quadro em que ela acaba): todo mundo, todo quadro
        for (let i = 0; i < n; i++) {
          const p = gente[i];
          if (fest === p.lado) poe(i, Math.abs(Math.sin(t * 9 + p.fase)) * 0.38, -2.9 + Math.sin(t * 14 + p.fase) * 0.25, 0.35, -0.3);
          else poe(i, 0, fest >= 0 ? -0.12 : 0, 0, fest >= 0 ? 0.45 : 0);
        }
        suja();
      } else {
        // parados: um sexto da arquibancada por quadro balança de leve (ninguém vira estátua)
        const fatia = Math.ceil(n / 6);
        for (let k = 0; k < fatia; k++) { const i = (cursor + k) % n, p = gente[i]; poe(i, Math.max(0, Math.sin(t * 1.1 + p.fase)) * 0.03, Math.sin(t * 1.3 + p.fase) * 0.07, 0, 0); }
        cursor = (cursor + fatia) % n; suja();
      }
      festAnt = fest;
    },
    dispose() { scene.remove(grupo); for (const m of grupo.children) { m.geometry.dispose(); m.material.dispose(); } },
  };
}
