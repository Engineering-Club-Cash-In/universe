# Registro de decisiones — bot de cobros

Cada decisión de diseño del feature vive acá: qué se preguntó, qué opciones había, qué se
eligió y por qué. Si algo se decide en una llamada o por WhatsApp, se escribe acá el mismo
día; si no está escrito, no está decidido.

**Estados:** 🟢 Cerrada · 🟡 Propuesta (recomendación de IT, falta confirmar) · 🔴 Abierta (bloquea trabajo)

| # | Tema | Estado |
| --- | --- | --- |
| [D-01](#d-01--punto-de-acceso-único) | Punto de acceso único | 🟢 |
| [D-02](#d-02--quién-compara-el-teléfono-del-chat) | Quién compara el teléfono del chat | 🟢 |
| [D-03](#d-03--segundo-factor-cuando-el-número-no-coincide) | Segundo factor | 🟢 |
| [D-04](#d-04--dónde-vive-el-estado-de-identidad) | Dónde vive el estado de identidad | 🟢 |
| [D-05](#d-05--cómo-se-reporta-no-encontrado) | Cómo se reporta "no encontrado" | 🟡 |
| [D-06](#d-06--ttl-de-la-sesión-y-caducidad-de-la-verificación) | TTL de sesión y de la verificación | 🟢 (no aplica) |
| [D-07](#d-07--otp-de-cobros-reuso-o-endpoints-nuevos) | OTP de cobros | 🟢 |
| [D-08](#d-08--qué-es-un-crédito-activo-listable) | Qué es un "crédito activo" | 🔴 (se movió al Paso 2) |
| [D-09](#d-09--normalización-de-placa-y-nit) | Normalización de placa y NIT | 🟢 |
| [D-10](#d-10--ambiente-de-pruebas-para-simpletech) | Ambiente de pruebas | 🔴 |
| [D-11](#d-11--quien-escribe-no-es-el-titular) | Quien escribe no es el titular | 🟢 (parcial) |
| [D-12](#d-12--términos-y-condiciones) | Términos y condiciones | 🔴 |
| [D-13](#d-13--canal-del-otp) | Canal del OTP | 🟢 |
| [D-14](#d-14--retención-de-pii-y-logs) | Retención de PII y logs | 🟡 |
| [D-15](#d-15--convenio-y-promesa-de-pago-bloqueados) | Convenio y promesa de pago: bloqueados | 🔴 |
| [D-16](#d-16--quién-valida-el-otp) | Quién valida el OTP | 🟢 |
| [D-17](#d-17--qué-oportunidades-cuentan-como-crédito) | Qué oportunidades cuentan como crédito | 🟢 |
| [D-18](#d-18--autenticación-del-bot-api-key) | Autenticación del bot: API key | 🟢 |
| [D-19](#d-19--a-qué-teléfono-se-manda-el-otp) | A qué teléfono se manda el OTP | 🟢 |
| [D-20](#d-20--el-dpi-se-busca-también-en-codeudores) | ¿El DPI se busca en codeudores? | 🟢 |

---

## D-01 · Punto de acceso único

**Estado:** 🟢 Cerrada · 2026-08-13

**Contexto.** El bot necesita datos del cliente (CRM) y del crédito (cartera-back).

**Opciones.**
- **A) El CRM es el único punto de acceso** y agrega lo que haga falta de cartera.
- B) SimpleTech consume ambos backends directo.
- C) Un servicio nuevo (BFF) dedicado al bot.

**Decisión: A.** La identidad del cliente vive en el CRM y cartera ni siquiera guarda
teléfonos; además concentra auth, rate limiting, auditoría y enmascarado en un solo lugar,
y evita exponer a un tercero el sistema que mueve el dinero. C se descarta por costo de
infraestructura para el volumen esperado: si el bot crece, se puede extraer después.

---

## D-02 · Quién compara el teléfono del chat

**Estado:** 🟢 Cerrada · 2026-08-13

**Contexto.** Hay que decidir si el número desde el que escribe el cliente coincide con
alguno de los registrados. La descripción original del flujo era: el CRM devuelve la lista
de teléfonos y SimpleTech compara.

**Opciones.**
- **A) El CRM compara.** El bot manda `telefonoChat` en `/identificar`; el CRM responde
  `verificada` o `requiere_otp` y una lista **enmascarada**.
- B) SimpleTech compara. El CRM devuelve los teléfonos completos.

**Decisión: A** — cerrada el 2026-08-13. El bot manda el teléfono del chat en el servicio 1 y
el CRM responde `celEnCrm: true|false`. Los números completos del cliente nunca salen de
nuestros servidores; el bot solo recibe el destino del OTP enmascarado.

---

## D-03 · Segundo factor cuando el número no coincide

**Estado:** 🟢 **Cerrada · 2026-08-13**

**Decisión: el OTP se envía SIEMPRE**, coincida o no el número desde el que escribe. Lo que
cambia es **a dónde se manda**:

- El `search` resultó ser de un **codeudor** → al teléfono del codeudor (`co_debtors.phone`).
- El `search` es del **titular** → a su **teléfono principal** (el primero, cuando el campo
  trae varios separados por `,` o `/`).

`celEnCrm` se sigue devolviendo como información para el bot y para auditoría, pero **no
decide** si se manda el código. Validación de vida: descartada por ahora.

<details><summary>Contexto previo (las fuentes se contradecían)</summary>

**Contexto.** Las dos fuentes se contradicen:

- **Presentación a gerencia:** "OTP si número ≠ CRM", con "validación de vida como paso
  opcional adicional". Es decir, quien escribe desde su número registrado **no** pasa OTP.
- **Documento detallado (`FlujoBotCobros.pdf`):** hay OTP **siempre**. Si escribe desde el
  número del CRM **o desde el de un codeudor**, el OTP va a ese número; si no es ninguno de
  esos, el OTP se manda **al número principal** del titular.

**Opciones.**
- A) OTP **solo** cuando el número no coincide (menos fricción; lo asumido en los contratos
  del Paso 1 §3).
- B) OTP **siempre**, cambiando el destino según coincida o no (lo del documento detallado).
- C) OTP siempre, pero con "recordar" el dispositivo por N días para no repetirlo en cada
  consulta.
- D) Cualquiera de las anteriores + validación de vida (existe `livenessController` en el
  CRM) solo para gestiones sensibles.

**A considerar.** B es más seguro pero le agrega un paso a **todos** los clientes, incluidos
los que solo quieren ver su saldo.

</details>

**Se eligió B.**

---

## D-04 · Dónde vive el estado de identidad

**Estado:** 🟢 **Cerrada · 2026-08-13**

**Opciones.**
- A) Sesión en el CRM con token opaco. El bot guarda solo el `sesionId`.
- **B) Sin sesión: el bot reenvía `search` + `telefono` en cada llamada.**

**Decisión: B**, para esta primera versión. Dos servicios sin estado, sin tabla de sesiones,
sin TTL que administrar. Es lo más simple que funciona y se entrega antes.

**Lo que se pierde y cómo se cubre:** sin sesión no hay un "ya verificó" persistido, así que
el servicio 2 **valida el OTP en la misma llamada** en la que devuelve los créditos (ver
[D-16](#d-16--quién-valida-el-otp)) — ahí está el control de acceso. Si más adelante
aparecen flujos con varios pasos (pagos, boletas), se agrega la sesión entonces.

---

## D-05 · Cómo se reporta "no encontrado"

**Estado:** 🟡 Propuesta

**Opciones.**
- **A) HTTP 200 con `estado: "no_encontrado"`.**
- B) HTTP 404.

**Recomendación de IT: A.** Que el cliente escriba mal su DPI no es una falla técnica; con
404 los motores de bot suelen rutear a la rama de error genérico y el cliente pierde el
hilo. Los 404 se reservan para rutas inexistentes. Los errores reales sí llevan su código
HTTP (401, 429, 503).

---

## D-06 · TTL de la sesión y caducidad de la verificación

**Estado:** 🟢 **No aplica · 2026-08-13** — no hay sesiones ([D-04](#d-04--dónde-vive-el-estado-de-identidad)).
Lo único que caduca es el OTP: 5 minutos, un solo uso. Se retoma si en algún paso futuro
aparecen sesiones.

<details><summary>Preguntas que quedaron guardadas para entonces</summary>

**Preguntas.**
1. ¿Cuánto dura una sesión? (propuesta: 15 min, renovable con actividad)
2. ¿Cuánto dura la verificación? Si el cliente vuelve dos horas después desde el mismo
   número, ¿repite el OTP?
3. ¿Se puede "recordar" un número no registrado que ya pasó OTP, para no pedírselo cada
   vez? Si sí, ¿por cuánto tiempo y con qué registro?

Es un balance entre fricción y seguridad; lo define Cobros con IT.

</details>

---

## D-07 · OTP de cobros: ¿reuso o endpoints nuevos?

**Estado:** 🟢 **Cerrada · 2026-08-13** — se eligió **A**: los servicios del bot de cobros
reusan `otpController` (generación, SMS, TTL, intentos) **sin** el efecto secundario de
Infornet. El envío es **por SMS**, que es justo lo que ese controller ya hace.

**Contexto.** El CRM ya tiene OTP funcionando para el bot de ventas: `otpController`
(`controllers/otp.ts`), tabla `otps`, códigos de 4 dígitos, formato `502XXXXXXXX`, y los
endpoints públicos `/info/send-otp` y `/info/validate-otp`.

**El problema:** `/info/validate-otp`, cuando el código es correcto, **consulta Infornet
(buró) y corre un análisis de riesgo**. Tiene sentido en ventas; en cobros sería pagar una
consulta de buró por cada cliente que entra al bot, para nada.

**Opciones.**
- **A) Endpoints nuevos de cobros que reusan `otpController`** (generación, TTL, intentos)
  sin el efecto secundario de Infornet, y atados a la sesión en vez de al DPI.
- B) Agregar una bandera a los endpoints existentes para saltarse Infornet.
- C) Sistema de OTP separado.

**Recomendación de IT: A.** B mete lógica de dos flujos en un endpoint público sin
autenticación —el de ventas hoy no la tiene— y cualquier error futuro ahí impacta a los
dos bots. C duplica código sin motivo.

---

## D-08 · Qué es un "crédito activo" listable

**Estado:** 🔴 Abierta — **ya no bloquea el Paso 1.** El listado del bot sale de las
oportunidades del CRM, sin consultar cartera ([D-17](#d-17--qué-oportunidades-cuentan-como-crédito)).
Estas preguntas se resuelven en el **Paso 2**, cuando el cliente selecciona un crédito y sí
se consulta cartera.

**Preguntas para Cartera/Cobros.**
1. ¿Qué estados de cartera se listan? ¿Vigente y en mora, obviamente; y los que están en
   convenio? ¿Los incobrables? ¿Los que están en proceso legal?
2. ¿Un crédito **liquidado** se muestra? (probablemente sí para "estado de cuenta", pero no
   para pagar — puede ser distinto por paso).
3. ¿Los créditos **insolutos** entran al bot?
4. ¿Qué se hace con un crédito que en cartera aparece pero cuya oportunidad en el CRM no
   tiene `numero_sifco`?

Sin esto, el endpoint de listado no se puede escribir sin adivinar.

---

## D-09 · Normalización de placa y NIT

**Estado:** 🟢 **Cerrada · 2026-08-13**

**Decisión: la placa tiene letras, el NIT no.** El orden de clasificación de `search` es:

1. **13 dígitos** → DPI (se valida con `validarDpi`, se busca con `eqDpi`)
2. **Tiene letras** → placa
3. **Solo dígitos** → NIT

Antes de clasificar se normaliza: se quitan guiones y espacios, y se pasa a mayúsculas.

**Salvedad a revisar contra los datos:** el NIT guatemalteco puede llevar **`K` como dígito
verificador** (`1234567-K`). Con la regla de arriba ese NIT caería como placa. Si existen NIT
así en la base, hay que agregar la excepción: una sola `K` al final ⇒ NIT.

---

## D-10 · Ambiente de pruebas para SimpleTech

**Estado:** 🔴 Abierta

**Preguntas.**
1. ¿SimpleTech apunta al CRM de dev durante el desarrollo, o solo a producción?
2. ¿Hay un número de WhatsApp de pruebas, o se prueba con el de cobranza (CB-100)?
3. ¿Qué datos de prueba necesitan? (cliente con un crédito, con varios, sin créditos, en
   mora, número no registrado).

Sin ambiente de pruebas, el primer despliegue se prueba contra clientes reales.

---

## D-11 · Quien escribe no es el titular

**Estado:** 🟢 **Parcialmente cerrada · 2026-08-13**

**Decidido:** el **DPI de un codeudor identifica al cliente**. Se busca en `leads.dpi` y en
`co_debtors.dpi`, y si el match es un codeudor, el OTP va al teléfono **del codeudor** y se
listan las oportunidades donde aparece como tal.

**Sigue abierto:** si el codeudor puede hacer las mismas gestiones que el titular (pagar,
convenir) o solo consultar, y si queda registrado cuál de los dos hizo cada gestión.

**Contexto.** Casos reales: la esposa que administra el crédito, un hijo, el contador de la
empresa. El OTP no distingue: si tiene el teléfono del titular, entra.

El documento detallado responde una parte: **los codeudores sí cuentan** como números
válidos del crédito. El CRM ya tiene `co_debtors` con sus teléfonos.

**Preguntas.**
1. ¿Se confirma que un **codeudor** puede identificarse y operar el crédito? ¿Con las mismas
   gestiones que el titular, o solo consultar?
2. ¿Queda registrado **quién** de los dos hizo cada gestión? (debería: es evidencia)
3. ¿Se acepta que un tercero con acceso al teléfono registrado consulte? (hoy, de facto, sí)
4. ¿Se permite registrar **autorizados** por crédito, con su propio teléfono?
5. ¿Hay gestiones que **siempre** requieren al titular, aun con OTP válido?

Involucra a Legal por el tema de datos personales.

---

## D-12 · Términos y condiciones

**Estado:** 🔴 Abierta

**Preguntas.**
1. ¿Cuál es el texto y quién lo aprueba?
2. ¿Se versiona? (necesario: hay que poder probar qué aceptó el cliente y cuándo)
3. ¿Se acepta una vez o en cada sesión?
4. ¿Dónde se guarda la constancia? (propuesta: en la sesión del bot + evento auditado)

---

## D-13 · Canal del OTP

**Estado:** 🟢 **Cerrada · 2026-08-13**

**Decisión: SMS.** Es lo que ya funciona: `otpController` + `@repo/sms` (BroadcasterMobile),
código de 4 dígitos, 5 minutos. Correo y WhatsApp quedan descartados por ahora.

**Regla que se mantiene:** el código se envía al contacto **registrado** (teléfono principal
del titular o del codeudor), nunca al número del chat cuando ese número no está registrado.
Si no, el factor no valida nada.

---

## D-14 · Retención de PII y logs

**Estado:** 🟡 Propuesta

**Propuesta de IT.**
- DPI y NIT se guardan **hasheados** en la sesión y en los eventos del bot.
- Teléfonos se registran enmascarados en logs y eventos.
- Las sesiones vencidas se purgan o anonimizan pasado un plazo a definir (propuesta:
  90 días), conservando el evento auditado sin PII.
- Los adjuntos que suba el cliente en pasos futuros (boletas) tienen su propia política:
  se define en el Paso 4.

---

## D-15 · Convenio y promesa de pago: bloqueados

**Estado:** 🔴 Bloqueado · 2026-08-13 (acordado en reunión)

**Decisión.** El flujo de **convenio de pago** y **promesa de pago** por el bot
(sección 05 del árbol / Paso 5) **no se construye por ahora**. Queda a la espera de
**aprobación de gerencia**.

**Qué implica.**

- No se define, no se estima ni se implementa el Paso 5 hasta que haya aprobación.
- El resto del feature sigue: identificación (Paso 1), menú del crédito, consultas y pagos
  no dependen de esto.
- **Pendiente de definir:** qué hace el bot mientras tanto con esas dos opciones del menú
  del crédito, que en el árbol aparecen como dos de las seis gestiones. Opciones: ocultarlas
  del menú, o dejarlas visibles y transbordar directo a un agente humano. Se decide al
  definir el Paso 2.

**Al desbloquearse:** actualizar este registro con la fecha y quién aprobó, pasar el Paso 5
a "En definición" en el README y revisar si el flujo aprobado sigue siendo el del PDF v1.0
o cambió.

---

## D-16 · Quién valida el OTP

**Estado:** 🟢 **Cerrada · 2026-08-14** (revisada dos veces el mismo día)

**Decisión final: el servicio 2 valida el código y devuelve los créditos en la misma
llamada.** No hay endpoint de validación aparte. Si el código no sirve, responde el error y
no lista nada.

El servicio 1 **no devuelve el código**: devuelve una **referencia** opaca (el id de la fila
del OTP) que el bot guarda y manda de vuelta junto con lo que escribió el cliente.

**Cómo se llegó acá.**

1. *Primera versión:* el CRM devolvía el código y SimpleTech lo validaba de su lado.
2. *Se descartó* porque comparando strings no hay forma de saber si un código **venció**: el
   cliente recibiría "código incorrecto" cuando en realidad se le pasó el tiempo.
3. *Segunda versión:* un endpoint `validar-otp` aparte, y después otro para los créditos. Eso
   dejaba el problema de cómo saber, en la tercera llamada, que ya había validado.
4. *Versión final:* las dos cosas en el servicio 2. La validación **es** la autorización, y no
   hace falta ni sesión ni ventana de tiempo.

**Por qué `referencia` y no `search`.** El código es de 4 dígitos y puede haber varios vivos a
la vez. Si el servicio 2 aceptara solo el código, alguien con la API key podría probar
`0000`…`9999` hasta caer en el de cualquier cliente, y como no habría a quién atribuirle el
intento fallido, el tope de 3 no lo frenaría. La referencia ata el código a una persona.

**De paso resuelve lo que se pidió:** el bot no tiene que reenviar el `search`, y el CRM **no
vuelve a buscar** — la fila del OTP ya guarda a qué lead o codeudor pertenece.

**Reglas.**

1. Un código sirve **una sola vez** (`used`, `used_at`).
2. Vigencia de 5 minutos; 3 intentos fallidos y hay que pedir uno nuevo.
3. **El código no se escribe en logs** ni se devuelve en ninguna respuesta.
4. Si el SMS falla, la fila del OTP **se borra**: si no, quedaría vivo un código que nadie
   recibió.
5. Todo va autenticado con la API key del bot ([D-18](#d-18--autenticación-del-bot-api-key)).

---

## D-17 · Qué oportunidades cuentan como crédito

**Estado:** 🟢 **Cerrada · 2026-08-13**

**Decisión.** Se listan las oportunidades con `status IN ('won', 'migrate')`.

Los créditos cargados por la migración masiva quedaron con `status = 'migrate'`, no con `won`
(ver `controllers/migrate-creditos.ts`); filtrar solo por `won` dejaría fuera a los clientes
viejos, que son el grueso de la cartera en cobros.

**Resoluciones asociadas:**

| Caso | Resolución |
| --- | --- |
| Oportunidad ganada/migrada **sin `numero_sifco`** | **No ocurre.** Si aparece una, es un dato roto: se omite y se registra para revisar. |
| Oportunidad **sin info del vehículo** | Sí ocurre. Se lista igual, usando el **nombre completo del cliente** como etiqueta. |

**Queda abierto:** si se listan créditos ya **liquidados**. En el CRM la oportunidad sigue
ganada aunque el crédito esté pagado, y en este paso no se consulta cartera, así que no hay
forma de distinguirlo. Se resuelve en el Paso 2 o filtrando con cartera más adelante.

---

## D-18 · Autenticación del bot: API key

**Estado:** 🟢 Cerrada · 2026-08-14

**Contexto.** El CRM expone dos superficies: ORPC (`/rpc/*`) para su propio front, y endpoints
REST en Hono para integraciones. Los del bot de **ventas** (`/info/*`) y la creación de leads
públicos están **sin autenticación**. Los del bot de cobros exponen datos de clientes con
crédito: no pueden quedar abiertos.

**Decisión: API key en variable de entorno**, enviada por header, verificada por un middleware
propio de las rutas del bot.

- Variable: `BOT_COBROS_API_KEY`. **En `.env`, no quemada en el código**: una llave en el
  repositorio se filtra con el primer fork o captura de pantalla, y rotarla obliga a
  desplegar.
- Header: `Authorization: Bearer <key>`, igual que el resto de integraciones del CRM
  (`validatePortalToken`).
- **Secreto propio**, distinto de `BETTER_SECRET_PORTAL_WEB`: si se filtra uno, se rota uno
  solo.
- Comparación en **tiempo constante** (`timingSafeEqual`), no con `===`.
- Si la variable no está configurada, el endpoint responde 503 y **no** se abre: falla
  cerrado.
- Se admite una segunda llave (`BOT_COBROS_API_KEY_PREV`) para rotar sin coordinar despliegue
  con SimpleTech.
- La llave **nunca** se escribe en logs.

**Lo que la API key NO da.** Identifica al integrador, no al cliente final: cualquiera con la
llave puede preguntar por cualquier DPI. Por eso el control de acceso real a los datos del
crédito es el **OTP validado** ([D-16](#d-16--quién-valida-el-otp)), y por eso el servicio 1
solo devuelve nombre y máscara del teléfono.

**Descartado por ahora:** mTLS y firma HMAC por request (más seguros, pero SimpleTech tendría
que implementarlos y hoy no lo justifica el volumen), y allowlist de IP (SimpleTech no
garantiza IP fija).

---

## D-19 · A qué teléfono se manda el OTP

**Estado:** 🟢 Cerrada · 2026-08-14 — **decidido con los datos en la mano**

**Contexto.** El acuerdo era "al teléfono principal, el primero del campo cuando hay varios".
Al revisar la base (1,760 clientes con crédito ganado o migrado) apareció que el primero no
siempre sirve:

| Hallazgo | Número |
| --- | --- |
| Clientes con crédito | 1,760 |
| Con varios teléfonos en el mismo campo (`,` o `/`) | 570 (32%) |
| Sin ningún teléfono utilizable | ~206 (12%) |
| Con al menos un **móvil** (empieza en 3, 4 o 5) | 1,551 |
| Con **solo fijos** (empieza en 2, 6 o 7) | 3 |
| Teléfonos guardados con código de país (`502…`) | 65 |
| Basura en el campo: números de 16 dígitos (parecen tarjetas), `0`, fijos de 7 dígitos | ~6 |

**Decisión.** Se toma el **primer número móvil** del campo, no el primero a secas:

1. Se parte el campo por `,` y `/`.
2. De cada parte se dejan solo dígitos.
3. Se normaliza: si trae `502` y 11 dígitos, se queda con los últimos 8.
4. Se descarta lo que no quede en 8 dígitos (basura, fijos de 7, tarjetas).
5. Se elige el **primero que empiece en 3, 4 o 5** (móviles en Guatemala).
6. Si no hay ninguno, **no se manda OTP**: se responde que no hay teléfono registrado y se
   deriva a soporte.

Un SMS a un fijo no llega nunca, así que mandarlo al primero de la lista dejaría al cliente
esperando un código que no existe. Con esta regla, solo 3 clientes de 1,760 quedan fuera por
tener únicamente fijos.

---

## D-20 · ¿El DPI se busca también en codeudores?

**Estado:** 🟢 **Cerrada · 2026-08-14 — sí**

**Contexto.** Al indicar dónde vive cada identificador ("el NIT puede estar en el lead y en la
oportunidad, el DPI sí solo en el lead") quedó la duda de si las búsquedas por codeudor
seguían en pie. **Confirmado que sí.**

**Decisión.** El DPI se busca en `leads.dpi` **y** en `co_debtors.dpi`. Si el match es un
codeudor, el OTP se manda al teléfono **del codeudor** y se listan las oportunidades donde
aparece como tal. La frase del 14/08 se refería a en qué **columnas** vive cada dato: el NIT
está en dos (`leads.nit` y `opportunities.nit`) y el DPI del titular en una sola.

**Consecuencia:** la tabla `otps` necesita `co_debtor_id` y que `lead_id` deje de ser NOT
NULL, porque el código se le manda al codeudor.
