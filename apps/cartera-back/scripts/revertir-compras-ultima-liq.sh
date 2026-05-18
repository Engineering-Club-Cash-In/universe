#!/usr/bin/env bash
# Revierte compras de la última liquidación, UN batch a la vez.
#
# Uso:
#   bash scripts/revertir-compras-ultima-liq.sh <batch_num>
#
# Ejemplos:
#   bash scripts/revertir-compras-ultima-liq.sh 1     # corre el batch 1 (inv 1..10 de la lista)
#   bash scripts/revertir-compras-ultima-liq.sh 2     # corre el batch 2
#   bash scripts/revertir-compras-ultima-liq.sh list  # lista los batches sin disparar nada
#
# Variables:
#   BATCH_SIZE (default 10)
#   BASE_URL   (default http://localhost:9000)

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg2NTI3NTIsImV4cCI6MTc3ODY1NDU1Mn0.eL5I9K3Iv3w0zlbufjE6o9JMnXFG7dZE9uunLnAdtVc"

BASE_URL="${BASE_URL:-http://localhost:9000}"
BATCH_SIZE="${BATCH_SIZE:-10}"

# IDs derivados de src/scripts/inv.txt (53 inversionistas).
IDS=(
  1 2 3 4 7 87 107 10 11 13
  14 110 123 90 84 24 26 27 30 31
  34 33 92 119 49 38 40 47 51 53
  54 57 96 60 61 62 118 63 65 67
  69 70 71 91 74 76 77 125 80 127
  81 82 115
)

TOTAL=${#IDS[@]}
TOTAL_BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))

ARG="${1:-}"

if [[ -z "$ARG" || "$ARG" == "list" ]]; then
  echo "Total inv: ${TOTAL}  |  Batch size: ${BATCH_SIZE}  |  Batches: ${TOTAL_BATCHES}"
  echo
  for ((b=1; b<=TOTAL_BATCHES; b++)); do
    start=$(( (b - 1) * BATCH_SIZE ))
    chunk=( "${IDS[@]:start:BATCH_SIZE}" )
    printf "  Batch %d (n=%d): %s\n" "$b" "${#chunk[@]}" "${chunk[*]}"
  done
  echo
  echo "Uso: bash scripts/revertir-compras-ultima-liq.sh <batch_num>"
  exit 0
fi

if ! [[ "$ARG" =~ ^[0-9]+$ ]]; then
  echo "ERROR: el argumento debe ser un número de batch (1..${TOTAL_BATCHES}) o 'list'." >&2
  exit 1
fi

BATCH_NUM="$ARG"
if (( BATCH_NUM < 1 || BATCH_NUM > TOTAL_BATCHES )); then
  echo "ERROR: batch_num fuera de rango (1..${TOTAL_BATCHES})." >&2
  exit 1
fi

if [[ -z "$TOKEN" || "$TOKEN" == "PEGA_TU_TOKEN_AQUI" ]]; then
  echo "ERROR: pegá tu token JWT en la variable TOKEN al inicio del script." >&2
  exit 1
fi

START=$(( (BATCH_NUM - 1) * BATCH_SIZE ))
CHUNK=( "${IDS[@]:START:BATCH_SIZE}" )

JSON_IDS=$(printf '%s,' "${CHUNK[@]}")
JSON_IDS="[${JSON_IDS%,}]"

mkdir -p logs
TS=$(date +%Y%m%d_%H%M%S)
OUT_FILE="logs/revertir_compras_batch${BATCH_NUM}_${TS}.json"

echo "================================================================"
echo " Endpoint : POST ${BASE_URL}/investor/revertir-compras-ultima-liquidacion"
echo " Batch    : ${BATCH_NUM}/${TOTAL_BATCHES}  (n=${#CHUNK[@]})"
echo " IDs      : ${JSON_IDS}"
echo " Salida   : ${OUT_FILE}"
echo "================================================================"
echo

HTTP_CODE=$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  -X POST "${BASE_URL}/investor/revertir-compras-ultima-liquidacion" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"inversionista_ids\": ${JSON_IDS}}")

echo "HTTP ${HTTP_CODE}"
echo

if command -v jq >/dev/null 2>&1; then
  if jq -e .resumen "$OUT_FILE" >/dev/null 2>&1; then
    echo "── RESUMEN BATCH ${BATCH_NUM} ──"
    jq -r '
      "Solicitados : \(.resumen.total_solicitados)",
      "Revertidos  : \(.resumen.total_revertidos)",
      "No pasaron  : \(.resumen.total_no_pasaron)",
      "Q total     : \(.resumen.monto_total_revertido)",
      "",
      "✅ REVERTIDOS:",
      (.resumen.revertidos[]? | "  inv \(.inversionista_id)  Q\(.monto_revertido)  \(.nombre)  (liq \(.liquidacion_id), cuadrado=\(.cuadrado))"),
      "",
      "❌ NO PASARON:",
      (.resumen.no_pasaron[]? | "  inv \(.inversionista_id)  \(.nombre)  → \(.reason)")
    ' "$OUT_FILE"
  else
    echo "⚠️  Respuesta sin .resumen — revisar:"
    jq . "$OUT_FILE" || cat "$OUT_FILE"
  fi
fi
