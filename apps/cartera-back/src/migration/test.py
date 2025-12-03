import os
import pandas as pd
from typing import Any

# Configuración
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"
HOJA_PRUEBA = "Noviembre 2025"

def limpiar_valor(valor: Any) -> str:
    if pd.isna(valor):
        return "0"
    valor_str = str(valor).strip()
    if valor_str.upper().startswith('Q'):
        valor_str = valor_str[1:].strip()
    valor_str = valor_str.replace(',', '')
    return valor_str

def probar_lectura():
    archivo_path = os.path.join(CARPETA_EXCELS, ARCHIVO_EXCEL)
    
    print(f"📂 Leyendo: {archivo_path}")
    print(f"📄 Hoja: {HOJA_PRUEBA}\n")
    
    if not os.path.exists(archivo_path):
        print(f"❌ Archivo no encontrado: {archivo_path}")
        return
    
    # Leer Excel
    df_raw = pd.read_excel(archivo_path, sheet_name=HOJA_PRUEBA, header=None)
    
    # Buscar headers
    header_row = None
    for idx, row in df_raw.iterrows():
        if idx > 20:
            break
        row_str = ' '.join(str(cell).lower() for cell in row if pd.notna(cell))
        if 'credito' in row_str or 'inversionista' in row_str:
            header_row = idx
            print(f"✅ Headers en fila {idx}\n")
            break
    
    if header_row is None:
        print("❌ No encontré headers")
        return
    
    # Leer con headers
    df = pd.read_excel(archivo_path, sheet_name=HOJA_PRUEBA, header=header_row)
    
    print(f"📊 Total de filas: {len(df)}")
    print(f"📊 Total de columnas: {len(df.columns)}\n")
    
    # 🎯 MAPEO CORRECTO según tu Excel real
    columnas_mapeo = {
        'credito_sifco': '# crédito SIFCO',
        'inversionista': 'Inversionista',
        'capital': 'Capital',
        'porcentaje_interes': '%',
        'porcentaje_cashin': '% Cash-In',
        'porcentaje_inversionista': '% Inversionista',
        'cuota': 'Cuota',
        'cuota_inversionista': 'Cuota Inverionista',  # Ojo al typo en tu Excel
    }
    
    print("🔍 VERIFICANDO COLUMNAS:")
    columnas = {}
    faltantes = []
    
    for key, nombre_excel in columnas_mapeo.items():
        if nombre_excel in df.columns:
            columnas[key] = nombre_excel
            print(f"   ✅ {key} → '{nombre_excel}'")
        else:
            faltantes.append(nombre_excel)
            print(f"   ❌ {key} → '{nombre_excel}' NO ENCONTRADA")
    
    if faltantes:
        print(f"\n⚠️ Columnas faltantes: {faltantes}")
        print(f"\n💡 Columnas disponibles que contienen palabras clave:")
        for col in df.columns:
            col_lower = str(col).lower()
            if any(x in col_lower for x in ['credito', 'inversion', 'cash', 'cuota', '%']):
                print(f"   - '{col}'")
        return
    
    print(f"\n✅ ¡Todas las columnas encontradas!\n")
    
    # Buscar primera fila con datos válidos
    print("📝 EJEMPLO DE PRIMERA FILA CON DATOS:")
    
    primera_fila = None
    for idx, row in df.iterrows():
        if pd.notna(row[columnas['credito_sifco']]) and pd.notna(row[columnas['inversionista']]):
            if str(row[columnas['credito_sifco']]).lower() not in ['total', 'suma', 'promedio']:
                primera_fila = row
                print(f"\n   (Fila {idx} del DataFrame)")
                break
    
    if primera_fila is not None:
        print(f"\n   📋 Crédito SIFCO: {primera_fila[columnas['credito_sifco']]}")
        print(f"   👤 Inversionista: {primera_fila[columnas['inversionista']]}")
        print(f"\n   💰 Capital:")
        print(f"      Raw: {primera_fila[columnas['capital']]}")
        print(f"      Limpio: {limpiar_valor(primera_fila[columnas['capital']])}")
        print(f"\n   📊 Porcentajes:")
        print(f"      % Interés (raw): {primera_fila[columnas['porcentaje_interes']]}")
        print(f"      % Interés (limpio): {limpiar_valor(primera_fila[columnas['porcentaje_interes']])}")
        print(f"      % Cash-In (raw): {primera_fila[columnas['porcentaje_cashin']]}")
        print(f"      % Cash-In (limpio): {limpiar_valor(primera_fila[columnas['porcentaje_cashin']])}")
        print(f"      % Inversionista (raw): {primera_fila[columnas['porcentaje_inversionista']]}")
        print(f"      % Inversionista (limpio): {limpiar_valor(primera_fila[columnas['porcentaje_inversionista']])}")
        print(f"\n   💵 Cuotas:")
        print(f"      Cuota (raw): {primera_fila[columnas['cuota']]}")
        print(f"      Cuota (limpia): {limpiar_valor(primera_fila[columnas['cuota']])}")
        print(f"      Cuota Inversionista (raw): {primera_fila[columnas['cuota_inversionista']]}")
        print(f"      Cuota Inversionista (limpia): {limpiar_valor(primera_fila[columnas['cuota_inversionista']])}")
        
        # 🎯 SIMULAR EL PAYLOAD QUE SE ENVIARÁ A LA API
        print(f"\n\n🚀 PAYLOAD QUE SE ENVIARÍA A LA API:")
        payload_ejemplo = {
            "inversionista": str(primera_fila[columnas['inversionista']]).strip(),
            "capital": limpiar_valor(primera_fila[columnas['capital']]),
            "porcentajeCashIn": limpiar_valor(primera_fila[columnas['porcentaje_cashin']]),
            "porcentajeInversionista": limpiar_valor(primera_fila[columnas['porcentaje_inversionista']]),
            "porcentaje": limpiar_valor(primera_fila[columnas['porcentaje_interes']]),
            "cuota": limpiar_valor(primera_fila[columnas['cuota']]),
            "cuotaInversionista": limpiar_valor(primera_fila[columnas['cuota_inversionista']]),
        }
        
        import json
        print(json.dumps(payload_ejemplo, indent=2, ensure_ascii=False))
        
    else:
        print("   ⚠️ No se encontró ninguna fila con datos válidos")

if __name__ == "__main__":
    try:
        probar_lectura()
        print("\n✅ Script ejecutado exitosamente!")
    except Exception as e:
        print(f"\n❌ Error general: {e}")
        import traceback
        traceback.print_exc()