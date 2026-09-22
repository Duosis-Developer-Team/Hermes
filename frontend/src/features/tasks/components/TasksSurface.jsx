/**
 * =============================================================================
 * HERMES - Gorev yuzeyi: yukleniyor / Pano / Liste / Takvim + detay paneli
 * =============================================================================
 * Uc yerlesim AYNI, zaten filtrelenmis `tasks` dizisini tuketir; gorunum,
 * capraz filtreler ve admin kullanici secimi UST katmanda cozulur. Bu
 * yuzden yerlesim degistirmek ne sorguyu ne izin kuralini degistirir
 * (kilit: src/test/tasks/viewParity.integration.test.jsx).
 *
 * Gruplama (P3.5 / E1): pano → sutun = durum ya da kulvar = sahip; liste
 * → bolumler (proje · durum · sahip · termin); takvim → gun. Ikinci bir
 * drag engine veya kart dili YOK: Pano hep TasksBoardView'dir.
 *
 * Aksiyon kurallari tektir ve hepsine AYNI prop'larla gecer.
 * =============================================================================
 */
import { useMemo } from 'react'
import { Spin } from 'antd'
import dayjs from 'dayjs'

import TasksBoardView from '../../../components/tasks/TasksBoardView'
import TasksListView from '../../../components/tasks/TasksListView'
import TaskDetailPanel from '../../../components/tasks/TaskDetailPanel'
import TasksCalendarView from './TasksCalendarView'
import {
    groupIntoLogicalItems, logicalKeyOf, userLabel,
} from '../model/grouping'
import { partitionTasks } from '../model/viewGroups'
import { useT } from '../../../i18n'
import './tasksViews.css'

function GroupedList({ tasks, groupBy, userMap, listProps }) {
    const t = useT()
    const sections = useMemo(() => partitionTasks(tasks, groupBy, {
        userMap,
        today: dayjs(),
        labels: {
            noOwner: t('views.noOwner'),
            due: {
                overdue: t('views.dueBucket.overdue'), today: t('views.dueBucket.today'),
                week: t('views.dueBucket.week'), later: t('views.dueBucket.later'),
                none: t('views.dueBucket.none'),
            },
        },
    }), [tasks, groupBy, userMap, t])

    if (sections.length === 1 && sections[0].label === null) {
        return <TasksListView {...listProps} tasks={tasks} />
    }
    return sections.map((section) => (
        <section key={section.key} className="tv-group" data-group={section.key}>
            <div className="tv-group__head">
                <span>{section.label}</span>
                <span className="tv-group__count">{section.count}</span>
            </div>
            <TasksListView {...listProps} tasks={section.tasks} />
        </section>
    ))
}

function TasksSurface({
    isLoading,
    layout = 'board',
    groupBy = 'status',
    tasks,
    userMap,
    currentUserId,
    isAdmin,
    taskType,
    allowStatusChange,
    canCreate,
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
    onToggleWatch,
    watchPending = false,
    /* Takvim yerlesimi (E5) */
    weekStart,
    onPreviousWeek, onNextWeek, onCurrentWeek,
    meetings = null,
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

    const listProps = useMemo(() => ({ ...shared, allowStatusChange }), [shared, allowStatusChange])

    return (
        <div className="tasks-view-row">
            <div className="tasks-view-main">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}>
                        <Spin />
                    </div>
                ) : layout === 'list' ? (
                    <GroupedList tasks={tasks} groupBy={groupBy} userMap={userMap} listProps={listProps} />
                ) : layout === 'calendar' ? (
                    <TasksCalendarView
                        tasks={tasks}
                        userMap={userMap}
                        weekStart={weekStart}
                        onPreviousWeek={onPreviousWeek}
                        onNextWeek={onNextWeek}
                        onCurrentWeek={onCurrentWeek}
                        onOpenPanel={onOpenPanel}
                        meetings={meetings}
                    />
                ) : (
                    <TasksBoardView
                        {...shared}
                        onCreate={onCreate}
                        canCreate={canCreate}
                        groupByAssignee={groupBy === 'owner'}
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
                    onToggleWatch={onToggleWatch}
                    watchPending={watchPending}
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
