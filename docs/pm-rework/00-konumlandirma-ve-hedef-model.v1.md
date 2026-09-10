# Hermes PM Rework — Konumlandırma, Teşhis ve Hedef Model

> Durum: **taslak / karar bekliyor**. Vizyon dosyaları paylaşıldıktan sonra §8 kararları kapatılıp `01-hedef-sema.md` ve `02-migration-plani.md` yazılacak.
> Kapsam kararı: veri modeli değişikliği (breaking migration) serbest. Ürün hedefi: satılacak SaaS.
> Kaynak inceleme: `backend/core-service/app/models/*`, `services/task_service.py`, `routers/tasks.py`, `frontend/src/features/tasks/*`, `readme.md` (PRD v1/v2).

---

## 1. Hermes'in sektörel karşılığı

### 1.1 Ürünün bütünü: PSA (Professional Services Automation)

Hermes'in omurgası — `customers → projects → work_logs → billable → utilization → Excel/dashboard` — birebir PSA tanımıdır. PRD v1 "timesheet + raporlama", PRD v2 "billability + verimlilik oranı + RBAC" diyor; bu ikisi PSA olgunluk merdiveninin ilk iki basamağıdır.

Kategori rakipleri: Productive.io, Scoro, Kantata (eski Mavenlink), Teamwork.com, Accelo, Avaza, Harvest+Forecast.

Üzerine `tickets` modülü (support/ITSM) eklenmiş durumda. PSA + hafif ITSM birleşimi Hermes'i MSP/ajans araçlarına (HaloPSA, Atera, SuperOps) yaklaştırıyor. **Bu hibrit konum bir kaza değil, ayrıştırıcı olabilir** — ama ancak üç modül (proje/iş, zaman, ticket) tek bir iş nesnesi etrafında birleşirse.

### 1.2 PM/Task modülünün olması gereken karşılığı

PSA içinde bu katmanın adı **delivery layer / work management**'tır: satılan işin (project) fiilen nasıl parçalanıp yürütüldüğü. Sağlıklı bir PSA'da bu katman, work management ürünlerinin (Linear, Jira, Asana) sadeleştirilmiş bir versiyonudur ve zaman/bütçe verisiyle aynı nesne üzerinden buluşur.

### 1.3 Hermes'in şu anki karşılığı (farklı bir şey)

Mevcut `tasks` modülü work management değil, **delegated task tracking / assignment hierarchy** — yani "kim kime iş verdi" grafiği. Endüstrideki en yakın karşılıkları:

- Microsoft Planner / Google Tasks seviyesinde kişisel görev atama,
- ERP ve ITSM'lerdeki "workflow task" nesnesi (bir kişiye düşen aksiyon kalemi),
- klasik "iş emri / talimat takibi" yazılımları.

Bunun bağımsız bir ürün kategorisi yok; hep başka bir sistemin içinde yaşayan yardımcı bir mekanizma. **Hermes'in PM tarafının "yapısal olarak doğru çalışmıyor" hissi tam olarak buradan geliyor: work management bekleniyor, delegation tracking teslim ediliyor.**

---

## 2. Teşhis — yapısal kırıklar (kod kanıtlı)

### K1. Task bir nesne (node) değil, bir kenar (edge)

```
tasks.assignee_user_id  UUID NOT NULL
tasks.assigner_user_id  UUID NOT NULL
```

Bir task, "atayan → atanan" ikilisi olmadan var olamıyor. Sonuç:

- **Çoklu atama = işin N kopyası.** `create_tasks_bulk` / `create_tasks_for_group` aynı işi her assignee için ayrı satır olarak yazıyor, sonra `assignment_batch_id` ile işaretliyor.
- **"Logical work item" kavramı veritabanında yok.** Frontend'de `features/tasks/model/grouping.js` bu kopyaları client tarafında birleştiriyor. Dosyanın kendi yorumu bunu itiraf ediyor: gruplama, `/core/tasks` ucunun **sayfalama yapmaması** varsayımına dayanıyor; sayfalama gelirse türetme geçersizleşiyor.
- Bu, ölçeklenebilir bir SaaS için taşınamaz bir varsayım.

Senin ifadenle: *"task bir object olarak var olsun, kişiler ona atansın"* isteniyor; sistem ise *"task bir user'dan çıkar, başka bir user'a bağlanır"* diyor. Teşhis doğru ve şemanın kendisinde.

### K2. Görünürlük proje değil, kişi grafiği üzerinden

`task_service.list_tasks_for_user`:

```python
query.filter(or_(Task.assignee_user_id == me, Task.assigner_user_id == me))
```

Admin değilsen bir işi ancak sana atandıysa veya sen atadıysan görürsün. Dolayısıyla:

- Proje ekibi projenin işlerini göremez. **Proje bir konteyner değil, sadece bir etiket.**
- `project_memberships` tablosu mevcut ama task tarafında **hiç kullanılmıyor** — yetki `task_assignment_relations(assigner_user_id → assignee_user_id)` üzerinden yürüyor. Bu bir org şeması; proje RBAC'i değil.
- Bir iş devredilirse (assignee değişirse) eski assignee işi tamamen kaybeder; tarih ve bağlam kişiyle birlikte gider.

### K3. Üç paralel iş nesnesi, isimleri de çakışıyor

| Tablo | Neye bağlı | Gerçek işlevi |
|---|---|---|
| `issues` | `project_id`, `issue_key` (HER-123) | Sadece work_log etiketleme; lifecycle yok, atama yok |
| `tasks` | customer+project+sub_project, `task_type ∈ (task, issue, suggestion)` | Asıl iş nesnesi ama delegation modelinde |
| `tickets` | support modülü | Dış talep; work item'a dönüşme yolu yok |

`issues.issue_key` ve `tasks.task_type='issue'` aynı kelimeyi iki farklı şey için kullanıyor. Bir kullanıcı "issue" derken neyi kastettiğini bilemez.

### K4. Hiyerarşi veri değil, klasör

`customer → project → task_sub_project` bir gezinme ağacı (`features/tasks/model/hierarchy.js`). Work item'ın **kendi** hiyerarşisi yok: parent/child (epic → subtask) yok, `blocks/relates` bağı yok. Dolayısıyla "büyük iş"i parçalama, ilerleme rollup'ı ve bağımlılık görünürlüğü imkânsız.

### K5. Statü sabit enum, workflow konfigüre edilemiyor

`CHECK (status IN ('pending','in_progress','completed','cancelled','rejected'))` — üstelik `rejected` üründen kaldırılmış ama DB'de duruyor; frontend `normalizeStatus` bilinmeyeni `pending`e düşürüyor. Satılacak bir SaaS'ta her tenant'ın kendi akışı olur; sabit enum bunu baştan kapatıyor.

### K6. PSA ile PM arasındaki asıl köprü zayıf

`work_logs.task_id` opsiyonel bir FK. `tasks.estimated_duration_minutes` var ama **tahmin ↔ gerçekleşen ↔ faturalanabilir** üçlüsü work item'ın birinci sınıf verisi değil. Hâlbuki Hermes'in Linear/Jira karşısındaki tek gerçek üstünlüğü tam olarak burası olabilir.

### K7. Arayüz: "view" yok, filtre kombinasyonu var

`TasksPage` üzerinde aynı veri için beş bağımsız eksen: layout (explorer/board/list) × scope (my-tasks / assigned-by-me) × task_type (task/issue/suggestion) × range mode (all/week) × quick filter (due-this-week/overdue/completed-this-week) + filtre çekmecesi. Sonuç:

- Kullanıcı nerede olduğunu bilemez, aynı ekrana iki farklı yoldan ulaşır.
- Durum paylaşılamaz, kaydedilemez ("şu görünüme bak" denemiyor).
- Explorer varsayılan; ama board da var, list de var — hangisi "asıl" belli değil.

`components/tasks` + `features/tasks` altında ~3.700 satır JSX bu beş eksenin kombinasyonlarını yönetiyor. Karmaşıklığın kaynağı UI değil, **altında yatan modelin ekranı zorlaması**.

---

## 3. Hedef model

### 3.1 İlke cümlesi

> **Work item bir nesnedir. Bir projeye aittir. Kişiler ona atanır. Görünürlük proje üyeliğinden gelir. Zaman kaydı ona yapışır.**

Bu tek cümle K1–K6'yı kapatır.

### 3.2 Hedef şema (taslak)

```
work_items
  id, tenant_id
  project_id            NOT NULL   -- konteyner; sahip burası
  parent_id             NULL       -- 2 seviye: parent → child (daha derini yasak)
  item_key              -- PROJ-123 (project.project_key + per-project sequence)
  item_type_id          -- task | issue | suggestion | ... (tenant konfigüre)
  title, description
  state_id              -- workflow_states FK (sabit enum DEĞİL)
  priority
  reporter_user_id      NOT NULL   -- işi açan (assigner'ın yerini alır, sahiplik iddiası yok)
  owner_user_id         NULL       -- tek sorumlu; NULL = triage kuyruğunda
  estimate_minutes, start_date, due_date
  closed_at, archived_at, archive_reason
  created_at, updated_at

work_item_participants        -- çoklu atama artık KOPYA değil, SATIR
  work_item_id, user_id, role ∈ (assignee | reviewer | watcher)
  UNIQUE(work_item_id, user_id, role)

work_item_links
  from_id, to_id, link_type ∈ (blocks | relates | duplicates)

workflow_states               -- tenant (v1) → proje (v2) seviyesinde
  id, tenant_id, name, category ∈ (todo | in_progress | done | cancelled), position

work_item_comments            -- mevcut task_comments'in devamı
work_item_events              -- mevcut task_activity_events'in devamı

project_memberships           -- MEVCUT TABLO, artık gerçekten kullanılacak
  project_id, user_id, member_role ∈ (lead | member | viewer)

saved_views                   -- 5 eksenli kontrol panelinin yerine
  id, tenant_id, owner_user_id NULL, name, scope ∈ (personal|shared), filter_json, layout
```

**Emekliye ayrılacaklar:** `tasks`, `task_sub_projects`, `issues`, `task_assignment_relations`, `task_assignment_group_relations`, `task_user_permissions`, `task_group_permissions`, `task_group_member_overrides`.

### 3.3 Kritik model kararları ve gerekçeleri

| Karar | Gerekçe |
|---|---|
| `project_id` NOT NULL | İşin bir evi olmalı. "No project" sanal klasörü modelin eksikliğinin belirtisiydi. |
| `owner_user_id` NULL olabilir | Atanmamış iş kaybolmaz, **triage** kuyruğuna düşer. Bugün `assignee NOT NULL` olduğu için "kimse üstlenmemiş iş" kavramı yok. |
| `reporter` ≠ yetki kaynağı | Bugün assigner düzenleme yetkisinin sahibi (`_user_can_edit_core`). Hedefte yetki proje rolünden gelir; reporter sadece bir alan. |
| Çoklu atama participant satırıyla | Grup fan-out'u artık N kopya üretmez; `assignment_batch_id` + client-side grouping tamamen kalkar. |
| Statü tablo, enum değil | Tenant'a göre akış; kategori (todo/in_progress/done/cancelled) rapor ve board için sabit kalır. |
| `sub_project` → `parent_id` | Ayrı bir tablo yerine work item hiyerarşisi. Klasör derinliği yerine iş kırılımı. |
| `issues` → `work_items(type=issue)` | İki paralel nesne birleşir; `work_logs.issue_id` → `work_item_id`. |

### 3.4 Hermes'in ayrıştırıcısı: work item ↔ zaman

Her work item detayında birinci sınıf blok:

```
Estimate 6.0h   ·   Logged 4.5h   ·   Billable 4.0h   ·   Remaining 1.5h
```

Proje seviyesinde bunun toplamı doğrudan PSA raporlamasını besler (bütçe tüketimi, verimlilik). Linear'da bu yok; Jira'da eklenti ister; PSA ürünlerinde work management tarafı zayıftır. **Hermes'in kategori içindeki cümlesi budur: "işi yönettiğin yer, saati de yazdığın yer."**

---

## 4. Arayüz / bilgi mimarisi reworku

### 4.1 Tek omurga: Project Workspace

```
┌──────────────┬──────────────────────────────────┬───────────────┐
│ Sol kolon    │ Orta: seçili view                │ Sağ: detay    │
│              │                                  │               │
│ Views        │ [Board] [List] [Timeline]        │ PROJ-142      │
│  · My work   │  ─────────────────────────────   │ Başlık        │
│  · Triage    │  To Do │ In Prog │ Review │ Done │ Durum/Öncelik │
│  · Overdue   │   ▢ ▢  │   ▢     │   ▢    │  ▢   │ Owner + kişiler│
│  · (saved)   │                                  │ Est/Logged    │
│ ──────────   │                                  │ Yorum/aktivite│
│ Projeler ▸   │                                  │               │
└──────────────┴──────────────────────────────────┴───────────────┘
```

### 4.2 Beş eksenin karşılığı

| Bugün | Hedef |
|---|---|
| scope: my-tasks / assigned-by-me | Saved view: "My work" (owner=me), "Reported by me" |
| task_type sekmeleri | View filtresi (item_type), varsayılan hepsi |
| range mode (all/week) | View filtresi (due date), varsayılan yok |
| quick filters | Hazır (system) saved view'lar |
| layout (explorer/board/list) | View'ın bir özelliği — view seçilince layout da gelir |
| explorer ağacı | Sol kolondaki proje ağacı (gezinme), iş listesi değil |

Kural: **Ekranın durumu = seçili view.** Kullanıcı filtreleri değiştirdiğinde "Save as new view" çıkar. Paylaşılabilir, linklenebilir, tekrar açılabilir.

### 4.3 Diğer UI kararları

- Board sütunları `workflow_states` — sabit dört sütun değil.
- Detay bir **panel**, ama `/work/PROJ-142` ile derin linklenebilir olmalı (bugün task'a link atılamıyor).
- Triage: `owner_user_id IS NULL` olan işler için ayrı, kalıcı bir kuyruk (Linear'dan alınacak en değerli tek şey).
- Klavye: `c` yeni item, `/` arama, `j/k` gezinme. Ajans/danışmanlık ekiplerinde günde 20+ kayıt giren kullanıcı için hız = benimseme.

---

## 5. Referans sistemler — neyi alacağız, neyi almayacağız

| Sistem | Alınacak | Alınmayacak |
|---|---|---|
| **Linear** | Nesne modeli (workspace → team/project → issue), triage kuyruğu, saved views, klavye-öncelikli hız, az ama net konfigürasyon | Cycles/sprint, initiatives, otomasyon motoru |
| **Jira** | Work item hiyerarşisi (parent → child), proje anahtarı + per-proje numaralandırma (Hermes'te `project_key` ve `type_number` zaten var), state **kategorisi** kavramı | Permission scheme / issue scheme karmaşası, custom field builder |
| **Azure DevOps** | State category → rapor eşlemesi, sorgu/saved view mantığı | Ölçek ve konfigürasyon yüzeyi |
| **Asana** | "Bir işin tek evi olur" dersi (multi-homing'in yarattığı karmaşadan kaçınma) | Portfolios, goals |
| **Height / Shortcut** | Minimum konfigürasyonla çalışan workflow | — |
| **Productive.io / Scoro** (PSA) | Project → budget → logged → billable zincirinin work item'a bağlanma biçimi; utilization raporu | Full CRM, faturalama entegrasyonları (v3+) |
| **Jira Service Management** | Ticket → work item dönüşümü (Hermes'te `tickets` var, bağlanmalı) | SLA motoru (şimdilik) |

En yakın bileşim: **Linear'ın nesne modeli + PSA'nın proje/müşteri/zaman omurgası.** Hermes'in kendi cümlesi bu ikisinin kesişiminde.

---

## 6. Kapsam koruması — bu rework'te YAPILMAYACAKLAR

Ölçek büyütmemek için açıkça dışarıda:

- Gantt / timeline bağımlılık kritik yolu (Timeline görünümü basit tarih şeridi olarak kalabilir)
- Kaynak planlama, kapasite tahminleme (forecasting)
- Custom field builder
- Otomasyon kuralı motoru (if-this-then-that)
- Sprint / velocity / story point
- Wiki (PRD v2'de var; PM rework'ünün parçası değil, ayrı iş)
- Çoklu workflow şeması per proje (v1'de tenant seviyesi tek şema yeterli)

---

## 7. Migration planı (faz faz)

**Faz 0 — Karar dondurma.** Bu doküman + vizyon dosyaları → §8 kararları kapanır, `01-hedef-sema.md` yazılır.

**Faz 1 — Şema + tek seferlik taşıma.**
`work_items`, `work_item_participants`, `work_item_links`, `workflow_states`, `saved_views` oluşturulur.
Taşıma kuralı: her `assignment_batch_id` grubu → **1** `work_item` + **N** `work_item_participants(role=assignee)`; `batch_id IS NULL` olan satır → singleton work item. `assigner_user_id` → `reporter_user_id`. `status` → karşılık gelen `workflow_states` satırı. Yorum ve aktivite kayıtları yeni id'ye remap edilir. **Veri kaybı yok, tahmin yok** — batch_id zaten kalıcı ve kesin bir kimlik.

**Faz 2 — Görünürlük anahtarını çevir.**
`assignee OR assigner` filtresi → `project_memberships` tabanlı görünürlük. Backfill: her mevcut task'ın assignee ve assigner'ı, ilgili projeye `member` olarak yazılır. Böylece geçiş anında kimse bir işi kaybetmez. `task_assignment_relations` yalnızca **atama hakkı** için bir süre daha okunur, sonra tenant RBAC rolüne devredilir.

**Faz 3 — `issues` birleştirme.**
`issues` → `work_items(item_type=issue)`; `work_logs.issue_id` → `work_item_id`. `issue_key_manual` alanı korunur.

**Faz 4 — UI.**
Project workspace + saved views. `TasksPage` ve `features/tasks` ağacı emekli; `grouping.js` tamamen silinir (gruplama artık DB'de).

**Faz 5 — Temizlik.** Eski tabloların drop'u; `assignment_batch_id` mirası kaldırılır.

### Risk noktaları

- **Public API sözleşmesi:** `public_api/routers/tasks.py`, `tasks_write.py` ve `POST /v1/task-groups` dışarı açık; MCP sunucusu da tüketiyor (`hermes_mcp_server_design.md`). Faz 1–3 boyunca `/v1` uyumluluk shim'i (work_item → eski task şekli) şart.
- **Migration sırası:** `sql_scripts/migrations` sıra bağımlı; paralel ajan bu fazlarda migration yazmamalı (AGENTS.md kırmızı çizgisi).
- **Tenant cutover ile çakışma:** `HERMES_TENANT_CUTOVER_EVIDENCE.md` akışı bitmeden şema rework'ü başlatılmamalı.

---

## 8. Açık kararlar (senin vermen gerekenler)

1. **Sahiplik modeli:** tek `owner` + çoklu `participant` mi, yoksa tamamen çoklu assignee mi? (Öneri: tek owner — hesap verebilirlik; grup ihtiyacı participant ile karşılanır.)
2. **`sub_project` kaderi:** proje ağacında ikinci seviye olarak mı kalsın, yoksa work item `parent_id`'sine mi dönüşsün? (Öneri: work item parent'ı; proje ağacı customer → project ile bitsin.)
3. **Ticket ↔ work item:** bir support ticket'ından work item doğabilmeli mi? (Öneri: evet, tek yönlü "convert" + link.)
4. **Workflow states:** v1'de tenant başına tek şema mı, proje bazlı mı? (Öneri: tenant başına tek.)
5. **`item_type` kataloğu:** task/issue/suggestion sabit mi kalsın, tenant konfigüre mi olsun? (Öneri: v1 sabit, şema konfigüre edilebilir olsun.)
6. **Zaman bloğu zorunluluğu:** work item kapanırken zaman kaydı zorunlu mu? (PSA disiplini için güçlü bir kanca; ürünsel karar.)

---

## Kaynaklar

- Linear — Concepts / conceptual model: https://linear.app/docs/conceptual-model
- Linear — Assign and delegate issues: https://linear.app/docs/assigning-issues
- Atlassian — What Are Jira Work Items (hiyerarşi ve alanlar): https://www.atlassian.com/software/jira/guides/issues/overview
- Atlassian — Configure the work type hierarchy: https://support.atlassian.com/jira-cloud-administration/docs/configure-the-issue-type-hierarchy/
- Productive.io — Best PSA Software (kategori tanımı ve rakip seti): https://productive.io/blog/best-psa-software/
- Scoro — PSA software examples: https://www.scoro.com/blog/psa-software-examples/
