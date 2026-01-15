#!/bin/bash

# Exit on error
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Navigate to the monorepo root (universe)
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "📂 Building from monorepo root: $MONOREPO_ROOT"

echo "🔨 Building image..."
podman build -t cci/crm-web -f "$SCRIPT_DIR/Dockerfile" "$MONOREPO_ROOT"

echo "🏷️ Tagging image..."
podman tag cci/crm-web:latest public.ecr.aws/a6w8m2u2/cci/crm-web:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/crm-web:latest

echo "✅ Done!"
