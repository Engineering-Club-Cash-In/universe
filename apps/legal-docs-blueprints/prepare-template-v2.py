#!/usr/bin/env python3
"""
Script mejorado para convertir el template DOCX en template con variables.
Extrae el texto plano, hace reemplazos contextuales y usa docxtemplater.
"""

import zipfile
import re
import os
import shutil
from pathlib import Path
import xml.etree.ElementTree as ET

def get_text_from_xml(xml_content):
    """Extrae todo el texto del XML preservando orden."""
    # Eliminar namespace para facilitar búsqueda
    xml_no_ns = re.sub(r'<w:([a-zA-Z]+)', r'<\1', xml_content)
    xml_no_ns = re.sub(r'</w:([a-zA-Z]+)>', r'</\1>', xml_no_ns)

    # Extraer todos los elementos <t>
    texts = re.findall(r'<t[^>]*>([^<]*)</t>', xml_no_ns)
    return ''.join(texts)

def replace_in_xml(xml_content, old_text, new_text):
    """Reemplaza texto en XML manteniendo estructura."""
    # Escapar caracteres especiales XML
    old_escaped = old_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    new_escaped = new_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    # Buscar y reemplazar en los tags <w:t>
    pattern = r'(<w:t[^>]*>)([^<]*' + re.escape(old_text) + r'[^<]*)(</w:t>)'

    def replacer(match):
        return match.group(1) + match.group(2).replace(old_text, new_text) + match.group(3)

    return re.sub(pattern, replacer, xml_content)

def smart_replace(xml_content):
    """Hace reemplazos inteligentes basados en contexto."""

    replacements_made = []

    # Mapeo orden de aparición de underscores a variables
    patterns = [
        # 1. Fecha del contrato (3 campos)
        {
            'search': lambda xml: re.search(r'el (_{5,15}) de (_{5,15}) del año dos mil (_{5,15})', get_text_from_xml(xml)),
            'replace': [
                ('UNDERSCORE1', '{contract_day}'),
                ('UNDERSCORE2', '{contract_month}'),
                ('UNDERSCORE3', '{contract_year}')
            ],
            'desc': 'Fecha del contrato'
        },
        # 2. Nombre del cliente (después de "y, ")
        {
            'pattern': r'(; y,\s+)_{10,20}(,)',
            'replace': r'\1{client_name}\2',
            'desc': 'Nombre del cliente'
        },
        # 3. Edad
        {
            'pattern': r'de _{8,15}años de edad',
            'replace': 'de {client_age} años de edad',
            'desc': 'Edad del cliente'
        },
        # 4. DPI/CUI
        {
            'pattern': r'Código Único de Identificación\s+_{20,50}',
            'replace': 'Código Único de Identificación {client_cui}',
            'desc': 'DPI/CUI del cliente'
        },
    ]

    # Aplicar reemplazos simples primero
    text = get_text_from_xml(xml_content)

    # Reemplazo manual por orden de aparición
    simple_replacements = [
        # Vehículo (en orden de aparición en el texto)
        ('Tipo: _____', 'Tipo: {vehicle_type}'),
        ('Marca: _____', 'Marca: {vehicle_brand}'),
        ('Color: ______', 'Color: {vehicle_color}'),
        ('Uso: ________', 'Uso: {vehicle_use}'),
        ('Chasis: _______________', 'Chasis: {vehicle_chassis}'),
        ('Combustible: ________', 'Combustible: {vehicle_fuel}'),
        ('Motor: ___________', 'Motor: {vehicle_motor}'),
        ('Serie:  ____________', 'Serie: {vehicle_series}'),
        ('Línea o estilo: __________', 'Línea o estilo: {vehicle_line}'),
        ('Modelo: ___________', 'Modelo: {vehicle_model}'),
        ('Centímetros cúbicos: _______________', 'Centímetros cúbicos: {vehicle_cc}'),
        ('Asientos: _____', 'Asientos: {vehicle_seats}'),
        ('Cilindros: _________', 'Cilindros: {vehicle_cylinders}'),
        ('Código ISCV: ________', 'Código ISCV: {vehicle_iscv}'),
    ]

    modified_xml = xml_content

    for old, new in simple_replacements:
        if old in text:
            # Reemplazar en XML
            modified_xml = modified_xml.replace(old, new)
            replacements_made.append(f"✓ {old[:30]}... → {new[:30]}...")

    return modified_xml, replacements_made

def manual_xml_replace(xml_content):
    """Hace reemplazos directos en el XML buscando patrones de underscores."""

    replacements = []
    modified = xml_content

    # Lista de reemplazos en orden de aparición
    replace_pairs = [
        # Fecha
        ('el __________ de __________ del año dos mil __________',
         'el {contract_day} de {contract_month} del año dos mil {contract_year}'),

        # Cliente después de "y, "
        ('y, ________________,',
         'y, {client_name},'),

        # Edad
        ('de ___________años de edad',
         'de {client_age} años de edad'),

        # DPI
        ('Código Único de Identificación ________________________________',
         'Código Único de Identificación {client_cui}'),

        # Vehículo
        ('Tipo: _____', 'Tipo: {vehicle_type}'),
        ('Marca: _____', 'Marca: {vehicle_brand}'),
        ('Color: ______', 'Color: {vehicle_color}'),
        ('Uso: ________', 'Uso: {vehicle_use}'),
        ('Chasis: _______________', 'Chasis: {vehicle_chassis}'),
        ('Combustible: ________', 'Combustible: {vehicle_fuel}'),
        ('Motor: ___________', 'Motor: {vehicle_motor}'),
        ('Serie:  ____________', 'Serie: {vehicle_series}'),
        ('Línea o estilo: __________', 'Línea o estilo: {vehicle_line}'),
        ('Modelo: ___________', 'Modelo: {vehicle_model}'),
        ('Centímetros cúbicos: _______________', 'Centímetros cúbicos: {vehicle_cc}'),
        ('Asientos: _____', 'Asientos: {vehicle_seats}'),
        ('Cilindros: _________', 'Cilindros: {vehicle_cylinders}'),
        ('Código ISCV: ________', 'Código ISCV: {vehicle_iscv}'),

        # Usuario y plazo
        ('dará en USO al señor _________________',
         'dará en USO al señor {user_name}'),
        ('uso que durará _____________ meses',
         'uso que durará {contract_duration_months} meses'),
        ('contados a partir del _______________________________________________',
         'contados a partir del {contract_start_date}'),
        ('el día ______ de _______ del año dos mil _______',
         'el día {contract_end_day} de {contract_end_month} del año dos mil {contract_end_year}'),
    ]

    for old, new in replace_pairs:
        if old in modified:
            modified = modified.replace(old, new)
            replacements.append(f"✓ {old[:40]}... → {new[:40]}...")
        else:
            # Intentar con espacios flexibles
            old_flex = re.sub(r'\s+', r'\\s+', re.escape(old))
            if re.search(old_flex, modified):
                modified = re.sub(old_flex, new, modified)
                replacements.append(f"✓ (flex) {old[:40]}... → {new[:40]}...")

    # Reemplazos adicionales para nombres en cláusulas
    # Buscar patrones más específicos
    clause_replacements = [
        # Primera aparición en "El bien mueble... por el señor"
        (r'utilizado única y exclusivamente por el señor\s+_{10,20},',
         'utilizado única y exclusivamente por el señor {user_name_clause_a},'),

        # "De igual forma, el señor"
        (r'De igual forma, el señor\s+_{10,20}\s+quedará',
         'De igual forma, el señor {user_name_clause_a2} quedará'),

        # "El señor ___ se compromete"
        (r'b\).*?El señor\s+_{10,20},',
         lambda m: m.group(0).replace('_________________', '{user_name_clause_b}')),

        # "d) RENUNCIA: El señor"
        (r'd\) RENUNCIA:.*?El señor\s+_{15,25},',
         lambda m: m.group(0).replace('___________________', '{user_name_clause_d}')),

        # "RICHARD KACHLER ORTEGA Y ___"
        (r'RICHARD KACHLER ORTEGA Y\s+_{15,25},',
         'RICHARD KACHLER ORTEGA Y {user_name_final},'),

        # Dirección
        (r'para recibir citaciones, notificaciones o emplazamientos en\s+_{40,70};',
         'para recibir citaciones, notificaciones o emplazamientos en {client_address};'),
    ]

    for pattern, replacement in clause_replacements:
        if callable(replacement):
            matches = list(re.finditer(pattern, modified, re.DOTALL))
            for match in matches:
                modified = modified.replace(match.group(0), replacement(match))
                replacements.append(f"✓ (callable) Cláusula específica")
        else:
            matches = re.findall(pattern, modified, re.DOTALL)
            if matches:
                modified = re.sub(pattern, replacement, modified, flags=re.DOTALL)
                replacements.append(f"✓ {pattern[:40]}... → {replacement[:40]}...")

    return modified, replacements

def main():
    """Función principal."""
    input_docx = Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx')
    output_docx = Path('templates/contrato_uso_carro_usado.docx')

    if not input_docx.exists():
        print(f"❌ Error: No se encontró {input_docx}")
        print("   Restaurando desde backup...")
        backup = Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx')
        if backup.exists():
            input_docx = backup
        else:
            return

    print(f"📄 Procesando: {input_docx}\n")

    # Extraer XML
    with zipfile.ZipFile(input_docx, 'r') as zip_ref:
        xml_content = zip_ref.read('word/document.xml').decode('utf-8')

    print("🔄 Aplicando reemplazos manuales en XML...\n")
    modified_xml, replacements = manual_xml_replace(xml_content)

    print(f"\n📊 Total de reemplazos: {len(replacements)}")
    for r in replacements:
        print(f"   {r}")

    # Guardar
    print(f"\n💾 Guardando template: {output_docx}")
    shutil.copy(input_docx, output_docx)

    with zipfile.ZipFile(output_docx, 'w') as zip_ref:
        # Copiar todos los archivos del original
        with zipfile.ZipFile(input_docx, 'r') as original:
            for item in original.infolist():
                if item.filename != 'word/document.xml':
                    zip_ref.writestr(item, original.read(item.filename))

        # Escribir el document.xml modificado
        zip_ref.writestr('word/document.xml', modified_xml.encode('utf-8'))

    print("\n✅ ¡Template editado exitosamente!")
    print(f"\n🎯 Ahora ejecuta: bun run dev")
    print(f"   Y luego: bun run test")

if __name__ == '__main__':
    main()
