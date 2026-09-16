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
| `bot_cliente_escribio` (Fase 1.b) | `bot:sesion:<uuid>:credito:<sifco>` | Una conversación nueva, o un crédito distinto dentro de ella |

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
  por conversación, no por mensaje ni por día.
- **El crédito entra en la llave**, junto a la conversación. El índice único lleva
  `assigned_to` (otras alertas de cobros van al asesor *y* a cada supervisor), así que una
  llave de solo `sesion_id` no garantizaba nada cuando dos peticiones simultáneas de la
  misma conversación tocaban créditos de **asesores distintos**: las dos insertaban. Con el
  crédito adentro, lo que la base sostiene es lo que el código promete — y la semántica que
  queda es la que conviene: diez pantallas del mismo crédito son **un** aviso, y dos
  créditos de dos asesores son **uno para cada dueño**.

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
- **Solo si la interacción probó que el crédito es del cliente.** El `numero_sifco` sale
  del *body*, así que una sesión válida con el crédito de OTRO cliente llega hasta acá; el
  endpoint la rechaza pero el historial se escribe igual, y avisar ahí le manda el aviso al
  asesor del crédito ajeno. Pero exigir que **toda** la operación salga bien es demasiado:
  un `CARTERA_NO_DISPONIBLE` ocurre *después* de verificar la propiedad, sobre el crédito
  legítimo — y es justo cuando el cliente más necesita que alguien lo llame, porque el bot
  no pudo ayudarlo. El filtro es una **lista blanca** de códigos posteriores al control
  (`CODIGOS_POSTERIORES_AL_CONTROL`): todo lo demás calla.

  > La lista empezó siendo **negra** —enumerar los fallos de acceso y avisar en el resto—
  > y se rompió por algo invisible desde ese archivo: los controladores **traducen** el
  > código antes de que el historial lo lea. `CREDITO_NO_ES_DEL_CLIENTE` sale al mundo como
  > `CREDITO_NO_ENCONTRADO` (a propósito, para que nadie averigüe qué créditos existen
  > probando números), así que el caso que la lista existía para bloquear pasaba igual. La
  > moraleja no fue agregar ese código: fue que **no se puede enumerar con confianza todas
  > las formas en que la propiedad puede fallar**, porque el vocabulario lo define otra capa.
  > Lo contrario sí se puede enumerar. Con lista blanca, un código nuevo cuesta un
  > seguimiento perdido; con lista negra, costaba avisarle al asesor de un crédito ajeno.
  >
  > Y la lista blanca tiene su propia condición, que tampoco se ve desde ese archivo:
  > cada código vale como prueba **solo si su camino verifica la propiedad antes de
  > devolverlo**. `MONTO_DESACTUALIZADO` no lo cumplía — `crearPagoLink` validaba el monto
  > antes de `armarContexto`, así que un monto basura contra el SIFCO de otro cliente
  > devolvía un código "posterior al control" sin haber pasado por ninguno. Se invirtió el
  > orden y se auditaron los 17 códigos: los demás salen después de `armarContexto` o de
  > una fila acotada a `(otpId, numeroSifco)`. Hay una prueba sobre el orden en la fuente,
  > porque es exactamente lo que un refactor puede invertir sin que nada más lo note.
- **Sin caso de cobros también avisa**, pero sin enlace. `sync-casos-cobros` solo mantiene
  un caso activo cuando `diasMora > 0`, así que exigirlo dejaba justo a los buckets sanos
  sin aviso — los mismos que la decisión 16 nombra. Un cliente al día que escribe es de
  los que más vale la pena atender rápido.

### Fase 2 · Congelar el convenio — invierte la regla vieja ✅ implementada

- ✅ El job de convenios **dejó de mover buckets y de reasignar asesores**: pasó a
  vigilante. Calcula el atraso solo para el log y hace de red de seguridad.
- ✅ El congelamiento ocurre **al firmar** (`createPaymentAgreement`): se lee el bucket
  ANTES de borrar la mora y ANTES del cambio de estado —los dos pasos que destruyen la
  información con la que se deriva— y se escribe la fila.
- ✅ Evento nuevo **`CONGELADO`** en `cartera.bucket_evento_tipo` (migración **0017**).
- ✅ Script de re-siembra `src/scripts/resiembraConveniosBuckets.ts`, idempotente, con
  simulación por default.

#### Por qué hizo falta un evento nuevo

Los tres eventos que había describen **movimiento**, y el CHECK de coherencia los obliga a
moverse (`SUBIDA` exige `bucket_nuevo > bucket_anterior`, etc.). No existía forma de
registrar *"se quedó donde estaba, y a propósito"*. Un `INICIAL` tampoco servía:
`buckets_historial_uq_inicial` permite **una sola** línea base por crédito y estos ya la
tienen de cuando eran MOROSO.

Y la fila tiene que existir: para un crédito `EN_CONVENIO`, `bucketActualSql` ignora —a
propósito, review Codex #1223— todo el historial que no sea de su régimen de convenio. Sin
fila propia, el crédito se queda **sin bucket visible**.

#### Dos criterios de "atrasado", y por qué el default es el estricto

Este documento decía dos cosas distintas sin darse cuenta: la tabla de la decisión 19 dice
*"debe alguna cuota **del convenio**"*, y el párrafo "Cómo se mide al día" dice *"uniendo
las cuotas del crédito no absorbidas **+** las del convenio"*. Medido contra el sandbox, la
diferencia no es cosmética:

| Criterio | Qué pregunta | Atrasados en dev (de 63) |
| --- | --- | --- |
| `convenio` (**default**) | ¿Está cumpliendo el acuerdo que firmó? | **9** |
| `union` (`--criterio=union`) | ¿Debe algo, convenio o cuota normal del mes? | **57** |

Se implementó el estricto como default porque el ancho **no clasifica, vuelca**: manda el
90% de los convenios a B4 (pre-jurídico) y a un solo asesor. El otro queda disponible con
una bandera y el vigilante loguea **las dos** medidas cada noche.

> 🔸 **Para el PM**: la diferencia entre los dos números —48 créditos— es *"gente que paga
> su convenio pero no su cuota normal del mes"*. Hoy nadie está mirando ese dato, y
> decidir si eso es incumplir el convenio o no es de negocio, no de código.

#### La idempotencia se acota al convenio VIGENTE

`buckets_historial` es append-only: las filas de un convenio viejo **nunca se borran**.
Preguntar *"¿tiene alguna fila con `status_credito = 'EN_CONVENIO'`?"* daba verdadero para
siempre, así que un crédito que completó o rechazó un convenio y después firma **otro** se
quedaba sin congelar — ni al firmar ni en la red de seguridad — y el lector seguía
exponiendo el bucket del convenio anterior.

La comprobación lleva ahora un corte por la fecha de creación del convenio. Sin ese
parámetro conserva el comportamiento viejo, que es lo correcto para un caller que no sabe
de qué convenio habla.

El corte se calcula sobre los convenios **que todavía no terminaron**, aprobados *o*
esperando aprobación — no solo los `activo = true`. Un convenio recién firmado nace
inactivo mientras el supervisor decide, pero el crédito ya quedó `EN_CONVENIO`: dejándolo
fuera del corte, la red de seguridad no podía reparar un congelamiento fallido durante
todo ese período (indefinido si nadie decide). El **atraso**, en cambio, se sigue midiendo
solo sobre los activos: un convenio sin aprobar todavía no reestructuró nada.

#### Comprobar e insertar van juntos

El advisory lock del vigilante solo lo serializa **contra sí mismo**. Si la firma de un
convenio se cruza con esa corrida, las dos pueden ver "todavía no está congelado" y las dos
insertan — y para un crédito sin historial previo la firma usa su bucket vivo mientras el
vigilante cae al default B2/B4, así que el que gane por timestamp decide el bucket visible
y puede violar justo la regla que este código existe para sostener.

El lock cubre desde **leer el bucket** hasta **escribir la fila** —
`pg_advisory_xact_lock(CREDITO_ASESOR_LOCK_NAMESPACE, credito_id)`, la misma llave que usa
la reasignación de asesor, porque el congelamiento fija bucket **y** dueño.

Cubrir solo el check y el insert no alcanzaba: el vigilante podía arrancar en medio, tomar
el lock primero e insertar su fallback B2/B4, y después el firmante encontraba esa fila y
descartaba el valor autoritativo que ya tenía en la mano. El bucket de un crédito sin
historial terminaba decidido por el job en vez de por la firma.

Y la lectura del bucket **ignora el historial de convenio**: para un crédito que ya no está
`EN_CONVENIO`, el lector general acepta cualquier régimen — incluida la fila `CONGELADO` de
un convenio anterior. Si se rechaza un convenio y se firma otro antes de que corra el motor
de las 23:59, el rechazo no escribe historial de bucket, así que el nuevo se congelaba en el
bucket del viejo en vez del que le toca por su mora de hoy.

#### El orden importa más que el lock

Con el lock ya cubriendo la lectura, la lectura seguía en el lugar equivocado: **después**
de borrar la mora activa y de pasar el crédito a `EN_CONVENIO`. Esos dos pasos destruyen
justo la información con la que se deriva el bucket, así que para un crédito sin historial
la derivación caía al rango por cuotas, que sin mora da **B0** — el "borrón y cuenta nueva"
que esta fase existe para impedir. El comentario del código decía "la lectura tiene que ir
antes"; el código la tenía después.

Ahora es **una sola transacción** con el lock por crédito: *leer → borrar mora → cambiar
status → congelar*. Los dos pasos que pueden fallar sin que eso deba tumbar el convenio
(la lectura y el congelamiento) van cada uno en un `SAVEPOINT`: en Postgres un statement
que falla aborta la transacción entera, y con el savepoint su fallo se descarta solo.

El lector del **vigilante** tenía la misma omisión que ya se había corregido en el de la
firma: tomaba la última fila de cualquier régimen. Toda fila `EN_CONVENIO` que llegue a ver
es de un convenio **anterior** —si fuera del vigente, el corte por fecha habría cortado
antes—, así que si fallaba el congelamiento de un segundo convenio, el vigilante reinsertaba
el bucket del primero después del corte nuevo y lo dejaba certificado para siempre.

#### Cuándo termina el congelamiento: en el motor, no antes

No hay evento de "salida" al completar, rechazar o deshacer el convenio, y es a propósito
(se planteó en la review). El crédito vuelve a `ACTIVO`/`MOROSO` y la fila `CONGELADO` sigue
siendo la última hasta que el motor de las 23:59 deriva el bucket real y escribe la
transición. La ventana es de horas: el motor recorre **todos** los créditos con cuotas, no
solo los morosos (en el sandbox hay `BAJADA` a B0 registradas).

Escribir la salida en el momento se ve más correcto y es peor: el motor **solo reasigna
cuando detecta cambio de bucket**. Una fila eager con el bucket ya correcto se come esa
transición, y el crédito queda en su bucket nuevo con el asesor de B4/B5 que tenía
congelado, sin nada que lo vuelva a mover. Soltar el congelamiento y re-hogar el crédito son
el mismo paso, y ese paso vive en el motor.

#### La trampa de Drizzle que se pagó acá

La medición vivía copiada en el job y en el script. En la copia del script la subconsulta
correlacionada de `hasPaidPayment` daba **siempre verdadero** y el atraso salía 0: Drizzle
solo califica la columna externa cuando la query tiene más de una tabla, así que con un
`select().from(cuotas_credito)` a secas emitía

```sql
EXISTS (SELECT 1 FROM pagos_credito pc WHERE pc.cuota_id = "cuota_id" ...)
```

y ese `"cuota_id"` sin calificar Postgres lo resuelve contra `pc` — o sea
`pc.cuota_id = pc.cuota_id`, siempre cierto. **Toda cuota se leía como pagada.** Con el
`INNER JOIN` a `creditos` califica bien y correlaciona. Se arregló extrayendo UNA
implementación (`controllers/buckets/atrasoConvenio.ts`) que usan el vigilante y el
script; la trampa quedó documentada en su cabecera.

#### La re-siembra de los convenios que ya existen (decisión 19)

Los ~63 `EN_CONVENIO` que el job ya movió con la regla vieja están repartidos entre B0 y B5,
con asesores que no les tocaban. **No se intenta reconstruir de qué bucket venían** — esa
información no está en ningún lado y adivinarla sería peor que elegir un default honesto.

Se re-siembran por **cómo están pagando hoy**, no por su origen:

| Situación del convenio | Bucket |
| --- | --- |
| **Al día** (cumpliendo su convenio) | **B2** |
| **Atrasado** (debe alguna cuota del convenio) | **B4** |

Es un script idempotente que va junto con el cambio de regla:

```bash
bun run src/scripts/resiembraConveniosBuckets.ts            # simulación
bun run src/scripts/resiembraConveniosBuckets.ts --apply    # escribe
bun run src/scripts/resiembraConveniosBuckets.ts --criterio=union   # el criterio ancho
```

Reasigna también el **asesor**, con la misma regla del motor (`elegirAsesorParaBucket`: si
el dueño actual ya cubre el bucket destino se queda, sin churn; si no, el del pool con
menos carga). Un crédito re-sembrado en B2 con un asesor de B0 no lo gestiona nadie.

**Corrido en dev el 15-sep**: 54 al día → B2 (repartidos entre Jorge y Samuel), 9 atrasados
→ B4 (Erik), 39 reasignaciones. La segunda corrida no escribe nada.

> 🔸 **Corre en el sandbox de dev (`cartera_cobros2`), no en producción.** Todo COBROS-02
> vive en ese schema mientras dure la rama, así que acá se mueve sin clavo: si el reparto
> no convence, se vuelve a correr. El día que esta versión pase a producción, el criterio
> se revisa entonces — no es una decisión que frene el desarrollo hoy.

**Cómo se mide "al día" acá.** Se reusa el modelo que el job de convenios ya calcula: meses
atrasados = fechas de vencimiento distintas, pasadas, con algo impago, uniendo las cuotas
del crédito no absorbidas por el convenio + las cuotas del convenio vencidas. Cero meses
atrasados = al día → B2; uno o más → B4.

### Fase 3 · Ficha 360 — banda roja y acciones ✅ implementada

- ✅ "Recuperación de vehículo" salió del dropdown de **Más acciones**. Estaba escondida
  entre cartas notariales y estados de cuenta siendo la decisión más grave de la pantalla;
  ahora tiene lugar fijo en la fila de acciones.
- ✅ Banda roja arriba de la identidad del caso cuando el convenio está incumplido. La
  rama (b) —`EN_RECUPERACION` con 5 cuotas— llega con la Fase 4, que es la que crea el
  estado.
- ✅ Las **tres** acciones (la de jurídico se cayó por la decisión 6):
  - Deshacer convenio
  - Deshacer convenio y mandar a recuperación (B4)
  - Mandar a recuperación (B4) — **habilitado solo en B1–B3**, y cuando no aplica se
    deshabilita con el motivo en el título, no se esconde.
- ✅ **Soft delete** del convenio (migración **0018** de cartera).

#### Deshacer ≠ rechazar

Son dos operaciones distintas y por eso son dos funciones distintas:

| | Rechazar (CB-033) | Deshacer (Fase 3) |
| --- | --- | --- |
| Sobre qué | Un convenio que **nunca estuvo vigente** | Un acuerdo **firmado** que dejó de pagarse |
| Qué hace con la fila | `DELETE` duro | `anulado_at` + motivo + quién |
| Por qué | No hubo acuerdo: no hay nada que conservar | Borrarlo destruye el plan de cuotas y la traza de lo que sí pagó |

El efecto financiero **sí** es el mismo, porque la pregunta es la misma: *¿cuánto debe
este crédito si el convenio no existiera?* Se recuenta el atraso real y se recrea la mora,
o queda `ACTIVO` si ya no debe nada. El bucket se suelta solo: al volver a `MOROSO`, el
motor de las 23:59 lo vuelve a derivar y escribe la transición contra la fila `CONGELADO`.

> ⚠️ **`anulado_at` no es decorativo.** Un convenio deshecho queda con `activo=false` y
> `completado=false` — **exactamente** la firma de "pendiente de aprobación" (CB-033). Sin
> filtrar por esa columna, un convenio deshecho reaparece en la cola del supervisor y
> aprobarlo lo resucita. Se filtró en los dos lugares que importan: el `UPDATE` de
> exclusión mutua de `decidirConvenio` y el filtro `pending` de `listPaymentAgreements`.
> Un CHECK exige además que la anulación esté completa (fecha + motivo) o no exista.

Probado contra el sandbox dentro de una transacción revertida: el segundo intento de
anular no toca ninguna fila, el convenio anulado no aparece como pendiente, y el CHECK
rechaza una anulación sin motivo.

#### Tres cosas que la review de Codex corrigió acá

- **La escritura revalida al dueño.** Autorizar y escribir son dos requests distintas:
  entre una y otra el motor o un supervisor pueden reasignar el crédito, y sin
  precondición el asesor que acaba de perderlo deshacía igual el convenio. Ahora viaja el
  dueño **esperado** y cartera lo revalida dentro de su transacción — la misma carrera que
  la recuperación de vehículo ya cerraba así.
- **El convenio se resuelve con una consulta dedicada**, no leyendo
  `getCredito().convenioActivo`: ese endpoint devuelve temprano con `convenioActivo: null`
  *hardcodeado* cuando el calendario original del crédito ya no tiene ninguna cuota de hoy
  en adelante — y un convenio puede sobrevivir al calendario que reestructuró. Justo los
  créditos más atrasados, los que más necesitan deshacer, se quedaban sin la acción.
- **La banda no caduca al año.** El `diasAtras` de 365 es una cota de *volumen* del
  listado; en una consulta ya acotada a un solo crédito hacía desaparecer la banda roja
  cuando la cuota impaga más vieja pasaba del año — justo el caso más grave.

#### Deshacer es una escritura destructiva, y se protege como tal

Cuatro cosas más que salieron de la segunda review:

- **La condición de dueño viaja DENTRO del `UPDATE`**, no en un `SELECT` previo. Dos
  statements son dos momentos: bajo READ COMMITTED una reasignación puede commitear entre
  medio y el asesor que ya perdió el crédito pasaba igual el chequeo. Con el predicado en
  el `WHERE`, comprobar y escribir son el mismo acto — o el crédito sigue siendo suyo en el
  instante en que se escribe, o no se escribe nada. Además se toma el lock por crédito, el
  mismo de la reasignación y la recuperación.
- **Un pago no puede resucitar un convenio deshecho.** `processConvenioPaymentEnTx`
  actualizaba por `convenio_id` a secas y escribía `activo: true` desde un snapshot leído
  antes, dejando `anulado_at` puesto: el convenio volvía a la vida y seguía recibiendo
  pagos. El `UPDATE` ahora exige que siga vigente, y si no, la transacción del pago aborta.
- **Una sola definición de "convenio vigente"**, compartida por la mutación y por el botón
  que la ofrece (`resolverConvenioVigenteDelCaso`). Busca por **`credito_id` exacto y sin
  paginar**: el listado filtra el SIFCO con `ILIKE '%valor%'`, así que uno que es subcadena
  de otro podía traer el convenio del crédito equivocado —o empujar al correcto fuera de la
  página y reportar que no hay ninguno—. En el sandbox hay **una** colisión de esas, así
  que no es teórico.
- **Vigente excluye "pendiente de aprobación".** Un convenio recién creado ya deja el
  crédito en `EN_CONVENIO` pero nace `activo = false`: eso se **rechaza** desde la cola del
  supervisor, no se deshace. Guiando el botón por `statusCredit` aparecía igual y cada
  clic terminaba en error.
- **Una reversa descuenta al convenio del PAGO, y no resucita uno deshecho.**
  `reverseConvenioPayment` elegía "algún convenio de este crédito" con un `.limit(1)`, y eso
  se rompe de las dos formas posibles: si el convenio del pago se deshizo, no había nada que
  descontar; y si después se firmó otro, el pago viejo le descontaba a **ese**, que nunca lo
  recibió. Un convenio anulado **sí** recibe el descuento —el pago existió— pero no vuelve
  a `activo`: deshacerlo fue una decisión humana y una reversa contable no la revierte.
  (Cómo se identifica ese convenio lo corrigió la ronda siguiente: ver abajo.)
- **La anulación toma también el lock de PAGOS.** Es otra llave que la del lock por crédito,
  y las dos hacen falta: `reversePayment` sostiene aquella mientras deshace un pago, y su
  actualización del convenio es una escritura suelta que podía interleavearse con la
  anulación. Va por fuera de la transacción, porque ese lock usa el pool dedicado y su
  propia documentación prohíbe esperarlo con conexiones del pool de trabajo.

#### A qué convenio se le acreditó un pago: se sella, no se adivina

La ronda anterior resolvía el convenio de un pago por el pivot `convenios_pagos_resume`
y lo llamaba "la respuesta exacta". **No lo era.** Ese pivot se llena *una vez*, al crear
el convenio, con las filas pre-sembradas de las cuotas que reestructura; los pagos que
después se le acreditan caen en otras filas. En el sandbox, **196 de 204** pagos con
`pago_convenio > 0` no tienen fila ahí. El pivot casi nunca acertaba, y el respaldo
—"el convenio vigente del crédito"— excluía los anulados, que es justo cuando la reversa
tiene que encontrarlos.

La respuesta exacta solo existe en el instante de acreditar, así que se guarda ahí:
**`pagos_credito.convenio_id`** (migración **0022**). No lo escribe cada sitio por su
cuenta: el estampador que ya garantizaba que *una sola* fila por boleta carga el monto
(`crearEstampadorPagoConvenio`) ahora entrega monto y convenio **en el mismo consumo**
(`campos()`). Por construcción, la fila que carga uno es la única que carga el otro.

La reversa busca en este orden (`convenioQueRecibioElPago`):

| Criterio | Cuándo aplica | Exacto |
| --- | --- | --- |
| El sello de la fila | Todo pago registrado desde la 0022 | Sí |
| El pivot | Filas pre-sembradas que se cobraron | Sí, cuando acierta |
| El convenio más reciente del crédito, anulados incluidos | Pagos viejos sin sello ni pivot | Salvo un crédito con varios convenios y un pago del anterior: **1 pago** en el sandbox |

Dato aparte que salió midiendo, y que **no** cambia con esto: hay **22** pagos con
`pago_convenio > 0` cuyo crédito ya no tiene ningún convenio. Su reversa fallaba antes y
sigue fallando igual ("no se encontró un convenio").

#### El rango B1–B3 de la recuperación lo exige el servidor

"Mandar a recuperación" está **habilitado solo en B1–B3**, pero esa regla vivía únicamente
en el botón de la ficha. "Deshacer convenio y mandar a recuperación" no pasa por ese botón:

- en **B4**, el convenio quedaba deshecho y después la recuperación rechazaba por "ya está
  en B4" — la mitad de lo que el asesor pidió;
- en **B5**, la recuperación registraba una **BAJADA** a B4: le restaba gravedad a la
  cuenta. Y ni siquiera duraba: con 5 cuotas el piso de la Fase 4 da `max(B5, B4) = B5`, y
  el motor la devolvía esa misma noche.

Ahora el rango se exige en dos lugares con papeles distintos: el CRM lo verifica **antes**
de deshacer (evita el parcial en el caso normal) y cartera lo vuelve a verificar **bajo sus
locks** (es el que manda, y cubre también el botón suelto). El doc 07 contemplaba llegar a
B4 "desde B5"; la decisión del plan 08 es posterior y es la que rige.

#### La banda pregunta, no deduce

El estado del convenio lo responde cartera (`GET /convenio/alertas` filtrado a ese
crédito), no el front mirando el plan de cuotas que ya tiene a mano. La cobertura de una
cuota del convenio se mide por **monto** —un abono parcial acumulativo no marca
`fecha_pago`— y la re-indexación de las cuotas posteriores al acuerdo tampoco es algo que
deba vivir duplicado en el navegador. Es la misma fuente que la pantalla de Alertas de
Convenios y que el job de avisos: **una sola definición de "incumplido"**.

### Fase 4 · El estado `EN_RECUPERACION` — la invasiva, de último ✅ implementada

- ✅ El **piso** en B4: columna nueva `buckets.estados_piso` (migración **0019**), aplicada
  en los dos lados — `bucketDeCredito` (JS) y `bucketActualSql` (el lector SQL). Las dos
  tienen que decir lo mismo o la tabla por bucket y el motor se contradicen.
- ✅ El estado se pone en la **misma transacción** que el traslado a B4. Si se escribiera
  aparte, un fallo entre las dos dejaría un crédito en B4 sin piso: el motor lo devolvería
  a su escalón esa noche y la decisión humana se perdería sin que nadie se entere.
- ✅ El levantamiento al **validarse** el pago (`revalidatePayment`), y solo si no debe
  **nada**: ni cuotas vencidas ni mora (decisión 18).
- ✅ La **precedencia del convenio** (decisión 4), vía `convenios_pago.status_credito_previo`
  (migración **0020**).
- ✅ El triaje de las listas de estados escritas a mano.

#### El estado no se puede pisar, y eso es otra lista

`STATUS_EXCLUIDOS_MORA` respondía dos preguntas a la vez: *¿devenga mora?* y *¿se le puede
cambiar el estado?* Para `EN_RECUPERACION` las respuestas son distintas — **sí** devenga
mora (decisión 2) pero **no** se le pisa el estado. Si el motor lo sobreescribiera con
`MOROSO` al recalcular, el piso duraría hasta la primera corrida nocturna.

De ahí `STATUS_NO_PISAR` = `STATUS_EXCLUIDOS_MORA` + `EN_RECUPERACION`, aplicada en los
cuatro escritores de estado del motor y en la condonación de mora (condonar no es pagar:
no puede levantar una recuperación).

#### El convenio manda, y `statusCredit` es una sola columna

La decisión 4 dice que el convenio manda sobre el estado, y ahí aparece un problema que el
plan no había visto: **`statusCredit` es UNA columna**. Al firmar el convenio el crédito
pasa a `EN_CONVENIO` y el `EN_RECUPERACION` que traía desaparece; al completarse, el código
lo dejaba `ACTIVO`. O sea que **pagar el convenio levantaba la recuperación por la puerta
de atrás** — exactamente lo que la decisión 4 prohíbe.

`convenios_pago.status_credito_previo` guarda el estado con el que el crédito entró, y se
le devuelve en los tres finales posibles:

| Qué pasa con el convenio | Estado que queda |
| --- | --- |
| Se **completa** (pagó todas sus cuotas) | El previo — si venía en recuperación, ahí vuelve |
| Se **deshace** (Fase 3) | El previo, o MOROSO/ACTIVO según el recuento |
| Se **rechaza** (CB-033) | Igual |

Los convenios anteriores a la 0020 no tienen el dato y conservan el comportamiento de
siempre.

#### Cuatro cosas que la review de Codex corrigió acá

- **El levantamiento corre en el camino NORMAL de validación**, no solo en
  `revalidatePayment`. El botón "Validar Pago" y la importación de Págalo pasan por
  `aplicarPagoNormalEnTx`: la mayoría de los pagos que saldan todo no levantaban nada y el
  crédito se quedaba en recuperación para siempre.
- **`STATUS_FUNNEL` incluye el estado.** Sin eso, apretar el botón hacía *desaparecer* el
  crédito de la tabla por bucket, de la reasignación y del traslado masivo — en vez de
  mostrarlo en B4. Justo la cuenta que más hay que mirar.
- **El gate de convenio del CRM lo acepta.** La decisión 4 dice que un convenio creado
  desde B4 se queda en B4; sin esto un crédito `EN_RECUPERACION` no podía crear convenio,
  y todo el manejo de `status_credito_previo` era inalcanzable. Negarle un convenio a
  quien está por perder la unidad es negarle justo la salida.
- **El levantamiento es reversible** (migración **0021**): el crédito guarda *qué* pago lo
  levantó, y si contabilidad reversa ese pago vuelve a `EN_RECUPERACION`. Antes la reversa
  restauraba cuotas, capital y mora pero dejaba el crédito `ACTIVO`, y el motor a lo sumo
  lo ponía `MOROSO`: la decisión humana y su piso en B4 se perdían en silencio. Es el
  mismo criterio con el que la reversa des-completa un convenio y devuelve el crédito a
  `EN_CONVENIO`.

#### Que el levantamiento sea de verdad reversible

Tres cosas más de la segunda review, todas sobre la misma pieza:

- **El `pago_id` también en `/revalidatePayment`.** El camino normal ya lo pasaba, ese no:
  guardaba `NULL` y con eso la reversa no podía reconocer su propio pago. La provenance a
  medias no sirve de nada.
- **La restauración corre DENTRO de la transacción de la reversa.** Corriendo después del
  commit —y el helper se traga sus errores— un fallo suyo dejaba la reversa financiera
  firme y el crédito fuera de recuperación. Ahora se revierten o se comitean juntas.
- **Solo reemplaza estados que la recuperación tiene derecho a reemplazar** (`ACTIVO`,
  `MOROSO`). Comparar contra "el estado que acabo de leer" hacía que un `EN_CONVENIO` o un
  `INCOBRABLE` —decisiones **posteriores** y más específicas— se pisaran con una anterior.
  Si el estado ya no es reemplazable, la marca se limpia igual: ese pago no va a restaurar
  nada y dejarla puesta haría que una reversa futura lo intentara de nuevo.

#### El triaje de las listas de estados

El plan hablaba de "~90 listas de estados escritas a mano en ~45 archivos". El criterio
que las resuelve casi todas es uno solo, y es el que evita el daño silencioso:

> **Hasta hoy estos créditos estaban como `MOROSO`.** Un estado nuevo que no se agrega a
> las listas de inclusión no "no hace nada": hace que esos créditos **desaparezcan** de
> cada reporte, cada cobro y cada pantalla que enumera estados, el día que alguien apriete
> el botón de recuperación.

Así que `EN_RECUPERACION` se agregó donde estaba `MOROSO` como filtro de inclusión — 21
lugares en cartera-back (reportes, facturación, cartera activa, pagos, inversionistas,
agenda) y 5 en el CRM (incluidos el bot: **un crédito en recuperación sigue pudiendo pagar
por boleta y por link** — pagar es justo lo que puede frenar la recuperación). No se tocó
ninguna lista que *escriba* un estado ni el enum de acciones permitidas.

> 📌 **Lo que sigue necesitando visto bueno de contabilidad** es la pregunta contraria:
> si algún reporte debería **excluir** los créditos en recuperación (separarlos de la
> cartera sana, por ejemplo). Eso ya no es un cambio de código sino una definición
> contable, y hoy el comportamiento es idéntico al de antes.

---

## Estado de la ejecución

Las cuatro fases están **implementadas** (15-sep). Todo corrió contra el sandbox de dev:

| Migración | Qué agrega | Dónde |
| --- | --- | --- |
| CRM 0054 | `convenio_incumplido` + `cobros_dedup_key` | `public` |
| CRM 0055 | `bot_cliente_escribio` | `public` |
| cartera 0017 | evento `CONGELADO` | `cartera_cobros2` |
| cartera 0018 | `anulado_at` / `anulado_por` / `motivo_anulacion` | `cartera_cobros2` |
| cartera 0019 | `buckets.estados_piso` (+ seed de B4) | `cartera_cobros2` |
| cartera 0020 | `convenios_pago.status_credito_previo` | `cartera_cobros2` |
| cartera 0021 | `creditos.recuperacion_levantada_pago_id` | `cartera_cobros2` |

Los archivos de migración dicen `cartera.` (la convención del repo); al aplicarlas se
sustituye por el schema del ambiente.

## Lo que queda pendiente de una persona, no de código

1. **El criterio de "atrasado" de la re-siembra** (ver Fase 2): estricto o ancho. Hoy corre
   el estricto; el ancho manda 57 de 63 a B4.
2. **Encender los recordatorios de convenio al cliente de verdad**:
   `CONVENIO_WHATSAPP_ENABLED=true` + apagar el modo prueba. El código ya está y validado.
3. **Si algún reporte debería excluir** los créditos en recuperación (definición contable).
4. La nota del PM que sigue abierta desde el principio: si con 5 cuotas el crédito **no**
   debería subir solo a B5. Está implementado como se acordó (sube), y revertirlo es
   quitar `EN_RECUPERACION` de `estados_piso` y ponerlo en `estados_incluidos` de B4 — un
   `UPDATE` al catálogo, sin tocar código.

Y una aclaración que evita cautela de más: **este plan se ejecuta contra el sandbox de dev
(`cartera_cobros2`)**, no contra producción. Los scripts de re-siembra y los cambios de
regla se prueban ahí y se pueden repetir cuantas veces haga falta. El pase a producción es
otro momento, con su propio runbook
([RUNBOOK-refrescar-sandbox.md](./RUNBOOK-refrescar-sandbox.md) es el ensayo).
