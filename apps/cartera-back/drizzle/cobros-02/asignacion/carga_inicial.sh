#!/usr/bin/env bash
# =============================================================================
# COBROS-02 · Carga inicial parametrizable (copia + migraciones + asignación)
# =============================================================================
# Deja un schema de cartera listo para COBROS-02 "de cero": copia el schema
# origen al destino, aplica las migraciones del bloque cobros-02, arma el pool
# asesor↔bucket desde un CSV y reparte la cartera (02), siembra la línea base
# (03) y rellena cuotas_convenio (04).
#
# Los tres escenarios que contempla:
#   · dev      : misma base Neon, schema `cartera` → schema `cartera_cobros2`
#   · ensayo   : otra base (docker local), mismo o distinto nombre de schema
#   · prod     : misma base y mismo schema (`cartera` → `cartera`): NO copia,
#                solo migra y carga. Exige --permitir-prod.
#
# Para poner el sandbox al día con producción sin perder historial, ver
# alinear_desde_prod.sh (misma carpeta). Este script es la carga de cero.
#
# Uso:
#   carga_inicial.sh --origen URL --origen-schema cartera \
#                    --destino URL --destino-schema cartera_cobros2 \
#                    --pool pool.csv [opciones]
#
# Opciones:
#   --fases a,b,c     Subconjunto y orden de: copiar,migrar,pool,asignar,
#                     linea-base,backfill,verificar,motores
#                     (default: todas menos `motores`; ver abajo).
#   --reemplazar      Si el schema destino ya existe, DROP SCHEMA ... CASCADE
#                     antes de copiar. Jamás se permite sobre `cartera`.
#                     (Alternativa reversible: renombrarlo a mano antes.)
#   --dry-run         pool/asignar/linea-base/backfill corren y hacen ROLLBACK:
#                     imprimen sus resúmenes sin dejar nada escrito.
#   --permitir-prod   Obligatorio si el destino es un host de supabase.com.
#   --dump-dir DIR    Dónde dejar dump y log (default: ./tmp-carga-<fecha>).
#
# Reglas duras (de la memoria del proyecto):
#   · El ORIGEN solo se lee (pg_dump). Nunca se le escribe.
#   · El DESTINO tiene que ser conexión DIRECTA (host sin "-pooler").
#   · Contra supabase.com no se escribe sin --permitir-prod explícito.
#
# Fase `motores` (opcional, solo sandbox): corre procesarMoras y
# procesarBucketsConvenio con bun apuntando al destino. Para PRODUCCIÓN NO
# se corre en la carga (línea base limpia, sin replay — ver runbook). Si se
# usa, volver a correr `asignar` después (el 02 deriva de la mora que el
# motor acaba de refrescar).
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COBROS02_DIR="$(cd "$AQUI/.." && pwd)"           # drizzle/cobros-02
DRIZZLE_DIR="$(cd "$COBROS02_DIR/.." && pwd)"    # drizzle
CARTERA_BACK="$(cd "$DRIZZLE_DIR/.." && pwd)"    # apps/cartera-back
# shellcheck source=_lib.sh
source "$AQUI/_lib.sh"

ORIGEN=""; ORIGEN_SCHEMA="cartera"
DESTINO=""; DESTINO_SCHEMA=""
POOL_CSV="$AQUI/pool.csv"
FASES="copiar,migrar,pool,asignar,linea-base,backfill,verificar"
REEMPLAZAR=0; DRY_RUN=0; PERMITIR_PROD=0
DUMP_DIR=""

uso() { sed -n '2,48p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origen)          ORIGEN="$2"; shift 2 ;;
    --origen-schema)   ORIGEN_SCHEMA="$2"; shift 2 ;;
    --destino)         DESTINO="$2"; shift 2 ;;
    --destino-schema)  DESTINO_SCHEMA="$2"; shift 2 ;;
    --pool)            POOL_CSV="$2"; shift 2 ;;
    --fases)           FASES="$2"; shift 2 ;;
    --reemplazar)      REEMPLAZAR=1; shift ;;
    --dry-run)         DRY_RUN=1; shift ;;
    --permitir-prod)   PERMITIR_PROD=1; shift ;;
    --dump-dir)        DUMP_DIR="$2"; shift 2 ;;
    -h|--help)         uso 0 ;;
    *) die "Opción desconocida: $1 (ver --help)" ;;
  esac
done

[[ -n "$DESTINO" ]]        || die "Falta --destino"
[[ -n "$DESTINO_SCHEMA" ]] || die "Falta --destino-schema"
[[ -f "$POOL_CSV" ]]       || die "No existe el CSV del pool: $POOL_CSV"
for h in psql pg_dump perl; do command -v "$h" >/dev/null || die "Falta $h en el PATH"; done

exigir_directo "$DESTINO"
DEST_HOST="$(host_de "$DESTINO")"
if [[ "$DEST_HOST" == *supabase.com* || "$DEST_HOST" == *supabase.co ]]; then
  [[ $PERMITIR_PROD -eq 1 ]] || die "El destino es PRODUCCIÓN ($DEST_HOST). Si de verdad toca, repetí con --permitir-prod."
fi
MISMA_BASE=0; [[ -n "$ORIGEN" && "$ORIGEN" == "$DESTINO" ]] && MISMA_BASE=1
MISMO_SCHEMA=0; [[ "$ORIGEN_SCHEMA" == "$DESTINO_SCHEMA" ]] && MISMO_SCHEMA=1

DUMP_DIR="${DUMP_DIR:-$PWD/tmp-carga-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$DUMP_DIR"
LOG="$DUMP_DIR/carga.log"
exec > >(tee -a "$LOG") 2>&1

psql_dest() { psql "$DESTINO" -X -v ON_ERROR_STOP=1 "$@"; }
schema_existe() { psql_dest -At -c "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '$1')"; }

# Las fases de asignación (01→04) se ENCOLAN y corren juntas en UNA sola
# transacción: todo o nada en la corrida real, y en dry-run un solo ROLLBACK al
# final — así el 02 reparte con el pool que el 01 acaba de armar, no con el
# que había antes (con transacciones separadas el dry-run mentía).
ASIG_BUFFER=()
encolar_sql() { ASIG_BUFFER+=("$1"); echo "· encolado $(basename "$1")"; }
flush_asignacion() {
  [[ ${#ASIG_BUFFER[@]} -gt 0 ]] || return 0
  local fin="COMMIT"; [[ $DRY_RUN -eq 1 ]] && fin="ROLLBACK"
  log "asignación · una sola transacción → $fin"
  {
    echo "BEGIN;"
    local f
    for f in "${ASIG_BUFFER[@]}"; do
      echo "\\echo '--- $(basename "$f") ---'"
      sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$f"
    done
    echo "$fin;"
  } | psql_dest -v schema="$DESTINO_SCHEMA" -v pool_csv="$POOL_CSV" -f -
  ASIG_BUFFER=()
}

fase_copiar() {
  log "copiar · $ORIGEN_SCHEMA → $DESTINO_SCHEMA"
  [[ -n "$ORIGEN" ]] || die "La fase copiar necesita --origen"
  if [[ $MISMA_BASE -eq 1 && $MISMO_SCHEMA -eq 1 ]]; then
    echo "· origen y destino son la misma base y el mismo schema: no hay nada que copiar (escenario prod→prod)."; return
  fi
  if [[ "$(schema_existe "$DESTINO_SCHEMA")" == "t" ]]; then
    [[ $REEMPLAZAR -eq 1 ]] || die "El schema $DESTINO_SCHEMA ya existe en el destino. Usá --reemplazar (lo tira) o quitá 'copiar' de --fases."
    [[ "$DESTINO_SCHEMA" != "cartera" ]] || die "Jamás se reemplaza el schema 'cartera'."
    [[ $DRY_RUN -eq 0 ]] || { echo "· (dry-run) se haría DROP SCHEMA $DESTINO_SCHEMA CASCADE y restore. No se toca."; return; }
    echo "· DROP SCHEMA $DESTINO_SCHEMA CASCADE (--reemplazar)"
    psql_dest -c "DROP SCHEMA \"$DESTINO_SCHEMA\" CASCADE"
  fi
  # Copiar a OTRA base deja fuera lo que el schema toma de `public`; se valida
  # antes de empezar en vez de fallar a mitad del restore (Codex, P2).
  if [[ $MISMA_BASE -eq 0 ]]; then
    echo "· destino en otra base: se validan las dependencias externas"
    verificar_dependencias_externas "$ORIGEN" "$DESTINO" "$ORIGEN_SCHEMA"
  fi
  [[ $DRY_RUN -eq 0 ]] || { echo "· (dry-run) se copiaría $ORIGEN_SCHEMA → $DESTINO_SCHEMA. No se toca."; return; }
  echo "· pg_dump --schema=$ORIGEN_SCHEMA (solo lectura del origen)"
  pg_dump "$ORIGEN" --schema="$ORIGEN_SCHEMA" --no-owner --no-privileges -Fp > "$DUMP_DIR/origen.sql"
  renombrar_dump "$ORIGEN_SCHEMA" "$DESTINO_SCHEMA" < "$DUMP_DIR/origen.sql" > "$DUMP_DIR/destino.sql"
  echo "· restore en UNA transacción (falla = no queda nada a medias)"
  psql_dest -1 -q -o /dev/null -f "$DUMP_DIR/destino.sql"
  psql_dest -At -c "SELECT '· copiado: '||count(*)||' créditos en $DESTINO_SCHEMA.creditos' FROM \"$DESTINO_SCHEMA\".creditos"
}

fase_migrar() {
  log "migrar · bloque cobros-02 + 0024 convenios sobre $DESTINO_SCHEMA"
  [[ $DRY_RUN -eq 0 ]] || { echo "· (dry-run) migraciones omitidas (son DDL idempotente, no tienen ROLLBACK por archivo)."; return; }
  aplicar_migraciones "$DESTINO" "$DESTINO_SCHEMA" "$COBROS02_DIR" "$DRIZZLE_DIR"
  psql_dest -At -c "SELECT '· catálogo buckets: '||count(*)||' filas' FROM \"$DESTINO_SCHEMA\".buckets"
}

fase_pool()       { encolar_sql "$AQUI/01_pool_asesor_bucket.sql"; }
fase_asignar()    { encolar_sql "$AQUI/02_asignar_asesores_creditos.sql"; }
fase_linea_base() { encolar_sql "$AQUI/03_linea_base_historial.sql"; }
fase_backfill()   { encolar_sql "$AQUI/04_backfill_cuotas_convenio.sql"; }

fase_motores() {
  log "motores · procesarMoras + procesarBucketsConvenio contra $DESTINO_SCHEMA"
  # Esta fase REPLAYEA: comprime en una noche los movimientos de bucket que en
  # realidad ocurrieron a lo largo de meses, y el historial queda diciendo que
  # hubo cientos de "cuentas curadas" el mismo día — justo el KPI que el modelo
  # existe para medir. En un sandbox es aceptable (y sirve de prueba de estrés);
  # contra producción NO, así que se rechaza aunque venga --permitir-prod: esa
  # bandera autoriza cargar el modelo, no reescribirle la historia (Codex, P2).
  if [[ "$DEST_HOST" == *supabase.com* || "$DEST_HOST" == *supabase.co ]]; then
    die "La fase 'motores' es solo para sandbox: contra producción la carga inicial va sin replay (línea base limpia). Quitá 'motores' de --fases."
  fi
  [[ $DRY_RUN -eq 0 ]] || { echo "· (dry-run) motores omitidos."; return; }
  command -v bun >/dev/null || die "Falta bun"
  # sslrootcert=system rompe la librería pg de Node; ver url_para_node en _lib.sh.
  local url_motor; url_motor="$(url_para_node "$DESTINO")"
  ( cd "$CARTERA_BACK" && SUPABASE_DB_URL="$url_motor" CARTERA_SCHEMA="$DESTINO_SCHEMA" bun -e '
      const { procesarMoras } = await import("./src/controllers/latefee");
      const { procesarBucketsConvenio } = await import("./src/controllers/bucketsConvenio");
      console.log("moras:", JSON.stringify(await procesarMoras()));
      console.log("convenio:", JSON.stringify(await procesarBucketsConvenio()));
      process.exit(0);
    ' )
  echo "· Recordá volver a correr la fase 'asignar': el 02 deriva de la mora recién refrescada."
}

fase_verificar() { log "verificar · $DESTINO_SCHEMA"; verificar_schema "$DESTINO" "$DESTINO_SCHEMA"; }

echo "COBROS-02 · carga inicial"
ORIGEN_HOST="(sin origen)"; [[ -n "$ORIGEN" ]] && ORIGEN_HOST="$(host_de "$ORIGEN")"
echo "  origen  : $ORIGEN_HOST · schema $ORIGEN_SCHEMA (solo lectura)"
echo "  destino : $DEST_HOST · schema $DESTINO_SCHEMA"
echo "  pool    : $POOL_CSV"
echo "  fases   : $FASES $( [[ $DRY_RUN -eq 1 ]] && echo '(DRY-RUN)' )"
echo "  log     : $LOG"

IFS=',' read -r -a LISTA <<<"$FASES"
for fase in "${LISTA[@]}"; do
  case "$fase" in
    copiar)     flush_asignacion; fase_copiar ;;
    migrar)     flush_asignacion; fase_migrar ;;
    pool)       fase_pool ;;
    asignar)    fase_asignar ;;
    linea-base) fase_linea_base ;;
    backfill)   fase_backfill ;;
    motores)    flush_asignacion; fase_motores ;;
    verificar)  flush_asignacion; fase_verificar ;;
    *) die "Fase desconocida: $fase" ;;
  esac
done
flush_asignacion

log "listo"
echo "Después de una carga real: reiniciar cartera-back (y confirmar que el CRM sigue entrando)."
