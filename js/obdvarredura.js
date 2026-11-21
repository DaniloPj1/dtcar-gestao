/**
 * A varredura do carro inteiro: falha de TODO módulo que responde, não só do motor.
 * (Etapa 3, frente 2.) Recebe a lista de módulos (do mapa do modelo, ou os endereços que a norma
 * reserva) e as funções de conversa, para poder ser conferida sem carro.
 */

/**
 * `mods` = [{ pedido, resposta, nome }]. `fala` = { abrir, sessao, lerFalhas, comum, estendida }.
 * Devolve [{ ...mod, respondeu, recusou, falhas: [], erro }], na ordem recebida.
 * Módulo que não responde NÃO some da lista: volta com respondeu = false.
 */
export async function varrer(mods, fala, { aoAndar = null, continuar = () => true, pronta = f => f } = {}) {
  const out = [];
  for (let i = 0; i < mods.length && continuar(); i++) {
    const m = mods[i];
    if (aoAndar) { try { aoAndar(m, i + 1, mods.length); } catch (e) { /* tela fechou */ } }
    const item = { ...m, respondeu: false, recusou: false, falhas: [], erro: "" };
    try {
      await fala.abrir({ pedido: m.pedido, resposta: m.resposta });
      const s = await fala.sessao(fala.comum);
      if (!s.erro) {
        item.respondeu = true;
        // tenta a sessão estendida; módulo que recusa continua valendo na comum
        await fala.sessao(fala.estendida);
        const f = await fala.lerFalhas(0xff);
        if (f.nrc != null || f.erro) { item.recusou = true; item.erro = f.texto || "O módulo não entregou as falhas."; }
        else item.falhas = (f.codigos || []).map(pronta);
      }
    } catch (e) {
      item.erro = (e && e.message) || "falhou";
      // Respondeu e a leitura quebrou no meio (conexão caiu): NÃO é "sem falha gravada", é leitura que não terminou.
      if (item.respondeu) { item.recusou = true; item.falhas = []; }
    }
    out.push(item);
  }
  return out;
}

/** Os números que a tela mostra no topo. */
export function resumo(lista) {
  const l = lista || [];
  return {
    perguntados: l.length,
    responderam: l.filter(m => m.respondeu).length,
    calados: l.filter(m => !m.respondeu).map(m => m.nome || m.pedido),
    comFalha: l.filter(m => m.falhas.length).length,
    falhas: l.reduce((n, m) => n + m.falhas.length, 0),
  };
}
