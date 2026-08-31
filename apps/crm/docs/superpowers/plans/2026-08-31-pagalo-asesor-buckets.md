# Págalo asesor por buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir rol `cobros` en Supervisión Págalo, limitado server-side a créditos de sus buckets activos.

**Architecture:** Resolver pool por `email_cash_in`; consultar bucket motor de SIFCOs Págalo en lotes GET de 50 y usar conjunto permitido en cada consulta SQL de bandeja. Supervisor/admin omite scope; asesor usa lectura sin acciones ni deep links.

**Tech Stack:** TypeScript, Bun test, Drizzle ORM, oRPC, React.

---

### Task 1: Scope puro de asesor

**Files:**
- Create: `apps/server/src/lib/pagalo-supervision-acceso.ts`
- Test: `apps/server/src/lib/pagalo-supervision-acceso.test.ts`

- [ ] **Step 1: Escribir pruebas fallidas** para email normalizado, lotes de 50, B0 permitido y buckets ajenos excluidos.
- [ ] **Step 2: Ejecutar** `bun test apps/server/src/lib/pagalo-supervision-acceso.test.ts`; esperar fallos por módulo inexistente.
- [ ] **Step 3: Implementar** `buscarAsesorPorEmail`, `dividirEnLotes` y `sifcosEnBucketsPermitidos` sin I/O.
- [ ] **Step 4: Ejecutar** prueba enfocada; esperar PASS.

### Task 2: Scope server-side Págalo

**Files:**
- Modify: `apps/server/src/routers/pagalo-supervision.ts`
- Modify: `apps/server/src/services/cartera-back-client.ts`
- Test: `apps/server/src/lib/pagalo-supervision-acceso.test.ts`

- [ ] **Step 1: Escribir prueba fallida** de lotes para más de 50 SIFCOs y conservar solo bucket autorizado.
- [ ] **Step 2: Ejecutar** prueba enfocada; esperar fallo de expectativa.
- [ ] **Step 3: Cambiar** `getAllCreditos` para aceptar `useCache` opcional y pasarlo a GET; default conserva caché existente.
- [ ] **Step 4: Cambiar** router a `cobrosProcedure`; para rol sin `canAssignCobros`, resolver pool, consultar SIFCOs en lotes de 50 con `mapWithConcurrency(..., 4, ...)`, sin caché, y añadir `inArray(numeroCreditoSifco, permitidos)` a conteos, total y página.
- [ ] **Step 5: Devolver** `bucketsAsignados` para UI; vínculo faltante devuelve vacío; error de Cartera Back no devuelve datos.
- [ ] **Step 6: Ejecutar** prueba enfocada; esperar PASS.

### Task 3: UI lectura de asesor

**Files:**
- Modify: `apps/web/src/routes/cobros/pagalo.tsx`

- [ ] **Step 1: Cambiar** `puedeConsultar` a `PERMISSIONS.canAccessCobros(userRole)`.
- [ ] **Step 2: Mantener** `esSupervisor = PERMISSIONS.canAssignCobros(userRole)`.
- [ ] **Step 3: Mostrar** aviso de buckets asignados para asesor y volver crédito texto no enlazado si no es supervisor.
- [ ] **Step 4: Ejecutar** `bun run --cwd apps/web check-types`; esperar PASS.

### Task 4: Verificación

**Files:**
- Verify: `apps/server/src/lib/pagalo-supervision-acceso.test.ts`
- Verify: `apps/server/src/routers/pagalo-supervision.ts`
- Verify: `apps/web/src/routes/cobros/pagalo.tsx`

- [ ] **Step 1: Ejecutar** `bun test apps/server/src/lib/pagalo-supervision-acceso.test.ts apps/server/src/lib/pagalo-supervision-filtros.test.ts apps/web/src/routes/cobros/-pagalo-columnas.test.ts`.
- [ ] **Step 2: Ejecutar** `bun run check-types` desde `apps/crm`.
- [ ] **Step 3: Ejecutar** `bun run check` desde `apps/crm`.
- [ ] **Step 4: Revisar** `git diff --check` y `git diff --stat`.
- [ ] **Step 5: Commit** `feat(pagalo): scope advisor supervision by buckets`.
