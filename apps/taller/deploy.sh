#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -t cci/taller .

echo "🏷️ Tagging image..."
podman tag cci/taller:latest public.ecr.aws/a6w8m2u2/cci/taller:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/taller:latest

echo "✅ Done!"
