/**
 * HERMES - Dil secimi SAYFA ICERIGINI de cevirir, yalniz menuyu degil.
 *
 * Gercek bir sikayetten dogdu (2026-09-01): "sol menu Turkce'ye donuyor
 * ama iceridekiler Ingilizce kaliyor". Sebep kodda degil dagitimdaydi —
 * ceviriler henuz o ortama inmemisti. Yine de bu testler eksikti: dil
 * altyapisi YALNIZCA gezinme uzerinden dogrulaniyordu.
 *
 * Buradaki testler menuye HIC bakmaz; modal ve form iceriginin gercekten
 * dil degistirdigini kilitler.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '../utils'
import { useLocaleStore } from '../../stores/localeStore'
import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'

describe('sayfa/modal icerigi dile uyar', () => {
    beforeEach(() => {
        useLocaleStore.getState().setLocale('en')
    })

    it('talep formu Turkce secilince Turkce doner', () => {
        useLocaleStore.getState().setLocale('tr')
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={vi.fn()}
                groupName="ArGe Team" routeReady
            />,
        )
        // Baslik, alan etiketleri ve buton — ucu de sozlukten gelmeli.
        expect(screen.getByText('Yeni destek talebi')).toBeInTheDocument()
        expect(screen.getByLabelText('Kategori')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Gönder/ })).toBeInTheDocument()
        // Ingilizce KALINTI olmamali.
        expect(screen.queryByText('New support request')).toBeNull()
    })

    it('ayni form Ingilizce secilince Ingilizce doner', () => {
        renderWithProviders(
            <CreateTicketModal
                open onCancel={vi.fn()} onSubmit={vi.fn()}
                groupName="ArGe Team" routeReady
            />,
        )
        expect(screen.getByText('New support request')).toBeInTheDocument()
        expect(screen.queryByText('Yeni destek talebi')).toBeNull()
    })

    it('ortak onay modalinin VARSAYILAN metinleri de cevrilir', () => {
        // Varsayilan parametre degerleri hook cagiramaz; govdede
        // cozuluyor. Bu test o cozumun gercekten calistigini kilitler.
        useLocaleStore.getState().setLocale('tr')
        renderWithProviders(
            <DangerConfirmModal open onConfirm={vi.fn()} onCancel={vi.fn()} />,
        )
        expect(screen.getByRole('button', { name: /Sil/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Vazgeç/ })).toBeInTheDocument()
    })
})
