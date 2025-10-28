# Instrucciones para Preparar el Template DOCX

## ⚠️ IMPORTANTE: Convertir el DOCX en Template

El archivo `templates/contrato_uso_carro_usado.docx` necesita ser editado manualmente para convertir los campos con "_____" en marcadores de template.

### Paso a Paso:

1. **Abrir el archivo con Microsoft Word o LibreOffice Writer:**
   ```bash
   # En Linux con LibreOffice
   libreoffice templates/contrato_uso_carro_usado.docx

   # O en Windows/Mac con Word
   # Abrir manualmente el archivo
   ```

2. **Reemplazar cada campo "_____" con el marcador correspondiente:**

   Usa la función "Buscar y Reemplazar" (Ctrl+H) para hacer los reemplazos:

   | Texto Original | Reemplazar con | Campo Template |
   |---------------|----------------|----------------|
   | `el __________ de __________ del año dos mil __________` | → | `el {contract_day} de {contract_month} del año dos mil {contract_year}` |
   | `________________,` (primer cliente) | → | `{client_name},` |
   | `de ___________años de edad` | → | `de {client_age} años de edad` |
   | `________________________________` (DPI) | → | `{client_cui}` |
   | `Tipo: _____` | → | `Tipo: {vehicle_type}` |
   | `Marca: _____` | → | `Marca: {vehicle_brand}` |
   | `Color: ______` | → | `Color: {vehicle_color}` |
   | `Uso: ________` | → | `Uso: {vehicle_use}` |
   | `Chasis: _______________` | → | `Chasis: {vehicle_chassis}` |
   | `Combustible: ________` | → | `Combustible: {vehicle_fuel}` |
   | `Motor: ___________` | → | `Motor: {vehicle_motor}` |
   | `Serie: ____________` | → | `Serie: {vehicle_series}` |
   | `Línea o estilo: __________` | → | `Línea o estilo: {vehicle_line}` |
   | `Modelo: ___________` | → | `Modelo: {vehicle_model}` |
   | `Centímetros cúbicos: _______________` | → | `Centímetros cúbicos: {vehicle_cc}` |
   | `Asientos: _____` | → | `Asientos: {vehicle_seats}` |
   | `Cilindros: _________` | → | `Cilindros: {vehicle_cylinders}` |
   | `Código ISCV: ________` | → | `Código ISCV: {vehicle_iscv}` |
   | `_________________` (nombre usuario cláusula SEGUNDA) | → | `{user_name}` |
   | `_____________ meses` | → | `{contract_duration_months} meses` |
   | `contados a partir del _______________________________________________` | → | `contados a partir del {contract_start_date}` |
   | `______ de _______ del año dos mil _______` (fin) | → | `{contract_end_day} de {contract_end_month} del año dos mil {contract_end_year}` |
   | `___________________________________________________________` (dirección) | → | `{client_address}` |

3. **Campos de nombre repetidos:**

   El nombre del usuario aparece varias veces. Usa estos marcadores según la ubicación:
   - Primera aparición en SEGUNDA: `{user_name}`
   - En cláusula a): `{user_name_clause_a}`
   - Segunda vez en a): `{user_name_clause_a2}`
   - En cláusula b): `{user_name_clause_b}`
   - En cláusula d): `{user_name_clause_d}`
   - En CUARTA cláusula: `{user_name_final}`

4. **Guardar el archivo:**
   - Guarda como `.docx` (NO como .doc antiguo)
   - Asegúrate de mantener todo el formato (negritas, subrayados, márgenes, etc.)

5. **Verificar:**
   - Abre el archivo nuevamente
   - Confirma que todos los marcadores `{campo}` estén correctos
   - Verifica que no haya espacios extra alrededor de los marcadores

### Ejemplo de cómo debe verse:

**ANTES:**
```
En la ciudad de Guatemala departamento de Guatemala, el __________ de __________
del año dos mil __________, comparecemos:
```

**DESPUÉS:**
```
En la ciudad de Guatemala departamento de Guatemala, el {contract_day} de {contract_month}
del año dos mil {contract_year}, comparecemos:
```

### Lista Completa de Campos (para referencia):

```javascript
{
  contract_day,
  contract_month,
  contract_year,
  client_name,
  client_age,
  client_cui,
  vehicle_type,
  vehicle_brand,
  vehicle_color,
  vehicle_use,
  vehicle_chassis,
  vehicle_fuel,
  vehicle_motor,
  vehicle_series,
  vehicle_line,
  vehicle_model,
  vehicle_cc,
  vehicle_seats,
  vehicle_cylinders,
  vehicle_iscv,
  user_name,
  contract_duration_months,
  contract_start_date,
  contract_end_day,
  contract_end_month,
  contract_end_year,
  user_name_clause_a,
  user_name_clause_a2,
  user_name_clause_b,
  user_name_clause_d,
  client_address,
  user_name_final
}
```

### Notas Importantes:

- ✅ **SÍ** usar llaves `{campo}`
- ❌ **NO** usar `{{campo}}` (doble llave)
- ❌ **NO** usar `$campo` o `%campo%`
- ✅ Mantener el formato original (negritas, fuentes, etc.)
- ✅ Los marcadores pueden estar dentro de texto con formato
- ✅ Puedes tener múltiples marcadores en un mismo párrafo

### Testing:

Una vez convertido el template, prueba con:
```bash
bun run dev
```

Y haz una petición POST a `/generatecontrato` con datos de prueba.
