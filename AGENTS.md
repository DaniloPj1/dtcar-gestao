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
- `js/telas/*.js`: uma tela por arquivo. `css/app.css`: estilos (tema claro e escuro; azul, preto e cinza-escuro da DTCar).
- `supabase/*.sql`: mudanças no banco, numeradas (`v3.sql` … `v16.sql`, `v17_virada.sql`, `v18.sql`, `v19.sql`, `v20.sql`, `v21.sql`, `v22.sql`, `v23.sql`, `v24.sql`, `v25.sql`, `v26.sql`, `v27.sql`, `v28.sql`, `v29.sql`, `v30.sql`, `v31.sql`, `v32.sql`, `v33.sql`, `v34.sql`, `v35.sql`, `v36.sql`, `v37.sql`, `v38.sql`, `v39.sql`, `v40.sql`, `v41.sql`, `v42.sql`, `v43.sql`, `v44.sql`). `worker/`: robô da SEFAZ (GitHub Actions; consulta de notas só às 8h e 16h de Brasília ou quando pedida na tela, para não esgotar o limite da SEFAZ do CNPJ, que o ObjetivaWeb também usa — teste em `teste/teste_sefaz_horarios.mjs`).

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
  "Create a merge commit" e publique a função "email" de novo.** Testes: `deno run -A teste/teste_backup_leitura.ts` (zip e planilha de verdade,
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
  do PC e do espelho. Testes: `deno run -A teste/teste_rh.ts` e `bash teste/teste_v30.sh`.
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
  DTCar Gestão é só consulta e treino (faixa amarela "Período de transição" em todas as telas). Toda programação nova respeita isso:
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
