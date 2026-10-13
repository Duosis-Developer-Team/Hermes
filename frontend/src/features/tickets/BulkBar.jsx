/**
 * HERMES - Toplu islem cubugu (Dalga B).
 *
 * Secili taleplere TEK islem: oncelik, ekip, etiket, isleme al, takip et.
 * Sunucu her talebi AYRI degerlendirir (kapsam + kural) ve talep basina
 * sonuc doner; burada ozet gosterilir. Cozme/kapatma toplu YAPILMAZ:
 * talep basina ozet ve gerekce isterler.
 */
import { Select } from 'antd'
import { EyeOutlined, PlayCircleOutlined } from '@ant-design/icons'

import { Button } from '../../components/ui'
import { useT } from '../../i18n'
import { useTicketLabel } from './useTicketLabel'

const PRIORITIES = ['low', 'normal', 'high', 'urgent']

export default function BulkBar({ count, groups = [], tags = [], canAssign, canRespond, pending, onAction, onClear }) {
    const t = useT()
    const tl = useTicketLabel()
    if (!count) return null
    return (
        <div className="ticket-bulk" role="region" aria-label={t('hub.bulkTitle')}>
            <b>{t('hub.selected', { count })}</b>
            {canRespond && (
                <Select
                    size="small" value={null} placeholder={t('hub.priority')} aria-label={t('hub.bulkPriority')}
                    disabled={pending} onChange={(v) => onAction('priority', v)}
                    options={PRIORITIES.map((p) => ({ value: p, label: tl('priority', p) }))}
                />
            )}
            {canAssign && (
                <Select
                    size="small" value={null} placeholder={t('hub.targetTeam')} aria-label={t('hub.bulkTeam')}
                    disabled={pending} onChange={(v) => onAction('assign_group', v)}
                    options={groups.map((g) => ({ value: g.id, label: g.name }))}
                />
            )}
            {canRespond && tags.length > 0 && (
                <Select
                    size="small" value={null} placeholder={t('hub.addTag')} aria-label={t('hub.addTag')}
                    disabled={pending} onChange={(v) => onAction('add_tag', v)}
                    options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                />
            )}
            {canRespond && (
                <Button size="small" icon={<PlayCircleOutlined />} disabled={pending} onClick={() => onAction('status', 'in_progress')}>
                    {t('hub.bulkStart')}
                </Button>
            )}
            <Button size="small" icon={<EyeOutlined />} disabled={pending} onClick={() => onAction('watch', true)}>
                {t('hub.watch')}
            </Button>
            <Button size="small" variant="ghost" onClick={onClear}>{t('common.clear')}</Button>
        </div>
    )
}
