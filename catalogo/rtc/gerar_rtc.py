#!/usr/bin/env python3
"""Gera js/rtcdados.js a partir do banco oficial da Calculadora de Tributos da Receita Federal.

O banco NÃO fica neste repositório (tem 5 MB e é regerável). Para montá-lo:

    git clone --depth 1 https://github.com/ReceitaFederal/calculadora-rtc-regime-regular.git
    python3 catalogo/rtc/montar_banco.py calculadora-rtc-regime-regular/flyway/sql calculadora.db

Depois:

    python3 catalogo/rtc/gerar_rtc.py calculadora.db js/rtcdados.js && python3 tools_sw.py

Só entram as 13 tabelas que o cálculo do Simples Nacional usa, com as vigências preservadas:
quem resolve a data do fato gerador é o js/rtc.js, não este gerador.

Fonte: github.com/ReceitaFederal (licença MIT, Copyright 2026 Receita Federal do Brasil).
"""
import json
import sqlite3
import sys
from datetime import date

# Tributo 2 = CBS. É assim que a calculadora da Receita separa as classificações
# tributárias que valem para o Simples Nacional (subconsulta repetida em todas as
# consultas do ClassificacaoTributariaSimplesRepository).
TRIBUTO_CBS = 2


def interseccao(ini1, fim1, ini2, fim2):
    """Período em que as duas vigências valem ao mesmo tempo (None = sem fim)."""
    inicio = max(ini1, ini2)
    if fim1 is None:
        fim = fim2
    elif fim2 is None:
        fim = fim1
    else:
        fim = min(fim1, fim2)
    if fim is not None and fim < inicio:
        return None
    return inicio, fim


def linhas(con, sql, *args):
    con.row_factory = sqlite3.Row
    return [dict(r) for r in con.execute(sql, args)]


def montar(con):
    dados = {}

    versao = linhas(con, "select * from VERSAO_BASE_DADO order by rowid desc limit 1")
    dados["versao_base"] = next(
        (str(v) for k, v in (versao[0].items() if versao else []) if "VERSAO" in k.upper() and v),
        "",
    )
    dados["gerado_em"] = date.today().isoformat()

    # cClassTrib do grupo CBS, com o tpRBSN de cada vigência
    dados["classificacoes"] = [
        {"cd": r["CLTR_CD"], "tpRBSN": r["CLTR_TPRBSN"],
         "de": r["CLTR_INICIO_VIGENCIA"], "ate": r["CLTR_FIM_VIGENCIA"]}
        for r in linhas(con, """
            select CLTR_CD, CLTR_TPRBSN, CLTR_INICIO_VIGENCIA, CLTR_FIM_VIGENCIA
            from CLASSIFICACAO_TRIBUTARIA
            where CLTR_SITR_ID in (select TRST_SITR_ID from TRIBUTO_SITUACAO_TRIBUTARIA
                                   where TRST_TBTO_ID = ?)
            order by CLTR_CD, CLTR_INICIO_VIGENCIA desc
        """, TRIBUTO_CBS)
    ]

    # cClassTrib × tipo de documento (vigência do vínculo cruzada com a do tipo de documento)
    vinculos = []
    for r in linhas(con, """
        select ct.CLTR_CD cd, td.TPDF_TIPO tpdoc,
               tdcl.TDCL_INICIO_VIGENCIA vi, tdcl.TDCL_FIM_VIGENCIA vf,
               td.TPDF_INICIO_VIGENCIA di, td.TPDF_FIM_VIGENCIA df
        from TIPO_DFE_CLASSIFICACAO tdcl
        join TIPO_DFE td on td.TPDF_ID = tdcl.TDCL_TPDF_ID
        join CLASSIFICACAO_TRIBUTARIA ct on ct.CLTR_ID = tdcl.TDCL_CLTR_ID
        where ct.CLTR_SITR_ID in (select TRST_SITR_ID from TRIBUTO_SITUACAO_TRIBUTARIA
                                  where TRST_TBTO_ID = ?)
    """, TRIBUTO_CBS):
        per = interseccao(r["vi"], r["vf"], r["di"], r["df"])
        if per:
            vinculos.append({"cd": r["cd"], "tpDoc": r["tpdoc"], "de": per[0], "ate": per[1]})
    dados["classTpDoc"] = vinculos

    # cClassTrib com tratamento tributário ainda não implementado pela Receita
    naoimpl = []
    for r in linhas(con, """
        select ct.CLTR_CD cd,
               ct.CLTR_INICIO_VIGENCIA ci, ct.CLTR_FIM_VIGENCIA cf,
               tc.TRCL_INICIO_VIGENCIA vi, tc.TRCL_FIM_VIGENCIA vf,
               tt.TRTR_INICIO_VIGENCIA ti, tt.TRTR_FIM_VIGENCIA tf
        from TRATAMENTO_CLASSIFICACAO tc
        join TRATAMENTO_TRIBUTARIO tt on tt.TRTR_ID = tc.TRCL_TRTR_ID
        join CLASSIFICACAO_TRIBUTARIA ct on ct.CLTR_ID = tc.TRCL_CLTR_ID
        where tt.TRTR_IN_POSSUI_AJUSTE = 1
          and ct.CLTR_SITR_ID in (select TRST_SITR_ID from TRIBUTO_SITUACAO_TRIBUTARIA
                                  where TRST_TBTO_ID = ?)
    """, TRIBUTO_CBS):
        per = interseccao(r["ci"], r["cf"], r["vi"], r["vf"])
        if per:
            per = interseccao(per[0], per[1], r["ti"], r["tf"])
        if per:
            naoimpl.append({"cd": r["cd"], "de": per[0], "ate": per[1]})
    dados["classNaoImplementada"] = naoimpl

    # Atividades do Simples Nacional
    dados["atividades"] = [
        {"id": r["ATSN_ID"], "cd": r["ATSN_CATIVSN"], "descricao": r["ATSN_DESCRICAO"],
         "anexo": r["ATSN_ANEXO_SEM_FATOR_R"], "anexoFatorR": r["ATSN_ANEXO_COM_FATOR_R"],
         "rotulo": r["ATSN_ROTULO"], "naoTributavel": bool(r["ATSN_IN_NAO_TRIBUTAVEL"]),
         "de": r["ATSN_INICIO_VIGENCIA"], "ate": r["ATSN_FIM_VIGENCIA"]}
        for r in linhas(con, "select * from ATIVIDADE_SIMPLES_NACIONAL order by ATSN_ORDEM")
    ]

    ativdoc = []
    for r in linhas(con, """
        select t.TDAS_ATSN_ID id, td.TPDF_TIPO tpdoc,
               t.TDAS_INICIO_VIGENCIA vi, t.TDAS_FIM_VIGENCIA vf,
               td.TPDF_INICIO_VIGENCIA di, td.TPDF_FIM_VIGENCIA df
        from TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL t
        join TIPO_DFE td on td.TPDF_ID = t.TDAS_TPDF_ID
    """):
        per = interseccao(r["vi"], r["vf"], r["di"], r["df"])
        if per:
            ativdoc.append({"id": r["id"], "tpDoc": r["tpdoc"], "de": per[0], "ate": per[1]})
    dados["atividadeTpDoc"] = ativdoc

    # Efeito do tipo de receita bruta
    dados["tiposReceita"] = [
        {"cd": r["TRBS_CD"], "descricao": r["TRBS_DESCRICAO"],
         "compoeReceita": bool(r["TRBS_IN_COMPOE_RECEITA"]),
         "isCompoeReceita": bool(r["TRBS_IN_IS_COMPOE_RECEITA"]),
         "fatorReceita": str(r["TRBS_FATOR_RECEITA"]),
         "pendenteSuspenso": bool(r["TRBS_IN_PENDENTE_SUSPENSO"]),
         "exigeAliquota": bool(r["TRBS_IN_EXIGE_ALIQUOTA"]),
         "vedadoNaoTributavel": bool(r["TRBS_IN_VEDADO_NAO_TRIBUTAVEL"]),
         "de": r["TRBS_INICIO_VIGENCIA"], "ate": r["TRBS_FIM_VIGENCIA"]}
        for r in linhas(con, "select * from TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL order by TRBS_CD")
    ]

    # Matriz de regime de apuração
    dados["regimes"] = [
        {"crt": r["RASN_CRT"], "tpRegime": r["RASN_TPREGIMEIBSCBS"], "descricao": r["RASN_DESCRICAO"],
         "geraIbs": bool(r["RASN_IN_GERA_IBS"]), "destinoDevido": r["RASN_DESTINO_DEVIDO"],
         "destinoPendenteSuspenso": r["RASN_DESTINO_PENDENTE_SUSPENSO"],
         "de": r["RASN_INICIO_VIGENCIA"], "ate": r["RASN_FIM_VIGENCIA"]}
        for r in linhas(con, "select * from REGIME_APURACAO_SIMPLES_NACIONAL "
                             "order by RASN_CRT, RASN_INICIO_VIGENCIA desc")
    ]

    # Transição de alíquotas na compra governamental
    dados["transicaoCompraGov"] = [
        {"fator": str(r["TACG_FATOR"]), "de": r["TACG_INICIO_VIGENCIA"], "ate": r["TACG_FIM_VIGENCIA"]}
        for r in linhas(con, "select * from TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL "
                             "order by TACG_INICIO_VIGENCIA")
    ]

    # Tipos de documento habilitados para o cálculo do Simples
    tpcalc = []
    for r in linhas(con, """
        select td.TPDF_TIPO tpdoc, td.TPDF_SIGLA sigla,
               t.TDCS_INICIO_VIGENCIA vi, t.TDCS_FIM_VIGENCIA vf,
               td.TPDF_INICIO_VIGENCIA di, td.TPDF_FIM_VIGENCIA df
        from TIPO_DFE_CALCULO_SIMPLES_NACIONAL t
        join TIPO_DFE td on td.TPDF_ID = t.TDCS_TPDF_ID
        order by td.TPDF_TIPO
    """):
        per = interseccao(r["vi"], r["vf"], r["di"], r["df"])
        if per:
            tpcalc.append({"tpDoc": r["tpdoc"], "sigla": r["sigla"], "de": per[0], "ate": per[1]})
    dados["tpDocCalculo"] = tpcalc

    # Lista fixa no código da Receita (ParametroCalculoSimplesService), não está em tabela
    dados["tpDocSemTratamento"] = [77, 94]

    return dados


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    con = sqlite3.connect(sys.argv[1])
    dados = montar(con)
    con.close()

    corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        fh.write("// GERADO por catalogo/rtc/gerar_rtc.py — NÃO EDITE À MÃO.\n")
        fh.write("// Tabelas oficiais da Calculadora de Tributos da Receita Federal\n")
        fh.write("// (github.com/ReceitaFederal, licença MIT, Copyright 2026 Receita Federal do Brasil).\n")
        fh.write("// Só o que o cálculo do Simples Nacional usa. Regras em js/rtc.js.\n")
        fh.write("export const RTC = " + corpo + ";\n")

    for chave, valor in dados.items():
        if isinstance(valor, list):
            print(f"{len(valor):>6}  {chave}")
    print(f"\n{sys.argv[2]}: {len(corpo) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
