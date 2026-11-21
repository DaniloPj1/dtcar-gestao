/**
 * Honda: a lista dos testes e aprendizados que têm nome (js/obdhonda.js), para as telas de atuador
 * e de aprendizado. Tocar num item aponta o módulo certo, lê e guarda o valor antigo, e devolve
 * tudo para a tela pedir a confirmação escrita das condições.
 */
import { html, useState } from "../js/lib.js";
import * as uds from "../js/uds.js";
import * as sessao from "../js/obdsessao.js";
import * as honda from "../js/obdhonda.js";
import { Cartao } from "./comum.js";

export function HondaLista({ tipo, st, aoPronto, travado }) {
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  if (!honda.eHonda(st.carro)) return null;
  const itens = tipo === "atuadores" ? honda.ATUADORES : honda.APRENDIZADOS;
  const escolher = async item => {
    setErro(""); setOcupado("Procurando o módulo: " + honda.MODULOS[item.modulo].nome + "…");
    let mod = null, antes = null, oferecido = true;
    for (const e of honda.MODULOS[item.modulo].enderecos) {
      const m = { ...e, nome: honda.MODULOS[item.modulo].nome };
      const a = await sessao.apontarModulo(m);
      if (!a.ok) continue;
      const s = await sessao.tomar("a preparação do teste", async () => {
        const se = await uds.sessao(uds.SESSAO.estendida);
        if (se.erro || se.nrc != null) return null;
        let bytes = null;
        if (item.antes || item.habilita) { const l = await uds.lerDado((item.habilita || item.antes).did); bytes = l.dados && l.nrc == null ? l.dados.slice(2) : null; }
        let bytesAntes = bytes;
        if (item.antes && item.habilita && item.antes.did !== item.habilita.did) { const l2 = await uds.lerDado(item.antes.did); bytesAntes = l2.dados && l2.nrc == null ? l2.dados.slice(2) : null; }
        return { antes: honda.valorAntes(item.antes, bytesAntes), oferecido: honda.habilitado(item, bytes) };
      });
      if (s.ok && s.r) { mod = m; antes = s.r.antes; oferecido = s.r.oferecido; break; }
      await sessao.soltarModulo();
    }
    setOcupado("");
    if (!mod) { setErro("O módulo " + honda.MODULOS[item.modulo].nome + " não abriu a sessão de diagnóstico neste carro. Sem ele não há como rodar este item."); return; }
    if (oferecido === false) { await sessao.soltarModulo(); setErro("Este carro diz que NÃO tem este item habilitado no painel. O app não roda o que o próprio carro não oferece."); return; }
    if (oferecido === null) { await sessao.soltarModulo(); setErro("Não deu para ler se o carro tem este item habilitado. Sem essa leitura o app não roda."); return; }
    if (item.antes && antes === null) { await sessao.soltarModulo(); setErro("O módulo não entregou o valor atual que seria guardado antes. Sem o valor antigo o app não roda este item."); return; }
    aoPronto({ mod, item, antes });
  };
  return html`<${Cartao} titulo=${tipo === "atuadores" ? "Honda: testes com nome" : "Honda: aprendizados e funções de serviço"} id="honda-lista">
    <p class="nota">Vêm da ferramenta de diagnóstico da Honda. Foram conferidos contra módulo simulado, não contra carro: o módulo deste carro pode recusar, e aí o app mostra a recusa.</p>
    ${itens.map(i => html`<button key=${i.chave} type="button" class="obd-ap" data-chave=${i.chave} onClick=${() => escolher(i)} disabled=${!st.ligado || !!st.dono || !!ocupado || travado}>
      <b>${i.nome}</b><span>${honda.MODULOS[i.modulo].nome}</span></button>`)}
    ${!st.ligado ? html`<div class="nota">Conecte o adaptador para escolher.</div>` : null}
    ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
    ${erro ? html`<div class="erro" id="honda-erro">${erro}</div>` : null}
  </${Cartao}>`;
}

/** As condições, uma a uma, para marcar. Só libera quando TODAS estão marcadas: é a confirmação escrita. */
export function Condicoes({ item, aoMudar }) {
  const [ok, setOk] = useState({});
  const marcar = (i, v) => { const n = { ...ok, [i]: v }; setOk(n); aoMudar(item.condicoes.every((_, k) => n[k])); };
  return html`<div class="honda-cond" id="honda-condicoes">
    <div class="fx-t">Confirme cada condição</div>
    ${item.condicoes.map((c, i) => html`<label key=${i} class="bico-marca"><input type="checkbox" checked=${!!ok[i]} onChange=${e => marcar(i, e.target.checked)} /><span>${c}</span></label>`)}
  </div>`;
}
