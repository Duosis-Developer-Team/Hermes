/**
 * =============================================================================
 * HERMES - Grup izni: efektif katki hesabi (Sprint 6B)
 * =============================================================================
 * Backend'deki `user_group_service.effective_member_contribution` KURALININ
 * BIREBIR portu. Saf fonksiyonlar — dogrudan test edilebilir.
 *
 * KURAL (backend'den okundu, tahmin DEGIL):
 *   effective = override  (override None DEGILSE)
 *             = group default  (override None ISE)
 *
 * Uc DURUM vardir ve ucu de birbirinden farklidir:
 *   override === true   → acikca ACIK   (grup default'u ne olursa olsun)
 *   override === false  → acikca KAPALI (grup ON olsa bile — "Group ON +
 *                         direct OFF" durumu)
 *   override == null    → DEVRALINIR    (grup default'u ne diyorsa)
 *
 * Access ve Assign BAGIMSIZ hesaplanir; biri digerini acmaz/kapatmaz.
 * Task ve Issue kapsamlari da bagimsizdir (ayri alan cifti).
 *
 * FAIL-CLOSED: grup izin satiri yoksa default false.
 *
 * NEDEN BU DOSYA VAR (gercek kusur): overrides ucu YALNIZCA override
 * SATIRI OLAN uyeler icin kayit doner. Devralan uyeler icin hic satir
 * gelmez. Panel bunu `!!o?.effective_access_in_group` ile okudugu icin
 * DEVRALINAN ACIK izin KAPALI gorunuyordu. Efektif deger artik grup
 * default'u ile birlikte burada hesaplanir.
 * =============================================================================
 */

/** Kapsam → override ve default alan adlari. */
const FIELDS = {
    task: {
        accessDefault: 'can_access_tasks_default',
        assignDefault: 'can_assign_tasks_default',
        accessOverride: 'can_access_tasks_override',
        assignOverride: 'can_assign_tasks_override',
    },
    issue: {
        accessDefault: 'can_access_issues_default',
        assignDefault: 'can_assign_issues_default',
        accessOverride: 'can_access_issues_override',
        assignOverride: 'can_assign_issues_override',
    },
}

const fieldsFor = (scope) => FIELDS[scope === 'issue' ? 'issue' : 'task']

/** override degeri "belirtilmemis" mi? (null VE undefined) */
const unset = (value) => value === null || value === undefined

/**
 * Tek bir uyelik icin efektif (access, assign) — backend ile ayni sonuc.
 * @returns {{access: boolean, assign: boolean}}
 */
export function effectiveMemberContribution({ override, permission, scope = 'task' } = {}) {
    const f = fieldsFor(scope)
    const accessDefault = permission ? !!permission[f.accessDefault] : false
    const assignDefault = permission ? !!permission[f.assignDefault] : false
    const ovAccess = override ? override[f.accessOverride] : null
    const ovAssign = override ? override[f.assignOverride] : null
    return {
        access: unset(ovAccess) ? accessDefault : !!ovAccess,
        assign: unset(ovAssign) ? assignDefault : !!ovAssign,
    }
}

/**
 * Iznin KAYNAGI — kullaniciya "neden acik/kapali" diyebilmek icin.
 * Renk tek basina yeterli degildir (§8): kaynak METINLE de anlatilir.
 * @returns {'explicit'|'inherited'}
 */
export function permissionSource({ override, scope = 'task', kind = 'access' } = {}) {
    const f = fieldsFor(scope)
    const value = override
        ? override[kind === 'assign' ? f.assignOverride : f.accessOverride]
        : null
    return unset(value) ? 'inherited' : 'explicit'
}

/**
 * Uye satirlarini override listesiyle birlestirir.
 *
 * Override listesi SEYREKTIR: yalnizca override satiri olan uyeler gelir.
 * Eksik uyeler grup default'unu DEVRALIR — bu fonksiyonun tek sebebi bu.
 */
export function mergeMemberPermissions({ members, overrides, permission }) {
    const byUserId = new Map(
        (Array.isArray(overrides) ? overrides : []).map((o) => [o.user_id, o])
    )
    return (Array.isArray(members) ? members : []).map((member) => {
        const override = byUserId.get(member.user_id) || null
        const task = effectiveMemberContribution({ override, permission, scope: 'task' })
        const issue = effectiveMemberContribution({ override, permission, scope: 'issue' })
        return {
            ...member,
            effective_access_in_group: task.access,
            effective_assign_in_group: task.assign,
            effective_access_issues_in_group: issue.access,
            effective_assign_issues_in_group: issue.assign,
            // Kaynak: acikca mi ayarlandi, yoksa gruptan mi devralindi.
            access_source: permissionSource({ override, scope: 'task', kind: 'access' }),
            assign_source: permissionSource({ override, scope: 'task', kind: 'assign' }),
            has_override: !!override,
        }
    })
}

/**
 * "Assign, Access'i gerektirir" degismezi — backend bunu ZORLAR, arayuz
 * de ayni sonucu gostersin diye burada aynen uygulanir. Kapsamlar
 * BAGIMSIZ islenir: task tarafini kapatmak issue tarafini etkilemez.
 */
export function applyAssignRequiresAccess(defaults) {
    const next = { ...defaults }
    if (!next.can_access_tasks_default) next.can_assign_tasks_default = false
    if (!next.can_access_issues_default) next.can_assign_issues_default = false
    return next
}

/**
 * Bulk sonucunu SINIFLANDIRIR: tam basari / kismi basari / tam hata.
 * Kismi basari ASLA tam basari gibi raporlanmaz — sessiz kismi hata,
 * yoneticiye uygulanmayan bir izni uygulanmis gosterirdi.
 */
export function classifyBulkResult(results) {
    const list = Array.isArray(results) ? results : []
    const failed = list.filter((r) => r && r.ok === false)
    if (list.length === 0) return { kind: 'empty', total: 0, failed: [] }
    if (failed.length === 0) return { kind: 'success', total: list.length, failed: [] }
    if (failed.length === list.length) {
        return { kind: 'error', total: list.length, failed }
    }
    return { kind: 'partial', total: list.length, failed }
}
