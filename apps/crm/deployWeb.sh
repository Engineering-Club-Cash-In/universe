#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -t cci/crm-web .

echo "🏷️ Tagging image..."
podman tag cci/crm-web:latest public.ecr.aws/a6w8m2u2/cci/crm-web:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/crm-web:latest

echo "✅ Done!"
