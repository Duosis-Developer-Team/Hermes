/**
 * HERMES - Ek yukleme alani: asenkron yukleme EN SON listeye yazar.
 *
 * Canli hata (14.10): dosya sunucuda yuklenip temiz cikiyordu ama alan
 * birakma anindaki eski listeye yazdigi icin ekrandan dusuyor, talebe hic
 * baglanmiyordu. Hem setter (portal/ajan) hem dizi alan onChange (is
 * kalemi ekleri) ile dogrulanir.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '../utils'
import AttachmentDropzone from '../../features/tickets/AttachmentDropzone'
import { readyAttachmentIds } from '../../features/tickets/attachmentState'

const png = (name) => new File([new Uint8Array(64)], name, { type: 'image/png' })

function Harness({ onOpenSession, onUploadContent, spy, arrayOnly = false }) {
    const [items, setItems] = useState([])
    spy(items)
    return (
        <AttachmentDropzone
            enabled
            value={items}
            onChange={arrayOnly ? (next) => setItems(next) : setItems}
            onOpenSession={onOpenSession}
            onUploadContent={onUploadContent}
        />
    )
}

const services = () => {
    let n = 0
    return {
        onOpenSession: vi.fn(async () => ({ id: `s${++n}` })),
        onUploadContent: vi.fn(async (id) => ({ id, scan_status: 'clean', scan_error_code: null })),
    }
}

describe('ek yukleme alani', () => {
    it.each([false, true])('birakilan dosyalar listede kalir ve hazir olur (arrayOnly=%s)', async (arrayOnly) => {
        const svc = services()
        let last = []
        renderWithProviders(<Harness {...svc} arrayOnly={arrayOnly} spy={(v) => { last = v }} />)
        const zone = screen.getByRole('button', { name: /drag and drop|add files/i })

        fireEvent.drop(zone, { dataTransfer: { files: [png('a.png'), png('b.png')] } })

        await waitFor(() => expect(screen.getAllByText('Ready')).toHaveLength(2))
        expect(screen.getByText('a.png')).toBeInTheDocument()
        expect(screen.getByText('b.png')).toBeInTheDocument()
        expect(readyAttachmentIds(last).sort()).toEqual(['s1', 's2'])
    })

    it('yapistirilan ekran goruntusu de eklenir', async () => {
        const svc = services()
        let last = []
        renderWithProviders(<Harness {...svc} spy={(v) => { last = v }} />)
        const zone = screen.getByRole('button', { name: /drag and drop|add files/i })

        fireEvent.paste(zone, { clipboardData: { files: [png('image.png')] } })

        await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
        expect(readyAttachmentIds(last)).toEqual(['s1'])
        expect(svc.onOpenSession).toHaveBeenCalledWith(expect.objectContaining({
            file_name: 'image.png', declared_mime_type: 'image/png',
        }))
    })
})
