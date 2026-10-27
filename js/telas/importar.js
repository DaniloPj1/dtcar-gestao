// Importação do backup do OS Oficina 3.0 (arquivos .DBF/.DBT) direto pelo navegador
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Vazio } from "../ui.js";
import { lerDBF } from "../dbf.js";
import { converterLegado, lerArquivosLegado, TABELAS_LEGADO } from "../legado.js";

const ETAPAS = [["clientes", "Clientes", 300], ["veiculos", "Veículos", 400], ["produtos", "Produtos e serviços", 500], ["ordens", "Ordens de serviço", 200], ["itens", "Itens das O.S.", 1500], ["eventos", "Histórico", 800]];
const ROTULO_REL = { cliente_sem_telefone: "clientes sem telefone", doc_invalido: "CPF/CNPJ inválidos", doc_repetido: "CPF/CNPJ repetidos", clientes_sem_nome: "clientes sem nome (ignorados)",
  placa_formato_invalido: "placas fora do padrão", placa_vazia: "placas vazias (ignoradas)", placa_repetida: "placas repetidas", veiculo_criado_pela_os: "veículos só nas O.S. (cadastrados)", data_saida_invalida: "datas de saída inválidas (corrigidas)" };

/** divide em lotes; itens ficam juntos por O.S. (o servidor só inclui itens de O.S. sem itens) */
function lotes(linhas, tam, chave) {
  const out = []; let atual = [];
  for (let i = 0; i < linhas.length; i++) {
    atual.push(linhas[i]);
    if (atual.length >= tam && (!chave || i + 1 >= linhas.length || linhas[i + 1][chave] !== linhas[i][chave])) { out.push(atual); atual = []; }
  }
  if (atual.length) out.push(atual);
  return out;
}

export function Importar() {
  const { dados, recarregar, avisar } = useApp();
  const [fase, setFase] = useState("escolher"), [msg, setMsg] = useState(""), [conv, setConv] = useState(null), [faltando, setFaltando] = useState([]);
  const [atualizarProdutos, setAtualizarProdutos] = useState(false), [prog, setProg] = useState(null), [res, setRes] = useState(null), [erro, setErro] = useState("");
  const escolher = async files => {
    if (!files || !files.length) return;
    setErro(""); setFase("lendo"); setMsg("Lendo os arquivos do backup…");
    try {
      const { t, faltando } = await lerArquivosLegado(files, lerDBF);
      if (!t.CLIENTES && !t.ORDEM) throw new Error("Não encontrei CLIENTES.DBF nem ORDEM.DBF. Selecione a pasta do backup do OS Oficina.");
      setMsg("Convertendo…"); setFaltando(faltando);
      const c = await converterLegado(t);
      const ids = k => new Set(dados[k].map(x => x.id));
      const cli = ids("clientes"), placas = new Set(dados.veiculos.map(v => v.placa)), prods = ids("produtos"), ords = ids("ordens"), nums = new Set(dados.ordens.map(o => o.numero));
      c.previa = {
        clientes: [c.clientes.filter(x => !cli.has(x.id)).length, c.clientes.filter(x => cli.has(x.id)).length],
        veiculos: [c.veiculos.filter(x => !placas.has(x.placa)).length, c.veiculos.filter(x => placas.has(x.placa)).length],
        produtos: [c.produtos.filter(x => !prods.has(x.id)).length, c.produtos.filter(x => prods.has(x.id)).length],
        ordens: [c.ordens.filter(x => !ords.has(x.id) && !nums.has(x.numero)).length, c.ordens.filter(x => ords.has(x.id)).length],
        conflitos: c.ordens.filter(x => !ords.has(x.id) && nums.has(x.numero)).map(x => x.numero),
        maiorOS: Math.max(0, ...c.ordens.map(o => o.numero)),
      };
      setConv(c); setFase("previa");
    } catch (e) { setErro(e.message); setFase("escolher"); }
  };
  const importar = async () => {
    setFase("importando"); setErro("");
    const r = {};
    try {
      const total = ETAPAS.reduce((s, [k, , tam]) => s + lotes(conv[k], tam, k === "itens" ? "ordem_id" : null).length, 0); let feitos = 0;
      for (const [k, rot, tam] of ETAPAS) {
        const ls = lotes(conv[k], tam, k === "itens" ? "ordem_id" : null);
        r[k] = { incluidos: 0, atualizados: 0, pulados: [] };
        for (const lote of ls) {
          setProg({ rot, pct: Math.round(feitos / total * 100) });
          const x = await api.importarLegado(k, lote, k === "produtos" && atualizarProdutos);
          r[k].incluidos += x.incluidos; r[k].atualizados += x.atualizados; r[k].pulados.push(...(x.pulados || [])); feitos++;
        }
      }
      setProg({ rot: "Atualizando a tela", pct: 100 });
      await recarregar(null, { completo: true });
      setRes(r); setFase("pronto"); avisar("Importação concluída.");
    } catch (e) { setErro("A importação parou: " + e.message + ". O que já foi enviado está salvo; você pode repetir a importação com segurança."); setRes(r); setFase("pronto"); }
  };
  const P = conv && conv.previa;
  return html`<div class="pagina">
    <section class="card"><h2>Importar do OS Oficina 3.0</h2>
      <p>Traz do sistema antigo os cadastros completos de clientes, veículos e produtos, e as O.S. novas. Pode repetir sempre que quiser: o que já existe é completado, sem duplicar, e nada que foi alterado no DTCar Gestão é apagado.</p>
      <ol class="passos-imp"><li>No computador do OS Oficina, faça o backup (ou copie a pasta <code>DADOS</code> do sistema).</li><li>Clique em <b>Escolher pasta do backup</b> e selecione a pasta com os arquivos <code>.DBF</code> e <code>.DBT</code>.</li><li>Confira a prévia e clique em <b>Importar</b>.</li></ol>
      ${fase === "escolher" || fase === "lendo" ? html`<div class="acoes">
        <label class="btn btn-pri" for="imp-pasta">${fase === "lendo" ? msg : "Escolher pasta do backup"}</label><input id="imp-pasta" class="vh" type="file" webkitdirectory multiple onChange=${e => escolher(e.target.files)} />
        <label class="btn" for="imp-arqs">Escolher arquivos</label><input id="imp-arqs" class="vh" type="file" multiple accept=".dbf,.dbt,.fpt,.DBF,.DBT,.FPT" onChange=${e => escolher(e.target.files)} /></div>
        <span class="dica">Arquivos usados: ${TABELAS_LEGADO.map(t => t + ".DBF").join(", ")} e os memos .DBT. Os dados não saem do seu navegador a não ser para o seu banco no Supabase.</span>` : null}
      ${erro ? html`<div class="erros">${erro}</div>` : null}
    </section>
    ${fase === "previa" && P ? html`<section class="card"><h3>Prévia</h3>
      ${faltando.length ? html`<div class="aviso">Arquivos não encontrados (essas partes serão puladas): ${faltando.join(", ")}.</div>` : null}
      <table class="tab-res"><thead><tr><th></th><th>No backup</th><th>Novos</th><th>Já existem (completar)</th></tr></thead><tbody>
        <tr><td>Clientes</td><td>${conv.clientes.length}</td><td>${P.clientes[0]}</td><td>${P.clientes[1]}</td></tr>
        <tr><td>Veículos</td><td>${conv.veiculos.length}</td><td>${P.veiculos[0]}</td><td>${P.veiculos[1]}</td></tr>
        <tr><td>Produtos e serviços</td><td>${conv.produtos.length}</td><td>${P.produtos[0]}</td><td>${P.produtos[1]}</td></tr>
        <tr><td>Ordens de serviço</td><td>${conv.ordens.length}</td><td>${P.ordens[0]}</td><td>${P.ordens[1]}</td></tr></tbody></table>
      ${P.conflitos.length ? html`<div class="aviso">${P.conflitos.length} O.S. do sistema antigo usam números que já existem no DTCar Gestão e <b>não serão importadas</b>: ${P.conflitos.slice(0, 20).join(", ")}${P.conflitos.length > 20 ? "…" : ""}. Isso acontece quando os dois sistemas abrem O.S. ao mesmo tempo; lance essas manualmente.</div>` : null}
      <label class="linha-check"><input type="checkbox" checked=${atualizarProdutos} onChange=${e => setAtualizarProdutos(e.target.checked)} /><span>Atualizar preços e estoque dos produtos já importados com os valores do backup (substitui o que foi alterado aqui)</span></label>
      <details><summary class="sub">Qualidade dos dados do backup</summary><ul class="res-lista">${Object.entries(conv.relatorio).map(([k, n]) => html`<li key=${k}>${n} ${ROTULO_REL[k] || k}</li>`)}</ul></details>
      <div class="acoes"><button type="button" class="btn" onClick=${() => { setConv(null); setFase("escolher"); }}>Escolher outro backup</button><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${importar}>Importar</button></div>
    </section>` : null}
    ${fase === "importando" && prog ? html`<section class="card"><h3>Importando: ${prog.rot}</h3><div class="barra-prog"><i style=${{ width: prog.pct + "%" }}></i></div><span class="dica">Não feche esta tela.</span></section>` : null}
    ${fase === "pronto" && res ? html`<section class="card"><h3>Resultado</h3>
      <table class="tab-res"><thead><tr><th></th><th>Incluídos</th><th>Completados</th></tr></thead><tbody>
        ${ETAPAS.filter(([k]) => res[k]).map(([k, rot]) => html`<tr key=${k}><td>${rot}</td><td>${res[k].incluidos}</td><td>${k === "itens" ? res[k].atualizados + " ligados ao cadastro" : res[k].atualizados}</td></tr>`)}</tbody></table>
      ${res.ordens && res.ordens.pulados.length ? html`<div class="aviso">O.S. não importadas por conflito de número: ${res.ordens.pulados.join(", ")}.</div>` : null}
      <button type="button" class="btn" onClick=${() => { setConv(null); setRes(null); setFase("escolher"); }}>Fazer outra importação</button></section>` : null}
    ${fase === "escolher" && !conv ? html`<${Vazio}>Nenhum backup selecionado.</${Vazio}>` : null}
  </div>`;
}
