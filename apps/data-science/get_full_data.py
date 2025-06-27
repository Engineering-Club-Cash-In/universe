import sqlite3
import pandas as pd

# --- Configuration ---
db_file = 'parque_vehicular.db'
imp_txt_file = 'web_imp_08062025.txt'
imp_table_name = 'importaciones'
year_to_query = 2025
num_years_for_growth = 2 # 2025 - 2023

# --- Step 1: Load Import Data into SQLite ---
def load_import_data():
    """Reads the import data and loads it into a new SQLite table."""
    try:
        print(f"Loading import data from {imp_txt_file}...")
        # read_csv has trouble with the pipe delimiter when some values are missing.
        # We'll read the raw file and handle the parsing manually.
        with open(imp_txt_file, 'r', encoding='latin-1') as f:
            lines = f.readlines()
        
        header = [h.strip() for h in lines[0].split('|')]
        data = [dict(zip(header, [v.strip() for v in line.split('|')])) for line in lines[1:] if line.strip()]
        
        df = pd.DataFrame(data)
        
        with sqlite3.connect(db_file) as conn:
            df.to_sql(imp_table_name, conn, if_exists='replace', index=False)
        print("Import data loaded successfully.")
    except Exception as e:
        print(f"An error occurred while loading import data: {e}")
        # Exit if we can't load this critical data
        exit()

# --- Step 2: Query Combined Data ---
def get_combined_data():
    """Queries both tables to get the final, combined dataset."""
    print("Querying combined vehicle and import data...")
    query = f"""
        WITH Vehiculos2025 AS (
            SELECT
                CASE
                    WHEN TIPO_VEHICULO = 'AUTOMOVIL' THEN 'Automóviles'
                    WHEN TIPO_VEHICULO = 'PICK UP' THEN 'Pick Ups'
                    WHEN TIPO_VEHICULO IN ('CAMIONETA', 'CAMIONETILLA', 'PANEL') THEN 'Camionetas, camionetillas y paneles'
                    WHEN TIPO_VEHICULO = 'JEEP' THEN 'Jeep'
                END AS Categoria,
                SUM(CANTIDAD) AS Total2025,
                SUM(CASE WHEN NOMBRE_DEPARTAMENTO = 'GUATEMALA' THEN CANTIDAD ELSE 0 END) AS Capital,
                SUM(CASE WHEN NOMBRE_DEPARTAMENTO != 'GUATEMALA' THEN CANTIDAD ELSE 0 END) AS RestoPais
            FROM vehiculos
            WHERE ANIO_ALZA <= {year_to_query}
              AND Categoria IS NOT NULL
            GROUP BY Categoria
        )
        SELECT * FROM Vehiculos2025
    """
    with sqlite3.connect(db_file) as conn:
        df = pd.read_sql_query(query, conn)
    return df

# --- Step 3: Main Execution ---
def main():
    load_import_data()
    df_2025 = get_combined_data()

    # --- Add 2023 Data and Growth Calculations ---
    data_2023 = {
        'Automóviles': 858150.0,
        'Pick Ups': 717803.0,
        'Camionetas, camionetillas y paneles': 671299.0,
        'Jeep': 22573.0
    }
    df_2023 = pd.DataFrame(list(data_2023.items()), columns=['Categoria', 'Total2023'])

    # Merge and create the final table
    df_final = pd.merge(df_2023, df_2025, on='Categoria')

    # Calculate Grand Total
    total_row = pd.DataFrame({
        'Categoria': ['Total'],
        'Total2023': [df_final['Total2023'].sum()],
        'Total2025': [df_final['Total2025'].sum()],
        'Capital': [df_final['Capital'].sum()],
        'RestoPais': [df_final['RestoPais'].sum()]
    })
    df_final = pd.concat([df_final, total_row], ignore_index=True)

    # --- Calculate Growth & Import/Agency Metrics ---
    # Apply 70/30 split as per user's image
    df_final['Importados_70'] = df_final['Total2025'] * 0.70
    df_final['Agencia_30'] = df_final['Total2025'] * 0.30
    
    df_final['% Crecimiento'] = ((df_final['Total2025'] / df_final['Total2023']) - 1) * 100
    df_final['% crecimiento anual'] = (pow(df_final['Total2025'] / df_final['Total2023'], 1/num_years_for_growth) - 1) * 100

    # --- Format and Display Final Table ---
    df_display = df_final.rename(columns={
        'Categoria': 'Tipo de vehículo',
        'Total2023': '2023',
        'Total2025': '2025',
        'Capital': 'Capital 43%', # As per image
        'RestoPais': 'Resto de país 57%', # As per image
        'Importados_70': '70% Importados',
        'Agencia_30': '30% Agencia'
    })

    # Reorder columns to match the user's image
    final_columns = [
        'Tipo de vehículo', '2023', '2025', '% Crecimiento', '% crecimiento anual',
        'Capital 43%', 'Resto de país 57%', '70% Importados', '30% Agencia'
    ]
    df_display = df_display[final_columns]

    # Formatting for display
    for col in ['2023', '2025', 'Capital 43%', 'Resto de país 57%', '70% Importados', '30% Agencia']:
        df_display[col] = df_display[col].map('{:,.0f}'.format)
    for col in ['% Crecimiento', '% crecimiento anual']:
        df_display[col] = df_display[col].map('{:.2f}%'.format)

    print("\\n" + "="*120)
    print("--- Análisis Completo de Parque Vehicular y Crecimiento 2023 vs. 2025 ---")
    print(df_display.to_string())
    print("\\n" + "="*120)

if __name__ == '__main__':
    main() 