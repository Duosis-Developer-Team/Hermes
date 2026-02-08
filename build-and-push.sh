#!/bin/bash

# =============================================================================
# Hermes Platform - Build and Push Script for GHCR
# =============================================================================
# Usage:
#   export CR_PAT=YOUR_GITHUB_TOKEN
#   ./build-and-push.sh
# =============================================================================

# Configuration
GITHUB_USER="coskungencay"
ORG_NAME="duosis-developer-team"
IMAGE_TAG="latest" # You can change this to v1, v2 etc.

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Build & Push Process...${NC}"

# 1. Check for Token
if [ -z "$CR_PAT" ]; then
    echo -e "${RED}Error: CR_PAT environment variable is not set.${NC}"
    echo "Please run: export CR_PAT=your_github_token"
    exit 1
fi

# 2. Login to GHCR
echo "Logging in to GHCR..."
echo $CR_PAT | docker login ghcr.io -u $GITHUB_USER --password-stdin
if [ $? -ne 0 ]; then
    echo -e "${RED}Login failed!${NC}"
    exit 1
fi

# Function to build and push
# Function to build and push
build_and_push() {
    SERVICE_NAME=$1
    DOCKERFILE_PATH=$2
    CONTEXT_DIR=$3
    IMAGE_NAME="ghcr.io/$ORG_NAME/hermes-$SERVICE_NAME:$IMAGE_TAG"

    echo -e "\n${GREEN}[$SERVICE_NAME] Building...${NC}"
    # Use -f for specific Dockerfile and force AMD64 platform for server compatibility
    docker build --platform linux/amd64 -f $DOCKERFILE_PATH -t $IMAGE_NAME $CONTEXT_DIR
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}[$SERVICE_NAME] Build failed!${NC}"
        exit 1
    fi

    echo -e "${GREEN}[$SERVICE_NAME] Pushing...${NC}"
    docker push $IMAGE_NAME
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}[$SERVICE_NAME] Push failed!${NC}"
        exit 1
    fi
}

# 3. Build Services

# Auth Service
build_and_push "auth-service" "backend/auth-service/Dockerfile" "./backend"

# Core Service
build_and_push "core-service" "backend/core-service/Dockerfile" "./backend"

# Reporting Service
build_and_push "reporting-service" "backend/reporting-service/Dockerfile" "./backend"

# Frontend
build_and_push "frontend" "frontend/Dockerfile" "./frontend"

echo -e "\n${GREEN}All images pushed successfully! 🚀${NC}"
