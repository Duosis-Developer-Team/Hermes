/**
 * =============================================================================
 * HERMES - Tasks pano modeli (Sprint 5B — KAYIP DAVRANISIN RESTORASYONU)
 * =============================================================================
 * Bu YENI OZELLIK DEGILDIR. Task copy/paste uretimde vardi ve
 * `4a5ee6d` ("remove Calendar view, default to Board") commit'inde
 * YAN HASAR olarak kayboldu: yapistirma hedefi takvim GUNU oldugundan,
 * takvim kalkinca pano akisi da dustu (o commit 20 satir sildi, 0 ekledi).
 *
 * Sozlesme `7d94a75` ("frozen clipboard snapshot + invalidate workLogs")
 * commit'inden — yani son SAGLAM surumden — birebir cikarildi:
 *   edc35e7 ilk uygulama → 768683f completed kopyalanamaz →
 *   0565e9a racy auto-clear kaldirildi → 7d94a75 dondurulmus snapshot.
 *
 * Time Entry pano modeliyle BIRLESTIRILMEDI: payload'lar farkli domain
 * (work-log vs task) ve ortaklastirmak asiri-genel bir utility uretirdi.
 * Yalnizca gercekten domain-bagimsiz olan `isEditableTarget` paylasilir.
 */
import dayjs from 'dayjs'

/** Kopyalanabilirlik kurali (768683f): completed kopyalanamaz.
 *  rejected de is akisi geregi kopyalanmaz (permissions.isTaskCopyable
 *  ile ayni kural — tek kaynak icin oradan re-export edilir). */
export { isTaskCopyable } from './permissions'

/**
 * DONDURULMUS pano anlik goruntusu (7d94a75 dersi).
 * Neden: tasks-query invalidation'i dizi icerigini degistirir; CANLI
 * nesne referansi tutulursa sonraki render'lar onu (status, tarihler)
 * mutate edip paste'i bozardi. Snapshot, create payload'ini yeniden
 * kurmak icin gereken HER SEYI tasir — fazlasini DEGIL.
 *
 * Tasinmayanlar (bilincli): status, assignee_note, completed_*, audit
 * ve creator alanlari — backend varsayilanlari uretir.
 */
export function makeTaskSnapshot(task) {
    if (!task) return null
    return Object.freeze({
        sourceTaskId: task.id,
        customer_id: task.customer_id,
        project_id: task.project_id,
        sub_project_id: task.sub_project_id || null,
        assignee_user_id: task.assignee_user_id,
        title: task.title || 'Task',
        description: task.description || '',
        // Termin ofsetini korumak icin ikisi de saklanir.
        original_scheduled_date: task.scheduled_date,
        original_due_date: task.due_date || null,
        priority: task.priority || 'medium',
    })
}

/**
 * Snapshot + hedef gun → create payload'i (7d94a75 ile BIREBIR).
 * - due_date: orijinal (due - scheduled) OFSETI hedef gune tasinir.
 * - description: backend min_length=1 ister; eski kayitlarda bos
 *   olabildigi icin basliga duser.
 * - status/assignee_note/completed_* BILEREK yok.
 */
export function buildTaskPastePayload(snapshot, targetDate) {
    if (!snapshot || !targetDate) return null

    let newDueDate = null
    if (snapshot.original_due_date && snapshot.original_scheduled_date) {
        const offsetDays = dayjs(snapshot.original_due_date)
            .diff(dayjs(snapshot.original_scheduled_date), 'day')
        newDueDate = dayjs(targetDate).add(offsetDays, 'day').format('YYYY-MM-DD')
    }

    const safeDescription =
        (snapshot.description && snapshot.description.trim())
        || snapshot.title
        || 'Task'

    return {
        customer_id: snapshot.customer_id,
        project_id: snapshot.project_id,
        sub_project_id: snapshot.sub_project_id || null,
        assignee_user_id: snapshot.assignee_user_id,
        title: snapshot.title,
        description: safeDescription,
        scheduled_date: targetDate,
        due_date: newDueDate,
        priority: snapshot.priority || 'medium',
    }
}

/** Paste ONCESI yetki dogrulamasi (§3): pano, kullanicinin atama
 *  yetkisini asamaz. Adaylar bossa (yetki yok) paste reddedilir. */
export function canPasteSnapshot(snapshot, { canAssignTasks, assignableUserIds }) {
    if (!snapshot) return false
    if (!canAssignTasks) return false
    const target = snapshot.assignee_user_id
    if (!target) return false
    return (assignableUserIds || []).includes(target)
}
