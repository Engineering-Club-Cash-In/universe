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

Y en el CRM: `0025` premora · `0027` alertas de cobros · `0030` reducción CB-010 ·
`0031` recordatorios de convenio · `0032` alerta de promesa · `0033`-`0035` bot de cobros.

---

## La carga inicial

Una vez aplicadas las migraciones, el modelo hay que **poblarlo**. Son scripts
**set-based** (nada de recorrer crédito por crédito) en
`apps/cartera-back/drizzle/cobros-02/asignacion/`:

| Script | Qué hace |
| --- | --- |
| `01_pool_asesor_bucket.sql` | Puebla el pool `asesor_bucket`: qué asesor cubre qué bucket |
| `02_asignar_asesores_creditos.sql` | Deriva el bucket de cada crédito con **las mismas reglas del motor** y le asigna asesor (1 asesor → directo; N → round-robin determinístico). Bitácora primero, `UPDATE creditos SET asesor_id` después |
| `03_linea_base_historial.sql` | Siembra el evento `INICIAL` en `buckets_historial`, solo para créditos sin registro — así el motor no re-siembra y solo anota movimientos reales |
| `04_backfill_cuotas_convenio.sql` | Llena `convenios_pago.cuotas_convenio` desde el pivot histórico |

Cada uno abre con `SET LOCAL search_path TO cartera_cobros2;` — **cambiar esa línea al
schema real cuando toque producción.** Son idempotentes y revientan (no siguen a medias)
si falta un prerequisito.

Distribución del dry-run contra dev (2026-07-08), como referencia de magnitud:

| B0 | B1 | B2 | B3 | B4 | B5 | Fuera del funnel |
| --- | --- | --- | --- | --- | --- | --- |
| 437 | 597 | 219 | 55 | 30 | 148 | 142 (no se tocan) |

**1,193 créditos cambiaron de dueño.** Ese número es el que hay que tener presente: la
carga inicial no es un ajuste, es una redistribución completa de la cartera.

---

## Refrescar el sandbox

El sandbox es una **foto**. Producción sigue moviéndose: entran pagos, se validan cuotas,
se cancelan créditos, se firman convenios. A las pocas semanas los buckets del sandbox
describen un pasado.

**Regla de dirección: producción → dev, nunca al revés.** Contra producción solo `SELECT`;
jamás `restore`, `TRUNCATE` ni DDL.

Y una advertencia de diseño que conviene decidir **antes** de refrescar, no después:

> Si se cargan semanas de pagos de golpe y luego se corre el motor una sola vez, cada
> crédito salta de su bucket viejo al de hoy **en una única transición fechada hoy**. El
> historial queda diciendo que hubo cientos de "cuentas curadas" el mismo día, y todos los
> asesores cambian de cartera de un jalón. Los números salen correctos; la **historia**
> queda inventada.
>
> Para un sandbox eso es aceptable —y sirve de prueba de estrés del motor a escala real—
> pero **para la salida a producción no lo es**: ahí la carga inicial tiene que ser una
> línea base limpia (`INICIAL` con el bucket correcto de ese día), no un recuento de meses
> comprimido en una noche.

**El procedimiento completo, paso a paso, está en el
[runbook de refresco](./RUNBOOK-refrescar-sandbox.md)**, con las trampas que aparecieron la
primera vez (los tipos ENUM que viven en `public`, las extensiones que no vienen en el dump,
el `transaction_timeout` entre versiones) y el registro de cada corrida.
