/**
 * =============================================================================
 * Sprint 6B — RBAC CHARACTERIZATION: grup izni / override / cascade
 * =============================================================================
 * Bu testler REFACTOR'DAN ONCE yazildi ve backend'in GERCEK kuralini
 * kilitler (`user_group_service.effective_member_contribution` okunarak
 * cikarildi, tahmin edilmedi):
 *
 *     effective = override            (override belirtilmisse)
 *               = grup default        (override belirtilmemisse)
 *
 * Access ve Assign BAGIMSIZDIR; Task ve Issue kapsamlari BAGIMSIZDIR.
 *
 * ORTAYA CIKARDIGI GERCEK KUSUR (ayri testle isaretli): overrides ucu
 * yalnizca override SATIRI OLAN uyeler icin kayit doner; devralan uyeler
 * icin hic satir gelmez. Panel `!!o?.effective_...` okudugu icin
 * DEVRALINAN ACIK izin KAPALI gorunuyordu.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'

import {
    applyAssignRequiresAccess, classifyBulkResult,
    effectiveMemberContribution, mergeMemberPermissions, permissionSource,
} from '../../features/admin/permissions/model/effectivePermission'

const GROUP_ON = {
    can_access_tasks_default: true,
    can_assign_tasks_default: true,
    can_access_issues_default: true,
    can_assign_issues_default: true,
}
const GROUP_OFF = {
    can_access_tasks_default: false,
    can_assign_tasks_default: false,
    can_access_issues_default: false,
    can_assign_issues_default: false,
}

describe('efektif izin: override > grup default', () => {
    it('override YOKKEN grup default DEVRALINIR', () => {
        expect(effectiveMemberContribution({ override: null, permission: GROUP_ON }))
            .toEqual({ access: true, assign: true })
        expect(effectiveMemberContribution({ override: null, permission: GROUP_OFF }))
            .toEqual({ access: false, assign: false })
    })

    it('GROUP ON + DIRECT OFF → efektif KAPALI (celiskili durumun kurali)', () => {
        const override = {
            can_access_tasks_override: false,
            can_assign_tasks_override: false,
        }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON }))
            .toEqual({ access: false, assign: false })
    })

    it('GROUP OFF + DIRECT ON → efektif ACIK', () => {
        const override = {
            can_access_tasks_override: true,
            can_assign_tasks_override: true,
        }
        expect(effectiveMemberContribution({ override, permission: GROUP_OFF }))
            .toEqual({ access: true, assign: true })
    })

    it('override KALDIRILINCA (null) devralinan grup sonucuna DONULUR', () => {
        const withOverride = { can_access_tasks_override: false }
        expect(
            effectiveMemberContribution({ override: withOverride, permission: GROUP_ON })
                .access
        ).toBe(false)
        // Ayni uye, override kaldirildi:
        expect(
            effectiveMemberContribution({ override: null, permission: GROUP_ON }).access
        ).toBe(true)
    })

    it('undefined override de "belirtilmemis" sayilir (null ile ayni)', () => {
        const override = { can_access_tasks_override: undefined }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON }).access)
            .toBe(true)
    })

    it('FAIL-CLOSED: grup izin satiri yoksa her sey KAPALI', () => {
        expect(effectiveMemberContribution({ override: null, permission: null }))
            .toEqual({ access: false, assign: false })
        expect(effectiveMemberContribution({}))
            .toEqual({ access: false, assign: false })
    })
})

describe('Access ve Assign BAGIMSIZ', () => {
    it('access override’i assign’i ETKILEMEZ', () => {
        const override = { can_access_tasks_override: false }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON }))
            .toEqual({ access: false, assign: true })
    })

    it('assign override’i access’i ETKILEMEZ', () => {
        const override = { can_assign_tasks_override: false }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON }))
            .toEqual({ access: true, assign: false })
    })

    it('assign ACIK, access KAPALI kombinasyonu KENDILIGINDEN duzeltilmez', () => {
        // Goruntuleme hesabi backend'in dondurdugunu yansitir; "assign
        // access gerektirir" degismezi DEFAULT yazarken uygulanir (asagida).
        const override = {
            can_access_tasks_override: false,
            can_assign_tasks_override: true,
        }
        expect(effectiveMemberContribution({ override, permission: GROUP_OFF }))
            .toEqual({ access: false, assign: true })
    })
})

describe('Task ve Issue kapsamlari BAGIMSIZ', () => {
    it('task override’i issue kapsamini etkilemez', () => {
        const override = {
            can_access_tasks_override: false,
            can_assign_tasks_override: false,
        }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON, scope: 'issue' }))
            .toEqual({ access: true, assign: true })
    })

    it('issue override’i task kapsamini etkilemez', () => {
        const override = {
            can_access_issues_override: false,
            can_assign_issues_override: false,
        }
        expect(effectiveMemberContribution({ override, permission: GROUP_ON, scope: 'task' }))
            .toEqual({ access: true, assign: true })
    })

    it('bilinmeyen kapsam task olarak islenir (guvenli varsayilan)', () => {
        expect(effectiveMemberContribution({ override: null, permission: GROUP_ON, scope: 'zzz' }))
            .toEqual({ access: true, assign: true })
    })
})

describe('iznin KAYNAGI kullaniciya soylenebilir', () => {
    it('override yoksa "inherited"', () => {
        expect(permissionSource({ override: null })).toBe('inherited')
        expect(permissionSource({ override: {} })).toBe('inherited')
    })

    it('override ACIKCA true/false ise "explicit"', () => {
        expect(permissionSource({ override: { can_access_tasks_override: true } }))
            .toBe('explicit')
        // ACIKCA false da bir karardir — devralma DEGILDIR.
        expect(permissionSource({ override: { can_access_tasks_override: false } }))
            .toBe('explicit')
    })

    it('kaynak access/assign ve kapsam bazinda AYRI', () => {
        const override = { can_access_tasks_override: false }
        expect(permissionSource({ override, kind: 'access' })).toBe('explicit')
        expect(permissionSource({ override, kind: 'assign' })).toBe('inherited')
        expect(permissionSource({ override, scope: 'issue', kind: 'access' }))
            .toBe('inherited')
    })
})

describe('KUSUR: seyrek override listesi devralinan izni KAPALI gosteriyordu', () => {
    const MEMBERS = [
        { user_id: 'u1' },   // override YOK → devralir
        { user_id: 'u2' },   // acikca KAPALI
    ]
    const OVERRIDES = [
        { user_id: 'u2', can_access_tasks_override: false, can_assign_tasks_override: false },
    ]

    it('override satiri OLMAYAN uye grup default’unu DEVRALIR', () => {
        const rows = mergeMemberPermissions({
            members: MEMBERS, overrides: OVERRIDES, permission: GROUP_ON,
        })
        const u1 = rows.find((r) => r.user_id === 'u1')
        // Kusurlu davranista burasi false idi: satir gelmedigi icin
        // `!!undefined?.effective_access_in_group` → false.
        expect(u1.effective_access_in_group).toBe(true)
        expect(u1.effective_assign_in_group).toBe(true)
        expect(u1.access_source).toBe('inherited')
        expect(u1.has_override).toBe(false)
    })

    it('acikca KAPALI uye KAPALI kalir ve kaynagi "explicit"', () => {
        const rows = mergeMemberPermissions({
            members: MEMBERS, overrides: OVERRIDES, permission: GROUP_ON,
        })
        const u2 = rows.find((r) => r.user_id === 'u2')
        expect(u2.effective_access_in_group).toBe(false)
        expect(u2.access_source).toBe('explicit')
        expect(u2.has_override).toBe(true)
    })

    it('grup default KAPALIYKEN devralan uye de KAPALI', () => {
        const rows = mergeMemberPermissions({
            members: MEMBERS, overrides: [], permission: GROUP_OFF,
        })
        expect(rows.every((r) => r.effective_access_in_group === false)).toBe(true)
    })

    it('bos/eksik girdiler cokmez', () => {
        expect(mergeMemberPermissions({})).toEqual([])
        expect(mergeMemberPermissions({ members: null, overrides: null })).toEqual([])
    })

    it('uye alanlari korunur (kimlik/ad kaybolmaz)', () => {
        const rows = mergeMemberPermissions({
            members: [{ user_id: 'u1', full_name: 'Ada' }],
            overrides: [], permission: GROUP_ON,
        })
        expect(rows[0].full_name).toBe('Ada')
    })
})

describe('degismez: assign, access gerektirir', () => {
    it('task access KAPATILINCA task assign da kapanir', () => {
        expect(applyAssignRequiresAccess({
            can_access_tasks_default: false, can_assign_tasks_default: true,
            can_access_issues_default: true, can_assign_issues_default: true,
        })).toEqual({
            can_access_tasks_default: false, can_assign_tasks_default: false,
            can_access_issues_default: true, can_assign_issues_default: true,
        })
    })

    it('kapsamlar BAGIMSIZ uygulanir', () => {
        expect(applyAssignRequiresAccess({
            can_access_tasks_default: true, can_assign_tasks_default: true,
            can_access_issues_default: false, can_assign_issues_default: true,
        })).toMatchObject({
            can_assign_tasks_default: true, can_assign_issues_default: false,
        })
    })

    it('access ACIKKEN assign’e dokunulmaz', () => {
        expect(applyAssignRequiresAccess({ ...GROUP_ON }).can_assign_tasks_default)
            .toBe(true)
    })
})

describe('bulk sonucu: tam basari / KISMI / tam hata AYRI', () => {
    it('hepsi basarili → success', () => {
        expect(classifyBulkResult([{ ok: true }, { ok: true }]))
            .toMatchObject({ kind: 'success', total: 2, failed: [] })
    })

    it('bir kismi basarisiz → PARTIAL (asla success degil)', () => {
        const r = classifyBulkResult([
            { ok: true }, { ok: false, user_id: 'u2' }, { ok: true },
        ])
        expect(r.kind).toBe('partial')
        expect(r.total).toBe(3)
        expect(r.failed.map((f) => f.user_id)).toEqual(['u2'])
    })

    it('hepsi basarisiz → error', () => {
        expect(classifyBulkResult([{ ok: false }, { ok: false }]).kind).toBe('error')
    })

    it('bos giris → empty (yanlis "basarili" toast’i uretmez)', () => {
        expect(classifyBulkResult([]).kind).toBe('empty')
        expect(classifyBulkResult(null).kind).toBe('empty')
    })

    it('basarisiz uyeler cagirana BILDIRILIR (sessiz yutma yok)', () => {
        const r = classifyBulkResult([{ ok: false, user_id: 'a' }, { ok: true }])
        expect(r.failed).toHaveLength(1)
        expect(r.failed[0].user_id).toBe('a')
    })
})
