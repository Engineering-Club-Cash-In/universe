import pandas as pd
from typing import List, Dict
import requests
import os
import glob
import unicodedata
import re

# ========================================
# CONFIGURACIÓN
# ========================================

DIRECTORIO = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
API_URL = "http://localhost:7000/merge"  # 👈 Tu endpoint

# Hojas específicas a procesar
HOJAS_A_PROCESAR = [
    "Octubre 2025",
    "Noviembre 2025", 
    "Diciembre 2025",
    "Enero 2026",
    "Febrero 2026",
    "Marzo 2026"
]

# ========================================
# FUNCIÓN PARA NORMALIZAR NOMBRES
# ========================================

def normalizar_nombre(nombre: str) -> str:
    """
    Normaliza un nombre eliminando tildes, espacios extras, y convirtiendo a minúsculas
    """
    if pd.isna(nombre):
        return ""
    
    # Convertir a string
    nombre = str(nombre)
    
    # Quitar tildes/acentos
    nombre = unicodedata.normalize('NFD', nombre)
    nombre = ''.join(char for char in nombre if unicodedata.category(char) != 'Mn')
    
    # Convertir a minúsculas
    nombre = nombre.lower()
    
    # Quitar espacios extras (múltiples espacios → un solo espacio)
    nombre = re.sub(r'\s+', ' ', nombre)
    
    # Quitar espacios al inicio y final
    nombre = nombre.strip()
    
    return nombre

# ========================================
# 0. BUSCAR ARCHIVO AUTOMÁTICAMENTE
# ========================================

def buscar_archivo_cartera(directorio: str) -> str:
    """
    Busca el archivo de Cartera Préstamos en el directorio
    """
    print("🔍 Buscando archivo de Cartera Préstamos...")
    print(f"   📂 Directorio: {directorio}")
    print("")
    
    # Patrones para buscar el archivo
    patrones = [
        "Cartera Préstamos (Cash-In) NUEVA 3.0*.xlsx",
        "Cartera Préstamos*.xlsx",
        "Cartera*.xlsx"
    ]
    
    for patron in patrones:
        ruta_busqueda = os.path.join(directorio, patron)
        archivos = glob.glob(ruta_busqueda)
        
        if archivos:
            # Tomar el más reciente si hay varios
            archivo = max(archivos, key=os.path.getmtime)
            print(f"   ✅ Archivo encontrado: {os.path.basename(archivo)}")
            print(f"   📂 Ruta completa: {archivo}")
            print("")
            return archivo
    
    # Si no se encuentra, listar archivos disponibles
    print("   ❌ No se encontró el archivo")
    print("")
    print("   📋 Archivos Excel disponibles en el directorio:")
    archivos_excel = glob.glob(os.path.join(directorio, "*.xlsx"))
    if archivos_excel:
        for i, archivo in enumerate(archivos_excel, 1):
            print(f"      {i}. {os.path.basename(archivo)}")
    else:
        print("      (No hay archivos .xlsx)")
    print("")
    
    raise FileNotFoundError(f"No se encontró archivo de Cartera Préstamos en {directorio}")

# ========================================
# 1. LEER Y FILTRAR EXCEL (HOJAS ESPECÍFICAS)
# ========================================

def leer_y_filtrar_creditos_pool(excel_path: str, hojas: List[str]) -> pd.DataFrame:
    """
    Lee las hojas específicas del Excel y filtra solo los créditos con formato Pool
    Los headers están en la fila 2 (índice 1)
    """
    print("📖 Leyendo Excel...")
    print(f"   📂 Ruta: {excel_path}")
    print("")
    
    # Verificar que el archivo existe
    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"El archivo no existe: {excel_path}")
    
    try:
        excel_file = pd.ExcelFile(excel_path)
    except Exception as e:
        print(f"❌ ERROR al abrir el archivo: {str(e)}")
        raise
    
    print(f"   📊 Hojas disponibles en el Excel:")
    for hoja in excel_file.sheet_names:
        print(f"      - {hoja}")
    print("")
    print(f"   🎯 Hojas a procesar: {hojas}")
    print("")
    
    # Lista para almacenar todos los dataframes
    df_list = []
    
    # Procesar solo las hojas especificadas
    for sheet_name in hojas:
        if sheet_name not in excel_file.sheet_names:
            print(f"   ⚠️  Advertencia: La hoja '{sheet_name}' no existe, se omitirá")
            continue
            
        print(f"   📄 Procesando hoja: {sheet_name}")
        
        try:
            # Leer la hoja con headers en fila 2
            df_sheet = pd.read_excel(
                excel_path, 
                sheet_name=sheet_name,
                header=1  # 👈 Headers en la fila 2 (índice 1)
            )
            
            print(f"      ✅ Registros en hoja: {len(df_sheet)}")
            
            # Agregar columna con el nombre de la hoja (mes)
            df_sheet['Hoja'] = sheet_name
            
            df_list.append(df_sheet)
            
        except Exception as e:
            print(f"      ❌ Error al leer hoja '{sheet_name}': {str(e)}")
            continue
    
    if not df_list:
        raise ValueError("No se pudo leer ninguna hoja del Excel")
    
    # Concatenar todos los dataframes
    df_completo = pd.concat(df_list, ignore_index=True)
    
    print("")
    print(f"   ✅ Total de registros en todas las hojas: {len(df_completo)}")
    print("")
    
    # ========================================
    # BUSCAR COLUMNA DE FORMATO
    # ========================================
    columna_formato = None
    
    # Buscar la columna que tenga "formato" y "créd" o "cred"
    for col in df_completo.columns:
        col_str = str(col).strip().lower()
        # Buscar cualquier columna que tenga "formato" y "cred" (con o sin acento)
        if 'formato' in col_str and ('créd' in col_str or 'cred' in col_str):
            columna_formato = col
            print(f"   ✅ Columna de formato encontrada: '{columna_formato}'")
            break
    
    if columna_formato is None:
        print(f"   ⚠️  No se encontró la columna de formato")
        print(f"   💡 Columnas disponibles:")
        for i, col in enumerate(df_completo.columns, 1):
            print(f"      {i}. '{col}'")
        raise ValueError("No se encontró la columna de formato de crédito")
    
    # Filtrar solo Pool
    df_pool = df_completo[df_completo[columna_formato] == 'Pool'].copy()
    
    print(f"   🎯 Créditos Pool encontrados: {len(df_pool)}")
    
    # Si no hay Pool, mostrar valores únicos de la columna formato
    if len(df_pool) == 0:
        print(f"   ⚠️  No se encontraron créditos Pool")
        print(f"   💡 Valores únicos en '{columna_formato}':")
        valores = df_completo[columna_formato].dropna().unique()
        for val in valores[:10]:  # Solo mostrar los primeros 10
            print(f"      - {val}")
        return df_pool
    
    print("")
    
    # Mostrar muestra de los datos
    print("   📋 Muestra de datos Pool:")
    # Buscar columnas necesarias
    col_sifco = None
    col_nombre = None
    col_numero = None
    
    for col in df_pool.columns:
        col_lower = str(col).lower()
        if 'sifco' in col_lower:
            col_sifco = col
        if col == 'Nombre' or 'nombre' in col_lower:
            col_nombre = col
        if col == '#':
            col_numero = col
    
    if col_sifco and col_nombre and col_numero:
        print(df_pool[['Hoja', col_sifco, col_nombre, col_numero]].head(5))
    else:
        print(df_pool.head(5))
    print("")
    
    return df_pool

# ========================================
# 2. AGRUPAR POR NOMBRE (SOLO UNA FUSIÓN POR PAR - ÚLTIMA CUOTA)
# ========================================

def agrupar_creditos_para_fusion(df_pool: pd.DataFrame) -> List[Dict]:
    """
    Agrupa los créditos por NOMBRE únicamente.
    Toma la ÚLTIMA cuota donde aparecen juntos para hacer UNA SOLA fusión.
    Ignora completamente los créditos con sufijos (_2, _3, etc.)
    """
    print("🔍 Agrupando créditos por Nombre...")
    print("")
    
    # Buscar las columnas necesarias
    col_nombre = None
    col_numero = None
    col_sifco = None
    
    for col in df_pool.columns:
        col_lower = str(col).lower()
        if col == 'Nombre' or 'nombre' in col_lower:
            col_nombre = col
        if col == '#':
            col_numero = col
        if 'sifco' in col_lower:
            col_sifco = col
    
    if not col_nombre or not col_numero or not col_sifco:
        print(f"   ❌ No se encontraron las columnas necesarias")
        print(f"      Nombre: {col_nombre}")
        print(f"      #: {col_numero}")
        print(f"      SIFCO: {col_sifco}")
        raise ValueError("Faltan columnas necesarias en el DataFrame")
    
    print(f"   ✅ Columnas identificadas:")
    print(f"      - Nombre: '{col_nombre}'")
    print(f"      - Número: '{col_numero}'")
    print(f"      - SIFCO: '{col_sifco}'")
    print("")
    
    # ========================================
    # CREAR COLUMNA DE NOMBRE NORMALIZADO
    # ========================================
    print("   🔄 Normalizando nombres (quitando tildes, espacios extras, etc.)...")
    df_pool['nombre_normalizado'] = df_pool[col_nombre].apply(normalizar_nombre)
    
    # ========================================
    # FILTRAR: ELIMINAR TODOS LOS QUE TENGAN _ EN EL SIFCO
    # ========================================
    print("   🔄 Filtrando créditos con sufijos (_2, _3, etc.)...")
    registros_antes = len(df_pool)
    
    # Filtrar solo los que NO tienen guión bajo
    df_pool_sin_sufijos = df_pool[~df_pool[col_sifco].astype(str).str.contains('_', na=False)].copy()
    
    registros_despues = len(df_pool_sin_sufijos)
    eliminados = registros_antes - registros_despues
    
    print(f"      Registros antes: {registros_antes}")
    print(f"      Registros después: {registros_despues}")
    print(f"      ✅ Créditos con sufijos eliminados: {eliminados}")
    print("")
    
    # ========================================
    # AGRUPAR POR NOMBRE NORMALIZADO
    # ========================================
    # Primero agrupar para ver qué nombres tienen múltiples créditos
    grupos_por_nombre = df_pool_sin_sufijos.groupby('nombre_normalizado')
    
    fusiones = []
    
    for nombre_norm, grupo_nombre in grupos_por_nombre:
        # Ver cuántos SIFCO únicos tiene esta persona
        sifcos_unicos = grupo_nombre[col_sifco].unique()
        
        # Solo nos interesan personas con 2 o más créditos DIFERENTES
        if len(sifcos_unicos) < 2:
            continue
        
        # ========================================
        # ENCONTRAR LA ÚLTIMA CUOTA DONDE APARECEN JUNTOS
        # ========================================
        # Ordenar por número de cuota de mayor a menor
        grupo_ordenado = grupo_nombre.sort_values(by=col_numero, ascending=False)
        
        # Tomar la cuota más alta (última)
        cuota_maxima = grupo_ordenado[col_numero].max()
        
        # Filtrar solo los registros de esa cuota
        registros_ultima_cuota = grupo_ordenado[grupo_ordenado[col_numero] == cuota_maxima]
        
        # Ver cuántos SIFCOs diferentes hay en esa última cuota
        sifcos_ultima_cuota = registros_ultima_cuota[col_sifco].unique()
        
        # Solo fusionar si en la última cuota hay 2 o más créditos diferentes
        if len(sifcos_ultima_cuota) >= 2:
            creditos_sifco = sifcos_ultima_cuota.tolist()
            nombre_original = registros_ultima_cuota[col_nombre].iloc[0]
            hojas = registros_ultima_cuota['Hoja'].unique().tolist()
            
            print(f"👥 Grupo encontrado:")
            print(f"   📝 Nombre: {nombre_original}")
            print(f"   🔤 Normalizado: '{nombre_norm}'")
            print(f"   🔢 Última cuota donde aparecen juntos: #{cuota_maxima}")
            print(f"   📋 Créditos SIFCO a fusionar:")
            for i, sifco in enumerate(creditos_sifco):
                print(f"      {i+1}. {sifco}")
            print("")
            
            # Preparar para fusión
            fusiones.append({
                'nombre': nombre_original,
                'nombre_normalizado': nombre_norm,
                'numero_cuota': cuota_maxima,
                'credito_destino': str(creditos_sifco[0]),
                'creditos_origen': [str(c) for c in creditos_sifco[1:]],
                'hojas': hojas
            })
    
    print(f"✅ Total de fusiones a realizar: {len(fusiones)}")
    print("")
    
    return fusiones

# ========================================
# 3. EJECUTAR FUSIONES
# ========================================

def ejecutar_fusiones(fusiones: List[Dict], api_url: str):
    """
    Llama al endpoint de fusión para cada grupo
    """
    print("🚀 ========================================")
    print("🚀 INICIANDO FUSIONES")
    print("🚀 ========================================")
    print("")
    
    resultados = []
    
    for idx, fusion in enumerate(fusiones, 1):
        nombre = fusion['nombre']
        numero_cuota = fusion.get('numero_cuota', 'N/A')
        credito_destino = fusion['credito_destino']
        creditos_origen = fusion['creditos_origen']
        hojas = fusion['hojas']
        
        print(f"📦 Fusión {idx}/{len(fusiones)}")
        print(f"   👤 Cliente: {nombre}")
        print(f"   🔢 Última cuota: {numero_cuota}")
        print(f"   🎯 Crédito DESTINO: {credito_destino}")
        print(f"   📋 Créditos ORIGEN: {creditos_origen}")
        print("")
        
        for credito_origen in creditos_origen:
            print(f"   🔄 Fusionando {credito_origen} → {credito_destino}")
            
            payload = {
                "numero_credito_origen": credito_origen,
                "numero_credito_destino": credito_destino
            }
            
            try:
                response = requests.post(api_url, json=payload, timeout=30)
                
                if response.status_code in [200, 201]:
                    resultado = response.json()
                    print(f"   ✅ Fusión exitosa!")
                    print(f"      💰 Capital: Q{resultado['creditoFinal']['capital_total']}")
                    print(f"      💵 Cuota: Q{resultado['creditoFinal']['cuota']}")
                    
                    resultados.append({
                        'nombre': nombre,
                        'numero_cuota': numero_cuota,
                        'credito_origen': credito_origen,
                        'credito_destino': credito_destino,
                        'hojas': ', '.join(map(str, hojas)),
                        'status': 'exitoso',
                        'capital_final': resultado['creditoFinal']['capital_total'],
                        'cuota_final': resultado['creditoFinal']['cuota']
                    })
                else:
                    print(f"   ❌ Error HTTP: {response.status_code}")
                    print(f"      {response.text[:200]}")
                    
                    resultados.append({
                        'nombre': nombre,
                        'numero_cuota': numero_cuota,
                        'credito_origen': credito_origen,
                        'credito_destino': credito_destino,
                        'hojas': ', '.join(map(str, hojas)),
                        'status': 'error',
                        'error': f"HTTP {response.status_code}: {response.text[:100]}"
                    })
            
            except requests.exceptions.ConnectionError:
                print(f"   ❌ Error: No se pudo conectar al servidor")
                print(f"      ¿Está corriendo en {api_url}?")
                
                resultados.append({
                    'nombre': nombre,
                    'numero_cuota': numero_cuota,
                    'credito_origen': credito_origen,
                    'credito_destino': credito_destino,
                    'hojas': ', '.join(map(str, hojas)),
                    'status': 'error',
                    'error': 'Error de conexión al servidor'
                })
            
            except Exception as e:
                print(f"   ❌ Error: {str(e)}")
                
                resultados.append({
                    'nombre': nombre,
                    'numero_cuota': numero_cuota,
                    'credito_origen': credito_origen,
                    'credito_destino': credito_destino,
                    'hojas': ', '.join(map(str, hojas)),
                    'status': 'error',
                    'error': str(e)
                })
            
            print("")
        
        print("   " + "="*50)
        print("")
    
    return resultados

# ========================================
# 4. GENERAR REPORTE
# ========================================

def generar_reporte(resultados: List[Dict], directorio: str):
    """
    Genera un reporte de las fusiones realizadas
    """
    print("📊 ========================================")
    print("📊 REPORTE DE FUSIONES")
    print("📊 ========================================")
    print("")
    
    exitosos = [r for r in resultados if r['status'] == 'exitoso']
    errores = [r for r in resultados if r['status'] == 'error']
    
    print(f"✅ Fusiones exitosas: {len(exitosos)}")
    print(f"❌ Fusiones con error: {len(errores)}")
    print("")
    
    if exitosos:
        print("✅ Fusiones exitosas:")
        for ex in exitosos:
            print(f"   - {ex['credito_origen']} → {ex['credito_destino']}")
            print(f"     Cliente: {ex['nombre']}")
        print("")
    
    if errores:
        print("❌ Errores:")
        for error in errores:
            print(f"   - {error['credito_origen']} → {error['credito_destino']}")
            print(f"     Error: {error['error'][:100]}")
        print("")
    
    # Guardar reporte
    df_reporte = pd.DataFrame(resultados)
    reporte_path = os.path.join(directorio, "reporte_fusiones.xlsx")
    df_reporte.to_excel(reporte_path, index=False)
    
    print(f"💾 Reporte guardado en: {reporte_path}")
    print("")

# ========================================
# FUNCIÓN PRINCIPAL
# ========================================

def main():
    print("")
    print("🎯 ========================================")
    print("🎯 PROCESO DE FUSIÓN DE CRÉDITOS POOL")
    print("🎯 ========================================")
    print("")
    
    try:
        # 0. Buscar archivo automáticamente
        excel_path = buscar_archivo_cartera(DIRECTORIO)
        
        # 1. Leer y filtrar Excel
        df_pool = leer_y_filtrar_creditos_pool(excel_path, HOJAS_A_PROCESAR)
        
        if len(df_pool) == 0:
            print("⚠️  No se encontraron créditos Pool")
            return
        
        # 2. Agrupar créditos (SOLO UNA FUSIÓN POR NOMBRE - ÚLTIMA CUOTA)
        fusiones = agrupar_creditos_para_fusion(df_pool)
        
        if not fusiones:
            print("⚠️  No se encontraron créditos para fusionar")
            return
        
        # 3. Mostrar resumen
        print("📋 ========================================")
        print("📋 RESUMEN DE FUSIONES A REALIZAR")
        print("📋 ========================================")
        print("")
        for i, f in enumerate(fusiones, 1):
            print(f"{i}. {f['nombre']} (Última cuota: #{f['numero_cuota']})")
            print(f"   {f['credito_destino']} ← {', '.join(f['creditos_origen'])}")
        print("")
        
        # 4. Confirmar
        print(f"⚠️  Se van a fusionar {len(fusiones)} grupos de créditos")
        print(f"⚠️  Asegurate de que el servidor esté corriendo en: {API_URL}")
        confirmar = input("\n¿Continuar? (si/no): ")
        
        if confirmar.lower() != 'si':
            print("❌ Proceso cancelado")
            return
        
        print("")
        
        # 5. Ejecutar fusiones
        resultados = ejecutar_fusiones(fusiones, API_URL)
        
        # 6. Generar reporte
        generar_reporte(resultados, DIRECTORIO)
        
        print("✅ ========================================")
        print("✅ PROCESO COMPLETADO")
        print("✅ ========================================")
    
    except Exception as e:
        print(f"❌ Error fatal: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
 