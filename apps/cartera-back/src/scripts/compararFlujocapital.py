import os
import sys
import openpyxl
import psycopg2
from decimal import Decimal

EXCEL_PATH = r"C:\Users\Kelvin Palacios\Downloads\flujo).xlsx"
SHEET = sys.argv[1] if len(sys.argv) > 1 else "marzo 2026"
INVERSIONISTA_ID = 84

DSN = os.environ.get("SUPABASE_DB_URL")
if not DSN:
    # Fallback: try reading from .env
    with open(r"c:\Users\Kelvin Palacios\Documents\universe\apps\cartera-back\.env") as f:
        for line in f:
            if line.startswith("SUPABASE_DB_URL="):
                DSN = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

# 1) Excel: SIFCO -> CAPITAL RESTANTE (col M = index 12, 0-based)
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb[SHEET]
excel = {}
total_cap_restante = Decimal("0")
for r in ws.iter_rows(min_row=5, values_only=True):
    sifco, capital_restante = r[0], r[12]
    if sifco is None:
        continue
    s = str(sifco).strip()
    if s.endswith("_2"):
        s = s[:-2]
    cr = Decimal(str(capital_restante)) if capital_restante is not None else Decimal("0")
    excel[s] = cr
    total_cap_restante += cr

print(f"=== EXCEL {SHEET} ===")
print(f"Creditos: {len(excel)}")
print(f"Total CAPITAL RESTANTE: {total_cap_restante:,.2f}")

# 2) DB: SIFCO -> monto_aportado (inversionista 84)
conn = psycopg2.connect(DSN)
cur = conn.cursor()
cur.execute(
    """
    SELECT c.numero_credito_sifco, cie.monto_aportado, c."statusCredit"
    FROM cartera.creditos_inversionistas_espejo cie
    JOIN cartera.creditos c ON c.credito_id = cie.credito_id
    WHERE cie.inversionista_id = %s
    """,
    (INVERSIONISTA_ID,),
)
db = {}
total_aportado = Decimal("0")
status_map = {}
for sifco, monto, status in cur.fetchall():
    s = str(sifco).strip()
    db[s] = Decimal(str(monto))
    status_map[s] = status
    total_aportado += Decimal(str(monto))

print(f"\n=== DB ESPEJO (inv 84) ===")
print(f"Creditos: {len(db)}")
print(f"Total monto_aportado: {total_aportado:,.2f}")

# 3) Comparar
all_s = sorted(set(excel) | set(db))
iguales, diffs, solo_excel, solo_db = 0, [], [], []
for s in all_s:
    e, d = excel.get(s), db.get(s)
    if e is None:
        solo_db.append((s, d, status_map.get(s)))
    elif d is None:
        solo_excel.append((s, e))
    else:
        diff = d - e
        if abs(diff) > Decimal("0.01"):
            diffs.append((s, e, d, diff, status_map.get(s)))
        else:
            iguales += 1

print(f"\n=== RESUMEN ===")
print(f"Coinciden (|diff|<=0.01): {iguales}")
print(f"Con diferencia: {len(diffs)}")
print(f"Solo en Excel: {len(solo_excel)}")
print(f"Solo en DB: {len(solo_db)}")
print(f"Diff global monto_aportado - capital_restante: {total_aportado - total_cap_restante:,.2f}")

if diffs:
    print(f"\n--- DIFERENCIAS (DB monto_aportado vs Excel capital_restante) ---")
    print(f"{'SIFCO':<20} {'Excel CR':>15} {'DB Aport':>15} {'Diff':>15}  Status")
    total_diff = Decimal("0")
    # Mayores diferencias primero
    for s, e, d, diff, st in sorted(diffs, key=lambda x: abs(x[3]), reverse=True):
        print(f"{s:<20} {e:>15,.2f} {d:>15,.2f} {diff:>15,.2f}  {st}")
        total_diff += diff
    print(f"{'TOTAL DIFF':<20} {'':>15} {'':>15} {total_diff:>15,.2f}")

if solo_excel:
    print(f"\n--- SOLO EN EXCEL ({len(solo_excel)}) ---")
    for s, e in solo_excel[:30]:
        print(f"  {s:<20} {e:>15,.2f}")

if solo_db:
    print(f"\n--- SOLO EN DB ({len(solo_db)}) ---  (primeros 30)")
    for s, d, st in solo_db[:30]:
        print(f"  {s:<20} {d:>15,.2f}  {st}")

cur.close()
conn.close()
