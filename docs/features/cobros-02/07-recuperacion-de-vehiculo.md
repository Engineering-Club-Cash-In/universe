# 7 · Recuperación de vehículo (traslado manual a B4)

**Estado:** 🟡 Implementado a medias **a propósito** — el traslado funciona; **cómo se
sostiene está pendiente de definición de producto**. Ver [La pregunta abierta](#la-pregunta-abierta).

---

## Qué es

Un botón en **Más acciones** de la [Ficha 360](./06-ficha-360.md) que manda el crédito a
**B4 · Última Instancia / Pre Jurídico**, sin importar cuántas cuotas lleve atrasadas.

Es la primera vez en COBROS-02 que **una persona decide el bucket**. Hasta acá el bucket
siempre fue una consecuencia: el motor lo deriva del atraso y nadie más lo escribe
([documento 2](./02-motor-y-asignacion.md)). Recuperar una unidad no es una consecuencia
del atraso — es una decisión operativa que puede tomarse con dos cuotas o con seis, según
qué tan perdido esté el cliente, si el vehículo está localizado, si hubo acuerdo roto.

Por eso el traslado es **manual, con motivo obligatorio y bitácora**, y por eso el
endpoint manda a B4 y **solo** a B4: no es un "mover a cualquier bucket". Un endpoint
genérico sería la puerta para romper la invariante de que el bucket lo deriva la mora.

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

`buckets_historial` tiene un CHECK que exige `SUBIDA ⇒ sube` y `BAJADA ⇒ baja`. Como se
puede llegar a B4 desde abajo (lo normal) o desde B5, el `tipo_evento` se calcula
comparando contra el bucket actual, no se asume.

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
supervisor o admin). Lo dispara el asesor que lleva la cuenta: es quien sabe que la unidad
ya no se recupera por teléfono.

**El crédito no se recibe del cliente: sale del caso.** El procedure toma un `casoCobroId`,
pasa por `assertAccesoCasoCobro` y resuelve el `credito_id` contra `carteraBackReferences`.
Recibir el `credito_id` directo dejaba a un asesor mandar a B4 —y reasignar— el crédito de
otro con solo cambiar el número, porque `cobrosProcedure` solo valida el rol (review de
Codex, P1).

**Y el caso tampoco alcanza como autorización.** `getDetallesCreditoCarteraBack` AUTO-CREA
un caso con `responsableCobros = quien consulta` cuando el crédito no tiene uno activo, así
que un asesor puede fabricarse el acceso consultando un SIFCO enumerable y después pasar
cualquier gate que mire el caso. La verdad de "de quién es este crédito" la tiene **cartera**:
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
`API_MANUAL`, que guarda quién lo pidió. En el menú el ítem va separado y en rojo para que
no se apriete de pasada.

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
| UI | `apps/crm/apps/web/src/routes/cobros/$id.tsx` (menú "Más acciones" + modal) |
