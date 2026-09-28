// Hermes Liquid R6: surukleme bolgesi kontrolleri YUTMAMALI.
const test = require('node:test')
const assert = require('node:assert/strict')
const { TRAFFIC_LIGHTS, DRAG_CSS } = require('../src/windowChrome')

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

test('masaustunde web zemini saydam, sivi katman gizli (vibrancy gorunur)', () => {
    const { TRANSPARENT_CSS, VIBRANCY } = require('../src/windowChrome')
    assert.match(TRANSPARENT_CSS, /html, body[^{]*\{ background: transparent !important; \}/)
    assert.match(TRANSPARENT_CSS, /\.liquid-backdrop \{ display: none !important; \}/)
    assert.equal(VIBRANCY, 'under-window')
})
