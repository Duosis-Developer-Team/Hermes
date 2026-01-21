Teknik Mimari Dokümanı (TAD): Hermes Platformu v1.0
Sürüm: 1.0 (MVP)
Tarih: 4 Kasım 2025

1.0 Yönetici Özeti ve Mimari Hedefler
Bu doküman, Hermes Platformu'nun v1.0 (MVP) gereksinimlerini karşılayacak teknik altyapısını, bileşenlerini ve tasarım kararlarını detaylandırmaktadır.
Temel Kısıtlamalar:
●	Mimari: Mikroservis Mimarisi
●	Dağıtım: Kubernetes (K8s)
●	Backend: Python 3.11+ / FastAPI
●	İletişim: API-First (Tüm iletişim API üzerinden)
●	Veritabanı: Doğrudan dış erişime kapalı, servis bazlı PostgreSQL.
●	Frontend: Modern ve hızlı bir SPA (Single Page Application).
v1.0 Mimari Hedefleri:
1.	Merkezi Veri Toplama: Zaman girişlerini (timesheet) ve temel konfigürasyon verilerini (Müşteri, Proje) tek bir merkezi yapıda toplamak.
2.	Basit Raporlama: v1.0 PRD'sinde talep edilen temel Excel ve dashboard raporlarını sunabilmek.
3.	Ölçeklenebilirlik: Altyapıyı, gelecekteki (v2.0) karmaşık özellikleri (RBAC, Wiki) destekleyecek şekilde temel düzeyde ölçeklenebilir kurmak.
4.	Güvenlik: API Gateway ve servis-içi yetkilendirme ile "Sıfır Güven" (Zero Trust) ağ modelini benimsemek.
 
2.0 Üst Düzey Mimari Şeması (v1.0)
Platform, bir API Gateway arkasında konumlanan, birbirleriyle API üzerinden haberleşen üç ana backend servisi ve bir frontend uygulamasından oluşur. (v2.0'daki wiki-service ve v1.0 için ertelenen Olay Veriyolu bu şemada yer almaz).
[Kullanıcı Cihazı (Web Tarayıcı)]
          |
          v
[Kubernetes Ingress (API Gateway - örn: NGINX)]
(SSL Sonlandırma, İstek Yönlendirme, JWT Doğrulama)
          |
+-------------------------------------------------------------+
| Kubernetes Cluster (Sanal Özel Ağ - VPC)                    |
|                                                             |
|   [Frontend (React/Vite)] <-- (Statik dosyaları sunar)        |
|     (Deployment)                                            |
|                                                             |
|   [auth-service (FastAPI)] <---> [auth_db (PostgreSQL)]     |
|     (Deployment)                 (StatefulSet)              |
|                                                             |
|   [core-service (FastAPI)] <---> [core_db (PostgreSQL)]     |
|     (Deployment)                 (StatefulSet)              |
|                                                             |
|   [reporting-service (FastAPI)]                             |
|     (Deployment)                                            |
|                                                             |
+-------------------------------------------------------------+
          |
          | (Senkron API Çağrıları)
          | ( örn: reporting -> core )
          | ( örn: reporting -> auth )
          v
(Servisler arası iletişim K8s iç ağı (ClusterIP) üzerinden sağlanır)


3.0 Servis Tanımları (Mikroservisler v1.0)
3.1. auth-service (Kimlik & Yetki Servisi)
●	Sorumluluk: Kullanıcı kimlik doğrulaması (Authentication) ve v1.0'daki basit yetkilendirme (Admin/Standart Kullanıcı) mantığından sorumludur.
●	Temel Görevler:
○	Kullanıcı kaydı, E-posta/Şifre ile giriş (JWT token üretimi).
○	Kullanıcı yönetimi (CRUD) (v1.0 FR 3.4).
○	Basit rol ayrımı (Admin / Standart Kullanıcı) kontrolü.
○	Diğer servislere (örn. reporting-service) kullanıcı adı/ID eşleştirme verisi sunmak.
●	Veritabanı: auth_db
3.2. core-service (Çekirdek / Zaman Yönetimi Servisi)
●	Sorumluluk: Platformun temel iş mantığı olan zaman girişleri (Work Logs) ve bu girişlerin dayandığı "Workspace Konfigürasyonundan" sorumludur.
●	Temel Görevler:
○	v1.0 (FR 3.1, 3.2, 3.3): Müşteri (Customer), Proje (Project), İş Tipi (Work Type) için tam CRUD işlemleri.
○	v1.0 (FR 2.x): Zaman girişi (WorkLog) oluşturma, listeleme, güncelleme, silme.
●	Veritabanı: core_db
3.3. reporting-service (Raporlama & Analitik Servisi)
●	Sorumluluk: v1.0'da talep edilen tüm Excel raporlamalarını (FR 4.x) ve görsel panel (dashboard) verilerini (FR 5.x) hazırlamaktan sorumludur.
●	Temel Görevler:
○	v1.0 (FR 4.x): Temel Excel dökümü ve v1 dashboard widget verilerini sağlamak.
○	Raporlama ve dashboard'lar için gereken verileri core-service (zaman girişleri) ve auth-service (kullanıcı isimleri) servislerinden API yoluyla anlık (on-the-fly) olarak çeker, işler ve sunar.
○	Not: v1.0'da bu servis stateless (durumsuz) çalışır ve kendine ait bir veritabanı (reporting_db) bulunmaz.
●	Veritabanı: Yok.
4.0 Veritabanı Şemaları (PostgreSQL v1.0)
v1.0 (MVP) gereksinimlerini karşılayan, sadeleştirilmiş şemalar:
4.1. auth_db (Sorumlu: auth-service)
-- Kullanıcılar (v1.0 basit rol modeli)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    -- v1.0 (FR 1.2) için basit boolean/flag rolü.
    is_admin BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

4.2. core_db (Sorumlu: core-service)
-- Müşteriler (v1.0 FR 3.1)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- İş Tipleri (v1.0 FR 3.2)
CREATE TABLE work_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true
    -- v2.0'daki 'is_billable_default' kaldırıldı.
);

-- Projeler / Ürünler (v1.0 FR 3.3)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Bir proje müşterisiz olabilir (iç proje).
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL, 
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Zaman Girişleri / Yapılan İşler (v1.0 FR 2.2)
CREATE TABLE work_logs (
    id BIGSERIAL PRIMARY KEY,
    -- 'users' tablosuna mantıksal referans (ID)
    user_id UUID NOT NULL, 
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE RESTRICT NOT NULL,
    work_type_id UUID REFERENCES work_types(id) ON DELETE RESTRICT NOT NULL,
    
    date_worked DATE NOT NULL,
    duration_hours DECIMAL(5, 2) NOT NULL,
    description TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
    -- v2.0'daki 'is_billable' ve denetim tabloları kaldırıldı.
);

5.0 API Tasarımı (FastAPI Endpoint'leri v1.0)
Tüm endpoint'ler API Gateway (/api/v1/...) üzerinden erişilir ve kimlik doğrulaması (Authorization: Bearer <JWT>) gerektirir (giriş/kayıt hariç).
5.1. auth-service (Prefix: /api/v1/auth)
●	POST /token: Kullanıcı girişi (E-posta/Şifre alır, JWT döner).
●	POST /users: Yeni kullanıcı oluştur (Admin - FR 3.4).
●	GET /users: Tüm kullanıcıları listeler (Admin - FR 3.4).
●	PUT /users/{user_id}: Kullanıcıyı günceller (Admin - FR 3.4).
●	GET /users/me: Giriş yapmış kullanıcının bilgilerini döner.
5.2. core-service (Prefix: /api/v1/core)
●	/customers, /projects, /work-types (Tüm RESTful CRUD metodları: GET, POST, GET /<id>, PUT /<id>, DELETE /<id>) (Admin - FR 3.x).
●	POST /work-logs: Yeni zaman girişi oluşturur (Standart Kullanıcı - FR 2.x).
●	GET /work-logs: Giriş yapan kullanıcının zaman girişlerini listeler (filtreli).
●	PUT /work-logs/{log_id}: Zaman girişini günceller (Sadece sahibi veya Admin).
5.3. reporting-service (Prefix: /api/v1/reports)
●	GET /dashboard/v1: v1.0 dashboard widget verilerini döner (JSON) (Admin - FR 5.x).
●	GET /export/excel/v1: v1.0 Excel raporunu oluşturur ve döner (Dosya) (Admin - FR 4.x).
○	Params: ?start_date=...&end_date=...
6.0 Servisler Arası İletişim (Senkron)
v1.0'da tüm servisler arası iletişim, Kubernetes iç ağı (ClusterIP) üzerinden senkron API çağrıları ile yapılır.
●	Örnek Akış (v1.0 Dashboard Raporlaması):
1.	Admin, Frontend üzerinden Dashboard (FR 5.x) sayfasını açar.
2.	Frontend -> API Gateway -> GET /api/v1/reports/dashboard/v1 isteğini reporting-service'e iletir.
3.	reporting-service (FastAPI), isteği alır.
4.	reporting-service, rapor için gerekli olan kullanıcı adı listesi için auth-service'e iç API çağrısı yapar:
GET http://auth-service/api/v1/auth/users
5.	reporting-service, zaman girişi verileri için core-service'e iç API çağrısı yapar:
GET http://core-service/api/v1/core/work-logs?start_date=...&end_date=... (Gerekli tarih aralığı ile)
6.	reporting-service, aldığı iki JSON listesini hafızada (in-memory) birleştirir, gruplar (Projeye göre, Kullanıcıya göre vb.) ve son dashboard JSON verisini hesaplar.
7.	reporting-service, hesaplanan JSON'u Frontend'e 200 OK ile döner.
●	Geleceğe Hazırlık (Tak-Çıkar Modeli):
Bu tasarım "tak-çıkar" (plug-and-play) ilkesine uygundur. Gelecekte (v2/v3) reporting-service'in performansını artırmak için bir olay veriyolu (RabbitMQ) ve kendi okuma veritabanı (reporting_db) eklenebilir. Bu durumda reporting-service, core-service'e API çağrısı yapmayı bırakır ve bunun yerine olayları dinleyerek kendi veritabanını doldurur. core-service tarafında yapılacak tek değişiklik, ilgili olayları yayınlayan bir kod (publisher) eklemek olacaktır; mevcut API'ları değişmeyecektir.
7.0 Frontend Mimarisi (React)
Talep edilen "modern ve hızlı" alternatif olarak React (Vite ile) seçilmiştir.
●	Framework: React 18+
●	Build Aracı: Vite (Hızlı geliştirme sunucusu (HMR) ve optimize üretim (production) paketleri için).
●	UI Kütüphanesi: Ant Design (AntD). PRD'de talep edilen Admin panelleri, CRUD tabloları (FR 3.x), filtreleme (FR 4.2), formlar (FR 2.1) için idealdir.
●	Veri Görselleştirme (Dashboard'lar): Recharts. v1'deki tüm pasta/çubuk grafikler (FR 5.2) için basit ve güçlü bir kütüphanedir.
●	Veri Çekme (Data Fetching): React Query (TanStack Query). API'den veri çekme, önbellekleme (caching) ve "sunucu durumu" (server state) yönetimini standart hale getirir.
●	Global Durum (Global State): Zustand. Giriş yapmış kullanıcı bilgisi (user_id, is_admin) gibi küçük ve global durumları yönetmek için basit ve etkili bir çözümdür.
8.0 Dağıtım (Deployment) ve DevOps (Kubernetes)
Tüm platform, CI/CD işlem hattı ile Kubernetes üzerinde çalışacak şekilde tasarlanmıştır.
8.1. CI/CD İşlem Hattı (GitHub Actions / GitLab CI)
1.	Commit & Push: Geliştirici, bir servisin kodunu (örn. core-service) main branch'ine push'lar.
2.	Lint & Test: İşlem hattı tetiklenir. pytest ile servis testleri (birim ve entegrasyon) çalıştırılır.
3.	Build: Dockerfile (Bkz. 8.3) kullanılarak servisin yeni bir Docker imajı oluşturulur.
4.	Push: İmaj, bir konteyner kayıt defterine (örn. AWS ECR, Google GCR) benzersiz bir etiketle (örn. Git SHA) push'lanır.
5.	Deploy: kubectl (veya Helm/ArgoCD) kullanılarak K8s'teki ilgili Deployment kaynağının imaj etiketi güncellenir. Kubernetes, "Rolling Update" stratejisi ile pod'ları kesintisiz olarak günceller.
8.2. Kubernetes Kaynak (Resource) Mimarisi (v1.0)
●	Deployment: Tüm stateless (durumsuz) uygulamalar için:
○	auth-service, core-service, reporting-service, frontend.
●	StatefulSet: Tüm stateful (durum-tutan) servisler için:
○	auth-db-postgres, core-db-postgres.
●	Service (ClusterIP): Her backend servisi için. Diğer servislerin K8s içinde sabit bir DNS adıyla (örn. http://auth-service) haberleşmesini sağlar.
●	Ingress: (Nginx Ingress Controller ile yönetilen). Dış trafiği (örn. api.hermes.com) alır, SSL sonlandırması yapar ve istekleri path'e göre (/api/v1/auth/* -> auth-service) ilgili Service'e yönlendirir.
●	ConfigMap / Secret: Veritabanı URL'leri, JWT gizli anahtarları gibi tüm yapılandırma ve hassas veriler, pod'lara ortam değişkeni (environment variable) olarak Secret ve ConfigMap'lerden enjekte edilir.
8.3. Örnek Dockerfile (FastAPI Servisi)
# 1. Aşama: Bağımlılıkları kur
FROM python:3.11-slim as builder
WORKDIR /app
RUN pip install poetry
COPY poetry.lock pyproject.toml ./ 
RUN poetry install --no-root --no-dev 

# 2. Aşama: Son imajı oluştur
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /app/.venv /.venv
COPY . .
ENV PATH="/app/.venv/bin:$PATH"

# FastAPI'yi uvicorn ile çalıştır
CMD ["uvicorn", "hermes_auth.main:app", "--host", "0.0.0.0", "--port", "8000"]

9.0 Gözetleme (Observability) (v3+ Kapsamı)
Proje öncelikleri doğrultusunda, detaylı loglama (EFK Stack) ve izleme (Prometheus & Grafana) altyapısının kurulumu v3 ve sonrası fazlara ertelenmiştir.
v1.0 (ve v2.0) fazlarında, temel hata ayıklama (debugging) için Kubernetes pod'larının ve FastAPI servislerinin standart çıktı (stdout) logları kullanılacaktır.
