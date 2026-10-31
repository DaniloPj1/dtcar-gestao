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
- `supabase/*.sql`: mudanças no banco, numeradas (`v3.sql` … `v12.sql`). `worker/`: robô da SEFAZ (GitHub Actions).

## Regras do negócio que não podem quebrar
- **O.S. em 4 etapas**: Orçamento → Aprovado (execução) → Aguardando pagamento → Fechada (`ETAPAS` e `etapaOS()` em `js/regras.js`).
  Os status gravados no banco continuam os mesmos (`diagnostico`, `aguardando`, `execucao`, `pronto`, `entregue`, `recusado`, `cancelado`).
  A O.S. só fecha quando o pagamento é quitado (gatilho no banco: `recebido` ≥ `total` com status `entregue`).
- Pagamento a prazo vira parcelas na tabela `receber` (boleto/promissória em N vezes, vencimento e alerta de atraso).
- **Numeração**: vale a do sistema antigo (OS Oficina 3.0). Enquanto o **modo espelho** estiver ligado (Sistema › Importar), cada carga do
  backup antigo apaga e recarrega clientes, veículos, produtos, O.S., recibos, vendas, estoque e contas a receber. Não "proteger" esses dados contra o espelho.
- Estoque: a peça sai quando entra na O.S. e volta se for removida, recusada ou cancelada.
- Garantia de serviço e responsabilidade por peça trazida pelo cliente ficam separadas; nada de cláusula contra o CDC.
- Não inventar preço, torque, pinagem, código de peça ou regra fiscal.

## Como trabalhar
1. Crie uma branch (`codex/assunto` ou `claude/assunto`) e abra um Pull Request para a `main` explicando em português o que muda para a oficina.
   Não faça push direto na `main` sem o Danilo pedir.
2. Mudança no banco: crie o próximo `supabase/vNN.sql`, idempotente (`if not exists`, `create or replace`), com comentários.
   **O Danilo é quem roda o SQL** no SQL Editor do Supabase. O site precisa continuar funcionando antes de o SQL ser rodado (verifique a coluna/tabela e mostre um aviso, como `api.temV12()`).
3. Criou ou renomeou arquivo em `js/`, `css/`, `icons/` ou `vendor/`? Rode `python3 tools_sw.py` (atualiza a lista do `sw.js` e a versão do cache).
   Arquivo fora da lista quebra a abertura sem internet.
4. Teste antes de pedir aprovação: `python3 teste/teste_fluxo.py` (Playwright com dados simulados de `teste/mock.js`; não toca no banco real).
   Funcionalidade nova ganha verificação nesse teste ou em um novo arquivo em `teste/`.
5. Não mexer em `CNAME`, nas configurações do GitHub Pages, nem nos segredos do repositório.
6. Revisão cruzada: quando um agente faz a mudança, o outro revisa o PR (regras acima, textos em português, teste passando) antes do Danilo aprovar.
