/**
 * Developer Portal — Idempotency.
 * Politika degerleri canli capabilities.writes.idempotency'den.
 * Metin: devPortal.idem.*
 */
import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { Bullets, Rich, SectionHead } from '../parts'

const EXAMPLE = `curl -s -X POST "$HERMES_BASE/api/public/v1/work-logs" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: worklog-2026-07-15-a1b2c3" \\
  -d '{
    "customer_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "project_id":  "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "work_type_id":"9c858901-8a57-4791-81fe-4c455b099bc9",
    "date_worked": "2026-07-15",
    "duration_hours": 2.5,
    "description": "API integration support call."
  }'`

// Senaryo → sonuc tonu (ok: guvenli tekrar, warn: dikkat, bad: korumasiz).
const SCENARIOS = [
    { key: 'same', tone: 'ok' },
    { key: 'diff', tone: 'bad' },
    { key: 'running', tone: 'warn' },
    { key: 'old', tone: '' },
    { key: 'none', tone: 'warn' },
]

function IdempotencySection({ capabilities }) {
    const t = useT()
    const idem = capabilities?.writes?.idempotency || {
        header: 'Idempotency-Key',
        retention_hours: 24,
        replay_header: 'Idempotency-Replayed',
        in_progress_error_code: 'idempotency_request_in_progress',
    }
    const vars = {
        header: idem.header,
        hours: idem.retention_hours,
        replay: idem.replay_header,
        code: idem.in_progress_error_code,
    }

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.idem.eyebrow')}
                title={t('devPortal.idem.title')}
                lead={t('devPortal.idem.lead', vars)}
            />
            <CodeBlock title={t('devPortal.idem.exampleTitle')} code={EXAMPLE} />

            <div className="lq-grp">{t('devPortal.idem.semantics', vars)}</div>
            <ul className="dp-scenarios">
                {SCENARIOS.map((s) => (
                    <li key={s.key}>
                        <span className="dp-scenarios__when">{t(`devPortal.idem.sc.${s.key}.when`, vars)}</span>
                        <span className="dp-scenarios__arrow" aria-hidden="true">→</span>
                        <span className={`dp-scenarios__then${s.tone ? ` is-${s.tone}` : ''}`}>
                            <Rich text={t(`devPortal.idem.sc.${s.key}.then`, vars)} />
                        </span>
                    </li>
                ))}
            </ul>

            <div className="lq-grp">{t('devPortal.idem.guidanceTitle')}</div>
            <Bullets items={[
                t('devPortal.idem.g1'), t('devPortal.idem.g2'),
                t('devPortal.idem.g3', vars), t('devPortal.idem.g4', vars),
            ]} />
        </div>
    )
}

export default IdempotencySection
