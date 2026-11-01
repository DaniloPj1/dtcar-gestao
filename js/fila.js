// Offline fase 2: fila de envio. O que é feito sem internet fica guardado neste aparelho e é enviado
// ao servidor quando a conexão volta, na ordem em que foi feito. O número definitivo da O.S. é sempre
// gerado pelo servidor; aqui ela recebe só um número provisório (PROV-01, PROV-02…).
import { local, erroDeRede } from "./local.js";
import { lsGet, lsSet } from "./util.js";
import { gravarFilaNaPasta } from "./pasta.js";

const CHAVE = "fila";
let ocupado = false;
// a fila mudou: a tela atualiza a faixa "aguardando envio" e os avisos da O.S.
const mudou = () => { try { window.dispatchEvent(new Event("dtcar-fila")); } catch (e) {} };
// toda mudança da fila (ler a lista, alterar, gravar) acontece uma de cada vez: incluir uma alteração enquanto o envio
// tira a anterior não pode fazer uma das duas sumir
let cadeia = Promise.resolve();
const serial = fn => { const r = cadeia.then(fn, fn); cadeia = r.catch(() => {}); return r; };
const mudar = f => serial(async () => { const l = f((await local.ler(CHAVE)) || []); await local.gravar(CHAVE, l); gravarFilaNaPasta(l); mudou(); return l; });

export const fila = {
  listar: async () => (await local.ler(CHAVE)) || [],
  /** número provisório sequencial deste aparelho (não se repete) */
  proximoProvisorio: () => { const n = (Number(lsGet("dtcar-prov-seq")) || 0) + 1; lsSet("dtcar-prov-seq", n); return "PROV-" + String(n).padStart(2, "0"); },
  adicionar: op => mudar(l => l.concat([{ ...op, seq: l.length ? Math.max(...l.map(x => x.seq || 0)) + 1 : 1, tentativas: 0, erro: "" }])),
  /** resolução de conflito: envia esta alteração por cima do que mudou no online */
  forcar: id => mudar(l => l.map(x => x.id === id ? { ...x, forcar: true, conflito: false, erro: "", tentativas: 0 } : x)),
  /** erro que não é conflito (ex.: falha passageira do servidor): tenta de novo do zero */
  tentarDeNovo: id => mudar(l => l.map(x => x.id === id ? { ...x, erro: "", tentativas: 0 } : x)),
  remover: id => mudar(l => l.filter(x => x.id !== id)),
  /** recupera a fila gravada na pasta do PC quando o navegador perdeu a dele (reenviar não duplica) */
  restaurar: l => serial(async () => { if (l && l.length && !(await fila.listar()).length) { await local.gravar(CHAVE, l); return true; } return false; }),
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
      // etapa 3: alteração de uma O.S. que deu conflito ou erro trava as seguintes da MESMA O.S. (nunca aplica fora de ordem)
      const travadas = new Set();
      for (const op of l) {
        const os = op.tipo === "abrir_os" ? null : op.ordem_id;
        if (os && travadas.has(os)) continue;
        if ((op.conflito && !op.forcar) || (op.erro && op.tentativas >= 3)) { if (os) travadas.add(os); continue; }
        try {
          const res = op.tipo === "abrir_os" ? await api.sincronizarAbertura(op) : await api.sincronizarAlteracao(op);
          await fila.remover(op.id);
          enviadas.push({ op, res });
          // guarda o histórico de numeração (para o aviso e para quem procurar pelo provisório)
          if (op.tipo === "abrir_os") {
            const hist = (await local.ler("numeradas")) || [];
            hist.unshift({ provisorio: op.provisorio, numero: res && res.numero, id: op.id, placa: op.ordem && op.ordem.veiculo && op.ordem.veiculo.placa, em: new Date().toISOString() });
            await local.gravar("numeradas", hist.slice(0, 200));
          }
        } catch (e) {
          if (erroDeRede(e)) break;
          if (os) travadas.add(os);
          await mudar(l => l.map(x => x.id === op.id ? { ...x, erro: e.message, conflito: !!e.conflito, forcar: false, tentativas: (x.tentativas || 0) + 1 } : x));
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
