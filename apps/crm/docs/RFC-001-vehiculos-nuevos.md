# RFC-001: Soporte para Vehículos Nuevos en Créditos Autocompra

**Estado**: Propuesta aprobada
**Fecha**: 2025-01-13
**Autor**: @lralda + Claude

---

## Problema

Actualmente el flujo de créditos autocompra requiere un vehículo seleccionado con inspección aprobada para avanzar a análisis. Esto no funciona para **vehículos nuevos** porque:

1. No hay vehículo en inventario que seleccionar (es nuevo, no existe aún)
2. Los carros nuevos no necesitan inspección mecánica
3. Los datos completos (VIN, placa) llegan después, del dealer
4. Actualmente se usa `bypassValidation` (admin-only) como workaround

---

## Opciones Consideradas

### Opción A: Validación condicional por categoría

Usar `opportunity.categoria === "CV Vehículo nuevo"` para:
- Hacer `vehicleId` opcional
- Skip de inspección
- Diferentes documentos requeridos

**Descartada porque**: El conocimiento de "es nuevo" queda dividido entre la oportunidad y el vehículo.

### Opción B: Flag `isNew` en vehículos (ELEGIDA)

- Agregar `isNew: boolean` al schema de vehicles
- Hacer opcionales los campos que no se conocen inicialmente
- Crear vehículo con datos mínimos de proforma
- Completar datos antes del 80%

**Elegida porque**:
- Los créditos de vehículo nuevo son frecuentes (>30%)
- El vehículo es la fuente de verdad de su propio estado
- Evita duplicar lógica en todos lados

### Opción C: Tabla separada `new_vehicles`

- Tabla aparte para carros nuevos pendientes
- "Graduación" a `vehicles` cuando datos completos
- Opportunity tendría `vehicleId` OR `newVehicleId`

**Descartada porque**:
- Agrega complejidad (dos referencias, lógica de graduación)
- Con alta frecuencia de nuevos, duplicaría lógica en todos lados

---

## Decisión: Opción B

### Cambios al Schema

```typescript
// vehicles.ts - Campos a modificar

export const vehicles = pgTable("vehicles", {
  // ... id

  // ═══════ NUEVO FLAG ═══════
  isNew: boolean("is_new").notNull().default(false),

  // ═══════ SIEMPRE REQUERIDOS (conocidos desde proforma) ═══════
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  color: text("color").notNull(),
  vehicleType: text("vehicle_type").notNull(),

  // ═══════ OPCIONALES PARA NUEVOS (quitar notNull) ═══════
  licensePlate: text("license_plate").unique(),        // Era notNull
  vinNumber: text("vin_number").unique(),              // Era notNull
  kmMileage: integer("km_mileage").default(0),         // Era notNull, default 0 para nuevos
  origin: text("origin"),                               // Era notNull
  cylinders: text("cylinders"),                         // Era notNull
  engineCC: text("engine_cc"),                          // Era notNull
  fuelType: text("fuel_type"),                          // Era notNull
  transmission: text("transmission"),                   // Era notNull

  // ... resto igual
});
```

### UI/UX

**1. Creación de vehículo nuevo:**
- Nueva sección/tab en ventas: "Vehículos Nuevos"
- Formulario simplificado con solo campos conocidos (marca, modelo, año, color, tipo, precio)
- Campos opcionales para datos que vienen después (VIN, placa, etc.)

**2. Badges/Indicadores visuales:**

En el vehículo:
```
┌─────────────────────────────────┐
│ Toyota Corolla 2025             │
│ 🆕 Nuevo  ⚠️ Pendiente de datos │  ← Cuando faltan datos
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Toyota Corolla 2025             │
│ 🆕 Nuevo  ✅ Datos completos    │  ← Cuando ya tiene todo
└─────────────────────────────────┘
```

En la oportunidad (pipeline/kanban):
```
┌─────────────────────────────────┐
│ Juan Pérez - Q150,000           │
│ 🆕 Vehículo Nuevo               │
│ ⚠️ Pendiente: VIN, Placa        │
└─────────────────────────────────┘
```

### Estrategia de Validación por Etapa

| Transición | Vehículo Usado | Vehículo Nuevo |
|------------|----------------|----------------|
| → Análisis | Requiere vehículo + inspección aprobada | Requiere vehículo con `isNew=true`, skip inspección |
| → 50% | Sin cambios | Sin cambios (buscar inversión) |
| → 80% | Sin cambios | ⚠️ Warning si faltan datos, sugerir completar |
| → 90% | Sin cambios | 🛑 Requiere VIN mínimo (para contratos) |
| → 100% | Sin cambios | 🛑 Requiere datos completos |

### Lógica de "Datos Completos"

```typescript
// Helper para determinar si vehículo nuevo tiene datos completos
function isNewVehicleDataComplete(vehicle: Vehicle): boolean {
  if (!vehicle.isNew) return true; // Usados ya tienen todo

  // Campos críticos para contratos/cartera
  return !!(
    vehicle.vinNumber &&
    vehicle.licensePlate &&
    vehicle.origin &&
    vehicle.fuelType &&
    vehicle.transmission
  );
}

// Campos faltantes para mostrar en UI
function getMissingFields(vehicle: Vehicle): string[] {
  if (!vehicle.isNew) return [];

  const missing: string[] = [];
  if (!vehicle.vinNumber) missing.push("VIN");
  if (!vehicle.licensePlate) missing.push("Placa");
  if (!vehicle.origin) missing.push("Origen");
  if (!vehicle.fuelType) missing.push("Tipo combustible");
  if (!vehicle.transmission) missing.push("Transmisión");

  return missing;
}
```

---

## Plan de Implementación

### Fase 1: Schema y Migración
- [ ] Agregar campo `isNew` a vehicles
- [ ] Hacer campos opcionales (quitar notNull)
- [ ] Ejecutar migración
- [ ] Actualizar tipos TypeScript

### Fase 2: Backend
- [ ] Endpoint para crear vehículo nuevo (validación relajada)
- [ ] Helper `isNewVehicleDataComplete()`
- [ ] Ajustar validación en `approveAnalysis` (skip inspección si `isNew`)
- [ ] Ajustar validaciones de stage transitions (80%, 90%, 100%)

### Fase 3: Frontend
- [ ] Sección "Vehículos Nuevos" en ventas
- [ ] Formulario de creación con campos mínimos
- [ ] Badges de estado en vehículo y oportunidad
- [ ] Mostrar campos faltantes en UI
- [ ] Warnings/bloqueos en transiciones de stage

### Fase 4: Testing
- [ ] Flujo completo de crédito con vehículo nuevo
- [ ] Verificar que vehículos usados siguen funcionando igual
- [ ] Validar transiciones de stage

---

## Notas Adicionales

- PostgreSQL permite múltiples NULLs en columnas UNIQUE, así que `vinNumber` y `licensePlate` pueden ser NULL sin problema
- La validación "estricta" para vehículos usados se mueve del schema al código
- Los vehículos existentes no se afectan (ya tienen todos los datos)
