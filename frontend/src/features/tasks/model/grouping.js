/**
 * =============================================================================
 * HERMES - Logical work item gruplama + aggregate status (TEK KAYNAK)
 * =============================================================================
 * SAF VERI — React, DOM veya API bagimliligi YOK. Board, List ve Explorer
 * AYNI bu dosyayi okur; hicbiri kendi gruplama veya status algoritmasini
 * yazmaz (spesifikasyon §5: "tek merkezi domain helper").
 *
 * -----------------------------------------------------------------------
 * KANONIK GRUP KIMLIGI
 * -----------------------------------------------------------------------
 * Backend'de ayni Create-Task eylemi her assignee icin AYRI bir `tasks`
 * satiri yaratir, ama hepsine TEK bir `assignment_batch_id` (uuid4)
 * basar — hem bireysel coklu assignee (create_tasks_bulk) hem grup
 * fan-out'u (create_tasks_for_group, Public API POST /v1/task-groups)
 * ayni yoldan gecer ve tek transaction icinde yazilir.
 *
 * Dolayisiyla gruplama TAHMIN DEGILDIR: kalici ve kesin bir kimlik
 * uzerinden yapilir. Baslik/aciklama benzerligi, ayni dakikada
 * olusturulmus olmak veya customer+project+assignee kombinasyonu
 * gruplama olcutu OLARAK KULLANILMAZ (spesifikasyon §3.3 yasagi).
 *
 * `assignment_batch_id` NULL olan kayit (tekil create, tarihsel veri)
 * kendi basina bir logical work item'dir — singleton. Hicbir kayit
 * kaybolmaz, hicbir tarihsel satir tahminle birlestirilmez.
 *
 * -----------------------------------------------------------------------
 * NEDEN ISTEMCI TARAFINDA TURETILIYOR
 * -----------------------------------------------------------------------
 * `GET /api/v1/core/tasks` SAYFALAMA YAPMAZ: RBAC ve tarih araligiyla
 * filtrelenmis TAM sonuc kumesini dondurur (skip/limit/page yok).
 * Bu yuzden "logical task iki sayfaya bolunur / total count yanlis
 * olur / badge eksik kalir" hata modlari bu repoda olusamaz ve ikinci
 * bir grouped read API yazmak, mevcut sozlesmenin yanina PARALEL bir
 * gruplama sistemi koymak olurdu (§3.3 bunu yasakliyor).
 *
 * DIKKAT — bu karar tek bir varsayima dayanir: liste ucu sayfalamasiz
 * ve RBAC-filtreli TAM kume dondurur. `/core/tasks` ileride sayfalamaya
 * gecerse bu dosyadaki turetme GECERSIZLESIR ve gruplamanin sorgu
 * katmanina (pagination'dan ONCE) inmesi gerekir.
 * =============================================================================
 */

/** Bir gorunur assignment'in status'u — bilinmeyen deger 'pending' sayilir
 *  (kart bir sutunda MUTLAKA yer almali; sessizce kaybolmamali). */
const KNOWN_STATUSES = new Set([
    'pending', 'in_progress', 'completed', 'cancelled', 'rejected',
])

export const normalizeStatus = (status) =>
    KNOWN_STATUSES.has(status) ? status : 'pending'

/**
 * Bir task satirinin ait oldugu logical work item'in anahtari.
 * Batch kimligi varsa O; yoksa satirin kendi id'si (singleton).
 * Onek, bir batch UUID'siyle bir task UUID'sinin cakismasini
 * yapisal olarak imkansiz kilar.
 */
export const logicalKeyOf = (task) =>
    task?.assignment_batch_id
        ? `batch:${task.assignment_batch_id}`
        : `task:${task?.id}`

/**
 * AGGREGATE STATUS (spesifikasyon §5)
 * ---------------------------------------------------------------------
 * Tum gorunur assignment'lar AYNI status'ta ise → o status.
 * Bunun disindaki HER karisik durum → 'in_progress'.
 *
 * §5'te dort kural sayiliyor (hepsi Pending / hepsi Completed / hepsi
 * Rejected / hepsi In Progress). Dordu de "hepsi ayni → o status"
 * ozel halidir; kural bu sekilde yazildiginda katalogdaki besinci
 * durum ('cancelled') de sessizce yanlis sutuna dusmez.
 *
 * Bos liste (hicbir assignment gorunmuyor) → 'pending': kart bir
 * sutunda yer alir, ekrandan kaybolmaz.
 */
export const aggregateStatus = (assignments) => {
    const statuses = (assignments || []).map((a) => normalizeStatus(a?.status))
    if (statuses.length === 0) return 'pending'
    const first = statuses[0]
    return statuses.every((s) => s === first) ? first : 'in_progress'
}

/**
 * Assignment siralamasi DETERMINISTIK olmali — badge'ler her render'da
 * yer degistirmemeli (§8). Ad varsa ada gore, yoksa kararli bir kimlik
 * anahtarina gore.
 */
const byStableOrder = (a, b) => {
    const an = (a.assigneeName || '').toLocaleLowerCase('en')
    const bn = (b.assigneeName || '').toLocaleLowerCase('en')
    if (an && bn && an !== bn) return an < bn ? -1 : 1
    if (an && !bn) return -1
    if (!an && bn) return 1
    return String(a.id) < String(b.id) ? -1 : 1
}

/**
 * Task satirlarini logical work item'lara indirger.
 *
 * @param {Array} tasks   RBAC-filtreli task satirlari (API sirasinda)
 * @param {Function} [resolveName]  assignee_user_id → gorunur ad. Ad
 *        cozulemiyorsa (yetki yok / dizin yuklenmedi) null doner ve
 *        badge ada DEGIL, guvenli bir yer tutucuya duser — isim
 *        sizintisi olmaz (§13).
 * @returns {Array} logical work item listesi; girdi sirasi KORUNUR
 *          (ilk gorulen satir grubun yerini belirler).
 */
export function groupIntoLogicalItems(tasks, resolveName) {
    const byKey = new Map()

    for (const task of tasks || []) {
        if (!task) continue
        const key = logicalKeyOf(task)
        const assignment = {
            id: task.id,
            assigneeUserId: task.assignee_user_id ?? null,
            assigneeName: resolveName
                ? (resolveName(task.assignee_user_id) || null)
                : null,
            status: normalizeStatus(task.status),
            completedAt: task.completed_at ?? null,
            completedByUserId: task.completed_by_user_id ?? null,
            updatedAt: task.updated_at ?? null,
            // Ham satir: mevcut permission seciciler ve mutation'lar
            // task nesnesinin KENDISINI bekler; sarmalayip kopyalamak
            // ikinci bir gercek kaynak yaratirdi.
            task,
        }

        const existing = byKey.get(key)
        if (existing) {
            existing.assignments.push(assignment)
            continue
        }

        byKey.set(key, {
            key,
            // Ortak alanlar batch icindeki TUM satirlarda kopyalidir;
            // ilk satir temsilcidir (backend tek transaction'da yazar).
            batchId: task.assignment_batch_id ?? null,
            isGrouped: Boolean(task.assignment_batch_id),
            representative: task,
            kind: task.task_type || 'task',
            title: task.title,
            description: task.description ?? null,
            taskCode: task.task_code ?? null,
            customerId: task.customer_id ?? null,
            customerName: task.customer_name ?? null,
            projectId: task.project_id ?? null,
            projectName: task.project_name ?? null,
            subProjectId: task.sub_project_id ?? null,
            subProjectName: task.sub_project_name ?? null,
            priority: task.priority || 'medium',
            scheduledDate: task.scheduled_date ?? null,
            dueDate: task.due_date ?? null,
            assignerUserId: task.assigner_user_id ?? null,
            assignments: [assignment],
        })
    }

    return [...byKey.values()].map((item) => {
        const assignments = [...item.assignments].sort(byStableOrder)
        return {
            ...item,
            assignments,
            assignmentCount: assignments.length,
            aggregateStatus: aggregateStatus(assignments),
        }
    })
}

/**
 * Logical work item sayisi — assignment sayisi DEGIL (§9/§10: count'lar
 * kart sayisini gosterir). Ayri bir metrik gerekiyorsa acikca
 * `assignmentCount` toplanir.
 */
export const countLogicalItems = (items) => (items || []).length

export const countAssignments = (items) =>
    (items || []).reduce((n, i) => n + (i.assignmentCount || 0), 0)

/**
 * Bir logical item'in verilen status filtresine uyup uymadigi.
 * Sozlesme (§10): GORUNUR assignment'lardan EN AZ BIRI secili
 * statusteyse eslesir — aggregate status'e gore degil. Boylece
 * "Completed" filtresi, uc kisinin bitirdigi ama ikisinin devam ettigi
 * isi de bulur ve ayni is filtre sonucunda TEK satir uretir.
 */
export const matchesAnyAssignmentStatus = (item, statuses) => {
    if (!statuses || statuses.length === 0) return true
    const wanted = new Set(statuses)
    return (item?.assignments || []).some((a) => wanted.has(a.status))
}

/** Aggregate status uzerinden filtreleme — ayri ve ACIKCA adlandirilmis
 *  sozlesme (§10), yukaridakiyle karistirilmamali. */
export const matchesAggregateStatus = (item, statuses) => {
    if (!statuses || statuses.length === 0) return true
    return statuses.includes(item?.aggregateStatus)
}
