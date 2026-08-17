# 1 · Modelo de buckets

**Estado:** ✅ Implementado

---

## La idea

Un **bucket** es un nivel de atraso. No es una etiqueta que se le pone al crédito: es una
**posición** que el crédito ocupa hoy y que cambia sola cuando cambia su atraso.

Cada bucket tiene asesores asignados. Cuando el crédito cambia de bucket, cambia de
asesor. Nadie mueve nada a mano.

| | Cuotas atrasadas | Nombre | Quién lo atiende | Filosofía |
| --- | --- | --- | --- | --- |
| **B0** | 0 | Cartera Sana | Automatizado / Jr | Mantener la relación activa; recordatorios preventivos |
| **B1** | 1 | Alerta Temprana | Asesor Jr | El cliente quiere pagar; el problema suele ser logístico |
| **B2** | 2 | Gestión Activa | Asesor Sr | Diagnosticar la causa raíz; proponer un plan de pago |
| **B3** | 3 | Rescate | Asesor Sr + Supervisor | Presión + solución estructurada antes de escalar |
| **B4** | **exactamente 4** | Última Instancia / Pre Jurídico | Supervisor + Especializado | Acuerdo final o inicio de recuperación del activo |
| **B5** | **5 o más**, o INCOBRABLE | Jurídico | Supervisor + Especializado | Proceso legal de recuperación vehicular |

---

## Se mide en cuotas, no en días

El negocio habla en días —"mora 30", "mora 60", "mora 120"— pero **el sistema cuenta
cuotas**. Una cuota ≈ un mes ≈ 30 días, así que los números coinciden en la conversación,
pero la fuente de verdad es el conteo de cuotas vencidas sin pago.

Los "días de atraso" (0 / 1-30 / 31-60 / 61-90 / 91-120 / 120+) son **etiqueta de negocio**
para los reportes y para hablar con gerencia. No se calcula nada con ellos.

> ⚠️ **B4 = exactamente 4.** En el sistema viejo, `mora_120` quedó como `>= 4` (PR #1022),
> porque allá no existe B5 y había que meter a los muy atrasados en algún lado. En
> COBROS-02 **B4 y B5 se separan**: B4 es 4 exacto, B5 es 5 o más. No se copie la regla
> del sistema viejo.

---

## El catálogo es una tabla, no constantes

Los buckets viven en **`cartera.buckets`**, no en el código:

| Columna | Para qué |
| --- | --- |
| `numero` (PK, 0-5) | La identidad del bucket |
| `prefijo`, `nombre`, `descripcion` | Cómo se muestra ("B2", "Gestión Activa", la filosofía) |
| `cuotas_min`, `cuotas_max` | El rango. `cuotas_max = NULL` significa abierto (B5) |
| `estados_incluidos` (`text[]`) | Estados que **fuerzan** un bucket sin mirar cuotas (INCOBRABLE → B5) |
| `estado_mora` | Puente hacia el vocabulario viejo (`al_dia`, `mora_30`, …, `mora_120_plus`) |
| `es_operativo` | Si entra al funnel de cobro del día a día (B5 no) |
| `dias_sla` | Días para contactar desde que el crédito entra al bucket. B0 = `NULL`, no aplica |
| `color`, `orden`, `activo` | Presentación y control |

**Por qué así:** cambiar un rango, un color o un SLA es editar una fila, no desplegar. La
UI del CRM y la de cartera leen los colores y nombres de esta tabla —nada hardcodeado— y
el motor deriva los rangos de acá.

> ⚠️ **Riesgo conocido:** el `CHECK` valida que `cuotas_min <= cuotas_max` dentro de cada
> fila, pero **no evita huecos entre filas**. Si alguien desactiva B2, un crédito con 2
> cuotas queda sin bucket **en silencio**. Editar el catálogo con cuidado.

---

## Qué queda fuera del funnel

No todo crédito tiene bucket. Tres situaciones distintas:

| Situación | Estados | Qué pasa |
| --- | --- | --- |
| **Terminado** | `CANCELADO`, `PENDIENTE_CANCELACION`, `CAIDO` | Fuera del juego. Ni bucket ni mora ni asesor |
| **Legal** | `INCOBRABLE` | **B5.** Sale del cobro operativo y pasa a recuperación legal. Ya no se le calcula mora |
| **Negociado** | `EN_CONVENIO` | **Carril aparte.** Sí tiene bucket, pero lo lleva otro job y se mide distinto — ver [convenios](./02-motor-y-asignacion.md#convenios-un-carril-aparte) |

El mecanismo de "fuera del funnel" ya existía antes de COBROS-02: el motor de moras
excluye esos estados, así que **"sin mora" ya era sinónimo de "fuera del cobro
operativo"**. El bucket respeta eso en vez de inventar una regla nueva.

---

## Cómo se lee el bucket de un crédito

Hay **dos fuentes** y la diferencia importa:

| Fuente | Qué es | Cuándo se usa |
| --- | --- | --- |
| **Motor** | El último evento de `buckets_historial` | **Por defecto en todos lados.** El bucket solo cambia cuando el job registra la transición (con su reasignación de asesor) |
| **Viva** | Derivar en el momento de `statusCredit` + mora activa | Solo como fallback para créditos que nunca pasaron por el motor (sin fila `INICIAL`) |

**Por qué el motor y no la derivación viva:** cuando un cliente paga, `procesarPagoMora`
apaga la mora al instante. Si el listado derivara en vivo, ese crédito aparecería en B0 de
inmediato —un bucket fantasma— aunque nadie lo haya reasignado ni haya quedado registro de
la bajada. Con la fuente motor, **el bucket no se mueve sin evento**: lo que se ve en
pantalla siempre tiene una fila que lo respalda y un asesor que lo recibió.

---

## Lo que este modelo permite medir

El modelo se diseñó para medir **gestión, no monto** (decisión de negocio: el monto
depende del tamaño del crédito, la gestión depende del asesor):

- **Cuentas curadas** = cuántas `BAJADA` hubo. Es el KPI principal.
- **Bucket Migration Rate** = `SUBIDA` vs `BAJADA`, la salud de la cartera en movimiento.
- **Primer contacto ≤ 48 h en B1** = fecha de entrada al bucket cruzada con los contactos.

Todo eso sale de `buckets_historial` sin cálculos aparte, que es precisamente por lo que
la bitácora existe. Ver [motor y asignación](./02-motor-y-asignacion.md).
