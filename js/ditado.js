// Segurar para falar — o MESMO ditado do app do mecânico (mecanico/app.js), como módulo para o App DTCar.
// MUDOU AQUI? Mude também a cópia do mecanico/app.js. Ouve enquanto o botão está apertado (pointerdown/up):
// aoMudar(parcial) mostra o que está ouvindo; aoTerminar(texto) entrega o final. O Chrome encerra sozinho no
// silêncio: com o botão ainda apertado, volta a ouvir. A 1ª vez pede o microfone ao celular.
export function criarDitado(avisar) {
  const st = { falando: false, rec: null, micOk: false };
  const MOTIVO = { "not-allowed": "O microfone está bloqueado para este app. Libere em Configurações do site › Microfone.", "service-not-allowed": "O ditado está desligado neste celular. Use o microfone do teclado.",
    "audio-capture": "Não achei o microfone do celular.", network: "O ditado precisa de internet.", "language-not-supported": "Este celular não tem ditado em português." };
  const segurar = (aoMudar, aoTerminar) => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (st.falando) return;
    if (!R) { avisar("Este navegador não tem ditado. Abra o app pelo Chrome ou use o microfone do teclado."); return; }
    if (navigator.onLine === false) { avisar("O ditado precisa de internet."); return; }
    const comecar = () => {
      let junto = "", parte = "";
      const sessao = () => {
        const r = new R(); st.rec = r; parte = ""; r.lang = "pt-BR"; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
        r.onresult = e => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + " "; parte = t.trim(); aoMudar((junto + " " + parte).trim()); };
        r.onerror = e => { if (e.error === "no-speech" || e.error === "aborted") return; st.falando = false; avisar(MOTIVO[e.error] || "Não consegui ouvir (" + e.error + "). Use o microfone do teclado."); };
        r.onend = () => { junto = (junto + " " + parte).trim(); parte = ""; if (st.falando) { try { sessao(); return; } catch (e) { st.falando = false; } } st.rec = null; aoTerminar(junto); };
        r.start();
      };
      try { sessao(); } catch (e) { st.falando = false; aoTerminar(""); avisar("Não consegui ligar o ditado. Use o microfone do teclado."); }
    };
    if (st.micOk || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { st.falando = true; aoMudar(""); comecar(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(fluxo => { fluxo.getTracks().forEach(t => t.stop()); st.micOk = true; avisar("Microfone liberado. Agora segure o botão e fale."); })
      .catch(() => { avisar(MOTIVO["not-allowed"]); });
  };
  const soltar = () => { st.falando = false; if (st.rec) { try { st.rec.stop(); } catch (e) {} } };
  return { segurar, soltar, falando: () => st.falando };
}
