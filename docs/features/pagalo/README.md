# CB-028 · Integración Págalo

**Estado:** diseño aprobado; implementación pendiente.
**Ambiente permitido:** desarrollo/sandbox. Producción queda fuera de alcance.

## Objetivo

Permitir que un asesor seleccione cuotas o únicamente la mora desde CRM, genere
los links Págalo requeridos y, cuando Págalo confirme todas las transacciones
esperadas, registre los pagos correspondientes en Cartera usando la misma lógica
financiera que hoy usan Ficha 360 y bot de WhatsApp.

Una selección con cuotas genera `CAPITAL` y `MORA_INTERES`. Una selección de
solo mora genera únicamente `MORA_INTERES`; nunca se crea un link CAPITAL de
Q0.00.

## Documentos

- [Decisiones](./DECISIONES.md): reglas cerradas y razones.
- [Creación transaccional de pagos](./01-creacion-transaccional-pagos.md):
  diseño del primer slice implementable.
- [Generación desde Ficha 360](./02-generacion-links-ficha-360.md): posición del
  botón, selector, desglose y reglas de uno o dos links.

## Alcance por etapas

1. **Creación transaccional de pagos:** volver transaccional el motor actual y
   agregar importación Págalo idempotente. Es el único slice aprobado para
   implementación inmediata.
2. **Cliente Págalo:** crear uno o dos links con montos fijos y guardar
   respuestas sanitizadas.
3. **Confirmación automática:** consultar links/transacciones hasta tener todos
   los `ACCEPT` requeridos, obtener/generar vouchers y preparar importación.
4. **CRM y mensajería:** selector de cuotas/mora, generación desde gestión,
   envío de links requeridos en un solo WhatsApp e historial.
5. **Prueba E2E en sandbox:** casos completos, parciales, reintentos, fallos y
   reconciliación. Sin despliegue productivo.

Cada etapa tendrá plan y PR separados. Ninguna etapa puede introducir un motor
alterno de cálculo de pagos.

## Arquitectura resumida

```text
CRM UI
  │ selecciona cuotas
  ▼
CRM server ── crea 1 o 2 links / consulta Págalo / conserva auditoría
  │
  │ solo cuando todos los links requeridos están ACCEPT
  ▼
cartera-back POST /pagalo/payment-imports
  │ valida idempotencia y abre transacción
  ▼
procesarRegistroPago() ── mismo motor de Ficha 360 y bot
  │
  ├─ N pagos_credito (pending, origen pagalo, pagalo_import_id)
  └─ boletas (uno o dos vouchers por cada pago creado)
```

## Límites del primer slice

El primer slice empieza con un grupo CRM que ya posee todas sus transacciones
requeridas en `ACCEPT` y vouchers almacenados, y termina con pagos de Cartera
creados en estado pendiente. Puede recibir una fuente `MORA_INTERES` para mora
sola o dos fuentes para cuotas. No crea links, no consulta Págalo, no envía
WhatsApp, no valida pagos, no procesa inversionistas y no factura.

`registerPayment` conserva exactamente su semántica vigente al registrar:
cualquier efecto que hoy forma parte de `/newPayment` —por ejemplo el manejo de
mora, convenios, cuotas parciales o saldo a favor— sigue siendo parte del mismo
registro. El proyecto no agrega efectos nuevos dentro de ese motor.
