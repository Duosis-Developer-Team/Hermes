/**
 * HERMES - Sozluk kapisi: her sozlesme degerinin bir etiketi olmali.
 *
 * Eksik bir etiket, kullaniciya ham `waiting_customer` gostermek
 * demektir. Enum sozlesmede sabit oldugu icin bu liste elle tutulur ve
 * degisiklik bilincli olur.
 */
import { describe, expect, it } from 'vitest'

import {
    CATEGORY_LABELS, ERROR_MESSAGES, IMPACT_LABELS, PRIORITY_LABELS,
    QUEUE_LABELS, RESOLUTION_LABELS, STATUS_ICONS, STATUS_LABELS,
    STATUS_TONES, isResolvedLike, labelOf,
} from '../../features/tickets/constants'

const STATUSES = [
    'open', 'in_progress', 'waiting_customer', 'resolved', 'closed',
    'reopened', 'cancelled',
]
const CATEGORIES = [
    'bug', 'incident', 'improvement', 'question', 'data_correction',
]
const IMPACTS = [
    'single_user', 'multiple_users', 'tenant_blocked',
    'security_or_data_risk',
]
const RESOLUTIONS = [
    'fixed', 'workaround', 'configuration', 'not_reproducible',
    'duplicate', 'wont_fix', 'answered',
]
const QUEUES = [
    'my_group_open', 'assigned_to_me', 'unassigned',
    'awaiting_first_response', 'customer_replied', 'waiting_customer',
    'recently_resolved', 'all',
]

describe('ticket dictionary', () => {
    it('her durum icin etiket, ton VE ikon vardir', () => {
        STATUSES.forEach((status) => {
            expect(STATUS_LABELS[status]).toBeTruthy()
            expect(STATUS_TONES[status]).toBeTruthy()
            // Renk TEK basina anlam tasimaz — ikon da zorunlu.
            expect(STATUS_ICONS[status]).toBeTruthy()
        })
    })

    it('kategori, etki, cozum ve kuyruk etiketleri tamdir', () => {
        CATEGORIES.forEach((v) => expect(CATEGORY_LABELS[v]).toBeTruthy())
        IMPACTS.forEach((v) => expect(IMPACT_LABELS[v]).toBeTruthy())
        RESOLUTIONS.forEach((v) => expect(RESOLUTION_LABELS[v]).toBeTruthy())
        QUEUES.forEach((v) => expect(QUEUE_LABELS[v]).toBeTruthy())
        expect(Object.keys(PRIORITY_LABELS)).toEqual(
            ['low', 'normal', 'high', 'urgent'],
        )
    })

    it('bilinmeyen deger ekrani KIRMAZ (unknown fallback)', () => {
        expect(labelOf(STATUS_LABELS, 'brand_new_status'))
            .toBe('brand_new_status')
        expect(labelOf(STATUS_LABELS, undefined)).toBe('—')
    })

    it('sozlesmedeki her onemli hata kodunun insan mesaji vardir', () => {
        const codes = [
            'route_missing', 'route_stale', 'group_inactive',
            'ticket_version_conflict', 'idempotency_conflict',
            'attachment_not_ready', 'rate_limited', 'forbidden',
        ]
        codes.forEach((code) => {
            expect(ERROR_MESSAGES[code]).toBeTruthy()
            expect(ERROR_MESSAGES[code]).not.toContain('_')
        })
    })

    it('cozulmus/kapali satirlar yesil vurgu alir', () => {
        expect(isResolvedLike('resolved')).toBe(true)
        expect(isResolvedLike('closed')).toBe(true)
        expect(isResolvedLike('open')).toBe(false)
    })
})
