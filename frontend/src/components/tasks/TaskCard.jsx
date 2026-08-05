/**
 * =============================================================================
 * HERMES - Task Card
 * =============================================================================
 * Mirrors WorkLogCard interaction model:
 *   - Body click toggles selection for the copy/paste workflow.
 *   - Hover shows Edit (pencil) and Archive (inbox) actions in the
 *     top-right corner — same placement and style as Time Entry.
 *   - Edit opens the existing CreateTaskModal in edit mode.
 *   - Archive fires a confirmation flow handled by the parent page.
 *     GERCEK SILME DEGILDIR: backend archived_at yazar, kayit
 *     korunur ve geri alinabilir.
 *   - The completion checkbox stays on the left.
 *
 * Receives a `userMap` prop (id → user object) populated by the parent
 * page from a single auth-service /users/lookup call.
 *
 * Variants:
 *   - default    : a normal task card on its scheduled date
 *   - completed  : green/strikethrough state, still selectable + clickable
 *   - dueMarker  : compact "Due: …" indicator shown on the due-date column
 * =============================================================================
 */

import { Checkbox, Tooltip } from 'antd'
import {
    InboxOutlined,
    EditOutlined,
    EyeOutlined,
    FieldTimeOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import { taskDueState } from '../../features/tasks/model/taskDueState'
import { canEditTask } from '../../features/tasks/model/permissions'
import { typeMeta } from '../../utils/workItemType'
import { AssignmentRoster } from '../../features/tasks/components/AssigneeStatusBadge'
import { aggregateStatus } from '../../features/tasks/model/grouping'
import './TaskCard.css'

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    // Never leak a raw UUID into the UI — fall back to a neutral dash if
    // the name hasn't resolved yet / the user isn't in the lookup set.
    return u?.full_name || u?.email || '—'
}

const DUE_STATE_LABEL = {
    overdue: 'OVERDUE',
    due_today: 'DUE TODAY',
    due_soon: 'DUE SOON',
}

/** Badge component reused across card/list/board surfaces. */
export function TaskDueBadge({ task, compact = false }) {
    const state = taskDueState(task)
    if (!state) return null
    return (
        <span
            className={`task-due-badge task-due-badge-${state}${
                compact ? ' task-due-badge-compact' : ''
            }`}
        >
            {DUE_STATE_LABEL[state]}
        </span>
    )
}

const STATUS_LABELS = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    rejected: 'Rejected',
}

function TaskCard({
    task,
    userMap = {},
    currentUserId,
    isAdmin = false,
    /** Selection toggle — fired by body click on a non-completed task
        (Time Entry parity). On a completed task body click instead opens
        the Log Time modal via onOpenLogTime. */
    onSelect,
    /** Opens the create/edit modal in edit mode. Hover Edit icon. */
    onEdit,
    /** Hover Delete icon — parent shows the confirm modal. */
    onDelete,
    /** Hover Review icon — opens the read-only Review Task modal that
        also surfaces the Mark as Completed / Reject Task actions. */
    onOpenReview,
    /** Hover Log Time icon (completed only) and body click on completed.
        Parent opens the prefilled Log Time modal. */
    onOpenLogTime,
    onToggleCompletion,
    canToggleCompletion,
    completionLoading = false,
    /** Gruplanmis logical work item'in TUM gorunur assignment'lari.
        Verildiginde (birden fazlaysa) tek-assignee ipucu yerine roster
        cizilir — ayni is kisi basina TEKRAR kart uretmez (§8/§9).
        Tek assignment'ta mevcut gorunum aynen korunur. */
    assignments = null,
}) {
    // Coklu atama: roster cizilir. Tek atamada eski gorunum korunur —
    // bu bir GORUNUM karari, yetki karari degil.
    const isGrouped = Array.isArray(assignments) && assignments.length > 1
    /*
     * KARTIN DURUMU: gruplanmis kartta TEMSILCI satirin durumu DEGIL,
     * AGGREGATE durum gosterilir. Aksi halde kart "In Progress"
     * sutununda dururken uzerinde "COMPLETED" etiketi ve ustu cizili
     * baslik gorunuyordu (gorsel QA'de yakalandi) — cunku temsilci
     * satir tamamlanmisti. Aggregate tek kaynaktan gelir.
     */
    const cardStatus = isGrouped ? aggregateStatus(assignments) : task.status
    const isCompleted = cardStatus === 'completed'
    // GORUNUM karari (hangi satir gosterilecek) — yetki DEGIL.
    const showAssignee = task.assignee_user_id !== currentUserId
    // YETKI karari tek kaynaktan gelir (features/tasks/model/permissions).
    const canEditCore = canEditTask({
        task, currentUserId, isTaskAdmin: isAdmin,
    })
    const dueDifferent =
        task.due_date && task.due_date !== task.scheduled_date

    const handleCheckboxClick = (event) => {
        event.stopPropagation()
        if (!canToggleCompletion || completionLoading) return
        onToggleCompletion?.(task, !isCompleted)
    }

    const handleBodyClick = (event) => {
        event.stopPropagation()
        // Clicking the card always opens the detail panel. Log Time for a
        // completed task is reachable via its hover action button.
        onSelect?.(task)
    }

    const handleLogTimeClick = (event) => {
        event.stopPropagation()
        onOpenLogTime?.(task)
    }

    const handleEditClick = (event) => {
        event.stopPropagation()
        onEdit?.(task)
    }

    const handleDeleteClick = (event) => {
        event.stopPropagation()
        onDelete?.(task)
    }

    const handleReviewClick = (event) => {
        event.stopPropagation()
        onOpenReview?.(task)
    }

    const subProjectSegment = task.sub_project_name
        ? ` · ${task.sub_project_name}`
        : ''

    // CTO urun karari (2026-07-29): Task copy/paste kapsam DISI.
    // Calendar tabanli hedef-gun akisi Board/List modeline tasinmadi;
    // secim durumu artik yalnizca detay panelini acar.
    const className =
        'task-card' +
        ` task-card-type-${task.task_type || 'task'}` +
        (isCompleted ? ' task-card-completed' : '')

    return (
        /*
         * KOK ARTIK INTERAKTIF DEGIL (Sprint 7).
         *
         * Onceden burada `role="button" tabIndex={0}` vardi ve kartin
         * ICINDE checkbox ile aksiyon butonlari yer aliyordu: bir buton
         * rolunun icine baska interaktif kontroller yerlestirilmisti.
         * Bu gecersiz semantiktir — ekran okuyucu ic kontrolleri dogru
         * sunmaz ve klavye sirasi bulaniklasir. Sorun `stopPropagation`
         * ile ORTULMEDI, HTML semantigiyle cozuldu:
         *
         *   - Kok: sade bir kapsayici. Fare kullanicisi icin kartin her
         *     yerine tiklama KORUNDU (alisilmis davranis), ama artik
         *     buton gibi ANONS EDILMIYOR.
         *   - Acma islemi icin ACIK ve klavyeyle erisilebilir bir kontrol
         *     var: baslik gercek bir <button>. Odak halkasi, Enter/Space
         *     ve erisilebilir ad ondan gelir.
         */
        <div
            className={className}
            onClick={handleBodyClick}
        >
            <Tooltip
                title={
                    canToggleCompletion
                        ? isCompleted
                            ? `Reopen ${typeMeta(task.task_type).lower}`
                            : task.status === 'pending'
                                ? `Accept ${typeMeta(task.task_type).lower} (move to In Progress)`
                                : 'Mark as completed'
                        : `Only the assignee can change ${typeMeta(task.task_type).lower} status — from their My ${typeMeta(task.task_type).plural} view`
                }
            >
                <Checkbox
                    className="task-card-checkbox"
                    checked={isCompleted}
                    disabled={!canToggleCompletion || completionLoading}
                    onClick={handleCheckboxClick}
                    onChange={() => {}}
                />
            </Tooltip>

            <div className="task-card-body">
                <button
                    type="button"
                    className="task-card-title task-card-open"
                    /* Durum yalniz RENKLE anlatilmaz: erisilebilir ad
                       basligi, durumu ve onceligi tasir. */
                    aria-label={
                        `${task.task_code ? task.task_code + ' ' : ''}${task.title}`
                        + ` — ${STATUS_LABELS[task.status] || task.status || 'unknown'}`
                        + (task.priority ? `, priority ${task.priority}` : '')
                    }
                    onClick={(e) => {
                        /*
                         * Kok kapsayici da ayni islemi tetikliyor; olay
                         * yukari cikarsa AYNI aksiyon iki kez calisirdi.
                         * Burada durdurma, gecersiz semantigi ortmek icin
                         * DEGIL, tekrari onlemek icindir.
                         */
                        e.stopPropagation()
                        handleBodyClick(e)
                    }}
                    onKeyDown={(e) => {
                        /*
                         * BOARD'da kart, dnd-kit sarmalayicisinin icinde
                         * yasar ve KeyboardSensor Enter/Space keydown'unu
                         * SURUKLEMEYI baslatmak icin yakalayip
                         * preventDefault yapar — bu, native butonun
                         * click'ini iptal edip ACMAYI yutuyordu (final
                         * tarayici QA'sinin buldugu gercek regresyon).
                         * Olay sarmalayiciya CIKARILMAZ: acma butonu
                         * acar; klavyeyle surukleme, sarmalayicinin
                         * KENDI odagindan (Tab ile) baslamaya devam eder.
                         */
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                        }
                    }}
                >
                    {task.task_code && (
                        <span className="task-card-code">{task.task_code}</span>
                    )}
                    <span className="task-card-title-text">{task.title}</span>
                </button>
                <div className="task-card-meta">
                    {task.customer_name || '—'} · {task.project_name || '—'}
                    {subProjectSegment}
                </div>

                <div className="task-card-badges">
                    <span
                        className={`task-card-priority task-card-priority-${task.priority}`}
                    >
                        {task.priority}
                    </span>
                    <span
                        className={`task-card-status task-card-status-${cardStatus}`}
                    >
                        {cardStatus === 'in_progress'
                            ? 'in progress'
                            : cardStatus}
                    </span>
                    <TaskDueBadge task={task} />
                </div>

                {dueDifferent && (
                    <div className="task-card-due-hint">
                        Due {dayjs(task.due_date).format('DD MMM')}
                    </div>
                )}

                {isGrouped ? (
                    <div className="task-card-roster">
                        <AssignmentRoster assignments={assignments} compact />
                    </div>
                ) : showAssignee && task.assignee_user_id ? (
                    <div className="task-card-assignee-hint">
                        Assignee: {userLabel(task.assignee_user_id, userMap)}
                    </div>
                ) : null}
                {!isGrouped && !showAssignee && task.assigner_user_id && (
                    <div className="task-card-assignee-hint">
                        Assigned by: {userLabel(task.assigner_user_id, userMap)}
                    </div>
                )}
            </div>

            {/* Hover actions — top-right, mirrors WorkLogCard exactly */}
            <div className="task-card-actions">
                {/* Ikon-only butonlar: tooltip ERISILEBILIR AD DEGILDIR
                    (§8) — her biri gorev basligini tasiyan acik bir
                    aria-label alir, boylece ekran okuyucu hangi karta ait
                    oldugunu bilir ve klavye kullanicisi ayirt edebilir. */}
                {isCompleted && onOpenLogTime && (
                    <Tooltip title="Log Time">
                        <button
                            type="button"
                            className="task-card-action-btn"
                            aria-label={`Log time — ${task.title}`}
                            onClick={handleLogTimeClick}
                        >
                            <FieldTimeOutlined />
                        </button>
                    </Tooltip>
                )}
                <Tooltip title={`Review ${typeMeta(task.task_type).singular}`}>
                    <button
                        type="button"
                        className="task-card-action-btn"
                        aria-label={`Review ${typeMeta(task.task_type).singular} — ${task.title}`}
                        onClick={handleReviewClick}
                    >
                        <EyeOutlined />
                    </button>
                </Tooltip>
                {canEditCore && (
                    <>
                        <Tooltip title="Edit">
                            <button
                                type="button"
                                className="task-card-action-btn"
                                aria-label={`Edit — ${task.title}`}
                                onClick={handleEditClick}
                            >
                                <EditOutlined />
                            </button>
                        </Tooltip>
                        <Tooltip title="Archive">
                            <button
                                type="button"
                                className="task-card-action-btn delete"
                                aria-label={`Archive — ${task.title}`}
                                onClick={handleDeleteClick}
                            >
                                <InboxOutlined />
                            </button>
                        </Tooltip>
                    </>
                )}
            </div>

        </div>
    )
}

export default TaskCard
