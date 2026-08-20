# VictoriaLogs IaC

Infraestructura versionada para desplegar VictoriaLogs detrás del proxy administrado por Coolify y recolectar logs con Vector.

## Alcance de este directorio

- `central/`: VictoriaLogs y `vmauth`; no contiene proxy TLS.
- `agent/`: Vector y un socket proxy allowlist para cada servidor de aplicaciones.
- `scripts/`: render seguro, validación y operaciones.
- `tests/`: gates estáticos y de seguridad.
- `SPEC.md`: decisiones de arquitectura v1.1.

Ningún comando de este directorio despliega producción automáticamente.

## Prerrequisitos locales

- Podman 6 o superior.
- Proveedor Compose accesible mediante `podman compose`.
- Python 3.11 o superior.
- Credenciales de prueba no productivas para smoke tests.

## Validación

Asegurar que el socket rootless esté activo y ejecutar el gate completo:

```bash
systemctl --user start podman.socket
infra/observability/victorialogs/scripts/validate.sh
```

El gate ejecuta las pruebas, renderiza configuraciones sintéticas, valida ambos Compose con Podman y usa los binarios fijados de Vector y `vmauth`.

El smoke funcional local requiere credenciales sintéticas en `central/secrets/` y se ejecuta sin depender de la red Compose del host:

```bash
infra/observability/victorialogs/scripts/smoke-local.sh
```

Liga los puertos únicamente a `127.0.0.1`, prueba aislamiento read/write, ingiere un evento seguro, lo consulta y elimina los contenedores/volumen al terminar.

## Configuración central

En Coolify definir como secretos:

```text
VMAUTH_QUERY_USERNAME
VMAUTH_QUERY_PASSWORD
VMAUTH_INGEST_USERNAME
VMAUTH_INGEST_PASSWORD
```

Compose los convierte en archivos temporales para `config-init`; el servicio genera `vmauth.yaml` en un volumen interno y termina antes de arrancar `vmauth`. Las contraseñas deben tener al menos 24 caracteres y lectura/ingesta deben usar credenciales distintas.

Para render manual local se pueden crear, fuera de Git:

```text
central/secrets/query_username
central/secrets/query_password
central/secrets/ingest_username
central/secrets/ingest_password
```

Y ejecutar:

```bash
python scripts/render-config.py central \
  --secrets-dir central/secrets \
  --template central/config/vmauth.template.yaml \
  --output central/runtime/vmauth.yaml
```

En Coolify:

1. seleccionar build pack **Docker Compose** (no Raw Compose);
2. Base Directory: `/infra/observability/victorialogs`;
3. Docker Compose Location: `/central/compose.yaml`;
4. definir las cuatro variables secretas como runtime-only;
5. persistir los volúmenes `victoria-logs-data` y `vmauth-config`;
6. asignar el dominio al servicio `vmauth`, puerto `8427`;
7. habilitar HTTPS en Coolify;
8. healthcheck HTTP `/health`;
9. no exponer `victoria-logs:9428`;
10. verificar límites y espacio antes de iniciar.

`config-init` usa `exclude_from_hc: true`, extensión documentada por Coolify para servicios one-shot. Por eso la validación local debe ejecutarse mediante `scripts/validate.sh`, que retira únicamente esa extensión en una copia temporal antes de llamar a Podman Compose.

## Configuración del agente

En cada recurso Coolify del agente definir:

```text
VECTOR_INGEST_USERNAME
VECTOR_INGEST_PASSWORD
VICTORIALOGS_ENDPOINT
LOG_HOST
LOG_ENVIRONMENT
CONTAINER_SOCKET_PATH
```

Las dos primeras son secretas. `config-init` genera `vector.yaml` en el volumen interno antes de iniciar Vector. El endpoint debe terminar en `/insert/elasticsearch/`.

Para render manual local pueden crearse `agent/secrets/ingest_username` y `agent/secrets/ingest_password`, y luego ejecutar:

```bash
python scripts/render-config.py agent \
  --secrets-dir agent/secrets \
  --template agent/config/vector.template.yaml \
  --output agent/runtime/vector.yaml \
  --endpoint https://logs.example.com/insert/elasticsearch/ \
  --host app-server-01 \
  --environment staging
```

Para Podman rootless, copiar `agent/.env.example` a `agent/.env` y configurar `CONTAINER_SOCKET_PATH` con el socket real del usuario. En Coolify se conserva `/var/run/docker.sock`. Solo `docker-socket-proxy` monta el socket; Vector consume su API HTTP allowlist con operaciones POST deshabilitadas.

En Coolify el agente se crea como un segundo recurso Docker Compose con la misma Base Directory y Docker Compose Location `/agent/compose.yaml`. Sus variables se marcan runtime-only y no se asigna dominio público al servicio Vector.

## Operación segura

- No almacenar secretos en variables versionadas.
- No publicar `/internal/*` ni `/metrics`.
- No usar `podman compose up` contra producción desde una estación local.
- El primer despliegue es staging y requiere siete días de medición.
- R2 permanece deshabilitado hasta aprobar y probar backup/restore.
