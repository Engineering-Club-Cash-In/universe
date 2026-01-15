import os
import pandas as pd
import requests
import json
from typing import List, Dict, Any, Optional
from difflib import SequenceMatcher
from datetime import datetime

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
CARPETA_EXCELS_LIQUIDACIONES = r"C:\Users\Kelvin Palacios\Documents\analis de datos\Liquidaciones\LiquidacionesEnero"

# EXCEL CON DPIs
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
EXCEL_DPIS = "mapeo_investor.xlsx"
HOJA_DPIS = "DPI"

# API
API_BASE_URL = "http://localhost:7000"
API_INVERSIONISTAS_URL = f"{API_BASE_URL}/investor"
API_BANCOS_URL = f"{API_BASE_URL}/bancos"

# MODO PRUEBA
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 3

# ============================================
# 🔧 FUNCIONES DE UTILIDAD
# ============================================
def similar(a: str, b: str) -> float:
    """Calcula similitud entre dos strings (0.0 a 1.0)"""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()

def normalizar_nombre_para_match(nombre: str) -> str:
    """Normaliza nombre para comparación"""
    replacements = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
        'ñ': 'n', 'Ñ': 'N', 'ü': 'u', 'Ü': 'U'
    }
    
    nombre_normalizado = nombre.lower().strip()
    for old, new in replacements.items():
        nombre_normalizado = nombre_normalizado.replace(old, new)
    
    nombre_normalizado = ' '.join(nombre_normalizado.split())
    return nombre_normalizado

def buscar_dpi_por_nombre(nombre: str, df_dpis: pd.DataFrame, umbral: float = 0.85) -> Optional[int]:
    """Busca el DPI en el dataframe usando matching fuzzy"""
    mejor_match = None
    mejor_similitud = 0.0
    mejor_dpi = None
    
    nombre_normalizado = normalizar_nombre_para_match(nombre)
    
    for _, row in df_dpis.iterrows():
        nombre_dpi_excel = str(row.get('Inversionista', '')).strip()
        
        if not nombre_dpi_excel or nombre_dpi_excel.lower() == 'nan':
            continue
        
        nombre_dpi_normalizado = normalizar_nombre_para_match(nombre_dpi_excel)
        similitud = similar(nombre_normalizado, nombre_dpi_normalizado)
        
        if similitud > mejor_similitud:
            mejor_similitud = similitud
            mejor_match = nombre_dpi_excel
            mejor_dpi = row.get('Dpi')
    
    if mejor_similitud >= umbral:
        dpi_limpio = limpiar_dpi(mejor_dpi)
        if dpi_limpio:
            print(f"      🎯 DPI: {dpi_limpio}")
        return dpi_limpio
    else:
        print(f"      ⚠️ Sin DPI (match: {mejor_similitud:.0%})")
        return None

def limpiar_dpi(valor: Any) -> int | None:
    """Limpia el DPI y lo valida"""
    if pd.isna(valor) or valor == "":
        return None
    
    dpi_str = str(valor).strip()
    
    if dpi_str.upper() in ['N/E', 'NE', 'N/A', 'NA', 'SIN DPI', '']:
        return None
    
    dpi_limpio = dpi_str.replace(' ', '').replace('-', '').replace('_', '').replace('.', '')
    
    try:
        if 'E+' in dpi_str.upper() or 'e+' in dpi_str:
            dpi_numero = float(dpi_str)
            dpi_limpio = str(int(dpi_numero))
    except:
        pass
    
    if not dpi_limpio.isdigit():
        return None
    
    if len(dpi_limpio) < 13:
        dpi_limpio = dpi_limpio.zfill(13)
    elif len(dpi_limpio) > 13:
        return None
    
    return int(dpi_limpio)

def normalizar_tipo_cuenta(valor: Any) -> str | None:
    """Normaliza el tipo de cuenta según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    tipo = str(valor).strip().upper()
    
    # Ignorar palabras que NO son tipo de cuenta
    palabras_ignorar = [
        'AMORTIZACIÓN', 'AMORTIZACION', 'RESTANTE', 'CAPITAL RESTANTE', 
        'NETO', 'TOTAL', 'GRAN TOTAL', 'INVERSOR', 'INVERSIONISTA',
        'CAPITAL', 'MONTO', 'SUMA', 'SUBTOTAL'
    ]
    
    if any(palabra in tipo for palabra in palabras_ignorar):
        return None
    
    # Solo estos son válidos
    mapeo = {
        "AHORRO": "AHORRO",
        "AHORROS": "AHORRO",
        "AHORRO Q": "AHORRO Q",
        "AHORRO $": "AHORRO $",
        "MONETARIA": "MONETARIA",
        "MONETARIÁ": "MONETARIA",
        "MONETARIA Q": "MONETARIA Q",
        "MONETARIO Q": "MONETARIA Q",
        "MONETARIA $": "MONETARIA $",
        "MONETARIO $": "MONETARIA $",
    }
    
    tipo_normalizado = mapeo.get(tipo)
    if tipo_normalizado:
        return tipo_normalizado
    
    # Intentar normalizar variantes
    if "MONETARI" in tipo and len(tipo) < 20:
        if "$" in tipo or "DOLAR" in tipo:
            return "MONETARIA $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "MONETARIA Q"
        else:
            return "MONETARIA"
    
    if "AHORR" in tipo and len(tipo) < 20:
        if "$" in tipo or "DOLAR" in tipo:
            return "AHORRO $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "AHORRO Q"
        else:
            return "AHORRO"
    
    return None

# ============================================
# 🔥 NUEVAS FUNCIONES PARA BANCO CON API
# ============================================
def obtener_bancos_desde_api() -> List[Dict]:
    """
    Obtiene todos los bancos desde el API.
    Retorna lista de bancos con su ID y nombre.
    """
    try:
        print("   📥 Obteniendo bancos desde API...")
        response = requests.get(API_BANCOS_URL, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if data.get("success"):
            bancos = data.get("data", [])
            print(f"   ✅ {len(bancos)} bancos obtenidos")
            return bancos
        else:
            print(f"   ⚠️ Error al obtener bancos: {data.get('message')}")
            return []
    except Exception as e:
        print(f"   ❌ Error conectando al API de bancos: {e}")
        return []

def normalizar_banco(valor: Any, bancos_cache: List[Dict]) -> int | None:
    """
    Normaliza el valor del banco y retorna el banco_id correspondiente.
    Acepta: ID (int), nombre (str) con coincidencias parciales e insensible a mayúsculas.
    
    Args:
        valor: El valor a normalizar (puede ser ID o nombre)
        bancos_cache: Lista de bancos obtenida del API
    
    Retorna: banco_id o None si no encuentra coincidencia.
    """
    if pd.isna(valor) or valor == "" or not bancos_cache:
        return None
    
    # Si ya es un número, verificar que el banco existe
    if isinstance(valor, (int, float)):
        banco_id = int(valor)
        banco_encontrado = next((b for b in bancos_cache if b['banco_id'] == banco_id), None)
        if banco_encontrado:
            return banco_id
        return None
    
    # Si es string, buscar por nombre (PERMISIVO)
    if isinstance(valor, str):
        nombre_banco = valor.strip().lower()
        
        if not nombre_banco:
            return None
        
        # 🔥 Búsqueda permisiva con diferentes niveles de coincidencia
        coincidencias = []
        
        for banco in bancos_cache:
            nombre_db = banco['nombre'].lower()
            
            # Match exacto (mayor prioridad)
            if nombre_db == nombre_banco:
                coincidencias.append((banco, 1))
            # Empieza con (prioridad media)
            elif nombre_db.startswith(nombre_banco) or nombre_banco.startswith(nombre_db):
                coincidencias.append((banco, 2))
            # Contiene (menor prioridad)
            elif nombre_banco in nombre_db or nombre_db in nombre_banco:
                coincidencias.append((banco, 3))
        
        if not coincidencias:
            return None
        
        # Ordenar por prioridad
        coincidencias.sort(key=lambda x: x[1])
        
        # Usar el mejor match
        banco_seleccionado = coincidencias[0][0]
        return banco_seleccionado['banco_id']
    
    return None

def limpiar_numero_cuenta(valor: Any) -> str | None:
    """
    Limpia y formatea el número de cuenta
    🔥 FIX: No rechazar números de cuenta válidos
    """
    if pd.isna(valor) or valor == "":
        return None
    
    cuenta_str = str(valor).strip()
    
    # Remover caracteres especiales pero MANTENER guiones
    cuenta_str = (cuenta_str
                  .replace('´', '')
                  .replace('`', '')
                  .replace('"', '')
                  .replace('*', '')
                  .replace(',', '')
                  .replace(' ', '')
                  .strip())
    
    if not cuenta_str or cuenta_str.lower() in ['nan', 'null', 'none', '']:
        return None
    
    # 🔥 Debe tener al menos 6 caracteres
    if len(cuenta_str) < 6:
        return None
    
    # Debe contener dígitos
    if not any(char.isdigit() for char in cuenta_str):
        return None
    
    # 🔥 Si tiene guiones, es cuenta bancaria (formato: 014-012783-7)
    if '-' in cuenta_str:
        digitos = ''.join(c for c in cuenta_str if c.isdigit())
        if len(digitos) >= 6:
            return cuenta_str
    
    # 🔥 Si es solo números, aplicar lógica diferente
    if cuenta_str.replace('-', '').replace('.', '').isdigit():
        try:
            num_float = float(cuenta_str.replace('-', ''))
            
            digitos = ''.join(c for c in cuenta_str if c.isdigit())
            
            if len(digitos) >= 15:
                return None
            
            if num_float < 10000000000:
                return cuenta_str
            else:
                return None
                
        except:
            pass
    
    # Validar que tenga al menos 6 dígitos
    digitos = ''.join(c for c in cuenta_str if c.isdigit())
    if len(digitos) < 6:
        return None
    
    return cuenta_str

def extraer_nombre_inversionista(nombre_archivo: str) -> str:
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

# ============================================
# 🔥 FUNCIÓN MEJORADA PARA EXTRAER DATOS
# ============================================
def extraer_datos_inversionista_del_excel(
    archivo_path: str, 
    df_dpis: pd.DataFrame,
    bancos_cache: List[Dict]
) -> Dict[str, Any]:
    """
    Extrae los datos del inversionista del encabezado del Excel
    🔥 CON LOGGING DETALLADO Y USANDO API DE BANCOS
    """
    nombre_archivo = os.path.basename(archivo_path)
    nombre_inversionista = extraer_nombre_inversionista(nombre_archivo)
    
    print(f"\n   📄 {nombre_archivo}")
    
    try:
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        primera_hoja = xls.sheet_names[0]
        df_header = pd.read_excel(archivo_path, sheet_name=primera_hoja, engine='openpyxl', header=None, nrows=10)
        
        datos_inversionista = {
            "nombre": nombre_inversionista,
            "dpi": None,
            "emite_factura": False,
            "tipo_reinversion": "sin_reinversion",
            "banco": None,  # 🔥 Ahora será banco_id (int)
            "tipo_cuenta": None,
            "numero_cuenta": None
        }
        
        # 🔥 BUSCAR EN CADA FILA DEL HEADER
        for row_idx in range(min(10, len(df_header))):
            row = df_header.iloc[row_idx]
            
            # FACTURACIÓN
            for col_idx in range(len(row)):
                cell = row.iloc[col_idx]
                if pd.notna(cell):
                    cell_str = str(cell).strip().upper()
                    if 'PROPIA' in cell_str:
                        datos_inversionista["emite_factura"] = True
                        print(f"      ✅ Facturación: PROPIA")
                        break
                    elif 'AJENA' in cell_str:
                        datos_inversionista["emite_factura"] = False
                        print(f"      ✅ Facturación: AJENA")
                        break
            
            # 🔥 BUSCAR BANCO, TIPO CUENTA y NÚMERO en la MISMA FILA
            for col_idx in range(len(row)):
                cell = row.iloc[col_idx]
                if pd.notna(cell):
                    cell_str = str(cell).strip()
                    
                    # 1. ¿Es un BANCO?
                    if not datos_inversionista["banco"]:
                        banco_id = normalizar_banco(cell_str, bancos_cache)
                        if banco_id:
                            # Obtener nombre del banco para mostrar
                            banco_info = next((b for b in bancos_cache if b['banco_id'] == banco_id), None)
                            banco_nombre = banco_info['nombre'] if banco_info else f"ID {banco_id}"
                            
                            datos_inversionista["banco"] = banco_id
                            print(f"      🏦 Banco: {banco_nombre} (ID: {banco_id})")
                            
                            # 🔥 BUSCAR TIPO CUENTA y NÚMERO en las SIGUIENTES columnas
                            print(f"         🔍 Buscando tipo cuenta y número en siguientes columnas...")
                            
                            for offset in range(1, 5):
                                if col_idx + offset >= len(row):
                                    break
                                
                                siguiente_cell = row.iloc[col_idx + offset]
                                if pd.notna(siguiente_cell):
                                    siguiente_str = str(siguiente_cell).strip()
                                    print(f"         📍 Col +{offset}: '{siguiente_str}'")
                                    
                                    # ¿Es TIPO CUENTA?
                                    if not datos_inversionista["tipo_cuenta"]:
                                        tipo_normalizado = normalizar_tipo_cuenta(siguiente_str)
                                        if tipo_normalizado:
                                            datos_inversionista["tipo_cuenta"] = tipo_normalizado
                                            print(f"         ✅ Tipo cuenta: {tipo_normalizado}")
                                            
                                            # 🔥 BUSCAR NÚMERO en la SIGUIENTE columna
                                            if col_idx + offset + 1 < len(row):
                                                cuenta_cell = row.iloc[col_idx + offset + 1]
                                                if pd.notna(cuenta_cell):
                                                    cuenta_str_raw = str(cuenta_cell).strip()
                                                    print(f"         🔍 Intentando número: '{cuenta_str_raw}'")
                                                    
                                                    numero_limpio = limpiar_numero_cuenta(cuenta_str_raw)
                                                    if numero_limpio:
                                                        datos_inversionista["numero_cuenta"] = numero_limpio
                                                        print(f"         ✅ Cuenta: {numero_limpio}")
                                                    else:
                                                        print(f"         ❌ Rechazado: '{cuenta_str_raw}'")
                                            
                                            break
                            
                            break
        
        # 🔥 BUSCAR DPI
        if not df_dpis.empty:
            dpi = buscar_dpi_por_nombre(nombre_inversionista, df_dpis, umbral=0.85)
            datos_inversionista["dpi"] = dpi
        
        # Log final
        if not datos_inversionista["banco"]:
            print(f"      ⚠️ Sin banco")
        if not datos_inversionista["tipo_cuenta"]:
            print(f"      ⚠️ Sin tipo cuenta")
        if not datos_inversionista["numero_cuenta"]:
            print(f"      ⚠️ Sin número cuenta")
        
        return datos_inversionista
        
    except Exception as e:
        print(f"   ⚠️ Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "nombre": nombre_inversionista,
            "dpi": None,
            "emite_factura": False,
            "tipo_reinversion": "sin_reinversion",
            "banco": None,
            "tipo_cuenta": None,
            "numero_cuenta": None
        }

# ============================================
# 📖 LEER EXCEL CON DPIs
# ============================================
def leer_dpis_desde_excel() -> pd.DataFrame:
    """Lee el Excel con los DPIs"""
    print(f"\n📖 PASO 1: Leyendo DPIs")
    print(f"   📁 {EXCEL_DPIS} → {HOJA_DPIS}")
    
    try:
        df_dpis = pd.read_excel(
            f"{CARPETA_EXCELS}\\{EXCEL_DPIS}",
            sheet_name=HOJA_DPIS,
            header=0
        )
        
        print(f"   ✅ {len(df_dpis)} registros")
        
        if 'Inversionista' not in df_dpis.columns or 'Dpi' not in df_dpis.columns:
            print(f"   ❌ ERROR: Faltan columnas")
            return pd.DataFrame()
        
        dpis_validos = sum(1 for _, row in df_dpis.iterrows() if limpiar_dpi(row.get('Dpi')))
        print(f"   ✅ {dpis_validos} DPIs válidos\n")
        
        return df_dpis
    
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return pd.DataFrame()

# ============================================
# 💾 GUARDAR REPORTE DE FALLIDOS
# ============================================
def guardar_reporte_fallidos(inversionistas: List[Dict], carpeta: str, bancos_cache: List[Dict]) -> str:
    """Guarda un reporte de inversionistas sin DPI o datos incompletos"""
    
    sin_dpi = [inv for inv in inversionistas if not inv['dpi']]
    sin_cuenta = [inv for inv in inversionistas if not inv['numero_cuenta']]
    sin_banco = [inv for inv in inversionistas if not inv['banco']]
    sin_tipo_cuenta = [inv for inv in inversionistas if not inv['tipo_cuenta']]
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"inversionistas_fallidos_{timestamp}.txt"
    filepath = os.path.join(carpeta, filename)
    
    def obtener_nombre_banco(banco_id):
        """Helper para obtener nombre del banco por ID"""
        if not banco_id:
            return 'N/A'
        banco = next((b for b in bancos_cache if b['banco_id'] == banco_id), None)
        return banco['nombre'] if banco else f'ID {banco_id}'
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("📋 REPORTE DE INVERSIONISTAS CON DATOS FALTANTES\n")
        f.write("=" * 100 + "\n")
        f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total procesados: {len(inversionistas)}\n")
        f.write(f"Sin DPI: {len(sin_dpi)}\n")
        f.write(f"Sin cuenta: {len(sin_cuenta)}\n")
        f.write(f"Sin banco: {len(sin_banco)}\n")
        f.write(f"Sin tipo cuenta: {len(sin_tipo_cuenta)}\n")
        f.write("=" * 100 + "\n\n")
        
        # SIN DPI
        if sin_dpi:
            f.write("❌ INVERSIONISTAS SIN DPI\n")
            f.write("=" * 100 + "\n")
            for idx, inv in enumerate(sin_dpi, 1):
                f.write(f"\n{idx}. {inv['nombre']}\n")
                f.write(f"   Banco: {obtener_nombre_banco(inv['banco'])}\n")
                f.write(f"   Tipo cuenta: {inv['tipo_cuenta'] or 'N/A'}\n")
                f.write(f"   Número cuenta: {inv['numero_cuenta'] or 'N/A'}\n")
                f.write(f"   Factura: {'SÍ' if inv['emite_factura'] else 'NO'}\n")
                f.write("-" * 100 + "\n")
        
        # SIN CUENTA
        if sin_cuenta:
            f.write("\n\n❌ INVERSIONISTAS SIN CUENTA BANCARIA\n")
            f.write("=" * 100 + "\n")
            for idx, inv in enumerate(sin_cuenta, 1):
                f.write(f"\n{idx}. {inv['nombre']}\n")
                f.write(f"   DPI: {inv['dpi'] or 'N/A'}\n")
                f.write(f"   Banco: {obtener_nombre_banco(inv['banco'])}\n")
                f.write(f"   Tipo cuenta: {inv['tipo_cuenta'] or 'N/A'}\n")
                f.write("-" * 100 + "\n")
        
        # SIN BANCO
        if sin_banco:
            f.write("\n\n❌ INVERSIONISTAS SIN BANCO\n")
            f.write("=" * 100 + "\n")
            for idx, inv in enumerate(sin_banco, 1):
                f.write(f"\n{idx}. {inv['nombre']}\n")
                f.write(f"   DPI: {inv['dpi'] or 'N/A'}\n")
                f.write(f"   Tipo cuenta: {inv['tipo_cuenta'] or 'N/A'}\n")
                f.write(f"   Cuenta: {inv['numero_cuenta'] or 'N/A'}\n")
                f.write("-" * 100 + "\n")
        
        # SIN TIPO CUENTA
        if sin_tipo_cuenta:
            f.write("\n\n❌ INVERSIONISTAS SIN TIPO DE CUENTA\n")
            f.write("=" * 100 + "\n")
            for idx, inv in enumerate(sin_tipo_cuenta, 1):
                f.write(f"\n{idx}. {inv['nombre']}\n")
                f.write(f"   DPI: {inv['dpi'] or 'N/A'}\n")
                f.write(f"   Banco: {obtener_nombre_banco(inv['banco'])}\n")
                f.write(f"   Cuenta: {inv['numero_cuenta'] or 'N/A'}\n")
                f.write("-" * 100 + "\n")
    
    print(f"\n📄 Reporte guardado: {filename}")
    return filepath

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_inversionistas():
    print("=" * 80)
    print("🏦 IMPORTADOR DE INVERSIONISTAS DESDE EXCELS DE LIQUIDACIÓN")
    print("=" * 80)
    
    if MODO_PRUEBA:
        print(f"🧪 MODO PRUEBA: Max {MAX_ARCHIVOS_PRUEBA} archivos")
    
    try:
        # PASO 0: Obtener bancos desde API
        print(f"\n📡 PASO 0: Obteniendo bancos desde API")
        bancos_cache = obtener_bancos_desde_api()
        
        if not bancos_cache:
            print("❌ No se pudieron obtener bancos del API")
            continuar = input("⚠️ ¿Continuar sin validación de bancos? (si/no): ").strip().lower()
            if continuar not in ['si', 's']:
                return
        else:
            print(f"\n📋 Bancos disponibles:")
            for banco in bancos_cache:
                print(f"   - ID {banco['banco_id']}: {banco['nombre']}")
        
        # PASO 1: Leer DPIs
        df_dpis = leer_dpis_desde_excel()
        
        if df_dpis.empty:
            continuar = input("⚠️ Sin DPIs. ¿Continuar? (si/no): ").strip().lower()
            if continuar not in ['si', 's']:
                return
        
        # PASO 2: Leer archivos
        print(f"\n📂 PASO 2: Leyendo archivos")
        print(f"   📁 {CARPETA_EXCELS_LIQUIDACIONES}")
        
        if not os.path.exists(CARPETA_EXCELS_LIQUIDACIONES):
            print(f"❌ Carpeta no existe")
            return
        
        archivos_excel = [
            f for f in os.listdir(CARPETA_EXCELS_LIQUIDACIONES) 
            if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$')
        ]
        
        if not archivos_excel:
            print("⚠️ Sin archivos Excel")
            return
        
        if MODO_PRUEBA:
            archivos_excel = archivos_excel[:MAX_ARCHIVOS_PRUEBA]
        
        print(f"📁 {len(archivos_excel)} archivos\n")
        
        # PASO 3: Procesar
        inversionistas = []
        
        print(f"{'='*80}")
        print(f"🔄 PASO 3: PROCESANDO ARCHIVOS...")
        print(f"{'='*80}")
        
        for idx, archivo in enumerate(archivos_excel, 1):
            print(f"\n[{idx}/{len(archivos_excel)}]", end=" ")
            
            ruta_completa = os.path.join(CARPETA_EXCELS_LIQUIDACIONES, archivo)
            datos = extraer_datos_inversionista_del_excel(ruta_completa, df_dpis, bancos_cache)
            inversionistas.append(datos)
        
        # PASO 4: Resumen
        print("\n" + "=" * 80)
        print("📊 PASO 4: RESUMEN")
        print("=" * 80)
        
        con_dpi = [inv for inv in inversionistas if inv['dpi']]
        con_cuenta = [inv for inv in inversionistas if inv['numero_cuenta']]
        con_factura = [inv for inv in inversionistas if inv['emite_factura']]
        con_banco = [inv for inv in inversionistas if inv['banco']]
        con_tipo_cuenta = [inv for inv in inversionistas if inv['tipo_cuenta']]
        
        print(f"\n   Total: {len(inversionistas)}")
        print(f"   ✅ Con DPI: {len(con_dpi)} ({len(con_dpi)/len(inversionistas)*100:.1f}%)")
        print(f"   ✅ Con banco: {len(con_banco)} ({len(con_banco)/len(inversionistas)*100:.1f}%)")
        print(f"   ✅ Con tipo cuenta: {len(con_tipo_cuenta)} ({len(con_tipo_cuenta)/len(inversionistas)*100:.1f}%)")
        print(f"   ✅ Con número cuenta: {len(con_cuenta)} ({len(con_cuenta)/len(inversionistas)*100:.1f}%)")
        print(f"   ✅ Facturan: {len(con_factura)} ({len(con_factura)/len(inversionistas)*100:.1f}%)")
        
        # PASO 5: Guardar reporte de fallidos
        reporte_path = guardar_reporte_fallidos(inversionistas, CARPETA_EXCELS_LIQUIDACIONES, bancos_cache)
        
        # PASO 6: Opciones
        print("\n" + "=" * 80)
        print("PASO 5: ¿Qué hacer?")
        print("=" * 80)
        print("1. 🚀 Enviar a API")
        print("2. 🧪 Dry-run (ver JSON)")
        print("3. 💾 Guardar JSON completo")
        print("4. 📄 Ver reporte de fallidos")
        print("5. ❌ Cancelar")
        
        opcion = input("\nOpción (1/2/3/4/5): ").strip()
        
        if opcion == "1":
            confirmacion = input("\n⚠️ ¿Enviar a API? (si/no): ").strip().lower()
            if confirmacion in ['si', 's']:
                enviar_a_api_batch(inversionistas)
        elif opcion == "2":
            print("\n🧪 Muestra (primeros 5):\n")
            for inv in inversionistas[:5]:
                # Mostrar nombre del banco en lugar de ID
                inv_display = inv.copy()
                if inv_display['banco']:
                    banco = next((b for b in bancos_cache if b['banco_id'] == inv_display['banco']), None)
                    if banco:
                        inv_display['banco_nombre'] = banco['nombre']
                print(json.dumps(inv_display, indent=2, ensure_ascii=False))
                print()
        elif opcion == "3":
            filename = f"inversionistas_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(CARPETA_EXCELS_LIQUIDACIONES, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(inversionistas, f, indent=2, ensure_ascii=False)
            print(f"💾 Guardado: {filename}")
        elif opcion == "4":
            if os.path.exists(reporte_path):
                os.startfile(reporte_path)
            print(f"📄 Abriendo: {os.path.basename(reporte_path)}")
        else:
            print("❌ Cancelado")
    
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()

def enviar_a_api_batch(inversionistas: List[Dict]) -> None:
    """Envía a la API en batch"""
    print(f"\n🚀 Enviando {len(inversionistas)} inversionistas...")
    print(f"📡 {API_INVERSIONISTAS_URL}\n")
    
    try:
        response = requests.post(
            API_INVERSIONISTAS_URL,
            json=inversionistas,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        if response.status_code in [200, 201]:
            print(f"✅ Procesados exitosamente")
            resultado = response.json()
            print(f"📄 Mensaje: {resultado.get('message', 'OK')}")
            if 'data' in resultado:
                print(f"📊 Registros procesados: {len(resultado['data'])}")
        else:
            print(f"❌ Error ({response.status_code})")
            print(f"📄 {response.text}")
    
    except Exception as e:
        print(f"❌ Error: {str(e)}")

if __name__ == "__main__":
    procesar_inversionistas()