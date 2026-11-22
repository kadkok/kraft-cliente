// LAVRA — carregador único de modelos .glb (Hermes, 20/11/2026; nota em /srv/lavra/HANDOFF-HERMES-desempenho-20261120.md).
// Por quê: cada bicho vinha num .glb sem compressão (a águia: 20 MB, 87 clipes, 59 mil faixas de animação, texturas PNG
// de 1024² que viram 5,6 MB de memória de vídeo cada). Abrir isso trava o quadro, e no visor e no celular dá engasgo.
// Agora existe uma cópia leve de cada um em assets/fauna/bichos-leve/ (só os clipes que o jogo usa, geometria e
// animação com Meshopt, texturas KTX2/UASTC que vão comprimidas para a placa). Os originais continuam em
// assets/fauna/bichos/ e são a reserva: se o leve falhar por qualquer motivo, o jogo carrega o original sozinho.
//
// O que este módulo entrega:
//   carregarGlb(url)                      .glb comum, pelo mesmo GLTFLoader (um só para o jogo inteiro)
//   carregarGlbLeve(urlLeve, urlReserva)  .glb com KTX2 + Meshopt; se falhar, carrega a reserva (o original)
//   carregarBicho(id, cena)               bichos-leve/<id>.glb com reserva em bichos/<id>.glb
//   compilarGlb(obj, cena)                compila os shaders do modelo ANTES de ele entrar na cena, sem travar o quadro
//   ligarCena(cena) / ligarRenderer(r)    por onde o módulo conhece o renderer (ver abaixo)
//   emVR() · estadoCarregador             consulta
//
// Como ele conhece o renderer sem mexer no main.js: ligarCena() pendura um ouvinte no scene.onBeforeRender, que o three
// chama a cada render com (renderer, cena, câmera, alvo). Dali saem o renderer (o KTX2Loader precisa dele para saber
// que formato comprimido a placa aceita), a câmera e os alvos em que a cena é desenhada (tela, alvo do pós ou visor).
// Os laboratórios chamam ligarRenderer() direto.
//
// Para desligar sem publicar nada: abrir o jogo com ?bichos=originais (usa só os arquivos antigos).
import * as THREE from '../three.js';

// Os arquivos de bichos-leve/ e vendor/basis/ saem do servidor com cache de um ano (immutable). Quem refizer um bicho
// leve TEM de trocar este número (ou o diretório); senão o navegador continua com o arquivo velho.
export const VERSAO_LEVE = '20261120a';
const DIR_LEVE = '/kraft-cliente/assets/fauna/bichos-leve/', DIR_ORIGINAL = '/kraft-cliente/assets/fauna/bichos/';
const ESPERA_RENDERER = 4000, ESPERA_ABRIR = 25000, ESPERA_COMPILAR = 4000;   // ms

const est = { renderer: null, camera: null, cena: null, alvos: new Map(), ktx2: null };
export const estadoCarregador = { leves: 0, reservas: 0, comuns: 0, compilados: 0, basis: false, falhas: [] };   // para conferir (testes e console)

let avisar; const temRenderer = new Promise((ok) => { avisar = ok; });
const soOriginais = () => { try { return new URLSearchParams(location.search).get('bichos') === 'originais'; } catch { return false; } };
const comPrazo = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };

export function ligarRenderer(renderer, camera = null) {
  if (renderer && !est.renderer) { est.renderer = renderer; avisar(renderer); }
  if (camera) est.camera = camera;
}
export function ligarCena(cena) {
  if (!cena || est.cena === cena) return;
  est.cena = cena;
  const antes = cena.onBeforeRender;
  cena.onBeforeRender = function (renderer, c, camera, alvo) {
    if (antes) antes.call(this, renderer, c, camera, alvo);
    ligarRenderer(renderer);
    // três jeitos de a cena ser desenhada, e cada um pede uma variante do shader: direto na tela, num alvo do pós
    // (sem tone mapping, cor linear) ou no visor
    const k = !alvo ? 'tela' : alvo.isXRRenderTarget ? 'visor' : 'alvo';
    est.alvos.set(k, { alvo: alvo || null, camera, t: performance.now() });
  };
}
export const emVR = () => !!est.renderer?.xr?.isPresenting;

// ---- o carregador -------------------------------------------------------------------------------------------------
let comumP = null, leveP = null;
// se o transcoder não puder rodar neste navegador (worker antigo que herda a CSP, sem WebAssembly...), o leve fica
// desligado pelo resto da sessão e os bichos vêm dos originais, sem esperar por prazo nenhum
let basisRuim = null, avisarBasis; const basisFalhou = new Promise((_, no) => { avisarBasis = no; }); basisFalhou.catch(() => {});
function basisQuebrou(msg) { if (basisRuim) return; basisRuim = String(msg); estadoCarregador.basis = false; console.warn('[glb leve] transcoder Basis indisponível; ficam os originais:', basisRuim); avisarBasis(new Error(basisRuim)); }
const comum = () => (comumP ||= import('../../vendor/three-gltf.js').then(({ GLTFLoader }) => new GLTFLoader()));
// o mesmo GLTFLoader, agora com Meshopt e KTX2 (transcoder Basis servido daqui mesmo, de vendor/basis/)
function leve() {
  return (leveP ||= (async () => {
    const [loader, extra, renderer] = await Promise.all([
      comum(), import('../../vendor/three-ktx2-meshopt.js'), comPrazo(temRenderer, ESPERA_RENDERER, 'o renderer não apareceu'),
    ]);
    await extra.MeshoptDecoder.ready;
    const base = new URL('../../vendor/basis/', import.meta.url).href;
    const ktx2 = new extra.KTX2Loader().setTranscoderPath(base).setWorkerLimit(2).detectSupport(renderer);
    // O transcoder Basis cria funções com new Function, e a CSP da página não deixa (script-src sem 'unsafe-eval'). O
    // KTX2Loader montaria o worker num blob, que herda a CSP da página; aqui o worker vem de um arquivo do servidor
    // (vendor/basis/ktx2-worker.js, o mesmo texto, gerado por montar-addons.mjs), que roda com a CSP da própria resposta.
    ktx2.transcoderPending = fetch(base + 'basis_transcoder.wasm').then((r) => { if (!r.ok) throw new Error('transcoder: HTTP ' + r.status); return r.arrayBuffer(); }).then((bin) => {
      ktx2.transcoderBinary = bin;
      ktx2.workerPool.setWorkerCreator(() => {
        const w = new Worker(base + 'ktx2-worker.js');
        w.addEventListener('error', (e) => { e.preventDefault?.(); basisQuebrou(e.message || 'erro no worker do transcoder'); });
        const b = bin.slice(0);
        w.postMessage({ type: 'init', config: ktx2.workerConfig, transcoderBinary: b }, [b]);
        return w;
      });
    });
    await ktx2.transcoderPending;
    loader.setMeshoptDecoder(extra.MeshoptDecoder).setKTX2Loader(ktx2);
    est.ktx2 = ktx2; estadoCarregador.basis = true;
    return loader;
  })().catch((e) => { leveP = null; throw e; }));
}

export async function carregarGlb(url) {
  const gltf = await (await comum()).loadAsync(url);
  estadoCarregador.comuns++;
  return gltf;
}
export async function carregarGlbLeve(urlLeve, urlReserva = null) {
  if (soOriginais() && urlReserva) return carregarGlb(urlReserva);
  try {
    if (basisRuim) throw new Error(basisRuim);
    const loader = await leve();
    const r = await fetch(urlLeve);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const dados = await r.arrayBuffer();
    const gltf = await comPrazo(Promise.race([loader.parseAsync(dados, THREE.LoaderUtils.extractUrlBase(urlLeve)), basisFalhou]), ESPERA_ABRIR, 'demorou demais para abrir');
    estadoCarregador.leves++;
    return gltf;
  } catch (e) {
    estadoCarregador.falhas.push(`${urlLeve}: ${e?.message || e}`);
    // se nem o primeiro abriu no prazo, o transcoder não funciona neste navegador: o resto da sessão vai direto aos originais
    if (String(e?.message || e) === "demorou demais para abrir" && !estadoCarregador.leves) basisQuebrou("o leve não abriu no prazo");
    if (!urlReserva) throw e;
    console.warn('[glb leve] falhou, vai o original:', urlLeve, e?.message || e);
    const gltf = await carregarGlb(urlReserva);
    estadoCarregador.reservas++;
    return gltf;
  }
}
export function carregarBicho(id, cena = null) {
  if (cena) ligarCena(cena);
  return carregarGlbLeve(`${DIR_LEVE}${id}.glb?v=${VERSAO_LEVE}`, `${DIR_ORIGINAL}${id}.glb`);
}

// ---- shaders prontos antes de o modelo aparecer --------------------------------------------------------------------
// renderer.compileAsync() monta os programas e espera a placa terminar (KHR_parallel_shader_compile) sem segurar o
// quadro. O three escolhe a variante do shader pelo alvo em que desenha; por isso a compilação é feita uma vez para
// cada alvo em que a cena foi vista nos últimos segundos. Nunca rejeita: se algo der errado, o modelo entra na cena
// como antes e o three compila na hora.
export async function compilarGlb(obj, cena = est.cena) {
  const r = est.renderer;
  if (!r || !obj || !cena || typeof r.compileAsync !== 'function') return false;
  try {
    if (r.getContext().isContextLost()) return false;
    const agora = performance.now();
    let alvos = [...est.alvos.values()].filter((a) => agora - a.t < 3000);
    if (!alvos.length) alvos = est.camera ? [{ alvo: r.getRenderTarget(), camera: est.camera }] : [];
    const esperas = [], paralelo = r.extensions.has('KHR_parallel_shader_compile');
    if (!alvos.length) return false;
    if (!paralelo) esperas.push(new Promise((ok) => setTimeout(ok, 30)));
    for (const a of alvos) {
      // o three lê o alvo por renderer.getRenderTarget(): durante a montagem (síncrona) ele enxerga o alvo de verdade
      // daquele passo, sem trocar framebuffer nenhum
      const original = r.getRenderTarget;
      r.getRenderTarget = () => a.alvo;
      try {
        if (paralelo) esperas.push(r.compileAsync(obj, a.camera, cena));
        else r.compile(obj, a.camera, cena);          // sem a extensão: só adianta o pedido à placa (e sem aviso no console)
      } finally { r.getRenderTarget = original; }
    }
    await comPrazo(Promise.all(esperas), ESPERA_COMPILAR, 'compilação demorou');
    estadoCarregador.compilados++;
    return true;
  } catch (e) { console.warn('[glb] compilação adiantada falhou (segue sem ela):', e?.message || e); return false; }
}
