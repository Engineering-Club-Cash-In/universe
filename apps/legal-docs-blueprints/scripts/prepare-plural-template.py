#!/usr/bin/env python3
"""
Script para transformar templates DOCX de singular a plural (múltiples deudores)

Este script toma los templates SINGULARES y genera los PLURALES:
1. Cambiar pronombres de singular a plural (Yo → Nosotros/Nosotras)
2. Agregar sintaxis de docxtemplater para loops de deudores adicionales
3. Agregar firmas en formato de tabla (dos columnas)

Uso:
    python scripts/prepare-plural-template.py
"""

import zipfile
import sys
import re
from pathlib import Path

# Configuración de rutas
TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'

# Templates a procesar: (carpeta, archivo_singular, archivo_plural, is_female)
TEMPLATES_TO_PROCESS = [
    {
        'folder': 'carta_carro_nuevo',
        'templates': [
            ('carta_carro_nuevo.docx', 'carta_carro_nuevo-plural.docx', False),
            ('carta_carro_nuevo-mujer.docx', 'carta_carro_nuevo-mujer-plural.docx', True),
        ]
    }
]


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

    # "Por este medio Yo" → "Por este medio Nosotros/Nosotras"
    if is_female:
        nosotros = 'Nosotras'
    else:
        nosotros = 'Nosotros'

    if '>Por este medio Yo<' in xml or '>Por este medio Yo,' in xml:
        xml = xml.replace('>Por este medio Yo,', f'>Por este medio {nosotros},')
        xml = xml.replace('>Por este medio Yo<', f'>Por este medio {nosotros}<')
        changes.append(f'"Por este medio Yo" → "Por este medio {nosotros}"')

    # "identificado" / "identificada" → "identificados" / "identificadas"
    # El texto puede estar fragmentado en el XML, ej: ", identificad</w:t>...<w:t>a</w:t>"
    if is_female:
        xml = xml.replace('>identificada<', '>identificadas<')
        xml = xml.replace(', identificada ', ', identificadas ')
        xml = xml.replace('>identificada con', '>identificadas con')
        xml = xml.replace('>, identificada<', '>, identificadas<')
        xml = xml.replace(', identificada<', ', identificadas<')
        # Fragmento: "identificad" + "a" en tags separadas (puede tener newlines)
        xml = re.sub(r'(identificad</w:t>.*?<w:t[^>]*>)a(\s*</w:t>)', r'\1as\2', xml, flags=re.DOTALL)
        xml = re.sub(r'(identificad</w:t>.*?<w:t[^>]*>)a(\s)', r'\1as\2', xml, flags=re.DOTALL)
        changes.append('"identificada" → "identificadas"')
    else:
        xml = xml.replace('>identificado<', '>identificados<')
        xml = xml.replace(', identificado ', ', identificados ')
        xml = xml.replace('>identificado con', '>identificados con')
        xml = xml.replace('>, identificado<', '>, identificados<')
        xml = xml.replace(', identificado<', ', identificados<')
        # Fragmento: "identificad" + "o" en tags separadas (puede tener newlines)
        xml = re.sub(r'(identificad</w:t>.*?<w:t[^>]*>)o(\s*</w:t>)', r'\1os\2', xml, flags=re.DOTALL)
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
    renap_pattern = '–RENAP-, República de Guatemala, Centroamérica'

    if renap_pattern in xml:
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

        xml = xml.replace(
            renap_pattern,
            renap_pattern + deudor_adicional_block,
            1
        )
        changes.append('Agregado loop {#deudoresAdicionales}...{/deudoresAdicionales}')

    # ==== ELIMINAR FIRMA ORIGINAL Y AGREGAR LOOP DE FIRMAS ====
    # Quitar todo desde F)____ hasta </w:body> y poner solo el cierre

    # Buscar el texto F)____ y todo lo que sigue hasta </w:body>
    xml = re.sub(
        r'>F\)_{5,}[^<]*<.*?</w:body>',
        '></w:t></w:r></w:p></w:body>',
        xml,
        flags=re.DOTALL
    )
    changes.append('Eliminada firma original del singular')

    body_close = '</w:body>'
    if body_close in xml:
        # Tabla de 2 columnas para firmas (usando firmantesFilas del servicio TS)
        # Cada fila tiene col1 y col2 (col2 puede estar vacía)
        firmas_tabla = (
            # Apertura del loop de filas
            '<w:p><w:r><w:t>{#firmantesFilas}</w:t></w:r></w:p>'
            # Tabla de 2 columnas sin bordes
            '<w:tbl>'
            '<w:tblPr>'
            '<w:tblW w:w="5000" w:type="pct"/>'
            '<w:tblBorders>'
            '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>'
            '<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>'
            '</w:tblBorders>'
            '</w:tblPr>'
            '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'
            '<w:tr>'
            # Columna 1 (siempre tiene firmante)
            '<w:tc>'
            '<w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>F)________________________</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>{col1nombreCompleto}</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>{col1dpi}</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'
            '</w:tc>'
            # Columna 2 (puede estar vacía - usar condicional)
            '<w:tc>'
            '<w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>'
            '<w:p><w:r><w:t>{#tieneCol2}</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>F)________________________</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>{col2nombreCompleto}</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'
            '<w:t>{col2dpi}</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'
            '<w:p><w:r><w:t>{/tieneCol2}</w:t></w:r></w:p>'
            '</w:tc>'
            '</w:tr>'
            '</w:tbl>'
            # Cierre del loop de filas
            '<w:p><w:r><w:t>{/firmantesFilas}</w:t></w:r></w:p>'
        )

        xml = xml.replace(body_close, firmas_tabla + body_close)
        changes.append('Agregada tabla de firmas 2 columnas {#firmantesFilas}')

    return xml, changes


def save_docx(output_path: Path, modified_xml: str, all_files: dict) -> None:
    """Guarda el DOCX con el XML modificado"""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for name, content in all_files.items():
            if name != 'word/document.xml':
                zip_file.writestr(name, content)

        zip_file.writestr('word/document.xml', modified_xml.encode('utf-8'))

    print(f"  ✓ Generado: {output_path.name}")


def process_template(source_path: Path, output_path: Path, is_female: bool) -> bool:
    """Procesa un template: lee el singular y genera el plural"""
    print(f"\n📄 {source_path.name} → {output_path.name}")

    if not source_path.exists():
        print(f"  ❌ Error: Template singular no encontrado")
        return False

    # Paso 1: Extraer XML del singular
    print("  → Leyendo template singular...")
    data = extract_docx_xml(source_path)

    # Paso 2: Aplicar reemplazos
    print("  → Aplicando transformaciones plurales...")
    modified_xml, changes = apply_plural_replacements(data['document_xml'], is_female)

    if not changes:
        print("  ⚠ No se realizaron cambios")
        return False

    print(f"  ✓ {len(changes)} cambios aplicados:")
    for change in changes:
        print(f"    • {change}")

    # Paso 3: Guardar como nuevo archivo plural
    print("  → Guardando template plural...")
    save_docx(output_path, modified_xml, data['all_files'])

    return True


def main():
    print("=" * 70)
    print("  SCRIPT: Generar Templates Plurales desde Singulares")
    print("=" * 70)

    total_processed = 0
    total_success = 0

    for template_config in TEMPLATES_TO_PROCESS:
        folder = template_config['folder']
        templates = template_config['templates']

        print(f"\n📁 Carpeta: {folder}")

        for singular_file, plural_file, is_female in templates:
            source_path = TEMPLATES_DIR / folder / singular_file
            output_path = TEMPLATES_DIR / folder / plural_file

            if process_template(source_path, output_path, is_female):
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
