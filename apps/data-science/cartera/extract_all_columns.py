#!/usr/bin/env python3
"""
Script para extraer TODAS las columnas de TODAS las hojas
y generar un checklist completo para migración a SQLite
"""

import pandas as pd
import json
from collections import defaultdict, OrderedDict
import re

def find_header_row(df_raw, sheet_name):
    """Encuentra la fila de encabezados en una hoja"""
    for i in range(min(15, len(df_raw))):
        row = df_raw.iloc[i]
        # Contar celdas con texto descriptivo
        text_count = 0
        for val in row:
            if isinstance(val, str) and len(val.strip()) > 2:
                text_count += 1
            elif pd.notna(val) and not isinstance(val, (int, float)):
                text_count += 1
        
        # Si al menos 30% de la fila tiene texto descriptivo
        if text_count > len(row) * 0.3:
            return i
    
    # Fallback: buscar fila con más strings
    max_strings = 0
    best_row = 0
    for i in range(min(10, len(df_raw))):
        string_count = sum(1 for val in df_raw.iloc[i] if isinstance(val, str))
        if string_count > max_strings:
            max_strings = string_count
            best_row = i
    
    return best_row if max_strings > 3 else 0

def clean_column_name(col_name):
    """Limpia y normaliza nombres de columnas"""
    if pd.isna(col_name):
        return None
    
    col_str = str(col_name).strip()
    
    # Filtrar columnas completamente vacías o inútiles
    if not col_str or col_str.lower() in ['nan', 'none', '']:
        return None
    
    # Si es solo un número, probablemente no es un encabezado válido
    if col_str.replace('.', '').replace('-', '').isdigit():
        return None
    
    return col_str

def extract_all_columns(file_path):
    """Extrae todas las columnas de todas las hojas"""
    
    print("🔍 EXTRAYENDO TODAS LAS COLUMNAS DE TODAS LAS HOJAS")
    print("=" * 80)
    
    xl_file = pd.ExcelFile(file_path)
    all_columns = set()
    sheet_columns = {}
    column_details = defaultdict(lambda: {
        'sheets': [],
        'data_types': set(),
        'sample_values': set(),
        'max_length': 0
    })
    
    total_sheets = len(xl_file.sheet_names)
    
    for idx, sheet_name in enumerate(xl_file.sheet_names):
        print(f"📋 Procesando hoja {idx+1}/{total_sheets}: '{sheet_name}'")
        
        try:
            # Leer hoja sin procesar
            df_raw = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
            
            if df_raw.empty:
                print(f"   ⚠️  Hoja vacía, saltando...")
                sheet_columns[sheet_name] = []
                continue
            
            # Encontrar fila de encabezados
            header_row = find_header_row(df_raw, sheet_name)
            
            # Leer con encabezados correctos
            df = pd.read_excel(file_path, sheet_name=sheet_name, header=header_row)
            
            # Procesar columnas
            sheet_cols = []
            for col in df.columns:
                clean_col = clean_column_name(col)
                if clean_col:
                    sheet_cols.append(clean_col)
                    all_columns.add(clean_col)
                    
                    # Recopilar información detallada
                    column_details[clean_col]['sheets'].append(sheet_name)
                    column_details[clean_col]['data_types'].add(str(df[col].dtype))
                    
                    # Valores de muestra (no nulos)
                    sample_vals = df[col].dropna().head(3)
                    for val in sample_vals:
                        if isinstance(val, str) and len(val) < 100:
                            column_details[clean_col]['sample_values'].add(val[:50])
                        elif not isinstance(val, str):
                            column_details[clean_col]['sample_values'].add(str(val)[:50])
                    
                    # Longitud máxima para strings
                    if df[col].dtype == 'object':
                        try:
                            max_len = df[col].astype(str).str.len().max()
                            if pd.notna(max_len):
                                column_details[clean_col]['max_length'] = max(
                                    column_details[clean_col]['max_length'], 
                                    int(max_len)
                                )
                        except:
                            pass
            
            sheet_columns[sheet_name] = sheet_cols
            print(f"   ✅ {len(sheet_cols)} columnas válidas encontradas")
            
        except Exception as e:
            print(f"   ❌ Error procesando '{sheet_name}': {str(e)}")
            sheet_columns[sheet_name] = []
    
    print(f"\n📊 RESUMEN:")
    print(f"   - Total de hojas procesadas: {len(sheet_columns)}")
    print(f"   - Total de columnas únicas: {len(all_columns)}")
    
    return all_columns, sheet_columns, column_details

def generate_checklist(all_columns, sheet_columns, column_details, output_file):
    """Genera archivo checklist con todas las columnas"""
    
    checklist_data = {
        'metadata': {
            'total_sheets': len(sheet_columns),
            'total_unique_columns': len(all_columns),
            'generated_at': pd.Timestamp.now().isoformat()
        },
        'columns': {},
        'sheet_mapping': sheet_columns
    }
    
    # Crear entrada detallada para cada columna
    for col_name in sorted(all_columns):
        details = column_details[col_name]
        
        # Determinar tipo SQL sugerido
        data_types = list(details['data_types'])
        if any('int' in dt for dt in data_types):
            sql_type = 'INTEGER'
        elif any('float' in dt for dt in data_types):
            sql_type = 'REAL'
        elif any('datetime' in dt for dt in data_types):
            sql_type = 'DATETIME'
        elif any('bool' in dt for dt in data_types):
            sql_type = 'BOOLEAN'
        else:
            # Para texto, usar longitud máxima encontrada
            max_len = details['max_length']
            if max_len > 1000:
                sql_type = 'TEXT'
            elif max_len > 255:
                sql_type = f'VARCHAR({min(max_len + 100, 1000)})'
            else:
                sql_type = 'VARCHAR(255)'
        
        checklist_data['columns'][col_name] = {
            'appears_in_sheets': details['sheets'],
            'sheet_count': len(details['sheets']),
            'pandas_types': list(details['data_types']),
            'suggested_sql_type': sql_type,
            'max_text_length': details['max_length'],
            'sample_values': list(details['sample_values'])[:5],  # Máximo 5 ejemplos
            'migrated': False  # Para checklist
        }
    
    # Guardar checklist
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(checklist_data, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"📝 Checklist guardado en: {output_file}")
    
    # Generar reporte legible
    report_file = output_file.replace('.json', '_report.txt')
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("CHECKLIST DE COLUMNAS PARA MIGRACIÓN\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Total hojas: {len(sheet_columns)}\n")
        f.write(f"Total columnas únicas: {len(all_columns)}\n\n")
        
        f.write("COLUMNAS ENCONTRADAS:\n")
        f.write("-" * 30 + "\n")
        
        for i, col_name in enumerate(sorted(all_columns), 1):
            details = checklist_data['columns'][col_name]
            f.write(f"{i:3d}. {col_name}\n")
            f.write(f"     Tipo SQL sugerido: {details['suggested_sql_type']}\n")
            f.write(f"     Aparece en {details['sheet_count']} hojas\n")
            if details['sample_values']:
                f.write(f"     Ejemplos: {', '.join(details['sample_values'])}\n")
            f.write("\n")
    
    print(f"📋 Reporte legible guardado en: {report_file}")

if __name__ == "__main__":
    excel_file = "cartera.xlsx"
    checklist_file = "column_checklist.json"
    
    print("🚀 INICIANDO ANÁLISIS COMPLETO DE COLUMNAS")
    print("=" * 80)
    
    try:
        all_columns, sheet_columns, column_details = extract_all_columns(excel_file)
        generate_checklist(all_columns, sheet_columns, column_details, checklist_file)
        
        print(f"\n✅ ANÁLISIS COMPLETADO")
        print(f"📂 Archivos generados:")
        print(f"   - {checklist_file}")
        print(f"   - {checklist_file.replace('.json', '_report.txt')}")
        
    except Exception as e:
        print(f"❌ Error durante el análisis: {str(e)}")
        raise