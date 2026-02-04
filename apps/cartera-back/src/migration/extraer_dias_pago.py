import os
import pandas as pd
import json
import requests
from datetime import datetime, date
from typing import Dict, Any, List, Optional
from collections import defaultdict

# ============================================
# CONFIGURACION
# ============================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

HOJAS_A_PROCESAR = [
    "Diciembre 2025",
]

# Archivo de salida
ARCHIVO_SALIDA = f"dias_pago_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

# MODO PRUEBA
MODO_PRUEBA = False  # Cambiar a False para procesar todo
LIMITE_CREDITOS_PRUEBA = 1

# ============================================
# CONFIGURACION API
# ============================================
API_BASE_URL = "http://localhost:7000"  # Cambiar si es diferente
API_ENDPOINT = "/update-due-dates"
LLAMAR_API = True  # True = llamar API, False = solo generar JSON

# ============================================
# LOGGER SIMPLE
# ============================================
def log(msg: str, tipo: str = "INFO"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{tipo:5}] {msg}")

def log_ok(msg: str):
    log(msg, "OK")

def log_warn(msg: str):
    log(msg, "WARN")

def log_error(msg: str):
    log(msg, "ERROR")

# ============================================
# DETECTAR POOLS RAROS (COPIADO DE procesar_creditos.py)
# ============================================
def detectar_pools_raros(
    df: pd.DataFrame,
    col_credito: str,
    col_nombre: str,
    col_numero: str
) -> Dict[str, List[str]]:
    """
    Pool raro = MISMO CLIENTE (normalizado) + MISMO # + SIN variaciones (_2, _3)
    Normaliza nombres quitando "/" y espacios extra
    """
    if not col_numero:
        return {}

    # Agrupar por: cliente_normalizado + numero_cuota
    grupos = defaultdict(list)

    for idx, row in df.iterrows():
        credito_raw = str(row[col_credito]).strip()

        if not credito_raw or credito_raw == 'nan':
            continue

        # Ignorar variaciones (esas son pools normales)
        if '_' in credito_raw:
            continue

        # Normalizar nombre de cliente
        nombre_cliente = str(row[col_nombre]).strip()

        if '/' in nombre_cliente:
            nombre_cliente = nombre_cliente.split('/')[0].strip()

        nombre_cliente = ' '.join(nombre_cliente.split()).upper()

        numero = str(row[col_numero]).strip()

        if not numero or numero == 'nan' or numero == '':
            continue

        clave = f"{nombre_cliente}||{numero}"
        grupos[clave].append(credito_raw)

    # Detectar pools raros (grupos con 2+ creditos)
    pools_raros = {}
    for clave, creditos in grupos.items():
        if len(creditos) >= 2:
            pools_raros[clave] = creditos

    return pools_raros

# ============================================
# EXTRAER DIA DE PAGO
# ============================================
def extraer_dia_de_fecha(valor: Any, debug: bool = False) -> Optional[int]:
    """
    Extrae SOLO el dia (numero 1-31) de una fecha.
    Puede venir como:
    - datetime/date object de Excel
    - String "15-dic", "30-dic", "15-ene", etc.
    - Numero entero (15, 30)

    IMPORTANTE: Retorna SOLO el numero del dia, no la fecha completa.
    """
    if pd.isna(valor) or valor == '' or valor is None:
        if debug:
            log(f"    [extraer_dia] valor vacio: {repr(valor)}")
        return None

    if debug:
        log(f"    [extraer_dia] tipo={type(valor).__name__}, valor={repr(valor)}")

    # Si es datetime, date o Timestamp de pandas
    if isinstance(valor, (datetime, pd.Timestamp)):
        dia = valor.day
        if debug:
            log(f"    [extraer_dia] datetime -> dia={dia}")
        return dia

    # Si viene como date puro (sin hora)
    if isinstance(valor, date) and not isinstance(valor, datetime):
        dia = valor.day
        if debug:
            log(f"    [extraer_dia] date -> dia={dia}")
        return dia

    # Si es string tipo "15-dic" o "30-ene"
    if isinstance(valor, str):
        valor_str = valor.strip()

        # Formato "DD-mes" (ej: "15-dic", "30-ene")
        if '-' in valor_str:
            try:
                dia_str = valor_str.split('-')[0].strip()
                dia = int(dia_str)
                if debug:
                    log(f"    [extraer_dia] string '{valor_str}' -> dia={dia}")
                return dia
            except (ValueError, IndexError) as e:
                if debug:
                    log_warn(f"    [extraer_dia] error parseando '{valor_str}': {e}")
                pass

        # Formato "DD/MM/YYYY" o "DD/MM"
        if '/' in valor_str:
            try:
                dia_str = valor_str.split('/')[0].strip()
                dia = int(dia_str)
                if debug:
                    log(f"    [extraer_dia] string '{valor_str}' (formato /) -> dia={dia}")
                return dia
            except (ValueError, IndexError):
                pass

        # Si es solo un numero como string
        try:
            dia = int(valor_str)
            if debug:
                log(f"    [extraer_dia] string numerico '{valor_str}' -> dia={dia}")
            return dia
        except ValueError:
            pass

    # Si es numero directo (int o float)
    if isinstance(valor, (int, float)):
        dia = int(valor)
        if debug:
            log(f"    [extraer_dia] numero {valor} -> dia={dia}")
        return dia

    if debug:
        log_warn(f"    [extraer_dia] No se pudo extraer dia de: {repr(valor)}")
    return None

# ============================================
# LEER HOJA Y EXTRAER DIAS DE PAGO (CON POOLS)
# ============================================
def leer_hoja_extraer_dias(
    archivo_path: str,
    nombre_hoja: str,
    solo_pools_raros: bool = False
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja del Excel y extrae el dia de pago por credito.
    AGRUPA usando la misma logica de procesar_creditos.py:
    - Pools normales: creditos con _2, _3, etc.
    - Pools raros: mismo cliente + mismo # pero creditos diferentes

    Retorna: {creditoBase: {dia_pago, cliente, filas_agrupadas}}
    """
    log(f"Procesando hoja: {nombre_hoja}")

    try:
        # Leer sin headers primero
        df_raw = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=None)

        # Buscar fila de headers
        header_row = None
        for idx, row in df_raw.iterrows():
            if idx > 20:
                break
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'credito' in row_str or 'sifco' in row_str:
                header_row = idx
                break

        if header_row is None:
            log_warn(f"No se encontraron headers en {nombre_hoja}")
            return {}

        # Leer con headers correctos
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        df.columns = df.columns.str.strip()

        log(f"  Filas: {len(df)}, Columnas: {len(df.columns)}")

        # Buscar columnas clave
        col_credito = None
        col_nombre = None
        col_numero = None
        col_pago = None

        for col in df.columns:
            col_lower = str(col).lower().strip()
            # Normalizar: quitar #, acentos, espacios extras
            col_norm = (
                col_lower
                .replace('#', '')
                .replace('crédito', 'credito')
                .replace('é', 'e')
                .strip()
            )

            if not col_credito and 'credito' in col_norm and 'sifco' in col_norm:
                col_credito = col
                log(f"  Columna credito encontrada: '{col}'")

            if not col_nombre and 'nombre' in col_lower and 'formato' not in col_lower and 'inversionista' not in col_lower:
                col_nombre = col

            if not col_numero and col == '#':
                col_numero = col

            if not col_pago and col_lower == 'pago':
                col_pago = col

        if not col_credito:
            log_error(f"No se encontro columna de credito SIFCO en {nombre_hoja}")
            return {}

        if not col_pago:
            log_warn(f"No se encontro columna 'Pago' en {nombre_hoja}")
            return {}

        log(f"  Columnas: credito='{col_credito}', nombre='{col_nombre}', #='{col_numero}', pago='{col_pago}'")

        # Limpiar datos
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')

        # Detectar pools raros
        pools_raros = {}
        if col_nombre and col_numero:
            pools_raros = detectar_pools_raros(df_clean, col_credito, col_nombre, col_numero)
            if pools_raros:
                log(f"  Pools raros detectados: {len(pools_raros)}")

        # Agrupar filas por creditoBase
        creditos_data: Dict[str, Dict[str, Any]] = {}
        filas_procesadas = 0
        filas_skipped = 0

        for _, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            if not numero_credito_raw or numero_credito_raw == 'nan':
                filas_skipped += 1
                continue

            cliente = (
                str(row[col_nombre]).strip()
                if col_nombre and row[col_nombre]
                else "Cliente Desconocido"
            )
            numero = str(row[col_numero]).strip() if col_numero and row[col_numero] else ""

            # Normalizar cliente
            cliente_norm = cliente
            if '/' in cliente_norm:
                cliente_norm = cliente_norm.split('/')[0].strip()
            cliente_norm = ' '.join(cliente_norm.split()).upper()

            # Determinar tipo de credito
            es_pool_normal = '_' in numero_credito_raw
            clave_pool = f"{cliente_norm}||{numero}" if numero else None
            es_pool_raro = (
                clave_pool
                and clave_pool in pools_raros
                and numero_credito_raw in pools_raros[clave_pool]
            )

            # Filtro por modo
            if solo_pools_raros and not es_pool_raro:
                filas_skipped += 1
                continue

            # Normalizar credito al creditoBase
            if es_pool_raro:
                numero_credito_base = pools_raros[clave_pool][0]
            elif es_pool_normal:
                numero_credito_base = numero_credito_raw.split('_')[0]
            else:
                numero_credito_base = numero_credito_raw

            # Extraer dia de pago
            valor_pago = row[col_pago]
            # En modo prueba, mostrar debug de extraccion
            debug_extraccion = MODO_PRUEBA and len(creditos_data) < 3
            if debug_extraccion:
                log(f"  Credito {numero_credito_raw}: valor_pago = {repr(valor_pago)}")
            dia_pago = extraer_dia_de_fecha(valor_pago, debug=debug_extraccion)

            # Agregar al grupo
            if numero_credito_base not in creditos_data:
                creditos_data[numero_credito_base] = {
                    'creditoBase': numero_credito_base,
                    'cliente': cliente,
                    'dia_pago': dia_pago,
                    'creditos_raw': [numero_credito_raw],
                    'es_pool_raro': es_pool_raro,
                    'es_pool_normal': es_pool_normal,
                }
            else:
                # Agregar credito raw al grupo
                if numero_credito_raw not in creditos_data[numero_credito_base]['creditos_raw']:
                    creditos_data[numero_credito_base]['creditos_raw'].append(numero_credito_raw)

                # Si no teniamos dia_pago, intentar sacarlo de esta fila
                if creditos_data[numero_credito_base]['dia_pago'] is None and dia_pago:
                    creditos_data[numero_credito_base]['dia_pago'] = dia_pago

            filas_procesadas += 1

        log_ok(f"  Filas procesadas: {filas_procesadas}, Creditos agrupados: {len(creditos_data)}")

        return creditos_data

    except Exception as e:
        log_error(f"Error leyendo hoja {nombre_hoja}: {e}")
        import traceback
        traceback.print_exc()
        return {}

# ============================================
# LLAMAR API
# ============================================
def llamar_api_actualizar_fechas(creditos_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Llama al endpoint /credits/update-due-dates para actualizar las fechas.
    """
    url = f"{API_BASE_URL}{API_ENDPOINT}"

    # Preparar payload (solo numero_credito_sifco y dia_pago)
    payload = {
        "creditos": [
            {
                "numero_credito_sifco": c["numero_credito_sifco"],
                "dia_pago": c["dia_pago"]
            }
            for c in creditos_data
        ]
    }

    log(f"Llamando API: {url}")
    log(f"Creditos a actualizar: {len(payload['creditos'])}")

    if MODO_PRUEBA:
        log("Payload:")
        print(json.dumps(payload, indent=2))

    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120  # 2 minutos timeout
        )

        log(f"Status code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            log_ok(f"API respondio exitosamente")
            log(f"  Exitosos: {result.get('exitosos', 'N/A')}")
            log(f"  Fallidos: {result.get('fallidos', 'N/A')}")
            return result
        else:
            log_error(f"Error en API: {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return {"error": response.text, "status_code": response.status_code}

    except requests.exceptions.ConnectionError:
        log_error(f"No se pudo conectar a {url}")
        log_error("Asegurate que el servidor este corriendo")
        return {"error": "Connection refused"}
    except requests.exceptions.Timeout:
        log_error("Timeout esperando respuesta de la API")
        return {"error": "Timeout"}
    except Exception as e:
        log_error(f"Error llamando API: {e}")
        return {"error": str(e)}

# ============================================
# FUNCION PRINCIPAL
# ============================================
def main():
    print("=" * 70)
    log("EXTRACTOR DE DIAS DE PAGO (CON POOLS)")
    print("=" * 70)

    if MODO_PRUEBA:
        log_warn(f"MODO PRUEBA ACTIVADO - Solo {LIMITE_CREDITOS_PRUEBA} credito(s)")

    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)

    if not os.path.exists(archivo_path):
        log_error(f"Archivo no encontrado: {archivo_path}")
        return

    log(f"Archivo: {ARCHIVO_EXCEL}")
    log(f"Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    print("-" * 70)

    # Verificar hojas disponibles
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = set(xls.sheet_names)
        log(f"Hojas disponibles: {len(hojas_disponibles)}")
    except Exception as e:
        log_error(f"Error abriendo archivo: {e}")
        return

    # Recolectar dias de pago de todas las hojas
    todos_los_creditos: Dict[str, Dict[str, Any]] = {}
    stats = {
        'hojas_procesadas': 0,
        'pools_normales': 0,
        'pools_raros': 0,
        'individuales': 0,
        'sin_dia_pago': 0,
    }

    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            log_warn(f"Hoja '{nombre_hoja}' no encontrada")
            continue

        print("-" * 70)
        creditos_hoja = leer_hoja_extraer_dias(archivo_path, nombre_hoja)
        stats['hojas_procesadas'] += 1

        for credito_base, data in creditos_hoja.items():
            # MODO PRUEBA: limitar cantidad
            if MODO_PRUEBA and len(todos_los_creditos) >= LIMITE_CREDITOS_PRUEBA:
                log_warn(f"MODO PRUEBA: Limite alcanzado ({LIMITE_CREDITOS_PRUEBA})")
                break

            # Solo guardar si no existe (prioridad a hojas anteriores)
            if credito_base not in todos_los_creditos:
                todos_los_creditos[credito_base] = {
                    **data,
                    'hoja_origen': nombre_hoja,
                }

                # Stats
                if data['es_pool_raro']:
                    stats['pools_raros'] += 1
                elif data['es_pool_normal']:
                    stats['pools_normales'] += 1
                else:
                    stats['individuales'] += 1

                if data['dia_pago'] is None:
                    stats['sin_dia_pago'] += 1

        # MODO PRUEBA: salir del loop de hojas si ya tenemos suficientes
        if MODO_PRUEBA and len(todos_los_creditos) >= LIMITE_CREDITOS_PRUEBA:
            break

    print("=" * 70)
    log_ok(f"RESUMEN DE EXTRACCION")
    print("=" * 70)

    if MODO_PRUEBA:
        log_warn(f"*** MODO PRUEBA - Solo {len(todos_los_creditos)} credito(s) ***")

    log(f"Hojas procesadas: {stats['hojas_procesadas']}")
    log(f"Total creditos agrupados: {len(todos_los_creditos)}")
    log(f"  - Individuales: {stats['individuales']}")
    log(f"  - Pools normales (_2, _3): {stats['pools_normales']}")
    log(f"  - Pools raros: {stats['pools_raros']}")
    log_warn(f"  - Sin dia de pago: {stats['sin_dia_pago']}")

    # En modo prueba, mostrar detalle completo
    if MODO_PRUEBA and todos_los_creditos:
        print("-" * 70)
        log("DETALLE DEL CREDITO DE PRUEBA:")
        for cb, data in todos_los_creditos.items():
            log(f"  creditoBase: {cb}")
            log(f"  cliente: {data['cliente']}")
            log(f"  dia_pago: {data['dia_pago']}")
            log(f"  hoja_origen: {data['hoja_origen']}")
            log(f"  es_pool_normal: {data['es_pool_normal']}")
            log(f"  es_pool_raro: {data['es_pool_raro']}")
            log(f"  creditos_raw: {data['creditos_raw']}")

    # Mostrar ejemplos de pools
    print("-" * 70)
    log("EJEMPLOS DE POOLS:")

    ejemplos_pool_normal = [c for c, d in todos_los_creditos.items() if d['es_pool_normal']][:3]
    if ejemplos_pool_normal:
        log("  Pools normales:")
        for cb in ejemplos_pool_normal:
            data = todos_los_creditos[cb]
            log(f"    {cb} -> Dia {data['dia_pago']} (agrupa: {data['creditos_raw']})")

    ejemplos_pool_raro = [c for c, d in todos_los_creditos.items() if d['es_pool_raro']][:3]
    if ejemplos_pool_raro:
        log("  Pools raros:")
        for cb in ejemplos_pool_raro:
            data = todos_los_creditos[cb]
            log(f"    {cb} -> Dia {data['dia_pago']} (agrupa: {data['creditos_raw']})")

    # Estadisticas de dias
    print("-" * 70)
    dias_count = defaultdict(int)
    for data in todos_los_creditos.values():
        if data['dia_pago']:
            dias_count[data['dia_pago']] += 1

    log("DISTRIBUCION DE DIAS DE PAGO:")
    for dia in sorted(dias_count.keys()):
        log(f"  Dia {dia:2d}: {dias_count[dia]} creditos")

    # Filtrar solo los que tienen dia de pago
    creditos_con_dia = {
        cb: data for cb, data in todos_los_creditos.items()
        if data['dia_pago'] is not None
    }

    # Preparar salida para el backend
    print("=" * 70)

    salida = {
        "fecha_generacion": datetime.now().isoformat(),
        "total_creditos": len(creditos_con_dia),
        "stats": {
            "pools_normales": stats['pools_normales'],
            "pools_raros": stats['pools_raros'],
            "individuales": stats['individuales'],
            "sin_dia_pago": stats['sin_dia_pago'],
        },
        "creditos": [
            {
                "numero_credito_sifco": data['creditoBase'],
                "dia_pago": data['dia_pago'],
                "cliente": data['cliente'][:50],  # Truncar para el JSON
                "hoja_origen": data['hoja_origen'],
                "es_pool": data['es_pool_normal'] or data['es_pool_raro'],
                "creditos_agrupados": len(data['creditos_raw']),
            }
            for data in creditos_con_dia.values()
        ]
    }

    with open(ARCHIVO_SALIDA, 'w', encoding='utf-8') as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    log_ok(f"Archivo generado: {ARCHIVO_SALIDA}")
    log(f"Creditos con dia de pago: {len(creditos_con_dia)}")
    print("=" * 70)

    # ============================================
    # LLAMAR A LA API
    # ============================================
    if LLAMAR_API and creditos_con_dia:
        print("=" * 70)
        log("LLAMANDO A LA API PARA ACTUALIZAR FECHAS")
        print("=" * 70)

        # Preparar lista para la API
        creditos_para_api = [
            {
                "numero_credito_sifco": data['creditoBase'],
                "dia_pago": data['dia_pago'],
            }
            for data in creditos_con_dia.values()
        ]

        resultado_api = llamar_api_actualizar_fechas(creditos_para_api)

        # Mostrar detalle de resultados
        if 'detalle' in resultado_api:
            print("-" * 70)
            log("DETALLE DE ACTUALIZACION:")
            for item in resultado_api['detalle']:
                status = item.get('status', 'unknown')
                credito = item.get('numero_credito_sifco', 'N/A')
                cuotas = item.get('cuotas_actualizadas', 0)

                if status == 'ok':
                    log_ok(f"  {credito}: {cuotas} cuotas actualizadas")
                elif status == 'sin_cuotas':
                    log_warn(f"  {credito}: sin cuotas pendientes")
                elif status == 'no_encontrado':
                    log_error(f"  {credito}: credito no encontrado")
                else:
                    log_error(f"  {credito}: {status} - {item.get('error', '')}")

        print("=" * 70)
        log_ok("PROCESO COMPLETADO")
    elif not LLAMAR_API:
        log_warn("LLAMAR_API = False, no se llamo a la API")
        log("Para llamar a la API, cambiar LLAMAR_API = True")
    else:
        log_warn("No hay creditos con dia de pago para actualizar")

if __name__ == "__main__":
    main()
