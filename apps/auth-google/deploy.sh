#!/bin/bash

# Exit on error
set -e

echo "🔨 Building image..."
podman build -f apps/auth-google/Dockerfile -t cci/better-auth-api ../..

echo "🏷️ Tagging image..."
podman tag cci/better-auth-api:latest public.ecr.aws/a6w8m2u2/cci/better-auth-api:latest

echo "⬆️ Pushing to ECR..."
podman push public.ecr.aws/a6w8m2u2/cci/better-auth-api:latest

echo "✅ Done!"
