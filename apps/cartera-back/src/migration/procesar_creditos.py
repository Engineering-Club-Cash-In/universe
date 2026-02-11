import os
import pandas as pd
import requests
from typing import List, Dict, Any, Optional
from collections import defaultdict
import json
from datetime import datetime

# ============================================
# 🔧 CONFIGURACIÓN
# ============================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"
# 📅 Hojas a procesar (orden cronológico inverso - más reciente primero)
HOJAS_A_PROCESAR = [   
    "Enero 2026"
]

# 🔥 MODO PRUEBA
MODO_PRUEBA = False
LIMITE_CREDITOS_PRUEBA = 2

# 🎯 UMBRAL DE SIMILITUD PARA PREGUNTAR
UMBRAL_PREGUNTAR = 70.0  # Si < 70%, pregunta al usuario

# 📁 ARCHIVO DE DECISIONES GUARDADAS
ARCHIVO_DECISIONES = "decisiones_inversionistas.json"

# 📝 ARCHIVO DE LOGS DETALLADOS
ARCHIVO_LOG = f"proceso_excel_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

# ============================================
# 📝 SISTEMA DE LOGS
# ============================================
class Logger:
    def __init__(self, archivo: str):
        self.archivo = archivo
        self.nivel_indentacion = 0
    
    def log(self, mensaje: str, nivel: str = "INFO", indent: int = 0):
        """Log con timestamp y formato"""
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        indentacion = "  " * (self.nivel_indentacion + indent)
        linea = f"[{timestamp}] [{nivel:5}] {indentacion}{mensaje}"
        
        print(linea)
        
        try:
            with open(self.archivo, 'a', encoding='utf-8') as f:
                f.write(linea + "\n")
        except:
            pass
    
    def separador(self, char: str = "=", longitud: int = 70):
        """Línea separadora"""
        linea = char * longitud
        print(linea)
        try:
            with open(self.archivo, 'a', encoding='utf-8') as f:
                f.write(linea + "\n")
        except:
            pass
    
    def titulo(self, texto: str, emoji: str = "🔥"):
        """Título destacado"""
        self.separador()
        self.log(f"{emoji} {texto}", "INFO")
        self.separador()
    
    def subtitulo(self, texto: str, emoji: str = "📋"):
        """Subtítulo"""
        self.log(f"{emoji} {texto}", "INFO")
    
    def debug(self, mensaje: str, indent: int = 0):
        """Log de debug"""
        self.log(mensaje, "DEBUG", indent)
    
    def info(self, mensaje: str, indent: int = 0):
        """Log de info"""
        self.log(mensaje, "INFO", indent)
    
    def warning(self, mensaje: str, indent: int = 0):
        """Log de warning"""
        self.log(mensaje, "WARN", indent)
    
    def error(self, mensaje: str, indent: int = 0):
        """Log de error"""
        self.log(mensaje, "ERROR", indent)
    
    def success(self, mensaje: str, indent: int = 0):
        """Log de éxito"""
        self.log(mensaje, "OK", indent)
    
    def indent(self):
        """Aumentar indentación"""
        self.nivel_indentacion += 1
    
    def dedent(self):
        """Reducir indentación"""
        self.nivel_indentacion = max(0, self.nivel_indentacion - 1)

# Instancia global del logger
logger = Logger(ARCHIVO_LOG)

# ============================================
# 💾 CARGAR/GUARDAR DECISIONES
# ============================================

def cargar_decisiones() -> Dict[str, int]:
    """Carga decisiones previas del usuario"""
    if os.path.exists(ARCHIVO_DECISIONES):
        try:
            with open(ARCHIVO_DECISIONES, 'r', encoding='utf-8') as f:
                decisiones = json.load(f)
                logger.info(f"💾 Decisiones cargadas: {len(decisiones)} inversionistas")
                return decisiones
        except Exception as e:
            logger.error(f"Error cargando decisiones: {e}")
            return {}
    return {}

def guardar_decision(nombre_excel: str, inversionista_id: int, decisiones: Dict[str, int]):
    """Guarda una decisión del usuario"""
    decisiones[nombre_excel.lower().strip()] = inversionista_id
    
    try:
        with open(ARCHIVO_DECISIONES, 'w', encoding='utf-8') as f:
            json.dump(decisiones, f, ensure_ascii=False, indent=2)
        logger.success(f"💾 Decisión guardada: '{nombre_excel}' → ID {inversionista_id}", indent=1)
    except Exception as e:
        logger.error(f"No se pudo guardar decisión: {e}", indent=1)

# ============================================
# 🎨 FUNCIÓN PARA MOSTRAR CANDIDATOS
# ============================================

def mostrar_candidatos_y_preguntar(
    nombre_buscado: str,
    candidatos: List[Dict[str, Any]],
    credito_sifco: str,
    cliente: str
) -> Optional[int]:
    """
    Muestra los candidatos al usuario y le pregunta cuál elegir
    Retorna el inversionista_id elegido o None
    """
    logger.separador("=")
    logger.info("❓ MATCH DUDOSO - Necesito tu ayuda, jefe")
    logger.separador("=")
    logger.info(f"📋 Crédito: {credito_sifco}")
    logger.info(f"👤 Cliente: {cliente}")
    logger.info(f"🔍 Buscando: \"{nombre_buscado}\"")
    logger.info(f"\n📊 Candidatos encontrados:\n")
    
    # Mostrar candidatos numerados
    for idx, candidato in enumerate(candidatos, 1):
        similitud = candidato.get('similitud', 0)
        nombre = candidato.get('nombre', 'N/A')
        inv_id = candidato.get('inversionista_id', 'N/A')
        
        # Emojis según similitud
        if similitud >= 60:
            emoji = "🟡"
        elif similitud >= 40:
            emoji = "🟠"
        else:
            emoji = "🔴"
        
        print(f"   {emoji} {idx}. [{similitud:.1f}%] {nombre}")
        print(f"      └─ ID: {inv_id}\n")
    
    print(f"   0️⃣  . Ninguno sirve (SKIP este inversionista)")
    print(f"   ➕ N. Crear nuevo inversionista con este nombre")
    logger.separador("=")
    
    while True:
        respuesta = input("\n👉 Elegí una opción (número): ").strip()
        
        if respuesta == '0':
            logger.info("⏭️  Usuario eligió SKIP")
            return None
        
        if respuesta.upper() == 'N':
            logger.info(f"➕ Usuario eligió CREAR NUEVO: \"{nombre_buscado}\"")
            return -1  # Señal especial para crear nuevo
        
        try:
            opcion = int(respuesta)
            if 1 <= opcion <= len(candidatos):
                elegido = candidatos[opcion - 1]
                logger.success(f"✅ Usuario eligió: {elegido['nombre']} (ID: {elegido['inversionista_id']})")
                return elegido['inversionista_id']
            else:
                logger.warning(f"❌ Opción inválida: {respuesta}")
        except ValueError:
            logger.warning(f"❌ Entrada inválida: {respuesta}")

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
# 🎯 DETECTAR POOLS RAROS (MEJORADO CON LOGS)
# ============================================
def detectar_pools_raros(
    df: pd.DataFrame, 
    col_credito: str, 
    col_nombre: str, 
    col_numero: str, 
    col_formato: str = None
) -> Dict[str, List[str]]:
    """
    Pool raro = MISMO CLIENTE (normalizado) + MISMO # + SIN variaciones (_2, _3)
    Normaliza nombres quitando "/" y espacios extra
    """
    logger.subtitulo("🔍 DETECTANDO POOLS RAROS", "🔍")
    
    # Validar columnas necesarias
    if not col_numero:
        logger.warning("⚠️ No se encontró columna #, no se pueden detectar pools")
        return {}
    
    logger.info("Criterio: MISMO CLIENTE (normalizado) + MISMO # + sin variaciones")
    logger.info("Normalización: quitar '/' y espacios extras\n")
    
    # 🔥 AGRUPAR POR: cliente_normalizado + numero_cuota
    grupos = defaultdict(list)
    registros_analizados = 0
    
    for idx, row in df.iterrows():
        credito_raw = str(row[col_credito]).strip()
        
        # Validar crédito
        if not credito_raw or credito_raw == 'nan':
            continue
        
        # 🔥 IGNORAR VARIACIONES (esas son pools normales)
        if '_' in credito_raw:
            continue
        
        # 🔥 NORMALIZAR NOMBRE DE CLIENTE
        nombre_cliente = str(row[col_nombre]).strip()
        
        # Quitar todo después del "/" (co-deudores, etc.)
        if '/' in nombre_cliente:
            nombre_cliente = nombre_cliente.split('/')[0].strip()
        
        # Normalizar espacios extras
        nombre_cliente = ' '.join(nombre_cliente.split())
        
        # Convertir a mayúsculas para comparar
        nombre_cliente = nombre_cliente.upper()
        
        numero = str(row[col_numero]).strip()
        
        # Validar número
        if not numero or numero == 'nan' or numero == '':
            continue
        
        # 🔥 Crear clave única: cliente_normalizado||numero
        clave = f"{nombre_cliente}||{numero}"
        grupos[clave].append(credito_raw)
        registros_analizados += 1
    
    logger.success(f"✅ Registros analizados: {registros_analizados}")
    logger.info(f"✅ Grupos únicos (cliente+#): {len(grupos)}")
    
    # Detectar pools raros (grupos con 2+ créditos)
    pools_raros_por_cliente = {}
    
    logger.indent()
    for clave, creditos in grupos.items():
        if len(creditos) < 2:
            continue  # No es pool raro
        
        cliente, numero = clave.split('||')
        
        logger.warning(f"\n🔥 POOL RARO DETECTADO:")
        logger.warning(f"   Cliente: {cliente}", indent=1)
        logger.warning(f"   # (cuota): {numero}", indent=1)
        logger.warning(f"   Cantidad: {len(creditos)} créditos", indent=1)
        logger.warning(f"   Créditos:", indent=1)
        
        for cred in creditos:
            logger.warning(f"     • {cred}", indent=1)
        
        pools_raros_por_cliente[clave] = creditos
    
    logger.dedent()
    
    if len(pools_raros_por_cliente) == 0:
        logger.success("\n✅ No se encontraron pools raros")
    else:
        logger.warning(f"\n🔥 Total pools raros: {len(pools_raros_por_cliente)} grupos")
    
    return pools_raros_por_cliente
# ============================================
# 🔍 VALIDAR PORCENTAJES
# ============================================
def validar_porcentajes(fila: Dict[str, Any], credito_sifco: str) -> Dict[str, Any]:
    """
    Valida que los porcentajes sean correctos
    Retorna dict con warnings si hay problemas
    """
    warnings = []
    
    try:
        # Obtener porcentajes
        pct_cash_in = float(fila.get('PorcentajeCashIn', 0) or 0)
        pct_inversionista = float(fila.get('PorcentajeInversionista', 0) or 0)
        
        # Validar que estén en formato decimal (0.0 a 1.0)
        if pct_cash_in > 1.0 or pct_inversionista > 1.0:
            warnings.append(f"⚠️ Porcentajes parecen estar en formato entero (>1.0)")
            warnings.append(f"   Cash-In: {pct_cash_in}, Inversionista: {pct_inversionista}")
            
            # Intentar corregir asumiendo que están en formato 20, 80 en lugar de 0.2, 0.8
            if pct_cash_in > 1.0:
                pct_cash_in_corregido = pct_cash_in / 100
                warnings.append(f"   🔧 Corrigiendo Cash-In: {pct_cash_in} → {pct_cash_in_corregido}")
                fila['PorcentajeCashIn'] = pct_cash_in_corregido
                pct_cash_in = pct_cash_in_corregido
            
            if pct_inversionista > 1.0:
                pct_inv_corregido = pct_inversionista / 100
                warnings.append(f"   🔧 Corrigiendo Inversionista: {pct_inversionista} → {pct_inv_corregido}")
                fila['PorcentajeInversionista'] = pct_inv_corregido
                pct_inversionista = pct_inv_corregido
        
        # Validar que sumen aproximadamente 1.0 (100%)
        suma = pct_cash_in + pct_inversionista
        if abs(suma - 1.0) > 0.01:  # Tolerancia de 1%
            warnings.append(f"⚠️ Porcentajes no suman 100%: {suma*100:.2f}%")
            warnings.append(f"   Cash-In: {pct_cash_in*100}% + Inversionista: {pct_inversionista*100}%")
    
    except (ValueError, TypeError) as e:
        warnings.append(f"❌ Error validando porcentajes: {e}")
    
    return {
        'valido': len(warnings) == 0,
        'warnings': warnings,
        'fila_corregida': fila
    }

# ============================================
# 📖 FUNCIÓN PARA LEER UNA HOJA Y AGRUPAR
# ============================================
def leer_hoja_excel(
    archivo_path: str,
    nombre_hoja: str,
    solo_pools_raros: bool = False  # 🔥 False = procesa TODO, True = solo pools raros
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja específica del Excel y agrupa filas por crédito.
    🔥 NORMALIZA todos los pools (normales y raros) al creditoBase

    Parámetro:
    - solo_pools_raros:
        • False (default): procesa TODO (comportamiento actual)
        • True: SOLO procesa pools raros (ignora individuales y pools normales)
    """
    logger.titulo(f"PROCESANDO HOJA: {nombre_hoja}")
    logger.info(f"🧪 Modo solo_pools_raros = {solo_pools_raros}")
    
    try:
        # Leer Excel sin headers primero para buscarlos
        logger.info("📖 Leyendo archivo Excel...")
        df_raw = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=None)
        logger.success(f"✅ Archivo leído: {len(df_raw)} filas")
        
        # Buscar fila de headers
        logger.info("\n🔍 Buscando fila de headers...")
        header_row = None
        for idx, row in df_raw.iterrows():
            if idx > 20:
                break
            row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
            if 'credito' in row_str or 'sifco' in row_str:
                header_row = idx
                logger.success(f"✅ Headers encontrados en fila {idx}")
                break
        
        if header_row is None:
            logger.error(f"❌ No se encontraron headers en la hoja {nombre_hoja}")
            return {}
        
        # Leer con headers correctos
        df = pd.read_excel(archivo_path, sheet_name=nombre_hoja, header=header_row)
        df.columns = df.columns.str.strip()
        
        logger.success(f"✅ DataFrame cargado: {len(df.columns)} columnas, {len(df)} filas")
        
        # Buscar columnas clave
        logger.info("\n🔍 Buscando columnas clave...")
        logger.indent()
        
        col_credito = None
        col_nombre = None
        col_numero = None
        col_formato = None
        col_inversionista = None
        
        for col in df.columns:
            col_normalizado = (
                str(col)
                .lower()
                .replace('#', '')
                .replace('crédito', 'credito')
                .strip()
            )
            
            if not col_credito and 'credito' in col_normalizado and 'sifco' in col_normalizado:
                col_credito = col
                logger.success(f"✅ Columna crédito SIFCO: '{col}'")
            
            if not col_nombre and 'nombre' in col_normalizado and 'formato' not in col_normalizado and 'inversionista' not in col_normalizado:
                col_nombre = col
                logger.success(f"✅ Columna nombre/cliente: '{col}'")
            
            if not col_numero and col == '#':
                col_numero = col
                logger.success(f"✅ Columna número (#): '{col}'")
            
            if not col_formato and 'formato' in col_normalizado and 'credito' in col_normalizado:
                col_formato = col
                logger.success(f"✅ Columna formato crédito: '{col}'")
            
            if not col_inversionista and 'inversionista' in col_normalizado and 'porcentaje' not in col_normalizado and 'cuota' not in col_normalizado and 'iva' not in col_normalizado:
                col_inversionista = col
                logger.success(f"✅ Columna inversionista: '{col}'")
        
        logger.dedent()
        
        # Validar columnas críticas
        if not col_credito:
            logger.error("❌ CRÍTICO: No se encontró columna de CréditoSIFCO")
            return {}
        
        # Limpiar DataFrame
        logger.info("\n🧹 Limpiando datos...")
        df_clean = df.dropna(subset=[col_credito])
        df_clean = df_clean[
            ~df_clean[col_credito].astype(str).str.lower().str.contains('total|suma|promedio', na=False)
        ]
        df_clean = df_clean.fillna('')
        
        logger.success(f"✅ Datos limpios: {len(df_clean)} filas válidas")
        
        # 🔥 DETECTAR POOLS RAROS
        pools_raros = {}
        if col_formato and col_numero:
            pools_raros = detectar_pools_raros(
                df_clean, col_credito, col_nombre, col_numero, col_formato
            )
            logger.info(f"🟡 Pools raros detectados: {len(pools_raros)}")
        else:
            logger.warning("\n⚠️ SALTANDO DETECCIÓN DE POOLS RAROS (faltan columnas)")
        
        # 🎯 AGRUPAR FILAS
        logger.subtitulo("🔄 AGRUPANDO FILAS POR CRÉDITO", "🔄")
        logger.indent()
        
        creditos_data = {}
        filas_procesadas = 0
        filas_skipped = 0
        
        for _, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            if not numero_credito_raw:
                filas_skipped += 1
                continue
            
            cliente = (
                str(row[col_nombre]).strip()
                if col_nombre and row[col_nombre]
                else "Cliente Desconocido"
            )
            numero = str(row[col_numero]).strip() if col_numero and row[col_numero] else ""
            
            # =============================
            # 🔥 NORMALIZACIÓN DE CLIENTE
            # =============================
            cliente_norm = cliente
            if '/' in cliente_norm:
                cliente_norm = cliente_norm.split('/')[0].strip()
            cliente_norm = ' '.join(cliente_norm.split()).upper()
            
            # =============================
            # 🔥 DETERMINAR TIPO DE CRÉDITO
            # =============================
            
            es_pool_normal = '_' in numero_credito_raw
            clave_pool = f"{cliente_norm}||{numero}" if numero else None
            es_pool_raro = (
                clave_pool
                and clave_pool in pools_raros
                and numero_credito_raw in pools_raros[clave_pool]
            )
            
            # 🔥 FILTRO POR MODO
            if solo_pools_raros and not es_pool_raro:
                filas_skipped += 1
                continue
            
            # =============================
            # 🔥 NORMALIZAR CRÉDITO
            # =============================
            
            if es_pool_raro:
                numero_credito_base = pools_raros[clave_pool][0]
                numero_credito_final = numero_credito_base
                logger.warning(f"🟡 Pool raro: {numero_credito_raw} → Base: {numero_credito_base}")
            
            elif es_pool_normal:
                if solo_pools_raros:
                    filas_skipped += 1
                    continue
                numero_credito_base = numero_credito_raw.split('_')[0]
                numero_credito_final = numero_credito_base
            
            else:
                if solo_pools_raros:
                    filas_skipped += 1
                    continue
                numero_credito_base = numero_credito_raw
                numero_credito_final = numero_credito_raw
            
            # =============================
            # 🔥 MAPEAR FILA
            # =============================
            
            fila_dict = {}
            for col in df.columns:
                nombre_campo = MAPEO_COLUMNAS.get(col, col)
                fila_dict[nombre_campo] = convertir_valor(nombre_campo, row[col])
            
            fila_dict['CreditoSIFCO'] = numero_credito_final
            
            if numero_credito_base not in creditos_data:
                creditos_data[numero_credito_base] = {
                    'creditoBase': numero_credito_base,
                    'cliente': cliente,
                    'filas': []
                }
            
            creditos_data[numero_credito_base]['filas'].append(fila_dict)
            filas_procesadas += 1
        
        logger.dedent()
        
        logger.success("\n✅ AGRUPACIÓN COMPLETADA:")
        logger.info(f"   • Filas procesadas: {filas_procesadas}", indent=1)
        logger.info(f"   • Filas ignoradas: {filas_skipped}", indent=1)
        logger.info(f"   • Créditos únicos: {len(creditos_data)}", indent=1)
        
        return creditos_data
        
    except Exception as e:
        logger.error(f"❌ Error leyendo hoja {nombre_hoja}: {e}")
        import traceback
        traceback.print_exc()
        return {}

# ============================================
# 📡 FUNCIÓN PARA ENVIAR A API
# ============================================
def enviar_credito_a_api(credito_data: Dict[str, Any], api_endpoint: str) -> Dict:
    """Envía un crédito agrupado al endpoint de Elysia con soporte interactivo"""
    
    logger.subtitulo(f"🚀 ENVIANDO A API: {credito_data['creditoBase']}", "🚀")
    logger.indent()
    
    logger.info(f"Cliente: {credito_data['cliente']}")
    logger.info(f"Filas: {len(credito_data['filas'])}")
    
    # Mostrar inversionistas únicos
    inversionistas_unicos = set(f.get('Inversionista', 'N/A') for f in credito_data['filas'])
    logger.info(f"Inversionistas únicos: {len(inversionistas_unicos)}")
    for inv in sorted(inversionistas_unicos):
        logger.info(f"  • {inv}", indent=1)
    
    # Mostrar CreditoSIFCO únicos
    creditos_sifco = set(f.get('CreditoSIFCO', '') for f in credito_data['filas'])
    if len(creditos_sifco) == 1:
        logger.info(f"CreditoSIFCO: {list(creditos_sifco)[0]}")
    else:
        logger.warning(f"⚠️ CreditoSIFCO múltiples: {', '.join(sorted(creditos_sifco))}")
    
    # 🔥 CARGAR DECISIONES PREVIAS
    decisiones = cargar_decisiones()
    
    # 🔥 INYECTAR DECISIONES DEL USUARIO EN LAS FILAS
    for fila in credito_data['filas']:
        nombre_inv = str(fila.get('Inversionista', '')).strip()
        if not nombre_inv:
            continue
        
        # Buscar si hay decisión guardada
        clave = nombre_inv.lower().strip()
        if clave in decisiones:
            inv_id = decisiones[clave]
            logger.success(f"✅ Usando decisión guardada: \"{nombre_inv}\" → ID {inv_id}")
            fila['_decision_usuario'] = inv_id
    
    payload = {
        "credito": credito_data,
        "modo_interactivo": True,
        "umbral_similitud": UMBRAL_PREGUNTAR
    }
    
    try:
        logger.info("\n📡 Enviando request...")
        response = requests.post(
            api_endpoint,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120
        )
        
        logger.info(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            logger.error(f"Response: {response.text[:500]}")
        
        response.raise_for_status()
        resultado = response.json()
        
        logger.success(f"✅ Respuesta recibida")
        logger.info(f"Success: {resultado.get('success', False)}")
        
        # 🔥 PROCESAR CONSULTAS INTERACTIVAS
        consultas = resultado.get('consultas_interactivas', [])
        if consultas:
            logger.warning(f"\n❓ El backend tiene {len(consultas)} dudas...")
            
            decisiones_usuario = []
            
            for consulta in consultas:
                nombre_buscado = consulta.get('nombre_excel', '')
                candidatos = consulta.get('candidatos', [])
                credito_sifco = consulta.get('credito_sifco', '')
                
                # Preguntar al usuario
                decision = mostrar_candidatos_y_preguntar(
                    nombre_buscado,
                    candidatos,
                    credito_sifco,
                    credito_data['cliente']
                )
                
                if decision is not None:
                    # Guardar decisión
                    guardar_decision(nombre_buscado, decision, decisiones)
                    
                    # Agregar a payload
                    decisiones_usuario.append({
                        'nombre_excel': nombre_buscado,
                        'credito_sifco': credito_sifco,
                        'decision': decision
                    })
            
            if decisiones_usuario:
                # Reenviar payload con decisiones
                logger.info("\n🔄 Reenviando con decisiones del usuario...")
                payload['decisiones_usuario'] = decisiones_usuario
                
                response = requests.post(
                    api_endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=120
                )
                resultado = response.json()
                logger.success("✅ Request final completado")
        
        # Mostrar resultado final
        if 'status' in resultado:
            logger.info(f"Status: {resultado.get('status', 'N/A')}")
        
        if not resultado.get('success'):
            logger.error(f"Error: {resultado.get('error', 'N/A')}")
        else:
            if 'credito_id' in resultado:
                logger.success(f"Crédito ID: {resultado.get('credito_id', 'N/A')}")
            if 'inversionistas_procesados' in resultado:
                logger.success(f"Inversionistas procesados: {resultado.get('inversionistas_procesados', 'N/A')}")
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado.get('inversionistas_no_encontrados', [])
                if no_encontrados:
                    logger.warning(f"⚠️ No encontrados: {', '.join(no_encontrados)}")
        
        logger.dedent()
        return resultado
        
    except requests.exceptions.ConnectionError:
        logger.error("❌ API no disponible")
        logger.error("   ¿Está corriendo el backend en puerto 7000?")
        logger.dedent()
        return {"success": False, "status": "error_conexion", "error": "API no disponible"}
    except requests.exceptions.Timeout:
        logger.error("❌ Timeout - La API tardó mucho en responder")
        logger.dedent()
        return {"success": False, "status": "timeout", "error": "Timeout"}
    except requests.exceptions.HTTPError as e:
        logger.error(f"❌ Error HTTP: {e}")
        logger.dedent()
        return {"success": False, "status": "error_http", "error": str(e)}
    except Exception as e:
        logger.error(f"❌ Error inesperado: {e}")
        import traceback
        traceback.print_exc()
        logger.dedent()
        return {"success": False, "status": "error_general", "error": str(e)}

# ============================================
# 🚀 FUNCIÓN PRINCIPAL
# ============================================
def procesar_multiples_hojas(api_endpoint: str, modo_nombre: str, solo_pools_raros: bool = False):
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🔥 MODO COMPLETO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"📅 Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    logger.info(f"🎯 Umbral similitud: {UMBRAL_PREGUNTAR}%")
    
    if MODO_PRUEBA:
        logger.warning(f"⚡ Límite por hoja: {LIMITE_CREDITOS_PRUEBA} crédito(s)")
    
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles en el archivo:")
        for hoja in hojas_disponibles:
            logger.info(f"   - {hoja}")
        logger.info("")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'creditos_no_encontrados': 0,
        'inversionistas_no_encontrados': []
    }
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue

        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja, solo_pools_raros=solo_pools_raros)

        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en la hoja {nombre_hoja}")
            continue

        stats_globales['hojas_procesadas'] += 1

        creditos_a_procesar = list(creditos_data.values())
        if MODO_PRUEBA:
            creditos_a_procesar = creditos_a_procesar[:LIMITE_CREDITOS_PRUEBA]
            logger.warning(f"\n🧪 MODO PRUEBA: Procesando solo {len(creditos_a_procesar)} crédito(s)")
        
        for credito_data in creditos_a_procesar:
            logger.separador("─")
            
            resultado = enviar_credito_a_api(credito_data, api_endpoint)
            
            stats_globales['creditos_procesados'] += 1
            
            if resultado.get('success'):
                stats_globales['creditos_exitosos'] += 1
                
                # Recopilar inversionistas no encontrados
                if 'inversionistas_no_encontrados' in resultado:
                    no_encontrados = resultado['inversionistas_no_encontrados']
                    if no_encontrados:
                        stats_globales['inversionistas_no_encontrados'].extend([
                            {
                                'credito': credito_data['creditoBase'],
                                'cliente': credito_data['cliente'],
                                'inversionista': inv
                            }
                            for inv in no_encontrados
                        ])
            elif resultado.get('status') == 'no_encontrado':
                stats_globales['creditos_no_encontrados'] += 1
            else:
                stats_globales['creditos_fallidos'] += 1
            
            logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL")
    logger.info(f"📊 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"📋 Créditos procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.info(f"   ⏭️  No encontrados: {stats_globales['creditos_no_encontrados']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    # Mostrar inversionistas no encontrados
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️  INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        logger.separador()
        
        # Agrupar por inversionista
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente']})")
    
    logger.separador()
    logger.success(f"\n✅ Logs guardados en: {ARCHIVO_LOG}")
# 🎯 PROCESAR CRÉDITOS ESPECÍFICOS (MODO 3)
# ============================================ 
def procesar_creditos_especificos(api_endpoint: str, modo_nombre: str, lista_creditos: list[str]):
    """
    Procesa solo los créditos indicados:
    - Busca en TODAS las hojas
    - Respeta pools (creditoBase)
    - Permite buscar por RAW o BASE
    - Envía a la API solo una vez por crédito agrupado
    """

    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    logger.titulo(f"{modo_texto} - {modo_nombre}")

    # -------------------------
    # Normalización inicial
    # -------------------------
    lista_buscados = {c.strip().upper() for c in lista_creditos}

    logger.info(f"🎯 Créditos a buscar: {len(lista_buscados)}")
    for c in sorted(lista_buscados):
        logger.info(f"   • {c}")
    logger.separador()

    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return

    xls = pd.ExcelFile(archivo_path)
    hojas_disponibles = set(xls.sheet_names)

    stats = {
        "hojas_procesadas": 0,
        "creditos_buscados": len(lista_buscados),
        "creditos_encontrados": 0,
        "creditos_no_encontrados": [],
        "procesados": 0,
        "exitosos": 0,
        "fallidos": 0,
    }

    creditos_encontrados: dict[str, dict] = {}
    mapa_raw_a_base: dict[str, str] = {}

    # -------------------------
    # FASE 1: BÚSQUEDA
    # -------------------------
    logger.titulo("🔍 BÚSQUEDA EN HOJAS")

    for hoja in HOJAS_A_PROCESAR:
        if hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{hoja}' no encontrada")
            continue

        logger.subtitulo(f"📋 Procesando hoja: {hoja}")
        creditos_data = leer_hoja_excel(archivo_path, hoja)

        if not creditos_data:
            logger.warning("⚠️ Sin datos")
            continue

        stats["hojas_procesadas"] += 1

        for credito_key, info in creditos_data.items():
            credito_base = credito_key.strip().upper()

            # Todos los SIFCO del pool
            sifcos_pool = {
                str(f.get("CreditoSIFCO", "")).strip().upper()
                for f in info["filas"]
            }

            # Mapear RAW → BASE
            for sifco in sifcos_pool:
                mapa_raw_a_base[sifco] = credito_base
            mapa_raw_a_base[credito_base] = credito_base

            # ¿Algún buscado cae en este pool?
            match = lista_buscados & (sifcos_pool | {credito_base})

            if match and credito_base not in creditos_encontrados:
                buscado = sorted(match)[0]

                logger.success(f"✅ ENCONTRADO: {buscado}")
                logger.info(f"   → Base: {credito_base}", indent=1)
                logger.info(f"   → Cliente: {info['cliente'][:40]}...", indent=1)
                logger.info(f"   → Filas: {len(info['filas'])}", indent=1)

                creditos_encontrados[credito_base] = {
                    "data": info,
                    "hoja": hoja,
                    "credito_buscado": buscado,
                }
                stats["creditos_encontrados"] += 1

    # -------------------------
    # RESUMEN DE BÚSQUEDA
    # -------------------------
    encontrados = {v["credito_buscado"] for v in creditos_encontrados.values()}
    stats["creditos_no_encontrados"] = sorted(lista_buscados - encontrados)

    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats['hojas_procesadas']}")
    logger.info(f"🔍 Buscados: {stats['creditos_buscados']}")
    logger.success(f"✅ Encontrados: {stats['creditos_encontrados']}")

    if stats["creditos_no_encontrados"]:
        logger.warning(f"❌ NO encontrados: {len(stats['creditos_no_encontrados'])}")
        for c in stats["creditos_no_encontrados"]:
            logger.warning(f"   • {c}")

    if not creditos_encontrados:
        logger.error("❌ No se encontró ningún crédito")
        return

    # -------------------------
    # FASE 2: ENVÍO A API
    # -------------------------
    logger.titulo("🚀 ENVÍO A LA API")

    for idx, (base, info) in enumerate(creditos_encontrados.items(), 1):
        logger.subtitulo(f"📦 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        logger.info(f"📂 Hoja: {info['hoja']}")
        logger.info(f"🧱 Base: {base}")

        resultado = enviar_credito_a_api(info["data"], api_endpoint)
        stats["procesados"] += 1

        if resultado.get("success"):
            stats["exitosos"] += 1
        else:
            stats["fallidos"] += 1

    # -------------------------
    # RESUMEN FINAL
    # -------------------------
    logger.separador("=")
    logger.titulo("🎉 RESUMEN FINAL")
    logger.info(f"📤 Procesados: {stats['procesados']}")
    logger.success(f"✅ Exitosos: {stats['exitosos']}")
    logger.error(f"❌ Fallidos: {stats['fallidos']}")
    logger.success(f"📄 Logs: {ARCHIVO_LOG}")

    """
    Procesa solo los créditos que estén en la lista
    Usa leer_hoja_excel (que YA funciona) y filtra los créditos buscados
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # 🔥 NORMALIZAR lista de créditos buscados (UPPERCASE para comparar)
    lista_creditos_normalizada = set(c.strip().upper() for c in lista_creditos)
    
    logger.info("📋 Créditos específicos a procesar:")
    for cred in sorted(lista_creditos_normalizada):
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles: {len(hojas_disponibles)}")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos_normalizada),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}  # key = creditoBase, value = {data, hoja, credito_buscado}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS
    logger.titulo("🔍 BÚSQUEDA EN HOJAS")
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        logger.separador("─")
        logger.subtitulo(f"📋 Procesando: {nombre_hoja}")
        
        # 🔥 USAR EL MÉTODO QUE YA FUNCIONA
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        logger.info(f"✅ Créditos agrupados: {len(creditos_data)}")
        
        encontrados_en_esta_hoja = 0
        
        # 🎯 FILTRAR solo los créditos que estamos buscando
        for credito_key, credito_info in creditos_data.items():
            
            # Normalizar credito_key
            credito_key_norm = credito_key.strip().upper()
            
            # Obtener todos los CreditoSIFCO de las filas (ya normalizados por leer_hoja_excel)
            creditos_en_filas = set(
                str(f.get('CreditoSIFCO', '')).strip().upper() 
                for f in credito_info['filas']
            )
            
            # 🔥 BUSCAR MATCH con cualquier crédito de la lista
            credito_match = None
            for credito_buscado in lista_creditos_normalizada:
                if (credito_buscado == credito_key_norm or 
                    credito_buscado in creditos_en_filas or
                    credito_key_norm.startswith(credito_buscado) or
                    credito_buscado.startswith(credito_key_norm)):
                    
                    credito_match = credito_buscado
                    break
            
            # Si encontramos match y no lo hemos agregado antes
            if credito_match and credito_key not in creditos_encontrados:
                logger.success(f"✅ ENCONTRADO: {credito_match}")
                logger.info(f"   → Agrupado como: {credito_key}", indent=1)
                logger.info(f"   → Cliente: {credito_info['cliente'][:50]}...", indent=1)
                logger.info(f"   → Filas: {len(credito_info['filas'])}", indent=1)
                
                creditos_encontrados[credito_key] = {
                    'data': credito_info,
                    'hoja': nombre_hoja,
                    'credito_buscado': credito_match
                }
                stats_globales['creditos_encontrados'] += 1
                encontrados_en_esta_hoja += 1
        
        logger.info(f"\n📊 Encontrados en {nombre_hoja}: {encontrados_en_esta_hoja}")
    
    # 🔥 RESUMEN DE BÚSQUEDA
    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_encontrados_set = set(v['credito_buscado'] for v in creditos_encontrados.values())
    creditos_no_encontrados = lista_creditos_normalizada - creditos_encontrados_set
    
    if creditos_no_encontrados:
        logger.warning(f"❌ NO encontrados: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = list(creditos_no_encontrados)
        logger.indent()
        for cred in sorted(creditos_no_encontrados):
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito")
        logger.error("   Verificá que los números sean correctos")
        return
    
    # 🚀 ENVIAR A LA API UNO POR UNO
    logger.titulo("🚀 ENVÍO A LA API")
    logger.info(f"📤 Créditos a enviar: {len(creditos_encontrados)}\n")
    
    for idx, (credito_key, info) in enumerate(creditos_encontrados.items(), 1):
        logger.separador("─")
        logger.subtitulo(f"📋 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        logger.info(f"📂 Hoja: {info['hoja']}")
        
        # 🔥 ENVIAR USANDO EL MÉTODO QUE YA FUNCIONA
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL")
    logger.separador("=")
    
    logger.subtitulo("📊 BÚSQUEDA:")
    logger.info(f"   Hojas: {stats_globales['hojas_procesadas']}")
    logger.info(f"   Buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados: {len(stats_globales['creditos_no_encontrados_excel'])}")
    
    logger.separador()
    logger.subtitulo("🚀 ENVÍO:")
    logger.info(f"   Procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente'][:40]}...)")
    
    logger.separador("=")
    logger.success(f"\n✅ Logs: {ARCHIVO_LOG}")
    """
    Procesa solo los créditos que estén en la lista
    SIMPLE: Busca por creditoBase directo
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # 🔥 NORMALIZAR lista de créditos buscados
    lista_creditos_normalizada = set(c.strip().upper() for c in lista_creditos)
    
    logger.info("📋 Créditos específicos a procesar (normalizados):")
    for cred in sorted(lista_creditos_normalizada):
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles: {len(hojas_disponibles)}")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos_normalizada),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS
    logger.titulo("🔍 BÚSQUEDA EN HOJAS")
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        logger.separador("─")
        logger.subtitulo(f"📋 Procesando: {nombre_hoja}")
        
        # 🔥 USAR leer_hoja_excel (que ya busca headers correctamente)
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        logger.info(f"✅ Créditos agrupados: {len(creditos_data)}")
        
        encontrados_en_esta_hoja = 0
        
        # 🔥 BUSCAR DIRECTAMENTE EN LAS KEYS
        for credito_key, credito_info in creditos_data.items():
            
            # Normalizar la key
            credito_key_normalizado = credito_key.strip().upper()
            
            # 🔥 MATCH DIRECTO: ¿Está en la lista?
            if credito_key_normalizado in lista_creditos_normalizada:
                
                logger.success(f"✅ ENCONTRADO: {credito_key_normalizado}")
                logger.info(f"   → Cliente: {credito_info['cliente'][:50]}...", indent=1)
                logger.info(f"   → Filas: {len(credito_info['filas'])}", indent=1)
                
                # Guardar
                creditos_encontrados[credito_key] = {
                    'data': credito_info,
                    'hoja': nombre_hoja,
                    'credito_buscado': credito_key_normalizado
                }
                stats_globales['creditos_encontrados'] += 1
                encontrados_en_esta_hoja += 1
        
        logger.info(f"\n📊 Encontrados en {nombre_hoja}: {encontrados_en_esta_hoja}")
    
    # 🔥 RESUMEN DE BÚSQUEDA
    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_encontrados_set = set(v['credito_buscado'] for v in creditos_encontrados.values())
    creditos_no_encontrados = lista_creditos_normalizada - creditos_encontrados_set
    
    if creditos_no_encontrados:
        logger.warning(f"❌ NO encontrados: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = list(creditos_no_encontrados)
        logger.indent()
        for cred in sorted(creditos_no_encontrados):
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito")
        return
    
    # 🚀 ENVIAR A LA API
    logger.titulo("🚀 ENVÍO A LA API")
    logger.info(f"📤 Créditos a enviar: {len(creditos_encontrados)}\n")
    
    for idx, (credito_key, info) in enumerate(creditos_encontrados.items(), 1):
        logger.separador("─")
        logger.subtitulo(f"📋 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        logger.info(f"📂 Hoja: {info['hoja']}")
        
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL")
    logger.separador("=")
    
    logger.subtitulo("📊 BÚSQUEDA:")
    logger.info(f"   Hojas: {stats_globales['hojas_procesadas']}")
    logger.info(f"   Buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados: {len(stats_globales['creditos_no_encontrados_excel'])}")
    
    logger.separador()
    logger.subtitulo("🚀 ENVÍO:")
    logger.info(f"   Procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente'][:40]}...)")
    
    logger.separador("=")
    logger.success(f"\n✅ Logs: {ARCHIVO_LOG}")
    """
    Procesa solo los créditos que estén en la lista
    SIMPLE: Busca por creditoBase directo
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # 🔥 NORMALIZAR lista de créditos buscados
    lista_creditos_normalizada = set(c.strip().upper() for c in lista_creditos)
    
    logger.info("📋 Créditos específicos a procesar (normalizados):")
    for cred in sorted(lista_creditos_normalizada):
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles: {len(hojas_disponibles)}")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos_normalizada),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS
    logger.titulo("🔍 BÚSQUEDA EN HOJAS")
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        logger.separador("─")
        logger.subtitulo(f"📋 Procesando: {nombre_hoja}")
        
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        logger.info(f"✅ Créditos agrupados: {len(creditos_data)}")
        
        encontrados_en_esta_hoja = 0
        
        # 🔥 BUSCAR DIRECTAMENTE EN LAS KEYS
        for credito_key, credito_info in creditos_data.items():
            
            # Normalizar la key
            credito_key_normalizado = credito_key.strip().upper()
            
            # 🔥 MATCH DIRECTO: ¿Está en la lista?
            if credito_key_normalizado in lista_creditos_normalizada:
                
                logger.success(f"✅ ENCONTRADO: {credito_key_normalizado}")
                logger.info(f"   → Cliente: {credito_info['cliente'][:50]}...", indent=1)
                logger.info(f"   → Filas: {len(credito_info['filas'])}", indent=1)
                
                # Guardar
                creditos_encontrados[credito_key] = {
                    'data': credito_info,
                    'hoja': nombre_hoja,
                    'credito_buscado': credito_key_normalizado
                }
                stats_globales['creditos_encontrados'] += 1
                encontrados_en_esta_hoja += 1
        
        logger.info(f"\n📊 Encontrados en {nombre_hoja}: {encontrados_en_esta_hoja}")
    
    # 🔥 RESUMEN DE BÚSQUEDA
    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_encontrados_set = set(v['credito_buscado'] for v in creditos_encontrados.values())
    creditos_no_encontrados = lista_creditos_normalizada - creditos_encontrados_set
    
    if creditos_no_encontrados:
        logger.warning(f"❌ NO encontrados: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = list(creditos_no_encontrados)
        logger.indent()
        for cred in sorted(creditos_no_encontrados):
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito")
        return
    
    # 🚀 ENVIAR A LA API
    logger.titulo("🚀 ENVÍO A LA API")
    logger.info(f"📤 Créditos a enviar: {len(creditos_encontrados)}\n")
    
    for idx, (credito_key, info) in enumerate(creditos_encontrados.items(), 1):
        logger.separador("─")
        logger.subtitulo(f"📋 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        logger.info(f"📂 Hoja: {info['hoja']}")
        
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL")
    logger.separador("=")
    
    logger.subtitulo("📊 BÚSQUEDA:")
    logger.info(f"   Hojas: {stats_globales['hojas_procesadas']}")
    logger.info(f"   Buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados: {len(stats_globales['creditos_no_encontrados_excel'])}")
    
    logger.separador()
    logger.subtitulo("🚀 ENVÍO:")
    logger.info(f"   Procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente'][:40]}...)")
    
    logger.separador("=")
    logger.success(f"\n✅ Logs: {ARCHIVO_LOG}")
    """
    Procesa solo los créditos que estén en la lista
    Busca en TODAS las hojas, detecta pools, agrupa y envía
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # 🔥 NORMALIZAR lista de créditos buscados
    lista_creditos_normalizada = [c.strip().upper() for c in lista_creditos]
    
    logger.info("📋 Créditos específicos a procesar (normalizados):")
    for cred in lista_creditos_normalizada:
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles: {len(hojas_disponibles)}")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos_normalizada),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS
    logger.titulo("🔍 BÚSQUEDA EN HOJAS")
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        logger.separador("─")
        logger.subtitulo(f"📋 Procesando: {nombre_hoja}")
        
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        logger.info(f"✅ Créditos agrupados: {len(creditos_data)}")
        
        encontrados_en_esta_hoja = 0
        
        # 🎯 BUSCAR cada crédito en los datos agrupados
        for credito_buscado in lista_creditos_normalizada:
            
            # 🔥 Iterar TODOS los créditos agrupados
            for credito_key, credito_info in creditos_data.items():
                
                # Normalizar credito_key para comparar
                credito_key_normalizado = credito_key.strip().upper()
                
                # Obtener todos los CreditoSIFCO de las filas
                creditos_sifco_en_filas = set(
                    str(f.get('CreditoSIFCO', '')).strip().upper() 
                    for f in credito_info['filas']
                )
                
                # 🔥 MATCH con normalización
                match_encontrado = (
                    credito_buscado in creditos_sifco_en_filas or
                    credito_buscado == credito_key_normalizado or
                    credito_buscado in credito_key_normalizado or
                    credito_key_normalizado in credito_buscado or
                    # 🔥 También buscar sin normalizar (por si acaso)
                    credito_buscado.strip() == credito_key.strip()
                )
                
                # 🔥 Solo agregar UNA VEZ (usar credito_buscado como key para evitar duplicados)
                if match_encontrado and credito_buscado not in [v['credito_buscado'] for v in creditos_encontrados.values()]:
                    logger.success(f"✅ ENCONTRADO: {credito_buscado}")
                    logger.info(f"   → Agrupado como: {credito_key}", indent=1)
                    logger.info(f"   → Cliente: {credito_info['cliente'][:50]}...", indent=1)
                    logger.info(f"   → Filas: {len(credito_info['filas'])}", indent=1)
                    
                    # Usar credito_key como key del dict (único por crédito base)
                    creditos_encontrados[credito_key] = {
                        'data': credito_info,
                        'hoja': nombre_hoja,
                        'credito_buscado': credito_buscado
                    }
                    stats_globales['creditos_encontrados'] += 1
                    encontrados_en_esta_hoja += 1
                    break  # Ya encontramos este credito_buscado, salir del loop de credito_key
        
        logger.info(f"\n📊 Encontrados en {nombre_hoja}: {encontrados_en_esta_hoja}")
    
    # 🔥 RESUMEN DE BÚSQUEDA
    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_encontrados_set = set(v['credito_buscado'] for v in creditos_encontrados.values())
    creditos_no_encontrados = [
        c for c in lista_creditos_normalizada 
        if c not in creditos_encontrados_set
    ]
    
    if creditos_no_encontrados:
        logger.warning(f"❌ NO encontrados: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = creditos_no_encontrados
        logger.indent()
        for cred in creditos_no_encontrados:
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito")
        return
    
    # 🚀 ENVIAR A LA API
    logger.titulo("🚀 ENVÍO A LA API")
    logger.info(f"📤 Créditos a enviar: {len(creditos_encontrados)}\n")
    
    for idx, (credito_key, info) in enumerate(creditos_encontrados.items(), 1):
        logger.separador("─")
        logger.subtitulo(f"📋 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        logger.info(f"📂 Hoja: {info['hoja']}")
        
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL")
    logger.separador("=")
    
    logger.subtitulo("📊 BÚSQUEDA:")
    logger.info(f"   Hojas: {stats_globales['hojas_procesadas']}")
    logger.info(f"   Buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados: {len(stats_globales['creditos_no_encontrados_excel'])}")
    
    logger.separador()
    logger.subtitulo("🚀 ENVÍO:")
    logger.info(f"   Procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente'][:40]}...)")
    
    logger.separador("=")
    logger.success(f"\n✅ Logs: {ARCHIVO_LOG}")
    """
    Procesa solo los créditos que estén en la lista
    Busca en TODAS las hojas, detecta pools, agrupa y envía
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"📅 Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # Mostrar lista de créditos
    logger.info("📋 Créditos específicos a procesar:")
    for cred in lista_creditos:
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles en el archivo:")
        for hoja in hojas_disponibles:
            logger.info(f"   - {hoja}")
        logger.info("")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS
    logger.titulo("🔍 FASE 1: BÚSQUEDA EN HOJAS")
    
    for nombre_hoja in HOJAS_A_PROCESAR:
        if nombre_hoja not in hojas_disponibles:
            logger.warning(f"⚠️ Hoja '{nombre_hoja}' no encontrada, saltando...")
            continue
        
        logger.separador("─")
        logger.subtitulo(f"📋 Procesando hoja: {nombre_hoja}")
        
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
        if not creditos_data:
            logger.warning(f"⚠️ No se encontraron datos en la hoja {nombre_hoja}")
            continue
        
        stats_globales['hojas_procesadas'] += 1
        logger.info(f"✅ Créditos agrupados en esta hoja: {len(creditos_data)}")
        
        # 🎯 FILTRAR solo los créditos de la lista
        encontrados_en_esta_hoja = 0
        
        for credito_key, credito_info in creditos_data.items():
            # Verificar si alguna fila del crédito agrupado matchea con la lista
            creditos_sifco_en_filas = set(
                f.get('CreditoSIFCO', '') for f in credito_info['filas']
            )
            
            # 🔥 BUSCAR MATCH CON CUALQUIER CRÉDITO DE LA LISTA
            for credito_buscado in lista_creditos:
                # Match encontrado si:
                # 1. El crédito buscado está en los CreditoSIFCO de las filas
                # 2. El crédito buscado es igual a la clave (credito_key)
                # 3. La clave está dentro del crédito buscado (para variaciones)
                # 4. El crédito buscado está dentro de la clave (para pools raros)
                
                match_encontrado = (
                    credito_buscado in creditos_sifco_en_filas or
                    credito_buscado == credito_key or
                    credito_key in credito_buscado or
                    credito_buscado in credito_key
                )
                
                # 🔥 Solo agregar si NO lo hemos encontrado antes
                if match_encontrado and credito_key not in creditos_encontrados:
                    logger.success(f"✅ ENCONTRADO: {credito_buscado}")
                    logger.info(f"   → Agrupado como: {credito_key}", indent=1)
                    logger.info(f"   → Cliente: {credito_info['cliente']}", indent=1)
                    logger.info(f"   → Filas en pool: {len(credito_info['filas'])}", indent=1)
                    logger.debug(f"   → CreditoSIFCO en filas: {creditos_sifco_en_filas}", indent=1)
                    
                    creditos_encontrados[credito_key] = {
                        'data': credito_info,
                        'hoja': nombre_hoja,
                        'credito_buscado': credito_buscado
                    }
                    stats_globales['creditos_encontrados'] += 1
                    encontrados_en_esta_hoja += 1
                    break  # Ya encontramos este credito_key, salir del loop de creditos_buscado
        
        logger.info(f"\n📊 Encontrados en {nombre_hoja}: {encontrados_en_esta_hoja}")
    
    # 🔥 RESUMEN DE BÚSQUEDA (FUERA del loop de hojas)
    logger.separador("=")
    logger.titulo("🎯 RESUMEN DE BÚSQUEDA")
    logger.info(f"📋 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"✅ Encontrados en Excel: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_no_encontrados = [
        c for c in lista_creditos 
        if not any(
            c in k or 
            c == v['credito_buscado'] or 
            k in c or 
            c == credito_info.get('data', {}).get('creditoBase', '')
            for k, v in creditos_encontrados.items()
            for credito_info in [v]
        )
    ]
    
    if creditos_no_encontrados:
        logger.warning(f"❌ NO encontrados en Excel: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = creditos_no_encontrados
        logger.indent()
        for cred in creditos_no_encontrados:
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito de la lista en el Excel")
        logger.error("   Verificá que:")
        logger.error("   1. Los números de crédito sean correctos")
        logger.error("   2. Estén en las hojas configuradas en HOJAS_A_PROCESAR")
        logger.error("   3. No tengan espacios o caracteres especiales")
        return
    
    # 🚀 ENVIAR A LA API
    logger.titulo("🚀 FASE 2: ENVÍO A LA API")
    logger.info(f"📤 Créditos a enviar: {len(creditos_encontrados)}\n")
    
    for idx, (credito_key, info) in enumerate(creditos_encontrados.items(), 1):
        logger.separador("─")
        logger.subtitulo(f"📋 Crédito {idx}/{len(creditos_encontrados)}")
        logger.info(f"🔍 Buscado originalmente: {info['credito_buscado']}")
        logger.info(f"📂 Origen: Hoja '{info['hoja']}'")
        logger.info(f"🔢 Agrupado como: {credito_key}")
        
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            # Recopilar inversionistas no encontrados
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL - MODO ESPECÍFICO")
    logger.separador("=")
    
    logger.subtitulo("📊 BÚSQUEDA EN EXCEL:")
    logger.info(f"   Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"   Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados: {len(stats_globales['creditos_no_encontrados_excel'])}")
        logger.indent()
        for cred in stats_globales['creditos_no_encontrados_excel']:
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador()
    logger.subtitulo("🚀 ENVÍO A LA API:")
    logger.info(f"   Créditos procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    # Mostrar inversionistas no encontrados
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        logger.separador()
        
        # Agrupar por inversionista
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente']})")
    
    logger.separador("=")
    logger.success(f"\n✅ Logs guardados en: {ARCHIVO_LOG}")
    logger.separador()
    """
    Procesa solo los créditos que estén en la lista
    Busca en TODAS las hojas, detecta pools, agrupa y envía
    """
    modo_texto = "🧪 MODO PRUEBA" if MODO_PRUEBA else "🎯 MODO ESPECÍFICO"
    
    logger.titulo(f"{modo_texto} - {modo_nombre}")
    logger.info(f"📂 Carpeta: {CARPETA_EXCELS}")
    logger.info(f"📄 Archivo: {ARCHIVO_EXCEL}")
    logger.info(f"🔗 API: {api_endpoint}")
    logger.info(f"📅 Hojas a procesar: {len(HOJAS_A_PROCESAR)}")
    logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}")
    logger.separador()
    
    # Mostrar lista de créditos
    logger.info("📋 Créditos específicos a procesar:")
    for cred in lista_creditos:
        logger.info(f"   • {cred}")
    logger.separador()
    
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    if not os.path.exists(archivo_path):
        logger.error(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    try:
        xls = pd.ExcelFile(archivo_path)
        hojas_disponibles = xls.sheet_names
        logger.info(f"📋 Hojas disponibles en el archivo:")
        for hoja in hojas_disponibles:
            logger.info(f"   - {hoja}")
        logger.info("")
    except Exception as e:
        logger.error(f"❌ Error leyendo archivo: {e}")
        return
    
    stats_globales = {
        'hojas_procesadas': 0,
        'creditos_buscados': len(lista_creditos),
        'creditos_encontrados': 0,
        'creditos_no_encontrados_excel': [],
        'creditos_procesados': 0,
        'creditos_exitosos': 0,
        'creditos_fallidos': 0,
        'inversionistas_no_encontrados': []
    }
    
    creditos_encontrados = {}
    
    # 🔍 BUSCAR EN TODAS LAS HOJAS

    for nombre_hoja in HOJAS_A_PROCESAR:
        logger.info(f"\n📋 Hoja: {nombre_hoja}")
        
        try:
            df = pd.read_excel(archivo_path, sheet_name=nombre_hoja)
            
            # Buscar columna de crédito
            col_credito = None
            for col in df.columns:
                if 'credito' in str(col).lower() and 'sifco' in str(col).lower():
                    col_credito = col
                    break
            
            if not col_credito:
                logger.warning(f"⚠️ No se encontró columna de crédito en {nombre_hoja}")
                continue
            
            # Buscar cada crédito
            for credito_buscar in lista_creditos:
                filas_encontradas = df[df[col_credito].astype(str).str.contains(credito_buscar, na=False)]
                
                if len(filas_encontradas) > 0:
                    logger.success(f"✅ {credito_buscar} → Encontrado en {len(filas_encontradas)} fila(s)")
                    for idx, row in filas_encontradas.iterrows():
                        logger.info(f"   Fila {idx}: {row[col_credito]}", indent=1)
        
        except Exception as e:
            logger.error(f"Error en {nombre_hoja}: {e}")
    
    # 🔥 PROCESAR LOS CRÉDITOS ENCONTRADOS
    logger.separador("=")
    logger.success(f"\n🎯 RESUMEN DE BÚSQUEDA:")
    logger.info(f"   Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados: {stats_globales['creditos_encontrados']}")
    
    # Detectar NO encontrados
    creditos_no_encontrados = [
        c for c in lista_creditos 
        if not any(c in k or c == v['credito_buscado'] or k in c
                  for k, v in creditos_encontrados.items())
    ]
    
    if creditos_no_encontrados:
        logger.warning(f"   ❌ NO encontrados en Excel: {len(creditos_no_encontrados)}")
        stats_globales['creditos_no_encontrados_excel'] = creditos_no_encontrados
        logger.indent()
        for cred in creditos_no_encontrados:
            logger.warning(f"• {cred}")
        logger.dedent()
    
    logger.separador("=")
    
    if not creditos_encontrados:
        logger.error("\n❌ No se encontró ningún crédito de la lista en el Excel")
        return
    
    # 🚀 ENVIAR A LA API
    logger.info(f"\n🚀 PROCESANDO {len(creditos_encontrados)} CRÉDITO(S)...\n")
    
    for credito_key, info in creditos_encontrados.items():
        logger.separador("─")
        logger.info(f"📋 Origen: Hoja '{info['hoja']}'")
        logger.info(f"🔍 Buscado: {info['credito_buscado']}")
        
        resultado = enviar_credito_a_api(info['data'], api_endpoint)
        
        stats_globales['creditos_procesados'] += 1
        
        if resultado.get('success'):
            stats_globales['creditos_exitosos'] += 1
            
            if 'inversionistas_no_encontrados' in resultado:
                no_encontrados = resultado['inversionistas_no_encontrados']
                if no_encontrados:
                    stats_globales['inversionistas_no_encontrados'].extend([
                        {
                            'credito': info['data']['creditoBase'],
                            'cliente': info['data']['cliente'],
                            'inversionista': inv
                        }
                        for inv in no_encontrados
                    ])
        else:
            stats_globales['creditos_fallidos'] += 1
        
        logger.separador("─")
    
    # RESUMEN FINAL
    logger.titulo("🎉 RESUMEN FINAL - MODO ESPECÍFICO")
    logger.info(f"📊 Hojas procesadas: {stats_globales['hojas_procesadas']}")
    logger.info(f"🔍 Créditos buscados: {stats_globales['creditos_buscados']}")
    logger.success(f"   ✅ Encontrados en Excel: {stats_globales['creditos_encontrados']}")
    if stats_globales['creditos_no_encontrados_excel']:
        logger.warning(f"   ❌ NO encontrados en Excel: {len(stats_globales['creditos_no_encontrados_excel'])}")
    logger.info(f"\n📋 Créditos procesados: {stats_globales['creditos_procesados']}")
    logger.success(f"   ✅ Exitosos: {stats_globales['creditos_exitosos']}")
    logger.error(f"   ❌ Fallidos: {stats_globales['creditos_fallidos']}")
    
    # Mostrar inversionistas no encontrados
    if stats_globales['inversionistas_no_encontrados']:
        logger.separador()
        logger.warning(f"⚠️ INVERSIONISTAS NO ENCONTRADOS: {len(stats_globales['inversionistas_no_encontrados'])}")
        logger.separador()
        
        por_inversionista = defaultdict(list)
        for item in stats_globales['inversionistas_no_encontrados']:
            por_inversionista[item['inversionista']].append({
                'credito': item['credito'],
                'cliente': item['cliente']
            })
        
        for inversionista, creditos in sorted(por_inversionista.items()):
            logger.warning(f"\n❌ {inversionista}")
            for cred in creditos:
                logger.warning(f"   - {cred['credito']} ({cred['cliente']})")
    
    logger.separador()
    logger.success(f"\n✅ Logs guardados en: {ARCHIVO_LOG}")
# ============================================
# 🎯 MENÚ PRINCIPAL
# ============================================
# ============================================
# 🎯 MENÚ PRINCIPAL (ACTUALIZADO)
# ============================================
def mostrar_menu():
    """Muestra el menú de opciones y retorna la selección del usuario"""
    logger.titulo("PROCESADOR DE EXCEL - CASH-IN")
    logger.info("\n📋 Seleccioná el modo de procesamiento:\n")
    print("   1️⃣  Procesar CRÉDITOS COMPLETOS (con SIFCO + Inversionistas)")
    print("      └─ Endpoint: /processUniqueCredit")
    print("      └─ Consulta SIFCO, crea/actualiza crédito e inversionistas\n")
    print("   2️⃣  Procesar SOLO INVERSIONISTAS (crédito debe existir)")
    print("      └─ Endpoint: /processInvestorsOnly")
    print("      └─ NO toca SIFCO, solo actualiza inversionistas del crédito\n")
    print("   3️⃣  Procesar CRÉDITOS ESPECÍFICOS (desde lista de errores)")  # 👈 NUEVA OPCIÓN
    print("      └─ Busca créditos específicos en Excel")
    print("      └─ Detecta pools, agrupa y envía a la API\n")
    print("   0️⃣  Salir\n")
    logger.separador()
    
    while True:
        respuesta = input("\n👉 Ingresá tu opción (1/2/3/0): ").strip()  # 👈 AGREGADO EL 3
        
        if respuesta in ['1', '2', '3', '0']:  # 👈 AGREGADO EL 3
            logger.info(f"Usuario seleccionó opción: {respuesta}")
            return respuesta
        else:
            logger.warning("❌ Opción inválida")

# ============================================
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    logger.titulo("🔥 PROCESADOR UNIFICADO - POOLS NORMALES Y RAROS")
    logger.warning("⚠️ Asegurate que tu backend Elysia esté corriendo en el puerto 7000\n")
    
    if MODO_PRUEBA:
        logger.warning(f"🧪 MODO PRUEBA ACTIVADO")
        logger.warning(f"   - Solo se procesará {LIMITE_CREDITOS_PRUEBA} crédito(s) por hoja")
        logger.warning(f"   - Para procesar todos, cambiá MODO_PRUEBA = False en el código\n")
    
    # Mostrar info de decisiones guardadas
    decisiones = cargar_decisiones()
    if decisiones:
        logger.info(f"💾 Decisiones guardadas: {len(decisiones)} inversionistas")
        logger.info(f"   (Se usarán automáticamente cuando aparezcan de nuevo)\n")
    
    logger.success(f"📝 Los logs se guardarán en: {ARCHIVO_LOG}\n")
    
    # 🔥 ARRAY DE CRÉDITOS CON ERRORES (HARD-CODED)
    CREDITOS_CON_ERRORES = [
        "01010214113080",
        "01010214104860",
        "01010214108880",
        "01010214112940",
        "01010214115390",
        "01010214115130",
        "01010214105300",
        "01010214105290",
        "01010214109390",
        "01010214108500",
        "01010214117400",
        "01010214105880",
        "01010202109070"
    ]
    
    try:
        while True:
            opcion = mostrar_menu()
            
            if opcion == '0':
                logger.info("\n👋 ¡Hasta luego!")
                break
            
            elif opcion == '1':
                logger.success("\n✅ Modo seleccionado: CRÉDITOS COMPLETOS")
                api_endpoint = "http://localhost:7000/processUniqueCredit"
                modo_nombre = "Créditos Completos (SIFCO + Inversionistas)"

                logger.info("\n📋 ¿Qué querés procesar?\n")
                print("   1. Todo (individuales + pools normales + pools raros)")
                print("   2. Solo pools raros\n")
                sub = input("👉 Elegí (1/2): ").strip()
                solo_pools = sub == '2'
                if solo_pools:
                    modo_nombre += " [SOLO POOLS RAROS]"
                    logger.warning("🔥 Modo: SOLO POOLS RAROS")

                input("\n📌 Presiona ENTER para continuar...")
                procesar_multiples_hojas(api_endpoint, modo_nombre, solo_pools_raros=solo_pools)

                input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
            
            elif opcion == '2':
                logger.success("\n✅ Modo seleccionado: SOLO INVERSIONISTAS")
                api_endpoint = "http://localhost:7000/processInvestorsOnly"
                modo_nombre = "Solo Inversionistas (sin SIFCO)"

                logger.info("\n📋 ¿Qué querés procesar?\n")
                print("   1. Todo (individuales + pools normales + pools raros)")
                print("   2. Solo pools raros\n")
                sub = input("👉 Elegí (1/2): ").strip()
                solo_pools = sub == '2'
                if solo_pools:
                    modo_nombre += " [SOLO POOLS RAROS]"
                    logger.warning("🔥 Modo: SOLO POOLS RAROS")

                logger.warning("\n⚠️ IMPORTANTE:")
                logger.warning("   - Los créditos DEBEN existir en la base de datos")
                logger.warning("   - Solo se actualizarán los inversionistas")
                logger.warning("   - NO se consultará SIFCO\n")

                confirmacion = input("¿Estás seguro de continuar? (s/n): ").strip().lower()

                if confirmacion == 's':
                    logger.info("Usuario confirmó operación")
                    procesar_multiples_hojas(api_endpoint, modo_nombre, solo_pools_raros=solo_pools)
                    input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
                else:
                    logger.warning("\n❌ Operación cancelada por el usuario")
            
            # 🔥 NUEVO MODO 3 - CRÉDITOS ESPECÍFICOS
            elif opcion == '3':
                logger.success("\n✅ Modo seleccionado: CRÉDITOS ESPECÍFICOS")
                
                logger.info("\n📋 Opciones de entrada:\n")
                print("   1. Usar lista hard-coded de 13 créditos con errores")
                print("   2. Pegar JSON de errores")
                print("      • Formato 1: {\"detalleErrores\": [{\"numeroPrestamo\": \"...\"}, ...]}")
                print("      • Formato 2: [{\"numeroPrestamo\": \"...\"}, ...] (array directo)")
                print("   3. Ingresar lista manual de créditos (separados por comas)")
                print("   4. Leer desde archivo JSON\n")
                
                sub_opcion = input("👉 Elegí una opción (1/2/3/4): ").strip()
                
                lista_creditos = []
                
                if sub_opcion == '1':
                    # 🔥 USAR LISTA HARD-CODED
                    lista_creditos = CREDITOS_CON_ERRORES.copy()
                    logger.success(f"✅ Usando lista hard-coded: {len(lista_creditos)} créditos")
                    logger.info("\n📋 Créditos a procesar:")
                    for cred in lista_creditos:
                        logger.info(f"   • {cred}")
                
                elif sub_opcion == '2':
                    logger.info("\n📝 Pegá el JSON y presioná ENTER dos veces:")
                    logger.info("(Acepta array directo o con wrapper 'detalleErrores')\n")
                    
                    lineas = []
                    while True:
                        linea = input()
                        if linea.strip() == '':
                            break
                        lineas.append(linea)
                    
                    json_texto = '\n'.join(lineas)
                    
                    try:
                        data = json.loads(json_texto)
                        
                        # 🔥 SOPORTAR DOS FORMATOS
                        if isinstance(data, list):
                            # Formato directo: [{...}, {...}]
                            lista_creditos = [
                                item['numeroPrestamo'] 
                                for item in data
                                if isinstance(item, dict) and 'numeroPrestamo' in item
                            ]
                            logger.success(f"✅ Array directo detectado")
                        elif isinstance(data, dict) and 'detalleErrores' in data:
                            # Formato con wrapper: {"detalleErrores": [{...}]}
                            lista_creditos = [
                                item['numeroPrestamo'] 
                                for item in data['detalleErrores']
                                if 'numeroPrestamo' in item
                            ]
                            logger.success(f"✅ Formato con 'detalleErrores' detectado")
                        else:
                            logger.error("❌ Formato JSON no reconocido")
                            logger.error("   Esperado: array directo o {\"detalleErrores\": [...]}")
                            continue
                        
                        logger.success(f"✅ Se encontraron {len(lista_creditos)} créditos")
                        
                    except json.JSONDecodeError as e:
                        logger.error(f"❌ Error parseando JSON: {e}")
                        continue
                
                elif sub_opcion == '3':
                    logger.info("\n📝 Ingresá los números de crédito separados por comas:")
                    entrada = input("👉 ").strip()
                    lista_creditos = [c.strip() for c in entrada.split(',') if c.strip()]
                    logger.success(f"✅ Se ingresaron {len(lista_creditos)} créditos")
                
                elif sub_opcion == '4':
                    logger.info("\n📝 Ingresá la ruta del archivo JSON:")
                    ruta_archivo = input("👉 ").strip()
                    
                    try:
                        with open(ruta_archivo, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        
                        # 🔥 SOPORTAR DOS FORMATOS
                        if isinstance(data, list):
                            lista_creditos = [
                                item['numeroPrestamo'] 
                                for item in data
                                if isinstance(item, dict) and 'numeroPrestamo' in item
                            ]
                            logger.success(f"✅ Array directo detectado")
                        elif isinstance(data, dict) and 'detalleErrores' in data:
                            lista_creditos = [
                                item['numeroPrestamo'] 
                                for item in data['detalleErrores']
                                if 'numeroPrestamo' in item
                            ]
                            logger.success(f"✅ Formato con 'detalleErrores' detectado")
                        else:
                            logger.error("❌ Formato JSON no reconocido")
                            continue
                        
                        logger.success(f"✅ Se encontraron {len(lista_creditos)} créditos")
                        
                    except FileNotFoundError:
                        logger.error(f"❌ Archivo no encontrado: {ruta_archivo}")
                        continue
                    except json.JSONDecodeError as e:
                        logger.error(f"❌ Error parseando JSON: {e}")
                        continue
                else:
                    logger.warning("❌ Opción inválida")
                    continue
                
                if not lista_creditos:
                    logger.error("❌ No se ingresaron créditos")
                    continue
                
                # Elegir endpoint
                logger.info("\n🔗 Seleccioná el endpoint:\n")
                print("   1. /processUniqueCredit (SIFCO + Inversionistas)")
                print("   2. /processInvestorsOnly (Solo Inversionistas)\n")
                
                endpoint_opcion = input("👉 Elegí (1/2): ").strip()
                
                if endpoint_opcion == '1':
                    api_endpoint = "http://localhost:7000/processUniqueCredit"
                    modo_nombre = "Específicos - Completos (SIFCO + Inversionistas)"
                elif endpoint_opcion == '2':
                    api_endpoint = "http://localhost:7000/processInvestorsOnly"
                    modo_nombre = "Específicos - Solo Inversionistas"
                else:
                    logger.warning("❌ Opción inválida")
                    continue
                
                logger.info(f"\n📊 Endpoint: {api_endpoint}")
                logger.info(f"🎯 Créditos a buscar: {len(lista_creditos)}\n")
                
                confirmacion = input("¿Continuar? (s/n): ").strip().lower()
                
                if confirmacion == 's':
                    procesar_creditos_especificos(api_endpoint, modo_nombre, lista_creditos)
                    input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
                else:
                    logger.warning("\n❌ Operación cancelada")
                
    except KeyboardInterrupt:
        logger.warning("\n\n⚠️ Proceso interrumpido por el usuario (Ctrl+C)")
    except Exception as e:
        logger.error(f"\n❌ Error fatal: {e}")
        import traceback
        traceback.print_exc()
    finally:
        logger.separador()
        logger.success(f"📝 Logs completos guardados en: {ARCHIVO_LOG}")