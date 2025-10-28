#!/usr/bin/env python3
"""
Script para agregar soporte de género dinámico a templates DOCX

Este script modifica un template DOCX para reemplazar términos con género
masculino fijo por variables dinámicas que se adaptarán según el género del cliente.

Uso:
    python scripts/prepare-gender-template.py

El script:
1. Hace backup del template original
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
TEMPLATE_NAME = 'contrato_uso_carro_usado.docx'
TEMPLATE_PATH = TEMPLATES_DIR / TEMPLATE_NAME
BACKUP_SUFFIX = '_BEFORE_GENDER'

def create_backup(template_path: Path) -> Path:
    """Crea un backup del template original"""
    backup_path = template_path.with_name(
        template_path.stem + BACKUP_SUFFIX + template_path.suffix
    )

    if backup_path.exists():
        print(f"⚠ Backup ya existe: {backup_path.name}")
        response = input("¿Sobrescribir backup? (s/n): ")
        if response.lower() != 's':
            print("Operación cancelada")
            sys.exit(0)

    # Copiar archivo
    import shutil
    shutil.copy2(template_path, backup_path)
    print(f"✓ Backup creado: {backup_path.name}")
    return backup_path

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

    # ==== CATEGORÍA 1: TRATAMIENTO FORMAL "el señor" / "al señor" ====
    # Contexto 1: "dará en USO al señor"
    if 'dará en USO al señor' in xml:
        xml = xml.replace('>dará en USO al señor', '>dará en USO {title_with_article}')
        changes.append('1. "dará en USO al señor" → "dará en USO {title_with_article}"')

    # Contextos 2-5: "el señor" en varias cláusulas
    # Necesitamos ser cuidadosos y reemplazar solo las instancias correctas

    # "será utilizado única y exclusivamente por el señor"
    if 'será utilizado única y exclusivamente por el señor' in xml:
        xml = xml.replace(
            '>será utilizado única y exclusivamente por el señor',
            '>será utilizado única y exclusivamente por {title_article}'
        )
        changes.append('2. "por el señor" (inciso a) → "por {title_article}"')

    # "De igual forma, el señor"
    if 'De igual forma, el señor' in xml:
        xml = xml.replace('>De igual forma, el señor', '>De igual forma, {title_article}')
        changes.append('3. "De igual forma, el señor" → "De igual forma, {title_article}"')

    # "El señor {user_name_clause_b}, se compromete" (inciso b)
    # Buscar el patrón específico antes de user_name_clause_b
    if '>El señor </w:t>' in xml and 'user_name_clause_b' in xml:
        # Reemplazar solo la instancia antes de clause_b
        xml = xml.replace(
            '<w:t xml:space="preserve">El señor </w:t></w:r><w:r',
            '<w:t xml:space="preserve">{title_article} </w:t></w:r><w:r'
        )
        changes.append('4. "El señor" (inciso b) → "{title_article}"')

    # "El señor {user_name_clause_d}, renuncia" (inciso d)
    if '>El señor </w:t>' in xml and 'user_name_clause_d' in xml:
        # Esta es la segunda instancia, necesitamos ser específicos
        # Buscar el contexto exacto de inciso d
        xml = xml.replace(
            'inciso d)**: **El señor',
            'inciso d)**: **{title_article}'
        )
        # Si no funciona así, buscar por contexto de "renuncia al fuero"
        if 'renuncia al fuero' in xml:
            parts = xml.split('renuncia al fuero')
            if len(parts) > 1:
                # Reemplazar el "El señor" más cercano antes de "renuncia"
                before_renuncia = parts[0]
                if'>El señor' in before_renuncia[-200:]:
                    parts[0] = before_renuncia.replace('>El señor', '>{title_article}', -1)
                    xml = 'renuncia al fuero'.join(parts)
                    changes.append('5. "El señor" (inciso d) → "{title_article}"')

    # ==== CATEGORÍA 2: ESTADO CIVIL "soltero" ====
    # Hay 2 ocurrencias: Richard Kachler y el cliente
    # Solo queremos reemplazar la del cliente

    # Cliente: "de {client_age} años de edad, soltero, comerciante"
    if 'años de edad, soltero, comerciante' in xml or 'años de edad, soltero, ' in xml:
        xml = xml.replace(
            'años de edad, soltero,',
            'años de edad, {client_marital_status_gendered},'
        )
        changes.append('6. "soltero" (cliente) → "{client_marital_status_gendered}"')

    # ==== CATEGORÍA 3: TÍTULO PROFESIONAL "Licenciado" ====
    # Richard Kachler: "soltero, Licenciado en Administración"
    # NO tocar este, es fijo

    # Cliente: si tiene título, agregar variable después de estado civil
    # Por ahora, lo dejamos como opcional en el JSON

    # ==== CATEGORÍA 4: NACIONALIDAD "guatemalteco" ====
    # Hay 2 ocurrencias: Richard y cliente
    # Solo queremos cambiar la del cliente

    # Cliente: "{client_marital_status_gendered}, comerciante, guatemalteco, de este domicilio"
    if 'comerciante, guatemalteco, de este domicilio' in xml or ', guatemalteco, de este domicilio' in xml:
        xml = xml.replace(
            ', guatemalteco, de este domicilio',
            ', {client_nationality_gendered}, de este domicilio'
        )
        changes.append('7. "guatemalteco" (cliente) → "{client_nationality_gendered}"')

    # ==== CATEGORÍA 5: PROFESIÓN "comerciante" ====
    # Cambiar por variable dinámica
    if '{client_marital_status_gendered}, comerciante,' in xml:
        xml = xml.replace(
            '{client_marital_status_gendered}, comerciante,',
            '{client_marital_status_gendered}, {client_occupation},'
        )
        changes.append('8. "comerciante" → "{client_occupation}"')

    # ==== CATEGORÍA 6: SUSTANTIVO "el usuario" / "al usuario" ====
    # Múltiples ocurrencias (8+)

    # "Queda prohibido al usuario"
    xml = xml.replace('>Queda prohibido al usuario', '>Queda prohibido {to_user}')

    # "el usuario por este medio"
    xml = xml.replace('>el usuario por este medio', '>{user_noun} por este medio')

    # "el usuario responderá"
    xml = xml.replace('>el usuario responderá', '>{user_noun} responderá')

    # "El usuario no podrá"
    xml = xml.replace('>El usuario no podrá', '>{user_noun} no podrá')

    # "El usuario respetará"
    xml = xml.replace('>El usuario respetará', '>{user_noun} respetará')

    # "para desapoderar al usuario"
    xml = xml.replace('>para desapoderar al usuario', '>para desapoderar {to_user}')

    # "el usuario acepta y reconoce"
    xml = xml.replace('>el usuario acepta y reconoce', '>{user_noun} acepta y reconoce')

    # "El USUARIO será responsable" (mayúsculas)
    xml = xml.replace('>El USUARIO será', '>{user_noun} será')

    if xml != original_xml:
        changes.append('9-16. Reemplazados múltiples "el usuario" / "al usuario" → "{user_noun}" / "{to_user}"')

    # ==== CATEGORÍA 7: PARTICIPIOS "obligado" ====
    # "quedará obligado al pago"
    xml = xml.replace('>quedará obligado al', '>quedará {obligated} al')

    # "Quedando obligado en forma"
    xml = xml.replace('>Quedando obligado en', '>Quedando {obligated} en')
    changes.append('17-18. "obligado" → "{obligated}"')

    # ==== CATEGORÍA 8: ADJETIVO "directo" / "directa" ====
    # "siendo responsable directo del"
    xml = xml.replace('>siendo responsable directo del', '>siendo responsable {direct} del')

    # "en forma directa al pago"
    xml = xml.replace('>en forma directa al', '>en forma {direct} al')
    changes.append('19-20. "directo/directa" → "{direct}"')

    # ==== CATEGORÍA 9: PLURAL "enterados" ====
    # "bien enterados de su objeto"
    xml = xml.replace('>bien enterados de', '>bien {informed_plural} de')
    changes.append('21. "enterados" → "{informed_plural}"')

    # ==== CATEGORÍA 10: PRONOMBRES "al mismo" / "del mismo" ====
    # "a tercero, al mismo, y a su vínculo"
    xml = xml.replace('>a tercero, al mismo, y', '>a tercero, {to_same}, y')

    # "como depositario del mismo"
    xml = xml.replace('>como depositario del mismo', '>como depositario {of_same}')
    changes.append('22-23. "al mismo" / "del mismo" → "{to_same}" / "{of_same}"')

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
    print("  SCRIPT: Preparar Template con Soporte de Género Dinámico")
    print("=" * 70)
    print()

    # Verificar que el template existe
    if not TEMPLATE_PATH.exists():
        print(f"❌ Error: Template no encontrado: {TEMPLATE_PATH}")
        sys.exit(1)

    print(f"📄 Template: {TEMPLATE_NAME}")
    print()

    # Paso 1: Crear backup
    print("PASO 1: Creando backup...")
    backup_path = create_backup(TEMPLATE_PATH)
    print()

    # Paso 2: Extraer XML
    print("PASO 2: Extrayendo XML del DOCX...")
    data = extract_docx_xml(TEMPLATE_PATH)
    print("✓ XML extraído")
    print()

    # Paso 3: Aplicar reemplazos
    print("PASO 3: Aplicando reemplazos de género...")
    modified_xml, changes = apply_gender_replacements(data['document_xml'])

    if not changes:
        print("⚠ No se realizaron cambios")
        sys.exit(0)

    print(f"✓ {len(changes)} grupos de cambios aplicados:")
    for change in changes:
        print(f"  • {change}")
    print()

    # Paso 4: Reconstruir DOCX
    print("PASO 4: Reconstruyendo DOCX...")
    rebuild_docx(TEMPLATE_PATH, modified_xml, data['all_files'])
    print()

    # Resumen
    print("=" * 70)
    print("✅ COMPLETADO EXITOSAMENTE")
    print("=" * 70)
    print(f"  Template original respaldado en: {backup_path.name}")
    print(f"  Template actualizado: {TEMPLATE_NAME}")
    print(f"  Cambios realizados: {len(changes)} grupos")
    print()
    print("Próximos pasos:")
    print("  1. Verificar variables en el template con: unzip -p templates/...docx word/document.xml | grep -o '{[^}]*}'")
    print("  2. Probar generación con: bun run test")
    print()

if __name__ == '__main__':
    main()
