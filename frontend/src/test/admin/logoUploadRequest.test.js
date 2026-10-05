/**
 * Logo yuklemesi gercek axios donusumunden gecer (canli bug kilidi):
 * istemcinin varsayilan JSON basligi FormData'yi JSON'a ceviriyordu,
 * dosya `{}` gidiyor ve sunucu 422 donuyordu.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { coreClient } from '../../api/httpClient'
import { customerService, projectService } from '../../services/api'

const original = coreClient.defaults.adapter
afterEach(() => { coreClient.defaults.adapter = original })

function capture() {
    const seen = []
    coreClient.defaults.adapter = async (config) => {
        seen.push(config)
        return { data: { has_logo: true, logo_etag: 'e1' }, status: 200, statusText: 'OK', headers: {}, config }
    }
    return seen
}

describe('logo upload request', () => {
    it.each([
        ['customer', customerService, '/api/v1/core/customers/c1/logo'],
        ['project', projectService, '/api/v1/core/projects/c1/logo'],
    ])('%s logo FormData olarak gider (JSON degil)', async (_k, service, url) => {
        const seen = capture()
        const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' })
        await expect(service.uploadLogo('c1', file)).resolves.toMatchObject({ logo_etag: 'e1' })
        expect(seen).toHaveLength(1)
        expect(seen[0].url).toBe(url)
        expect(seen[0].method).toBe('put')
        expect(seen[0].data).toBeInstanceOf(FormData)
        expect(seen[0].data.get('file')).toBeInstanceOf(File)
    })
})
