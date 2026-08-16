# Hermes Tenant-Based SaaS Cutover — Implementation Report

`14_DEFINITION_OF_DONE_AND_EVIDENCE.md` §7 formatında.

---

## 1. Durum

**COMPLETED** — `hermes-dev` üzerinde uçtan uca uygulandı ve doğrulandı.

| Alan | Durum |
|---|---|
| WS0–WS11 (kod, şema, testler, CI/CD, runbook) | ✅ COMPLETED |
| Sunucu hazırlığı (yedek, restore tatbikatı, roller, secret, ConfigMap) | ✅ COMPLETED (§12.1, §13.1) |
| Migration (auth `0003` + core `0006`) | ✅ COMPLETED — canlı veri korundu (§13.4) |
| Rollout (5 servis, immutable SHA) | ✅ COMPLETED (§13.4) |
| **Runtime rol geçişi** (superuser → `hermes_*_app`) | ✅ COMPLETED — RLS fiilen devrede (§13.5) |
| Platform Super Admin bootstrap | ✅ COMPLETED (§13.6) |
| Tenant izolasyon dumanı (6 kontrol) | ✅ GEÇTİ — rol geçişinden **sonra** tekrarlandı |
| Görsel/a11y QA turu | ⛔ ÜRETİLMEDİ (§11) |
| Yeni tenant oluşturma sihirbazı (UI) | ⛔ v1 kapsamı dışında (§14) |

## 2. Commit SHA

| | |
|---|---|
| Baseline | `df6e062b1a8bfc507ec1accb7d74c2d89eea38f5` |
| Final | `a2738f4a1efb3d40668d096a624b68810bef0717` |
| `origin/dev` | `a2738f4` — `df6e062..a2738f4` |
| `hermes-dev` rollout | 5 servis, hepsi `a2738f4…` immutable SHA'da |
| `origin/test` | `df6e062` — **dokunulmadı** (§15) |

CTO Pack'in incelediği baseline ile `origin/dev` birebir aynıydı; delta
uyarlaması gerekmedi.

## 3. Branch / worktree / push sayısı

- Çalışma dalı: `feat/hermes-multitenancy` (lokal, `origin/dev`'den)
- **Push sayısı: 4** — hepsi yalnızca `dev`'e. Feature branch push
  **edilmedi**.
- Plan tek push öngörüyordu; **tutmadı**. İlk push'tan sonraki üçü,
  yerel testler yeşilken yalnızca canlı ortamda/konteynerde ortaya çıkan
  üç kusurun düzeltmesidir (§13.2). Üçünde de boru hattı fail-closed
  davrandı: hatalı kod hiçbir zaman trafik almadı.

| Push | SHA | Neden |
|---|---|---|
| 1 | `5112560` | Cutover'ın tamamı |
| 2 | `6f0beb9` | Migration Job tek image'la koşamaz (konteyner yerleşimi) |
| 3 | `e85db23` | Var olan nesnelerin migrator'a devri |
| 4 | `a2738f4` | `schema_guard` yolu — pod'lar açılmıyordu |

- 16 checkpoint commit (workstream sınırları + 3 canlı bulgu düzeltmesi).

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
| `efbc4d7` | WS11 — nihai QA ve kanıt raporu |
| `2116545` | Canlı bulgu: DB'ler StatefulSet — `deploy/core-db` çalışmaz |
| `5112560` | Canlı bulgu: envanter kapısının ters yönü (sınıflandırılmamış tablo) |

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
| core-service | `pytest tests/ -q` | **463 passed**, 0 failed, 0 skipped | 14.6 s |
| auth-service | `pytest tests/ -q` | **113 passed** | 2.4 s |
| mcp-service | `pytest tests/ -q` | **104 passed** | 3.6 s |
| frontend | `npx vitest run` | **868 passed** / 63 dosya | 185.8 s |
| frontend build | `npx vite build` + artifact kapısı | OK (`env-config` doğrulandı) | 2.9 s |
| taze DB → head | `shared.migration_runner all` | auth `0003`, core `0006` | ~1 s |
| pre-tenant → head | aynı | ✅ (§8) | ~1 s |
| idempotency | ikinci + üçüncü koşu | sıfır değişiklik | ~1 s |

**Baseline karşılaştırması:** core 428→463, auth 49→113, mcp 98→104,
frontend 850→868. **Toplam +183 test, 0 başarısız.**

Son iki test (`test_no_unclassified_table_exists`,
`test_global_tables_are_declared_not_stale`) canlı hermes-dev'de bulunan
bir açığın karşılığıdır (§14.6) ve **mutasyonla** doğrulanmıştır:
beyandan bir tablo düşürülünce ve var olmayan bir tablo beyan edilince
ikisi de kırıldı. Yeşil olmaları tek başına kanıt sayılmadı.

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

### 12.1 Canlı `hermes-dev` yedeği ve restore tatbikatı

Cutover öncesi sunucuda (`84.247.180.172`, node1) **gerçekten** alındı:

| Kalem | Değer |
|---|---|
| Yedek dizini | `/root/hermes-cutover-backup-20260816-171239/` |
| `core_db.dump` | 282K, `PGDMP` başlığı doğrulandı, **55** `TABLE DATA` girdisi |
| `auth_db.dump` | 11K, `PGDMP` başlığı doğrulandı, **3** `TABLE DATA` girdisi |
| Pencere | auth + core **aynı** pencerede, arka arkaya |

Restore tatbikatı tek kullanımlık `drill_core` / `drill_auth`
veritabanlarına yapıldı ve **satır sayıları canlıyla birebir eşleşti**:

| | canlı | restore |
|---|---|---|
| tasks | 61 | 61 |
| customers | 25 | 25 |
| work_logs | 71 | 71 |
| meetings | 257 | 257 |
| users | 6 | 6 |
| rbac_roles | 7 | 7 |
| rbac_user_roles | 18 | 18 |

Drill veritabanları sonrasında düşürüldü. **Yedek, geri
yüklenebildiği kanıtlandığı için yedek sayılıyor** — dosyanın var olması
tek başına kanıt kabul edilmedi.

`backup/backup.py` ayrıca güncellendi: CSV export tenant başına ayrı
dosya, kullanıcı çözümü üyelikle sınırlı, dump her iki veritabanını
alıyor, retention parser'ı yeni dosya adıyla uyumlu.

## 13. Cutover yürütmesi — sunucu, CI, rollout

### 13.1 Operatör hazırlığı (sunucuda, elle — TAMAMLANDI)

`docs/tenant-cutover-runbook.md` §1 adımları `hermes-dev` üzerinde
uygulandı. Kapsam **yalnızca** `hermes-dev`; `hermes-test`'e hiçbir
komut çalıştırılmadı (§15).

| Adım | Kanıt |
|---|---|
| Koordineli yedek + restore tatbikatı | §12.1 ✅ |
| `00_roles.sql` — core_db | `hermes_core_app` (`is_superuser=f`, `bypasses_rls=f`), `hermes_core_migrator` (`bypasses_rls=t`) ✅ |
| `00_roles.sql` — auth_db | `hermes_auth_app` (`bypasses_rls=f`), `hermes_auth_migrator` ✅ |
| `tables_owned_by_app_role` | **0** — uygulama rolü hiçbir tablonun sahibi değil ✅ |
| Dört rolün bağlantısı | `core app → hermes_core_app`, `auth app → hermes_auth_app`, migrator'lar ✅ |
| Uygulama rolü DDL denemesi | **reddedildi** (CREATE TABLE yetkisi yok) ✅ |
| `hermes-db-roles` secret'ı | 6 sözleşme anahtarıyla oluşturuldu; parolalar **sunucuda üretildi, hiçbir yere yazılmadı/yazdırılmadı** ✅ |
| ConfigMap | `kubectl diff` temiz (yalnız 4 ekleme, drift yok) → apply ✅ |

Cutover öncesi canlı sayımlar (§8 karşılaştırma tabanı):
core_db — tasks 61, customers 25, projects 55, work_logs 71,
meetings 257, meeting_attendees 1960, api_request_logs 147,
api_cleanup_runs 33, activity_types 10, platforms 39,
task_activity_events 145, work_types 2, user_groups 2.
auth_db — users 6 (6 aktif, 4 admin), rbac_roles 7, rbac_user_roles 18.

### 13.2 Canlı ortamda bulunan iki kusur (düzeltildi)

Sunucudaki doğrulama, yalnızca yerel testlerin **yakalayamayacağı** iki
gerçek kusuru ortaya çıkardı:

1. **DB'ler StatefulSet** (`core-db-0` / `auth-db-0`), Deployment değil.
   Smoke script'i ve runbook `deploy/core-db` kullanıyordu — bu kümede
   hiçbir şeyle eşleşmez. Script komut ikamesi içinde çağırdığı için
   kontroller **boş değer alıp sessizce yanıltıcı sonuç** üretecekti.
   Düzeltme `2116545`: pod adı etiketten çözülür, bulunamazsa `exit 2`.
   Ayrıca `kubectl exec` çağıran betiğin stdin'ini tüketiyordu (sunucuda
   birebir yaşandı, betiğin kalan satırları yutuldu) → hepsine
   `</dev/null`.
2. **Envanter kapısının ters yönü açıktı.** Testler yalnızca "her tenant
   tablomun politikası var mı?" diye soruyordu. `tenant_id` kolonu
   olmayan bir tablo tüm RLS taramalarına **görünmez** — taramalar
   `tenant_id` arayarak başlıyor. Canlıda tam olarak bu durumda iki tablo
   bulundu: `task_groups` (1 satır) ve `task_group_members` (0 satır),
   eski `sql_scripts/005` tarafından oluşturulup `006` ile `user_groups`
   lehine terk edilmiş, hiçbir kod yolunun okumadığı tablolar. Düzeltme
   `5112560`: fiziksel her tablo üç sınıftan birinde olmak zorunda
   (tenant-owned · açıkça global · bilinen ölü legacy); dışarıda kalan
   her tablo CI'yi ve canlı dumanı kırmızı yapar. Kapının diş taşıdığı
   mutasyonla doğrulandı.

Legacy tablolar **bilerek düşürülmedi** — cutover'ın işi şema silmek
değil. Artık sessiz de değiller: smoke script satır sayılarıyla
raporluyor, `mixins.LEGACY_UNMANAGED_TABLES` gerekçesiyle beyan ediyor.

3. **Migration Job tek image'la koşamaz** (ilk CI koşusu burada durdu).
   `migration_runner`'ın yol modeli **repo ağacını** varsayıyordu
   (`backend/<svc>-service/app/migrations`). Dockerfile `<svc>/app/` →
   `./app/` kopyaladığı için konteynerde her servisin migration'ı
   `/app/app/migrations` olur ve aranan yol **hiç yoktur**. Yerelde repo
   ağacı var olduğundan dört kapı da yeşildi; bu ancak konteynerde
   görülebilirdi. Ayrıca Job'daki yorum "core image'ı her iki servisin
   migration'ını içerir" diyordu — Dockerfile'a bakılmadan yazılmış bir
   varsayım; hiçbir image ikisini de taşımıyor.

   Düzeltirken ortaya çıkan asıl tehlike: image yerleşimi körlemesine
   kabul edilseydi, core image'ında `auth` hedefi koşulunca ad körlüğü
   yüzünden **core'un şeması auth_db'ye** uygulanırdı — sessiz ve geri
   dönüşsüz. Düzeltme `6f0beb9`: image yerleşimi `HERMES_SERVICE`
   damgasıyla **kimlik kanıtı** ister; kanıt yoksa veya uyuşmuyorsa
   reddeder (tahmin etmez). Job initContainer (auth image) + container
   (core image) olarak bölündü; sırayı k8s garanti eder. `all` k8s'te
   kullanılmadığı için core, ilk tenant kimliğini **auth_db'den kendisi**
   çözer — UUID core'da üretilmez, aksi halde veri iki ayrı tenant'a
   bölünürdü.

4. **`schema_guard` yolu kendi kopyasıyla kuruyordu** (üçüncü koşu: migration
   geçti, pod'lar açılmadı). Konteyner yerleşimi sorununu `migration_runner`'da
   çözmüştüm ama guard aynı türetmeyi tekrarlıyordu:
   `CommandError: Path doesn't exist: '/app/core-service/app/migrations'`.
   Çağrı yerini düzeltmişim, kök nedeni değil. Düzeltme `a2738f4`: türetim
   tek otoriter yerde (`resolve_script_location`), ve **yapısal kapı**
   `shared/` altında başka hiçbir modülün yolu elle kurmasına izin vermiyor.

   Bu maddenin asıl dersi testte: yazdığım image-layout testinin ilk hali
   bu hatayı **yakalayamıyordu**. `_backend_root`'u monkeypatch ediyordum;
   eski kod o fonksiyonu hiç çağırmıyor, `Path(__file__)`'den gidip repo
   ağacında doğru dizini buluyordu. Test, üretimde patlayan kodu yeşil
   gösteriyordu. Yeniden yazıldı: konteyner dosya düzeni gerçekten kurulup
   import ayrı bir process'te yapılıyor; mutasyonla doğrulandı — eski koda
   dönünce core ve auth için üretimdekiyle **birebir aynı** hatayı veriyor.

5. **Yanlış tenant hostname'i girişi tamamen kapattı** (rollout'tan sonra,
   kullanıcı bildirdi). `hermes-dev` ConfigMap'ine **test ortamının** adresi
   (`hermes.duosis.com`) yazılmıştı; oysa dev'e IP ile gelinir
   (`84.247.180.172`, ingress'te host kuralı yok). Tenant çözümü Host
   başlığına bakar ve eşleşme yoksa fail-closed 404 `workspace_not_found`
   döner — yani şema, RLS, roller ve rollout kusursuzken **hiç kimse giriş
   yapamıyordu**, ne parola ne Microsoft SSO (ikisi de aynı çözümden geçer).

   Bu, §14.4b'de "kapanmamış tek boşluk" diye işaretlediğim yerin ta
   kendisiydi: kimlik doğrulamalı uçtan uca akış hiç koşulmamıştı ve
   altı duman kontrolünün hepsi yeşilken bu kusur görünmüyordu.

   Düzeltme: canlı `tenant_domains` kaydı dev adresine çevrildi,
   `k8s/01-configmap.yaml` düzeltildi (yorumda dev/test adresleri açıkça
   ayrıldı) ve **iki yeni kapı** eklendi:
   - Yapısal test: dev ConfigMap'i test adresini, test ConfigMap'i dev
     adresini taşıyamaz.
   - **Duman kontrolü 7**: giriş ucuna kasıtlı geçersiz credential
     gönderilir; doğru cevap 401'dir. `workspace_not_found` görülürse
     rollout kırmızıya döner. Mutasyonla doğrulandı — hostname yanlışa
     çevrilince iki satırlık net hatayla kırıldı.

**Bu beşinin ortak dersi:** üçü de yerel test yeşilken canlıda/konteynerde
ortaya çıktı ve üçü de **fail-open** yönündeydi (sessiz boş sonuç,
görünmez tablo, yanlış veritabanına şema). Beşi için de kapı eklendi ve
kapıların diş taşıdığı **mutasyonla** doğrulandı — yeşil olmaları tek
başına kanıt sayılmadı.

Beşinci bir kusur operatör betiğimdeydi ve canlıya yansımadı ama
raporlanmayı hak ediyor: `apply-runtime-roles.sh`, apply öncesi
`kubectl diff` çalıştırıyordu. `kubectl diff` **fark varsa exit 1**
döner ve `set -euo pipefail` altında betiği apply'a hiç gelmeden
öldürdü. Çıktı diff'le bittiği için başarılı görünüyordu; "rollout
başarılı" satırını CD'nin daha önce yaptığı işten okumuşum. Canlı
kanıt (`pg_stat_activity` hâlâ `hermes`) yakaladı. Betik `|| true` ile
düzeltildi ve apply sonrası env kaynağını **doğrulayan** bir kontrol
eklendi; kaynak `hermes-db-roles` değilse exit 3.

### 13.2.1 Konteyner yerleşimi kanıtı (Docker'sız)

Docker daemon yanıt vermediği için konteyner dosya düzeni Dockerfile
COPY'leri taklit edilerek diskte kuruldu ve gerçek PostgreSQL 15'e
koşuldu:

| Senaryo | Sonuç |
|---|---|
| Damgasız image, `core` hedefi | **REDDEDİLDİ** |
| core image, `auth` hedefi (tehlikeli hal) | **REDDEDİLDİ** — auth_db'ye yazılmadı |
| auth image → `auth` | `0003_initial_tenant` ✅ |
| core image → `core` (env'de tenant kimliği YOK) | auth_db'den çözüldü → `0006` ✅ |
| backfill | 2 satır, `1/33` tabloda güncelleme ✅ |
| enforce | RLS **33** tablo, unique **23**, fk **33** ✅ |
| İki veritabanında tenant UUID | **aynı** — veri bölünmedi ✅ |
| NULL `tenant_id` | **0** ✅ |
| Gerçek `NOBYPASSRLS` rolü | bağlamsız **0** · doğru tenant **2** · başka tenant **0** ✅ |

### 13.3 CI koşuları

| # | SHA | Sonuç | Nerede durdu |
|---|---|---|---|
| [31956389796](https://github.com/Duosis-Developer-Team/Hermes/actions/runs/31956389796) | `5112560` | ❌ | `migrate` — konteyner yerleşimi. Deploy **atlandı**, DB'ye dokunulmadı |
| [31957811637](https://github.com/Duosis-Developer-Team/Hermes/actions/runs/31957811637) | `6f0beb9` | ❌ | `migrate` — nesne sahipliği. auth `0003`'e ilerledi ve commit oldu; core `0001` geri alındı |
| [31959345932](https://github.com/Duosis-Developer-Team/Hermes/actions/runs/31959345932) | `e85db23` | ❌ | `deploy` — `migrate` **geçti** (core `0006`); pod'lar `schema_guard`'da açılmadı |
| [31960735701](https://github.com/Duosis-Developer-Team/Hermes/actions/runs/31960735701) | `a2738f4` | ✅ | tamamı yeşil; post-deploy duman **GEÇTİ** |

Dört kapı (core/auth/mcp/frontend) her koşuda geçti; hiçbir başarısızlık
test kapılarında değil, canlı ortamın gerçekleriyle temas eden
adımlardaydı.

### 13.4 Migration sonucu (canlı `hermes-dev`)

| Kontrol | Sonuç |
|---|---|
| core / auth revizyon | `0006_api_token_lookup` / `0003_initial_tenant` |
| Tenant UUID (auth ↔ core) | `503519cb-c45f-42f3-bfa0-cceebb8df1ee` — **aynı**, veri bölünmedi |
| Üyelikler | 6 kullanıcı → **6 üyelik** |
| Veri | tasks **61**, customers **25**, work_logs **71**, meetings **257**, meeting_attendees **1960**, users **6** — cutover öncesiyle **birebir** |
| Tenant bütünlüğü | 1 farklı `tenant_id`, NULL `tenant_id` **0** |
| RLS | **33** tabloda ENABLE + FORCE, **33** politika |
| Task kodları | issue 1-6 · suggestion 1-1 · task 1-54 — **değişmedi** |
| RBAC | 7 rol + 18 atama, **hepsi** tenant'a bağlı; `system-admin` 4 atama = 4 `is_admin` kullanıcı |

### 13.5 Runtime rol geçişi — izolasyonun fiilen devreye girdiği an

Migration ve rollout'tan sonra uygulama hâlâ `hermes` **superuser**'ı ile
bağlanıyordu. Superuser RLS'i aşar; yani bu noktada izolasyon şemada
tanımlıydı ama uygulama için **fiilen devrede değildi**. Bu yüzden
`03-backend-{auth,core}.yaml` ayrı bir adımda uygulandı.

Sıra zorunluydu: `grant_runtime_role` core `0005`'in içindedir —
migration'dan önce uygulanırsa app rolünün tablolarda hiçbir yetkisi
olmaz ve servis anında düşer.

Uygulamadan **önce** app rolü canlıda sınandı (yanlışsa servis düşerdi):

| | sonuç |
|---|---|
| Bağlamsız okuma | **0 satır** (fail-closed) |
| Bağlamlı okuma | tasks 61 · customers 25 · meetings 257 · attendees 1960 |
| Yazma (INSERT, geri alındı) | **OK** — rollback sonrası iz yok, customers 25 |

Uygulama sonrası **canlı kanıt** (`pg_stat_activity`):
`core_db → hermes_core_app`, `auth_db → hermes_auth_app`.
Pod'lar hazır, restart **0**, `/ready` 200, ingress 200.
Image'lar `a2738f4…` immutable SHA'da (mutable `latest` penceresi hiç
açılmadı — image satırı apply öncesi SHA'ya sabitlendi).

Duman testi rol geçişinden **sonra** tekrarlandı ve 6 kontrolün hepsi
geçti; "bağlamsız erişimde 0 satır" artık uygulamanın gerçek kimliğiyle
ölçülmüş bir sonuçtur.

### 13.6 Platform Super Admin

Bootstrap Job'ı koştu; denetim kaydı `platform.admin.bootstrapped /
success` (`platform_audit_events`).

| | |
|---|---|
| Kimlik | `superadmin@hermes.dev` — aktif, **MFA gerekli** |
| İzinler | 7 adet, tamamı `platform.*` |
| Aktif destek oturumu | **0** |
| Tenant üyeliği | **0** |
| `users` toplam | 7 (6 tenant kullanıcısı + 1 platform admin) |

Yani Platform Super Admin, CTO kararı gereği tenant iş verisine
**yapısal olarak** erişemiyor: ne üyeliği var, ne de açık bir destek
oturumu.

> **Tek seferlik parola raporda YOKTUR ve bu transkriptte de okunmadı.**
> Job log'una bir kez yazıldı; hiçbir yerde saklanmıyor:
> ```
> kubectl -n hermes-dev logs job/hermes-platform-bootstrap
> kubectl -n hermes-dev delete job hermes-platform-bootstrap   # okununca SİL
> ```
> Parola yöneticisine alın ve ilk girişte değiştirin.

## 14. Bilinen sınırlamalar ve takip işleri

1. **E-posta paritesi canlı doğrulanmadı** — kod S2S ile alıcıyı tenant
   içinde çözüyor, uçtan uca canlı gönderim testi yapılmadı (baseline'dan
   devralınan sınırlama).
2. **OAuth 2.1 authorization server yok** → external MCP client
   uyumluluğu iddia edilmiyor.
3. **Rate limiter in-memory** — tek pod doğru; yatay ölçeklemede
   paylaşılan store (Redis) gerekir. Anahtar artık tenant taşıyor.
4. **Görsel/a11y QA turu yapılmadı** (§11).
4b. **Kimlik doğrulamalı uçtan uca kullanıcı akışı — kısmen kapandı.**
   Bu boşluk gerçek bir arızaya dönüştü (§13.2.5): yanlış tenant
   hostname'i yüzünden giriş tamamen kapalıydı. Düzeltildi ve artık
   duman kontrolü 7 ile makine tarafından korunuyor: giriş ucu her
   rollout'ta gerçekten çağrılıyor ve `workspace_not_found` dönerse
   rollout kırmızı. **Hâlâ doğrulanmayan:** gerçek bir kullanıcı
   parolasıyla giriş yapıp UI'dan görev/zaman kaydı oluşturmak —
   credential gerekiyordu ve uydurulmadı (CTO kuralı). Tenant değiştirme
   akışı da yalnızca testlerle kanıtlıdır, canlıda değil.
   Doğrulananlar: ingress 200, her iki servis `/ready` 200, ve uygulama
   rolüyle canlı `core_db` üzerinde bağlamsız okuma **0** / bağlamlı
   okuma tam / yazma başarılı. Doğrulanmayan: gerçek bir kullanıcı
   parolasıyla giriş yapıp UI'dan görev/zaman kaydı oluşturmak — bunun
   için kullanıcı credential'ı gerekiyordu ve **uydurulmadı**
   (CTO kuralı: kullanıcı JWT'si üretilmez). Bu, DB katmanında
   kanıtlananın üstünde kalan tek boşluktur; ilk gerçek kullanıcı
   girişiyle kapanır. Tenant değiştirme akışı da bu nedenle yalnızca
   testlerle kanıtlıdır, canlıda değil.
5. **Yeni tenant oluşturma sihirbazı (UI) yok** — provisioning saga'sı
   veri modeli hazır, `POST /tenants` ucu ve wizard v1 dışında.
6. **Meetings/Graph tenant-başına IdP konfigürasyonu** modellendi
   (`tenant_identity_providers`) ama Graph sync hâlâ deployment-genelinde
   Azure ayarlarını kullanıyor; tenant başına secret referansı bağlanmadı.
7. **Pack §4'teki yeni benzersizlik kuralları** eklenmedi (§4).
8. `k8s/test/05-ingress.yaml` canlıdan farklı — **dokunulmadı**.
9. Entitlement **zorlaması** (feature gate) katalog + çözüm olarak hazır;
   route seviyesinde `feature_not_entitled` kontrolü henüz bağlanmadı.
10. **Ölü legacy tablolar `hermes-dev`'de duruyor** — `task_groups`
    (1 satır) ve `task_group_members` (0 satır). `tenant_id` ve RLS
    taşımıyorlar; hiçbir kod yolu okumuyor. Bilerek düşürülmediler
    (cutover'ın işi şema silmek değil) ama artık `LEGACY_UNMANAGED_TABLES`
    ile beyan edildikleri için envanter kapısı onları "bilinen ölü" ile
    "yeni sınıflandırılmamış" arasında ayırt edebiliyor. **Takip:** ayrı
    bir bakım commit'iyle düşürülmeleri (1 satırın içeriği önce
    incelenmeli) veya canlandırılacaklarsa tenant_id + RLS almaları.

## 15. `test` / `hermes-test` dokunulmadı — açık doğrulama

- `origin/test` = `df6e062` — **baseline ile aynı, değişmedi** (cutover
  sonrası tekrar doğrulandı).
- `test` branch'ine hiçbir commit/push yapılmadı; hiçbir aşamada
  checkout edilmedi.
- Değiştirilen tüm manifest'ler `k8s/` (dev) altındadır; `k8s/test/`
  **hiç düzenlenmedi**. `cd-test.yml` **değiştirilmedi**.

`hermes-test` namespace'i, cutover tamamlandıktan **sonra** ölçüldü:

| Kontrol | Değer | Beklenen |
|---|---|---|
| ConfigMap'te `INITIAL_TENANT_*` | 0 | 0 |
| `hermes-db-roles` secret'ı | YOK | YOK |
| `hermes_*_app` rolü | 0 | 0 |
| `alembic_version` tablosu | 0 | 0 |
| RLS açık tablo | **0** | 0 |
| Çalışan image | `df6e062` | `df6e062` |

Yani `hermes-test` şema, rol, secret ve image olarak cutover öncesiyle
aynıdır — tenant modeli oraya **hiç ulaşmadı**.

---

## 16. Sonraki adım için not (CTO kararı)

`test` promosyonu bu çalışmanın kapsamı dışındadır ve ayrı bir karardır.
Karar verilirse, bu cutover'ın öğrettiği üç operatör adımı `hermes-test`
için de **önkoşuldur** ve runbook'ta yerlerini almıştır:

1. Koordineli yedek + **restore tatbikatı** (yedek, geri yüklendiği
   kanıtlanana kadar yedek değildir).
2. `00_roles.sql` **ve** `01_adopt_objects.sql` — ikincisi olmadan
   migration "must be owner of ..." ile yarıda kırılır.
3. Migration ve rollout'tan **sonra** `03-backend-*.yaml` ile runtime
   rol geçişi — bu yapılmadan RLS uygulama için devrede değildir.

`hermes-test` verisi kutsaldır; oradaki tablo sahiplikleri ve legacy
nesneler dev'dekinden farklı olabilir. `run-migration-job.sh` önkoşulu
bunu Job başlamadan raporlar.
