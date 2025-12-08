#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -t cci/portal-web .

echo "🏷️ Tagging image..."
podman tag cci/portal-web:latest public.ecr.aws/a6w8m2u2/cci/portal-web:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/portal-web:latest

echo "✅ Done!"
