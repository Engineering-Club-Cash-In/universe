import pandas as pd
import requests
import json
from typing import List, Dict, Any

# Configuración
CARPETA_EXCELS = r"C:\Users\Kelvin Palacios\Documents\analis de datos"
ARCHIVO_EXCEL = "Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx"
HOJA = "Facturacion inversionistas"

# URL de tu API
API_URL = "http://localhost:7000/investor"

def convertir_si_no_a_boolean(valor: Any) -> bool:
    """Convierte 'Si'/'No' a True/False"""
    if pd.isna(valor) or valor == "":
        return False
    valor_str = str(valor).strip().upper()
    return valor_str == "SI"

def normalizar_tipo_cuenta(valor: Any) -> str | None:
    """Normaliza el tipo de cuenta según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    tipo = str(valor).strip().upper()
    
    # Mapeo de variaciones a valores válidos del enum
    mapeo = {
        "AHORRO": "AHORRO",
        "AHORROS": "AHORROS",
        "AHORRO Q": "AHORRO Q",
        "AHORRO $": "AHORRO $",
        "MONETARIA": "MONETARIA",
        "MONETARIA Q": "MONETARIA Q",
        "MONETARIO Q": "MONETARIA Q",  # ← FIX: Monetario → Monetaria
        "MONETARIA $": "MONETARIA $",
        "MONETARIO $": "MONETARIA $",  # ← FIX: Monetario → Monetaria
        "CAPITAL": "Capital",
        "MONETARIA OM": "MONETARIA Q",  # Por si hay otros casos
        "MONETARIA OMS": "MONETARIA Q",
        "MONETARIA OMÁ": "MONETARIA Q",
    }
    
    # Buscar en el mapeo
    tipo_normalizado = mapeo.get(tipo)
    
    if tipo_normalizado:
        return tipo_normalizado
    
    # Si no está en el mapeo, intentar normalizar común
    if "MONETARI" in tipo:
        if "$" in tipo:
            return "MONETARIA $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "MONETARIA Q"
        else:
            return "MONETARIA"
    
    if "AHORR" in tipo:
        if "$" in tipo:
            return "AHORRO $"
        elif "Q" in tipo or "QUETZAL" in tipo:
            return "AHORRO Q"
        elif tipo.endswith("S"):
            return "AHORROS"
        else:
            return "AHORRO"
    
    # Si no se puede normalizar, retornar None y loggear
    print(f"⚠️  Tipo de cuenta desconocido: '{valor}' - se enviará como None")
    return None

def normalizar_banco(valor: Any) -> str | None:
    """Normaliza el nombre del banco según el enum de la BD"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    banco = str(valor).strip().upper()
    
    # Mapeo de variaciones comunes
    mapeo = {
        "BI": "BI",
        "BAM": "BAM",
        "GYT": "GyT",
        "G&T": "GyT",
        "BANTRAB": "BANTRAB",
        "BANRURAL": "BANRURAL",
        "BAC": "BAC",
        "PROMERICA": "PROMERICA",
        "INDUSTRIAL": "INDUSTRIAL",
        "INTERBANCO": "INTERBANCO",
        "NEXA": "NEXA",
        "MENFER S.A.": "BI",  # Ajustar según tu caso
        "NCO/RICHARD": "INTERBANCO",
        "/ MENFER S.": "BI",
    }
    
    # Buscar en el mapeo
    banco_normalizado = mapeo.get(banco)
    
    if banco_normalizado:
        return banco_normalizado
    
    # Si contiene "GYT" o "G&T"
    if "GYT" in banco or "G&T" in banco:
        return "GyT"
    
    # Si no se puede normalizar, retornar None y loggear
    print(f"⚠️  Banco desconocido: '{valor}' - se enviará como None")
    return None

def limpiar_numero_cuenta(valor: Any) -> str | None:
    """Limpia y formatea el número de cuenta"""
    if pd.isna(valor) or valor == "":
        return None
    
    # Convertir a string y limpiar
    cuenta_str = str(valor).strip()
    
    # Remover comillas invertidas, backticks y espacios extras
    cuenta_str = cuenta_str.replace('´', '').replace('`', '').replace('"', '').strip()
    
    # Remover asteriscos y otros caracteres especiales si existen
    cuenta_str = cuenta_str.replace('*', '').strip()
    
    # Si está vacío después de limpiar, retornar None
    if not cuenta_str or cuenta_str.lower() in ['nan', 'null', 'none']:
        return None
    
    return cuenta_str

def normalizar_tipo_reinversion(valor: Any) -> str:
    """Normaliza el tipo de reinversión según el enum"""
    if pd.isna(valor) or valor == "":
        return "sin_reinversion"
    
    valor_str = str(valor).strip().upper()
    
    mapeo = {
        "SI": "capital",
        "NO": "sin_reinversion",
        "CAPITAL": "capital",
        "COMPLETA": "completa",
        "ESPECIAL": "especial",
        "TRADICIONAL": "sin_reinversion",
    }
    
    return mapeo.get(valor_str, "sin_reinversion")

def leer_inversionistas_desde_excel() -> List[Dict[str, Any]]:
    """Lee los inversionistas del Excel y los formatea para la API"""
    
    print(f"📖 Leyendo archivo: {CARPETA_EXCELS}\\{ARCHIVO_EXCEL}")
    print(f"📄 Hoja: {HOJA}")
    
    # Leer el Excel
    df = pd.read_excel(
        f"{CARPETA_EXCELS}\\{ARCHIVO_EXCEL}",
        sheet_name=HOJA,
        header=0
    )
    
    print(f"✅ Archivo leído. Total de filas: {len(df)}")
    print(f"📊 Columnas encontradas: {list(df.columns)}")
    
    inversionistas = []
    errores = []
    
    for idx, row in df.iterrows():
        # Saltar filas vacías
        if pd.isna(row.get('Nombre inversionista')):
            continue
        
        nombre = str(row['Nombre inversionista']).strip()
        
        # Saltar si el nombre está vacío
        if not nombre:
            continue
        
        tipo_cuenta = normalizar_tipo_cuenta(row.get('Tipo cuenta'))
        banco = normalizar_banco(row.get('Banco'))
        
        inversionista = {
            "nombre": nombre,
            "emite_factura": convertir_si_no_a_boolean(row.get('Emite factura')),
            "reinversion": convertir_si_no_a_boolean(row.get('Reinversion')),
            "banco": banco,
            "tipo_cuenta": tipo_cuenta,
            "numero_cuenta": limpiar_numero_cuenta(row.get('Numero de cuenta'))
        }
        
        inversionistas.append(inversionista)
        print(f"✓ {idx+1}. {nombre[:40]:<40} | Factura: {inversionista['emite_factura']} | Cuenta: {tipo_cuenta or 'N/A'}")
    
    print(f"\n📦 Total de inversionistas procesados: {len(inversionistas)}")
    
    if errores:
        print(f"\n⚠️  Se encontraron {len(errores)} advertencias")
    
    return inversionistas

def enviar_a_api(inversionistas: List[Dict[str, Any]]) -> None:
    """Envía los inversionistas a la API"""
    
    print(f"\n🚀 Enviando {len(inversionistas)} inversionistas a la API...")
    print(f"📡 URL: {API_URL}")
    
    try:
        # Hacer la petición POST con todo el array
        response = requests.post(
            API_URL,
            json=inversionistas,
            headers={"Content-Type": "application/json"}
        )
        
        # Verificar respuesta
        if response.status_code in [200, 201]:
            print(f"✅ ¡Éxito! Inversionistas procesados correctamente")
            print(f"📊 Respuesta de la API:")
            result = response.json()
            if isinstance(result, dict):
                print(f"   - Mensaje: {result.get('message', 'N/A')}")
                print(f"   - Total procesados: {result.get('updated', len(inversionistas))}")
            else:
                print(json.dumps(result[:3] if len(result) > 3 else result, indent=2, ensure_ascii=False))
                if len(result) > 3:
                    print(f"   ... y {len(result) - 3} más")
        else:
            print(f"❌ Error en la API (Status {response.status_code})")
            print(f"📄 Respuesta:")
            print(response.text)
            
            # Intentar mostrar el error en formato JSON
            try:
                error_detail = response.json()
                print("\n🔍 Detalle del error:")
                print(json.dumps(error_detail, indent=2, ensure_ascii=False))
            except:
                pass
    
    except requests.exceptions.RequestException as e:
        print(f"❌ Error de conexión: {str(e)}")
        print("\n💡 Verifica que:")
        print("   1. El servidor esté corriendo")
        print("   2. La URL sea correcta")
        print("   3. No haya problemas de red")

def main():
    """Función principal"""
    print("=" * 80)
    print("🏦 IMPORTADOR DE INVERSIONISTAS - CASH-IN")
    print("=" * 80)
    
    try:
        # Leer inversionistas del Excel
        inversionistas = leer_inversionistas_desde_excel()
        
        if not inversionistas:
            print("⚠️  No se encontraron inversionistas para procesar")
            return
        
        # Mostrar resumen antes de enviar
        print("\n" + "=" * 80)
        print("📋 RESUMEN DE DATOS A ENVIAR:")
        print("=" * 80)
        print(f"Total de inversionistas: {len(inversionistas)}")
        print(f"Con factura: {sum(1 for inv in inversionistas if inv['emite_factura'])}")
        print(f"Con reinversión: {sum(1 for inv in inversionistas if inv['reinversion'])}")
        print(f"Con datos bancarios completos: {sum(1 for inv in inversionistas if inv['banco'] and inv['numero_cuenta'])}")
        print(f"Con tipo de cuenta: {sum(1 for inv in inversionistas if inv['tipo_cuenta'])}")
        
        # Confirmar antes de enviar
        respuesta = input("\n¿Deseas enviar estos datos a la API? (si/no): ").strip().lower()
        
        if respuesta in ['si', 's', 'yes', 'y']:
            enviar_a_api(inversionistas)
        else:
            print("❌ Operación cancelada por el usuario")
    
    except FileNotFoundError:
        print(f"❌ Error: No se encontró el archivo Excel")
        print(f"📂 Ruta buscada: {CARPETA_EXCELS}\\{ARCHIVO_EXCEL}")
    except Exception as e:
        print(f"❌ Error inesperado: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()