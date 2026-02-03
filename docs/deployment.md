# Hermes Platform - Kubernetes Deployment Guide

Bu döküman, Hermes Platform'un bir Kubernetes kümesine nasıl dağıtılacağını anlatır.

## Ön Gereksinimler

- **Kubernetes Cluster** (Minikube, AKS, EKS, GKE veya kendi sunucunuz)
- **kubectl** komut satırı aracı (Cluster'a erişim yetkisi ile)
- **Ingress Controller** (Nginx Ingress Controller kurulu olmalıdır)
- **Database Storage**: Cluster'ınızda PersistentVolumeProvisioner aktif olmalıdır.

## Kurulum Adımları

### 1. Hazırlık ve Secrets

Dağıtıma başlamadan önce **hassas verileri** düzenlemeniz gerekir.

1. `k8s/01-secrets.yaml` dosyasını açın.
2. İçerisindeki `REPLACE_WITH_BASE64_...` değerlerini **Base64 encoded** gerçek şifrelerinizle değiştirin.
   
   ```bash
   # Örnek: Şifre "gizlisifrem" ise
   echo -n "gizlisifrem" | base64
   # Çıktı: Z2l6bGlzaWZyZW0=
   ```
3. (Opsiyonel) `k8s/01-configmap.yaml` dosyasındaki ayarları ortamınıza göre düzenleyin (Örn: Domain adları vs.).

### 2. Uygulama (Apply)

Manifest dosyalarını sırasıyla uygulayın:

```bash
# 1. Namespace, ConfigMap ve Secrets
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap.yaml
kubectl apply -f k8s/01-secrets.yaml

# 2. Veritabanları (StatefulSets)
kubectl apply -f k8s/02-db-auth.yaml
kubectl apply -f k8s/02-db-core.yaml

# 3. Backend Servisleri
kubectl apply -f k8s/03-backend-auth.yaml
kubectl apply -f k8s/03-backend-core.yaml
kubectl apply -f k8s/03-backend-reporting.yaml

# 4. Frontend
kubectl apply -f k8s/04-frontend.yaml

# 5. Ingress (Yönlendirme)
kubectl apply -f k8s/05-ingress.yaml
```

### 3. Kontrol

Her şeyin çalıştığından emin olmak için:

```bash
kubectl get pods -n hermes
```

Tüm pod'ların `STATUS: Running` olduğundan emin olun.

## Sorun Giderme

Eğer bir pod çalışmazsa loglarına bakın:

```bash
kubectl logs <pod-adi> -n hermes
```

Özellikle veritabanı bağlantı hataları veya eksik/hatalı Secret değerlerini kontrol edin.
