// Kraft — service worker do cliente instalável.
//
// O que ele faz: guarda no aparelho os arquivos do jogo e os entrega dali. O jogo abre sem baixar de novo o que já
// tem, baixa só o que mudou e, sem internet, abre com o que está guardado (o mundo offline de sempre).
//
// Como sabe o que vale: pelo manifesto do servidor (/api/manifesto, server/manifesto.js), que traz a marca de conteúdo
// e o tamanho de cada arquivo. Cada resposta é guardada com a chave "caminho?h=marca": arquivo trocado no servidor tem
// outra marca, então o guardado antigo nunca é entregue no lugar do novo.
//
// A partida solo abre com o catálogo local. O multiplayer e o botão de atualização consultam a distribuição.
// Uma instalação completa só muda de versão depois de receber todos os arquivos daquela versão.
//
// Fora dele (sempre rede): /api/, /ws, /f/ (arquivos enviados pelos jogadores), /lab/ e tudo o
// que não está no manifesto. Desligar de vez: LAVRA_SW=0 no servidor (ele passa a entregar um /sw.js que se desfaz)
// ou `?sw=0` na página (só naquele aparelho).

const ARQUIVOS = 'kraft-kraft-cliente-arquivos-1';
const META = 'kraft-kraft-cliente-meta-1';
const CHAVE = '/kraft-cliente/__manifesto';
const ESPERA_MS = 3000;
const CATALOGO = '/kraft-cliente/kraft-cliente.json'; // substituído pelo catálogo estático na distribuição independente

let ativo = null;      // manifesto em uso; a cópia durável mora em META (o navegador desliga e religa este script à vontade)
let lido = false;
let lendo = null;
let buscando = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('kraft-kraft-cliente-') && k !== ARQUIVOS && k !== META) await caches.delete(k);
  if (!(await manifesto())?.instalacaoCompleta) await atualizar(8000);
  await self.clients.claim();
})()));

function manifesto() {
  if (lido) return Promise.resolve(ativo);
  if (!lendo) lendo = (async () => {
    try {
      const r = await (await caches.open(META)).match(CHAVE);
      if (r) { const m = await r.json(); if (m && m.v === 1 && m.arquivos) ativo = m; }
    } catch { /* sem cópia guardada */ }
    lido = true; lendo = null;
    return ativo;
  })();
  return lendo;
}

async function trocar(m) {
  const meta = await caches.open(META);
  if (m) await meta.put(CHAVE, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
  else await meta.delete(CHAVE);
  ativo = m; lido = true;
}

// Pergunta ao servidor pelo manifesto. Devolve o que passou a valer (o novo, ou o guardado se o servidor não respondeu).
function atualizar(ms) {
  if (!buscando) buscando = (async () => {
    const antes = await manifesto();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms || ESPERA_MS);
      let m = null, semCliente = false;
      try {
        const r = await fetch(CATALOGO, { cache: 'no-store', signal: ctl.signal });
        if (r.ok) m = await r.json();
        else if (r.status === 404 || r.status === 410) semCliente = true;
      } finally { clearTimeout(t); }
      if (semCliente) {
        if (antes?.instalacaoCompleta) return antes;
        if (antes) await trocar(null); return null;
      }
      if (!m || m.v !== 1 || !m.arquivos || !m.versao) return antes;
      if (!antes || antes.versao !== m.versao) {
        m.instalacaoCompleta = false;
        if (antes?.instalacaoCompleta) {
          const c = await caches.open(ARQUIVOS);
          const fila = Object.entries(m.arquivos).filter(([, reg]) => !m.pacotes[reg[2]].reserva);
          let i = 0, falhou = false;
          const proxima = async () => {
            try {
              while (!falhou && i < fila.length) {
                const [p, reg] = fila[i++];
                if (!await instalarArquivo(c, p, reg)) falhou = true;
              }
            } catch { falhou = true; }
          };
          await Promise.all([proxima(), proxima()]);
          if (falhou || ativo !== antes) return ativo;
          m.instalacaoCompleta = true;
        }
        await trocar(m); await limpar(m).catch(() => {});
      }
      return m;
    } catch { return antes; }
    finally { buscando = null; }
  })();
  return buscando;
}

// Tira do aparelho o que não é mais de nenhum arquivo do manifesto (arquivo que saiu do jogo ou que mudou).
async function limpar(m) {
  const c = await caches.open(ARQUIVOS);
  for (const req of await c.keys()) {
    const u = new URL(req.url), reg = m.arquivos[u.pathname];
    if (!reg || u.searchParams.get('h') !== reg[0]) await c.delete(req);
  }
}

const chaveDe = (p, marca) => p + '?h=' + marca;
const semAspas = (etag) => String(etag || '').replace(/^W\//, '').replace(/^"|"$/g, '');
// A marca do servidor do jogo, ou ela com o sufixo que o Caddy põe quando ele mesmo comprime a resposta (arquivo
// pequeno, que o servidor do jogo manda sem comprimir): "marca-zstd", "marca-gzip", "marca-br". Visto na kraft em 22/11:
// sem aceitar o sufixo, o index.html nunca era guardado e o jogo não abria sem internet.
const mesmaMarca = (etag, marca) => etag === marca || (etag.startsWith(marca) && /^-(zstd|gzip|br)$/.test(etag.slice(marca.length)));

async function instalarArquivo(c, p, reg) {
  if (await c.match(chaveDe(p, reg[0]))) return true;
  const r = await fetch(p, { cache: 'no-cache', credentials: 'same-origin' });
  if (r.status !== 200) return false;
  return guardar(c, p, r, reg);
}

async function guardar(c, p, res, reg) {
  try {
    const corpo = await res.blob();
    if (corpo.size !== reg[1]) return false;                       // veio cortado, ou já é outro arquivo: não guarda
    if (!mesmaMarca(semAspas(res.headers.get('etag')), reg[0])) {
      const bytes = await crypto.subtle.digest('SHA-1', await corpo.arrayBuffer());
      const marca = btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').slice(0,20);
      if (marca !== reg[0]) return false;
    }
    const h = new Headers(res.headers);
    h.delete('content-encoding'); h.delete('content-length'); h.delete('vary');   // o corpo guardado já está aberto
    await c.put(chaveDe(p, reg[0]), new Response(corpo, { status: 200, headers: h }));
    return true;
  } catch { return false; }
}

async function responder(e, req, p) {
  let m = await manifesto();
  if (req.mode === 'navigate') {
    const q = new URL(req.url).searchParams;
    const multi = q.get('partida') === 'multiplayer' || (!q.has('partida') && q.has('mundo'));
    if (!m || multi) m = await atualizar(ESPERA_MS);
  }
  const reg = m && m.arquivos[p];
  if (!reg) return fetch(req);
  const c = await caches.open(ARQUIVOS);
  const tem = await c.match(chaveDe(p, reg[0]));
  if (tem) return tem;
  const res = await fetch(p, { cache: 'no-cache', credentials: 'same-origin' });
  // só guarda o que é mesmo o arquivo do manifesto: se o servidor já trocou de versão, a marca não bate e passa direto
  if (res.status === 200 && res.type === 'basic') {
    const etag = semAspas(res.headers.get('etag'));
    e.waitUntil(guardar(c, p, res.clone(), reg));
  }
  return res;
}

async function faixaGuardada(req, p) {
  const m = await manifesto(), reg = m?.arquivos[p];
  const intervalo = /^bytes=(\d*)-(\d*)$/i.exec(req.headers.get('range'));
  if (!reg || !intervalo || !(intervalo[1] || intervalo[2])) return fetch(req);
  const r = await (await caches.open(ARQUIVOS)).match(chaveDe(p, reg[0]));
  if (!r) return fetch(req);
  const n = reg[1], de = intervalo[1] ? Number(intervalo[1]) : Math.max(0, n - Number(intervalo[2]));
  const ate = intervalo[1] && intervalo[2] ? Math.min(n - 1, Number(intervalo[2])) : n - 1;
  if (de > ate || de >= n) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${n}` } });
  const headers = new Headers(r.headers);
  headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Range', `bytes ${de}-${ate}/${n}`);
  headers.set('Content-Length', String(ate - de + 1));
  return new Response((await r.blob()).slice(de, ate + 1), { status: 206, headers });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Depois de um 404/410 do catálogo, os workers de terreno devem nascer direto da rede.
  // Uma próxima navegação multiplayer pode redescobrir o cliente se o host o reativar.
  if (req.method !== 'GET' || (lido && !ativo && req.mode !== 'navigate')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  let p = url.pathname;
  if (!p.startsWith('/kraft-cliente/') || p === '/kraft-cliente/sw.js') return;
  if (p.startsWith('/api/') || p.startsWith('/f/') || p.startsWith('/lab/') || p === '/ws' || p === '/healthz' || p === '/sw.js') return;
  if (p.endsWith('/')) p += 'index.html';
  if (req.headers.has('range')) e.respondWith(faixaGuardada(req, p));
  else e.respondWith(responder(e, req, p));
});

// O que o aparelho tem de cada pacote. Com `faltam` (lista de ids de pacote, ou true para todos), devolve também os
// caminhos que ainda não estão guardados: a página os pede um a um e eles ficam guardados ao passar por aqui.
// Pacote de reserva (`reserva` no manifesto) fica fora dos totais e do "todos": só entra se pedido pelo id.
async function estado(faltam) {
  const m = await manifesto();
  if (!m) return { versao: null, protocolo: null, pacotes: [], bytes: 0, tem: 0 };
  const c = await caches.open(ARQUIVOS);
  const guardados = new Set();
  for (const req of await c.keys()) { const u = new URL(req.url); guardados.add(u.pathname + '?h=' + u.searchParams.get('h')); }
  const pacotes = m.pacotes.map((p) => ({ id: p.id, nome: p.nome, bytes: p.bytes, n: p.n, tem: 0, nTem: 0, reserva: !!p.reserva }));
  const quer = faltam === true ? null : new Set(Array.isArray(faltam) ? faltam : []);
  const lista = [];
  let bytes = 0, tem = 0;
  for (const p in m.arquivos) {
    const reg = m.arquivos[p], pac = pacotes[reg[2]], conta = !pac || !pac.reserva;
    if (conta) bytes += reg[1];
    if (guardados.has(chaveDe(p, reg[0]))) { if (conta) tem += reg[1]; if (pac) { pac.tem += reg[1]; pac.nTem++; } }
    else if (faltam && pac && (quer ? quer.has(pac.id) : !pac.reserva)) lista.push([p, reg[1]]);
  }
  const out = { versao: m.versao, protocolo: m.protocolo, pacotes, bytes, tem };
  if (faltam) out.faltam = lista;
  return out;
}

self.addEventListener('message', (e) => {
  const d = e.data || {}, porta = e.ports && e.ports[0];
  const devolve = (x) => { if (porta) porta.postMessage(x); };
  if (d.t === 'arquivo') e.waitUntil((async () => {
    const m = await manifesto(), reg = m?.arquivos[d.p];
    return !!reg && m.versao === d.versao && await instalarArquivo(await caches.open(ARQUIVOS), d.p, reg);
  })().then(devolve, () => devolve(false)));
  else if (d.t === 'concluir') e.waitUntil((async () => {
    const st = await estado(true);
    if (!st.versao || st.versao !== d.versao || st.faltam.length) return false;
    const m = await manifesto();
    if (m?.versao !== st.versao) return false;
    if (!m.instalacaoCompleta) await trocar({ ...m, instalacaoCompleta: true });
    return true;
  })().then(devolve, () => devolve(false)));
  else if (d.t === 'estado') e.waitUntil(estado(d.faltam).then(devolve, () => devolve(null)));
  else if (d.t === 'atualizar') e.waitUntil(atualizar(d.ms || 8000).then((m) => devolve({ versao: m ? m.versao : null }), () => devolve(null)));
  else if (d.t === 'esquecer') e.waitUntil((async () => {
    const m = await manifesto();
    if (m) await trocar({ ...m, instalacaoCompleta: false });
    await caches.delete(ARQUIVOS);
  })().then(() => devolve(true), () => devolve(false)));
});
