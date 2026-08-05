/**
 * =============================================================================
 * HERMES - Tasks Page (route orkestrasyonu)
 * =============================================================================
 * Board / List gorunumu, kullanicinin gorebildigi gorevlerle sinirli.
 *
 * Sprint 5C: bu dosya artik YALNIZCA baglayicidir — durum, sorgu,
 * mutasyon, tarih matematigi ve izin karari `src/features/tasks` altina
 * kendi sinirlarina ayrildi:
 *
 *   model/      permissions · constants · dates · taskQuery
 *   hooks/      useTaskTypeRoute · useTaskViewState · useTaskFilters
 *               useTaskDirectory · useTasksQuery · useTaskInvalidation
 *               useTaskMutations · useTaskStatusMutation · useTaskWorkLog
 *               useTaskDialogs
 *   components/ TasksHeader · TaskQuickFilters · TaskRangeBar
 *               TaskFilterBar · TasksSurface
 *   modals/     TaskArchiveModal · TaskRestoreModal · TaskStatusConfirmModal
 *
 * TEK bir "mega hook" YOKTUR: her hook tek bir soruyu cevaplar ve tek
 * basina test edilebilir. Burada kalan is, aralarindaki AKISI kurmak —
 * ozellikle "tamamla → Log Time" gecisi.
 * =============================================================================
 */

import { useState } from 'react'
import { Empty, message } from 'antd'
import useMultiAssignmentDrop from '../features/tasks/hooks/useMultiAssignmentDrop'
import useAssigneeScope from '../features/tasks/hooks/useAssigneeScope'
import useTaskArchiveWorkspace from '../features/tasks/hooks/useTaskArchiveWorkspace'
import TaskLifecycleSwitcher from '../features/tasks/components/TaskLifecycleSwitcher'
import TaskArchiveDialogs from '../features/tasks/components/TaskArchiveDialogs'
import MultiAssignmentConfirm from '../features/tasks/components/MultiAssignmentConfirm'

import { useAuthStore } from '../stores/authStore'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import {
    canChangeTaskStatus, resolveViewedUserId, selectTaskPermissions,
} from '../features/tasks/model/permissions'
import useTaskTypeRoute from '../features/tasks/hooks/useTaskTypeRoute'
import useTaskViewState from '../features/tasks/hooks/useTaskViewState'
import useTaskFilters from '../features/tasks/hooks/useTaskFilters'
import useTaskDirectory from '../features/tasks/hooks/useTaskDirectory'
import useTasksQuery from '../features/tasks/hooks/useTasksQuery'
import useTaskMutations from '../features/tasks/hooks/useTaskMutations'
import useTaskStatusMutation from '../features/tasks/hooks/useTaskStatusMutation'
import useTaskWorkLog from '../features/tasks/hooks/useTaskWorkLog'
import useTaskDialogs from '../features/tasks/hooks/useTaskDialogs'
import TasksHeader from '../features/tasks/components/TasksHeader'
import TaskQuickFilters from '../features/tasks/components/TaskQuickFilters'
import TaskRangeBar from '../features/tasks/components/TaskRangeBar'
import TaskFiltersDrawer from '../features/tasks/components/TaskFiltersDrawer'
import { Badge, Button as AntButton } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import TasksSurface from '../features/tasks/components/TasksSurface'
import TaskStatusConfirmModal from '../features/tasks/modals/TaskStatusConfirmModal'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskReviewModal from '../components/modals/TaskReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import './TasksPage.css'

function TasksPage() {
    const { user } = useAuthStore()
    const { isTaskAdmin, canAccessAny, scopes } = useTaskPermissions()

    // ── Diyaloglar ────────────────────────────────────────────────────────
    // Once kurulur: derin baglanti (?item=) Review modalini acar.
    const dialogs = useTaskDialogs({ defaultCreateType: 'task' })
    const { taskType, goToType } = useTaskTypeRoute({
        onDeepLinkTask: dialogs.openReview,
    })

    // ── Izinler: TUM kararlar TEK selector katmanindan (Sprint 5 §4) ──────
    // Fail-closed: scopes yuklenmemisken her sey false — yetkisiz kontrol
    // flash etmez. UI gizleme backend authorization'in YERINE GECMEZ.
    const taskPerms = selectTaskPermissions({
        scopes, isTaskAdmin, canAccessAny, taskType,
        createType: dialogs.createType,
    })

    const view = useTaskViewState({
        canViewAssignedByMe: taskPerms.canViewAssignedByMe,
    })
    const { filters, clearFilters, ...filterActions } = useTaskFilters()

    // Effective viewed user. Non-admin path always resolves to current user
    // regardless of the selector — backend also coerces, defense in depth.
    const viewedUserId = resolveViewedUserId({
        isTaskAdmin, selectedUserId: view.selectedUserId, currentUserId: user?.id,
    })

    // Active | Archive ekseni URL'de yasar; arsiv havuzu SALT OKUNUR.
    const archive = useTaskArchiveWorkspace()
    const { archiveState, readOnly } = archive

    const { tasks, isLoading } = useTasksQuery({
        enabled: taskPerms.canAccessScope,
        taskType,
        taskScope: view.taskScope,
        viewedUserId,
        rangeMode: view.rangeMode,
        weekStart: view.weekStart,
        quickFilter: view.quickFilter,
        filters,
        archiveState,
    })

    const directory = useTaskDirectory({
        enabled: canAccessAny,
        isTaskAdmin,
        currentUser: user,
        tasks,
        customerFilter: filters.customer,
        projectFilter: filters.project,
    })

    const mutations = useTaskMutations({
        createType: dialogs.createType,
        onWriteSettled: dialogs.closeCreate,
        // Review modali acikken durum degisirse, kullanici kapatmadan
        // once guncel bayragi gorsun (eski not modalinin deseni).
        onTaskRefreshed: (updated) => {
            if (dialogs.reviewTask && dialogs.reviewTask.id === updated?.id) {
                dialogs.openReview(updated)
            }
        },
    })

    // Kisi ekseni: secenekler + istemci tarafi daraltma (hook'ta).

    const { isAssignedByMe, assigneeOptions, visibleTasks } = useAssigneeScope({
        tasks,
        taskScope: view.taskScope,
        userMap: directory.userMap,
        assigneeFilter: filters.assignee,
    })
    const status = useTaskStatusMutation()
    const workLog = useTaskWorkLog()

    // ── Tamamla → Log Time akisi ──────────────────────────────────────────
    // Cagiranlar ONCE onaylatir (kart checkbox'i onay modalinden gecer;
    // Review modalinin kendi onayi vardir).
    const executeToggle = async (task, nextCompleted) => {
        // Workflow gate: pending bir gorev DOGRUDAN tamamlanamaz. Ilk
        // "tamamla" aksiyonu onu KABUL eder (→ In Progress); atanan bir
        // sonraki aksiyonda tamamlar.
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
            // Log Time YALNIZCA tamamlanmaya ILK geciste acilir.
            // Yeniden acma (completed → pending) bilerek hicbir sey yapmaz.
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
    // Atanan olusturmada sabittir (surukleyerek yeniden atama YOK). Izin
    // board tarafinda da kontrol edilir; bu ikinci savunmadir.
    const handleCardDrop = async (task, { newStatus }) => {
        if (!newStatus) return
        // Board zaten surukleme kapisini uyguluyor; bu IKINCI savunmadir
        // (orn. kart cizildikten sonra gorev baskasina atanirsa). Kural
        // AYNI selector'dan gelir — kopya yok.
        const canStatus = canChangeTaskStatus({
            task, currentUserId: user?.id, isTaskAdmin,
        })
        if (!canStatus) {
            message.info('You are not allowed to change this task status.')
            return
        }
        const result = await status.changeTaskStatus({
            id: task.id, status: newStatus,
        })
        // Checkbox akisinin verdigi Log Time davetini KORU — yalnizca
        // GERCEKTEN calisan bir gecisin ardindan.
        if (result.ok && newStatus === 'completed') workLog.openLogTime(task)
    }

    // Coklu atama surukleme onayi — kural ve durum hook'ta (§11).
    const multi = useMultiAssignmentDrop({
        currentUserId: user?.id,
        applyDrop: handleCardDrop,
        notify: (text) => message.info(text),
    })

    const handleReviewReopen = async (task) => {
        if (task.status === 'completed') {
            // Yanlislikla tamamlamayi geri al → In Progress (kendi isini
            // yeniden kabul etmeye gerek yok).
            const updated = await mutations.completionMutation.mutateAsync({
                id: task.id, completed: false,
            })
            if (updated?.id) dialogs.openReview(updated)
        } else {
            // Reddedilmis → Pending (yeniden kabul edilmeli).
            await mutations.reopenMutation.mutateAsync(task.id)
        }
    }

    // Create requires assign permission AND at least one assignable target
    // (user OR group): sadece grup eslemesi uzerinden atayabilen — ya da
    // dogrudan eslemeleri bir izin kapatma cascade'iyle silinmis —
    // kullanicilardan Create'i gizlememek icin ikisi de sayilir.
    const canCreateTask =
        isTaskAdmin ||
        (taskPerms.canAssignTasks &&
            (taskPerms.assignableUserIds.length > 0 ||
                taskPerms.assignableGroupIds.length > 0))

    // Premium: gelismis filtreler artik surekli acik bir serit degil —
    // tek "Filters" aksiyonuyla acilan drawer (mobilde bottom sheet).
    const [filtersOpen, setFiltersOpen] = useState(false)
    const activeFilterCount = [
        filters.status, filters.priority, filters.customer,
        filters.project, filters.subProject,
    ].filter(Boolean).length

    if (!canAccessAny) {
        return (
            <div style={{ padding: 24 }}>
                <Empty description="You do not have access to the Tasks module." />
            </div>
        )
    }

    return (
        <div className="tasks-page">
            <TaskLifecycleSwitcher
                value={archiveState}
                onChange={archive.setArchiveState}
            />
            <TasksHeader
                user={user}
                isTaskAdmin={isTaskAdmin}
                canViewAssignedByMe={taskPerms.canViewAssignedByMe}
                selectedUserId={view.selectedUserId}
                onSelectUser={view.setSelectedUserId}
                userSelectorOptions={directory.userSelectorOptions}
                usersLoaded={directory.allActiveUsers.length > 0}
                taskType={taskType}
                onSelectType={goToType}
                userMap={directory.userMap}
                onOpenReview={dialogs.openReview}
                taskScope={view.taskScope}
                onSelectScope={view.setTaskScope}
                viewLayout={view.viewLayout}
                onSelectLayout={view.setViewLayout}
                groupByAssignee={view.groupByAssignee}
                onToggleGroupByAssignee={view.setGroupByAssignee}
            />

            <TaskQuickFilters
                value={view.quickFilter}
                onToggle={view.toggleQuickFilter}
                onClear={view.clearQuickFilter}
            />

            {/* Hizli filtre aktifken aralik seridi gizlenir: filtre kendi
                tarih penceresini getirir, ikisi ayni anda anlamsizdir. */}
            {!view.quickFilter && (
                <TaskRangeBar
                    rangeMode={view.rangeMode}
                    onSelectRange={view.setRangeMode}
                    weekStart={view.weekStart}
                    weekEnd={view.weekStart.endOf('isoWeek')}
                    onPreviousWeek={view.goToPreviousWeek}
                    onCurrentWeek={view.goToCurrentWeek}
                    onNextWeek={view.goToNextWeek}
                />
            )}

            <div className="tasks-body">
                <div className="tasks-filters-row">
                    <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
                        <AntButton
                            icon={<FilterOutlined />}
                            onClick={() => setFiltersOpen(true)}
                            aria-label="Filters"
                        >
                            Filters
                        </AntButton>
                    </Badge>
                    {activeFilterCount > 0 && (
                        <AntButton type="text" onClick={clearFilters}>
                            Clear
                        </AntButton>
                    )}
                </div>
                <TaskFiltersDrawer
                    open={filtersOpen}
                    onClose={() => setFiltersOpen(false)}
                    placement={
                        typeof window !== 'undefined' && window.innerWidth < 768
                            ? 'bottom' : 'right'
                    }
                    filters={filters}
                    customers={directory.customers}
                    projects={directory.filteredProjects}
                    subProjects={directory.subProjects}
                    assigneeOptions={assigneeOptions}
                    onStatusChange={filterActions.setStatus}
                    onPriorityChange={filterActions.setPriority}
                    onCustomerChange={filterActions.setCustomer}
                    onProjectChange={filterActions.setProject}
                    onSubProjectChange={filterActions.setSubProject}
                    onAssigneeChange={filterActions.setAssignee}
                    onClear={clearFilters}
                />

                <TasksSurface
                    isLoading={isLoading}
                    viewLayout={view.viewLayout}
                    tasks={visibleTasks}
                    canGroupByUser={isAssignedByMe}
                    userMap={directory.userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    taskType={taskType}
                    /* Durum degisikligi atanana aittir ve kendi "My Tasks"
                       gorunumunde yapilir; "Assigned by Me" salt izleme. */
                    allowStatusChange={!readOnly && view.taskScope === 'my-tasks'}
                    /* Gorev olusturmak = birine ATAMAK; yalnizca
                       "Assigned by Me" kapsaminda anlamlidir. */
                    canCreate={!readOnly && canCreateTask && view.taskScope === 'assigned-by-me'}
                    groupByAssignee={
                        view.groupByAssignee && view.taskScope === 'assigned-by-me'
                    }
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
                />
            </div>

            {/* Create / Edit modal — same Hermes Time Entry pattern */}
            <CreateTaskModal
                open={dialogs.createOpen}
                onClose={dialogs.closeCreate}
                onSubmit={mutations.submitTask}
                initialDate={dialogs.initialDate}
                editingTask={dialogs.editingTask}
                taskType={dialogs.createType}
                /* Create modali OLUSTURULAN turun scope'unu kullanir —
                   goruntulenen turden farkli olabilir ("+ New Issue"
                   Tasks sekmesindeyken). */
                assignableUserIds={taskPerms.createAssignableUserIds}
                isAdmin={isTaskAdmin}
                loading={mutations.isSavingTask}
            />

            {/* Review modal — read-only details + decision actions. Same
                canAct gate the backend enforces (admin, assignee, assigner). */}
            <TaskReviewModal
                open={!!dialogs.reviewTask}
                task={dialogs.reviewTask}
                userMap={directory.userMap}
                onClose={dialogs.closeReview}
                canAct={
                    // Durum aksiyonlari "My Tasks"ta yasar (atanan kendi
                    // isine karar verir). "Assigned by Me"de atayan
                    // yalnizca izler — modal orada salt okunurdur.
                    // Gorev bazli kural yine TEK selector'dan gelir.
                    view.taskScope === 'my-tasks' &&
                    canChangeTaskStatus({
                        task: dialogs.reviewTask,
                        currentUserId: user?.id,
                        isTaskAdmin,
                    })
                }
                onAccept={(task) => mutations.acceptMutation.mutateAsync(task.id)}
                onMarkCompleted={async (task) => {
                    // Modal icinde zaten onaylandi — dogrudan calistir.
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

            {/* Log Time modal — opens automatically after a task is
                completed for the first time, and on the explicit
                "Log Time" action for a completed task. */}
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
