import os
import pandas as pd
import requests
from fuzzywuzzy import fuzz, process
import unicodedata

# ============================================
# CONFIGURACIÓN
# ============================================
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"
HOJAS = ["Enero 2026", "Febrero 2026"]
API_BASE = "http://localhost:7000"
UMBRAL_MATCH = 70  # % mínimo para considerar match

def normalizar(texto: str) -> str:
    """Quita tildes, lowercase, trim"""
    if not texto or not isinstance(texto, str):
        return ""
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return texto.lower().strip()

def leer_excel(hoja):
    """Lee el Excel y extrae Nombre + Asesor de una hoja específica"""
    # Buscar archivo dinámicamente para evitar problemas de encoding
    ruta = None
    for f in os.listdir(CARPETA_EXCELS):
        if "NUEVA 3.0" in f and f.endswith(".xlsx") and not f.startswith("~") and "cierre" not in f.lower():
            ruta = os.path.join(CARPETA_EXCELS, f)
            break

    if not ruta:
        print("❌ No se encontró el archivo Excel")
        return []

    print(f"\n📂 Leyendo: {ruta}")
    print(f"📄 Hoja: {hoja}")

    df = pd.read_excel(ruta, sheet_name=hoja, header=None)

    # Buscar fila de encabezados
    header_row = None
    for i, row in df.iterrows():
        for val in row:
            if isinstance(val, str) and "nombre" in val.lower():
                header_row = i
                break
        if header_row is not None:
            break

    if header_row is None:
        print("❌ No se encontró fila de encabezados con 'Nombre'")
        return []

    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    # Buscar columnas Nombre y Asesor
    col_nombre = None
    col_asesor = None
    for col in df.columns:
        if isinstance(col, str):
            col_lower = col.lower().strip()
            if "nombre" in col_lower and col_nombre is None:
                col_nombre = col
            if "asesor" in col_lower and col_asesor is None:
                col_asesor = col

    if not col_nombre or not col_asesor:
        print(f"❌ No se encontraron columnas. Nombre: {col_nombre}, Asesor: {col_asesor}")
        print(f"   Columnas disponibles: {list(df.columns)}")
        return []

    print(f"✅ Columna Nombre: '{col_nombre}'")
    print(f"✅ Columna Asesor: '{col_asesor}'")

    # Extraer pares únicos nombre-asesor
    pares = []
    vistos = set()
    for _, row in df.iterrows():
        nombre = str(row[col_nombre]).strip() if pd.notna(row[col_nombre]) else ""
        asesor = str(row[col_asesor]).strip() if pd.notna(row[col_asesor]) else ""
        if nombre and asesor and nombre != "nan" and asesor != "nan":
            key = normalizar(nombre)
            if key not in vistos:
                vistos.add(key)
                pares.append({"nombre": nombre, "asesor": asesor})

    print(f"📊 Pares únicos nombre-asesor encontrados: {len(pares)}")
    return pares

def obtener_creditos_crm():
    """Obtiene créditos con CRM del backend"""
    print(f"\n🔗 Obteniendo créditos CRM de {API_BASE}/creditos-crm ...")
    resp = requests.get(f"{API_BASE}/creditos-crm", timeout=30)
    data = resp.json()

    if not data.get("success"):
        print(f"❌ Error del backend: {data}")
        return []

    creditos = data["data"]
    print(f"✅ Créditos CRM encontrados: {data['total']}")
    return creditos

def hacer_match(pares_excel, creditos_crm):
    """Fuzzy match automático: itera los créditos CRM y busca su nombre en el Excel"""
    excel_por_nombre = {}
    for par in pares_excel:
        key = normalizar(par["nombre"])
        if key:
            excel_por_nombre[key] = par

    nombres_excel = list(excel_por_nombre.keys())
    matches = []
    sin_match = []

    for credito in creditos_crm:
        nombre_crm = normalizar(credito["nombre_cliente"])
        if not nombre_crm:
            sin_match.append({
                "nombre_db": credito["nombre_cliente"],
                "credito_id": credito["credito_id"],
                "mejor_score": 0,
                "mejor_candidato": "N/A",
            })
            continue

        # Match exacto
        if nombre_crm in excel_por_nombre:
            par = excel_por_nombre[nombre_crm]
            matches.append({
                "credito_id": credito["credito_id"],
                "nombre_db": credito["nombre_cliente"],
                "nombre_excel": par["nombre"],
                "asesor_excel": par["asesor"],
                "asesor_actual": credito["asesor_nombre"],
                "score": 100,
            })
            continue

        # Fuzzy match
        if not nombres_excel:
            continue
        resultado = process.extractOne(nombre_crm, nombres_excel, scorer=fuzz.token_sort_ratio)
        if resultado and resultado[1] >= UMBRAL_MATCH:
            mejor_nombre = resultado[0]
            score = resultado[1]
            par = excel_por_nombre[mejor_nombre]
            matches.append({
                "credito_id": credito["credito_id"],
                "nombre_db": credito["nombre_cliente"],
                "nombre_excel": par["nombre"],
                "asesor_excel": par["asesor"],
                "asesor_actual": credito["asesor_nombre"],
                "score": score,
            })
        else:
            sin_match.append({
                "nombre_db": credito["nombre_cliente"],
                "credito_id": credito["credito_id"],
                "mejor_score": resultado[1] if resultado else 0,
                "mejor_candidato": resultado[0] if resultado else "N/A",
            })

    return matches, sin_match

def actualizar_asesores(matches):
    """Envía los matches al endpoint para actualizar asesores"""
    exitos = 0
    fallos = 0

    for m in matches:
        if normalizar(m["asesor_excel"]) == normalizar(m["asesor_actual"]):
            print(f"  ⏭️  {m['nombre_db']} - asesor ya es '{m['asesor_actual']}', skip")
            continue

        try:
            resp = requests.post(
                f"{API_BASE}/updateCreditAdvisor",
                json={
                    "credito_id": m["credito_id"],
                    "nombre_asesor": m["asesor_excel"],
                },
                timeout=15,
            )
            data = resp.json()
            if data.get("success"):
                print(f"  ✅ {m['nombre_db']} → asesor: '{m['asesor_excel']}' (score: {m['score']})")
                exitos += 1
            else:
                print(f"  ❌ {m['nombre_db']}: {data.get('message')}")
                fallos += 1
        except Exception as e:
            print(f"  ❌ {m['nombre_db']}: {e}")
            fallos += 1

    return exitos, fallos

def main():
    print("=" * 60)
    print("  ACTUALIZAR ASESORES - Créditos CRM")
    print("=" * 60)

    # 1. Leer Excel de todas las hojas y unificar pares
    pares_excel = []
    for hoja in HOJAS:
        print(f"\n{'─' * 40}")
        pares = leer_excel(hoja)
        if pares:
            pares_excel.extend(pares)
        else:
            print(f"⚠️  No se encontraron datos en hoja '{hoja}'")

    # Deduplicar por nombre normalizado (última hoja gana)
    vistos = {}
    for par in pares_excel:
        vistos[normalizar(par["nombre"])] = par
    pares_excel = list(vistos.values())
    print(f"\n📊 Total pares únicos (todas las hojas): {len(pares_excel)}")

    if not pares_excel:
        print("❌ No se encontraron datos en el Excel")
        return

    # 2. Obtener créditos CRM de la DB
    creditos_crm = obtener_creditos_crm()
    if not creditos_crm:
        print("❌ No hay créditos CRM en la base de datos")
        return

    # 3. Fuzzy match
    print(f"\n🔍 Haciendo fuzzy match (umbral: {UMBRAL_MATCH}%)...")
    matches, sin_match = hacer_match(pares_excel, creditos_crm)

    print(f"\n📊 RESULTADOS DEL MATCH:")
    print(f"   ✅ Matches encontrados: {len(matches)}")
    print(f"   ❌ Sin match: {len(sin_match)}")

    if matches:
        print(f"\n✅ Matches ({len(matches)}):")
        for m in matches:
            cambio = " (MISMO ASESOR)" if normalizar(m["asesor_excel"]) == normalizar(m["asesor_actual"]) else ""
            print(f"   [{m['score']}%] DB: '{m['nombre_db']}' ↔ Excel: '{m['nombre_excel']}' → Asesor: '{m['asesor_excel']}' (actual: '{m['asesor_actual']}'){cambio}")

    if sin_match:
        print(f"\n⚠️  Sin match ({len(sin_match)}):")
        for s in sin_match:
            print(f"   - ID:{s['credito_id']} '{s['nombre_db']}' (mejor: '{s['mejor_candidato']}' {s['mejor_score']}%)")

    if not matches:
        print("\n❌ No hay matches para procesar")
        return

    # 4. Actualizar
    print(f"\n🚀 Actualizando asesores...")
    exitos, fallos = actualizar_asesores(matches)

    print(f"\n{'=' * 60}")
    print(f"  RESUMEN FINAL")
    print(f"  ✅ Exitosos: {exitos}")
    print(f"  ❌ Fallidos: {fallos}")
    print(f"  ⏭️  Skipped (ya tenían el asesor correcto): {len(matches) - exitos - fallos}")
    print(f"{'=' * 60}")

if __name__ == "__main__":
    main()
