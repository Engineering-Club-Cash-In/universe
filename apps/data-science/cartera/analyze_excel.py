#!/usr/bin/env python3
"""
Script para analizar la estructura de un archivo Excel grande
y generar información para diseño de esquema de base de datos
"""

import pandas as pd
import os
from pathlib import Path

def analyze_excel_structure(file_path):
    """Analiza la estructura básica del archivo Excel"""
    
    print(f"📊 Analizando archivo: {file_path}")
    print(f"📏 Tamaño del archivo: {os.path.getsize(file_path) / (1024*1024):.2f} MB")
    print("="*80)
    
    # Leer información de todas las hojas
    try:
        xl_file = pd.ExcelFile(file_path)
        sheet_names = xl_file.sheet_names
        
        print(f"📑 Número total de hojas: {len(sheet_names)}")
        print("\n📋 Nombres de las hojas:")
        for i, sheet in enumerate(sheet_names, 1):
            print(f"  {i}. {sheet}")
        
        print("\n" + "="*80)
        
        # Analizar cada hoja
        for sheet_name in sheet_names:
            print(f"\n🔍 Analizando hoja: '{sheet_name}'")
            print("-" * 50)
            
            try:
                # Leer solo las primeras filas para obtener información básica
                df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=5)
                
                print(f"📊 Dimensiones (primeras 5 filas): {df.shape[0]} filas x {df.shape[1]} columnas")
                print(f"📋 Columnas encontradas ({len(df.columns)}):")
                
                for i, col in enumerate(df.columns, 1):
                    print(f"  {i}. {col} [{df[col].dtype}]")
                
                # Mostrar una muestra de datos
                print(f"\n📋 Muestra de datos (primeras 3 filas):")
                print(df.head(3).to_string(max_columns=5, max_colwidth=20))
                
                # Contar filas totales (más lento pero necesario)
                total_df = pd.read_excel(file_path, sheet_name=sheet_name)
                print(f"\n📏 Filas totales en la hoja: {len(total_df)}")
                
                # Identificar tipos de datos y valores únicos para columnas clave
                print(f"\n🔍 Análisis de tipos de datos:")
                for col in df.columns[:10]:  # Solo primeras 10 columnas
                    unique_count = total_df[col].nunique()
                    null_count = total_df[col].isnull().sum()
                    print(f"  - {col}: {total_df[col].dtype}, {unique_count} únicos, {null_count} nulos")
                
            except Exception as e:
                print(f"❌ Error al leer la hoja '{sheet_name}': {str(e)}")
                
        print("\n" + "="*80)
        print("✅ Análisis completado")
        
    except Exception as e:
        print(f"❌ Error al abrir el archivo: {str(e)}")

def suggest_database_schema(file_path):
    """Sugiere un esquema de base de datos basado en la estructura del Excel"""
    
    print("\n🗄️  SUGERENCIAS PARA ESQUEMA DE BASE DE DATOS")
    print("="*80)
    
    try:
        xl_file = pd.ExcelFile(file_path)
        
        for sheet_name in xl_file.sheet_names:
            try:
                df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=100)
                
                print(f"\n📊 Tabla sugerida para '{sheet_name}':")
                print("-" * 40)
                
                # Sugerir tipos SQL basados en pandas dtypes
                sql_types = []
                for col in df.columns:
                    dtype = str(df[col].dtype)
                    
                    if 'int' in dtype:
                        sql_type = 'INTEGER'
                    elif 'float' in dtype:
                        sql_type = 'DECIMAL(10,2)'
                    elif 'datetime' in dtype:
                        sql_type = 'DATETIME'
                    elif 'bool' in dtype:
                        sql_type = 'BOOLEAN'
                    else:
                        # Estimar longitud para VARCHAR
                        max_len = df[col].astype(str).str.len().max()
                        sql_type = f'VARCHAR({min(max_len + 50, 500)})' if pd.notna(max_len) else 'VARCHAR(255)'
                    
                    sql_types.append(f"  {col.replace(' ', '_').lower()} {sql_type}")
                
                print("CREATE TABLE " + sheet_name.replace(' ', '_').lower() + " (")
                print(",\n".join(sql_types))
                print(");")
                
            except Exception as e:
                print(f"❌ Error procesando '{sheet_name}': {str(e)}")
                
    except Exception as e:
        print(f"❌ Error: {str(e)}")

if __name__ == "__main__":
    # Ruta al archivo Excel
    excel_file = "cartera.xlsx"
    
    if os.path.exists(excel_file):
        analyze_excel_structure(excel_file)
        suggest_database_schema(excel_file)
    else:
        print(f"❌ Archivo no encontrado: {excel_file}")