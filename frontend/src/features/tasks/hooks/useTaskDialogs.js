/**
 * =============================================================================
 * HERMES - Tasks diyalog/panel durumu (Sprint 5C)
 * =============================================================================
 * "Hangi yuzey acik?" sorusunun TEK yeri. Sayfa artik alti ayri boolean/
 * nesne state'i tek tek tasimaz; her yuzeyin acilisi ADLANDIRILMIS bir
 * eylemdir ve on kosullari (orn. create modali acilirken tur secimi ve
 * baslangic tarihi) burada kurulur.
 *
 * Not: bu SADECE gorunurluk durumudur — mutasyon, sorgu veya izin karari
 * TASIMAZ. Hepsi kendi hook'unda kalir.
 * =============================================================================
 */
import { useState } from 'react'

export function useTaskDialogs({ defaultCreateType }) {
    const [createOpen, setCreateOpen] = useState(false)
    const [editingTask, setEditingTask] = useState(null)
    const [initialDate, setInitialDate] = useState(null)
    // Kind chosen via the "+" menu for the create modal.
    const [createType, setCreateType] = useState('task')
    const [deletingTask, setDeletingTask] = useState(null)
    // Onay bekleyen checkbox durum degisikligi: { task, nextCompleted } | null
    const [pendingToggle, setPendingToggle] = useState(null)
    const [reviewTask, setReviewTask] = useState(null)
    // Board/list yaninda dock'lanan detay paneli.
    const [panelTask, setPanelTask] = useState(null)

    const closeCreate = () => {
        setCreateOpen(false)
        setEditingTask(null)
    }

    return {
        createOpen,
        editingTask,
        initialDate,
        createType,
        deletingTask,
        pendingToggle,
        reviewTask,
        panelTask,

        /** "+" menusunden yeni kayit — olusturulacak TUR menuden gelir,
         *  yoksa goruntulenen ture duser. */
        openCreate: (type) => {
            setEditingTask(null)
            setCreateType(type || defaultCreateType)
            setInitialDate(null)
            setCreateOpen(true)
        },
        /** Duzenleme ayni modali edit modunda acar. */
        openEdit: (task) => {
            setEditingTask(task)
            setCreateType(task.task_type || 'task')
            setInitialDate(task.scheduled_date)
            setCreateOpen(true)
        },
        closeCreate,
        openDelete: setDeletingTask,
        closeDelete: () => setDeletingTask(null),
        requestToggle: (task, nextCompleted) =>
            setPendingToggle({ task, nextCompleted }),
        clearToggle: () => setPendingToggle(null),
        openReview: setReviewTask,
        closeReview: () => setReviewTask(null),
        openPanel: setPanelTask,
        closePanel: () => setPanelTask(null),
    }
}

export default useTaskDialogs
