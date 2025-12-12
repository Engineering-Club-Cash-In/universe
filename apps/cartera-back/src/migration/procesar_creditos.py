import os
import pandas as pd
import requests
from typing import List, Dict, Any
import json

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_ENDPOINT = "http://localhost:7000/processUniqueCredit"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 📅 Hojas a procesar (orden cronológico inverso - más reciente primero)
HOJAS_A_PROCESAR = [ 
    "Noviembre 2025", 
    # Agregá más según necesites
]

# 🔥 MODO PRUEBA
MODO_PRUEBA = False  # 👈 True = solo 1 crédito por hoja, False = todos
LIMITE_CREDITOS_PRUEBA = 2  # Número de créditos a procesar en modo prueba

# ============================================
# 🗺️ MAPEO DE COLUMNAS EXCEL → API (SIN ESPACIOS)
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
    'Abono Seguro': 'AbonoSeguro',  # 👈 SIN espacios
    'Abono GPS': 'AbonoGPS',  # 👈 SIN espacios
    'Pago del mes': 'PagoDelMes',
    'Capital restante': 'CapitalRestante',  # 👈 SIN espacios
    'Interés restante': 'InteresRestante',  # 👈 SIN espacios
    'IVA 12% restante': 'IVA12Restante',  # 👈 SIN espacios
    'Seguro Restante': 'SeguroRestante',  # 👈 SIN espacios
    'GPS Restante': 'GPSRestante',  # 👈 SIN espacios
    'Total restante': 'TotalRestante',  # 👈 SIN espacios
    'Llamada': 'Llamada',
    'Pago': 'Pago',
    'NIT': 'NIT',
    'Categoría': 'Categoria',
    'Inversionista': 'Inversionista',
    'Observaciones': 'Observaciones',
    'Cuota': 'Cuota',  # 👈 SIN espacios
    'Monto boleta': 'MontoBoleta',  # 👈 SIN espacios
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
    'Royalty': 'Royalty',  # 👈 SIN espacios
    'U$ Royalty': 'USRoyalty',  # 👈 SIN espacios
    'Membresías': 'Membresias',  # 👈 SIN espacios
    'Membresías pago': 'MembresiasPago',  # 👈 SIN espacios
    'Gastos del mes': 'GastosMes',
    'Utilidad del mes': 'UtilidadMes',
    'Utilidad acumulada': 'UtilidadAcumulada',
    'Como se enteró de nosotros': 'ComoSeEntero',
    'Membresías del mes': 'MembresiasDelMes',
    'Membresías del mes cobradas': 'MembresiasDelMesCobradas',
    'Membresías acumulado': 'MembresiasAcumulado',
    'Asesor': 'Asesor',
    'Otros': 'Otros',  # 👈 SIN espacios
    'Mora': 'Mora',  # 👈 SIN espacios
    'Monto boleta - cuota': 'MontoBoletaCuota',  # 👈 SIN espacios
    'Plazo': 'Plazo',  # 👈 SIN espacios
    'Seguro': 'Seguro',  # 👈 SIN espacios
    'Formato crédito': 'FormatoCredito',  # 👈 SIN espacios
    'Pagado': 'Pagado',
    'Facturacion': 'Facturacion',
    'Mes pagado': 'MesPagado',
    'Seguro Facturado': 'SeguroFacturado',  # 👈 SIN espacios
    'GPS Facturado': 'GPSFacturado',  # 👈 SIN espacios
    'Reserva': 'Reserva',  # 👈 SIN espacios
}

# ============================================
# 🔢 CAMPOS QUE DEBEN SER NÚMEROS
# ============================================
CAMPOS_NUMERICOS = {
    'Numero',
}

# ============================================
# 🧹 FUNCIÓN PARA CONVERTIR VALOR
# ============================================
def convertir_valor(nombre_campo: str, valor: Any) -> Any:
    """
    Convierte el valor según el tipo esperado por la API
    """
    # Si es NaN o vacío
    if pd.isna(valor) or valor == '':
        # Si es campo numérico, devolver 0
        if nombre_campo in CAMPOS_NUMERICOS:
            return 0
        # Si no, devolver string vacío
        return ''
    
    # Si debe ser número
    if nombre_campo in CAMPOS_NUMERICOS:
        try:
            # Intentar convertir a float primero
            num = float(valor)
            # Si es entero, devolverlo como int
            if num.is_integer():
                return int(num)
            return num
        except (ValueError, TypeError):
            return 0
    
    # Para el resto, devolver como string
    if isinstance(valor, (int, float)):
        return str(valor)
    else:
        return str(valor).strip()

# ============================================
# 📖 FUNCIÓN PARA LEER UNA HOJA Y AGRUPAR
# ============================================
def leer_hoja_excel(
    archivo_path: str,
    nombre_hoja: str
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja específica del Excel y agrupa filas por crédito
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
            if 'credito' in row_str or 'sifco' in row_str or 'fecha' in row_str:
                header_row = idx
                print(f"✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            print(f"⚠️ No se encontraron headers en la hoja {nombre_hoja}")
            return {}
        
        # Leer con headers correctos
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        
        # 🎯 NORMALIZAR nombres de columnas (quitar espacios extra de AMBOS lados)
        df.columns = df.columns.str.strip()
        
        print(f"✅ Columnas encontradas: {len(df.columns)}")
        
        # Buscar columnas clave
        col_credito = None
        col_nombre = None
        
        for col in df.columns:
            col_normalizado = str(col).lower().replace('#', '').replace('crédito', 'credito').strip()
            
            if not col_credito:
                if 'credito' in col_normalizado and 'sifco' in col_normalizado:
                    col_credito = col
                    print(f"✅ Columna crédito: '{col}'")
            
            if not col_nombre:
                if 'nombre' in col_normalizado:
                    col_nombre = col
                    print(f"✅ Columna nombre: '{col}'")
        
        if not col_credito:
            print(f"❌ No se encontró columna de CréditoSIFCO")
            return {}
        
        if not col_nombre:
            print(f"⚠️ No se encontró columna de Nombre/Cliente")
        
        # Limpiar DataFrame
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')
        
        print(f"✅ Filas válidas encontradas: {len(df_clean)}")
        
        # Agrupar por crédito
        creditos_data = {}
        
        for idx, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            
            if not numero_credito_raw or numero_credito_raw == '':
                continue
            
            numero_credito = numero_credito_raw.split('_')[0]
            cliente = str(row[col_nombre]).strip() if col_nombre and row[col_nombre] else "Cliente Desconocido"
            
            if numero_credito not in creditos_data:
                creditos_data[numero_credito] = {
                    'creditoBase': numero_credito,
                    'cliente': cliente,
                    'filas': []
                }
            
            # 🎯 Convertir fila con mapeo (las columnas ya están normalizadas)
            fila_dict = {}
            for col in df.columns:
                valor = row[col]
                
                # Buscar en mapeo usando columna normalizada
                nombre_campo = MAPEO_COLUMNAS.get(col, col)
                
                # Convertir valor
                fila_dict[nombre_campo] = convertir_valor(nombre_campo, valor)
            
            creditos_data[numero_credito]['filas'].append(fila_dict)
        
        print(f"✅ Créditos únicos encontrados: {len(creditos_data)}")
        
        for credito_key, credito_data in list(creditos_data.items())[:3]:
            print(f"   📋 {credito_data['creditoBase']}: {credito_data['cliente']} - {len(credito_data['filas'])} filas")
        
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
def enviar_credito_a_api(credito_data: Dict[str, Any]) -> Dict:
    """Envía un crédito agrupado al endpoint de Elysia"""
    
    print(f"\n   🚀 Enviando crédito a API...")
    print(f"      - Crédito: {credito_data['creditoBase']}")
    print(f"      - Cliente: {credito_data['cliente']}")
    print(f"      - Filas: {len(credito_data['filas'])}")
    
    payload = {
        "credito": credito_data
    }
    
    try:
        response = requests.post(
            API_ENDPOINT,
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
        print(f"      - Status: {resultado.get('status', 'N/A')}")
        
        if not resultado.get('success'):
            print(f"      - Error: {resultado.get('error', 'N/A')}")
        else:
            print(f"      - Crédito ID: {resultado.get('credito_id', 'N/A')}")
        
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
            
            resultado = enviar_credito_a_api(credito_data)
            
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
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    print("🔥 Iniciando procesamiento de múltiples hojas...")
    print("⚠️  Asegurate que tu backend Elysia esté corriendo en el puerto 7000\n")
    
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