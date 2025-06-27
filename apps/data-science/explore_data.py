import sqlite3
import pandas as pd

def query_db(query):
    """Connects to the DB, executes a query, and returns a DataFrame."""
    try:
        with sqlite3.connect('parque_vehicular.db') as conn:
            return pd.read_sql_query(query, conn)
    except Exception as e:
        print(f"An error occurred: {e}")
        return pd.DataFrame()

# --- Vehicle Type Exploration ---
print("1. Distinct Vehicle Types (TIPO_VEHICULO):")
distinct_tipos = query_db("SELECT DISTINCT TIPO_VEHICULO FROM vehiculos ORDER BY TIPO_VEHICULO")
print(distinct_tipos)
print("\\n" + "="*50 + "\\n")

# --- 'Jeep' Classification ---
print("2. Investigating 'Jeep' Classification:")
print("\\n--- Checking in TIPO_VEHICULO ---")
jeep_tipos = query_db("SELECT DISTINCT TIPO_VEHICULO FROM vehiculos WHERE TIPO_VEHICULO LIKE '%JEEP%'")
print(jeep_tipos)

print("\\n--- Checking in MARCA_VEHICULO ---")
jeep_marcas = query_db("SELECT DISTINCT MARCA_VEHICULO FROM vehiculos WHERE MARCA_VEHICULO LIKE '%JEEP%'")
print(jeep_marcas)
print("\\n" + "="*50 + "\\n")

# --- Department Exploration (for Capital vs. Resto) ---
print("3. Distinct Departments (NOMBRE_DEPARTAMENTO):")
distinct_deptos = query_db("SELECT DISTINCT NOMBRE_DEPARTAMENTO FROM vehiculos ORDER BY NOMBRE_DEPARTAMENTO")
print(distinct_deptos)
print("\\n" + "="*50 + "\\n") 