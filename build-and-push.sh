#!/bin/bash
# =============================================================================
# Hermes - Docker Image Build and Push Script
# =============================================================================
# This script builds all Hermes Docker images and pushes them to a registry
#
# Usage:
#   ./build-and-push.sh [OPTIONS]
#
# Options:
#   -r, --registry <registry>  Docker registry (default: docker.io/yourusername)
#   -v, --version <version>    Image version tag (default: latest)
#   -n, --no-push              Build only, don't push to registry
#   -h, --help                 Show this help message
#
# Examples:
#   ./build-and-push.sh -r duosis -v v1.0.0
#   ./build-and-push.sh -r yourregistry.azurecr.io -v latest
#   ./build-and-push.sh -r ghcr.io/your-org -v dev
#   ./build-and-push.sh -n  # Build only without push
# =============================================================================

set -e  # Exit on error

# Default values
REGISTRY="yourusername"
VERSION="latest"
NO_PUSH=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -r|--registry)
      REGISTRY="$2"
      shift 2
      ;;
    -v|--version)
      VERSION="$2"
      shift 2
      ;;
    -n|--no-push)
      NO_PUSH=true
      shift
      ;;
    -h|--help)
      grep "^#" "$0" | grep -v "^#!/" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use -h or --help for usage information"
      exit 1
      ;;
  esac
done

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Validate directories exist
if [ ! -d "backend" ]; then
  echo "Error: backend directory not found. Are you in the project root?"
  exit 1
fi

if [ ! -d "frontend" ]; then
  echo "Error: frontend directory not found. Are you in the project root?"
  exit 1
fi

# Print configuration
echo "========================================"
echo "Hermes Docker Image Builder"
echo "========================================"
echo "Registry: $REGISTRY"
echo "Version:  $VERSION"
echo "Push:     $([ "$NO_PUSH" = true ] && echo "No" || echo "Yes")"
echo "========================================"
echo ""

# Backend services
services=("auth-service" "core-service" "reporting-service")

# Build and push backend services
for service in "${services[@]}"; do
  image_name="$REGISTRY/hermes-$service:$VERSION"
  
  echo "→ Building $image_name..."
  docker build \
    -t "$image_name" \
    -f "backend/$service/Dockerfile" \
    ./backend
  
  if [ "$NO_PUSH" = false ]; then
    echo "→ Pushing $image_name..."
    docker push "$image_name"
  fi
  
  echo "✓ Completed $service"
  echo ""
done

# Build and push frontend
frontend_image="$REGISTRY/hermes-frontend:$VERSION"

echo "→ Building $frontend_image..."
docker build -t "$frontend_image" ./frontend

if [ "$NO_PUSH" = false ]; then
  echo "→ Pushing $frontend_image..."
  docker push "$frontend_image"
fi

echo "✓ Completed frontend"
echo ""

# Summary
echo "========================================"
echo "Build Summary"
echo "========================================"
echo "✓ hermes-auth-service:$VERSION"
echo "✓ hermes-core-service:$VERSION"
echo "✓ hermes-reporting-service:$VERSION"
echo "✓ hermes-frontend:$VERSION"
echo ""
if [ "$NO_PUSH" = false ]; then
  echo "All images built and pushed successfully!"
  echo ""
  echo "Next steps:"
  echo "1. Update k8s deployment files with: $REGISTRY/hermes-*:$VERSION"
  echo "2. Deploy to Kubernetes: kubectl apply -f k8s/"
else
  echo "All images built successfully!"
  echo ""
  echo "Images are ready for local use or manual push"
fi
echo "========================================"
