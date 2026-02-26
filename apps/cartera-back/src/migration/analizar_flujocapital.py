import openpyxl
import psycopg2
from decimal import Decimal

EXCEL_PATH = r"C:\Users\Kelvin Palacios\Downloads\Flujocapital.xlsx"
DB_DSN = "postgresql://postgres.vtlysmsiigoytyddahvs:RvYhlLvt7ikgEbpW@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
INVERSIONISTA_ID = 84  # Flujocapital

# 1) Leer Excel - Hoja "Enero 2026"
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["Enero 2026"]

# Headers fila 4: A=No.CREDITO, K=AMORTIZACIÓN CAPITAL
excel_data = {}
total_amort_excel = Decimal("0")
for row in ws.iter_rows(min_row=5, values_only=False):
    credito_sifco = row[0].value  # columna A
    amort_capital = row[10].value  # columna K (AMORTIZACIÓN CAPITAL)
    if credito_sifco is None:
        continue
    credito_sifco = str(credito_sifco).strip()
    if amort_capital is None:
        amort_capital = Decimal("0")
    else:
        amort_capital = Decimal(str(amort_capital))
    excel_data[credito_sifco] = amort_capital
    total_amort_excel += amort_capital

print(f"=== EXCEL FLUJOCAPITAL (Enero 2026) ===")
print(f"Total creditos en Excel: {len(excel_data)}")
print(f"Total Amortizacion Capital (Excel): Q{total_amort_excel:,.2f}")

# 2) Consultar DB - abono_capital de espejo por crédito (NO_LIQUIDADO)
conn = psycopg2.connect(DB_DSN)
cur = conn.cursor()

cur.execute("""
    SELECT
        c.numero_credito_sifco,
        COALESCE(SUM(pe.abono_capital), 0) as total_abono_capital
    FROM cartera.pagos_credito_inversionistas_espejo pe
    JOIN cartera.creditos c ON c.credito_id = pe.credito_id
    WHERE pe.inversionista_id = %s
      AND pe.estado_liquidacion = 'NO_LIQUIDADO'
    GROUP BY c.numero_credito_sifco
    ORDER BY c.numero_credito_sifco
""", (INVERSIONISTA_ID,))

db_data = {}
total_abono_db = Decimal("0")
for row in cur.fetchall():
    sifco = str(row[0]).strip()
    abono = Decimal(str(row[1]))
    db_data[sifco] = abono
    total_abono_db += abono

print(f"\n=== DB ESPEJO (NO_LIQUIDADO) ===")
print(f"Total creditos en DB: {len(db_data)}")
print(f"Total Abono Capital (DB): Q{total_abono_db:,.2f}")

# 3) Comparar
print(f"\n=== COMPARACION ===")
print(f"Diferencia totales: Q{total_abono_db - total_amort_excel:,.2f}")

all_sifcos = sorted(set(list(excel_data.keys()) + list(db_data.keys())))

diferencias = []
solo_excel = []
solo_db = []
coinciden = 0

for sifco in all_sifcos:
    excel_val = excel_data.get(sifco)
    db_val = db_data.get(sifco)

    if excel_val is None:
        solo_db.append((sifco, db_val))
    elif db_val is None:
        solo_excel.append((sifco, excel_val))
    else:
        diff = db_val - excel_val
        if abs(diff) > Decimal("0.01"):
            diferencias.append((sifco, excel_val, db_val, diff))
        else:
            coinciden += 1

print(f"\nCreditos que coinciden: {coinciden}")
print(f"Creditos con diferencia: {len(diferencias)}")
print(f"Solo en Excel: {len(solo_excel)}")
print(f"Solo en DB: {len(solo_db)}")

if diferencias:
    print(f"\n--- DIFERENCIAS ---")
    print(f"{'SIFCO':<25} {'Excel(Amort)':>15} {'DB(Abono)':>15} {'Diff':>15}")
    total_diff = Decimal("0")
    for sifco, excel_val, db_val, diff in diferencias:
        print(f"{sifco:<25} {excel_val:>15.2f} {db_val:>15.2f} {diff:>15.2f}")
        total_diff += diff
    print(f"{'TOTAL DIFERENCIAS':<25} {'':>15} {'':>15} {total_diff:>15.2f}")

if solo_excel:
    print(f"\n--- SOLO EN EXCEL (no en DB espejo) ---")
    total_solo_excel = Decimal("0")
    for sifco, val in solo_excel:
        print(f"  {sifco}: Q{val:,.2f}")
        total_solo_excel += val
    print(f"  TOTAL: Q{total_solo_excel:,.2f}")

if solo_db:
    print(f"\n--- SOLO EN DB (no en Excel) ---")
    total_solo_db = Decimal("0")
    for sifco, val in solo_db:
        print(f"  {sifco}: Q{val:,.2f}")
        total_solo_db += val
    print(f"  TOTAL: Q{total_solo_db:,.2f}")

cur.close()
conn.close()
wb.close()
