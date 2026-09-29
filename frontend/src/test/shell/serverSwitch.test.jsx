/**
 * =============================================================================
 * Masaustu sunucu anahtari (Test ⇄ Dev)
 * =============================================================================
 *   1. Tarayicida (kopru yok) HICBIR SEY cizilmez.
 *   2. Masaustunde secili sunucu basili; digerine tek tik → switchServer.
 *   3. Secili sunucuya tiklamak istek gondermez.
 * =============================================================================
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ServerSwitch from '../../components/layout/ServerSwitch'

afterEach(() => { delete window.hermesDesktop })

describe('ServerSwitch', () => {
    it('tarayicida cizilmez', () => {
        const { container } = render(<ServerSwitch />)
        expect(container).toBeEmptyDOMElement()
    })

    it('masaustunde tek tikla gecis', () => {
        const switchServer = vi.fn()
        window.hermesDesktop = {
            getServers: () => ({ current: 'test', servers: [{ id: 'test', label: 'Test' }, { id: 'dev', label: 'Dev' }] }),
            switchServer,
        }
        render(<ServerSwitch />)
        expect(screen.getByRole('button', { name: /Test/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Test/ }))
        expect(switchServer).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /Dev/ }))
        expect(switchServer).toHaveBeenCalledWith('dev')
    })
})
