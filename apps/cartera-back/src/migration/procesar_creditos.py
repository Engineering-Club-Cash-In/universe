import os
import pandas as pd
import requests
from typing import List, Dict, Any
from collections import defaultdict

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 📅 Hojas a procesar (orden cronológico inverso - más reciente primero)
HOJAS_A_PROCESAR = [   
    "Diciembre 2025", 
]

# 🔥 MODO PRUEBA
MODO_PRUEBA = False
LIMITE_CREDITOS_PRUEBA = 2

# ============================================
# 🗺️ MAPEO DE COLUMNAS EXCEL → API
# ============================================
MAPEO_COLUMNAS = {
    'Fecha': 'Fecha',
    '# crédito SIFCO': 'CreditoSIFCO',
    '#': 'Numero',
    'Nombre': 'Nombre',
    'Capital': 'Capital',
    '%': 'porcentaje',
    'Cuotas': 'Cuotas',
    'Deuda Q': 'DeudaQ',
    'IVA 12%': 'IVA12',
    '% Cash-In': 'PorcentajeCashIn',
    '% Inversionista': 'PorcentajeInversionista',
    'Cuota Cash-IN': 'CuotaCashIn',
    'IVA Cash-In': 'IVACashIn',
    'Cuota Inverionista': 'CuotaInversionista',
    'IVA Inversionista': 'IVAInversionista',
    'Seguro (10 cuotas)': 'Seguro10Cuotas',
    'GPS': 'GPS',
    'Abono capital': 'AbonoCapital',
    'Abono Interés': 'AbonoInteres',
    'Abono IVA 12%': 'AbonoIVA12',
    'Abono interés CI': 'AbonoInteresCI',
    'Abono IVA CI': 'AbonoIVACI',
    'Abono Seguro': 'AbonoSeguro',
    'Abono GPS': 'AbonoGPS',
    'Pago del mes': 'PagoDelMes',
    'Capital restante': 'CapitalRestante',
    'Interés restante': 'InteresRestante',
    'IVA 12% restante': 'IVA12Restante',
    'Seguro Restante': 'SeguroRestante',
    'GPS Restante': 'GPSRestante',
    'Total restante': 'TotalRestante',
    'Llamada': 'Llamada',
    'Pago': 'Pago',
    'NIT': 'NIT',
    'Categoría': 'Categoria',
    'Inversionista': 'Inversionista',
    'Observaciones': 'Observaciones',
    'Cuota': 'Cuota',
    'Monto boleta': 'MontoBoleta',
    'Fecha filtro': 'FechaFiltro',
    'No. Póliza': 'NumeroPoliza',
    'Comisión de venta': 'ComisionVenta',
    'Acumulado Comisión de Venta': 'AcumuladoComisionVenta',
    'Comisiones del mes Cash-In': 'ComisionesMesCashIn',
    'Comisiones cobradas del mes Cash-In': 'ComisionesCobradasMesCashIn',
    'Acumulado comisiones Cash-In': 'AcumuladoComisionesCashIn',
    'Acumulado comisiones cobradas Cash-In': 'AcumuladoComisionesCobradasCashIn',
    'Renuevo ó Nuevo': 'RenuevoONuevo',
    'Capital Nuevos créditos': 'CapitalNuevosCreditos',
    '% Royalty': 'PorcentajeRoyalty',
    'Royalty': 'Royalty',
    'U$ Royalty': 'USRoyalty',
    'Membresías': 'Membresias',
    'Membresías pago': 'MembresiasPago',
    'Gastos del mes': 'GastosMes',
    'Utilidad del mes': 'UtilidadMes',
    'Utilidad acumulada': 'UtilidadAcumulada',
    'Como se enteró de nosotros': 'ComoSeEntero',
    'Membresías del mes': 'MembresiasDelMes',
    'Membresías del mes cobradas': 'MembresiasDelMesCobradas',
    'Membresías acumulado': 'MembresiasAcumulado',
    'Asesor': 'Asesor',
    'Otros': 'Otros',
    'Mora': 'Mora',
    'Monto boleta - cuota': 'MontoBoletaCuota',
    'Plazo': 'Plazo',
    'Seguro': 'Seguro',
    'Formato crédito': 'FormatoCredito',
    'Pagado': 'Pagado',
    'Facturacion': 'Facturacion',
    'Mes pagado': 'MesPagado',
    'Seguro Facturado': 'SeguroFacturado',
    'GPS Facturado': 'GPSFacturado',
    'Reserva': 'Reserva',
}

CAMPOS_NUMERICOS = {'Numero'}

def convertir_valor(nombre_campo: str, valor: Any) -> Any:
    if pd.isna(valor) or valor == '':
        return 0 if nombre_campo in CAMPOS_NUMERICOS else ''
    
    if nombre_campo in CAMPOS_NUMERICOS:
        try:
            num = float(valor)
            return int(num) if num.is_integer() else num
        except (ValueError, TypeError):
            return 0
    
    return str(valor).strip() if isinstance(valor, (int, float)) else str(valor).strip()

# ============================================
# 🎯 DETECTAR POOLS RAROS
# ============================================
def detectar_pools_raros(df: pd.DataFrame, col_credito: str, col_nombre: str, col_formato: str) -> List[str]:
    """
    Retorna lista de números de crédito que son POOLS RAROS
    """
    print(f"\n🔍 Detectando pools raros...")
    
    # Filtrar solo pools
    df_pools = df[
        df[col_formato].astype(str).str.lower().str.strip().str.contains('pool', na=False)
    ]
    
    if len(df_pools) == 0:
        print(f"   ℹ️  No hay pools marcados como 'pool' en esta hoja")
        return []
    
    # Agrupar por cliente
    clientes_agrupados = defaultdict(list)
    
    for idx, row in df_pools.iterrows():
        credito_raw = str(row[col_credito]).strip()
        if not credito_raw or credito_raw == 'nan':
            continue
        
        nombre_cliente = str(row[col_nombre]).strip()
        clientes_agrupados[nombre_cliente].append(credito_raw)
    
    # Detectar pools raros
    creditos_pool_raro = []
    
    for cliente, creditos in clientes_agrupados.items():
        # Separar base y variaciones
        creditos_base = [c for c in creditos if '_' not in c]
        creditos_variaciones = [c for c in creditos if '_' in c]
        
        if len(creditos_base) < 2:
            continue
        
        # Verificar que ningún base tenga variación
        bases_con_variacion = []
        for base in creditos_base:
            tiene_variacion = any(
                var.startswith(base + '_')
                for var in creditos_variaciones
            )
            if tiene_variacion:
                bases_con_variacion.append(base)
        
        # Si NO tiene variaciones = POOL RARO
        if len(bases_con_variacion) == 0:
            print(f"   ✅ POOL RARO detectado: {cliente} → {len(creditos_base)} créditos sin variaciones")
            for cred in creditos_base:
                print(f"      - {cred}")
            creditos_pool_raro.extend(creditos_base)
    
    if len(creditos_pool_raro) == 0:
        print(f"   ✅ No se encontraron pools raros")
    else:
        print(f"   🔥 Total pools raros: {len(creditos_pool_raro)} créditos")
    
    return creditos_pool_raro

# ============================================
# 📖 FUNCIÓN PARA LEER UNA HOJA Y AGRUPAR
# ============================================
def leer_hoja_excel(
    archivo_path: str,
    nombre_hoja: str
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja específica del Excel y agrupa filas por crédito.
    Detecta pools raros y los convierte automáticamente.
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
            if 'credito' in row_str or 'sifco' in row_str:
                header_row = idx
                print(f"✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"⚠️ No se encontraron headers en la hoja {nombre_hoja}")
            return {}
        
        # Leer con headers correctos
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        df.columns = df.columns.str.strip()
        
        print(f"✅ Columnas encontradas: {len(df.columns)}")
        
        # Buscar columnas clave
        col_credito = None
        col_nombre = None
        col_formato = None
        
        for col in df.columns:
            col_normalizado = str(col).lower().replace('#', '').replace('crédito', 'credito').strip()
            
            if not col_credito and 'credito' in col_normalizado and 'sifco' in col_normalizado:
                col_credito = col
                print(f"✅ Columna crédito: '{col}'")
            
            if not col_nombre and 'nombre' in col_normalizado and 'formato' not in col_normalizado:
                col_nombre = col
                print(f"✅ Columna nombre: '{col}'")
            
            if not col_formato and 'formato' in col_normalizado and 'credito' in col_normalizado:
                col_formato = col
                print(f"✅ Columna formato: '{col}'")
        
        if not col_credito:
            print(f"❌ No se encontró columna de CréditoSIFCO")
            return {}
        
        if not col_nombre:
            print(f"⚠️ No se encontró columna de Nombre/Cliente")
        
        if not col_formato:
            print(f"⚠️ No se encontró columna de Formato crédito")
        
        # Limpiar DataFrame
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')
        
        print(f"✅ Filas válidas encontradas: {len(df_clean)}")
        
        # 🔥 DETECTAR POOLS RAROS (si existe columna formato)
        creditos_pool_raro = []
        if col_formato:
            creditos_pool_raro = detectar_pools_raros(df_clean, col_credito, col_nombre, col_formato)
        
        # 🆕 MAPEAR CRÉDITOS POR CLIENTE (para pools raros)
        clientes_creditos = defaultdict(list)
        mapeo_variaciones = {}
        
        if creditos_pool_raro:
            print(f"\n🔧 Creando mapeo de variaciones para pools raros...")
            
            for idx, row in df_clean.iterrows():
                numero_credito_raw = str(row[col_credito]).strip()
                
                if numero_credito_raw not in creditos_pool_raro:
                    continue
                
                cliente = str(row[col_nombre]).strip() if col_nombre and row[col_nombre] else "Cliente Desconocido"
                if numero_credito_raw not in clientes_creditos[cliente]:
                    clientes_creditos[cliente].append(numero_credito_raw)
            
            # Crear mapeo de variaciones
            for cliente, creditos in clientes_creditos.items():
                creditos_ordenados = sorted(set(creditos))
                
                print(f"\n   🔧 Cliente: {cliente}")
                print(f"      Créditos pool raro: {creditos_ordenados}")
                
                # El primero es la base
                base = creditos_ordenados[0]
                mapeo_variaciones[base] = base
                print(f"      ✅ Base: {base}")
                
                # Los demás se convierten en variaciones
                for idx, credito in enumerate(creditos_ordenados[1:], start=1):
                    variacion = f"{base}_{idx}"
                    mapeo_variaciones[credito] = variacion
                    print(f"      🔄 {credito} → {variacion}")
            
            print(f"\n{'─'*70}\n")
        
        # 🎯 AGRUPAR FILAS
        creditos_data = {}
        
        for idx, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            
            if not numero_credito_raw or numero_credito_raw == '':
                continue
            
            cliente = str(row[col_nombre]).strip() if col_nombre and row[col_nombre] else "Cliente Desconocido"
            
            # 🔥 DETERMINAR EL CRÉDITO FINAL
            if numero_credito_raw in mapeo_variaciones:
                # Es un pool raro, usar el mapeo
                numero_credito_final = mapeo_variaciones[numero_credito_raw]
                # La base es el crédito sin variación
                numero_credito_base = numero_credito_final.split('_')[0]
            else:
                # No es pool raro, usar lógica normal
                numero_credito_final = numero_credito_raw
                numero_credito_base = numero_credito_raw.split('_')[0]
            
            # Agrupar por base
            if numero_credito_base not in creditos_data:
                creditos_data[numero_credito_base] = {
                    'creditoBase': numero_credito_base,
                    'cliente': cliente,
                    'filas': []
                }
            
            # Convertir fila con mapeo
            fila_dict = {}
            for col in df.columns:
                valor = row[col]
                nombre_campo = MAPEO_COLUMNAS.get(col, col)
                fila_dict[nombre_campo] = convertir_valor(nombre_campo, valor)
            
            # 🔥 SOBRESCRIBIR el CreditoSIFCO con el número final (puede tener variación)
            fila_dict['CreditoSIFCO'] = numero_credito_final
            
            creditos_data[numero_credito_base]['filas'].append(fila_dict)
        
        print(f"✅ Créditos únicos agrupados: {len(creditos_data)}")
        
        # Mostrar estadísticas
        pools_normales = 0
        pools_raros_convertidos = 0
        individuales = 0
        
        for credito_key, credito_data in creditos_data.items():
            num_filas = len(credito_data['filas'])
            
            # Contar cuántas filas tienen variaciones
            filas_con_variacion = sum(1 for f in credito_data['filas'] if '_' in str(f.get('CreditoSIFCO', '')))
            
            if num_filas > 1:
                # Ver si alguna fila era pool raro
                es_pool_raro_convertido = any(
                    str(f.get('CreditoSIFCO', '')).split('_')[0] in creditos_pool_raro
                    for f in credito_data['filas']
                )
                
                if es_pool_raro_convertido:
                    pools_raros_convertidos += 1
                else:
                    pools_normales += 1
            else:
                individuales += 1
        
        print(f"\n📊 Estadísticas:")
        print(f"   🔵 Créditos individuales: {individuales}")
        print(f"   🟢 Pools normales (con _1, _2): {pools_normales}")
        print(f"   🟡 Pools raros convertidos: {pools_raros_convertidos}")
        
        # Mostrar ejemplos
        print(f"\n📋 Primeros 3 créditos:")
        for credito_key, credito_data in list(creditos_data.items())[:3]:
            creditos_en_pool = set(f.get('CreditoSIFCO', '') for f in credito_data['filas'])
            print(f"   📋 {credito_data['creditoBase']}: {credito_data['cliente']}")
            print(f"      Filas: {len(credito_data['filas'])}")
            print(f"      Créditos: {', '.join(sorted(creditos_en_pool))}")
        
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
def enviar_credito_a_api(credito_data: Dict[str, Any], api_endpoint: str) -> Dict:
    """Envía un crédito agrupado al endpoint de Elysia"""
    
    print(f"\n   🚀 Enviando crédito a API...")
    print(f"      - Crédito: {credito_data['creditoBase']}")
    print(f"      - Cliente: {credito_data['cliente']}")
    print(f"      - Filas: {len(credito_data['filas'])}")
    
    # Mostrar si tiene variaciones
    creditos_en_pool = set(f.get('CreditoSIFCO', '') for f in credito_data['filas'])
    if len(creditos_en_pool) > 1:
        print(f"      - Pool con: {', '.join(sorted(creditos_en_pool))}")
    
    payload = {
        "credito": credito_data
    }
    
    try:
        response = requests.post(
            api_endpoint,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120
        )
        
        print(f"\n   📡 Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"   ❌ Response Text: {response.text[:500]}")
        
        response.raise_for_status()
        resultado = response.json()
        
        print(f"   ✅ Respuesta de API:")
        print(f"      - Success: {resultado.get('success', False)}")
        
        # Mostrar campos relevantes según el tipo de respuesta
        if 'status' in resultado:
            print(f"      - Status: {resultado.get('status', 'N/A')}")
        
        if not resultado.get('success'):
            print(f"      - Error: {resultado.get('error', 'N/A')}")
        else:
            if 'credito_id' in resultado:
                print(f"      - Crédito ID: {resultado.get('credito_id', 'N/A')}")
            if 'inversionistas_procesados' in resultado:
                print(f"      - Inversionistas procesados: {resultado.get('inversionistas_procesados', 'N/A')}")
        
        return resultado
        
    except requests.exceptions.ConnectionError:
        print(f"   ❌ API no disponible - ¿Está corriendo el backend en puerto 7000?")
        return {"success": False, "status": "error_conexion", "error": "API no disponible"}
    except requests.exceptions.Timeout:
        print(f"   ❌ Timeout - La API tardó mucho en responder")
        return {"success": False, "status": "timeout", "error": "Timeout"}
    except requests.exceptions.HTTPError as e:
        print(f"   ❌ Error HTTP: {e}")
        return {"success": False, "status": "error_http", "error": str(e)}
    except Exception as e:
        print(f"   ❌ Error inesperado: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "status": "error_general", "error": str(e)}

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_multiples_hojas(api_endpoint: str, modo_nombre: str):
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🔥 MODO COMPLETO"
    
    print(f"\n{'='*70}")
    print(f"{modo_texto} - {modo_nombre}")
    print(f"{'='*70}")
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"📄 Archivo: {ARCHIVO_EXCEL}")
    print(f"🔗 API: {api_endpoint}")
    print(f"📅 Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    
    if MODO_PRUEBA:
        print(f"⚡ Límite por hoja: {LIMITE_CREDITOS_PRUEBA} crédito(s)")
    
    print(f"{'='*70}\n")
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
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
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'creditos_no_encontrados': 0,
    }
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            print(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            print(f"⚠️ No se encontraron datos en la hoja {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        
        creditos_a_procesar = list(creditos_data.values())
        if MODO_PRUEBA:
            creditos_a_procesar = creditos_a_procesar[:LIMITE_CREDITOS_PRUEBA]
            print(f"\n🧪 MODO PRUEBA: Procesando solo {len(creditos_a_procesar)} crédito(s)")
        
        for credito_data in creditos_a_procesar:
            print(f"\n{'─'*70}")
            print(f"📋 Procesando: {credito_data['creditoBase']} - {credito_data['cliente']}")
            
            resultado = enviar_credito_a_api(credito_data, api_endpoint)
            
            stats_globales['creditos_procesados'] += 1
            
            if resultado.get('success'):
                stats_globales['creditos_exitosos'] += 1
            elif resultado.get('status') == 'no_encontrado':
                stats_globales['creditos_no_encontrados'] += 1
            else:
                stats_globales['creditos_fallidos'] += 1
            
            print(f"{'─'*70}")
    
    print(f"\n{'='*70}")
    print(f"🎉 RESUMEN FINAL")
    print(f"{'='*70}")
    print(f"📊 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    print(f"📋 Créditos procesados: {stats_globales['creditos_procesados']}")
    print(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    print(f"   ⏭️  No encontrados: {stats_globales['creditos_no_encontrados']}")
    print(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    print(f"{'='*70}\n")

# ============================================
# 🎯 MENÚ PRINCIPAL
# ============================================
def mostrar_menu():
    """Muestra el menú de opciones y retorna la selección del usuario"""
    print(f"\n{'='*70}")
    print("🔥 PROCESADOR DE EXCEL - CASH-IN")
    print(f"{'='*70}")
    print("\n📋 Seleccioná el modo de procesamiento:\n")
    print("   1️⃣  Procesar CRÉDITOS COMPLETOS (con SIFCO + Inversionistas)")
    print("      └─ Endpoint: /processUniqueCredit")
    print("      └─ Consulta SIFCO, crea/actualiza crédito e inversionistas\n")
    print("   2️⃣  Procesar SOLO INVERSIONISTAS (crédito debe existir)")
    print("      └─ Endpoint: /processInvestorsOnly")
    print("      └─ NO toca SIFCO, solo actualiza inversionistas del crédito\n")
    print("   0️⃣  Salir\n")
    print(f"{'='*70}")
    
    while True:
        opcion = input("\n👉 Ingresá tu opción (1/2/0): ").strip()
        
        if opcion in ['1', '2', '0']:
            return opcion
        else:
            print("❌ Opción inválida. Por favor ingresá 1, 2 o 0.")

# ============================================
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    print("🔥 Procesador Unificado - Pools Normales y Raros")
    print("⚠️  Asegurate que tu backend Elysia esté corriendo en el puerto 7000\n")
    
    if MODO_PRUEBA:
        print(f"🧪 MODO PRUEBA ACTIVADO")
        print(f"   - Solo se procesará {LIMITE_CREDITOS_PRUEBA} crédito(s) por hoja")
        print(f"   - Para procesar todos, cambiá MODO_PRUEBA = False en el código\n")
    
    try:
        while True:
            opcion = mostrar_menu()
            
            if opcion == '0':
                print("\n👋 ¡Hasta luego!")
                break
            
            elif opcion == '1':
                print("\n✅ Seleccionaste: PROCESAR CRÉDITOS COMPLETOS")
                api_endpoint = "http://localhost:7000/processUniqueCredit"
                modo_nombre = "Créditos Completos (SIFCO + Inversionistas)"
                
                input("\n📌 Presiona ENTER para continuar...")
                procesar_multiples_hojas(api_endpoint, modo_nombre)
                
                input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
            
            elif opcion == '2':
                print("\n✅ Seleccionaste: PROCESAR SOLO INVERSIONISTAS")
                api_endpoint = "http://localhost:7000/processInvestorsOnly"
                modo_nombre = "Solo Inversionistas (sin SIFCO)"
                
                print("\n⚠️  IMPORTANTE:")
                print("   - Los créditos DEBEN existir en la base de datos")
                print("   - Solo se actualizarán los inversionistas")
                print("   - NO se consultará SIFCO\n")
                
                confirmacion = input("¿Estás seguro de continuar? (s/n): ").strip().lower()
                
                if confirmacion == 's':
                    procesar_multiples_hojas(api_endpoint, modo_nombre)
                    input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
                else:
                    print("\n❌ Operación cancelada")
            
    except KeyboardInterrupt:
        print("\n\n⚠️ Proceso interrumpido por el usuario")
    except Exception as e:
        print(f"\n❌ Error fatal: {e}")
        import traceback
        traceback.print_exc()