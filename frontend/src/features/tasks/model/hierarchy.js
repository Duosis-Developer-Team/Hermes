/**
 * =============================================================================
 * HERMES - Explorer hiyerarsisi: Customer → Project → Sub Project
 * =============================================================================
 * SAF VERI — React/DOM/API bagimliligi YOK.
 *
 * Agac, ZATEN filtrelenmis logical work item listesinden TURETILIR
 * (model/grouping). Ikinci bir hiyerarsi kaynagi kurulmaz: musteri/proje/
 * alt-proje adlari task satirinin kendisinden gelir (backend serialize
 * ederken customer_name/project_name/sub_project_name basar), yani PM
 * Configurations'taki kanonik iliskiler neyse agac odur.
 *
 * SAYIMLAR (§13): her klasor YALNIZ kullanicinin gorebildigi logical
 * work item'lari sayar — girdi listesi zaten RBAC ile filtrelenmistir ve
 * bu dosya kendi basina hicbir kayit EKLEMEZ. Gizli bir kayit sayida
 * gorunemez cunku hic gelmez.
 *
 * BOS/EKSIK ILISKI (§6.5): customer/project/sub project atanmamis is
 * KAYBOLMAZ — sanal klasore duser. Ad cozulemiyorsa (silinmis/pasif
 * referans veya yetki) kimlik EKRANA BASILMAZ, notr etiket kullanilir.
 * =============================================================================
 */

export const NO_CUSTOMER = '__no_customer__'
export const NO_PROJECT = '__no_project__'
export const NO_SUB_PROJECT = '__no_sub_project__'

export const VIRTUAL_LABEL = {
    [NO_CUSTOMER]: 'No Customer',
    [NO_PROJECT]: 'No Project',
    [NO_SUB_PROJECT]: 'No Sub Project',
}

/** Silinmis/pasif referans ya da yetki nedeniyle ad yoksa: kimlik
 *  sizdirmayan notr etiket (id EKRANA BASILMAZ). */
const UNNAMED = 'Unnamed'

const labelFor = (id, name, virtualKey) => {
    if (!id) return VIRTUAL_LABEL[virtualKey]
    return name || UNNAMED
}

/**
 * Logical work item listesinden agac kurar.
 *
 * Donen yapi:
 *   [{ id, label, isVirtual, count, children: [
 *       { id, label, isVirtual, count, children: [
 *           { id, label, isVirtual, count, items: [...] } ] } ] }]
 *
 * `count` HER seviyede o dalin altindaki LOGICAL work item sayisidir
 * (assignment sayisi degil — §6.3).
 */
export function buildHierarchy(items) {
    const customers = new Map()

    for (const item of items || []) {
        const cId = item.customerId || NO_CUSTOMER
        const pId = item.projectId || NO_PROJECT
        const sId = item.subProjectId || NO_SUB_PROJECT

        if (!customers.has(cId)) {
            customers.set(cId, {
                id: cId,
                label: labelFor(item.customerId, item.customerName, NO_CUSTOMER),
                isVirtual: !item.customerId,
                projects: new Map(),
            })
        }
        const customer = customers.get(cId)

        if (!customer.projects.has(pId)) {
            customer.projects.set(pId, {
                id: pId,
                label: labelFor(item.projectId, item.projectName, NO_PROJECT),
                isVirtual: !item.projectId,
                subProjects: new Map(),
            })
        }
        const project = customer.projects.get(pId)

        if (!project.subProjects.has(sId)) {
            project.subProjects.set(sId, {
                id: sId,
                label: labelFor(item.subProjectId, item.subProjectName, NO_SUB_PROJECT),
                isVirtual: !item.subProjectId,
                items: [],
            })
        }
        project.subProjects.get(sId).items.push(item)
    }

    // Siralama: gercek klasorler ada gore; sanal klasorler HER ZAMAN
    // sonda (kaybolmazlar ama listeyi de bastan isgal etmezler).
    const byLabel = (a, b) => {
        if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1
        return a.label.localeCompare(b.label, 'en')
    }

    return [...customers.values()]
        .map((c) => {
            const projects = [...c.projects.values()]
                .map((p) => {
                    const subProjects = [...p.subProjects.values()]
                        .map((s) => ({
                            id: s.id,
                            label: s.label,
                            isVirtual: s.isVirtual,
                            items: s.items,
                            count: s.items.length,
                        }))
                        .sort(byLabel)
                    return {
                        id: p.id,
                        label: p.label,
                        isVirtual: p.isVirtual,
                        children: subProjects,
                        count: subProjects.reduce((n, s) => n + s.count, 0),
                    }
                })
                .sort(byLabel)
            return {
                id: c.id,
                label: c.label,
                isVirtual: c.isVirtual,
                children: projects,
                count: projects.reduce((n, p) => n + p.count, 0),
            }
        })
        .sort(byLabel)
}

/** Bir dugumun (customer / project / sub project) altindaki TUM logical
 *  work item'lar — secili klasorun calisma alanini besler. */
export function itemsForNode(tree, selection) {
    if (!selection?.customerId) {
        return (tree || []).flatMap((c) =>
            c.children.flatMap((p) => p.children.flatMap((s) => s.items))
        )
    }
    const customer = (tree || []).find((c) => c.id === selection.customerId)
    if (!customer) return []
    if (!selection.projectId) {
        return customer.children.flatMap((p) => p.children.flatMap((s) => s.items))
    }
    const project = customer.children.find((p) => p.id === selection.projectId)
    if (!project) return []
    if (!selection.subProjectId) {
        return project.children.flatMap((s) => s.items)
    }
    const sub = project.children.find((s) => s.id === selection.subProjectId)
    return sub ? sub.items : []
}

/** Secili klasorun okunabilir yolu (breadcrumb). */
export function breadcrumbFor(tree, selection) {
    const out = []
    if (!selection?.customerId) return out
    const customer = (tree || []).find((c) => c.id === selection.customerId)
    if (!customer) return out
    out.push({ level: 'customer', id: customer.id, label: customer.label })
    if (!selection.projectId) return out
    const project = customer.children.find((p) => p.id === selection.projectId)
    if (!project) return out
    out.push({ level: 'project', id: project.id, label: project.label })
    if (!selection.subProjectId) return out
    const sub = project.children.find((s) => s.id === selection.subProjectId)
    if (sub) out.push({ level: 'subProject', id: sub.id, label: sub.label })
    return out
}

/**
 * Secim hala gecerli mi? Filtre degisince veya kayit erisilemez olunca
 * bos sayfa OLUSMAMALI (§14) — gecersiz secim guvenli sekilde bir ust
 * seviyeye, en kotu ihtimalle koke duser.
 */
export function reconcileSelection(tree, selection) {
    if (!selection?.customerId) return {}
    const customer = (tree || []).find((c) => c.id === selection.customerId)
    if (!customer) return {}
    if (!selection.projectId) return { customerId: customer.id }
    const project = customer.children.find((p) => p.id === selection.projectId)
    if (!project) return { customerId: customer.id }
    if (!selection.subProjectId) {
        return { customerId: customer.id, projectId: project.id }
    }
    const sub = project.children.find((s) => s.id === selection.subProjectId)
    return sub
        ? { customerId: customer.id, projectId: project.id, subProjectId: sub.id }
        : { customerId: customer.id, projectId: project.id }
}

/**
 * Arama: eslesen logical item'in ATA YOLU gorunur kalmali (§14) — bir
 * klasor, altinda eslesme varsa bos gibi gizlenmez. Eslesme, ada gore
 * degil ITEM'a gore hesaplanir; klasorler turetilmis oldugu icin
 * eslesen item'i olan klasor otomatik hayatta kalir.
 */
export const matchesSearch = (item, term) => {
    const q = (term || '').trim().toLocaleLowerCase('en')
    if (!q) return true
    const haystack = [
        item.title,
        item.taskCode,
        item.customerName,
        item.projectName,
        item.subProjectName,
    ]
    return haystack.some((v) => v && String(v).toLocaleLowerCase('en').includes(q))
}
