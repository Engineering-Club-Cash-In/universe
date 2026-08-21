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

Coolify 4.1.2 solo admite `file` para secretos Compose en servicios read-only; `secrets.*.environment` falla durante el deployment. Las credenciales se aprovisionan como archivos host fuera de Git y fuera del directorio clonado:

```bash
install -d -m 700 /data/coolify/secrets/victorialogs-central
python3 - <<'PY'
import os
from pathlib import Path

directory = Path("/data/coolify/secrets/victorialogs-central")
for name in ("query_username", "query_password", "ingest_username", "ingest_password"):
    descriptor = os.open(
        directory / name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
        0o600,
    )
    os.close(descriptor)
PY
```

Este bloque es solo para la creación inicial: falla si cualquier archivo ya existe y nunca lo trunca. La rotación debe escribir archivos temporales privados, validarlos y reemplazarlos de forma atómica.

Los valores se transfieren por un canal aprobado que no los incluya en argumentos, logs ni historial del shell. En Coolify se define únicamente la variable no sensible y runtime-only:

```text
VICTORIALOGS_SECRETS_DIR=/data/coolify/secrets/victorialogs-central
```

Antes de desplegar:

```bash
python scripts/verify-host-secret-files.py \
  /data/coolify/secrets/victorialogs-central --require-uid 0
```

Compose monta esos archivos en `/run/secrets` solo para `config-init`. Las contraseñas deben tener al menos 24 caracteres; lectura e ingesta usan usuarios y contraseñas distintas.

Render manual local, siempre fuera de Git:

```bash
python scripts/render-config.py central \
  --secrets-dir central/secrets \
  --template central/config/vmauth.template.yaml \
  --output central/runtime/vmauth.yaml
```

## Despliegue en Coolify

1. Usar build pack **Docker Compose**, no Raw Compose.
2. Base Directory: `/infra/observability/victorialogs/central`.
3. Docker Compose Location: `/compose.yaml`.
4. Crear `VICTORIALOGS_SECRETS_DIR` como variable runtime-only y no sensible.
5. Persistir `victoria-logs-data` y `vmauth-config`.
6. Asignar dominio únicamente a `vmauth:8427` y habilitar HTTPS. El listener nativo de administración queda limitado a `127.0.0.1:8428` dentro del contenedor.
7. Configurar healthcheck `/health`.
8. No exponer `victoria-logs:9428`.
9. Mantener retención de 30 días y máximo de datos de 12 GiB.

Coolify administra dominio, TLS y reverse proxy. Este IaC no incluye Caddy, Nginx ni Traefik.

`config-init` usa `exclude_from_hc: true`, extensión de Coolify para servicios one-shot. `scripts/validate.sh` elimina solo esa extensión en una copia temporal para validar con Podman Compose.

## Gate obligatorio de staging

La compatibilidad verificada para Coolify 4.1.2 usa exclusivamente `secrets.file`; no se almacenan las credenciales como variables de aplicación. Antes de exponer dominio o usar credenciales reales:

1. aprovisionar archivos con credenciales sintéticas;
2. exigir `host_secret_files=PASS files_checked=4`;
3. desplegar en staging;
4. obtener `docker inspect` de **todos** los contenedores del proyecto mediante `docker ps -a`, incluyendo el `config-init` detenido;
5. proteger el archivo y ejecutar con el nombre exacto de `com.docker.compose.project`:

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
