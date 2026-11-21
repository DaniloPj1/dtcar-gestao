#!/usr/bin/env python3
"""Gera catalogo/uds/epti.json — a parte do ePTI que o app usa.

O QUE É: a ISO 20730 é a norma da inspeção técnica eletrônica (ePTI). Ela faz uma coisa que nenhuma
outra faz: padroniza, IGUAL PARA TODAS AS MARCAS, a lista dos sistemas de segurança do carro, os
identificadores para ler o que cada módulo tem e os identificadores de rotina e de atuador. É a
única fonte onde atuador e rotina não dependem de catálogo de montadora.

DE ONDE SAIU: ISO 20730-3:2021, Anexo A (lista de sistemas) e Anexo B, Tabela B.1 (identificadores
de dado), e a ordem de conversa da ISO 20730-1:2021, cláusula 15. O Danilo trouxe os documentos em
20/11/2026.

O QUE NÃO ESTÁ AQUI, e por quê: os Anexos C (rotinas) e D (controles de entrada e saída) não vieram
nos documentos que temos — são a parte da norma que ficou de fora da amostra. Então o app NÃO
carrega lista de rotina nem de atuador do ePTI: ele PERGUNTA AO CARRO, pelos identificadores
FA2216 e FA2316, que existem justamente para isso. Funciona sem a tabela, e é honesto: lista de
atuador chutada aciona a saída errada.

A norma é documento pago e protegido, então ela não entra no repositório. O que entra é o que este
arquivo tem: número, nome simbólico e o nome em português — o dado que um aparelho precisa para
implementar a norma, escrito aqui com a fonte citada.

Uso: python3 catalogo/gerar_epti.py
"""
import json, os

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, 'uds', 'epti.json')

# ISO 20730-3:2021, Anexo A — lista de sistemas relevantes para a inspeção.
# (número, nome simbólico da norma, nome em português)
# Termo que a oficina já fala em inglês fica em inglês: airbag, ABS, ESP, auto hold, eCall, ALKS.
SISTEMAS = [
    ("0001", "SYS_GENERIC_INFO", "Informação geral do ePTI"),
    ("0002", "SYS_CORN_LI", "Luz de curva"),
    ("0003", "SYS_ADP_CRUISE_CTRL", "Piloto automático adaptativo"),
    ("0004", "SYS_ADP_DEFLECTOR", "Defletores adaptativos"),
    ("0005", "SYS_AIRBAG", "Airbag"),
    ("0006", "SYS_ACT_HEADREST", "Encosto de cabeça ativo"),
    ("0007", "SYS_ACT_HOOD", "Capô ativo"),
    ("0008", "SYS_AUTO_HOLD_FCT", "Auto hold (segura o freio parado)"),
    ("0009", "SYS_AUTO_HL_LEVEL", "Regulagem automática do farol"),
    ("000A", "SYS_AUTO_EM_BRAKE", "Frenagem automática de emergência"),
    ("000B", "SYS_ANTI_L_BRAKE", "Freio ABS"),
    ("000C", "SYS_AUTO_LI", "Farol automático"),
    ("000D", "SYS_ELEC_DRIVE", "Tração elétrica"),
    ("000E", "SYS_ELEC_MECH_PWR_STER", "Direção elétrica"),
    ("000F", "SYS_ELEC_4_W_STER", "Direção eletrônica nas quatro rodas"),
    ("0010", "SYS_ELEC_DAMP", "Amortecimento eletrônico"),
    ("0011", "SYS_ELEC_BRAKE", "Freio eletrônico"),
    ("0012", "SYS_ELEC_STAB_PRG", "Controle de estabilidade (ESP)"),
    ("0013", "SYS_HIGH_BEAM_AST", "Assistente de farol alto"),
    ("0014", "SYS_SPEED_LIM", "Limitador de velocidade"),
    ("0015", "SYS_TENS_BELT_LIM", "Pré-tensionador e limitador de força do cinto"),
    ("0016", "SYS_TAIL_LI", "Comutação da lanterna traseira"),
    ("0018", "SYS_BEND_LI", "Farol direcional"),
    ("0019", "SYS_STER_AST", "Assistente de direção"),
    ("001A", "SYS_HEIGHT_LEVEL", "Regulagem de altura da suspensão"),
    ("001B", "SYS_EM_BRAKE_SIG", "Sinal de frenagem de emergência"),
    ("001C", "SYS_PRE_CRASH", "Sistema de pré-colisão"),
    ("001D", "SYS_TYRE_PRES_WAR", "Aviso de pressão dos pneus"),
    ("001E", "SYS_TRACT_CTRL", "Controle de tração"),
    ("001F", "SYS_SU_IMP_STER", "Direção sobreposta"),
    ("0020", "SYS_ACT_R_O_PROTECT", "Proteção ativa contra capotamento"),
    ("0021", "SYS_HYD_INST", "Instalação de hidrogênio"),
    ("0022", "SYS_START_UP_AID", "Auxílio de partida em rampa"),
    ("0023", "SYS_TRAILER_STAB", "Estabilização de reboque"),
    ("0024", "SYS_END_BRAKE", "Freio de permanência (retarder)"),
    ("0025", "SYS_DIF_LOCK_DACT", "Desativação do bloqueio do diferencial"),
    ("0026", "SYS_ELEC_CTRL_LT_AX", "Eixo direcional eletrônico"),
    ("0027", "SYS_ELEC_STER_DAMP", "Amortecedor de direção eletrônico"),
    ("0028", "SYS_BUS_STOP_BRAKE", "Freio de parada de ônibus"),
    ("0029", "SYS_KNEELING", "Rebaixamento (kneeling)"),
    ("002A", "SYS_STER_BRAKE", "Freio direcional"),
    ("002B", "SYS_TYRE_PRE_CTRL", "Controle de pressão dos pneus"),
    ("002C", "SYS_SLID_J_STAB", "Estabilização da articulação"),
    ("002E", "SYS_4_W_PARK_BRAKE", "Freio de estacionamento nas quatro rodas"),
    ("002F", "SYS_FRONT_W_LOCK", "Travamento da roda dianteira"),
    ("0030", "SYS_ADAP_HEAD_LI", "Faróis adaptativos"),
    ("0031", "SYS_ELEC_PARK_BRAKE", "Freio de estacionamento elétrico"),
    ("0032", "SYS_LANE_CH_AST", "Assistente de troca de faixa"),
    ("0033", "SYS_LANE_KEEP_AST", "Assistente de permanência em faixa"),
    ("0034", "SYS_AUTO_ECALL", "Chamada automática de emergência (eCall)"),
    ("0035", "SYS_ACT_ROLL_STAB", "Estabilização ativa de rolagem"),
    ("0036", "SYS_CAM_MONITOR", "Câmera no lugar do espelho"),
    ("0037", "SYS_ACO_VE_ALERTING", "Aviso sonoro do veículo"),
    ("0038", "SYS_EXTER_LI", "Iluminação externa básica"),
    ("0039", "SYS_AUTO_LANE_KEEP", "Condução automatizada em faixa (ALKS)"),
    ("003A", "SYS_TURN_ASSIST", "Assistente de conversão"),
    ("003B", "SYS_TACHOGRAPH", "Tacógrafo"),
]
# Reservados pela norma (0000, 0017, 002D e de 003C em diante): não entram como sistema.

# ISO 20730-3:2021, Anexo B, Tabela B.1 — identificadores de dado.
# obrigatorio: a norma marca M (obrigatório) ou O (opcional). Os quatro "o que você tem"
# são obrigatórios, e é por isso que dá para montar a varredura em cima deles.
DIDS = [
    ("FA19", "DID_ISO_ED_NUM", "Edição da norma ePTI", True),
    ("FA20", "DID_SUPP_DID", "Dados que este módulo tem", True),
    ("FA21", "DID_SUPP_SYS", "Sistemas que este módulo tem", True),
    ("FA22", "DID_SUPP_RID", "Rotinas que este módulo aceita", True),
    ("FA23", "DID_SUPP_IOCT_DID", "Atuadores que este módulo aceita", True),
    ("FA24", "DID_SYS_STATUS", "Situação dos sistemas e do autoteste", True),
    ("FA25", "DID_SEAT_BELT_BUC", "Fivela do cinto", False),
    ("FA26", "DID_HYD_BRK", "Pressão do freio hidráulico", False),
    ("FA27", "DID_AIR_BRK", "Pressão do freio a ar", False),
    ("FA28", "DID_TYRE_PRESS", "Pressão dos pneus", False),
    ("FA29", "DID_WHEEL_SPD", "Velocidade das rodas", False),
    ("FA2A", "DID_DYN_DRIVING", "Valores dinâmicos de condução", False),
]

# Ordem da conversa, da ISO 20730-1:2021, cláusula 15. Primeiro o carro diz o que tem; só depois se
# age nele. É a mesma ordem que o app usa na varredura — pergunta antes de mexer.
ORDEM = [
    ("FA21", "sistemas", "Quais sistemas de segurança este módulo cuida"),
    ("FA20", "dados", "Quais dados ele sabe informar"),
    ("FA22", "rotinas", "Quais rotinas ele aceita rodar"),
    ("FA23", "atuadores", "Quais atuadores ele aceita acionar"),
    ("FA24", "situacao", "Como está cada sistema e se o autoteste terminou"),
]


def main():
    dados = {
        'fonte': 'ISO 20730-3:2021 Anexo A e Tabela B.1; ordem de conversa da ISO 20730-1:2021 cláusula 15',
        'versao': '2026-11-20',
        'sistemas': [list(s) for s in SISTEMAS],
        'dids': [[d[0], d[1], d[2], d[3]] for d in DIDS],
        'ordem': [list(o) for o in ORDEM],
        'semAnexoCD': True,   # Anexos C (rotinas) e D (atuadores) não estão nos documentos que temos
    }
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    json.dump(dados, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('catalogo/uds/epti.json: %d sistemas, %d identificadores de dado (%d obrigatórios), ordem de %d passos'
          % (len(SISTEMAS), len(DIDS), sum(1 for d in DIDS if d[3]), len(ORDEM)))


if __name__ == '__main__':
    main()
