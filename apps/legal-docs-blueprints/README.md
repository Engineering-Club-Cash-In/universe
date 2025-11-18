# 📄 Sistema de Generación de Contratos Legales

Sistema escalable para generar contratos legales desde templates DOCX con conversión automática a PDF.

## 🚀 Características

- ✅ **Multi-contrato:** Soporte para múltiples tipos de contratos extensibles
- ✅ **Template DOCX:** Usa Microsoft Word/LibreOffice para crear templates
- ✅ **Conversión PDF:** Conversión automática DOCX → PDF con formato exacto
- ✅ **Type-safe:** TypeScript con interfaces tipadas para cada contrato
- ✅ **API REST:** Endpoints simples para integración
- ✅ **Validación:** Validación automática de campos requeridos
- ✅ **Escalable:** Fácil agregar nuevos tipos de contratos

## 📋 Requisitos

- **Bun** (runtime JavaScript)
- **Docker** (para Gotenberg - conversión PDF)
- **LibreOffice** o **Microsoft Word** (para editar templates)

## 🛠️ Instalación

### 1. Instalar dependencias

```bash
bun install
```

### 2. Iniciar Gotenberg (para conversión PDF)

```bash
bun run docker:up
```

Verifica que esté corriendo:
```bash
curl http://localhost:3000/health
```

### 3. Preparar Templates

⚠️ **IMPORTANTE:** Debes convertir el DOCX en template reemplazando los "_____" con `{campos}`.

Lee las instrucciones completas en: [`INSTRUCCIONES_TEMPLATE.md`](./INSTRUCCIONES_TEMPLATE.md)

**Resumen rápido:**
1. Abre `templates/contrato_uso_carro_usado.docx` con Word/LibreOffice
2. Reemplaza `_____` con `{nombre_campo}`
3. Guarda el archivo

## 🎯 Uso

### Iniciar el servidor

```bash
bun run dev
```

El servidor estará disponible en `http://localhost:4000`

### Endpoints Disponibles

#### 1. Health Check
```bash
GET /health
```

#### 2. Listar tipos de contratos
```bash
GET /contracts/types
```

Respuesta:
```json
{
  "success": true,
  "count": 1,
  "contracts": [
    {
      "type": "uso_carro_usado",
      "templateFilename": "contrato_uso_carro_usado.docx",
      "description": "Contrato privado de uso de bien mueble (vehículo usado)",
      "requiredFields": ["contract_day", "contract_month", ...]
    }
  ]
}
```

#### 3. Generar contrato (método genérico)
```bash
POST /generatecontrato
Content-Type: application/json

{
  "contractType": "uso_carro_usado",
  "data": {
    "contract_day": "28",
    "contract_month": "octubre",
    "contract_year": "veinticinco",
    "client_name": "JUAN CARLOS LÓPEZ",
    "client_age": "treinta y cinco",
    "client_cui": "2345 67890 1234",
    "vehicle_type": "Automóvil",
    "vehicle_brand": "Toyota",
    "vehicle_model": "2020",
    "vehicle_color": "Blanco",
    ... (ver campos completos abajo)
  },
  "options": {
    "generatePdf": true,
    "filenamePrefix": "contrato_juan"
  }
}
```

#### 4. Generar contrato (método por tipo)
```bash
POST /contracts/uso_carro_usado
Content-Type: application/json

{
  "contract_day": "28",
  "contract_month": "octubre",
  ... (datos directamente, sin wrapper)
}
```

### Respuesta Exitosa

```json
{
  "success": true,
  "contractType": "uso_carro_usado",
  "docx_path": "/home/user/cci/output/contrato_juan_uso_carro_usado_2025-10-28T14-30-00.docx",
  "pdf_path": "/home/user/cci/output/contrato_juan_uso_carro_usado_2025-10-28T14-30-00.pdf",
  "message": "Contrato uso_carro_usado generado exitosamente",
  "generatedAt": "2025-10-28T14:30:00.000Z"
}
```

### Ejemplo con cURL

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
      "vehicle_brand": "Honda",
      "vehicle_model": "2021",
      "vehicle_color": "Negro",
      "vehicle_use": "Particular",
      "vehicle_chassis": "ABC123456789",
      "vehicle_fuel": "Gasolina",
      "vehicle_motor": "MOT123456",
      "vehicle_series": "CIVIC-2021",
      "vehicle_line": "Civic EX",
      "vehicle_cc": "1500",
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
      "client_address": "15 Avenida 10-25 Zona 10, Ciudad de Guatemala"
    }
  }'
```

## 🧪 Testing

Ejecuta el script de prueba incluido:

```bash
bun run test
```

Este script:
1. Verifica que el servidor esté activo
2. Lista los contratos disponibles
3. Genera un contrato de prueba con datos de ejemplo

## 📁 Estructura del Proyecto

```
cci/
├── templates/              # Templates DOCX
│   └── contrato_uso_carro_usado.docx
├── output/                 # Contratos generados (DOCX y PDF)
├── services/              # Lógica de negocio
│   └── ContractGeneratorService.ts
├── types/                 # Tipos TypeScript
│   └── contract.ts
├── index.ts              # Servidor API
├── test-contract.ts      # Script de prueba
├── docker-compose.yml    # Configuración Gotenberg
├── package.json
├── tsconfig.json
├── README.md
└── INSTRUCCIONES_TEMPLATE.md
```

## 📝 Campos del Contrato de Uso de Carro Usado

### Datos de la Fecha
- `contract_day` - Día del contrato (ej: "28")
- `contract_month` - Mes en español (ej: "octubre")
- `contract_year` - Año en palabras (ej: "veinticinco")

### Datos del Cliente
- `client_name` - Nombre completo
- `client_age` - Edad en palabras
- `client_cui` - DPI completo
- `client_address` - Dirección para notificaciones

### Datos del Vehículo
- `vehicle_type` - Tipo (Automóvil, Pickup, SUV...)
- `vehicle_brand` - Marca
- `vehicle_model` - Año del modelo
- `vehicle_color` - Color
- `vehicle_use` - Uso (Particular, Comercial...)
- `vehicle_chassis` - Número de chasis
- `vehicle_fuel` - Tipo de combustible
- `vehicle_motor` - Número de motor
- `vehicle_series` - Serie
- `vehicle_line` - Línea o estilo
- `vehicle_cc` - Centímetros cúbicos
- `vehicle_seats` - Número de asientos
- `vehicle_cylinders` - Número de cilindros
- `vehicle_iscv` - Código ISCV

### Datos del Plazo
- `user_name` - Nombre del usuario
- `contract_duration_months` - Duración en palabras
- `contract_start_date` - Fecha de inicio (texto completo)
- `contract_end_day` - Día de fin
- `contract_end_month` - Mes de fin
- `contract_end_year` - Año de fin en palabras

### Nombres Repetidos (por cláusula)
- `user_name_clause_a`
- `user_name_clause_a2`
- `user_name_clause_b`
- `user_name_clause_d`
- `user_name_final`

## 🔧 Agregar Nuevos Tipos de Contratos

### 1. Agregar el tipo en el enum

```typescript
// types/contract.ts
export enum ContractType {
  USO_CARRO_USADO = 'uso_carro_usado',
  NUEVO_CONTRATO = 'nuevo_contrato', // ← Agregar aquí
}
```

### 2. Crear la interfaz de datos

```typescript
// types/contract.ts
export interface NuevoContratoData extends BaseContractData {
  contractType: ContractType.NUEVO_CONTRATO;
  campo1: string;
  campo2: string;
  // ... más campos
}
```

### 3. Actualizar el tipo union

```typescript
export type AnyContractData =
  | UsoCarroUsadoData
  | NuevoContratoData; // ← Agregar aquí
```

### 4. Registrar el template

```typescript
// services/ContractGeneratorService.ts - método initializeTemplateRegistry()
this.registerTemplate({
  type: ContractType.NUEVO_CONTRATO,
  templateFilename: 'nuevo_contrato.docx',
  description: 'Descripción del contrato',
  requiredFields: ['campo1', 'campo2']
});
```

### 5. Crear el template DOCX

1. Crea `templates/nuevo_contrato.docx` con Word/LibreOffice
2. Usa marcadores `{campo1}`, `{campo2}`, etc.
3. Guarda el archivo

¡Listo! El nuevo contrato estará disponible automáticamente.

## 🐳 Docker Commands

```bash
# Iniciar Gotenberg
bun run docker:up

# Detener Gotenberg
bun run docker:down

# Ver logs de Gotenberg
bun run docker:logs

# Verificar que Gotenberg esté corriendo
curl http://localhost:3000/health
```

## 🔍 Troubleshooting

### El PDF no se genera

1. Verifica que Gotenberg esté corriendo:
   ```bash
   docker ps
   ```

2. Verifica el endpoint de salud:
   ```bash
   curl http://localhost:3000/health
   ```

3. Si no está corriendo:
   ```bash
   bun run docker:up
   ```

### Error de validación "Campos requeridos faltantes"

Asegúrate de enviar todos los campos requeridos. Verifica la lista con:
```bash
curl http://localhost:4000/contracts/types
```

### Template no renderiza correctamente

1. Verifica que el template tenga la sintaxis correcta: `{campo}` (no `{{campo}}`)
2. Asegúrate de que no haya espacios extra: `{campo}` ✅ vs `{ campo }` ❌
3. Verifica que el archivo esté guardado como `.docx` moderno

### Puerto 4000 ya en uso

Cambia el puerto con variable de entorno:
```bash
PORT=5000 bun run dev
```

## 📄 Licencia

Proyecto interno de CCI.

## 👥 Contribuir

Para agregar nuevos contratos o mejorar el sistema, sigue las guías en la sección "Agregar Nuevos Tipos de Contratos".

---

**Desarrollado con ❤️ usando Bun, TypeScript, docxtemplater y Gotenberg**
