/**
 * HERMES - Time Entry sayfa basligi + ust aksiyonlar.
 *
 * Hermes Liquid (28.09.2026): prototipteki sayfa anatomisi — buyuk baslik
 * + hafta araligi alt satiri; sagda kisi secici (worklogs.admin), CSV,
 * Hafta/Cizelge segmenti ve birincil "Efor gir". Handler sozlesmesi AYNI
 * (onSelectUser, onExport, onViewModeChange); `onLogToday` yeni ve
 * opsiyoneldir — verilmezse birincil eylem cizilmez.
 *
 * Gorunum sekmeleri gercek `role="tab"` (viewSwitcher kilidi); secili
 * sekmenin yukseltilmis cam hapi `.view-link.active::after`.
 */
import { Button, Select } from 'antd'
import { FileExcelOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { useT } from '../../../i18n'
import { PageHero } from '../../../components/liquid'

function TimeEntryHeader({
    canSelectUser, targetUserId, usersList, onSelectUser,
    exportLoading, onExport,
    viewMode, onViewModeChange,
    weekLabel, onLogToday,
}) {
    const t = useT()
    return (
        <PageHero
            className="user-header"
            title={t('nav.timeEntry')}
            subtitle={weekLabel}
            actions={(
                <>
                    {canSelectUser && (
                        <Select
                            className="user-select-dropdown te-user-select"
                            value={targetUserId}
                            onChange={onSelectUser}
                            options={usersList.map((u) => ({
                                value: u.id,
                                label: u.full_name || u.email,
                            }))}
                            showSearch
                            optionFilterProp="label"
                            suffixIcon={<TeamOutlined />}
                            aria-label={t('timeEntryHeader.selectUser')}
                        />
                    )}
                    <Button
                        className="te-export-btn"
                        icon={<FileExcelOutlined />}
                        loading={exportLoading}
                        onClick={onExport}
                        aria-label={t('timeEntryHeader.exportAsCsv')}
                    >
                        CSV
                    </Button>
                    <div className="view-switchers" role="tablist" aria-label={t('misc.view')}>
                        {['list', 'timesheet'].map((v) => (
                            <button
                                key={v}
                                type="button"
                                role="tab"
                                aria-selected={viewMode === v}
                                className={`view-link ${viewMode === v ? 'active' : ''}`}
                                onClick={() => onViewModeChange(v)}
                            >
                                {v === 'list' ? t('timeEntryHeader.viewList') : t('timeEntryHeader.viewTimesheet')}
                            </button>
                        ))}
                    </div>
                    {onLogToday && (
                        <Button type="primary" icon={<PlusOutlined />} onClick={onLogToday}>
                            {t('home.quickLog')}
                        </Button>
                    )}
                </>
            )}
        />
    )
}

export default TimeEntryHeader
