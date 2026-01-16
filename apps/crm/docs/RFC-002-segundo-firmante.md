# RFC-002: Soporte para Segundo Firmante (Co-firmante) en Oportunidades

**Estado**: Propuesta aprobada
**Fecha**: 2025-01-13
**Autor**: @lralda + Claude

---

## Problema

Hay casos donde una persona no califica por sí sola para un crédito debido a su capacidad de pago. En estos casos, se requiere un **segundo firmante** (co-firmante) que aporta sus ingresos para calificar en conjunto, similar a una hipoteca.

Actualmente el sistema está diseñado para un solo lead por oportunidad.

---

## Decisión

Agregar soporte para un segundo firmante opcional en la oportunidad, con las siguientes características:

- **Ingresos combinados**: Se suman los ingresos de ambos para el análisis de capacidad
- **Documentación completa**: Ambos deben tener todos los documentos requeridos
- **Buró manual**: Verificación de buró fuera del sistema (requiere consentimiento firmado)
- **RENAP para ambos**: Consulta de datos para ambas personas
- **Momento de agregar**: Solo antes de pasar a análisis, después se bloquea
- **Contratos**: Mismo contrato firmado por ambos (sin cambios en sistema)
- **Cartera-back**: Concatenar datos con "/": `NOMBRE1/NOMBRE2`, `NIT1/NIT2`

---

## Cambios al Schema

### 1. Opportunity - Agregar referencia a co-firmante

```typescript
// En crm.ts - tabla opportunities
export const opportunities = pgTable("opportunities", {
  // ... campos existentes

  // NUEVO: Segundo firmante
  coSignerLeadId: uuid("co_signer_lead_id").references(() => leads.id),

  // NUEVO: Flag para verificación manual de buró del co-firmante
  coSignerBuroVerified: boolean("co_signer_buro_verified").default(false),
  coSignerBuroVerifiedAt: timestamp("co_signer_buro_verified_at"),
  coSignerBuroVerifiedBy: text("co_signer_buro_verified_by").references(() => user.id),
});
```

### 2. Documents - Identificar dueño del documento

```typescript
// En documents.ts - tabla opportunityDocuments
export const opportunityDocuments = pgTable("opportunity_documents", {
  // ... campos existentes

  // NUEVO: Identificar a quién pertenece el documento
  belongsToLeadId: uuid("belongs_to_lead_id").references(() => leads.id),
  // NULL = documento general de la oportunidad (no de una persona específica)
});
```

### 3. Credit Analysis - Análisis combinado

```typescript
// Opción A: Campo adicional en creditAnalysis existente
// El análisis del lead principal incluye ingresos combinados

// Opción B: Nuevo campo en opportunity para guardar análisis combinado
combinedAnalysis: text("combined_analysis"), // JSON con análisis combinado
combinedMonthlyIncome: decimal("combined_monthly_income"),
combinedEconomicAvailability: decimal("combined_economic_availability"),
```

---

## Lógica de Negocio

### Cuándo se puede agregar co-firmante

```typescript
// Solo permitido si la oportunidad NO ha llegado a análisis
async function canAddCoSigner(opportunityId: string): Promise<boolean> {
  const opportunity = await getOpportunity(opportunityId);
  const currentStage = await getStage(opportunity.stageId);

  // Etapa de análisis típicamente es ~30%
  const ANALYSIS_STAGE_PERCENTAGE = 30;

  return currentStage.closurePercentage < ANALYSIS_STAGE_PERCENTAGE;
}
```

### Validación para avanzar a análisis

```typescript
async function validateForAnalysis(opportunityId: string): Promise<ValidationResult> {
  const opportunity = await getOpportunity(opportunityId);
  const errors: string[] = [];

  // Validar lead principal
  const primaryDocs = await getDocumentsForLead(opportunity.leadId);
  if (!hasAllRequiredDocs(primaryDocs)) {
    errors.push("Faltan documentos del titular principal");
  }

  // Si hay co-firmante, validar también
  if (opportunity.coSignerLeadId) {
    const coSignerDocs = await getDocumentsForLead(opportunity.coSignerLeadId);
    if (!hasAllRequiredDocs(coSignerDocs)) {
      errors.push("Faltan documentos del co-firmante");
    }

    // Verificar que tenga análisis de capacidad (o ingresos registrados)
    const coSignerLead = await getLead(opportunity.coSignerLeadId);
    if (!coSignerLead.monthlyIncome) {
      errors.push("Falta información de ingresos del co-firmante");
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### Cálculo de capacidad combinada

```typescript
async function calculateCombinedCapacity(opportunityId: string) {
  const opportunity = await getOpportunity(opportunityId);

  // Obtener análisis del titular principal
  const primaryAnalysis = await getCreditAnalysis(opportunity.leadId);

  let combinedIncome = Number(primaryAnalysis?.monthlyFixedIncome || 0);
  let combinedExpenses = Number(primaryAnalysis?.monthlyFixedExpenses || 0);

  // Si hay co-firmante, sumar sus ingresos
  if (opportunity.coSignerLeadId) {
    const coSignerAnalysis = await getCreditAnalysis(opportunity.coSignerLeadId);

    if (coSignerAnalysis) {
      combinedIncome += Number(coSignerAnalysis.monthlyFixedIncome || 0);
      // Los gastos también se suman (cada uno tiene sus gastos)
      combinedExpenses += Number(coSignerAnalysis.monthlyFixedExpenses || 0);
    } else {
      // Si no hay análisis formal, usar ingresos del lead
      const coSignerLead = await getLead(opportunity.coSignerLeadId);
      combinedIncome += Number(coSignerLead.monthlyIncome || 0);
    }
  }

  const combinedAvailability = combinedIncome - combinedExpenses;

  return {
    combinedIncome,
    combinedExpenses,
    combinedAvailability,
    // Calcular capacidad de pago con los valores combinados
    maxPayment: combinedAvailability * 0.4, // 40% de disponibilidad
  };
}
```

### Integración con Cartera-back

```typescript
async function createCreditoWithCoSigner(opportunity, primaryLead, coSignerLead) {
  // Concatenar datos con "/"
  const usuario_id = coSignerLead
    ? `${primaryLead.firstName} ${primaryLead.lastName}/${coSignerLead.firstName} ${coSignerLead.lastName}`
    : `${primaryLead.firstName} ${primaryLead.lastName}`;

  const nit = coSignerLead && coSignerLead.nit
    ? `${opportunity.nit || 'CF'}/${coSignerLead.nit || 'CF'}`
    : opportunity.nit;

  return await createCreditoInCarteraBack({
    // ... otros campos
    usuario_id,
    nit,
    direccion: primaryLead.direccion, // Solo del principal
    // ... resto igual
  });
}
```

---

## UI/UX

### 1. Sección de Co-firmante en Oportunidad

```
┌─────────────────────────────────────────────────────────────┐
│ Oportunidad: Crédito Autocompra - Juan Pérez                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 👤 TITULAR PRINCIPAL                                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Juan Pérez García                                       │ │
│ │ DPI: 1234567890101 | Tel: 5555-1234                    │ │
│ │ Ingresos: Q15,000/mes                                   │ │
│ │ Documentos: ✅ Completos                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ 👥 CO-FIRMANTE                          [+ Agregar]         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ María López de Pérez                                    │ │
│ │ DPI: 0987654321010 | Tel: 5555-4321                    │ │
│ │ Ingresos: Q12,000/mes                                   │ │
│ │ Documentos: ⚠️ Faltan 2                                 │ │
│ │ Buró: ⬜ Pendiente verificación manual                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ 💰 CAPACIDAD COMBINADA                                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Ingresos totales: Q27,000/mes                          │ │
│ │ Gastos estimados: Q8,000/mes                           │ │
│ │ Disponibilidad: Q19,000/mes                            │ │
│ │ Cuota máxima sugerida: Q7,600/mes                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Selección de Co-firmante

Al agregar co-firmante, opciones:
- **Buscar lead existente**: Por DPI, nombre, teléfono
- **Crear nuevo lead**: Formulario simplificado

### 3. Bloqueo después de análisis

```
┌─────────────────────────────────────────────────────────────┐
│ 👥 CO-FIRMANTE                          🔒 Bloqueado        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ María López de Pérez                                    │ │
│ │ No se puede modificar después de pasar a análisis      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4. Documentos separados por persona

```
📁 DOCUMENTOS

👤 Juan Pérez (Titular)
├── ✅ DPI
├── ✅ Recibo de luz
├── ✅ Estados de cuenta (3)
└── ✅ Licencia

👥 María López (Co-firmante)
├── ✅ DPI
├── ⬜ Recibo de luz
├── ✅ Estados de cuenta (3)
└── ⬜ Licencia
```

---

## Plan de Implementación

### Fase 1: Schema y Migración
- [ ] Agregar `coSignerLeadId` a opportunities
- [ ] Agregar campos de verificación de buró del co-firmante
- [ ] Agregar `belongsToLeadId` a opportunityDocuments
- [ ] Ejecutar migración

### Fase 2: Backend - Lógica básica
- [ ] Endpoint para agregar/quitar co-firmante
- [ ] Validación: solo permitir antes de análisis
- [ ] Función de cálculo de capacidad combinada
- [ ] Ajustar validación de documentos (ambos deben tener)

### Fase 3: Backend - Integraciones
- [ ] Consulta RENAP para co-firmante
- [ ] Modificar integración cartera-back (concatenar con "/")
- [ ] Checkbox de verificación manual de buró

### Fase 4: Frontend
- [ ] Sección de co-firmante en vista de oportunidad
- [ ] Selector/creador de co-firmante
- [ ] Vista de documentos separados por persona
- [ ] Mostrar capacidad combinada
- [ ] Bloqueo visual después de análisis

### Fase 5: Testing
- [ ] Flujo completo con co-firmante
- [ ] Verificar que oportunidades sin co-firmante siguen funcionando
- [ ] Probar bloqueo de modificación después de análisis
- [ ] Verificar formato correcto en cartera-back

---

## Consideraciones Adicionales

### Buró Manual
El buró requiere consentimiento firmado que no podemos obtener digitalmente en el CRM. Se implementa como:
- Checkbox "Buró verificado" que marca un analista
- Guarda quién verificó y cuándo
- Es requisito para avanzar a análisis (si hay co-firmante)

### Relación con RFC-001 (Vehículos Nuevos)
Ambos RFCs son independientes pero pueden coexistir:
- Una oportunidad puede tener vehículo nuevo Y co-firmante
- Las validaciones se acumulan (ambos deben cumplirse)

### Migración de datos existentes
- Oportunidades existentes: `coSignerLeadId = NULL` (sin co-firmante)
- Documentos existentes: `belongsToLeadId = NULL` (se asumen del titular)
- No hay breaking changes
