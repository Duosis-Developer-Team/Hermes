/**
 * =============================================================================
 * Assignee status badge / roster — gorunum ve erisilebilirlik kilitleri
 * =============================================================================
 * §8 + §16: bes kisiye kadar hepsi gorunur, status yalniz renkle
 * anlatilmaz, cozulemeyen isim yerine ham kimlik BASILMAZ.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
    AssigneeStatusBadge,
    AssignmentRoster,
} from '../../features/tasks/components/AssigneeStatusBadge'
import { UNKNOWN_ASSIGNEE_LABEL } from '../../features/tasks/model/grouping'

const a = (id, name, status) => ({ id, assigneeUserId: `u-${id}`, assigneeName: name, status })

const FIVE = [
    a('1', 'Ahmet', 'completed'),
    a('2', 'Ayse', 'completed'),
    a('3', 'Mehmet', 'completed'),
    a('4', 'Elif', 'in_progress'),
    a('5', 'Can', 'in_progress'),
]

describe('badge sozlesmesi', () => {
    it('ad ve status METIN olarak bulunur (yalniz renk degil)', () => {
        render(<AssigneeStatusBadge assignment={a('1', 'Ahmet', 'completed')} />)
        const el = screen.getByRole('img', { name: 'Ahmet — Completed' })
        expect(el).toBeInTheDocument()
        expect(el.textContent).toContain('Ahmet')
        expect(el.textContent).toContain('Completed')
    })

    it('erisilebilir label tam isim + status tasir', () => {
        render(<AssigneeStatusBadge assignment={a('4', 'Elif', 'in_progress')} />)
        expect(screen.getByRole('img', { name: 'Elif — In Progress' })).toBeInTheDocument()
    })

    it('klavye ile odaklanabilir (tooltip klavyeyle acilabilsin)', async () => {
        render(<AssigneeStatusBadge assignment={a('1', 'Ahmet', 'pending')} />)
        await userEvent.tab()
        expect(screen.getByRole('img', { name: 'Ahmet — Pending' })).toHaveFocus()
    })

    it('cozulemeyen isim yerine notr yer tutucu — UUID BASILMAZ', () => {
        const hidden = { id: 'x', assigneeUserId: 'secret-uuid', assigneeName: null, status: 'pending' }
        render(<AssigneeStatusBadge assignment={hidden} />)
        expect(screen.getByText(UNKNOWN_ASSIGNEE_LABEL)).toBeInTheDocument()
        expect(document.body.textContent).not.toContain('secret-uuid')
    })

    it('her status kendi sinifini tasir (tonal renk tokenlari)', () => {
        for (const s of ['pending', 'in_progress', 'completed', 'rejected', 'cancelled']) {
            const { unmount } = render(<AssigneeStatusBadge assignment={a('1', 'X', s)} />)
            expect(document.querySelector(`.h-assignee-badge--${s}`)).toBeTruthy()
            unmount()
        }
    })
})

describe('roster sozlesmesi (§8)', () => {
    it('BES assignee tamamen gorunur — +N YOK', () => {
        render(<AssignmentRoster assignments={FIVE} />)
        for (const n of ['Ahmet', 'Ayse', 'Mehmet', 'Elif', 'Can']) {
            expect(screen.getByText(n)).toBeInTheDocument()
        }
        expect(screen.queryByRole('button', { name: /Show all/i })).toBeNull()
    })

    it('uc Completed + iki In Progress ayirt edilebilir', () => {
        render(<AssignmentRoster assignments={FIVE} />)
        expect(document.querySelectorAll('.h-assignee-badge--completed')).toHaveLength(3)
        expect(document.querySelectorAll('.h-assignee-badge--in_progress')).toHaveLength(2)
    })

    it('altincidan itibaren +N gosterilir ve tiklanabilir', async () => {
        const onShowAll = vi.fn()
        const seven = [...FIVE, a('6', 'Zeynep', 'pending'), a('7', 'Kerem', 'pending')]
        render(<AssignmentRoster assignments={seven} onShowAll={onShowAll} />)
        const more = screen.getByRole('button', { name: 'Show all 7 assignees' })
        expect(more).toHaveTextContent('+2')
        await userEvent.click(more)
        expect(onShowAll).toHaveBeenCalledTimes(1)
    })

    it('tek assignment tek badge', () => {
        render(<AssignmentRoster assignments={[a('1', 'Ahmet', 'pending')]} />)
        expect(document.querySelectorAll('.h-assignee-badge')).toHaveLength(1)
    })

    it('bos liste patlamaz', () => {
        render(<AssignmentRoster assignments={[]} />)
        expect(document.querySelectorAll('.h-assignee-badge')).toHaveLength(0)
    })
})
