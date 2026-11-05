// Sistema › WhatsApp — conexão própria da oficina (etapa 1: teste, pareamento por QR Code e conferência;
// etapa 2: motor no Android, que mantém a conexão ligada e reveza com o Supabase;
// etapa 3: fila de envio com regras contra bloqueio e conversas — quem envia é o Claude, pelo conector, com ordem do Danilo;
// v32: status de entrega (✓/✓✓/lida), alertas automáticos, conversa ligada ao cadastro, sem resposta e fotos recebidas)
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp } from "../ui.js";
import { AbasMensagens } from "./email.js";
import { fmtDataHora } from "../util.js";

const CMD_INSTALAR = "apt update && yes | apt full-upgrade -y -o Dpkg::Options::=--force-confnew && pkg install -y curl && curl -fsSL https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/main/motor-zap/instalar.sh -o instalar.sh && bash instalar.sh";
const seg = iso => iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : null;
const haQuanto = iso => { const s = seg(iso); if (s === null) return "nunca"; if (s < 60) return "há " + s + " s"; if (s < 3600) return "há " + Math.round(s / 60) + " min"; return fmtDataHora(iso); };
const vale = iso => !!iso && new Date(iso).getTime() > Date.now();
const FILA = { pendente: ["Na fila", "info"], enviando: ["Enviando", "info"], enviada: ["Enviada", "ok"], erro: ["Erro", "bad"], cancelada: ["Cancelada", "muted"] };
const ENTREGA = { enviada: ["✓ Enviada", "muted"], entregue: ["✓✓ Entregue", "info"], lida: ["✓✓ Lida", "ok"], ouvida: ["✓✓ Ouvida", "ok"], erro: ["Não entregue", "bad"] };
const ALERTA = { motor: "Motor do tablet", desvinculado: "WhatsApp desvinculado", erro: "Conexão com problema", fila: "Fila parada" };
const DIAS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
function regrasTexto(r) {
  if (!r) return "";
  const d = (r.dias || []).map(n => DIAS[n]).filter(Boolean);
  return `Envio: ${d.length ? d.join(", ") : "nenhum dia"}, ${r.inicio}–${r.fim}${(r.dias || []).includes(6) && r.sabado_fim ? ` (sábado até ${r.sabado_fim})` : ""} · intervalo de ${r.intervalo_min} a ${r.intervalo_max} s entre mensagens (para o mesmo contato, em seguida: 3 s) · até ${r.por_hora} por hora e ${r.por_dia} por dia.`;
}

const SIT = { desligado: ["Desligado", "muted"], pareando: ["Pareando…", "info"], conectado: ["Vinculado", "ok"], erro: ["Com problema", "bad"] };

export function WhatsApp() {
  const { avisar, confirmar } = useApp();
  const [st, setSt] = useState(null), [erro, setErro] = useState(""), [fazendo, setFazendo] = useState("");
  const [pediu, setPediu] = useState(false), [teste, setTeste] = useState(null), [chave, setChave] = useState("");
  const [fila, setFila] = useState(null), [conversas, setConversas] = useState(null);
  const [resumo, setResumo] = useState(null), [fotos, setFotos] = useState(null), [telAlerta, setTelAlerta] = useState(null);
  const vivo = useRef(true);
  const ler = async (limparErro = false) => {
    try {
      const s = await api.whatsapp.situacao();
      if (vivo.current) { setSt(s); if (limparErro) setErro(""); }
      if (s && "regras" in s) { // v25: fila e conversas
        const [f, c] = await Promise.all([api.whatsapp.fila().catch(() => null), api.whatsapp.conversas().catch(() => null)]);
        if (vivo.current) { setFila(f); setConversas(c); }
        if ("alertas" in s) { // v32: sem resposta e fotos recebidas
          const [r, fo] = await Promise.all([api.whatsapp.resumo().catch(() => null), api.whatsapp.fotos().catch(() => [])]);
          if (vivo.current) { setResumo(r); setFotos(fo); }
        }
      }
      return s;
    } catch (e) { if (vivo.current) setErro(e.message); }
  };
  // a situação do motor muda sozinha (sinal a cada 30 s): a tela acompanha
  useEffect(() => { ler(true); const t = setInterval(() => ler(), 20000); return () => { vivo.current = false; clearInterval(t); }; }, []);
  // enquanto pareia, confere a situação a cada 3 s: o QR muda a cada 20–60 s e o pareamento termina no celular
  // (também quando a tela é reaberta no meio de um pareamento)
  const pareando = pediu || !!(st && st.situacao === "pareando");
  useEffect(() => { if (!pareando) return; const t = setInterval(async () => { const s = await ler(); if (s && s.situacao !== "pareando") { setPediu(false); clearInterval(t); } }, 3000); return () => clearInterval(t); }, [pareando]);
  const fazer = async (acao, extra = {}) => {
    setFazendo(acao); setErro("");
    try { const r = await api.whatsapp.chamar({ acao, ...extra }); await ler(true); return r; }
    catch (e) { setErro(e.message); await ler(); return null; } finally { setFazendo(""); }
  };
  const testar = async () => { const r = await fazer("testar"); if (r) setTeste(r); };
  const conferir = async () => { const r = await fazer("conferir"); if (r) setTeste(r); };
  const parear = async () => { const r = await fazer("parear_qr"); if (r && r.qr) setPediu(true); };
  const desconectar = async () => {
    if (!await confirmar({ titulo: "Desconectar WhatsApp", texto: "O celular da oficina deixa de estar vinculado ao sistema e a sessão guardada é apagada. Para voltar, será preciso parear de novo.", botao: "Desconectar", perigo: true })) return;
    const r = await fazer("desconectar");
    if (!r) return;
    if (r.ok === false) { setErro(r.detalhe || "Não foi possível desconectar agora. Tente de novo em 1 minuto."); return; }
    avisar(r.pedido ? r.detalhe : "WhatsApp desconectado.");
  };
  const processar = async () => { const r = await fazer("processar"); if (r) avisar(r.detalhe || "Pronto."); setTimeout(() => ler(), 15000); };
  const cancelar = async id => {
    if (!await confirmar({ titulo: "Cancelar mensagem", texto: "A mensagem sai da fila e não é enviada.", botao: "Cancelar mensagem", perigo: true })) return;
    try { await api.whatsapp.cancelar(id); await ler(); avisar("Mensagem cancelada."); } catch (e) { setErro(e.message); }
  };
  const salvarAlerta = async () => {
    setFazendo("alerta"); setErro("");
    try { const r = await api.whatsapp.alertaTelefone(telAlerta === null ? (st.alerta_telefone || "") : telAlerta); setTelAlerta(null); await ler(true);
      avisar(r && r.alerta_telefone ? "Os avisos vão para " + r.alerta_telefone + "." : "Avisos pelo WhatsApp desligados (só a faixa na tela)."); }
    catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const copiar = async (txt, msg) => { try { await navigator.clipboard.writeText(txt); avisar(msg); } catch (e) { avisar("Não foi possível copiar: selecione o texto e copie.", true); } };
  const gerarChave = async () => {
    if (st && st.motor_chave_em && !await confirmar({ titulo: "Gerar nova chave do motor", texto: "A chave atual deixa de valer na hora: o motor que estiver usando ela para até receber a nova (bash ~/dtcar-gestao/motor-zap/configurar.sh no celular).", botao: "Gerar nova chave", perigo: true })) return;
    setFazendo("chave"); setErro("");
    try { const c = await api.whatsapp.novaChaveMotor(); setChave(c); await ler(true); } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const revogar = async () => {
    if (!await confirmar({ titulo: "Revogar chave do motor", texto: "O motor do Android para de funcionar e, em até 90 segundos, o Supabase volta a fazer o serviço sob demanda. Use se o celular do motor sumir ou for trocado.", botao: "Revogar", perigo: true })) return;
    setFazendo("revogar"); setErro("");
    try { await api.whatsapp.revogarMotor(); setChave(""); await ler(true); avisar("Chave do motor revogada."); } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  // "pareando" parado há mais de 3 min: a tentativa acabou sem avisar (a função tem 150 s de vida) — trata como problema
  if (st && st.situacao === "pareando" && Date.now() - new Date(st.atualizado_em).getTime() > 180000) setSt({ ...st, situacao: "erro", qr_svg: null, detalhe: "O pareamento anterior não terminou. Mostre o QR Code de novo." });
  const [rot, cor] = SIT[(st && st.situacao) || "desligado"] || SIT.desligado;
  const temV24 = !!st && "motor_chave_em" in st;
  const info = (st && st.motor_info) || null;
  const motorVivo = !!st && seg(st.motor_visto) !== null && seg(st.motor_visto) < 90;
  const [mRot, mCor] = !st || !st.motor_visto ? ["Nunca ligado", "muted"] : motorVivo ? (info && info.conectado ? ["Ligado e conectado", "ok"] : ["Ligado, sem conexão", "info"]) : ["Sem sinal", "bad"];
  const alertas = st && st.alertas ? Object.entries(st.alertas) : [];
  const comVez = st && vale(st.dono_ate) ? (st.dono === "android" ? "motor do Android" : "Supabase (por alguns segundos)") : "ninguém agora — o Supabase conecta quando precisar";
  return html`<div class="pagina">
    <${AbasMensagens} ativa="whatsapp" />
    <div class="card">
      <h3>WhatsApp da oficina</h3>
      <p class="sub">Conexão própria com o WhatsApp do celular da oficina, sem serviço pago. O sistema vincula o celular, mantém a conexão (motor no Android ou, sem ele, o Supabase sob demanda) e envia e guarda mensagens pela fila. Mensagens podem levar um PDF junto (orçamento, O.S., boleto ou NF), que sai logo depois do texto.</p>
      <div class="aviso">Conexão <b>não oficial</b>: o WhatsApp pode bloquear o número se perceber uso automático. Use um número da oficina, só com clientes, sem envio em massa.</div>
      ${!st && !erro ? html`<p class="sub">Carregando…</p>` : null}
      ${st ? html`<ul class="res-lista zap-situacao">
        <li>Situação: <span class=${"pill p-" + cor}>${rot}</span></li>
        <li>Número vinculado: <b>${st.numero || "—"}</b></li>
        <li>Último aviso: ${st.detalhe || "—"}</li>
        <li>Atualizado em ${fmtDataHora(st.atualizado_em)}</li>
      </ul>` : null}
      ${alertas.length ? html`<div class="aviso aviso-erro zap-alertas" role="alert">${alertas.map(([k, a]) => html`<p key=${k}><b>${ALERTA[k] || k}:</b> ${a.texto}</p>`)}</div>` : null}
      ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
    </div>

    <div class="card">
      <h3>1. Testar a conexão</h3>
      <p class="sub">Conecta ao WhatsApp sem vincular nada e confere se ele responde. Nenhum celular é contatado.</p>
      <button type="button" class="btn" disabled=${!!fazendo} onClick=${testar}>${fazendo === "testar" ? "Testando… (até 40 s)" : "Testar conexão"}</button>
      ${teste ? html`<p><span class=${"pill p-" + (teste.ok ? "ok" : "bad")}>${teste.ok ? "Funcionou" : "Não funcionou"}</span> em ${(teste.ms / 1000).toFixed(1)} s${teste.detalhe ? " · " + teste.detalhe : ""}</p>
        ${teste.cifras ? html`<p class="sub">Criptografia do servidor: mensagens ${teste.cifras.gcm && teste.cifras.cbc ? "OK" : "NÃO suportada"} · pareamento por código ${teste.cifras.ctr ? "OK" : "não suportado (use o QR Code)"}</p>` : null}` : null}
    </div>

    <div class="card">
      <h3>2. Vincular o celular da oficina</h3>
      ${st && (st.situacao === "conectado" || st.situacao === "erro") ? html`<p class="sub">${st.situacao === "conectado"
          ? "Celular vinculado. Use \"Conferir\" para testar se a sessão guardada conecta de novo."
          : "Houve um problema. Confira a conexão de novo; se não voltar, desconecte (apaga a sessão) e vincule outra vez."}</p>
        <div class="acoes"><button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${conferir}>${fazendo === "conferir" ? "Conferindo…" : "Conferir conexão"}</button>
          <button type="button" class="btn btn-perigo" disabled=${!!fazendo} onClick=${desconectar}>${fazendo === "desconectar" ? "Desconectando…" : "Desconectar"}</button></div>` : null}
      ${st && st.situacao === "conectado" ? null
      : st && st.situacao === "pareando" ? html`<p>No celular da oficina, abra <b>WhatsApp › Aparelhos conectados › Conectar aparelho</b> e aponte a câmera para o QR Code abaixo.</p>
        ${!("qr_svg" in st) ? html`<div class="aviso">Falta rodar o supabase/v23.sql no Supabase para o QR Code aparecer aqui.</div>`
        : st.qr_svg ? html`<img class="qr-pareamento" alt="QR Code para vincular o celular" src=${"data:image/svg+xml;charset=utf-8," + encodeURIComponent(st.qr_svg)} />` : html`<p class="sub">Gerando o QR Code…</p>`}
        <p class="sub">O QR Code muda sozinho a cada 20–60 segundos; a tela acompanha. Tem cerca de 2 minutos para ler. Esta tela avisa quando o celular terminar.</p>`
      : html`<p class="sub">O sistema mostra um QR Code para você ler com o celular da oficina (o mesmo jeito de conectar o WhatsApp Web). Nada é enviado aos clientes.</p>
        <button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${parear}>${fazendo === "parear_qr" ? "Gerando QR Code…" : "Mostrar QR Code para vincular"}</button>`}
    </div>

    <div class="card">
      <h3>3. Motor no Android</h3>
      <p class="sub">Um celular Android ligado na oficina mantém o WhatsApp conectado o tempo todo (mensagens chegam na hora). Quando ele está desligado ou sem sinal, o Supabase assume sozinho em até 90 segundos, sob demanda.</p>
      ${!st ? null : !temV24 ? html`<div class="aviso">Falta rodar o supabase/v24.sql no Supabase para usar o motor no Android.</div>` : html`
        <ul class="res-lista zap-motor">
          <li>Motor: <span class=${"pill p-" + mCor}>${mRot}</span> · último sinal ${haQuanto(st.motor_visto)}</li>
          ${info ? html`<li>Aparelho: <b>${info.aparelho || "—"}</b> · versão ${info.versao || "?"}</li>
            <li>Mensagens recebidas desde que ligou: <b>${info.recebidas || 0}</b>${info.ultima_recebida ? " · última " + haQuanto(info.ultima_recebida) : ""}</li>
            ${"midias_feitas" in info ? html`<li>Áudios e fotos processados: <b>${info.midias_feitas || 0}</b>${info.midias_com_erro ? " · " + info.midias_com_erro + " com problema" : ""}${info.midias_na_fila ? " · " + info.midias_na_fila + " aguardando" : ""}</li>` : null}` : null}
          <li>Com a conexão agora: ${comVez}</li>
          <li>Chave do motor: ${st.motor_chave_em ? "gerada em " + fmtDataHora(st.motor_chave_em) : "nenhuma"}</li>
          ${st.pedido === "desconectar" ? html`<li><span class="pill p-info">Pedido de desconectar aguardando o motor</span></li>` : null}
        </ul>
        ${chave ? html`<div class="aviso chave-motor">
            <p><b>Chave nova do motor — aparece só agora.</b> Cole no celular do motor quando a instalação pedir. Não mande por WhatsApp nem guarde em outro lugar.</p>
            <input class="inp" readonly value=${chave} onFocus=${e => e.target.select()} aria-label="Chave do motor" />
            <div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => copiar(chave, "Chave copiada.")}>Copiar chave</button>
              <button type="button" class="btn" onClick=${() => setChave("")}>Pronto, já colei</button></div>
          </div>` : null}
        <details class="motor-instalar">
          <summary>Como instalar no celular (uns 15 minutos)</summary>
          <ol>
            <li>No celular do motor, instale o <b>Termux</b> e o <b>Termux:Boot</b> pelo F-Droid (f-droid.org). Não use o Termux da Play Store, que é antigo.</li>
            <li>Abra o <b>Termux:Boot</b> uma vez e feche (isso libera o início automático).</li>
            <li>Bateria: Configurações › Aplicativos › Termux › Bateria › <b>Sem restrições</b>. Faça o mesmo com o Termux:Boot.</li>
            <li>Aqui nesta tela, toque em <b>Gerar chave do motor</b> e em <b>Copiar chave</b> (abra o sistema no próprio celular do motor).</li>
            <li>No Termux, cole o comando abaixo e toque Enter. Quando pedir, cole a chave.</li>
          </ol>
          <input class="inp" readonly value=${CMD_INSTALAR} onFocus=${e => e.target.select()} aria-label="Comando de instalação" />
          <div class="acoes"><button type="button" class="btn" onClick=${() => copiar(CMD_INSTALAR, "Comando copiado. Cole no Termux.")}>Copiar comando</button></div>
          <p class="sub">Para ver o motor trabalhando: <code>tail -f ~/dtcar-motor.log</code>. Para parar: <code>bash ~/dtcar-gestao/motor-zap/parar.sh</code>. Ele liga sozinho quando o celular reinicia.</p>
        </details>
        <div class="acoes">
          <button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${gerarChave}>${fazendo === "chave" ? "Gerando…" : st.motor_chave_em ? "Gerar nova chave" : "Gerar chave do motor"}</button>
          ${st.motor_chave_em ? html`<button type="button" class="btn btn-perigo" disabled=${!!fazendo} onClick=${revogar}>${fazendo === "revogar" ? "Revogando…" : "Revogar chave"}</button>` : null}
        </div>`}
    </div>

    <div class="card">
      <h3>4. Mensagens</h3>
      <p class="sub">Quem envia é o Claude, pelo conector, quando você pede (para o número que você mandar, nada em massa). As mensagens entram nesta fila e saem nas regras abaixo, com os tiques do WhatsApp (✓ enviada, ✓✓ entregue, lida). As respostas dos clientes ficam guardadas para o Claude ler: áudio vira texto (transcrição) e foto fica guardada por 30 dias. Cliente que responder PARAR não recebe mais.</p>
      ${!st ? null : !("regras" in st) ? html`<div class="aviso">Falta rodar o supabase/v25.sql no Supabase para a fila de mensagens.</div>` : html`
        <p class="sub regras-envio">${regrasTexto(st.regras)}</p>
        ${!(st.dono === "android" && vale(st.dono_ate)) ? html`<div class="acoes"><button type="button" class="btn" disabled=${!!fazendo} onClick=${processar}>${fazendo === "processar" ? "Iniciando…" : "Buscar mensagens e enviar a fila agora"}</button></div>
          <p class="sub">Sem o motor do Android ligado, o envio e a busca de mensagens acontecem quando o Claude envia ou lê, ou por este botão (leva até 2 minutos).</p>` : null}
        <h4>Fila</h4>
        ${fila === null ? html`<p class="sub">Carregando…</p>` : !fila.length ? html`<p class="sub">Nenhuma mensagem ainda.</p>` : html`<ul class="zap-fila">
          ${fila.map(f => { const [rot, cor] = FILA[f.status] || [f.status, "muted"]; return html`<li key=${f.id}>
            <div><span class=${"pill p-" + cor}>${rot}</span> <b>${f.cliente_nome || f.telefone}</b>${f.ordem_numero ? " · O.S. " + f.ordem_numero : ""} <span class="sub">· ${fmtDataHora(f.enviada_em || f.criado_em)}${f.fora_horario ? " · fora do horário" : ""}</span></div>
            ${f.texto ? html`<div class="zap-texto">${f.texto}</div>` : null}
            ${f.arquivo ? html`<div class="sub zap-arquivo">📎 ${f.arquivo.nome}${f.arquivo.bytes ? " · " + Math.max(1, Math.round(f.arquivo.bytes / 1024)) + " KB" : ""}${f.arquivo.apagado ? " · apagado da pasta (30 dias)" : ""}</div>` : null}
            ${f.status === "enviada" && "entrega" in f ? (() => { const [er, ec] = ENTREGA[f.entrega || "enviada"] || ENTREGA.enviada; return html`<div class="sub zap-entrega"><span class=${"pill p-" + ec}>${er}</span>${f.lida_em ? " · lida " + fmtDataHora(f.lida_em) : f.entregue_em ? " · entregue " + fmtDataHora(f.entregue_em) : ""}</div>`; })() : null}
            ${f.erro && f.status !== "cancelada" ? html`<div class="sub erro-zap">${f.erro}</div>` : null}
            ${f.status === "pendente" ? html`<button type="button" class="btn btn-sm" onClick=${() => cancelar(f.id)}>Cancelar</button>` : null}
          </li>`; })}</ul>`}
        <h4>Conversas recentes</h4>
        ${conversas === null ? html`<p class="sub">Carregando…</p>` : !conversas.length ? html`<p class="sub">Nenhuma mensagem guardada ainda.</p>` : html`<ul class="zap-conversas">
          ${conversas.map(c => html`<li key=${c.telefone}>
            <div><b>${c.cliente || c.nome_no_whatsapp || c.telefone}</b> <span class="sub">${c.telefone} · ${fmtDataHora(c.ultima_em)}</span>${c.nao_lidas ? html` <span class="pill p-info">${c.nao_lidas} nova${c.nao_lidas > 1 ? "s" : ""}</span>` : null}${c.cadastrado === false ? html` <span class="pill p-muted">Sem cadastro</span>` : null}</div>
            ${c.os_aberta ? html`<div class="sub">O.S. ${c.os_aberta}</div>` : null}
            <div class="zap-texto">${c.ultima_de_mim ? "Oficina: " : ""}${c.ultima_mensagem}${c.ultima_de_mim && c.ultima_entrega && ENTREGA[c.ultima_entrega] ? html` <span class=${"pill p-" + ENTREGA[c.ultima_entrega][1]}>${ENTREGA[c.ultima_entrega][0]}</span>` : null}</div>
          </li>`)}</ul>`}
        ${resumo && resumo.sem_resposta && resumo.sem_resposta.length ? html`<h4>Sem resposta há mais de 2 horas</h4><ul class="zap-conversas zap-sem-resposta">
          ${resumo.sem_resposta.map(c => html`<li key=${c.telefone}><div><b>${c.cliente || c.nome_no_whatsapp || c.telefone}</b> <span class="sub">${c.telefone} · ${fmtDataHora(c.ultima_em)}</span></div><div class="zap-texto">${c.ultima_mensagem}</div></li>`)}</ul>` : null}
        ${fotos && fotos.length ? html`<h4>Fotos recebidas (guardadas por 30 dias)</h4><div class="zap-fotos">
          ${fotos.map(f => html`<figure key=${f.msg_id}>${f.url ? html`<a href=${f.url} target="_blank" rel="noopener"><img src=${f.url} alt=${"Foto de " + (f.nome || f.telefone)} loading="lazy" /></a>` : html`<div class="sub">sem link</div>`}
            <figcaption class="sub">${f.nome || f.telefone} · ${fmtDataHora(f.em)}</figcaption></figure>`)}</div>` : null}`}
    </div>

    ${st && "alertas" in st ? html`<div class="card">
      <h3>5. Alertas automáticos</h3>
      <p class="sub">A cada 5 minutos o sistema confere o WhatsApp. Se o motor do tablet ficar sem sinal por 15 minutos, o celular desvincular o sistema, a conexão ficar com problema ou a fila parar, aparece um aviso vermelho no topo das telas. Para o motor sem sinal, também vai uma mensagem no WhatsApp do número abaixo (no horário de envio) e outra quando ele voltar.</p>
      <p class="sub">Última conferência: ${st.vigiado_em ? haQuanto(st.vigiado_em) : "ainda não (o agendamento do v32 roda a cada 5 minutos)"}.</p>
      <div class="campo"><label for="zap-tel-alerta">Número que recebe os avisos (DDD + número; vazio = só a faixa na tela)</label>
        <input id="zap-tel-alerta" class="inp" inputmode="tel" value=${telAlerta === null ? (st.alerta_telefone || "") : telAlerta} onInput=${e => setTelAlerta(e.target.value)} /></div>
      <div class="acoes"><button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${salvarAlerta}>${fazendo === "alerta" ? "Salvando…" : "Salvar número"}</button></div>
    </div>` : null}
  </div>`;
}
