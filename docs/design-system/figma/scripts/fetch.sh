#!/usr/bin/env bash
# Baja las páginas del Figma "CRM Ventas" a raw/ (gitignored) usando la REST API.
# Requiere un token personal de Figma (solo lectura) en ~/.config/figma/token.
# Uso: docs/design-system/figma/scripts/fetch.sh [page-id ...]
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY="ZFxSlzxMdQzVjZgdac7tnL"
TOKEN="$(cat ~/.config/figma/token)"

# Páginas vigentes (se omiten las 3 "🗄️ Archive").
PAGES=("$@")
if [ ${#PAGES[@]} -eq 0 ]; then
	PAGES=(57:877 59:877 84:877 139:2020 199:877 271:877 1644:79 3785:7793 1954:12 3879:12 1529:115 2226:12)
fi

mkdir -p "$DIR/raw"
for id in "${PAGES[@]}"; do
	out="$DIR/raw/page-${id/:/-}.json"
	for _ in 1 2 3; do
		code=$(curl -s -D "$DIR/raw/.hdr" -o "$out" -w '%{http_code}' \
			-H "X-Figma-Token: $TOKEN" \
			"https://api.figma.com/v1/files/$KEY/nodes?ids=$id&geometry=paths")
		if [ "$code" = 429 ]; then
			wait_s=$(grep -i '^retry-after' "$DIR/raw/.hdr" | tr -dc 0-9 || true)
			sleep "${wait_s:-30}"
		else
			break
		fi
	done
	echo "$id -> $code $(du -h "$out" | cut -f1)"
done
rm -f "$DIR/raw/.hdr"
