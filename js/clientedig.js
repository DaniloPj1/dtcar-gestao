// Cliente só digitado (sem cadastro) no orçamento e na agenda (pedido do Danilo em 15/11/2026: os cadastros começam pelo que as
// consultas preenchem — CPF, depois nome e telefone, e o endereço pelo CEP).
// O que é digitado fica na cópia do cliente do orçamento/agendamento (coluna "cliente", que já existia: sem SQL) e segue para o
// cadastro quando o cliente é cadastrado: na Nova O.S. aberta pela agenda e na aprovação do orçamento (completarClienteNovo).
import { html, useRef } from "./lib.js";
import { useApp, Campo, Texto } from "./ui.js";
import { soDig, docValido, fmtDoc, fmtTel } from "./util.js";
import { useCPF, CpfBusca, ehAdmin } from "./cpf.js";
import { useCNPJ, CnpjAviso, soEmBranco, tirarPostos } from "./cnpj.js";
import { CampoCep, fmtCep } from "./cep.js";
import { MAIUSC } from "./maiusculas.js";

const tx = v => String(v ?? "").trim();
/** O que o cadastro do cliente recebe além de nome e telefone (só o que foi preenchido) */
export function dadosParaCadastro(c = {}) {
  const doc = docValido(c.doc) ? soDig(c.doc) : "", cep = soDig(c.cep).length === 8 ? fmtCep(c.cep) : "", rua = tx(c.rua), bairro = tx(c.bairro);
  const cidade = (cep && tx(c.cidade)) || "", uf = (cep && tx(c.uf).toUpperCase().slice(0, 2)) || "";
  const o = {};
  if (doc) o.doc = doc;
  if (doc.length === 11 && /^\d{4}-\d{2}-\d{2}$/.test(tx(c.nascimento))) o.nascimento = tx(c.nascimento);
  if (cep) o.cep = cep; if (rua) o.rua = rua; if (bairro) o.bairro = bairro; if (cidade) o.cidade = cidade; if (uf) o.uf = uf;
  if (tx(c.email)) o.email = tx(c.email).toLowerCase();
  if (rua || bairro || cep) o.endereco = [rua, bairro, (cidade || "Colatina") + "/" + (uf || "ES")].filter(Boolean).join(", ");
  return o;
}
/** Aviso para a tela antes de gravar: CPF/CNPJ digitado pela metade ou com dígito errado não some em silêncio ("" = pode gravar) */
export const erroClienteDig = (c = {}) => tx(c.doc) && !docValido(c.doc) ? "CPF/CNPJ do cliente incompleto ou inválido. Confira os números ou deixe em branco." : "";
/** A cópia do cliente digitado que vai para o orçamento / agendamento: nome em maiúsculas, telefone e o que mais foi preenchido */
export const copiaClienteDig = (c = {}) => ({ nome: MAIUSC(c.nome), telefone: c.telefone || "", ...dadosParaCadastro(c) });

/**
 * Orçamento aprovado com cliente só digitado: o banco cadastra o cliente com nome e telefone (v53); aqui o cadastro novo recebe
 * o CPF/CNPJ, o nascimento e o endereço que estavam no orçamento. Nunca lança erro: devolve "" ou o que faltou, para a tela juntar
 * ao aviso de que a O.S. foi aberta (um aviso só: o segundo apagaria o primeiro).
 */
export async function completarClienteNovo(api, ordemId, c) {
  const extras = dadosParaCadastro(c);
  if (!ordemId || !Object.keys(extras).length) return "";
  const FALHOU = "o CPF e o endereço do orçamento não foram para o cadastro do cliente: complete na ficha dele.";
  let id = "";
  try { const r = await api.ordem(ordemId), os = (r && (r.ordem || r)) || {}; id = os.cliente_id || ""; } catch (e) { /* cai no aviso */ }
  if (!id) return FALHOU;
  try { await api.clientes.salvar({ id, ...extras }); return ""; }
  catch (e) {
    if (!extras.doc) return FALHOU;
    // o CPF/CNPJ já é de outro cliente do cadastro (ou foi recusado): o endereço vai mesmo assim, sem o documento e sem o nascimento dele
    const { doc, nascimento, ...resto } = extras;
    try { if (Object.keys(resto).length) await api.clientes.salvar({ id, ...resto }); } catch (e2) { return FALHOU; }
    return "o CPF/CNPJ do orçamento não foi para o cadastro do cliente (já é de outro cliente ou foi recusado): confira a ficha dele.";
  }
}

/**
 * Campos do cliente digitado. p: prefixo dos ids ("orc" ou "ag"); c: a cópia do cliente; onMuda(novoCliente); disabled: só leitura.
 * Ordem: CPF/CNPJ, nome, telefone, CEP, endereço, bairro. O CPF busca o nome (só administrador), o CNPJ busca a empresa e o CEP o endereço.
 */
export function ClienteDigitado({ p, c, onMuda, disabled }) {
  const { dados, cfg, perfil } = useApp();
  const atual = useRef(c); atual.current = c;
  const muda = m => onMuda({ ...atual.current, ...m });
  const doCPF = useRef(null), doCNPJ = useRef(null);
  // nascimento e e-mail vêm da consulta do documento e não têm campo nesta tela: trocados os números do CPF/CNPJ (mesmo num orçamento
  // reaberto), eles saem — o nascimento de um CPF nunca fica no cadastro de outro
  const trocaDoc = v => muda({ doc: v, ...(soDig(v) !== soDig(atual.current.doc) ? { nascimento: "", email: "" } : {}) });
  const d = soDig(c.doc), noCadastro = d.length >= 11 ? (dados.clientes || []).find(x => soDig(x.doc) && soDig(x.doc) === d) : null;
  const falta = !disabled && !noCadastro && !tx(c.nome);
  const autoCPF = useCPF(c.doc, { pode: ehAdmin(perfil) && !disabled, auto: cfg.cpfAuto !== false, falta,
    onDados: dd => { const postos = soEmBranco(atual.current, { nome: MAIUSC(dd.nome), nascimento: dd.nascimento }); doCPF.current = postos; if (Object.keys(postos).length) muda(postos); },
    onTrocou: () => { const t = tirarPostos(atual.current, doCPF.current); doCPF.current = null; if (Object.keys(t).length) muda(t); } });
  const autoCNPJ = useCNPJ(c.doc, { falta,
    onDados: e => { const postos = soEmBranco(atual.current, { nome: e.razao, telefone: e.telefone ? fmtTel(e.telefone) : "", email: e.email, cep: e.cep, rua: e.rua, bairro: e.bairro, cidade: e.cidade, uf: e.uf }, doCNPJ.current || {});
      doCNPJ.current = postos; if (Object.keys(postos).length) muda(postos); },
    onTrocou: () => { const t = tirarPostos(atual.current, doCNPJ.current); doCNPJ.current = null; if (Object.keys(t).length) muda(t); } });
  const temMais = tx(c.doc) || tx(c.cep) || tx(c.rua) || tx(c.bairro);
  return html`<div class="grade cli-dig">
    ${!disabled || tx(c.doc) ? html`<${Campo} id=${p + "-doc"} rotulo="CPF ou CNPJ" erro=${c.doc && d.length >= 11 && !docValido(c.doc) ? "Número inválido" : ""}
        dica=${noCadastro && !disabled ? "Já é do cadastro: " + noCadastro.nome + ". Escolha “Do cadastro”." : ""}>
      <input id=${p + "-doc"} class="inp" inputmode="numeric" disabled=${disabled} value=${disabled ? fmtDoc(c.doc) : c.doc || ""} onBlur=${e => trocaDoc(fmtDoc(e.target.value))} onInput=${e => trocaDoc(e.target.value)} />
      <${CpfBusca} c=${autoCPF} /><${CnpjAviso} c=${autoCNPJ} /></${Campo}>` : null}
    <${Campo} id=${p + "-nome"} rotulo="Nome do cliente" obrig><${Texto} id=${p + "-nome"} class="inp maiusc" valor=${c.nome} disabled=${disabled} onMuda=${v => muda({ nome: v })} /></${Campo}>
    <${Campo} id=${p + "-tel"} rotulo="Telefone (WhatsApp)"><${Texto} id=${p + "-tel"} inputmode="tel" valor=${disabled ? fmtTel(c.telefone) : c.telefone} disabled=${disabled} onMuda=${v => muda({ telefone: v })} /></${Campo}>
    ${!disabled ? html`<${CampoCep} id=${p + "-cep"} valor=${c.cep || ""} atual=${c} onMuda=${v => muda({ cep: v, ...(soDig(v).length === 8 ? {} : { cidade: "", uf: "" }) })} onAplica=${m => muda(m)} />` : null}
    ${!disabled || temMais ? html`<${Campo} id=${p + "-end"} rotulo="Endereço (rua e número)"><${Texto} id=${p + "-end"} valor=${c.rua || ""} disabled=${disabled} onMuda=${v => muda({ rua: v })} /></${Campo}>
    <${Campo} id=${p + "-bairro"} rotulo="Bairro"><${Texto} id=${p + "-bairro"} valor=${c.bairro || ""} disabled=${disabled} onMuda=${v => muda({ bairro: v })} /></${Campo}>` : null}
  </div>`;
}
