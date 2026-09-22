/**
 * =============================================================================
 * HERMES - Gorunumler sol kolonu (PM rework P3.5 / E1, E2, E3)
 * =============================================================================
 * Ekranin durumu = secili gorunum. Uc bolum: sistem gorunumleri (kod),
 * kisisel ve paylasilan (kayitli). Altinda "Projeler": mevcut sonuc
 * kumesinin Musteri → Proje agaci; klasor secmek capraz filtre uygular
 * (eski Explorer agacinin yerine — ikinci bir gezinme yuzeyi yok).
 *
 * SUNUM KATMANI: sorgu/mutasyon yok, izin karari yok (prop'lar).
 * Sistem/kayitli gorunumler bir `tablist`tir: secim `aria-selected`.
 * =============================================================================
 */
import { useState } from 'react'
import { Tooltip } from 'antd'
import { DeleteOutlined, FolderOpenOutlined, FolderOutlined } from '@ant-design/icons'

import { useT } from '../../../i18n'
import './tasksViews.css'

function ViewButton({ view, active, label, onSelect, onDelete, t }) {
    return (
        <div className={`tv-view${active ? ' is-active' : ''}`}>
            <button
                type="button"
                role="tab"
                aria-selected={active}
                className="tv-view__btn"
                onClick={() => onSelect(view.id)}
            >
                {label}
            </button>
            {view.saved && view.canEdit && onDelete && (
                <Tooltip title={t('views.deleteView')}>
                    <button
                        type="button"
                        className="tv-view__delete"
                        aria-label={`${t('views.deleteView')} — ${label}`}
                        onClick={() => onDelete(view)}
                    >
                        <DeleteOutlined />
                    </button>
                </Tooltip>
            )}
        </div>
    )
}

function FolderRow({ node, level, expanded, selected, onToggle, onSelect }) {
    const hasChildren = (node.children || []).length > 0
    return (
        <div className={`tv-folder tv-folder--l${level}${selected ? ' is-selected' : ''}`}>
            <button
                type="button"
                className="tv-folder__toggle"
                aria-expanded={hasChildren ? expanded : undefined}
                aria-label={hasChildren
                    ? `${expanded ? 'Collapse' : 'Expand'} ${node.label}`
                    : `${node.label} has no sub folders`}
                disabled={!hasChildren}
                onClick={() => hasChildren && onToggle(node.id)}
            >
                {hasChildren ? (expanded ? '▾' : '▸') : ''}
            </button>
            <button
                type="button"
                className="tv-folder__label"
                aria-current={selected ? 'true' : undefined}
                aria-label={`${node.label}, ${node.count} work items`}
                disabled={node.isVirtual}
                onClick={() => !node.isVirtual && onSelect(node)}
            >
                {expanded ? <FolderOpenOutlined /> : <FolderOutlined />}
                <span className="tv-folder__text">{node.label}</span>
                <span className="tv-folder__count">{node.count}</span>
            </button>
        </div>
    )
}

function TaskViewsSidebar({
    systemViews = [],
    personalViews = [],
    sharedViews = [],
    activeViewId,
    onSelectView,
    onDeleteView,
    /** buildHierarchy ciktisi: Musteri → Proje → Alt proje. */
    projectTree = [],
    /** { customer, project, subProject } — secili klasor. */
    folderSelection = {},
    onSelectFolder,
}) {
    const t = useT()
    const [expanded, setExpanded] = useState(() => new Set())
    const toggle = (id) => setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })
    const labelOf = (v) => (v.saved ? v.name : t(v.labelKey))
    const anyFolder = !!(folderSelection.customer || folderSelection.project)

    const renderViews = (views) => views.map((v) => (
        <ViewButton
            key={v.id}
            view={v}
            active={v.id === activeViewId}
            label={labelOf(v)}
            onSelect={onSelectView}
            onDelete={onDeleteView}
            t={t}
        />
    ))

    return (
        <aside className="tv-sidebar" aria-label={t('views.title')}>
            <div className="tv-sidebar__label">{t('views.title')}</div>
            <div role="tablist" aria-label={t('views.title')} className="tv-sidebar__views">
                {renderViews(systemViews)}
                {personalViews.length > 0 && (
                    <>
                        <div className="tv-sidebar__label tv-sidebar__label--sub">{t('views.personal')}</div>
                        {renderViews(personalViews)}
                    </>
                )}
                {sharedViews.length > 0 && (
                    <>
                        <div className="tv-sidebar__label tv-sidebar__label--sub">{t('views.shared')}</div>
                        {renderViews(sharedViews)}
                    </>
                )}
            </div>

            {projectTree.length > 0 && (
                <nav className="tv-sidebar__projects" aria-label={t('views.projects')}>
                    <div className="tv-sidebar__label">{t('views.projects')}</div>
                    <button
                        type="button"
                        className={`tv-folder__all${anyFolder ? '' : ' is-selected'}`}
                        aria-current={anyFolder ? undefined : 'true'}
                        onClick={() => onSelectFolder?.(null)}
                    >
                        {t('views.allProjects')}
                    </button>
                    {projectTree.map((customer) => (
                        <div key={customer.id}>
                            <FolderRow
                                node={customer}
                                level={0}
                                expanded={expanded.has(customer.id)}
                                selected={folderSelection.customer === customer.id && !folderSelection.project}
                                onToggle={toggle}
                                onSelect={(node) => onSelectFolder?.({ customer: node.id, project: null, subProject: null })}
                            />
                            {expanded.has(customer.id) && (customer.children || []).map((project) => (
                                <div key={project.id}>
                                    <FolderRow
                                        node={project}
                                        level={1}
                                        expanded={expanded.has(project.id)}
                                        selected={folderSelection.project === project.id && !folderSelection.subProject}
                                        onToggle={toggle}
                                        onSelect={(node) => onSelectFolder?.({
                                            customer: customer.id, project: node.id, subProject: null,
                                        })}
                                    />
                                    {expanded.has(project.id) && (project.children || []).map((sub) => (
                                        <FolderRow
                                            key={sub.id}
                                            node={sub}
                                            level={2}
                                            expanded={false}
                                            selected={folderSelection.subProject === sub.id}
                                            onToggle={toggle}
                                            onSelect={(node) => onSelectFolder?.({
                                                customer: customer.id, project: project.id, subProject: node.id,
                                            })}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    ))}
                </nav>
            )}
        </aside>
    )
}

export default TaskViewsSidebar
