import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Dinheiro, Seg, Modal, Vazio, Foto, I } from "../ui.js";
import { norm, reais, uuid, reduzirImagem, parseValor } from "../util.js";
import { pode, PAPEIS, CONFIG_PADRAO, TERMO_ENTRADA, TERMO_ORCAMENTO, TERMO_GARANTIA } from "../regras.js";

/* ---------------- Menu "Mais" ---------------- */
export function Mais() {
  const { perfil, ir, sair } = useApp();
  const it = (rota, t, d, ic) => html`<button type="button" class="linha" onClick=${() => ir(rota)}><span class="ic">${ic}</span><span class="meio"><strong>${t}</strong><span>${d}</span></span></button>`;
  return html`<div class="pagina">
    <section class="card"><div class="perfil-linha"><b>${perfil.nome}</b><span class="sub">${perfil.email} · ${PAPEIS[perfil.papel]}</span></div></section>
    <section class="card"><div class="lista">
      ${it("/catalogo", "Catálogo de serviços", "Preços de mão de obra e tempos padrão", I.chave)}
      ${pode(perfil, "ajustes") ? it("/equipe", "Equipe", "Liberar acessos e definir papéis", I.pessoas) : null}
      ${pode(perfil, "ajustes") ? it("/ajustes", "Ajustes da oficina", "Dados, valor-hora, margens, garantia e termos", I.ajuste) : null}
      <button type="button" class="linha" onClick=${sair}><span class="ic">${I.sair}</span><span class="meio"><strong>Sair</strong><span>Encerrar a sessão neste aparelho</span></span></button>
    </div></section></div>`;
}

/* ---------------- Catálogo ---------------- */
export function Catalogo() {
  const { dados, cfg, perfil, avisar, confirmar, recarregar } = useApp();
  const [q, setQ] = useState(""), [ed, setEd] = useState(null);
  const admin = pode(perfil, "ajustes"), ver = pode(perfil, "verValores");
  const lista = dados.servicos.filter(s => !q || norm(s.nome).includes(norm(q)) || norm(s.categoria).includes(norm(q)));
  const cats = [...new Set(lista.map(s => s.categoria))].sort();
  const semPreco = dados.servicos.filter(s => s.ativo !== false && (s.cobranca === "fixo" ? !(Number(s.preco) > 0) : !(Number(s.horas) > 0))).length;
  const salvar = async () => {
    if (!ed.nome.trim()) return setEd({ ...ed, erro: "Informe o nome." });
    try { await api.servicos.salvar({ ...(ed.id ? { id: ed.id } : {}), nome: ed.nome.trim(), categoria: (ed.categoria || "Geral").trim(), cobranca: ed.cobranca, preco: ed.preco || 0, horas: ed.horas || 0, ativo: ed.ativo !== false });
      setEd(null); avisar("Serviço salvo."); recarregar(["servicos"]); } catch (e) { setEd({ ...ed, erro: e.message }); }
  };
  const excluir = async () => { if (!await confirmar({ titulo: "Excluir serviço", texto: "O serviço sai do catálogo. Orçamentos já feitos não mudam.", botao: "Excluir", perigo: true })) return;
    try { await api.servicos.excluir(ed.id); setEd(null); recarregar(["servicos"]); } catch (e) { setEd({ ...ed, erro: e.message }); } };
  const valor = s => s.cobranca === "hora" ? (Number(s.horas) ? s.horas.toString().replace(".", ",") + " h · " + reais(s.horas * (cfg.valorHora || 0)) : "tempo não definido") : (Number(s.preco) ? reais(s.preco) : "sem preço");
  return html`<div class="pagina">
    ${admin && semPreco ? html`<div class="aviso">${semPreco} serviço(s) sem preço ou sem tempo definido. Complete para usar no orçamento.</div>` : null}
    ${admin && !(Number(cfg.valorHora) > 0) ? html`<div class="aviso">Valor-hora não configurado. Defina em Ajustes para calcular os serviços cobrados por hora.</div>` : null}
    <div class="linha-add"><input id="busca-cat" class="inp" aria-label="Buscar serviço" placeholder="Buscar serviço ou categoria" value=${q} onInput=${e => setQ(e.target.value)} />
      ${admin ? html`<button type="button" class="btn btn-pri" onClick=${() => setEd({ nome: "", categoria: "Geral", cobranca: "fixo", preco: 0, horas: 0, ativo: true })}>+ Novo</button>` : null}</div>
    ${cats.length ? cats.map(c => html`<section class="card" key=${c}><h3>${c}</h3><div class="lista">${lista.filter(s => s.categoria === c).map(s => html`<button type="button" key=${s.id} class=${"linha" + (s.ativo === false ? " inativo" : "")} disabled=${!admin} onClick=${() => setEd({ ...s })}>
      <span class="meio"><strong>${s.nome}</strong><span>${s.cobranca === "hora" ? "Cobrado por hora" : "Preço fechado"}${s.ativo === false ? " · inativo" : ""}</span></span>${ver ? html`<b class=${/sem|não/.test(valor(s)) ? "c-warn" : ""}>${valor(s)}</b>` : null}</button>`)}</div></section>`)
      : html`<${Vazio}>Nenhum serviço no catálogo.</${Vazio}>`}
    ${ed ? html`<${Modal} titulo=${ed.id ? "Editar serviço" : "Novo serviço"} onFechar=${() => setEd(null)}>
      <${Campo} id="s-nome" rotulo="Nome" obrig><${Texto} id="s-nome" valor=${ed.nome} onMuda=${v => setEd({ ...ed, nome: v, erro: "" })} /></${Campo}>
      <${Campo} id="s-cat" rotulo="Categoria"><${Texto} id="s-cat" list="cats" valor=${ed.categoria} onMuda=${v => setEd({ ...ed, categoria: v })} /><datalist id="cats">${[...new Set(dados.servicos.map(s => s.categoria))].map(c => html`<option value=${c} />`)}</datalist></${Campo}>
      <${Seg} rotulo="Cobrança" opcoes=${[["Preço fechado", "info"], ["Por hora", "info"]]} valor=${ed.cobranca === "hora" ? "Por hora" : "Preço fechado"} onEscolha=${v => setEd({ ...ed, cobranca: v === "Por hora" ? "hora" : "fixo" })} />
      ${ed.cobranca === "hora" ? html`<${Campo} id="s-horas" rotulo="Tempo padrão (horas)" dica=${"Valor no orçamento: horas × " + reais(cfg.valorHora || 0) + " (valor-hora atual)"}><input id="s-horas" class="inp" inputmode="decimal" value=${String(ed.horas || "").replace(".", ",")} onInput=${e => setEd({ ...ed, horas: parseValor(e.target.value) })} /></${Campo}>`
        : html`<${Campo} id="s-preco" rotulo="Preço"><${Dinheiro} id="s-preco" valor=${ed.preco} onMuda=${v => setEd({ ...ed, preco: v })} /></${Campo}>`}
      <label class="linha-check"><input type="checkbox" checked=${ed.ativo !== false} onChange=${e => setEd({ ...ed, ativo: e.target.checked })} /><span>Ativo (aparece na busca do orçamento)</span></label>
      ${ed.erro ? html`<div class="erros">${ed.erro}</div>` : null}
      <div class="acoes">${ed.id ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}<span class="espaco"></span><button type="button" class="btn" onClick=${() => setEd(null)}>Cancelar</button><button type="button" class="btn btn-pri" onClick=${salvar}>Salvar</button></div>
    </${Modal}>` : null}
  </div>`;
}

/* ---------------- Equipe ---------------- */
export function Equipe() {
  const { dados, perfil, avisar, recarregar } = useApp();
  const pendentes = dados.perfis.filter(p => p.papel === "pendente");
  const mudar = async (p, patch) => { try { await api.salvarPerfil(p.id, patch); avisar("Acesso atualizado."); recarregar(["perfis"]); } catch (e) { avisar(e.message, true); } };
  const linha = p => html`<div class="linha" key=${p.id}><span class="meio"><strong>${p.nome}${p.id === perfil.id ? " (você)" : ""}</strong><span>${p.email}${p.ativo === false ? " · desativado" : ""}</span></span>
    <select class="inp inp-curto" aria-label=${"Papel de " + p.nome} value=${p.papel} disabled=${p.id === perfil.id} onChange=${e => mudar(p, { papel: e.target.value })}>
      ${Object.entries(PAPEIS).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select>
    ${p.id !== perfil.id ? html`<button type="button" class="btn btn-sm" onClick=${() => mudar(p, { ativo: p.ativo === false })}>${p.ativo === false ? "Reativar" : "Desativar"}</button>` : null}</div>`;
  return html`<div class="pagina">
    <div class="info">Para incluir alguém: peça para a pessoa abrir este site, tocar em “Criar acesso” e confirmar o e-mail. Ela aparece aqui como “Aguardando liberação”; escolha o papel para liberar.</div>
    ${pendentes.length ? html`<section class="card alerta"><h3>Aguardando liberação (${pendentes.length})</h3><div class="lista">${pendentes.map(linha)}</div></section>` : null}
    <section class="card"><h3>Equipe</h3><div class="lista">${dados.perfis.filter(p => p.papel !== "pendente").map(linha)}</div></section>
    <section class="card"><h3>O que cada papel faz</h3><ul class="res-lista">
      <li><b>Administrador</b>: tudo, inclusive ajustes, catálogo, equipe e exclusões.</li>
      <li><b>Consultor</b>: entrada, orçamento, aprovação, entrega, cadastros e valores.</li>
      <li><b>Mecânico</b>: entrada e execução (marca serviços feitos, fotos e observações). Não vê valores na tela.</li></ul></section>
  </div>`;
}

/* ---------------- Ajustes ---------------- */
export function Ajustes() {
  const { cfg, avisar, recarregar } = useApp();
  const [c, setC] = useState({ ...CONFIG_PADRAO, ...cfg });
  const [sujo, setSujo] = useState(false), [salvando, setSalvando] = useState(false), [novoItem, setNovoItem] = useState(""), [novaForma, setNovaForma] = useState(""), [enviando, setEnviando] = useState(false);
  useEffect(() => { if (!sujo) setC({ ...CONFIG_PADRAO, ...cfg }); }, [cfg]);
  const set = p => { setC(o => ({ ...o, ...p })); setSujo(true); };
  const salvar = async () => {
    if (!c.nome.trim()) return avisar("Informe o nome da oficina.", true);
    if (Number(c.garantiaDias) < 90) return avisar("A garantia não pode ser menor que 90 dias para serviços (CDC, art. 26, II).", true);
    setSalvando(true);
    try { await api.salvarConfig({ ...c, nome: c.nome.trim() }); setSujo(false); avisar("Ajustes salvos."); await recarregar(["config"]); }
    catch (e) { avisar(e.message, true); } finally { setSalvando(false); }
  };
  const logo = async arq => { setEnviando(true);
    try { const { blob } = await reduzirImagem(arq, 600, "image/png"); const caminho = await api.enviarArquivo("config/logo-" + uuid().slice(0, 8) + ".png", blob, "image/png"); set({ logo: caminho }); }
    catch (e) { avisar("Não foi possível usar esta imagem.", true); } finally { setEnviando(false); } };
  const num = (k, rot, dica, suf) => html`<${Campo} id=${"a-" + k} rotulo=${rot} dica=${dica}><div class="inp-suf"><input id=${"a-" + k} class="inp" inputmode="decimal" value=${String(c[k] ?? "").replace(".", ",")} onInput=${e => set({ [k]: parseValor(e.target.value) })} /><span>${suf}</span></div></${Campo}>`;
  const termo = (k, rot, padrao, dica) => html`<${Campo} id=${"a-" + k} rotulo=${rot} dica=${dica}><${Area} id=${"a-" + k} style=${{ minHeight: "150px" }} valor=${c[k]} onMuda=${v => set({ [k]: v })} /></${Campo}>
    ${c[k] !== padrao ? html`<button type="button" class="btn-link" onClick=${() => set({ [k]: padrao })}>Restaurar texto padrão</button>` : null}`;
  return html`<div class="pagina">
    <section class="card"><h2>Dados da oficina</h2><span class="sub">Aparecem no cabeçalho dos documentos.</span>
      <div class="grade">
        <${Campo} id="a-nome" rotulo="Nome" obrig><${Texto} id="a-nome" valor=${c.nome} onMuda=${v => set({ nome: v })} /></${Campo}>
        <${Campo} id="a-tel" rotulo="Telefone"><${Texto} id="a-tel" valor=${c.telefone} onMuda=${v => set({ telefone: v })} /></${Campo}>
        <${Campo} id="a-cnpj" rotulo="CNPJ"><${Texto} id="a-cnpj" valor=${c.cnpj} onMuda=${v => set({ cnpj: v })} /></${Campo}>
      </div>
      <${Campo} id="a-end" rotulo="Endereço"><${Texto} id="a-end" valor=${c.endereco} onMuda=${v => set({ endereco: v })} /></${Campo}>
      <div class="campo"><label>Logotipo</label><div class="acoes centro">
        ${c.logo ? html`<${Foto} caminho=${c.logo} alt="Logotipo" class="img-logo" />` : html`<span class="sub">Usando a logo padrão da DTCar nos documentos</span>`}
        <label class="btn btn-sm" for="a-logo">${enviando ? "Enviando…" : c.logo ? "Trocar" : "Enviar imagem"}</label><input id="a-logo" class="vh" type="file" accept="image/*" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) logo(a); }} />
        ${c.logo ? html`<button type="button" class="btn btn-sm" onClick=${() => set({ logo: "" })}>Remover</button>` : null}</div></div>
    </section>
    <section class="card"><h2>Preços e prazos</h2>
      <div class="grade">
        ${num("valorHora", "Valor da hora de mão de obra", "Usado nos serviços cobrados por hora.", "R$/h")}
        ${num("markupPecas", "Margem sugerida nas peças", "Preço de venda sugerido = custo + esta porcentagem.", "%")}
        ${num("taxaDiagnostico", "Taxa de diagnóstico", "Cobrada só se o orçamento for recusado. Ela é informada no termo de entrada. Deixe 0 para não cobrar.", "R$")}
        ${num("validadeDias", "Validade do orçamento", "O CDC (art. 40) usa 10 dias quando nada é informado.", "dias")}
        ${num("garantiaDias", "Garantia padrão dos serviços", "Mínimo legal: 90 dias (CDC, art. 26, II).", "dias")}
      </div>
      <${Campo} id="a-cond" rotulo="Condições de pagamento padrão no orçamento"><${Texto} id="a-cond" valor=${c.condicoesPadrao} onMuda=${v => set({ condicoesPadrao: v })} /></${Campo}>
      <div class="campo"><label>Formas de pagamento</label><div class="chips">${c.formasPagamento.map(f => html`<span class="chip" key=${f}>${f}<button type="button" aria-label=${"Remover " + f} onClick=${() => set({ formasPagamento: c.formasPagamento.filter(x => x !== f) })}>×</button></span>`)}</div>
        <div class="linha-add"><input class="inp" id="a-forma" placeholder="Nova forma de pagamento" value=${novaForma} onInput=${e => setNovaForma(e.target.value)} /><button type="button" class="btn" onClick=${() => { if (novaForma.trim()) { set({ formasPagamento: c.formasPagamento.concat([novaForma.trim()]) }); setNovaForma(""); } }}>Adicionar</button></div></div>
    </section>
    <section class="card"><h2>Entrada do veículo</h2>
      <label class="linha-check"><input type="checkbox" checked=${c.exigirFotos} onChange=${e => set({ exigirFotos: e.target.checked })} /><span>Exigir fotos das 4 laterais para finalizar a entrada</span></label>
      <div class="campo"><label>Itens extras do checklist</label><span class="dica">Entram na etapa Checklist com as opções OK / Verificar. Ex.: palhetas, bateria, correia.</span>
        ${c.itensExtras.length ? html`<div class="chips">${c.itensExtras.map(x => html`<span class="chip" key=${x.id}>${x.nome}<button type="button" aria-label=${"Remover " + x.nome} onClick=${() => set({ itensExtras: c.itensExtras.filter(y => y.id !== x.id) })}>×</button></span>`)}</div>` : null}
        <div class="linha-add"><input class="inp" id="a-item" placeholder="Nome do item" value=${novoItem} onInput=${e => setNovoItem(e.target.value)} /><button type="button" class="btn" onClick=${() => { if (novoItem.trim()) { set({ itensExtras: c.itensExtras.concat([{ id: uuid().slice(0, 8), nome: novoItem.trim() }]) }); setNovoItem(""); } }}>Adicionar</button></div></div>
    </section>
    <section class="card"><h2>Termos dos documentos</h2><span class="dica">Revise com seu contador ou advogado antes de usar.</span>
      ${termo("termoEntrada", "Termo do checklist de entrada", TERMO_ENTRADA, "A frase da taxa de diagnóstico é acrescentada automaticamente quando houver taxa.")}
      ${termo("termoOrcamento", "Termo do orçamento", TERMO_ORCAMENTO)}
      ${termo("termoGarantia", "Termo de garantia da O.S.", TERMO_GARANTIA, "{dias} é trocado pelo prazo de garantia da O.S.")}
    </section>
    ${sujo ? html`<div class="rodape-acoes"><div class="in"><button type="button" class="btn" onClick=${() => { setC({ ...CONFIG_PADRAO, ...cfg }); setSujo(false); }}>Desfazer</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar ajustes"}</button></div></div>` : null}
  </div>`;
}
