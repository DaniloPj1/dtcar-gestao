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
Teste da v1 num Cobalt 2013: o OBD padrão veio (VIN, 36 PIDs), mas o UDS por módulo não trouxe
nada, a contagem "8 módulos" era falsa (só o ECM respondia) e o adaptador **cortou o modo 09 em 5
quadros** (o CALID tinha 8 calibrações e vieram 2). A v2, revisada pelo Codex no PR #169:

- **testa o adaptador**: se obedece ao endereço (ATSH) e ao filtro (ATCRA), com leitura de controle;
- **acha os módulos** pelo pedido funcional **e** por endereço físico, conferindo o cabeçalho de quem respondeu;
- **monta o ISO-TP pelo tamanho declarado**: sem enchimento, e marca resposta cortada como incompleta;
  resposta longa cortada é pedida de novo com controle de fluxo explícito;
- **varre identificadores** no `22` (UDS/GMLAN) e no `1A` (GMLAN/KWP), gravando o dado ou o **código
  de recusa cru** (sem virar "existe/não existe", porque o mesmo código muda de sentido entre GMLAN e
  UDS), o silêncio em faixas, os erros do aparelho, até onde foi e se terminou;
- trata o "aguarde" (78) repetindo a leitura uma vez com espera maior;
- tenta a **memória** (`23`), grava sessões, protocolo provável e o **tempo** de cada resposta.

**O clone não sonda atuador.** A versão inicial mandava `AE`/`2F` "incompletos" para mapear saídas;
o Codex mostrou que, pela GMW3110, há CPIDs que **executam sem bytes de controle** e `AE00` é comando
válido. Os dois foram retirados da trava nativa (teste recusa qualquer forma). Mapear saída por sonda
fica para bancada/simulador. A lista de atuadores só vem quando o módulo a informa por leitura (FA20–FA23).

Dois botões: **Clone rápido** (faixas conhecidas, minutos) e **Clone completo** (65.536
identificadores, mais de 1 h por módulo, com **Parar** que guarda o que já leu).
