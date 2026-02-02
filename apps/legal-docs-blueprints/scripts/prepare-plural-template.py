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
    },
    {
        'folder': 'contrato_privado_uso_nuevo',
        'templates': [
            ('contrato_privado_uso_nuevo.docx', 'contrato_privado_uso_nuevo-plural.docx', False),
            ('contrato_privado_uso_nuevo-mujer.docx', 'contrato_privado_uso_nuevo-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'contrato_uso_carro_usado',
        'templates': [
            ('contrato_uso_carro_usado.docx', 'contrato_uso_carro_usado-plural.docx', False),
            ('contrato_uso_carro_usado-mujer.docx', 'contrato_uso_carro_usado-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'descargo_responsabilidades',
        'templates': [
            ('descargo_responsabilidades.docx', 'descargo_responsabilidades-plural.docx', False),
            ('descargo_responsabilidades-mujer.docx', 'descargo_responsabilidades-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'pagare_unico_libre_protesto',
        'templates': [
            ('pagare_unico_libre_de_protesto.docx', 'pagare_unico_libre_de_protesto-plural.docx', False),
            ('pagare_unico_libre_de_protesto-mujer.docx', 'pagare_unico_libre_de_protesto-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'carta_solicitud_traspaso_vehiculo',
        'templates': [
            ('carta_solicitud_traspaso_vehiculo.docx', 'carta_solicitud_traspaso_vehiculo-plural.docx', False),
            ('carta_solicitud_traspaso_vehiculo-mujer.docx', 'carta_solicitud_traspaso_vehiculo-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'declaracion_vendedor',
        'templates': [
            ('declaracion_de_vendedor.docx', 'declaracion_de_vendedor-plural.docx', False),
            ('declaracion_de_vendedor-mujer.docx', 'declaracion_de_vendedor-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'garantia_mobiliaria',
        'templates': [
            ('garantia_mobiliaria.docx', 'garantia_mobiliaria-plural.docx', False),
            ('garantia_mobiliaria-mujer.docx', 'garantia_mobiliaria-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'solicitud_compra_vehiculo',
        'templates': [
            ('solicitud_compra_vehiculo.docx', 'solicitud_compra_vehiculo-plural.docx', False),
            ('solicitud_compra_vehiculo-mujer.docx', 'solicitud_compra_vehiculo-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'carta_emision_cheques',
        'templates': [
            ('carta_emision_cheques.docx', 'carta_emision_cheques-plural.docx', False),
            ('carta_emision_cheques-mujer.docx', 'carta_emision_cheques-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'carta_aceptacion_gps',
        'templates': [
            ('carta_aceptacion_gps.docx', 'carta_aceptacion_gps-plural.docx', False),
            ('carta_aceptacion_gps-mujer.docx', 'carta_aceptacion_gps-mujer-plural.docx', True),
        ]
    },
    {
        'folder': 'reconocimiento_deuda',
        'templates': [
            ('reconocimiento_deuda_template.docx', 'reconocimiento_deuda_template-plural.docx', False),
            ('reconocimiento_deuda_template-mujer.docx', 'reconocimiento_deuda_template-mujer-plural.docx', True),
        ]
    },
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
    loop_added = False  # Flag para evitar agregar múltiples loops

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
        xml = xml.replace('identificada con Documento', 'identificadas con Documento')
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

    # ==== REEMPLAZOS PARA CARTA_ACEPTACION_GPS ====
    # "yo: " → "Nosotros/Nosotras: " (el texto puede estar fragmentado en XML)
    # Y agregar loop de deudores después de {nombreCompleto}
    if ', yo: </w:t' in xml or ', yo:</w:t' in xml or '>yo: </w:t' in xml:
        xml = xml.replace(', yo: </w:t', f', {nosotros}: </w:t')
        xml = xml.replace(', yo:</w:t', f', {nosotros}:</w:t')
        xml = xml.replace('>yo: </w:t', f'>{nosotros}: </w:t')
        changes.append(f'"yo:" → "{nosotros}:"')

        # Agregar loop de deudoresAdicionales después del primer {nombreCompleto} en carta_aceptacion_gps
        # Buscar el patrón: {nombreCompleto} </w:t>...<w:t>manifiesto
        deudores_loop = '{nombreCompleto}{#deudoresAdicionales} y {nombreCompleto}{/deudoresAdicionales}'
        # Reemplazar solo el primer {nombreCompleto} que va seguido de </w:t> y luego manifiesto
        xml = re.sub(
            r'(\{nombreCompleto\})(\s*</w:t>.*?<w:t[^>]*>manifiesto)',
            rf'{deudores_loop}\2',
            xml,
            count=1,
            flags=re.DOTALL
        )
        changes.append('Agregado loop deudoresAdicionales después de nombreCompleto')

    # "manifiesto que estoy enterado y acepto" → "manifestamos que estamos enterados/enteradas y aceptamos"
    if is_female:
        xml = xml.replace('manifiesto que estoy enterada y acepto', 'manifestamos que estamos enteradas y aceptamos')
        changes.append('"manifiesto que estoy enterada y acepto" → "manifestamos que estamos enteradas y aceptamos"')
    else:
        xml = xml.replace('manifiesto que estoy enterado y acepto', 'manifestamos que estamos enterados y aceptamos')
        changes.append('"manifiesto que estoy enterado y acepto" → "manifestamos que estamos enterados y aceptamos"')

    # "me someto expresamente" → "nos sometemos expresamente"
    xml = xml.replace('me someto expresamente', 'nos sometemos expresamente')
    changes.append('"me someto expresamente" → "nos sometemos expresamente"')

    # "ACEPTO" → "ACEPTAMOS" (puede estar en medio del texto, no entre tags)
    xml = xml.replace(' ACEPTO ', ' ACEPTAMOS ')
    xml = xml.replace('>ACEPTO<', '>ACEPTAMOS<')
    changes.append('"ACEPTO" → "ACEPTAMOS"')

    # "acepto que me comprometo" → "aceptamos que nos comprometemos"
    xml = xml.replace('acepto que me comprometo', 'aceptamos que nos comprometemos')
    changes.append('"acepto que me comprometo" → "aceptamos que nos comprometemos"')

    # "me comprometo a" → "nos comprometemos a"
    xml = xml.replace('me comprometo a', 'nos comprometemos a')
    changes.append('"me comprometo a" → "nos comprometemos a"')

    # ==== REEMPLAZOS PARA CARTA_SOLICITUD_TRASPASO_VEHICULO ====
    # Solo pide: nombreCompleto y dpiTexto
    if 'Por este medio, yo' in xml and 'atentamente solicito y autorizo' in xml:
        # "Por este medio, yo" → "Por este medio, Nosotros/Nosotras"
        xml = xml.replace('Por este medio, yo', f'Por este medio, {nosotros}')
        changes.append(f'"Por este medio, yo" → "Por este medio, {nosotros}"')

        # "atentamente solicito y autorizo" → "atentamente solicitamos y autorizamos"
        xml = xml.replace('atentamente solicito y autorizo', 'atentamente solicitamos y autorizamos')
        changes.append('"atentamente solicito y autorizo" → "atentamente solicitamos y autorizamos"')

        # Agregar loop simplificado después del primer RENAP (solo nombreCompleto y dpiTexto)
        renap_traspaso = '–RENAP-, República de Guatemala, Centroamérica, atentamente'
        if is_female:
            loop_traspaso = (
                '–RENAP-, República de Guatemala, Centroamérica'
                '{#deudoresAdicionales} y {nombreCompleto}, identificada con DPI {dpiTexto}, '
                'extendido por el Registro Nacional de las Personas –RENAP-, República de Guatemala, '
                'Centroamérica{/deudoresAdicionales}, atentamente'
            )
        else:
            loop_traspaso = (
                '–RENAP-, República de Guatemala, Centroamérica'
                '{#deudoresAdicionales} y {nombreCompleto}, identificado con DPI {dpiTexto}, '
                'extendido por el Registro Nacional de las Personas –RENAP-, República de Guatemala, '
                'Centroamérica{/deudoresAdicionales}, atentamente'
            )
        xml = xml.replace(renap_traspaso, loop_traspaso)
        changes.append('Agregado loop deudoresAdicionales (solo nombreCompleto y dpiTexto)')
        loop_added = True

    # ==== REEMPLAZOS PARA DESCARGO_RESPONSABILIDADES ====
    # Solo usa: nombreCompleto y dpiTexto
    if 'DESCARGO DE RESPONSABILIDADES' in xml:
        # El XML fragmenta el texto. Buscar {dpiTexto} e insertar loop después
        # La coma y "a través" están en tags separados, así que buscamos hasta "a través"
        if is_female:
            loop_descargo = (
                r'\1{#deudoresAdicionales}, y {nombreCompleto}, identificada con Documento Personal de Identificación, '
                r'Código Único de Identificación: {dpiTexto}{/deudoresAdicionales}\2'
            )
        else:
            loop_descargo = (
                r'\1{#deudoresAdicionales}, y {nombreCompleto}, identificado con Documento Personal de Identificación, '
                r'Código Único de Identificación: {dpiTexto}{/deudoresAdicionales}\2'
            )
        # Capturar {dpiTexto} y todo el XML hasta "a través de financiamiento"
        descargo_pattern = r'(\{dpiTexto\})(</w:t>.*?a través de financiamiento)'
        xml = re.sub(descargo_pattern, loop_descargo, xml, count=1, flags=re.DOTALL)
        changes.append('Agregado loop deudoresAdicionales (nombreCompleto y dpiTexto)')
        loop_added = True

    # ==== REEMPLAZOS PARA SOLICITUD_COMPRA_VEHICULO ====
    # Solo usa: nombreCompleto y dpiTexto
    if 'SOLICITUD DE COMPRA DE VEHÍCULO' in xml:
        # "Por este medio, yo" → "Por este medio, Nosotros/Nosotras:"
        xml = xml.replace('Por este medio, yo', f'Por este medio, {nosotros}:')
        changes.append(f'"Por este medio, yo" → "Por este medio, {nosotros}:"')

        # Agregar loop después de {dpiTexto}
        # El XML fragmenta: {dpiTexto}</w:t>...</w:r>...<w:t>, atentamente
        if is_female:
            loop_solicitud = (
                r'\1{#deudoresAdicionales} y {nombreCompleto}, identificada con DPI {dpiTexto}{/deudoresAdicionales}\2'
            )
        else:
            loop_solicitud = (
                r'\1{#deudoresAdicionales} y {nombreCompleto}, identificado con DPI {dpiTexto}{/deudoresAdicionales}\2'
            )
        solicitud_pattern = r'(\{dpiTexto\})(</w:t>.*?, atentamente)'
        xml = re.sub(solicitud_pattern, loop_solicitud, xml, count=1, flags=re.DOTALL)
        changes.append('Agregado loop deudoresAdicionales (nombreCompleto y dpiTexto)')
        loop_added = True

    # ==== REEMPLAZOS PARA PAGARE_UNICO_LIBRE_PROTESTO ====
    if 'PAGARE UNICO LIBRE DE PROTESTO' in xml:
        # "Yo:" → "Nosotros:/Nosotras:"
        xml = xml.replace('>Yo:<', f'>{nosotros}:<')
        xml = xml.replace('>Yo: <', f'>{nosotros}: <')
        changes.append(f'"Yo:" → "{nosotros}:"')

        # Pronombres singulares a plurales
        xml = xml.replace('me identifico', 'nos identificamos')
        xml = xml.replace('de mi domicilio', 'de nuestro domicilio')
        xml = xml.replace('fuero de mi domicilio', 'fuero de nuestro domicilio')
        xml = xml.replace('de mi persona', 'de nuestras personas')
        xml = xml.replace('yo, el avalista', f'{nosotros.lower()}, los avalistas')
        xml = xml.replace('yo asumo', f'{nosotros.lower()} asumimos')
        changes.append('Pronombres singulares → plurales')

        # Agregar loop después del primer "–RENAP-, República de Guatemala, Centroamérica;"
        # Buscar: Centroamérica; con dirección
        if is_female:
            loop_pagare = (
                r'\1{#deudoresAdicionales} Y {nombreCompleto}, de {edadTexto} años de edad, {estadoCivil}, '
                r'{profesion}, {nacionalidad}, de este domicilio, nos identificamos con Documento Personal de Identificación, '
                r'Código Único de Identificación {dpiTexto}, extendido por el Registro Nacional de las Personas '
                r'–RENAP-, República de Guatemala, Centroamérica;{/deudoresAdicionales}\2'
            )
        else:
            loop_pagare = (
                r'\1{#deudoresAdicionales} Y {nombreCompleto}, de {edadTexto} años de edad, {estadoCivil}, '
                r'{profesion}, {nacionalidad}, de este domicilio, nos identificamos con Documento Personal de Identificación, '
                r'Código Único de Identificación {dpiTexto}, extendido por el Registro Nacional de las Personas '
                r'–RENAP-, República de Guatemala, Centroamérica;{/deudoresAdicionales}\2'
            )
        # Capturar "Centroamérica;" y todo hasta "con dirección"
        pagare_pattern = r'(–RENAP-, República de Guatemala, Centroamérica;)(.*?con dirección)'
        xml = re.sub(pagare_pattern, loop_pagare, xml, count=1, flags=re.DOTALL)
        changes.append('Agregado loop deudoresAdicionales completo')
        loop_added = True

    # ==== REEMPLAZOS SIMPLES PARA CONTRATO_PRIVADO_USO (solo texto plano) ====
    if 'CONTRATO DE USO DE BIEN MUEBLE' in xml:
        # Cambiar señor/señora a plural PRIMERO
        if is_female:
            xml = xml.replace('a la señora', 'a las señoras')
            xml = xml.replace('la señora', 'las señoras')
            xml = xml.replace('La señora', 'Las señoras')
            xml = xml.replace('por la señora', 'por las señoras')
            changes.append('"señora" → "señoras"')
        else:
            xml = xml.replace('al señor', 'a los señores')
            xml = xml.replace('el señor', 'los señores')
            xml = xml.replace('El señor', 'Los señores')
            xml = xml.replace('por el señor', 'por los señores')
            changes.append('"señor" → "señores"')

        # Agregar loop de nombres después de cada {nombreCompleto}
        loop_suffix = '{#deudoresAdicionales} y {nombreCompleto}{/deudoresAdicionales}'

        # Pasada 1: {nombreCompleto} fragmentado en XML
        # <w:t>{</w:t>...<w:t>nombreCompleto</w:t>...<w:t>}</w:t></w:r>
        nombre_frag_pattern = r'(<w:t>\{</w:t>.*?<w:t>nombreCompleto</w:t>.*?<w:t>\}[^<]*</w:t></w:r>)'
        xml = re.sub(nombre_frag_pattern, r'\1' + loop_suffix, xml, flags=re.DOTALL)

        # Pasada 2: {nombreCompleto} completo en un solo tag (no fragmentado)
        # Solo reemplazar si NO está ya seguido por el loop
        nombre_completo_pattern = r'(\{nombreCompleto\})(?!\{#deudoresAdicionales\})'
        xml = re.sub(nombre_completo_pattern, r'\1' + loop_suffix, xml)

        changes.append('Agregado loop de nombres adicionales en cada {nombreCompleto}')

    # ==== AGREGAR LOOP PARA DEUDORES ADICIONALES (GENÉRICO) ====
    # Solo si no se agregó un loop específico antes
    # Los campos del deudor adicional son:
    # - nombreCompleto, dpi, dpiTexto, edadTexto, estadoCivil, profesion, nacionalidad, correoElectronico
    # No todos los contratos usan todos los campos, docxtemplater ignorará los que no estén en la plantilla
    renap_pattern = '–RENAP-, República de Guatemala, Centroamérica'

    if renap_pattern in xml and not loop_added:
        if is_female:
            deudor_adicional_block = (
                '{#deudoresAdicionales} y {nombreCompleto}, de {edadTexto} años de edad, {estadoCivil}, '
                '{profesion}, {nacionalidad}, identificada con Documento Personal de Identificación, '
                'Código Único de Identificación {dpiTexto}, extendido por el Registro Nacional de las Personas '
                '–RENAP-, República de Guatemala, Centroamérica{/deudoresAdicionales}'
            )
        else:
            deudor_adicional_block = (
                '{#deudoresAdicionales} y {nombreCompleto}, de {edadTexto} años de edad, {estadoCivil}, '
                '{profesion}, {nacionalidad}, identificado con Documento Personal de Identificación, '
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

    # Filtrar por carpeta si se especifica como argumento
    folder_filter = sys.argv[1] if len(sys.argv) > 1 else None
    if folder_filter:
        print(f"\n⚡ Procesando solo: {folder_filter}")

    total_processed = 0
    total_success = 0

    for template_config in TEMPLATES_TO_PROCESS:
        folder = template_config['folder']
        templates = template_config['templates']

        # Saltar si no coincide con el filtro
        if folder_filter and folder != folder_filter:
            continue

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
