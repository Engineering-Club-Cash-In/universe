"""
ETL Script para procesar cartera de préstamos Cash-In
Procesa archivo Excel con múltiples hojas (meses) y genera JSON con última cuota pagada
"""

import pandas as pd
import json
import os
from datetime import datetime

# Configuración
ARCHIVO_EXCEL = "cartera.xlsx"
COLUMNAS_REQUERIDAS = [
    "Fecha", "# crédito SIFCO", "#", "Nombre", "Cuota",
    "Monto boleta", "Plazo", "Formato crédito", "Pagado"
]

# Orden de meses para procesar (de más reciente a más antiguo)
ORDEN_MESES = [
    "Marzo 2026", "Febrero 2026", "Enero 2026", "Diciembre 2025", "Noviembre 2025",
    "Octubre 2025", "Septiembre 2025", "Agosto 2025", "Julio 2025",
    "Junio 2025", "Mayo 2025", "Abril 2025", "Marzo 2025",
    "Febrero 2025", "Enero 2025", "Diciembre 2024", "Noviembre 2024",
    "Octubre 2024", "Septiembre 2024", "Agosto 2024", "Julio 2024",
    "Junio 2024", "Mayo 2024", "Abril 2024", "Marzo 2024",
    "Febrero 2024", "Enero 2024"
]


def cargar_excel(ruta_archivo):
    """Carga el archivo Excel y retorna un diccionario con todas las hojas"""
    print(f"\n{'='*60}")
    print(f"Cargando archivo: {ruta_archivo}")
    print(f"{'='*60}")

    try:
        xlsx = pd.ExcelFile(ruta_archivo, engine='openpyxl')
        hojas_disponibles = xlsx.sheet_names
        print(f"\nHojas encontradas ({len(hojas_disponibles)}):")
        for hoja in hojas_disponibles:
            print(f"  - {hoja}")

        return xlsx, hojas_disponibles
    except Exception as e:
        print(f"Error al cargar archivo: {e}")
        raise


def limpiar_nombre_columna(nombre):
    """Limpia y normaliza nombres de columnas"""
    if pd.isna(nombre):
        return ""
    return str(nombre).strip()


def cargar_hoja(xlsx, nombre_hoja):
    """Carga una hoja específica del Excel (encabezados en fila 2, índice 1)"""
    try:
        df = pd.read_excel(xlsx, sheet_name=nombre_hoja, header=1, engine='openpyxl')
        df.columns = [limpiar_nombre_columna(col) for col in df.columns]
        return df
    except Exception as e:
        print(f"  Error al cargar hoja '{nombre_hoja}': {e}")
        return None


def obtener_creditos_diciembre_2025(xlsx):
    """
    Obtiene todos los créditos de Diciembre 2025 que tienen Plazo válido (no vacío y no 0)
    """
    print(f"\n{'='*60}")
    print("PASO 1: Obteniendo créditos válidos de Diciembre 2025")
    print(f"{'='*60}")

    df = cargar_hoja(xlsx, "Diciembre 2025")
    if df is None:
        raise Exception("No se pudo cargar la hoja 'Diciembre 2025'")

    print(f"  Registros totales en Diciembre 2025: {len(df)}")

    # Mostrar columnas disponibles
    print(f"\n  Columnas disponibles:")
    for col in df.columns:
        print(f"    - '{col}'")

    # Buscar columna Plazo (puede tener variaciones)
    col_plazo = None
    for col in df.columns:
        if 'plazo' in col.lower():
            col_plazo = col
            break

    if col_plazo is None:
        print("  ADVERTENCIA: No se encontró columna 'Plazo', usando todos los registros")
        df_validos = df.copy()
    else:
        # Filtrar registros con Plazo válido (no vacío y no 0)
        df_validos = df[
            (df[col_plazo].notna()) &
            (df[col_plazo] != 0) &
            (df[col_plazo] != '') &
            (df[col_plazo] != '0')
        ].copy()

    print(f"  Registros con Plazo válido: {len(df_validos)}")

    # Guardar créditos válidos en Excel separado
    archivo_creditos_validos = "creditos_validos_diciembre_2025.xlsx"
    df_validos.to_excel(archivo_creditos_validos, index=False)
    print(f"  Guardado en: {archivo_creditos_validos}")

    return df_validos


def identificar_credito_padre(numero_credito):
    """
    Identifica si un crédito es padre o hijo (Pool)
    Padre: no tiene "_" (ej: 01010214119070)
    Hijo: tiene "_" seguido de número (ej: 01010214119070_2)
    """
    if pd.isna(numero_credito):
        return None, None, False

    numero_str = str(numero_credito).strip()

    if '_' in numero_str:
        partes = numero_str.split('_')
        padre = partes[0]
        return numero_str, padre, True  # Es hijo
    else:
        return numero_str, numero_str, False  # Es padre


def agrupar_creditos_por_padre(df_creditos):
    """
    Agrupa los créditos por su número padre
    Retorna un diccionario: {padre: [lista de créditos relacionados]}
    """
    print(f"\n{'='*60}")
    print("PASO 2: Agrupando créditos por padre (Pool)")
    print(f"{'='*60}")

    # Buscar columna de número de crédito
    col_credito = None
    for col in df_creditos.columns:
        if 'crédito sifco' in col.lower() or 'credito sifco' in col.lower():
            col_credito = col
            break

    if col_credito is None:
        # Intentar con otras variaciones
        for col in df_creditos.columns:
            if 'crédito' in col.lower() or 'credito' in col.lower():
                col_credito = col
                break

    if col_credito is None:
        raise Exception("No se encontró columna de número de crédito SIFCO")

    print(f"  Usando columna: '{col_credito}'")

    grupos = {}
    creditos_unicos = df_creditos[col_credito].dropna().unique()

    for numero in creditos_unicos:
        numero_str, padre, _ = identificar_credito_padre(numero)
        if numero_str is None:
            continue

        if padre not in grupos:
            grupos[padre] = []

        if numero_str not in grupos[padre]:
            grupos[padre].append(numero_str)

    # Ordenar cada grupo (padre primero, luego hijos)
    for padre in grupos:
        grupos[padre] = sorted(grupos[padre], key=lambda x: (1 if '_' in str(x) else 0, str(x)))

    total_padres = len(grupos)
    total_con_hijos = sum(1 for g in grupos.values() if len(g) > 1)

    print(f"  Total créditos únicos (padres): {total_padres}")
    print(f"  Créditos tipo Pool (con hijos): {total_con_hijos}")

    return grupos, col_credito


def buscar_ultimo_pago(xlsx, hojas_disponibles, numero_credito, col_credito):
    """
    Busca la última cuota pagada para un crédito específico
    Recorre desde Febrero 2026 hacia atrás hasta encontrar "Si" en Pagado
    """
    # Ordenar hojas según ORDEN_MESES (de más reciente a más antiguo)
    hojas_ordenadas = []
    for mes in ORDEN_MESES:
        if mes in hojas_disponibles:
            hojas_ordenadas.append(mes)

    # Agregar hojas que no estén en el orden predefinido
    for hoja in hojas_disponibles:
        if hoja not in hojas_ordenadas:
            hojas_ordenadas.append(hoja)

    ultimo_registro_encontrado = None
    hoja_ultimo_registro = None

    for hoja in hojas_ordenadas:
        df = cargar_hoja(xlsx, hoja)
        if df is None:
            continue

        # Buscar el crédito en esta hoja
        if col_credito not in df.columns:
            # Intentar encontrar la columna equivalente
            col_equiv = None
            for col in df.columns:
                if 'crédito sifco' in col.lower() or 'credito sifco' in col.lower():
                    col_equiv = col
                    break
            if col_equiv is None:
                continue
            col_buscar = col_equiv
        else:
            col_buscar = col_credito

        # Convertir a string para comparar
        df['_temp_credito'] = df[col_buscar].astype(str).str.strip()
        numero_str = str(numero_credito).strip()

        registro = df[df['_temp_credito'] == numero_str]

        if len(registro) > 0:
            # Encontramos el crédito en esta hoja
            fila = registro.iloc[0]

            # Guardar como último registro encontrado
            ultimo_registro_encontrado = fila
            hoja_ultimo_registro = hoja

            # Buscar columna Pagado
            col_pagado = None
            for col in df.columns:
                if 'pagado' in col.lower():
                    col_pagado = col
                    break

            if col_pagado and pd.notna(fila.get(col_pagado)):
                pagado = str(fila[col_pagado]).strip().lower()
                if pagado == 'si' or pagado == 'sí':
                    # Encontramos el último pago
                    return extraer_info_pago(fila, df.columns, hoja, "Si")
        else:
            # No se encontró el crédito en esta hoja
            if ultimo_registro_encontrado is not None:
                # Retornar el último registro encontrado (de la hoja anterior)
                return extraer_info_pago(
                    ultimo_registro_encontrado,
                    ultimo_registro_encontrado.index,
                    hoja_ultimo_registro,
                    obtener_valor_pagado(ultimo_registro_encontrado)
                )

    # Si llegamos aquí, retornar el último registro encontrado (si existe)
    if ultimo_registro_encontrado is not None:
        return extraer_info_pago(
            ultimo_registro_encontrado,
            ultimo_registro_encontrado.index,
            hoja_ultimo_registro,
            obtener_valor_pagado(ultimo_registro_encontrado)
        )

    return None


def obtener_valor_pagado(fila):
    """Obtiene el valor de la columna Pagado de una fila"""
    for col in fila.index:
        if 'pagado' in col.lower():
            val = fila[col]
            if pd.notna(val):
                return str(val).strip()
    return "No encontrado"


def extraer_info_pago(fila, columnas, hoja, pagado):
    """Extrae la información de pago de una fila"""
    info = {
        "numeroCredito": "",
        "fechaUltimoPago": hoja,
        "numeroCuota": "",
        "cuota": "",
        "montoBoleta": "",
        "pagado": pagado
    }

    # Buscar por nombre exacto de columna
    for col in columnas:
        col_str = str(col).strip() if pd.notna(col) else ""
        col_lower = col_str.lower()

        # # crédito SIFCO → numeroCredito
        if '# crédito sifco' == col_lower or '# credito sifco' == col_lower:
            val = fila[col]
            info["numeroCredito"] = str(val).strip() if pd.notna(val) else ""

    # Usar índices específicos para evitar duplicados
    # # (índice 2) → numeroCuota
    # Cuota (índice 37) → cuota
    # Monto boleta (índice 38) → montoBoleta
    columnas_lista = list(columnas)

    # numeroCuota - columna '#' índice 2
    if len(columnas_lista) > 2 and columnas_lista[2] == '#':
        val = fila.iloc[2] if hasattr(fila, 'iloc') else fila[columnas_lista[2]]
        if pd.notna(val):
            # Puede ser número o texto como "10 de 12 / 10 de 60"
            try:
                info["numeroCuota"] = str(int(float(val)))
            except (ValueError, TypeError):
                info["numeroCuota"] = str(val).strip()

    # cuota - columna 'Cuota' índice 37
    if len(columnas_lista) > 37 and columnas_lista[37] == 'Cuota':
        val = fila.iloc[37] if hasattr(fila, 'iloc') else fila[columnas_lista[37]]
        if pd.notna(val):
            info["cuota"] = str(val)

    # montoBoleta - columna 'Monto boleta' índice 38
    if len(columnas_lista) > 38 and columnas_lista[38] == 'Monto boleta':
        val = fila.iloc[38] if hasattr(fila, 'iloc') else fila[columnas_lista[38]]
        if pd.notna(val):
            info["montoBoleta"] = str(val)

    return info


def procesar_creditos(xlsx, hojas_disponibles, grupos_creditos):
    """
    Procesa todos los créditos y busca su última cuota pagada
    """
    print(f"\n{'='*60}")
    print("PASO 3: Buscando última cuota pagada para cada crédito")
    print(f"{'='*60}")

    # Cargar todas las hojas en memoria para optimizar
    print("\n  Cargando todas las hojas en memoria...")
    hojas_cache = {}
    for hoja in hojas_disponibles:
        df = cargar_hoja(xlsx, hoja)
        if df is not None:
            hojas_cache[hoja] = df
    print(f"  {len(hojas_cache)} hojas cargadas")

    resultado = []
    total_grupos = len(grupos_creditos)

    for idx, (padre, creditos) in enumerate(grupos_creditos.items(), 1):
        if idx % 100 == 0 or idx == 1:
            print(f"\n  Procesando grupo {idx}/{total_grupos} - Padre: {padre}")

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
                # No se encontró información
                creditos_info.append({
                    "numeroCredito": str(numero_credito),
                    "fechaUltimoPago": "No encontrado",
                    "numeroCuota": "",
                    "cuota": "",
                    "montoBoleta": "",
                    "pagado": "No encontrado"
                })

        resultado.append({
            "numeroCredito": str(padre),
            "creditos": creditos_info
        })

    return resultado


def extraer_info_pago_parcial(fila, columnas, hoja):
    """Extrae información de un pago parcial"""
    info = {
        "fecha": hoja,
        "numeroCuota": "",
        "montoBoleta": ""
    }

    columnas_lista = list(columnas)

    # numeroCuota - columna '#' índice 2
    if len(columnas_lista) > 2 and columnas_lista[2] == '#':
        val = fila.iloc[2] if hasattr(fila, 'iloc') else fila[columnas_lista[2]]
        if pd.notna(val):
            try:
                info["numeroCuota"] = str(int(float(val)))
            except (ValueError, TypeError):
                info["numeroCuota"] = str(val).strip()

    # montoBoleta - columna 'Monto boleta' índice 38
    if len(columnas_lista) > 38 and columnas_lista[38] == 'Monto boleta':
        val = fila.iloc[38] if hasattr(fila, 'iloc') else fila[columnas_lista[38]]
        if pd.notna(val):
            info["montoBoleta"] = str(val)

    return info


def obtener_cuota_y_monto(fila, columnas):
    """Obtiene los valores de Cuota y Monto boleta de una fila"""
    columnas_lista = list(columnas)
    cuota = None
    monto_boleta = None

    # Cuota - índice 37
    if len(columnas_lista) > 37 and columnas_lista[37] == 'Cuota':
        val = fila.iloc[37] if hasattr(fila, 'iloc') else fila[columnas_lista[37]]
        if pd.notna(val):
            try:
                cuota = float(val)
            except (ValueError, TypeError):
                pass

    # Monto boleta - índice 38
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
    # Ordenar hojas según ORDEN_MESES
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

        # Buscar columna de crédito
        col_buscar = None
        for col in df.columns:
            if 'crédito sifco' in col.lower() or 'credito sifco' in col.lower():
                col_buscar = col
                break

        if col_buscar is None:
            continue

        # Buscar el crédito
        numero_str = str(numero_credito).strip()
        df_temp = df[df[col_buscar].astype(str).str.strip() == numero_str]

        if len(df_temp) > 0:
            fila = df_temp.iloc[0]
            ultimo_registro_encontrado = fila
            hoja_ultimo_registro = hoja
            columnas_ultimo = df.columns

            # Obtener Cuota y Monto boleta
            cuota, monto_boleta = obtener_cuota_y_monto(fila, df.columns)

            # Si monto_boleta es 0, vacío o null → ignorar y seguir buscando
            if monto_boleta is None or monto_boleta == 0:
                continue

            # Si Monto boleta >= Cuota → Pagada completa
            if cuota is not None and monto_boleta >= cuota:
                # Obtener valor real de la columna Pagado
                pagado_real = obtener_valor_pagado(fila)
                info = extraer_info_pago(fila, df.columns, hoja, pagado_real)
                info["pagosParciales"] = pagos_parciales
                return info

            # Si 0 < Monto boleta < Cuota → Pago parcial
            if cuota is not None and monto_boleta > 0 and monto_boleta < cuota:
                pago_parcial = extraer_info_pago_parcial(fila, df.columns, hoja)
                pagos_parciales.append(pago_parcial)
                # Seguir buscando...

        else:
            # No encontrado en esta hoja
            if ultimo_registro_encontrado is not None:
                info = extraer_info_pago(
                    ultimo_registro_encontrado,
                    columnas_ultimo,
                    hoja_ultimo_registro,
                    obtener_valor_pagado(ultimo_registro_encontrado)
                )
                info["pagosParciales"] = pagos_parciales
                return info

    # Si llegamos aquí, retornar último registro encontrado
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


def guardar_resultado(resultado, nombre_archivo="resultado_ultimos_pagos.json"):
    """Guarda el resultado en un archivo JSON"""
    print(f"\n{'='*60}")
    print("PASO 4: Guardando resultado")
    print(f"{'='*60}")

    with open(nombre_archivo, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)

    print(f"  Archivo guardado: {nombre_archivo}")
    print(f"  Total de créditos padre procesados: {len(resultado)}")

    # Estadísticas
    total_creditos = sum(len(r['creditos']) for r in resultado)
    pagados_si = sum(
        1 for r in resultado
        for c in r['creditos']
        if c['pagado'].lower() in ['si', 'sí']
    )

    print(f"  Total de registros de crédito: {total_creditos}")
    print(f"  Créditos con último pago 'Si': {pagados_si}")


def main():
    """Función principal"""
    print("\n" + "="*60)
    print("ETL - Procesamiento de Cartera de Préstamos Cash-In")
    print(f"Inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)

    # Obtener ruta del archivo
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ruta_archivo = os.path.join(script_dir, ARCHIVO_EXCEL)

    if not os.path.exists(ruta_archivo):
        print(f"ERROR: No se encontró el archivo: {ruta_archivo}")
        return

    try:
        # 1. Cargar Excel
        xlsx, hojas_disponibles = cargar_excel(ruta_archivo)

        # 2. Obtener créditos válidos de Diciembre 2025
        df_creditos = obtener_creditos_diciembre_2025(xlsx)

        # 3. Agrupar por padre (Pool)
        grupos_creditos, _ = agrupar_creditos_por_padre(df_creditos)

        # 4. Procesar y buscar últimos pagos
        resultado = procesar_creditos(xlsx, hojas_disponibles, grupos_creditos)

        # 5. Guardar resultado
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
