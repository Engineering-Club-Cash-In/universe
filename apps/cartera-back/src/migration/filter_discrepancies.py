import json
import pandas as pd
import os

json_path = '/home/jalvarezatcci/Documentos/universe/apps/cartera-back/src/migration/discrepancias_reporte.json'
excel_path = '/home/jalvarezatcci/Documentos/universe/apps/cartera-back/src/migration/solo_discrepancias.xlsx'

try:
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    detalles = data.get('detalles', [])
    filtered_results = []

    for d in detalles:
        etl_cuota = d['etl']['cuota']
        db_cuota = d['db']['cuota']
        etl_capital = d['etl']['capital']
        db_capital = d['db']['capital']

        if etl_cuota != db_cuota or abs(etl_capital - db_capital) > 10.0:
            row = {
                'SIFCO_BASE': d.get('sifco_base'),
                'Cliente': d['nombre_etl'],
                'CUOTA_ETL': etl_cuota,
                'CUOTA_DB': db_cuota,
                'CAPITAL_TOTAL_ETL': etl_capital,
                'CAPITAL_DB': db_capital,
                'TIPO_MATCH': d['match_type']
            }
            filtered_results.append(row)

    if filtered_results:
        df = pd.DataFrame(filtered_results)
        df.to_excel(excel_path, index=False)
        print(f"✅ Excel creado con {len(filtered_results)} discrepancias en: {excel_path}")
    else:
        print("No se encontraron discrepancias significativas para exportar.")

except Exception as e:
    print(f"❌ Error: {str(e)}")
