# Hermes PM Rework — Konumlandırma, Teşhis ve Hedef Model

**v2 · 09.09.2026 · vizyon dosyalarıyla hizalandı.**
v1 (`00-...v1.md`) strateji dokümanları okunmadan yazıldı; bu sürüm onun yerini alır.

Kaynaklar: `readme.md` (PRD v1/v2) · `backend/core-service` (modeller, `task_service.py`, `ticketing.py`) ·
`frontend/src/features/tasks` · `duo-business-strategy/Hermes/Hermes-Nis-Strateji.docx` (12 Tem 2026, v2) ·
`_kaynak/Hermes-Rakip-Analizi.md` (28 Tem 2026).

> **Strateji dokümanları bayat.** Yazıldıklarından bu yana çok-kiracılık (tenant cutover) ve
> **ticket hub'ı** koda girdi; ikisi de o dokümanlarda "yok" diye işaretli. Bu doküman kod
> gerçeğini esas alır, strateji kararlarını (kimlik, niş, sıra) geçerli sayar. Strateji
> dosyalarının güncellenmesi ayrı bir iş.

---

## 0. Vizyondan gelen kilitler — v1'de ne değişti

Strateji dokümanları üç kararı kilitlemiş; PM rework'ü bunların **içinde** kalmak zorunda:

| Kilit | Kaynak | Rework'e etkisi |
|---|---|---|
| Kimlik = **faturalandırılabilir iş yönetimi**, vaat = "saatten faturaya" | Niş-Strateji §2 | Hedef nesnenin adı ve alanları buna göre belirlenir |
| **"Hermes ne proje yönetimidir ne görev yönetimi"** | Niş-Strateji §2 | Work-management parite hedefi düşer. Ama madde üçü tek torbaya koyuyor — §6'da kademelendirildi |
| Sıra kutsal: **1 para katmanı · 2 e-fatura · 3 timer · 4 utilization/kârlılık · 5 çok-kiracılık** | Rakip-Analizi §8 | PM rework bu listede **yok** — kendini bu sıranın önüne koyamaz, §7'ye bak |
| Tek kod tabanı + **iki konumlandırma** (MSP modu / Ajans modu), profil anahtarı | Niş-Strateji §7 | Konfigüre edilebilir durum/terminoloji katmanı artık bir **gereksinim**, süs değil |
| Land = MSP/IT + Ajans; Expand = hukuk/muhasebe | Niş-Strateji §6 | MSP dili ticket/iş emri, ajans dili proje/görev — **aynı nesne** iki dilde görünmeli |

**v1'e göre üç düzeltme:**

1. v1, hedefi "Linear benzeri work management katmanı" diye kurmuştu. **Yanlış çerçeve.** Vizyon
   work management'ı açıkça reddediyor. Doğru çerçeve: iş kalemi, **talep → iş → saat → fatura**
   omurgasının ortadaki halkasıdır. Jira'ya benzemek hedef değil; faturaya bağlanmak hedef.
2. v1, `task_assignment_relations`'ı tamamen emekli ediyordu. **Fazla agresif.** Rakip-Analizi §5.3
   bu hiyerarşiyi "ticket'a giden yolun yarısı" sayıyor. Doğru hamle: onu *görünürlük kaynağı*
   olmaktan çıkarıp *yönlendirme (routing) politikası* olarak korumak — ticket dispatcher'ın
   zaten ihtiyacı olan şey bu.
3. v1, `tickets` modülünü yalnızca "bağlanmalı" diye geçmişti. Oysa ticketing **tasks'tan daha iyi
   yazılmış**: durum makinesi ayrı serviste, olay + outbox, görünürlük politikası ayrı modülde,
   grup ataması ve resolution nesnesi var. Rework yeni bir disiplin icat etmemeli — **ticketing'de
   kanıtlanmış disipline yakınsamalı**.

---

## 1. Sektörel karşılık

### 1.1 Ürünün bütünü

Hermes'in omurgası — müşteri → proje → work_log → billable → utilization → rapor — **PSA**
(Professional Services Automation) tanımıdır. Vizyonun kendi adlandırması bunun daha dar ve daha
satılabilir hâli: **faturalandırılabilir iş yönetimi**. Rakip set iki kuşak:

- **Doğrudan (ajans):** Harvest (fiyat güveni çökmüş), Toggl, Productive.io (kârlılıkta önde,
  asıl rakip), Scoro, Teamwork, Jira+Tempo.
- **Doğrudan (MSP):** HaloPSA, Syncro, Atera, ConnectWise, Autotask — teknisyen başına $65–179/ay.

### 1.2 PM/Task modülünün karşılığı

PSA literatüründe bu katmanın adı **delivery layer / work management**'tır. Ama Hermes'te satılacak
adı bu değil: burası **faturalandırılabilir iş kaleminin** yaşadığı yer. Modülün varlık sebebi
Jira'yla yarışmak değil; **saatin bağlanacağı, faturanın türetileceği iş nesnesini tutmak.**

Rakip-Analizi §7.1 bunu Hermes'in bugün gerçek olan üç üstünlüğünden biri sayıyor: *"iş takibi +
zaman aynı üründe — Harvest ve Toggl bunu yapmaz."* Yani modül bir yük değil, **satış argümanı**.
Kırık olan şey argümanın kendisi değil, altındaki şema.

### 1.3 Şu anki hâlinin karşılığı

Mevcut `tasks` modülü ne work management ne de faturalandırılabilir iş kalemi. Karşılığı
**delegated task tracking** — "kim kime iş verdi" grafiği. Endüstride bağımsız kategorisi yok;
MS Planner seviyesi görev atama ya da ERP/ITSM içindeki "workflow task" olarak yaşar.

**Sonuç:** modül, iş takibi argümanını taşıyabilecek kadar sağlam değil; ve para katmanı geldiğinde
tutunacağı bir nesne yok.

---

## 2. Teşhis — yapısal kırıklar

Kök neden tek satırda: `assignee_user_id NOT NULL` + `assigner_user_id NOT NULL`. **Task bir nesne
değil, iki kişi arasındaki bir kenar.**

| # | Kırık | Kanıt / sonuç |
|---|---|---|
| **K1** | Task bir kenar, nesne değil | Çoklu atama işin N kopyası olarak yazılıyor; "logical work item" yalnızca frontend'de `grouping.js` içinde türetiliyor. Dosyanın kendi yorumu türetmenin `/core/tasks`'ın **sayfalamamasına** bağlı olduğunu söylüyor — satılacak SaaS'ta taşınamaz. |
| **K2** | Görünürlük proje değil, kişi grafiği | `list_tasks_for_user` → `assignee == me OR assigner == me`. Proje ekibi projenin işini göremiyor; **proje bir konteyner değil, etiket.** `project_memberships` tablosu var, task tarafında hiç kullanılmıyor. |
| **K3** | **Dört** paralel iş nesnesi | `issues` (sadece work_log etiketleme) · `tasks` (`task_type ∈ task/issue/suggestion`) · `tickets` (ürünler arası hub) · `plan_times`. "Issue" kelimesi ikisinde iki farklı şey. |
| **K4** | Hiyerarşi veri değil, klasör | `customer → project → sub_project` bir gezinme ağacı. Work item'ın kendi parent/child'ı yok → büyük işi parçalama ve ilerleme rollup'ı yok. |
| **K5** | Statü sabit enum | `CHECK (status IN (...))`; `rejected` üründen kalkmış ama DB'de duruyor. **Profil anahtarı (MSP/Ajans) bu enum'la imkânsız** — vizyonun mimari kararı şemaya çarpıyor. |
| **K6** | Para omurgası kopuk | `work_logs.task_id` opsiyonel FK; `estimated_duration_minutes` var ama tahmin ↔ gerçekleşen ↔ faturalanabilir üçlüsü iş kaleminin birinci sınıf verisi değil. Para katmanı geldiğinde **tutunacak nesne yok**. |
| **K7** | UI'da "view" yok, filtre kombinasyonu var | layout × scope × tip × zaman aralığı × hızlı filtre = beş bağımsız eksen. Durum paylaşılamıyor, kaydedilemiyor; ~3.700 satır JSX bu kombinasyonları yönetiyor. |
| **K8** | Ticketing daha iyi yazılmış, tasks ondan geride | `tickets`: ayrı durum makinesi servisi, olay + outbox, görünürlük politikası modülü, grup ataması, resolution revizyonu. `tasks`: bunların hiçbiri. İki nesne yakınsamak yerine ayrışıyor. |

**Ve asıl kırık, listede olmayan:** vizyonun "tek omurga" dediği zincir — **talep → faturalandırılabilir
iş → fatura** — kodda kurulu değil. Ticket'tan işe geçiş yok, işten faturaya geçiş yok, ortadaki
nesne de sağlam değil.

---

## 3. Hedef model

### 3.1 İlke cümlesi

> **İş kalemi bir nesnedir. Bir projeye aittir. Kişiler ona atanır. Bir talepten doğabilir.
> Saat ona yazılır, fatura ondan türer.**

İlk dört cümle K1–K5'i, son cümle K6 ve K8'i kapatıyor.

### 3.2 Şema

```
work_items                       -- ürün dilinde "iş kalemi"
  id, tenant_id
  project_id            NOT NULL   -- konteyner; sahip burası
  parent_id             NULL       -- 2 seviye: parent → child, daha derini yasak
  item_key                         -- PROJ-142 (project_key + per-project sequence)
  item_type_id                     -- task | issue | suggestion (profil diline göre etiketlenir)
  title, description
  state_id                         -- workflow_states FK; sabit enum DEĞİL
  priority
  reporter_user_id      NOT NULL   -- işi açan; sahiplik iddiası yok
  owner_user_id         NULL       -- tek sorumlu; NULL = triage kuyruğu
  estimate_minutes, start_date, due_date, closed_at, archived_at

  -- PARA OMURGASI (v1'de yoktu; vizyonun kimliği bunu zorunlu kılıyor)
  is_billable           NOT NULL   -- proje/iş tipi varsayılanından türer, override edilebilir
  billable_override_by  NULL       -- PRD v2 FR 1.2 onay akışının bağlanacağı yer
  origin_type           NULL       -- ticket | meeting | manual
  origin_ref_id         NULL       -- ticket'tan doğan iş: zincirin ilk halkası

work_item_participants           -- çoklu atama artık KOPYA değil, SATIR
  work_item_id, user_id, role ∈ (assignee | reviewer | watcher)

work_item_links                  -- relates | duplicates | blocks
                                 -- blocks: görsel + filtre; OTOMATİK TARİH ETKİSİ YOK (§6.1)
workflow_states                  -- id, name, category ∈ (todo|in_progress|done|cancelled), position
                                 -- profil anahtarının (MSP/Ajans) taşıyıcısı
work_item_comments · work_item_events    -- ticketing'deki outbox disiplinine yakınsar
project_memberships              -- MEVCUT tablo, artık gerçekten kullanılacak (lead|member|viewer)
routing_relations                -- eski task_assignment_relations; artık GÖRÜNÜRLÜK değil,
                                 -- "kim kime iş yönlendirebilir" politikası. Ticket dispatcher da bunu okur.
saved_views                      -- beş eksenli kontrol panelinin yerine
```

**Emekli:** `tasks` · `task_sub_projects` · `issues` · `task_user_permissions` ·
`task_group_permissions` · `task_group_member_overrides`.
**Dönüşen (emekli değil):** `task_assignment_relations` + `..._group_relations` → `routing_relations`.

### 3.3 Kararlar ve gerekçeleri

| Karar | Gerekçe |
|---|---|
| `project_id` NOT NULL | İşin bir evi olmalı. "No project" sanal klasörü, modelin eksikliğinin belirtisiydi. |
| `owner_user_id` NULL olabilir | Atanmamış iş kaybolmaz, **triage** kuyruğuna düşer. Bugün `assignee NOT NULL` olduğu için "kimse üstlenmemiş iş" kavramı yok — ticket akışında bu zorunlu. |
| reporter ≠ yetki kaynağı | Bugün assigner düzenleme yetkisinin sahibi (`_user_can_edit_core`). Hedefte yetki proje rolünden gelir. |
| Çoklu atama = participant satırı | Grup fan-out'u N kopya üretmez; `assignment_batch_id` ve client-side gruplama tamamen kalkar. |
| Statü tablo, enum değil | Profil anahtarı (MSP/Ajans) bunsuz kurulamaz. Kategori (todo/in_progress/done/cancelled) rapor için sabit kalır. |
| `sub_project` → `parent_id` | Klasör derinliği değil, iş kırılımı. |
| `issues` → `work_items` | İki paralel nesne birleşir; `work_logs.issue_id → work_item_id`. |
| `is_billable` iş kaleminde | PRD v2 FR 1.1/1.2 (otomatik atama + PL onayı) bugün yalnızca work_log'da. İş kaleminde olması, para katmanının tutunacağı yer demek. |
| `origin_type/ref` | Vizyonun "tek omurga"sının kodda karşılığı: ticket → iş → saat → fatura. |
| `blocks` var, ama pasif | Bağ görsel ve filtrelenebilir; tarih kaydırma motoru yok. Sınır §6.1'de yazılı. |

### 3.4 Ayrıştırıcı: iş kalemi ↔ para

İş kalemi detayında birinci sınıf blok — para katmanı geldiğinde buraya oturur:

```
Estimate 6.0h  ·  Logged 4.5h  ·  Billable 4.0h  ·  Tutar ₺—  ·  Kalan 1.5h
```

Proje seviyesinde toplamı doğrudan utilization ve kârlılık ekranını besler (Rakip-Analizi §8, madde 4:
*"1 ve 2 bitince neredeyse bedava gelir"* — ancak altındaki nesne düzgünse bedava gelir).

---

## 4. Arayüz ve bilgi mimarisi

Tek omurga: **Project workspace.** Sol kolon gezinme + view'lar, orta kolon seçili view, sağ kolon
iş kalemi detayı. **Ekranın durumu = seçili view**; filtre değişince "Yeni view olarak kaydet".

| Bugün | Hedef |
|---|---|
| scope: my-tasks / assigned-by-me | Saved view: "Bana ait işler" (owner = me), "Açtıklarım" (reporter = me) |
| task_type sekmeleri | View filtresi; varsayılan hepsi |
| range mode (all/week) | View filtresi (termin) |
| quick filters | Hazır (system) view'lar |
| layout (explorer/board/list) | View'ın bir özelliği |
| explorer ağacı | Sol kolondaki proje ağacı: gezinme, iş listesi değil |

**Profil katmanı (vizyonun mimari kararı, UI'daki karşılığı):** aynı ekran, profile göre farklı
etiket ve varsayılan view.

| Kavram | MSP modu | Ajans modu |
|---|---|---|
| Nesne adı | İş emri / ticket | İş kalemi / görev |
| Varsayılan view | Kuyruk + ilk yanıt süresi | Proje panosu + termin |
| Detayda öne çıkan | Talep kaynağı, çözüm | Faturalandırılabilir saat, tutar |

Diğer kararlar: **triage** kalıcı bir kuyruk (`owner IS NULL`); detay panel ama `/work/PROJ-142`
ile derin linklenebilir; klavye kısayolları (`c` yeni, `/` ara, `j/k` gezin).

---

## 5. Referans sistemler

| Sistem | Alınacak | Alınmayacak |
|---|---|---|
| **Linear** | Nesne modeli (proje → iş kalemi), triage kuyruğu, saved views, az ama net konfigürasyon | Cycles/sprint, initiatives, otomasyon motoru — **vizyon bunları reddediyor** |
| **Jira** | Parent → child, proje anahtarı + numaralandırma (`project_key`/`type_number` zaten var), state **kategorisi** | Permission scheme karmaşası, custom field builder, gantt |
| **Harvest** | Zaman girişinin işe yapışma biçimi, timer alışkanlığı | Faturalama derinliği (bizde e-fatura yolu farklı), kullanım bazlı fiyat |
| **Productive.io** | Proje → bütçe → logged → billable → kârlılık zincirinin nesneye bağlanması — **asıl rakip burada** | Kaynak planlama, gelir tahmini (kapsam dışı) |
| **HaloPSA** | Ticket → iş → zaman → servis faturası akışının şekli (MSP modu için) | SLA motoru, RMM |
| **Hermes'in kendi `tickets` modülü** | Durum makinesi servisi, olay + outbox, görünürlük politikası modülü, grup ataması | — (bu iç referans, dış değil) |

**En yakın bileşim:** Linear'ın nesne disiplini + Productive'in para zinciri + Hermes'in kendi
ticketing disiplini.

---

## 6. Kapsam — kademeli, düz yasak değil

Vizyon dokümanı "gantt / bağımlılık / sprint" üçünü tek maddede topluyor. Bunlar maliyet ve risk
olarak birbirinden çok farklı şeyler; aynı torbaya koymak fazla agresif. Kademelendiriyoruz.

| Yetenek | Karar | Gerekçe |
|---|---|---|
| **Bağımlılık bağı** (`blocks`) | **Evet** — görsel + filtrelenebilir, **otomatik tarih etkisi YOK** | Şema maliyeti sıfır (link tablosu zaten var). MSP ve ajansta gerçek ihtiyaç ("müşteriden dosya bekliyoruz"). |
| **Read-only timeline şeridi** | **Evet** — F04 ile | `start_date → due_date` çizmek gantt değil. Sürükle-bırak yoksa motor da yok. |
| **İnteraktif gantt · kritik yol** | **Hayır** | Konumlandırma kararı, kapasite kararı değil — §6.2. |
| **Sprint · velocity · story point** | **Hayır** | İkinci bir zaman para birimi yaratır — §6.3. |
| Kaynak planlama · forecasting | Hayır | Kapsam ve kapasite. |
| Custom field builder · otomasyon kuralı motoru | Hayır | Konfigürasyon yüzeyini patlatır (K7'nin kaynağı). |
| Proje bazlı çoklu workflow şeması | v1'de hayır | Tenant başına tek şema yeterli. |
| Wiki | Ayrı iş | PRD v2 FR 5.0; PM rework'ün parçası değil. |

### 6.1 Bağımlılık — ucuz olan, ama sınırı yazılı olmalı

Şema maliyeti bir `link_type` değeri. Gerçek maliyet semantikte:

- **Döngü kontrolü** serviste yazılmalı (A blocks B blocks A); DB constraint'iyle çözülmez, graf yürümek gerekir.
- **Blocked bir durum değil, bir koşuldur.** `workflow_states`'e sokulursa şema kirlenir; rozet olarak
  gösterilmeli. Rozet de filtre eksenine bir tane daha ekler — K7 zaten oradan şikâyetçi.
- **Asıl tuzak beklenti:** bağımlılık gösterirsen kullanıcı otomatik tarih kaydırması bekler
  ("A gecikti, B kaysın"). O davranış eklendiği an gantt'ın motoru yazılmış olur: lag/lead,
  SS/FF/SF kısıt tipleri, çalışma takvimi, tatil günleri.

**Kural:** bağ görsel ve filtrelenebilir; hiçbir otomatik tarih etkisi yok. Bu sınır yazılı olmazsa
2 günlük iş 3 haftaya döner.

### 6.2 Gantt — sorun teknik değil, rakip ekseni

Gantt tek bir özellik değil, zincir: baseline vs actual → sürükle-bırak yeniden planlama → kritik yol
→ kaynak dengeleme → milestone → çalışma takvimi. Her biri bir öncekini çağırır.

Asıl risk **karşılaştırma ekseninin kayması**: bugün kazanılan karşılaştırma "Harvest/Toggl + iş
takibi + sürprizsiz TL fiyat". Demoda gantt görünen an alıcının referansı Monday/Smartsheet/MS
Project'e kayar — o eksende parite yok ve olmayacak. Güçlü olunan karşılaştırmadan çıkılıp zayıf
olunana girilmiş olur. Vizyonun "ne DEĞİL" maddesi bir mühendislik yasağı değil, **konumlandırma
disiplinidir.**

### 6.3 Sprint / story point — Hermes'e özel olarak en zararlısı

**İkinci bir zaman para birimi yaratır.** Kimlik saat → tutar; story point tasarımı gereği saat
değildir ve paraya çevrilemez. Aynı nesnede iki tahmin sistemi olunca:

- `estimate_minutes` ve `story_points` aynı iş için farklı hikâye anlatır; hangisi rapora girer?
- Utilization, kârlılık, faturalandırılabilirlik hepsi saat üzerinden. *"Bu sprint 34 puan yaptık
  ama 12 saat faturaladık"* iki ayrı doğrudur ve ikisi de yönetime gider — kategori vaadi bulanıklaşır.
- Sprint bir **dönem konteyneri**. Hermes'te zaten iki konteyner var: proje ve fatura dönemi/retainer
  ayı. Üçüncüsü ikisiyle de hizalanmaz (sprint 2 haftalık, fatura aylık).
- MSP profilinde tamamen anlamsız (ticket kuyruğunda sprint yok) → profil anahtarında çift bakım.

Altta yatan gerçek ihtiyaç — "işi bir döneme toplayıp o dönemi kapatmak" — Hermes'te **fatura dönemi**
olarak zaten var; yapılacak iş onu birinci sınıf hale getirmek, yanına sprint koymak değil.

### 6.4 Kapıyı açık bırakmanın maliyeti sıfır

Şu üç karar bugün alınırsa gantt/bağımlılık sonradan **migration'sız** eklenebilir — üçü de hedef
şemada zaten var:

1. `work_item_links` generic `link_type` ile kalsın (bugün yalnız `relates|duplicates|blocks` dolsa da).
2. `start_date` **ve** `due_date` ikisi de dursun (UI bugün sadece due kullanacak olsa bile).
3. `parent_id` dursun — rollup ve timeline gruplaması ondan gelir.

"Şimdi yapmıyoruz" ile "bir daha yapamayız" aynı şey değildir.

## 7. Sıralama gerilimi — dürüst okuma

**PM rework, stratejinin kutsal sırasında yok.** Sıra: 1 para katmanı · 2 e-fatura · 3 timer ·
4 utilization/kârlılık · 5 çok-kiracılık (5 fiilen bitti). Bu rework'ü öne almak, kategoriye giriş
biletini geciktirmek demek — ve rakip penceresi ("Harvest'tan kaçan müşteri") sonsuza kadar açık değil.

Ama tersi de doğru: **para katmanı bu şemanın üstüne inşa edilirse iki kez yazılır.** Kârlılık ve
utilization iş kalemine bağlanacak; bugünkü iş kalemi bir kenar, N kopya hâlinde duruyor ve proje
görünürlüğü yok.

**Önerilen bölme — rework'ü ikiye ayır:**

| | Kapsam | Ne zaman | Neden |
|---|---|---|---|
| **A · Şema rework'ü** | Faz 1–3 (aşağıda): nesne, participant, state, routing, ticket bağı | **Para katmanından ÖNCE**, küçük ve odaklı | Para katmanının tutunacağı nesneyi kurar. Bir kez yazılır. |
| **B · UI rework'ü** | Faz 4: workspace + saved views | **Para katmanı ve e-fatura sonrası** | Ekran zaten yeniden çizilecek (tutar, kârlılık, timer). İki kez çizmemek için. |

Yani: **şemayı şimdi düzelt, ekranı para geldiğinde bir kere çiz.**

### Fazlar

1. **F00 — Karar dondurma.** §8'deki kalan kararlar kapanır, `01-hedef-sema.md` yazılır.
2. **F01 — Şema + tek seferlik taşıma.** Her `assignment_batch_id` grubu → **1** work_item + **N**
   participant; `batch_id IS NULL` → singleton. `assigner → reporter`, `status → workflow_states`.
   Yorum/aktivite remap. Veri kaybı yok, tahmin yok — batch_id kalıcı ve kesin bir kimlik.
3. **F02 — Görünürlük anahtarını çevir.** `assignee OR assigner` → `project_memberships`.
   Backfill: her mevcut task'ın assignee ve assigner'ı ilgili projeye `member` yazılır → geçişte
   kimse iş kaybetmez. Atama hiyerarşisi `routing_relations`'a taşınır (silinmez).
4. **F03 — Birleştirme.** `issues → work_items`; `work_logs.issue_id → work_item_id`;
   `tickets → work_item` dönüşümü (`origin_type/ref`) ve ticketing'in outbox/state-machine
   disiplinine yakınsama.
5. **F04 — UI.** Workspace + saved views + profil katmanı. `TasksPage` ve `features/tasks` emekli;
   `grouping.js` silinir — gruplama artık veritabanında. *(Para katmanı sonrası.)*
6. **F05 — Temizlik.** Eski tabloların drop'u, `assignment_batch_id` mirası.

### Riskler

- **Public API + MCP sözleşmesi — en yüksek risk.** `public_api/routers/tasks*.py`,
  `POST /v1/task-groups` ve **24 MCP aracının 6 yazma aracı** doğrudan task şeklini konuşuyor.
  Rakip-Analizi bu katmanı Hermes'in *nadir üstünlüğü* sayıyor; kırmak, satış argümanını kırmaktır.
  F01–F03 boyunca `/v1` uyumluluk shim'i **pazarlık konusu değil**, ve MCP uyumluluk matrisi
  ("denenmemişe Verified deme") yeniden koşulmalı.
- **Migration sırası:** `sql_scripts/migrations` sıra bağımlı — bu fazlarda paralel ajan migration
  yazmamalı (AGENTS.md kırmızı çizgisi).
- **Kapasite:** strateji dokümanı 4 kişilik ekip ve "her şey aracı tuzağı" uyarısı koyuyor.
  A/B bölmesi tam olarak bu uyarıya cevaptır.

---

## 8. Açık kararlar

Vizyonun **kapattıkları** (artık soru değil): bağımlılık/gantt yok · workflow konfigüre edilebilir
olmak zorunda (profil anahtarı) · ticket → iş kalemi zinciri kurulacak (tek omurga).

Kalan dört karar:

1. **Sahiplik:** tek `owner` + çoklu `participant` mı, tamamen çoklu assignee mi?
   *Öneri:* tek owner — MSP'de ticket sahipliği, ajansta hesap verebilirlik. Grup ihtiyacı participant ile.
2. **`sub_project` kaderi:** proje ağacının ikinci seviyesi mi, iş kaleminin `parent_id`'si mi?
   *Öneri:* `parent_id`; proje ağacı customer → project ile bitsin.
3. **`is_billable` varsayılanı iş kaleminde mi work_log'da mı yaşasın?**
   *Öneri:* ikisinde de — iş kalemi varsayılanı belirler, work_log override edebilir; PRD v2 FR 1.2
   onay ekranı iş kalemi seviyesinde çalışır.
4. **A/B bölmesi kabul mü?** Şema şimdi, UI para katmanından sonra. *Bu, rework'ün ne zaman
   başlayacağını belirleyen tek karar.*

---

## Kaynaklar

**İç:** `Hermes-Nis-Strateji.docx` (12 Tem 2026) · `_kaynak/Hermes-Rakip-Analizi.md` (28 Tem 2026) ·
`readme.md` PRD v1/v2 · `docs/support-ticketing.md` · `HERMES_TENANT_CUTOVER_EVIDENCE.md`

**Dış:**
- Linear — Concepts: https://linear.app/docs/conceptual-model
- Linear — Assign and delegate issues: https://linear.app/docs/assigning-issues
- Atlassian — Jira work items: https://www.atlassian.com/software/jira/guides/issues/overview
- Atlassian — Work type hierarchy: https://support.atlassian.com/jira-cloud-administration/docs/configure-the-issue-type-hierarchy/
- Productive.io — Best PSA software: https://productive.io/blog/best-psa-software/
- Scoro — PSA software examples: https://www.scoro.com/blog/psa-software-examples/
