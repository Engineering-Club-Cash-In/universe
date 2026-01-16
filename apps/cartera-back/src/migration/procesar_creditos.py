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
    "Diciembre 2025", 
    "Enero 2026",
    "Febrero 2026",
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
    col_formato: str = None  # Opcional ahora
) -> Dict[str, List[str]]:
    """
    Pool raro = MISMO CLIENTE + MISMO # + SIN variaciones (_2, _3)
    NO importa si está marcado como "pool" o no
    """
    logger.subtitulo("🔍 DETECTANDO POOLS RAROS", "🔍")
    
    # Validar columnas necesarias
    if not col_numero:
        logger.warning("⚠️ No se encontró columna #, no se pueden detectar pools")
        return {}
    
    logger.info("Criterio: MISMO CLIENTE + MISMO # + sin variaciones")
    
    # 🔥 NO filtrar por "pool" en formato, analizar TODAS las filas
    logger.info("\n🔎 Analizando TODAS las filas sin filtro de formato...")
    
    # Agrupar por CLIENTE + NÚMERO
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
        
        nombre_cliente = str(row[col_nombre]).strip()
        numero = str(row[col_numero]).strip()
        
        # Validar número
        if not numero or numero == 'nan' or numero == '':
            continue
        
        # Crear clave única: cliente||numero
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
    nombre_hoja: str
) -> Dict[str, Dict[str, Any]]:
    """
    Lee una hoja específica del Excel y agrupa filas por crédito.
    🔥 NORMALIZA todos los pools (normales y raros) al creditoBase
    """
    logger.titulo(f"PROCESANDO HOJA: {nombre_hoja}")
    
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
            col_normalizado = str(col).lower().replace('#', '').replace('crédito', 'credito').strip()
            
            if not col_credito and 'credito' in col_normalizado and 'sifco' in col_normalizado:
                col_credito = col
                logger.success(f"✅ Columna crédito SIFCO: '{col}'")
            
            if not col_nombre and 'nombre' in col_normalizado and 'formato' not in col_normalizado and 'inversionista' not in col_normalizado:
                col_nombre = col
                logger.success(f"✅ Columna nombre/cliente: '{col}'")
            
            if not col_numero and col_normalizado == '' and col == '#':
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
        
        if not col_nombre:
            logger.warning("⚠️ No se encontró columna de Nombre/Cliente")
        
        if not col_numero:
            logger.warning("⚠️ No se encontró columna de Número (#)")
            logger.warning("   Esto impedirá detectar pools raros")
        
        if not col_formato:
            logger.warning("⚠️ No se encontró columna de Formato crédito")
            logger.warning("   Esto impedirá detectar pools raros")
        
        if not col_inversionista:
            logger.warning("⚠️ No se encontró columna de Inversionista")
        
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
            pools_raros = detectar_pools_raros(df_clean, col_credito, col_nombre, col_numero, col_formato)
        else:
            logger.warning("\n⚠️ SALTANDO DETECCIÓN DE POOLS RAROS (faltan columnas)")
        
        # 🎯 AGRUPAR FILAS
        logger.subtitulo("🔄 AGRUPANDO FILAS POR CRÉDITO", "🔄")
        logger.indent()
        
        creditos_data = {}
        warnings_globales = []
        
        filas_procesadas = 0
        filas_skipped = 0
        
        for idx, row in df_clean.iterrows():
            numero_credito_raw = str(row[col_credito]).strip()
            
            if not numero_credito_raw or numero_credito_raw == '':
                filas_skipped += 1
                continue
            
            cliente = str(row[col_nombre]).strip() if col_nombre and row[col_nombre] else "Cliente Desconocido"
            numero = str(row[col_numero]).strip() if col_numero and row[col_numero] else ""
            
            # Convertir fila con mapeo
            fila_dict = {}
            for col in df.columns:
                valor = row[col]
                nombre_campo = MAPEO_COLUMNAS.get(col, col)
                fila_dict[nombre_campo] = convertir_valor(nombre_campo, valor)
            
            # 🔍 VALIDAR PORCENTAJES
            validacion = validar_porcentajes(fila_dict, numero_credito_raw)
            if not validacion['valido']:
                warnings_globales.extend(validacion['warnings'])
            
            # Usar fila corregida
            fila_dict = validacion['fila_corregida']
            
            # ============================================
            # 🔥 DETERMINAR AGRUPACIÓN Y NORMALIZACIÓN
            # ============================================
            
            # Caso 1: Pool normal (ya tiene _2, _3, etc.)
            if '_' in numero_credito_raw:
                numero_credito_base = numero_credito_raw.split('_')[0]
                numero_credito_final = numero_credito_base  # 🔥 Normalizar
                
                logger.debug(f"🟢 Pool normal: {numero_credito_raw} → Base: {numero_credito_base}")
            
            # Caso 2: Pool raro (mismo # mismo cliente)
            else:
                # 🔥 Buscar por clave única (cliente + número)
                clave_pool = f"{cliente}||{numero}" if numero else None
                
                if clave_pool and clave_pool in pools_raros and numero_credito_raw in pools_raros[clave_pool]:
                    creditos_del_pool = pools_raros[clave_pool]
                    numero_credito_base = creditos_del_pool[0]  # Primer crédito como base
                    numero_credito_final = creditos_del_pool[0]  # 🔥 TODOS usan el primero
                    
                    logger.warning(f"🟡 Pool raro: {numero_credito_raw} → Base: {numero_credito_base}")
                else:
                    # Crédito individual
                    numero_credito_base = numero_credito_raw
                    numero_credito_final = numero_credito_raw
                    
                    logger.debug(f"🔵 Individual: {numero_credito_raw}")
            
            # Crear/actualizar grupo
            if numero_credito_base not in creditos_data:
                creditos_data[numero_credito_base] = {
                    'creditoBase': numero_credito_base,
                    'cliente': cliente,
                    'filas': []
                }
            
            # 🔥 Agregar fila con CreditoSIFCO normalizado
            fila_dict['CreditoSIFCO'] = numero_credito_final
            creditos_data[numero_credito_base]['filas'].append(fila_dict)
            
            filas_procesadas += 1
        
        logger.dedent()
        
        logger.success(f"\n✅ AGRUPACIÓN COMPLETADA:")
        logger.info(f"   • Filas procesadas: {filas_procesadas}", indent=1)
        logger.info(f"   • Filas ignoradas: {filas_skipped}", indent=1)
        logger.info(f"   • Créditos únicos: {len(creditos_data)}", indent=1)
        
        # Estadísticas de agrupación
        pools_normales = 0
        pools_raros_convertidos = 0
        individuales = 0
        
        for credito_key, credito_data in creditos_data.items():
            num_filas = len(credito_data['filas'])
            
            if num_filas > 1:
                # Verificar si era pool raro
                cliente_credito = credito_data['cliente']
                
                # Buscar en pools raros
                es_pool_raro = False
                for clave_pool in pools_raros.keys():
                    if cliente_credito in clave_pool and credito_key in pools_raros[clave_pool]:
                        es_pool_raro = True
                        break
                
                if es_pool_raro:
                    pools_raros_convertidos += 1
                else:
                    pools_normales += 1
            else:
                individuales += 1
        
        logger.info(f"\n📊 ESTADÍSTICAS:")
        logger.info(f"   🔵 Créditos individuales: {individuales}", indent=1)
        logger.info(f"   🟢 Pools normales: {pools_normales}", indent=1)
        logger.info(f"   🟡 Pools raros normalizados: {pools_raros_convertidos}", indent=1)
        
        if warnings_globales:
            logger.warning(f"\n⚠️ Total de warnings: {len(warnings_globales)}")
        
        # Mostrar ejemplos
        logger.info(f"\n📋 PRIMEROS 5 CRÉDITOS AGRUPADOS:")
        logger.indent()
        
        for credito_key, credito_data in list(creditos_data.items())[:5]:
            creditos_en_filas = set(f.get('CreditoSIFCO', '') for f in credito_data['filas'])
            inversionistas_en_pool = set(f.get('Inversionista', 'N/A') for f in credito_data['filas'])
            
            logger.info(f"📋 {credito_data['creditoBase']}: {credito_data['cliente']}")
            logger.info(f"   Filas: {len(credito_data['filas'])}", indent=1)
            logger.info(f"   CreditoSIFCO en filas: {', '.join(sorted(creditos_en_filas))}", indent=1)
            logger.info(f"   Inversionistas: {', '.join(sorted(inversionistas_en_pool))}", indent=1)
        
        logger.dedent()
        
        if len(creditos_data) > 5:
            logger.info(f"... y {len(creditos_data) - 5} créditos más\n")
        
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
def procesar_multiples_hojas(api_endpoint: str, modo_nombre: str):
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
        
        creditos_data = leer_hoja_excel(archivo_path, nombre_hoja)
        
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

# ============================================
# 🎯 MENÚ PRINCIPAL
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
    print("   0️⃣  Salir\n")
    logger.separador()
    
    while True:
        respuesta = input("\n👉 Ingresá tu opción (1/2/0): ").strip()
        
        if respuesta in ['1', '2', '0']:
            logger.info(f"Usuario seleccionó opción: {respuesta}")
            return respuesta
        else:
            logger.warning("❌ Opción inválida")

# ============================================
# 🎯 EJECUTAR
# ============================================
if __name__ == "__main__":
    logger.titulo("🔥 PROCESADOR UNIFICADO - POOLS NORMALES Y RAROS")
    logger.warning("⚠️  Asegurate que tu backend Elysia esté corriendo en el puerto 7000\n")
    
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
                
                input("\n📌 Presiona ENTER para continuar...")
                procesar_multiples_hojas(api_endpoint, modo_nombre)
                
                input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
            
            elif opcion == '2':
                logger.success("\n✅ Modo seleccionado: SOLO INVERSIONISTAS")
                api_endpoint = "http://localhost:7000/processInvestorsOnly"
                modo_nombre = "Solo Inversionistas (sin SIFCO)"
                
                logger.warning("\n⚠️  IMPORTANTE:")
                logger.warning("   - Los créditos DEBEN existir en la base de datos")
                logger.warning("   - Solo se actualizarán los inversionistas")
                logger.warning("   - NO se consultará SIFCO\n")
                
                confirmacion = input("¿Estás seguro de continuar? (s/n): ").strip().lower()
                
                if confirmacion == 's':
                    logger.info("Usuario confirmó operación")
                    procesar_multiples_hojas(api_endpoint, modo_nombre)
                    input("\n✅ Proceso completado. Presiona ENTER para volver al menú...")
                else:
                    logger.warning("\n❌ Operación cancelada por el usuario")
            
    except KeyboardInterrupt:
        logger.warning("\n\n⚠️ Proceso interrumpido por el usuario (Ctrl+C)")
    except Exception as e:
        logger.error(f"\n❌ Error fatal: {e}")
        import traceback
        traceback.print_exc()
    finally:
        logger.separador()
        logger.success(f"📝 Logs completos guardados en: {ARCHIVO_LOG}")