/**
 * =============================================================================
 * HERMES - Kontrol cubugu: yalniz IKI eksen (PM rework P3.5 / E1)
 * =============================================================================
 *   GRUPLA   proje · durum · sahip · termin (yerlesime gore)
 *   YERLESIM liste · pano · takvim (E5: takvim ayri sayfa DEGIL)
 * Sagda: filtre dugmesi (drawer), "Gorunum olarak kaydet" ve secili
 * gorunum kayitli+sapmisssa "Guncelle". Kapsam/tip/zaman eksenleri
 * BURADA YOK — onlar gorunumun kendisidir (sol kolon).
 * =============================================================================
 */
import { Badge, Button } from 'antd'
import { FilterOutlined, SaveOutlined } from '@ant-design/icons'

import { GROUPS_BY_LAYOUT, GROUP_LABEL_KEY, VIEW_LAYOUTS } from '../model/views'
import { useT } from '../../../i18n'

function Segment({ label, options, value, onChange, labelOf, name }) {
    return (
        <div className="tv-axis__segment">
            <span className="tv-axis__cap">{label}</span>
            <div className="tasks-views" role="group" aria-label={name}>
                {options.map((opt) => {
                    const active = opt === value
                    return (
                        <button
                            key={opt}
                            type="button"
                            aria-pressed={active}
                            className={`tasks-views-pill${active ? ' tasks-views-pill-active' : ''}`}
                            onClick={() => !active && onChange(opt)}
                        >
                            {labelOf(opt)}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function TaskAxisBar({
    layout, onSelectLayout,
    groupBy, onSelectGroup,
    dirty = false,
    canUpdate = false,
    onSaveAs, onUpdate,
    activeFilterCount = 0, onOpenFilters, onClearFilters,
    saving = false,
}) {
    const t = useT()
    const groups = GROUPS_BY_LAYOUT[layout] || []
    return (
        <div className="tv-axis" role="toolbar" aria-label={t('views.layout')}>
            <Segment
                label={t('views.layout')}
                name={t('views.layout')}
                options={VIEW_LAYOUTS.map((l) => l.value)}
                value={layout}
                onChange={onSelectLayout}
                labelOf={(v) => t(VIEW_LAYOUTS.find((l) => l.value === v).labelKey)}
            />
            {groups.length > 0 && (
                <Segment
                    label={t('views.groupBy')}
                    name={t('views.groupBy')}
                    options={groups}
                    value={groupBy}
                    onChange={onSelectGroup}
                    labelOf={(v) => t(GROUP_LABEL_KEY[v])}
                />
            )}
            <span className="tv-axis__spacer" />
            <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
                <Button icon={<FilterOutlined />} onClick={onOpenFilters} aria-label={t('tasks.filters')}>
                    {t('tasks.filters')}
                </Button>
            </Badge>
            {activeFilterCount > 0 && (
                <Button type="text" onClick={onClearFilters}>{t('common.clear')}</Button>
            )}
            {dirty && <span className="tv-axis__dirty" role="status">{t('views.modified')}</span>}
            {dirty && canUpdate && (
                <Button size="small" onClick={onUpdate} loading={saving}>{t('views.update')}</Button>
            )}
            <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={onSaveAs}
                disabled={saving}
                aria-label={t('views.saveAs')}
            >
                {t('views.saveAs')}
            </Button>
        </div>
    )
}

export default TaskAxisBar
