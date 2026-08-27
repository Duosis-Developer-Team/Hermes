# Ticket Hub — operasyon rehberi

Ortak urun ticket platformunun **Hermes/Duosis (canonical)** tarafi.
Kaynak: `hermes-logislot-ticketing-cto-pack-v1.0/`.

## 1. Ne nerede

| Katman | Yol |
|---|---|
| Sozlesme sabitleri | `backend/core-service/app/ticket_contract.py` |
| Modeller | `backend/core-service/app/models/ticketing.py` |
| Migration | `app/migrations/versions/0007_ticketing_foundation.py` |
| Durum makinesi | `app/services/ticket_state.py` |
| Gorunurluk politikasi | `app/services/ticket_visibility.py` |
| Is mantigi | `app/services/ticket_service.py` |
| Olay + outbox | `app/services/ticket_event_service.py` |
| Webhook teslimati | `app/services/ticket_delivery_service.py` |
| Attachment | `app/services/ticket_{storage,scanner,attachment_service}.py` |
| Duosis hub API | `app/routers/tickets.py` |
| Musteri portali API | `app/routers/support_portal.py` |
| Entegrasyon yonetimi | `app/routers/ticket_admin.py` |
| Integration API (izole) | `app/support_api/` → `/api/integrations/v1/support` |
| Joblar | `app/jobs/ticket_dispatcher.py`, `app/jobs/ticket_maintenance.py` |
| Frontend | `frontend/src/pages/tickets/`, `frontend/src/features/tickets/` |
| Sozlesme fixture'lari | `docs/contracts/support-ticketing-v1/` |

## 2. Zorunlu konfigurasyon

Modul **fail-closed**'dur: `HERMES_SUPPORT_TENANT_ID` bos veya
dogrulanamazsa hicbir canonical ticket yazilmaz, servis normal calisir
ve `/tickets/context` `surface="unavailable"` doner.

```bash
# 1) Duosis tenant UUID'sini bul (auth_db):
kubectl -n hermes-dev exec deploy/auth-db -- \
  psql -U hermes -d auth_db -tAc \
  "SELECT id FROM tenants WHERE slug = 'duosis';"

# 2) ConfigMap'e yaz (CD BUNU YAPMAZ — manuel):
kubectl -n hermes-dev get configmap hermes-config -o yaml > /tmp/cm.yaml
kubectl -n hermes-dev diff -f k8s/01-configmap.yaml     # ONCE DIFF
kubectl -n hermes-dev apply -f k8s/01-configmap.yaml

# 3) Deployment env sozlesmesi:
kubectl -n hermes-dev diff -f k8s/03-backend-core.yaml
kubectl -n hermes-dev apply -f k8s/03-backend-core.yaml
```

Startup logu dogrulamayi yazar:

```
🎫 Ticket Hub: {'state': 'ok', 'seeded': True}
```

`state` degerleri: `ok`, `not_configured`, `invalid_uuid`,
`unknown_tenant`, `inactive_tenant`, `disabled`.

## 3. Joblar

```bash
kubectl -n hermes-dev apply -f k8s/ticket-dispatcher-cronjob.yaml
kubectl -n hermes-dev apply -f k8s/ticket-maintenance-cronjob.yaml
```

## 3b. Ingress (integration API disari acilir)

`/api/integrations` kurali OLMADAN istek SPA catch-all'ina duser ve
kaynak uygulama JSON yerine `index.html` alir — 200 donen, sessizce
YANLIS bir cevap. Kural `k8s/05-ingress.yaml`e eklendi; CD ingress'e
DOKUNMAZ:

```bash
kubectl -n hermes-dev diff -f k8s/05-ingress.yaml    # ONCE DIFF (drift!)
kubectl -n hermes-dev apply -f k8s/05-ingress.yaml
curl -sk https://84.247.180.172:30772/api/integrations/v1/support/capabilities
```

`hermes-test` icin `k8s/test/05-ingress.yaml` repo'da canlidan
FARKLIDIR (bilinen drift) — orada apply EDILMEDEN once ayri bir bakim
karari gerekir.

- **dispatcher** (dakikada bir): outbox → imzali webhook. `FOR UPDATE
  SKIP LOCKED` + advisory lock; iki kosu ayni olayi gonderemez.
- **maintenance** (saatlik): 7 gunluk auto-close, suresi dolmus
  **baglanmamis** upload temizligi, idempotency budama. Ticket/mesaj/
  cozum/audit **silinmez**.

## 4. Yeni bir kaynak uygulama baglamak

1. `POST /tickets/admin/applications` — `code` (immutable), callback URL.
2. Secret: `HERMES_TICKET_WEBHOOK_SECRET__<CODE_UPPER>` (rotasyon icin
   `_NEXT`). Sir yoksa olay **gonderilmez**; imzasiz gonderme yolu yok.
3. `POST /tickets/admin/integration-clients` — dar scope seti.
4. `POST .../tokens` — plaintext **bir kez** gorunur.
5. `POST /tickets/admin/source-tenants` — musteri mapping'i.
6. `PUT /tickets/admin/source-tenants/{id}/route` — tek aktif grup.
7. Consumer contract testleri: `docs/contracts/support-ticketing-v1/`.

### 4b. Self-servis routing (5 ve 6 adimlarini kaynak uygulamaya devretmek)

Varsayilan tasarimda hedef ekibi YALNIZCA Duosis tarafi atar (04 §4):
kaynak uygulama elindeki service token ile keyfi bir Duosis ekibini —
ornegin baska bir musteriye ait bir kuyrugu — hedefleyemesin diye.
Bedeli sudur: kaynak uygulamanin panelinde secilen her ekip icin Duosis'te
onceden bir route tanimlanmis olmalidir, yoksa `route_group_mismatch` /
`route_missing` doner. (LogiSlot'ta "Yonlendirme Hermes tarafinda
dogrulanamadi" hatasi tam olarak buydu.)

Uygulama basina acilan bir bayrak bu iki adimi kaynak uygulamaya devreder:

```sql
UPDATE support_applications
   SET capabilities_json = coalesce(capabilities_json,'{}'::jsonb)
                           || '{"self_service_routing": true}'::jsonb
 WHERE code = 'logislot';
```

Acikken `POST /support/routes/validate` yalnizca dogrulamaz, **baglar**:
istenen grup aktifse route'u kurar ve gerekiyorsa kaynak tenant'i da
olusturur. Kapaliyken davranis birebir eskisi gibidir.

Bayrak acikken de gecerli kalan sinirlar:

| Sinir | Sonuc |
|---|---|
| Yalnizca AKTIF gruplar | pasif grup -> `group_inactive` |
| Yazma scope'u sart | yalnizca `groups:read` -> 403 `insufficient_scope` |
| Uygulama siniri | kapsam TOKEN kaydindan gelir; LogiSlot'un bayragi `hermes` uygulamasinin route'una dokunamaz |
| Denetim | her baglama `actor_type=integration_client` + client id ile yazilir |

Route KAYDI yine olusur — "kayitli hicbir sey olmasin" mumkun degildir,
cunku ticket create hedef grubu route'tan cozer. Degisen sey, o kaydi
KIMIN olusturdugudur: artik kaynak uygulamanin secimi olusturuyor.

Sozlesme DEGISMEDI (yeni alan/hata kodu yok), dolayisiyla consumer
fixture'lari etkilenmez.

## 5. Saglik

`GET /api/v1/core/tickets/admin/health` (`tickets.admin`):

- `module_state`, `support_tenant_configured`
- `attachments_production_ready` — **dev'de her zaman `false`**:
  yerel depo + tarayicisiz mod calisir ama uretim sayilmaz.
- `object_storage_reachable`, `malware_scanner_reachable`
- `delivery`: pending / in_flight / delivered / **dead**
- `unrouted_source_tenants`

`/ready` yalnizca `TICKET_ATTACHMENTS_ENABLED=true` iken attachment
yapilandirmasini dogrular; eksikse pod trafige alinmaz (fail-open yok).

## 6. Metrikler

Drake sozlesmesindeki iki HTTP metrigi **degismedi**. Yaninda:

```
ticket_created_total{application,category}
ticket_transition_total{from_status,to_status}
ticket_message_total{visibility}
ticket_delivery_attempt_total{direction,result}
ticket_webhook_signature_failure_total{application}
ticket_attachment_scan_total{result,mime}
ticket_authz_denied_total{surface,reason}
ticket_create_duration_seconds / ticket_first_response_duration_seconds
ticket_resolution_duration_seconds / ticket_delivery_latency_seconds
ticket_outbox_pending / ticket_outbox_dead  (gauge)
```

Tenant ID, ticket ID ve hata metni **etiket degildir**.

## 6b. hermes-test terfisi (2026-08-27 — YAPILDI)

Sirasiyla: dogrulanmis yedek → ff-only push → cd-test (migrate+deploy)
→ elle konfigurasyon.

```bash
# 1) YEDEK — pg_restore POD ICINDE dogrulanir (node'da istemci yok)
kubectl -n hermes-test exec auth-db-0 -- pg_dump -U hermes -d auth_db -Fc > auth_db.dump
kubectl -n hermes-test exec core-db-0 -- pg_dump -U hermes -d core_db -Fc > core_db.dump
kubectl -n hermes-test exec -i core-db-0 -- sh -c \
  'cat > /tmp/v.dump && pg_restore --list /tmp/v.dump | grep -c "TABLE DATA"'  < core_db.dump

# 2) ff-only terfi (test dev'in ATASI olmali)
git merge-base --is-ancestor origin/test origin/dev && git push origin origin/dev:test

# 3) elle konfigurasyon (CD bunlari YAPMAZ)
kubectl -n hermes-test diff -f k8s/test/01-configmap.yaml   # ONCE DIFF
kubectl -n hermes-test apply -f k8s/test/01-configmap.yaml
kubectl -n hermes-test set env deployment/core-service --from=configmap/hermes-config \
  --keys=SUPPORT_TICKETS_ENABLED,HERMES_SUPPORT_TENANT_ID,...   # apply DEGIL: image pini
kubectl -n hermes-test apply -f k8s/test/ticket-dispatcher-cronjob.yaml \
                             -f k8s/test/ticket-maintenance-cronjob.yaml
```

**Ingress — IKI kurala birden:** `hermes-mcp-ingress` test'te
`hermes.duosis.com` host'unu sahiplenir ve tum uygulama route'larini
tasir. Yalnizca host'suz kurala eklemek, IP:30443'te calisan ama public
host'ta SPA'ya dusen bir uc uretir (200 donen sessiz hata). Ayrinti:
`k8s/test/05-ingress.yaml` basindaki drift notu.

**test ≠ dev farklari:** tenant UUID farkli · `PUBLIC_API_ENV=live`
(token'lar `hsi_live_`, application `environment=live`) ·
`TICKET_WEBHOOK_ALLOW_INSECURE_HTTP=false` (kume ici duz HTTP istisnasi
TASINMAZ) · `TICKET_SCANNER_MODE=clamav`.

## 6c. Uc AYRI panel (karistirmasi kolay)

| Panel | Kimlik | Ne yapar |
|---|---|---|
| **Hermes Platform Console** `/platform-admin` | `superadmin@hermes.dev` (`platform_admins`) | **Support routing**: tenant → saglayici → ekip. Ticket ICERIGI gostermez. |
| Hermes tenant arayuzu | tenant kullanicisi (orn. `admin@duosis.com`) | `/tickets` agent hub'i, `/support` musteri portali, `/ticket-integrations` |
| LogiSlot platform paneli `:30086` | LogiSlot'un kendi paneli (`logislot-dev`) | LogiSlot tenant'i icin Hermes hedef ekibini secer |

Platform Console AYRI audience + AYRI cerezdir; tenant oturumu orada
gecerli DEGILDIR (ve tersi).

## 6d. LogiSlot prod <-> hermes-test baglantisi (2026-08-27 — KURULDU)

Baglanti canli olarak kuruldu ve **iki yonu de gercek trafikle
dogrulandi**. Asagidaki her satir olculdu.

### Kurulum

| | Deger |
|---|---|
| LogiSlot imaj | `logislot-api:prod-315b991` (ticketing kodu iceride) |
| Base URL | `https://hermes.duosis.com/api/integrations/v1` |
| Integration client | `logislot-prod-tickets` `8efe5764-eb20-46cf-9c01-66e7c004005f` |
| Callback | `https://api.logislot.io/integrations/hermes-support/v1/events` |
| Webhook key id | `v1` (imza sirri uygulama basina, client'tan BAGIMSIZ) |
| Source tenant | `BTA Cakes&Bakes` / `bta-cakes-bakes` / `deb014a0-...a53d79` |
| Route | v1 -> **ArGe Team** (`6d90126e-...c8a1a`), aktif |

`api.logislot.io` Cloudflare arkasinda yayinda; LogiSlot prod ingress'i
`nginx` class'ina alinmis durumda (`nginx-test` NodePort'a kilitli
olurdu). Callback `validate_callback_url` SSRF/sema kapisindan gecirilerek
kaydedildi ve denetime yazildi.

### Uctan uca kanit

```
CEKME  (logislot-prod pod -> hermes-test, gercek httpx istemcisi)
  GET  /support/routing-groups            -> 200  (ArGe Team, IGA Team)
  POST /support/routes/validate           -> 200  valid=true, route_version=1
  POST /support/tickets                   -> 201  TKT-000001, group=ArGe Team
  POST /support/tickets/{id}/cancel       -> 200  status=cancelled, v2

ITME   (hermes-test -> https://api.logislot.io, HMAC imzali)
  ticket.created.v1        delivered  HTTP 200  1. denemede  (836 ms)
  ticket.status_changed.v1 delivered  HTTP 200  1. denemede
  LogiSlot ticket_webhook_inbox: iki olay da `processed`
  imzasiz POST                        -> 401 invalid_signature
```

`TKT-000001` bilerek acilmis bir baglanti testidir ve **iptal edildi**;
canonical kayit tasarim geregi silinmez.

### Cloudflare notu (yanlis teshise girmemek icin)

Teshis sirasinda `Python-urllib` User-Agent'i ile yapilan cagri
Cloudflare'den **403 / error code 1010** aldi. Bu bir yetki hatasi
DEGILDIR ve entegrasyonu etkilemez: gercek istemci (`httpx`) ayni
pod'dan 200 alir. `hermes.duosis.com` Cloudflare bot korumasi altindadir
ve yalnizca o UA imzasi engellenir.

### Hala LogiSlot panelinde yapilacak (Hermes tarafi hazir)

`ticket_routing_configs` ve `hermes_group_catalog_cache` **bos**. Yani
LogiSlot'un platform panelinden (`admin.logislot.io`) BTA Cakes&Bakes
icin saglayici + ekip secimi henuz kaydedilmedi. Base URL artik dolu
oldugu icin o ekran Hermes ekip listesini gorecektir; secim yapilinca
tenant'lar ticket acabilir. Hermes tarafinda ek bir islem GEREKMEZ.

### Bakim tuzaklari

1. **ConfigMap her deploy'da sifirlanir.** LogiSlot'un kustomize'i
   `k8s/base/configmap.yaml`'i yonetir; her deploy
   `LOGISLOT_HERMES_SUPPORT_BASE_URL`'i tekrar `""` yapar ve baglantiyi
   KAPATIR. Deploy sonrasi:

   ```bash
   bash scripts/k8s/logislot-hermes-wire.sh   # sunucuda /root/ altinda da var
   ```

   Kalici cozum LogiSlot repo'sunda `k8s/overlays/prod/
   configmap-patch.yaml` icine BASE_URL + CLIENT_ID satirlarini commit
   etmektir (bu oturumda o repo DEGISTIRILMEDI).

   Secret ayni sorunu tasimaz: kustomize Secret'i yonetmez, token ve
   imza sirri deploy'lardan etkilenmez.

2. **base_url `/v1`'DE BITER.** LogiSlot'un sabitleri `/support/...`
   seklindedir; sonuna `/support` eklemek `/v1/support/support/...`
   uretir ve 404 verir (dev'de tam olarak bu yasandi).

3. **Token rotasyonu client'i da degistirebilir.** 27 Agu'da
   `logislot-platform` client'inin iki token'i iptal edilip yeni
   `logislot-prod-tickets` client'i acildi; CLIENT_ID degismedigi surece
   yalnizca token yenilemek YETMEZ — ikisi birlikte guncellenir.
   Rotasyon adimlari: hermes-test `secret/logislot-hermes-credential`
   (kayit defteri) + `logislot-prod/logislot-secrets` +
   `logislot-config`'teki CLIENT_ID + `rollout restart`.

### Bilincli kalan riskler

- `logislot-prod-tickets` client'i `support:attachments:write` scope'u
  tasiyor ama attachment ozelligi hem hermes-test'te hem LogiSlot'ta
  KAPALI. Ozellik acilana kadar bu scope hicbir sey vermez; yine de en
  az ayricalik acisindan kaldirilmasi tercih edilir.
- `logislot-dev` hala `hermes-dev`'e bakiyor; teste/prod'a baglanmadi.


## 7. Bilinen sinirlamalar

1. **Attachment uretim-hazir degil**: object storage ve ClamAV
   yapilandirilana kadar ozellik kapalidir (`TICKET_ATTACHMENTS_ENABLED=false`).
   Ticket metin akisi bundan bagimsiz calisir.
2. **E-posta bildirimi yok**: v1 minimumu kaynak uygulama ici
   bildirimdir; Hermes portali icin e-posta backlog'dadir.
3. **Rate limiter in-memory**: tek pod dogru; yatay olceklemede Redis.
4. **`hermes-test` manifestleri eklenmedi**: test ortamina terfi ayri
   bir karardir (canli manifest drift'i nedeniyle once `kubectl diff`).
5. **LogiSlot uctan uca dogrulanmadi**: karsi repo hazir olmadigi icin
   provider tarafi contract fixture/mock ile dogrulandi.
