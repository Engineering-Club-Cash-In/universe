#!/bin/bash

set -e  # Exit on error

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ECR_REGISTRY="public.ecr.aws/a6w8m2u2"
REGION="us-east-1"

# Supersets conservadores de los inputs Docker: pueden reconstruir de más ante
# archivos ignorados/no-runtime, pero nunca deben omitir una imagen afectada.
SERVER_BUILD_INPUTS=(
    ":(top).dockerignore"
    ":(top)apps/crm/apps/server/"
    ":(top)apps/crm/apps/web/package.json"
    ":(top)apps/crm/package.json"
    ":(top)apps/crm/bun.lock"
    ":(top)packages/infornet/"
    ":(top)packages/sms/"
    ":(top)packages/simpletech/"
    ":(top)packages/email/"
)
WEB_BUILD_INPUTS=(
    ":(top).dockerignore"
    ":(top)apps/crm/Dockerfile"
    ":(top)apps/crm/nginx.conf"
    ":(top)apps/crm/package.json"
    ":(top)apps/crm/bun.lock"
    ":(top)apps/crm/apps/web/"
    ":(top)apps/crm/apps/server/package.json"
    ":(top)apps/crm/apps/server/tsconfig.json"
    ":(top)apps/crm/apps/server/src/lib/"
    ":(top)apps/crm/apps/server/src/db/schema/"
    ":(top)packages/infornet/"
    ":(top)packages/sms/"
    ":(top)packages/simpletech/"
    ":(top)packages/email/"
)

has_untracked_inputs() {
    [ -n "$(git ls-files --others --exclude-standard -- "$@")" ]
}

# Default: check uncommitted changes, or compare with ref if provided
COMPARE_MODE="${1:-uncommitted}"

if [ "$COMPARE_MODE" = "uncommitted" ]; then
    echo -e "${BLUE}🔍 Checking for uncommitted changes...${NC}\n"

    # Check if git is available
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git is not installed${NC}"
        exit 1
    fi

    # Check for changes in every input consumed by the server image
    SERVER_CHANGED=false
    if git diff --quiet HEAD -- "${SERVER_BUILD_INPUTS[@]}" && git diff --quiet --cached -- "${SERVER_BUILD_INPUTS[@]}" && ! has_untracked_inputs "${SERVER_BUILD_INPUTS[@]}"; then
        echo -e "${YELLOW}⏭️  No uncommitted changes in server${NC}"
    else
        echo -e "${GREEN}✓ Uncommitted changes detected in server${NC}"
        SERVER_CHANGED=true
    fi

    # Check for changes in every input consumed by the web image
    WEB_CHANGED=false
    if git diff --quiet HEAD -- "${WEB_BUILD_INPUTS[@]}" && git diff --quiet --cached -- "${WEB_BUILD_INPUTS[@]}" && ! has_untracked_inputs "${WEB_BUILD_INPUTS[@]}"; then
        echo -e "${YELLOW}⏭️  No uncommitted changes in web${NC}"
    else
        echo -e "${GREEN}✓ Uncommitted changes detected in web${NC}"
        WEB_CHANGED=true
    fi
else
    echo -e "${BLUE}🔍 Checking for changes since ${COMPARE_MODE}...${NC}\n"

    # Check if git is available
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git is not installed${NC}"
        exit 1
    fi

    # Fetch latest changes from origin
    git fetch origin -q

    # Check for changes in every input consumed by the server image
    SERVER_CHANGED=false
    if git diff --quiet "$COMPARE_MODE" HEAD -- "${SERVER_BUILD_INPUTS[@]}" 2>/dev/null; then
        echo -e "${YELLOW}⏭️  No changes detected in server${NC}"
    else
        echo -e "${GREEN}✓ Changes detected in server${NC}"
        SERVER_CHANGED=true
    fi

    # Check for changes in every input consumed by the web image
    WEB_CHANGED=false
    if git diff --quiet "$COMPARE_MODE" HEAD -- "${WEB_BUILD_INPUTS[@]}" 2>/dev/null; then
        echo -e "${YELLOW}⏭️  No changes detected in web${NC}"
    else
        echo -e "${GREEN}✓ Changes detected in web${NC}"
        WEB_CHANGED=true
    fi
fi

# If nothing changed and not forcing, exit
if [ "$SERVER_CHANGED" = false ] && [ "$WEB_CHANGED" = false ] && [ "$FORCE_DEPLOY" != "1" ]; then
    echo -e "\n${YELLOW}ℹ️  No changes detected in server or web. Skipping deployment.${NC}"
    echo -e "${YELLOW}💡 To force deployment, run: FORCE_DEPLOY=1 ./deploy.sh${NC}"
    exit 0
fi

# Check if forcing deployment
if [ "$FORCE_DEPLOY" = "1" ]; then
    echo -e "\n${BLUE}🚀 FORCE_DEPLOY enabled - deploying both server and web${NC}"
    SERVER_CHANGED=true
    WEB_CHANGED=true
fi

echo -e "\n${BLUE}🔐 Authenticating with AWS ECR...${NC}"
aws ecr-public get-login-password --region $REGION | podman login --username AWS --password-stdin $ECR_REGISTRY

echo -e "${GREEN}✅ Authentication successful${NC}\n"

# Build and push server if changed
if [ "$SERVER_CHANGED" = true ] || [ "$FORCE_DEPLOY" = "1" ]; then
    echo -e "${BLUE}🏗️  Building server image...${NC}"
    podman build -t cci/crm-api -f "$SCRIPT_DIR/apps/server/Dockerfile" "$MONOREPO_ROOT"
    podman tag cci/crm-api:latest $ECR_REGISTRY/cci/crm-api:latest
    echo -e "${BLUE}📤 Pushing server image...${NC}"
    podman push $ECR_REGISTRY/cci/crm-api:latest
    echo -e "${GREEN}✅ Server image pushed successfully${NC}\n"
fi

# Build and push web if changed
if [ "$WEB_CHANGED" = true ] || [ "$FORCE_DEPLOY" = "1" ]; then
    echo -e "${BLUE}🏗️  Building web image (no cache)...${NC}"
    podman build --no-cache -t cci/crm-web -f "$SCRIPT_DIR/Dockerfile" "$MONOREPO_ROOT"
    podman tag cci/crm-web:latest $ECR_REGISTRY/cci/crm-web:latest
    echo -e "${BLUE}📤 Pushing web image...${NC}"
    podman push $ECR_REGISTRY/cci/crm-web:latest
    echo -e "${GREEN}✅ Web image pushed successfully${NC}\n"
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"
