/**
 * =============================================================================
 * HERMES - Gorev yuzeyi: yukleniyor / Board / List + detay paneli
 * =============================================================================
 * Board ve List AYNI, zaten filtrelenmis `tasks` dizisini tuketir; kapsam,
 * hizli filtre, capraz filtreler ve admin kullanici secimi UST katmanda
 * cozulur. Bu yuzden gorunum degistirmek ne sorguyu ne izin kuralini
 * degistirir (kilit: src/test/tasks/viewParity.integration.test.jsx).
 *
 * Aksiyon kurallari da tektir ve ikisine AYNI prop'larla gecer:
 *   - durum degisikligi yalnizca "My Tasks" kapsaminda (atanan is yapar),
 *     "Assigned by Me" salt izlemedir,
 *   - Edit/Delete admin VEYA atayan icin gorunur (karti ciziyor).
 * =============================================================================
 */
import { useMemo } from 'react'
import { Spin } from 'antd'

import TasksBoardView from '../../../components/tasks/TasksBoardView'
import TasksListView from '../../../components/tasks/TasksListView'
import TaskDetailPanel from '../../../components/tasks/TaskDetailPanel'
import TasksExplorerView from './TasksExplorerView'
import {
    groupIntoLogicalItems, logicalKeyOf, userLabel,
} from '../model/grouping'

function TasksSurface({
    isLoading,
    viewLayout,
    tasks,
    userMap,
    currentUserId,
    isAdmin,
    taskType,
    allowStatusChange,
    canCreate,
    groupByAssignee,
    completionLoading,
    panelTask,
    onEditTask,
    onDeleteTask,
    onOpenReview,
    onOpenLogTime,
    onToggleCompletion,
    onCreate,
    onCardDrop,
    onMultiAssignmentDrop,
    onOpenPanel,
    onClosePanel,
}) {
    /* Referans kararliligi: alt agaclar memo'lu oldugu icin bu nesne
       her render'da yeniden uretilirse memo hicbir zaman tutmaz. */
    const shared = useMemo(() => ({
        tasks,
        userMap,
        currentUserId,
        isAdmin,
        taskType,
        onEditTask,
        onDeleteTask,
        onOpenReview,
        onOpenLogTime,
        onToggleCompletion,
        completionLoading,
        onOpenPanel,
    }), [
        tasks, userMap, currentUserId, isAdmin, taskType,
        onEditTask, onDeleteTask, onOpenReview, onOpenLogTime,
        onToggleCompletion, completionLoading, onOpenPanel,
    ])

    /* Acik paneldeki gorevin ait oldugu logical work item'in TUM
       gorunur assignment'lari — detayda eksiksiz roster gosterilir
       (§12). Gruplama tek kaynaktan gelir. */
    const panelAssignments = useMemo(() => {
        if (!panelTask) return null
        const key = logicalKeyOf(panelTask)
        const item = groupIntoLogicalItems(tasks, (id) => userLabel(id, userMap))
            .find((i) => i.key === key)
        return item ? item.assignments : null
    }, [panelTask, tasks, userMap])

    const explorerBoardProps = useMemo(() => ({
        ...shared,
        onCreate,
        canCreate,
        allowStatusDrag: allowStatusChange,
        onCardDrop,
        onMultiAssignmentDrop,
    }), [
        shared, onCreate, canCreate, allowStatusChange, onCardDrop,
        onMultiAssignmentDrop,
    ])

    return (
        <div className="tasks-view-row">
            <div className="tasks-view-main">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}>
                        <Spin />
                    </div>
                ) : viewLayout === 'list' ? (
                    <TasksListView {...shared} allowStatusChange={allowStatusChange} />
                ) : viewLayout === 'explorer' ? (
                    /* Explorer, calisma alaninda AYNI Board'u kullanir —
                       ikinci bir drag engine veya ikinci bir kart dili
                       olusmaz (§6.4). */
                    <TasksExplorerView
                        tasks={tasks}
                        boardProps={explorerBoardProps}
                    />
                ) : (
                    <TasksBoardView
                        {...shared}
                        onCreate={onCreate}
                        canCreate={canCreate}
                        groupByAssignee={groupByAssignee}
                        allowStatusDrag={allowStatusChange}
                        onCardDrop={onCardDrop}
                        onMultiAssignmentDrop={onMultiAssignmentDrop}
                    />
                )}
            </div>
            {panelTask && (
                <TaskDetailPanel
                    task={panelTask}
                    assignments={panelAssignments}
                    userMap={userMap}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onClose={onClosePanel}
                    onOpenReview={(t) => {
                        onClosePanel()
                        onOpenReview(t)
                    }}
                />
            )}
        </div>
    )
}

export default TasksSurface
