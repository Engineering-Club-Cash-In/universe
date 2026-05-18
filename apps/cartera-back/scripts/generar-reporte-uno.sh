#!/usr/bin/env bash
# Llama POST /investor/reporte-liquidados con `reinvertir=true` para UN
# inversionista a la vez. Flujo completo:
#   - genera y sube el Excel
#   - actualiza `reporte_liquidacion_url` en la liquidación
#   - ejecuta la reinversión automática (compra)
#
# Para correr SOLO el reporte (sin meter URL ni reinvertir) usar:
#   scripts/generar-solo-reporte.sh
#
# Uso:
#   bash scripts/generar-reporte-uno.sh <inv:liq>   # un par específico (ej. 1:378)
#   bash scripts/generar-reporte-uno.sh <inv_id>    # busca en PAIRS por inv_id
#   bash scripts/generar-reporte-uno.sh list        # lista pares configurados
#
# Variables:
#   BASE_URL (default http://localhost:9000)

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImVtYWlsIjoiZGFuaWVsLnJAY2x1YmNhc2hpbi5jb20iLCJyb2xlIjoiQURNSU4iLCJhZG1pbl9pZCI6NiwiYXNlc29yX2lkIjpudWxsLCJpYXQiOjE3Nzg4NzIzMTIsImV4cCI6MTc3ODg3NTkxMn0.wte8ElU8amebY5SXc1wLZvba-5QDS49qwlH27zWS9N4"

BASE_URL="${BASE_URL:-http://localhost:9000}"

# Pares "inv_id:liquidacion_id:nombre"
PAIRS=(
  "1:378:Adriana Bahaia"
  "2:371:Aida"
)

ARG="${1:-list}"

if [[ "$ARG" == "list" ]]; then
  echo "Pares configurados:"
  for p in "${PAIRS[@]}"; do
    INV="${p%%:*}"
    REST="${p#*:}"
    LIQ="${REST%%:*}"
    NOM="${REST#*:}"
    printf "  inv %-4s liq %-4s  %s\n" "$INV" "$LIQ" "$NOM"
  done
  echo
  echo "Uso:"
  echo "  bash scripts/generar-reporte-uno.sh <inv:liq>"
  echo "  bash scripts/generar-reporte-uno.sh <inv_id>"
  exit 0
fi

if [[ -z "$TOKEN" || "$TOKEN" == "PEGA_TU_TOKEN_AQUI" ]]; then
  echo "ERROR: pegá tu token JWT en la variable TOKEN al inicio del script." >&2
  exit 1
fi

# Resolver el par: si vino "inv:liq" usarlo; si vino solo inv_id, buscar en PAIRS.
SELECTED=""
if [[ "$ARG" == *:* ]]; then
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
OUT_FILE="logs/reporte_uno_inv${INV}_liq${LIQ}_${TS}.json"

echo "================================================================"
echo " inv ${INV} (${NOM})  →  liq ${LIQ}  [reinvertir=true]"
echo " Endpoint: POST ${BASE_URL}/investor/reporte-liquidados"
echo "================================================================"

clc
echo

if command -v jq >/dev/null 2>&1; then
  SUCCESS=$(jq -r '.success' "$OUT_FILE" 2>/dev/null)
  REINV_SKIP=$(jq -r '.reinversion.skipped' "$OUT_FILE" 2>/dev/null)
  REINV_REASON=$(jq -r '.reinversion.reason // .reinversion.error // ""' "$OUT_FILE" 2>/dev/null)
  REINV_MONTO=$(jq -r '.reinversion.monto // ""' "$OUT_FILE" 2>/dev/null)
  URL=$(jq -r '.url // ""' "$OUT_FILE" 2>/dev/null)

  if [[ "$SUCCESS" == "true" ]]; then
    echo "✅ Reporte generado"
    [[ -n "$URL" ]] && echo "   URL : $URL"
    if [[ "$REINV_SKIP" == "false" ]]; then
      echo "   Reinv: ✅ Q${REINV_MONTO}"
    elif [[ "$REINV_SKIP" == "true" ]]; then
      echo "   Reinv: ⚠️  saltada (${REINV_REASON})"
    elif [[ -n "$REINV_REASON" ]]; then
      echo "   Reinv: ❌ ${REINV_REASON}"
    else
      echo "   Reinv: (sin reinv)"
    fi
  else
    MSG=$(jq -r '.message // .error // "?"' "$OUT_FILE" 2>/dev/null)
    echo "❌ ${MSG}"
  fi
else
  cat "$OUT_FILE"
fi
