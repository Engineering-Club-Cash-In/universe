# RFC-003: Referencias Personales del Solicitante

**Estado**: Borrador - Pendiente definir requisitos de negocio
**Fecha**: 2025-01-13
**Autor**: @lralda + Claude

---

## Problema

Actualmente no hay forma de registrar las referencias personales que el solicitante proporciona para verificación. Solo existe un checkbox en el checklist de desembolso (`confirmacion_referencias`) pero no se guardan los datos de las referencias ni el resultado de las llamadas.

---

## Propuesta (Esqueleto)

### Schema

```typescript
// Tipos de referencia
export const referenceTypeEnum = pgEnum("reference_type", [
  "personal",    // Familiar, amigo, vecino
  "laboral",     // Jefe, compañero, RRHH
  "comercial",   // Proveedor, cliente (si aplica)
]);

// Estado de verificación
export const referenceStatusEnum = pgEnum("reference_status", [
  "pending",     // No se ha llamado
  "verified",    // Llamada exitosa, confirmó datos
  "not_reached", // No contestó / número equivocado
  "negative",    // Referencia negativa
]);

// Tabla de referencias
export const leadReferences = pgTable("lead_references", {
  id: uuid("id").defaultRandom().primaryKey(),

  // A quién pertenece esta referencia
  leadId: uuid("lead_id")
    .references(() => leads.id, { onDelete: "cascade" })
    .notNull(),

  // Datos de la referencia
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  alternatePhone: text("alternate_phone"),
  relationship: text("relationship").notNull(), // "hermano", "jefe", "amigo", etc.
  referenceType: referenceTypeEnum("reference_type").notNull(),

  // Información adicional
  yearsKnown: integer("years_known"), // Años de conocerlo
  workplace: text("workplace"), // Donde trabaja la referencia (opcional)
  notes: text("notes"), // Notas generales

  // Verificación
  status: referenceStatusEnum("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: text("verified_by").references(() => user.id),
  verificationNotes: text("verification_notes"), // Qué dijo la referencia

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

---

## Preguntas Pendientes (Definir con Negocio)

### Cantidad de referencias

| Pregunta | Opciones | Decisión |
|----------|----------|----------|
| ¿Cuántas referencias personales? | 1, 2, 3+ | ❓ |
| ¿Cuántas referencias laborales? | 0, 1, 2 | ❓ |
| ¿Cuántas referencias comerciales? | 0, 1, 2 | ❓ |
| ¿Es diferente por tipo de crédito? | Sí/No | ❓ |

### Requisitos

| Pregunta | Decisión |
|----------|----------|
| ¿El co-firmante también da referencias? | ❓ |
| ¿Todas deben estar verificadas para avanzar? | ❓ |
| ¿En qué etapa se piden? (antes de análisis, después) | ❓ |
| ¿Quién hace las llamadas? (vendedor, analista) | ❓ |

### Relaciones permitidas

```
[ ] Familiar directo (padre, madre, hermano)
[ ] Familiar extendido (tío, primo, cuñado)
[ ] Cónyuge/Pareja
[ ] Amigo
[ ] Vecino
[ ] Jefe directo
[ ] Compañero de trabajo
[ ] Recursos Humanos
[ ] Proveedor
[ ] Cliente
[ ] Otro
```

---

## UI Propuesta (Borrador)

```
📞 REFERENCIAS

👤 Juan Pérez (Titular)
┌─────────────────────────────────────────────────────────────┐
│ Personal #1                                    ✅ Verificada │
│ María García - Hermana                                      │
│ Tel: 5555-1234 | Conoce hace: 25 años                      │
│ Notas: Confirmó datos, buena referencia                    │
├─────────────────────────────────────────────────────────────┤
│ Personal #2                                    ⏳ Pendiente  │
│ Carlos López - Amigo                                        │
│ Tel: 5555-5678 | Conoce hace: 10 años                      │
├─────────────────────────────────────────────────────────────┤
│ Laboral #1                                     ❌ No contestó│
│ Ana Martínez - Jefa directa                                 │
│ Tel: 5555-9012 | Empresa: Acme Corp                        │
│ Intentos: 3 | Último: 2025-01-13                           │
└─────────────────────────────────────────────────────────────┘
                                        [+ Agregar referencia]

👥 María López (Co-firmante)
┌─────────────────────────────────────────────────────────────┐
│ Personal #1                                    ⏳ Pendiente  │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Plan de Implementación

### Fase 1: Definir requisitos
- [ ] Reunión con equipo de operaciones/análisis
- [ ] Definir cantidad y tipos de referencias por tipo de crédito
- [ ] Definir en qué etapa se requieren
- [ ] Definir quién verifica y cuándo

### Fase 2: Schema y Backend
- [ ] Crear tabla `leadReferences`
- [ ] Endpoints CRUD para referencias
- [ ] Validación en transiciones de stage (si aplica)

### Fase 3: Frontend
- [ ] Sección de referencias en vista de lead/oportunidad
- [ ] Formulario para agregar referencia
- [ ] UI de verificación (marcar como verificada, notas)

---

## Relación con otros RFCs

- **RFC-002 (Co-firmante)**: Si el co-firmante también requiere referencias, se usa la misma tabla (`leadReferences`) vinculada a su `leadId`.

---

## Notas

Este RFC está incompleto intencionalmente. Los requisitos exactos deben definirse con el equipo de negocio antes de implementar.
