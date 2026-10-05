# Plataforma central de VictoriaLogs

**Versión:** 1.2
**Fecha:** 20 de agosto de 2026
**Estado:** IaC central implementado; despliegue pendiente de aprobación

## 1. Decisión

Esta fase entrega únicamente el plano central:

```text
Productores futuros → HTTPS de Coolify → vmauth → VictoriaLogs single-node
```

- Coolify administra dominio, TLS, reverse proxy y healthcheck externo.
- `vmauth` es la única superficie publicable.
- VictoriaLogs permanece en la red interna de Compose.
- El repositorio no incluye Caddy, Nginx ni Traefik propios.

Vector, socket proxy, recolección de contenedores, contrato de eventos, `request_id`, `operation_id`, telemetría frontend y migración de aplicaciones quedan fuera de este PR. Se diseñarán y revisarán conjuntamente en PRs posteriores para evitar que texto arbitrario o datos sensibles entren al almacenamiento.

## 2. Objetivos de esta fase

- Versionar almacenamiento y autorización central como IaC.
- Separar credenciales de lectura e ingesta.
- Mantener endpoints administrativos fuera de Internet.
- Limitar retención, disco, memoria y logs locales.
- Validar configuración y smoke funcional con Podman.
- Probar de forma fail-closed cómo Coolify materializa secretos antes de usar datos reales.

## 3. Componentes

### VictoriaLogs

- single-node;
- puerto interno `9428`;
- retención de 30 días;
- máximo de datos de 12 GiB;
- memoria permitida de 512 MiB;
- volumen persistente `victoria-logs-data`;
- sin `ports` publicados.

### vmauth

- puerto publicable por Coolify `8427`, dedicado exclusivamente al proxy autenticado;
- API nativa (`/metrics`, `/flags`, pprof y reload) separada en `127.0.0.1:8428` dentro del contenedor;
- usuario de consulta limitado a `/select/*`;
- usuario de ingesta limitado a `/insert/*`;
- `/health` sin autenticación y anclado exactamente;
- sin publicación de `/internal/*` ni `/metrics`;
- configuración generada runtime en volumen `vmauth-config`.

### config-init

- proceso one-shot;
- consume secretos mediante `/run/secrets`;
- genera `vmauth.yaml` con modo `0600`;
- termina antes de iniciar `vmauth`;
- read-only, sin capabilities y con `no-new-privileges`.

## 4. Capacidad inicial

| Recurso | Valor |
|---|---:|
| Host | Shared CPU amd64 |
| vCPU | 1 |
| RAM | 1 GB + swap de emergencia |
| SSD | 25 GB |
| Datos VictoriaLogs | máximo 12 GiB |
| Retención | 30 días |
| Cache permitida | 512 MiB |

El límite de 12 GiB conserva margen para SO, runtime de Coolify, proxy, imágenes, snapshots temporales y logs locales. Antes de ampliar capacidad se medirán siete días de uso real en staging.

## 5. Seguridad

- Lectura e ingesta usan usuarios y contraseñas distintos.
- Contraseñas mínimas de 24 caracteres.
- Secretos en archivos host regulares, propiedad de root y modo `0600`, fuera de Git y de los build args.
- `VICTORIALOGS_SECRETS_DIR` es la única variable de despliegue y contiene una ruta no sensible.
- `vmauth-config` se considera almacenamiento secreto y se regenera al rotar credenciales.
- VictoriaLogs no publica puertos del host.
- Coolify es responsable del dominio, TLS y reverse proxy.
- El primer despliegue usa credenciales sintéticas y no incorpora datos reales.

### Gate de secretos de Coolify

El gate de archivos host exige el directorio privado, cuatro archivos regulares sin symlinks, permisos sin acceso de grupo/otros, propietario esperado, contraseñas mínimas y credenciales distintas.

Después del deployment, el gate de `docker inspect` recibe el nombre exacto del proyecto Compose y evidencia protegida. Exige exactamente un contenedor para cada servicio:

```text
config-init,victoria-logs,vmauth
```

Falla ante:

- evidencia vacía, parcial o malformada;
- `config-init` omitido por estar detenido;
- servicio ausente, duplicado o desconocido;
- labels Compose faltantes;
- mezcla de `com.docker.compose.project`;
- `Config.Env` ausente, mal tipado o con entradas no-string;
- cualquier `VMAUTH_*` sensible presente en `Config.Env`.

Los errores nunca imprimen valores ni nombres de contenedor.

## 6. Backups

R2 permanece deshabilitado en esta fase. Si se aprueba después:

1. crear snapshot de una partición diaria;
2. copiar con herramienta dedicada;
3. verificar integridad;
4. eliminar snapshot local;
5. probar restauración en instancia temporal aislada.

Los endpoints internos de snapshot nunca se publican mediante `vmauth`.

## 7. Monitoreo central

Desde fuera de VictoriaLogs se vigilarán:

- `/health`;
- disco libre y estado read-only;
- CPU, RAM y reinicios;
- antigüedad de backups cuando se habiliten.

Una caída del sistema de logs no debe ocultar su propia alerta.

## 8. Roadmap separado

1. Limpiar el inventario de logs de Cartera.
2. Definir logger estructurado de aplicación y catálogos finitos.
3. Implementar `request_id` y `operation_id` con pseudonimización keyed.
4. Diseñar agente Vector sin acceso directo al socket.
5. Incorporar telemetría frontend con esquema cerrado.
6. Ejecutar piloto en Cartera staging.
7. Incorporar servicios gradualmente.

El inventario, IaC central, agente, logger compartido y migraciones por aplicación se entregan en PRs separados.

## 9. Criterios de aceptación de esta fase

- Compose central valida con Podman.
- Renderer genera configuración `0600` sin imprimir secretos.
- `vmauth -dryRun` pasa.
- Smoke local verifica salud, ingesta, consulta y separación read/write.
- Coolify expone únicamente `vmauth` mediante HTTPS.
- VictoriaLogs no tiene puertos publicados.
- Endpoints internos no son públicos.
- Retención y límites corresponden al host de 25 GB.
- Gate de staging pasa con evidencia completa del proyecto correcto.
- No existe configuración de Vector ni montaje de socket en este PR.

## 10. Fuentes

- https://docs.victoriametrics.com/victorialogs/
- https://docs.victoriametrics.com/victorialogs/security-and-lb/
- https://docs.victoriametrics.com/victorialogs/keyconcepts/
- https://docs.podman.io/
