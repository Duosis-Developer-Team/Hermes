/**
 * =============================================================================
 * Arsiv calisma alani — eksen, salt okunurluk ve restore sozlesmesi
 * =============================================================================
 * Kilitlenenler (§18):
 *   - varsayilan havuz Active; eksen URL'de yasar; geri/ileri calisir,
 *   - Active ve Archive AYRI cache anahtarlari (birbirine sizmaz),
 *   - arsiv gorunumu salt okunur,
 *   - Restore modali assignment secimini ACIKCA gosterir; birden fazla
 *     assignment SESSIZCE toplu reopen EDILMEZ,
 *   - arsiv metadata'si erisilebilir metinle gosterilir,
 *   - Delete terminolojisi work item akisinda KALMADI.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import useTaskArchiveState from '../../features/tasks/hooks/useTaskArchiveState'
import TaskRestoreModal from '../../features/tasks/modals/TaskRestoreModal'
import TaskArchiveModal from '../../features/tasks/modals/TaskArchiveModal'
import ArchivedTaskMeta from '../../features/tasks/components/ArchivedTaskMeta'
import { buildTaskListParams } from '../../features/tasks/model/taskQuery'
import {
    DEFAULT_ARCHIVE_STATE, canArchiveWorkItem, isArchivable,
    isReadOnlyState,
} from '../../features/tasks/model/taskLifecycle'

const read = (f) => readFileSync(join('src', f), 'utf8')

const wrapperFor = (initial) => {
    const Wrapper = ({ children }) => (
        <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    )
    Wrapper.displayName = 'RouterWrapper'
    return Wrapper
}

const renderState = (initial = '/project-management/tasks') =>
    renderHook(
        () => ({ archive: useTaskArchiveState(), location: useLocation() }),
        { wrapper: wrapperFor(initial) }
    )

describe('Active | Archive ekseni', () => {
    it('varsayilan havuz Active', () => {
        expect(DEFAULT_ARCHIVE_STATE).toBe('active')
        expect(renderState().result.current.archive.archiveState).toBe('active')
    })

    it('?archive=archived Archive havuzunu acar', () => {
        const { result } = renderState('/project-management/tasks?archive=archived')
        expect(result.current.archive.archiveState).toBe('archived')
    })

    it('GECERSIZ deger sessizce Active a duser', () => {
        const { result } = renderState('/project-management/tasks?archive=zzz')
        expect(result.current.archive.archiveState).toBe('active')
    })

    it('havuz degisince URL guncellenir (geri/ileri calisir)', () => {
        const { result } = renderState()
        act(() => result.current.archive.setArchiveState('archived'))
        expect(result.current.location.search).toBe('?archive=archived')
    })

    it('Active a donunce parametre SILINIR', () => {
        const { result } = renderState('/project-management/tasks?archive=archived')
        act(() => result.current.archive.setArchiveState('active'))
        expect(result.current.location.search).toBe('')
    })

    it('diger parametreler (gorunum tercihi) KORUNUR', () => {
        const { result } = renderState('/project-management/tasks?view=board')
        act(() => result.current.archive.setArchiveState('archived'))
        expect(result.current.location.search).toContain('view=board')
        expect(result.current.location.search).toContain('archive=archived')
    })
})

describe('cache ayrimi', () => {
    const base = {
        taskType: 'task', taskScope: 'my-tasks', viewedUserId: 'u1',
        rangeMode: 'all',
    }

    it('archive_state her istegin PARCASIDIR', () => {
        expect(buildTaskListParams(base).archive_state).toBe('active')
        expect(
            buildTaskListParams({ ...base, archiveState: 'archived' }).archive_state
        ).toBe('archived')
    })

    it('Active ve Archive parametreleri FARKLIDIR (anahtar cakismaz)', () => {
        const a = buildTaskListParams(base)
        const b = buildTaskListParams({ ...base, archiveState: 'archived' })
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
    })
})

describe('salt okunurluk ve yetki', () => {
    it('arsiv havuzu SALT OKUNURDUR', () => {
        expect(isReadOnlyState('archived')).toBe(true)
        expect(isReadOnlyState('active')).toBe(false)
    })

    it('sayfa arsivde durum degistirme ve olusturmayi KAPATIR', () => {
        const jsx = read('pages/TasksPage.jsx')
        expect(jsx).toMatch(/allowStatusChange=\{!readOnly/)
        expect(jsx).toMatch(/canCreate=\{!readOnly/)
    })

    it('yalniz TERMINAL logical item arsivlenebilir', () => {
        const terminal = { assignments: [{ status: 'completed' }, { status: 'rejected' }] }
        const open = { assignments: [{ status: 'completed' }, { status: 'in_progress' }] }
        expect(isArchivable(terminal)).toBe(true)
        expect(isArchivable(open)).toBe(false)
    })

    it('normal assignee arsivleyemez; atayan ve admin arsivleyebilir', () => {
        const item = {
            assignments: [{ status: 'rejected' }], assignerUserId: 'boss',
        }
        expect(canArchiveWorkItem({ item, currentUserId: 'worker' })).toBe(false)
        expect(canArchiveWorkItem({ item, currentUserId: 'boss' })).toBe(true)
        expect(canArchiveWorkItem({
            item, currentUserId: 'worker', isTaskAdmin: true,
        })).toBe(true)
    })

    it('aktif item arsivlenemez (yetkili olsa bile)', () => {
        const item = {
            assignments: [{ status: 'in_progress' }], assignerUserId: 'boss',
        }
        expect(canArchiveWorkItem({ item, currentUserId: 'boss' })).toBe(false)
    })
})

describe('Restore modali (§14)', () => {
    const item = (n) => ({
        title: 'API rate limit',
        assignments: Array.from({ length: n }, (_, i) => ({
            id: `a${i}`, assigneeName: `User ${i}`, status: 'rejected',
        })),
    })

    it('tek assignment ACIKCA gosterilir ve secili gelir', () => {
        render(<TaskRestoreModal item={item(1)} onCancel={() => {}} onConfirm={() => {}} />)
        expect(screen.getByRole('radio', { name: /User 0/ })).toBeChecked()
        expect(screen.getByRole('button', { name: /Restore and reopen/ }))
            .toBeEnabled()
    })

    it('birden fazla assignment: secim YAPILMADAN onay CALISMAZ', () => {
        render(<TaskRestoreModal item={item(3)} onCancel={() => {}} onConfirm={() => {}} />)
        for (const i of [0, 1, 2]) {
            expect(screen.getByRole('radio', { name: new RegExp(`User ${i}`) }))
                .not.toBeChecked()
        }
        expect(screen.getByRole('button', { name: /Restore and reopen/ }))
            .toBeDisabled()
    })

    it('secim yapilinca YALNIZ o assignment gonderilir', async () => {
        const onConfirm = vi.fn()
        render(<TaskRestoreModal item={item(3)} onCancel={() => {}} onConfirm={onConfirm} />)
        await userEvent.click(screen.getByRole('radio', { name: /User 1/ }))
        await userEvent.click(screen.getByRole('button', { name: /Restore and reopen/ }))
        expect(onConfirm).toHaveBeenCalledWith({
            assignmentTaskId: 'a1', targetStatus: 'in_progress',
        })
    })

    it('hedef durum secilebilir (pending / in progress)', () => {
        render(<TaskRestoreModal item={item(1)} onCancel={() => {}} onConfirm={() => {}} />)
        expect(screen.getByRole('combobox', { name: 'Reopen as' })).toBeInTheDocument()
    })

    it('pending sirasinda modal kapanmaz', () => {
        render(<TaskRestoreModal item={item(1)} loading onCancel={() => {}} onConfirm={() => {}} />)
        expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled()
    })
})

describe('Archive modali silme DEGIL', () => {
    it('metin kaydin korundugunu soyler', () => {
        render(
            <TaskArchiveModal
                item={{ title: 'X', kind: 'task', assignments: [{ id: 'a' }] }}
                onCancel={() => {}}
                onConfirm={() => {}}
            />
        )
        expect(screen.getByText(/Nothing is deleted/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Archive now/ })).toBeInTheDocument()
    })

    it('coklu atamada hepsinin birlikte arsivlendigi soylenir', () => {
        render(
            <TaskArchiveModal
                item={{ title: 'X', kind: 'task',
                        assignments: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }}
                onCancel={() => {}}
                onConfirm={() => {}}
            />
        )
        expect(screen.getByText(/All 3 assignments/)).toBeInTheDocument()
    })
})

describe('arsiv metadata gosterimi', () => {
    it('otomatik ve manuel arsiv AYIRT EDILEBILIR (metinle)', () => {
        const { unmount } = render(
            <ArchivedTaskMeta archivedAt="2026-08-01T10:00:00Z" reason="auto_retention" />
        )
        expect(screen.getByText(/Auto-archived/)).toBeInTheDocument()
        unmount()
        render(<ArchivedTaskMeta archivedAt="2026-08-01T10:00:00Z" reason="manual" />)
        expect(screen.getByText(/Archived manually/)).toBeInTheDocument()
    })

    it('arsivlenmemis kayitta hic cizilmez', () => {
        const { container } = render(<ArchivedTaskMeta archivedAt={null} />)
        expect(container).toBeEmptyDOMElement()
    })
})

describe('terminoloji', () => {
    it('work item akisinda Delete terminolojisi KALMADI', () => {
        for (const f of [
            'components/tasks/TaskCard.jsx',
            'components/tasks/TasksListView.jsx',
            'features/tasks/modals/TaskDeleteModal.jsx',
        ]) {
            const code = read(f)
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .filter((l) => !l.trim().startsWith('//'))
                .join('\n')
            expect(code, f).not.toMatch(/DeleteOutlined/)
            expect(code, f).not.toMatch(/aria-label=\{`Delete/)
        }
    })
})
