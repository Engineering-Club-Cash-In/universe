"""
ETL Script para identificar pools raros por nombre y número de cuota.
Agrupa créditos que comparten el mismo nombre Y el mismo número de cuota,
y solo reporta los grupos con 2+ créditos coincidentes.
"""

import pandas as pd
import json
import os
from datetime import datetime

# Configuración
ARCHIVO_EXCEL = "cartera.xlsx"

ORDEN_MESES = [
    "Marzo 2026", "Febrero 2026", "Enero 2026", "Diciembre 2025", "Noviembre 2025",
    "Octubre 2025", "Septiembre 2025", "Agosto 2025", "Julio 2025",
    "Junio 2025", "Mayo 2025", "Abril 2025", "Marzo 2025",
    "Febrero 2025", "Enero 2025", "Diciembre 2024", "Noviembre 2024",
    "Octubre 2024", "Septiembre 2024", "Agosto 2024", "Julio 2024",
    "Junio 2024", "Mayo 2024", "Abril 2024", "Marzo 2024",
    "Febrero 2024", "Enero 2024"
]


def limpiar_nombre_columna(nombre):
    if pd.isna(nombre):
        return ""
    return str(nombre).strip()


def cargar_excel(ruta_archivo):
    print(f"\n{'='*60}")
    print(f"Cargando archivo: {ruta_archivo}")
    print(f"{'='*60}")
    xlsx = pd.ExcelFile(ruta_archivo, engine='openpyxl')
    hojas_disponibles = xlsx.sheet_names
    print(f"\nHojas encontradas ({len(hojas_disponibles)}):")
    for hoja in hojas_disponibles:
        print(f"  - {hoja}")
    return xlsx, hojas_disponibles


def cargar_hoja(xlsx, nombre_hoja):
    try:
        df = pd.read_excel(xlsx, sheet_name=nombre_hoja, header=1, engine='openpyxl')
        df.columns = [limpiar_nombre_columna(col) for col in df.columns]
        return df
    except Exception as e:
        print(f"  Error al cargar hoja '{nombre_hoja}': {e}")
        return None


def obtener_creditos_enero_2026(xlsx):
    print(f"\n{'='*60}")
    print("PASO 1: Obteniendo créditos válidos de Enero 2026")
    print(f"{'='*60}")

    df = cargar_hoja(xlsx, "Enero 2026")
    if df is None:
        raise Exception("No se pudo cargar la hoja 'Enero 2026'")

    print(f"  Registros totales en Enero 2026: {len(df)}")

    col_plazo = None
    for col in df.columns:
        if 'plazo' in col.lower():
            col_plazo = col
            break

    if col_plazo is None:
        df_validos = df.copy()
    else:
        df_validos = df[
            (df[col_plazo].notna()) &
            (df[col_plazo] != 0) &
            (df[col_plazo] != '') &
            (df[col_plazo] != '0')
        ].copy()

    print(f"  Registros con Plazo válido: {len(df_validos)}")
    return df_validos


def encontrar_columna(df, *keywords):
    """Busca una columna por keywords en su nombre"""
    for col in df.columns:
        col_lower = col.lower()
        for kw in keywords:
            if kw in col_lower:
                return col
    return None


def agrupar_por_nombre_y_cuota(df_creditos):
    """
    Agrupa créditos por (Nombre, NumeroCuota).
    Solo retorna grupos con 2+ créditos.
    """
    print(f"\n{'='*60}")
    print("PASO 2: Agrupando créditos por Nombre + Número de Cuota")
    print(f"{'='*60}")

    col_nombre = encontrar_columna(df_creditos, 'nombre')
    if col_nombre is None:
        raise Exception("No se encontró columna 'Nombre'")

    col_credito = encontrar_columna(df_creditos, 'crédito sifco', 'credito sifco')
    if col_credito is None:
        col_credito = encontrar_columna(df_creditos, 'crédito', 'credito')
    if col_credito is None:
        raise Exception("No se encontró columna de número de crédito SIFCO")

    # Columna '#' para número de cuota (índice 2)
    columnas_lista = list(df_creditos.columns)
    col_cuota_idx = None
    if len(columnas_lista) > 2 and columnas_lista[2] == '#':
        col_cuota_idx = 2

    print(f"  Columna nombre: '{col_nombre}'")
    print(f"  Columna crédito: '{col_credito}'")
    print(f"  Columna # cuota: índice {col_cuota_idx}")

    grupos = {}

    for _, fila in df_creditos.iterrows():
        nombre = fila[col_nombre]
        if pd.isna(nombre) or str(nombre).strip() == '':
            continue
        nombre = str(nombre).strip()

        numero_credito = fila[col_credito]
        if pd.isna(numero_credito) or str(numero_credito).strip() == '':
            continue
        numero_credito = str(numero_credito).strip()

        # Obtener número de cuota
        num_cuota = ""
        if col_cuota_idx is not None:
            val = fila.iloc[col_cuota_idx]
            if pd.notna(val):
                try:
                    num_cuota = str(int(float(val)))
                except (ValueError, TypeError):
                    num_cuota = str(val).strip()

        clave = (nombre, num_cuota)

        if clave not in grupos:
            grupos[clave] = []
        grupos[clave].append(numero_credito)

    # Filtrar solo grupos con 2+ créditos
    grupos_multi = {k: v for k, v in grupos.items() if len(v) >= 2}

    # Filtrar: solo mantener grupos donde hay 2+ créditos SIN "_"
    # Si un grupo tiene 1 sin "_" y el resto con "_", es el patrón normal padre/hijo → ignorar
    # Si tiene 2+ sin "_", es un pool raro → mantener (incluyendo los que tienen "_")
    grupos_pool = {}
    for clave, creditos in grupos_multi.items():
        sin_guion = [c for c in creditos if '_' not in c]
        if len(sin_guion) >= 2:
            grupos_pool[clave] = creditos

    total_grupos = len(grupos)
    total_pools = len(grupos_pool)
    total_creditos_en_pools = sum(len(v) for v in grupos_pool.values())

    print(f"\n  Total combinaciones (nombre, cuota): {total_grupos}")
    print(f"  Grupos con 2+ créditos: {len(grupos_multi)}")
    print(f"  Pools raros (2+ sin '_'): {total_pools}")
    print(f"  Total créditos en pools raros: {total_creditos_en_pools}")

    if total_pools > 0:
        print(f"\n  Detalle de pools encontrados:")
        for (nombre, cuota), creditos in sorted(grupos_pool.items()):
            print(f"    - {nombre} | Cuota #{cuota} → {len(creditos)} créditos: {creditos}")

    return grupos_pool, col_credito


def obtener_valor_pagado(fila):
    for col in fila.index:
        if 'pagado' in col.lower():
            val = fila[col]
            if pd.notna(val):
                return str(val).strip()
    return "No encontrado"


def extraer_info_pago(fila, columnas, hoja, pagado):
    info = {
        "numeroCredito": "",
        "fechaUltimoPago": hoja,
        "numeroCuota": "",
        "cuota": "",
        "montoBoleta": "",
        "pagado": pagado,
        "capitalRestante": "",
        "inversionista": "",
        "pago": ""
    }

    for col in columnas:
        col_str = str(col).strip() if pd.notna(col) else ""
        col_lower = col_str.lower()
        if '# crédito sifco' == col_lower or '# credito sifco' == col_lower:
            val = fila[col]
            info["numeroCredito"] = str(val).strip() if pd.notna(val) else ""

    columnas_lista = list(columnas)

    if len(columnas_lista) > 2 and columnas_lista[2] == '#':
        val = fila.iloc[2] if hasattr(fila, 'iloc') else fila[columnas_lista[2]]
        if pd.notna(val):
            try:
                info["numeroCuota"] = str(int(float(val)))
            except (ValueError, TypeError):
                info["numeroCuota"] = str(val).strip()

    if len(columnas_lista) > 25 and columnas_lista[25] == 'Capital restante':
        val = fila.iloc[25] if hasattr(fila, 'iloc') else fila[columnas_lista[25]]
        if pd.notna(val):
            info["capitalRestante"] = str(val)

    if len(columnas_lista) > 32 and columnas_lista[32] == 'Pago':
        val = fila.iloc[32] if hasattr(fila, 'iloc') else fila[columnas_lista[32]]
        if pd.notna(val):
            info["pago"] = str(val)

    if len(columnas_lista) > 35 and columnas_lista[35] == 'Inversionista':
        val = fila.iloc[35] if hasattr(fila, 'iloc') else fila[columnas_lista[35]]
        if pd.notna(val):
            info["inversionista"] = str(val)

    if len(columnas_lista) > 37 and columnas_lista[37] == 'Cuota':
        val = fila.iloc[37] if hasattr(fila, 'iloc') else fila[columnas_lista[37]]
        if pd.notna(val):
            info["cuota"] = str(val)

    if len(columnas_lista) > 38 and columnas_lista[38] == 'Monto boleta':
        val = fila.iloc[38] if hasattr(fila, 'iloc') else fila[columnas_lista[38]]
        if pd.notna(val):
            info["montoBoleta"] = str(val)

    return info


def extraer_info_pago_parcial(fila, columnas, hoja):
    info = {
        "fecha": hoja,
        "numeroCuota": "",
        "montoBoleta": ""
    }
    columnas_lista = list(columnas)

    if len(columnas_lista) > 2 and columnas_lista[2] == '#':
        val = fila.iloc[2] if hasattr(fila, 'iloc') else fila[columnas_lista[2]]
        if pd.notna(val):
            try:
                info["numeroCuota"] = str(int(float(val)))
            except (ValueError, TypeError):
                info["numeroCuota"] = str(val).strip()

    if len(columnas_lista) > 38 and columnas_lista[38] == 'Monto boleta':
        val = fila.iloc[38] if hasattr(fila, 'iloc') else fila[columnas_lista[38]]
        if pd.notna(val):
            info["montoBoleta"] = str(val)

    return info


def obtener_cuota_y_monto(fila, columnas):
    columnas_lista = list(columnas)
    cuota = None
    monto_boleta = None

    if len(columnas_lista) > 37 and columnas_lista[37] == 'Cuota':
        val = fila.iloc[37] if hasattr(fila, 'iloc') else fila[columnas_lista[37]]
        if pd.notna(val):
            try:
                cuota = float(val)
            except (ValueError, TypeError):
                pass

    if len(columnas_lista) > 38 and columnas_lista[38] == 'Monto boleta':
        val = fila.iloc[38] if hasattr(fila, 'iloc') else fila[columnas_lista[38]]
        if pd.notna(val):
            try:
                monto_boleta = float(val)
            except (ValueError, TypeError):
                pass

    return cuota, monto_boleta


def buscar_ultimo_pago_optimizado(hojas_cache, hojas_disponibles, numero_credito):
    """
    Busca última cuota pagada.
    - Pagada: cuando Cuota == Monto boleta
    - Pago parcial: cuando Monto boleta > 0 pero != Cuota
    - Ignorar: cuando Monto boleta es 0, vacío o null
    """
    hojas_ordenadas = []
    for mes in ORDEN_MESES:
        if mes in hojas_disponibles and mes in hojas_cache:
            hojas_ordenadas.append(mes)

    ultimo_registro_encontrado = None
    hoja_ultimo_registro = None
    columnas_ultimo = None
    pagos_parciales = []

    for hoja in hojas_ordenadas:
        df = hojas_cache.get(hoja)
        if df is None:
            continue

        col_buscar = encontrar_columna(df, 'crédito sifco', 'credito sifco')
        if col_buscar is None:
            continue

        numero_str = str(numero_credito).strip()
        df_temp = df[df[col_buscar].astype(str).str.strip() == numero_str]

        if len(df_temp) > 0:
            fila = df_temp.iloc[0]
            ultimo_registro_encontrado = fila
            hoja_ultimo_registro = hoja
            columnas_ultimo = df.columns

            cuota, monto_boleta = obtener_cuota_y_monto(fila, df.columns)

            if monto_boleta is None or monto_boleta == 0:
                continue

            if cuota is not None and monto_boleta >= cuota:
                pagado_real = obtener_valor_pagado(fila)
                info = extraer_info_pago(fila, df.columns, hoja, pagado_real)
                info["pagosParciales"] = pagos_parciales
                return info

            if cuota is not None and monto_boleta > 0 and monto_boleta < cuota:
                pago_parcial = extraer_info_pago_parcial(fila, df.columns, hoja)
                pagos_parciales.append(pago_parcial)

        else:
            if ultimo_registro_encontrado is not None:
                info = extraer_info_pago(
                    ultimo_registro_encontrado,
                    columnas_ultimo,
                    hoja_ultimo_registro,
                    obtener_valor_pagado(ultimo_registro_encontrado)
                )
                info["pagosParciales"] = pagos_parciales
                return info

    if ultimo_registro_encontrado is not None:
        info = extraer_info_pago(
            ultimo_registro_encontrado,
            columnas_ultimo,
            hoja_ultimo_registro,
            obtener_valor_pagado(ultimo_registro_encontrado)
        )
        info["pagosParciales"] = pagos_parciales
        return info

    return None


def procesar_pools_raros(xlsx, hojas_disponibles, grupos_pool):
    """
    Procesa los pools raros agrupados por nombre+cuota.
    Solo incluye grupos con 2+ créditos.
    """
    print(f"\n{'='*60}")
    print("PASO 3: Buscando última cuota pagada para cada crédito en pools raros")
    print(f"{'='*60}")

    print("\n  Cargando todas las hojas en memoria...")
    hojas_cache = {}
    for hoja in hojas_disponibles:
        df = cargar_hoja(xlsx, hoja)
        if df is not None:
            hojas_cache[hoja] = df
    print(f"  {len(hojas_cache)} hojas cargadas")

    resultado = []
    total_grupos = len(grupos_pool)

    for idx, ((nombre, num_cuota), creditos) in enumerate(sorted(grupos_pool.items()), 1):
        if idx % 50 == 0 or idx == 1:
            print(f"\n  Procesando pool {idx}/{total_grupos} - {nombre} | Cuota #{num_cuota}")

        creditos_info = []

        for numero_credito in creditos:
            info_pago = buscar_ultimo_pago_optimizado(
                hojas_cache,
                hojas_disponibles,
                numero_credito
            )

            if info_pago:
                creditos_info.append(info_pago)
            else:
                creditos_info.append({
                    "numeroCredito": str(numero_credito),
                    "fechaUltimoPago": "No encontrado",
                    "numeroCuota": "",
                    "cuota": "",
                    "montoBoleta": "",
                    "pagado": "No encontrado",
                    "capitalRestante": "",
                    "inversionista": "",
                    "pago": "",
                    "pagosParciales": []
                })

        resultado.append({
            "nombre": nombre,
            "numeroCuota": num_cuota,
            "numeroCredito": creditos[0],
            "creditos": creditos_info
        })

    return resultado


def guardar_resultado(resultado, nombre_archivo="resultado_pools_raros.json"):
    print(f"\n{'='*60}")
    print("PASO 4: Guardando resultado")
    print(f"{'='*60}")

    with open(nombre_archivo, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)

    print(f"  Archivo guardado: {nombre_archivo}")
    print(f"  Total de pools raros: {len(resultado)}")

    total_creditos = sum(len(r['creditos']) for r in resultado)
    print(f"  Total de créditos en pools raros: {total_creditos}")


def main():
    print("\n" + "="*60)
    print("ETL - Pools Raros (agrupados por Nombre + Cuota)")
    print(f"Inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    ruta_archivo = os.path.join(script_dir, ARCHIVO_EXCEL)

    if not os.path.exists(ruta_archivo):
        print(f"ERROR: No se encontró el archivo: {ruta_archivo}")
        print(f"  Buscando en carpeta scripts...")
        ruta_archivo = os.path.join(os.path.dirname(script_dir), ARCHIVO_EXCEL)
        if not os.path.exists(ruta_archivo):
            print(f"ERROR: Tampoco se encontró en: {ruta_archivo}")
            return

    try:
        xlsx, hojas_disponibles = cargar_excel(ruta_archivo)
        df_creditos = obtener_creditos_enero_2026(xlsx)
        grupos_pool, _ = agrupar_por_nombre_y_cuota(df_creditos)

        if not grupos_pool:
            print("\nNo se encontraron pools raros (créditos con mismo nombre y cuota).")
            return

        resultado = procesar_pools_raros(xlsx, hojas_disponibles, grupos_pool)
        guardar_resultado(resultado)

        print(f"\n{'='*60}")
        print(f"Proceso completado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*60)

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
