import os
import pandas as pd
import requests
from datetime import datetime
from dateutil.relativedelta import relativedelta

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:7000/liquidar-cuotas-batch-inteligente"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos\Liquidaciones\LiquidacionesEnero"

# MODO PRUEBA
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 1
MAX_REGISTROS_PRUEBA = 5

# ============================================
# FUNCIONES AUXILIARES
# ============================================
def extraer_nombre_inversionista(nombre_archivo):
    """Extrae el nombre del inversionista del nombre del archivo"""
    print(f"   📄 Archivo original: '{nombre_archivo}'")
    
    nombre_limpio = nombre_archivo
    extensiones_conocidas = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv']
    
    while True:
        nombre_sin_ext, extension = os.path.splitext(nombre_limpio)
        if extension.lower() in extensiones_conocidas:
            print(f"   ✂️  Removiendo: '{extension}'")
            nombre_limpio = nombre_sin_ext
        else:
            break
    
    nombre_limpio = nombre_limpio.strip()
    print(f"   👤 Inversionista final: '{nombre_limpio}'")
    
    return nombre_limpio

def normalizar_mes_antes_enviar(cuota_mes: str) -> str:
    """Normaliza el formato del mes ANTES de enviarlo a la API y RESTA 1 MES"""
    mes_limpio = cuota_mes.strip()
    mes_limpio = mes_limpio.rstrip('.')
    mes_limpio = mes_limpio.replace('2025', '25').replace('2024', '24').replace('2023', '23')
    
    if ' y ' in mes_limpio:
        mes_limpio = mes_limpio.split(' y ')[-1].strip()
    if ',' in mes_limpio:
        mes_limpio = mes_limpio.split(',')[-1].strip()
    if ' - ' in mes_limpio:
        mes_limpio = mes_limpio.split(' - ')[-1].strip()
    
    partes = mes_limpio.split()
    if len(partes) == 2:
        mes = partes[0].lower()
        año = partes[1]
        if mes.endswith('.'):
            mes = mes[:-1]
        mes = mes[:3]
        
        # 🔥 PARSEAR LA FECHA
        meses_map = {
            'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4,
            'may': 5, 'jun': 6, 'jul': 7, 'ago': 8,
            'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
        }
        
        if mes in meses_map:
            mes_num = meses_map[mes]
            año_completo = 2000 + int(año)  # Convertir "25" a 2025
            
            # 🔥 CREAR FECHA Y RESTAR 1 MES
            fecha = datetime(año_completo, mes_num, 1)
            fecha_anterior = fecha - relativedelta(months=1)
            
            # 🔥 FORMATEAR DE VUELTA
            meses_reverso = {v: k for k, v in meses_map.items()}
            mes_anterior = meses_reverso[fecha_anterior.month]
            año_anterior = str(fecha_anterior.year)[2:]  # Últimos 2 dígitos
            
            mes_limpio_final = f"{mes_anterior}. {año_anterior}"
            
            return mes_limpio_final
    
    return mes_limpio

# ============================================
# 📊 PROCESAR EXCEL COMPLETO
# ============================================
def procesar_excel_completo(archivo_path):
    """Lee un archivo Excel COMPLETO"""
    print(f"\n📄 Procesando archivo COMPLETO: {os.path.basename(archivo_path)}")
    
    nombre_inversionista = extraer_nombre_inversionista(os.path.basename(archivo_path))
    
    print(f"\n   👤 Inversionista: {nombre_inversionista}")
    
    try:
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        print(f"\n   📊 Hojas encontradas: {xls.sheet_names}")
        
        ultima_hoja = xls.sheet_names[-1]
        print(f"   ✅ Usando última hoja: '{ultima_hoja}'")
        
        df_raw = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=None)
        print(f"   ✅ Excel leído correctamente")
        print(f"   📊 Dimensiones: {df_raw.shape[0]} filas x {df_raw.shape[1]} columnas")
        
        # BUSCAR HEADERS
        header_row = None
        for idx, row in df_raw.iterrows():
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'capital' in row_str and 'cuota de mes' in row_str:
                header_row = idx
                print(f"   ✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"   ⚠️ No se encontró la fila de headers")
            return None
        
        df = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=header_row)
        print(f"   ✅ Columnas: {df.columns.tolist()}")
        
        # 🔥 BUSCAR COLUMNAS (INCLUYENDO % INVERSOR)
        col_cliente = None
        col_capital = None
        col_cuota_mes = None
        col_meses_credito = None
        col_porcentaje_inversor = None
        
        for col in df.columns:
            col_str = str(col)
            col_lower = col_str.lower()
            
            if col_cliente is None and ('cliente' in col_lower or 'nombre' in col_lower):
                if 'total' not in col_lower and 'suma' not in col_lower:
                    col_cliente = col
                    print(f"   🎯 Columna CLIENTE: '{col}'")
            
            # 🔥 BUSCAR CAPITAL (sin "restante")
            if col_capital is None and col_lower == 'capital':
                col_capital = col
                print(f"   🎯 Columna CAPITAL: '{col}'")
            
            if col_cuota_mes is None and ('cuota de mes' in col_lower or 'cuota mes' in col_lower):
                col_cuota_mes = col
                print(f"   🎯 Columna CUOTA MES: '{col}'")
            
            if col_meses_credito is None and ('meses en credito' in col_lower or 'meses en crédito' in col_lower):
                col_meses_credito = col
                print(f"   🎯 Columna MESES EN CRÉDITO: '{col}'")
            
            if col_porcentaje_inversor is None and ('% inversor' in col_lower or '%inversor' in col_lower or 'porcentaje inversor' in col_lower):
                col_porcentaje_inversor = col
                print(f"   🎯 Columna % INVERSOR: '{col}'")
        
        if col_capital is None or col_cuota_mes is None:
            print(f"   ⚠️ No se encontraron las columnas necesarias")
            return None
        
        # 🔥 PREPARAR COLUMNAS A USAR
        columnas_a_usar = []
        if col_cliente:
            columnas_a_usar.append(col_cliente)
        columnas_a_usar.append(col_capital)
        columnas_a_usar.append(col_cuota_mes)
        if col_meses_credito:
            columnas_a_usar.append(col_meses_credito)
        if col_porcentaje_inversor:
            columnas_a_usar.append(col_porcentaje_inversor)
        
        df_clean = df[columnas_a_usar].copy()
        df_clean = df_clean.dropna(how='all')
        print(f"\n   📊 Total filas después de limpiar vacías: {len(df_clean)}")
        
        # PROCESAR REGISTROS
        registros = []
        for idx, row in df_clean.iterrows():
            try:
                if col_cliente:
                    cliente_raw = row[col_cliente]
                    cliente = str(cliente_raw).strip() if pd.notna(cliente_raw) else ""
                else:
                    cliente = nombre_inversionista
                
                capital_raw = row[col_capital]
                if pd.notna(capital_raw):
                    capital_str = str(capital_raw).replace('Q', '').replace(',', '').strip()
                    try:
                        capital = float(capital_str)
                    except ValueError:
                        continue
                else:
                    capital = 0.0
                
                cuota_mes_raw = row[col_cuota_mes]
                cuota_mes = str(cuota_mes_raw).strip() if pd.notna(cuota_mes_raw) else ""
                
                # OBTENER MESES EN CRÉDITO
                meses_en_credito = None
                if col_meses_credito:
                    meses_credito_raw = row[col_meses_credito]
                    if pd.notna(meses_credito_raw):
                        try:
                            meses_en_credito = int(float(str(meses_credito_raw)))
                        except (ValueError, TypeError):
                            meses_en_credito = None
                
                # 🆕 OBTENER % INVERSOR
                porcentaje_inversor = None
                if col_porcentaje_inversor:
                    porcentaje_raw = row[col_porcentaje_inversor]
                    if pd.notna(porcentaje_raw):
                        try:
                            # Puede venir como "1.20%" o "1.20" o "0.012" (decimal)
                            porcentaje_str = str(porcentaje_raw).replace('%', '').replace(',', '').strip()
                            porcentaje_float = float(porcentaje_str)
                            
                            # Si es menor a 1, asumimos que es decimal (0.012 = 1.2%)
                            if porcentaje_float < 1:
                                porcentaje_inversor = porcentaje_float * 100
                            else:
                                porcentaje_inversor = porcentaje_float
                        except (ValueError, TypeError):
                            porcentaje_inversor = None
                
                palabras_invalidas = ['total', 'suma', 'gran total', 'subtotal', 'monto', 'nan', 'none']
                palabras_cliente = cliente.lower().split()
                cliente_invalido = any(palabra in palabras_invalidas for palabra in palabras_cliente)
                
                # 🔥 VALIDACIÓN MEJORADA
                if (cliente and 
                    not cliente_invalido and
                    capital > 0 and
                    cuota_mes and 
                    len(cuota_mes) >= 4 and 
                    any(char.isdigit() for char in cuota_mes)):
                    
                    # 🔥 NORMALIZAR Y RESTAR 1 MES
                    cuota_mes_normalizada = normalizar_mes_antes_enviar(cuota_mes)
                    
                    # 🆕 AGREGAR REGISTRO CON porcentaje_inversor
                    registro = {
                        'nombre_usuario': cliente,
                        'cuota_mes': cuota_mes_normalizada,
                        'capital': capital,
                        'meses_en_credito': meses_en_credito,
                        'porcentaje_inversor': porcentaje_inversor
                    }
                    
                    registros.append(registro)
                    
                    # Mostrar indicadores
                    indicador_mes1 = " 🆕 (MES 1)" if meses_en_credito == 1 else ""
                    indicador_porcentaje = f" 📊 {porcentaje_inversor}%" if porcentaje_inversor else ""
                    print(f"      ✅ Fila {idx}: {cliente} - Q{capital:,.2f} - {cuota_mes} → {cuota_mes_normalizada}{indicador_mes1}{indicador_porcentaje}")
                    
            except (ValueError, TypeError) as e:
                continue
        
        print(f"\n   ✅ {len(registros)} registros válidos")
        
        if MODO_PRUEBA and len(registros) > MAX_REGISTROS_PRUEBA:
            print(f"\n   🧪 Limitando a {MAX_REGISTROS_PRUEBA} registros")
            registros = registros[:MAX_REGISTROS_PRUEBA]
        
        return {
            'nombre_inversionista': nombre_inversionista,
            'liquidaciones': registros
        }
        
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

# ============================================
# 📡 LLAMAR A LA API BATCH INTELIGENTE
# ============================================
def liquidar_batch_inteligente_api(data_completa):
    """Llama a la API para liquidar BATCH INTELIGENTE"""
    headers = {"Content-Type": "application/json"}
    
    payload = {
        'nombre_inversionista': data_completa['nombre_inversionista'],
        'liquidaciones': data_completa['liquidaciones']
    }
    
    try:
        print(f"\n📤 ========== ENVIANDO BATCH INTELIGENTE ==========")
        print(f"   👤 Inversionista: {data_completa['nombre_inversionista']}")
        print(f"   📊 Total liquidaciones: {len(data_completa['liquidaciones'])}")
        
        # Contar cuántos son mes 1
        mes1_count = sum(1 for liq in data_completa['liquidaciones'] if liq.get('meses_en_credito') == 1)
        if mes1_count > 0:
            print(f"   🆕 Créditos en mes 1: {mes1_count}")
        
        response = requests.post(API_URL, json=payload, headers=headers, timeout=300)
        
        if response.status_code in [400, 422]:
            print(f"   ❌ {response.status_code}")
            print(f"   📄 Response: {response.text}")
        
        response.raise_for_status()
        return response.json()
        
    except requests.exceptions.HTTPError as e:
        error_msg = str(e)
        try:
            if e.response is not None:
                error_data = e.response.json()
                error_msg = error_data.get('message') or error_data.get('error')
                return {
                    "success": False,
                    "message": error_msg,
                    "status_code": e.response.status_code,
                    "full_error": error_data
                }
        except:
            pass
        
        print(f"   ❌ Error: {error_msg}")
        return {"success": False, "message": error_msg}
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error: {e}")
        return {"success": False, "message": str(e)}

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_liquidaciones():
    print("🔥 ========== BATCH INTELIGENTE ==========")
    
    if MODO_PRUEBA:
        print("🧪 MODO PRUEBA")
        print(f"   Max archivos: {MAX_ARCHIVOS_PRUEBA}")
        print(f"   Max registros: {MAX_REGISTROS_PRUEBA}")
    
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"🔗 API: {API_URL}")
    print("=" * 70)
    
    if not os.path.exists(CARPETA_EXCELS):
        print(f"❌ Carpeta no existe: {CARPETA_EXCELS}")
        return
    
    archivos_excel = [
        f for f in os.listdir(CARPETA_EXCELS) 
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$')
    ]
    
    if not archivos_excel:
        print("⚠️ No hay archivos Excel")
        return
    
    if MODO_PRUEBA and len(archivos_excel) > MAX_ARCHIVOS_PRUEBA:
        archivos_excel = archivos_excel[:MAX_ARCHIVOS_PRUEBA]
    
    print(f"📁 Archivos: {len(archivos_excel)}\n")
    
    total_archivos = len(archivos_excel)
    total_exitosos = 0
    total_fallidos = 0
    
    resultados_por_archivo = []
    
    for idx, archivo in enumerate(archivos_excel, 1):
        print(f"\n{'='*70}")
        print(f"📋 [{idx}/{total_archivos}] {archivo}")
        print(f"{'='*70}")
        
        ruta_completa = os.path.join(CARPETA_EXCELS, archivo)
        data_completa = procesar_excel_completo(ruta_completa)
        
        if not data_completa or not data_completa['liquidaciones']:
            print(f"   ⚠️ Sin registros válidos")
            total_fallidos += 1
            resultados_por_archivo.append({
                'archivo': archivo,
                'estado': 'FALLIDO',
                'razon': 'Sin registros'
            })
            continue
        
        resultado = liquidar_batch_inteligente_api(data_completa)
        
        if resultado and resultado.get('success'):
            total_exitosos += 1
            print(f"\n   ✅ BATCH COMPLETADO")
            print(f"      ✅ Exitosos: {resultado.get('exitosos', 0)}")
            print(f"      ❌ Fallidos: {resultado.get('fallidos', 0)}")
            print(f"      ➕ Agregados: {resultado.get('agregados', 0)}")
            print(f"      🔄 Actualizados: {resultado.get('actualizados', 0)}")
            
            resultados_por_archivo.append({
                'archivo': archivo,
                'estado': 'EXITOSO',
                'inversionista': resultado.get('inversionista', {}).get('nombre', ''),
                'exitosos': resultado.get('exitosos', 0),
                'fallidos': resultado.get('fallidos', 0),
                'agregados': resultado.get('agregados', 0),
                'actualizados': resultado.get('actualizados', 0)
            })
        else:
            total_fallidos += 1
            error_msg = resultado.get('message', 'Error') if resultado else 'Sin respuesta'
            print(f"\n   ❌ ERROR: {error_msg}")
            
            resultados_por_archivo.append({
                'archivo': archivo,
                'estado': 'FALLIDO',
                'razon': error_msg
            })
    
    print("\n" + "="*70)
    print("🎉 COMPLETADO")
    print("="*70)
    print(f"✅ Exitosos: {total_exitosos}")
    print(f"❌ Fallidos: {total_fallidos}")
    
    # GUARDAR LOG
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_filename = f"liquidacion_inteligente_{timestamp}.txt"
    log_path = os.path.join(CARPETA_EXCELS, log_filename)
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("BATCH INTELIGENTE - RESUMEN\n")
        f.write("=" * 100 + "\n")
        f.write(f"Fecha: {datetime.now()}\n")
        f.write(f"Exitosos: {total_exitosos}\n")
        f.write(f"Fallidos: {total_fallidos}\n\n")
        
        for res in resultados_por_archivo:
            f.write(f"\n{'='*100}\n")
            f.write(f"Archivo: {res['archivo']}\n")
            f.write(f"Estado: {res['estado']}\n")
            if res['estado'] == 'EXITOSO':
                f.write(f"Exitosos: {res.get('exitosos', 0)}\n")
                f.write(f"Fallidos: {res.get('fallidos', 0)}\n")
                f.write(f"Agregados: {res.get('agregados', 0)}\n")
                f.write(f"Actualizados: {res.get('actualizados', 0)}\n")
            else:
                f.write(f"Razón: {res.get('razon', '')}\n")
    
    print(f"\n📄 Log: {log_filename}")

if __name__ == "__main__":
    procesar_liquidaciones()