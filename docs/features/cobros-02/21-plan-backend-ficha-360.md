# 21 · Ficha 360 rediseñada: plan y avance del backend

> **Issue:** #1864 · **Tareas:** F1–F8 del [doc 15](./15-ficha-360-backend.md)
> **Rama:** `jalvarez-cobros` → PRs secuenciales a `COBROS-02`
> **Regla:** solo backend. El front ya está conectado (PR #1863) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza al cerrar cada PR.

---

## Estado

Todo el código está hecho y probado en local, en 4 commits sobre `jalvarez-cobros`. **Falta la prueba de José en pantalla antes de abrir los PRs.**

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **F1** | Datos personales del titular | ✅ Hecho | `cargarDatosPersonales` (`lib/ficha-complementos.ts`) |
| **F2** | Codeudores | ✅ Hecho | `cargarCodeudores` (`lib/ficha-complementos.ts`) |
| **F3** | Historial de cambios del cliente | ✅ Hecho | Tabla `cambios_datos_cliente_cobros` · `lib/cambios-datos-cliente.ts` |
| **F4** | Vida del crédito | ✅ Hecho | `cargarHistorico` (`lib/ficha-complementos.ts`) |
| **F5** | Seguro | ✅ Hecho · ⚠️ sin datos en la base | `cargarSeguro` (`lib/ficha-complementos.ts`) |
| **F6** | Documentos | ✅ Backend hecho · ⚠️ falta cablear el front | `lib/documentos-ficha.ts` · tabla `solicitudes_documentos_cobros` |
| **F7** | Asistente IA | ✅ Hecho, **apagado** (`COBROS_ASISTENTE_IA`) · ⚠️ preguntas sin front | `lib/asistente-ia-cobros.ts` · tablas `resumenes_ia_cobros` y `preguntas_ia_cobros` |
| **F8** | Editar direcciones | ✅ Backend hecho · ⚠️ falta cablear el front | `guardarDireccionesCaso` · `lib/direcciones-caso.ts` |

> [!WARNING]
> **Hay que correr la migración `0078_cobros_ficha_360.sql` antes de desplegar el server del CRM.** Es idempotente. `getFichaComplementos` lee las tablas nuevas; sin ellas, F3 y F6 quedan en `null` (cada bloque está aislado) y `guardarTelefonosCaso` y `updateContactInfoCobros` **fallan**, porque escriben la bitácora en la misma transacción. El detalle del caso también lee las columnas nuevas de `casos_cobros`.

---

## Decisiones (2026-10-08)

| Tarea | Decisión |
| --- | --- |
| F1 | RENAP es la fuente oficial, pero en la base local solo 69 de 1,378 casos activos tienen RENAP. Se toma **campo por campo**: RENAP → lead → solicitud de crédito del titular. |
| F3 | `crm_entity_audit` no guarda el valor anterior ni cubre los casos de cobros: la bitácora es una tabla propia. Sin backfill: el historial arranca cuando se despliegue. |
| F4 | «Reestructura» = convenio: en cartera el convenio es la reestructura del crédito y no hay otra fuente. |
| F5 | Se leen `vehicles.tipo_cobertura` y `vehicles.deducible`. **Hoy están vacías en todos los vehículos** (2,011 de 2,011 en la base local): la tarjeta sigue mostrando «—» hasta que ventas las capture. |
| F6 | Solicitar al supervisor = la solicitud se **aprueba o rechaza con una nota**. La entrega del documento queda fuera del sistema. Una sola solicitud pendiente por caso y documento. |
| F6 / F8 | Solo backend. El front hoy no llama a esas mutaciones: queda en «Pendiente de front». |
| F7 | Mismo motor que el bot y el análisis bancario: Gemini con `@ai-sdk/google` (`GOOGLE_GENERATIVE_AI_API_KEY`, sin dependencia nueva). Detrás de `COBROS_ASISTENTE_IA=on`, **apagado por defecto** hasta que se apruebe el costo. |
| F8 | Las direcciones corregidas **no pisan** las de origen (la residencia del lead es de ventas; el trabajo es lo que firmó el cliente en la solicitud): van en columnas propias de `casos_cobros` y las lecturas las prefieren. |
| Migración | Una sola para todo el issue: `0078_cobros_ficha_360.sql`, idempotente. |
| Router | Las mutaciones nuevas van en `fichaCobrosAccionesRouter` (`routers/ficha-cobros-acciones.ts`), montado en `src/index.ts`: `cobrosAppRouter` está en el límite de TS7056 (doc 17). |

---

## Cómo quedó cada tarea

### Común

`getFichaComplementos` resuelve una vez el puente caso → SIFCO → oportunidad → lead (`resolverContextoCaso`, el mismo de referencias; ahora también devuelve el SIFCO) y corre los siete bloques **en paralelo y aislados**: si uno falla, ese bloque vuelve `null` (la ficha lo muestra pendiente), se registra en el log y los demás se devuelven igual. El historial de F4 se carga una sola vez y lo reutiliza el resumen de F7.

### F1 · Datos personales

- **Fuentes:** `renapinfo` (por DPI del lead, sin importar espacios: `eqDpi`), `leads` y `credit_applications` del titular (`person_type` `lead` o NULL, la más reciente).
- **Precedencia por campo:** RENAP → lead → solicitud. Ejemplo: si RENAP no trae la fecha de nacimiento, se toma la del lead aunque el nombre siga saliendo de RENAP.
- **Nombre:** RENAP guarda mayúsculas; se pasa a nombre propio con las partículas en minúscula («María José de la Cruz Pérez de García»). El apellido de casada va con «de».
- **Textos:** sexo «Masculino»/«Femenino» (de `M/F`, `male/female` o `masculino/femenino`). Estado civil concordado con el sexo («Casada»); si no se conoce el sexo, «Casado(a)».
- **Fecha:** `YYYY-MM-DD`. Acepta también `DD/MM/YYYY`; un texto vacío o inválido queda en `null`.
- `null` si el caso no tiene lead (por ejemplo, un SIFCO sin oportunidad).

### F2 · Codeudores

- **Fuentes:** `co_debtors` de la oportunidad del crédito (orden de alta: «Codeudor 1», «Codeudor 2»…) y la solicitud de crédito de cada uno (`person_type = 'coDebtor'`, `person_id = co_debtors.id`), que es la única que guarda sus direcciones.
- **Campos:**
  - correo: el de `co_debtors`, si no el de la solicitud;
  - teléfono principal: el de `co_debtors`, si no el móvil de la solicitud;
  - celular alterno y teléfono de casa: de la solicitud, sin repetir el principal (se comparan solo los dígitos);
  - residencia: dirección de residencia de la solicitud;
  - trabajo: «empresa · dirección de trabajo».
- `[]` si la oportunidad no tiene codeudores; `null` si el caso no tiene oportunidad.
- El `id` es el de `co_debtors`. El Espacio de trabajo ya lo usa: los codeudores aparecen como participantes de la gestión (`gestion-panel.tsx`) sin cambiar el front.

### F3 · Historial de cambios

- **Tabla** `cambios_datos_cliente_cobros`: caso, campo, categoría, valor anterior y nuevo, origen (`ficha_360`, `workspace`, `carga_masiva`, `sistema`), quién y cuándo. Append-only.
- **Quién escribe:** `guardarTelefonosCaso`, `updateContactInfoCobros` y `guardarDireccionesCaso`. Cada una lee el «antes» con `FOR UPDATE`, hace el UPDATE y registra **solo los campos que cambiaron**, todo en la misma transacción (si la bitácora falla, el cambio no se guarda).
- **Origen:** las tres aceptan `origen` opcional (`ficha_360` por defecto, o `workspace`). Hoy solo la ficha las llama, así que el default es el correcto. `carga_masiva` queda reservado: no existe una carga masiva de contactos de cobros.
- **Lectura:** lo más reciente primero, hasta 200. Textos: «Teléfono principal», «Dirección de trabajo»…; categoría «Contacto» o «Direcciones»; autor «Ana Gómez (asesor)» (supervisor, administrador; otros roles solo el nombre); un dato borrado se muestra «Sin dato».
- **De paso:** `updateContactInfoCobros` no validaba el acceso al caso (cualquier usuario de cobros podía cambiar el contacto de un caso ajeno). Ahora llama a `assertAccesoCasoCobro`.

### F4 · Vida del crédito

- **Buckets:** `getBucketsHistorialCredito` de cartera (ya existía). «Ingresó a Bucket B1 · Alerta temprana», «Subió a Bucket B3 · Rescate (desde B2)», «Bajó a Bucket B2 · Gestión Activa (desde B3)».
- **Convenios:** `getConveniosPorCredito(…, "all")`. «Convenio de pago firmado · 6 cuotas de Q1,685.71» en la fecha del convenio, más «Convenio de pago completado» o «Convenio de pago deshecho» (por `anulado_at`). Los pendientes de aprobación no salen; los rechazados tampoco (cartera borra su fila y ya los muestra el historial de decisiones, justo debajo en la ficha).
- **Promesas cumplidas:** `contactos_cobros` con `estado_promesa = 'cumplida'`. La fecha es la de la transición a cumplida en `contactos_cobros_audit` (`{"a": "cumplida"}`); si no está, la fecha prometida.
- **`credito_id`:** por `cartera_back_references` (todos los casos activos locales lo tienen).
- **Si cartera no responde:** se devuelve lo que sí se pudo leer (las promesas). Si además no hay nada, `null` para que la ficha diga «Pronto» y no «Sin hitos registrados».

### F5 · Seguro

- `tipoSeguro`: `vehicles.tipo_cobertura` (`basica`/`amplia`/`total` → «Cobertura básica/amplia/total»; otro valor se muestra tal cual).
- `coberturas`: «Deducible Q2,500.00» si `vehicles.deducible` es mayor que 0.
- **⚠️ Sin datos hoy:** ningún vehículo tiene esas columnas llenas. Para que la tarjeta muestre algo, ventas o el cierre del crédito tienen que capturarlas. Si negocio prefiere un texto fijo por aseguradora, se cambia en `armarSeguro`.

### F6 · Documentos

- **Catálogo** (`getFichaComplementos.documentos`): las seis filas que ya dibuja el front, con las mismas claves y textos. `disponible`:
  - enviar: si hay archivo;
  - solicitar: si no hay otra solicitud pendiente del mismo documento.
- **Archivo a enviar:** el PDF más reciente, primero de `vehicle_documents` y si no de `opportunity_documents`.
  - Tarjeta de circulación: tipos `tarjeta_circulacion` o `vehicle_title`.
  - Seguro: `seguro_vehiculo` (la póliza); si no hay, la cobertura general de `COBERTURA_SEGURO_PDF_URL` (la misma de `send-coverage-document.ts`).
  - Solo PDF: el template lleva header de documento. En la base local hay 883 PDF y 5 JPG de estos tipos.
- **`enviarDocumentoClienteWhatsapp({ casoCobroId, clave })`:** mismo envío que el estado de cuenta: template `mensaje_adjunto`, teléfono del caso, modo de prueba (`TEST_MESSAGE`), cierre con el asesor y traza en `cobros_send_logs` (`plantilla_id` `documento_tarjeta_circulacion` o `documento_seguro`). La URL firmada **no** va al log. Errores: sin SIFCO, sin teléfono, sin documento, falla de envío.
- **Solicitudes** (`solicitudes_documentos_cobros`):
  - `solicitarDocumentoCaso({ casoCobroId, clave, comentario? })`: asesor con acceso al caso. Una segunda pendiente del mismo documento responde CONFLICT («Ya hay una solicitud pendiente de «Expertaje» para este caso.»), garantizado por un índice único parcial.
  - `getSolicitudesDocumentos({ estado?, casoCobroId?, limite })`: solo supervisor y admin. Es la fuente para «documentos por autorizar» de S1 (doc 17) y para el chip «Documentos» de la bandeja de Solicitudes (doc 18).
  - `resolverSolicitudDocumento({ solicitudId, decision, nota? })`: solo supervisor y admin. Solo resuelve pendientes; resolverla dos veces responde CONFLICT.

### F7 · Asistente IA

- **Apagado por defecto:** solo corre con `COBROS_ASISTENTE_IA=on` y `GOOGLE_GENERATIVE_AI_API_KEY`. Apagado: `resumenIA = null` (la ficha muestra «Pronto») y `preguntarAsistenteCaso` responde «El asistente IA todavía no está activo.».
- **Modelo:** `gemini-3-flash-preview`, el mismo de la lectura de boletas. Cero reintentos y 30 s de timeout.
- **Qué ve el modelo:** el estado VIVO del crédito (estado, días de mora, cuotas vencidas, cuota mensual y mora acumulada, leídos de cartera como la ficha; los campos de mora de `casos_cobros` están desactualizados y no se usan), hasta 10 hitos de F4 y las últimas 20 gestiones (fecha, método, resultado, comentario, monto y fecha prometidos, estado de la promesa). **No** se le mandan el nombre, el DPI ni los teléfonos del cliente, y en los comentarios se tapan los números de 8 dígitos o más («[número]»).
- **Resumen** (`resumenes_ia_cobros`, uno por caso): texto de 3 a 5 oraciones y de 1 a 4 etiquetas. Se guarda con la **huella** (hash) de los datos que se le mandaron:
  - misma huella → se devuelve el guardado, sin llamar al modelo;
  - huella distinta → se devuelve el guardado y se regenera atrás;
  - sin guardado → la ficha espera hasta 8 s; si no llega, sigue sin él y queda listo para la próxima vez;
  - si cartera no respondió, no se regenera (la huella cambiaría solo por faltar los hitos);
  - una sola generación en curso por caso.
  - si cartera no responde (ni el crédito ni el historial) no se genera nada con datos a medias: se devuelve el guardado o `null`.
- **Preguntas** (`preguntarAsistenteCaso({ casoCobroId, pregunta })` → `{ respuesta }`): con el mismo contexto, máximo 6 oraciones. Cada pregunta queda en `preguntas_ia_cobros` (también las fallidas) y hay un tope de **30 preguntas por usuario en 24 horas**.

### F8 · Editar direcciones

- **Columnas nuevas** en `casos_cobros`: `direccion_residencia_cobros`, `empresa_trabajo_cobros` y `direccion_trabajo_cobros`. NULL = la de origen.
- **`guardarDireccionesCaso({ casoCobroId, residencia?, trabajo?: { empresa?, direccion? }, origen? })`:** con acceso al caso. Un campo que no viene no se toca; `""` o `null` vuelve a la dirección de origen. Al menos un campo es obligatorio. Cada cambio queda en la bitácora (F3), con el «antes» que la ficha mostraba (la corregida o la de origen).
- **Quién lo lee:**
  - residencia: `getDetallesCreditoCarteraBack` (la usan la ficha y el Espacio de trabajo), `getCasoCobroById` y `getDetallesContrato`;
  - trabajo: `getDatosLaboralesCaso`, campo por campo sobre la solicitud (la tarjeta de trabajo, el Espacio de trabajo y las visitas lo ven sin cambiar el front).

---

## Pruebas hechas (2026-10-08)

**Pruebas unitarias nuevas (33, en verde):**
- `lib/ficha-complementos.test.ts` (13): nombre propio, fechas, sexo y estado civil de las tres fuentes, precedencia por campo, codeudores sin teléfonos repetidos y seguro.
- `lib/ficha-historico.test.ts` (3): textos de bucket, convenios vigente/completado/deshecho/pendiente y promesas mezcladas por fecha.
- `lib/cambios-datos-cliente.test.ts` (10): diferencias campo por campo, textos de la bitácora y dirección de trabajo efectiva.
- `lib/documentos-ficha.test.ts` (3): disponibilidad del catálogo y texto del mensaje.
- `lib/asistente-ia-cobros.test.ts` (4): números tapados, contexto sin datos personales, huella estable y bandera.
- Siguen en verde `ficha-cobros.test.ts`, `visitas-cobros.test.ts`, `gps-eventos-router.test.ts` y `cobros.estadoCuenta.test.ts`.

**Typecheck:** `bunx tsc -b` en el server, sin errores.

**Migración:** la 0078 se aplicó dos veces seguidas en la base local sin errores (idempotente).

**Smoke contra la base local, llamando a los procedimientos reales con `call` de oRPC** (cartera-back local levantado en `:9000`):
- **F1/F2/F5:** caso con RENAP (datos de RENAP, `codeudores: []`); caso con codeudor y solicitud (correo, teléfono, residencia y trabajo); caso sin oportunidad (los tres en `null`).
- **F3/F8:** cambiar teléfono, correo, residencia y dirección de trabajo deja 4 filas en la bitácora con el antes, el después, «Luis Ralda (administrador)» y «Ficha 360»; repetir el mismo teléfono no deja fila; `getDatosLaboralesCaso` devuelve la dirección corregida conservando empresa, puesto y horario; sin ningún campo responde error de validación. Los datos de prueba se revirtieron.
- **F4:** caso con convenio (bucket B3 → B4 y convenio firmado); caso con promesa cumplida (B0 y promesa); caso con subidas y bajadas el mismo día. Con cartera apagada: `null`, o solo las promesas.
- **F6:** catálogo con la tarjeta disponible y el seguro no; la URL firmada del PDF responde 206 con `application/pdf`; solicitar expertaje → la fila pasa a no disponible; repetirla → CONFLICT; la bandeja la lista; un asesor recibe FORBIDDEN en la bandeja; aprobar → «aprobada»; resolver otra vez → CONFLICT. **El envío por WhatsApp** se probó en modo de prueba (`TEST_MESSAGE=true`, sale a `getTestPhone(2)` = 35219722): llegaron los dos PDF (tarjeta de circulación y seguro) con su texto y quedó la traza `documento_tarjeta_circulacion` y `documento_seguro` en `cobros_send_logs`, sin la URL firmada. Un caso sin tarjeta responde «Este crédito no tiene ese documento cargado.»; las 4 solicitudes, el rechazo del asesor (FORBIDDEN), aprobar con nota, rechazar y resolver dos veces (CONFLICT) funcionan.
- **F7:** apagado → `null` y la pregunta responde «no está activo». Encendido: el primer resumen tardó unos 6 s y el segundo salió de caché en 42 ms, sin llamar al modelo. QA en pantalla: el primer resumen decía «al día, 0 días» en un crédito con 23 días de mora (usaba `casos_cobros`); corregido para leer cartera. Con la corrección, la pregunta «¿Cuánto debe pagar hoy?» responde Q6,038.34 (cuota Q4,392.02 + mora Q1,646.32), igual que «Total a pagar hoy» de la ficha.

**Cobertura de datos en la base local (casos activos: 1,378):**
- Con oportunidad: 1,361. Con DPI en el lead: 1,090. Con RENAP: 69.
- Del lead: fecha de nacimiento en 1,086, sexo en 1,024 y estado civil en 1,089.
- Con codeudores: 80 (35 con solicitud del codeudor).
- Con tarjeta de circulación cargada: 263 por oportunidad y 156 por vehículo. Con póliza (`seguro_vehiculo`): 519.

---

## Pendiente de front (no se tocó, por la regla de solo backend)

El backend de todas estas piezas está listo. Las mutaciones nuevas están en `fichaCobrosAccionesRouter`: para usarlas, el front lo agrega al tipo de `orpcAparte` (`web/src/utils/orpc.ts`).

| Qué | Dónde | Detalle |
| --- | --- | --- |
| **Documentos: leer el catálogo y enviar** (F6) | `routes/cobros/$id.tsx` (~4969–5004) y `components/cobros/workspace/contexto-caso.tsx` (~1580–1625) | Hoy las filas están fijas con «Pendiente de backend (tarea F6)». Tomar `disponible` de `complementos.documentos`. «Enviar»: `enviarDocumentoClienteWhatsapp({ casoCobroId, clave })` con confirmación, como el estado de cuenta. «Solicitar»: `solicitarDocumentoCaso({ casoCobroId, clave, comentario? })`. |
| **Bandeja de Solicitudes y Dashboard del supervisor: documentos** (F6, S1) | `components/cobros/solicitudes/bandeja-solicitudes.tsx` (chip «Documentos» en «Pronto») | Fuente: `getSolicitudesDocumentos({ estado: "pendiente" })`. Decidir con `resolverSolicitudDocumento({ solicitudId, decision, nota? })`. |
| **Editar direcciones** (F8) | `routes/cobros/$id.tsx` (~3455, `DireccionCard` con la nota «pendiente de backend (tarea F8)») | Hacer editables las dos tarjetas y guardar con `guardarDireccionesCaso`. Después, invalidar `getDetallesCreditoCarteraBack`, `getDatosLaboralesCaso` y `getFichaComplementos`. |
| **Preguntas al asistente** (F7) | `components/cobros/ficha/ficha-pestanas.tsx` (~578–585, campo «Pregúntele a la IA… (pronto)») | `preguntarAsistenteCaso({ casoCobroId, pregunta })` → `{ respuesta }`. Mostrar el error de tope o de «no está activo». |
| **Fecha del resumen sin formato** (F7) | `components/cobros/ficha/ficha-pestanas.tsx` (`AsistenteIA`) | Muestra «Generado por IA · 2026-10-08T20:28:26.119Z»: formatear `generadoEn` como las demás fechas de la ficha. |
| **Refrescar la ficha tras editar** (F3) | `routes/cobros/$id.tsx` (`guardarContacto`, autoguardado de teléfonos) | `getFichaComplementos` se guarda 5 minutos (`staleTime`) y no se invalida al guardar: el «Historial de cambios» no muestra el cambio hasta recargar. Invalidar `getFichaComplementos` al guardar teléfonos, correo o direcciones. |
| **Origen de los cambios desde el Workspace** (F3) | Donde el Workspace edite teléfonos, correo o direcciones | Mandar `origen: "workspace"`; sin él queda «Ficha 360». Hoy solo la ficha edita. |
| Textos «Pendiente de backend (tarea F2/F4)» | `contexto-caso.tsx:909`, `gestion-panel.tsx:254` | Solo comentarios y textos de respaldo: con datos ya no se ven. Se pueden limpiar. |

---

## Revisión de código (2026-10-08)

Se validó cada punto del review contra la base local y el código:

| Hallazgo | Resultado |
| --- | --- |
| El mensaje de WhatsApp de F6 salía sin nombre ni vehículo cuando el caso no tiene contrato | **Cierto, corregido.** El 56.3% de los casos activos (777 de 1,379) tiene `contrato_id` nulo. Nombre y vehículo salen ahora del contrato y, lo que falte, de la oportunidad y el lead (`combinarDatosMensaje`). Probado con un caso sin contrato: «Edgar Zepeda, te compartimos la tarjeta de circulación de tu Toyota Corolla 2015, placas P-319JJL…». El estado de cuenta (`send-estado-cuenta-whatsapp.ts`) tiene el mismo límite y **no se tocó**: no es de este issue. |
| «de de Méndez» en el apellido de casada | **Cierto, corregido.** 4 de los 64 apellidos de casada de RENAP ya traen «DE». `apellidoDeCasada` no repite la preposición. |
| Teléfonos repetidos en el codeudor | **Cierto, corregido, y más amplio.** Además de celular y casa iguales entre sí (10 de 24 solicitudes), la comparación no reconocía un mismo número con y sin código de país (`50258783734` y `58783734`). Ahora se comparan los últimos 8 dígitos y cada número sale una sola vez. |
| Falta `orderBy` en las solicitudes de codeudores | **No aplica.** `credit_applications` tiene un índice único (`opportunity_id`, `person_type`, `person_id`) y no hay duplicados: cada codeudor tiene como máximo una solicitud. |
| `residenciaDeOrigen` ignora `casos_cobros.direccion_contacto` sin lead | **Parcial, no se cambió.** La ficha muestra «la corregida, si no la del lead» y el «antes» de la bitácora coincide con lo que se veía. La ficha nunca mostró `direccion_contacto` (6 casos tienen dirección en el caso pero no en el lead). Otros procedimientos (`getCasoCobroById`, `getDetallesContrato`) sí la usan de respaldo: es una inconsistencia anterior a este issue. |
| `eqDpi` no usa el índice de `renapinfo` | **Cierto, impacto bajo, no se cambió.** `regexp_replace` sobre la columna evita la llave primaria. `renapinfo` tiene 1,459 filas y `eqDpi` es un helper que ya se usaba en otros lugares. Si en producción la tabla es grande: `CREATE INDEX idx_renap_dpi_normalizado ON renapinfo (regexp_replace(dpi, '\s', '', 'g'))`. |

---

## Para encender el asistente IA (F7)

1. Aprobar el costo.
2. En el server del CRM: `COBROS_ASISTENTE_IA=on` (la `GOOGLE_GENERATIVE_AI_API_KEY` ya existe por el bot).
3. Para apagarlo, quitar la variable: el resumen vuelve a `null` sin redeploy de front.

---

## Secuencia de PRs

| PR | Tareas | Commit local | Migración | Estado |
| --- | --- | --- | --- | --- |
| PR1 | F1 + F2 + F5 y este doc | `f2d94ff73` | — | Esperando QA |
| PR2 | F3 + F8 | `025c51ba6` | Crea la 0078 | Esperando QA |
| PR3 | F4 | `56c456a07` | — | Esperando QA |
| PR4 | F6 + F7 y cierre de docs (15, 21, README) | `88478b027` + docs | Amplía la 0078 | Esperando QA |

Primero José prueba todo en local; después se abre un PR por bloque, de `jalvarez-cobros` hacia `COBROS-02`, y el siguiente no se crea hasta que se mergea el anterior.
