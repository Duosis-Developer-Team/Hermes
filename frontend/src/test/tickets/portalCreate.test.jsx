/**
 * HERMES - Yeni talep formu: hedef ekip READONLY, tanilama ALLOWLIST.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import { renderWithProviders } from '../utils'

describe('create ticket modal', () => {
    it('hedef ekip degistirilemez bir bilgi kutusudur', () => {
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={vi.fn()}
                groupName="DevOps Team" routeReady
            />,
        )
        expect(screen.getByText('DevOps Team')).toBeInTheDocument()
        expect(
            screen.getByText(/cannot be changed here/),
        ).toBeInTheDocument()
        // Ekip SECICISI YOK: son kullanici ekip secmez.
        expect(screen.queryByLabelText(/Target team/)).toBeNull()
    })

    it('route yoksa gonderim kapalidir', () => {
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={vi.fn()} routeReady={false}
            />,
        )
        expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled()
    })

    it('otomatik tanilama YALNIZCA allowlist alanlari icerir', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={onSubmit}
                groupName="DevOps Team" routeReady
            />,
        )
        await user.click(screen.getByLabelText('Category'))
        await user.click(await screen.findByTitle('Bug'))
        await user.click(screen.getByLabelText('Impact'))
        await user.click((await screen.findAllByText(/Single user/))[0])
        await user.type(
            screen.getByLabelText('Title'), 'Save button is broken',
        )
        await user.type(
            screen.getByLabelText('Description'),
            'After pressing save the operation never completes and the page hangs.',
        )
        await user.click(screen.getByRole('button', { name: /Submit/ }))

        expect(onSubmit).toHaveBeenCalled()
        const [payload, idempotencyKey] = onSubmit.mock.calls[0]
        expect(idempotencyKey).toMatch(/^portal-/)

        const allowed = new Set([
            'environment', 'page_path', 'browser', 'os', 'locale',
            'timezone', 'client_timestamp', 'app_version', 'device_class',
        ])
        Object.keys(payload.client_context).forEach((key) => {
            expect(allowed.has(key)).toBe(true)
        })
        // Cerez/token/oturum bilgisi ASLA toplanmaz.
        const serialised = JSON.stringify(payload).toLowerCase()
        expect(serialised).not.toContain('cookie')
        expect(serialised).not.toContain('authorization')
        expect(serialised).not.toContain('token')
    })

    it('kapatilan istege bagli alanin degeri KAYBOLMAZ', async () => {
        // Kilitlenen sey MEKANIZMA degil DAVRANIS: "istege bagli alana
        // yaz, bolumu kapat, gonder" akisinda deger yola cikmalidir.
        // Bugun bunu AntD'nin panel-mount davranisi sagliyor; yarin
        // katlama bicimi degisirse test yine dusecek.
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={onSubmit}
                groupName="DevOps Team" routeReady
            />,
        )
        await user.click(screen.getByLabelText('Category'))
        await user.click(await screen.findByTitle('Bug'))
        await user.click(screen.getByLabelText('Impact'))
        await user.click((await screen.findAllByText(/Single user/))[0])
        await user.type(screen.getByLabelText('Title'), 'Export fails')
        await user.type(
            screen.getByLabelText('Description'),
            'The export button returns an error every time.',
        )
        // Bolumu ac, yaz ve TEKRAR KAPAT — riskli akis budur, cunku
        // form `preserve={false}` tasir: alan bir gun gercekten unmount
        // olursa yazilan ayrinti sessizce kaybolur.
        await user.click(screen.getByText(/Add more detail/))
        await user.type(
            await screen.findByLabelText('Steps to reproduce'),
            'Open reports, press export.',
        )
        await user.click(screen.getByText(/Add more detail/))
        await user.click(screen.getByRole('button', { name: /Submit/ }))

        expect(onSubmit).toHaveBeenCalled()
        const [payload] = onSubmit.mock.calls[0]
        expect(payload.reproduction_steps).toBe('Open reports, press export.')
    })
})
