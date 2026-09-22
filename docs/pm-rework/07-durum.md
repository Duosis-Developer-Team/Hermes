# Hermes PM Rework — Durum (22.09.2026)

Can'ın 05-gelistirme-kapsami.md'de listelediği **31 kalem** ile yapılanların karşılaştırması.
Kararlar ve kod doğrulaması ayrıntısı: `06-inceleme-ve-kararlar.md`.

**Özet:** 4 kalem yapıldı (D1 sapmayla, D2, G1, B1) — **P0 tamam** · **P1.1 + P1.2 yapıldı** (A1, A2, A9 ve A10 dev'de; A3–A8, B3–B5 P1.3'te) · 24 başlamadı (P1.3 9 · P2 5 · P3 10; tablo 32 satır = Can'ın 31'i + A10). Sıradaki: P1.3 görünürlük + yetki + bağlar.
Kararlar: 7'nin 7'si + 2 yeni karar kapatıldı (batch → `participant.completed_at`; A10 efor↔iş kalemi). Açık karar yok.

## 1. Can'ın istediği tüm geliştirmeler (05'teki liste)

| Kod | İş | Faz | Durum | Not |
|---|---|---|---|---|
| A1 | İş kalemi nesnesi + katılımcılar | P1 | **Yapıldı (P1.1 + P1.2)** | `work_items` + `work_item_participants` (kişi başı `completed_at`); Alembic 0010 + 0011 cutover; tüm internal/public uçlar iş kaleminden okur/yazar (`work_item_service`); frontend katılımcı bazlı |
| A2 | Konfigüre edilebilir durum akışı | P1 | **Yapıldı (temel)** | `workflow_states` tohumu (Pending/todo · In Progress · Completed/done · Cancelled · **Rejected/cancelled**); `GET /tasks/states`; `PATCH /status` `state_id` kabul eder; pano sütunları durumlardan (`useWorkflowStates`, geri düşüş eski 3). Yönetim ekranı (durum ekle/sırala) P2 |
| A3 | Görünürlük proje üyeliğine | P1 | Başlamadı | `project_memberships` 0 satır, `member_role` serbest metin; backfill sıfırdan |
| A4 | Yönlendirme politikasının ayrılması | P1 | Başlamadı | |
| A5 | `issues` birleştirme | P1 | Başlamadı | `issues` 0 kayıt → veri taşımasız; CRUD router'ının emekliliği kod işi |
| A6 | Talep → iş bağı | P1 | Başlamadı | |
| A7 | Hiyerarşi ve ilişkiler | P1 | Başlamadı | Karar: **alt-proje proje ağacında kalır** (işlerin %63'ü kategori adlı 16 alt-projede); `parent_id` yalnız gerçek kırılım |
| A8 | Faturalanabilirlik iş kaleminde | P1 | Başlamadı | Karar 3 kapandı: `projects.is_billable_default` → iş kalemi → efor override. Veri: %100 billable, %0,6 işe bağlı → A10 |
| A9 | `/v1` ve MCP uyumluluk | P1 | **Yapıldı** | `/v1` şekli değişmedi (`work_item_compat.to_public_task`); `task_code` = `item_key` ∨ alias; eski `tasks.id`, katılımcı id ve iş kalemi id'si aynı uçlarda çözülür (`resolve_ref`); 335 public API testi yeşil. **MCP istemci matrisi yeniden koşulmadı** (gerçek istemci gerekir) — CTO dev testinde; matris dokunulmadı |
| A10 | Efor girişinde iş kalemi seçimi (**yeni**, CTO 22.09) | P1 | **Yapıldı** | LogTimeModal: serbest girişte proje seçilince "İş kalemi (isteğe bağlı)" — kullanıcının o projede gördüğü açık işler; seçim `task_id` → `work_logs.work_item_id` + `log_time_created` olayı. Görevden/toplantıdan açılan akışta seçici yok |
| B1 | Ayarların tek çatı altına alınması | P0 | **Yapıldı** | Tek `/settings`, beş bölüm, bölüm başına izin; menüde tek "Ayarlar" (Yönetim grubunda, prototipteki yerleşim); eski adresler yönlendirilir; yeni izin kodu yok |
| B2 | Proje ayarları sayfası | P2 | Başlamadı | A3'e bağlı |
| B3 | Düzenleme yetkisi kuralları | P1 | Başlamadı | A1+A3 ile gelir |
| B4 | Kendine iş açma | P1 | Başlamadı | A1+A3 ile gelir |
| B5 | Takipçi | P1 | Başlamadı | A1 ile gelir |
| C1 | İş kalemi olay akışı | P2 | Başlamadı | A1 gerekli |
| C2 | Uygulama içi bildirim | P2 | Başlamadı | C1 gerekli |
| C3 | Kanal ayrımı | P2 | Başlamadı | C2 gerekli |
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
| F1 | İş kalemine dosya ekleme | P2 | Başlamadı | Düzeltme: `ticket_attachments.ticket_id` nullable, exclusive-arc — polimorfik geçiş bunu devralmalı |
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

- **P1.3 (A3–A8, B3–B5):** Sıradaki — proje üyeliği görünürlüğü, routing, düzenleme yetkisi, kendine iş, takipçi, talep→iş, hiyerarşi, faturalanabilirlik.
- **P2 (B2, C1–C3, F1):** A1 tamam; P1.3 sonrası.
- **P3 (D3–D6, E1–E6):** A/B bölmesi gereği para katmanı ve e-fatura sonrası; ekran o zaman bir kez çizilir.

## 5. Sıradaki adımlar

1. **P1.3** (A3–A8, B3–B5) — 08-p1-plani §6.
2. CTO tüm kalemleri hermes-dev'de test eder → toplu ff-merge `test`'e (CTO "ff yapalım" deyince). Terfi öncesi hermes-test kopyasında kuru-koşu (`p1_dryrun.sh`) tekrar edilir.

## 6. P1.1 — şema + taşıma (22.09, dev)

- Alembic **0010_work_items_foundation**: 9 yeni tablo (`workflow_states`, `work_items`, `work_item_participants`, `work_item_code_aliases`, `work_item_links`, `work_item_comments`, `work_item_events`, `routing_relations`, `saved_views`), `projects.is_billable_default`, `work_logs.work_item_id`. RLS+FORCE, tenant-qualified unique, bileşik FK — 0007/0008/0009 deseni.
- Taşıma (`app/migrations/work_item_migration.py`): batch → tek iş + N katılımcı; durum = bugünkü aggregate kuralı; owner tek kişilikte atanan, çok kişilikte NULL (triage); alias'lar; yorum/olay kopyası (olaylar `sequence`); `work_logs.work_item_id`; routing kopyası; proje üyeliği backfill. **Doğrulama** transaction içinde: grup ↔ iş kalemi eşlemesi, görünürlük daralmadı, yorum/olay/work_log sayıları tutuyor; tutmazsa geri alınır. **Tekrar koşulabilir.**
- Eski `tasks` ailesi dokunulmadı; uçlar hâlâ `tasks`'tan çalışıyor (gölge dönem). P1.2 cutover'ında taşıma yeniden koşulup gölge dönemde açılan işler alınır.
- Testler: +7 (kurallar, karışık batch, idempotentlik, gölge dönem, fail-closed doğrulama, durum tohumu); migration zinciri ve RLS envanteri yeşil.
- **Kuru-koşu bulgusu (hermes-test kopyası, 0008 → head):** `convert_foreign_keys` ebeveyn `UNIQUE (tenant_id, id)` kısıtını model envanterindeki *tüm* tablolara uyguluyordu; envanter DB'nin önündeyken (hermes-test 0008'de, `routing_relations` yok) **0009 bile koşmuyordu**. Dev'de görünmedi (0009 modellerden önce koşmuştu), temiz-DB testi görmedi (0001 tüm model tablolarını baştan yaratır). Düzeltme: yalnız DB'de var olan tablolar; `test_upgrade_from_older_snapshot_when_models_are_ahead` bu senaryoyu kilitler. Ayrıca doğrulama, batch içinde farklı atayan anomalisinde görünürlük kaybını yakaladı → ikincil atayanlar `watcher` katılımcı olur.
- hermes-dev'de 0010 sonucu: 61 task → 42 grup → **42 iş kalemi**, 60 katılımcı, 19 alias, 18 sahipsiz (çok kişili → triage), 6 yorum, 145 olay, üyelik +30, routing +16; iki kiracıda 5'er durum; RLS+FORCE; tek bileşik FK.

## 7. P1.2 — servis/API geçişi + frontend (22.09, dev)

Commit `<sha>` (hermes-dev). Eski `tasks` ailesi hâlâ duruyor (F05'e kadar), ama artık **hiçbir uç ondan okumuyor/yazmıyor**.

**Backend**
- `services/work_item_service.py` (yeni, tek iş mantığı): listeleme/arama (eski filtreler + `state_id`/`owner_user_id`/`unassigned`), oluşturma (tekil, bulk, grup → **tek iş kalemi + N katılımcı**), güncelleme (tür değişince yeni numara + alias), katılımcı bazlı durum (`apply_status`: kabul/tamamlama kişi başı; hepsi tamamlanınca kalem `done`), reddetme, silme, arşiv/geri alma, yorum/olay (`sequence`), kapanış hesabı. Görünürlük: admin ∨ reporter ∨ owner ∨ katılımcı.
- `services/work_item_compat.py`: internal `WorkItemResponse` = eski `TaskResponse` + `participants[]`, `state`, `owner/reporter_user_id`, `is_billable`, `origin_*`, `parent_id`; public `PublicTask` şekli **değişmedi**. Kimlik: `/tasks/{id}` iş kalemi id'si, katılımcı id'si **ya da** eski `tasks.id` alır.
- Public API: `public_resource_service`, `api_access_service.work_item_filter`, `public_directory_service`, `public_api/routers/tasks*.py`, `work_logs.py` iş kalemine geçti. `POST /v1/task-groups` yanıtı aynı şekil (üye başına giriş, hepsi aynı kod, `assignment_batch_id` = iş kalemi id'si). Efor: `task_code` → `work_logs.work_item_id`; `task_codes_for` hem iş kalemi hem eski id ile çözer.
- `work_log_service`: `task_id` (iş/katılımcı/eski id) iş kalemine çözülür; `work_item_id` yazılır; `log_time_created` olayı iş kaleminde; kapanış yeniden hesaplanır. `WorkLogResponse.work_item_id` eklendi.
- Otomatik arşiv (`task_archive_service`): ham SQL `work_items` üzerine (terminal kategori + `closed_at ≤ cutoff`), audit `work_item_events` (`sequence` ile). `assignment_rows_updated` artık iş kalemi sayısı.
- Alembic **0011_work_items_cutover_sync**: taşımayı yeniden koşar (0010 → cutover arasında `tasks`'a düşen satırlar alınır; taşınmışlar atlanır).
- `task_lifecycle.py` politika + DDL/backfill için kalır; Task tabanlı yardımcılar yalnız `task_service`'in eski yollarında (F05'te gider).

**Frontend (08 §5, küçük adaptasyon)**
- `grouping.js`: satır `participants[]` taşıyorsa mantıksal iş = kalemin kendisi; assignment = assignee rolündeki katılımcı (id = **katılımcı id'si**, kişi bazlı durum sunucudan). Eski şekil (batch) aynen çalışır. `expandAssignmentRows` swimlane için kişi başı satır açar.
- `useTaskStatusMutation`: iyimser yama katılımcıyı da yamalar. Uçlar değişmedi (katılımcı id'siyle `PATCH /status`).
- `useWorkflowStates` + `GET /tasks/states`: pano sütunları durumlardan (3 sütun sabit, sunucu durumu iliştirilir; erişilemezse eski 3).
- **A10**: LogTimeModal iş kalemi seçici (yukarıda).
- Yan bulgu: düz panoda sütun başlığı `label` (tanımsız) okuyordu — i18n geçişinde `labelKey`'e geçilmemiş; düzeltildi.

**Testler:** core tüm paket yeşil (658 + migration 22: 0011 head, geride-kalmış-DB senaryosu); `test_task_archive_api`, `test_task_auto_archive`, public API paketi ve grup sözleşmesi iş kalemine taşındı (tohum `Task` → `sync_work_items` → iddialar iş kalemi üzerinde; üretim taşıma yolu = test yolu). Frontend: +14 (katılımcı gruplama, durum→sütun, A10 seçici), pano/gruplama/log-time entegrasyonları yeşil.

**Sapmalar:** `assignment_batch_id` yalnız çok katılımcılı kalemde dolu (08 §4 "= id" diyordu) — tekil oluşturma sözleşmesi (`assignment_batch_id is None`) korunur. Pasif grup → 400, yok → 404 (eski grup ucu sözleşmesi).
