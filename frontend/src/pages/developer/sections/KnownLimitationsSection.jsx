/**
 * Developer Portal — Bilinen sinirlamalar.
 * Onayli ilke: ASIRI seffaflik. E-posta cumlesi CTO onayli birebir metin
 * (EN; TR karsiligi anlam odakli ceviri). Metin: devPortal.limits.*
 */
import { useT } from '../../../i18n'
import { Rich, SectionHead } from '../parts'

const LIMITS = [
    { key: 'email', tone: 'warn' },
    { key: 'oauth', tone: 'warn' },
    { key: 'rate', tone: 'warn' },
    { key: 'directory', tone: '' },
    { key: 'worklogs', tone: '' },
    { key: 'retention', tone: '' },
]

function KnownLimitationsSection() {
    const t = useT()
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.limits.eyebrow')}
                title={t('devPortal.limits.title')}
                lead={t('devPortal.limits.lead')}
            />
            <ul className="dp-limits">
                {LIMITS.map((l) => (
                    <li key={l.key} className={l.tone ? `is-${l.tone}` : ''}>
                        <div className="dp-limits__head">
                            <span className={`lq-tag${l.tone ? ` lq-tag--${l.tone}` : ''}`}>
                                {t(`devPortal.limits.${l.key}.tag`)}
                            </span>
                            <b>{t(`devPortal.limits.${l.key}.title`)}</b>
                        </div>
                        <p><Rich text={t(`devPortal.limits.${l.key}.text`)} /></p>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default KnownLimitationsSection
