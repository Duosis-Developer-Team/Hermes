# Hermes Kubernetes Deployment Guide

This guide provides step-by-step instructions for deploying the Hermes application to a Kubernetes cluster. The configuration supports multi-namespace deployments for different environments (dev, test, prod).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Multi-Namespace Deployment](#multi-namespace-deployment)
- [Detailed Deployment Steps](#detailed-deployment-steps)
- [Configuration](#configuration)
- [Accessing the Application](#accessing-the-application)
- [Troubleshooting](#troubleshooting)
- [Cleanup](#cleanup)

## Prerequisites

Before deploying, ensure you have:

1. **Kubernetes Cluster**: A running Kubernetes cluster (v1.19+)
   ```bash
   kubectl version --short
   kubectl cluster-info
   ```

2. **kubectl**: Kubernetes CLI tool installed and configured
   ```bash
   kubectl config current-context
   ```

3. **Container Images**: Build and push all Docker images to a registry
   ```bash
   # Example for Docker Hub
   docker build -t yourusername/hermes-auth-service:latest ./backend/auth-service
   docker build -t yourusername/hermes-core-service:latest ./backend/core-service
   docker build -t yourusername/hermes-reporting-service:latest ./backend/reporting-service
   docker build -t yourusername/hermes-frontend:latest ./frontend
   
   docker push yourusername/hermes-auth-service:latest
   docker push yourusername/hermes-core-service:latest
   docker push yourusername/hermes-reporting-service:latest
   docker push yourusername/hermes-frontend:latest
   ```

4. **NGINX Ingress Controller**: Required for external access
   ```bash
   # Install NGINX Ingress Controller
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml
   
   # Verify installation
   kubectl get pods -n ingress-nginx
   ```

5. **Storage Class**: A default storage class for persistent volumes
   ```bash
   kubectl get storageclass
   ```

## Architecture Overview

The Hermes application consists of:

- **Frontend**: React application (Nginx)
- **Auth Service**: User authentication and authorization (FastAPI)
- **Core Service**: Main business logic (FastAPI)
- **Reporting Service**: Report generation (FastAPI)
- **Auth Database**: PostgreSQL for user data
- **Core Database**: TimescaleDB for time-series data

## Quick Start

Deploy to the default `hermes` namespace:

```bash
# Navigate to k8s directory
cd k8s

# 1. Update image references in deployment files (see Configuration section)
# 2. Configure secrets (see Configuration section)

# 3. Apply all configurations in order
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-configmap.yaml
kubectl apply -f 01-secrets.yaml
kubectl apply -f 02-db-auth.yaml
kubectl apply -f 02-db-core.yaml

# Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app=auth-db -n hermes --timeout=300s
kubectl wait --for=condition=ready pod -l app=core-db -n hermes --timeout=300s

# Deploy application services
kubectl apply -f 03-backend-auth.yaml
kubectl apply -f 03-backend-core.yaml
kubectl apply -f 03-backend-reporting.yaml
kubectl apply -f 04-frontend.yaml
kubectl apply -f 05-ingress.yaml

# Check deployment status
kubectl get all -n hermes
```

## Multi-Namespace Deployment

To deploy the application in different namespaces (e.g., `dev`, `test`, `prod`):

### Method 1: Using sed to replace namespace

```bash
# Set your target namespace
NAMESPACE="dev"

# Create namespace
kubectl create namespace $NAMESPACE

# Deploy with namespace replacement
for file in *.yaml; do
  sed "s/namespace: hermes/namespace: $NAMESPACE/g" $file | kubectl apply -f -
done
```

### Method 2: Using kustomize (Recommended)

Create environment-specific overlays:

```bash
# Directory structure:
# k8s/
# ├── base/              (your current .yaml files)
# └── overlays/
#     ├── dev/
#     │   └── kustomization.yaml
#     ├── test/
#     │   └── kustomization.yaml
#     └── prod/
#         └── kustomization.yaml
```

Example `overlays/dev/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: hermes-dev

resources:
  - ../../base

patches:
  - target:
      kind: ConfigMap
      name: hermes-config
    patch: |-
      - op: replace
        path: /data/ENVIRONMENT
        value: development
      - op: replace
        path: /data/LOG_LEVEL
        value: DEBUG

images:
  - name: hermes-auth-service
    newTag: dev-latest
  - name: hermes-core-service
    newTag: dev-latest
  - name: hermes-reporting-service
    newTag: dev-latest
  - name: hermes-frontend
    newTag: dev-latest
```

Deploy using kustomize:
```bash
kubectl apply -k overlays/dev
kubectl apply -k overlays/test
kubectl apply -k overlays/prod
```

### Method 3: Manual deployment with custom values

```bash
# For each environment, create modified copies
NAMESPACE="test"

# 1. Create namespace
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE
EOF

# 2. Create ConfigMap with environment-specific values
kubectl create configmap hermes-config \
  --namespace=$NAMESPACE \
  --from-literal=DB_HOST_AUTH=auth-db \
  --from-literal=DB_HOST_CORE=core-db \
  --from-literal=DB_PORT=5432 \
  --from-literal=POSTGRES_USER=hermes \
  --from-literal=POSTGRES_DB_AUTH=auth_db \
  --from-literal=POSTGRES_DB_CORE=core_db \
  --from-literal=AUTH_SERVICE_URL=http://auth-service/api/v1 \
  --from-literal=CORE_SERVICE_URL=http://core-service/api/v1 \
  --from-literal=REPORTING_SERVICE_URL=http://reporting-service/api/v1 \
  --from-literal=ENVIRONMENT=test \
  --from-literal=LOG_LEVEL=DEBUG

# 3. Create Secrets (encode values first)
kubectl create secret generic hermes-secrets \
  --namespace=$NAMESPACE \
  --from-literal=POSTGRES_PASSWORD=$(echo -n 'your-password' | base64) \
  --from-literal=JWT_SECRET_KEY=$(openssl rand -hex 32 | base64) \
  --from-literal=AZURE_CLIENT_SECRET=$(echo -n 'your-azure-secret' | base64) \
  --from-literal=RABBITMQ_PASSWORD=$(echo -n 'your-rabbitmq-pass' | base64)

# 4. Deploy resources with namespace override
for file in 02-*.yaml 03-*.yaml 04-*.yaml 05-*.yaml; do
  sed "s/namespace: hermes/namespace: $NAMESPACE/g" $file | kubectl apply -f -
done
```

### Environment-Specific Ingress Configuration

For multiple environments, you may want different hostnames:

```yaml
# dev-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hermes-ingress
  namespace: hermes-dev
spec:
  ingressClassName: nginx
  rules:
  - host: dev.hermes.example.com
    http:
      paths:
      # ... same paths as original ingress

# test-ingress.yaml
  - host: test.hermes.example.com
    # ...

# prod-ingress.yaml
  - host: hermes.example.com
    # ...
```

## Detailed Deployment Steps

### Step 1: Prepare Docker Images

Update image references in deployment files to point to your registry:

```bash
# Edit these files and replace image names:
# - 03-backend-auth.yaml: line 20
# - 03-backend-core.yaml: line 20
# - 03-backend-reporting.yaml: line 20
# - 04-frontend.yaml: line 20

# Example:
# image: hermes-auth-service:latest
# becomes:
# image: yourusername/hermes-auth-service:latest
# or
# image: registry.example.com/hermes/auth-service:v1.0.0
```

### Step 2: Configure Secrets

**IMPORTANT**: Update `01-secrets.yaml` with actual base64-encoded values:

```bash
# Generate secure passwords and secrets
DB_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -hex 32)
AZURE_SECRET="your-azure-client-secret"
RABBITMQ_PASS=$(openssl rand -base64 32)

# Encode values (macOS/Linux)
echo -n "$DB_PASSWORD" | base64
echo -n "$JWT_SECRET" | base64
echo -n "$AZURE_SECRET" | base64
echo -n "$RABBITMQ_PASS" | base64

# Encode values (Windows PowerShell)
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("$DB_PASSWORD"))
```

Edit `01-secrets.yaml` and replace placeholder values:
```yaml
data:
  POSTGRES_PASSWORD: "BASE64_ENCODED_VALUE"
  JWT_SECRET_KEY: "BASE64_ENCODED_VALUE"
  AZURE_CLIENT_SECRET: "BASE64_ENCODED_VALUE"
  RABBITMQ_PASSWORD: "BASE64_ENCODED_VALUE"
```

### Step 3: Deploy Infrastructure

```bash
# Create namespace
kubectl apply -f 00-namespace.yaml

# Apply configuration
kubectl apply -f 01-configmap.yaml
kubectl apply -f 01-secrets.yaml

# Verify ConfigMap and Secrets
kubectl get configmap hermes-config -n hermes -o yaml
kubectl get secret hermes-secrets -n hermes
```

### Step 4: Deploy Databases

```bash
# Deploy databases
kubectl apply -f 02-db-auth.yaml
kubectl apply -f 02-db-core.yaml

# Monitor database startup
kubectl get pods -n hermes -w

# Check logs if needed
kubectl logs -n hermes -l app=auth-db
kubectl logs -n hermes -l app=core-db

# Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app=auth-db -n hermes --timeout=300s
kubectl wait --for=condition=ready pod -l app=core-db -n hermes --timeout=300s
```

### Step 5: Initialize Database Schemas

After databases are running, initialize schemas:

```bash
# Option 1: Run SQL scripts manually
kubectl exec -n hermes -it auth-db-0 -- psql -U hermes -d auth_db -f /path/to/schema.sql

# Option 2: Use a Kubernetes Job (recommended - see Additional Resources section)

# Option 3: Connect from your local machine
kubectl port-forward -n hermes svc/auth-db 5432:5432 &
psql -h localhost -U hermes -d auth_db -f ../backend/sql_scripts/auth_db.sql

kubectl port-forward -n hermes svc/core-db 5433:5432 &
psql -h localhost -p 5433 -U hermes -d core_db -f ../backend/sql_scripts/core_db.sql
```

### Step 6: Deploy Application Services

```bash
# Deploy backend services
kubectl apply -f 03-backend-auth.yaml
kubectl apply -f 03-backend-core.yaml
kubectl apply -f 03-backend-reporting.yaml

# Deploy frontend
kubectl apply -f 04-frontend.yaml

# Monitor deployments
kubectl get deployments -n hermes
kubectl rollout status deployment/auth-service -n hermes
kubectl rollout status deployment/core-service -n hermes
kubectl rollout status deployment/reporting-service -n hermes
kubectl rollout status deployment/frontend -n hermes
```

### Step 7: Configure Ingress

```bash
# Deploy ingress
kubectl apply -f 05-ingress.yaml

# Get ingress details
kubectl get ingress -n hermes
kubectl describe ingress hermes-ingress -n hermes

# Get the external IP (may take a few minutes)
kubectl get svc -n ingress-nginx
```

## Configuration

### ConfigMap Settings

Edit `01-configmap.yaml` to customize:

| Key | Description | Default |
|-----|-------------|---------|
| `DB_HOST_AUTH` | Auth database hostname | `auth-db` |
| `DB_HOST_CORE` | Core database hostname | `core-db` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | Database username | `hermes` |
| `POSTGRES_DB_AUTH` | Auth database name | `auth_db` |
| `POSTGRES_DB_CORE` | Core database name | `core_db` |
| `AUTH_SERVICE_URL` | Internal auth service URL | `http://auth-service/api/v1` |
| `CORE_SERVICE_URL` | Internal core service URL | `http://core-service/api/v1` |
| `REPORTING_SERVICE_URL` | Internal reporting service URL | `http://reporting-service/api/v1` |
| `ENVIRONMENT` | Environment name | `production` |
| `LOG_LEVEL` | Logging level | `INFO` |

### Secret Values

The following secrets must be configured in `01-secrets.yaml` (base64 encoded):

| Key | Description | How to Generate |
|-----|-------------|-----------------|
| `POSTGRES_PASSWORD` | Database password | `openssl rand -base64 32` |
| `JWT_SECRET_KEY` | JWT signing key | `openssl rand -hex 32` |
| `AZURE_CLIENT_SECRET` | Azure AD client secret | From Azure Portal |
| `RABBITMQ_PASSWORD` | RabbitMQ password (if used) | `openssl rand -base64 32` |

### Resource Limits

Current resource allocation per service:

| Service | Memory Request | Memory Limit | CPU Request | CPU Limit |
|---------|---------------|--------------|-------------|-----------|
| Auth Service | 128Mi | 512Mi | 100m | 500m |
| Core Service | 128Mi | 512Mi | 100m | 500m |
| Reporting Service | 128Mi | 512Mi | 100m | 500m |
| Frontend | 64Mi | 256Mi | 50m | 200m |
| Auth DB | - | - | - | - |
| Core DB | - | - | - | - |

Adjust these values based on your cluster capacity and workload requirements.

### Storage Configuration

Databases use persistent volumes with:
- **Access Mode**: ReadWriteOnce
- **Storage Size**: 1Gi per database

To change storage size, edit the `volumeClaimTemplates` section in:
- `02-db-auth.yaml` (line 47)
- `02-db-core.yaml` (line 47)

## Accessing the Application

### Via Ingress (Production)

If you have a domain configured:
```
https://yourdomain.com/              # Frontend
https://yourdomain.com/api/v1/auth   # Auth Service
https://yourdomain.com/api/v1/...    # Core Service
https://yourdomain.com/api/v1/reports # Reporting Service
```

### Via Port Forwarding (Development/Testing)

```bash
# Forward frontend
kubectl port-forward -n hermes svc/frontend 8080:80

# Forward auth service
kubectl port-forward -n hermes svc/auth-service 8000:80

# Forward core service
kubectl port-forward -n hermes svc/core-service 8001:80

# Forward reporting service
kubectl port-forward -n hermes svc/reporting-service 8002:80

# Access application
# Frontend: http://localhost:8080
# Auth API: http://localhost:8000/api/v1
# Core API: http://localhost:8001/api/v1
# Reporting API: http://localhost:8002/api/v1
```

### Via LoadBalancer (Cloud Providers)

If your cluster supports LoadBalancer services:

```bash
# Change service type to LoadBalancer
kubectl patch svc frontend -n hermes -p '{"spec": {"type": "LoadBalancer"}}'

# Get external IP
kubectl get svc frontend -n hermes
```

## Troubleshooting

### Check Pod Status

```bash
# List all resources
kubectl get all -n hermes

# Check pod status
kubectl get pods -n hermes

# Describe a pod
kubectl describe pod <pod-name> -n hermes

# View pod logs
kubectl logs <pod-name> -n hermes

# View previous logs (if pod crashed)
kubectl logs <pod-name> -n hermes --previous

# Follow logs
kubectl logs -f <pod-name> -n hermes
```

### Common Issues

#### 1. Pods in ImagePullBackOff state

**Problem**: Cannot pull Docker images

**Solution**:
```bash
# Check image name and tag in deployment files
kubectl describe pod <pod-name> -n hermes

# If using private registry, create image pull secret
kubectl create secret docker-registry regcred \
  --docker-server=<your-registry> \
  --docker-username=<username> \
  --docker-password=<password> \
  --namespace=hermes

# Add imagePullSecrets to deployment
spec:
  template:
    spec:
      imagePullSecrets:
      - name: regcred
```

#### 2. Database Connection Errors

**Problem**: Services cannot connect to databases

**Solution**:
```bash
# Check database pods are running
kubectl get pods -n hermes | grep db

# Check database logs
kubectl logs -n hermes auth-db-0
kubectl logs -n hermes core-db-0

# Test database connectivity from a pod
kubectl exec -it <service-pod> -n hermes -- nc -zv auth-db 5432

# Verify ConfigMap and Secrets
kubectl get configmap hermes-config -n hermes -o yaml
kubectl get secret hermes-secrets -n hermes
```

#### 3. Ingress Not Working

**Problem**: Cannot access application via ingress

**Solution**:
```bash
# Check ingress status
kubectl get ingress -n hermes
kubectl describe ingress hermes-ingress -n hermes

# Check ingress controller is running
kubectl get pods -n ingress-nginx

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller

# Test services directly
kubectl port-forward -n hermes svc/frontend 8080:80
curl http://localhost:8080
```

#### 4. Persistent Volume Issues

**Problem**: Pods stuck in Pending state due to PVC

**Solution**:
```bash
# Check PVC status
kubectl get pvc -n hermes

# Describe PVC
kubectl describe pvc <pvc-name> -n hermes

# Check storage class
kubectl get storageclass

# Check if default storage class exists
kubectl get storageclass | grep default
```

### Debug Commands

```bash
# Get events
kubectl get events -n hermes --sort-by='.lastTimestamp'

# Execute commands in a pod
kubectl exec -it <pod-name> -n hermes -- /bin/sh

# Copy files from pod
kubectl cp hermes/<pod-name>:/path/to/file ./local-file

# Check resource usage
kubectl top nodes
kubectl top pods -n hermes

# View full cluster state
kubectl get all --all-namespaces
```

## Cleanup

### Remove Specific Namespace

```bash
# Delete all resources in namespace
kubectl delete namespace hermes

# Or delete individually
kubectl delete -f 05-ingress.yaml
kubectl delete -f 04-frontend.yaml
kubectl delete -f 03-backend-reporting.yaml
kubectl delete -f 03-backend-core.yaml
kubectl delete -f 03-backend-auth.yaml
kubectl delete -f 02-db-core.yaml
kubectl delete -f 02-db-auth.yaml
kubectl delete -f 01-secrets.yaml
kubectl delete -f 01-configmap.yaml
kubectl delete -f 00-namespace.yaml
```

### Remove All Hermes Deployments (Multi-Namespace)

```bash
# List all hermes namespaces
kubectl get namespaces | grep hermes

# Delete each namespace
kubectl delete namespace hermes-dev
kubectl delete namespace hermes-test
kubectl delete namespace hermes-prod
```

### Cleanup Persistent Volumes

```bash
# Check for remaining PVs
kubectl get pv | grep hermes

# Delete manually if needed
kubectl delete pv <pv-name>
```

## Additional Resources

### Database Initialization Job

Create `02-db-init-job.yaml` for automated schema initialization:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-init-auth
  namespace: hermes
spec:
  template:
    spec:
      containers:
      - name: db-init
        image: postgres:15-alpine
        command:
        - sh
        - -c
        - |
          psql postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$DB_PORT/$POSTGRES_DB < /scripts/auth_db.sql
        env:
        - name: DB_HOST
          value: auth-db
        - name: DB_PORT
          value: "5432"
        - name: POSTGRES_USER
          valueFrom:
            configMapKeyRef:
              name: hermes-config
              key: POSTGRES_USER
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: hermes-secrets
              key: POSTGRES_PASSWORD
        - name: POSTGRES_DB
          valueFrom:
            configMapKeyRef:
              name: hermes-config
              key: POSTGRES_DB_AUTH
        volumeMounts:
        - name: sql-scripts
          mountPath: /scripts
      volumes:
      - name: sql-scripts
        configMap:
          name: sql-scripts
      restartPolicy: OnFailure
```

### Health Checks

Add liveness and readiness probes to deployments:

```yaml
# Example for auth-service
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 8000
  initialDelaySeconds: 30
  periodSeconds: 10
  
readinessProbe:
  httpGet:
    path: /api/v1/ready
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 5
```

### Horizontal Pod Autoscaling

Create HPA for automatic scaling:

```bash
kubectl autoscale deployment auth-service \
  --namespace=hermes \
  --cpu-percent=70 \
  --min=1 \
  --max=5
```

## Support

For issues and questions:
- Check application logs: `kubectl logs -n hermes <pod-name>`
- Review Kubernetes events: `kubectl get events -n hermes`
- Consult the main documentation: [../docs/deployment.md](../docs/deployment.md)

---

**Last Updated**: February 2026
**Kubernetes Version**: 1.19+
**NGINX Ingress Controller Version**: 1.8.1+
