# 10 · Visitas a residencia y al lugar de trabajo (CB-037 / CB-038)

**Estado:** ✅ Implementado · migración CRM `0069` corrida en DEV, pendiente en prod (sale a fin de año)
**Jira:** CC2-73 (CB-037, residencia) · CC2-74 (CB-038, lugar de trabajo)

---

## Qué es

En B3 y B4 el asesor sale a buscar al cliente: a su casa o a su trabajo. Antes eso se
registraba como "Visita" dentro de **Registrar Contacto**, con el formulario genérico de
contacto, sin dirección, responsable ni fotos. Ahora la visita es una **tarea** con su
propio botón:

| Estado | Qué pasó | Qué se pide |
| --- | --- | --- |
| **Programada** | Alguien la agenda | Dirección, responsable, fecha y hora, notas |
| **Realizada** | Se fue (programada o no) | + resultado, fotos, comentarios y próximo paso (texto) |
| **Cancelada** | La programada no se hizo | Motivo |

Una visita se puede **programar** (y después registrarle el resultado) o **registrar
directo**, ya hecha. En el formulario se elige con "Ya fui" / "Programarla".

## Dónde está en la Ficha 360

- **Botón "Registrar visita ▾"** en la fila de acciones, con dos opciones:
  **Visita a residencia** y **Visita al lugar de trabajo**. Solo en **B3 y B4**
  (decisión del 2026-09-29). Fuera de esos buckets se ve deshabilitado con el motivo.
- **Tarjeta "Visitas"** en la pestaña Resumen. Arriba van las programadas, con
  "Registrar resultado" y "Cancelar visita". Abajo van las realizadas: qué pasó, quién
  fue, las fotos y lo que falta.
- **Tarjeta "Información de Contacto"**: "Dirección" pasó a llamarse **Residencia**, y
  hay un bloque nuevo, **Trabajo**, con empresa, puesto, dirección, teléfono y horario.
  Sale de la Solicitud de Crédito del titular (`credit_applications`), que es lo único
  del monorepo que guarda la dirección del trabajo. Es de solo lectura: es lo que firmó
  el cliente.
- **"Visita" ya no está en Registrar Contacto.** Las visitas viejas (`visita_domicilio`)
  siguen en el historial.

## El resultado sigue por el flujo que ya existe

La visita no duplica nada: registra qué pasó y abre el flujo de siempre.

| Resultado | Gestión en `contactos_cobros` | Qué abre al guardar |
| --- | --- | --- |
| Pago | `contactado` | Nada. El pago se registra con "Registrar Pago" (link o boleta); la tarjeta muestra esos dos botones |
| Promesa | `contactado` | El modal de **promesa de pago** de siempre (congela en cartera, mide cumplimiento), con el canal de la visita |
| 50% + promesa | `acuerdo_parcial` | Las dos cosas: el monto recibido queda en la visita y se abre la promesa por el resto |
| Entrega voluntaria | `contactado` | El formulario de **entrega voluntaria de CB-042**, con el lugar y la fecha de la visita ya puestos. De B3 traslada a B4; en B4 solo registra ([doc 7](./07-recuperacion-de-vehiculo.md)) |
| Sin contacto | `no_contesta` | Nada. Se pide el motivo: no estaba, ya no vive o trabaja ahí, la dirección no existe, no abrieron, otro |

**El 50%** se calcula sobre la deuda vencida: cuotas vencidas × cuota + mora
(decisión del 2026-09-29, la misma regla Mora+Cuota del modal de promesa). Es una
referencia para el asesor y no bloquea si el cliente paga otro monto. La promesa que se
abre después sugiere lo que falta.

Si el asesor cierra la promesa o la entrega sin terminarla, la visita queda con el aviso
**"Falta registrar la promesa"** o **"Falta registrar la entrega"** y un botón para
retomarla. El vínculo vive en la visita (`promesa_contacto_id`, `recuperacion_id`). El
servidor no deja colgar una promesa o una entrega de una visita de otro caso, o de una
cuyo resultado no la pedía.

## Quién va (responsable)

Sigue la regla de la casa: **la asignación la da cartera**
([doc 2](./02-motor-y-asignacion.md#el-crm-no-asigna-2026-09-28)). Puede ir quien puede
trabajar el crédito:

- el dueño en cartera;
- quien lo cubre hoy;
- un supervisor de cobros.

Un admin solo puede elegirse a sí mismo. A nadie más se le ofrece la visita, porque
asignarla no le daría acceso a la ficha.

El responsable de una visita **programada** vale al registrar el resultado aunque el
motor haya reasignado el crédito entretanto, porque fue él quien salió a visitar. La
gestión queda con `realizado_por` = el responsable, así cuenta en su agenda.

## Avisos

`cobros_notif_tipo = 'visita_programada'`, solo al responsable:

- **al programarla**, si la programó otra persona;
- **la mañana del día** (08:00 GT, con las demás alertas de cobros).

Deduplicado por visita y por día (`visita:<id>:programada`, `visita:<id>:dia:<fecha>`):
el run de boot no duplica. Al registrar o cancelar la visita, sus avisos se marcan
resueltos.

## Fotos (evidencia)

- Hasta **5 fotos** por visita, solo imágenes (JPG, PNG, WebP), de hasta 10 MB.
- Se suben directo a R2 con URL firmada (`cobros_visita_evidencia`, carpeta
  `cobros/visitas/<caso>`). El permiso para subir es el de la ficha.
- Al guardar, el servidor verifica cada foto: que exista, que esté en la carpeta de ESE
  caso, que sea imagen y que no esté ya en otra visita.
- El bucket es privado: la tarjeta las muestra con URL firmada.

## En el celular

El formulario está pensado para llenarse **en el lugar**:

- En pantalla chica ocupa toda la pantalla, con el botón de guardar siempre a la vista.
- **"Tomar foto"** abre la cámara trasera (`capture="environment"`). **"De la galería"**
  permite elegir varias.
- Cada foto se achica en el teléfono antes de subirse (JPEG, lado mayor 1600 px): una
  foto de celular pesa 3-8 MB y se sube con datos móviles.
- **"Guardar mi ubicación"** (opcional, con permiso del navegador) deja la posición del
  celular como respaldo de que la visita ocurrió. La tarjeta la muestra con un enlace a
  Google Maps.
- En B4 se puede abrir, desde el mismo formulario, la tarjeta de **ubicaciones clave del
  GPS** (CB-119), con su motivo auditado. En B3 no se ofrece: esas ubicaciones son solo
  para B4 (D-15).

La fila de acciones de la ficha también se ordenó para el celular. Va en dos columnas
con etiquetas cortas y **Registrar Pago** arriba, a todo el ancho. Antes la fila se
salía de la pantalla.

## Lo que NO lleva (2026-09-29)

Se quitó en el QA lo que no pedía el ticket:

- **Lineamientos de la visita al trabajo.** CB-038 solo dice "validar permisos y
  lineamientos reputacionales/legales" en la definición de listo, como algo a validar,
  no como parte del formulario.
- **Fecha del próximo paso.** El criterio pide "próximo paso", y queda como texto. La
  visita no mueve el próximo contacto del caso.

## Datos: `visitas_cobros` (CRM, migración `0069`)

- `visitas_cobros`: tipo (`residencia` | `trabajo`) y estado con CHECK. `resultado` y
  `motivo_sin_contacto` van en text validado en TypeScript, porque el catálogo es del
  ticket y puede cambiar sin migración.
- `visitas_cobros_evidencias`: una fila por foto (key de R2 única).
- `metodo_contacto` suma **`visita_trabajo`**. La visita a residencia sigue siendo
  `visita_domicilio`.
- `cobros_notif_tipo` suma **`visita_programada`**.

Ni `contactos_cobros` ni `recuperaciones_vehiculo` cambian: los vínculos están en
`visitas_cobros`. Si cartera rechaza el traslado de una entrega y el registro se borra,
el vínculo se limpia solo (`ON DELETE SET NULL`).

## Dónde está el código

| Qué | Dónde |
| --- | --- |
| Reglas (puras, las usa también la web) | `apps/crm/apps/server/src/lib/visitas-cobros.ts` (+ `.test.ts`) |
| Responsable, fotos, vínculos, avisos | `apps/crm/apps/server/src/services/visitas-cobros.ts` |
| Procedures | `apps/crm/apps/server/src/routers/visitas-cobros.ts` |
| Vínculo con la promesa | `createContactoCobros` (`visitaId`) en `routers/cobros.ts` |
| Vínculo con la entrega | `enviarCreditoARecuperacion` / `registrarEntregaVoluntariaEnB4` (`visitaId`) |
| Formulario | `apps/crm/apps/web/src/components/cobros/visita-dialog.tsx` |
| Tarjeta | `apps/crm/apps/web/src/components/cobros/visitas-card.tsx` |
