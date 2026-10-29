// Offline fase 2: fila de envio. O que é feito sem internet fica guardado neste aparelho e é enviado
// ao servidor quando a conexão volta, na ordem em que foi feito. O número definitivo da O.S. é sempre
// gerado pelo servidor; aqui ela recebe só um número provisório (PROV-01, PROV-02…).
import { local, erroDeRede } from "./local.js";
import { lsGet, lsSet } from "./util.js";
import { gravarFilaNaPasta } from "./pasta.js";

const CHAVE = "fila";
let ocupado = false;

export const fila = {
  listar: async () => (await local.ler(CHAVE)) || [],
  /** número provisório sequencial deste aparelho (não se repete) */
  proximoProvisorio: () => { const n = (Number(lsGet("dtcar-prov-seq")) || 0) + 1; lsSet("dtcar-prov-seq", n); return "PROV-" + String(n).padStart(2, "0"); },
  adicionar: async op => { const l = await fila.listar(); l.push({ ...op, seq: l.length ? Math.max(...l.map(x => x.seq || 0)) + 1 : 1, tentativas: 0, erro: "" }); await local.gravar(CHAVE, l); gravarFilaNaPasta(l); return l; },
  remover: async id => { const l = (await fila.listar()).filter(x => x.id !== id); await local.gravar(CHAVE, l); gravarFilaNaPasta(l); return l; },
  /** recupera a fila gravada na pasta do PC quando o navegador perdeu a dele (reenviar não duplica) */
  restaurar: async l => { if (l && l.length && !(await fila.listar()).length) { await local.gravar(CHAVE, l); return true; } return false; },
  /**
   * Envia a fila em ordem (horário de abertura, depois sequência do aparelho). Para no primeiro erro de rede.
   * Erros de dados ficam marcados na operação para revisão e não travam as seguintes.
   * Devolve { enviadas: [{ op, res }], comErro, restantes }.
   */
  processar: async (api) => {
    if (ocupado) return null;
    ocupado = true;
    const enviadas = [];
    try {
      let l = await fila.listar();
      l.sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.seq - b.seq));
      for (const op of l) {
        if (op.erro && op.tentativas >= 3) continue;
        try {
          const res = op.tipo === "abrir_os" ? await api.sincronizarAbertura(op) : null;
          await fila.remover(op.id);
          enviadas.push({ op, res });
          // guarda o histórico de numeração (para o aviso e para quem procurar pelo provisório)
          const hist = (await local.ler("numeradas")) || [];
          hist.unshift({ provisorio: op.provisorio, numero: res && res.numero, id: op.id, placa: op.ordem && op.ordem.veiculo && op.ordem.veiculo.placa, em: new Date().toISOString() });
          await local.gravar("numeradas", hist.slice(0, 200));
        } catch (e) {
          if (erroDeRede(e)) break;
          const atual = await fila.listar();
          const i = atual.findIndex(x => x.id === op.id);
          if (i >= 0) { atual[i] = { ...atual[i], erro: e.message, tentativas: (atual[i].tentativas || 0) + 1 }; await local.gravar(CHAVE, atual); }
        }
      }
      const restantes = await fila.listar();
      return { enviadas, comErro: restantes.filter(x => x.erro), restantes };
    } finally { ocupado = false; }
  },
};

/** Confere se o servidor responde (navigator.onLine pode dizer "online" com a internet do provedor caída) */
export async function servidorResponde(api, ms = 4000) {
  if (!navigator.onLine) return false;
  try { await Promise.race([api.config(), new Promise((_, n) => setTimeout(() => n(new Error("Failed to fetch (tempo esgotado)")), ms))]); return true; }
  catch (e) { return !erroDeRede(e); }
}
