# =============================================================================
# HERMES PLATFORM - Frontend Dockerfile (Production)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Request
# -----------------------------------------------------------------------------
FROM docker.io/library/node:18-alpine AS builder

WORKDIR /app

# Dependency kurulumu
COPY package.json package-lock.json ./
RUN npm ci

# Kaynak kod kopyalama
COPY . .

# Azure build-time args (GitHub Actions secret'larından geçirilir)
ARG VITE_AZURE_CLIENT_ID
ARG VITE_AZURE_TENANT_ID
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID
ENV VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Server (Nginx)
# -----------------------------------------------------------------------------
FROM docker.io/library/nginx:alpine

# Default nginx config temizle
RUN rm /etc/nginx/conf.d/default.conf

# Custom config ekle
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Build aşamasından çıkan dosyaları kopyala
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
