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
  verificar_constraints "$url" "$schema" "$dir"
}

# Comprueba que TODAS las constraints que las migraciones dicen crear existan
# de verdad en el schema destino. La lista sale de los propios archivos, así
# que se mantiene sola.
#
# Por qué hace falta: los bloques `IF NOT EXISTS (SELECT 1 FROM pg_constraint
# WHERE conname = …)` comparaban solo el NOMBRE, y `conname` no es único por
# base sino por tabla. Preparando `<schema>_nuevo` al lado del sandbox vivo,
# las constraints homónimas del vivo daban el IF por satisfecho y las del nuevo
# NUNCA se creaban; el swap promovía tablas sin sus FKs ni sus CHECK, en
# silencio (review de Codex, P1). Los bloques ya quedaron acotados por
# `conrelid`, y esto es la red que lo detecta si vuelve a pasar.
#   uso: verificar_constraints URL SCHEMA DIR_COBROS02
verificar_constraints() {
  local url="$1" schema="$2" dir="$3" esperadas faltan
  esperadas="$(grep -rh "ADD CONSTRAINT" "$dir"/0*.sql \
    | sed -E 's/.*ADD CONSTRAINT ([a-z0-9_]+).*/\1/' | sort -u | paste -sd,)"
  [[ -n "$esperadas" ]] || return 0
  faltan="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -v schema="$schema" -v esperadas="$esperadas" <<'SQL'
SELECT string_agg(e.nombre, ', ' ORDER BY e.nombre)
FROM unnest(string_to_array(:'esperadas', ',')) AS e(nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = :'schema' AND c.conname = e.nombre
);
SQL
)"
  if [[ -n "$faltan" ]]; then
    die "Al schema $schema le faltan constraints que las migraciones debían crear: $faltan. No se sigue (un swap acá promovería tablas sin sus FKs ni sus CHECK)."
  fi
  echo "· constraints verificadas en $schema: $(tr ',' '\n' <<<"$esperadas" | wc -l)"
}

# `sslrootcert=system` lo entiende libpq (psql/pg_dump) y evita tener que crear
# ~/.postgresql/root.crt, pero la librería `pg` de Node lo toma como NOMBRE DE
# ARCHIVO y muere con ENOENT: 'system'. Se quita antes de dársela al motor;
# cartera-back ya fija ssl.rejectUnauthorized=false por su cuenta.
#   uso: URL_MOTOR="$(url_para_node "$URL")"
#
# Ojo con el delimitador: si `sslrootcert` es el PRIMER parámetro, borrarlo junto
# con su `?` deja `…/db&sslmode=require` y Node toma todo eso como nombre de la
# base. Por eso son dos reglas: la primera lo quita cuando tiene algo detrás y
# conserva el delimitador de adelante; la segunda lo quita cuando es el último
# (y ahí sí se lleva su propio delimitador).
url_para_node() {
  sed -E 's/([?&])sslrootcert=[^&]*&/\1/; s/[?&]sslrootcert=[^&]*$//' <<<"$1"
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

# Cuando el destino es OTRA BASE, un `pg_dump --schema=cartera` no se lleva lo
# que vive fuera de ese schema y del que igual depende: los ENUM de `public`
# que usan varias columnas (payment_validation_status, estado_liquidacion,
# tipo_cuenta_enum) y las extensiones. Sin ellos el restore falla al crear las
# tablas y se cae en cascada (está en el runbook, y el flujo "otra base" se
# anunciaba sin verificarlo — review de Codex, P2).
#
# No se crean solos a propósito: `public` puede ser de otra aplicación (en la
# Neon de dev es del CRM). Se detecta lo que falta y se entrega el SQL exacto.
#   uso: verificar_dependencias_externas URL_ORIGEN URL_DESTINO SCHEMA_ORIGEN
verificar_dependencias_externas() {
  local origen="$1" destino="$2" schema="$3" tipos faltan sql

  # Tipos de usuario que las columnas de <schema> toman de otros schemas.
  tipos="$(psql "$origen" -X -At -v ON_ERROR_STOP=1 -v schema="$schema" <<'SQL'
SELECT string_agg(DISTINCT c.udt_schema || '.' || c.udt_name, ',')
FROM information_schema.columns c
JOIN pg_type t ON t.typname = c.udt_name
JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = c.udt_schema
WHERE c.table_schema = :'schema'
  AND c.udt_schema NOT IN (:'schema', 'pg_catalog', 'information_schema')
  AND t.typtype = 'e';
SQL
)"
  [[ -n "$tipos" ]] || return 0

  faltan="$(psql "$destino" -X -At -v ON_ERROR_STOP=1 -v tipos="$tipos" <<'SQL'
SELECT string_agg(x.nombre, ',' ORDER BY x.nombre)
FROM unnest(string_to_array(:'tipos', ',')) AS x(nombre)
WHERE to_regtype(x.nombre) IS NULL;
SQL
)"
  [[ -n "$faltan" ]] || { echo "· dependencias externas presentes en el destino: $tipos"; return 0; }

  echo "✖ Al destino le faltan tipos de los que depende $schema: $faltan" >&2
  echo "  Se crean con esto (revisá antes: 'public' puede ser de otra aplicación):" >&2
  psql "$origen" -X -At -v ON_ERROR_STOP=1 -v faltan="$faltan" <<'SQL' >&2
SELECT '    CREATE TYPE ' || n.nspname || '.' || t.typname || ' AS ENUM (' ||
       string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) || ');'
FROM unnest(string_to_array(:'faltan', ',')) AS x(nombre)
JOIN pg_type t ON t.oid = x.nombre::regtype
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
GROUP BY n.nspname, t.typname;
SQL
  die "Faltan dependencias fuera de $schema en el destino. Creálas y repetí."
}

# Corre los dos motores contra URL/SCHEMA y EXIGE que hayan hecho su trabajo.
# Compartida por la alineación y por la fase `motores` de la carga inicial: que
# una validara y la otra no era justamente el hueco (review de Codex, P2).
#
# "Corrió pero no hizo nada" no puede pasar por bueno:
#  · skipped → otra corrida tenía el advisory lock (el job programado en la
#    misma base, u otra alineación). No se registró ni una transición.
#  · sin `buckets` → procesarMoras salió por una rama que no ejecuta el pass.
#  · omitidoPorFallback → el catálogo vino inconsistente y el pass se salteó a
#    propósito para no escribir historial con rangos que no son.
#  · sinPoolDestino > 0 → hubo créditos que cambiaron de bucket y conservaron
#    su asesor viejo porque el bucket destino no tiene a nadie en el pool.
#  · el try/catch de latefee.ts se traga los errores del pass sin cambiar el
#    código de salida ni los contadores: su única huella es esa línea del log.
#   uso: correr_motores URL SCHEMA DIR_CARTERA_BACK ARCHIVO_LOG
correr_motores() {
  local url="$1" schema="$2" cartera_back="$3" log="$4"
  command -v bun >/dev/null || die "Falta bun (o correr sin la fase de motores y dispararlos aparte)."
  local url_motor; url_motor="$(url_para_node "$url")"
  if ! ( cd "$cartera_back" && SUPABASE_DB_URL="$url_motor" CARTERA_SCHEMA="$schema" bun -e '
      // Cinturón: el motor ESCRIBE. Si la cadena apunta a producción, no corre.
      const url = process.env.SUPABASE_DB_URL ?? "";
      if (/supabase\.(com|co)/.test(url)) { console.error("El motor apunta a Supabase; abortado."); process.exit(1); }

      const { procesarMoras } = await import("./src/controllers/latefee");
      const { procesarBucketsConvenio } = await import("./src/controllers/bucketsConvenio");

      const moras = await procesarMoras();
      console.log("RESUMEN moras:", JSON.stringify(moras.buckets ?? moras));
      const convenio = await procesarBucketsConvenio();
      console.log("RESUMEN convenio:", JSON.stringify(convenio));

      const problemas = [];
      if (moras?.skipped) problemas.push("procesarMoras se omitió (advisory lock tomado por otra corrida)");
      if (!moras?.skipped && !moras?.buckets) problemas.push("procesarMoras no devolvió el resumen de buckets");
      if (moras?.buckets?.omitidoPorFallback) problemas.push("el pass de buckets se omitió por catálogo inconsistente");
      if (convenio?.skipped) problemas.push("procesarBucketsConvenio se omitió (advisory lock tomado)");
      if (convenio?.omitidoPorFallback) problemas.push("los buckets de convenio se omitieron por catálogo inconsistente");
      // sinPoolDestino > 0 = ese crédito cambió de bucket pero se quedó con su
      // asesor viejo porque el bucket destino no tiene pool activo. En los
      // EN_CONVENIO no lo repara nadie después: el `02` los excluye.
      if (moras?.buckets?.sinPoolDestino > 0) problemas.push(`${moras.buckets.sinPoolDestino} crédito(s) cambiaron de bucket sin pool destino (mora)`);
      if (convenio?.sinPoolDestino > 0) problemas.push(`${convenio.sinPoolDestino} crédito(s) en convenio sin pool destino`);
      if (problemas.length) { console.error("MOTOR INCOMPLETO: " + problemas.join(" · ")); process.exit(1); }
      process.exit(0);
    ' ) > "$log" 2>&1; then
    echo "── últimas líneas del motor ──"; tail -25 "$log"
    die "El motor falló o quedó incompleto sobre $schema. No se sigue."
  fi
  if grep -q "Error registrando transiciones de bucket" "$log"; then
    grep -A3 "Error registrando transiciones de bucket" "$log" | head -8
    die "El pass de buckets falló dentro de procesarMoras (lo atrapa su try/catch). No se sigue."
  fi
  grep -E "^RESUMEN " "$log" | sed 's/^/· /'
  echo "· log completo del motor: $log"
}