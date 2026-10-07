# 17 · Supervisión de cobros: backend pendiente

La fase 1 del rediseño del supervisor trae dos pantallas del Figma «CRM Ventas» › Supervisor:
- **Dashboard · Supervisor** (`1954:14`): la portada de `/cobros` para supervisión y administración.
- **Cartera general** (`2262:12`): `/cobros/cartera` con toda la cartera del equipo.

Supervisión y administración ven lo mismo: el supervisor es el «admin de cobros». Todos los procedimientos que usa el Dashboard dejan pasar a ambos roles (`cobrosSupervisorProcedure` o `cobrosProcedure`).

El front ya está **conectado**. Lo que el Figma pide y el sistema todavía no tiene se muestra con «—» o con la marca «Pronto», y lee del stub `getSupervisionComplementos` (`apps/crm/apps/server/src/routers/supervision-cobros.ts`), que hoy devuelve `null` en cada campo.

**Para cerrar una tarea:**
1. Implementar lo que dice el `TODO(José) · tarea Sn` correspondiente, sin cambiar el contrato (las interfaces del archivo).
2. Correr `bunx tsc -b` en el server.

El router vive en su propio archivo, montado en `src/index.ts` y tipado en el web por `orpcAparte` (`web/src/utils/orpc.ts`). No va en `routers/index.ts`: `cobrosAppRouter` está en el límite donde TS7056 trunca el tipo en silencio (ver la nota de `routers/bucket-capacidad.ts`).

## Tareas

| Tarea | Qué hace falta | Dónde se ve |
| --- | --- | --- |
| **S1** | **Pendientes sin fuente** (campo `pendientes`): documentos por autorizar (se apoya en F6), rebajas de mora por revisar (W2), créditos listos para pasar a Prejurídico (definir el criterio con producto y escribir la consulta) y las aprobaciones que el supervisor resolvió hoy (convenios, recuperaciones, apagados y, cuando existan, rebajas y documentos). | Dashboard › «Sus pendientes de hoy»: los ítems con «Pronto» y la barra «x de y aprobaciones resueltas hoy». Las rebajas y los documentos también deben entrar a la lista de «Aprobaciones pendientes» (chips «Rebaja» y «Documentos», ya contemplados en el front). |
| **S2** | **«Sin contacto > 3 días» del equipo** (campo `sinContacto3Dias`): un conteo consultable. Antes hay que unificar los umbrales de «sin contacto», que hoy son tres: 3 días hábiles en la alerta, más de 5 días en la cola del día (`UMBRAL_DIAS_SIN_CONTACTO` en `lib/cola-dia.ts`) y 48 h en la cartera. | Dashboard › «Sus pendientes de hoy». Mientras sea `null`, el front muestra el conteo `sin_contacto` de `getColaDia` con la etiqueta «Sin contacto > 5 días (equipo)». El enlace va a `/cobros/cartera?cola=sin_contacto`. |
| **S3** | **KPIs del equipo por período** (campo `kpis`, con `periodo` = día, semana o mes, mismos rangos que `rangosDesempeno`): recuperación del equipo con su meta en Q (la versión de equipo de B2/B3 del doc 13), cuentas curadas (definir: sin mora y siguen en su bucket) y promesas cumplidas del equipo con el monto incumplido. | Dashboard › «Desempeño del equipo»: tarjetas Recuperación del equipo, Cuentas curadas y Promesas cumplidas. La contactabilidad y su variación contra el período anterior **ya son reales**: el front llama dos veces a `getHistorialAgendasResumen` (período actual y anterior), así que no hace falta en el backend. |
| **S4** | **Tabla de equipo** (campo `equipo`, una fila por `asesor_id` de cartera): contactos de hoy en vivo (el cierre diario recién llega a las 22:00), meta del asesor en % (definir sobre qué) y «rescate» en % (definirlo). | Dashboard › «Equipo»: columnas Contactos hoy, Meta y Rescate. Cuando llegue «rescate», el punto de estado de cada fila pasa a calcularse con él (hoy usa el cumplimiento de agenda del último cierre). |
| **S5** | **Filtros de la Cartera general en `getTodosLosCreditos`**, con paginación real en el server: `asesorId` (asesor_id de cartera), la categoría de la cola del día (`sla_hoy`, `promesa_hoy`, `vence_hoy`, `incumplida`, `promesa_proxima`, `sin_contacto`, `llamada_hoy`, `sin_intento_hoy`), las categorías de alertas de promesa (`vencida`, `vence_hoy`, `por_vencer`, `programada`) y de convenio (`vencida`, `vence_hoy`, `por_vencer`, `proxima`), y «sin acuerdo». Hoy esas categorías salen de `getColaDia`, `getAlertasPromesas` y `getAlertasConvenios`, y la cartera completa sus columnas con `getTodosLosCreditos({numerosSifco})`, que tiene un tope de 200 SIFCO por llamada. | Cartera general: parámetros `?asesor=`, `?cola=`, `?promesa=`, `?convenio=` y `?gestion=sin_acuerdo`. El Dashboard enlaza con ellos (filas de Equipo, «Sin contacto», promesas). |
| **S6** | **Reasignación en bloque transaccional:** un endpoint que reciba varios créditos y el asesor destino (más el motivo) y los reasigne en una sola transacción, validando el pool de cada bucket como `reasignarAsesorCredito`. Hoy se hace con un `reasignarAsesorCredito` por crédito, así que un fallo a la mitad deja la reasignación incompleta. | Cartera general › «⇄ Reasignar en bloque». |

S5 y S6 los consume la Cartera general.

**Detalle de S5, según cómo quedó hoy la Cartera general** (`components/cobros/cartera-general/use-cartera-general.ts`):
- Sin un filtro de la cola o de alertas, `getTodosLosCreditos` pagina y filtra en el server; el asesor se filtra con `emailCobrador` = `email_cash_in`.
- Con uno de esos filtros, la fuente (`getColaDia`, `getAlertasPromesas` o `getAlertasConvenios`) da los SIFCO y `getTodosLosCreditos({numerosSifco})` completa las filas. Hasta 200 SIFCO el total y la paginación son exactos (se pagina en el cliente). Con más, los demás filtros se aplican solo a la página visible y la pantalla lo avisa.
- Hace falta una segunda llamada con `estadoMora: "en_convenio"`, porque sin etapa `getTodosLosCreditos` trae solo créditos ACTIVO.
- «Sin acuerdo» se filtra sobre la página visible, con aviso.
- `getAlertasPromesas` no devuelve `asesor_id`: el filtro por asesor compara nombres. Agregar `asesor_id` a la respuesta.
- El WhatsApp masivo no acepta asesor ni categoría, así que se bloquea con un tooltip cuando hay alguno de esos filtros. Agregar `asesorId` (o `emailCobrador`) y la categoría a su filtro.
- La Cola del día vieja filtraba varios buckets a la vez; la cartera elige uno por chip. Si producto lo pide, que `getTodosLosCreditos` acepte una lista de buckets.

## Antes de desplegar

- **Migración 0039 del CRM** (`0039_estado_contacto_mensaje_enviado.sql`) en PROD. Sin el valor `mensaje_enviado` en el enum `estado_contacto`, `getHistorialAgendasResumen` da 500: se rompe la contactabilidad del Dashboard y la página Historial de agendas. En DEV se corrió el 2026-10-07.

## De dónde sale cada bloque del Dashboard

| Bloque | Fuente | Estado |
| --- | --- | --- |
| Aprobaciones pendientes | `getConveniosListado({estado:"pending"})`, `getSolicitudesRecuperacion().pendientes` y `getColaInmovilizaciones()` con estado `pendiente_aprobacion` | Real. Documentos y rebajas: S1 |
| Asesores ausentes | `listarCoberturas({desde:hoy, hasta:hoy})`, sin las canceladas | Real |
| Tareas B3 | `getMisTareasCobros` (componente `MisTareasB3`, que salió de la Cola del día) | Real. Las tareas se asignan a supervisores, así que un admin ve la lista vacía |
| Contactabilidad del equipo | `getHistorialAgendasResumen` del período y del anterior | Real |
| Migración de bucket | `getCierreDiarioPorRango`: suma de `bajaron` y `subieron` | Real. El día en curso se suma después del cierre de las 22:00 |
| Links de pago | `getPagaloSupervision`: pendientes = `conteoPorEstado` de LINKS_PENDING, PENDING_PAYMENT y PARTIALLY_PAID; vencidos = `total` con `problemasLink:["EXPIRED"]` | Real |
| Cartera del equipo por bucket | `getCargaPorAsesorBucket().buckets[].cuentas_totales` | Real |
| Equipo | `getAsesoresTraslados` (pool activo con buckets), casos de `getCargaPorAsesorBucket().porAsesor`, agenda de `getCumplimientoAgendaResumen` (último día cerrado) | Real. Contactos hoy, meta y rescate: S4 |
| Recuperación, cuentas curadas, promesas cumplidas | `getSupervisionComplementos` | S3 |

## Referencias

- Piezas del Dashboard: `apps/crm/apps/web/src/components/cobros/supervision/`. Se ven con datos de ejemplo en `/design-system?only=cobros-dashboard-supervisor`, también en el estado «con el backend de José completo».
- Contenedor: `components/cobros/supervision/dashboard-supervisor.tsx`.
- Cartera general: `components/cobros/cartera-general/` (segmentos, consultas, reasignación en bloque y redirecciones de las páginas viejas). Showcase: `/design-system?only=cobros-cartera-general`.
- Modelo de las tareas de backend anteriores: [13](./13-dashboard-asesor-backend.md), [15](./15-ficha-360-backend.md) y [16](./16-workspace-backend.md).
