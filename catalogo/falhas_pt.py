#!/usr/bin/env python3
"""Tradutor do texto de diagnóstico para português de oficina.

Por que um tradutor com glossário em vez de 4.779 frases traduzidas à mão:
o texto da Honda é vocabulário técnico repetido. São 1.751 palavras distintas
em 7.495 linhas, e as 200 linhas mais comuns cobrem 44% das ocorrências. Com
glossário e padrões, a tradução fica conferível linha por linha, testável, e
refaz tudo sozinha quando o extrato mudar. Frase traduzida à mão ninguém
revisa depois.

Regras de escrita (as mesmas do resto do sistema):
- linguagem de oficina, não de engenharia: "bico injetor", não "injetor de
  combustível"; "massa", não "terra"; "scanner", não "ferramenta de diagnóstico".
- curto. Quem lê está embaixo do carro.
- o que não for traduzido fica em inglês e é CONTADO, nunca inventado.
"""
import re

# ---------------------------------------------------------------------------
# Frases inteiras. Entram aqui as mais repetidas e as que a tradução por termo
# deixaria esquisita. São conferidas uma por uma.
# ---------------------------------------------------------------------------
FRASES = {
    "continuously": "sempre",
    "one driving cycle": "um ciclo de condução",
    "two driving cycles": "dois ciclos de condução",
    "clear dtcs with the hds": "apagar os códigos com o scanner",
    "clear dtcs with the hds.": "apagar os códigos com o scanner",
    "sensor failure": "sensor com defeito",
    "mil on": "luz de injeção acesa",
    "mil off": "luz de injeção apagada",
    "mil blink": "luz de injeção piscando",
    "ig off (0)": "chave desligada",
    "ig on (ii)": "chave ligada",
    "engine running": "motor funcionando",
    "engine running.": "motor funcionando",
    "engine stopped": "motor parado",
    "when engine control module (ecm) detects normal during ig on (ii)":
        "quando o módulo de injeção detecta normal com a chave ligada",
    "when transmission control module (tcm) detects normal during ig on (ii)":
        "quando o módulo do câmbio detecta normal com a chave ligada",
    "signal line open": "linha de sinal aberta",
    "signal line short": "linha de sinal em curto",
    "ground line open": "linha de massa aberta",
    "control line open": "linha de controle aberta",
    "control line short": "linha de controle em curto",
    "power line open": "linha de alimentação aberta",
    "power line short": "linha de alimentação em curto",
    "internal open": "aberto por dentro",
    "internal short": "em curto por dentro",
    "compression low": "compressão baixa",
    "insufficient fuel": "combustível insuficiente",
    "fuel line clogged": "linha de combustível obstruída",
    "fuel filter clogged": "filtro de combustível entupido",
    "fuel pump pressure": "pressão da bomba de combustível",
    "fuel injector clogged, leaking": "bico injetor entupido ou vazando",
    "fuel injector harness open or short": "fiação do bico injetor aberta ou em curto",
    "valve clearance incorrect": "folga de válvula fora do especificado",
    "spark plug carbon deposits or fouling": "vela com carvão ou encharcada",
    "ignition wire open or current leaking": "cabo de vela aberto ou com fuga",
    "one cylinder misfire": "falha de combustão em um cilindro",
    "multi-cylinder misfire": "falha de combustão em vários cilindros",
    "fuel or mechanical": "combustível ou mecânica",
    "electrical": "elétrica",
    "srs unit": "módulo do airbag",
    "ecm failure": "módulo de injeção com defeito",
    "ecu failure": "módulo com defeito",
    "tcm failure": "módulo do câmbio com defeito",
    "icm failure": "módulo de ignição com defeito",
    "distributor failure": "distribuidor com defeito",
    "carbon deposit on valves": "carvão nas válvulas",
    "pressure regulator stuck open": "regulador de pressão preso aberto",
    "vtec pin stuck": "pino do VTEC preso",
    "do not diagnose, proceed to troubleshoot dtcs or symptoms":
        "não diagnostique por aqui: vá pelos códigos ou pelos sintomas",
    "limit the output torque": "limita o torque entregue",
    "stop the egr": "corta a EGR",
    "stop the solenoid driving": "para de acionar o solenoide",
    "idle stop prohibition": "proíbe o desligamento em marcha lenta",
    "fail safe": "modo de emergência",
    "none": "nada",
    "no": "não",
    "yes": "sim",
}

# ---------------------------------------------------------------------------
# Termos, do mais longo para o mais curto. A ordem não importa: o código
# ordena por tamanho antes de aplicar.
# ---------------------------------------------------------------------------
TERMOS = {
    # Módulos e unidades
    "engine control module (ecm)": "módulo de injeção",
    "engine control module": "módulo de injeção",
    "powertrain control module (pcm)": "módulo de injeção",
    "powertrain control module": "módulo de injeção",
    "transmission control module (tcm)": "módulo do câmbio",
    "transmission control module": "módulo do câmbio",
    "ignition control module (icm)": "módulo de ignição",
    "ignition control module": "módulo de ignição",
    "body control module (bcm)": "módulo da carroceria",
    "body control module": "módulo da carroceria",
    "electronic power steering": "direção elétrica",
    "power steering": "direção hidráulica",
    "srs unit": "módulo do airbag",
    "abs modulator": "módulo do ABS",
    "control unit": "módulo",
    "control module": "módulo",
    "module": "módulo",
    "unit": "módulo",
    "ecm": "módulo de injeção",
    "pcm": "módulo de injeção",
    "tcm": "módulo do câmbio",
    "icm": "módulo de ignição",
    "bcm": "módulo da carroceria",
    "ecu": "módulo",
    "mcu": "módulo",
    # Sensores e componentes
    "crankshaft position sensor": "sensor de rotação do virabrequim",
    "camshaft position sensor": "sensor de fase do comando",
    "mass air flow sensor": "sensor de fluxo de ar",
    "manifold absolute pressure sensor": "sensor de pressão do coletor",
    "intake air temperature sensor": "sensor de temperatura do ar",
    "engine coolant temperature sensor": "sensor de temperatura da água",
    "throttle position sensor": "sensor de posição da borboleta",
    "accelerator pedal position sensor": "sensor do pedal do acelerador",
    "fuel rail pressure sensor": "sensor de pressão do rail",
    "fuel tank pressure sensor": "sensor de pressão do tanque",
    "barometric pressure sensor": "sensor de pressão atmosférica",
    "knock sensor": "sensor de detonação",
    "oxygen sensor": "sonda lambda",
    "air fuel ratio sensor": "sonda lambda de banda larga",
    "wheel speed sensor": "sensor de rotação da roda",
    "vehicle speed sensor": "sensor de velocidade",
    "oil pressure sensor": "sensor de pressão do óleo",
    "oil temperature sensor": "sensor de temperatura do óleo",
    "exhaust gas temperature sensor": "sensor de temperatura do escape",
    "exhaust gas recirculation": "recirculação dos gases de escape",
    "evaporative emission": "sistema de vapores de combustível",
    "canister purge valve": "válvula de purga do cânister",
    "canister vent shut valve": "válvula de bloqueio do cânister",
    "idle air control valve": "válvula de marcha lenta",
    "throttle actuator": "atuador da borboleta",
    "throttle body": "corpo de borboleta",
    "fuel injector": "bico injetor",
    "injector": "bico injetor",
    "fuel pump": "bomba de combustível",
    "water pump": "bomba d'água",
    "vacuum pump": "bomba de vácuo",
    "ignition coil": "bobina de ignição",
    "spark plug": "vela",
    "catalytic converter": "catalisador",
    "turbo charger": "turbina",
    "turbocharger": "turbina",
    "intercooler": "intercooler",
    "radiator fan": "eletroventilador",
    "cooling fan": "eletroventilador",
    "compressor clutch": "embreagem do compressor",
    "clutch": "embreagem",
    "solenoid valve": "válvula solenoide",
    "solenoid": "solenoide",
    "actuator": "atuador",
    "relay": "relé",
    "switch": "interruptor",
    "sensor": "sensor",
    "valve": "válvula",
    "motor": "motor elétrico",
    "pump": "bomba",
    "battery": "bateria",
    "alternator": "alternador",
    "starter": "motor de partida",
    "thermostat": "válvula termostática",
    "inflator": "inflador",
    "airbag": "airbag",
    "cable reel": "cinta do volante",
    "seat belt": "cinto de segurança",
    "brake": "freio",
    "parking brake": "freio de estacionamento",
    "shift": "troca de marcha",
    "gear": "marcha",
    "transmission": "câmbio",
    "differential": "diferencial",
    "wire harness": "fiação",
    "harness": "fiação",
    "connector": "conector",
    "circuit": "circuito",
    "line": "linha",
    "signal": "sinal",
    "ground": "massa",
    "gnd": "massa",
    "power supply": "alimentação",
    "power": "alimentação",
    "voltage": "tensão",
    "current": "corrente",
    "pressure": "pressão",
    "temperature": "temperatura",
    "position": "posição",
    "speed": "rotação",
    "intake": "admissão",
    "exhaust": "escape",
    "coolant": "água do motor",
    "fuel": "combustível",
    "air": "ar",
    "oil": "óleo",
    "engine": "motor",
    "cylinder": "cilindro",
    "misfire": "falha de combustão",
    "stroke": "curso",
    "stuck": "preso",
    "range": "faixa",
    "performance": "desempenho",
    "value": "valor",
    "time": "tempo",
    "cycle": "ciclo",
    "driving cycle": "ciclo de condução",
    "driving": "condução",
    "communication": "comunicação",
    "can communication": "comunicação CAN",
    "bus": "barramento",
    # Estados e defeitos
    "circuit low voltage": "circuito com tensão baixa",
    "circuit high voltage": "circuito com tensão alta",
    "circuit malfunction": "circuito com defeito",
    "circuit open": "circuito aberto",
    "circuit short": "circuito em curto",
    "short to power": "curto para a alimentação",
    "short to ground": "curto para a massa",
    "short to another wire harness": "curto com outra fiação",
    "open or short": "aberto ou em curto",
    "internal circuit malfunction": "circuito interno com defeito",
    "malfunction": "defeito",
    "failure": "defeito",
    "failed": "com defeito",
    "fault": "falha",
    "open": "aberto",
    "short": "em curto",
    "low": "baixo",
    "high": "alto",
    "internal": "interno",
    "external": "externo",
    "incorrect": "fora do especificado",
    "abnormal": "fora do normal",
    "normal": "normal",
    "detected": "detectado",
    "clogged": "entupido",
    "leaking": "vazando",
    "leak": "vazamento",
    "blockage": "obstrução",
    "excessive": "excessivo",
    "insufficient": "insuficiente",
    "too low": "baixo demais",
    "too high": "alto demais",
    "slow response": "resposta lenta",
    "no response": "sem resposta",
    "not learned": "não aprendido",
    "deterioration": "desgaste",
    "mismatch": "divergente",
    # Posições e lados
    "right-front": "dianteiro direito",
    "left-front": "dianteiro esquerdo",
    "right-rear": "traseiro direito",
    "left-rear": "traseiro esquerdo",
    "front": "dianteiro",
    "rear": "traseiro",
    "right": "direito",
    "left": "esquerdo",
    "upper": "superior",
    "lower": "inferior",
    "driver's": "do condutor",
    "driver": "condutor",
    "passenger's": "do passageiro",
    "passenger": "passageiro",
    "bank 1": "banco 1",
    "bank 2": "banco 2",
    "sensor 1": "sensor 1",
    "sensor 2": "sensor 2",
    # Ações do modo de emergência
    "stop": "para",
    "limit": "limita",
    "prohibit": "proíbe",
    "prohibition": "proibição",
    "output torque": "torque entregue",
    "torque": "torque",
    "feedback": "realimentação",
    "learning": "aprendizado",
    "initialization": "inicialização",
    "calibration": "calibração",
    "adaptation": "adaptação",
    # Diversos
    "dtcs": "códigos de falha",
    "dtc": "código de falha",
    "mil": "luz de injeção",
    "hds": "scanner",
    "with the hds": "com o scanner",
    "ig on": "chave ligada",
    "ig off": "chave desligada",
    "vehicle": "veículo",
    "wheel": "roda",
    "dashboard": "painel",
    "instrument panel": "painel",
    "no.": "nº ",
    "and/or": "e/ou",
}

# Palavras de ligação em inglês que somem ou viram preposição.
LIGACOES = {
    "the": "",
    "a": "",
    "an": "",
    "of": "de",
    "to": "para",
    "in": "em",
    "on": "em",
    "at": "em",
    "for": "para",
    "with": "com",
    "without": "sem",
    "and": "e",
    "or": "ou",
    "is": "está",
    "are": "estão",
    "when": "quando",
    "during": "durante",
    "between": "entre",
    "from": "de",
    "than": "que",
    "this": "este",
    "that": "que",
    "its": "do",
    "it": "ele",
    "be": "estar",
    "been": "estado",
    "was": "estava",
    "has": "tem",
    "have": "têm",
    "there": "há",
    "more": "mais",
    "less": "menos",
    "side": "lado",
}

_TERMOS_ORD = None


def _termos_ordenados():
    global _TERMOS_ORD
    if _TERMOS_ORD is None:
        itens = sorted(TERMOS.items(), key=lambda kv: -len(kv[0]))
        _TERMOS_ORD = [(re.compile(r"\b" + re.escape(k) + r"\b", re.I), v) for k, v in itens]
    return _TERMOS_ORD


def traduzir(texto):
    """Inglês → português de oficina. Devolve (texto, palavras_nao_traduzidas)."""
    if not texto:
        return "", []
    bruto = texto.strip()
    chave = re.sub(r"\s+", " ", bruto.lower())
    if chave in FRASES:
        return _maiuscula(FRASES[chave]), []

    # Marca cada termo achado com um símbolo, para não traduzir pedaço de termo
    # já traduzido (o "line" de "fuel line" não pode virar "linha" duas vezes).
    achados = []

    def guardar(m):
        achados.append(m.group(0))
        return "\x00%d\x00" % (len(achados) - 1)

    t = bruto
    for padrao, _ in _termos_ordenados():
        t = padrao.sub(guardar, t)

    # Agora traduz as marcas e as ligações.
    def repor(m):
        i = int(m.group(1))
        orig = achados[i]
        chave_t = re.sub(r"\s+", " ", orig.lower())
        return TERMOS.get(chave_t, orig)

    t = re.sub(r"\x00(\d+)\x00", repor, t)

    sobras = []
    palavras = []
    for p in re.split(r"(\W+)", t):
        if not p or not re.match(r"[A-Za-z]", p):
            palavras.append(p)
            continue
        b = p.lower()
        if b in LIGACOES:
            palavras.append(LIGACOES[b])
            continue
        # Já em português (veio do glossário) ou sigla curta: deixa.
        if re.search(r"[áâãàéêíóôõúçÁÂÃÀÉÊÍÓÔÕÚÇ]", p) or len(p) <= 3 and p.isupper():
            palavras.append(p)
            continue
        if _parece_portugues(b):
            palavras.append(p)
            continue
        sobras.append(p)
        palavras.append(p)
    t = "".join(palavras)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,;")
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    return _maiuscula(t), sobras


# Palavras que o glossário produz e que não devem contar como "não traduzido".
_PT = set()
for _v in list(TERMOS.values()) + list(FRASES.values()) + list(LIGACOES.values()):
    for _w in re.findall(r"[A-Za-zÀ-ÿ]+", _v):
        _PT.add(_w.lower())


def _parece_portugues(palavra):
    return palavra in _PT


def _maiuscula(t):
    return t[:1].upper() + t[1:] if t else t
