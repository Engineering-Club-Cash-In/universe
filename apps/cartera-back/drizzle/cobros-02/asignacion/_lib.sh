# =============================================================================
# COBROS-02 · funciones compartidas por carga_inicial.sh y alinear_desde_prod.sh
# (se hace `source`, no se ejecuta)
# =============================================================================

die() { echo "✖ $*" >&2; exit 1; }
log() { echo; echo "═══ $* ═══"; }

host_de() { sed -E 's#^[a-z]+://([^@]+@)?([^/:?]+).*#\2#' <<<"$1"; }

# El destino SIEMPRE por conexión directa: un restore o un search_path sin LOCAL
# por el pooler de Neon queda pegado en backends compartidos y tumba el CRM.
exigir_directo() {
  local host; host="$(host_de "$1")"
  [[ "$host" == *-pooler* ]] && die "El destino apunta al POOLER ($host). Usá el host directo (sin '-pooler')."
  return 0
}

# Renombra el schema en un dump PLANO sin tocar el contenido de los COPY (un
# texto libre que diga "cartera." no debe cambiar). El set_config del
# search_path que emite pg_dump (sin LOCAL) se cambia por SET LOCAL: todo viene
# calificado, no hace falta, y así no queda pegado en la sesión.
#   uso: renombrar_dump ORIGEN DESTINO < dump.sql > dump-renombrado.sql
renombrar_dump() {
  perl -pe '
    BEGIN { ($o,$d)=@ARGV; @ARGV=(); }
    if ($in) { $in=0 if /^\\\.$/; next; }
    s/^SELECT pg_catalog\.set_config\(\x27search_path\x27.*$/SET LOCAL search_path TO \x27\x27;/;
    if ($o ne $d) {
      s/\b\Q$o\E\./$d./g;
      s/^(CREATE|ALTER|DROP) SCHEMA (IF NOT EXISTS |IF EXISTS )?\Q$o\E\b/$1 SCHEMA $2$d/;
      s/^-- Name: \Q$o\E;/-- Name: $d;/;
    }
    $in=1 if /^COPY .* FROM stdin;$/;
  ' "$1" "$2"
}

# Las migraciones están escritas para `cartera` (calificado, entre comillas,
# como string en DO-blocks, y 0015 con SET LOCAL search_path). Se reescriben al
# vuelo al schema pedido; con `cartera` es identidad.
#   uso: renombrar_migracion DESTINO < 00xx.sql | psql ...
renombrar_migracion() {
  local d="$1"
  if [[ "$d" == "cartera" ]]; then cat; else
    sed -E "s/\bcartera\./${d}./g; s/'cartera'/'${d}'/g; s/\"cartera\"/\"${d}\"/g; s/(search_path TO )cartera;/\1${d};/g"
  fi
}

# Aplica el bloque drizzle/cobros-02/*.sql (orden de nombre) + la 0024 de
# convenios sobre URL/SCHEMA. Idempotentes: re-aplicar no rompe.
#
# Los NOTICE de "ya existe, se omite" son ruido esperable en DDL idempotente y
# se filtran, PERO el estado que manda es el de psql, no el del filtro: se lee
# de PIPESTATUS. Con un `| grep ... || true` alrededor, una migración que falla
# dejaba pasar la corrida entera y se podía promover un schema al que le faltaba
# una tabla (review de Codex, P1).
#   uso: aplicar_migraciones URL SCHEMA DIR_COBROS02 DIR_DRIZZLE
aplicar_migraciones() {
  local url="$1" schema="$2" dir="$3" drizzle="$4" f salida
  salida="$(mktemp)"
  for f in $(ls "$dir"/0*.sql | sort) "$drizzle/0024_convenios_pago_cuotas_convenio.sql"; do
    echo "· $(basename "$f")"
    # La salida va a un archivo y DESPUÉS se filtra: así el `if !` evalúa el
    # estado real del pipeline con psql adentro. (Con `| grep … || true` el
    # `||` descarta PIPESTATUS y el fallo se perdía.)
    if ! renombrar_migracion "$schema" < "$f" | psql "$url" -X -v ON_ERROR_STOP=1 -q -f - > "$salida" 2>&1; then
      grep -v "^NOTICE:" "$salida" || true
      rm -f "$salida"
      die "La migración $(basename "$f") falló. No se sigue."
    fi
    grep -v "^NOTICE:" "$salida" || true
  done
  rm -f "$salida"
}

# `sslrootcert=system` lo entiende libpq (psql/pg_dump) y evita tener que crear
# ~/.postgresql/root.crt, pero la librería `pg` de Node lo toma como NOMBRE DE
# ARCHIVO y muere con ENOENT: 'system'. Se quita antes de dársela al motor;
# cartera-back ya fija ssl.rejectUnauthorized=false por su cuenta.
#   uso: URL_MOTOR="$(url_para_node "$URL")"
url_para_node() {
  sed -E 's/[?&]sslrootcert=[^&]*//; s/\?&/?/; s/[?&]$//' <<<"$1"
}

# Radiografía de un schema ya cargado: pool, cartera por bucket y asesor,
# funnel sin línea base, convenios sin backfill. Solo lectura (ROLLBACK).
#   uso: verificar_schema URL SCHEMA
verificar_schema() {
  psql "$1" -X -v ON_ERROR_STOP=1 -v schema="$2" <<'SQL'
BEGIN;
SET LOCAL search_path TO :"schema";
\echo '· Pool activo:'
SELECT 'B'||ab.bucket AS bucket, string_agg(a.nombre, ' + ' ORDER BY a.nombre) AS asesores
FROM asesor_bucket ab JOIN asesores a ON a.asesor_id = ab.asesor_id
WHERE ab.activo GROUP BY ab.bucket ORDER BY ab.bucket;

\echo '· Cartera por bucket (derivado como el 02) y asesor:'
WITH d AS (
  SELECT c.credito_id, c.asesor_id,
    COALESCE(
      (SELECT b.numero FROM buckets b WHERE b.activo AND c."statusCredit" = ANY (b.estados_incluidos) ORDER BY b.numero LIMIT 1),
      (SELECT b.numero FROM buckets b WHERE b.activo
         AND COALESCE(m.cuotas_atrasadas,0) >= b.cuotas_min
         AND (b.cuotas_max IS NULL OR COALESCE(m.cuotas_atrasadas,0) <= b.cuotas_max)
       ORDER BY b.numero LIMIT 1)) AS bucket
  FROM creditos c LEFT JOIN moras_credito m ON m.credito_id = c.credito_id AND m.activa
  WHERE c."statusCredit" NOT IN ('CANCELADO','PENDIENTE_CANCELACION','EN_CONVENIO','CAIDO')
)
SELECT 'B'||d.bucket AS bucket, a.nombre AS asesor, count(*) AS creditos,
       bool_or(NOT EXISTS (SELECT 1 FROM asesor_bucket ab WHERE ab.activo AND ab.asesor_id = d.asesor_id AND ab.bucket = d.bucket)) AS fuera_del_pool
FROM d JOIN asesores a ON a.asesor_id = d.asesor_id
GROUP BY d.bucket, a.nombre ORDER BY d.bucket, a.nombre;

\echo '· Créditos del funnel SIN línea base INICIAL (debe ser 0 tras el 03):'
SELECT count(*) AS funnel_sin_inicial,
       (SELECT count(*) FROM creditos WHERE "statusCredit" = 'EN_CONVENIO'
          AND NOT EXISTS (SELECT 1 FROM buckets_historial h WHERE h.credito_id = creditos.credito_id AND h.status_credito = 'EN_CONVENIO')) AS en_convenio_pendientes_del_job
FROM creditos c
WHERE c."statusCredit" NOT IN ('CANCELADO','PENDIENTE_CANCELACION','EN_CONVENIO','CAIDO')
  AND NOT EXISTS (SELECT 1 FROM buckets_historial h WHERE h.credito_id = c.credito_id);

\echo '· Historial:'
SELECT (SELECT count(*) FROM buckets_historial) AS buckets_historial,
       (SELECT count(*) FROM buckets_historial WHERE tipo_evento = 'SUBIDA') AS subidas,
       (SELECT count(*) FROM buckets_historial WHERE tipo_evento = 'BAJADA') AS bajadas,
       (SELECT count(*) FROM credito_asesor_historial) AS credito_asesor_historial;

\echo '· Convenios activos sin cuotas_convenio (los que quedan tienen las cuotas ya pagadas):'
SELECT count(*) AS sin_cuotas FROM convenios_pago WHERE completado = false AND activo AND cuotas_convenio IS NULL;
ROLLBACK;
SQL
}
