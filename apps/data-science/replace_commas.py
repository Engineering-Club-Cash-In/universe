import re

# Regex para detectar montos con "Q" y comas
money_regex = re.compile(r'Q\s?((?:\d{1,3},)*\d{1,3}\.\d{2})')

def reemplazar_montos(linea):
    return money_regex.sub(lambda m: m.group(1).replace(',', ''), linea)

input_file = 'big_data.csv'
output_file = 'big_data_limpio.csv'

with open(input_file, 'r', encoding='utf-8') as f_in, \
     open(output_file, 'w', encoding='utf-8') as f_out:
    for linea in f_in:
        nueva_linea = reemplazar_montos(linea)
        f_out.write(nueva_linea)

print(f'Archivo limpio guardado como {output_file}')
