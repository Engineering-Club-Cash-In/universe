import os
import pandas as pd

CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL ="Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"

archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)

CREDITO_DEBUG = "01010214111980"
HOJA_DEBUG = "Diciembre 2025"

print(f"🔍 DEBUGGING ESPECÍFICO")
print(f"   Crédito: {CREDITO_DEBUG}")
print(f"   Hoja: {HOJA_DEBUG}\n")

# Leer Excel
print("📂 Leyendo Excel...")
df_raw = pd.read_excel(archivo_path, sheet_name=HOJA_DEBUG, header=None)
print(f"✅ Excel leído: {len(df_raw)} filas totales\n")

# Mostrar primeras 20 filas para encontrar headers
print(f"🔍 BUSCANDO HEADERS EN LAS PRIMERAS 20 FILAS:\n")

for idx, row in df_raw.head(20).iterrows():
    row_str = ' '.join(str(cell) for cell in row if pd.notna(cell))
    print(f"Fila {idx}: {row_str[:150]}...")

print(f"\n{'='*70}\n")

# Buscar headers (hasta fila 100)
header_row = None
for idx, row in df_raw.iterrows():
    if idx > 100:  # Buscar más lejos
        break
    row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
    if 'credito' in row_str or 'inversionista' in row_str:
        header_row = idx
        print(f"✅ Headers encontrados en fila {idx}\n")
        break

if header_row is None:
    print("❌ No se encontraron headers")
    exit()

# Leer con headers
df = pd.read_excel(archivo_path, sheet_name=HOJA_DEBUG, header=header_row)

print(f"✅ Excel leído correctamente con headers")
print(f"📊 Total de filas de datos: {len(df)}")
print(f"📋 Columnas encontradas: {len(df.columns)}\n")

# Mostrar nombres de columnas
print("📋 COLUMNAS:")
for i, col in enumerate(df.columns[:15], 1):  # Primeras 15 columnas
    print(f"   {i}. '{col}'")
print()

# Buscar TODAS las filas del crédito
print(f"🔍 Buscando crédito {CREDITO_DEBUG}...\n")

filas_credito = df[
    df['# crédito SIFCO'].astype(str).str.contains(CREDITO_DEBUG, na=False, regex=False)
]

print(f"✅ Filas encontradas: {len(filas_credito)}\n")

if len(filas_credito) == 0:
    print("❌ NO SE ENCONTRÓ EL CRÉDITO")
    print("\n🔍 Mostrando primeros 5 créditos en la hoja:")
    for idx, row in df.head(5).iterrows():
        print(f"   - {row['# crédito SIFCO']}")
    exit()

# Mostrar TODAS las filas encontradas
for idx, row in filas_credito.iterrows():
    numero_credito_raw = str(row['# crédito SIFCO']).strip()
    numero_credito_base = numero_credito_raw.split('_')[0]
    
    print(f"{'='*70}")
    print(f"📋 Fila {idx} del DataFrame")
    print(f"{'='*70}")
    print(f"   # crédito SIFCO (raw):  '{numero_credito_raw}'")
    print(f"   # crédito SIFCO (base): '{numero_credito_base}'")
    print(f"   # (cuota):              {row.get('#', 'N/A')}")
    print(f"   Inversionista:          '{row['Inversionista']}'")
    print(f"   Capital (raw):          {row['Capital']}")
    print(f"   Capital (type):         {type(row['Capital'])}")
    
    # Simular limpieza
    def limpiar_valor(valor):
        if pd.isna(valor):
            return "0"
        valor_str = str(valor).strip()
        if valor_str.upper().startswith('Q'):
            valor_str = valor_str[1:].strip()
        valor_str = valor_str.replace(',', '')
        return valor_str
    
    capital_limpio = limpiar_valor(row['Capital'])
    print(f"   Capital (limpio):       '{capital_limpio}'")
    print()

# Ahora simular el agrupamiento
print(f"\n{'='*70}")
print(f"🔄 SIMULANDO AGRUPAMIENTO POR CRÉDITO BASE")
print(f"{'='*70}\n")

creditos_data = {}

for idx, row in filas_credito.iterrows():
    numero_credito_raw = str(row['# crédito SIFCO']).strip()
    numero_credito = numero_credito_raw.split('_')[0]
    
    if numero_credito not in creditos_data:
        creditos_data[numero_credito] = []
    
    def limpiar_valor(valor):
        if pd.isna(valor):
            return "0"
        valor_str = str(valor).strip()
        if valor_str.upper().startswith('Q'):
            valor_str = valor_str[1:].strip()
        valor_str = valor_str.replace(',', '')
        return valor_str
    
    inversionista_data = {
        "inversionista": str(row['Inversionista']).strip(),
        "capital": limpiar_valor(row['Capital']),
        "porcentajeCashIn": limpiar_valor(row['% Cash-In']),
        "porcentajeInversionista": limpiar_valor(row['% Inversionista']),
        "porcentaje": limpiar_valor(row['%']),
        "cuota": limpiar_valor(row['Cuota']),
        "cuotaInversionista": limpiar_valor(row.get('Cuota Inverionista', 0)),
    }
    
    creditos_data[numero_credito].append(inversionista_data)

# Mostrar resultado agrupado
for credito, inversionistas in creditos_data.items():
    print(f"📋 Crédito base: {credito}")
    print(f"👥 Inversionistas: {len(inversionistas)}\n")
    
    for inv in inversionistas:
        print(f"   Inversionista: {inv['inversionista']}")
        print(f"   Capital: {inv['capital']}")
        print(f"   % Cash-In: {inv['porcentajeCashIn']}")
        print(f"   % Inversionista: {inv['porcentajeInversionista']}")
        print()

print(f"\n{'='*70}")
print(f"🚀 ESTO ES LO QUE SE ENVIARÍA A LA API")
print(f"{'='*70}\n")

import json
for credito, inversionistas in creditos_data.items():
    payload = {
        "numeroCredito": credito,
        "inversionistasData": inversionistas
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))