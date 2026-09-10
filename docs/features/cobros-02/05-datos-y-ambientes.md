# 5 · Datos y ambientes

**Estado:** ✅ Vigente
**Aplica a:** todo COBROS-02 (cartera-back y CRM)

---

## Las tres bases que hay que tener en la cabeza

En **dev**, el CRM, cartera y el sandbox de COBROS-02 **comparten la misma base Neon**
(`green-tree`, base `neondb`). Lo que las separa son los **schemas**:

| Schema | Dueño | Qué tiene |
| --- | --- | --- |
| `public` | CRM | leads, casos y contactos de cobros, notificaciones, recordatorios, usuarios |
| `cartera` | cartera-back | créditos, cuotas, pagos, moras, buckets — la copia "normal" de dev |
| `cartera_cobros2` | cartera-back | **el sandbox de COBROS-02**: copia de `cartera` con las migraciones y datos del rediseño |

En **producción** son bases separadas de verdad (CRM y cartera en Supabase).

> ⚠️ **Que compartan instancia en dev tiene consecuencias reales.** Un `TRUNCATE`, un
> `DROP SCHEMA` o un cambio de sesión mal apuntado en dev no solo afecta a cartera: puede
> tumbar el CRM de dev, que es lo que está usando el bot. Calificar siempre el schema.

---

## El sandbox `cartera_cobros2`

Existe porque COBROS-02 **reasigna asesores y reescribe la asignación de la cartera
completa**. Probar eso contra el schema `cartera` de dev arruinaría cualquier otra prueba
que dependa de quién cobra qué.

Se apunta con la variable de entorno **`CARTERA_SCHEMA`**:

```bash
CARTERA_SCHEMA=cartera_cobros2   # apunta al sandbox
# quitar la línea → vuelve a `cartera` (el default)
```

Esa variable es la que des-quemó el `cartera.` que estaba hardcodeado en ~270 referencias
del backend. Dos formas de usarla en código:

- `CARTERA_SCHEMA` (string) — para SQL crudo dentro de strings planos.
- `SQL_CARTERA_SCHEMA` (`sql.raw`) — para dentro de plantillas `` sql`...` `` de drizzle,
  donde un string suelto se convertiría en parámetro `$n`.

> Los scripts de `src/scripts/` quedaron con `cartera.` quemado a propósito: son
> herramientas de producción, no deben poder apuntarse a un sandbox por accidente.

---

## 🚨 La trampa del pooler

**Nunca `SET search_path` a través del pooler de Neon.**

El pooler reparte backends entre conexiones. Un `SET search_path` sin `LOCAL` se queda
pegado en ese backend y se lo hereda la siguiente conexión — que puede ser el CRM. El
síntoma es *"relation does not exist"* en pantallas que no tienen nada que ver, y no se
arregla solo.

Qué hacer en su lugar:

- `SET LOCAL search_path` dentro de una transacción, o
- **nombres calificados** (`cartera_cobros2.creditos`), que es lo que hacen los scripts de
  asignación.

Si ya pasó: reconectar varias veces ejecutando `SET search_path TO DEFAULT` hasta limpiar
los backends envenenados.

---

## Migraciones

| Dónde | Convención |
| --- | --- |
| `apps/cartera-back/drizzle/cobros-02/` | Bloque de COBROS-02. SQL a mano, **idempotente**, se aplican en orden de número |
| `apps/cartera-back/drizzle/` | Migraciones normales de cartera (ej. `0024` de convenios) |
| `apps/crm/apps/server/src/db/migrations/` | CRM, numeradas a mano (el journal de drizzle está desactualizado desde la 0018) |

**Las corre el usuario.** Se dejan escritas y se avisa; nunca se ejecuta
`bun run db:generate / db:push / db:migrate`.

El bloque de COBROS-02 hoy:

| Archivo | Qué crea |
| --- | --- |
| `0000_motor_buckets.sql` | Enums, `buckets_historial`, `asesor_bucket` |
| `0001_buckets_catalogo.sql` | Catálogo `buckets` + seed B0-B5 + FKs |
| `0002_credito_asesor.sql` | Bitácora `credito_asesor_historial` |
| `0003_buckets_estado_mora.sql` | Puente `buckets.estado_mora` hacia el vocabulario viejo |
| `0004_buckets_capacidad_base.sql` | `asesor_bucket.capacidad_base` |
| `0005_asesor_bucket_margen_alerta.sql` | Margen de alerta de ocupación |
| `0006_buckets_dias_sla.sql` | `buckets.dias_sla` (CB-020) |
| `0007_promesas_pago_espejo.sql` | Copia local de promesas para el motor (CB-030) |
| `0008_pagalo_payment_imports.sql` | Ledger idempotente de los pagos con link de Págalo (CB-028) |
| `0009`–`0011` (Págalo) | Grupos de un solo link, solo capital y auditoría sin crédito vivo |
| `0012_pagalo_validado_cuenta_factura.sql` | Cuenta de empresa **PAGALO** + estado de la factura del import (el pago con link nace validado) |
| `0013_pagalo_recibo_status.sql` | Outbox del recibo por WhatsApp del import Págalo |
| `0014_estado_facturacion_pago.sql` | **`pagos_credito.factura_status`** + `facturas_electronicas.rubro/inversionista_id` — ver [Facturación](./04-operacion-diaria.md#facturación-qué-quedó-sin-factura) |
| `0015_cb114_traslados_cartera.sql` | Ledger de los traslados masivos: `operaciones_traslado_cartera` (+ detalle) con el plan previsualizado, su hash y su clave de idempotencia |

Y en el CRM: `0025` premora · `0027` alertas de cobros · `0030` reducción CB-010 ·
`0031` recordatorios de convenio · `0032` alerta de promesa · `0033`-`0035` bot de cobros.

---

## La carga inicial

Una vez aplicadas las migraciones, el modelo hay que **poblarlo**. Son scripts
**set-based** (nada de recorrer crédito por crédito) en
`apps/cartera-back/drizzle/cobros-02/asignacion/`:

| Script | Qué hace |
| --- | --- |
| `01_pool_asesor_bucket.sql` | Puebla el pool `asesor_bucket` desde `pool.csv`. **Autoritativo**: reactiva los pares del CSV y desactiva los que ya no estén |
| `02_asignar_asesores_creditos.sql` | Deriva el bucket de cada crédito con **las mismas reglas del motor** y le asigna asesor. Bitácora primero, `UPDATE creditos SET asesor_id` después |
| `03_linea_base_historial.sql` | Siembra el evento `INICIAL` en `buckets_historial`, solo para créditos sin registro — así el motor no re-siembra y solo anota movimientos reales |
| `04_backfill_cuotas_convenio.sql` | Llena `convenios_pago.cuotas_convenio` desde el pivot histórico |

### El pool es un CSV, no una lista en el código

`pool.csv` es el parámetro de quién cubre qué:

```csv
email_cash_in,buckets,nombre_referencia
caren.r@clubcashin.com,0,Caren Rivera
samuel.g@clubcashin.com,2|3,Samuel Gamboa
```

La llave es el **correo**, no el nombre ni el `asesor_id`. Eso no es un detalle: entre dos
refrescos del sandbox, el `asesor_id` que era "Asesor Prueba B1" pasó a ser una persona
real, y los nombres tampoco son estables (hay un asesor cuyo nombre y correo no coinciden).
El correo es además el puente hacia el usuario del CRM (`email_cash_in`), que es lo que usan
la cola, la agenda y las alertas para saber quién es quién.

Un asesor puede cubrir **varios buckets** (`2|3`): el esquema siempre lo permitió y el motor
lo contempla, con la carga contada por bucket, no en total.

### El orquestador

`carga_inicial.sh` hace todo el camino y está parametrizado por origen y destino, para que
el mismo script sirva en los tres escenarios:

```bash
carga_inicial.sh --origen "$URL" --origen-schema cartera \
                 --destino "$URL" --destino-schema cartera_cobros2 \
                 --pool pool.csv --dry-run
```

| Escenario | Cómo se invoca |
| --- | --- |
| Dev | Misma base Neon, `cartera` → `cartera_cobros2` |
| Ensayo | Otra base (un Postgres local), el nombre de schema que sea |
| Producción | Misma base y **mismo schema**: se salta la copia y solo migra y carga. Exige `--permitir-prod` |

Fases: `copiar`, `migrar`, `pool`, `asignar`, `linea-base`, `backfill`, `verificar` y
`motores`. Las cuatro de asignación corren en **una sola transacción**, así que el `02`
reparte con el pool que el `01` acaba de armar; con `--dry-run` se hace ROLLBACK al final y
se ve la distribución exacta sin escribir nada.

Guardas que trae puestas: rechaza cadenas de **pooler** en el destino, exige
`--permitir-prod` para escribir contra Supabase, y nunca hace `DROP` de un schema llamado
`cartera`.

## Poner el sandbox al día con producción

El sandbox es una **foto**. Producción sigue moviéndose: entran pagos, se validan cuotas, se
cancelan créditos, se firman convenios. A las pocas semanas los buckets del sandbox
describen un pasado.

**Regla de dirección: producción → dev, nunca al revés.** Contra producción solo `SELECT` y
`pg_dump`; jamás `restore`, `TRUNCATE` ni DDL.

`alinear_desde_prod.sh` hace el camino completo **a demanda** (se descartó dejarlo
programado): dump de prod → schema de trabajo → migraciones → trasplante del historial del
sandbox → línea base de los créditos nuevos → **el motor** → residuos → swap por rename.

### Copiar los datos no mueve ningún bucket

Es la parte que más confunde y por eso va aparte. El bucket de un crédito no es una columna:
es la última fila de `buckets_historial`. Traer los datos frescos de producción actualiza
cuotas y pagos, pero **el historial sigue diciendo lo mismo de ayer**.

```
sandbox: crédito en B1, asesor de B1
prod:    el cliente ya pagó y contabilidad validó

  copiar datos  → la cuota llega saldada, pero el crédito SIGUE en B1
  correr motor  → cuenta 0 cuotas vencidas → BAJADA B1 → B0
                  + reasignación al asesor de B0 + las dos bitácoras
```

Por eso la alineación corre el motor, y por eso cada corrida deja registrado el movimiento
**real** de la cartera desde la última vez, en lugar de un salto silencioso. Medido en la
primera corrida contra producción: 20 subidas, 1 bajada, 21 reasignaciones, más 62 créditos
en convenio recibiendo su línea base.

Qué se conserva del sandbox: el catálogo `buckets` con sus SLA y colores, el pool, las dos
bitácoras, el espejo de promesas, el ledger de Págalo, los traslados, y **el dueño de cada
crédito** (producción trae el asesor viejo, que en COBROS-02 ya no aplica). Qué se pierde:
los pagos y boletas de prueba que se hayan registrado en el sandbox.

> ⚠️ **Todo lo que lleva un asesor se remapea por correo, no por id.** El `asesor_id` es un
> serial por ambiente: el mismo número puede ser otra persona después de un refresco, y ya
> pasó (el id que era "Asesor Prueba B1" hoy corresponde a alguien real). Copiar el pool por
> número le entregaría la cartera de un bucket a quien no es. El trasplante arma un mapa
> viejo → nuevo cruzando `email_cash_in`, y si un asesor **que tiene pool** no aparece en
> producción, la alineación aborta en vez de adivinar.

Después del swap hay que **reiniciar cartera-back**: el swap es un rename y sus conexiones
vivas siguen apuntando al schema que acaba de pasar a backup.

> Para producción el criterio es distinto: ahí la carga inicial es **línea base limpia**, sin
> replay. Comprimir meses de movimiento en una noche inventaría cientos de "cuentas curadas"
> el día del estreno, que es justo el KPI que el modelo existe para medir.

**El procedimiento manual con docker, paso a paso**, sigue en el
[runbook de refresco](./RUNBOOK-refrescar-sandbox.md), con el registro de cada corrida.

---

## Trampas de `psql` y de los schemas

Aparecieron todas construyendo estos scripts. Ninguna da un error obvio.

| Trampa | Qué pasa |
| --- | --- |
| **Los ENUM viven en cada schema** | `cartera_cobros2.bucket_evento_tipo` y `cartera_cobros2_nuevo.bucket_evento_tipo` son tipos **distintos**. Copiar entre schemas exige castear `col::text::<destino>.<enum>` |
| **`\copy` no interpola variables** | Es la única meta-orden de psql que no lo hace. Hay que armar la orden completa con `\set` y ejecutar esa variable |
| **`:variables` no entran en `$$ … $$`** | Dentro del cuerpo de una función psql no sustituye nada. Los schemas se pasan como parámetros de la función |
| **`sslrootcert=system`** | Lo entiende `psql`/`pg_dump` (libpq) y evita tener que crear `~/.postgresql/root.crt`, pero la librería `pg` de Node lo toma como **nombre de archivo** y revienta con `ENOENT: 'system'`. Hay que quitarlo antes de dárselo al motor |
| **`conname` no es único por base** | Los bloques `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)` daban por creada una constraint que en realidad vivía en **otro schema** de la misma base. Preparando `<schema>_nuevo` al lado del sandbox, las tablas nuevas quedaban sin sus FKs ni sus CHECK, en silencio. Hay que acotar por `conrelid`, y las migraciones ahora verifican al final que las 22 existan de verdad |
| **Copiar a otra base deja dependencias atrás** | `pg_dump --schema=cartera` no se lleva los ENUM de `public` que usan varias columnas (`payment_validation_status`, `estado_liquidacion`, `tipo_cuenta_enum`) ni las extensiones. El restore falla al crear las tablas y se cae en cascada. Los scripts lo validan antes de empezar y entregan el `CREATE TYPE` exacto |
| **`pg_dump` y el `search_path`** | Un dump plano abre con `set_config('search_path', '', false)` **sin `LOCAL`**, o sea que persiste en la sesión. Por el pooler eso envenena backends compartidos, ver arriba |

Y una de bash, que costó una corrida entera: un `|| true` sobre el paso del motor se tragó
un fallo y la alineación terminó "bien" con cero transiciones. Los pasos que escriben datos
tienen que fallar ruidosamente.
