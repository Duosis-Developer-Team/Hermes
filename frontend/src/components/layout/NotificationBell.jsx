/**
 * =============================================================================
 * HERMES - Uygulama ici bildirim zili (PM rework P2.2 / C2)
 * =============================================================================
 * Kabuk basligindaki zil: okunmamis sayisi rozet, tiklayinca son
 * bildirimlerin listesi; bir satira tiklamak okundu isaretler ve ise gider
 * (`/project-management/tasks?item=<id>`). Gercek zamanli itme YOK (05 C2
 * kapsam siniri): rozet mount'ta ve pencere odagi geri gelince cekilir
 * (react-query `refetchOnWindowFocus`), 60 sn'de bir de tazelenir.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Dropdown, Empty, Spin } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { notificationService } from '../../services/api'
import { ticketHelpdeskService } from '../../api/ticketsApi'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'

const KIND_KEY = {
    task_created: 'notifications.kind_created',
    task_updated: 'notifications.kind_updated',
    task_completed: 'notifications.kind_completed',
    task_rejected: 'notifications.kind_rejected',
    task_restored: 'notifications.kind_restored',
    task_status_changed: 'notifications.kind_status',
    comment_added: 'notifications.kind_comment',
    comment_updated: 'notifications.kind_comment',
    watcher_added: 'notifications.kind_watcher',
    log_time_created: 'notifications.kind_logTime',
}

export const notificationText = (t, n) => (n.source === 'ticket'
    ? t(`notifications.ticket.${n.kind}`, {
        number: n.ticket_number || '', title: n.title || '', actor: n.actor_display_name || '',
    })
    : t(KIND_KEY[n.kind] || 'notifications.kind_generic', {
        item: n.item_key || '',
        title: n.item_title || '',
    }))

/**
 * `sources`: hangi bildirimler — is kalemleri (`work`) ve/veya talepler
 * (`tickets`, yalniz saglayici tenant'ta; Dalga B). Ikisi birlesik, en
 * yeniden eskiye listelenir; okunmamis sayisi toplamdir.
 */
function NotificationBell({ sources = { work: true, tickets: false } }) {
    const t = useT()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [open, setOpen] = useState(false)

    const count = useQuery({
        queryKey: queryKeys.notifications.unreadCount,
        queryFn: () => notificationService.unreadCount(),
        enabled: sources.work,
        refetchOnWindowFocus: true,
        refetchInterval: 60 * 1000,
        staleTime: 15 * 1000,
        retry: false,
    })
    const list = useQuery({
        queryKey: queryKeys.notifications.list({ limit: 20 }),
        queryFn: () => notificationService.list({ limit: 20 }),
        enabled: open && sources.work,
        refetchOnWindowFocus: true,
        retry: false,
    })
    // Talep bildirimleri tek uctan (liste + okunmamis sayisi).
    const tickets = useQuery({
        queryKey: queryKeys.tickets.notifications,
        queryFn: () => ticketHelpdeskService.notifications({ limit: 20 }),
        enabled: sources.tickets,
        refetchOnWindowFocus: true,
        refetchInterval: 60 * 1000,
        staleTime: 15 * 1000,
        retry: false,
    })
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets.notifications })
    }

    const markRead = useMutation({
        mutationFn: (n) => (n.source === 'ticket'
            ? ticketHelpdeskService.readNotification(n.id)
            : notificationService.markRead(n.id)),
        onSettled: invalidate,
    })
    const markAll = useMutation({
        mutationFn: () => Promise.all([
            sources.work ? notificationService.markAllRead() : null,
            sources.tickets ? ticketHelpdeskService.readAllNotifications() : null,
        ]),
        onSettled: invalidate,
    })

    const unread = (sources.work ? count.data?.unread_count ?? 0 : 0)
        + (sources.tickets ? tickets.data?.unread ?? 0 : 0)
    const items = [
        ...(sources.work ? list.data?.items ?? [] : []),
        ...(sources.tickets ? (tickets.data?.items ?? []).map((n) => ({ ...n, source: 'ticket' })) : []),
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20)

    // Hermes masaustu (macOS): okunmamis sayisi Dock rozetine yansir.
    // Tarayicida `window.hermesDesktop` yoktur — etkisiz.
    useEffect(() => {
        window.hermesDesktop?.setBadgeCount?.(unread)
    }, [unread])

    const openItem = (n) => {
        if (!n.read_at) markRead.mutate(n)
        setOpen(false)
        navigate(n.source === 'ticket'
            ? `/tickets?ticket=${n.ticket_id}`
            : `/project-management/tasks?item=${n.work_item_id}`)
    }

    const panel = (
        <div className="notif-panel" role="dialog" aria-label={t('notifications.title')}>
            <div className="notif-panel__head">
                <span className="notif-panel__title">{t('notifications.title')}</span>
                <Button
                    type="link"
                    size="small"
                    disabled={unread === 0 || markAll.isPending}
                    onClick={() => markAll.mutate()}
                >{t('notifications.markAllRead')}</Button>
            </div>
            {(sources.work ? list.isLoading : tickets.isLoading) ? (
                <div className="notif-panel__empty"><Spin size="small" /></div>
            ) : items.length === 0 ? (
                <div className="notif-panel__empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('notifications.empty')} />
                </div>
            ) : (
                <ul className="notif-list">
                    {items.map((n) => (
                        <li key={n.id}>
                            <button
                                type="button"
                                className={`notif-item${n.read_at ? '' : ' is-unread'}`}
                                onClick={() => openItem(n)}
                            >
                                <span className="notif-item__text">{notificationText(t, n)}</span>
                                <span className="notif-item__meta">
                                    {new Date(n.created_at).toLocaleString()}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )

    return (
        <Dropdown
            open={open}
            onOpenChange={setOpen}
            trigger={['click']}
            placement="bottomRight"
            rootClassName="island-drop"
            popupRender={() => panel}
        >
            <button
                type="button"
                className="notif-bell"
                aria-label={
                    unread > 0
                        ? t('notifications.bellWithCount', { count: unread })
                        : t('notifications.bell')
                }
            >
                <Badge count={unread} size="small" overflowCount={99}>
                    <BellOutlined />
                </Badge>
            </button>
        </Dropdown>
    )
}

export default NotificationBell
