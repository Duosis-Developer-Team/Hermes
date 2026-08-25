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
