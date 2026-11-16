// Tela "App do mecânico › Itens da lista" (administrador): escolhe o que o mecânico vê para marcar no app, por sistema.
// Pedido do Danilo em 15/11/2026. Tudo fica em cfg.appMecanico (tabela config); o padrão e a mescla estão em js/appmecanico.js,
// o mesmo arquivo que o app do mecânico (/mecanico/) lê. Cada ação grava na hora.
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Seg, Modal } from "../ui.js";
import { SISTEMAS_PADRAO, ICONES, ICONE_D, TIPOS, pecasDoSistema, novoId } from "../appmecanico.js";

const Icone = ({ nome, tam = 28 }) => html`<svg aria-hidden="true" width=${tam} height=${tam} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d=${ICONE_D[nome] || ICONE_D.chave}></path></svg>`;
const ARQUIVO_APP = "app/download/DTCar-app.apk", VERSAO_APP = "1.3.0"; // troque junto com o arquivo quando sair uma versão nova
const POS = [["Nenhuma", "none"], ["Diant. | Tras. | Os 2", "chips"], ["Minhas opções", "opcoes"]];
const lista = t => String(t || "").split(/[,;]/).map(x => x.trim()).filter(Boolean);
const descPos = p => p.pm === "chips" ? "Diant. | Tras. | Os 2" : p.pm === "chips2" ? "Dianteira | Traseira | As 2" : Array.isArray(p.pm) ? p.pm.join(" | ") + " (pode marcar mais de uma)" : "";

export function AppMecanico() {
  const { cfg, avisar, recarregar } = useApp();
  const [sid, setSid] = useState(SISTEMAS_PADRAO[0].id), [ed, setEd] = useState(null), [salvando, setSalvando] = useState(false);
  const sis = SISTEMAS_PADRAO.find(s => s.id === sid);
  const pecas = pecasDoSistema(cfg, sis, true);
  const gravar = async (mut, msg) => {
    const am = JSON.parse(JSON.stringify(cfg.appMecanico || {})); am.sistemas = am.sistemas || {}; am.sistemas[sid] = am.sistemas[sid] || {};
    const a = am.sistemas[sid]; a.ocultos = a.ocultos || []; a.renomes = a.renomes || {}; a.opcoes = a.opcoes || {}; a.novos = a.novos || [];
    mut(a); setSalvando(true);
    try { await api.salvarConfig({ ...cfg, appMecanico: am }); await recarregar(["config"]); avisar(msg || "Salvo. O app do mecânico mostra na próxima vez que abrir."); return true; }
    catch (e) { avisar(e.message, true); return false; } finally { setSalvando(false); }
  };
  const chaveOculto = p => p.padrao ? p.orig : p.id;
  const alternar = p => gravar(a => { const k = chaveOculto(p); a.ocultos = p.oculto ? a.ocultos.filter(x => x !== k) : a.ocultos.concat([k]); }, p.oculto ? "Item de volta no app." : "Item escondido do app.");
  const remover = p => { if (!window.confirm("Remover \"" + p.nome + "\" da lista do app?")) return; gravar(a => { const id = p.id.slice(2); a.novos = a.novos.filter(n => n.id !== id); a.ocultos = a.ocultos.filter(x => x !== p.id); }, "Item removido."); };
  const abrirEd = p => setEd(p ? { id: p.id, padrao: p.padrao, orig: p.orig, nome: p.nome, tipo: p.tipo, icone: p.icone, pos: p.pm === "chips" || p.pm === "chips2" ? "chips" : Array.isArray(p.pm) ? "opcoes" : "none",
    opcoes: Array.isArray(p.pm) ? p.pm.join(", ") : "", fixo: p.pm === "chips2" } : { id: null, padrao: false, nome: "", tipo: "par", icone: "chave", pos: "none", opcoes: "" });
  const salvarEd = async () => {
    const nome = ed.nome.trim(); if (!nome) return avisar("Escreva o nome do item.", true);
    if (pecas.some(p => p.id !== ed.id && p.nome.toLowerCase() === nome.toLowerCase())) return avisar("Já existe um item com esse nome neste sistema.", true);
    const ops = lista(ed.opcoes); if (ed.pos === "opcoes" && !ops.length) return avisar("Escreva as opções, separadas por vírgula.", true);
    const ok = await gravar(a => {
      if (ed.padrao) {
        if (nome !== ed.orig) a.renomes[ed.orig] = nome; else delete a.renomes[ed.orig];
        if (!ed.fixo && ed.pos === "opcoes") a.opcoes[ed.orig] = ops; else delete a.opcoes[ed.orig];
      } else {
        const n = { id: ed.id ? ed.id.slice(2) : novoId(), nome, icone: ed.icone, tipo: ed.tipo, pos: ed.pos === "chips" ? "chips" : ed.pos === "opcoes" ? "opcoes" : "none", opcoes: ed.pos === "opcoes" ? ops : [] };
        const i = a.novos.findIndex(x => x.id === n.id); if (i >= 0) a.novos[i] = n; else a.novos.push(n);
      }
    }, ed.id ? "Item salvo." : "Item acrescentado.");
    if (ok) setEd(null);
  };
  const set = p => setEd(e => ({ ...e, ...p }));
  return html`<div class="pagina">
    <section class="card" id="baixar-app"><h2>App do sistema para celular</h2>
      <span class="dica">App DTCar para o administrador e o consultor (Android). Versão ${VERSAO_APP}. Entra com o mesmo e-mail e a mesma senha do sistema; depois do primeiro login pode entrar com a digital.</span>
      <div class="acoes"><a class="btn btn-pri" href=${ARQUIVO_APP} download="DTCar-app.apk">Baixar o app (APK)</a></div>
      <span class="dica">Para instalar: abra o arquivo no celular e, se o Android pedir, permita "instalar apps desconhecidos" para o navegador. Desinstale a versão anterior antes de instalar esta (a 1.3.0 traz o botão Voltar do celular). As telas novas chegam sozinhas, sem instalar de novo.</span>
    </section>
    <section class="card"><h2>App do mecânico · itens da lista</h2>
      <span class="dica">É o que o mecânico vê para marcar ao receber um veículo, separado por sistema. Cada mudança vale na hora; o app pega na próxima vez que for aberto.</span>
      <div class="seg" role="group" aria-label="Sistema">${SISTEMAS_PADRAO.map(s => html`<button type="button" key=${s.id} aria-pressed=${s.id === sid ? "true" : "false"} onClick=${() => setSid(s.id)}>${s.nome}</button>`)}</div>
      <div class="am-lista">${pecas.map(p => html`<div key=${p.id} class=${"am-linha" + (p.oculto ? " am-off" : "")}>
        <span class="am-ic"><${Icone} nome=${p.icone} /></span>
        <span class="am-meio"><strong>${p.nome}</strong><span class="sub">${TIPOS[p.tipo]}${descPos(p) ? " · " + descPos(p) : ""}${p.padrao ? "" : " · acrescentado por você"}${p.oculto ? " · escondido" : ""}</span></span>
        <span class="am-acoes"><button type="button" class="btn btn-sm" disabled=${salvando} onClick=${() => abrirEd(p)}>Editar</button>
          <button type="button" class="btn btn-sm" disabled=${salvando} onClick=${() => alternar(p)}>${p.oculto ? "Mostrar" : "Esconder"}</button>
          ${p.padrao ? null : html`<button type="button" class="btn btn-sm" disabled=${salvando} onClick=${() => remover(p)}>Remover</button>`}</span>
      </div>`)}</div>
      <div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => abrirEd(null)}>+ Acrescentar item em ${sis.nome}</button></div>
    </section>
    ${ed ? html`<${Modal} titulo=${ed.id ? "Editar item" : "Novo item · " + sis.nome} onFechar=${() => setEd(null)}>
      <${Campo} id="am-nome" rotulo="Nome do item"><${Texto} id="am-nome" valor=${ed.nome} onMuda=${v => set({ nome: v })} /></${Campo}>
      ${ed.padrao ? null : html`<${Campo} rotulo="Como o mecânico marca"><${Seg} rotulo="Como marca" opcoes=${Object.entries(TIPOS).map(([k, t]) => [t, k])} valor=${TIPOS[ed.tipo]} onEscolha=${(t, k) => set({ tipo: k })} /></${Campo}>
        <div class="campo"><label>Ícone</label><div class="am-grade">${ICONES.map(i => html`<button type="button" key=${i[0]} title=${i[1]} aria-label=${i[1]} aria-pressed=${ed.icone === i[0] ? "true" : "false"} onClick=${() => set({ icone: i[0] })}><${Icone} nome=${i[0]} /></button>`)}</div></div>`}
      ${ed.fixo ? html`<span class="dica">A posição deste item (Dianteira | Traseira | As 2) é fixa.</span>` : html`<${Campo} rotulo="Posição / opções para o mecânico marcar">
        ${ed.padrao ? null : html`<${Seg} rotulo="Posição" opcoes=${POS} valor=${(POS.find(x => x[1] === ed.pos) || POS[0])[0]} onEscolha=${(t, k) => set({ pos: k })} />`}
        ${ed.padrao || ed.pos === "opcoes" ? html`<${Texto} id="am-ops" valor=${ed.opcoes} placeholder="Ex.: Interna, Externa" onMuda=${v => set({ opcoes: v, pos: "opcoes" })} /><span class="dica">Separe por vírgula. O mecânico pode marcar mais de uma (ex.: interna e externa). Em branco, volta ao padrão.</span>` : null}</${Campo}>`}
      <div class="acoes"><button type="button" class="btn" onClick=${() => setEd(null)}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvarEd}>${salvando ? "Salvando…" : "Salvar"}</button></div>
    </${Modal}>` : null}
  </div>`;
}
