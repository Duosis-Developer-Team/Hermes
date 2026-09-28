# Hermes yeniden tasarım + macOS uygulaması — plan (28.09)

CTO kararları (28.09): masaüstü = yerel kabuk, sunucudaki Hermes'i açar ·
varsayılan sunucu test, menüden dev · şimdilik imzasız (ad-hoc) .dmg ·
tasarım: önce tasarım sistemi + kabuk, sonra modül modül (dev'de).

Referans: Dribbble "AgroControl" (dynamic island). Sayfa bu ortamdan
okunamadı; yön prototipte yorumlandı ve onaya sunuldu:
https://claude.ai/artifact/BuBrMnUhjW3ysM2VV3CYGB

## 1. Masaüstü uygulaması — YAPILDI (`18a1109`)

`desktop/` (Electron 44). Ayrıntı: `desktop/README.md`. Kalan: Developer ID
imza + notarization, otomatik güncelleme, yeni tasarımla `hiddenInset`
başlık çubuğu.

## 2. Tasarım dili (prototipte)

| Öğe | Karar |
|---|---|
| Gezinme | Sol kenar menüsü kalkar. Üstte ortada yüzen koyu **ada**: 4–5 ana modül (Ana sayfa, İşler, Zaman, Toplantılar, +Talepler izinle), canlı durum (çalışan zamanlayıcı / 15 dk içindeki toplantı), arama, bildirim, profil. Diğer modüller **Tümü** başlatıcısı ve ⌘K komut paletinde (Çalışma · Yönetim · Sistem). |
| Canlı ada | Duruma göre genişler (zamanlayıcı kontrolleri, toplantıya katıl). Masaüstünde pencere başlığının yerine oturur. |
| Yüzeyler | Zemin açık mavi-gri; kartlar beyaz, 28 px radius, yumuşak gölge, içerik kadar yüksek (bento). Koyu tema eşdeğeri. |
| Renk | Mürekkep `#11141B`, vurgu `#5B6CFF` (yalnız birincil eylem + seçim). Anlamsal: gecikmiş kırmızı, bugün amber, tamam yeşil — E4 kuralı korunur (kartta tek renkli sinyal = termin). |
| Tip | Başlık/sayılar Bricolage Grotesque, gövde Onest, kodlar JetBrains Mono (self-host edilecek). |
| Kontroller | Hap (pill) segmentler, siyah seçili durum; antd tema token'larıyla (ConfigProvider) hizalanır — bileşen kütüphanesi değişmez. |

## 3. Uygulama adımları (her biri ayrı dev commit'i, eski ekranlar çalışmaya devam eder)

| Adım | İçerik |
|---|---|
| R1 | Tasarım token'ları (`styles/tokens.css` yeni katman) + antd `ConfigProvider` teması + fontlar. Mevcut `--h-*` token'ları yeni değerlere bağlanır — tüm ekranlar renk/radius/tip olarak bir anda yeni dile yaklaşır. |
| R2 | Yeni kabuk: `AppShell` sol menü → dynamic island + Tümü başlatıcısı + ⌘K palet (izin filtreli, mevcut menü kataloğundan); mobilde ada alta iner. Canlı slot: toplantı (mevcut /home/week) — zamanlayıcı backend'i yok, R2'de yalnız toplantı. |
| R3 | Ana sayfa + İşler (bento, pano/liste/takvim, görünümler) yeni bileşenlerle. |
| R4 | Zaman girişi, Toplantılar, Talepler. |
| R5 | Raporlar/Panel/Faturalanabilir/Sözleşme, Ayarlar, Developer portalı. |
| R6 | Masaüstü: `hiddenInset` başlık + ada sürükleme bölgesi; imza/notarization (sertifika gelince). |

Açık soru: canlı adadaki **zamanlayıcı** (başlat/durdur → efor kaydı)
yeni bir özellik; backend'de çalışan zamanlayıcı yok. İstenirse R4'te
ayrı küçük bir uç (`/timers`) ile eklenir.
