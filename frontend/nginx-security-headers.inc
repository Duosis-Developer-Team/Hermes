# =============================================================================
# HERMES Frontend - Guvenlik header'lari (TEK KAYNAK)
# =============================================================================
# NEDEN AYRI DOSYA: nginx `add_header` direktiflerini alt seviyeye YALNIZCA
# o seviyede HIC add_header yoksa devralir. `Cache-Control` tanimlayan her
# location (`/assets/`, `/index.html`, `/env-config.js`) bu yuzden
# server seviyesindeki guvenlik header'larini SESSIZCE dusuruyordu —
# Sprint 5.1'de yerel container'da olculdu: `/` bile X-Frame-Options,
# nosniff, Referrer-Policy ve CSP OLMADAN donuyordu (`/` icin
# `try_files ... /index.html` ic yonlendirmesi `location = /index.html`
# blogunu devreye sokar ve o blogun add_header'i devralmayi kirar).
#
# Cozum: header setini TEK yerde tutup ilgili her seviyeye `include` ile
# enjekte etmek. Metinsel kopya yok, tek kaynak var; bir header eklemek
# veya degistirmek icin tek dosya duzenlenir.
#
# `.inc` uzantisi bilincli: nginx `conf.d/*.conf` dosyalarini kendiliginden
# server blogu olarak yukler, bu parca ise yalniz include edilmelidir.
#
# `always` bayragi hata cevaplarinda da (404/50x) header'in yazilmasini
# saglar.
#
# NOT: CSP bu turda YENIDEN TASARLANMADI ve yeni external origin
# EKLENMEDI — mevcut sozlesme birebir tasindi.
# =============================================================================

add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://84.247.180.172:30772; img-src 'self' data:; connect-src 'self' https://84.247.180.172:30772 http://84.247.180.172:30772;" always;
