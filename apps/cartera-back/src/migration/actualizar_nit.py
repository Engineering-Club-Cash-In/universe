import os
import pandas as pd
import json
import requests
from datetime import datetime
from typing import Dict, Any, List, Optional

# ============================================
# CONFIGURACION
# ============================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "carteraNits.xlsx"

HOJAS_A_PROCESAR = [
    "Enero 2026",
]

# Archivo de salida
ARCHIVO_SALIDA = f"nit_actualizados_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

# MODO PRUEBA
MODO_PRUEBA = False  # Cambiar a False para procesar todo
LIMITE_CREDITOS_PRUEBA = 3

# ============================================
# CONFIGURACION API
# ============================================
API_BASE_URL = "http://localhost:7000"  # Cambiar si es diferente
API_ENDPOINT = "/actualizar-nit"
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
# LEER HOJA Y EXTRAER NIT POR CREDITO
# ============================================
def leer_hoja_extraer_nit(
    archivo_path: str,
    nombre_hoja: str,
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja del Excel y extrae el NIT por credito.
    Retorna: {creditoBase: {nit, cliente}}
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
        col_nit = None

        for col in df.columns:
            col_lower = str(col).lower().strip()
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

            if not col_nit and 'nit' in col_lower:
                col_nit = col
                log(f"  Columna NIT encontrada: '{col}'")

        if not col_credito:
            log_error(f"No se encontro columna de credito SIFCO en {nombre_hoja}")
            return {}

        if not col_nit:
            # Mostrar todas las columnas para debug
            log_warn(f"No se encontro columna 'NIT' en {nombre_hoja}")
            log(f"  Columnas disponibles: {list(df.columns)}")
            return {}

        log(f"  Columnas: credito='{col_credito}', nombre='{col_nombre}', nit='{col_nit}'")

        # Limpiar datos
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')

        # Agrupar por creditoBase
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

            # Extraer NIT
            nit_raw = str(row[col_nit]).strip()
            if not nit_raw or nit_raw == 'nan' or nit_raw == '':
                filas_skipped += 1
                continue

            # Limpiar NIT (quitar espacios, guiones extra, etc.)
            nit = nit_raw.replace(' ', '').strip()

            # Normalizar credito al creditoBase (sin _2, _3, etc.)
            numero_credito_base = numero_credito_raw.split('_')[0]

            # Solo guardar si no existe ya (prioridad a la primera fila)
            if numero_credito_base not in creditos_data:
                creditos_data[numero_credito_base] = {
                    'creditoBase': numero_credito_base,
                    'cliente': cliente,
                    'nit': nit,
                    'nit_raw': nit_raw,
                }
                filas_procesadas += 1

        log_ok(f"  Filas procesadas: {filas_procesadas}, Creditos con NIT: {len(creditos_data)}, Skipped: {filas_skipped}")

        return creditos_data

    except Exception as e:
        log_error(f"Error leyendo hoja {nombre_hoja}: {e}")
        import traceback
        traceback.print_exc()
        return {}

# ============================================
# LLAMAR API PARA ACTUALIZAR NIT
# ============================================
def llamar_api_actualizar_nit(creditos_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Llama al endpoint /actualizar-nit para cada credito.
    """
    url = f"{API_BASE_URL}{API_ENDPOINT}"
    resultados = []

    log(f"Llamando API: {url}")
    log(f"Creditos a actualizar: {len(creditos_data)}")

    for i, credito in enumerate(creditos_data):
        numero = credito["numero_credito_sifco"]
        nit = credito["nit"]

        try:
            payload = {
                "numero_credito_sifco": numero,
                "nit": nit,
            }

            if MODO_PRUEBA:
                log(f"  [{i+1}/{len(creditos_data)}] {numero} -> NIT: {nit}")

            response = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30,
            )

            if response.status_code == 200:
                result = response.json()
                log_ok(f"  [{i+1}/{len(creditos_data)}] {numero}: {result.get('message', 'OK')}")
                resultados.append({
                    "numero_credito_sifco": numero,
                    "nit": nit,
                    "status": "ok",
                    "message": result.get("message", "OK"),
                })
            else:
                result = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                msg = result.get("message", response.text[:200])
                log_error(f"  [{i+1}/{len(creditos_data)}] {numero}: {response.status_code} - {msg}")
                resultados.append({
                    "numero_credito_sifco": numero,
                    "nit": nit,
                    "status": "error",
                    "status_code": response.status_code,
                    "message": msg,
                })

        except requests.exceptions.ConnectionError:
            log_error(f"  [{i+1}/{len(creditos_data)}] {numero}: No se pudo conectar")
            resultados.append({
                "numero_credito_sifco": numero,
                "nit": nit,
                "status": "error",
                "message": "Connection refused",
            })
            break  # Si no conecta, no seguir intentando
        except requests.exceptions.Timeout:
            log_error(f"  [{i+1}/{len(creditos_data)}] {numero}: Timeout")
            resultados.append({
                "numero_credito_sifco": numero,
                "nit": nit,
                "status": "error",
                "message": "Timeout",
            })
        except Exception as e:
            log_error(f"  [{i+1}/{len(creditos_data)}] {numero}: {e}")
            resultados.append({
                "numero_credito_sifco": numero,
                "nit": nit,
                "status": "error",
                "message": str(e),
            })

    return resultados

# ============================================
# FUNCION PRINCIPAL
# ============================================
def main():
    print("=" * 70)
    log("ACTUALIZADOR DE NIT POR CREDITO")
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

    # Recolectar NITs de todas las hojas
    todos_los_creditos: Dict[str, Dict[str, Any]] = {}

    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            log_warn(f"Hoja '{nombre_hoja}' no encontrada")
            continue

        print("-" * 70)
        creditos_hoja = leer_hoja_extraer_nit(archivo_path, nombre_hoja)

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

        if MODO_PRUEBA and len(todos_los_creditos) >= LIMITE_CREDITOS_PRUEBA:
            break

    print("=" * 70)
    log_ok(f"RESUMEN DE EXTRACCION")
    print("=" * 70)

    if MODO_PRUEBA:
        log_warn(f"*** MODO PRUEBA - Solo {len(todos_los_creditos)} credito(s) ***")

    log(f"Total creditos con NIT: {len(todos_los_creditos)}")

    # Mostrar ejemplos
    if todos_los_creditos:
        print("-" * 70)
        log("EJEMPLOS:")
        for i, (cb, data) in enumerate(todos_los_creditos.items()):
            if i >= 5:
                log(f"  ... y {len(todos_los_creditos) - 5} mas")
                break
            log(f"  {cb} -> NIT: {data['nit']} ({data['cliente'][:40]})")

    # Preparar salida JSON
    creditos_para_api = [
        {
            "numero_credito_sifco": data['creditoBase'],
            "nit": data['nit'],
            "cliente": data['cliente'][:50],
        }
        for data in todos_los_creditos.values()
    ]

    salida = {
        "fecha_generacion": datetime.now().isoformat(),
        "total_creditos": len(creditos_para_api),
        "creditos": creditos_para_api,
    }

    with open(ARCHIVO_SALIDA, 'w', encoding='utf-8') as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    log_ok(f"Archivo generado: {ARCHIVO_SALIDA}")
    print("=" * 70)

    # ============================================
    # LLAMAR A LA API
    # ============================================
    if LLAMAR_API and creditos_para_api:
        print("=" * 70)
        log("LLAMANDO A LA API PARA ACTUALIZAR NIT")
        print("=" * 70)

        resultados_api = llamar_api_actualizar_nit(creditos_para_api)

        # Resumen
        exitosos = sum(1 for r in resultados_api if r['status'] == 'ok')
        errores = sum(1 for r in resultados_api if r['status'] == 'error')

        print("-" * 70)
        log_ok(f"RESUMEN API:")
        log(f"  Exitosos: {exitosos}")
        log(f"  Errores: {errores}")
        log(f"  Total: {len(resultados_api)}")

        # Mostrar errores si hay
        errores_list = [r for r in resultados_api if r['status'] == 'error']
        if errores_list:
            print("-" * 70)
            log_error("CREDITOS CON ERROR:")
            for r in errores_list:
                log_error(f"  {r['numero_credito_sifco']}: {r['message']}")

        print("=" * 70)
        log_ok("PROCESO COMPLETADO")
    elif not LLAMAR_API:
        log_warn("LLAMAR_API = False, no se llamo a la API")
        log("Para llamar a la API, cambiar LLAMAR_API = True")
    else:
        log_warn("No hay creditos con NIT para actualizar")

if __name__ == "__main__":
    main()
