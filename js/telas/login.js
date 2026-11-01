import { html, useState, useEffect } from "../lib.js";
import { api, salvarConexaoLocal, estaSemRede, definirSemRede } from "../api.js";
import { erroDeRede } from "../local.js";
import { guardarAcesso, esquecerAcesso, conferirAcesso, temAcessoGuardado, entrarNoPC, sairDoPC, sessaoDoPC } from "../acesso.js";

/** entra pelo servidor; sem internet, confere a senha guardada neste computador e abre com o banco do PC */
export async function entrarComOuSemInternet(email, senha) {
  // confere o servidor mesmo se a tela estava no modo sem internet (a conexão pode ter voltado antes da próxima conferência)
  const online = navigator.onLine && (!api.testarConexao || await api.testarConexao());
  if (online) {
    const estava = estaSemRede(); definirSemRede(false); // o servidor respondeu: libera a conexão para o login
    try {
      const r = await api.auth.entrar(email, senha);
      sairDoPC();
      if (r && r.user) await guardarAcesso(email, senha, r.user.id).catch(() => false); // para poder entrar sem internet depois
      return "online";
    } catch (x) { if (estava) definirSemRede(true); if (!erroDeRede(x)) throw x; }
  }
  const a = await conferirAcesso(email, senha);
  if (a) { entrarNoPC(a); location.reload(); return "pc"; }
  throw new Error(await temAcessoGuardado(email)
    ? "Sem internet: a senha não confere com a guardada neste computador."
    : "Sem internet: este computador ainda não tem o seu acesso guardado. Entre uma vez com internet (depois disso dá para entrar sem internet).");
}
/** nova senha (link de recuperação): a conferência deste computador passa a ser a da senha nova; a antiga não abre mais sem internet */
export async function trocarSenha(senha) {
  const r = await api.auth.novaSenha(senha), u = r && r.user;
  if (u && u.email) { const g = await guardarAcesso(u.email, senha, u.id).catch(() => false); if (!g) await esquecerAcesso(u.email).catch(() => {}); }
  return r;
}
import { Campo, Texto, Modal } from "../ui.js";

function Moldura({ children }) {
  return html`<div class="tela-login"><div class="login-caixa">
    <img class="login-logo" src="icons/logo-preto.png" alt="DTCar Centro Automotivo" /><span class="login-sub">Gestão da oficina</span>${children}</div></div>`;
}

export function Conexao() {
  const [url, setUrl] = useState(""), [key, setKey] = useState(""), [erro, setErro] = useState("");
  const salvar = () => {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim())) return setErro("A URL deve ser do tipo https://xxxx.supabase.co");
    if (key.trim().length < 30) return setErro("Cole a chave anon public completa.");
    salvarConexaoLocal(url.trim().replace(/\/$/, ""), key.trim()); location.reload();
  };
  return html`<${Moldura}>
    <h1>Conectar ao banco de dados</h1>
    <p class="sub">O site ainda não está ligado ao Supabase. Preencha com os dados do seu projeto (Supabase › Project Settings › API). Isso fica salvo só neste aparelho; para valer para todos, os dados vão no arquivo <code>js/config.js</code>.</p>
    <${Campo} id="cx-url" rotulo="Project URL"><${Texto} id="cx-url" placeholder="https://xxxx.supabase.co" valor=${url} onMuda=${setUrl} /></${Campo}>
    <${Campo} id="cx-key" rotulo="anon public key"><${Texto} id="cx-key" valor=${key} onMuda=${setKey} /></${Campo}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <button type="button" class="btn btn-pri btn-bloco" onClick=${salvar}>Conectar</button>
  </${Moldura}>`;
}

export function Login({ modo: modoInicial }) {
  const [modo, setModo] = useState(modoInicial || "entrar");
  const [nome, setNome] = useState(""), [email, setEmail] = useState(""), [senha, setSenha] = useState("");
  const [msg, setMsg] = useState(null), [ocupado, setOcupado] = useState(false);
  // sem internet? (o Windows pode dizer que há rede sem haver internet: confere o servidor ao abrir a tela)
  const [semNet, setSemNet] = useState(estaSemRede() || !navigator.onLine);
  useEffect(() => { let vivo = true; if (api && api.testarConexao) api.testarConexao().then(ok => { if (vivo) setSemNet(!ok); }).catch(() => {}); return () => { vivo = false; }; }, []);
  const enviar = async e => {
    e.preventDefault(); setMsg(null); setOcupado(true);
    try {
      if (modo === "entrar") await entrarComOuSemInternet(email.trim(), senha);
      else if (modo === "criar") {
        if (!nome.trim()) throw new Error("Informe seu nome.");
        const r = await api.auth.cadastrar(nome.trim(), email.trim(), senha);
        setMsg({ ok: true, t: r && r.session ? "Acesso criado." : "Enviamos um link de confirmação para " + email.trim() + ". Confirme e depois entre com sua senha." });
        if (!(r && r.session)) setModo("entrar");
      } else if (modo === "recuperar") { await api.auth.recuperar(email.trim()); setMsg({ ok: true, t: "Se o e-mail estiver cadastrado, você receberá um link para criar nova senha." }); }
      else if (modo === "nova") {
        await trocarSenha(senha); setMsg({ ok: true, t: "Senha alterada." }); location.hash = "#/painel"; location.reload(); }
    } catch (x) { setMsg({ ok: false, t: x.message }); } finally { setOcupado(false); }
  };
  const titulos = { entrar: "Entrar", criar: "Criar acesso", recuperar: "Recuperar senha", nova: "Definir nova senha" };
  return html`<${Moldura}>
    <h1>${titulos[modo]}</h1>
    ${modo === "criar" ? html`<p class="sub">Depois de criar, o administrador precisa liberar seu acesso.</p>` : null}
    ${modo === "entrar" && semNet ? html`<p class="sub">Sem internet: entre com a sua senha; este computador confere (se você já entrou aqui com internet antes).</p>` : null}
    <form onSubmit=${enviar} class="form-login">
      ${modo === "criar" ? html`<${Campo} id="lg-nome" rotulo="Seu nome"><${Texto} id="lg-nome" autocomplete="name" valor=${nome} onMuda=${setNome} /></${Campo}>` : null}
      ${modo !== "nova" ? html`<${Campo} id="lg-email" rotulo="E-mail"><${Texto} id="lg-email" type="email" autocomplete="email" valor=${email} onMuda=${setEmail} /></${Campo}>` : null}
      ${modo !== "recuperar" ? html`<${Campo} id="lg-senha" rotulo=${modo === "nova" ? "Nova senha" : "Senha"} dica=${modo === "entrar" ? "" : "Mínimo de 6 caracteres."}><${Texto} id="lg-senha" type="password" autocomplete=${modo === "entrar" ? "current-password" : "new-password"} valor=${senha} onMuda=${setSenha} /></${Campo}>` : null}
      ${msg ? html`<div class=${msg.ok ? "info" : "erros"} role="status">${msg.t}</div>` : null}
      <button type="submit" class="btn btn-pri btn-bloco" disabled=${ocupado}>${ocupado ? "Aguarde…" : titulos[modo]}</button>
    </form>
    ${modo !== "nova" ? html`<div class="login-links">
      ${modo !== "entrar" ? html`<button type="button" class="btn-link" onClick=${() => { setModo("entrar"); setMsg(null); }}>Já tenho acesso</button>` : null}
      ${modo !== "criar" ? html`<button type="button" class="btn-link" onClick=${() => { setModo("criar"); setMsg(null); }}>Criar acesso</button>` : null}
      ${modo === "entrar" ? html`<button type="button" class="btn-link" onClick=${() => { setModo("recuperar"); setMsg(null); }}>Esqueci a senha</button>` : null}
    </div>` : null}
  </${Moldura}>`;
}

export function Pendente({ perfil, sair, semInternet }) {
  // sem internet não dá para conferir a liberação: não é "aguardando liberação" (e "Sair" agora impediria entrar de novo)
  if (semInternet && (!perfil || perfil.papel === "pendente")) return html`<${Moldura}>
    <h1>Sem internet</h1>
    <p>Não foi possível conferir o seu acesso: este computador ainda não tem a cópia dos dados. Conecte à internet e abra o programa uma vez;
      depois disso ele abre sem internet com o banco de dados do PC.</p>
    <button type="button" class="btn btn-bloco" onClick=${() => location.reload()}>Tentar de novo</button>
    ${sessaoDoPC() ? html`<button type="button" class="btn btn-bloco" onClick=${() => { sairDoPC(); location.reload(); }}>Entrar com internet</button>` : null}
    <button type="button" class="btn-link" onClick=${sair}>Sair</button>
  </${Moldura}>`;
  return html`<${Moldura}>
    <h1>Acesso aguardando liberação</h1>
    <p>Olá, ${perfil ? perfil.nome : ""}. Seu cadastro foi criado. Peça ao administrador da oficina para liberar seu acesso em <b>Mais › Equipe</b>.</p>
    ${perfil && perfil.ativo === false ? html`<div class="aviso">Este acesso foi desativado pelo administrador.</div>` : null}
    <button type="button" class="btn btn-bloco" onClick=${() => location.reload()}>Já fui liberado</button>
    <button type="button" class="btn-link" onClick=${sair}>Sair</button>
  </${Moldura}>`;
}

/** confirma a senha com internet e guarda a conferência neste computador (para poder entrar sem internet depois) */
export function GuardarAcessoModal({ email, onFechar, onFeito }) {
  const [senha, setSenha] = useState(""), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const confirmar = async e => {
    e.preventDefault(); setErro(""); setOcupado(true);
    try {
      const r = await api.auth.entrar(email, senha);
      if (!(r && r.user) || !(await guardarAcesso(email, senha, r.user.id))) throw new Error("Não foi possível guardar o acesso neste computador.");
      onFeito && onFeito();
    } catch (x) { setErro(erroDeRede(x) ? "Precisa de internet para conferir a senha." : x.message); } finally { setOcupado(false); }
  };
  return html`<${Modal} titulo="Entrar sem internet neste computador" onFechar=${onFechar}>
    <p>Digite a sua senha uma vez, com internet. O computador guarda só uma conferência dela (a senha não fica gravada) e passa a deixar você entrar mesmo sem internet.</p>
    <form onSubmit=${confirmar}>
      <${Campo} id="ga-senha" rotulo=${"Senha de " + email}><${Texto} id="ga-senha" type="password" autocomplete="current-password" valor=${senha} onMuda=${setSenha} /></${Campo}>
      ${erro ? html`<div class="erros">${erro}</div>` : null}
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Agora não</button>
        <button type="submit" class="btn btn-pri" disabled=${ocupado || !senha}>${ocupado ? "Conferindo…" : "Guardar acesso"}</button></div>
    </form>
  </${Modal}>`;
}
