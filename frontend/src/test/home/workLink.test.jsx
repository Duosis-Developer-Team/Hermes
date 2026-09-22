/**
 * =============================================================================
 * PM rework P3.1 — `/work/:key` derin baglanti (E6)
 * =============================================================================
 *   1. Kod cozulunce is yuzeyi tur segmenti + ?item= ile acilir (replace).
 *   2. 404: sessiz "bulunamadi" + is yuzeyine donus; hata siniri yok.
 *   3. Anahtar sunucuya oldugu gibi gider (buyuk/kucuk harf sunucuda).
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'

const taskService = { getByKey: vi.fn() }
vi.mock('../../services/api', () => ({ taskService }))

import { renderWithProviders } from '../utils'
const WorkLinkPage = (await import('../../pages/WorkLinkPage')).default
const { workItemPath } = await import('../../features/home/model/home')

const Probe = () => {
    const loc = useLocation()
    return <div data-testid="probe">{loc.pathname + loc.search}</div>
}

const renderAt = (route) => renderWithProviders(
    <Routes>
        <Route path="/work/:key" element={<WorkLinkPage />} />
        <Route path="/project-management/:type" element={<Probe />} />
        <Route path="/project-management" element={<Probe />} />
    </Routes>,
    { route },
)

beforeEach(() => {
    vi.clearAllMocks()
})

describe('/work/:key', () => {
    it('kod cozulur ve is yuzeyi ?item= ile acilir', async () => {
        taskService.getByKey.mockResolvedValue({ id: 'wi1', task_code: 'ISSUE-3', task_type: 'issue' })
        renderAt('/work/issue-3')
        expect(await screen.findByTestId('probe')).toHaveTextContent('/project-management/issues?item=wi1')
        expect(taskService.getByKey).toHaveBeenCalledWith('issue-3')
    })

    it('bulunamayan kod: sessiz durum ve donus baglantisi', async () => {
        taskService.getByKey.mockRejectedValue({ response: { status: 404 } })
        renderAt('/work/TASK-999')
        expect(await screen.findByTestId('work-link-missing')).toBeInTheDocument()
        expect(screen.getByText('Work item not found')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Go to work items' })).toHaveAttribute('href', '/project-management')
    })

    it('workItemPath tur segmentini secer, bilinmeyen tur tasks', () => {
        expect(workItemPath({ id: 'a', task_type: 'suggestion' })).toBe('/project-management/suggestions?item=a')
        expect(workItemPath({ id: 'b' })).toBe('/project-management/tasks?item=b')
    })
})
