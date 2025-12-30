import os
import pandas as pd
import requests
from typing import List, Dict, Any
from collections import defaultdict

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
API_ENDPOINT = "http://localhost:7000/processUniqueCredit"
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

# 📅 Hojas a procesar
HOJAS_A_PROCESAR = [ 
    "Noviembre 2025", 
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
    # Filtrar solo pools
    df_pools = df[
        df[col_formato].astype(str).str.lower().str.strip().str.contains('pool', na=False)
    ]
    
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
            print(f"✅ POOL RARO: {cliente} → {len(creditos_base)} créditos")
            creditos_pool_raro.extend(creditos_base)
    
    return creditos_pool_raro

# ============================================
# 📖 LEER HOJA Y AGRUPAR
# ============================================
def leer_hoja_excel_pools_raros(archivo_path: str, nombre_hoja: str) -> Dict[str, Dict[str, Any]]:
    """
    Lee Excel, detecta pools raros y agrupa por crédito
    """
    print(f"\n{'='*70}")
    print(f"📄 Procesando hoja: {nombre_hoja}")
    print(f"{'='*70}")
    
    try:
        # Leer Excel
        df_raw = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=None)
        
        # Buscar headers
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
            print(f"⚠️ No se encontraron headers")
            return {}
        
        # Leer con headers
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        df.columns = df.columns.str.strip()
        
        # Buscar columnas
        col_credito = '# crédito SIFCO'
        col_nombre = 'Nombre'
        col_formato = 'Formato crédito'
        
        print(f"✅ Columnas: Crédito='{col_credito}', Nombre='{col_nombre}', Formato='{col_formato}'")
        
        # Limpiar DataFrame
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')
        
        print(f"✅ Filas válidas: {len(df_clean)}")
        
        # 🔥 DETECTAR POOLS RAROS
        print(f"\n🔍 Detectando pools raros...")
        creditos_pool_raro = detectar_pools_raros(df_clean, col_credito, col_nombre, col_formato)
        
        if not creditos_pool_raro:
            print(f"⚠️ No se encontraron pools raros en esta hoja")
            return {}
        
        print(f"🔥 {len(creditos_pool_raro)} créditos pool raro detectados\n")
        
        # 🎯 AGRUPAR SOLO LOS POOLS RAROS
        creditos_data = {}
        
        for idx, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            
            if not numero_credito_raw:
                continue
            
            # ✅ SOLO procesar si es pool raro
            if numero_credito_raw not in creditos_pool_raro:
                continue
            
            cliente = str(row[col_nombre]).strip()
            
            if numero_credito_raw not in creditos_data:
                creditos_data[numero_credito_raw] = {
                    'creditoBase': numero_credito_raw,
                    'cliente': cliente,
                    'filas': []
                }
            
            # Convertir fila
            fila_dict = {}
            for col in df.columns:
                valor = row[col]
                nombre_campo = MAPEO_COLUMNAS.get(col, col)
                fila_dict[nombre_campo] = convertir_valor(nombre_campo, valor)
            
            creditos_data[numero_credito_raw]['filas'].append(fila_dict)
        
        print(f"✅ Pools raros agrupados: {len(creditos_data)}")
        for credito_key, credito_data in list(creditos_data.items())[:3]:
            print(f"   📋 {credito_data['creditoBase']}: {credito_data['cliente']} - {len(credito_data['filas'])} filas")
        
        return creditos_data
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return {}

# ============================================
# 📡 ENVIAR A API
# ============================================
def enviar_credito_a_api(credito_data: Dict[str, Any]) -> Dict:
    print(f"\n   🚀 Enviando pool raro a API...")
    print(f"      - Crédito: {credito_data['creditoBase']}")
    print(f"      - Cliente: {credito_data['cliente']}")
    print(f"      - Filas: {len(credito_data['filas'])}")
    
    payload = {"credito": credito_data}
    
    try:
        response = requests.post(
            API_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120
        )
        
        print(f"   📡 Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"   ❌ Response: {response.text[:500]}")
        
        response.raise_for_status()
        resultado = response.json()
        
        print(f"   ✅ Success: {resultado.get('success', False)}")
        if not resultado.get('success'):
            print(f"      Error: {resultado.get('error', 'N/A')}")
        
        return resultado
        
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return {"success": False, "error": str(e)}

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_pools_raros():
    print(f"\n{'='*70}")
    print(f"🔥 PROCESADOR DE POOLS RAROS")
    print(f"{'='*70}")
    print(f"📂 Carpeta: {CARPETA_EXCELS}")
    print(f"📄 Archivo: {ARCHIVO_EXCEL}")
    print(f"🔗 API: {API_ENDPOINT}")
    print(f"{'='*70}\n")
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado")
        return
    
    stats = {
        'procesados': 0,
        'exitosos': 0,
        'fallidos': 0,
    }
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        creditos_data = leer_hoja_excel_pools_raros(archivo_path, nombre_hoja)
        
        if not creditos_data:
            continue
        
        creditos_a_procesar = list(creditos_data.values())
        if MODO_PRUEBA:
            creditos_a_procesar = creditos_a_procesar[:LIMITE_CREDITOS_PRUEBA]
        
        for credito_data in creditos_a_procesar:
            print(f"\n{'─'*70}")
            print(f"📋 Procesando: {credito_data['creditoBase']} - {credito_data['cliente']}")
            
            resultado = enviar_credito_a_api(credito_data)
            
            stats['procesados'] += 1
            if resultado.get('success'):
                stats['exitosos'] += 1
            else:
                stats['fallidos'] += 1
            
            print(f"{'─'*70}")
    
    print(f"\n{'='*70}")
    print(f"🎉 RESUMEN FINAL")
    print(f"{'='*70}")
    print(f"📋 Pools raros procesados: {stats['procesados']}")
    print(f"   ✅ Exitosos: {stats['exitosos']}")
    print(f"   ❌ Fallidos: {stats['fallidos']}")
    print(f"{'='*70}\n")

# ============================================
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    print("🔥 Procesador de POOLS RAROS")
    print("⚠️  Asegurate que el backend esté corriendo en puerto 7000\n")
    
    if MODO_PRUEBA:
        print(f"🧪 MODO PRUEBA: Solo {LIMITE_CREDITOS_PRUEBA} crédito(s)\n")
    
    input("📌 Presiona ENTER para continuar...")
    
    try:
        procesar_pools_raros()
        print("\n✅ ¡Proceso completado!")
    except KeyboardInterrupt:
        print("\n\n⚠️ Interrumpido por el usuario")
    except Exception as e:
        print(f"\n❌ Error fatal: {e}")
        import traceback
        traceback.print_exc()