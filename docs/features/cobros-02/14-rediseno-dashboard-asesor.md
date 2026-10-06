# 14 · Rediseño del asesor: Dashboard y Mi Cartera (front)

Esta es la etapa 1 del rediseño de las pantallas del asesor con el Figma «CRM Ventas» (páginas **🟣 01 · Asesor Junior** y **🟢 02 · Asesor Senior**).

- **PR:** #1861, mergeado en `COBROS-02` el 2026-10-06.
- **Backend pendiente:** issue #1862 (José) y [13-dashboard-asesor-backend.md](./13-dashboard-asesor-backend.md).
- **Design system** (tokens y componentes): [`docs/design-system/`](../../design-system/README.md), PR #1848.

## Reglas que fijó producto

- **Figma dice la verdad.** No se quita nada de Figma ni de lo que ya existía sin aprobación. Sí se puede **agregar** lo que Figma no tiene para no perder funcionalidad. Por ejemplo, contadores de Mi día que no estaban en la agenda de Figma o columnas opcionales.
- **Junior y senior no son roles del CRM, son buckets.** Junior trabaja B0–B1 y senior B2–B4. Es la misma pantalla y la arma el pool del asesor en cartera, que devuelve `getMiPerfilCobros()` con `buckets` y `nivel`.
- **El front y los cambios chicos del server del CRM los hacemos en el equipo; lo pesado de backend es de José.** Queda conectado: stubs que devuelven `null`, marcados con `TODO(José) · tarea Bn`, y en pantalla se ve "—" o "pronto".
- **Clic en una fila → Ficha 360**, como en Figma. La gestión rápida quedó en el menú ⋯ como "Vista rápida". Las interacciones del Workspace de Figma son la etapa 2.
- **Textos de cobros con trato de usted**, según la [guía de redacción](./12-guia-de-redaccion.md). Figma tutea y aquí se corrige.

## Qué quedó

| Ruta | Quién | Qué |
| --- | --- | --- |
| `/cobros` | Rol `cobros` | **Dashboard del asesor**: une el Dashboard anterior con "Mi día" (detalle abajo). |
| `/cobros` | Supervisor y admin | El dashboard anterior, sin cambios (`DashboardSupervision` en `routes/cobros/index.tsx`). |
| `/cobros/cartera` | Todos los de cobros | **Mi Cartera**. Supervisión ve toda la cartera, con la columna Asesor. |
| `/cobros/mi-dia` | — | Redirige: el asesor va a `/cobros` y supervisión a `/cobros/cola`. |

**Dashboard del asesor**, en el orden de Figma:
1. **Agenda de hoy:**
   - Barra "X de Y tareas realizadas hoy" (`getMiAgendaHoy`).
   - Los 6 contadores de Figma: llamadas pendientes, promesas que vencen hoy, promesas vencidas, pagos por confirmar (pronto), sin intento de contacto y referencias por contactar (pronto).
   - Los contadores de Mi día que Figma no tenía: SLA hoy, cuota vence hoy, promesas próximas y sin intento hoy.
   - Cada contador filtra la tabla.
   - Al expandir la agenda: próximos 5 días y seguimientos programados.
2. **Mi desempeño** (Día / Semana / Mes, `getMiDesempeno`):
   - Recuperación: "—" hasta las tareas B2 y B3.
   - Promesas cumplidas, contactabilidad y movimiento (↓↑).
   - Mora de mi cartera.
   - Metas de mora del mes.
3. **Casos que requieren atención hoy:** la cola priorizada (`getColaDia`), completada con `getTodosLosCreditos({numerosSifco})` para tener las columnas de Figma.
4. **Distribución de mi cartera:** solo los buckets del pool del asesor. Clic → Mi Cartera filtrada.
5. **Pendientes de apagado/reactivación**, arriba de la agenda.

**Mi Cartera:**
- Encabezado operativo: asignados, requieren atención hoy y % al día.
- Chips de bucket del asesor.
- Búsqueda por cliente, crédito, placa o DPI.
- Chips de gestión de Figma.
- Todos los filtros de la tabla anterior, persistidos en sessionStorage `cobros/cartera/*`. El filtro de etapa muestra solo los buckets del asesor más los estados que no son bucket.
- Columnas opcionales, ordenar (solo la página actual hasta la tarea B5) y paginación de 25 a 200.
- WhatsApp masivo: **bloqueado** si hay un chip de gestión o un rango de capital, porque el envío no los aplica. Va de salida.

**Menú del asesor:** Dashboard, Mi Cartera, Supervisión Págalo y Buró interno. Promesas, Convenios, Alertas de convenios e Historial de agendas quedaron solo para supervisión; las rutas siguen vivas.

## Cómo está armado

| Pieza | Dónde |
| --- | --- |
| Fila compartida (Cartera/FilaCrédito + acciones, selector de columnas, traducción dato → badge) | `apps/crm/apps/web/src/components/cobros/asesor/fila-cartera.tsx` |
| Dashboard: contenedor (queries) y presentación | `components/cobros/asesor/dashboard-asesor.tsx`, `dashboard-asesor-vista.tsx`, `agenda-hoy.tsx`, `mi-desempeno.tsx`, `casos-atencion.tsx`, `dashboard-distribucion.tsx` |
| Mi Cartera: contenedor, presentación y filtros | `components/cobros/asesor/mi-cartera.tsx`, `mi-cartera-vista.tsx`, `filtros-cartera.tsx`, `routes/cobros/cartera.tsx` |
| Tabla de Figma (columnas visibles y celdas `extras`) | `components/ds/tabla-cartera.tsx` |
| Seguimiento, estado de gestión y acción pendiente (lógica pura + tests) | `apps/crm/apps/server/src/lib/seguimiento-cobros.ts` |
| Rangos Día/Semana/Mes (lógica pura + tests) | `apps/crm/apps/server/src/lib/desempeno-asesor.ts` |
| Procedimientos del asesor | `apps/crm/apps/server/src/routers/cobros-asesor.ts` |

**Presentación separada de datos.** Cada pantalla tiene un contenedor con las queries y componentes que solo reciben props. Por eso se pueden ver con datos de ejemplo en `/design-system?only=cobros-dashboard-asesor` y `?only=cobros-mi-cartera`, sin sesión ni server. Así se revisa contra Figma, en claro y oscuro.

**Server del CRM:**
- **Alcance por sesión:** el asesor solo ve su cartera en `getTodosLosCreditos`, `getDashboardStats` y `getResumenPromesas`. Antes confiaban en el `emailCobrador` del front.
- **`getColaDia`:** devuelve seguimiento por ítem, más `conteosExtra` y `filtroExtra`. No cambia qué entra a la cola ni su orden, porque supervisión usa la misma.

## Pendientes y trampas conocidas

- **Arreglo que no alcanzó a entrar en #1861 y va en la etapa 2:** `calcularDistribucion` (en `dashboard-asesor.tsx`) mostraba cualquier bucket con créditos, y un senior B2/B3 veía "B0". Ya está corregido para mostrar solo los buckets del pool.
- **`/stats` y el filtro `estadoMora` agrupan por cuotas atrasadas, no por el bucket del motor.** Un crédito del pool B2/B3 sin cuotas atrasadas cae en "al día": cuenta en el total (247) pero en ningún bucket (227). Se arregla con la tarea B5.
- **La cola no trae B0** porque no tiene SLA: un junior no ve sus B0 en "atención hoy", aunque sí en Mi Cartera. Es decisión de negocio, tarea B10.
- **"Deuda vencida" es aproximada** (cuotas vencidas × cuota + mora) hasta la tarea B4.

## Etapa 2 · Ficha 360

**Estado:** PR #1863 → `COBROS-02`. El backend pendiente está en el issue #1864 (José) y en [15-ficha-360-backend.md](./15-ficha-360-backend.md), tareas F1–F8.

**Figma:** página Asesor Junior `271:877`, sección **🟦 04 · Consulta · Ficha 360 · Ubicaciones** (`1887:4118`). La ficha es la misma para todos los créditos y roles.

**Cómo se unificó** (nada se quitó; lo que Figma no tiene se reubicó):

| Antes | Ahora |
| --- | --- |
| Encabezado propio con avatar, badges y datos | `HeaderCredito` de Figma: asesor, saldo, fecha de pago, días en mora y última actualización. Se le sumaron capital activo, cuotas restantes y vehículo (`datosExtra`). Las acciones de gestión siguen ahí: contacto, promesa o convenio, visita, recuperación o deshacer convenio, más acciones y registrar pago. |
| Pestañas: Resumen, Historial, Estado de cuenta, Vehículo / GPS, Referencias | Las de Figma más **Ubicaciones** (decisión de producto: en Figma es una tarjeta del Resumen; aquí es pestaña): Resumen, Historial, Estado de cuenta, Ubicaciones, **Documentos**, Referencias y **Asistente IA**. Ubicaciones tiene «Ubicaciones verificadas» y «Ubicación del vehículo»; ahí quedó todo lo de **Vehículo / GPS** (tarjeta del vehículo, GPS, inmovilización y recuperación). El aviso de inmovilización, el deep link `?seccion=inmovilizacion` y el punto pendiente llevan ahí. |
| «Información del caso» con montos y franjas «Total a cobrar» | «Estado del cobro»: días en mora, cuotas vencidas y pagadas, último mes pagado, fecha de pago, cuota mensual, mora pagada o condonada y etiquetas. Además, «Cobro de hoy» (`CardCobro`) con las mismas cuentas de antes y el aviso de cuánto sube la mora. |
| «Próximo contacto» en su propia tarjeta | Franja de Figma: contactabilidad, días sin gestión, intentos sin contacto y próximo contacto (`getSeguimientoFicha`). Se registra desde «Registrar Contacto» del encabezado (el botón grande «Registrar gestión» de Figma se quitó por decisión de producto, 2026-10-06). |
| Tarjeta «Información de contacto» en el Resumen | Tarjeta «Contacto» del Resumen con los datos a la vista (teléfonos, correo, residencia, trabajo, números nuevos y referencias) y el botón al módulo «Contacto» (titular y codeudores) y «Editar» (datos RENAP, teléfonos con autoguardado, correo, direcciones). «Más números para localizarlo» quedó en Contacto. |
| Historial de contactos en tarjetas | Historial › «Historial actual»: cada sección (historial del crédito, links de pago, promesas, recordatorios, bot) en su tarjeta con ícono, título y contador, y adentro la misma línea de tiempo con nota plegable. Referencias usa el mismo formato. «Histórico» (F4) muestra además las decisiones del convenio. |
| Historial de cuotas | Estado de cuenta: «Enviar por WhatsApp», «Resumen de cuenta» y «Plan de pagos» (de la cuota más reciente a la más vieja, con el detalle de pagos y el desglose plegados). Contrato y convenio quedan a la derecha. |
| — | Seguro en una tarjeta del Resumen (Figma), con la póliza que antes estaba en la pestaña Vehículo. |

**Código:**
- Presentación: `apps/crm/apps/web/src/components/cobros/ficha/` (`ficha-resumen`, `ficha-modulos`, `ficha-pestanas`), con la vista de ejemplo `/design-system?only=cobros-ficha-360`.
- Ruta: `routes/cobros/$id.tsx`. La lógica, las consultas y los modales no cambiaron.

**Pendiente:** Workspace v3 (`2866:17459`) y la página del senior (`1644:79`).
