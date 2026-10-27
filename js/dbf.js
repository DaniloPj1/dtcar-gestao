// Leitura de tabelas DBF (dBase / Clipper / Harbour) com memos .DBT e .FPT, no navegador
const dec = new TextDecoder("windows-1252");

function lerMemo(memo, bloco) {
  if (!memo || !(bloco > 0)) return "";
  const v = new DataView(memo.buffer, memo.byteOffset, memo.byteLength);
  if (memo.fpt) { // FoxPro: cabeçalho com tamanho do bloco; cada bloco: tipo (4) + tamanho (4) + dados
    const tam = v.getUint16(6, false) || 64, ini = bloco * tam;
    if (ini + 8 > memo.length) return "";
    const n = v.getUint32(ini + 4, false);
    return dec.decode(memo.subarray(ini + 8, Math.min(memo.length, ini + 8 + n)));
  }
  const ini = bloco * 512; // dBase III / Harbour: blocos de 512 bytes, fim em 0x1A
  if (ini >= memo.length) return "";
  if (memo[ini] === 0xff && memo[ini + 1] === 0xff && memo[ini + 2] === 0x08 && memo[ini + 3] === 0x00) { // dBase IV
    const n = v.getUint32(ini + 4, true); return dec.decode(memo.subarray(ini + 8, Math.min(memo.length, ini + n)));
  }
  let fim = ini; while (fim < memo.length && memo[fim] !== 0x1a) fim++;
  return dec.decode(memo.subarray(ini, fim));
}

/** buf: ArrayBuffer/Uint8Array do .DBF; memo: Uint8Array do .DBT/.FPT (opcional, com .fpt=true para FoxPro). Ignora registros apagados. */
export function lerDBF(buf, memo) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const total = v.getUint32(4, true), cab = v.getUint16(8, true), tamReg = v.getUint16(10, true);
  const campos = [];
  for (let p = 32, desl = 1; p + 32 <= cab && b[p] !== 0x0d; p += 32) {
    let fimNome = p; while (fimNome < p + 11 && b[fimNome] !== 0) fimNome++;
    const tipo = String.fromCharCode(b[p + 11]);
    // texto com mais de 255 caracteres (Clipper/FoxPro): o byte de decimais é a parte alta do tamanho
    const c = { nome: dec.decode(b.subarray(p, fimNome)).trim().toUpperCase(), tipo, tam: tipo === "C" ? b[p + 16] + b[p + 17] * 256 : b[p + 16], dec: tipo === "C" ? 0 : b[p + 17], desl };
    campos.push(c); desl += c.tam;
  }
  const out = [];
  for (let r = 0; r < total; r++) {
    const ini = cab + r * tamReg;
    if (ini + tamReg > b.length) break;
    if (b[ini] === 0x2a) continue; // '*' = apagado
    const reg = {};
    for (const c of campos) {
      if (reg[c.nome] !== undefined) continue; // nome repetido: vale o primeiro (como o dbfread)
      const raw = b.subarray(ini + c.desl, ini + c.desl + c.tam);
      let val;
      if (c.tipo === "C") val = dec.decode(raw).replace(/[\s\0]+$/, "");
      else if (c.tipo === "N" || c.tipo === "F") { const t = dec.decode(raw).trim().replace(",", "."); val = t === "" || isNaN(+t) ? null : +t; }
      else if (c.tipo === "D") { const t = dec.decode(raw).trim(); val = /^\d{8}$/.test(t) && t !== "00000000" ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : null; }
      else if (c.tipo === "L") val = /[TtYy]/.test(String.fromCharCode(raw[0]));
      else if (c.tipo === "M" || c.tipo === "G" || c.tipo === "B") {
        const bloco = c.tam === 4 ? new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true) : parseInt(dec.decode(raw).trim() || "0", 10);
        val = lerMemo(memo, bloco);
      }
      else if (c.tipo === "I") val = new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0, true);
      else val = dec.decode(raw).trim();
      reg[c.nome] = val;
    }
    out.push(reg);
  }
  return out;
}
