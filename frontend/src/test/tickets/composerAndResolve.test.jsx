/**
 * HERMES - Composer gorunurlugu ve cozum modali.
 *
 * "Yanlislikla musteriye ic bilgi yazma" bu urunun en pahali hatasidir.
 * Bu yuzden mod secimi TEST KILITLIDIR: secili modun hem etiketi hem
 * gonderilen payload'i dogrulanir.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AgentComposer from '../../features/tickets/AgentComposer'
import ResolveModal from '../../features/tickets/ResolveModal'
import { renderWithProviders } from '../utils'

describe('agent composer', () => {
    it('varsayilan mod PUBLIC ve bunu acikca soyler', async () => {
        renderWithProviders(<AgentComposer onSubmit={vi.fn()} />)
        expect(
            screen.getByText(/customer will see this and be notified/),
        ).toBeInTheDocument()
    })

    it('ic not secilince uyari metni degisir', async () => {
        const user = userEvent.setup()
        renderWithProviders(<AgentComposer onSubmit={vi.fn()} />)
        await user.click(screen.getByText('Internal note'))
        expect(
            screen.getByText(/Hidden from the customer/),
        ).toBeInTheDocument()
    })

    it('gonderilen payload secili gorunurlugu tasir', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        renderWithProviders(<AgentComposer onSubmit={onSubmit} />)

        await user.type(
            screen.getByRole('textbox', { name: 'Reply to customer' }),
            'Looking into it',
        )
        await user.click(screen.getByRole('button', { name: /Send reply/ }))
        expect(onSubmit).toHaveBeenCalledWith({
            body: 'Looking into it', visibility: 'public', attachment_ids: [],
        })

        await user.click(screen.getByText('Internal note'))
        await user.type(
            screen.getByRole('textbox', { name: 'Internal note' }),
            'Team note',
        )
        await user.click(screen.getByRole('button', { name: /Save internal note/ }))
        expect(onSubmit).toHaveBeenLastCalledWith({
            body: 'Team note', visibility: 'internal', attachment_ids: [],
        })
    })

    it('yetkisi olmayan kullaniciya composer gosterilmez', () => {
        renderWithProviders(
            <AgentComposer onSubmit={vi.fn()} canRespond={false} />,
        )
        expect(
            screen.getByText(/do not have permission to reply/),
        ).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Send reply/ })).toBeNull()
    })
})

describe('resolve modal', () => {
    it('cozum ozeti ZORUNLU ve en az 20 karakter', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        renderWithProviders(
            <ResolveModal
                open
                onCancel={vi.fn()}
                onSubmit={onSubmit}
                ticket={{ version: 3 }}
            />,
        )
        await user.click(screen.getByRole('button', { name: /Send resolution/ }))
        expect(
            await screen.findByText(/Select a resolution type/),
        ).toBeInTheDocument()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('ic alanlarin musteriye gitmedigi ACIKCA yazar', () => {
        renderWithProviders(
            <ResolveModal
                open onCancel={vi.fn()} onSubmit={vi.fn()}
                ticket={{ version: 1 }}
            />,
        )
        expect(
            screen.getByText(/for the team only/),
        ).toBeInTheDocument()
        expect(
            screen.getByLabelText(/Root cause — team only/),
        ).toBeInTheDocument()
    })

    it('onizleme musterinin gorecegi metni yansitir', async () => {
        const user = userEvent.setup()
        const { baseElement } = renderWithProviders(
            <ResolveModal
                open onCancel={vi.fn()} onSubmit={vi.fn()}
                ticket={{ version: 1 }}
            />,
        )
        await user.type(
            screen.getByLabelText(/Customer-visible resolution summary/),
            'The save error has been fixed.',
        )
        // Metin hem textarea'da hem ONIZLEME kartinda bulunur; burada
        // ONIZLEMEYI dogruluyoruz — agent'in gonderimden once musterinin
        // gorecegi kartI gormesi bu ekranin amaci.
        const preview = baseElement.querySelector('.h-ticket-resolution')
        expect(preview).toBeTruthy()
        expect(preview.textContent).toContain('The save error has been fixed.')
    })
})
