# 2 · Motor de buckets y asignación de asesores

**Estado:** ✅ Implementado y probado E2E
**Vive en:** `apps/cartera-back/src/controllers/latefee.ts` (motor) · `controllers/buckets/` (lecturas y reasignación manual) · `controllers/bucketsConvenio.ts` (convenios)

---

## El motor

El motor **no es un job aparte**: es un paso aditivo al final de `procesarMoras`, el
proceso de moras que ya corría todas las noches a las **23:59 GT**.

Se enganchó ahí a propósito. `procesarMoras` ya recorre todos los créditos y ya sabe
cuántas cuotas debe cada uno antes y después de la corrida — que es exactamente lo que hace
falta para detectar un cambio de bucket. Un job separado tendría que recalcular lo mismo y
podría contradecirlo.

```
23:59 GT  procesarMoras
          ├── (lo de siempre) crear / recalcular / desactivar moras
          └── PASS DE BUCKETS  ← COBROS-02
              ├── deriva el bucket de cada crédito
              ├── lo compara con el último registrado
              ├── si cambió → INSERT en buckets_historial
              └── y reasigna el asesor
```

El pass va envuelto en `try/catch`: **si el motor de buckets falla, el proceso de moras
no se cae**. La mora es dinero facturable; el bucket se puede recalcular mañana.

### Cómo deriva el bucket

`bucketDeCredito(status, cuotas, catalogo)`, en este orden:

1. ¿El estado está fuera del funnel (`CANCELADO`/`PENDIENTE_CANCELACION`/`EN_CONVENIO`/`CAIDO`)? → `null`, no se toca.
2. ¿Hay un bucket cuyo `estados_incluidos` contenga este estado? → ese bucket (`INCOBRABLE` → B5).
3. Si no → el bucket cuyo rango `cuotas_min..cuotas_max` cubra las cuotas atrasadas.

El catálogo se carga **una vez** al inicio del pass (una query, seis filas). Si viniera
vacío —seed sin aplicar— el pass avisa y se omite en vez de mandar a todo el mundo a
`null`.

### El conteo de cuotas: el detalle que más ha costado

Una cuota cuenta como atrasada si está vencida **y no tiene un pago cubriente**. Y
"cubriente" tiene letra chica que ya nos mordió:

```sql
-- el predicado, en resumen
pago.validation_status IN ('validated','no_required')
AND pago.pagado = true
AND COALESCE(pago.monto_aplicado, 0) > 0   -- ← este AND es el que faltaba
```

El `monto_aplicado > 0` está porque los pagos especiales —**solo mora**, otros, convenio—
se insertan colgados de la primera cuota pendiente con `pagado = true` y
`monto_aplicado = 0`. En esas filas `pagado` significa *"la fila del pago está completa"*,
**no** *"la cuota quedó cubierta"*. Sin ese `AND`, pagar solo la mora bajaba el bucket sin
merecerlo y recalculaba la mora de menos (PR #1074 / hotfix #1075).

**Este predicado está replicado a propósito** en el motor, en los recordatorios premora y
en el cálculo de comportamiento de pago. Si se toca uno, hay que tocar los tres — están
marcados con comentarios que se apuntan entre sí.

---

## La bitácora: `buckets_historial`

Tabla **append-only**. Nunca se actualiza una fila, solo se agregan.

| Evento | Cuándo |
| --- | --- |
| `INICIAL` | La primera vez que el motor ve el crédito. Línea base, `bucket_anterior = NULL` |
| `SUBIDA` | El atraso creció |
| `BAJADA` | El atraso bajó — **este es el KPI de "cuentas curadas"** |

Guarda el bucket anterior y el nuevo, las cuotas de antes y después, el origen
(`PROCESO_AUTO` / `API_MANUAL`), y para atribución `asesor_id` y `pago_id`.

**`INICIAL` marca el momento, no la salud.** Un crédito sano que nunca se atrasa tiene
exactamente una fila: `INICIAL → B0`. La salud la dice `bucket_nuevo`, no el tipo de
evento.

Candados en la base, no solo en el código:

- `CHECK` de coherencia: `INICIAL` ⇒ anterior nulo; `SUBIDA` ⇒ sube; `BAJADA` ⇒ baja.
- `UNIQUE` parcial: **un solo `INICIAL` por crédito**, para que dos corridas simultáneas no
  siembren dos líneas base.
- Índice `(credito_id, fecha DESC, historial_id DESC)`: el desempate por `historial_id` no
  es cosmético — sin él, dos eventos con la misma fecha producen transiciones fantasma.

**El bucket no se materializa.** No hay columna `creditos.bucket`. El bucket actual se lee
del último evento. Es una decisión consciente: una columna materializada sería una segunda
fuente de verdad que se desincroniza en cuanto algo escriba sin pasar por el motor.

---

## La asignación del asesor

### Dónde vive: `creditos.asesor_id`

**No hay tabla de estado.** La asignación es el propio campo del crédito.

La razón es un dato del negocio que conviene tener claro: **en cartera, el asesor del
crédito ES el cobrador.** El vendedor/originador no existe en esa base — vive en el CRM.
Por eso los ~20 consumidores de `creditos.asesor_id` (pagos por asesor, efectividad,
reportes, embudo) tienen que seguir al **dueño actual del cobro**. Mantener uno viejo
acreditaría pagos a quien ya no cobra ese crédito.

Reasignar = **`UPDATE cartera.creditos SET asesor_id`, únicamente ese campo**, más un
INSERT en `credito_asesor_historial`. La bitácora es obligatoria, siempre, automática o
manual.

### El pool: `asesor_bucket`

Un bucket tiene varios asesores (`asesor_bucket`, muchos-a-muchos, con `activo` y
`capacidad_base`). Pero **cada crédito lo lleva un solo asesor**: su cartera.

El pool es **elegibilidad, no cola compartida**. Define quién *puede* recibir créditos de
ese bucket; el motor decide quién lo recibe.

### A quién se lo da

`elegirAsesorParaBucket(pool, carga, asesorActual)`:

1. Pool vacío → **no se toca el asesor** (se conserva el actual y se cuenta en `sinPoolDestino`). Nunca se deja un crédito huérfano.
2. El asesor actual también está en el pool del bucket destino → **se queda**. Sin churn innecesario.
3. Si no → el asesor del pool con **menos carga en ese bucket**; a igualdad, el de menor `asesor_id` (determinístico).

La carga se mantiene **viva durante la corrida**, así que si en una misma noche caen 40
créditos al mismo bucket, se reparten parejo en vez de irse todos al que estaba más
liviano al arrancar.

`INICIAL` **no reasigna**: la línea base no es un movimiento, solo el registro de dónde
estaba el crédito cuando el motor lo vio por primera vez.

### Reasignación manual

El supervisor puede reasignar a mano (`POST /buckets/creditos/:credito_id/reasignar`).
Mismo par UPDATE + bitácora, pero con `origen = API_MANUAL`, el `usuario_id` de quien lo
hizo y **motivo obligatorio**. Solo se permite mover a un asesor que ya esté en el pool
del bucket actual del crédito.

---

## Cómo interactúa un pago con el bucket

Es la duda que más se repite, así que va explícita:

| Momento | Qué pasa con la mora | Qué pasa con el bucket |
| --- | --- | --- |
| Se registra el pago (sin validar) | `procesarPagoMora` **apaga la mora** y el estado vuelve a ACTIVO | **Nada.** El bucket sigue igual |
| Corre el job, pago aún sin validar | La mora se **re-crea** con las mismas cuotas | **Cero eventos** |
| Contabilidad **valida** el pago | La cuota queda `pagado = true` | Todavía nada: el bucket lo mueve el job |
| Corre el job | Recalcula la mora sobre el capital nuevo | **`BAJADA`** + reasignación de asesor |

Es decir: **el bucket lo mueve el job, y solo con pagos validados.** La ventana en que la
mora está apagada pero el bucket no ha bajado es intencional — es lo que evita el bucket
fantasma descrito en [el modelo](./01-modelo-de-buckets.md#cómo-se-lee-el-bucket-de-un-crédito).

---

## Convenios: un carril aparte

Los créditos `EN_CONVENIO` están **excluidos del motor de moras** (no se les genera mora ni
se les cambia el estado). Sin embargo también necesitan bucket: alguien les da seguimiento.

Por eso tienen **su propio job**, `procesarBucketsConvenio`, a las **00:30 GT** —después de
`procesarMoras`, con su propio advisory lock, sin pisarse.

**Cómo se mide el atraso de un convenio.** Acá hubo un hallazgo que cambió el modelo: el
pago del convenio marca `convenio_cuotas.fecha_pago` pero **no toca `cuotas_credito`**. Un
cliente que viene pagando su convenio religiosamente se veía como moroso si se contaban
solo las cuotas del crédito.

El modelo final es **meses atrasados**: cuántas fechas de vencimiento distintas, ya pasadas,
tienen algo impago — uniendo las cuotas del crédito que el convenio no reestructuró y las
cuotas del convenio pendientes. Se unen **por fecha**: si el mismo día debe la cuota normal
y la del convenio, eso es **un** mes atrasado, no dos. Sumarlas por separado mandaba a la
mayoría a B5 por doble conteo.

Este job **sí reasigna asesor, incluso en el `INICIAL`**, porque los créditos en convenio
nunca pasaron por la carga inicial (que los excluye por estar fuera del funnel).

---

## Qué corre y cuándo

| Hora (GT) | Proceso | Dónde |
| --- | --- | --- |
| 23:00 | Efectividad de asesores | cartera-back |
| **23:59** | **`procesarMoras` + pass de buckets + reasignación** | cartera-back |
| **00:30** | **Buckets de créditos en convenio** | cartera-back |
| 02:00 | Cierre mensual de cartera (incluye el aging por buckets) | cartera-back |
| 07:00 | Elegibilidad de reducción de recordatorios (CB-010) | CRM |
| 08:00 | Recordatorios premora + alertas de cobros | CRM |
| 08:05 | Recordatorios de convenio | CRM |

Para correr el motor a mano: `POST /moras/procesar` (devuelve el resumen
`{iniciales, subidas, bajadas, reasignados, sinPoolDestino}`) y
`POST /buckets/convenio/procesar`.
