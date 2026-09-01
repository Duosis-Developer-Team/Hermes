/**
 * =============================================================================
 * HERMES - Tasks ust basligi (Sprint 5C)
 * =============================================================================
 * Kimlik (admin ise kullanici secici) + is-turu sekmeleri + arama +
 * kapsam pilleri + Board/List sekmeleri + swimlane anahtari.
 *
 * SUNUM KATMANI: hicbir sorgu/mutasyon calistirmaz, izin KARARI VERMEZ —
 * kararlar prop olarak gelir (features/tasks/model/permissions tek kaynak).
 * =============================================================================
 */
import { Avatar, Select, Switch } from 'antd'
import { UserOutlined } from '@ant-design/icons'

import TasksSearchBar from '../../../components/tasks/TasksSearchBar'
import TaskLifecycleSwitcher from './TaskLifecycleSwitcher'
import {
    TASK_LAYOUTS, TASK_SCOPES, TASK_TYPES, typeMetaFor,
} from '../model/constants'
import { useT } from '../../../i18n'

function TasksHeader({
    user,
    isTaskAdmin,
    canViewAssignedByMe,
    selectedUserId,
    onSelectUser,
    userSelectorOptions,
    archiveState,
    onArchiveStateChange,
    usersLoaded,
    taskType,
    onSelectType,
    userMap,
    onOpenReview,
    taskScope,
    onSelectScope,
    viewLayout,
    onSelectLayout,
    groupByAssignee,
    onToggleGroupByAssignee,
}) {
    const t = useT()
    const activeTypeMeta = typeMetaFor(taskType)
    // Kapsam etiketi aktif turu izler: "My Tasks" / "My Issues" / …
    const scopeLabel = (s) =>
        s.value === 'my-tasks' ? `My ${activeTypeMeta.label}` : s.label

    // Swimlane yalnizca cok atanan izlenirken anlamli (Assigned by Me).
    // Slot HER ZAMAN render edilir (gerektiginde visibility ile gizlenir)
    // ki Board/List veya kapsam degisimi arama kutusunu KAYDIRMASIN.
    const showGroupBy = viewLayout === 'board' && taskScope === 'assigned-by-me'

    return (
        <div className="tasks-user-header">
            <div className="tasks-user-header-left">
                <Avatar size={40} icon={<UserOutlined />} className="tasks-user-avatar" />
                {isTaskAdmin ? (
                    <Select
                        value={selectedUserId || user?.id}
                        onChange={onSelectUser}
                        /* Etiketsiz kontrol: erisilebilir ad acikca
                           verilir (§8). */
                        aria-label={t('explorer.viewedUser')}
                        style={{ width: 220, fontSize: '1.2rem', fontWeight: 600 }}
                        /* AntD 5.x: bordered deprecated → variant. */
                        variant="borderless"
                        loading={!usersLoaded}
                        options={userSelectorOptions}
                        showSearch
                        filterOption={(input, option) =>
                            (option?.label ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                    />
                ) : (
                    <h1 className="tasks-user-name">{user?.full_name || 'User'}</h1>
                )}
            </div>

            <div className="tasks-user-header-right">
                {/* Work item type — Tasks / Issues / Suggestions. Primary,
                    colour-coded mode switch. Same board/list below; only
                    the filter + accent colour change. */}
                <div className="tasks-types" role="tablist" aria-label={t('explorer.workItemType')}>
                    {TASK_TYPES.map((t) => {
                        const isActive = taskType === t.value
                        return (
                            <button
                                key={t.value}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                style={{ '--type-color': t.color }}
                                className={`tasks-type-pill${
                                    isActive ? ' tasks-type-pill-active' : ''
                                }`}
                                onClick={() => onSelectType(t.value)}
                            >
                                {t.label}
                            </button>
                        )
                    })}
                </div>
                <div className="tasks-tabs-divider" />
                {/* Free-text task search — visibility enforced server-side */}
                <TasksSearchBar
                    userMap={userMap}
                    onSelect={onOpenReview}
                    taskType={taskType}
                />
                <div className="tasks-tabs-divider" />
                {/* Scope — sole scope controller; the old standalone
                    My/Assigned-by-Me pills are folded in here. */}
                <div className="tasks-views" role="tablist" aria-label={t('explorer.taskScope')}>
                    {TASK_SCOPES.filter(
                        (s) => !s.assignerOnly || canViewAssignedByMe
                    ).map((s) => {
                        const isActive = taskScope === s.value
                        return (
                            <button
                                key={s.value}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                className={`tasks-views-pill${
                                    isActive ? ' tasks-views-pill-active' : ''
                                }`}
                                onClick={() => {
                                    // Kapsam YALNIZCA hangi havuza
                                    // baktigimizi degistirir; hizli filtre
                                    // ve layout yerinde kalir.
                                    if (!isActive) onSelectScope(s.value)
                                }}
                            >
                                {scopeLabel(s)}
                            </button>
                        )
                    })}
                </div>
                <div className="tasks-tabs-divider" />
                {/* Layout tabs — Board (default) and List. The Calendar
                    (weekly) layout was removed. */}
                <div className="tasks-tabs">
                    {TASK_LAYOUTS.map((l) => (
                        <span
                            key={l.value}
                            className={`tasks-tab-link ${
                                viewLayout === l.value ? 'active' : ''
                            }`}
                            onClick={() => onSelectLayout(l.value)}
                        >
                            {l.label}
                        </span>
                    ))}
                </div>
                <div className="tasks-tabs-divider" />
                {/* Arsiv anahtari: baslik satirinin saginda tek dugme. */}
                <TaskLifecycleSwitcher
                    value={archiveState}
                    onChange={onArchiveStateChange}
                />
                <div
                    className="tasks-groupby-slot"
                    aria-hidden={!showGroupBy}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 24,
                        visibility: showGroupBy ? 'visible' : 'hidden',
                    }}
                >
                    <div className="tasks-tabs-divider" />
                    <label
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            color: 'var(--c-text-muted)',
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <Switch
                            size="small"
                            checked={groupByAssignee}
                            onChange={onToggleGroupByAssignee}
                            disabled={!showGroupBy}
                        />{t('explorer.groupByAssignee')}</label>
                </div>
                {/* Create lives inside the Board view toolbar ("+ New"). */}
            </div>
        </div>
    )
}

export default TasksHeader
