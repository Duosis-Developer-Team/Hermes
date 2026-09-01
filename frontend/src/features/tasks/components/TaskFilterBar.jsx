/**
 * =============================================================================
 * HERMES - Capraz filtre cubugu (Sprint 5C)
 * =============================================================================
 * Status / Priority / Customer / Project / Sub Project. Hiyerarsi
 * kilitlidir: musteri secilmeden proje, proje secilmeden alt proje
 * secilemez — kararin kendisi useTaskFilters'ta (secim temizleme
 * kurali orada), burada yalnizca sunumu vardir.
 *
 * Etiketsiz kontroller: her Select acik bir erisilebilir ad tasir (§8);
 * placeholder erisilebilir ad DEGILDIR.
 * =============================================================================
 */
import { Button, Select, Space } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../model/constants'
import { useT } from '../../../i18n'

function TaskFilterBar({
    filters, customers, projects, subProjects,
    onStatusChange, onPriorityChange, onCustomerChange, onProjectChange,
    assigneeOptions = null, onAssigneeChange,
    onSubProjectChange, onClear,
}) {
    const t = useT()
    return (
        /* Premium redesign: bu blok artik surekli acik bir serit DEGIL —
           TasksPage'deki "Filters" aksiyonunun actigi drawer'in icidir.
           Kontroller dikey akar; genislikler drawer'a uyar. */
        <div className="task-filterbar">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <FilterOutlined style={{ color: 'var(--c-text-muted)' }} />
                {/* Kisi filtresi YALNIZ "Assigned by Me" kapsaminda
                    anlamlidir; ust katman secenek listesini yalnizca o
                    kapsamda verir (My Tasks'ta zaten tek kisi vardir). */}
                {assigneeOptions && (
                    <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        aria-label={t('taskUi.filterByUser')}
                        placeholder={t('entity.user')}
                        style={{ width: '100%' }}
                        value={filters.assignee || undefined}
                        onChange={(v) => onAssigneeChange?.(v ?? null)}
                        options={assigneeOptions}
                    />
                )}
                <Select
                    allowClear
                    aria-label={t('taskUi.filterByStatus')}
                    placeholder={t('common.status')}
                    style={{ width: '100%' }}
                    value={filters.status}
                    onChange={onStatusChange}
                    options={STATUS_OPTIONS}
                />
                <Select
                    allowClear
                    aria-label={t('taskUi.filterByPriority')}
                    placeholder={t('task.priority')}
                    style={{ width: '100%' }}
                    value={filters.priority}
                    onChange={onPriorityChange}
                    options={PRIORITY_OPTIONS}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterByCustomer')}
                    placeholder={t('entity.customer')}
                    style={{ width: '100%' }}
                    value={filters.customer}
                    onChange={onCustomerChange}
                    optionFilterProp="label"
                    options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterByProject')}
                    placeholder={t('entity.project')}
                    style={{ width: '100%' }}
                    value={filters.project}
                    disabled={!filters.customer}
                    onChange={onProjectChange}
                    optionFilterProp="label"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterBySubProject')}
                    placeholder={t('task.subProject')}
                    style={{ width: '100%' }}
                    value={filters.subProject}
                    disabled={!filters.project}
                    onChange={onSubProjectChange}
                    optionFilterProp="label"
                    options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                />
                <Button onClick={onClear} block>{t('common.clear')}</Button>
            </Space>
        </div>
    )
}

export default TaskFilterBar
