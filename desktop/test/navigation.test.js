const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classify, deepLinkToUrl } = require('../src/navigation')
const { serverById, readSettings, writeSettings } = require('../src/servers')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const TEST = 'https://hermes.duosis.com'

test('gezinme siniflandirmasi', () => {
    assert.equal(classify('https://hermes.duosis.com/project-management?view=x', TEST), 'internal')
    assert.equal(classify('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1', TEST), 'auth')
    assert.equal(classify('https://teams.microsoft.com/l/meetup-join/abc', TEST), 'external')
    assert.equal(classify('mailto:a@b.com', TEST), 'external')
    assert.equal(classify('https://hermes.duosis.com.evil.io/', TEST), 'external')
    assert.equal(classify('http://login.microsoftonline.com/', TEST), 'external') // https degil → auth sayilmaz
    assert.equal(classify('javascript:alert(1)', TEST), 'blocked')
    assert.equal(classify('file:///etc/passwd', TEST), 'blocked')
    assert.equal(classify('not a url', TEST), 'blocked')
    // Dev sunucusu secili iken test origin'i dis sitedir.
    assert.equal(classify('https://hermes.duosis.com/', 'https://84.247.180.172:30772'), 'external')
})

test('hermes:// derin linkleri', () => {
    assert.equal(deepLinkToUrl('hermes://work/task-56', TEST), 'https://hermes.duosis.com/work/TASK-56')
    assert.equal(deepLinkToUrl('hermes://open/project-management/issues?item=abc', TEST),
        'https://hermes.duosis.com/project-management/issues?item=abc')
    assert.equal(deepLinkToUrl('hermes://work/../../etc', TEST), null)
    assert.equal(deepLinkToUrl('hermes://open/..%2F..%2Fx', TEST), null)
    assert.equal(deepLinkToUrl('hermes://open/https:%2F%2Fevil.io', TEST), null)
    assert.equal(deepLinkToUrl('https://work/TASK-1', TEST), null)
    assert.equal(deepLinkToUrl('hermes://unknown/x', TEST), null)
})

test('sunucu katalogu ve ayarlar', () => {
    assert.equal(serverById('dev').url, 'https://84.247.180.172:30772')
    assert.equal(serverById('nope').id, 'test') // bilinmeyen → varsayilan
    assert.equal(serverById(undefined).id, 'test')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-desktop-'))
    assert.deepEqual(readSettings(dir), {})
    writeSettings(dir, { serverId: 'dev' })
    writeSettings(dir, { bounds: { width: 1200 } })
    assert.deepEqual(readSettings(dir), { serverId: 'dev', bounds: { width: 1200 } })
    fs.writeFileSync(path.join(dir, 'settings.json'), '{bozuk')
    assert.deepEqual(readSettings(dir), {})
})
