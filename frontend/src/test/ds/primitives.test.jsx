/**
 * DS V2 primitive testleri (Sprint 2 §10): 15 primitive render olur;
 * erisilebilirlik sozlesmeleri (aria-label, role, aria-pressed) ve
 * ConfirmDialog pending kilidi dogrulanir.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
    AppModal, Button, Card, ConfirmDialog, EmptyState, FilterChip,
    IconButton, Inline, InlineError, Metric, Page, PageHeader, Stack,
    StatusBadge, Surface, Toolbar,
} from '../../components/ui'

describe('layout primitifleri', () => {
    it('Surface/Card/Page/Stack/Inline/Toolbar render olur', () => {
        render(
            <Page data-testid="page">
                <Surface data-testid="surface">s</Surface>
                <Card data-testid="card">c</Card>
                <Stack data-testid="stack"><span>a</span></Stack>
                <Inline data-testid="inline"><span>b</span></Inline>
                <Toolbar data-testid="toolbar"><Toolbar.Spacer /></Toolbar>
            </Page>
        )
        for (const id of ['page','surface','card','stack','inline','toolbar'])
            expect(screen.getByTestId(id)).toBeInTheDocument()
    })

    it('interactive Card klavye-erisilebilir (tabIndex+role)', () => {
        render(<Card interactive data-testid="ic">x</Card>)
        const el = screen.getByTestId('ic')
        expect(el).toHaveAttribute('tabindex', '0')
        expect(el).toHaveAttribute('role', 'button')
        expect(el.className).toContain('h-card--interactive')
    })

    it('non-interactive Card hareket sinifi TASIMAZ (§11)', () => {
        render(<Card data-testid="nc">x</Card>)
        expect(screen.getByTestId('nc').className)
            .not.toContain('h-card--interactive')
    })

    it('PageHeader baslik hiyerarsisi kurar', () => {
        render(<PageHeader title="Başlık" subtitle="Alt" extra={<b>E</b>} />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Başlık')
    })
})

describe('durum/veri primitifleri', () => {
    it('StatusBadge ton siniflari + bilinmeyen ton fallback', () => {
        const { rerender } = render(<StatusBadge tone="success">OK</StatusBadge>)
        expect(screen.getByText('OK').className).toContain('h-badge--success')
        rerender(<StatusBadge tone="nonsense">OK</StatusBadge>)
        expect(screen.getByText('OK').className).toContain('h-badge--neutral')
    })

    it('Metric tabular deger gosterir', () => {
        render(<Metric label="Toplam" value="42,5 saat" hint="bu hafta" />)
        expect(screen.getByText('Toplam')).toBeInTheDocument()
        expect(screen.getByText('42,5 saat').className).toContain('h-metric__value')
    })

    it('EmptyState role=status, InlineError role=alert', () => {
        render(<><EmptyState title="Kayıt yok" /><InlineError>Hata</InlineError></>)
        expect(screen.getByRole('status')).toHaveTextContent('Kayıt yok')
        expect(screen.getByRole('alert')).toHaveTextContent('Hata')
    })
})

describe('etkilesim primitifleri', () => {
    it('IconButton erisilebilir ad tasir', () => {
        render(<IconButton label="Sil" icon={<span>x</span>} />)
        expect(screen.getByRole('button', { name: 'Sil' })).toBeInTheDocument()
    })

    it('Button variant→AntD type eslemesi', () => {
        render(<Button variant="primary">Kaydet</Button>)
        expect(screen.getByRole('button', { name: 'Kaydet' }).className)
            .toContain('ant-btn-primary')
    })

    it('FilterChip aria-pressed durumunu yansitir', () => {
        const { rerender } = render(<FilterChip>Hepsi</FilterChip>)
        expect(screen.getByRole('button', { name: 'Hepsi' }))
            .toHaveAttribute('aria-pressed', 'false')
        rerender(<FilterChip active>Hepsi</FilterChip>)
        expect(screen.getByRole('button', { name: 'Hepsi' }))
            .toHaveAttribute('aria-pressed', 'true')
    })
})

describe('overlay primitifleri', () => {
    it('ConfirmDialog: butonlar, danger ve onConfirm', () => {
        const onConfirm = vi.fn()
        render(
            <ConfirmDialog
                open title="Emin misin?" description="Geri alınamaz"
                danger confirmText="Sil" onConfirm={onConfirm}
                onCancel={() => {}}
            />
        )
        const del = screen.getByRole('button', { name: 'Sil' })
        expect(del.className).toContain('ant-btn-dangerous')
        fireEvent.click(del)
        expect(onConfirm).toHaveBeenCalledOnce()
    })

    it('pending: kapanma kilitli, etiket anlamini korur (§7)', () => {
        const onCancel = vi.fn()
        render(
            <ConfirmDialog
                open pending title="İşlem" confirmText="Sil"
                onConfirm={() => {}} onCancel={onCancel}
            />
        )
        // Vazgec disabled; onay butonu hala "Sil" der (loading'te bile)
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
        expect(screen.getByRole('button', { name: /Sil/ })).toBeInTheDocument()
        // X kapatma butonu pending'te yok
        expect(document.querySelector('.ant-modal-close')).toBeNull()
    })

    it('AppModal pending degilken kapatilabilir', () => {
        render(<AppModal open title="M" onCancel={() => {}}>i</AppModal>)
        expect(document.querySelector('.ant-modal-close')).not.toBeNull()
    })
})
