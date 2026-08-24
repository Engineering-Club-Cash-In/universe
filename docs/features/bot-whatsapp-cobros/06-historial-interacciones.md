# Historial de interacciones — la conversación del bot en la Ficha 360

**Historia:** [CC2-46](https://clubcashin.atlassian.net/browse/CC2-46) · CB-110 · "Ver
interacciones del bot en el CRM" (transversal)
**Estado:** 🟢 **Contrato cerrado e implementado · 2026-08-24** — decisiones
[D-40 a D-44](./DECISIONES.md) confirmadas por Daniel; migración `0040` corrida el
2026-08-24. Pendiente solo el merge del PR y el despliegue del server.
**Rama:** `feat/cobros02-bot-historial-interacciones` → PR hacia `COBROS-02`

> **📜 Regla general (D-41):** todo servicio del bot —presente y futuro— nace dentro del
> historial. El middleware es comodín sobre `/api/bot/cobros/*`: un endpoint nuevo se
> registra solo, sin tocar nada. Quedar fuera exige entrada justificada en
> `RUTAS_SIN_HISTORIAL`.

---

## La idea en una línea

La conversación del bot **ya tiene un id**: la `referencia` que el paso 1 crea al mandar el
OTP ([D-16](./DECISIONES.md#d-16--quién-valida-el-otp)) y que el bot arrastra en **todas**
las llamadas siguientes ([D-24](./DECISIONES.md#d-24--el-menú-hereda-la-identidad-del-paso-1)).
Lo que falta es **escribir lo que pasa bajo ese id, y enseñárselo al asesor**: cada
referencia es una sesión de conversación, y sus interacciones son cada petición que el bot
le hizo a nuestros servicios en nombre del cliente.

No se crean sesiones nuevas ni se revierte
[D-04](./DECISIONES.md#d-04--dónde-vive-el-estado-de-identidad): la referencia que ya
existe **es** la conversación.

## 1 · Qué ve el asesor

En la Ficha 360 del caso, una sección nueva: **"Actividad en el bot de WhatsApp"**. Las
sesiones del **cliente** (no solo del crédito de la ficha), agrupadas por referencia, la
más reciente primero, colapsadas por defecto:

```
Actividad en el bot de WhatsApp                              3 sesiones
┌───────────────────────────────────────────────────────────────────┐
│ ▸ Referencia 3 · 22 ago 2026, 10:14 · titular · 5 interacciones   │
│ ▾ Referencia 2 · 19 ago 2026, 16:02 · titular · 6 interacciones   │
│     16:02  Entró al bot con DPI (****1234) — código enviado       │
│     16:03  Código incorrecto (intento 1 de 3)                     │
│     16:03  Código validado — se listaron 2 créditos               │
│     16:05  Consultó el menú del crédito 01010214117590            │
│     16:07  Subió una boleta — leída: Q1,500.00 · Banrural         │
│     16:09  Confirmó la boleta — pago registrado en cartera        │
│ ▸ Referencia 1 · 15 ago 2026, 09:30 · codeudor (María Pérez) · 2  │
│ ▸ Intentos de acceso sin sesión (1)                               │
└───────────────────────────────────────────────────────────────────┘
```

Reglas de la vista (detalle en [D-44](./DECISIONES.md#d-44--la-vista-por-referencia-con-correlativo-del-cliente)):

- **El correlativo es del cliente y se calcula al leer**, por orden de creación de la
  sesión: "Referencia 1" es la más vieja. No se guarda.
- **El uuid crudo no se muestra**: durante 30 minutos es la llave de la sesión
  (`verificarAcceso`). Para cruzar con soporte/SimpleTech se muestra un sufijo truncado
  (`…a41f`) en un tooltip.
- Se muestran **todas las sesiones del cliente**: las del titular y las de los codeudores
  de sus oportunidades, etiquetadas con quién operó — esto responde la pregunta 2 que
  [D-11](./DECISIONES.md#d-11--quien-escribe-no-es-el-titular) dejó abierta.
- Interacciones sobre **otro crédito del mismo cliente** se ven igual (el historial es del
  cliente, la ficha solo es la puerta), marcadas con su número SIFCO.
- Una sesión donde el cliente **nunca canjeó el código** se ve como cualquier otra, con su
  única interacción: "Entró al bot — código enviado". No hay que inventarle un estado.

## 2 · Qué se registra

Una fila por **petición del bot a nuestros servicios**. Solo los 6 endpoints que ejecuta
el cliente conversando; `/pagos/evento` (lo dispara cartera), `/docs` y `/openapi.json`
(no son del cliente) quedan fuera.

| `accion` | Endpoint | `detalle` (allowlist, nada más) |
| --- | --- | --- |
| `buscar_cliente` | `POST /buscar-cliente` | tipo de identificador (dpi/nit/placa), identificador **enmascarado**, `celEnCrm`, destino del OTP **enmascarado** (el mismo que ya devuelve el endpoint) |
| `listar_creditos` | `POST /creditos` | éxito: cuántos créditos se listaron · error: el `codigo` ya dice todo (`OTP_INVALIDO` + nº de intento, `DEMASIADOS_INTENTOS`, `OTP_VENCIDO`) |
| `menu_credito` | `POST /credito/info` | `numeroSifco` |
| `estado_cuenta` | `POST /credito/estado-cuenta` | `numeroSifco` |
| `boleta_leer` | `POST /boleta/leer` | `numeroSifco`, `boletaId`, nº de intento (1–3), resultado, y si se leyó: monto y banco |
| `boleta_confirmar` | `POST /boleta/confirmar` | `numeroSifco`, `boletaId`, resultado (`confirmada`/`rechazada`/…), cuántos pagos creó cartera |
| `acceso_fallido` | `POST /buscar-cliente` que **encontró al cliente pero no emitió OTP** | el `codigo` (`DEMASIADOS_ENVIOS`, `SIN_TELEFONO_REGISTRADO`, `OTP_NO_ENVIADO`) — ver [D-43](./DECISIONES.md#d-43--los-intentos-fallidos-con-cliente-conocido-también-se-registran) |
| *(futuros)* | cualquier ruta nueva bajo `/api/bot/cobros/*` | acción derivada de la ruta; `detalle` vacío hasta que se le escriba curador (regla general de D-41) |

**Los errores también son interacciones** (`exito = false` + `codigo`): un cliente que
probó tres códigos y se bloqueó es exactamente lo que el asesor necesita ver para entender
la llamada que va a recibir.

**Lo que NUNCA se guarda** ([D-42](./DECISIONES.md#d-42--qué-guarda-cada-interacción-y-qué-nunca)):
el código OTP, teléfonos completos, el identificador de búsqueda crudo, las URLs de imagen
de WhatsApp, ni el cuerpo crudo de requests/responses. El `detalle` es una **allowlist por
acción**; lo que no está en la lista no se escribe. La foto de la boleta y su lectura
completa ya viven en `bot_cobros_boletas` — acá solo viaja el `boletaId` que las enlaza.

## 3 · Cómo se registra

Un **middleware de Hono sobre las 6 rutas del bot**
([D-41](./DECISIONES.md#d-41--el-registro-es-un-middleware-y-jamás-rompe-la-respuesta)),
que corre después del handler:

1. Saca la `referencia` del body de la request (o de la **respuesta**, en
   `buscar-cliente`, que es quien la crea).
2. Lee `success`/`codigo` del clon de la respuesta y el estado HTTP.
3. Pasa request y respuesta por el **curador** de esa acción — la allowlist del §2 — para
   armar `detalle`. Una ruta sin curador registra igual (acción + éxito + código), con
   `detalle` vacío: segura por defecto.
4. Resuelve la identidad al escribir: `otp_id → lead_id` directo, o
   `co_debtor_id → opportunity → lead_id` cuando operó un codeudor. La fila guarda ambos.
5. **Inserta sin `await` y se traga sus errores** (try/catch + log). El mismo espíritu de
   [D-28](./DECISIONES.md#d-28--el-aviso-a-whatsapp-nunca-rompe-la-acción-de-conta): el
   registro jamás le agrega latencia ni un 500 al bot. Si la escritura falla, se pierde
   una fila de historial, no una conversación.

**El contrato con SimpleTech no cambia en nada**: ni rutas nuevas de bot, ni códigos
nuevos, ni un campo más en ninguna respuesta. Por eso el Swagger
([D-23](./DECISIONES.md#d-23--la-documentación-de-la-api-es-swagger-y-es-obligatoria)) no
se toca y `openapi.test.ts` sigue en verde sin cambios.

## 4 · El modelo de datos

Tabla nueva en el CRM ([D-40](./DECISIONES.md#d-40--el-historial-vive-en-el-crm-en-su-propia-tabla)) —
cartera no se entera de que esto existe:

```sql
CREATE TABLE bot_cobros_interacciones (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	-- La referencia = la sesión. SET NULL, nunca CASCADE: purgar un OTP vencido
	-- (D-14) no puede llevarse el historial. Mismo criterio que bot_cobros_boletas.
	otp_id uuid REFERENCES otps(id) ON DELETE SET NULL,
	-- El MISMO id pero SIN FK (Codex, PR #1411): el SET NULL de arriba borra
	-- otp_id con la purga, y sin esta copia las sesiones se desagrupaban. Es la
	-- llave de agrupado de la ficha; NULL solo si la sesión nunca existió (D-43).
	sesion_id uuid,
	-- Identidad propia, resuelta al escribir, para sobrevivir a la purga y para
	-- que la consulta de la ficha sea un WHERE lead_id = … sin joins acrobáticos.
	lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
	co_debtor_id uuid REFERENCES co_debtors(id) ON DELETE SET NULL,
	accion text NOT NULL,
	exito boolean NOT NULL,
	codigo text,                -- OTP_INVALIDO, DEMASIADOS_INTENTOS, … (null si éxito)
	numero_sifco text,          -- solo en acciones sobre un crédito
	detalle jsonb,              -- la allowlist del §2, nada más
	creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_cobros_interacciones_lead_idx ON bot_cobros_interacciones (lead_id, creado_en DESC);
CREATE INDEX bot_cobros_interacciones_otp_idx ON bot_cobros_interacciones (otp_id);
CREATE INDEX bot_cobros_interacciones_codebtor_idx ON bot_cobros_interacciones (co_debtor_id);
```

- `accion` va como `text` y no como enum de Postgres, por la misma razón que
  `bot_cobros_boletas.estado`: van a aparecer acciones nuevas (paso 3, paso 5) y un enum
  en producción es una migración con lock cada vez.
- **Sin retención en v1**: las filas no llevan PII (el §2 lo garantiza), así que no las
  alcanza la purga propuesta en [D-14](./DECISIONES.md#d-14--retención-de-pii-y-logs). Si
  esa decisión al cerrarse dice otra cosa, se ajusta acá.
- Migración: `0040_bot_cobros_interacciones.sql` — **la corre Daniel**, como siempre.

## 5 · La consulta de la ficha

Un procedure **ORPC protegido** en el router de cobros (interno del CRM — no es un
endpoint del bot, no va al Swagger): `getActividadBot({ casoId })`.

1. Del caso sale el lead (el puente que la ficha ya usa).
2. Se juntan los codeudores de sus oportunidades.
3. `bot_cobros_interacciones WHERE lead_id = ? OR co_debtor_id IN (…)`, ordenado por
   `creado_en`.
4. Se agrupa por `sesion_id` (las `acceso_fallido`, sin sesión, van a su propio grupo),
   se numera por orden de primera interacción, y se devuelve listo para pintar: la web
   no calcula nada.

**Tres ajustes de la revisión de Codex (PR #1411):**

- **La llave de agrupado es `sesion_id`, no `otp_id`**: la purga de OTPs (D-14) pone
  `otp_id` en NULL vía el FK, y sin la copia sin FK las sesiones reales se desagrupaban
  y caían a "intentos sin sesión". Migración `0041`.
- **La consulta también matchea por SIFCO del lead**: una persona que es codeudor en
  créditos de dos leads queda guardada con la fila de `co_debtors` que eligió la
  identificación (la del crédito más reciente — puede ser del otro lead). Si la gestión
  fue sobre un crédito de ESTE lead, su ficha la muestra igual; la sesión tocada se
  completa con sus filas sin SIFCO (buscar/listar) para no mostrar conversaciones a
  pedazos.
- **Los rechazos de la autenticación no se registran** (`NO_AUTORIZADO`,
  `SERVICIO_NO_DISPONIBLE`): el comodín envuelve también a `autenticarBotCobros`, y una
  API key mala con una referencia real en el body no es una interacción del cliente.

## 6 · Lo que este feature NO es

- **No es auditoría de seguridad** ni reemplaza los logs del servidor: es la vista de
  negocio para el asesor.
- **No toca cartera-back** — ni un endpoint, ni una columna
  ([D-38](./DECISIONES.md#d-38--cartera-solo-se-toca-con-endpoints-nuevos) ni se ejercita:
  todo el tráfico del bot ya pasa por el CRM,
  [D-01](./DECISIONES.md#d-01--punto-de-acceso-único)).
- **No cambia nada del contrato con SimpleTech**: el bot no sabe que esto existe.
- **No duplica `bot_cobros_boletas`**: esa tabla sigue siendo la fuente de verdad de las
  boletas; el historial solo la referencia.
- **No le escribe al cliente** ni dispara notificaciones: solo muestra.

## 7 · Decisiones asociadas

| # | Tema | Estado |
| --- | --- | --- |
| [D-40](./DECISIONES.md#d-40--el-historial-vive-en-el-crm-en-su-propia-tabla) | El historial vive en el CRM, en su propia tabla | 🟢 |
| [D-41](./DECISIONES.md#d-41--el-registro-es-un-middleware-y-jamás-rompe-la-respuesta) | El registro es un middleware, y jamás rompe la respuesta | 🟢 |
| [D-42](./DECISIONES.md#d-42--qué-guarda-cada-interacción-y-qué-nunca) | Qué guarda cada interacción (y qué nunca) | 🟢 |
| [D-43](./DECISIONES.md#d-43--los-intentos-fallidos-con-cliente-conocido-también-se-registran) | Los intentos fallidos con cliente conocido también se registran | 🟢 |
| [D-44](./DECISIONES.md#d-44--la-vista-por-referencia-con-correlativo-del-cliente) | La vista: por referencia, con correlativo del cliente | 🟢 |

## 8 · Plan de implementación (ejecutado)

Todo en `feat/cobros02-bot-historial-interacciones`, PR hacia `COBROS-02`:

1. **Schema + migración 0040** (`db/schema/bot-cobros-interacciones.ts`) — archivo listo,
   la corre Daniel.
2. **Middleware + curadores** (`lib/bot-cobros/historial.ts`) con sus pruebas: una por
   acción (allowlist exacta), una de "no rompe la respuesta si la DB explota", una de "no
   registra el código OTP ni con curador malicioso".
3. **`getActividadBot`** en el router de cobros + agrupado/numerado, con pruebas.
4. **La sección en la Ficha 360** (`routes/cobros/$id.tsx`) + actualizar
   [`06-ficha-360.md`](../cobros-02/06-ficha-360.md) de COBROS-02 con la sección nueva.
