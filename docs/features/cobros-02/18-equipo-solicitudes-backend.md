# 18 · Mi equipo y Solicitudes: backend pendiente

La fase 2 del rediseño del supervisor junta nueve páginas en tres pantallas del Figma «CRM Ventas» › Supervisor:

| Pantalla | Ruta | Qué reúne |
| --- | --- | --- |
| **Mi equipo** (`2028:13`) | `/cobros/equipo` | Pestaña **Asesores**: tarjetas por asesor. Pestaña **Día**: Apertura, Cierre y Gestiones del equipo. Pestaña **Carga y asignación**: carga de cuentas, traslado masivo, coberturas e historiales. |
| **Detalle del asesor** (`2082:13`) | `/cobros/equipo/:asesorId` | Resumen, Agenda (cumplimiento día por día), Actividad (historial de gestiones del asesor) y Solicitudes que envió. |
| **Solicitudes** (`3310:12` y `3602:5360`) | `/cobros/solicitudes` | Bandeja única de aprobaciones (convenios, apagados, reactivaciones y recuperaciones del vehículo), Historial de decisiones y el Espacio de aprobación (modal de dos paneles). |

Las páginas viejas (`/cobros/apertura`, `cierre`, `carga`, `reasignaciones`, `historial-agendas`, `inmovilizaciones` y `recuperaciones`) salieron del menú y redirigen a su pestaña. `/cobros/convenios` sigue como catálogo.

Supervisión y administración ven lo mismo: el supervisor es el «admin de cobros». Todo endpoint nuevo tiene que dejar pasar a los dos roles (`cobrosSupervisorProcedure`).

El front ya está **conectado**:
- Lo que el Figma pide y todavía no existe se muestra con «—» o con «Pronto».
- Cada punto tiene en el código su `TODO(José) · tarea Mn`.
- En esta fase **no hay stub en el server**. Hay que crear el procedimiento y cambiar el «—» por el dato en el lugar que marca el TODO.

Para encontrarlos: `grep -rn "TODO(José) · tarea M" apps/crm/apps/web/src`

> Todo en DEV: COBROS-02 no va a PROD hasta el pase masivo (ver el [README](./README.md)). Si una tarea necesita migración, se corre en DEV y se anota aquí.

## Tareas

| Tarea | Qué hace falta | Dónde se ve |
| --- | --- | --- |
| **M1** | **Recuperación y resultado de cartera por asesor**, con su meta en Q y su %. Es la versión por asesor de S3/S4 (doc 17); conviene resolverlas juntas. | Mi equipo › Asesores: «Recuperación» de cada tarjeta (`equipo/asesores-vista.tsx`). Detalle › Resumen: KPI «Resultado de cartera» con la variación contra el período anterior (`equipo/detalle/resumen-asesor.tsx`). |
| **M2** | **Créditos próximos a subir de bucket** por asesor: definir el criterio (por ejemplo, la cuota vence en N días y el crédito pasaría al bucket siguiente) y devolver el conteo y la lista. | Detalle › Resumen › Casos críticos: «próximos a subir de bucket» (`equipo/detalle/detalle-asesor.tsx`). |
| **M3** | **Bitácora unificada y paginada de decisiones del supervisor.** Hoy el Historial de Solicitudes junta en el navegador seis fuentes con topes distintos y lo avisa como parcial. Hace falta:<br>- un endpoint paginado con filtros por tipo, decisión, asesor y fecha;<br>- el historial global de decisiones de convenios (`getDecisionesConvenio`, paginado);<br>- el id del solicitante en `getColaInmovilizaciones`, `getHistorialInmovilizaciones` y `getSolicitudesRecuperacion`, porque hoy «Solicitudes del asesor» los asocia por nombre;<br>- filtros por estado y fecha en `getHistorialInmovilizaciones`;<br>- paginación en el historial de recuperaciones (hoy tiene un tope de 100);<br>- que los tres `decidir*` acepten una nota del supervisor al aprobar (hoy solo se guarda el motivo del rechazo);<br>- el registro de casos escalados por asesor. | Solicitudes › Historial (`solicitudes/historial.ts`). Detalle › Solicitudes (`solicitudes/solicitudes-de-asesor.tsx`). «Notas del supervisor» del Espacio de aprobación (`solicitudes/espacio-aprobacion.tsx`). Chip «Escaladas» de Detalle › Actividad (`historial/categorias.ts`). |
| **M4** | **Contrapropuesta de convenio.** El supervisor edita el plan propuesto (cuotas, cuota mensual, primer pago) y lo devuelve al asesor. Además, que cartera-back devuelva las cuotas y la fecha del primer pago del convenio **pendiente**, porque hoy solo las da para convenios activos. | Espacio de aprobación · Convenio: «Editar y contraproponer» y el plan propuesto (`solicitudes/espacio-aprobacion.tsx`). |
| **M5** | **Ausencia indefinida**, como en el Figma (modales «Marcar ausente», «Redistribución» y «Asesor reactivado»): motivo «Incidente», hora de inicio, fin abierto («se reactiva cuando regrese»), reparto temporal de su cartera entre el equipo según capacidad y reactivación que la devuelve con aviso automático al equipo. Hoy la cobertura es con suplente fijo y fechas cerradas (Vacaciones o Permiso). | Mi equipo › «Marcar ausente» (`equipo/asignacion/marcar-ausente.tsx`). «Reactivar» en la tarjeta del asesor ausente (`equipo/reactivar-dialogs.tsx`). |
| **M6** | **Nivel del asesor** (Junior, Senior o Especial) como dato real. Hoy el front lo deriva de los buckets con el criterio del negocio: B0–B1 Junior, B2–B4 Senior y B5 Especial (lo ve gerencia). `nivelPorBuckets` del server dice «senior = B2 en adelante» y no tiene Especial, así que hay que alinearlo a ese criterio. | Chips y tarjetas de Mi equipo, y encabezado del Detalle (`equipo/estado-asesor.ts`). |
| **M7** | **Contactabilidad en lote por asesor.** Hoy las tarjetas de Mi equipo hacen una llamada a `getHistorialAgendasResumen` por asesor, en paralelo y con caché de 5 minutos. Un endpoint que devuelva efectivos y total por `userId` en un rango la reemplaza con una sola llamada. | Mi equipo › Asesores: contactabilidad y estado «Requiere atención» de cada tarjeta. |

Las **rebajas de mora** y los **documentos por autorizar** de la bandeja de Solicitudes (chips en «Pronto») ya son tareas W2 (#1873) y F6.

## De dónde sale cada bloque

| Bloque | Fuente | Estado |
| --- | --- | --- |
| Tarjetas de asesores | `getAsesoresTraslados` (catálogo), `getCargaPorAsesorBucket` (créditos y buckets), `getCumplimientoAgendaResumen` (gestiones cumplidas), `getHistorialAgendasResumen` por asesor (contactabilidad, rol `cobros`), `listarCoberturas` (ausentes) | Real. Recuperación: M1. Nivel: M6 |
| «Requiere atención» | Cumplimiento de agenda del último cierre por debajo del 80 % o contactabilidad de 7 días por debajo del 75 % (`equipo/estado-asesor.ts`) | Real (criterio del front) |
| Día › Apertura y Cierre | `getAperturaDia`, `getCierreDiarioPorRango` y `getDetalleCierrePorAsesor` | Real, igual que las páginas viejas |
| Día › Gestiones | `HistorialGestiones` (`getHistorialAgendas`, resumen y exportación XLSX) | Real |
| Carga y asignación | `getCargaPorAsesorBucket`, `actualizarCapacidadAsesorBucket` (solo admin), traslado masivo (`previsualizarTraslado` y `confirmarTraslado`), coberturas (`crearCobertura`, `cancelarCobertura` y `listarCoberturas`), `getHistorialReasignaciones` y `listarTraslados` | Real. Ausencia indefinida: M5 |
| Detalle › Agenda | `getCumplimientoAgendaResumen` y `getCumplimientoAgendaDetalle` con el asesor fijo, más las gestiones del día | Real |
| Detalle › Actividad | `HistorialGestiones` con el asesor fijo, más los cambios de bucket de `getDetalleCierrePorAsesor` | Real. Escaladas: M3 |
| Solicitudes › Pendientes | `getConveniosListado({estado:"pending"})`, `getColaInmovilizaciones` (`pendiente_aprobacion`; las `aprobada` van a «Por ejecutar») y `getSolicitudesRecuperacion().pendientes` | Real |
| Espacio de aprobación | Panel de contexto del Workspace en solo lectura, más `decidirConvenio` (con idempotencia), `decidirInmovilizacion` y `decidirSolicitudRecuperacion` (regla de cuatro ojos) | Real. Contrapropuesta: M4. Nota al aprobar: M3 |
| Solicitudes › Historial | Inmovilizaciones, recuperaciones, reasignaciones, traslados y coberturas, unidos en el navegador | Parcial: M3 |

## Referencias

- Piezas: `apps/crm/apps/web/src/components/cobros/equipo/` (Mi equipo y `detalle/`), `components/cobros/historial/` y `components/cobros/solicitudes/`.
- Showcases con datos de ejemplo: `/design-system?only=cobros-mi-equipo`, `?only=cobros-detalle-asesor` y `?only=cobros-solicitudes`.
- Tareas de la fase 1 del supervisor: [17](./17-supervision-backend.md) (S1–S6).
