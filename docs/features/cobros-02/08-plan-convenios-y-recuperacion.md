# 8 · Plan · Convenios que no bajan de bucket + estado `EN_RECUPERACION`

**Estado:** 🔵 Acordado con el PM el **2026-09-10**. La Fase 0 ya está hecha; las
Fases 1 a 4 **no están implementadas**.
**Depende de:** [7 · Recuperación de vehículo](./07-recuperacion-de-vehiculo.md) — este
documento **resuelve** la pregunta abierta que quedó ahí.

---

## De qué se trata

Dos reglas que hoy el sistema no cumple, y que salen de la misma idea: **el bucket dejó
de ser una función pura del atraso**. Hay dos situaciones donde una decisión humana pesa
más que las cuotas vencidas, y en las dos el crédito debe quedarse quieto y con su asesor:

1. **Convenio.** Al firmarlo, el crédito **no baja de bucket ni cambia de asesor**. Se
   queda ahí hasta que se pague completo o alguien lo deshaga a mano.
2. **Recuperación de vehículo.** El botón de la Ficha 360 lo manda a B4 y le pone el
   estado `EN_RECUPERACION`, que actúa como **piso**: nunca baja de B4.

---

## Decisiones cerradas

| # | Decisión |
| --- | --- |
| 1 | El estado se llama **`EN_RECUPERACION`** |
| 2 | **Sí devenga mora** mientras está en el estado |
| 3 | Con 2, 3 o 4 cuotas se queda en **B4**. Con la **5ª sube a B5 solo**, conservando el estado |
| 4 | **El convenio manda sobre el estado.** Un convenio creado desde B4 se queda en B4, y ningún pago del convenio levanta el estado |
| 5 | El estado se levanta solo si paga **el total de lo que debe, sin convenio**, al **validarse** el pago |
| 6 | **No hay botón de "pasar a jurídico".** Volverse `INCOBRABLE` pasa por contabilidad |
| 7 | Las notificaciones van al **asesor** y a **`cobros_supervisor`** |
| 8 | **Sin días de gracia.** Todo lo dispara una persona |
| 9 | El convenio **congela bucket y asesor** hasta que se pague o se deshaga |
| 10 | Deshacer un convenio es **soft delete**, no borrado |
| 11 | El crédito en convenio **se queda en el bucket que tenía** al firmarlo |
| 12 | **Sí aparece en la cola del día**, con la prioridad de "su fecha de pago ya viene" — las cuotas del convenio heredan las fechas del crédito, así que el vencimiento es el mismo |
| 13 | **Sí cuenta para la capacidad** del asesor |
| 14 | **No devenga mora** mientras está en convenio (ya era así: `EN_CONVENIO` está en `STATUS_EXCLUIDOS_MORA`) |
| 15 | Cuando un crédito **escribe en el bot**, se le avisa a su asesor asignado — tipo nuevo de alerta + migración |
| 16 | El aviso del bot es para **todos los buckets**, no solo B0: va al asesor dueño del crédito, esté donde esté |
| 17 | El aviso se agrupa **por referencia de conversación** (`sesion_id`): una alerta por conversación, no por mensaje ni por día |
| 18 | "El total de lo que debe" para levantar `EN_RECUPERACION` **incluye la mora** |
| 19 | Los convenios que ya existen se re-siembran por **estado de pago, no por origen**: al día → **B2**, atrasado → **B4** |

> ⚠️ **Anotado para revisar con el PM.** Puede que después decidan que con 5 cuotas **no**
> suba solo a B5 y que la única forma de llegar sea el botón. En ese escenario **la mora
> tampoco correría**. Quedó escrito para no re-discutirlo desde cero.

---

## Qué significa "al día" con un convenio

El criterio del ticket dice dos cosas que parecen chocar: *"no se va a regresar de bucket"*
y *"el crédito se toma como que está al día"*. No chocan — **separan propiedad de trato**:

| Dimensión | Con convenio vigente |
| --- | --- |
| Bucket | **El que tenía al firmar.** No baja ni sube solo |
| Asesor | El mismo, hasta que se pague o se deshaga |
| Cola del día | **Sí aparece**, con la prioridad de "ya viene su fecha de pago" |
| Capacidad del asesor | **Sí cuenta** |
| Mora | **No devenga** |
| Recordatorios al cliente | Siguen, D-5/D-3/D-1/D-0 sobre las cuotas del convenio |

O sea: "al día" significa que **no se lo castiga** (no baja de bucket, no le corre mora, no
se lo trata como moroso nuevo), no que desaparezca de la gestión. Sigue siendo del asesor,
sigue ocupando su cupo y sigue saliendo en su cola el día que toca pagar.

> 📌 **Ojo con el monto en la cola.** Si se mete `EN_CONVENIO` al filtro de
> `cuotasProximas.ts` a secas, sale la **cuota normal** del crédito. Pero en convenio el
> cliente debe pagar **las dos** ese mes, y `convenioProximos.ts` ya calcula
> `monto_cuota = cuota normal + cuota del convenio`. La cola debería tomar ese número, no
> el de la cuota suelta.

## El hallazgo que define la implementación: piso, no clavo

La primera idea fue meter `EN_RECUPERACION` en `buckets.estados_incluidos` de B4, el mismo
mecanismo que hoy manda `INCOBRABLE` a B5. **No sirve**, y la decisión 3 es la razón: ese
mecanismo *clava*, y un crédito clavado en B4 nunca podría subir a B5 con la 5ª cuota.

Lo que hace falta es un **piso**:

```
bucket = max(bucket por cuotas atrasadas, 4)   mientras esté EN_RECUPERACION

   2 cuotas → max(B2, B4) = B4        4 cuotas → max(B4, B4) = B4
   3 cuotas → max(B3, B4) = B4        5 cuotas → max(B5, B4) = B5   ← sube solo
```

Nunca baja de B4, sube cuando toca, y sale del piso cuando se levanta el estado. Es un
mecanismo **nuevo** en el catálogo (un "bucket mínimo por estado"), no el que ya existe.

### Supuesto sobre "paga el total de lo que debe"

Se implementa como: **el estado se levanta cuando el crédito queda sin cuotas vencidas**
(es decir, cuando el bucket derivado daría B0), evaluado en la **validación** del pago —
no en el registro, porque una boleta se sube hoy y contabilidad la valida después.

**Confirmado el 15-sep (decisión 18): el total INCLUYE la mora.** Si pagó todas las cuotas
pero quedó debiendo mora, **no** sale de recuperación. El estado se levanta cuando no debe
nada: ni cuotas vencidas ni mora.

---

## Lo que ya existe hoy (investigado el 2026-09-10, para no re-derivarlo)

- **El job de convenios existe**: `procesarBucketsConvenio`, 00:30 GT, advisory lock 728194.
  Es el dueño único de los buckets de los `EN_CONVENIO` porque el motor de mora los excluye.
  Mide **meses atrasados** uniendo cuotas del crédito y del convenio por fecha de
  vencimiento (deber ambas del mismo mes cuenta 1, no 2).
- **Hoy hace lo contrario a la decisión 9**: la función `nacioConElConvenio` implementa
  "borrón y cuenta nueva", así que **un convenio recién hecho cae a B0** y se lo lleva el
  asesor de B0. El comentario en el código dice "regla de negocio, NO se mueve" — la
  Fase 2 la invierte.
- **El aviso al asesor NO existe.** Los recordatorios de convenio van al **cliente** por
  WhatsApp (D-5/D-3/D-1/D-0, detrás de `CONVENIO_WHATSAPP_ENABLED`). La agenda del día
  filtra `statusCredit IN ('ACTIVO','MOROSO','INCOBRABLE')` en
  `cuotasProximas.ts` — **`EN_CONVENIO` queda fuera**, por eso al asesor no le aparece la
  cuota de convenio que vence. Y `cobros_notif_tipo` no tiene ningún tipo de convenio.
- **Deshacer convenio existe pero borra y vive en carteraFront**: `updateConvenioStatus`
  (`paymentAgreement.ts`) **elimina** las filas de `convenio_cuotas`, el pivot y
  `convenios_pago`, recrea la mora y deja el crédito `MOROSO`. El CRM no consume ese
  endpoint.
- **La mora es por CUOTA, no por día**: `capital × 1.12% × cuotas_atrasadas`
  (`latefee.ts:442`). Una cuenta parada tres meses en B4 sin cruzar un vencimiento nuevo
  **no acumula un centavo más** — solo crece cuando cae una cuota.
- **`statusCredit` es una columna `text`**, no un enum de Postgres: agregar un valor no
  pide migración de columna, pero **nada en la base rechaza un valor inválido** y hay
  ~90 listas de estados escritas a mano en ~45 archivos.
- **Salida por completado ya funciona**: al pagar la última cuota el convenio se completa,
  el crédito sale a `ACTIVO` y el motor de mora lo manda a B0 en la corrida de las 23:59.

---

## Las fases

### ~~Fase 0 · Navegación~~ ✅ hecha (2026-09-10)

"Mi día" ya no se pinta para admin/supervisor: en su lugar va **Cola del día**, y
`/cobros/mi-dia` los redirige en vez de mostrarles un cartel sin salida.

### Fase 1 · Avisos — aditiva, no mueve ningún crédito ✅ implementada

La que más valor da por lo que cuesta. Nada de esto toca un bucket.

- ✅ Tipo nuevo `convenio_incumplido` en `cobros_notif_tipo` (migración **0054** del CRM).
- ✅ Job `check-convenios-incumplidos.ts`, en la tanda de las 8:00 GT junto a las otras
  alertas de cobros. Notifica **al asesor y a los `cobros_supervisor`**.
- ✅ `EN_CONVENIO` entra a la agenda del día (`cuotasProximas.ts`, `solo_al_dia=false`) y
  `monto_cuota` pasa a ser **cuota normal + lo que resta de la cuota del convenio** del
  mismo día, con el desglose aparte. Premora (`solo_al_dia=true`) no cambia.
- ✅ Pantalla **Alertas de Convenios** (`/cobros/alertas-convenios`), calcada de
  `/cobros/promesas`: las mismas cuatro tarjetas + ítem en el menú (desktop y móvil).
- ✅ Fuente única de las dos cosas: `GET /convenio/alertas` en cartera-back
  (`convenioAlertas.ts`), **una fila por convenio** con su cuota impaga más urgente ya
  clasificada (vencida · vence hoy · por vencer · próxima).
- ✅ `recordatoriosConvenio` pasa de `false` a `isTestModeEnabled()`.

#### Dedup por episodio, no por ventana de tiempo

Los jobs de alertas viejos deduplican con `created_at > now() - 24h`. Sirve cuando el
episodio dura un día; **no sirve para un convenio incumplido**, que sigue incumplido
mañana: la ventana repetiría el aviso cada mañana al asesor y a **cada** supervisor.

La migración 0054 agrega `notifications.cobros_dedup_key` (text) con un índice único
parcial sobre `(cobros_tipo, cobros_dedup_key, assigned_to)`. La llave es del **episodio**:

| Alerta | Llave | Qué la hace cambiar |
| --- | --- | --- |
| `convenio_incumplido` | `convenio:<id>:venc:<fecha>` | Pagar la cuota vencida más vieja y seguir debiendo otra |
| `bot_cliente_escribio` (Fase 1.b) | `bot:sesion:<uuid>` | Una conversación nueva del bot |

La unicidad la sostiene el índice con `ON CONFLICT DO NOTHING`, **no** un `SELECT` previo
(que no protege bajo concurrencia). Es genérica a propósito: la siguiente alerta que
necesite dedup por episodio no necesita una columna nueva.

#### El envío real al cliente sigue apagado, y es a propósito

`recordatoriosConvenio` quedó atado a `isTestModeEnabled()` y **no** a un `true` fijo —
exactamente el mismo criterio (y la misma razón) que `recordatorioPagalo`. El despliegue
documentado de esta rama corre contra una **copia de producción**, y con
`TEST_MESSAGE=false` el emisor le escribe al teléfono real del cliente.

Con el modo prueba activo, el circuito completo queda validado (cartera → plantilla →
envío → `cobros_send_logs`) sin escribirle a nadie real. Para el envío de verdad hacen
falta dos cosas más, y las dos son **decisión de negocio**: `CONVENIO_WHATSAPP_ENABLED=true`
en el ambiente y apagar el modo prueba.

### Fase 1.b · Aviso cuando el cliente escribe en el bot ✅ implementada

Sale del criterio 1 del ticket (*"si escriben por WhatsApp… el asesor asignado debe
responder"*) y **no existe nada**: el bot atiende al cliente, deja su historial en la Ficha
360 y no avisa a nadie — no hay una sola `createNotification` en todo el módulo del bot. Hoy
el asesor se entera solo si abre la ficha.

- Tipo nuevo en `cobros_notif_tipo` + migración del CRM.
- Se dispara desde el middleware `historialBotCobros`, que ya está montado comodín sobre
  `/api/bot/cobros/*`: cae solo, sin tocar cada endpoint.
- Va **al asesor dueño del crédito, sea cual sea su bucket** (decisión 16).
- **Dedup por referencia de conversación** (decisión 17). La "conversación" del bot es la
  `referencia` del paso 1 — la fila de `otps`—, que en `bot_cobros_interacciones` vive como
  **`sesion_id`**: es la misma llave por la que la Ficha 360 agrupa y numera ("Referencia 1"
  = la más vieja), y está sin FK a propósito para sobrevivir a la purga del OTP. Una alerta
  por `sesion_id`, no por mensaje ni por día.

**Mecánica de a quién avisar.** La interacción guarda `numero_sifco`, pero **solo en las
acciones sobre un crédito**: las primeras de la conversación (`buscar_cliente`,
`listar_creditos`) no lo traen. Entonces la alerta se emite en la **primera interacción de
la sesión que ya trae `numero_sifco`**, que es cuando recién se sabe de qué crédito —y por
lo tanto de qué asesor— se trata. De ahí la cadena es la de siempre: `numero_sifco` →
crédito de cartera → `asesor_id` → `email_cash_in` → usuario del CRM.

Los `acceso_fallido` quedan fuera solos: no tienen sesión (D-43) ni identidad resuelta, así
que no hay asesor a quién avisarle.

#### Cómo quedó

- Tipo `bot_cliente_escribio` en `cobros_notif_tipo` (migración **0055**). No hizo falta
  nada más: reusa la `cobros_dedup_key` de la 0054 con `bot:sesion:<uuid>`.
- `services/aviso-bot-asesor.ts`, colgado del final de `persistirInteraccion` —no del
  middleware— porque ahí ya está resuelta la sesión, que es la llave de la dedup.
- **Corte barato primero**: antes de tocar cartera se consulta si esta conversación ya
  avisó. Es el caso común (una conversación son varias peticiones) y evita un HTTP por
  cada pantalla que el cliente abre. No sustituye al índice único —dos peticiones
  simultáneas pasan el `SELECT`—, solo evita el trabajo.
- El dueño del crédito se lee de cartera **sin cache** (`getCredito(sifco, false, false)`):
  el motor pudo reasignarlo anoche y el aviso tiene que llegarle a quien lo lleva hoy. El
  `useCircuitBreaker=false` es porque esto es best-effort y no debe compartir contador de
  fallos con las operaciones que sí importan.
- El texto dice **qué vino a hacer** (`pidió su estado de cuenta`, `subió una boleta`…),
  que es lo que le dice al asesor si puede esperar o no. Una acción futura del bot sin
  texto propio avisa igual, con uno genérico — misma filosofía que D-41.

### Fase 2 · Congelar el convenio — invierte la regla vieja

- Se va `nacioConElConvenio` y el borrón y cuenta nueva.
- El job de convenios deja de mover buckets: pasa a **vigilante** (calcula el atraso solo
  para alertar). Bucket y asesor quedan donde estaban al firmar.
#### La re-siembra de los convenios que ya existen (decisión 19)

Los ~63 `EN_CONVENIO` que el job ya movió con la regla vieja están repartidos entre B0 y B5,
con asesores que no les tocaban. **No se intenta reconstruir de qué bucket venían** — esa
información no está en ningún lado y adivinarla sería peor que elegir un default honesto.

Se re-siembran por **cómo están pagando hoy**, no por su origen:

| Situación del convenio | Bucket |
| --- | --- |
| **Al día** (cumpliendo su convenio) | **B2** |
| **Atrasado** (debe alguna cuota del convenio) | **B4** |

Es un script de **una sola corrida**, idempotente, que va junto con el cambio de regla.

> 🔸 **Corre en el sandbox de dev (`cartera_cobros2`), no en producción.** Todo COBROS-02
> vive en ese schema mientras dure la rama, así que acá se mueve sin clavo: si el reparto
> no convence, se vuelve a correr. El día que esta versión pase a producción, el criterio
> se revisa entonces — no es una decisión que frene el desarrollo hoy.

**Cómo se mide "al día" acá.** Se reusa el modelo que el job de convenios ya calcula: meses
atrasados = fechas de vencimiento distintas, pasadas, con algo impago, uniendo las cuotas
del crédito no absorbidas por el convenio + las cuotas del convenio vencidas. Cero meses
atrasados = al día → B2; uno o más → B4.

### Fase 3 · Ficha 360 — banda roja y acciones

- Sacar "Recuperación de vehículo" del dropdown de **Más acciones** y darle un lugar fijo
  y visible en la fila de acciones.
- Banda roja arriba cuando: (a) hay convenio activo con cuota vencida impaga, o
  (b) está `EN_RECUPERACION` y ya acumuló 5 cuotas.
- **Tres** acciones (la de jurídico se cayó por la decisión 6):
  - Deshacer convenio
  - Deshacer convenio y mandar a recuperación (B4)
  - Mandar a recuperación (B4) — **habilitado solo en B1–B3**
- **Soft delete** del convenio: columnas nuevas (`anulado_at`, `anulado_por`, `motivo`) y
  migración de cartera. Ojo: carteraFront consume el mismo endpoint, el cambio se ve allá.

### Fase 4 · El estado `EN_RECUPERACION` — la invasiva, de último

- El **piso** en B4 (mecanismo nuevo, ver arriba).
- El levantamiento del estado al **validarse** un pago que deja el crédito sin cuotas
  vencidas.
- La **precedencia del convenio** por encima del estado (decisión 4).
- El triaje de las ~90 listas de estados escritas a mano, una por una, marcando cuáles
  necesitan visto bueno de contabilidad.

---

## Lo que sigue sin definirse

**Nada.** Las tres preguntas que quedaban se cerraron el 15-sep (decisiones 16 a 19).

Y una aclaración que evita cautela de más: **este plan se ejecuta contra el sandbox de dev
(`cartera_cobros2`)**, no contra producción. Los scripts de re-siembra y los cambios de
regla se prueban ahí y se pueden repetir cuantas veces haga falta. El pase a producción es
otro momento, con su propio runbook
([RUNBOOK-refrescar-sandbox.md](./RUNBOOK-refrescar-sandbox.md) es el ensayo).
