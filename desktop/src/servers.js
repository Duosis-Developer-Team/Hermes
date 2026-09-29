/**
 * Hermes masaustu — sunucu katalogu ve kalici tercih.
 *
 * Uygulama bir "kabuk"tur: sunucudaki Hermes'i kendi penceresinde acar.
 * Oturum (HttpOnly cookie), tenant (host'tan) ve Microsoft SSO sitedekiyle
 * birebir calisir. Hangi sunucuya baglanilacagi menuden secilir ve
 * userData/settings.json icinde saklanir (secret YOK — yalniz secim).
 */
const fs = require('node:fs')
const path = require('node:path')

const SERVERS = Object.freeze([
    Object.freeze({
        id: 'test',
        label: 'Hermes (hermes.duosis.com)',
        short: 'Test',
        url: 'https://hermes.duosis.com',
        // Gecerli, kamuya acik sertifika — istisna YOK.
        allowSelfSigned: false,
    }),
    Object.freeze({
        id: 'dev',
        label: 'Hermes Dev (84.247.180.172:30772)',
        short: 'Dev',
        url: 'https://84.247.180.172:30772',
        // hermes-dev ingress'i Kubernetes'in sahte sertifikasini sunar;
        // istisna YALNIZ bu host:port icin gecerlidir (main.js).
        allowSelfSigned: true,
    }),
])

const DEFAULT_SERVER_ID = 'test'

function serverById(id) {
    return SERVERS.find((s) => s.id === id) || SERVERS.find((s) => s.id === DEFAULT_SERVER_ID)
}

function readSettings(dir) {
    try {
        const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function writeSettings(dir, patch) {
    const next = { ...readSettings(dir), ...patch }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(next, null, 2))
    return next
}

module.exports = { SERVERS, DEFAULT_SERVER_ID, serverById, readSettings, writeSettings }
