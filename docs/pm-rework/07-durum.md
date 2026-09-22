# Hermes PM Rework — Durum (22.09.2026)

Can'ın 05-gelistirme-kapsami.md'de listelediği **31 kalem** ile yapılanların karşılaştırması.
Kararlar ve kod doğrulaması ayrıntısı: `06-inceleme-ve-kararlar.md`.

**Özet:** **P0 tamam** (D1 sapmayla, D2, G1, B1) · **P1 tamam** (A1–A4, A6–A10, B3–B5) · **P2 tamam (kod)** (B2, C1–C3, F1 dev'de; F1 için dev'de MinIO/ClamAV kurulumu manuel) — 21 kalem dev'de · 11 başlamadı (A5 F05'e ertelendi · P3 10; tablo 32 satır = Can'ın 31'i + A10). Sıradaki: CTO'nun dev testi + 09 §6 runbook → toplu ff; P3 para katmanı sonrası.
Kararlar: 7'nin 7'si + 2 yeni karar kapatıldı (batch → `participant.completed_at`; A10 efor↔iş kalemi). Açık karar yok.

## 1. Can'ın istediği tüm geliştirmeler (05'teki liste)

| Kod | İş | Faz | Durum | Not |
|---|---|---|---|---|
| A1 | İş kalemi nesnesi + katılımcılar | P1 | **Yapıldı (P1.1 + P1.2)** | `work_items` + `work_item_participants` (kişi başı `completed_at`); Alembic 0010 + 0011 cutover; tüm internal/public uçlar iş kaleminden okur/yazar (`work_item_service`); frontend katılımcı bazlı |
| A2 | Konfigüre edilebilir durum akışı | P1 | **Yapıldı (temel)** | `workflow_states` tohumu (Pending/todo · In Progress · Completed/done · Cancelled · **Rejected/cancelled**); `GET /tasks/states`; `PATCH /status` `state_id` kabul eder; pano sütunları durumlardan (`useWorkflowStates`, geri düşüş eski 3). Yönetim ekranı (durum ekle/sırala) P2 |
| A3 | Görünürlük proje üyeliğine | P1 | **Yapıldı** | Görünürlük = admin ∨ proje üyesi ∨ reporter ∨ owner ∨ katılımcı (`visible_filter`/`can_view`); üyelik 0010'da backfill edildi (`member`). Üye olmayan → 404. Rol standardı `lead|member|viewer` |
| A4 | Yönlendirme politikasının ayrılması | P1 | **Yapıldı** | `can_assign_to*`, atanabilir listeleri ve admin uçları (`/admin/task-assignment-*`) artık `routing_relations`tan; eski `task_assignment_*` tabloları okunmuyor (F05'e kadar durur). Yönlendirme görünürlük VERMEZ (testle kilitli) |
| A5 | `issues` birleştirme | P1 | Başlamadı (F05'e ertelendi) | `issues` 0 kayıt → veri taşımasız; CRUD router'ının emekliliği 08 §6'da yok, eski tabloların düşürüldüğü F05 ile birlikte |
| A6 | Talep → iş bağı | P1 | **Yapıldı** | `POST/GET /tickets/{id}/work-items` (hub, `tickets.respond` + `tasks.access`); iş `origin_type='ticket'`; ticket detayında `work_items[]`; hub'da "İş kalemi aç" modalı + liste, iş detayında "Kaynak: Ticket" bağı (`/tickets?ticket=`). Ticket olay kümesine dokunulmadı (sözleşme donmuş); SLA/otomatik dönüşüm yok |
| A7 | Hiyerarşi ve ilişkiler | P1 | **Yapıldı** | `parent_id` iki seviye + aynı proje (servis kuralı), `parent_key`/`subtask_count`/`subtask_done_count` rollup, `GET /tasks/{id}/children`; bağlar `relates|duplicates|blocks` (`/tasks/{id}/links`), `blocks` hiçbir tarih/durum değiştirmez (test), döngü reddi. UI: detay panelinde üst iş/alt iş sayısı; bağ UI P3 |
| A8 | Faturalanabilirlik iş kaleminde | P1 | **Yapıldı** | `projects.is_billable_default` (API + proje formu anahtarı) → iş kalemi `is_billable` (oluşturmada miras, düzenlemede çekirdek yetkiyle override; `billable_override_by/at` izlenir) → efor kaydı bağlı işten miras (açık değer kazanır). Detay panelinde "Faturalanabilir" satırı |
| A9 | `/v1` ve MCP uyumluluk | P1 | **Yapıldı** | `/v1` şekli değişmedi (`work_item_compat.to_public_task`); `task_code` = `item_key` ∨ alias; eski `tasks.id`, katılımcı id ve iş kalemi id'si aynı uçlarda çözülür (`resolve_ref`); 335 public API testi yeşil. **MCP istemci matrisi yeniden koşulmadı** (gerçek istemci gerekir) — CTO dev testinde; matris dokunulmadı |
| A10 | Efor girişinde iş kalemi seçimi (**yeni**, CTO 22.09) | P1 | **Yapıldı** | LogTimeModal: serbest girişte proje seçilince "İş kalemi (isteğe bağlı)" — kullanıcının o projede gördüğü açık işler; seçim `task_id` → `work_logs.work_item_id` + `log_time_created` olayı. Görevden/toplantıdan açılan akışta seçici yok |
| B1 | Ayarların tek çatı altına alınması | P0 | **Yapıldı** | Tek `/settings`, beş bölüm, bölüm başına izin; menüde tek "Ayarlar" (Yönetim grubunda, prototipteki yerleşim); eski adresler yönlendirilir; yeni izin kodu yok |
| B2 | Proje ayarları sayfası | P2 | **Yapıldı (P2.1)** | `/projects/{id}/members` GET/POST/PATCH/DELETE — `projects.manage` her şey; proje **lead**'i kendi ekibini yönetir (member/viewer), lead veremez/alamaz. UI: Ayarlar › Projeler › "Üyeler" drawer'ı (admin) + Explorer'da proje seçilince "Üyeler" (lead; yetki sunucudan `can_manage`). Proje bazlı workflow kapsam dışı |
| B3 | Düzenleme yetkisi kuralları | P1 | **Yapıldı** | Çekirdek (proje/atanan/tür/fatura/silme): admin ∨ reporter ∨ proje **lead**'i; sahip (owner) yalnız başlık/açıklama/tarihler/öncelik/tahmin (`OWNER_EDITABLE_FIELDS`) |
| B4 | Kendine iş açma | P1 | **Yapıldı** | Yalnız kendine atama → erişim yeter (`require_create_authority`, `_validate_assignment_wi`); `permissions/me` `can_self_assign` + kendisi listede; UI: "My Tasks"ta Create, seçici kendisini listeler. Yönlendirmede `assigner==assignee` kısıtı kalktı |
| B5 | Takipçi | P1 | **Yapıldı** | `participants.role='watcher'`: `POST/DELETE /tasks/{id}/watchers` (kendini: görünürlük yeter; başkasını: çekirdek yetki); görür, düzenleyemez; ilk kabul/tamamlama e-postası takipçilere de gider. UI: detay panelinde zil + "Takipçiler" satırı |
| C1 | İş kalemi olay akışı | P2 | **Yapıldı (P1 + P2.2)** | `work_item_events` `sequence` ile 15 olay tipi (P1); bildirim olayla aynı transaction'da (P2.2). Giden kutusu (outbox) **ertelendi** — 09 P2-1 CTO kararı: tek tüketici için gereksiz, iş kalemi webhook'u istendiğinde eklenir |
| C2 | Uygulama içi bildirim | P2 | **Yapıldı (P2.2)** | `work_item_notifications` (0012, RLS); alıcı = aktör hariç katılımcı/reporter/owner (09 P2-3); `GET /notifications`, `/unread-count`, `POST /{id}/read`, `/read-all`; kabukta zil + rozet + liste, tıklayınca işe gider; rozet mount + pencere odağında tazelenir. WebSocket yok (kapsam dışı). Okunmuşlar 90 gün sonra `notification_cleanup` job'ı ile silinir (manifest `k8s/notification-cleanup-cronjob.yaml`, manuel apply) |
| C3 | Kanal ayrımı | P2 | **Yapıldı (P2.2)** | `task_notification_settings.email_enabled` + `in_app_enabled` (09 P2-2); `notification_allowed(channel=)`; PM ayarlarında "Kanallar" çipleri. E-postada kapalı, uygulamada açık mümkün (test) |
| D1 | Kapasite ayarları | P0 | **Yapıldı · sapma** | `plan_times.plan_type` yerine `user_absences` (gerekçe §3) |
| D2 | Efor şeridi + eksik gün dürtmesi | P0 | **Yapıldı** | Kurallar 04 §4.1/§7 birebir |
| D3 | İşlerim blokları | P3 | Başlamadı | Ana sayfa yok; `owner` + `state.category` ister (A1, A2) |
| D4 | Haftam bloğu | P3 | Başlamadı | |
| D5 | Ekibim + dikkat bloğu | P3 | Başlamadı | |
| D6 | Organizasyon özeti | P3 | Başlamadı | |
| E1 | Üç eksen | P3 | Başlamadı | |
| E2 | Kayıtlı görünümler | P3 | Başlamadı | |
| E3 | Triage kuyruğu | P3 | Başlamadı | |
| E4 | Görsel dil | P3 | Başlamadı | |
| E5 | Takvim yerleşimi | P3 | Başlamadı | |
| E6 | Derin link `/work/KEY` | P3 | Başlamadı | `?item=<uuid>` tek seferlik link zaten var; kalıcı adres yok |
| F1 | İş kalemine dosya ekleme | P2 | **Yapıldı (P2.3, kod)** | `ticket_attachments.work_item_id` (0013; arc: ticket/mesaj/çözüm/iş kalemi); ticket ek altyapısı aynen (oturum → karantina → sniff → ClamAV → temiz → yetkili stream); `/tasks/{id}/attachments` uçları; temiz dosya anında bağlanır, `rejected` bağlanmaz/indirilemez; iş kalemi eki hub/portal'a giremez (test). UI: detay panelinde "Ekler" sekmesi (ticket dropzone'u). **hermes-dev'de MinIO/ClamAV kurulumu manuel (09 §6 runbook) — kurulana kadar uçlar 503 "not configured"** |
| G1 | Durum kullanım ölçümü | P0 | **Yapıldı** | 182 iş: completed 109 · pending 51 · rejected 14 · in_progress 8; pending medyan 0,3 gün, çalışma 6,8 gün; 27 iş in_progress'i atlamış |

Prototip (`prototip.html`): P3 arayüzünün taslağı; olduğu gibi uygulanmadı, fikirleri D3–D6 ve E1–E6'ya eşleniyor.

## 2. Yapılanlar

**Kod (commit `8e2a689`, hermes-dev'de canlı):**
- **D1** — 4 yeni tablo (Alembic 0009, additive): `tenant_capacity_settings` (günlük saat + çalışma günleri, tenant başına tek), `tenant_holidays`, `user_capacity_overrides` (yalnız dolu alan ezer), `user_absences`. Sayfa: Yapılandırma › **Kapasite** (`/capacity`, `users.manage`). Satır yoksa 8h/Pzt–Cum tek kapıda.
- **D2** — Efor sayfasında hafta hedefi kapasiteden ("/ 32h", dolum yüzdesi), boş günler tek satırda sarı; gün kutusunda sarı işaret + "Log time / Mark leave"; tatil/izin etiketi. Bugün asla eksik değil; modal/toast yok. Work log değişince şerit tazelenir.
- **G1** — Ölçüldü (yukarıda). Ayrıca: çoklu atama batch dağılımı (72 batch, 25 çok kişili, 7 karışık statülü), alt-proje kullanımı, efor↔iş bağı, `project_key` doluluğu.
- **B1** — Tek `/settings` kabuğu (`pages/settings/SettingsPage.jsx`): solda beş bölüm, sağda seçili sayfa (Outlet). Katalog tek kaynak (`features/settings/sections.js`): bölüm → sayfa → yol → izin; kenar çubuğu, kabuk menüsü, rota koruyucuları ve eski adres yönlendirmeleri hep oradan okur. Bölümler 03 §6 birebir: Organizasyon (kullanıcılar/roller/gruplar + kapasite) · İş yönetimi (PM ayarları) · Referans verileri (iş tipi, aktivite, platform, iş hattı) · Müşteri ve projeler · Entegrasyonlar (API, ticket). İzni olmayan bölüm görünmez; `/settings` ilk görünür sayfaya gider; izinler yüklenmemişken beklenir. Kenar çubuğunda "YAPILANDIRMA" grubu ve üç dağınık ayar öğesi kalktı; Yönetim grubunda tek "Ayarlar". 12 eski adres (`/users`, `/pm-configurations`, `/api-management`, …) yeni yola yönlendirilir. Sayfa içerikleri değişmedi (kapsam dışı).
- Testler: core +20, frontend +24 (B1: katalog süzme, index yönlendirme, kabuk; menü/prefetch testleri yeni sözleşmeye güncellendi). CI yeşil. Dev'de doğrulandı: `alembic_version=0009`, 4 tablo RLS+FORCE, grant'lar, uçlar, bundle.

**Doküman:**
- `06-inceleme-ve-kararlar.md` — kapatılan kararlar, veri bulguları, kod doğrulaması.
- Bu dosya.

**Kararlar (CTO, 22.09):** 1 tek owner ✓ · 2 alt-proje ağaçta ✓ (dokümanın tersi) · 3 proje varsayılanı → iş kalemi → efor override ✓ · 4 A/B bölmesi ✓ · 5 ek dosya polimorfik ✓ · 6 iki seviye servis katmanında ✓ · 7 ayarlar P0 içinde ✓ · **yeni:** batch → `participant.completed_at` ✓ · **yeni:** A10 efor↔iş kalemi seçimi (isteğe bağlı) ✓. Açık karar yok.

## 3. Nasıl düzeltildi / sapmalar

| Konu | Dokümanda | Yapılan | Neden |
|---|---|---|---|
| İzin kaydı | `plan_times.plan_type` (04 §8) | Ayrı `user_absences` tablosu | `plan_times.customer_id/project_id` NOT NULL — iznin müşterisi yok; kolonları gevşetmek PlanTimeCard/recurrence/atama akışını izin için de çalıştırmak demekti |
| Alt-proje | → `parent_id` (karar 2 önerisi) | Proje ağacında kalır | 16 alt-proje kategori adı taşıyor; parent yapmak hiç kapanmayacak 16 ana iş üretirdi |
| Batch taşıması | 1 iş + N katılımcı, tek durum (02 §5.1) | + `participant.completed_at` | 7 batch'te kişi başı statü farklı; frontend bugün "aggregate status" gösteriyor |
| `rejected` eşlemesi | → Pending (02 §5.1) | → cancelled kategorisi (P1'de) | Reddedilmiş işi yeniden açmamak için; yazma yolu hâlâ canlı |
| "Bugün" saat dilimi | — | Europe/Istanbul sabiti | core kiracı saat dilimini bilmiyor; env okumak manifest-bağlama testini kırıyor |
| 8h/40h sabitleri | "yok" sanılıyordu | Kapasite ayarına bağlandı | Sabitler vardı; eksik olan eksik-gün sinyaliydi |

**Can'ın dosyalarında (00–05) düzeltilmesi gerekenler — henüz uygulanmadı, 06 §3'te listeli:** `AGENTS.md` yok / migration Alembic; izin kataloğu 25 ve `PERMISSION_REQUIRES` 7 giriş; MCP 24 = 17+7; `ticket_attachments.ticket_id` nullable; reporting `tasks` okumaz; `?item=` derin link var; `project_memberships`/`issues` router'da canlı; Niş-Strateji.docx ve Rakip-Analizi.md repoda yok; `readme2.md` PRD v2 değil TAD; JSX satır sayısı kapsam belirtmeli; `work_item_types` tablosu tanımsız; `scheduled_date` eşlenmemiş; F/P numaralandırması ikili.

## 4. Yapılmayanlar ve neden

- **P2:** kod tarafı tamam (B2, C1–C3, F1). F1'in dev'de uçtan uca görülmesi MinIO/ClamAV kurulumuna bağlı (09 §6 runbook, CTO uygular). Outbox/webhook ertelendi (CTO kararı).
- **P3 (D3–D6, E1–E6):** A/B bölmesi gereği para katmanı ve e-fatura sonrası; ekran o zaman bir kez çizilir.

## 5. Sıradaki adımlar

1. CTO P0 + P1 kalemlerini hermes-dev'de test eder → toplu ff-merge `test`'e (CTO "ff yapalım" deyince). Terfi öncesi hermes-test kopyasında kuru-koşu (`p1_dryrun.sh`) tekrar edilir.
2. hermes-dev'de manuel `kubectl`: MinIO + ClamAV + configmap patch + bildirim temizlik CronJob'u (09 §6). Ardından F1 uçtan uca dev testi.
3. P3 (D3–D6, E1–E6): A/B bölmesi gereği para katmanı ve e-fatura sonrası.

## 6. P1.1 — şema + taşıma (22.09, dev)

- Alembic **0010_work_items_foundation**: 9 yeni tablo (`workflow_states`, `work_items`, `work_item_participants`, `work_item_code_aliases`, `work_item_links`, `work_item_comments`, `work_item_events`, `routing_relations`, `saved_views`), `projects.is_billable_default`, `work_logs.work_item_id`. RLS+FORCE, tenant-qualified unique, bileşik FK — 0007/0008/0009 deseni.
- Taşıma (`app/migrations/work_item_migration.py`): batch → tek iş + N katılımcı; durum = bugünkü aggregate kuralı; owner tek kişilikte atanan, çok kişilikte NULL (triage); alias'lar; yorum/olay kopyası (olaylar `sequence`); `work_logs.work_item_id`; routing kopyası; proje üyeliği backfill. **Doğrulama** transaction içinde: grup ↔ iş kalemi eşlemesi, görünürlük daralmadı, yorum/olay/work_log sayıları tutuyor; tutmazsa geri alınır. **Tekrar koşulabilir.**
- Eski `tasks` ailesi dokunulmadı; uçlar hâlâ `tasks`'tan çalışıyor (gölge dönem). P1.2 cutover'ında taşıma yeniden koşulup gölge dönemde açılan işler alınır.
- Testler: +7 (kurallar, karışık batch, idempotentlik, gölge dönem, fail-closed doğrulama, durum tohumu); migration zinciri ve RLS envanteri yeşil.
- **Kuru-koşu bulgusu (hermes-test kopyası, 0008 → head):** `convert_foreign_keys` ebeveyn `UNIQUE (tenant_id, id)` kısıtını model envanterindeki *tüm* tablolara uyguluyordu; envanter DB'nin önündeyken (hermes-test 0008'de, `routing_relations` yok) **0009 bile koşmuyordu**. Dev'de görünmedi (0009 modellerden önce koşmuştu), temiz-DB testi görmedi (0001 tüm model tablolarını baştan yaratır). Düzeltme: yalnız DB'de var olan tablolar; `test_upgrade_from_older_snapshot_when_models_are_ahead` bu senaryoyu kilitler. Ayrıca doğrulama, batch içinde farklı atayan anomalisinde görünürlük kaybını yakaladı → ikincil atayanlar `watcher` katılımcı olur.
- hermes-dev'de 0010 sonucu: 61 task → 42 grup → **42 iş kalemi**, 60 katılımcı, 19 alias, 18 sahipsiz (çok kişili → triage), 6 yorum, 145 olay, üyelik +30, routing +16; iki kiracıda 5'er durum; RLS+FORCE; tek bileşik FK.

## 7. P1.2 — servis/API geçişi + frontend (22.09, dev)

Commit `044651e` + `704db53` + `d9e558c` (hermes-dev). Eski `tasks` ailesi hâlâ duruyor (F05'e kadar), ama artık **hiçbir uç ondan okumuyor/yazmıyor**.

**Backend**
- `services/work_item_service.py` (yeni, tek iş mantığı): listeleme/arama (eski filtreler + `state_id`/`owner_user_id`/`unassigned`), oluşturma (tekil, bulk, grup → **tek iş kalemi + N katılımcı**), güncelleme (tür değişince yeni numara + alias), katılımcı bazlı durum (`apply_status`: kabul/tamamlama kişi başı; hepsi tamamlanınca kalem `done`), reddetme, silme, arşiv/geri alma, yorum/olay (`sequence`), kapanış hesabı. Görünürlük: admin ∨ reporter ∨ owner ∨ katılımcı.
- `services/work_item_compat.py`: internal `WorkItemResponse` = eski `TaskResponse` + `participants[]`, `state`, `owner/reporter_user_id`, `is_billable`, `origin_*`, `parent_id`; public `PublicTask` şekli **değişmedi**. Kimlik: `/tasks/{id}` iş kalemi id'si, katılımcı id'si **ya da** eski `tasks.id` alır.
- Public API: `public_resource_service`, `api_access_service.work_item_filter`, `public_directory_service`, `public_api/routers/tasks*.py`, `work_logs.py` iş kalemine geçti. `POST /v1/task-groups` yanıtı aynı şekil (üye başına giriş, hepsi aynı kod, `assignment_batch_id` = iş kalemi id'si). Efor: `task_code` → `work_logs.work_item_id`; `task_codes_for` hem iş kalemi hem eski id ile çözer.
- `work_log_service`: `task_id` (iş/katılımcı/eski id) iş kalemine çözülür; `work_item_id` yazılır; `log_time_created` olayı iş kaleminde; kapanış yeniden hesaplanır. `WorkLogResponse.work_item_id` eklendi.
- Otomatik arşiv (`task_archive_service`): ham SQL `work_items` üzerine (terminal kategori + `closed_at ≤ cutoff`), audit `work_item_events` (`sequence` ile). `assignment_rows_updated` artık iş kalemi sayısı.
- Alembic **0011_work_items_cutover_sync**: taşımayı yeniden koşar (0010 → cutover arasında `tasks`'a düşen satırlar alınır; taşınmışlar atlanır).
- `ensure_states`: kiracıda `workflow_states` boşsa (0010'dan sonra açılan kiracı, boş test DB'si) ilk iş kaleminde 422 yerine 0010/0011 ile aynı varsayılan akış tohumlanır — CI'da boş DB'de yakalandı.
- `task_lifecycle.py` politika + DDL/backfill için kalır; Task tabanlı yardımcılar yalnız `task_service`'in eski yollarında (F05'te gider).

**Frontend (08 §5, küçük adaptasyon)**
- `grouping.js`: satır `participants[]` taşıyorsa mantıksal iş = kalemin kendisi; assignment = assignee rolündeki katılımcı (id = **katılımcı id'si**, kişi bazlı durum sunucudan). Eski şekil (batch) aynen çalışır. `expandAssignmentRows` swimlane için kişi başı satır açar.
- `useTaskStatusMutation`: iyimser yama katılımcıyı da yamalar. Uçlar değişmedi (katılımcı id'siyle `PATCH /status`).
- `useWorkflowStates` + `GET /tasks/states`: pano sütunları durumlardan (3 sütun sabit, sunucu durumu iliştirilir; erişilemezse eski 3).
- **A10**: LogTimeModal iş kalemi seçici (yukarıda).
- Yan bulgu: düz panoda sütun başlığı `label` (tanımsız) okuyordu — i18n geçişinde `labelKey`'e geçilmemiş; düzeltildi.

**Testler:** MCP paketi (104) `Task` tohumu → `sync_work_items` ile iş kalemine taşındı; core tüm paket yeşil (658 + migration 22: 0011 head, geride-kalmış-DB senaryosu); `test_task_archive_api`, `test_task_auto_archive`, public API paketi ve grup sözleşmesi iş kalemine taşındı (tohum `Task` → `sync_work_items` → iddialar iş kalemi üzerinde; üretim taşıma yolu = test yolu). Frontend: +14 (katılımcı gruplama, durum→sütun, A10 seçici), pano/gruplama/log-time entegrasyonları yeşil.

**Canlı doğrulama (hermes-dev, `d9e558c`, 22.09):** `alembic_version = 0011`; 61 task → 42 iş kalemi (taşınmamış 0), 60 katılımcı, 19 alias, 145 olay; `/tasks/states`, `/tasks`, `/v1/tasks` token'sız 401 (500 yok); core pod loglarında hata yok. CD: core/auth/mcp/frontend kapıları yeşil (GHCR login'de bir kez geçici hata → yalnız o job yeniden koştu).

**Kuru-koşu (hermes-test kopyası, `d9e558c`, 0008 → 0011):** 182 task → **120 iş kalemi**, 182 katılımcı, 62 alias, 25 sahipsiz (triage), 18 yorum, 690 olay, 18 efor bağı, üyelik +40, routing +68; iki kiracıda 5'er durum; dağılım Completed 78 · Pending 18 · In Progress 15 · Rejected 9. Gerçek `core_db`'ye dokunulmadı (kopya + pod silindi). Not: kopya DB'de migrator rolüne `GRANT ALL ON DATABASE` gerekiyor (script'e eklendi); gerçek DB'de yetki zaten var.

**Sapmalar:** `assignment_batch_id` yalnız çok katılımcılı kalemde dolu (08 §4 "= id" diyordu) — tekil oluşturma sözleşmesi (`assignment_batch_id is None`) korunur. Pasif grup → 400, yok → 404 (eski grup ucu sözleşmesi).

## 8. P1.3 — görünürlük + yetki + bağlar (22.09, dev)

Commit `b29904f` (hermes-dev). Şema değişikliği YOK (0010'daki tablolar yeter); hepsi servis/API + küçük UI.

- **A3** görünürlük: `visible_filter`/`can_view` proje üyeliğini sayar; üyelik olmadan kişi yalnız reporter/owner/katılımcı olduğu işi görür. Testler: üye görür, üye olmayan 404, başka projedeki üyelik sızmaz, yönlendirme görünürlük vermez.
- **A4** yönlendirme: `task_service` okuma/yazma `routing_relations`a geçti; admin uçları aynı yol/şekil. Testler `RoutingRelation` tohumlar (7 dosya).
- **B3** düzenleme: `can_edit_core(user, item, db)` (admin/reporter/lead) + `can_edit_fields` (owner alan listesi). Silme/arşiv çekirdek yetki.
- **B4** kendine iş: `require_create_authority` + `_validate_assignment_wi`; bulk'ta açıkça kendini seçmek geçerli (grup fan-out'unda atayan yine hariç); eski "atayan kendine atanmaz" sözleşme testi B4'e göre güncellendi; admin listesi kendisini de içerir.
- **B5** takipçi: servis + uçlar + olaylar (`watcher_added/removed`); `send_status_notifications(watcher_user_ids=…)` — atanan/atayan çift mail almaz, adressiz atlanır; UI zil düğmesi (sayfa mutation'ı, panel saf).
- **A7** hiyerarşi/bağlar: `_validate_parent` (iki seviye, aynı proje, görünür, arşivli değil, alt işi olan kalem alt olamaz); `parent` ilişkisi + `children` selectin (liste rollup'ı satır başına sorgu açmaz); bağ uçları + `blocks` döngü reddi; kabul ölçütü 8 testle kilitli.
- **A8** faturalanabilirlik: proje şeması/serializer/formu; iş kalemi miras + override izi; efor kaydı bağlı işten miras. Detay panelinde satır; düzenleme modalında anahtar (yalnız değiştiyse gönderilir).
- **A6** talep → iş: hub uçları, `TicketAgentOut.work_items`, açıklama = ticket başlığı + ilk **public** mesaj + adımlar (internal not asla taşınmaz), varsayılan tür `task` (issue ayrı izin scope'u). Hub UI: modal + liste; iş detayında kaynak bağı; `/tickets?ticket=<id>` derin linki.
- **Testler:** +4 core dosyası (`test_work_item_access/watchers/hierarchy_billing`, `ticketing/test_work_item_link`) + güncellenen sözleşme testleri; frontend +2 (`watchers`, B4 crud senaryosu); tam core paketi ve frontend paketleri yeşil (kanıt aşağıda).

**Canlı doğrulama (hermes-dev, `b29904f`, 22.09):** CD kapıları (core 691 · mcp 104 · auth · frontend 5 shard · build) yeşil, migrate/deploy başarılı; imajlar SHA'ya pinli; `alembic_version = 0011` (P1.3 şema değiştirmez); 42 iş kalemi / 60 katılımcı / 19 alias / 145 olay değişmedi, taşınmamış task 0; `routing_relations` 16, `project_memberships` 30 (0010 backfill'i), takipçi/bağ 0 (yeni); `/tasks`, `/tasks/states`, `/v1/tasks`, `/projects`, `/tickets/context`, `/admin/task-assignment-relations` token'sız 401; pod logunda hata yok. hermes-test kopyasında kuru-koşu tekrarı gerekmedi (0011 aynen; terfi öncesi yine koşulacak).

**Sapmalar / notlar:** `member_role` bugün serbest metin (`member` backfill'i); `lead` rolü verilmesi B2 (proje ayarları sayfası) gelene kadar API/DB ile. Bağ (links) UI'si P3 (08 §2.9). MCP istemci matrisi hâlâ yeniden koşulmadı (gerçek istemci gerekir).

## 9. P2.1 — B2 proje üyeleri (22.09, dev)

Commit `1ba5a9f`. Şema değişikliği yok (`member_role` CHECK'i 0012'de gelecek; şema Literal `lead|member|viewer` ile korunuyor).

- Backend: `routers/project_members.py` — `GET/POST/PATCH/DELETE /projects/{id}/members`; yanıt `{project_id, can_manage, can_assign_lead, items[]}` (UI düğmeleri sunucu kararına bağlı). Yetki: `projects.manage` ∨ o projenin lead'i; lead `member/viewer` ekler-çıkarır-değiştirir, `lead` rolüne dokunamaz (403); pasif üyelik yeniden etkinleştirilir (satır çoğaltılmaz); mükerrer 409; geçersiz rol 422. Eski `/project-memberships` uçları (admin) aynen.
- Frontend: `components/projects/ProjectMembersDrawer.jsx` (liste, kullanıcı seçici — zaten üye olanlar listelenmez —, rol Select, çıkar; `can_assign_lead` yoksa "Lider" seçeneği yok); Ayarlar › Projeler satırında "Üyeler"; Explorer breadcrumb'ında proje seçiliyken `ProjectMembersButton` (provider yoksa kendini gizler — `QueryClientContext` guard'ı; `components/tasks` provider'sız render sınırı korunur). Query anahtarı `queryKeys.projectMembers` (merkezi sözleşme).
- Testler: core +7 (`test_project_members.py`: yetki matrisi, lead sınırı, 409/422, üyeliğin görünürlüğü anında değiştirmesi); frontend +5 (`admin/projectMembers.test.jsx`).
- **Canlı doğrulama (hermes-dev, `1ba5a9f`):** CD kapıları + migrate/deploy başarılı; uçlar token'sız 401; pod logu temiz.
- Not: üyelik listesi kullanıcı adlarını `auth /users/lookup` ile çözer (en az ayrıcalıklı dizin); lead için proje-içi yönlendirme (05 B2 "proje içi yönlendirme") P2'de yok — yönlendirme kiracı düzeyinde (A4).

## 10. P2.2 — C1–C3 uygulama içi bildirim + kanal ayrımı (22.09, dev)

Commit `21e7736`. Alembic **0012_p2_notifications_channels** (additive): `work_item_notifications` (RLS+FORCE), `task_notification_settings.email_enabled/in_app_enabled` (DEFAULT true), `project_memberships.member_role` CHECK (`lead|member|viewer|NULL`). F1'in `ticket_attachments.work_item_id`'si P2.3'te ayrı migration'a (0013) alındı — 09 §3 "tek migration" demişti; adımların bağımsız kalması için bölündü.

- `services/notification_service.py`: `fan_out` `record_event` içinden (aynı transaction, outbox yok); alıcı kuralları olay tipine göre (task_created → atananlar; durum/yorum → reporter+owner+katılımcılar; watcher_added → eklenen; log_time → reporter/owner); aktör hariç; kural tablosu `channel="in_app"` ile uygulanır (öncelik/termin/olay bayrağı). Hiçbir zaman istisna yükseltmez.
- `routers/notifications.py`: liste (`unread`, sayfalı) + okunmamış sayısı + okundu/tümü okundu; kullanıcı yalnız kendi bildirimlerini görür (başkasınınki 404). Yanıt olay verisinden yalnız güvenli anahtarları taşır (`from/to/user_id/...`).
- E-posta kapısı: `notification_allowed(channel="email")` — `email_enabled=false` e-postayı kapatır, uygulama içi sürer (ve tersi); eski istemciler alanları göndermezse iki kanal açık.
- Temizlik: `app/jobs/notification_cleanup.py` (`purge_read`, 90 gün, tenant başına) + `k8s/notification-cleanup-cronjob.yaml` (03:30 UTC, dev; manuel apply, `kubectl diff` sonrası).
- Frontend: `components/layout/NotificationBell.jsx` (rozet, liste, okundu, tümünü okundu, işe git; `refetchOnWindowFocus` + 60 sn), kabuk başlığında; PM ayarları › Mail Notifications sekmesinde "Kanallar: E-posta / Uygulama içi" çipleri; i18n.
- Testler: core +7 (`test_work_item_notifications.py`: alıcı kümesi, aktör hariç, okundu/tümü, kanal kapama, öncelik kuralı, purge), migration zinciri 0012 (temiz DB + geride kalmış DB); frontend +5 (`shell/notificationBell.test.jsx`).
- **Canlı doğrulama (hermes-dev, `21e7736`):** `alembic_version = 0012`; `/notifications`, `/unread-count`, `/admin/notification-settings` token'sız 401; `email_enabled/in_app_enabled` 2/2, `chk_project_memberships_role` 1, `work_item_notifications` RLS+FORCE; 42 iş kalemi sabit; pod logu temiz.

## 11. P2.3 — F1 iş kalemine ek dosya (22.09, dev)

Commit `a05121a`. Alembic **0013_p2_work_item_attachments** (additive): `ticket_attachments.work_item_id` (FK RESTRICT) + index; `chk_ticket_attachments_attached_needs_ticket` iş kalemini de kabul eder; yeni `chk_ticket_attachments_work_item_exclusive` (iş kalemi eki ticket/mesaj/çözüm sahipliğiyle birlikte olamaz). Mevcut satırlar (hepsi ticket'a bağlı) her iki kısıta uyar. Model ve baseline expand ifadeleri aynı metni taşır (temiz DB = create_all, mevcut DB = ALTER).

- `services/work_item_attachment_service.py`: oturum (Hermes uygulama satırı `ensure_application` ile, `uploader_type=hermes_user`, `public`), içerik → `store_upload` (ticket'la aynı) → **temizse anında bağlanır** (`attached_at`, `expires_at=NULL`, olay `attachment_added`); liste; indirme (`open_download`: temiz + bağlı değilse 409); kaldırma (sahiplik kopar, 1 saat sonra bakım job'ı nesneyi siler). Yetki: yükleme/kaldırma `_can_link` kümesi (reporter/owner/katılımcı/lead/admin), görme/indirme `can_view`; özellik kapalıysa 503.
- Uçlar (`routers/tasks.py`): `GET/POST /tasks/{id}/attachments`, `POST .../{aid}/content` (ham gövde), `GET .../{aid}/download` (stream, `Content-Disposition: attachment`, `no-store`, `nosniff`), `DELETE .../{aid}`.
- Sızıntı: hub/portal serializer'ları `ticket_id` ile yükler → iş kalemi eki (ticket_id NULL) o kümeye yapısal olarak giremez; test kilitler. Ticket sızıntı ve indirme-izni testleri aynen yeşil.
- Frontend: `components/tasks/TaskAttachmentsTab.jsx` (liste, boyut, indir, kaldır; ticket `AttachmentDropzone`'u ile yükleme; 503'te açıklama), detay panelinde "Ekler" sekmesi (tembel mount). `taskService.*Attachment*`, `queryKeys.tasks.attachments`.
- Dev ortamı: `k8s/10-minio.yaml`, `k8s/11-clamav.yaml` (test kopyası, ns hermes-dev) + `k8s/notification-cleanup-cronjob.yaml`; adımlar 09 §6. Kurulana kadar dev'de uçlar 503 döner (ticket tarafındaki mevcut davranışla aynı).
- Testler: core +6 (`test_work_item_attachments.py`), migration zinciri 0013; frontend +5 (`tasks/attachmentsTab.test.jsx`).
- **Canlı doğrulama (hermes-dev, `a05121a`):** CD kapıları + migrate/deploy başarılı; `alembic_version = 0013`; `ticket_attachments.work_item_id` + 2 arc kısıtı; `/tasks/{id}/attachments` token'sız 401; `TICKET_ATTACHMENTS_ENABLED=false` (manuel kurulum bekliyor, 09 §6); 42 iş kalemi sabit; pod logu temiz. **Kuru-koşu (hermes-test kopyası, `a05121a`, 0008 → 0013):** 182 task → 120 iş kalemi (P1.1 ile aynı), 0012 ve 0013 sorunsuz; gerçek `core_db`'ye dokunulmadı.
