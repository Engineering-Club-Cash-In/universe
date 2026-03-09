#!/usr/bin/env python3
"""
Reporte de antigüedad en mora.

Para cada crédito activo en la cartera actual, cuenta cuántos meses
consecutivos lleva sin pagar (columna 'Abono interés CI' vacía),
mirando hacia atrás desde el último mes cerrado.

El mes de referencia para la lista de créditos es el más reciente
con >1000 clientes. El conteo de mora empieza desde el mes anterior
(último mes cerrado) para evitar contar meses aún no procesados.
"""

import pandas as pd
import sys
from datetime import datetime

FILE = "cartera_04032026.xlsx"

MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
    "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

HOJAS_IGNORAR = {
    "lista negra", "hoja1", "hoja2", "facturacion inversionistas",
}

COL_MORA = "Abono interés CI"


def parsear_fecha_hoja(nombre_hoja: str) -> datetime | None:
    partes = nombre_hoja.strip().rstrip("_").split()
    if len(partes) != 2:
        return None
    mes_str, anio_str = partes[0].lower(), partes[1]
    mes = MESES_ES.get(mes_str)
    if mes is None or not anio_str.isdigit():
        return None
    return datetime(int(anio_str), mes, 1)


def leer_hoja(xl, sheet_name: str) -> pd.DataFrame:
    df = pd.read_excel(xl, sheet_name=sheet_name, header=1)
    df = df[df['Nombre'].notna()]
    df = df[df['Nombre'].astype(str).str.strip() != '']
    df = df[df['Nombre'].astype(str).str.strip() != 'nan']
    return df


def main():
    archivo = sys.argv[1] if len(sys.argv) > 1 else FILE

    xl = pd.ExcelFile(archivo)

    # Filtrar y ordenar hojas por fecha (solo principales, sin _)
    hojas_con_fecha = []
    for name in xl.sheet_names:
        if name.strip().rstrip("_").lower() in HOJAS_IGNORAR:
            continue
        if name.strip().endswith("_"):
            continue
        fecha = parsear_fecha_hoja(name)
        if fecha:
            hojas_con_fecha.append((fecha, name))

    hojas_con_fecha.sort(key=lambda x: x[0])

    # Encontrar el mes más reciente con >1000 clientes (cartera actual)
    mes_actual_idx = len(hojas_con_fecha) - 1
    for i in range(len(hojas_con_fecha) - 1, -1, -1):
        df_test = leer_hoja(xl, hojas_con_fecha[i][1])
        if len(df_test) > 1000:
            mes_actual_idx = i
            break

    fecha_actual, hoja_actual = hojas_con_fecha[mes_actual_idx]
    print(f"Mes de referencia (cartera): {hoja_actual}")

    # Leer créditos del mes actual
    df_actual = leer_hoja(xl, hoja_actual)
    creditos_actuales = set(df_actual['# crédito SIFCO'].astype(str).str.strip())
    print(f"Créditos activos: {len(creditos_actuales)}")

    # Conteo de mora desde el mes ANTERIOR al de referencia hacia atrás
    # (el mes de referencia puede no estar cerrado)
    hojas_atras = hojas_con_fecha[:mes_actual_idx]
    hojas_atras.reverse()

    print(f"Conteo de mora desde: {hojas_atras[0][1]}")

    mora_consecutiva: dict[str, int] = {c: 0 for c in creditos_actuales}
    ya_resuelto: set[str] = set()

    for fecha, nombre_hoja in hojas_atras:
        df_mes = leer_hoja(xl, nombre_hoja)

        if COL_MORA not in df_mes.columns:
            print(f"  {nombre_hoja:25s} -> sin columna '{COL_MORA}', deteniendo")
            break

        df_mes['_credito'] = df_mes['# crédito SIFCO'].astype(str).str.strip()

        # Build lookup: credito -> tiene abono?
        abono_por_credito = {}
        for _, row in df_mes.iterrows():
            cred = row['_credito']
            if cred in creditos_actuales:
                abono_por_credito[cred] = pd.notna(row[COL_MORA])

        en_mora_mes = 0
        for credito in creditos_actuales:
            if credito in ya_resuelto:
                continue
            tiene_abono = abono_por_credito.get(credito)
            if tiene_abono is None:
                # Crédito no existía en este mes
                ya_resuelto.add(credito)
                continue
            if not tiene_abono:
                mora_consecutiva[credito] += 1
                en_mora_mes += 1
            else:
                ya_resuelto.add(credito)

        pendientes = len(creditos_actuales) - len(ya_resuelto)
        print(f"  {nombre_hoja:25s} -> {en_mora_mes:4d} en mora, {pendientes:4d} pendientes")

        if pendientes == 0:
            break

    # Construir resultado
    resultados = []
    for _, row in df_actual.iterrows():
        credito = str(row['# crédito SIFCO']).strip()
        resultados.append({
            "# Crédito SIFCO": credito,
            "Nombre": row['Nombre'],
            "Meses en mora": mora_consecutiva.get(credito, 0),
        })

    df_result = pd.DataFrame(resultados)
    df_result = df_result.sort_values("Meses en mora", ascending=False)

    # Guardar
    salida = "antiguedad_mora.xlsx"
    df_result.to_excel(salida, index=False, sheet_name="Antigüedad en Mora")
    print(f"\nResultado guardado en: {salida}")

    # Resumen
    en_mora = df_result[df_result['Meses en mora'] > 0]
    print(f"\n--- Resumen ---")
    print(f"  Total créditos:    {len(df_result)}")
    print(f"  En mora:           {len(en_mora)} ({100*len(en_mora)/len(df_result):.1f}%)")
    print(f"  Al día:            {len(df_result) - len(en_mora)}")
    if len(en_mora) > 0:
        print(f"  Promedio mora:     {en_mora['Meses en mora'].mean():.1f} meses")
        print(f"  Máximo mora:       {en_mora['Meses en mora'].max()} meses")

    # Distribución
    print(f"\n--- Distribución ---")
    rangos = [(0, 0, "Al día"), (1, 1, "1 mes"), (2, 3, "2-3 meses"),
              (4, 6, "4-6 meses"), (7, 12, "7-12 meses"), (13, 999, "13+ meses")]
    for low, high, label in rangos:
        cnt = len(df_result[(df_result['Meses en mora'] >= low) & (df_result['Meses en mora'] <= high)])
        print(f"  {label:15s} {cnt:5d} ({100*cnt/len(df_result):.1f}%)")


if __name__ == "__main__":
    main()
