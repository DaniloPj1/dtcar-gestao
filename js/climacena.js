// Cena animada atrás do quadro do tempo do Painel (pedido do Danilo em 28/11/2026: "se estiver sol, coloque a
// expressão atrás como se estivesse sol, se for chuva coloque chuva" e depois "mais realismo na interação").
// Desenhada num <canvas> de fundo: céu, luz do sol com raios e reflexo de lente, nuvens macias em camadas que andam
// com o vento, garoa/chuva com profundidade e respingos, relâmpago ramificado, névoa, estrelas e estrela cadente.
// É só enfeite: o nome do tempo continua escrito no quadro. Para quando o quadro sai da tela ou a aba fica escondida
// e, para quem pediu menos movimento no computador, desenha um quadro parado.

/** Sorteio com semente: a cena sai igual a cada abertura (nada "pula" quando o relógio do quadro muda). */
function sorteio(s) {
  return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// céu de cima e de baixo; o texto claro do quadro passa de 4,5:1 nos dois tons
const CEU = {
  sol: ["#174e8e", "#2463a9"], parcial: ["#1d4f88", "#2b5f9b"], nublado: ["#394b5e", "#4b5f73"],
  neblina: ["#47535f", "#55616d"], garoa: ["#334557", "#43576b"], chuva: ["#26364a", "#36495c"],
  tempestade: ["#11171f", "#252e3a"],
};
const CEU_NOITE = {
  sol: ["#08111f", "#152843"], parcial: ["#0a1322", "#182a42"], nublado: ["#19222c", "#29343f"],
  neblina: ["#1d252e", "#2d3742"], garoa: ["#121a23", "#212c38"], chuva: ["#0f161e", "#1d2834"],
  tempestade: ["#080b10", "#171d26"],
};
// nuvens: quantas, tom (255 = branca) e quanto aparecem; gotas e vento da chuva
const CFG = {
  sol:        { nuvens: 2, tom: 255, alfa: .34, sol: 1 },
  parcial:    { nuvens: 5, tom: 250, alfa: .52, sol: .75 },
  nublado:    { nuvens: 9, tom: 222, alfa: .5 },
  neblina:    { nuvens: 4, tom: 230, alfa: .26, nevoa: .85 },
  garoa:      { nuvens: 8, tom: 196, alfa: .55, gotas: 150, garoa: true, nevoa: .45, vento: -25 },
  chuva:      { nuvens: 9, tom: 178, alfa: .62, gotas: 300, vento: -70 },
  tempestade: { nuvens: 10, tom: 128, alfa: .78, gotas: 460, vento: -190, raios: true },
};

/** Nuvem macia pré-desenhada: vários "chumaços" redondos, borrados, com a barriga mais escura (como nuvem de verdade). */
function fazNuvem(r, larg, alt, tom) {
  const c = document.createElement("canvas"); c.width = Math.ceil(larg + 40); c.height = Math.ceil(alt + 40);
  const t = document.createElement("canvas"); t.width = c.width; t.height = c.height;
  const g = t.getContext("2d");
  const n = 10 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI, px = 20 + larg / 2 + Math.cos(ang) * larg * .42 * r() * (r() < .5 ? -1 : 1);
    const py = 20 + alt * .62 - Math.sin(ang) * alt * .45 * r();
    const raio = alt * (.28 + r() * .32);
    const gr = g.createRadialGradient(px, py - raio * .25, raio * .1, px, py, raio);
    gr.addColorStop(0, `rgba(${tom},${tom},${Math.min(255, tom + 8)},1)`);
    gr.addColorStop(.6, `rgba(${tom},${tom},${Math.min(255, tom + 8)},.75)`);
    gr.addColorStop(1, `rgba(${tom},${tom},${Math.min(255, tom + 8)},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, raio, 0, Math.PI * 2); g.fill();
  }
  // barriga da nuvem mais escura
  g.globalCompositeOperation = "source-atop";
  const sb = g.createLinearGradient(0, 20, 0, c.height - 10);
  sb.addColorStop(0, "rgba(255,255,255,.10)"); sb.addColorStop(.55, "rgba(0,0,0,0)"); sb.addColorStop(1, "rgba(20,30,45,.32)");
  g.fillStyle = sb; g.fillRect(0, 0, c.width, c.height);
  const cg = c.getContext("2d"); cg.filter = "blur(3px)"; cg.drawImage(t, 0, 0);
  return c;
}

/** Faixa de névoa pré-desenhada, bem borrada. */
function fazNevoa(r, larg, alt) {
  const c = document.createElement("canvas"); c.width = Math.ceil(larg); c.height = Math.ceil(alt + 40);
  const t = document.createElement("canvas"); t.width = c.width; t.height = c.height; const g = t.getContext("2d");
  for (let i = 0; i < 26; i++) {
    const px = r() * larg, py = 20 + alt / 2 + (r() - .5) * alt * .5, rx = 40 + r() * 90, ry = 10 + r() * 16;
    g.fillStyle = `rgba(235,240,245,${.25 + r() * .3})`; g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
  const cg = c.getContext("2d"); cg.filter = "blur(12px)"; cg.drawImage(t, 0, 0);
  return c;
}

/** Relâmpago: caminho que desce em zigue-zague, com galhos. */
function fazRaio(r, W, H) {
  const caminho = (x, y, fim, ramo) => { const p = [[x, y]];
    while (y < fim) { y += 8 + r() * 16; x += (r() - .5) * (ramo ? 20 : 28); p.push([x, y]); }
    return p; };
  const x0 = W * (.3 + r() * .6), fim = H * (.55 + r() * .4);
  const tronco = caminho(x0, -5, fim, false), galhos = [];
  for (let i = 3; i < tronco.length - 3; i++) if (r() < .16) {
    const [gx, gy] = tronco[i]; galhos.push(caminho(gx, gy, gy + H * (.1 + r() * .2), true)); }
  return { tronco, galhos };
}

/**
 * Liga a cena no canvas. Devolve a função que desliga (o componente chama ao trocar de tempo ou sair do Painel).
 * opts: { cena, noite, parado }
 */
export function animarCena(canvas, { cena = "parcial", noite = false, parado = false } = {}) {
  const ctx = canvas.getContext("2d"); if (!ctx) return () => {};
  const cfg = CFG[cena] || CFG.parcial, ceu = (noite ? CEU_NOITE : CEU)[cena] || CEU.parcial;
  const quadro = canvas.closest(".clima") || canvas.parentElement;
  let W = 0, H = 0, dpr = 1, nuvens = [], gotas = [], respingos = [], estrelas = [], nevoas = [], solX = 64, solY = 62;
  let raio = null, raioEm = -9, proxRaio = 2 + Math.random() * 4, cadente = null, proxCadente = 8 + Math.random() * 12;
  let t = 0, ultimo = 0, quadros = 0, vivo = true, visivel = true, pedido = 0;

  const montar = () => {
    const w = quadro.clientWidth, h = quadro.clientHeight; if (!w || !h) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; H = h;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ic = quadro.querySelector(".clima-ln .clima-ic");
    if (ic) { const a = ic.getBoundingClientRect(), b = quadro.getBoundingClientRect();
      solX = a.left - b.left + a.width / 2; solY = a.top - b.top + a.height / 2; }
    const r = sorteio(cena.length * 7919 + (noite ? 13 : 0));
    nuvens = Array.from({ length: cfg.nuvens || 0 }, (_, i) => { const z = .45 + r() * .55, larg = (110 + r() * 150) * (.7 + z * .5);
      return { img: fazNuvem(r, larg, larg * (.36 + r() * .14), Math.round(cfg.tom * (.86 + z * .14))), z,
        x: r() * (W + larg) - larg, y: -larg * .08 + r() * H * (cena === "sol" || cena === "parcial" ? .5 : .62),
        v: (5 + z * 11) * (cfg.vento ? 1.6 : 1), a: cfg.alfa * (.55 + z * .45) }; }).sort((a, b) => a.z - b.z);
    nevoas = cfg.nevoa ? [.3, .52, .74, .94].map((p, i) => ({ img: fazNevoa(r, W * 1.8, 70 + r() * 40), y: H * p - 55, x: -r() * W * .6,
      v: (6 + i * 3) * (i % 2 ? -1 : 1), a: cfg.nevoa * (.55 + r() * .35) })) : [];
    estrelas = noite ? Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * .75, s: .4 + r() * 1.2, f: .6 + r() * 2.2, p: r() * 6 })) : [];
    gotas = Array.from({ length: cfg.gotas || 0 }, () => novaGota(r, true));
    return true;
  };
  const novaGota = (r = Math.random, espalhar = false) => { const z = .25 + r() * .75;
    const vel = cfg.garoa ? 140 + 110 * z : cena === "tempestade" ? 620 + 420 * z : 440 + 360 * z;
    return { z, x: r() * (W + 160) - 20, y: espalhar ? r() * H : -20 - r() * H * .25, vel,
      len: cfg.garoa ? 3 + 6 * z : (cena === "tempestade" ? 16 : 11) + 14 * z, fimY: H * (.72 + .3 * z) }; };

  const vento = () => (cfg.vento || 0) * (cena === "tempestade" ? 1 + .45 * Math.sin(t * .7) + .25 * Math.sin(t * 2.3) : 1 + .15 * Math.sin(t * .5));

  const desenhar = dt => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // céu
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, ceu[0]); g.addColorStop(1, ceu[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // estrelas e estrela cadente
    if (estrelas.length) {
      ctx.fillStyle = "#fff";
      for (const e of estrelas) { ctx.globalAlpha = .25 + .6 * (.5 + .5 * Math.sin(t * e.f + e.p)); ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      if ((cena === "sol" || cena === "parcial") && !parado) {
        if (!cadente && t > proxCadente) cadente = { x: W * (.35 + Math.random() * .6), y: H * (.04 + Math.random() * .25), t0: t };
        if (cadente) { const k = (t - cadente.t0) / .9;
          if (k >= 1) { cadente = null; proxCadente = t + 14 + Math.random() * 18; }
          else { const x = cadente.x - k * 170, y = cadente.y + k * 70, gr = ctx.createLinearGradient(x, y, x + 60, y - 25);
            gr.addColorStop(0, `rgba(255,255,255,${.9 * (1 - k)})`); gr.addColorStop(1, "rgba(255,255,255,0)");
            ctx.strokeStyle = gr; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 25); ctx.stroke(); } }
      }
    }

    // sol: brilho, raios girando devagar e reflexo de lente; à noite, o luar
    if (cfg.sol && !noite) {
      const forca = cfg.sol, brilho = ctx.createRadialGradient(solX, solY, 0, solX, solY, 190);
      brilho.addColorStop(0, `rgba(255,240,190,${.5 * forca})`); brilho.addColorStop(.25, `rgba(255,226,150,${.2 * forca})`);
      brilho.addColorStop(1, "rgba(255,226,150,0)"); ctx.fillStyle = brilho; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(solX, solY); ctx.rotate(t * .025);
      for (let i = 0; i < 16; i++) { const ang = i / 16 * Math.PI * 2, comp = 260 + 160 * (.5 + .5 * Math.sin(i * 2.7)),
          a = (.05 + .04 * (.5 + .5 * Math.sin(t * .8 + i * 1.9))) * forca, lg = ctx.createRadialGradient(0, 0, 20, 0, 0, comp);
        lg.addColorStop(0, `rgba(255,240,200,${a})`); lg.addColorStop(1, "rgba(255,240,200,0)"); ctx.fillStyle = lg;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, comp, ang - .045, ang + .045); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      const dx = W * .62 - solX, dy = H * .78 - solY, osc = Math.sin(t * .3) * .03;
      [[.55, 14, "255,230,170", .07], [.9, 30, "170,210,255", .05], [1.25, 9, "255,255,255", .09], [1.6, 46, "200,230,255", .035]]
        .forEach(([k, rr, cor, a]) => { const fx = solX + dx * (k + osc), fy = solY + dy * (k + osc), fl = ctx.createRadialGradient(fx, fy, 0, fx, fy, rr);
          fl.addColorStop(0, `rgba(${cor},${a * forca * 1.6})`); fl.addColorStop(.7, `rgba(${cor},${a * forca})`); fl.addColorStop(1, `rgba(${cor},0)`);
          ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(fx, fy, rr, 0, 7); ctx.fill(); });
    } else if (noite && (cena === "sol" || cena === "parcial")) {
      const luar = ctx.createRadialGradient(solX, solY, 0, solX, solY, 150);
      luar.addColorStop(0, "rgba(243,231,184,.22)"); luar.addColorStop(1, "rgba(243,231,184,0)"); ctx.fillStyle = luar; ctx.fillRect(0, 0, W, H);
    }

    // nuvens (as de trás mais devagar e mais claras), passando na frente do sol
    const v = vento();
    for (const n of nuvens) {
      n.x += (n.v + Math.max(0, -v) * .12 * n.z) * dt;
      if (n.x > W + 10) n.x = -n.img.width;
      ctx.globalAlpha = n.a * (noite ? .55 : 1); ctx.drawImage(n.img, n.x, n.y, n.img.width, n.img.height);
    }
    ctx.globalAlpha = 1;

    // relâmpago: clarão duplo e o raio aceso por um instante (bem abaixo do limite de piscadas seguras)
    if (cfg.raios) {
      if (!parado && t > proxRaio) { raio = fazRaio(Math.random, W, H); raioEm = t; proxRaio = t + 5 + Math.random() * 7; }
      const d = t - raioEm, clarao = d < 0 ? 0 : .3 * Math.exp(-d * 10) + (d > .14 ? .2 * Math.exp(-(d - .14) * 9) : 0);
      if (clarao > .004) { ctx.fillStyle = `rgba(205,220,255,${clarao})`; ctx.fillRect(0, 0, W, H); }
      if (raio && d < .42 && (d < .09 || d > .14)) {
        ctx.save(); ctx.shadowColor = "rgba(170,200,255,.95)"; ctx.shadowBlur = 16; ctx.lineJoin = "round";
        const linha = (p, lw, a) => { ctx.strokeStyle = `rgba(240,245,255,${a})`; ctx.lineWidth = lw; ctx.beginPath();
          p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
        const a = d < .09 ? 1 : Math.max(0, 1 - (d - .14) / .28);
        linha(raio.tronco, 2.4, a); raio.galhos.forEach(gl => linha(gl, 1.1, a * .8)); ctx.restore();
      }
    }

    // névoa
    for (const n of nevoas) { n.x += n.v * dt; if (n.x > 0) n.v = -Math.abs(n.v); if (n.x < W - n.img.width) n.v = Math.abs(n.v);
      ctx.globalAlpha = n.a; ctx.drawImage(n.img, n.x, n.y); }
    ctx.globalAlpha = 1;

    // garoa e chuva: as gotas de longe são finas, lentas e apagadas; as de perto, compridas e respingam no chão
    if (gotas.length) {
      ctx.lineCap = "round";
      for (const gt of gotas) {
        if (!parado) { gt.y += gt.vel * dt; gt.x += v * (.4 + gt.z) * dt + (cfg.garoa ? Math.sin(t * 2 + gt.z * 9) * 6 * dt : 0); }
        if (gt.y - gt.len > gt.fimY || gt.x < -40 || gt.x > W + 200) {
          if (!cfg.garoa && gt.z > .62 && Math.random() < .55) respingos.push({ x: gt.x, y: gt.fimY, z: gt.z, t0: t });
          Object.assign(gt, novaGota()); continue; }
        const inc = v / gt.vel; ctx.strokeStyle = `rgba(210,228,250,${(cfg.garoa ? .2 : .14) + .38 * gt.z})`;
        ctx.lineWidth = (cfg.garoa ? .5 : .6) + 1.1 * gt.z;
        ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gt.x - inc * gt.len, gt.y - gt.len); ctx.stroke();
      }
      respingos = respingos.filter(s => { const k = (t - s.t0) / .28; if (k >= 1) return false;
        const rr = 1 + 5 * s.z * k; ctx.strokeStyle = `rgba(215,230,250,${.45 * (1 - k)})`; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, rr * 1.8, rr * .5, 0, 0, 7); ctx.stroke();
        ctx.fillStyle = `rgba(215,230,250,${.5 * (1 - k)})`;
        ctx.fillRect(s.x - 3 * k * 4, s.y - 7 * k * (1 - k) * 4, 1.2, 1.2); ctx.fillRect(s.x + 3 * k * 4, s.y - 6 * k * (1 - k) * 4, 1.2, 1.2);
        return true; });
    }
  };

  const passo = agora => {
    if (!vivo) return;
    pedido = requestAnimationFrame(passo);
    if (!visivel || document.hidden) { ultimo = agora; return; }
    const dt = ultimo ? Math.min(.05, (agora - ultimo) / 1000) : 0; ultimo = agora; t += dt;
    if (!W && !montar()) return;
    desenhar(dt); quadros++;
    if (quadros % 15 === 1) canvas.dataset.quadros = String(quadros);
  };

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (montar() && parado) desenhar(0); }) : null;
  if (ro) ro.observe(quadro);
  const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(es => { visivel = es.some(e => e.isIntersecting); }) : null;
  if (io) io.observe(canvas);

  if (parado) { t = 3; if (montar()) { desenhar(0); canvas.dataset.quadros = "1"; } }
  else pedido = requestAnimationFrame(passo);

  return () => { vivo = false; cancelAnimationFrame(pedido); if (ro) ro.disconnect(); if (io) io.disconnect(); };
}
