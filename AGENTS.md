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
- `supabase/*.sql`: mudanças no banco, numeradas (`v3.sql` … `v14.sql`). `worker/`: robô da SEFAZ (GitHub Actions).

## Regras do negócio que não podem quebrar
- **O.S. em 4 etapas**: Orçamento → Aprovado (execução) → Aguardando pagamento → Fechada (`ETAPAS` e `etapaOS()` em `js/regras.js`).
  Os status gravados no banco continuam os mesmos (`diagnostico`, `aguardando`, `execucao`, `pronto`, `entregue`, `recusado`, `cancelado`).
  A O.S. só fecha quando o pagamento é quitado (gatilho no banco: `recebido` ≥ `total` com status `entregue`).
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
- Etapa 3 (alterar O.S. sem internet): `js/alteracoes.js`. No programa com o banco do PC pronto, sem internet, `api.atualizarOrdem`,
  `api.salvarItens` e `api.evento` gravam no banco do PC e entram na fila (`js/fila.js`, tipos `alterar_os`, `itens_os`, `evento_os`);
  com internet, gravam no servidor e copiam a linha devolvida para o banco do PC na hora (base certa para conflitos).
  Envio: `api.sincronizarAlteracao`, na ordem em que foi feito. **Regras de conflito:** campo só é gravado se no online ainda está como
  estava (ou já igual ao feito aqui); item alterado/removido aqui é conflito se mudou no online; O.S. fechada/cancelada/apagada no online
  é conflito; conflito trava as alterações seguintes da mesma O.S. até o usuário escolher "Enviar por cima" ou "Descartar"
  (Sistema › Dados no computador). Comparação pelo conteúdo (`iguais`: chaves de jsonb e formato de data não contam).
  Sem internet NÃO pode: entregar/receber/fechar, recibo, fotos/assinaturas, mexer em O.S. entregue ou cancelada. A réplica não roda
  com alteração na fila (enviaria a versão do online por cima). O.S. nova sem internet continua com número provisório PROV-NN
  (decisão do Danilo em 31/10; o definitivo é dado pelo servidor ao enviar, por ordem de horário).
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
