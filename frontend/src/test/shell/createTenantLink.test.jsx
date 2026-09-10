/**
 * =============================================================================
 * Tenant olusturma sonucu — ADRES her zaman gosterilir
 * =============================================================================
 * Sahip zaten kayitli bir kullaniciysa parola uretilmez. Eskiden bu durumda
 * konsol yalnizca toast gosteriyor, yeni tenant'in adresini HIC vermiyordu
 * (duotest, 2026-09-03): operator tenant'i acip kimseye ulastiramadi.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/platformApi', () => ({
    platformService: {
        listPlans: vi.fn().mockResolvedValue([]),
        createTenant: vi.fn(),
    },
}))

import { platformService } from '../../api/platformApi'
import { CreateTenantModal } from '../../pages/platform/PlatformConsole'

const RESULT = {
    tenant: { id: 't1', slug: 'acme', display_name: 'Acme', status: 'active' },
    owner: { email: 'can@duosis.com', created: false },
    one_time_password: null,
    workspace_hint: '/?workspace=acme',
}

const fillAndCreate = async (user) => {
    await user.type(screen.getByPlaceholderText('Acme Industries'), 'Acme')
    await user.type(screen.getByPlaceholderText('acme'), 'acme')
    await user.type(screen.getByPlaceholderText('admin@acme.com'), 'can@duosis.com')
    await user.click(screen.getByRole('button', { name: 'Create' }))
}

const renderModal = (onDone) => render(
    <MemoryRouter>
        <CreateTenantModal open onClose={vi.fn()} onDone={onDone} />
    </MemoryRouter>,
)

describe('olusturma sonrasi adres', () => {
    beforeEach(() => platformService.createTenant.mockReset())

    it('mevcut sahip (parola YOK) icin de tam adres gosterilir', async () => {
        platformService.createTenant.mockResolvedValue(RESULT)
        const onDone = vi.fn()
        const user = userEvent.setup({ delay: null })
        renderModal(onDone)

        await fillAndCreate(user)

        expect(await screen.findByText(`${window.location.origin}/?workspace=acme`))
            .toBeInTheDocument()
        expect(screen.getByText('can@duosis.com')).toBeInTheDocument()
        // Parola alani YALNIZCA yeni kullanici yaratildiysa.
        expect(screen.queryByText(/shown once/)).toBeNull()
        // Operator adresi gormeden ekran kapanmaz.
        expect(onDone).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'OK' }))
        await waitFor(() => expect(onDone).toHaveBeenCalled())
    })

    it('yeni sahip icin adres + tek seferlik parola birlikte', async () => {
        platformService.createTenant.mockResolvedValue({
            ...RESULT,
            owner: { email: 'can@duosis.com', created: true },
            one_time_password: 'Tek-Sefer-123',
        })
        const user = userEvent.setup({ delay: null })
        renderModal(vi.fn())

        await fillAndCreate(user)

        expect(await screen.findByText(`${window.location.origin}/?workspace=acme`))
            .toBeInTheDocument()
        expect(screen.getByText('Tek-Sefer-123')).toBeInTheDocument()
        expect(screen.getByText(/shown once/)).toBeInTheDocument()
    })
})
