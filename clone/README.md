# DTCar Clone — app separado de leitura/clone de módulos por OBD

Ferramenta de administrador, **à parte do app do sistema e do app do mecânico**. Serve para, com o
ELM327 na tomada do carro, **ler tudo que cada módulo expõe por diagnóstico** e salvar num arquivo
JSON para análise. É um teste: ver o que de fato dá para puxar antes de decidir os próximos passos.

## Só leitura — a trava
Como o app abre uma tela (site embutido), qualquer script dela alcança o plugin nativo. Por isso a
**lista branca fica no Java** (`clone/plugins/obd/.../ObdPlugin.java`) e é conferida por teste
(`teste/teste_clone_java.sh`):

- **Libera** leitura OBD-II (01,02,03,06,07,09,0A), UDS de leitura (22, 19, 1A), sessão só de leitura
  (10 01 / 10 03), tester present (3E), e os comandos AT de **endereçamento** do adaptador
  (ATSH, ATCRA, ATFC…) — que configuram a conversa, não escrevem no carro.
- **Recusa** tudo que escreve ou age: apagar falha (04/14), gravar (2E/3D), atuador (2F), rotina (31),
  transferência de bloco (34–37), destravar (27), reiniciar (11), sessão de programação (10 02).
- O app **não tem** método de apagar. Só lê.

## v1 (0.1.0) — o que o botão "Clonar" fazia
1. Prepara o adaptador e descobre o protocolo.
2. Lê o OBD padrão: PIDs suportados e seus valores, chassi, CALID, CVN, falhas (confirmadas,
   pendentes, permanentes), freeze frame e monitores de bordo.
3. Fala por UDS com cada módulo do grupo do motor (7E0–7E7): sessão, identificação (lista de DIDs
   F1xx: nº de peça, software, hardware, série, datas), e falhas por UDS (19 02).
4. Grava **cada pedido e resposta com o tempo** (o clone de verdade) + um resumo, e exporta um JSON.

A leitura de **memória** (serviço 23) e os módulos fora do grupo do motor (ABS, airbag, câmbio —
podem estar noutro barramento, não exposto no pino OBD) **ficam para uma próxima versão**, depois de
ver o que esta leitura traz.

## Arquivo
JSON (`clone-<placa>-<data>.json`): metadados, condição da medição, resumo, `obd2`, `modulos` e
`bruto` (todas as trocas). Formato escolhido por ser legível, aninhado e fácil de enviar e analisar.

## Gerar o APK
GitHub › Actions › **DTCar Clone (gerar APK)** › Run workflow. Baixar em *Artifacts*
(`DTCar-clone-apk`). Desinstalar a versão anterior antes de instalar a nova.

## v2 (0.2.0) — matéria-prima do simulador
Teste da v1 num Cobalt 2013: o OBD padrão veio inteiro (VIN, CALID, CVN, 36 PIDs), mas o UDS por
módulo não trouxe nada e a contagem "8 módulos" era falsa (só o ECM respondia). A v2:

- **enumera os módulos de verdade** (pedido funcional e lê quem respondeu) e testa se o adaptador
  obedece ao endereçamento (`adaptador_obedece_endereco` no resumo);
- **varre identificadores** no `22` (UDS e GMLAN) e no `1A` (GMLAN/KWP), gravando o dado **ou o código
  de recusa** de cada um — o simulador só sabe o que o clone gravou, e a recusa diz o que existe;
- **mapeia as saídas sem acionar**: `AE`+CPID (GMLAN) e `2F`+identificador (UDS) **incompletos**.
  Saída que existe responde "tamanho errado" (13); a que não existe, "fora da faixa" (31). A trava
  nativa só deixa sair o pedido incompleto — o comando completo continua recusado (teste);
- tenta ler a **memória** (`23`), grava sessões aceitas, onde pede segurança, e o **tempo** de cada resposta.

Dois botões: **Clone rápido** (faixas conhecidas, ~5 min por módulo) e **Clone completo**
(65.536 identificadores, mais de 1 h por módulo, com botão Parar que guarda o que já leu).

Cuidado: nem todo módulo confere o tamanho antes da faixa. O primeiro mapeamento de saídas deve ser
num carro próprio ou módulo de bancada, motor desligado.

O que o clone **não** traz e o simulador vai precisar depois: a reação do módulo a um comando
**completo** de cada saída e o efeito dela no carro — isso só vem de um acionamento real.
