# =============================================================================
# HERMES PLATFORM - Frontend Dockerfile (Production)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Request
# -----------------------------------------------------------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Dependency kurulumu
COPY package.json package-lock.json ./
RUN npm ci

# Kaynak kod kopyalama ve build
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Server (Nginx)
# -----------------------------------------------------------------------------
FROM nginx:alpine

# Default nginx config temizle
RUN rm /etc/nginx/conf.d/default.conf

# Custom config ekle
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Build aşamasından çıkan dosyaları kopyala
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
