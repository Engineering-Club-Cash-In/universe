import json
import unicodedata
import os
import re

def normalizar_nombre(nombre):
    if not nombre:
        return ""
    # Dividir por '/' y quedarse con la primera parte
    nombre = str(nombre).split('/')[0]
    # Quitar acentos y convertir a minúsculas
    nombre = ''.join(c for c in unicodedata.normalize('NFD', nombre)
                  if unicodedata.category(c) != 'Mn').lower()
    # Quitar espacios extras
    return " ".join(nombre.split())

def comparar():
    # Rutas locales segun indicacion del usuario
    etl_file = "/home/jalvarezatcci/Documentos/universe/apps/cartera-back/src/migration/resultado_ultimos_pagos.json"
    db_file = "/home/jalvarezatcci/Documentos/universe/apps/cartera-back/src/migration/cartera_actual_v2.json"
    
    if not os.path.exists(etl_file):
        print(f"❌ No se encuentra el archivo del ETL: {etl_file}")
        return
    if not os.path.exists(db_file):
        print(f"❌ No se encuentra el archivo de la DB: {db_file}")
        return

    with open(etl_file, 'r', encoding='utf-8') as f:
        etl_raw = json.load(f)
    
    with open(db_file, 'r', encoding='utf-8') as f:
        db_data = json.load(f)

    # Indexar DB por SIFCO y por nombre normalizado
    db_by_sifco = {item['numero_credito_sifco']: item for item in db_data}
    db_by_name = {}
    for item in db_data:
        norm_name = normalizar_nombre(item['nombre_cliente'])
        if norm_name:
            if norm_name not in db_by_name:
                db_by_name[norm_name] = []
            db_by_name[norm_name].append(item)

    discrepancias = []
    encontrados_sifco = 0
    encontrados_nombre = 0
    no_encontrados = 0
    total_procesados = 0

    # 1. Primero calculamos los totales por SIFCO Base para referencia
    totales_etl = {}
    for grupo in etl_raw:
        nombre_grupo = grupo.get('nombreCliente')
        for credito_etl in grupo.get('creditos', []):
            sifco_etl = credito_etl.get('numeroCredito')
            sifco_base = sifco_etl.split('_')[0]
            capital_etl = float(credito_etl.get('capitalRestante', 0))
            totales_etl[sifco_base] = totales_etl.get(sifco_base, 0) + capital_etl

    # 2. Ahora procesamos cada entrada individual del ETL
    discrepancias = []
    for grupo in etl_raw:
        nombre_grupo = grupo.get('nombreCliente')
        for credito_etl in grupo.get('creditos', []):
            total_procesados += 1
            sifco_etl = credito_etl.get('numeroCredito')
            sifco_base = sifco_etl.split('_')[0]
            nombre_etl = credito_etl.get('nombreCliente') or nombre_grupo
            inversionista_etl = credito_etl.get('inversionista', 'N/A')
            capital_etl = float(credito_etl.get('capitalRestante', 0))
            capital_total_etl = totales_etl.get(sifco_base, 0)
            
            # Robust cuota parsing
            cuota_raw = str(credito_etl.get('numeroCuota', '0'))
            match_cuota = re.search(r'(\d+)', cuota_raw)
            cuota_etl = int(match_cuota.group(1)) if match_cuota else 0

            match = None
            # Intentar por SIFCO Base
            if sifco_base in db_by_sifco:
                match = db_by_sifco[sifco_base]
                encontrados_sifco += 1
            # Intentar por Nombre
            else:
                norm_name = normalizar_nombre(nombre_etl)
                if norm_name in db_by_name:
                    matches = db_by_name[norm_name]
                    # Buscamos el que coincida con el CAPITAL TOTAL del ETL
                    found_match = False
                    for m in matches:
                        cap_db = float(m.get('capital') or 0)
                        if abs(cap_db - capital_total_etl) < 50.0:
                            match = m
                            encontrados_nombre += 1
                            found_match = True
                            break
                    if not found_match:
                        match = matches[0]
                        encontrados_nombre += 1
            
            if match:
                cap_db = float(match.get('capital') or 0)
                cuota_db = int(match.get('cuotas_pagadas') or 0)
                
                discrepancias.append({
                    'sifco_etl': sifco_etl,
                    'sifco_base': sifco_base,
                    'nombre_etl': nombre_etl,
                    'inversionista_etl': inversionista_etl,
                    'nombre_db': match['nombre_cliente'],
                    'etl': {
                        'capital_individual': capital_etl,
                        'capital_total_acumulado': capital_total_etl,
                        'cuota': cuota_etl
                    },
                    'db': {
                        'capital_total': cap_db,
                        'cuota': cuota_db
                    },
                    'match_type': 'sifco' if match['numero_credito_sifco'] == sifco_base else 'nombre'
                })
            else:
                no_encontrados += 1

    reporte = {
        'resumen': {
            'total_items_etl': total_procesados,
            'encontrados_sifco': encontrados_sifco,
            'encontrados_nombre': encontrados_nombre,
            'no_encontrados': no_encontrados,
            'total_con_datos': len(discrepancias)
        },
        'detalles': discrepancias
    }

    reporte_path = "/home/jalvarezatcci/Documentos/universe/apps/cartera-back/src/migration/discrepancias_reporte.json"
    with open(reporte_path, 'w', encoding='utf-8') as f:
        json.dump(reporte, f, indent=2, ensure_ascii=False)

    print(f"✅ Comparación finalizada.")
    print(f"📊 Resumen:")
    print(f"   - Total items ETL: {total_procesados}")
    print(f"   - Match por SIFCO: {encontrados_sifco}")
    print(f"   - Match por Nombre: {encontrados_nombre}")
    print(f"   - No encontrados: {no_encontrados}")
    print(f"📄 Reporte generado en: {reporte_path}")

if __name__ == "__main__":
    comparar()
