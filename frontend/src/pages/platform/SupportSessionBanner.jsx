/**
 * =============================================================================
 * HERMES - Destek oturumu banner'i (WS9)
 * =============================================================================
 * Aktif bir destek erisimi varken KALICI olarak gorunur ve tenant adini,
 * modu ve kalan sureyi soyler.
 *
 * TASARIM KURALI (pack 07 §9): "hide banner" aksiyonu YOKTUR. Operator
 * baska bir sirketin verisine bakarken bunu unutabilmemelidir; banner
 * kapatilabilir olsaydi tam da bu olurdu.
 *
 * Sure dolunca banner kendini "expired" durumuna cevirir ve `onExpire`
 * ile konsolu bilgilendirir — erisimin fiilen bitmesi ise sunucu
 * tarafindadir (token'in exp'i), banner yalnizca gorunur uyaridir.
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Space, Typography } from 'antd'
import { EyeOutlined, WarningOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'

const { Text } = Typography

const formatRemaining = (ms) => {
    if (ms <= 0) return '00:00'
    const total = Math.floor(ms / 1000)
    const mm = String(Math.floor(total / 60)).padStart(2, '0')
    const ss = String(total % 60).padStart(2, '0')
    return `${mm}:${ss}`
}

export default function SupportSessionBanner({ session, onEnd, onExpire }) {
    const t = useT()
    const expiresAt = useMemo(
        () => (session ? new Date(session.expires_at).getTime() : 0),
        [session],
    )
    const [remaining, setRemaining] = useState(
        () => expiresAt - Date.now(),
    )

    useEffect(() => {
        if (!session) return undefined
        const tick = () => {
            const left = expiresAt - Date.now()
            setRemaining(left)
            if (left <= 0 && onExpire) onExpire()
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [session, expiresAt, onExpire])

    if (!session) return null

    const expired = remaining <= 0
    const readOnly = session.mode === 'read_only'

    return (
        <Alert
            type={expired ? 'error' : 'warning'}
            showIcon
            icon={expired ? <WarningOutlined /> : <EyeOutlined />}
            banner
            role="status"
            aria-live="polite"
            data-testid="support-session-banner"
            message={
                <Space size={12} wrap>
                    <Text strong>
                        {expired
                            ? 'Support session expired'
                            : 'Support session active'}
                    </Text>
                    <Text>
                        Workspace: <Text strong>{session.tenant.display_name}</Text>
                    </Text>
                    {/* Mod, RENKTEN bagimsiz olarak METINLE de belirtilir
                        (erisilebilirlik: durum yalnizca renkle anlatilmaz). */}
                    <Text>
                        Mode:{' '}
                        <Text strong>
                            {readOnly ? 'read-only' : 'read-write'}
                        </Text>
                    </Text>
                    <Text>
                        Time left:{' '}
                        <Text strong>{formatRemaining(remaining)}</Text>
                    </Text>
                </Space>
            }
            action={
                /* Yalnizca SONLANDIRMA aksiyonu var — gizleme YOK. */
                <Button size="small" danger onClick={onEnd}>{t('misc.endSession')}</Button>
            }
        />
    )
}
