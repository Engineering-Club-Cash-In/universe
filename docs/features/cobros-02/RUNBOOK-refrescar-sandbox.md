# Runbook · Refrescar el sandbox con datos de producción

**Estado:** ✅ Ejecutado por primera vez el **2026-08-17** — ver [el registro](#registro-de-corridas) al final
**Duración:** ~40 min · **Reversible:** sí, con dos `ALTER SCHEMA`

---

## Para qué sirve

El sandbox `cartera_cobros2` es una **foto**. Producción sigue moviéndose: entran pagos, se
validan cuotas, nacen créditos, se firman convenios. A las pocas semanas los buckets del
sandbox describen un pasado y cualquier prueba encima miente.

Este procedimiento lo pone al día: trae los datos de producción de hoy, **conserva el
historial de buckets y de reasignaciones**, y deja que el motor registre los movimientos
reales que ocurrieron mientras tanto.

Es además el **ensayo del pase a producción**: el día que COBROS-02 salga, la carga inicial
es esto mismo contra el schema real. Ver [qué cambia en producción](#qué-cambia-el-día-del-pase-a-producción).

---

## La idea en una línea

> No se refrescan los datos *dentro* del sandbox: se **construye uno nuevo en local**, se le
> trasplanta el historial, y se cambia por el viejo con un rename.

Refrescar en sitio obligaría a un upsert tabla por tabla en ~15 tablas con FKs entre ellas,
y ahí es donde quedan inconsistencias que aparecen dos semanas después. Construirlo de cero
es mecánico y verificable en cada paso.

**Todo el armado va en un Postgres local**, no en Neon: son varias restauraciones y
recargas, y no tiene sentido cobrárselas a la base compartida. Neon solo recibe el
resultado final.

```
   Supabase (prod)          Docker local              Neon green-tree
   ──────────────           ────────────              ───────────────
   pg_dump ────────────────▶ base `cobros2`
   (solo lectura)            + migraciones
                             + historial ◀──────────── pg_dump del sandbox actual
                             + asignación
                             + motores
                             └──────────────────────▶ swap por rename
```

---

## Antes de empezar

| Requisito | Detalle |
| --- | --- |
| Contenedor local | `cartera-postgres` (postgres:16, puerto 5433). Si está apagado: `docker start cartera-postgres` |
| Conexión a prod | Está comentada en `apps/cartera-back/.env`. **Solo lectura** |
| Espacio en Neon | El swap deja conviviendo el nuevo (~205 MB) y el backup (~161 MB) |
| Código de COBROS-02 | Si estás en otra rama, `git worktree add` en vez de cambiar de rama |

> 🔒 **Regla de dirección: producción → dev, nunca al revés.** Contra prod solo `pg_dump` y
> `SELECT`. Jamás `restore`, `TRUNCATE` ni DDL.

---

## Fase 0 · Respaldar el historial

Lo primero, antes de tocar nada: sacar de Neon las tablas de COBROS-02 a un archivo. Son
las únicas que **no** se pueden reconstruir desde producción.

```bash
pg_dump "$NEON" -Fc --no-owner --no-privileges \
  -t cartera_cobros2.buckets \
  -t cartera_cobros2.asesor_bucket \
  -t cartera_cobros2.buckets_historial \
  -t cartera_cobros2.credito_asesor_historial \
  -t cartera_cobros2.promesas_pago_espejo \
  > historial-$(date +%Y%m%d-%H%M).dump
```

Y la misma selección en formato plano (`--data-only`), que es la que se va a reimportar.

## Fase 1 · Dump de producción

```bash
docker exec -e PGURL="$PROD" cartera-postgres sh -c \
  'pg_dump "$PGURL" -Fc --schema=cartera --no-owner --no-privileges' > cartera-prod.dump

docker exec -e PGURL="$PROD" cartera-postgres sh -c \
  'pg_dump "$PGURL" -Fc --schema=public --no-owner --no-privileges' > public-prod.dump
```

Se usa el `pg_dump` **del contenedor** (v16) y no el del sistema, para que la versión del
dump coincida con la del destino.

> ⚠️ **El schema `public` también hace falta**, aunque parezca que no. Tres columnas de
> `cartera` usan tipos ENUM que viven ahí (`payment_validation_status`, `estado_liquidacion`,
> `tipo_cuenta_enum`). Sin ellos, `CREATE TABLE` falla y el restore se cae en cascada —
> pasan cientos de errores y al final `pagos_credito` ni existe. Pesa 1 MB, no cuesta nada.

## Fase 2 · Levantar la base local

```bash
psql ... -c "DROP DATABASE IF EXISTS cobros2;" -c "CREATE DATABASE cobros2;"

# Las extensiones NO vienen en el dump: viven en `public` y `extensions` de Supabase.
psql ... -d cobros2 \
  -c 'CREATE SCHEMA IF NOT EXISTS extensions;' \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;' \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;' \
  -c 'CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;' \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;'

# Primero public (los tipos), después cartera
pg_restore ... -d cobros2 --no-owner --no-privileges /tmp/public.dump
pg_restore ... -d cobros2 --no-owner --no-privileges /tmp/prod.dump
```

**El restore de `cartera` tiene que terminar con 0 errores.** Si sale alguno, hay que leer
los **primeros** (`head`), no los últimos: los del final son consecuencia en cascada del
primero y no dicen nada.

Verificar contra prod: `creditos`, `cuotas_credito`, `pagos_credito`, `moras_credito`,
`convenios_pago`, `asesores`, `usuarios`. Diferencias de una o dos filas en pagos o moras
son normales — prod siguió trabajando mientras corría el dump, que es una foto consistente
del momento en que arrancó.

> El schema local se deja llamándose **`cartera`**, no `cartera_cobros2`. Así las
> migraciones corren tal cual están escritas, sin reescribir nada. El rename va al final.

## Fase 3 · Migraciones

En orden, con `ON_ERROR_STOP=1`:

```
drizzle/cobros-02/0000_motor_buckets.sql        → drizzle/cobros-02/0007_promesas_pago_espejo.sql
drizzle/0024_convenios_pago_cuotas_convenio.sql
```

Al terminar, `cartera.buckets` debe tener 6 filas (el seed del catálogo) y las demás tablas
de COBROS-02 vacías.

## Fase 4 · Trasplantar el historial

**No insertar directo.** Primero cargar en un schema aparte (`importado`) y **medir qué
queda huérfano**, porque un crédito que ya no existe en producción se lleva por delante su
historial:

```sql
CREATE SCHEMA importado;
CREATE TABLE importado.buckets_historial (LIKE cartera.buckets_historial);
-- … las 5 tablas
```

El archivo de datos viene con el prefijo `cartera_cobros2.`; hay que reescribirlo:

```bash
sed -e 's/^COPY cartera_cobros2\./COPY importado./' \
    -e "/^SELECT pg_catalog.setval('cartera_cobros2\./d" \
    -e '/^SET transaction_timeout = 0;$/d' \
    datos-cobros02.sql > importar-historial.sql
```

> ⚠️ **`transaction_timeout`** es un parámetro de PG17+. Si el `pg_dump` que generó el
> archivo es más nuevo que el servidor destino, esa línea lo revienta. Se borra.

Luego contar huérfanos **antes** de insertar: filas cuyo `credito_id`, `asesor_id` o
`pago_id` ya no existan. Si salen, se reportan — nunca se descartan en silencio.

Insertar, y **ajustar las secuencias** al máximo insertado; si no, el siguiente `INSERT`
choca contra una PK ya usada.

Para el catálogo `buckets`, gana el del sandbox (con un `UPDATE`, no un `INSERT`): la
migración solo siembra placeholders, y el sandbox trae los `dias_sla`, colores y capacidades
que se hayan afinado.

## Fase 5 · Asignación

| Script | ¿Correr? |
| --- | --- |
| `01_pool_asesor_bucket.sql` | **No**, si el pool vino en el trasplante. Volver a correrlo duplicaría el asesor de prueba y pisaría capacidades |
| `02_asignar_asesores_creditos.sql` | Sí |
| `03_linea_base_historial.sql` | Sí — siembra `INICIAL` solo a los créditos nuevos |
| `04_backfill_cuotas_convenio.sql` | Sí |

Cambiar el `SET LOCAL search_path TO cartera_cobros2;` de la cabecera por `cartera`.

## Fase 6 · Correr los motores

Conviene llamarlos **directo**, sin levantar el servidor de cartera-back: al arrancar
programa tareas de facturación y correo que no tienen por qué dispararse desde una máquina
de trabajo.

```ts
// correr-motor.ts, en apps/cartera-back
import "dotenv/config";
import { procesarMoras } from "./src/controllers/latefee";
import { procesarBucketsConvenio } from "./src/controllers/bucketsConvenio";

const cual = process.argv[2] ?? "moras";
const r = cual === "convenio" ? await procesarBucketsConvenio() : await procesarMoras();
console.log(JSON.stringify(r, null, 2));
process.exit(0);
```

Con un `.env` propio apuntando al local (`SUPABASE_DB_URL` al docker, `CARTERA_SCHEMA=cartera`).
**Copiarlo, no editar el original.**

Orden: `moras` → `convenio`.

### ⚠️ Volver a correr el `02` después del motor

El `02` deriva el bucket de `moras_credito`, que en el dump es la foto que dejó el job de
producción **anoche**. El motor recalcula desde las cuotas y los pagos de hoy, así que
algunos créditos terminan en otro bucket del que el `02` supuso, y quedan con un asesor que
no es de ese pool.

Correr el `02` otra vez —ahora que el motor refrescó la mora— los alinea. En la primera
corrida esto movió 256 créditos más.

## Verificación

| Prueba | Qué tiene que dar |
| --- | --- |
| **Segunda corrida del motor** | **0 eventos** y `sinCambios` = todos. Es la prueba de que la carga quedó bien |
| `sinPoolDestino` | 0. Si no, hay un bucket sin asesores en el pool |
| Desalineados en el funnel | Cerca de 0, excluyendo `CANCELADO`/`PENDIENTE_CANCELACION`/`CAIDO` |
| Conteos local vs Neon | Idénticos, tabla por tabla |

**Desalineados que son normales y no hay que perseguir:**

- **Créditos con capital 0** — el motor los omite (`sinCapital` en el resumen), así que su
  bucket queda congelado mientras el `02` los manda a B0. Deberían estar cancelados.
- **Fuera del funnel** — su última fila de historial es de cuando estaban activos. Es por
  diseño: el lector los marca con la bandera `fuera_funnel` y su asesor da igual.
- **`EN_CONVENIO`** — los lleva el job de convenios, que solo reasigna cuando hay cambio de
  bucket; los que no se movieron conservan su asesor anterior.

## Fase 7 · Swap

```sql
-- en local
ALTER SCHEMA cartera RENAME TO cartera_cobros2;
```

```bash
pg_dump ... -Fc --schema=cartera_cobros2 -f nuevo.dump
```

```sql
-- en Neon
ALTER SCHEMA cartera_cobros2 RENAME TO cartera_cobros2_bk_<fecha>;
```

```bash
pg_restore -d "$NEON" --no-owner --no-privileges nuevo.dump
```

**Antes de restaurar**, confirmar que los tipos cruzados existen en el `public` de Neon
(`payment_validation_status`, `estado_liquidacion`, `tipo_cuenta_enum`) y que `cartera` no
tiene FKs hacia fuera de su propio schema. Todo lo demás viaja adentro del dump.

### Después del swap

- **Reiniciar cartera-back.** El swap es un rename: una conexión viva puede seguir hablándole
  al schema viejo, que ahora es el backup.
- El backup se borra **cuando se haya validado**, no antes.

## Rollback

```sql
ALTER SCHEMA cartera_cobros2 RENAME TO cartera_cobros2_fallido;
ALTER SCHEMA cartera_cobros2_bk_<fecha> RENAME TO cartera_cobros2;
```

Segundos, y sin pérdida.

---

## Qué cambia el día del pase a producción

Casi nada del procedimiento, pero sí **una decisión de fondo**:

| | Sandbox | Producción |
| --- | --- | --- |
| Historial previo | Se conserva (es lo que se está probando) | **No existe**: la línea base se siembra en el momento |
| El `03` | Solo cubre los créditos nuevos | Cubre **todos** |
| Los motores | Registran el replay del período | Registran cero: todos acaban de recibir su `INICIAL` |

> 🚨 **En producción NO se hace replay.** Cargar meses de movimiento y correr el motor una
> vez comprime todo en una única transición fechada ese día: el historial diría que hubo
> cientos de "cuentas curadas" de golpe, que es justo el KPI que el modelo existe para medir.
> En producción la carga inicial es **línea base limpia**.

Y en la carga inicial de producción, el `02` reasigna la cartera completa de una sola vez.
**No es un ajuste, es una redistribución**: hay que avisarle al equipo de cobros antes, no
después.

---

## Registro de corridas

### 2026-08-17 — primera ejecución

Sandbox venía del **25 de junio** (1,628 créditos). Se refrescó a datos del **17 de agosto**
(1,809 créditos). Prod: PostgreSQL 15.8 · Neon: 17.10 · local: 16.

| Fase | Resultado |
| --- | --- |
| Dump de prod | 22 MB · foto de las 12:35 |
| Restore local | **0 errores** · conteos idénticos al dump |
| Migraciones | `0000`→`0007` + `0024`, todas OK |
| Trasplante | 2,871 + 2,572 + 7 + 3 filas · **0 huérfanas** |
| `02` (1ª vez) | 1,330 créditos reasignados |
| `03` | 190 líneas base nuevas |
| `04` | 16 convenios, 40 cuotas |
| Motor de mora | 71 subidas · 924 bajadas · 41 reasignados · 0 sin pool |
| Motor de convenios | 60 créditos · 2 subidas · 41 bajadas · 35 reasignados |
| `02` (2ª vez) | 256 créditos más alineados |
| **2ª corrida del motor** | **0 eventos, 789 sin cambios** ✅ |
| Restore a Neon | **0 errores** · conteos idénticos al local |

**Historial acumulado:** `buckets_historial` 2,871 → **4,099** · `credito_asesor_historial`
2,572 → **4,234**.

**Distribución final:** B0 774 · B1 484 · B2 174 · B3 70 · B4 30 · B5 194.
La transición más grande del día fue **B2 → B0 con 358 créditos**.

**Residuo:** 21 créditos de 1,809 (1.2%) con asesor fuera del pool de su bucket — 7 con
capital 0 y 14 `EN_CONVENIO`. Los dos casos están explicados arriba.

**Hallazgo:** los ids del pool `asesor_bucket` siguen siendo válidos, pero **las personas
detrás cambiaron** entre junio y hoy (el `asesor_id` que en el sandbox era el asesor de
prueba de B1 hoy corresponde a alguien real). Al refrescar, revisar el pool antes de correr
el `02`: esas personas quedan como dueñas reales de la cartera.
