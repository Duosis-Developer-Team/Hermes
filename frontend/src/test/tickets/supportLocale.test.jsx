/**
 * HERMES - Destek tarafi dil: TR secildiginde talep acma penceresi
 * (kategori, etki + aciklamasi) ve ek uyarilari Turkce gelir; hata kodu
 * aciklamalari kullanicinin dilindedir.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useLocaleStore } from '../../stores/localeStore'
import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import ResolveModal from '../../features/tickets/ResolveModal'
import { useTicketErrorText } from '../../features/tickets/useTicketLabel'

afterEach(() => {
    useLocaleStore.getState().setLocale('en')
    resetAuthStore()
})

describe('destek tarafi Turkce', () => {
    it('talep acma penceresi secili dilde', async () => {
        useLocaleStore.getState().setLocale('tr')
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        renderWithProviders(<CreateTicketModal open onCancel={vi.fn()} onSubmit={vi.fn()} routeReady groupName="Destek" />)
        const dialog = await screen.findByRole('dialog')
        const [category, impact] = dialog.querySelectorAll('.ant-select-selector')
        await user.click(category)
        expect(await screen.findByText('Hata')).toBeInTheDocument()
        await user.click(impact)
        expect(await screen.findByText('Yalnız siz etkileniyorsunuz ve çalışmaya devam edebiliyorsunuz.')).toBeInTheDocument()
        expect(screen.queryByText(/Only you are affected/)).toBeNull()
    })

    it('hata kodlari kullanicinin dilinde', () => {
        useLocaleStore.getState().setLocale('tr')
        const { result } = renderHook(() => useTicketErrorText())
        expect(result.current('rate_limited', 'x')).toBe('Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.')
        expect(result.current('unknown_code', 'Yedek metin')).toBe('Yedek metin')
    })

    it('cozum penceresi: turler Turkce, onizleme musteri kartinin aynisi', async () => {
        useLocaleStore.getState().setLocale('tr')
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        renderWithProviders(<ResolveModal open onCancel={vi.fn()} onSubmit={vi.fn()} ticket={{ version: 1 }} />)
        const dialog = await screen.findByRole('dialog')
        expect(screen.getByText('Çözüm özetini yazdıkça müşterinin göreceği kart burada belirir.')).toBeInTheDocument()

        await user.click(dialog.querySelector('.ant-select-selector'))
        await user.click(await screen.findByText('Düzeltildi'))
        expect(screen.queryByText('Fixed')).toBeNull()

        await user.type(screen.getByLabelText('Müşteriye görünen çözüm özeti'), 'Kayit hatasi giderildi.')
        await user.type(screen.getByLabelText('Düzeltme sürümü (isteğe bağlı, müşteriye görünür)'), '2.4.1')
        const card = dialog.querySelector('.h-ticket-resolve-preview .h-ticket-resolution')
        expect(card).not.toBeNull()
        expect(card).toHaveTextContent('Çözüldü')
        expect(card).toHaveTextContent('Düzeltildi')
        expect(card).toHaveTextContent('Kayit hatasi giderildi.')
        expect(card).toHaveTextContent('Düzeltme sürümü: 2.4.1')
    })
})
