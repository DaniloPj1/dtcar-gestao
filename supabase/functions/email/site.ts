// Geradores de PDF do próprio site (os mesmos arquivos que a tela usa), carregados do endereço publicado.
// O Supabase junta estes arquivos na hora do Deploy: depois de mudar js/pdf.js, js/boletopdf.js, js/util.js,
// js/regras.js, js/cnab.js ou js/qr.js no site, publique a função "email" de novo para o PDF do e-mail acompanhar.
// jsPDF na mesma versão do vendor/jspdf.umd.min.js do site.
import { jsPDF } from "npm:jspdf@2.5.1";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "https://gestao.dtcarcentroautomotivo.com.br/js/pdf.js";
import { nomePdf, pdfBoletos } from "https://gestao.dtcarcentroautomotivo.com.br/js/boletopdf.js";
import type { Geradores } from "./anexos.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
export const geradores: Geradores = { pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem };
