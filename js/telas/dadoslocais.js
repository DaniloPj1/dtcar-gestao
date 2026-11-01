// Dados neste computador: pasta de dados no PC, cópia interna do navegador e fila de envio
import { html, useState, useEffect } from "../lib.js";
import { useApp, Modal } from "../ui.js";
import { fmtDataHora, lsSet } from "../util.js";
import { local } from "../local.js";
import { replicaDisponivel, infoReplica, ouvirReplica, replicar, trocarOrdemLocal } from "../replica.js";
import { fila } from "../fila.js";
import { ehAlteracao, descreverAlteracao, comTrava, replicarComFila } from "../alteracoes.js";
import { api, estaSemRede } from "../api.js";
import { pastaSuportada, escolherPasta, reconectarPasta, esquecerPasta, gravarDadosNaPasta, backupDaPasta } from "../pasta.js";

/** Janela da primeira abertura do programa instalado: cria a pasta de dados no PC */
export function AssistentePasta({ onFechar }) {
  const { avisar } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const criar = async () => {
    setOcupado(true);
    try { const h = await escolherPasta(); const c = await local.ler("dados"); if (c) await gravarDadosNaPasta(c, true); avisar("Pasta “" + h.name + "” criada. Os dados deste computador passam a ser salvos nela."); onFechar(); }
    catch (e) { if (e.name !== "AbortError") avisar("Não foi possível criar a pasta: " + e.message, true); }
    finally { setOcupado(false); }
  };
  const depois = () => { lsSet("dtcar-pasta-adiada", Date.now()); onFechar(); };
  return html`<${Modal} titulo="Pasta de dados neste computador" onFechar=${depois}>
    <p>Para trabalhar sem internet com segurança, o DTCar Gestão guarda uma cópia dos dados <b>numa pasta deste computador</b>.</p>
    <ol class="passos-pasta">
      <li>Clique em <b>Escolher local</b>. Sugerimos a pasta <b>Documentos</b>.</li>
      <li>O sistema cria dentro dela a pasta <b>DTCar Gestão</b>, com as subpastas <i>dados</i> e <i>copias</i>.</li>
      <li>Se o Windows perguntar, escolha <b>Permitir sempre</b> (ou “Permitir em todas as visitas”).</li>
    </ol>
    <p class="sub">A base principal continua no servidor. A pasta guarda a cópia mais recente, as O.S. abertas sem internet e uma cópia por dia dos últimos 30 dias.</p>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${depois}>Agora não</button>
      <button type="button" class="btn btn-pri" disabled=${ocupado} onClick=${criar}>${ocupado ? "Criando…" : "Escolher local e criar pasta"}</button></div>
  </${Modal}>`;
}

/** Tela Sistema › Dados neste computador */
export function DadosLocais() {
  const { pasta, pendentes, enviarFila, avisar, confirmar, abrirAssistentePasta, guardadas, atualizarPendentes, recarregar } = useApp();
  const abertasOff = pendentes.filter(op => op.tipo === "abrir_os"), alteracoes = pendentes.filter(ehAlteracao);
  // alterações de O.S. feitas sem internet: a primeira com problema trava as seguintes da mesma O.S.
  const travadaPor = {}; for (const op of [...alteracoes].sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1))) if (!travadaPor[op.ordem_id] && (op.conflito || op.erro)) travadaPor[op.ordem_id] = op.id;
  const forcar = async op => {
    if (!await confirmar({ titulo: "Enviar mesmo assim", texto: "A alteração feita sem internet vai por cima do que foi mudado no online nesta O.S. (" + op.erro + ")", botao: "Enviar por cima" })) return;
    await fila.forcar(op.id); await atualizarPendentes(); await enviarFila();
  };
  const descartar = async op => {
    const daOS = alteracoes.filter(x => x.ordem_id === op.ordem_id);
    if (!await confirmar({ titulo: "Descartar alterações", texto: "As " + daOS.length + " alteração(ões) feitas sem internet nesta O.S. serão descartadas e a O.S. volta a ficar igual ao online.", botao: "Descartar", perigo: true })) return;
    try {
      const o = await api.ordemDoServidor(op.ordem_id);
      // tira da fila e troca a cópia do PC pela do online de uma vez (nada lê ou grava a O.S. no meio)
      await comTrava(async () => { for (const x of daOS) await fila.remover(x.id); await trocarOrdemLocal(o); });
      await atualizarPendentes(); recarregar(["ordens"]); avisar("Alterações descartadas.");
    } catch (e) {
      // a O.S. não existe mais no online (ex.: carga do sistema antigo): só tira da fila
      if (/não existe|JSON object requested|0 rows|multiple \(or no\) rows/i.test(e.message)) { for (const x of daOS) await fila.remover(x.id); await atualizarPendentes(); return avisar("Alterações descartadas (a O.S. não existe mais no online)."); }
      avisar("Não foi possível descartar: " + e.message, true);
    }
  };
  const [copia, setCopia] = useState(null), [uso, setUso] = useState(null), [persist, setPersist] = useState(null), [bkp, setBkp] = useState(null), [gOs, setGOs] = useState(null);
  useEffect(() => {
    local.ler("dados").then(c => setCopia(c || false)); backupDaPasta().then(setBkp).catch(() => {}); local.ler("os:guardadas").then(setGOs).catch(() => {});
    if (navigator.storage) { navigator.storage.estimate && navigator.storage.estimate().then(setUso).catch(() => {}); navigator.storage.persisted && navigator.storage.persisted().then(setPersist).catch(() => {}); }
  }, [pasta && pasta.ultimaGravacao, pasta && pasta.ultimoBackup, guardadas && guardadas.feitas]);
  const prog = guardadas || gOs;
  const { cfg } = useApp();
  const [rep, setRep] = useState(null);
  useEffect(() => { if (!replicaDisponivel()) return; infoReplica().then(setRep); return ouvirReplica(e => { if (!e.rodando) infoReplica().then(setRep); else setRep(r => ({ ...(r || {}), rodando: true })); }); }, []);
  const NOMES = { ordens: "O.S.", os_itens: "Itens das O.S.", clientes: "Clientes", veiculos: "Veículos", produtos: "Produtos e serviços", recibos: "Recibos", contas: "Contas a pagar",
    receber: "Contas a receber", vendas: "Vendas", funcionarios: "Funcionários", funcionario_lanc: "Lançamentos de funcionários", eventos: "Histórico das O.S.", nfe_recebidas: "Notas da SEFAZ", estoque_mov: "Movimentos de estoque" };
  const p = pasta || {};
  const gravarAgora = async () => { const c = await local.ler("dados"); if (!c) return avisar("Ainda não há cópia para gravar. Abra o sistema com internet.", true); avisar((await gravarDadosNaPasta(c, true)) ? "Cópia gravada na pasta." : "Não foi possível gravar na pasta.", !p.ultimaGravacao); };
  const religar = async () => { avisar((await reconectarPasta()) ? "Pasta reconectada." : "Permissão não concedida.", false); };
  const desligar = async () => { if (await confirmar({ titulo: "Parar de usar a pasta", texto: "Os arquivos já gravados continuam no computador. O sistema só para de atualizá-los.", botao: "Parar" })) await esquecerPasta(); };
  const n = k => copia && copia.dados && copia.dados[k] ? copia.dados[k].length.toLocaleString("pt-BR") : "—";
  return html`<div class="pagina">
    <div class="painel-topo"><div><h1>Dados neste computador</h1><span class="sub">Cópia para trabalhar sem internet</span></div></div>
    <section class="card"><div class="secao-topo"><h2>Pasta de dados no PC</h2>
      ${p.configurada ? html`<span class=${"pill p-" + (p.permissao === "granted" ? "ok" : "warn")}>${p.permissao === "granted" ? "Gravando" : "Precisa reconectar"}</span>` : html`<span class="pill p-muted">Não configurada</span>`}</div>
      ${!pastaSuportada() ? html`<div class="aviso">Este navegador não permite gravar numa pasta do computador. Use o <b>Google Chrome</b> ou o <b>Microsoft Edge</b> no Windows.</div>`
      : !p.configurada ? html`<p>Crie a pasta <b>DTCar Gestão</b> (sugestão: dentro de Documentos) para o sistema guardar uma cópia dos dados em arquivos neste computador.</p>
        <div class="acoes"><button type="button" class="btn btn-pri" onClick=${abrirAssistentePasta}>Criar pasta de dados</button></div>`
      : html`<div class="kv"><div><span>Pasta</span><b>${p.nome}</b></div><div><span>Última gravação</span><b>${p.ultimaGravacao ? fmtDataHora(p.ultimaGravacao) : "ainda não gravou"}</b></div>
          <div><span>Backup completo</span><b>${bkp ? fmtDataHora(bkp.em) + " (" + (bkp.tamanho / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB)" : "ainda não feito (é feito 1 vez por dia, com internet)"}</b></div>
          <div><span>Conteúdo</span><b>dados\\dtcar-dados.json · dados\\fila-envio.json · copias\\ (30 dias) · backup\\ (completo, 14 dias)</b></div></div>
        <p class="sub">O backup completo tem todas as tabelas (O.S. com itens, recibos, vendas, contas, funcionários, notas). Se o online falhar, ele é restaurado pela tela Sistema › Backup.</p>
        ${p.permissao !== "granted" ? html`<div class="aviso">O navegador pediu para confirmar o acesso à pasta depois de reiniciar. Clique em <b>Reconectar</b> e escolha <b>Permitir sempre</b>.</div>` : null}
        ${p.erro ? html`<div class="erros">Último erro ao gravar: ${p.erro}</div>` : null}
        <div class="acoes">${p.permissao !== "granted" ? html`<button type="button" class="btn btn-pri" onClick=${religar}>Reconectar</button>` : html`<button type="button" class="btn" onClick=${gravarAgora}>Gravar agora</button>`}
          <button type="button" class="btn" onClick=${abrirAssistentePasta}>Trocar pasta</button><button type="button" class="btn btn-link" onClick=${desligar}>Parar de usar</button></div>`}
    </section>
    ${replicaDisponivel() ? html`<section class="card"><div class="secao-topo"><h2>Banco de dados no PC</h2>
        ${rep && rep.rodando ? html`<span class="pill p-info">Atualizando…</span>` : rep && rep.erro ? html`<span class="pill p-warn">Última atualização falhou</span>` : rep && rep.registros ? html`<span class="pill p-ok">Em dia</span>` : html`<span class="pill p-muted">Vazio</span>`}</div>
      <p class="sub">Réplica de todas as tabelas do online. Sem internet, as telas leem daqui. Uma cópia do banco inteiro vai por dia para Documentos\DTCar Gestão\banco (14 dias).</p>
      ${rep ? html`<div class="kv"><div><span>Atualizado em</span><b>${rep.ultima ? fmtDataHora(rep.ultima) : "ainda não"}</b></div><div><span>Registros</span><b>${(rep.registros || 0).toLocaleString("pt-BR")}</b></div>
          <div><span>Tamanho</span><b>${((rep.tamanho || 0) / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</b></div>
          ${Object.entries(NOMES).filter(([t]) => rep.tabelas && rep.tabelas[t] != null).map(([t, n]) => html`<div key=${t}><span>${n}</span><b>${rep.tabelas[t].toLocaleString("pt-BR")}</b></div>`)}</div>
        ${rep.erro ? html`<div class="erros">${rep.erro}</div>` : null}
        ${rep.v13 === false ? html`<div class="aviso">Para o banco do PC buscar só o que mudou (mais rápido), rode o <b>supabase/v13.sql</b> no Supabase. Até lá, as tabelas sem data de alteração são recarregadas inteiras a cada 30 minutos.</div>` : null}` : html`<span class="sub">Lendo…</span>`}
      <div class="acoes"><button type="button" class="btn" disabled=${(rep && rep.rodando) || estaSemRede()} onClick=${() => replicarComFila(() => replicar(api, { completo: true, espelho: cfg.espelhoLegado !== false && cfg.ultimoEspelho ? cfg.ultimoEspelho.em : null, config: cfg }))}>Recarregar tudo agora</button></div>
    </section>` : null}
    <section class="card"><h2>Cópia interna do navegador</h2>
      ${copia === null ? html`<span class="sub">Lendo…</span>` : !copia ? html`<div class="aviso">Ainda não há cópia neste computador. Abra o sistema com internet e aguarde alguns segundos.</div>`
      : html`<div class="kv"><div><span>Atualizada em</span><b>${fmtDataHora(copia.salvoEm)}</b></div><div><span>O.S.</span><b>${n("ordens")}</b></div><div><span>Clientes</span><b>${n("clientes")}</b></div>
          <div><span>Veículos</span><b>${n("veiculos")}</b></div><div><span>Produtos e serviços</span><b>${n("produtos")}</b></div>
          ${uso && uso.usage ? html`<div><span>Espaço usado</span><b>${(uso.usage / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB</b></div>` : null}
          <div><span>O.S. em aberto guardadas por inteiro</span><b>${prog ? prog.feitas + " de " + prog.total + (prog.falhas ? " · " + prog.falhas + " com falha (tenta de novo ao abrir com internet)" : prog.feitas < prog.total ? " (copiando…)" : "") : "—"}</b></div>
          <div><span>Protegida contra limpeza</span><b>${window.dtcarDesktop ? "sim (programa para Windows)" : persist ? "sim" : "não (instale o programa para proteger)"}</b></div></div>`}
    </section>
    <section class="card"><div class="secao-topo"><h2>Alterações de O.S. feitas sem internet</h2>${alteracoes.length ? html`<button type="button" class="btn btn-sm btn-pri" onClick=${enviarFila}>Enviar agora</button>` : null}</div>
      <p class="sub">Vão para o online na ordem em que foram feitas. Se alguém mudou a mesma O.S. no online nesse meio tempo, é conflito: escolha enviar por cima ou descartar o que foi feito aqui.</p>
      ${alteracoes.length ? html`<ul class="res-lista">${alteracoes.map(op => html`<li key=${op.id}>${descreverAlteracao(op)} · ${fmtDataHora(op.criado_em)}
          ${op.conflito || op.erro ? html` · <span class="c-bad">${op.erro}</span>
            <span class="acoes-inline">${op.conflito ? html`<button type="button" class="btn btn-sm" onClick=${() => forcar(op)}>Enviar por cima</button>`
              : html`<button type="button" class="btn btn-sm" onClick=${async () => { await fila.tentarDeNovo(op.id); await atualizarPendentes(); enviarFila(); }}>Tentar de novo</button>`}<button type="button" class="btn btn-sm" onClick=${() => descartar(op)}>Descartar desta O.S.</button></span>`
          : travadaPor[op.ordem_id] && travadaPor[op.ordem_id] !== op.id ? html` · <span class="sub">aguardando a alteração anterior desta O.S.</span>` : html` · <span class="sub">aguardando envio</span>`}</li>`)}</ul>`
        : html`<span class="sub">Nenhuma alteração aguardando envio.</span>`}
    </section>
    <section class="card"><div class="secao-topo"><h2>O.S. abertas sem internet</h2>${abertasOff.length ? html`<button type="button" class="btn btn-sm btn-pri" onClick=${enviarFila}>Enviar agora</button>` : null}</div>
      ${abertasOff.length ? html`<ul class="res-lista">${abertasOff.map(op => html`<li key=${op.id}><b>${op.provisorio}</b> · ${op.ordem.veiculo.placa} · ${op.ordem.cliente.nome} · aberta em ${fmtDataHora(op.criado_em)}${op.erro ? html` · <span class="c-bad">${op.erro}</span>` : null}</li>`)}</ul>`
        : html`<span class="sub">Nenhuma O.S. aguardando envio. Tudo está no servidor.</span>`}
    </section>
  </div>`;
}
