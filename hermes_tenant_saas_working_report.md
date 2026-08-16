# Hermes Tenant SaaS Cutover — Working Report

Bu dosya, `HERMES_TENANT_CTO_PACK v1.0` uygulamasinin calisma gunlugudur.
Nihai teslim raporu `14_DEFINITION_OF_DONE_AND_EVIDENCE.md` formatinda ayrica
uretilecektir.

---

## WS0 — Baseline ve envanter

### Repository durumu

| | Deger |
|---|---|
| `origin/dev` | `df6e062b1a8bfc507ec1accb7d74c2d89eea38f5` |
| CTO Pack baseline | `df6e062` — **AYNI**, delta YOK |
| `origin/test` | `df6e062` (ayni SHA; dokunulmayacak) |
| Calisma dali | `feat/hermes-multitenancy` (lokal, `origin/dev`'den) |
| Dirty worktree | Yalniz **takip edilmeyen** dokuman/`.claude/` klasoru; takipli dosyada degisiklik YOK |

CTO Pack'in incelendigi baseline ile guncel `origin/dev` birebir ayni oldugu
icin **pack'i guncel koda uyarlama ihtiyaci yoktur**; tum dosya yollari gecerli.

### Baseline test sayilari (bu makinede, degisiklik oncesi olculdu)

| Suite | Sonuc | Sure |
|---|---|---|
| core-service | **428 passed** | 25.5 s |
| auth-service | **49 passed** | 1.0 s |
| mcp-service | **98 passed** | 19.3 s |
| frontend (vitest) | **850 passed / 61 dosya** | 189.4 s |

> Not: `CLAUDE.md` icindeki sayilar (214/8/77) eskimis; gercek baseline
> yukaridadir. Bu dosya cutover sonunda guncellenecek.

### Yerel dogrulama ortami

- Docker daemon **calismiyor** (Docker Desktop kapali). CLAUDE.md'deki
  `docker run ... postgres:15-alpine` tarifi bu oturumda kullanilamadi.
- Yerine **Homebrew PostgreSQL 15.13** (localhost:5432) kullaniliyor.
  RLS testleri gercek Postgres ve **ayri owner/runtime rol** gerektirdigi
  icin bu aslinda daha uygun: superuser erisimi rol ayrimini kurabiliyor.
- Python: repo CI 3.11 kullaniyor; yerelde `uv` ile **CPython 3.11.15**
  venv'leri kuruldu (core/auth icin pinli venv, MCP icin overlay venv —
  CI'daki iki ayri kurulum ile birebir).

### ORM tablo envanteri

**auth_db (3 tablo, hepsi mevcut):** `users`, `rbac_roles`, `rbac_user_roles`

**core_db (33 tablo, hepsi tenant-owned olacak):**

| Grup | Tablolar |
|---|---|
| Referans/proje | `customers`, `projects`, `project_memberships`, `issues`, `work_types`, `activity_types`, `platforms`, `work_lines` |
| Zaman/planlama | `work_logs`, `plan_times`, `plan_time_assignments`, `timesheet_submissions` |
| Toplantilar | `meetings`, `meeting_attendees` |
| Is yonetimi | `tasks`, `task_sub_projects`, `task_assignment_relations`, `task_assignment_group_relations`, `task_user_permissions`, `task_notification_settings`, `task_lifecycle_policy`, `task_activity_events`, `task_comments`, `user_groups`, `user_group_members`, `task_group_permissions`, `task_group_member_overrides` |
| Developer platform | `api_clients`, `api_tokens`, `api_client_access`, `api_request_logs`, `api_idempotency_keys`, `api_cleanup_runs` |

Pack `04`'teki liste ile **birebir ortusuyor** — eksik/fazla tablo yok.

### Kritik teknik borc noktalari (dogrulandi)

1. **Startup DDL**: `core-service/app/main.py` icinde `init_db()` (create_all)
   + **13 ad-hoc idempotent migration fonksiyonu** (satir 50-688). Her pod
   startup'ta bunlari kosuyor → tenant cutover'i bunlarla yapmak yaris
   demek. `auth-service/app/main.py` ise `init_db()` + `rbac_bootstrap()`.
2. **Versiyonlu migration YOK**: `backend/sql_scripts/` altinda kayit
   amacli SQL var ama otoriter runner yok.
3. **242 DB sorgu/execute noktasi** core'da; **90 adet `.commit()`**
   (en yogun: `task_service.py` 23, `main.py` 14, `api_client_service.py` 8,
   `user_group_service.py` 7). Bunlar `SET LOCAL` tenant context'ini
   dusuren noktalar → WS4'te unit-of-work sinirina tasinacak.
4. **16 dogrudan `SessionLocal()`** cagrisi (12'si `main.py` startup, 2'si
   job, 1'i public_api audit, 1'i rbac backfill).
5. **Global sayaclar**: `task_number_seq` + `tasks_type_seq_{task,issue,
   suggestion}` + `trg_assign_type_number` trigger'i → tenant counter'a
   donusecek.
6. **JWT**: `shared/auth.py` `user_id`/`email`/`is_admin` tasiyor; `aud`,
   `tenant_id`, `membership_id`, `jti` YOK.
7. **authz cache**: `core-service/app/services/authz_client.py` cache
   anahtari duz `user_id` (satir 37, 67, 97) → `(tenant_id, user_id)` olacak.
8. **Frontend**: `src/query/queryKeys.js` merkezi key factory var (iyi haber
   — tenant namespace'i tek noktadan eklenebilir); `stableFilters` mevcut.

### Blocker durumu

Uygulamayi durduran **gercek blocker yok**. Asagidakiler *kanit* asamasini
etkiler ve nihai raporda durustce isaretlenecek:

| Konu | Durum |
|---|---|
| `hermes-dev` canli DB row count'lari (before/after) | Bu ortamdan erisim yok — migration/backfill yerel snapshot ile dogrulanir; canli sayilar deploy aninda uretilir |
| `kubectl apply` (manifest/secret) | CLAUDE.md kurali: komutlar verilir, kullanici Termius'tan uygular |
| Canli backup/restore drill | Yerel disposable DB'de yapilir; canli drill deploy penceresinde |
| CI run URL / rollout SHA | Ancak tek push sonrasi olusur |

---

## WS1 — Migration cercevesi ve DB rol ayrimi ✅ TAMAM

Commit: `cf5ab6c`

| Cikti | Durum |
|---|---|
| Versiyonlu migration (auth + core, ayri branch'ler) | `app/migrations/` + `shared/migration_runner.py` |
| Advisory lock | `pg_advisory_lock`, servis basina sabit anahtar |
| Startup DDL'in kaldirilmasi | core `main.py` **640 satir** eksildi; auth `create_all` gitti |
| Sema uyumluluk kapisi | `shared/schema_guard.py` — revizyon uyusmazsa pod ACILMAZ |
| Migrator/runtime rol ayrimi | `backend/sql_scripts/roles/00_roles.sql` |
| Bloklayan CD kapisi | `cd-dev.yml`: build → **migrate** → deploy |

**Kanit — sema esdegerligi:** eski startup yolunun urettigi sema ile
`0001_baseline`in urettigi sema `pg_dump --schema-only` ciktisinda
**767/767 satir, 0 fark**.

**Kanit — RLS modeli (gercek PostgreSQL 15.13, ayri owner/runtime rol):**

| Senaryo | Sonuc |
|---|---|
| context YOK → SELECT | 0 satir ✅ |
| context YOK → INSERT | `new row violates row-level security policy` ✅ |
| tenant A context | yalnizca A'nin satiri ✅ |
| tenant B context | yalnizca B'nin satiri ✅ |
| A context → B'ye INSERT | reddedildi ✅ |
| COMMIT sonrasi AYNI baglanti | 0 satir — `SET LOCAL` dustu, pool sizintisi yok ✅ |
| app rolu `SET row_security = off` | `query would be affected by row-level security policy` ✅ |

## WS2 — Kontrol duzlemi veri modeli ✅ TAMAM

Commit: `718620e`

- auth_db: 12 kontrol duzlemi tablosu + rbac tenant_id (nullable) +
  `users.session_version`. `users` GLOBAL kaldi.
- core_db: `tenant_registry` (projeksiyon) + `tenant_counters` (atomik).
- `shared/platform_permissions.py`: tenant katalogundan **kesisimsiz**
  ayri yetki uzayi (testle kilitli).
- `entitlements.py`: tipli katalog, katalog disi kod fail-closed.

## Test durumu (WS2 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **435** |
| auth-service | 49 | **76** |
| mcp-service | 98 | **98** |
| frontend | 850 | 850 (degismedi) |

## Kalan is (WS3–WS11)

WS3 tenant-scoped auth/RBAC · WS4 33 core tablosunun tenantization'i +
RLS · WS5 route/servis cutover (242 sorgu, 90 commit noktasi) ·
WS6 Public API + MCP · WS7 reporting/meetings/jobs/backup ·
WS8 frontend tenant app · WS9 Platform Admin Console ·
WS10 CI/CD + manifest · WS11 nihai QA/kanit.

## WS3 — Tenant-scoped kimlik ve RBAC ✅ TAMAM

Commit: `7d0801e`

### Audience ayrimi (en kritik invariant)

| Kontrol | Sonuc |
|---|---|
| Platform token'i tenant dogrulayicisinda | REDDEDILDI ✅ |
| Tenant token'i (is_admin=true dahil) platform dogrulayicisinda | REDDEDILDI ✅ |
| Tenant baglami olmadan tenant token'i uretimi | `ValueError` ✅ |
| Platform token'ina tenant claim'i gecirme | claim ATILIYOR ✅ |
| Cutover ONCESI (audience'siz) token | GECERSIZ ✅ |

### Tenant cozumu

- Host YALNIZCA **dogrulanmis** `tenant_domains` kaydiyla cozulur;
  dogrulanmamis domain cozmez, `X-Forwarded-Host` okunmaz.
- Askiya alinmis tenant `423 workspace_unavailable`, bilinmeyen host
  `404 workspace_not_found` — iki farkli sinif.
- `/w/{slug}` dev yolu varsayilan **KAPALI**.

### Tenant-scoped RBAC — cikis kriteri kanitlandi

`test_same_identity_has_different_permissions_per_tenant`: ayni kimlik
A'da `users.manage` + `reports.view`, B'de yalnizca `reports.view`.
A'nin yetkisi B'ye **sizmiyor**.

Ek kilitler: uyelik pasifse rol atamasi olsa bile izin YOK; baska
tenant'in rolu hicbir sey vermiyor; son-admin kilidi tenant icinde
sayiyor; authz cache anahtari `(tenant_id, user_id)`.

### Migration zinciri

| Senaryo | Sonuc |
|---|---|
| Taze DB → head (auth 0003, core 0004) | ✅ |
| Pre-tenant snapshot (veri dolu) → head | ✅ |
| Ikinci/ucuncu kosu | sifir degisiklik ✅ |
| Pasif kullanici uyeligi | `suspended` (KORUNDU) ✅ |
| Efektif izinler | degismedi ✅ |
| Task kodlari | yeniden numaralanmadi ✅ |
| Tenant sayaclari | mevcut max'in USTUNDEN basliyor ✅ |
| `rbac_roles.code` / `(user_id, role_id)` | tenant-qualified ✅ |

### Bulunan ve duzeltilen guvenlik acigi

SSO `redirect_uri` dogrulamasi `startswith` kullaniyordu:
`https://hermes.duosis.com.evil.tr` izinli origin ile **basliyor**
gorunup gecebiliyordu. TAM origin eslesmesine cevrildi. Ayrica SSO
auto-provisioning kaldirildi (e-posta alan adi yetki kaynagi degildir).

## Test durumu (WS3 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **435** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **98** |
| frontend | 850 | 850 (henuz dokunulmadi) |

## Kalan is (WS4–WS11)

WS4 RLS enforce (NOT NULL + composite FK + FORCE RLS) · WS5 route/servis
cutover (242 sorgu, 90 commit noktasi) · WS6 Public API + MCP tenant
binding · WS7 reporting/meetings/jobs/backup · WS8 frontend tenant app ·
WS9 Platform Admin Console · WS10 CI/CD + manifest · WS11 nihai kanit.

## WS4 — FORCE RLS ve tenant-qualified kisitlar ✅ TAMAM

Commit: `f392665` — migration `0005_tenant_enforce`

| Donusum | Adet |
|---|---|
| `tenant_id NOT NULL` | 33 tablo |
| Tenant-qualified benzersizlik | **23** kisit/index |
| Composite FK `(tenant_id, id)` | **33** FK |
| ENABLE + FORCE RLS + politika | 33 tablo |

Global birakilan tek benzersizlik: `api_tokens.token_hash` — kimlik
dogrulama tenant BILINMEDEN hash ile arar; orada global benzersizlik bir
guvenlik ozelligidir (pack 05 §7).

### Iki tenantli negatif matris (17 test, GERCEK non-owner rol)

**Katalog kapilari**

| Kontrol | Sonuc |
|---|---|
| 33 tabloda RLS ENABLE + FORCE | ✅ |
| Her tabloda TAM OLARAK 1 izolasyon politikasi | ✅ |
| USING **ve** WITH CHECK dolu | ✅ |
| Politikada `OR` / `superadmin` / `is_admin` dali | **YOK** ✅ |

**Rol kapilari**

| Kontrol | Sonuc |
|---|---|
| Uygulama rolu `rolbypassrls = false` | ✅ |
| Uygulama rolu hicbir tablonun sahibi degil | ✅ |
| `SET row_security = off` | reddedildi ✅ |

> Owner/superuser ile kosulan bir RLS testi **gecersizdir**; bu yuzden
> test dosyasi gercek bir `NOBYPASSRLS` rol acar ve semayi migrator
> rolüyle kurar.

**Davranis kapilari**

| Senaryo | Sonuc |
|---|---|
| Baglam YOK → SELECT | 0 satir ✅ |
| Baglam YOK → INSERT | reddedildi ✅ |
| A/B yalnizca kendi satirini gorur | ✅ |
| Ayni ad iki tenant'ta yan yana | ✅ |
| B'nin BILINEN UUID'si A'da | gorunmuyor ✅ |
| A baglaminda B'ye INSERT | reddedildi ✅ |
| A'daki satiri UPDATE ile B'ye tasima | reddedildi ✅ |
| Capraz FK (A'nin projesi → B'nin musterisi) | reddedildi ✅ |
| TEK baglantili havuzda A→B | sizinti YOK ✅ |
| Rollback sonrasi baglam | temizlendi ✅ |
| **Tenant filtresi UNUTULMUS ORM sorgusu** | **izole kaldi** ✅ |
| Tenant sayaclari | bagimsiz ilerliyor ✅ |

### Transaction-local baglam (`app/tenant_db.py`)

`set_config('app.tenant_id', ..., true)` isteğin kullandigi transaction
icinde. Session-level `SET` havuza donunce silinmez → sonraki istek
baska bir tenant icin ayni baglantiyi alirsa sessiz sizinti olurdu.
Unit-of-work siniri route'a tasindi: servisler `flush`, commit
dependency'de.

### Bulunan ve duzeltilen bug

`uq_<tablo>_tenant_id` kisiti, composite FK'ler tarafindan referans
alindiktan sonra dusurulEMEZ. Ilk yazimda drop+create yapiyordu; ikinci
kosuda `DependentObjectsStillExist` ile patliyordu (migration Job retry
senaryosu). "Yalnizca yoksa yarat"a cevrildi; 2. ve 3. kosu artik sifir
donusum yapiyor.

## Test durumu (WS4 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **452** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **98** |
| frontend | 850 | 850 |

## Kalan is (WS5–WS11)

WS5 route/servis cutover (242 sorgu, 90 commit noktasi — `get_db` →
`get_tenant_db`) · WS6 Public API + MCP tenant binding · WS7
reporting/meetings/jobs/backup · WS8 frontend tenant app · WS9 Platform
Admin Console · WS10 CI/CD + manifest · WS11 nihai kanit.

## WS5 — Core route/servis cutover ✅ TAMAM

Commit: `df464cd` — 42 dosya, +611/−261

| Donusum | Adet |
|---|---|
| `get_db` → `get_tenant_db` (18 router) | **124** |
| `commit()` → `flush()` (unit-of-work route'a) | **69** |
| Tenant basina kosan job | api_cleanup (+ ortak kosucu) |

### Neden mekanik degil

`SET LOCAL app.tenant_id` **transaction'a baglidir**. Isteğin ortasinda
commit eden bir servis tenant baglamini dusurur; sonraki sorgular RLS
altinda **sifir satir** gorur. Bu yuzden commit'ler flush'a cevrildi ve
transaction sinirini `get_tenant_db` devraldi.

Yeni satirlarin `tenant_id` damgasi `before_flush` hook'uyla session
baglamindan gelir — 100+ create cagrisinda elle yazmak birini unutmak
demekti. Bu bir **izolasyon** mekanizmasi degildir (okuma tarafinda
otomatik filtre yok); yanlis damga zaten RLS `WITH CHECK` ile reddedilir.

### Bulunan iki gercek bug

**1. Arsiv job'i sessizce hicbir sey yapmiyordu.**
`task_archive_service` audit INSERT'i `tenant_id` tasimiyordu. Kolon NOT
NULL oldugu icin insert patliyor, is `partial_failure` donuyor ve hicbir
satir arsivlenmiyordu — istisna da yukselmiyordu. Audit olayi artik
tenant'i arsivlenen satirdan aliyor.

**2. Migration'lar sessizce hicbir sey yaratmiyordu.**
`SET lock_timeout`'u Alembic baglantisinda calistirmak, SQLAlchemy
2.0'da ortuk transaction acip Alembic'in commit'ini bozuyordu: migration
"basarili" gorunup **tek tablo bile yaratmiyordu**. Timeout'lar artik
libpq `options` ile baglanti acilirken veriliyor. (Kilit bekleyisini
sinirlamak ayrica gercek bir iyilestirme: unutulmus bir "idle in
transaction" baglanti ALTER'i sinirsiz bekletip arkasina trafigi
kuyrukluyordu — bu oturumda birebir yasandi.)

## Test durumu (WS5 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **452** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **98** |
| frontend | 850 | 850 |

Test semasi artik uretimle ayni: core ve mcp conftest'leri enforce
fazini da uyguluyor (NOT NULL + tenant-qualified kisitlar + RLS).

## Kalan is (WS6–WS11)

WS6 Public API + MCP tenant binding · WS7 reporting/meetings/notifications
+ kalan job'lar/backup · WS8 frontend tenant app · WS9 Platform Admin
Console · WS10 CI/CD + manifest · WS11 nihai kanit.

## WS6 — Public API ve MCP tenant binding ✅ TAMAM

Commit: `c71423c` — migration `0006_api_token_lookup`

### Tavuk-yumurta problemi ve cozumu

Kimlik dogrulama, token'in hangi tenant'a ait oldugunu **token'i
bulmadan** bilemez; ama RLS altinda tenant baglamsiz `api_tokens`
sorgusu sifir satir doner. Yani hicbir API token'i calismazdi.

**Elenen yanlis cozumler:** `api_tokens`ta RLS'i kapatmak (tum token
metadata'si acilir) · uygulama roluna BYPASSRLS vermek (izolasyon biter)
· istemcinin gonderdigi tenant degerine guvenmek (sahtelenebilir).

**Uygulanan:** tek dar `SECURITY DEFINER` fonksiyonu — girdi token
**hash'i** (asla plaintext) + beklenen ortam; cikti yalnizca guvenli
tanimlayicilar; `search_path` SABIT; `EXECUTE` yalnizca runtime rolune;
dinamik SQL yok. Kesif sonrasi tenant baglami kurulur ve token/client
**normal RLS altinda yeniden okunur** — ayricalikli yol yalnizca "hangi
tenant?" sorusunu cevaplar, yetki karari VERMEZ.

### Iki tenantli Public API matrisi (9 test, GERCEK non-owner rol)

| Senaryo | Sonuc |
|---|---|
| Dar fonksiyon dogru tenant'i cozer | ✅ |
| Fonksiyon is verisi DONDURMEZ (kolon kumesi kilitli) | ✅ |
| Bilinmeyen hash hicbir sey cozmez | ✅ |
| A baglaminda B'nin client'i | gorunmuyor ✅ |
| **AYNI client adi iki tenant'ta** | yan yana yasiyor ✅ |
| A baglaminda B'nin token satiri | okunamiyor ✅ |
| Denetim kayitlari capraz okuma | yok ✅ |
| **AYNI idempotency anahtari iki tenant'ta** | bagimsiz ✅ |
| A'nin token'i B'nin client'ina baglanma | reddedildi ✅ |
| Baglamsiz token taramasi | 0 satir ✅ |

### MCP

Gorunurluk cache'i workspace'i **saklar ve her cozumde karsilastirir**;
uyusmazlikta giris silinir ve istek reddedilir. Yeni yapisal kapilar:
hicbir tool tenant/workspace argumani almaz, hicbir tool upstream
override'i almaz, MCP hala DB/RBAC import etmez.

### Ek duzeltmeler

- `_touch_last_used` istegin session'inda commit ediyordu → tenant
  baglamini dusuruyordu. Yazma, isteğin kendi engine'inden alinan kisa
  bir yan baglantiya tasindi.
- Rate-limit anahtari tenant tasiyor.
- `/v1/me` artik `workspace` (id + slug) doner.

## Test durumu (WS6 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **461** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **104** |
| frontend | 850 | 850 |

## Kalan is (WS7–WS11)

WS7 reporting/meetings/notifications + backup · WS8 frontend tenant app ·
WS9 Platform Admin Console · WS10 CI/CD + manifest · WS11 nihai kanit.

## WS7 — Reporting, bildirimler, job'lar ve yedekleme ✅ TAMAM

Commit: `1b38809`

### Job'lar

`task_auto_archive` artik `tenant_runner` uzerinden **tenant basina**
kosuyor. Onceden tek global taramaydi: RLS altinda ya sifir satir
gorurdu, ya da **bir tenant'in saklama politikasi baska bir tenant'in
kayitlarini arsivlerdi**. Is kendi baglantisini actigi icin tenant
baglami o baglantida da kuruluyor; SQL ifadeleri ayrica acikca tenant'a
bagli (savunma derinligi).

### Capraz-tenant e-posta riski kapatildi

| Yol | Onceki durum | Simdi |
|---|---|---|
| `/internal/directory/users/resolve` | herhangi bir kimligin e-postasini cozerdi | tenant_id ZORUNLU + **aktif uyelik** filtresi |
| `/internal/directory/users` | platform-genelinde liste | "o tenant icinde global" |
| core `directory_client` cache | anahtar `user_id` | anahtar **`(tenant_id, user_id)`** |
| bildirim gonderimi | tenant'siz | `tenant_id` zorunlu (internal + Public API) |

Cache anahtari onemliydi: yalnizca `user_id` ile anahtarlamak, A'da
cozulmus bir profilin (**e-posta dahil**) B'de servis edilmesi demekti.

### Yedekleme

- CSV export **tenant basina ayri dosya** (`hermes_weekly_<slug>_...`).
- Kullanici cozumu tenant uyeligiyle sinirli.
- Dump artik **her iki veritabanini** alir (core + auth): tenant
  kayitlari/uyelikler auth_db'de, is verisi core_db'de; yalnizca core'u
  geri yuklemek sahipsiz satirlar birakirdi.
- Retention ayristirmasi sondan-ikinci parcayi tarih kabul ediyor. Sabit
  indeks kalsaydi slug eklendigi anda her dosya "ayristirilamadi" diye
  atlanir ve **eski CSV'ler sonsuza kadar birikirdi**; eski adlandirma
  da ayni mantikla dogru ayristiriliyor.

### Reporting

Stateless kaliyor ve DB'ye dogrudan erismiyor; cagiranin **tenant-scoped
JWT**'sini `/rbac/me`'ye ilettigi icin tenant kapsamini otomatik
devraliyor (izinler zaten tenant icinde cozuluyor).

## Test durumu (WS7 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **461** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **104** |
| frontend | 850 | 850 |

## Kalan is (WS8–WS11)

WS8 frontend tenant app · WS9 Platform Admin Console · WS10 CI/CD +
manifest · WS11 nihai kanit.

## WS8 — Frontend tenant uygulamasi ✅ TAMAM

Commit: `d15d423`

### Anahtar uzayi tenant'a gore bolundu

Her query anahtari artik `['t', <tenant>, <aile>, ...]`. Anahtarlar
**getter** olarak tanimlandi: `queryKeys.customers.all` yazan 200+ cagri
noktasi **degismedi**, ama deger her erisimde guncel tenant ile
uretiliyor. Sonuc: A'nin cache girisi B baglaminda **yapisal olarak
okunamaz** — temizlik kacirsa bile.

### Tenant degisimi — sira testle kilitli

1. ucusan sorgular **iptal** edilir
2. cache tamamen **bosaltilir**
3. tenant kapsami degisir
4. izinler `null`'a doner (can() fail-closed)

Iptal, temizlikten **once** olmali: aksi halde ucusan bir yanit
temizlikten sonra gelip yeni tenant'in cache'ine yazilirdi. Bu, en sinsi
sizinti bicimi — ve testle sabitlendi.

### Organizasyon secici

Yalnizca **birden fazla aktif uyelikte** gorunur; tek organizasyonlu
kurulumda hicbir sey degismez. Secim bir **taleptir**: gecis
`POST /auth/switch-tenant` ile sunucuda dogrulanir (uyelik + tenant
durumu), cerez orada rotate edilir. Yanit gelmeden hicbir state degismez.

### Oturum geri yukleme

`GET /auth/users/me` artik tenant ozetini de doner; sayfa yenilemesinde
query kapsami **ilk istekten once** dogru tenant'a sabitleniyor (aksi
halde ilk sayfa anonim kapsamda cache'lenir ve tenant gelince ayni veri
ikinci kez cekilirdi).

## Test durumu (WS8 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **461** |
| auth-service | 49 | **95** |
| mcp-service | 98 | **104** |
| frontend | 850 | **860** |

Prod build + `env-config` artifact kapisi gecti.

## Kalan is (WS9–WS11)

WS9 Platform Admin Console · WS10 CI/CD + manifest · WS11 nihai kanit.

## WS9 — Platform Admin Console ✅ TAMAM

Commit: `f067c70`

### Duzlem ayriligi (cikis kriteri 1)

| Kontrol | Sonuc |
|---|---|
| Oturumsuz platform istegi | 401 ✅ |
| TENANT cerezi platform ucunda | 401 ✅ |
| Gecerli kullanici, `platform_admins` kaydi YOK | 403 ✅ |
| Tenant izin kodlari (`users.manage` vb.) platform kaydinda | etkisiz ✅ |
| `tenants.view` olan operator lifecycle calistirma | 403 ✅ |

### Is verisi erisimi (cikis kriteri 2)

Tenant detayi **yalnizca metadata** doner (durum, plan, uye SAYISI);
donen alan kumesi testle kilitli. Gorev/musteri/proje/zaman kaydi bu
duzlemden **gorunmez** — gorunseydi destek izni mekanizmasi anlamsiz
olurdu.

**Destek erisimi:** sureli (azami 30 dk), gerekceli, denetlenen.
Salt-okunur varsayilan; yazma **ayri izin** ister. Exchange **TENANT
audience'li** token uretir — yani destek oturumunu **RLS de baglar**:
"her seyi goren" bir yol degil, belirli bir tenant'a acilan sureli
pencere. Token `support_grant_id` + `support_mode` tasir, `membership_id`
**yoktur** (operator o organizasyonun uyesi degildir; gercek bir
kullanicinin oturumu taklit EDILMEZ).

Izin onu **olusturan** operatore aittir; baskasi kullanamaz. Iptal veya
sure dolumu exchange'i reddeder.

### Yasam dongusu

Durum makinesi + iyimser kilit birlikte: gecersiz gecis 409, bayat
surumle islem 409 (iki operator birbirini sessizce ezemez). Suspend
yazili slug onayi ister.

### Bootstrap

`bootstrap_platform_admin.py` idempotent; sifre **hicbir yerde
saklanmaz** — ya runtime env'den gelir ya uretilip stdout'a bir kez
yazilir. Testle kilitli.

### Frontend

`/platform-admin` **ayri rota agaci + lazy chunk** (build ciktisinda
`PlatformConsole`/`PlatformLoginPage` ayri dosyalar — normal kullanici
bu kodu indirmez). **Ayri store**: tenant store'u ile tek bir alan bile
paylasilmaz. MainLayout/sidebar kullanilmaz.

Destek banner'i **kalici** — "hide" aksiyonu **yok** (testle kilitli);
tenant adi, mod ve kalan sure metinle de belirtilir.

## Test durumu (WS9 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **461** |
| auth-service | 49 | **113** |
| mcp-service | 98 | **104** |
| frontend | 850 | **868** |

## Kalan is (WS10–WS11)

WS10 CI/CD + manifest · WS11 nihai kanit/rapor.

## WS10 — CI/CD, manifest ve operasyonel dogrulama ✅ TAMAM

Commit: `a02620b`

### Readiness sema uyumlulugunu kontrol ediyor

Yeni `/ready` ucu (auth + core): sema revizyonu koddaki head degilse
**503**. K8s `readinessProbe` buna gecti.

**Liveness bilerek `/health`te kaldi** — yanlis sema pod'u yeniden
BASLATMAMALI (crashloop olurdu), yalnizca **trafikten alinmali**. Yanit
ayrinti sizdirmaz: revizyon adi/tablo/hata metni disariya cikmaz.

### Rollout sonrasi tenant izolasyon dumani

`scripts/k8s/post-deploy-tenant-smoke.sh` — canli ortamda 6 kontrol:

| # | Kontrol |
|---|---|
| 1 | auth + core sema revizyonlari |
| 2 | runtime rol: NOBYPASSRLS **ve** tablo sahibi degil |
| 3 | RLS kapsami: ENABLE + FORCE + politika |
| 4 | backfill butunlugu: `tenant_id` NULL satir yok |
| 5 | **baglamsiz erisimde 0 satir** (fail-closed'in canli kaniti) |
| 6 | `/ready` → 200 |

Salt-okunur; hicbir sifre/token yazdirmaz. CD'de deploy'un **son
adimi**: rollout'u geri almaz ama yanlis bir sey canliya ciktiysa kosuyu
kirmizi yapar. Katalog sorgulari gercek migrate edilmis DB'de dogrulandi
(0/0).

### Manifest ve config

- Migration Job: ilk tenant degerleri ConfigMap'ten, runtime rol adi
  Secret'tan. **Slug sonradan degistirilirse mevcut veri tasinmaz** —
  yeni tenant olusur (ConfigMap yorumunda yazili).
- `HERMES_ALLOW_WORKSPACE_PATH: "false"` — production'da host disinda
  tenant secme yolu birakilmaz.
- `k8s/08`: Platform Super Admin bootstrap Job'i. CD **kosmaz**; elle
  calistirilir, sifre manifest'te **yoktur**.

### Runbook

`docs/tenant-cutover-runbook.md`: cutover oncesi koordineli auth+core
yedegi, rol kurulumu, secret/ConfigMap adimlari; cutover sonrasi
dogrulama; **restore drill** (izole DB'lere cift geri yukleme +
tutarlilik + "RLS metadata restore ile geldi mi"); geri donus sinirlari
(**RLS'i toplu kapatip trafigi geri acmak acikca yasak**); ve bilinen
sinirlamalar.

## Test durumu (WS10 sonu)

| Suite | Baseline | Simdi |
|---|---|---|
| core-service | 428 | **461** |
| auth-service | 49 | **113** |
| mcp-service | 98 | **104** |
| frontend | 850 | **868** |

## Kalan is

WS11 — nihai QA/kanit raporu (`14_DEFINITION_OF_DONE_AND_EVIDENCE.md`
formatinda).

## WS11 — Nihai QA ve kanit ✅ TAMAM

Nihai rapor: **`HERMES_TENANT_CUTOVER_EVIDENCE.md`**
(`14_DEFINITION_OF_DONE_AND_EVIDENCE.md` §7 formatinda, 15 baslik).

**Durum: PARTIAL** — kod/sema/testler tamam ve yerel olarak
kanitlandi; dagitima bagli kanitlar (CI run, rollout, gorsel QA)
uretilmedi ve hicbiri "gecti" diye isaretlenmedi.

### Final gate (bir kez, son commit uzerinde)

| Suite | Sonuc | Sure |
|---|---|---|
| secret guard | OK | <1 s |
| core-service | **461 passed** | 16.9 s |
| auth-service | **113 passed** | 2.8 s |
| mcp-service | **104 passed** | 4.1 s |
| frontend | **868 passed** / 63 dosya | 185.8 s |
| frontend build + artifact kapisi | OK | 2.9 s |
| taze DB → head | auth `0003`, core `0006` | ~1 s |
| pre-tenant snapshot → head | ✅ | ~1 s |
| idempotency (2./3. kosu) | sifir degisiklik | ~1 s |

Baseline'a gore **+181 test, 0 basarisiz**.

### Backup/restore drill — GERCEKTEN kosuldu

Koordineli dump (auth 45K + core 197K) → izole hedeflere restore →
auth ve core **ayni tenant UUID**'sini tasiyor → **FORCE RLS eksik
tablo: 0**, politika: 33, composite FK: 33 → restore edilmis DB'de
gercek `NOBYPASSRLS` rol ile: baglamsiz **0 satir**, dogru tenant
**3 satir**, baska tenant **0 satir**.

Yani yedek yalnizca veriyi degil **izolasyon garantisini de** geri
getiriyor.

### Kalan (durustce)

Push YAPILMADI — sira zorunlulugu: once operator sunucuda yedek + rol
kurulumu + `hermes-db-roles` secret'ini olusturmali. Aksi halde
migration Job basarisiz olur, deploy hic calismaz.
