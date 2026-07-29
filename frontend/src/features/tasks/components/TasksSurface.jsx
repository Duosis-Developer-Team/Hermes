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
import { Spin } from 'antd'

import TasksBoardView from '../../../components/tasks/TasksBoardView'
import TasksListView from '../../../components/tasks/TasksListView'
import TaskDetailPanel from '../../../components/tasks/TaskDetailPanel'

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
    onOpenPanel,
    onClosePanel,
}) {
    const shared = {
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
    }

    return (
        <div className="tasks-view-row">
            <div className="tasks-view-main">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}>
                        <Spin />
                    </div>
                ) : viewLayout === 'list' ? (
                    <TasksListView {...shared} allowStatusChange={allowStatusChange} />
                ) : (
                    <TasksBoardView
                        {...shared}
                        onCreate={onCreate}
                        canCreate={canCreate}
                        groupByAssignee={groupByAssignee}
                        allowStatusDrag={allowStatusChange}
                        onCardDrop={onCardDrop}
                    />
                )}
            </div>
            {panelTask && (
                <TaskDetailPanel
                    task={panelTask}
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
