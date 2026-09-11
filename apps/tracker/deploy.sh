#!/bin/bash

# Exit on error
set -e

# El Dockerfile copia desde apps/tracker y apps/crm, así que el contexto tiene
# que ser la raíz del monorepo, no este directorio.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "📂 Building from monorepo root: $MONOREPO_ROOT"

echo "🔨 Building image..."
podman build -t cci/tracker -f "$SCRIPT_DIR/Dockerfile" "$MONOREPO_ROOT"

echo "🏷️ Tagging image..."
podman tag cci/tracker:latest public.ecr.aws/a6w8m2u2/cci/tracker:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/tracker:latest

echo "✅ Done!"
