// Kraft — estúdio de skins, aba "Criar personagem" ("monte o seu"): corpo, proporções, rosto, cabelo, roupas e
// acessórios. O formulário guarda todos os valores; a receita (shared/criador.js) é refeita a cada mudança e só
// leva as partes ligadas. Tudo é lista fechada + cores; o servidor confere de novo.

import { CATALOGO, TONS_PELE, CORES_CABELO, PROP_MIN, PROP_MAX, normalizarCriador, criadorPadrao, criadorAleatorio } from '../../shared/criador.js';

const opcoes = (k) => CATALOGO[k].map((o) => `<option value="${o.id}">${o.nome}</option>`).join('');
const sel = (campo, k, rotulo) => `<label>${rotulo} <select data-c="${campo}">${opcoes(k)}</select></label>`;
const corIn = (campo, rotulo) => `<label>${rotulo} <input type="color" data-c="${campo}"></label>`;
const check = (campo, rotulo) => `<label>${rotulo} <input type="checkbox" data-c="${campo}"></label>`;
const ABAS = [['corpo', 'Corpo'], ['prop', 'Proporções'], ['rosto', 'Rosto'], ['cabelo', 'Cabelo'], ['roupas', 'Roupas'], ['acess', 'Acessórios']];

export const HTML_CRIADOR = `
  <div class="skin-actions"><button type="button" data-c-aleatorio>Aleatório</button><button type="button" data-c-padrao>Restaurar padrão</button><button type="button" data-c-limpar>Desligar o criador</button></div>
  <div class="skin-tabs criador-abas" role="group" aria-label="Partes do personagem">${ABAS.map(([k, n]) => `<button type="button" data-c-aba="${k}">${n}</button>`).join('')}</div>
  <fieldset data-c-pag="corpo"><legend>Corpo</legend>
    ${check('corpoOn', 'Pintar o corpo com estas cores')}
    <div class="pintor-cores" data-c-tons role="group" aria-label="Tons de pele"></div>
    ${corIn('pele', 'Tom de pele')}
    ${check('porParte', 'Cor diferente por parte')}
    <div data-c-partes>${corIn('cabeca', 'Cabeça')}${corIn('tronco', 'Tronco')}${corIn('bracos', 'Braços')}${corIn('pernas', 'Pernas')}</div>
    ${check('fino', 'Braços finos')}
  </fieldset>
  <fieldset data-c-pag="prop"><legend>Proporções</legend>
    <label>Altura <input type="range" data-c="altura" min="${PROP_MIN}" max="${PROP_MAX}" step=".01"></label>
    <label>Largura <input type="range" data-c="largura" min="${PROP_MIN}" max="${PROP_MAX}" step=".01"></label>
    <p class="skin-nota">Só muda o desenho: a colisão e a física continuam as mesmas de todo mundo.</p>
  </fieldset>
  <fieldset data-c-pag="rosto"><legend>Rosto</legend>
    ${check('rostoOn', 'Usar este rosto')}
    ${sel('olhos', 'olhos', 'Olhos')}${sel('sobrancelhas', 'sobrancelhas', 'Sobrancelhas')}${sel('boca', 'bocas', 'Boca')}${corIn('corOlhos', 'Cor dos olhos')}
  </fieldset>
  <fieldset data-c-pag="cabelo"><legend>Cabelo</legend>
    ${sel('cabelo', 'cabelos', 'Estilo')}
    <div class="pintor-cores" data-c-cabelos role="group" aria-label="Cores de cabelo"></div>
    ${corIn('corCabelo', 'Cor')}
  </fieldset>
  <fieldset data-c-pag="roupas"><legend>Roupas</legend>
    ${sel('camisa', 'camisas', 'Camisa')}${sel('padrao', 'padroes', 'Padrão')}${corIn('corCamisa', 'Cor')}${corIn('cor2Camisa', 'Segunda cor')}
    <hr>${sel('calca', 'calcas', 'Calça')}${sel('padraoCalca', 'padroesCalca', 'Padrão')}${corIn('corCalca', 'Cor')}${corIn('cor2Calca', 'Segunda cor')}
    <hr>${sel('sapato', 'sapatos', 'Sapato')}${corIn('corSapato', 'Cor')}
  </fieldset>
  <fieldset data-c-pag="acess"><legend>Acessórios</legend>
    ${sel('chapeu', 'chapeus', 'Chapéu')}${corIn('corChapeu', 'Cor')}
    ${sel('oculos', 'oculos', 'Óculos')}${corIn('corOculos', 'Cor')}
    ${sel('costas', 'costas', 'Costas')}${corIn('corCostas', 'Cor')}
    ${sel('pescoco', 'pescoco', 'Pescoço')}${corIn('corPescoco', 'Cor')}
  </fieldset>`;

const PADRAO_FORM = {
  corpoOn: false, pele: '#c98d65', porParte: false, cabeca: '#c98d65', tronco: '#c98d65', bracos: '#c98d65', pernas: '#c98d65', fino: false,
  altura: 1, largura: 1,
  rostoOn: false, olhos: 'redondos', sobrancelhas: 'retas', boca: 'sorriso', corOlhos: '#3b2a1e',
  cabelo: 'nenhum', corCabelo: '#3b2618',
  camisa: 'nenhuma', padrao: 'liso', corCamisa: '#3f7fbf', cor2Camisa: '#f0ede4',
  calca: 'nenhuma', padraoCalca: 'liso', corCalca: '#34465e', cor2Calca: '#d9d3c4',
  sapato: 'nenhum', corSapato: '#2c2a2a',
  chapeu: 'nenhum', corChapeu: '#b84a3a', oculos: 'nenhum', corOculos: '#2a2a30', costas: 'nenhuma', corCostas: '#b84a3a', pescoco: 'nenhum', corPescoco: '#c0463a',
};

export function receitaDoForm(f) {
  const peleDe = (k) => f.porParte ? f[k] : f.pele;
  return normalizarCriador({
    corpo: f.corpoOn ? { pele: f.pele, cabeca: peleDe('cabeca'), tronco: peleDe('tronco'), bracos: peleDe('bracos'), pernas: peleDe('pernas'), fino: f.fino } : null,
    prop: { altura: f.altura, largura: f.largura },
    rosto: f.rostoOn ? { olhos: f.olhos, sobrancelhas: f.sobrancelhas, boca: f.boca, corOlhos: f.corOlhos } : null,
    cabelo: { estilo: f.cabelo, cor: f.corCabelo },
    camisa: { estilo: f.camisa, padrao: f.padrao, cor: f.corCamisa, cor2: f.cor2Camisa },
    calca: { estilo: f.calca, padrao: f.padraoCalca, cor: f.corCalca, cor2: f.cor2Calca },
    sapato: { estilo: f.sapato, cor: f.corSapato },
    acess: { chapeu: { id: f.chapeu, cor: f.corChapeu }, oculos: { id: f.oculos, cor: f.corOculos }, costas: { id: f.costas, cor: f.corCostas }, pescoco: { id: f.pescoco, cor: f.corPescoco } },
  });
}
export function formDaReceita(c, f = { ...PADRAO_FORM }) {
  f = { ...f, corpoOn: !!c?.corpo, rostoOn: !!c?.rosto, cabelo: 'nenhum', camisa: 'nenhuma', calca: 'nenhuma', sapato: 'nenhum', chapeu: 'nenhum', oculos: 'nenhum', costas: 'nenhuma', pescoco: 'nenhum', altura: 1, largura: 1 };
  if (!c) return f;
  if (c.corpo) Object.assign(f, { pele: c.corpo.pele, cabeca: c.corpo.cabeca, tronco: c.corpo.tronco, bracos: c.corpo.bracos, pernas: c.corpo.pernas, fino: c.corpo.fino, porParte: ['cabeca', 'tronco', 'bracos', 'pernas'].some((k) => c.corpo[k] !== c.corpo.pele) });
  if (c.prop) Object.assign(f, c.prop);
  if (c.rosto) Object.assign(f, { olhos: c.rosto.olhos, sobrancelhas: c.rosto.sobrancelhas, boca: c.rosto.boca, corOlhos: c.rosto.corOlhos });
  if (c.cabelo) Object.assign(f, { cabelo: c.cabelo.estilo, corCabelo: c.cabelo.cor });
  if (c.camisa) Object.assign(f, { camisa: c.camisa.estilo, padrao: c.camisa.padrao, corCamisa: c.camisa.cor, cor2Camisa: c.camisa.cor2 });
  if (c.calca) Object.assign(f, { calca: c.calca.estilo, padraoCalca: c.calca.padrao, corCalca: c.calca.cor, cor2Calca: c.calca.cor2 });
  if (c.sapato) Object.assign(f, { sapato: c.sapato.estilo, corSapato: c.sapato.cor });
  for (const [slot, cor] of [['chapeu', 'corChapeu'], ['oculos', 'corOculos'], ['costas', 'corCostas'], ['pescoco', 'corPescoco']]) if (c.acess?.[slot]) { f[slot] = c.acess[slot].id; f[cor] = c.acess[slot].cor; }
  return f;
}

export function initCriador({ dialog, draft, requestPreview, status }) {
  const campos = [...dialog.querySelectorAll('[data-c]')];
  let form = { ...PADRAO_FORM }, aba = 'corpo';

  function mostrar() {
    for (const b of dialog.querySelectorAll('[data-c-aba]')) b.setAttribute('aria-pressed', String(b.dataset.cAba === aba));
    for (const p of dialog.querySelectorAll('[data-c-pag]')) p.hidden = p.dataset.cPag !== aba;
    dialog.querySelector('[data-c-partes]').hidden = !form.porParte;
    for (const k of ['cabeca', 'tronco', 'bracos', 'pernas', 'pele', 'porParte', 'fino']) dialog.querySelector(`[data-c="${k}"]`).disabled = !form.corpoOn;
    for (const k of ['olhos', 'sobrancelhas', 'boca', 'corOlhos']) dialog.querySelector(`[data-c="${k}"]`).disabled = !form.rostoOn;
  }
  function preencherCampos() {
    for (const el of campos) {
      const v = form[el.dataset.c];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
    }
    mostrar();
  }
  function aplicar() {
    draft().criador = receitaDoForm(form);
    requestPreview();
  }
  for (const el of campos) {
    el.addEventListener(el.type === 'range' || el.type === 'color' ? 'input' : 'change', () => {
      const k = el.dataset.c;
      form[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      // escolher o rosto ou uma cor de pele já liga a parte (ninguém procura a caixinha antes)
      if (['olhos', 'sobrancelhas', 'boca', 'corOlhos'].includes(k)) form.rostoOn = true;
      if (k === 'porParte' && el.checked) for (const p of ['cabeca', 'tronco', 'bracos', 'pernas']) form[p] = form.pele;
      preencherCampos();
      aplicar();
    });
  }
  const amostras = (alvo, cores, campo, liga) => {
    for (const hex of cores) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pintor-amostra';
      b.style.background = `linear-gradient(160deg, ${hex}, ${hex} 60%, #0004)`;
      b.setAttribute('aria-label', 'Cor ' + hex);
      b.onclick = () => { form[campo] = hex; if (liga) form[liga] = true; if (campo === 'pele' && !form.porParte) for (const p of ['cabeca', 'tronco', 'bracos', 'pernas']) form[p] = hex; if (campo === 'corCabelo' && form.cabelo === 'nenhum') form.cabelo = 'curto'; preencherCampos(); aplicar(); };
      dialog.querySelector(`[data-c-${alvo}]`).append(b);
    }
  };
  amostras('tons', TONS_PELE, 'pele', 'corpoOn');
  amostras('cabelos', CORES_CABELO, 'corCabelo');
  for (const b of dialog.querySelectorAll('[data-c-aba]')) b.onclick = () => { aba = b.dataset.cAba; mostrar(); requestPreview(); };
  dialog.querySelector('[data-c-aleatorio]').onclick = () => { draft().criador = criadorAleatorio(); form = formDaReceita(draft().criador, form); preencherCampos(); requestPreview(); status('Personagem aleatório. Gostou? Toque em Aplicar no jogo.'); };
  dialog.querySelector('[data-c-padrao]').onclick = () => { draft().criador = criadorPadrao(); form = formDaReceita(draft().criador, form); preencherCampos(); requestPreview(); status('Personagem padrão do criador.'); };
  dialog.querySelector('[data-c-limpar]').onclick = () => { draft().criador = null; form = formDaReceita(null, form); preencherCampos(); requestPreview(); status('Criador desligado: vale a base e as estampas.'); };

  return {
    sync() { form = formDaReceita(draft().criador, form); preencherCampos(); },
    perto: () => aba === 'rosto' || aba === 'cabelo',
  };
}
