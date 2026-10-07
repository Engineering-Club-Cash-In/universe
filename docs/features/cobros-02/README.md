# COBROS-02 · Rediseño de cobros

**Estado:** 🔵 En desarrollo · versión aislada, sale en meses
**Rama base:** `COBROS-02` (NO pasa por `develop`; las feature branches salen de ahí y su PR va de vuelta ahí)
**Apps que toca:** `apps/crm` (server + web) · `apps/cartera-back` · el bot de WhatsApp de SimpleTech

> [!IMPORTANT]
> **COBROS-02 todavía NO va a PROD.** Es una versión paralela que sale en un pase masivo, a fin de año o en un mes, cuando se decida.
> - Todo se corre y se prueba en **DEV**, migraciones incluidas.
> - En los PR, issues y docs de COBROS-02 **no se piden pasos en PROD** (nada de «antes de desplegar, correr X en PROD»). Las migraciones pendientes para PROD se juntan para el pase masivo.
> - Si una migración falta en DEV, se corre en DEV y se anota en el doc de la etapa.

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
| 4 | [Operación diaria](./04-operacion-diaria.md) | Apertura, cola del día, SLA, agenda, alertas, promesas y convenios, reasignación manual |
| 5 | [Datos y ambientes](./05-datos-y-ambientes.md) | Dónde vive cada base, el sandbox `cartera_cobros2`, migraciones, trampas conocidas |
| 6 | [Ficha 360 del crédito](./06-ficha-360.md) | La pantalla de trabajo del asesor: anatomía, fuentes de datos, registro de contactos, promesa y convenio de pago, estado de cuenta y decisiones |
| 7 | [Recuperación de vehículo](./07-recuperacion-de-vehiculo.md) | El traslado manual a B4: por qué es la única decisión humana de bucket, sus dos envíos (CB-042) y la solicitud con checklist que aprueba el supervisor (CB-043) |
| 8 | [**Plan** · Convenios y `EN_RECUPERACION`](./08-plan-convenios-y-recuperacion.md) | Lo acordado con el PM el 10-sep: el convenio congela el bucket, el estado nuevo actúa como piso en B4, y las 4 fases pendientes |
| 9 | [Integración GPS / Wialon (La Legión)](./09-integracion-gps-wialon.md) | Rastreo satelital en vivo, telemetría (odómetro, ignición), generación y revocación de links Locator para recuperación de unidades |
| 10 | [Visitas a residencia y trabajo](./10-visitas.md) | CB-037/038: programar y registrar visitas de B2 a B4, con fotos desde el celular; el resultado abre la promesa o la entrega voluntaria |
| 11 | [Investigación en redes sociales](./11-investigacion-redes-sociales.md) | CB-039: registrar fuente, hallazgos y capturas de lo que se encuentra del cliente en redes; solo B2 y B3 (configurable) |
| 12 | [Guía de redacción](./12-guia-de-redaccion.md) | Cómo se escriben los textos del CRM de cobros: trato de usted, etiquetas con sustantivos, términos del negocio. Revisarla antes de agregar pantallas o mensajes |
| 13 | [Dashboard del asesor y Mi Cartera · backend pendiente](./13-dashboard-asesor-backend.md) | Rediseño del Figma (Asesor Junior/Senior): qué quedó conectado y las tareas de backend para José (recuperación y metas por asesor, deuda vencida, orden por bucket del motor, pagos por confirmar, referencias, hora del próximo contacto) |
| 14 | [Rediseño del asesor · Dashboard y Mi Cartera (front)](./14-rediseno-dashboard-asesor.md) | Etapa 1 del rediseño Figma Asesor Junior/Senior (PR #1861): reglas de producto, qué quedó, cómo está armado, pendientes y la etapa 2 (Workspace y Ficha 360) |
| 15 | [Ficha 360 rediseñada · backend pendiente](./15-ficha-360-backend.md) | Etapa 2 del rediseño Figma: Ficha 360 conectada; tareas F1–F8 para José (RENAP, codeudores, historial de cambios, histórico del crédito, seguro, documentos, asistente IA, editar direcciones) |
| 16 | [Workspace de cobros · backend pendiente](./16-workspace-backend.md) | Etapa 3 del rediseño Figma: el «Espacio de trabajo» de dos paneles conectado; tareas W1–W5 para José (dirección y participante de la gestión, rebaja de mora, escalar a Jurídico, abono en el convenio, alertas leídas con job de 30 días) |
| 17 | [Supervisión de cobros · backend pendiente](./17-supervision-backend.md) | Fase 1 del rediseño del supervisor (Figma Dashboard · Supervisor y Cartera general): qué quedó conectado y las tareas S1–S6 para José (pendientes sin fuente, sin contacto del equipo, KPIs del equipo por período, columnas de la tabla Equipo, filtros y paginación de la Cartera general, reasignación en bloque) |
| — | [**Runbook · Refrescar el sandbox**](./RUNBOOK-refrescar-sandbox.md) | Cómo poner el sandbox al día con producción sin perder el historial. Es también el ensayo del pase a producción |

Y aparte, con documentación propia:

- [**Bot de WhatsApp de cobros**](../bot-whatsapp-cobros/README.md) — el autoservicio del
  cliente. Es parte de COBROS-02: el cliente resuelve por WhatsApp lo que hoy ocupa
  llamadas del asesor, y libera al asesor para los buckets donde su tiempo rinde.

- [**Págalo · pagos con link**](../pagalo/README.md) — cobrar por link (desde la Ficha 360
  y desde el bot). El pago entra a cartera **validado en una sola transacción**, y la
  factura y el recibo salen después del commit
  ([D-10](../pagalo/DECISIONES.md#d-10--importación-págalo-registra-y-valida-en-una-transacción-factura-y-recibo-post-commit)).

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
│  · convenio_operaciones (idempotencia) · convenio_decisiones (bitácora,      │
│    append-only, por credito_id — CB-033)                                    │
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
| La asignación vive solo en cartera | ✅ El CRM ya no asigna: acceso a la ficha, listados, avisos y reportes salen del dueño en cartera (o de quien lo cubre hoy). Migraciones CRM `0066` (antes del deploy) y `0067` (después). Ver [doc 2](./02-motor-y-asignacion.md#el-crm-no-asigna-2026-09-28) |
| Buckets de créditos en convenio | ✅ Implementado (job aparte, 00:30 GT) |
| Recordatorios premora D-5…D-0 | ✅ Implementado · se activa con env |
| Recordatorios de convenio | ✅ Implementado · se activa con env |
| Reducción de recordatorios (CB-010) | ✅ Implementado |
| Alertas de cobros con propósito | ✅ Implementado |
| Apertura / Cola del día / SLA / Agenda | ✅ Implementado |
| Bot de WhatsApp | 🔵 Paso 1 (identificación) desplegado en dev; pasos 2-4 pendientes |
| Pagos con link de Págalo | 🔵 Ficha 360 y bot generan links; el pago entra validado a cartera. Facturación automática **apagada** hasta poner `PAGALO_FACTURACION_ACTIVA=true` |
| Visibilidad de la facturación | ✅ Estado por pago y rubro por factura — ver [Operación diaria](./04-operacion-diaria.md#facturación-qué-quedó-sin-factura). **No refactura solo**, por diseño |
| Convenio de pago **desde la Ficha 360** (CB-032) | ✅ Implementado — botón "Promesa / Convenio", solo B2+ y cuotas vencidas + actual; carteraFront quedó de consulta. Ver [Ficha 360 §3.4](./06-ficha-360.md#34-convenio-de-pago-cb-032) |
| Aprobación de convenios por supervisor (CB-033) | ✅ Implementado — convenio nace pendiente, `cobros_supervisor`/`admin` aprueba o rechaza **solo desde el CRM** con motivo obligatorio, bitácora append-only en cartera indexada por crédito (sobrevive al DELETE del rechazo). carteraFront quedó de consulta (sin botones de decisión); `CONTA` ya no decide. Ver [Ficha 360 §3.5](./06-ficha-360.md#35-aprobación-de-convenios-cb-033) |
| Convenio y promesa **por el bot** | 🔴 Bloqueado — falta aprobación de gerencia |
| Traslado masivo de cartera (CB-114) | ✅ Implementado — preview + confirmación idempotente, 3 modos. Ver [motor y asignación](./02-motor-y-asignacion.md#traslado-masivo-de-cartera-cb-114) |
| Coberturas temporales (CC2-23) | ✅ Implementado — vacaciones y permisos redirigen el día **sin mover la cartera** |
| Sandbox al día con producción | ✅ Scriptado y a demanda: `alinear_desde_prod.sh`. Corre el motor, así que las bajadas de quien ya pagó quedan registradas. Ver [datos y ambientes](./05-datos-y-ambientes.md#poner-el-sandbox-al-día-con-producción) |
| Recuperación de vehículo (traslado a B4) | ✅ Se sostiene con `EN_RECUPERACION` ([plan 08](./08-plan-convenios-y-recuperacion.md)). Desde CB-042, dos envíos —recuperación del vehículo y **entrega voluntaria** (también desde B4)— con formulario, foto del saldo, ubicación desde el GPS, aviso al asesor de B4 y supervisores, y recepción de la unidad en B4. Desde CB-043 la recuperación es una **solicitud con checklist** que aprueba otro supervisor o admin (nadie aprueba la suya) (pantalla Cobros → Solicitudes → Recuperación de vehículo); ambos envíos, de B2 a B3. Migraciones CRM `0065` y `0071` pendientes en prod. Ver [doc 7](./07-recuperacion-de-vehiculo.md#la-solicitud-y-la-aprobación-cb-043) |
| Convenios que no bajan de bucket | 🔵 Acordado, sin implementar. Hoy el job hace lo CONTRARIO (un convenio nuevo cae a B0). [Doc 8, fase 2](./08-plan-convenios-y-recuperacion.md) |
| Referencias y contactos de emergencia (CB-036) | ✅ Implementado — seis fuentes juntas (cobros, ventas, cónyuge, emergencia, cofirmantes), bitácora de gestiones, teléfonos agregados e información nueva del cliente. Migración CRM `0060` pendiente en prod. Ver [Ficha 360 §4.c](./06-ficha-360.md#4c-referencias-y-contactos-de-emergencia-cb-036) |
| Visitas a residencia y trabajo (CB-037/038) | ✅ Implementado — botón propio de B2 a B4, programar o registrar, fotos desde el celular, avisos al responsable; el resultado abre la promesa o la entrega voluntaria de CB-042. Datos laborales de la solicitud en la tarjeta de contacto. Migración CRM `0069` pendiente en prod. Ver [doc 10](./10-visitas.md) |
| Investigación en redes sociales (CB-039) | ✅ Implementado en código — tarjeta en la pestaña Referencias, bitácora con capturas, solo B2 y B3 (lista configurable en un solo lugar). Migración CRM `0073` pendiente. Falta validar privacidad con Legal. Ver [doc 11](./11-investigacion-redes-sociales.md) |
| Carga inicial en producción | ⚪ Pendiente — mismo runbook, pero **sin replay**: línea base limpia |

---

## Advertencia mientras dure la rama

En `COBROS-02` las **tareas programadas del CRM están apagadas en el código**
(`const TAREAS_PROGRAMADAS_ACTIVAS = false` en `index.ts`, con un `FIXME` a la vista).
Es a propósito: la instancia de dev apunta a una copia de producción y sin eso le
mandaría recordatorios reales a clientes reales en cada despliegue.

**Hay que revertirlo antes de mergear a `develop`.** Si se mergea así, el CRM de
producción se queda sin ninguna tarea programada y no se nota al desplegar: se nota
cuando los clientes dejan de recibir sus recordatorios.
