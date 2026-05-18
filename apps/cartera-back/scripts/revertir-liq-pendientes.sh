#!/usr/bin/env bash
# Revierte la liquidación completa (POST /investor/revertir-liquidacion) de
# los inversionistas marcados como "pendientes" — los que no se pudieron
# limpiar solo con revertir-compras y necesitan deshacer la liquidación.
#
# Uso:
#   bash scripts/revertir-liq-pendientes.sh list           # listar pendientes
#   bash scripts/revertir-liq-pendientes.sh <inv_id>       # uno solo
#   bash scripts/revertir-liq-pendientes.sh all            # los 5 secuenciales
#
# Variables:
#   BASE_URL (default http://localhost:9000)

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg4NzQ5NzMsImV4cCI6MTc3OTQ3OTc3M30.mbrj8ftNihqyucJSlT2SZKpa6UR0XMZRqpkl4QmpPIA"

BASE_URL="${BASE_URL:-http://localhost:9000}"

# Pares "inv_id:liquidacion_id:nombre"
PENDING=(
  "84:379:Flujocapital"
)

ARG="${1:-}"

if [[ -z "$ARG" || "$ARG" == "list" ]]; then
  echo "Pendientes (revertir-liquidacion):"
  for p in "${PENDING[@]}"; do
    INV="${p%%:*}"
    REST="${p#*:}"
    LIQ="${REST%%:*}"
    NOM="${REST#*:}"
    printf "  inv %-4s liq %-4s  %s\n" "$INV" "$LIQ" "$NOM"
  done
  echo
  echo "Uso:"
  echo "  bash scripts/revertir-liq-pendientes.sh <inv_id>   # uno solo (ej. 70)"
  echo "  bash scripts/revertir-liq-pendientes.sh all        # todos secuenciales"
  exit 0
fi

if [[ -z "$TOKEN" || "$TOKEN" == "PEGA_TU_TOKEN_AQUI" ]]; then
  echo "ERROR: pegá tu token JWT en la variable TOKEN al inicio del script." >&2
  exit 1
fi

mkdir -p logs
TS=$(date +%Y%m%d_%H%M%S)
OUT_DIR="logs/revertir_liq_pendientes_${TS}"
mkdir -p "$OUT_DIR"

# Helper para correr un revertir-liquidacion
run_one() {
  local pair="$1"
  local INV="${pair%%:*}"
  local REST="${pair#*:}"
  local LIQ="${REST%%:*}"
  local NOM="${REST#*:}"
  local OUT_FILE="${OUT_DIR}/inv${INV}_liq${LIQ}.json"

  echo "================================================================"
  echo " inv ${INV} (${NOM})  →  revertir liq ${LIQ}"
  echo "================================================================"

  local HTTP_CODE
  HTTP_CODE=$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
    -X POST "${BASE_URL}/investor/revertir-liquidacion" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"liquidacion_id\": ${LIQ}, \"revertir_reinversion\": false}")

  echo "HTTP ${HTTP_CODE}  →  ${OUT_FILE}"
  if command -v jq >/dev/null 2>&1; then
    jq . "$OUT_FILE" || cat "$OUT_FILE"
  else
    cat "$OUT_FILE"
  fi
  echo
}

# Modo all → corre los 5 secuenciales
if [[ "$ARG" == "all" ]]; then
  for p in "${PENDING[@]}"; do
    run_one "$p"
  done
  echo "Detalle: ${OUT_DIR}/"
  exit 0
fi

# Si pasaron un inv_id, filtrar
SELECTED=""
for p in "${PENDING[@]}"; do
  if [[ "${p%%:*}" == "$ARG" ]]; then
    SELECTED="$p"
    break
  fi
done

if [[ -z "$SELECTED" ]]; then
  echo "ERROR: inv_id '${ARG}' no está en la lista de pendientes." >&2
  echo "Pendientes:" >&2
  for p in "${PENDING[@]}"; do echo "  ${p}" >&2; done
  exit 1
fi

run_one "$SELECTED"
echo "Detalle: ${OUT_DIR}/"
