# Plataforma centralizada de logs

**Versión:** 1.1
**Fecha:** 20 de agosto de 2026
**Estado:** Propuesta implementable como IaC; despliegue pendiente de aprobación

## 1. Decisión

Se utilizará VictoriaLogs single-node como almacenamiento y consulta, `vmauth` como frontera de autorización y Vector como agente. Coolify administrará dominio, TLS, reverse proxy y healthchecks externos. El repositorio no despliega Caddy, Nginx ni Traefik propios.

El MVP no incluye Grafana, OpenObserve, clúster, alta disponibilidad ni APM completo.

## 2. Objetivos

- Centralizar logs de contenedores con búsqueda, agregaciones y live tail.
- Correlacionar una operación mediante `request_id` y `operation_id`.
- Evitar que tokens, credenciales, cuerpos o datos personales lleguen al almacenamiento.
- Mantener la caída del logging aislada de las operaciones de negocio.
- Limitar consumo central y rotación local.
- Poder reproducir y validar toda la configuración con Podman antes de desplegarla en Coolify.

## 3. Arquitectura

```text
Aplicación → stdout/stderr JSON → Vector → HTTPS → Coolify → vmauth → VictoriaLogs
Navegador → /client-events (esquema allowlist) → API → stdout JSON → Vector
```

Coolify expone únicamente `vmauth:8427`. VictoriaLogs escucha en `9428` dentro de la red de Compose y no publica puertos del host.

`vmauth` permite:

- usuario de consulta: `/select/*`;
- usuario de ingesta: `/insert/*`;
- healthcheck sin secretos: `/health`;
- ninguna ruta `/internal/*` o `/metrics` desde Internet.

## 4. Capacidad inicial

| Recurso | Valor |
|---|---:|
| Host | Shared CPU amd64 |
| vCPU | 1 |
| RAM | 1 GB + swap de emergencia |
| SSD | 25 GB |
| Datos VictoriaLogs | máximo 12 GiB |
| Retención | 30 días, sujeta al límite de espacio |
| Cache permitida | 512 MiB |

El límite de 12 GiB preserva margen para SO, runtime de Coolify, proxy, imágenes, snapshots temporales y logs locales. `-memory.allowedBytes` regula caches; no sustituye el límite de memoria del contenedor.

Antes de ampliar retención se medirán siete días de ingesta, compresión, CPU, RAM, disco y streams.

## 5. Contrato de eventos

Toda aplicación modificada emite una línea JSON por evento.

Campos obligatorios:

- `timestamp`: UTC ISO 8601;
- `level`: `debug`, `info`, `warn`, `error` o `fatal`;
- `service`;
- `environment`;
- `message`: texto estable derivado exclusivamente de `event`; nunca texto libre del payload;
- `event`: identificador validado contra `^[a-z][a-z0-9_.-]{0,79}$`;
- `schema_version`.

Campos de correlación cuando apliquen:

- `request_id` generado en el borde y devuelto en el response header;
- `operation_id` estable para el intento de negocio;
- `trace_id` reservado para una futura instrumentación;
- `version` o SHA de despliegue;
- `duration_ms`;
- `http.method`, `http.route`, `http.status_code`;
- `error_type` y código estable.

### Stream fields

Únicamente campos estables y de baja cardinalidad:

```text
service,environment,host,container_name
```

`request_id`, `trace_id`, `operation_id`, usuario, crédito y job permanecen como campos normales.

## 6. Información prohibida

No se almacenan contraseñas, tokens, cookies, Authorization, API keys, llaves privadas, tarjetas, CVV, cuerpos completos, archivos, Base64 ni datos personales como DPI, NIT, teléfono o correo.

Defensa en profundidad:

1. la aplicación construye eventos allowlist;
2. Vector elimina campos sensibles conocidos y descarta firmas inequívocas de secretos;
3. una prueba automatizada usa canaries para verificar que no fueron ingeridos;
4. las muestras manuales complementan, pero no reemplazan, la prueba.

No debe confiarse en regex para hacer seguro un body completo.

## 7. Auditoría y observabilidad

La auditoría de negocio permanece separada en PostgreSQL y registra quién hizo qué, entidad, resultado y referencia opaca. Los logs técnicos registran ruta normalizada, status, duración, IDs de correlación y tipo de error.

No se duplican request/response bodies desde `audit_logs` hacia VictoriaLogs. La auditoría debe corregir sus timestamps a UTC y recibir `request_id` para correlación.

## 8. Telemetría frontend

El MVP incluye un endpoint `/client-events` con esquema cerrado, rate limit y autenticación existente. Registra solamente eventos operativos permitidos, por ejemplo:

```json
{
  "event": "payment.request.failed",
  "stage": "upload",
  "request_id": "opaque",
  "operation_id": "opaque",
  "axios_code": "ERR_NETWORK",
  "online": true,
  "duration_ms": 1200,
  "http_status": null
}
```

Si el navegador está offline, conserva una cola pequeña con TTL y la entrega al recuperar conexión. No incluye crédito, monto, nombre, boleta ni payload del pago.

## 9. Agente y tolerancia a fallos

Vector usa buffer de disco de 512 MiB y `drop_newest` al agotarse. La caída de VictoriaLogs no puede aplicar backpressure sobre la aplicación. Deben alertarse errores de envío y eventos descartados.

Vector no recibe el socket del runtime. Se conecta por un Unix socket compartido a `docker-socket-proxy`, que permite únicamente consultas `CONTAINERS`, `EVENTS`, `INFO`, `PING` y `VERSION`, con `POST=0`. El proxy es el único contenedor que monta el socket configurable y no publica ningún puerto. En Podman rootless se usa el socket del usuario; en hosts Coolify se usa `/var/run/docker.sock`.

Cada servicio mantiene rotación local (`max-size`/`max-file`) aunque Vector esté activo.

## 10. Seguridad

- Coolify administra HTTPS y proxy.
- `vmauth` mantiene credenciales separadas por lectura e ingesta.
- Cada servidor emisor recibe credencial revocable propia en la incorporación gradual.
- Coolify almacena los valores secretos; Compose los materializa como archivos `/run/secrets` para un `config-init` efímero.
- Coolify `v4.3.9` no detecta automáticamente en UI las variables usadas solo por `secrets.*.environment`; se crean manualmente como runtime-only y el despliegue de staging debe pasar `verify-secret-isolation.py` antes de exponer dominio o usar datos reales.
- El init genera configuraciones runtime con modo `0600` en volúmenes internos; ningún secreto ni archivo runtime vive en Git.
- Los volúmenes de configuración se consideran almacenamiento secreto, se excluyen de backups genéricos y se regeneran al rotar credenciales.
- VictoriaLogs no expone puertos del host.
- Los endpoints internos y métricas se consultan solo desde red administrativa.
- Las imágenes se fijan por versión y digest amd64.

## 11. Backups y R2

R2 es opcional. El respaldo diario crea snapshot de una partición `YYYYMMDD`, copia con `rclone`, verifica integridad y luego elimina el snapshot local. Los endpoints `/internal/partition/*` solo son accesibles localmente.

La restauración se realiza en una instancia temporal aislada mediante detach/copia/attach. Debe probarse antes de declarar el archivo operativo y trimestralmente si se usa para auditoría.

## 12. Monitoreo

Se vigilan desde fuera de VictoriaLogs:

- disponibilidad de `/health`;
- disco libre y estado read-only;
- CPU, RAM y reinicios;
- errores y rechazos de ingesta;
- streams creados;
- eventos descartados por Vector;
- antigüedad del último backup.

Una caída del sistema central no debe ocultar su propia alerta.

## 13. Fases

1. Inventario y limpieza de logs actuales.
2. Contrato JSON y librería estructurada compartida.
3. IaC central y agente validados localmente con Podman.
4. Piloto en Cartera staging durante siete días.
5. Telemetría frontend y correlación end-to-end.
6. Incorporación gradual de producción.
7. R2 únicamente cuando exista requisito de retención histórica.

Los cambios de aplicación, IaC central y migración por servicio se entregan en PRs separados.

## 14. Criterios de aceptación

- Tres servicios envían eventos estructurados.
- Se filtra por servicio, entorno, nivel, evento y tiempo.
- Un `request_id` correlaciona navegador, proxy, API y response.
- `operation_id` permite seguir upload y registro de pago.
- No existen stream fields de alta cardinalidad.
- Las pruebas canary no encuentran secretos ni PII.
- Coolify expone únicamente `vmauth` mediante HTTPS.
- Lectura e ingesta usan credenciales distintas.
- Los endpoints internos no son públicos.
- Una caída de una hora no afecta solicitudes de negocio.
- Al llenarse el buffer se ejecuta la política documentada.
- La rotación local evita crecimiento ilimitado.
- El consumo normal cabe en 1 GB/1 vCPU durante el piloto.
- Si R2 está habilitado, una restauración diaria específica pasa en instancia aislada.

## 15. Fuentes

- https://docs.victoriametrics.com/victorialogs/
- https://docs.victoriametrics.com/victorialogs/data-ingestion/vector/
- https://docs.victoriametrics.com/victorialogs/security-and-lb/
- https://docs.victoriametrics.com/victorialogs/keyconcepts/
- https://docs.podman.io/
