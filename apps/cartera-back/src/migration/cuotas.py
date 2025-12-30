import os
import pandas as pd
import requests
from datetime import datetime
import re

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL_CUOTA = "http://localhost:7000/ultima-cuota-pagada"
API_URL_AJUSTAR = "http://localhost:7000/ajustar-cuotas-sifco"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_NOVIEMBRE = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 🔥 MODO PRUEBA - Solo procesar el primer crédito
MODO_PRUEBA = True  # 👈 Cambiá a False para procesar todos

# ============================================
# 🔧 FUNCIÓN PARA EXTRAER NÚMERO BASE Y SUFIJO
# ============================================
def extraer_info_credito(numero_credito):
    """
    Extrae el número base y el sufijo
    """
    match = re.match(r'^(.+?)(?:_(\d+))?$', str(numero_credito))
    if match:
        base = match.group(1)
        sufijo = int(match.group(2)) if match.group(2) else 0
        return base, sufijo
    return str(numero_credito), 0

# ============================================
# 📡 FUNCIÓN PARA CONSULTAR CRÉDITO
# ============================================
def obtener_ultima_cuota_pagada(numero_credito_sifco):
    """
    Llama al endpoint GET /ultima-cuota-pagada
    """
    try:
        print(f"   📤 Consultando API: {numero_credito_sifco}")
        response = requests.get(
            API_URL_CUOTA,
            params={"numero_credito_sifco": numero_credito_sifco},
            timeout=30
        )
        
        if response.status_code == 404:
            print(f"   ⚠️ Crédito no encontrado: {numero_credito_sifco}")
            return None
            
        response.raise_for_status()
        data = response.json()
        
        ultima_cuota = data.get('ultima_cuota_pagada')
        
        if ultima_cuota is None:
            print(f"   ⚠️ No hay cuotas pagadas aún")
            return 0
        
        print(f"   ✅ Última cuota pagada: {ultima_cuota}")
        return ultima_cuota
        
    except requests.exceptions.ConnectionError as e:
        print(f"   ❌ API no disponible")
        return None
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error: {e}")
        return None

# ============================================
# 🔥 FUNCIÓN PARA AJUSTAR CUOTAS CON SIFCO
# ============================================
def ajustar_cuotas_sifco(numero_credito_sifco, cuota_real_actual):
    """
    Llama al endpoint POST /api/creditos/ajustar-cuotas-sifco
    """
    try:
        print(f"\n   🔧 Ajustando cuotas con SIFCO...")
        print(f"      📋 Crédito: {numero_credito_sifco}")
        print(f"      📊 Cuota real actual: {cuota_real_actual}")
        
        response = requests.post(
            API_URL_AJUSTAR,
            json={
                "numero_credito_sifco": numero_credito_sifco,
                "cuota_real_actual": cuota_real_actual
            },
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        response.raise_for_status()
        data = response.json()
        
        if data.get('success'):
            print(f"   ✅ Cuotas ajustadas correctamente")
            print(f"      📊 Cuotas históricas: {data['data']['cuotas_historicas']}")
            return True
        else:
            print(f"   ❌ Error ajustando: {data.get('message')}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error ajustando cuotas: {e}")
        return False

# ============================================
# 📊 FUNCIÓN PARA PROCESAR EXCEL
# ============================================
def analizar_desfases():
    modo_texto = "MODO PRUEBA - SOLO PRIMER CRÉDITO" if MODO_PRUEBA else "MODO COMPLETO"
    
    print(f"🔥 ========== {modo_texto} ==========")
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"📄 Archivo: {ARCHIVO_NOVIEMBRE}")
    print(f"🔗 API Consulta: {API_URL_CUOTA}")
    print(f"🔗 API Ajuste: {API_URL_AJUSTAR}")
    print("=" * 70)
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_NOVIEMBRE)
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        # Leer Excel
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        
        # Buscar hoja
        hoja_noviembre = "Noviembre 2025" if "Noviembre 2025" in xls.sheet_names else xls.sheet_names[-1]
        print(f"✅ Usando hoja: {hoja_noviembre}")
        
        df_raw = pd.read_excel(archivo_path, sheet_name=hoja_noviembre, engine='openpyxl', header=None)
        
        # Buscar headers
        header_row = None
        for idx, row in df_raw.iterrows():
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'numero' in row_str or 'credito' in row_str or 'sifco' in row_str:
                header_row = idx
                print(f"✅ Headers en fila {idx}")
                break
        
        if header_row is None:
            print("❌ No encontré headers")
            return
        
        df = pd.read_excel(archivo_path, sheet_name=hoja_noviembre, engine='openpyxl', header=header_row)
        
        # Buscar columnas
        col_credito = None
        col_cuota_pagada = None
        
        for col in df.columns:
            col_str = str(col)
            col_lower = col_str.lower()
            
            if col_credito is None and ('credito' in col_lower or 'sifco' in col_lower):
                col_credito = col
            
            if col_cuota_pagada is None and (col_str.strip() == '#' or 'cuota' in col_lower):
                col_cuota_pagada = col
        
        if not col_credito:
            print("❌ No encontré columna de crédito")
            return
        
        print(f"✅ Columna crédito: '{col_credito}'")
        print(f"✅ Columna cuota: '{col_cuota_pagada}'")
        
        # Limpiar datos
        if col_cuota_pagada:
            df_clean = df[[col_credito, col_cuota_pagada]].copy()
        else:
            df_clean = df[[col_credito]].copy()
            df_clean['cuota_pagada_placeholder'] = None
            col_cuota_pagada = 'cuota_pagada_placeholder'
        
        df_clean = df_clean.dropna(subset=[col_credito])
        df_clean = df_clean[~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)]
        
        # Extraer info
        df_clean[['numero_base', 'sufijo']] = df_clean[col_credito].apply(
            lambda x: pd.Series(extraer_info_credito(x))
        )
        
        df_clean['cuotas_num'] = pd.to_numeric(df_clean[col_cuota_pagada], errors='coerce')
        
        # Tomar versión más reciente
        idx_max_sufijo = df_clean.groupby('numero_base')['sufijo'].idxmax()
        df_unicos = df_clean.loc[idx_max_sufijo].copy()
        
        print(f"\n📊 Créditos únicos encontrados: {len(df_unicos)}")
        
        # 🔥 MODO PRUEBA - Solo el primero
        if MODO_PRUEBA:
            df_unicos = df_unicos.head(1)
            print(f"🧪 MODO PRUEBA: Procesando solo el primer crédito")
        
        print(f"🚀 Procesando {len(df_unicos)} crédito(s)...\n")
        
        # Procesar
        for idx, row in df_unicos.iterrows():
            numero_base = row['numero_base']
            numero_completo = row[col_credito]
            sufijo = row['sufijo']
            cuotas_excel = row['cuotas_num']
            
            print(f"{'='*70}")
            print(f"📋 Crédito: {numero_base}")
            print(f"   📝 Versión Excel: {numero_completo} (sufijo: {sufijo})")
            
            if cuotas_excel and pd.notna(cuotas_excel):
                cuotas_excel_int = int(cuotas_excel)
                print(f"   📊 Cuotas en Excel: {cuotas_excel_int}")
            else:
                print(f"   ⚠️ Sin cuotas en Excel")
                continue
            
            # Consultar API
            ultima_cuota_api = obtener_ultima_cuota_pagada(numero_base)
            
            if ultima_cuota_api is None:
                print(f"   ❌ No se pudo consultar el crédito")
                continue
            
            # Comparar
            desfase = ultima_cuota_api - cuotas_excel_int
            
            print(f"\n   📊 Comparación:")
            print(f"      Excel: {cuotas_excel_int} cuotas")
            print(f"      API:   {ultima_cuota_api} cuotas")
            print(f"      Diferencia: {desfase} cuotas")
            
            if abs(desfase) > 1:
                print(f"\n   🚨 ¡DESFASE DETECTADO!")
                
                # Calcular cuota real actual
                cuota_real_actual = cuotas_excel_int + 1
                
                print(f"   🔧 Ajustando automáticamente...")
                print(f"      Cuota real actual calculada: {cuota_real_actual}")
                
                # Ajustar
                if ajustar_cuotas_sifco(numero_base, cuota_real_actual):
                    print(f"\n   ✅ ¡CRÉDITO AJUSTADO EXITOSAMENTE!")
                else:
                    print(f"\n   ❌ No se pudo ajustar el crédito")
            else:
                print(f"\n   ✅ Sin desfase significativo")
            
            print(f"{'='*70}\n")
        
        print("\n🎉 Proceso completado!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

# ============================================
# 🚀 EJECUTAR
# ============================================
if __name__ == "__main__":
    print("🔥 Iniciando análisis y ajuste...")
    print("⚠️  Asegurate que tu backend esté corriendo\n")
    
    if MODO_PRUEBA:
        print("🧪 MODO PRUEBA ACTIVADO - Solo procesará el primer crédito")
        print("💡 Para procesar todos, cambiá MODO_PRUEBA = False en el código\n")
    
    input("📌 Presiona ENTER para continuar...")
    analizar_desfases()