#!/usr/bin/env bash
# Llama POST /investor/reporte-liquidados con `solo_reporte=true`.
# Solo genera y sube el Excel: NO actualiza `reporte_liquidacion_url` en la
# liquidación NI ejecuta la reinversión automática.
#
# Uso:
#   bash scripts/generar-solo-reporte.sh            # corre Adriana (1:378) por default
#   bash scripts/generar-solo-reporte.sh <inv:liq>  # uno específico
#   bash scripts/generar-solo-reporte.sh list       # mostrar pares configurados
#
# Variables:
#   BASE_URL (default http://localhost:9000)

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg4NzQ5NzMsImV4cCI6MTc3OTQ3OTc3M30.mbrj8ftNihqyucJSlT2SZKpa6UR0XMZRqpkl4QmpPIA"

BASE_URL="${BASE_URL:-http://localhost:9000}"

# Pares "inv_id:liquidacion_id:nombre"
PAIRS=(
  "1:378:Adriana Bahaia"
)

ARG="${1:-1}"

if [[ "$ARG" == "list" ]]; then
  echo "Pares configurados:"
  for p in "${PAIRS[@]}"; do
    INV="${p%%:*}"
    REST="${p#*:}"
    LIQ="${REST%%:*}"
    NOM="${REST#*:}"
    printf "  inv %-4s liq %-4s  %s\n" "$INV" "$LIQ" "$NOM"
  done
  exit 0
fi

if [[ -z "$TOKEN" || "$TOKEN" == "PEGA_TU_TOKEN_AQUI" ]]; then
  echo "ERROR: pegá tu token JWT en la variable TOKEN al inicio del script." >&2
  exit 1
fi

# Resolver el par a correr: si pasaron "inv:liq" usar eso; si pasaron solo
# un inv_id, buscar en PAIRS; si no, asumir 1 (Adriana).
SELECTED=""
if [[ "$ARG" == *:* ]]; then
  # Si vino "inv:liq" sin nombre, le ponemos "(custom)"
  if [[ $(awk -F: '{print NF}' <<<"$ARG") -eq 2 ]]; then
    SELECTED="${ARG}:(custom)"
  else
    SELECTED="$ARG"
  fi
else
  for p in "${PAIRS[@]}"; do
    if [[ "${p%%:*}" == "$ARG" ]]; then
      SELECTED="$p"
      break
    fi
  done
fi

if [[ -z "$SELECTED" ]]; then
  echo "ERROR: '${ARG}' no está en la lista. Usá 'list' para ver opciones o pasá 'inv:liq'." >&2
  exit 1
fi

INV="${SELECTED%%:*}"
REST="${SELECTED#*:}"
LIQ="${REST%%:*}"
NOM="${REST#*:}"

mkdir -p logs
TS=$(date +%Y%m%d_%H%M%S)
OUT_FILE="logs/solo_reporte_inv${INV}_liq${LIQ}_${TS}.json"

echo "================================================================"
echo " inv ${INV} (${NOM})  →  liq ${LIQ}  [solo_reporte=true]"
echo " Endpoint: POST ${BASE_URL}/investor/reporte-liquidados"
echo "================================================================"

HTTP_CODE=$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  -X POST "${BASE_URL}/investor/reporte-liquidados" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"investor_id\": ${INV}, \"liquidacion_id\": ${LIQ}, \"solo_reporte\": true}")

echo "HTTP ${HTTP_CODE}  →  ${OUT_FILE}"
echo

if command -v jq >/dev/null 2>&1; then
  jq -r '
    if .success == true then
      "✅ Reporte generado",
      "   URL : \(.url)",
      "   File: \(.filename)"
    else
      "❌ \(.message // .error // "error desconocido")"
    end
  ' "$OUT_FILE" 2>/dev/null || cat "$OUT_FILE"
else
  cat "$OUT_FILE"
fi
