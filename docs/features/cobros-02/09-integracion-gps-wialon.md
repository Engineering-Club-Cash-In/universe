# 9 · Integración GPS / Wialon (La Legión)

**Estado:** 🟢 Implementado en CRM Server · listo para consumo en Ficha 360 y endpoints REST  
**Apps que toca:** `apps/crm` (server + tipos para web) · Wialon Remote API (`gps.lalegion.gt`)  

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

```bash
bun test src/services/wialon/wialon-client.test.ts src/routers/wialon.test.ts
# 24 pass, 0 fail (122ms)
```
