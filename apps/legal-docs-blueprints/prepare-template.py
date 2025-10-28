#!/usr/bin/env python3
"""
Script para convertir el template DOCX original en un template con variables.
Reemplaza todos los "____" con {variables} manteniendo el formato.
"""

import zipfile
import re
import os
import shutil
from pathlib import Path

# Mapeo de patrones a variables
REPLACEMENTS = [
    # Fecha del contrato
    (r'el _{5,15} de _{5,15} del año dos mil _{5,15}',
     'el {contract_day} de {contract_month} del año dos mil {contract_year}'),

    # Cliente - nombre (primera aparición después de RDBE)
    (r'(SOCIEDAD ANÓNIMA.*?; y, )_{10,20},',
     r'\1{client_name},'),

    # Cliente - edad
    (r'de _{8,15}años de edad',
     'de {client_age} años de edad'),

    # Cliente - DPI/CUI
    (r'Código Único de Identificación\s+_{20,40}',
     'Código Único de Identificación {client_cui}'),

    # Vehículo - todos los campos
    (r'Tipo:\s*_{3,10};', 'Tipo: {vehicle_type};'),
    (r'Marca:\s*_{3,10};', 'Marca: {vehicle_brand};'),
    (r'Color:\s*_{3,10};', 'Color: {vehicle_color};'),
    (r'Uso:\s*_{3,15};', 'Uso: {vehicle_use};'),
    (r'Chasis:\s*_{10,20};', 'Chasis: {vehicle_chassis};'),
    (r'Combustible:\s*_{5,15};', 'Combustible: {vehicle_fuel};'),
    (r'Motor:\s*_{8,15};', 'Motor: {vehicle_motor};'),
    (r'Serie:\s*_{8,15};', 'Serie: {vehicle_series};'),
    (r'Línea o estilo:\s*_{5,15};', 'Línea o estilo: {vehicle_line};'),
    (r'Modelo:\s*_{8,15};', 'Modelo: {vehicle_model};'),
    (r'Centímetros cúbicos:\s*_{10,20};', 'Centímetros cúbicos: {vehicle_cc};'),
    (r'Asientos:\s*_{3,10};', 'Asientos: {vehicle_seats};'),
    (r'Cilindros:\s*_{5,15};', 'Cilindros: {vehicle_cylinders};'),
    (r'Código ISCV:\s*_{5,15}\.', 'Código ISCV: {vehicle_iscv}.'),

    # Plazo - nombre usuario (en cláusula SEGUNDA)
    (r'dará en USO al señor\s+_{10,20}',
     'dará en USO al señor {user_name}'),

    # Plazo - duración
    (r'uso que durará\s+_{8,20}\s+meses',
     'uso que durará {contract_duration_months} meses'),

    # Plazo - fecha inicio
    (r'contados a partir del\s+_{30,60}',
     'contados a partir del {contract_start_date}'),

    # Plazo - fecha fin
    (r'el día\s*_{4,10}\s+de\s+_{5,15}\s+del año dos mil\s+_{5,15}',
     'el día {contract_end_day} de {contract_end_month} del año dos mil {contract_end_year}'),

    # Dirección para notificaciones
    (r'para recibir citaciones, notificaciones o emplazamientos en\s+_{40,70};',
     'para recibir citaciones, notificaciones o emplazamientos en {client_address};'),
]

# Reemplazos adicionales para nombres repetidos en cláusulas específicas
CLAUSE_REPLACEMENTS = [
    # En cláusula a) - primera aparición
    (r'(a\) DEL USO:.*?El bien mueble descrito será utilizado única y exclusivamente por el señor\s+)_{10,20}(,)',
     r'\1{user_name_clause_a}\2'),

    # En cláusula a) - segunda aparición
    (r'(De igual forma, el señor\s+)_{10,20}(\s+quedará)',
     r'\1{user_name_clause_a2}\2'),

    # En cláusula b)
    (r'(b\) DE LAS OBLIGACIONES.*?El señor\s+)_{10,20}(,)',
     r'\1{user_name_clause_b}\2'),

    # En cláusula d)
    (r'(d\) RENUNCIA:.*?El señor\s+)_{10,20}(,)',
     r'\1{user_name_clause_d}\2'),

    # En cláusula CUARTA
    (r'(RICHARD KACHLER ORTEGA Y\s+)_{15,25}(,)',
     r'\1{user_name_final}\2'),
]

def extract_docx_xml(docx_path):
    """Extrae el XML del documento DOCX."""
    with zipfile.ZipFile(docx_path, 'r') as zip_ref:
        return zip_ref.read('word/document.xml').decode('utf-8')

def save_docx_xml(docx_path, xml_content, output_path):
    """Guarda el XML modificado de vuelta al DOCX."""
    # Copiar el DOCX original
    shutil.copy(docx_path, output_path)

    # Reemplazar el document.xml
    with zipfile.ZipFile(output_path, 'a') as zip_ref:
        zip_ref.writestr('word/document.xml', xml_content.encode('utf-8'))

def replace_underscores(xml_content):
    """Reemplaza patrones de underscores con variables."""
    modified_xml = xml_content

    print("Aplicando reemplazos generales...")
    for pattern, replacement in REPLACEMENTS:
        matches = re.findall(pattern, modified_xml, re.DOTALL)
        if matches:
            print(f"  ✓ Encontrado: {pattern[:50]}... → {replacement[:50]}...")
            modified_xml = re.sub(pattern, replacement, modified_xml, flags=re.DOTALL)

    print("\nAplicando reemplazos de cláusulas específicas...")
    for pattern, replacement in CLAUSE_REPLACEMENTS:
        matches = re.findall(pattern, modified_xml, re.DOTALL)
        if matches:
            print(f"  ✓ Encontrado patrón de cláusula → {replacement[:50]}...")
            modified_xml = re.sub(pattern, replacement, modified_xml, flags=re.DOTALL)

    # Reemplazos adicionales para casos no capturados
    # Firmas al final
    modified_xml = re.sub(
        r'f\)_{20,40}\s+f\)_{20,40}',
        'f)_____________________________    f)_____________________________',
        modified_xml
    )

    return modified_xml

def main():
    """Función principal."""
    # Rutas
    input_docx = Path('templates/contrato_uso_carro_usado.docx')
    output_docx = Path('templates/contrato_uso_carro_usado_EDITADO.docx')
    backup_docx = Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx')

    if not input_docx.exists():
        print(f"❌ Error: No se encontró {input_docx}")
        return

    print(f"📄 Procesando: {input_docx}")
    print()

    # Backup del original
    if not backup_docx.exists():
        shutil.copy(input_docx, backup_docx)
        print(f"💾 Backup creado: {backup_docx}")

    # Extraer XML
    print("\n📖 Extrayendo XML del documento...")
    xml_content = extract_docx_xml(input_docx)

    # Aplicar reemplazos
    print("\n🔄 Aplicando reemplazos...")
    modified_xml = replace_underscores(xml_content)

    # Guardar
    print(f"\n💾 Guardando template editado: {output_docx}")
    save_docx_xml(input_docx, modified_xml, output_docx)

    # Reemplazar original
    print(f"\n🔄 Reemplazando template original...")
    shutil.copy(output_docx, input_docx)

    print("\n✅ ¡Template editado exitosamente!")
    print(f"   Original: {input_docx}")
    print(f"   Backup: {backup_docx}")
    print(f"   Versión editada: {output_docx}")
    print("\n🎯 Ahora puedes probar la generación con: bun run test")

if __name__ == '__main__':
    main()
