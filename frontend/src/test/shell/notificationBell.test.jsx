/**
 * =============================================================================
 * Uygulama ici bildirim zili (PM rework P2.2 / C2)
 * =============================================================================
 * Rozet okunmamis sayisini gosterir; liste tiklayinca acilir; bir satira
 * tiklamak okundu isaretler ve ise gider; "tumunu okundu" ucu cagrilir.
 * Gercek zamanli itme yok — sorgu pencere odaginda tazelenir (ayar).
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

const notificationService = {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
}
vi.mock('../../services/api', () => ({ notificationService }))

import { renderWithProviders } from '../utils'
const NotificationBell = (await import('../../components/layout/NotificationBell')).default

const ITEMS = [
    {
        id: 'n1', kind: 'task_created', work_item_id: 'wi1', item_key: 'TASK-7',
        item_title: 'Sertifika yenile', created_at: '2026-09-22T10:00:00Z', read_at: null,
    },
    {
        id: 'n2', kind: 'comment_added', work_item_id: 'wi2', item_key: 'ISSUE-3',
        item_title: 'Giris hatasi', created_at: '2026-09-21T10:00:00Z', read_at: '2026-09-21T11:00:00Z',
    },
]

const Probe = () => <div data-testid="probe">{window.location.pathname}</div>

const renderBell = () => renderWithProviders(
    <Routes>
        <Route path="/" element={<NotificationBell />} />
        <Route path="/project-management/tasks" element={<div data-testid="tasks-page">tasks</div>} />
    </Routes>
)

beforeEach(() => {
    vi.clearAllMocks()
    notificationService.unreadCount.mockResolvedValue({ unread_count: 1 })
    notificationService.list.mockResolvedValue({ items: ITEMS, unread_count: 1 })
    notificationService.markRead.mockResolvedValue({})
    notificationService.markAllRead.mockResolvedValue({ marked: 1, unread_count: 0 })
})

describe('bildirim zili', () => {
    it('rozet okunmamis sayisini tasir ve erisilebilir ada yansir', async () => {
        renderBell()
        expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
        expect(notificationService.list).not.toHaveBeenCalled() // liste tembel
    })

    it('tiklayinca liste acilir; satir okundu isaretlenir ve ise gidilir', async () => {
        const user = userEvent.setup({ delay: null })
        renderBell()
        await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
        expect(await screen.findByText('TASK-7 was assigned to you: Sertifika yenile')).toBeInTheDocument()
        expect(screen.getByText('New comment on ISSUE-3: Giris hatasi')).toBeInTheDocument()
        await user.click(screen.getByText('TASK-7 was assigned to you: Sertifika yenile'))
        await waitFor(() => expect(notificationService.markRead).toHaveBeenCalledWith('n1'))
        expect(await screen.findByTestId('tasks-page')).toBeInTheDocument()
    })

    it('okunmus satir tekrar okundu isaretlenmez', async () => {
        const user = userEvent.setup({ delay: null })
        renderBell()
        await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
        await user.click(await screen.findByText('New comment on ISSUE-3: Giris hatasi'))
        await screen.findByTestId('tasks-page')
        expect(notificationService.markRead).not.toHaveBeenCalled()
    })

    it('"tumunu okundu" ucu cagrilir', async () => {
        const user = userEvent.setup({ delay: null })
        renderBell()
        await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
        await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))
        await waitFor(() => expect(notificationService.markAllRead).toHaveBeenCalledTimes(1))
    })

    it('bildirim yoksa bos durum ve sade ad', async () => {
        notificationService.unreadCount.mockResolvedValue({ unread_count: 0 })
        notificationService.list.mockResolvedValue({ items: [], unread_count: 0 })
        const user = userEvent.setup({ delay: null })
        renderBell()
        await user.click(await screen.findByRole('button', { name: 'Notifications' }))
        expect(await screen.findByText('Nothing new')).toBeInTheDocument()
    })
})
