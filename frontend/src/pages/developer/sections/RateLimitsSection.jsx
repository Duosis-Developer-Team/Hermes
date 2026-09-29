/**
 * Developer Portal — Hiz sinirlari. Metin: devPortal.rate.*
 */
import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { Bullets, SectionHead } from '../parts'

const HEADERS = `X-RateLimit-Limit: 60        # requests allowed in the current window
X-RateLimit-Remaining: 42    # requests left
X-RateLimit-Reset: 1784245260  # window end (unix epoch seconds)

# and only on 429:
Retry-After: 18              # seconds to wait`

const RETRY = `# Pseudo-code for a polite client
response = call_api()
if response.status == 429:
    wait(response.headers["Retry-After"])   # honour the server's number
    retry_with_same_idempotency_key()
elif response.status >= 500:
    exponential_backoff_then_retry()        # 1s, 2s, 4s… + jitter`

function RateLimitsSection() {
    const t = useT()
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.rate.eyebrow')}
                title={t('devPortal.rate.title')}
                lead={t('devPortal.rate.lead')}
            />
            <div className="dp-codegrid">
                <CodeBlock title={t('devPortal.rate.headersTitle')} code={HEADERS} />
                <CodeBlock title={t('devPortal.rate.retryTitle')} code={RETRY} />
            </div>

            <div className="lq-grp">{t('devPortal.rate.hitTitle')}</div>
            <Bullets items={[t('devPortal.rate.h1'), t('devPortal.rate.h2'), t('devPortal.rate.h3')]} />

            <div className="lq-grp">{t('devPortal.rate.underTitle')}</div>
            <Bullets items={[t('devPortal.rate.u1'), t('devPortal.rate.u2'), t('devPortal.rate.u3')]} />
        </div>
    )
}

export default RateLimitsSection
