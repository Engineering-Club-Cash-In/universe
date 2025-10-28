# Guía de Género Dinámico en Plantillas de Contratos

Esta guía documenta cómo el sistema maneja términos de género en documentos legales y cómo preparar nuevas plantillas para que sean compatibles con género dinámico.

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Términos que Varían por Género](#términos-que-varían-por-género)
3. [Proceso para Nuevas Plantillas](#proceso-para-nuevas-plantillas)
4. [Uso del Sistema](#uso-del-sistema)
5. [Referencias Rápidas](#referencias-rápidas)

---

## Introducción

El sistema de generación de contratos soporta género dinámico, lo que significa que los documentos se adaptan automáticamente al género del cliente, cambiando términos como "señor/señora", "obligado/obligada", "guatemalteco/guatemalteca", etc.

### Beneficios

- ✅ **Inclusivo**: Genera contratos apropiados para todos los géneros
- ✅ **Automático**: Solo requiere especificar el género una vez
- ✅ **Correcto legalmente**: Usa la terminología legal apropiada
- ✅ **Reutilizable**: Proceso documentado para futuras plantillas

---

## Términos que Varían por Género

### 1. Tratamiento Formal

| Masculino | Femenino | Variable |
|-----------|----------|----------|
| el señor | la señora | `{title_article}` |
| al señor | a la señora | `{title_with_article}` |
| señor | señora | `{title}` |

**Ejemplos en contexto:**
- "dará en USO **{title_with_article}** Juan López" → "al señor" / "a la señora"
- "será utilizado por **{title_article}** María García" → "el señor" / "la señora"

### 2. Estado Civil

| Masculino | Femenino | Valor JSON |
|-----------|----------|------------|
| soltero | soltera | `'single'` |
| casado | casada | `'married'` |
| viudo | viuda | `'widowed'` |
| divorciado | divorciada | `'divorced'` |

**Variable en template:** `{client_marital_status_gendered}`

**JSON de entrada:**
```json
{
  "client_gender": "female",
  "client_marital_status": "married"
}
```

El sistema traducirá automáticamente `"married"` → `"casada"` (para género femenino).

### 3. Nacionalidad/Gentilicios

Para gentilicios que terminan en -o/-a:

| Masculino | Femenino |
|-----------|----------|
| guatemalteco | guatemalteca |
| mexicano | mexicana |
| salvadoreño | salvadoreña |
| hondureño | hondureña |

**Variable en template:** `{client_nationality_gendered}`

**JSON de entrada:**
```json
{
  "client_gender": "male",
  "client_nationality": "guatemalteco"
}
```

### 4. Sustantivos con Género

| Masculino | Femenino | Variable |
|-----------|----------|----------|
| el usuario | la usuaria | `{user_noun}` |
| al usuario | a la usuaria | `{to_user}` |

**Ejemplos:**
- "Queda prohibido **{to_user}** dar uso diferente"
- "**{user_noun}** responderá de cualquier daño"

### 5. Participios y Adjetivos

| Masculino | Femenino | Variable |
|-----------|----------|----------|
| obligado | obligada | `{obligated}` |
| directo | directa | `{direct}` |

**Ejemplos:**
- "quedará **{obligated}** al pago de impuestos"
- "siendo responsable **{direct}** del uso"

### 6. Plurales Mixtos

Cuando el contrato menciona a ambas partes (típicamente dos personas de diferente género):

| Masculino | Femenino | Variable |
|-----------|----------|----------|
| enterados | enteradas | `{informed_plural}` |

**Nota:** Si ambas partes son del mismo género, usa el género correspondiente.

### 7. Pronombres

| Masculino | Femenino | Variable |
|-----------|----------|----------|
| al mismo | a la misma | `{to_same}` |
| del mismo | de la misma | `{of_same}` |

**Ejemplos:**
- "responsable de cualquier daño a tercero, **{to_same}**, y a su vínculo familiar"
- "como depositario **{of_same}**"

---

## Proceso para Nuevas Plantillas

### Paso 1: Identificar Términos de Género

Revisa el documento DOCX y marca todos los términos que varían por género:

**Checklist de búsqueda:**
- [ ] "el señor" / "al señor"
- [ ] "soltero" / "casado" / "viudo" / "divorciado"
- [ ] Gentilicios (terminados en -o)
- [ ] Profesiones/títulos ("Licenciado", "Doctor", "Ingeniero")
- [ ] "el usuario" / "al usuario"
- [ ] Participios: "obligado", "comprometido", "autorizado"
- [ ] Adjetivos: "directo", "responsable"
- [ ] Pronombres: "al mismo", "del mismo"
- [ ] Plurales: "enterados"

**Herramienta:** Usa el comando `unzip -p template.docx word/document.xml | grep -E 'señor|obligado|directo|usuario'` para buscar términos.

### Paso 2: Crear Lista de Reemplazos

Documenta cada término encontrado con:
1. **Ubicación:** ¿En qué cláusula/sección aparece?
2. **Contexto:** Las palabras alrededor para identificar la instancia correcta
3. **Frecuencia:** ¿Cuántas veces aparece?
4. **Variable target:** ¿Qué variable de GenderTranslator usar?

**Ejemplo:**
```markdown
- "dará en USO al señor" → `{title_with_article}` (1 vez, Cláusula SEGUNDA)
- "soltero, comerciante" → `{client_marital_status_gendered}, {client_occupation}` (1 vez, Introducción cliente)
- "el usuario responderá" → `{user_noun} responderá` (8+ veces, múltiples cláusulas)
```

### Paso 3: Modificar Script Python

Usa el script base `scripts/prepare-gender-template.py` como referencia y adapta los reemplazos:

```python
# Ejemplo de reemplazo
if 'tu contexto específico' in xml:
    xml = xml.replace(
        '>texto original',
        '>{variable_de_genero}'
    )
    changes.append('Descripción del cambio')
```

**Importante:**
- Preserva la estructura XML (`>texto<`)
- Usa contexto suficiente para identificar la instancia correcta
- No reemplaces términos que no se refieren al cliente (ej: nombres de la empresa)

### Paso 4: Ejecutar Script y Verificar

```bash
# Ejecutar script de preparación
python3 scripts/prepare-gender-template.py

# Verificar variables en el template
unzip -p templates/tu_template.docx word/document.xml | grep -o '{[^}]*}' | sort -u

# Buscar términos que no fueron reemplazados
unzip -p templates/tu_template.docx word/document.xml | grep -c 'señor\|obligado\|usuario'
```

### Paso 5: Actualizar TypeScript

Si tu contrato tiene campos específicos adicionales, actualiza:

1. **types/contract.ts**: Agrega interface con campos de género:
```typescript
export interface TuContratoData extends BaseContractData {
  client_gender: Gender;
  client_marital_status: MaritalStatus;
  client_occupation: string;
  client_nationality: string;
  client_degree?: string; // Opcional
  // ... otros campos
}
```

2. **services/ContractGeneratorService.ts**: Si necesitas lógica especial, modifica `prepareDataWithGender()`.

### Paso 6: Crear Tests

Crea casos de prueba para ambos géneros en `test-contract.ts`:

```typescript
const testDataMale = {
  contractType: ContractType.TU_CONTRATO,
  data: {
    client_gender: 'male',
    client_marital_status: 'single',
    client_occupation: 'comerciante',
    client_nationality: 'guatemalteco',
    // ... otros campos
  }
};

const testDataFemale = {
  // ... caso femenino
};
```

---

## Uso del Sistema

### Generar Contrato Masculino

```json
{
  "contractType": "uso_carro_usado",
  "data": {
    "client_gender": "male",
    "client_marital_status": "single",
    "client_occupation": "comerciante",
    "client_nationality": "guatemalteco",
    "client_degree": "Licenciado en Administración",
    "client_name": "JUAN PÉREZ",
    // ... otros campos
  },
  "options": {
    "generatePdf": true
  }
}
```

### Generar Contrato Femenino

```json
{
  "contractType": "uso_carro_usado",
  "data": {
    "client_gender": "female",
    "client_marital_status": "married",
    "client_occupation": "ingeniera",
    "client_nationality": "guatemalteca",
    "client_degree": "Ingeniera Civil",
    "client_name": "MARÍA LÓPEZ",
    // ... otros campos
  },
  "options": {
    "generatePdf": true
  }
}
```

### Campos Requeridos de Género

Para que el sistema aplique traducción de género, el JSON debe incluir:

- ✅ `client_gender`: `'male'` o `'female'`
- ✅ `client_marital_status`: `'single'`, `'married'`, `'widowed'`, o `'divorced'`
- ✅ `client_nationality`: Gentilicio base (ej: `'guatemalteco'`, `'mexicano'`)
- ⚪ `client_occupation`: Profesión/ocupación
- ⚪ `client_degree`: Título académico (opcional, ya en género correcto)

---

## Referencias Rápidas

### Comandos Útiles

```bash
# Ver todas las variables en un template
unzip -p templates/template.docx word/document.xml | grep -o '{[^}]*}' | sort -u

# Buscar un término específico
unzip -p templates/template.docx word/document.xml | grep -o '.{50}señor.{50}'

# Contar ocurrencias de términos de género
unzip -p templates/template.docx word/document.xml | grep -c 'señor\|obligado\|usuario'

# Ver contexto de un término en el DOCX generado
unzip -p output/contrato.docx word/document.xml | grep -o '<w:t[^>]*>[^<]*señora[^<]*</w:t>'
```

### Valores Válidos

**Género:**
- `'male'` - Masculino
- `'female'` - Femenino

**Estado Civil (valores JSON):**
- `'single'` - Soltero/a
- `'married'` - Casado/a
- `'widowed'` - Viudo/a
- `'divorced'` - Divorciado/a

### Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `services/GenderTranslator.ts` | Lógica de traducción de género |
| `types/contract.ts` | Interfaces TypeScript con campos de género |
| `services/ContractGeneratorService.ts` | Integración de género en generación |
| `scripts/prepare-gender-template.py` | Script para preparar templates DOCX |
| `test-contract.ts` | Tests de ambos géneros |

---

## Troubleshooting

### ❌ Error: "Género inválido"

**Causa:** El valor de `client_gender` no es `'male'` o `'female'`.

**Solución:** Verifica que el JSON use los valores exactos (en minúsculas):
```json
{ "client_gender": "female" }  // ✅ Correcto
{ "client_gender": "Female" }  // ❌ Incorrecto (mayúscula)
{ "client_gender": "F" }       // ❌ Incorrecto (abreviado)
```

### ❌ Error: "Estado civil inválido"

**Causa:** El valor de `client_marital_status` no es válido.

**Solución:** Usa uno de los 4 valores permitidos:
- `'single'`, `'married'`, `'widowed'`, `'divorced'`

### ⚠️ Advertencia: "Contrato sin campos de género"

**Causa:** Faltan campos `client_gender`, `client_marital_status`, o `client_nationality`.

**Impacto:** El contrato se generará, pero usará términos genéricos (sin adaptación de género).

**Solución:** Agrega los campos faltantes al JSON de entrada.

### ❌ Términos no fueron reemplazados en el template

**Causa:** El script Python no encontró el patrón exacto en el XML.

**Diagnóstico:**
```bash
# Ver el XML alrededor del término
unzip -p templates/template.docx word/document.xml | grep -A2 -B2 'término'
```

**Solución:** Ajusta el script Python para usar el contexto exacto que aparece en el XML, incluyendo las etiquetas XML (`>término<`).

---

## Ejemplos Completos

### Ejemplo 1: Contrato Masculino Soltero

```bash
curl -X POST http://localhost:4000/generatecontrato \
  -H "Content-Type: application/json" \
  -d '{
    "contractType": "uso_carro_usado",
    "data": {
      "client_gender": "male",
      "client_marital_status": "single",
      "client_occupation": "comerciante",
      "client_nationality": "guatemalteco",
      "client_name": "PEDRO MARTÍNEZ",
      ...
    }
  }'
```

**Resultado:** "al señor PEDRO MARTÍNEZ, soltero, comerciante, guatemalteco"

### Ejemplo 2: Contrato Femenino Casada

```bash
curl -X POST http://localhost:4000/generatecontrato \
  -H "Content-Type: application/json" \
  -d '{
    "contractType": "uso_carro_usado",
    "data": {
      "client_gender": "female",
      "client_marital_status": "married",
      "client_occupation": "doctora",
      "client_nationality": "salvadoreña",
      "client_degree": "Doctora en Medicina",
      "client_name": "ANA GONZÁLEZ",
      ...
    }
  }'
```

**Resultado:** "a la señora ANA GONZÁLEZ, casada, Doctora en Medicina, doctora, salvadoreña"

---

## Contribuyendo

Si encuentras términos de género adicionales que deben ser soportados:

1. Agrega el término a la sección "Términos que Varían por Género"
2. Actualiza `GenderTranslator.ts` si necesita una nueva variable
3. Documenta el uso con ejemplos
4. Crea un pull request o actualiza esta guía

---

**Última actualización:** Octubre 2025
**Versión:** 1.0
