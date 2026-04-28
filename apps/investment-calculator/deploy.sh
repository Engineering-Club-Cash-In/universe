#!/bin/bash

# Exit on error
set -e

echo "📦 Building app..."
bun run build

echo "🔨 Building image..."
podman build -t cci/investment .

echo "🏷️ Tagging image..."
podman tag cci/investment:latest public.ecr.aws/a6w8m2u2/cci/investment:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/investment:latest

echo "✅ Done!"
