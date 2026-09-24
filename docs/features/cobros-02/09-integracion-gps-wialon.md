# 9 · Integración GPS / Wialon (La Legión)

**Estado:** 🟢 Implementado en CRM Server · CB-117 (panel admin `/admin/gps`), CB-118 (GPS en Ficha 360) y CB-121 (trazabilidad y manejo de fallas) implementados · pendiente alertas/webhooks (CB-119) y corte remoto (CB-120)  
**⚠️ Migraciones sin aplicar:** `0057_cb118_wialon_unit_link.sql` y `0058_cb121_gps_integracion_logs.sql` están commiteadas pero **no ejecutadas** en ningún ambiente. Mientras la `0057` no se aplique, el vínculo vehículo↔unidad no persiste: la ficha lo deduce por placa en cada consulta y el botón de vincular falla (ver D-10). Mientras la `0058` no se aplique, no hay bitácora técnica ni alertas (CB-121): el escritor falla en silencio (`GPS_INTEGRACION_LOG_FALLIDO`) sin afectar las consultas.  
**Apps que toca:** `apps/crm` (server + web) · Wialon Remote API (`gps.lalegion.gt`)  

---

## Qué es

La integración que conecta el CRM directamente con la plataforma de telemática y rastreo satelital **Wialon** operada por **La Legión** (`gps.lalegion.gt`).

Su propósito principal dentro del flujo de [Recuperación de vehículo (B4)](./07-recuperacion-de-vehiculo.md) y la [Ficha 360](./06-ficha-360.md) es:
1. **Localizar unidades en mora crítica:** Conocer la posición geográfica exacta (latitud, longitud, velocidad) y el estado del motor (encendido o apagado) de las unidades en gestión de cobros o recuperación.
2. **Generar enlaces temporales de seguimiento (Locator):** Crear URLs públicas de rastreo en vivo (`https://gps.lalegion.gt/locator/index.html?t={hash}`) para que el equipo de campo o gestores de recuperación ubiquen el vehículo sin necesidad de tener credenciales de acceso a la plataforma completa.
3. **Lectura directa de telemetría:** Obtener odómetro acumulado (`mileage`) y horas de uso de motor (`engine_hours`) para auditoría física y valuación de garantías.

---

## Cómo funciona

```
┌────────────────────────────── crm (apps/server) ──────────────────────────────┐
│                                                                               │
│   ORPC Router (/rpc/*)                                                        │
│   (Consumo tipado y autenticado con sesión en Ficha 360 y Cobros)             │
│                                │                                              │
│                                ▼                                              │
│                    WialonClient (Singleton)                                  │
│                    ├── Session Cache en memoria (sid / eid, TTL 2h)           │
│                    ├── Self-Healing: re-auth transparente ante error 1 y 7    │
│                    └── Timeout & AbortController (15s)                        │
└──────────────────────────────────┬────────────────────────────────────────────┘
                                   │ POST (application/x-www-form-urlencoded)
                                   ▼
┌────────────────────── Wialon Remote API (La Legión) ─────────────────────────┐
│   https://hst-api.wialon.com/wialon/ajax.html                                 │
│                                                                               │
│   · token/login          → Canje de WIALON_TOKEN por sesión (eid)             │
│   · core/search_items    → Búsqueda de flota y unidades (70+ unidades)        │
│   · unit/calc_last       → Telemetría consolidada (km, horas, ignición)       │
│   · core/search_item     → Detalle y mensajes crudos de sensores (lmsg.p)     │
│   · token/update         → Creación y revocación de links públicos de Locator │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Decisiones tomadas

### D-01 · Autenticación obligatoria mediante token permanente (Personal Access Token)
* **Contexto:** Wialon deprecó el endpoint clásico `core/login` (usuario y contraseña en texto plano en cada inicio) a favor de tokens de acceso (`token/login`).
* **Decisión:** La autenticación se realiza de forma exclusiva y obligatoria mediante **`WIALON_TOKEN`**, generado desde el portal web con `duration=0` (permanente, equivalente a un Personal Access Token de GitHub). No se emplean credenciales de usuario/contraseña en texto plano por motivos de seguridad y deprecación de la API de Wialon.

### D-02 · Caché de sesión en memoria y auto-renovación silenciosa (Self-Healing)
* **Contexto:** Cada consulta a Wialon requiere un `sid` (Session ID). Abrir una sesión nueva en cada petición HTTP degrada el rendimiento y satura los límites de autenticación del proveedor. Por otro lado, si se abre una sesión paralela desde otra herramienta o Wialon rota la sesión, las peticiones fallan con `error: 1` (*Invalid session*).
* **Decisión:** El `WialonClient` cachea el `sid` en memoria por 2 horas. Si cualquier petición recibe código `1`, el cliente **invalida la caché, se re-autentica en silencio y repite la petición original de forma transparente con un reintento único**. Los errores de permisos (código `7`) o parámetros inválidos no se reintentan y se propagan inmediatamente.

### D-03 · Router ORPC desacoplado para evitar el límite de TypeScript (TS7056)
* **Contexto:** En `apps/server`, routers gigantescos como `cobrosAppRouter` han rozado el límite del compilador de TypeScript donde TS7056 trunca silenciosamente los tipos inferidos exportados a `apps/web`.
* **Decisión:** Siguiendo el patrón establecido por `pagaloSupervisionRouter` y `recuperacionVehiculoRouter`, `wialonRouter` vive en su propio archivo (`src/routers/wialon.ts`), se exporta directamente, se monta en `RPCHandler` mediante `Object.assign` y se une a `MergedRouter` en `apps/web/src/utils/orpc.ts`.

### D-04 · Telemetría consolidada (`unit/calc_last`) sobre cálculo manual de sensores
* **Contexto:** Wialon ofrece dos formas de conocer el estado de un vehículo:
  1. `core/search_item`: Devuelve el mensaje crudo (`lmsg.p.io_1`), requiriendo buscar el `monitoring_sensor_id`, leer la tabla de calibración `ci` e inferir si está encendido o apagado.
  2. `unit/calc_last`: Wialon calcula y formatea directamente odómetro, horas de motor, velocidad y estado textual de sensores (`"Encendido"` / `"Apagado"`).
* **Decisión:** Para la operación en Ficha 360 y listados se utiliza prioritariamente `unit/calc_last`. Acepta un arreglo de `unitIds` para resolver múltiples vehículos en un solo viaje de red. `core/search_item` se preserva para diagnósticos avanzados a bajo nivel.

### D-05 · Enlaces temporales de Locator con revocación explícita
* **Contexto:** Compartir la ubicación con gestores de recuperación o grúas debe ser seguro y acotado en el tiempo para no exponer la flota completa ni comprometer la privacidad.
* **Decisión:** Se utiliza la aplicación integrada de Wialon **Locator** (`svc: token/update`). Genera un hash `h` de duración configurable (por defecto 24 horas, con tope máximo estricto de 30 días en el esquema Zod para mitigar riesgos de privacidad). Para cortar el acceso inmediatamente al concretar la recuperación, el cliente implementa `deleteLocatorLink` llamando a `token/update` con `callMode: "delete"`.

### D-06 · Sin costo por petición (modelo de suscripción por unidad)
* **Contexto:** Preocupación operativa sobre si el consumo de la API genera costos incrementales en la factura de La Legión.
* **Decisión:** La Legión factura un costo fijo mensual por dispositivo GPS instalado; el acceso a la Wialon Remote API no tiene costo por consulta. No obstante, se respeta el rate limit del proveedor mediante la sesión cacheada y consultas en lote.

### D-07 · Unificación estricta en ORPC y eliminación de endpoints HTTP públicos
* **Contexto:** Durante la fase preliminar se montaron rutas HTTP temporales en `/api/wialon/*` para pruebas en Bruno. En el code review se identificó que dicha ruta carecía de autenticación y exponía telemetría en tiempo real, creación de enlaces Locator sin auditoría y el Session ID interno (`sid`) en el healthcheck.
* **Decisión:** Se eliminó por completo `src/routes/wialon.ts` y su montaje en `index.ts`. Toda la funcionalidad queda centralizada exclusivamente en `wialonRouter` vía **ORPC**.

### D-08 · Control de acceso por roles (Cobros vs Supervisión) y auditoría de enlaces
* **Contexto:** Las coordenadas de vehículos y la capacidad de emitir enlaces públicos de rastreo (Locator) no deben estar expuestas a cualquier rol del CRM (por ejemplo ventas o marketing). Además, generar enlaces públicos externos requería trazabilidad de autoría.
* **Decisión:**
  - Los procedimientos de lectura de flota y telemetría (`getWialonUnits`, `getWialonUnitsStatus`, `getWialonUnitDetail`) están resguardados por **`cobrosProcedure`** (acceso para asesores y supervisores de cobros, y administradores).
  - La creación y revocación de enlaces públicos de rastreo (`createWialonTrackingLink`, `deleteWialonTrackingLink`) están restringidos estrictamente a **`cobrosSupervisorProcedure`** (supervisores de cobros y administradores).
  - Toda creación y eliminación de link emite un registro estructurado de auditoría (`WIALON_LOCATOR_LINK_CREATED`, `WIALON_LOCATOR_LINK_DELETED`) con el `userId`, correo, `unitId`, `hash` y fecha de expiración.

### D-09 · Panel de administración de solo lectura (CB-117)
* **Contexto:** CB-117 pide que un administrador pueda "configurar y monitorear la conexión" GPS desde el CRM (credenciales, ambiente, catálogo, estado de conexión). Exponer una pantalla para editar `WIALON_TOKEN` u otras credenciales desde la UI ampliaría innecesariamente la superficie de secretos (persistencia en BD, cifrado, rotación) para un caso de uso que no lo requiere: hoy solo hay un ambiente y un proveedor (La Legión).
* **Decisión:**
  - El panel `/admin/gps` es de **solo lectura y diagnóstico**. Las credenciales (`WIALON_TOKEN`, `WIALON_BASE_URL`, etc.) permanecen exclusivamente en variables de entorno del servidor; `WialonClient.getPublicConfig()` expone la configuración efectiva (ambiente, URLs, timeout, si hay token configurado) sin retornar nunca el token ni el `sid` de sesión.
  - `getWialonDiagnostics` **no lanza** ante fallo upstream: captura el error y devuelve `connected: false` con el detalle en `error`, para que el panel de monitoreo pueda renderizarse siempre en vez de romperse cuando Wialon está caído — justo el escenario que un administrador necesita ver.
  - `testWialonConnection` es la única acción mutativa del panel (forzar re-login) y sí propaga el error normalmente, porque es una acción explícita del administrador, no un chequeo pasivo; queda auditada con `WIALON_CONNECTION_TESTED`.
  - Los tres procedimientos usan `adminProcedure` (no `cobrosProcedure`/`cobrosSupervisorProcedure`) porque la historia es explícitamente "Como administrador".
  - Se agregó `.output()` explícito (zod) a los tres procedimientos nuevos: sin él, el tipo combinado del cliente en `apps/web` se infería como `{}` por truncamiento de TypeScript (TS7056) al recomponer el `AppRouter` completo tras el rebuild de `apps/crm/apps/server` (mismo motivo documentado en `accounting.ts` para `getReporteNoLiquidados`). **Importante:** el proyecto usa TS project references (`composite: true`); tras cambiar el router de Wialon hace falta correr `bun run build` en `apps/server` (regenera `dist/*.d.ts`) antes de que `apps/web` vea los procedimientos nuevos en su propio `tsc --noEmit`.

### D-10 · Vínculo vehículo ↔ unidad de Wialon: deducido por placa, corregible a mano (CB-118)
* **Contexto:** La Ficha 360 necesita saber qué unidad consultar, pero nada en el CRM relacionaba un `vehicles.id` con un `unitId` de Wialon. Los campos GPS que ya existían (`gps_activo`, `imei_gps`, `ubicacion_actual_gps`, `ultima_señal_gps`) los llena el cargador de CSV y nunca se conectaron al proveedor. En el catálogo de La Legión las unidades suelen nombrarse `"Bidgar Yatz - C-629BNC"` (cliente + placa), pero también hay nombres como `"A-04"`, sin placa.
* **Decisión:**
  - Se agregan a `vehicles` las columnas `wialon_unit_id`, `wialon_unit_name`, `wialon_vinculado_at` y `wialon_vinculado_por` (migración `0057`).
  - `getGpsVehiculo` resuelve en cascada: vínculo persistido → deducción por placa (`matchUnidadPorPlaca`, que normaliza mayúsculas, espacios y guiones) → `sin_vinculo`.
  - **La búsqueda va por el núcleo de la placa** (3 dígitos + 3 letras, `extraerNucleoPlaca`): `core/search_items` filtra por subcadena literal de `sys_name`, y ni la placa cruda (`"P - 278KJQ"`) ni todos sus dígitos (~10 % de las placas del CRM vienen como `"P0-720GVH"`, con un cero de más) encuentran la unidad `"P-720GVH SIN APAGADO"`. Se prefiltra en Wialon por los 3 dígitos y `matchUnidadPorPlaca` exige el núcleo **completo y con bordes** (sin dígito antes ni letra/dígito después), ignorando el prefijo: `P-123A` ya no elige `P-123ABC`, y `P-720GVH` + `C-720GVH` es `ambiguo`. Placas sin núcleo (`"NUEVO"`, `"N/A"`, `"EJEMPLO"`) son `sin_placa` y no se busca nada. En el caso `ambiguo` solo las coincidencias llegan como candidatos.
  - **La deducción por placa queda guardada** (`wialon_vinculado_por = 'auto:placa'`) para que las consultas siguientes no vuelvan a recorrer el catálogo. Es best-effort: si el `UPDATE` falla, la consulta igual responde. Solo escribe si el vehículo **sigue sin vínculo** (`WHERE wialon_unit_id IS NULL`): si un supervisor lo vinculó a mano mientras la consulta recorría el catálogo, su decisión no se pisa. Tampoco se deduce una unidad que ya está guardada en **otro** vehículo (el GPS se reasignó): se responde `sin_vinculo` con motivo `asignada_a_otro` y decide un supervisor, para no deshacer la reasignación. El marcador `auto:placa` hace que la ficha siga mostrando el vínculo como deducción (`vinculoOrigen: "placa"`) y ofreciendo al supervisor corregirlo; cuando lo fija un supervisor, se guarda su email y pasa a `persistido`.
  - **Cero o más de una coincidencia devuelve `null`, no la primera.** Con dos unidades que comparten placa, elegir cualquiera mandaría al gestor de campo al vehículo equivocado; en ese caso la ficha muestra los candidatos y decide un supervisor (`vincularUnidadWialon`, auditado con `WIALON_UNIDAD_VINCULADA`).
  - `wialon_unit_id` **no** lleva `UNIQUE`: tras una recuperación la misma unidad física puede reasignarse a otro vehículo, y un índice único convertiría ese cambio legítimo en un error de escritura.
  - **Deuda temporal explícita:** mientras la `0057` no esté aplicada, el `SELECT` que nombra esas columnas falla con `column does not exist`. `leerVehiculoParaGps` atrapa ese fallo, registra `WIALON_VINCULO_COLUMNAS_NO_DISPONIBLES` y reintenta con las columnas viejas, así que la ficha sigue deduciendo por placa. `vincularUnidadWialon` **sí** falla visible: es una acción explícita y el supervisor tiene que saber que no quedó guardada. Ese `catch` sobra cuando la migración esté aplicada en todos los ambientes.
  - **Auditoría obligatoria (fail closed):** si el registro en `gps_consulta_logs` falla (o la tabla no existe porque falta la `0057`), `getGpsVehiculo` **no devuelve ubicación**: responde `no_disponible` con código `AUDITORIA_NO_DISPONIBLE`. Las respuestas sin ubicación (`sin_vinculo`) no se bloquean. Por eso, en un ambiente sin la `0057` la tarjeta no muestra ubicación hasta aplicarla.

### D-11 · Sin librería de mapas: coordenadas, Google Maps y Locator (CB-118)
* **Contexto:** CB-118 pide "visualizar la ubicación", y el monorepo no tiene ninguna dependencia de mapas (ni leaflet, ni mapbox, ni google-maps). Embeber el Locator en un iframe dentro de la ficha habría generado un token público de Wialon en cada apertura de la pantalla, en contra de D-05.
* **Decisión:** la tarjeta muestra la telemetría como datos (coordenadas, velocidad, ignición, odómetro, horas de motor, antigüedad de la última señal) con un botón "Abrir en Google Maps", y deja el mapa en vivo al Locator, que ya existe, es acotado en el tiempo y queda auditado. Cero dependencias nuevas.
* **Antigüedad de la señal como dato de primera clase:** la tarjeta clasifica la última señal en reciente (< 15 min), con retraso (< 2 h) y sin reportar (≥ 2 h). Para cobros no es cosmético: una posición de hace tres días no dice dónde está el vehículo, dice que el GPS dejó de reportar — y en un crédito en mora eso es información en sí misma.

### D-12 · La Ficha 360 consulta el GPS por su cuenta, no dentro de `getDetallesCreditoCarteraBack` (CB-118)
* **Contexto:** todos los datos del tab Vehículo llegan hoy en la respuesta de `getDetallesCreditoCarteraBack`. Sumar ahí la telemetría habría sido lo "natural".
* **Decisión:** el GPS va en su propio procedimiento (`getGpsVehiculo`) y su propia query en el frontend. Wialon es un proveedor externo con timeout de 15 s; meterlo en la consulta que pinta toda la ficha haría que una caída del GPS retrase —o tumbe— la pantalla completa de gestión. Por la misma razón `getGpsVehiculo` **degrada a `no_disponible` en vez de lanzar**, igual que `getWialonDiagnostics` (D-09): que el proveedor no responda no es un problema del crédito.

### D-13 · Trazabilidad técnica, reintentos y manejo de fallas (CB-121)
* **Contexto:** `gps_consulta_logs` (D-10, CB-118) audita la INTENCIÓN de negocio — quién vio la ubicación de un vehículo, por qué motivo y para qué crédito. No registra qué pasó con Wialon: no hay rastro de solicitudes/respuestas, errores, reintentos ni tiempos de respuesta, y los fallos solo quedaban en `console.*` sin alertar a nadie. El `WialonClient` tampoco tenía política de reintentos más allá del re-login transparente de D-02, ni forma de contener una caída sostenida del proveedor.
* **Decisión — bitácora separada, no una extensión de `gps_consulta_logs`:** `gps_integracion_logs` (migración `0058`) registra **una fila por cada intento HTTP** a Wialon (login, catálogo, telemetría, links de Locator, diagnóstico), con `correlationId` (agrupa los reintentos de una misma operación lógica), `operacion` (svc de Wialon), `origen` (endpoint/job del CRM), `resultado` (`ok`/`error`/`reintentado`/`incierto`), `errorCode`, `severidad`, `duracionMs` y resúmenes de request/response **sanitizados** (nunca token/sid/eid, truncados a ~2 KB). Es otra tabla porque: (1) una sola consulta de la ficha genera varias llamadas HTTP, cada una con su propia fila; (2) no toda llamada a Wialon tiene `vehicleId`/`motivo` (login, catálogo admin, diagnóstico); (3) es **no bloqueante** — si el insert falla, la operación contra Wialon sigue igual, justo lo contrario de la auditoría de CB-118, que es fail-closed a propósito. `gpsConsultaLogId` conecta ambas cuando el origen fue una consulta de la ficha. Retención: 90 días, purgada a diario (mismo patrón que `bot-cobros-purga.ts`).
* **Decisión — clasificación de fallas (`clasificarFallaWialon`):** cada error se clasifica en severidad (`info`/`warning`/`critical`) y si es reintentable, según el código de Wialon:
  - **Crítico, no reintentable:** `WIALON_AUTH_REQUIRED` (token no configurado), Wialon 7/8/14 (acceso denegado, credenciales, facturación), `WIALON_INVALID_RESPONSE` (contrato roto), 4xx de red, y cualquier código no listado (2, 4, 6). Abre una alerta `error_critico` que **no se auto-resuelve**.
  - **Transitorio, reintentable:** timeout, error de red con status 5xx o sin status, Wialon 5/11 (ejecución/BD no disponible).
  - **Transitorio, NO reintentable:** Wialon 9/10 (cuota o tamaño de paquete excedido) — reintentar de inmediato empeora el problema en vez de resolverlo.
  - El error 1 (sesión inválida) sigue con su propio flujo de D-02 (re-login + 1 reintento), registrado como `reintentado`.
* **Decisión — reintentos solo en lecturas idempotentes:** `WIALON_SVC_IDEMPOTENTES` es una allowlist cerrada a los svc que el cliente realmente usa (`token/login`, `core/search_items`, `core/search_item`, `unit/calc_last`). Solo esos se reintentan automáticamente ante una falla transitoria: hasta 2 reintentos (3 intentos en total), backoff 500 ms → 1500 ms + jitter. **`token/update` (crear/borrar link de Locator) nunca está en la allowlist y nunca se reintenta.** Si una escritura falla por una causa transitoria, no hay forma de saber si Wialon ya la aplicó antes de que la conexión se cortara: el cliente la propaga como `WIALON_RESULTADO_INCIERTO` (mapeado a `CONFLICT` en ORPC) con un mensaje que pide verificación manual antes de repetir la acción — cubre el requisito de no ejecutar acciones ambiguas automáticamente.
* **Decisión — circuit breaker en memoria:** 5 fallos reintentables consecutivos (de cualquier operación, no solo la que está fallando) abren el circuito por 60 s; mientras está abierto, ninguna operación llama a Wialon —ni lecturas ni escrituras— y responden de inmediato `WIALON_NO_DISPONIBLE` (mapeado a `SERVICE_UNAVAILABLE`), dejando que la ficha muestre la contingencia manual en vez de acumular más timeouts. El circuito se evalúa al INICIO de cada llamada pública, no entre los reintentos internos de una misma llamada (una tanda de 3 intentos que ya está en curso no se corta a mitad). Es por instancia del proceso: en un despliegue con varias réplicas, cada una tiene su propio estado.
* **Decisión — mensajes al asesor vs. detalle técnico:** `getGpsVehiculo` sigue devolviendo mensajes fijos y genéricos al asesor (ya lo hacía desde D-09/D-12), y ahora además incluye `referencia` (el `correlationId` de esa consulta) en toda respuesta `no_disponible`, para que el asesor pueda dársela a soporte/admin sin tener que reproducir el fallo. El detalle técnico completo (payloads sanitizados, código de Wialon, reintentos) solo es visible en `/admin/gps` (`getGpsIntegracionLogs`, `getGpsIntegracionSalud`), exclusivo de `adminProcedure`. Las alertas (`getGpsAlertas`) sí las ve también `cobrosSupervisorProcedure`: un supervisor necesita saber si el GPS no es confiable ahora mismo, aunque no vea la bitácora técnica completa.
* **Decisión — alertas con dedup por fila, no por tabla de notificaciones:** `gps_integracion_alertas` tiene un índice único parcial `(tipo, COALESCE(errorCode, '')) WHERE estado = 'abierta'` (el `COALESCE` evita que las alertas de umbral, con `errorCode` nulo, se dupliquen): solo puede haber una alerta abierta por tipo+código a la vez. Abrir una alerta nueva notifica una vez a todos los `admin` (tipo `system`, `redirectPage: "admin_gps"`); reforzar una que ya estaba abierta solo incrementa `ocurrencias` y `ultimaVez`, sin notificar de nuevo. Las alertas de umbral (`tasa_error`, `latencia_sla`, `fallos_consecutivos`) se auto-resuelven cuando la métrica vuelve a estar dentro del SLA (job `gps-integracion-salud.ts`, cada 5 min); las de `error_critico` requieren que un admin las cierre a mano (`resolverGpsAlerta`, con nota obligatoria) porque su causa típica no se arregla sola con que pase el tiempo.
* **SLA y umbrales:** ventana de evaluación de 15 min (mínimo 5 muestras). Tasa de error ≥ 20% → alerta `tasa_error` (por intento: cuenta como fallo todo intento no exitoso, incluidos los `reintentado` con `errorCode`). Latencia p95 > 5000 ms → alerta `latencia_sla`. 5 fallos consecutivos → alerta `fallos_consecutivos` (evaluado en caliente en cada evento, no solo por el job periódico).
* **Proceso manual de contingencia** (mientras el circuito está abierto o hay una alerta crítica sin resolver):
  1. El asesor ve en la ficha el aviso de contingencia y, si necesita la ubicación con urgencia, usa el portal web de La Legión (`gps.lalegion.gt`) directamente o contacta a su supervisor.
  2. El supervisor/admin revisa `/admin/gps` → sección "Fallas y salud": tasa de error, latencia p95, estado del circuito y alertas abiertas con su detalle.
  3. Si la alerta es `error_critico` (típicamente token vencido, credenciales rechazadas o acceso denegado), contacta al proveedor (La Legión) o corrige la variable de entorno `WIALON_TOKEN` y reinicia el servicio.
  4. Tras confirmar que la integración responde de nuevo (`testWialonConnection` en el panel), el admin resuelve la alerta manualmente con una nota (`resolverGpsAlerta`) — las de umbral no necesitan este paso, se cierran solas.
  5. Si una escritura (link de Locator, vínculo de unidad) quedó en estado incierto, se verifica manualmente en Wialon/la ficha antes de repetir la acción — nunca se reintenta automáticamente.

---

## Mapa de Procedimientos ORPC (Frontend CRM - Protegidos por Rol)

Disponibles vía `@/utils/orpc` en el cliente web bajo `orpc.wialon.*`:

| Procedimiento | Guardia / Middleware | Tipo | Entrada | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| `getWialonUnits` | `cobrosProcedure` | Query | `{ filterName?: string, from?: number, to?: number }` | Lista unidades de la flota (por defecto `to: 0xFFFFFFFF` para traer todas). |
| `getUnitsStatus` | `cobrosProcedure` | Query | `{ unitIds: number[] }` | Telemetría consolidada (km, horas, velocidad, ignición simétrica). |
| `getWialonUnitDetail` | `cobrosProcedure` | Query | `{ unitId: number, flags?: number }` | Detalle a bajo nivel y mensajes crudos de sensores. |
| `createWialonTrackingLink` | `cobrosSupervisorProcedure` | Mutation | `{ unitId: number, durationSeconds?: number, note?: string }` | Genera link temporal de Locator en vivo (máx 30 días) con log de auditoría. |
| `deleteWialonTrackingLink` | `cobrosSupervisorProcedure` | Mutation | `{ hash: string }` | Revoca anticipadamente un link de Locator con log de auditoría. |
| `getWialonConnectionStatus` | `cobrosProcedure` | Query | `void` | Healthcheck y validación de sesión activa. |
| `getWialonDiagnostics` | `adminProcedure` | Query | `void` | Diagnóstico enriquecido para el panel `/admin/gps` (CB-117): ambiente, latencia medida, conteo de flota y configuración efectiva sin secretos. No lanza ante fallo upstream — degrada a `connected: false` con el error incluido en la respuesta. |
| `testWialonConnection` | `adminProcedure` | Mutation | `void` | Fuerza una re-autenticación contra Wialon (`checkHealth(true)`). Acción explícita del administrador; sí propaga el error y queda auditada (`WIALON_CONNECTION_TESTED`). |
| `getWialonUnitsCatalog` | `adminProcedure` | Query | `{ filterName?: string, from?: number, to?: number }` | Mismo handler que `getWialonUnits`, resguardado con `adminProcedure` para que el panel de administración no dependa del rol de cobros. |
| `getGpsVehiculo` | `cobrosProcedure` | Query | `{ casoCobroId, vehicleId, motivo }` | **CB-118.** Todo lo que la Ficha 360 necesita del GPS en un solo viaje: resuelve la unidad (vínculo fijado o deducción por placa) y devuelve telemetría + fecha de última señal. Unión discriminada por `estado`: `vinculado` / `sin_vinculo` (con `motivo` y candidatos) / `no_disponible`. No lanza ante fallo upstream. **Sí lanza `NOT_FOUND`** si el usuario no tiene acceso al caso (`assertAccesoCasoCobro`: un asesor regular solo ve sus casos) o si `vehicleId` no es el vehículo del caso; en ese caso no se audita. El SIFCO de la bitácora se toma del caso, no del cliente. Toda respuesta trae `auditada` (si quedó en la bitácora), que la tarjeta usa para decir "Consulta registrada" o "no registrada". |
| `vincularUnidadWialon` | `cobrosSupervisorProcedure` | Mutation | `{ vehicleId, unitId, unitName }` | **CB-118.** Fija manualmente qué unidad corresponde al vehículo cuando la placa no alcanza. Auditado (`WIALON_UNIDAD_VINCULADA`). Sí propaga el error (`NOT_FOUND` si el vehículo no existe). Reasignar **mueve** la unidad: en una transacción se le quita a cualquier otro vehículo que la tuviera (queda en `vehiculosDesvinculados` del log). |
| `getGpsIntegracionLogs` | `adminProcedure` | Query | `{ page?, perPage?, resultado?, severidad?, errorCode?, operacion?, numeroCreditoSifco?, correlationId? }` | **CB-121.** Bitácora técnica paginada: cada intento HTTP a Wialon con su resultado, duración y payloads sanitizados. Vive en `routers/gps-integracion.ts` (no en `wialon.ts`) para no exceder el límite de inferencia de TypeScript (ver D-03). |
| `getGpsIntegracionSalud` | `adminProcedure` | Query | `void` | **CB-121.** Resumen de salud de la última hora: tasa de error, latencia p50/p95, alertas abiertas, último error crítico y estado del circuit breaker de la instancia. |
| `getGpsAlertas` | `cobrosSupervisorProcedure` | Query | `void` | **CB-121.** Lista de alertas (abiertas y resueltas), con su tipo, ocurrencias y detalle. También visible para supervisores de cobros, no solo admin. |
| `resolverGpsAlerta` | `adminProcedure` | Mutation | `{ alertaId, nota }` | **CB-121.** Cierra manualmente una alerta abierta (obligatorio para `error_critico`, que no se auto-resuelve). `NOT_FOUND` si ya estaba resuelta o no existe. |

---

## Variables de Entorno

Configuradas en `apps/crm/apps/server/.env`:

```env
# ── Integración Wialon / La Legión GPS ──────────────────────────────────────────
WIALON_BASE_URL=https://hst-api.wialon.com/wialon/ajax.html
WIALON_LOCATOR_URL=https://gps.lalegion.gt/locator/index.html
# Token permanente generado en https://gps.lalegion.gt/login.html?access_type=-1&duration=0
WIALON_TOKEN=d85ef21e1af4d78bbd874926...
WIALON_TIMEOUT_MS=15000
```

---

## Verificación y Pruebas

El módulo cuenta con suite de pruebas automatizadas con `bun:test`:
* [`wialon-client.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/server/src/services/wialon/wialon-client.test.ts): Valida login por token permanente, caching de sesión, reintento transparente ante error 1, discriminación estricta y simétrica de sensores de ignición, respuesta inválida cuando Wialon devuelve no-arreglos, límite de duración de links y rango completo `to: 0xFFFFFFFF`.
* [`wialon.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/server/src/routers/wialon.test.ts): Valida la exportación de procedimientos y el mapeo exhaustivo de errores de Wialon (`BAD_GATEWAY` para fallos upstream, `FORBIDDEN` para error 7, `GATEWAY_TIMEOUT`, `UNAUTHORIZED`, etc.).

* Cobertura añadida en CB-118: `matchUnidadPorPlaca` (normalización de placa, unidad sin placa en el nombre, placa duplicada → ambiguo), `extraerUltimaSenal` (epoch en segundos → ms, `lmsg.t` sobre `pos.t`, timestamps inválidos) y `getGpsVehiculo` (degradación a `no_disponible` con Wialon caído, y que **siga resolviendo por placa cuando las columnas de la `0057` no existen**).
* [`-gps-ficha.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/web/src/routes/cobros/-gps-ficha.test.ts) (web): fronteras de 15 min y 2 h para el estado de la señal, relojes desfasados, y que ignición `undefined` se muestre como "Sin dato" y nunca como "Apagado".
* [`wialon-cb121.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/server/src/services/wialon/wialon-cb121.test.ts): clasificación de fallas (timeout/red/Wialon 5/7/8/9 → severidad y reintentabilidad correctas), reintentos de lecturas idempotentes (3 intentos con backoff, sin reintento ante 7/9), escrituras que nunca reintentan y se propagan como `WIALON_RESULTADO_INCIERTO`, circuit breaker (abre a los 5 fallos consecutivos y deja de llamar a `fetch`), sanitización de payloads (redacta token/sid/eid, trunca payloads grandes) y que un hook `onIntento` roto nunca rompa la llamada real.
* [`gps-integracion.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/server/src/routers/gps-integracion.test.ts): los 4 endpoints nuevos con roles correctos (`adminProcedure` para logs/salud/resolver, también `cobrosSupervisorProcedure` para alertas) y `FORBIDDEN` para un asesor regular.
* [`gps-integracion-salud.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/server/src/jobs/gps-integracion-salud.test.ts): `percentil95` sobre valores desordenados, un solo valor y arreglo vacío.
* [`-gps-format.test.ts`](file:///home/jalvarezatcci/Documentos/universe/apps/crm/apps/web/src/routes/admin/-gps-format.test.ts) (web): `formatPorcentaje` y `formatDuracion` (umbral de 1000ms para pasar a segundos).

```bash
# server
cd apps/crm/apps/server
bun test src/services/wialon/ src/routers/wialon.test.ts src/routers/gps-integracion.test.ts src/jobs/gps-integracion-salud.test.ts
# 312 pass, 0 fail

# web
cd apps/crm/apps/web
bun test src/routes/cobros/ src/routes/admin/-gps-format.test.ts
# 59 pass, 0 fail
```

> **Build:** el monorepo usa TS project references (`composite: true`). Tras tocar
> el router de Wialon hay que correr `bun run build` en `apps/server` antes de que
> `apps/web` vea los procedimientos nuevos en su propio `tsc --noEmit` (D-09).
