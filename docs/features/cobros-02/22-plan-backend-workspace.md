# 22 · Workspace de cobros: plan y avance del backend

> **Issue:** #1873 · **Tareas:** W1–W5 del [doc 16](./16-workspace-backend.md)
> **Rama:** `jalvarez-cobros` · un commit por PR, sin PR abiertos todavía
> **Regla:** solo backend. El front ya está conectado (PR #1872) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza al cerrar cada PR.

---

## Estado

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **W1** | Datos de la gestión (dirección, participante, teléfono contactado) | ✅ Hecho en el PR 1 · migración `0079` (CRM) | `contactos_cobros` · `createContactoCobros` · `getHistorialContactos(Paginado)` |
| **W2** | Solicitud de rebaja de mora con aprobación | ⏳ PR 2 | Pendiente |
| **W3** | Escalar a Jurídico con aprobación | ⏳ PR 3 | Pendiente |
| **W4** | Abono inicial dentro del convenio | ⏳ PR 4 | Pendiente |
| **W5** | Alertas leídas por grupo + job de 30 días | ✅ Hecho en el PR 1 · tabla en `0079` | `alertas_caso_leidas_cobros` · `alertas-caso.ts` · `jobs/alertas-caso-leidas.ts` |

> [!WARNING]
> **La migración `0079_cobros_workspace_gestion_alertas.sql` hay que correrla (idempotente) antes de desplegar el server del CRM.** Sin ella, `createContactoCobros` falla al insertar (`direccion_contacto`, `participante_nombre`, `telefono_contactado`) y `getAlertasCaso` falla al leer las marcas. No se corrió en ninguna base desde este PR.

---

## Decisiones (2026-10-09)

| Tarea | Decisión |
| --- | --- |
| W1 | Lo que ya guardaba B8 (`hora_proximo_contacto`, `medio_proximo_contacto`, `participante_tipo`) se reutiliza. Nuevas: `direccion_contacto`, `participante_nombre`, `telefono_contactado`. En una edición de promesa solo se escribe lo que llega; no se pisa con NULL. |
| W5 | Tabla propia `alertas_caso_leidas_cobros`, por (caso, destinatario, clave). No se usa `notifications.status = 'read'`: ese estado es la campanita y `getAlertasCaso` lo trata como abierto. |
| W5 | Un grupo leído reaparece solo si el job genera una repetición **posterior** a la que el usuario vio al marcarlo. |
| W5 | El job diario marca como leídas (origen `automatico`) los grupos cuya última repetición tiene más de 30 días. No cambia `notifications`. Corre al arrancar y cada 24 h; es idempotente. |
| W2 | Al aprobar, **se aplica en cartera** con un endpoint de condonación parcial. El asesor pide un monto ≤ mora acumulada. |
| W3 | Solicitud + aprobación del supervisor. Al aprobar, cartera clava el crédito en B5 con una marca `juridico_desde` que el motor no revierte y lo reasigna fuera del asesor. Contradice la decisión 6 del [doc 08](./08-plan-convenios-y-recuperacion.md) («no hay botón de pasar a jurídico»). |
| W4 | El convenio no se aprueba hasta que contabilidad valide el abono inicial. |
| Migraciones | Una por feature, con número nuevo: CRM `0079` (W1 + W5), `0080` (W2), `0081` (W3); cartera-back `drizzle/cobros-02/0023`–`0025`. Se aplican a mano, como las anteriores. |

---

## Cómo quedó cada tarea

### W1 · Datos de la gestión

- **Schema** (`db/schema/cobros.ts`): `direccionContacto` (`saliente`|`entrante`, CHECK), `participanteNombre`, `telefonoContactado`.
- **Escritura** (`routers/cobros.ts`, `createContactoCobros`): los datos llegan en `direccion`, `participante` y `telefonoContactado`, se separan del payload y se guardan en INSERT y UPDATE. En UPDATE solo se escriben los que llegan.
- **Lectura**: `getHistorialContactos` y `getHistorialContactosPaginado` devuelven los cuatro campos. El front todavía no los pinta.

### W5 · Alertas leídas

- **Agrupación pura** (`lib/alertas-caso.ts`): agrupa por tipo (o título si no hay tipo), deduplica por evento entre destinatarios y separa las leídas. Tiene pruebas en `lib/alertas-caso.test.ts` (5, en verde).
- **Consultas** (`lib/alertas-caso-db.ts`): filas abiertas del caso, marcas del usuario y upsert del grupo.
- **`getAlertasCaso`**: deja fuera los grupos marcados como leídos.
- **`getAlertasLeidasCaso`**: lista los grupos leídos con cuándo y quién («Automático (más de 30 días)» o el nombre). Devuelve `AlertaLeidaCaso[]`; ya no es `null`.
- **`marcarAlertaCasoLeida`**: toma la alerta elegida y todas sus repeticiones abiertas, guarda la fecha más reciente como `leida_hasta` y responde `{ marcada: true }`. Si la alerta ya no está abierta, responde NOT_FOUND.
- **Job** (`jobs/alertas-caso-leidas.ts`, flag `alertasCasoAntiguasLeidas` en `JOBS_PROGRAMADOS`): agrupa en SQL por (caso, destinatario, clave) y marca los grupos con última repetición anterior a 30 días. El upsert no pisa una marca manual más nueva.

---

## Pruebas hechas

**PR 1 (W1, W5), 2026-10-09:**
- `lib/alertas-caso.test.ts` (5, en verde): agrupación por tipo y dedup entre destinatarios, clave por título, grupo leído que sale de activas, grupo que reaparece con repetición nueva, texto de «leída por».
- `lib/ficha-complementos.test.ts` sigue en verde (no se tocó).
- `bunx tsc -b` en `apps/crm/apps/server`: sin errores.
- `biome check` acotado a los archivos tocados: sin errores.
- **No se probó contra base de datos.** La 0079 no se corrió en dev ni en prod. Pendiente de prueba con `call` de oRPC contra dev.

---

## Pendiente de front

- **W1**: pintar «Llamada entrante», «Habló con: X (codeudor)» y el teléfono contactado en la línea de tiempo (`workspace/contexto-caso.tsx`, `routes/cobros/$id.tsx`).
- **W5**: habilitar «Marcar como leída» y «Ver alertas leídas» (`contexto-caso.tsx`, `routes/cobros/$id.tsx`). Quitar el prefijo `alerta-` del id antes de llamar a `marcarAlertaCasoLeida`.
- **W2 a W4**: formularios y bloques «Pronto» (`gestion/acciones.ts`, `convenio-modal.tsx`) y los tipos nuevos en la bandeja de solicitudes.

## Decisiones abiertas

- W3: qué pasa al salir de Jurídico (fuera de alcance del PR 3).
- W4: qué pasa si contabilidad rechaza el abono después de aprobado el convenio (se decide con producto; el PR 4 bloquea la aprobación hasta validar).
