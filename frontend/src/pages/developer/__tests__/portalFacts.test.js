/**
 * Developer Portal — GERCEK DURUM kilidi.
 *
 * Neden var: portal bir kez canli urunden saptigi icin ("MCP coming
 * later" derken MCP canliydi, "internal beta" derken servis aktifti)
 * bu testler dokumantasyonu gercege bagli tutar. Iki tur iddia:
 *
 *   1) VERI  — mcpClients.js dogrudan import edilir (saf JS).
 *   2) METIN — JSX kaynaklari metin olarak taranir. DOM render YOK:
 *      buradaki sorular "su ifade var mi / yok mu" seklinde, yani
 *      backend'deki _FORBIDDEN_SPEC_MARKERS taramasiyla ayni desen.
 *      Kirilgan bir render agacina bagimlilik eklemeye degmez.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MCP_CLIENTS, VERIFIED_CLIENTS } from '../mcpClients'

const HERE = dirname(fileURLToPath(import.meta.url))
const SECTIONS = join(HERE, '..', 'sections')

const read = (f) => readFileSync(join(SECTIONS, f), 'utf8')

const MCP = read('McpSection.jsx')
const OVERVIEW = read('OverviewSection.jsx')
const REFERENCE = read('ApiReferenceSection.jsx')
const CHANGELOG = read('ChangelogSection.jsx')
const LIMITS = read('KnownLimitationsSection.jsx')

describe('MCP durumu artik Active', () => {
    it('MCP bolumu servisi Active gosterir', () => {
        expect(MCP).toContain('<Tag color="green">Active</Tag>')
        expect(MCP).toContain('MCP service')
    })

    it('Overview ayri bir MCP durum blogu tasir', () => {
        expect(OVERVIEW).toContain('MCP Status')
        expect(OVERVIEW).toContain('is-mcp')
        // API Status canli kalir; ikisi karistirilmaz.
        expect(OVERVIEW).toContain('API Status')
    })

    it('bearer destegi ve OAuth eksigi AYRI yeteneklerdir', () => {
        expect(MCP).toContain('Bearer-token integrations')
        expect(MCP).toContain('Native OAuth connector support')
        expect(MCP).toContain('Not yet available')
    })
})

describe('bayat ifadeler kalkti (gercek degisti)', () => {
    // DIKKAT: "not yet tested" bu listede DEGIL — o, matristeki gecerli
    // bir client DURUMU ve efsanesi ("Not yet tested means exactly
    // that"). Bayat olan, URUNU tanimlayan dildir.
    const STALE = ['internal beta', 'internal-beta', 'coming later']

    it('MCP bolumunde bayat durum dili yok', () => {
        const lower = MCP.toLowerCase()
        for (const phrase of STALE) {
            expect(lower).not.toContain(phrase)
        }
    })

    it('Overview MCP i beta olarak etiketlemez', () => {
        expect(OVERVIEW.toLowerCase()).not.toContain('internal beta')
    })

    it('"not claimed" dili yalnizca OAuth icin kullanilir', () => {
        // Genel "external compatibility not claimed" iddiasi kalkti;
        // OAuth sinirlamasi ise ACIKCA durur (asagida ayrica test edilir).
        expect(MCP).not.toContain('external MCP compatibility')
    })
})

describe('OAuth sinirlamasi ACIKCA duruyor (silinmedi)', () => {
    it('Known Limitations OAuth maddesi tasir', () => {
        expect(LIMITS).toContain('OAuth 2.1 authorization server')
        expect(LIMITS).toContain('cannot connect directly')
    })

    it('OAuth in kimlik modelini degistirmeyecegi soylenir', () => {
        expect(LIMITS).toContain('never a second permission model')
    })

    it('MCP bolumu native connector kisitini soyler', () => {
        expect(MCP).toContain('native')
        expect(MCP).toContain('OAuth')
    })
})

describe('client uyumluluk matrisi = gercek kanit', () => {
    it('her satirin kanit kaynagi vardir', () => {
        for (const row of MCP_CLIENTS) {
            expect(row.evidence, row.client).toBeTruthy()
            expect(row.transport, row.client).toBeTruthy()
            expect(row.auth, row.client).toBeTruthy()
        }
    })

    it('Verified yalnizca gercekten denenmis client lar icindir', () => {
        expect(VERIFIED_CLIENTS).toEqual(['Claude Code', 'Cursor', 'Codex'])
    })

    it('denenmemis client Verified olamaz', () => {
        for (const row of MCP_CLIENTS) {
            if (/no test run recorded/i.test(row.evidence)) {
                expect(row.status, row.client).not.toBe('Verified')
            }
        }
    })

    it('OpenAI tooling kanit olmadan Verified degil', () => {
        const openai = MCP_CLIENTS.find((c) => c.key === 'openai-mcp')
        expect(openai.status).toBe('Not yet tested')
    })

    it('Claude Desktop native connector Limited olarak isaretli', () => {
        const d = MCP_CLIENTS.find((c) => c.key === 'claude-desktop-native')
        expect(d.status).toBe('Limited')
    })

    it('matris bolumu veriden render edilir (elle satir yok)', () => {
        expect(MCP).toContain('MCP_CLIENTS')
        expect(MCP).not.toContain("status: 'Not yet tested'")
    })
})

describe('grup atama her yuzeyde dokumante', () => {
    it('API Reference yeni ucu listeler', () => {
        expect(REFERENCE).toContain('/task-groups')
        expect(REFERENCE).toContain('assignment_batch_id')
    })

    it('MCP bolumu yeni tool u ve kurallarini anlatir', () => {
        expect(MCP).toContain('hermes_create_task_for_group')
        expect(MCP).toContain('POST /api/public/v1/task-groups')
        expect(MCP).toContain('skipped_count')
        expect(MCP).toContain('created_count')
    })

    it('atlanan uye ve assigner kurallari durustce yazilmis', () => {
        expect(MCP).toContain('skipped')
        expect(MCP).toContain('assigner is excluded')
        expect(MCP).toContain('nothing is created')
    })

    it('ornekler kurgusal veri kullanir', () => {
        // Gosterilen HER token apacik yer tutucu olmali (yalnizca x).
        // Gercek bir token/host/isim portalda ASLA yer almaz.
        // Yalnizca TOKEN DEGERI gorunumundekiler; duz metindeki
        // "<code>hms_dev_</code>" gibi prefix anlatimlari degil.
        const tokens = MCP.match(/hms_(?:live|dev)_[A-Za-z0-9]{8,}/g) || []
        expect(tokens.length).toBeGreaterThan(0)
        for (const t of tokens) {
            expect(t).toMatch(/^hms_(?:live|dev)_x+$/)
        }
        expect(MCP).toContain('<your-hermes-host>')
        expect(MCP).toContain('fictional')
    })
})

describe('changelog additive surumu tasir', () => {
    it('yeni surum kaydi var', () => {
        expect(CHANGELOG).toContain("version: 'v1.2.0'")
        expect(CHANGELOG).toContain('task-groups')
        expect(CHANGELOG).toContain('hermes_create_task_for_group')
    })

    it('MCP durum yukseltmesi ve dogrulanan client lar kayitli', () => {
        expect(CHANGELOG).toContain('ACTIVE')
        expect(CHANGELOG).toContain('Claude')
        expect(CHANGELOG).toContain('Cursor')
        expect(CHANGELOG).toContain('Codex')
    })

    it('OAuth eksigi changelog da da durust kalir', () => {
        expect(CHANGELOG).toContain('native OAuth connector is')
    })
})
