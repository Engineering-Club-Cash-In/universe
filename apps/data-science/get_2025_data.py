import sqlite3
import pandas as pd

def get_vehicle_data(year, vehicle_type_filter_sql):
    """
    Queries the database for vehicle counts for a specific year and filter.
    
    Args:
        year (int): The year to filter by (ANIO_ALZA).
        vehicle_type_filter_sql (str): The SQL WHERE clause for the vehicle type.
        
    Returns:
        dict: A dictionary with total, capital, and rest_of_country counts.
    """
    db_file = 'parque_vehicular.db'
    with sqlite3.connect(db_file) as conn:
        # Query for Total
        query_total = f"""
            SELECT SUM(CANTIDAD)
            FROM vehiculos
            WHERE ANIO_ALZA <= {year}
            AND {vehicle_type_filter_sql}
        """
        total_count = pd.read_sql_query(query_total, conn).iloc[0, 0] or 0

        # Query for Capital (Guatemala)
        query_capital = f"""
            SELECT SUM(CANTIDAD)
            FROM vehiculos
            WHERE ANIO_ALZA <= {year}
            AND NOMBRE_DEPARTAMENTO = 'GUATEMALA'
            AND {vehicle_type_filter_sql}
        """
        capital_count = pd.read_sql_query(query_capital, conn).iloc[0, 0] or 0
        
        # Calculate Rest of Country
        rest_count = total_count - capital_count
        
        return {
            'Total': int(total_count),
            'Capital': int(capital_count),
            'Resto de país': int(rest_count)
        }

# --- Define Vehicle Categories based on exploration ---
# Note: These names are based on the data exploration.
categories = {
    'Automóviles': "TIPO_VEHICULO = 'AUTOMOVIL'",
    'Pick Ups': "TIPO_VEHICULO = 'PICK UP'",
    'Camionetas, camionetillas y paneles': "TIPO_VEHICULO IN ('CAMIONETA', 'CAMIONETILLA', 'PANEL')",
    'Jeep': "TIPO_VEHICULO = 'JEEP'"
}

# --- Get Data for 2025 ---
year_to_query = 2025
results = []
print(f"Generando datos para el año {year_to_query}...")

for name, sql_filter in categories.items():
    print(f"  - Calculando '{name}'...")
    data = get_vehicle_data(year_to_query, sql_filter)
    results.append({
        'Tipo de vehículo': name,
        f'{year_to_query}': data['Total'],
        'Capital': data['Capital'],
        'Resto de país': data['Resto de país']
    })

# --- Create and display DataFrame ---
df_2025 = pd.DataFrame(results)

# Calculate Grand Total row
grand_total = {
    'Tipo de vehículo': 'Total',
    f'{year_to_query}': df_2025[f'{year_to_query}'].sum(),
    'Capital': df_2025['Capital'].sum(),
    'Resto de país': df_2025['Resto de país'].sum()
}
df_2025 = pd.concat([df_2025, pd.DataFrame([grand_total])], ignore_index=True)

# --- Add 2023 Data and Growth Calculations ---

# Data from the user's 2023 presentation image
data_2023 = {
    'Automóviles': 858150,
    'Pick Ups': 717803,
    'Camionetas, camionetillas y paneles': 671299,
    'Jeep': 22573,
    'Total': 2269825
}
df_2023 = pd.Series(data_2023, name='2023').reset_index()
df_2023.rename(columns={'index': 'Tipo de vehículo'}, inplace=True)

# Merge 2023 data into the main dataframe
df_final = pd.merge(df_2023, df_2025, on='Tipo de vehículo')

# --- Calculate Growth Metrics ---
# Total growth over the period (2 years)
df_final['% Crecimiento'] = ((df_final['2025'] / df_final['2023']) - 1) * 100

# Annualized growth rate: ((end_value / start_value)^(1/num_years)) - 1
num_years = 2  # 2025 - 2023
df_final['% crecimiento anual'] = (pow(df_final['2025'] / df_final['2023'], 1/num_years) - 1) * 100

# --- Reorder and Format Columns for Final Presentation ---
final_columns = [
    'Tipo de vehículo', 
    '2023', 
    '2025', 
    '% Crecimiento', 
    '% crecimiento anual', 
    'Capital', 
    'Resto de país'
]
df_final = df_final[final_columns]

# Format for better readability
df_final['2023'] = df_final['2023'].map('{:,.0f}'.format)
df_final['2025'] = df_final['2025'].map('{:,.0f}'.format)
df_final['Capital'] = df_final['Capital'].map('{:,.0f}'.format)
df_final['Resto de país'] = df_final['Resto de país'].map('{:,.0f}'.format)
df_final['% Crecimiento'] = df_final['% Crecimiento'].map('{:.2f}%'.format)
df_final['% crecimiento anual'] = df_final['% crecimiento anual'].map('{:.2f}%'.format)

print("\\n" + "="*100)
print("--- Comparativa de Crecimiento de Vehículos 2023 vs. 2025 ---")
print(df_final.to_string())
print("\\n" + "="*100)
print("\\nNota Importante:")
print("La base de datos actual no contiene información para diferenciar entre vehículos 'Importados' y 'de Agencia'.")
print("Por lo tanto, no es posible replicar las columnas '70% Importados' y '30% Agencia' de tu imagen.") 