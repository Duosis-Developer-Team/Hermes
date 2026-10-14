/**
 * =============================================================================
 * HERMES - Talep filtreleri (cekmece) — is yonetimindeki TaskFiltersDrawer gibi
 * =============================================================================
 * Sayfanin ustundeki yedi kutu yerine tek "Filtreler" dugmesi; alanlar
 * kenardan kopuk cam panelde (`lq-sheet`) alt alta. Degerler URL'de kalir
 * (paylasilabilir link), secim aninda uygulanir.
 * =============================================================================
 */
import { Drawer, Select } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

import { Button } from '../../components/ui'
import { ModalHead } from '../../components/liquid'
import { useT } from '../../i18n'
import { AGENT_STATUS_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from './constants'
import { useTicketLabel } from './useTicketLabel'

function Field({ id, label, children }) {
    return (
        <div className="tk-filter">
            <label className="tk-filter__label" htmlFor={id}>{label}</label>
            {children}
        </div>
    )
}

export default function TicketFiltersDrawer({
    open, onClose, value, onChange, onClear, tags = [], customers = [], groups = [],
}) {
    const t = useT()
    const tl = useTicketLabel()
    const multi = (key, labelKey, dict, labelDict) => (
        <Field id={`tk-f-${key}`} label={t(labelKey)}>
            <Select
                id={`tk-f-${key}`}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder={t('common.all')}
                value={value[key]}
                onChange={(next) => onChange({ [key]: next })}
                options={Object.keys(dict).map((v) => ({ value: v, label: tl(labelDict, v) }))}
            />
        </Field>
    )
    return (
        <Drawer
            title={<ModalHead icon={<FilterOutlined />} title={t('tasks.filters')} subtitle={t('hub.filtersHint')} />}
            open={open}
            onClose={onClose}
            placement={typeof window !== 'undefined' && window.innerWidth < 768 ? 'bottom' : 'right'}
            height="auto"
            width={360}
            className="task-filters-drawer"
            rootClassName="lq-sheet"
        >
            <div className="tk-filters">
                {multi('status', 'common.status', AGENT_STATUS_LABELS, 'agentStatus')}
                {multi('priority', 'hub.priority', PRIORITY_LABELS, 'priority')}
                {multi('category', 'hub.category', CATEGORY_LABELS, 'category')}
                {tags.length > 0 && (
                    <Field id="tk-f-tag" label={t('hub.tags')}>
                        <Select
                            id="tk-f-tag"
                            mode="multiple"
                            allowClear
                            maxTagCount="responsive"
                            placeholder={t('common.all')}
                            value={value.tag}
                            onChange={(next) => onChange({ tag: next })}
                            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                        />
                    </Field>
                )}
                {(customers.length > 0 || value.customer) && (
                    <Field id="tk-f-customer" label={t('hub.customer')}>
                        <Select
                            id="tk-f-customer"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder={t('common.all')}
                            value={value.customer}
                            onChange={(next) => onChange({ customer: next || null })}
                            options={customers.map((c) => ({ value: c.id, label: c.display_name }))}
                        />
                    </Field>
                )}
                <Field id="tk-f-group" label={t('hub.targetTeam')}>
                    <Select
                        id="tk-f-group"
                        allowClear
                        placeholder={t('common.all')}
                        value={value.group}
                        onChange={(next) => onChange({ group: next || null })}
                        options={groups.map((g) => ({ value: g.id, label: g.name }))}
                    />
                </Field>
                <Button onClick={onClear}>{t('common.clear')}</Button>
            </div>
        </Drawer>
    )
}
