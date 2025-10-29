#!/usr/bin/env python3
"""
Script para agregar soporte de género dinámico al template de garantía mobiliaria

Este script modifica el template DOCX para reemplazar términos con género
masculino fijo por variables dinámicas que se adaptarán según el género del deudor.

Uso:
    python scripts/prepare-garantia-mobiliaria-template.py

El script:
1. Usa el backup BEFORE_GENDER como fuente
2. Extrae el XML del DOCX
3. Realiza reemplazos exactos preservando la estructura XML
4. Regenera el DOCX con las variables de género
5. Genera reporte de cambios realizados
"""

import zipfile
import os
import sys
from pathlib import Path

# Configuración de rutas
TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'
TEMPLATE_NAME = 'garantia_mobiliaria.docx'
TEMPLATE_PATH = TEMPLATES_DIR / TEMPLATE_NAME
BACKUP_NAME = 'garantia_mobiliaria_BEFORE_GENDER.docx'
BACKUP_PATH = TEMPLATES_DIR / BACKUP_NAME

def extract_docx_xml(docx_path: Path) -> dict:
    """Extrae los archivos XML del DOCX"""
    with zipfile.ZipFile(docx_path, 'r') as zip_file:
        # Extraer document.xml (contenido principal)
        document_xml = zip_file.read('word/document.xml').decode('utf-8')

        # Extraer todos los archivos para reconstruir el DOCX
        all_files = {}
        for name in zip_file.namelist():
            all_files[name] = zip_file.read(name)

    return {
        'document_xml': document_xml,
        'all_files': all_files
    }

def apply_gender_replacements(xml: str) -> tuple[str, list]:
    """
    Aplica los reemplazos de género en el XML

    Retorna: (xml_modificado, lista_de_cambios)
    """
    changes = []
    original_xml = xml

    # ==== CATEGORÍA 1: REFERENCIAS AL DEUDOR ====

    # "el Deudor Garante" (debe hacerse ANTES de "el Deudor")
    count_dg_before = xml.count('el Deudor Garante')
    xml = xml.replace('el Deudor Garante', '{debtor_guarantor}')
    if count_dg_before > 0:
        changes.append(f'1. "el Deudor Garante" → "{{debtor_guarantor}}" ({count_dg_before} veces)')

    # "al Deudor Garante" (con preposición)
    count_adg_before = xml.count('al Deudor Garante')
    xml = xml.replace('al Deudor Garante', '{to_debtor} Garante')
    if count_adg_before > 0:
        changes.append(f'2. "al Deudor Garante" → "{{to_debtor}} Garante" ({count_adg_before} veces)')

    # "el Deudor" (después de Deudor Garante)
    count_d_before = xml.count('el Deudor')
    xml = xml.replace('el Deudor', '{debtor}')
    if count_d_before > 0:
        changes.append(f'3. "el Deudor" → "{{debtor}}" ({count_d_before} veces)')

    # "al Deudor"
    count_ad_before = xml.count('al Deudor')
    xml = xml.replace('al Deudor', '{to_debtor}')
    if count_ad_before > 0:
        changes.append(f'4. "al Deudor" → "{{to_debtor}}" ({count_ad_before} veces)')

    # "el deudor" (minúscula)
    count_d_lower_before = xml.count('el deudor')
    xml = xml.replace('el deudor', '{debtor}')
    if count_d_lower_before > 0:
        changes.append(f'5. "el deudor" → "{{debtor}}" ({count_d_lower_before} veces)')

    # "al deudor" (minúscula)
    count_ad_lower_before = xml.count('al deudor')
    xml = xml.replace('al deudor', '{to_debtor}')
    if count_ad_lower_before > 0:
        changes.append(f'6. "al deudor" → "{{to_debtor}}" ({count_ad_lower_before} veces)')

    # ==== CATEGORÍA 2: REFERENCIAS AL DEPOSITARIO ====

    # "el Depositario"
    count_dep_before = xml.count('el Depositario')
    xml = xml.replace('el Depositario', '{depositary}')
    if count_dep_before > 0:
        changes.append(f'7. "el Depositario" → "{{depositary}}" ({count_dep_before} veces)')

    # "al Depositario"
    count_adep_before = xml.count('al Depositario')
    xml = xml.replace('al Depositario', '{depositary}')
    if count_adep_before > 0:
        changes.append(f'8. "al Depositario" → "{{depositary}}" ({count_adep_before} veces)')

    # ==== CATEGORÍA 3: PROPIETARIO ====

    # "el propietario"
    count_prop_before = xml.count('el propietario')
    xml = xml.replace('el propietario', '{owner}')
    if count_prop_before > 0:
        changes.append(f'9. "el propietario" → "{{owner}}" ({count_prop_before} veces)')

    # "al propietario"
    count_aprop_before = xml.count('al propietario')
    xml = xml.replace('al propietario', '{to_owner}')
    if count_aprop_before > 0:
        changes.append(f'10. "al propietario" → "{{to_owner}}" ({count_aprop_before} veces)')

    # ==== CATEGORÍA 4: ESTADO CIVIL ====

    # Buscar "soltero" en contexto del deudor (no Richard Kachler)
    # Patrón típico: "años de edad, soltero, comerciante"
    if 'años de edad, soltero, ' in xml:
        xml = xml.replace(
            'años de edad, soltero,',
            'años de edad, {debtor_marital_status_gendered},'
        )
        changes.append('11. "soltero" (deudor) → "{debtor_marital_status_gendered}"')

    # ==== CATEGORÍA 5: NACIONALIDAD ====

    # "guatemalteco" del deudor
    # Contexto: después de ocupación
    if ', guatemalteco, de este domicilio' in xml or ', guatemalteco,' in xml:
        xml = xml.replace(
            ', guatemalteco, de este domicilio',
            ', {debtor_nationality_gendered}, de este domicilio'
        )
        changes.append('12. "guatemalteco" (deudor) → "{debtor_nationality_gendered}"')

    # ==== CATEGORÍA 6: PARTICIPIOS Y ADJETIVOS ====

    # "autorizado"
    count_auth_before = xml.count('autorizado')
    xml = xml.replace('autorizado', '{authorized}')
    if count_auth_before > 0:
        changes.append(f'13. "autorizado" → "{{authorized}}" ({count_auth_before} veces)')

    # "obligado" (si existe)
    count_obl_before = xml.count('obligado')
    xml = xml.replace('obligado', '{obligated}')
    if count_obl_before > 0:
        changes.append(f'14. "obligado" → "{{obligated}}" ({count_obl_before} veces)')

    # ==== CATEGORÍA 7: PRONOMBRES Y ARTÍCULOS ====

    # "el mismo" / "al mismo" / "del mismo"
    count_same_before = xml.count('al mismo')
    xml = xml.replace('al mismo', '{to_same}')
    if count_same_before > 0:
        changes.append(f'15. "al mismo" → "{{to_same}}" ({count_same_before} veces)')

    count_of_same_before = xml.count('del mismo')
    xml = xml.replace('del mismo', '{of_same}')
    if count_of_same_before > 0:
        changes.append(f'16. "del mismo" → "{{of_same}}" ({count_of_same_before} veces)')

    return xml, changes

def rebuild_docx(template_path: Path, modified_xml: str, all_files: dict) -> None:
    """Reconstruye el DOCX con el XML modificado"""
    # Crear un nuevo archivo temporal
    temp_path = template_path.with_suffix('.tmp.docx')

    with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Escribir todos los archivos originales excepto document.xml
        for name, content in all_files.items():
            if name != 'word/document.xml':
                zip_file.writestr(name, content)

        # Escribir el document.xml modificado
        zip_file.writestr('word/document.xml', modified_xml.encode('utf-8'))

    # Reemplazar el archivo original
    temp_path.replace(template_path)
    print(f"✓ Template actualizado: {template_path.name}")

def main():
    print("=" * 70)
    print("  SCRIPT: Preparar Template Garantía Mobiliaria con Género Dinámico")
    print("=" * 70)
    print()

    # Verificar que el backup existe
    if not BACKUP_PATH.exists():
        print(f"❌ Error: Backup no encontrado: {BACKUP_PATH}")
        print("   Se esperaba: garantia_mobiliaria_BEFORE_GENDER.docx")
        sys.exit(1)

    print(f"📄 Template: {TEMPLATE_NAME}")
    print(f"📄 Usando backup: {BACKUP_NAME}")
    print()

    # Paso 1: Extraer XML
    print("PASO 1: Extrayendo XML del backup...")
    data = extract_docx_xml(BACKUP_PATH)
    print("✓ XML extraído")
    print()

    # Paso 2: Aplicar reemplazos
    print("PASO 2: Aplicando reemplazos de género...")
    modified_xml, changes = apply_gender_replacements(data['document_xml'])

    if not changes:
        print("⚠ No se realizaron cambios")
        sys.exit(0)

    print(f"✓ {len(changes)} grupos de cambios aplicados:")
    for change in changes:
        print(f"  • {change}")
    print()

    # Paso 3: Reconstruir DOCX
    print("PASO 3: Reconstruyendo DOCX...")
    rebuild_docx(TEMPLATE_PATH, modified_xml, data['all_files'])
    print()

    # Resumen
    print("=" * 70)
    print("✅ COMPLETADO EXITOSAMENTE")
    print("=" * 70)
    print(f"  Template actualizado: {TEMPLATE_NAME}")
    print(f"  Cambios realizados: {len(changes)} grupos")
    print()
    print("Próximos pasos:")
    print("  1. Verificar variables: unzip -p templates/garantia_mobiliaria.docx word/document.xml | grep -o '{[^}]*}'")
    print("  2. Probar generación con tests")
    print()

if __name__ == '__main__':
    main()
