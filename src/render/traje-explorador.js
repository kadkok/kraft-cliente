import * as THREE from '../three.js';

// Frente do avatar: −Z. Os acessórios acompanham o mesmo rig usado pela skin.
const hair = [
  [[0,.425,.014],[.461,.132,.456],'#2b2018'],
  [[-.153,.36,-.194],[.136,.115,.102],'#453021'],
  [[-.05,.389,-.207],[.097,.087,.086],'#533927'],
  [[.044,.419,-.21],[.096,.087,.091],'#60452d'],
  [[.139,.406,-.193],[.104,.103,.1],'#4c3422'],
  [[.19,.344,.026],[.091,.14,.346],'#312319'],
  [[-.187,.344,.039],[.093,.144,.32],'#38271c'],
  [[-.125,.49,.014],[.182,.072,.323],'#473121'],
  [[.043,.502,-.002],[.179,.083,.357],'#523923'],
  [[.161,.471,.036],[.119,.073,.329],'#412d21'],
  [[.02,.349,.214],[.355,.121,.071],'#302117']
];
const jacket = [
  [[-.105,1.309,-.064],[.103,.092,.192],'#283929'],
  [[.105,1.309,-.064],[.103,.092,.192],'#344632'],
  [[0,1.306,.079],[.313,.09,.1],'#3e513a'],
  [[0,.719,0],[.414,.068,.249],'#2d3a2a'],
  [[.177,1.027,-.105],[.033,.42,.03],'#52604a'],
  [[-.177,1.027,-.105],[.033,.42,.03],'#394b36'],
  [[-.108,.777,-.124],[.117,.093,.027],'#455741'],
  [[.108,.777,-.124],[.117,.093,.027],'#506049'],
  [[-.108,.81,-.142],[.113,.023,.023],'#68725a'],
  [[.108,.81,-.142],[.113,.023,.023],'#6a755e']
];
const cuff = [
  [[0,-.154,0],[.253,.25,.255],'#4b6047'],
  [[0,-.326,0],[.237,.106,.247],'#3b5039'],
  [[0,-.371,0],[.243,.036,.253],'#303e31'],
  [[0,-.105,-.134],[.135,.118,.015],'#607357']
];
const glove = [
  [[0,-.238,0],[.255,.184,.248],'#42392b'],
  [[0,-.277,-.112],[.234,.092,.057],'#32291f'],
  [[0,-.169,-.122],[.193,.035,.04],'#766045'],
  [[0,-.298,.044],[.18,.058,.145],'#4b3c2c']
];
const boot = [
  [[0,-.187,.012],[.254,.249,.269],'#4b3929'],
  [[0,-.271,-.048],[.271,.127,.354],'#4a3829'],
  [[0,-.306,-.062],[.283,.056,.374],'#211c18'],
  [[0,-.285,-.063],[.285,.022,.372],'#786248'],
  [[0,-.239,-.179],[.211,.033,.085],'#655037'],
  [[0,-.168,-.132],[.191,.05,.031],'#614c36'],
  [[0,-.162,-.152],[.122,.012,.02],'#a2875b'],
  [[0,-.187,-.154],[.115,.012,.021],'#a58a61']
];
const pack = [
  [[0,1.036,.219],[.355,.452,.225],'#463a29'],
  [[0,1.024,.286],[.329,.394,.159],'#645637'],
  [[0,1.21,.274],[.367,.116,.225],'#81704a'],
  [[0,1.279,.228],[.112,.057,.061],'#393124'],
  [[0,.91,.383],[.225,.136,.052],'#776442'],
  [[0,.96,.413],[.223,.027,.025],'#98855a'],
  [[-.181,1.005,.254],[.08,.226,.138],'#55462f'],
  [[.181,1.005,.254],[.08,.226,.138],'#55462f'],
  [[0,.817,.265],[.394,.089,.111],'#90835c'],
  [[-.114,1.058,.383],[.041,.401,.043],'#342a23'],
  [[.114,1.058,.383],[.041,.401,.043],'#342a23'],
  [[-.114,1.13,.413],[.061,.069,.022],'#b99a60'],
  [[.114,1.13,.413],[.061,.069,.022],'#b99a60'],
  [[-.153,1.041,-.137],[.035,.482,.038],'#55462f'],
  [[.153,1.041,-.137],[.035,.482,.038],'#55462f'],
  [[-.153,1.118,-.162],[.056,.051,.019],'#b99a60'],
  [[.153,1.118,-.162],[.056,.051,.019],'#b99a60']
];

const models = {
  cabelo: [['head', hair]],
  jaqueta: [['root', jacket], ['armL', cuff], ['armR', cuff]],
  luvas: [['elbowL', glove], ['elbowR', glove]],
  botas: [['kneeL', boot], ['kneeR', boot]],
  mochila: [['root', pack]]
};

const geometries = new WeakMap();
function geometry(pieces) {
  if (geometries.has(pieces)) return geometries.get(pieces);
  const position = [], normal = [], color = [];
  const rgb = new THREE.Color();
  for (const [offset, size, hex] of pieces) {
    const box = new THREE.BoxGeometry(...size);
    const p = box.attributes.position, n = box.attributes.normal;
    rgb.set(hex);
    for (const i of box.index.array) {
      position.push(p.getX(i) + offset[0], p.getY(i) + offset[1], p.getZ(i) + offset[2]);
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      color.push(rgb.r, rgb.g, rgb.b);
    }
    box.dispose();
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  mesh.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  mesh.userData.shared = true;
  geometries.set(pieces, mesh);
  return mesh;
}

export function vestirExplorador(body, traje, gm) {
  const worn = body.pecasExplorador ||= new Map();
  for (const [slot, parts] of Object.entries(models)) {
    let item = worn.get(slot);
    if (!traje?.[slot]) {
      if (item) {
        for (const mesh of item.meshes) mesh.removeFromParent();
        item.material.dispose();
        worn.delete(slot);
      }
      continue;
    }
    if (!item) {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87 });
      const meshes = parts.map(([joint, model]) => {
        const mesh = new THREE.Mesh(geometry(model), material);
        mesh.name = 'explorador-' + slot;
        mesh.castShadow = mesh.receiveShadow = true;
        (joint === 'root' ? body.head.parent : body[joint]).add(mesh);   // osso raiz: acompanha as proporções do criador
        return mesh;
      });
      item = { meshes, material };
      worn.set(slot, item);
    }
    const effect = gm?.regiao === slot ? gm : null;
    item.material.roughness = .87 - .7 * (effect?.reflexo || 0);
    item.material.emissiveIntensity = (effect?.brilho || 0) * .85;
    item.material.emissive.set(effect?.cor || '#000000');
  }
}
