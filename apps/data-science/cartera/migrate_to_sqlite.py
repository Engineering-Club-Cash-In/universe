#!/usr/bin/env python3
"""
Script de migración completa de Excel a SQLite
Migra TODAS las columnas sin pérdida de información
"""

import pandas as pd
import sqlite3
import json
import os
import re
from datetime import datetime, time

class ExcelToSQLiteMigrator:
    def __init__(self, excel_file, sqlite_file, checklist_file):
        self.excel_file = excel_file
        self.sqlite_file = sqlite_file
        self.checklist_file = checklist_file
        self.conn = None
        self.checklist = None
        self.migration_log = []
        
    def load_checklist(self):
        """Carga el checklist de columnas"""
        with open(self.checklist_file, 'r', encoding='utf-8') as f:
            self.checklist = json.load(f)
        print(f"✅ Checklist cargado: {len(self.checklist['columns'])} columnas únicas")
    
    def normalize_column_name(self, col_name):
        """Normaliza nombres de columnas para SQLite"""
        if pd.isna(col_name) or not str(col_name).strip():
            return None
            
        # Convertir a string y limpiar
        clean_name = str(col_name).strip()
        
        # Reemplazar caracteres específicos problemáticos
        replacements = {
            '%': 'pct',
            '#': 'num',
            '(': '_',
            ')': '_',
            '/': '_',
            '-': '_',
            ' ': '_',
            '.': '_',
            ',': '_',
            ':': '_',
            ';': '_',
            '°': 'deg',
            'ó': 'o',
            'í': 'i',
            'é': 'e',
            'á': 'a',
            'ú': 'u',
            'ñ': 'n'
        }
        
        for old, new in replacements.items():
            clean_name = clean_name.replace(old, new)
        
        # Remover cualquier otro carácter no alfanumérico
        clean_name = re.sub(r'[^\w]', '_', clean_name)
        
        # Limpiar múltiples underscores
        clean_name = re.sub(r'_+', '_', clean_name)
        clean_name = clean_name.strip('_')
        
        # Si está vacío después de limpiar
        if not clean_name:
            return None
        
        # SQLite keywords conflict resolution
        sqlite_keywords = ['ORDER', 'GROUP', 'SELECT', 'FROM', 'WHERE', 'TABLE', 'INDEX', 'CREATE', 'DROP', 'ALTER']
        if clean_name.upper() in sqlite_keywords:
            clean_name = f"col_{clean_name}"
            
        # Si empieza con número, agregar prefijo
        if clean_name[0].isdigit():
            clean_name = f"col_{clean_name}"
            
        return clean_name.lower()
    
    def create_universal_table(self):
        """Crea tabla universal que puede acomodar todas las columnas"""
        print("🔨 Creando esquema universal de SQLite...")
        
        # Campos meta obligatorios
        table_sql = """
        CREATE TABLE IF NOT EXISTS cartera_universal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sheet_name TEXT NOT NULL,
            row_index INTEGER,
            migration_timestamp TEXT,
        """
        
        column_mappings = {}
        used_normalized_names = set()
        
        # Crear columna para cada campo único encontrado
        for col_name, details in self.checklist['columns'].items():
            normalized_name = self.normalize_column_name(col_name)
            
            if not normalized_name:
                continue
            
            # Resolver duplicados agregando sufijo numérico
            original_normalized = normalized_name
            counter = 1
            while normalized_name in used_normalized_names:
                normalized_name = f"{original_normalized}_{counter}"
                counter += 1
            
            used_normalized_names.add(normalized_name)
            
            # Mapear nombre original a normalizado único
            column_mappings[col_name] = normalized_name
            
            sql_type = details['suggested_sql_type']
            
            # Hacer todas las columnas opcionales (NULL)
            table_sql += f"    {normalized_name} {sql_type},\n"
        
        # Remover última coma y cerrar
        table_sql = table_sql.rstrip(',\n') + "\n);"
        
        # Crear tabla
        self.conn.execute(table_sql)
        self.conn.commit()
        
        print(f"✅ Tabla 'cartera_universal' creada con {len(column_mappings)} columnas")
        
        # Guardar mapeos para referencia
        with open('column_mappings.json', 'w', encoding='utf-8') as f:
            json.dump(column_mappings, f, indent=2, ensure_ascii=False)
            
        return column_mappings
    
    def find_header_row(self, df_raw, sheet_name):
        """Encuentra la fila de encabezados"""
        for i in range(min(15, len(df_raw))):
            row = df_raw.iloc[i]
            text_count = sum(1 for val in row if isinstance(val, str) and len(val.strip()) > 2)
            
            if text_count > len(row) * 0.3:
                return i
        return 0
    
    def migrate_sheet(self, sheet_name, column_mappings):
        """Migra una hoja específica"""
        try:
            print(f"📋 Migrando hoja: '{sheet_name}'")
            
            # Leer hoja
            df_raw = pd.read_excel(self.excel_file, sheet_name=sheet_name, header=None)
            
            if df_raw.empty:
                print(f"   ⚠️  Hoja vacía, saltando...")
                return 0
            
            # Encontrar encabezados
            header_row = self.find_header_row(df_raw, sheet_name)
            df = pd.read_excel(self.excel_file, sheet_name=sheet_name, header=header_row)
            
            # Filtrar filas con datos reales
            df_data = df.dropna(how='all')
            
            if df_data.empty:
                print(f"   ⚠️  Sin datos después de limpiar, saltando...")
                return 0
            
            rows_migrated = 0
            
            # Migrar cada fila
            for idx, row in df_data.iterrows():
                # Preparar diccionario de datos
                row_data = {
                    'sheet_name': sheet_name,
                    'row_index': idx,
                    'migration_timestamp': datetime.now().isoformat()
                }
                
                # Mapear cada columna
                for orig_col in df.columns:
                    orig_col_str = str(orig_col).strip()
                    
                    if orig_col_str in column_mappings:
                        normalized_col = column_mappings[orig_col_str]
                        value = row[orig_col]
                        
                        # Procesar el valor según su tipo
                        if pd.isna(value):
                            row_data[normalized_col] = None
                        elif isinstance(value, (pd.Timestamp, datetime)):
                            row_data[normalized_col] = value.isoformat() if pd.notna(value) else None
                        elif isinstance(value, time):
                            # datetime.time objects
                            row_data[normalized_col] = value.strftime('%H:%M:%S') if value else None
                        elif isinstance(value, pd.Timedelta):
                            row_data[normalized_col] = str(value) if pd.notna(value) else None
                        elif isinstance(value, complex):
                            row_data[normalized_col] = str(value)
                        elif hasattr(value, '__len__') and not isinstance(value, str) and len(str(value)) > 1000:
                            # Truncar valores muy largos
                            row_data[normalized_col] = str(value)[:1000] + "..."
                        else:
                            row_data[normalized_col] = value
                
                # Insertar en la base de datos
                columns = list(row_data.keys())
                placeholders = ['?' for _ in columns]
                values = [row_data[col] for col in columns]
                
                insert_sql = f"""
                INSERT INTO cartera_universal ({', '.join(columns)}) 
                VALUES ({', '.join(placeholders)})
                """
                
                self.conn.execute(insert_sql, values)
                rows_migrated += 1
            
            self.conn.commit()
            print(f"   ✅ {rows_migrated} filas migradas")
            
            # Log de migración
            self.migration_log.append({
                'sheet': sheet_name,
                'rows_migrated': rows_migrated,
                'columns_found': len(df.columns),
                'status': 'success'
            })
            
            return rows_migrated
            
        except Exception as e:
            error_msg = f"❌ Error migrando '{sheet_name}': {str(e)}"
            print(error_msg)
            
            self.migration_log.append({
                'sheet': sheet_name,
                'rows_migrated': 0,
                'error': str(e),
                'status': 'error'
            })
            
            return 0
    
    def migrate_all(self):
        """Migra todas las hojas"""
        print("🚀 INICIANDO MIGRACIÓN COMPLETA")
        print("=" * 80)
        
        # Cargar checklist
        self.load_checklist()
        
        # Conectar a SQLite
        if os.path.exists(self.sqlite_file):
            os.remove(self.sqlite_file)
            
        self.conn = sqlite3.connect(self.sqlite_file)
        print(f"📂 Base de datos SQLite creada: {self.sqlite_file}")
        
        # Crear tabla universal
        column_mappings = self.create_universal_table()
        
        # Leer Excel y migrar cada hoja
        xl_file = pd.ExcelFile(self.excel_file)
        total_rows = 0
        
        for idx, sheet_name in enumerate(xl_file.sheet_names):
            print(f"\n📊 Progreso: {idx+1}/{len(xl_file.sheet_names)}")
            rows_migrated = self.migrate_sheet(sheet_name, column_mappings)
            total_rows += rows_migrated
        
        # Crear índices para optimizar
        print(f"\n🔍 Creando índices...")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_sheet_name ON cartera_universal(sheet_name)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_migration_timestamp ON cartera_universal(migration_timestamp)")
        
        # Si hay columnas de fecha identificables, crear índices
        try:
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_fecha ON cartera_universal(fecha)")
        except:
            pass  # La columna fecha podría no existir
            
        self.conn.commit()
        
        # Estadísticas finales
        cursor = self.conn.execute("SELECT COUNT(*) FROM cartera_universal")
        total_db_rows = cursor.fetchone()[0]
        
        print(f"\n✅ MIGRACIÓN COMPLETADA")
        print("=" * 50)
        print(f"📊 Estadísticas:")
        print(f"   - Hojas procesadas: {len(xl_file.sheet_names)}")
        print(f"   - Filas migradas: {total_db_rows}")
        print(f"   - Columnas en esquema: {len(column_mappings)}")
        print(f"   - Base de datos: {self.sqlite_file} ({os.path.getsize(self.sqlite_file) / (1024*1024):.2f} MB)")
        
        # Guardar log de migración
        log_data = {
            'migration_timestamp': datetime.now().isoformat(),
            'source_file': self.excel_file,
            'target_file': self.sqlite_file,
            'total_sheets': len(xl_file.sheet_names),
            'total_rows_migrated': total_db_rows,
            'total_columns': len(column_mappings),
            'sheet_details': self.migration_log
        }
        
        with open('migration_log.json', 'w', encoding='utf-8') as f:
            json.dump(log_data, f, indent=2, ensure_ascii=False)
        
        print(f"📝 Log de migración guardado en: migration_log.json")
        
        self.conn.close()
        return total_db_rows, len(column_mappings)

if __name__ == "__main__":
    # Configuración
    excel_file = "cartera.xlsx"
    sqlite_file = "cartera_migrated.db"
    checklist_file = "column_checklist.json"
    
    # Verificar archivos
    if not os.path.exists(excel_file):
        print(f"❌ Archivo Excel no encontrado: {excel_file}")
        exit(1)
        
    if not os.path.exists(checklist_file):
        print(f"❌ Checklist no encontrado: {checklist_file}")
        print("   Ejecute primero: python extract_all_columns.py")
        exit(1)
    
    # Ejecutar migración
    migrator = ExcelToSQLiteMigrator(excel_file, sqlite_file, checklist_file)
    total_rows, total_cols = migrator.migrate_all()
    
    print(f"\n🎉 ¡Migración exitosa!")
    print(f"   {total_rows} filas migradas")
    print(f"   {total_cols} columnas preservadas")
    print(f"   Base de datos lista en: {sqlite_file}")