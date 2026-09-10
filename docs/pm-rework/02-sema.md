# Hermes — İş Kalemi Modülü Şema Dokümanı

## 1. Amaç ve kapsam

Bu doküman, iş kalemi modülünün hedef veri modelini tanımlar: tablolar, alanlar, kısıtlar, mevcut
şemadan eşleme ve geçiş adımları. Gerekçeler ve ürün yönü için tasarım dokümanına (`01-tasarim.md`),
teşhis kanıtları için `00-konumlandirma-ve-hedef-model.md` dosyasına bakılır.

**Kapsamdaki veritabanı:** `core_db`. Kullanıcı kimlikleri `auth_db.users` tablosuna mantıksal
referanstır; fiziksel yabancı anahtar kurulmaz (mevcut mikroservis kuralı korunur).

**Ortak alanlar:** tüm tablolar mevcut `TenantOwnedMixin` sözleşmesine uyar (`tenant_id` ve kiracı
kısıtları). Aşağıdaki tablolarda `tenant_id` ayrıca yazılmamıştır.

## 2. Nesne modeli özeti

| Nesne | Rolü |
|---|---|
| `projects` (mevcut) | İş kaleminin kapsayıcısı. Sahiplik ve görünürlük buradan gelir |
| `work_items` | İş kalemi. Modülün merkez nesnesi |
| `work_item_participants` | İşe bağlı kişiler. Çoklu atamanın kopya üretmeyen karşılığı |
| `work_item_links` | İşler arası ilişki (ilgili, kopya, engelliyor) |
| `workflow_states` | Kiracının tanımladığı durum akışı |
| `work_item_comments` | Yorumlar |
| `work_item_events` | Değişiklik günlüğü ve olay akışı |
| `project_memberships` (mevcut) | Görünürlüğün ve yetkinin kaynağı |
| `routing_relations` | Kim kime iş yönlendirebilir. Görünürlük değil, yetki politikası |
| `saved_views` | Kaydedilmiş görünüm (filtre + yerleşim) |

İlişki zinciri: `customers → projects → work_items → work_logs`. İş kalemi bir talepten
(`tickets`) doğabilir; bu bağ `origin_type` / `origin_ref_id` alanlarıyla tutulur.

## 3. Tablolar

### 3.1 work_items

Modülün merkez nesnesi. Bir iş kalemi bir projeye aittir; kişiye değil.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | Birincil anahtar |
| `project_id` | uuid FK projects | evet | Kapsayıcı. `ON DELETE RESTRICT` |
| `parent_id` | uuid FK work_items | hayır | Ana iş. En fazla iki seviye; `ON DELETE RESTRICT` |
| `item_key` | varchar(50) | evet | Görünen kimlik, `PROJ-142`. Proje anahtarı + proje içi sayaç |
| `item_number` | bigint | evet | Proje içi sayaç. Veritabanı sekansı; eşzamanlı ekleme çakışmaz |
| `item_type_id` | uuid FK work_item_types | evet | task / issue / suggestion. Profil diline göre etiketlenir |
| `title` | varchar(255) | evet | Başlık |
| `description` | text | hayır | Açıklama |
| `state_id` | uuid FK workflow_states | evet | Durum. Sabit liste değil |
| `priority` | varchar(20) | evet | low / medium / high / urgent |
| `reporter_user_id` | uuid | evet | İşi açan. Yetki kaynağı değildir |
| `owner_user_id` | uuid | hayır | Tek sorumlu. Boşsa iş triage kuyruğundadır |
| `estimate_minutes` | integer | hayır | Tahmin. Pozitif olmalı |
| `start_date` | date | hayır | Başlangıç. Zaman şeridi için saklanır |
| `due_date` | date | hayır | Termin |
| `is_billable` | boolean | evet | Faturalandırılabilir mi. Proje ve iş tipi varsayılanından türer |
| `billable_override_by` | uuid | hayır | Varsayılanı değiştiren kullanıcı. Boşsa değer sistemden gelmiştir |
| `billable_override_at` | timestamptz | hayır | Değiştirme anı |
| `origin_type` | varchar(20) | hayır | ticket / meeting / manual |
| `origin_ref_id` | uuid | hayır | Kaynağın kimliği. Talep → iş zincirinin ilk halkası |
| `closed_at` | timestamptz | hayır | Kesintisiz terminal duruma geçiş anı. Arşiv sayacı buradan işler |
| `archived_at` | timestamptz | hayır | Arşiv anı |
| `archive_reason` | varchar(20) | hayır | auto_retention / manual / legacy |
| `archived_by_user_id` | uuid | hayır | Manuel arşivde işlemi yapan |
| `created_at` / `updated_at` | timestamptz | evet | Zaman damgaları |

**Kısıtlar**

| Ad | Kural |
|---|---|
| `chk_work_items_estimate` | `estimate_minutes IS NULL OR estimate_minutes > 0` |
| `chk_work_items_priority` | `priority IN ('low','medium','high','urgent')` |
| `chk_work_items_dates` | `due_date IS NULL OR start_date IS NULL OR due_date >= start_date` |
| `chk_work_items_origin` | `(origin_type IS NULL AND origin_ref_id IS NULL) OR (origin_type IS NOT NULL AND origin_ref_id IS NOT NULL)` |
| `chk_work_items_billable_override` | `(billable_override_by IS NULL) = (billable_override_at IS NULL)` |
| `uq_work_items_key` | `UNIQUE (project_id, item_number)` |

**Dizinler:** `project_id`, `state_id`, `owner_user_id`, `reporter_user_id`, `due_date`,
`archived_at`, `parent_id`, `item_key`, ve `(project_id, state_id)` bileşik dizini pano sorgusu için.

**Not — iki seviye kuralı:** `parent_id` yalnızca ana işi olmayan bir kaydı gösterebilir. Veritabanı
seviyesinde tetikleyici ile ya da servis katmanında doğrulanır; tercih servis katmanıdır (mevcut
ticket durum makinesiyle aynı yaklaşım).

### 3.2 work_item_participants

Çoklu atamanın kopya üretmeyen karşılığı. Bir işe üç kişi katılıyorsa üç satır, tek iş kalemi.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | Birincil anahtar |
| `work_item_id` | uuid FK work_items | evet | `ON DELETE CASCADE` |
| `user_id` | uuid | evet | Katılımcı |
| `role` | varchar(20) | evet | assignee / reviewer / watcher |
| `added_by_user_id` | uuid | hayır | Ekleyen |
| `created_at` | timestamptz | evet | |

**Kısıtlar:** `UNIQUE (work_item_id, user_id, role)`; `role IN ('assignee','reviewer','watcher')`.
**Dizinler:** `user_id`, `(user_id, role)` — "bana atanan işler" sorgusu bunu kullanır.

**Sahiplik ile ilişki:** `owner_user_id` tek sorumluyu tutar; katılımcı tablosu ekibi tutar. Owner
aynı zamanda `assignee` rolüyle bu tabloda bulunur — böylece "bana atanan" sorgusu tek yoldan çalışır.

### 3.3 work_item_links

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | |
| `from_item_id` | uuid FK work_items | evet | `ON DELETE CASCADE` |
| `to_item_id` | uuid FK work_items | evet | `ON DELETE CASCADE` |
| `link_type` | varchar(20) | evet | relates / duplicates / blocks |
| `created_by_user_id` | uuid | hayır | |
| `created_at` | timestamptz | evet | |

**Kısıtlar:** `UNIQUE (from_item_id, to_item_id, link_type)`; `from_item_id <> to_item_id`;
`link_type IN ('relates','duplicates','blocks')`.

**Davranış sınırı (ürün kararı):** `blocks` bağı **görsel ve filtrelenebilirdir**. Hiçbir otomatik
tarih kaydırması, otomatik durum değişimi veya planlama etkisi yoktur. Döngü kontrolü servis
katmanında yapılır (graf yürüyüşü); veritabanı kısıtıyla çözülmez.

### 3.4 workflow_states

Kiracının durum akışı. Sabit `status` enum'unun yerine geçer; profil anahtarını (MSP / Ajans) mümkün
kılan tablo budur.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | |
| `name` | varchar(80) | evet | Görünen ad. Panoda sütun başlığı |
| `category` | varchar(20) | evet | todo / in_progress / done / cancelled |
| `position` | integer | evet | Sıra |
| `is_default` | boolean | evet | Yeni iş bu duruma düşer. Kiracı başına tek satır true |
| `is_active` | boolean | evet | Pasif durum yeni işe atanamaz, mevcut işler korunur |

**Kısıtlar:** `category IN ('todo','in_progress','done','cancelled')`;
`UNIQUE (tenant_id, name)`; kısmi eşsizlik: `is_default = true` olan satır kiracı başına tek.

**Neden kategori var:** raporlama, arşiv sayacı ve pano gruplaması ada göre değil kategoriye göre
çalışır. Kiracı durumu yeniden adlandırabilir, kategori sözleşmesi bozulmaz. `closed_at`,
`category IN ('done','cancelled')` durumuna geçişte yazılır.

### 3.5 work_item_comments ve work_item_events

Mevcut `task_comments` ve `task_activity_events` tablolarının devamıdır; alan yapısı korunur, yalnız
yabancı anahtar `work_items` tablosuna bağlanır.

| Tablo | Alanlar |
|---|---|
| `work_item_comments` | `id`, `work_item_id`, `author_user_id`, `body`, `created_at`, `updated_at`, `deleted_at` |
| `work_item_events` | `id`, `work_item_id`, `actor_user_id`, `event_type`, `event_data` (jsonb), `sequence`, `created_at` |

**Ekleme:** `work_item_events` tablosuna `sequence` alanı eklenir. Gerekçe: ticket modülünde olay
sırası ve giden kutusu (outbox) deseni zaten kurulu ve çalışıyor; iş kalemi tarafı aynı disipline
yakınsar. Bu, bildirim ve dış entegrasyon tarafında iki farklı olay modeli tutmayı önler.

### 3.6 routing_relations

Mevcut `task_assignment_relations` ve `task_assignment_group_relations` tablolarının devamı. **Rolü
değişiyor:** görünürlüğün kaynağı olmaktan çıkar, yalnızca *kim kime iş yönlendirebilir* sorusunu
cevaplar. Ticket dağıtımının da ihtiyacı olan politika budur.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | |
| `assigner_user_id` | uuid | evet | Yönlendiren |
| `assignee_user_id` | uuid | hayır | Hedef kişi |
| `assignee_group_id` | uuid FK user_groups | hayır | Hedef grup |
| `scope` | varchar(20) | evet | İş tipi kapsamı |
| `created_at` / `updated_at` | timestamptz | evet | |

**Kısıtlar:** hedef alanlardan tam olarak biri dolu olmalı; `assigner_user_id <> assignee_user_id`;
eşsizlik `(assigner_user_id, assignee_user_id, assignee_group_id, scope)`.

### 3.7 saved_views

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `id` | uuid | evet | |
| `owner_user_id` | uuid | hayır | Boşsa sistem görünümü |
| `name` | varchar(120) | evet | |
| `scope` | varchar(20) | evet | personal / shared / system |
| `layout` | varchar(20) | evet | board / list / timeline |
| `filter_json` | jsonb | evet | Filtre tanımı |
| `position` | integer | hayır | Sol kolondaki sıra |

Sistem görünümleri (bana ait işler, triage, gecikenler, faturalanmamış iş) kurulumda yazılır; kullanıcı
bunları silemez, kopyalayabilir.

### 3.8 Mevcut tablolarda değişiklik

| Tablo | Değişiklik |
|---|---|
| `work_logs` | `task_id` → `work_item_id` olarak yeniden adlandırılır; `issue_id` kaldırılır, değeri `work_item_id` alanına taşınır |
| `projects` | Değişiklik yok. `project_key` alanı iş kalemi anahtarının kaynağı olur; boş olan projelere üretilir |
| `project_memberships` | Değişiklik yok. `member_role` alanı `lead` / `member` / `viewer` değerleriyle standartlaşır |
| `tickets` | Değişiklik yok. İş kalemi tarafı `origin_type='ticket'` ile bağlanır |

## 4. Emekli olan tablolar

| Tablo | Karşılığı |
|---|---|
| `tasks` | `work_items` + `work_item_participants` |
| `task_sub_projects` | `work_items.parent_id` (ürün kararı 2'ye bağlı) |
| `issues` | `work_items` (`item_type = issue`) |
| `task_comments` | `work_item_comments` |
| `task_activity_events` | `work_item_events` |
| `task_assignment_relations` | `routing_relations` |
| `task_assignment_group_relations` | `routing_relations` |
| `task_user_permissions` | Proje üyeliği + kiracı RBAC |
| `task_group_permissions` | Proje üyeliği + kiracı RBAC |
| `task_group_member_overrides` | Proje üyeliği + kiracı RBAC |
| `task_lifecycle_policy` | Korunur, yalnız iş kalemi tablosuna bakar |
| `task_notification_settings` | Korunur, `item_type_id` üzerinden çalışır |

## 5. Veri taşıma

### 5.1 İş kalemi taşıması

Mevcut `tasks` tablosunda aynı oluşturma eylemiyle üretilmiş satırlar `assignment_batch_id` alanını
paylaşır. Bu kimlik kalıcı ve kesindir; taşıma tahmine dayanmaz.

| Kaynak | Hedef |
|---|---|
| Aynı `assignment_batch_id` değerine sahip satır grubu | **Bir** `work_items` kaydı |
| Grubun her satırındaki `assignee_user_id` | Bir `work_item_participants` satırı, rol `assignee` |
| `assignment_batch_id` boş olan satır | Tek başına bir `work_items` kaydı |
| `assigner_user_id` | `reporter_user_id` |
| Gruptaki ilk satırın `assignee_user_id` değeri | `owner_user_id` (grup tek kişilikse doğal sahip) |
| `status` | Eşlenen `workflow_states` kaydı |
| `customer_id`, `project_id` | `project_id` (müşteri projeden okunur) |
| `sub_project_id` | Ürün kararı 2'ye göre: ana iş kalemi ya da proje ağacı seviyesi |
| `task_type` | `item_type_id` |
| `task_number`, `type_number` | `item_number` ve `item_key` üretimi |
| Yorum ve aktivite kayıtları | Yeni iş kalemi kimliğine eşlenir |

**Sahiplik kuralı:** grup birden çok kişiye atanmışsa `owner_user_id` boş bırakılır ve iş triage
kuyruğuna düşer; tüm kişiler katılımcı olarak kalır. Böylece "üç kişiye atanmış tek iş" durumunda
hesap verebilirlik sahte biçimde tek kişiye yüklenmez.

**Durum eşlemesi**

| Eski `status` | Yeni durum | Kategori |
|---|---|---|
| `pending` | Pending | todo |
| `in_progress` | In Progress | in_progress |
| `completed` | Completed | done |
| `cancelled` | Cancelled | cancelled |
| `rejected` (tarihsel) | Pending | todo |

### 5.2 Görünürlük taşıması

Görünürlük kuralı "atanan veya atayan" iken "proje üyeliği"ne çevrilir. Geçişte kimsenin iş
kaybetmemesi için, taşımadan **önce** her mevcut task'ın atananı ve atayanı ilgili projeye `member`
rolüyle yazılır. Zaten üye olanlar için işlem yapılmaz.

Kabul ölçütü: taşıma öncesi ve sonrası, her kullanıcı için görünen iş kümesi **daralmaz**.

### 5.3 issues taşıması

`issues` kayıtları `work_items` tablosuna `item_type = issue` olarak taşınır; `issue_key` alanı
`item_key` olarak korunur. `work_logs.issue_id` değerleri yeni kimliğe eşlenir; `issue_key_manual`
alanı olduğu gibi kalır.

## 6. Faz planı ve migration sırası

| Faz | Migration içeriği | Geri alınabilirlik |
|---|---|---|
| F01 | Yeni tabloların oluşturulması, `workflow_states` tohumlaması, iş kalemi ve katılımcı taşıması | Eski tablolar dokunulmadan durur; geri alma yeni tabloları düşürür |
| F02 | `project_memberships` doldurma, okuma yolunun yeni kurala çevrilmesi, `routing_relations` taşıması | Okuma yolu bayrakla eski kurala döndürülebilir |
| F03 | `issues` birleştirmesi, `work_logs` alan yeniden adlandırması, ticket bağı | `work_logs` değişikliği geri alınabilir; veri kaybı yok |
| F04 | Şema değişikliği yok (arayüz fazı) | — |
| F05 | Eski tabloların düşürülmesi | Geri alınamaz; ancak F01–F03 kabul ölçütleri geçtikten sonra |

**Depo kuralı:** `sql_scripts/migrations` sıra bağımlıdır. Bu fazlar boyunca ikinci bir ajan paralel
migration yazmaz.

## 7. Servis ve API etkisi

### 7.1 Backend

| Bileşen | Etki |
|---|---|
| `task_service.py` | `work_item_service.py` olarak yeniden yazılır. Görünürlük fonksiyonları proje üyeliğine, atama kontrolü `routing_relations` tablosuna bağlanır |
| `task_archive_service.py`, `task_lifecycle.py` | Yeni tabloya bağlanır; `closed_at` mantığı korunur |
| `task_notifications.py` | `item_type_id` üzerinden çalışır; olay kaynağı `work_item_events` |
| Durum makinesi | Yeni servis. `workflow_states` kategorilerine göre geçiş kuralları; ticket durum makinesiyle aynı desen |
| `routers/tasks.py`, `task_admin.py` | Yeni uçlar; eski uçlar uyumluluk katmanına devredilir |

### 7.2 Dış sözleşmeler — en yüksek risk

Public API v1 ve MCP servisi doğrudan eski task şeklini konuşur. Bu katman rakip analizinde ürünün
nadir üstünlüklerinden biri sayılıyor; sözleşmeyi kırmak satış argümanını kırmaktır.

| Yüzey | Gereklilik |
|---|---|
| `public_api/routers/tasks.py`, `tasks_write.py` | Yanıt şekli değişmez. Yeni model eski şekle serialize edilir |
| `POST /v1/task-groups` | Davranış korunur: grup ataması artık tek iş kalemi + N katılımcı üretir, ama yanıt eski şekliyle döner |
| MCP servisi, 24 araç (6 yazma) | Araç sözleşmeleri değişmez. Taşıma sonrası uyumluluk matrisi yeniden koşulur; denenmemiş istemci "doğrulandı" işaretlenmez |
| Webhook ve olay yükleri | `work_item_events.sequence` alanı eklenir; mevcut alan adları korunur |

Uyumluluk katmanı F05'e kadar kalır. Kaldırılması ayrı bir sürüm kararıdır ve `/v2` ilanı gerektirir.

## 8. Kabul ölçütleri

| # | Ölçüt |
|---|---|
| 1 | Üç kişiye atanmış bir iş, `work_items` tablosunda tek satırdır |
| 2 | Proje üyesi, kendisine atanmamış işleri görebilir; taşıma sonrası hiçbir kullanıcının görünürlüğü daralmaz |
| 3 | `owner_user_id` boş olan işler triage görünümünde listelenir |
| 4 | Kiracı yeni bir durum ekleyebilir; pano sütunları buna göre değişir; raporlar kategoriye göre doğru çalışır |
| 5 | Bir iş kaleminin tahmin, girilen ve faturalandırılabilir saat toplamları proje toplamıyla tutarlıdır |
| 6 | `origin_type='ticket'` olan bir iş kaleminden kaynağa gidilebilir |
| 7 | `/v1` uçları ve MCP araçları taşıma öncesi ile aynı yanıtı verir |
| 8 | `blocks` bağı hiçbir tarih ya da durum değişikliği tetiklemez |

## 9. Açık kalemler

| # | Kalem | Bağlı olduğu karar |
|---|---|---|
| 1 | Çoklu atamada sahiplik: owner boş mu kalsın, ilk kişi mi sahip olsun | Ürün kararı 1 |
| 2 | `sub_project` alt iş kalemine mi, proje ağacı seviyesine mi dönüşecek | Ürün kararı 2 |
| 3 | `is_billable` varsayılanının kaynağı: proje mi, iş tipi mi, ikisi mi | Ürün kararı 3 |
| 4 | İki seviye kuralının nerede zorlanacağı: tetikleyici mi servis mi | Teknik; öneri servis |
| 5 | `item_key` üretimi: proje anahtarı boş olan mevcut projeler için üretim kuralı | Teknik |
