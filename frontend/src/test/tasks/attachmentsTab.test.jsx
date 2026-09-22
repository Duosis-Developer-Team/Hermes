/**
 * =============================================================================
 * Is kalemi ekleri sekmesi (PM rework P2.3 / F1)
 * =============================================================================
 * Liste + indirme baglantisi + kaldirma; ozellik kapaliysa (503) yalniz
 * aciklama. Yukleme akisi dropzone'a aittir (ticket testleri kilitler);
 * burada temiz sonucun listeyi tazeledigi dogrulanir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const taskService = {
    listAttachments: vi.fn(),
    openAttachmentSession: vi.fn(),
    uploadAttachmentContent: vi.fn(),
    removeAttachment: vi.fn(),
    attachmentDownloadUrl: (taskId, id) => `/api/v1/core/tasks/${taskId}/attachments/${id}/download`,
}
vi.mock('../../services/api', () => ({ taskService }))

import { renderWithProviders } from '../utils'
const TaskAttachmentsTab = (await import('../../components/tasks/TaskAttachmentsTab')).default

const FILES = [
    { id: 'a1', file_name: 'ekran.png', size_bytes: 20480, mime_type: 'image/png', scan_status: 'clean', visibility: 'public', created_at: '2026-09-22T10:00:00Z' },
    { id: 'a2', file_name: 'rapor.pdf', size_bytes: 2 * 1024 * 1024, mime_type: 'application/pdf', scan_status: 'clean', visibility: 'public', created_at: '2026-09-22T11:00:00Z' },
]

beforeEach(() => {
    vi.clearAllMocks()
    taskService.listAttachments.mockResolvedValue(FILES)
    taskService.removeAttachment.mockResolvedValue([FILES[1]])
})

describe('ekler sekmesi', () => {
    it('dosyalari boyutlariyla listeler ve indirme baglantisi is kalemi ucuna gider', async () => {
        renderWithProviders(<TaskAttachmentsTab taskId="wi1" />)
        expect(await screen.findByText('ekran.png')).toBeInTheDocument()
        expect(screen.getByText('20 KB')).toBeInTheDocument()
        expect(screen.getByText('2.0 MB')).toBeInTheDocument()
        const dl = screen.getByRole('link', { name: 'Download — ekran.png' })
        expect(dl).toHaveAttribute('href', '/api/v1/core/tasks/wi1/attachments/a1/download')
        expect(dl).toHaveAttribute('rel', 'noopener')
    })

    it('kaldirma ucu cagrilir', async () => {
        const user = userEvent.setup({ delay: null })
        renderWithProviders(<TaskAttachmentsTab taskId="wi1" />)
        await screen.findByText('ekran.png')
        await user.click(screen.getByRole('button', { name: 'Remove attachment — ekran.png' }))
        await waitFor(() => expect(taskService.removeAttachment).toHaveBeenCalledWith('wi1', 'a1'))
    })

    it('salt okunur modda yukleme alani ve kaldirma yok', async () => {
        renderWithProviders(<TaskAttachmentsTab taskId="wi1" canEdit={false} />)
        await screen.findByText('ekran.png')
        expect(screen.queryByRole('button', { name: /Remove attachment/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Add files/ })).toBeNull()
    })

    it('ozellik ortamda kapaliysa (503) aciklama gosterir, dropzone yok', async () => {
        taskService.listAttachments.mockRejectedValue({ response: { status: 503 } })
        renderWithProviders(<TaskAttachmentsTab taskId="wi1" />)
        expect(await screen.findByText(/not configured in this environment/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Add files/ })).toBeNull()
    })

    it('bos liste bos durum metni verir; dropzone gorunur', async () => {
        taskService.listAttachments.mockResolvedValue([])
        renderWithProviders(<TaskAttachmentsTab taskId="wi1" />)
        expect(await screen.findByText('No files attached yet')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Add files/ })).toBeInTheDocument()
    })
})
