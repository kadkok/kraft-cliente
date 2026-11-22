import { editarLinhas, linhasSalvas } from '../../shared/ferrovia-linhas.js';

// Uma transação por mundo. Duas janelas do jogo editando a mesma linha
// conferem a revisão contra o último salvamento confirmado pelo aparelho.
export function arquivoFerroviario() {
  let abertura;
  function banco() {
    if (!abertura) abertura = new Promise((resolve, reject) => {
      const pedido = indexedDB.open('kraft-ferrovias', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('mundos');
      pedido.onerror = () => reject(pedido.error);
      pedido.onsuccess = () => {
        const db = pedido.result;
        db.onversionchange = () => { db.close(); abertura = null; };
        resolve(db);
      };
    }).catch(erro => { abertura = null; throw erro; });
    return abertura;
  }
  async function consultar(chave, comando) {
    const db = await banco();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('mundos', comando ? 'readwrite' : 'readonly');
      const mundos = tx.objectStore('mundos');
      const leitura = mundos.get(chave);
      let saida, falha;
      leitura.onsuccess = () => {
        try {
          const linhas = linhasSalvas(leitura.result);
          const resultado = comando && editarLinhas(linhas, comando.msg, comando.altura, comando.edicoes, () => crypto.randomUUID());
          const lista = [...linhas.values()];
          if (resultado?.alterou) mundos.put(lista, chave);
          saida = { lista, resultado };
        } catch (e) { falha = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(saida);
      tx.onabort = () => reject(falha || tx.error || new Error('Falha ao acessar o arquivo ferroviário.'));
    });
  }
  return { consultar };
}
