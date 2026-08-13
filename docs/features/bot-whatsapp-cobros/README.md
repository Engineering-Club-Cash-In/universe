# Bot de WhatsApp — Flujo de cobros

**Estado global:** 🟡 En definición · **Nada de esto está implementado todavía**
**Última actualización:** 2026-08-13
**Proyecto Jira:** [CC2 — CRM Cobros 2](https://clubcashin.atlassian.net/browse/CC2)
**Fuente funcional:** [`fuente/flujo-bot-whatsapp.pdf`](./fuente/flujo-bot-whatsapp.pdf) (v1.0, agosto 2026)

---

## Qué es

Un asistente de autoservicio en WhatsApp para clientes **con crédito activo**: se
identifican, consultan su crédito, pagan, suben boleta, negocian convenios y dejan
promesas de pago, sin pasar por un asesor.

El bot vive en **SimpleTech** (la plataforma donde ya está el bot de ventas). Nosotros
no construimos el bot: construimos los **endpoints que el bot consume**. El CRM es el
punto de acceso único; cartera-back es la fuente de verdad del crédito.

## Por qué este documento existe

El flujo completo son 6 secciones del PDF y decenas de historias en el sprint. Se va a
construir **por pasos, a lo largo de varios sprints, tocando varias apps del monorepo**.
Esta carpeta es la memoria compartida del feature: lo que ya se decidió, lo que falta
decidir y el contrato exacto de cada endpoint. Si algo no está escrito acá, no está
decidido.

## Mapa de archivos

| Archivo | Para qué sirve |
| --- | --- |
| [`00-arbol-de-decisiones.md`](./00-arbol-de-decisiones.md) | El flujo completo del PDF transcrito, con diagramas. Es la referencia funcional; **no se cambia sin acuerdo con Cobros**. |
| [`ARQUITECTURA.md`](./ARQUITECTURA.md) | Cómo se integran SimpleTech ↔ CRM ↔ cartera-back. Auth, versionado, formato de respuestas, sesiones, errores, observabilidad. Aplica a todos los pasos. |
| [`01-identificacion-y-acceso.md`](./01-identificacion-y-acceso.md) | **Paso 1** (el que se está definiendo hoy): identificación, validación de identidad y selección de crédito. |
| [`DECISIONES.md`](./DECISIONES.md) | Registro de decisiones: abiertas, cerradas y por qué. |
| `fuente/` | El PDF original de gerencia. |

## Pasos del feature

| # | Paso | Alcance | Estado | Doc |
| --- | --- | --- | --- | --- |
| 1 | Identificación y acceso | Menú general → identificación (NIT/DPI/placa) → validación de identidad → lista de créditos | 🟡 **En definición** | [`01-…`](./01-identificacion-y-acceso.md) |
| 2 | Menú del crédito | Info del crédito, y el ruteo a las 6 gestiones | ⚪ Pendiente | — |
| 3 | Métodos de pago | Link de Pagalo, subir boleta, transferencia Nexa | ⚪ Pendiente | — |
| 4 | Validación de boleta | OCR, confirmación, pendiente de conciliación, notificación | ⚪ Pendiente | — |
| 5 | Convenio y promesa de pago | Selección de rubros, plazo, documento | ⚪ Pendiente | — |
| 6 | Reglas transversales | Excedentes, notificaciones, escalamiento a agente | ⚪ Pendiente | — |

> El orden de construcción no tiene por qué ser el orden del árbol, pero el Paso 1 es
> prerrequisito de todos: sin identidad verificada no se puede exponer ningún dato.

## Relación con el sprint (CC2 · Sprint 16)

| Ticket | Historia | Cubierto por |
| --- | --- | --- |
| [CC2-48](https://clubcashin.atlassian.net/browse/CC2-48) | CB-115 · Árbol decisional del bot de CashIn | Este documento + `00-arbol-de-decisiones.md` |
| [CC2-39](https://clubcashin.atlassian.net/browse/CC2-39) | CB-103 · Consultar crédito validando DPI + placa/número | **Paso 1** |
| [CC2-40](https://clubcashin.atlassian.net/browse/CC2-40) | CB-104 · Plan de pagos, saldos y cuotas desde WhatsApp | Paso 2 |
| [CC2-41](https://clubcashin.atlassian.net/browse/CC2-41) | CB-105 · Link de pago con tarjeta | Paso 3 |
| [CC2-42](https://clubcashin.atlassian.net/browse/CC2-42) | CB-106 · Instrucciones de transferencia | Paso 3 |
| [CC2-43](https://clubcashin.atlassian.net/browse/CC2-43) | CB-107 · Enviar comprobante en el chat | Paso 4 |
| [CC2-44](https://clubcashin.atlassian.net/browse/CC2-44) | CB-108 · Pago pendiente de conciliación | Paso 4 |
| [CC2-45](https://clubcashin.atlassian.net/browse/CC2-45) | CB-109 · Conciliación automática | Paso 4 |
| [CC2-46](https://clubcashin.atlassian.net/browse/CC2-46) | CB-110 · Ver interacciones del bot en el CRM | Transversal |
| [CC2-22](https://clubcashin.atlassian.net/browse/CC2-22) | CB-100 · Número de WhatsApp independiente para cobranza | Prerrequisito de infraestructura |

## Glosario

| Término | Significado |
| --- | --- |
| **SimpleTech** | Proveedor/plataforma donde corre el bot de WhatsApp. Ya se usa para envíos salientes desde el CRM (`packages/simpletech`, `apps/crm/apps/server/src/lib/simpletech.ts`). |
| **CRM** | `apps/crm`. Dueño de la identidad del cliente (lead, teléfonos, DPI, NIT, vehículo) y punto de acceso del bot. |
| **cartera-back** | `apps/cartera-back`. Dueño del crédito: capital, cuotas, mora, pagos, convenios. |
| **`numero_credito_sifco`** | El puente entre ambos mundos: `opportunities.numero_sifco` (CRM) ↔ `creditos.numero_credito_sifco` (cartera). |
| **Bucket / B0…B4** | Segmentación de mora usada por Cobros (B0 = al día / preventivo). |
| **Sesión de bot** | Contexto temporal creado al identificarse el cliente; sin ella no se sirve ningún dato. Ver `ARQUITECTURA.md`. |

## Cómo trabajar este feature

1. **Definir antes de programar.** Cada paso arranca con su documento; el código viene
   después de que el contrato esté cerrado y las decisiones bloqueantes resueltas.
2. **Un paso a la vez.** Se cierra el Paso N (definición → implementación → pruebas con
   SimpleTech) antes de abrir el N+1, salvo trabajo que no dependa de identidad.
3. **Las decisiones van a `DECISIONES.md`,** con opciones descartadas y motivo. Si algo
   se decide en una llamada, se escribe acá el mismo día.
4. **El PDF manda en lo funcional.** Si la implementación necesita desviarse del árbol,
   se registra la desviación en `DECISIONES.md` y se valida con Cobros/Gerencia.
5. **Los contratos son la interfaz con un tercero.** Un cambio en un endpoint ya
   publicado a SimpleTech es un cambio de versión, no un ajuste silencioso.
