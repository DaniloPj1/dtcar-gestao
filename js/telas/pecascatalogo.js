// "Consultar peça por catálogo" (app do celular, pedido do Danilo em 16/11/2026): digita a placa e vê as peças do catálogo
// para aquele carro, com conversão de marcas e o que tem no estoque. Placa do cadastro não custa nada; placa de fora usa a
// consulta básica (que guarda a cópia no banco da DTCar). Não grava nada: só consulta.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { useApp, Vazio } from "../ui.js";
import { normPlaca, placaValida, exPlaca } from "../util.js";
import { consultarPlaca, paraResumo } from "../placa.js";
import { PecasVeiculo } from "./pecasveiculo.js";

export function PecasCatalogo() {
  const { dados } = useApp();
  const [q, setQ] = useState(""), [modelo, setModelo] = useState(""), [ano, setAno] = useState(""), [cons, setCons] = useState(null);
  const placa = normPlaca(q), ePlaca = placaValida(placa) && q.trim().replace(/[\s-]/g, "").length === 7;
  const doCadastro = useMemo(() => ePlaca ? dados.veiculos.find(v => v.placa === placa) || null : null, [ePlaca, placa, dados.veiculos]);
  useEffect(() => {
    if (!ePlaca || doCadastro) { setCons(null); return; }
    let vivo = true; setCons({ placa, buscando: true });
    const t = setTimeout(() => consultarPlaca(placa, "basico", { manual: true }).then(x => { if (vivo) setCons({ placa, r: x }); }), 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [ePlaca, placa, doCadastro]);
  const cr = cons && cons.placa === placa ? cons.r : null;
  const daConsulta = cr && cr.ok && cr.encontrado ? paraResumo(cr.dados || {}) : null;
  const veiculo = doCadastro ? { marca: doCadastro.marca, modelo: doCadastro.modelo, ano: doCadastro.ano_mod || doCadastro.ano || "" }
    : daConsulta ? { marca: daConsulta.marca, modelo: daConsulta.modelo, ano: daConsulta.ano }
    : !ePlaca && modelo.trim().length >= 2 ? { marca: "", modelo: modelo.trim(), ano } : null;
  const estoque = useMemo(() => dados.produtos.filter(p => p.ativo !== false && p.tipo === "produto" && p.referencia && Number(p.estoque_atual) > 0)
    .map(p => ({ id: p.id, ref: p.referencia, descricao: p.descricao, qtd: Number(p.estoque_atual) })), [dados.produtos]);
  const nome = v => [v.marca, v.modelo, v.ano].filter(Boolean).join(" ");
  return html`<div class="pagina">
    <section class="card" id="pc-busca">
      <label class="of-campo"><span>Placa do carro</span>
        <input id="pc-placa" class="inp" type="search" autocomplete="off" autocapitalize="characters" placeholder="Ex.: ABC1D23" value=${q} onInput=${e => setQ(e.target.value)} /></label>
      ${ePlaca ? html`<div class="of-placa" id="pc-faixa" role="status"><b>${exPlaca(placa)}</b>${doCadastro ? html`<span>do cadastro: ${nome(veiculo)}</span>`
        : cons && cons.buscando ? html`<span>consultando a placa…</span>`
        : daConsulta ? html`<span>pela consulta da placa: ${nome(daConsulta)}${cr.origem === "api" && cr.valor_centavos ? " (consulta paga)" : ""}</span>`
        : cr && cr.ok ? html`<span>placa não encontrada na consulta. Digite o modelo abaixo.</span>`
        : cr ? html`<span>a consulta não respondeu${cr.semRede ? " (sem internet)" : ""}. Digite o modelo abaixo.</span>` : null}</div>` : null}
      ${!ePlaca || (cr && !daConsulta && !doCadastro) ? html`<div class="of-busca">
        <label class="of-campo of-campo-modelo"><span>${ePlaca ? "Modelo do carro" : "Ou o modelo do carro"}</span>
          <input id="pc-modelo" class="inp" autocomplete="off" placeholder="Ex.: onix 1.0, hilux 2.8" value=${modelo} onInput=${e => setModelo(e.target.value)} /></label>
        <label class="of-campo of-campo-ano"><span>Ano</span>
          <input id="pc-ano" class="inp" inputmode="numeric" maxlength="4" placeholder="Opcional" value=${ano} onInput=${e => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label></div>` : null}
      <p class="sub">Dado de catálogo: confira antes de aplicar.</p>
    </section>
    ${veiculo && (veiculo.modelo || veiculo.marca) ? html`<section class="card"><${PecasVeiculo} veiculo=${veiculo} estoque=${estoque} rotuloVoltar="Nova consulta" onVoltar=${() => { setQ(""); setModelo(""); setAno(""); }} /></section>`
      : html`<${Vazio}>Digite a placa (ou o modelo) para ver as peças do catálogo daquele carro.</${Vazio}>`}
  </div>`;
}
