"""
Script de diagnóstico para ver la estructura del Excel
"""
import pandas as pd

ARCHIVO_EXCEL = "cartera.xlsx"

xlsx = pd.ExcelFile(ARCHIVO_EXCEL, engine='openpyxl')

# Cargar con header=1 (fila 2)
df = pd.read_excel(xlsx, sheet_name="Diciembre 2025", header=1)

print("="*60)
print("COLUMNAS ENCONTRADAS (con header=1):")
print("="*60)
for idx, col in enumerate(df.columns):
    print(f"  [{idx}] '{col}'")

print("\n" + "="*60)
print("PRIMERAS 3 FILAS DE DATOS:")
print("="*60)

# Buscar columnas relevantes
cols_interes = []
for col in df.columns:
    col_str = str(col).lower()
    if any(x in col_str for x in ['crédito', 'credito', 'cuota', 'monto', 'pagado', '#']):
        cols_interes.append(col)
    if col == '#':
        cols_interes.append(col)

print(f"\nColumnas de interés: {cols_interes}")

for idx, row in df.head(3).iterrows():
    print(f"\nFila {idx}:")
    for col in cols_interes:
        if col in df.columns:
            print(f"  '{col}': {row[col]}")
