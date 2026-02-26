import os
import json
import pandas as pd
import requests
from datetime import datetime
from dateutil.relativedelta import relativedelta

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:9000/marcar-liquidado-inversionistas"
CARPETA_EXCELS = "/home/jalvarezatcci/Documentos/Mientras/Test2"

# MODO PRUEBA: si True, limita archivos y registros para testing
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 1
MAX_REGISTROS_PRUEBA = 5

# ============================================
# FUNCIONES AUXILIARES
# ============================================
def extraer_nombre_inversionista(nombre_archivo):
    """Extrae el nombre del inversionista del nombre del archivo"""
    nombre_limpio = nombre_archivo
    extensiones_conocidas = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv']

    while True:
        nombre_sin_ext, extension = os.path.splitext(nombre_limpio)
        if extension.lower() in extensiones_conocidas:
            nombre_limpio = nombre_sin_ext
        else:
            break

    return nombre_limpio.strip()


def normalizar_cuota_mes(cuota_mes: str) -> str:
    """
    Normaliza el cuota_mes para enviarlo al endpoint.
    OJO: Este script NO resta 1 mes — el endpoint /marcar-liquidado-inversionistas
    usa el mes TAL CUAL está en el Excel (a diferencia de liquidar-cuotas-batch-inteligente).
    """
    mes_limpio = cuota_mes.strip().rstrip('.')
    mes_limpio = (mes_limpio
                  .replace('2025', '25')
                  .replace('2024', '24')
                  .replace('2023', '23')
                  .replace('2026', '26'))

    # Si hay varios meses separados por "y" o coma, tomar el ÚLTIMO
    if ' y ' in mes_limpio:
        mes_limpio = mes_limpio.split(' y ')[-1].strip()
    if ',' in mes_limpio:
        mes_limpio = mes_limpio.split(',')[-1].strip()
    if ' - ' in mes_limpio:
        mes_limpio = mes_limpio.split(' - ')[-1].strip()

    partes = mes_limpio.split()
    if len(partes) == 2:
        mes = partes[0].lower().replace('.', '')[:3]
        año = partes[1]

        meses_validos = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                         'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
        if mes in meses_validos:
            return f"{mes}. {año}"

    return mes_limpio


# ============================================
# 📊 PROCESAR EXCEL — EXTRAER REGISTROS
# ============================================
def procesar_excel(archivo_path):
    """Lee el Excel y extrae registros (cliente, cuota_mes) para el nuevo endpoint."""
    print(f"\n📄 Procesando: {os.path.basename(archivo_path)}")

    nombre_inversionista = extraer_nombre_inversionista(os.path.basename(archivo_path))
    print(f"   👤 Inversionista: {nombre_inversionista}")

    try:
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        ultima_hoja = xls.sheet_names[-1]
        print(f"   📊 Usando hoja: '{ultima_hoja}'")

        df_raw = pd.read_excel(archivo_path, sheet_name=ultima_hoja,
                               engine='openpyxl', header=None)

        # Buscar fila de headers
        header_row = None
        for idx, row in df_raw.iterrows():
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'capital' in row_str and 'cuota de mes' in row_str:
                header_row = idx
                print(f"   ✅ Headers en fila {idx}")
                break

        if header_row is None:
            print("   ⚠️ No se encontró la fila de headers")
            return None

        df = pd.read_excel(archivo_path, sheet_name=ultima_hoja,
                           engine='openpyxl', header=header_row)

        # Identificar columnas
        col_cliente = None
        col_cuota_mes = None

        for col in df.columns:
            col_lower = str(col).lower()
            if col_cliente is None and ('cliente' in col_lower or 'nombre' in col_lower):
                if 'total' not in col_lower and 'suma' not in col_lower:
                    col_cliente = col
            if col_cuota_mes is None and ('cuota de mes' in col_lower or 'cuota mes' in col_lower):
                col_cuota_mes = col

        if not col_cliente or not col_cuota_mes:
            print(f"   ⚠️ Columnas faltantes — cliente: {col_cliente}, cuota_mes: {col_cuota_mes}")
            return None

        print(f"   🎯 Cliente: '{col_cliente}' | Cuota mes: '{col_cuota_mes}'")

        df_clean = df[[col_cliente, col_cuota_mes]].dropna(how='all')

        registros = []
        palabras_invalidas = {'total', 'suma', 'gran total', 'subtotal', 'monto', 'nan', 'none'}

        for _, row in df_clean.iterrows():
            cliente_raw = row[col_cliente]
            cuota_raw   = row[col_cuota_mes]

            cliente   = str(cliente_raw).strip() if pd.notna(cliente_raw) else ""
            cuota_mes = str(cuota_raw).strip()   if pd.notna(cuota_raw)   else ""

            if not cliente or not cuota_mes:
                continue
            if any(p in cliente.lower().split() for p in palabras_invalidas):
                continue
            if len(cuota_mes) < 4 or not any(c.isdigit() for c in cuota_mes):
                continue

            cuota_normalizada = normalizar_cuota_mes(cuota_mes)

            registros.append({
                'nombre_usuario': cliente,
                'cuota_mes': cuota_normalizada,
            })
            print(f"      ✅ {cliente} — {cuota_mes} → {cuota_normalizada}")

        print(f"\n   ✅ {len(registros)} registros válidos")

        if MODO_PRUEBA and len(registros) > MAX_REGISTROS_PRUEBA:
            registros = registros[:MAX_REGISTROS_PRUEBA]
            print(f"   🧪 Limitado a {MAX_REGISTROS_PRUEBA} registros (modo prueba)")

        return {
            'nombre_inversionista': nombre_inversionista,
            'registros': registros,
        }

    except Exception as e:
        import traceback
        print(f"   ❌ Error: {e}")
        traceback.print_exc()
        return None


# ============================================
# 📡 LLAMAR AL ENDPOINT POR CADA REGISTRO
# ============================================
def llamar_endpoint(nombre_inversionista: str, nombre_usuario: str, cuota_mes: str):
    """Llama a POST /marcar-liquidado-inversionistas para un solo registro."""
    payload = {
        'nombre_inversionista': nombre_inversionista,
        'nombre_usuario': nombre_usuario,
        'cuota_mes': cuota_mes,
    }
    try:
        response = requests.post(API_URL, json=payload,
                                 headers={"Content-Type": "application/json"},
                                 timeout=60)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        try:
            return e.response.json()
        except Exception:
            return {"success": False, "message": str(e)}
    except requests.exceptions.RequestException as e:
        return {"success": False, "message": str(e)}


# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def marcar_liquidado_status():
    print("🔥 ========== MARCAR LIQUIDADO STATUS ==========")
    print(f"📂 Carpeta:  {CARPETA_EXCELS}")
    print(f"🔗 Endpoint: {API_URL}")
    if MODO_PRUEBA:
        print("🧪 MODO PRUEBA ACTIVO")
    print("=" * 70)

    if not os.path.exists(CARPETA_EXCELS):
        print(f"❌ Carpeta no existe: {CARPETA_EXCELS}")
        return

    archivos_excel = [
        f for f in os.listdir(CARPETA_EXCELS)
        if f.lower().endswith(('.xlsx', '.xls')) and not f.startswith('~$')
    ]

    if not archivos_excel:
        print("⚠️ No hay archivos Excel en la carpeta")
        return

    if MODO_PRUEBA and len(archivos_excel) > MAX_ARCHIVOS_PRUEBA:
        archivos_excel = archivos_excel[:MAX_ARCHIVOS_PRUEBA]

    print(f"📁 Archivos encontrados: {len(archivos_excel)}\n")

    total_exitosos = 0
    total_fallidos = 0
    resultados_log = []

    for idx, archivo in enumerate(archivos_excel, 1):
        print(f"\n{'='*70}")
        print(f"📋 [{idx}/{len(archivos_excel)}] {archivo}")
        print(f"{'='*70}")

        ruta_completa = os.path.join(CARPETA_EXCELS, archivo)
        datos = procesar_excel(ruta_completa)

        if not datos or not datos['registros']:
            print("   ⚠️ Sin registros válidos — omitiendo")
            total_fallidos += 1
            resultados_log.append({'archivo': archivo, 'estado': 'OMITIDO', 'detalle': []})
            continue

        nombre_inv = datos['nombre_inversionista']
        detalle_archivo = []

        for reg in datos['registros']:
            print(f"\n   📤 {nombre_inv} / {reg['nombre_usuario']} / {reg['cuota_mes']}")
            resultado = llamar_endpoint(nombre_inv, reg['nombre_usuario'], reg['cuota_mes'])

            if resultado.get('success'):
                d = resultado.get('data', {})
                print(f"      ✅ OK — liquidadas: {d.get('cuotas_liquidadas', '?')}, "
                      f"pendientes: {d.get('cuotas_pendientes', '?')}")
                total_exitosos += 1
                detalle_archivo.append({
                    'usuario': reg['nombre_usuario'],
                    'cuota_mes': reg['cuota_mes'],
                    'estado': 'OK',
                    'cuotas_liquidadas': d.get('cuotas_liquidadas'),
                    'cuotas_pendientes': d.get('cuotas_pendientes'),
                    'snapshot': d.get('snapshot', []),  # 🔒 valores anteriores
                })
            else:
                msg = resultado.get('message', 'Error desconocido')
                print(f"      ❌ ERROR: {msg}")
                total_fallidos += 1
                detalle_archivo.append({
                    'usuario': reg['nombre_usuario'],
                    'cuota_mes': reg['cuota_mes'],
                    'estado': 'ERROR',
                    'error': msg,
                })

        resultados_log.append({
            'archivo': archivo,
            'inversionista': nombre_inv,
            'estado': 'PROCESADO',
            'detalle': detalle_archivo,
        })

    # ─── RESUMEN FINAL ───────────────────────────────────────────────────
    print("\n" + "="*70)
    print("🎉 PROCESO COMPLETADO")
    print("="*70)
    print(f"✅ Exitosos: {total_exitosos}")
    print(f"❌ Fallidos/Omitidos: {total_fallidos}")

    # Guardar log de texto
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join(CARPETA_EXCELS, f"marcar_liquidado_{timestamp}.txt")

    with open(log_path, 'w', encoding='utf-8') as f:
        f.write(f"MARCAR LIQUIDADO STATUS — {datetime.now()}\n")
        f.write("="*100 + "\n")
        f.write(f"Exitosos: {total_exitosos}  |  Fallidos: {total_fallidos}\n\n")

        for res in resultados_log:
            f.write(f"\n{'='*100}\n")
            f.write(f"Archivo:      {res['archivo']}\n")
            f.write(f"Inversionista: {res.get('inversionista', '-')}\n")
            f.write(f"Estado:       {res['estado']}\n")
            for det in res.get('detalle', []):
                f.write(f"  · {det.get('usuario', '')} | {det.get('cuota_mes', '')} | "
                        f"{det.get('estado', '')} | "
                        f"liq={det.get('cuotas_liquidadas', '-')} pend={det.get('cuotas_pendientes', '-')}"
                        f"  {det.get('error', '')}\n")
                # Log detalle cuota por cuota
                for s in det.get('snapshot', []):
                    antes = f"liq={s.get('liquidado_antes')} fecha={s.get('fecha_liq_antes')}"
                    despues = f"liq={s.get('liquidado_despues')} fecha={s.get('fecha_liq_despues')}"
                    f.write(f"      cuota_id={s.get('cuota_id')} #cuota={s.get('numero_cuota')} "
                            f"vence={s.get('fecha_vencimiento')} caso={s.get('caso')} "
                            f"ANTES:[{antes}] → DESPUÉS:[{despues}]\n")

    print(f"\n📄 Log guardado: {log_path}")

    # 🔒 Guardar snapshot completo para revertir (JSON)
    revert_data = {
        'ejecutado_en': datetime.now().isoformat(),
        'total_exitosos': total_exitosos,
        'total_fallidos': total_fallidos,
        'registros': [
            {
                'archivo': res['archivo'],
                'inversionista': res.get('inversionista', ''),
                'usuario': det.get('usuario', ''),
                'cuota_mes': det.get('cuota_mes', ''),
                'snapshot': det.get('snapshot', []),
            }
            for res in resultados_log
            for det in res.get('detalle', [])
            if det.get('snapshot')
        ]
    }
    revert_path = os.path.join(CARPETA_EXCELS, f"REVERT_marcar_liquidado_{timestamp}.json")
    with open(revert_path, 'w', encoding='utf-8') as f:
        json.dump(revert_data, f, ensure_ascii=False, indent=2)
    print(f"🔒 Snapshot revert guardado: {revert_path}")


if __name__ == "__main__":
    marcar_liquidado_status()
