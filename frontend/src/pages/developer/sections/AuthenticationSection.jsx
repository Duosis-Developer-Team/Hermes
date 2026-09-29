/**
 * Developer Portal — Kimlik dogrulama.
 * Token prefix'leri canli capabilities'ten okunur. Metin: devPortal.auth.*
 */
import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { Bullets, Rich, SectionHead } from '../parts'

const AUTH_HEADER = `curl -s "$HERMES_BASE/api/public/v1/tasks" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

function AuthenticationSection({ capabilities }) {
    const t = useT()
    const prefixes = capabilities?.authentication?.token_prefixes || [
        'hms_dev_',
        'hms_live_',
    ]

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.auth.eyebrow')}
                title={t('devPortal.auth.title')}
                lead={t('devPortal.auth.lead')}
            />
            <CodeBlock title={t('devPortal.auth.everyRequest')} code={AUTH_HEADER} />

            <div className="dp-facts">
                <div className="dp-fact">
                    <b>{t('devPortal.auth.formatTitle')}</b>
                    <span className="dp-fact__chips">
                        {prefixes.map((p) => <code key={p}>{p}…</code>)}
                    </span>
                    <p>{t('devPortal.auth.formatText')}</p>
                </div>
                <div className="dp-fact">
                    <b>{t('devPortal.auth.onceTitle')}</b>
                    <p><Rich text={t('devPortal.auth.onceText')} /></p>
                </div>
                <div className="dp-fact">
                    <b>{t('devPortal.auth.expiryTitle')}</b>
                    <p><Rich text={t('devPortal.auth.expiryText')} /></p>
                </div>
            </div>

            <div className="lq-grp">{t('devPortal.auth.clientTypes')}</div>
            <div className="dp-compare">
                {['user', 'service'].map((k) => (
                    <div key={k} className={`dp-compare__card${k === 'user' ? ' is-primary' : ''}`}>
                        <div className="dp-compare__head">
                            <b>{t(`devPortal.auth.${k}.name`)}</b>
                            <span className={`lq-tag ${k === 'user' ? 'lq-tag--violet' : 'lq-tag--info'}`}>
                                {t(`devPortal.auth.${k}.tag`)}
                            </span>
                        </div>
                        <dl className="lq-kv">
                            <dt>{t('devPortal.auth.actsAs')}</dt><dd>{t(`devPortal.auth.${k}.actsAs`)}</dd>
                            <dt>{t('devPortal.auth.reads')}</dt><dd>{t(`devPortal.auth.${k}.reads`)}</dd>
                            <dt>{t('devPortal.auth.writes')}</dt><dd>{t(`devPortal.auth.${k}.writes`)}</dd>
                        </dl>
                    </div>
                ))}
            </div>
            <p className="dp-muted"><Rich text={t('devPortal.auth.layersNote')} /></p>

            <div className="lq-grp">{t('devPortal.auth.rotationTitle')}</div>
            <Bullets items={[
                t('devPortal.auth.rot1'), t('devPortal.auth.rot2'),
                t('devPortal.auth.rot3'), t('devPortal.auth.rot4'),
            ]} />

            <div className="lq-grp">{t('devPortal.auth.hygieneTitle')}</div>
            <Bullets items={[t('devPortal.auth.hy1'), t('devPortal.auth.hy2'), t('devPortal.auth.hy3')]} />
        </div>
    )
}

export default AuthenticationSection
