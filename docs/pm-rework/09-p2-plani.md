# P2 planı — nesneye tutunanlar (B2, C1–C3, F1) · CTO onaylı (22.09: P2-1 outbox yok · P2-2 iki anahtar · P2-4 `work_item_id` arc'a · P2-7 dev'e MinIO/ClamAV; P2-3/5/6 varsayılan öneriyle)

Girdi: 05 §B2/§C/§F, 03 §3–4, 06 karar 5 (ek dosya polimorfik), P1'de kurulan `work_items` / `work_item_events` / `project_memberships`. P1 gibi: her adım ayrı dev commit'i, CTO dev'de test eder, ff toplu.

## 0. P2'nin tanımı ve bitti sayılma ölçütleri (05'ten)

| Kod | Kabul ölçütü |
|---|---|
| B2 | Proje lideri kendi ekibini yönetir, kiracı ayarına girmeden |
| C1 | Her değişiklik sıralı olay üretir |
| C2 | Rozet sayfa açılışında ve odak dönüşünde güncellenir; tıklayınca kayda gidilir |
| C3 | Yönetici bir olayı e-postada kapatıp uygulama içinde açık bırakabilir |
| F1 | Dosya eklenir, taranır, yetkisiz indiremez |

Kapsam DIŞI (05 aynen): proje bazlı workflow, olay replay arayüzü, WebSocket, kullanıcı başına bildirim tercihi, önizleme/sürükle-bırak/sürüm geçmişi.

## 1. Bugünkü durum (P1 sonrası gerçekler)

- **C1 büyük ölçüde hazır:** `work_item_events` `sequence` ile yazılıyor (15 olay tipi: created/updated/completed/rejected/restored/archived/deleted, comment_*, link_*, watcher_*, log_time_created). Eksik olan yalnız "giden kutusu".
- Bildirim: yalnız e-posta (`task_notifications.py` → Graph), kural tablosu `task_notification_settings` (tip başına tek satır: enabled, notify_assignment/accept/complete, priorities, due_date_rule). Uygulama içi bildirim YOK.
- Üyelik: `project_memberships` var (0010 backfill: `member`), API yalnız `projects.manage` ile; UI YOK; `lead` rolü DB/API ile veriliyor.
- Ek dosya: ticket tarafında tam yaşam döngüsü (`ticket_attachments` exclusive-arc ticket/message/resolution, karantina → sniff → ClamAV → temiz önek → indirme izni). hermes-dev'de ek dosya KAPALI (MinIO/ClamAV yok), hermes-test'te açık.

## 2. Önerilen seçimler (onay istenen)

| # | Konu | Öneri | Alternatif | Neden |
|---|---|---|---|---|
| P2-1 | **C1 giden kutusu** | **P2'de outbox YOK.** Uygulama içi bildirim, olayla AYNI transaction'da doğrudan yazılır (fan-out yazma anında). Outbox, iş kalemi webhook'u istendiğinde (dış tüketici) eklenir | 03 §4 diyagramındaki gibi outbox + dispatcher | Tek tüketici (uygulama içi) için kuyruk/dispatcher altyapısı gereksiz; e-posta zaten BackgroundTask ile gidiyor. YAGNI — 05 kapsamı "her değişiklik sıralı olay üretir"i zaten karşılıyor |
| P2-2 | **C3 kanal modeli** | `task_notification_settings`'e iki sütun: `email_enabled` (varsayılan true), `in_app_enabled` (varsayılan true). Mevcut olay/öncelik/termin kuralları her iki kanal için ortak | 03'teki gibi `channel` sütunu + kanal başına satır (unique bozulur, admin UI 2×) | Tip başına tek satır ve mevcut Mail Notifications sekmesi korunur; "e-postada kapat, uygulamada açık bırak" iki anahtarla sağlanır |
| P2-3 | **C2 alıcı kümesi** | Olayın aktörü hariç: atananlar + takipçiler + reporter + owner. Olay tipleri: task_created (atananlar), task_updated (atanan değişimi), task_completed/rejected/restored, comment_added, watcher_added (eklenen kişi), log_time_created (reporter) | Proje üyelerinin tamamı | Üye herkese bildirim gürültü üretir; ilgili kişi = katılımcı |
| P2-4 | **F1 sahiplik** | `ticket_attachments` **yerinde genelleşir**: exclusive-arc'a `work_item_id` (FK work_items) eklenir; tablo adı ve ticket akışı değişmez; indirme izni aynı tablo, yetki sahip tipine göre (iş kalemi → `can_view`) | 03 §3: tabloyu `attachments` + `owner_type/owner_id` olarak yeniden adlandırmak | Yeniden adlandırma ticket sözleşmesini/CronJob'u/LogiSlot indirme akışını riske sokar; arc'a bir kolon eklemek additive ve geri alınabilir. Karar 5 (polimorfik sahiplik) kolon düzeyinde sağlanır; ileride `owner_type` görünümü türetilebilir |
| P2-5 | **B2 yetki** | Proje lead'i kendi projesinin üyelerini yönetir (`member/viewer` ekler-çıkarır); `lead` verme/alma yalnız `projects.manage` | Lead her rolü verir | Lead'in kendine eş yetki dağıtması "son-admin" sorununu proje ölçeğinde doğurur |
| P2-6 | **B2 yer** | Ayarlar › Müşteri ve projeler › proje satırında "Üyeler" (drawer) — mevcut `/settings` kabuğu (B1) | Ayrı `/projects/{id}/settings` sayfası | Kabuk ve izin kataloğu hazır; yeni rota/izin gerekmez; lead için aynı drawer proje listesinden açılır |
| P2-7 | **F1 dev ortamı** | hermes-dev'de MinIO + ClamAV manifestleri (test'tekilerin kopyası) — CTO'nun dev testi için şart | Dev'de yalnız `local` depo + tarayıcısız mod | Tarayıcısız mod `live`'da kapalı; dev'i test ile aynı yolda doğrulamak daha dürüst |

## 3. Şema (tek migration, `0012_p2_notifications_attachments`, additive)

- `work_item_notifications`: `id`, `tenant_id`, `user_id`, `work_item_id`, `event_id` (FK work_item_events), `kind` (olay tipi), `read_at NULL`, `created_at`; index `(tenant_id, user_id, read_at)`; RLS+FORCE (0007–0011 deseni). Tutma: okunmuş kayıtlar 90 gün sonra CronJob ile silinir (api_cleanup'a **eklenmez** — donmuş katalog; ayrı job).
- `task_notification_settings` + `email_enabled boolean NOT NULL DEFAULT true`, `in_app_enabled boolean NOT NULL DEFAULT true`.
- `ticket_attachments` + `work_item_id uuid NULL` (FK, RESTRICT); arc CHECK güncellenir (ticket/message/resolution/work_item'dan tam biri); `ticket_download_grants` değişmez.
- `project_memberships.member_role` CHECK (`lead|member|viewer`) — mevcut 30 satır `member` (0010), uyumlu.

## 4. Adımlar

| Adım | İçerik | Kabul |
|---|---|---|
| **P2.1** B2 üyelik | Üyelik uçları lead'e açılır (`/projects/{id}/members` GET/POST/PATCH/DELETE; yetki: projects.manage ∨ o projenin lead'i); Ayarlar › projeler › "Üyeler" drawer'ı (kullanıcı ara, rol seç, çıkar); B3 lead kuralı bu UI ile yönetilebilir olur | Lead kendi ekibini yönetir; lead rolünü yalnız admin verir; üye olmayan proje işini görmez (A3 testleri) |
| **P2.2** C3 + C2 | Kural tablosu iki kanal sütunu + admin sekmesinde iki anahtar; `notification_allowed(channel=)`; olay yazımında (`record_event`) alıcı fan-out'u → `work_item_notifications`; uçlar `GET /notifications` (sayfalı, `unread`), `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`; kabuk başlığında zil + rozet + liste; tıklayınca `/project-management/tasks?item=<id>`; rozet mount + pencere odağında tazelenir (react-query `refetchOnWindowFocus`) | C2/C3 ölçütleri; e-posta davranışı değişmez (kapatılmadıkça) |
| **P2.3** F1 ek dosya | Arc'a `work_item_id`; `ticket_attachment_service` sahip tipine göre yetki; uçlar `POST /tasks/{id}/attachments` (oturum) + mevcut içerik yükleme + `GET /tasks/{id}/attachments` + indirme (izin + stream); panelde "Ekler" sekmesi (liste + yükle + indir); hermes-dev'e MinIO/ClamAV manifestleri (manuel kubectl, `kubectl diff` sonrası) | Dosya eklenir, taranır (`clean` olmadan bağlanmaz), görmeyen indiremez (404) |
| **P2.4** C1 kapanış | Olay kataloğu dokümante edilir (tip → alıcı → kanal); outbox ertelendi notu; eski `task_activity_events` F05'e kadar durur | Her değişiklik sıralı olay üretir (test: sequence boşluksuz) |

## 5. Riskler
- Bildirim gürültüsü: alıcı kümesi katılımcıyla sınırlı, aktör hariç; okunmuşlar 90 günde temizlenir.
- Ek dosya arc değişikliği: ticket testleri (parite + sızıntı) aynen geçmeli; iş kalemi ekleri hub/portal serializer'larına ASLA girmez (sızıntı testi eklenir).
- Dev'de MinIO/ClamAV kurulumu manifest işidir (CD değil) — CTO Termius'tan uygular, komutları ben veririm.

## 6. P2.3 runbook — hermes-dev'de ek dosya (CTO Termius'tan uygular)

Kod tarafı `TICKET_ATTACHMENTS_ENABLED=false` iken de çalışır (uçlar 503 "not configured"); özelliği açmak için sırayla:

```bash
# 0) repo dev dalı sunucuda güncel (k8s/10-minio.yaml, k8s/11-clamav.yaml, k8s/notification-cleanup-cronjob.yaml)
# 1) secret'lar (bir kez; degerleri KENDINIZ uretin — repo/log/rapora GIRMEZ)
kubectl -n hermes-dev create secret generic hermes-minio-root \
  --from-literal=MINIO_ROOT_USER=<user> --from-literal=MINIO_ROOT_PASSWORD=<pass> \
  --from-literal=MINIO_KMS_SECRET_KEY="hermes-dev-key:$(openssl rand -base64 32)"
kubectl -n hermes-dev create secret generic hermes-ticket-storage \
  --from-literal=TICKET_S3_ACCESS_KEY_ID=<user> --from-literal=TICKET_S3_SECRET_ACCESS_KEY=<pass>
# 2) MinIO + ClamAV (once diff, sonra apply)
kubectl diff -f k8s/10-minio.yaml; kubectl apply -f k8s/10-minio.yaml
kubectl diff -f k8s/11-clamav.yaml; kubectl apply -f k8s/11-clamav.yaml
kubectl -n hermes-dev rollout status deploy/minio; kubectl -n hermes-dev rollout status deploy/clamav   # clamav ilk imza indirmesi dakikalar surer
# 3) bucket (MinIO pod'undan mc ile ya da python/awscli; test'te nasil yapildiysa ayni)
# 4) ConfigMap anahtarlari (patch — dosya apply edilmez)
kubectl -n hermes-dev patch cm hermes-config --type merge -p '{"data":{"TICKET_ATTACHMENTS_ENABLED":"true","TICKET_STORAGE_BACKEND":"s3","TICKET_S3_ENDPOINT_URL":"http://minio.hermes-dev.svc:9000","TICKET_S3_BUCKET":"hermes-attachments","TICKET_SCANNER_MODE":"clamav","TICKET_SCANNER_HOST":"clamav.hermes-dev.svc"}}'
kubectl -n hermes-dev rollout restart deploy/core-service && kubectl -n hermes-dev rollout status deploy/core-service
# 5) dogrulama: /ready 200 (yapilandirma eksikse pod trafige alinmaz), bir is kalemine PNG yukleyip indirin
# 6) bildirim temizligi
kubectl diff -f k8s/notification-cleanup-cronjob.yaml; kubectl apply -f k8s/notification-cleanup-cronjob.yaml
```

Not: `TICKET_SCANNER_MODE=disabled_dev_only` dev'de kabul edilir ama CTO kararı (P2-7) tarama akışını dev'de de görmek; ClamAV hazır olana kadar geçici olarak bu modla açılabilir.
