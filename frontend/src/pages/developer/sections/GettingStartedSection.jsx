/**
 * Developer Portal — Hizli baslangic (3 adim, ~5 dk).
 *
 * `api.manage` izni olmayan kullanici token OLUSTURAMAZ — kimden
 * isteyecegi soylenir (onayli D1). Izni olan API Yonetimi'ne gider.
 * Tum ornekler kurgusaldir; gercek token/veri ASLA gosterilmez.
 * Metin: devPortal.start.*
 */
import { Button } from 'antd'
import { ApiOutlined, InfoCircleOutlined } from '@ant-design/icons'

import { useT } from '../../../i18n'
import CodeBlock, { CodeTabs } from '../CodeBlock'
import { Bullets, Fold, Rich, SectionHead } from '../parts'

const ENV = `# Keep the base URL and token out of your code:
export HERMES_BASE="https://<your-hermes-host>"
export HERMES_API_TOKEN="hms_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`

const ME_CURL = `curl -s "$HERMES_BASE/api/public/v1/me" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const ME_JS = `const res = await fetch(\`\${process.env.HERMES_BASE}/api/public/v1/me\`, {
    headers: { Authorization: \`Bearer \${process.env.HERMES_API_TOKEN}\` },
})
const me = await res.json()
// me.client.type, me.scopes, me.access -> "who am I, what may I do"`

const ME_PY = `import os
import requests

r = requests.get(
    f"{os.environ['HERMES_BASE']}/api/public/v1/me",
    headers={"Authorization": f"Bearer {os.environ['HERMES_API_TOKEN']}"},
    timeout=30,
)
r.raise_for_status()
me = r.json()  # client, token prefix, scopes, access bindings`

const ME_RESPONSE = `{
  "client": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Example Integration",
    "type": "user",
    "environment": "dev",
    "status": "active",
    "bound_user_id": "9c858901-8a57-4791-81fe-4c455b099bc9"
  },
  "token": { "prefix": "hms_dev_x", "expires_at": null },
  "scopes": ["tasks:read", "work-logs:read"],
  "access": [{ "access_type": "user", "target_id": "9c85…" }]
}`

const TASKS_CURL = `curl -s "$HERMES_BASE/api/public/v1/tasks?limit=5&sort=-updated_at" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const TASKS_RESPONSE = `{
  "data": [
    {
      "task_code": "TASK-12",
      "task_type": "task",
      "title": "Renew TLS certificate",
      "status": "in_progress",
      "priority": "high",
      "customer": { "id": "…", "name": "Example Customer" },
      "project": { "id": "…", "name": "Example Project" }
    }
  ],
  "pagination": { "limit": 5, "offset": 0, "count": 1, "has_more": false }
}`

const WRITE_CURL = `curl -s -X POST "$HERMES_BASE/api/public/v1/tasks/TASK-12/comments" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: first-comment-0001" \\
  -d '{"body": "Deployed to staging, please verify."}'`

const TROUBLE = [
    { code: '401 invalid_token', key: 'invalid', target: 'authentication' },
    { code: '403 insufficient_scope', key: 'scope', target: 'scopes' },
    { code: '403 resource_access_denied', key: 'denied', target: 'authentication' },
    { code: '404 resource_not_found', key: 'notFound', target: 'errors' },
]

function Step({ n, title, time, children }) {
    return (
        <li className="dp-step">
            <span className="dp-step__num" aria-hidden="true">{n}</span>
            <div className="dp-step__body">
                <div className="dp-step__head">
                    <h3>{title}</h3>
                    {time && <span className="lq-tag">{time}</span>}
                </div>
                {children}
            </div>
        </li>
    )
}

function GettingStartedSection({ canManageApi, goTo, openApiManagement }) {
    const t = useT()
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.start.eyebrow')}
                title={t('devPortal.start.title')}
                lead={t('devPortal.start.lead')}
            />

            <ol className="dp-steps">
                <Step n={1} title={t('devPortal.start.s1.title')} time={t('devPortal.start.s1.time')}>
                    <p><Rich text={t('devPortal.start.s1.text')} /></p>
                    {canManageApi ? (
                        <div className="dp-step__actions">
                            <Button type="primary" icon={<ApiOutlined />} onClick={openApiManagement}>
                                {t('devPortal.start.s1.open')}
                            </Button>
                            <span className="dp-muted">{t('devPortal.start.s1.openHint')}</span>
                        </div>
                    ) : (
                        <div className="dp-callout" role="note">
                            <InfoCircleOutlined aria-hidden="true" />
                            <div>
                                <b>{t('devPortal.start.s1.askTitle')}</b>
                                <span>{t('devPortal.start.s1.askText')}</span>
                            </div>
                        </div>
                    )}
                </Step>

                <Step n={2} title={t('devPortal.start.s2.title')} time={t('devPortal.start.s2.time')}>
                    <p><Rich text={t('devPortal.start.s2.text')} /></p>
                    <CodeBlock title="shell" code={ENV} />
                </Step>

                <Step n={3} title={t('devPortal.start.s3.title')} time={t('devPortal.start.s3.time')}>
                    <p><Rich text={t('devPortal.start.s3.text')} /></p>
                    <CodeTabs
                        ariaLabel={t('devPortal.common.language')}
                        samples={[
                            { key: 'curl', label: 'curl', lang: 'bash', code: ME_CURL },
                            { key: 'js', label: 'JavaScript', lang: 'js', code: ME_JS },
                            { key: 'py', label: 'Python', lang: 'python', code: ME_PY },
                        ]}
                    />
                    <CodeBlock title={t('devPortal.common.responseFictional')} lang="json" code={ME_RESPONSE} />
                    <p className="dp-success">
                        <Rich text={t('devPortal.start.s3.success')} />
                    </p>
                </Step>
            </ol>

            <div className="lq-grp">{t('devPortal.start.nextTitle')}</div>
            <div className="dp-folds">
                <Fold title={t('devPortal.start.readTitle')} hint={t('devPortal.start.readHint')}>
                    <CodeBlock title="curl" code={TASKS_CURL} />
                    <CodeBlock title={t('devPortal.common.responseFictional')} lang="json" code={TASKS_RESPONSE} />
                </Fold>
                <Fold title={t('devPortal.start.writeTitle')} hint={t('devPortal.start.writeHint')}>
                    <p><Rich text={t('devPortal.start.writeText')} /></p>
                    <CodeBlock title="curl" code={WRITE_CURL} />
                </Fold>
            </div>

            <div className="lq-grp">{t('devPortal.start.troubleTitle')}</div>
            <div className="dp-trouble">
                {TROUBLE.map((x) => (
                    <button key={x.key} type="button" className="dp-trouble__item" onClick={() => goTo(x.target)}>
                        <code>{x.code}</code>
                        <span>{t(`devPortal.start.trouble.${x.key}`)}</span>
                    </button>
                ))}
            </div>
            <Bullets items={[t('devPortal.start.placeholders')]} />
        </div>
    )
}

export default GettingStartedSection
