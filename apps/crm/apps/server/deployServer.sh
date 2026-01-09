#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -t cci/crm-api .

echo "🏷️ Tagging image..."
podman tag cci/crm-api:latest public.ecr.aws/a6w8m2u2/cci/crm-api:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/crm-api:latest

echo "✅ Done!"
