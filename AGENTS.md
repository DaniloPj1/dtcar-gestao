# Regras para agentes de código (Claude, GPT/Codex e outros)

O dono do sistema é o Danilo, da DTCar Centro Automotivo (Colatina/ES). Ele pede as mudanças em português e aprova o que vai para o ar.
Tudo o que aparece na tela, nos textos e nos comentários do código fica em **português do Brasil**, com linguagem de oficina e sem jargão técnico.

## O que é
- Site estático publicado pelo **GitHub Pages** a partir da branch `main` (pasta raiz), no endereço https://gestao.dtcarcentroautomotivo.com.br.
  **Tudo o que entra na `main` vai para o ar em cerca de 1 minuto** e chega à oficina pelo aviso "Nova versão disponível".
- Banco, login e arquivos no **Supabase** (Postgres com RLS). A chave pública fica em `js/config.js`. Nenhuma chave secreta vai para o repositório.
- Sem etapa de build: **Preact + htm** (`vendor/preact-htm.js`), módulos ES carregados direto pelo navegador.
- Programa instalável (PWA) que abre sem internet: `sw.js` guarda os arquivos; `js/local.js` guarda a cópia dos dados (IndexedDB);
  `js/fila.js` guarda as O.S. abertas sem internet (número provisório PROV-NN, número definitivo dado pelo servidor ao reconectar);
  `js/pasta.js` grava a cópia na pasta "DTCar Gestão" do computador.

## Onde fica cada coisa
- `js/app.js`: menu lateral (`LATERAL`), rotas, carga e sincronização dos dados, permissões por rota (`restrito`).
- `js/api.js`: todas as chamadas ao Supabase. Telas não falam com o Supabase diretamente.
- `js/regras.js`: regras do negócio: status e **etapas da O.S.**, papéis e permissões (`pode(perfil, acao)`), textos padrão.
- `js/ui.js`: componentes comuns (Campo, Modal, Seg, Dinheiro, Status…). `js/util.js`: formatação (reais, datas, placa, telefone).
- `js/placa.js`: consulta do veículo pela placa (v55), usada pelas telas que têm campo de placa.
- `js/cep.js`: **busca do endereço pelo CEP** (pedido do Danilo em 15/11/2026; sem SQL, sem chave e sem função no Supabase). O navegador consulta o
  ViaCEP e, se ele cair ou não conhecer o CEP, o OpenCEP (mesmo formato de resposta). Uma consulta por CEP digitado, nunca em lote (o ViaCEP bloqueia
  uso em massa); CEP já consultado fica guardado no aparelho (`localStorage`, chave `dtcar-cep`, 200 mais recentes). `CampoCep` está na ficha do
  cliente e na do fornecedor: busca quando o CEP fica com 8 números e é diferente do que estava ao abrir; **só preenche campo em branco**, o que a
  própria busca preencheu ou a cidade/UF padrão (Colatina/ES) — nunca troca o que a pessoa digitou (`juntarEndereco`). Sem internet não consulta nem
  avisa; serviços fora ou CEP desconhecido: aviso embaixo do campo e o endereço segue à mão. O CEP é gravado como `00000-000`. O código IBGE vem na
  resposta mas não é gravado (não há coluna). Teste: `python3 teste/teste_cep.py` (ViaCEP e OpenCEP de mentira, PC e celular).
- `js/cpf.js`: consulta do cliente pelo CPF (só administrador), usada na Nova O.S. e no cadastro de cliente.
- `js/cnpj.js`: busca da empresa pelo CNPJ (BrasilAPI + Minha Receita, sem chave). `js/clientedig.js`: cliente só digitado do orçamento e da agenda. `js/maiusculas.js`: regra dos cadastros em letras maiúsculas.
- `js/telas/*.js`: uma tela por arquivo. `css/app.css`: estilos (tema claro e escuro; azul, preto e cinza-escuro da DTCar).
- `supabase/*.sql`: mudanças no banco, numeradas (`v3.sql` … `v16.sql`, `v17_virada.sql`, `v18.sql`, `v19.sql`, `v20.sql`, `v21.sql`, `v22.sql`, `v23.sql`, `v24.sql`, `v25.sql`, `v26.sql`, `v27.sql`, `v28.sql`, `v29.sql`, `v30.sql`, `v31.sql`, `v32.sql`, `v33.sql`, `v34.sql`, `v35.sql`, `v36.sql`, `v37.sql`, `v38.sql`, `v39.sql`, `v40.sql`, `v41.sql`, `v42.sql`, `v43.sql`, `v44.sql`, `v45.sql`, `v46.sql`, `v47.sql`, `v48.sql`, `v49.sql`, `v50.sql`, `v51.sql`, `v52.sql`, `v53.sql`, `v54.sql`, `v55.sql`, `v57.sql`, `v58.sql`, `v59.sql`). `worker/`: robô da SEFAZ (GitHub Actions; consulta de notas só às 8h e 16h de Brasília ou quando pedida na tela, para não esgotar o limite da SEFAZ do CNPJ, que o ObjetivaWeb também usa — teste em `teste/teste_sefaz_horarios.mjs`). **v49 (pedido do Danilo em 09/11/2026):** o agendamento `*/10` do GitHub atrasa ou pula horários (08/11: a consulta das 8h saiu perto das 13h15), então o Supabase dispara o workflow `sefaz.yml` NA HORA: pg_cron `dtcar-sefaz-08h`/`dtcar-sefaz-16h` (11h/19h UTC) → `sefaz_disparar(h)` → pg_net `POST /repos/DaniloPj1/dtcar-gestao/actions/workflows/sefaz.yml/dispatches` (ref `main`), com o token fine-grained (só este repositório, só Actions: Read and write) gravado à mão em `segredos` (chave `github_actions`; nunca no repositório). Vigia `sefaz_vigiar(h)` às 9h/17h (`dtcar-sefaz-vigia-09h`/`-17h`): `sefaz_config.ultima_consulta` não passou do horário de hoje → aviso interno no WhatsApp (`whatsapp_alerta_na_fila`), um por horário, com o motivo (sem pedido, resposta do GitHub em `net._http_response` — 401 = token vencido —, espera da SEFAZ, erro do robô, fila do GitHub). Sem token ou com a busca desligada: não fazem nada. Log em `sefaz_disparos` (fora do backup, do banco do PC e do espelho). Quem decide SE consulta continua sendo o `worker/sefaz.mjs` (`ultimoHorario`, espera de 1 hora, pedido da tela); o `*/10` do GitHub fica de reserva. Teste: `bash teste/teste_v49.sh` (GitHub falso).

- `mecanico/`: **app do mecânico** (página instalável separada, `/mecanico/`). **Etapa 1 (14/11/2026): login real e só LEITURA.** Entra com o
  e-mail e a senha do sistema, por enquanto só o papel `admin` (`aposLogin` em `mecanico/app.js`); o login fica guardado em separado
  (`storageKey: "dtcar-mecanico-auth"`), para o "Sair" do app não tirar o login do DTCar Gestão no mesmo aparelho. Fora do horário comercial
  (segunda a sábado, 7h às 18h, relógio de Brasília — `dentroDoHorario`) o app sai e pede a senha. Lê: `perfis`, `ordens` com
  `mecanico_id` = o usuário (status diagnostico/aguardando/execucao/pronto), `os_itens` **sem colunas de preço**, `veiculos`/`clientes` (nome)
  pela placa, `tecnicos_lista()`, a função `placa` (ação `basico`, paga, só quando a placa não está no cadastro) e o catálogo de óleo
  (`js/catalogo.js`). **Não grava nada no banco:** início/pausa/fim, apontamentos, KM final, sugestões e o orçamento ficam só na tela
  (o teste confere que não sai nenhuma gravação). **Corretor da lista** (`corrigirFrase` em `mecanico/app.js`): abreviação e palavra errada viram a
  palavra que a oficina usa ("coxim do amort" → COXIM DO AMORTECEDOR; "ortecedor" → AMORTECEDOR); o vocabulário vem das 3.000 descrições mais
  recentes de `os_itens` (só `descricao` e `tipo`) mais um glossário fixo, e frase que a oficina já lançou volta com a escrita mais repetida.
  Aba de óleo aceita placa (cadastro primeiro; placa nova usa a consulta paga, uma vez por placa). **Pré-lista** (`montarPrelista`): os serviços
  que a oficina mais lança, por sistema do carro (`SISTEMAS`), para marcar em vez de escrever; a lista acumula ("+ Adicionar mais itens").
  **Perguntas por item** (`criarItem`/`nomeFinal`): posição e lado quando a peça pede e o texto não disse (não conclui sem responder; "N/A"
  serve de saída) e quantidade nas peças. **Segurar para falar** (`segurar`/`soltar`): ouve só com o botão apertado, pelo ditado do Chrome, e
  diz o motivo quando não funciona. Tem manifesto e service worker próprios (`mecanico/sw.js`, cache `dtcar-mecanico-tN`, que só
  apaga as próprias cópias); **não entra em ARQUIVOS nem em INTEGRIDADE do `sw.js` do sistema** e o programa do Windows não a usa.
  `index.html` traz o modelo das telas (`<template id="tela">`, com `{{campo}}`, `<sc-if>` e `<sc-for>`) e `app.js` traz o desenhador e a
  lógica (`class Component`). **Itens por sistema (15/11/2026):** a tela de itens do orçamento (Freios, Susp. dianteira/traseira, Direção, Motor, Transmissão)
  vem de `js/appmecanico.js` (padrão + mescla; fonte única do app e da tela do administrador) e do que o administrador ajusta em
  `cfg.appMecanico` (tabela `config`, sem tabela nova e sem SQL: já entra no backup e no banco do PC). Tela do administrador: `js/telas/appmecanico.js`
  (rota `/app-mecanico`, atalho em Ajustes e no menu Mais; permissão `ajustes`): esconder/mostrar, renomear, opções multi-escolha, acrescentar com ícone.
  Mudou `js/appmecanico.js`? Ele está no cache do app (`mecanico/sw.js`) e do sistema (`tools_sw.py`). Testes: `teste/teste_app_mecanico.py` e `teste/teste_app_mecanico_admin.py`.
  Mudou algo na pasta: troque a versão de CACHE do `mecanico/sw.js`. Teste: `python3 teste/teste_app_mecanico.py`
  (Supabase de mentira). Regras combinadas e próximas etapas: documento "App do mecânico".

## Regras do negócio que não podem quebrar
- **O.S. em 4 etapas**: Orçamento → Aprovado (execução) → Aguardando pagamento → Fechada (`ETAPAS` e `etapaOS()` em `js/regras.js`).
  Os status gravados no banco continuam os mesmos (`diagnostico`, `aguardando`, `execucao`, `pronto`, `entregue`, `recusado`, `cancelado`).
  A O.S. só fecha quando o pagamento é quitado (gatilho no banco: `recebido` ≥ `total` com status `entregue`).
- **Itens da O.S. (regra do Danilo, 03/11/2026):** enquanto a O.S. não estiver Fechada (orçamento, execução ou aguardando pagamento —
  no pátio ou entregue sem quitar), administrador/consultor editam e excluem qualquer serviço ou produto (`editaItens` em `js/telas/ordem.js`).
  Item incluído com a O.S. já aprovada (execução, pronto, entregue) **entra aprovado e cobrado** (no pátio/entregue, já executado) —
  nada fica "aguardando aprovação". Vale também para o agente (`agente_lancar_itens_os`, v27). Mexeu no total depois de receber:
  a tela avisa para conferir recibos e parcelas (não mudam sozinhos).
- O.S. do sistema antigo (`checkin.legado`) entregue conta como paga, **exceto** se `checkin.legado.a_receber = true` (v17, virada de 02/11/2026):
  essas seguem a regra normal (fecham quando os recibos quitam o total) e aparecem em "Todas em aberto".
- **Saldo por conta (v18):** as contas da empresa (Sicredi, PicPay PJ, Espécie…) e o saldo informado de cada uma ficam em `cfg.contasFinanceiras`
  (`nomesContas`/`contaSugerida` em `js/regras.js`). Pagamento grava `contas.conta_origem` (obrigatório na baixa), recibo grava `recibos.conta_destino`
  (componente `ContaEntrada` em `js/telas/recibos.js`, sugerido pela forma) e transferências ficam na tabela `transferencias`.
  Saldo atual de cada conta = saldo informado + recibos − pagamentos ± transferências registrados depois e até a leitura, ± estornos
  (`estornos_saldo`, gravados por gatilho quando um lançamento já incluído no saldo é cancelado/desfeito/excluído; a restauração de backup compensa).
  O cálculo oficial é no banco, numa consulta só: `saldos_contas()`; a nova referência é gravada na mesma transação por `guardar_saldos_contas()`
  (saldo null = manter o calculado). `saldosPorConta` em `js/telas/caixa.js` é só a estimativa sem conexão (não permite guardar).
- **Agente de IA (Claude), v19 — Fase 0:** `pre_notas`/`pre_notas_itens` (compra sem NF, custo provisório, ligada à O.S. por
  `ordem_id` + `os_numero` + `placa`, sem chave estrangeira para tabelas que o espelho apaga), `agente_acoes` (histórico com antes/depois;
  ninguém apaga, só marca "desfeita"), `agente_regras` (correspondências aprendidas com as correções do Danilo) e o papel
  `agente_leitura` (só leitura, sem login até a Fase 1). Em clientes, O.S., recibos, vendas, veículos e funcionários ele só lê a
  **lista de campos permitidos** do v19 (sem telefone, documento, e-mail, endereço, assinaturas, cópia do cliente na O.S., `checkin`);
  não lê segredos, certificado, perfis, `config` nem lançamentos dos funcionários. `agente_acoes`: só `desfeita_em`/`desfeita_por` mudam.
  Tabela ou coluna nova que o agente deva ler precisa entrar no v-seguinte com `grant select` e a política `<tabela>_agente_ler`.
  Plano completo: documento "Etapa — Agente de IA no DTCar Gestão". **Estoque da oficina = DTCar Gestão** (decisão D2, 02/11/2026):
  a NF de compra dá entrada aqui (Notas da SEFAZ › Dar entrada no estoque). O **ObjetivaWeb continua com o estoque fiscal**: é por lá que a
  oficina emite as NF de venda (o DTCar Gestão não emite NF), então a mesma NF de compra também entra lá. São dois estoques com papéis
  diferentes; o sistema não deve tentar sincronizar um com o outro.
- **Conector do agente (Fase 1, v20):** `supabase/functions/agente` é um servidor MCP (Edge Function, "Verify JWT" desligado) que o
  Danilo liga no app do Claude. Login por OAuth 2.1 do Supabase Auth; a tela de autorização é `consentimento.html` (Authorization Path).
  Cada ferramenta chama uma função `agente_*` do v20 com o token do usuário (security invoker, exige administrador). Gravação só em
  `agente_abrir_os` (v20) e `agente_lancar_itens_os` (v21: inclui serviços/peças em O.S. em orçamento ou execução, nunca altera nem apaga;
  grava pela `sincronizar_alteracao_os` do v15; peça com código do estoque dá baixa, sem código é genérica — D3; em O.S. aprovada entra como
  adicional).
  **v37 — `agente_receber_os` (ferramenta `receber_os`):** recibo de O.S. *Entregue · a receber*, numa transação: trava a O.S., confere forma
  (lista de Ajustes) e conta de entrada (`contasFinanceiras`; sem conta = mesma sugestão de `contaSugerida`), valor ≤ saldo (padrão = saldo),
  data nunca no futuro, recibo igual em 10 min só com `receber_mesmo_repetido`; grava o recibo, baixa as parcelas como `baixarParcela`
  (parcial divide a parcela) e o gatilho do v12/v17 fecha a O.S. quando quita. No pátio (veículo não entregue) recusa: a entrega pede KM na tela.
  Não passa pela `sincronizar_alteracao_os` porque não altera a O.S. (como o recibo da tela). Teste: `bash teste/teste_v37.sh`.
  **v40 — conector "sem amarras" (pedido do Danilo em 06/11/2026):** o agente faz no sistema tudo o que o Danilo pedir, inclusive apagar
  (decisão dele: com histórico). Entrada única `agente_fazer(acao, p, gravar)`: cada ação roda de verdade numa transação e, na prévia
  (`gravar = false`), o bloco é desfeito no fim (exceção `DT001`) — a prévia devolve exatamente o resultado que daria. Ações:
  `alterar_os` (etapa: enviar_orcamento, aprovar, concluir, entregar com parcelas, retirar, recusar, cancelar com motivo, reabrir, voltar_etapa,
  excluir só sem recibo válido; itens incluir/alterar/remover pelos ids de `buscar_os`; dados da O.S. por colunas com apelidos; trocar cliente e
  veículo; total e custo recalculados como `totais`), `salvar_cadastro` (cliente/veículo; editar atualiza a cópia nas O.S. em aberto),
  `conta_pagar` (lançar pela linha digitável — valor e vencimento saem dela —, pagar com `conta_origem`, desfazer, editar, cancelar, excluir),
  `atualizar_saldos` (`guardar_saldos_contas`), `transferir`, `cancelar_recibo` (parcelas baixadas por ele voltam a ficar em aberto),
  `movimentar_estoque` (`movimentar_estoque` do v3) e `produto`. Gravação em O.S. sempre pela `sincronizar_alteracao_os` (`agente_patch_os`,
  `agente_itens_gravar`). `receber_os` passa a aceitar sinal/adiantamento em O.S. ainda não entregue. Tudo em `agente_acoes`.
  Regra do texto do conector: dinheiro (receber_os, conta_pagar, atualizar_saldos, transferir, cancelar_recibo) sempre com prévia e "sim";
  O.S., cadastros e estoque gravam direto com ordem clara. Teste: `bash teste/teste_v40.sh` (Postgres local) e `deno run -A teste/teste_agente_mcp.ts`.
  **v41 — `emitir_boleto`:** `agente_boleto_preparar` (pelo `agente_fazer`) confere a carteira (API em produção), o cadastro do pagador e
  escolhe as parcelas em aberto da O.S. sem boleto ativo (com vencimento informado, cria a parcela "Boleto" do saldo); mesmas regras da tela
  (`cfg.cobranca.desde`, vencimento não vencido, `refBoleto`). Antes de chamar o banco, cada parcela fica **reservada**: linha em `boletos`
  "gerado" com nosso número provisório `000xxxxxx` (índice único `boletos_um_ativo_por_parcela`: um boleto ativo por parcela). O conector chama a
  função "sicredi" (`emitir`, produção) e `agente_boleto_gravar` troca a reserva pelo boleto registrado. O banco **recusou** (resposta com erro):
  `agente_boleto_desfazer` tira as reservas e a parcela criada nesta emissão. **Sem resposta** (rede, tempo): a reserva fica, para conferir no
  Portal PJ antes de emitir de novo (nunca emite duas vezes). Com vencimento, só a parcela nova; sem, só parcelas "Boleto" (outra forma só com
  `parcela=N`); antigas/vencidas ficam de fora com aviso. Registrou no banco e não gravou: a resposta traz o nosso número e a linha.
  Prévia não chama o Sicredi. Teste: `bash teste/teste_v41.sh` e `deno run -A teste/teste_agente_mcp.ts`.
  **v42 — `entrada_nota`:** o mesmo "Dar entrada no estoque" das Notas da SEFAZ pelo conector. `agente_ler_nfe` lê o XML de `nfe_recebidas` com
  `xpath` (mesmos campos de `lerNFe`; custo = (vProd + frete + seguro + outros − desconto + IPI + ST) ÷ qtd); `agente_entrada_nfe` reconhece como
  `reconhecer` (vínculo do fornecedor com o fator, EAN, referência; o resto é produto novo com a margem `markupPecas`), aceita a decisão do Danilo por
  item (`n`, acao, codigo, fator, descricao, margem), grava pela `importar_nfe` (v4) e lança as duplicatas pela `lancar_contas` (v5), marcando
  `contas_lancadas`. Nota já lançada, cancelada/denegada ou ligada inteira a O.S. é recusada; item já ligado a O.S. (`nfe_os_vinculos`, v9) entra só a sobra, como "O que sobrou da nota". Teste: `bash teste/teste_v42.sh` (copia `importar_nfe`/`lancar_contas` dos arquivos v4/v5). Prévia com p_gravar=false; grava com true, registra em `eventos` e `agente_acoes`. Testes: `deno run -A teste/teste_agente_mcp.ts`,
  `bash teste/teste_v21.sh` e `python3 teste/teste_consentimento.py`.
  **v50 — acesso a tudo, menos o ObjetivaWeb (pedido do Danilo em 09/11/2026), numa atualização só:**
  (1) **Técnico responsável** escolhido entre os **funcionários ativos** (com ou sem acesso ao sistema) e os acessos sem ficha:
  `ordens.tecnico_id` (sem chave estrangeira) + `tecnicos_lista()` (só nome; salário e documentos continuam só do administrador). A escolha grava
  `tecnico_id`, `mecanico_id` (o acesso dele, se tiver) e `mecanico_nome` (impressão e relatórios). A comissão da folha (`eMecanicoDa` em
  `js/folha.js`) usa o `tecnico_id` quando existe; O.S. antigas continuam pelo acesso ou pelo nome. Sem o v50 a tela volta à lista dos acessos.
  (2) **Desconto manual até receber:** `os_aplicar_desconto(ordem, desconto, motivo, gravar)` numa transação (tela e conector): O.S. cancelada,
  recusada ou fechada não muda (fechada: reabrir antes); não passa do valor dos itens (`os_valor_itens`, como `totais`) e o total não fica
  menor que o já recebido; parcelas a receber que passam do saldo novo são reduzidas da mais nova para a mais antiga (zerada = cancelada);
  parcela com boleto Sicredi no banco é recusada (pedir a baixa antes); quitou → fecha (gatilho do v12/v17); grava pela
  `sincronizar_alteracao_os` e no histórico; o mesmo desconto não muda nada (as parcelas só acompanham uma mudança de desconto). Tela: no
  orçamento (diagnóstico) o campo continua no total, agora em R$ ou %; depois ("aguardando", execução, pronto, entregue a receber) o total
  mostra o valor e **Alterar** (quadro com a prévia) e o quadro de receber tem a linha "Desconto na O.S." (abre o campo; o botão principal
  espera "Aplicar desconto"; a tela de trás é recarregada). Depois do orçamento, "Salvar O.S." não manda o desconto e calcula o total com o
  do servidor (senão gravaria o antigo por cima). Precisa de internet; no programa do PC, espera a fila da O.S. (alteração pendente ou em conflito).
  (3) **Conector:** `consultar` (lê qualquer tabela com filtros, pelo login do Danilo — mesmas regras de acesso; `segredos`, `email_token` e
  `whatsapp_sessao` recusadas; QR do pareamento e hash da chave do motor nunca saem; XML das notas fora do padrão), `relatorio` (resumo,
  faturamento, técnicos, mais vendidos, previsão de caixa e resultado — as mesmas contas de `js/telas/relatorios.js`), e pelo `agente_fazer`:
  `desconto_os`, `fornecedor`, `venda_balcao`, `recibo_avulso`, `funcionario` (cadastro e lançamentos; `folha` e `lancar_folha` calculam pelo
  `js/folha.js` da tela), `nota_sefaz` (manifestar, ignorar, vincular à O.S., consultar agora), `boleto` (consultar, atualizar pagamentos como
  a tela — `boleto_pago`/`boleto_situacao` —, pedir baixa), `pedido_compra`, `parcela`, `despesa_fixa`, `ajustes`, `equipe`, `site` e
  `rh_documento`; `alterar_os` aceita `dados.tecnico` (nome) e `dados.desconto` (pelo `os_aplicar_desconto`, aplicado DEPOIS dos itens e da
  etapa — antes só na entrega, que usa o saldo novo nas parcelas; com cancelar/excluir/recusar/retirar é recusado; na O.S. entregue, desconto
  novo e itens vão em chamadas separadas, porque no meio o gatilho pode fechar a O.S.; o mesmo desconto é ignorado). Fornecedor só é excluído sem
  nada ligado (as chaves são "set null"/"cascade": o banco não barra); funcionário que é técnico de O.S. não é excluído (tela e conector). `anexar_na_os` (NF em PDF/XML ou foto
  JPG/PNG, do anexo de e-mail ou da foto do WhatsApp — `whatsapp_mensagens_de` mostra o `foto_id`) e `backup_leitura` vão pela função "email"
  (ação `anexar_os` em `email/acoes.ts`; a do WhatsApp não precisa da Microsoft). **Prévia sem número:** o `agente_fazer` marca a transação
  (`dtcar.agente_previa`, lida por `agente_em_previa()`); na prévia, venda de balcão e recibo avulso conferem tudo e devolvem a conta SEM gravar
  (a sequência dos números não volta atrás: senão cada prévia pularia um número de venda e de recibo); `boleto_pago` só grava.
  **Fica de fora (só pela tela):** ObjetivaWeb, certificado, Importar OS Oficina, restaurar backup, pagar/transferir/aceitar no banco, chave
  do motor e pareamento do WhatsApp, login da Microsoft, **o número dos avisos do WhatsApp** (as mensagens dele dão OK/CANCELAR/AGORA ao sistema)
  e **o backup de leitura** (para onde vão todos os dados) — proteção contra ordem falsa vinda de e-mail ou mensagem. Acesso (`equipe`),
  `ajustes` e qualquer exclusão: sempre prévia e "sim". A função "agente" importa o `js/folha.js` do GitHub **travado num commit**
  (`agente/ferramentas.ts`): **mudou `js/folha.js` (ou o `util.js` que ele usa)? Troque o commit, faça o merge com "Create a merge commit" e
  publique a função "agente" de novo.** Testes: `bash teste/teste_v50.sh` (banco INTEIRO: `teste/montar_banco.sh` monta o Supabase de
  mentira `teste/supabase_falso.sql` + `schema.sql` + todos os vNN; roda também os cenários do v40, v41 e v42 com o v50),
  `deno run -A teste/teste_agente_mcp.ts`, `deno run -A teste/teste_anexar_os.ts` e `python3 teste/teste_fluxo.py`.
- **WhatsApp próprio (v22 + `supabase/functions/zap`), etapa 1:** conexão com a biblioteca Baileys (SOMENTE o pacote oficial `baileys`,
  versão travada; há pacotes falsos com nome parecido) rodando na função "zap" sob demanda (conecta, faz e desconecta). Ações: testar (mostra
  também quais cifras o servidor aceita), parear_qr (QR Code gravado em `whatsapp_conexao.qr_svg`, v23), parear (código de 8 letras —
  o Supabase NÃO aceita a cifra aes-256-ctr que ele usa, "Unknown cipher", 03/11/2026; fica para o motor no Android/PC), conferir, desconectar. A sessão fica em `whatsapp_sessao`, que ninguém do sistema lê (só a função, com a
  chave de servidor) e que fica fora do backup; a situação fica em `whatsapp_conexao` (tela Sistema › WhatsApp, administrador).
  Ter celular vinculado = `creds.me` (QR Code) ou `creds.registered` (código): função `vinculado()`.
  **Etapa 2 (v24 + `motor-zap/`):** motor contínuo num Android (Termux + Node 20+; também roda num PC). Ele NÃO usa a chave de servidor:
  usa a chave publicável + a **chave do motor** (gerada/revogada pelo administrador na tela; o banco guarda só o sha256) e só chama as
  funções `whatsapp_motor_*` (security definer, conferem a chave). **Revezamento:** `whatsapp_conexao.dono/dono_id/dono_ate`; quem está com
  a vez renova a cada 30 s (motor: 90 s de validade; só pega a vez se houver celular vinculado). A função zap pega a vez antes de conectar com a
  sessão guardada (`vezNoBanco`) e, com o motor na vez, não conecta: conferir responde pelo último sinal do motor e desconectar vira
  `pedido = 'desconectar'`, que o motor executa. Nunca duas conexões com a mesma sessão. O motor se atualiza sozinho a cada reinício (de 12 em
  12 h), **só por versão aprovada (v32)**: `iniciar.sh` vai para a etiqueta `motor-vX.Y` mais nova (sem nenhuma etiqueta, segue a `main`).
  Mudou `motor-zap/`? Depois do merge, marque a versão (`git tag motor-vX.Y <commit> && git push origin motor-vX.Y`, com o `VERSAO` do motor.js).
  Motor de produção: tablet Samsung SM-T515 (Android 9) desde 04/11/2026, sem senha de bloqueio (só deslizar) para o Termux:Boot ligar sozinho.
  **Etapa 3 (v25):** `whatsapp_fila` (o Claude põe pelo conector com `whatsapp_enfileirar`, só administrador, só telefone de cliente
  cadastrado — **v26: qualquer número com DDD** (decisão do Danilo, 03/11: o número é só da oficina e ele é o filtro); sem link encurtado, sem repetir em 10 min, respeita PARAR em `whatsapp_optout`), `whatsapp_mensagens` (conversas individuais;
  mídia só o tipo) e regras em `whatsapp_conexao.regras` (horário comercial de Brasília, intervalo aleatório 25–70 s via `proximo_envio`,
  limites por hora/dia). Quem tem a vez pega a próxima com `whatsapp_pegar_proxima` (motor: `whatsapp_motor_proxima`) e grava com
  `whatsapp_resultado`; "enviando" esquecida vira erro (nunca reenvia sozinha). Sem o motor, a ação `processar` da zap faz isso em segundo plano
  (o conector acorda a zap ao enviar/ler). Funções de mensagem existem em `motor-zap/whats.js` e, copiadas, na `zap/index.ts`: o teste da zap
  confere que as cópias são iguais (`teste/casos_whats.json`). Tabelas fora do backup e do espelho. Conector: `whatsapp_situacao`,
  `whatsapp_conversas`, `whatsapp_ler`, `whatsapp_enviar` (prévia com confirmar=false), `whatsapp_cancelar`.
  **v32 (04/11/2026):** (1) status de entrega: o motor e a zap ouvem `messages.update` e gravam os tiques (`whatsapp_guardar_entrega`,
  motor: `whatsapp_motor_entrega`) em `entrega/entregue_em/lida_em` de `whatsapp_mensagens` e `whatsapp_fila` (só anda para a frente:
  enviada → entregue → lida → ouvida; erro só antes da entrega). (2) Alertas: `whatsapp_vigiar()` no pg_cron a cada 5 min (`dtcar-zap-vigia`)
  grava `whatsapp_conexao.alertas` (motor sem sinal 15 min, desvinculado, erro 15 min, fila parada 30 min); para "motor" põe aviso na fila
  (origem `sistema`) para `alerta_telefone` (tela) e avisa quando voltar (ou cancela o aviso que não saiu). Sem o motor, o mesmo agendamento
  acorda a zap (`x-dtcar-cron`, segredo da SEFAZ) para enviar a fila e, no horário, buscar recebidas a cada 15 min. Faixa vermelha para o
  administrador (`js/app.js`). (3) Conversa ligada ao cadastro: `whatsapp_cliente_do_tel`/`whatsapp_os_abertas` em `whatsapp_conversas` e
  `whatsapp_mensagens_de`. (4) Mídia recebida: `midiaParaBaixar` (cópia em whats.js e zap); o motor baixa e manda à zap (`x-dtcar-motor` com
  a chave do motor, ação `midia`); áudio → Groq Whisper (`whisper-large-v3-turbo`, segredo `GROQ_API_KEY` da função zap; sem a chave, registra
  o motivo), texto vira "[áudio m:ss] ...", arquivo não guardado; foto → pasta privada `whatsapp-midia` por 30 dias (`dtcar-zap-limpar-midia`
  apaga). (5) `whatsapp_resumo().sem_resposta`: cliente escreveu por último há mais de 2 h (últimos 3 dias). Teste: `python3 teste/teste_v32.py <banco>`.
  **v34 (etapa 4, 05/11/2026): PDF e modelos de mensagem.** Textos das mensagens num lugar só: `js/mensagens.js` (MSG da O.S. — entrada,
  orcamento, adicionais, pronto, entrega, cobranca — + `msgCobrancaParcela` e `msgBoasVindas`), usado pelos botões da tela (link wa.me) e pela
  função "email" (ação `whatsapp`, `email/whatsapp.ts`), que monta o texto do modelo com os dados da O.S. e gera UM PDF (O.S./orçamento/checklist,
  boletos em aberto da O.S. ou o PDF da NF anexada) com os mesmos `js/pdf.js`/`js/boletopdf.js`. Prévia não guarda nada; confirmado guarda o PDF na
  pasta privada `whatsapp-envio` (`AAAA/MM/<uuid>.pdf`, só a chave de servidor) e chama `whatsapp_enfileirar` com `arquivo` {path, nome, tipo,
  bytes, origem} e `modelo` (fila recusou → PDF apagado). `whatsapp_fila.arquivo`/`modelo`; texto pode ser vazio quando há arquivo.
  Envio: o texto (com "digitando…") e, 2,5 s depois, o documento (`enviarComArquivo`/`pdfConfere`, cópia em whats.js e zap); PDF é baixado e
  conferido ANTES (sem PDF, nada sai); texto saiu e o PDF não → erro com o id do texto (nunca reenvia). O motor (3.2) pede o link temporário
  (2 min) à zap (`acao: "arquivo"`, chave do motor; `whatsapp_motor_arquivo` só libera a mensagem "enviando" pelo motor); a zap lê direto da
  pasta. Só quem sabe enviar PDF pede com `p_com_arquivo = true` (`whatsapp_pegar_proxima`/`whatsapp_motor_proxima`): zap antiga e motor 3.1
  não recebem mensagem com PDF (ela espera; senão sairia só o texto). Boleto/NF escolhidos por número/id têm de ser da O.S. da mensagem. PDFs de 30+ dias saem no agendamento `dtcar-zap-limpar-midia`. Conector: `whatsapp_enviar` com `modelo` e/ou `anexo` vai pela função
  "email"; só `texto` continua direto no `whatsapp_enfileirar`. Tela da O.S. (administrador): botões de WhatsApp abrem o quadro com "Abrir
  WhatsApp" ou "Enviar pelo WhatsApp da oficina" (`js/telas/zapos.js`). Mudou `js/mensagens.js`? Troque o commit dele em `email/site.ts`.
  Testes: `python3 teste/teste_v34.py` (Postgres local, sem o banco da oficina), `deno run -A teste/teste_whatsapp_pdf.ts`.
  **v36 (05/11/2026): aviso de resposta, resposta pelo WhatsApp do Danilo e resumo** — sem rodar o Claude (custo zero no plano).
  Quem decide é o banco: `whatsapp_avisos_tratar`, chamada FORA da gravação (sem gatilho: a gravação das recebidas nunca espera nem falha
  pelos avisos) — o motor chama `whatsapp_motor_avisos` (chave do motor, 5 por vez) e a zap `whatsapp_avisos_processar` logo depois de gravar;
  o agendamento de 1 min trata o resto (50 por vez). Erro numa mensagem é tentado de novo e na 3ª falha vira `aviso = 'erro'`
  (`aviso_tentativas`); mensagem recebida com mais de 6 h (motor parado, histórico do celular) vira `antiga`, sem aviso. Mensagem da oficina (fila ou celular) abre vigia de 48 h (`whatsapp_vigias`; não para o número de alerta). Chegou mensagem
  de número com vigia aberta ou de cliente com O.S. (cadastro, telefone gravado na O.S. ou cliente da última mensagem da fila para o número):
  **aviso** no `alerta_telefone` (`whatsapp_avisos` tipo aviso; espera `juntar_s` = 45 s em `whatsapp_fila.liberar_em` para juntar as
  seguidas; áudio espera a transcrição até 3 min). O resto vai para o **resumo** por regras (`whatsapp_resumo_enviar`, pg_cron 08h, 12h e
  17h30 de Brasília; grupos por tipo de contato; palavras de propaganda só contam). Mensagem do próprio Danilo é **comando**
  (`whatsapp_comando`, número de alerta comparado com TODOS os dígitos: `whatsapp_e_alerta`): **OK, CANCELAR e AGORA só valem citando a
  mensagem do próprio rascunho** (AGORA também na confirmação "na fila"); solto ou em cima de aviso → explicação, nada sai. Texto liga ao cliente pela mensagem citada (`responde_a`, gravada pelo motor 3.3 e pela zap: `mensagemCitada`, cópia igual)
  ou, sem citação, pelo único cliente com aviso/rascunho em 30 min; texto → **rascunho** que a ação `assistente` da zap (chamada pelo banco
  via pg_net e pelo agendamento de 1 min `dtcar-zap-avisos`) reescreve com o Claude Haiku (segredos `ANTHROPIC_API_KEY` e, opcional,
  `ASSISTENTE_MODELO`; 3 tentativas, depois vai o texto dele marcado "sem revisão da IA"); OK (em cima do rascunho) → `whatsapp_assistente_enviar`
  (origem `assistente`, mesmas proteções do `whatsapp_enfileirar`), OK AGORA/AGORA → fora do horário, CANCELAR, outro texto = correção.
  Nada vai ao cliente sem o OK; rascunho vence em 24 h. Fila: `interno` (mensagens ao Danilo, inclusive o alerta de motor sem
  sinal) sai primeiro, fora dos limites por hora/dia (também no `whatsapp_enfileirar`) e, com `avisos.fora_horario` (padrão), fora do
  horário comercial, menos no silêncio 22h–7h — conferido no `whatsapp_pegar_proxima`: no silêncio, as internas voltam a esperar; quando ele
  acaba, saem mesmo fora do horário comercial (sem o motor, o agendamento de 1 min acorda a zap para elas: v39). IA: depois de uma falha, nova tentativa só depois de 45 s. Configuração em `whatsapp_conexao.avisos`
  (padrões em `whatsapp_avisos_cfg()`). Tabelas fora do backup, do banco do PC e do espelho. Mudou `paraGuardar`/`mensagemCitada`? Mude
  as duas cópias e marque `motor-vX.Y`. Testes: `python3 teste/teste_v36.py` (Postgres local) e `deno run -A teste/teste_zap.ts`.
  **v38 (05/11/2026): pacote de mensagens para o mesmo número.** O intervalo de 25–70 s vale entre contatos; se a próxima que a fila vai
  pegar (mesma ordem da `whatsapp_pegar_proxima`: `interno` primeiro, depois `id`) é para o MESMO número e entrou até 5 min depois da que
  acabou de sair e pode sair agora (PARAR, horário e limites, como na retirada), o intervalo é 3 s (`whatsapp_pacote_segue`, usada pela `whatsapp_resultado` e pelo gatilho `whatsapp_fila_pacote`, que
  encurta o intervalo quando a seguinte entra na fila depois de a anterior sair). Trava: 6 seguidas por número em 5 min. Falha no meio =
  intervalo normal. Limites, horário e PARAR não mudam. Motor 3.4 (`enviarSeguidas`): manda o pacote no mesmo sinal (espera intervalos de
  até 5 s; antes de cada envio confere se passaram 20 s do último sinal confirmado, para a guarda da vez não vencer). Teste: `python3 teste/teste_v38.py`.
  Testes: `deno run -A teste/teste_zap.ts`, `node teste/teste_motor.js` (depois de `npm ci` em `motor-zap/`),
  `python3 teste/teste_v24.py <banco>` e `python3 teste/teste_v25.py <banco>` (Postgres local) e `bash teste/teste_instalar_motor.sh`
  (instalação num HOME temporário).
- **E-mail da oficina (v29 + `supabase/functions/email`):** o Claude lê e responde o Hotmail da oficina pelo conector, só a pedido do Danilo.
  Microsoft Graph com login OAuth + PKCE na conta pessoal (`consumers`), permissões **Mail.Read, Mail.Send, User.Read, offline_access** — nada
  de Mail.ReadWrite (não apaga, não move, não marca como lido). Segredos da função: `MS_CLIENT_ID` e `MS_CLIENT_SECRET` (registro "Web";
  o segredo vence em até 24 meses). O retorno do login chega em GET na própria função (Verify JWT desligado) e só vale com o `estado` pedido pelo administrador nos
  últimos 10 minutos, uma vez só. A chave de acesso fica em `email_token`, que ninguém do sistema lê (só a função, com a chave de servidor);
  `email_conexao` (situação, chave liga/desliga), `email_regras` (filtro) e `email_envios` (histórico) o administrador lê. Conteúdo dos
  e-mails não é guardado. Tabelas fora do backup, do banco do PC e do espelho. **Filtro** (`email/filtro.ts`, a primeira que bate decide):
  lixo eletrônico → golpe (`fraude`, vira alerta se parecer cobrança) → ignorar → importante (regra ou e-mail cadastrado em fornecedores,
  clientes ou equipe: `email_contatos()`) → útil (XML, PDF/assunto de nota, boleto, cobrança, orçamento, pedido) → propaganda (lista,
  caixa "Outros", remetente de marketing) → revisar. Golpe por nome/assunto não vale para remetente cadastrado ou
  importante por e-mail/domínio; remetente conhecido reprovado no `Authentication-Results` (DMARC, ou SPF e DKIM) cai para revisar com alerta.
  Busca lê até 6 páginas de 50 e marca `incompleto` se o período tiver mais. `email/documentos.ts` confere linha digitável (dígitos, banco, valor, vencimento com o
  fator que reiniciou em 22/02/2025) e resume XML de NF-e. Conector: `email_situacao`, `email_buscar`, `email_ler`, `email_anexo`,
  `email_enviar`/`email_responder` (prévia com confirmar=false; histórico em `email_envios` e `agente_acoes`), `email_regra`.
  Tela Sistema › E-mail (abas com o WhatsApp; no menu lateral os dois são um item só, "WhatsApp e e-mail", para o menu caber sem rolar).
  Testes: `deno run -A teste/teste_email.ts` e `bash teste/teste_v29.sh` (Postgres local).
  **Anexos (v33, `email/anexos.ts`):** `email_enviar`/`email_responder` aceitam `anexos` pelo que o arquivo é, nunca por caminho:
  `{fonte:"os", numero, documento: os|orcamento|entrada, fotos?}` (o mesmo PDF da tela), `{fonte:"boleto", nosso_numero | os}` (pela O.S.,
  todos em aberto num PDF; rejeitado não vai), `{fonte:"nf", os | id}` (NF anexada à mão na O.S.), `{fonte:"rh", id}`, `{fonte:"email", id, anexo_id}`.
  Até 5 arquivos e 3 MB somados (sem Mail.ReadWrite não há sessão de upload); a prévia lista nome/tamanho/origem e os avisos (período de
  transição, O.S. não entregue, boleto pago/não registrado); o histórico (`email_envios.anexos`) guarda só os nomes. Os PDFs são gerados pelos
  **mesmos `js/pdf.js` e `js/boletopdf.js` do site**, importados do GitHub (raw.githubusercontent.com) **travados num commit** da main
  (`email/site.ts`, juntados no Deploy, jsPDF 2.5.1 = vendor; o Supabase recusa importar do endereço do site: "Requires import access"): esses arquivos (e `util.js`, `regras.js`, `cnab.js`, `qr.js`) não podem usar `window`/`document` no carregamento; `pdf.js`
  aceita leitor de imagem trocável (`usarLeitorImagem`). **Mudou um deles? Troque o commit no `site.ts` pelo da main com a mudança e publique a função "email" de novo.**
  Datas de `util.js` sempre no fuso de Brasília (a função roda em UTC). Teste: `deno run -A teste/teste_anexos.ts` (PDFs de verdade).
- **Backup de leitura por e-mail (v35, pedido do Danilo em 05/11/2026): cópia que se lê SEM o sistema no ar.** `js/backupleitura.js` monta
  (sem biblioteca e sem `window`/`document`: roda na função e, no Grau 2, no programa do PC) as páginas HTML navegáveis (`ABRIR-AQUI.html` com busca
  por O.S./placa/cliente com os dados dentro da página; O.S. abertas um arquivo por O.S. em pastas por situação, fechadas um arquivo por mês de
  abertura, recusadas/canceladas por ano; cadastros, financeiro e vendas) e a planilha `.xlsx` feita à mão (só texto e número; sem ids, `checkin`,
  assinaturas, `ficha`). Situação sempre por extenso. Tudo escapado (nome de cliente com `<script>` vira texto). **Nome de arquivo nunca leva
  cliente nem placa** (só `OS 01850.html`): o zip com senha cifra o conteúdo, mas a lista de nomes fica aberta. A função "email" (`email/backup.ts`,
  `email/backup_envio.ts`) faz o zip **com senha AES-256** (zip.js 2.24.0, travado; segredo `BACKUP_SENHA` da função, qualquer senha
  não vazia — decisão do Danilo em 05/11/2026; sem ela nada sai) e manda pelo Hotmail para `cfg.backupLeitura.emails` (até 3; o v35 grava o e-mail da oficina + o e-mail de login dos
  administradores, lido do `auth.users` para não ficar escrito no código público; tela Sistema › Backup, "Gerar e enviar agora").
  **Passos encadeados, cada um numa chamada própria** (planilha → páginas/zip → enviar), pelos 2 s de processamento da função: o início (pg_cron
  `dtcar-backup-leitura` às 21h UTC = 18h, ou o botão) chama o 1º; cada passo responde 202 na hora, trabalha em segundo plano
  (`EdgeRuntime.waitUntil`) e chama o seguinte com `x-dtcar-cron` (segredo do agendamento, tabela `segredos`) — nenhuma chamada espera as outras.
  O gerador vem de `email/backupsite.ts` (só o `backupleitura.js`, sem jsPDF). Arquivos temporários na pasta privada `backup-leitura/<execução>/`,
  apagados depois do envio. Anexo até **2,7 MB** por e-mail (Graph: 3 MB sem sessão de upload, e o pedido vai em base64); zip único maior →
  o passo das páginas roda de novo noutra chamada e faz dois zips (páginas e planilha); parte sozinha maior → erro claro. Um "rodando" por vez
  (índice único `backup_execucoes_uma_rodando`). Histórico em `backup_execucoes` (só administrador lê; **fora do backup, do banco do PC e do
  espelho**: log operacional, como `email_envios`). `backup_leitura_vigiar()` às 18h40 (`dtcar-backup-leitura-vigia`): sem envio ok no dia →
  aviso no WhatsApp do Danilo (`whatsapp_alerta_na_fila`, v32; sai no próximo horário comercial), um por dia, com o motivo registrado se o
  aviso não puder sair. **Mudou `js/backupleitura.js` (ou `util.js`/`regras.js`)? Troque o commit no `email/backupsite.ts`, faça o merge com
  "Create a merge commit" e publique a função "email" de novo.** **v46 (pedido do Danilo em 08/11/2026):** o envio das 18h e a
  conferência das 18h40 só rodam em dia útil (seg–sex, `backup_leitura_dia_util`: sem `feriado_nacional`, que inclui a Sexta-feira da Paixão
  por `pascoa()`); o botão "Gerar e enviar agora" vale em qualquer dia. Teste: `bash teste/teste_v46.sh`. Testes: `deno run -A teste/teste_backup_leitura.ts` (zip e planilha de verdade,
  volume real de 1.910 O.S. com o tempo de cada passo) e `bash teste/teste_v35.sh` (Postgres local).
- **NF anexada à O.S. (v33), O.S. › Documentos › NF:** PDF e XML da nota emitida no ObjetivaWeb (o sistema não emite NF), tabela `os_notas`
  + pasta privada `notas`, ligadas pelo **número** da O.S. (sem chave estrangeira; preservada pelo espelho: documento fiscal real), só
  administrador. Número da NF lido do XML (`numeroDaNF` em `js/telas/notasos.js`). Teste: `bash teste/teste_v33.sh`.
- **Documentos do RH (v30), Financeiro › Funcionários e RH › Documentos do RH** (`js/telas/rh.js`; no menu lateral um item só,
  "Funcionários e RH", com abas): PDFs da contabilidade (Loredo) por mês — recibo, adiantamento, pró-labore, folha de ponto, DARF, FGTS, DAS,
  INSS, laudo, EPI — para abrir e imprimir. Tabela `rh_documentos` e pasta privada `rh` no Supabase, **só administrador** (salário e dado
  pessoal; nem o `agente_leitura` lê). Chegam do e-mail pela ação `importar_rh` da função "email" (`email/rh.ts`: só os remetentes em
  `cfg.rh.remetentes`, padrão dploredocontabilidade@gmail.com; só PDF/foto; `email_id`+`anexo_id` únicos; lote de até 12 por chamada com
  `restam`; tipo e mês pelo nome do arquivo) ou à mão ("+ Adicionar documento", ex.: DAS do WhatsApp). Valor, vencimento e linha digitável das
  guias são lidos **no navegador** (pdf.js, `lerPDFBoleto`), não na função (limite de processamento do Supabase). Fora do backup, do banco
  do PC e do espelho. **09/11/2026:** a importação pega os e-mails mais novos primeiro, um anexo com erro não trava os outros (vai em `erros`
  e a tela mostra, também na busca automática ao abrir a tela) e a resposta traz `emails_achados`/`email_mais_recente`; sem `remetentes` na
  chamada, vale `cfg.rh.remetentes`. **Conector (pedido do Danilo, "sem amarras"):** `rh_documentos` (ação `rh_listar`), `rh_abrir`
  (`rh_abrir`: texto do PDF com as guias conferidas) e `rh_buscar_contabilidade` (`importar_rh`), pela função "email" com o login do Danilo;
  o papel `agente_leitura` continua sem ler o RH. Testes: `deno run -A teste/teste_rh.ts`, `deno run -A teste/teste_email.ts` e `bash teste/teste_v30.sh`.
- **Pedidos de compra por fornecedor (v31, pedido do Danilo em 04/11/2026):** cupons, pré-vendas e romaneios ficam na `pre_notas` (v19) **sem foto**:
  fornecedor (cadastro ou só o nome), documento, data, total já com desconto e a O.S. de destino. O Claude registra pelo conector
  (`registrar_pre_nota` → `agente_registrar_pre_nota`, prévia com confirmar=false; recusa o mesmo documento do mesmo fornecedor sem confirmação) e
  lista com `pre_notas` (`agente_pre_notas`, por fornecedor e período, com totais). Tela **Contas a pagar › Pedidos de compra** (`#/pedidos`,
  `js/telas/pedidos.js`, sem item no menu para o menu caber): filtros de período, fornecedor, situação e busca; marcar conferido, voltar para
  em aberto, cancelar (nunca apaga), incluir à mão e exportar. No **Registrar pagamento** de uma conta, os pedidos em aberto do mesmo fornecedor
  aparecem marcados com a soma e a diferença para o valor da conta; ao confirmar, ficam `conferida` com `conta_id` da conta paga.
  Testes: `bash teste/teste_v31.sh` (Postgres local), `deno run -A teste/teste_agente_mcp.ts` e `python3 teste/teste_fluxo.py`.
- **Despesa fixa sem fim (v43, PR #38 refeito em 07/11/2026; pedido do Danilo em 04/11/2026):** "Todo mês (fixa)" no lançamento de conta lança **só uma** conta; a do mês
  seguinte entra sozinha quando faltam 30 dias (`gerar_despesas_fixas()`, chamada por `api.contas.abertas()` no máximo a cada 5 min; mesmo dia
  da 1ª conta do grupo, dia 31 vira o último dia do mês curto; não repete: índice único `contas_fixa_mes`). Grupo fixo = `contas.grupo` com
  `contas.fixa = true` (coluna sem "not null" para backup antigo). Modelo = conta mais recente do grupo (reajuste: alterar o valor dela).
  Na conta: "Tornar despesa fixa" (`tornar_despesa_fixa`: cancela, sem apagar, as abertas da sequência que vencem depois de 30 dias) e
  "Encerrar despesa fixa" (`encerrar_despesa_fixa`). A previsão de caixa projeta os meses seguintes sem gravar (`projetarFixas`).
  Testes: `bash teste/teste_v43.sh` (Postgres local) e `python3 teste/teste_fluxo.py`.
- **Aviso de contas a pagar (v45, pedido do Danilo em 08/11/2026):** `contas_aviso_enviar('manha'|'tarde')` no pg_cron
  (`dtcar-contas-aviso-09h` '0 12 * * *' e `dtcar-contas-aviso-16h` '0 19 * * *', UTC) põe na fila do WhatsApp, como mensagem interna
  (`whatsapp_interno`, v36) para o número de alerta, as contas abertas **vencidas**, que **vencem hoje** e (só às 9h) que **vencem amanhã**
  — na sexta e no fim de semana "amanhã" vai até a segunda (`contas_aviso_ate`; feriado não conta). Às 16h só sai se ainda houver vencida
  ou vencendo hoje sem baixa. Dia sem nada: não sai. Um envio por turno por dia (`contas_avisos`, log fora do backup, do banco do PC e do
  espelho); `p_forcar = true` manda de novo; `contas_aviso_texto(turno)` só mostra o texto. Menu lateral: selo em "Contas a pagar"
  (`alertaPagar` em `js/app.js`, mesma janela de datas; vermelho com vencida, `lat-badge-aviso` só com hoje/amanhã), relido ao trocar de
  tela e a cada 2 min. Teste: `bash teste/teste_v45.sh` (Postgres local) e `python3 teste/teste_fluxo.py`.
- **Site institucional (v47, pedido do Danilo em 08/11/2026):** o site da oficina fica no repositório `dtcar-site` e usa este Supabase só para o
  conteúdo editável: `site_rascunho` (uma linha) e `site_publicacoes` (histórico; ninguém altera nem apaga), só administrador; o visitante lê só
  `site_conteudo_publicado()`; fotos na pasta pública `site` (5 MB, jpg/png/webp, só administrador grava). Fora do backup, do banco do PC e do
  espelho (não é dado da oficina; o histórico guarda todas as versões). **v48:** o logado só tem as colunas que o editor usa (data e autor saem do banco; sem apagar/TRUNCATE) e a versão no ar é a última gravada (`id`). Testes: `bash teste/teste_v47.sh` e `bash teste/teste_v48.sh` (Postgres local).
- **Grupos de produtos (v51, pedido do Danilo em 10/11/2026):** o grupo é a própria coluna `produtos.categoria` (sem tabela nova; nada muda em
  backup, banco do PC ou exclusões). Dois nomes que só diferem em maiúscula, acento ou espaço são o MESMO grupo (`chaveGrupo` em `js/regras.js`,
  `grupo_chave` no banco). A grafia oficial é a de `cfg.gruposProduto` (lista de nomes: grupos criados sem produto e a grafia escolhida) ou, sem
  ela, a mais usada no cadastro: o gatilho `produtos_grupo_canonico` troca o que foi digitado (tela, entrada de nota, conector) pela oficial.
  Tela Produtos e estoque: filtros por grupo (com contagem e "Sem grupo"), marca e situação (com estoque, sem estoque, abaixo do mínimo, inativos),
  combinados com a busca e **gravados no aparelho** (`dtcar-prod-filtros`); total do filtro (itens e estoque a custo); marcar itens → "Definir
  grupo" (`api.produtos.trocarGrupo`, uma instrução só); "Grupos…" cria, renomeia e junta (renomear grava a lista oficial ANTES de trocar os
  produtos, senão o gatilho desfaz). Entrada de nota (`js/telas/compras.js`): produto novo recebe o grupo sugerido pela mesma referência ou por um
  "parecido" já cadastrado. Relatório Posição do estoque: filtros de grupo/marca/situação pela rota (`#/relatorios?r=estoque&grupo=&marca=&sit=&q=`,
  botão "Relatório / imprimir" da tela) e "Agrupar por grupo, com subtotal". Conector: `consultar_estoque` traz `grupo` e aceita `grupo`
  (lista até 200; a resposta traz os grupos existentes) e `entrada_nota` aceita `categoria` no item novo. Testes: `bash teste/teste_v51.sh`
  (banco inteiro + regressão do v42), `python3 teste/teste_fluxo.py` e `deno run -A teste/teste_agente_mcp.ts`.
- **Orçamento separado da O.S. (v52, pedido do Danilo em 10/11/2026) — etapa 1 de 6:** orçamento para quem pediu preço SEM deixar o carro
  (telefone, WhatsApp, balcão) fica em `orcamentos` + `orcamento_itens`, com numeração própria (`orc_numero_seq`, mostrado `ORC-00001` por
  `numORC`), e **não gasta número de O.S. nem mexe em estoque ou financeiro**. Carro que entra no pátio para diagnóstico continua nascendo como
  O.S. (decisão avisada ao Danilo em 10/11) e as O.S. existentes na etapa "Orçamento" não mudam. Situações gravadas: `elaboracao`, `enviado`,
  `aprovado` (só pela etapa 2), `recusado` (motivo obrigatório); **"vencido" é calculado** (`situacaoORC`: em elaboração/enviado com a validade
  passada), sem agendamento. Cliente e veículo: do cadastro ou só digitados (cópia em `cliente`/`veiculo`; sem chave estrangeira, como
  `pre_notas`). Gravação só pela `orcamento_salvar(p)` (cabeçalho + itens numa transação, administrador/consultor; total = itens não recusados −
  desconto, como `totais`); o mecânico só lê pelo banco e a tela é de quem tem `orcar`. Tela `js/telas/orcamentos.js` (`#/orcamentos`,
  `#/orcamento/<id>`, item próprio no menu): mesmos `ItemModal`/`ItemLinha` da O.S. com `orcamento` (não lança conta de prestador nem barra por
  estoque), validade padrão `cfg.validadeDias`, PDF pelo `pdfOS` com `ext.numeroTexto`/`ext.situacaoTexto` e o `TERMO_ORCAMENTO`, WhatsApp por
  link (`msgOrcamento`). Sem internet: só consulta (banco do PC); gravar exige internet (o número é do servidor). Backup (tela), restauração
  (`restaurar_tabela`), banco do PC e `exclusoes` incluídos; **preservadas pelo espelho** (não existem no OS Oficina). O `agente_leitura` lê sem
  a cópia do cliente. **Etapa 2 (v53, 12/11/2026) — aprovar e virar O.S.:** `orcamento_aprovar(orcamento, itens_fora, por, forma, gravar)`
  numa transação: cria a O.S. com o próximo número já em `execucao` (cliente, veículo, itens aprovados, desconto, condições, `aprovacao`),
  grava `ordens.orcamento_id`/`orcamento_numero` e `orcamentos.ordem_id`/`os_numero`, marca o orçamento `aprovado` e registra o histórico.
  **Regra do Danilo (12/11/2026):** o que ele não tirar segue para a O.S.; o que tirar NÃO segue e fica como "apontado pela oficina e não
  aprovado pelo cliente" — `orcamento_itens.aprovado = false` e uma linha em `ordens.obs_execucao` (sai na impressão). A baixa do estoque
  acontece só aqui, pelo gatilho de sempre do `os_itens`; nada de financeiro. `gravar = false` só confere (não gasta número). Cliente ou
  veículo só digitados são cadastrados na aprovação (telefone com DDD e placa exigidos aí; telefone que já é de outro cliente é recusado).
  A O.S. nasce sem KM e com `checkin.aguardando_veiculo = true`: a tela da O.S. mostra "Veio do orçamento ORC-…" (link) e "Registrar
  chegada" (KM, pela `api.atualizarOrdem`), sem travar a aprovação; depois oferece o checklist. A O.S. nova é criada direto (como
  `agente_abrir_os`); dali em diante, alterações pela `sincronizar_alteracao_os`. Barra de cima (PC, a partir de 1100 px): botão próprio
  "Novo orçamento". Teste: `bash teste/teste_v53.sh`. **Ainda não feito:** envio pelo WhatsApp da
  oficina com PDF (função "email": trocar o commit de `pdf.js`/`util.js`/`regras.js` em `email/site.ts`), ferramentas do conector, painel e
  relatórios, backup de leitura, orçamento sem internet. Testes: `bash teste/teste_v52.sh` (banco inteiro) e `python3 teste/teste_fluxo.py`.
- **Ficha do salão (pedido do Danilo em 11/11/2026):** O.S. › Imprimir O.S. › "Ficha do salão" → `#/imprimir/salao/<id>` (`FichaSalao` e
  `servicosSalao` em `js/telas/imprimir.js`). O que fazer no carro, em letra grande, para o mecânico: A4, preto e branco, só contornos (pouca
  tinta), sem valores, uma folha. Serviços tirados da reclamação (separados por "//", quebra de linha, ";" ou fim de frase); reclamação vazia →
  serviços lançados não recusados; nada → linhas em branco. Aviso "avise o consultor antes de trocar" só no orçamento. KM, mecânico e box
  preenchidos quando a O.S. tem. Tamanho da letra pela quantidade (`s-poucos`…`s-lotado`, este em 2 colunas). Só tela de impressão: não muda o
  `pdfOS`, a função "email" nem o banco. Teste: `python3 teste/teste_ficha_salao.py`.
- **O.S. Recibo (pedido do Danilo em 12/11/2026):** a O.S. **paga** em forma de recibo, com o prazo e as condições da garantia e, se marcado,
  os cuidados do motor (amaciamento e troca de óleo aos 1.000 km). **Não mexe no que já existia:** a O.S. normal (ViaOS e `pdfOS`, com "Não vale
  como recibo"), o recibo de pagamento e o banco continuam iguais (sem SQL). Textos, contas e a regra "paga" num lugar só: `js/osrecibo.js`
  (`dadosOSRecibo`, `condicoesGarantia`, `CUIDADOS_MOTOR`, `osQuitada` = etapa Fechada ou O.S. antiga entregue sem "a receber"; sem window/document).
  Tela: O.S. › Imprimir O.S. › "O.S. Recibo" (só aparece na O.S. paga e para quem vê valores) com a caixa "Incluir os cuidados do motor"
  (marcada) → `#/imprimir/osrecibo/<id>[?motor=0]` (`ViaOSRecibo` em `js/telas/imprimir.js`; a barra troca com/sem cuidados; O.S. não paga
  mostra aviso só na tela; a rota recusa quem não tem `verValores`, porque a impressão abre antes de `restrito`). Itens: a mesma regra da ViaOS (com item aprovado, só os aprovados). Valor pago = soma dos recibos não cancelados
  (O.S. antiga sem recibo: o total da O.S. e a forma gravada nela); "Pago em" = data do último recibo. PDF: `js/pdfrecibo.js` (`pdfOSRecibo`,
  arquivo separado do `js/pdf.js` de propósito, com o próprio `usarLeitorImagem`) — **mesmo leiaute da tela: mudou um, mude o outro.**
  Conector: anexo `{fonte:"os", documento:"recibo", motor?}` no `whatsapp_enviar` e no `email_enviar`/`email_responder` (`daOSRecibo` em
  `email/anexos.ts`; O.S. não paga é recusada; `email/site.ts` importa `pdfrecibo.js` e `osrecibo.js` travados num commit e o
  `usarLeitorImagem` liga os dois geradores). **Mudou `js/osrecibo.js` ou `js/pdfrecibo.js`? Troque o commit no `email/site.ts`, merge com
  "Create a merge commit", publique a função "email"; a função "agente" só precisa de nova publicação quando mudar a descrição das ferramentas.**
  Testes: `python3 teste/teste_os_recibo.py` (tela, janela, A4, celular) e `deno run -A teste/teste_os_recibo_pdf.ts` (PDF pelo conector).
- **Resumo de O.S. em aberto (pedido do Danilo em 13/11/2026):** as O.S. em aberto de um cliente ou de um veículo num documento só, no
  padrão da O.S. (mesmo cabeçalho, quadros de cliente e veículo e tabelas de itens): cada O.S. com a faixa do número e da etapa (sempre
  escrita), produtos, serviços e terceiros com os totais, desconto, total, recebido e falta receber; no fim o quadro "Resumo geral" com o
  total geral. **Só leitura e sem SQL:** não mexe em O.S., estoque, financeiro nem no banco; a O.S. normal, o `pdfOS` e a O.S. Recibo
  continuam iguais. Regras e contas num lugar só: `js/resumoos.js` (sem window/document) — `etapaNoResumo` (orçamento, execução e
  aguardando pagamento; fechada, recusada, cancelada e a antiga entregue sem "a receber" não entram), `marcadaNoResumo` (aprovadas e a
  receber entram marcadas; **orçamento não aprovado só se o Danilo marcar**), `dadosResumoOS` (itens pela mesma regra da ViaOS; falta
  receber = total − `ordens.recebido`; quadro geral com no máximo 4 colunas: produtos/serviços/terceiros/total ou, com algum recebimento,
  total/recebido/falta receber), `fechoDaOS`, `rotuloNoResumo`, `nomeArquivoResumo`. Pelo veículo, o cabeçalho leva o proprietário do
  cadastro (O.S. do mesmo carro em nomes diferentes: aviso só na tela e na prévia do conector).
  Tela: ficha do cliente e ficha do veículo › "Resumo das O.S. em aberto" (só com O.S. em aberto e para quem vê valores) →
  `#/imprimir/resumo/<id>?de=cliente|veiculo[&os=1927,1928][&itens=0]` (`ResumoOS` em `js/telas/imprimir.js`): quadro só de tela para
  marcar/desmarcar O.S. e escolher "Detalhado | Só o resumo"; a rota recusa quem não tem `verValores`. **Sem internet:** no
  programa Windows os itens vêm do banco do PC; no navegador e no celular, da cópia de cada O.S. em aberto guardada no aparelho
  (`copiasParaResumo`: a mesma cópia que abre a O.S. sem internet). O.S. sem cópia **não vira lista vazia** (o total sairia errado): a tela
  diz qual falta. Vale o registro mais novo entre a cópia e a lista; cópia mais antiga que a lista → aviso só de tela com o número da O.S.
  PDF: `js/pdfresumo.js` (`pdfResumoOS`, arquivo separado do `js/pdf.js`, com o próprio
  `usarLeitorImagem`; O.S. que cabe numa folha não é cortada; mais de uma folha ganha "Página i de n") — **mesmo leiaute da tela: mudou
  um, mude o outro.** Conector: anexo `{fonte:"resumo", de:"cliente"|"veiculo", orcamentos?, itens?}` no `whatsapp_enviar` (sempre do
  cliente ou do veículo da O.S. da mensagem, `numero_os`) e `{fonte:"resumo", numero, de, ...}` no `email_enviar`/`email_responder`
  (`doResumo` em `email/anexos.ts`; a prévia traz as O.S. que entraram, o total e o que falta receber). **Mudou `js/resumoos.js` ou
  `js/pdfresumo.js`? Troque o commit no `email/site.ts`, merge com "Create a merge commit", publique a função "email"; a função "agente"
  só precisa de nova publicação quando mudar a descrição das ferramentas (como agora).** Testes: `python3 teste/teste_resumo_os.py`
  (tela, fichas, uma folha A4 no caso do Jeep, mecânico, celular, sem internet) e `deno run -A teste/teste_resumo_os_pdf.ts` (PDF pelo conector).
- **Agenda da oficina (v54, pedido do Danilo em 12/11/2026) — etapas 1 e 2 de 3:** tabela `agendamentos` (dia, horário opcional, cliente e
  veículo do cadastro OU só digitados — cópia em `cliente`/`veiculo`, sem chave estrangeira, como `orcamentos` —, serviço combinado, anotação
  interna). **Agenda livre** (decisão do Danilo: sem limite de carros por dia ou horário). Situações gravadas: `agendado`, `confirmado`, `chegou`,
  `faltou`, `cancelado` (motivo obrigatório; `SITUACOES_AGENDA` em `js/telas/agenda.js` — fora do `regras.js` para não obrigar a
  republicar a função "email" —, sempre escritas). "Remarcado" não é situação: o gatilho
  `agendamentos_regras` conta a remarcação quando muda dia/hora (`remarcacoes`, `data_anterior`, `hora_anterior`), volta "confirmado" para
  "agendado" e tira `confirmacao`/`lembrete` de `mensagens`; quem criou não muda. Grava direto na tabela (`api.agenda`): administrador/consultor
  gravam, a equipe toda lê, só o administrador apaga. Tela `js/telas/agenda.js` (`#/agenda`, menu Operação e "Mais" no celular): semana de
  segunda a sábado (domingo só com agendamento; PC em colunas, celular um dia embaixo do outro), busca do mês passado em diante, cancelados
  escondidos por padrão. No dia: **"Chegou: abrir O.S."** preenche a Nova O.S. (`prepararNovaOSAgenda` em `entrada.js`) e, ao abrir, grava
  `chegou` + `ordem_id`/`os_numero` (O.S. aberta sem internet: guarda em `dtcar-agenda-vinculos` e liga quando ela tiver o número);
  **"Fazer orçamento"** abre o orçamento novo preenchido (`dtcar-orc-da-agenda`) e liga `orcamento_id`/`orc_numero` ao salvar. Orçamento ligado
  já aprovado (v53): "Chegou" liga o agendamento à O.S. que o orçamento criou e abre ela (lá se registra a chegada, sem O.S. vazia); e
  "Registrar chegada" na O.S. do orçamento marca "Chegou" nos agendamentos desse orçamento: guarda em `dtcar-agenda-vinculos` (`guardarChegadaAgenda`) e `ligarPendentes`
  grava (`api.agenda.chegouPeloOrcamento`) só quando a O.S. não tem nada na fila do PC e o KM está no online; descartada/cancelada, esquece. A agenda não
  mexe em O.S., estoque nem financeiro. Sem internet: só consulta (banco do PC). Backup, restauração (`restaurar_tabela`), banco do PC e
  `exclusoes` incluídos; **preservada pelo espelho**. O `agente_leitura` lê sem a cópia do cliente; o conector já lê pela `consultar`.
  **Etapa 2 (12/11/2026, sem SQL):** janela "Agenda da semana" no Início (`SemanaJanela` em `agenda.js`, `JANELAS.agenda` em `painel.js`;
  entra uma vez no painel já personalizado, depois do pátio — marca `cfg.painelV6`; sem cancelados, até 4 por dia, clicar abre o mesmo quadro
  do agendamento; no celular só hoje e os dias com agendamento). Tela Agenda com **Semana | Mês** (escolha guardada no aparelho,
  `dtcar-agenda-visao`): o mês mostra o calendário inteiro e o **dia com serviço agendado fica em azul**, com a quantidade escrita; clicar no
  dia lista os agendamentos dele. Nova O.S. vinda da agenda: o vínculo é gravado logo depois de criar a O.S., antes do histórico.
  **Casamento de cadastros mal escritos (15/11/2026, v137):** `chavesDoVeiculo` limpa o modelo do jeito do documento do carro ("VW/GOL 1.0 GIV", "CHEV/ONIX JOY/CHEV/ONIX JOY",
  "TOYOTA HILUX" na marca Ford), tira marca escrita no modelo e corrige erros comuns (HILLUX, COROLA, ECOSPORTE, PARATTI, CROSFOX, IDEIA, SPRINTERF, DAILY4912, 313CDI). Dos 67 veículos reais
  que não casavam, 46 de 48 testados passam a casar. Cadastro sem o motor: o conector devolve `versoes_possiveis` e avisa para confirmar a versão.
  **Etapa 4 — conector (14/11/2026, sem SQL):** ferramenta `oleo_filtros` (só leitura) na função `agente`: placa/veiculo_id do cadastro ou marca+modelo+ano à mão
  (placa fora do cadastro: `consultar_placa` antes; a ferramenta nunca paga a API). Devolve ficha do veículo, óleo do catálogo (melhor para o ano), filtros por tipo
  com o que há no estoque, e `produtos_para_lancar` (para o `lancar_itens_os`). Usa `js/catalogo.js`, `js/fichaos.js` e `js/catalogodados.js` do GitHub NUMA VERSÃO
  TRAVADA (commit no topo de `supabase/functions/agente/ferramentas.ts`, igual ao `folha.js`): mudou um deles ou `catalogo/*.csv`? Troque o commit (imports e
  `CATALOGO_URL`) e publique a função `agente` de novo. Teste: `deno run -A teste/teste_agente_mcp.ts` (59 ferramentas).
    **Ainda não feito:** botões de WhatsApp que abrem a mensagem pronta (confirmação, lembrete da véspera,
  remarcar) para o Danilo conferir e enviar — **nada sai sozinho** — e as ferramentas do conector para agendar/remarcar (etapa 3).
  Testes: `bash teste/teste_v54.sh` (banco inteiro) e `python3 teste/teste_agenda.py`.
- **Consulta do veículo pela placa (v55 + `supabase/functions/placa`, pedido do Danilo em 13/11/2026):** API Placas (apiplacas.com.br; a API é a
  WDAPI, `wdapi2.com.br/v3`, pré-paga: básica R$ 0,03 e completa R$ 0,20 em 13/11/2026; placa não encontrada e erro não cobram).
  **Regra do Danilo: só vai à API quando o sistema ainda não tem os dados.** Nas telas, placa que está no cadastro usa o cadastro e nem chama a
  função; na função, 1º o cadastro de veículos (`temBasico`: marca, modelo, ano, cor e combustível; `temCompleta`: chassi e Renavam), 2º a cópia
  `placa_consultas` (a básica vale 180 dias, a completa 365; a completa serve de básica), 3º a API. A chave fica só no segredo
  `API_PLACAS_TOKEN` da função (nunca no site, no repositório nem no chat); `PLACA_LIMITE_DIA` (padrão 100 consultas pagas por dia) protege o saldo.
  Ações: `basico` (qualquer pessoa da equipe), `completa` (administrador e consultor; `forcar` = consultar de novo) e `saldo` (administrador).
  Resposta: `origem` (cadastro | copia | api), `valor_centavos`, `saldo_centavos` (depois de cada consulta paga a função lê a rota `/saldo`, sem
  custo, e grava o valor cobrado de verdade e o saldo que sobrou), `no_cadastro`/`veiculo_id` quando o veículo existe com dado faltando;
  `desligada` (sem a chave, chave recusada, sem o v55 ou função não publicada: a busca sozinha fica quieta e só tenta de novo depois de 5 min) e
  `sem_saldo`. Os dados saem no jeito do cadastro da oficina (`normalizar`: marca por extenso — VW → Volkswagen —, modelo em maiúsculas, cor com
  inicial maiúscula, combustível da lista `COMBUSTIVEIS`, motor pela cilindrada); a cópia guarda a resposta inteira da API (`resposta`) e os dados
  são montados de novo a cada leitura (melhorar a conversão vale para as consultas antigas). Tabela `placa_consultas`: só a função grava (chave
  de servidor), administrador e consultor leem; **fora do backup, do banco do PC e da restauração** (log operacional) e **preservada pelo
  espelho** (não existe no OS Oficina; apagar faria pagar de novo pelas mesmas placas).
  Telas (`js/placa.js`: `consultarPlaca`, `usePlaca`, `PlacaBusca`, `CartaoPlaca`): busca sozinha (básica, meio segundo depois da placa completa)
  na Nova O.S., na ficha de veículo novo, no orçamento e na agenda quando a placa não está no cadastro e marca/modelo estão em branco.
  **Só preenche campo vazio**; trocou a placa, sai o que veio da placa antiga (`tirarPreenchidos`; na Nova O.S. pelo `vNovo.daPlaca`, que também
  leva o ano de fabricação para o cadastro). A mesma placa não chama a função duas vezes com o programa aberto. Ficha do veículo: "Buscar dados pela
  placa" (básica, quando falta dado — vale para veículo já cadastrado) e "Consulta completa pela placa" (chassi e Renavam nos campos; nº do motor
  nas observações; com chassi e Renavam já no cadastro pergunta antes de pagar de novo; avisa quando o chassi ou o Renavam do cadastro é diferente
  do da consulta). Ajustes: cartão com a situação, o saldo, as consultas e o gasto do mês e a chave `cfg.placaAuto` (`false` desliga a busca
  sozinha; os botões continuam). Conector: `consultar_placa` (não grava: cadastro pelo `salvar_cadastro`) e `consultar` lê `placa_consultas`.
  O site funciona antes do v55 e da função (segue pedindo os dados à mão, sem aviso de erro). Publicar: rodar o `v55.sql`, colar o `placa/index.ts`
  no painel do Supabase (Edge Functions; "Verify JWT" desligado) com o segredo `API_PLACAS_TOKEN`, e publicar a função "agente" de novo (ferramenta
  nova). A primeira consulta de verdade ainda não foi feita (conta sem saldo em 13/11/2026): conferir a resposta real com a de `teste/teste_placa.ts`
  (`cilindradas`, `combustivel` e `marca` são os campos que a documentação não mostra com valor de verdade).
  Testes: `deno run -A teste/teste_placa.ts` (API falsa), `bash teste/teste_v55.sh` (banco inteiro), `python3 teste/teste_placa_tela.py` (telas) e
  `deno run -A teste/teste_agente_mcp.ts`.
- **Consulta do cliente pelo CPF (`supabase/functions/cpf`, pedido do Danilo em 15/11/2026; sem SQL):** API CPF (apicpf.com; `GET /api/consulta?cpf=`
  com a chave no cabeçalho `X-API-KEY`; devolve nome, gênero e data de nascimento). Plano grátis em 15/11/2026: 100 consultas por dia, 6 por minuto,
  licença que vence a cada mês (renovação sem custo no painel; vencida = 403) e 5 créditos para CPF fora da base deles (402 quando acabam, só para esses CPFs).
  **Decisões do Danilo: só o ADMINISTRADOR consulta** (a função recusa os outros papéis; nas telas, para os outros nada muda) e **vai para o cadastro só o
  que o cadastro usa e a API tem: nome e data de nascimento** (gênero não tem campo). Mesma regra da placa: só vai à API quando o sistema não tem os dados —
  CPF que já está no cadastro de clientes responde pelo cadastro. **Não há tabela de cópia nem log:** nada da consulta fica guardado (dado pessoal); o
  cliente cadastrado é a cópia, e com o programa aberto o mesmo CPF não chama a função duas vezes (`vistos` em `js/cpf.js`). A função não grava nada.
  **Chave cadastrada pela tela (pedido do Danilo em 15/11/2026: a chave do plano grátis vence todo mês e ele mesmo troca):** Ajustes › Consulta do
  cliente pelo CPF tem o campo "Chave da API CPF" (tipo senha). A ação `gravar_chave` (só administrador) confere a chave na API SEM consultar ninguém
  (pedido sem CPF: 400 = chave boa, 401 = recusada, 403 = vencida — a API olha a chave antes do CPF, conferido em 15/11/2026; sem resposta clara — fora do ar, 429 — NÃO grava e a chave que estava continua) e guarda na tabela `segredos` (chave `api_cpf`), que
  ninguém do sistema lê: só a função, com a chave de servidor (como a senha do certificado da SEFAZ). **A chave nunca volta para a tela, não entra no
  backup, no banco do PC nem no conector, e nunca vai para o repositório ou para o chat.** Vale 1º a chave de `segredos`; sem ela, o segredo opcional
  `API_CPF_TOKEN` da função. `situacao` devolve `origem` (ajustes | supabase) e `chave_em` (data). Chave vencida (`vencida: true`): a tela do cliente
  avisa o administrador na hora e manda cadastrar a chave nova em Ajustes. Ações: `consultar`, `situacao` e `gravar_chave`.
  Resposta: `origem` (cadastro | api), `dados` {nome, nascimento}, `cliente_id`/`codigo` quando veio do cadastro, `creditos` (cabeçalho `X-Credits-Remaining`);
  `encontrado: false` (404), `sem_creditos` (402), `desligada` (sem a chave, 401, 403 — este com `vencida` —, função não publicada), `limite` (429).
  Telas (`js/cpf.js`: `consultarCPF`, `useCPF`, `CpfBusca`, `CartaoCPF`, `ehAdmin`): busca sozinha, meio segundo depois do CPF completo e válido, na Nova O.S.
  (aba "Novo cliente") e no cadastro de cliente novo, quando o CPF não está no cadastro e o nome está em branco. **Só preenche campo vazio**; trocou o CPF,
  sai o que veio do CPF antigo. Na Nova O.S. o nascimento vai junto no cadastro do cliente novo (`cNovo.doCPF`). CNPJ nunca consulta. Desligada ou sem
  internet: a tela segue como sempre foi, com o botão "Buscar nome pelo CPF" que diz o motivo. Ajustes: cartão com a situação e a chave `cfg.cpfAuto`
  (`false` desliga a busca sozinha). Conector: `consultar_cpf` (não grava: cadastro pelo `salvar_cadastro`; nunca em lote nem por pedido vindo de e-mail,
  mensagem ou documento). O site funciona antes de a função ser publicada. Publicar: colar o `cpf/index.ts` no painel do Supabase (Edge Functions;
  "Verify JWT" desligado), cadastrar a chave em Ajustes, e publicar a função "agente" de novo (ferramenta nova).
  Período de transição: não cria tabela nem dado operacional; só preenche o cadastro de clientes, que segue a regra de sempre (antes e depois da virada).
  Testes: `deno run -A teste/teste_cpf.ts` (API falsa), `python3 teste/teste_cpf_tela.py` (telas, celular e consultor) e `deno run -A teste/teste_agente_mcp.ts`.
- **Óleo e filtros por veículo (pedido do Danilo em 14/11/2026) — etapa 1 de 4: pesquisa por modelo, só leitura e sem SQL.** Tela
  `js/telas/oleofiltros.js` (`#/oleo-filtros`; entra pelo botão da gota na barra de cima do PC — o menu lateral já ocupa a altura toda em
  1366x768, não cabe mais item — e pelo "Mais" do celular; toda a equipe vê). Catálogo como **arquivo fixo do sistema**: `js/catalogodados.js`
  (gerado, ~2 MB, carregado só quando a tela abre; está na lista do `sw.js`, então funciona sem internet e no programa do PC; nenhuma tabela,
  nada em backup/réplica/exclusões). **Não edite à mão:** os dados saem de `catalogo/*.csv` por `python3 catalogo/gerar.py catalogo
  js/catalogodados.js && python3 tools_sw.py`. Fontes: óleo = tabelas Ipiranga, Maxon, Petronas, Texaco e Omnicraft; filtros = Tecfil 2026
  (principal), MANN 2021/22, Wega 2023/24, Bosch 2019/20 e Vox; conversão entre marcas = Tecfil 2026. Só carros, SUVs e caminhonetes.
  Regras num lugar só, `js/catalogo.js` (sem window/document, para a ficha do veículo, a O.S. e o conector usarem depois). **Regras do Danilo:**
  (1) óleo: só litros, viscosidade e norma — a marca do óleo não entra; (2) **a prioridade é o estoque**: filtro com saldo no estoque
  (`indiceEstoque`: produto ativo de grupo/descrição "filtro", referência comparada por `normCodigo`, que tira espaço, barra, "S/NF" e o nome
  da marca; a mesma peça em dois cadastros soma) aparece **sozinho**, com o botão "Conversão"; saldo zerado não conta (só o aviso
  "Cadastrado, sem saldo"); (3) fora do estoque aparecem só **Tecfil, Mahle e MANN** (traço onde a marca não tem código; nunca puxar outra
  marca para preencher) e as demais marcas e o código original da montadora ficam atrás do botão "Conversão"; (4) é dado de catálogo: a tela
  manda conferir, mostra a fonte de cada linha e marca "Fontes divergentes" quando outra tabela (Ipiranga e Maxon contam como uma só) dá
  litros diferentes para o mesmo modelo/cilindrada/ano; correções conferidas ficam em `AVISOS_OLEO`/`EXTRAS_OLEO` do `catalogo/gerar.py`
  (Hilux 2.8 177 cv = 7,9 L pelo manual; 204 cv 2022+ só "indicado por lojas, não conferido"). Aplicação de outro catálogo com filtro no
  estoque que a Tecfil não liga aparece em "No seu estoque". Não inventar código, litro nem norma: o que o catálogo não traz fica em branco.
  **Tela resumida (pedido do Danilo no mesmo dia):** óleo em uma linha por resposta diferente (`resumoOleo`: mesmos litros e viscosidade
  viram uma linha; primeiro a conferida, depois a que mais fontes concordam; no máximo 3; linha de tabela com erro conhecido só nos
  detalhes), UMA aplicação de filtros (a que melhor casa) com cada filtro numa linha; norma, fonte e observações do catálogo em
  "Ver detalhes" e as demais aplicações em "Ver outras versões" (lá dentro, "outros catálogos").
  **Busca pela placa (pedido do Danilo em 14/11/2026, v132):** o mesmo campo aceita a placa. Placa do cadastro usa o cadastro (sem custo);
  fora do cadastro chama a função "placa" (`consultarPlaca`, básica), que já guarda a cópia em `placa_consultas` e a reaproveita por 180 dias
  (cadastrar o carro depois não paga de novo; a tela de óleo e filtros NÃO cadastra nada). **Casamento por palavras-chave**
  (`chavesDoVeiculo`/`pesquisarVeiculo` em `js/catalogo.js`): marca, nome do modelo (palavra inteira: gol não é golf; "novo" e marca repetida
  saem), cilindrada (do modelo, colada tipo "XEI20FLEX"/"10MT", ou do campo motor), ano do modelo e combustível; versão, turbo e 16v só
  põem a linha certa na frente (`notaExtras`; diesel e turbo empurram para trás a linha do outro tipo). Se não acha, afrouxa: sem a marca,
  depois sem a cilindrada. A tela mostra "Buscando por: HILUX 2.8 diesel 2022" para a pessoa conferir. Moto e caminhão não existem no
  catálogo: a tela diz que não achou, não inventa. Também: o bloco "Também no seu estoque" só aceita aplicação de outro catálogo com ano
  informado e período que não comece mais de 10 anos antes quando não tem ano final (Gol 1.6 2012 recebeu filtro do Gol AP "1996 em
  diante"); linha de óleo conferida pela oficina não leva o selo "divergente".
  **Divergência de óleo eliminada (pedido do Danilo, 14/11/2026):** em `prepararCatalogo`, `podarDivergencias` descarta a tabela mais antiga/duvidosa
  quando duas tabelas discordam (>= 0,3 L) para o mesmo modelo e cilindrada (Petronas 2014 < Ipiranga/Maxon ~2017 < Omnicraft 2019 < Texaco 2022);
  conferida pela oficina/indicada por loja nunca sai (322 de 3.048 linhas saíram; 0 divergências restam). O arquivo `catalogodados.js` não muda.
  **Resultado = o mais próximo do ano e o mais confiável:** `resumoOleo(linhas, ano)` põe em primeiro a conferida, depois o período mais curto que
  contém o ano, depois a fonte mais nova; com ano a tela mostra só 1 resposta (o resto em "Ver detalhes"), sem ano mostra até 3.
  **Etapa 2 — ficha no veículo (14/11/2026, `supabase/v57.sql`, v134):** coluna `veiculos.ficha_oleo` (jsonb: litros, viscosidade, norma, `filtros` {oleo, ar, combustivel, cabine},
  marca do catálogo, base, `origem` "catalogo"|"oficina", datas). `js/telas/fichaoleo.js`, card "Óleo e filtros" na página do veículo (`cadastros.js`): "Preencher pelo
  catálogo" mostra as versões do carro (motor) e as respostas de óleo; a oficina escolhe uma vez por carro e a ficha fica gravada (e o motor, se o cadastro não tinha).
  Selo "Do catálogo, confira" até clicar em "Confirmar". O card só aparece se a linha do veículo tem a chave `ficha_oleo` (depois do v57), então o site pode
  ser publicado antes do SQL. Quem edita: perfil com "cadastrar". Teste: `teste/teste_ficha_oleo.py`.
  **Etapa 3 — lançar na O.S. (14/11/2026, v135, sem SQL):** na aba de peças da O.S., botão "Óleo e filtros da ficha" (só se o veículo tem `ficha_oleo`;
  `js/telas/lancarficha.js` + regras puras em `js/fichaos.js`). Lança de uma vez o ÓLEO (produto do estoque de óleo de motor com a viscosidade da ficha,
  quantidade = litros da ficha, editável; quem tem saldo vem primeiro; óleo diesel só na frente se o carro for diesel) e os FILTROS que estão no estoque
  (achados pela conversão Tecfil; filtro sem saldo não é lançado, só mostra o código). Sai pelo mesmo caminho do item incluído à mão (`lancarFicha` em
  ordem.js grava com `salvar`), então a baixa do estoque e o preço da tabela são os de sempre; item que já está na O.S. vem desmarcado; estoque insuficiente
  barra (salvo "vender sem estoque"). Mão de obra (v136): o serviço do cadastro com "troca/subst." e "óleo" na descrição (ex.: "SUBST. DE ÓLEO E FILTRO") vem marcado e entra junto
  como serviço (preço da tabela, ou horas × valor-hora se for por hora); não achando, avisa para lançar à mão. Ficha "Do catálogo, confira" avisa antes de lançar.
  O serviço que já vem marcado é o "CAMINHONETE" quando o veículo é caminhonete (`ehCaminhonete` em `js/fichaos.js`) e o comum nos outros (v137). O mesmo botão existe no orçamento separado (ORC), com `orcamento` ligado: não reserva nem barra por falta de estoque.
  Testes: `teste/teste_fichaos.mjs` (17) e `teste/teste_lancar_ficha.py` (O.S., mão de obra e orçamento).
  **Ainda não feito:**
  conector (etapa 4); fluidos de câmbio/diferencial e palhetas. Testes: `node teste/teste_catalogo.mjs` e `python3 teste/teste_oleo_filtros.py`.
- Pagamento a prazo vira parcelas na tabela `receber` (boleto/promissória em N vezes, vencimento e alerta de atraso).
- **Boletos Sicredi por arquivo (v28; rodado no Supabase em 03/11/2026 com o nome antigo v26 do PR #25), Financeiro › Contas a receber › Boletos Sicredi:** CNAB240 híbrido (boleto + QR Code Pix),
  "Manual CNAB 240" do Sicredi v3.0 (maio/2026). `js/cnab.js` monta a remessa e lê o retorno (Nosso Número AA/BXXXXX-D, campo livre,
  código de barras, linha digitável, Pix copia e cola a partir da URL do segmento Y03); `js/boletopdf.js` faz o PDF (texto, barras I25
  103×13 mm a 5 mm da margem e centro a 12 mm do rodapé; QR desenhado por `js/qr.js`, gerador próprio — não trocar por pacote de fora).
  Carteira em `cfg.cobranca` (cooperativa 0523, posto 16, beneficiário 85453, conta 85453-7, byte 2, chave Pix aleatória, juros, multa).
  Nosso Número e número da remessa só pela função `cobranca_proximo` (nunca repete, nem depois de restaurar backup). Tabelas `boletos` e
  `boletos_arquivos` são **preservadas** pelo espelho (boleto registrado no banco continua valendo) e não têm chave estrangeira.
  Retorno: o mesmo arquivo (SHA-256) não é lido duas vezes; liquidação (06, 17, 61) vira recibo na conta da carteira e baixa a parcela,
  e `reservarPagamento` impede recibo em dobro. Juros e multa sempre a partir do dia seguinte ao vencimento (data posterior tira o QR Code).
  Testes: `node teste/teste_cnab.mjs` (exemplos do manual e arquivo-modelo do Portal de Homologação), `python3 teste/teste_boletos.py`
  e `bash teste/teste_v28.sh` (Postgres local).
  **Só parcelas novas**: a aba Emitir mostra só as parcelas criadas a partir de `cfg.cobranca.desde` (padrão 04/11/2026); as anteriores já
  têm boleto emitido fora (PicPay) e só aparecem no aviso. Decisão do Danilo em 04/11/2026.
  **Referência no boleto**: cada parcela tem o campo opcional "Nº da NF"; pela API, a instrução do boleto leva `refBoleto`
  ("REF. O.S. 1887 - NF 131 - PARCELA 1/2", até 75 caracteres) e a NF entra na descrição. A NF não fica na O.S. (é emitida fora do sistema).
  **API de Cobrança** (alternativa ao arquivo, `cfg.cobranca.modo = "api"`): a função `supabase/functions/sicredi` (Verify JWT
  desligado; exige login e `e_admin`) fala com o Sicredi (doc v3.9.1) e guarda os segredos: `SICREDI_API_KEY_SANDBOX`, `SICREDI_API_KEY`
  e `SICREDI_CODIGO_ACESSO` (o agente nunca lê os valores). Ações: `testar`, `teste_completo` (só Sandbox, com os dados de teste fixos
  do Sicredi), `emitir`, `consultar`, `liquidados`, `pdf`, `baixar`. Boleto pela API é registrado na hora (sem remessa) e volta com o
  Pix copia e cola (EMV) em `qr_url`; "Atualizar pagamentos" consulta cada boleto e lança o recibo pelo mesmo `registrarPagamento` do
  retorno. Nunca mandar `dataInicioJuros`/`dataInicioMulta` (o Sicredi tira o QR Code); `tipoJuros`/`tipoMulta` = "PERCENTUAL"
  (o Sicredi recusa "B - PERCENTUAL", formato que só aparece na consulta); a baixa (PATCH) vai com corpo `{}`. Conferido no Sandbox em 04/11/2026. Publicar: colar o `index.ts` no painel do
  Supabase (Edge Functions) e o Danilo clica em Deploy. Testes: `deno run -A teste/teste_sicredi.ts` (Sicredi falso) e
  `python3 teste/teste_boletos_api.py` (tela).
- **Numeração**: vale a do sistema antigo (OS Oficina 3.0). Enquanto o **modo espelho** estiver ligado (Sistema › Importar), cada carga do
  backup antigo apaga e recarrega clientes, veículos, produtos, O.S., recibos, vendas, estoque e contas a receber. Não "proteger" esses dados contra o espelho.
- **Período de transição (dois sistemas em paralelo):** enquanto `cfg.espelhoLegado` não for `false`, o OS Oficina é o sistema oficial e o
  DTCar Gestão é só consulta e treino. **A virada foi em 02/11/2026 (espelho desligado).** A faixa amarela "Período de transição" só aparece
  com o espelho ligado de verdade (`cfg.espelhoLegado === true`, 12/11/2026): sem os Ajustes carregados ela não aparece mais. Toda programação nova respeita isso:
  (a) dado operacional novo (tabela ou coluna com O.S., dinheiro, cadastro ou estoque) entra em `espelho_legado_zerar()` ou é declarado
  preservado, com o motivo, no SQL e no PR; (b) nada pode levar a equipe a achar que um lançamento aqui é oficial nesse período;
  (c) o PR diz em uma linha como a mudança se comporta antes e depois da virada.
- Carga do sistema antigo: código de produto repetido no OS Oficina é resolvido em `js/legado.js` (o mais antigo fica com o número;
  os outros ganham números acima do maior código e a observação "Código no OS Oficina: N"). Nunca depender da sequência do banco, que o espelho zera.
- Estoque: a peça sai quando entra na O.S. e volta se for removida, recusada ou cancelada.
- Garantia de serviço e responsabilidade por peça trazida pelo cliente ficam separadas; nada de cláusula contra o CDC.
- Não inventar preço, torque, pinagem, código de peça ou regra fiscal.

## Programa para Windows (`desktop/`)
- Electron. As telas são as mesmas do site: `desktop/preparar.js` copia os arquivos listados no `sw.js` para dentro do instalador, e o
  programa baixa sozinho as telas novas do site quando há internet (troca só depois que todos os arquivos chegam inteiros).
- O programa novo (instalador) é gerado pelo GitHub Actions (`.github/workflows/programa-windows.yml`) ao criar uma tag `programa-vX.Y.Z`
  com a mesma versão do `desktop/package.json`; o programa instalado se atualiza sozinho pelo GitHub Releases.
- Etapa 1 (feita): abre sempre, sem internet, com a pasta Documentos\DTCar Gestão.
- Etapa 2a (feita): banco SQLite no PC (`desktop/banco.js`, node:sqlite, sem módulo nativo) com réplica de todas as tabelas
  (`js/replica.js`: carga completa, depois só o que mudou por `atualizado_em` + tabela `exclusoes` do `supabase/v13.sql`).
  Sem internet, `js/api.js` (`comBancoDoPC`) lê do banco do PC. Cópia diária do banco em Documentos\DTCar Gestão\banco.
  Espelho do sistema antigo: quando muda `cfg.ultimoEspelho.em`, o banco do PC é zerado e recarregado.
  O banco do PC só vale para leitura depois da 1ª carga completa (`replicaPronta()`, meta `completa:em`); antes disso as leituras
  respondem "sem conexão" e as telas usam a cópia do navegador. Sem internet, falta de perfil nunca vira "aguardando liberação".
- Etapa 3 (alterar O.S. sem internet): `js/alteracoes.js` + `supabase/v15.sql` (função `sincronizar_alteracao_os`).
  No programa com o banco do PC pronto **e o v15 rodado** (marca `v15` no banco do PC, conferida pela réplica), sem internet,
  `api.atualizarOrdem`, `api.salvarItens` e `api.evento` gravam no banco do PC e entram na fila (`js/fila.js`, tipos `alterar_os`,
  `itens_os`, `evento_os`). Com internet gravam no servidor e copiam a linha devolvida para o banco do PC; abrir a O.S. com internet
  copia a O.S. inteira (a base das alterações é o que está na tela). Enquanto a O.S. tem alteração na fila (mesmo em conflito),
  tudo dela vai para a fila, atrás, e ela abre com a versão do PC.
  **Envio:** `api.sincronizarAlteracao` chama a função do v15, que confere e grava numa transação com a O.S. e os itens travados.
  **Regras de conflito** (nada é gravado): carga nova do sistema antigo depois da alteração; O.S. apagada, entregue ou cancelada no
  online; campo que no online não está mais como estava no PC (nem igual ao feito no PC); item alterado/removido no PC cujo conteúdo
  mudou no online; item criado no PC que já existe com outro conteúdo. Base dos itens = conteúdo (não a data). Conflito trava as
  alterações seguintes da mesma O.S. até "Enviar por cima" ou "Descartar desta O.S." (Sistema › Dados no computador).
  **Uma coisa de cada vez:** `comTrava` (alteracoes.js) serializa gravações locais, troca de O.S. pela do online, réplica +
  reaplicação da fila (`replicarComFila`) e a leitura da O.S. com pendência; a fila serializa as próprias mudanças.
  Sem internet NÃO pode: entregar/retirar/receber/fechar (`CAMPOS_ENTREGA`), recibo, fotos/assinaturas, O.S. entregue ou cancelada.
  O.S. nova sem internet continua com número provisório PROV-NN (decisão do Danilo em 31/10; o definitivo é dado pelo servidor ao
  enviar, por ordem de horário). Mexeu na função? Rode `bash teste/teste_v15.sh` (Postgres local; saída esperada em teste/v15_esperado.txt).
- Entrar sem internet (`js/acesso.js`): ao entrar com internet, o aparelho guarda uma conferência da senha (PBKDF2-SHA256, 150 mil
  voltas, sal aleatório; nunca a senha). Sem internet, a tela de entrar confere aqui e abre com a "sessão do PC" (`dtcar-sessao-pc`), que
  não fala com o servidor: a fila só é enviada depois de entrar de novo com internet (faixa "A internet voltou"). "Sair" sem internet
  ou com fila avisa antes. Com "Conectado", o servidor é conferido a cada 30 s (o Windows pode dizer que há rede sem haver).
- Próximo: opção de rede para um 2º PC (só quando a oficina tiver mais de um computador).
- Telas servidas pelo esquema `app://` sempre com `Cache-Control: no-store` (`servir` em `desktop/main.js`): sem isso o "Atualizar agora"
  carregava os módulos .js antigos da memória do Chromium (o programa dizia v25 e rodava a v24 — a carga do espelho falhou assim em 31/10).
  Mexeu na troca de telas? Rode `teste/teste_troca_telas.cjs` (site falso publica v99; confere que o arquivo novo é o que roda).
- Programa e telas são independentes: telas novas chegam pelo site; mudança em `desktop/` exige nova versão do programa
  (`desktop/package.json` + workflow). Telas novas precisam funcionar no programa antigo (testar `window.dtcarDesktop.banco` antes de usar).

## App do sistema para celular / APK (`app/`)

Segundo app mobile (separado do `mecanico/`), para **administrador e consultor**, com as telas **do protótipo aprovado pelo Danilo em 16/11/2026** (Design "App DTCar", gerado por `gen_proto.py`): cabeçalho azul #2f6fb5 com a logo, abas horizontais, título com ícone, cartões com faixa azul, campos grandes, rodapé FIXO com linha azul fina, botão de ação e Início/Ajuda. É uma casca nativa (Capacitor 6 + plugins `@capacitor/app` e `@capgo/capacitor-native-biometric`) que abre o próprio site: `capacitor.config.json` tem `server.url = https://gestao.dtcarcentroautomotivo.com.br/app/`, então **tela nova vai ao ar com o merge na main, sem gerar APK novo**. O APK só precisa ser refeito quando mudar algo nativo (ícone, plugins, permissões, `server.url`).
- `app/app.js` (sem módulos): entrar com e-mail e senha do Supabase (mesma sessão do sistema: mesmo armazenamento), digital, quadro "Entrar com a digital?" e o **botão Voltar do celular** (`ligarVoltar`, plugin App: fecha o quadro aberto → volta ao Início → no Início `minimizeApp`; sem o plugin o Android fecharia o app). Só `admin` e `consultor` ativos em `perfis`; outro papel é barrado e a sessão local encerrada. Depois do login chama `telas.js`.
- `app/telas.js` + `telas.css` (Preact/htm, mesmos módulos do sistema: `js/api.js`, `js/placa.js`, `js/cpf.js`, `js/cep.js`, `js/catalogo.js`, `js/pecas.js`, `js/clientedig.js`, ícones de `js/appmecanico.js`): Início (busca de placa no cabeçalho + 6 botões), **Óleo (aplicação)**, **+ Orçamento** (1. Cliente com CPF/CEP, 2. Veículo pela placa, 3. serviço; grava pelo `orcamento_salvar` com itens vazios e manda incluir os itens na tela do sistema em modo app; cliente só digitado vai na cópia, cadastro na aprovação), **Agendar** (serviço, **calendário do mês inteiro** com feriados em laranja — `feriadosDoAno`: nacionais, Carnaval, Sexta-feira Santa, Corpus Christi, N. Sra. da Penha/ES e aniversário de Colatina 22/08 — e o número de serviços já agendados no dia; "Avisar o cliente pelo WhatsApp" abre a mensagem pronta no padrão da DTCar, quem envia é o Danilo), **Consultar peça por catálogo** (depois da placa, **escolher o sistema** — Freios, Transmissão, Direção, Suspensão, Motor, Outros, `SISTEMAS`/`sistemaDoGrupo` — e só então o resultado; lista para cotar/enviar), **Histórico de serviços**, **Consultar O.S.** (abre a O.S. do sistema em modo app) e Ajuda. **A placa vale só na tela em que foi digitada** (`usarPlaca` é estado da tela; sair sem gravar limpa tudo, inclusive o formulário do orçamento). Placa do cadastro não chama a consulta paga; placa nova usa a função "placa" (básica). CPF fora do cadastro: consulta só do administrador. **Atenção ao htm:** `<img>`, `<br>` e `<input>` precisam de `/>`.
- **Regras do Danilo (16/11/2026):** o app **não abre O.S.** (botão "+ O.S." retirado); O.S. que já existe só é alterada no login do administrador — a tela da O.S. do sistema aberta de dentro do app (`?app=1`, `js/modoapp.js`, só com `window.Capacitor`) usa o papel `leitura` (`perfilNoApp` em `js/telas/ordem.js` e `js/telas/painel.js`). No modo app o menu do PC e a barra de baixo somem, aparece "‹ Início" e o botão Voltar do celular volta uma página (sem página atrás, volta aos botões do app). Telas do sistema só do modo app: `js/telas/pecascatalogo.js` e `js/telas/historico.js`.
- Digital: a leitura vale até fechar o app (`dtcar-app-aberto` em sessionStorage); só a chave de renovação do Supabase vai para o cofre do aparelho, nunca a senha; ao trancar ("Sair" com a digital ligada) a chave vai para o cofre e a sessão sai do aparelho.
- APK de teste: Actions > "App DTCar (gerar APK)" > Run workflow (`.github/workflows/app-apk.yml`; usa `app/montar_www.py`, que leva só a tela "Sem internet" `offline.html`, e `app/preparar_android.py`). Assinatura de depuração: cada geração usa chave nova, então APK novo exige desinstalar o anterior. O arquivo para baixar fica em `app/download/DTCar-app.apk` (botão na aba "App do mecânico"): troque-o e `VERSAO_APP` em `js/telas/appmecanico.js` quando sair APK novo. `sw.js` não intercepta `/app/` nem `.apk`.
- **Etapa 2-B do app (16/11/2026 à noite, branch claude/app-etapa-2b; precisa do `supabase/v60.sql`)**: `agendamentos.mecanico_id/mecanico_nome` (campo "Mecânico que vai mexer" no agendamento do sistema; `api.agenda.salvar` regrava sem a coluna e marca `api.semV60()` se o v60 não rodou) e tabela `servico_apontamentos` (início/pausa/fim do mecânico, itens executados, indicações de responsável; RLS: equipe lê, cada um grava o seu, gestor qualquer um; função `apontamento_visto`; único aberto por pessoa e O.S.). App: telas **Iniciar serviço** (`Servico`, placa → O.S. aberta → iniciar; um em andamento por vez; pausar com motivo; finalizar marcando itens — `api.salvarItens` marca executado na O.S. — e indicando responsável, que vê o aviso com bolinha e OK = `apontamento_visto`; sem O.S. → pedido de orçamento com a placa via sessionStorage `dtcar-app-placa-pedido`), **Agenda** (lista; administrador todos, colaborador só `mecanico_id` dele) e **Meus serviços** (por quinzena). Sistema: Relatórios › "Serviços por colaborador (app)" (`RelColaboradores`, filtro de data e pessoa, tempo desconta pausas). Backup/réplica/restauração incluem `servico_apontamentos`. Testes: `teste/v60_cenarios.sql` (Postgres local via `teste/montar_banco.sh`), `teste_app_sistema.py` (204), `teste_etapa2b_sistema.py` (11), `teste_app_mecanico_admin.py` (50).
- **Etapa 2-A do app (16/11/2026 à noite, PR da branch claude/app-etapa-2a)**: login por **usuário** sem e-mail (`emailDoLogin` em js/appacesso.js: "joao" → joao@app.dtcarcentroautomotivo.com.br, domínio da oficina, conta confirmada na criação; a função `equipe` aceita `login` usuário ou e-mail; telas de entrar do app e do sistema aceitam os dois; Equipe mostra "usuário x"); **horário de uso** por colaborador em Equipe › App do celular (`cfg.appAcessos[id].horario = {de, ate, dias}`, `foraDoHorario`; o app recusa no login e trava a tela se o horário acabar com ele aberto; administrador sem limite); **placa do Início guardada** (sessionStorage `dtcar-app-placa-inicio`, só no Início; some ao limpar ou sair); **Voltar do celular volta uma tela por vez** (pilha de rotas em app/telas.js + `usarPasso` para passos dentro da tela: pedido aberto, sistema escolhido em Peças); **aviso pelo WhatsApp na agenda só para o administrador**, botão pequeno `.zap-mini`; **fotos das peças** no app (`FotoPeca` em app/telas.js lê catalogo/fotos/<pasta>/<foto>.jpg; miniatura e ampliação). Testes: teste_app_sistema.py (171), teste_app_mecanico_admin.py (50), teste_equipe.ts (21).
- **Orçamento pelo app é só um PEDIDO** (pedido do Danilo, 16/11/2026 à tarde): ninguém lança item nem preço no app. Em Orçamentos o mecânico/consultor escreve o que é para orçar e envia (função `supabase/functions/pedido`, ações `novo` e `acrescentar`; qualquer membro, grava com a chave de servidor porque a tabela orcamentos só aceita gestor; marca "Pedido pelo app" em obs_internas). O orçamento aparece no sistema em elaboração com o selo "Pedido pelo app" e no **sino** da barra do sistema (`Sino` em js/telas/topo.js, `api.avisosApp`, lido a cada minuto; visto fica em localStorage `dtcar-avisos-vistos`). Enquanto aberto fica em "Orçamentos abertos" no app, com "Acrescentar ao pedido"; aprovado no sistema, quem pediu vê o aviso "virou a O.S. nnnn" no app (`avisosDe`, visto em `dtcar-app-vistos`). Na O.S. em andamento, "Acrescentar itens a orçar" grava um evento tipo `a_orcar` (api.evento, pela sincronização) e também cai no sino. Início: a placa mostra a situação do carro (O.S. e orçamentos abertos, histórico). **Nenhuma tela do app abre o layout do sistema** (sem links `?app=1`): a O.S. é vista no `OSDetalhe` do app, sem preço para quem não tem verValores. Ícone do APK = logo branca sobre o azul #2f6fb5 (`app/icone.png`). Publicar `pedido` com "Verify JWT" desligado; sem ela a tela avisa. Testes: `deno run -A teste/teste_pedido.ts`, `teste_app_sistema.py`, `teste_avisos_app.py`.
- **Login e senha do colaborador criados pelo sistema** (pedido do Danilo, 16/11/2026): Sistema › Equipe › "+ Criar acesso" (nome, e-mail, senha com "Gerar", papel) e "Trocar senha" em cada pessoa, pela função `supabase/functions/equipe` (só administrador, conferido por `e_admin`; `auth.admin.createUser` já confirmado + nome/papel em `perfis`; `updateUserById` para a senha; a própria senha não é por ali). A senha nunca é guardada nem registrada. Publicar com "Verify JWT" desligado; sem a função publicada a tela avisa. `api.equipe.criar/senha` em `js/api.js`. Testes: `deno run -A teste/teste_equipe.ts` e `python3 teste/teste_app_mecanico_admin.py`.
- **Quem entra e o que vê é definido pelo administrador em Sistema › Equipe** (pedido do Danilo, 16/11/2026): bloco "App do celular" em cada pessoa — chave entra/não entra e as telas marcadas — gravado em `cfg.appAcessos[id]` (tabela config, sem SQL; `js/appacesso.js`: `acessoApp(cfg, perfil)`, `TELAS_APP`). Sem nada gravado vale o padrão do papel: administrador e consultor entram com todas as telas, mecânico não entra; mecânico liberado consulta sem ver valores (papel `leitura_sem_valores` em `perfilNoApp`) e nunca ganha + Orçamento (`telasDoPapel`). O app lê `config` no login (`app/app.js`) e de novo ao carregar os dados (`app/telas.js`): Início, abas e rotas mostram só as telas liberadas; tela não liberada cai no Início. Vale na próxima vez que a pessoa abrir o app.
- Sem SQL novo. Testes: `python3 teste/teste_app_sistema.py` (Supabase de mentira: login, digital, as telas gravando, Voltar) e `python3 teste/teste_app_modo.py`. Versão do app: `version` em `app/package.json` e `VERSAO` em `app/app.js`.

### Diagnóstico OBD pelo adaptador ELM327 (18/11/2026, etapa 1 de 3, sem SQL)
- **Pedido do Danilo:** cada mecânico lê o carro em que está mexendo pelo próprio celular, sem depender do Raven, que é um só e vira fila. O Raven continua para o que só ele faz (programação, atuação e as marcas que ainda não cobrimos).
- **Etapa 1 = SÓ LEITURA.** Nada é gravado no banco e **nada é escrito no carro**. A gravação na O.S. é a etapa 2 e precisa de SQL novo (`obd_leituras`).
- **ARMADILHA, leia antes de criar qualquer plugin nativo:** o `app/.gitignore` tinha `android/` **sem barra inicial**, e isso engolia também `app/plugins/obd/android/` — o plugin inteiro ficou fora do primeiro commit e o `npx cap add android` quebrava com ENOENT num clone limpo, derrubando a geração do APK. Agora é `/android/`, que ignora só o `app/android/` gerado. Qualquer plugin local novo depende disso.
- **Esta é a primeira tela do app que depende de parte NATIVA.** O ELM327 fala Bluetooth clássico (perfil serial, SPP) e isso não existe dentro do WebView, então **exige APK novo** (`app/package.json` 1.5.0, `VERSAO` em `app/app.js`). O APK é de depuração: **desinstalar o anterior antes de instalar**. Depois do plugin dentro, as telas voltam a chegar pelo site, como o resto do app.
- **Plugin local `app/plugins/obd/`**, declarado em `app/package.json` como `"dtcar-obd": "file:plugins/obd"`. A pasta `app/android/` é criada a cada build, então código nativo solto seria apagado: plugin é o único jeito que sobrevive. Conferido: `npx cap add android` acha 3 plugins (`@capacitor/app`, biometria e `dtcar-obd`) e escreve `include ':dtcar-obd'` no `capacitor.settings.gradle`.
- **Em Java, não Kotlin**, porque o projeto Android gerado é Java puro e trazer o toolchain do Kotlin só por causa deste plugin arriscaria a geração do APK.
- **SEGURANÇA — lista branca no NATIVO (`SERVICOS_LEITURA` e `AT_PERMITIDOS` em `ObdPlugin.java`).** O app abre um SITE, então todo método do plugin fica alcançável por qualquer script daquela página: sem a lista, um `Capacitor.Plugins.DtcarObd.comando({cmd:'04'})` apagaria as falhas do carro. Passam só os AT que o app usa e os serviços de LEITURA (01, 02, 03, 06, 07, 09, 0A). O **04 (apagar falha) está fora de propósito** — quando a etapa 2 trouxer o apagar com registro de quem apagou, ele entra aqui junto da regra de permissão. O comando é **normalizado antes de ser conferido E enviado** (`normalizar`), então o que foi aprovado e o que vai ao carro são o mesmo texto. Teste: `bash teste/teste_obd_java.sh` (55 conferências; compila o plugin com stubs do Android e as fontes de verdade do Capacitor, porque aqui não há SDK).
- **Permissão: só `BLUETOOTH_CONNECT`** (manifesto do próprio plugin, que o Android junta ao do app; as antigas com `maxSdkVersion="30"`). **Não pedir `BLUETOOTH_SCAN`:** o app não procura aparelho, usa os já pareados nos Ajustes do Android (`getBondedDevices`), e pedir scan faria o Android escrever "determinar a posição de aparelhos próximos" no aviso, assustando o mecânico por nada. Nenhuma permissão de localização. O teste confere a lista exata de permissões declaradas.
- **A parte nativa é burra de propósito:** só abre o Bluetooth, manda uma linha e devolve o que o adaptador respondeu até o sinal de pronto (`>`). Métodos: `permissao`, `pedirPermissao`, `listar`, `situacao`, `conectar`, `comando`, `desconectar`. Uma conexão por vez e comandos em fila. Campos compartilhados são `volatile`, os streams são copiados para variáveis locais dentro da tarefa, e **toda tarefa da fila é embrulhada em `naFila`**: qualquer falha inesperada REJEITA a chamada, senão a promessa do JavaScript nunca terminaria e a tela ficaria em "Lendo as falhas…" para sempre. O `js/obd.js` ainda põe um tempo-limite próprio por cima, como rede de segurança.
- **Quem entende de OBD é `js/obd.js`**, no site. Por isso quase tudo é testado sem celular e sem carro, e melhorar a interpretação **não exige APK novo**.
- **UMA LINHA POR MÓDULO, nunca colar tudo (o defeito mais grave que a revisão pegou):** num carro com motor e câmbio no barramento o ELM327 imprime uma linha por módulo. Colar as linhas num hex só fazia o começo da resposta do segundo módulo ser lido como dado do primeiro, e saíam **códigos de falha que não existem no carro** (`4300` + `430201710300` produzia P0043, P0201 e C3103). Agora `juntarLinhas` devolve `respostas` (uma por módulo; só os pedaços numerados `0:`/`1:` são juntados, porque são de um módulo só), `dadosDa` exige que o serviço esteja no **começo** da resposta, `codigosDeTodas` junta os códigos de verdade de cada módulo e a tela avisa quando mais de um respondeu. Num laudo de oficina, inventar código é o pior defeito possível.
- **ANDAR NAS FAIXAS:** o pedido `0100` só cobre os PIDs $01–$20 e o `0600` só os MIDs $01–$20; a última posição de cada faixa é o aviso de que existe a seguinte. Sem andar (`suportadosEmFaixas`), a tensão do módulo ($42) e as distâncias desde o apagamento ($21 e $31) nunca apareceriam, e os testes de bordo nunca chegariam ao catalisador (de $21 em diante). O teste do app confere que os comandos `0120`, `0140`, `0142` e `0131` realmente saem.
- **O que lê:** falhas dos serviços 03/07/0A com a situação sempre escrita; dados ao vivo (lista `PIDS`, só os que o carro informa ter) **girando sem parar**; chassi (09 02) confrontado com o do cadastro, lido da ficha do veículo porque a busca por placa não carrega esse campo; prontidão dos monitores (01 01), o detector de "falha apagada antes de o carro chegar"; a foto do momento da falha (serviço 02, só os PIDs que o carro tem — senão são 15 pedidos de 4 s para dar NO DATA); e os testes de bordo (serviço 06).
- **DADOS AO VIVO GIRAM DE VERDADE (pedido do Danilo, 19/11/2026):** uma leitura por toque não é "ao vivo" — para ver o motor trabalhando (temperatura subindo, borboleta abrindo, ajuste de combustível corrigindo) o valor tem de mudar na tela sozinho. `lerAoVivoSeguido` fica dando voltas na lista até o mecânico mandar parar, e **avisa cada valor na hora em que ele chega**, não no fim da volta, senão a tela daria saltos de 12 leituras. Três regras que nasceram do uso: PID marcado `vivo: false` (distâncias e aquecimentos desde o apagamento) é lido **só na primeira volta**, porque não muda com o carro na rampa e cada pedido rouba tempo de quem muda; PID que falha duas vezes (`PACIENCIA`) sai da roda, senão um PID mudo derrubaria o ritmo para sempre; tempo-limite curto (`ESPERA_VIVO`, 1,5 s) e um respiro entre voltas (`PAUSA_VOLTA`). Quem manda parar é a caixa `rodando` (um `useRef`, **não** estado: a função já começou e continuaria lendo o valor antigo do estado, nunca parando). Para ao desconectar e ao sair da tela. Enquanto gira, os outros botões ficam travados — o adaptador atende um pedido por vez. O teste do app prova o essencial: o adaptador de mentira devolve uma rotação que sobe a cada leitura, e o teste confere que **o número na tela muda sozinho**, sem tocar em nada, e que depois de parar ele para de mudar.
- **PAINEL OU LISTA, por filtro (pedido do Danilo, 19/11/2026: "o bom é ter as duas opções e escolher através de um filtro"):** o painel são mostradores de scanner (`Mostrador` em `app/telas.js`): arco de 270° em SVG com o número grande dentro, dois por linha no celular, com o começo e o fim da escala escritos no pé. A escala de cada PID (`de`/`ate` na tabela `PIDS`, levados adiante por `valorPid`) é só para desenhar o ponteiro — **não é faixa de normalidade e a tela não diz se o valor é bom ou ruim**: isso depende do motor e inventar seria pior que não mostrar. Por isso o arco é sempre azul, nunca verde/vermelho. **O rótulo é sempre escrito**, como o nome da etapa da O.S.: quem lê está embaixo do carro, com pressa. PID sem escala (as distâncias desde o apagamento) não vira mostrador: fica em lista embaixo. A LISTA é a tela antiga, com todos os valores em linha. A escolha fica guardada no aparelho (`localStorage`, `obd_jeito`): quem gosta de um não quer trocar a cada carro.
- **ESCOLHER O QUE APARECE, UMA LEITURA POR VEZ E FALHA VIGIADA (pedido do Danilo, 19/11/2026).** Quatro coisas numa só mudança:
  (1) **Quem decide o que aparece é o CARRO.** A lista que ele responde em `0100`/`0120`/`0140` é a palavra final: nenhuma consulta de placa sabe
  quais sensores aquele módulo expõe. A placa serve para outra coisa — `tipoDeMotor` (do combustível do cadastro) só ORDENA os grupos e evita
  oferecer, antes de ligar, o que não existe naquele motor (num flex não se oferece rail nem DPF; num diesel não se oferece sonda nem cânister).
  (2) **Grupos** (`GRUPOS` em `js/obd.js`, campo `grupo` em cada PID): Motor, Ar e admissão, Combustível, Sondas, Catalisador, Injeção/EGR/turbo,
  Tanque e cânister, Elétrico, Contadores. `leiturasPara(suportados, escolhidos)` e `gruposPara(suportados, combustivel)` resolvem tudo num lugar só.
  (3) **Filtro com caixas** (`#obd-escolha`): marcar o que ver agora ou "TODAS AS QUE O CARRO TIVER". A escolha fica **por placa** no aparelho
  (`localStorage`, `obd_leituras_<PLACA>`), junto com o que aquele carro respondeu (`obd_suportados_<PLACA>`, só para montar o filtro antes de ligar).
  Marcar nunca ACRESCENTA o que o carro não tem — só reduz.
  (4) **Uma leitura por vez na tela:** `res` virou `{ o, d }`. Abrir falhas tira os dados ao vivo da frente e para a roda; cada leitura nova troca a
  anterior em vez de empilhar cartão. Os outros botões não ficam mais travados durante a roda: eles a interrompem.
  (5) **Falha vigiada durante a leitura ao vivo:** a cada `VOLTAS_ATE_FALHA` (8) voltas a roda pergunta `03` sem parar (um pedido contra as 12 da
  volta) e chama `aoFalhas`. Apareceu código, o botão de falhas fica **vermelho** com a contagem; código que não existia quando a roda começou é
  "FALHA NOVA AGORA". A referência é a leitura de falhas anterior, se houve; senão a primeira olhada vira a referência. Falha que nasce com o motor
  trabalhando é justamente a que interessa, e antes ela só apareceria se alguém lembrasse de abrir a tela de falhas.
  Teste: o adaptador de mentira ganha `window.__obd.falhaNova` e o teste confere o botão ficando vermelho, o código aparecendo e o botão voltando ao normal.
- **40 LEITURAS NOVAS (19/11/2026, pedido do Danilo: "quero todas as leituras possíveis").** De 15 para 55. Todas com a fórmula conferida contra a
  tabela do J1979 e com um teste de valor que um mecânico reconhece (rail a 500 bar, catalisador a 450 °C, odômetro em 150.000 km), para conta
  errada doer no teste e não no laudo. As que entraram: **velocidade**; carga absoluta; temperatura do óleo; torque pedido, entregue e de
  referência; borboleta relativa, absoluta B e C, comandada pelo módulo, pedais D, E, F e relativo; pressão barométrica; temperatura do ar de fora;
  **ajuste curto e longo do banco 2** (só havia o banco 1); mistura comandada (lambda); pressão de combustível; nível do tanque; **etanol no
  tanque**; **temperatura do catalisador nos quatro pontos**; **pressão do rail** (gauge, absoluta e sobre o vácuo); **tempo de injeção** (não
  confundir com o avanço de ignição, que já havia); consumo em L/h; EGR comandada e erro da EGR; purga do cânister; pressão de vapor do tanque
  (duas escalas, **com sinal** — vácuo é negativo); tempo com a luz acesa e desde o apagamento; **odômetro do módulo** (4 bytes).
  **FAIXAS ATÉ $C0:** `FAIXAS_PID` passou de `[00,20,40,60]` para `[00,20,40,60,80,A0,C0]`, senão o odômetro ($A6) nunca apareceria. Andar não
  custa: a varredura para na primeira faixa que não avisa a seguinte.
  **O grupo "diesel" virou "Injeção, EGR e turbo", sem restrição de combustível:** o PID da pressão do rail é "diesel OU gasolina de injeção
  direta", e EGR e turbo existem nos dois. Restringir por combustível esconderia leitura que o carro tem.
  Conferências novas no `teste_obd.mjs`: a conta de cada PID tem de caber nos bytes que ele declara (ler `d[2]` num PID de 2 bytes daria NaN no
  carro e a leitura sumiria da tela sem motivo aparente), escala completa ou ausente, fim maior que o começo e nenhum rótulo repetido.
- **UM PEDIDO, VÁRIOS NÚMEROS — sondas e temperatura do escape (19/11/2026).** A sonda manda lambda E tensão na mesma resposta, e a temperatura do
  escape manda até quatro sensores. Por isso `valorPid` passou a devolver uma **LISTA** de leituras em vez de uma só, e a tabela aceita `partes`;
  cada leitura ganha `chave` (pid × 100 + a posição), que é por onde a tela identifica cada mostrador. PID simples devolve lista de um.
  `partes` aceita `quando(dados)`: a parte só existe se o próprio carro disser que existe — é assim que a sonda com `0xFF` no segundo byte (não
  entra na conta do ajuste) e o sensor de escape ausente **somem em vez de virar zero**.
  O que entrou: **sondas de banda estreita** ($14–$1B: tensão A÷200 e o ajuste daquela sonda), **sondas de banda larga** ($24–$2B: lambda e
  tensão) e a **temperatura dos gases de escape** ($78/$79, 9 bytes, o primeiro é o mapa de quais dos quatro sensores existem). Plantas de bytes
  conferidas contra o J1979. Total: 73 PIDs, 95 leituras possíveis.
  **O QUE NÃO ENTROU, E POR QUÊ:** rotação do turbo ($74), pressão de escape ($73), temperatura do intercooler ($77), pressão do DPF ($7A/$7B),
  temperatura do DPF ($7C) e NOx ($83). A fonte pública dá só o tamanho em bytes, **sem a planta de bytes nem a fórmula** — e o $7C tem 9 bytes
  como o escape, onde o primeiro byte é mapa de sensores, então aplicar "(256A+B)/10−40" daria temperatura errada. Inventar aqui é pior que não
  mostrar: entram quando conferirmos contra o Raven num carro que os tenha.
  **Vírgula decimal:** os valores saíam com ponto ("3.14 g/s"). `numBR` no `app/telas.js` escreve do jeito daqui, no mostrador, na lista e na
  foto da falha.
  **Escala do lambda comandado corrigida:** ia de 0,7 a 1,3, e um valor de corte (1,5) encostaria no fim do arco como se fosse o máximo. Agora 0 a 2.
- **Lista de dados ao vivo redesenhada (19/11/2026):** a visão LISTA deixou de ser "rótulo: valor" e virou `LinhaViva` — separada por grupo, com o
  valor grande à direita e uma barra fina mostrando a posição na escala (a mesma `de`/`ate` do mostrador; continua sem dizer se é bom ou ruim).
- **Serviço 06, honestidade e sinal:** na tabela de escalas do J1979 os identificadores de **$80 em diante são valores COM SINAL** — lendo tudo como sem sinal, um valor negativo virava ~65000 e o passou/não passou **invertia**. `comSinal`/`inteiro16` tratam isso. A escala para mostrar em unidade de verdade só existe onde está conferida (`ESCALAS`); o resto aparece como número cru, sem unidade inventada, e pode crescer conferindo contra o Raven. Mesma regra nos nomes: `nomeMid` só nomeia sonda ($01–$08) e catalisador ($21–$24).
- **O que NÃO sai por aqui, escrito na tela:** ABS, airbag, câmbio e imobilizador (protocolo próprio de montadora), quilometragem de painel (não existe no OBD-II) e qualquer atuação ou programação.
- **Tela:** `Obd` em `app/telas.js` (rota `#/obd`, botão no Início e aba), liberável por pessoa em Sistema › Equipe (`obd` em `TELAS_APP` de `js/appacesso.js` — são 10 telas agora). Sem o plugin (navegador ou APK antigo) a tela explica que precisa do APK novo em vez de quebrar. Sair da tela desconecta o adaptador.
- **Hardware:** comprar vLinker ou OBDLink. Os ELM327 "v1.5" baratos são clones com firmware quebrado: perdem conexão e dão leitura errada, o que num laudo é pior que não ter laudo.
- **Período de transição:** não cria tabela nem dado operacional e não grava nada, então se comporta igual antes e depois da virada.
- Testes: `node teste/teste_obd.mjs` (145, interpretação, com respostas de adaptador de verdade e torcidas), `bash teste/teste_obd_java.sh` (55, lista branca + compilação do plugin; precisa de `cd app && npm ci`) e `python3 teste/teste_app_sistema.py` (309, adaptador ELM327 de mentira que responde como um de verdade, com dois módulos e as faixas de PID; confere que nada é gravado e que nenhum comando de escrita sai). **Não há SDK do Android no ambiente de desenvolvimento:** o `gradlew assembleDebug` só roda no Actions, que é a primeira compilação de verdade do APK.
- **Ainda não feito:** gravar na O.S. e no histórico do veículo (etapa 2, com `obd_leituras`); leitura de entrada e de saída como prova do reparo e impressão no orçamento e no O.S. Recibo (etapa 3); leitura de ABS/airbag/câmbio por UDS em sessão default, começando por Chevrolet, que é um terço do pátio (etapa 4); apagar falha, com registro de quem apagou (entra junto na lista branca do nativo).

## Como trabalhar
1. Crie uma branch (`codex/assunto` ou `claude/assunto`) e abra um Pull Request para a `main` explicando em português o que muda para a oficina.
   Não faça push direto na `main` sem o Danilo pedir.
2. Mudança no banco: crie o próximo `supabase/vNN.sql`, idempotente (`if not exists`, `create or replace`), com comentários.
   **O Danilo é quem roda o SQL** no SQL Editor do Supabase. O site precisa continuar funcionando antes de o SQL ser rodado (verifique a coluna/tabela e mostre um aviso, como `api.temV12()`).
3. Criou ou renomeou arquivo em `js/`, `css/`, `icons/` ou `vendor/`? Rode `python3 tools_sw.py` (atualiza a lista do `sw.js` e a versão do cache).
   Arquivo fora da lista quebra a abertura sem internet.
4. Teste antes de pedir aprovação: `python3 teste/teste_fluxo.py` (Playwright com dados simulados de `teste/mock.js`; não toca no banco real).
   Funcionalidade nova ganha verificação nesse teste ou em um novo arquivo em `teste/`.
   Mexeu em rede, modo sem internet ou cópia local? Rode também `python3 teste/teste_rede.py` (camada real do Supabase contra servidor falso local que "pendura").
   Regra de rede: toda chamada ao servidor passa por `fetchComLimite` (tempo-limite, sem repetição); sem internet, as telas usam a cópia do aparelho
   na hora ou mostram "precisa de internet" (`SO_ONLINE` em `js/app.js`). Nenhuma tela pode ficar em "Carregando…" sem fim.
   Mexeu no banco do PC (`desktop/banco.js`, `js/replica.js`, `comBancoDoPC`, `js/alteracoes.js`, `js/fila.js`)? Rode também
   `xvfb-run -a desktop/node_modules/electron/dist/electron teste/teste_banco_pc.cjs --no-sandbox` (programa real contra Supabase falso).
   Mexeu em `desktop/`? Rode também `xvfb-run -a node teste/teste_programa.js` (abre o programa sem internet), depois de `npm install` e `node preparar.js` em `desktop/`.
5. Não mexer em `CNAME`, nas configurações do GitHub Pages, nem nos segredos do repositório.
6. Revisão cruzada: quando um agente faz a mudança, o outro revisa o PR (regras acima, textos em português, teste passando) antes do Danilo aprovar.

### Compras — preço por fornecedor pela placa, carrinho e pedidos (v59 + v165, pedido do Danilo em 16/11/2026) — etapa 1
- **Ideia do Danilo:** pesquisar a peça pela PLACA do carro (essencial) ou pelo código/descrição, ver o preço de cada fornecedor numa tela só para
  comparar, pôr no carrinho e, ao comprar, o carrinho vira **um pedido por fornecedor**, que ele finaliza em cada fornecedor depois (site, WhatsApp
  ou vendedor). O sistema **não compra nada sozinho** e **não mexe em estoque, O.S. nem financeiro**: a peça entra pela nota (Notas da SEFAZ) e a
  conta pelo boleto, como sempre. Ele quer os fornecedores integrados por **webservice**; a consulta automática entra fornecedor por fornecedor nas
  próximas etapas, quando cada um liberar o acesso (a lista dos fornecedores do 1º lote ainda não foi dada).
- **Tela `js/telas/compraspecas.js`** (`#/compras`, menu Operação e "Mais"; administrador e consultor — `verValores`; precisa de internet): abas
  Pesquisar peça | Carrinho | Pedidos. A pesquisa usa o acervo de peças (`js/pecas.js`: `pecasDoVeiculo` + `agruparEquivalentes`) e a placa do
  jeito da tela de óleo (placa do cadastro sem custo; fora do cadastro, a função "placa" básica). Cada peça mostra **uma linha por fornecedor e
  código** (`ofertasDaLinha` em `js/compraspecas.js`): preço, estoque e prazo no fornecedor, **origem e data** ("Ao vivo" = webservice, só o
  servidor grava; "Informado" = o Danilo digitou o que o vendedor passou; "Última compra" = `produto_fornecedor.ultimo_custo ÷ fator` das notas).
  **Menor preço** = o mais barato entre os preços atuais (informado/ao vivo há até `DIAS_ATUAL` = 7 dias e sem "sem estoque"); preço mais velho
  vem marcado "há N dias: confirme" e a última compra é só referência. Regras puras em `js/compraspecas.js` (sem window/document).
- **Banco (`supabase/v59.sql`):** `compras_fornecedores` (conexão: tipo webservice/portal/sem_integracao, endereço https, usuário; `situacao`/`detalhe`
  só o servidor muda), `compras_precos` (único por fornecedor + `codigo_norm`; digitado pela tela vira sempre `manual` com a data de agora),
  `compras_carrinho`, `compras_pedidos` (numeração própria `compras_pedido_numero_seq`, restauração empurra a sequência; a tela só muda situação,
  nº no fornecedor, motivo e obs) e `compras_pedido_itens`. Funções: `compras_gerar_pedidos(ids)` (carrinho → um pedido por fornecedor numa
  transação, itens travados), `compras_pedido_voltar(id)` (itens voltam ao carrinho; o pedido fica cancelado "Voltou para o carrinho"),
  `compras_gravar_acesso(conexao, senha)` e `compras_acessos()` (só administrador). **A senha/chave do fornecedor fica em `segredos`
  (`compras_acesso:<id>`), que ninguém do sistema lê, e NUNCA volta para a tela, o backup, o banco do PC ou o conector**; apagar a conexão apaga a
  senha. Situações do pedido: `a_finalizar` → `finalizado` (quem/quando, nº no fornecedor) ou `cancelado` (motivo obrigatório, não volta).
  Tabelas **preservadas** pelo espelho (não existem no OS Oficina); backup, restauração, banco do PC e `exclusoes` incluídos; o `agente_leitura` lê
  (das conexões, sem o usuário). O site funciona antes do SQL: a tela e o cartão dos Ajustes só avisam "rode o v59".
- **Ajustes › Fornecedores conectados** (`CartaoFornecedoresConectados`, só administrador): conectar fornecedor do cadastro, tipo, endereço,
  usuário e senha (campo volta vazio; mostra só "guardada em <data>"; "Apagar a senha guardada"). **Texto do pedido** (`textoPedido`): no padrão
  das mensagens do Danilo (saudação "Sr.", itens em tópicos •, assinatura, `*Mensagem gerada pelo sistema Gestão DTCar*`), com "Abrir no WhatsApp"
  pelo telefone do cadastro do fornecedor — quem envia é o Danilo.
- Testes: `bash teste/teste_v59.sh` (banco inteiro) e `python3 teste/teste_compras.py` (PC 1366 e 1280, celular; sem o v59; mecânico).
  Menu lateral: em 1280x720 já não cabia antes (731 px); a regra continua 1366x768.
- **Etapa 2 — consulta AO VIVO nos portais (`supabase/functions/compras`, v177, pedido do Danilo em 16/11/2026: "automatizar a entrada no sistema de
  forma que o sistema faça a pesquisa e me dê o resultado usando o meu login", sem pedir API a ninguém). Sem SQL novo.** Os fornecedores do 1º lote
  (Rolemar Master, DPK, Toli, Pellegrino) usam o mesmo sistema de portal B2B e não têm webservice; os quatro foram **mapeados em 16/11/2026 com o
  login do Danilo no navegador** (rotas no topo do `compras/index.ts` e no documento "Compras — fornecedores"). **O robô é reconhecido pelo
  ENDEREÇO cadastrado em Ajustes** (`roboDaConexao` em `js/compraspecas.js` = `roboDe` na função): `dpk` (API JSON do portal: login por e-mail/senha
  → token; a chave pública `x-api-key` é lida do JS do próprio site a cada login), `rolemar` (formulário `/ajax-login` com usuário = CNPJ, sessão em
  cookie, filial `cod_emp`), `pellegrino` (login JSON, busca em HTML + JSON de preços; sem quantidade: "Me avise" = sem estoque) e `toli` (Oracle
  APEX com SMS no 1º acesso: fica para o robô do **programa do PC**, ainda não feito; o campo do código SMS entra junto). A senha vem de `segredos`
  (`compras_acesso:<id>`, v59) e a **sessão aberta** (token/cookies) fica em `segredos` (`compras_sessao:<id>`), só a função lê, com a chave de
  servidor; sessão vencida → entra de novo UMA vez; senha recusada → conexão "erro" com orientação e sessão apagada (nunca fica tentando); sessão
  de conexão apagada é removida na consulta seguinte (`limparSessoes`). **Ritmo de gente:** uma consulta por clique, no máximo `MAX_TERMOS` = 6
  códigos, nunca varredura. O que volta é gravado em `compras_precos` com origem `ao_vivo` e `consultado_em` (a tela mostra "Ao vivo · data e
  hora"; o gatilho do v59 não interfere porque a função grava com a chave de servidor) e a situação da conexão é atualizada (`ok`/`erro` + detalhe).
  Ações: `consultar { termos, conexoes? }` (administrador e consultor) e `testar { conexao }` (só administrador; login novo + busca de teste, sem
  gravar preço). Tela: botão **"Consultar fornecedores"** em cada peça (`.cp-consultar`, manda `termosDaLinha`: código da peça, equivalentes e
  montadora) e, sem placa, `#cp-consultar-livre` com o texto digitado; o resumo (`resumoAoVivo`) aparece na peça. Ajustes: robô reconhecido ao
  digitar o endereço (`#cp-cx-robo`), linha da conexão com o robô e **"Testar conexão"** (`.cp-testar`). Sem fornecedor com portal reconhecido, o
  botão não aparece. Publicar: colar o `compras/index.ts` no painel do Supabase ("Verify JWT" desligado; sem segredo próprio). **Os portais de
  verdade não são alcançáveis do ambiente de desenvolvimento** (DPK e Pellegrino respondem 403 ao proxy): a primeira consulta real é feita em
  produção com o login do Danilo em Ajustes — conferir contra `teste/teste_compras_funcao.ts` (portais de mentira no formato mapeado).
  Testes: `deno run -A teste/teste_compras_funcao.ts` (50) e `python3 teste/teste_compras.py` (função de mentira no `mock.js`, PC e celular).
- **Aba Fornecedores (v178, pedidos do Danilo em 17/11/2026): "não quero que a pesquisa seja no meu sistema, quero que pesquise a peça no fornecedor".**
  A tela Compras abre na aba **Fornecedores** (`Cotacao` em `js/telas/compraspecas.js`; a aba do acervo saiu de Compras — o acervo de peças fica só
  dentro da O.S., em "Peças deste veículo"). O que for digitado (código ou descrição) vai COMO ESTÁ para a busca de cada portal (`termos: [texto]`),
  com `placa` e `veiculo` junto (os portais que buscam por placa vão usar quando esse passo for mapeado; hoje vale o texto). O resultado é UMA
  tabela no jeito do protótipo — Fornecedor | Código | Preço | Estoque | Prazo | Origem | Carrinho — montada por `linhasCotacao` em
  `js/compraspecas.js`: ao vivo (resposta da função) + preços informados dos mesmos códigos como referência; **só entra resultado com estoque
  disponível** (estoque 0 fica de fora e é contado; última compra das notas não entra; estoque em branco = "disponível", caso do Pellegrino que
  só diz quando NÃO tem). Fornecedor que não respondeu aparece na tabela com o motivo (senha recusada, Toli pelo PC, sem resultado).
  **Fichinha de cada fornecedor conectado** (`SituacaoFornecedores`, `#cot-situacoes`): verde = Conectado (logado), vermelho = Com erro (com o
  motivo), cinza = aguardando a primeira consulta / portal não reconhecido, azul = pelo programa do PC. `detalheLegivel` troca a hora ISO do
  detalhe pelo horário de Brasília (a função passou a gravar `horaBR`). Carrinho resumido ao lado (PC largo) ou embaixo, com "Gerar pedidos por
  fornecedor" (vai para a aba Carrinho). Celular: tabela empilhada. **v181 — peça pelo carro da placa (pedido do Danilo em 17/11/2026: "quero que elas me entreguem a peça que estou pedindo pelo
  modelo que a placa do carro informa"):** a tela manda `placa` e `veiculo` (marca, modelo, motor e ano do cadastro ou da consulta).
  **DPK** (mapeado em 17/11/2026): placa → `productSearch/plate` (texto do carro) → listas do catálogo `api-external/api/superk/filter`
  (Type=2 montadoras, Type=3&ManufacturerId= veículos, Type=5&ManufacturerId=&VehicleId= motores) → `dpkCasarCarro` acha montadora, veículo
  (palavra inteira; o nome mais completo vence: ONIX PLUS antes de ONIX; GM/VW viram CHEVROLET/VOLKSWAGEN), ano e motor (cilindrada + diesel/
  flex/turbo; empate = sem motor) → `productSearch` com `CarMakerId`, `VehicleId`, `Year`, `EngineId` (ex.: "pastilha" cai de 1.500 para 16 na
  Toro 2020 diesel). O carro casado fica na sessão (`carros[placa]`). **Código de peça (`ehCodigo`: sem espaço, com número) vai SEM o filtro**
  (código é exato e o filtro zera). A resposta traz `veiculo` (o carro filtrado) ou `sem_carro` (portal que ainda não filtra); a tela mostra
  `#cot-carro`. Rolemar e Pellegrino/Sama: ainda sem o filtro do carro.
  **v179 (pedidos do Danilo em 17/11/2026, de manhã):** placa fora do cadastro na aba Compras: 1º o modelo de graça pelo portal com login (ação `placa` da função: DPK `productSearch/plate`, depois Rolemar `/ajax-busca-placa`); só se nenhum portal conhecer, a consulta paga de sempre.
  resultado no estilo da pesquisa da DPK — CARDS com foto da peça, "Fabricante:", "Cód. de fábrica:", estoque em verde e "Adicionar", visão
  **Cards | Lista** e tamanho **Pequeno | Médio | Grande** (guardados no aparelho, `dtcar-compras-cot`), filtros por fornecedor e por marca da
  peça; cor fixa por fornecedor (`corDoFornecedor` em `js/compraspecas.js`) nos cards, nas linhas e nas fichinhas. A função devolve `foto`
  (DPK: nome do arquivo → CDN `cdn-superk.azureedge.net/img/`; Rolemar: `imagens`; Pellegrino: `<img>` da página; só https) e `extra`
  (DPK: `productId` + `sapCode`, os códigos internos do portal). **Carrinho do portal (mapeado em 17/11/2026):** ação `carrinho_portal`
  da função — DPK: `GET dpk-order/api/cart/getByFilter` + `POST dpk-order/api/cart` (o carrinho inteiro vai no corpo; item repetido soma a
  quantidade; o sistema NUNCA remove nem fecha pedido no portal). No "Pôr no carrinho" de um preço ao vivo, a caixa "Pôr também no carrinho
  do portal" (marcada) chama a ação; falha vira aviso, o item fica no carrinho do sistema do mesmo jeito. Rolemar/Pellegrino: ainda não
  mapeados (a ação responde "ainda não está pronto"). **Ainda não feito:** carrinho do portal da Rolemar e do Pellegrino (precisa de um
  clique do Danilo em cada portal para gravar a rota); busca por placa dentro de cada portal; robô da Toli no PC.

### Quadro "Óleo e filtros" recolhido na página do veículo (15/11/2026, v138)
- Com ficha gravada, o card começa recolhido: só a linha de cima (litros, viscosidade, selo) e o botão "Mostrar/Ocultar" (`#fo-alternar`). O corpo (`#fo-corpo`) com filtros, "Refazer ou editar" e "Confirmar" só existe aberto. Sem ficha, o card continua como antes. Vale para PC e celular (é o mesmo componente).

### "Corrigir pela placa" na página do veículo (15/11/2026, v142, sem SQL)
- Botão `#vei-corrigir-placa` ao lado de "Imprimir ficha" (`js/telas/corrigirplaca.js`, só quem tem "cadastrar"). Pergunta antes (a consulta completa custa R$ 0,20 se o sistema não tiver a cópia), chama a função `placa` (`completa`; cadastro que já tem chassi e Renavam pergunta de novo antes de pagar e usa `forcar`) e abre a **prévia do que está diferente** (marca, modelo, anos, cor, combustível, motor, chassi, Renavam e nº do motor, que vai nas observações). Só grava o que ficar marcado, pelo `api.veiculos.salvar`; não mexe em KM, dono nem na ficha de óleo e filtros. Diferente do botão da ficha de edição, que só preenche campo em branco. Teste: `python3 teste/teste_corrigir_placa.py`.

### Cadastros começam pelo que as consultas preenchem (15/11/2026, v145, sem SQL)
- Pedido do Danilo: cliente pelo CPF, endereço pelo CEP, veículo pela placa. **Ficha do cliente** (`cadastros.js`): o CPF/CNPJ (`#c-doc`) saiu da aba "Documentos, filiação e crédito" e é o primeiro campo, antes do nome; na aba "Endereço e contatos" o CEP vem antes de rua, complemento e bairro. **Nova O.S., cliente novo** (`entrada.js`): CPF, nome, telefone, CEP (campo novo, `CampoCep`), endereço e bairro; `endNovo()` grava a cidade e a UF que vieram do CEP e o CEP como `00000-000`; sem CEP (ou CEP apagado) continua Colatina/ES, como sempre foi. **Fornecedor** (`compras.js`): CNPJ primeiro; endereço começa pelo CEP. **Veículo** e Nova O.S. já começavam pela placa. As regras das consultas não mudaram (só preenchem campo em branco). Vale para PC e celular (mesmos componentes). Teste: `python3 teste/teste_cadastros_apis.py`.

### Peças por veículo: catálogos de peças na O.S. e no orçamento (15/11/2026, v147, sem SQL)
- **Ideia do Danilo:** ao incluir peça na O.S./orçamento, o botão **"Peças deste veículo"** (`#cat-pecas-veic`, só para peça e com modelo no veículo) mostra as peças de catálogo que servem no carro (montadora, nome do modelo como palavra inteira, ano na faixa; outra cilindrada sai), por grupo, com foto, medidas, aplicação e o botão **"Conversão"** (códigos da montadora e de outras marcas). "Usar" leva descrição (maiúsculas) e código para o item, que fica **só da O.S.** (não cria produto nem mexe em estoque); o custo e o preço são digitados no item. Quando o estoque crescer, a mesma busca passa a mostrar primeiro o que há na prateleira (ainda não feito).
- **Chave da peça (regra do Danilo):** código da montadora quando o catálogo traz; senão o código da marca. No item vai `"<montadora> (PERFECT <código>)"` ou `"PERFECT <código>"` (`codigoParaItem`).
- **Arquivos:** regras em `js/pecas.js` (sem window/document; usa `chavesDoVeiculo` do `js/catalogo.js`), tela em `js/telas/pecasveiculo.js`, dados em `js/pecasdados.js` (**gerado**, carregado só ao abrir a busca). Catálogo é base separada do estoque: nada em banco, backup ou réplica.
- **Como entra um catálogo:** um leitor por catálogo (`catalogo/pecas/ler_<marca>.py`, lê o PDF, que NÃO fica no repositório) grava `catalogo/pecas/<marca>.json` no formato comum (explicado em `catalogo/gerar_pecas.py`) e as miniaturas em `catalogo/fotos/<marca>/`; depois `python3 catalogo/gerar_pecas.py catalogo/pecas js/pecasdados.js && python3 tools_sw.py <versão>`. **Perfect 11/2026:** 866 peças, 1.506 aplicações, 570 com código da montadora, 344 com outras marcas, 490 com foto (o PDF traz várias sem foto e 5 páginas de conversão sem os códigos).
- **Axios 2026 (v148):** `catalogo/pecas/ler_axios.py`, só a LINHA LEVE (510 páginas; a pesada fica de fora): 2.640 peças, 8.322 aplicações, 1.594 com código da montadora, 1.066 com conversão (tabela REFERÊNCIA CRUZADA), todas com foto. Base com os dois catálogos: 3.506 peças, 9.828 aplicações. Na Axios as medidas costumam vir no texto da aplicação (observação) e a embalagem ("2 peças") vai no campo `emb`.
- **Nakata, catálogo completo (v153):** `catalogo/pecas/ler_nakata.py` lê o PDF de 8.324 páginas (aplicações em tabela com células mescladas, referências cruzadas por marca, fotos 8 por página, especificações). 6.227 peças, 106 mil aplicações, 6.184 fotos (340 px, `catalogo/fotos/nakata`). O PDF não traz montadora ("Veículo" é o nome do carro): `gerar_pecas.py` pega a montadora dos outros catálogos quando 85% das aplicações do nome são de uma só; senão fica vazia e a tela casa só pelo nome. A descrição = grupo + posição + lado (+ informação adicional); as medidas = peso, garantia, embalagem. Substituiu o folheto de 19 páginas. Para ler de novo, o arquivo (655 MB) precisa ser dividido em volumes ZIP de 300 MB para passar pelo limite de 400 MB do envio.
- **Fremax, Lonaflex, Controil e Fras-le completos (v154):** mesmo sistema e mesmo layout do Nakata completo, lidos pelo mesmo `ler_nakata.py` (quinto argumento = nome da marca). Fremax 1.671 peças (discos, tambores, cubos), Lonaflex 293 (lonas e pastilhas), Controil 1.207 (cilindros, reparos), Fras-le 1.493 (pastilhas, lonas, sapatas, embreagem). O Fras-le completo substituiu o antigo `frasle.json`; as 73 peças que só existiam no manual da linha leve ficaram em `frasle_linhaleve.json`. Os discos e as pastilhas trazem as medidas do catálogo (diâmetro, espessura, peso). `pecasdados.js` agora usa tabelas de modelos e observações (`modelos`, `obs`) para ficar em 10 MB (1,6 MB comprimido) com 17 mil peças e 202 mil aplicações.
- **Cofap, demais tabelas (v155):** `ler_cofap.py` agora também lê bieletas (cartões em duas colunas; a montadora fica embaixo de cada cartão e a coluna muda de página para página), buchas e coxins, homocinéticas, molas helicoidais, feixes de molas, cilindros e atuadores de embreagem e terminais axiais: de 1.145 para 1.888 peças e 4.643 aplicações. Camisas e kits de motor ficam de fora. Limites: modelo das buchas às vezes traz o ano no meio do texto; tabelas de kits de homocinética sem montadora são ignoradas. Catálogo de 2013: o aviso de catálogo antigo vale.
- **Mesma peça de marcas diferentes numa linha só (v156):** `agruparEquivalentes` em `js/pecas.js` (roda depois de `pecasDoVeiculo`, só na tela). Junta peças do mesmo grupo quando uma cita o código da outra na conversão, ou têm o mesmo código da montadora (este só com posição conhecida), sem mudar dianteira/traseira, lado ou superior/inferior. Nunca junta duas peças da mesma marca (seria modelo diferente), exceto quando a mesma peça cita as duas como conversão. A linha mostra a peça que está no estoque (produto ativo com saldo cujo `referencia` bate com algum código da linha); sem estoque, a mais completa (montadora, foto, medidas). As outras entram na conversão (`conversaoDoItem`), com um resumo da conversão na própria linha. Com estoque, aparece "Tem no estoque" e o botão "Usar do estoque" (usa o produto do cadastro, com baixa). Uno Mille Fire Flex 2006: amortecedores de 13 para 7 linhas.
- **Fras-le | Lonaflex "Aplicação Geral" (v150):** `catalogo/pecas/ler_frasle.py`: 686 peças (472 pastilhas, 123 lonas, 91 sapatas com lona) e 6.038 aplicações, sem fabricantes só de caminhão/ônibus/trator; a posição (dianteira/traseira) e o sistema (Teves, Bosch…) vão na observação da aplicação; 461 desenhos das pastilhas com as medidas viram a foto (`catalogo/fotos/frasle/pd-72.jpg`, nome = código); "Na caixa: …" vai em medidas; conversão = Lonaflex da mesma linha + tabela de conversão (Cobreq, Bendix, Bosch…). O catálogo é antigo (aplicações até 2014, muitas "em diante").
- **Hipper Freios (v151):** `catalogo/pecas/ler_hipper.py`: discos, tambores e cubos de roda, todos com as medidas (Ø externo, espessura e espessura mínima, altura, furo central, furos) e quase todos com o código da montadora; sem foto. A aplicação vem em texto corrido ("MODELO versão 1996>2001 / versão 1990> OUTRO MODELO…"): o leitor corta em cada ano e reconhece o começo de outro modelo pelo vocabulário de modelos da própria montadora; "(+ ABS)" depois do ano vira observação. Conversão sem nome de marca na tabela: BD = Fremax, RCDI/RPDI/RPTA = TRW, o resto "Outra marca".
- **Cofap suspensão 2013 (v152):** `catalogo/pecas/ler_cofap.py` lê três tabelas: amortecedores Super, Turbogás e Spa com os kits (batente e coifa) e top kits (coxim), bandejas (com nº original) e pastilhas (com as dimensões). 1.145 peças, 2.852 aplicações, sem foto. **Faltam** (cada uma com formato próprio): bieletas, buchas e coxins, homocinéticas, molas, feixes, cilindros de embreagem, terminais axiais.
- **Auditoria das fotos (v157, pedido do Danilo em 15/11/2026):** nos PDFs "Gerado em" as legendas nem sempre combinam com as imagens (Fremax BD9680, tambor, saía com foto de disco). `ler_nakata.py` agora só aceita foto de página em que nenhuma legenda se repete e, no Fremax, o formato da imagem combina com disco/tambor; `catalogo/pecas/limpar_fotos.py` tira a imagem repetida em 3+ códigos (ou em 2 de grupos diferentes) e apaga arquivos sem uso. Resultado: Fremax 361 fotos (de 1.662), Nakata 4.036, Fras-le 828, Controil 904, Lonaflex 218. Perfect e Axios (outro leitor) só passaram pela regra das repetidas. Peça sem foto = sem certeza. O shell não baixa fotos de sites de fornecedores (proxy) e as fotos de catálogos instalados (ex.: Schadek, `FotoProd`) ficam no PC.
- **Sabó Linha Leve (v158)**: `catalogo/pecas/ler_sabo.py <pdf> catalogo/pecas/sabo.json` lê o PDF de 9.576 páginas (jogos de juntas, juntas de cabeçote e diversas, retentores, buchas, coxins, parafusos, reparos de amortecedor e de homocinética). O texto do PDF repete cada linha 2 a 4 vezes (descartadas pela chave da aplicação). Sem fotos; os códigos da coluna "Nº Referência" entram em `oem`. Retentores não têm veículo no catálogo (aplicação só pela montadora, sem modelo).
- **Wega câmbio automático (v163)**: `catalogo/pecas/ler_wega_cambio.py <pdf> catalogo/pecas/wega_cambio.json` (filtros de câmbio, 22 páginas). Aplicação "MONTADORA MODELO yy-yy"; a maioria vem sem ano ou "2013-->" e é cortada pelo filtro de anos (ficam só 9 das 133 peças). Número da montadora em `oem`, Japanparts etc. em `conv`, modelo do câmbio e observação em `medidas`.
- **AuthoMix (v162)**: `catalogo/pecas/ler_authomix.py <pdf> catalogo/pecas/authomix.json` (Catálogo Autopeças, 482 páginas). Grade de células: código em negrito 10; tudo na mesma coluna abaixo dele pertence à célula. Aplicações "Modelo motor yy/yy" sem montadora (o gerador infere); "yy/..." = em diante (cortado pelo filtro de anos). Mesmo código em mais de uma célula: junta aplicações. As tabelas de conversão (cabeçalho "PÁGINAS") viram `conv` (Mobensani, Sampel, Axios, Nakata, Cofap, Corteco, Tecfil, Mann etc.). Sem foto.
- **Volkswagen Economy (v161)**: `catalogo/pecas/ler_vw_economy.py <pdf> catalogo/pecas/vw_economy.json` (PDF paisagem, 33 páginas, edição 12/2022). Código da peça = referência Economy (JZW/JZZ); referência de série (código VW) em `oem`; "outras marcas" em `conv` (ex.: Fremax BD-5614). O subtítulo "(Dianteiro)/(Traseiro)" entra na descrição. Só 100 peças, mas com ano fechado e conversão.
- **Mobensani 2019 (v160)**: `catalogo/pecas/ler_mobensani.py <pdf> catalogo/pecas/mobensani.json` (borrachas: buchas, coxins, suportes). Uma montadora por página (nome na vertical), item "MB 0000", números originais em `oem`; ano de 2 dígitos (≤30 = 20xx). Modelos de AUDI/SEAT dentro de página VW vão para a montadora própria. Sem foto.
- **Só anos certos (v159, decisão do Danilo 16/11/2026)**: `gerar_pecas.py` descarta aplicação "de X em diante", "até X" e sem ano (de e ate precisam ser > 0); peça que fica sem nenhuma aplicação não entra no acervo. Os JSON em `catalogo/pecas/` continuam completos: para reverter, tire o filtro no gerador.
- **Catálogo antigo × carro novo:** cada catálogo tem um ano de referência (o da edição ou o ano mais novo das aplicações; `gerar_pecas.py`). Aplicação "de tal ano em diante" num carro mais novo que o catálogo aparece com "(catálogo de 2013: confira se vale para 2020)", marca "Confira a versão" e vai para o fim do grupo (`pecasDoVeiculo`).
- **Grupo igual em todos os catálogos:** `grupo_de` em `catalogo/gerar_pecas.py` tira o grupo da descrição (cada marca chama de um jeito). Montadora "GENERAL MOTORS" casa com Chevrolet/GM (`APELIDOS` em `js/pecas.js`).
- **Peça ampliada (pedido do Danilo):** clicar na foto (`.pv-abre`) abre a peça grande (`#pv-grande`) com foto, medidas, todas as aplicações do carro e a conversão; "Usar esta peça" ali mesmo.
- **Fotos:** `catalogo/fotos/<marca>/<hash>.jpg` (até 640 px), servidas pelo site; não entram na lista do `sw.js` nem no programa do PC (sem internet a peça aparece "sem foto"). Uso interno; loja aberta ao público depende de autorização da marca.
- Testes: `node teste/teste_pecas.mjs` e `python3 teste/teste_pecas_tela.py` (PC e celular).

### Cadastros completos pelas consultas, maiúsculas e ficha de pessoa física (15/11/2026, v146, sem SQL)
- **Letras maiúsculas (regra do Danilo):** nome do cliente e descrição de produtos e serviços são gravados em MAIÚSCULAS (`MAIUSC` em `js/maiusculas.js`, arquivo separado de `util.js`/`regras.js` para não obrigar a publicar a função "email"). As telas mostram o campo em maiúsculas (classe `maiusc`) e `api.clientes.salvar`/`api.produtos.salvar` (`js/api.js`) garantem a regra para qualquer tela. Vale para o que for gravado daqui em diante; o que já estava gravado só muda quando o cadastro é aberto e salvo. O nome que vem do CPF também entra em maiúsculas. O conector grava pelo banco (`salvar_cadastro`, `produto`): ao cadastrar por lá, mande já em maiúsculas.
- **Fontes do CNPJ (pesquisa e escolha de 15/11/2026, conferidas ao vivo a partir do endereço do sistema):** 1º BrasilAPI, 2º Minha Receita, 3º CNPJ.ws pública (`publica.cnpj.ws/cnpj/<cnpj>`, formato próprio lido por `lerCnpjWs`, 3 consultas/minuto — por isso por último; é base independente, porque a BrasilAPI consulta a Minha Receita por trás). ReceitaWS e OpenCNPJ não aceitam chamada direta do navegador (CORS) e ficaram de fora. Todas grátis e sem chave.
- **Empresa pelo CNPJ (`js/cnpj.js`, sem chave e sem função):** BrasilAPI (`brasilapi.com.br/api/cnpj/v1/<cnpj>`) e, se ela cair ou não conhecer, Minha Receita (`minhareceita.org/<cnpj>`), que responde com os mesmos nomes de campo. Dado público da Receita: razão social, fantasia, telefone, e-mail e endereço. Mesmas regras do CEP: uma consulta por CNPJ digitado, nunca em lote; guardado no aparelho (`dtcar-cnpj`, 100 mais recentes); só preenche campo em branco (`soEmBranco`) e, trocado o CNPJ, tira o que a consulta tinha posto (`tirarPostos`); sem internet não consulta nem avisa. Avisa quando a empresa não está ATIVA na Receita. Usado na ficha do fornecedor, na ficha do cliente, na Nova O.S. (cliente novo), no orçamento e na agenda. **As duas fontes só foram testadas com respostas de mentira** (o ambiente de desenvolvimento não alcança esses endereços): conferir a primeira consulta de verdade.
- **Cliente só digitado no orçamento e na agenda (`js/clientedig.js`, `ClienteDigitado`):** CPF/CNPJ, nome, telefone, CEP, endereço e bairro, com as mesmas consultas. Fica na cópia `cliente` do orçamento/agendamento (coluna que já existia) com as chaves `doc`, `nascimento`, `cep`, `rua`, `bairro`, `cidade`, `uf`, `email`, `endereco` (`copiaClienteDig`). Segue para o cadastro: (1) agenda → "Chegou: abrir O.S." preenche o cliente novo da Nova O.S. (`prepararNovaOSAgenda`); (2) orçamento aprovado com cliente novo: o banco cadastra com nome e telefone (v53) e a tela completa o cadastro (`completarClienteNovo`: lê a O.S. criada, acha o cliente e grava CPF/CNPJ, nascimento e endereço; CPF que já é de outro cliente vira aviso, a O.S. continua aberta). Aprovar pelo conector não completa (só o banco roda): complete com `salvar_cadastro`.
- **Ficha de pessoa física (pedido do Danilo com a foto da tela):** sem CNPJ, a ficha do cliente não mostra Telefone 2, Telefone 3, E-mail, Pessoa de contato, Tipo de cliente nem Como conheceu a oficina (`mostra` em `FormCliente`). Com CNPJ (14 números) aparecem todos. Campo que já tinha algo gravado quando a ficha abriu continua à vista, e nada é apagado.
- **Cadastros antigos (`supabase/v58.sql`, só o Danilo roda):** converte `clientes.nome` e `produtos.descricao` já gravados para maiúsculas, com a mesma regra da tela; pode rodar de novo; não mexe nas cópias guardadas em O.S., recibos e notas.
- **Achados da revisão independente (corrigidos antes do merge):** (1) na aprovação do orçamento, `completarClienteNovo` devolve o que faltou e a tela mostra UM aviso só ("virou a O.S. N. Atenção: …"); se o CPF/CNPJ já é de outro cliente, o endereço vai mesmo assim, sem o documento e sem o nascimento. (2) `trocaDoc` em `ClienteDigitado`: mudou os números do CPF/CNPJ (mesmo em orçamento/agendamento reaberto), saem `nascimento` e `email` da cópia — o nascimento de um CPF nunca vai para o cadastro de outro. (3) `erroClienteDig`: CPF/CNPJ pela metade ou com dígito errado bloqueia o Salvar com aviso, em vez de sumir em silêncio.
- Teste: `python3 teste/teste_cadastros_apis.py` (PC e celular; CNPJ, ViaCEP e consulta de CPF de mentira).

### Viscosidade: menos dúvidas e sinal de atenção (16/11/2026, v143)
- `parceiraDivergente` em `js/catalogo.js` também compara a **viscosidade** (sem nenhuma em comum = divergente). `podarDivergencias` descarta a fonte mais antiga também na viscosidade, mas só quando as duas linhas têm o mesmo período (ou a antiga não tem período): período diferente costuma ser outra versão do motor e as duas ficam. 3.048 linhas → 2.621.
- `avisoOleo(resumo)`: quando o resumo tem, para a mesma cilindrada (turbo e aspirado juntos), respostas sem viscosidade em comum, devolve o texto "Atenção: …" com a resposta de cima e as outras (motor, período e fonte). Aparece na tela Óleo e filtros (`#of-atencao`), no quadro "Preencher pelo catálogo" da ficha (`#fo-atencao`) e no conector (`oleo_atencao`, PR seguinte, com o commit do catálogo trocado).
- Ordem do resumo: linha cujo período contém o ano vem antes; depois o período mais curto; depois a fonte mais nova (a tabela nova às vezes estica o período).
- `CORRECOES_OLEO` em `catalogo/gerar.py`: correções de período conferidas (Onix 1.0 3 cilindros da Texaco: 2020 em diante, não 2015). Regenerar com `python3 catalogo/gerar.py catalogo js/catalogodados.js && python3 tools_sw.py`.
