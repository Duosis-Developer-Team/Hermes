# Hermes PM Rework — P1 Uygulama Planı (F00: şema dondurma)

**22.09.2026 · CTO onayladı (§8: 1 TASK-56+alias · 2 küçük frontend uyarlaması · 3 yeni tablo+kopya · 4 eski tablolar F05'e kadar durur).** 02-sema.md hedef modeli + 06'daki kararlar + kod etki haritası
(backend 9 bölüm, frontend 8 bölüm; ayrıntı §7) üzerine kurulu. Bu plan onaylanınca 02-sema'nın
yerine geçen "dondurulmuş şema" budur.

## 0. P1'in tanımı

05'teki A1–A10 ve B3–B5. Bitti sayılması için (01 §7 + 02 §8):
1. Üç kişiye atanmış iş `work_items`'ta **tek satır**, arayüzde tek iş.
2. Proje üyesi kendisine atanmamış işi görür; taşıma sonrası **hiçbir kullanıcının görünen iş kümesi daralmaz**.
3. `owner_user_id` boş iş kaybolmaz (triage görünümü).
4. Kiracı durum ekleyebilir; pano sütunları ve raporlar kategoriden çalışır.
5. Tahmin / girilen / faturalanabilir saat tek yerden okunur.
6. Ticket'tan doğan iş kaynağına gidilebilir.
7. `/v1` ve MCP araçları taşıma öncesiyle **aynı yanıtı** verir; MCP matrisi yeniden koşulur.
8. `blocks` bağı hiçbir tarih/durum değişikliği tetiklemez.

## 1. Etki haritasından çıkan gerçekler (planı şekillendirenler)

| Gerçek | Kaynak | Sonuç |
|---|---|---|
| İki serializer var: `_serialize_task` (29 alan, internal) ve `PublicTask` (16 alan) | routers/tasks.py:153, public_api/schemas/resources.py:54 | Uyumluluk = bu iki fonksiyonu yeni modelden beslemek |
| Task kodu `(task_type, type_number)` ile çözülür, `id` ile değil; kod = `TASK-56` | public_resource_service.py:107 | Kodlar korunmalı; batch birleşince N kod tek işe düşer → **alias** gerekir |
| `assignee_user_id` NOT NULL ve 5 yerde görünürlük yüklemi; `assigner` yetki sütunu | task_service 1133–1156, api_access_service:154 | Görünürlük/yetki tek fonksiyona toplanır (`work_item_access`) |
| `assignment_batch_id` mantıksal grup anahtarı (lifecycle, arşiv SQL, restore yanıtı) | task_lifecycle:168, task_archive_service:52 | Ham SQL iki dosyada — yeniden yazılır |
| `chk_tasks_completion_consistency` status enum'una bağlı | models/task.py:373 | Yeni modelde kısıt kategoriye taşınır (`closed_at` ⇔ terminal kategori) |
| Frontend N satırdan mantıksal iş türetir (`grouping.js`, batch_id) ve satır `id`'siyle durum günceller | grouping.js:79, useTaskStatusMutation:52 | P1'de frontend'e **küçük** bir uyarlama: grouping katılımcılardan türetilir (aşağıda §5) |
| Frontend'de `type_number`, `assignee_note`, `first_*`, `closed_at` hiç kullanılmıyor | etki haritası §2 | Bunlar arayüzde görünmeden taşınabilir |
| Public API: `/v1/task-groups` `created_tasks[]` N kod döner; MCP testleri bunu kilitler | tasks_write.py:265 | Yanıt şekli korunur: N giriş, aynı kod, farklı `assignee_user_id` (A9 kararı) |
| Reporting-service task okumaz; dashboard task okumaz | etki haritası | Rework'ün rapor tarafına etkisi yok |
| `work_logs.task_id` yalnız 18 kayıtta dolu | canlı ölçüm | `work_item_id` kolonu eklenir, eski kolon F05'e kadar durur |

## 2. Dondurulmuş şema (02-sema'dan farklar işaretli)

### 2.1 `work_items`
02 §3.1 aynen, şu farklarla:
- **`item_key` = mevcut kod formatı (`TASK-56`, `ISSUE-3`)**, `item_number` = mevcut `type_number`. `PROJ-142` formatı **ertelendi**: 70/70 projede `project_key` boş, dış istemciler mevcut kodları tanıyor; format değişikliği `/v2` işi. (*02'den fark*)
- `legacy_task_ids uuid[]` — birleşen kopyaların eski `tasks.id`'leri (yorum/olay/work_log eşlemesi ve `/core/tasks/{id}` uyumluluğu için).
- `scheduled_date` → `start_date` (NOT NULL değil; taşımada hepsi dolu). (*02'de eşlenmemişti*)
- `sub_project_id` **kalır** (karar 2: alt-proje proje ağacında). (*02 §3.8'in tersi*)
- `is_billable` varsayılanı `projects.is_billable_default`'tan (karar 3); `billable_override_by/at` aynen.
- `parent_id` iki seviye, **servis katmanında** zorlanır (karar 6).
- `origin_type/origin_ref_id` aynen (A6).

### 2.2 `work_item_participants`
02 §3.2 + **`completed_at timestamptz NULL`** (karar: batch'te kişi başı ilerleme) + `note text NULL` (eski `assignee_note`) + `accepted_at` (eski `first_accepted_at`). Owner aynı zamanda `assignee` satırı taşır.

### 2.3 `workflow_states`
02 §3.4 aynen. **Tohum (kiracı başına):** Pending/todo · In Progress/in_progress · Completed/done · Cancelled/cancelled · **Rejected/cancelled** (14 kayıt + canlı reject ucu birebir eşlensin; 02'deki `rejected → Pending` eşlemesi iptal). Varsayılan: Pending. Kategori `done|cancelled` → `closed_at` yazılır (bugün yalnız completed → davranış değişikliği bilinçli; 06 §4).

### 2.4 `work_item_code_aliases` (*yeni*)
`code varchar(50) UNIQUE(tenant), work_item_id`. Batch birleşince kaybolan N-1 kod buraya; `/v1/tasks/{code}` ve arama alias'ı da çözer. Bu tablo olmadan A9 sağlanamaz.

### 2.5 Yorum/olay
`work_item_comments`, `work_item_events` (+`sequence`) **yeni tablo olarak yaratılır, veri kopyalanır**; `task_comments`/`task_activity_events` F05'e kadar dokunulmadan durur (additive ilke). Kopyalanan yorumlar birleşen kopyalardan **tek işe** toplanır (bugün her kopyanın ayrı yorum akışı vardı — birleşme bilinçli).

### 2.6 Görünürlük ve yönlendirme
- `project_memberships`: **taşımadan önce backfill** — her task'ın assignee ve assigner'ı projeye `member` yazılır (`member_role` standardı: `lead|member|viewer`; mevcut 0 satır).
- `routing_relations`: `task_assignment_relations` + `_group_relations` **kopyalanır** (eski tablolar F05'e kadar durur), CHECK `assigner<>assignee` **kalkar** (B4).
- Görünürlük yüklemi (tek fonksiyon): admin ∨ proje üyesi ∨ reporter ∨ owner ∨ participant. Son üçü "kimse iş kaybetmesin" garantisi; F04'te proje üyeliği tek kaynak olur.

### 2.7 `projects.is_billable_default boolean NOT NULL DEFAULT true` (*yeni, karar 3*); Duosis iç projeleri taşımada false (liste: müşteri adı "Duosis" olan projeler — CTO doğrular).

### 2.8 `work_logs.work_item_id uuid NULL` (*yeni kolon*), `task_id`'den eşlenir; `task_id` F05'e kadar durur ve **çift yazılır**.

### 2.9 `saved_views`, `work_item_links` — 02 aynen (links yalnız şema; UI P3).

## 3. Veri taşıma (tek migration, 0010, tekrar koşulabilir)

Sıra: (1) `project_memberships` backfill → (2) `workflow_states` tohum → (3) her `assignment_batch_id` grubu → 1 `work_items` + N participant (`completed_at` = kopyanın `completed_at` if status completed; item state = **bugünkü frontend aggregate kuralı**: hepsi aynıysa o, değilse In Progress; hepsi cancelled/rejected ise Rejected (biri rejected) / Cancelled) → (4) batch'siz → singleton → (5) alias'lar (grubun en küçük `type_number`'ı canonical, diğerleri alias) → (6) yorum/olay kopyası (`legacy_task_ids` üzerinden) → (7) `work_logs.work_item_id` → (8) routing kopyası → (9) doğrulama: kullanıcı başına görünür küme öncesi ⊆ sonrası; `count(work_items) == count(batch'ler) + count(batch'siz)`; alias sayısı = birleşen kopya sayısı. **Doğrulama başarısızsa migration geri alınır (transaction).**

Kanıt: migration hermes-test'in **kopyası** üzerinde önce koşulur (dev'de mevcut değil; test'e terfi öncesi `pg_dump | psql` kopya + koşum + rapor). hermes-test'e dokunma yalnız toplu ff'te ve CD migrate job'uyla.

## 4. Uyumluluk katmanı (A9 — pazarlık dışı)

| Yüzey | Kural |
|---|---|
| `/core/tasks` (internal, frontend) | **Yeni şekil**: satır = iş kalemi, `participants[]`, `state{id,name,category}`, `owner_user_id`, `reporter_user_id`. Eski alanlar türetilmiş olarak da döner (`status` = kategoriye eşlenmiş eski değer, `assignee_user_id` = owner ∨ ilk participant, `assigner_user_id` = reporter, `assignment_batch_id` = `id`, `task_code` = `item_key`) — böylece frontend'in dokunulmayan parçaları çalışmaya devam eder. `/core/tasks/{id}` eski `tasks.id` ile de çözülür (`legacy_task_ids`). |
| `/v1` (public) | **Şekil değişmez.** `PublicTask.assignee_user_id` = owner ∨ ilk participant; `status` eski değer (kategori eşlemesi); `task_code` = `item_key` ∨ alias; `/v1/task-groups` N giriş aynı kod. `PATCH assignee_user_id` → owner değişimi. `POST status action` → state-machine geçişi. |
| MCP | Sözleşme değişmez; uyumluluk matrisi (`pages/developer/mcpClients.js`) 3 "Verified" istemcide yeniden koşulur, koşulmayana Verified denmez. |
| Bildirim e-postaları | `_notif_payload` seam'i yeni modelden beslenir; şablon değişmez. |
| Arşiv/lifecycle | Ham SQL `work_items` üzerine yeniden yazılır; mantıksal grup = iş kaleminin kendisi (batch kavramı biter). |

## 5. Frontend'in P1'deki payı (küçük, F04 değil)

F04 (workspace + saved views + profil) para katmanı sonrası. P1'de yalnız **çalışmaya devam etmesi** için:
- `grouping.js`: mantıksal iş = API'nin verdiği iş kalemi; `assignments[]` = `participants[]` (`status` = `completed_at ? 'completed' : item.status`). Türetme sadeleşir, sayfalama varsayımı biter.
- `useTaskStatusMutation` / `useMultiAssignmentDrop`: hedef `completed` → participant tamamlama ucu; diğer durumlar → iş kalemi durum ucu.
- Pano sütunları ve durum seçenekleri `workflow_states`'ten (kabul ölçütü 4); bugünkü 7 kopya renk/etiket tablosu tek kaynağa iner (`useWorkflowStates`).
- LogTimeModal'a isteğe bağlı iş kalemi seçici (A10).
- TasksPage yerleşimi, explorer, filtreler **değişmez**.

## 6. Faz sırası (her biri ayrı dev commit'i, CTO test eder)

| Adım | İçerik | Kabul |
|---|---|---|
| **P1.1** Şema + taşıma | 0010 migration (§2–3), modeller, taşıma doğrulama raporu; eski uçlar **hâlâ `tasks`'tan** çalışır (gölge). Taşıma modülü tekrar koşulabilir: gölge dönemde `tasks`'a yazılan yeni satırları P1.2 cutover'ında toplar | Migration test kopyasında geçer; rapor: satır sayıları, alias'lar, görünürlük kümesi daralmadı |
| **P1.2** Servis + API geçişi | Internal/public uçlar `work_items`'a; iki serializer; alias çözümü; lifecycle/arşiv SQL; bildirim seam; frontend §5; MCP matrisi | 7 no'lu ölçüt; mevcut core+public+mcp+frontend testleri yeşil (uyumluluk kanıtı) |
| **P1.3** Görünürlük + yetki + bağlar | Proje üyeliği görünürlüğü, routing, B3/B4/B5, A6 (ticket → iş: `origin_*` + "işe dönüştür" ucu), A7 (`parent_id`, links), A8 (`is_billable`), A10 | 2, 3, 6, 8 no'lu ölçütler |
| **F05** (P1 dışı) | Eski tabloların düşürülmesi | Ayrı karar, toplu ff sonrası |

## 7. Riskler
- **Kod alias'ı olmadan A9 kırılır** — alias tablosu P1.1'de gelir.
- **Yorum birleşmesi**: kopyalar ayrı yorum akışı taşıyordu; birleşme geri alınamaz → taşıma raporu yorum sayılarını gösterir.
- **hermes-test verisi**: migration önce kopyada; canlıda yalnız CD migrate job'u; `downgrade` desteklenmez (0007/0008/0009 ile aynı çizgi).
- **Frontend testleri** (`src/test/tasks/**`, 21 dosya; fixture `apiMock.mkTask`) yeni şekle göre güncellenir; `viewParity` ve `featureStructure` kilitleri korunur.
- **Kapsam sızıntısı**: `blocks` pasif; workflow kiracı başına tek; custom field yok.

## 8. Onay istenen seçimler
1. Kod formatı: **`TASK-56` korunur + alias** (öneri) / `PROJ-142` şimdi.
2. Frontend P1 payı: **küçük uyarlama (§5)** (öneri) / hiç dokunma + sahte N-satır uyumluluk.
3. Yorum/olay: **yeni tablo + kopya** (öneri) / eski tabloya `work_item_id` kolonu.
4. Eski tablolar F05'e kadar **durur** (öneri) / P1.2'de düşürülür.
