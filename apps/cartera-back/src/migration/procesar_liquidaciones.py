import os
import pandas as pd
import requests
from datetime import datetime

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:7000/liquidar-cuotas"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos\Liquidaciones"

# 🆕 MODO PRUEBA - Cambiá a False para procesar todo
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 1  # Cuántos archivos procesar en modo prueba
MAX_REGISTROS_PRUEBA = 2  # Cuántos registros por archivo en modo prueba

# ============================================
# 📡 FUNCIÓN PARA LLAMAR A TU API
# ============================================
def liquidar_cuotas_api(nombre_usuario, cuota_mes):
    """
    Llama a tu API para liquidar cuotas por mes
    """
    headers = {
        "Content-Type": "application/json",
    }
    
    payload = {
        "nombre_usuario": nombre_usuario,
        "cuota_mes": cuota_mes,
    }
    
    try:
        print(f"   📤 Enviando a API: {nombre_usuario} - {cuota_mes}")
        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error llamando a la API: {e}")
        return None

# ============================================
# 📊 FUNCIÓN PARA PROCESAR UN EXCEL
# ============================================
def procesar_excel(archivo_path):
    """
    Lee un archivo Excel y extrae los datos de liquidación
    SIEMPRE LEE LA ÚLTIMA HOJA
    """
    print(f"\n📄 Procesando: {os.path.basename(archivo_path)}")
    
    try:
        # 🔥 LEER TODAS LAS HOJAS PARA ENCONTRAR LA ÚLTIMA
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        
        print(f"   📊 Hojas encontradas: {xls.sheet_names}")
        print(f"   📊 Total hojas: {len(xls.sheet_names)}")
        
        # 👇 LEER LA ÚLTIMA HOJA
        ultima_hoja = xls.sheet_names[-1]
        print(f"   ✅ Usando última hoja: '{ultima_hoja}'")
        
        # Leer sin header primero para buscar los encabezados
        df_raw = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=None)
        
        print(f"   ✅ Excel leído correctamente")
        print(f"   📊 Dimensiones: {df_raw.shape[0]} filas x {df_raw.shape[1]} columnas")
        
        # 🔍 BUSCAR LA FILA QUE CONTIENE LOS HEADERS
        header_row = None
        for idx, row in df_raw.iterrows():
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            # 🆕 Buscar "CUOTA DE MES" en lugar de "MESES EN CRÉDITO"
            if ('cuota de mes' in row_str or 'cuota mes' in row_str) and ('cliente' in row_str or 'nombre' in row_str):
                header_row = idx
                print(f"   ✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"   ⚠️ No se encontró la fila de headers")
            print(f"   📋 Primeras 5 filas del archivo:")
            print(df_raw.head())
            return []
        
        # 📖 LEER EL EXCEL USANDO LA FILA DE HEADERS ENCONTRADA
        df = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=header_row)
        
        print(f"   ✅ Columnas después de ajustar header: {df.columns.tolist()}")
        
        # 🔍 BUSCAR LAS COLUMNAS CORRECTAS - "CUOTA DE MES" y "CLIENTE"
        col_cuota_mes = None
        col_cliente = None
        
        for col in df.columns:
            col_str = str(col)
            col_lower = col_str.lower()
            
            # 🆕 Buscar "CUOTA DE MES"
            if col_cuota_mes is None and ('cuota de mes' in col_lower or 'cuota mes' in col_lower):
                col_cuota_mes = col
                print(f"   🎯 Columna CUOTA DE MES encontrada: '{col}'")
            
            # Cliente
            if col_cliente is None and ('cliente' in col_lower or 'nombre' in col_lower):
                col_cliente = col
                print(f"   🎯 Columna CLIENTE encontrada: '{col}'")
        
        if col_cuota_mes is None or col_cliente is None:
            print(f"   ⚠️ No se encontraron las columnas necesarias")
            print(f"   📋 Columnas disponibles: {df.columns.tolist()}")
            return []
        
        print(f"   ✅ Columna cuota_mes: '{col_cuota_mes}'")
        print(f"   ✅ Columna cliente: '{col_cliente}'")
        
        # 🧹 LIMPIAR DATOS - eliminar filas vacías
        df_clean = df[[col_cuota_mes, col_cliente]].copy()
        
        # Eliminar filas donde ambas columnas estén vacías
        df_clean = df_clean.dropna(how='all')
        
        # Filtrar filas donde cuota_mes tenga formato válido (texto con punto y número)
        registros = []
        for _, row in df_clean.iterrows():
            try:
                cuota_mes = str(row[col_cuota_mes]).strip()
                cliente = str(row[col_cliente]).strip()
                
                # Validar formato básico: debe tener al menos 4 caracteres y contener números
                if (cliente and cuota_mes and 
                    len(cuota_mes) >= 4 and 
                    any(char.isdigit() for char in cuota_mes) and
                    not any(x in cliente.lower() for x in ['total', 'suma', 'gran total', 'monto', 'nan'])):
                    
                    registros.append({
                        'nombre_usuario': cliente,
                        'cuota_mes': cuota_mes
                    })
                    print(f"      ✅ Registro agregado: {cliente} - {cuota_mes}")
            except (ValueError, TypeError) as e:
                continue
        
        print(f"   ✅ {len(registros)} registros válidos encontrados")
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
    
    # 🆕 MOSTRAR SI ESTÁ EN MODO PRUEBA
    if MODO_PRUEBA:
        print("🧪 ⚠️  MODO PRUEBA ACTIVADO ⚠️")
        print(f"   📁 Procesará máximo {MAX_ARCHIVOS_PRUEBA} archivo(s)")
        print(f"   📋 Procesará máximo {MAX_REGISTROS_PRUEBA} registro(s) por archivo")
        print("   💡 Para procesar todo, cambiá MODO_PRUEBA = False")
    else:
        print("🚀 MODO COMPLETO ACTIVADO")
    
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"🔗 API: {API_URL}")
    print("=" * 70)
    
    # Verificar que la carpeta exista
    if not os.path.exists(CARPETA_EXCELS):
        print(f"❌ La carpeta no existe: {CARPETA_EXCELS}")
        return
    
    # Obtener todos los archivos Excel (evitar archivos temporales de Excel que empiezan con ~$)
    archivos_excel = [
        f for f in os.listdir(CARPETA_EXCELS) 
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$')
    ]
    
    if not archivos_excel:
        print("⚠️ No se encontraron archivos Excel en la carpeta")
        return
    
    # 🆕 LIMITAR ARCHIVOS EN MODO PRUEBA
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
        
        # 🆕 LIMITAR REGISTROS EN MODO PRUEBA
        if MODO_PRUEBA and len(registros) > MAX_REGISTROS_PRUEBA:
            print(f"\n   🧪 Limitando a {MAX_REGISTROS_PRUEBA} registro(s) en modo prueba")
            registros = registros[:MAX_REGISTROS_PRUEBA]
        
        # Procesar cada registro
        for i, registro in enumerate(registros, 1):
            total_registros += 1
            print(f"\n   💰 [{i}/{len(registros)}] Procesando liquidación...")
            print(f"      👤 Cliente: {registro['nombre_usuario']}")
            print(f"      📅 Cuota mes: {registro['cuota_mes']}")
            
            # Llamar a la API
            resultado = liquidar_cuotas_api(
                registro['nombre_usuario'],
                registro['cuota_mes']
            )
            
            if resultado and resultado.get('success'):
                total_exitosos += 1
                print(f"      ✅ Liquidación exitosa")
                
                resultados_detallados.append({
                    'archivo': archivo,
                    'cliente': registro['nombre_usuario'],
                    'cuota_mes': registro['cuota_mes'],
                    'estado': 'EXITOSO',
                    'mensaje': resultado.get('message', '')
                })
            else:
                total_fallidos += 1
                error_msg = resultado.get('message', 'Error desconocido') if resultado else 'Sin respuesta'
                print(f"      ❌ Error: {error_msg}")
                
                resultados_detallados.append({
                    'archivo': archivo,
                    'cliente': registro['nombre_usuario'],
                    'cuota_mes': registro['cuota_mes'],
                    'estado': 'FALLIDO',
                    'mensaje': error_msg
                })
    
    # ============================================
    # 📊 RESUMEN FINAL
    # ============================================
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
    
    # Mostrar detalles de fallidos si los hay
    if total_fallidos > 0:
        print("\n❌ REGISTROS FALLIDOS:")
        for resultado in resultados_detallados:
            if resultado['estado'] == 'FALLIDO':
                print(f"   • {resultado['cliente']} ({resultado['cuota_mes']}) - {resultado['mensaje']}")
    
    # Guardar log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_filename = f"liquidacion_log_{timestamp}{'_PRUEBA' if MODO_PRUEBA else ''}.txt"
    log_path = os.path.join(CARPETA_EXCELS, log_filename)
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("RESUMEN DE LIQUIDACIÓN")
        if MODO_PRUEBA:
            f.write(" - MODO PRUEBA")
        f.write("\n")
        f.write("="*70 + "\n")
        f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total archivos: {total_archivos}\n")
        f.write(f"Total registros: {total_registros}\n")
        f.write(f"Exitosos: {total_exitosos}\n")
        f.write(f"Fallidos: {total_fallidos}\n")
        f.write("="*70 + "\n\n")
        f.write("DETALLE POR REGISTRO:\n")
        for resultado in resultados_detallados:
            f.write(f"\n{resultado['estado']}: {resultado['cliente']} ({resultado['cuota_mes']})\n")
            f.write(f"   Archivo: {resultado['archivo']}\n")
            f.write(f"   Mensaje: {resultado['mensaje']}\n")
    
    print(f"\n📄 Log guardado en: {log_filename}")

# ============================================
# 🚀 EJECUTAR
# ============================================
if __name__ == "__main__":
    procesar_liquidaciones()