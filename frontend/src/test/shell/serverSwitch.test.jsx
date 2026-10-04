/**
 * =============================================================================
 * Masaustu sunucu anahtari (Test ⇄ Dev)
 * =============================================================================
 *   1. Tarayicida (kopru yok) HICBIR SEY cizilmez.
 *   2. Prod'a (test) bagli masaustu penceresinde anahtar GORUNMEZ.
 *   3. Dev'deyken secili sunucu basili; test'e tek tik → switchServer;
 *      secili sunucuya tiklamak istek gondermez.
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

    it('prod (test) penceresinde gorunmez', () => {
        window.hermesDesktop = {
            getServers: () => ({ current: 'test', servers: [{ id: 'test', label: 'Test' }, { id: 'dev', label: 'Dev' }] }),
            switchServer: vi.fn(),
        }
        const { container } = render(<ServerSwitch />)
        expect(container).toBeEmptyDOMElement()
    })

    it('dev penceresinde test e tek tikla donus', () => {
        const switchServer = vi.fn()
        window.hermesDesktop = {
            getServers: () => ({ current: 'dev', servers: [{ id: 'test', label: 'Test' }, { id: 'dev', label: 'Dev' }] }),
            switchServer,
        }
        render(<ServerSwitch />)
        expect(screen.getByRole('button', { name: /Dev/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Dev/ }))
        expect(switchServer).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /Test/ }))
        expect(switchServer).toHaveBeenCalledWith('test')
    })
})
