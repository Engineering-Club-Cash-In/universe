# Registro de decisiones — bot de cobros

Cada decisión de diseño del feature vive acá: qué se preguntó, qué opciones había, qué se
eligió y por qué. Si algo se decide en una llamada o por WhatsApp, se escribe acá el mismo
día; si no está escrito, no está decidido.

**Estados:** 🟢 Cerrada · 🟡 Propuesta (recomendación de IT, falta confirmar) · 🔴 Abierta (bloquea trabajo)

| # | Tema | Estado |
| --- | --- | --- |
| [D-01](#d-01--punto-de-acceso-único) | Punto de acceso único | 🟢 |
| [D-02](#d-02--quién-compara-el-teléfono-del-chat) | Quién compara el teléfono del chat | 🟡 |
| [D-03](#d-03--segundo-factor-cuando-el-número-no-coincide) | Segundo factor | 🔴 |
| [D-04](#d-04--dónde-vive-el-estado-de-identidad) | Dónde vive el estado de identidad | 🟡 |
| [D-05](#d-05--cómo-se-reporta-no-encontrado) | Cómo se reporta "no encontrado" | 🟡 |
| [D-06](#d-06--ttl-de-la-sesión-y-caducidad-de-la-verificación) | TTL de sesión y de la verificación | 🔴 |
| [D-07](#d-07--otp-de-cobros-reuso-o-endpoints-nuevos) | OTP de cobros | 🔴 |
| [D-08](#d-08--qué-es-un-crédito-activo-listable) | Qué es un "crédito activo" | 🔴 |
| [D-09](#d-09--normalización-de-placa-y-nit) | Normalización de placa y NIT | 🔴 |
| [D-10](#d-10--ambiente-de-pruebas-para-simpletech) | Ambiente de pruebas | 🔴 |
| [D-11](#d-11--quien-escribe-no-es-el-titular) | Quien escribe no es el titular | 🔴 |
| [D-12](#d-12--términos-y-condiciones) | Términos y condiciones | 🔴 |
| [D-13](#d-13--canal-del-otp) | Canal del OTP | 🟡 |
| [D-14](#d-14--retención-de-pii-y-logs) | Retención de PII y logs | 🟡 |

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

**Estado:** 🟡 Propuesta

**Contexto.** Hay que decidir si el número desde el que escribe el cliente coincide con
alguno de los registrados. La descripción original del flujo era: el CRM devuelve la lista
de teléfonos y SimpleTech compara.

**Opciones.**
- **A) El CRM compara.** El bot manda `telefonoChat` en `/identificar`; el CRM responde
  `verificada` o `requiere_otp` y una lista **enmascarada**.
- B) SimpleTech compara. El CRM devuelve los teléfonos completos.

**Recomendación de IT: A.** Con B, los números completos del cliente salen de nuestros
servidores y quedan en los logs y el estado conversacional de un tercero, sin ganar nada:
el bot igual necesita llamar al CRM para mandar el OTP. Con A el bot recibe solo
`****1234` y un `id` de sesión para elegir a dónde mandar el código.

**Impacto si cambia:** afecta el contrato de `/identificar` (§3.1 del Paso 1).

**Pendiente:** confirmar con SimpleTech que su motor puede mandar el número del chat como
parámetro de la llamada.

---

## D-03 · Segundo factor cuando el número no coincide

**Estado:** 🔴 Abierta · **bloquea la implementación**

**Contexto.** El PDF dice: "OTP si número ≠ CRM", con "validación de vida como paso
opcional adicional". Falta cerrar qué se implementa ahora.

**Opciones.**
- A) Solo OTP a un teléfono registrado (lo mínimo del árbol).
- B) OTP + validación de vida siempre (existe `livenessController` en el CRM).
- C) OTP y, además, validación de vida solo para gestiones sensibles.
- D) OTP + una pregunta de control (ej. últimos 4 del DPI, marca del vehículo).

**A discutir:** la validación de vida en WhatsApp implica sacar al cliente a un link
externo; hay que medir cuánta gente se cae del flujo antes de imponerla. Decide Cobros
junto con IT.

---

## D-04 · Dónde vive el estado de identidad

**Estado:** 🟡 Propuesta

**Opciones.**
- **A) Sesión en el CRM con token opaco.** El bot guarda solo el `sesionId`.
- B) Sin sesión: el bot reenvía el identificador (DPI/NIT/placa) en cada llamada.

**Recomendación de IT: A.** Con B el DPI del cliente queda dando vueltas en cada request y
en el estado del bot, y no hay forma de exigir "ya verificó" — cualquiera con el DPI
consulta el crédito. La sesión además da auditoría, expiración y bloqueo natural.

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

**Estado:** 🔴 Abierta

**Preguntas.**
1. ¿Cuánto dura una sesión? (propuesta: 15 min, renovable con actividad)
2. ¿Cuánto dura la verificación? Si el cliente vuelve dos horas después desde el mismo
   número, ¿repite el OTP?
3. ¿Se puede "recordar" un número no registrado que ya pasó OTP, para no pedírselo cada
   vez? Si sí, ¿por cuánto tiempo y con qué registro?

Es un balance entre fricción y seguridad; lo define Cobros con IT.

---

## D-07 · OTP de cobros: ¿reuso o endpoints nuevos?

**Estado:** 🔴 Abierta · **bloquea la implementación**

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

**Estado:** 🔴 Abierta · **bloquea la implementación**

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

**Estado:** 🔴 Abierta

**Preguntas.**
1. ¿Qué formatos de placa se aceptan? (`P123ABC`, `P-123ABC`, minúsculas, con espacios).
   ¿Cómo están guardadas hoy en `vehicles.license_plate`?
2. NIT: ¿con guion, sin guion, con dígito verificador? ¿Se rechaza `CF`?
3. DPI: ya existe el helper `eqDpi` para lidiar con formatos mezclados; se reutiliza.

Es un problema de datos, no de diseño: requiere revisar cómo están guardados los valores
en producción antes de definir la regla.

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

**Estado:** 🔴 Abierta

**Contexto.** Casos reales: la esposa que administra el crédito, un hijo, el contador de la
empresa. El OTP no distingue: si tiene el teléfono del titular, entra.

**Preguntas.**
1. ¿Se acepta que un tercero con acceso al teléfono registrado consulte? (hoy, de facto, sí)
2. ¿Se permite registrar **autorizados** por crédito, con su propio teléfono?
3. ¿Hay gestiones que **siempre** requieren al titular, aun con OTP válido?

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

**Estado:** 🟡 Propuesta

**Opciones.** WhatsApp (mismo hilo), SMS (existe `packages/sms`), o ambos según el caso.

**Recomendación de IT:** WhatsApp al teléfono elegido. Si ese teléfono no tiene WhatsApp,
caer a SMS. Un código que llega al **mismo chat** donde escribe alguien que no es el
titular no valida nada: el envío debe ir al teléfono **registrado**, no al del chat.

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
