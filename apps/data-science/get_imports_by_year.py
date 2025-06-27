import sqlite3
import pandas as pd

# --- Configuration ---
db_file = 'parque_vehicular.db'
table_name = 'importaciones'

def get_import_counts_by_year():
    """
    Queries the database to get counts of new vs. used imported vehicles per year since 2018.
    """
    print("Analizando datos de importación por año y condición (Nuevo/Usado)...")
    
    # A vehicle is 'New' if its model year is >= its import year.
    # We need to handle potential non-numeric values and different date formats gracefully.
    # The SUBSTR function is used to extract the year from 'DD/MM/YYYY' format.
    query = f"""
        SELECT
            SUBSTR("Fecha de la Poliza", 7, 4) AS AnioImportacion,
            CASE
                WHEN CAST("Modelo del Vehiculo" AS INTEGER) >= CAST(SUBSTR("Fecha de la Poliza", 7, 4) AS INTEGER)
                THEN 'Nuevo'
                ELSE 'Usado'
            END AS Condicion,
            COUNT(*) AS Cantidad
        FROM {table_name}
        WHERE 
            -- Filter for valid years since 2018
            SUBSTR("Fecha de la Poliza", 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
            AND CAST(SUBSTR("Fecha de la Poliza", 7, 4) AS INTEGER) >= 2018
            AND "Modelo del Vehiculo" GLOB '[0-9][0-9][0-9][0-9]'
        GROUP BY
            AnioImportacion, Condicion
        ORDER BY
            AnioImportacion, Condicion
    """
    
    try:
        with sqlite3.connect(db_file) as conn:
            df = pd.read_sql_query(query, conn)
        
        if df.empty:
            print("No se encontraron datos de importación para los años especificados.")
            return

        # Pivot the table to have 'Nuevo' and 'Usado' as columns
        df_pivot = df.pivot(index='AnioImportacion', columns='Condicion', values='Cantidad').fillna(0)
        df_pivot = df_pivot.astype(int)
        
        # Ensure both columns exist even if one has no data
        if 'Nuevo' not in df_pivot.columns:
            df_pivot['Nuevo'] = 0
        if 'Usado' not in df_pivot.columns:
            df_pivot['Usado'] = 0
            
        df_pivot = df_pivot[['Nuevo', 'Usado']] # Reorder
        
        # Calculate total and format for display
        df_pivot['Total Importados'] = df_pivot['Nuevo'] + df_pivot['Usado']
        
        print("\\n" + "="*60)
        print("--- Vehículos Importados por Año y Condición ---")
        print(df_pivot.to_string())
        print("\\n" + "="*60)

    except Exception as e:
        print(f"Ocurrió un error al consultar la base de datos: {e}")

if __name__ == '__main__':
    get_import_counts_by_year() 