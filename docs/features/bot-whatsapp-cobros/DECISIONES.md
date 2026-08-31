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
| [D-05](#d-05--cómo-se-reporta-no-encontrado) | Cómo se reporta "no encontrado" | 🟢 (→ D-22) |
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
| [D-21](#d-21--modo-simulado-mientras-el-sms-no-sale) | Modo simulado mientras el SMS no sale | 🟢 |
| [D-22](#d-22--todo-lo-que-no-termina-en-dato-va-con-estado-http-de-error) | Todo lo que no termina en dato va con estado HTTP de error | 🟢 |
| [D-23](#d-23--la-documentación-de-la-api-es-swagger-y-es-obligatoria) | La documentación de la API es Swagger, y es obligatoria | 🟢 |
| [D-24](#d-24--el-menú-hereda-la-identidad-del-paso-1) | El menú hereda la identidad del paso 1 | 🟢 |
| [D-25](#d-25--la-boleta-la-lee-gemini-con-el-motor-que-ya-está-en-el-crm) | La boleta la lee Gemini, con el motor que ya está en el CRM | 🟢 |
| [D-26](#d-26--el-monto-lo-dicta-la-boleta-no-el-cliente) | El monto lo dicta la boleta, no el cliente | 🟢 |
| [D-27](#d-27--tres-intentos-por-sesión-y-los-cuenta-el-crm) | Tres intentos por sesión, y los cuenta el CRM | 🟢 |
| [D-28](#d-28--el-aviso-a-whatsapp-nunca-rompe-la-acción-de-conta) | El aviso a WhatsApp nunca rompe la acción de conta | 🟢 |
| [D-29](#d-29--la-imagen-se-descarga-con-allowlist) | La imagen se descarga con allowlist | 🟢 |
| [D-30](#d-30--subir-boleta-lo-puede-hacer-cualquier-cliente) | Subir boleta lo puede hacer cualquier cliente | 🟢 |
| [D-31](#d-31--la-boleta-se-copia-a-nuestro-r2-al-leerla) | La boleta se copia a nuestro R2 al leerla | 🟢 |
| [D-32](#d-32--registrar-una-boleta-ya-mueve-la-mora-y-por-eso-el-rechazo-es-revertir) | Registrar una boleta ya mueve la mora, y por eso el rechazo es Revertir | 🟢 |
| [D-33](#d-33--una-boleta-son-varios-pagos-y-una-sola-notificación) | Una boleta son varios pagos, y una sola notificación | 🟢 |
| [D-34](#d-34--la-confirmación-se-protege-con-estado-no-con-idempotency-key) | La confirmación se protege con estado, no con idempotency key | 🟢 |
| [D-35](#d-35--el-webhook-adelanta-el-aviso-el-job-lo-garantiza) | El webhook adelanta el aviso, el job lo garantiza | 🟢 |
| [D-36](#d-36--las-reversiones-dejan-registro) | Las reversiones dejan registro | ⚫ reemplazada por D-38 |
| [D-37](#d-37--las-cuentas-de-pago-viajan-con-la-info-del-crédito) | Las cuentas de pago viajan con la info del crédito | 🟢 |
| [D-38](#d-38--cartera-solo-se-toca-con-endpoints-nuevos) | Cartera solo se toca con endpoints nuevos | 🟢 |
| [D-39](#d-39--el-rechazo-es-un-botón-explícito-no-se-infiere-del-reverso) | El rechazo es un botón explícito | 🟢 |
| [D-40](#d-40--el-historial-vive-en-el-crm-en-su-propia-tabla) | El historial de interacciones vive en el CRM, en su propia tabla | 🟢 |
| [D-41](#d-41--el-registro-es-un-middleware-y-jamás-rompe-la-respuesta) | El registro es un middleware, y jamás rompe la respuesta | 🟢 |
| [D-42](#d-42--qué-guarda-cada-interacción-y-qué-nunca) | Qué guarda cada interacción (y qué nunca) | 🟢 |
| [D-43](#d-43--los-intentos-fallidos-con-cliente-conocido-también-se-registran) | Los intentos fallidos con cliente conocido también se registran | 🟢 |
| [D-44](#d-44--la-vista-por-referencia-con-correlativo-del-cliente) | La vista: por referencia, con correlativo del cliente | 🟢 |
| [D-45](#d-45--el-bot-reusa-la-infraestructura-págalo-de-cb-028) | El bot reusa la infraestructura Págalo de CB-028 | 🟢 |
| [D-46](#d-46--el-cliente-elige-cuántas-cuotas-el-crm-arma-el-monto) | El cliente elige cuántas cuotas; el CRM arma el monto | 🟢 |
| [D-47](#d-47--fuente-única-del-monto-y-montoesperado) | Fuente única del monto y `montoEsperado` | 🟢 |
| [D-48](#d-48--capital-en-un-link-todo-lo-demás-en-el-otro) | Capital en un link, todo lo demás en el otro | 🟢 |
| [D-49](#d-49--del-pago-nos-enteramos-nosotros-no-el-cliente) | Del pago nos enteramos nosotros, no el cliente | 🟢 |
| [D-50](#d-50--el-pago-por-link-nace-validado-en-la-misma-transacción) | El pago por link nace validado en la misma transacción | 🟢 |
| [D-51](#d-51--los-links-no-expiran-por-ahora) | Los links no expiran (por ahora) | 🟢 |
| [D-52](#d-52--si-deuda-cambia-págalo-se-comporta-como-boleta-manual) | Págalo usa comportamiento de boleta manual ante deuda cambiante | 🟢 |
| [D-53](#d-53--una-cuota-vencida-sin-saldo-bloquea-el-link) | Una cuota vencida sin saldo bloquea el link | 🟢 |

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

**Estado:** 🟢 **Cerrada · 2026-08-18 — se eligió B (404)**, ver
[D-22](#d-22--todo-lo-que-no-termina-en-dato-va-con-estado-http-de-error)

**Opciones.**
- A) HTTP 200 con `estado: "no_encontrado"`.
- **B) HTTP 404.**

**Se implementó A** y se cambió a **B** cuando SimpleTech armó el bot: le resultaba más
cómodo rutear por el estado HTTP que revisar el cuerpo de un 200 para ver si había cliente.

La recomendación de IT había sido A, con este argumento: *que el cliente escriba mal su DPI
no es una falla técnica; con 404 los motores de bot suelen rutear a la rama de error
genérico y el cliente pierde el hilo.* **Se descartó** porque quien arma esas ramas es el
mismo SimpleTech y prefiere manejarlo así — el `codigo` del cuerpo (`CLIENTE_NO_ENCONTRADO`)
le permite distinguirlo de un error de verdad y darle su propio mensaje.

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

> **Nota 2026-08-14.** El canal no cambia, pero **en dev el SMS no sale**: el proveedor
> solo acepta peticiones desde IPs en su whitelist y la de la instancia no está. Ver
> [D-21](#d-21--modo-simulado-mientras-el-sms-no-sale).

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
2. Vigencia de 5 minutos; 3 intentos fallidos y hay que pedir uno nuevo. El **tercer** fallo
   ya responde `DEMASIADOS_INTENTOS`, no al cuarto: el bot rutea por `codigo` y con
   `OTP_INVALIDO` le pediría al cliente un intento que ya no puede funcionar.
3. **El código no se escribe en logs** ni se devuelve en ninguna respuesta.
4. Se genera con un **generador criptográfico** (`crypto.randomInt`), no con
   `Math.random()`: este último es predecible y quien junte varios códigos enviados a un
   teléfono propio podría adivinar los siguientes.
5. Si el SMS falla, la fila del OTP **se borra**: si no, quedaría vivo un código que nadie
   recibió.
6. **Validar y listar van en una sola transacción, con la fila del OTP bloqueada
   (`FOR UPDATE`)**, por dos razones:
   - Sin el lock, dos peticiones simultáneas leen el mismo contador de intentos y lo pisan;
     se podría probar el espacio completo de códigos en paralelo saltándose el tope de 3.
   - Si el listado de créditos falla, se revierte también el "código usado", así el cliente
     puede reintentar sin pedir otro SMS.
7. **Solo valen los códigos emitidos por el bot de cobros** (columna `otps.origen`). La
   tabla la comparte con el bot de ventas, cuyo `/info/send-otp` es **público** y acepta
   cualquier DPI con un teléfono elegido por quien llama: sin esta marca, se podía pedir un
   código para el DPI de otra persona, recibirlo en el teléfono propio y entrar acá como
   ella.
8. **Reenvíos limitados:** 60 segundos entre códigos y 5 por hora por persona, y cada código
   nuevo **invalida los anteriores**. Si no, tras un bloqueo bastaba con volver a pedir
   código para tener otros 3 intentos, y se le podía llenar el teléfono de SMS (que se
   cobran) a un cliente real.
9. Todo va autenticado con la API key del bot ([D-18](#d-18--autenticación-del-bot-api-key)).

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

---

## D-21 · Modo simulado mientras el SMS no sale

**Estado:** 🟢 **Cerrada · 2026-08-14 — temporal, solo dev**
**Actualizada 2026-08-17:** el código ya no se consulta por API, se emite **fijo**.

**Contexto.** Con el servicio 1 ya desplegado, ningún OTP llegaba: la llamada moría en
timeout a los 60 s y devolvía `OTP_NO_ENVIADO`. La revisión de `cobros_send_logs` mostró que
no era del bot — el canal SMS del CRM lleva así desde abril (1 enviado, 2 fallidos, ambos
`Timeout: La peticion excedio 60000ms`), mientras WhatsApp acumula 4,719 enviados.

**Causa (confirmada con gerencia).** El proveedor solo acepta peticiones desde **IPs que
estén en su whitelist**, y la de esta instancia no está. Por eso la petición se queda colgada
hasta el timeout en vez de responder un error: nunca la contesta nadie. No es un problema del
código ni del bot — es un trámite con el proveedor.

Esto explica también los timeouts de abril: los envíos del CRM que fallaron salieron desde
una IP no habilitada. Lo que sí funciona (WhatsApp, y el SMS que Daniel vio salir en prod)
va desde el servidor de producción, cuya IP sí está.

**Decisión.** Se agrega la env **`BOT_COBROS_OTP_SIMULADO`**, solo para la instancia de dev.
Prendida:

1. El código se guarda **igual que siempre** (misma tabla, mismo vencimiento, mismos límites
   de reenvío y de intentos). Lo único que se salta es la llamada al proveedor.
2. El servicio 1 responde lo mismo de siempre más `otpSimulado: true`, así el bot no cambia
   su lógica.
3. El código es **siempre `4321`**, para cualquier cliente que se consulte.

**Por qué no se cambió a WhatsApp** (lo que habría tocado [D-13](#d-13--canal-del-otp)):
el canal no está roto, solo falta habilitar la IP. Cambiar de canal por un trámite pendiente
habría sido rehacer el flujo para nada.

### Código quemado, no consulta por API (cambio del 2026-08-17)

La primera versión guardaba un código aleatorio y lo exponía en
`POST /api/bot/cobros/pruebas/otp`. **SimpleTech pidió quemar el código**: con uno fijo el
bot teclea siempre lo mismo y no tiene que meter una llamada extra —que además solo existe
en dev— en medio de su flujo. Se cambió y **se borró ese endpoint**; no hubo que integrarlo.

Se evaluó limitar el código quemado a los clientes ficticios sembrados (ids `b07…`), pero
**se descartó**: las pruebas se hacen con créditos reales de la copia de producción —es la
única forma de ver casos de verdad— y con ese filtro el `4321` no habría servido para
ninguno. Decisión de Daniel: **vale para cualquier cliente**, sabiendo que la API key la
tienen solo IT y SimpleTech.

### 🚨 Lo que esto implica

Con la env prendida, **el OTP deja de proteger nada**: quien tenga la API key puede pedir el
DPI de cualquier persona y ver sus datos de crédito con `4321`. En la instancia de dev es un
riesgo asumido y acotado a quien tiene la llave.

| Ambiente | `BOT_COBROS_OTP_SIMULADO` |
| --- | --- |
| Instancia de dev del bot | `true` — mientras el SMS no salga |
| **Producción** | **Nunca.** Prendida, es regalar la cartera a quien se robe la llave |

La única barrera que queda es la env, así que las pruebas de `elegirCodigo` cuidan
justamente eso: **sin la env, siempre aleatorio**.

**Cuándo se quita.** Cuando el proveedor habilite la IP de la instancia: se apaga la env
—el código vuelve a ser aleatorio— y después se borran `esModoSimulado` y `elegirCodigo`.

---

## D-22 · Todo lo que no termina en dato va con estado HTTP de error

**Estado:** 🟢 **Cerrada · 2026-08-18**

**Contexto.** Armando el bot, SimpleTech se topó con que el servicio 1 respondía **200** con
`{"success": true, "data": {"encontrado": false}}` cuando el DPI, NIT o placa no daba con
nadie. Para el bot eso es un fallo —no hay a quién mandarle el código— pero le llegaba como
éxito, así que tenía que mirar dentro del cuerpo para darse cuenta. Pidió un **404** u otro
estado de error para poder rutearlo como los demás.

**Decisión.** **Un 200 significa que hay dato. Punto.** Cualquier camino que no termine en
dato —no encontrado, dato ilegible, código malo, límite alcanzado— sale con estado HTTP de
error y `success: false`.

Dos respuestas cambiaron; el resto ya cumplía:

| Caso | Antes | Ahora |
| --- | --- | --- |
| Servicio 1, `search` sin resultados | 200 `encontrado: false` | **404** `CLIENTE_NO_ENCONTRADO` |
| Servicio 2, código válido pero sin créditos que listar | 200 `creditos: []` | **404** `SIN_CREDITOS` |

El segundo pasa poco —el servicio 1 solo encuentra a quien tiene crédito— pero puede darse
si el crédito cambia de estado entre una llamada y la otra, y dejarlo como 200 con arreglo
vacío era volver a pedirle al bot que revisara el cuerpo.

**Se conserva `data: { encontrado: false }`** dentro de la respuesta 404, por si el bot ya lo
leía: el formato de error ya admite un `data` extra (`DEMASIADOS_ENVIOS` manda ahí su
`reintentarEnSegundos`).

**Lo que NO cambia: la respuesta sigue siendo genérica.** El mismo `CLIENTE_NO_ENCONTRADO`
cubre "ese dato no existe" y "existe pero no tiene crédito" (ver §5 del paso 1).
Distinguirlos convertiría el endpoint en un detector de clientes de Cash In para quien tenga
la llave.

**Cómo rutea el bot:** por el campo `codigo`, no por el estado a secas ni por el mensaje —
los textos cambian y varios casos comparten estado. La tabla completa está en el
[paso 1, §3.4](./01-identificacion-y-acceso.md#34-todos-los-errores-por-estado-http).

---

## D-23 · La documentación de la API es Swagger, y es obligatoria

**Estado:** 🟢 **Cerrada · 2026-08-18**

**Contexto.** A SimpleTech se le pasaba un PDF con los contratos. No les estaba funcionando:
se desactualiza en cuanto cambia algo, hay que reenviarlo por WhatsApp, y para probar
igual tienen que armar los curls a mano. Y esto va a crecer — hoy son 2 endpoints, con la
fase 2 vienen varios más.

**Decisión.** La documentación de los endpoints del bot es **Swagger UI**, servida por el
mismo binario en `GET /api/bot/cobros/docs`, con el documento OpenAPI en
`/api/bot/cobros/openapi.json`.

Gana tres cosas sobre el PDF: se actualiza sola con cada despliegue, se puede **ejecutar**
desde el navegador (botón Authorize + Try it out) y se importa a Postman.

**Alcance: solo los endpoints del bot**, por ahora. El CRM tiene 40 rutas REST más que
podrían sumarse después; no era el momento de documentarlas todas.

### Escrita a mano

Lo natural sería generarla desde schemas con `@hono/zod-openapi`, y así no se puede
desincronizar. **Se descartó** porque obligaba a reescribir cómo los handlers parsean el
body, y con eso cambiaba el formato de los errores de validación — justo lo que SimpleTech
ya tenía integrado. No se mueve el contrato bajo los pies del integrador por elegancia
interna. Si algún día se rehace el parseo, vale la pena volver a evaluarlo.

**Tampoco se agregó `@hono/swagger-ui`:** el Dockerfile del server corre `bun install` **sin
lockfile**, así que cada dependencia nueva puede cambiar de versión sola entre builds (ya
pasó con better-auth, que tumbó el login del CRM). El HTML que ese paquete genera son 20
líneas; se escribieron a mano y los assets vienen del CDN con la versión **fija**.

### 🔒 El candado

Escribirla a mano tiene un costo: se desincroniza al primer descuido, y una documentación
que miente es peor que no tener. Por eso **no depende de que alguien se acuerde**:

`lib/bot-cobros/openapi.test.ts` compara contra el código real —los `codigo` que devuelven
el controlador y el middleware, y las rutas montadas en `index.ts`— y el pipeline corre esas
pruebas **antes** de construir la imagen (`desplegar` depende de `verificar`).

**Todo cambio en los endpoints se documenta en el mismo commit. Si no, no despliega.**

La misma prueba cuida que el **código del modo simulado no se publique**
([D-21](#d-21--modo-simulado-mientras-el-sms-no-sale)): la documentación la ve el integrador
y ese código lo tiene solo el equipo de IT.

### Dónde se publica

Detrás de **`BOT_COBROS_DOCS=true`**, prendida solo en la instancia de dev del bot — mismo
criterio que el modo simulado. Las rutas van **sin API key**: no exponen datos, y exigirla
impediría que la UI cargara el documento. Los ejemplos usan **datos reales de dev**, para que
las llamadas de la página funcionen de verdad.

---

## D-24 · El menú hereda la identidad del paso 1

**Estado:** 🟢 **Cerrada · 2026-08-18**

**Contexto.** El paso 2 muestra saldos, mora y convenio: bastante más sensible que el paso 1,
que solo dice qué créditos tiene alguien. Y [D-04](#d-04--dónde-vive-el-estado-de-identidad)
decidió **no** tener sesiones. Entonces, ¿qué prueba que quien pregunta por un crédito es su
dueño?

La API key no sirve para eso: identifica a **SimpleTech**, no al cliente final. Con ella sola,
cualquiera podría pedir el saldo de cualquier crédito.

**Opciones.**
- A) Confiar en la API key, como hace el servicio 2 después de validar el OTP.
- **B) Reusar la `referencia` del paso 1 como prueba de identidad.**
- C) Crear sesiones de verdad (tabla, token, TTL), revirtiendo D-04.

**Decisión: B.** La fila del OTP ya guarda a qué lead o codeudor pertenece y cuándo se canjeó
el código; eso alcanza sin montar sesiones. Se comprueban cuatro cosas:

1. La referencia existe y es de un OTP de cobros.
2. **Fue canjeada** (`used = true`): si el cliente nunca escribió su código, esa referencia no
   prueba nada — se emite antes de verificar a nadie.
3. Pasaron menos de **30 minutos** desde el canje.
4. **El crédito es de esa persona**, con la misma consulta que arma el menú del paso 1.

El punto 4 es el que importa: sin él, una referencia legítima serviría para preguntar por el
crédito de un tercero.

**Los 30 minutos.** El OTP vence a los 5, pero eso es para *canjearlo*. Una vez validado, el
cliente se queda navegando el menú y pedirle otro código a los 5 minutos de conversación sería
absurdo. Media hora alcanza para una consulta con calma y acota la ventana si alguien se
hiciera de una referencia ajena. Se mide desde el **canje**, no desde la emisión: el reloj
corre desde que probó su identidad.

**Un crédito ajeno responde `404 CREDITO_NO_ENCONTRADO`**, el mismo error que si no existiera.
Distinguirlos permitiría averiguar qué créditos hay probando números — el mismo criterio de
[D-22](#d-22--todo-lo-que-no-termina-en-dato-va-con-estado-http-de-error) para el paso 1.

**Cuándo habría que revisar esto.** Si aparece un flujo largo —subir una boleta, armar un
convenio— donde 30 minutos se queden cortos, o si el bot necesita recordar al cliente entre
conversaciones. Ahí sí toca la opción C y se revisa D-04.

---

## D-25 · La boleta la lee Gemini, con el motor que ya está en el CRM

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** El paso 4 necesita sacar cinco datos de la foto de un comprobante bancario:
banco, monto, fecha, número de autorización y cuenta destino. En el monorepo ya hay **dos**
lecturas automáticas de documentos funcionando: el análisis de estados de cuenta
(`routers/bank-analysis.ts`, Gemini vía `@ai-sdk/google` + `generateObject`) y el OCR de la
tarjeta de circulación que usa la app de inspecciones (`routers/vehicles.ts`, hoy con OpenAI).

**Opciones.**
- **A) Reusar el motor del análisis bancario: Gemini + `generateObject` con schema de Zod.**
- B) Un OCR clásico (Tesseract, Textract) con reglas por banco.
- C) Un proveedor nuevo especializado en comprobantes.

**Decisión: A.** No agrega dependencia, ni cuenta, ni contrato: la misma cuenta de Gemini que
ya lee estados de cuenta en producción. `generateObject` valida la salida contra el schema —
si el modelo devuelve basura, revienta en el borde y no a mitad del insert. B se descartó
porque las boletas de Guatemala no tienen un formato: cada banco imprime lo suyo, y las fotos
son de celular, torcidas y con reflejos; mantener reglas por banco es trabajo permanente. C
no se justifica cuando A ya está probado adentro.

**Parámetros distintos a los del análisis bancario**, porque el problema es distinto:

| | Análisis bancario | Boleta |
| --- | --- | --- |
| Entrada | hasta 9 PDF | 1 imagen |
| Timeout | 120 s | **30 s** |
| Reintentos | 2 intentos, contados en base | **0** — el reintento es otra foto del cliente |

**Al modelo se le manda la imagen y nada más.** Nunca el monto esperado ni el nombre del
cliente: si le decimos qué esperamos encontrar, lo encuentra. El cruce contra el crédito se
hace después, con la respuesta ya en la mano.

**El catálogo de bancos no se le delega al modelo.** `cartera.bancos` tiene 24 filas para
unos 15 bancos reales —`Banrural` está dos veces, `BAM` tres, y hay un `test` con 92 pagos
encima—, pero **la deduplicación ya existe**: la columna `id_banco_transferencia`, el id
universal que el endpoint ya filtra con `GET /bancos?con_transferencia=true` y que deja
exactamente 15 filas, una por banco.

Esas 15 son el catálogo del bot. El nombre leído se mapea con **alias explícitos en el
código** contra ellas; si no cae, se busca entre las 9 sin id universal (ahí están `Interbanco`
y `PAGALO`, reales, excluyendo `test`/`test2`); si tampoco, `banco: null` y el cliente elige de
la lista. **Nunca por parecido de texto**: adivinar el banco es adivinar en qué cuenta va a
buscar conta el dinero.

Único efecto colateral: el id universal de G&T lo tiene la fila `19`, no la `3` que es la que
más usa contabilidad. Los pagos del bot caen en la 19 y cualquier reporte agrupado por
`banco_id` los verá aparte. Unificar esas filas es decisión de conta, no del bot.

---

## D-26 · El monto lo dicta la boleta, no el cliente

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** Después de la lectura, el cliente confirma. ¿Qué pasa si dice que los datos
están mal? El documento de gerencia contempla que **escriba** los datos a mano (banco de una
lista, monto, fecha, autorización). El flujo acordado con SimpleTech es otro: que mande otra
foto y se lea de nuevo.

**Opciones.**
- A) Ingreso manual completo: el cliente escribe monto, fecha y autorización.
- **B) Solo otra foto. Lo único corregible a mano es el banco, y solo cuando la lectura no lo
  reconoció.**
- C) Ingreso manual pero marcado, con revisión obligatoria de conta.

**Decisión: B para la v1.** El monto es el dato con el que se registra un pago en el sistema
que mueve el dinero. Si viaja en el request, quien controle el chat —o la integración— puede
declarar un pago de Q10,000 que nunca existió; quedaría `pending` y lo agarraría conta, pero
mientras tanto el cliente ya vio "pago recibido" y el crédito muestra un pago que no entró.
Con B, el monto sale del borrador que guardó el CRM al leer la imagen: para cambiarlo hay que
cambiar la imagen.

Por eso `/boleta/confirmar` recibe **solo** `boletaId` y, opcionalmente, `bancoId`. Nada más.

**El banco es la excepción** porque su fuente no es la boleta sino nuestro catálogo sucio
(D-25): que el cliente lo elija de una lista es más confiable que el alias que adivinemos, y
elegir mal un banco no cambia cuánto dinero se registra.

**Cuándo se revisa.** Si en producción se ve que muchos clientes no logran una foto legible en
tres intentos, entra C: ingreso manual, marcado como tal en el pago, con revisión obligatoria
de conta antes de aplicarlo. La v1 se hace sin eso para no abrir el hueco antes de saber si
hace falta.

---

## D-27 · Tres intentos por sesión, y los cuenta el CRM

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** Cada lectura es una llamada a Gemini y cuesta. Un cliente con mala señal puede
mandar la misma foto borrosa diez veces, y un integrador con un bug puede hacerlo mil.

**Decisión.** **Tres intentos por sesión** (la sesión del paso 1, 30 minutos). Al cuarto,
`429 DEMASIADOS_INTENTOS` y el bot lo manda con su asesor.

**El número de intento no lo manda el bot: lo cuenta el CRM** sobre los borradores de esa
sesión. Es dato nuestro; si viniera en el request, bastaría con mandar siempre `intento: 1`
para que el tope no exista. Se devuelve en la respuesta (`intento`, `intentosRestantes`) para
que el bot module el mensaje.

**Los fallos nuestros no gastan intento.** Si Gemini está caído o se pasa del timeout, la
respuesta es `503 LECTOR_NO_DISPONIBLE` y el contador no se mueve: el cliente no tiene por qué
pagar nuestro problema con uno de sus tres tiros.

**El borrador vive 15 minutos.** Es lo que dura la conversación de "esto entendimos,
¿está bien?". Vencido, `410 BORRADOR_VENCIDO` y otra foto.

---

## D-28 · El aviso a WhatsApp nunca rompe la acción de conta

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** Cuando contabilidad valida (o rechaza) un pago que entró por el bot, hay que
avisarle al cliente. La validación ocurre en cartera; el teléfono y el WhatsApp están en el
CRM. Alguien tiene que cruzar la frontera.

**Opciones.**
- A) El CRM consulta cada tanto qué pagos cambiaron de estado (polling).
- **B) Cartera avisa al CRM cuando el estado cambia.**
- C) El bot pregunta cada vez que el cliente vuelve a escribir.

**Decisión: B**, con el patrón que ya existe: `services/crm.service.ts` en cartera ya llama al
CRM para las notificaciones de pago a inversionistas. A obligaría a recorrer pagos
constantemente para un puñado de eventos; C llega tarde y solo si el cliente vuelve.

**Tres reglas no negociables:**

1. **El aviso sale después del commit**, nunca dentro de la transacción que valida el pago.
2. **Se traga sus propios errores.** try/catch, log, y seguir — igual que `notifyPayInvestors`.
   Si WhatsApp está caído, el pago se valida igual. Al revés sería inaceptable: un contador no
   puede quedarse sin poder trabajar porque un proveedor de mensajería no responde.
3. **Un pago que no vino del bot responde `200` con `notificado: false`**, no un 4xx. El 99%
   de los pagos del sistema no son del bot; si eso fuera error, los logs de contabilidad
   estarían siempre en rojo y nadie miraría los que sí importan.

**Llave propia.** El endpoint de eventos usa `CARTERA_WEBHOOK_API_KEY`, distinta de la del
bot: quien puede consultar créditos no tiene por qué poder disparar mensajes de WhatsApp a
clientes.

**Solo se notifican los pagos que entraron por el bot** (los que tienen fila en
`bot_cobros_boletas`). Extenderlo a todos —que cualquier cliente reciba WhatsApp cuando conta
valide su boleta— es una decisión de Cobros, no técnica: el circuito ya queda montado.

---

## D-29 · La imagen se descarga con allowlist

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** SimpleTech no manda el archivo: manda una **URL** y nosotros la descargamos. Un
servidor que descarga cualquier URL que le pasen es un SSRF: sirve para pedirle a nuestra
propia red lo que el atacante no alcanza desde afuera (metadatos del cloud, servicios
internos, bases de datos sin puerto público).

**Decisión.** La descarga pasa por seis filtros, y falla cerrada:

1. **Solo `https`.**
2. **Dominio en allowlist** (`BOT_COBROS_DOMINIOS_IMAGEN`, coma-separado). Fuera de la lista →
   `400 URL_NO_PERMITIDA`.
3. **El dominio permitido tiene que resolver a una dirección pública.** La allowlist mira el
   texto del host; esto mira a dónde apunta. Un subdominio nuestro mal configurado, o el DNS de
   SimpleTech comprometido, dejaría un nombre autorizado apuntando a `10.0.0.5` y la lista
   estaría conforme. Si cualquiera de las direcciones que devuelve el DNS es privada, no se
   sale. *(No cubre un rebinding con el tiempo exacto: entre resolver y conectar hay una
   segunda resolución. Cerrar eso pide conectarse a la IP validada llevando el nombre aparte
   para el SNI, que `fetch` no permite sin un dispatcher propio.)*
4. **No se siguen redirecciones hacia IP privadas** (`10.*`, `172.16-31.*`, `192.168.*`,
   `127.*`, `169.254.*`, IPv6 local).
5. **Timeout de 15 s** y **tope de 8 MB**, cortando el stream al pasarse.
6. **El content-type se verifica contra el contenido**, no contra la cabecera: JPG, PNG, WEBP
   o PDF por sus magic bytes, igual que el análisis bancario valida el `%PDF`.

**Alternativa descartada:** que SimpleTech suba el archivo en `multipart/form-data`. Es más
seguro —no hay URL que descargar—, pero obliga a un cambio del lado de ellos que hoy no
tienen; si la allowlist resulta incómoda de mantener, es a donde hay que volver.

**Se descarga una sola vez**, en `/boleta/leer`, y de ahí la imagen pasa a nuestro R2
([D-31](#d-31--la-boleta-se-copia-a-nuestro-r2-al-leerla)): confirmar ya no vuelve a salir a
la red de ellos.

---

## D-30 · Subir boleta lo puede hacer cualquier cliente

**Estado:** 🟢 **Cerrada · 2026-08-19**

**Contexto.** El documento de gerencia describe el menú de pago como **dinámico**: la opción
de subir comprobante se mostraría solo a algunos clientes, "según su perfil". Nunca se definió
qué perfil, y esa marca no existe en ningún lado del sistema.

**Opciones.**
- A) Definir la regla (bucket de mora, historial de pagos, marca manual de Cobros) y filtrar.
- **B) Mostrársela a todos.**

**Decisión: B.** Quien llegó al menú ya pasó el paso 1: se identificó con NIT, DPI o placa y
canjeó un código enviado al teléfono que el CRM tiene registrado. No hay razón para negarle a
ese cliente que mande su boleta, cuando puede mandarla por correo o por el chat del asesor sin
ningún filtro y termina en la misma cola de contabilidad.

Además, la boleta **no acredita nada por sí sola**: entra como `pending` y la valida un
contador. El control está en la validación, no en quién puede subirla.

**Implicación práctica.** El bot no consulta ningún perfil: si tiene la API key y una sesión
válida, la opción está. Lo que sí acota el uso es el tope de tres lecturas por sesión
([D-27](#d-27--tres-intentos-por-sesión-y-los-cuenta-el-crm)).

---

## D-31 · La boleta se copia a nuestro R2 al leerla

**Estado:** 🟢 **Cerrada · 2026-08-19** — pedido de Daniel

**Contexto.** SimpleTech no manda el archivo, manda una **URL**. La boleta que respalda un
pago tiene que terminar en R2 como cualquier otra: es el respaldo que abre un contador para
validar, y el que se mira meses después cuando alguien pregunta de dónde salió ese pago. La
pregunta es **cuándo** se copia: al leer o al confirmar.

**Opciones.**
- A) Guardar la URL de SimpleTech y descargar al confirmar.
- **B) Descargar una sola vez al leer, subir a nuestro R2 ahí mismo, y que confirmar use
  nuestra key.**

**Decisión: B.** *"No podemos depender de la nube de ellos, solo es lectura y luego subimos a
la nuestra."*

Y hay una razón técnica que lo vuelve obligatorio: entre la lectura y la confirmación pasan
minutos —el cliente lee el resumen, lo piensa, contesta— y **las URLs de medios de WhatsApp
caducan a los pocos minutos**. Con A, el pago se caería *después* de que el cliente ya dijo
que sí, que es el peor momento posible. Con B, para cuando confirma, la imagen ya es nuestra.

**El orden dentro de `/boleta/leer` importa: la IA va antes que la subida.** Si el modelo dice
que eso no es un comprobante, no se sube nada y el bucket no se llena de selfies.

**Costo aceptado:** los intentos descartados dejan archivos que ningún pago referencia. Son
fotos de celular; el borrador guarda su `r2_key`, así que se pueden barrer cuando estorben —
cartera ya tiene `deleteDocumentoFromR2()`, solo falta exponerla en una ruta.

**La URL original igual se guarda** (`imagen_origen_url`), pero solo para trazar de dónde
vino. No se vuelve a usar.

---

## D-32 · Registrar una boleta ya mueve la mora, y por eso el rechazo es Revertir

**Estado:** 🟢 **Cerrada · 2026-08-19** — hallazgo de la revisión del contrato

**Contexto.** El contrato decía que el pago del bot "entra `pending` y ahí se queda hasta que
contabilidad lo resuelva". **Es falso a medias.** `insertPayment` llama a `procesarPagoMora`
antes de tocar cuota alguna, y eso ejecuta `updateMora` con `DECREMENTO`: la mora del cliente
baja **en el momento del insert**, y si queda en cero el crédito pasa de `MOROSO` a `ACTIVO`.

Lo que sí espera a la validación es el resto: el pago sigue `pending`, las cuotas del
calendario no se cierran y los inversionistas no se procesan.

**Esto no lo introduce el bot** — pasa idéntico cuando conta registra a mano una boleta que
llegó por correo. Pero el bot lo hace más seguido y sin un humano filtrando antes del insert,
así que hay que decidir qué pasa cuando esa boleta resulta no ser buena.

**Opciones.**
- A) Que el bot no use `newPayment`: una cola propia y el insert recién al validar.
- **B) Usar `newPayment` como todos, y garantizar que el rechazo devuelva la mora.**
- C) Arreglar `falsePayment` para que restaure la mora.

**Decisión: B.** A significa reimplementar el reparto entre mora, cuotas, capital y
excedentes — la lógica más delicada de cartera— para el único caso del bot; tarde o temprano
las dos copias dirían cosas distintas. C toca un proceso financiero que usan otros flujos, y
no es lo que se pidió.

**Cómo se garantiza:** el rechazo de una boleta es **Revertir Pago** (`reversePayment`), que
llama a `updateMora` con `INCREMENTO` y devuelve exactamente lo que el registro descontó.
Funciona sobre un pago `pending`, así que sirve para una boleta que nunca llegó a validarse —
y es lo que conta ya hace hoy en carteraFront.

**`false-payment` no sirve para esto**: solo pone `pagado: false, paymentFalse: true` y deja
la mora descontada. En la UI ni siquiera está cableado al flujo de boletas de cliente. Si aun
así llega un evento `marcado_falso`, el CRM **no le escribe al cliente**: levanta una alerta
al asesor avisando que ese crédito quedó con la mora descontada por una boleta descartada.

**Cuándo habría que revisar esto.** Si se ve en producción que las boletas del bot se
rechazan seguido, el descuento temporal de mora deja de ser aceptable y toca la opción A (o
un `validation_status` nuevo que `procesarPagoMora` respete).

---

## D-33 · Una boleta son varios pagos, y una sola notificación

**Estado:** 🟢 **Cerrada · 2026-08-19** — hallazgo de la revisión del contrato

**Contexto.** El contrato asumía que una boleta = un pago, guardaba un `pago_id` y prometía
devolverlo. Dos cosas lo desmienten:

1. `newPayment` recorre las cuotas pendientes mientras le quede dinero y **crea o actualiza
   una fila de `pagos_credito` por cuota**. Tres cuotas atrasadas pagadas con una boleta son
   tres pagos.
2. **La respuesta de `newPayment` no devuelve ningún `pago_id`**: devuelve un resumen con
   cuántas cuotas se pagaron completas y cuántas parciales.

Sin ids no hay circuito de vuelta: el evento de conta trae un `pago_id` que el CRM no sabría
de quién es.

**Decisión.**

- **`newPayment` devuelve la lista de ids creados** (`pagos: [48213, 48214]`). Es aditivo —el
  formulario de carteraFront ignora el campo— y no toca la lógica de aplicación.
- La relación **boleta → pagos es 1:N** y vive en `bot_cobros_boleta_pagos`, con `pago_id`
  único: así el evento entrante encuentra su boleta.
- **Un mensaje por boleta, no por pago.** Se espera a que todos los pagos de esa boleta estén
  resueltos y sale un solo mensaje: todos validados → "acreditado"; alguno revertido →
  "necesitamos revisar tu pago". Tres WhatsApp por una boleta sería absurdo.
- Si a las **24 h** la boleta quedó a medias (unos resueltos, otros no), se avisa **solo al
  asesor**. Al cliente no se le manda una verdad parcial.

**Reabrir el ciclo son dos campos.** Cuando un pago ya validado vuelve a `pending`
(`revertPaymentToPending`), no alcanza con limpiar `notificado_cliente_at` en la boleta: hay
que limpiar también el **`resuelto_en` de ese pago** en `bot_cobros_boleta_pagos`. Si quedara
marcado como resuelto, el job de respaldo —que solo mira pagos sin resolver— nunca vería la
revalidación posterior, y el cliente se quedaría con un "estamos revisando de nuevo tu pago"
que no termina nunca.

---

## D-34 · La confirmación se protege con estado, no con idempotency key

**Estado:** 🟢 **Cerrada · 2026-08-19** — hallazgo de la revisión del contrato

**Contexto.** Si `newPayment` commitea y el CRM se cae antes de guardar los ids —timeout,
corte de red—, un reintento del mismo `boletaId` vería el borrador sin confirmar y llamaría a
cartera otra vez: **un segundo pago real** por la misma boleta.

Y la red de cartera no alcanza: su chequeo de duplicados **solo corre cuando vienen
`numeroAutorizacion` y `banco_id` a la vez**, y en este contrato la autorización es opcional
(hay boletas que no la traen).

**Opciones.**
- A) Pasar una idempotency key (el `boletaId`) a `newPayment` y que cartera la respete.
- **B) Máquina de estados en el CRM + reconciliación por la `r2_key`.**

**Decisión: B.** A es lo que haría un libro de texto, pero `newPayment` mueve dinero y ya se
decidió antes no meterle idempotencia (ver el caso de las facturas duplicadas y el de
`aplicar-pago`). B consigue lo mismo sin tocar el camino de escritura:

1. El borrador pasa a **`confirmando`** con un UPDATE condicional (`WHERE estado = 'leida'`)
   **antes** de llamar a cartera. Dos peticiones simultáneas: solo una gana.
2. Un reintento sobre un borrador en `confirmando` **no llama a cartera**: responde
   `409 CONFIRMACION_EN_CURSO`.
3. Un job revisa los que llevan más de 5 minutos ahí y le pregunta a cartera si esa boleta
   existe, buscándola por la **`r2_key`** —que es única y quedó del lado de ellos en la tabla
   `boletas`—: si no existe, el borrador vuelve a `leida`.

Lo único que agrega del lado de cartera es un **endpoint de lectura**
(`GET /pagos-por-boleta?url=…`), que no puede romper nada.

**Encontrar filas no prueba que el registro quedó completo.** `insertPayment` **no es
transaccional**: escribe `pagos_credito` y `boletas` una por una contra el `db` global, sin
envolver el loop de cuotas. Si se cayó a mitad de repartir entre tres cuotas, quedaron filas
commiteadas *y* un 500 de vuelta. Por eso, cuando el job encuentra filas:

- **no** vuelve a llamar a `newPayment` (duplicaría lo ya escrito);
- deja el borrador en **`confirmada_a_verificar`**, no en `confirmada`;
- avisa a **contabilidad y al asesor** para que revisen si el monto quedó completo;
- al cliente le manda un mensaje neutro (*"estamos procesando tu pago"*), nunca "recibido".

Que `insertPayment` no sea atómico es un problema preexistente de cartera y excede este
feature. Lo que se decide acá es que el bot no lo convierta en un pago a medias silencioso.

---

## D-35 · El webhook adelanta el aviso, el job lo garantiza

**Estado:** 🟢 **Cerrada · 2026-08-19** — hallazgo de la revisión del contrato

**Contexto.** [D-28](#d-28--el-aviso-a-whatsapp-nunca-rompe-la-acción-de-conta) dice que
cartera avisa al CRM con try/catch, log y seguir. Eso protege a contabilidad, pero deja un
hueco: **si el CRM está caído justo en ese segundo, el evento se pierde para siempre**. Y el
aviso no es un adorno — es el producto: un pago validado del que el cliente nunca se entera
es peor que no tener circuito.

Aparte, faltaba un emisor. **El botón "Validar Pago" de contabilidad no llama a
`/revalidatePayment`**: llama a `pagosService.aplicarPago` → `GET /aplicar-pago?pago_id=…` →
`aplicarPagoAlCredito`, que es quien mueve el pago de `pending` a `validated`.
`/revalidatePayment` es la acción "Revalidar", reservada a ADMIN. Colgar el circuito solo de
ahí habría perdido **el caso normal**.

**Opciones.**
- A) Outbox con reintentos del lado de cartera (tabla + job en la app que mueve el dinero).
- **B) El CRM no depende del aviso: un job de respaldo consulta el estado.**
- C) Solo webhook, asumiendo la pérdida.

**Decisión: B**, más agregar `/aplicar-pago` a los emisores.

| Camino | Qué es | Cuándo actúa |
| --- | --- | --- |
| **Rápido** | El webhook `/pagos/evento` | Siempre que salga bien: el cliente se entera en segundos. |
| **Red de seguridad** | Un job del CRM revisa las boletas confirmadas con pagos sin resolver y le pregunta a cartera su `validation_status` | Cada hora. Si alguno dejó de estar `pending`, se procesa como si el evento hubiera llegado. |

A se descartó por dónde vive: meter una tabla de outbox y un job de reintentos **dentro de
cartera** es agregarle responsabilidad de mensajería a la app que mueve el dinero, para
resolver un problema que es nuestro. El job del CRM usa el mismo endpoint de lectura que ya
pide [D-34](#d-34--la-confirmación-se-protege-con-estado-no-con-idempotency-key) y no le
agrega nada al camino de escritura.

**Efecto lateral bueno:** ese job también cubre el caso de que cartera ni siquiera llegue a
intentar el aviso —un deploy en el medio, un proceso que muere— sin ninguna coordinación
extra entre las dos apps.

**El job pregunta por `pago_id`, nunca por la boleta.** `reversePayment` **borra las filas de
`boletas`** del pago —y si era un parcial con hermanos en la misma cuota, borra el
`pagos_credito` entero; si no, lo resetea a `no_required` con `numeroAutorizacion = ''` y
`banco_id = NULL`—. Preguntar "¿qué pasó con la boleta tal?" devolvería silencio **justo en
el caso que más urge avisar**: el rechazo.

> ⚠️ **Actualizado por [D-36](#d-36--las-reversiones-dejan-registro).** Cuando se escribió
> esta decisión, cartera no tenía tabla de reversiones, así que el rechazo había que
> **deducirlo** de lo que la reversión dejaba atrás: una fila ausente, o una reseteada a
> `no_required` con `numeroAutorizacion` vacío y `banco_id` en `NULL`. Con
> `pagos_reversiones` eso ya no se deduce, **se consulta**. Lo que sigue vigente de acá es la
> idea del segundo camino; la tabla de abajo es la versión buena:

| Lo que devuelve cartera para ese `pago_id` | Interpretación |
| --- | --- |
| `validated` / `capital_validated` | validado |
| `pending` | sigue esperando |
| `payment_false = true` | marcado falso |
| Reversión **`completada`** | **revertido**, con fecha y usuario |
| Reversión **`iniciada`** | quedó a medias: alerta a conta, **no** es un rechazo |

**La reconciliación de D-34 tenía la misma trampa**, que sí busca por `r2_key`: "no hay filas"
podía significar "no se registró" **o** "se registró y ya lo revirtieron", y devolver el
borrador a `leida` en esa duda dejaría que el cliente reconfirme un pago que contabilidad
acaba de rechazar.

**Eso también lo resolvió D-36.** Consultando `pagos_reversiones` la respuesta deja de ser
ambigua, y la lista de transiciones definitiva —cuatro respuestas, cuatro estados— vive en
[§4.1 del paso 4](./04-validacion-de-boleta.md#41-qué-pasa-si-el-bot-reintenta-el-mismo-boletaid).
Un "no hay nada de nada" **sí** vuelve a `leida`; `revision_manual` queda para la reversión a
medias.

---

## D-36 · Las reversiones dejan registro

**Estado:** ⚫ **Reemplazada por [D-38](#d-38--cartera-solo-se-toca-con-endpoints-nuevos) · 2026-08-21.**
El acta de reversiones exigía escribir dentro de `reversePayment` — el camino que mueve
dinero— y eso quedó prohibido. La ambigüedad que esta tabla resolvía la absorbe ahora la
revisión manual (§4.1) y el rechazo explícito del botón de conta (D-39). Se conserva el texto
por el análisis de `reversePayment`, que sigue siendo cierto.

**Estado original:** 🟢 Cerrada · 2026-08-19 — planteada y decidida por Daniel: *"me gusta la idea
de llevar un registro de los pagos revertidos, literal es una tabla más"*

**Contexto.** Buena parte de la maquinaria de este contrato —el estado
`confirmada_a_verificar`, el `revision_manual`, la inferencia del "acta de defunción", el job
horario de respaldo— no existe porque el bot la necesite. Existe para **compensar** dos cosas
de cartera:

1. `insertPayment` **no es transaccional**: puede dejar filas a medias.
2. `reversePayment` **borra sin dejar rastro**: no hay tabla de reversiones ni log.

La pregunta de Daniel: ¿y si en vez de rodearlas, las arreglamos?

**Primero, una corrección al planteo.** No son "los dos métodos no transaccionales":

| | ¿Transaccional hoy? | Cuál es su problema |
| --- | --- | --- |
| `insertPayment` | **No.** 1,682 líneas, 8 escrituras directas y 5 helpers, todos contra el `db` global | Puede escribir 2 de 3 cuotas y devolver 500 |
| `reversePayment` | **Sí**, ya corre dentro de `db.transaction` (línea 83) | No es atomicidad: **destruye evidencia** (borra las filas de `boletas`, y el `pagos_credito` si era parcial con hermanos) |

O sea que a `reversePayment` hacerlo atómico no le cambia nada: ya lo es. Lo que le falta es
**historial**.

### Las tres opciones, de más barata a más cara

**Opción 1 · Historial de reversiones** — *recomendada, y va más allá del bot.*
Antes de borrar, insertar una fila en una tabla `pagos_reversiones` (pago, crédito, montos,
motivo, usuario, fecha) **dentro de la transacción que ya existe**. Es un INSERT aditivo: no
cambia el comportamiento de nadie.

- **Mata del contrato:** la inferencia del tombstone (§6) y la ambigüedad que obliga al
  `revision_manual` (§4.1). "¿Se revirtió?" pasa a ser una consulta, no una deducción.
- **Riesgo:** bajo.
- **Valor fuera del bot:** hoy **nadie puede saber qué pagos se revirtieron, ni quién**. Eso
  es un hueco de auditoría propio, que el bot solo puso en evidencia.

**Opción 2 · `insertPayment` transaccional** — *cara y riesgosa; no como prerrequisito.*
Envolver las 1,682 líneas en una transacción implica pasar el `tx` por los 5 helpers en 4
archivos y refactorizar **`updateMora`**, que abre su propia `db.transaction` y tiene **13
llamadas desde 6 archivos**. Todos esos llamadores hay que tocarlos o dejarlos compatibles.

- **Mata del contrato:** el estado `confirmada_a_verificar`.
- **No mata:** el job de respaldo (existe porque el aviso se puede perder, no por atomicidad)
  ni el reconciliador de 5 minutos (existe porque la respuesta se puede perder) — aunque su
  resultado pasaría a ser binario y confiable.
- **Riesgo:** alto. Es el camino de escritura de **todos** los pagos del sistema, y alarga la
  duración de los locks de fila.

**Opción 3 · Outbox en cartera** — *la única que mata el job horario.*
Insertar el evento en la misma transacción que valida el pago, y un worker que reintenta
entregarlo al CRM.

- **Mata del contrato:** el job de respaldo de [D-35](#d-35--el-webhook-adelanta-el-aviso-el-job-lo-garantiza).
- **Riesgo:** medio. Tabla y worker nuevos **dentro de la app que mueve el dinero**, que es
  justo lo que D-35 evitó.

### Decisión: la 1. La 2 no, la 3 cuando moleste

Se hace el **registro de reversiones**. La 2 es cirugía sobre el corazón de cartera para
ahorrarse **un** estado; si algún día se hace será por sus propios méritos —pagos a medias en
producción— y no para simplificar el bot. La 3 queda para cuando el job horario estorbe.

### La tabla

```sql
CREATE TABLE cartera.pagos_reversiones (
  reversion_id             serial PRIMARY KEY,
  -- 'iniciada' se escribe FUERA de la transacción, antes de tocar nada;
  -- 'completada' se marca DENTRO, al final. Ver "las dos marcas" abajo.
  --   iniciada   → se empezó a revertir (fuera de la tx)
  --   completada → se revirtió de verdad (dentro de la tx)
  --   superada   → intento fallido que un reintento posterior ya resolvió
  estado                   text NOT NULL DEFAULT 'iniciada',
  -- Sin FK a propósito: la fila de pagos_credito puede desaparecer, y este
  -- registro tiene que sobrevivirla. Ese es todo el punto.
  pago_id                  integer NOT NULL,
  credito_id               integer NOT NULL,
  cuota_id                 integer,
  numero_cuota             integer,
  monto                    numeric(18,2),
  mora_devuelta            numeric(18,2),
  validation_status_previo text,
  numero_autorizacion      text,
  banco_id                 integer,
  -- Las boletas que la reversión está por borrar. Es lo que permite buscar
  -- después por la r2_key y saber que ese comprobante existió.
  urls_boletas             text[],
  motivo                   text,           -- opcional en v1; ver "quién y por qué"
  usuario_email            text NOT NULL,   -- sale del token, nunca del body
  revertido_en             timestamp NOT NULL DEFAULT now(),
  snapshot                 jsonb          -- la fila completa, por si algún día hace falta
);
CREATE INDEX ON cartera.pagos_reversiones (pago_id, estado);
CREATE INDEX ON cartera.pagos_reversiones (credito_id);
```

**No lleva unique por `pago_id`**: varios intentos sobre el mismo pago son legítimos, y
justamente el historial de los intentos es parte de lo que se quiere ver.

### Las dos marcas, porque la reversión no es del todo transaccional

La primera versión de esta decisión decía "el INSERT va dentro de la transacción que
`reversePayment` ya abre; si la reversión falla, el registro se va con ella". **Eso era falso**,
y lo dice el propio código de cartera en un comentario (`reversePayment.ts:156-166`):

> *"de acá para adelante hay tres cosas que escriben FUERA de esta transacción (usan el `db`
> global, no el `tx`): `updateMora`, `reverseConvenioPayment` y
> `processAndReplaceCreditInvestorsReverse`. Si el portero tirara después de ellas, el
> rollback NO las desharía."*

O sea que existe una ventana en la que **la mora ya se devolvió, el convenio ya cambió y el
inversionista ya se ajustó, pero el pago no quedó revertido** — y con un INSERT puramente
transaccional, además, sin ninguna huella de que eso pasó. Es la peor combinación: un
desastre invisible.

Por eso el registro se escribe en **dos momentos**:

| Marca | Dónde se escribe | Qué significa |
| --- | --- | --- |
| **`iniciada`** | **Fuera** de la transacción, apenas pasa el portero (`revertirAbonoCapitalEspejo`) y **antes** de los `delete` | "Se empezó a revertir este pago". Sobrevive al rollback **a propósito**. |
| **`completada`** | **Dentro** de la transacción, al final | "Se revirtió de verdad". Commitea junto con la reversión. |

- **Todo salió bien** → la fila queda `completada`. Es el caso normal.
- **Falló a mitad** → la fila queda `iniciada` para siempre, y **eso es exactamente la
  alarma**: la lista de reversiones a medias que hoy no existe. Alguien tiene que mirar ese
  crédito.

Del lado del bot, la diferencia es una regla dura: **`iniciada` NO es un rechazo.** Una boleta
que solo encuentra una reversión `iniciada` va a `revision_manual`, no a `rechazada`: no se le
puede decir a un cliente que su pago se rechazó cuando ni siquiera sabemos si se revirtió.

### Reintentos: qué pasa cuando hay varias filas del mismo pago

Una reversión que falla deja su fila en `iniciada`. Si alguien la reintenta y esta vez sale
bien, el mismo `pago_id` termina con **dos** filas —una `iniciada` y una `completada`—, y sin
una regla las dos respuestas de §4.1 aplicarían a la vez: `revision_manual` por una,
`rechazada` por la otra.

La regla es **por estado, no por fecha**, y son dos líneas:

1. **Si existe alguna `completada` para ese `pago_id`, esa manda.** La reversión terminó; los
   intentos anteriores son historia.
2. Al escribir el `completada`, **las `iniciada` previas de ese pago pasan a `superada`** en
   la misma transacción. Si el reintento también falla, siguen en `iniciada` y siguen
   alarmando.

Así la lista de reversiones a medias —`iniciada` sin `completada` posterior— **se limpia
sola** cuando alguien arregla el problema, y no hay que ir a marcar nada a mano.

### Quién y por qué

Los dos campos de auditoría tienen que salir de algún lado, y hoy no salen de ninguno:
`reversePaymentSchema` acepta **solo `credito_id` y `pago_id`**, el handler ignora el `user`
que el middleware ya deriva del token, y el front no manda ningún motivo.

| Campo | De dónde sale | ¿Obligatorio? |
| --- | --- | --- |
| `usuario_email` | Del **token**, vía el `user` que `authMiddleware` ya inyecta en el contexto (trae `id`, `email`, `role`) | **Sí** |
| `motivo` | Un campo nuevo en el body, opcional | **No en v1** |

**`usuario_email` no se acepta por el body, nunca.** Un campo de auditoría que lo llena quien
ejecuta la acción no audita nada. Sale del token, que ya está verificado; solo hay que
agregar `user` a la firma del handler —hay precedente en `payments.ts:1501`— y es cero trabajo
del lado del front.

**`motivo` queda opcional a propósito.** Ponerlo obligatorio implica un input nuevo en la
pantalla de conta en carteraFront, y eso es otro trabajo, con otro dueño. Mientras no exista,
hay que decirlo sin adornos: **la tabla responde "quién y cuándo", no "por qué"**. El campo
queda listo para el día que se agregue el input, que es lo que hay que pedirle a Cobros.

**Las URLs de las boletas se copian en el `iniciada`**, antes de los `delete`. Después ya no
existirían.

**Solo lo escribe `reversePayment`**, que es el único destructivo. `revertPaymentToPending` y
`false-payment` no borran nada, así que su rastro se sigue viendo en la propia fila del pago.

**Lo que esto no arregla.** Que esos tres helpers escriban fuera de la transacción sigue
siendo un problema de cartera, y meterlos adentro es el mismo refactor de `updateMora` (13
llamadas, 6 archivos) que ya se descartó en la opción 2. Lo que cambia es que ahora **queda
registrado**: pasamos de una inconsistencia silenciosa a una con nombre, fecha y crédito.

### Qué se lleva puesto del contrato del paso 4

| Antes | Ahora |
| --- | --- |
| Deducir "revertido" de una fila ausente, o de la firma `no_required` + autorización vacía + `banco_id NULL` | Una consulta: ¿aparece en `pagos_reversiones` como `completada`? |
| `revision_manual` cada vez que la reconciliación no encontraba nada (porque "nada" era ambiguo) | Solo para lo que no encaje en las tres respuestas posibles |

Era adivinar el motivo de una muerte por la posición del cuerpo. Ahora hay acta.

### Lo que arregla fuera del bot

Hoy, en producción, **nadie puede saber qué pagos se revirtieron ni quién lo hizo**: la
reversión borra las boletas y, si era un parcial con hermanos, la fila entera del pago. No hay
log ni tabla. Cualquier pregunta del tipo "¿qué pasó con este pago que estaba y ya no está?"
hoy no tiene respuesta. Esta tabla da **qué, cuándo y quién** — y el *por qué* el día que el
`motivo` tenga dónde escribirse. El bot solo fue la excusa para verlo.

---

## D-37 · Las cuentas de pago viajan con la info del crédito

**Estado:** 🟢 **Cerrada · 2026-08-19** — decidida por Daniel

**Contexto.** Cuando el cliente elige pagar, el bot tiene que decirle **a dónde deposita**.
Eso quedó como el último pendiente del paso 4: no sabíamos dónde vivía esa lista.

**Sí vive en el monorepo**, y hace rato: `COBROS_CUENTAS_PAGO` en `lib/cobros-plantillas.ts`
es el texto que los recordatorios de cobros ya le mandan al cliente. Son cuatro cuentas
monetarias, todas a nombre de **CUBE INVESTMENTS, S.A.**:

| Banco | Cuenta | `banco_id` |
| --- | --- | --- |
| Banco Industrial | 5520029876 | 1 |
| Banco Agromercantil (BAM) | 3020123033 | 16 |
| Banco G&T Continental | 01300039945 | 19 |
| Banrural | 3394002346 | 2 |

**Opciones.**
- A) Un servicio nuevo, `GET /cuentas-pago`.
- **B) Que viajen dentro de `/credito/info`, que el bot ya llama para armar el menú.**
- C) Texto quemado del lado de SimpleTech.

**Decisión: B.** *"¿Crees que podría ir las cuentas de una vez en la info del crédito? Para no
hacer otro servicio."* Son cuatro líneas de texto que casi nunca cambian: un endpoint aparte
sería una llamada de red para devolver una constante. Y C se descarta por lo mismo que todo el
resto del contrato: si el texto vive en SimpleTech, cambiar una cuenta es pedirle a un tercero
que despliegue.

**Cómo viaja.** `cuentasPago` trae dos cosas:

- **`texto`** — lo que el bot muestra **literal**, ya con saltos de línea y la negrita de
  WhatsApp. El bot no arma nada.
- **`cuentas`** — el mismo dato en estructura, que **no es decorativo**: con él se compara la
  cuenta destino que se lee de la boleta contra las nuestras. Eso cerró de paso el otro
  pendiente del paso 4, porque la boleta trae ese dato (la de Banrural que sirvió de ejemplo
  dice `NOMBRE DE CUENTA: CUBE INVESTMENTS` y el número completo).

**Una sola fuente.** El texto del bot se **deriva de `COBROS_CUENTAS_PAGO`**, con una prueba
que fija la cadena que hoy usan las plantillas: refactorizarla no puede cambiar ni una coma de
los mensajes que ya salen a producción. Si mañana cambia una cuenta, se toca un archivo y se
enteran los dos canales.

---

## D-38 · Cartera solo se toca con endpoints nuevos

**Estado:** 🟢 **Cerrada · 2026-08-21** — decidida por Daniel: *"no podemos tocar cosas que ya
estaban, solo ir agregando […] lo único que tenía que hacer cartera es recibir la info y luego
mandar a notificar"*

**Contexto.** Las primeras versiones del paso 4 modificaban `insertPayment` (lista de `pagos`
en la respuesta, acta de intentos), `reversePayment` (acta de reversiones, firma con `user`) y
otros caminos que mueven dinero. Cada modificación era defendible sola; juntas convertían el
feature en una intervención de cirugía sobre el core contable, con la superficie de revisión y
de riesgo que eso implica.

**La regla.** Para el bot de cobros, cartera-back se toca así y solo así:

- **endpoints nuevos** (lectura, o acciones nuevas como el botón de D-39 que **llaman** a los
  handlers existentes sin modificarlos);
- **campos nuevos en respuestas de lectura** (como `usuario_id` en `/credito/resumen`);
- **nada** dentro de `insertPayment`, `reversePayment`, `revalidatePayment`,
  `revertPaymentToPending`, `falsePayment` ni ningún otro camino que aplique o revierta plata.

**Lo que se paga a cambio, con los ojos abiertos.** Sin actas del lado de cartera, la
reconciliación pierde evidencia: "no encuentro nada" queda ambiguo y el borrador va a
**revisión manual** en vez de reabrirse solo (§4.1). Un borrador de más en manual cuesta
minutos de una persona; una reapertura equivocada cuesta plata del cliente — la asimetría
paga la regla.

---

## D-39 · El rechazo es un botón explícito, no se infiere del reverso

**Estado:** 🟢 **Cerrada · 2026-08-21** — planteada por Daniel: *"al momento de reversar
podría ser un movimiento interno […] mejor otra opción en el front que diga: pago no válido,
notificar al cliente y asesor"*

**Contexto.** El diseño anterior le avisaba al cliente "tu pago se rechazó" cuando cartera
emitía un evento de `reversePayment`. Pero en este sistema el reverso es una herramienta de
**reparación interna** que se usa todo el tiempo —cuadres de pools, renumeraciones,
reaplicaciones, correcciones de espejo—, así que el evento no distingue "tu boleta era mala"
de "movimos plata por dentro". Toda la maquinaria que intentaba compensarlo (orden de
webhooks, reversión-vs-revalidación, `pending` como transición) era complejidad tratando de
**adivinar la intención** desde la mecánica contable.

**La decisión.** La intención se declara, no se adivina:

- En carteraFront, sobre un pago del bot (`registerby = bot-cobros@clubcashin.com`), conta y
  ADMIN ven el botón **"Pago no válido — notificar al cliente"**. Pide un **motivo**, reversa
  el pago (llamando al `reversePayment` existente, sin tocarlo — D-38) y le avisa al CRM.
- Ese aviso es **el único** mensaje automático que el bot le manda al cliente sobre el destino
  de su pago: *"necesitamos revisar tu pago"* + notificación al asesor.
- El aviso de **pago validado** no es de este feature: lo está construyendo otra persona del
  equipo, y acá no se emite nada al validar.
- Los reversos normales, `revertPaymentToPending` y `false-payment` vuelven a ser lo que
  siempre fueron: movimientos internos que no le hablan a ningún cliente.

---

## D-40 · El historial vive en el CRM, en su propia tabla

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel; feature del
[historial de interacciones](./06-historial-interacciones.md) (CB-110)

**Contexto.** La Ficha 360 tiene que mostrar todo lo que el cliente hizo en el bot,
agrupado por la `referencia` de cada conversación. Ese dato hoy no existe en ningún lado:
los handlers atienden y olvidan.

**Opciones.**
- **A) Tabla nueva en el CRM (`bot_cobros_interacciones`), escrita al atender cada
  petición del bot.**
- B) Derivar el historial de lo que ya se guarda (`otps` + `bot_cobros_boletas`), sin
  tabla nueva.
- C) Que SimpleTech nos mande su log de conversación y lo importemos.

**Decisión: A.** El CRM es el punto de acceso único del bot ([D-01](#d-01--punto-de-acceso-único)):
**todo** el tráfico ya pasa por ahí, así que registrar es interceptar lo que ya tenemos en
la mano. B se descarta porque solo reconstruye búsquedas y boletas — las consultas de menú
y estado de cuenta no dejan rastro, y los errores (códigos malos, bloqueos) tampoco; sería
un historial con los huecos justo donde está lo interesante. C depende de un tercero, del
canal y de su formato, y lo que queremos enseñar es **lo que nosotros servimos**, no lo que
el bot conversó.

**Cartera no participa.** Ni endpoint, ni columna, ni evento: [D-38](#d-38--cartera-solo-se-toca-con-endpoints-nuevos)
ni siquiera se ejercita.

---

## D-41 · El registro es un middleware, y jamás rompe la respuesta

**Estado:** 🟢 **Cerrada · actualizada 2026-08-25** — decisión de Daniel

**Contexto.** Decidido dónde se guarda (D-40), falta quién escribe la fila.

**Opciones.**
- **A) Un middleware de Hono sobre las rutas del bot**, que registra después de que el
  handler respondió, con un **curador por acción** (la allowlist de D-42).
- B) Una llamada explícita a `registrarInteraccion(...)` dentro de cada handler.

**Decisión: A.** Con B, el primer endpoint nuevo que alguien agregue sin acordarse
del registro (paso 3 trae varios) desaparece del historial en silencio — exactamente el
tipo de convención-que-depende-de-acordarse que [D-23](#d-23--la-documentación-de-la-api-es-swagger-y-es-obligatoria)
ya nos enseñó a no aceptar. El middleware cubre las rutas presentes y futuras por
construcción: una ruta sin curador se registra igual (acción, éxito, `codigo`), solo que
con `detalle` vacío — **segura por defecto**, porque lo que no está en una allowlist no se
escribe.

### 📜 Regla general (pedida por Daniel, 2026-08-24)

**Todo servicio del bot —presente y futuro— nace dentro del historial.** El bot va a
seguir creciendo, y esta regla no es por endpoint: el middleware se monta **comodín sobre
`/api/bot/cobros/*`**, así que un servicio nuevo queda registrado sin que nadie haga nada.
Lo excepcional es lo contrario: quedar FUERA del historial exige una entrada en la lista
de exclusiones (`RUTAS_SIN_HISTORIAL`), con nombre y motivo — hoy solo `docs`,
`openapi.json` (no los llama el cliente) y `pagos/evento` (lo llama cartera). El mismo
patrón que `RUTAS_QUE_NO_SON_DE_SIMPLETECH` en el candado del Swagger: la excepción
cuesta escribirse y justificarse.

Al crear un servicio nuevo, lo único opcional es su **curador** (D-42): sin él, el
servicio se registra igual con acción, éxito y `codigo`, pero con `detalle` vacío —
seguro por defecto.

**Las reglas duras** (espíritu de [D-28](#d-28--el-aviso-a-whatsapp-nunca-rompe-la-acción-de-conta)):

1. El INSERT va **sin `await`**, con try/catch y log. El bot nunca espera al historial ni
   ve un 500 por su culpa. Si la escritura falla, se pierde una fila de historial, no una
   conversación.
2. El middleware lee un **clon** de la respuesta; la que viaja al bot no se toca.
3. **El contrato con SimpleTech no cambia en nada** — por eso el Swagger no se toca y
   `openapi.test.ts` sigue en verde sin cambios.

---

## D-42 · Qué guarda cada interacción (y qué nunca)

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel

**Contexto.** El historial lo van a leer asesores en la Ficha 360, y [D-14](#d-14--retención-de-pii-y-logs)
ya propone que la PII del bot se guarde hasheada o enmascarada. Guardar "todo el request y
todo el response por si acaso" convertiría la tabla en el lugar donde la PII se acumula
sin control.

**Decisión: allowlist por acción, y nada más.** Cada acción tiene un curador que
elige campos concretos (la tabla completa está en el
[§2 del contrato](./06-historial-interacciones.md#2--qué-se-registra)); lo que no está en
la lista **no se escribe**, incluido el caso de una ruta futura sin curador (`detalle`
vacío).

**Lo que nunca se guarda, con nombre:**

- el **código OTP** — ni en éxito ni en error; ya es regla en logs ([D-16](#d-16--quién-valida-el-otp))
  y el historial no es la excepción;
- **teléfonos completos** — solo la máscara que el propio endpoint ya devuelve al bot;
- el **identificador de búsqueda crudo** — se guarda el tipo (dpi/nit/placa) y la versión
  enmascarada;
- **URLs de imagen de WhatsApp** ni el cuerpo crudo de la lectura — la boleta completa ya
  vive en `bot_cobros_boletas`; el historial solo lleva el `boletaId` que la enlaza;
- cuerpos crudos de request/response.

**Los errores sí se guardan** (`exito = false` + `codigo`): "probó tres códigos y se
bloqueó" es información de cobranza, no ruido.

**Retención: ninguna en v1.** Sin PII no hay qué purgar; la fila referencia al OTP con
`SET NULL` para sobrevivir la purga que D-14 propone, igual que `bot_cobros_boletas`.

---

## D-43 · Los intentos fallidos con cliente conocido también se registran

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel

**Contexto.** La referencia nace cuando el OTP se emite. Pero hay caminos de
`buscar-cliente` donde **el cliente se encontró y el OTP nunca salió**: `DEMASIADOS_ENVIOS`
(se le acabaron los reenvíos) y `SIN_TELEFONO` (no hay móvil utilizable, [D-19](#d-19--a-qué-teléfono-se-manda-el-otp)).
Sin referencia, esas peticiones no tienen sesión a la cual colgarse.

**Opciones.**
- **A) Registrarlas igual, con `otp_id NULL` y el lead/codeudor resuelto**, mostradas en
  la ficha como "Intentos de acceso sin sesión", aparte de las referencias numeradas.
- B) Registrar solo lo que tiene referencia.

**Decisión: A.** "El cliente intentó entrar al bot y no pudo porque no tiene teléfono
utilizable" es exactamente lo que un asesor necesita saber **antes** de mandarle el enlace
del bot por enésima vez. Y no cuesta nada: el handler ya resolvió al lead para poder
responder ese error.

**Lo que NO se registra:** `CLIENTE_NO_ENCONTRADO` sin match. No hay lead, así que no hay
ficha donde mostrarlo — y guardar términos de búsqueda de desconocidos es juntar PII de
gente que ni es cliente.

---

## D-44 · La vista: por referencia, con correlativo del cliente

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel

**Contexto.** Cómo se le enseña esto al asesor en la Ficha 360.

**Decisión.**

1. **Agrupado por referencia, colapsado, la más reciente primero.** Cada grupo:
   "Referencia N · fecha · quién operó · cuántas interacciones"; expandir muestra la línea
   de tiempo de esa conversación.
2. **El correlativo es del cliente y se calcula al leer** (orden de creación de la
   sesión); no se guarda, así no hay contador que mantener ni que se desincronice.
3. **El uuid crudo no se pinta.** Durante 30 minutos es la llave de la sesión
   (`verificarAcceso`, [D-24](#d-24--el-menú-hereda-la-identidad-del-paso-1)); en la UI va
   solo un sufijo truncado en un tooltip, para cruzar con soporte.
4. **Se muestran todas las sesiones del cliente**, titular y codeudores de sus
   oportunidades, etiquetando quién operó — con esto queda respondida la pregunta 2 de
   [D-11](#d-11--quien-escribe-no-es-el-titular): sí queda registrado quién hizo cada
   gestión.
5. **Las interacciones de otros créditos del mismo cliente se ven igual**, marcadas con su
   número SIFCO: la ficha es del caso, pero el historial es del cliente. Ocultarlas
   escondería justo el patrón "sube boletas del crédito B para estirar el A".
6. El agrupado y numerado lo hace **el server** (`getActividadBot`, ORPC protegido): la
   web pinta, no calcula.

---

## D-45 · El bot reusa la infraestructura Págalo de CB-028

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel; los ajustes del modelo se
coordinan con Jose

**Contexto.** Jose ya modeló la persistencia Págalo para el link creado por el **asesor**
(CB-028, PR #1415): `pagalo_payment_groups` + `pagalo_payment_links` +
`pagalo_payment_events` en el CRM, y el ledger idempotente `pagalo_payment_imports` en
cartera. El bot necesita exactamente lo mismo: dos links, verificación ACCEPT, aplicación
idempotente.

**Opciones.**
- **A) Un solo modelo y un solo circuito: el grupo del bot es un `pagalo_payment_group`
  más, con su origen marcado.**
- B) Tablas y jobs propios del bot, paralelos a los del asesor.

**Decisión: A.** El poller, el dispatcher y el ledger se construyen **una vez** y sirven a
los dos orígenes; dos tuberías para el mismo dinero es duplicar los bugs. Lo que el modelo
necesita para aceptar al bot (detalles de Daniel, 2026-08-24):

1. **El grupo del bot se asocia al asesor que tiene asignado el crédito**
   (`creditos.asesor_id` de cartera) — el link del bot es una gestión más de la cartera de
   ese asesor. Cómo se traduce a `created_by` (NOT NULL contra `user.id`) se define en
   implementación: mapeo asesor→user o columna propia + usuario de sistema.
2. **Columna `origen`** (`ASESOR` / `BOT`) en el grupo, para que la ficha, los reportes y
   la notificación distingan quién lo generó.
3. Confirmar que el grupo sin `contacto_cobro_id` (el bot no nace de una gestión) es un
   caso soportado, no un accidente del nullable.
4. **Aceptar grupos de un solo link** ([D-48](#d-48--capital-en-un-link-todo-lo-demás-en-el-otro)):
   relajar el CHECK `capital_total > 0 AND facturable_total > 0` y los invariantes de
   "ambos tipos" para las selecciones sin capital (o solo capital).

**Ya resuelto por CB-028 sin pedirlo:** el tipo del pago en cartera
(`origen_pago = 'pagalo'`, agregado al enum en la migración 0008) y el destino del voucher
(**queda como boleta en `cartera.boletas`**) — las dos cosas que el flujo del bot necesita
para que un pago Págalo sea rastreable como cualquier otro.

---

## D-46 · El cliente elige cuántas cuotas; el CRM arma el monto

**Estado:** 🟢 **Cerrada · 2026-08-24** — regla base de la reunión 2026-08-13 + revisión
de Daniel del contrato

**Contexto.** ¿Qué decide el cliente en el chat al pedir un link?

**Decisión.**

1. El bot ofrece **solo cantidades de cuotas**: al día → únicamente la cuota actual; con
   atraso → de 1 a N cuotas **acumuladas desde la más vieja** (elegir cuotas sueltas no
   existe), **más la opción de agregar la próxima por vencer** — confirmado por Daniel:
   hoy 24 de agosto el cliente puede pagar también la del 30.
2. **La mora jamás es elegible**: toda opción con atraso la incluye, **completa**. Es
   además lo único implementable: la foto de `moras_credito` guarda un monto por crédito,
   no por cuota.
3. **No hay pagos parciales**: se pagan cuotas completas. Por eso el reparto por rubro de
   cada link es determinista — se sabe exactamente qué abono va a dónde, sin que nadie
   tenga que decidirlo después. Y las opciones se calculan sobre el **saldo** de cada
   cuota (total − lo ya aplicado): una que venía a medias —boleta parcial, excedente
   abonado— se ofrece por **lo que le falta**, y pagarla la deja **cerrada**, nunca más a
   medias.
4. Los montos, el desglose y los textos los arma **el CRM** en `/pago-link/opciones`; el
   bot no suma nada ([D-38](#d-38--cartera-solo-se-toca-con-endpoints-nuevos) del lado de
   datos: el desglose por cuota sale de cartera por el mismo servicio que use el flujo del
   asesor).
5. **Sin mora confiable no hay link**: la guarda `moraPorConfirmar` del paso 2 acá
   **bloquea** (`409 MORA_POR_CONFIRMAR`) y manda al cliente con su asesor. Generar un
   link con una mora que sabemos dudosa es cobrar mal con evidencia.

---

## D-47 · Fuente única del monto y `montoEsperado`

**Estado:** 🟢 **Cerrada · 2026-08-24** — confirmada por Daniel. Matiz suyo: la sesión del
bot tiene ventana de 30 minutos ([D-24](#d-24--el-menú-hereda-la-identidad-del-paso-1)),
así que la conversación no puede quedarse colgada días — el candado cubre el borde fino
(el job de moras de las 23:59 cayendo en medio), no conversaciones eternas. Para el monto
que cambia DESPUÉS de generar el link, ver [D-52](#d-52--si-deuda-cambia-págalo-se-comporta-como-boleta-manual).

**Contexto.** El monto que el cliente vio en las opciones y el monto del link **tienen**
que ser el mismo número. En el módulo de cobros ya existe el bug de la doble fuente del
monto de mora; y entre que el cliente mira y decide, la mora puede recalcularse (job de
las 23:59) o entrarle un pago al crédito.

**Opciones.**
- A) Persistir las opciones ofrecidas (snapshot server-side con id de oferta) y crear el
  link desde ese snapshot.
- **B) Sin estado: una sola función arma opciones y arma el link; `/pago-link/crear`
  recibe `montoEsperado` (lo que el cliente vio), recalcula y si no coincide responde
  `409 MONTO_DESACTUALIZADO`.**

  *Ajuste 2026-08-25 (acordado con SimpleTech):* el campo se llama `monto` y es **lo
  único** que viaja además de la identidad — no se manda `cuotas`. Como cada opción agrega
  una cuota, los montos son estrictamente crecientes y el monto identifica la opción.
  Además `/opciones` ofrece **máximo 4** y las devuelve aplanadas (`cantidadOpciones`,
  `opcionNEtiqueta`, `opcionNMonto`), como `cantidadCreditos`/`etiquetaN` del paso 1.

**Decisión: B.** Da la misma garantía —nunca se cobra un monto distinto del mostrado— sin
inventar una tabla de ofertas efímeras ni TTLs. El costo es un round-trip extra en el caso
raro en que el monto cambió justo en medio, y ese round-trip es además el comportamiento
correcto: el cliente debe ver el monto nuevo antes de pagar. El snapshot durable que sí
importa (auditoría de qué se cobró) ya lo guarda el grupo CB-028 en
`allocations_snapshot`.

---

## D-48 · Capital en un link, todo lo demás en el otro

**Estado:** 🟢 **Cerrada · 2026-08-24** — decisión de negocio (facturación), reparto
confirmado por Daniel

**Contexto.** El capital no se factura; el resto de la cuota sí. Un solo link mezclaría
rubros facturables y no facturables en un mismo cobro de tarjeta.

**Decisión.**

1. **El reparto es por la jerarquía de abonos que ya tiene el pago** en cartera
   (`pagos_credito`): `abono_capital` → link `CAPITAL`; **todo lo demás** → link
   `MORA_INTERES`: `abono_interes`, `abono_iva_12`, `abono_interes_ci`, `abono_iva_ci`,
   `abono_seguro`, `abono_gps`, `membresias_pago` y `mora`. No hay nada que inventar: el
   desglose por cuota ya existe. Para una cuota que venía con pago parcial, el reparto usa
   los **`*_restante`** de esa fila (lo que falta de cada rubro), no los valores
   nominales.
2. **Si un lado es Q0, ese link no se genera**: una selección sin capital (solo-interés,
   insoluto) o solo capital produce **un único link**. Requiere relajar el CHECK de CB-028
   (hoy exige ambos > 0) — coordinación en [D-45](#d-45--el-bot-reusa-la-infraestructura-págalo-de-cb-028).
3. **La cara al cliente es neutra**: los links se describen `"Crédito {sifco} · Pago 1 de
   2"` y `"… · Pago 2 de 2"` (o `"… · Pago"` si es uno solo). **Nunca** "intereses" ni
   "mora" en la descripción — asusta al cliente sin necesidad; el desglose real vive en
   el snapshot y en cartera.
4. El grupo existe completo o no existe: si Págalo falla creando el segundo, el grupo
   queda `CANCELLED` — nunca se le entrega al cliente media intención de pago. En un grupo
   de dos, pagar solo uno lo deja `PARTIALLY_PAID` y nada se aplica en cartera hasta
   completarse; en un grupo de un solo link, ese único `ACCEPT` ya lo deja
   `READY_TO_APPLY`.
5. **Al importar, links se combinan:** separación existe en checkout y evidencia
   fiscal. Cartera registra un único pago con suma de links y deja reparto al
   mismo motor de boleta manual; no conserva dos presupuestos internos.

**Consecuencia UX asumida:** el cliente pasa (hasta) dos veces por el checkout de Págalo.
Es el precio de no generar factura sobre capital; lo amortigua el mensaje armado que
numera los links y su monto.

---

## D-49 · Del pago nos enteramos nosotros, no el cliente

**Estado:** 🟢 **Cerrada · actualizada 2026-08-25** — decisión de Daniel

**Contexto.** ¿Cómo sabemos que un link fue pagado? La colección de Págalo **no documenta
webhooks firmados**: los `callback_accept/reject` del create son redirects del navegador
del cliente — sin firma, desde su dispositivo, falsificables.

**Decisión.** Tres capas, mismo patrón que
[D-35](#d-35--el-webhook-adelanta-el-aviso-el-job-lo-garantiza):

1. **La verdad es el poller** (CB-028, lease ya modelado en `pagalo_payment_links`):
   pregunta el estado del link (`2` = pagado) y **verifica la transacción**
   (`status_transaction = 'ACCEPT'` vía `id_external`) antes de marcar nada. El CHECK de
   `is_application_source` lo hace imposible de saltar.
2. **Los callbacks solo aceleran**: si llegan, adelantan `next_poll_at` de ese link a
   ahora. Jamás escriben estado.
3. **La confirmación del cliente no existe en el flujo**: la conversación termina al
   entregar los links, y el "¿ya pagaste?" del árbol de gerencia queda de cortesía. Si el
   cliente avisa o no avisa, el resultado es idéntico.

**Respaldo:** `/v1/integration/transactions` (listado paginado con Bearer) queda como
herramienta de conciliación si algún día dudamos del poller.

---

## D-50 · El pago por link nace validado en la misma transacción

**Estado:** 🟢 **Cerrada · v2 2026-08-26** — decisión de Daniel con el equipo
(v1 del 2026-08-24 lo dejaba `pending` para conta).

**Contexto.** La boleta entra a cartera y espera a que conta la valide
([D-39](#d-39--el-rechazo-es-un-botón-explícito-no-se-infiere-del-reverso)). El pago por
link ya viene verificado contra Págalo (`ACCEPT` + voucher), así que esperar a un humano
solo retrasa el cierre de la cuota — y deja la ventana registrar→validar en la que el
cron de moras vuelve a cobrar lo ya pagado ([D-52](#d-52--si-deuda-cambia-págalo-se-comporta-como-boleta-manual)).

**Decisión.** Cuando el grupo llega a `READY_TO_APPLY` —**todos los links requeridos**
([D-48](#d-48--capital-en-un-link-todo-lo-demás-en-el-otro)) con `ACCEPT` verificado y
voucher guardado— el dispatcher hace **una sola llamada** a cartera, y cartera, en **una
sola transacción** con las funciones de siempre recibiendo la `tx` por parámetro:

1. iguala la mora viva al snapshot (D-52);
2. registra el pago (`procesarRegistroPago`, `origen_pago = 'pagalo'`, voucher como boleta);
3. le pone la cuenta de empresa **PAGALO** (lo que el front hace en "Seleccionar Cuenta");
4. **lo valida** con `aplicarPagoNormalEnTx` — la misma función del botón "Validar Pago",
   con los mismos guards previos (`evaluarPagoParaAplicar`);
5. repone la diferencia de mora y marca el import `APPLIED`.

Si algo falla, rollback completo y el CRM reintenta (idempotente por `crm_group_id`).

**Después del commit, lo dispara cartera** (fire-and-forget, como hace `/aplicar-pago`):
la **factura** (SAT, irreversible: nunca dentro de la tx) y el **recibo por WhatsApp**.
El resultado de la factura queda en el ledger (`factura_status`); si falla, el pago sigue
validado y la factura se resuelve por el playbook normal.

**Notificación: la manda cartera.** El recibo de pago por WhatsApp es el mismo que recibe
cualquier cliente al validarse su pago. El bot **no** manda un segundo recibo con saldos
— solo el acuse al detectar cada `ACCEPT` («recibimos tu Pago 1 de 2…»). Esto reemplaza
el "recibo en dos tiempos" de [07-pago-con-link §5](./07-pago-con-link.md#5-después-del-chat-quién-escucha-y-quién-aplica).

**Lo que sí queda para humanos:** los grupos `REVIEW_REQUIRED` (montos que no cuadran,
links duplicados pagados, hash distinto en retry, identidad del crédito cambiada) — esos
no se aplican solos jamás.

**Consecuencia:** `COMPLETED` en el CRM = pago **validado** en cartera (cuota cerrada,
capital movido, inversionistas distribuidos). La factura puede ir unos segundos detrás.

---

## D-51 · Los links no expiran (por ahora)

**Estado:** 🟢 **Cerrada · actualizada 2026-08-25** — decisión de Daniel

**Contexto.** La propuesta original era expirar los links el mismo día (la mora se
recalcula a las 23:59 GT y un link viejo queda corto). Pero un grupo son dos links: ¿qué
pasa si el cliente paga uno y el otro expira antes de que pague el segundo? Recuperar ese
medio pago es un enredo sin salida fácil.

**Decisión.** `expiration: false` en todos los links del grupo, **por ahora**. El escenario "pagó la
mitad y la otra mitad ya no existe" es peor que el escenario "pagó con un monto de hace
unos días".

**Consecuencias asumidas:**

1. **El monto queda congelado al generar**: si el cliente paga días después y la mora
   creció (o nació una que no existía), pago combinado entra igual y motor normal
   consume mora viva primero, ver
   [D-52](#d-52--si-deuda-cambia-págalo-se-comporta-como-boleta-manual).
2. **Regenerar no mata al viejo por API**: la colección de Págalo no documenta cómo
   cancelar un link (el estado 3 = cancelado existe, seguramente desde su panel — hay que
   preguntarles). Al generar links nuevos, los viejos se marcan `REPLACED` en nuestro
   modelo y se cancelan **a mano en el panel** mientras no haya API. Un `REPLACED` **sigue
   en el poll** hasta observar su destino final —pagado, cancelado o expirado— porque
   sigue siendo cobrable: sacarlo del barrido volvería invisible un pago real (hallazgo de
   Codex; el índice del poll se amplió en la migración 0046 del CRM). Si alguien paga un
   link viejo, el partial UNIQUE de CB-028 manda el grupo a `REVIEW_REQUIRED` en vez de
   aplicar dos veces.
3. Cuando Págalo confirme si hay cancelación por API, esta decisión se revisa: expirar o
   cancelar al regenerar sería lo limpio.

---

## D-52 · Si deuda cambia, Págalo se comporta como boleta manual

**Estado:** 🟢 **Cerrada · actualizada 2026-08-25** — decisión de Daniel

**Contexto.** Los links no expiran ([D-51](#d-51--los-links-no-expiran-por-ahora)) y el
monto queda congelado al generarlos. Dos escenarios donde la realidad se movió antes de
que el cliente pagara:

- La mora **creció** (el job de las 23:59 corrió entre generar y pagar).
- Nació una mora **que no existía**: el cliente al día generó hoy el link de su cuota del
  30, y pagó después del 30 — esa mora nueva no se puede simplemente quitar.

**Decisión.** Grupo conserva separación CAPITAL/MORA_INTERES únicamente para
checkout, facturación y evidencia. Cuando todos links requeridos tienen
`ACCEPT`, dispatcher suma montos y Cartera crea un solo pago mediante motor de
boleta manual.

1. Si mora creció o nació, motor consume mora vigente primero. Si dinero no
   alcanza, pago queda aplicado parcialmente según reglas normales; Págalo no
   guarda faltante especial ni manda aviso especial.
2. Si deuda se achicó, sobrante sigue cascadeo normal a cuotas posteriores o
   saldo a favor. No pasa a `REVIEW_REQUIRED` solo por link sobrado.
3. Snapshot queda inmutable como auditoría de monto emitido; no es presupuesto
   que limite distribución posterior dentro de Cartera.

Esta decisión reemplaza diseño anterior de dos presupuestos de aplicación y de
revisión automática por sobrante.

**Ajuste 2026-08-26 (Daniel) — la mora que creció no se cobra de este pago.**
El punto 1 dejaba al cliente con la cuota abierta aunque pagó exactamente lo que
le dijimos. Ahora, al aplicar (`pagaloPaymentImport.ts`, dentro de la misma
transacción y con el crédito bajo lock):

1. Se compara la mora viva (`moras_credito.activa`) con la mora del snapshot
   (suma del rubro `MORA`; Q0 si el grupo se armó al día).
2. Si la viva es **mayor**, se baja a la del snapshot (`DECREMENTO`), se aplica
   el pago (la mora del link y las cuotas cierran) y se repone la diferencia
   (`INCREMENTO`, reactivando la fila). El crédito sigue `MOROSO` por esa
   diferencia y queda en `moras_historial` con motivo `Ajuste Págalo grupo …`.
3. Si la viva es **igual o menor** (condonación o pago por otro canal entre
   medio) no se sube: sería cobrar mora que ya no debe. Aplica el punto 2 tal
   cual (sobrante cascadea).

Qué monto queda debiendo a la larga NO lo decide este ajuste sino
`procesarMoras` (23:59), que recalcula desde cero `capital × 1.12% × cuotas
vencidas`: si tras el pago ya no hay cuota vencida, esa noche la mora se
desactiva; si la cuota que venció después de generar el link sigue abierta, la
mora amanece con el monto justo por esa cuota. La reposición del punto 2 solo
evita que el crédito figure `ACTIVO` las horas entre el pago y el cron.

**Requisito:** el pago Págalo debe quedar **validado en la misma transacción**
(siguiente slice). El cron solo cuenta la cuota como cubierta con pago
`validated`/`no_required`; un pago `pending` que cruce las 23:59 hace que
reponga la mora completa y cobre de nuevo la parte ya pagada — la misma ventana
registrar→validar que hoy tiene cualquier boleta manual con mora. No se
parcha `procesarMoras` por esto: se cierra validando de una vez.


## D-53 · Una cuota vencida sin saldo bloquea el link

Si el crédito tiene una cuota **vencida, impaga y sin nada que cobrar** —todos
sus `*_restante` en cero— no se ofrecen opciones ni se genera link:
`CREDITO_REQUIERE_REVISION` (409) y el cliente va con su asesor. Mismo criterio
que la guarda de mora del punto 5 de
[D-46](#d-46--el-cliente-elige-cuántas-cuotas-el-crm-arma-el-monto): antes de
cobrar un monto que no podemos justificar, se lo pasamos a un humano.

**Por qué existe ese estado.** Cuando un pago cierra una cuota, cartera pone en
cero los `*_restante` de todas sus filas. Al reversar, la cuota vuelve a estar
impaga pero solo se le devuelve a la fila del pago reversado lo que ese pago
abonó: la fila sembrada se queda vacía. La cuota termina sin pagar y sin deber
nada. Caso real (crédito 9266, dev): tras un ciclo de pagos y reversas, el bot
le respondió **"estás al día 🎉"** a un cliente con una cuota vencida hacía 16
días y le ofreció pagar la de tres meses después.

**Por qué el guard vive acá y no solo en cartera.** La reversa ya recalcula la
proyección al terminar (`reversePaymentRecalculo.ts`), pero esa es *una* de las
puertas: al revisar producción aparecieron dos créditos en ese estado **sin
ninguna reversa registrada**, o sea que hay al menos otro camino sin
identificar. El guard protege por el lado del que cobra, venga de donde venga.

**Qué NO cuenta como hueco**, para no bloquear créditos sanos:

- Una cuota con saldo en **cualquiera** de sus filas: un pago parcial deja la
  fila sembrada en cero y el saldo real en la del pago (crédito 624, cuota 20).
- Una cuota con **pago esperando validación**: sus restantes están en cero
  legítimamente hasta que conta valide — eran 55 de los 62 casos que a primera
  vista parecían huecos en producción.
- Una cuota **futura** en cero: las colas de calendario en cero no impiden
  cobrar lo que sí está vencido.

Cobrar sobre un hueco no era solo mostrar mal el monto: cartera distribuye con
`min(saldo de la fila, …)`, así que el pago **tampoco se habría aplicado a esa
cuota** — el cliente pagaba y seguía debiendo.
