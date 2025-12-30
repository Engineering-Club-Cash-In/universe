import os
import pandas as pd
import requests
from datetime import datetime
import json

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_URL = "http://localhost:7000/liquidar-cuotas"
API_INVERSIONISTA_URL = "http://localhost:7000/investor"
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
# 🧹 NORMALIZAR TIPO DE CUENTA
# ============================================
def normalizar_tipo_cuenta(valor):
    """Normaliza el tipo de cuenta según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    tipo = str(valor).strip().upper()
    
    # 🔥 IGNORAR si contiene palabras que NO son tipo de cuenta
    palabras_ignorar = ['AMORTIZACIÓN', 'AMORTIZACION', 'RESTANTE', 'CAPITAL RESTANTE', 
                        'NETO', 'TOTAL', 'GRAN TOTAL', 'INVERSOR', 'INVERSIONISTA']
    
    if any(palabra in tipo for palabra in palabras_ignorar):
        return None
    
    # Mapeo de variaciones a valores válidos del enum
    mapeo = {
        "AHORRO": "AHORRO",
        "AHORROS": "AHORROS",
        "AHORRO Q": "AHORRO Q",
        "AHORRO $": "AHORRO $",
        "MONETARIA": "MONETARIA",
        "MONETARIÁ": "MONETARIA",  # Por si tiene tilde
        "MONETARIA Q": "MONETARIA Q",
        "MONETARIO Q": "MONETARIA Q",  # ← FIX
        "MONETARIA $": "MONETARIA $",
        "MONETARIO $": "MONETARIA $",  # ← FIX
        "CAPITAL": "Capital",  # 🔥 OJO: "Capital" con mayúscula inicial
    }
    
    tipo_normalizado = mapeo.get(tipo)
    
    if tipo_normalizado:
        return tipo_normalizado
    
    # Intentar normalizar común
    if "MONETARI" in tipo and len(tipo) < 20:  # Evitar textos largos
        if "$" in tipo:
            return "MONETARIA $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "MONETARIA Q"
        else:
            return "MONETARIA"
    
    if "AHORR" in tipo and len(tipo) < 20:
        if "$" in tipo:
            return "AHORRO $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "AHORRO Q"
        elif tipo.endswith("S"):
            return "AHORROS"
        else:
            return "AHORRO"
    
    # 🔥 Si dice solo "CAPITAL" y no tiene otras palabras
    if tipo == "CAPITAL":
        return "Capital"
    
    # Si no se puede normalizar, retornar None
    return None
# ============================================
# 🧹 NORMALIZAR BANCO
# ============================================
def normalizar_banco(valor):
    """Normaliza el nombre del banco según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    banco = str(valor).strip().upper()
    
    # Mapeo de variaciones comunes
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
    
    # Si contiene "GYT" o "G&T"
    if "GYT" in banco or "G&T" in banco:
        return "GyT"
    
    print(f"⚠️  Banco desconocido: '{valor}' - se enviará como None")
    return None

# ============================================
# 🧹 LIMPIAR NÚMERO DE CUENTA
# ============================================
def limpiar_numero_cuenta(valor):
    """Limpia y formatea el número de cuenta"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    cuenta_str = str(valor).strip()
    
    # Remover comillas invertidas, backticks y espacios extras
    cuenta_str = cuenta_str.replace('´', '').replace('`', '').replace('"', '').strip()
    
    # Remover asteriscos y otros caracteres especiales si existen
    cuenta_str = cuenta_str.replace('*', '').strip()
    
    # Si está vacío después de limpiar, retornar None
    if not cuenta_str or cuenta_str.lower() in ['nan', 'null', 'none']:
        return None
    
    return cuenta_str

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
# 🆕 FUNCIÓN PARA EXTRAER DATOS DEL INVERSIONISTA DEL EXCEL
# ============================================
# 🆕 FUNCIÓN MEJORADA PARA EXTRAER DATOS DEL INVERSIONISTA
# ============================================
def extraer_datos_inversionista_del_excel(archivo_path):
    """
    Extrae los datos del inversionista del encabezado del Excel
    🔥 BUSCA EN COLUMNAS ESPECÍFICAS (B, C, D para INVERSIONISTA/FACTURACIÓN)
    🔥 BUSCA EN COLUMNAS ESPECÍFICAS (G, H, I para BANCO/TIPO CUENTA/NÚMERO)
    """
    nombre_inversionista = extraer_nombre_inversionista(os.path.basename(archivo_path))
    
    try:
        # Leer la primera hoja para buscar los datos bancarios en el header
        xls = pd.ExcelFile(archivo_path, engine='openpyxl')
        ultima_hoja = xls.sheet_names[-1]
        
        # Leer las primeras 10 filas sin header para buscar los datos
        df_header = pd.read_excel(archivo_path, sheet_name=ultima_hoja, engine='openpyxl', header=None, nrows=10)
        
        datos_inversionista = {
            "nombre": nombre_inversionista,
            "emite_factura": False,  # Default
            "reinversion": False,     # Default
            "banco": None,
            "tipo_cuenta": None,
            "numero_cuenta": None
        }
        
        print(f"\n   🔍 BUSCANDO DATOS EN EL HEADER...")
        
        # ============================================
        # 🔥 BUSCAR EN LA PRIMERA FILA (row 0)
        # ============================================
        # La estructura típica es:
        # Columna B (idx 1): INVERSIONISTA:
        # Columna C (idx 2): Nombre del inversionista
        # Columna D (idx 3): FACTURACIÓN:
        # Columna E (idx 4): Propia/Ajena
        # Columna G (idx 6): Banco
        # Columna H (idx 7): Tipo cuenta
        # Columna I (idx 8): Número de cuenta
        
        primera_fila = df_header.iloc[0] if len(df_header) > 0 else None
        
        if primera_fila is not None:
            # FACTURACIÓN (columnas D o E típicamente)
            for idx in range(min(6, len(primera_fila))):  # Buscar en las primeras 6 columnas
                cell = primera_fila.iloc[idx] if idx < len(primera_fila) else None
                if pd.notna(cell):
                    cell_str = str(cell).strip().upper()
                    if 'PROPIA' in cell_str:
                        datos_inversionista["emite_factura"] = True
                        print(f"      ✅ Facturación: PROPIA (col {idx}, emite_factura = true)")
                        break
                    elif 'AJENA' in cell_str:
                        datos_inversionista["emite_factura"] = False
                        print(f"      ✅ Facturación: AJENA (col {idx}, emite_factura = false)")
                        break
            
            # BANCO (columna G = índice 6)
            if len(primera_fila) > 6:
                banco_cell = primera_fila.iloc[6]
                if pd.notna(banco_cell):
                    banco_normalizado = normalizar_banco(str(banco_cell).strip())
                    if banco_normalizado:
                        datos_inversionista["banco"] = banco_normalizado
                        print(f"      🏦 Banco encontrado (col G): {banco_normalizado}")
            
            # TIPO DE CUENTA (columna H = índice 7)
            if len(primera_fila) > 7:
                tipo_cuenta_cell = primera_fila.iloc[7]
                if pd.notna(tipo_cuenta_cell):
                    tipo_cuenta_str = str(tipo_cuenta_cell).strip()
                    # 🔥 VALIDAR que sea un tipo válido y no sea un header
                    if tipo_cuenta_str.upper() not in ['MONETARIA', 'MONETARIÁ', 'AHORRO', 'AHORROS', 'CAPITAL']:
                        # Intentar normalizar
                        tipo_normalizado = normalizar_tipo_cuenta(tipo_cuenta_str)
                        if tipo_normalizado:
                            datos_inversionista["tipo_cuenta"] = tipo_normalizado
                            print(f"      💳 Tipo cuenta encontrado (col H): {tipo_normalizado}")
                    else:
                        # Es una palabra clave válida
                        tipo_normalizado = normalizar_tipo_cuenta(tipo_cuenta_str)
                        if tipo_normalizado:
                            datos_inversionista["tipo_cuenta"] = tipo_normalizado
                            print(f"      💳 Tipo cuenta encontrado (col H): {tipo_normalizado}")
            
            # NÚMERO DE CUENTA (columna I = índice 8)
            if len(primera_fila) > 8:
                numero_cuenta_cell = primera_fila.iloc[8]
                if pd.notna(numero_cuenta_cell):
                    numero_str = str(numero_cuenta_cell).strip()
                    # 🔥 VALIDAR que sea un número de cuenta válido (no un texto)
                    # Debe tener al menos 8 caracteres y contener dígitos
                    if len(numero_str) >= 8 and any(char.isdigit() for char in numero_str):
                        # 🔥 NO debe ser un número decimal grande (montos)
                        try:
                            num_float = float(numero_str.replace(',', ''))
                            # Si es mayor a 1,000,000 probablemente es un monto, no una cuenta
                            if num_float < 1000000:
                                numero_limpio = limpiar_numero_cuenta(numero_str)
                                if numero_limpio:
                                    datos_inversionista["numero_cuenta"] = numero_limpio
                                    print(f"      🔢 Número cuenta encontrado (col I): {numero_limpio}")
                        except:
                            # No es un número, intentar limpiar como string
                            numero_limpio = limpiar_numero_cuenta(numero_str)
                            if numero_limpio:
                                datos_inversionista["numero_cuenta"] = numero_limpio
                                print(f"      🔢 Número cuenta encontrado (col I): {numero_limpio}")
        
        return datos_inversionista
        
    except Exception as e:
        print(f"   ⚠️ Error extrayendo datos del inversionista: {e}")
        import traceback
        traceback.print_exc()
        # Retornar datos mínimos
        return {
            "nombre": nombre_inversionista,
            "emite_factura": False,
            "reinversion": False,
            "banco": None,
            "tipo_cuenta": None,
            "numero_cuenta": None
        }

# ============================================
# 🆕 FUNCIÓN PARA HACER UPSERT DEL INVERSIONISTA
# ============================================
def upsert_inversionista_api(datos_inversionista):
    """
    Hace UPSERT del inversionista en la API antes de procesar liquidaciones
    """
    headers = {
        "Content-Type": "application/json",
    }
    
    try:
        print(f"\n   📤 Haciendo UPSERT del inversionista: {datos_inversionista['nombre']}")
        print(f"      📄 Emite factura: {datos_inversionista['emite_factura']}")
        print(f"      🏦 Banco: {datos_inversionista['banco'] or 'N/A'}")
        print(f"      💳 Tipo cuenta: {datos_inversionista['tipo_cuenta'] or 'N/A'}")
        print(f"      🔢 Número cuenta: {datos_inversionista['numero_cuenta'] or 'N/A'}")
        
        response = requests.post(
            API_INVERSIONISTA_URL, 
            json=datos_inversionista, 
            headers=headers, 
            timeout=30
        )
        
        if response.status_code in [200, 201]:
            print(f"      ✅ Inversionista upserted correctamente")
            return {"success": True, "data": response.json()}
        else:
            print(f"      ⚠️ Error en upsert del inversionista (Status {response.status_code})")
            print(f"      📄 Response: {response.text}")
            return {"success": False, "message": response.text}
            
    except requests.exceptions.RequestException as e:
        print(f"      ❌ Error llamando a la API de inversionistas: {e}")
        return {"success": False, "message": str(e)}

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
    🔥 PRIMERO hace UPSERT del inversionista
    """
    print(f"\n📄 Procesando: {os.path.basename(archivo_path)}")
    
    # ============================================
    # 🔥 PASO 1: EXTRAER Y UPSERT INVERSIONISTA
    # ============================================
    datos_inversionista = extraer_datos_inversionista_del_excel(archivo_path)
    
    print(f"\n   👤 DATOS DEL INVERSIONISTA:")
    print(f"      Nombre: {datos_inversionista['nombre']}")
    print(f"      Emite factura: {datos_inversionista['emite_factura']}")
    print(f"      Banco: {datos_inversionista['banco'] or 'N/A'}")
    print(f"      Tipo cuenta: {datos_inversionista['tipo_cuenta'] or 'N/A'}")
    print(f"      Número cuenta: {datos_inversionista['numero_cuenta'] or 'N/A'}")
    
    # HACER UPSERT DEL INVERSIONISTA
    resultado_upsert = upsert_inversionista_api(datos_inversionista)
    
    if not resultado_upsert.get('success'):
        print(f"\n   ⚠️ No se pudo hacer upsert del inversionista")
        print(f"   ⚠️ Se continuará con el procesamiento pero puede fallar")
    
    # ============================================
    # 🔥 PASO 2: PROCESAR LIQUIDACIONES
    # ============================================
    nombre_inversionista = datos_inversionista['nombre']
    
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
                cliente_invalido = any(x in cliente.lower() for x in palabras_invalidas)
                
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
    print(f"🔗 API Liquidación: {API_URL}")
    print(f"🔗 API Inversionistas: {API_INVERSIONISTA_URL}")
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