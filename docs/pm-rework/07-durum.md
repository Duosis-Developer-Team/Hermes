# Hermes PM Rework — Durum (22.09.2026)

Can'ın 05-gelistirme-kapsami.md'de listelediği **31 kalem** ile yapılanların karşılaştırması.
Kararlar ve kod doğrulaması ayrıntısı: `06-inceleme-ve-kararlar.md`.

**Özet:** 4 kalem yapıldı (D1 sapmayla, D2, G1, B1) — **P0 tamam** · 27 başlamadı (P1/P2/P3 — kapsam gereği F00 kararlarına ve para katmanına bağlı). Sıradaki: P1 şema rework'ü, 3/5/6 kararları kapanınca.
Kararlar: 7'nin 7'si + 2 yeni karar kapatıldı (batch → `participant.completed_at`; A10 efor↔iş kalemi). Açık karar yok.

## 1. Can'ın istediği tüm geliştirmeler (05'teki liste)

| Kod | İş | Faz | Durum | Not |
|---|---|---|---|---|
| A1 | İş kalemi nesnesi + katılımcılar | P1 | **P1.1 yapıldı (şema+taşıma)** | `work_items` + `work_item_participants` (kişi başı `completed_at`); Alembic 0010; taşıma idempotent, doğrulamalı. Servis/API geçişi P1.2 |
| A2 | Konfigüre edilebilir durum akışı | P1 | **P1.1 yapıldı (şema)** | `workflow_states` kiracı başına tohumlandı: Pending/todo · In Progress · Completed/done · Cancelled · **Rejected/cancelled** (doküman `Pending` diyordu). Durum makinesi ve pano P1.2 |
| A3 | Görünürlük proje üyeliğine | P1 | Başlamadı | `project_memberships` 0 satır, `member_role` serbest metin; backfill sıfırdan |
| A4 | Yönlendirme politikasının ayrılması | P1 | Başlamadı | |
| A5 | `issues` birleştirme | P1 | Başlamadı | `issues` 0 kayıt → veri taşımasız; CRUD router'ının emekliliği kod işi |
| A6 | Talep → iş bağı | P1 | Başlamadı | |
| A7 | Hiyerarşi ve ilişkiler | P1 | Başlamadı | Karar: **alt-proje proje ağacında kalır** (işlerin %63'ü kategori adlı 16 alt-projede); `parent_id` yalnız gerçek kırılım |
| A8 | Faturalanabilirlik iş kaleminde | P1 | Başlamadı | Karar 3 kapandı: `projects.is_billable_default` → iş kalemi → efor override. Veri: %100 billable, %0,6 işe bağlı → A10 |
| A9 | `/v1` ve MCP uyumluluk | P1 | **P1.1 kısmen (alias tablosu)** | `work_item_code_aliases`: batch birleşince kaybolan kodlar korunur; `legacy_task_ids` ile eski id'ler çözülür. Serializer/MCP matrisi P1.2 |
| A10 | Efor girişinde iş kalemi seçimi (**yeni**, CTO 22.09) | P1 | Başlamadı | LogTimeModal'da proje seçilince açık işler listelenir; isteğe bağlı. Bugün kayıtların %0,6'sı işe bağlı |
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

- **P1 (A1–A10, B3–B5):** Sıradaki. Tüm kararlar kapandı; F00 şema dondurma ile başlar.
- **P2 (B2, C1–C3, F1):** A1'e bağlı.
- **P3 (D3–D6, E1–E6):** A/B bölmesi gereği para katmanı ve e-fatura sonrası; ekran o zaman bir kez çizilir.

## 5. Sıradaki adımlar

1. F00 şema dondurma (08-p1-plani) → **P1** (A1–A10, B3–B5).
2. CTO tüm kalemleri hermes-dev'de test eder → toplu ff-merge `test`'e (CTO "ff yapalım" deyince).

## 6. P1.1 — şema + taşıma (22.09, dev)

- Alembic **0010_work_items_foundation**: 9 yeni tablo (`workflow_states`, `work_items`, `work_item_participants`, `work_item_code_aliases`, `work_item_links`, `work_item_comments`, `work_item_events`, `routing_relations`, `saved_views`), `projects.is_billable_default`, `work_logs.work_item_id`. RLS+FORCE, tenant-qualified unique, bileşik FK — 0007/0008/0009 deseni.
- Taşıma (`app/migrations/work_item_migration.py`): batch → tek iş + N katılımcı; durum = bugünkü aggregate kuralı; owner tek kişilikte atanan, çok kişilikte NULL (triage); alias'lar; yorum/olay kopyası (olaylar `sequence`); `work_logs.work_item_id`; routing kopyası; proje üyeliği backfill. **Doğrulama** transaction içinde: grup ↔ iş kalemi eşlemesi, görünürlük daralmadı, yorum/olay/work_log sayıları tutuyor; tutmazsa geri alınır. **Tekrar koşulabilir.**
- Eski `tasks` ailesi dokunulmadı; uçlar hâlâ `tasks`'tan çalışıyor (gölge dönem). P1.2 cutover'ında taşıma yeniden koşulup gölge dönemde açılan işler alınır.
- Testler: +7 (kurallar, karışık batch, idempotentlik, gölge dönem, fail-closed doğrulama, durum tohumu); migration zinciri ve RLS envanteri yeşil.
