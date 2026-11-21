-- v63 (21/11/2026, Etapas 1 a 4 do diagnóstico): O REGISTRO DO OBD PASSA A ACEITAR TUDO O QUE O APP FAZ NO CARRO.
-- A tabela obd_leituras (v62) só aceitava 'leitura' e 'apagar'. O app agora também aciona atuador, roda aprendizado, apaga falha
-- por módulo e grava código de bico — e cada uma dessas ações precisa deixar a mesma linha que o apagar deixa: quem, quando,
-- em qual carro. Entram ainda três registros que o app escreve SOZINHO, sem botão:
--   'sessao' — o resumo da leitura ao vivo (por sinal e por regime), para comparar o carro com ele mesmo na próxima vez;
--   'laudo'  — o estado do carro num momento, SELADO com um SHA-256 do conteúdo (coluna selo);
--   'mapa'   — o que se aprendeu de como aquele modelo responde (que módulo responde em que endereço, que dado existe).
-- Decisão de desenho: NÃO cria tabela nova. Tudo cabe na obd_leituras, que já está no backup, na réplica do banco do PC e nas
-- exclusões (v62) e já não tem política de UPDATE — linha gravada não muda, que é exatamente o que laudo e registro pedem.
-- Só acrescenta duas colunas (dados, selo) e troca a lista de tipos aceitos. Não mexe em O.S., estoque nem financeiro. Idempotente.
-- Antes deste SQL o app continua funcionando: o que o banco recusa fica guardado no aparelho e sobe sozinho depois.

alter table public.obd_leituras add column if not exists dados jsonb;      -- o conteúdo do registro (depende do tipo)
alter table public.obd_leituras add column if not exists selo text;        -- SHA-256 de `dados` (laudo): confere que não mudou

alter table public.obd_leituras drop constraint if exists obd_leituras_tipo_check;
alter table public.obd_leituras add constraint obd_leituras_tipo_check
  check (tipo in ('leitura', 'apagar', 'atuar', 'aprender', 'apagar_modulo', 'gravar_bico', 'sessao', 'laudo', 'mapa'));

create index if not exists obd_leituras_tipo on public.obd_leituras (tipo, criado_em desc);
create index if not exists obd_leituras_veiculo on public.obd_leituras (veiculo_id, criado_em desc);

comment on column public.obd_leituras.dados is 'Conteúdo do registro, conforme o tipo: atuar/aprender/apagar_modulo/gravar_bico (o que foi feito e a resposta do módulo), sessao (resumo por sinal e regime), laudo (estado do carro), mapa (o que o modelo respondeu).';
comment on column public.obd_leituras.selo is 'SHA-256 do JSON canônico de dados. Só o laudo usa. A tabela não tem política de UPDATE: o selo deixa conferir que o guardado é o que foi lido.';

notify pgrst, 'reload schema';
