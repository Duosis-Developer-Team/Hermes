/**
 * HERMES - Musterinin gordugu cozum karti.
 *
 * TEK yerde: musteri detayi bunu cizer, cozum penceresinin onizlemesi de
 * AYNISINI cizer — onizleme musterinin gorecegiyle birebir ayni kalir.
 * Yalnizca musteriye acik alanlar (ozet, gecici cozum, duzeltme surumu);
 * ic alanlar buraya hic gelmez.
 */
import { Typography } from 'antd'

import { Inline, Stack, StatusBadge } from '../../components/ui'
import { useT } from '../../i18n'
import { useTicketLabel } from './useTicketLabel'
import './tickets.css'

const { Text, Paragraph } = Typography

export default function ResolutionSummary({ resolution, children }) {
    const t = useT()
    const tl = useTicketLabel()
    const { resolution_code: code, summary, workaround, fix_version: fixVersion } = resolution
    return (
        <Stack gap={2} className="h-ticket-resolution">
            <Inline gap={2}>
                <StatusBadge tone="success">✓ {t('ticket.resolvedBadge')}</StatusBadge>
                {code && <Text strong>{tl('resolution', code)}</Text>}
                {resolution.resolved_at && (
                    <Text type="secondary">
                        {new Date(resolution.resolved_at).toLocaleString()}
                        {resolution.resolved_by_team && ` · ${resolution.resolved_by_team}`}
                    </Text>
                )}
            </Inline>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{summary}</Paragraph>
            {workaround && (
                <Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                    {t('ticket.workaroundLabel')}: {workaround}
                </Paragraph>
            )}
            {fixVersion && (
                <Text type="secondary">{t('ticket.fixVersionLabel')}: {fixVersion}</Text>
            )}
            {children}
        </Stack>
    )
}
