#!/usr/bin/env python3
"""
Script final para convertir el template DOCX con todas las variables.
Hace reemplazos directos en el XML.
"""

import zipfile
import shutil
from pathlib import Path

def replace_all_fields(xml_content):
    """Hace todos los reemplazos necesarios en el XML."""

    replacements = []

    # Lista completa de reemplazos en orden
    replace_list = [
        # 1. Fecha del contrato
        ('el __________ de __________ del año dos mil __________',
         'el {contract_day} de {contract_month} del año dos mil {contract_year}'),

        # 2. Nombre del cliente (después de "y, ")
        ('y, ________________,',
         'y, {client_name},'),

        # 3. Edad
        ('de ___________años de edad',
         'de {client_age} años de edad'),

        # 4. DPI/CUI
        ('Código Único de Identificación ________________________________',
         'Código Único de Identificación {client_cui}'),

        # 5-18. Vehículo (14 campos)
        ('Tipo: _____; ', 'Tipo: {vehicle_type}; '),
        ('Marca: _____; ', 'Marca: {vehicle_brand}; '),
        ('Color: ______; ', 'Color: {vehicle_color}; '),
        ('Uso: ________; ', 'Uso: {vehicle_use}; '),
        ('Chasis: _______________; ', 'Chasis: {vehicle_chassis}; '),
        ('Combustible: ________; ', 'Combustible: {vehicle_fuel}; '),
        ('Motor: ___________; ', 'Motor: {vehicle_motor}; '),
        ('Serie:  ____________; ', 'Serie: {vehicle_series}; '),
        ('Línea o estilo: __________; ', 'Línea o estilo: {vehicle_line}; '),
        ('Modelo: ___________; ', 'Modelo: {vehicle_model}; '),
        ('Centímetros cúbicos: _______________; ', 'Centímetros cúbicos: {vehicle_cc}; '),
        ('Asientos: _____; ', 'Asientos: {vehicle_seats}; '),
        ('Cilindros: _________; ', 'Cilindros: {vehicle_cylinders}; '),
        ('Código ISCV: ________. ', 'Código ISCV: {vehicle_iscv}. '),

        # 19. Usuario (primer nombre en SEGUNDA)
        ('dará en USO al señor _________________',
         'dará en USO al señor {user_name}'),

        # 20. Duración
        ('uso que durará _____________ meses',
         'uso que durará {contract_duration_months} meses'),

        # 21. Fecha inicio
        ('contados a partir del _______________________________________________',
         'contados a partir del {contract_start_date}'),

        # 22. Fecha fin
        ('el día ______ de _______ del año dos mil _______',
         'el día {contract_end_day} de {contract_end_month} del año dos mil {contract_end_year}'),

        # 23. Nombre en cláusula a) - primera aparición
        ('exclusivamente por el señor _________________,',
         'exclusivamente por el señor {user_name_clause_a},'),

        # 24. Nombre en cláusula a) - segunda aparición
        ('el señor _______________quedará',
         'el señor {user_name_clause_a2} quedará'),

        # 25. Nombre en cláusula b)
        ('b) DE LAS OBLIGACIONES Y TERMINACIÓN ANTICIPADA: El señor _________________,',
         'b) DE LAS OBLIGACIONES Y TERMINACIÓN ANTICIPADA: El señor {user_name_clause_b},'),

        # 26. Nombre en cláusula d)
        ('d) RENUNCIA: El señor ___________________,',
         'd) RENUNCIA: El señor {user_name_clause_d},'),

        # 27. Dirección
        ('para recibir citaciones, notificaciones o emplazamientos en ___________________________________________________________',
         'para recibir citaciones, notificaciones o emplazamientos en {client_address}'),

        # 28. Nombre final en CUARTA
        ('RICHARD KACHLER ORTEGA Y ______________________,',
         'RICHARD KACHLER ORTEGA Y {user_name_final},'),
    ]

    modified = xml_content

    for old, new in replace_list:
        if old in modified:
            modified = modified.replace(old, new)
            replacements.append(f"✓ Reemplazado: {old[:50]}...")
        else:
            replacements.append(f"✗ NO encontrado: {old[:50]}...")

    return modified, replacements

def main():
    """Función principal."""
    input_docx = Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx')
    output_docx = Path('templates/contrato_uso_carro_usado.docx')

    if not input_docx.exists():
        print(f"❌ Error: No se encontró {input_docx}")
        return

    print(f"📄 Procesando: {input_docx}\n")

    # Extraer XML
    with zipfile.ZipFile(input_docx, 'r') as zip_ref:
        xml_content = zip_ref.read('word/document.xml').decode('utf-8')

    print("🔄 Aplicando reemplazos...\n")
    modified_xml, replacements = replace_all_fields(xml_content)

    # Mostrar resultados
    success_count = sum(1 for r in replacements if r.startswith('✓'))
    print(f"\n📊 Resultados: {success_count}/{len(replacements)} reemplazos exitosos\n")

    for r in replacements:
        print(f"   {r}")

    # Guardar
    print(f"\n💾 Guardando template: {output_docx}")

    # Crear el nuevo DOCX
    with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as zip_out:
        with zipfile.ZipFile(input_docx, 'r') as zip_in:
            for item in zip_in.infolist():
                if item.filename == 'word/document.xml':
                    # Escribir el XML modificado
                    zip_out.writestr(item, modified_xml.encode('utf-8'))
                else:
                    # Copiar el resto de archivos sin modificar
                    zip_out.writestr(item, zip_in.read(item.filename))

    print("\n✅ ¡Template editado exitosamente!")
    print(f"\n🎯 Ahora ejecuta:")
    print(f"   1. bun run dev    (en una terminal)")
    print(f"   2. bun run test   (en otra terminal)")

if __name__ == '__main__':
    main()
