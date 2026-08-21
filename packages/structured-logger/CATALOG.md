# Catálogo estructurado de Cartera Back — propuesta v1

## Fuente y alcance

Esta propuesta se deriva de la auditoría estática de logging de Cartera realizada sobre
`b97fdb9a31ea7a5ecea8b203afa3884fc30965df` y de su reconciliación contra
`56717ddef8f0bbd8c8633172c8ca2c85c248dfd7`:

- 3,078 llamadas TypeScript ejecutables de `apps/cartera-back` forman el baseline histórico del catálogo;
- 3,091 llamadas TypeScript ejecutables existen en el commit objetivo; el delta de 13 debe quedar
  clasificado antes de migrar emisores;
- 1,014 llamadas Python quedan excluidas porque pertenecen a scripts locales/manuales:
  676 `print` y 338 `logger.*`;
- 147 llamadas de frontend quedan para una fase separada;
- no se hará reemplazo automático `console.* -> logger.*`.

El inventario original contó 248 de las llamadas `logger.*` de Python (`info`, `error` y
`debug`), pero omitió 90 `logger.warn` del mismo archivo. Sus cifras de clasificación
—909 eliminar, 481 reemplazar, 275 conservar estructuradas y 2,486 revisar por
sensibilidad— describen 4,151 llamadas y no deben tratarse como reconciliación completa.
La trazabilidad nueva separará TypeScript, Python y frontend antes de asignar disposición.

## Modelo de evento

Cada nombre representa una familia estable. `outcome` es un enum cerrado y determina el
nivel; el caller no elige `debug/info/warn/error`.

Campos comunes del evento:

| Campo | Contrato |
|---|---|
| `timestamp` | UTC ISO-8601, generado por el logger |
| `schema_version` | entero positivo fijado por catálogo |
| `service` | valor configurado, no recibido de payload |
| `environment` | `local`, `development`, `staging` o `production` |
| `event` | nombre registrado en este catálogo |
| `level` | derivado de `event + outcome` |
| `request_id` | UUID recibido y validado; el middleware debe generarlo/propagarlo |
| `operation_id` | UUID recibido y validado para una sola operación funcional |
| `run_id` | UUID recibido y validado para jobs |

El logger no inventa IDs durante `emit`. El consumidor usa `createCorrelationId()` o
propaga un UUID validado y lo entrega en el contexto. Esto evita eventos aparentemente
correlacionados con IDs generados en el punto equivocado.

Reglas de nivel:

- `info`: operación completada, aplicada, creada, actualizada, disponible o iniciada por
  lifecycle explícito;
- `warn`: rechazo esperado, fallback, degradación, anomalía o estado parcial;
- `error`: fallo técnico, indisponibilidad o inconsistencia que impide completar.

## Catálogo ejecutable

La única fuente de verdad es `src/cartera-catalog.ts`. Define de forma machine-readable:

- campos comunes y de payload;
- tipos, enums, patrones y límites;
- outcomes y nivel exacto;
- campos requeridos, opcionales y constantes por `event + outcome`;
- relaciones válidas entre provider y operation;
- invariantes entre conteos.

`CATALOG.generated.md` es la referencia exhaustiva generada desde ese registro. No se
mantienen tablas manuales duplicadas en este documento.

Decisiones de agrupación:

- `payment.agreement_application` se integra en `payment.application` mediante
  `payment_kind=agreement`;
- `payment.capital_postprocessing` también se integra en `payment.application` mediante
  `manual_action_required` y códigos cerrados;
- fallos de lectura se cubren con `http.request`; no existe un evento por endpoint GET;
- `audit.persistence` observa solo el fallo de escritura y nunca transporta contenido de
  auditoría;
- `database.pool_state` no pertenece a v1 porque no existe un probe/máquina de estados real.

## Ownership y precedencia terminal

- cada operación de dominio emite exactamente un evento terminal;
- `payment.upload` describe el resultado de negocio de `/upload`;
- `integration.request` con `provider=cloudflare_r2` describe únicamente la dependencia
  externa; no cuenta como éxito de upload y puede coexistir correlacionado con el evento de
  dominio;
- `payment.reversal=partially_completed` es obligatorio cuando la reversa local quedó
  persistida pero una factura externa o su estado local requiere reconciliación;
- `invoice.voiding=local_state_inconsistent` exige `manual_action_required=true`;
- outcomes terminales y flags no duplican significado: cierres de cuota/crédito son flags,
  y `manual_action_required` nunca es outcome.

## Política de correlación

- `request_id`, `operation_id` y `run_id` son UUID generados o validados por la aplicación;
- nunca se reutilizan `credito_id`, `pago_id`, SIFCO, NIT, DPI, UUID de factura, boleta,
  autorización bancaria u otro identificador de negocio como correlación;
- un header de request inválido se reemplaza por un UUID nuevo y no se registra su valor;
- el middleware devuelve `request_id` en un header expuesto por CORS;
- `/upload` y `/newPayment` son operaciones independientes en v1 y no comparten
  `operation_id`; correlacionarlas funcionalmente requerirá un contrato frontend explícito
  o un token opaco server-side en otro PR;
- correlación e idempotencia son contratos distintos; ningún UUID del logger funciona como
  idempotency key;
- no se permite búsqueda por PII ni hashes de PII en v1;
- la cardinalidad se limita por enums y UUID de correlación; no hay keys dinámicas.

## Tipos permitidos

Los payloads de evento son planos y solo aceptan:

- enums registrados;
- booleanos;
- enteros no negativos para conteos, status HTTP, intentos y duración;
- UUID validados para correlación;
- strings de configuración allowlisted (`service`, `version`, `commit_ref`).

No se permiten objetos anidados, arrays, `Error`, `unknown` serializado, funciones,
símbolos, binarios ni valores no finitos.

## Campos y contenidos prohibidos

Se rechazan por clave y por contrato, aunque un evento intente declararlos:

- body, request, response, query, params, headers y cookies;
- token, authorization, password, secret, credential, API key y connection string;
- `Error`, AxiosError, stack, cause, message técnico o respuesta SDK;
- File, Blob, Buffer, XML, SOAP, HTML, PDF, URLs firmadas y rutas locales;
- nombres, email, teléfono, dirección, DPI, NIT y documentos fiscales;
- IDs de crédito, pago, cuota, inversionista, factura, boleta y códigos SIFCO;
- montos, saldos, mora, deuda, capital, interés, IVA, cuotas y porcentajes financieros;
- texto libre proveniente de usuarios, base de datos, archivos o proveedores.

El error de validación del logger reporta únicamente `event`, `field` y un código seguro;
nunca incluye el valor rechazado.

## Fuera del logger operativo

- `audit_logs` y acciones regulatorias/durables: requieren esquema, transacción/outbox,
  retención y controles propios; no se implementan como eventos de observabilidad;
- scripts Python locales/manuales;
- logs frontend;
- progreso por fila de migraciones o conciliaciones;
- logs `debug` por paso, cálculo, cuota, inversionista o registro;
- respuestas completas de SAT, COFIDI, SIFCO, R2 o correo.

## Trazabilidad requerida antes de migrar

El catálogo se acompaña con un inventario machine-readable por llamada que contiene commit,
archivo, línea, método, plantilla normalizada, clasificación y disposición. No se aprueba
una migración mientras existan llamadas `unresolved` dentro de su función/ruta. El conteo
debe reconciliar 3,078 llamadas históricas y 3,091 en el commit objetivo por separado.

## Primera migración recomendada

El package se construye primero sin migrar emisores. El primer consumidor debe ser un slice
acotado del flujo de pagos:

Prerequisitos:

1. contrato machine-readable con enums, límites, campos requeridos/opcionales y nivel por
   combinación `event + outcome`;
2. middleware global de `request_id` y CORS para aceptar/exponer su header;
3. disposición explícita de las 187 llamadas de `registerPayment.ts` y las llamadas del
   upload, sin `unresolved`;
4. separación documentada entre correlación e idempotencia.

Después:

1. `http.request` limitado en v1 a `/upload` y `/newPayment`;
2. `payment.upload`;
3. `payment.registration`;
4. `payment.integrity_anomaly`;
5. eliminación de Blob, bodies, boletas, montos y errores crudos en esos puntos.

Upload y `/newPayment` son etapas independientes y no deben compartir un único `catch` ni
un evento terminal ambiguo.
