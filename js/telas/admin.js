import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { acessoApp, TELAS_APP, PERMISSOES_OBD, telasDoPapel, usuarioValido, emailDoLogin, usuarioDoEmail, loginParaMostrar, DIAS_SEMANA, HORARIO_PADRAO, horarioValido } from "../appacesso.js";
import { useApp, Campo, Texto, Area, Dinheiro, Seg, Modal, Vazio, Foto, I, Abas } from "../ui.js";
import { norm, reais, uuid, reduzirImagem, parseValor } from "../util.js";
import { BotaoTema, BotaoInstalar } from "./topo.js";
import { pode, PAPEIS, CONFIG_PADRAO, TERMO_ENTRADA, TERMO_ORCAMENTO, TERMO_GARANTIA } from "../regras.js";
import { CartaoPlaca } from "../placa.js";
import { CartaoCPF } from "../cpf.js";
import { CartaoFornecedoresConectados } from "./compraspecas.js";

/* ---------------- Menu "Mais" ---------------- */
export function Mais() {
  const { perfil, ir, sair } = useApp();
  const it = (rota, t, d, ic) => html`<button type="button" class="linha" onClick=${() => ir(rota)}><span class="ic">${ic}</span><span class="meio"><strong>${t}</strong><span>${d}</span></span></button>`;
  return html`<div class="pagina tela-mais">
    <section class="card"><div class="perfil-linha"><b>${perfil.nome}</b><span class="sub">${perfil.email} · ${PAPEIS[perfil.papel]}</span></div><div class="acoes"><${BotaoTema} classe="btn btn-sm" comTexto /><${BotaoInstalar} texto="Instalar no aparelho" /></div></section>
    <section class="card"><div class="lista">
      <h3 class="lst-sec">Operação</h3>
      ${it("/agenda", "Agenda", "Serviços agendados da semana", I.calendario)}
      ${pode(perfil, "verValores") ? it("/compras", "Compras", "Preço de cada fornecedor pela placa, carrinho e pedidos por fornecedor", I.carrinho) : null}
      ${pode(perfil, "verValores") ? it("/balcao", "Venda de balcão", "Vender peças e serviços sem O.S.", I.carrinho) : null}
      <h3 class="lst-sec">Cadastros e estoque</h3>
      ${it("/cadastros?aba=produtos", "Produtos e serviços", "Peças, serviços, preços por tabela e estoque", I.caixa)}
      ${it("/oleo-filtros", "Óleo e filtros", "Litros, viscosidade e filtros pelo modelo do carro", I.gota)}
      ${it("/cadastros?aba=fornecedores", "Fornecedores", "Cadastro e notas de entrada", I.fabrica)}
      ${pode(perfil, "cadastrar") ? it("/sefaz", "Notas da SEFAZ", "Notas de compra emitidas para o CNPJ da oficina", I.nuvem) : null}
      ${pode(perfil, "cadastrar") ? it("/nfe", "Entrada de nota fiscal (XML)", "Cadastrar produtos e fornecedor e somar o estoque pela NF-e", I.nota) : null}
      <h3 class="lst-sec">Financeiro</h3>
      ${pode(perfil, "financeiro") ? it("/painel-financeiro", "Painel Financeiro", "Entradas, saídas, faturamento e meta do mês", I.grafico) : null}
      ${pode(perfil, "financeiro") ? it("/dre", "DRE gerencial", "Resultado do ano, mês a mês", I.grafico) : null}
      ${pode(perfil, "financeiro") ? it("/fluxo-diario", "Fluxo de Caixa Diário", "O caixa dia a dia, com as formas de pagamento", I.grafico) : null}
      ${pode(perfil, "financeiro") ? it("/inteligencia", "Inteligência do Negócio", "Receita por serviço, gastos e o que vem pela frente", I.grafico) : null}
      ${pode(perfil, "verValores") ? it("/recibos", "Recibos de pagamento", "Consultar, reimprimir, cancelar e emitir recibo avulso", I.recibo) : null}
      ${pode(perfil, "verValores") ? it("/receber", "Contas a receber", "Parcelas das O.S. entregues para pagar depois, vencimentos e cobrança", I.dinheiro) : null}
      ${pode(perfil, "financeiro") ? it("/boletos", "Boletos Sicredi", "Boleto com Pix: remessa para o banco, retorno e baixa automática", I.recibo) : null}
      ${pode(perfil, "financeiro") ? it("/financeiro", "Contas a pagar", "Boletos, duplicatas das notas e despesas da oficina", I.dinheiro) : null}
      ${pode(perfil, "financeiro") ? it("/caixa", "Previsão de caixa", "Saldo previsto dia a dia até o fim do mês", I.grafico) : null}
      ${pode(perfil, "financeiro") ? it("/funcionarios", "Funcionários", "Cadastro, horário, folha de ponto, vales, comissão e custo da equipe", I.pessoas) : null}
      ${pode(perfil, "verValores") ? it("/relatorios", "Relatórios", "Histórico de serviços, faturamento, caixa, contas, estoque e mais", I.grafico) : null}
      <h3 class="lst-sec">Sistema</h3>
      ${pode(perfil, "ajustes") ? it("/equipe", "Equipe", "Liberar acessos e definir papéis", I.pessoas) : null}
      ${pode(perfil, "ajustes") ? it("/app-mecanico", "App do celular (APK)", "Download do app e itens da lista do mecânico", I.carro) : null}
      ${pode(perfil, "ajustes") ? it("/ajustes", "Ajustes da oficina", "Dados, valor-hora, margens, garantia, termos e impressão", I.ajuste) : null}
      ${it("/dados-locais", "Dados neste computador", "Pasta de dados no PC, cópia para trabalhar sem internet e O.S. aguardando envio", I.caixa)}
      ${pode(perfil, "ajustes") ? it("/backup", "Backup", "Baixar uma cópia de todos os dados ou restaurar", I.nuvem) : null}
      ${pode(perfil, "ajustes") ? it("/whatsapp", "WhatsApp da oficina", "Testar a conexão e vincular o celular da oficina", I.whats) : null}
      ${pode(perfil, "ajustes") ? it("/email", "E-mail da oficina", "Conectar o Hotmail para o Claude ler e responder", I.email) : null}
      ${pode(perfil, "ajustes") ? it("/importar", "Importar do OS Oficina 3.0", "Trazer cadastros completos, produtos e O.S. novas do sistema antigo", I.painel) : null}
      <button type="button" class="linha" onClick=${sair}><span class="ic">${I.sair}</span><span class="meio"><strong>Sair</strong><span>Encerrar a sessão neste aparelho</span></span></button>
    </div></section></div>`;
}

/* ---------------- Equipe ---------------- */
/** App do celular por pessoa (cfg.appAcessos): entra ou não e quais telas vê. Grava na hora na tabela config. */
function AcessoApp({ p, cfg, salvar }) {
  const { avisar } = useApp();
  const a = acessoApp(cfg, p), ligado = a.entra;
  const atual = ((cfg.appAcessos || {})[p.id]) || {};
  const gravar = (entra, telas, horario = atual.horario) => salvar({ ...cfg, appAcessos: { ...(cfg.appAcessos || {}), [p.id]: { entra, telas, ...(horario ? { horario } : {}) } } });
  const h = horarioValido(atual.horario) ? atual.horario : null;   // null = sem limite de horário
  const mudarHorario = novo => gravar(true, a.telas, novo);
  const mudarHora = novo => { if (!horarioValido(novo)) { avisar("O horário de início precisa ser antes do fim (ex.: 07:30 às 18:00).", true); return; } mudarHorario(novo); };
  const semLimite = () => { const { horario, ...resto } = atual; salvar({ ...cfg, appAcessos: { ...(cfg.appAcessos || {}), [p.id]: { ...resto, entra: true, telas: a.telas } } }); };
  const alternarDia = d => { const dias = h.dias.includes(d) ? h.dias.filter(x => x !== d) : h.dias.concat([d]).sort(); if (dias.length) mudarHorario({ ...h, dias }); };
  const alternarTela = id => gravar(true, a.telas.includes(id) ? a.telas.filter(x => x !== id) : TELAS_APP.map(t => t[0]).filter(x => x === id || a.telas.includes(x)));
  return html`<div class="app-acesso" data-acesso=${p.id}>
    <div class="chave-linha"><span><b>App do celular</b>${a.padrao ? html`<span class="sub"> · padrão do papel</span>` : null}</span>
      <button type="button" role="switch" aria-checked=${ligado ? "true" : "false"} aria-label=${"Entra no app: " + p.nome} class=${"chave" + (ligado ? " on" : "")} onClick=${() => gravar(!ligado, ligado ? a.telas : TELAS_APP.map(t => t[0]))}><i></i></button></div>
    ${ligado ? html`<div class="chips">${TELAS_APP.map(([id, nome]) => html`<button type="button" key=${id} class="chip-btn" disabled=${!telasDoPapel(p.papel).includes(id)} title=${telasDoPapel(p.papel).includes(id) ? "" : "Só administrador e consultor fazem orçamento"} aria-pressed=${a.telas.includes(id) ? "true" : "false"} onClick=${() => alternarTela(id)}>${nome}</button>`)}</div>
      ${!a.telas.length ? html`<span class="dica">Nenhuma tela marcada: a pessoa entra e vê só o Início e a Ajuda.</span>` : null}
      ${/* O que AGE no carro, uma chave por coisa (20/11/2026). Antes era só o apagar falha; com o
            UDS entraram testar atuador, rodar aprendizado e programar bico, e cada um é mais sério
            que o anterior. A chave só aparece se a pessoa TEM a tela daquela ação: permissão solta,
            sem a tela, não quer dizer nada. O administrador não aparece porque ele sempre pode. */
        p.papel !== "admin" ? PERMISSOES_OBD.filter(([, , tela]) => (Array.isArray(tela) ? tela : [tela]).some(t => a.telas.includes(t))).map(([marca, nome, tela, aviso]) => html`
        <div class="chave-linha chave-obd" key=${marca} data-obd=${marca + "-" + p.id}><span><b>Pode ${nome.toLowerCase()}</b><span class="sub"> · ${aviso}</span></span>
          <button type="button" role="switch" aria-checked=${atual[marca] === true ? "true" : "false"} aria-label=${nome + ": " + p.nome} class=${"chave" + (atual[marca] === true ? " on" : "")}
            onClick=${() => salvar({ ...cfg, appAcessos: { ...(cfg.appAcessos || {}), [p.id]: { ...atual, entra: true, telas: a.telas, [marca]: atual[marca] !== true } } })}><i></i></button></div>`) : null}
      ${p.papel !== "admin" ? html`<div class="horario-uso" data-horario=${p.id}><span class="horario-rotulo"><b>Horário de uso</b><span class="sub"> · fora dele o app não entra</span></span>
        <div class="horario-linha"><button type="button" class="chip-btn" aria-pressed=${h ? "false" : "true"} onClick=${() => { if (h) semLimite(); }}>Sem limite</button>
          <button type="button" class="chip-btn" aria-pressed=${h ? "true" : "false"} onClick=${() => { if (!h) mudarHorario({ ...HORARIO_PADRAO }); }}>Só no horário de trabalho</button></div>
        ${h ? html`<div class="horario-linha"><label>das <input type="time" class="inp inp-hora" value=${h.de} onChange=${e => mudarHora({ ...h, de: e.target.value })} /></label><label>às <input type="time" class="inp inp-hora" value=${h.ate} onChange=${e => mudarHora({ ...h, ate: e.target.value })} /></label></div>
          <div class="chips">${DIAS_SEMANA.map((d, i) => html`<button type="button" key=${d} class="chip-btn" aria-pressed=${h.dias.includes(i) ? "true" : "false"} onClick=${() => alternarDia(i)}>${d}</button>`)}</div>` : null}</div>` : null}` : html`<span class="dica">Não entra no app do celular.</span>`}
  </div>`;
}

/** Senha sugerida: 10 caracteres com letras e números, sem os que se confundem (0/O, 1/l/I) */
export function gerarSenha() {
  const L = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz", N = "23456789", T = L + N, a = new Uint32Array(10); crypto.getRandomValues(a);
  const s = Array.from(a, (x, i) => (i === 3 || i === 7 ? N : i === 0 ? L : T)[x % (i === 3 || i === 7 ? N : i === 0 ? L : T).length]);
  return s.join("");
}
const senhaOk = s => s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s);
/** Campo de senha com "Mostrar" e "Gerar" (a senha nunca fica guardada: só vai para o servidor ao salvar) */
function CampoSenha({ id, valor, onMuda }) {
  const [ver, setVer] = useState(true);
  return html`<${Campo} id=${id} rotulo="Senha" obrig dica="8 ou mais caracteres, com letras e números. Anote para passar à pessoa: ela pode trocar depois.">
    <div class="linha-add"><input id=${id} class="inp" type=${ver ? "text" : "password"} autocomplete="new-password" value=${valor} onInput=${e => onMuda(e.target.value)} />
      <button type="button" class="btn" onClick=${() => setVer(!ver)}>${ver ? "Ocultar" : "Mostrar"}</button><button type="button" class="btn" id=${id + "-gerar"} onClick=${() => { onMuda(gerarSenha()); setVer(true); }}>Gerar</button></div></${Campo}>`;
}
/** Criar o login e a senha do colaborador pelo sistema (pedido do Danilo, 16/11/2026) — função "equipe" */
function NovoAcessoModal({ onFechar, onFeito }) {
  const { avisar } = useApp();
  const [f, setF] = useState({ nome: "", email: "", senha: "", papel: "consultor" }), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const set = p => setF(o => ({ ...o, ...p }));
  const salvar = async () => {
    const nome = f.nome.trim(), login = f.email.trim().toLowerCase(), email = emailDoLogin(login);
    if (nome.length < 2) return setErro("Informe o nome do colaborador.");
    if (!login) return setErro("Informe o usuário (ou o e-mail): é o login da pessoa.");
    if (!login.includes("@") && !usuarioValido(login)) return setErro("Usuário: de 3 a 30 letras minúsculas, números, ponto, traço ou sublinhado, sem espaço (ex.: joao.silva).");
    if (login.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setErro("Informe um e-mail válido: é o login da pessoa.");
    if (!senhaOk(f.senha)) return setErro("A senha precisa ter 8 ou mais caracteres, com letras e números.");
    setErro(""); setSalvando(true);
    try { const r = await api.equipe.criar({ nome, login, senha: f.senha, papel: f.papel }); onFeito(r, { nome, email, login, senha: f.senha }); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Criar acesso para um colaborador" onFechar=${onFechar}>
    <p class="sub">A pessoa entra no sistema e no app do celular com este usuário e esta senha. Não precisa de e-mail nem de confirmação.</p>
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <${Campo} id="na-nome" rotulo="Nome" obrig><${Texto} id="na-nome" valor=${f.nome} onMuda=${v => set({ nome: v })} /></${Campo}>
    <${Campo} id="na-email" rotulo="Usuário (login)" obrig dica="Ex.: joao.silva. Só letras minúsculas, números, ponto, traço ou sublinhado. Se preferir, pode ser um e-mail de verdade."><input id="na-email" class="inp" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" value=${f.email} onInput=${e => set({ email: e.target.value.toLowerCase().replace(/\s/g, "") })} /></${Campo}>
    <${CampoSenha} id="na-senha" valor=${f.senha} onMuda=${v => set({ senha: v })} />
    <${Campo} id="na-papel" rotulo="Papel" obrig><select id="na-papel" class="inp" value=${f.papel} onChange=${e => set({ papel: e.target.value })}>
      ${Object.entries(PAPEIS).filter(([k]) => k !== "pendente").map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></${Campo}>
    <div class="acoes"><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><span class="espaco"></span><button type="button" class="btn btn-pri" id="na-salvar" disabled=${salvando} onClick=${salvar}>${salvando ? "Criando…" : "Criar acesso"}</button></div>
  </${Modal}>`;
}
/** Trocar a senha de um colaborador que esqueceu (só administrador; a própria senha é pela tela de entrar) */
function TrocarSenhaModal({ p, onFechar }) {
  const { avisar } = useApp();
  const [senha, setSenha] = useState(""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (!senhaOk(senha)) return setErro("A senha precisa ter 8 ou mais caracteres, com letras e números.");
    setErro(""); setSalvando(true);
    try { await api.equipe.senha({ id: p.id, senha }); avisar("Senha de " + p.nome + " trocada. Passe a nova senha para a pessoa."); onFechar(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo=${"Trocar a senha de " + p.nome} onFechar=${onFechar}>
    <p class="sub">${loginParaMostrar(p.email)}. A senha antiga deixa de valer na hora.</p>
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <${CampoSenha} id="ts-senha" valor=${senha} onMuda=${setSenha} />
    <div class="acoes"><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><span class="espaco"></span><button type="button" class="btn btn-pri" id="ts-salvar" disabled=${salvando} onClick=${salvar}>${salvando ? "Trocando…" : "Trocar senha"}</button></div>
  </${Modal}>`;
}

export function Equipe() {
  const { dados, perfil, cfg, avisar, recarregar } = useApp();
  const [novo, setNovo] = useState(false), [senhaDe, setSenhaDe] = useState(null), [criado, setCriado] = useState(null);
  const salvarAcesso = async c => { try { await api.salvarConfig(c); await recarregar(["config"]); avisar("Acesso ao app atualizado. Vale na próxima vez que a pessoa abrir o app."); } catch (e) { avisar(e.message, true); } };
  const pendentes = dados.perfis.filter(p => p.papel === "pendente");
  const mudar = async (p, patch) => { try { await api.salvarPerfil(p.id, patch); avisar("Acesso atualizado."); recarregar(["perfis"]); } catch (e) { avisar(e.message, true); } };
  const linha = p => html`<div class="linha" key=${p.id}><span class="meio"><strong>${p.nome}${p.id === perfil.id ? " (você)" : ""}</strong><span>${loginParaMostrar(p.email)}${p.ativo === false ? " · desativado" : ""}</span></span>
    <select class="inp inp-curto" aria-label=${"Papel de " + p.nome} value=${p.papel} disabled=${p.id === perfil.id} onChange=${e => mudar(p, { papel: e.target.value })}>
      ${Object.entries(PAPEIS).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select>
    ${p.id !== perfil.id ? html`<button type="button" class="btn btn-sm" onClick=${() => setSenhaDe(p)}>Trocar senha</button><button type="button" class="btn btn-sm" onClick=${() => mudar(p, { ativo: p.ativo === false })}>${p.ativo === false ? "Reativar" : "Desativar"}</button>` : null}
    ${p.papel !== "pendente" && p.ativo !== false ? html`<${AcessoApp} p=${p} cfg=${cfg} salvar=${salvarAcesso} />` : null}</div>`;
  return html`<div class="pagina">
    <section class="card"><h3>Novo colaborador</h3>
      <p class="sub">Crie o login e a senha aqui mesmo e passe para a pessoa. Ela também pode criar o próprio acesso pelo site (“Criar acesso”): aí aparece como “Aguardando liberação” e você escolhe o papel.</p>
      <div class="acoes"><button type="button" class="btn btn-pri" id="eq-novo" onClick=${() => setNovo(true)}>+ Criar acesso</button></div></section>
    ${novo ? html`<${NovoAcessoModal} onFechar=${() => setNovo(false)} onFeito=${async (r, d) => { setNovo(false); setCriado(d); await recarregar(["perfis"]); }} />` : null}
    ${senhaDe ? html`<${TrocarSenhaModal} p=${senhaDe} onFechar=${() => setSenhaDe(null)} />` : null}
    ${criado ? html`<${Modal} titulo="Acesso criado" onFechar=${() => setCriado(null)}>
      <p>Passe estes dados para <b>${criado.nome}</b>. A pessoa já pode entrar no sistema e no app do celular.</p>
      <div class="lista"><div class="linha"><span class="meio"><strong>${usuarioDoEmail(criado.email) ? "Usuário (login)" : "E-mail (login)"}</strong><span id="cr-email">${usuarioDoEmail(criado.email) || criado.email}</span></span></div><div class="linha"><span class="meio"><strong>Senha</strong><span id="cr-senha">${criado.senha}</span></span></div></div>
      <p class="dica">Esta senha não fica guardada em lugar nenhum: se perder, use “Trocar senha” na pessoa. No bloco “App do celular” você escolhe o que ela vê no app.</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${() => setCriado(null)}>Entendi</button></div></${Modal}>` : null}
    ${pendentes.length ? html`<section class="card alerta"><h3>Aguardando liberação (${pendentes.length})</h3><div class="lista">${pendentes.map(linha)}</div></section>` : null}
    <section class="card"><h3>Equipe</h3><div class="lista">${dados.perfis.filter(p => p.papel !== "pendente").map(linha)}</div></section>
    <section class="card"><h3>O que cada papel faz</h3><ul class="res-lista">
      <li><b>Administrador</b>: tudo, inclusive ajustes, catálogo, equipe e exclusões.</li>
      <li><b>Consultor</b>: entrada, orçamento, aprovação, entrega, cadastros e valores.</li>
      <li><b>Mecânico</b>: entrada e execução (marca serviços feitos, fotos e observações). Não vê valores na tela.</li></ul>
      <p class="dica"><b>App do celular:</b> em cada pessoa, ligue “App do celular” e marque as telas que ela vê. Sem mexer, administrador e consultor entram com todas as telas e o mecânico não entra. Mecânico liberado consulta sem ver valores e não faz orçamento. No app, O.S. que já existe só é alterada no login do administrador. Apagar falha no OBD é do administrador: para liberar alguém, marque a tela do OBD e ligue “Pode apagar falha no OBD”.</p></section>
  </div>`;
}

/* ---------------- Ajustes ---------------- */
export function Ajustes({ params }) {
  // Abas (pedido do Danilo em 22/11/2026: "organizar o conteúdo dentro de algumas telas"): o conteúdo é o mesmo
  // de sempre, só agrupado — nada foi removido. ?aba= abre direto numa aba (os testes e atalhos usam).
  const ABAS = [["oficina", "Oficina"], ["precos", "Preços e prazos"], ["os", "O.S. e cadastros"], ["consultas", "Consultas e integrações"], ["termos", "Termos"], ["sistema", "Mais do sistema"]];
  // nada aberto de início: só os botões; cada tipo de ajuste abre ao clicar (e fecha clicando de novo)
  const [aba, setAba] = useState(params && ABAS.some(x => x[0] === params.aba) ? params.aba : null);
  const { cfg, avisar, recarregar, ir } = useApp();
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
  const [novoTexto, setNovoTexto] = useState({});
  const listaTextos = (k, rot, dica) => html`<div class="campo"><label>${rot}</label><span class="dica">${dica}</span>
    ${(c[k] || []).length ? html`<div class="chips">${c[k].map(x => html`<span class="chip" key=${x}>${x}<button type="button" aria-label=${"Remover " + x} onClick=${() => set({ [k]: c[k].filter(y => y !== x) })}>×</button></span>`)}</div>` : null}
    <div class="linha-add"><input class="inp" id=${"a-" + k} placeholder="Novo item" value=${novoTexto[k] || ""} onInput=${e => setNovoTexto(o => ({ ...o, [k]: e.target.value }))} />
      <button type="button" class="btn" onClick=${() => { const v = (novoTexto[k] || "").trim(); if (v && !(c[k] || []).includes(v)) set({ [k]: (c[k] || []).concat([v]) }); setNovoTexto(o => ({ ...o, [k]: "" })); }}>Adicionar</button></div></div>`;
  const termo = (k, rot, padrao, dica) => html`<${Campo} id=${"a-" + k} rotulo=${rot} dica=${dica}><${Area} id=${"a-" + k} style=${{ minHeight: "150px" }} valor=${c[k]} onMuda=${v => set({ [k]: v })} /></${Campo}>
    ${c[k] !== padrao ? html`<button type="button" class="btn-link" onClick=${() => set({ [k]: padrao })}>Restaurar texto padrão</button>` : null}`;
  return html`<div class="pagina tela-ajustes">
    <div class="aj-botoes" role="tablist" aria-label="Tipos de ajuste">${ABAS.map(([k, t]) => html`<button type="button" key=${k} role="tab" aria-selected=${aba === k ? "true" : "false"} aria-expanded=${aba === k ? "true" : "false"} onClick=${() => setAba(aba === k ? null : k)}>${t}</button>`)}</div>
    ${aba !== "sistema" ? null : html`<section class="card"><h2>Mais do sistema</h2><span class="sub">Atalhos do sistema que se usam pouco no dia a dia.</span>
      <div class="lista">
        <button type="button" class="linha" onClick=${() => ir("/equipe")}><span class="ic">${I.pessoas}</span><span class="meio"><strong>Equipe</strong><span>Liberar acessos e definir papéis</span></span></button>
        <button type="button" class="linha" onClick=${() => ir("/backup")}><span class="ic">${I.nuvem}</span><span class="meio"><strong>Backup</strong><span>Baixar uma cópia de todos os dados ou restaurar</span></span></button>
        <button type="button" class="linha" onClick=${() => ir("/importar")}><span class="ic">${I.painel}</span><span class="meio"><strong>Importar do OS Oficina 3.0</strong><span>Trazer cadastros, produtos e O.S. novas do sistema antigo</span></span></button>
      </div></section>`}
    ${aba !== "oficina" ? null : html`<section class="card"><h2>Dados da oficina</h2><span class="sub">Aparecem no cabeçalho dos documentos.</span>
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
    </section>`}
    ${aba !== "precos" ? null : html`<section class="card"><h2>Preços e prazos</h2>
      <div class="grade">
        ${num("valorHora", "Valor da hora de mão de obra", "Usado nos serviços cobrados por hora.", "R$/h")}
        ${num("markupPecas", "Margem sugerida nas peças", "Preço de venda sugerido = custo + esta porcentagem.", "%")}
        ${num("markupTerceiros", "Margem sugerida nos serviços de terceiros", "Valor cobrado = custo do prestador + esta porcentagem.", "%")}
        ${num("taxaDiagnostico", "Taxa de diagnóstico", "Cobrada só se o orçamento for recusado. Ela é informada no termo de entrada. Deixe 0 para não cobrar.", "R$")}
        ${num("validadeDias", "Validade do orçamento", "O CDC (art. 40) usa 10 dias quando nada é informado.", "dias")}
        ${num("garantiaDias", "Garantia padrão dos serviços", "Mínimo legal: 90 dias (CDC, art. 26, II).", "dias")}
      </div>
      <${Campo} id="a-cond" rotulo="Condições de pagamento padrão no orçamento"><${Texto} id="a-cond" valor=${c.condicoesPadrao} onMuda=${v => set({ condicoesPadrao: v })} /></${Campo}>
      <div class="campo"><label>Formas de pagamento</label><div class="chips">${c.formasPagamento.map(f => html`<span class="chip" key=${f}>${f}<button type="button" aria-label=${"Remover " + f} onClick=${() => set({ formasPagamento: c.formasPagamento.filter(x => x !== f) })}>×</button></span>`)}</div>
        <div class="linha-add"><input class="inp" id="a-forma" placeholder="Nova forma de pagamento" value=${novaForma} onInput=${e => setNovaForma(e.target.value)} /><button type="button" class="btn" onClick=${() => { if (novaForma.trim()) { set({ formasPagamento: c.formasPagamento.concat([novaForma.trim()]) }); setNovaForma(""); } }}>Adicionar</button></div></div>
    </section>
`}
    ${aba !== "os" ? null : html`<section class="card"><h2>O.S., recibos e cadastros</h2>
      <div class="grade">
        <${Campo} id="a-cidade" rotulo="Cidade (local dos recibos)"><${Texto} id="a-cidade" valor=${c.cidade} onMuda=${v => set({ cidade: v })} /></${Campo}>
        <div class="campo"><label>Vias da O.S. impressa (padrão)</label><${Seg} rotulo="Vias" opcoes=${[["1 via", "info"], ["2 vias", "info"]]} valor=${(c.impressaoVias || 1) + " via" + (c.impressaoVias === 2 ? "s" : "")} onEscolha=${v => set({ impressaoVias: +v[0] })} /></div>
      </div>
      ${listaTextos("situacoesOS", "Situações da O.S.", "Marcadores livres, como no sistema anterior (ex.: Aguardando peças). Aparecem no quadro e na impressão.")}
      ${listaTextos("tiposCliente", "Tipos de cliente", "Sugestões no cadastro de clientes.")}
      ${listaTextos("categoriasDespesa", "Categorias das contas a pagar", "Usadas no Financeiro e nos relatórios de caixa.")}
      ${termo("textoRecibo", "Texto de quitação do recibo", CONFIG_PADRAO.textoRecibo)}
    </section>
    <section class="card"><h2>Entrada do veículo</h2>
      <label class="linha-check"><input type="checkbox" checked=${c.exigirFotos} onChange=${e => set({ exigirFotos: e.target.checked })} /><span>Exigir fotos das 4 laterais para finalizar a entrada</span></label>
      <div class="campo"><label>Itens extras do checklist</label><span class="dica">Entram na etapa Checklist com as opções OK / Verificar. Ex.: palhetas, bateria, correia.</span>
        ${c.itensExtras.length ? html`<div class="chips">${c.itensExtras.map(x => html`<span class="chip" key=${x.id}>${x.nome}<button type="button" aria-label=${"Remover " + x.nome} onClick=${() => set({ itensExtras: c.itensExtras.filter(y => y.id !== x.id) })}>×</button></span>`)}</div>` : null}
        <div class="linha-add"><input class="inp" id="a-item" placeholder="Nome do item" value=${novoItem} onInput=${e => setNovoItem(e.target.value)} /><button type="button" class="btn" onClick=${() => { if (novoItem.trim()) { set({ itensExtras: c.itensExtras.concat([{ id: uuid().slice(0, 8), nome: novoItem.trim() }]) }); setNovoItem(""); } }}>Adicionar</button></div></div>
    </section>`}
    ${aba !== "consultas" ? null : html`<${CartaoPlaca} auto=${c.placaAuto} onAuto=${v => set({ placaAuto: v })} />
    <${CartaoCPF} auto=${c.cpfAuto} onAuto=${v => set({ cpfAuto: v })} />
    <${CartaoFornecedoresConectados} />`}
    ${aba !== "termos" ? null : html`<section class="card"><h2>Termos dos documentos</h2><span class="dica">Revise com seu contador ou advogado antes de usar.</span>
      ${termo("termoEntrada", "Termo do checklist de entrada", TERMO_ENTRADA, "A frase da taxa de diagnóstico é acrescentada automaticamente quando houver taxa.")}
      ${termo("termoOrcamento", "Termo do orçamento", TERMO_ORCAMENTO)}
      ${termo("termoGarantia", "Termo de garantia da O.S.", TERMO_GARANTIA, "{dias} é trocado pelo prazo de garantia da O.S.")}
    </section>`}
    ${sujo ? html`<div class="rodape-acoes"><div class="in"><button type="button" class="btn" onClick=${() => { setC({ ...CONFIG_PADRAO, ...cfg }); setSujo(false); }}>Desfazer</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar ajustes"}</button></div></div>` : null}
  </div>`;
}
