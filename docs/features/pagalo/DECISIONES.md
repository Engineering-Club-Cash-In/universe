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

## D-10 · Importación Págalo registra Y valida en una transacción; factura y recibo post-commit

**v2 · 2026-08-26 — decisión de Daniel con el equipo.** Regla compartida:
[D-50](../bot-whatsapp-cobros/DECISIONES.md#d-50--el-pago-por-link-nace-validado-en-la-misma-transacción).

`POST /pagalo/payment-imports` hace, bajo el advisory lock del crédito y en
**una sola `db.transaction`**: ledger `APPLYING` → ajuste de mora (D-52) →
`procesarRegistroPago(data, tx)` → `cuenta_empresa_id = PAGALO` en cada pago
creado → **validación con `aplicarPagoNormalEnTx(tx, …)`** (la misma función
del botón "Validar Pago": cierre de cuota, capital/deuda, restantes,
inversionistas) → reposición de la mora → ledger `APPLIED`. Si cualquier paso
falla, rollback completo: el ledger no queda `APPLIED`, cartera responde 5xx y
el dispatcher del CRM reintenta con su backoff (idempotente por `crm_group_id`).

Las funciones existentes se reutilizan **recibiendo la tx por parámetro**; no
hay copias del motor ni del validador.

**Gate (2026-08-27, Daniel):** la facturación automática solo corre con
`PAGALO_FACTURACION_ACTIVA=true` en cartera-back. Ausente o con otro valor se
**omite** (el pago nace validado igual, el recibo sale igual, y el ledger deja
`factura_status = NULL` = no aplica). Hoy no hay SAT de pruebas separado:
mientras esto esté en pruebas, ningún ambiente sin la env certifica nada real.

**Fuera de la transacción, después del commit, lo dispara cartera** (mismo
request, fire-and-forget, patrón de `/aplicar-pago`): `facturarPagoCompleto()`
—el cuerpo de `/api/dte/facturar-pago-completo` extraído a función— por cada
pago, **bajo el advisory lock del crédito** (el mismo de registrar/validar; y
`reversePayment` ahora también lo toma, para que una reversión no se cruce con
esa certificación y deje un DTE vivo de un pago revertido), y el recibo por
WhatsApp (`enviarRecibosPagoDeCreditoBestEffort`), **independiente** de la
facturación: sale aunque esta falle. SAT es
irreversible: jamás corre dentro de una tx que pueda hacer rollback. El
resultado queda en `pagalo_payment_imports.factura_status`
(`PENDIENTE|OK|PARCIAL|FALLIDA`) + `factura_error` (JSON por pago: `http` 400 =
determinista —NIT, %, ya facturado—, 500 = SAT/transitorio, y las facturas
individuales que fallaron). Un `FALLIDA`/`PARCIAL` no se reintenta solo (el
pre-check de facturación solo mira "¿hay alguna ACTIVA?" y duplicaría en SAT)
— sigue el playbook de facturas no en SAT / "Generar Factura".

**Huérfanos:** si cartera muere entre el commit y SAT, el import queda `APPLIED`
+ `PENDIENTE`. El barrido `reintentarFacturacionPagaloPendiente` (schedule.ts,
cada 10 min) marca como `FALLIDA` los `PENDIENTE` con más de 10 min (UPDATE
condicional atómico, seguro con varias réplicas) para que entren al playbook.
**Nunca re-certifica solo**: "no hay factura `ACTIVA` en la DB" no prueba que
no exista en SAT (el proceso pudo morir entre certificar e insertar), y SAT no
tiene idempotencia de nuestro lado (descartada en #1282) — la verificación
contra SAT/COFIDI y el reintento son manuales.

El post-commit se lanza **fuera del lock del import** y con el contexto de
locks limpio (`fueraDeLocksHeredados`): `facturarImport` toma el suyo.

**Recibo = outbox mínimo** (`recibo_status`: `PENDIENTE` en la tx → claim
`ENVIANDO` → `OK|FALLIDA`, `recibo_intentos`, `recibo_pagos_ok`). Si cartera
muere entre el commit y el envío, o el envío falla por una caída transitoria
(PDF/CRM), lo reanudan un replay `APPLIED` del dispatcher o el barrido de 10
min: hasta 5 intentos, cada 30 min, y **solo a los pagos que aún no recibieron
el suyo**; el claim atómico evita duplicarlo. La factura, en cambio, **nunca**
se reanuda sola.

**"Generar Factura" manual** (`POST /api/dte/facturar-pago-completo`) toma el
mismo advisory lock del crédito, para no cruzarse con la facturación
post-commit de un pago Págalo y certificar DTE duplicados.

El CRM manda **una sola llamada** y no sabe de la factura: con `APPLIED` marca
el grupo `COMPLETED`.

Historia: v1 (2026-08-24) dejaba los pagos `pending` para la bandeja de conta.

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

## D-19 · Generar links es una forma de registrar un pago, no otra gestión

Reemplaza la ubicación fijada en [D-16](#d-16--selector-cobra-unidades-completas):
`Generar links de pago` deja de ser botón suelto junto a `Registrar Contacto` y
pasa a ser una de las dos opciones del botón primario `Registrar Pago`:

- **Generar links de pago** → abre el modal de Págalo (mismo modal, mismas
  reglas de selección).
- **Subir boleta** → lleva al formulario de registro de pago de siempre.

Cobrar tiene dos vías —mandarle links al cliente o cargar la boleta de un
depósito que ya hizo— y las dos terminan en un pago. Tenerlas como botones
paralelos hacía ver los links como una gestión aparte, del mismo peso que
registrar un contacto.

Sin crédito de cartera (`carteraCreditoId`/`numeroCreditoSifco`) la opción de
links aparece **deshabilitada**, no oculta: el asesor tiene que saber que
existe y que no aplica a ese caso.

## D-20 · El historial de links es del crédito y va paginado

El rastro de grupos Págalo de la ficha se consulta por `carteraCreditoId`, no
por caso de cobro, y con paginación (5 grupos por página, más reciente
primero).

Un crédito acumula varios casos de cobro a lo largo del tiempo; el asesor que
abre la ficha espera ver **todos** los links que se le generaron a ese crédito
—pagados, vencidos, cancelados o pendientes— no solo los del caso vigente. Y el
historial crece sin techo: cada grupo completado o cancelado libera el slot para
uno nuevo.

Cuando no hay ninguno, la sección se muestra igual con un placeholder
("Sin links de pago generados para este crédito"). Antes se ocultaba entera y
dejaba una tarjeta vacía en la ficha, que se lee como algo roto.

## D-21 · La cadencia del poll y el botón "Verificar ahora"

**Fecha:** 2026-09-01 · **Pedido por:** Daniel

Cada cuánto le preguntamos a Págalo si un link ya se pagó
(`lib/pagalo-poll-cadencia.ts`):

- **La primera revisión no es inmediata: espera 5 minutos.** Nadie paga un link
  en los primeros segundos, así que preguntar de una gasta una llamada
  garantizada a fallar y, peor, arranca el backoff antes de tiempo.
- De ahí duplica hasta un **tope de 15 minutos** (5 → 10 → 15 → 15 …). Antes el
  tope eran 30 y en un link recién pagado se sentía como que el sistema no se
  enteraba.

El job sigue corriendo cada 5 minutos, así que la cadencia real es la mayor de
las dos: nunca antes de lo que diga `next_poll_at`, nunca más seguido que el
ciclo.

**"Verificar ahora" (Ficha 360)** es la salida para no esperar nada: consulta a
Págalo los links de ESE grupo salteándose `next_poll_at` y, si con eso queda
evidencia completa, aplica el pago en cartera en la misma acción.

- **Verificar y aplicar son un solo botón** a propósito. Aplicar exige la
  evidencia verificada (D-05), así que ofrecerlos separados obligaba a apretar
  dos veces sabiendo de antemano el orden.
- Lo puede usar **cualquiera con acceso a la Ficha 360**, no solo un
  supervisor: es una consulta sobre un grupo que la persona ya está viendo, y
  la aplicación que dispara es la misma que el ciclo automático haría solo unos
  minutos después. Distinto de `probarPollPagalo`, que corre el poller ENTERO
  (todos los links de todos los créditos) y sigue siendo de supervisor.
- Respeta el lease: si el ciclo automático ya tiene el link agarrado, no se lo
  pelea.
- **No fuerza lo que necesita una persona.** Desde `REVIEW_REQUIRED` verifica
  pero no aplica: eso sigue siendo "Forzar aplicación", de admin.
- No arrastra el backlog de dispatch de otros grupos, que puede tardar minutos
  con cartera-back lento.

