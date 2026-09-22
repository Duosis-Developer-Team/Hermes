/**
 * =============================================================================
 * PM rework P3.4 — E4 gorsel dil: bir kartta EN FAZLA BIR renkli sinyal
 * =============================================================================
 * 04-roller §9.1 / 05 E4 kabul olcutu, kaynak + render ile kilitlenir:
 *   1. Renk tasiyan tek sey TERMIN: gecikmis kirmizi (danger), bugun amber
 *      (warning); "yakinda" ve digerleri notr.
 *   2. Oncelik renksiz ince cubuk (metin yok, aria-hidden); ad yalnizca
 *      erisilebilir etikette tasinir.
 *   3. Durum rozeti renk tasimaz; tip rengi YOK (kod oneki yeter).
 *   4. Liste gorunumu ayni kurali izler (antd Tag renksiz).
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'

import TaskCard from '../../components/tasks/TaskCard'

const SRC = join(process.cwd(), 'src')
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (css, selector) => {
    const i = css.indexOf(selector)
    if (i === -1) return ''
    return css.slice(i, css.indexOf('}', i))
}

const task = (over = {}) => ({
    id: 'wi1', task_code: 'ISSUE-3', title: 'Giris hatasi', task_type: 'issue', status: 'in_progress',
    priority: 'urgent', scheduled_date: '2026-09-10', due_date: '2020-01-01',
    customer_name: 'Vakko', project_name: 'ATM', assignee_user_id: 'u2', assigner_user_id: 'u1', ...over,
})

describe('E4 — kart', () => {
    it('oncelik metinsiz notr cubuk, durum notr metin, termin rozeti tek sinyal', () => {
        const { container } = render(<TaskCard task={task()} currentUserId="u1" />)
        const priority = container.querySelector('.task-card-priority')
        expect(priority.textContent).toBe('')
        expect(priority.getAttribute('aria-hidden')).toBe('true')
        expect(priority.className).toContain('task-card-priority-urgent')
        expect(container.querySelector('.task-card-status').textContent).toBe('in progress')
        expect(container.querySelector('.task-due-badge-overdue')).toBeTruthy()
        // Erisilebilir ad onceligi tasir (renkle degil, metinle).
        expect(container.querySelector('.task-card-open').getAttribute('aria-label')).toContain('priority urgent')
    })

    it('terminsiz kartta hicbir renkli sinyal yok', () => {
        const { container } = render(<TaskCard task={task({ due_date: null })} currentUserId="u1" />)
        expect(container.querySelector('.task-due-badge')).toBeNull()
    })
})

describe('E4 — stil kaynagi', () => {
    const css = noComments(read('components/tasks/TaskCard.css'))

    it('tip rengi yok: tur siniflari kenarlik rengi tasimaz', () => {
        const typeRule = rule(css, '.task-card.task-card-type-task')
        expect(typeRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(typeRule).not.toMatch(/border-left:\s*\d+px\s+solid/)
        expect(css).not.toMatch(/\.task-card-type-issue\s*\{[^}]*#[0-9a-fA-F]{3,8}/)
    })

    it('oncelik ve durum siniflari marka/durum renk tokeni kullanmaz', () => {
        for (const sel of ['.task-card-priority-medium', '.task-card-priority-high', '.task-card-priority-urgent',
            '.task-card-status-in_progress', '.task-card-status-completed', '.task-card-status-pending']) {
            const r = rule(css, sel)
            expect(r, sel).not.toMatch(/--h-(brand|success|danger|warning|info)\b/)
            expect(r, sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        }
    })

    it('termin: gecikmis danger, bugun warning, yakinda notr; ham hex yok', () => {
        expect(rule(css, '.task-due-badge-overdue')).toContain('--h-danger')
        expect(rule(css, '.task-due-badge-due_today')).toContain('--h-warning')
        expect(rule(css, '.task-due-badge-due_soon')).not.toMatch(/--h-(danger|warning|brand)/)
        for (const sel of ['.task-due-badge-overdue', '.task-due-badge-due_today', '.task-due-badge-due_soon', '.task-card-due-hint']) {
            expect(rule(css, sel), sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        }
    })

    it('liste gorunumu: durum/oncelik Tag renk haritasi yok', () => {
        const list = noComments(read('components/tasks/TasksListView.jsx'))
        expect(list).not.toContain('PRIORITY_COLOR')
        expect(list).not.toContain('STATUS_COLOR')
        expect(list).not.toMatch(/<Tag\s+color=/)
    })
})
