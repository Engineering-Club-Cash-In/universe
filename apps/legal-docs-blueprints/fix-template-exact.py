#!/usr/bin/env python3
import zipfile
from pathlib import Path

input_docx = Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx')
output_docx = Path('templates/contrato_uso_carro_usado.docx')

with zipfile.ZipFile(input_docx, 'r') as zip_ref:
    xml = zip_ref.read('word/document.xml').decode('utf-8')

# Reemplazos exactos tal como aparecen en el XML
replacements = [
    # Fecha
    ('el __________ de __________ del año dos mil __________', 
     'el {contract_day} de {contract_month} del año dos mil {contract_year}'),
    
    # Cliente
    ('>________________,<', '>{client_name},<'),
    ('de ___________años', 'de {client_age} años'),
    ('>________________________________<', '>{client_cui}<'),
    
    # Vehículo
    (' _____; ', ' {vehicle_type}; '),
    ('> _____; <', '> {vehicle_brand}; <'),  # Marca tiene espacio antes
    (' ______; ', ' {vehicle_color}; '),
    (' ________; ', ' {vehicle_use}; '),
    (' _______________; ', ' {vehicle_chassis}; '),
    (' ________; ', ' {vehicle_fuel}; '),
    (' ___________; ', ' {vehicle_motor}; '),
    ('  ____________; ', ' {vehicle_series}; '),
    (' __________; ', ' {vehicle_line}; '),
    (' ___________; ', ' {vehicle_model}; '),
    (' _______________; ', ' {vehicle_cc}; '),
    ('>_____; <', '>{vehicle_seats}; <'),
    (' _________;<', ' {vehicle_cylinders};<'),
    ('>________. <', '>{vehicle_iscv}. <'),
    
    # Usuario y plazo  
    ('>_________________<', '>{user_name}<'),  # Primera aparición en SEGUNDA
    ('>_____________ meses<', '>{contract_duration_months} meses<'),
    ('contados a partir del _______________________________________________',
     'contados a partir del {contract_start_date}'),
    ('>______ de _______ del año dos mil _______<',
     '>{contract_end_day} de {contract_end_month} del año dos mil {contract_end_year}<'),
    
    # Nombres en cláusulas
    ('>_________________,<', '>{user_name_clause_a},<'),  # Cláusula a) primera
    ('>_______________<', '>{user_name_clause_a2}<'),  # Cláusula a) segunda (15 underscores!)
    # Estos ya los cubrimos arriba pero son instancias diferentes
    
    # Dirección
    ('>___________________________________________________________<', '>{client_address}<'),
    
    # Nombre final
    ('>______________________<', '>{user_name_final}<'),  # 22 underscores
]

# Hacer reemplazos uno por uno para evitar duplicados
modified = xml
count = 0
for old, new in replacements:
    if old in modified:
        modified = modified.replace(old, new, 1)  # Solo primera ocurrencia
        count += 1
        print(f"✓ {count}. {old[:40]}")

print(f"\n📊 Total: {count} reemplazos")

# Guardar
with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as zip_out:
    with zipfile.ZipFile(input_docx, 'r') as zip_in:
        for item in zip_in.infolist():
            if item.filename == 'word/document.xml':
                zip_out.writestr(item, modified.encode('utf-8'))
            else:
                zip_out.writestr(item, zip_in.read(item.filename))

print(f"\n✅ Guardado en: {output_docx}")
