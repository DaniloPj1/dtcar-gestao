// "Histórico de serviços" (app do celular, pedido do Danilo em 16/11/2026): por placa, cliente, modelo ou número da O.S.,
// lista as O.S. do veículo/cliente, da mais nova para a mais antiga, com data, KM e o que foi pedido. Toque abre a O.S. Só leitura.
import { html, useState, useMemo } from "../lib.js";
import { useApp, Vazio, Status } from "../ui.js";
import { norm, soDig, normPlaca, fmtData, numOS, reais } from "../util.js";
import { pode } from "../regras.js";

export function Historico() {
  const { dados, perfil, ir } = useApp();
  const [q, setQ] = useState("");
  const ver = pode(perfil, "verValores");
  const lista = useMemo(() => {
    const n = norm(q), p = normPlaca(q), d = soDig(q);
    if (n.length < 2 && !d) return [];
    return dados.ordens.filter(o => !o._pendente && (norm(o.cliente.nome).includes(n) || (p.length >= 3 && (o.veiculo.placa || "").includes(p)) || norm(o.veiculo.modelo).includes(n) || (d && String(o.numero) === String(+d))))
      .sort((a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")).slice(0, 80);
  }, [q, dados.ordens]);
  return html`<div class="pagina">
    <section class="card"><label class="of-campo"><span>Placa, cliente, modelo ou nº da O.S.</span>
      <input id="hs-q" class="inp" type="search" autocomplete="off" placeholder="Ex.: ABC1D23 ou nome do cliente" value=${q} onInput=${e => setQ(e.target.value)} /></label></section>
    ${!lista.length ? html`<${Vazio}>${norm(q).length < 2 && !soDig(q) ? "Digite a placa ou o nome para ver o histórico de serviços." : "Nenhuma O.S. encontrada."}</${Vazio}>` : html`<div class="lista">${lista.map(o => html`
      <button type="button" key=${o.id} class="linha hs-linha" onClick=${() => ir("/os/" + o.id)}>
        <span class="meio"><strong>${numOS(o.numero)} · ${fmtData((o.criado_em || "").slice(0, 10))}</strong>
          <span>${[o.veiculo.placa, o.veiculo.modelo].filter(Boolean).join(" · ")}${o.cliente.nome ? " · " + o.cliente.nome : ""}</span>
          <span>${o.km_entrada ? o.km_entrada + " km · " : ""}${o.reclamacao ? String(o.reclamacao).slice(0, 90) : "sem descrição"}</span></span>
        <span class="hs-dir"><${Status} s=${o.status} o=${o} />${ver ? html`<b>${reais(o.total)}</b>` : null}</span>
      </button>`)}</div>`}
  </div>`;
}
