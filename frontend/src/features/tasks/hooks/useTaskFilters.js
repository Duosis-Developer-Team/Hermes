/**
 * =============================================================================
 * HERMES - Tasks capraz filtreleri (Sprint 5C)
 * =============================================================================
 * Status / Priority / Customer / Project / Sub Project. Hiyerarsi kurali
 * BURADA yasar: musteri degisince proje ve alt proje, proje degisince
 * alt proje TEMIZLENIR — aksi halde artik gecerli olmayan bir id
 * sorguya sizabilir.
 * =============================================================================
 */
import { useState } from 'react'

const EMPTY = {
    status: null, priority: null, customer: null, project: null,
    subProject: null, assignee: null,
}

export function useTaskFilters() {
    const [filters, setFilters] = useState(EMPTY)

    return {
        filters,
        setStatus: (status) => setFilters((f) => ({ ...f, status })),
        setPriority: (priority) => setFilters((f) => ({ ...f, priority })),
        // Musteri degisti → alt kirilimlar gecersiz.
        setCustomer: (customer) =>
            setFilters((f) => ({ ...f, customer, project: null, subProject: null })),
        setProject: (project) =>
            setFilters((f) => ({ ...f, project, subProject: null })),
        setSubProject: (subProject) => setFilters((f) => ({ ...f, subProject })),
        /*
         * KISI FILTRESI — ISTEMCIDE uygulanir, sunucuya GONDERILMEZ.
         *
         * Sebep RBAC: liste ucu, admin OLMAYAN cagirana ait
         * `assignee_user_id` parametresini SESSIZCE kendisine zorlar
         * (task_service.list_tasks_for_user). "Assigned by Me + su kisiyi
         * goster" istegi sunucuya gonderilseydi, atayan kisi kendi
         * gorevlerini gorurdu — yanlis sonuc. Sonuc kumesi zaten RBAC
         * filtreli ve SAYFALAMASIZ geldigi icin kisiye gore daraltmak
         * istemcide DOGRU ve sizinti uretmez: gelmemis bir kayit
         * filtrelenemez.
         */
        setAssignee: (assignee) => setFilters((f) => ({ ...f, assignee })),
        clearFilters: () => setFilters(EMPTY),
    }
}

export default useTaskFilters
