// Importação do backup do OS Oficina 3.0 (arquivos .DBF/.DBT) direto pelo navegador
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Vazio } from "../ui.js";
import { lerDBF } from "../dbf.js";
import { converterLegado, lerArquivosLegado, TABELAS_LEGADO } from "../legado.js";
import { gerarBackup } from "./backup.js";

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
  const { dados, recarregar, avisar, cfg, perfil, confirmar } = useApp();
  // Espelho: até o Danilo decidir a virada, cada carga deixa o DTCar Gestão exatamente igual ao sistema antigo
  const espelho = cfg.espelhoLegado !== false;
  const [outros, setOutros] = useState([]);
  const [fase, setFase] = useState("escolher"), [msg, setMsg] = useState(""), [conv, setConv] = useState(null), [faltando, setFaltando] = useState([]);
  const [atualizarProdutos, setAtualizarProdutos] = useState(false), [prog, setProg] = useState(null), [res, setRes] = useState(null), [erro, setErro] = useState("");
  const escolher = async files => {
    if (!files || !files.length) return;
    setErro(""); setFase("lendo"); setMsg("Lendo os arquivos do backup…");
    try {
      const { t, faltando } = await lerArquivosLegado(files, lerDBF);
      setOutros([...new Set([...files].map(f => f.name.toUpperCase()).filter(n => n.endsWith(".DBF") && !TABELAS_LEGADO.includes(n.slice(0, -4))))].sort());
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
    if (espelho && !await confirmar({ titulo: "Espelhar o sistema antigo", texto: "Primeiro será baixado um backup completo do DTCar Gestão. Depois, clientes, veículos, produtos, O.S., recibos, vendas, estoque e contas a receber do DTCar Gestão são apagados e substituídos exatamente pelo backup do OS Oficina. Ficam: equipe, ajustes, fornecedores, contas a pagar, notas, funcionários.", botao: "Baixar backup e espelhar", perigo: true })) return;
    setFase("importando"); setErro("");
    const r = {};
    try {
      if (espelho) {
        setProg({ rot: "Backup de segurança do DTCar Gestão", pct: 0 });
        await gerarBackup({ cfg, perfil, prefixo: "dtcar-antes-do-espelho", origem: "servidor" }); // nunca a cópia do PC: em seguida o servidor é apagado
        setProg({ rot: "Apagando os dados atuais", pct: 2 });
        r.zerado = await api.espelhoZerar();
      }
      const total = ETAPAS.reduce((s, [k, , tam]) => s + lotes(conv[k], tam, k === "itens" ? "ordem_id" : null).length, 0); let feitos = 0;
      for (const [k, rot, tam] of ETAPAS) {
        const ls = lotes(conv[k], tam, k === "itens" ? "ordem_id" : null);
        r[k] = { incluidos: 0, atualizados: 0, pulados: [] };
        for (const lote of ls) {
          setProg({ rot, pct: Math.round(feitos / total * 100) });
          const x = await api.importarLegado(k, lote, k === "produtos" && (espelho || atualizarProdutos));
          r[k].incluidos += x.incluidos; r[k].atualizados += x.atualizados; r[k].pulados.push(...(x.pulados || [])); feitos++;
        }
      }
      setProg({ rot: "Atualizando a tela", pct: 100 });
      await recarregar(null, { completo: true });
      if (espelho) await api.salvarConfig({ ...cfg, ultimoEspelho: { em: new Date().toISOString(), por: perfil.nome, ordens: conv.ordens.length } }).catch(() => {});
      setRes(r); setFase("pronto"); avisar(espelho ? "Espelho concluído: o DTCar Gestão está igual ao sistema antigo." : "Importação concluída.");
    } catch (e) { setErro("A importação parou: " + e.message + (espelho ? ". Repita a importação: o espelho apaga e recarrega tudo de novo. O backup baixado antes guarda o que havia." : ". O que já foi enviado está salvo; você pode repetir a importação com segurança.")); setRes(r); setFase("pronto"); }
  };
  const desligarEspelho = async () => {
    if (!await confirmar({ titulo: "Desligar o espelho", texto: "A partir de agora o DTCar Gestão passa a ser o sistema principal: novas importações só completam o que falta e nada é apagado. Faça isso depois da última carga do sistema antigo.", botao: "Desligar espelho" })) return;
    try { await api.salvarConfig({ ...cfg, espelhoLegado: false }); await recarregar(["config"]); avisar("Espelho desligado."); } catch (e) { avisar(e.message, true); }
  };
  const ligarEspelho = async () => { try { await api.salvarConfig({ ...cfg, espelhoLegado: true }); await recarregar(["config"]); avisar("Espelho ligado."); } catch (e) { avisar(e.message, true); } };
  const P = conv && conv.previa;
  return html`<div class="pagina">
    <section class="card"><h2>Importar do OS Oficina 3.0</h2>
      ${espelho ? html`<div class="aviso espelho"><b>Modo espelho ligado.</b> Cada carga deixa o DTCar Gestão <b>exatamente igual</b> ao sistema antigo: clientes, veículos, produtos (com preços e estoque), O.S. com a numeração do antigo, itens e histórico. O que foi lançado só aqui nesses cadastros e O.S. é substituído (um backup é baixado antes). Equipe, ajustes, fornecedores, contas a pagar, notas e funcionários ficam.
          ${cfg.ultimoEspelho ? html`<br /><small>Última carga: ${new Date(cfg.ultimoEspelho.em).toLocaleString("pt-BR")} por ${cfg.ultimoEspelho.por} (${cfg.ultimoEspelho.ordens} O.S.).</small>` : null}
          <details class="regra-transicao" open><summary>Regra do período de transição (dois sistemas em paralelo)</summary><ol>
            <li><b>O OS Oficina é o sistema oficial.</b> Toda O.S., recibo, venda e cadastro real é lançado nele.</li>
            <li><b>O DTCar Gestão é para consulta e treino.</b> A carga substitui clientes, veículos, produtos, O.S., recibos, vendas, estoque e contas a receber. Contas a pagar, fornecedores, funcionários e as demais áreas preservadas <b>não</b> são limpos: nelas, só lance o que for real. A faixa amarela no topo de todas as telas lembra isso.</li>
            <li><b>A carga é feita só pelo administrador</b>, de preferência no fim do expediente, com o backup do OS Oficina do dia.</li>
            <li><b>A virada tem data marcada:</b> última carga, desligar o espelho e, a partir daí, lançar só no DTCar Gestão. O OS Oficina fica só para consulta.</li>
          </ol></details>
          <div class="acoes"><button type="button" class="btn btn-sm" onClick=${desligarEspelho}>Desligar espelho (virada para o DTCar Gestão)</button></div></div>`
        : html`<p>Traz do sistema antigo os cadastros completos de clientes, veículos e produtos, e as O.S. novas. Pode repetir sempre que quiser: o que já existe é completado, sem duplicar, e nada que foi alterado no DTCar Gestão é apagado.</p>
          <div class="acoes"><button type="button" class="btn btn-sm" onClick=${ligarEspelho}>Ligar modo espelho</button></div>`}
      <ol class="passos-imp"><li>No computador do OS Oficina, faça o backup (ou copie a pasta <code>DADOS</code> do sistema).</li><li>Clique em <b>Escolher pasta do backup</b> e selecione a pasta com os arquivos <code>.DBF</code> e <code>.DBT</code>.</li><li>Confira a prévia e clique em <b>Importar</b>.</li></ol>
      ${fase === "escolher" || fase === "lendo" ? html`<div class="acoes">
        <label class="btn btn-pri" for="imp-pasta">${fase === "lendo" ? msg : "Escolher pasta do backup"}</label><input id="imp-pasta" class="vh" type="file" webkitdirectory multiple onChange=${e => escolher(e.target.files)} />
        <label class="btn" for="imp-arqs">Escolher arquivos</label><input id="imp-arqs" class="vh" type="file" multiple accept=".dbf,.dbt,.fpt,.DBF,.DBT,.FPT" onChange=${e => escolher(e.target.files)} /></div>
        <span class="dica">Arquivos usados: ${TABELAS_LEGADO.map(t => t + ".DBF").join(", ")} e os memos .DBT. Os dados não saem do seu navegador a não ser para o seu banco no Supabase.</span>` : null}
      ${erro ? html`<div class="erros">${erro}</div>` : null}
    </section>
    ${fase === "previa" && P ? html`<section class="card"><h3>Prévia</h3>
      ${faltando.length ? html`<div class="aviso">Arquivos não encontrados (essas partes serão puladas): ${faltando.join(", ")}.</div>` : null}
      ${outros.length ? html`<div class="info">Outros arquivos do backup que o DTCar Gestão ainda não lê: ${outros.join(", ")}. Se algum deles tiver dados que você usa (contas, caixa, fornecedores…), avise para incluirmos na carga.</div>` : null}
      ${espelho ? html`<div class="aviso">Espelho: os dados atuais serão apagados e substituídos por este backup (${conv.clientes.length} clientes, ${conv.veiculos.length} veículos, ${conv.produtos.length} produtos, ${conv.ordens.length} O.S.).</div>` : null}
      <table class="tab-res"><thead><tr><th></th><th>No backup</th><th>Novos</th><th>Já existem (completar)</th></tr></thead><tbody>
        <tr><td>Clientes</td><td>${conv.clientes.length}</td><td>${P.clientes[0]}</td><td>${P.clientes[1]}</td></tr>
        <tr><td>Veículos</td><td>${conv.veiculos.length}</td><td>${P.veiculos[0]}</td><td>${P.veiculos[1]}</td></tr>
        <tr><td>Produtos e serviços</td><td>${conv.produtos.length}</td><td>${P.produtos[0]}</td><td>${P.produtos[1]}</td></tr>
        <tr><td>Ordens de serviço</td><td>${conv.ordens.length}</td><td>${P.ordens[0]}</td><td>${P.ordens[1]}</td></tr></tbody></table>
      ${P.conflitos.length && !espelho ? html`<div class="aviso">${P.conflitos.length} O.S. do sistema antigo usam números que já existem no DTCar Gestão e <b>não serão importadas</b>: ${P.conflitos.slice(0, 20).join(", ")}${P.conflitos.length > 20 ? "…" : ""}. Isso acontece quando os dois sistemas abrem O.S. ao mesmo tempo; lance essas manualmente.</div>` : null}
      ${espelho ? null : html`<label class="linha-check"><input type="checkbox" checked=${atualizarProdutos} onChange=${e => setAtualizarProdutos(e.target.checked)} /><span>Atualizar preços e estoque dos produtos já importados com os valores do backup (substitui o que foi alterado aqui)</span></label>`}
      <details><summary class="sub">Qualidade dos dados do backup</summary><ul class="res-lista">${Object.entries(conv.relatorio).map(([k, n]) => html`<li key=${k}>${n} ${ROTULO_REL[k] || k}</li>`)}</ul></details>
      <div class="acoes"><button type="button" class="btn" onClick=${() => { setConv(null); setFase("escolher"); }}>Escolher outro backup</button><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${importar}>${espelho ? "Espelhar (substituir tudo)" : "Importar"}</button></div>
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
