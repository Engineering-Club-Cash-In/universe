#!/usr/bin/env bash
# Llama /investor/reporte-liquidados con reinvertir=true para los
# inversionistas listados, UN batch a la vez. Cada batch hace N requests
# secuenciales (el endpoint procesa un único inv por llamada).
#
# Uso:
#   bash scripts/regenerar-reporte-y-reinvertir.sh list           # ver batches + pendientes
#   bash scripts/regenerar-reporte-y-reinvertir.sh <batch_num>    # corre un batch normal
#   bash scripts/regenerar-reporte-y-reinvertir.sh pending        # corre TODOS los pendientes
#   bash scripts/regenerar-reporte-y-reinvertir.sh pending <inv>  # corre 1 pendiente específico
#
# Variables:
#   BATCH_SIZE (default 10)
#   BASE_URL   (default http://localhost:9000)

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg3MTA1NzYsImV4cCI6MTc4MTMwMjU3Nn0.Ju4b5i65wemKG4GMl67t-r2h9D-_prcw8PiXf-2QOao"

BASE_URL="${BASE_URL:-http://localhost:9000}"
BATCH_SIZE="${BATCH_SIZE:-10}"

# ── Lista principal: 47 pares "inv_id:liquidacion_id"
#    (originalmente 48; 1:378 Adriana corregida manualmente fuera del batch) ──
#    24, 62, 82 vuelven a entrar porque los estamos corrigiendo manualmente.
PAIRS=(
  "2:371"   "3:384"   "4:382"   "7:432"
  "87:436"  "107:345" "10:340"  "13:350"  "110:393"
  "123:364" "90:358"  "84:379"  "24:402"  "26:376"
  "27:394"  "30:354"  "31:357"  "34:385"  "33:412"
  "92:437"  "119:368" "49:349"  "40:399"  "47:363"
  "51:383"  "53:404"  "54:359"  "57:362"  "96:347"
  "60:346"  "61:426"  "62:395"  "118:361" "63:390"
  "65:343"  "67:392"  "69:352"  "71:355"  "91:365"
  "74:398"  "76:375"  "77:411"  "125:386" "80:408"
  "81:389"  "82:443"  "115:442"
)

# ── DESCARTADOS: NO entran en los batches normales. ──
#
# PENDING (necesitaban revertir liquidación completa primero):
#   38:401   Javier Arzu Perez                         (pendiente revertir liq)
#   11:381   Boris Gilberto Lemus Villatoro            (pendiente revertir liq)
#   14:430   Carlos Fernando Carrillo Cifuentes        (liq ya revertida)
#   70:439   Oscar Massis                              (liq ya revertida)
#  127:420   Selvyn Yeiner Roblero Velásquez           (liq ya revertida)
#
PENDING=(
  "38:401"   # Javier Arzu Perez
  "11:381"   # Boris Gilberto Lemus Villatoro
  "14:430"   # Carlos Fernando Carrillo Cifuentes
  "70:439"   # Oscar Massis
  "127:420"  # Selvyn Yeiner Roblero Velásquez
)

TOTAL=${#PAIRS[@]}
TOTAL_BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))

ARG="${1:-}"
ARG2="${2:-}"

# ── Helper para correr un par (inv:liq) y reportar resultado ──
run_pair() {
  local pair="$1"
  local out_dir="$2"
  local INV_ID="${pair%:*}"
  local LIQ_ID="${pair#*:}"
  local OUT_FILE="${out_dir}/inv${INV_ID}_liq${LIQ_ID}.json"

  printf "── inv %-4s liq %-4s  " "$INV_ID" "$LIQ_ID"

  local HTTP_CODE
  HTTP_CODE=$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
    -X POST "${BASE_URL}/investor/reporte-liquidados" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"investor_id\": ${INV_ID}, \"liquidacion_id\": ${LIQ_ID}, \"reinvertir\": true, \"sustituir_totales\": true}")

  printf "HTTP %s" "$HTTP_CODE"

  if command -v jq >/dev/null 2>&1; then
    # `// false`/`// "null"` no se usan porque jq trata `false` como falsy.
    # Leemos los campos crudos y comparamos contra "false"/"true"/"null".
    local SUCCESS REINV_SKIP REINV_REASON REINV_MONTO MSG
    SUCCESS=$(jq -r '.success' "$OUT_FILE" 2>/dev/null)
    REINV_SKIP=$(jq -r '.reinversion.skipped' "$OUT_FILE" 2>/dev/null)
    REINV_REASON=$(jq -r '.reinversion.reason // .reinversion.error // ""' "$OUT_FILE" 2>/dev/null)
    REINV_MONTO=$(jq -r '.reinversion.monto // ""' "$OUT_FILE" 2>/dev/null)

    if [[ "$SUCCESS" == "true" ]]; then
      if [[ "$REINV_SKIP" == "false" ]]; then
        printf "  ✅ reporte + reinv Q%s\n" "$REINV_MONTO"
      elif [[ "$REINV_SKIP" == "true" ]]; then
        printf "  ✅ reporte (reinv saltada: %s)\n" "$REINV_REASON"
      elif [[ -n "$REINV_REASON" ]]; then
        printf "  ⚠️  reporte ok, reinv ERROR: %s\n" "$REINV_REASON"
      else
        printf "  ✅ reporte (sin reinv)\n"
      fi
    else
      MSG=$(jq -r '.message // .error // "?"' "$OUT_FILE" 2>/dev/null)
      printf "  ❌ %s\n" "$MSG"
    fi
  else
    printf "\n"
  fi
}

# ── Modo list ──
if [[ -z "$ARG" || "$ARG" == "list" ]]; then
  echo "Principal: ${TOTAL} inv  |  Batch size: ${BATCH_SIZE}  |  Batches: ${TOTAL_BATCHES}"
  echo
  for ((b=1; b<=TOTAL_BATCHES; b++)); do
    start=$(( (b - 1) * BATCH_SIZE ))
    chunk=( "${PAIRS[@]:start:BATCH_SIZE}" )
    printf "  Batch %d (n=%d): %s\n" "$b" "${#chunk[@]}" "${chunk[*]}"
  done
  echo
  echo "Pendientes (revertir liq completa antes de regenerar): ${#PENDING[@]}"
  for p in "${PENDING[@]}"; do
    printf "  %s\n" "$p"
  done
  echo
  echo "Uso:"
  echo "  bash scripts/regenerar-reporte-y-reinvertir.sh <batch_num>"
  echo "  bash scripts/regenerar-reporte-y-reinvertir.sh pending           # todos los pendientes"
  echo "  bash scripts/regenerar-reporte-y-reinvertir.sh pending <inv_id>  # uno solo"
  exit 0
fi

if [[ -z "$TOKEN" || "$TOKEN" == "PEGA_TU_TOKEN_AQUI" ]]; then
  echo "ERROR: pegá tu token JWT en la variable TOKEN al inicio del script." >&2
  exit 1
fi

mkdir -p logs
TS=$(date +%Y%m%d_%H%M%S)

# ── Modo pending ──
if [[ "$ARG" == "pending" ]]; then
  OUT_DIR="logs/reporte_reinv_pending_${TS}"
  mkdir -p "$OUT_DIR"

  SELECTED=()
  if [[ -z "$ARG2" ]]; then
    SELECTED=( "${PENDING[@]}" )
  else
    # Filtrar por inv_id
    for p in "${PENDING[@]}"; do
      if [[ "${p%:*}" == "$ARG2" ]]; then
        SELECTED+=( "$p" )
      fi
    done
    if [[ ${#SELECTED[@]} -eq 0 ]]; then
      echo "ERROR: inv_id '${ARG2}' no está en la lista de pendientes." >&2
      echo "Pendientes disponibles:" >&2
      for p in "${PENDING[@]}"; do echo "  ${p}" >&2; done
      exit 1
    fi
  fi

  echo "================================================================"
  echo " Endpoint : POST ${BASE_URL}/investor/reporte-liquidados"
  echo " Modo     : PENDING  (n=${#SELECTED[@]})"
  echo " Salida   : ${OUT_DIR}/"
  echo "================================================================"
  echo

  for pair in "${SELECTED[@]}"; do
    run_pair "$pair" "$OUT_DIR"
  done

  echo
  echo "Detalle: ${OUT_DIR}/"
  exit 0
fi

# ── Modo batch num ──
if ! [[ "$ARG" =~ ^[0-9]+$ ]]; then
  echo "ERROR: el argumento debe ser un número de batch (1..${TOTAL_BATCHES}), 'list' o 'pending'." >&2
  exit 1
fi

BATCH_NUM="$ARG"
if (( BATCH_NUM < 1 || BATCH_NUM > TOTAL_BATCHES )); then
  echo "ERROR: batch_num fuera de rango (1..${TOTAL_BATCHES})." >&2
  exit 1
fi

START=$(( (BATCH_NUM - 1) * BATCH_SIZE ))
CHUNK=( "${PAIRS[@]:START:BATCH_SIZE}" )

OUT_DIR="logs/reporte_reinv_batch${BATCH_NUM}_${TS}"
mkdir -p "$OUT_DIR"

echo "================================================================"
echo " Endpoint : POST ${BASE_URL}/investor/reporte-liquidados"
echo " Batch    : ${BATCH_NUM}/${TOTAL_BATCHES}  (n=${#CHUNK[@]})"
echo " Salida   : ${OUT_DIR}/"
echo "================================================================"
echo

for pair in "${CHUNK[@]}"; do
  run_pair "$pair" "$OUT_DIR"
done

echo
echo "Detalle: ${OUT_DIR}/"
