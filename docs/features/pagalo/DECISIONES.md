# CB-028 · Decisiones de Págalo

Este archivo registra decisiones vigentes. Cambiar una exige actualizar
contrato, pruebas y plan afectados.

## D-01 · Solo desarrollo

Implementación y pruebas usan sandbox. Integración queda detrás de feature flag
desactivado por defecto. No se configuran credenciales ni URL productivas.

## D-02 · CRM orquesta; Cartera registra dinero

CRM conserva intención, selección congelada de cuotas, links, transacciones,
vouchers, actor e historial. Cartera conserva importación idempotente y pagos
reales. Credenciales Págalo nunca llegan a Cartera.

## D-03 · Un grupo contiene uno o dos componentes reales

Una selección con cuotas genera `CAPITAL` no facturable y `MORA_INTERES`
facturable. Una selección de solo mora genera únicamente `MORA_INTERES`.
Nunca se crea fila ni link CAPITAL por Q0.00. Cada link usa monto fijo. Cuando
hay dos, pagar solo uno deja grupo parcial y no crea pagos.

## D-04 · Envío conjunto

Cliente recibe un solo mensaje con todos los links requeridos etiquetados. CRM
no envía nada hasta crear correctamente el único link de mora o los dos links
de una selección con cuotas.

## D-05 · Todos los ACCEPT requeridos antes de registrar

Cartera recibe importación únicamente cuando CRM eligió una transacción
`ACCEPT` por cada tipo requerido, validó moneda/montos y tiene sus vouchers.
Mora sola requiere un `ACCEPT`; cuotas requieren dos. Diferencia o ambigüedad
lleva grupo a `REVIEW_REQUIRED`; nunca se crea pago especulativo.

## D-06 · Sin expiración en MVP

Configuración `0` significa links sin vencimiento. Modelo conserva campos de
expiración para política futura, pero sandbox inicial envía `expiration=false`.

## D-07 · Polling como fuente de verdad

Callbacks de retorno pueden acelerar experiencia, pero no constituyen evidencia
firmada de pago. Worker consulta Págalo y confirma estado/transacción. Esta
decisión aplica a etapas posteriores, no al primer slice.

## D-08 · Un solo motor financiero

No se replica distribución de mora, interés, IVA, capital, otros, convenios,
cuotas parciales ni saldo a favor. Front, bot y Págalo llaman el mismo motor
interno extraído del `registerPayment.ts` actual.

## D-09 · Transacción opcional por parámetro

Motor acepta una transacción existente. Si no recibe una, abre su propia
transacción. Front y bot usan transacción interna; importación Págalo abre una
transacción que incluye cabecera, pagos, boletas y estado final, y se la pasa al
motor. Todos los helpers de persistencia usan el executor recibido.

## D-10 · Primer slice solo registra pagos pendientes

Resultado esperado es `pagos_credito.validation_status='pending'`. No se llama
validación contable, aplicación de inversionistas ni facturación. Se conserva,
sin ampliar, comportamiento vigente que `/newPayment` ejecuta durante registro.

## D-11 · Págalo no inventa banco ni autorización única

`banco_id` queda `NULL`: pago con tarjeta procesado por Págalo no es depósito en
una cuenta bancaria del catálogo. `numeroAutorizacion` de `pagos_credito` no se
usa para compactar dos códigos diferentes. Evidencia individual vive en
`pagalo_payment_imports` y links CRM. Origen es `pagalo` y actor del sistema es
`pagalo@clubcashin.com`.

## D-12 · Vouchers usan flujo existente de boletas

Antes de importar, CRM copia cada voucher Págalo a almacenamiento propio; si
proveedor no entrega archivo, CRM genera PDF desde transacción confirmada y lo
sube. Importación pasa una o dos keys en `url_boletas`. Motor existente crea
filas `boletas`; no existe segundo mecanismo de adjuntos.

## D-13 · Idempotencia se defiende en Cartera

`crm_group_id` es llave idempotente y `payload_hash` congela contenido. Retry
con mismo grupo/hash devuelve misma importación y mismos pagos. Mismo grupo con
hash distinto responde conflicto y pasa a revisión. UUIDs e identificadores de
transacciones no pueden reutilizarse.

## D-14 · Snapshot audita; Cartera valida estado vivo

CRM envía selección congelada y totales. Bajo lock del crédito, Cartera valida
identidad crédito/SIFCO, cuota inicial, moneda, sumas y compatibilidad con deuda
vigente. Si cambió de forma que impide aplicar comando original, persiste
`REVIEW_REQUIRED` sin crear pagos. No redistribuye silenciosamente una
operación Págalo contra una intención diferente.

## D-15 · Endpoint Págalo separado; servicio compartido

`POST /newPayment` conserva contrato de Ficha 360/bot. Nuevo endpoint interno
`POST /pagalo/payment-imports` valida evidencia e idempotencia específicas y
después llama mismo servicio `procesarRegistroPago`. Separar contratos evita
que clientes normales puedan inyectar `pagalo_import_id` o fingir evidencia.

## D-16 · Selector cobra unidades completas

Botón `Generar links de pago` vive junto a `Registrar Contacto` en Ficha 360.
Modal reutiliza patrón visual de Promesa de Pago. Primera versión muestra cuotas
atrasadas; inicia con todas seleccionadas y permite quitar únicamente desde la
última hacia la primera, conservando un rango consecutivo desde la más antigua.
Cada cuota se cobra completa y monto no es editable.

Si mora vigente es mayor que cero, aparece seleccionada y bloqueada mientras
haya cuotas elegidas. Asesor también puede desmarcar todas las cuotas y dejar
solo mora completa. No existen pagos parciales de cuota ni mora desde este flujo.

## D-17 · Link de mora viejo no se cancela solo localmente

Monto de mora queda congelado al generar link. Worker compara snapshot contra
mora viva. Documentación Págalo muestra estado cancelado, pero no publica un
endpoint para cancelar un link pendiente; por tanto CRM no puede declarar
cancelación remota sin confirmación del proveedor.

Mientras no exista contrato oficial de cancelación, un link pagado cuyo monto ya
no coincide pasa `REVIEW_REQUIRED` y no se distribuye automáticamente. Si Págalo
confirma endpoint, worker podrá cancelar remoto, verificar estado cancelado y
recién entonces generar reemplazo. Reversa de transacción pagada no se usa como
cancelación de link.

## D-18 · Cuotas futuras quedan diferidas

Diseño futuro permitirá, cuando crédito esté al día, seleccionar una o varias
cuotas futuras consecutivas desde la próxima pendiente. No forma parte de
primera versión del modal ni del primer plan de implementación.
