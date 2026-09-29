# Backups independientes de PostgreSQL

El workflow `.github/workflows/database-backups.yml` crea respaldos lógicos de CRM y Cartera todos los días a las 02:17 de Guatemala y los guarda en el bucket privado R2 `cashin-database-backups`.

## Retención

- `daily/`: 14 días.
- `weekly/`: 56 días.
- `monthly/`: 365 días.

Cada ejecución escribe `crm.dump`, `cartera.dump`, sus SHA-256 y, al final, `.complete`. Un prefijo sin `.complete` no es un backup válido.

## Secretos del environment `production-backups`

- `BACKUP_CRM_DATABASE_URL`
- `BACKUP_CARTERA_DATABASE_URL`
- `BACKUP_R2_ENDPOINT_URL`
- `BACKUP_R2_ACCESS_KEY_ID`
- `BACKUP_R2_SECRET_ACCESS_KEY`
- `BACKUP_SUPABASE_SSL_ROOT_CERT` — certificado oficial descargado de Database Settings.

Las URLs deben pertenecer a roles dedicados de solo lectura. La llave R2 debe tener acceso únicamente al bucket de backups. El script convierte hosts Neon `-pooler` al endpoint unpooled porque `pg_dump` y las opciones read-only no son compatibles con el pooler. CRM usa `pg_dump` 17 y Cartera usa `pg_dump` 15, igualando la versión mayor de cada servidor.

Antes de activar el workflow, configurar un bucket lock de al menos 7 días y confirmar que las credenciales de las aplicaciones no puedan borrar objetos de `cashin-database-backups`.

## Seguridad

- `default_transaction_read_only=on` en cada sesión.
- TLS `verify-full`, channel binding y CA explícita para ambas DB.
- El job valida las reglas lifecycle 14/56/365 y rechaza prefijos existentes antes del dump.
- Temporales privados eliminados mediante `trap`.
- Las URLs no aparecen en argumentos: se usa `pg_service.conf` temporal modo `0600`.
- Ambos dumps pasan `pg_restore --list` antes del upload.
- `.complete` se publica después de dumps y checksums.
- Un fallo abre o actualiza `Database backup failed`; el siguiente éxito lo cierra.

## Restauración

1. Elegir un prefijo que contenga `.complete`.
2. Descargar dumps y `.sha256` a un directorio privado.
3. Ejecutar `sha256sum -c`.
4. Restaurar CRM en PostgreSQL 17 y Cartera en una imagen Supabase PostgreSQL 15.8 con sus extensiones, usando un `pg_restore` que pueda leer la versión del archivo.
5. Reconciliar esquemas, tablas y tamaños.
6. Eliminar dumps locales y DB desechable.

Nunca restaurar sobre producción sin autorización explícita y un plan de rollback.
