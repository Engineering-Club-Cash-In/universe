import os
import pandas as pd
import requests
from typing import List, Dict, Any

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_ENDPOINT = "http://localhost:7000/pagos-inversionistas/v2"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL ="Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 📅 Hojas a procesar
HOJAS_A_PROCESAR = [
    "Noviembre 2025",   # 🔥 Se procesa PRIMERO
    "Diciembre 2025",   # 🔥 Se procesa SEGUNDO 
]

# 🔥 MODO PRUEBA
MODO_PRUEBA = False
LIMITE_CREDITOS_PRUEBA = 6

# ============================================
# 🧹 FUNCIÓN PARA LIMPIAR VALORES
# ============================================
def limpiar_valor(valor: Any) -> str:
    """Limpia valores eliminando prefijo Q y espacios"""
    if pd.isna(valor):
        return "0"
    
    valor_str = str(valor).strip()
    
    # Remover prefijo Q
    if valor_str.upper().startswith('Q'):
        valor_str = valor_str[1:].strip()
    
    # Remover comas de miles
    valor_str = valor_str.replace(',', '')
    
    return valor_str

# ============================================
# 📖 FUNCIÓN PARA LEER UNA HOJA
# ============================================
def leer_hoja_excel(
    archivo_path: str,
    nombre_hoja: str
) -> Dict[str, List[Dict[str, Any]]]:
    """Lee una hoja específica del Excel y agrupa inversionistas por crédito"""
    print(f"\n{'='*70}")
    print(f"📄 Procesando hoja: {nombre_hoja}")
    print(f"{'='*70}")
    
    try:
        # Leer Excel - fila 1 tiene los headers
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=1)
        
        # 🧹 Limpiar nombres de columnas
        df.columns = [str(col).strip().replace('\n', ' ').replace('  ', ' ') for col in df.columns]
        
        print(f"\n📋 Total columnas: {len(df.columns)}")
        print(f"📋 Total filas (antes de limpiar): {len(df)}")
        
        # 🎯 MAPEO DIRECTO POR ÍNDICE - 100% CORRECTO
        # Según tu Excel:
        # [1]  '# crédito SIFCO'    -> 01010214111980
        # [4]  'Capital'            -> Q269,354.80
        # [5]  '%'                  -> 1.50% (interés)
        # [9]  '% Cash-In'          -> 100.00%
        # [10] '% Inversionista'    -> 0.00%
        # [13] 'Cuota Inverionista' -> valor o 0
        # [35] 'Inversionista'      -> Cube Investments S.A.
        # [37] 'Cuota'              -> Q8,132.48  🎯 ESTA ES LA CORRECTA
        
        columnas = {
            'credito_sifco': df.columns[1],           # '# crédito SIFCO'
            'capital': df.columns[25],                  # 'Capital' -> Q269,354.80
            'porcentaje_interes': df.columns[5],       # '%' -> 1.50%
            'porcentaje_cashin': df.columns[9],        # '% Cash-In' -> 100.00%
            'porcentaje_inversionista': df.columns[10], # '% Inversionista' -> 0.00%
            'cuota_inversionista': df.columns[13],     # 'Cuota Inverionista'
            'inversionista': df.columns[35],           # 'Inversionista' -> Cube Investments S.A.
            'cuota': df.columns[37],                   # 'Cuota' -> Q8,132.48 🎯
        }
        
        # Verificar columnas
        print(f"\n✅ Mapeo de columnas:")
        print(f"   {'KEY':<30} {'ÍNDICE':<8} {'NOMBRE COLUMNA'}")
        print(f"   {'-'*70}")
        for key, col in columnas.items():
            idx = df.columns.get_loc(col)
            print(f"   {key:<30} [{idx:2d}]      {repr(col)}")
        
        # 🧹 Limpiar DataFrame
        df_clean = df.dropna(subset=[columnas['credito_sifco'], columnas['inversionista']])
        
        # Filtrar totales/sumas
        df_clean = df_clean[
            ~df_clean[columnas['credito_sifco']].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        
        # Filtrar donde inversionista sea un número o porcentaje
        df_clean = df_clean[
            ~df_clean[columnas['inversionista']].astype(str).str.match(r'^[\d.]+%?$', na=False)
        ]
        
        # Filtrar inversionistas muy cortos
        df_clean = df_clean[
            df_clean[columnas['inversionista']].astype(str).str.len() > 3
        ]
        
        print(f"\n✅ Filas válidas encontradas: {len(df_clean)}")
        
        # 🔍 DEBUG: Mostrar primera fila COMPLETA
        if len(df_clean) > 0:
            print(f"\n🔍 DEBUG - Primera fila válida:")
            print(f"{'─'*70}")
            primera = df_clean.iloc[0]
            
            for key, col in columnas.items():
                valor_raw = primera[col]
                valor_limpio = limpiar_valor(valor_raw)
                print(f"   {key:<30}: {valor_limpio:<20} (raw: {repr(str(valor_raw)[:30])})")
            
            print(f"{'─'*70}")
        else:
            print(f"\n⚠️ No hay filas válidas")
            return {}
        
        # Agrupar por crédito
        creditos_data = {}
        
        for idx, row in df_clean.iterrows():
            numero_credito_raw = str(row[columnas['credito_sifco']]).strip()
            numero_credito = numero_credito_raw.split('_')[0]
            
            if numero_credito not in creditos_data:
                creditos_data[numero_credito] = []
            
            # 🎯 Construir data del inversionista - MATCH PERFECTO
            inversionista_data = {
                "inversionista": str(row[columnas['inversionista']]).strip(),  # Cube Investments S.A.
                "capital": limpiar_valor(row[columnas['capital']]),  # 269354.80
                "porcentajeCashIn": limpiar_valor(row[columnas['porcentaje_cashin']]),  # 1.00
                "porcentajeInversionista": limpiar_valor(row[columnas['porcentaje_inversionista']]),  # 0.00
                "porcentaje": limpiar_valor(row[columnas['porcentaje_interes']]),  # 0.015
                "cuota": limpiar_valor(row[columnas['cuota']]),  # 8132.48 🎯 LA CORRECTA [37]
                "cuotaInversionista": limpiar_valor(row[columnas['cuota_inversionista']]),  # valor o 0
            }
            
            creditos_data[numero_credito].append(inversionista_data)
        
        print(f"\n✅ Créditos únicos encontrados: {len(creditos_data)}")
        
        # Mostrar resumen
        for credito, inversionistas in list(creditos_data.items())[:3]:
            print(f"\n   📋 Crédito: {credito}")
            print(f"      👥 {len(inversionistas)} inversionista(s)")
            if inversionistas:
                inv = inversionistas[0]
                print(f"      👤 {inv['inversionista']}")
                print(f"      💰 Capital: Q{inv['capital']}")
                print(f"      📊 Interés: {inv['porcentaje']} | CashIn: {inv['porcentajeCashIn']} | Inv: {inv['porcentajeInversionista']}")
                print(f"      💵 Cuota: Q{inv['cuota']} | Cuota Inv: Q{inv['cuotaInversionista']}")
        
        if len(creditos_data) > 3:
            print(f"\n   ... y {len(creditos_data) - 3} créditos más")
        
        return creditos_data
        
    except Exception as e:
        print(f"❌ Error leyendo hoja {nombre_hoja}: {e}")
        import traceback
        traceback.print_exc()
        return {}

def enviar_a_api(
    numero_credito: str,
    inversionistas: List[Dict[str, Any]]
) -> Dict:
    """Envía la data procesada al endpoint"""
    payload = {
        "numeroCredito": numero_credito,
        "inversionistasData": inversionistas
    }
    
    try:
        response = requests.post(
            API_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        if response.status_code != 200:
            print(f"   ❌ Error {response.status_code}: {response.text[:200]}")
            return {"success": False, "exitosos": 0, "fallidos": len(inversionistas)}
        
        resultado = response.json()
        
        if resultado.get('success'):
            print(f"   ✅ {resultado.get('exitosos', 0)} exitosos")
        else:
            print(f"   ⚠️ {resultado.get('error', 'Error desconocido')}")
        
        if resultado.get('fallidos', 0) > 0:
            print(f"   ❌ {resultado['fallidos']} fallidos")
        
        return resultado
        
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return {"success": False, "exitosos": 0, "fallidos": len(inversionistas)}

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_multiples_hojas():
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🔥 MODO COMPLETO"
    
    print(f"\n{'='*70}")
    print(f"{modo_texto}")
    print(f"{'='*70}")
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"📄 Archivo: {ARCHIVO_EXCEL}")
    print(f"🔗 API: {API_ENDPOINT}")
    print(f"📅 Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    for hoja in HOJAS_A_PROCESAR:
        print(f"   - {hoja}")
    
    if MODO_PRUEBA:
        print(f"\n⚡ Límite por hoja: {LIMITE_CREDITOS_PRUEBA} crédito(s)")
    
    print(f"{'='*70}\n")
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    # Estadísticas globales
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'creditos_sin_match': 0,
        'inversionistas_exitosos': 0,
        'inversionistas_fallidos': 0,
    }
    
    # Procesar cada hoja
    for nombre_hoja in HOJAS_A_PROCESAR:
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            print(f"⚠️ No se encontraron datos en la hoja {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        
        # Limitar en modo prueba
        creditos_a_procesar = list(creditos_data.items())
        if MODO_PRUEBA:
            creditos_a_procesar = creditos_a_procesar[:LIMITE_CREDITOS_PRUEBA]
            print(f"\n🧪 MODO PRUEBA: Procesando solo {len(creditos_a_procesar)} crédito(s)")
        
        # Procesar cada crédito
        for numero_credito, inversionistas in creditos_a_procesar:
            print(f"\n{'─'*70}")
            print(f"📋 Crédito: {numero_credito}")
            print(f"📅 Hoja: {nombre_hoja}")
            print(f"👥 Inversionistas: {len(inversionistas)}")
            
            # Mostrar inversionistas
            for inv in inversionistas:
                print(f"   - {inv['inversionista']}: Capital=Q{inv['capital']}, Cuota=Q{inv['cuota']}")
            
            # 🔥 Enviar a API (sin hoja_excel)
            resultado = enviar_a_api(numero_credito, inversionistas)
            
            # Actualizar estadísticas
            stats_globales['creditos_procesados'] += 1
            
            if not resultado.get('success', True):
                stats_globales['creditos_sin_match'] += 1
                print(f"\n   ⚠️ Crédito {numero_credito} NO procesado")
            elif resultado.get('exitosos', 0) > 0:
                stats_globales['creditos_exitosos'] += 1
                stats_globales['inversionistas_exitosos'] += resultado['exitosos']
            
            if resultado.get('fallidos', 0) > 0:
                stats_globales['creditos_fallidos'] += 1
                stats_globales['inversionistas_fallidos'] += resultado['fallidos']
            
            print(f"{'─'*70}")
    
    # Resumen final
    print(f"\n{'='*70}")
    print(f"🎉 RESUMEN FINAL")
    print(f"{'='*70}")
    print(f"📊 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    print(f"📋 Créditos procesados: {stats_globales['creditos_procesados']}")
    print(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    print(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    print(f"   ⚠️  Sin match: {stats_globales['creditos_sin_match']}")
    print(f"\n👥 Inversionistas:")
    print(f"   ✅ Exitosos: {stats_globales['inversionistas_exitosos']}")
    print(f"   ❌ Fallidos: {stats_globales['inversionistas_fallidos']}")
    print(f"{'='*70}\n")
# ============================================
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    print("🔥 Iniciando procesamiento de múltiples hojas...")
    print("⚠️  Asegurate que tu backend esté corriendo en el puerto 7000\n")
    
    if MODO_PRUEBA:
        print(f"🧪 MODO PRUEBA ACTIVADO")
        print(f"   - Solo se procesará {LIMITE_CREDITOS_PRUEBA} crédito(s) por hoja")
        print(f"   - Para procesar todos, cambiá MODO_PRUEBA = False\n")
    
    input("📌 Presiona ENTER para continuar...")
    
    try:
        procesar_multiples_hojas()
        print("\n✅ ¡Proceso completado con éxito!")
    except KeyboardInterrupt:
        print("\n\n⚠️ Proceso interrumpido por el usuario")
    except Exception as e:
        print(f"\n❌ Error fatal: {e}")
        import traceback
        traceback.print_exc()