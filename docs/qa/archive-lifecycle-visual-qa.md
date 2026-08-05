# Work Item Archive Lifecycle — Görsel QA kaydı

Tarih: 2026-08-06 · Ölçüm makinesi: yerel (Chromium/Playwright)

## Alınan kareler (12, hash kontrolü ile mükerrer YOK)

Masaüstü 1440×900, light + dark:

| Sahne | Ne doğrulandı |
|---|---|
| `toggle` | Arşiv düğmesi kapalı (nötr çerçeve) ve açık (marka mavisi çerçeve + tonal zemin) durumları |
| `archive` | Arşiv görünümü: üç sütun (Rejected YOK), arşivlenmiş kartlar, arşiv rozeti |
| `archiveModal` | Arşivleme onayı — "silme değil" dili, çoklu atamada hepsinin birlikte arşivlendiği bilgisi |
| `restoreModal` | Geri al ve yeniden aç — açık assignment seçimi, hedef durum |
| `empty` | Boş durum |

Mobil 390×844, light + dark: `archive` (arşiv listesi)

## Manuel doğrulanan noktalar

- Arşiv düğmesi durumu YALNIZ renkle anlatılmıyor: `aria-pressed` +
  "Show/Hide archived work items" erişilebilir adı taşıyor.
- Arşiv tarihi ve sebebi METİNLE ayırt edilebiliyor
  ("Auto-archived · 28 Jul 2026" / "Archived manually · 28 Jul 2026").
- Rejected sütunu Board/Explorer'da GÖRÜNMÜYOR (üründen kaldırıldı).
- Çoklu atamalı iş arşivde de TEK kart olarak görünüyor.
- Mobilde yatay sayfa taşması YOK — ölçüldü (`scrollWidth <= clientWidth`,
  her iki temada da `false`).
- Ekran görüntülerinde gerçek secret/token yok; fixture verisi kullanıldı.
- 12 karenin hash'i benzersiz — mükerrer/sahte kare yok.

## Kapsanmayanlar (dürüst kayıt)

- Oturum açılmış GERÇEK uygulama üzerinden değil, bileşenler fixture ile
  mount edilerek alındı (kimlik bilgisi hiçbir yere yazılmıyor).
- Sürükle-bırak ve çoklu-atama onay penceresinin kareleri alınmadı.
- Gerçek arşivleme canlıda henüz gözlenmedi: dev'de arşive uygun tek iş
  var ve 7 günü dolmadı.
