# 🚀 Quick Start - Sistema de Contratos

## Paso 1: Iniciar Docker (Gotenberg)
```bash
bun run docker:up
```

## Paso 2: Convertir Template DOCX

⚠️ **MUY IMPORTANTE:** Debes editar manualmente el template DOCX antes de poder generar contratos.

1. Abre el archivo:
   ```bash
   libreoffice templates/contrato_uso_carro_usado.docx
   # O con Word si estás en Windows/Mac
   ```

2. Reemplaza cada `_____` con `{nombre_campo}`:
   - `el __________ de __________` → `el {contract_day} de {contract_month}`
   - `________________,` → `{client_name},`
   - `Marca: _____` → `Marca: {vehicle_brand}`
   - etc.

3. **Lee las instrucciones completas en:** `INSTRUCCIONES_TEMPLATE.md`

4. Guarda el archivo como `.docx`

## Paso 3: Iniciar el servidor
```bash
bun run dev
```

## Paso 4: Probar
```bash
# En otra terminal
bun run test
```

O usa cURL:
```bash
curl http://localhost:4000/contracts/types
```

## Paso 5: Generar tu primer contrato

```bash
curl -X POST http://localhost:4000/generatecontrato \
  -H "Content-Type: application/json" \
  -d '{
    "contractType": "uso_carro_usado",
    "data": {
      "contract_day": "28",
      "contract_month": "octubre",
      "contract_year": "veinticinco",
      "client_name": "JUAN PÉREZ",
      "client_age": "treinta y dos",
      "client_cui": "1234 56789 0123",
      "vehicle_type": "Automóvil",
      "vehicle_brand": "Toyota",
      "vehicle_model": "2020",
      "vehicle_color": "Blanco",
      "vehicle_use": "Particular",
      "vehicle_chassis": "ABC123",
      "vehicle_fuel": "Gasolina",
      "vehicle_motor": "MOT123",
      "vehicle_series": "COROLLA",
      "vehicle_line": "Corolla GLI",
      "vehicle_cc": "1800",
      "vehicle_seats": "5",
      "vehicle_cylinders": "4",
      "vehicle_iscv": "ISCV001",
      "user_name": "JUAN PÉREZ",
      "contract_duration_months": "doce",
      "contract_start_date": "primero de noviembre del dos mil veinticinco",
      "contract_end_day": "31",
      "contract_end_month": "octubre",
      "contract_end_year": "veintiséis",
      "user_name_clause_a": "JUAN PÉREZ",
      "user_name_clause_a2": "JUAN PÉREZ",
      "user_name_clause_b": "JUAN PÉREZ",
      "user_name_clause_d": "JUAN PÉREZ",
      "user_name_final": "JUAN PÉREZ",
      "client_address": "15 Avenida 10-25 Zona 10"
    }
  }'
```

## 📂 Revisa los archivos generados

Los contratos generados estarán en: `output/`

## 🎯 Próximos Pasos

1. **Integración con DocuSeal:** Una vez tengas el PDF generado, puedes subirlo a DocuSeal para firmas
2. **Agregar más contratos:** Lee la sección en `README.md` sobre cómo agregar nuevos tipos
3. **Personalización:** Modifica las interfaces en `types/contract.ts` según necesites

## 📖 Documentación Completa

- `README.md` - Documentación completa
- `INSTRUCCIONES_TEMPLATE.md` - Guía para preparar templates DOCX
- `types/contract.ts` - Interfaces TypeScript con todos los campos

## ❓ Troubleshooting

### El template no genera correctamente
- Verifica que usaste `{campo}` y no `{{campo}}` o `$campo`
- Asegúrate de no tener espacios: `{campo}` ✅ vs `{ campo }` ❌

### No se genera el PDF
```bash
# Verifica que Gotenberg esté corriendo
docker ps

# Debería aparecer "gotenberg-pdf-converter"
```

### Puerto 4000 ocupado
```bash
PORT=5000 bun run dev
```

---

¡Listo! 🎉 Ya tienes un sistema completo y escalable de generación de contratos.
