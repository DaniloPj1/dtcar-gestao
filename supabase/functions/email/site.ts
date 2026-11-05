// Geradores de PDF do próprio site (os mesmos arquivos que a tela usa), carregados do GitHub NUMA VERSÃO TRAVADA (commit).
// O Supabase só aceita importar de alguns endereços (raw.githubusercontent.com sim; o endereço do site não).
// Depois de mudar js/pdf.js, js/boletopdf.js, js/util.js, js/regras.js, js/cnab.js ou js/qr.js: troque o commit abaixo
// pelo da main que tem a mudança e publique a função "email" de novo (o teste_anexos confere que o commit existe).
// jsPDF na mesma versão do vendor/jspdf.umd.min.js do site.
import { jsPDF } from "npm:jspdf@2.5.1";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/b384d4b0ca5e2c786b3e77a216c27e5d69bfdd64/js/pdf.js";
import { nomePdf, pdfBoletos } from "https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/b384d4b0ca5e2c786b3e77a216c27e5d69bfdd64/js/boletopdf.js";
import type { Geradores } from "./anexos.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
export const geradores: Geradores = { pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem };
