/**
 * Hermes Liquid — masaustu pencere kromu (R6).
 *
 * Pencere `hiddenInset` basliksiz acilir: trafik isiklari sivi zeminin
 * ustunde durur. Surukleme bolgesi WEB uygulamasina gomulmez (tarayicida
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
.login-page .login-theme-switch { -webkit-app-region: no-drag; }
`

module.exports = { TRAFFIC_LIGHTS, DRAG_CSS }
