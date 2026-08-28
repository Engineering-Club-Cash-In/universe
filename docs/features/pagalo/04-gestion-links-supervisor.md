# CB-127 · Gestión de links Págalo vencidos, fallidos o duplicados

**Estado:** implementado — Ficha 360, bandeja de supervisión (`/cobros/pagalo`)
y backend de ciclo de vida por link individual.
**Ambiente:** desarrollo/sandbox, igual que el resto de CB-028.

## Objetivo

Un supervisor de cobros necesita, para un grupo Págalo:

1. ver el estado real de cada link (motivo de falla, reintentos, antigüedad,
   generación) y una bitácora completa de eventos;
2. entender qué cuotas cubre cada link (`allocationsSnapshot` es por grupo,
   no por link);
3. actuar sobre un link puntual que quedó vencido, fallido o duplicado:
   invalidarlo o regenerarlo dentro del mismo grupo, sin tocar el resto.

Ver [DECISIONES.md](./DECISIONES.md) D-19/D-20/D-21 para las reglas cerradas.
Este documento describe la implementación.

## Alcance: acciones por LINK, no por grupo

La primera versión ofrecía invalidar/regenerar el **grupo completo**
(`invalidarGrupoPagalo`, `regenerarGrupoPagalo`, `reintentarDispatchPagalo`,
componente `AccionesSupervisorPagalo`). Se retiró de la UI a pedido explícito:
un grupo puede tener un link `CAPITAL` pagado y otro `MORA_INTERES` vencido —
invalidar el grupo entero de un jalón afecta al que sí está bien. Los tres
procedures de grupo siguen en el backend (`pagalo-group-lifecycle.ts`,
`pagalo-link-orchestrator.ts`) por si se reactivan, pero **ningún componente
de UI los llama hoy**.

Lo que sí existe y se usa: acciones sobre **un link individual**,
gateadas a `cobros_supervisor` (`PERMISSIONS.canAssignCobros`) tanto en
servidor (`cobrosSupervisorProcedure`, `pagalo-supervision.ts`) como en la UI
(`ChipLinkPagalo`,
`apps/crm/apps/web/src/components/cobros/pagalo/chip-link-pagalo.tsx`).

## Invalidar un link

`invalidarLinkPagalo` → `invalidarLink`/`invalidarLinkEnTx`
(`pagalo-group-lifecycle.ts`): marca **ese link** `REPLACED` — el grupo NO
se cancela. Si el grupo sigue vivo (no `CANCELLED`/`COMPLETED`), escala a
`REVIEW_REQUIRED` porque ya no hay certeza de que pueda completarse tal como
está; el supervisor decide desde ahí si regenera el link o resuelve el grupo
por otra vía.

Orden de candados: **grupo primero, link después** — mismo orden que
`invalidarGrupoEnTx` y que el poller (`marcarLinkPagado`, `pagalo-poll.ts`).
El `groupId` se resuelve con una lectura sin candado antes de bloquear, para
poder tomar el grupo antes que el link sin dos round-trips extra.

Bloqueada si el link ya está `PAID` (no se invalida dinero que entró) o si
no está vivo (`CREATING`/`ACTIVE`) — no tiene sentido invalidar algo que ya
terminó su ciclo.

**En la UI, el botón "Invalidar link" está deshabilitado a propósito**
(`INVALIDAR_HABILITADO = false` en `chip-link-pagalo.tsx`): la acción solo
marca `REPLACED` en nuestra DB — Págalo no publica API para cancelar el link
real, así que el link quedaría "invalidado" acá pero vivo y cobrable allá.
Se reactiva cuando exista esa API (D-21).

Requiere motivo (mínimo 10 caracteres), que queda en el payload del evento
`LINK_INVALIDATED_BY_SUPERVISOR`.

## Regenerar un link

`regenerarLinkPagalo` → `regenerarLinkIndividual`
(`pagalo-link-orchestrator.ts`): crea un link **nuevo del mismo tipo, dentro
del mismo grupo** — a diferencia de `regenerarGrupo` (retirado de la UI), no
cancela el grupo ni crea uno nuevo.

Solo disponible cuando el link viejo ya quedó cerrado sin pago
(`REPLACED`/`EXPIRED`/`CANCELLED`/`ERROR`). Usa el mismo monto ya congelado
en el grupo (`capitalTotal`/`facturableTotal` según tipo) — no recalcula
contra deuda viva, para mantener coherencia con el otro link del grupo si
sigue vivo.

El link nuevo lleva `generation = generación anterior de ese tipo + 1` y
`supersedesLinkId` apuntando al link que reemplaza
(`proximaGeneracion`, `pagalo-group-lifecycle.ts`).

Requiere motivo (mínimo 10 caracteres), que queda en el payload del evento
`LINK_REGENERATED_BY_SUPERVISOR`.

**No disponible para grupos del bot sin `casoCobroId`** (D-45, contrato con
bot-whatsapp-cobros): regenerar necesita resolver teléfono/correo/dirección
del cliente vía `casosCobros`, y esos grupos no tienen caso de cobro
asociado. El botón "Regenerar" no se ofrece en la UI para esos grupos
(`ChipLinkPagalo`, chequeo `!!casoCobroId`); el server lo rechaza igual como
defensa. La bandeja sigue mostrando esos grupos con todo su historial —
solo la acción de regeneración queda fuera de alcance.

## Cancelar en Págalo (sin acción propia todavía)

No existe botón separado: la advertencia de que el link real sigue cobrable
en Págalo vive dentro del diálogo de "Invalidar link". Esa acción existe en
la UI pero queda deshabilitada (`INVALIDAR_HABILITADO = false`,
`chip-link-pagalo.tsx`) hasta que Págalo confirme un endpoint de
cancelación — esa acción real seguirá siendo por link individual, no por
grupo — ver [DECISIONES.md
D-21](./DECISIONES.md#d-21--invalidar-link-queda-deshabilitado-hasta-tener-contrato-de-cancelación-cb-127).

## Historial de generaciones (links reemplazados/vencidos)

Un link viejo (generación anterior de un tipo, dentro del mismo grupo) nunca
se borra ni se sobrescribe — sigue siendo su propia fila, con `status` final
y el motivo de su cierre en la bitácora. Tanto la bandeja como Ficha 360
agrupan por `linkType` con `agruparLinksPorGeneracion`
(`apps/crm/apps/web/src/lib/cobros/pagalo-link-display.ts`, función pura
testeada): la generación vigente (mayor `generation` de ese tipo) se muestra
normal; las anteriores quedan detrás de un toggle colapsado por defecto
("+N anterior(es)" en la bandeja, "Ver N generación(es) anterior(es)" en
Ficha 360) — no se mezclan con el vigente en la vista por defecto, pero
siguen siendo del mismo grupo y a un click de distancia.

El motivo de cierre de cada link (invalidado por supervisor, o cerrado por
Págalo — expirado/cancelado desde su lado) se resuelve en
`getPagaloSupervision` cruzando `pagaloPaymentEvents` por `linkId`
(`eventType IN ('LINK_INVALIDATED_BY_SUPERVISOR', 'LINK_TERMINAL')`), solo
para los links de la página visible.

No hay ambigüedad de "cuál link vale": el schema lo garantiza con dos
índices únicos parciales — `pagalo_payment_links_active_type_uq` (un único
link `CREATING`/`ACTIVE` por tipo por grupo) y
`pagalo_payment_links_application_source_uq` (un único link por tipo puede
tener `isApplicationSource = true`, el que de verdad cuenta para aplicar el
pago). El poller y el dispatcher siguen ese flag, nunca eligen por heurística.

## Bitácora

`getPagaloHistorial` devuelve `eventos` por grupo. Catálogo de traducción a
español en `apps/crm/apps/web/src/components/cobros/pagalo/formato-pagalo.ts`
(`EVENTO_LABEL`, `FUENTE_LABEL`, `MOTIVO_REVISION_LABEL`).

Tipos de evento del ciclo de vida por link:

| `eventType` | Emitido en | Motivo |
| --- | --- | --- |
| `LINK_CREATE_FAILED` | `pagalo-link-orchestrator.ts` (`emitirLinksDeGrupo`) | Antes solo se escribían `errorCode`/`errorMessage` en columnas, sin evento — la bitácora no explicaba por qué un link quedó `ERROR`. |
| `POLL_RETRY_EXHAUSTED` | `pagalo-poll.ts` (`registrarIntentoFallido`) | Solo al cruzar `pollAttempts === 5` — no en cada intento, con backoff exponencial hasta 30 min serían decenas de filas por link. |
| `DISPATCH_RETRY_EXHAUSTED` | `pagalo-dispatch.ts` (`registrarIntentoFallido`) | Mismo criterio de umbral que el anterior. |
| `LINK_INVALIDATED_BY_SUPERVISOR` | `pagalo-group-lifecycle.ts` (`invalidarLinkEnTx`) | Acción de supervisor sobre un link. |
| `LINK_REGENERATED_BY_SUPERVISOR` | `pagalo-link-orchestrator.ts` (`regenerarLinkIndividual`) | Acción de supervisor sobre un link. |

`LINK_TERMINAL` (link `EXPIRED`/`CANCELLED` reportado por Págalo) tiene
payload real: `motivo`, `providerStatus`, `pollAttempts` y `antiguedadHoras`.

**Deuda pendiente**: los procedures de grupo retirados de la UI
(`invalidarGrupoPagalo`, `regenerarGrupoPagalo`, `reintentarDispatchPagalo`)
siguen sin emitir un evento propio de "reintento forzado por supervisor" —
si se reactiva esa UI, `reintentarDispatchPagalo` debería insertar
`DISPATCH_RETRY_FORCED` (nombre ya reservado en `EVENTO_LABEL`) antes de
llamar `reclamarYProcesarGrupo`, para dejar constancia de quién forzó el
reintento y no solo el resultado final.

## Vista por cuota

`allocationsSnapshot` es **por grupo**, no por link: un link `CAPITAL` cubre
todas las cuotas del snapshot con ese `link_type`. El mapeo es
cuota → tipo de link → link, **N:1** — nunca un link dedicado a una sola
cuota.

`agruparPorCuota` (`apps/crm/apps/web/src/lib/cobros/pagalo-allocations-view.ts`)
agrupa el snapshot por `numero_cuota` (las filas sin cuota — mora pura de un
grupo solo-mora — forman un bloque sintético "Mora"). Se carga bajo demanda
con `getPagaloAllocations({ groupId })` al expandir "Ver links por cuota" —
no viaja en el payload principal porque puede ser hasta 24 cuotas × 4 rubros
por grupo.

`getPagaloAllocations` usa `cobrosProcedure` (no requiere supervisor) y
verifica acceso con `assertAccesoCasoCobro` cuando el grupo tiene
`casoCobroId`. Para un grupo **sin** `casoCobroId` (creado por el bot, sin
gestión de asesor asociada) no hay "dueño" a quien verificarle propiedad —
la regla es exigir `cobros_supervisor` (`PERMISSIONS.canAssignCobros`)
directamente. Corregido tras code review: antes esa rama no verificaba nada,
y cualquier usuario de cobros con el `groupId` de un grupo del bot podía leer
su desglose financiero completo.

Por cuota se muestra un badge por tipo de link involucrado con su link
concreto: generación y estado (`Capital · Gen 2 · Activo`). Si ese tipo no
tiene link vivo, se muestra atenuado el histórico de generación más alta
(el más reciente, no el primero que devuelve la query) en vez de un texto
genérico de "sin link vigente".

## Bandeja de supervisión

Ruta `/cobros/pagalo`: tabla de grupos, filtrable por chips de estado
(multi-select, con contador `(N)` calculado en SQL vía `GROUP BY` — siempre
sobre el universo completo, no sobre el filtro activo) y por SIFCO.

**Sin chips seleccionados se muestran TODOS los grupos**, no solo los
problemáticos — decisión explícita: el filtro "solo problemático"
(`condicionGrupoProblematico`: `REVIEW_REQUIRED`/`APPLICATION_FAILED`,
`LINKS_PENDING` huérfano >5min, `PENDING_PAYMENT` estancado >7 días) sigue
existiendo en el server (`soloProblematicos`, default `true`), pero la UI lo
pasa en `false` cuando no hay chips activos.

La paginación es en SQL (`LIMIT`/`OFFSET` reales), incluido el filtro
`problemasLink`: se resuelve con un `EXISTS` correlacionado contra
`pagalo_payment_links` dentro del mismo `WHERE`, no cruzando en memoria
después de traer los grupos. El conteo total (`total`) y el conteo por
estado (`conteoPorEstado`, para los contadores `(N)` de los chips) también
son `SELECT count()`/`GROUP BY` en SQL sobre el universo completo, no sobre
la página cargada.

Cada fila usa el mismo `GrupoLinksPorTipo`/`ChipLinkPagalo` con historial de
generaciones colapsado. El nombre del cliente se resuelve con una sola
llamada bulk a cartera-back por página (`getAllCreditos` con lista de
SIFCOs), no una por fila.
