import zipfile
from pathlib import Path

input_docx = Path('templates/contrato_uso_carro_usado.docx')

with zipfile.ZipFile(input_docx, 'r') as zip_ref:
    xml = zip_ref.read('word/document.xml').decode('utf-8')

# Corregir Marca (fue reemplazada con seats por error)
xml = xml.replace('{vehicle_seats}; </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Color:', '{vehicle_brand}; </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Color:')

# Agregar Asientos que faltó
xml = xml.replace('Asientos: </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">_____; ',
                  'Asientos: </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">{vehicle_seats}; ')

# Reemplazar nombres faltantes en cláusulas b) y d)
xml = xml.replace('<w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">_________________</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:commentReference w:id="3"/></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">,</w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve"> se compromete',
                '<w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">{user_name_clause_b}</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:commentReference w:id="3"/></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">,</w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve"> se compromete')

xml = xml.replace('<w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">___________________</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:commentReference w:id="4"/></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">, </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">renuncia',
                '<w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">{user_name_clause_d}</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:commentReference w:id="4"/></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:b w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">, </w:t></w:r><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">renuncia')

print("✓ Corregido Marca")
print("✓ Agregado Asientos")
print("✓ Agregado user_name_clause_b")
print("✓ Agregado user_name_clause_d")

# Guardar
with zipfile.ZipFile(input_docx, 'w', zipfile.ZIP_DEFLATED) as zip_out:
    with zipfile.ZipFile(Path('templates/contrato_uso_carro_usado_ORIGINAL_BACKUP.docx'), 'r') as zip_in:
        for item in zip_in.infolist():
            if item.filename == 'word/document.xml':
                zip_out.writestr(item, xml.encode('utf-8'))
            else:
                zip_out.writestr(item, zip_in.read(item.filename))

print("\n✅ Template corregido y guardado")
