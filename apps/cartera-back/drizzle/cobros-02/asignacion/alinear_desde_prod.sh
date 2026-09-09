#!/usr/bin/env bash
# =============================================================================
# COBROS-02 · Alinear el sandbox con PRODUCCIÓN (a demanda, nunca programado)
# =============================================================================
# Trae los datos de producción (Supabase) al sandbox de Neon conservando el
# historial de COBROS-02, y CORRE EL MOTOR para que los buckets se pongan al
# día con la realidad de prod.
#
# El motor es la pieza importante. Copiar los datos no mueve ningún bucket: el
# bucket vive en `buckets_historial` y solo cambia cuando el motor registra la
# transición. Ejemplo del caso típico:
#
#   El sandbox tiene un crédito en B1 (1 cuota atrasada, asesor de B1).
#   En producción el cliente YA pagó y contabilidad validó el pago.
#   → se copian los datos: la cuota llega pagada, pero el historial sigue en B1
#   → corre el motor: cuenta 0 cuotas atrasadas → BAJADA B1 → B0
#     + reasignación al asesor de B0 + fila en las dos bitácoras.
#
# Es decir: cada corrida deja registrado el movimiento REAL que hubo en la
# cartera desde la última vez, no un salto silencioso.
#
# Qué conserva del sandbox (lo que producción no tiene): el catálogo `buckets`
# afinado (dias_sla, colores), el pool `asesor_bucket`, `buckets_historial`,
# `credito_asesor_historial`, `promesas_pago_espejo`, el ledger de Págalo, los
# traslados, y el DUEÑO de cada crédito (`creditos.asesor_id`), que en el
# sandbox lo puso el motor por bucket y en producción sigue siendo el viejo.
#
# Qué NO conserva: los pagos y boletas de prueba registrados en el sandbox
# (vuelven a ser los de producción).
#
# Pasos:
#   1. pg_dump de PRODUCCIÓN (solo lectura) → schema de trabajo `<schema>_nuevo`
#   2. Migraciones del bloque cobros-02 sobre `_nuevo`
#   3. Trasplante del sandbox vivo → `_nuevo` (historial, pool, catálogo, dueños)
#   4. `03` línea base para créditos nuevos + `04` backfill  [+ `01` si se pasa --pool]
#   5. MOTOR sobre `_nuevo`: procesarMoras (buckets + reasignación) y convenios
#   6. `02` con conservar=1: alinea los residuos que el motor no toca
#      (créditos con capital 0, buckets sin pool)
#   7. Swap por rename + retención de backups
#
# Uso:
#   alinear_desde_prod.sh --prod URL_SUPABASE --neon URL_DIRECTA_NEON \
#                         [--schema cartera_cobros2] [--prod-schema cartera] \
#                         [--pool pool.csv] [--retencion 2] [--sin-swap] \
#                         [--sin-motor] [--post-swap-cmd "curl ..."] [--dump-dir DIR]
#
#   Sin --prod/--neon toma COBROS02_PROD_URL / COBROS02_NEON_URL del entorno.
#   --sin-swap    deja el resultado en `<schema>_nuevo` sin cambiarlo por el vivo
#   --sin-motor   omite el paso 5 (los buckets NO se mueven; solo para depurar)
#   --pool CSV    además re-arma el pool desde el CSV. Sin esto, se conserva el
#                 pool que ya tenía el sandbox
#
# Reglas duras:
#   · A producción SOLO se le hace pg_dump. Jamás psql, restore, DDL ni el motor.
#   · El destino tiene que ser Neon por conexión DIRECTA (host sin "-pooler").
#   · Solo se borran schemas con el patrón `<schema>_bk_YYYYMMDD_HHMM`.
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COBROS02_DIR="$(cd "$AQUI/.." && pwd)"
DRIZZLE_DIR="$(cd "$COBROS02_DIR/.." && pwd)"
CARTERA_BACK="$(cd "$DRIZZLE_DIR/.." && pwd)"
# shellcheck source=_lib.sh
source "$AQUI/_lib.sh"

PROD="${COBROS02_PROD_URL:-}"; PROD_SCHEMA="cartera"
NEON="${COBROS02_NEON_URL:-}"; SCHEMA="cartera_cobros2"
RETENCION=2; POOL_CSV=""; SIN_SWAP=0; SIN_MOTOR=0; POST_SWAP_CMD=""; DUMP_DIR=""

uso() { sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod)          PROD="$2"; shift 2 ;;
    --prod-schema)   PROD_SCHEMA="$2"; shift 2 ;;
    --neon)          NEON="$2"; shift 2 ;;
    --schema)        SCHEMA="$2"; shift 2 ;;
    --retencion)     RETENCION="$2"; shift 2 ;;
    --pool)          POOL_CSV="$2"; shift 2 ;;
    --sin-swap)      SIN_SWAP=1; shift ;;
    --sin-motor)     SIN_MOTOR=1; shift ;;
    --post-swap-cmd) POST_SWAP_CMD="$2"; shift 2 ;;
    --dump-dir)      DUMP_DIR="$2"; shift 2 ;;
    -h|--help)       uso 0 ;;
    *) die "Opción desconocida: $1 (ver --help)" ;;
  esac
done

[[ -n "$PROD" ]] || die "Falta --prod (o COBROS02_PROD_URL): la cadena de producción, solo lectura"
[[ -n "$NEON" ]] || die "Falta --neon (o COBROS02_NEON_URL): la cadena DIRECTA de Neon"
[[ "$SCHEMA" != "cartera" ]] || die "El sandbox no puede llamarse 'cartera'."
[[ -z "$POOL_CSV" || -f "$POOL_CSV" ]] || die "No existe el CSV del pool: $POOL_CSV"
for h in psql pg_dump perl; do command -v "$h" >/dev/null || die "Falta $h en el PATH"; done

exigir_directo "$NEON"
NEON_HOST="$(host_de "$NEON")"; PROD_HOST="$(host_de "$PROD")"
# El destino JAMÁS puede ser producción: acá se escribe, se renombran schemas y
# corre el motor. Dirección única prod → sandbox.
[[ "$NEON_HOST" == *supabase* ]] && die "El destino ($NEON_HOST) es Supabase. La alineación escribe: el destino es el sandbox, nunca producción."
[[ "$PROD" == "$NEON" ]] && die "Origen y destino son la misma cadena."

NUEVO="${SCHEMA}_nuevo"
STAMP="$(TZ=America/Guatemala date +%Y%m%d_%H%M)"
BK="${SCHEMA}_bk_${STAMP}"
DUMP_DIR="${DUMP_DIR:-$PWD/tmp-alineacion-$STAMP}"
mkdir -p "$DUMP_DIR"
exec > >(tee -a "$DUMP_DIR/alineacion.log") 2>&1

pn() { psql "$NEON" -X -v ON_ERROR_STOP=1 "$@"; }
schema_existe() { pn -At -c "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '$1')"; }

echo "COBROS-02 · alineación desde producción · $STAMP (GT)"
echo "  origen  : $PROD_HOST · schema $PROD_SCHEMA (SOLO pg_dump)"
echo "  destino : $NEON_HOST · vivo=$SCHEMA · trabajo=$NUEVO · backup=$BK"
echo "  pool    : ${POOL_CSV:-(se conserva el del sandbox)} · motor: $([[ $SIN_MOTOR -eq 1 ]] && echo NO || echo sí) · swap: $([[ $SIN_SWAP -eq 1 ]] && echo NO || echo sí)"

[[ "$(schema_existe "$SCHEMA")" == "t" ]] || die "No existe $SCHEMA en el destino: primero la carga inicial (carga_inicial.sh)."

# ── 1. Dump de producción → schema de trabajo ───────────────────────────────
log "1 · dump de producción → $NUEVO"
if [[ "$(schema_existe "$NUEVO")" == "t" ]]; then
  echo "· $NUEVO existía (corrida anterior a medias): se descarta"
  pn -q -o /dev/null -c "DROP SCHEMA \"$NUEVO\" CASCADE" 2>&1 | grep -v "^DETALLE:\|^drop cascades" || true
fi
pg_dump "$PROD" --schema="$PROD_SCHEMA" --no-owner --no-privileges -Fp > "$DUMP_DIR/prod.sql"
renombrar_dump "$PROD_SCHEMA" "$NUEVO" < "$DUMP_DIR/prod.sql" > "$DUMP_DIR/nuevo.sql"
pn -1 -q -o /dev/null -f "$DUMP_DIR/nuevo.sql"
pn -At -c "SELECT '· '||count(*)||' créditos, '||(SELECT count(*) FROM \"$NUEVO\".pagos_credito)||' pagos, última mora del '||(SELECT max(created_at)::date FROM \"$NUEVO\".moras_credito) FROM \"$NUEVO\".creditos"

# ── 2. Migraciones ──────────────────────────────────────────────────────────
log "2 · migraciones cobros-02 sobre $NUEVO"
aplicar_migraciones "$NEON" "$NUEVO" "$COBROS02_DIR" "$DRIZZLE_DIR" 2>&1 | grep -v "NOTICE:" || true

# ── 3. Trasplante del sandbox vivo ──────────────────────────────────────────
log "3 · trasplante $SCHEMA → $NUEVO (historial, pool, catálogo, dueños)"
pn -v viejo="$SCHEMA" -v nuevo="$NUEVO" <<'SQL'
BEGIN;
SET LOCAL search_path TO :"nuevo";

-- Copia genérica de una tabla exclusiva de COBROS-02 con las columnas que
-- existan en AMBOS lados (sobrevive a columnas nuevas) y un filtro de huérfanos.
-- Los schemas van como parámetros: psql no interpola :variables dentro de $$.
-- Los ENUM viven en cada schema, así que las columnas de tipo propio se
-- castean vía text al tipo homónimo del destino.
CREATE OR REPLACE FUNCTION pg_temp.trasplantar(viejo text, nuevo text, tabla text, filtro text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE cols text; exprs text; n bigint;
BEGIN
  SELECT string_agg(quote_ident(a.column_name), ', ' ORDER BY a.ordinal_position),
         string_agg(CASE WHEN a.udt_schema = viejo
                         THEN format('v.%I::text::%I.%I', a.column_name, nuevo, a.udt_name)
                         ELSE format('v.%I', a.column_name) END, ', ' ORDER BY a.ordinal_position)
    INTO cols, exprs
  FROM information_schema.columns a
  JOIN information_schema.columns b
    ON b.table_schema = nuevo AND b.table_name = a.table_name AND b.column_name = a.column_name
  WHERE a.table_schema = viejo AND a.table_name = tabla;
  EXECUTE format('INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I v WHERE %s',
                 nuevo, tabla, cols, exprs, viejo, tabla, filtro);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Secuencia al máximo insertado (si no, el próximo INSERT del motor choca).
CREATE OR REPLACE FUNCTION pg_temp.resetear_seq(nuevo text, tabla text, col text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE seq text;
BEGIN
  seq := pg_get_serial_sequence(format('%I.%I', nuevo, tabla), col);
  IF seq IS NOT NULL THEN
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I.%I), 0) + 1, false)', seq, col, nuevo, tabla);
  END IF;
END $$;

-- 3a. Catálogo: gana el del sandbox (dias_sla, colores, nombres afinados).
UPDATE :"nuevo".buckets n SET
  prefijo = v.prefijo, nombre = v.nombre, descripcion = v.descripcion,
  cuotas_min = v.cuotas_min, cuotas_max = v.cuotas_max, estados_incluidos = v.estados_incluidos,
  es_operativo = v.es_operativo, orden = v.orden, color = v.color, estado_mora = v.estado_mora,
  dias_sla = v.dias_sla, activo = v.activo, updated_at = now()
FROM :"viejo".buckets v WHERE v.numero = n.numero;

-- 3b. Tablas exclusivas, en orden de FKs. Huérfano = apunta a un crédito/asesor
--     que ya no existe en producción: se deja fuera y se cuenta. Las FKs
--     opcionales (asesor de atribución, pago de la BAJADA, usuario de la
--     bitácora) van a NULL si su fila ya no existe — mismo efecto que su
--     ON DELETE SET NULL, pero validado ANTES del INSERT.
\echo '· asesor_bucket'
SELECT pg_temp.trasplantar(:'viejo', :'nuevo', 'asesor_bucket',
  format('EXISTS (SELECT 1 FROM %I.asesores a WHERE a.asesor_id = v.asesor_id)', :'nuevo')) AS copiadas,
  (SELECT count(*) FROM :"viejo".asesor_bucket) AS en_sandbox;

\echo '· buckets_historial'
INSERT INTO :"nuevo".buckets_historial
  (historial_id, credito_id, bucket_anterior, bucket_nuevo, tipo_evento, origen,
   cuotas_atrasadas_nuevas, status_credito, asesor_id, pago_id, motivo, fecha)
SELECT v.historial_id, v.credito_id, v.bucket_anterior, v.bucket_nuevo,
       v.tipo_evento::text::bucket_evento_tipo, v.origen::text::bucket_evento_origen,
       v.cuotas_atrasadas_nuevas, v.status_credito,
       CASE WHEN EXISTS (SELECT 1 FROM :"nuevo".asesores a WHERE a.asesor_id = v.asesor_id) THEN v.asesor_id END,
       CASE WHEN EXISTS (SELECT 1 FROM :"nuevo".pagos_credito p WHERE p.pago_id = v.pago_id) THEN v.pago_id END,
       v.motivo, v.fecha
FROM :"viejo".buckets_historial v
WHERE EXISTS (SELECT 1 FROM :"nuevo".creditos c WHERE c.credito_id = v.credito_id);
SELECT (SELECT count(*) FROM :"nuevo".buckets_historial) AS copiadas,
       (SELECT count(*) FROM :"viejo".buckets_historial) AS en_sandbox;

\echo '· credito_asesor_historial'
INSERT INTO :"nuevo".credito_asesor_historial
  (historial_id, credito_id, asesor_anterior, asesor_nuevo, bucket, origen, motivo, usuario_id, fecha)
SELECT v.historial_id, v.credito_id,
       CASE WHEN EXISTS (SELECT 1 FROM :"nuevo".asesores a WHERE a.asesor_id = v.asesor_anterior) THEN v.asesor_anterior END,
       CASE WHEN EXISTS (SELECT 1 FROM :"nuevo".asesores a WHERE a.asesor_id = v.asesor_nuevo) THEN v.asesor_nuevo END,
       v.bucket, v.origen::text::credito_asesor_origen, v.motivo,
       CASE WHEN EXISTS (SELECT 1 FROM :"nuevo".platform_users u WHERE u.id = v.usuario_id) THEN v.usuario_id END,
       v.fecha
FROM :"viejo".credito_asesor_historial v
WHERE EXISTS (SELECT 1 FROM :"nuevo".creditos c WHERE c.credito_id = v.credito_id);
SELECT (SELECT count(*) FROM :"nuevo".credito_asesor_historial) AS copiadas,
       (SELECT count(*) FROM :"viejo".credito_asesor_historial) AS en_sandbox;

\echo '· promesas_pago_espejo'
SELECT pg_temp.trasplantar(:'viejo', :'nuevo', 'promesas_pago_espejo',
  format('EXISTS (SELECT 1 FROM %I.creditos c WHERE c.credito_id = v.credito_id)', :'nuevo')) AS copiadas,
  (SELECT count(*) FROM :"viejo".promesas_pago_espejo) AS en_sandbox;

\echo '· pagalo_payment_imports'
SELECT pg_temp.trasplantar(:'viejo', :'nuevo', 'pagalo_payment_imports',
  format('v.credito_id IS NULL OR EXISTS (SELECT 1 FROM %I.creditos c WHERE c.credito_id = v.credito_id AND c.numero_credito_sifco = v.numero_credito_sifco)', :'nuevo')) AS copiadas,
  (SELECT count(*) FROM :"viejo".pagalo_payment_imports) AS en_sandbox;

\echo '· operaciones_traslado_cartera (+ detalle)'
SELECT pg_temp.trasplantar(:'viejo', :'nuevo', 'operaciones_traslado_cartera',
  format('EXISTS (SELECT 1 FROM %I.asesores a WHERE a.asesor_id = v.asesor_origen_id)', :'nuevo')) AS copiadas,
  (SELECT count(*) FROM :"viejo".operaciones_traslado_cartera) AS en_sandbox;
SELECT pg_temp.trasplantar(:'viejo', :'nuevo', 'operaciones_traslado_cartera_detalle',
  format('EXISTS (SELECT 1 FROM %1$I.operaciones_traslado_cartera o WHERE o.id = v.operacion_id)
      AND EXISTS (SELECT 1 FROM %1$I.creditos c WHERE c.credito_id = v.credito_id)
      AND EXISTS (SELECT 1 FROM %1$I.asesores a WHERE a.asesor_id = v.asesor_nuevo_id)
      AND (v.asesor_anterior_id IS NULL OR EXISTS (SELECT 1 FROM %1$I.asesores a WHERE a.asesor_id = v.asesor_anterior_id))', :'nuevo')) AS copiadas,
  (SELECT count(*) FROM :"viejo".operaciones_traslado_cartera_detalle) AS en_sandbox;

SELECT pg_temp.resetear_seq(:'nuevo', 'asesor_bucket', 'id');
SELECT pg_temp.resetear_seq(:'nuevo', 'buckets_historial', 'historial_id');
SELECT pg_temp.resetear_seq(:'nuevo', 'credito_asesor_historial', 'historial_id');
SELECT pg_temp.resetear_seq(:'nuevo', 'promesas_pago_espejo', 'promesa_espejo_id');

-- 3c. Dueños: el crédito conserva el asesor que tenía en el sandbox (lo puso
--     el motor/carga por bucket); producción trae al asesor viejo. Solo si ese
--     asesor sigue existiendo.
WITH cambiados AS (
  UPDATE :"nuevo".creditos c SET asesor_id = v.asesor_id
  FROM :"viejo".creditos v
  WHERE v.credito_id = c.credito_id
    AND v.asesor_id IS DISTINCT FROM c.asesor_id
    AND EXISTS (SELECT 1 FROM :"nuevo".asesores a WHERE a.asesor_id = v.asesor_id)
  RETURNING 1
)
SELECT count(*) AS duenos_conservados_del_sandbox FROM cambiados;

SELECT (SELECT count(*) FROM :"nuevo".creditos) AS creditos_prod,
       (SELECT count(*) FROM :"nuevo".creditos c WHERE NOT EXISTS (SELECT 1 FROM :"viejo".creditos v WHERE v.credito_id = c.credito_id)) AS creditos_nuevos,
       (SELECT count(*) FROM :"viejo".creditos v WHERE NOT EXISTS (SELECT 1 FROM :"nuevo".creditos c WHERE c.credito_id = v.credito_id)) AS creditos_que_ya_no_estan;
COMMIT;
SQL

# ── 4. Línea base de los créditos nuevos + backfill ─────────────────────────
log "4 · línea base de créditos nuevos + backfill de convenios"
{
  echo "BEGIN;"
  if [[ -n "$POOL_CSV" ]]; then
    echo "\\echo '--- 01 pool desde CSV ---'"
    sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$AQUI/01_pool_asesor_bucket.sql"
  fi
  for f in 03_linea_base_historial.sql 04_backfill_cuotas_convenio.sql; do
    echo "\\echo '--- $f ---'"
    sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$AQUI/$f"
  done
  echo "COMMIT;"
} | pn -v schema="$NUEVO" -v pool_csv="${POOL_CSV:-pool.csv}" -f - | sed '/^SET$/d;/^CREATE TABLE$/d;/^DO$/d;/^BEGIN$/d;/^COMMIT$/d'

# ── 5. El motor: acá se mueven los buckets ──────────────────────────────────
# Sin este paso los datos quedan al día pero los buckets siguen describiendo el
# pasado (el crédito que ya pagó seguiría en B1). El motor cuenta las cuotas
# vencidas reales, escribe SUBIDA/BAJADA y reasigna al asesor del bucket nuevo.
if [[ $SIN_MOTOR -eq 1 ]]; then
  log "5 · --sin-motor: los buckets NO se mueven en esta corrida"
else
  log "5 · motor sobre $NUEVO (procesarMoras + buckets de convenio)"
  command -v bun >/dev/null || die "Falta bun (o correr con --sin-motor y disparar el motor aparte)"
  # `sslrootcert=system` lo entiende libpq (psql), pero la librería `pg` de Node
  # lo toma como ruta de archivo y revienta con ENOENT: 'system'. Se quita para
  # el motor; cartera-back ya fija ssl.rejectUnauthorized=false por su cuenta.
  URL_MOTOR="$(sed -E 's/[?&]sslrootcert=[^&]*//; s/\?&/?/; s/[?&]$//' <<<"$NEON")"
  if ! ( cd "$CARTERA_BACK" && SUPABASE_DB_URL="$URL_MOTOR" CARTERA_SCHEMA="$NUEVO" bun -e '
      // Cinturón: el motor ESCRIBE. Si por lo que sea la cadena apunta a
      // producción, o el schema no es el de trabajo, no se corre.
      const url = process.env.SUPABASE_DB_URL ?? "";
      if (/supabase\.(com|co)/.test(url)) { console.error("El motor apunta a Supabase; abortado."); process.exit(1); }
      if (!/_nuevo$/.test(process.env.CARTERA_SCHEMA ?? "")) { console.error("CARTERA_SCHEMA no es el schema de trabajo; abortado."); process.exit(1); }
      const { procesarMoras } = await import("./src/controllers/latefee");
      const { procesarBucketsConvenio } = await import("./src/controllers/bucketsConvenio");
      const moras = await procesarMoras();
      console.log("RESUMEN moras:", JSON.stringify(moras.buckets ?? moras));
      console.log("RESUMEN convenio:", JSON.stringify(await procesarBucketsConvenio()));
      process.exit(0);
    ' ) > "$DUMP_DIR/motor.log" 2>&1; then
    echo "── últimas líneas del motor ──"; tail -25 "$DUMP_DIR/motor.log"
    die "El motor falló. $NUEVO queda para inspección y NO se hizo swap: el sandbox vivo sigue intacto."
  fi
  grep -E "^RESUMEN " "$DUMP_DIR/motor.log" | sed 's/^/· /'
  echo "· log completo del motor: $DUMP_DIR/motor.log"
fi

# ── 6. Residuos que el motor no toca ────────────────────────────────────────
log "6 · alinear residuos (02 con conservar=1)"
{
  echo "BEGIN;"
  sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$AQUI/02_asignar_asesores_creditos.sql"
  echo "COMMIT;"
} | pn -v schema="$NUEVO" -v conservar=1 -f - | sed '/^SET$/d;/^CREATE TABLE$/d;/^DO$/d;/^BEGIN$/d;/^COMMIT$/d;/^SELECT [0-9]*$/d'

# ── 7. Swap ─────────────────────────────────────────────────────────────────
if [[ $SIN_SWAP -eq 1 ]]; then
  log "7 · --sin-swap: el resultado queda en $NUEVO; $SCHEMA sigue intacto"
  verificar_schema "$NEON" "$NUEVO"
  exit 0
fi
log "7 · swap: $SCHEMA → $BK · $NUEVO → $SCHEMA"
pn -q -o /dev/null -c "BEGIN; ALTER SCHEMA \"$SCHEMA\" RENAME TO \"$BK\"; ALTER SCHEMA \"$NUEVO\" RENAME TO \"$SCHEMA\"; COMMIT;"

log "retención · conservar los últimos $RETENCION backups ${SCHEMA}_bk_YYYYMMDD_HHMM"
for viejo_bk in $(pn -At -c "SELECT nspname FROM pg_namespace WHERE nspname ~ '^${SCHEMA}_bk_[0-9]{8}_[0-9]{4}\$' ORDER BY nspname DESC OFFSET $RETENCION"); do
  echo "· DROP SCHEMA $viejo_bk CASCADE"
  pn -q -o /dev/null -c "DROP SCHEMA \"$viejo_bk\" CASCADE" 2>&1 | grep -v "^DETALLE:\|^drop cascades" || true
done
pn -At -c "SELECT '· schemas: '||string_agg(nspname, ', ' ORDER BY nspname) FROM pg_namespace WHERE nspname LIKE '${SCHEMA}%'"

if [[ -n "$POST_SWAP_CMD" ]]; then
  log "post-swap"
  bash -c "$POST_SWAP_CMD" || echo "⚠️ el comando post-swap falló (la alineación ya quedó aplicada)"
fi

log "verificar · $SCHEMA"
verificar_schema "$NEON" "$SCHEMA"
log "listo"
echo "Reiniciar cartera-back: el swap fue por rename y sus conexiones vivas apuntan al schema anterior."
