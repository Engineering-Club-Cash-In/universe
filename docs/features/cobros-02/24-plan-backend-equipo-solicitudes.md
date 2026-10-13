# 24 · Mi equipo y Solicitudes del supervisor: plan y avance del backend

> **Issue:** #1895 · **Tareas:** M1–M7 del [doc 18](./18-equipo-solicitudes-backend.md)
> **Rama:** `jalvarez-cobros` · un commit por PR, sin PR abiertos todavía
> **Regla:** solo backend. El front ya está conectado (PR #1896) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front» (abajo) y en el comentario del issue.

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza con cada PR.

---

## Estado

| Tarea | Qué es | PR | Estado | Dónde quedó |
| --- | --- | --- | --- | --- |
| **M1** | Recuperación y resultado de cartera por asesor | 1 | ✅ Código (sin migración) | `getRecuperacionAsesores` · `equipo[].recuperacion` de `getSupervisionComplementos` |
| **M6** | Nivel del asesor como dato real | 1 | ✅ Código (sin migración) | `lib/nivel-asesor.ts` · `getAsesoresTraslados().nivel` · `getMiPerfilCobros().nivel` |
| **M7** | Contactabilidad en lote por asesor | 1 | ✅ Código (sin migración) | `getContactabilidadPorAsesor` |
| **M3** | Bitácora unificada de decisiones | 2 | ✅ Código · migración CRM `0082` y cartera `0026` | `getBitacoraDecisiones` y compañía (ver abajo) |
| **M2** | Próximos a subir de bucket | 3 | ✅ Código (sin migración) | `getProximosSubirBucket` |
| **M4** | Contrapropuesta de convenio | 3 | ✅ Código · migración CRM `0082` | `contraproponerConvenio` · `responderContrapropuesta` · cartera `/:id/plan` |
| **M5** | Ausencia indefinida | 4 | ✅ Código · migración CRM `0082` | `previsualizarRepartoAusencia` · `marcarAusenteIndefinido` · `reactivarAsesor` |

> [!NOTE]
> Nada se corrió en ninguna base de datos de dev ni de prod, y nada se subió. El código está local para probarlo. Las migraciones **no se han aplicado en ninguna base**: están escritas y son idempotentes.

---

## Migraciones

COBROS-02 no va a PROD hasta el pase masivo: estas migraciones se corren **solo en la BD local o en DEV**, a mano y en orden. Una sola por lado para toda la feature (cada PR agrega su parte al mismo archivo).

| Base | Archivo | Qué trae |
| --- | --- | --- |
| CRM | `apps/crm/apps/server/src/db/migrations/0082_cobros_equipo_solicitudes.sql` | M3: columna `nota_decision` e índices de fecha en `inmovilizaciones_unidad`. M4: tabla `contrapropuestas_convenio_cobros` y los avisos `convenio_contrapropuesta` y `convenio_contrapropuesta_respondida`. M5: tabla `ausencias_asesor_cobros` y el aviso `asesor_reactivado`. |
| Cartera | `apps/cartera-back/drizzle/cobros-02/0026_cobros_equipo_solicitudes.sql` | M3: índices de `convenio_decisiones` por fecha y por quien decidió. |

Los esquemas de Drizzle (`db/schema/cobros.ts`, `inmovilizacion-unidad.ts` y `notifications.ts`) reflejan la migración.

---

## Decisiones (2026-10-12)

| Tarea | Decisión |
| --- | --- |
| M1 | La recuperación por asesor sale de las mismas fuentes que la tabla Equipo (S4): cartera por rango, atribuida al asesor **actual** del crédito, y la meta prorrateada de `metas_asesor_cobros`. Períodos `dia`, `semana` y `mes`, con el anterior para la variación. `porcentaje` puede pasar de 100 y es `null` sin meta. Si no se pudo leer la recuperación, el asesor llega `null` («—»). |
| M6 | El nivel se **deriva del pool** en el servidor, sin columna nueva: B5 → `especial`, B2–B4 → `senior`, B0–B1 → `junior`, sin pool → `null`. Con buckets de varios niveles manda el más alto (igual que el front). Reemplaza el `nivelPorBuckets` viejo (senior = B2 en adelante, sin especial), que nadie leía en el front. |
| M7 | Misma consulta y misma definición de «efectivo» que `getHistorialAgendasResumen` (excluye los envíos automáticos y el link de pago), agrupada por quien hizo la gestión. Los asesores pedidos sin gestiones llegan con 0 de 0. Solo supervisión. |
| M2 | **B1 a B4** (B0 es premora y B5 no sube más; incluir B0 listaría a casi todos los créditos). La siguiente cuota sin pagar vence en **7 días o menos**, las cuotas vencidas reales coinciden con el bucket, estado ACTIVO o MOROSO y sin promesa vigente. Es «Listos para Prejurídico» (B3 → B4) generalizado; la consulta de promesas se compartió. Una fila por crédito, la más urgente primero. |
| M3 · Escaladas | **Jurídico + recuperación del vehículo.** El apagado del GPS no cuenta como escalar (es presión temporal). Sin tabla nueva. Se cuenta por fecha de la solicitud. |
| M3 · bitácora | Un solo endpoint junta nueve fuentes (convenios, apagados, reactivaciones, recuperaciones, rebajas, Jurídico, reasignaciones manuales, traslados y coberturas). Cada fuente se filtra y se cuenta en su origen y se mezclan por fecha. Con el filtro por asesor o por decisión solo entran las **solicitudes** (lo demás lo hace el supervisor). `perPage` máximo 50 y `page × perPage` hasta 5,000 entradas por consulta (cada fuente tiene que traer sus primeras `page × perPage` filas); para ver lo anterior se acota por fecha (`desde` y `hasta`). Un apagado cancelado se fecha y se atribuye con su evento de cancelación, porque las rutas de cancelación solo cambian el estado. |
| M3 · fecha del filtro | Los filtros `desde` y `hasta` (días de Guatemala, inclusivos) aplican a la fecha de la **decisión** o, si sigue pendiente, a la de la solicitud. |
| M3 · nota al aprobar | Convenio: ya la guardaba (`motivo` en `convenio_decisiones`); solo se bajó el mínimo de 5 caracteres al aprobar (al rechazar se mantiene). Recuperación: va a `motivo_decision`. Apagado y reactivación: columna nueva `nota_decision`. |
| M4 | La contrapropuesta **vuelve al asesor** (no al cliente, como sugería el Figma). El supervisor cambia el **número de cuotas** y la **fecha del primer pago**; el **total no cambia** y la cuota mensual se recalcula (total ÷ cuotas). Cambiar el total necesita una regla de negocio que hoy no existe (pagos asociados, cuotas reestructuradas). |
| M4 · estados | El convenio sigue **pendiente** en cartera. Mientras haya una contrapropuesta esperando, `decidirConvenio` responde 409. El asesor que lleva el crédito la acepta (cartera reescribe el plan y el convenio sigue pendiente, listo para aprobar) o la descarta (el supervisor decide el plan original). El supervisor solo puede retirarla (descartarla). Una nueva contrapropuesta reemplaza a la que siga esperando. |
| M4 · primer pago | Es la primera cuota del plan que vence desde el día (de Guatemala) en que se firmó el convenio. Las cuotas que el convenio toma del crédito pueden traer fechas ya vencidas (las que se reestructuran); esas no son el primer pago. |
| M4 · límites | El número de cuotas lo limita `CONVENIO_MAX_MESES` (el mismo de la creación, hasta 60). El primer pago de un plan reprogramado tiene que ser **posterior al día en que se firmó el convenio** (cartera trata las cuotas de ese día o anteriores como deuda vieja) y no estar en el pasado ni a más de 90 días. Cartera lo vuelve a validar con la fecha de ese momento, ya con los candados tomados. |
| M4 · concurrencia | Crear una contrapropuesta, responderla y decidir el convenio se serializan por convenio con un candado de transacción (`pg_advisory_xact_lock`), y los avisos se crean y cierran dentro de él. Cartera confirma al aplicar el plan que el crédito sigue siendo del asesor que acepta (candado del crédito y fila del convenio) y que el plan sigue pendiente. El `PATCH …/plan` es idempotente: el mismo plan dos veces no se reescribe ni se anota otra vez. **Límite conocido:** una decisión que llega directo a cartera (carteraFront) no pasa por el candado del CRM; si gana la carrera, la contrapropuesta queda pendiente hasta que alguien responda y entonces se cierra sola como `sin_efecto`. |
| M4 · sin efecto | Una contrapropuesta queda `sin_efecto` (y se cierra el aviso al asesor) si el convenio ya no existe, ya no está pendiente, o su plan cambió por fuera y ya no es ni el original ni el propuesto. Un 404 de ruta de cartera (despliegue desordenado) **no** cuenta: responde 503 y no toca la contrapropuesta. |
| M5 | Tabla propia `ausencias_asesor_cobros`: no se tocó `coberturas_agenda_cobros`, que seis lectores (agenda, acceso, historial, snapshots) suponen con suplente y fechas cerradas. La cobertura con suplente (`crearCobertura`) sigue igual. |
| M5 · reparto | Traslado real `redistribucion` de cartera con una opción nueva `ponderarPorCapacidad`: cada cuenta va a quien tenga **menor utilización** (carga ÷ capacidad del bucket) y no a quien tenga menos cuentas. El asesor de origen nunca es receptor. Las cuentas fuera del funnel (canceladas, caídas…) **no se reparten**: se quedan con el asesor (`mantenerEspeciales`), porque en una ausencia temporal no se gestionan y cartera exigiría un responsable para cada una. |
| M5 · pool | Mientras dura la ausencia se lo saca del pool de todos sus buckets (`asesor_bucket.activo = false`) para que el motor no le mande cuentas nuevas. Se guardan los buckets que **estaban activos**: solo esos se reanudan. |
| M5 · devolución | Al reactivar: primero vuelve al pool y luego se le devuelve, por tandas de 200, lo que el reparto le quitó **si sigue con quien lo recibió y su bucket de hoy está en su pool**. Lo que el motor o un supervisor ya movió se queda donde está y se informa. Las cuentas que hoy no tienen bucket operativo (por ejemplo, las que entraron en convenio mientras tanto) se devuelven aparte, con la misma bitácora, porque la reasignación en bloque no las acepta. |
| M5 · aviso | Al reactivar se avisa al resto del equipo y a los supervisores (`asesor_reactivado`), con cuántas cuentas volvieron y cuántas se quedaron. |

---

## Cómo quedó cada tarea

### M1 · Recuperación por asesor

- `EquipoAsesorSupervision.recuperacion` (en `getSupervisionComplementos().equipo[]`): `{ monto, montoAnterior, meta, porcentaje } | null`.
- `getRecuperacionAsesores({ periodo, asesorId? })`: `[{ asesorId, recuperacion }]` o `null` si cartera no responde. Es la versión liviana para las tarjetas de Mi equipo y el Detalle (no calcula el resto del dashboard). `asesorId` es el de cartera.
- Reglas en `lib/supervision-kpis.ts` (`resultadoCartera`), con pruebas.

### M6 · Nivel

- `lib/nivel-asesor.ts` (`nivelPorBuckets`) es el único criterio. Lo usan `getMiPerfilCobros().nivel` (ahora puede ser `especial` o `null`) y `getAsesoresTraslados()[].nivel`.

### M7 · Contactabilidad en lote

- `getContactabilidadPorAsesor({ desde?, hasta?, usuarioIds?, roles? })` → `{ asesores: [{ userId, efectivos, total }] }`. Servicio en `services/supervision-contactabilidad.ts`.

### M3 · Bitácora y fuentes

- **Id del solicitante:** `getColaInmovilizaciones` y `getHistorialInmovilizaciones` devuelven `solicitadoPorId` (el historial también `decididoPorId`). `getSolicitudesRecuperacion` ya no quita `solicitanteId`.
- **Historial de inmovilizaciones:** nuevos filtros `estados[]`, `accion`, `solicitanteId`, `desde` y `hasta`.
- **Recuperaciones:** `getHistorialSolicitudesRecuperacion({ page, perPage, estados?, solicitanteId?, desde?, hasta? })`, paginado y sin el tope de 100. `getSolicitudesRecuperacion` queda igual.
- **Nota al aprobar:** `decidirInmovilizacion({ nota })`, `decidirSolicitudRecuperacion({ motivo })` y `decidirConvenio({ motivo })` la guardan al aprobar.
- **Convenios globales:** cartera `GET /payment-agreements/decisiones/historial` (paginado; filtros de decisión, fechas, quien decidió y quien armó el convenio) y CRM `getHistorialDecisionesConvenio`.
- **Bitácora:** `getBitacoraDecisiones({ page, perPage, tipos?, decisiones?, solicitanteId?, desde?, hasta? })` → `{ items, page, perPage, total, totalPages }`. Cada ítem: `id`, `tipo`, `fecha`, `decision`, `estado`, `solicitante`, `decididoPor`, `credito`, `resumen`, `motivo`, `nota`, `refId`. Servicio en `services/bitacora-supervision.ts`.
- **Traslados:** cartera `GET /buckets/traslados/historial` con paginación real, fechas y total (el listado viejo queda igual).
- **Escaladas:** `getEscaladasAsesor({ userId, desde?, hasta?, limite? })` → `{ total, porTipo, items }`.

### M2 · Próximos a subir de bucket

- `getProximosSubirBucket({ asesorId })` → `{ asesorId, ventanaDias, total, porBucket, items }`. Cada ítem: `sifco`, `cliente`, `bucketActual`, `bucketSiguiente`, `diasParaVencer`, `fechaVencimiento`, `montoCuota`, `montoMora`. Reglas en `lib/proximos-subir-bucket.ts`.

### M4 · Contrapropuesta

- **Cartera:** `GET /payment-agreements/:id/plan` (cualquier estado: cuotas con fecha y monto, estado, primer pago, SIFCO y asesor que lo armó) y `PATCH /payment-agreements/:id/plan` (reprograma un convenio pendiente; mismo gate que decidir; deja una nota en `observaciones`; no toca pagos ni las cuotas del crédito reestructuradas).
- **CRM:** `getPlanConvenio({ convenioId })`, `contraproponerConvenio({ convenioId, numeroMeses, primerPago, nota })`, `responderContrapropuesta({ id, accion: "aceptar" | "descartar", nota? })` y `getContrapropuestasConvenio({ convenioId })`.
- Si al aceptar el convenio ya no está pendiente, o la fecha del primer pago ya pasó, la contrapropuesta queda `sin_efecto` y se explica. Lo mismo si el convenio ya no existe (por ejemplo, se rechazó en carteraFront) al aceptar o retirarla.

### M5 · Ausencia indefinida

- `previsualizarRepartoAusencia({ asesorId, motivo? })` → el `PreviewTraslado` de cartera (`previewId`, `asignaciones`, `carga` antes y después, `bloqueos`, `excluidos`). No toca nada; el `previewId` vale 10 minutos.
- `marcarAusenteIndefinido({ id, asesorId, motivo, previewId, nota? })`. `id` lo genera el cliente: un reintento devuelve lo hecho. Motivos: `incidente`, `permiso` y `vacaciones`.
- `reactivarAsesor({ id })` → `{ ausencia, devueltas, retenidas[] }`.
- `listarAusencias({ soloVigentes = true })`.
- **Cartera:** `POST /buckets/asesores/:id/pool/pausar` y `/reanudar`, `GET /buckets/traslados/:id/detalle` y `POST /buckets/traslados/:id/devolver`. El traslado acepta `ponderarPorCapacidad` y `mantenerEspeciales` (el esquema de la ruta los tenía que declarar o Elysia los descartaba en silencio).
- **Reintentos y fallos parciales (revisión del PR #1970):**
  - Si la confirmación del reparto falla con 400/404/409, cartera la rechazó y se borra el registro. Ante un timeout, corte de conexión o 5xx el traslado pudo haberse confirmado: el registro **se conserva** y reintentar con el mismo `id` (clave de idempotencia) lo reconcilia sin repartir dos veces.
  - El asesor sale del pool **dentro de la misma transacción** que confirma el traslado (`pausarPoolOrigen`): no hay ventana en la que el motor le asigne cuentas que el reparto no vio, ni un estado «repartido pero sin pausar». Los buckets pausados se guardan en la operación y un replay idempotente los devuelve, así que un reintento tras perder la respuesta no los pierde. `marcarAusenteIndefinido` ya no llama a `pool/pausar` aparte (el endpoint queda disponible).
  - Un traslado con `mantenerEspeciales` puede confirmarse sin cuentas que repartir (asesor sin cartera operativa, o solo con cuentas especiales): igual se lo marca ausente y se lo saca del pool.
  - La devolución verifica el dueño esperado **bajo los mismos locks** de la reasignación en bloque (`duenios_esperados`): lo que un supervisor movió entre la clasificación y la escritura se queda con su nuevo dueño y se informa como retenido (`cambio_de_dueno`).
  - Tras una devolución parcial, el reintento reconoce como ya devuelto lo que una tanda anterior regresó (último cambio de la bitácora = receptor → titular, con el motivo de la devolución), así que los totales de auditoría y del aviso no quedan subcontados.
  - La confirmación valida que la previsualización sea **del mismo asesor** y traiga la pausa del pool (`asesorOrigenId`, `pausarPoolOrigen`); si no, 409 y no se escribe nada.
  - La pausa toma el lock de las filas de pool del origen **antes** de las fotos del plan (más un lock global entre pausas, para que dos ausencias cruzadas no se interbloqueen). La reasignación individual ahora revalida al destino en el pool bajo un lock compartido dentro de su transacción (la masiva ya lo hacía), así que ninguna asignación manual se cuela entre la foto y la pausa.
  - Una ausencia sin traslado registrado (confirmación cortada) se concilia con cartera por su clave (`GET /buckets/traslados/clave/:clave`): al reintentar marcarla se completa el registro aunque la previsualización sea otra, y **reactivar queda bloqueado (409)** mientras no se pueda conciliar. Solo se borra una ausencia que la misma llamada creó y cartera rechazó.
  - Reintentar con un `id` ya usado exige la misma solicitud (asesor, motivo, nota y usuario); si no, 409 «La solicitud ya se usó con otros datos».
  - Una ausencia pendiente de más de 15 minutos (la previsualización dura 10) ya no puede confirmarse: al previsualizar, marcar o reactivar se concilia con cartera y, si el traslado nunca se confirmó, se descarta. Así el asesor no queda ausente para siempre sin cartera repartida ni pausa de pool.
  - Marcar ausente toma el mismo lock por participante que `crearCobertura` y comprueba las coberturas dentro de esa transacción; `crearCobertura` a su vez rechaza (409) a un asesor con ausencia indefinida vigente, como titular o como suplente.
  - Marcar ausente también se rechaza si el asesor es **suplente** de una cobertura vigente o futura (no solo titular). La devolución de cuentas sin bucket (convenio) vuelve a comprobar, bajo los locks, que el crédito siga sin bucket operativo; si entró a uno, queda para la reasignación en bloque, que sí exige pool.
  - La pausa también apaga `asesores.activo_para_creditos`: la asignación automática de créditos nuevos (`getAsesorConMenorCarga`) no mira el pool de buckets sino ese flag. Se registra en la operación (`creditosPausados`) y `pool/reanudar` (con `operacion_id`) lo restaura al reactivar.
  - Lo que `devolverSinBucket` no escribe (por ejemplo, porque entró a un bucket) se vuelve a clasificar y, si sigue con quien lo recibió y su bucket está en el pool, pasa por la reasignación en bloque en la misma devolución.
  - La bitácora de la devolución lleva una marca derivada de la operación (« · Devolución de la operación <id>») y un reintento reconoce lo ya devuelto por esa marca, no por el texto del motivo, que puede cambiar entre intentos (nombre del asesor, fallo de la consulta).
  - Dos reactivaciones simultáneas: la que pierde recibe 409 y no vuelve a avisar al equipo (las operaciones de cartera son idempotentes).
  - Lo que se cancela, queda pendiente de cancelación o cae durante la ausencia se retiene (`fuera_del_funnel`); solo lo que entró en convenio se devuelve aparte.
  - **Front pendiente:** ante un error de red al marcar ausente, ofrecer «Reintentar» con el mismo `id` y `previewId` (el registro se conserva y se reconcilia). Una ausencia sin cuentas por repartir ya no se rechaza.

---

## Pendiente de front

Nada de esto se toca en esta fase. Cada punto sale también en el comentario del issue #1895.

| Tarea | Qué tiene que cablear el front |
| --- | --- |
| M1 | `equipo/asesores-vista.tsx`: cambiar `recuperacion={{ porcentaje: null, detalle: "Pronto" }}` por `getRecuperacionAsesores` (o `equipo[].recuperacion`). `equipo/detalle/resumen-asesor.tsx`: el KPI «Resultado de cartera» con `monto`, `meta`, `porcentaje` y `montoAnterior` para la variación. Elegir un período (el Detalle compara hoy 7 días contra los 7 anteriores; el servidor trabaja con día, semana o mes). |
| M2 | `equipo/detalle/detalle-asesor.tsx`: `cantidad` de «próximos a subir de bucket» con `getProximosSubirBucket({ asesorId }).total` y quitar `pronto`. La lista (`items`) alimenta el destino del enlace. |
| M3 | `solicitudes/historial.ts`: reemplazar la unión en el navegador por `getBitacoraDecisiones` (paginado por el servidor, con filtros). `solicitudes/normalizar.ts` y `solicitudes-de-asesor.tsx`: usar `solicitadoPorId` / `solicitanteId` y dejar de comparar por nombre. `espacio-aprobacion.tsx`: mandar la nota al aprobar (`nota` en `decidirInmovilizacion`, `motivo` en `decidirSolicitudRecuperacion` y `decidirConvenio`) y quitar el texto «Al aprobar no se guarda». `historial/categorias.ts`: el chip «Escaladas» con `getEscaladasAsesor`. Hay que registrar en el web la nueva `getHistorialSolicitudesRecuperacion` si se quiere el historial de recuperaciones completo. |
| M4 | `espacio-aprobacion.tsx`: «Primer pago» con `getPlanConvenio` (`primer_pago` y `cuotas`); «Editar y contraproponer» con `contraproponerConvenio` (cuotas, fecha del primer pago y nota; la cuota mensual se recalcula en pantalla). La vista del **asesor** necesita mostrar la contrapropuesta y los botones Aceptar y Descartar (`responderContrapropuesta`); el supervisor puede retirarla. Mostrar «Contrapropuesta enviada» con `getContrapropuestasConvenio`. El Figma dice «se enviará al cliente»; el flujo implementado vuelve al asesor. Los avisos nuevos `convenio_contrapropuesta` y `convenio_contrapropuesta_respondida` necesitan su tarjeta en la bandeja de notificaciones. |
| M5 | `equipo/asignacion/marcar-ausente.tsx`: motivo «Incidente», hora de inicio (`inicio_at` se toma al marcar) y fin indefinido; el modal «Redistribución» se arma con `previsualizarRepartoAusencia` (`carga[]` da las filas «28 → 32 +4») y se confirma con `marcarAusenteIndefinido`. `equipo/reactivar-dialogs.tsx` y la tarjeta: «Reactivar» con `reactivarAsesor` y el resultado (`devueltas` / `retenidas`). El estado «Ausente» de las tarjetas hoy sale de `listarCoberturas`; las ausencias indefinidas vienen de `listarAusencias` (`finAt` es `null`, no hay `hasta`). `estado-asesor.ts` y `textoAusencia` suponen fecha de fin. El aviso `asesor_reactivado` necesita su tarjeta en la bandeja. |
| M6 | `equipo/estado-asesor.ts`: leer `nivel` de `getAsesoresTraslados` en lugar de derivarlo de los buckets. |
| M7 | `equipo/asesores.tsx`: reemplazar el `useQueries` de `getHistorialAgendasResumen` por una llamada a `getContactabilidadPorAsesor({ desde, hasta, usuarioIds, roles: ["cobros"] })`. |

Los routers nuevos viven dentro de `supervision-cobros.ts` y `convenio-decision.ts`, que ya están montados y tipados en el web: no hace falta registrar nada más, salvo regenerar los tipos.

---

## Pruebas hechas

**Pruebas unitarias y de tipos (2026-10-12):** `lib/supervision-kpis`, `nivel-asesor`, `bitacora-supervision`, `rango-dias-gt`, `proximos-subir-bucket`, `contrapropuesta-convenio` y `ausencia-asesor` en el CRM; `convenio-plan`, `plan-traslado-cartera` (reparto por capacidad) y `ausencia-devolucion` en cartera. `bunx tsc -b` del CRM y `tsc` de cartera sin errores en los archivos tocados; biome acotado a los archivos tocados.

**Prueba contra la BD local y cartera levantada (2026-10-13).** Procedimientos llamados con `call` de oRPC y contexto de supervisor; cartera con el código nuevo en otro puerto (la de :9000 no recarga con `--watch`).
- **Migraciones:** `0082` y `0026` corridas dos veces sobre `Cobros2` (cartera con el esquema `cartera_cobros2`): la segunda solo avisa «ya existe».
- **M1:** `getRecuperacionAsesores` da lo mismo, asesor por asesor, que `getSupervisionComplementos().equipo[].recuperacion` y que el `meta` en % (7 de 7).
- **M6:** B0–B1 → junior (Caren, Octavio, Wilson), B2–B4 → senior (Erik, Jorge, Samuel), B5 → especial (Gerencia) y sin pool → `null`.
- **M7:** el lote da exactamente lo mismo que `getHistorialAgendasResumen` por asesor, en 60 días, 7 días y hoy; los usuarios sin gestiones llegan con 0 de 0.
- **M2:** la suma de B3 de todos los asesores (39) es igual a «Listos para Prejurídico» del Dashboard (39). Total de próximos a subir: 581 (Octavio 402, Jorge 85, Samuel 77, Erik 17).
- **M3:** cada tipo por separado suma lo mismo que todos juntos (80); 16 páginas de 5 recorren los 80 sin repetidos y en orden; la página 2 de 25 coincide con los ítems 26–50; los filtros por decisión, asesor y fecha devuelven lo esperado y coinciden con cartera. Id del solicitante en las tres colas. Filtros del historial de inmovilizaciones. Historial de recuperaciones paginado. Escaladas por asesor (Jorge: 1 de recuperación).
- **M3 · notas:** apagado aprobado guarda `nota_decision` y el evento; rechazado guarda `motivo_rechazo`; la bitácora muestra la nota en ambos. Convenio aprobado con la nota `ok` (2 letras) queda en cartera; rechazar con 3 letras o sin motivo sigue fallando.
- **M4** (convenio real sobre el crédito 19, rechazado al final; el crédito vuelve a MOROSO sin convenio vivo): el plan trae las 4 cuotas y el primer pago correcto (salta las dos ya vencidas); las contrapropuestas inválidas fallan (tope de cuotas, fecha pasada, a más de 90 días, igual al plan, un asesor no puede contraproponer); mientras hay una pendiente `decidirConvenio` responde 409; el supervisor y otro asesor no pueden aceptar y otro asesor no la puede ver; al aceptar, cartera queda con 3 cuotas de Q800 y primer pago a 15 días y el convenio sigue pendiente; descartar deja el plan intacto; una nueva reemplaza a la pendiente y el supervisor puede retirarla; el convenio rechazado ya no se puede consultar ni contraproponer.
- **M5** (Caren, 54 cuentas → Wilson): el reparto queda en 134 y 36 (las 36 fuera del funnel se quedan), Caren sale del pool (`B0=false`) y la bitácora de reasignaciones suma 54; repetir el mismo `id` devuelve la misma ausencia; marcar de nuevo o previsualizar a un ausente da 409; `listarAusencias` la muestra con `finAt` nulo. Con una cuenta movida a mano y otra que entró en convenio, `reactivarAsesor` devuelve 53 y retiene solo la movida; el pool vuelve a `B0=true`, la carga queda como al inicio y se crean 10 avisos (6 asesores y 4 supervisores). Reactivar dos veces da 409. Con un asesor solo en su bucket (Octavio) el reparto queda bloqueado (873 `sin_receptor_elegible`), la confirmación falla, no queda ausencia registrada y el pool no cambia.
- **Hallazgos corregidos durante la prueba:** (1) el esquema de la ruta de previsualizar descartaba `ponderarPorCapacidad` y `mantenerEspeciales`; (2) todos los asesores tienen cuentas fuera del funnel y cartera exigía un responsable para ellas, por eso ahora se quedan con el asesor; (3) la confirmación exigía que no quedara ninguna cuenta en el origen; (4) las cuentas en convenio se repartían pero no volvían.
- **No probado en la BD:** la nota al aprobar una **recuperación** (`motivo_decision`): aprobarla deja el crédito en B4 y EN_RECUPERACION, que solo se levanta con un pago, así que no se hizo; el cambio es una línea y está cubierto por tipos. Tampoco se probó el reparto ponderado con datos reales (todos los buckets tienen un solo receptor); lo cubren las pruebas unitarias.
- **Pendiente de cartera en :9000:** ese proceso corre el código anterior; hay que reiniciarlo para que tome las rutas nuevas.

### Por probar a mano en la pantalla

1. Con el front de la fase 2 cableado a estos procedimientos: Mi equipo › Marcar ausente (modal «Redistribución») y Reactivar.
2. Nota al aprobar una recuperación (ver arriba).
3. Reparto ponderado por capacidad con dos o más receptores en el mismo bucket.
