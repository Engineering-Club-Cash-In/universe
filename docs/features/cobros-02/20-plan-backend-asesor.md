# 20 · Dashboard del asesor y Mi Cartera: plan y avance del backend

> **Issue:** #1862 · **Tareas:** B2–B10 del [doc 13](./13-dashboard-asesor-backend.md)
> **Rama:** `jalvarez-cobros` → PRs secuenciales a `COBROS-02`
> **Regla:** solo backend. El front ya está conectado (PR #1861) y no se toca.

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza al cerrar cada PR.

---

## Estado

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **B2** | Recuperación del asesor por período | ✅ Mergeado (#1904) | cartera-back `GET /reportes/recuperacion-por-asesor-rango` · CRM `getMiDesempeno` |
| **B3** | Metas de recuperación por asesor (Q) | ✅ Mergeado (#1904) · ⚠️ falta UI de captura (front) | Tabla `metas_asesor_cobros` (migración 0077) · `getMetasAsesor` / `upsertMetasAsesor` |
| **B4** | Deuda vencida real por crédito | ✅ Mergeado (#1901) | cartera-back `monto_vencido` en `/getAllCredits` · CRM `getTodosLosCreditos` |
| **B5** | Orden de la cartera por bucket del motor | ✅ Mergeado (#1901; el filtro ya estaba) | cartera-back `orden=bucket_motor` · CRM lo manda siempre |
| **B6** | Pagos por confirmar | ✅ En el último PR | `lib/agenda-asesor-cobros.ts` · acción `confirmar_pago` |
| **B7** | Referencias por contactar | ✅ En el último PR | `lib/agenda-asesor-cobros.ts` |
| **B8** | Hora del próximo contacto | ✅ Mergeado (#1902; cubre la parte de hora y medio de W1) | Columnas nuevas en `contactos_cobros` (migración 0077) |
| **B9** | Movimiento de buckets de hoy en vivo | ✅ Mergeado (#1902) | `getMiDesempeno` + `calcularMovimientosBucketDelDia` |
| **B10** | ¿B0 en «atención hoy»? | ✅ Decidido: **no** | Sin código |

PRs mergeados en `COBROS-02`: #1901 (B4 y B5), #1902 (B8 y B9) y #1904 (B2 y B3). B6, B7 y estos docs van en el último PR.

> [!WARNING]
> **La migración `0077_cobros_asesor_backend.sql` ya está corrida en DEV** (viene con el PR #1902). En cualquier otro ambiente hay que correrla antes de desplegar el server del CRM: `cargarSeguimientoPorCaso` lee `contactos_cobros.hora_proximo_contacto`, y sin la columna fallan Mi Cartera, la Cola del día y la Ficha 360. Es idempotente.

---

## Decisiones de negocio (2026-10-07)

| Tarea | Decisión |
| --- | --- |
| B2 | **Recuperación** = lo que los pagos del período aplicaron a cuotas que **ya estaban vencidas** el día del pago (capital, interés, IVA, seguro, GPS y membresías) + la mora pagada. Un pago adelantado o al día no cuenta. |
| B3 | La meta es **mensual en Q**. Para el día y la semana se reparte entre los **días hábiles de lunes a sábado** del mes. |
| B6 | **Pago por confirmar** = boleta del bot de WhatsApp en `revision_manual` o `confirmada_a_verificar`. *(Refinado el 2026-10-08: solo las que llegaron **hoy**, ver B6 abajo. Es una regla nuestra, no de negocio: conviene confirmarla.)* |
| B7 | **Referencias por contactar** = caso con **3 o más intentos sin contacto seguidos** al titular y **sin gestión a referencias en 7 días**. |
| B10 | B0 **sigue fuera** de «Casos que requieren atención hoy». En Mi Cartera sí aparece. |

---

## Cómo quedó cada tarea

### B2 · Recuperación por período

**cartera-back:** `GET /reportes/recuperacion-por-asesor-rango?fecha_desde&fecha_hasta[&asesores][&email_cobrador]`. Controlador: `getRecuperacionPorAsesorRango` en `controllers/reportes.ts`.

- Responde `{ rango, porAsesor: [{ asesorId, nombre, cuotasVencidas, mora, monto }], total }`.
- Recibe una lista de asesores y un rango libre. Así sirve también para S3 (recuperación del equipo, doc 17) y M1 (recuperación por asesor, doc 18).
- Pagos que cuentan:
  - `paymentFalse = false`;
  - `validation_status` en `validated`, `pending` o `no_required`.
  - No cuentan los abonos directos a capital ni los `reset`.
- La recuperación se atribuye al asesor **actual** del crédito, como en los demás reportes por asesor.
- `fecha_pago` se guarda en hora de Guatemala sin zona, así que el rango se compara con las fechas tal cual.
- «Vencida el día del pago» se lee del vencimiento que **el propio pago guardó** al registrarse (`pagos_credito.fecha_vencimiento`), con el de la cuota como respaldo. `updateDueDate` reescribe después los de las cuotas, y un pago viejo no debe pasar de recuperado a no recuperado. Con los datos de la base local, septiembre cambia solo Q1,000 de Q1.74M.
- Las fechas se validan de verdad: `2026-02-30` o `2026-13-01` responden 400 (antes `Date.parse` las aceptaba).

**CRM:** `getMiDesempeno` llama al endpoint dos veces en paralelo: período actual y anterior. El asesor sale del pool con el correo de la sesión, igual que en `getMiPerfilCobros`. Si cartera no responde, `recuperacion` queda en `null` y la card muestra «—». El resto del bloque sigue funcionando.

### B3 · Metas por asesor

- **Tabla:** `metas_asesor_cobros`, con una fila por asesor (`asesor_id` de cartera) y mes, y un índice único para el upsert. Está en la migración 0077.
- **Procedimientos:** `getMetasAsesor({ anio, mes })` (cualquiera de cobros) y `upsertMetasAsesor` (solo supervisor). Este último trabaja en una transacción con `onConflictDoUpdate`; un monto `null` borra la meta.
- **Prorrateo:** `metaRecuperacionDelRango` en `lib/desempeno-asesor.ts`. Un domingo no tiene meta, y una semana que cruza de mes usa la meta diaria de cada mes. Si a **alguno** de esos meses le falta la meta, la semana queda sin meta (`null`): una meta de solo una parte de los días, contra una recuperación de todos, inflaría el porcentaje.
- **Router:** van en `metasAsesorCobrosRouter`, montado en `src/index.ts` y no en `routers/index.ts`, porque `cobrosAppRouter` está en el límite de TS7056 (ver doc 17). Si el front los consume, se tipan en `orpcAparte`.
- **⚠️ Pendiente de front:** no hay pantalla para capturar las metas. Mientras no la haya, se cargan llamando a `upsertMetasAsesor`, y el KPI muestra el monto sin el porcentaje.

### B4 · Deuda vencida real

- **cartera-back:**
  - `saldoVencidoDeCuotas` (`registerPaymentPolicy.ts`) es la función pura. Por cada cuota que el contador de atrasadas deja como atrasada, suma el valor de la cuota menos lo que sus pagos vivos ya aplicaron. Usa el mismo criterio por montos de `filtrarCuotasVencidasSinCobertura`. Tras la revisión del PR, además:
    - descuenta lo aplicado por pagos `no_required` con plata real (no cobra de nuevo lo que el cliente ya pagó), pero no la semilla vacía de SIFCO;
    - en una cuota recortada (recibo menor a la cuota), usa el restante que informa el recibo, y solo para **bajar** el saldo, nunca para subirlo.
  - `montoVencidoPorCredito` (`credits.ts`) lo calcula para toda la página con una sola consulta y le suma la mora activa. Para los créditos **EN_CONVENIO** excluye las cuotas que el convenio reestructuró (siguen impagas hasta que el convenio se completa) y suma la deuda vencida del propio convenio, con el mismo cálculo de `convenioAlertas`.
  - El resultado viaja en `monto_vencido`.
  - Comparado con la primera versión sobre los 1,778 créditos del funnel local: cambia en 36 (23 en convenio, 9 incobrables y 4 morosos); en los otros 1,742 es idéntico.
- **CRM:** `deudaVencida` toma `monto_vencido`. Si no viene, vuelve a la aproximación anterior y `deudaVencidaAproximada` lo indica.

### B5 · Orden por bucket del motor

- **cartera-back:** `/getAllCredits` (GET y POST) acepta `orden=bucket_motor`. Ordena así:
  1. bucket del motor, de mayor a menor;
  2. cuota impaga vencida más antigua;
  3. deuda total;
  4. `credito_id`, para que la paginación sea estable.

  El orden usa la expresión **canónica** del bucket (`bucketActualSql`: piso por estado, y EN_CONVENIO solo con su historial), la misma semántica del bucket que devuelve la respuesta. El «atraso» del orden cuenta la cuota impaga más antigua que `diasAtrasoMoraMaximo` también cuenta (sin pago aplicado que la cubra y de un crédito que devenga mora), así que dentro de un bucket el orden sigue los días de mora que se muestran (100% de los pares, contra 95.3% de la primera versión).
  - El bucket que muestra cada fila también aplica el piso por estado (`pisoPorEstado`).
  - Si el `ORDER BY` falla (por ejemplo sin las migraciones de cobros-02 en ese ambiente), se reintenta con el orden de siempre en vez de dejar el listado sin servicio.
- **CRM:** `getTodosLosCreditos` manda siempre `orden: "bucket_motor"`. La página 1 trae lo más urgente de toda la cartera, y el front sigue ordenando la página que recibe.

### B6 · Pagos por confirmar

- `sifcosConPagoPorConfirmar` lee las boletas en esos dos estados que **llegaron hoy** (día de Guatemala). Se mide por `created_at`, no por `updated_at`: los avisos y el job de respaldo vuelven a tocar `updated_at` y una boleta vieja aparecería como de hoy.
- **Una sola ventana** para el contador y para la fila. Con dos (por ejemplo 7 días y hoy), el contador diría «1» sin ninguna fila marcada. «Hoy» también coincide con el texto del front («Agenda de hoy», «Confirmar pago · recibido hoy») y acota el contador, porque `confirmada_a_verificar` es un estado terminal que nadie mueve.
- **Contador** de la Agenda: se parte de las boletas de hoy y se cruza contra el universo de la cola del asesor (`sifcosDelUniversoDe`: `/buckets/cola-dia` de su cartera y de las que cubre, el mismo de `getColaDia`). Las referencias por contactar solo cuentan casos con al menos una referencia con teléfono.
- **Acción pendiente** «Confirmar pago» en Mi Cartera y en la Cola del día. Va justo después del SLA.
- **Costo conocido:** una boleta de ayer que nadie revisó deja de aparecer, en el contador y en la fila. Si negocio quiere seguirla varios días, hay que cambiar el texto del front a «hace N días».

### B7 · Referencias por contactar

- El universo son los casos activos que el asesor gestionó en los últimos 60 días: los intentos sin contacto son suyos, así que un caso que nunca tocó no puede tener tres.
- Se aplica la regla con `debeContactarReferencias` y se confirma contra cartera cuáles siguen siendo del asesor.

### B8 · Hora del próximo contacto

- **Columnas nuevas** en `contactos_cobros`: `hora_proximo_contacto` y `medio_proximo_contacto`. `fecha_proximo_contacto` sigue siendo el día, así que las comparaciones por día que ya existen no cambian.
- `createContactoCobros` guarda la hora y el medio que el modal **ya mandaba y se descartaban** (stub de W1). Solo los guarda en gestiones que no son promesa y que tienen fecha.
- La hora se valida en rango (`00:00` a `23:59`): una hora como `25:00` pasaba el formato, la base la rechazaba al insertar y **toda la gestión fallaba**. Ahora se descarta la hora y la gestión se guarda. Los checks de la migración (`medio_proximo_contacto` y las metas) también están espejados en el schema de Drizzle.
- `resumirSeguimiento` devuelve `proximaLlamadaEn` con la hora (`conHoraGT`). Que sea «hoy» se sigue decidiendo por el día.
- Dirección, participante y teléfono contactado (el resto de W1) siguen pendientes.

### B9 · Movimiento del día en vivo

- El job de las 22:00 se partió en dos:
  - `calcularMovimientosBucketDelDia` solo lee y aplica la regla del «dueño de la mañana»;
  - la escritura sigue igual.
- `getMiDesempeno` usa ese cálculo para hoy y lo guarda 2 minutos, compartido entre asesores.
- Si el cierre de movimientos de hoy ya corrió, no suma nada más, para no contar doble. Solo cuentan las filas de `subida` y `bajada`: el cierre inserta primero los contactos y después los movimientos, así que una fila de contacto no prueba que los movimientos terminaron.
- `incluyeHoy` queda en `false` solo si el cálculo falla.

---

## Pruebas hechas

**Pruebas unitarias nuevas, todas en verde:**
- `saldoVencidoDeCuotas` (8 casos);
- hora del próximo contacto y prioridad de «Confirmar pago» (6);
- regla de referencias (3);
- prorrateo de metas (7).

**Typecheck:** sin errores nuevos en el server del CRM ni en cartera-back. El web tiene los mismos 468 errores antes y después de los cambios (truncación TS7056 previa).

**Smoke de solo lectura** contra la base local `cartera_cobros2` (1778 créditos en el funnel):
- el orden `bucket_motor` responde en unos 100 ms;
- `monto_vencido` cuadra con la aproximación en créditos sin abonos parciales;
- la recuperación de septiembre y de octubre en curso sale por asesor.

**Fallas que ya existían**, no tienen que ver con este trabajo:
- `cartera-back-client.moraRecuperacion.test.ts`: depende del auth local en `:7000`;
- `reportes.participacion.test.ts` (cartera-back);
- las fallas de la corrida completa del server, que en aislamiento pasan.

**QA en pantalla (2026-10-08), con la 0077 aplicada en la base local y datos de prueba sembrados:**
- **Asesor senior (Jorge):**
  - Dashboard: Recuperación del día (Q0 de Q1K), Movimiento (2↑ 2↓) y la Agenda con 2 llamadas pendientes, 2 pagos por confirmar y 2 referencias por contactar.
  - Mi Cartera: «Confirmar pago · recibido hoy», «3 intentos sin contacto» y Deuda vencida real.
  - Espacio de trabajo: registrar una gestión «No contesta» con próximo contacto guarda `hora_proximo_contacto` y `medio_proximo_contacto`.
- **Asesor junior (Octavio):** Recuperación del día Q0 de Q2K (su meta de Q54,000 entre 27 días hábiles), Movimiento 0↑ 0↓, 1 llamada pendiente, 0 pagos por confirmar y 1 referencia por contactar.
- **Admin:** el dashboard del supervisor carga sin cambios.
- Todo coincide con lo esperado. Lo que no se ve en pantalla está en «Pendiente de front».

**Sandbox local desfasado:** el schema `cartera_cobros2` de la base local no tenía las migraciones 0035–0044 de cartera-back (`mora_pagada_cuota`, `rubros*`, `cierre_mora_oficial`, entre otras). Sin ellas, el detalle del crédito responde 500 y el Espacio de trabajo muestra «No se encontró el caso de cobranza». No tiene relación con #1862: el `credits.ts` de HEAD ya las usa. Se aplicaron a mano en la base local, con `cartera.` cambiado a `cartera_cobros2.`.

---

## Pendiente de front (no se tocó, por la regla de solo backend)

El backend de estas tareas está completo y verificado. Lo siguiente es de `apps/crm/apps/web` y le toca a quien lleve el front:

| Qué | Dónde | Detalle |
| --- | --- | --- |
| **Dibujar la hora del próximo contacto** (B8) | `components/cobros/asesor/fila-cartera.tsx`, `AccionPendienteCelda` (la acción «Llamar» solo muestra «hoy» o una fecha corta); y el bloque «Próximo contacto» del resumen de la gestión en el Espacio de trabajo | El backend ya manda `accionPendiente.fecha` con la hora (por ejemplo 7:00 PM GT = `01:00Z`). Si no cae a medianoche de Guatemala, mostrar la hora («hoy 7:00 PM»). El doc 13 decía que el front la formateaba; no es así. |
| **Pantalla para capturar las metas por asesor** (B3) | `routes/cobros/metas.tsx` (hoy solo tiene las metas de mora en %) | `getMetasAsesor({ anio, mes })` y `upsertMetasAsesor({ anio, mes, metas })` ya existen en `metasAsesorCobrosRouter` (montado en `src/index.ts`). Hay que tiparlos en `orpcAparte` (`web/src/utils/orpc.ts`). Mientras no haya pantalla, las metas se cargan llamando al procedimiento y el KPI muestra el monto sin porcentaje. |
| **Orden dentro de la página de Mi Cartera** (B5) | `filtros-cartera.tsx`, `ORDEN_INICIAL` = fecha de pago ascendente | El backend ordena por bucket → atraso → deuda total, y eso define **qué créditos caen en cada página**. Pero el front reordena cada página por fecha de pago, así que un B4 puede salir en medio de B3. Figma pide bucket → acción → días de mora → saldo; si se quiere ese orden dentro de la página, hay que cambiar el orden inicial. |

Además, el texto «Confirmar pago · recibido hoy» ahora es veraz: la acción solo marca boletas que llegaron hoy (ver B6).

---

## Observaciones

- `monto_vencido` puede ser una cuota mayor que `cuotas_atrasadas × cuota`. Pasa cuando una cuota ya venció y el cron de mora todavía no la contó: el criterio es «vencida antes de hoy», el mismo del detalle del crédito.
- El filtro por bucket de los chips (`bucketMotorSql`) todavía no aplica el piso por estado, mientras que el orden y el bucket mostrado sí. Un crédito en recuperación con historial por debajo del piso se vería en B4 pero caería en el chip de su bucket de historial. En la base local no hay ningún caso (el bucket mostrado no cambió en ninguno de los 1,778).
- Algunos créditos INCOBRABLES traen una `cuota` fuera de rango, por ejemplo Q541,825.66, y eso da un `monto_vencido` enorme. Es un problema de datos, no del cálculo.

---

## Revisión de código (2026-10-07)

Primera ronda, sobre los cambios locales:

| Hallazgo | Resultado |
| --- | --- |
| Sin la migración 0077 el CRM falla | Cierto. Queda como advertencia arriba y en la descripción del PR que trae la 0077. |
| B7 podía contar dos veces un crédito con dos casos | Corregido: cuenta SIFCOs únicos (`casos_cobros.numero_credito_sifco` no tiene índice único). |
| `email_asesor` de `/getAllCredits` filtra por subcadena (`ILIKE '%…%'`) | Ya era así antes. Los contadores de la Agenda ya no filtran por correo: usan el universo de `/buckets/cola-dia` por `asesor_id`, así que no les afecta. El `ILIKE` de cartera-back no se toca: lo usa toda la cartera. |
| Subconsultas en el `ORDER BY` de `bucket_motor` | Se monitorea. Existe `idx_cuotas_credito_credito_fecha`; la cartera completa (1778) tarda unos 100 ms en local. |
| `new Big("")` con `monto_mora` vacío | No aplica: es `numeric`, nunca llega `""`. |
| La Cola del día volvía a armar la lista de SIFCOs | Corregido: usa `sifcos`, que ya está sin duplicados. |
| La 0077 junta B8 y B3 | Se queda en una sola migración (regla de una migración por feature). |

Segunda ronda (2026-10-08):

| Hallazgo | Resultado |
| --- | --- |
| Una semana que cruza de mes con la meta de un solo mes mostraba una meta parcial | Corregido: devuelve `null` si a cualquier mes del rango le falta la meta. Con la meta solo de octubre, la semana del 28 de septiembre al 1 de octubre daba Q1,000 en vez de «sin meta». |
| Boleta recibida a las 23:45 deja de contar a las 00:01 | Cierto y ya anotado: es decisión de producto (B6). |
| Índice de `cuotas_credito` para el `ORDER BY` | No aplica: el plan usa un índice, sin recorrido secuencial. Ojo: `idx_cuotas_mora_lateral` existe en la base local pero no en las migraciones del repo, y el repo declara `idx_cuotas_credito_credito_fecha` (0018), que el sandbox no tiene. |

Tercera ronda (2026-10-08), comentarios de los PRs ya mergeados. Las correcciones están en cada PR:

| PR | Corrección |
| --- | --- |
| #1901 | `monto_vencido` de créditos en convenio, pagos `no_required` y cuotas recortadas; orden con la expresión canónica del bucket y con el atraso que se muestra; bucket con el piso por estado; reintento con el orden por defecto si el `ORDER BY` falla. |
| #1902 | Hora del próximo contacto validada en rango; el «cierre de hoy ya corrió» exige filas de subida o bajada; checks de la migración espejados en Drizzle; se quitó un symlink `node_modules` agregado por error. |
| #1904 | La recuperación usa el vencimiento que guardó el pago; las fechas inexistentes responden 400. |

---

## Secuencia de PRs

| PR | Tareas | Apps | Estado |
| --- | --- | --- | --- |
| #1901 | B4 + B5 | cartera-back + CRM | Mergeado |
| #1902 | B8 + B9 (crea la 0077) | CRM | Mergeado |
| #1904 | B2 + B3 (la tabla de metas entró en la misma 0077) | cartera-back + CRM | Mergeado |
| Último | B6 + B7 (B10 solo en docs) y estos docs | CRM | En revisión |

Cada PR salió de `jalvarez-cobros` hacia `COBROS-02`, uno por uno y sin crear el siguiente hasta que se mergeó el anterior.
