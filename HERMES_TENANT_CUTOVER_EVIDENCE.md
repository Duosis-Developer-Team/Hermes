# Hermes Tenant-Based SaaS Cutover — Implementation Report

`14_DEFINITION_OF_DONE_AND_EVIDENCE.md` §7 formatında.

---

## 1. Durum

**PARTIAL**

Kod, şema ve testler **tamam**; yerel olarak kanıtlanabilir her şey
kanıtlandı. **Dağıtıma bağlı kanıtlar üretilmedi** çünkü tek push,
önce operatörün sunucuda yapması gereken adımlara bağlıdır (§13).
Hiçbir kalem "geçti" diye işaretlenmedi.

| Alan | Durum |
|---|---|
| WS0–WS10 (kod, şema, testler, CI/CD, runbook) | ✅ COMPLETED |
| Push / CI koşusu / `hermes-dev` rollout | ⛔ YAPILMADI (§13) |
| Canlı veri migration sayıları | ⛔ YAPILMADI — yerel snapshot ile kanıtlandı (§8) |
| Görsel QA ekran görüntüleri | ⛔ ÜRETİLMEDİ (§11) |
| Yeni tenant oluşturma sihirbazı (UI) | ⛔ v1 kapsamı dışında (§14) |

---

## 2. Commit SHA

| | |
|---|---|
| Baseline | `df6e062b1a8bfc507ec1accb7d74c2d89eea38f5` |
| Final | `a02620b0ba6b085b26f0c59995ff014e446c9d2e` |
| `origin/dev` (şu an) | `df6e062` — **değişmedi** |
| `origin/test` | `df6e062` — **dokunulmadı** |

CTO Pack'in incelediği baseline ile `origin/dev` birebir aynıydı; delta
uyarlaması gerekmedi.

## 3. Branch / worktree / push sayısı

- Çalışma dalı: `feat/hermes-multitenancy` (lokal, `origin/dev`'den)
- **Push sayısı: 0** — feature branch push edilmedi, `dev`'e push
  yapılmadı.
- 10 checkpoint commit (workstream sınırlarında).

| Commit | Workstream |
|---|---|
| `cf5ab6c` | WS1 — migration çerçevesi + DB rol ayrımı |
| `718620e` | WS2 — kontrol düzlemi veri modeli |
| `7d0801e` | WS3 — tenant-scoped kimlik + RBAC |
| `f392665` | WS4 — FORCE RLS + tenant-qualified kısıtlar |
| `df464cd` | WS5 — route/servis cutover |
| `c71423c` | WS6 — Public API + MCP tenant binding |
| `1b38809` | WS7 — reporting/bildirim/job/backup |
| `d15d423` | WS8 — frontend tenant app |
| `f067c70` | WS9 — Platform Admin Console |
| `a02620b` | WS10 — CI/CD + manifest + runbook |

## 4. Mimari sapmalar

Pack'in değişmez kararlarından **sapma yok**. İki bilinçli kapsam
sınırı, gerekçesiyle:

1. **Yeni benzersizlik kuralı eklenmedi.** Pack §4 matrisi bugün var
   olmayan bazı kuralları da listeliyor (ör. "müşteri adı benzersiz").
   Yalnızca **bugün var olan** global benzersizlikler tenant-qualified
   hale getirildi. Olmayan bir kuralı eklemek ürün davranışı
   değişikliğidir ve mevcut veride çakışma varsa migration'ı patlatırdı.
   Backlog'da.
2. **Provisioning saga'sı veri modeli olarak hazır, UI sihirbazı yok.**
   Mevcut Duosis tenant'ı migration ile kuruluyor; yeni tenant oluşturma
   ekranı v1 dışında bırakıldı.

## 5. Değişen dosyalar (servis bazında)

166 dosya, **+12.635 / −1.571**.

| Alan | Dosya |
|---|---|
| core-service | 91 |
| auth-service | 37 |
| frontend | 18 |
| k8s | 5 |
| shared | 4 |
| scripts | 3 |
| mcp-service | 3 |
| sql_scripts | 2 |
| docs | 1 |
| backup | 1 |
| .github | 1 |

## 6. Migration versiyonları (yön: ileri)

**auth_db** — head `0003_initial_tenant`

| Revizyon | Faz |
|---|---|
| `0001_baseline` | cutover öncesi şema |
| `0002_tenant_control_plane` | expand — 12 kontrol düzlemi tablosu |
| `0003_initial_tenant` | backfill — Duosis tenant'ı, üyelikler, RBAC bağları, plan |

**core_db** — head `0006_api_token_lookup`

| Revizyon | Faz |
|---|---|
| `0001_baseline` | cutover öncesi şema |
| `0002_tenant_projection` | expand — `tenant_registry`, `tenant_counters` |
| `0003_tenant_expand` | expand — 33 tabloya nullable `tenant_id` |
| `0004_tenant_backfill` | backfill — tüm iş verisi + sayaçlar |
| `0005_tenant_enforce` | **enforce** — NOT NULL, kısıtlar, FORCE RLS |
| `0006_api_token_lookup` | dar ayrıcalıklı token lookup fonksiyonu |

`0005` geri dönüşü zor sınırdır (`downgrade` bilinçli olarak
`NotImplementedError`).

## 7. Envanter (head şemasında ölçüldü)

| Ölçüm | Değer |
|---|---|
| `tenant_id NOT NULL` kolon | **35** (33 tenant-owned + registry/counters PK) |
| ENABLE + FORCE RLS tablo | **33** |
| RLS politikası | **33** (tablo başına tam 1) |
| Tenant-qualified unique | **49** |
| Composite FK `(tenant_id, …)` | **33** |
| Bilinçli global kalan unique | **1** (`api_tokens.token_hash`) |
| auth kontrol düzlemi tablosu | **12** |

## 8. Mevcut veri migration'ı (tablo bazında)

Gerçekçi bir **pre-tenant snapshot** (core `0001_baseline` + veri, auth
`0001_baseline` + 4 kullanıcı/3 rol/3 atama) → head:

| Tablo | Before | Güncellenen | Kalan NULL | After |
|---|---:|---:|---:|---:|
| customers | 2 | 2 | 0 | 2 |
| projects | 2 | 2 | 0 | 2 |
| tasks | 3 | 3 | 0 | 3 |
| work_logs | 2 | 2 | 0 | 2 |
| user_groups | 1 | 1 | 0 | 1 |
| work_types | 1 | 1 | 0 | 1 |
| *(diğer 27 tablo)* | 0 | 0 | 0 | 0 |

**Korunum kanıtları:**

| Kontrol | Sonuç |
|---|---|
| Task kodları (`issue#1 task#1 task#2`) | before == after ✅ |
| Efektif izinler | değişmedi ✅ |
| Pasif kullanıcı üyeliği | `suspended` (aktife terfi YOK) ✅ |
| Aktif kullanıcı üyeliği | `active` ✅ |
| İkinci/üçüncü koşu | sıfır değişiklik ✅ |

Üyelik tablosu:

```
admin@duosis.com    | active=t | membership=active
dev1@duosis.com     | active=t | membership=active
dev2@duosis.com     | active=t | membership=active
ayrilan@duosis.com  | active=f | membership=suspended
```

## 9. Final gate — komutlar, sayılar, süreler

Tümü **bir kez**, son commit üzerinde:

| Suite | Komut | Sonuç | Süre |
|---|---|---|---|
| secret guard | `./scripts/security/check-no-tracked-secrets.sh` | OK | <1 s |
| core-service | `pytest tests/ -q` | **461 passed**, 0 failed, 0 skipped | 16.9 s |
| auth-service | `pytest tests/ -q` | **113 passed** | 2.8 s |
| mcp-service | `pytest tests/ -q` | **104 passed** | 4.1 s |
| frontend | `npx vitest run` | **868 passed** / 63 dosya | 185.8 s |
| frontend build | `npx vite build` + artifact kapısı | OK (`env-config` doğrulandı) | 2.9 s |
| taze DB → head | `shared.migration_runner all` | auth `0003`, core `0006` | ~1 s |
| pre-tenant → head | aynı | ✅ (§8) | ~1 s |
| idempotency | ikinci + üçüncü koşu | sıfır değişiklik | ~1 s |

**Baseline karşılaştırması:** core 428→461, auth 49→113, mcp 98→104,
frontend 850→868. **Toplam +181 test, 0 başarısız.**

Ortam notu: Docker daemon kapalı olduğu için CLAUDE.md'deki
`docker run postgres:15-alpine` yerine Homebrew PostgreSQL 15.13
kullanıldı — RLS testleri ayrı owner/runtime rol gerektirdiği için
superuser erişimi gerekliydi. Python, CI ile birebir 3.11.15.

## 10. İki tenantlı negatif güvenlik matrisi

Tümü **gerçek `NOBYPASSRLS` rol** ile, gerçek PostgreSQL'de. Owner veya
superuser ile koşulan bir izolasyon testi geçersizdir; bu yüzden test
fixture'ları şemayı migrator rolüyle kurup ayrı bir uygulama rolü açar.

### Veritabanı katmanı (`test_rls_isolation.py`, 17 test)

| # | Senaryo | Beklenen | Sonuç |
|---|---|---|---|
| 1 | Bağlam YOK → SELECT | 0 satır | ✅ |
| 2 | Bağlam YOK → INSERT | red | ✅ |
| 3 | Tenant A bağlamı | yalnız A | ✅ |
| 4 | Tenant B bağlamı | yalnız B | ✅ |
| 5 | Aynı ad iki tenant'ta | ikisi de yaşar | ✅ |
| 6 | B'nin **bilinen UUID**'si A'da | görünmez | ✅ |
| 7 | A bağlamında B'ye INSERT | red | ✅ |
| 8 | A'daki satırı UPDATE ile B'ye taşıma | red | ✅ |
| 9 | Çapraz FK (A'nın projesi → B'nin müşterisi) | red | ✅ |
| 10 | TEK bağlantılı havuz: A → B | sızıntı yok | ✅ |
| 11 | Rollback sonrası bağlam | temizlendi | ✅ |
| 12 | **Tenant filtresi UNUTULMUŞ ORM sorgusu** | izole kaldı | ✅ |
| 13 | Tenant sayaçları | bağımsız ilerliyor | ✅ |
| 14 | 33 tabloda ENABLE + FORCE | doğrulandı | ✅ |
| 15 | Tablo başına tam 1 politika, USING+WITH CHECK dolu | doğrulandı | ✅ |
| 16 | Politikada `OR`/`superadmin`/`is_admin` dalı | **yok** | ✅ |
| 17 | App rolü `SET row_security = off` | red | ✅ |

### Public API (`test_tenant_binding.py`, 9 test)

| Senaryo | Sonuç |
|---|---|
| Dar fonksiyon doğru tenant'ı çözer | ✅ |
| Fonksiyon iş verisi döndürmez (kolon kümesi kilitli) | ✅ |
| Bilinmeyen hash hiçbir şey çözmez | ✅ |
| A bağlamında B'nin client'ı | görünmez ✅ |
| **Aynı client adı** iki tenant'ta | yan yana yaşar ✅ |
| A bağlamında B'nin token satırı | okunamaz ✅ |
| Denetim kayıtları çapraz okuma | yok ✅ |
| **Aynı idempotency anahtarı** iki tenant'ta | bağımsız ✅ |
| A'nın token'ı B'nin client'ına bağlanma | red (composite FK) ✅ |
| Bağlamsız token taraması | 0 satır ✅ |

### Kimlik / RBAC (`test_tenant_auth.py`, 19 test)

| Senaryo | Sonuç |
|---|---|
| Platform token'ı tenant doğrulayıcısında | red ✅ |
| Tenant token'ı (`is_admin=true`) platform doğrulayıcısında | red ✅ |
| Tenant bağlamı olmadan tenant token'ı üretimi | `ValueError` ✅ |
| Platform token'ına tenant claim'i | atılıyor ✅ |
| **Aynı kimlik A'da admin, B'de member** | izinler ayrı ✅ |
| Üyelik pasifse rol ataması dursa bile | izin yok ✅ |
| Başka tenant'ın rolü | hiçbir şey vermiyor ✅ |
| Son-admin kilidi | tenant içinde sayıyor ✅ |
| Doğrulanmamış domain | tenant çözmüyor ✅ |
| Askıya alınmış tenant | `423`, bilinmeyen host `404` ✅ |
| S2S dizin: başka tenant'ın kimliği | dönmüyor ✅ |

### Platform düzlemi (`test_platform_admin.py`, 18 test)

| Senaryo | Sonuç |
|---|---|
| Oturumsuz platform isteği | 401 ✅ |
| **Tenant çerezi** platform ucunda | 401 ✅ |
| Geçerli kullanıcı, `platform_admins` kaydı yok | 403 ✅ |
| Tenant izin kodları platform kaydında | etkisiz ✅ |
| Tenant detayı | yalnız metadata (alan kümesi kilitli) ✅ |
| Destek izni: gerekçe zorunlu, süre 1–30 dk | ✅ |
| Read-write destek | ayrı izin ister ✅ |
| Destek token'ı | TENANT audience + `support_grant_id`, `membership_id` YOK ✅ |
| İptal/süresi dolmuş izin exchange | red ✅ |
| Başka operatörün izni | kullanılamaz ✅ |
| Geçersiz durum geçişi / bayat sürüm | 409 ✅ |
| Denetimde şifre/token/gövde | yok ✅ |
| Bootstrap betiğinde şifre | yok ✅ |

### Frontend (`tenantSwitch` + `platformConsole`, 18 test)

| Senaryo | Sonuç |
|---|---|
| Anahtar uzayı tenant'a göre bölünüyor | ✅ |
| A→B geçişinde A'nın cache verisi | geçmiyor ✅ |
| Uçuşan sorgular **temizlikten önce** iptal | ✅ |
| Tenant değişince izinler sıfırlanıyor (fail-closed) | ✅ |
| Logout cache'i boşaltıyor | ✅ |
| Tek üyelikte seçici gizli | ✅ |
| Tenant oturumu platform oturumu açmıyor (ve tersi) | ✅ |
| Destek banner'ında **"hide" aksiyonu yok** | ✅ |

## 11. Görsel QA

⛔ **ÜRETİLMEDİ.** Pack §10 (12_TEST_SECURITY_AND_QA_PLAN) 360/768/1280/
1440 genişliklerde light+dark ekran görüntüsü istiyor; bu, uygulamanın
tarayıcıda ayağa kaldırılmasını gerektirir ve bu oturumda yapılmadı.

Bunun yerine yapılanlar: Platform Console mevcut antd tasarım
tokenlarını/tipografisini kullanıyor; tablolar `scroll={{x:'max-content'}}`
ile **kendi içinde** kayıyor (sayfa yatay taşmıyor); durum bilgisi
renkten bağımsız olarak **metinle de** veriliyor; banner `role="status"`
+ `aria-live="polite"` taşıyor; konsol lazy chunk.

**Follow-up:** ekran görüntüsü + otomatik a11y taraması ayrı bir QA
turunda üretilmeli.

## 12. Backup / restore kanıtı

Yerel disposable ortamda **gerçekten çalıştırıldı**:

| Adım | Sonuç |
|---|---|
| Koordineli dump (auth + core, aynı pencere) | `auth 45K`, `core 197K` ✅ |
| İzole hedeflere `pg_restore` | ✅ |
| auth ↔ core **aynı tenant UUID**'sini taşıyor | `7393336c-…` == `7393336c-…` ✅ |
| Satır sayıları | users=4, üyelik=4, roller=3 / customers=2, tasks=3, work_logs=2 ✅ |
| **FORCE RLS restore ile geldi** | eksik tablo: **0** ✅ |
| RLS politikaları | **33** ✅ |
| Composite FK | **33** ✅ |
| Restore edilmiş DB'de gerçek NOBYPASSRLS rol ile: bağlamsız SELECT | **0 satır** ✅ |
| … doğru tenant bağlamı | **3 satır** ✅ |
| … başka tenant bağlamı | **0 satır** ✅ |

Yani yedek yalnızca veriyi değil **izolasyon garantisini de** geri
getiriyor.

`backup/backup.py` ayrıca güncellendi: CSV export tenant başına ayrı
dosya, kullanıcı çözümü üyelikle sınırlı, dump her iki veritabanını
alıyor, retention parser'ı yeni dosya adıyla uyumlu.

## 13. CI run URL / rollout SHA

⛔ **YOK — push yapılmadı.**

Bu bir tercih değil, **sıralama zorunluluğu**: tek push'un anlamlı
olabilmesi için önce operatörün sunucuda şunları yapması gerekir
(`docs/tenant-cutover-runbook.md` §1):

1. **Koordineli auth+core yedeği** (cutover öncesi zorunlu).
2. `backend/sql_scripts/roles/00_roles.sql` ile migrator/runtime
   rollerinin kurulması.
3. **`hermes-db-roles` secret'ının oluşturulması.**

Bu adımlar yapılmadan push edilirse: `check-runtime-secrets.sh` veya
migration Job **başarısız olur**, `deploy` job'ı hiç çalışmaz ve
`hermes-dev` eski image'da kalır. Veri kaybı olmaz ama push boşa gider.

Ayrıca push, `0005_tenant_enforce` ile **geri dönüşü zor sınırı**
geçirir — bu, CTO onayı gerektiren bir karardır.

## 14. Bilinen sınırlamalar ve takip işleri

1. **E-posta paritesi canlı doğrulanmadı** — kod S2S ile alıcıyı tenant
   içinde çözüyor, uçtan uca canlı gönderim testi yapılmadı (baseline'dan
   devralınan sınırlama).
2. **OAuth 2.1 authorization server yok** → external MCP client
   uyumluluğu iddia edilmiyor.
3. **Rate limiter in-memory** — tek pod doğru; yatay ölçeklemede
   paylaşılan store (Redis) gerekir. Anahtar artık tenant taşıyor.
4. **Görsel/a11y QA turu yapılmadı** (§11).
5. **Yeni tenant oluşturma sihirbazı (UI) yok** — provisioning saga'sı
   veri modeli hazır, `POST /tenants` ucu ve wizard v1 dışında.
6. **Meetings/Graph tenant-başına IdP konfigürasyonu** modellendi
   (`tenant_identity_providers`) ama Graph sync hâlâ deployment-genelinde
   Azure ayarlarını kullanıyor; tenant başına secret referansı bağlanmadı.
7. **Pack §4'teki yeni benzersizlik kuralları** eklenmedi (§4).
8. `k8s/test/05-ingress.yaml` canlıdan farklı — **dokunulmadı**.
9. Entitlement **zorlaması** (feature gate) katalog + çözüm olarak hazır;
   route seviyesinde `feature_not_entitled` kontrolü henüz bağlanmadı.

## 15. `test` / `hermes-test` dokunulmadı — açık doğrulama

- `origin/test` = `df6e062` — **baseline ile aynı, değişmedi**.
- `test` branch'ine hiçbir commit/push yapılmadı; hiçbir aşamada
  checkout edilmedi.
- `hermes-test` namespace'ine hiçbir `kubectl` komutu çalıştırılmadı.
- Değiştirilen tüm manifest'ler `k8s/` (dev) altındadır; `k8s/test/`
  **hiç düzenlenmedi**.
- `cd-test.yml` **değiştirilmedi** (yalnız `cd-dev.yml`).

Doğrulama:

```
$ git rev-parse origin/test
df6e062b1a8bfc507ec1accb7d74c2d89eea38f5
$ git diff --name-only df6e062..HEAD -- k8s/test .github/workflows/cd-test.yml
(boş)
```
