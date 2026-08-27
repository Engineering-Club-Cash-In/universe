# 4 · Operación diaria

**Estado:** ✅ Implementado
**Vive en:** `apps/crm/apps/web/src/routes/cobros/` (pantallas) · `apps/cartera-back/src/controllers/buckets/` (datos)

---

## La idea

El modelo de buckets no sirve de nada si el asesor no sabe **qué hacer hoy**. Esta capa
convierte el estado de la cartera en una rutina: a quién llamar, en qué orden, con cuánto
tiempo, y cómo se mide si se cumplió.

```
08:00  Apertura        el supervisor ve qué cambió anoche y reparte el día
  ↓
       Cola del día    cada asesor recibe su lista, ordenada por SLA
  ↓
       Agenda          las cuotas que vencen D-0…D-5, con su bucket
  ↓
       Gestión         contactos, promesas, convenios
  ↓
       Cierre          qué se cumplió
```

---

## Apertura del día (CB-023)

Una sola llamada arma la vista de las 8:00 AM del supervisor:

1. **Cuentas nuevas por bucket** — las transiciones que registró el motor anoche. Quién
   subió, quién bajó.
2. **Cumplimiento de ayer** — de las cuotas que vencían ayer, cuántas se pagaron (cuentas y
   monto).
3. **Top 3 por bucket** — los tres créditos más críticos de cada bucket, por monto adeudado.

**La fórmula del monto adeudado** vale la pena tenerla clara, porque es fuente de confusión
recurrente:

```
monto_adeudado = (cuotas_vencidas × cuota) + monto_mora
```

`monto_mora` es **solo el recargo**. Las cuotas vencidas van aparte. Un número que sume
"la mora" sin las cuotas —o una sola cuota cuando debe tres— se queda corto.

Pantalla: `/cobros/apertura`.

---

## Cola del día y SLA (CB-020)

La **cola** es el universo de trabajo del asesor: los créditos del **pool de sus buckets**
(`asesor_bucket`), no los que tiene asignados individualmente.

La distinción importa:

| Vista | Eje | Responde a |
| --- | --- | --- |
| **Cola del día** | El pool de buckets del asesor | "¿Qué cuentas de mis buckets hay que trabajar?" |
| **Agenda** | `creditos.asesor_id` | "¿Qué cuotas de *mis* créditos vencen pronto?" |

El orden lo da el **SLA**: `buckets.dias_sla` son los días que hay para contactar desde que
el crédito **entró** al bucket — por eso la cola necesita no solo el número del bucket sino
**la fecha** de esa fila del historial. B0 se excluye siempre: no tiene SLA, está al día.

Pantallas: `/cobros/cola` (supervisor) y `/cobros/mi-dia` (el asesor).

---

## Agenda del día

Las cuotas que vencen de hoy a cinco días, por asesor.

- El rol **`cobros`** solo ve la suya, **forzado del lado del servidor**: se cruza el email
  de la sesión contra los asesores de cartera. Sin match, se avisa y no se muestra nada —
  jamás la de otro.
- Admin y supervisor eligen asesor o ven todo.
- Cada fila trae su **bucket** (fuente motor) y los **badges de recordatorios** ya enviados
  a esa cuota, incluidos los de modo prueba, marcados como tal.
- Está **paginada por sección**: los días 15 y 30 concentran ~10× el volumen de un día
  normal (medido: 681 y 550 créditos contra 200-350).

Pantalla: `/cobros/agenda`.

---

## Alertas con propósito

Reemplazan la notificación masiva de "caso sin contacto reciente", que nadie leía porque
llegaba para todo.

| Alerta | Cuándo | A quién |
| --- | --- | --- |
| `promesa_incumplida` | Justo cuando una promesa pasa a incumplida — **solo en la transición**, no todos los días | Asesor + supervisores |
| `cliente_subido` | El crédito subió de bucket anoche | Solo el asesor |
| `sin_contacto_3d` | Subió a bucket ≥ 1 y lleva 3 días hábiles sin contacto | Asesor + supervisores |

**Días hábiles con regla de oro:** lunes a viernes, **pero si el 15 o el fin de mes cae en
fin de semana, ese día sí cuenta** — son días de pago y la cartera se mueve.

El puente asesor → destinatario es por correo: el asesor de cartera (`asesor_id`) se enlaza
con el usuario del CRM comparando `asesores.email_cash_in` con el email del usuario.

Pantalla: `/cobros/notifications`, con las tarjetas coloreadas por tipo.

---

## Promesas de pago

Una promesa vigente **congela solo las cuotas prometidas**, no el crédito completo — el
resto sigue contando para el atraso.

Como las promesas viven en el CRM (`contactos_cobros`) y el motor corre en cartera, hay una
**copia local** (`promesas_pago_espejo`) que se sincroniza desde el CRM y que es lo que
`procesarMoras` consulta. Es la única forma de que el motor respete una promesa sin cruzar
bases en medio del job.

Pantalla: `/cobros/promesas`.

---

## Carga y reasignación

- **Carga por asesor y bucket** (`/cobros/carga`): cuántas cuentas lleva hoy cada asesor en
  cada bucket, contra su `capacidad_base` (default 300) para ver el % de utilización. El
  techo de 300 es **por asesor dentro de un bucket**, no del bucket completo.
- **Reasignaciones** (`/cobros/reasignaciones`): la bitácora completa de cambios de asesor,
  automáticos y manuales, con motivo.

---

## Facturación: qué quedó sin factura

Un pago puede quedar **validado pero sin factura** (SAT caído, cliente sin NIT,
porcentajes de inversionistas mal configurados) o **facturado a medias** —
un pago emite varios DTE: mora, otros servicios, otros, e intereses uno por
inversionista. Antes eso no dejaba rastro: había que abrir el modal y adivinar.

**Qué se ve ahora** (migración `0014`, 2026-08-27):

| Dónde | Qué muestra |
| --- | --- |
| Tabla de pagos | Badge **"Falta factura" / "Facturado a medias" / "Sin facturar"** junto al estado. Solo aparece cuando falta algo |
| Filtro **Facturación** | La bandeja de conta: `Falta factura (todos)`, `Sin facturar`, `Facturado a medias`, `Falló la factura`, `Facturado`, `Sin DTE que emitir` |
| Modal *Ver Facturas* | El **rubro** de cada factura emitida (y de qué inversionista), y un bloque **"Falta emitir N facturas"** con el motivo de cada una |

**De dónde sale.** `pagos_credito.factura_status`
(`NO_APLICA | PENDIENTE | OK | PARCIAL | FALLIDA`) + `factura_error` (JSON con
rubro, inversionista y motivo). Lo escriben los tres momentos que ya existen:
al **validar** (queda `PENDIENTE`, o `NO_APLICA` si el pago es solo capital —
el capital no se factura), al **facturar** (el resultado real) y al **reversar**
(`NO_APLICA`, sus facturas ya se anulan). Un `factura_status` en `NULL` es un
pago anterior a la feature: no se interpreta.

Está **separado a propósito de `validation_status`**: un pago validado sin
factura sigue siendo un pago aplicado. Meterlo en el mismo campo haría que el
cron de moras y los buckets dejaran de contar esa cuota como cubierta.

> **No se refactura solo.** No hay job ni endpoint que reintente
> (decisión de Daniel, 2026-08-27): que una factura no esté en nuestra base
> **no prueba** que no esté en SAT — el proceso pudo morir entre certificar y
> guardar. Reintentar a ciegas emite un DTE duplicado, que solo se arregla
> anulando en SAT dentro de los 5 días de gracia. Por eso la información se
> muestra y **la decisión es de conta**: verificar en SAT/COFIDI y facturar a
> mano lo que falte.
>
> Trampa conocida: "Generar Factura" hoy se bloquea si el pago ya tiene
> **alguna** factura ACTIVA, así que un pago a medias no se puede completar
> desde la UI. Con el `rubro` ya guardado, el paso natural es que ese botón
> salte los rubros ya emitidos; no está hecho.

---

## Historial y auditoría

| Pantalla | Qué muestra |
| --- | --- |
| `/cobros/buckets` | Historial de migraciones de bucket, con resumen (iniciales / subidas / **cuentas curadas**) y drill-down por crédito |
| `/cobros/reasignaciones` | Cambios de asesor |
| `/cobros/historial-agendas` | Agendas pasadas |
| `/cobros/cierre` | Cierre del día |

Todas leen del historial, no de un estado calculado — así lo que se ve siempre tiene un
evento que lo respalda.

---

## Permisos

| Rol | Ve |
| --- | --- |
| `cobros` | Su agenda, su día, el dashboard. Nunca la de otro asesor |
| `cobros_supervisor` | Todo lo de cobros + apertura, carga, reasignación manual, reducción de recordatorios, metas |
| `admin` | Todo |

Los gates son `PERMISSIONS.canAccessCobros` y `PERMISSIONS.canAssignCobros`, y se aplican
**del lado del servidor** en los procedures, no solo escondiendo botones.
