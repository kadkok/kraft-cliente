// Kraft — peças livres: a matemática de pegar, mover, alinhar (ímã), juntar em conjuntos e guardar pré-formas.
// Pedido do Kadmus (20/11/2026): "quero maior e mais fácil mobilidade com objetos… modelar no ar blocos de tronco de
// árvore, montar uma estrutura e posicionar a estrutura inteira no lugar desejado, salvar pré-formas… deitar ela na
// horizontal… engrossar ou afinar o tronco… ativar ou desativar o 'ímã' que facilita a conexão de blocos e peças
// alinhadas umas às outras".
//
// Puro (sem three, sem DOM, sem Node): o aparelho, o servidor e os testes usam as mesmas contas.
//
// Vocabulário
//   peça      um objeto livre do mundo (objects/): { id, s (forma), p [x,y,z], q [x,y,z,w], k [L, A, P], m, f, g? }
//   conjunto  peças que andam juntas: todas com o mesmo `g` (número; sem `g` = peça solta). O servidor é o dono.
//   carga     o que está na mão: uma peça de referência (ou a caixa de uma pré-forma) + as outras, relativas a ela
//   pré-forma um conjunto guardado com nome: cada peça relativa ao centro da caixa que envolve todas
//
// O ímã (alinhar): com ele ligado, a peça da mão procura uma vizinha de eixos quase paralelos (até IMA_ANGULO graus,
// em qualquer permutação: em pé ao lado de deitada vale) e, no referencial DELA, puxa cada eixo para o mais perto de
// cinco lugares, se estiver a até IMA_RAIO: encostada por fora de um lado ou do outro (contato), rente por dentro de
// um lado ou do outro (faces no mesmo plano) e centrada. Eixo sem lugar perto fica na grade de 1/8 de bloco, medida
// na vizinha. Sem vizinha, vale a grade do mundo. "Contato" (é o que cola as peças num conjunto) = encostou por fora
// num eixo e as projeções se sobrepõem nos outros dois, ou uma está dentro da outra.

export const PECAS_MAX = 512;        // peças por conjunto, por lote de mensagem e por pré-forma
export const PREFORMAS_MAX = 200;    // pré-formas guardadas por mundo
export const NOME_MAX = 40;          // letras do nome de uma pré-forma
export const IMA_RAIO = 0.3;         // metros: até onde o ímã puxa uma face para a outra
export const IMA_ANGULO = 8;         // graus: até onde o ímã endireita a peça pela vizinha
export const GRADE = 0.125;          // grade do ímã: 1/8 de bloco
export const DIST_MIN = 1.25, DIST_MAX = 32, DIST_PADRAO = 6;   // distância da mão (a peça "no ar"), em metros
export const ESCALA_MIN = 0.1, ESCALA_MAX = 10;                 // escala de um conjunto ou de uma pré-forma ao pôr

const r3 = (v) => Math.round(v * 1000) / 1000;
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- quatérnios [x, y, z, w] ---------------------------------------------------------------------------------------
export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l < 1e-9 ? [0, 0, 0, 1] : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
export function qEixo(ax, ay, az, rad) {
  const h = rad * 0.5, s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}
// Os três eixos da peça no mundo (as colunas da matriz de rotação de q).
export function eixos(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
}
export function qRot(q, v) {
  const e = eixos(q);
  return [e[0][0] * v[0] + e[1][0] * v[1] + e[2][0] * v[2], e[0][1] * v[0] + e[1][1] * v[1] + e[2][1] * v[2], e[0][2] * v[0] + e[1][2] * v[1] + e[2][2] * v[2]];
}
// Quatérnio da rotação cujas colunas são c0, c1, c2 (ortonormais, mão direita).
export function qDeEixos(c0, c1, c2) {
  const m00 = c0[0], m10 = c0[1], m20 = c0[2], m01 = c1[0], m11 = c1[1], m21 = c1[2], m02 = c2[0], m12 = c2[1], m22 = c2[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  return qNorm([x, y, z, w]);
}

// ---- giros de quem segura uma peça (somados ao que ela já tem, sempre em relação ao mundo) ------------------------
// Em volta do eixo vertical do mundo (T/G).
export const girarY = (q, graus) => qNorm(qMul(qEixo(0, 1, 0, graus * Math.PI / 180), q));
// O eixo horizontal "à direita de quem olha", preso ao X ou ao Z do mundo (tombar sempre cai num ângulo limpo).
export function eixoDeTombar(yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return Math.abs(c) >= Math.abs(s) ? [c >= 0 ? 1 : -1, 0, 0] : [0, 0, s >= 0 ? -1 : 1];
}
// Tombar para longe de quem olha (graus positivos levam o topo da peça para a frente): Y/H de 15° e X de 90°.
export function tombar(q, yaw, graus) {
  const a = eixoDeTombar(yaw);
  return qNorm(qMul(qEixo(a[0], a[1], a[2], -graus * Math.PI / 180), q));
}

// ---- caixas ---------------------------------------------------------------------------------------------------------
// Meias-medidas da caixa da peça (o painel fino, de imagem, conta com 6 cm para ter onde encostar).
export function meias(o) {
  const z = o.s === 'painel' ? Math.max(0.06, o.k[2]) : o.k[2];
  return [o.k[0] / 2, o.k[1] / 2, z / 2];
}
// Meia-extensão da caixa de `o` ao longo da direção unitária n.
export function apoio(o, n) {
  const e = eixos(o.q), h = meias(o);
  return Math.abs(dot(e[0], n)) * h[0] + Math.abs(dot(e[1], n)) * h[1] + Math.abs(dot(e[2], n)) * h[2];
}
// Posição e giro de `o` vistos da peça de referência (e a volta). A escala afasta as peças do centro por igual.
export function relativa(ref, o) {
  const inv = qConj(ref.q);
  return { rp: qRot(inv, [o.p[0] - ref.p[0], o.p[1] - ref.p[1], o.p[2] - ref.p[2]]), rq: qNorm(qMul(inv, o.q)) };
}
export function absoluta(ref, rel, escala = 1) {
  const v = qRot(ref.q, [rel.rp[0] * escala, rel.rp[1] * escala, rel.rp[2] * escala]);
  return { p: [ref.p[0] + v[0], ref.p[1] + v[1], ref.p[2] + v[2]], q: qNorm(qMul(ref.q, rel.rq)) };
}
// Até onde a carga (peças relativas a uma referência de giro q) se estende a partir do ponto de referência na
// direção n. É o que afasta a peça da superfície em que ela se apoia: referência = ponto + normal × apoioDaCarga(−normal).
export function apoioDaCarga(q, pecas, n, escala = 1) {
  let m = -Infinity;
  for (const it of pecas) {
    const c = qRot(q, [it.rp[0] * escala, it.rp[1] * escala, it.rp[2] * escala]);
    const a = apoio({ s: it.s, q: qMul(q, it.rq), k: [it.k[0] * escala, it.k[1] * escala, it.k[2] * escala] }, n);
    const v = dot(c, n) + a;
    if (v > m) m = v;
  }
  return Number.isFinite(m) ? m : 0;
}
// A caixa que envolve várias peças, medida nos eixos do giro q: { p (centro), q, k }.
export function caixaDoConjunto(pecas, q) {
  const e = eixos(q), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const o of pecas) {
    for (let i = 0; i < 3; i++) {
      const c = dot(o.p, e[i]), a = apoio(o, e[i]);
      if (c - a < lo[i]) lo[i] = c - a;
      if (c + a > hi[i]) hi[i] = c + a;
    }
  }
  const p = [0, 0, 0], k = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const mid = (lo[i] + hi[i]) / 2;
    k[i] = Math.max(0.02, hi[i] - lo[i]);
    p[0] += e[i][0] * mid; p[1] += e[i][1] * mid; p[2] += e[i][2] * mid;
  }
  return { p, q: [...q], k };
}

// ---- o ímã ----------------------------------------------------------------------------------------------------------
const naGrade = (v, g) => Math.round(v / g) * g;

// Tenta casar a peça h com a vizinha n. Devolve { p, q, custo, contato, puxou } ou null (longe, ou torta demais).
export function casar(h, n, opt = {}) {
  const raio = opt.raio ?? IMA_RAIO, grade = opt.grade ?? GRADE;
  const cosTol = Math.cos((opt.angulo ?? IMA_ANGULO) * Math.PI / 180);
  const A = eixos(h.q), Bn = eixos(n.q);
  // cada eixo de h tem de cair (quase) sobre um eixo diferente de n
  const perm = [0, 0, 0], sinal = [1, 1, 1], usado = [false, false, false];
  for (let j = 0; j < 3; j++) {
    let best = 0, bi = -1;
    for (let i = 0; i < 3; i++) { const c = dot(A[j], Bn[i]); if (Math.abs(c) > Math.abs(best)) { best = c; bi = i; } }
    if (bi < 0 || Math.abs(best) < cosTol || usado[bi]) return null;
    usado[bi] = true; perm[j] = bi; sinal[j] = best < 0 ? -1 : 1;
  }
  const col = [0, 1, 2].map((j) => Bn[perm[j]].map((v) => v * sinal[j]));
  const cx = [col[1][1] * col[2][2] - col[1][2] * col[2][1], col[1][2] * col[2][0] - col[1][0] * col[2][2], col[1][0] * col[2][1] - col[1][1] * col[2][0]];
  if (dot(col[0], cx) < 0.5) return null;                       // não é rotação (não acontece com h e n válidos)
  const q = qDeEixos(col[0], col[1], col[2]);
  // posição de h no referencial de n, e as meias-medidas de h postas nos eixos de n
  const rel = [h.p[0] - n.p[0], h.p[1] - n.p[1], h.p[2] - n.p[2]];
  const d = [dot(rel, Bn[0]), dot(rel, Bn[1]), dot(rel, Bn[2])];
  const hn = meias(n), hl = meias(h), hh = [0, 0, 0];
  for (let j = 0; j < 3; j++) hh[perm[j]] = hl[j];
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > hn[i] + hh[i] + raio) return null;   // longe demais desta vizinha
  const c = [0, 0, 0], porFora = [false, false, false];
  let custo = 0, puxou = 0;
  for (let i = 0; i < 3; i++) {
    const fora = hn[i] + hh[i], dentro = hn[i] - hh[i];
    const cand = [fora, -fora, dentro, -dentro, 0];
    let k = -1, bd = raio + 1e-9;
    for (let j = 0; j < 5; j++) { const dd = Math.abs(d[i] - cand[j]); if (dd < bd - 1e-9) { bd = dd; k = j; } }
    if (k >= 0) { c[i] = cand[k]; custo += bd; puxou++; porFora[i] = k < 2; }
    else c[i] = naGrade(d[i], grade);
  }
  // contato de verdade: por fora num eixo, sobreposto nos outros dois; ou uma peça dentro da outra
  const sobre = (i) => Math.abs(c[i]) < hn[i] + hh[i] - 1e-6;
  let contato = sobre(0) && sobre(1) && sobre(2);
  for (let i = 0; i < 3 && !contato; i++) if (porFora[i] && sobre((i + 1) % 3) && sobre((i + 2) % 3)) contato = true;
  const p = [0, 1, 2].map((a) => n.p[a] + Bn[0][a] * c[0] + Bn[1][a] * c[1] + Bn[2][a] * c[2]);
  return { p, q, custo, contato, puxou };
}

// Alinha a peça da mão: procura a melhor vizinha (a preferida, a que está na mira, ganha se casar); sem nenhuma, a
// grade do mundo. `normal` = a superfície em que a peça está apoiada: o ímã nunca a afunda nessa superfície.
// Devolve { p, q, alvo (id da vizinha ou 0), contato }.
export function alinhar(h, vizinhas, opt = {}) {
  const grade = opt.grade ?? GRADE;
  let melhor = null, alvo = 0;
  for (const n of vizinhas || []) {
    const r = casar(h, n, opt);
    if (!r || !r.puxou) continue;
    const nota = r.custo - (r.contato ? 0.5 : 0) - r.puxou * 0.01 - (opt.preferida && n.id === opt.preferida ? 10 : 0);
    if (!melhor || nota < melhor.nota) { melhor = { ...r, nota }; alvo = n.id || 0; }
  }
  let p, q, contato = false;
  if (melhor) { p = melhor.p; q = melhor.q; contato = melhor.contato; }
  else { p = [naGrade(h.p[0], grade), naGrade(h.p[1], grade), naGrade(h.p[2], grade)]; q = [...h.q]; alvo = 0; }
  if (opt.normal) {
    // apoiada numa superfície: a grade vale só AO LONGO dela (a distância à superfície fica exata, senão a peça
    // afundaria ou ficaria boiando); o encosto numa vizinha pode levantá-la, mas nunca afundá-la
    // (se a superfície é a da própria vizinha em que encostou, quem manda é o encosto: caixa com caixa, exato)
    const n = opt.normal, fundo = (p[0] - h.p[0]) * n[0] + (p[1] - h.p[1]) * n[1] + (p[2] - h.p[2]) * n[2];
    const naVizinha = melhor && opt.preferida && alvo === opt.preferida;
    if (!naVizinha && (melhor ? fundo < -1e-6 : Math.abs(fundo) > 1e-9)) p = [p[0] - n[0] * fundo, p[1] - n[1] * fundo, p[2] - n[2] * fundo];
  }
  return { p, q, alvo, contato };
}

// ---- pré-formas -------------------------------------------------------------------------------------------------------
// Guarda as peças relativas ao centro da caixa que envolve todas, nos eixos da peça de referência (giro qRef).
export function preformaDe(pecas, qRef) {
  const cx = caixaDoConjunto(pecas, qRef);
  return {
    k: cx.k.map(r3),
    l: pecas.map((o) => { const r = relativa(cx, o); return { s: o.s, rp: r.rp.map(r3), rq: r.rq.map(r5), k: o.k.map(r3), m: { ...o.m }, f: o.f | 0 }; }),
  };
}
// As peças de uma pré-forma postas no mundo: ref = { p, q } (centro e giro da caixa dela), escala por igual.
export function pecasDaPreforma(pf, ref, escala = 1) {
  const e = clamp(escala || 1, ESCALA_MIN, ESCALA_MAX);
  return pf.l.map((x) => {
    const a = absoluta(ref, x, e);
    return { s: x.s, p: a.p.map(r3), q: a.q.map(r5), k: x.k.map((v) => r3(clamp(v * e, Math.min(0.02, v), 4000))), m: { ...x.m }, f: x.f | 0 };
  });
}
export function limpaNome(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOME_MAX);
}

// ---- a oficina: o estado das peças e as operações que o mudam ----------------------------------------------------------
// O mesmo motor serve ao servidor (server/pecas.js, com as permissões por cima) e ao jogo sem servidor (objects/mao.js).
//   objetos     Map(id → peça): o dono é quem chama; a oficina escreve nele
//   novoId      () → número novo (peça ou conjunto: o espaço de números é o mesmo)
//   limpa       (o, parcial) → descrição conferida de uma peça, ou null (server/world.js → cleanObject)
//   fixo        (o) → true se a peça é da paisagem (não se move nem entra em conjunto)
//   maxObjetos  teto de peças do mundo
// Toda operação devolve { ok: true, … } ou { ok: false, erro }. `g` = Map(id → conjunto novo; 0 = solta) com cada
// peça que mudou de conjunto; `confere(o)` (opcional) é perguntado para cada posição antiga e nova: false desiste de tudo.
export function criarOficina({ objetos, novoId, limpa, fixo = () => false, maxObjetos = 4000, agora = () => Date.now() }) {
  const preformas = new Map();
  let proxPf = 1;
  const falha = (erro) => ({ ok: false, erro });
  const mexivel = (o) => !!o && !o.bau && !fixo(o);
  const noPlano = (o, d) => !!o && (o.d || 0) === (d || 0);
  function membros(g, d) {
    const l = [];
    if (g) for (const o of objetos.values()) if (o.g === g && noPlano(o, d)) l.push(o);
    return l;
  }
  const conjuntoDe = (o, d) => (o.g ? membros(o.g, d) : [o]);
  // conjunto de uma peça só deixa de ser conjunto
  function podar(g, d, mud) {
    const l = membros(g, d);
    if (l.length === 1) { delete l[0].g; mud.set(l[0].id, 0); }
  }
  // as peças (e os conjuntos inteiros delas) passam ao conjunto da peça `junta`. Devolve '' ou o motivo de não colar.
  function grudar(pecas, junta, d, mud) {
    const alvo = objetos.get(junta);
    if (!alvo || !noPlano(alvo, d) || !mexivel(alvo)) return 'alvo';
    const vem = new Set();
    for (const o of pecas) { if (o.g) for (const m of membros(o.g, d)) vem.add(m); else vem.add(o); }
    if (vem.has(alvo)) return '';                                   // já são o mesmo conjunto
    const jaLa = alvo.g ? membros(alvo.g, d).length : 1;
    if (jaLa + vem.size > PECAS_MAX) return 'cheio';
    if (!alvo.g) { alvo.g = novoId(); mud.set(alvo.id, alvo.g); }
    for (const o of vem) if (mexivel(o) && o.g !== alvo.g) { o.g = alvo.g; mud.set(o.id, alvo.g); }
    return '';
  }
  // põe peças novas no mundo: mais de uma = um conjunto novo; `junta` cola tudo no conjunto de uma peça que já existe
  function criar(novos, { d = 0, junta = 0, confere = null, por = '' } = {}) {
    if (!novos.length) return falha('lote');
    if (objetos.size + novos.length > maxObjetos) return falha('limite');
    if (confere) for (const o of novos) if (!confere(o)) return falha('espaco');
    const mud = new Map(), g = novos.length > 1 ? novoId() : 0;
    for (const o of novos) {
      o.id = novoId();
      if (por) o.by = por;
      if (d) o.d = d;
      if (g) o.g = g;
      objetos.set(o.id, o);
    }
    const aviso = junta ? grudar(novos, junta, d, mud) : '';
    for (const o of novos) mud.delete(o.id);                         // as novas já vão com o conjunto certo
    return { ok: true, novos, g: mud, aviso };
  }

  const api = {
    membros, conjuntoDe, mexivel,
    // Move (e, se vier `k`, muda o tamanho de) várias peças de uma vez: l = [{ id, p, q, k? }].
    // `so`: a peça (uma só) sai do conjunto dela. `junta`: id da peça em cujo conjunto as movidas entram.
    mover(l, { d = 0, junta = 0, so = false, confere = null } = {}) {
      if (!Array.isArray(l) || !l.length || l.length > PECAS_MAX) return falha('lote');
      const plano = [], vistos = new Set();
      for (const e of l) {
        const cur = e && objetos.get(e.id);
        if (!cur || vistos.has(cur.id) || !noPlano(cur, d)) return falha('peca');
        if (!mexivel(cur)) return falha('fixa');
        const part = limpa(e.k ? { p: e.p, q: e.q, k: e.k } : { p: e.p, q: e.q }, true, cur.s);
        if (!part || !part.p || !part.q) return falha('medida');
        vistos.add(cur.id);
        plano.push([cur, part]);
      }
      if (confere) for (const [cur, part] of plano) if (!confere(cur) || !confere({ ...cur, ...part })) return falha('espaco');
      const mud = new Map();
      if (so && plano.length === 1 && plano[0][0].g) {
        const o = plano[0][0], g0 = o.g;
        delete o.g; mud.set(o.id, 0);
        podar(g0, d, mud);
      }
      for (const [cur, part] of plano) Object.assign(cur, part);
      const aviso = junta ? grudar(plano.map(([cur]) => cur), junta, d, mud) : '';
      return { ok: true, l: plano.map(([cur]) => cur), g: mud, aviso };
    },
    // O conjunto da peça b (ou só ela, se solta) entra no conjunto da peça a.
    juntar(a, b, { d = 0 } = {}) {
      const B = objetos.get(b);
      if (!B || !noPlano(B, d) || !mexivel(B) || a === b) return falha('peca');
      const mud = new Map(), erro = grudar([B], a, d, mud);
      return erro ? falha(erro) : { ok: true, g: mud };
    },
    // A peça sai do conjunto dela; `tudo` desfaz o conjunto inteiro.
    soltar(id, { d = 0, tudo = false } = {}) {
      const o = objetos.get(id);
      if (!o || !noPlano(o, d) || !o.g) return falha('solta');
      const mud = new Map(), g0 = o.g;
      if (tudo) for (const m of membros(g0, d)) { delete m.g; mud.set(m.id, 0); }
      else { delete o.g; mud.set(o.id, 0); podar(g0, d, mud); }
      return { ok: true, g: mud };
    },
    // Tira do mundo o conjunto inteiro da peça `id` (ou só ela, se solta). Devolve os ids apagados.
    remover(id, { d = 0, confere = null } = {}) {
      const o = objetos.get(id);
      if (!o || !noPlano(o, d)) return falha('peca');
      const l = conjuntoDe(o, d);
      if (l.some((x) => !mexivel(x))) return falha('fixa');
      if (confere) for (const x of l) if (!confere(x)) return falha('espaco');
      for (const x of l) objetos.delete(x.id);
      return { ok: true, ids: l.map((x) => x.id) };
    },
    // Cópias de peças que existem, cada uma no lugar pedido: l = [{ de (id da original), p, q, k? }].
    copiar(l, opt = {}) {
      if (!Array.isArray(l) || !l.length || l.length > PECAS_MAX) return falha('lote');
      const novos = [];
      for (const e of l) {
        const src = e && objetos.get(e.de);
        if (!src || !noPlano(src, opt.d) || !mexivel(src)) return falha('peca');
        const o = limpa({ s: src.s, p: e.p, q: e.q, k: e.k || src.k, m: src.m, f: src.f });
        if (!o) return falha('medida');
        novos.push(o);
      }
      return criar(novos, opt);
    },
    // Uma peça recém-criada (o+) que nasceu encostada com o ímã entra no conjunto da vizinha.
    grudarNova(o, junta, d = 0) {
      const mud = new Map(), erro = grudar([o], junta, d, mud);
      mud.delete(o.id);
      return erro ? falha(erro) : { ok: true, g: mud };
    },

    // ---- pré-formas ----
    // Guarda o conjunto da peça `id` (ou só ela) com um nome. Mesmo nome do mesmo autor: substitui.
    salvar(id, nome, { d = 0, por = '' } = {}) {
      const o = objetos.get(id);
      if (!o || !noPlano(o, d) || !mexivel(o)) return falha('peca');
      const n = limpaNome(nome);
      if (!n) return falha('nome');
      const pecas = conjuntoDe(o, d).filter(mexivel).slice(0, PECAS_MAX);
      const corpo = preformaDe(pecas, o.q);
      let pf = [...preformas.values()].find((x) => x.nome.toLowerCase() === n.toLowerCase() && x.por === por);
      if (pf) Object.assign(pf, corpo, { nome: n, em: agora() });
      else {
        if (preformas.size >= PREFORMAS_MAX) return falha('cheio');
        pf = { id: proxPf++, nome: n, por, em: agora(), ...corpo };
        preformas.set(pf.id, pf);
      }
      return { ok: true, pf };
    },
    // Põe uma pré-forma no mundo: ref = { p, q } é o centro e o giro da caixa dela.
    por(pfId, ref, opt = {}) {
      const pf = preformas.get(pfId);
      if (!pf) return falha('preforma');
      const novos = [];
      for (const x of pecasDaPreforma(pf, ref, opt.escala || 1)) {
        const o = limpa(x);
        if (!o) return falha('medida');
        novos.push(o);
      }
      return criar(novos, opt);
    },
    // Só quem guardou apaga (ou um GM).
    apagar(pfId, { quem = '', gm = false } = {}) {
      const pf = preformas.get(pfId);
      if (!pf) return falha('preforma');
      if (!gm && pf.por.toLowerCase() !== String(quem).toLowerCase()) return falha('dono');
      preformas.delete(pfId);
      return { ok: true, id: pfId, nome: pf.nome };
    },
    ver: (pfId) => preformas.get(pfId) || null,
    achar(nome) { const n = limpaNome(nome).toLowerCase(); return [...preformas.values()].filter((x) => x.nome.toLowerCase() === n); },
    cabecalho: (pf) => ({ id: pf.id, nome: pf.nome, por: pf.por, n: pf.l.length, k: pf.k }),
    lista() { return [...preformas.values()].map(api.cabecalho); },
    estado() { return { prox: proxPf, l: [...preformas.values()] }; },
    carregar(s) {
      preformas.clear(); proxPf = 1;
      if (!s || typeof s !== 'object' || !Array.isArray(s.l)) return;
      for (const raw of s.l) {
        if (!raw || !Number.isInteger(raw.id) || raw.id < 1 || !Array.isArray(raw.l) || preformas.size >= PREFORMAS_MAX) continue;
        const nome = limpaNome(raw.nome), l = [];
        for (const x of raw.l.slice(0, PECAS_MAX)) {
          const o = x && limpa({ s: x.s, p: x.rp, q: x.rq, k: x.k, m: x.m, f: x.f });
          if (o) l.push({ s: o.s, rp: o.p, rq: o.q, k: o.k, m: o.m, f: o.f });
        }
        if (!nome || !l.length) continue;
        const k = Array.isArray(raw.k) && raw.k.length === 3 && raw.k.every((v) => typeof v === 'number' && v > 0 && v <= 8000) ? raw.k.map(r3) : [1, 1, 1];
        preformas.set(raw.id, { id: raw.id, nome, por: String(raw.por || '').slice(0, 32), em: Number(raw.em) || 0, k, l });
        proxPf = Math.max(proxPf, raw.id + 1);
      }
      if (Number.isInteger(s.prox) && s.prox > proxPf) proxPf = s.prox;
    },
  };
  return api;
}
