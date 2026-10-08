# 21 · Ficha 360 rediseñada: plan y avance del backend

> **Issue:** #1864 · **Tareas:** F1–F8 del [doc 15](./15-ficha-360-backend.md)
> **Ramas:** una `feat/cobros-ficha-*` por PR, cada una desde `COBROS-02` ya actualizado → PRs secuenciales a `COBROS-02`
> **Regla:** solo backend. El front ya está conectado (PR #1863) y no se toca. Lo que el front tenga que cablear queda en «Pendiente de front».

Este documento lleva el plan, las decisiones y el estado de cada tarea. Se actualiza al cerrar cada PR.

---

## Estado

> [!WARNING]
> **Este PR trae la migración `0078_cobros_ficha_360.sql`: hay que correrla (idempotente) antes de desplegar el server del CRM.** Sin ella, `guardarTelefonosCaso` y `updateContactInfoCobros` **fallan**, porque escriben la bitácora en la misma transacción, y el detalle del caso lee las columnas nuevas de `casos_cobros`. `getFichaComplementos` no se cae (cada bloque está aislado), pero el historial de cambios llega `null`.

| Tarea | Qué es | Estado | Dónde quedó |
| --- | --- | --- | --- |
| **F1** | Datos personales del titular | ✅ Mergeado (PR1, #1912) | `cargarDatosPersonales` en `lib/ficha-complementos.ts` |
| **F2** | Codeudores | ✅ Mergeado (PR1, #1912) | `cargarCodeudores` en `lib/ficha-complementos.ts` |
| **F3** | Historial de cambios del cliente | ✅ Hecho (PR2, este) | Tabla `cambios_datos_cliente_cobros` · `lib/cambios-datos-cliente.ts` |
| **F4** | Vida del crédito | ⏳ PR3 | Historial de buckets + convenios + promesas cumplidas |
| **F5** | Seguro | ✅ Mergeado (PR1, #1912) · ⚠️ sin datos | `cargarSeguro` en `lib/ficha-complementos.ts` |
| **F6** | Documentos | ⏳ PR4 | Catálogo, envío por WhatsApp y solicitudes al supervisor |
| **F7** | Asistente IA | ⏳ PR4 | Gemini detrás de `COBROS_ASISTENTE_IA=on` (apagado) |
| **F8** | Editar direcciones | ✅ Backend hecho (PR2, este) · ⚠️ falta cablear el front | `guardarDireccionesCaso` · `lib/direcciones-caso.ts` |

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
- **Quién escribe:** `guardarTelefonosCaso`, `updateContactInfoCobros` y `guardarDireccionesCaso`. Cada una lee el «antes» con `FOR UPDATE`, hace el UPDATE y registra **solo los campos que cambiaron**, todo en la misma transacción (si la bitácora falla, el cambio no se guarda).
- **Origen:** las tres aceptan `origen` opcional (`ficha_360` por defecto, o `workspace`). Hoy solo la ficha las llama, así que el default es el correcto. `carga_masiva` queda reservado: no existe una carga masiva de contactos de cobros.
- **Lectura:** lo más reciente primero, hasta 200. Textos: «Teléfono principal», «Dirección de trabajo»…; categoría «Contacto» o «Direcciones»; autor «Ana Gómez (asesor)» (supervisor, administrador; otros roles solo el nombre); un dato borrado se muestra «Sin dato».
- **De paso:** `updateContactInfoCobros` no validaba el acceso al caso (cualquier usuario de cobros podía cambiar el contacto de un caso ajeno). Ahora llama a `assertAccesoCasoCobro`.

### F5 · Seguro

- **Vehículo:** el del contrato (`casos_cobros.contrato_id → contratos_financiamiento.vehicle_id`), que es el autoritativo (mismo criterio que `resolverVehiculoCasoPagalo`). Solo sin contrato se cae a la oportunidad. En la base local 10 casos con contrato tienen un vehículo distinto al de la oportunidad, y ninguno pierde ni gana póliza.
- **El bloque trae todo el seguro del mismo vehículo:** además de tipo y coberturas, `poliza`, `montoAsegurado` y `vencimiento` (`YYYY-MM-DD`), más `aseguradora` y `telefonoEmergencia`, que salen de `opportunities.insurance_provider` de la oportunidad del caso (`seguroPorAseguradora`). Sin proveedor resuelto (caso sin oportunidad) la aseguradora llega `null`.
- `tipoSeguro`: `vehicles.tipo_cobertura` (`basica`/`amplia`/`total` → «Cobertura básica/amplia/total»; otro valor se muestra tal cual).
- `coberturas`: «Deducible Q2,500.00» si `vehicles.deducible` es mayor que 0.
- **⚠️ Sin datos hoy:** ningún vehículo tiene esas columnas llenas. Para que la tarjeta muestre algo, ventas o el cierre del crédito tienen que capturarlas. Si negocio prefiere un texto fijo por aseguradora, se cambia en `armarSeguro`.

### F8 · Editar direcciones

- **Columnas nuevas** en `casos_cobros`: `direccion_residencia_cobros`, `empresa_trabajo_cobros` y `direccion_trabajo_cobros`. NULL = la de origen.
- **`guardarDireccionesCaso({ casoCobroId, residencia?, trabajo?: { empresa?, direccion? }, origen? })`:** con acceso al caso. Un campo que no viene no se toca; `""` o `null` vuelve a la dirección de origen. Al menos un campo es obligatorio. Cada cambio queda en la bitácora (F3), con el «antes» que la ficha mostraba (la corregida o la de origen).
- **Quién lo lee:**
  - residencia: `getDetallesCreditoCarteraBack` (la usan la ficha y el Espacio de trabajo), `getCasoCobroById` y `getDetallesContrato`;
  - trabajo: `getDatosLaboralesCaso`, campo por campo sobre la solicitud (la tarjeta de trabajo, el Espacio de trabajo y las visitas lo ven sin cambiar el front).

---

## Pruebas hechas

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

Revisión interna:

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
| *(se completa con F6 y F7)* | | |

---

## Secuencia de PRs

| PR | Rama | Tareas | Migración | Estado |
| --- | --- | --- | --- | --- |
| PR1 | `feat/cobros-ficha-datos-contacto` | F1 + F2 + F5 y este doc | — | Mergeado (#1912) |
| PR2 | `feat/cobros-ficha-cambios-direcciones` | F3 + F8 | Crea la 0078 | **Este PR** |
| PR3 | `feat/cobros-ficha-vida-credito` | F4 | — | Pendiente |
| PR4 | `feat/cobros-ficha-documentos-ia` | F6 + F7 y cierre de docs (15, 21, README) | Amplía la 0078 | Pendiente |

Cada PR sale de `COBROS-02` ya actualizado hacia `COBROS-02`, uno por uno, y la siguiente rama no se crea hasta que se mergea el anterior. Este doc crece con cada PR: lo que aún no se mergeó figura como pendiente.
