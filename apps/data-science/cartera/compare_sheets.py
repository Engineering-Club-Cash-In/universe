#!/usr/bin/env python3
"""
Script para comparar hojas específicas del Excel de cartera
Compara formato entre años diferentes
"""

import pandas as pd
import numpy as np

def analyze_sheet_detailed(file_path, sheet_name):
    """Análisis detallado de una hoja específica"""
    
    print(f"\n🔍 ANÁLISIS DETALLADO: '{sheet_name}'")
    print("=" * 60)
    
    try:
        # Leer toda la hoja sin procesar
        df_raw = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
        print(f"📏 Dimensiones totales: {df_raw.shape[0]} filas x {df_raw.shape[1]} columnas")
        
        # Mostrar las primeras filas para identificar encabezados
        print(f"\n📋 Primeras 10 filas (para identificar encabezados):")
        for i in range(min(10, len(df_raw))):
            row_data = []
            for j in range(min(10, len(df_raw.columns))):
                value = df_raw.iloc[i, j]
                if pd.isna(value):
                    row_data.append("NaN")
                else:
                    row_data.append(str(value)[:20])
            print(f"  Fila {i}: {' | '.join(row_data)}")
        
        # Intentar encontrar la fila de encabezados
        header_row = find_header_row(df_raw)
        print(f"\n🎯 Fila de encabezados detectada: {header_row}")
        
        if header_row is not None:
            # Leer con encabezados correctos
            df = pd.read_excel(file_path, sheet_name=sheet_name, header=header_row)
            print(f"\n📊 Con encabezados correctos: {df.shape[0]} filas x {df.shape[1]} columnas")
            
            print(f"\n📋 Columnas identificadas:")
            for i, col in enumerate(df.columns):
                dtype_info = f"[{df[col].dtype}]"
                non_null = df[col].notna().sum()
                print(f"  {i+1:2d}. {str(col)[:40]:<40} {dtype_info:<12} ({non_null} no nulos)")
            
            # Análisis de datos
            print(f"\n🔍 Análisis de contenido:")
            print(f"  - Filas con datos: {df.dropna(how='all').shape[0]}")
            print(f"  - Columnas con datos: {df.dropna(axis=1, how='all').shape[1]}")
            
            # Muestra de datos reales
            df_clean = df.dropna(how='all').head(5)
            if not df_clean.empty:
                print(f"\n📋 Muestra de datos (primeras 5 filas con datos):")
                print(df_clean.to_string(max_cols=8, max_colwidth=15))
            
            # Análisis de tipos de datos específicos
            print(f"\n💾 Tipos de datos detallados:")
            for col in df.columns[:15]:  # Primeras 15 columnas
                analyze_column_content(df, col)
            
            return df
        else:
            print("❌ No se pudo identificar la fila de encabezados")
            return df_raw
            
    except Exception as e:
        print(f"❌ Error al analizar '{sheet_name}': {str(e)}")
        return None

def find_header_row(df_raw):
    """Intenta encontrar la fila que contiene los encabezados"""
    for i in range(min(10, len(df_raw))):
        row = df_raw.iloc[i]
        # Buscar fila con texto descriptivo (no solo números o NaN)
        text_count = sum(1 for val in row if isinstance(val, str) and len(val) > 2)
        if text_count > df_raw.shape[1] * 0.3:  # Al menos 30% de la fila tiene texto
            return i
    return None

def analyze_column_content(df, col_name):
    """Analiza el contenido específico de una columna"""
    col = df[col_name]
    non_null = col.dropna()
    
    if len(non_null) == 0:
        content_type = "Vacía"
    elif col.dtype in ['int64', 'float64']:
        content_type = f"Numérico (rango: {non_null.min():.2f} - {non_null.max():.2f})"
    elif col.dtype == 'object':
        # Analizar si son fechas, texto, etc.
        sample_values = non_null.head(3).tolist()
        if any('/' in str(val) or '-' in str(val) for val in sample_values):
            content_type = "Posible fecha/texto"
        else:
            content_type = "Texto/Mixto"
    else:
        content_type = f"Otro ({col.dtype})"
    
    print(f"    • {str(col_name)[:25]:<25}: {content_type}")

def compare_sheets(file_path, sheet1, sheet2):
    """Compara dos hojas y resalta las diferencias"""
    
    print(f"\n🔄 COMPARACIÓN ENTRE HOJAS")
    print("=" * 60)
    
    try:
        df1 = pd.read_excel(file_path, sheet_name=sheet1, header=find_header_row(pd.read_excel(file_path, sheet_name=sheet1, header=None)))
        df2 = pd.read_excel(file_path, sheet_name=sheet2, header=find_header_row(pd.read_excel(file_path, sheet_name=sheet2, header=None)))
        
        print(f"📊 Dimensiones:")
        print(f"  - {sheet1}: {df1.shape[0]} filas x {df1.shape[1]} columnas")
        print(f"  - {sheet2}: {df2.shape[0]} filas x {df2.shape[1]} columnas")
        
        print(f"\n📋 Comparación de columnas:")
        cols1 = set(df1.columns)
        cols2 = set(df2.columns)
        
        common_cols = cols1.intersection(cols2)
        only_in_1 = cols1 - cols2
        only_in_2 = cols2 - cols1
        
        print(f"  - Columnas comunes: {len(common_cols)}")
        print(f"  - Solo en {sheet1}: {len(only_in_1)}")
        print(f"  - Solo en {sheet2}: {len(only_in_2)}")
        
        if only_in_1:
            print(f"\n🔸 Columnas únicas en {sheet1}:")
            for col in list(only_in_1)[:10]:
                print(f"    • {col}")
        
        if only_in_2:
            print(f"\n🔸 Columnas únicas en {sheet2}:")
            for col in list(only_in_2)[:10]:
                print(f"    • {col}")
        
        # Análisis de tipos de datos en columnas comunes
        print(f"\n🔍 Diferencias en tipos de datos (columnas comunes):")
        for col in list(common_cols)[:15]:
            type1 = df1[col].dtype
            type2 = df2[col].dtype
            if type1 != type2:
                print(f"    • {col}: {sheet1}[{type1}] vs {sheet2}[{type2}]")
        
    except Exception as e:
        print(f"❌ Error en comparación: {str(e)}")

if __name__ == "__main__":
    excel_file = "cartera.xlsx"
    
    # Analizar Junio 2018
    sheet_2018 = "Junio 2018"
    sheet_2025 = "Enero 2025"
    
    print("🔍 COMPARACIÓN DETALLADA DE HOJAS DE CARTERA")
    print("=" * 80)
    
    # Análisis detallado de cada hoja
    df_2018 = analyze_sheet_detailed(excel_file, sheet_2018)
    df_2025 = analyze_sheet_detailed(excel_file, sheet_2025)
    
    # Comparación directa
    if df_2018 is not None and df_2025 is not None:
        compare_sheets(excel_file, sheet_2018, sheet_2025)