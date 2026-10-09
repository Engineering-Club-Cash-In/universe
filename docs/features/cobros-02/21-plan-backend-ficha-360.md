# 21 · Ficha 360 rediseñada: plan y avance del backend

> **Issue:** #1864 · **Tareas:** F1–F8 del [doc 15](./15-ficha-360-backend.md)
> **Ramas:** una `feat/cobros-ficha-*` por PR, cada una desde `COBROS-02` ya actualizado → PRs secuenciales a `COBROS-02`
> **Regla:** solo backend. El front ya está conectado (PR #1863) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza al cerrar cada PR.

---

## Estado

> [!WARNING]
> **La migración `0078_cobros_ficha_360.sql` (PR2, mergeado) hay que correrla (idempotente) antes de desplegar el server del CRM.** Sin ella, `guardarTelefonosCaso`, `updateContactInfoCobros` y `agregarHallazgoATelefonosCaso` **fallan**, porque escriben la bitácora en la misma transacción. Si ya se corrió antes del commit `707e0c555`, la FK `realizado_por` quedó sin `ON DELETE SET NULL`: ajustarla con `ALTER TABLE public.cambios_datos_cliente_cobros DROP CONSTRAINT cambios_datos_cliente_cobros_realizado_por_fkey, ADD CONSTRAINT cambios_datos_cliente_cobros_realizado_por_fkey FOREIGN KEY (realizado_por) REFERENCES public."user"(id) ON DELETE SET NULL;`. **El PR4 (F6 + F7) la amplía con 3 tablas (`solicitudes_documentos_cobros`, `resumenes_ia_cobros` y `preguntas_ia_cobros`): hay que volver a correrla**, es idempotente. Sin las tablas nuevas, `getFichaComplementos` no se cae (el bloque `documentos` llega `null`), pero solicitar un documento y preguntar a la IA fallan.

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **F1** | Datos personales del titular | ✅ Mergeado (PR1, #1912) | `cargarDatosPersonales` en `lib/ficha-complementos.ts` |
| **F2** | Codeudores | ✅ Mergeado (PR1, #1912) | `cargarCodeudores` en `lib/ficha-complementos.ts` |
| **F3** | Historial de cambios del cliente | ✅ Mergeado (PR2, #1913) | Tabla `cambios_datos_cliente_cobros` · `lib/cambios-datos-cliente.ts` |
| **F4** | Vida del crédito | ✅ Mergeado (PR3, #1917) | `cargarHistorico` en `lib/ficha-complementos.ts` |
| **F5** | Seguro | ✅ Mergeado (PR1, #1912) · ⚠️ sin datos | `cargarSeguro` en `lib/ficha-complementos.ts` |
| **F6** | Documentos | ✅ Backend hecho (PR4, este) · ⚠️ falta cablear el front | `lib/documentos-ficha.ts` · tabla `solicitudes_documentos_cobros` |
| **F7** | Asistente IA | ✅ Hecho (PR4, este), **apagado** (`COBROS_ASISTENTE_IA`) · ⚠️ preguntas sin front | `lib/asistente-ia-cobros.ts` · tablas `resumenes_ia_cobros` y `preguntas_ia_cobros` |
| **F8** | Editar direcciones | ✅ Mergeado (PR2, #1913) · ⚠️ falta cablear el front | `guardarDireccionesCaso` · `lib/direcciones-caso.ts` |

---

## Decisiones (2026-10-08)

| Tarea | Decisión |
| --- | --- |
| F1 | RENAP es la fuente oficial, pero en la base local solo 69 de 1,378 casos activos tienen RENAP. Se toma **campo por campo**: RENAP → lead → solicitud de crédito del titular. |
| F3 | `crm_entity_audit` no guarda el valor anterior ni cubre los casos de cobros: la bitácora es una tabla propia. Sin backfill: el historial arranca cuando se despliegue. |
| F5 | Se leen `vehicles.tipo_cobertura` y `vehicles.deducible`. **Hoy están vacías en todos los vehículos** (2,011 de 2,011 en la base local): la tarjeta sigue mostrando «—» hasta que ventas las capture. |
| F6 | Solicitar al supervisor = la solicitud se **aprueba o rechaza con una nota**. La entrega del documento queda fuera del sistema. Una sola solicitud pendiente por caso y documento. |
| F6 / F8 | Solo backend. El front hoy no llama a esas mutaciones (filas «Pendiente de backend (tarea F6)» fijas y tarjetas de dirección de solo lectura): queda en «Pendiente de front». |
| F7 | Mismo motor que el bot y el análisis bancario: Gemini con `@ai-sdk/google` (`GOOGLE_GENERATIVE_AI_API_KEY`, sin dependencia nueva). Detrás de `COBROS_ASISTENTE_IA=on`, **apagado por defecto** hasta que se apruebe el costo. |
| Migración | Una sola para todo el issue: `0078_cobros_ficha_360.sql`, idempotente. Nace en el PR2 y se amplía en el PR4. |

---

## Cómo quedó cada tarea

### Común

`getFichaComplementos` resuelve una vez el puente caso → oportunidad → lead (`resolverContextoCaso`, el mismo de referencias) y corre los bloques **en paralelo y aislados**: si uno falla, ese bloque vuelve `null` (la ficha lo muestra pendiente), se registra en el log y los demás se devuelven igual.

**Cómo se resuelve la oportunidad del caso** (`resolverContextoCaso`): con contrato vinculado manda el cliente del contrato (`contratoId → contratosFinanciamiento.clientId → clients.opportunityId`, y el lead de esa oportunidad o `clients.leadId`); sin contrato, o si el cliente no tiene oportunidad, se usa la heurística de siempre por SIFCO (la `won`/`migrate` más reciente). Se cambió porque un SIFCO repetido en oportunidades duplicadas u obsoletas podía mostrar los datos de otro lead. Como es un resolver compartido, el cambio también llega a referencias, visitas, GPS, checklist y el contador «referencias por contactar» del Dashboard.

> [!NOTE]
> **Límite conocido:** `clients.opportunityId` es una sola por cliente, no por crédito. Un cliente con varios contratos resuelve todos a la misma oportunidad. En la base local son 9 casos los que cambian de resultado con este orden y en ninguno hay solicitudes ni codeudores en las oportunidades involucradas, así que hoy no se nota. Si en producción un cliente con varios créditos muestra codeudores o trabajo de otro crédito, el arreglo es preferir, entre las oportunidades con el SIFCO del caso, la del lead del cliente del contrato, y usar `clients.opportunityId` solo si no hay ninguna.

Los cargadores y el armado de cada bloque están en `lib/ficha-complementos.ts`. El armado es puro y tiene pruebas en `lib/ficha-complementos.test.ts`.

### F1 · Datos personales

- **Fuentes:** `renapinfo` (por DPI del lead, sin importar espacios: `eqDpi`), `leads` y `credit_applications` del titular (`person_type` `lead` o NULL, la más reciente).
- **Precedencia por campo:** RENAP → lead → solicitud. Ejemplo: si RENAP no trae la fecha de nacimiento, se toma la del lead aunque el nombre siga saliendo de RENAP.
- **Nombre:** RENAP guarda mayúsculas; se pasa a nombre propio con las partículas en minúscula («María José de la Cruz Pérez de García»). El apellido de casada va con «de», salvo que RENAP ya lo traiga («DE MÉNDEZ» no pasa a «de de Méndez»; ocurre en 4 de los 64 apellidos de casada de la base local).
- **Textos:** sexo «Masculino»/«Femenino» (de `M/F`, `male/female` o `masculino/femenino`). Estado civil concordado con el sexo («Casada»); si no se conoce el sexo, «Casado(a)».
- **Fecha:** `YYYY-MM-DD`. Acepta también `DD/MM/YYYY`. Un texto vacío, mal formado o con un día que no existe en el calendario (`31/02/1990`, `1990-13-40`) queda en `null` y la ficha muestra «—».
- `null` si el caso no tiene lead (por ejemplo, un SIFCO sin oportunidad).

### F2 · Codeudores

- **Fuentes:** `co_debtors` de la oportunidad del crédito (orden de alta: «Codeudor 1», «Codeudor 2»…) y la solicitud de crédito de cada uno (`person_type = 'coDebtor'`, `person_id = co_debtors.id`), que es la única que guarda sus direcciones.
- **Campos:**
  - correo: el de `co_debtors`, si no el de la solicitud;
  - teléfono principal: el de `co_debtors`, si no el móvil de la solicitud;
  - celular alterno y teléfono de casa: de la solicitud. Cada número sale una sola vez: no se repite el principal ni el celular y la casa iguales entre sí. Los números se comparan por sus últimos 8 dígitos, así que `50258783734` y `58783734` son el mismo;
  - residencia: dirección de residencia de la solicitud;
  - trabajo: «empresa · dirección de trabajo».
- `[]` si la oportunidad no tiene codeudores; `null` si el caso no tiene oportunidad.
- El `id` es el de `co_debtors`. El Espacio de trabajo ya lo usa: los codeudores aparecen como participantes de la gestión (`gestion-panel.tsx`) sin cambiar el front.

### F3 · Historial de cambios

- **Tabla** `cambios_datos_cliente_cobros`: caso, campo, categoría, valor anterior y nuevo, origen (`ficha_360`, `workspace`, `carga_masiva`, `sistema`), quién y cuándo. Append-only.
- **Quién escribe:** `guardarTelefonosCaso`, `updateContactInfoCobros`, `guardarDireccionesCaso` y `agregarHallazgoATelefonosCaso` (el teléfono que el asesor acepta desde un hallazgo de referencia; solo registra cuando el número realmente se agrega). Cada una lee el «antes» con `FOR UPDATE`, hace el UPDATE y registra **solo los campos que cambiaron**, todo en la misma transacción (si la bitácora falla, el cambio no se guarda).
- **Origen:** las tres aceptan `origen` opcional (`ficha_360` por defecto, o `workspace`). Hoy solo la ficha las llama, así que el default es el correcto. `carga_masiva` queda reservado: no existe una carga masiva de contactos de cobros.
- **Lectura:** lo más reciente primero, hasta 200. Textos: «Teléfono principal», «Dirección de trabajo»…; categoría «Contacto» o «Direcciones»; autor «Ana Gómez (asesor)» (supervisor, administrador; otros roles solo el nombre); un dato borrado se muestra «Sin dato».
- **Autor eliminado:** `realizado_por` es `ON DELETE SET NULL`: eliminar al asesor conserva sus filas y la ficha muestra «Sistema».
- **De paso:** `updateContactInfoCobros` no validaba el acceso al caso (cualquier usuario de cobros podía cambiar el contacto de un caso ajeno). Ahora llama a `assertAccesoCasoCobro`.

### F4 · Vida del crédito

- **Buckets:** `getBucketsHistorialCredito` de cartera (ya existía). «Ingresó a Bucket B1 · Alerta temprana», «Subió a Bucket B3 · Rescate (desde B2)», «Bajó a Bucket B2 · Gestión Activa (desde B3)».
- **Convenios:** `getConveniosPorCredito(…, "all")`. «Convenio de pago firmado · 6 cuotas de Q1,685.71» en la fecha del convenio, más «Convenio de pago completado» o «Convenio de pago deshecho» (por `anulado_at`). Los pendientes de aprobación no salen; los rechazados tampoco (cartera borra su fila y ya los muestra el historial de decisiones, justo debajo en la ficha).
- **Promesas cumplidas:** `contactos_cobros` con `estado_promesa = 'cumplida'`. La fecha es la de la transición a cumplida en `contactos_cobros_audit` (`{"a": "cumplida"}`); si no está, la fecha prometida.
- **`credito_id`:** por `cartera_back_references` (todos los casos activos locales lo tienen).
- **Si cartera no responde:** se devuelve lo que sí se pudo leer (las promesas). Si además no hay nada, `null` para que la ficha diga «Pronto» y no «Sin hitos registrados».

### F5 · Seguro

- **Vehículo:** el del contrato (`casos_cobros.contrato_id → contratos_financiamiento.vehicle_id`), que es el autoritativo (mismo criterio que `resolverVehiculoCasoPagalo`). Solo sin contrato se cae a la oportunidad. En la base local 10 casos con contrato tienen un vehículo distinto al de la oportunidad, y ninguno pierde ni gana póliza.
- **El bloque trae todo el seguro del mismo vehículo:** además de tipo y coberturas, `poliza`, `montoAsegurado` y `vencimiento` (`YYYY-MM-DD`), más `aseguradora` y `telefonoEmergencia`, que salen de `opportunities.insurance_provider` de la oportunidad del caso (`seguroPorAseguradora`). Sin proveedor resuelto (caso sin oportunidad) la aseguradora llega `null`.
- `tipoSeguro`: `vehicles.tipo_cobertura` (`basica`/`amplia`/`total` → «Cobertura básica/amplia/total»; otro valor se muestra tal cual).
- `coberturas`: «Deducible Q2,500.00» si `vehicles.deducible` es mayor que 0.
- **⚠️ Sin datos hoy:** ningún vehículo tiene esas columnas llenas. Para que la tarjeta muestre algo, ventas o el cierre del crédito tienen que capturarlas. Si negocio prefiere un texto fijo por aseguradora, se cambia en `armarSeguro`.

### F6 · Documentos

- **Catálogo** (`getFichaComplementos.documentos`): las seis filas que ya dibuja el front, con las mismas claves y textos. `disponible`:
  - enviar: si hay archivo;
  - solicitar: si no hay otra solicitud pendiente del mismo documento.
- **Archivo a enviar:** el PDF más reciente, primero de `vehicle_documents` y si no de `opportunity_documents`. Con contrato manda el vehículo del contrato: los PDF de la oportunidad solo valen si esta apunta al mismo vehículo. En el mensaje, la oportunidad solo aporta el nombre si es la del cliente del contrato.
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
- **Qué ve el modelo:** el estado VIVO del crédito (estado, días de mora, cuotas vencidas, cuota mensual y mora acumulada, leídos de cartera como la ficha; los campos de mora de `casos_cobros` están desactualizados y no se usan), hasta 10 hitos de F4 y las últimas 20 gestiones (fecha, método, resultado, comentario, monto y fecha prometidos, estado de la promesa). **No** se le mandan el nombre, el DPI ni los teléfonos del cliente, y en los comentarios y en la pregunta del asesor se tapan los números de 8 dígitos o más («[número]»), los correos («[correo]») y las palabras de los nombres de las personas del caso («[nombre]»: titular con todos sus componentes —contrato, lead, RENAP y solicitudes—, codeudores, referencias y cónyuge). Los nombres se leen del cliente del contrato y de la oportunidad resuelta (si difieren, de ambos). Una palabra de cobranza que sea apellido de alguien del caso («Mora», «San») se tapa escrita con mayúscula y se conserva en minúscula. El nombre del cliente en cartera también cuenta como fuente del titular (un caso sin contrato ni oportunidad solo lo conoce cartera). Si no se pueden leer los nombres, o no hay ningún nombre del titular, no se llama al modelo. Con el crédito en mora se resume aunque no haya gestiones ni hitos; al día y sin historial, no.
- **Resumen** (`resumenes_ia_cobros`, uno por caso): texto de 3 a 5 oraciones y de 1 a 4 etiquetas. Se guarda con la **huella** (hash) de los datos que se le mandaron:
  - misma huella → se devuelve el guardado, sin llamar al modelo;
  - huella distinta → se devuelve el guardado y se regenera atrás; si mientras se genera cambian otra vez los datos, la generación nueva espera a la que va y solo corre la más reciente;
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
  - residencia también en **Págalo**: `resolverContactoPagalo` manda la corregida como `ClientContact.location` al crear y regenerar links;
  - trabajo: `getDatosLaboralesCaso` y el **checklist de recuperación** (`tieneDatosLaborales`: la visita al trabajo ya no sale como `sin_datos_laborales` si cobros cargó el dato), campo por campo sobre la solicitud (la tarjeta de trabajo, el Espacio de trabajo y las visitas lo ven sin cambiar el front).

---

## Pruebas hechas

**PR4 (F6, F7), 2026-10-08:**
- Pruebas nuevas: `lib/documentos-ficha.test.ts` (6: disponibilidad del catálogo, texto del mensaje y datos del mensaje sin contrato) y `lib/asistente-ia-cobros.test.ts` (4: números tapados, contexto sin datos personales, huella estable y bandera). 50 en verde junto con las de F1 a F4; `bunx tsc -b` sin errores.
- La 0078 ampliada se aplicó dos veces seguidas en la base local sin errores.
- **F6, con los procedimientos reales** (`call` de oRPC contra la base local, cartera-back en `:9000`): catálogo con la tarjeta y el seguro disponibles; las 4 solicitudes pasan a no disponibles; repetir una pendiente da CONFLICT («Ya hay una solicitud pendiente de «Contrato de crédito» para este caso.»); una clave inválida se rechaza; la bandeja las lista; un asesor recibe FORBIDDEN en la bandeja y al resolver; aprobar con nota «ok» y rechazar con «falta firma» funcionan; resolver otra vez da CONFLICT; un caso sin tarjeta responde «Este crédito no tiene ese documento cargado.». La URL firmada del PDF responde 206 con `application/pdf`.
- **Envío por WhatsApp** (en modo de prueba, `TEST_MESSAGE=true`, sale a `getTestPhone(2)` = 35219722): llegaron los dos PDF (tarjeta de circulación y seguro) con su texto, y quedó la traza `documento_tarjeta_circulacion` y `documento_seguro` en `cobros_send_logs` sin la URL firmada. Con un caso **sin contrato** el mensaje sale con el nombre y el vehículo de la oportunidad: «Edgar Zepeda, te compartimos la tarjeta de circulación de tu Toyota Corolla 2015, placas P-319JJL…».
- **F7:** apagado → `null` y la pregunta responde «El asistente IA todavía no está activo.». Encendido: el primer resumen tarda entre 6 y 8 s, el segundo sale de caché en unos 40 ms sin llamar al modelo. QA en pantalla: el primer resumen decía «al día, 0 días» en un crédito con 23 días de mora (usaba `casos_cobros`); corregido para leer cartera. La pregunta «¿Cuánto debe pagar hoy el cliente para ponerse al día?» responde Q6,038.34 (cuota Q4,392.02 + mora Q1,646.32), igual que «Total a pagar hoy» de la ficha.

**PR3 (F4), 2026-10-08:**
- `lib/ficha-historico.test.ts` (3, en verde): textos de bucket, convenios vigente/completado/deshecho/pendiente y promesas mezcladas por fecha. `bunx tsc -b` sin errores.
- Smoke con cartera-back local (`:9000`) y los cargadores reales: caso con convenio (subió a B4 y convenio firmado en mayo), caso con promesa cumplida (ingreso a B0 y promesa), caso con subidas y bajadas el mismo día. Con cartera apagada: `null`, o solo las promesas.
- **QA en pantalla:** Historial › «Histórico» muestra «Ingresó a Bucket B0 · Cartera Sana» (9 sep) y «Subió a Bucket B1 · Alerta Temprana (desde B0)» (18 sep), lo más reciente primero.

**PR2 (F3, F8), 2026-10-08:**
- `lib/cambios-datos-cliente.test.ts` (10, en verde): diferencias campo por campo, textos de la bitácora y dirección de trabajo efectiva. `bunx tsc -b` sin errores; siguen en verde las pruebas de visitas, GPS y estado de cuenta.
- La 0078 se aplicó dos veces seguidas en la base local sin errores (idempotente).
- Smoke contra la base local llamando a los procedimientos reales con `call` de oRPC: cambiar teléfono, correo, residencia y dirección de trabajo deja 4 filas en la bitácora con el antes, el después, el autor y «Ficha 360»; repetir el mismo teléfono no deja fila; `getDatosLaboralesCaso` devuelve la dirección corregida conservando empresa, puesto y horario; sin ningún campo responde error de validación. Los datos de prueba se revirtieron.
- **Acceso:** un asesor sobre un caso que no es suyo recibe «Caso de cobro no encontrado o sin acceso.» en `updateContactInfoCobros`, `guardarTelefonosCaso` y `guardarDireccionesCaso`; el teléfono del caso queda intacto y no se escribe nada en la bitácora.
- **QA en pantalla:** la pestaña «Historial de cambios» muestra los cambios con su antes y después, el autor y el origen. Hay que recargar la página si se abre justo después de editar (ver «Pendiente de front»).

**PR1 (F1, F2, F5):**
- Pruebas unitarias nuevas en `lib/ficha-complementos.test.ts` (18, en verde): nombre propio, fechas, sexo y estado civil de las tres fuentes, precedencia por campo, apellido de casada con «DE», teléfonos con y sin código de país, codeudores sin números repetidos y seguro con y sin datos.
- `bunx tsc -b` en el server: sin errores.
- Smoke de solo lectura contra la base local, con los cargadores reales:
  - caso con RENAP: nombre, DPI, nacimiento, sexo y estado civil desde RENAP; `codeudores: []`;
  - caso con codeudor y solicitud: el codeudor sale con correo, teléfono, residencia y trabajo;
  - caso sin oportunidad: los tres bloques en `null`.

**Cobertura de datos en la base local (casos activos: 1,378):**
- Con oportunidad: 1,361. Con DPI en el lead: 1,090. Con RENAP: 69.
- Del lead: fecha de nacimiento en 1,086, sexo en 1,024 y estado civil en 1,089.
- Con codeudores: 80 (35 con solicitud del codeudor).

**QA en pantalla (2026-10-08):** con el caso `CRM-9d3bf24a-…` la vista Contacto muestra al titular y los «Codeudor 1» y «Codeudor 2» con correo, teléfono, residencia y trabajo. Un crédito migrado sin lead completo (`01010202101380`) deja los datos personales en «—»: no hay DPI, nacimiento, sexo ni estado civil en ninguna de las tres fuentes.

---

## Revisión de código (2026-10-08)

Comentarios de Codex en el PR, corregidos en el backend (el front quedó fuera, ver «Pendiente de front»):

| Hallazgo | Resultado |
| --- | --- |
| El seguro salía de la oportunidad y no del vehículo del contrato | **Cierto, corregido** en `cargarSeguro` (contrato primero). |
| F1 y F2 podían salir de otro lead si el SIFCO está en oportunidades duplicadas | **Cierto, corregido** en `resolverContextoCaso` (cliente del contrato primero). Con el límite conocido de arriba para clientes con varios contratos. |
| La tarjeta mezclaba póliza, monto, vencimiento y aseguradora de un vehículo con tipo y deducible de otro | **Cierto en el backend, corregido:** el bloque ya trae todos los campos del mismo vehículo. **Falta cablearlo en el front**: está en «Pendiente de front». |
| `fechaISO` aceptaba fechas que no existen | **Cierto, corregido.** |

Comentarios de Codex del PR2 (F3 y F8), corregidos antes del merge:

| Hallazgo | Resultado |
| --- | --- |
| Págalo mandaba la residencia vieja al crear o regenerar un link | **Cierto, corregido** (`direccionResidenciaCasoSql`). Sin corrección guardada devuelve lo mismo que antes. |
| El checklist de recuperación ignoraba el trabajo corregido en la ficha | **Cierto, corregido** (`trabajoEfectivo`). Ahora toma la solicitud más reciente del titular, no cualquiera; hoy no hay ninguna oportunidad con más de una. |
| El teléfono agregado desde un hallazgo no quedaba en la bitácora | **Cierto, corregido** en `agregarHallazgoATelefonosCaso`. |
| Eliminar a un asesor con historial fallaba por la FK | **Cierto, corregido** (`ON DELETE SET NULL`, también en la 0078 porque aún no estaba mergeada). Probado con una transacción que se deshace: la fila se conserva con autor nulo. |

Revisión interna (F6 y F7):

| Hallazgo | Resultado |
| --- | --- |
| El mensaje de WhatsApp de F6 salía sin nombre ni vehículo cuando el caso no tiene contrato | **Cierto, corregido.** El 56.3% de los casos activos (777 de 1,379) tiene `contrato_id` nulo. Nombre y vehículo salen del contrato y, lo que falte, de la oportunidad y el lead (`combinarDatosMensaje`). El estado de cuenta (`send-estado-cuenta-whatsapp.ts`) tiene el mismo límite y **no se tocó**: no es de este issue. |
| El resumen de la IA decía «al día, 0 días» en un crédito con 23 días de mora | **Cierto, corregido.** Usaba los campos de mora de `casos_cobros`, desactualizados; ahora lee cartera como la ficha, y si cartera no responde no genera con datos a medias. |

Revisión de los PRs anteriores:

| Hallazgo | Resultado |
| --- | --- |
| «de de Méndez» en el apellido de casada | **Cierto, corregido** (`apellidoDeCasada`). |
| Teléfonos repetidos en el codeudor | **Cierto, corregido, y más amplio.** Además de celular y casa iguales entre sí (10 de 24 solicitudes), la comparación no reconocía el mismo número con y sin código de país. Ahora se comparan los últimos 8 dígitos. En el caso `CRM-9d3bf24a-…`, el Codeudor 1 ya no repite el teléfono del titular en alterno ni en casa. |
| Falta `orderBy` en las solicitudes de codeudores | **No aplica.** `credit_applications` tiene un índice único (`opportunity_id`, `person_type`, `person_id`) y no hay duplicados: cada codeudor tiene como máximo una solicitud. |
| `eqDpi` no usa el índice de `renapinfo` | **Cierto, impacto bajo, no se cambió.** `regexp_replace` sobre la columna evita la llave primaria. `renapinfo` tiene 1,459 filas y `eqDpi` es un helper que ya se usaba en otros lugares. Si en producción la tabla es grande: `CREATE INDEX idx_renap_dpi_normalizado ON renapinfo (regexp_replace(dpi, '\s', '', 'g'))`. |
| `residenciaDeOrigen` ignora `casos_cobros.direccion_contacto` si el caso no tiene lead (F8) | **Parcial, no se cambió.** La ficha muestra «la corregida, si no la del lead» y el «antes» de la bitácora coincide con lo que se veía; la ficha nunca mostró `direccion_contacto` (6 casos tienen dirección en el caso pero no en el lead). Otros procedimientos (`getCasoCobroById`, `getDetallesContrato`) sí la usan de respaldo: es una inconsistencia anterior a este issue. |

---

## Pendiente de front (no se tocó, por la regla de solo backend)

| Qué | Dónde | Detalle |
| --- | --- | --- |
| **Tarjeta «Seguro»: leer todo del bloque** (F5) | `routes/cobros/$id.tsx` (~3048, `CardSeguroFicha`) | Hoy la tarjeta toma tipo y coberturas de `complementos.seguro` (vehículo del contrato) pero aseguradora, cabina, póliza, monto y vencimiento de `caso.*` (vehículo de la oportunidad): en un caso con vehículo distinto mezcla los dos. Con `complementos.seguro` presente, tomar de ahí `aseguradora`, `telefonoEmergencia`, `poliza`, `montoAsegurado` y `vencimiento` (este último con `parseFechaLocal`, es `YYYY-MM-DD`); solo si el bloque llega `null`, usar `caso.*`. |
| **Editar direcciones** (F8) | `routes/cobros/$id.tsx` (~3455, `DireccionCard` con la nota «pendiente de backend (tarea F8)») | Hacer editables las dos tarjetas y guardar con `guardarDireccionesCaso({ casoCobroId, residencia?, trabajo?: { empresa?, direccion? } })` (en `fichaCobrosAccionesRouter`: se tipa en `orpcAparte`). Después, invalidar `getDetallesCreditoCarteraBack`, `getDatosLaboralesCaso` y `getFichaComplementos`. |
| **Refrescar la ficha tras editar** (F3) | `routes/cobros/$id.tsx` (`guardarContacto` y el autoguardado de teléfonos) | `getFichaComplementos` se guarda 5 minutos (`staleTime`) y no se invalida al guardar: el «Historial de cambios» no muestra el cambio hasta recargar. Invalidar `getFichaComplementos` al guardar teléfonos, correo o direcciones. |
| **Origen de los cambios desde el Workspace** (F3) | Donde el Workspace edite teléfonos, correo o direcciones | Mandar `origen: "workspace"`; sin él queda «Ficha 360». Hoy solo la ficha edita. |
| **Documentos** (F6) | `routes/cobros/$id.tsx` (~4969–5004) y `components/cobros/workspace/contexto-caso.tsx` (~1580–1625) | Hoy las filas están fijas con «Pendiente de backend (tarea F6)». Tomar `disponible` de `complementos.documentos`. «Enviar»: `enviarDocumentoClienteWhatsapp({ casoCobroId, clave })` con confirmación, como el estado de cuenta. «Solicitar»: `solicitarDocumentoCaso({ casoCobroId, clave, comentario? })`. Los procedimientos están en `fichaCobrosAccionesRouter` y se tipan en `orpcAparte`. |
| **Bandeja de Solicitudes y Dashboard del supervisor: documentos** (F6, S1) | `components/cobros/solicitudes/bandeja-solicitudes.tsx` (chip «Documentos» en «Pronto») | Fuente: `getSolicitudesDocumentos({ estado: "pendiente" })`. Decidir con `resolverSolicitudDocumento({ solicitudId, decision, nota? })`. |
| **Preguntas al asistente** (F7) | `components/cobros/ficha/ficha-pestanas.tsx` (~578–585, campo «Pregúntele a la IA… (pronto)») | `preguntarAsistenteCaso({ casoCobroId, pregunta })` → `{ respuesta }`. Mostrar los errores de tope (30 preguntas por usuario cada 24 horas) y «el asistente todavía no está activo». |
| **Fecha del resumen sin formato** (F7) | `components/cobros/ficha/ficha-pestanas.tsx` (`AsistenteIA`) | Muestra «Generado por IA · 2026-10-08T20:28:26.119Z»: formatear `generadoEn` como las demás fechas de la ficha. |
| Textos «Pendiente de backend (tarea F2/F4)» | `contexto-caso.tsx:909`, `gestion-panel.tsx:254` | Solo comentarios y textos de respaldo: con datos ya no se ven. Se pueden limpiar. |

## Para encender el asistente IA (F7)

1. Aprobar el costo.
2. En el server del CRM: `COBROS_ASISTENTE_IA=on` (la `GOOGLE_GENERATIVE_AI_API_KEY` ya existe por el bot).
3. Para apagarlo, quitar la variable: el resumen vuelve a `null` sin redeploy de front.

---

## Secuencia de PRs

| PR | Rama | Tareas | Migración | Estado |
| --- | --- | --- | --- | --- |
| PR1 | `feat/cobros-ficha-datos-contacto` | F1 + F2 + F5 y este doc | — | Mergeado (#1912) |
| PR2 | `feat/cobros-ficha-cambios-direcciones` | F3 + F8 | Crea la 0078 | Mergeado (#1913) |
| PR3 | `feat/cobros-ficha-vida-credito` | F4 | — | Mergeado (#1917) |
| PR4 | `feat/cobros-ficha-documentos-ia` | F6 + F7 y cierre de docs (15, 21, README) | Amplía la 0078 | **Este PR** |

Cada PR sale de `COBROS-02` ya actualizado hacia `COBROS-02`, uno por uno, y la siguiente rama no se crea hasta que se mergea el anterior. Este doc crece con cada PR: lo que aún no se mergeó figura como pendiente.
