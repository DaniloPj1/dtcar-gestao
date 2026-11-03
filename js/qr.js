// Gerador de QR Code (ISO/IEC 18004) para o "Pix copia e cola" do boleto híbrido.
// Só o necessário: modo byte, correção de erro nível M, versão escolhida pelo tamanho do texto.
// Devolve a matriz de módulos (true = escuro), que o PDF desenha como quadradinhos.

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCOS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

function modulosDeDados(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const palavrasDeDados = v => Math.floor(modulosDeDados(v) / 8) - ECC_M[v] * BLOCOS_M[v];

function posicoesAlinhamento(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, tam = v * 4 + 17;
  const passo = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= passo) r.splice(1, 0, p);
  return r;
}

/* Reed-Solomon em GF(256), polinômio 0x11D */
function mult(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function divisor(grau) {
  const r = new Array(grau).fill(0); r[grau - 1] = 1; let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mult(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    raiz = mult(raiz, 0x02);
  }
  return r;
}
function resto(dados, div) {
  const r = div.map(() => 0);
  for (const b of dados) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mult(c, f); }); }
  return r;
}

/** Matriz do QR Code para o texto (UTF-8). */
export function qrMatriz(texto) {
  const bytes = Array.from(new TextEncoder().encode(texto));
  let v = 1;
  for (; v <= 40; v++) { const bitsCont = v < 10 ? 8 : 16; if (4 + bitsCont + bytes.length * 8 <= palavrasDeDados(v) * 8) break; }
  if (v > 40) throw new Error("Texto grande demais para o QR Code.");
  // bits: modo byte (0100), contagem, dados, terminador e enchimento
  const bits = [];
  const poe = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poe(4, 4); poe(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => poe(b, 8));
  const cap = palavrasDeDados(v) * 8;
  poe(0, Math.min(4, cap - bits.length));
  poe(0, (8 - bits.length % 8) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) poe(p, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // blocos com correção de erro, intercalados
  const nb = BLOCOS_M[v], ecc = ECC_M[v], brutas = Math.floor(modulosDeDados(v) / 8);
  const curtos = nb - brutas % nb, tamCurto = Math.floor(brutas / nb);
  const div = divisor(ecc), blocos = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = dados.slice(k, k + tamCurto - ecc + (i < curtos ? 0 : 1)); k += d.length;
    const e = resto(d, div); if (i < curtos) d.push(0); blocos.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++) blocos.forEach((b, j) => { if (i !== tamCurto - ecc || j >= curtos) final.push(b[i]); });

  const tam = v * 4 + 17;
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fixo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const set = (x, y, escuro) => { m[y][x] = escuro; fixo[y][x] = true; };
  // padrões de tempo
  for (let i = 0; i < tam; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // localizadores
  const localizador = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
    if (x >= 0 && x < tam && y >= 0 && y < tam) set(x, y, d !== 2 && d !== 4); } };
  localizador(3, 3); localizador(tam - 4, 3); localizador(3, tam - 4);
  // alinhamento
  const al = posicoesAlinhamento(v);
  al.forEach((a, i) => al.forEach((b, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // áreas de formato e versão (reservadas antes de colocar os dados)
  const formato = mascara => {
    const dado = (0 << 3) | mascara; // nível M = 00
    let r = dado; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((dado << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, bit(i));
    set(8, tam - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) !== 0, a = tam - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }
  // dados em zigue-zague
  let i = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < tam; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, sobe = ((dir + 1) & 2) === 0, y = sobe ? tam - 1 - vert : vert;
      if (!fixo[y][x] && i < final.length * 8) { m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  // máscara: escolhe a de menor penalidade
  const aplica = k => { for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    let inv; switch (k) { case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
      case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = x * y % 2 + x * y % 3 === 0; break;
      case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break; default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0; }
    if (!fixo[y][x] && inv) m[y][x] = !m[y][x]; } };
  let melhor = 0, menor = Infinity;
  for (let k = 0; k < 8; k++) { aplica(k); formato(k); const p = penalidade(m, tam); if (p < menor) { menor = p; melhor = k; } aplica(k); }
  aplica(melhor); formato(melhor);
  return m;
}

function penalidade(m, tam) {
  let p = 0;
  const linhas = (get) => {
    for (let a = 0; a < tam; a++) {
      let cor = false, corrida = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      const conta = () => { const n = hist[1]; const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
        return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0); };
      const empurra = c => { if (hist[0] === 0) c += tam; hist.pop(); hist.unshift(c); };
      for (let b = 0; b < tam; b++) {
        if (get(a, b) === cor) { corrida++; if (corrida === 5) p += 3; else if (corrida > 5) p++; }
        else { empurra(corrida); if (!cor) p += conta() * 40; cor = get(a, b); corrida = 1; }
      }
      // fim da linha
      if (cor) { empurra(corrida); corrida = 0; }
      corrida += tam; empurra(corrida); p += conta() * 40;
    }
  };
  linhas((y, x) => m[y][x]);
  linhas((x, y) => m[y][x]);
  for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  let escuros = 0; m.forEach(l => l.forEach(c => { if (c) escuros++; }));
  const total = tam * tam, k = Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1;
  return p + k * 10;
}
