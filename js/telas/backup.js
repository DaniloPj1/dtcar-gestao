// Backup: cópia completa dos dados em um arquivo e restauração do que estiver faltando
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Vazio } from "../ui.js";
import { fmtDataHora } from "../util.js";

// ordem de restauração: quem é referenciado vem antes
const TABELAS = [["fornecedores", "Fornecedores"], ["clientes", "Clientes"], ["veiculos", "Veículos"], ["servicos", "Serviços (cadastro antigo)"], ["produtos", "Produtos e serviços"],
  ["produto_fornecedor", "Códigos dos fornecedores"], ["notas_entrada", "Notas de entrada"], ["ordens", "Ordens de serviço"], ["os_itens", "Itens das O.S."], ["eventos", "Histórico das O.S."],
  ["fotos", "Fotos (referências)"], ["recibos", "Recibos"], ["vendas", "Vendas de balcão"], ["venda_itens", "Itens das vendas"], ["estoque_mov", "Movimentos de estoque"],
  ["estoque_reserva", "Estoque reservado em O.S."], ["contas", "Contas a pagar"], ["nfe_recebidas", "Notas da SEFAZ"], ["nfe_os_vinculos", "Notas vinculadas às O.S."]];
const NOME = Object.fromEntries(TABELAS);
const chaveDe = t => t === "estoque_reserva" ? "item_id" : "id";
const kb = n => n > 1048576 ? (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

async function compactar(texto) {
  if (!("CompressionStream" in window)) return { blob: new Blob([texto], { type: "application/json" }), ext: "json" };
  const s = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  return { blob: await new Response(s).blob(), ext: "json.gz" };
}
async function lerArquivo(arq) {
  const buf = new Uint8Array(await arq.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (!("DecompressionStream" in window)) throw new Error("Este navegador não abre arquivos .gz. Use o Chrome ou o Edge atualizados.");
    return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

export function Backup() {
  const { cfg, perfil, avisar, recarregar, confirmar } = useApp();
  const [prog, setProg] = useState(null), [erro, setErro] = useState("");
  const [rest, setRest] = useState(null); // { arquivo, dados, faltam: {t: [linhas]}, feito }
  const ult = cfg.ultimoBackup;
  const diasUlt = ult ? Math.floor((Date.now() - new Date(ult.em)) / 86400000) : null;

  const baixar = async () => {
    setErro(""); const p = { feito: [], atual: "" }; setProg({ ...p });
    try {
      const out = { sistema: "dtcar-gestao", versao: 5, gerado_em: new Date().toISOString(), gerado_por: perfil.nome, tabelas: {} };
      out.config = await api.config(); out.perfis = await api.perfis();
      for (const [t, nome] of TABELAS) {
        p.atual = nome; setProg({ ...p });
        try { out.tabelas[t] = await api.backup.tabela(t); } catch (e) { if (t === "servicos") { out.tabelas[t] = []; continue; } throw new Error(nome + ": " + e.message); }
        p.feito.push([nome, out.tabelas[t].length]); setProg({ ...p });
      }
      const total = Object.values(out.tabelas).reduce((s, l) => s + l.length, 0);
      const { blob, ext } = await compactar(JSON.stringify(out));
      const d = new Date(), nomeArq = `dtcar-backup-${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.${ext}`;
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nomeArq; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      await api.salvarConfig({ ...cfg, ultimoBackup: { em: out.gerado_em, por: perfil.nome, registros: total, tamanho: blob.size, arquivo: nomeArq } }).catch(() => {});
      await recarregar(["config"]);
      setProg({ ...p, atual: "", fim: { nomeArq, total, tamanho: blob.size } }); avisar("Backup gerado: " + nomeArq);
    } catch (e) { setErro("Não foi possível gerar o backup: " + e.message); setProg(null); }
  };

  const abrir = async arq => {
    setErro(""); setRest(null);
    try {
      const b = await lerArquivo(arq);
      if (!b || b.sistema !== "dtcar-gestao" || !b.tabelas) throw new Error("Este arquivo não é um backup do DTCar Gestão.");
      const faltam = {};
      for (const [t] of TABELAS) {
        const linhas = b.tabelas[t] || []; if (!linhas.length) continue;
        if (t === "estoque_reserva") { faltam[t] = linhas; continue; }
        let ids; try { ids = new Set((await api.idsDe(t)).map(String)); } catch (e) { ids = new Set(); }
        const f = linhas.filter(l => !ids.has(String(l[chaveDe(t)])));
        if (f.length) faltam[t] = f;
      }
      setRest({ arquivo: arq.name, b, faltam });
    } catch (e) { setErro(e.message); }
  };
  const restaurar = async () => {
    const n = Object.entries(rest.faltam).filter(([t]) => t !== "estoque_reserva").reduce((s, [, l]) => s + l.length, 0);
    if (!await confirmar({ titulo: "Restaurar backup", texto: `Serão incluídos ${n} registro(s) que não existem mais no sistema. Nada do que existe hoje será alterado.`, botao: "Restaurar" })) return;
    const res = {}; setRest(r => ({ ...r, rodando: true, res }));
    try {
      for (const [t] of TABELAS) {
        const l = rest.faltam[t]; if (!l) continue; res[t] = { incluidos: 0, erros: 0 };
        for (let i = 0; i < l.length; i += 300) { const r = await api.backup.restaurar(t, l.slice(i, i + 300)); res[t].incluidos += r.incluidos; res[t].erros += r.erros; setRest(x => ({ ...x, res: { ...res } })); }
      }
      await recarregar(null, { completo: true }); avisar("Restauração concluída.");
      setRest(x => ({ ...x, rodando: false, feito: true, res: { ...res } }));
    } catch (e) { setErro("A restauração parou: " + e.message); setRest(x => ({ ...x, rodando: false })); }
  };
  const nFaltam = rest ? Object.entries(rest.faltam).filter(([t]) => t !== "estoque_reserva").reduce((s, [, l]) => s + l.length, 0) : 0;

  return html`<div class="pagina larga-media backup">
    <div class="painel-topo"><div><h1>Backup</h1><span class="sub">${ult ? `Último backup em ${fmtDataHora(ult.em)} por ${ult.por}${diasUlt ? ", há " + diasUlt + " dia(s)" : ", hoje"}` : "Nenhum backup feito por aqui ainda"}</span></div></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <section class=${"card" + (diasUlt === null || diasUlt > 7 ? " card-alerta" : "")}>
      <h3>Fazer backup agora</h3>
      <p>Baixa um arquivo com todos os cadastros, O.S., itens, recibos, vendas, estoque e contas a pagar. Guarde em mais de um lugar (pen drive, Google Drive, e-mail). Recomendado: uma vez por semana.</p>
      <div class="acoes"><button type="button" class="btn btn-pri" disabled=${prog && !prog.fim} onClick=${baixar}>${prog && !prog.fim ? "Gerando…" : "Baixar backup"}</button></div>
      ${prog ? html`<ul class="ranking progresso">${prog.feito.map(([n, q]) => html`<li key=${n}><span>${n}</span><b>${q.toLocaleString("pt-BR")}</b></li>`)}${prog.atual ? html`<li><span>${prog.atual}</span><b>…</b></li>` : null}</ul>
        ${prog.fim ? html`<div class="aviso ok">Arquivo <b>${prog.fim.nomeArq}</b> salvo na pasta de downloads: ${prog.fim.total.toLocaleString("pt-BR")} registros, ${kb(prog.fim.tamanho)}.</div>` : null}` : null}
      <span class="dica">As fotos e assinaturas continuam guardadas no Supabase; o arquivo leva só a referência delas. O arquivo tem dados de clientes: guarde em local protegido (LGPD).</span>
    </section>
    <section class="card">
      <h3>Restaurar de um backup</h3>
      <p>Use se algum registro foi apagado por engano. O sistema compara o arquivo com o que existe hoje e inclui só o que estiver faltando. Nada que já existe é alterado ou apagado.</p>
      <div class="acoes"><label class="btn" for="bk-arq">Escolher arquivo de backup</label><input id="bk-arq" class="vh" type="file" accept=".gz,.json,application/json,application/gzip" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) abrir(a); }} /></div>
      ${rest ? html`<div class="info">Arquivo ${rest.arquivo}: gerado em ${fmtDataHora(rest.b.gerado_em)}${rest.b.gerado_por ? " por " + rest.b.gerado_por : ""}.</div>
        ${nFaltam ? html`<ul class="ranking">${Object.entries(rest.faltam).filter(([t]) => t !== "estoque_reserva").map(([t, l]) => html`<li key=${t}><span>${NOME[t]}</span><b>${l.length.toLocaleString("pt-BR")} faltando</b>${rest.res && rest.res[t] ? html`<small class=${rest.res[t].erros ? "c-bad" : "c-ok"}>${rest.res[t].incluidos} incluído(s)${rest.res[t].erros ? ", " + rest.res[t].erros + " com erro" : ""}</small>` : null}</li>`)}</ul>
          ${rest.feito ? html`<div class="aviso ok">Restauração concluída.</div>` : html`<div class="acoes"><button type="button" class="btn btn-pri" disabled=${rest.rodando} onClick=${restaurar}>${rest.rodando ? "Restaurando…" : "Restaurar " + nFaltam.toLocaleString("pt-BR") + " registro(s)"}</button></div>`}`
          : html`<${Vazio}>Nada a restaurar: tudo o que está no arquivo já existe no sistema.</${Vazio}>`}` : null}
    </section>
  </div>`;
}
