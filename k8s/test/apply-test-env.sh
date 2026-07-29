#!/usr/bin/env bash
# =============================================================================
# Hermes Test Ortamı — Kurulum Scripti (Sprint 0 güvenli sürüm, 2026-07-29)
# Kullanım: repo kökünde → ./k8s/test/apply-test-env.sh [--force-secrets]
# UYARI: Bu script dev ortamına (hermes-dev) kesinlikle dokunmaz.
#
# Sprint 0 değişiklikleri (CTO paketi §9):
#   - Secret kopyalama artık resourceVersion/uid/creationTimestamp/
#     managedFields gibi metadata TAŞIMAZ (temiz nesne oluşturur).
#   - Hedefte Secret zaten VARSA varsayılan davranış DOKUNMAMAKTIR;
#     üzerine yazmak için açık `--force-secrets` bayrağı gerekir.
#   - Hiçbir secret değeri stdout'a basılmaz (pipe içinde kalır).
#   - TLS fallback'i artık repo kökündeki tls.crt/tls.key dosyalarına
#     BAĞIMLI DEĞİLDİR (o dosyalar Git'ten çıkarıldı). hermes-tls
#     dev'de yoksa script açık hata verir; kurtarma yolu için
#     docs/security/runtime-secret-contract.md'ye bakın.
# =============================================================================

set -euo pipefail

FORCE_SECRETS=0
[ "${1:-}" = "--force-secrets" ] && FORCE_SECRETS=1

command -v python3 >/dev/null || { echo "python3 gerekli (secret metadata temizliği için)"; exit 2; }

# Dev'den test'e TEK secret'ı güvenle kopyalar. Değerler pipe içinde
# kalır; terminale yazılmaz. Metadata temizlenir; hedefte varsa ve
# --force-secrets verilmediyse SKIP.
copy_secret() {
  local name="$1"
  if kubectl get secret "$name" -n hermes-test >/dev/null 2>&1; then
    if [ "$FORCE_SECRETS" -eq 1 ]; then
      echo "  ! $name hermes-test'te var — --force-secrets ile YENİDEN yazılıyor"
      kubectl delete secret "$name" -n hermes-test
    else
      echo "  = $name hermes-test'te zaten var — DOKUNULMADI (üzerine yazmak için --force-secrets)"
      return 0
    fi
  fi
  if ! kubectl get secret "$name" -n hermes-dev >/dev/null 2>&1; then
    echo "  ✗ $name hermes-dev'de YOK — kopyalanamadı. Kurtarma: docs/security/runtime-secret-contract.md"
    return 1
  fi
  kubectl get secret "$name" -n hermes-dev -o json \
    | python3 -c '
import json, sys
o = json.load(sys.stdin)
o["metadata"] = {
    "name": o["metadata"]["name"],
    "namespace": "hermes-test",
    "labels": o["metadata"].get("labels", {}),
}
json.dump(o, sys.stdout)
' \
    | kubectl create -f - >/dev/null
  echo "  ✓ $name kopyalandı (metadata temiz, değer basılmadı)"
}

echo "========================================="
echo " HERMES TEST ORTAMI KURULUM SCRIPTI"
echo "========================================="

echo "[0/8] Test için ayrı Nginx Ingress Controller kuruluyor..."
kubectl apply -f k8s/test/06-nginx-test-controller.yaml
echo "✓ Nginx-test controller uygulandı. Hazır olması için bekleniyor (30s)..."
sleep 30

echo "[1/8] hermes-test namespace oluşturuluyor..."
kubectl apply -f k8s/test/00-namespace.yaml

echo "[2/8] ConfigMap uygulanıyor..."
kubectl apply -f k8s/test/01-configmap.yaml

echo "[3/8] Runtime Secret'lar (dev → hermes-test, overwrite YOK)..."
copy_secret hermes-secrets
copy_secret hermes-backup-secret
copy_secret hermes-jwt-auth
copy_secret hermes-s2s

echo "[4/8] TLS secret..."
copy_secret hermes-tls || {
  echo "  hermes-tls dev'de yok. Operatör, sertifika dosyalarının REPO DIŞI"
  echo "  yolundan manuel oluşturmalı:"
  echo "    kubectl create secret tls hermes-tls --cert=<path>/tls.crt --key=<path>/tls.key -n hermes-test"
  exit 1
}

echo "[5/8] GHCR pull secret..."
copy_secret ghcr-secret

echo "[5b/8] Secret preflight (değer okumadan doğrulama)..."
./scripts/k8s/check-runtime-secrets.sh hermes-test

echo "[6/8] Veritabanı StatefulSet'ler oluşturuluyor..."
kubectl apply -f k8s/test/02-db-auth.yaml
kubectl apply -f k8s/test/02-db-core.yaml
echo "✓ Veritabanlar uygulandı. PVC bağlanması bekleniyor (30s)..."
sleep 30

echo "[7/8] Backend servisler oluşturuluyor..."
kubectl apply -f k8s/test/03-backend-auth.yaml
kubectl apply -f k8s/test/03-backend-core.yaml
kubectl apply -f k8s/test/03-backend-reporting.yaml

echo "[8/8] Frontend ve Ingress uygulanıyor..."
kubectl apply -f k8s/test/04-frontend.yaml
kubectl apply -f k8s/test/05-ingress.yaml

echo "========================================="
echo " DOĞRULAMA"
echo "========================================="
echo "--- hermes-test Pod Durumları ---"
kubectl get pods -n hermes-test
echo "--- hermes-test Servisler ---"
kubectl get svc -n hermes-test
echo "--- Nginx-test Controller ---"
kubectl get pods -n ingress-nginx-test
kubectl get svc -n ingress-nginx-test
echo "--- ✓ DEV ORTAMI KONTROLÜ (değişmemiş olmalı) ---"
kubectl get pods -n hermes-dev
echo "========================================="
echo " KURULUM TAMAMLANDI"
echo " Dev:  https://84.247.180.172:30772"
echo " Test: https://84.247.180.172:30443"
echo "========================================="
