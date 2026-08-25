# Hermes DB rolleri — migrator / runtime ayrimi

**Neden var:** PostgreSQL'de `SUPERUSER` ve `BYPASSRLS` yetkili roller
Row Level Security'yi **asar**. `FORCE ROW LEVEL SECURITY` tablo
*sahibini* de politikaya tabi kilar, ama superuser'i etmez.

Bugun (cutover oncesi) uygulama pod'lari veritabani superuser'i `hermes`
ile baglaniyor. Bu haliyle RLS politikasi yazsak bile **hicbir sey
korumaz**. Bu yuzden rol ayrimi, tenant izolasyonunun *onkosuludur* —
sonradan yapilacak bir iyilestirme degil.

| Rol | Kim kullanir | Nitelikler | Sahiplik |
|---|---|---|---|
| `hermes_auth_migrator` / `hermes_core_migrator` | **yalnizca** migration Job'i | `NOSUPERUSER`, **`BYPASSRLS`** | sema nesnelerinin **sahibi** |
| `hermes_auth_app` / `hermes_core_app` | uygulama pod'lari | `NOSUPERUSER`, **`NOBYPASSRLS`** | **hicbir tablonun sahibi degil** |

Migrator'in `BYPASSRLS` olmasi kasitlidir: backfill migration'lari tenant
context'i olmadan satir yazmak zorundadir. Bu kimlik yalnizca Job'a
verilir; uygulama Deployment'lari onu **gormez**.

---

## Kurulum (her ortamda BIR kez, superuser ile)

Betik idempotenttir; yeniden calistirmak guvenlidir.

```bash
# --- core_db ---
kubectl -n hermes-dev exec -i core-db-0 -- \
  psql -U hermes -d core_db -v ON_ERROR_STOP=1 \
       -v prefix=hermes_core \
       -v migrator_password='<CORE_MIGRATOR_PW>' \
       -v app_password='<CORE_APP_PW>' \
       -f - < backend/sql_scripts/roles/00_roles.sql

# --- auth_db ---
kubectl -n hermes-dev exec -i auth-db-0 -- \
  psql -U hermes -d auth_db -v ON_ERROR_STOP=1 \
       -v prefix=hermes_auth \
       -v migrator_password='<AUTH_MIGRATOR_PW>' \
       -v app_password='<AUTH_APP_PW>' \
       -f - < backend/sql_scripts/roles/00_roles.sql
```

> **SIFREYI TIRNAKSIZ GECIN.** Betik `:'migrator_password'` kullanir ve
> psql degeri ZATEN SQL literali olarak tirnaklar. Deger icinde ayrica
> tirnak olursa cift tirnaklanir ve gercek sifre `'abc123'` (tirnaklar
> DAHIL) olur. Bu hata sessizdir: rol yaratilir, betik basarili gorunur,
> ama uygulama/migration `password authentication failed` alir.
> hermes-test'te birebir yasandi.

> **DOGRULAMAYI 127.0.0.1 UZERINDEN YAPMAYIN.** `pg_hba.conf`'ta
> localhost `trust`'tir; oradan yapilan baglanti sifreyi HIC dogrulamaz
> ve yanlis sifreyle bile basarili olur. Gercek yol Service DNS +
> `scram-sha-256`'dir:
>
> ```bash
> kubectl -n <ns> exec deploy/auth-service -- \
>   env PGPASSWORD="<AUTH_APP_PW>" python -c \
>   "import os,psycopg2;psycopg2.connect(host='auth-db',port=5432,\
>    user='hermes_auth_app',password=os.environ['PGPASSWORD'],\
>    dbname='auth_db');print('OK')"
> ```

Betik sonunda iki dogrulama tablosu basar:

- rol nitelikleri — `hermes_*_app` icin `bypasses_rls = f` **olmali**;
- `tables_owned_by_app_role` — **0 olmali**.

Bu iki cikti, `12_TEST_SECURITY_AND_QA_PLAN.md` §4'teki
"owner/runtime rol ayrimi" kanitidir ve entegrasyon testlerinde de
makine ile dogrulanir.

## Secret sozlesmesi (`hermes-db-roles`)

Sifreler repoda **tutulmaz**. Namespace'te su anahtarlarla bir Secret
olusturulur:

| Key | Kullanan |
|---|---|
| `AUTH_MIGRATION_DATABASE_URL` | migration Job (tam URL, migrator kimligi) |
| `CORE_MIGRATION_DATABASE_URL` | migration Job (tam URL, migrator kimligi) |
| `AUTH_APP_DB_USER` / `AUTH_APP_DB_PASSWORD` | auth-service pod'lari |
| `CORE_APP_DB_USER` / `CORE_APP_DB_PASSWORD` | core-service pod'lari |

```bash
kubectl -n hermes-dev create secret generic hermes-db-roles \
  --from-literal=AUTH_MIGRATION_DATABASE_URL='postgresql://hermes_auth_migrator:<PW>@auth-db:5432/auth_db' \
  --from-literal=CORE_MIGRATION_DATABASE_URL='postgresql://hermes_core_migrator:<PW>@core-db:5432/core_db' \
  --from-literal=AUTH_APP_DB_USER='hermes_auth_app' \
  --from-literal=AUTH_APP_DB_PASSWORD='<PW>' \
  --from-literal=CORE_APP_DB_USER='hermes_core_app' \
  --from-literal=CORE_APP_DB_PASSWORD='<PW>'
```

`scripts/k8s/check-runtime-secrets.sh` bu anahtarlarin **varligini**
dogrular (degerleri okumaz) ve eksikse rollout'u durdurur.

## Uygulama Deployment'larinin gecisi

`k8s/03-backend-auth.yaml` ve `k8s/03-backend-core.yaml` icindeki
`*_DB_USER`/`*_DB_PASSWORD` kaynaklari `hermes-config`/`hermes-secrets`
yerine `hermes-db-roles`'e baglanir. CLAUDE.md kurali geregi bu
manifest degisikligini **CD uygulamaz** — sunucuda elle yapilir:

```bash
kubectl -n hermes-dev diff -f k8s/03-backend-core.yaml   # ONCE diff
kubectl -n hermes-dev apply -f k8s/03-backend-core.yaml
kubectl -n hermes-dev set image deployment/core-service \
  core-service=ghcr.io/duosis-developer-team/hermes-core-service:<SHA>
```

> Uyari: `03-backend-*.yaml` icindeki `image:` alani mutable etiket
> tasir. Apply sonrasi calisan surumu mutlaka immutable SHA'ya geri
> pinleyin (dosyanin basindaki uyariya bakin).
