# CB-028 · Decisiones de Págalo

Este archivo registra decisiones vigentes. Cambiar una exige actualizar
contrato, pruebas y plan afectados.

## Precedencia del circuito compartido

Las decisiones D-45…D-52 de
[`bot-whatsapp-cobros/DECISIONES.md`](../bot-whatsapp-cobros/DECISIONES.md)
mandan para reglas compartidas por bot y asesor. D-01…D-18 explican cómo
Ficha 360 consume ese circuito y no pueden contradecirlo.

| Decisión asesor | Fuente compartida |
| --- | --- |
| D-01, D-02, D-08, D-13, D-15 | D-45 |
| D-03, D-04, D-05, D-11 | D-48 |
| D-06 | D-51 |
| D-07 | D-49 |
| D-09, D-10, D-12 | D-50 |
| D-14, D-17 | D-52 |
| D-16, D-18 | D-46 |

## D-01 · Solo desarrollo

Implementación y pruebas usan sandbox. Integración queda detrás de flags
desactivados por defecto: creación de links y polling. No se configuran
credenciales ni URL productivas. Worker exige habilitación explícita en DEV.

## D-02 · CRM orquesta; Cartera registra dinero

CRM conserva intención, selección congelada de cuotas, links, transacciones,
vouchers, actor e historial. Cartera conserva importación idempotente y pagos
reales. Credenciales Págalo nunca llegan a Cartera.

## D-03 · Un grupo contiene uno o dos componentes reales

Regla compartida: [D-48](../bot-whatsapp-cobros/DECISIONES.md#d-48--capital-en-un-link-todo-lo-demás-en-el-otro).
`CAPITAL` contiene capital no facturable; `MORA_INTERES` contiene todo rubro
facturable. Cualquiera de ambos subtotales puede ser Q0.00 —mora-only o
solo-capital, por ejemplo cuando pago parcial ya cubrió interés y rubros— y ese
link no se crea. Nunca hay fila ni link ficticio de Q0.00. Cuando hay dos,
pagar solo uno deja grupo parcial y no crea pagos.

## D-04 · Envío conjunto

Cliente recibe un solo mensaje con todos los links requeridos etiquetados. CRM
no envía nada hasta crear grupo completo: uno o dos links según D-48. Texto
visible siempre neutro: `Crédito {sifco} · Pago`, o `Pago 1 de 2` / `Pago 2 de
2`; nunca nombra mora o intereses.

## D-05 · Todos los ACCEPT requeridos antes de registrar

Cartera recibe importación únicamente cuando CRM eligió una transacción
`ACCEPT` por cada tipo requerido, validó moneda/montos y tiene sus vouchers.
Grupo de un link requiere un `ACCEPT`; uno de dos requiere ambos. Diferencia o
ambigüedad lleva grupo a `REVIEW_REQUIRED`; nunca se crea pago especulativo.

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

## D-10 · Importación Págalo registra; validación sigue flujo normal

Regla compartida: [D-50](../bot-whatsapp-cobros/DECISIONES.md#d-50--el-pago-por-link-se-registra-con-evidencia-y-sigue-la-validación-normal).
Después de verificar `ACCEPT` y voucher propio, importación crea pagos y
boletas `pending`. No valida dentro de este endpoint: validación contable y
aplicación final siguen camino normal de Cartera. Este slice no agrega factura
ni proceso de inversionistas alterno.

## D-11 · Págalo no inventa banco ni autorización única

Págalo no reporta banco del catálogo ni autorización única equivalente. En
sandbox, importador usa temporalmente `banco_id=1` porque motor actual exige FK
válida; no representa banco real de Págalo. `numeroAutorizacion` no compacta
dos códigos diferentes. Evidencia individual vive en `pagalo_payment_imports`
y links CRM. Origen es `pagalo` y actor del sistema es `pagalo@clubcashin.com`.

## D-12 · Vouchers usan flujo existente de boletas

CRM genera PDF propio desde transacción confirmada y lo sube mediante `/upload`
de Cartera, mismo flujo de carteraFront. Importación pasa una o dos keys planas
en `url_boletas`. Motor existente crea filas `boletas`; no existe segundo
mecanismo de adjuntos.

## D-13 · Idempotencia se defiende en Cartera

`crm_group_id` es llave idempotente y `payload_hash` congela contenido. Retry
con mismo grupo/hash devuelve misma importación y mismos pagos. Mismo grupo con
hash distinto responde conflicto y pasa a revisión. CRM impide reutilizar UUIDs
e identificadores globalmente; defensa cruzada adicional dentro de Cartera queda
como mejora P2, no bloqueante del dispatcher actual.

## D-14 · Snapshot audita; Cartera valida estado vivo

CRM envía selección congelada y totales como evidencia/auditoría. Cartera valida
identidad crédito/SIFCO viva, cuota inicial, moneda y sumas; si SIFCO cambió o
el crédito ya no existe, conserva evidencia como `REVIEW_REQUIRED` sin aplicar.
Con identidad vigente aplica **un pago
combinado** mediante motor normal de boleta manual. Snapshot no restringe
rubros, cuotas ni saldo vivo: deuda reducida puede cascader a cuotas posteriores
o saldo a favor, sin `REVIEW_REQUIRED` solo por sobrante. Si mora creció, motor
normal consume mora viva primero; faltante queda visible en estado de Cartera,
sin dato especial en ledger Págalo. Ver D-52.

## D-15 · Endpoint Págalo separado; servicio compartido

`POST /newPayment` conserva contrato de Ficha 360/bot. Nuevo endpoint interno
`POST /pagalo/payment-imports` valida evidencia e idempotencia específicas y
después llama mismo servicio `procesarRegistroPago`. Separar contratos evita
que clientes normales puedan inyectar `pagalo_import_id` o fingir evidencia.

## D-16 · Selector cobra unidades completas

Botón `Generar links de pago` vive junto a `Registrar Contacto` en Ficha 360.
Modal reutiliza patrón visual de Promesa de Pago. Muestra cuotas atrasadas en
rango consecutivo desde la más antigua y permite agregar próxima cuota por
vencer, como bot (D-46). Cada cuota se cobra completa y monto no es editable.

Si mora vigente es mayor que cero, aparece siempre seleccionada y bloqueada.
Asesor puede desmarcar todas las cuotas y dejar solo mora completa. No existen
pagos parciales de cuota ni mora desde este flujo.

## D-17 · Link viejo: aplicación normal sobre estado vivo

Monto de mora queda congelado al generar link. Snapshot queda como auditoría;
aplicación usa estado vivo del motor normal. Documentación Págalo muestra estado
cancelado, pero no publica un
endpoint para cancelar un link pendiente; por tanto CRM no puede declarar
cancelación remota sin confirmación del proveedor.

Regla compartida: [D-51](../bot-whatsapp-cobros/DECISIONES.md#d-51--los-links-no-expiran-por-ahora)
y [D-52](../bot-whatsapp-cobros/DECISIONES.md#d-52--si-deuda-cambia-págalo-se-comporta-como-boleta-manual).
Si mora creció, pago combinado se aplica igual y motor normal consume mora viva
primero. Si deuda se achicó, sobrante puede cascader o ir a saldo a favor,
igual que boleta manual. No hay `REVIEW_REQUIRED` solo por diferencia entre
snapshot y deuda viva. Si Págalo confirma cancelación remota, worker podrá
cancelar antes de reemplazar; reversa pagada no sirve como cancelación de link.

## D-18 · Próxima cuota por vencer permitida

Regla compartida: [D-46](../bot-whatsapp-cobros/DECISIONES.md#d-46--el-cliente-elige-cuántas-cuotas-el-crm-arma-el-monto).
Selector del asesor permite agregar próxima cuota por vencer al rango de
atrasadas; cuando está al día permite cuota actual/próxima pendiente. No permite
cuotas futuras arbitrarias ni pagos parciales.
