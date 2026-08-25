#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -t cci/tracker .

echo "🏷️ Tagging image..."
podman tag cci/tracker:latest public.ecr.aws/a6w8m2u2/cci/tracker:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/tracker:latest

echo "✅ Done!"
