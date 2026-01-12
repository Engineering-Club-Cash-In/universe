#!/bin/bash

# Script para crear PRs fácilmente
# Uso: ./create-pr.sh "título" "cuerpo" [base_branch]
# Ejemplo: ./create-pr.sh "feat: Nueva función" "Descripción del PR" develop

TITLE="$1"
BODY="$2"
BASE="${3:-develop}"  # Default: develop

if [ -z "$TITLE" ]; then
  echo "Error: Se requiere un título"
  echo "Uso: ./create-pr.sh \"título\" \"cuerpo\" [base_branch]"
  exit 1
fi

if [ -z "$BODY" ]; then
  echo "Error: Se requiere un cuerpo/descripción"
  echo "Uso: ./create-pr.sh \"título\" \"cuerpo\" [base_branch]"
  exit 1
fi

# Cambiar a la cuenta correcta
echo "Cambiando a cuenta lraldaatcci..."
gh auth switch --user lraldaatcci 2>/dev/null

# Obtener la rama actual
CURRENT_BRANCH=$(git branch --show-current)

echo "Creando PR..."
echo "  Rama: $CURRENT_BRANCH -> $BASE"
echo "  Título: $TITLE"

# Crear el PR
gh pr create \
  --repo Engineering-Club-Cash-In/universe \
  --head "$CURRENT_BRANCH" \
  --base "$BASE" \
  --title "$TITLE" \
  --body "$BODY"
