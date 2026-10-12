# 23 · Supervisión de cobros: plan y avance del backend

> **Issue:** #1891 · **Tareas:** S1–S6 del [doc 17](./17-supervision-backend.md)
> **Rama:** `jalvarez-cobros` · un commit por PR, sin PR abiertos todavía
> **Regla:** solo backend. El front ya está conectado (PR #1890) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza con cada PR.

---

## Estado

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **S1** | Pendientes sin fuente | ✅ Código en el PR 2 (sin migración) | `services/supervision-pendientes.ts` · `lib/prejuridico.ts` · cartera `GET /payment-agreements/decisiones/conteo` |
| **S2** | «Sin contacto» del equipo a 3 días hábiles | ✅ Código en el PR 2 (sin migración) | `lib/sin-contacto.ts` · `contarSinContactoEquipo` · cola del día y filtro `sin_gestion_48h` |
| **S3** | KPIs del equipo por período | ✅ Código en el PR 1 (sin migración) | `services/supervision-complementos.ts` · `lib/supervision-kpis.ts` · `getSupervisionComplementos.kpis` |
| **S4** | Columnas de la tabla Equipo | ✅ Código en el PR 1 (sin migración) | `getSupervisionComplementos.equipo` |
| **S5** | Filtros y paginación real de la Cartera general | ✅ Código en el PR 3 (sin migración) | `getTodosLosCreditos` · `enviarWhatsappMasivoCobros` · `getAlertasPromesas` · `ejecutarColaDia` |
| **S6** | Reasignación en bloque transaccional | ✅ Código en el PR 4 (sin migración) | cartera `POST /buckets/creditos/reasignar-lote` · `lib/buckets-reasignacion-lote.ts` · CRM `reasignarAsesorCreditosLote` |

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
- **Cifras completas o nada** (revisión del PR 1):
  - Si los movimientos de bucket de **hoy** no se pudieron calcular, `cuentasCuradas` y `rescate` llegan `null` (no cifras históricas presentadas como completas).
  - Bajadas, subidas y promesas se guardan por usuario del CRM: si algún asesor activo del pool no tiene usuario con el mismo correo, `cuentasCuradas` y `promesasCumplidas` del equipo llegan `null` y el servidor registra un aviso con los `asesorId`. Recuperación y meta no dependen de ese vínculo.
  - El universo de `cuentasCuradas.total` sale de `porAsesor` filtrado por los asesores del equipo (B1 en adelante), no del resumen global, que incluye asesores inactivos o fuera del pool.
- Pruebas de las reglas en `lib/supervision-kpis.test.ts`.

### S4 · Tabla Equipo

- Una fila por asesor del pool. `contactosHoy` y `rescate` llegan `null` si el asesor no tiene usuario en el CRM. `rescate` también es `null` si no hubo ningún movimiento de bucket en el período.
- Corrección de textos: el cierre diario **no** corre a las 22:00 sino a las 00:15 (hora de Guatemala) del día siguiente; los comentarios del doc 17 y del front que dicen 22:00 están desfasados.

### S1 · Pendientes

- **Documentos por autorizar**: solicitudes de F6 en `pendiente` (`solicitudes_documentos_cobros`).
- **Rebajas por revisar**: solicitudes de W2 en `pendiente` o `error_aplicacion` (las que el supervisor todavía puede resolver).
- **Listos para Prejurídico**: no hizo falta un endpoint nuevo. `GET /cuotas/proximas-vencer` de cartera (con `dias=0..7`, `solo_al_dia=false`, `buckets=3`) ya trae bucket del motor, estado, cuotas vencidas reales y días para vencer. La regla está en `lib/prejuridico.ts`: B3, estado ACTIVO o MOROSO, exactamente 3 vencidas reales, 4.ª cuota en 7 días o menos, y sin promesa vigente **en su caso vigente** (una promesa olvidada en un caso viejo no cuenta).
- **Aprobaciones resueltas hoy** (del supervisor de la sesión, aprobadas o rechazadas, nunca canceladas):
  - Recuperaciones: `recuperaciones_vehiculo` (`decidido_por`, `decidido_at`, estado aprobada o rechazada).
  - Apagados y reactivaciones: `inmovilizaciones_unidad` (se cuentan los eventos de decisión de hoy en `inmovilizaciones_unidad_eventos`, así una aprobación que luego se cancela no resta).
  - Rebajas, Jurídico y Documentos: `resuelto_por`, `resuelto_en`.
  - Convenios: viven en cartera (`convenio_decisiones`) y no había consulta por fecha ni por quien decidió. Se agregó `GET /payment-agreements/decisiones/conteo?decidido_por_email&desde[&hasta]` (solo cuenta, mismo gate que el resto del router). El cliente es `getConvenioDecisionesConteo`. La tabla vieja `convenios_pago.aprobado_por` es legado y no se usa.
  - **Dos campos, por la barra «x de y»:** el front calcula el avance como pendientes + resueltas, y solo tiene en pendientes convenios, recuperaciones y apagados. `aprobacionesResueltasHoy` suma solo esos tres tipos; rebajas, documentos y Jurídico salen aparte en `otrasResueltasHoy {rebajas, documentos, juridico}` para que, al resolver un documento con otro pendiente, no se vea «1 de 1» al 100 %.
  - Si **una** fuente no responde, el total llega `null` (no un número corto).

### S2 · Sin contacto

- **Regla única** en `lib/sin-contacto.ts`: al menos 3 días hábiles **completos** (regla de oro de `business-days-gt.ts`: lunes a viernes, y sábado o domingo si es 15 o fin de mes) desde el día siguiente a la última gestión **manual**. Es el mismo conteo de la alerta `sin_contacto_3d`.
- **Cola del día** (`getColaDia`): `sin_contacto` usa la regla única. `diasSinContacto` que devuelve la cola ahora son días hábiles. «Contactado hoy» del SLA sigue contando cualquier gestión.
- **Cartera** (`sifcosPorFiltroGestion`): el filtro `sin_gestion_48h` usa la misma ventana (`inicioVentanaConContacto`). Se evalúa solo en el caso vigente de cada SIFCO (como la cola y el conteo). Exige además al menos una gestión manual previa: quien nunca fue contactado no entra, igual que en la cola y en el conteo del Dashboard (`sin_contactar_hoy` no cambia). La clave se mantiene para no romper el contrato con el front.
- **Conteo del equipo** (`contarSinContactoEquipo`): mismo universo que la cola sin filtro de asesor (`getColaDiaSLA`) y misma regla, así el número cuadra con la lista a la que enlaza el Dashboard.
- **Quien nunca tuvo una gestión manual no califica** (se mantiene la decisión del doc de la cola: no se inventa una fecha base). Un crédito con solo envíos automáticos cuenta como nunca contactado.
- La alerta `sin_contacto_3d` **no cambia**: conserva su ancla en la subida de bucket.
- **Rendimiento:** el conteo del equipo recorre toda la cola y tarda unos 3 s (medido en la BD local: 3,030 ms de los 3,715 ms de `getSupervisionComplementos`; el resto del endpoint, 54 ms por período). No depende del período, así que se guarda **60 s** en memoria (`lib/memo-ttl.ts`, usado en `routers/supervision-cobros.ts`): cambiar entre Día, Semana y Mes ya no lo recalcula. La primera carga, o la primera después de 60 s, sigue tardando esos ~3 s. Si hace falta bajarlo más, la solución de fondo es una consulta SQL propia en vez de armar toda la cola.

### S5 · Cartera general

**Filtros nuevos de `getTodosLosCreditos`** (se pueden combinar entre sí y con los de siempre):
- `asesorId`: asesor dueño del crédito, **id exacto**. Viaja a cartera como `asesor_id` (ya lo soportaba; faltaba en el cliente del CRM, GET y POST). El filtro por `emailCobrador` sigue siendo parcial (ILIKE).
- `cola`: `sla_hoy`, `promesa_hoy`, `vence_hoy`, `incumplida`, `promesa_proxima`, `sin_contacto`, `llamada_hoy`, `sin_intento_hoy`. Usa **la misma regla y el mismo alcance por rol** que `getColaDia`.
- `alertaPromesa`: `vencida`, `vence_hoy`, `por_vencer`, `programada`. `alertaConvenio`: `vencida`, `vence_hoy`, `por_vencer`, `proxima`.
- **Alcance de la cola:** con `cola`, la lista ya define el alcance (pool del bucket y coberturas, como `getColaDia`), así que a cartera **no** se le reenvía el dueño directo (`asesor_id` ni el correo de la sesión del asesor); si no, se perderían créditos que el asesor trabaja por pool o cobertura. Un supervisor que manda un correo explícito lo conserva. Lo mismo para el correo de la sesión con `alertaPromesa` y `alertaConvenio` (su fuente ya limita al asesor y a quien cubre). `asesor_id` sí se sigue enviando con las alertas, porque ellas filtran por dueño directo. Con `alertaPromesa` y `asesorId`, si la consulta de dueños de cartera falla, el filtro **falla** en vez de devolver una lista vacía.
- `cola`, `alertaPromesa` y `alertaConvenio` también aceptan **`todas`** (el segmento completo, sin filtrar por categoría), igual que los selectores de la Cartera general; con `todas` en la cola o en las alertas de promesa también se piden los buckets 0 a 5.
- `sinAcuerdo`: sin convenio, sin promesa vigente y sin promesa fallida en los últimos 30 días (`estadoGestionDe`). Un crédito sin caso en el CRM cuenta como sin acuerdo.

**Cómo funciona.** Cada filtro se resuelve en el CRM a una lista de SIFCOs, se intersecta con las demás (como ya hacían etiquetas, DPI y los chips de gestión) y viaja a cartera en `numeros_credito_sifco`. Cartera pagina y cuenta con SQL, así que **`total` y la paginación son exactos más allá de los 200 SIFCOs** (a partir de 50 SIFCOs la llamada es POST, que no tiene tope).

**Reuso sin duplicar reglas.** Para no copiar la lógica, el cuerpo de tres procedimientos pasó a funciones del mismo archivo: `ejecutarColaDia` (con la opción `sinPaginar`), `ejecutarAlertasPromesas` y `ejecutarAlertasConvenios`. Los procedimientos `getColaDia`, `getAlertasPromesas` y `getAlertasConvenios` las llaman igual que antes. **El diff de `routers/cobros.ts` es grande por el movimiento y la re-indentación de ese código, no por cambios de lógica.**

**Otros:**
- `getAlertasPromesas` devuelve `asesorId` en cada fila (antes solo el nombre).
- `getTodosLosCreditos` devuelve `asesorId` en cada fila.
- `enviarWhatsappMasivoCobros` acepta `asesorId`, `cola`, `alertaPromesa` y `alertaConvenio`, con la misma resolución, para que el envío llegue exactamente a lo que muestra la pantalla. **Sigue sin aceptar** `sinAcuerdo`, `filtroGestion` ni rango de capital: el front debe seguir bloqueándolo con esos filtros.
- Varios buckets a la vez: `getTodosLosCreditos` ya aceptaba `buckets` como lista; no hubo que cambiar nada en el servidor.

### S6 · Reasignación en bloque

- **Cartera** — `POST /buckets/creditos/reasignar-lote` `{ credito_ids (1 a 200), asesor_nuevo_id, motivo, usuario_email? }` (`controllers/buckets/reasignarAsesorLote.ts`). Mismo gate de rol que la reasignación individual.
- **Todo o nada.** Primero se valida el lote completo con la regla de `reasignarAsesorManual` (reglas puras en `lib/buckets-reasignacion-lote.ts`):
  - el crédito existe (`no_encontrado`);
  - está dentro del funnel (`fuera_del_funnel`);
  - el asesor destino está en el pool activo del **bucket actual de cada crédito** y sigue activo (`asesores.activo`), como en recuperación y Jurídico (`asesor_no_elegible`). Los créditos que **ya son** del destino se omiten antes de esta validación (no requieren escritura).
  - Si hay **un solo** error responde 400 con `errores` por crédito y **no escribe nada**.
  - Los créditos que ya son del asesor destino se **omiten** (`omitidos`, no es un error). Si todos lo eran, responde éxito sin escribir.
- **Escritura**: una transacción. Primero pide, **sin esperar**, los locks de los jobs de moras (00:05) y de convenios (00:30), la misma política de la recuperación de vehículo y Jurídico: si alguno corre responde 409 «bucket ocupado» (reintentar), porque esos jobs cambian bucket y dueño sin tomar los locks por crédito. Después toma `pg_advisory_xact_lock` de **todos** los créditos pedidos (presupuesto de espera **total** de 5 s para todos los locks, los de crédito y los de elegibilidad del destino, con `lock_timeout` y `statement_timeout` recalculados con lo que queda; 409 si vence). Las filas de `creditos` del lote se bloquean con `FOR UPDATE` (en orden de id) antes de releer: quien cambia el estado de un crédito (cancelar, incobrable) no toma los locks de asesor, y así espera al lote o confirma antes de la relectura. El asesor destino y su fila en el pool se retienen con `FOR SHARE` hasta el commit, para que desactivarlo o sacarlo del pool espere a que termine el lote. Los ids (de crédito y de asesor) se validan contra el rango de un `integer` de PostgreSQL (hasta 2,147,483,647), así un id enorme da 400 y no un 500 de la base. Guarda el dueño de cada crédito **antes** de esperar los locks y lo compara con la relectura bajo lock: si otro lote o edición lo cambió mientras tanto, el lote responde 409 en vez de pisar la asignación recién confirmada **en orden de id** y, con los locks tomados, lee y valida el lote completo (dueño, bucket y pool vigentes, también de los que se omiten) dentro de la misma transacción (dos lotes que se cruzan no se bloquean entre sí), un solo `UPDATE ... FROM (VALUES ...)` con compare-and-swap sobre el dueño leído, y la bitácora `credito_asesor_historial` (origen `API_MANUAL`, motivo, usuario). Si algún dueño cambió mientras tanto (p. ej. terminó un traslado masivo) se deshace **todo el lote** con 409.
- **Reintento seguro**: repetir el mismo lote no duplica nada; lo ya reasignado vuelve como `omitidos`.
- **CRM** — `reasignarAsesorCreditosLote` (`cobrosSupervisorProcedure`, `{ creditoIds, asesorNuevoId, motivo }`) en `routers/supervision-cobros.ts` (router aparte, para no acercar `cobrosAppRouter` al límite TS7056). Invalida las cachés de cartera y llama a `reconciliarAvisosLlamarCliente()` como la individual. Los errores por crédito viajan en el mensaje y en `data.errores`. Si el POST del lote no obtiene respuesta (timeout o conexión caída) el servidor puede confirmar después, así que la caché se vuelve a invalidar a los 15 s, 1 min y 3 min. La caché del cliente de cartera lleva una generación que sube con cada invalidación: una lectura que ya estaba en vuelo cuando se reasignó el lote no guarda su respuesta (datos viejos) en la caché. Solo 400 y 409 de cartera se traducen a `BAD_REQUEST` y `CONFLICT`; cualquier otra falla (401, 403, 404, 5xx, red) sale como `INTERNAL_SERVER_ERROR`, para que no parezca un dato inválido.
- **Fuera de alcance**: el traslado masivo de cartera completa de un asesor (`previsualizarTraslado` / `confirmarTraslado`) no cambia.

---

## Pruebas hechas

**PR 1 (S3, S4), 2026-10-12:**
- `lib/supervision-kpis.test.ts` (6, en verde): porcentajes, meta del equipo, meta cumplida, rescate (con y sin movimientos), cuentas con mora, montos.
- `bunx tsc -b` en `apps/crm/apps/server`: sin errores.
- `biome check` acotado a los archivos tocados: sin errores.
- **No se probó contra base de datos.** Pendiente de prueba con `call` de oRPC contra dev.

**PR 2 (S1, S2), 2026-10-12:**
- `lib/sin-contacto.test.ts` (5): conteo de días hábiles, fin de semana y quincena, la gestión de hoy no suma, ventana reciente.
- `lib/prejuridico.test.ts` (5): bucket, estado, vencidas, ventana de 7 días, deduplicación y promesa vigente.
- `lib/cola-dia.test.ts` (30, en verde) con el umbral nuevo.
- `bunx tsc -b` en `apps/crm/apps/server` y `tsc` de cartera-back sobre `paymentAgree.ts`: sin errores.
- **No se probó contra base de datos ni con cartera levantada.**

**PR 3 (S5), 2026-10-12:**
- `bunx tsc -b` en `apps/crm/apps/server`: sin errores. `bun test src/lib`: mismos 81 fallos que en la rama sin los cambios (de ambiente: requieren base de datos), ninguno nuevo.
- Las reglas reutilizadas ya tenían pruebas (`lib/cola-dia.test.ts`, `lib/seguimiento-cobros`); lo nuevo es la composición con la base de datos y cartera, **que solo se prueba contra dev**.
- **Pendiente:** con más de 200 SIFCOs en cola o alertas, comparar `total` de `getTodosLosCreditos` contra el conteo de la fuente; `asesorId` contra el filtro por correo.

**PR 4 (S6), 2026-10-12:**
- `lib/buckets-reasignacion-lote.test.ts` (6, en verde, en cartera): lote válido con dueño anterior, omitido sin error, asesor fuera del pool del bucket, crédito inexistente o fuera del funnel, normalización y tope de ids.
- `tsc` de cartera-back: sin errores en los archivos nuevos (el proyecto trae errores previos en otros archivos). `bunx tsc -b` del CRM: sin errores. `tsc` del web: sin TS7056 (un error previo y ajeno en `routes/juridico/$leadId.tsx`).
- **Pendiente de probar contra dev con cartera levantada**: lote feliz (bitácora, un renglón por crédito), lote con un crédito fuera del pool (400, sin cambios), crédito ya asignado (omitido), reintento, y dos lotes cruzados a la vez.

**Prueba de punta a punta en la BD local (2026-10-12), con el flujo real** (procedimientos del front con la sesión de cada usuario, pagos validados en carteraFront y los jobs reales `checkPromesasPago`, `generarCierreDiario` y el motor de moras):
- **S3/S4 confirmados:** Recuperación (pagos pendientes y validados, Q24,137.84 el día), meta (Q6,296.29 el día, Q170,000 el mes), promesas **1 cumplida de 3 pactadas**, cuentas curadas **5** (bajadas reales del motor: 3 de Rosales, 1 de Sente y 1 de Gamboa; la subida de Gamboa no cuenta), contactos de hoy por asesor y Meta por asesor.
- **S1/S2 confirmados:** documentos y rebajas por revisar (2 y 2), aprobaciones resueltas hoy por el supervisor (2: un documento aprobado y una rebaja rechazada) y sin contacto (baja con cada gestión de hoy).
- **Hallazgos:**
  - **Los pagos no se pueden retrodatar:** `registrarPagoCompleto` acepta `fechaPago`, pero cartera registra el pago con la fecha de hoy. Con datos reales, Día, Semana y Mes coinciden en lo registrado hoy; solo cambian la meta y el período anterior.
  - **La fecha de pago es la de registro, por diseño de cartera** (`paymentRegistrationDate()`); la fecha real de la boleta va aparte en `fecha_boleta`. La recuperación del día cuenta lo registrado ese día: un depósito del 30 registrado el 1 cuenta para el mes siguiente. Se deja así para no divergir de los demás reportes de cartera; si el supervisor lo necesita por fecha de boleta, se decide con contabilidad. Conviene una nota en el front: «por fecha de registro del pago».
  - **La recuperación cuenta los pagos pendientes de validar** (`validated`, `pending` y `no_required`, regla de B2). Sube al registrar el pago, no al validarlo.
  - **Una promesa se cumple cuando el pago cubre su cuota; el dinero se aplica cuota por cuota, en orden.** En el crédito 3 el pago de la cuota 20 no la cubrió porque ese crédito ya traía boletas pendientes de enero sobre las cuotas 21 y 22 que absorbieron el dinero (la fila de la cuota 20 quedó con 0.00 aplicado). Repetida la prueba en el crédito 22, un pago exacto de la cuota la cubrió (lo que faltaba de la cuota 16 más lo que sobró pasó a la 17) y, validado el pago, `checkPromesasPago` marcó la promesa cumplida: 2 cumplidas de 4 pactadas. **No es un defecto de cartera ni de la supervisión**, es un efecto de los datos de ese crédito.
  - **El motor de moras reasigna créditos al bajar de bucket** (4 en la prueba). Las bajadas se atribuyen al **dueño de la mañana** (`cierre_diario`), no al nuevo.
  - **«Rescate» salía en 0 % para todos** con la primera definición (3 bajadas contra 877 cuentas con mora = 0.3 %). **Resuelto:** ahora es recuperados ÷ (recuperados + escalados). Con los datos de la prueba: Sente 100 % (1 de 1), Rosales 100 % (3 de 3), Gamboa 50 % (1 de 2) y Rivas «—» (sin movimientos), igual que la tabla de movimientos del cierre diario.
- **S5 probado contra el servidor local, con la sesión de un supervisor:** las 8 categorías de la cola, las 4 de alertas de promesa, las 4 de alertas de convenio, `asesorId` contra el correo (55 y 55) y «sin acuerdo» dan los mismos totales que sus fuentes. **Defecto encontrado y corregido:** la cola incluye créditos INCOBRABLE (B5) y la cartera, sin etapa, consultaba solo `ACTIVO` (sin contacto 445 contra 442, sin intento hoy 1,659 contra 1,585: 74 INCOBRABLE). Con `cola` o `alertaPromesa` se piden ahora los buckets 0 a 5 y cuadran (445 y 1,659). Las alertas de convenio no lo necesitan.
- **S6 probado contra el servidor local:** (A) 3 créditos de Sente en B2 a Gamboa: se reasignan los 3 con su bitácora `API_MANUAL`, motivo y correo del supervisor; (B) el mismo lote otra vez: los 3 como `omitidos`, sin filas nuevas; (C) un lote con un crédito válido y otro cuyo asesor destino no está en el pool de su bucket: error y **ningún crédito se movió**; (D) destino fuera del pool: error; (E) revertir el lote A: correcto.
- **Cobertura de lo que faltaba (2026-10-12, servidores y BD locales):**
  - **Rendimiento de S5, medido:** los filtros por cola tardaban **3.3 a 4.6 s en cada llamada**, incluso al cambiar de página (la cola se recalculaba). Ahora la lista de SIFCOs de cada categoría se guarda **30 s** por usuario, rol, categoría y asesor (`sifcosPorColaMemo`): la segunda llamada baja a ~40 ms y la página 2 a ~200 ms. Las alertas de promesa y de convenio tardan ~100 ms y «sin acuerdo» ~1.3 s, sin caché. Efecto a tener en cuenta: una gestión nueva puede tardar hasta 30 s en reflejarse en la lista filtrada por cola.
  - **S6 con concurrencia:** 4 lotes simultáneos sobre los mismos 3 créditos: uno se aplica y los otros 3 responden `CONFLICT` sin mover nada; la bitácora queda con una sola fila por movimiento.
  - **Listos para Prejurídico:** una consulta SQL independiente da 40, igual que el Dashboard.
  - **Resueltas hoy:** además del documento y la rebaja, se probó un **convenio** (rechazado por el supervisor: 2 a 3, y los pendientes bajan de 13 a 12) y una **recuperación de vehículo** (solicitada por el asesor con su checklist y rechazada por el supervisor: 3 a 4, sin mover el crédito).
  - **WhatsApp masivo con los filtros nuevos:** con `cola=promesa_hoy` (1 crédito) se envió 1 mensaje a un teléfono de la lista de prueba (`TEST_MESSAGE=true`), no al cliente; registró su gestión automática.
  - **Límites que no se pudieron cubrir:** (1) el conteo de **rebajas en `error_aplicacion`**: con la cartera apagada, aprobar la rebaja se queda esperando antes de reclamarla, y ese estado solo aparece si cartera falla después de reclamar; la consulta es `estado IN ('pendiente','error_aplicacion')` y el estado lo cubren las pruebas del doc 22; (2) los **apagados y reactivaciones**, que dependen de Wialon y no se pueden probar en local; su consulta es `decidido_por` y `decidido_at` de `inmovilizaciones_unidad` con el mismo patrón que la recuperación.
- La validación de pagos deja la factura en `PENDIENTE`: no emite DTE (lo emite contabilidad aparte).

---

## Pendiente de front

- **S3**: el tooltip de «Cuentas curadas» (`desempeno-equipo.tsx`) describe «sin mora y siguen en su bucket»; debe decir que son las cuentas que bajaron de bucket en el período. El texto «22:00» del cierre diario (mismo archivo) debe decir 00:15.
- **S1**: los chips «Rebaja» y «Documentos» de Aprobaciones pendientes no tienen filas (`solicitudes/normalizar.ts`). Fuentes: `getSolicitudesRebajaMora`, `getSolicitudesDocumentos` (y `getSolicitudesJuridico`, que no tiene chip). Cuando existan los chips, sumar `otrasResueltasHoy` a las resueltas **y** esas solicitudes a los pendientes de la barra «x de y» al mismo tiempo (hoy el denominador solo tiene convenios, recuperaciones y apagados). Los tres contadores no tienen `destino`, así que no son enlaces.
- **S2**: las etiquetas «Sin contacto > 5 días (equipo)» (fallback) y «48 h» de la cartera deben decir «3 días hábiles». `cola=sin_contacto` ya usa la regla nueva. `diasSinContacto` de las filas ahora son días hábiles.
- **S5**: `cartera-general/use-cartera-general.ts` debe mandar `asesorId`, `cola`, `alertaPromesa`, `alertaConvenio` y `sinAcuerdo` a `getTodosLosCreditos` en vez de combinar `getColaDia`, `getAlertasPromesas` y `getAlertasConvenios` en el cliente; con eso desaparecen el aviso de «solo la página visible», el filtrado de «sin acuerdo» sobre la página y la llamada extra con `estadoMora: "en_convenio"` (cartera ya incluye `EN_CONVENIO` cuando no hay etapa; confirmarlo contra datos reales antes de quitarla). El filtro por asesor de las alertas de promesa pasa de nombre a `asesorId`. El botón de WhatsApp masivo se puede desbloquear para asesor y categoría (no para `sinAcuerdo`, gestión ni capital).
- **S6**: `cartera-general/reasignar-bloque.tsx` debe llamar `reasignarAsesorCreditosLote` (tipado por `orpcAparte`) en vez del ciclo de `reasignarAsesorCredito`: una sola llamada con los `creditoIds`, el `asesorNuevoId` y el `motivo`. Mostrar `omitidos` («ya eran de ese asesor») y, ante error, la lista de `data.errores` (`credito_id`, `codigo`, `message`) sin reasignar nada. El pre-chequeo por nombre de asesor (`reasignar-bloque.tsx:383`) se puede quitar: lo valida el servidor.
- **Indicador de carga al cambiar Día / Semana / Mes** (`dashboard-supervisor.tsx`): la consulta usa `placeholderData: keepPreviousData`, así que mientras llega el período nuevo las tarjetas **siguen mostrando los números del período anterior** y parece que «no cambian». Hay que usar `isPlaceholderData` (o `isFetching`) de esa consulta para atenuar las tarjetas de «Desempeño del equipo» y mostrar un spinner o el esqueleto mientras carga; el componente `TarjetaCargando` de `desempeno-equipo.tsx` ya existe. Con el backend actual la espera típica es de menos de 0.2 s con el caché caliente y de ~3 s en frío.
- **S4**: el punto de estado de cada fila usa `rescate ?? agenda`, pero el showcase de ejemplo lo calcula con la meta. Confirmar con diseño cuál manda.
