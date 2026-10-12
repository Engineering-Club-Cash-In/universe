# 23 · Supervisión de cobros: plan y avance del backend

> **Issue:** #1891 · **Tareas:** S1–S6 del [doc 17](./17-supervision-backend.md)
> **Rama:** `jalvarez-cobros` · un commit por PR, sin PR abiertos todavía
> **Regla:** solo backend. El front ya está conectado (PR #1890) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza con cada PR.

---

## Estado

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **S1** | Pendientes sin fuente | ⏳ PR 2 | — |
| **S2** | «Sin contacto» del equipo a 3 días hábiles | ⏳ PR 2 | — |
| **S3** | KPIs del equipo por período | ✅ Código en el PR 1 (sin migración) | `services/supervision-complementos.ts` · `lib/supervision-kpis.ts` · `getSupervisionComplementos.kpis` |
| **S4** | Columnas de la tabla Equipo | ✅ Código en el PR 1 (sin migración) | `getSupervisionComplementos.equipo` |
| **S5** | Filtros y paginación real de la Cartera general | ⏳ PR 3 | — |
| **S6** | Reasignación en bloque transaccional | ⏳ PR 4 | — |

> [!NOTE]
> Nada se corrió en ninguna base ni se subió. El código está local para probarlo.

---

## Decisiones (2026-10-12)

| Tarea | Decisión |
| --- | --- |
| S3 · cuentas curadas | Es el conteo de **bajadas de bucket** del equipo en el período (docs 01, 02 y 04: es el KPI principal del motor). Reemplaza la frase del contrato «quedaron sin mora y siguen en su bucket». |
| S3 · cuentas curadas | `curadas` sale del cierre diario (`cierre_diario_credito_cobros`, tipo `bajada`) de los asesores del pool, más lo de hoy en vivo mientras el cierre no haya corrido (`movimientosDeHoySinCerrar`). Es la misma fuente de B9 y de «Rescate», así el equipo y cada fila cuadran. `total` = cuentas del equipo con mora hoy (B1 en adelante, `getCargaPorAsesorBucket().buckets`). |
| S3 · meta del equipo | Suma de las metas prorrateadas de los asesores del pool que **tienen** meta (`metas_asesor_cobros`, regla de B3). `null` si ninguno la tiene. |
| S3 · promesas | Misma regla que las promesas del asesor, para todo el pool. `montoIncumplido` = suma de `monto_comprometido` de las promesas `incumplida`; una promesa sin monto suma 0. |
| S4 · contactos de hoy | Gestiones **manuales** de hoy (día de Guatemala): sin `link_pago_generado` y sin envíos automáticos. En vivo, no espera el cierre. |
| S4 · meta | Recuperación del asesor en el período ÷ su meta prorrateada, en %. Puede pasar de 100. `null` si no tiene meta. |
| S4 · rescate | **Recuperados ÷ (recuperados + escalados)** del asesor en el período, en %: de los movimientos de bucket de su cartera, cuántos fueron una mejora (las mismas bajadas y subidas de la tarjeta «Migración de bucket», cierre diario más lo de hoy en vivo). No depende del tamaño de la cartera. Sin movimientos queda `null` («—»), no 0. Definición acordada el 2026-10-12 (la primera propuesta, bajadas ÷ cuentas con mora, daba 0.3 % para todos y se redondeaba a 0). |
| S1 · listos para Prejurídico | B4 lo asigna el sistema (4 cuotas vencidas). «Listos» = créditos del equipo en **B3**, sin convenio vivo ni promesa vigente, cuya siguiente cuota sin pagar (la 4.ª) vence en **7 días o menos**. |
| S1 · resueltas hoy | Solo las que resolvió **el supervisor de la sesión** hoy (día GT), aprobadas o rechazadas. No cuentan las canceladas ni las `sin_efecto`. |
| S2 · sin contacto | Una sola regla: sin gestión **manual** (excluye `link_pago_generado` y las automáticas) en más de **3 días hábiles**. Vale para el conteo S2, la categoría `sin_contacto` de la cola y el filtro de la cartera. La alerta `sin_contacto_3d` conserva su ancla en la subida de bucket. |

---

## Cómo quedó cada tarea

### S3 · KPIs del equipo

- **Equipo** = asesores activos del pool con buckets (el mismo conjunto de la tabla Equipo). Se cruza con el usuario del CRM por `email_cash_in` = `user.email`.
- **Períodos**: `rangosDesempeno` (día, semana, mes y el período anterior).
- **Recuperación**: una llamada a cartera por rango (`GET /reportes/recuperacion-por-asesor-rango` con la lista de asesores del pool). La recuperación se atribuye al asesor **actual** del crédito.
- **Cada bloque falla solo**: si una fuente no responde, ese campo llega `null` y el front muestra «—».
- Pruebas de las reglas en `lib/supervision-kpis.test.ts`.

### S4 · Tabla Equipo

- Una fila por asesor del pool. `contactosHoy` y `rescate` llegan `null` si el asesor no tiene usuario en el CRM. `rescate` también es `null` si no hubo ningún movimiento de bucket en el período.
- Corrección de textos: el cierre diario **no** corre a las 22:00 sino a las 00:15 (hora de Guatemala) del día siguiente; los comentarios del doc 17 y del front que dicen 22:00 están desfasados.

---

## Pruebas hechas

**PR 1 (S3, S4), 2026-10-12:**
- `lib/supervision-kpis.test.ts` (6, en verde): porcentajes, meta del equipo, meta cumplida, rescate (con y sin movimientos), cuentas con mora, montos.
- `bunx tsc -b` en `apps/crm/apps/server`: sin errores.
- `biome check` acotado a los archivos tocados: sin errores.
- **No se probó contra base de datos.** Pendiente de prueba con `call` de oRPC contra dev.

---

## Pendiente de front

- **S3**: el tooltip de «Cuentas curadas» (`desempeno-equipo.tsx`) describe «sin mora y siguen en su bucket»; debe decir que son las cuentas que bajaron de bucket en el período. El texto «22:00» del cierre diario (mismo archivo) debe decir 00:15.
- **S4**: el punto de estado de cada fila usa `rescate ?? agenda`, pero el showcase de ejemplo lo calcula con la meta. Confirmar con diseño cuál manda.
