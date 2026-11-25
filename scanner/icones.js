/**
 * Os ícones do DTCar Scanner. Traço aberto (sem preenchimento), desenhados para aparecer grandes
 * dentro dos cards azuis do Início — 54 px, traço 1,7. Cada um diz o que a função FAZ, não uma
 * figura genérica: o motor é um bloco com velas, a rede são módulos ligados por fio.
 */
import { html } from "../js/lib.js";

export const FORMAS = {
  // mostrador com ponteiro: os dados ao vivo
  vivo: '<path d="M3.5 17.5a9.5 9.5 0 1 1 17 0"/><path d="M12 17.5 16.2 11"/><circle cx="12" cy="17.5" r="1.6"/><path d="M12 4.2v1.6M4.6 10.3l1.4.8M19.4 10.3l-1.4.8"/>',
  // linha de gráfico subindo dentro de eixos
  grafico: '<path d="M4 3.5v16.5h16.5"/><path d="M7 15.5l3.2-4.4 3 2.2 4.3-6.1"/><circle cx="7" cy="15.5" r=".9"/><circle cx="10.2" cy="11.1" r=".9"/><circle cx="13.2" cy="13.3" r=".9"/><circle cx="17.5" cy="7.2" r=".9"/>',
  // luz de injeção: o desenho do painel do carro
  falha: '<path d="M7.5 7.5h6.2a5.6 5.6 0 0 1 5.6 5.6v.9a3 3 0 0 1-3 3H7.5a3.4 3.4 0 0 1-3.4-3.4v-2.7A3.4 3.4 0 0 1 7.5 7.5Z"/><path d="M9.3 7.5V4.6M13.6 7.5V5.3M5.2 17v2.4M17.6 17v2.4M4.1 12.6H2.3M19.3 10.9h2"/>',
  // módulos ligados por fio: a rede CAN
  rede: '<rect x="2.6" y="3.2" width="6.2" height="4.6" rx="1.2"/><rect x="15.2" y="3.2" width="6.2" height="4.6" rx="1.2"/><rect x="8.9" y="16.2" width="6.2" height="4.6" rx="1.2"/><path d="M5.7 7.8v3.4h12.6V7.8M12 11.2v5"/>',
  // chave de boca sobre régua: as programações que escrevem no carro
  prog: '<path d="M14.6 3.4a4.3 4.3 0 0 0 5.3 5.9l-9.4 9.4a3 3 0 1 1-4.2-4.2l9.4-9.4"/><path d="M6.7 17.3h.01"/><path d="M15.9 14.4l4.6 4.6M18.2 12.1l4.6 4.6"/>',
  // etiqueta com número: chassi e monitores
  chassi: '<rect x="2.6" y="5.4" width="18.8" height="13.2" rx="2"/><path d="M6.2 9.6h5M6.2 12.6h8.4M6.2 15.4h6"/><path d="M17.4 9.4v6"/>',
  // carro de frente: a placa
  carro: '<path d="M4.4 15.6 6 9.4a2.4 2.4 0 0 1 2.3-1.8h7.4a2.4 2.4 0 0 1 2.3 1.8l1.6 6.2"/><path d="M3.2 15.6h17.6a1.3 1.3 0 0 1 1.3 1.3v2a1.3 1.3 0 0 1-1.3 1.3H3.2a1.3 1.3 0 0 1-1.3-1.3v-2a1.3 1.3 0 0 1 1.3-1.3Z"/><path d="M5.6 17.9h2.2M16.2 17.9h2.2"/>',
  // borracha riscando: apagar falha
  apagar: '<path d="M8.6 20.4H4.2a1.6 1.6 0 0 1-1.1-2.8L13.5 7.2a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3l-6.9 6.9H8.6Z"/><path d="M10.4 10.3l5.6 5.6M8.6 20.4h11.8"/>',
  // foto do momento
  foto: '<rect x="2.6" y="6.4" width="18.8" height="13.8" rx="2.2"/><circle cx="12" cy="13.3" r="3.6"/><path d="M8.4 6.4l1.4-2.6h4.4l1.4 2.6"/>',
  // cilindros do motor
  cilindro: '<rect x="3.2" y="8.6" width="17.6" height="11.6" rx="1.6"/><path d="M7 8.6V5.2M12 8.6V3.6M17 8.6V5.2M7 12.4v4.2M12 12.4v4.2M17 12.4v4.2"/>',
  // voltar
  volta: '<path d="M14.6 5.4 8 12l6.6 6.6"/>',
  // raio: atuador
  atuador: '<path d="M13.4 2.6 5.2 13.6h5.4l-1.2 7.8 8.4-11.2h-5.6l1.2-7.6Z"/>',
  // livro aberto: aprendizados
  aprender: '<path d="M12 6.4C10.4 5 8.3 4.4 5.2 4.4v12.4c3.1 0 5.2.6 6.8 2 1.6-1.4 3.7-2 6.8-2V4.4c-3.1 0-5.2.6-6.8 2Z"/><path d="M12 6.4v14"/>',
  // bico injetor
  bico: '<path d="M10 2.8h4v5.4l1.6 2.4v7.2a2 2 0 0 1-2 2h-3.2a2 2 0 0 1-2-2v-7.2L10 8.2V2.8Z"/><path d="M12 19.8v1.6M8.4 12h7.2"/>',
};

/** Ícone de traço. t = tamanho em px, sw = espessura. */
export function Ic({ n, t = 24, sw = 1.8 }) {
  const d = FORMAS[n];
  if (!d) return null;
  return html`<svg width=${t} height=${t} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: d }}></svg>`;
}
