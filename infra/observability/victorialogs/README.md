# VictoriaLogs central IaC

Infraestructura versionada para desplegar **VictoriaLogs single-node** y `vmauth` detrás del dominio, TLS y reverse proxy administrados por Coolify.

## Alcance

Incluye:

- `central/`: VictoriaLogs y `vmauth`, sin proxy propio;
- `config-renderer.Dockerfile` y `scripts/render-config.py`: generación segura de `vmauth.yaml` desde secretos runtime;
- `scripts/validate.sh`: pruebas y validación reproducible con Podman;
- `scripts/smoke-local.sh`: smoke funcional de salud, autenticación, ingesta y consulta;
- `scripts/verify-secret-isolation.py`: gate fail-closed para un deployment central de staging;
- `LOG_INVENTORY.md`: inventario de logging de Cartera;
- `SPEC.md`: decisiones y límites de esta fase.

No incluye Vector, acceso al socket de contenedores, recolección de stdout, logger de aplicaciones, telemetría frontend ni despliegue en producción. Esos cambios se entregan en PRs posteriores y no deben desplegarse implícitamente desde este directorio.

## Prerrequisitos locales

- Podman 6 o superior;
- proveedor Compose accesible mediante `podman compose`;
- Python 3.11 o superior.

## Validación

```bash
infra/observability/victorialogs/scripts/validate.sh
```

El gate ejecuta pruebas Python, renderiza configuración con secretos sintéticos, valida el Compose central, construye el renderer y ejecuta `vmauth -dryRun`.

Smoke funcional local:

```bash
infra/observability/victorialogs/scripts/smoke-local.sh
```

El smoke liga puertos únicamente a `127.0.0.1`, comprueba salud, aislamiento read/write, ingesta y consulta, y limpia todos los recursos temporales.

## Secretos centrales

Definir en Coolify como variables bloqueadas y runtime-only, nunca como build args:

```text
VMAUTH_QUERY_USERNAME
VMAUTH_QUERY_PASSWORD
VMAUTH_INGEST_USERNAME
VMAUTH_INGEST_PASSWORD
```

Compose las materializa como archivos `/run/secrets` para `config-init`. Las contraseñas deben tener al menos 24 caracteres; lectura e ingesta deben usar usuarios y contraseñas distintas.

Render manual local, siempre fuera de Git:

```bash
python scripts/render-config.py central \
  --secrets-dir central/secrets \
  --template central/config/vmauth.template.yaml \
  --output central/runtime/vmauth.yaml
```

## Despliegue en Coolify

1. Usar build pack **Docker Compose**, no Raw Compose.
2. Base Directory: `/infra/observability/victorialogs`.
3. Docker Compose Location: `/central/compose.yaml`.
4. Persistir `victoria-logs-data` y `vmauth-config`.
5. Asignar dominio únicamente a `vmauth:8427` y habilitar HTTPS. El listener nativo de administración queda limitado a `127.0.0.1:8428` dentro del contenedor.
6. Configurar healthcheck `/health`.
7. No exponer `victoria-logs:9428`.
8. Mantener retención de 30 días y máximo de datos de 12 GiB.

Coolify administra dominio, TLS y reverse proxy. Este IaC no incluye Caddy, Nginx ni Traefik.

`config-init` usa `exclude_from_hc: true`, extensión de Coolify para servicios one-shot. `scripts/validate.sh` elimina solo esa extensión en una copia temporal para validar con Podman Compose.

## Gate obligatorio de staging

Coolify `v4.3.9` conserva la sección Compose `secrets`, pero no detecta automáticamente en UI variables usadas únicamente por `secrets.*.environment`. Antes de exponer dominio o usar credenciales reales:

1. desplegar con credenciales sintéticas;
2. obtener `docker inspect` de **todos** los contenedores del proyecto mediante `docker ps -a`, incluyendo el `config-init` detenido;
3. proteger el archivo y ejecutar con el nombre exacto de `com.docker.compose.project`:

```bash
chmod 600 /ruta/protegida/inspect.json
python scripts/verify-secret-isolation.py NOMBRE_PROYECTO_COMPOSE /ruta/protegida/inspect.json
```

El único resultado aceptable es:

```text
secret_environment_isolation=PASS services_checked=3 containers_checked=3
```

El gate rechaza JSON vacío o malformado, servicios ausentes/duplicados/desconocidos, mezcla de proyectos, labels faltantes, `Config.Env` ausente o mal tipado y cualquier credencial sensible presente en `Config.Env`. Los errores identifican índices y nombres de variables, nunca valores ni nombres de contenedor.

Si falla, se detiene el despliegue. No se corrige usando build args.

## Operación segura

- El volumen `vmauth-config` contiene credenciales en claro: restringirlo a administradores, excluirlo de backups genéricos y regenerarlo al rotar credenciales.
- No publicar `/internal/*` ni `/metrics`.
- No ejecutar Compose contra producción desde una estación local.
- El primer deployment debe ser staging y requiere aprobación explícita.
- R2 permanece deshabilitado hasta aprobar y probar backup/restore.
