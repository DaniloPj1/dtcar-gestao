-- Cenários da função sincronizar_alteracao_os (supabase/v15.sql); a saída esperada está em teste/v15_esperado.txt
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
insert into ordens (id, numero, status, reclamacao, orcamento_enviado_em, aprovacao, total) values
  ('00000000-0000-0000-0000-0000000000a1', 1, 'execucao', 'barulho', '2026-10-31T21:00:00.123+00', '{"por":"x","em":"2026-10-31"}', 100);
insert into os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'peca', 'PASTILHA', 2, 120);
create temp table r (n text, v jsonb);
-- 1) alterar campo: antes com data em outro formato e jsonb em outra ordem → aplica
insert into r select '1 aplica', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":null,"status_base":"execucao",
  "patch":{"reclamacao":"PC","orcamento_enviado_em":"2026-10-31T21:00:00.123Z","aprovacao":{"em":"2026-10-31","por":"x"}},
  "antes":{"reclamacao":"barulho","orcamento_enviado_em":"2026-10-31T21:00:00.123Z","aprovacao":{"em":"2026-10-31","por":"x"}}}');
insert into r select '1b valor', to_jsonb(reclamacao) from ordens;
-- 2) reenvio do mesmo → reenvio
insert into r select '2 reenvio', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","status_base":"execucao","patch":{"reclamacao":"PC"},"antes":{"reclamacao":"barulho"}}');
-- 3) conflito de campo
update ordens set reclamacao = 'ONLINE';
insert into r select '3 conflito', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","status_base":"execucao","patch":{"reclamacao":"PC2"},"antes":{"reclamacao":"PC"}}');
insert into r select '3b intacto', to_jsonb(reclamacao) from ordens;
-- 4) forcar
insert into r select '4 forcar', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","status_base":"execucao","patch":{"reclamacao":"PC2"},"antes":{"reclamacao":"PC"}}', true);
insert into r select '4b valor', to_jsonb(reclamacao) from ordens;
-- 5) espelho novo → conflito
update config set dados = '{"ultimoEspelho":{"em":"2026-11-01T10:00:00Z"}}';
insert into r select '5 espelho', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":null,"status_base":"execucao","patch":{"reclamacao":"x"},"antes":{"reclamacao":"PC2"}}');
insert into r select '5b mesma geração', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","status_base":"execucao","patch":{"reclamacao":"PC3"},"antes":{"reclamacao":"PC2"}}');
-- 6) itens: alterar qtd 2→5 (base pelo conteúdo, com datas na base que não contam)
insert into r select '6 item', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b1":{"id":"00000000-0000-0000-0000-0000000000b1","descricao":"PASTILHA","qtd":2,"valor_unit":"120.00","atualizado_em":"1999-01-01T00:00:00Z"}}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b1","ordem_id":"00000000-0000-0000-0000-0000000000a1","tipo":"peca","descricao":"PASTILHA","qtd":5,"valor_unit":120,"atualizado_em":"1999-01-01T00:00:00Z","campo_inexistente":1}],"removidos":[]}');
-- 7) seguida 5→6 (base = conteúdo depois da anterior)
insert into r select '7 seguida', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b1":{"descricao":"PASTILHA","qtd":5,"valor_unit":120}}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b1","tipo":"peca","descricao":"PASTILHA","qtd":6,"valor_unit":120}],"removidos":[]}');
insert into r select '7b qtd', to_jsonb(qtd) from os_itens where id = '00000000-0000-0000-0000-0000000000b1';
-- 8) item novo + reenvio do novo com conteúdo diferente no online → conflito
insert into r select '8 novo', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b2":"novo"}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b2","tipo":"servico","descricao":"MAO DE OBRA","qtd":1,"valor_unit":150}],"removidos":[]}');
update os_itens set qtd = 9 where id = '00000000-0000-0000-0000-0000000000b2';
insert into r select '8b reenvio divergente', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b2":"novo"}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b2","tipo":"servico","descricao":"MAO DE OBRA","qtd":1,"valor_unit":150}],"removidos":[]}');
insert into r select '8c qtd online', to_jsonb(qtd) from os_itens where id = '00000000-0000-0000-0000-0000000000b2';
-- 9) item alterado no online → conflito, nada gravado (atômico: remoção junto não acontece)
update os_itens set valor_unit = 99 where id = '00000000-0000-0000-0000-0000000000b1';
insert into r select '9 conflito item', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b1":{"qtd":6,"valor_unit":120},"00000000-0000-0000-0000-0000000000b2":{"qtd":9}}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b1","tipo":"peca","descricao":"PASTILHA","qtd":7,"valor_unit":120}],"removidos":["00000000-0000-0000-0000-0000000000b2"]}');
insert into r select '9b b2 ainda existe', to_jsonb(count(*)) from os_itens where id = '00000000-0000-0000-0000-0000000000b2';
-- 10) O.S. entregue no online: campo e item → conflito
update ordens set status = 'entregue';
insert into r select '10 campo entregue', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","status_base":"execucao","patch":{"obs_internas":"x"},"antes":{"obs_internas":""}}');
insert into r select '10b item entregue', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b3":"novo"}},
  "itens":[{"id":"00000000-0000-0000-0000-0000000000b3","tipo":"servico","descricao":"X","qtd":1,"valor_unit":1}],"removidos":[]}');
update ordens set status = 'execucao';
-- 11) remover com base intacta
insert into r select '11 remover', sincronizar_alteracao_os('{"tipo":"itens_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","antes":{"status":"execucao","itens":{"00000000-0000-0000-0000-0000000000b2":{"qtd":9,"descricao":"MAO DE OBRA"}}},"itens":[],"removidos":["00000000-0000-0000-0000-0000000000b2"]}');
-- 12) evento: 2x mesma data → 1
insert into r select '12 evento', sincronizar_alteracao_os('{"tipo":"evento_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","evento":{"tipo":"pronto","texto":"t","usuario_nome":"D","criado_em":"2026-10-31T22:00:00.5Z"}}');
insert into r select '12b evento', sincronizar_alteracao_os('{"tipo":"evento_os","ordem_id":"00000000-0000-0000-0000-0000000000a1","espelho":"2026-11-01T10:00:00Z","evento":{"tipo":"pronto","texto":"t","usuario_nome":"D","criado_em":"2026-10-31T22:00:00.500+00:00"}}');
insert into r select '12c eventos', to_jsonb(count(*)) from eventos;
-- 13) O.S. apagada
insert into r select '13 apagada', sincronizar_alteracao_os('{"tipo":"alterar_os","ordem_id":"00000000-0000-0000-0000-0000000000ff","patch":{"reclamacao":"x"},"antes":{"reclamacao":""}}');
insert into r select '14 ping', sincronizar_alteracao_os('{"tipo":"ping"}');
select n || ' => ' || v::text from r;
