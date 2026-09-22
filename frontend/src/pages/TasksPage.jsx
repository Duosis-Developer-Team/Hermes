/**
 * =============================================================================
 * HERMES - Tasks sayfasi (route/orkestrasyon — PM rework P3.5)
 * =============================================================================
 * Ekranin durumu = secili GORUNUM (sol kolon: sistem + kisisel +
 * paylasilan; URL ?view=). Kontrol cubugunda yalniz iki eksen: gruplama
 * · yerlesim (liste · pano · takvim). Kapsam/tip/zaman/hizli filtre
 * eksenleri ayri kontrol DEGIL, gorunumun kendisidir (E1). Filtre
 * degisince "gorunum olarak kaydet" onerilir (E2). Sahipsiz isler kalici
 * "Triage" gorunumundedir (E3).
 *
 * Bu dosya yalnizca orkestrasyon yapar: kararlar hook/model katmaninda.
 * =============================================================================
 */
import { useState } from 'react'
import { Empty, message } from 'antd'
import dayjs from 'dayjs'
import useMultiAssignmentDrop from '../features/tasks/hooks/useMultiAssignmentDrop'
import useAssigneeScope from '../features/tasks/hooks/useAssigneeScope'
import useTaskArchiveWorkspace from '../features/tasks/hooks/useTaskArchiveWorkspace'
import TaskArchiveDialogs from '../features/tasks/components/TaskArchiveDialogs'
import MultiAssignmentConfirm from '../features/tasks/components/MultiAssignmentConfirm'
import { useAuthStore } from '../stores/authStore'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import {
    canChangeTaskStatus, resolveViewedUserId, selectTaskPermissions,
} from '../features/tasks/model/permissions'
import useTaskTypeRoute from '../features/tasks/hooks/useTaskTypeRoute'
import useViewWorkspace from '../features/tasks/hooks/useViewWorkspace'
import useCalendarMeetings from '../features/tasks/hooks/useCalendarMeetings'
import useTaskDirectory from '../features/tasks/hooks/useTaskDirectory'
import useTasksQuery from '../features/tasks/hooks/useTasksQuery'
import useTaskMutations from '../features/tasks/hooks/useTaskMutations'
import useTaskStatusMutation from '../features/tasks/hooks/useTaskStatusMutation'
import useTaskWorkLog from '../features/tasks/hooks/useTaskWorkLog'
import useTaskDialogs from '../features/tasks/hooks/useTaskDialogs'
import TasksHeader from '../features/tasks/components/TasksHeader'
import TaskViewsSidebar from '../features/tasks/components/TaskViewsSidebar'
import TaskAxisBar from '../features/tasks/components/TaskAxisBar'
import TaskFiltersDrawer from '../features/tasks/components/TaskFiltersDrawer'
import TasksSurface from '../features/tasks/components/TasksSurface'
import SaveViewModal from '../features/tasks/modals/SaveViewModal'
import TaskStatusConfirmModal from '../features/tasks/modals/TaskStatusConfirmModal'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskReviewModal from '../components/modals/TaskReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import { buildHierarchy } from '../features/tasks/model/hierarchy'
import { groupIntoLogicalItems, userLabel } from '../features/tasks/model/grouping'
import { useT } from '../i18n'
import './TasksPage.css'

function TasksPage() {
    const t = useT()
    const { user } = useAuthStore()
    const { isTaskAdmin, canAccessAny, scopes } = useTaskPermissions()

    // ── Diyaloglar ────────────────────────────────────────────────────────
    // Once kurulur: derin baglanti (?item=) Review modalini acar.
    const dialogs = useTaskDialogs({ defaultCreateType: 'task' })
    useTaskTypeRoute({ onDeepLinkTask: dialogs.openReview })

    // ── Izinler (baslangic: tur bagimsiz) ─────────────────────────────────
    const basePerms = selectTaskPermissions({ scopes, isTaskAdmin, canAccessAny })

    // ── Gorunum calisma alani: URL + kayitli gorunumler + filtreler ──────
    const ws = useViewWorkspace({
        canViewAssignedByMe: basePerms.canViewAssignedByMe, enabled: canAccessAny,
    })
    const q = ws.queryInputs
    const permType = q.taskType || 'task'

    // Fail-closed: scopes yuklenmemisken her sey false — yetkisiz kontrol
    // flash etmez. UI gizleme backend authorization'in YERINE GECMEZ.
    const taskPerms = selectTaskPermissions({
        scopes, isTaskAdmin, canAccessAny, taskType: permType,
        createType: dialogs.createType,
    })

    // Effective viewed user. Non-admin path always resolves to current user
    // regardless of the selector — backend also coerces, defense in depth.
    const viewedUserId = resolveViewedUserId({
        isTaskAdmin, selectedUserId: ws.selectedUserId, currentUserId: user?.id,
    })

    // Active | Archive ekseni URL'de yasar; arsiv havuzu SALT OKUNUR.
    const archive = useTaskArchiveWorkspace()
    const { archiveState, readOnly } = archive

    const { tasks, isLoading } = useTasksQuery({
        // Tipsiz gorunum (Bana ait / Tum isler): herhangi bir erisim yeter.
        enabled: q.taskType ? taskPerms.canAccessScope : canAccessAny,
        taskType: q.taskType,
        taskScope: q.taskScope,
        viewedUserId,
        rangeMode: q.rangeMode,
        weekStart: ws.weekStart,
        quickFilter: q.quickFilter,
        filters: ws.filters,
        archiveState,
        scopeAll: q.scopeAll,
        unassigned: q.unassigned,
    })

    const directory = useTaskDirectory({
        enabled: canAccessAny,
        isTaskAdmin,
        currentUser: user,
        tasks,
        customerFilter: ws.filters.customer,
        projectFilter: ws.filters.project,
    })

    const mutations = useTaskMutations({
        createType: dialogs.createType,
        onWriteSettled: dialogs.closeCreate,
        onTaskRefreshed: (updated) => {
            if (dialogs.reviewTask && dialogs.reviewTask.id === updated?.id) {
                dialogs.openReview(updated)
            }
        },
    })

    const { isAssignedByMe, assigneeOptions, visibleTasks } = useAssigneeScope({
        tasks,
        taskScope: q.taskScope,
        userMap: directory.userMap,
        assigneeFilter: ws.filters.assignee,
    })
    const status = useTaskStatusMutation()
    const workLog = useTaskWorkLog()
    const { meetings } = useCalendarMeetings({
        enabled: ws.layout === 'calendar', weekStart: ws.weekStart,
    })

    // Sol kolon "Projeler": sonuc kumesinin Musteri → Proje agaci.
    const projectTree = buildHierarchy(
        groupIntoLogicalItems(tasks, (id) => userLabel(id, directory.userMap)),
    )

    // ── Tamamla → Log Time akisi ──────────────────────────────────────────
    const executeToggle = async (task, nextCompleted) => {
        if (nextCompleted && task.status === 'pending') {
            await mutations.acceptMutation.mutateAsync(task.id)
            return
        }
        try {
            await mutations.completionMutation.mutateAsync({
                id: task.id, completed: nextCompleted,
            })
        } catch {
            return
        }
        if (nextCompleted) {
            dialogs.closeReview()
            workLog.openLogTime(task)
        }
    }

    const handleConfirmToggle = async () => {
        if (!dialogs.pendingToggle) return
        const { task, nextCompleted } = dialogs.pendingToggle
        await executeToggle(task, nextCompleted)
        dialogs.clearToggle()
    }

    // Board karti bir durum kolonuna birakildi → yalnizca durum degisir.
    const handleCardDrop = async (task, { newStatus }) => {
        if (!newStatus) return
        const canStatus = canChangeTaskStatus({
            task, currentUserId: user?.id, isTaskAdmin,
        })
        if (!canStatus) {
            message.info(t('tasks.statusNotAllowed'))
            return
        }
        const result = await status.changeTaskStatus({
            id: task.id, status: newStatus,
        })
        if (result.ok && newStatus === 'completed') workLog.openLogTime(task)
    }

    const multi = useMultiAssignmentDrop({
        currentUserId: user?.id,
        applyDrop: handleCardDrop,
        notify: (text) => message.info(text),
    })

    const handleReviewReopen = async (task) => {
        if (task.status === 'completed') {
            const updated = await mutations.completionMutation.mutateAsync({
                id: task.id, completed: false,
            })
            if (updated?.id) dialogs.openReview(updated)
        } else {
            await mutations.reopenMutation.mutateAsync(task.id)
        }
    }

    const canCreateTask =
        isTaskAdmin ||
        (taskPerms.canAssignTasks &&
            (taskPerms.assignableUserIds.length > 0 ||
                taskPerms.assignableGroupIds.length > 0))

    // ── Gorunum kaydet / guncelle / sil ───────────────────────────────────
    const [saveOpen, setSaveOpen] = useState(false)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const activeFilterCount = [
        ws.filters.status, ws.filters.priority, ws.filters.customer,
        ws.filters.project, ws.filters.subProject,
    ].filter(Boolean).length

    const handleSaveAs = async (values) => {
        try {
            await ws.saveAs(values)
            setSaveOpen(false)
            message.success(t('views.saved'))
        } catch {
            message.error(t('views.saveFailed'))
        }
    }
    const handleUpdate = async () => {
        try {
            await ws.updateCurrent()
            message.success(t('views.updated'))
        } catch {
            message.error(t('views.saveFailed'))
        }
    }
    const handleDeleteView = async (view) => {
        try {
            await ws.removeView(view)
            message.success(t('views.deleted'))
        } catch {
            message.error(t('views.saveFailed'))
        }
    }

    if (!canAccessAny) {
        return (
            <div style={{ padding: 24 }}>
                <Empty description={t('tasks.noAccess')} />
            </div>
        )
    }

    // Durum degisikligi atanana aittir; "Verdigim isler" salt izleme.
    const allowStatusChange = !readOnly && !isAssignedByMe
    const canCreate = !readOnly && (
        (canCreateTask && (isAssignedByMe || q.scopeAll))
        || (taskPerms.canSelfAssign && !isAssignedByMe)
    )

    return (
        <div className="tasks-page">
            <TasksHeader
                archiveState={archiveState}
                onArchiveStateChange={archive.setArchiveState}
                user={user}
                isTaskAdmin={isTaskAdmin}
                selectedUserId={ws.selectedUserId}
                onSelectUser={ws.setSelectedUserId}
                userSelectorOptions={directory.userSelectorOptions}
                usersLoaded={directory.allActiveUsers.length > 0}
                taskType={permType}
                userMap={directory.userMap}
                onOpenReview={dialogs.openReview}
            />

            <div className="tasks-body tv-workspace">
                <TaskViewsSidebar
                    systemViews={ws.systemViews}
                    personalViews={ws.personalViews}
                    sharedViews={ws.sharedViews}
                    activeViewId={ws.view.id}
                    onSelectView={ws.setViewId}
                    onDeleteView={handleDeleteView}
                    projectTree={projectTree}
                    folderSelection={ws.folderSelection}
                    onSelectFolder={ws.selectFolder}
                />

                <div className="tv-main">
                    <TaskAxisBar
                        layout={ws.layout}
                        onSelectLayout={ws.setLayout}
                        groupBy={ws.groupBy}
                        onSelectGroup={ws.setGroupBy}
                        dirty={ws.dirty}
                        canUpdate={ws.canUpdate}
                        onSaveAs={() => setSaveOpen(true)}
                        onUpdate={handleUpdate}
                        saving={ws.isSaving}
                        activeFilterCount={activeFilterCount}
                        onOpenFilters={() => setFiltersOpen(true)}
                        onClearFilters={ws.clearFilters}
                    />

                    <TaskFiltersDrawer
                        open={filtersOpen}
                        onClose={() => setFiltersOpen(false)}
                        placement={
                            typeof window !== 'undefined' && window.innerWidth < 768
                                ? 'bottom' : 'right'
                        }
                        filters={ws.filters}
                        customers={directory.customers}
                        projects={directory.filteredProjects}
                        subProjects={directory.subProjects}
                        assigneeOptions={assigneeOptions}
                        onStatusChange={ws.filterActions.setStatus}
                        onPriorityChange={ws.filterActions.setPriority}
                        onCustomerChange={ws.filterActions.setCustomer}
                        onProjectChange={ws.filterActions.setProject}
                        onSubProjectChange={ws.filterActions.setSubProject}
                        onAssigneeChange={ws.filterActions.setAssignee}
                        onClear={ws.clearFilters}
                    />

                    <TasksSurface
                        isLoading={isLoading}
                        layout={ws.layout}
                        groupBy={ws.groupBy}
                        tasks={visibleTasks}
                        userMap={directory.userMap}
                        currentUserId={user?.id}
                        isAdmin={isTaskAdmin}
                        taskType={permType}
                        allowStatusChange={allowStatusChange}
                        canCreate={canCreate}
                        completionLoading={mutations.completionMutation.isPending}
                        panelTask={dialogs.panelTask}
                        onEditTask={dialogs.openEdit}
                        onDeleteTask={dialogs.openDelete}
                        onOpenReview={dialogs.openReview}
                        onOpenLogTime={workLog.openLogTime}
                        onToggleCompletion={dialogs.requestToggle}
                        onCreate={dialogs.openCreate}
                        onCardDrop={handleCardDrop}
                        onMultiAssignmentDrop={multi.start}
                        onOpenPanel={dialogs.openPanel}
                        onClosePanel={dialogs.closePanel}
                        onToggleWatch={mutations.toggleWatch}
                        watchPending={mutations.watchPending}
                        weekStart={ws.weekStart}
                        onPreviousWeek={ws.goToPreviousWeek}
                        onNextWeek={ws.goToNextWeek}
                        onCurrentWeek={ws.goToCurrentWeek}
                        meetings={meetings}
                    />
                </div>
            </div>

            <SaveViewModal
                open={saveOpen}
                onClose={() => setSaveOpen(false)}
                onSubmit={handleSaveAs}
                loading={ws.isSaving}
                initialName={ws.view.saved ? `${ws.view.name} (${dayjs().format('DD MMM')})` : ''}
            />

            <CreateTaskModal
                open={dialogs.createOpen}
                onClose={dialogs.closeCreate}
                onSubmit={mutations.submitTask}
                initialDate={dialogs.initialDate}
                editingTask={dialogs.editingTask}
                taskType={dialogs.createType}
                assignableUserIds={taskPerms.createAssignableUserIds}
                isAdmin={isTaskAdmin}
                loading={mutations.isSavingTask}
            />

            <TaskReviewModal
                open={!!dialogs.reviewTask}
                task={dialogs.reviewTask}
                userMap={directory.userMap}
                onClose={dialogs.closeReview}
                canAct={
                    !isAssignedByMe &&
                    canChangeTaskStatus({
                        task: dialogs.reviewTask,
                        currentUserId: user?.id,
                        isTaskAdmin,
                    })
                }
                onAccept={(task) => mutations.acceptMutation.mutateAsync(task.id)}
                onMarkCompleted={async (task) => {
                    dialogs.closeReview()
                    await executeToggle(task, true)
                }}
                onReject={(task) => mutations.rejectMutation.mutateAsync(task.id)}
                onReopen={handleReviewReopen}
                actionLoading={mutations.isStatusActionPending}
                currentUserId={user?.id}
                isAdmin={isTaskAdmin}
            />

            <TaskStatusConfirmModal
                pendingToggle={dialogs.pendingToggle}
                loading={
                    mutations.completionMutation.isPending ||
                    mutations.acceptMutation.isPending
                }
                onCancel={dialogs.clearToggle}
                onConfirm={handleConfirmToggle}
            />

            <TaskArchiveDialogs
                workspace={archive}
                dialogs={dialogs}
                deleteMutation={mutations.deleteMutation}
            />

            <LogTimeModal
                open={!!workLog.logTimeTask}
                onClose={workLog.closeLogTime}
                onSubmit={workLog.submitWorkLog}
                prefillTask={workLog.logTimeTask}
                initialDate={workLog.logTimeTask?.scheduled_date || null}
                loading={workLog.isLoggingTime}
            />

            <MultiAssignmentConfirm
                pending={multi.pending}
                userMap={directory.userMap}
                onToggle={multi.toggle}
                onCancel={multi.cancel}
                onConfirm={multi.confirm}
            />
        </div>
    )
}

export default TasksPage
