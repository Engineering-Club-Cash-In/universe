# 16 · Workspace de cobros: backend pendiente

El **Workspace** («Espacio de trabajo») es el modal de dos paneles que se abre al hacer clic en un caso del Dashboard del asesor o de Mi Cartera. Sirve para gestionar los casos uno tras otro sin salir de la tabla.
- **A la izquierda:** el contexto del caso, que es la Ficha 360 reducida.
- **A la derecha:** todas las gestiones, como un flujo dentro del mismo panel.

Se diseñó a partir del Figma «CRM Ventas»:
- 🟣 Asesor Junior › 03 · Workspace v3 (`2866:17459`).
- 🟢 Asesor Senior › 03 · Workspace v3 (`3126:12`).
- 🚗 Asesor Especial › 03 · Workspace v3 (`3785:7976`).
- 🟠 Supervisor › 06 · Workspace B3 (`2338:4147`).

El front ya está **conectado**: lo que el Figma pide y el sistema todavía no tiene se muestra deshabilitado con «Pronto», o se envía al server y el server lo ignora por ahora.

**Para cerrar una tarea:**
1. Implementar lo que dice el `TODO(José) · tarea Wn` correspondiente.
2. Correr `bunx tsc -b` en el server.

## Tareas

| Tarea | Qué hace falta | Dónde se ve |
| --- | --- | --- |
| **W1** | Guardar en `contactos_cobros` los datos de la gestión que el Workspace ya envía a `createContactoCobros` y que hoy se aceptan y se descartan (ver el detalle debajo de la tabla). El schema ya los valida; falta la migración y guardarlos en el insert y el update (`TODO(José) · tarea W1` en `routers/cobros.ts`). Después, mostrarlos en el historial: «Llamada entrante», «Habló con: Carlos Morales (codeudor)». | Workspace › Llamada, Mensaje, Llamada entrante y WhatsApp entrante. |
| **W2** | **Solicitud de rebaja de mora** con aprobación del supervisor: la crea el asesor (monto de mora acumulada y notas), el supervisor la aprueba o la rechaza, y queda en la bitácora. No existe nada parecido en el sistema; `routes/cobros/reduccion.tsx` es otra cosa (reducción de recordatorios Premora). | Workspace › Otras gestiones › «Solicitar rebaja de mora» y, dentro de la llamada, Acuerdo › «Solicitar rebaja de mora». Hoy dice «Pronto». |
| **W3** | **Escalar a Jurídico de forma manual:** se registra un motivo (no contacto, no quiere pagar o sin acuerdo) y una nota para Jurídico, y el caso sale de la cartera del asesor. Hoy B5 solo se alcanza por el motor. Hay que definir con producto si se pasa directo o requiere aprobación. | Workspace › Otras gestiones › «Escalar a Jurídico» (B3–B4). Hoy dice «Pronto». |
| **W4** | **Abono inicial con comprobante dentro del convenio** (el «Convenio flexible» del Figma): si el cliente abonó ese día, el convenio financia solo el resto. Hoy `crearConvenioDesdeFicha` no recibe un abono; el abono se registra aparte con «Registrar comprobante de pago». | Workspace › Convenio de pago. |
| **W5** | **Alertas del caso leídas.** El asesor marca una alerta como leída y sale de la lista principal, pero queda en un apartado «Alertas leídas» del caso. Hoy `getAlertasCaso` agrupa por tipo las filas de `notifications` (los jobs repiten la misma alerta cada día y hay una fila por destinatario), así que «marcar como leída» debe cerrar **todo el grupo de ese tipo para ese usuario** y no solo una fila; si el job vuelve a generar la alerta después, debe reaparecer. Se necesitan tres cosas: una mutación para marcar el grupo como leído, una consulta de las leídas (con fecha y quién la leyó) y un **job diario que marque como leídas las alertas de más de 30 días**, registrado en el catálogo de jobs. | Workspace › Contexto del caso › Resumen (alertas) y Ficha 360 › Resumen › Alertas del caso: «Marcar como leída» en cada alerta y «Ver alertas leídas». |

Datos de W1:
- `direccion`: saliente o entrante.
- `participante`: titular, codeudor o referencia, con el nombre.
- `telefonoContactado`.
- `horaProximoContacto`: HH:MM.
- `medioProximoContacto`: llamada o WhatsApp.

**Relacionadas, del issue de la Ficha 360 (#1864):**
- **F2 · Codeudores:** cuando lleguen, el Workspace los ofrece en «¿Con quién está hablando?» y en «¿A quién le escribimos?».
- **F7 · Asistente IA:** pestaña Asistente IA del panel izquierdo.

## Referencias

- Front y decisiones: [14-rediseno-dashboard-asesor.md](./14-rediseno-dashboard-asesor.md#etapa-3--workspace).
- Piezas del Workspace: `apps/crm/apps/web/src/components/cobros/workspace/`. Se ven con datos de ejemplo en `/design-system?only=cobros-workspace`.
