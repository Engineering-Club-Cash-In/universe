# 8 · Plan · Convenios que no bajan de bucket + estado `EN_RECUPERACION`

**Estado:** 🔵 Acordado con el PM el **2026-09-10**. La Fase 0 ya está hecha; las
Fases 1 a 4 **no están implementadas**.
**Depende de:** [7 · Recuperación de vehículo](./07-recuperacion-de-vehiculo.md) — este
documento **resuelve** la pregunta abierta que quedó ahí.

---

## De qué se trata

Dos reglas que hoy el sistema no cumple, y que salen de la misma idea: **el bucket dejó
de ser una función pura del atraso**. Hay dos situaciones donde una decisión humana pesa
más que las cuotas vencidas, y en las dos el crédito debe quedarse quieto y con su asesor:

1. **Convenio.** Al firmarlo, el crédito **no baja de bucket ni cambia de asesor**. Se
   queda ahí hasta que se pague completo o alguien lo deshaga a mano.
2. **Recuperación de vehículo.** El botón de la Ficha 360 lo manda a B4 y le pone el
   estado `EN_RECUPERACION`, que actúa como **piso**: nunca baja de B4.

---

## Decisiones cerradas

| # | Decisión |
| --- | --- |
| 1 | El estado se llama **`EN_RECUPERACION`** |
| 2 | **Sí devenga mora** mientras está en el estado |
| 3 | Con 2, 3 o 4 cuotas se queda en **B4**. Con la **5ª sube a B5 solo**, conservando el estado |
| 4 | **El convenio manda sobre el estado.** Un convenio creado desde B4 se queda en B4, y ningún pago del convenio levanta el estado |
| 5 | El estado se levanta solo si paga **el total de lo que debe, sin convenio**, al **validarse** el pago |
| 6 | **No hay botón de "pasar a jurídico".** Volverse `INCOBRABLE` pasa por contabilidad |
| 7 | Las notificaciones van al **asesor** y a **`cobros_supervisor`** |
| 8 | **Sin días de gracia.** Todo lo dispara una persona |
| 9 | El convenio **congela bucket y asesor** hasta que se pague o se deshaga |
| 10 | Deshacer un convenio es **soft delete**, no borrado |

> ⚠️ **Anotado para revisar con el PM.** Puede que después decidan que con 5 cuotas **no**
> suba solo a B5 y que la única forma de llegar sea el botón. En ese escenario **la mora
> tampoco correría**. Quedó escrito para no re-discutirlo desde cero.

---

## El hallazgo que define la implementación: piso, no clavo

La primera idea fue meter `EN_RECUPERACION` en `buckets.estados_incluidos` de B4, el mismo
mecanismo que hoy manda `INCOBRABLE` a B5. **No sirve**, y la decisión 3 es la razón: ese
mecanismo *clava*, y un crédito clavado en B4 nunca podría subir a B5 con la 5ª cuota.

Lo que hace falta es un **piso**:

```
bucket = max(bucket por cuotas atrasadas, 4)   mientras esté EN_RECUPERACION

   2 cuotas → max(B2, B4) = B4        4 cuotas → max(B4, B4) = B4
   3 cuotas → max(B3, B4) = B4        5 cuotas → max(B5, B4) = B5   ← sube solo
```

Nunca baja de B4, sube cuando toca, y sale del piso cuando se levanta el estado. Es un
mecanismo **nuevo** en el catálogo (un "bucket mínimo por estado"), no el que ya existe.

### Supuesto sobre "paga el total de lo que debe"

Se implementa como: **el estado se levanta cuando el crédito queda sin cuotas vencidas**
(es decir, cuando el bucket derivado daría B0), evaluado en la **validación** del pago —
no en el registro, porque una boleta se sube hoy y contabilidad la valida después.

Con ese criterio la **mora pendiente no bloquea** la salida: si pagó todas las cuotas pero
quedó debiendo mora, sale de recuperación igual. **Falta confirmarlo con el PM.**

---

## Lo que ya existe hoy (investigado el 2026-09-10, para no re-derivarlo)

- **El job de convenios existe**: `procesarBucketsConvenio`, 00:30 GT, advisory lock 728194.
  Es el dueño único de los buckets de los `EN_CONVENIO` porque el motor de mora los excluye.
  Mide **meses atrasados** uniendo cuotas del crédito y del convenio por fecha de
  vencimiento (deber ambas del mismo mes cuenta 1, no 2).
- **Hoy hace lo contrario a la decisión 9**: la función `nacioConElConvenio` implementa
  "borrón y cuenta nueva", así que **un convenio recién hecho cae a B0** y se lo lleva el
  asesor de B0. El comentario en el código dice "regla de negocio, NO se mueve" — la
  Fase 2 la invierte.
- **El aviso al asesor NO existe.** Los recordatorios de convenio van al **cliente** por
  WhatsApp (D-5/D-3/D-1/D-0, detrás de `CONVENIO_WHATSAPP_ENABLED`). La agenda del día
  filtra `statusCredit IN ('ACTIVO','MOROSO','INCOBRABLE')` en
  `cuotasProximas.ts` — **`EN_CONVENIO` queda fuera**, por eso al asesor no le aparece la
  cuota de convenio que vence. Y `cobros_notif_tipo` no tiene ningún tipo de convenio.
- **Deshacer convenio existe pero borra y vive en carteraFront**: `updateConvenioStatus`
  (`paymentAgreement.ts`) **elimina** las filas de `convenio_cuotas`, el pivot y
  `convenios_pago`, recrea la mora y deja el crédito `MOROSO`. El CRM no consume ese
  endpoint.
- **La mora es por CUOTA, no por día**: `capital × 1.12% × cuotas_atrasadas`
  (`latefee.ts:442`). Una cuenta parada tres meses en B4 sin cruzar un vencimiento nuevo
  **no acumula un centavo más** — solo crece cuando cae una cuota.
- **`statusCredit` es una columna `text`**, no un enum de Postgres: agregar un valor no
  pide migración de columna, pero **nada en la base rechaza un valor inválido** y hay
  ~90 listas de estados escritas a mano en ~45 archivos.
- **Salida por completado ya funciona**: al pagar la última cuota el convenio se completa,
  el crédito sale a `ACTIVO` y el motor de mora lo manda a B0 en la corrida de las 23:59.

---

## Las fases

### ~~Fase 0 · Navegación~~ ✅ hecha (2026-09-10)

"Mi día" ya no se pinta para admin/supervisor: en su lugar va **Cola del día**, y
`/cobros/mi-dia` los redirige en vez de mostrarles un cartel sin salida.

### Fase 1 · Avisos — aditiva, no mueve ningún crédito

La que más valor da por lo que cuesta. Nada de esto toca un bucket.

- Tipo nuevo en el enum `cobros_notif_tipo` (migración del CRM) para convenio incumplido.
- Job que detecta cuotas de convenio vencidas e impagas y notifica **al asesor y al
  supervisor**.
- Meter `EN_CONVENIO` al filtro de estados de la agenda del día (`cuotasProximas.ts`).
- Pantalla **Alertas de Convenios**, calcada de `/cobros/promesas`: las mismas cuatro
  tarjetas (Vencidas · Vencen hoy · Por vencer · Próximas) + ítem en el menú.
- La señal de convenio vencido/por vencer en la Cola del día.

### Fase 2 · Congelar el convenio — invierte la regla vieja

- Se va `nacioConElConvenio` y el borrón y cuenta nueva.
- El job de convenios deja de mover buckets: pasa a **vigilante** (calcula el atraso solo
  para alertar). Bucket y asesor quedan donde estaban al firmar.
- **Pendiente de decidir:** hay ~63 créditos `EN_CONVENIO` que el job ya movió con la regla
  vieja, repartidos entre B0 y B5. ¿Se quedan donde están o se recalculan? Probablemente
  hace falta un script de una sola corrida.

### Fase 3 · Ficha 360 — banda roja y acciones

- Sacar "Recuperación de vehículo" del dropdown de **Más acciones** y darle un lugar fijo
  y visible en la fila de acciones.
- Banda roja arriba cuando: (a) hay convenio activo con cuota vencida impaga, o
  (b) está `EN_RECUPERACION` y ya acumuló 5 cuotas.
- **Tres** acciones (la de jurídico se cayó por la decisión 6):
  - Deshacer convenio
  - Deshacer convenio y mandar a recuperación (B4)
  - Mandar a recuperación (B4) — **habilitado solo en B1–B3**
- **Soft delete** del convenio: columnas nuevas (`anulado_at`, `anulado_por`, `motivo`) y
  migración de cartera. Ojo: carteraFront consume el mismo endpoint, el cambio se ve allá.

### Fase 4 · El estado `EN_RECUPERACION` — la invasiva, de último

- El **piso** en B4 (mecanismo nuevo, ver arriba).
- El levantamiento del estado al **validarse** un pago que deja el crédito sin cuotas
  vencidas.
- La **precedencia del convenio** por encima del estado (decisión 4).
- El triaje de las ~90 listas de estados escritas a mano, una por una, marcando cuáles
  necesitan visto bueno de contabilidad.

---

## Lo que sigue sin definirse

1. **¿"El total de lo que debe" incluye la mora?** (ver el supuesto de arriba).
2. **¿Qué pasa con los ~63 convenios que el job ya movió** con la regla vieja?
