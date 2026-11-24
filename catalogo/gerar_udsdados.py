#!/usr/bin/env python3
"""Gera js/udsdados.js: o pedaço do acervo de UDS que o app leva para o celular.

O acervo inteiro tem 14 MB, e a maior parte é definição de campo de carro elétrico europeu — não
serve para o dia a dia de uma oficina no Brasil, e peso no celular é peso. Então aqui entra só o
que a tela usa de verdade:

 - a tabela do BYTE DE TIPO DE FALHA da ISO 14229-1, traduzida. A fonte tem 113 entradas, duas
   delas marcadores vazios ('-' e '--'), então o que entra são as 111 que dizem alguma coisa. É
   ela que explica o
   número que vem depois do traço quando a falha é escrita por extenso (no catálogo do Honda, por
   exemplo, o 49 de um U3000-49). É o que transforma o código numa causa elétrica — curto com a
   massa, circuito aberto, sinal preso — sem depender de catálogo de marca. Vale para QUALQUER
   carro que fale UDS. Cobre 111 dos 256 valores possíveis: o que não está entra como vazio, e a
   tela mostra o número cru em vez de chutar uma causa.
 - os bits de situação do código (confirmada, pendente, falhou neste ciclo…).
 - o mapa de módulos: endereço de pedido e de resposta, com o nome. Sem endereço não há conversa.
 - os endereços padrão de 11 bits, que é por onde a varredura começa num carro desconhecido.
 - o ePTI (ISO 20730): a lista de sistemas de segurança padronizada entre marcas e os
   identificadores com que o MÓDULO informa o que ele tem, aceita rodar e aceita acionar. É a única
   fonte em que atuador e rotina não dependem de catálogo de montadora.

Uso: python3 catalogo/gerar_udsdados.py
"""
import json
import re, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
UDS = os.path.join(AQUI, 'uds')
SAIDA = os.path.join(RAIZ, 'js', 'udsdados.js')

# Tradução do byte de tipo de falha. Termo que a oficina já fala em inglês fica em inglês
# (checksum, watchdog, bus off, limp home, PWM); o resto vira a palavra que o mecânico usa —
# "massa" para o negativo e "positivo" para o lado da bateria, como se fala no salão.
TIPO_FALHA = {
    0: "codificação do dispositivo e do tipo de falha",
    1: "falha elétrica em geral",
    2: "falha de sinal em geral",
    3: "falha de sinal modulado (PWM ou frequência)",
    4: "falha interna do sistema",
    5: "falha de programação do sistema",
    6: "falha apontada por cálculo do módulo",
    7: "falha mecânica",
    8: "falha de mensagem no barramento",
    9: "falha de componente",
    10: "não compatível",
    17: "circuito em curto com a massa",
    18: "circuito em curto com o positivo",
    19: "circuito aberto",
    20: "circuito em curto com a massa ou aberto",
    21: "circuito em curto com o positivo ou aberto",
    22: "tensão do circuito abaixo do limite",
    23: "tensão do circuito acima do limite",
    24: "corrente do circuito abaixo do limite",
    25: "corrente do circuito acima do limite",
    26: "resistência do circuito abaixo do limite",
    27: "resistência do circuito acima do limite",
    28: "tensão do circuito fora da faixa",
    29: "corrente do circuito fora da faixa",
    30: "resistência do circuito fora da faixa",
    31: "circuito intermitente",
    32: "em teste",
    33: "sinal fraco demais",
    34: "sinal forte demais",
    35: "sinal preso em baixo",
    36: "sinal preso em alto",
    37: "forma de onda do sinal errada",
    38: "sinal variando devagar demais",
    39: "sinal variando rápido demais",
    40: "sinal fora do zero (falha de ajuste de zero)",
    41: "sinal inválido",
    47: "sinal irregular",
    49: "sem sinal",
    50: "sinal fica baixo por tempo curto demais",
    51: "sinal fica baixo por tempo longo demais",
    52: "sinal fica alto por tempo curto demais",
    53: "sinal fica alto por tempo longo demais",
    54: "frequência do sinal baixa demais",
    55: "frequência do sinal alta demais",
    56: "frequência do sinal errada",
    57: "pulsos de menos",
    58: "pulsos de mais",
    65: "falha de checksum",
    66: "falha de memória",
    67: "falha de memória especial",
    68: "falha da memória de dados",
    69: "falha da memória de programa",
    70: "falha da memória de calibração ou de parâmetro",
    71: "falha do watchdog (microcontrolador de segurança)",
    72: "falha do programa de supervisão",
    73: "falha eletrônica interna",
    74: "componente errado instalado",
    75: "temperatura acima do limite",
    81: "não programado",
    82: "não ativado",
    83: "desativado",
    84: "falta calibração",
    85: "não configurado",
    97: "falha no cálculo do sinal",
    98: "falha na comparação do sinal",
    99: "proteção do circuito ou do componente atuou por tempo",
    100: "sinal fora do que faz sentido (plausibilidade)",
    101: "mudanças de sinal de menos",
    102: "mudanças de sinal de mais",
    103: "sinal errado depois do evento",
    104: "informação de evento",
    113: "atuador travado",
    114: "atuador travado aberto",
    115: "atuador travado fechado",
    116: "atuador patinando",
    117: "não alcança a posição de emergência",
    118: "montado na posição errada",
    119: "não alcança a posição comandada",
    120: "alinhamento ou ajuste errado",
    121: "falha na ligação mecânica",
    122: "vazamento de fluido ou falha de vedação",
    123: "nível de fluido baixo",
    129: "dado serial recebido é inválido",
    130: "contador de sequência errado ou parado",
    131: "conta de proteção do sinal errada",
    132: "sinal abaixo da faixa permitida",
    133: "sinal acima da faixa permitida",
    134: "sinal inválido",
    135: "mensagem não chegou",
    136: "barramento desligado (bus off)",
    143: "irregular",
    145: "fora do parâmetro",
    146: "desempenho ou funcionamento errado",
    147: "não funciona",
    148: "funcionou quando não devia",
    149: "montagem errada",
    150: "falha interna do componente",
    151: "componente ou sistema obstruído ou travado",
    152: "componente ou sistema com temperatura acima do limite",
    241: "caso de segurança 1",
    242: "caso de segurança 2",
    243: "falha múltipla",
    244: "temperatura baixa demais",
    245: "erro no laço negativo",
    246: "erro no laço positivo",
    247: "inicialização inválida",
    248: "giro acima do limite",
    249: "modo de emergência (limp home)",
    250: "específico do fornecedor",
    253: "desvio para baixo",
    254: "desvio para cima",
}

# Bits de situação do código, na ordem da ISO 14229-1 (bit 0 primeiro).
SITUACAO = [
    ("testFailed", "falhou agora"),
    ("testFailedThisOperationCycle", "falhou neste ciclo"),
    ("pendingDTC", "pendente"),
    ("confirmedDTC", "confirmada"),
    ("testNotCompletedSinceLastClear", "não testou desde o último apagamento"),
    ("testFailedSinceLastClear", "falhou desde o último apagamento"),
    ("testNotCompletedThisOperationCycle", "não testou neste ciclo"),
    ("warningIndicatorRequested", "pede luz no painel"),
]


def resposta_valida(e):
    """Diz se é endereço de RESPOSTA que dá para usar.

    A resposta não precisa estar na faixa de diagnóstico: ela só é escutada (ATCRA), nunca é
    destino de pedido. Stellantis responde 0x280 ABAIXO do pedido — o ABS pede em 747 e responde em
    4C7 —, e exigir 600 a 7FF aqui jogava fora sete módulos de Jeep, Fiat, Dodge e RAM, o ABS e o
    airbag entre eles (apontado pelo Codex em 24/11/2026).
    """
    e = (e or '').strip().upper()
    if not e or not all(c in '0123456789ABCDEF' for c in e):
        return False
    return len(e) in (3, 8)


def endereco_valido(e):
    """Diz se é endereço de diagnóstico que dá para usar.

    A fonte traz lixo: entradas com endereço "0" (campo que o projeto de origem deixou em branco) e
    endereços como 800/801, que não são de diagnóstico. A tela de escolha de módulo lista o que está
    aqui, então lixo no acervo é lixo na mão do mecânico — ele toca, não responde, e parece defeito
    do app. Achado da revisão independente de 20/11/2026.

    Vale endereço de 11 bits (3 dígitos hex, de 600 a 7FF, onde moram os de diagnóstico) ou de
    29 bits (8 dígitos hex).
    """
    e = (e or '').strip().upper()
    if not e or not all(c in '0123456789ABCDEF' for c in e):
        return False
    if len(e) == 8:
        return True
    if len(e) != 3:
        return False
    n = int(e, 16)
    return 0x600 <= n <= 0x7FF


# O nome de oficina de cada módulo da VAG. O acervo traz o nome abreviado da própria VW
# ("LL_Brake1UDS"), que não serve para o mecânico escolher com qual módulo falar — ele quer ver
# "Freio (ABS/ESP)". Pedido do Danilo em 23/11/2026, depois de procurar o ABS na Amarok e não achar.
NOMES_VAG = {
    "EnginContrModul1": "Motor", "EnginContrModul2": "Motor (segundo módulo)",
    "TransContrModul": "Câmbio", "GearShiftContrModul": "Seletor de marchas",
    "Brake1": "Freio (ABS/ESP)", "SensoBrakeSyste": "Sensores do freio",
    "WheelBrakeRearRight": "Freio da roda traseira direita", "WheelBrakeRearLeft": "Freio da roda traseira esquerda",
    "ParkiBrake": "Freio de estacionamento", "Airba": "Airbag",
    "PreteFrontRight": "Pré-tensionador dianteiro direito", "PreteFrontLeft": "Pré-tensionador dianteiro esquerdo",
    "DashBoard": "Painel", "DashBoardDisplUnit": "Tela do painel", "Tacho": "Painel (conta-giros)",
    "Immob": "Imobilizador", "Gatew": "Gateway (central de rede)", "CentrElect": "Central elétrica",
    "CentrModulComfoSyste": "Central de conforto", "CentrModulComfoSyste2": "Central de conforto (2)",
    "AirCondi": "Ar-condicionado", "AirCondiCompr": "Compressor do ar-condicionado",
    "ClimaContrUnitRear": "Ar-condicionado traseiro", "AuxilParkiHeate": "Aquecedor auxiliar",
    "AllWheelContr": "Tração nas quatro rodas", "ReducContrModul": "Caixa de redução",
    "SteerAngleSende": "Sensor de ângulo da direção", "SteerAssis": "Direção assistida",
    "SteerColumElect": "Coluna de direção", "SteerColumLocki": "Trava da coluna de direção",
    "ActivSteer": "Direção ativa", "TirePressMonit1": "Pressão dos pneus",
    "AdaptCruisContr": "Piloto automático adaptativo", "AdaptCruisContr2": "Piloto automático adaptativo (2)",
    "ParkiAssis": "Sensor de estacionamento", "ParkiAssis2": "Sensor de estacionamento (2)",
    "LaneChangAssis": "Assistente de faixa", "FrontSensoDriveAssisSyste": "Sensor dianteiro dos assistentes",
    "CamerSysteRearView": "Câmera de ré", "OnBoardCamer": "Câmera de bordo",
    "ImageProceElect": "Processamento de imagem", "NightVisio": "Visão noturna",
    "HighBeamAssis": "Assistente de farol alto", "HeadlRegul": "Regulagem dos faróis",
    "LockElect": "Travas", "Kessy": "Entrada e partida sem chave", "AccesStartInter": "Acesso e partida",
    "DoorElectDriveSide": "Porta do motorista", "DoorElectPasseSide": "Porta do passageiro",
    "DoorElectRearDriveSide": "Porta traseira esquerda", "DoorElectRearPasseSide": "Porta traseira direita",
    "SlidiDoorLeft": "Porta corrediça esquerda", "SlidiDoorRight": "Porta corrediça direita",
    "DeckLidContrUnit": "Tampa traseira", "ElectRoofContr": "Teto solar", "ElectRoofContr2": "Teto solar (2)",
    "SeatAdjusDriveSide": "Banco do motorista", "SeatAdjusPasseSide": "Banco do passageiro",
    "MultiContoSeatDriveSide": "Banco multicontorno do motorista", "MultiContoSeatPasseSide": "Banco multicontorno do passageiro",
    "MultiContoSeatRearDriveSide": "Banco traseiro esquerdo", "MultiContoSeatRearPasseSide": "Banco traseiro direito",
    "Armre": "Apoio de braço", "Radio": "Rádio", "Navig": "Navegação", "SoundSyste": "Som",
    "MediaPlayePosit1": "Tocador de mídia 1", "MediaPlayePosit3": "Tocador de mídia 3", "TVTuner": "Sintonizador de TV",
    "InfotInter": "Interface do multimídia", "InforContrUnit1": "Central de informações",
    "HeadUpDispl": "Projeção no para-brisa", "AuxilDisplContrUnit": "Tela auxiliar",
    "Telem": "Telemetria", "Telep": "Telefone", "ExterCommuInter": "Comunicação externa",
    "BatteRegul": "Regulagem da bateria", "BatteCharg": "Carregador da bateria",
    "BatteEnergContrModul": "Gestão de energia da bateria", "DriveMotorContrModul": "Motor elétrico de tração",
    "TrailFunct": "Engate de reboque", "RideContrSyste": "Suspensão", "WheelDampeElect": "Amortecedores",
    "AssemMount": "Coxins do motor", "SensoElect": "Sensores", "MicroContrUnit": "Microfone",
    "VehicPositDetec": "Posição do veículo", "ActuaForStrucBorneSound": "Gerador de som",
    "SpeciFunct": "Funções especiais", "SpeciFunct2": "Funções especiais (2)",
}


def nome_vag(cru):
    """"LL_Brake1UDS" vira "Freio (ABS/ESP)". Sem tradução, devolve o nome cru: inventar é pior."""
    n = re.sub(r"UDS$", "", re.sub(r"^LL_", "", str(cru or "")))
    return NOMES_VAG.get(n, cru or "")


def modulos():
    """Mapa de módulos: endereço de pedido, de resposta e o nome, por família."""
    fam = {}
    cam = os.path.join(UDS, 'modulos_vag.json')
    if os.path.exists(cam):
        vag = []
        for m in json.load(open(cam, encoding='utf-8')):
            ped = (m.get('pede_em') or [None])[0]
            resp = (m.get('responde_em') or [None])[0]
            if endereco_valido(ped) and endereco_valido(resp):
                vag.append([ped.upper(), resp.upper(), nome_vag(m.get('nome'))])
        if vag:
            fam['VAG'] = vag
    cam = os.path.join(UDS, 'modulos_renault.json')
    if os.path.exists(cam):
        for veic, lista in json.load(open(cam, encoding='utf-8')).items():
            l = [[(m.get('pede_em') or '').upper(), (m.get('responde_em') or '').upper(),
                  m.get('nome') or m.get('sigla') or ''] for m in lista
                 if endereco_valido(m.get('pede_em')) and endereco_valido(m.get('responde_em'))]
            if l:
                fam['RENAULT ' + veic.replace('_', ' ')] = l
    # opendbc (comma.ai, MIT): os endereços de módulo que eles levantaram para identificar o carro.
    # É a única fonte aberta que temos para Toyota, Honda, Hyundai, Ford, Nissan, Subaru, Mazda e
    # Stellantis — marcas que entram na oficina e que não existiam no acervo (24/11/2026).
    cam = os.path.join(UDS, 'modulos_opendbc.json')
    if os.path.exists(cam):
        for marca, lista in json.load(open(cam, encoding='utf-8')).items():
            # O PEDIDO tem de ser endereço de diagnóstico (o plugin do APK recusa ATSH fora de
            # 600–7FF): é por isso que a câmera da GM, que pede em 24B, fica de fora. A RESPOSTA só
            # é escutada, então vale qualquer endereço bem formado.
            l = [[m['pede_em'].upper(), m['responde_em'].upper(), m['nome']] for m in lista
                 if endereco_valido(m.get('pede_em')) and resposta_valida(m.get('responde_em'))]
            if l:
                fam[marca] = l
    cam = os.path.join(UDS, 'modulos_ovms.json')
    if os.path.exists(cam):
        for veic, lista in json.load(open(cam, encoding='utf-8')).items():
            # do OVMS interessa o ENDEREÇO (um por veículo, repetido em cada pedido), não o pedido
            vistos = {}
            for p in lista:
                ped, resp = (p.get('pede_em') or '').upper(), (p.get('responde_em') or '').upper()
                if not endereco_valido(ped) or not endereco_valido(resp):
                    continue
                vistos.setdefault((ped, resp), p.get('nota') or '')
            if vistos:
                fam['OVMS ' + veic] = [[p, r, n] for (p, r), n in sorted(vistos.items())]
    return fam


def main():
    if not os.path.isdir(UDS):
        sys.exit('Falta a pasta catalogo/uds. Rode catalogo/gerar_uds.py antes.')
    fam = modulos()
    epti = {}
    cam = os.path.join(UDS, 'epti.json')
    if os.path.exists(cam):
        e = json.load(open(cam, encoding='utf-8'))
        epti = {k: e[k] for k in ('sistemas', 'dids', 'ordem', 'fonte', 'semAnexoCD') if k in e}
    dados = {
        'versao': '2026-11-20',
        'tipoFalha': {str(k): v for k, v in sorted(TIPO_FALHA.items())},
        'situacao': [list(s) for s in SITUACAO],
        'modulos': fam,
        'epti': epti,
    }
    corpo = json.dumps(dados, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    texto = (
        '// Acervo de UDS que o app leva para o celular. ARQUIVO GERADO: não edite à mão.\n'
        '// Gerado por catalogo/gerar_udsdados.py, a partir de catalogo/uds/ (projetos abertos de comunidade).\n'
        '//\n'
        '// tipoFalha: o byte que vem DEPOIS do código, pela ISO 14229-1 (111 entradas com significado,\n'
        '//   de 113 na fonte: duas eram marcadores vazios). É o número depois do traço num\n'
        '//   U3000-49 — e é o que transforma o código numa causa elétrica: curto com a massa, circuito\n'
        '//   aberto, sinal preso, sem depender de catálogo de marca. Cobre 111 dos 256 valores possíveis;\n'
        '//   o que não está entra vazio, e a tela mostra o número cru em vez de chutar uma causa.\n'
        '// situacao: os oito bits de situação do código, na ordem da norma.\n'
        '// modulos: endereço de pedido e de resposta, com o nome, por família. Sem endereço não há conversa.\n'
        '// epti: a norma ISO 20730 (inspeção técnica eletrônica), que é a única fonte onde a lista de\n'
        '//   sistemas de segurança é IGUAL para todas as marcas. Os identificadores FA20 a FA23 são o\n'
        '//   módulo dizendo o que ele tem, o que aceita rodar e o que aceita acionar — por isso o app\n'
        '//   pergunta ao carro em vez de carregar tabela de atuador por montadora.\n'
        'export default ' + corpo + ';\n'
    )
    open(SAIDA, 'w', encoding='utf-8').write(texto)
    n = sum(len(v) for v in fam.values())
    print('js/udsdados.js: %d tipos de falha, %d bits de situação, %d módulos em %d famílias, '
          'ePTI com %d sistemas e %d identificadores (%.0f KB)'
          % (len(TIPO_FALHA), len(SITUACAO), n, len(fam),
             len(epti.get('sistemas') or []), len(epti.get('dids') or []), len(texto) / 1024))


if __name__ == '__main__':
    main()
