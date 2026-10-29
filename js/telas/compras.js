// Entrada de mercadoria pelo XML da NF-e e cadastro de fornecedores
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, Dinheiro } from "../ui.js";
import { norm, soDig, docValido, reais, qtdFmt, fmtData, fmtDataHora, fmtDoc, fmtTel, parseValor, precoPelaMargem, arred } from "../util.js";
import { pode, UNIDADES } from "../regras.js";
import { lerNFe, reconhecer, linkImagem } from "../nfe.js";
import { contasDaNota, somaMes } from "./financeiro.js";

const COMO = { vinculo: ["Já vinculado a este fornecedor", "ok"], ean: ["Encontrado pelo código de barras", "ok"], referencia: ["Encontrado pela referência", "info"], parecido: ["Há produtos parecidos", "warn"], nenhum: ["Produto novo", "muted"] };

/* ---------------- escolha de produto existente ---------------- */
function EscolherProduto({ item, onEscolha, onFechar }) {
  const { dados } = useApp();
  const [q, setQ] = useState(item.descricao_nf.split(" ").slice(0, 3).join(" "));
  const lista = useMemo(() => { const n = norm(q), cod = /^\d+$/.test(q.trim()) ? +q.trim() : null; if (!n) return [];
    return dados.produtos.filter(p => p.tipo === "produto" && (p.codigo === cod || norm(p.descricao).includes(n) || norm(p.referencia).includes(n) || norm(p.marca).includes(n) || p.codigo_barras === q.trim())).slice(0, 20); }, [q, dados.produtos]);
  return html`<${Modal} titulo="Vincular a um produto cadastrado" onFechar=${onFechar}>
    <div class="info">Na nota: <b>${item.descricao_nf}</b> · código do fornecedor ${item.codigo}${item.ean ? " · EAN " + item.ean : ""}</div>
    <${Campo} id="vp-busca" rotulo="Buscar no cadastro"><${Texto} id="vp-busca" placeholder="Descrição, código, referência ou marca" valor=${q} onMuda=${setQ} /></${Campo}>
    <div class="lista lista-cat">${lista.map(p => html`<button type="button" key=${p.id} class="linha" onClick=${() => onEscolha(p.id)}><span class="cod">${p.codigo}</span>
      <span class="meio"><strong>${p.descricao}</strong><span>${[p.referencia, p.marca, "estoque " + qtdFmt(p.estoque_atual) + " " + p.unidade].filter(Boolean).join(" · ")}</span></span></button>`)}
      ${q && !lista.length ? html`<span class="dica">Nada encontrado. Feche e escolha “Cadastrar novo”.</span>` : null}</div>
  </${Modal}>`;
}

/* ---------------- linha de item da nota ---------------- */
function ItemNota({ it, i, set, dados, cfg, ver }) {
  const [escolher, setEscolher] = useState(false);
  const prod = it.produto_id && dados.produtos.find(p => p.id === it.produto_id);
  const sug = (it.sugestoes || []).map(id => dados.produtos.find(p => p.id === id)).filter(Boolean);
  const fator = Number(it.fator) || 1, qtdEst = it.qtd * fator, custoEst = it.custo_unit / fator;
  const n = it.novo || {};
  const setN = o => set({ novo: { ...n, ...o } });
  const [rot, cor] = it.acao === "vincular" && it.como === "manual" ? ["Vinculado por você", "info"] : COMO[it.como] || COMO.nenhum;
  return html`<article class=${"nf-item a-" + it.acao}>
    <header class="nf-item-cab">
      <div class="meio"><strong>${it.descricao_nf}</strong>
        <span class="sub">Cód. fornecedor ${it.codigo}${it.ean ? " · EAN " + it.ean : ""}${it.ncm ? " · NCM " + it.ncm : ""}</span></div>
      <div class="nf-valores"><b>${qtdFmt(it.qtd)} ${it.unidade}</b>${ver ? html`<span>${reais(it.custo_unit)} /${it.unidade}${it.extras ? html` <small title="Inclui IPI, ST, frete e descontos rateados na nota">(com impostos e frete)</small>` : null}</span>` : null}</div>
    </header>
    <div class="nf-item-acoes">
      <span class=${"pill p-" + cor}>${rot}</span>
      <${Seg} rotulo=${"Ação do item " + (i + 1)} opcoes=${[["Vincular a existente", "info"], ["Cadastrar novo", "ok"], ["Ignorar", "na"]]} valor=${{ vincular: "Vincular a existente", novo: "Cadastrar novo", ignorar: "Ignorar" }[it.acao]}
        onEscolha=${v => v.startsWith("Vincular") ? (prod ? set({ acao: "vincular" }) : setEscolher(true)) : set({ acao: v.startsWith("Cadastrar") ? "novo" : "ignorar" })} />
      <a class="btn-link" href=${linkImagem(it.codigo, it.descricao_nf)} target="_blank" rel="noopener">Ver imagem</a>
    </div>
    ${it.acao === "vincular" && prod ? html`<div class="nf-vinculo"><span class="cod">${prod.codigo}</span><div class="meio"><strong>${prod.descricao}</strong><span class="sub">${[prod.referencia, prod.marca, "estoque atual " + qtdFmt(prod.estoque_atual) + " " + prod.unidade].filter(Boolean).join(" · ")}</span></div>
      <button type="button" class="btn btn-sm" onClick=${() => setEscolher(true)}>Trocar</button></div>` : null}
    ${it.acao === "novo" && sug.length ? html`<div class="aviso nf-sug">Parecidos no cadastro: ${sug.map(p => html`<button type="button" key=${p.id} class="btn-link" onClick=${() => set({ acao: "vincular", produto_id: p.id, como: "manual" })}>${p.descricao} (cód. ${p.codigo})</button>`)}. Se for o mesmo produto de outro fornecedor, toque nele para integrar.</div>` : null}
    ${it.acao === "novo" ? html`<div class="grade nf-novo">
      <${Campo} id=${"nf-d-" + i} rotulo="Descrição no cadastro"><${Texto} id=${"nf-d-" + i} valor=${n.descricao} onMuda=${v => setN({ descricao: v })} /></${Campo}>
      <${Campo} id=${"nf-r-" + i} rotulo="Referência"><${Texto} id=${"nf-r-" + i} valor=${n.referencia} onMuda=${v => setN({ referencia: v })} /></${Campo}>
      <${Campo} id=${"nf-m-" + i} rotulo="Marca"><${Texto} id=${"nf-m-" + i} list="nf-marcas" valor=${n.marca} onMuda=${v => setN({ marca: v })} /></${Campo}>
      <${Campo} id=${"nf-c-" + i} rotulo="Grupo"><${Texto} id=${"nf-c-" + i} list="nf-cats" valor=${n.categoria} onMuda=${v => setN({ categoria: v })} /></${Campo}>
      <${Campo} id=${"nf-u-" + i} rotulo="Unidade no estoque"><${Texto} id=${"nf-u-" + i} list="nf-uns" valor=${n.unidade} onMuda=${v => setN({ unidade: v.toUpperCase().slice(0, 6) })} /></${Campo}>
      ${ver ? html`<${Campo} id=${"nf-g-" + i} rotulo="Margem à vista" dica=${"Preço: " + reais(precoPelaMargem(custoEst, n.margem_vista))}><div class="inp-suf"><input id=${"nf-g-" + i} class="inp" inputmode="decimal" value=${String(n.margem_vista ?? "").replace(".", ",")} onInput=${e => setN({ margem_vista: parseValor(e.target.value) })} /><span>%</span></div></${Campo}>` : null}
      <${Campo} id=${"nf-e-" + i} rotulo="Estoque mínimo"><input id=${"nf-e-" + i} class="inp" inputmode="decimal" value=${String(n.estoque_min ?? "").replace(".", ",")} onInput=${e => setN({ estoque_min: parseValor(e.target.value) })} /></${Campo}>
    </div>` : null}
    ${it.acao !== "ignorar" ? html`<div class="nf-rodape">
      <${Campo} id=${"nf-f-" + i} rotulo=${"Unidades por " + (it.unidade || "unidade da nota")} dica="Ex.: caixa com 4 pastilhas = 4."><input id=${"nf-f-" + i} class="inp inp-curto" inputmode="decimal" value=${String(it.fator).replace(".", ",")} onInput=${e => set({ fator: parseValor(e.target.value) || 1 })} /></${Campo}>
      <span class="nf-entra">Entra no estoque: <b>${qtdFmt(qtdEst)} ${(it.acao === "novo" ? n.unidade : prod && prod.unidade) || "UN"}</b>${ver ? html` a <b>${reais(custoEst)}</b> cada${prod && Number(prod.custo) > 0 ? html` <small class=${custoEst > Number(prod.custo) * 1.05 ? "c-bad" : ""}>(custo atual ${reais(prod.custo)})</small>` : null}` : null}</span>
      ${ver && it.acao === "vincular" ? html`<label class="linha-check"><input type="checkbox" checked=${it.atualizar_custo !== false} onChange=${e => set({ atualizar_custo: e.target.checked })} /><span>Atualizar custo e preços pelas margens</span></label>` : null}
    </div>` : null}
    ${escolher ? html`<${EscolherProduto} item=${it} onFechar=${() => setEscolher(false)} onEscolha=${pid => { set({ acao: "vincular", produto_id: pid, como: "manual" }); setEscolher(false); }} />` : null}
  </article>`;
}

/* ---------------- tela de entrada da nota ---------------- */
export function EntradaNFe({ params = {} }) {
  const { dados, cfg, perfil, avisar, recarregar, ir } = useApp();
  const [nf, setNf] = useState(null), [itens, setItens] = useState([]), [erro, setErro] = useState(""), [jaImportada, setJa] = useState(null), [enviando, setEnviando] = useState(false), [res, setRes] = useState(null), [vinculos, setVinculos] = useState(null);
  const ver = pode(perfil, "verValores"), fin = pode(perfil, "financeiro");
  const [fin1, setFin1] = useState({ lancar: true, venc: "" }); // contas a pagar desta nota
  useEffect(() => { api.vinculos.listar().then(setVinculos).catch(() => setVinculos([])); }, []);
  // nota vinda da tela Notas da SEFAZ: abre o XML guardado
  useEffect(() => { if (params.sefaz) api.sefaz.xml(params.sefaz).then(x => abrir({ name: "sefaz-" + params.sefaz + ".xml", text: async () => x })).catch(e => setErro(e.message)); }, []);
  const abrir = async arq => {
    setErro(""); setRes(null); setNf(null);
    try {
      if (!/\.xml$/i.test(arq.name)) throw new Error("Escolha o arquivo XML da nota (termina em .xml). O DANFE em PDF não traz os dados de forma confiável; peça o XML ao fornecedor ou baixe no portal dele.");
      const lido = lerNFe(await arq.text());
      const forn = dados.fornecedores.find(f => f.cnpj && f.cnpj === lido.fornecedor.cnpj);
      const rec = reconhecer(lido.itens, { fornecedorId: forn && forn.id, produtos: dados.produtos, vinculos: await api.vinculos.listar().then(v => { setVinculos(v); return v; }).catch(() => vinculos || []) });
      const margem = Number(cfg.markupPecas) || 0;
      // vindo de "O que sobrou da nota": só os itens escolhidos, com a quantidade restante
      const soEstes = params.itens && arq.name.startsWith("sefaz-") ? Object.fromEntries(String(params.itens).split(",").map(x => x.split(":")).map(([k, q]) => [k, Number(q)])) : null;
      if (soEstes) rec.forEach(it => { if (!(String(it.n) in soEstes)) it.acao = "ignorar"; else if (soEstes[it.n] > 0 && soEstes[it.n] < it.qtd) it.qtd = soEstes[it.n]; });
      setItens(rec.map(it => ({ ...it, atualizar_custo: true, novo: { descricao: it.descricao_nf, referencia: it.codigo, marca: "", categoria: "", unidade: ["CX", "PCT", "JG", "KT"].includes(it.unidade) ? it.unidade : (it.unidade || "UN"), margem_vista: margem, estoque_min: 0 } })));
      setNf({ ...lido, fornecedorCadastrado: forn || null, arquivo: arq.name });
      setFin1({ lancar: lido.duplicatas.length > 0, venc: somaMes((lido.nota.emissao || new Date().toISOString()).slice(0, 10), 1) });
      setJa(await api.notas.existe(lido.nota.chave).catch(() => null));
    } catch (e) { setErro(e.message); }
  };
  const set = (i, o) => setItens(l => l.map((x, n) => n === i ? { ...x, ...o } : x));
  const resumo = { vinc: itens.filter(i => i.acao === "vincular").length, novo: itens.filter(i => i.acao === "novo").length, ign: itens.filter(i => i.acao === "ignorar").length };
  const valorEntrada = itens.filter(i => i.acao !== "ignorar").reduce((s, i) => s + i.custo_unit * i.qtd, 0);
  const confirmar = async () => {
    const semProd = itens.filter(i => i.acao === "vincular" && !i.produto_id); if (semProd.length) return setErro("Escolha o produto para: " + semProd.map(i => i.descricao_nf).join(", "));
    const semDesc = itens.filter(i => i.acao === "novo" && !(i.novo.descricao || "").trim()); if (semDesc.length) return setErro("Informe a descrição dos produtos novos.");
    setEnviando(true); setErro("");
    try {
      const p = { nota: nf.nota, fornecedor: nf.fornecedor, itens: itens.map(i => ({ acao: i.acao, produto_id: i.produto_id, codigo: i.codigo, ean: i.ean, descricao_nf: i.descricao_nf, unidade: i.unidade,
        fator: Number(i.fator) || 1, qtd: i.qtd, custo_unit: i.custo_unit, atualizar_custo: i.atualizar_custo !== false,
        novo: i.acao === "novo" ? { ...i.novo, descricao: i.novo.descricao.trim(), margem_prazo: i.novo.margem_vista, margem_atacado: i.novo.margem_vista } : undefined })) };
      const r = await api.notas.importar(p);
      if (fin && fin1.lancar) {
        try { const dups = nf.duplicatas.length ? nf.duplicatas : [{ numero: "001", vencimento: fin1.venc, valor: nf.nota.valor_total }];
          const forn = r.fornecedor_id && (dados.fornecedores.find(f => f.id === r.fornecedor_id) || {});
          const c = await api.contas.lancar(contasDaNota({ ...nf, duplicatas: dups }, r.fornecedor_id, forn && forn.categoria_padrao)); r.contas = c.lancadas;
          if (api.sefaz) api.sefaz.marcar(nf.nota.chave, { contas_lancadas: true }).catch(() => {}); }
        catch (e) { r.erroContas = e.message; }
      }
      setRes(r); avisar("Entrada da NF " + nf.nota.numero + " registrada."); await recarregar(["produtos", "fornecedores"]);
    } catch (e) { setErro(e.message); } finally { setEnviando(false); }
  };
  const listas = useMemo(() => ({ cat: [...new Set(dados.produtos.map(x => x.categoria).filter(Boolean))].sort(), marca: [...new Set(dados.produtos.map(x => x.marca).filter(Boolean))].sort() }), [dados.produtos]);
  if (res) return html`<div class="pagina"><section class="card"><h2>Entrada registrada</h2>
    <p>NF ${nf.nota.numero} de ${nf.fornecedor.fantasia || nf.fornecedor.razao}: ${res.vinculados} produto(s) com estoque atualizado, ${res.novos} cadastrado(s) e ${res.ignorados} ignorado(s).${res.contas ? " " + res.contas + " conta(s) lançada(s) em contas a pagar." : ""}</p>
    ${res.erroContas ? html`<div class="erros">O estoque foi atualizado, mas as contas a pagar não foram lançadas: ${res.erroContas}. Lance pelo Financeiro › Duplicatas do XML.</div>` : null}
    <div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => { setNf(null); setRes(null); setItens([]); }}>Importar outra nota</button><button type="button" class="btn" onClick=${() => ir("/cadastros?aba=produtos")}>Ver produtos</button></div></section></div>`;
  return html`<div class="pagina larga-media">
    <section class="card"><div class="secao-topo"><h2>Entrada de nota fiscal</h2>${!nf ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/cadastros?aba=fornecedores")}>Fornecedores</button>` : null}</div>
      ${!nf ? html`<p>Escolha o XML da NF-e de compra. O sistema cadastra o fornecedor, reconhece os produtos que você já tem, soma o estoque e atualiza o custo. Produtos novos podem ser cadastrados ou integrados a um existente.</p>
        <div class="acoes"><label class="btn btn-pri" for="nf-arq">Escolher XML da nota</label><input id="nf-arq" class="vh" type="file" accept=".xml,text/xml,application/xml" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) abrir(a); }} /></div>
        ${vinculos === null ? html`<span class="dica">Carregando vínculos de fornecedores…</span>` : null}` : null}
      ${erro ? html`<div class="erros">${erro}</div>` : null}
    </section>
    ${nf ? html`
      <section class="card nf-cab"><div class="secao-topo"><h3>NF ${nf.nota.numero}${nf.nota.serie ? " série " + nf.nota.serie : ""}</h3>${ver ? html`<b class="nf-total">${reais(nf.nota.valor_total)}</b>` : null}</div>
        <div class="kv"><div><span>Fornecedor</span><b>${nf.fornecedor.fantasia || nf.fornecedor.razao}</b></div><div><span>CNPJ</span><b>${fmtDoc(nf.fornecedor.cnpj)}</b></div>
          <div><span>Emissão</span><b>${nf.nota.emissao ? fmtDataHora(nf.nota.emissao) : "—"}</b></div><div><span>Cadastro do fornecedor</span><b>${nf.fornecedorCadastrado ? "já cadastrado" : "será cadastrado"}</b></div></div>
        ${jaImportada ? html`<div class="erros">Esta nota já foi importada em ${fmtDataHora(jaImportada.criado_em)}${jaImportada.usuario_nome ? " por " + jaImportada.usuario_nome : ""}. Importar de novo duplicaria o estoque.</div>` : null}
        <span class="dica">Chave ${nf.nota.chave}</span></section>
      <datalist id="nf-cats">${listas.cat.map(x => html`<option value=${x} />`)}</datalist><datalist id="nf-marcas">${listas.marca.map(x => html`<option value=${x} />`)}</datalist><datalist id="nf-uns">${UNIDADES.map(x => html`<option value=${x} />`)}</datalist>
      ${fin ? html`<section class="card nf-contas"><div class="secao-topo"><h3>Contas a pagar desta nota</h3>${nf.nota.pagamento ? html`<span class="sub">Pagamento: ${nf.nota.pagamento}</span>` : null}</div>
        ${nf.duplicatas.length ? html`<ul class="ranking">${nf.duplicatas.map(d => html`<li key=${d.numero}><span>Parcela ${d.numero}</span><b>${reais(d.valor)}</b><small>${fmtData(d.vencimento)}</small></li>`)}</ul>
          <label class="linha-check"><input type="checkbox" id="nf-lancar" checked=${fin1.lancar} onChange=${e => setFin1(x => ({ ...x, lancar: e.target.checked }))} /><span>Lançar ${nf.duplicatas.length === 1 ? "a duplicata" : "as " + nf.duplicatas.length + " duplicatas"} em contas a pagar</span></label>`
        : html`<span class="dica">A nota não traz duplicatas (pagamento à vista ou não informado).</span>
          <label class="linha-check"><input type="checkbox" id="nf-lancar" checked=${fin1.lancar} onChange=${e => setFin1(x => ({ ...x, lancar: e.target.checked }))} /><span>Lançar o total de ${reais(nf.nota.valor_total)} como conta a pagar</span></label>
          ${fin1.lancar ? html`<${Campo} id="nf-venc" rotulo="Vencimento"><input id="nf-venc" type="date" class="inp inp-curto" value=${fin1.venc} onInput=${e => setFin1(x => ({ ...x, venc: e.target.value }))} /></${Campo}>` : null}`}
      </section>` : null}
      <section class="card"><div class="secao-topo"><h3>Itens (${itens.length})</h3><span class="sub">${resumo.vinc} reconhecido(s) · ${resumo.novo} novo(s) · ${resumo.ign} ignorado(s)</span></div>
        <div class="nf-itens">${itens.map((it, i) => html`<${ItemNota} key=${i} it=${it} i=${i} set=${o => set(i, o)} dados=${dados} cfg=${cfg} ver=${ver} />`)}</div></section>
      <div class="rodape-acoes"><div class="in"><button type="button" class="btn" onClick=${() => { setNf(null); setItens([]); setErro(""); }}>Cancelar</button>
        <button type="button" class="btn btn-pri" disabled=${enviando || !!jaImportada} onClick=${confirmar}>${enviando ? "Registrando…" : "Dar entrada" + (ver ? " · " + reais(valorEntrada) : "")}</button></div></div>` : null}
  </div>`;
}

/* ---------------- fornecedores ---------------- */
const FORN_VAZIO = { cnpj: "", razao: "", fantasia: "", ie: "", telefone: "", email: "", endereco: "", bairro: "", cidade: "", uf: "", cep: "", contato: "", obs: "", ativo: true, prestador: false, categoria_padrao: "" };
export function FormFornecedor({ inicial, onFechar, onSalvo }) {
  const { perfil, cfg, avisar, recarregar, confirmar, dados } = useApp();
  const [f, setF] = useState({ ...FORN_VAZIO, ...inicial, cnpj: fmtDoc(inicial.cnpj || ""), telefone: fmtTel(inicial.telefone || "") }), [erro, setErro] = useState(""), [notas, setNotas] = useState(null);
  useEffect(() => { if (f.id) api.notas.listar().then(l => setNotas(l.filter(n => n.fornecedor_id === f.id))).catch(() => setNotas([])); }, []);
  const set = o => { setF(x => ({ ...x, ...o })); setErro(""); };
  const T = (k, rot, attr = {}) => html`<${Campo} id=${"fo-" + k} rotulo=${rot}><${Texto} id=${"fo-" + k} valor=${f[k]} onMuda=${v => set({ [k]: v })} ...${attr} /></${Campo}>`;
  const salvar = async () => {
    if (!f.razao.trim()) return setErro("Informe a razão social.");
    const doc = soDig(f.cnpj);
    if (doc && !docValido(doc)) return setErro("CNPJ/CPF inválido. Confira os dígitos ou deixe em branco.");
    if (doc && dados.fornecedores.some(x => x.id !== f.id && soDig(x.cnpj) === doc)) return setErro("Já existe um fornecedor com este CNPJ/CPF.");
    const tel = soDig(f.telefone); if (tel && (tel.length < 10 || tel.length > 11)) return setErro("Informe o telefone com DDD.");
    const { id, criado_em, atualizado_em, ...resto } = f;
    try { const r = await api.fornecedores.salvar({ ...(id ? { id } : {}), ...resto, razao: f.razao.trim(), cnpj: soDig(f.cnpj), telefone: soDig(f.telefone) }); avisar("Fornecedor salvo."); await recarregar(["fornecedores"]); onSalvo ? onSalvo(r) : onFechar(); }
    catch (e) { setErro(/duplicate/.test(e.message) ? "Já existe um fornecedor com este CNPJ." : e.message); }
  };
  const excluir = async () => { if (!await confirmar({ titulo: "Excluir fornecedor", texto: "Os vínculos de códigos deste fornecedor com os seus produtos também serão apagados.", botao: "Excluir", perigo: true })) return;
    try { await api.fornecedores.excluir(f.id); avisar("Fornecedor excluído."); recarregar(["fornecedores"], { completo: true }); onFechar(); } catch (e) { setErro(e.message); } };
  return html`<${Modal} titulo=${f.id ? "Fornecedor" : "Novo fornecedor"} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <fieldset disabled=${!pode(perfil, "cadastrar")} class="sem-borda form-ficha">
      <div class="grade">${T("razao", "Razão social")}${T("fantasia", "Nome fantasia")}
        <${Campo} id="fo-cnpj" rotulo="CNPJ / CPF"><input id="fo-cnpj" class="inp" inputmode="numeric" value=${f.cnpj} onBlur=${e => set({ cnpj: fmtDoc(e.target.value) })} onInput=${e => set({ cnpj: e.target.value })} /></${Campo}>
        ${T("ie", "Inscrição estadual")}</div>
      <div class="grade"><${Campo} id="fo-tel" rotulo="Telefone / WhatsApp"><input id="fo-tel" class="inp" inputmode="tel" value=${f.telefone} onBlur=${e => set({ telefone: fmtTel(e.target.value) })} onInput=${e => set({ telefone: e.target.value })} /></${Campo}>
        ${T("email", "E-mail", { type: "email" })}${T("contato", "Vendedor / contato")}</div>
      <div class="grade">${T("endereco", "Endereço")}${T("bairro", "Bairro")}${T("cidade", "Cidade")}${T("uf", "UF", { maxlength: 2 })}${T("cep", "CEP")}</div>
      <div class="grade"><${Campo} id="fo-cat" rotulo="Categoria das contas" dica="Usada ao lançar boletos deste fornecedor."><${Texto} id="fo-cat" list="fo-cats" valor=${f.categoria_padrao} onMuda=${v => set({ categoria_padrao: v })} /><datalist id="fo-cats">${(cfg.categoriasDespesa || []).map(x => html`<option value=${x} />`)}</datalist></${Campo}></div>
      <label class="linha-check"><input type="checkbox" checked=${!!f.prestador} onChange=${e => set({ prestador: e.target.checked })} /><span>Presta serviços para a oficina (retífica, torno, guincho, funilaria…)</span></label>
      <${Campo} id="fo-obs" rotulo="Observações"><${Area} id="fo-obs" valor=${f.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
    </fieldset>
    ${f.id ? html`<h4 class="sub-titulo">Notas de entrada</h4>${!notas ? html`<span class="dica">Carregando…</span>` : notas.length ? html`<div class="lista">${notas.map(n => html`<div class="linha" key=${n.id}><span class="meio"><strong>NF ${n.numero}</strong><span>${n.emissao ? fmtData(n.emissao) : fmtData(n.criado_em)} · ${(n.itens || []).length} item(ns)</span></span><b>${reais(n.valor_total)}</b></div>`)}</div>` : html`<span class="dica">Nenhuma nota importada.</span>`}` : null}
    <div class="acoes">${f.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>Cancelar</button>${pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar</button>` : null}</div>
  </${Modal}>`;
}
export function FornecedoresLista() {
  const { dados, perfil, ir } = useApp();
  const [q, setQ] = useState(""), [ed, setEd] = useState(null);
  const lista = dados.fornecedores.filter(f => !q || norm(f.razao).includes(norm(q)) || norm(f.fantasia).includes(norm(q)) || (soDig(q) && (f.cnpj || "").includes(soDig(q)))).sort((a, b) => (a.fantasia || a.razao || "").localeCompare(b.fantasia || b.razao || ""));
  return html`
    <div class="linha-add"><input id="busca-forn" class="inp" aria-label="Buscar fornecedor" placeholder="Nome ou CNPJ" value=${q} onInput=${e => setQ(e.target.value)} />
      ${pode(perfil, "cadastrar") ? html`<button type="button" class="btn" onClick=${() => ir("/nfe")}>Entrada de nota (XML)</button><button type="button" class="btn btn-pri" onClick=${() => setEd({})}>+ Novo</button>` : null}</div>
    <section class="card"><h3>${lista.length} fornecedor(es)</h3>
      ${lista.length ? html`<div class="lista">${lista.map(f => html`<button type="button" key=${f.id} class="linha" onClick=${() => setEd(f)}><span class="meio"><strong>${f.fantasia || f.razao}</strong><span>${[f.prestador ? "prestador de serviço" : "", f.fantasia ? f.razao : "", fmtDoc(f.cnpj), [f.cidade, f.uf].filter(Boolean).join("/"), f.telefone ? fmtTel(f.telefone) : ""].filter(Boolean).join(" · ")}</span></span></button>`)}</div>`
        : html`<${Vazio}>Nenhum fornecedor. Eles são cadastrados automaticamente na entrada da primeira nota.</${Vazio}>`}</section>
    ${ed ? html`<${FormFornecedor} inicial=${ed} onFechar=${() => setEd(null)} />` : null}`;
}
