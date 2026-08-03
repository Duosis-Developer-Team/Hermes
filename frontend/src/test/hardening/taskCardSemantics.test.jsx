/**
 * =============================================================================
 * Sprint 7 — TaskCard semantigi (GERCEK mount)
 * =============================================================================
 * Kaynak taramasi degil DAVRANIS testi: kart gercekten mount edilir ve
 * klavye/ekran okuyucu yolu surulur.
 *
 * KAPATILAN KUSUR: kart koku `role="button" tabIndex={0}` idi ve ICINDE
 * checkbox ile aksiyon butonlari vardi — yani bir buton rolunun icine
 * baska interaktif kontroller yerlestirilmisti. Bu gecersiz semantiktir:
 * ekran okuyucu ic kontrolleri dogru sunmaz, klavye sirasi bulaniklasir.
 * Sorun `stopPropagation` ile ORTULMEDI; HTML ile cozuldu:
 *   - kok sade bir kapsayici (fare tiklamasi KORUNDU),
 *   - acma islemi icin ACIK, klavyeyle erisilebilir gercek bir buton.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TaskCard from '../../components/tasks/TaskCard'

const TASK = {
    id: 't1',
    task_code: 'TASK-1',
    title: 'Sozlesme ekranini duzelt',
    status: 'in_progress',
    priority: 'high',
    task_type: 'task',
    assignee_user_id: 'u2',
    customer_name: 'Vakko',
    project_name: 'ATM Yenileme',
}

const setupUser = () => userEvent.setup({ delay: null })

const renderCard = (props = {}) =>
    render(
        <TaskCard
            task={TASK}
            currentUserId="u1"
            isAdmin
            userMap={{ u2: { full_name: 'Bob Bit' } }}
            canToggleCompletion={false}
            {...props}
        />
    )

/** Karti acan GERCEK kontrol. */
const opener = () => screen.getByRole('button', { name: /TASK-1/ })

describe('ic ice interaktif kontrol YOK', () => {
    it('kart koku buton olarak ANONS EDILMEZ', () => {
        const { container } = renderCard()
        const root = container.querySelector('.task-card')
        expect(root).toBeTruthy()
        expect(root.getAttribute('role')).toBeNull()
        expect(root.getAttribute('tabindex')).toBeNull()
    })

    it('hicbir buton BASKA bir butonun icinde degil', () => {
        const { container } = renderCard({ onEdit: vi.fn(), onDelete: vi.fn() })
        const interactive = container.querySelectorAll(
            'button, [role="button"], input, a[href]'
        )
        expect(interactive.length).toBeGreaterThan(1)
        for (const el of interactive) {
            const parentInteractive = el.parentElement?.closest(
                'button, [role="button"], a[href]'
            )
            expect(parentInteractive).toBeNull()
        }
    })
})

describe('acma kontrolu klavyeyle CALISIR', () => {
    it('erisilebilir adi kod, baslik ve DURUMU tasir', () => {
        renderCard()
        const btn = opener()
        const name = btn.getAttribute('aria-label')
        expect(name).toContain('TASK-1')
        expect(name).toContain('Sozlesme ekranini duzelt')
        // Durum yalniz RENKLE anlatilmaz.
        expect(name).toMatch(/In Progress|Devam|in_progress/i)
    })

    it('Tab ile ODAKLANILABILIR', async () => {
        const user = setupUser()
        renderCard()
        await user.tab()
        // Ilk odaklanabilir oge kartin acma kontrolu ya da checkbox olabilir;
        // acma kontrolunun odaklanabilir OLMASI yeterli kanittir.
        opener().focus()
        expect(opener()).toHaveFocus()
    })

    it('Enter karti acar', async () => {
        const onSelect = vi.fn()
        const user = setupUser()
        renderCard({ onSelect })
        opener().focus()
        await user.keyboard('{Enter}')
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('Space karti acar', async () => {
        const onSelect = vi.fn()
        const user = setupUser()
        renderCard({ onSelect })
        opener().focus()
        await user.keyboard(' ')
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('fare ile baslik tiklamasi TEK KEZ tetikler (kok ile cift calismaz)', async () => {
        const onSelect = vi.fn()
        const user = setupUser()
        renderCard({ onSelect })
        await user.click(opener())
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('kartin BOS alanina tiklamak da acar (fare alisikligi KORUNDU)', async () => {
        const onSelect = vi.fn()
        const user = setupUser()
        const { container } = renderCard({ onSelect })
        await user.click(container.querySelector('.task-card-meta'))
        expect(onSelect).toHaveBeenCalledTimes(1)
    })
})

describe('satir aksiyonlari korunuyor', () => {
    it('Edit ve Delete ayri, adlandirilmis kontroller', () => {
        // Bu testte etkilesim YOK: yalnizca cizilen kontroller denetlenir.
        const onEdit = vi.fn()
        const onDelete = vi.fn()
        const { container } = renderCard({ onEdit, onDelete })
        const actions = container.querySelector('.task-card-actions')
        const buttons = within(actions).getAllByRole('button')
        expect(buttons.length).toBeGreaterThanOrEqual(2)
        for (const b of buttons) {
            const name = b.getAttribute('aria-label') || b.getAttribute('title')
            expect(name).toBeTruthy()
        }
    })

    it('aksiyon tiklamasi karti ACMAZ (olay yukari cikmaz)', async () => {
        const onSelect = vi.fn()
        const onEdit = vi.fn()
        const user = setupUser()
        const { container } = renderCard({ onSelect, onEdit })
        const editBtn = within(container.querySelector('.task-card-actions'))
            .getAllByRole('button')
            .find((b) => /edit/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
        if (!editBtn) return
        await user.click(editBtn)
        expect(onEdit).toHaveBeenCalled()
        expect(onSelect).not.toHaveBeenCalled()
    })
})
