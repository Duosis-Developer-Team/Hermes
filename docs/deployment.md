# Hermes Platform - Kubernetes Deployment Guide

Bu döküman, Hermes Platform'un bir Kubernetes kümesine nasıl dağıtılacağını anlatır.

> **Sprint 0 güvenlik notu (2026-07-29):** Gerçek secret değerleri artık
> Git'te TUTULMAZ. `k8s/01-secrets.yaml` ve `k8s/*/backup-secret.yaml`
> takipten çıkarıldı; repoda yalnızca `*.example.yaml` şablonları vardır
> ve bunlar **doğrudan apply edilmez**. Tek doğruluk kaynağı:
> `docs/security/runtime-secret-contract.md`.

## Ön Gereksinimler

- **Kubernetes Cluster** (Minikube, AKS, EKS, GKE veya kendi sunucunuz)
- **kubectl** komut satırı aracı (Cluster'a erişim yetkisi ile)
- **Ingress Controller** (Nginx Ingress Controller kurulu olmalıdır)
- **Database Storage**: Cluster'ınızda PersistentVolumeProvisioner aktif olmalıdır.

## Kurulum Adımları

### 1. Namespace ve ConfigMap

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap.yaml
```

### 2. Runtime Secret'lar (repo dışı değerlerle)

Mevcut ortamlarda (`hermes-dev`, `hermes-test`) Secret nesneleri
**zaten cluster'dadır ve değiştirilmez** — bu adım yalnızca SIFIRDAN
ortam kurarken gerekir.

1. `k8s/01-secrets.example.yaml` ve `k8s/backup-secret.example.yaml`
   şablonlarını repo DIŞINDA bir dizine kopyalayın (ör. `~/hermes-ops/`).
2. `REQUIRED_FROM_OPERATOR` placeholder'larını, parola kasanızdan
   aldığınız gerçek değerlerle doldurun. Değerleri asla repoya, CI
   loguna veya rapora yazmayın.
3. Doldurduğunuz kopyaları apply edin; ardından dosyaları güvenli
   şekilde saklayın/silin:

```bash
kubectl apply -f ~/hermes-ops/01-secrets.yaml
kubectl apply -f ~/hermes-ops/backup-secret.yaml
# hermes-jwt-auth / hermes-s2s / hermes-tls / ghcr-secret: sözleşme ve
# oluşturma komutları için docs/security/runtime-secret-contract.md
```

### 3. Secret preflight (değer okumadan doğrulama)

Rutin her deploy'dan önce (CI bunu otomatik yapar):

```bash
./scripts/k8s/check-runtime-secrets.sh hermes-dev
```

Eksik nesne/key varsa deploy'a BAŞLAMAYIN — script non-zero döner ve
yalnızca eksik key ADINI söyler.

### 4. Uygulama (Apply)

```bash
# 1. Veritabanları (StatefulSets)
kubectl apply -f k8s/02-db-auth.yaml
kubectl apply -f k8s/02-db-core.yaml

# 2. Backend Servisleri
kubectl apply -f k8s/03-backend-auth.yaml
kubectl apply -f k8s/03-backend-core.yaml
kubectl apply -f k8s/03-backend-reporting.yaml

# 3. Frontend
kubectl apply -f k8s/04-frontend.yaml

# 4. Ingress (Yönlendirme)
kubectl apply -f k8s/05-ingress.yaml
```

Rutin CD (GitHub Actions) hiçbir Secret'ı oluşturmaz/ezmez; yalnızca
image set eder ve öncesinde preflight koşar.

### 5. Kontrol

```bash
kubectl get pods -n hermes-dev
```

Tüm pod'ların `STATUS: Running` olduğundan emin olun.

## Sorun Giderme

Eğer bir pod çalışmazsa loglarına bakın:

```bash
kubectl logs <pod-adi> -n hermes-dev
```

Özellikle veritabanı bağlantı hataları veya eksik Secret KEY'lerini
kontrol edin (`./scripts/k8s/check-runtime-secrets.sh hermes-dev`).
Secret değerlerini terminale yazdıran komutlardan kaçının.
