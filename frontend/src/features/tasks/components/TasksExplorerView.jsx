/**
 * =============================================================================
 * HERMES - Explorer: Customer → Project → Sub Project gezgini
 * =============================================================================
 * Tasks sayfasinin VARSAYILAN gorunumu. Sol tarafta acilip kapanan
 * hiyerarsi agaci, sagda secili klasorun status tabanli Kanban'i.
 *
 * IKINCI BIR DRAG ENGINE YOK (§6.4): calisma alani mevcut
 * `TasksBoardView`in KENDISIDIR. Boylece surukleme yetkisi, optimistic
 * update, rollback, mutation lock, coklu-atama onay akisi ve
 * Completed → Log Time sozlesmesi tek kod yolundan gecer; Explorer
 * yalnizca "hangi isler gorunuyor" sorusunu cevaplar.
 *
 * Ayni sekilde gruplama ve aggregate status da bu dosyada YENIDEN
 * yazilmaz — model/grouping + model/hierarchy tek kaynaktir.
 *
 * Mobil (§6.6): daraltilmis agac yerine DRILL-DOWN. Customer listesi →
 * Project listesi → Sub Project → isler; ustte geri/breadcrumb.
 * =============================================================================
 */
import { memo, useMemo, useState } from 'react'
import { Empty, Input, Segmented, Tooltip } from 'antd'
import {
    FolderOpenOutlined,
    FolderOutlined,
    LeftOutlined,
    RightOutlined,
    SearchOutlined,
} from '@ant-design/icons'

import TasksBoardView from '../../../components/tasks/TasksBoardView'
import useIsMobile from '../../../hooks/useIsMobile'
import { groupIntoLogicalItems, userLabel } from '../model/grouping'
import {
    breadcrumbFor,
    buildHierarchy,
    buildUserHierarchy,
    itemsForNode,
    matchesSearch,
    reconcileSelection,
} from '../model/hierarchy'
import './tasksExplorer.css'

/** Logical item listesini ham task satirlarina geri acar — Board ham
 *  satir bekler ve gruplamayi KENDISI yapar (tek kaynak). */
const toRawTasks = (items) =>
    (items || []).flatMap((i) => i.assignments.map((a) => a.task))

function FolderRow({
    node, level, expanded, selected, onToggle, onSelect,
}) {
    const hasChildren = (node.children || []).length > 0
    return (
        <div
            className={`tx-row tx-row--l${level}${selected ? ' is-selected' : ''}`}
            style={{ paddingLeft: 8 + level * 16 }}
        >
            {/* Acma/kapama ile SECME ayri erisilebilir kontrollerdir (§6.3). */}
            <button
                type="button"
                className="tx-row__toggle"
                aria-expanded={hasChildren ? expanded : undefined}
                aria-label={
                    hasChildren
                        ? `${expanded ? 'Collapse' : 'Expand'} ${node.label}`
                        : `${node.label} has no sub folders`
                }
                disabled={!hasChildren}
                onClick={() => hasChildren && onToggle(node.id)}
            >
                {hasChildren ? (expanded ? <span>▾</span> : <span>▸</span>) : <span />}
            </button>
            <button
                type="button"
                className="tx-row__label"
                aria-current={selected ? 'true' : undefined}
                aria-label={`${node.label}, ${node.count} work items`}
                onClick={() => onSelect(node)}
            >
                {expanded ? <FolderOpenOutlined /> : <FolderOutlined />}
                <Tooltip title={node.label} mouseEnterDelay={0.4}>
                    <span className="tx-row__text">{node.label}</span>
                </Tooltip>
                <span className="tx-row__count">{node.count}</span>
            </button>
        </div>
    )
}

function TasksExplorerView({ tasks = [], boardProps = {}, canGroupByUser = false }) {
    const isMobile = useIsMobile()
    const [search, setSearch] = useState('')
    /*
     * GRUPLAMA EKSENI: musteri mi, kisi mi?
     * Kisi ekseni yalnizca "Assigned by Me" kapsaminda ANLAMLIDIR —
     * "My Tasks"ta zaten tek kisi vardir (kullanicinin kendisi), o yuzden
     * secenek orada hic GOSTERILMEZ ve eksen musteride kalir.
     */
    const [groupMode, setGroupMode] = useState('customer')
    const mode = canGroupByUser ? groupMode : 'customer'
    const [expanded, setExpanded] = useState(() => new Set())
    const [rawSelection, setRawSelection] = useState({})

    /* Ad cozumu dizin haritasindan gelir — Board ile AYNI kural
       (userLabel tek kaynak). Onceki hali var olmayan bir prop'u
       okuyordu ve kisi ekseninde tum klasorler "Unknown user"
       olurdu. */
    const resolveName = useMemo(() => {
        const map = boardProps.userMap
        return (id) => (map ? userLabel(id, map) : null)
    }, [boardProps.userMap])

    const logicalItems = useMemo(
        () => groupIntoLogicalItems(tasks, resolveName),
        [tasks, resolveName]
    )

    // Arama ITEM duzeyinde uygulanir; klasorler turetilmis oldugu icin
    // eslesen isin ata yolu kendiliginden gorunur kalir (§14).
    const visibleItems = useMemo(
        () => logicalItems.filter((i) => matchesSearch(i, search)),
        [logicalItems, search]
    )

    const tree = useMemo(
        () => (mode === 'user'
            ? buildUserHierarchy(visibleItems)
            : buildHierarchy(visibleItems)),
        [visibleItems, mode]
    )

    // Filtre degisince gecersiz kalan secim guvenli sekilde ust seviyeye
    // duser — bos sayfa olusmaz (§14).
    const selection = useMemo(
        () => reconcileSelection(tree, rawSelection),
        [tree, rawSelection]
    )

    const crumbs = useMemo(() => breadcrumbFor(tree, selection), [tree, selection])
    const folderItems = useMemo(
        () => itemsForNode(tree, selection),
        [tree, selection]
    )
    const folderTasks = useMemo(() => toRawTasks(folderItems), [folderItems])

    const toggle = (id) =>
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const switchMode = (next) => {
        // Eksen degisince eski secim ARTIK GECERLI DEGIL; koke doneriz
        // (reconcileSelection zaten korurdu, ama niyet acik olsun).
        setRawSelection({})
        setGroupMode(next)
    }

    const selectCustomer = (node) => setRawSelection({ customerId: node.id })
    const selectProject = (cId, node) =>
        setRawSelection({ customerId: cId, projectId: node.id })
    const selectSub = (cId, pId, node) =>
        setRawSelection({ customerId: cId, projectId: pId, subProjectId: node.id })

    const totalCount = tree.reduce((n, c) => n + c.count, 0)
    const rootLabel = mode === 'user' ? 'All users' : 'All customers'

    /* --- Bos durumlar AYRI (§6.5): "klasor bos" ile "filtreye uyan is
       yok" ayni mesaj DEGILDIR. */
    const emptyMessage =
        search.trim() && logicalItems.length > 0
            ? 'No work items match your search.'
            : totalCount === 0
                ? 'No work items yet.'
                : 'No work items in this folder.'

    const board = (
        <TasksBoardView
            {...boardProps}
            tasks={folderTasks}
        />
    )

    /* ------------------------------------------------------------------
       MOBIL: drill-down (§6.6) — dort Kanban sutunu daraltilmaz.
       ------------------------------------------------------------------ */
    if (isMobile) {
        const customer = selection.customerId
            ? tree.find((c) => c.id === selection.customerId)
            : null
        const project = customer && selection.projectId
            ? customer.children.find((p) => p.id === selection.projectId)
            : null

        const level = project ? 'sub' : customer ? 'project' : 'customer'
        const rows = level === 'customer'
            ? tree
            : level === 'project'
                ? customer.children
                : project.children

        const goBack = () => {
            if (level === 'sub') setRawSelection({ customerId: customer.id })
            else setRawSelection({})
        }

        return (
            <div className="tx tx--mobile">
                <div className="tx-mobile-head">
                    {level !== 'customer' && (
                        <button
                            type="button"
                            className="tx-back"
                            aria-label="Back to parent folder"
                            onClick={goBack}
                        >
                            <LeftOutlined /> Back
                        </button>
                    )}
                    <span className="tx-mobile-path">
                        {crumbs.length ? crumbs.map((c) => c.label).join(' / ') : rootLabel}
                    </span>
                </div>

                {canGroupByUser && (
                    <Segmented
                        className="tx-mode"
                        block
                        value={mode}
                        onChange={switchMode}
                        options={[
                            { label: 'By customer', value: 'customer' },
                            { label: 'By user', value: 'user' },
                        ]}
                        aria-label="Group folders by"
                    />
                )}
                <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Search work items"
                    aria-label="Search work items"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="tx-search"
                />

                <div className="tx-mobile-list">
                    {rows.map((node) => (
                        <button
                            key={node.id}
                            type="button"
                            className="tx-mobile-row"
                            aria-label={`${node.label}, ${node.count} work items`}
                            onClick={() =>
                                level === 'customer'
                                    ? selectCustomer(node)
                                    : level === 'project'
                                        ? selectProject(customer.id, node)
                                        : selectSub(customer.id, project.id, node)
                            }
                        >
                            <FolderOutlined />
                            <span className="tx-row__text">{node.label}</span>
                            <span className="tx-row__count">{node.count}</span>
                            <RightOutlined />
                        </button>
                    ))}
                </div>

                {selection.customerId && (
                    <div className="tx-mobile-items">
                        {folderTasks.length === 0
                            ? <Empty description={emptyMessage} />
                            : board}
                    </div>
                )}
            </div>
        )
    }

    /* ------------------------------------------------------------------
       MASAUSTU: agac + secili klasorun Kanban'i
       ------------------------------------------------------------------ */
    return (
        <div className="tx">
            <aside className="tx-tree" aria-label="Work item folders">
                {canGroupByUser && (
                    <Segmented
                        className="tx-mode"
                        block
                        size="small"
                        value={mode}
                        onChange={switchMode}
                        options={[
                            { label: 'By customer', value: 'customer' },
                            { label: 'By user', value: 'user' },
                        ]}
                        aria-label="Group folders by"
                    />
                )}
                <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Search work items"
                    aria-label="Search work items"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="tx-search"
                />

                <div className="tx-tree-scroll" role="tree">
                    <div className={`tx-row tx-row--root${!selection.customerId ? ' is-selected' : ''}`}>
                        <button
                            type="button"
                            className="tx-row__label"
                            aria-current={!selection.customerId ? 'true' : undefined}
                            aria-label={`${rootLabel}, ${totalCount} work items`}
                            onClick={() => setRawSelection({})}
                        >
                            <FolderOpenOutlined />
                            <span className="tx-row__text">{rootLabel}</span>
                            <span className="tx-row__count">{totalCount}</span>
                        </button>
                    </div>

                    {tree.map((customer) => (
                        <div key={customer.id} role="treeitem" aria-expanded={expanded.has(customer.id)}>
                            <FolderRow
                                node={customer}
                                level={0}
                                expanded={expanded.has(customer.id)}
                                selected={selection.customerId === customer.id && !selection.projectId}
                                onToggle={toggle}
                                onSelect={selectCustomer}
                            />
                            {/* Kapali klasorun alt agaci MOUNT EDILMEZ (§15). */}
                            {expanded.has(customer.id) && customer.children.map((project) => (
                                <div key={project.id}>
                                    <FolderRow
                                        node={project}
                                        level={1}
                                        expanded={expanded.has(project.id)}
                                        selected={selection.projectId === project.id && !selection.subProjectId}
                                        onToggle={toggle}
                                        onSelect={(n) => selectProject(customer.id, n)}
                                    />
                                    {expanded.has(project.id) && project.children.map((sub) => (
                                        <FolderRow
                                            key={sub.id}
                                            node={{ ...sub, children: [] }}
                                            level={2}
                                            expanded={false}
                                            selected={selection.subProjectId === sub.id}
                                            onToggle={() => {}}
                                            onSelect={(n) => selectSub(customer.id, project.id, n)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    ))}

                    {tree.length === 0 && (
                        <div className="tx-tree-empty">{emptyMessage}</div>
                    )}
                </div>
            </aside>

            <section className="tx-work" aria-label="Work items in selected folder">
                <nav className="tx-crumbs" aria-label="Folder path">
                    <button type="button" className="tx-crumb" onClick={() => setRawSelection({})}>
                        {rootLabel}
                    </button>
                    {crumbs.map((c) => (
                        <span key={`${c.level}-${c.id}`} className="tx-crumb-part">
                            <span className="tx-crumb-sep" aria-hidden="true">/</span>
                            <span className="tx-crumb">{c.label}</span>
                        </span>
                    ))}
                </nav>

                {folderTasks.length === 0
                    ? <Empty description={emptyMessage} className="tx-empty" />
                    : board}
            </section>
        </div>
    )
}

/*
 * PERFORMANS (§15): Explorer agac + Kanban'i birlikte cizer. Sayfa
 * seviyesindeki her state degisimi (modal alanlari, secimler) bu alt
 * agaci yeniden cizmemeli — prop'lari degismediyse render ATLANIR.
 * Ust katman `boardProps`i memoize eder, aksi halde bu kapi hic
 * kapanmaz (her render yeni nesne = yeni prop).
 */
export default memo(TasksExplorerView)
