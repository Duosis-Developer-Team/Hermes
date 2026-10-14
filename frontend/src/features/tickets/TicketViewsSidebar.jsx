/**
 * =============================================================================
 * HERMES - Talepler sol kolonu (is yonetimindeki "Gorunumler"in aynisi)
 * =============================================================================
 * Ayni cam kolon ve siniflar (tasksViews.css): ustte KUYRUKLAR (sayili),
 * altinda kayitli gorunumler, birden cok uygulama varsa UYGULAMALAR, en
 * altta talep araclari (raporlar, musteriler, bilgi bankasi).
 *
 * Pano tum akisi gosterir; orada kuyruk yerine iki kapsam vardir
 * (`BOARD_QUEUES`): acik-yalniz kuyruklar Tamamlandi sutununu bosaltirdi.
 *
 * SUNUM KATMANI: sorgu/mutasyon yok (TaskViewsSidebar gibi prop'lar).
 * =============================================================================
 */
import { Tooltip } from 'antd'
import {
    BarChartOutlined, DeleteOutlined, ReadOutlined, ShopOutlined, TeamOutlined,
} from '@ant-design/icons'

import { useT } from '../../i18n'
import { BOARD_QUEUES } from './constants'
import { useTicketLabel } from './useTicketLabel'
import '../tasks/components/tasksViews.css'
import './tickets.css'

function Row({ active, label, count, icon, onSelect, onDelete, deleteLabel, role = 'tab' }) {
    return (
        <div className={`tv-view${active ? ' is-active' : ''}`}>
            <button
                type="button"
                role={role}
                aria-selected={role === 'tab' ? active : undefined}
                className="tv-view__btn tk-view__btn"
                onClick={onSelect}
            >
                {icon}
                <span className="tk-view__text">{label}</span>
                {count != null && <span className="tk-view__count">{count}</span>}
            </button>
            {onDelete && (
                <Tooltip title={deleteLabel}>
                    <button type="button" className="tv-view__delete" aria-label={deleteLabel} onClick={onDelete}>
                        <DeleteOutlined />
                    </button>
                </Tooltip>
            )}
        </div>
    )
}

export default function TicketViewsSidebar({
    layout = 'list',
    queues = [],
    activeQueue,
    onSelectQueue,
    views = [],
    activeViewId,
    onApplyView,
    onDeleteView,
    applications = [],
    activeApplication = 'all',
    onSelectApplication,
    onNavigate,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const shownQueues = layout === 'board'
        ? BOARD_QUEUES.map((key) => queues.find((q) => q.key === key) ?? { key })
        : queues
    const boardQueue = BOARD_QUEUES.includes(activeQueue) ? activeQueue : 'all'
    const current = layout === 'board' ? boardQueue : activeQueue

    return (
        <aside className="tv-sidebar tk-sidebar" aria-label={t('hub.queuesTitle')}>
            <div className="tv-sidebar__label">{t('hub.queuesTitle')}</div>
            <div role="tablist" aria-label={t('hub.queuesTitle')} className="tv-sidebar__views">
                {shownQueues.map((q) => (
                    <Row
                        key={q.key}
                        active={!activeViewId && q.key === current}
                        label={tl('queue', q.key)}
                        count={layout === 'board' ? null : q.count}
                        onSelect={() => onSelectQueue(q.key)}
                    />
                ))}
            </div>

            {views.length > 0 && (
                <>
                    <div className="tv-sidebar__label tv-sidebar__label--sub">{t('hub.views')}</div>
                    <div role="tablist" aria-label={t('hub.views')} className="tv-sidebar__views">
                        {views.map((view) => (
                            <Row
                                key={view.id}
                                active={view.id === activeViewId}
                                label={view.name}
                                icon={view.is_shared
                                    ? <TeamOutlined className="tk-view__icon" aria-label={t('hub.sharedView')} />
                                    : null}
                                onSelect={() => onApplyView(view)}
                                onDelete={view.is_mine ? () => onDeleteView(view) : undefined}
                                deleteLabel={t('hub.deleteView', { name: view.name })}
                            />
                        ))}
                    </div>
                </>
            )}

            {applications.length > 1 && (
                <>
                    <div className="tv-sidebar__label tv-sidebar__label--sub">{t('hub.applicationsTitle')}</div>
                    <div role="tablist" aria-label={t('hub.applicationsTitle')} className="tv-sidebar__views">
                        <Row
                            active={activeApplication === 'all'}
                            label={t('common.all')}
                            onSelect={() => onSelectApplication('all')}
                        />
                        {applications.map((app) => (
                            <Row
                                key={app.id}
                                active={activeApplication === app.id}
                                label={app.display_name}
                                count={app.open_ticket_count}
                                onSelect={() => onSelectApplication(app.id)}
                            />
                        ))}
                    </div>
                </>
            )}

            <div className="tv-sidebar__label tv-sidebar__label--sub">{t('hub.toolsTitle')}</div>
            <nav aria-label={t('hub.toolsTitle')} className="tv-sidebar__views">
                <Row role="link" label={t('ticketReports.title')} icon={<BarChartOutlined className="tk-view__icon" />}
                     onSelect={() => onNavigate('/tickets/reports')} />
                <Row role="link" label={t('customersHub.title')} icon={<ShopOutlined className="tk-view__icon" />}
                     onSelect={() => onNavigate('/tickets/customers')} />
                <Row role="link" label={t('kb.title_page')} icon={<ReadOutlined className="tk-view__icon" />}
                     onSelect={() => onNavigate('/tickets/kb')} />
            </nav>
        </aside>
    )
}
