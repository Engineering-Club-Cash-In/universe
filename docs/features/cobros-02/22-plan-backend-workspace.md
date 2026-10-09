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
| **W2** | Solicitud de rebaja de mora con aprobación | ✅ Hecho en el PR 2 · migraciones CRM `0080` y cartera `0023` | `solicitudes_rebaja_mora_cobros` · `routers/solicitudes-workspace.ts` · `services/rebaja-mora.ts` · cartera `POST /mora/condonar-parcial` |
| **W3** | Escalar a Jurídico con aprobación | ⏳ PR 3 | Pendiente |
| **W4** | Abono inicial dentro del convenio | ⏳ PR 4 | Pendiente |
| **W5** | Alertas leídas por grupo + job de 30 días | ✅ Hecho en el PR 1 · tabla en `0079` | `alertas_caso_leidas_cobros` · `alertas-caso.ts` · `jobs/alertas-caso-leidas.ts` |

> [!WARNING]
> **Migraciones a correr (idempotentes) antes de desplegar, en este orden:**
> - CRM `0079_cobros_workspace_gestion_alertas.sql` (PR 1): sin ella, `createContactoCobros` falla al insertar y `getAlertasCaso` al leer las marcas.
> - CRM `0080_cobros_workspace_rebaja_mora.sql` (PR 2): crea la tabla de solicitudes y agrega dos valores a `cobros_notif_tipo`.
> - Cartera `drizzle/cobros-02/0023_cobros_workspace_rebaja_mora.sql` (PR 2): columna `referencia_externa` en `moras_condonaciones`. Sin ella, `POST /mora/condonar-parcial` falla.
>
> Ninguna se corrió en ninguna base.

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
- **Consultas** (`lib/alertas-caso-db.ts`): filas abiertas del caso, marcas del usuario y upsert del grupo. El upsert es monótono: una marca atrasada no baja `leida_hasta`. `getAlertasCaso` lee todas las filas abiertas y descarta los grupos leídos antes de tomar los 10 primeros.
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

### W2 · Rebaja de mora

- **Schema** (`db/schema/cobros.ts`, `solicitudesRebajaMoraCobros`): una solicitud abierta por caso (índice único sobre `pendiente`, `aprobada`, `error_aplicacion`). CHECK: `0 < monto ≤ mora_snapshot`.
- **Estados**: `pendiente` → `aprobada` (en proceso) → `aplicada`. `error_aplicacion` si cartera no la aplicó: se reintenta o se rechaza. `rechazada` y `cancelada` cierran.
- **Pedir** (`solicitarRebajaMora`, asesor): la mora se lee EN VIVO de cartera, sin cache; el monto no puede pasar de la mora. Avisa a los supervisores que la pueden decidir (todos menos quien la pidió).
- **Decidir** (`decidirSolicitudRebajaMora`, supervisor): cuatro ojos (quien la pidió no la decide). Antes de aprobar, vuelve a leer la mora: si ya no alcanza, no aprueba (CONFLICT) y el supervisor la rechaza. Aprobar llama a cartera con el id de la solicitud como `referencia_externa`: un reintento no descuenta dos veces.
- **Cartera** (`condonarMoraParcial`, `POST /mora/condonar-parcial`): descuenta solo el monto (a diferencia de `condonarMora`, que deja la mora en 0 y la desactiva). Anota la rebaja por cuota como pago de mora, para que el cron no la vuelva a cobrar. No cambia el estado del crédito. Gate: cuenta de servicio del CRM (`CRM_SERVICE_USER_ID`, con el correo de quien aprobó en `usuario_email`) o ADMIN.
- **Bitácora**: la propia fila de la solicitud (quién pidió, cuánta mora había, qué se rebajó, quién resolvió, nota). El historial de «Otras gestiones» la mostrará cuando el front la lea (pendiente de front).
- **Cancelar**: solo quien la pidió o un supervisor, y solo mientras está `pendiente`.

#### Correcciones posteriores (revisión de la rebaja)

- **Estado con régimen propio.** Cartera rechaza la rebaja en `EN_CONVENIO`, `INCOBRABLE`, `CANCELADO`, `PENDIENTE_CANCELACION` y `CAIDO` (`lib/condonacion-parcial.ts`). El CRM lo valida también al pedir y al aprobar, para no pedir lo que cartera va a rechazar.
- **Lo devengado por cuota tiene que alcanzar.** Antes de tocar `monto_mora`, cartera calcula la anotación por cuota. Si lo anotable no cubre el monto, responde `excede_devengado` y no descuenta nada. Así `monto_mora` y el recálculo del cron no se desfasan.
- **Clasificación de fallos** (`lib/rebaja-mora-reglas.ts`, `clasificarErrorCartera`):
  - *Definitivo* (la solicitud pasa a `rechazada` con el motivo de cartera, y el asesor lo ve): mora insuficiente, `excede_devengado`, `estado_no_permitido`, sin mora activa, y cualquier otro 4xx de negocio.
  - *Transitorio* (queda en `error_aplicacion` y se puede repetir la aprobación): red o timeout, 5xx, 408, 429, 401/403 (configuración), 404 sin código (endpoint que no existe) y `usuario_no_encontrado` (el supervisor no tiene usuario en cartera).
- **Aprobaciones colgadas.** Si el proceso se cae entre el reclamo (`aprobada`) y la respuesta de cartera, el job `rebajasMoraColgadas` (cada 5 min) las pasa a `error_aplicacion` y avisa a los supervisores. Repetir la aprobación es seguro: cartera no descuenta dos veces por `referencia_externa`.

**Requisito de despliegue (rebaja):** el CRM llama a `/mora/condonar-parcial` con la cuenta de servicio. Para que pase el gate, hay que definir `CRM_SERVICE_USER_ID` en cartera (el id de esa cuenta en `platform_users`). Si falta, cartera avisa al arrancar y las aprobaciones responden 403; el CRM las deja en `error_aplicacion` con el motivo de configuración, no las rechaza.

**Pruebas de la rebaja:**
- Cartera: `lib/condonacion-parcial.test.ts` (estados con régimen propio).
- CRM: `lib/rebaja-mora-reglas.test.ts` (15 pruebas: montos en centavos, clasificación de cada tipo de fallo, criterio de aprobación colgada).
- **Pendiente:** QA contra dev del flujo completo (pedir, aprobar, reintentar tras cortar la respuesta de cartera, rechazo definitivo por mora insuficiente, y que el cron no vuelva a cobrar lo rebajado al día siguiente).

**Sin resolver a propósito:** no hay reversa de una rebaja ya aplicada (habría que corregir a mano en cartera), y la bitácora se muestra en «Otras gestiones» solo cuando el front la lea.

### W3 · Escalar a Jurídico

- **Schema CRM** (`solicitudesJuridicoCobros`): motivo (`no_contacto` | `no_quiere_pagar` | `sin_acuerdo`), nota para Jurídico (mínimo 10 caracteres), bucket que tenía al pedir. Una solicitud abierta por caso.
- **Pedir** (`solicitarEscalarJuridico`): solo desde B3 o B4 (cartera vuelve a validarlo). Avisa a los supervisores.
- **Decidir** (`decidirSolicitudJuridico`): cuatro ojos. Aprobar llama a cartera. Un 409 `ya_en_juridico` cuenta como aplicado (reintento). Un 4xx de cartera es definitivo (`error_aplicacion`, no se reintenta solo); un 5xx o de red se puede reintentar.
- **Cartera** (`enviarAJuridico`, `POST /buckets/creditos/:id/juridico`): mismo mecanismo que la recuperación de vehículo. Locks sin esperar, fila `buckets_historial` (`API_MANUAL`), estado `EN_JURIDICO` en la misma transacción, y el caso sale de la cartera del asesor: se elige un asesor del pool de B5 distinto del actual (menor carga). Falla si el pool de B5 no tiene otro asesor activo. Reglas puras en `lib/buckets-juridico.ts` (pruebas en `lib/buckets-juridico.test.ts`).
- **Piso**: `EN_JURIDICO` es piso de B5 (`buckets.estados_piso`, migración 0024). El motor no baja el crédito de B5 mientras esté; sí lo sube si la mora lo pide.
- **Salida (decisión de negocio, 2026-10-09)**: como la recuperación, el estado se levanta solo cuando un pago validado deja al crédito sin cuotas vencidas ni mora (`levantarRecuperacionSiPagoTodo` atiende ahora `EN_JURIDICO`). Si ese pago se reversa, el crédito vuelve a Jurídico (`restaurarJuridicoSiEstePagoLoLevanto`, marca `juridico_levantada_pago_id`).
- **Contradice** la decisión 6 del [doc 08](./08-plan-convenios-y-recuperacion.md): ahora sí hay un camino manual a Jurídico, con aprobación del supervisor.
- **Pendiente**: Jurídico no recibe aviso propio todavía (la nota queda en la solicitud y en el aviso a supervisores). Y la bandeja de Jurídico como equipo no está definida.

### W4 · Abono inicial en el convenio

**Decisión (2026-10-09, con José): el abono es un pago normal que se valida ANTES de crear el convenio.** No se crea un pago pendiente ligado al convenio ni se toca la validación de pagos. El flujo queda así:

1. El asesor registra el abono con su comprobante («Registrar comprobante de pago»). Cartera lo recibe como pago normal.
2. Contabilidad valida el comprobante.
3. El asesor crea el convenio con el `pago_id` del abono (`abonoInicialPagoId`). El total que llega ya es el remanente, porque el abono ya bajó cuotas y mora al aplicarse.

**Hay que validarlo bien.** Cartera comprueba antes de crear nada (`createPaymentAgreement`, reglas en `lib/convenio-abono-inicial.ts`):

- El pago existe y es de **este** crédito.
- Su `validation_status` es `validated` o `capital_validated`. Un comprobante pendiente, en reset o sin validar no sirve.
- Su monto es mayor que cero.
- Su fecha es **hoy** (día de Guatemala). Esto sale del texto del Workspace («si el cliente abonó ese día»).
- No sirvió ya a otro convenio: índice único sobre `abono_inicial_pago_id`.

Del lado contrario, **reversar un abono que sostiene un convenio está bloqueado** (`reversePayment` y `revertPaymentToPending`, con `[ABONO_INICIAL_DE_CONVENIO]`): hay que anular el convenio primero. Así no queda un convenio sin plata que lo respalde.

**Por validar antes de producción (lista de QA):**

- [ ] Abono validado de hoy → el convenio se crea y `abono_inicial_pago_id` queda guardado.
- [ ] Abono pendiente → 409 «todavía no lo valida contabilidad».
- [ ] Abono de otro día → 409 «debe ser de hoy».
- [ ] Abono de otro crédito → 400.
- [ ] El mismo abono en un segundo convenio → 409 «ya sirvió para otro convenio».
- [ ] Reversar el abono de un convenio → 409 con el mensaje de anular el convenio primero.
- [ ] Un convenio creado con abono aparece igual que los demás (aprobación del supervisor, historial de decisiones).

**Pendiente de decisión:** la regla «de hoy» hace que, si contabilidad valida al día siguiente, el asesor tenga que registrar el abono de nuevo. Si esto les pesa en la operación, hay que pasarla a una ventana de días (un cambio de una línea en `lib/convenio-abono-inicial.ts`).

**Pendiente de front** (no se toca en este issue): el bloque «Abono inicial» de `convenio-modal.tsx` debe encadenar el registro del comprobante y mandar `abonoInicialPagoId` con el `pago_id` que devuelve `registrarPagoCompleto`.

## Decisiones abiertas

- W2: la aprobación de una rebaja que cartera ya no puede aplicar queda en `error_aplicacion`; hoy no hay alerta automática, solo aparece en la bandeja.
- W3: qué pasa al salir de Jurídico (fuera de alcance del PR 3).
- W4: qué pasa si contabilidad rechaza el abono después de aprobado el convenio (se decide con producto; el PR 4 bloquea la aprobación hasta validar).
