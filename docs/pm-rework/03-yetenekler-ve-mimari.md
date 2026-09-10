# Hermes — Mimari Katmanlar ve Yetenek Haritası

Bu doküman iki soruyu cevaplar: **hedef mimari neye benziyor** ve **istenen "good to have"
yetenekler bu mimarinin neresine düşüyor**. Nesne modeli için `02-sema.md`, gerekçe ve ürün yönü
için `01-tasarim.md`, konumlandırma için `00-konumlandirma-ve-hedef-model.md`.

Görsel sürüm (beş şema) artifact olarak yayınlandı — bu dosya kod referanslarını ve uygulama
ayrıntısını taşır.

---

## 1. Katmanlar

| Katman | İçerik | Rework'ün etkisi |
|---|---|---|
| **Sistem** | auth-service · core-service (Web/Public/Integration API + jobs) · mcp-service · reporting-service · iki Postgres · obje deposu · Microsoft Graph | Servis topolojisi **değişmiyor**. Değişen tek şey core-service içindeki alan modeli |
| **Alan** | talep → iş kalemi → zaman → fatura | Ortadaki nesne yeniden kuruluyor; iki uç halka bağlanıyor |
| **Olay** | `work_item_events` → giden kutusu → tüketiciler | Ticket modülünde çalışan desen iş kalemine genişliyor |
| **Yetki** | tenant rolü · proje üyeliği · yönlendirme politikası | Üç soru üç mekanizmaya ayrılıyor |
| **Ekran** | sol menü · çalışma alanı · ayarlar | Ayarlar tek çatı altına; takvim bir görünüm tipine |

---

## 2. Yetki mimarisi — üç ayrı soru

Şikâyet: *"Görev atama yetkim var ama PM Configuration'a erişemiyorum."* Bu eksik bir izin değil,
model hatasıdır. Bugün üç farklı soru tek tabloya sıkışmış:

| Soru | Doğru kaynak | Bugünkü durum |
|---|---|---|
| Ne yapabilir? | Kiracı RBAC rolü (`shared/permissions.py`) | Doğru — RBAC cutover ile roller kaynak oldu |
| Nerede yapabilir? | `project_memberships` | **Yok** — görünürlük `assignee OR assigner` |
| Kime yapabilir? | Yönlendirme politikası | `task_assignment_relations` — ama aynı tablo görünürlüğü de belirliyor |

### Y1 — Atama yetkisi olan, kime atayacağını yönetemiyor

`/pm-configurations` rotası `tasks.permissions.manage` istiyor; `tasks.assign` bunu içermiyor
(`PERMISSION_REQUIRES` yalnız `assign → access` bağını kuruyor). Atama hiyerarşisi kiracı genelinde
tek tablo olduğu için, atama yapan biri kendi ekibini tanımlayamıyor.

**Çözüm — yeni izin eklemek değil, ayarları ikiye bölmek:**

| Ayar | Nerede yaşar | Kim yönetir |
|---|---|---|
| İş tipleri, durum akışı, bildirim kuralları, yaşam döngüsü politikası | Kiracı ayarları | `tasks.permissions.manage` |
| Proje üyeleri, üye rolleri, proje içi yönlendirme | **Projenin kendi sayfası** | Proje lideri (`member_role = lead`) |

Böylece "atama yapan kişi kendi ekibini yönetsin" isteği izin kataloğunu büyütmeden karşılanır.

### Y2 — Kendine iş açmak yapısal olarak imkânsız

```
CHECK (assigner_user_id <> assignee_user_id)   -- task_assignment_relations
```

Kendine yönlendirme ilişkisi kurulamıyor; `can_assign_to` yönetici olmayan için bu tablodan
geçtiğinden **hiç kimse kendine iş açamıyor**. Hedefte kısıt anlamını yitirir:
`reporter_user_id = owner_user_id` tamamen geçerli bir durumdur ve yönlendirme politikası yalnızca
*başkasına* atarken sorgulanır.

### Y3 — İşi yapan kişi işi düzenleyemiyor

```python
def _user_can_edit_core(user, task):      # task_service.py
    return is_task_admin(user) or task.assigner_user_id == UUID(user.id)
```

Atanan kişi yalnızca durum (`_user_can_update_status`) ve kendi notunu (`_user_can_update_note`)
değiştirebiliyor. Sorumlu, üzerinde çalıştığı işin terminini düzeltemiyor.

**Hedef kural:**

| Alan | Kim değiştirir |
|---|---|
| Başlık, açıklama, öncelik, termin, tahmin | Sahip (`owner`), reporter, proje lideri, yönetici |
| Durum | Sahip, katılımcı (assignee), proje lideri, yönetici |
| Sahip ve katılımcılar | Reporter, proje lideri, yönetici (yönlendirme politikasına tabi) |
| Faturalandırılabilirlik | Proje lideri, yönetici (PRD v2 FR 1.2 onay akışı) |
| Proje değiştirme | Proje lideri, yönetici |

### Y4 — Takipçi zaten hedef şemada

`work_item_participants.role ∈ (assignee, reviewer, watcher)`. Ek şema gerekmiyor; bildirim
kuralları katılımcı rolüne göre çalışır (takipçi atama bildirimi almaz, durum değişimi alır).

---

## 3. Ek dosya — mevcut altyapıyı genelleştir

Ticket tarafında tam bir ek dosya yaşam döngüsü **zaten çalışıyor**:
`ticket_attachment_service.py` · `ticket_storage.py` (ObjectStorage protokolü, yerel ve S3 uyumlu) ·
`ticket_scanner.py` · `ticket_download_grants.py`.

Akış: oturum aç → karantina anahtarına yaz → boyut/sha256 → magic-byte allowlist → malware tara →
temizse temiz önege taşı → yalnız `clean` olan bağlanabilir → indirme yetkiyle stream.

**Yapılacak iş yeni depo yazmak değil, sahipliği genelleştirmek:**

| Bugün | Hedef |
|---|---|
| `ticket_attachments.ticket_id` | `attachments.owner_type ∈ (ticket, work_item, comment)` + `owner_id` |
| `ticket_download_grants` | Aynı tablo, sahip tipine göre yetki kontrolü |
| Yetki: ticket görünürlüğü | Sahip tipine göre: iş kalemi için proje üyeliği |

Alternatif (daha az riskli, daha çok kod): `work_item_attachments` diye ikinci bir tablo ve ortak
servis katmanı. **Öneri:** polimorfik sahiplik — iki tablo iki yetki kontrolü demektir ve zamanla
ayrışır.

**Kapsam sınırı:** sürükle-bırak yükleme ve önizleme ilk sürümde yok; dosya listesi + indirme yeter.

---

## 4. Uygulama içi bildirim — olay akışının üçüncü tüketicisi

Bugün: `task_notifications.py` → Microsoft Graph → e-posta. Uygulama içinde bildirim yok.

**Yeni bir bildirim hattı yazılmıyor.** Ticket modülünde olay + giden kutusu deseni kurulu
(`ticket_event_service.py`, `ticket_delivery_service.py`). İş kalemi tarafı aynı desene bağlanınca
bildirim, o akışın üçüncü tüketicisi olur:

```
iş kalemi değişikliği → work_item_events (sequence) → giden kutusu → ┬→ e-posta (Graph)   [var]
                                                                     ├→ uygulama içi      [yeni]
                                                                     └→ webhook (dış)     [ticket'ta var]
```

**Tek yeni tablo:**

| Alan | Açıklama |
|---|---|
| `id`, `tenant_id` | |
| `user_id` | Alıcı |
| `event_id` | `work_item_events` referansı |
| `channel` | `in_app` |
| `read_at` | Okundu damgası; NULL = okunmadı |
| `created_at` | |

Mevcut `task_notification_settings` tablosu (tip · olay · öncelik · termin kuralları) **aynen
kullanılır** — kanal ayrımı bir sütun olarak eklenir. Yönetici bir olayı e-postada kapatıp uygulama
içinde açık bırakabilir.

**Kapsam sınırı:** WebSocket / gerçek zamanlı itme ilk sürümde yok. Rozet ve liste sayfa açılışında
ve pencere odağı geri geldiğinde çekilir. Beklentinin tamamını karşılar, altyapı gerektirmez.

---

## 5. Takvim — üçüncü bir takvim değil, bir görünüm tipi

Bugün üç ayrı zaman kaynağı var ve hiçbiri buluşmuyor:

| Kaynak | Nerede görünüyor |
|---|---|
| İş kaleminin termini (`due_date`) | Hiçbir takvimde |
| Toplantılar (Graph `calendarView` senkronu) | Toplantılar sayfası |
| Planlı zaman (`plan_times`) | Kendi ekranında |

Not: iş kalemi tarafında haftalık takvim yerleşimi **daha önce vardı ve kaldırıldı** — kullanışsız
bulunmuş (`features/tasks/model/constants.js` yorumu). Aynı hatayı tekrarlamamak için:

**Doğru kurgu:** takvim, `saved_views.layout` değerlerinden biridir (`board | list | timeline |
calendar`). Ve içeriği yalnız iş kalemi değildir — **"haftam"** görünümü üç kaynağı birleştirir:
termini gelen işler, toplantılar, planlı zaman. Tek başına iş kalemi takvimi, kaldırılan sürümün
tekrarı olur.

---

## 6. Ekran mimarisi — ayarların tek çatı altına alınması

Bugünkü menü (`components/layout/MainLayout.jsx`) ayarları **iki gruba** bölüyor:

| Grup | İçerik |
|---|---|
| Yönetim | Dashboard · Billable Hours · Raporlar · Sözleşmeler · **PM Configurations** · API Management · Ticket Integrations |
| Konfigürasyon | Müşteriler · Projeler · İş tipleri · Aktivite tipleri · Platformlar · İş hatları · Kullanıcılar |

Yani PM Configurations bir grupta, geri kalan yedi ayar sayfası başka grupta; hepsi düz liste,
hiyerarşi yok. Şikâyet yerinde.

**Hedef:** tek `/settings` rotası, altında bölümler. Her bölüm kendi iznini ister; izni olmayan
bölüm görünmez (bugünkü `can(perm)` filtresi bölüm seviyesine iner).

| Bölüm | İçerik | İzin |
|---|---|---|
| Organizasyon | Kullanıcılar · roller · gruplar | `users.manage` · `roles.manage` · `groups.manage` |
| İş yönetimi | İş tipleri · durum akışı · bildirim kuralları · yaşam döngüsü | `tasks.permissions.manage` |
| Referans verileri | İş tipi · aktivite · platform · iş hattı | `reference.manage` |
| Müşteri ve projeler | Müşteriler · projeler | `customers.manage` · `projects.manage` |
| Entegrasyonlar | API yönetimi · ticket entegrasyonları · takvim | `api.manage` · `tickets.config.manage` |

**Ayrı tutulan:** proje düzeyindeki ayarlar (üyeler, roller, proje içi yönlendirme) kiracı
ayarlarına karışmaz — projenin kendi sayfasında yaşar ve proje lideri yönetir. Y1'in çözümü burası.

Dashboard, Billable Hours, Raporlar ve Sözleşmeler ayar değildir; "Yönetim" grubunda kalırlar.

---

## 7. Yetenek haritası ve sıra

| Yetenek | Katman | Nasıl | Maliyet |
|---|---|---|---|
| Kendine iş açma | Yetki | Kısıt kalkar; `reporter = owner` geçerli | Rework yan ürünü |
| Takipçi atama | Alan | `participants.role = watcher` | Rework yan ürünü |
| Sorumlunun işi güncellemesi | Yetki | Düzenleme yetkisi proje rolünden | Rework yan ürünü |
| Çoklu atamanın tek iş olması | Alan | Katılımcı satırı, kopya değil | Rework yan ürünü |
| İşe dosya ekleme | Sistem | Ek dosya altyapısı polimorfik sahipliğe genelleşir | Orta |
| Uygulama içi bildirim | Olay | Giden kutusunun üçüncü tüketicisi + okundu tablosu | Orta |
| Takvim görünümü | Ekran | Kayıtlı görünümün yerleşim tipi; üç kaynak tek haftada | Orta |
| Ayarların tek çatı altına alınması | Ekran | Tek rota + bölümler + bölüm başına izin | Orta · bağımsız |
| Proje lideri kendi ekibini yönetsin | Yetki | Proje üyeliği + proje ayarları sayfası | Orta |

**Sıra:**

| Ne zaman | İş | Neden |
|---|---|---|
| Şema rework'ü ile (F01–F03) | Kendine iş açma · takipçi · sorumlunun düzenlemesi · çoklu atama | Ayrı iş değiller; şema doğru kurulunca ortaya çıkıyorlar |
| Rework'ten bağımsız, bugün de olur | Ayarların tek çatı altına alınması | Şemaya dokunmuyor; en görünür kazanç, en düşük risk |
| Rework'ten hemen sonra | Ek dosya · uygulama içi bildirim | İkisi de iş kalemi nesnesine ve olay akışına tutunuyor |
| Arayüz fazıyla (F04) | Takvim görünümü · proje ayarları sayfası | Kayıtlı görünüm ve proje çalışma alanı ile birlikte gelir |

**Kapsam uyarısı:** bunların hiçbiri para katmanının önüne geçmemeli. Öncelik sırası hâlâ
para → e-fatura → timer → kârlılık ekranı. Buradaki liste o sıranın *yanında* ilerleyen, büyük
kısmı bedavaya gelen bir yetenek kümesidir; kendi başına bir faz değildir.

---

## 8. Açık kalemler

| # | Kalem | Öneri |
|---|---|---|
| 1 | Ek dosya sahipliği: polimorfik mi, ikinci tablo mu | Polimorfik — iki tablo iki yetki kontrolü demek |
| 2 | Bildirim kanal ayrımı: ayrı satır mı, sütun mu | Sütun (`channel`) — kural tablosu tek kalsın |
| 3 | Takvim görünümü kimin haftası: yalnız benim mi, proje mi | İkisi de bir görünüm filtresi; varsayılan "benim haftam" |
| 4 | Proje ayarları sayfası hangi izinle açılır | `member_role = lead` yeterli mi, ayrı bir izin mi gerekli |
| 5 | Ayarlar birleştirmesi rework'ten önce mi yapılsın | Evet — bağımsız ve görünür kazanç |
