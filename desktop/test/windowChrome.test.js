// Hermes Liquid R6: surukleme bolgesi kontrolleri YUTMAMALI.
const test = require('node:test')
const assert = require('node:assert/strict')
const {
    TRAFFIC_LIGHTS, DRAG_CSS, OVERLAY_WIDTH, overlayFor, windowOptionsFor, chromeCssFor,
} = require('../src/windowChrome')

test('macOS: hiddenInset + trafik isiklari, overlay/menu gizleme YOK', () => {
    for (const dark of [true, false]) {
        const o = windowOptionsFor('darwin', dark)
        assert.deepEqual(o, { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS })
    }
})

test('Windows: hidden + titleBarOverlay, tema renkleri, menu Alt ile', () => {
    const dark = windowOptionsFor('win32', true)
    assert.equal(dark.titleBarStyle, 'hidden')
    assert.equal(dark.trafficLightPosition, undefined)
    assert.equal(dark.autoHideMenuBar, true)
    assert.deepEqual(dark.titleBarOverlay, { color: '#07080A', symbolColor: '#FFFFFF', height: 40 })
    const light = windowOptionsFor('win32', false)
    assert.deepEqual(light.titleBarOverlay, { color: '#D6DBE3', symbolColor: '#0E131B', height: 40 })
    assert.deepEqual(overlayFor(false), light.titleBarOverlay)
})

test('Windows CSS: ada sistem dugmelerinin altina girmez, merkez kaymaz', () => {
    assert.equal(chromeCssFor('darwin'), DRAG_CSS)
    const win = chromeCssFor('win32')
    assert.ok(win.startsWith(DRAG_CSS))
    assert.ok(OVERLAY_WIDTH >= 138)
    assert.match(win, new RegExp(`\\.main-header \\{ padding-left: ${OVERLAY_WIDTH}px; padding-right: ${OVERLAY_WIDTH}px; \\}`))
})

test('ada ve icindeki tum kontroller no-drag', () => {
    assert.match(DRAG_CSS, /\.main-header \.island,\s*\.main-header \.island \* \{ -webkit-app-region: no-drag; \}/)
})

test('ustte her sayfada ince surukleme seridi var (giris ekrani dahil)', () => {
    assert.match(DRAG_CSS, /html::after \{[^}]*-webkit-app-region: drag;/)
    const h = Number(/height: (\d+)px/.exec(DRAG_CSS)[1])
    assert.ok(h > 0 && h <= 16, 'serit adanin tiklanabilir alanina tasmamali')
})

test('trafik isiklari adanin ustunde degil, sol kenarda', () => {
    assert.ok(TRAFFIC_LIGHTS.x <= 24 && TRAFFIC_LIGHTS.y <= 28)
})

