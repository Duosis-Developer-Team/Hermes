/**
 * =============================================================================
 * RBAC cutover — PM Configurations yapisal kilitleri (KAYNAK TARAMASI)
 * =============================================================================
 * Task Access yonetimi ROLLERE tasindi. Bu kilitler, legacy yuzeyin geri
 * donmesini engeller:
 *   - TaskManagementPage'de Task Access bolumu/importu YOK,
 *   - TaskAccessByGroupTab dosyasi SILINDI,
 *   - services/api legacy access-mutation metodlarini tasimiyor,
 *   - kalan 4 bolum (2 hiyerarsi + sub projects + mail) yerinde.
 * frontendDebt.test.js ile ayni yaklasim: davranis degil YAPISAL kural.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
const read = (f) => readFileSync(join(SRC, f), 'utf8')

describe('PM Configurations sadelestirildi', () => {
    it('TaskAccessByGroupTab dosyasi geri gelmedi', () => {
        expect(
            existsSync(join(SRC, 'pages/admin/TaskAccessByGroupTab.jsx'))
        ).toBe(false)
    })

    it('sayfada Task Access bolumu/importu yok; 4 bolum duruyor', () => {
        const page = read('pages/admin/TaskManagementPage.jsx')
        expect(page).not.toContain('TaskAccessByGroupTab')
        expect(page).not.toContain('title="Task Access"')
        // i18n sonrasi baslik metni sozlukten gelir; kilit ANAHTAR
        // uzerindedir. Kilitlenen sey DORT BOLUMUN varligiydi ve o
        // aynen duruyor. Anahtarlarin gercek metni
        // `test/i18n/locale.test.jsx` tarafindan dogrulanir.
        for (const key of [
            'pm.taskHierarchy',
            'pm.issueHierarchy',
            'pm.subProjects',
            'pm.mailNotifications',
        ]) {
            expect(page, key).toContain(key)
        }
    })

    it('services/api legacy access-mutation metodlarini tasimiyor', () => {
        const api = read('services/api.js')
        expect(api).not.toContain('taskGroupPermissionService')
        expect(api).not.toContain('task-permissions/users')
        expect(api).not.toContain('member-overrides')
        expect(api).not.toContain('task-permissions/effective')
        // Kalan tek metod: /permissions/me (yetenek sorgusu).
        expect(api).toContain("'/api/v1/core/tasks/permissions/me'")
    })

    it('RolesTab bagimlilik haritasi backend ile ayni', () => {
        const roles = read('pages/admin/RolesTab.jsx')
        expect(roles).toContain("'tasks.assign': 'tasks.access'")
        expect(roles).toContain("'issues.assign': 'issues.access'")
    })
})
