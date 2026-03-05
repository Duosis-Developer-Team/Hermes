#!/usr/bin/env bash
# =============================================================================
# Hermes Test Ortamı — Kurulum Scripti
# Kullanım: ~/Hermes dizininde çalıştırın → ./k8s/test/apply-test-env.sh
# UYARI: Bu script dev ortamına (hermes namespace) kesinlikle dokunmaz.
# =============================================================================

set -e

echo "========================================="
echo " HERMES TEST ORTAMI KURULUM SCRIPTI"
echo "========================================="
echo ""

# ---- ADIM 0: Test Nginx Controller ----
echo "[0/8] Test için ayrı Nginx Ingress Controller kuruluyor..."
kubectl apply -f k8s/test/06-nginx-test-controller.yaml
echo "✓ Nginx-test controller uygulandı. Hazır olması için bekleniyor (30s)..."
sleep 30
echo ""

# ---- ADIM 1: Namespace kontrol ve oluştur ----
echo "[1/8] hermes-test namespace oluşturuluyor..."
kubectl apply -f k8s/test/00-namespace.yaml
echo "✓ Namespace tamam."
echo ""

# ---- ADIM 2: ConfigMap ----
echo "[2/8] ConfigMap uygulanıyor..."
kubectl apply -f k8s/test/01-configmap.yaml
echo "✓ ConfigMap tamam."
echo ""

# ---- ADIM 3: Secrets — Dev'den kopyala ----
echo "[3/8] Secret'lar kopyalanıyor (dev → hermes-test)..."
kubectl get secret hermes-secrets --namespace=hermes -o yaml \
  | sed 's/namespace: hermes$/namespace: hermes-test/' \
  | kubectl apply -f -
echo "✓ hermes-secrets kopyalandı."
echo ""

# ---- ADIM 4: TLS Secret kopyala ----
echo "[4/8] TLS secret kopyalanıyor (dev → hermes-test)..."
# Önce dev namespace'in adını bul (hermes veya hermes-dev)
if kubectl get secret hermes-tls --namespace=hermes > /dev/null 2>&1; then
  kubectl get secret hermes-tls --namespace=hermes -o yaml \
    | sed 's/namespace: hermes$/namespace: hermes-test/' \
    | kubectl apply -f -
elif kubectl get secret hermes-tls --namespace=hermes-dev > /dev/null 2>&1; then
  kubectl get secret hermes-tls --namespace=hermes-dev -o yaml \
    | sed 's/namespace: hermes-dev$/namespace: hermes-test/' \
    | kubectl apply -f -
else
  echo "⚠️  hermes-tls bulunamadı. TLS sertifikası manuel oluşturuluyor..."
  kubectl create secret tls hermes-tls \
    --cert=tls.crt \
    --key=tls.key \
    --namespace=hermes-test
fi
echo "✓ TLS secret tamam."
echo ""

# ---- ADIM 5: GHCR Secret ----
echo "[5/8] GHCR pull secret kopyalanıyor..."
kubectl get secret ghcr-secret --namespace=hermes -o yaml \
  | sed 's/namespace: hermes$/namespace: hermes-test/' \
  | kubectl apply -f -
echo "✓ GHCR Secret kopyalandı."
echo ""

# ---- ADIM 6: Veritabanları ----
echo "[6/8] Veritabanı StatefulSet'ler oluşturuluyor..."
kubectl apply -f k8s/test/02-db-auth.yaml
kubectl apply -f k8s/test/02-db-core.yaml
echo "✓ Veritabanlar uygulandı. PVC bağlanması bekleniyor (30s)..."
sleep 30
echo ""

# ---- ADIM 7: Backend Servisler ----
echo "[7/8] Backend servisler oluşturuluyor..."
kubectl apply -f k8s/test/03-backend-auth.yaml
kubectl apply -f k8s/test/03-backend-core.yaml
kubectl apply -f k8s/test/03-backend-reporting.yaml
echo "✓ Backend servisler uygulandı."
echo ""

# ---- ADIM 8: Frontend + Ingress ----
echo "[8/8] Frontend ve Ingress uygulanıyor..."
kubectl apply -f k8s/test/04-frontend.yaml
kubectl apply -f k8s/test/05-ingress.yaml
echo "✓ Frontend ve Ingress uygulandı."
echo ""

# ---- DOĞRULAMA ----
echo "========================================="
echo " DOĞRULAMA"
echo "========================================="
echo ""
echo "--- hermes-test Pod Durumları ---"
kubectl get pods -n hermes-test
echo ""
echo "--- hermes-test Servisler ---"
kubectl get svc -n hermes-test
echo ""
echo "--- Nginx-test Controller ---"
kubectl get pods -n ingress-nginx-test
kubectl get svc -n ingress-nginx-test
echo ""
echo "--- ✓ DEV ORTAMI KONTROLÜ (değişmemiş olmalı) ---"
kubectl get pods -n hermes
echo ""
echo "========================================="
echo " KURULUM TAMAMLANDI"
echo " Dev:  https://84.247.180.172:30772"
echo " Test: https://84.247.180.172:30443"
echo "========================================="

