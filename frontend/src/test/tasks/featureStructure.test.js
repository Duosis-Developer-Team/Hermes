/**
 * =============================================================================
 * Sprint 5C — Tasks feature MIMARI KILITLERI (kaynak taramasi)
 * =============================================================================
 * Bunlar davranis testi degil, SINIR testleridir: refactor'un geri
 * kaymasini engeller. Her biri CTO paketinin acik bir kuralini karsilar.
 *
 * (Ayni desen Developer Portal'in gercek-durum kilitlerinde ve MCP
 * servisinin yapisal testlerinde zaten kullaniliyor.)
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../../', import.meta.url).pathname
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')

const walk = (dir) => {
    const out = []
    for (const name of readdirSync(join(SRC, dir))) {
        const rel = dir ? `${dir}/${name}` : name
        if (statSync(join(SRC, rel)).isDirectory()) out.push(...walk(rel))
        else out.push(rel)
    }
    return out
}

const FEATURE = walk('features/tasks')
const TASK_SOURCES = [
    ...FEATURE,
    'pages/TasksPage.jsx',
    ...walk('components/tasks'),
    'components/modals/CreateTaskModal.jsx',
    'components/modals/TaskReviewModal.jsx',
]

describe('feature sinirlari', () => {
    it('TasksPage route/orkestrasyon dosyasidir (1520 → <450 satir)', () => {
        const lines = read('pages/TasksPage.jsx').split('\n').length
        expect(lines).toBeLessThan(450)
    })

    it('sorumluluklar model/hooks/components/modals altina AYRILMISTIR', () => {
        const dirs = new Set(
            FEATURE.map((f) => f.split('/')[2]).filter(Boolean)
        )
        // Sozluk sirasi: 'modals' < 'model' ('a' < 'e').
        expect([...dirs].sort()).toEqual([
            'components', 'hooks', 'modals', 'model',
        ])
    })

    it('TEK bir "mega hook" YOKTUR — her hook ayri bir soruyu cevaplar', () => {
        const hooks = FEATURE.filter((f) => f.includes('/hooks/'))
        expect(hooks.length).toBeGreaterThanOrEqual(6)
        for (const h of hooks) {
            // Hicbir hook sayfanin tamamini tasiyacak kadar buyumemeli.
            expect(read(h).split('\n').length).toBeLessThan(230)
        }
    })

    it('anlamsiz tek-satirlik wrapper yok (her dosya gercek is yapar)', () => {
        for (const f of FEATURE) {
            const code = read(f)
                .split('\n')
                .filter((l) => l.trim() && !l.trim().startsWith('*')
                    && !l.trim().startsWith('/*') && !l.trim().startsWith('//'))
            expect(code.length).toBeGreaterThan(12)
        }
    })
})

describe('RBAC: ikinci bir karar sistemi YOK', () => {
    const PERMISSION_SHAPES = [
        'can_assign', 'can_access', 'assignable_user_ids',
        'assignable_group_ids',
    ]

    it('ham izin sekli YALNIZCA permissions katmaninda okunur', () => {
        // Tek istisna useTaskPermissions: API yanitini normalize eden
        // adapter. Karar (kim neyi yapabilir) permissions.js'te verilir.
        for (const f of TASK_SOURCES) {
            if (f.endsWith('features/tasks/model/permissions.js')) continue
            const code = read(f)
            for (const shape of PERMISSION_SHAPES) {
                expect(
                    code.includes(shape),
                    `${f} ham izin alanina (${shape}) dokunuyor`
                ).toBe(false)
            }
        }
    })

    it('izin selector’lari TEK dosyadan export edilir', () => {
        const owners = TASK_SOURCES.filter((f) =>
            /export (function|const) (selectTaskPermissions|resolveViewedUserId)/
                .test(read(f))
        )
        expect(owners).toEqual(['features/tasks/model/permissions.js'])
    })

    it('TasksPage izin kararini kendisi TUREYMEZ, selector’dan alir', () => {
        const code = read('pages/TasksPage.jsx')
        expect(code).toContain('selectTaskPermissions')
        expect(code).toContain('resolveViewedUserId')
        expect(code).not.toMatch(/scopes\s*[?.[]/)
    })
})

describe('veri katmani sozlesmesi', () => {
    it('feature icinde DOGRUDAN axios cagrisi yok (servis katmani zorunlu)', () => {
        for (const f of FEATURE) {
            expect(read(f)).not.toMatch(/from ['"]axios['"]/)
        }
    })

    it('query anahtarlari MERKEZI sozlesmeden gelir (ham dizi yok)', () => {
        for (const f of FEATURE) {
            const code = read(f)
            // ['tasks'] / ['task-activity'] gibi ham anahtar edebiyati
            // feature icinde bulunmamali.
            expect(code).not.toMatch(/queryKey:\s*\[\s*['"]/)
            expect(code).not.toMatch(/invalidateQueries\(\s*\[/)
        }
    })

    it('mutasyon + invalidation TEK hook’ta toplanir', () => {
        const withMutations = FEATURE.filter((f) =>
            read(f).includes('invalidateQueries')
        ).sort()
        expect(withMutations).toEqual([
            'features/tasks/hooks/useTaskMutations.js',
            'features/tasks/hooks/useTaskWorkLog.js',
        ])
    })

    it('sayfada ham payload uretimi kalmadi', () => {
        const code = read('pages/TasksPage.jsx')
        expect(code).not.toContain('task_type:')
        expect(code).not.toContain('due_from')
        expect(code).not.toContain('assignee_user_id:')
    })
})

describe('route sinirlari korunur', () => {
    it('Tasks hala LAZY route’dur ve tek loader’a baglidir', () => {
        const loaders = read('routes/loaders.js')
        expect(loaders).toContain("tasks: () => import('../pages/TasksPage')")
        expect(loaders).toContain("'/project-management': routeLoaders.tasks")
    })

    it('TasksPage baska bir modulden EAGER import edilmez', () => {
        const eager = walk('')
            .filter((f) => /\.(js|jsx)$/.test(f) && !f.startsWith('test/'))
            .filter((f) => f !== 'pages/TasksPage.jsx')
            .filter((f) => /^import .*['"].*pages\/TasksPage['"]/m.test(read(f)))
        expect(eager).toEqual([])
    })
})

describe('kapsam disi birakilan urun kararlari', () => {
    it('Tasks yuzeyinde clipboard/copy-paste KALINTISI yok', () => {
        for (const f of TASK_SOURCES) {
            const code = read(f)
            expect(code).not.toMatch(/copiedTask|clipboardSnapshot|Ctrl\+C|Ctrl\+V/)
            expect(code).not.toMatch(/isTaskCopyable/)
        }
    })

    it('Calendar gorunumu URETILMEDI', () => {
        for (const f of TASK_SOURCES) {
            expect(read(f)).not.toMatch(/TaskCalendar|calendarView|viewLayout === 'calendar'/)
        }
    })

    it('Time Entry clipboard modeli DOKUNULMADAN durur', () => {
        const clipboard = read('features/time-entry/model/clipboard.js')
        expect(clipboard).toContain('export')
        expect(clipboard.length).toBeGreaterThan(500)
    })
})
