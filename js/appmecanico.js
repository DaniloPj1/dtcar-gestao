// Lista de itens que o mecânico marca no app (/mecanico/) e a tela do administrador que a edita.
// UMA fonte só: o app do mecânico e a tela "App do mecânico" do sistema leem este arquivo.
// O padrão fica aqui; o que o administrador muda fica em cfg.appMecanico (tabela config, já no backup e no banco do PC):
//   { sistemas: { <id>: { ocultos: [nome], renomes: { <nome original>: <novo nome> }, opcoes: { <nome original>: [opções] },
//                         novos: [{ id, nome, icone, tipo, pos, opcoes }] } } }
// tipo: 'jogo' (um toque), 'par' (botões 1 | 2), 'un' (só marcar), 'cont' (contador).
// pos: 'none' | 'chips' (Diant. | Tras. | Os 2) | 'chips2' (Dianteira | Traseira | As 2) | lista de opções (pode marcar mais de uma).

/** [id, nome, caminho do desenho (grade 32x32, traço de 2)] — mesma família de ícones do app. */
export const ICONES = [
  ["disco", "Disco de freio", "M4 16a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M11.5 16a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0M14.7 8.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M21.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M19.2 22a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M10.2 22a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M7.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0"],
  ["pastilha", "Pastilha", "M3 23C9 11 23 11 29 23l-3 4C20 18 12 18 6 27zM13 17.5v4M19 17.5v4"],
  ["sapata", "Sapata", "M5 25a11 11 0 0 1 22 0M9.5 25a6.5 6.5 0 0 1 13 0M5 25h4.5M22.5 25H27"],
  ["tambor", "Tambor", "M4 16a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M9 16a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M14 16a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M16 4v2.5M16 25.5V28M4 16h2.5M25.5 16H28"],
  ["cilindro", "Cilindro de roda", "M9.5 11h13a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1 -2.5 2.5h-13a2.5 2.5 0 0 1 -2.5 -2.5v-5a2.5 2.5 0 0 1 2.5 -2.5zM2.5 16H7M25 16h4.5M16 11v10"],
  ["fluido", "Fluido", "M12 3h8v5l3.5 5V28a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V13L12 8zM8.5 18h15M8.5 23h15"],
  ["cabo", "Cabo", "M3 24a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M23 8a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M8.5 22.5C12 12 18 26 23.5 9.5"],
  ["servo", "Servo de freio", "M3 16a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M9 16a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M23 13h6v6h-6"],
  ["amortecedor", "Amortecedor", "M16 2v8M13 10h6a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2zM16 23v7M5 9l5 2-5 3 5 3-5 3 5 2"],
  ["kitamort", "Kit amortecedor", "M10 2.5h12a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-1a2 2 0 0 1 2 -2zM16 7.5V11M13 11h6a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2zM16 23v6.5M5 12l4 1.5-4 2.5 4 2.5-4 2.5"],
  ["bieleta", "Bieleta", "M3.5 25a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0M21.5 7a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0M9.5 22.5l13-13"],
  ["bucha", "Bucha", "M5 16a11 11 0 1 0 22 0a11 11 0 1 0 -22 0M11 16a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M2 16h3M27 16h3"],
  ["pivo", "Pivô", "M12 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M13 11l-3.5 17h13L19 11M11.5 22h9"],
  ["bandeja", "Bandeja", "M4 26L15 6l13 20zM12.8 7.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M3.3 25a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M24.3 25a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0"],
  ["rolamento", "Rolamento", "M3.5 16a12.5 12.5 0 1 0 25 0a12.5 12.5 0 1 0 -25 0M10 16a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M14.7 9.7a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M20.2 12.8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M20.2 19.2a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M14.7 22.3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M9.2 19.2a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M9.2 12.8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0"],
  ["mola", "Mola", "M7 7l18-3.5M7 12.5l18-3.5M7 18l18-3.5M7 23.5L25 20M7 29l18-3.5"],
  ["pontaeixo", "Ponta de eixo", "M2 16h16M19.5 5h2a1.5 1.5 0 0 1 1.5 1.5v19a1.5 1.5 0 0 1 -1.5 1.5h-2a1.5 1.5 0 0 1 -1.5 -1.5v-19a1.5 1.5 0 0 1 1.5 -1.5zM23 11h7v10h-7"],
  ["axial", "Barra axial", "M2 16a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0M23 16a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0M9 16h14M13 13v6M19 13v6"],
  ["ponteira", "Ponteira", "M2.5 16a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M10.5 16H29M17 13v6M21 13v6M25 13v6"],
  ["caixadir", "Caixa de direção", "M5.5 14h21a3 3 0 0 1 3 3v3a3 3 0 0 1 -3 3h-21a3 3 0 0 1 -3 -3v-3a3 3 0 0 1 3 -3zM16 14V8M13 5.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
  ["coifa", "Coifa", "M2 14h4l2-5 3.5 14 3.5-14 3.5 14 3.5-14 2 5h4"],
  ["alinha", "Alinhamento", "M11.5 6l9-1.5 3 21-9 2zM16 2v28"],
  ["oleo", "Óleo", "M16 3S6.5 14 6.5 20a9.5 9.5 0 0 0 19 0C25.5 14 16 3 16 3zM11.5 20.5a4.5 4.5 0 0 0 4 4.5"],
  ["correia", "Correia dentada", "M3 16a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M17 16a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M9 10h14M9 22h14M7.5 16a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M21.5 16a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"],
  ["bomba", "Bomba", "M4 16a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M13.5 16a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M16 4.5V13.5M16 18.5v9M4.5 16h9M18.5 16h9"],
  ["termostato", "Termostática", "M10.5 23a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0M13.5 18V6a2.5 2.5 0 0 1 5 0v12M16 12v11"],
  ["vela", "Vela", "M12.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -1.5 1.5h-7a1.5 1.5 0 0 1 -1.5 -1.5v-3a1.5 1.5 0 0 1 1.5 -1.5zM10 8.5h12v6H10zM13 14.5V25l3 4 3-4V14.5"],
  ["coximmotor", "Coxim", "M4 27h24M8 27l3-14h10l3 14M13 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12.5 20h7"],
  ["embreagem", "Embreagem", "M3 16a13 13 0 1 0 26 0a13 13 0 1 0 -26 0M8 16a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M13.5 16a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0"],
  ["homocin", "Homocinética", "M1.5 16H8M24 16h6.5M8 16a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12.8 16a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0"],
  ["engrenagem", "Engrenagem", "M11 16a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M7 16a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"],
  ["volante", "Volante", "M3.5 16a12.5 12.5 0 1 0 25 0a12.5 12.5 0 1 0 -25 0M12.8 16a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0M3.5 15.5h9M19.5 15.5h9M16 19.5V28.5"],
  ["motor", "Motor", "M5 12h5V8h10v4h5v3h3v7h-3v3H5zM10 12v-0M12 18h8"],
  ["filtroar", "Filtro de ar", "M6 9h20a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-20a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM9 9v14M14 9v14M19 9v14M24 9v14"],
  ["filtrooleo", "Filtro de óleo", "M11 8h10a3 3 0 0 1 3 3v13a3 3 0 0 1 -3 3h-10a3 3 0 0 1 -3 -3v-13a3 3 0 0 1 3 -3zM11 8V4h10v4M8 15h16M16 18v5"],
  ["filtrocomb", "Filtro de combustível", "M12 8h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM13 8V4M19 8V4M10 14h12M10 20h12"],
  ["bateria", "Bateria", "M5 11h22a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-22a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2zM8 11V7h4v4M20 11V7h4v4M7 19h6M21 16v6M18 19h6"],
  ["lampada", "Lâmpada", "M10.5 18A8 8 0 1 1 21.5 18c-1 1-1.5 2-1.5 4h-8c0-2-.5-3-1.5-4zM12 25h8M13.5 28.5h5"],
  ["radiador", "Radiador", "M7 8h18a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-18a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2zM10 8v16M15 8v16M20 8v16M2 12h3M27 12h3"],
  ["escape", "Escapamento", "M13 10h6a6 6 0 0 1 6 6v0a6 6 0 0 1 -6 6h-6a6 6 0 0 1 -6 -6v0a6 6 0 0 1 6 -6zM2 16h5M25 16h5M13 10v12M19 10v12"],
  ["turbina", "Turbina", "M4 16a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M16 4c3 4 3 8 0 12M28 16c-4 3-8 3-12 0M16 28c-3-4-3-8 0-12M4 16c4-3 8-3 12 0"],
  ["bombacomb", "Bomba de combustível", "M11 4h10a4 4 0 0 1 4 4v16a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4v-16a4 4 0 0 1 4 -4zM12 11h8M12 16h8M12 21h5"],
  ["bico", "Bico injetor", "M12 3h8v7h-8zM13 10v10l3 4 3-4V10M16 24v5"],
  ["alternador", "Alternador", "M4 16a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M17 6l-6 11h5l-1 9 7-12h-5z"],
  ["arranque", "Motor de arranque", "M6 12h11a3 3 0 0 1 3 3v4a3 3 0 0 1 -3 3h-11a3 3 0 0 1 -3 -3v-4a3 3 0 0 1 3 -3zM20 15h6v4h-6M26 13v8M7 12V8h7v4"],
  ["polyv", "Correia poly-V", "M3.5 9a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0M19.5 9a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0M11 24a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M8 4.5h16M4 12.5l9 8M28 12.5l-9 8"],
  ["tensionador", "Tensionador", "M4 16a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M9.8 16a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M20 16h9M25 12v8"],
  ["junta", "Junta", "M5 7h22a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-22a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM7.3 13a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0M14.3 13a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0M21.3 13a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0M8 20h16"],
  ["retentor", "Retentor", "M3.5 16a12.5 12.5 0 1 0 25 0a12.5 12.5 0 1 0 -25 0M8.5 16a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0M12 16h8"],
  ["mangueira", "Mangueira", "M3 12h6c4 0 3 8 7 8s3-8 7-8h6M3 9v6M29 9v6"],
  ["abracadeira", "Abraçadeira", "M6 17a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M16 7V3M12.5 3h7M16 27v-3"],
  ["sensor", "Sensor", "M12.5 3h7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1 -1.5 1.5h-7a1.5 1.5 0 0 1 -1.5 -1.5v-5a1.5 1.5 0 0 1 1.5 -1.5zM16 11v12M11 23h10v6H11zM3 17h7M22 17h7"],
  ["cubo", "Cubo de roda", "M3.5 16a12.5 12.5 0 1 0 25 0a12.5 12.5 0 1 0 -25 0M12 16a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M14.6 8a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0M22.6 16a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0M14.6 24a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0M6.6 16a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0"],
  ["cardan", "Cardan", "M3 13h8l3-3h4l3 3h8v6h-8l-3 3h-4l-3-3H3zM16 10v12"],
  ["diferencial", "Diferencial", "M6.5 16a9.5 9.5 0 1 0 19 0a9.5 9.5 0 1 0 -19 0M12.8 16a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0M2 16h4.5M25.5 16H30M16 2v4.5"],
  ["pneu", "Pneu", "M3 16a13 13 0 1 0 26 0a13 13 0 1 0 -26 0M9.5 16a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0M16 3v3M16 26v3M3 16h3M26 16h3"],
  ["arcond", "Ar-condicionado", "M16 3v26M5.5 9.5l21 13M26.5 9.5l-21 13M12 5l4 3 4-3M12 27l4-3 4 3"],
  ["farol", "Farol", "M6 8c10 0 14 3 14 8s-4 8-14 8zM23 11h7M23 16h7M23 21h7"],
  ["parafuso", "Parafuso", "M9 4h14v6H9zM12 10v18M20 10v18M12 15h8M12 20h8M12 25h8"],
  ["chave", "Ferramenta", "M20 4a7 7 0 0 0-6.5 9.5L4 23l5 5 9.5-9.5A7 7 0 1 0 20 4zM19.5 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"],
  ["fusivel", "Caixa de fusíveis", "M11 3h10a2 2 0 0 1 2 2v22a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-22a2 2 0 0 1 2 -2zM13 9h6v14h-6z"],
  ["terminal", "Terminal", "M3 16a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M11 16h14M25 11v10M25 11h4M25 21h4"],
  ["barraestab", "Barra estabilizadora", "M5 6v8c0 3 3 4 6 4h10c3 0 6 1 6 4v6M3 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M25 28a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"]
];
export const ICONE_D = Object.fromEntries(ICONES.map(i => [i[0], i[2]]));

export const TIPOS = { par: "1 ou 2", jogo: "Jogo completo", un: "Só marcar", cont: "Contador" };

/** Sistemas e peças padrão: [nome, tipo, ícone, pos]. */
export const SISTEMAS_PADRAO = [
  { id: "fr", nome: "Freios", icone: "disco", pecas: [["Pastilha de freio", "jogo", "pastilha", "chips"], ["Disco de freio", "jogo", "disco", "chips"], ["Sapatas de freio traseiras", "jogo", "sapata"], ["Tambor de freio traseiro", "jogo", "tambor"], ["Cilindro de roda traseiro", "par", "cilindro"], ["Fluido de freio DOT 4", "cont", "fluido"], ["Cabo do freio de mão", "par", "cabo"], ["Servo / cilindro mestre", "un", "servo"]] },
  { id: "sd", nome: "Susp. dianteira", icone: "amortecedor", pecas: [["Amortecedor", "jogo", "amortecedor"], ["Kit do amortecedor (coxim)", "par", "kitamort"], ["Bieleta", "par", "bieleta"], ["Bucha da barra estabilizadora", "par", "bucha"], ["Pivô", "par", "pivo"], ["Bandeja / balança", "par", "bandeja"], ["Bucha da bandeja", "un", "bucha", "chips2"], ["Rolamento de roda", "par", "rolamento"]] },
  { id: "st", nome: "Susp. traseira", icone: "mola", pecas: [["Amortecedor", "jogo", "amortecedor"], ["Kit do amortecedor (coxim)", "par", "kitamort"], ["Mola", "par", "mola"], ["Bucha do eixo / jumelo", "par", "bucha"], ["Rolamento de roda", "par", "rolamento"], ["Ponta de eixo", "par", "pontaeixo"]] },
  { id: "di", nome: "Direção", icone: "volante", pecas: [["Barra axial", "par", "axial"], ["Ponteira", "par", "ponteira"], ["Caixa de direção", "un", "caixadir"], ["Coifa da caixa", "par", "coifa"], ["Alinhamento 3D", "un", "alinha"]] },
  { id: "mo", nome: "Motor", icone: "motor", pecas: [["Óleo e filtros", "un", "oleo"], ["Kit correia dentada", "un", "correia"], ["Bomba d'água", "un", "bomba"], ["Válvula termostática", "un", "termostato"], ["Velas", "jogo", "vela"], ["Coxim do motor", "par", "coximmotor"]] },
  { id: "tr", nome: "Transmissão", icone: "engrenagem", pecas: [["Kit de embreagem", "un", "embreagem"], ["Homocinética", "par", "homocin"], ["Coifa da homocinética", "par", "coifa", ["Interna", "Externa"]], ["Óleo do câmbio", "un", "engrenagem"]] }
];

const aj = (cfg, id) => (((cfg && cfg.appMecanico) || {}).sistemas || {})[id] || {};

/** Lista final de um sistema: padrão + novos, com renomes, opções e ocultos do administrador.
 *  Cada peça: { orig, nome, tipo, icone, pm, padrao, oculto, id } (orig = nome original, para as regras do app). */
export function pecasDoSistema(cfg, sis, incluirOcultos = false) {
  const a = aj(cfg, sis.id), ren = a.renomes || {}, ops = a.opcoes || {}, ocultos = a.ocultos || [];
  const base = sis.pecas.map(p => {
    const o = ops[p[0]], pm = Array.isArray(o) && o.length ? o : p[3];
    return { id: "p:" + p[0], orig: p[0], nome: ren[p[0]] || p[0], tipo: p[1], icone: p[2], pm, padrao: true, oculto: ocultos.includes(p[0]) };
  });
  const novos = (a.novos || []).map(n => ({ id: "n:" + n.id, orig: n.nome, nome: n.nome, tipo: n.tipo || "un", icone: n.icone || "chave",
    pm: n.pos === "chips" || n.pos === "chips2" ? n.pos : (Array.isArray(n.opcoes) && n.opcoes.length ? n.opcoes : undefined), padrao: false, oculto: ocultos.includes("n:" + n.id) }));
  return base.concat(novos).filter(p => incluirOcultos || !p.oculto);
}

/** Todos os sistemas com as peças já ajustadas (o que o app do mecânico mostra). */
export const catalogoDoApp = cfg => SISTEMAS_PADRAO.map(s => ({ id: s.id, nome: s.nome, icone: s.icone, pecas: pecasDoSistema(cfg, s) }));

export const novoId = () => Math.random().toString(36).slice(2, 8);

/** Nome do item no jeito da oficina, com a posição (o mesmo do app do mecânico: mecanico/app.js nomePeca). Sem a quantidade:
 *  ela vai na coluna qtd. v = { q, pos } (pos: "Diant." | "Tras." | "Os 2" | "Dianteira" | ... | "Interna, Externa"). */
const SEM_PREFIXO = /^(alinhamento|fluido|oleo|óleo)/i;
export function nomeItemApp(p, v) {
  const base = String(p.nome).toUpperCase(), f = /A$/.test(base.split(/[^A-ZÀ-Ú]+/)[0] || "");
  const mapa = { "Diant.": f ? "DIANTEIRA" : "DIANTEIRO", "Tras.": f ? "TRASEIRA" : "TRASEIRO", "Os 2": f ? "DIANTEIRA E TRASEIRA" : "DIANTEIRO E TRASEIRO", Dianteira: "DIANTEIRA", Traseira: "TRASEIRA", "As 2": "DIANTEIRA E TRASEIRA" };
  const pos = v && v.pos ? v.pos.split(", ").map(x => mapa[x] || x.toUpperCase()).join(" E ") : "";
  return (SEM_PREFIXO.test(base) ? "" : "SUBST. ") + base + (pos ? " " + pos : "");
}
/** opções de posição da peça: [] (não pergunta), lista simples ou várias (multi) */
export function opcoesPosicao(p) {
  if (Array.isArray(p.pm)) return { lista: p.pm, multi: true };
  if (p.pm === "chips") return { lista: ["Diant.", "Tras.", "Os 2"], multi: false };
  if (p.pm === "chips2") return { lista: ["Dianteira", "Traseira", "As 2"], multi: false };
  return { lista: [], multi: false };
}
