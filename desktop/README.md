# Hermes for macOS

Hermes'in macOS uygulaması. Bir **kabuktur**: seçili sunucudaki Hermes'i
(varsayılan `https://hermes.duosis.com`) kendi penceresinde açar. Siteden
yapılabilen her şey uygulamadan da yapılır; siteye çıkan her yenilik
uygulamaya da otomatik gelir (yeni .dmg gerekmez — yalnız kabuk değişirse).

## Kurulum (kullanıcı)

1. `Hermes-<sürüm>-arm64.dmg` (Apple Silicon) veya `-x64.dmg` (Intel) aç.
2. Hermes'i **Applications** klasörüne sürükle.
3. İlk açılışta: Applications'ta Hermes'e **sağ tık → Aç → Aç**.
   Uygulama henüz Apple Developer ID ile imzalı/notarize değil (ad-hoc
   imzalı); macOS bu yüzden bir kez "doğrulanamayan geliştirici" sorar.
   Landing page'e koymadan önce imza + notarization eklenecek (aşağıda).

## Yerel özellikler

| Özellik | Nasıl |
|---|---|
| Sunucu seçimi | **Sunucu** menüsü: Hermes (test) · Hermes Dev. Seçim `~/Library/Application Support/Hermes/settings.json`'da saklanır; her sunucunun oturumu ayrıdır |
| Kısayollar | ⌘1 Ana sayfa · ⌘2 İşler · ⌘3 Zaman girişi · ⌘4 Toplantılar · ⌘[ / ⌘] geri/ileri; Düzen menüsü (kopyala/yapıştır) |
| Dock rozeti | Okunmamış bildirim sayısı (web uygulaması `window.hermesDesktop.setBadgeCount` ile bildirir) |
| Derin link | `hermes://work/TASK-56`, `hermes://open/<yol>` |
| Çevrimdışı | Sunucuya ulaşılamazsa yerel "Tekrar dene" sayfası |
| Pencere | Boyut/konum hatırlanır |

## Güvenlik

- `contextIsolation` + `sandbox`; sayfaya Node/Electron API'si açılmaz. Tek köprü
  `window.hermesDesktop` (rozet); ana süreç mesajın seçili sunucu origin'inden
  geldiğini ayrıca doğrular.
- Pencere yalnız sunucu origin'inde ve Microsoft giriş sayfalarında gezinir;
  diğer linkler (Teams toplantısı, dış siteler) varsayılan tarayıcıda açılır;
  `javascript:`/`file:` engellenir.
- Sertifika istisnası **yalnız** hermes-dev (`84.247.180.172:30772`, ingress'in
  sahte sertifikası) için.
- İzinler: yalnız bildirim/pano/tam ekran; kamera, mikrofon, konum reddedilir.
- Uygulamada secret yok; oturum sitedekiyle aynı HttpOnly cookie
  (`persist:hermes` bölmesi).

## Geliştirme ve derleme

```bash
cd desktop
npm install
npm test                 # gezinme / derin link / ayar testleri
npm start                # geliştirme penceresi
npm run dist             # dist/Hermes-<sürüm>-arm64.dmg + -x64.dmg (ad-hoc imzalı)
```

Not: `ELECTRON_RUN_AS_NODE` ortam değişkeni tanımlıysa uygulama açılmaz
(`env -u ELECTRON_RUN_AS_NODE npm start`).

İkon: `build/icon.png` (1024) → `build/icon.icns`, Hermes logosundan
(`frontend/src/assets/logos/logo-icon-light.png`) üretildi.

CI: `.github/workflows/desktop-build.yml` (elle tetiklenir, macOS runner) iki
.dmg'yi artifact olarak üretir.

## Sıradaki (landing page öncesi)

1. **İmza + notarization:** Apple Developer ID Application sertifikası +
   App Store Connect API anahtarı (GitHub secret; repoya girmez) →
   `mac.identity`, `hardenedRuntime: true`, `notarize: true`.
2. **Otomatik güncelleme:** `electron-updater` + yayın kanalı (GitHub
   Releases veya kendi sunucumuz). Kabuk nadiren değişir; web içeriği zaten
   her açılışta güncel.
3. Yeni tasarımla birlikte `titleBarStyle: 'hiddenInset'` (pencere başlığı
   kalkar, "dynamic island" gezinme trafik ışıklarının yanına oturur).
