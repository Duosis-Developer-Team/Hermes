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

## 6d. LogiSlot baglantisi — hermes-test devir durumu

Son olcum: **2026-08-27**. Her satir canli olculdu, varsayilmadi.

### HAZIR — Hermes tarafi (hermes-test)

| Ogul | Durum |
|---|---|
| `logislot` application | `environment=live`, `webhook_key_id=v1`, **callback BOS** (bilerek) |
| Integration client | `logislot-platform`, `8951d21f-55fa-4224-8efe-b46cd19c2918` |
| Scope'lar | `support:groups:read`, `support:tickets:read`, `support:tickets:write` (attachment YOK) |
| Token | `hsi_live_s86...`, revoked=false |
| Yonlendirilebilir gruplar | `ArGe Team` (6 uye), `IGA Team` (5 uye) |
| source tenant / route | **0 / 0** — henuz tanimlanmadi |
| canonical ticket | 0 |

Disaridan HTTPS ile dogrulandi (`https://hermes.duosis.com/api/integrations/v1`):

```
GET  /support/routing-groups                  -> 200  (ArGe Team, IGA Team)
POST /support/routes/validate  (tanimsiz tenant) -> 200  reason=source_tenant_unknown
POST /support/attachments/sessions            -> 403  (scope disi, dogru)
```

### HAZIR — LogiSlot tarafi (kalici olan kisim)

`logislot-prod/logislot-secrets` icine **yerlestirildi** (2026-08-27):

```
LOGISLOT_HERMES_SUPPORT_TOKEN            (52 bayt)
LOGISLOT_HERMES_SUPPORT_WEBHOOK_SECRET   (40 bayt)
```

Bu kalicidir: LogiSlot'un kustomize'i Secret'i YONETMEZ (`k8s/base/
kustomization.yaml` resources listesinde secret yok; repo'daki dosya
`secret.example.yaml`). ConfigMap ise YONETILIR — yani her deploy
`LOGISLOT_HERMES_SUPPORT_BASE_URL`'i tekrar `""` yapar.

### BLOKER 1 — logislot-prod hala ticketing ONCESI imajda

Olculen: image `prod-2dfafea` (13 Agu), `app/integrations/` klasoru YOK,
0 hermes ayari, `POST /integrations/hermes-support/v1/events` -> 404.

Kod prod DALINDA var (`43a1f67`). Takildigi yer GitHub Actions:
`Build Images` run `33070215551` -> job `deploy / deploy` **`production`
ortaminin required_reviewers kapisinda ONAY BEKLIYOR** (reviewer:
`coskungencay`). Ikinci run (`33070790285`, asama 2 / `api.logislot.com`
ile derlenmis web imaji) concurrency grubunda onun arkasinda kuyrukta.

LogiSlot'un kendi notu (`overlays/prod/configmap-patch.yaml`): asama 2
YALNIZCA DNS cozulmeye basladiktan sonra onaylanmalidir — erken onay prod
web'i cozulmeyen bir API adresine baglar.

Deploy indikten sonra baglantinin tamami tek komut:

```bash
bash /root/logislot-hermes-wire.sh     # sunucuda hazir, idempotent
```

Betik once ticketing kodunun varligini KAPI olarak dogrular ve yoksa
hicbir sey degistirmeden durur; sonra secret + configmap yamasi, restart
ve pod ICINDEN hermes-test cagrisi ile dogrulama yapar.

**Kalici duzeltme (LogiSlot repo'sunda, bu oturumda DEGISTIRILMEDI):**
`k8s/overlays/prod/configmap-patch.yaml` icinde

```yaml
LOGISLOT_HERMES_SUPPORT_BASE_URL: "https://hermes.duosis.com/api/integrations/v1"
LOGISLOT_HERMES_SUPPORT_CLIENT_ID: "8951d21f-55fa-4224-8efe-b46cd19c2918"
```

Bu satirlar commit edilmedigi surece her deploy baglantiyi kapatir ve
betigin tekrar calistirilmasi gerekir.

**TUZAK — base_url `/v1`'DE BITER.** LogiSlot'un sozlesme sabitleri
`/support/routing-groups` seklindedir; sonuna `/support` eklemek
`/v1/support/support/...` uretip 404 verir (dev'de tam olarak bu yasandi).

### BLOKER 2 — webhook icin `api.logislot.com` henuz cozulmuyor

`dig api.logislot.com` -> **bos**. `logislot.com` yalnizca registrar park
IP'lerine cozuluyor. hermes-test'te `TICKET_WEBHOOK_ALLOW_INSECURE_HTTP=
false` ve oyle KALIR; callback kayit ANINDA dogrulanir, yani cozulmeyen
bir adres sessizce degil aninda reddedilir.

Hedef uc (LogiSlot'un router prefix'i ile birebir):

```
https://api.logislot.com/integrations/hermes-support/v1/events
```

Kume giris noktalari (olculdu):

| Class | Nasil erisiliyor |
|---|---|
| `nginx` | node2 = 84.247.180.173 uzerinde **hostNetwork**, gercek :80/:443 |
| `nginx-test` | yalnizca **NodePort** 30880 (http) / 30443 (https) — 443'e baglanmaz |

`hermes.duosis.com` Cloudflare arkasindadir ve origin olarak node2:443
dogru cevabi verir (Host basligiyla zorlanip `/api/integrations/...`
tokensiz 401 alinarak dogrulandi). LogiSlot prod ingress'i
`ingressClassName: nginx-test` secmis durumda — bu class 443'e baglanmaz,
dolayisiyla duz bir A kaydi TEK BASINA yetmez: ya `hermes.duosis.com` ile
ayni Cloudflare + origin-port kalibi kurulmali, ya da ingress `nginx`
class'ina alinip A kaydi 84.247.180.173'e verilmelidir. Karar LogiSlot
tarafinindir; Hermes yalnizca calisan bir HTTPS adresi bekler.

Callback tanimlanana kadar outbox satiri HIC yazilmaz (dead-letter
birikmez) — yani bu bloker "cekme" yonunu ENGELLEMEZ, sadece Hermes'ten
LogiSlot'a anlik olay itmeyi erteler.

Adres hazir oldugunda:

```
POST /tickets/admin/applications/{application_id}   (tickets.config.manage)
```

### BLOKER 3 — source tenant + route karari

`POST /support/tickets` tasarim geregi **var olan** bir source tenant ve
**aktif** bir route ister (`require_source_tenant` + `resolve_route`);
kaynak uygulama kendi kendine bir Duosis ekibi secemez (04 §4). Yani
LogiSlot'un her prod tenant'i icin Duosis tarafinda tanimlanmasi gereken:

1. `POST /tickets/admin/source-tenants` — LogiSlot'un tenant **UUID**'si
   (`source_tenant_id`), gorunen ad, slug.
2. `PUT  /tickets/admin/source-tenants/{id}/route` — hedef grup
   (`ArGe Team` `6d90126e-7c1a-4a7a-9cde-32869b8c4a1a` veya
   `IGA Team` `0db88074-0ca2-4f51-8135-bc9ca3170ad8`).

Ikisi de Hermes UI'daki **Ticket Integrations** ekranindan yapilabilir.
Hangi tenant'in acilacagi ve hangi ekibe gidecegi is kararidir —
tahmin edilmez, cunku yanlis eslesme ticket'i sessizce yanlis kuyruga
yazar. Repo'dan cikarilabilen tek aday: **CakesAndBakes** (`cknb`
subdomain'leri). UUID'si LogiSlot tarafindan alinmalidir.

**BILINCLI KARAR (2026-08-27):** `logislot-dev` -> `hermes-test`
baglanmadi. Dev bir sistemin CANLI destek workspace'ine gercek ticket
yazmasi istenmedi.


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
