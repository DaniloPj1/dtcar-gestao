// Geradores de PDF do próprio site (os mesmos arquivos que a tela usa), carregados do GitHub NUMA VERSÃO TRAVADA (commit).
// O Supabase só aceita importar de alguns endereços (raw.githubusercontent.com sim; o endereço do site não).
// Depois de mudar js/pdf.js, js/boletopdf.js, js/mensagens.js (v34), js/pdfrecibo.js ou js/osrecibo.js (O.S. Recibo, 12/11/2026),
// js/pdfresumo.js ou js/resumoos.js (Resumo de O.S. em aberto, 13/11/2026), js/util.js, js/regras.js, js/cnab.js ou js/qr.js: troque o commit abaixo
// pelo da main que tem a mudança e publique a função "email" de novo (o teste_anexos confere que o commit existe).
// jsPDF na mesma versão do vendor/jspdf.umd.min.js do site.
import { jsPDF } from "npm:jspdf@2.5.1";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/6c20bd8391f65b9c473662522c51a60d4d7d9503/js/pdf.js";
import { nomePdf, pdfBoletos } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/b384d4b0ca5e2c786b3e77a216c27e5d69bfdd64/js/boletopdf.js";
import * as mensagens from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/6c20bd8391f65b9c473662522c51a60d4d7d9503/js/mensagens.js";
import { pdfOSRecibo, usarLeitorImagem as usarLeitorRecibo } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/6410bc1d97c658aa045b2edc4e97125267253a0b/js/pdfrecibo.js";
import { osQuitada } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/6410bc1d97c658aa045b2edc4e97125267253a0b/js/osrecibo.js";
import { pdfResumoOS, usarLeitorImagem as usarLeitorResumo } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/8a9affbfb8eaf8a23f58dffc96445a276c3530b1/js/pdfresumo.js";
import { etapaNoResumo, dadosResumoOS, nomeArquivoResumo } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/8a9affbfb8eaf8a23f58dffc96445a276c3530b1/js/resumoos.js";
import type { Geradores } from "./anexos.ts";
export { mensagens };

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
// o leitor de imagem (logo e fotos lidos direto da pasta) vale para os três geradores: O.S./orçamento/checklist, O.S. Recibo e resumo
const usarLeitores = (f: unknown) => { usarLeitorImagem(f); usarLeitorRecibo(f); usarLeitorResumo(f); };
export const geradores: Geradores = { pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem: usarLeitores, pdfOSRecibo, osQuitada,
  pdfResumoOS, etapaNoResumo, dadosResumoOS, nomeArquivoResumo };
