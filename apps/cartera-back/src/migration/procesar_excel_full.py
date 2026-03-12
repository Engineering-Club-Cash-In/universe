import os
import json
import unicodedata
import requests
import pandas as pd
from typing import Any, Dict, List, Optional
from collections import defaultdict
from datetime import datetime


def _norm(s: str) -> str:
    """Normaliza Unicode a NFC para comparar nombres de archivo."""
    return unicodedata.normalize('NFC', s)

# ============================================================
# 🔧 CONFIGURACIÓN
# ============================================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL  = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

HOJAS_A_PROCESAR = [
    "Enero 2026"
]

# Créditos específicos a procesar (déjalos vacíos [] para procesar TODOS los de la hoja)
CREDITOS_A_PROCESAR = [
    "01010214121670",
    "01010214121670_2",
    "01010214121680",
    "01010214121680_2",
]

API_BASE = "http://localhost:7000"
ENDPOINT = f"{API_BASE}/processFromExcelFull"

MODO_PRUEBA          = False   # True = solo los primeros 2 créditos
LIMITE_PRUEBA        = 2

LOG_FILE = f"excel_full_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

# ============================================================
# 📝 Logger simple
# ============================================================

def log(msg: str, level: str = "INFO"):
    ts   = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] [{level:5}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

# ============================================================
# 🗺️  Mapeo de columnas Excel → API
# ============================================================
MAPEO = {
    'Fecha': 'Fecha',
    '# crédito SIFCO': 'CreditoSIFCO',
    '#': 'Numero',
    'Nombre': 'Nombre',
    'Capital': 'Capital',
    '%': 'porcentaje',
    'Cuotas': 'Cuotas',
    'Deuda Q': 'DeudaQ',
    'IVA 12%': 'IVA12',
    '% Cash-In': 'PorcentajeCashIn',
    '% Inversionista': 'PorcentajeInversionista',
    'Cuota Cash-IN': 'CuotaCashIn',
    'IVA Cash-In': 'IVACashIn',
    'Cuota Inverionista': 'CuotaInversionista',
    'IVA Inversionista': 'IVAInversionista',
    'Seguro (10 cuotas)': 'Seguro10Cuotas',
    'GPS': 'GPS',
    'Abono capital': 'AbonoCapital',
    'Abono Interés': 'AbonoInteres',
    'Abono IVA 12%': 'AbonoIVA12',
    'Abono interés CI': 'AbonoInteresCI',
    'Abono IVA CI': 'AbonoIVACI',
    'Abono Seguro': 'AbonoSeguro',
    'Abono GPS': 'AbonoGPS',
    'Pago del mes': 'PagoDelMes',
    'Capital restante': 'CapitalRestante',
    'Interés restante': 'InteresRestante',
    'IVA 12% restante': 'IVA12Restante',
    'Seguro Restante': 'SeguroRestante',
    'GPS Restante': 'GPSRestante',
    'Total restante': 'TotalRestante',
    'Llamada': 'Llamada',
    'Pago': 'Pago',
    'NIT': 'NIT',
    'Categoría': 'Categoria',
    'Inversionista': 'Inversionista',
    'Observaciones': 'Observaciones',
    'Cuota': 'Cuota',
    'Monto boleta': 'MontoBoleta',
    'Fecha filtro': 'FechaFiltro',
    'No. Póliza': 'NumeroPoliza',
    'Comisión de venta': 'ComisionVenta',
    'Acumulado Comisión de Venta': 'AcumuladoComisionVenta',
    '% Royalty': 'PorcentajeRoyalty',
    'Royalty': 'Royalty',
    'Membresías': 'Membresias',
    'Membresías pago': 'MembresiasPago',
    'Plazo': 'Plazo',
    'Seguro': 'Seguro',
    'Formato crédito': 'FormatoCredito',
    'Asesor': 'Asesor',
    'Como se enteró de nosotros': 'ComoSeEntero',
    'Otros': 'Otros',
    'Mora': 'Mora',
}

CAMPOS_NUMERICOS = {'Numero'}


def convertir_valor(campo: str, valor: Any) -> Any:
    if pd.isna(valor) or valor == '':
        return 0 if campo in CAMPOS_NUMERICOS else ''
    if campo in CAMPOS_NUMERICOS:
        try:
            n = float(valor)
            return int(n) if n == int(n) else n
        except (ValueError, TypeError):
            return 0
    return str(valor).strip() if isinstance(valor, (int, float)) else str(valor).strip()


# ============================================================
# 📖 Leer hoja y agrupar por crédito
# ============================================================

def leer_hoja_excel(archivo: str, hoja: str) -> Dict[str, Dict]:
    log(f"📖 Leyendo hoja: {hoja}")
    try:
        df_raw = pd.read_excel(archivo, sheet_name=hoja, header=None, engine='openpyxl')
    except Exception as e:
        log(f"Error leyendo archivo: {e}", "ERROR")
        return {}

    # Buscar fila de headers (máximo primeras 20 filas)
    header_row = None
    for idx, row in df_raw.iterrows():
        if idx > 20:
            break
        row_str = ' '.join(str(c).lower() for c in row if pd.notna(c))
        if 'credito' in row_str or 'sifco' in row_str:
            header_row = idx
            break

    if header_row is None:
        log(f"No se encontraron headers en hoja '{hoja}'", "ERROR")
        return {}

    df = pd.read_excel(archivo, sheet_name=hoja, header=header_row)
    df.columns = df.columns.str.strip()

    # Detectar columnas clave
    col_credito = col_nombre = col_numero = None
    for col in df.columns:
        c = str(col).lower().replace('#', '').replace('crédito', 'credito').strip()
        if not col_credito and 'credito' in c and 'sifco' in c:
            col_credito = col
        if not col_nombre and 'nombre' in c and 'formato' not in c and 'inversionista' not in c:
            col_nombre = col
        if not col_numero and col == '#':
            col_numero = col

    if not col_credito:
        log("No se encontró columna CréditoSIFCO", "ERROR")
        return {}

    df = df.dropna(subset=[col_credito])
    df = df[~df[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)]
    df = df.fillna('')

    creditos_data: Dict[str, Dict] = {}

    for _, row in df.iterrows():
        num_raw = str(row[col_credito]).strip()
        if not num_raw or num_raw == 'nan':
            continue

        # Normalizar pools: "01010214121670_2" → base "01010214121670"
        if '_' in num_raw:
            credito_base = num_raw.split('_')[0]
        else:
            credito_base = num_raw

        cliente = str(row[col_nombre]).strip() if col_nombre and row[col_nombre] else "Desconocido"

        fila: Dict[str, Any] = {}
        for col in df.columns:
            campo = MAPEO.get(col, col)
            fila[campo] = convertir_valor(campo, row[col])
        fila['CreditoSIFCO'] = num_raw  # mantener el SIFCO original por fila

        if credito_base not in creditos_data:
            creditos_data[credito_base] = {
                'creditoBase': credito_base,
                'cliente': cliente,
                'filas': [],
            }
        creditos_data[credito_base]['filas'].append(fila)

    log(f"✅ {len(creditos_data)} créditos agrupados en '{hoja}'")
    return creditos_data


# ============================================================
# 📡 Enviar crédito al endpoint
# ============================================================

def enviar_credito(credito_data: Dict) -> Dict:
    credito_base = credito_data['creditoBase']
    filas        = credito_data['filas']

    # hasta_cuota = columna # de la primera fila (número de cuota actual)
    hasta_cuota: Optional[int] = None
    if filas:
        num = filas[0].get('Numero', 0)
        try:
            hasta_cuota = int(num) if num and int(float(str(num))) > 0 else None
        except (ValueError, TypeError):
            hasta_cuota = None

    log(f"🚀 Enviando: {credito_base} | filas={len(filas)} | hasta_cuota={hasta_cuota}")

    payload: Dict[str, Any] = {'credito': credito_data}
    if hasta_cuota is not None:
        payload['hasta_cuota'] = hasta_cuota

    try:
        resp = requests.post(
            ENDPOINT,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=120,
        )
        log(f"Status: {resp.status_code}")
        if resp.status_code not in (200, 201):
            log(f"Response: {resp.text[:300]}", "ERROR")
        resp.raise_for_status()
        resultado = resp.json()

        if resultado.get('success'):
            log(f"✅ OK | credito_id={resultado.get('credito_id')} "
                f"| inversionistas={resultado.get('inversionistas_insertados')} "
                f"| cuotas_marcadas={resultado.get('cuotas_marcadas_pagadas')}")
            if resultado.get('inversionistas_no_encontrados'):
                for inv in resultado['inversionistas_no_encontrados']:
                    log(f"⚠️  Inversionista no encontrado: {inv}", "WARN")
        else:
            log(f"❌ Error: {resultado.get('error', 'sin detalle')}", "ERROR")

        return resultado

    except requests.exceptions.ConnectionError:
        log("❌ Backend no disponible en puerto 7000", "ERROR")
        return {'success': False, 'error': 'conexion'}
    except requests.exceptions.Timeout:
        log("❌ Timeout", "ERROR")
        return {'success': False, 'error': 'timeout'}
    except requests.exceptions.HTTPError as e:
        log(f"❌ HTTP Error: {e}", "ERROR")
        return {'success': False, 'error': str(e)}
    except Exception as e:
        log(f"❌ Error inesperado: {e}", "ERROR")
        return {'success': False, 'error': str(e)}


# ============================================================
# 🚀 MAIN
# ============================================================

def main():
    log("=" * 60)
    log("🔥 PROCESAR EXCEL FULL (crédito + inversionistas + pagos)")
    log("=" * 60)
    log(f"📂 Archivo : {ARCHIVO_EXCEL}")
    log(f"🔗 Endpoint: {ENDPOINT}")
    log(f"📅 Hojas   : {HOJAS_A_PROCESAR}")
    if CREDITOS_A_PROCESAR:
        log(f"🎯 Filtro  : {CREDITOS_A_PROCESAR}")
    log("")

    # Buscar el archivo dinámicamente (evita problemas con acentos en os.path.exists)
    try:
        archivos_dir = os.listdir(CARPETA_EXCELS)
    except Exception as e:
        log(f"No se puede leer la carpeta: {e}", "ERROR")
        return

    archivo_encontrado = next(
        (f for f in archivos_dir
         if _norm(f) == _norm(ARCHIVO_EXCEL) and not f.startswith('~')),
        None
    )
    if not archivo_encontrado:
        log(f"Archivo no encontrado: {ARCHIVO_EXCEL}", "ERROR")
        log(f"Archivos disponibles: {[f for f in archivos_dir if 'Cartera' in f and f.endswith('.xlsx')]}")
        return

    archivo_path = os.path.join(CARPETA_EXCELS, archivo_encontrado)

    stats = defaultdict(int)
    inversionistas_faltantes: List[Dict] = []

    for hoja in HOJAS_A_PROCESAR:
        log(f"\n{'─'*50}")
        log(f"📋 Hoja: {hoja}")
        log(f"{'─'*50}")

        creditos_data = leer_hoja_excel(archivo_path, hoja)
        if not creditos_data:
            log(f"Sin datos en hoja '{hoja}'", "WARN")
            continue

        # Filtrar créditos si se especificaron
        if CREDITOS_A_PROCESAR:
            filtro = {c.strip().upper() for c in CREDITOS_A_PROCESAR}
            creditos_data = {
                k: v for k, v in creditos_data.items()
                if k.upper() in filtro
            }
            log(f"🎯 Créditos filtrados: {len(creditos_data)}")

        lista = list(creditos_data.values())
        if MODO_PRUEBA:
            lista = lista[:LIMITE_PRUEBA]
            log(f"🧪 Modo prueba: procesando {len(lista)} crédito(s)")

        for credito in lista:
            log(f"\n{'·'*40}")
            resultado = enviar_credito(credito)
            stats['procesados'] += 1

            if resultado.get('success'):
                stats['exitosos'] += 1
                no_enc = resultado.get('inversionistas_no_encontrados', [])
                for inv in no_enc:
                    inversionistas_faltantes.append({
                        'credito': credito['creditoBase'],
                        'cliente': credito['cliente'],
                        'inversionista': inv,
                    })
            else:
                stats['fallidos'] += 1

    # ── Resumen final ──────────────────────────────────────
    log("\n" + "=" * 60)
    log("🎉 RESUMEN FINAL")
    log("=" * 60)
    log(f"📤 Procesados : {stats['procesados']}")
    log(f"✅ Exitosos   : {stats['exitosos']}")
    log(f"❌ Fallidos   : {stats['fallidos']}")

    if inversionistas_faltantes:
        log(f"\n⚠️  INVERSIONISTAS NO ENCONTRADOS: {len(inversionistas_faltantes)}")
        por_inv = defaultdict(list)
        for item in inversionistas_faltantes:
            por_inv[item['inversionista']].append(item['credito'])
        for inv, creds in sorted(por_inv.items()):
            log(f"   • {inv} → {', '.join(creds)}", "WARN")

    log(f"\n📄 Log guardado en: {LOG_FILE}")


if __name__ == "__main__":
    main()
