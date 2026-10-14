/**
 * =============================================================================
 * HERMES - Talepler kontrol cubugu (is yonetimindeki TaskAxisBar'in aynisi)
 * =============================================================================
 *   YERLESIM  liste · pano
 *   SIRALA    (yalniz listede; pano sutunlari zaten "top kimde"ye gore)
 * Sagda: filtre dugmesi (sayili, cekmece acar), temizle ve "Gorunum
 * olarak kaydet". Kuyruk / gorunum / uygulama BURADA YOK — sol kolondadir.
 * =============================================================================
 */
import { Badge, Button, Select, Tooltip } from 'antd'
import { FilterOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SaveOutlined } from '@ant-design/icons'

import { useT } from '../../i18n'
import { TICKET_SORTS } from './constants'
import '../tasks/components/tasksViews.css'

export default function TicketAxisBar({
    layout, onSelectLayout, sort, onSelectSort, railCollapsed = false, onToggleRail,
    activeFilterCount = 0, onOpenFilters, onClear, canClear, onSaveAs,
}) {
    const t = useT()
    const layouts = [
        { value: 'list', label: t('ticketBoard.list') },
        { value: 'board', label: t('ticketBoard.board') },
    ]
    return (
        <div className="tv-axis" role="toolbar" aria-label={t('views.layout')}>
            {onToggleRail && (
                <Tooltip title={railCollapsed ? t('hub.showRail') : t('hub.hideRail')}>
                    <Button
                        type="text"
                        icon={railCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                        aria-label={railCollapsed ? t('hub.showRail') : t('hub.hideRail')}
                        aria-pressed={!railCollapsed}
                        onClick={onToggleRail}
                    />
                </Tooltip>
            )}
            <div className="tv-axis__segment">
                <span className="tv-axis__cap">{t('views.layout')}</span>
                <div className="tasks-views" role="group" aria-label={t('views.layout')}>
                    {layouts.map((opt) => {
                        const active = opt.value === layout
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                aria-pressed={active}
                                className={`tasks-views-pill${active ? ' tasks-views-pill-active' : ''}`}
                                onClick={() => !active && onSelectLayout(opt.value)}
                            >
                                {opt.label}
                            </button>
                        )
                    })}
                </div>
            </div>
            {layout === 'list' && (
                <div className="tv-axis__segment">
                    <span className="tv-axis__cap">{t('hub.sortCap')}</span>
                    <Select
                        size="small"
                        variant="borderless"
                        className="tk-axis__sort"
                        aria-label={t('hub.sortBy')}
                        value={sort}
                        onChange={onSelectSort}
                        popupMatchSelectWidth={false}
                        options={TICKET_SORTS.map((value) => ({ value, label: t(`hub.sort.${value}`) }))}
                    />
                </div>
            )}
            <span className="tv-axis__spacer" />
            <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
                <Button icon={<FilterOutlined />} onClick={onOpenFilters} aria-label={t('tasks.filters')}>
                    {t('tasks.filters')}
                </Button>
            </Badge>
            {canClear && <Button type="text" onClick={onClear}>{t('common.clear')}</Button>}
            <Button size="small" icon={<SaveOutlined />} onClick={onSaveAs} aria-label={t('views.saveAs')}>
                {t('views.saveAs')}
            </Button>
        </div>
    )
}
