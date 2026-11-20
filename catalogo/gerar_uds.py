#!/usr/bin/env python3
"""Extrai dos projetos abertos de comunidade o que serve para QUALQUER carro.

Uso: python3 catalogo/gerar_uds.py <pasta do CanZE> [<pasta do OVMS>]

O achado principal não é dado de Renault. Dentro dos arquivos de campo do CanZE
está a **tabela do byte de tipo de falha do UDS** (ISO 14229-1): o segundo byte
de um código de falha, que diz O QUE aconteceu com o componente — 17 é curto
para a massa, 19 é circuito aberto, 113 é atuador preso, 146 é desempenho. Essa
tabela é da NORMA, não da Renault: vale em Chevrolet, VW, Fiat, em tudo que fala
UDS. É ela que decodifica o sufixo que a gente viu na base da Honda (o "-2B" de
"B0001-2B").

Junto vem a tabela dos bits do byte de situação do código (confirmado, pendente,
teste não completou neste ciclo, luz pedida), também da norma.

Do OVMS sai o mapa de módulos por veículo: par de endereços de pedido e resposta,
tipo de consulta e identificador. A CONTA de cada sinal fica no C++ do módulo, não
na tabela, então ela NÃO é extraída — inventar fórmula é pior que não ter.

Escreve catalogo/uds/*.json.
"""
import csv
import json
import os
import re
import sys

# Nome do campo, dentro dos Fields do CanZE, que carrega cada tabela da norma.
TABELAS_NORMA = {
    "tipo_falha": "DTCFailureType",
    "tipo_falha_montadora": "DTCFailureType.ManufacturerOrSupplier",
    "tipo_falha_obd": "DTCDeviceAndFailureTypeOBD",
}

# Prefixo dos campos de situação do código.
PREFIXO_SITUACAO = "DTCStatus."


def _linhas_campos(pasta):
    """Todas as linhas de todos os *_Fields.csv, como listas de colunas."""
    for raiz, _, arquivos in os.walk(pasta):
        for a in sorted(arquivos):
            if not a.endswith("_Fields.csv"):
                continue
            caminho = os.path.join(raiz, a)
            veiculo = os.path.basename(raiz)
            with open(caminho, encoding="utf-8", errors="replace") as f:
                for cols in csv.reader(f):
                    if cols and not cols[0].startswith("#"):
                        yield veiculo, a[: -len("_Fields.csv")], cols


def _enum(cols):
    """A lista enumerada 0:texto;1:texto de uma linha de campo."""
    if len(cols) < 13:
        return {}
    fora = {}
    for parte in cols[12].split(";"):
        parte = parte.strip()
        m = re.match(r"^(\d+)\s*:\s*(.+)$", parte)
        if m:
            fora[int(m.group(1))] = m.group(2).strip()
    return fora


def tabelas_da_norma(pasta_canze):
    """As tabelas do UDS que valem em qualquer carro."""
    melhores = {k: {} for k in TABELAS_NORMA}
    situacao = {}
    for _, modulo, cols in _linhas_campos(pasta_canze):
        if len(cols) < 12:
            continue
        nome = cols[11].strip()
        for chave, alvo in TABELAS_NORMA.items():
            if nome == alvo:
                e = _enum(cols)
                if len(e) > len(melhores[chave]):
                    melhores[chave] = e
        if nome.startswith(PREFIXO_SITUACAO):
            bit = nome[len(PREFIXO_SITUACAO):]
            if bit and bit not in situacao:
                e = _enum(cols)
                situacao[bit] = {"sim": e.get(1, "Yes"), "nao": e.get(0, "No")}
    return melhores, situacao


def modulos_do_canze(pasta_canze):
    """Mapa de módulos por veículo, dos _Ecus.csv."""
    fora = {}
    for raiz, _, arquivos in os.walk(pasta_canze):
        if "_Ecus.csv" not in arquivos:
            continue
        veiculo = os.path.basename(raiz)
        linhas = []
        with open(os.path.join(raiz, "_Ecus.csv"), encoding="utf-8", errors="replace") as f:
            for cols in csv.reader(f):
                if not cols or cols[0].startswith("#") or len(cols) < 5:
                    continue
                linhas.append({
                    "nome": cols[0].strip(),
                    "pede_em": cols[4].strip(),      # To ID: para onde o pedido vai
                    "responde_em": cols[3].strip(),  # From ID: de onde a resposta vem
                    "sigla": (cols[5].strip() if len(cols) > 5 else ""),
                    "sessao": (cols[8].strip() if len(cols) > 8 else ""),
                })
        if linhas:
            fora[veiculo] = linhas
    return fora


# { pedido, resposta, TIPO, pid, { tempos }, barramento, protocolo }  // comentário
# Endereço e identificador vêm como hex OU como constante com nome
# (I3_ECU_SME_TX, CHARGER_TXID, POLL_FOR_BATTERY_SOC): sem resolver os #define,
# dois terços dos veículos do OVMS ficariam de fora.
VALOR = r"(0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)"
POLL = re.compile(
    r"\{\s*" + VALOR + r"\s*,\s*" + VALOR + r"\s*,"
    r"\s*(VEHICLE_POLL_TYPE_\w+)\s*,\s*" + VALOR + r"\s*,"
    r"\s*\{(.*?)\}\s*,\s*\d+\s*,\s*(\w+)\s*\}\s*,?\s*(?://\s*(.*))?$"
)
DEFINE = re.compile(r"^\s*#define\s+(\w+)\s+\(?\s*(0x[0-9A-Fa-f]+|\d+)\s*\)?\s*(?:/.*)?$")
CONST = re.compile(
    r"^\s*(?:static\s+)?(?:const\s+)?(?:uint\d+_t|int|unsigned)\s+(\w+)\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*;"
)


def _resolver(valor, defines):
    """Constante com nome → o hex que ela vale; o que não resolver fica como está."""
    if re.match(r"^(0x[0-9A-Fa-f]+|\d+)$", valor):
        n = int(valor, 0)
        return "%X" % n, True
    if valor in defines:
        return "%X" % defines[valor], True
    return valor, False


def modulos_do_ovms(pasta_ovms):
    """Par de endereços, tipo de consulta e identificador, por veículo."""
    base = os.path.join(pasta_ovms, "vehicle", "OVMS.V3", "components")
    if not os.path.isdir(base):
        return {}
    fora = {}
    nao_resolvidos = 0
    for d in sorted(os.listdir(base)):
        if not d.startswith("vehicle_"):
            continue
        src = os.path.join(base, d, "src")
        if not os.path.isdir(src):
            continue
        arquivos = [a for a in sorted(os.listdir(src)) if a.endswith((".cpp", ".h"))]
        # 1ª passada: junta todos os #define e constantes do módulo.
        defines = {}
        textos = {}
        for a in arquivos:
            with open(os.path.join(src, a), encoding="utf-8", errors="replace") as f:
                texto = f.read()
            textos[a] = texto
            for linha in texto.splitlines():
                m = DEFINE.match(linha) or CONST.match(linha)
                if m:
                    try:
                        defines[m.group(1)] = int(m.group(2), 0)
                    except ValueError:
                        pass
        # 2ª passada: as listas de consulta.
        achados = []
        for a in arquivos:
            for linha in textos[a].splitlines():
                m = POLL.search(linha.strip())
                if not m:
                    continue
                pede, ok1 = _resolver(m.group(1), defines)
                resp, ok2 = _resolver(m.group(2), defines)
                ident, ok3 = _resolver(m.group(4), defines)
                if not (ok1 and ok2 and ok3):
                    nao_resolvidos += 1
                achados.append({
                    "pede_em": pede,
                    "responde_em": resp,
                    "tipo": m.group(3).replace("VEHICLE_POLL_TYPE_", ""),
                    "id": ident,
                    "nota": (m.group(7) or "").strip(),
                })
        if achados:
            fora[d[len("vehicle_"):]] = achados
    if nao_resolvidos:
        print("  (%d consultas com constante que não resolveu; ficam com o nome)" % nao_resolvidos)
    return fora


def campos_do_canze(pasta_canze):
    """TODAS as definições de campo, por veículo e por módulo.

    Cada linha do CanZE é um sinal completo: endereço do módulo, primeiro e
    último bit dentro da resposta, multiplicador, offset, unidade, o pedido em
    hexa, a resposta esperada, a sessão e, quando o valor é enumerado, a lista
    com o texto de cada valor. Nada é filtrado por marca nem por relevância.
    """
    fora = {}
    for veiculo, modulo, cols in _linhas_campos(pasta_canze):
        if len(cols) < 12:
            continue
        reg = {
            "endereco": cols[1].strip(),
            "bit_de": cols[2].strip(),
            "bit_ate": cols[3].strip(),
            "mult": cols[4].strip(),
            "offset": cols[5].strip(),
            "divisor": cols[6].strip(),
            "unidade": cols[7].strip(),
            "pedido": cols[8].strip(),
            "resposta": cols[9].strip(),
            "sessao": cols[10].strip(),
            "nome": cols[11].strip(),
        }
        e = _enum(cols)
        if e:
            reg["valores"] = {str(k): v for k, v in e.items()}
        fora.setdefault(veiculo, {}).setdefault(modulo, []).append(reg)
    return fora


def codigos_do_canze(pasta_canze):
    """As tabelas de código de falha e de tipo de teste, por veículo e módulo."""
    fora = {}
    for raiz, _, arquivos in os.walk(pasta_canze):
        veiculo = os.path.basename(raiz)
        for a in sorted(arquivos):
            for sufixo, chave in (("_Dtcs.csv", "codigos"), ("_Tests.csv", "testes")):
                if not a.endswith(sufixo):
                    continue
                modulo = a[: -len(sufixo)]
                linhas = {}
                with open(os.path.join(raiz, a), encoding="utf-8", errors="replace") as f:
                    for cols in csv.reader(f):
                        if len(cols) >= 2 and cols[0].strip() and not cols[0].startswith("#"):
                            linhas[cols[0].strip()] = cols[1].strip()
                if linhas:
                    fora.setdefault(veiculo, {}).setdefault(chave, {})[modulo] = linhas
    return fora


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_uds.py <pasta do CanZE> [<pasta do OVMS>]")
    canze = sys.argv[1]
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uds")
    os.makedirs(destino, exist_ok=True)

    def grava(nome, dados, legivel=True):
        # As tabelas pequenas ficam legíveis, para dar para conferir no diff.
        # As grandes vão compactas: são dado de máquina, e indentar triplica.
        caminho = os.path.join(destino, nome + ".json")
        with open(caminho, "w", encoding="utf-8") as f:
            if legivel:
                json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
            else:
                json.dump(dados, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return os.path.getsize(caminho)

    normas, situacao = tabelas_da_norma(canze)
    n1 = grava("tipo_falha", {k: v for k, v in normas.items() if v})
    n2 = grava("situacao_codigo", situacao)
    print("TABELAS DA NORMA (valem em qualquer carro)")
    for k, v in normas.items():
        print("  %-24s %d entradas" % (k, len(v)))
    print("  %-24s %d bits" % ("situação do código", len(situacao)))
    print("  arquivos: %.0f KB + %.0f KB" % (n1 / 1024, n2 / 1024))

    mods = modulos_do_canze(canze)
    n3 = grava("modulos_renault", mods)
    print("\nMAPA DE MÓDULOS — CanZE")
    for v, l in sorted(mods.items()):
        print("  %-18s %d módulos" % (v, len(l)))
    print("  arquivo: %.0f KB" % (n3 / 1024))

    campos = campos_do_canze(canze)
    n5 = grava("campos_canze", campos, legivel=False)
    print("\nDEFINIÇÕES DE CAMPO — CanZE (tudo)")
    for v, m in sorted(campos.items()):
        tot = sum(len(x) for x in m.values())
        enums = sum(1 for x in m.values() for r in x if "valores" in r)
        print("  %-18s %6d campos em %2d módulos (%d com valor escrito)" % (v, tot, len(m), enums))
    print("  arquivo: %.1f MB" % (n5 / 1048576))

    cods = codigos_do_canze(canze)
    n6 = grava("codigos_canze", cods)
    print("\nCÓDIGOS E TIPOS DE TESTE — CanZE (tudo)")
    for v, d in sorted(cods.items()):
        c = sum(len(x) for x in d.get("codigos", {}).values())
        t = sum(len(x) for x in d.get("testes", {}).values())
        print("  %-18s %5d códigos, %5d tipos de teste" % (v, c, t))
    print("  arquivo: %.0f KB" % (n6 / 1024))

    if len(sys.argv) > 2:
        ov = modulos_do_ovms(sys.argv[2])
        n4 = grava("modulos_ovms", ov, legivel=False)
        tot = sum(len(v) for v in ov.values())
        print("\nMAPA DE MÓDULOS — OVMS (%d veículos, %d consultas)" % (len(ov), tot))
        for v, l in sorted(ov.items(), key=lambda kv: -len(kv[1]))[:12]:
            print("  %-26s %d" % (v, len(l)))
        print("  arquivo: %.0f KB" % (n4 / 1024))


if __name__ == "__main__":
    main()
