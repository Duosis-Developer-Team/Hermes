/**
 * Hermes Liquid — masaustu pencere kromu (R6).
 *
 * macOS'ta pencere `hiddenInset` basliksiz acilir: trafik isiklari sivi
 * zeminin ustunde durur (Windows: `hidden` + `titleBarOverlay`, asagida).
 * Surukleme bolgesi WEB uygulamasina gomulmez (tarayicida
 * anlamsiz); yalnizca burada, yuklenen sayfaya `insertCSS` ile eklenir:
 *   - her sayfada en ustte ince bir surukleme seridi (giris ekrani dahil),
 *   - kabukta ada satirinin bos kismi surukler; adanin KENDISI ve icindeki
 *     tum kontroller tiklanabilir kalir (no-drag).
 */
const TRAFFIC_LIGHTS = { x: 20, y: 22 }

const DRAG_CSS = `
html::after {
    content: "";
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 14px;
    z-index: 2147483646;
    -webkit-app-region: drag;
}
.main-header { -webkit-app-region: drag; }
.main-header .island,
.main-header .island * { -webkit-app-region: no-drag; }
.login-page .lg-island { -webkit-app-region: drag; }
.login-page .lg-island button,
.login-page .lg-island [role="group"] { -webkit-app-region: no-drag; }
`

// Windows (ve Linux): trafik isiklari yok; `hidden` + `titleBarOverlay`
// ile sistemin kucult/buyut/kapat dugmeleri sayfanin sag ustune cizilir.
// Renkler sivi zeminin tonunda (--h-liquid-base); tema degisince main.js
// setTitleBarOverlay ile gunceller.
const OVERLAY_HEIGHT = 40
const OVERLAY_WIDTH = 150 // Windows'ta 3 dugme ~138px + pay

function overlayFor(dark) {
    return dark
        ? { color: '#07080A', symbolColor: '#FFFFFF', height: OVERLAY_HEIGHT }
        : { color: '#D6DBE3', symbolColor: '#0E131B', height: OVERLAY_HEIGHT }
}

/** Platforma gore basliksiz pencere secenekleri (BrowserWindow'a yayilir). */
function windowOptionsFor(platform, dark) {
    if (platform === 'darwin') {
        return { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS }
    }
    return {
        titleBarStyle: 'hidden',
        titleBarOverlay: overlayFor(dark),
        // Menu cubugu gizli; Alt ile acilir (Sunucu menusu + kisayollar calisir).
        autoHideMenuBar: true,
    }
}

// Yalniz macOS disi: ada ortada kalir ama sagdaki sistem dugmelerinin
// altina girmez — simetrik yatay bosluk (merkez kaymaz). Giris ekraninin
// adasi en fazla 720px ve ortali; minWidth 1024'te iki yanda ~150px
// kaldigi icin ona dokunulmaz.
const OVERLAY_CSS = `
.main-header { padding-left: ${OVERLAY_WIDTH}px; padding-right: ${OVERLAY_WIDTH}px; }
`

/** Sayfaya eklenecek CSS: surukleme + (macOS disi) dugme boslugu. */
function chromeCssFor(platform) {
    return platform === 'darwin' ? DRAG_CSS : DRAG_CSS + OVERLAY_CSS
}

module.exports = {
    TRAFFIC_LIGHTS,
    DRAG_CSS,
    OVERLAY_HEIGHT,
    OVERLAY_WIDTH,
    overlayFor,
    windowOptionsFor,
    chromeCssFor,
}
