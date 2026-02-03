# =============================================================================
# Hermes - Docker Image Build and Push Script (PowerShell)
# =============================================================================
# This script builds all Hermes Docker images and pushes them to a registry
#
# Usage:
#   .\build-and-push.ps1 [-Registry <registry>] [-Version <version>] [-NoPush]
#
# Parameters:
#   -Registry <string>  Docker registry (default: yourusername)
#   -Version <string>   Image version tag (default: latest)
#   -NoPush             Build only, don't push to registry
#   -Help               Show this help message
#
# Examples:
#   .\build-and-push.ps1 -Registry duosis -Version v1.0.0
#   .\build-and-push.ps1 -Registry yourregistry.azurecr.io -Version latest
#   .\build-and-push.ps1 -Registry ghcr.io/your-org -Version dev
#   .\build-and-push.ps1 -NoPush  # Build only without push
# =============================================================================

param(
    [string]$Registry = "yourusername",
    [string]$Version = "latest",
    [switch]$NoPush,
    [switch]$Help
)

# Show help
if ($Help) {
    Get-Content $PSCommandPath | Select-String "^#" | ForEach-Object { $_ -replace "^# ", "" }
    exit 0
}

# Error handling
$ErrorActionPreference = "Stop"

# Get script directory and navigate to project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Validate directories exist
if (-not (Test-Path "backend")) {
    Write-Error "Error: backend directory not found. Are you in the project root?"
    exit 1
}

if (-not (Test-Path "frontend")) {
    Write-Error "Error: frontend directory not found. Are you in the project root?"
    exit 1
}

# Print configuration
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Hermes Docker Image Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Registry: $Registry"
Write-Host "Version:  $Version"
Write-Host "Push:     $(if ($NoPush) { 'No' } else { 'Yes' })"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Backend services
$services = @("auth-service", "core-service", "reporting-service")

# Build and push backend services
foreach ($service in $services) {
    $imageName = "$Registry/hermes-$service`:$Version"
    
    Write-Host "→ Building $imageName..." -ForegroundColor Yellow
    docker build `
        -t $imageName `
        -f "backend/$service/Dockerfile" `
        ./backend
    
    if (-not $NoPush) {
        Write-Host "→ Pushing $imageName..." -ForegroundColor Yellow
        docker push $imageName
    }
    
    Write-Host "✓ Completed $service" -ForegroundColor Green
    Write-Host ""
}

# Build and push frontend
$frontendImage = "$Registry/hermes-frontend`:$Version"

Write-Host "→ Building $frontendImage..." -ForegroundColor Yellow
docker build -t $frontendImage ./frontend

if (-not $NoPush) {
    Write-Host "→ Pushing $frontendImage..." -ForegroundColor Yellow
    docker push $frontendImage
}

Write-Host "✓ Completed frontend" -ForegroundColor Green
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✓ hermes-auth-service:$Version" -ForegroundColor Green
Write-Host "✓ hermes-core-service:$Version" -ForegroundColor Green
Write-Host "✓ hermes-reporting-service:$Version" -ForegroundColor Green
Write-Host "✓ hermes-frontend:$Version" -ForegroundColor Green
Write-Host ""

if (-not $NoPush) {
    Write-Host "All images built and pushed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "1. Update k8s deployment files with: $Registry/hermes-*:$Version"
    Write-Host "2. Deploy to Kubernetes: kubectl apply -f k8s/"
} else {
    Write-Host "All images built successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Images are ready for local use or manual push"
}
Write-Host "========================================" -ForegroundColor Cyan
