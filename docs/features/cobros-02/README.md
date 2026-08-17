# COBROS-02 · Rediseño de cobros

**Estado:** 🔵 En desarrollo · versión aislada, sale en meses
**Rama base:** `COBROS-02` (NO pasa por `develop`; las feature branches salen de ahí y su PR va de vuelta ahí)
**Apps que toca:** `apps/crm` (server + web) · `apps/cartera-back` · el bot de WhatsApp de SimpleTech

---

## Qué es

Un rediseño de **cómo cobran los asesores**, no un ajuste de pantallas. El cambio de
fondo cabe en una línea:

> Hoy el asesor es dueño de una **cartera** (una lista fija de créditos).
> En COBROS-02 el asesor es dueño de un **bucket**, y el crédito **fluye entre buckets**
> —y por lo tanto entre asesores— conforme cambia su atraso.

De ahí sale todo lo demás: si el crédito se mueve solo, hace falta un motor que lo mueva,
una bitácora de por dónde pasó, un asesor que lo reciba, recordatorios que salgan sin que
nadie los mande, y una rutina diaria construida sobre esa cola.

**Por qué importa el cambio:** especialización (quien atiende B1 —el que se le olvidó
pagar— no hace lo mismo que quien atiende B4 —el que va camino a jurídico—) y
accountability medible (un asesor responde por su bucket, no por una lista heredada).

---

## Los documentos

| # | Documento | De qué trata |
| --- | --- | --- |
| 1 | [Modelo de buckets](./01-modelo-de-buckets.md) | Qué es un bucket, los seis niveles, cómo se mide el atraso, qué queda fuera del funnel |
| 2 | [Motor y asignación](./02-motor-y-asignacion.md) | Cómo se deriva el bucket, la bitácora de transiciones, la reasignación automática de asesor |
| 3 | [Recordatorios automáticos](./03-recordatorios-automaticos.md) | Premora D-5…D-0, recordatorios de convenio, reducción para quien paga bien (CB-010) |
| 4 | [Operación diaria](./04-operacion-diaria.md) | Apertura, cola del día, SLA, agenda, alertas, promesas, reasignación manual |
| 5 | [Datos y ambientes](./05-datos-y-ambientes.md) | Dónde vive cada base, el sandbox `cartera_cobros2`, migraciones, trampas conocidas |

Y aparte, con documentación propia:

- [**Bot de WhatsApp de cobros**](../bot-whatsapp-cobros/README.md) — el autoservicio del
  cliente. Es parte de COBROS-02: el cliente resuelve por WhatsApp lo que hoy ocupa
  llamadas del asesor, y libera al asesor para los buckets donde su tiempo rinde.

---

## El mapa: qué vive dónde

Esta es la pregunta que más cuesta cuando alguien entra al feature, porque la
funcionalidad está partida entre dos apps con bases de datos distintas.

```
┌─────────────────────────── cartera-back (Elysia) ────────────────────────────┐
│  Es el dueño del DINERO y del ATRASO.                                        │
│                                                                              │
│  · creditos, cuotas_credito, pagos_credito, moras_credito                    │
│  · buckets (catálogo) · buckets_historial · asesor_bucket                    │
│  · credito_asesor_historial · convenios_pago / convenio_cuotas               │
│  · EL MOTOR: procesarMoras (23:59 GT) deriva el bucket y reasigna asesor     │
│  · Jobs: buckets de convenio (00:30), cierre mensual (02:00), efectividad    │
│  · Expone: /buckets/*, /cuotas/proximas-vencer, /moras/*                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                       HTTP (cartera-back-client.ts)
                                     │
┌────────────────────────────── crm (Hono + ORPC) ─────────────────────────────┐
│  Es el dueño de la GESTIÓN y del CLIENTE.                                    │
│                                                                              │
│  · casos_cobros, contactos_cobros, seguimientos, promesas, convenios (UI)    │
│  · leads (teléfono, DPI, NIT) · notifications · cobros_send_logs             │
│  · recordatorios_premora · recordatorios_convenio · premora_reduccion        │
│  · Jobs: premora 08:00 · convenio 08:05 · elegibilidad CB-010 07:00 ·        │
│    alertas de cobros 08:00                                                   │
│  · TODO el WhatsApp sale de acá (SimpleTech); cartera-back solo da datos     │
│  · Pantallas: /cobros/* (dashboard, apertura, cola, agenda, buckets, …)      │
└──────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                          API con API key (D-18)
                                     │
                        Bot de WhatsApp (SimpleTech)
```

**La regla:** cartera-back **calcula**, el CRM **gestiona y comunica**. Si algo tiene que
ver con cuánto debe o qué tan atrasado va → cartera-back. Si tiene que ver con a quién se
le habla, cuándo y por dónde → CRM. El bot solo habla con el CRM
([D-01](../bot-whatsapp-cobros/DECISIONES.md)).

---

## Cómo se trabaja este feature

| Regla | Detalle |
| --- | --- |
| **Rama** | Feature branch **desde `COBROS-02`**, PR **hacia `COBROS-02`**. Nunca a `develop` ni a `main` |
| **Migraciones de cartera** | Van agrupadas en `apps/cartera-back/drizzle/cobros-02/`, SQL a mano idempotente. Cartera no usa `drizzle-kit` para esto |
| **Migraciones del CRM** | `apps/crm/apps/server/src/db/migrations/`, numeradas a mano (el journal de drizzle está desactualizado desde la 0018) |
| **Quién las corre** | **El usuario.** Se dejan listas y se espera; nunca `bun run db:push/migrate` |
| **Pruebas** | Contra el sandbox `cartera_cobros2`, no contra `cartera`. Ver [datos y ambientes](./05-datos-y-ambientes.md) |
| **Textos** | Todo en español, de cara al cliente y de cara al asesor |

---

## Estado por pieza

| Pieza | Estado |
| --- | --- |
| Motor de buckets + historial | ✅ Implementado y probado E2E |
| Catálogo dinámico de buckets | ✅ Implementado (rangos, colores, SLA, estados, todo en tabla) |
| Reasignación automática de asesor | ✅ Implementado (automática por el motor + manual por el supervisor) |
| Buckets de créditos en convenio | ✅ Implementado (job aparte, 00:30 GT) |
| Recordatorios premora D-5…D-0 | ✅ Implementado · se activa con env |
| Recordatorios de convenio | ✅ Implementado · se activa con env |
| Reducción de recordatorios (CB-010) | ✅ Implementado |
| Alertas de cobros con propósito | ✅ Implementado |
| Apertura / Cola del día / SLA / Agenda | ✅ Implementado |
| Bot de WhatsApp | 🔵 Paso 1 (identificación) desplegado en dev; pasos 2-4 pendientes |
| Convenio y promesa **por el bot** | 🔴 Bloqueado — falta aprobación de gerencia |
| Carga inicial en producción | ⚪ Pendiente — ver [datos y ambientes](./05-datos-y-ambientes.md) |

---

## Advertencia mientras dure la rama

En `COBROS-02` las **tareas programadas del CRM están apagadas en el código**
(`const TAREAS_PROGRAMADAS_ACTIVAS = false` en `index.ts`, con un `FIXME` a la vista).
Es a propósito: la instancia de dev apunta a una copia de producción y sin eso le
mandaría recordatorios reales a clientes reales en cada despliegue.

**Hay que revertirlo antes de mergear a `develop`.** Si se mergea así, el CRM de
producción se queda sin ninguna tarea programada y no se nota al desplegar: se nota
cuando los clientes dejan de recibir sus recordatorios.
