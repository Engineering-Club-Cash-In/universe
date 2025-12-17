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

# 🆕 MODO PRUEBA - Cambiá a False para procesar todo
MODO_PRUEBA = False
MAX_ARCHIVOS_PRUEBA = 1  # Cuántos archivos procesar en modo prueba
MAX_REGISTROS_PRUEBA = 2  # Cuántos registros por archivo en modo prueba

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
# 📡 FUNCIÓN PARA LLAMAR A TU API
# ============================================
def liquidar_cuotas_api(nombre_usuario, cuota_mes):
    """
    Llama a tu API para liquidar cuotas por mes
    """
    # 🆕 NORMALIZAR EL MES ANTES DE ENVIAR
    cuota_mes_normalizada = normalizar_mes_antes_enviar(cuota_mes)
    
    headers = {
        "Content-Type": "application/json",
    }
    
    payload = {
        "nombre_usuario": nombre_usuario,
        "cuota_mes": cuota_mes_normalizada,
    }
    
    try:
        print(f"   📤 Enviando a API: {nombre_usuario} - {cuota_mes_normalizada}")
        if cuota_mes != cuota_mes_normalizada:
            print(f"      🔧 Normalizado de: {cuota_mes}")
        
        # 🆕 MOSTRAR EL PAYLOAD COMPLETO
        print(f"      📦 Payload: {json.dumps(payload, ensure_ascii=False)}")
        
        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        
        # 🆕 SI ES 400, MOSTRAR LA RESPUESTA COMPLETA
        if response.status_code == 400:
            print(f"      ❌ 400 BAD REQUEST")
            print(f"      📄 Response body: {response.text}")
            try:
                error_data = response.json()
                print(f"      🔍 Error JSON: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
            except:
                pass
        
        # 🆕 SI ES 422, MOSTRAR LA RESPUESTA COMPLETA
        if response.status_code == 422:
            print(f"      ❌ 422 UNPROCESSABLE ENTITY")
            print(f"      📄 Response body: {response.text}")
            try:
                error_data = response.json()
                print(f"      🔍 Error JSON: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
            except:
                pass
        
        response.raise_for_status()
        return response.json()
        
    except requests.exceptions.HTTPError as e:
        error_msg = str(e)
        
        # 🆕 INTENTAR EXTRAER EL MENSAJE DE ERROR DEL BACKEND
        try:
            if e.response is not None:
                error_data = e.response.json()
                if 'message' in error_data:
                    error_msg = error_data['message']
                elif 'error' in error_data:
                    error_msg = error_data['error']
                
                # Retornar el error con toda la info
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
                    'estado': 'FALLIDO',
                    'mensaje': error_msg,
                    'data': None,
                    'full_error': resultado.get('full_error') if resultado else None
                })
    
    # ============================================
    # 📊 RESUMEN FINAL CON LOG DETALLADO
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
    
    # ============================================
    # 🆕 GUARDAR LOG DETALLADO DE ERRORES
    # ============================================
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 📄 Log general (como antes)
    log_filename = f"liquidacion_log_{timestamp}{'_PRUEBA' if MODO_PRUEBA else ''}.txt"
    log_path = os.path.join(CARPETA_EXCELS, log_filename)
    
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("RESUMEN DE LIQUIDACIÓN")
        if MODO_PRUEBA:
            f.write(" - MODO PRUEBA")
        f.write("\n")
        f.write("=" * 100 + "\n")
        f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total archivos: {total_archivos}\n")
        f.write(f"Total registros: {total_registros}\n")
        f.write(f"Exitosos: {total_exitosos}\n")
        f.write(f"Fallidos: {total_fallidos}\n")
        f.write("=" * 100 + "\n\n")
        
        # 🆕 SECCIÓN DE EXITOSOS
        f.write("\n" + "=" * 100 + "\n")
        f.write("✅ REGISTROS EXITOSOS\n")
        f.write("=" * 100 + "\n")
        exitosos_count = 0
        for resultado in resultados_detallados:
            if resultado['estado'] == 'EXITOSO':
                exitosos_count += 1
                f.write(f"\n{exitosos_count}. ✅ {resultado['cliente']}\n")
                f.write(f"   📅 Cuota mes: {resultado['cuota_mes']}\n")
                f.write(f"   📁 Archivo: {resultado['archivo']}\n")
                f.write(f"   💬 Mensaje: {resultado['mensaje']}\n")
                if resultado.get('data'):
                    data = resultado['data']
                    if data.get('total_cuotas_liquidadas'):
                        f.write(f"   📊 Cuotas liquidadas: {data['total_cuotas_liquidadas']}\n")
                    if data.get('creditos_procesados'):
                        f.write(f"   💳 Créditos procesados: {data['creditos_procesados']}\n")
                f.write("-" * 100 + "\n")
        
        # 🆕 SECCIÓN DE FALLIDOS CON MÁS DETALLE
        f.write("\n" + "=" * 100 + "\n")
        f.write("❌ REGISTROS FALLIDOS - DETALLE COMPLETO\n")
        f.write("=" * 100 + "\n")
        fallidos_count = 0
        for resultado in resultados_detallados:
            if resultado['estado'] == 'FALLIDO':
                fallidos_count += 1
                f.write(f"\n{fallidos_count}. ❌ FALLO DETECTADO\n")
                f.write(f"   👤 Cliente: {resultado['cliente']}\n")
                f.write(f"   📅 Cuota mes intentado: {resultado['cuota_mes']}\n")
                f.write(f"   📁 Archivo origen: {resultado['archivo']}\n")
                f.write(f"   🚨 Error completo:\n")
                f.write(f"      {resultado['mensaje']}\n")
                
                # 🆕 SI HAY ERROR DETALLADO DEL BACKEND, MOSTRARLO
                if resultado.get('full_error'):
                    f.write(f"   📋 Detalle del backend:\n")
                    f.write(f"      {json.dumps(resultado['full_error'], indent=6, ensure_ascii=False)}\n")
                
                f.write(f"   \n")
                f.write(f"   🔍 Posibles causas:\n")
                
                # 🆕 ANÁLISIS DEL ERROR
                error_lower = resultado['mensaje'].lower()
                
                if 'no se encontró ningún usuario' in error_lower or ('usuario' in error_lower and 'no' in error_lower and 'encontr' in error_lower):
                    f.write(f"      • El usuario '{resultado['cliente']}' NO existe en la base de datos\n")
                    f.write(f"      • Verificá que el nombre esté escrito correctamente\n")
                    f.write(f"      • Podría tener tildes o caracteres especiales diferentes\n")
                
                elif 'no tiene créditos' in error_lower or 'sin créditos' in error_lower:
                    f.write(f"      • El usuario existe pero NO tiene créditos registrados\n")
                    f.write(f"      • Verificá que los créditos estén cargados en la BD\n")
                
                elif 'no hay cuota que venza' in error_lower or 'no se encontró cuota' in error_lower:
                    f.write(f"      • El crédito existe pero NO tiene cuota para ese mes\n")
                    f.write(f"      • Verificá el formato del mes: '{resultado['cuota_mes']}'\n")
                    f.write(f"      • Verificá que las fechas de vencimiento estén correctas en la BD\n")
                
                elif 'timeout' in error_lower or 'conexión' in error_lower or 'connection' in error_lower:
                    f.write(f"      • Error de conexión con la API\n")
                    f.write(f"      • Verificá que el backend esté corriendo en {API_URL}\n")
                
                elif 'múltiples usuarios' in error_lower:
                    f.write(f"      • Hay varios usuarios con nombres similares\n")
                    f.write(f"      • Especificá mejor el nombre del usuario\n")
                
                elif 'formato' in error_lower or 'inválido' in error_lower:
                    f.write(f"      • El formato del mes no es válido\n")
                    f.write(f"      • Mes recibido: '{resultado['cuota_mes']}'\n")
                    f.write(f"      • Use formato 'mes. año' (ej: 'oct. 25')\n")
                
                else:
                    f.write(f"      • Error no clasificado\n")
                    f.write(f"      • Revisá el mensaje de error completo arriba\n")
                
                f.write("\n")
                f.write("-" * 100 + "\n")
    
    print(f"\n📄 Log general guardado en: {log_filename}")
    
    # 🆕 SI HAY FALLIDOS, CREAR LOG ADICIONAL SOLO DE ERRORES
    if total_fallidos > 0:
        error_log_filename = f"ERRORES_DETALLADOS_{timestamp}{'_PRUEBA' if MODO_PRUEBA else ''}.txt"
        error_log_path = os.path.join(CARPETA_EXCELS, error_log_filename)
        
        with open(error_log_path, 'w', encoding='utf-8') as f:
            f.write("🚨 " * 30 + "\n")
            f.write("REPORTE DE ERRORES - LIQUIDACIÓN DE CUOTAS\n")
            f.write("🚨 " * 30 + "\n\n")
            f.write(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Total errores: {total_fallidos} de {total_registros} registros\n")
            f.write(f"Tasa de error: {(total_fallidos/total_registros*100):.2f}%\n")
            f.write("=" * 100 + "\n\n")
            
            # 🆕 RESUMEN POR TIPO DE ERROR
            errores_por_tipo = {}
            for resultado in resultados_detallados:
                if resultado['estado'] == 'FALLIDO':
                    error_msg = resultado['mensaje'].lower()
                    
                    if 'no se encontró ningún usuario' in error_msg or ('usuario' in error_msg and 'no' in error_msg and 'encontr' in error_msg):
                        tipo = "Usuario no encontrado"
                    elif 'no tiene créditos' in error_msg or 'sin créditos' in error_msg:
                        tipo = "Usuario sin créditos"
                    elif 'no hay cuota que venza' in error_msg or 'no se encontró cuota' in error_msg:
                        tipo = "Cuota no encontrada para ese mes"
                    elif 'timeout' in error_msg or 'conexión' in error_msg or 'connection' in error_msg:
                        tipo = "Error de conexión"
                    elif 'múltiples usuarios' in error_msg:
                        tipo = "Múltiples usuarios encontrados"
                    elif 'formato' in error_msg or 'inválido' in error_msg:
                        tipo = "Formato de mes inválido"
                    elif '400' in str(resultado['mensaje']) or 'bad request' in error_msg:
                        tipo = "400 Bad Request (revisar backend)"
                    elif '422' in str(resultado['mensaje']) or 'unprocessable' in error_msg:
                        tipo = "422 Unprocessable Entity (revisar formato)"
                    else:
                        tipo = "Otro error"
                    
                    if tipo not in errores_por_tipo:
                        errores_por_tipo[tipo] = []
                    errores_por_tipo[tipo].append(resultado)
            
            # Escribir resumen
            f.write("📊 RESUMEN POR TIPO DE ERROR:\n")
            f.write("=" * 100 + "\n")
            for tipo, casos in errores_por_tipo.items():
                porcentaje = (len(casos) / total_fallidos * 100)
                f.write(f"\n🔴 {tipo}: {len(casos)} caso(s) ({porcentaje:.1f}% de los errores)\n")
            f.write("\n" + "=" * 100 + "\n\n")
            
            # 🆕 DETALLE POR TIPO
            for tipo, casos in errores_por_tipo.items():
                f.write("\n" + "🔴 " * 40 + "\n")
                f.write(f"TIPO DE ERROR: {tipo.upper()}\n")
                f.write(f"Total casos: {len(casos)}\n")
                f.write("🔴 " * 40 + "\n\n")
                
                for idx, caso in enumerate(casos, 1):
                    f.write(f"{idx}. Cliente: {caso['cliente']}\n")
                    f.write(f"   Mes: {caso['cuota_mes']}\n")
                    f.write(f"   Archivo: {caso['archivo']}\n")
                    f.write(f"   Error: {caso['mensaje']}\n")
                    
                    # 🆕 MOSTRAR ERROR DETALLADO SI EXISTE
                    if caso.get('full_error'):
                        f.write(f"   Detalle backend:\n")
                        f.write(f"   {json.dumps(caso['full_error'], indent=3, ensure_ascii=False)}\n")
                    
                    f.write("-" * 100 + "\n")
            
            # 🆕 LISTA RÁPIDA PARA COPIAR/PEGAR
            f.write("\n\n" + "📋 " * 40 + "\n")
            f.write("LISTA RÁPIDA DE CLIENTES CON ERROR (para Excel)\n")
            f.write("📋 " * 40 + "\n\n")
            f.write("CLIENTE\tMES\tTIPO_ERROR\tARCHIVO\n")
            for resultado in resultados_detallados:
                if resultado['estado'] == 'FALLIDO':
                    error_msg = resultado['mensaje'].lower()
                    if 'no se encontró ningún usuario' in error_msg or ('usuario' in error_msg and 'no' in error_msg and 'encontr' in error_msg):
                        tipo = "Usuario no existe"
                    elif 'no tiene créditos' in error_msg or 'sin créditos' in error_msg:
                        tipo = "Sin créditos"
                    elif 'no hay cuota que venza' in error_msg:
                        tipo = "Cuota no encontrada"
                    elif 'timeout' in error_msg or 'conexión' in error_msg:
                        tipo = "Error conexión"
                    elif '400' in str(resultado['mensaje']):
                        tipo = "400 Bad Request"
                    elif '422' in str(resultado['mensaje']):
                        tipo = "422 Unprocessable"
                    else:
                        tipo = "Otro"
                    
                    f.write(f"{resultado['cliente']}\t{resultado['cuota_mes']}\t{tipo}\t{resultado['archivo']}\n")
        
        print(f"🚨 Log de ERRORES DETALLADO guardado en: {error_log_filename}")
        print(f"   👉 Revisá este archivo para ver el análisis completo de los fallos")

# ============================================
# 🚀 EJECUTAR
# ============================================
if __name__ == "__main__":
    procesar_liquidaciones()