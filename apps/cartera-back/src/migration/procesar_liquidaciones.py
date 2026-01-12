import os
import pandas as pd
import requests
from datetime import datetime
import json

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:7000/liquidar-cuotas"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos\Liquidaciones"

# MODO PRUEBA
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 1
MAX_REGISTROS_PRUEBA = 2

# ============================================
# 🆕 FUNCIÓN PARA EXTRAER NOMBRE DEL INVERSIONISTA DEL ARCHIVO
# ============================================
def extraer_nombre_inversionista(nombre_archivo):
    """
    Extrae el nombre del inversionista del nombre del archivo
    🔥 MANEJA DOBLES EXTENSIONES (.xlsx.xlsx)
    """
    print(f"   📄 Archivo original: '{nombre_archivo}'")
    
    nombre_limpio = nombre_archivo
    
    # 🔥 LOOP: Remover extensiones hasta que no queden más
    extensiones_conocidas = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv']
    
    while True:
        # Obtener extensión actual
        nombre_sin_ext, extension = os.path.splitext(nombre_limpio)
        
        # Si la extensión es una de las conocidas, removerla
        if extension.lower() in extensiones_conocidas:
            print(f"   ✂️  Removiendo: '{extension}'")
            nombre_limpio = nombre_sin_ext
        else:
            # Ya no hay más extensiones conocidas
            break
    
    nombre_limpio = nombre_limpio.strip()
    
    print(f"   👤 Inversionista final: '{nombre_limpio}'")
    
    return nombre_limpio

# ============================================
# 🧹 NORMALIZAR MES ANTES DE ENVIAR A LA API
# ============================================
def normalizar_mes_antes_enviar(cuota_mes: str) -> str:
    """
    Normaliza el formato del mes ANTES de enviarlo a la API
    """
    mes_limpio = cuota_mes.strip()
    
    # 1. Remover puntos extras al final
    mes_limpio = mes_limpio.rstrip('.')
    
    # 2. Convertir año de 4 dígitos a 2
    mes_limpio = mes_limpio.replace('2025', '25')
    mes_limpio = mes_limpio.replace('2024', '24')
    mes_limpio = mes_limpio.replace('2023', '23')
    mes_limpio = mes_limpio.replace('2022', '22')
    
    # 3. Si tiene múltiples meses (ej: "ago. 25 y sep. 25"), tomar el último
    if ' y ' in mes_limpio:
        meses = mes_limpio.split(' y ')
        mes_limpio = meses[-1].strip()
    
    # 4. Si tiene comas
    if ',' in mes_limpio:
        meses = mes_limpio.split(',')
        mes_limpio = meses[-1].strip()
    
    # 5. Si tiene guión (ej: "jun. 25 - sep. 25")
    if ' - ' in mes_limpio:
        meses = mes_limpio.split(' - ')
        mes_limpio = meses[-1].strip()
    
    # 6. Asegurar formato "mes. año"
    partes = mes_limpio.split()
    if len(partes) == 2:
        mes = partes[0].lower()
        año = partes[1]
        
        # Quitar punto si ya lo tiene
        if mes.endswith('.'):
            mes = mes[:-1]
        
        # Solo primeras 3 letras del mes
        mes = mes[:3]
        
        # Formato final
        mes_limpio = f"{mes}. {año}"
    
    return mes_limpio

# ============================================
# 📡 FUNCIÓN PARA LLAMAR A TU API DE LIQUIDACIÓN
# ============================================
def liquidar_cuotas_api(nombre_usuario, cuota_mes, capital, nombre_inversionista):
    """
    Llama a tu API para liquidar cuotas por mes
    """
    # NORMALIZAR EL MES ANTES DE ENVIAR
    cuota_mes_normalizada = normalizar_mes_antes_enviar(cuota_mes)
    
    headers = {
        "Content-Type": "application/json",
    }
    
    payload = {
        "nombre_usuario": nombre_usuario,
        "cuota_mes": cuota_mes_normalizada,
        "capital": capital,
        "nombre_inversionista": nombre_inversionista,
    }
    
    try:
        print(f"   📤 Enviando a API: {nombre_usuario} - {cuota_mes_normalizada}")
        print(f"      💰 Capital: Q{capital:,.2f}")
        print(f"      👤 Inversionista: {nombre_inversionista}")
        if cuota_mes != cuota_mes_normalizada:
            print(f"      🔧 Mes normalizado de: {cuota_mes}")
        
        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        
        # SI ES 400, MOSTRAR LA RESPUESTA COMPLETA
        if response.status_code == 400:
            print(f"      ❌ 400 BAD REQUEST")
            print(f"      📄 Response body: {response.text}")
        
        # SI ES 422, MOSTRAR LA RESPUESTA COMPLETA
        if response.status_code == 422:
            print(f"      ❌ 422 UNPROCESSABLE ENTITY")
            print(f"      📄 Response body: {response.text}")
        
        response.raise_for_status()
        return response.json()
        
    except requests.exceptions.HTTPError as e:
        error_msg = str(e)
        
        # INTENTAR EXTRAER EL MENSAJE DE ERROR DEL BACKEND
        try:
            if e.response is not None:
                error_data = e.response.json()
                if 'message' in error_data:
                    error_msg = error_data['message']
                elif 'error' in error_data:
                    error_msg = error_data['error']
                
                return {
                    "success": False,
                    "message": error_msg,
                    "status_code": e.response.status_code,
                    "full_error": error_data
                }
        except:
            pass
        
        print(f"   ❌ Error HTTP: {error_msg}")
        return {
            "success": False,
            "message": error_msg
        }
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error llamando a la API: {e}")
        return {
            "success": False,
            "message": str(e)
        }

# ============================================
# 📊 FUNCIÓN PARA PROCESAR UN EXCEL
# ============================================
def procesar_excel(archivo_path):
    """
    Lee un archivo Excel y extrae los datos de liquidación
    """
    print(f"\n📄 Procesando: {os.path.basename(archivo_path)}")
    
    # ============================================
    # 🔥 EXTRAER NOMBRE DEL INVERSIONISTA DEL ARCHIVO
    # ============================================
    nombre_inversionista = extraer_nombre_inversionista(os.path.basename(archivo_path))
    
    print(f"\n   👤 Inversionista: {nombre_inversionista}")
    print(f"   ℹ️  Asegurate que este inversionista exista en la BD")
    
    try:
        # LEER TODAS LAS HOJAS PARA ENCONTRAR LA ÚLTIMA
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        
        print(f"\n   📊 Hojas encontradas: {xls.sheet_names}")
        print(f"   📊 Total hojas: {len(xls.sheet_names)}")
        
        # LEER LA ÚLTIMA HOJA
        ultima_hoja = xls.sheet_names[-1]
        print(f"   ✅ Usando última hoja: '{ultima_hoja}'")
        
        # Leer sin header primero para buscar los encabezados
        df_raw = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=None)
        
        print(f"   ✅ Excel leído correctamente")
        print(f"   📊 Dimensiones: {df_raw.shape[0]} filas x {df_raw.shape[1]} columnas")
        
        # BUSCAR LA FILA QUE CONTIENE LOS HEADERS
        header_row = None
        for idx, row in df_raw.iterrows():
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            # Buscar headers con las 3 columnas
            if 'capital restante' in row_str and 'cuota de mes' in row_str:
                header_row = idx
                print(f"   ✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"   ⚠️ No se encontró la fila de headers")
            return []
        
        # LEER EL EXCEL USANDO LA FILA DE HEADERS ENCONTRADA
        df = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=header_row)
        
        print(f"   ✅ Columnas después de ajustar header: {df.columns.tolist()}")
        
        # BUSCAR LAS COLUMNAS NECESARIAS
        col_cliente = None
        col_capital = None
        col_cuota_mes = None
        
        for col in df.columns:
            col_str = str(col)
            col_lower = col_str.lower()
            
            # Cliente
            if col_cliente is None and ('cliente' in col_lower or 'nombre' in col_lower):
                if 'total' not in col_lower and 'suma' not in col_lower:
                    col_cliente = col
                    print(f"   🎯 Columna CLIENTE encontrada: '{col}'")
            
            # Capital Restante
            if col_capital is None and ('capital restante' in col_lower or 'capital_restante' in col_lower):
                col_capital = col
                print(f"   🎯 Columna CAPITAL RESTANTE encontrada: '{col}'")
            
            # Cuota de Mes
            if col_cuota_mes is None and ('cuota de mes' in col_lower or 'cuota mes' in col_lower):
                col_cuota_mes = col
                print(f"   🎯 Columna CUOTA DE MES encontrada: '{col}'")
        
        # VALIDAR QUE TENGAMOS AL MENOS CAPITAL Y CUOTA_MES
        if col_capital is None or col_cuota_mes is None:
            print(f"   ⚠️ No se encontraron las columnas necesarias")
            return []
        
        # SI NO HAY COLUMNA CLIENTE, USAR SOLO CAPITAL Y CUOTA_MES
        if col_cliente:
            df_clean = df[[col_cliente, col_capital, col_cuota_mes]].copy()
        else:
            df_clean = df[[col_capital, col_cuota_mes]].copy()
        
        # Eliminar filas donde todo esté vacío
        df_clean = df_clean.dropna(how='all')
        
        print(f"\n   📊 Total filas después de limpiar: {len(df_clean)}")
        
        # FILTRAR REGISTROS VÁLIDOS
        registros = []
        for idx, row in df_clean.iterrows():
            try:
                # CLIENTE
                if col_cliente:
                    cliente_raw = row[col_cliente]
                    if pd.notna(cliente_raw):
                        cliente = str(cliente_raw).strip()
                    else:
                        cliente = ""
                else:
                    cliente = nombre_inversionista
                
                # CAPITAL RESTANTE
                capital_raw = row[col_capital]
                
                if pd.notna(capital_raw):
                    capital_str = str(capital_raw).replace('Q', '').replace(',', '').strip()
                    try:
                        capital = float(capital_str)
                    except ValueError:
                        continue
                else:
                    capital = 0.0
                
                # CUOTA MES
                cuota_mes_raw = row[col_cuota_mes]
                if pd.notna(cuota_mes_raw):
                    cuota_mes = str(cuota_mes_raw).strip()
                else:
                    cuota_mes = ""
                
                # VALIDACIONES
                palabras_invalidas = ['total', 'suma', 'gran total', 'subtotal', 'monto', 'nan', 'none']
                
                # 🔥 FIX: Validar palabras completas, no subcadenas
                palabras_cliente = cliente.lower().split()
                cliente_invalido = any(palabra in palabras_invalidas for palabra in palabras_cliente)
                
                if (cliente and 
                    not cliente_invalido and
                    capital > 0 and
                    cuota_mes and 
                    len(cuota_mes) >= 4 and 
                    any(char.isdigit() for char in cuota_mes)):
                    
                    registros.append({
                        'nombre_usuario': cliente,
                        'cuota_mes': cuota_mes,
                        'capital': capital,
                        'nombre_inversionista': nombre_inversionista
                    })
                    print(f"      ✅ Fila {idx}: {cliente} - Q{capital:,.2f} - {cuota_mes}")
                    
            except (ValueError, TypeError) as e:
                continue
        
        print(f"\n   ✅ {len(registros)} registros válidos encontrados")
        
        return registros
        
    except Exception as e:
        print(f"   ❌ Error procesando Excel: {e}")
        import traceback
        traceback.print_exc()
        return []
# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_liquidaciones():
    print("🔥 ========== INICIANDO PROCESAMIENTO DE LIQUIDACIONES ==========")
    
    if MODO_PRUEBA:
        print("🧪 ⚠️  MODO PRUEBA ACTIVADO ⚠️")
        print(f"   📁 Procesará máximo {MAX_ARCHIVOS_PRUEBA} archivo(s)")
        print(f"   📋 Procesará máximo {MAX_REGISTROS_PRUEBA} registro(s) por archivo")
    else:
        print("🚀 MODO COMPLETO ACTIVADO")
    
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"🔗 API: {API_URL}")
    print("=" * 70)
    
    if not os.path.exists(CARPETA_EXCELS):
        print(f"❌ La carpeta no existe: {CARPETA_EXCELS}")
        return
    
    archivos_excel = [
        f for f in os.listdir(CARPETA_EXCELS) 
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$')
    ]
    
    if not archivos_excel:
        print("⚠️ No se encontraron archivos Excel en la carpeta")
        return
    
    if MODO_PRUEBA and len(archivos_excel) > MAX_ARCHIVOS_PRUEBA:
        print(f"\n🧪 Limitando a {MAX_ARCHIVOS_PRUEBA} archivo(s) en modo prueba")
        archivos_excel = archivos_excel[:MAX_ARCHIVOS_PRUEBA]
    
    print(f"📁 Archivos a procesar: {len(archivos_excel)}\n")
    
    # Contadores
    total_archivos = len(archivos_excel)
    total_registros = 0
    total_exitosos = 0
    total_fallidos = 0
    
    resultados_detallados = []
    
    # Procesar cada archivo
    for idx, archivo in enumerate(archivos_excel, 1):
        print(f"\n{'='*70}")
        print(f"📋 [{idx}/{total_archivos}] {archivo}")
        print(f"{'='*70}")
        
        ruta_completa = os.path.join(CARPETA_EXCELS, archivo)
        
        # Leer el Excel
        registros = procesar_excel(ruta_completa)
        
        if not registros:
            print(f"   ⚠️ No se encontraron registros válidos en este archivo")
            continue
        
        # LIMITAR REGISTROS EN MODO PRUEBA
        if MODO_PRUEBA and len(registros) > MAX_REGISTROS_PRUEBA:
            print(f"\n   🧪 Limitando a {MAX_REGISTROS_PRUEBA} registro(s) en modo prueba")
            registros = registros[:MAX_REGISTROS_PRUEBA]
        
        # Procesar cada registro
        for i, registro in enumerate(registros, 1):
            total_registros += 1
            print(f"\n   💰 [{i}/{len(registros)}] Procesando liquidación...")
            print(f"      👤 Cliente: {registro['nombre_usuario']}")
            print(f"      📅 Cuota mes: {registro['cuota_mes']}")
            print(f"      💰 Capital: Q{registro['capital']:,.2f}")
            print(f"      👥 Inversionista: {registro['nombre_inversionista']}")
            
            # LLAMAR A LA API
            resultado = liquidar_cuotas_api(
                registro['nombre_usuario'],
                registro['cuota_mes'],
                registro['capital'],
                registro['nombre_inversionista']
            )
            
            if resultado and resultado.get('success'):
                total_exitosos += 1
                print(f"      ✅ Liquidación exitosa")
                
                resultados_detallados.append({
                    'archivo': archivo,
                    'cliente': registro['nombre_usuario'],
                    'cuota_mes': registro['cuota_mes'],
                    'capital': registro['capital'],
                    'inversionista': registro['nombre_inversionista'],
                    'estado': 'EXITOSO',
                    'mensaje': resultado.get('message', ''),
                    'data': resultado.get('data', {})
                })
            else:
                total_fallidos += 1
                error_msg = resultado.get('message', 'Error desconocido') if resultado else 'Sin respuesta'
                print(f"      ❌ Error: {error_msg}")
                
                resultados_detallados.append({
                    'archivo': archivo,
                    'cliente': registro['nombre_usuario'],
                    'cuota_mes': registro['cuota_mes'],
                    'capital': registro['capital'],
                    'inversionista': registro['nombre_inversionista'],
                    'estado': 'FALLIDO',
                    'mensaje': error_msg,
                    'data': None,
                    'full_error': resultado.get('full_error') if resultado else None
                })
    
    # RESUMEN FINAL
    print("\n" + "="*70)
    print("🎉 PROCESAMIENTO COMPLETADO")
    if MODO_PRUEBA:
        print("🧪 (MODO PRUEBA)")
    print("="*70)
    print(f"📊 Total archivos procesados: {total_archivos}")
    print(f"📊 Total registros procesados: {total_registros}")
    print(f"✅ Liquidaciones exitosas: {total_exitosos}")
    print(f"❌ Liquidaciones fallidas: {total_fallidos}")
    print("="*70)
    
    # Mostrar detalles de fallidos
    if total_fallidos > 0:
        print("\n❌ REGISTROS FALLIDOS:")
        for resultado in resultados_detallados:
            if resultado['estado'] == 'FALLIDO':
                print(f"   • {resultado['cliente']} ({resultado['cuota_mes']}) - {resultado['mensaje']}")
    
    # GUARDAR LOGS
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_filename = f"liquidacion_log_{timestamp}{'_PRUEBA' if MODO_PRUEBA else ''}.txt"
    log_path = os.path.join(CARPETA_EXCELS, log_filename)
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("RESUMEN DE LIQUIDACIÓN CON CAPITAL E INVERSIONISTAS\n")
        f.write("=" * 100 + "\n")
        f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total archivos: {total_archivos}\n")
        f.write(f"Total registros: {total_registros}\n")
        f.write(f"Exitosos: {total_exitosos}\n")
        f.write(f"Fallidos: {total_fallidos}\n")
        f.write("=" * 100 + "\n\n")
        
        # EXITOSOS
        f.write("✅ REGISTROS EXITOSOS\n")
        f.write("=" * 100 + "\n")
        for idx, resultado in enumerate([r for r in resultados_detallados if r['estado'] == 'EXITOSO'], 1):
            f.write(f"\n{idx}. ✅ {resultado['cliente']}\n")
            f.write(f"   📅 Cuota mes: {resultado['cuota_mes']}\n")
            f.write(f"   💰 Capital: Q{resultado['capital']:,.2f}\n")
            f.write(f"   👥 Inversionista: {resultado['inversionista']}\n")
            f.write(f"   📁 Archivo: {resultado['archivo']}\n")
            f.write(f"   💬 Mensaje: {resultado['mensaje']}\n")
            f.write("-" * 100 + "\n")
        
        # FALLIDOS
        f.write("\n❌ REGISTROS FALLIDOS\n")
        f.write("=" * 100 + "\n")
        for idx, resultado in enumerate([r for r in resultados_detallados if r['estado'] == 'FALLIDO'], 1):
            f.write(f"\n{idx}. ❌ {resultado['cliente']}\n")
            f.write(f"   📅 Cuota mes: {resultado['cuota_mes']}\n")
            f.write(f"   💰 Capital: Q{resultado['capital']:,.2f}\n")
            f.write(f"   👥 Inversionista: {resultado['inversionista']}\n")
            f.write(f"   📁 Archivo: {resultado['archivo']}\n")
            f.write(f"   🚨 Error: {resultado['mensaje']}\n")
            if resultado.get('full_error'):
                f.write(f"   📋 Detalle: {json.dumps(resultado['full_error'], indent=6, ensure_ascii=False)}\n")
            f.write("-" * 100 + "\n")
    
    print(f"\n📄 Log guardado en: {log_filename}")

# ============================================
# 🚀 EJECUTAR
# ============================================
if __name__ == "__main__":
    procesar_liquidaciones()