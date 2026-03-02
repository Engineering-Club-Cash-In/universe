import os, pandas as pd, requests, unicodedata
from fuzzywuzzy import fuzz, process

CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
HOJAS = ["Enero 2026", "Febrero 2026"]

def normalizar(texto):
    if not texto or not isinstance(texto, str):
        return ""
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return texto.lower().strip()

# Leer Excel
pares = {}
for hoja in HOJAS:
    ruta = None
    for f in os.listdir(CARPETA_EXCELS):
        if "NUEVA 3.0" in f and f.endswith(".xlsx") and not f.startswith("~") and "cierre" not in f.lower():
            ruta = os.path.join(CARPETA_EXCELS, f)
            break
    df = pd.read_excel(ruta, sheet_name=hoja, header=None)
    header_row = None
    for i, row in df.iterrows():
        for val in row:
            if isinstance(val, str) and "nombre" in val.lower():
                header_row = i
                break
        if header_row is not None:
            break
    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    col_nombre = col_asesor = None
    for col in df.columns:
        if isinstance(col, str):
            if "nombre" in col.lower().strip() and not col_nombre:
                col_nombre = col
            if "asesor" in col.lower().strip() and not col_asesor:
                col_asesor = col
    for _, row in df.iterrows():
        nombre = str(row[col_nombre]).strip() if pd.notna(row[col_nombre]) else ""
        asesor = str(row[col_asesor]).strip() if pd.notna(row[col_asesor]) else ""
        if nombre and asesor and nombre != "nan" and asesor != "nan":
            pares[normalizar(nombre)] = {"nombre": nombre, "asesor": asesor}

nombres_excel = list(pares.keys())

# Obtener CRM Gerencia
resp = requests.get("http://localhost:7000/creditos-crm", timeout=30)
creditos = resp.json()["data"]

print(f"CRM con Gerencia: {len(creditos)}")
print("=" * 90)

for c in creditos:
    nombre = normalizar(c["nombre_cliente"])
    print(f"\nID:{c['credito_id']} | DB: '{c['nombre_cliente']}'")

    # Top 3 con cada scorer
    top_sort = process.extract(nombre, nombres_excel, scorer=fuzz.token_sort_ratio, limit=3)
    top_partial = process.extract(nombre, nombres_excel, scorer=fuzz.partial_ratio, limit=3)

    # Combinar y deduplicar
    vistos = set()
    candidatos = []
    for n, score in top_sort + top_partial:
        if n not in vistos:
            vistos.add(n)
            s1 = fuzz.token_sort_ratio(nombre, n)
            s2 = fuzz.partial_ratio(nombre, n)
            candidatos.append((n, s1, s2, max(s1, s2)))
    candidatos.sort(key=lambda x: x[3], reverse=True)

    for i, (n, s1, s2, best) in enumerate(candidatos[:5], 1):
        p = pares[n]
        print(f"   {i}) [{best}%] '{p['nombre']}' -> Asesor: '{p['asesor']}'")
