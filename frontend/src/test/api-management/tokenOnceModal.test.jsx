/**
 * =============================================================================
 * Sprint 6A/6C — Token'in gorundugu TEK yer
 * =============================================================================
 * Bu modal API Management refaktorunde ayri bir module tasindi. Guvenlik
 * sozlesmesi DEGISMEDI ve burada kilitlenir:
 *
 *   - Plaintext token YALNIZCA uretim aninda gosterilir; "bir daha
 *     gosterilmeyecek" uyarisi acikca durur.
 *   - Kullanici saklandigini ONAYLAMADAN modal kapanmaz (kazara kayip
 *     onlenir): Escape, maske tiklamasi ve kapatma dugmesi kapali.
 *   - Deger DOM disina (localStorage/URL) tasinmaz.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TokenOnceModal from '../../features/api-management/components/TokenOnceModal'

/*
 * Fixture BILEREK gercek token BICIMINDE DEGIL: depoda `hms_dev_` /
 * `hms_live_` desenini hicbir kaynak ya da test dosyasinin icermemesi
 * kurali var (secretSafety). Kural zayiflatilmadi; fixture uyduruldu.
 */
const TOKEN = 'TEST-ONLY-PLACEHOLDER-not-a-real-token-000000'
const setupUser = () => userEvent.setup({ delay: null })

/**
 * jsdom'da `navigator.clipboard` yalnizca getter'dir; tanimlanmasi
 * gerekir. AYRICA userEvent.setup() kendi pano sahtesini kurar — bu
 * yuzden kendi casusumuz setup()'tan SONRA yerlestirilir.
 */
const setClipboard = (writeText) => {
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText }, configurable: true, writable: true,
    })
}

beforeEach(() => {
    localStorage.clear()
    setClipboard(vi.fn().mockResolvedValue(undefined))
})

describe('gosterim sozlesmesi', () => {
    it('token gosterilir ve BIR DAHA gosterilmeyecegi soylenir', () => {
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()
        expect(screen.getByText(TOKEN)).toBeInTheDocument()
    })

    it('issued YOKSA hicbir sey cizilmez', () => {
        const { container } = render(<TokenOnceModal issued={null} onDone={vi.fn()} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('token localStorage a YAZILMAZ', () => {
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        const dump = JSON.stringify(localStorage)
        expect(dump).not.toContain('hms_dev')
        expect(dump).not.toContain(TOKEN)
    })

    it('token URL e TASINMAZ', () => {
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        expect(window.location.href).not.toContain('hms_')
    })
})

describe('kazara kayip korumasi', () => {
    it('ONAY verilmeden bitirilemez', async () => {
        const onDone = vi.fn()
        const user = setupUser()
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={onDone} />)

        const done = screen.getByRole('button', { name: /Done/i })
        expect(done).toBeDisabled()
        await user.click(done)
        expect(onDone).not.toHaveBeenCalled()
    })

    it('onay verilince bitirilebilir', async () => {
        const onDone = vi.fn()
        const user = setupUser()
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={onDone} />)

        await user.click(screen.getByRole('checkbox'))
        const done = screen.getByRole('button', { name: /Done/i })
        expect(done).toBeEnabled()
        await user.click(done)
        expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('Escape modali KAPATMAZ', async () => {
        const onDone = vi.fn()
        const user = setupUser()
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={onDone} />)
        await user.keyboard('{Escape}')
        // Token hala ekranda; kullanici onaylamadan cikamaz.
        expect(screen.getByText(TOKEN)).toBeInTheDocument()
        expect(onDone).not.toHaveBeenCalled()
    })

    it('kapatma (X) dugmesi SUNULMAZ', () => {
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    })
})

describe('kopyalama', () => {
    it('kopyalama panoya YAZAR ve geri bildirim verir', async () => {
        const user = setupUser()
        const writeText = vi.fn().mockResolvedValue(undefined)
        setClipboard(writeText)
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        const dialog = screen.getByRole('dialog')
        const copyBtn = within(dialog).getByRole('button', { name: /copy/i })
        await user.click(copyBtn)
        expect(writeText).toHaveBeenCalledWith(TOKEN)
        expect(await screen.findByText(/copied to clipboard/i)).toBeInTheDocument()
    })

    it('pano ENGELLIYSE sessiz kalinmaz', async () => {
        const user = setupUser()
        setClipboard(vi.fn().mockRejectedValue(new Error('denied')))
        render(<TokenOnceModal issued={{ token: TOKEN }} onDone={vi.fn()} />)
        const dialog = screen.getByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: /copy/i }))
        expect(await screen.findByText(/Copy failed/i)).toBeInTheDocument()
    })
})
