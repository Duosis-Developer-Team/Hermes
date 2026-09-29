/**
 * Developer Portal — Uyumluluk politikasi + SDK'lar (eski #sdks buraya
 * yonlenir). Stripe/GitHub/Slack tarzi acik politika. Metin:
 * devPortal.compat.*
 */
import { useT } from '../../../i18n'
import { Bullets, Rich, SectionHead } from '../parts'

const POLICY = ['breaking', 'additive', 'deprecation', 'security', 'support']

// SDK'lar HENUZ YOK: yalnizca planlanan paket adlari, "yakinda" etiketiyle.
const SDKS = [
    { key: 'python', name: 'Python', hint: 'pip install hermes-sdk' },
    { key: 'ts', name: 'TypeScript', hint: 'npm install @hermes/sdk' },
    { key: 'csharp', name: 'C#', hint: 'dotnet add package Hermes.Sdk' },
    { key: 'go', name: 'Go', hint: 'go get hermes-sdk' },
    { key: 'java', name: 'Java', hint: 'maven: hermes-sdk' },
]

function CompatibilityPolicySection({ goTo }) {
    const t = useT()
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.compat.eyebrow')}
                title={t('devPortal.compat.title')}
                lead={t('devPortal.compat.lead')}
                extra={(
                    <span className="dp-tagrow">
                        <span className="lq-tag lq-tag--ok">{t('devPortal.compat.stable')}</span>
                        <span className="lq-tag">{t('devPortal.compat.backward')}</span>
                        <span className="lq-tag">{t('devPortal.compat.next')}</span>
                    </span>
                )}
            />

            <ul className="dp-rows">
                {POLICY.map((k) => (
                    <li key={k}>
                        <b>{t(`devPortal.compat.p.${k}.title`)}</b>
                        <span><Rich text={t(`devPortal.compat.p.${k}.text`)} /></span>
                    </li>
                ))}
            </ul>

            <div className="dp-compare">
                <div className="dp-compare__card">
                    <div className="dp-compare__head">
                        <b>{t('devPortal.compat.breakingTitle')}</b>
                        <span className="lq-tag lq-tag--bad">v2</span>
                    </div>
                    <p><Rich text={t('devPortal.compat.breakingText')} /></p>
                </div>
                <div className="dp-compare__card">
                    <div className="dp-compare__head">
                        <b>{t('devPortal.compat.notBreakingTitle')}</b>
                        <span className="lq-tag lq-tag--ok">v1</span>
                    </div>
                    <p><Rich text={t('devPortal.compat.notBreakingText')} /></p>
                </div>
            </div>

            <div className="lq-grp">{t('devPortal.compat.stayTitle')}</div>
            <Bullets items={[
                t('devPortal.compat.s1'), t('devPortal.compat.s2'),
                t('devPortal.compat.s3'), t('devPortal.compat.s4'),
            ]} />

            <div className="lq-grp">{t('devPortal.compat.sdkTitle')}</div>
            <p className="dp-muted"><Rich text={t('devPortal.compat.sdkLead')} /></p>
            <div className="dp-sdks">
                {SDKS.map((s) => (
                    <div key={s.key} className="dp-sdk">
                        <b>{s.name}</b>
                        <code>{s.hint}</code>
                        <span className="lq-tag lq-tag--violet">{t('devPortal.compat.soon')}</span>
                    </div>
                ))}
            </div>
            <p className="dp-muted">
                <Rich text={t('devPortal.compat.sdkToday')} />{' '}
                <button type="button" className="dp-link" onClick={() => goTo('api-reference')}>
                    {t('devPortal.nav.apiReference')}
                </button>
            </p>
        </div>
    )
}

export default CompatibilityPolicySection
