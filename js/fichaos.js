// Etapa 3 de "Óleo e filtros por veículo" (14/11/2026): o que lançar na O.S. a partir da ficha do veículo (veiculos.ficha_oleo, v57).
// Funções puras (testadas em teste/teste_fichaos.mjs): quais produtos do estoque servem para o óleo e para cada filtro da ficha.
import { norm } from "./util.js";
import { filtroParaMostrar, TIPOS_FILTRO } from "./catalogo.js";

// "5W30 ou 10W30" → ["5w30", "10w30"]
export const viscosidades = v => String(v || "").split(/\s+ou\s+/i).map(x => norm(x).replace(/[^a-z0-9]/g, "")).filter(x => /^\d{1,2}w\d{2}$/.test(x));
// "3,5" → 3.5; "4.7 / 5.7" (o catálogo juntou duas respostas) → 4.7 com aviso para conferir
export function litrosDaFicha(t) {
  const n = String(t || "").replace(",", ".").match(/\d+(?:\.\d+)?/g) || [];
  return { qtd: n.length ? Number(n[0]) : 0, duvida: n.length !== 1 };
}
const saldo = p => Number(p.estoque_atual) || 0;
const ehProduto = p => p.ativo !== false && (!p.tipo || p.tipo === "produto");

// Óleos do estoque com a viscosidade da ficha (só óleo de motor, em litros). Quem tem saldo para a quantidade vem primeiro; óleo diesel
// só vem na frente se o carro for diesel.
export function candidatosOleo(produtos, viscosidade, qtd, diesel) {
  const vs = viscosidades(viscosidade); if (!vs.length) return [];
  const casa = d => vs.some(v => new RegExp("(?<!\\d)" + v + "(?!\\d)").test(d));
  return (produtos || []).filter(p => ehProduto(p) && (/oleo\s*motor/.test(norm(p.categoria)) || (/^(ltr|l|lt)$/.test(norm(p.unidade)) && /^oleo/.test(norm(p.descricao)))) && casa(norm(p.descricao)))
    .map(p => ({ p, tem: saldo(p) >= (qtd || 0) && saldo(p) > 0, dies: /diesel/.test(norm(p.descricao)) }))
    .sort((a, b) => (b.tem - a.tem) || ((a.dies === !!diesel) ? -1 : 0) - ((b.dies === !!diesel) ? -1 : 0) || (Number(a.p.preco_vista) || 0) - (Number(b.p.preco_vista) || 0))
    .map(x => x.p);
}

// Filtros da ficha: para cada tipo, o produto do estoque (com saldo) que equivale ao código do catálogo, ou o aviso de que não tem.
export function filtrosDaFicha(cat, estoque, produtos, ficha) {
  const porId = new Map((produtos || []).map(p => [p.id, p]));
  return TIPOS_FILTRO.map(([k, rotulo]) => {
    const codigos = (ficha.filtros || {})[k] || []; if (!codigos.length) return null;
    const f = filtroParaMostrar(cat, estoque, ficha.marca || "Tecfil", codigos);
    const cand = f && f.estoque ? f.estoque.flatMap(e => (e.ids || []).map(id => porId.get(id))).filter(p => p && ehProduto(p) && saldo(p) > 0).sort((a, b) => saldo(b) - saldo(a)) : [];
    const principais = f ? Object.entries(f.principais).filter(([, l]) => l.length).map(([m, l]) => (m === "MAHLE" ? "Mahle" : m) + " " + l.join("/")).join(" · ") : codigos.join("/");
    return { k, rotulo, codigos, produto: cand[0] || null, outros: cand.slice(1), principais };
  }).filter(Boolean);
}

// Caminhonete (o cadastro tem um serviço de troca de óleo mais caro para elas): pelo nome do modelo.
export const ehCaminhonete = v => /\b(hilux|s10|s-10|ranger|amarok|l200|triton|frontier|toro|strada|saveiro|montana|oroch|d20|silverado|f-?250|f-?1000|f-?350|ram|hilux)\b/.test(norm([v && v.modelo, v && v.marca].join(" ")));
// Serviço de troca de óleo que já vem marcado: o "CAMINHONETE" para caminhonete, o comum para os outros (sem o do tipo certo, o primeiro).
export function servicoPadrao(servicos, v) {
  const cam = ehCaminhonete(v), eCam = p => /caminhonete/.test(norm(p.descricao));
  return (servicos || []).find(p => eCam(p) === cam) || (servicos || [])[0] || null;
}
