# RFC-004: Cambio de Roles de Usuario desde Admin Panel

**Estado**: Propuesta
**Fecha**: 2025-01-26
**Autor**: @lralda + Claude

---

## Problema

Actualmente para cambiar el rol de un usuario es necesario modificar directamente la base de datos. Esto presenta varios inconvenientes:

1. Requiere acceso directo a la BD (credenciales, herramientas)
2. No hay registro de quién hizo el cambio ni cuándo
3. Es propenso a errores (typos en roles, IDs incorrectos)
4. No es accesible para administradores sin conocimientos técnicos

---

## Solución Propuesta

Agregar funcionalidad de cambio de rol en el panel de administración existente (`/admin/users`).

### Ubicación en UI

El selector de rol se agregaría en el modal de detalles de usuario que ya existe, reemplazando el badge estático de rol por un `<Select>` editable.

```
┌─────────────────────────────────────────────┐
│ Detalles del Usuario                        │
├─────────────────────────────────────────────┤
│ Dulce Argueta                               │
│ dulce.a@clubcashin.com                      │
│                                             │
│ ┌─────────────┐  ┌─────────────┐            │
│ │ Rol         │  │ Estado Email│            │
│ │ [Analista ▼]│  │ Verificado  │            │
│ └─────────────┘  └─────────────┘            │
│                                             │
│ [Suspender]  [Eliminar]  [Guardar cambios]  │
└─────────────────────────────────────────────┘
```

---

## Implicaciones de Seguridad

### Restricciones Requeridas

1. **Solo admins pueden cambiar roles** - Validar en backend con `protectedProcedure`
2. **No auto-modificación** - Un admin no puede cambiar su propio rol
3. **Protección del último admin** - Validar que siempre exista al menos un admin en el sistema

### Impacto Inmediato en Permisos

Cambiar el rol afecta **inmediatamente** el acceso del usuario:

| Módulo | admin | sales | sales_supervisor | analyst | cobros | cobros_supervisor | juridico |
|--------|-------|-------|------------------|---------|--------|-------------------|----------|
| CRM | ✅ | ✅ | ✅ | ✅ (lectura) | ❌ | ❌ | ✅ |
| Análisis | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Cobros | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Jurídico | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Admin | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Aprobar oportunidades | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Crear contratos | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Implementación Técnica

### Backend

```typescript
// apps/server/src/routers/auth.ts

updateUserRole: protectedProcedure
  .input(z.object({
    userId: z.string(),
    role: z.enum(["admin", "sales", "sales_supervisor", "analyst", "cobros", "cobros_supervisor", "juridico"]),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. Solo admins pueden cambiar roles
    if (ctx.user.role !== "admin") {
      throw new Error("Solo administradores pueden cambiar roles");
    }

    // 2. No auto-modificación
    if (ctx.user.id === input.userId) {
      throw new Error("No puedes cambiar tu propio rol");
    }

    // 3. Si se está quitando rol admin, verificar que no sea el último
    if (input.role !== "admin") {
      const currentUser = await db.query.user.findFirst({
        where: eq(user.id, input.userId),
      });

      if (currentUser?.role === "admin") {
        const adminCount = await db.select({ count: count() })
          .from(user)
          .where(eq(user.role, "admin"));

        if (adminCount[0].count <= 1) {
          throw new Error("Debe existir al menos un administrador en el sistema");
        }
      }
    }

    // 4. Actualizar rol
    await db.update(user)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(user.id, input.userId));

    return { success: true };
  }),
```

### Frontend

Modificar `apps/web/src/routes/admin/users.tsx`:

1. Agregar mutation `updateUserRoleMutation`
2. Cambiar badge de rol por `<Select>` en el modal de detalles
3. Agregar botón "Guardar cambios" cuando hay cambios pendientes
4. Mostrar diálogo de confirmación antes de cambiar

---

## Consideraciones Adicionales

### Auditoría (Opcional - Fase 2)

Sería recomendable registrar cambios de rol para trazabilidad:

```typescript
// Nueva tabla role_changes
{
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id),
  previousRole: userRoleEnum("previous_role"),
  newRole: userRoleEnum("new_role"),
  changedBy: text("changed_by").references(() => user.id),
  changedAt: timestamp("changed_at").defaultNow(),
}
```

### Sesión Activa

El cambio de rol surte efecto en la siguiente petición del usuario afectado. El contexto de ORPC se recalcula por request, así que no requiere invalidar sesiones.

---

## Plan de Implementación

### Fase 1: Funcionalidad Base
- [ ] Crear endpoint `updateUserRole` con validaciones
- [ ] Agregar `<Select>` de rol en modal de detalles de usuario
- [ ] Agregar mutation y estado local para cambios
- [ ] Diálogo de confirmación antes de guardar

### Fase 2: Auditoría (Opcional)
- [ ] Crear tabla `role_changes`
- [ ] Registrar cada cambio de rol
- [ ] Vista de historial de cambios por usuario

---

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Admin se quita rol accidentalmente | Bloquear auto-modificación |
| Sistema sin admins | Validar que siempre exista ≥1 admin |
| Cambio no intencional | Diálogo de confirmación |
| Usuario pierde acceso sin aviso | Toast de confirmación visible |

---

## Notas

- La infraestructura de roles ya existe (`apps/server/src/lib/roles.ts`)
- El panel de admin ya tiene la estructura necesaria
- El esfuerzo de implementación es bajo (~2-4 horas para Fase 1)
