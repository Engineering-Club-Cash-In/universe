import os
import pandas as pd
import requests
from typing import List, Dict, Any

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_ENDPOINT = "http://localhost:7000/pagos-inversionistas/v2"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 📅 Hojas a procesar (orden cronológico inverso - más reciente primero)
HOJAS_A_PROCESAR = [
    "Noviembre 2025",

    "Diciembre 2025"
     
    # Agregá más según necesites
]

# 🔥 MODO PRUEBA
MODO_PRUEBA = False  # 👈 True = solo 1 crédito por hoja, False = todos
LIMITE_CREDITOS_PRUEBA = 2  # Número de créditos a procesar en modo prueba

# ============================================
# 🧹 FUNCIÓN PARA LIMPIAR VALORES
# ============================================
def limpiar_valor(valor: Any) -> str:
    """Limpia valores eliminando prefijo Q y espacios"""
    if pd.isna(valor):
        return "0"
    
    valor_str = str(valor).strip()
    
    # Remover prefijo Q (como hace el código TS)
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
    """
    Lee una hoja específica del Excel y agrupa inversionistas por crédito
    
    Returns:
        Dict con estructura: {
            'numero_credito_1': [inversionista1, inversionista2, ...],
            'numero_credito_2': [inversionista3, inversionista4, ...],
        }
    """
    print(f"\n{'='*70}")
    print(f"📄 Procesando hoja: {nombre_hoja}")
    print(f"{'='*70}")
    
    try:
        # Leer Excel sin headers primero para buscarlos
        df_raw = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=None)
        
        # Buscar fila de headers
        header_row = None
        for idx, row in df_raw.iterrows():
            if idx > 20:
                break
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'credito' in row_str or 'inversionista' in row_str:
                header_row = idx
                print(f"✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"⚠️ No se encontraron headers en la hoja {nombre_hoja}")
            return {}
        
        # Leer con headers correctos
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        
        # 🎯 MAPEO CORRECTO según tu Excel real
        columnas_mapeo = {
            'credito_sifco': '# crédito SIFCO',
            'inversionista': 'Inversionista',
            'capital': 'Capital',
            'porcentaje_interes': '%',
            'porcentaje_cashin': '% Cash-In',
            'porcentaje_inversionista': '% Inversionista',
            'cuota': 'Cuota',
            'cuota_inversionista': 'Cuota Inverionista',  # Ojo al typo en tu Excel
        }
        
        # Verificar que existen todas las columnas
        columnas = {}
        faltantes = []
        
        for key, nombre_excel in columnas_mapeo.items():
            if nombre_excel in df.columns:
                columnas[key] = nombre_excel
            else:
                faltantes.append(nombre_excel)
        
        if faltantes:
            print(f"❌ Faltan columnas en {nombre_hoja}: {faltantes}")
            return {}
        
        print(f"✅ Todas las columnas encontradas")
        
        # Limpiar DataFrame - solo filas con crédito e inversionista válidos
        df_clean = df.dropna(subset=[columnas['credito_sifco'], columnas['inversionista']])
        df_clean = df_clean[
            ~df_clean[columnas['credito_sifco']].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        
        print(f"✅ Filas válidas encontradas: {len(df_clean)}")
        
        # Agrupar por crédito
        creditos_data = {}
        
        for idx, row in df_clean.iterrows():
            # Extraer número de crédito (sin sufijos _2, _3, etc)
            numero_credito_raw = str(row[columnas['credito_sifco']]).strip()
            
            # Remover sufijos tipo _2, _3
            numero_credito = numero_credito_raw.split('_')[0]
            
            # Si no existe el crédito en el dict, inicializarlo
            if numero_credito not in creditos_data:
                creditos_data[numero_credito] = []
            
            # 🎯 Construir data del inversionista usando los NOMBRES EXACTOS de tu Excel
            inversionista_data = {
                "inversionista": str(row[columnas['inversionista']]).strip(),
                "capital": limpiar_valor(row[columnas['capital']]),
                "porcentajeCashIn": limpiar_valor(row[columnas['porcentaje_cashin']]),
                "porcentajeInversionista": limpiar_valor(row[columnas['porcentaje_inversionista']]),
                "porcentaje": limpiar_valor(row[columnas['porcentaje_interes']]),
                "cuota": limpiar_valor(row[columnas['cuota']]),
                "cuotaInversionista": limpiar_valor(row[columnas['cuota_inversionista']]),
            }
            
            creditos_data[numero_credito].append(inversionista_data)
        
        print(f"✅ Créditos únicos encontrados: {len(creditos_data)}")
        
        # Mostrar resumen de primeros créditos
        for credito, inversionistas in list(creditos_data.items())[:3]:
            print(f"   📋 {credito}: {len(inversionistas)} inversionistas")
            # Mostrar primer inversionista de ejemplo
            if inversionistas:
                inv = inversionistas[0]
                print(f"      👤 {inv['inversionista']}")
        
        if len(creditos_data) > 3:
            print(f"   ... y {len(creditos_data) - 3} créditos más")
        
        return creditos_data
        
    except Exception as e:
        print(f"❌ Error leyendo hoja {nombre_hoja}: {e}")
        import traceback
        traceback.print_exc()
        return {}

# ============================================
# 📡 FUNCIÓN PARA ENVIAR A API
# ============================================
def enviar_a_api(numero_credito: str, inversionistas: List[Dict[str, Any]]) -> Dict:
    """Envía la data procesada al endpoint TypeScript"""
    payload = {
        "numeroCredito": numero_credito,
        "inversionistasData": inversionistas
    }
    
    print(f"\n   🚀 Enviando {len(inversionistas)} inversionistas a la API...")
    
    # 🔍 MOSTRAR PAYLOAD COMPLETO PARA DEBUG
    print(f"\n   📦 PAYLOAD:")
    import json
    print(json.dumps(payload, indent=2, ensure_ascii=False)[:500])  # Primeros 500 caracteres
    print("   ...")
    
    try:
        response = requests.post(
            API_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        # 🔍 MOSTRAR STATUS CODE
        print(f"\n   📡 Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"   ❌ Response Text: {response.text[:500]}")
        
        response.raise_for_status()
        resultado = response.json()
        
        print(f"   ✅ Respuesta de API:")
        print(f"      - Exitosos: {resultado.get('exitosos', 0)}")
        print(f"      - Fallidos: {resultado.get('fallidos', 0)}")
        
        if resultado.get('errores'):
            print(f"\n   ⚠️ Errores reportados:")
            for error in resultado.get('errores', []):
                print(f"      - {error.get('inversionista', 'N/A')}: {error.get('error', 'N/A')}")
        
        return resultado
        
    except requests.exceptions.ConnectionError:
        print(f"   ❌ API no disponible - ¿Está corriendo el backend?")
        return {"exitosos": 0, "fallidos": len(inversionistas), "errores": [{"inversionista": "N/A", "error": "API no disponible"}]}
    except requests.exceptions.Timeout:
        print(f"   ❌ Timeout - La API tardó mucho en responder")
        return {"exitosos": 0, "fallidos": len(inversionistas), "errores": [{"inversionista": "N/A", "error": "Timeout"}]}
    except requests.exceptions.HTTPError as e:
        print(f"   ❌ Error HTTP: {e}")
        print(f"   Response: {response.text[:500]}")
        return {"exitosos": 0, "fallidos": len(inversionistas), "errores": [{"inversionista": "N/A", "error": str(e)}]}
    except Exception as e:
        print(f"   ❌ Error inesperado: {e}")
        import traceback
        traceback.print_exc()
        return {"exitosos": 0, "fallidos": len(inversionistas), "errores": [{"inversionista": "N/A", "error": str(e)}]}
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
    
    if MODO_PRUEBA:
        print(f"⚡ Límite por hoja: {LIMITE_CREDITOS_PRUEBA} crédito(s)")
    
    print(f"{'='*70}\n")
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    # Verificar hojas disponibles
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        print(f"📋 Hojas disponibles en el archivo:")
        for hoja in hojas_disponibles:
            print(f"   - {hoja}")
        print()
    except Exception as e:
        print(f"❌ Error leyendo archivo: {e}")
        return
    
    # Estadísticas globales
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_exitosos': 0,
        'inversionistas_fallidos': 0,
    }
    
    # Procesar cada hoja
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            print(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        # Leer hoja
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
            print(f"👥 Inversionistas: {len(inversionistas)}")
            
            # Mostrar inversionistas
            for inv in inversionistas[:3]:  # Primeros 3
                print(f"   - {inv['inversionista']}: Capital={inv['capital']}")
            if len(inversionistas) > 3:
                print(f"   ... y {len(inversionistas) - 3} más")
            
            # Enviar a API
            resultado = enviar_a_api(numero_credito, inversionistas)
            
            # Actualizar estadísticas
            stats_globales['creditos_procesados'] += 1
            
            if resultado.get('exitosos', 0) > 0:
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