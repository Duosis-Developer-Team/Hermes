/**
 * HERMES - Talep yuzeyi anahtari (talep agi).
 *
 * Bir tenant hem SAGLAYICI (gelen talepler = hub) hem TALEP EDEN
 * (actigim talepler = portal) olabilir. Iki yuzey ayri sayfalardir;
 * bu anahtar yalnizca ikisi birden varken gorunur.
 */
import { useLocation, useNavigate } from 'react-router-dom'

import { LiquidSegmented } from '../../components/liquid'
import { useT } from '../../i18n'
import useTicketContext from './useTicketContext'

export default function SurfaceSwitch() {
    const t = useT()
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { isDual } = useTicketContext()
    if (!isDual) return null
    const value = pathname.startsWith('/support') ? '/support' : '/tickets'
    return (
        <div className="tickets-surface-switch">
            <LiquidSegmented
                ariaLabel={t('tickets.surfaces')}
                value={value}
                onChange={(next) => navigate(next)}
                options={[
                    { value: '/tickets', label: t('tickets.incoming') },
                    { value: '/support', label: t('tickets.outgoing') },
                ]}
            />
        </div>
    )
}
