// "Corrigir pela placa" na página do veículo (pedido do Danilo em 15/11/2026): puxa os dados do API Placas (consulta completa) e mostra
// o que está diferente do cadastro — marca, modelo, anos, cor, combustível, motor, chassi, Renavam e nº do motor. Só grava o que a pessoa
// deixar marcado, depois de ver a prévia. Não troca KM, proprietário, datas nem a ficha de óleo e filtros.
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Modal } from "../ui.js";
import { exPlaca, reais, soDig } from "../util.js";
import { consultarPlaca, paraFicha, anoFabMod, avisoSaldo, PRECO_PLACA } from "../placa.js";

const CAMPOS = [["marca", "Marca"], ["modelo", "Modelo"], ["ano_fab", "Ano de fabricação"], ["ano_mod", "Ano do modelo"], ["cor", "Cor"], ["combustivel", "Combustível"],
  ["motor", "Motor"], ["chassi", "Chassi"], ["renavam", "Renavam"]];
const norm = (k, x) => k === "chassi" ? String(x ?? "").replace(/\s/g, "").toUpperCase() : k === "renavam" ? soDig(x) : String(x ?? "").trim();

/** Campos em que a consulta trouxe valor e o cadastro tem outro (ou está em branco). `v` é o veículo do cadastro, `dd` os dados da consulta. */
export function diferencas(v, dd) {
  const f = paraFicha(dd), lista = [];
  for (const [k, rot] of CAMPOS) {
    const novo = norm(k, f[k]), atual = norm(k, v[k]);
    if (novo && novo !== atual) lista.push({ k, rot, atual, novo });
  }
  const mo = String(dd.motor_numero || "").trim();
  if (mo && !String(v.obs || "").toUpperCase().includes(mo.toUpperCase())) lista.push({ k: "obs", rot: "Nº do motor (vai nas observações)", atual: "", novo: mo });
  return lista;
}
/** Campos marcados → o que gravar no veículo */
export function paraGravar(v, difs, marcados) {
  const reg = {}, esc = difs.filter(d => marcados[d.k]);
  for (const d of esc) {
    if (d.k === "obs") reg.obs = [String(v.obs || "").trim(), "Nº do motor: " + d.novo].filter(Boolean).join("\n");
    else if (d.k === "ano_fab" || d.k === "ano_mod") reg[d.k] = Number(d.novo);
    else reg[d.k] = d.novo;
  }
  if (reg.ano_fab !== undefined || reg.ano_mod !== undefined) reg.ano = anoFabMod(reg.ano_fab ?? v.ano_fab, reg.ano_mod ?? v.ano_mod);
  return reg;
}

function Previa({ v, r, onFechar }) {
  const { avisar, recarregar } = useApp();
  const difs = diferencas(v, r.dados || {});
  const [marcados, setMarcados] = useState(() => Object.fromEntries(difs.map(d => [d.k, true]))), [gravando, setGravando] = useState(false), [erro, setErro] = useState("");
  const qtd = difs.filter(d => marcados[d.k]).length;
  const custo = r.origem === "api" ? "Consulta feita agora (" + reais((r.valor_centavos || 0) / 100) + ")." : r.origem === "copia" ? "Consulta que já estava guardada no sistema (sem custo)." : "Dados que o cadastro já tinha (sem custo).";
  const gravar = async () => {
    setGravando(true); setErro("");
    try { await api.veiculos.salvar({ id: v.id, ...paraGravar(v, difs, marcados) }); await recarregar(["veiculos"]); avisar("Cadastro do veículo corrigido pela placa."); onFechar(); }
    catch (e) { setErro(e.message || "Não consegui gravar."); setGravando(false); }
  };
  return html`<${Modal} titulo=${"Corrigir pela placa · " + exPlaca(v.placa)} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <p class="sub" id="cp-custo">${custo} ${avisoSaldo(r)}</p>
    ${difs.length ? html`<div class="cp-lista" id="cp-lista">${difs.map(d => html`<label key=${d.k} class="cp-linha"><input type="checkbox" checked=${!!marcados[d.k]} onChange=${e => setMarcados(m => ({ ...m, [d.k]: e.target.checked }))} />
        <span class="cp-rot">${d.rot}</span><span class="cp-de">${d.atual || "em branco"}</span><span class="cp-seta" aria-hidden="true">→</span><b class="cp-para">${d.novo}</b></label>`)}</div>
      <p class="dica">Só o que estiver marcado é gravado. KM, proprietário e a ficha de óleo e filtros não mudam.</p>`
      : html`<p id="cp-igual">O cadastro já está igual à consulta da placa. Nada para corrigir.</p>`}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>${difs.length ? "Cancelar" : "Fechar"}</button>
      ${difs.length ? html`<button type="button" class="btn btn-pri" id="cp-gravar" disabled=${gravando || !qtd} onClick=${gravar}>${gravando ? "Gravando…" : "Corrigir o cadastro (" + qtd + ")"}</button>` : null}</div>
  </${Modal}>`;
}

export function CorrigirPelaPlaca({ v }) {
  const { avisar, confirmar } = useApp();
  const [busca, setBusca] = useState(false), [r, setR] = useState(null);
  const clicar = async () => {
    if (!await confirmar({ titulo: "Corrigir pela placa", texto: "Consulta completa da placa " + exPlaca(v.placa) + " no API Placas. Se o sistema ainda não tiver essa consulta guardada, custa " + reais(PRECO_PLACA.completa) + ". Antes de gravar, você vê o que vai mudar.", botao: "Consultar" })) return;
    setBusca(true);
    try {
      let x = await consultarPlaca(v.placa, "completa", { manual: true });
      if (x.ok && x.encontrado && x.origem === "cadastro") {   // o cadastro já tem chassi e Renavam: nada novo veio; só paga de novo se ele quiser conferir
        if (!await confirmar({ titulo: "Consultar de novo?", texto: "O cadastro já tem chassi e Renavam, então a consulta respondeu do próprio cadastro. Consultar de novo no API Placas custa " + reais(PRECO_PLACA.completa) + " e serve para conferir e corrigir.", botao: "Consultar de novo" })) return;
        x = await consultarPlaca(v.placa, "completa", { manual: true, forcar: true });
      }
      if (!x.ok) return avisar(x.erro || "Falha na consulta da placa.");
      if (!x.encontrado) return avisar("A consulta não achou esta placa (não foi cobrado). Confira se a placa está certa.");
      setR(x);
    } finally { setBusca(false); }
  };
  return html`<button type="button" class="btn btn-sm" id="vei-corrigir-placa" disabled=${busca} onClick=${clicar}>${busca ? "Consultando…" : "Corrigir pela placa"}</button>
    ${r ? html`<${Previa} v=${v} r=${r} onFechar=${() => setR(null)} />` : null}`;
}
