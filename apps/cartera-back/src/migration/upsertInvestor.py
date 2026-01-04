import pandas as pd
import requests
import json
from typing import List, Dict, Any, Optional
from difflib import SequenceMatcher

# Configuración
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"

# EXCEL 1: Datos bancarios y facturación
EXCEL_DATOS_BANCARIOS = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"
HOJA_DATOS_BANCARIOS = "Facturacion inversionistas"

# EXCEL 2: DPIs
EXCEL_DPIS = "mapeo_investor.xlsx"
HOJA_DPIS = "DPI"

# URL de tu API
API_URL = "http://localhost:7000/investor"

def similar(a: str, b: str) -> float:
    """Calcula similitud entre dos strings (0.0 a 1.0)"""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()

def normalizar_nombre_para_match(nombre: str) -> str:
    """Normaliza nombre para comparación (quita acentos, mayúsculas, etc.)"""
    replacements = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
        'ñ': 'n', 'Ñ': 'N', 'ü': 'u', 'Ü': 'U'
    }
    
    nombre_normalizado = nombre.lower().strip()
    for old, new in replacements.items():
        nombre_normalizado = nombre_normalizado.replace(old, new)
    
    # Remover múltiples espacios
    nombre_normalizado = ' '.join(nombre_normalizado.split())
    
    return nombre_normalizado

def buscar_dpi_por_nombre(nombre: str, df_dpis: pd.DataFrame, umbral: float = 0.85) -> Optional[str]:
    """
    Busca el DPI en el dataframe usando matching fuzzy de nombres
    
    Args:
        nombre: Nombre del inversionista a buscar
        df_dpis: DataFrame con DPIs (columnas: 'Inversionista', 'Dpi')
        umbral: Similitud mínima requerida (0.0 a 1.0)
    
    Returns:
        DPI encontrado o None
    """
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
        return limpiar_dpi(mejor_dpi)
    else:
        return None

def convertir_si_no_a_boolean(valor: Any) -> bool:
    """Convierte 'Si'/'No' a True/False"""
    if pd.isna(valor) or valor == "":
        return False
    valor_str = str(valor).strip().upper()
    return valor_str == "SI"

def normalizar_tipo_reinversion(valor: Any) -> str:
    """Normaliza el tipo de reinversión según el enum"""
    if pd.isna(valor) or valor == "":
        return "sin_reinversion"
    
    valor_str = str(valor).strip().upper()
    
    mapeo = {
        "SI": "capital",
        "NO": "sin_reinversion",
        "CAPITAL": "capital",
        "COMPLETA": "completa",
        "TRADICIONAL": "sin_reinversion",
        "ESPECIAL": "especial",
    }
    
    return mapeo.get(valor_str, "sin_reinversion")

def normalizar_tipo_cuenta(valor: Any) -> str | None:
    """Normaliza el tipo de cuenta según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    tipo = str(valor).strip().upper()
    
    mapeo = {
        "AHORRO": "AHORRO",
        "AHORROS": "AHORRO",
        "AHORRO Q": "AHORRO Q",
        "AHORRO $": "AHORRO $",
        "MONETARIA": "MONETARIA",
        "MONETARIA Q": "MONETARIA Q",
        "MONETARIO Q": "MONETARIA Q",
        "MONETARIA $": "MONETARIA $",
        "MONETARIO $": "MONETARIA $",
        "CAPITAL": "CAPITAL",
    }
    
    tipo_normalizado = mapeo.get(tipo)
    
    if tipo_normalizado:
        return tipo_normalizado
    
    if "MONETARI" in tipo:
        if "$" in tipo:
            return "MONETARIA $"
        elif "Q" in tipo:
            return "MONETARIA Q"
        else:
            return "MONETARIA"
    
    if "AHORR" in tipo:
        if "$" in tipo:
            return "AHORRO $"
        elif "Q" in tipo:
            return "AHORRO Q"
        else:
            return "AHORRO"
    
    print(f"⚠️  Tipo de cuenta desconocido: '{valor}'")
    return None

def normalizar_banco(valor: Any) -> str | None:
    """Normaliza el nombre del banco"""
    if pd.isna(valor) or valor == "":
        return None
    
    banco = str(valor).strip().upper()
    
    mapeo = {
        "BI": "BI",
        "BAM": "BAM",
        "GYT": "GyT",
        "G&T": "GyT",
        "BANTRAB": "BANTRAB",
        "BANRURAL": "BANRURAL",
        "BAC": "BAC",
        "PROMERICA": "PROMERICA",
        "INDUSTRIAL": "INDUSTRIAL",
        "INTERBANCO": "INTERBANCO",
        "NEXA": "NEXA",
    }
    
    banco_normalizado = mapeo.get(banco)
    
    if banco_normalizado:
        return banco_normalizado
    
    if "GYT" in banco or "G&T" in banco:
        return "GyT"
    
    print(f"⚠️  Banco desconocido: '{valor}'")
    return None

def limpiar_numero_cuenta(valor: Any) -> str | None:
    """Limpia y formatea el número de cuenta"""
    if pd.isna(valor) or valor == "":
        return None
    
    cuenta_str = str(valor).strip()
    
    # Remover caracteres especiales pero MANTENER números y guiones
    cuenta_str = (cuenta_str
                  .replace('´', '')
                  .replace('`', '')
                  .replace('"', '')
                  .replace('*', '')
                  .strip())
    
    if not cuenta_str or cuenta_str.lower() in ['nan', 'null', 'none']:
        return None
    
    return cuenta_str

def limpiar_dpi(valor: Any) -> str | None:
    """Limpia el DPI y lo valida"""
    if pd.isna(valor) or valor == "":
        return None
    
    dpi_str = str(valor).strip()
    
    # Si es "N/E" o similar, retornar None
    if dpi_str.upper() in ['N/E', 'NE', 'N/A', 'NA', 'SIN DPI', '']:
        return None
    
    # Remover espacios, guiones y otros caracteres
    dpi_limpio = dpi_str.replace(' ', '').replace('-', '').replace('_', '').replace('.', '')
    
    # Si es notación científica (ej: 2.99805E+12), convertir
    try:
        if 'E+' in dpi_str.upper() or 'e+' in dpi_str:
            dpi_numero = float(dpi_str)
            dpi_limpio = str(int(dpi_numero))
    except:
        pass
    
    # Verificar que solo contenga dígitos
    if not dpi_limpio.isdigit():
        return None
    
    # Validar longitud (13 dígitos en Guatemala)
    # Si tiene menos de 13, rellenar con ceros a la izquierda
    if len(dpi_limpio) < 13:
        dpi_limpio = dpi_limpio.zfill(13)
        print(f"⚠️  DPI rellenado con ceros: '{valor}' → '{dpi_limpio}'")
    elif len(dpi_limpio) > 13:
        print(f"⚠️  DPI con longitud incorrecta ({len(dpi_limpio)} dígitos): '{dpi_limpio}' - Se ignora")
        return None
    
    return dpi_limpio

def leer_dpis_desde_excel() -> pd.DataFrame:
    """Lee el Excel con los DPIs"""
    print(f"\n📖 PASO 1: Leyendo DPIs desde segundo Excel")
    print(f"   Archivo: {EXCEL_DPIS}")
    print(f"   Hoja: {HOJA_DPIS}")
    
    try:
        df_dpis = pd.read_excel(
            f"{CARPETA_EXCELS}\\{EXCEL_DPIS}",
            sheet_name=HOJA_DPIS,
            header=0
        )
        
        print(f"   ✅ Archivo leído. Total de filas: {len(df_dpis)}")
        print(f"   📊 Columnas: {list(df_dpis.columns)}")
        
        # Verificar que tenga las columnas necesarias
        if 'Inversionista' not in df_dpis.columns or 'Dpi' not in df_dpis.columns:
            print(f"   ❌ ERROR: Faltan columnas 'Inversionista' o 'Dpi'")
            return pd.DataFrame()
        
        # Contar cuántos tienen DPI válido
        dpis_validos = sum(1 for _, row in df_dpis.iterrows() if limpiar_dpi(row.get('Dpi')))
        print(f"   ✅ DPIs válidos encontrados: {dpis_validos}/{len(df_dpis)}\n")
        
        return df_dpis
    
    except FileNotFoundError:
        print(f"   ❌ No se encontró el archivo: {EXCEL_DPIS}")
        print(f"   💡 Asegúrate de cambiar el nombre del archivo en la configuración")
        return pd.DataFrame()
    except Exception as e:
        print(f"   ❌ Error leyendo DPIs: {e}")
        return pd.DataFrame()

def leer_inversionistas_desde_excel(df_dpis: pd.DataFrame) -> List[Dict[str, Any]]:
    """Lee los inversionistas del Excel principal y les asigna DPI"""
    
    print(f"📖 PASO 2: Leyendo datos bancarios desde primer Excel")
    print(f"   Archivo: {EXCEL_DATOS_BANCARIOS}")
    print(f"   Hoja: {HOJA_DATOS_BANCARIOS}")
    
    df = pd.read_excel(
        f"{CARPETA_EXCELS}\\{EXCEL_DATOS_BANCARIOS}",
        sheet_name=HOJA_DATOS_BANCARIOS,
        header=0
    )
    
    print(f"   ✅ Archivo leído. Total de filas: {len(df)}")
    print(f"   📊 Columnas: {list(df.columns)}")  # ← FIX: Aquí estaba el error
    
    print(f"\n🔄 PASO 3: Haciendo matching de nombres con DPIs...")
    print("=" * 80)
    
    inversionistas = []
    sin_dpi = []
    sin_cuenta = []
    
    for idx, row in df.iterrows():
        # Saltar filas vacías
        if pd.isna(row.get('Nombre inversionista')):
            continue
        
        nombre = str(row['Nombre inversionista']).strip()
        
        if not nombre:
            continue
        
        # Buscar DPI en el otro Excel
        dpi = None
        if not df_dpis.empty:
            dpi = buscar_dpi_por_nombre(nombre, df_dpis, umbral=0.85)
            if not dpi:
                sin_dpi.append(nombre)
        
        tipo_cuenta = normalizar_tipo_cuenta(row.get('Tipo cuenta'))
        banco = normalizar_banco(row.get('Banco'))
        numero_cuenta = limpiar_numero_cuenta(row.get('Numero de cuenta'))
        
        if not numero_cuenta:
            sin_cuenta.append(nombre)
        
        # Determinar tipo de reinversión
        tipo_reinversion = normalizar_tipo_reinversion(row.get('Reinversion'))
        
        inversionista = {
            "nombre": nombre,
            "dpi": dpi,
            "emite_factura": convertir_si_no_a_boolean(row.get('Emite factura')),
            "tipo_reinversion": tipo_reinversion,
            "banco": banco,
            "tipo_cuenta": tipo_cuenta,
            "numero_cuenta": numero_cuenta
        }
        
        inversionistas.append(inversionista)
        
        # Log con más detalle
        dpi_display = f"{dpi if dpi else '❌ SIN DPI':<15}"
        cuenta_display = f"{numero_cuenta[:25] if numero_cuenta else '❌ SIN CUENTA':<25}"
        print(f"✓ {idx+1:>3}. {nombre[:30]:<30} | DPI: {dpi_display} | Cuenta: {cuenta_display}")
    
    print("=" * 80)
    print(f"\n📦 Total de inversionistas procesados: {len(inversionistas)}")
    
    if sin_dpi:
        print(f"\n⚠️  {len(sin_dpi)} inversionistas SIN DPI (no se encontró match):")
        for i, nombre in enumerate(sin_dpi[:20], 1):
            print(f"   {i}. {nombre}")
        if len(sin_dpi) > 20:
            print(f"   ... y {len(sin_dpi) - 20} más")
    
    if sin_cuenta:
        print(f"\n⚠️  {len(sin_cuenta)} inversionistas SIN CUENTA:")
        for i, nombre in enumerate(sin_cuenta[:10], 1):
            print(f"   {i}. {nombre}")
        if len(sin_cuenta) > 10:
            print(f"   ... y {len(sin_cuenta) - 10} más")
    
    return inversionistas

def verificar_datos(inversionistas: List[Dict]) -> None:
    """Muestra un resumen detallado antes de enviar"""
    print("\n" + "=" * 80)
    print("🔍 VERIFICACIÓN DE DATOS")
    print("=" * 80)
    
    con_dpi = [inv for inv in inversionistas if inv['dpi']]
    con_cuenta = [inv for inv in inversionistas if inv['numero_cuenta']]
    con_factura = [inv for inv in inversionistas if inv['emite_factura']]
    con_reinversion = [inv for inv in inversionistas if inv['tipo_reinversion'] != 'sin_reinversion']
    
    print(f"\n📊 Estadísticas:")
    print(f"   Total inversionistas: {len(inversionistas)}")
    print(f"   ✅ Con DPI: {len(con_dpi)} ({len(con_dpi)/len(inversionistas)*100:.1f}%)")
    print(f"   ✅ Con cuenta bancaria: {len(con_cuenta)} ({len(con_cuenta)/len(inversionistas)*100:.1f}%)")
    print(f"   ✅ Emiten factura: {len(con_factura)} ({len(con_factura)/len(inversionistas)*100:.1f}%)")
    print(f"   ✅ Con reinversión: {len(con_reinversion)} ({len(con_reinversion)/len(inversionistas)*100:.1f}%)")
    
    print(f"\n📋 Muestra de datos (primeros 5 con cuenta y DPI):")
    muestra = [inv for inv in inversionistas if inv['dpi'] and inv['numero_cuenta']][:5]
    for inv in muestra:
        print(f"\n   {inv['nombre']}")
        print(f"      DPI: {inv['dpi']}")
        print(f"      Banco: {inv['banco'] or 'N/A'}")
        print(f"      Tipo cuenta: {inv['tipo_cuenta'] or 'N/A'}")
        print(f"      Número cuenta: {inv['numero_cuenta']}")
        print(f"      Reinversión: {inv['tipo_reinversion']}")
        print(f"      Emite factura: {'Sí' if inv['emite_factura'] else 'No'}")

def enviar_a_api(inversionistas: List[Dict[str, Any]], dry_run: bool = False) -> None:
    """Envía los inversionistas a la API en lotes"""
    
    if dry_run:
        print("\n" + "=" * 80)
        print("🧪 MODO DRY-RUN - SIMULACIÓN (NO SE ENVIARÁ NADA)")
        print("=" * 80)
        print("\nJSON que se enviaría (primeros 3 registros):\n")
        for inv in inversionistas[:3]:
            print(json.dumps(inv, indent=2, ensure_ascii=False))
            print()
        return
    
    print(f"\n🚀 Enviando {len(inversionistas)} inversionistas a la API...")
    print(f"📡 URL: {API_URL}\n")
    
    TAMAÑO_LOTE = 50
    total = len(inversionistas)
    exitosos = 0
    errores = []
    
    for i in range(0, total, TAMAÑO_LOTE):
        lote = inversionistas[i:i + TAMAÑO_LOTE]
        lote_num = i // TAMAÑO_LOTE + 1
        total_lotes = (total + TAMAÑO_LOTE - 1) // TAMAÑO_LOTE
        
        print(f"📤 Lote {lote_num}/{total_lotes}: enviando registros {i+1}-{min(i+TAMAÑO_LOTE, total)}")
        
        try:
            response = requests.post(
                API_URL,
                json=lote,
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            if response.status_code in [200, 201]:
                exitosos += len(lote)
                print(f"   ✅ Lote procesado exitosamente\n")
            else:
                print(f"   ❌ Error (Status {response.status_code})")
                error_msg = response.text[:300]
                print(f"   {error_msg}\n")
                errores.append(f"Lote {lote_num}: {error_msg}")
        
        except Exception as e:
            error_msg = str(e)
            print(f"   ❌ Error de conexión: {error_msg}\n")
            errores.append(f"Lote {lote_num}: {error_msg}")
    
    print("=" * 80)
    print(f"✅ Procesamiento completado: {exitosos}/{total} registros exitosos")
    print("=" * 80)
    
    if errores:
        print(f"\n⚠️  Se encontraron {len(errores)} errores:")
        for error in errores:
            print(f"   - {error}")

def main():
    """Función principal"""
    print("=" * 80)
    print("🏦 IMPORTADOR DE INVERSIONISTAS CON MATCHING DE DPI - CASH-IN")
    print("=" * 80)
    
    try:
        # Paso 1: Leer DPIs del segundo Excel
        df_dpis = leer_dpis_desde_excel()
        
        if df_dpis.empty:
            print("\n⚠️  ADVERTENCIA: No se cargaron DPIs. ¿Continuar sin DPIs?")
            continuar = input("Escribe 'si' para continuar: ").strip().lower()
            if continuar not in ['si', 's']:
                print("❌ Operación cancelada")
                return
        
        # Paso 2 y 3: Leer datos bancarios y hacer matching
        inversionistas = leer_inversionistas_desde_excel(df_dpis)
        
        if not inversionistas:
            print("⚠️  No se encontraron inversionistas para procesar")
            return
        
        # Verificar datos
        verificar_datos(inversionistas)
        
        # Preguntar qué hacer
        print("\n" + "=" * 80)
        print("¿Qué deseas hacer?")
        print("=" * 80)
        print("1. 🚀 Enviar a la API")
        print("2. 🧪 Dry-run (solo mostrar JSON)")
        print("3. 💾 Guardar JSON a archivo (sin enviar)")
        print("4. ❌ Cancelar")
        
        opcion = input("\nOpción (1/2/3/4): ").strip()
        
        if opcion == "1":
            confirmacion = input("\n⚠️  ¿Estás seguro de enviar los datos? (si/no): ").strip().lower()
            if confirmacion in ['si', 's', 'yes', 'y']:
                enviar_a_api(inversionistas, dry_run=False)
            else:
                print("❌ Envío cancelado")
        elif opcion == "2":
            enviar_a_api(inversionistas, dry_run=True)
        elif opcion == "3":
            filename = f"inversionistas_backup_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(inversionistas, f, indent=2, ensure_ascii=False)
            print(f"💾 Datos guardados en: {filename}")
        else:
            print("❌ Operación cancelada")
    
    except FileNotFoundError as e:
        print(f"❌ Error: No se encontró un archivo Excel")
        print(f"📂 Verifica las rutas en la configuración del script")
    except Exception as e:
        print(f"❌ Error inesperado: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()