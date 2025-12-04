#!/bin/bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="public.ecr.aws/a6w8m2u2"
IMAGE_NAME="cci/portal-web"
REGION="us-east-1"
VITE_API_URL="${VITE_API_URL:-https://api.devteamatcci.site}"

# Detect container runtime (podman or docker)
if command -v podman &> /dev/null; then
    CONTAINER_CMD="podman"
    echo -e "${GREEN}✓ Using Podman${NC}"
elif command -v docker &> /dev/null; then
    CONTAINER_CMD="docker"
    echo -e "${GREEN}✓ Using Docker${NC}"
else
    echo -e "${RED}❌ Neither podman nor docker found. Please install one of them.${NC}"
    exit 1
fi

echo -e "${YELLOW}🚀 Starting deployment process...${NC}\n"

# Step 1: Authenticate with ECR
echo -e "${YELLOW}📝 Step 1/4: Authenticating with AWS ECR...${NC}"
if aws ecr-public get-login-password --region ${REGION} | ${CONTAINER_CMD} login --username AWS --password-stdin ${REGISTRY}; then
    echo -e "${GREEN}✅ Authentication successful${NC}\n"
else
    echo -e "${RED}❌ Authentication failed. Make sure AWS CLI is configured.${NC}"
    exit 1
fi

# Step 2: Build image
echo -e "${YELLOW}🔨 Step 2/4: Building image with ${CONTAINER_CMD}...${NC}"
echo -e "Using API URL: ${VITE_API_URL}"
if ${CONTAINER_CMD} build --platform=linux/amd64 --build-arg VITE_API_URL=${VITE_API_URL} -t ${IMAGE_NAME} .; then
    echo -e "${GREEN}✅ Build successful${NC}\n"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Step 3: Tag image
echo -e "${YELLOW}🏷️  Step 3/4: Tagging image...${NC}"
${CONTAINER_CMD} tag ${IMAGE_NAME}:latest ${REGISTRY}/${IMAGE_NAME}:latest
echo -e "${GREEN}✅ Image tagged${NC}\n"

# Step 4: Push to ECR
echo -e "${YELLOW}⬆️  Step 4/4: Pushing to ECR...${NC}"
if ${CONTAINER_CMD} push ${REGISTRY}/${IMAGE_NAME}:latest; then
    echo -e "${GREEN}✅ Push successful${NC}\n"
else
    echo -e "${RED}❌ Push failed${NC}"
    exit 1
fi

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "📦 Image: ${REGISTRY}/${IMAGE_NAME}:latest"
echo -e "🌐 API URL: ${VITE_API_URL}"
echo -e ""
echo -e "Next steps:"
echo -e "  • Deploy this image in Coolify"
echo -e "  • Image URI: ${REGISTRY}/${IMAGE_NAME}:latest"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
