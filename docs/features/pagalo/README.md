# CB-028 · Integración Págalo

**Estado:** implementación parcial en revisión; no lista para operación E2E.
**Ambiente permitido:** desarrollo/sandbox. Producción queda fuera de alcance.

## Objetivo

Permitir que un asesor seleccione cuotas o únicamente la mora desde CRM, genere
los links Págalo requeridos y, cuando Págalo confirme todas las transacciones
esperadas, registre los pagos correspondientes en Cartera usando la misma lógica
financiera que hoy usan Ficha 360 y bot de WhatsApp.

Un grupo tiene uno o dos links reales. `CAPITAL` contiene solo capital; el
otro lado contiene todos los rubros facturables, incluida mora. Si cualquiera
de los subtotales es Q0.00, ese link no se crea: existen tanto mora-only como
solo-capital. Nunca se crea un link ficticio por Q0.00. Ver D-48 del contrato
compartido del bot.

## Documentos

- [Decisiones](./DECISIONES.md): reglas cerradas y razones.
- [Creación transaccional de pagos](./01-creacion-transaccional-pagos.md):
  diseño del primer slice implementable.
- [Generación desde Ficha 360](./02-generacion-links-ficha-360.md): posición del
  botón, selector, desglose y reglas de uno o dos links.

## Alcance por etapas

1. **Creación transaccional de pagos:** existe endpoint idempotente, motor con
   transacción externa y llave de servicio requerida. Faltan pruebas de
   rollback real y de compatibilidad exacta entre snapshot congelado y rubros
   vivos.
2. **Cliente Págalo:** existe cliente limitado a `api.pagalodev.com`, respuesta
   sanitizada, flag explícito para crear links y orquestación de uno o dos
   links. Esta implementación no ha creado links.
3. **Confirmación automática:** worker consulta estado Págalo; estado `2`
   sólo permite consultar detalle. Exige después
   `status_transaction='ACCEPT'`, valida monto/GTQ, guarda voucher propio
   `pagalo/{crm_group_id}/...` y prepara grupo. Aún no llama al importador de
   Cartera; no completa pagos end-to-end.
4. **CRM:** botón y modal fuerzan cuotas consecutivas; mora positiva queda
   marcada/bloqueada. Cálculo servidor usa centavos exactos. Falta prueba de UI
   y eliminar aproximación numérica del preview visual.
5. **Prueba E2E en sandbox:** pendiente: casos completos, parciales,
   reintentos, fallos y reconciliación. Sin despliegue productivo.

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
  ├─ N pagos_credito (validated, origen pagalo, pagalo_import_id)
  └─ boletas (uno o dos vouchers por cada pago creado)
```

## Guardas antes de habilitar sandbox

No habilitar creación de links ni polling automático hasta cerrar estos puntos:

- validar monto, moneda y `ACCEPT` de cada transacción contra link/snapshot;
- enviar grupo `READY_TO_APPLY` al importador de Cartera y persistir resultado;
- probar rollback total, replay HTTP y grupos capital-only, facturable-only y
  ambos;
- configurar misma llave `PAGALO_IMPORT_SERVICE_KEY` en CRM y Cartera antes de
  habilitar dispatch.

## Límites del primer slice original

El primer slice empieza con un grupo CRM que ya posee todas sus transacciones
requeridas en `ACCEPT` y vouchers almacenados, y termina con pagos de Cartera
creados ya validados. Puede recibir una fuente CAPITAL, una fuente
MORA_INTERES o ambas, según los componentes reales. No crea links, no consulta
Págalo, no envía WhatsApp ni factura. Sí extrae y reutiliza validación y
distribución a inversionistas ya existentes, dentro de misma transacción, para
que pago Págalo salga `validated` sin crear un flujo financiero paralelo.

`registerPayment` conserva exactamente su semántica vigente al registrar:
cualquier efecto que hoy forma parte de `/newPayment` —por ejemplo el manejo de
mora, convenios, cuotas parciales o saldo a favor— sigue siendo parte del mismo
registro. El proyecto no agrega efectos nuevos dentro de ese motor.
