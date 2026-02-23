import openpyxl
import requests
import time

# Config
EXCEL_PATH = "diferencias_abono_capital.xlsx"
SHEET_NAME = "Diferencias Abono Capital"
API_URL = "http://localhost:7000/update-pagos-espejo"
HEADER_ROW = 8  # La fila 8 tiene los headers

def main():
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb[SHEET_NAME]

    total = 0
    exitosos = 0
    fallidos = 0
    errores = []

    # Iterar desde la fila 9 (después del header) hasta el final
    for row in ws.iter_rows(min_row=HEADER_ROW + 1, max_row=ws.max_row, max_col=7, values_only=True):
        nombre_usuario = row[0]
        abono_capital_tabla = row[1]  # Valor correcto (columna B)
        abono_capital_json = row[2]   # Valor actual incorrecto (columna C)
        diferencia = row[3]
        inversionista = row[5]
        numero_credito_sifco = row[6]

        # Saltar filas vacías
        if not numero_credito_sifco or not abono_capital_tabla:
            continue

        total += 1

        payload = {
            "numero_credito_sifco": str(numero_credito_sifco),
            "abono_capital": float(abono_capital_tabla),
        }

        try:
            response = requests.post(API_URL, json=payload, timeout=10)
            data = response.json()

            if response.status_code == 200 and data.get("success"):
                exitosos += 1
                registros = data.get("registrosActualizados", 0)
                print(f"  OK  [{total}] {numero_credito_sifco} - {nombre_usuario} -> abono_capital: {abono_capital_tabla} ({registros} registros)")
            else:
                fallidos += 1
                msg = data.get("message", "Error desconocido")
                errores.append({"sifco": numero_credito_sifco, "error": msg})
                print(f"  FAIL [{total}] {numero_credito_sifco} - {msg}")

        except Exception as e:
            fallidos += 1
            errores.append({"sifco": numero_credito_sifco, "error": str(e)})
            print(f"  ERROR [{total}] {numero_credito_sifco} - {e}")

    # Resumen
    print("\n" + "=" * 60)
    print("RESUMEN")
    print("=" * 60)
    print(f"Total procesados: {total}")
    print(f"Exitosos:         {exitosos}")
    print(f"Fallidos:         {fallidos}")

    if errores:
        print(f"\nErrores:")
        for err in errores:
            print(f"  - {err['sifco']}: {err['error']}")

if __name__ == "__main__":
    main()
