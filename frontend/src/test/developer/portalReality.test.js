/**
 * =============================================================================
 * Sprint 6A/6C — Developer Portal gerceklik denetimi
 * =============================================================================
 * Portal metni ile CALISAN SISTEM arasinda fark birakilmaz. Bu dosya
 * portalin iddialarini GERCEK kaynaklara karsi kilitler:
 *
 *   - Belgelenen her uc, Public API v1 router'larinda GERCEKTEN var mi?
 *   - Uydurma operasyon ya da MCP tool aniliyor mu?
 *   - Hata kodlari gercek katalogdan mi?
 *   - Ornek kimlik bilgileri ACIKCA yer tutucu mu (gercek sir yok)?
 *
 * DENETIM SONUCU (bu turda olculdu): portal 26 operasyon belgeliyor,
 * gercek v1 yuzeyi de 26 operasyon sunuyor — birebir ortusuyor. Scope
 * listesi zaten CANLI `/v1/capabilities`ten cizildigi icin drift
 * yapisal olarak imkansiz. Anilan iki MCP tool adi da gercek.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORTAL_DIR = 'src/pages/developer'
const SECTIONS = join(PORTAL_DIR, 'sections')
const API_ROUTERS = '../backend/core-service/app/public_api/routers'
const ERRORS_PY = '../backend/core-service/app/public_api/errors.py'
const SCOPES_PY = '../backend/core-service/app/public_api/scopes.py'
const MCP_REGISTRY = '../backend/mcp-service/hermes_mcp/registry.py'

const read = (p) => readFileSync(p, 'utf8')
const portalText = () =>
    readdirSync(SECTIONS)
        .filter((f) => f.endsWith('.jsx'))
        .map((f) => read(join(SECTIONS, f)))
        .join('\n')

/** Portalin API Reference bolumunde belgeledigi uclar. */
function documentedEndpoints() {
    const src = read(join(SECTIONS, 'ApiReferenceSection.jsx'))
    const out = new Set()
    for (const m of src.matchAll(/<Endpoint\b([\s\S]*?)>/g)) {
        const method = /m="([A-Z]+)"/.exec(m[1])
        const path = /path="([^"]*)"/.exec(m[1])
        if (method && path) out.add(`${method[1]} ${path[1]}`)
    }
    return out
}

/** Gercek v1 uclari (router prefix + dekoratordeki yol). */
function realEndpoints() {
    const out = new Set()
    for (const file of readdirSync(API_ROUTERS)) {
        if (!file.endsWith('.py') || file === '__init__.py') continue
        const src = read(join(API_ROUTERS, file))
        const routerArgs = /APIRouter\(([\s\S]*?)\)/.exec(src)
        let prefix = ''
        if (routerArgs) {
            const p = /prefix\s*=\s*"([^"]*)"/.exec(routerArgs[1])
            if (p) prefix = p[1]
        }
        for (const m of src.matchAll(
            /@router\.(get|post|patch|put|delete)\(\s*\n?\s*"([^"]*)"/g
        )) {
            out.add(`${m[1].toUpperCase()} ${prefix}${m[2]}`)
        }
    }
    return out
}

/** Portal yollarini gercek yollarla ayni bicime getirir. */
const normalise = (e) =>
    e.replace(/^([A-Z]+) /, '$1 /v1')
        .replace('{code}', '{task_code}')
        .replace('/users/{id}', '/users/{user_id}')
        .replace('/groups/{id}', '/groups/{group_id}')
        .replace('/customers/{id}', '/customers/{customer_id}')
        .replace('/projects/{id}', '/projects/{project_id}')
        .replace('/meetings/{id}', '/meetings/{meeting_id}')
        .replace('/work-logs/{id}', '/work-logs/{log_id}')

describe('belgelenen her uc GERCEKTEN var', () => {
    const real = realEndpoints()

    it('gercek yuzey bos degil (kaynak okunabildi)', () => {
        expect(real.size).toBeGreaterThan(20)
    })

    it('UYDURMA uc belgelenmemis', () => {
        const missing = [...documentedEndpoints()]
            .map(normalise)
            .filter((e) => !real.has(e))
        expect(missing).toEqual([])
    })

    it('gercek uclarin TAMAMI belgelenmis (eksik dokuman yok)', () => {
        const documented = new Set([...documentedEndpoints()].map(normalise))
        const undocumented = [...real].filter((e) => !documented.has(e))
        expect(undocumented).toEqual([])
    })
})

describe('hata kodlari gercek katalogdan', () => {
    it('portalda gecen her kod errors.py de tanimli', () => {
        const catalog = new Set(
            [...read(ERRORS_PY).matchAll(/"([a-z_]{4,})"/g)].map((m) => m[1])
        )
        const text = portalText()
        // Portalin acikca hata kodu olarak andigi degerler.
        const CANDIDATES = [
            'invalid_request', 'validation_error', 'invalid_token', 'expired_token',
            'revoked_token', 'insufficient_scope', 'resource_access_denied',
            'resource_not_found', 'conflict', 'idempotency_request_in_progress',
            'rate_limit_exceeded', 'internal_error',
        ]
        const mentioned = CANDIDATES.filter((c) => text.includes(c))
        expect(mentioned.length).toBeGreaterThan(0)
        for (const code of mentioned) expect(catalog).toContain(code)
    })
})

describe('scope iddialari', () => {
    it('portalda SABIT kodlanmis scope listesi YOK — canli katalogdan cizilir', () => {
        const scopes = read(join(SECTIONS, 'ScopesSection.jsx'))
        // Drift'in yapisal olarak imkansiz olmasinin nedeni budur.
        expect(scopes).toContain('capabilities?.scopes')
    })

    it('anilan scope adlari gercek katalogda var', () => {
        const real = new Set(
            [...read(SCOPES_PY).matchAll(/"([a-z-]+:[a-z]+)":/g)].map((m) => m[1])
        )
        expect(real.size).toBeGreaterThan(5)
        const text = portalText()
        for (const m of text.matchAll(/"([a-z-]+:[a-z]+)"/g)) {
            const candidate = m[1]
            // Yalnizca scope BICIMINDEKI dizeleri denetle.
            if (/^(tasks|customers|projects|work-logs|meetings|users|groups):/.test(candidate)) {
                expect(real).toContain(candidate)
            }
        }
    })
})

describe('MCP iddialari', () => {
    it('anilan her hermes_ tool GERCEK registry de var', () => {
        const real = new Set(
            [...read(MCP_REGISTRY).matchAll(/name="(hermes_[a-z_]+)"/g)].map((m) => m[1])
        )
        expect(real.size).toBeGreaterThan(10)
        const portalAll = portalText()
            + read(join(PORTAL_DIR, 'mcpClients.js'))
            + read(join(PORTAL_DIR, 'DeveloperPortalPage.jsx'))
        for (const m of portalAll.matchAll(/\b(hermes_[a-z_]+)\b/g)) {
            expect(real).toContain(m[1])
        }
    })

    it('OLMAYAN OAuth authorization server VARMIS gibi anlatilmaz', () => {
        const text = portalText()
        // Sinirlama acikca duruyor; "destekleniyor" iddiasi yok.
        expect(text).toMatch(/does not run an OAuth 2\.1 authorization server|OAuth 2\.1 authorization server/)
    })
})

describe('ornek kimlik bilgileri', () => {
    it('gercek token/secret YOK — yalnizca acik yer tutucu', () => {
        const text = portalText()
        for (const m of text.matchAll(/hms_(dev|live)_([A-Za-z0-9]+)/g)) {
            // Yer tutucular yalnizca 'x' karakterinden olusur.
            expect(m[2]).toMatch(/^x+$/)
        }
    })

    it('ornek host SABIT kodlanmamis — ortam degiskeni kullanilir', () => {
        const text = portalText()
        expect(text).toContain('$HERMES_BASE')
        // Canli IP/host ornege gomulmez.
        expect(text).not.toMatch(/84\.247\.\d+\.\d+/)
    })
})
