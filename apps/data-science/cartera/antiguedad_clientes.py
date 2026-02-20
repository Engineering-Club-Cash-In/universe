#!/usr/bin/env python3
"""
Calcula la antigüedad en meses de todos los clientes.

Estrategia: recorre cada hoja (mes) del Excel y registra la primera
aparición de cada cliente. La antigüedad es la diferencia entre esa
primera aparición y la fecha de referencia (Febrero 2026).
"""

import pandas as pd
import sys
from datetime import datetime

FILE = "cartera_20022026.xlsx"
FECHA_REFERENCIA = datetime(2026, 2, 1)

MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
    "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

MESES_NUM_A_ES = {v: k.capitalize() for k, v in MESES_ES.items()}

HOJAS_IGNORAR = {
    "lista negra", "hoja1", "hoja2", "facturacion inversionistas",
}


def parsear_fecha_hoja(nombre_hoja: str) -> datetime | None:
    """Convierte 'Junio 2018' -> datetime(2018, 6, 1)."""
    partes = nombre_hoja.strip().rstrip("_").split()
    if len(partes) != 2:
        return None
    mes_str, anio_str = partes[0].lower(), partes[1]
    mes = MESES_ES.get(mes_str)
    if mes is None or not anio_str.isdigit():
        return None
    return datetime(int(anio_str), mes, 1)


def leer_clientes_hoja(file_path: str, sheet_name: str) -> list[str]:
    """Lee la columna 'Nombre' de una hoja (header en fila 1)."""
    df = pd.read_excel(file_path, sheet_name=sheet_name, header=1)

    col_nombre = None
    for col in df.columns:
        if str(col).strip().lower() == "nombre":
            col_nombre = col
            break

    if col_nombre is None:
        return []

    nombres = df[col_nombre].dropna().astype(str).str.strip()
    return [n for n in nombres if n and n.lower() != "nan"]


def calcular_meses(desde: datetime, hasta: datetime) -> int:
    return (hasta.year - desde.year) * 12 + (hasta.month - desde.month)


def main():
    archivo = sys.argv[1] if len(sys.argv) > 1 else FILE

    xl = pd.ExcelFile(archivo)

    # Filtrar y ordenar hojas por fecha
    hojas_con_fecha = []
    for name in xl.sheet_names:
        if name.strip().rstrip("_").lower() in HOJAS_IGNORAR:
            continue
        fecha = parsear_fecha_hoja(name)
        if fecha:
            hojas_con_fecha.append((fecha, name))

    hojas_con_fecha.sort(key=lambda x: x[0])

    print(f"Hojas a procesar: {len(hojas_con_fecha)}")
    print(f"Rango: {hojas_con_fecha[0][1]} -> {hojas_con_fecha[-1][1]}")
    print()

    # Registrar primera aparicion de cada cliente
    primera_aparicion: dict[str, datetime] = {}

    for fecha_hoja, nombre_hoja in hojas_con_fecha:
        clientes = leer_clientes_hoja(archivo, nombre_hoja)
        nuevos = 0
        for cliente in clientes:
            if cliente not in primera_aparicion:
                primera_aparicion[cliente] = fecha_hoja
                nuevos += 1
        print(f"  {nombre_hoja:25s} -> {len(clientes):4d} clientes, {nuevos:3d} nuevos")

    print(f"\nTotal clientes unicos: {len(primera_aparicion)}")

    # Construir tabla de resultados
    resultados = []
    for cliente, fecha_inicio in primera_aparicion.items():
        meses = calcular_meses(fecha_inicio, FECHA_REFERENCIA)
        resultados.append({
            "Cliente": cliente,
            "Primera aparicion": f"{MESES_NUM_A_ES[fecha_inicio.month]} {fecha_inicio.year}",
            "Antiguedad (meses)": meses,
        })

    df_result = pd.DataFrame(resultados)
    df_result = df_result.sort_values("Antiguedad (meses)", ascending=False)

    # Guardar a Excel
    salida = "antiguedad_clientes.xlsx"
    df_result.to_excel(salida, index=False, sheet_name="Antiguedad")
    print(f"\nResultado guardado en: {salida}")

    # Mostrar resumen
    print(f"\n--- Resumen ---")
    print(f"  Promedio antiguedad: {df_result['Antiguedad (meses)'].mean():.1f} meses")
    print(f"  Mediana:             {df_result['Antiguedad (meses)'].median():.0f} meses")
    print(f"  Maximo:              {df_result['Antiguedad (meses)'].max()} meses")
    print(f"  Minimo:              {df_result['Antiguedad (meses)'].min()} meses")

    # Top 10 mas antiguos
    print(f"\n--- Top 10 mas antiguos ---")
    for _, row in df_result.head(10).iterrows():
        print(f"  {row['Cliente']:50s} {row['Antiguedad (meses)']:4d} meses ({row['Primera aparicion']})")


if __name__ == "__main__":
    main()
