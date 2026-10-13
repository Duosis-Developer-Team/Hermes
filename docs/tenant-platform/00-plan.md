# Tenant modülleri, Süper-admin konsolu ve Profesyonel talep yönetimi — plan

Tarih: 2026-10-14 · Durum: CTO onaylı (kararlar §1) · Ortam: önce yalnız **dev**;
test'e ff CTO "ff yapalım" deyince.

## 1. CTO kararları (14.10)

| # | Konu | Karar |
|---|---|---|
| K1 | Modül kataloğu | 6 seçilebilir modül: **Zaman girişi, İş yönetimi, Toplantılar/Takvim, Talepler, Raporlar & Panel, Geliştirici platformu**. Ana sayfa, Ayarlar, Kullanıcılar/Roller/Gruplar **her zaman açık** (çekirdek). |
| K2 | Atama | Tenant başına **doğrudan modül seçimi** + yalnız arayüzde **hazır şablon** kısayolu (Tam paket, Yalnız talep…). Paket/faturalama sistemi YOK. |
| K3 | Talep ağı | Kim kime talep açabilir, **süper-admin'de dinamik** tanımlanır (örn. "Defacto → InterTech"). Süper-admin yalnız Duosis'te. Sağlayıcı tenant kendi hub'ında yanıtlar, talep eden tenant portaldan açar. |
| K4 | Talep özellikleri | Kapsam Claude'a bırakıldı: profesyonel helpdesk seviyesi (Zendesk / Freshdesk / Jira SM referansı), Hermes diliyle. |

Değişmez kurallar aynen geçerli: test verisi kutsal (yalnız additive migration),
force-push yok, LogiSlot sözleşmesi (`docs/contracts/support-ticketing-v1`) tek
taraflı değişmez.

## 2. Faz 1 — Tenant modülleri

### 2.1 Katalog (tek kaynak `backend/shared/modules.py`)

| Kod | Ad | Bağımlılık | İzinler (modül kapalıysa efektif izinden düşer) |
|---|---|---|---|
| `time_entry` | Zaman girişi (efor, kapasite, referans verileri) | — | `worklogs.admin`, `reference.manage` |
| `work` | İş yönetimi (işler, görünümler, PM ayarları, iş bildirimleri) | — | `tasks.*`, `issues.*`, `tasks.permissions.manage` |
| `meetings` | Toplantılar / takvim (Outlook senkronu) | — | `meetings.admin` |
| `tickets` | Talepler (hub / portal / entegrasyonlar) | — | `tickets.*` |
| `reports` | Raporlar & Panel (panel, raporlar, faturalanabilir, sözleşme) | `time_entry` | `reports.view` |
| `developer` | Geliştirici platformu (portal, API yönetimi, Public API, MCP) | — | `api.manage` |

Çekirdek izinler (`users/roles/groups/customers/projects.manage`) modülsüzdür.
Müşteri/proje **ayar sayfaları** yalnız `time_entry` ya da `work` açıkken görünür
(veri ve uçlar çekirdek kalır: talep → iş dönüşümü de kullanır).

### 2.2 Saklama ve yayılım
- **auth** `tenants.enabled_modules` (JSONB, additive migration 0006). Mevcut
  tenant'lar migration'da **tüm katalogla** doldurulur → bugünkü davranış değişmez.
- **core** `tenant_registry.enabled_modules` (additive migration 0017); mevcut
  `/internal/tenants/projection` S2S akışı taşır (auth her değişiklikte yansıtır).
- Bağımlılık kuralı tek yerde (`shared/modules.normalize`): `reports` seçilip
  `time_entry` seçilmezse 422.

### 2.3 Uygulama (RBAC gibi iki katman, fail-closed)
1. **İzin kesişimi**: auth `effective_permissions` = rol izinleri ∩ katalog ∩
   **açık modüllerin izinleri**. Kapalı modülün izni rol üzerinden sızamaz;
   core/reporting zaten auth'tan çözdüğü için otomatik uygulanır.
2. **Sunucu kapısı**: izinsiz-açık uçlar için (zaman girişi, toplantılar, ana
   sayfa blokları, geliştirici portalı, Public API) core'da router düzeyinde
   `require_module(...)` → kapalıysa **404** (var olmayan uç gibi).
3. **Arayüz**: `/auth/users/me` ve giriş yanıtları `tenant.modules` taşır;
   menü, rotalar, dock eylemleri, ana sayfa blokları, ayar bölümleri, kabuk
   açılış çağrıları (toplantı senkronu, iş izinleri, talep bağlamı, bildirim)
   modüle bağlanır. Sabit `/time-entry` açılışı → **açık ilk modül**.

## 3. Faz 2 — Süper-admin konsolu (Hermes Liquid)
- Tenant **listesi** (arama, durum filtresi, modül rozetleri) + **detay sayfası**:
  Genel bakış · **Modüller** (görsel kartlar, çoklu seçim, şablonlar,
  bağımlılık uyarısı) · Üyeler/yöneticiler · Alan adları & SSO · Talep ağı ·
  Denetim (tenant'a filtreli).
- **Oluşturma sihirbazı**: Bilgiler → Modüller → Yönetici & alan adı → Özet.
- Bilinen hatalar: yönlendirme aç/kapa `record_audit` TypeError; sayfa
  yenilenince süper-admin oturumu düşüyor (`/me` ile geri yükleme); plan kodu
  doğrulanmıyor; PATCH sürüm kilidi.

## 4. Faz 3 — Profesyonel talep yönetimi

### 4.0 Talep ağı (K3)
- Global (RLS'siz, platform yönetimli) **bağlantı** kaydı: *talep eden tenant →
  sağlayıcı tenant + varsayılan ekip*. Süper-admin "Talep ağı" ekranından kurar.
- Sağlayıcı = `tickets` modülü açık tenant; canonical talep **sağlayıcının**
  verisinde (RLS) durur. Bugünkü sabit `HERMES_SUPPORT_TENANT_ID` geçidi
  (`support_session`, `get_support_db`) "isteğin sağlayıcısı"na genelleşir.
- Bir tenant hem sağlayıcı hem talep eden olabilir: **Gelen talepler** (hub) +
  **Açtığım talepler** (portal) iki sekme.
- Duosis, LogiSlot entegrasyonunun sağlayıcısı olarak aynen kalır; mevcut
  Duosis yönlendirmeleri bağlantıya taşınır (veri kaybı yok, additive).

### 4.1 Dalga A — Hatalar + arka uçta olup arayüzde olmayanlar
Çözüm özeti min 20 karakter hatası; durum penceresinden yeniden açma; 50 talep
sınırı (sayfalama + sıralama); canlı yenileme; ajana atama, öncelik, işlem
geçmişi; müşteri iptali ve yanıta ek; gelişmiş filtreler.

### 4.2 Dalga B — Helpdesk çekirdeği
SLA politikaları (öncelik başına ilk yanıt/çözüm hedefi) + mesai takvimi,
"müşteride bekliyor"da durur; listede kalan süre/ihlal rozetleri · etiketler ·
hazır yanıtlar (makro: metin + durum/öncelik/etiket) · toplu işlem · kayıtlı
görünümler (kişisel/paylaşılan) · talep eden yan paneli (önceki talepleri) ·
takipçiler · uygulama içi bildirimler (ajan: yeni/atanan/yanıt; müşteri: yanıt/
çözüldü).

### 4.3 Dalga C — İçgörü
Rapor paneli (hacim, birikim, ilk yanıt/çözüm medyanı, SLA %, ekip/ajan) ·
CSAT (çözüm sonrası 1–5 + yorum).

### 4.4 Sonra (ayrı karar)
E-posta kanalı (giden bildirim + gelen e-postadan talep), bilgi bankası,
birleştirme, otomasyon kuralları.

### Sözleşme notu
Yeni yetenekler **yeni tablolarla** gelir; LogiSlot'a giden olay/alan seti ve
`ticket_events` olay türleri değişmez (iç olaylar da sözleşme anlık
görüntüsünde). Helpdesk katmanının etkinlik kaydı ayrı tabloda tutulur.

## 5. Teslim ve doğrulama
Her faz: backend + frontend testleri, dev'de canlı doğrulama, `07-durum` gibi
kısa durum notu. Test'e ff: §ff-provası (yedek + geçici namespace'te migration
provası + satır sayımı).
