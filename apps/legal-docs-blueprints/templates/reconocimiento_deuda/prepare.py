#!/usr/bin/env python3
"""
Script DEFINITIVO para convertir templates DOCX.
Patrones corregidos basados en el XML real del documento.
"""

import zipfile
import re
from pathlib import Path

def replace_with_regex(xml_content):
    """Hace reemplazos usando expresiones regulares específicas."""
    
    modified = xml_content
    replacements = []
    
    def do_replace(pattern, replacement, description):
        nonlocal modified
        count = len(re.findall(pattern, modified, re.DOTALL))
        if count > 0:
            modified = re.sub(pattern, replacement, modified, flags=re.DOTALL)
            replacements.append(f"✓ [{count}x] {description}")
            return True
        else:
            replacements.append(f"✗ [0x] {description}")
            return False
    
    # === FECHA INICIAL ===
    do_replace(
        r'el _________ de ________del año dos mil __________',
        r'el {diaTexto} de {mesTexto} del año dos mil {anoTexto}',
        'Fecha inicial del contrato'
    )
    
    # === NOMBRE REPRESENTANTE ===
    do_replace(
        r'(<w:b w:val="1"/>.*?<w:t[^>]*>)__________,',
        r'\1{nombreRepresentanteLegal},',
        'Nombre del representante legal'
    )
    
    # === EDAD REPRESENTANTE ===
    do_replace(
        r' de __________ años de edad, casado',
        r' de {edadRepresentante} años de edad, casado',
        'Edad del representante'
    )
    
    # === DPI REPRESENTANTE ===
    do_replace(
        r'Código Único de Identificación __________________________, ',
        r'Código Único de Identificación {dpiRepresentante}, ',
        'DPI del representante'
    )
    
    # === DATOS DEL DEUDOR ===
    do_replace(
        r' de ________________ años de edad,',
        r' de {edadDeudor} años de edad,',
        'Edad del deudor'
    )
    
    do_replace(
        r'años de edad, __________________, _____________, ______________,',
        r'años de edad, {estadoCivilDeudor}, {profesionDeudor}, {nacionalidadDeudor},',
        'Estado civil, profesión y nacionalidad'
    )
    
    do_replace(
        r'(Código Único de Identificación </w:t>.*?<w:t[^>]*>)________________________',
        r'\1{dpiDeudor}',
        'DPI del deudor'
    )
    
    # === CLÁUSULA PRIMERA ===
    # El "Yo," viene en un bloque posterior, buscar el nombre
    do_replace(
        r'(PRIMERA:.*?Yo,\s*<.*?<w:t[^>]*>)_________________________,',
        r'\1{nombreDeudor},',
        'Nombre en PRIMERA'
    )
    
    # Monto del capital - tiene un espacio antes del campo
    do_replace(
        r'(por el monto de</w:t>.*?<w:t xml:space="preserve"> </w:t>.*?<w:t[^>]*>)_________________________\s*\(en adelante',
        r'\1{montoCapital} (en adelante',
        'Monto del capital adeudado'
    )
    
    # === CLÁUSULA SEGUNDA ===
    do_replace(
        r'(SEGUNDO:.*?Yo,\s*<.*?<w:t[^>]*>)____________________________,',
        r'\1{nombreDeudor},',
        'Nombre en SEGUNDO'
    )
    
    # Plazo - viene después de texto largo
    do_replace(
        r'(obligación será de</w:t>.*?<w:t[^>]*>)_____________\s*MESES',
        r'\1{plazoMeses} MESES',
        'Plazo en meses'
    )
    
    do_replace(
        r'(contados a partir del\s*</w:t>.*?<w:t[^>]*>)___________',
        r'\1{fechaInicio}',
        'Fecha de inicio'
    )
    
    # Fecha de vencimiento - los guiones tienen espacios
    do_replace(
        r'(vencerá el\s*</w:t>.*?<w:t[^>]*>)_________\s+(</w:r>.*?<w:t[^>]*>)de\s+______\s+(</w:r>.*?<w:t[^>]*>)del año dos mil\s+________',
        r'\1{diaVencimiento} \2de {mesVencimiento} \3del año dos mil {anoVencimiento}',
        'Fecha de vencimiento'
    )
    
    # Número de cuotas
    do_replace(
        r'(en\s*</w:t>.*?<w:t[^>]*>)_________\s+cuotas mensuales',
        r'\1{numeroCuotas} cuotas mensuales',
        'Número de cuotas'
    )
    
    # Monto de cuota - 19 guiones bajos
    do_replace(
        r'(cuotas mensuales de\s*</w:t>.*?<w:t[^>]*>)___________________\s*cada una',
        r'\1{montoCuota} cada una',
        'Monto de cada cuota'
    )
    
    # Día de pago
    do_replace(
        r'(el\s*</w:t>.*?<w:t[^>]*>)_________\s+de cada mes calendario',
        r'\1{diaPago} de cada mes calendario',
        'Día de pago mensual'
    )
    
    # Fecha del contrato de servicios
    do_replace(
        r'(ha celebrado el</w:t>.*?<w:t[^>]*>)\s*_________\s+(</w:r>.*?<w:t[^>]*>)de\s+______\s+(</w:r>.*?<w:t[^>]*>)del año dos mil\s+_______',
        r'\1 {diaContratoServicios} \2de {mesContratoServicios} \3del año dos mil {anoContratoServicios}',
        'Fecha del contrato de servicios'
    )
    
    # Porcentaje de interés - 7 guiones bajos y __ en paréntesis
    do_replace(
        r'(devengara el\s*</w:t>.*?<w:t[^>]*>)_______\s*por ciento\s*\(__\%\)',
        r'\1{porcentajeInteres} por ciento ({porcentajeInteres}%)',
        'Porcentaje de interés'
    )
    
    # Porcentaje moratorio - 8 guiones bajos con espacios y __ en paréntesis
    do_replace(
        r'(pagará el\s*</w:t>.*?<w:t[^>]*>)________\s*por ciento\s*\(__\%\)',
        r'\1{porcentajeMoratorio} por ciento ({porcentajeMoratorio}%)',
        'Porcentaje moratorio'
    )
    
    # Dirección - 78 guiones bajos
    do_replace(
        r'(en la\s*</w:t>.*?<w:t[^>]*>)__________________________________________________________________________\s*dando como válidas',
        r'\1{direccionNotificaciones} dando como válidas',
        'Dirección para notificaciones'
    )
    
    # === CLÁUSULA TERCERA ===
    do_replace(
        r'(TERCERA:.*?GARANTIA:.*?Yo,\s*<.*?<w:t[^>]*>)____________________________________,',
        r'\1{nombreDeudor},',
        'Nombre en TERCERA'
    )
    
    # === DATOS DEL VEHÍCULO ===
    # Los campos del vehículo tienen formato específico
    vehicle_patterns = [
        (r'(Tipo:\s*</w:t>.*?<w:t[^>]*>)\s*_____;\s*', r'\1 {tipoVehiculo}; ', 'Tipo'),
        (r'(Marca:\s*</w:t>.*?<w:t[^>]*>)\s*_____;\s*', r'\1 {marcaVehiculo}; ', 'Marca'),
        (r'(Color:\s*</w:t>.*?<w:t[^>]*>)\s*______;\s*', r'\1 {colorVehiculo}; ', 'Color'),
        (r'(Uso:\s*</w:t>.*?<w:t[^>]*>)\s*________;\s*', r'\1 {usoVehiculo}; ', 'Uso'),
        (r'(Chasis:\s*</w:t>.*?<w:t[^>]*>)\s*_______________;\s*', r'\1 {chasisVehiculo}; ', 'Chasis'),
        (r'(Combustible:\s*</w:t>.*?<w:t[^>]*>)\s*________;\s*', r'\1 {combustibleVehiculo}; ', 'Combustible'),
        (r'(Motor:\s*</w:t>.*?<w:t[^>]*>)\s*___________;\s*', r'\1 {motorVehiculo}; ', 'Motor'),
        (r'(Serie:\s*</w:t>.*?<w:t[^>]*>)\s*____________;\s*', r'\1 {serieVehiculo}; ', 'Serie'),
        (r'(Línea o estilo:\s*</w:t>.*?<w:t[^>]*>)\s*__________;\s*', r'\1 {lineaVehiculo}; ', 'Línea o estilo'),
        (r'(Modelo:\s*</w:t>.*?<w:t[^>]*>)\s*___________;\s*', r'\1 {modeloVehiculo}; ', 'Modelo'),
        (r'(Centímetros cúbicos:\s*</w:t>.*?<w:t[^>]*>)\s*_______________;\s*', r'\1 {cm3Vehiculo}; ', 'Centímetros cúbicos'),
        (r'(Asientos:\s*</w:t>.*?<w:t[^>]*>)_____;\s*', r'\1 {asientosVehiculo}; ', 'Asientos'),
        (r'(Cilindros:\s*</w:t>.*?<w:t[^>]*>)\s*_________;\s*', r'\1 {cilindrosVehiculo}; ', 'Cilindros'),
        # ISCV no tiene punto y coma al final
        (r'(Código ISCV:\s*</w:t>.*?<w:t[^>]*>)________', r'\1{iscvVehiculo}', 'Código ISCV'),
    ]
    
    for pattern, replacement, label in vehicle_patterns:
        do_replace(pattern, replacement, f'Vehículo: {label}')
    
    # === CLÁUSULA CUARTA ===
    do_replace(
        r'(CUARTA:.*?Yo,\s*<.*?<w:t[^>]*>)_________,',
        r'\1{nombreAcreedor},',
        'Nombre en CUARTA'
    )
    
    # === CLÁUSULA QUINTA ===
    # 13 guiones bajos
    do_replace(
        r'(Nosotros:\s*</w:t>.*?<w:t[^>]*>)_____________\s*y',
        r'\1{nombreAcreedor} y',
        'Primer nombre en QUINTA'
    )
    
    # 17 guiones bajos
    do_replace(
        r'(<w:t[^>]*>)_________________\s*aceptamos',
        r'\1{nombreDeudor} aceptamos',
        'Segundo nombre en QUINTA'
    )
    
    return modified, replacements

def main():
    """Función principal."""
    input_docx = Path('templates/reconocimiento_deuda/8._RECONOCIMIENTO_DE_DEUDA-HOMBRE.docx')
    output_docx = Path('templates/reconocimiento_deuda/reconocimiento_deuda_template.docx')
    
    if not input_docx.exists():
        print(f"❌ Error: No se encontró {input_docx}")
        return
    
    print(f"\n📄 Procesando: {input_docx.name}")
    print("=" * 80)
    
    # Extraer XML
    with zipfile.ZipFile(input_docx, 'r') as zip_ref:
        xml_content = zip_ref.read('word/document.xml').decode('utf-8')
    
    print("🔄 Aplicando reemplazos con expresiones regulares...\n")
    modified_xml, replacements = replace_with_regex(xml_content)
    
    # Mostrar resultados
    success_count = sum(1 for r in replacements if r.startswith('✓'))
    total_count = len(replacements)
    percentage = (success_count / total_count * 100) if total_count > 0 else 0
    
    print(f"📊 Resultados: {success_count}/{total_count} ({percentage:.1f}%) reemplazos exitosos\n")
    print("=" * 80)
    
    for r in replacements:
        symbol = "✅" if r.startswith('✓') else "❌"
        print(f"{symbol} {r}")
    
    print("=" * 80)
    
    # Guardar
    print(f"\n💾 Guardando template...")
    
    with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as zip_out:
        with zipfile.ZipFile(input_docx, 'r') as zip_in:
            for item in zip_in.infolist():
                if item.filename == 'word/document.xml':
                    zip_out.writestr(item, modified_xml.encode('utf-8'))
                else:
                    zip_out.writestr(item, zip_in.read(item.filename))
    
    print(f"✅ Template guardado: {output_docx.name}\n")
    
    if success_count == total_count:
        print("🎉 ¡PERFECTO! Todos los reemplazos funcionaron!")
    elif percentage >= 80:
        print(f"✨ ¡MUY BIEN! {percentage:.1f}% de reemplazos exitosos")
        if success_count < total_count:
            print(f"   Faltan {total_count - success_count} patrones por ajustar")
    else:
        print(f"⚠️  Solo {percentage:.1f}% de reemplazos exitosos")
        print("   Revisa los patrones marcados con ❌")
    
    print()

if __name__ == '__main__':
    main()
