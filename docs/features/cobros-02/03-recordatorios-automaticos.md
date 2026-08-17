# 3 · Recordatorios automáticos

**Estado:** ✅ Implementado · se activan con variables de entorno
**Vive en:** `apps/crm/apps/server/src/services/send-premora-reminders.ts` · `send-convenio-reminders.ts` · `refresh-premora-elegibilidad.ts` · datos en `apps/cartera-back/src/controllers/cuotasProximas.ts` y `convenioProximos.ts`

---

## La idea

Antes, todo recordatorio salía porque un asesor se acordó. Ahora el sistema avisa solo,
**antes** de que la cuota venza, y el asesor se dedica a quien ya se atrasó.

```
D-5 ──── D-3 ──── D-1 ──── D-0 ──── vence la cuota
 │        │        │        │
 └────────┴────────┴────────┴─── WhatsApp automático, 08:00 GT
```

**Por qué WhatsApp y no SMS:** es el canal que ya mueve miles de mensajes en el CRM. Los
mensajes salen por SimpleTech con plantillas genéricas por número de parámetros, así que
**no hay que registrar plantillas nuevas en Meta** para cambiar un texto.

**Dónde vive:** el envío es del **CRM**. Cartera-back solo responde qué cuotas están por
vencer (`GET /cuotas/proximas-vencer`). Cartera no manda mensajes.

---

## A quién NO se le escribe

Esta es la parte que más se revisó, porque escribirle a quien ya pagó es peor que no
escribirle. Son **tres candados** y basta que uno se active para no enviar:

| Candado | Qué evita |
| --- | --- |
| `cuota.pagado = false` | El sello de la cuota, que **solo se pone cuando contabilidad valida** |
| Sin pago cubriente validado (`monto_aplicado > 0`) | Los pagos de solo mora, que no cubren la cuota |
| Sin boleta `pending` con `monto_boleta > 0` | **No molestar a quien ya mandó su comprobante** y está esperando validación |

Dos casos que se auditaron explícitamente:

- **Pago parcial** → `pagado` solo se marca cuando *todos* los rubros quedan en cero, así
  que un abono parcial no es cubriente y **sí recibe recordatorio**. Correcto: todavía debe.
  *(Detalle abierto: el mensaje le dice el monto completo de la cuota, no lo que le falta.)*
- **Pago de solo mora** → entra con `monto_aplicado = 0` y lo descarta el tercer candado.
  Es el mismo bug que en el motor bajaba el bucket sin merecerlo; el predicado se escribió
  como espejo del ya corregido.

---

## Hasta dónde llega el funnel

Al inicio los recordatorios eran solo para **B0** (cartera sana): a los morosos los gestiona
su asesor. Después se parametrizó:

| Variable | Efecto |
| --- | --- |
| `PREMORA_BUCKETS=0` (default) | Solo créditos al día, consulta estricta en tiempo real. Cero cambios respecto al comportamiento original |
| `PREMORA_BUCKETS=0,1,2,3,4` | Funnel completo, filtrando por el bucket **motor**. B5 (jurídico) queda fuera siempre |

Cuando el crédito ya trae atraso, el mensaje usa una plantilla distinta que además dice
cuánto debe:

> *"Además su crédito registra 2 cuota(s) vencida(s) y Q1,234.56 de mora."*

**Ojo con ese número:** `monto_mora` es **solo el recargo** (`capital × 1.12% × cuotas`),
**no** incluye las cuotas vencidas. Por eso el texto las nombra por separado en vez de
sumar un total que sería mentira.

Y la variante con números **solo se usa si los conteos cuadran**: `moras_credito` es una
foto que solo se refresca cuando corre el job, y se midió que ~13 % de los créditos con
mora activa están desfasados por una cuota en cualquier momento dado. Si el conteo vivo no
coincide con el guardado, se manda la plantilla base, que no cita cifras. **El monto no se
recalcula en vivo a propósito**: la fórmula del recargo es del motor y duplicarla sería una
segunda fuente de verdad.

---

## Que no salga dos veces

`recordatorios_premora` tiene un `UNIQUE (cuota, tipo)` y el insert funciona como
**claim antes de enviar**:

```
INSERT ... ON CONFLICT DO NOTHING RETURNING *
  ├── sin fila  → otra corrida ya lo reclamó → no envía
  └── con fila  → envía
        ├── éxito → el claim queda
        └── falla → se libera el claim → reintento natural
```

Doble WhatsApp: imposible. El trade-off aceptado es que un crash entre el claim y el envío
pierde ese recordatorio — con la red de D-3/D-1/D-0 por detrás.

En **modo test** no se escriben claims: el envío de prueba no debe consumir el recordatorio
real del cliente.

---

## Reducción para quien paga bien (CB-010)

Si un crédito **paga bien cuatro meses seguidos**, no tiene sentido escribirle cuatro veces
antes de cada cuota.

- **El sistema propone**: un job a las **07:00 GT** —una hora antes del envío, a propósito—
  marca los créditos elegibles por su racha de cuotas pagadas al día.
- **El gerente aplica**: el rol `cobros_supervisor` decide a quién se le quitan pasos.
  Máximo **dos** de D-5/D-3/D-1. **D-0 nunca se quita**: siempre queda monitoreo preventivo.
- **El sistema revoca solo**: si el cliente deja de pagar bien, la reducción se retira
  automáticamente y se le avisa al gerente.

La pantalla está en `/cobros/reduccion`, con tres pestañas: Elegibles, Configurados y
Retirados automáticamente.

---

## Recordatorios de convenio

Espejo del premora, pero sobre `convenio_cuotas`, a las **08:05 GT** (cinco minutos
después, para no pelearse por el mismo lote).

Diferencias:

- La fecha que importa es `convenio_cuotas.fecha_vencimiento`, no la de la cuota del crédito.
- El monto del mensaje es **cuota normal + cuota del convenio**, desglosado — porque el
  cliente en convenio debe **las dos cosas** cada mes.
- No aplica la reducción CB-010 ni la variante con mora.
- Tabla propia: `recordatorios_convenio`, misma idempotencia por claim.

---

## Cómo se enciende

En el `.env` del **CRM server**:

| Variable | Para qué |
| --- | --- |
| `PREMORA_WHATSAPP_ENABLED=true` | Sin esto el job automático se omite entero |
| `PREMORA_BUCKETS=0,1,2,3,4` | Hasta dónde llega el funnel (default `0` = solo al día) |
| `CONVENIO_WHATSAPP_ENABLED=true` | Recordatorios de convenio |
| `PREMORA_SYSTEM_USER_ID` | Usuario del sistema que firma los registros; si falta, el primer admin |
| `TEST_MESSAGE` | Redirige todo a los números internos. **En pruebas con datos reales, encenderlo** |

Para correr un lote a mano: `POST /api/premora/run` (admite `?dias=`, `?sifco=` y
`?buckets=`; es POST-only y valida `Origin`, así que se dispara con `fetch` desde la consola
del CRM logueado, no pegando la URL en el navegador). Ese endpoint ignora el gate
`PREMORA_WHATSAPP_ENABLED` a propósito, para poder probar sin dejar el job encendido.

> ⚠️ **En dev, `PREMORA_WHATSAPP_ENABLED` se deja sin setear a propósito.** El job corre
> también al arrancar el servidor: con la variable puesta, cada reinicio mandaría todos los
> mensajes del día.
