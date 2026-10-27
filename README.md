# DTCar Gestão

Sistema da **DTCar Centro Automotivo** (Colatina/ES) que cobre o atendimento da entrada à entrega do veículo:

1. **Entrada (check-in):** placa, cliente, KM, combustível, checklist técnico, lataria, pneus, acessórios, fotos e assinatura do cliente na tela.
2. **Diagnóstico e orçamento:** mão de obra pelo catálogo (preço fechado ou por hora), peças com custo, preço de venda e procedência, e serviços de terceiros. O sistema mostra a margem bruta de cada O.S.
3. **Aprovação:** total ou parcial, registrada com assinatura ou pelo WhatsApp. Itens adicionais exigem nova aprovação.
4. **Execução:** mecânico responsável, serviços marcados como feitos, fotos e observações.
5. **Entrega:** KM de saída, forma de pagamento, garantia e assinatura na retirada.
6. **Documentos:** checklist de entrada, orçamento e ordem de serviço com garantia em PDF, além das mensagens prontas para o WhatsApp.

Ele roda no navegador (celular ou computador), pode ser instalado como app pelo Chrome e guarda os dados no **Supabase**.

---

## Configuração (uma vez, cerca de 15 minutos)

### 1. Criar o banco no Supabase
1. Crie uma conta gratuita em https://supabase.com e clique em **New project**.
   - Nome: `dtcar-gestao` · Região: **South America (São Paulo)** · anote a senha do banco.
2. No menu lateral, abra **SQL Editor › New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   O script cria as tabelas, as regras de acesso, o armazenamento de fotos e um catálogo inicial **sem preços**.
3. Em **Authentication › URL Configuration**:
   - **Site URL:** o endereço do site (ex.: `https://SEU-USUARIO.github.io/dtcar-gestao/`)
   - **Redirect URLs:** o mesmo endereço.
4. Em **Project Settings › API**, copie **Project URL** e **anon public key**.

### 2. Ligar o site ao banco
Abra `js/config.js` e preencha os dois valores:

```js
window.DTCAR_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ..."
};
```

A chave *anon public* pode ficar no site. Quem protege os dados são as regras de acesso do banco: sem login liberado, ninguém lê nem grava nada.

### 3. Primeiro acesso
1. Abra o site e toque em **Criar acesso**. **O primeiro usuário vira administrador automaticamente.**
2. Confirme o e-mail pelo link recebido e entre.
3. Em **Mais › Ajustes**, defina o valor-hora, a margem das peças, a taxa de diagnóstico (se cobrar), a garantia e o logotipo.
4. Em **Mais › Catálogo**, preencha os preços dos serviços.
5. A equipe cria o próprio acesso pelo site e o administrador libera em **Mais › Equipe**, escolhendo o papel de cada um:
   - **Consultor:** entrada, orçamento, aprovação, entrega e cadastros.
   - **Mecânico:** entrada e execução, sem ver valores na tela.

### 4. Instalar no celular
No Chrome do Android, abra o site e use **⋮ › Instalar app** (ou "Adicionar à tela inicial").

---

## Observações importantes

- **Termos jurídicos:** os textos padrão do checklist, do orçamento e da garantia seguem o CDC (arts. 21, 26-II, 39-VI e 40), mas **devem ser revisados por advogado ou contador**. Eles podem ser editados em Ajustes.
- **Faturamento não é lucro:** a margem do painel desconta só peças e terceiros. Impostos do Simples, salários, aluguel e taxas de cartão não entram na conta.
- **Ocultar valores do mecânico** é um recurso da tela, não uma trava do banco. Quem tem acesso técnico ao banco consegue ler os valores.
- **Plano gratuito do Supabase:** 500 MB de banco e 1 GB de arquivos. Cada foto ocupa ~150–300 KB, então cerca de 3 a 5 mil fotos cabem no plano gratuito. Projetos gratuitos **pausam após 7 dias sem uso**; com uso diário isso não acontece. Para não depender disso, o plano Pro custa US$ 25/mês (confira o valor atual no site do Supabase).
- **Backup:** no plano gratuito, exporte periodicamente em **Database › Backups** ou pelo `pg_dump`.

## Estrutura

```
index.html            página única
css/app.css           visual (claro/escuro, celular/computador)
js/config.js          conexão com o Supabase
js/api.js             acesso aos dados
js/regras.js          checklist, status, papéis e termos padrão
js/pdf.js             PDFs de checklist, orçamento e O.S.
js/telas/*.js         telas
supabase/schema.sql   estrutura do banco e regras de acesso
vendor/               Preact+htm, supabase-js e jsPDF (sem etapa de build)
```
