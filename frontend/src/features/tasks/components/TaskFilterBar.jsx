/**
 * =============================================================================
 * HERMES - Capraz filtre cubugu (Sprint 5C → Hermes Liquid)
 * =============================================================================
 * Durum / Oncelik (cip; secili cipe yeniden basmak temizler) + Kisi /
 * Musteri / Proje / Alt proje (etiketli secim). Hiyerarsi kilitlidir:
 * musteri secilmeden proje, proje secilmeden alt proje secilemez — kararin
 * kendisi useTaskFilters'ta (secim temizleme kurali orada), burada yalnizca
 * sunumu vardir.
 *
 * Erisilebilir ad (§8): cip gruplari ve her Select acik bir ad tasir;
 * placeholder erisilebilir ad DEGILDIR.
 * =============================================================================
 */
import { Button, Select } from 'antd'

import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../model/constants'
import { ChipGroup, FormSection } from '../../../components/liquid'
import { useT } from '../../../i18n'
import { customerSelectRender, projectSelectRender } from '../../../components/common/customerSelect'
import { selectFilter } from '../../../utils/searchText'

function Field({ id, label, children }) {
    return (
        <div className="task-filterbar__field">
            <label htmlFor={id}>{label}</label>
            {children}
        </div>
    )
}

function TaskFilterBar({
    filters, customers, projects, subProjects,
    onStatusChange, onPriorityChange, onCustomerChange, onProjectChange,
    assigneeOptions = null, onAssigneeChange,
    onSubProjectChange, onClear,
}) {
    const t = useT()
    return (
        <div className="task-filterbar">
            <FormSection>{t('taskUi.filterGroupState')}</FormSection>
            <Field label={t('common.status')}>
                <ChipGroup
                    allowDeselect
                    ariaLabel={t('taskUi.filterByStatus')}
                    value={filters.status}
                    onChange={(v) => onStatusChange(v)}
                    options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(`taskUi.filterStatus.${o.value}`) }))}
                />
            </Field>
            <Field label={t('task.priority')}>
                <ChipGroup
                    allowDeselect
                    ariaLabel={t('taskUi.filterByPriority')}
                    value={filters.priority}
                    onChange={(v) => onPriorityChange(v)}
                    options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: t(`taskCard.priority.${o.value}`) }))}
                />
            </Field>

            <FormSection>{t('taskUi.filterGroupWhere')}</FormSection>
            {/* Kisi filtresi YALNIZ "Assigned by Me" kapsaminda anlamlidir;
                ust katman secenek listesini yalnizca o kapsamda verir. */}
            {assigneeOptions && (
                <Field id="tf-assignee" label={t('entity.user')}>
                    <Select
                        id="tf-assignee"
                        allowClear
                        showSearch
                        filterOption={selectFilter}
                        aria-label={t('taskUi.filterByUser')}
                        placeholder={t('taskUi.any')}
                        value={filters.assignee || undefined}
                        onChange={(v) => onAssigneeChange?.(v ?? null)}
                        options={assigneeOptions}
                    />
                </Field>
            )}
            <Field id="tf-customer" label={t('entity.customer')}>
                <Select
                    id="tf-customer"
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterByCustomer')}
                    placeholder={t('taskUi.any')}
                    value={filters.customer}
                    onChange={onCustomerChange}
                    filterOption={selectFilter}
                    options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    {...customerSelectRender}
                />
            </Field>
            <Field id="tf-project" label={t('entity.project')}>
                <Select
                    id="tf-project"
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterByProject')}
                    placeholder={filters.customer ? t('taskUi.any') : t('taskModal.customerFirst')}
                    value={filters.project}
                    disabled={!filters.customer}
                    onChange={onProjectChange}
                    filterOption={selectFilter}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    {...projectSelectRender}
                />
            </Field>
            <Field id="tf-sub" label={t('task.subProject')}>
                <Select
                    id="tf-sub"
                    allowClear
                    showSearch
                    aria-label={t('taskUi.filterBySubProject')}
                    placeholder={filters.project ? t('taskUi.any') : t('taskModal.projectFirst')}
                    value={filters.subProject}
                    disabled={!filters.project}
                    onChange={onSubProjectChange}
                    filterOption={selectFilter}
                    options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                />
            </Field>
            <div className="task-filterbar__foot">
                <Button onClick={onClear} block>{t('common.clear')}</Button>
            </div>
        </div>
    )
}

export default TaskFilterBar
