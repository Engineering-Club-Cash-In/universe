#!/usr/bin/env python3
"""
Script para transformar templates DOCX de singular a plural (múltiples deudores)

Este script modifica templates DOCX plurales para:
1. Cambiar pronombres de singular a plural (Yo → Nosotros, manifiesto → manifestamos)
2. Agregar sintaxis de docxtemplater para loops de deudores adicionales
3. Agregar firmas para cada deudor adicional

Uso:
    python scripts/prepare-plural-template.py
"""

import zipfile
import os
import sys
import re
from pathlib import Path

# Configuración de rutas
TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'

# Templates a procesar (carpeta/archivo)
TEMPLATES_TO_PROCESS = [
    {
        'folder': 'carta_carro_nuevo',
        'files': [
            'carta_carro_nuevo-plural.docx',
            'carta_carro_nuevo-mujer-plural.docx'
        ]
    }
]

BACKUP_SUFFIX = '_BEFORE_PLURAL'


def create_backup(template_path: Path) -> Path:
    """Crea un backup del template original"""
    backup_path = template_path.with_name(
        template_path.stem + BACKUP_SUFFIX + template_path.suffix
    )

    if backup_path.exists():
        print(f"  ⚠ Backup ya existe: {backup_path.name}, saltando backup")
        return backup_path

    import shutil
    shutil.copy2(template_path, backup_path)
    print(f"  ✓ Backup creado: {backup_path.name}")
    return backup_path


def extract_docx_xml(docx_path: Path) -> dict:
    """Extrae los archivos XML del DOCX"""
    with zipfile.ZipFile(docx_path, 'r') as zip_file:
        document_xml = zip_file.read('word/document.xml').decode('utf-8')

        all_files = {}
        for name in zip_file.namelist():
            all_files[name] = zip_file.read(name)

    return {
        'document_xml': document_xml,
        'all_files': all_files
    }


def apply_plural_replacements(xml: str, is_female: bool = False) -> tuple[str, list]:
    """
    Aplica los reemplazos de singular a plural en el XML

    Args:
        xml: El contenido XML del documento
        is_female: True si es plantilla femenina

    Retorna: (xml_modificado, lista_de_cambios)
    """
    changes = []

    # ==== PRONOMBRES Y VERBOS ====

    # "Por este medio Yo" → "Por este medio Nosotros"
    if '>Por este medio Yo<' in xml or '>Por este medio Yo,' in xml:
        xml = xml.replace('>Por este medio Yo,', '>Por este medio Nosotros,')
        xml = xml.replace('>Por este medio Yo<', '>Por este medio Nosotros<')
        changes.append('"Por este medio Yo" → "Por este medio Nosotros"')

    # "identificado" / "identificada" → "identificados" / "identificadas"
    # El texto puede estar fragmentado en el XML, ej: ", identificad</w:t>...<w:t>o con"
    if is_female:
        xml = xml.replace('>identificada<', '>identificadas<')
        xml = xml.replace(', identificada ', ', identificadas ')
        xml = xml.replace('>identificada con', '>identificadas con')
        xml = xml.replace('>, identificada<', '>, identificadas<')
        xml = xml.replace(', identificada<', ', identificadas<')
        # Fragmento: ", identificad</w:t>...<w:t>a " - reemplazar solo la "a" suelta
        xml = re.sub(r'(identificad</w:t>.*?<w:t[^>]*>)a(\s)', r'\1as\2', xml, flags=re.DOTALL)
        changes.append('"identificada" → "identificadas"')
    else:
        xml = xml.replace('>identificado<', '>identificados<')
        xml = xml.replace(', identificado ', ', identificados ')
        xml = xml.replace('>identificado con', '>identificados con')
        xml = xml.replace('>, identificado<', '>, identificados<')
        xml = xml.replace(', identificado<', ', identificados<')
        # Fragmento: ", identificad</w:t>...<w:t>o " - reemplazar solo la "o" suelta
        xml = re.sub(r'(identificad</w:t>.*?<w:t[^>]*>)o(\s)', r'\1os\2', xml, flags=re.DOTALL)
        changes.append('"identificado" → "identificados"')

    # "manifiesto mi conformidad" → "manifestamos nuestra conformidad"
    xml = xml.replace('manifiesto mi conformidad', 'manifestamos nuestra conformidad')
    changes.append('"manifiesto mi conformidad" → "manifestamos nuestra conformidad"')

    # "comprendo, entiendo y acepto" → "comprendemos, entendemos y aceptamos"
    xml = xml.replace('comprendo, entiendo y acepto', 'comprendemos, entendemos y aceptamos')
    changes.append('"comprendo, entiendo y acepto" → "comprendemos, entendemos y aceptamos"')

    # "me suscribo" → "nos suscribimos"
    xml = xml.replace('me suscribo', 'nos suscribimos')
    changes.append('"me suscribo" → "nos suscribimos"')

    # ==== AGREGAR LOOP PARA DEUDORES ADICIONALES ====
    # Después del primer deudor, agregar el bloque de deudores adicionales

    # Buscar el patrón del primer deudor y agregar el loop después
    # El patrón es: "{nombreCompleto}, identificado(s)... –RENAP-"

    renap_pattern = '–RENAP-, República de Guatemala, Centroamérica'

    if renap_pattern in xml:
        # Construir el bloque de deudor adicional
        if is_female:
            deudor_adicional_block = (
                '{#deudoresAdicionales} y {nombreCompleto}, identificada con Documento Personal de Identificación, '
                'Código Único de Identificación {dpiTexto}, extendido por el Registro Nacional de las Personas '
                '–RENAP-, República de Guatemala, Centroamérica{/deudoresAdicionales}'
            )
        else:
            deudor_adicional_block = (
                '{#deudoresAdicionales} y {nombreCompleto}, identificado con Documento Personal de Identificación, '
                'Código Único de Identificación {dpiTexto}, extendido por el Registro Nacional de las Personas '
                '–RENAP-, República de Guatemala, Centroamérica{/deudoresAdicionales}'
            )

        # Insertar después del primer RENAP
        xml = xml.replace(
            renap_pattern,
            renap_pattern + deudor_adicional_block,
            1  # Solo la primera ocurrencia
        )
        changes.append('Agregado loop {#deudoresAdicionales}...{/deudoresAdicionales}')

    # ==== AGREGAR FIRMAS ADICIONALES ====
    # Agregar el bloque de firmas antes del cierre </w:body>

    body_close = '</w:body>'
    if body_close in xml:
        # Crear bloque de firmas adicionales
        firma_adicional = (
            '<w:p w14:paraId="ADDFIRMA1" w14:textId="ADDFIRMA1" w:rsidR="00000000" w:rsidRDefault="00000000">'
            '<w:r><w:t>{#deudoresAdicionales}</w:t></w:r>'
            '</w:p>'
            '<w:p w14:paraId="ADDFIRMA2" w14:textId="ADDFIRMA2" w:rsidR="00000000" w:rsidRDefault="00000000">'
            '<w:r><w:t>F)________________________</w:t></w:r>'
            '</w:p>'
            '<w:p w14:paraId="ADDFIRMA3" w14:textId="ADDFIRMA3" w:rsidR="00000000" w:rsidRDefault="00000000">'
            '<w:r><w:t>{nombreCompleto}</w:t></w:r>'
            '</w:p>'
            '<w:p w14:paraId="ADDFIRMA4" w14:textId="ADDFIRMA4" w:rsidR="00000000" w:rsidRDefault="00000000">'
            '<w:r><w:t>{dpi}</w:t></w:r>'
            '</w:p>'
            '<w:p w14:paraId="ADDFIRMA5" w14:textId="ADDFIRMA5" w:rsidR="00000000" w:rsidRDefault="00000000">'
            '<w:r><w:t>{/deudoresAdicionales}</w:t></w:r>'
            '</w:p>'
        )
        xml = xml.replace(body_close, firma_adicional + body_close)
        changes.append('Agregadas firmas para deudores adicionales')

    return xml, changes


def rebuild_docx(template_path: Path, modified_xml: str, all_files: dict) -> None:
    """Reconstruye el DOCX con el XML modificado"""
    temp_path = template_path.with_suffix('.tmp.docx')

    with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for name, content in all_files.items():
            if name != 'word/document.xml':
                zip_file.writestr(name, content)

        zip_file.writestr('word/document.xml', modified_xml.encode('utf-8'))

    temp_path.replace(template_path)
    print(f"  ✓ Template actualizado: {template_path.name}")


def process_template(template_path: Path, is_female: bool) -> bool:
    """Procesa un template individual"""
    print(f"\n📄 Procesando: {template_path.name}")

    if not template_path.exists():
        print(f"  ❌ Error: Template no encontrado")
        return False

    # Paso 1: Backup
    create_backup(template_path)

    # Paso 2: Extraer XML
    print("  → Extrayendo XML...")
    data = extract_docx_xml(template_path)

    # Paso 3: Aplicar reemplazos
    print("  → Aplicando reemplazos plurales...")
    modified_xml, changes = apply_plural_replacements(data['document_xml'], is_female)

    if not changes:
        print("  ⚠ No se realizaron cambios")
        return False

    print(f"  ✓ {len(changes)} cambios aplicados:")
    for change in changes:
        print(f"    • {change}")

    # Paso 4: Reconstruir DOCX
    print("  → Reconstruyendo DOCX...")
    rebuild_docx(template_path, modified_xml, data['all_files'])

    return True


def main():
    print("=" * 70)
    print("  SCRIPT: Transformar Templates a Plural (Múltiples Deudores)")
    print("=" * 70)

    total_processed = 0
    total_success = 0

    for template_config in TEMPLATES_TO_PROCESS:
        folder = template_config['folder']
        files = template_config['files']

        print(f"\n📁 Carpeta: {folder}")

        for filename in files:
            template_path = TEMPLATES_DIR / folder / filename
            is_female = 'mujer' in filename.lower()

            if process_template(template_path, is_female):
                total_success += 1
            total_processed += 1

    # Resumen
    print("\n" + "=" * 70)
    print("✅ COMPLETADO")
    print("=" * 70)
    print(f"  Templates procesados: {total_processed}")
    print(f"  Exitosos: {total_success}")
    print()
    print("Próximos pasos:")
    print("  1. Revisar los templates generados en Word")
    print("  2. Ajustar manualmente si es necesario")
    print("  3. Probar con datos de prueba")
    print()


if __name__ == '__main__':
    main()
