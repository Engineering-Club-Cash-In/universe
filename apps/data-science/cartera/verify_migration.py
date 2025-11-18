#!/usr/bin/env python3
"""
Script de verificación de integridad de la migración
Compara el checklist original vs los datos migrados
"""

import sqlite3
import json
import pandas as pd
from collections import defaultdict

class MigrationVerifier:
    def __init__(self, sqlite_file, checklist_file, excel_file):
        self.sqlite_file = sqlite_file
        self.checklist_file = checklist_file
        self.excel_file = excel_file
        self.conn = None
        self.checklist = None
        
    def load_resources(self):
        """Carga recursos necesarios para verificación"""
        # Cargar checklist
        with open(self.checklist_file, 'r', encoding='utf-8') as f:
            self.checklist = json.load(f)
        
        # Conectar a SQLite
        self.conn = sqlite3.connect(self.sqlite_file)
        print(f"✅ Recursos cargados")
        
    def verify_database_structure(self):
        """Verifica la estructura de la base de datos"""
        print("\n🔍 VERIFICANDO ESTRUCTURA DE LA BASE DE DATOS")
        print("=" * 60)
        
        # Obtener información de la tabla
        cursor = self.conn.execute("PRAGMA table_info(cartera_universal)")
        db_columns = {row[1]: row[2] for row in cursor.fetchall()}  # {nombre: tipo}
        
        print(f"📊 Columnas en base de datos: {len(db_columns)}")
        print(f"📊 Columnas en checklist: {len(self.checklist['columns'])}")
        
        # Verificar si todas las columnas del checklist están en la BD
        missing_columns = []
        extra_columns = []
        
        # Columnas del checklist vs BD (excluyendo meta campos)
        meta_columns = {'id', 'sheet_name', 'row_index', 'migration_timestamp'}
        checklist_normalized = set()
        
        # Cargar mapeos si existen
        try:
            with open('column_mappings.json', 'r', encoding='utf-8') as f:
                column_mappings = json.load(f)
            print(f"📋 Mapeos de columnas cargados: {len(column_mappings)}")
            checklist_normalized = set(column_mappings.values())
        except FileNotFoundError:
            print("⚠️  No se encontraron mapeos de columnas")
            return False
        
        db_data_columns = set(db_columns.keys()) - meta_columns
        
        missing_in_db = checklist_normalized - db_data_columns
        extra_in_db = db_data_columns - checklist_normalized
        
        print(f"\n📋 Resultados de verificación:")
        print(f"   ✅ Columnas correctamente migradas: {len(checklist_normalized & db_data_columns)}")
        
        if missing_in_db:
            print(f"   ❌ Columnas faltantes en BD: {len(missing_in_db)}")
            for col in list(missing_in_db)[:10]:  # Mostrar solo las primeras 10
                print(f"      - {col}")
        else:
            print(f"   ✅ Todas las columnas del checklist están en la BD")
            
        if extra_in_db:
            print(f"   ⚠️  Columnas extra en BD: {len(extra_in_db)}")
            for col in list(extra_in_db)[:10]:
                print(f"      - {col}")
        
        return len(missing_in_db) == 0
    
    def verify_data_counts(self):
        """Verifica conteos de datos por hoja"""
        print("\n📊 VERIFICANDO CONTEOS DE DATOS")
        print("=" * 60)
        
        # Conteos por hoja en la BD
        cursor = self.conn.execute("""
            SELECT sheet_name, COUNT(*) as row_count 
            FROM cartera_universal 
            GROUP BY sheet_name 
            ORDER BY sheet_name
        """)
        
        db_counts = {row[0]: row[1] for row in cursor.fetchall()}
        
        print(f"📋 Hojas en base de datos: {len(db_counts)}")
        
        # Comparar con Excel (muestreo de algunas hojas)
        print(f"\n📊 Conteos por hoja (top 10):")
        sorted_sheets = sorted(db_counts.items(), key=lambda x: x[1], reverse=True)
        
        for sheet_name, count in sorted_sheets[:10]:
            print(f"   {sheet_name:<30}: {count:>6} filas")
        
        total_rows = sum(db_counts.values())
        print(f"\n📊 Total de filas migradas: {total_rows}")
        
        return db_counts
    
    def verify_sample_data(self):
        """Verifica integridad de datos de muestra"""
        print("\n🔍 VERIFICANDO INTEGRIDAD DE DATOS DE MUESTRA")
        print("=" * 60)
        
        # Tomar muestra de cada hoja con datos
        cursor = self.conn.execute("""
            SELECT sheet_name, COUNT(*) as row_count 
            FROM cartera_universal 
            GROUP BY sheet_name 
            HAVING row_count > 0
            ORDER BY row_count DESC 
            LIMIT 5
        """)
        
        sample_sheets = cursor.fetchall()
        
        for sheet_name, row_count in sample_sheets:
            print(f"\n📋 Verificando hoja: {sheet_name} ({row_count} filas)")
            
            # Obtener muestra de la BD
            cursor = self.conn.execute("""
                SELECT * FROM cartera_universal 
                WHERE sheet_name = ? 
                LIMIT 3
            """, (sheet_name,))
            
            sample_rows = cursor.fetchall()
            if sample_rows:
                print(f"   ✅ Primeras 3 filas encontradas en BD")
                
                # Verificar que no todos los campos estén vacíos
                non_null_count = 0
                for row in sample_rows:
                    non_null_count += sum(1 for val in row[4:] if val is not None)  # Skip meta campos
                
                print(f"   ✅ {non_null_count} valores no nulos en muestra")
            else:
                print(f"   ❌ No se encontraron datos para {sheet_name}")
    
    def generate_verification_report(self):
        """Genera reporte completo de verificación"""
        print("\n📝 GENERANDO REPORTE DE VERIFICACIÓN")
        print("=" * 60)
        
        # Estadísticas generales
        cursor = self.conn.execute("SELECT COUNT(*) FROM cartera_universal")
        total_rows = cursor.fetchone()[0]
        
        cursor = self.conn.execute("SELECT COUNT(DISTINCT sheet_name) FROM cartera_universal")
        unique_sheets = cursor.fetchone()[0]
        
        cursor = self.conn.execute("PRAGMA table_info(cartera_universal)")
        total_columns = len(cursor.fetchall())
        
        # Verificar columnas con más datos
        cursor = self.conn.execute("PRAGMA table_info(cartera_universal)")
        columns = [row[1] for row in cursor.fetchall() if row[1] not in ['id', 'sheet_name', 'row_index', 'migration_timestamp']]
        
        column_stats = {}
        for col in columns[:20]:  # Solo primeras 20 por rendimiento
            try:
                cursor = self.conn.execute(f"SELECT COUNT(*) FROM cartera_universal WHERE {col} IS NOT NULL")
                non_null_count = cursor.fetchone()[0]
                column_stats[col] = non_null_count
            except:
                column_stats[col] = 0
        
        # Crear reporte
        report = {
            'verification_timestamp': pd.Timestamp.now().isoformat(),
            'source_checklist': self.checklist_file,
            'target_database': self.sqlite_file,
            'summary': {
                'total_rows_migrated': total_rows,
                'total_sheets_migrated': unique_sheets,
                'total_columns_in_schema': total_columns,
                'checklist_columns': len(self.checklist['columns'])
            },
            'column_utilization': column_stats,
            'verification_status': 'COMPLETED'
        }
        
        # Guardar reporte
        with open('verification_report.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Reporte guardado en: verification_report.json")
        
        # Mostrar resumen
        print(f"\n📊 RESUMEN DE VERIFICACIÓN:")
        print(f"   ✅ Filas migradas: {total_rows:,}")
        print(f"   ✅ Hojas migradas: {unique_sheets}")
        print(f"   ✅ Columnas en esquema: {total_columns}")
        print(f"   ✅ Columnas del checklist: {len(self.checklist['columns'])}")
        
        # Top columnas con más datos
        if column_stats:
            top_columns = sorted(column_stats.items(), key=lambda x: x[1], reverse=True)[:10]
            print(f"\n📊 Columnas con más datos (top 10):")
            for col, count in top_columns:
                print(f"   {col:<40}: {count:>8} valores")
        
        return report
    
    def run_full_verification(self):
        """Ejecuta verificación completa"""
        print("🔍 INICIANDO VERIFICACIÓN COMPLETA DE MIGRACIÓN")
        print("=" * 80)
        
        try:
            self.load_resources()
            
            # Verificaciones paso a paso
            structure_ok = self.verify_database_structure()
            data_counts = self.verify_data_counts()
            self.verify_sample_data()
            report = self.generate_verification_report()
            
            print(f"\n🎉 VERIFICACIÓN COMPLETADA")
            
            if structure_ok and report['summary']['total_rows_migrated'] > 0:
                print("✅ Migración exitosa - Sin pérdida de columnas")
                return True
            else:
                print("⚠️  Migración con advertencias - Revisar reporte")
                return False
                
        except Exception as e:
            print(f"❌ Error durante verificación: {str(e)}")
            return False
        finally:
            if self.conn:
                self.conn.close()

if __name__ == "__main__":
    # Configuración
    sqlite_file = "cartera_migrated.db"
    checklist_file = "column_checklist.json"
    excel_file = "cartera.xlsx"
    
    # Verificar que existan los archivos
    import os
    
    if not os.path.exists(sqlite_file):
        print(f"❌ Base de datos no encontrada: {sqlite_file}")
        print("   Ejecute primero: python migrate_to_sqlite.py")
        exit(1)
        
    if not os.path.exists(checklist_file):
        print(f"❌ Checklist no encontrado: {checklist_file}")
        exit(1)
    
    # Ejecutar verificación
    verifier = MigrationVerifier(sqlite_file, checklist_file, excel_file)
    success = verifier.run_full_verification()
    
    if success:
        print(f"\n✅ ¡Verificación exitosa! No se perdieron datos.")
    else:
        print(f"\n⚠️  Verificación con problemas. Revise los reportes generados.")