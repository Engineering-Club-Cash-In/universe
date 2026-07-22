#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

IMAGE_LOCAL="cci/nexa-server"
IMAGE_REMOTE="${ECR_IMAGE:-public.ecr.aws/a6w8m2u2/cci/nexa-server}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

if command -v podman >/dev/null 2>&1; then
  CONTAINER_CLI="podman"
elif command -v docker >/dev/null 2>&1; then
  CONTAINER_CLI="docker"
else
  echo "Error: podman or docker is required." >&2
  exit 1
fi

echo "Building $IMAGE_LOCAL:$TAG..."
"$CONTAINER_CLI" build \
  --platform "$PLATFORM" \
  -f "$SCRIPT_DIR/Dockerfile" \
  -t "$IMAGE_LOCAL:$TAG" \
  "$MONOREPO_ROOT"

echo "Tagging $IMAGE_REMOTE:$TAG..."
"$CONTAINER_CLI" tag "$IMAGE_LOCAL:$TAG" "$IMAGE_REMOTE:$TAG"

if command -v aws >/dev/null 2>&1; then
  echo "Logging in to ECR Public..."
  aws ecr-public get-login-password --region us-east-1 \
    | "$CONTAINER_CLI" login --username AWS --password-stdin public.ecr.aws
else
  echo "Skipping ECR login: aws CLI not found. Assuming existing registry session."
fi

echo "Pushing $IMAGE_REMOTE:$TAG..."
"$CONTAINER_CLI" push "$IMAGE_REMOTE:$TAG"

echo "Done: $IMAGE_REMOTE:$TAG"
