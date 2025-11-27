import os
import pandas as pd
import requests
from datetime import datetime

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:7000/liquidar-cuotas"  # 👈 Cambiá por tu endpoint real
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos\Liquidaciones"

# ============================================
# 📡 FUNCIÓN PARA LLAMAR A TU API
# ============================================
def liquidar_cuotas_api(nombre_usuario, meses_liquidar):
    """
    Llama a tu API para liquidar cuotas
    """
    headers = {
        "Content-Type": "application/json",
    }
    
    payload = {
        "nombre_usuario": nombre_usuario,
        "meses_liquidar": meses_liquidar,
    }
    
    try:
        print(f"   📤 Enviando a API: {nombre_usuario} - {meses_liquidar} meses")
        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error llamando a la API: {e}")
        return None

# ============================================
# 📊 FUNCIÓN PARA PROCESAR UN EXCEL
# ============================================
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
            # Buscar palabras clave en la fila
            if 'meses' in row_str and ('cliente' in row_str or 'nombre' in row_str):
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
        
        # 🔍 BUSCAR LAS COLUMNAS CORRECTAS - PRIORIZAR "MESES EN CRÉDITO"
        col_meses = None
        col_cliente = None
        
        # 👇 NUEVA LÓGICA: Buscar específicamente "MESES EN CRÉDITO" primero
        for col in df.columns:
            col_str = str(col)
            col_lower = col_str.lower()
            
            # Prioridad 1: "MESES EN CRÉDITO" (exacto o similar)
            if col_meses is None and ('meses en crédito' in col_lower or 'meses en credito' in col_lower):
                col_meses = col
                print(f"   🎯 Usando columna prioritaria: '{col}'")
            
            # Cliente
            if col_cliente is None and ('cliente' in col_lower or 'nombre' in col_lower):
                col_cliente = col
        
        # Si no encontró "MESES EN CRÉDITO", buscar alternativas
        if col_meses is None:
            print(f"   ⚠️ No se encontró 'MESES EN CRÉDITO', buscando alternativas...")
            for col in df.columns:
                col_lower = str(col).lower()
                if 'plazo' in col_lower and 'meses' in col_lower:
                    col_meses = col
                    print(f"   🔄 Usando columna alternativa: '{col}'")
                    break
        
        if col_meses is None or col_cliente is None:
            print(f"   ⚠️ No se encontraron las columnas necesarias")
            print(f"   📋 Columnas disponibles: {df.columns.tolist()}")
            return []
        
        print(f"   ✅ Columna meses: '{col_meses}'")
        print(f"   ✅ Columna cliente: '{col_cliente}'")
        
        # 🧹 LIMPIAR DATOS - eliminar filas vacías y no numéricas en meses
        df_clean = df[[col_meses, col_cliente]].copy()
        
        # Eliminar filas donde ambas columnas estén vacías
        df_clean = df_clean.dropna(how='all')
        
        # Filtrar solo filas donde meses sea número válido
        df_clean['meses_numeric'] = pd.to_numeric(df_clean[col_meses], errors='coerce')
        df_clean = df_clean[df_clean['meses_numeric'].notna()]
        
        registros = []
        for _, row in df_clean.iterrows():
            try:
                meses = int(row['meses_numeric'])
                cliente = str(row[col_cliente]).strip()
                
                # Validar que no esté vacío y que no sea un total o encabezado
                if cliente and meses > 0 and not any(x in cliente.lower() for x in ['total', 'suma', 'gran total', 'monto']):
                    registros.append({
                        'nombre_usuario': cliente,
                        'meses_liquidar': meses
                    })
                    print(f"      ✅ Registro agregado: {cliente} - {meses} meses")
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
    
    print(f"📁 Encontrados {len(archivos_excel)} archivos Excel\n")
    
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
        
        # Procesar cada registro
        for i, registro in enumerate(registros, 1):
            total_registros += 1
            print(f"\n   💰 [{i}/{len(registros)}] Procesando liquidación...")
            print(f"      👤 Cliente: {registro['nombre_usuario']}")
            print(f"      📅 Meses: {registro['meses_liquidar']}")
            
            # Llamar a la API
            resultado = liquidar_cuotas_api(
                registro['nombre_usuario'],
                registro['meses_liquidar']
            )
            
            if resultado and resultado.get('success'):
                total_exitosos += 1
                print(f"      ✅ Liquidación exitosa")
                
                resultados_detallados.append({
                    'archivo': archivo,
                    'cliente': registro['nombre_usuario'],
                    'meses': registro['meses_liquidar'],
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
                    'meses': registro['meses_liquidar'],
                    'estado': 'FALLIDO',
                    'mensaje': error_msg
                })
    
    # ============================================
    # 📊 RESUMEN FINAL
    # ============================================
    print("\n" + "="*70)
    print("🎉 PROCESAMIENTO COMPLETADO")
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
                print(f"   • {resultado['cliente']} ({resultado['meses']} meses) - {resultado['mensaje']}")
    
    # Guardar log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_filename = f"liquidacion_log_{timestamp}.txt"
    log_path = os.path.join(CARPETA_EXCELS, log_filename)
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("RESUMEN DE LIQUIDACIÓN\n")
        f.write("="*70 + "\n")
        f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total archivos: {total_archivos}\n")
        f.write(f"Total registros: {total_registros}\n")
        f.write(f"Exitosos: {total_exitosos}\n")
        f.write(f"Fallidos: {total_fallidos}\n")
        f.write("="*70 + "\n\n")
        f.write("DETALLE POR REGISTRO:\n")
        for resultado in resultados_detallados:
            f.write(f"\n{resultado['estado']}: {resultado['cliente']} ({resultado['meses']} meses)\n")
            f.write(f"   Archivo: {resultado['archivo']}\n")
            f.write(f"   Mensaje: {resultado['mensaje']}\n")
    
    print(f"\n📄 Log guardado en: {log_filename}")

# ============================================
# 🚀 EJECUTAR
# ============================================
if __name__ == "__main__":
    procesar_liquidaciones()