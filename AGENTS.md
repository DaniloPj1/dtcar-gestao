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
- `supabase/*.sql`: mudanças no banco, numeradas (`v3.sql` … `v16.sql`, `v17_virada.sql`, `v18.sql`, `v19.sql`, `v20.sql`, `v21.sql`). `worker/`: robô da SEFAZ (GitHub Actions).

## Regras do negócio que não podem quebrar
- **O.S. em 4 etapas**: Orçamento → Aprovado (execução) → Aguardando pagamento → Fechada (`ETAPAS` e `etapaOS()` em `js/regras.js`).
  Os status gravados no banco continuam os mesmos (`diagnostico`, `aguardando`, `execucao`, `pronto`, `entregue`, `recusado`, `cancelado`).
  A O.S. só fecha quando o pagamento é quitado (gatilho no banco: `recebido` ≥ `total` com status `entregue`).
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
  adicional). Prévia com p_gravar=false; grava com true, registra em `eventos` e `agente_acoes`. Testes: `deno run -A teste/teste_agente_mcp.ts`,
  `bash teste/teste_v21.sh` e `python3 teste/teste_consentimento.py`.
- Pagamento a prazo vira parcelas na tabela `receber` (boleto/promissória em N vezes, vencimento e alerta de atraso).
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
