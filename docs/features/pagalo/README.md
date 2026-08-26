# CB-028 · Integración Págalo

**Estado:** flujo CRM → sandbox → Cartera implementado; pendiente de pruebas E2E
controladas y de retirar salvaguardas exclusivas de sandbox antes de producción.
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

1. **Creación transaccional de pagos:** endpoint idempotente crea ledger,
   pagos pendientes y boletas dentro de una transacción. Usa JWT normal de
   Cartera, igual que rutas internas existentes; validación posterior sigue
   flujo normal de Cartera.
2. **Cliente Págalo:** existe cliente limitado a `api.pagalodev.com`, respuesta
   sanitizada, flag explícito para crear links y orquestación de uno o dos
   links. Crear links sigue limitado a sandbox y requiere flag explícito.
3. **Confirmación automática:** worker consulta estado Págalo; estado `2`
   sólo permite consultar detalle. Exige después
   `status_transaction='ACCEPT'`, valida monto/GTQ, genera voucher propio,
   lo sube mediante `/upload` de Cartera y despacha grupo a importador.
4. **CRM:** botón, modal, historial, envío conjunto por WhatsApp, poller y
   dispatcher existen. Modal fuerza cuotas consecutivas; mora positiva queda
   marcada/bloqueada. Cálculo servidor usa centavos exactos.
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
  │ valida evidencia/idempotencia y abre transacción
  ▼
procesarRegistroPago() ── mismo motor de Ficha 360 y bot
  │
  ├─ N pagos_credito pending, origen pagalo, pagalo_import_id
  └─ boletas (uno o dos vouchers por cada pago creado)
```

## Guardas antes de producción

No habilitar producción hasta cerrar estos puntos:

- validar monto, moneda y `ACCEPT` de cada transacción contra link/snapshot;
- probar rollback total, replay HTTP y grupos capital-only, facturable-only y
  ambos;
- mantener `TEST_MESSAGE=true` durante pruebas para redirigir WhatsApp a número
  de prueba; fuera de ese modo, envío usa teléfono del cliente.

## Límites del primer slice original

Un grupo CRM posee una o dos transacciones `ACCEPT` y vouchers almacenados. Sus
links permanecen separados por facturación, pero Cartera registra **un pago
combinado** con total, usando mismo motor de una boleta manual. Crea pagos y
boletas; no los valida en este endpoint ni crea flujo financiero paralelo.

`registerPayment` conserva exactamente su semántica vigente al registrar:
cualquier efecto que hoy forma parte de `/newPayment` —por ejemplo el manejo de
mora, convenios, cuotas parciales o saldo a favor— sigue siendo parte del mismo
registro. El proyecto no agrega efectos nuevos dentro de ese motor.

Snapshot CRM es evidencia/auditoría del link emitido, no presupuesto que
restrinja aplicación posterior. Si deuda cambia antes del pago, motor normal
puede cascader a cuotas posteriores o saldo a favor. No crea `REVIEW_REQUIRED`
solo porque link quede sobrado.
