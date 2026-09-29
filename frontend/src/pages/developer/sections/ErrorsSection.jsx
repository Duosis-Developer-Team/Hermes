/**
 * Developer Portal — Hatalar.
 * Katalog CANLI /v1/capabilities.errors'tan render edilir — backend'le
 * drift YAPISAL olarak imkansiz (kalici hizalama testleri backend'de).
 * Kod aciklamalari backend katalogunun kendi metnidir. Metin:
 * devPortal.errors.*
 */
import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { Bullets, Rich, SectionHead } from '../parts'

const ENVELOPE = `{
  "error": {
    "code": "resource_not_found",
    "message": "Task not found.",
    "request_id": "req_a1b2c3d4e5"
  }
}`

function tone(status) {
    if (status >= 500) return 'bad'
    if (status === 429) return 'warn'
    if (status >= 400) return 'info'
    return ''
}

function ErrorsSection({ capabilities }) {
    const t = useT()
    const rows = capabilities?.errors || []

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.errors.eyebrow')}
                title={t('devPortal.errors.title')}
                lead={t('devPortal.errors.lead')}
            />

            <div className="dp-codegrid">
                <CodeBlock title={t('devPortal.errors.envelopeTitle')} lang="json" code={ENVELOPE} />
                <dl className="lq-kv dp-kv dp-envelope-kv">
                    <dt><code>error.code</code></dt><dd>{t('devPortal.errors.fieldCode')}</dd>
                    <dt><code>error.message</code></dt><dd>{t('devPortal.errors.fieldMessage')}</dd>
                    <dt><code>error.request_id</code></dt><dd>{t('devPortal.errors.fieldRequestId')}</dd>
                </dl>
            </div>

            <div className="lq-grp">{t('devPortal.errors.catalogTitle', { n: rows.length || '…' })}</div>
            {rows.length === 0 ? (
                <p className="dp-empty" role="status">{t('devPortal.common.loadingCatalog')}</p>
            ) : (
                <ul className="dp-errors">
                    {rows.map((e) => (
                        <li key={e.code}>
                            <span className={`lq-tag lq-mono${tone(e.status) ? ` lq-tag--${tone(e.status)}` : ''}`}>{e.status}</span>
                            <code>{e.code}</code>
                            <span>{e.description}</span>
                        </li>
                    ))}
                </ul>
            )}

            <div className="lq-grp">{t('devPortal.errors.workingTitle')}</div>
            <Bullets items={[t('devPortal.errors.w1'), t('devPortal.errors.w2'), t('devPortal.errors.w3')]} />
            <p className="dp-muted"><Rich text={t('devPortal.errors.catalogNote')} /></p>
        </div>
    )
}

export default ErrorsSection
