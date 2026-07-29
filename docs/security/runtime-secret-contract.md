# Hermes Runtime Secret Contract

> Sprint 0 (CTO paketi, 2026-07-29). Bu doküman **tek doğruluk
> kaynağıdır**: hangi Secret nesnesi hangi key'lerle var olmalı ve kim
> tüketiyor. **Hiçbir gerçek değer içermez ve içermeyecektir.**
>
> Karar (kullanıcı/CTO): mevcut credential değerleri **rotate
> edilmedi**; çalışan Kubernetes Secret nesneleri **değiştirilmedi**.
> Yalnızca değer taşıyan dosyalar Git takibinden çıkarıldı. Eski
> commit'lerdeki kopyalar için bkz. §History.

## Sözleşme (namespace'ler: `hermes-dev`, `hermes-test`)

| Secret nesnesi | Zorunlu key'ler | Tüketiciler | Not |
|---|---|---|---|
| `hermes-secrets` | `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `AZURE_CLIENT_SECRET`, `RABBITMQ_PASSWORD` | db-auth, db-core StatefulSet'leri; auth/core/reporting Deployment'ları; api-cleanup CronJob | Değerler yalnızca cluster'da yaşar |
| `hermes-backup-secret` | `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `ONEDRIVE_USER`, `DB_PASSWORD` | backup CronJob | |
| `hermes-tls` | `tls.crt`, `tls.key` | 05-ingress, 09-mcp-ingress | Repo kökündeki tls.* dosyaları artık takip edilmiyor; kaynak cluster'dır |
| `hermes-jwt-auth` | `JWT_PRIVATE_KEY` (yalnız auth), `JWT_PUBLIC_KEY` (auth/core/reporting/cronjob) | 03-backend-* + api-cleanup | Manifesti repoda hiç olmadı (doğru durum) |
| `hermes-s2s` | `HERMES_S2S_TOKEN_CURRENT` (zorunlu sayılır), `HERMES_S2S_TOKEN_NEXT` (rotasyon yuvası, opsiyonel) | auth (CURRENT+NEXT), core (CURRENT) | Manifestte `optional: true`; ama S2S dizin + RBAC izin çözümü buna dayanır — yokluğu üretimde yönetim uçlarını 503 yapar |
| `ghcr-secret` | `.dockerconfigjson` | Tüm Deployment/CronJob `imagePullSecrets` | |

Doğrulama (değer okumadan): `./scripts/k8s/check-runtime-secrets.sh <namespace>`

## Değişmezler

1. Secret nesne adları ve key adları **API sözleşmesidir** — keyfi
   değiştirilemez; değişiklik tüm tüketici manifestleriyle birlikte
   planlanır.
2. Routine CD (cd-dev/cd-test) Secret **oluşturmaz, silmez, üzerine
   yazmaz**; yalnızca varlık preflight'ı koşar.
3. Örnek şablonlar (`k8s/**/*.example.yaml`) yalnızca
   `REQUIRED_FROM_OPERATOR` placeholder'ı taşır ve **asla doğrudan
   apply edilmez** (çalışan değeri ezersiniz).
4. Yeni ortam kurulumu/kurtarma: operatör, değerleri **repo dışı** bir
   kaynaktan (parola kasası / güvenli not) alıp example şablonunun
   kopyasını doldurarak `kubectl apply` eder; dosya repo çalışma
   ağacına konacaksa `.gitignore` zaten engeller, yine de tercihen
   `~/hermes-ops/` gibi repo dışı bir dizin kullanılır.
5. Test ortamı bootstrap'i: `k8s/test/apply-test-env.sh` — dev'den
   metadata taşımadan kopyalar, var olanı `--force-secrets` olmadan
   asla ezmez, hiçbir değeri stdout'a basmaz.

## Sahiplik ve kurtarma

- **Owner/operator:** CTO (kubectl erişimi yalnızca operatörde;
  CI kubeconfig'i GitHub Actions secret'ı `KUBE_CONFIG_B64`).
- **Kayıp değer senaryosu:** değerler yalnız cluster'daysa
  `kubectl get secret` ile operatör tarafından kurtarılabilir (değer
  gösteren komutlar yalnız operatör terminalinde; asla CI/rapora
  yapıştırılmaz). Kalıcı kasa (ör. şirket parola yöneticisi) önerilir —
  Sprint 0 kapsamı dışı, backlog.

## History

Eski commit'lerde (`f6882f1` ve öncesi) bu dosyaların gerçek değerli
kopyaları **hâlâ Git geçmişinde durur**. Current-tree containment bunu
temizlemez. Geçmiş temizliği ayrı, yüksek riskli, açık onaylı bir
operasyondur: `Hermes_Premium_Frontend_CTO_Pack_v1/12_GIT_HISTORY_CLEANUP_RUNBOOK.md`.
O yapılana kadar bu değerler **açığa çıkmış kabul edilmeli** ve
(kullanıcının açık kararıyla) rotate edilmeden kullanılmaya devam
edildiği bilinmelidir — risk kabulü CTO paketi `00_READ_FIRST` §Güvenlik'te.
