# 7 · Recuperación de vehículo (traslado manual a B4)

**Estado:** ✅ Implementado. El traslado funciona y se sostiene con el estado
`EN_RECUPERACION` ([plan 08](./08-plan-convenios-y-recuperacion.md), fase 4). Desde
**CB-042** hay **dos tipos de envío** —recuperación forzosa y entrega voluntaria— y cada
uno deja un formulario en el CRM que ve el asesor de B4. Ver
[Los dos envíos y su formulario](#los-dos-envíos-y-su-formulario-cb-042). Desde
**CB-043** la forzosa de un asesor es una **solicitud con checklist que aprueba un
supervisor**. Ver [La solicitud y la aprobación](#la-solicitud-y-la-aprobación-cb-043).
**Migraciones CRM `0065` y `0071` pendientes en producción.**

---

## Qué es

El menú **Recuperación de vehículo ▾** de la fila de acciones de la
[Ficha 360](./06-ficha-360.md), que manda el crédito a **B4 · Última Instancia / Pre
Jurídico** sin importar cuántas cuotas lleve atrasadas.

Es la primera vez en COBROS-02 que **una persona decide el bucket**. Hasta acá el bucket
siempre fue una consecuencia: el motor lo deriva del atraso y nadie más lo escribe
([documento 2](./02-motor-y-asignacion.md)). Recuperar una unidad no es una consecuencia
del atraso — es una decisión operativa que puede tomarse con dos cuotas o con seis, según
qué tan perdido esté el cliente, si el vehículo está localizado, si hubo acuerdo roto.

Por eso el traslado es **manual, con motivo obligatorio y bitácora**, y por eso el
endpoint manda a B4 y **solo** a B4: no es un "mover a cualquier bucket". Un endpoint
genérico sería la puerta para romper la invariante de que el bucket lo deriva la mora.

---

## Los dos envíos y su formulario (CB-042)

Hasta CB-042 el envío era un motivo en texto libre: el crédito llegaba a B4 y el asesor
de B4 no sabía por qué, ni dónde estaba la unidad, ni si el cliente la iba a entregar.
Ahora el menú tiene dos opciones, y **ya no va en rojo**: uno de los dos caminos es el
cliente colaborando.

| Opción | `tipo_recuperacion` | Cuándo | Buckets | Qué se llena |
| --- | --- | --- | --- | --- |
| **Recuperar vehículo** | `tomado` | El cliente no paga y hay que quitarle la unidad | B2–B3 (traslada **al aprobarse**, CB-043) | Motivos, **justificación**, **checklist**, dónde está el vehículo, estado, observaciones |
| **Entrega voluntaria** | `entrega_voluntaria` | El cliente entrega la unidad por su cuenta | B2–B3 (traslada) · **B4 (solo registra)** | Motivos, fecha y hora, lugar, quién entrega, documentos, estado |

> **Rango (2026-09-30):** los dos envíos salen de **B2 o B3**. El plan 08 los tenía de B1 a
> B3; con CB-043 se sacó B1. El CRM lo exige en el servidor antes de guardar nada (el
> formulario y la solicitud); cartera sigue aceptando de B1 a B3 bajo sus locks, que queda
> como la cota de afuera.

- **Motivos:** casillas de un catálogo por tipo (`lib/recuperacion-vehiculo.ts`) más un
  detalle **opcional**. El detalle solo se exige si se marcó «Otro», que sin texto no
  dice nada.
- **La entrega en B4** existe porque un cliente que ya está en B4 también puede
  entregar el carro (decisión del 2026-09-28). Ahí no hay traslado; solo se guarda el
  formulario y se avisa. **No pone `EN_RECUPERACION`** si el crédito llegó a B4 por
  cuotas y no por el botón: cartera no tiene endpoint para cambiar solo el estado.
- **Saldo asociado:** al registrar, el CRM le pide el crédito a cartera (sin cache) y
  guarda una foto: saldo pendiente (`deudatotal`), cuotas vencidas, vencido (cuotas ×
  cuota), mora y total para ponerse al día. Cartera calcula; el CRM guarda la foto. Si
  cartera no responde, el envío sigue y la foto queda vacía.
- **GPS:** el botón **Tomar del GPS** hace una consulta a `getGpsVehiculo`
  ([doc 9](./09-integracion-gps-wialon.md)), auditada con el motivo "Registro de
  recuperación de vehículo (CB-042)". Llena coordenadas, enlace de mapa y kilometraje
  (odómetro), y guarda la unidad y la hora de la señal. Si la señal tiene más de dos
  horas, el formulario lo avisa: un GPS que no reporta también es información para B4.
- **El motivo que llega a cartera** lleva el tipo adelante (`Entrega voluntaria: …`,
  `Recuperación forzosa: …`), así la bitácora de buckets distingue los dos envíos sin
  cruzar con el CRM.
- **"Deshacer convenio y mandar a recuperación"** también deja registro: forzosa, motivo
  «Incumplió el convenio», con el texto del modal de deshacer.

### Dónde vive: `recuperaciones_vehiculo` (CRM)

La tabla ya existía, con los tipos `entrega_voluntaria` / `tomado` / `orden_secuestro`,
pero **nadie la llenaba** (0 filas en dev y en prod el 2026-09-28). Se reusa con la
migración `0065`: las columnas viejas conservan su sentido (`fecha_recuperacion` +
`completada` = la unidad se recibió; `responsable_recuperacion` = el asesor de B4) y se
agregan las del formulario, la foto del saldo y la recepción. El reporte de cartera que
ya contaba esa tabla (`reportes-cartera.ts`) empieza a mostrar datos reales.

Una fila por envío; el **vigente** es el más reciente del caso.

### Guardar antes de trasladar

Son dos bases distintas (CRM y cartera) y no hay transacción que las una. El orden es:

1. se guarda el registro en el CRM;
2. cartera traslada (valida rango, dueño y locks);
3. si cartera rechaza, **se borra el registro** y se propaga el error; si traslada, se
   anotan los buckets y el asesor de B4, y se avisa.

Al revés, un fallo al guardar dejaba el crédito en B4 **sin formulario**, que es justo lo
que esta historia viene a resolver. Un registro de más se puede borrar; un traslado sin
explicación no se explica solo.

### Lo que ve el asesor de B4

- **La tarjeta "Recuperación de vehículo"**, arriba del Resumen y en la pestaña
  Vehículo: el tipo, quién lo mandó y desde qué bucket, los motivos, los datos de la
  entrega (con "en 2 días" / "hace 3 horas"), los documentos que trae y los que no,
  dónde está (con enlace al mapa y la antigüedad de la señal del GPS), el estado, el
  saldo al registrar y las observaciones. Desde el Resumen lleva a la pestaña Vehículo,
  donde están el GPS en vivo y las ubicaciones clave. Reemplaza la tarjeta vieja, que
  solo salía para incobrables.
- **Un aviso** (`cobros_tipo = recuperacion_vehiculo`) al asesor que lleva el crédito en
  B4 y a los `cobros_supervisor`, con el cliente, el motivo o la fecha y el lugar de la
  entrega. Quien registró no se avisa a sí mismo. Dedup por registro.
- **Confirmar recepción de la unidad**, **solo con el crédito en B4** (el servidor lo
  exige y falla cerrado si cartera no responde). Arranca con lo reportado al enviar y
  guarda aparte lo que de verdad llegó (`recepcion_*`): la diferencia entre lo que el
  cliente dijo que entregaba y lo que entregó es justo lo que interesa ver. No toca
  cartera: lo que sigue (jurídico, contabilidad) queda como está (decisión 6 del plan 08).

### Compatibilidad

`enviarCreditoARecuperacion` recibe `tipo` y `detalle` **opcionales**. Un llamador que
manda solo `motivo` (por ejemplo, el cierre "no pagó" de la inmovilización de CB-041)
sigue funcionando y queda registrado como forzosa con ese texto.

---

## La solicitud y la aprobación (CB-043)

CB-043 pedía "activar B4 antes del día 91 si ya se agotaron los pasos de B3, con checklist
y aprobación de supervisor/gerente", con un subestado "B4 operativo anticipado". El PM lo
**unificó con la recuperación forzosa** (2026-09-30): las dos terminan igual —B4 con
`EN_RECUPERACION`, por el mismo endpoint de cartera— y no tenía sentido que una fuera
directa y la otra pasara por aprobación. Dicho por el PM: *"¿qué pasa si un asesor dice
'no quiero tratar este caso, mandémoslo a B4'? El supervisor tiene que ver la
justificación."* Así quedó:

| Quién | Recuperación forzosa | Entrega voluntaria |
| --- | --- | --- |
| Asesor, supervisor o admin | **Solicita**: el crédito no se mueve hasta que la apruebe **otro** supervisor o admin | Directa, como siempre |

**Cuatro ojos (2026-09-30):** nadie aprueba ni rechaza su propia solicitud, ni siquiera
un admin. Así al menos otra persona se entera antes de que el crédito pase a B4. Quien la
pidió solo puede cancelarla. El aviso va a los `cobros_supervisor` menos quien pidió; si
no queda ninguno (la pidió el único supervisor), va a los admins.

### Qué lleva la solicitud

- Lo de siempre de la forzosa (motivos, dónde está la unidad, estado) más una
  **justificación obligatoria** de al menos 20 caracteres: por qué ya no hay otra salida.
- El **checklist de gestión**: nueve pasos que salen de la épica B3 · Rescate (CB-035 a
  CB-042) más lo básico de cualquier cobro. Es un checklist de **evidencia**, no de
  casillas: cada paso llega marcado con lo que el CRM (o cartera) encontró desde que el
  crédito salió de B0 (la salida de B0 más reciente, del historial de buckets; sin
  historial, los últimos 180 días). **Nada se marca a mano**, y solo entran pasos que
  dependen de quien pide:

  | Paso | De dónde sale |
  | --- | --- |
  | Llamadas al cliente | `contactos_cobros` por llamada (sin los envíos automáticos) |
  | WhatsApp, SMS o correo | `contactos_cobros` por esos canales (sin premora ni masivos) |
  | Promesa de pago | Promesas y acuerdos parciales, con cuántas se incumplieron |
  | Convenio de pago | Convenios del crédito en cartera: vigentes, completados, pendientes o deshechos (`GET /payment-agreements?status=all`), más los rechazados, que borran su fila y quedan en el historial de decisiones. Como la promesa, cuenta que se generó |
  | Referencias | Cuántas referencias del crédito se gestionaron (todas = hecho, algunas = a medias) |
  | Visita a la residencia / al trabajo | `visitas_cobros` realizadas de cada tipo |
  | Ubicación por GPS | Consultas en `gps_consulta_logs` del vehículo |
  | Apagado de la unidad | La última solicitud de CB-041 (ejecutada = hecho; pedida o rechazada = a medias) |

  Lo que no está hecho **se justifica** con un catálogo (no aplica, sin datos, nadie
  contesta, no se localiza, se niega a pagar, alertaría al cliente y escondería el
  vehículo, urgencia, zona de riesgo, sin GPS, se hizo fuera del CRM, otro). "Se hizo fuera
  del CRM" y "Otro" piden nota. **No se bloquea por pasos pendientes** —obligaría a
  inventar registros—, pero ninguno queda sin explicación. Cuando falta el dato para hacer
  el paso (sin referencias, sin lugar de trabajo, sin GPS) la justificación viene
  sugerida.
- **Qué quedó afuera (2026-09-30):** la *llamada del supervisor* (no depende del asesor:
  no la puede hacer ni justificar) y la *búsqueda en redes sociales* (CB-039 no estaba
  hecho; ya hay dónde registrarla, ver [doc 11](./11-investigacion-redes-sociales.md), pero el
  paso todavía no se reincorporó al checklist). Si cartera no responde, el paso de convenio lo dice
  ("no se sabe si hubo convenio") en vez de afirmar que no hubo.
- El checklist lo **arma el servidor** dos veces: para mostrar el formulario y otra vez al
  guardar. Del navegador solo salen las justificaciones y notas: lo que lee el supervisor
  es lo que el CRM encontró, no lo que alguien dijo que encontró.
- Catálogos provisionales en `lib/recuperacion-solicitud.ts`, en TypeScript: el checklist
  se guarda como jsonb con su título y su evidencia, así que cambiar pasos no rompe los
  registros viejos.

### El ciclo

```
asesor ── enviarCreditoARecuperacion (tipo tomado) ──▶ estado_solicitud = 'pendiente'
                                                        (cartera no se toca; aviso a los supervisores)
                                                                   │
            ┌──────────────────────┬───────────────────────────────┼────────────────────────┐
            ▼                      ▼                               ▼                        ▼
   supervisor aprueba      supervisor rechaza            el asesor la cancela    el crédito sale de B2–B3
   → cartera traslada      (motivo ≥ 10 caracteres)                              o llega a B4 por otra vía
   → 'aprobada'            → 'rechazada'                 → 'cancelada'           → 'sin_efecto'
```

- La solicitud es la **misma fila** de `recuperaciones_vehiculo` que después ve el asesor
  de B4: al aprobarse se completa con los buckets, el asesor de B4 y la **foto del saldo
  del momento del traslado** (no la de cuando se pidió).
- **Una pendiente por caso**, con índice único parcial. Mientras hay una, la ficha no ofrece
  pedir otra.
- **Al aprobar** se relee el bucket sin cache: si el crédito ya no está en B2–B3, la
  solicitud queda `sin_efecto` y se avisa. La transacción que bloquea la solicitud queda
  abierta mientras cartera traslada: es una acción puntual y garantiza que dos supervisores
  no la aprueben a la vez.
- **Si cartera trasladó pero la respuesta se perdió**, la solicitud sigue pendiente. El
  siguiente intento recibe "ya está en B4" (un 4xx), pero antes de darlo por bueno se busca
  la huella `[ref CRM <id>]` en el historial de buckets. Si la encuentra, la da por
  aprobada sin volver a mover nada.
- **Si el crédito llega a B4 por otro camino** (una entrega voluntaria, o solo por cuotas),
  la solicitud pendiente se cierra como `sin_efecto` y se le avisa a quien la pidió.
- **"Deshacer convenio y mandar a recuperación" ya no existe.** Llevaba el crédito a B4 sin
  solicitud, sin checklist y sin aprobación. Ahora "Deshacer convenio" solo deshace, y la
  recuperación se solicita aparte como cualquier otra. Un test sobre la fuente
  (`cobros.deshacer-convenio.test.ts`) cuida que ningún camino vuelva a trasladar sin
  solicitud.
- **Registros efectivos:** una solicitud pendiente, rechazada, cancelada o sin efecto no es
  una recuperación. No cuenta en `reportes-cartera.ts`, no es "el registro vigente" de la
  tarjeta y no admite confirmar la recepción de la unidad.

### Dónde se ve

- **Ficha 360 → tarjeta "Recuperación de vehículo":** la solicitud pendiente arriba, con la
  justificación, el checklist y los botones **Aprobar y mandar a B4 / Rechazar** (otro
  supervisor o admin) o **Cancelar mi solicitud** (quien la pidió). Aprobada, el checklist queda plegado debajo
  del envío para el asesor de B4.
- **Cobros → Solicitudes → Recuperación de vehículo** (`/cobros/recuperaciones`, solo
  supervisor y admin): las pendientes, las más viejas primero, con todo lo necesario para
  decidir sin abrir la ficha, y el historial de las decididas. En el mismo grupo del menú
  quedó **Apagado de unidades (GPS)** (`/cobros/inmovilizaciones`, CB-041): cada solicitud
  con su pantalla, porque son flujos distintos.
- **Avisos:** `recuperacion_pendiente_aprobacion` a todos los `cobros_supervisor` (acción
  requerida; se cierra sola al decidir, cancelar o quedar sin efecto, y no se puede
  resolver a mano) y `recuperacion_resuelta` de vuelta a quien pidió. Al aprobar sale
  además el aviso de siempre (`recuperacion_vehiculo`) al asesor de B4.

### "B4 anticipado" sin subestado

El ticket pedía un subestado "B4 operativo anticipado" porque "activar B4 antes del día 91
es excepción operativa, no cambio de bucket financiero". No hizo falta:

- **El bucket ya es operativo** (qué equipo atiende el crédito). La clasificación financiera
  —cuotas vencidas, días de mora, `casos_cobros.estado_mora`, la mora en quetzales— se
  calcula por cuotas y no se mueve con el traslado.
- **Lo que sostiene el B4 es `EN_RECUPERACION`**, que ya existía. No se agregó estado nuevo
  en cartera.
- **"Anticipado" es una etiqueta calculada:** B4 con `EN_RECUPERACION` y menos de 4 cuotas
  vencidas. La ficha la muestra junto al bucket ("B4 anticipado · 3 cuotas"), y la tarjeta
  de recuperación lo explica.

---

## Cómo funciona

```
Ficha 360 → Más acciones → Recuperación de vehículo (modal con motivo)
   │
   ▼
CRM  enviarCreditoARecuperacion   (cobrosProcedure + dueño en cartera)
   │
   ▼
cartera-back  POST /buckets/creditos/:credito_id/recuperacion-vehiculo
   │
   ▼
enviarARecuperacionVehiculo()  ← controllers/buckets/recuperacionVehiculo.ts
   ├── elegirAsesorParaBucket(pool B4, carga, dueño actual)
   ├── si cambia el dueño:  UPDATE creditos.asesor_id   ← el UPDATE va PRIMERO
   │                      + INSERT credito_asesor_historial (API_MANUAL, usuario_id)
   └── INSERT buckets_historial   (SUBIDA|BAJADA, origen=API_MANUAL, motivo)
```

Todo —**la lectura del estado incluida**— dentro de una transacción que pide tres advisory
locks **sin esperar**, antes de leer nada:

```
pg_try_advisory_xact_lock(PROCESAR_MORAS_LOCK_KEY)     ← el motor de mora
pg_try_advisory_xact_lock(BUCKETS_CONVENIO_LOCK_KEY)   ← el job de convenios
pg_try_advisory_xact_lock(CREDITO_ASESOR_LOCK_NAMESPACE, credito_id)
```

> ⚠️ **El lock por crédito NO alcanza, y creerlo fue un error de este documento.**
> Ni `procesarMoras` ni el job de convenios lo toman: cada uno usa su llave global. Con
> solo el lock por crédito, una corrida solapada leía el mismo dueño viejo y escribía
> historia contradictoria o pisaba la reasignación (review de Codex, P1).

### Por qué NO se espera por los locks

La política de locks de la casa es **asimétrica**, y desde acá hay que respetarla desde el
lado débil. El cron de mora pide `PROCESAR_MORAS_LOCK_KEY` con `pg_try_advisory_lock`
(`latefee.ts`): si no la consigue, **omite la corrida completa de esa noche**, sin reintento,
y el wrapper de `schedule.ts` la registra igual con un "✅ ejecutado correctamente". El cron
es `'59 23 * * *'`, una vez al día.

Un botón por crédito que espera 5 segundos sobre esa misma llave puede, si el clic cae en el
minuto del cron, **costar la mora de toda la cartera de esa noche** — de forma total,
silenciosa y sin cura hasta 24 horas después. Entre hacer esperar a una persona, que puede
reintentar, y hacerle perder la noche a un job que no reintenta, gana el job: acá se pide sin
esperar y se devuelve 409 en el acto (review humana de @jalvaradoatcci).

> 📌 **Deuda que queda abierta, fuera del alcance de este módulo.** El traslado masivo
> (`trasladosCartera.ts`) sí espera sobre esas mismas llaves con `lock_timeout`, y su
> comentario asume el trade-off en voz alta. Y más de fondo: que `{skipped:true}` se
> reporte como corrida exitosa hace que una noche perdida sea invisible. Las dos cosas
> viven en código compartido y merecen su propio cambio, no colarse en este PR.

**Y la carga del bucket solo se calcula si de verdad decide.** `getCargaDelBucket` es un
agregado sobre toda la cartera con `bucketActualSql` en el `WHERE` (tres subconsultas
correlacionadas por fila). Se estaba evaluando siempre por ser un argumento, incluso en el
caso común —el dueño ya cubre el bucket y `elegirAsesorParaBucket` corta en su primera
línea sin mirar el mapa—. Ahora se calcula solo cuando hay que repartir, lo que encoge de
forma notoria el rato que la transacción retiene los locks.

Y el orden de las escrituras importa: **el UPDATE del dueño va antes** de la fila de
`buckets_historial`, y con compare-and-swap. Devolver un valor desde el callback de
`db.transaction` hace COMMIT, no ROLLBACK: con la fila de bucket insertada primero, un
conflicto de dueño dejaba el crédito movido a B4 mientras la API respondía 409 (review de
Codex, P1). Ahora el conflicto lanza y revierte todo.

### El asesor sigue la regla del motor

No hay lógica nueva de asignación: se llama a `elegirAsesorParaBucket` de `latefee.ts`,
la misma que usa el job. O sea:

- si el dueño actual **ya cubre B4**, se queda (sin churn) y **no** se escribe fila en
  `credito_asesor_historial` — no hubo traslado que anotar;
- si no, va al asesor de B4 con **menos carga**, empate por menor `asesor_id`;
- si B4 **no tiene pool activo**, la operación se rechaza con 409 antes de escribir nada:
  mejor eso que dejar la cuenta sin dueño en el bucket más delicado.

### El evento respeta el CHECK de coherencia

`buckets_historial` tiene un CHECK que exige `SUBIDA ⇒ sube` y `BAJADA ⇒ baja`. El
`tipo_evento` se calcula comparando contra el bucket actual, no se asume.

> **Actualización (plan 08, review de Codex):** este documento contemplaba llegar a B4
> también *desde B5*. Ya no: el origen válido es **B1–B3** (en el CRM, B2–B3 desde CB-043) y cartera lo exige bajo sus locks
> (`motivoBucketNoRecuperable`). Desde B5 la operación le restaba gravedad a la cuenta, y con
> el piso de `EN_RECUPERACION` el motor la devolvía a B5 esa misma noche. Hoy toda
> recuperación es una `SUBIDA`; el cálculo contra el bucket actual se conserva igual.

### Validaciones (todas antes de escribir)

| Caso | Respuesta |
| --- | --- |
| Motivo vacío | 400 |
| Crédito inexistente | 404 |
| Estado fuera del funnel (`CANCELADO`, `PENDIENTE_CANCELACION`, `EN_CONVENIO`, `CAIDO`) | 400 |
| Sin bucket actual | 400 |
| Ya está en B4 | 400 |
| B4 inactivo en el catálogo | 409 |
| B4 sin asesores activos en el pool | 409 |
| El dueño cambió entre la lectura y la escritura | 409 (compare-and-swap) |

---

## Quién puede hacerlo

`cobrosProcedure` → **cualquiera del módulo de cobros** (`canAccessCobros`: asesor,
supervisor o admin). Lo inicia el asesor que lleva la cuenta: es quien sabe que la unidad
ya no se recupera por teléfono. **Desde CB-043 la forzosa solo crea la solicitud, la pida
quien la pida**; el traslado lo hace `decidirSolicitudRecuperacion`, que exige
`cobrosSupervisorProcedure` (supervisor o admin) y que quien decide no sea quien pidió. La
entrega voluntaria sigue siendo directa.

**El crédito no se recibe del cliente: sale del caso.** El procedure toma un `casoCobroId`,
pasa por `assertAccesoCasoCobro` y resuelve el `credito_id` contra `carteraBackReferences`.
Recibir el `credito_id` directo dejaba a un asesor mandar a B4 —y reasignar— el crédito de
otro con solo cambiar el número, porque `cobrosProcedure` solo valida el rol (review de
Codex, P1).

**Y el caso tampoco alcanza como autorización.** `getDetallesCreditoCarteraBack` AUTO-CREA
un caso cuando el crédito no tiene uno activo, y el caso no dice de quién es el crédito
(el CRM no asigna, ver [doc 2](./02-motor-y-asignacion.md#el-crm-no-asigna-2026-09-28)).
La verdad de "de quién es este crédito" la tiene **cartera**:
se compara el `email_cash_in` del asesor asignado contra el correo de login
(`assertCreditoAsignadoEnCartera`, en `lib/credito-cartera-ownership.ts`). Admin y supervisor
de cobros quedan fuera del chequeo: ellos sí operan sobre cualquier crédito.

Es la misma regla que ya defendía `crearConvenioDesdeFicha` desde el PR #1570; se extrajo a
una función compartida cuando hizo falta la tercera copia.

**La lectura de autorización va SIN cache.** Con `CARTERA_BACK_ENABLE_CACHE=true` el cliente
cachea `/credito` cinco minutos, y una decisión de permiso tomada sobre esa foto se equivoca
en las dos direcciones: el asesor viejo sigue pasando y el nuevo queda afuera. Por eso existe
`assertCreditoAsignadoEnCarteraPorSifco`, que lo garantiza por construcción en vez de
depender de que quien escribe el guard se acuerde del segundo argumento de `getCredito`.

**Y autorizar no es escribir.** El chequeo del CRM ocurre en una request y el traslado en
otra; entre medio el motor o un supervisor pueden reasignar el crédito. Por eso el CRM manda
el correo del dueño que verificó como **precondición** (`asesor_esperado_email`) y cartera lo
**revalida bajo sus locks** contra el dueño real: si no coincide, 409 y no se escribe nada.
Va vacío para admin y supervisor, que no tienen un dueño que exigir.

La trazabilidad no la da el permiso sino el **motivo obligatorio** y la bitácora
`API_MANUAL`, que guarda quién lo pidió. Desde CB-042 también el formulario en
`recuperaciones_vehiculo`, con `registrado_por`.

---

## La pregunta abierta

> ✅ **RESUELTA el 2026-09-10 con el PM.** El estado nuevo se llama `EN_RECUPERACION` y no
> *clava* el bucket sino que le pone un **piso** en B4: con 5 cuotas sí sube a B5,
> conservando el estado. Sigue devengando mora. El plan completo, con las 10 decisiones y
> las fases, está en [el documento 8](./08-plan-convenios-y-recuperacion.md).
> Lo que sigue abajo es el análisis que llevó a esa decisión.


**El traslado no se sostiene solo, y eso es sabido.**

El motor de las 23:59 GT no lee el bucket: lo **deriva** de las cuotas atrasadas y lo
compara contra la última fila de `buckets_historial`. Entonces:

```
10/09  15:00   Crédito con 2 cuotas atrasadas, en B2.
               Supervisor manda a recuperación → fila SUBIDA B2→B4 (API_MANUAL).
               La ficha, la cola y la capacidad ya lo ven en B4. ✅

10/09  23:59   procesarMoras corre. Deriva bucket = B2 (sigue con 2 cuotas).
               Último bucket registrado = B4. Son distintos →
               fila BAJADA B4→B2 (PROCESO_AUTO) + reasignación al pool de B2.

11/09  08:00   La cuenta amaneció en B2, con el asesor de B2. ❌
```

No es un bug del traslado: es que **la recuperación no tiene dónde vivir en el modelo**.
Hoy el bucket es una función pura del atraso, y una decisión humana que quiera
sobrevivir a la próxima corrida necesita algo que la ancle.

### Opciones sobre la mesa (ninguna decidida)

| Opción | Idea | Costo | Riesgo |
| --- | --- | --- | --- |
| **A · Estado del crédito** | Un `statusCredit` tipo `EN_RECUPERACION` que el catálogo mapee a B4 vía `estados_incluidos`, como ya hace `INCOBRABLE`→B5 | Bajo: el mecanismo ya existe y el motor lo respeta sin tocarlo | Toca `statusCredit`, que es de cartera y lo miran facturación, reportes y SIFCO — hay que ver qué más se entera |
| **B · Flag de congelado** | Columna en `creditos` (o tabla aparte) que el motor consulte para saltarse ese crédito | Medio: hay que meter la excepción en el motor y en los readers | El motor deja de ser "una función del atraso": aparece un caso especial que hay que recordar en cada cambio |
| **C · Módulo de recuperación** | Tabla propia con el ciclo de vida (solicitada, autorizada, unidad recuperada, cerrada) y el bucket derivado de ese estado | Alto | Es lo correcto si recuperación va a ser un proceso con etapas, y de más si solo es un traslado |

### Lo que hay que decidir con producto / PM

1. **¿Qué saca al crédito de recuperación?** ¿Que pague? ¿Cuánto — la cuota, todo el
   vencido, un acuerdo? ¿O solo sale por decisión manual?
2. **¿La unidad recuperada cambia el estado del crédito?** Hoy ya existe el módulo de
   recuperación para casos `incobrable` (`getRecuperacionVehiculo`); hay que ver si esto
   se enchufa ahí o es otra cosa.
3. **¿Quién lo revierte y con qué bitácora?**
4. **¿Se le avisa al asesor que perdió la cuenta?** Hoy simplemente le desaparece de la
   cola.

Mientras eso no se conteste, este módulo **hace el traslado y nada más, a propósito**. El
modal se lo dice al supervisor con todas sus letras antes de confirmar, para que nadie
crea que la cuenta se queda ahí.

---

## Deuda menor conocida

**`buckets_historial` no tiene columna `usuario_id`.** El motor, su único escritor hasta
hoy, no la necesitaba (`origen=PROCESO_AUTO` ya dice que fue el sistema). Con un escritor
manual sí hace falta: quién mandó la cuenta a recuperación.

Mientras la columna no exista, **el actor va dentro del `motivo`**:

```
Recuperación de vehículo (solicitada por supervisor@clubcashin.com): <motivo>
```

Es auditable, pero no es consultable como campo. En la práctica el traslado casi siempre
cambia de asesor y ahí sí queda `usuario_id` en `credito_asesor_historial`; el hueco real
es el caso en que el dueño ya cubría B4. Agregar la columna es una migración pequeña y
aditiva cuando se retome el tema.

---

## Dónde está el código

| Pieza | Archivo |
| --- | --- |
| Controller | `apps/cartera-back/src/controllers/buckets/recuperacionVehiculo.ts` |
| Tests | `apps/cartera-back/src/controllers/buckets/recuperacionVehiculo.test.ts` |
| Endpoint | `apps/cartera-back/src/routers/buckets.ts` → `POST /buckets/creditos/:credito_id/recuperacion-vehiculo` |
| Cliente CRM | `apps/crm/apps/server/src/services/cartera-back-client.ts` → `enviarARecuperacionVehiculo` |
| Procedure CRM | `apps/crm/apps/server/src/routers/cobros.ts` → `enviarCreditoARecuperacion` |
| Registro, entrega en B4 y recepción (CB-042) | `apps/crm/apps/server/src/routers/recuperacion-vehiculo-registro.ts` |
| Reglas puras y catálogos (CB-042) | `apps/crm/apps/server/src/lib/recuperacion-vehiculo.ts` (+ `.test.ts`) |
| Foto del saldo, registro y avisos (CB-042) | `apps/crm/apps/server/src/services/recuperacion-vehiculo.ts` |
| Migración (CB-042) | `apps/crm/apps/server/src/db/migrations/0065_cb042_recuperacion_vehiculo.sql` |
| Solicitud: reglas, checklist, textos (CB-043) | `apps/crm/apps/server/src/lib/recuperacion-solicitud.ts` (+ `.test.ts`) |
| Solicitud: evidencia del checklist (CB-043) | `apps/crm/apps/server/src/services/recuperacion-checklist.ts` |
| Solicitud: crear, aprobar, rechazar, cancelar (CB-043) | `apps/crm/apps/server/src/services/recuperacion-solicitud.ts` · avisos en `recuperacion-solicitud-avisos.ts` |
| Solicitud: endpoints (CB-043) | `apps/crm/apps/server/src/routers/recuperacion-solicitudes.ts` (checklist, bandeja, decidir, cancelar); se crea desde `enviarCreditoARecuperacion` |
| Migración (CB-043) | `apps/crm/apps/server/src/db/migrations/0071_cb043_recuperacion_con_aprobacion.sql` |
| UI de la solicitud (CB-043) | `components/cobros/recuperacion-checklist.tsx` (formulario, vista y diálogo de decisión) · `routes/cobros/recuperaciones.tsx` (bandeja del supervisor) |
| UI | `apps/crm/apps/web/src/routes/cobros/$id.tsx` (menú "Recuperación de vehículo ▾") · `components/cobros/recuperacion-vehiculo-dialog.tsx` (formulario) · `components/cobros/recuperacion-vehiculo-card.tsx` (tarjeta y recepción) |
