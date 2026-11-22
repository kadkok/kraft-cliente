import { problemaVia } from './ferrovia.js';
import { corredores, blocosFerroviarios } from './ferrovia-terreno.js';

export function linhasSalvas(gravadas) {
  return new Map((Array.isArray(gravadas) ? gravadas : [])
    .filter(l => l && typeof l.id === 'string' && !problemaVia(l.pontos)).map(l => [l.id, l]));
}

// A mesma edição é validada no aparelho em solo e no servidor em multiplayer.
export function editarLinhas(linhas, m, altura, edicoes, gerarId, agora = () => Date.now() / 1000) {
  const erro = texto => ({ ok: false, texto });
  const anterior = linhas.get(m.id);
  if (m.id && (!anterior || anterior.rev !== m.rev))
    return erro('Esta linha mudou. Reabra a versão atual no mapa.');
  if (m.acao === 'excluir') {
    if (!anterior) return erro('Selecione a linha que deseja remover.');
    linhas.delete(m.id);
  } else if (m.acao === 'salvar') {
    const falha = problemaVia(m.pontos);
    if (falha) return erro(falha);
    const nome = typeof m.nome === 'string' ? m.nome.trim().slice(0, 44) : '';
    if (!nome) return erro('Dê um nome à linha.');
    const pontos = m.pontos.map((p) => p.map((v) => Math.round(v * 100) / 100));
    const arredondada = problemaVia(pontos);
    if (arredondada) return erro(arredondada);
    const novo =
      !m.id && typeof m.novo === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(m.novo)
        ? m.novo
        : null;
    const repetida = novo && linhas.get(novo);
    if (repetida) {
      if (repetida.nome === nome && JSON.stringify(repetida.pontos) === JSON.stringify(pontos))
        return { ok: true, alterou: false, texto: 'Esta linha já foi salva.' };
      return erro('O rascunho já corresponde a uma linha salva. Reabra-a no mapa.');
    }
    if (!anterior && linhas.size >= 16) return erro('Este mundo já tem 16 linhas.');
    const linha = {
      id: anterior?.id || novo || gerarId(),
      nome,
      rev: (anterior?.rev || 0) + 1,
      inicio: agora(),
      pontos,
    };
    const indice = corredores([linha], altura);
    for (const chave of indice.keys()) {
      const ed = edicoes.get(chave);
      if (!ed?.size) continue;
      const [cx, cz] = chave.split(',').map(Number),
        blocos = blocosFerroviarios(indice, cx, cz);
      for (const [i, v] of ed)
        if (blocos.has(i) && blocos.get(i) !== v)
          return erro(
            'O traçado atinge uma construção ou escavação já salva. Desloque o ponto ou ajuste a altura.',
          );
    }
    linhas.set(linha.id, linha);
  } else return erro('Operação de ferrovia desconhecida.');
  return { ok: true, alterou: true,
    texto: m.acao === 'excluir' ? 'Linha removida.' : 'Linha salva. O trem está na estação A.' };
}
