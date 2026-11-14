// Teste da função "placa" (API Placas / WDAPI) sem rede: uma API falsa responde como a documentação de apiplacas.com.br/documentacao.
// Rodar: deno run -A teste/teste_placa.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { executar, normalizar, temVeiculo, combustivelDe, marcaDe, motorDe, corDe, titulo, erroDaApi, lerSaldo, doCadastro, temBasico, temCompleta, depsDoBanco, ErroUso, Desligada, BASE, atender } = await import("../supabase/functions/placa/index.ts");
// deno-lint-ignore no-explicit-any
type L = Record<string, any>;

// ---------- conversões para o jeito do cadastro da oficina
confere("combustível Detran → cadastro", combustivelDe("Alcool / Gasolina") === "Flex" && combustivelDe("GASOLINA") === "Gasolina" && combustivelDe("Álcool") === "Etanol"
  && combustivelDe("Diesel") === "Diesel" && combustivelDe("Gasolina/GNV") === "GNV" && combustivelDe("Elétrico/Fonte Externa") === "Elétrico"
  && combustivelDe("Gasolina/Elétrico") === "Híbrido" && combustivelDe("") === "" && combustivelDe("Querosene") === "" && combustivelDe(null) === "");
confere("marca por extenso, como a oficina escreve", marcaDe("VW") === "Volkswagen" && marcaDe("I/BMW") === "BMW" && marcaDe("GM - Chevrolet") === "Chevrolet" && marcaDe("M.BENZ") === "Mercedes-Benz"
  && marcaDe("fiat") === "Fiat" && marcaDe("TOYOTA") === "Toyota" && marcaDe("CHEV") === "Chevrolet" && marcaDe("LAND ROVER") === "Land Rover" && marcaDe("IMP/JEEP") === "Jeep"
  && marcaDe("CITROEN") === "Citroën" && marcaDe("Citroën") === "Citroën" && marcaDe("BYD") === "BYD" && marcaDe("") === "" && marcaDe("HARLEY-DAVIDSON") === "Harley-Davidson",
  [marcaDe("VW"), marcaDe("I/BMW"), marcaDe("GM - Chevrolet"), marcaDe("M.BENZ"), marcaDe("IMP/JEEP"), marcaDe("Citroën"), marcaDe("HARLEY-DAVIDSON")].join("|"));
{ // resposta REAL da API (MST2E41, 14/11/2026, consulta básica)
  const real = { error: false, basico: { dados: { uf: "ES", ano: "2009", cor: "Preta", tipo: "Motocicleta", marca: "HONDA", motor: "0.1", modelo: "CG 150 TITAN KS", anoModelo: "2009", municipio: "COLATINA", cilindradas: "149", combustivel: "Gasolina", marcamodelo: "HONDA/CG 150 TITAN KS", final_chassi: "05292", placa_modelo_novo: "MST2E41" }, error: false }, message: "Consulta efetuada com sucesso" };
  const d = normalizar(real as never, "basico") as Record<string, unknown>;
  confere("resposta real da API (CG 150)", d.marca === "Honda" && d.modelo === "CG 150 TITAN KS" && d.ano_fab === 2009 && d.cor === "Preta" && d.combustivel === "Gasolina" && d.motor === "149 cc", JSON.stringify(d));
}
confere("motor de moto em cc (CG 150 = 149 cilindradas, não 0.1)", motorDe("149") === "149 cc" && motorDe("49") === "" && motorDe("499") === "499 cc" && motorDe("500") === "0.5" && motorDe("999") === "1.0",
  [motorDe("149"), motorDe("49"), motorDe("499"), motorDe("500")].join("|"));
confere("motor pela cilindrada", motorDe("1598") === "1.6" && motorDe("999") === "1.0" && motorDe("1984 cc") === "2.0" && motorDe("2776") === "2.8" && motorDe("1.6") === "1.6"
  && motorDe("2,0") === "2.0" && motorDe("exemplo") === "" && motorDe("") === "" && motorDe("16V") === "" && motorDe(1368) === "1.4",
  [motorDe("1598"), motorDe("1984 cc"), motorDe("1.6"), motorDe("2,0"), motorDe("16V"), motorDe(1368)].join("|"));
confere("cor e título", corDe("PRATA") === "Prata" && corDe("branca") === "Branca" && corDe("GRENA") === "Grená" && corDe("") === "" && titulo("MERCEDES-BENZ") === "Mercedes-Benz");

const BASICO = { basico: { error: false, message: "", dados: { marcamodelo: "VW/CROSSFOX", final_chassi: "12345", modelo: "CROSSFOX", marca: "VW", cor: "PRATA", ano: "2007",
  anoModelo: "2008", municipio: "São Leopoldo", uf: "rs", especie: "Passageiro", tipo: "Automovel", combustivel: "Alcool / Gasolina", motor: "MOTOR000000", cilindradas: "1598", cmt: "exemplo" } },
  error: false, message: "Consulta efetuada com sucesso" };
const COMPLETA = { ...BASICO, motor: { error: false, dados: { motor: "bah123456" } }, chassi: { error: false, dados: { chassi: "9bwzzz377vt004251" } },
  renavam: { error: false, dados: { renavam: "00123456789" } } };
const n = normalizar(BASICO, "basico");
confere("normalizar básico", n.marca === "Volkswagen" && n.modelo === "CROSSFOX" && n.ano_fab === 2007 && n.ano_mod === 2008 && n.cor === "Prata" && n.combustivel === "Flex"
  && n.motor === "1.6" && n.uf === "RS" && n.municipio === "São Leopoldo" && n.final_chassi === "12345" && n.combustivel_detran === "Alcool / Gasolina" && !("chassi" in n), JSON.stringify(n));
const nc = normalizar(COMPLETA, "completa");
confere("normalizar completa", nc.chassi === "9BWZZZ377VT004251" && nc.renavam === "00123456789" && nc.motor_numero === "BAH123456" && nc.marca === "Volkswagen", JSON.stringify(nc));
confere("chassi fora do padrão não entra", normalizar({ ...COMPLETA, chassi: { dados: { chassi: "9BWZZZ00000000000X" } } }, "completa").chassi === ""
  && normalizar({ ...COMPLETA, chassi: { dados: { chassi: "9BWZZZ377VT00425I" } } }, "completa").chassi === "");
const imp = normalizar({ basico: { dados: { marcamodelo: "I/TOYOTA HILUX CD4X4 SRV", ano: "2010" } } }, "basico");
confere("importado sem barra: marca é a primeira palavra", imp.marca === "Toyota" && imp.modelo === "HILUX CD4X4 SRV" && imp.ano_fab === 2010 && imp.ano_mod === 2010, JSON.stringify(imp));
confere("sem o campo marca, tira do marcamodelo", normalizar({ basico: { dados: { marcamodelo: "I/BMW/X1 SDRIVE" } } }, "basico").marca === "BMW"
  && normalizar({ basico: { dados: { marcamodelo: "GM/S10 LS DS4" } } }, "basico").modelo === "S10 LS DS4");
const ex = normalizar({ basico: { dados: { marca: "FIAT", modelo: "UNO", cilindradas: "exemplo", final_chassi: "00000", ano: "exemplo", municipio: "exemplo", cor: { x: 1 } } } }, "basico");
confere("texto de exemplo, zeros e lixo não viram dado", ex.motor === "" && ex.final_chassi === "" && ex.ano_fab === null && ex.municipio === "" && ex.cor === "", JSON.stringify(ex));
confere("resposta vazia não quebra", normalizar(null, "completa").marca === "" && normalizar({}, "basico").modelo === "" && !temVeiculo(normalizar({ basico: { dados: [] } }, "basico")));
// formato antigo da mesma API (WDAPI v1/v2): chaves em maiúsculas e os dados do Detran dentro de "extra"
const antigo = normalizar({ basico: { dados: { MARCA: "VW", MODELO: "NOVO GOL 1.0 CITY", marcaModelo: "VW/NOVO GOL 1.0 CITY", ano: "2014", anoModelo: "2015", cor: "Branca", uf: "ES", municipio: "Colatina",
  extra: { cilindradas: "999", combustivel: "Alcool / Gasolina", chassi: "9bwaa45u0fp012345", renavam: "01012345678", motor: "CCN123456", tipo_veiculo: "Automovel" } } } }, "completa");
confere("chaves em outra caixa e dados dentro de \"extra\" também são lidos", antigo.marca === "Volkswagen" && antigo.modelo === "NOVO GOL 1.0 CITY" && antigo.ano_fab === 2014 && antigo.ano_mod === 2015
  && antigo.cor === "Branca" && antigo.motor === "1.0" && antigo.combustivel === "Flex" && antigo.chassi === "9BWAA45U0FP012345" && antigo.renavam === "01012345678" && antigo.motor_numero === "CCN123456" && antigo.tipo === "Automovel", JSON.stringify(antigo));
confere("erro pelo código, mesmo com resposta 200", erroDaApi(200, { error: true, codigo: "placa_nao_encontrada" }).encontrado === false && erroDaApi(200, { error: true, codigo: "saldo_insuficiente" }).sem_saldo === true
  && erroDaApi(200, { error: true, codigo: "nao_autorizado" }).desligada === true && /fora do ar/.test(erroDaApi(200, { error: true, codigo: "servico_indisponivel" }).erro!)
  && /respondeu: Limite de requisições\./.test(erroDaApi(429, { error: true, message: "Limite de requisições." }).erro!));
confere("erros da API em português", erroDaApi(404, { codigo: "placa_nao_encontrada" }).encontrado === false && /saldo/.test(erroDaApi(402, null).erro!) && erroDaApi(402, null).sem_saldo === true
  && /API_PLACAS_TOKEN/.test(erroDaApi(401, null).erro!) && erroDaApi(401, null).desligada === true && /fora do ar/.test(erroDaApi(503, null).erro!)
  && /Liberados: basico, fipe/.test(erroDaApi(400, { codigo: "parametro_invalido", blocos_disponiveis: ["basico", "fipe"] }).erro!));
const SALDO = (c: number) => ({ cliente_id: "x", nome: "DTCar", produto: "vehicle_basic", saldo_centavos: c, saldo_formatado: "R$ " + (c / 100).toFixed(2).replace(".", ","), preco_consulta_centavos: 3,
  precos: { consulta_centavos: 3, extras_centavos: { fipe: 5, renavam: 12, chassi: 12, motor: 12 }, endpoints: { "/v3/completa": { produto: "vehicle_full", centavos: 20 } } }, consultas_disponiveis: Math.floor(c / 3) });
const ls = lerSaldo(SALDO(997));
confere("saldo e preços da rota /saldo", ls.saldo_centavos === 997 && ls.saldo_formatado === "R$ 9,97" && ls.consultas_disponiveis === 332 && ls.preco.basico === 3 && ls.preco.completa === 20);
const lv = lerSaldo({ saldo_centavos: "abc", precos: { consulta_centavos: 0, endpoints: {} } });
confere("saldo estranho: preço da tabela e saldo vazio", lv.saldo_centavos === null && lv.preco.basico === 3 && lv.preco.completa === 20 && lerSaldo(null).preco.completa === 20);
confere("o cadastro tem os dados?", temBasico(doCadastro({ marca: "Fiat", modelo: "UNO", ano_mod: 2011, cor: "Branca", combustivel: "Flex" }))
  && !temBasico(doCadastro({ marca: "Fiat", modelo: "UNO", ano_fab: 2010, cor: "", combustivel: "Flex" })) && !temBasico(doCadastro({ marca: "Fiat", modelo: "UNO", cor: "Branca", combustivel: "Flex" }))
  && temCompleta(doCadastro({ marca: "Ford", modelo: "KA", chassi: "9bfzh55l0k8 000001", renavam: "0123.456.789-0" })) && !temCompleta(doCadastro({ marca: "Ford", modelo: "KA", chassi: "9BFZH55L0K8000001", renavam: "" })));

// ---------- API falsa + banco falso
const chamadas: string[] = [];
let saldoCentavos = 1000, saldoFora = false;
const falso = (url: string | URL | Request, init: RequestInit = {}) => {
  const u = new URL(String(url)), h = (init.headers || {}) as Record<string, string>;
  chamadas.push(u.pathname);
  const r = (s: number, j: unknown) => Promise.resolve(new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } }));
  if (!String(url).startsWith(BASE)) return r(404, { error: true, codigo: "not_found" });
  if (h.authorization !== "Bearer chave-certa") return r(401, { error: true, codigo: "nao_autorizado", message: "Token ausente ou inválido." });
  if (u.pathname === "/v3/saldo") return saldoFora ? r(503, { error: true, codigo: "servico_indisponivel" }) : r(200, SALDO(saldoCentavos));
  const [, , tipo, placa] = u.pathname.split("/");
  if (placa === "ZZZ9Z99") return r(404, { error: true, codigo: "placa_nao_encontrada", message: "Nenhum registro encontrado para a placa informada." });
  if (placa === "CAI0A00") return r(503, { error: true, codigo: "servico_indisponivel" });
  if (placa === "VAZ1A00") return r(200, { basico: { error: true, message: "sem dados" }, error: false });
  if (placa === "NAO2B00") return r(200, { error: true, codigo: "placa_nao_encontrada", message: "Nenhum registro encontrado." });
  if (placa === "MSG3C00") return r(200, { error: true, message: "Consulta bloqueada para esta conta." });
  if (placa === "EST4D00") { saldoCentavos -= 3; return r(200, { basico: { error: false, dados: { fabricante: "FIAT", descricao: "UNO" } }, error: false }); }
  const preco = tipo === "completa" ? 20 : 3;
  if (saldoCentavos < preco) return r(402, { error: true, codigo: "saldo_insuficiente", saldo_centavos: saldoCentavos, valor_centavos: preco });
  saldoCentavos -= preco;
  return r(200, tipo === "completa" ? COMPLETA : BASICO);
};
const pagas = () => chamadas.filter((c) => /^\/v3\/(basico|completa)\//.test(c)).length;
let banco: L[] = [];
let agora = new Date("2026-11-13T15:00:00Z");
let cadastro: L[] = [];
const deps = (papel = { membro: true, gestor: true, admin: true }, extra = {}) => ({
  papel, usuario: "u1", token: "chave-certa" as string | undefined, limiteDia: 100, fetch: falso as typeof fetch, agora: () => agora,
  cadastro: (placa: string) => Promise.resolve(cadastro.find((v) => v.placa === placa) || null),
  // deno-lint-ignore no-explicit-any
  copia: (placa: string, tipos: string[], desde: string) => Promise.resolve((banco.filter((l) => l.placa === placa && tipos.includes(l.tipo) && l.em >= desde).sort((a, b) => b.em.localeCompare(a.em))[0] || null) as any),
  pagasHoje: () => Promise.resolve(banco.filter((l) => l.em.slice(0, 10) === agora.toISOString().slice(0, 10)).length),
  guardar: (l: L) => { banco.push({ ...l, em: agora.toISOString() }); return Promise.resolve(); },
  ...extra,
});

let r: L = await executar({ acao: "basico", placa: "int-8c36" }, deps());
confere("básica paga, guardada com a resposta inteira, o valor e o saldo", r.ok === true && r.encontrado === true && r.origem === "api" && r.valor_centavos === 3 && r.saldo_centavos === 997
  && r.dados.marca === "Volkswagen" && r.dados.cor === "Prata" && banco.length === 1 && banco[0].resposta.basico.dados.marca === "VW" && banco[0].valor_centavos === 3 && banco[0].saldo_centavos === 997
  && banco[0].por === "u1" && chamadas.join() === "/v3/basico/INT8C36,/v3/saldo" && !("no_cadastro" in r), JSON.stringify(r) + chamadas.join());
r = await executar({ acao: "basico", placa: "INT8C36" }, deps());
confere("mesma placa de novo: sai da cópia, sem pagar", r.origem === "copia" && r.valor_centavos === 0 && pagas() === 1 && banco.length === 1 && r.dados.marca === "Volkswagen");
banco[0].dados = { marca: "VELHO" };
r = await executar({ acao: "basico", placa: "INT8C36" }, deps());
confere("cópia é montada de novo pela resposta guardada (melhoria da conversão vale para as antigas)", r.dados.marca === "Volkswagen" && r.dados.motor === "1.6");
banco[0].resposta = null;
r = await executar({ acao: "basico", placa: "INT8C36" }, deps());
confere("cópia sem a resposta inteira: usa os dados guardados", r.origem === "copia" && r.dados.marca === "VELHO");
r = await executar({ acao: "completa", placa: "INT8C36" }, deps());
confere("completa não usa a cópia da básica", r.origem === "api" && r.valor_centavos === 20 && r.dados.chassi === "9BWZZZ377VT004251" && pagas() === 2 && r.saldo_centavos === 977);
r = await executar({ acao: "completa", placa: "INT8C36" }, deps());
confere("completa repetida sai da cópia", r.origem === "copia" && pagas() === 2);
r = await executar({ acao: "completa", placa: "INT8C36", forcar: true }, deps());
confere("consultar de novo (forcar) paga outra vez", r.origem === "api" && pagas() === 3);
banco = banco.filter((l) => l.tipo === "completa").slice(0, 1);
r = await executar({ acao: "basico", placa: "INT8C36" }, deps());
confere("básica aproveita a completa (com chassi)", r.origem === "copia" && r.tipo === "completa" && r.dados.chassi === "9BWZZZ377VT004251" && pagas() === 3);
agora = new Date("2027-12-01T15:00:00Z");
r = await executar({ acao: "basico", placa: "INT8C36" }, deps());
confere("cópia vencida: consulta de novo", r.origem === "api" && pagas() === 4);
agora = new Date("2026-11-13T15:00:00Z");

r = await executar({ acao: "basico", placa: "ZZZ9Z99" }, deps());
confere("placa não encontrada: ok, sem erro e sem guardar", r.ok === true && r.encontrado === false && !r.erro && !banco.some((l) => l.placa === "ZZZ9Z99"));
r = await executar({ acao: "basico", placa: "VAZ1A00" }, deps());
confere("resposta sem o bloco básico: não encontrada, sem guardar", r.ok === true && r.encontrado === false && !banco.some((l) => l.placa === "VAZ1A00"));
r = await executar({ acao: "basico", placa: "NAO2B00" }, deps());
confere("não encontrada avisada com resposta 200: não é erro", r.ok === true && r.encontrado === false && !r.erro);
r = await executar({ acao: "basico", placa: "MSG3C00" }, deps());
confere("erro sem código: mostra a mensagem da API", r.ok === false && /respondeu: Consulta bloqueada para esta conta\./.test(String(r.erro)), String(r.erro));
const np = pagas();
r = await executar({ acao: "basico", placa: "EST4D00" }, deps());
confere("resposta paga sem marca e modelo: guarda a resposta inteira e diz que não achou", r.ok === true && r.encontrado === false && r.origem === "api" && r.valor_centavos === 3
  && banco.some((l) => l.placa === "EST4D00" && l.resposta.basico.dados.fabricante === "FIAT") && pagas() === np + 1, JSON.stringify(r));
r = await executar({ acao: "basico", placa: "EST4D00" }, deps());
confere("…e não paga de novo pela mesma placa", r.ok === true && r.encontrado === false && r.origem === "copia" && pagas() === np + 1);
r = await executar({ acao: "basico", placa: "CAI0A00" }, deps());
confere("API fora do ar: erro claro", r.ok === false && /fora do ar/.test(String(r.erro)));
saldoCentavos = 1;
r = await executar({ acao: "basico", placa: "ABC1234" }, deps());
confere("sem saldo: avisa para colocar saldo", r.ok === false && r.sem_saldo === true && /saldo/.test(String(r.erro)) && !banco.some((l) => l.placa === "ABC1234"));
saldoCentavos = 1000;
r = await executar({ acao: "basico", placa: "ABC1234" }, deps(undefined, { token: "errada" }));
confere("chave errada: aponta o segredo e marca desligada", r.ok === false && r.desligada === true && /API_PLACAS_TOKEN/.test(String(r.erro)));
let antes = chamadas.length;
r = await executar({ acao: "basico", placa: "ABC1234" }, deps(undefined, { token: undefined }));
confere("sem a chave: desligada, sem chamar a API", r.ok === false && r.desligada === true && /API_PLACAS_TOKEN/.test(String(r.erro)) && chamadas.length === antes);
saldoFora = true;
r = await executar({ acao: "basico", placa: "SLD0A11" }, deps());
confere("rota /saldo fora do ar: a consulta vale, com o preço da tabela e saldo vazio", r.ok === true && r.origem === "api" && r.valor_centavos === 3 && r.saldo_centavos === null && banco.at(-1)!.saldo_centavos === null);
saldoFora = false;

// ---------- regra do Danilo: só vai à API quando o sistema não tem os dados
cadastro = [{ id: "v1", placa: "MTX1A23", marca: "Fiat", modelo: "UNO", ano_fab: 2010, ano_mod: 2011, cor: "Branca", combustivel: "Flex", motor: "", chassi: "", renavam: "" },
  { id: "v2", placa: "PPW2B34", marca: "Ford", modelo: "KA", chassi: "9BFZH55L0K8000001", renavam: "01234567890" },
  { id: "v3", placa: "QQQ3C45", marca: "", modelo: "", chassi: "", renavam: "" },
  { id: "v4", placa: "RRR4D56", marca: "Chevrolet", modelo: "S10", ano_fab: null, ano_mod: null, cor: "Branco", combustivel: "" }];
let n0 = pagas();
antes = chamadas.length;
r = await executar({ acao: "basico", placa: "MTX1A23" }, deps());
confere("placa cadastrada com os dados: responde do cadastro, sem API", r.origem === "cadastro" && r.valor_centavos === 0 && r.dados.modelo === "UNO" && r.veiculo_id === "v1" && pagas() === n0 && chamadas.length === antes);
r = await executar({ acao: "basico", placa: "MTX1A23" }, deps(undefined, { token: undefined }));
confere("sem a chave, o cadastro continua respondendo", r.ok === true && r.origem === "cadastro");
r = await executar({ acao: "completa", placa: "MTX1A23" }, deps());
confere("completa de cadastrado SEM chassi/Renavam: vai à API e mostra o que o cadastro tem", r.origem === "api" && pagas() === n0 + 1 && r.veiculo_id === "v1" && r.no_cadastro.modelo === "UNO" && r.dados.chassi === "9BWZZZ377VT004251");
n0 = pagas();
r = await executar({ acao: "completa", placa: "PPW2B34" }, deps());
confere("completa de cadastrado COM chassi e Renavam: do cadastro, sem API", r.origem === "cadastro" && r.dados.chassi === "9BFZH55L0K8000001" && pagas() === n0);
r = await executar({ acao: "completa", placa: "PPW2B34", forcar: true }, deps());
confere("\"consultar de novo\" na completa vai à API mesmo cadastrado", r.origem === "api" && pagas() === n0 + 1);
n0 = pagas();
r = await executar({ acao: "basico", placa: "MTX1A23", forcar: true }, deps());
confere("forcar não vale para a básica", r.origem === "cadastro" && pagas() === n0);
r = await executar({ acao: "basico", placa: "QQQ3C45" }, deps());
confere("cadastro sem marca/modelo: busca na API", r.origem === "api" && pagas() === n0 + 1);
r = await executar({ acao: "basico", placa: "RRR4D56" }, deps());
confere("cadastro com dado faltando (ano, combustível): busca na API uma vez e mostra o que o cadastro tem", r.origem === "api" && pagas() === n0 + 2 && r.veiculo_id === "v4" && r.no_cadastro.cor === "Branco" && r.dados.ano_fab === 2007);
r = await executar({ acao: "basico", placa: "RRR4D56" }, deps());
confere("…e na segunda vez sai da cópia, mesmo sem o cadastro ter sido completado", r.origem === "copia" && pagas() === n0 + 2 && r.no_cadastro.marca === "Chevrolet");
cadastro = [];

const erroDe = async (c: Record<string, unknown>, d: L) => { try { await executar(c, d as never); return ""; } catch (e) { return (e instanceof ErroUso ? "uso:" : "") + (e as Error).message; } };
const mecanico = { membro: true, gestor: false, admin: false };
confere("mecânico faz a básica", (await executar({ acao: "basico", placa: "ABC1234" }, deps(mecanico))).encontrado === true);
confere("mecânico não faz a completa", /^uso:.*administrador e consultor/.test(await erroDe({ acao: "completa", placa: "ABC1234" }, deps(mecanico))));
confere("pendente não consulta", /^uso:.*liberado/.test(await erroDe({ acao: "basico", placa: "ABC1234" }, deps({ membro: false, gestor: false, admin: false }))));
confere("placa inválida recusada antes de pagar", /^uso:.*Placa inválida/.test(await erroDe({ acao: "basico", placa: "AB12" }, deps())) && /^uso:/.test(await erroDe({ acao: "basico" }, deps())));
confere("ação desconhecida", /^uso:/.test(await erroDe({ acao: "fipe", placa: "ABC1234" }, deps())));
antes = chamadas.length;
r = await executar({ acao: "basico", placa: "DEF5678" }, deps(undefined, { pagasHoje: () => Promise.resolve(100) }));
confere("trava de gasto do dia", r.ok === false && /Limite de 100/.test(String(r.erro)) && chamadas.length === antes);
r = await executar({ acao: "saldo" }, deps());
confere("saldo (administrador): saldo, preços e uso do dia", r.ok === true && r.saldo_centavos === saldoCentavos && r.preco.completa === 20 && r.limite_dia === 100 && typeof r.pagas_hoje === "number", JSON.stringify(r));
confere("saldo: só administrador", /^uso:/.test(await erroDe({ acao: "saldo" }, deps({ membro: true, gestor: true, admin: false }))));
r = await executar({ acao: "saldo" }, deps(undefined, { token: undefined }));
confere("saldo sem a chave: diz que falta ligar", r.ok === false && r.desligada === true);
confere("API sem resposta: mensagem clara", /não respondeu/.test(await erroDe({ acao: "basico", placa: "TMP1A22" }, deps(undefined, { fetch: (() => Promise.reject(new Error("rede"))) as unknown as typeof fetch }))));

// ---------- o acesso ao banco (cliente do Supabase de mentira)
const consultas: L[] = [];
const tabela = (nome: string, erro: L | null = null) => {
  const f: L = { _f: {} as L };
  const fim = () => Promise.resolve(erro ? { data: null, error: erro, count: null } : nome === "veiculos" ? { data: { id: "v9", placa: f._f.placa, marca: "Fiat" }, error: null }
    : { data: consultas.filter((l) => l.placa === f._f.placa), error: null, count: consultas.length });
  Object.assign(f, { select: (_c: string, o?: L) => { f._head = o && o.head; return f; }, eq: (k: string, v: unknown) => { f._f[k] = v; return f; }, in: () => f, gte: (k: string, v: unknown) => { f._f[k + "_gte"] = v; return f._head ? fim() : f; },
    order: () => f, limit: () => fim(), maybeSingle: () => fim(), insert: (l: L) => { if (!erro) consultas.push(l); return Promise.resolve({ error: erro }); } });
  return f;
};
let dia = "";
const adm = { from: (n: string) => { const t = tabela(n); const g = t.gte; t.gte = (k: string, v: unknown) => { dia = String(v); return g(k, v); }; return t; } };
const bd = depsDoBanco(adm, { from: (n: string) => tabela(n) }, () => new Date("2026-11-14T01:30:00Z"));   // 22h30 do dia 13 em Brasília
confere("banco: lê o veículo do cadastro com o login de quem pediu", (await bd.cadastro("ABC1234"))!.id === "v9");
await bd.guardar({ placa: "ABC1234", tipo: "basico", dados: {}, resposta: {}, valor_centavos: 3, saldo_centavos: 10, por: null });
confere("banco: guarda e lê a cópia", consultas.length === 1 && (await bd.copia("ABC1234", ["basico"], "2026-01-01"))!.placa === "ABC1234" && (await bd.copia("XYZ9A99", ["basico"], "2026-01-01")) === null);
confere("banco: o dia do limite começa à meia-noite de Brasília", (await bd.pagasHoje()) === 1 && dia === "2026-11-13T03:00:00.000Z", dia);
const semV55 = depsDoBanco({ from: (n: string) => tabela(n, { code: "PGRST205", message: "Could not find the table 'public.placa_consultas' in the schema cache" }) }, { from: (n: string) => tabela(n) });
let desl = ""; try { await semV55.copia("ABC1234", ["basico"], "2026-01-01"); } catch (e) { desl = (e instanceof Desligada ? "desligada:" : "") + (e as Error).message; }
confere("banco sem o v55: avisa que falta rodar o SQL (consulta ainda não ligada)", /^desligada:.*v55\.sql/.test(desl), desl);
desl = ""; try { await semV55.pagasHoje(); } catch (e) { desl = e instanceof Desligada ? "desligada" : "outro"; }
confere("banco sem o v55: o limite do dia também avisa", desl === "desligada");

// ---------- a porta da função: sem login não entra
const resp = await atender(new Request("https://x.supabase.co/functions/v1/placa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "basico", placa: "ABC1234" }) }));
confere("sem login: recusado", resp.status === 401 || resp.status === 403, String(resp.status));

console.log(ok.length + " ok" + (falhas.length ? ", " + falhas.length + " FALHAS:\n  " + falhas.join("\n  ") : ""));
if (falhas.length) Deno.exit(1);
