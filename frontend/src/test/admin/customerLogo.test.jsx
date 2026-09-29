/**
 * =============================================================================
 * Musteri logosu (CTO 29.09)
 * =============================================================================
 *   1. Form: dosya secilince yuklenmez; musteri KAYDEDILINCE PUT edilir ve
 *      depo aninda guncellenir. Tur/boyut on kontrolu istek atmaz.
 *   2. Kaldir: mevcut logo formla birlikte DELETE edilir.
 *   3. CustomerLogo: etag varsa gorsel (etag'li URL), yoksa bas harf.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const customerService = {
    getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    uploadLogo: vi.fn(), deleteLogo: vi.fn(),
}
vi.mock('../../services/api', () => ({ customerService }))

const CustomersPage = (await import('../../pages/admin/CustomersPage')).default
const { CustomerLogo } = await import('../../components/liquid')
const { useCustomerLogoStore } = await import('../../stores/customerLogoStore')
const { makeTestQueryClient } = await import('../utils')

const CUSTOMERS = [
    { id: 'c1', name: 'Vakko', is_active: true, has_logo: true, logo_etag: 'e1' },
    { id: 'c2', name: 'Beko', is_active: true, has_logo: false, logo_etag: null },
]

const renderPage = () => render(
    <QueryClientProvider client={makeTestQueryClient()}><CustomersPage /></QueryClientProvider>,
)
const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' })

beforeEach(() => {
    vi.clearAllMocks()
    customerService.getAll.mockResolvedValue(CUSTOMERS)
    useCustomerLogoStore.setState({ etags: {} })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
    globalThis.URL.revokeObjectURL = vi.fn()
})

describe('Musteri logosu', () => {
    it('tabloda logo etagli URL ile, logosuz musteri bas harfle', async () => {
        renderPage()
        await screen.findByText('Vakko')
        const img = document.querySelector('img[src*="/customers/c1/logo?v=e1"]')
        expect(img).toBeTruthy()
        const beko = screen.getByText('Beko').closest('.admin-name')
        expect(beko.querySelector('img')).toBeNull()
        expect(beko.querySelector('.lq-clogo')).toHaveTextContent('B')
    })

    it('yeni musteri: dosya kayitta PUT edilir, depo guncellenir', async () => {
        const user = userEvent.setup({ delay: null })
        customerService.create.mockResolvedValue({ id: 'c9', name: 'Arcelik' })
        customerService.uploadLogo.mockResolvedValue({ has_logo: true, logo_etag: 'new' })
        renderPage()
        await screen.findByText('Vakko')
        await user.click(screen.getByRole('button', { name: /New Customer/ }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText(/Customer Name/i), 'Arcelik')
        const input = dialog.querySelector('[data-testid="customer-logo-input"]')
        fireEvent.change(input, { target: { files: [png()] } })
        expect(customerService.uploadLogo).not.toHaveBeenCalled()
        expect(dialog.querySelector('img[src="blob:preview"]')).toBeTruthy()
        await user.click(within(dialog).getByRole('button', { name: 'Create' }))
        await waitFor(() => expect(customerService.uploadLogo).toHaveBeenCalledTimes(1))
        expect(customerService.uploadLogo.mock.calls[0][0]).toBe('c9')
        expect(useCustomerLogoStore.getState().etags.c9).toBe('new')
    })

    it('tur ve boyut on kontrolu: istek yok, onizleme yok', async () => {
        const user = userEvent.setup({ delay: null })
        renderPage()
        await screen.findByText('Vakko')
        await user.click(screen.getByRole('button', { name: /New Customer/ }))
        const dialog = await screen.findByRole('dialog')
        const input = dialog.querySelector('[data-testid="customer-logo-input"]')
        fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] } })
        fireEvent.change(input, { target: { files: [png(256 * 1024 + 1)] } })
        expect(dialog.querySelector('img[src="blob:preview"]')).toBeNull()
        expect(await screen.findByText('Only PNG, JPG or WEBP can be uploaded.')).toBeInTheDocument()
        expect(await screen.findByText('The logo can be at most 256 KB.')).toBeInTheDocument()
    })

    it('duzenle + kaldir: guncellemeden sonra DELETE', async () => {
        const user = userEvent.setup({ delay: null })
        customerService.update.mockResolvedValue({ ...CUSTOMERS[0] })
        customerService.deleteLogo.mockResolvedValue()
        useCustomerLogoStore.setState({ etags: { c1: 'e1' } })
        renderPage()
        const row = (await screen.findByText('Vakko')).closest('tr')
        await user.click(within(row).getAllByRole('button')[0])
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
        await user.click(within(dialog).getByRole('button', { name: 'Update' }))
        await waitFor(() => expect(customerService.deleteLogo).toHaveBeenCalledWith('c1'))
        expect(customerService.uploadLogo).not.toHaveBeenCalled()
        expect(useCustomerLogoStore.getState().etags.c1).toBeUndefined()
    })

    it('CustomerLogo depodan okur; etag yoksa bas harf', () => {
        useCustomerLogoStore.setState({ etags: { x: 'abc' } })
        const { container, rerender } = render(<CustomerLogo id="x" name="Xerox" />)
        expect(container.querySelector('img').getAttribute('src')).toBe('/api/v1/core/customers/x/logo?v=abc')
        rerender(<CustomerLogo id="y" name="Yapi" />)
        expect(container.querySelector('img')).toBeNull()
        expect(container.textContent).toBe('Y')
    })
})
