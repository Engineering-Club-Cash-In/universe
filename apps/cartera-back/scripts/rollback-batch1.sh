#!/usr/bin/env bash
# Rollback de batch 1 de regenerar-reporte-y-reinvertir:
#   1) Lee las URLs originales de las 10 liquidaciones desde el dump
#      (2026-05-12 23:27, anterior a la regeneración) y restaura
#      `reporte_liquidacion_url` en la DB.
#   2) Llama POST /investor/revertir-compras-ultima-liquidacion para los
#      10 inversionistas → revierte las compras `pendiente_reinversion`
#      generadas por la reinversión automática.
#
# Uso:
#   bash scripts/rollback-batch1.sh
#   bash scripts/rollback-batch1.sh /ruta/al/dump.sql

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg2NTY5OTgsImV4cCI6MTc3ODY2MDU5OH0.DGmAUQIs3dR8hABiiZ7jjtKTUmy7B8KdpAjjqyUrDCg"

BASE_URL="${BASE_URL:-http://localhost:9000}"
DUMP_FILE="${1:-/home/daniel/Descargas/CarteraBack-2026_05_12_23_27_34-dump.sql}"

# (inv_id, liquidacion_id) del batch 1
PAIRS=(
  "1:378"   "2:371"   "3:384"   "4:382"   "7:432"
  "87:436"  "107:345" "10:340"  "13:350"  "110:393"
)

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump '$DUMP_FILE' no existe" >&2
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: token JWT vacío" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  if [[ -f .env ]]; then
    SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-)
  fi
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL no está disponible" >&2
  exit 1
fi

# Localizar el bloque COPY de cartera.liquidaciones en el dump.
COPY_LINE=$(grep -n "^COPY cartera.liquidaciones " "$DUMP_FILE" | head -1 | cut -d: -f1)
if [[ -z "$COPY_LINE" ]]; then
  echo "ERROR: no encontré el bloque COPY cartera.liquidaciones en el dump" >&2
  exit 1
fi

echo "================================================================"
echo " PASO 1: Restaurar reporte_liquidacion_url desde el dump"
echo "         Dump: ${DUMP_FILE}"
echo "================================================================"

INV_IDS=()
for pair in "${PAIRS[@]}"; do
  INV_ID="${pair%:*}"
  LIQ_ID="${pair#*:}"
  INV_IDS+=( "$INV_ID" )

  # Extraer la URL original del dump para ese liquidacion_id
  URL_ORIG=$(awk -v start="$COPY_LINE" -v liq="$LIQ_ID" '
    NR>start && /^\\\.$/ {exit}
    NR>start {
      split($0, a, "\t")
      if (a[1] == liq) {print a[10]; exit}
    }
  ' "$DUMP_FILE")

  if [[ -z "$URL_ORIG" || "$URL_ORIG" == "\\N" ]]; then
    printf "  liq %-4s inv %-4s  →  ⚠️  sin URL en el dump (skip)\n" "$LIQ_ID" "$INV_ID"
    continue
  fi

  printf "  liq %-4s inv %-4s  →  " "$LIQ_ID" "$INV_ID"

  UPDATED=$(PGOPTIONS='--client-min-messages=warning' psql "$SUPABASE_DB_URL" -t -A -c "
    UPDATE cartera.liquidaciones
       SET reporte_liquidacion_url = '${URL_ORIG//\'/\'\'}'
     WHERE liquidacion_id = ${LIQ_ID}
    RETURNING liquidacion_id;
  ")

  if [[ -n "$UPDATED" ]]; then
    echo "URL restaurada"
  else
    echo "FALLO (liq no encontrada)"
  fi
done

echo
echo "================================================================"
echo " PASO 2: Revertir compras pendiente_reinversion de los 10 inv"
echo "================================================================"

JSON_IDS=$(printf '%s,' "${INV_IDS[@]}")
JSON_IDS="[${JSON_IDS%,}]"

mkdir -p logs
TS=$(date +%Y%m%d_%H%M%S)
OUT_FILE="logs/rollback_batch1_${TS}.json"

echo "POST ${BASE_URL}/investor/revertir-compras-ultima-liquidacion"
echo "IDs : ${JSON_IDS}"
echo

HTTP_CODE=$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  -X POST "${BASE_URL}/investor/revertir-compras-ultima-liquidacion" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"inversionista_ids\": ${JSON_IDS}}")

echo "HTTP ${HTTP_CODE}"
echo

if command -v jq >/dev/null 2>&1 && jq -e .resumen "$OUT_FILE" >/dev/null 2>&1; then
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
  echo "Respuesta:"
  cat "$OUT_FILE"
fi

echo
echo "Detalle: ${OUT_FILE}"
