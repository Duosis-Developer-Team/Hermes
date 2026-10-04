/**
 * =============================================================================
 * Kayan oturum — 401'de tek ucuslu yenileme + BIR KEZ tekrar
 * =============================================================================
 * Erisim cerezi 60 dk'da duser; tenant istegi 401 alinca httpClient
 * POST /api/v1/auth/session/refresh cagirir (yenileme cerezi HttpOnly),
 * sonra istegi bir kez tekrarlar. Kilitlenen sozlesmeler:
 *   - ayni anda 401 alan istekler TEK yenilemeyi paylasir;
 *   - tekrar da 401 alirsa ikinci yenileme YOK (dongu yok) -> cikis;
 *   - yenileme reddedilirse mevcut cikis davranisi (store logout);
 *   - giris/cikis/yenileme uclarinin 401'i yenileme tetiklemez.
 */
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    SESSION_REFRESH_PATH, createApiClient, refreshSession, sessionRefreshClient,
} from '../../api/httpClient'
import { useAuthStore } from '../../stores/authStore'

const respond = (config, status, data = {}) => {
    const response = { data, status, statusText: String(status), headers: {}, config, request: {} }
    if (status >= 400) {
        throw new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
    }
    return response
}

const tick = () => new Promise((r) => { setTimeout(r, 0) })

/**
 * Sahte sunucu: `expired` true iken tenant istekleri 401 doner; yenileme
 * basarili olursa `expired` false olur. Cagri sayilari kaydedilir.
 */
function makeServer({ refreshStatus = 200, alwaysUnauthorized = false } = {}) {
    const state = { expired: true, calls: [], refreshCalls: 0 }
    const api = createApiClient('')
    api.defaults.adapter = async (config) => {
        state.calls.push(config.url)
        await tick()
        if (alwaysUnauthorized || state.expired) return respond(config, 401)
        return respond(config, 200, { ok: config.url })
    }
    sessionRefreshClient.defaults.adapter = async (config) => {
        state.refreshCalls += 1
        expect(config.url).toBe(SESSION_REFRESH_PATH)
        expect(config.method).toBe('post')
        await tick()
        await tick()
        if (refreshStatus !== 200) return respond(config, refreshStatus)
        state.expired = false
        return respond(config, 200, { user: { id: 'u1' } })
    }
    return { api, state }
}

const originalRefreshAdapter = sessionRefreshClient.defaults.adapter

beforeEach(() => {
    useAuthStore.setState({
        user: { id: 'u1' }, tenant: { id: 't1' }, isAuthenticated: true,
        memberships: [], permissions: [],
    })
})

afterEach(() => {
    sessionRefreshClient.defaults.adapter = originalRefreshAdapter
})

describe('401 -> yenile -> bir kez tekrar', () => {
    it('istek yenilemeden sonra BIR KEZ tekrarlanir ve basarir', async () => {
        const { api, state } = makeServer()
        const res = await api.get('/api/v1/core/tasks')
        expect(res.data).toEqual({ ok: '/api/v1/core/tasks' })
        expect(state.refreshCalls).toBe(1)
        expect(state.calls).toEqual(['/api/v1/core/tasks', '/api/v1/core/tasks'])
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })

    it('eszamanli 401ler TEK yenilemeyi paylasir (single-flight)', async () => {
        const { api, state } = makeServer()
        const results = await Promise.all([
            api.get('/a'), api.get('/b'), api.post('/c', { x: 1 }),
        ])
        expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c'])
        expect(state.refreshCalls).toBe(1)
        // Her istek tam iki kez: ilk deneme + tek tekrar.
        for (const url of ['/a', '/b', '/c']) {
            expect(state.calls.filter((u) => u === url)).toHaveLength(2)
        }
    })

    it('tekrar da 401 alirsa ikinci yenileme YOK, cikis yapilir (dongu yok)', async () => {
        const { api, state } = makeServer({ alwaysUnauthorized: true })
        await expect(api.get('/x')).rejects.toMatchObject({ response: { status: 401 } })
        expect(state.refreshCalls).toBe(1)
        expect(state.calls).toEqual(['/x', '/x'])
        expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('yenileme reddedilirse istek tekrarlanmaz ve mevcut cikis davranisi isler', async () => {
        const { api, state } = makeServer({ refreshStatus: 401 })
        const err = await api.get('/x').catch((e) => e)
        expect(err.response.status).toBe(401)
        expect(err.normalized).toBeTruthy()
        expect(state.refreshCalls).toBe(1)
        expect(state.calls).toEqual(['/x'])
        expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('eszamanli 401ler, yenileme reddedilince hepsi reddedilir; yenileme tek kez', async () => {
        const { api, state } = makeServer({ refreshStatus: 401 })
        const out = await Promise.allSettled([api.get('/a'), api.get('/b')])
        expect(out.map((o) => o.status)).toEqual(['rejected', 'rejected'])
        expect(state.refreshCalls).toBe(1)
    })

    it.each([
        '/api/v1/auth/token',
        '/api/v1/auth/microsoft',
        '/api/v1/auth/logout',
        SESSION_REFRESH_PATH,
    ])('%s 401i yenileme TETIKLEMEZ', async (url) => {
        const { api, state } = makeServer()
        await expect(api.post(url)).rejects.toMatchObject({ response: { status: 401 } })
        expect(state.refreshCalls).toBe(0)
        expect(state.calls).toEqual([url])
    })

    it('401 disi hatalar yenileme tetiklemez', async () => {
        const { api, state } = makeServer()
        api.defaults.adapter = async (config) => respond(config, 403)
        await expect(api.get('/x')).rejects.toMatchObject({ response: { status: 403 } })
        expect(state.refreshCalls).toBe(0)
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })

    it('refreshSession ardisik cagrilarda ayni ucusu paylasir, bitince yenisini acar', async () => {
        const { state } = makeServer()
        const p1 = refreshSession()
        const p2 = refreshSession()
        expect(p1).toBe(p2)
        await p1
        expect(state.refreshCalls).toBe(1)
        await refreshSession()
        expect(state.refreshCalls).toBe(2)
    })
})

describe('platform istemcisi etkilenmez', () => {
    it('platformApi kendi axios ornegini kullanir, yenileme ucunu bilmez', async () => {
        const { readFileSync } = await import('node:fs')
        const { resolve } = await import('node:path')
        const src = readFileSync(resolve(process.cwd(), 'src/api/platformApi.js'), 'utf-8')
        expect(src).not.toMatch(/session\/refresh|refreshSession|httpClient/)
    })
})
