# Hermes Tenant SaaS — Cutover ve Kurtarma Runbook'u

Bu belge **operatör** içindir: cutover'ı uygulama, doğrulama ve
gerektiğinde geri dönme adımları. Mimari gerekçeler için
`HERMES_TENANT_CTO_PACK/` ve `hermes_tenant_saas_working_report.md`.

> **Ortam kapsamı:** yalnızca `hermes-dev`. `test` branch'i ve
> `hermes-test` namespace'i bu çalışmanın dışındadır ve
> **dokunulmamıştır**.

---

## 0. Cutover neyi değiştirir

| Önce | Sonra |
|---|---|
| Şema startup'ta `create_all` + 13 ad-hoc ALTER | Versiyonlu Alembic; pod DDL koşmaz |
| Uygulama `hermes` **superuser**'ı ile bağlanır | `hermes_*_app` (NOBYPASSRLS, tablo sahibi değil) |
| Satır izolasyonu yok | 33 tabloda **FORCE RLS** + tenant-qualified kısıtlar |
| JWT: user/email/is_admin | + `tenant_id`, `membership_id`, `aud`, `jti` |
| Tek global workspace | `duosis` tenant'ı + Platform Admin düzlemi |

**Geri dönüşü zor sınır:** core migration `0005_tenant_enforce`.
Bundan öncesi additive'dir (eski image aynı şemayla çalışır); sonrası
için kurtarma yolu **ileri düzeltme** veya koordineli restore'dur.

---

## 1. Cutover öncesi hazırlık (sunucuda, elle)

CD yalnızca `set image` ve migration Job'ı çalıştırır. Aşağıdaki
adımlar **operatörün** işidir (CLAUDE.md kuralı).

### 1.1 Koordineli yedek — ZORUNLU

```bash
NS=hermes-dev
STAMP=$(date +%Y%m%d-%H%M%S)

kubectl -n $NS exec core-db-0 -- \
  pg_dump -U hermes -d core_db -F c > core_db_$STAMP.dump
kubectl -n $NS exec auth-db-0 -- \
  pg_dump -U hermes -d auth_db -F c > auth_db_$STAMP.dump

ls -lh core_db_$STAMP.dump auth_db_$STAMP.dump   # boyut > 0 OLMALI
```

> İkisi **birlikte** alınır. Tenant kayıtları/üyelikler `auth_db`'de,
> iş verisi `core_db`'de yaşar; yalnızca birini geri yüklemek sahipsiz
> satırlar bırakır.

### 1.2 DB rolleri

```bash
kubectl -n $NS exec -i core-db-0 -- psql -U hermes -d core_db \
  -v ON_ERROR_STOP=1 -v prefix=hermes_core \
  -v migrator_password='<CORE_MIGRATOR_PW>' \
  -v app_password='<CORE_APP_PW>' \
  -f - < backend/sql_scripts/roles/00_roles.sql

kubectl -n $NS exec -i auth-db-0 -- psql -U hermes -d auth_db \
  -v ON_ERROR_STOP=1 -v prefix=hermes_auth \
  -v migrator_password='<AUTH_MIGRATOR_PW>' \
  -v app_password='<AUTH_APP_PW>' \
  -f - < backend/sql_scripts/roles/00_roles.sql
```

Betiğin çıktısında **`bypasses_rls = f`** ve
**`tables_owned_by_app_role = 0`** görülmelidir.

> **Şifreyi tırnaksız geçin** ve doğrulamayı **127.0.0.1 üzerinden
> yapmayın** — gerekçeler `backend/sql_scripts/roles/README.md`'de.
> İkisi de hermes-test'te gerçek arızaya yol açtı.

### 1.2b Var olan nesnelerin migrator'a devri — ZORUNLU

`00_roles.sql` şemanın sahibini migrator yapar ama **önceden var olan**
nesnelerin sahipliğini değiştirmez. Eski Hermes şemayı uygulama
startup'ında superuser `hermes` adına yaratıyordu; migrator o nesnelerin
sahibi olmadığı için migration yarıda kırılır:

```
InsufficientPrivilege: must be owner of function assign_task_type_number
```

```bash
kubectl -n $NS exec -i core-db-0 -- psql -U hermes -d core_db \
  -v ON_ERROR_STOP=1 -v prefix=hermes_core \
  -f - < backend/sql_scripts/roles/01_adopt_objects.sql

kubectl -n $NS exec -i auth-db-0 -- psql -U hermes -d auth_db \
  -v ON_ERROR_STOP=1 -v prefix=hermes_auth \
  -f - < backend/sql_scripts/roles/01_adopt_objects.sql
```

Çıktının sonundaki **`kalan = 0`** görülmelidir.

> **Eklenti nesnelerine dokunulmaz.** `core_db`'de TimescaleDB kurulu ve
> `public` şemasında 100'den fazla fonksiyonu var; betik
> `pg_depend.deptype='e'` ile onları dışarıda bırakır. Devredilirlerse
> eklenti ve `pg_dump` bozulur. Filtre bir iyileştirme değil, doğruluk
> şartıdır — testle kilitli.

`run-migration-job.sh` bu koşulu Job'ı başlatmadan **önce** doğrular ve
eksikse net talimatla durur.

### 1.3 `hermes-db-roles` secret'ı

Anahtar sözleşmesi: `backend/sql_scripts/roles/README.md`.
Doğrulama (değer okumadan):

```bash
./scripts/k8s/check-runtime-secrets.sh $NS
```

### 1.4 ConfigMap

`k8s/01-configmap.yaml` içindeki `INITIAL_TENANT_*` değerleri gözden
geçirilir. **Slug sonradan değiştirilirse mevcut veri taşınmaz** —
yeni bir tenant oluşur.

```bash
kubectl -n $NS diff -f k8s/01-configmap.yaml    # ÖNCE diff
kubectl -n $NS apply -f k8s/01-configmap.yaml
```

---

## 2. Cutover (tek push)

`dev`'e push → CI kapıları (core/auth/mcp/frontend) → image build →
**migrate (bloklayan)** → deploy.

Migration Job başarısızsa **rollout hiç başlamaz**. Pod'lar da beklediği
şema revizyonu yoksa açılmaz (fail-closed).

Manifest değişiklikleri CD tarafından uygulanmaz; elle:

```bash
kubectl -n $NS diff  -f k8s/03-backend-auth.yaml     # ÖNCE diff
kubectl -n $NS apply -f k8s/03-backend-auth.yaml
kubectl -n $NS diff  -f k8s/03-backend-core.yaml
kubectl -n $NS apply -f k8s/03-backend-core.yaml

# apply, image'ı mutable etikete geri döndürür → SHA'ya yeniden pinle
kubectl -n $NS set image deployment/auth-service auth-service=ghcr.io/duosis-developer-team/hermes-auth-service:<SHA>
kubectl -n $NS set image deployment/core-service core-service=ghcr.io/duosis-developer-team/hermes-core-service:<SHA>
```

---

## 3. Cutover sonrası doğrulama

```bash
./scripts/k8s/post-deploy-tenant-smoke.sh $NS
```

Altı kontrol: şema revizyonları · runtime rol ayrımı · RLS kapsamı ·
backfill bütünlüğü · **bağlamsız erişimde 0 satır** · `/ready`.

Ek elle kontrol:

```bash
# İlk tenant ve üyelikler
kubectl -n $NS exec auth-db-0 -- psql -U hermes -d auth_db -c \
  "SELECT slug, status FROM tenants;
   SELECT status, count(*) FROM tenant_memberships GROUP BY status;"

# Task kodları DEĞİŞMEMİŞ olmalı
kubectl -n $NS exec core-db-0 -- psql -U hermes -d core_db -c \
  "SELECT task_type, min(type_number), max(type_number) FROM tasks GROUP BY task_type;"
```

---

## 4. Platform Super Admin

```bash
IMAGE_TAG=<SHA> NAMESPACE=$NS \
  envsubst '${IMAGE_TAG} ${NAMESPACE}' \
  < k8s/08-platform-admin-bootstrap-job.yaml | kubectl apply -f -

kubectl -n $NS logs job/hermes-platform-bootstrap   # tek seferlik şifre
kubectl -n $NS delete job hermes-platform-bootstrap # log okununca SİL
```

Şifre üretilir ve **yalnızca bir kez** log'a yazılır; hiçbir yerde
saklanmaz. Parola yöneticisine alın ve ilk girişte değiştirin.

---

## 5. Restore drill (izole ortam)

Yedek, **geri yüklenebildiği kanıtlanana kadar** yedek sayılmaz.

```bash
# 1) Tek kullanımlık hedef veritabanları
kubectl -n $NS exec core-db-0 -- psql -U hermes -d postgres \
  -c "CREATE DATABASE restore_drill_core;"
kubectl -n $NS exec auth-db-0 -- psql -U hermes -d postgres \
  -c "CREATE DATABASE restore_drill_auth;"

# 2) Geri yükle (ÇİFT olarak — aynı yedek penceresinden)
kubectl -n $NS exec -i core-db-0 -- \
  pg_restore -U hermes -d restore_drill_core --no-owner < core_db_$STAMP.dump
kubectl -n $NS exec -i auth-db-0 -- \
  pg_restore -U hermes -d restore_drill_auth --no-owner < auth_db_$STAMP.dump

# 3) Tutarlılık: her tenant üyeliğinin karşılığı var mı?
kubectl -n $NS exec auth-db-0 -- psql -U hermes -d restore_drill_auth -c \
  "SELECT (SELECT count(*) FROM tenants)  AS tenants,
          (SELECT count(*) FROM tenant_memberships) AS memberships;"
kubectl -n $NS exec core-db-0 -- psql -U hermes -d restore_drill_core -c \
  "SELECT count(DISTINCT tenant_id) AS tenants_with_data FROM tasks;"

# 4) İzolasyon hâlâ geçerli mi? (RLS metadata restore ile gelir)
kubectl -n $NS exec core-db-0 -- psql -U hermes -d restore_drill_core -c \
  "SELECT count(*) AS tables_without_force_rls
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_name=c.relname AND col.column_name='tenant_id')
      AND c.relname NOT IN ('tenant_registry','tenant_counters')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity);"
# Beklenen: 0

# 5) Temizlik
kubectl -n $NS exec core-db-0 -- psql -U hermes -d postgres \
  -c "DROP DATABASE restore_drill_core;"
kubectl -n $NS exec auth-db-0 -- psql -U hermes -d postgres \
  -c "DROP DATABASE restore_drill_auth;"
```

**RPO/RTO (dev):** haftalık yedek → RPO ≤ 7 gün; restore drill süresi
veri boyutuna bağlı, dev ölçeğinde dakikalar (RTO ≤ 1 saat). Bunlar dev
değerleridir; production hedefleri ayrı bir karardır.

---

## 6. Geri dönüş sınırları

### `0005_tenant_enforce` ÖNCESİ

Eski image additive şemayla çalışır. Yeni tablo/kolonlar **yerinde
bırakılır**, backfill edilmiş `tenant_id` değerleri **silinmez**.

### `0005_tenant_enforce` SONRASI

- Tercih edilen yol **ileri düzeltme**dir.
- **RLS'i toplu kapatıp trafiği geri açmak YASAKTIR** (pack runbook §10).
  Bu, tüm tenant izolasyonunu bir anda kaldırır.
- Gerekirse: yalnızca yeni trafik yolunu kapatın (ör. ingress),
  koordineli yedeği **izole** bir ortama geri yükleyin, inceleyin,
  sonra ileri düzeltme uygulayın.
- Olay ve denetim kanıtı kaydedilir (`platform_audit_events`).

---

## 7. Bilinen sınırlamalar

1. **E-posta paritesi canlı doğrulanmadı** — kod S2S ile alıcıyı tenant
   içinde çözüyor, ancak uçtan uca canlı gönderim testi yapılmadı.
2. **OAuth 2.1 authorization server yok** → external MCP client
   uyumluluğu iddia edilmiyor.
3. **Rate limiter in-memory** — tek pod doğru; yatay ölçeklemede
   paylaşılan bir store (Redis) gerekir.
4. `k8s/test/05-ingress.yaml` canlıdan farklı (ayrı bakım commit'i
   bekliyor) — bu çalışmada **dokunulmadı**.
5. Provisioning saga'sı veri modeli olarak hazır; **yeni tenant
   oluşturma sihirbazı** (UI) v1 kapsamı dışında bırakıldı — mevcut
   Duosis tenant'ı migration ile kuruluyor.
