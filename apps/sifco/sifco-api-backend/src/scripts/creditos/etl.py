import pandas as pd
import json
import warnings
from pathlib import Path

# Suprimir warnings de fechas inválidas en Excel
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

# Rutas de los archivos
BASE_DIR = Path(__file__).parent
VEHICULOS_FILE = BASE_DIR / "TIPOS DE VEHÍCULOS.xlsx"
COBROS_FILE = BASE_DIR / "Copia de Cobros TI.xlsx"
OUTPUT_FILE = BASE_DIR / "vehiculos_creditos.json"


def normalize_value(value):
    """Normaliza un valor para comparación (quita guiones, espacios y convierte a mayúsculas)"""
    if pd.isna(value):
        return None
    # Quitar espacios, guiones y convertir a mayúsculas
    # P - 040LFH -> P040LFH
    # P-040LFH -> P040LFH
    normalized = str(value).replace('-', '').replace(' ', '').strip().upper()
    return normalized if normalized else None


def combine_telefonos(row):
    """Combina los teléfonos en un array"""
    telefonos = []
    telefono_cols = ['TELEFONO', 'Telefono 2', 'Telefono 3', 'Telefono 4']

    for col in telefono_cols:
        if col in row.index and pd.notna(row[col]):
            tel = str(row[col]).strip()
            if tel and tel not in telefonos:
                telefonos.append(tel)

    return telefonos


def get_value(row, col_name):
    """Obtiene un valor de la fila de forma segura"""
    if col_name in row.index and pd.notna(row[col_name]):
        return row[col_name]
    return None


def format_value(valor):
    """Formatea un valor para JSON"""
    if valor is None or pd.isna(valor):
        return None
    if isinstance(valor, (int, float)):
        return valor
    return str(valor)


def build_cobro_data(cobro):
    """Extrae los datos de cobro según las columnas especificadas"""
    return {
        'numero_prestamo': format_value(get_value(cobro, 'Numero de prestamo')),
        'fecha_de_pago': format_value(get_value(cobro, 'FECHA DE PAGO')),
        'nombre_del_cliente': format_value(get_value(cobro, 'Nombre del cliente')),
        'telefonos': combine_telefonos(cobro),
        'correo': format_value(get_value(cobro, 'Correo')),
        'etapa_general': format_value(get_value(cobro, 'Etapa General')),
        'cuotas_atrasadas': format_value(get_value(cobro, 'CUOTAS ATRASADAS')),
        'cuotas_pagadas': format_value(get_value(cobro, 'CUOTAS PAGADAS')),
        'cuota_mensual': format_value(get_value(cobro, 'CUOTA MENSUAL')),
        'tipo_de_prestamo': format_value(get_value(cobro, 'TIPO DE PRESTAMO')),
        'asesor': format_value(get_value(cobro, 'ASESOR')),
        'numero_poliza': format_value(get_value(cobro, 'NUMERO DE POLIZA')),
        'capital_cuota': format_value(get_value(cobro, 'Capital cuota')),
        'interes': format_value(get_value(cobro, 'Interes')),
        'extra_financiamiento': format_value(get_value(cobro, 'Extrafinanciamiento (capital concedido segun SIFCO menos Capital a la fecha segun DRIVE)')),
        'seguro_la_ceiba': format_value(get_value(cobro, 'SEGURO LA CEIBA')),
        'membresia_actual': format_value(get_value(cobro, 'MEMBRESIA ACTUAL')),
        'seguro_inrexsa': format_value(get_value(cobro, 'Seguro INREXSA')),
        'poliza_inrexsa': format_value(get_value(cobro, 'POLIZA INREXSA')),
    }


def build_vehiculo_data(vehiculo):
    """Extrae los datos del vehículo"""
    return {
        'placa': format_value(get_value(vehiculo, 'PLACA')),
        'no_poliza_vehiculo': format_value(get_value(vehiculo, 'No. Póliza')),
        'marca': format_value(get_value(vehiculo, 'MARCA')),
        'linea_estilo': format_value(get_value(vehiculo, 'LINEA O ESTILO')),
        'tipo': format_value(get_value(vehiculo, 'TIPO')),
        'modelo': format_value(get_value(vehiculo, 'MODELO')),
        'motor': format_value(get_value(vehiculo, 'MOTOR')),
        'chasis': format_value(get_value(vehiculo, 'CHASIS')),
        'no_pasajeros': format_value(get_value(vehiculo, 'NO DE PASAJEROS')),
        'uso': format_value(get_value(vehiculo, 'USO')),
        'fecha_alta': format_value(get_value(vehiculo, 'Fecha de Alta')),
        'vigencia_inicial': format_value(get_value(vehiculo, 'Vigencia Inicial')),
        'vigencia_final': format_value(get_value(vehiculo, 'Vigencia Final')),
        'suma_asegurada': format_value(get_value(vehiculo, 'Suma asegurada')),
    }


def empty_cobro_data():
    """Retorna estructura vacía de cobro"""
    return {
        'numero_prestamo': None,
        'fecha_de_pago': None,
        'nombre_del_cliente': None,
        'telefonos': [],
        'correo': None,
        'etapa_general': None,
        'cuotas_atrasadas': None,
        'cuotas_pagadas': None,
        'cuota_mensual': None,
        'tipo_de_prestamo': None,
        'asesor': None,
        'numero_poliza': None,
        'capital_cuota': None,
        'interes': None,
        'extra_financiamiento': None,
        'seguro_la_ceiba': None,
        'membresia_actual': None,
        'seguro_inrexsa': None,
        'poliza_inrexsa': None,
    }


def main():
    print("Leyendo archivo de vehículos...")
    df_vehiculos = pd.read_excel(VEHICULOS_FILE)
    print(f"  - {len(df_vehiculos)} registros de vehículos encontrados")

    print("\nLeyendo archivo de cobros (hoja COBRO)...")
    df_cobros = pd.read_excel(COBROS_FILE, sheet_name="COBRO")
    print(f"  - {len(df_cobros)} registros de cobros encontrados")

    # Normalizar placas y pólizas
    df_vehiculos['PLACA_NORM'] = df_vehiculos['PLACA'].apply(normalize_value)
    df_vehiculos['POLIZA_NORM'] = df_vehiculos['No. Póliza'].apply(normalize_value)
    df_cobros['PLACA_NORM'] = df_cobros['PLACA'].apply(normalize_value)
    df_cobros['POLIZA_NORM'] = df_cobros['POLIZA INREXSA'].apply(normalize_value)

    # Crear índice de cobros por placa
    cobros_por_placa = {
        row['PLACA_NORM']: row
        for _, row in df_cobros.iterrows()
        if row['PLACA_NORM']
    }
    print(f"  - {len(cobros_por_placa)} placas únicas en archivo de cobros")

    # Crear índice de cobros por póliza (para búsqueda secundaria)
    cobros_por_poliza = {
        row['POLIZA_NORM']: row
        for _, row in df_cobros.iterrows()
        if row['POLIZA_NORM']
    }
    print(f"  - {len(cobros_por_poliza)} pólizas únicas en archivo de cobros")

    # Procesar vehículos
    resultados = []
    encontrados_placa = 0
    encontrados_poliza = 0
    no_encontrados = 0

    print("\nProcesando vehículos...")

    for _, vehiculo in df_vehiculos.iterrows():
        placa = vehiculo.get('PLACA_NORM')
        poliza = vehiculo.get('POLIZA_NORM')
        registro = build_vehiculo_data(vehiculo)

        cobro = None
        metodo_busqueda = None

        # Primero buscar por placa
        if placa and placa in cobros_por_placa:
            cobro = cobros_por_placa[placa]
            metodo_busqueda = 'placa'
            encontrados_placa += 1
        # Si no se encuentra por placa, buscar por póliza
        elif poliza and poliza in cobros_por_poliza:
            cobro = cobros_por_poliza[poliza]
            metodo_busqueda = 'poliza'
            encontrados_poliza += 1

        if cobro is not None:
            registro.update(build_cobro_data(cobro))
            registro['encontrado_en_cobros'] = True
            registro['metodo_busqueda'] = metodo_busqueda
        else:
            registro.update(empty_cobro_data())
            registro['encontrado_en_cobros'] = False
            registro['metodo_busqueda'] = None
            no_encontrados += 1

        resultados.append(registro)

    print(f"\n  - Vehículos encontrados por PLACA: {encontrados_placa}")
    print(f"  - Vehículos encontrados por PÓLIZA: {encontrados_poliza}")
    print(f"  - Total encontrados: {encontrados_placa + encontrados_poliza}")
    print(f"  - Vehículos NO encontrados: {no_encontrados}")

    # Guardar JSON
    print(f"\nGuardando resultado en {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2, default=str)

    print(f"  - {len(resultados)} registros guardados")
    print("\n¡Proceso completado!")

    return resultados


if __name__ == "__main__":
    main()
